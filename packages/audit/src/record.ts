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
 *
 * Every record also carries a `recordHash` over its own frozen content, and
 * optionally the `sequence` and `previousHash` that chain it to the record
 * before it. Without those, "append-only" is a claim about a table's
 * permissions rather than a property anyone can check: an UPDATE that rewrites
 * a reason, or a DELETE that removes the one denial that mattered, leaves a log
 * that still reads perfectly. See `verify.ts`.
 */

import { createHash } from "node:crypto"

// The same canonical serializer the releases and configuration packages hash
// with. Reused rather than reimplemented: two definitions of "canonical" is one
// too many, and a chain whose hash depends on JSON key order is not a chain.
import { stableStringify } from "@tenure/configuration"

// Redaction by value rather than by key name. See secret-values.ts for why the
// two rules are both needed and why this one is prefix-based.
import { redactSecretValues } from "./secret-values"

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
  /**
   * Position in this tenant's append-only chain. Omit it and the record is
   * built unchained (`sequence: null`) — still individually hashed, so an edit
   * to it is detectable, but nothing proves a neighbour was not deleted.
   *
   * Supply it (with `previousHash`) or supply `previous` and let the builder
   * derive both.
   */
  sequence?: number | null
  /** The `recordHash` of the record at `sequence - 1` for this tenant. */
  previousHash?: string | null
  /**
   * The preceding record, when the writer holds it. Derives `sequence` and
   * `previousHash`, and — the reason to prefer it — refuses to extend a chain
   * whose last link does not hash to its own recorded hash. A tampered log
   * stops growing at the tamper rather than burying it under later writes.
   */
  previous?: AuditRecord | null
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
  /** Position in this tenant's chain, or null when the record is unchained. */
  readonly sequence: number | null
  /** The preceding record's hash; null at the head of a chain or when unchained. */
  readonly previousHash: string | null
  /** `sha256:…` over this record's content, excluding the hash itself. */
  readonly recordHash: string
}

/**
 * Everything `hashRecord` needs. Wider than `AuditRecord` on purpose: the
 * builder hashes a record that does not have its hash yet, and a caller
 * rehydrating rows from the database hashes one whose `recordHash` came back
 * inside `metadata`.
 */
export type HashableRecord = Omit<AuditRecord, "recordHash"> & { readonly recordHash?: string }

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
 * Where the chain fields live inside `metadata`.
 *
 * The `AuditEvent` table has no columns for them, and both production writers
 * persist `record.metadata` wholesale as JSONB — so mirroring them here is what
 * makes the hash survive a round trip through the database today, with no
 * migration. Same reasoning, and the same `_` namespace, as `_releaseId` and
 * `_policyDecision` above. Exported because a reader rehydrating rows needs to
 * know the contract, and a string literal repeated in two packages is a bug
 * waiting for a rename.
 */
export const CHAIN_METADATA_KEYS = {
  sequence: "_sequence",
  previousHash: "_previousHash",
  recordHash: "_recordHash",
} as const

/**
 * The content a record's hash covers.
 *
 * Excludes the hash itself — a value cannot commit to itself — but includes
 * `sequence` and `previousHash`, which is what makes the chain a chain: moving
 * a record, or re-pointing it at a different predecessor, changes its hash and
 * therefore every hash after it.
 */
function hashedContentOf(record: HashableRecord): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(record.metadata ?? {})) {
    if (k === CHAIN_METADATA_KEYS.recordHash) continue
    metadata[k] = v
  }

  return {
    tenantId: record.tenantId,
    organizationId: record.organizationId ?? null,
    actorId: record.actorId,
    actorRole: record.actorRole ?? null,
    impersonatedBy: record.impersonatedBy ?? null,
    action: record.action,
    resourceType: record.resourceType,
    resourceId: record.resourceId ?? null,
    outcome: record.outcome,
    reason: record.reason ?? null,
    traceId: record.traceId ?? null,
    occurredAt: record.occurredAt,
    sequence: record.sequence ?? null,
    previousHash: record.previousHash ?? null,
    metadata,
  }
}

/**
 * Recompute a record's hash from its content.
 *
 * The verifier and the builder call this same function, so "the hash is wrong"
 * can only mean the content changed — never that two implementations of
 * "canonical" drifted apart.
 */
