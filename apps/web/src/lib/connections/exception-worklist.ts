import { redactSecretValues } from "@tenure/audit"

import {
  RETRY_DISPOSITION,
  type IntegrationErrorClass,
  type RetryDisposition,
} from "@/lib/connections/integration-errors"

/**
 * INT-060-002, the second clause — the exception worklist.
 *
 * Bible §14: "Exceptions display source object, intended outcome, current
 * outcome, financial/authority/data impact, retry eligibility, remediation,
 * owner, SLA, evidence and related records. Sensitive payloads remain
 * protected." §16.8 asks the same list to be a WORKLIST — severity, owner, SLA,
 * remediation, replay — rather than a log.
 *
 * Every field above is required by `IntegrationException` and none of them has
 * a default. That is the design: an exception missing its owner is an exception
 * nobody is going to fix, and a type that filled one in would be manufacturing
 * an assignment nobody made.
 *
 * ── The honest gap, kept visible rather than filled ─────────────────────────
 *
 * `errorClass` is `IntegrationErrorClass | null`, and null is a real answer:
 * `classification: "unclassified"` means WE COULD NOT WORK OUT what the failure
 * was, which is not the same as it being transient. The alternative — defaulting
 * an unrecognised failure into `PERMANENT_PROVIDER` or `TRANSIENT_PROVIDER` —
 * would put an invented word on a real incident and let an operator's filter
 * hide it. An unclassified exception sorts to the TOP of the worklist for the
 * same reason: nobody has looked at it yet.
 *
 * ── No storage ──────────────────────────────────────────────────────────────
 *
 * This derives a worklist from records that already exist; it writes nothing
 * and owns no table. Persisting exceptions in their own right (so that a
 * remediation note, an assignee and a sign-off survive the failure being
 * cleared) needs a model this repository does not have, and inventing one is
 * out of scope. The consequence is stated rather than hidden: an exception here
 * has an owner ROLE and an SLA, and no assignee and no sign-off.
 */

export type ExceptionSeverity = "critical" | "high" | "normal" | "low"

/**
 * Who has to act. A role, not a person: there is no assignment table, and a
 * field called `owner` holding a made-up user id would be worse than a role.
 */
export type ExceptionOwner =
  /** The tenant's own administrators — credentials, consent, configuration. */
  | "tenant-administrator"
  /** Whoever runs the platform — code, mapping, delivery. */
  | "platform-operator"
  /** The individual whose connection it is — reauthorisation. */
  | "connected-person"
  /** Nobody here. The provider must act, and we wait or escalate. */
  | "provider"

export interface ExceptionImpact {
  /** Money may be moved, charged, refunded or mis-stated. */
  financial: boolean
  /** An authority decision — an approval, a role, a delegation — may be wrong. */
  authority: boolean
  /** Tenant data may be missing, stale or duplicated. */
  data: boolean
}

export interface IntegrationException {
  /** Stable within a run; two records for the same failure share it. */
  key: string
  /** Null when the failure could not be classified. See the header. */
  errorClass: IntegrationErrorClass | null
  classification: "derived" | "unclassified"
  severity: ExceptionSeverity
  sourceObject: { type: string; id: string }
  intendedOutcome: string
  currentOutcome: string
  impact: ExceptionImpact
  retry: RetryDisposition
  remediation: string
  owner: ExceptionOwner
  slaMinutes: number
  /** ISO-8601. When the SLA runs out, computed from when it happened. */
  dueAt: string
  breached: boolean
  ageMinutes: number
  evidence: readonly string[]
  relatedRecords: readonly string[]
  /**
   * §16.8 lists "replay" beside severity, owner, SLA and remediation. This is
   * the half that says NO, and it is a field rather than a sentence in
   * `remediation` because a sentence is not something a surface can disable a
   * button on.
   */
  replayable: boolean
  /** Why not, when not. Null when it may be replayed. */
  replayRefusal: string | null
}

