/**
 * The canonical audit record.
 *
 * The application already writes audit rows from 33 places, and they are good
 * rows. What is missing is anything that *makes* them good: each call site
 * assembles the object itself, so a forgotten `outcome` or a missing
 * `organizationId` is a runtime discovery, and a metadata blob carrying a
 * token or an email is nobody's job to notice.
 *
 * This builder cannot produce an invalid record. Required fields are required
 * by the type and re-checked at runtime — because the most common way an audit
 * row goes wrong is a value that was `undefined` at runtime while satisfying
 * the compiler, arriving from a database read or a request body.
 *
 * The platform architecture specifies an audit shape with columns the schema
 * does not have (`actorUserId`, `decision`, `entityType`, `entityId`) and omits
 * `outcome`, which is NOT NULL with no default — so its worked INSERT would
 * fail on five of seven columns. This is written against the actual model.
 */

export type AuditOutcome = "ALLOW" | "DENY"

/** How much damage disclosing a metadata value does. Drives redaction. */
export type FieldSensitivity = "public" | "internal" | "confidential" | "secret"

export interface AuditActor {
  principalId: string
  /**
   * The role the actor held when they acted, not the role they hold now.
   *
   * An audit trail read six months later is read against a roster that has
   * changed; recording the role at the time is the difference between "the
   * president approved this" and "a person who is no longer president, and
   * whose authority at the time is now unknowable, approved this".
   */
  role?: string
  /**
   * Set when someone acted *as* this principal — Tenure support, or an admin
   * impersonating a user to reproduce a problem.
   *
   * Separate from principalId on purpose. Collapsing them makes an
   * impersonated action indistinguishable from the user's own, which is
   * exactly the distinction an incident review needs.
   */
  impersonatedBy?: string
}

export interface AuditRecordInput {
  tenantId: string
  organizationId?: string
  actor: AuditActor
  /** e.g. "Admin.role.assign", "ApprovalRequest.StatusChanged". */
  action: string
  resourceType: string
  resourceId?: string
  outcome: AuditOutcome
  reason?: string
  /** Free-form detail. Redacted by `sensitiveKeys` before it is stored. */
  metadata?: Readonly<Record<string, unknown>>
  /** Metadata keys whose values must never be stored in full. */
  sensitiveKeys?: readonly string[]
  /** Correlates every record produced by one request. */
  traceId?: string
  /** The release the system was running under. */
  releaseId?: string
  /** The configuration version in force. */
  configurationChecksum?: string
  /** Why a permission decision came out the way it did, from the authz engine. */
  policyDecision?: { reason: string; detail?: string; viaRoles?: readonly string[] }
  occurredAt: string
}

export interface AuditRecord {
  readonly tenantId: string
  readonly organizationId: string | null
  readonly actorId: string
  readonly actorRole: string | null
  readonly impersonatedBy: string | null
  readonly action: string
  readonly resourceType: string
  readonly resourceId: string | null
  readonly outcome: AuditOutcome
  readonly reason: string | null
  readonly metadata: Readonly<Record<string, unknown>>
  readonly traceId: string | null
  readonly occurredAt: string
}

export class AuditRecordError extends Error {
  readonly problems: readonly string[]
  constructor(problems: readonly string[]) {
    super(`Refusing to build an audit record:\n  ${problems.join("\n  ")}`)
    this.name = "AuditRecordError"
    this.problems = problems
  }
}

export const REDACTED = "[redacted]"

/**
 * Keys whose values are never stored in full, whatever the caller says.
 *
 * A denylist is the wrong shape for access control and the right shape here:
 * the cost of redacting something harmless is a slightly less useful audit row,
 * and the cost of storing a token is a token in an append-only table that
 * `ON DELETE RESTRICT` makes it impossible to remove.
 */
const ALWAYS_SENSITIVE = [
  "password",
  "passphrase",
  "secret",
  "token",
  "apiKey",
  "authorization",
  "cookie",
  "sessionId",
  "ssn",
  "dateOfBirth",
]

const looksSensitive = (key: string): boolean => {
  const k = key.toLowerCase()
  return ALWAYS_SENSITIVE.some((s) => k.includes(s.toLowerCase()))
}

/**
 * Redact recursively, by key name.
 *
 * Recursive because the value that matters is usually nested — a `before`/
 * `after` pair, or a request body copied wholesale into metadata. Redacting
 * only top-level keys catches the cases nobody was going to get wrong anyway.
 */
export function redactMetadata(
  metadata: Readonly<Record<string, unknown>>,
  extraKeys: readonly string[] = [],
): Record<string, unknown> {
  const extra = new Set(extraKeys.map((k) => k.toLowerCase()))

  const walk = (value: unknown, depth: number): unknown => {
    // Bounded: metadata comes from callers, and a cyclic or pathologically deep
    // object must not take out the write that records what someone just did.
    if (depth > 8) return "[too deep]"
    if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1))
    if (value === null || typeof value !== "object") return value

    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = looksSensitive(k) || extra.has(k.toLowerCase()) ? REDACTED : walk(v, depth + 1)
    }
    return out
  }

  return walk(metadata, 0) as Record<string, unknown>
}

/**
 * Build a validated, redacted audit record, or refuse.
 *
 * Refusing is correct. A write that cannot be attributed is worse than no write:
 * it occupies a row that looks like evidence and is not.
 */
export function buildAuditRecord(input: AuditRecordInput): AuditRecord {
  const problems: string[] = []

  if (!input.tenantId) problems.push("tenantId is required — an unattributed record is not evidence.")
  if (!input.actor?.principalId) problems.push("actor.principalId is required.")
  if (!input.action) problems.push("action is required.")
  if (!input.resourceType) problems.push("resourceType is required.")
  if (input.outcome !== "ALLOW" && input.outcome !== "DENY") {
    problems.push(`outcome must be ALLOW or DENY, got ${JSON.stringify(input.outcome)}.`)
  }
  if (!input.occurredAt || Number.isNaN(Date.parse(input.occurredAt))) {
    problems.push(`occurredAt must be an ISO timestamp, got ${JSON.stringify(input.occurredAt)}.`)
  }
  if (input.outcome === "DENY" && !input.reason && !input.policyDecision) {
    // A denial with no reason cannot answer the only question anyone asks about
    // one, which is why.
    problems.push("a DENY needs a reason or a policy decision.")
  }

  if (problems.length > 0) throw new AuditRecordError(problems)

  const metadata: Record<string, unknown> = redactMetadata(
    input.metadata ?? {},
    input.sensitiveKeys,
  )

  // Provenance lives in metadata rather than in new columns, because the schema
  // has none and adding them belongs to the migration programme. Namespaced so
  // it cannot collide with a caller's own keys.
  if (input.releaseId) metadata["_releaseId"] = input.releaseId
  if (input.configurationChecksum) metadata["_configurationChecksum"] = input.configurationChecksum
  if (input.policyDecision) metadata["_policyDecision"] = input.policyDecision
  if (input.actor.impersonatedBy) metadata["_impersonatedBy"] = input.actor.impersonatedBy

  return Object.freeze({
    tenantId: input.tenantId,
    organizationId: input.organizationId ?? null,
    actorId: input.actor.principalId,
    actorRole: input.actor.role ?? null,
    impersonatedBy: input.actor.impersonatedBy ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    outcome: input.outcome,
    reason: input.reason ?? null,
    metadata: Object.freeze(metadata),
    traceId: input.traceId ?? null,
    occurredAt: input.occurredAt,
  })
}
