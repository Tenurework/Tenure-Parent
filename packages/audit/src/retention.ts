/**
 * What may be deleted from the audit trail, and what may never be.
 *
 * An append-only log that is never pruned is a liability: every record is a
 * disclosure obligation and a subject-access-request cost, and a retention
 * schedule that exists only in a policy document is not a schedule. But
 * deletion is the one operation an audit trail must be careful about, so this
 * plans it rather than performing it, and three rules constrain the plan.
 *
 * **A legal hold always wins.** A record matched by an active hold is never in
 * `expire`, no matter how far past retention it is. That is the entire point of
 * a hold: preservation that survives the routine process which would otherwise
 * destroy the evidence. It is expressed here as a filter applied *after*
 * expiry, and it is the one behaviour worth breaking a build over.
 *
 * **Only a prefix of a chain may go.** Deleting record 5 of a chain leaves 4
 * and 6 unlinked — indistinguishable, to `verifyChain`, from someone removing
 * the record that mattered. So expiry stops at the first record that must be
 * kept, and everything after it in that tenant's chain is `chainBlocked`:
 * eligible on age, retained because destroying it would destroy the proof that
 * the rest is intact.
 *
 * **What was destroyed is still provable.** Each tenant's plan carries an
 * anchor — the sequence and hash of the last record expired. Keep it, and a
 * chain that now starts at 41 can still be shown to continue the one that
 * ended at 40, rather than looking like 40 records were quietly removed.
 */

import type { AuditRecord } from "./record"

export class RetentionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RetentionError"
  }
}

/**
 * A preservation order over some slice of one tenant's audit trail.
 *
 * Every scope field is an AND. An omitted field does not constrain — a hold
 * with an empty scope covers the whole tenant, which is what a litigation hold
 * usually is.
 */
export interface LegalHold {
  id: string
  /** Holds are per-tenant. A hold that silently froze every institution would be a worse bug than a loud refusal. */
  tenantId: string
  /** Why. A hold nobody can explain cannot be released with confidence either. */
  reason: string
  placedAt: string
  /** Null or absent while the hold is in force. */
  releasedAt?: string | null
  scope?: {
    organizationId?: string
    actorId?: string
    /** Exact action, or a prefix when it ends in `.` — e.g. `Admin.` covers every admin action. */
    action?: string
    resourceType?: string
    resourceId?: string
    /** Only records at or after this instant. */
    from?: string
    /** Only records at or before this instant. */
    to?: string
  }
}

export interface RetentionPolicy {
  /** How long a record must be kept from `occurredAt`. */
  retainDays: number
  /** The instant the plan is computed for. Explicit so a plan is reproducible. */
  asOf: string
}

export interface HeldRecord {
  record: AuditRecord
  /** Every active hold that matched. Plural: releasing one does not free the record. */
  holds: readonly string[]
}

/** Where a chain may be cut without making the remainder unverifiable. */
export interface RetentionAnchor {
  tenantId: string
  /** The highest sequence being expired. */
  throughSequence: number
  /** That record's hash — kept so the surviving chain still has a predecessor to link to. */
  anchorHash: string
}

/**
 * A partition of the input. Every record appears in exactly one bucket, so a
 * caller can assert the plan accounts for everything it was given.
 */
export interface RetentionPlan {
  /** Past retention, unheld, and safe to cut. */
  expire: readonly AuditRecord[]
  /** Still within the retention window. */
  retain: readonly AuditRecord[]
  /** Past retention but preserved by an active legal hold. */
  heldBack: readonly HeldRecord[]
  /** Past retention and unheld, but deleting them would break a chain. */
  chainBlocked: readonly AuditRecord[]
  anchors: readonly RetentionAnchor[]
}

const parseInstant = (value: string, what: string): number => {
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) throw new RetentionError(`${what} must be an ISO timestamp, got ${JSON.stringify(value)}.`)
  return ms
}

const DAY_MS = 86_400_000

/** In force at `asOf`: placed on or before it, and not yet released. */
function isActive(hold: LegalHold, asOfMs: number): boolean {
  if (parseInstant(hold.placedAt, `legal hold ${hold.id} placedAt`) > asOfMs) return false
  if (hold.releasedAt == null) return true
  return parseInstant(hold.releasedAt, `legal hold ${hold.id} releasedAt`) > asOfMs
}