/**
 * Whether an exception may be replayed at all.
 *
 * The two dispositions that mean "we do not know what happened" are refused
 * outright: replaying an `UNKNOWN_OUTCOME` is exactly the blind duplicate
 * business action the taxonomy exists to prevent, and a worklist that offered
 * the button anyway would be the place somebody pressed it. `do-not-retry` is
 * refused for the opposite reason — the work is finished, and repeating it
 * duplicates a completed effect.
 *
 * `retry-after-remediation` is ALLOWED, deliberately: the operator reading this
 * row is the person who just did the remediation, and refusing them would mean
 * the only way to recover a fixed credential is a database write.
 */
export function replayDecision(retry: RetryDisposition): {
  replayable: boolean
  replayRefusal: string | null
} {
  if (retry === "reconcile-before-retry") {
    return {
      replayable: false,
      replayRefusal:
        "The outcome of the original attempt is not known. Establish what the provider did before replaying; a replay now may duplicate a business effect.",
    }
  }
  if (retry === "do-not-retry") {
    return {
      replayable: false,
      replayRefusal: "This work is finished. Replaying it would repeat a completed effect.",
    }
  }
  return { replayable: true, replayRefusal: null }
}

/**
 * SLA per severity, in minutes. §16.8 requires an SLA; it does not set one, so
 * these are stated here, once, rather than at each call site where they would
 * quietly diverge.
 */
export const SLA_MINUTES: Record<ExceptionSeverity, number> = {
  critical: 60,
  high: 4 * 60,
  normal: 24 * 60,
  low: 7 * 24 * 60,
}

const SEVERITY_RANK: Record<ExceptionSeverity, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
}

/**
 * Severity from impact and class, never supplied by the caller.
 *
 * §15 is the reason it is derived: "Authority, money, payroll/payment totals,
 * legal hold and required record counts require zero unexplained variance". A
 * caller that could pass `severity: "low"` on a financial exception would be
 * able to hide exactly the class of failure that sentence exists for.
 */
export function severityOf(
  impact: ExceptionImpact,
  errorClass: IntegrationErrorClass | null,
): ExceptionSeverity {
  // §15: money and authority carry a zero-unexplained-variance obligation, so
  // they are critical whatever the class turned out to be.
  if (impact.financial || impact.authority) return "critical"
  // An unclassified non-financial failure still outranks a classified one: it
  // is the one nobody has looked at.
  if (errorClass === null) return "high"
  if (errorClass === "UNKNOWN_OUTCOME" || errorClass === "RECONCILIATION_VARIANCE") return "high"
  if (impact.data) return "high"
  return "normal"
}

const OWNERS: Record<IntegrationErrorClass, ExceptionOwner> = {
  AUTHENTICATION_FAILED: "tenant-administrator",
  AUTHORIZATION_DENIED: "tenant-administrator",
  CONSENT_REVOKED: "connected-person",
  REAUTH_REQUIRED: "connected-person",
  VALIDATION_FAILED: "platform-operator",
  SCHEMA_INCOMPATIBLE: "platform-operator",
  MAPPING_FAILED: "platform-operator",
  REFERENCE_NOT_FOUND: "platform-operator",
  DUPLICATE: "platform-operator",
  CONFLICT: "platform-operator",
  RATE_LIMITED: "platform-operator",
  QUOTA_EXCEEDED: "tenant-administrator",
  TRANSIENT_PROVIDER: "provider",
  PERMANENT_PROVIDER: "provider",
  NETWORK_TIMEOUT: "platform-operator",
  PAYLOAD_TOO_LARGE: "platform-operator",
  MALWARE_OR_POLICY_BLOCK: "tenant-administrator",
  REGION_OR_RESIDENCY_BLOCK: "platform-operator",
  BUSINESS_REJECTED: "tenant-administrator",
  ACKNOWLEDGED_NOT_SETTLED: "provider",
  RECONCILIATION_VARIANCE: "platform-operator",
  UNKNOWN_OUTCOME: "platform-operator",
}