export function hashRecord(record: HashableRecord): string {
  return `sha256:${createHash("sha256").update(stableStringify(hashedContentOf(record))).digest("hex")}`
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

  // --- chain position -------------------------------------------------------
  let sequence: number | null = input.sequence ?? null
  let previousHash: string | null = input.previousHash ?? null

  if (input.previous) {
    const prev = input.previous
    if (prev.tenantId !== input.tenantId) {
      problems.push(
        `previous record belongs to tenant ${JSON.stringify(prev.tenantId)}, not ${JSON.stringify(input.tenantId)} — chains are per-tenant.`,
      )
    }
    if (prev.sequence === null) {
      problems.push("previous record is unchained (sequence null); it cannot be extended.")
    }
    // The link that makes a hash chain worth having: extending a record whose
    // content no longer hashes to its recorded hash would bury the tamper under
    // a valid-looking suffix.
    const recomputed = hashRecord(prev)
    if (recomputed !== prev.recordHash) {
      problems.push(
        `previous record does not hash to its recorded hash (${prev.recordHash} vs ${recomputed}) — the chain it would extend is already broken.`,
      )
    }
    if (input.sequence != null && input.sequence !== (prev.sequence ?? -1) + 1) {
      problems.push(
        `sequence ${input.sequence} does not follow the previous record's ${prev.sequence}.`,
      )
    }
    if (input.previousHash != null && input.previousHash !== prev.recordHash) {
      problems.push("previousHash contradicts the previous record's own hash.")
    }
    sequence = (prev.sequence ?? 0) + 1
    previousHash = prev.recordHash
  }

  if (sequence !== null) {
    if (!Number.isInteger(sequence) || sequence < 0) {
      problems.push(`sequence must be a non-negative integer, got ${JSON.stringify(sequence)}.`)
    } else if (sequence === 0 && previousHash !== null) {
      problems.push("sequence 0 is the head of a chain and has nothing before it.")
    } else if (sequence > 0 && !previousHash) {
      // Otherwise the record claims a position it cannot prove, and every gap
      // check below it becomes unfalsifiable.
      problems.push(`sequence ${sequence} must name the previousHash it follows.`)
    }
  } else if (previousHash !== null) {
    problems.push("previousHash without a sequence does not place the record in any chain.")
  }

  if (problems.length > 0) throw new AuditRecordError(problems)

  // Two passes, and the second is the one that catches what happens in
  // practice. `redactMetadata` is key-name driven, so `{ note: "sk_live_…" }`
  // and `{ body: { data: { object: "whsec_…" } } }` both walk straight through
  // it — the key is innocuous and the value is a credential. PAY-020-006:
  // scanning the values afterwards is what stops a provider webhook body from
  // becoming a permanent row in an append-only table.
  const metadata: Record<string, unknown> = redactSecretValues(
    redactMetadata(input.metadata ?? {}, input.sensitiveKeys),
    REDACTED,
  )

  // Provenance lives in metadata rather than in new columns, because the schema
  // has none and adding them belongs to the migration programme. Namespaced so
  // it cannot collide with a caller's own keys.
  if (input.releaseId) metadata["_releaseId"] = input.releaseId
  if (input.configurationChecksum) metadata["_configurationChecksum"] = input.configurationChecksum
  if (input.policyDecision) metadata["_policyDecision"] = input.policyDecision
  if (input.actor.impersonatedBy) metadata["_impersonatedBy"] = input.actor.impersonatedBy

  if (sequence !== null) {
    metadata[CHAIN_METADATA_KEYS.sequence] = sequence
    metadata[CHAIN_METADATA_KEYS.previousHash] = previousHash
  }

  // Canonicalised, not passed through. `2026-07-31T12:00:00Z` and
  // `…T12:00:00.000Z` are the same instant and different strings, and the
  // second is what a database round trip gives back — so hashing the caller's
  // spelling would make a record fail verification for having been stored.
  const occurredAt = new Date(input.occurredAt).toISOString()

  const unhashed: HashableRecord = {
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
    metadata,
    traceId: input.traceId ?? null,
    occurredAt,
    sequence,
    previousHash,
  }

  const recordHash = hashRecord(unhashed)
  // Mirrored into metadata last, and excluded from the hash, so the value that
  // both production writers persist as JSONB is the same value the verifier
  // recomputes.
  metadata[CHAIN_METADATA_KEYS.recordHash] = recordHash

  return Object.freeze({
    ...unhashed,
    metadata: Object.freeze(metadata),
    recordHash,
  })
}