function matches(hold: LegalHold, record: AuditRecord): boolean {
  if (hold.tenantId !== record.tenantId) return false
  const scope = hold.scope
  if (!scope) return true

  if (scope.organizationId != null && scope.organizationId !== record.organizationId) return false
  if (scope.actorId != null && scope.actorId !== record.actorId) return false
  if (scope.resourceType != null && scope.resourceType !== record.resourceType) return false
  if (scope.resourceId != null && scope.resourceId !== record.resourceId) return false
  if (scope.action != null) {
    const ok = scope.action.endsWith(".")
      ? record.action.startsWith(scope.action)
      : record.action === scope.action
    if (!ok) return false
  }

  const at = Date.parse(record.occurredAt)
  if (scope.from != null && at < parseInstant(scope.from, `legal hold ${hold.id} scope.from`)) return false
  if (scope.to != null && at > parseInstant(scope.to, `legal hold ${hold.id} scope.to`)) return false
  return true
}

function validateHold(hold: LegalHold): void {
  if (!hold.id) throw new RetentionError("A legal hold must have an id; an anonymous hold cannot be released.")
  if (!hold.tenantId) {
    throw new RetentionError(
      `Legal hold ${hold.id} names no tenant. Holds are per-tenant — an unscoped one would freeze every institution's trail without saying so.`,
    )
  }
  if (!hold.reason?.trim()) throw new RetentionError(`Legal hold ${hold.id} must say why it exists.`)
  const placed = parseInstant(hold.placedAt, `legal hold ${hold.id} placedAt`)
  if (hold.releasedAt != null) {
    const released = parseInstant(hold.releasedAt, `legal hold ${hold.id} releasedAt`)
    if (released < placed) {
      throw new RetentionError(`Legal hold ${hold.id} was released before it was placed.`)
    }
  }
}

/**
 * Plan — never perform — the expiry of a set of audit records.
 *
 * Returns a partition of the input plus the anchors an operator must keep. The
 * caller does the deleting, because the caller is the one that can do it inside
 * a transaction with the anchor write.
 */
export function applyRetention(
  records: readonly AuditRecord[],
  policy: RetentionPolicy,
  holds: readonly LegalHold[] = [],
): RetentionPlan {
  if (!Number.isInteger(policy.retainDays) || policy.retainDays < 0) {
    throw new RetentionError(
      `retainDays must be a non-negative whole number of days, got ${JSON.stringify(policy.retainDays)}.`,
    )
  }
  const asOfMs = parseInstant(policy.asOf, "asOf")
  for (const hold of holds) validateHold(hold)
  const active = holds.filter((h) => isActive(h, asOfMs))

  const cutoffFor = (record: AuditRecord): boolean => {
    const at = Date.parse(record.occurredAt)
    if (Number.isNaN(at)) {
      throw new RetentionError(
        `Record ${record.recordHash} has an unparseable occurredAt (${JSON.stringify(record.occurredAt)}); refusing to guess its age.`,
      )
    }
    return at + policy.retainDays * DAY_MS <= asOfMs
  }

  const holdsOn = (record: AuditRecord): string[] =>
    active.filter((h) => matches(h, record)).map((h) => h.id)

  const expire: AuditRecord[] = []
  const retain: AuditRecord[] = []
  const heldBack: HeldRecord[] = []
  const chainBlocked: AuditRecord[] = []
  const anchors: RetentionAnchor[] = []

  // Unchained records have no neighbour to orphan, so each stands alone.
  for (const record of records) {
    if (record.sequence !== null) continue
    const matched = holdsOn(record)
    if (!cutoffFor(record)) retain.push(record)
    else if (matched.length > 0) heldBack.push({ record, holds: matched })
    else expire.push(record)
  }

  const byTenant = new Map<string, AuditRecord[]>()
  for (const record of records) {
    if (record.sequence === null) continue
    const list = byTenant.get(record.tenantId)
    if (list) list.push(record)
    else byTenant.set(record.tenantId, [record])
  }

  for (const [tenantId, list] of byTenant) {
    const sorted = [...list].sort((a, b) => (a.sequence as number) - (b.sequence as number))
    let cutting = true
    let anchor: AuditRecord | null = null

    for (const record of sorted) {
      const matched = holdsOn(record)
      const expired = cutoffFor(record)

      if (!expired) {
        cutting = false
        retain.push(record)
        continue
      }
      if (matched.length > 0) {
        // A hold stops the cut here as well as preserving this record: anything
        // after it would be orphaned by a deletion it is not allowed to have.
        cutting = false
        heldBack.push({ record, holds: matched })
        continue
      }
      if (!cutting) {
        chainBlocked.push(record)
        continue
      }
      expire.push(record)
      anchor = record
    }

    if (anchor) {
      anchors.push({
        tenantId,
        throughSequence: anchor.sequence as number,
        anchorHash: anchor.recordHash,
      })
    }
  }

  return { expire, retain, heldBack, chainBlocked, anchors }
}