const REMEDIATIONS: Record<IntegrationErrorClass, string> = {
  AUTHENTICATION_FAILED: "Check the credential reference behind this connection and replace it.",
  AUTHORIZATION_DENIED: "The grant does not cover this call. Widen the scope deliberately or stop making it.",
  CONSENT_REVOKED: "Consent was withdrawn. Ask the person to reconnect, or retire the capability.",
  REAUTH_REQUIRED: "Ask the person to reauthorise the connection.",
  VALIDATION_FAILED: "The request we sent was rejected as malformed. Fix the request, then replay.",
  SCHEMA_INCOMPATIBLE: "The provider's schema and ours disagree. Register the new version before replaying.",
  MAPPING_FAILED: "The mapping produced nothing usable. Correct the mapping, then replay from source.",
  REFERENCE_NOT_FOUND: "The object we referenced is gone. Re-resolve it or retire the reference.",
  DUPLICATE: "Already applied. Close this without replay.",
  CONFLICT: "The remote object changed. Re-read it, decide, then write again.",
  RATE_LIMITED: "Pressure, not failure. The scheduler will retry; escalate only if the backlog age grows.",
  QUOTA_EXCEEDED: "The allowance for the period is gone. Raise the limit or wait for the period to roll.",
  TRANSIENT_PROVIDER: "The provider is degraded. Watch the backlog; escalate to the provider if it persists.",
  PERMANENT_PROVIDER: "The provider will not accept this. Escalate to the provider; do not replay.",
  NETWORK_TIMEOUT: "The call did not complete. It is safe to replay.",
  PAYLOAD_TOO_LARGE: "The payload exceeds the provider's limit. Split it or carry a reference instead.",
  MALWARE_OR_POLICY_BLOCK: "Content was blocked by policy. Do not replay; deal with the content.",
  REGION_OR_RESIDENCY_BLOCK: "Refused on residency grounds. Route it in-region or stop routing it.",
  BUSINESS_REJECTED: "The provider understood and refused. This needs a business decision, not a replay.",
  ACKNOWLEDGED_NOT_SETTLED: "Accepted, not finished. Reconcile against the provider before doing anything else.",
  RECONCILIATION_VARIANCE: "Two records disagree. Reconcile them; a replay would not.",
  UNKNOWN_OUTCOME:
    "We do not know whether the provider applied this. Establish what happened against the provider BEFORE any replay.",
}

/** What replaces a string that carried a credential. */
export const REDACTED = "[redacted: credential-shaped value]"

export interface ExceptionInput {
  key: string
  errorClass: IntegrationErrorClass | null
  sourceObject: { type: string; id: string }
  intendedOutcome: string
  currentOutcome: string
  impact: ExceptionImpact
  evidence: readonly string[]
  relatedRecords: readonly string[]
  /** ISO-8601. When the failure happened, not when the worklist was built. */
  occurredAt: string
}

/**
 * Build one exception.
 *
 * `currentOutcome`, `evidence` and `relatedRecords` are the three fields that
 * carry provider text, so all three go through `redactSecretValues` — the same
 * scanner the audit record uses. Redacted rather than refused, deliberately, and
 * that is the opposite of what `outboxEventRow` does with a provider payload:
 * an outbox row is what a consumer is about to ACT on, so a redacted field
 * would make it lie, whereas an exception is evidence for a human and evidence
 * with a field removed is still evidence. The replacement says what was removed.
 */
export function buildIntegrationException(
  input: ExceptionInput,
  now: string,
): IntegrationException {
  const errorClass = input.errorClass
  const severity = severityOf(input.impact, errorClass)
  const slaMinutes = SLA_MINUTES[severity]

  const occurredMs = Date.parse(input.occurredAt)
  if (!Number.isFinite(occurredMs)) {
    throw new TypeError(
      `An exception needs the time the failure happened, not the time the list was built. ` +
        `"${input.occurredAt}" does not parse, and an unparseable timestamp would make the SLA meaningless.`,
    )
  }
  const nowMs = Date.parse(now)
  if (!Number.isFinite(nowMs)) throw new TypeError(`"${now}" is not a timestamp.`)

  const dueMs = occurredMs + slaMinutes * 60_000
  const retry = errorClass === null ? "reconcile-before-retry" : RETRY_DISPOSITION[errorClass]
  const replay = replayDecision(retry)

  return {
    key: input.key,
    errorClass,
    classification: errorClass === null ? "unclassified" : "derived",
    severity,
    sourceObject: input.sourceObject,
    intendedOutcome: input.intendedOutcome,
    currentOutcome: redactSecretValues(input.currentOutcome, REDACTED),
    impact: input.impact,
    retry,
    remediation:
      errorClass === null
        ? "This failure was not recognised by the taxonomy. Read the stored error and classify it before replaying anything."
        : REMEDIATIONS[errorClass],
    owner: errorClass === null ? "platform-operator" : OWNERS[errorClass],
    slaMinutes,
    dueAt: new Date(dueMs).toISOString(),
    breached: nowMs > dueMs,
    // Clamped: a record whose occurredAt is in the future is a clock problem,
    // and a negative age would sort it above a genuinely old exception.
    ageMinutes: Math.max(0, Math.round((nowMs - occurredMs) / 60_000)),
    evidence: redactSecretValues([...input.evidence], REDACTED),
    relatedRecords: redactSecretValues([...input.relatedRecords], REDACTED),
    replayable: replay.replayable,
    replayRefusal: replay.replayRefusal,
  }
}

export interface ExceptionWorklist {
  items: readonly IntegrationException[]
  /** How many have run past their SLA. */
  breached: number
  /** How many nobody could classify — the number that must not be zero by accident. */
  unclassified: number
  bySeverity: Record<ExceptionSeverity, number>
  /** How many need a human to establish an outcome before anything is repeated. */
  needingReconciliation: number
}

/**
 * Order the worklist.
 *
 * Breached first, then severity, then oldest — and NOT by "most recent", which
 * is what a log would do. A worklist ordered by recency buries the item that
 * has been failing for three days under the one that failed a minute ago, which
 * is precisely the item an SLA exists to surface.
 */
export function orderExceptions(
  items: readonly IntegrationException[],
): readonly IntegrationException[] {
  return [...items].sort((a, b) => {
    if (a.breached !== b.breached) return a.breached ? -1 : 1
    if (a.severity !== b.severity) return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (a.ageMinutes !== b.ageMinutes) return b.ageMinutes - a.ageMinutes
    return a.key.localeCompare(b.key)
  })
}

export function summariseWorklist(items: readonly IntegrationException[]): ExceptionWorklist {
  const ordered = orderExceptions(items)
  const bySeverity: Record<ExceptionSeverity, number> = { critical: 0, high: 0, normal: 0, low: 0 }
  for (const item of ordered) bySeverity[item.severity] += 1

  return {
    items: ordered,
    breached: ordered.filter((i) => i.breached).length,
    unclassified: ordered.filter((i) => i.classification === "unclassified").length,
    bySeverity,
    needingReconciliation: ordered.filter((i) => i.retry === "reconcile-before-retry").length,
  }
}

// ── Deriving the worklist from what actually failed ─────────────────────────

/**
 * A delivery that stopped being retried. The shape of an `OutboxEvent` row in
 * `state = 'dead'`, reduced to what an exception needs.
 *
 * Read through a port rather than Prisma directly, for the same reason
 * `outbox.ts` does it: the rules below have to be testable against the records
 * that go wrong, and a rule that needs a database to exercise is a rule nobody
 * exercises.
 */
export interface DeadDelivery {
  outboxId: string
  eventType: string
  resourceType: string
  resourceId: string
  attempts: number
  /** What the last attempt said. May be provider text. */
  lastError: string | null
  /** ISO-8601. */
  deadLetteredAt: string
  correlationId: string
}

export interface DeadDeliveryPorts {
  /** Dead-lettered deliveries for ONE tenant, newest first. */
  deadDeliveries(limit: number): Promise<readonly DeadDelivery[]>
}

/**
 * Classify a stored delivery error.
 *
 * This is deliberately conservative. `lastError` is free text written by
 * whatever threw — our own contract checker, a fetch, a provider SDK — so the
 * only classes derived here are the ones a phrase can establish beyond doubt.
 * Everything else returns null, and null travels all the way to the operator as
 * `classification: "unclassified"`.
 *
 * The temptation is to add a fallback so the field is never null. That fallback
 * is the defect: it converts "nobody has worked out what this is" into a
 * confident word, and the confident word is what an operator filters on.
 */
export function classifyDeliveryError(lastError: string | null): IntegrationErrorClass | null {
  if (lastError === null) return null
  const text = lastError.toLowerCase()

  // Written by `dispatchOnce` itself, verbatim, when an event stops satisfying
  // the contract. Ours, so it can be matched with confidence.
  if (text.includes("does not satisfy the domainevent contract")) return "SCHEMA_INCOMPATIBLE"
  if (text.includes("no consumer") || text.includes("unregistered consumer")) return "REFERENCE_NOT_FOUND"
  return null
}

/**
 * The impact of a failed delivery, from the event type it carried.
 *
 * Prefix matching on a type that is a dotted namespace this platform owns —
 * not a fuzzy match on prose. A type nobody listed is `data: true` and nothing
 * else, which is the conservative direction: it can raise severity later when
 * somebody classifies it, and it never silently downgrades money.
 */
export function impactOfEventType(eventType: string): ExceptionImpact {
  const type = eventType.toLowerCase()
  const financial =
    type.startsWith("payment.") ||
    type.startsWith("ledger.") ||
    type.startsWith("settlement.") ||
    type.startsWith("transaction.")
  const authority =
    type.startsWith("approval.") ||
    type.startsWith("role.") ||
    type.startsWith("delegation.") ||
    type.startsWith("seat.")
  return { financial, authority, data: !financial && !authority }
}

/**
 * Derive the worklist for one tenant from its dead-lettered deliveries.
 *
 * Nothing is invented: every item names a real `OutboxEvent` id, and the count
 * of items equals the count of dead rows the port returned. A worklist that
 * reported fewer would be hiding one, and one that reported more would be
 * making them up.
 */
export async function deadDeliveryExceptions(
  ports: DeadDeliveryPorts,
  options: { now: string; limit?: number },
): Promise<ExceptionWorklist> {
  const limit = options.limit ?? 100
  const dead = await ports.deadDeliveries(limit)

  const items = dead.map((record) => {
    const errorClass = classifyDeliveryError(record.lastError)
    return buildIntegrationException(
      {
        key: `outbox:${record.outboxId}`,
        errorClass,
        sourceObject: { type: record.resourceType, id: record.resourceId },
        intendedOutcome: `deliver ${record.eventType} to its registered consumers`,
        currentOutcome:
          record.lastError === null
            ? `delivery stopped after ${record.attempts} attempts and the record carries no error`
            : `delivery stopped after ${record.attempts} attempts: ${record.lastError}`,
        impact: impactOfEventType(record.eventType),
        evidence: [`OutboxEvent:${record.outboxId}`, `correlationId:${record.correlationId}`],
        relatedRecords: [`${record.resourceType}:${record.resourceId}`],
        occurredAt: record.deadLetteredAt,
      },
      options.now,
    )
  })

  return summariseWorklist(items)
}
