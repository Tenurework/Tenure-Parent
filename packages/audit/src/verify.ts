/**
 * Reading an audit log back: is it intact, and what may this reader see?
 *
 * `buildAuditRecord` makes a write hard to get wrong. It does nothing for the
 * read, and the read is where an audit trail earns its name. "Append-only" as
 * implemented is a statement about a table's grants; it is not something anyone
 * can check afterwards. An UPDATE that softens a reason, or a DELETE that
 * removes the single denial an investigation was about, leaves a log that reads
 * perfectly — 200 rows, ordered, plausible.
 *
 * Two questions this answers that a `findMany` cannot:
 *
 *   1. Was a record's content changed after it was written? Its `recordHash`
 *      no longer matches a recomputation. (`CONTENT_ALTERED`)
 *   2. Was a record removed, or re-pointed at a different predecessor? Its
 *      neighbour's `previousHash` no longer matches, and the per-tenant
 *      sequence skips. (`BROKEN_LINK` plus a gap.)
 *
 * The second is the one a per-row hash alone cannot answer, and it is the whole
 * reason records are chained: an attacker who can edit a row can usually also
 * recompute that row's own hash. What they cannot do without rewriting every
 * later row is keep the chain consistent.
 *
 * `projectForQuery` is the other half. An export is a copy of the audit trail
 * leaving the system, and the write-time redaction it inherited was correct on
 * the day it was written. Re-applying the redactor on read means a key added to
 * the denylist since — a new token field, a new identifier — is redacted in the
 * export even though it was stored in full.
 */

import {
  hashRecord,
  redactMetadata,
  type AuditOutcome,
  type AuditRecord,
  type FieldSensitivity,
} from "./record"

/** A record whose content or whose link to its predecessor does not hold up. */
export interface ChainBreak {
  tenantId: string
  sequence: number | null
  /** What the record says its hash is. */
  recordHash: string
  expectedHash: string
  actualHash: string
  reason: "CONTENT_ALTERED" | "BROKEN_LINK"
  detail: string
}

/** A run of sequence numbers this tenant's chain never accounts for. */
export interface ChainGap {
  tenantId: string
  after: number
  before: number
  missing: number
}

/** Two records claiming the same position: one of them is a rewrite. */
export interface ChainDuplicate {
  tenantId: string
  sequence: number
  count: number
}

export interface ChainVerification {
  /** No altered content, no broken link, no gap, no duplicate position. */
  ok: boolean
  /** Records examined. */
  checked: number
  /**
   * Records with no chain position. Their content is still hash-checked, but
   * nothing proves a neighbour was not deleted — so a non-zero count here is
   * the honest measure of how much of the log is *not* covered by the chain.
   */
  unchained: number
  tenants: string[]
  /**
   * Lowest sequence seen per tenant. A chain that starts above 0 has been
   * truncated — legitimately by retention, or otherwise. The array alone cannot
   * tell which, so this is reported rather than judged.
   */
  firstSequence: Record<string, number>
  tampered: ChainBreak[]
  gaps: ChainGap[]
  duplicates: ChainDuplicate[]
}

/**
 * Verify a set of audit records as one or more per-tenant chains.
 *
 * Accepts records in any order and from any number of tenants: a database read
 * comes back newest-first, and chains are per-tenant because sequence numbers
 * are. Sorting is done here so a caller cannot get it wrong.
 */
export function verifyChain(records: readonly AuditRecord[]): ChainVerification {
  const tampered: ChainBreak[] = []
  const gaps: ChainGap[] = []
  const duplicates: ChainDuplicate[] = []

  // Content integrity applies to every record, chained or not. Checked first so
  // an altered record is named even when it also breaks a link.
  for (const record of records) {
    const actual = hashRecord(record)
    if (actual !== record.recordHash) {
      tampered.push({
        tenantId: record.tenantId,
        sequence: record.sequence,
        recordHash: record.recordHash,
        expectedHash: record.recordHash,
        actualHash: actual,
        reason: "CONTENT_ALTERED",
        detail: `${record.action} on ${record.resourceType} at ${record.occurredAt} does not hash to its recorded hash.`,
      })
    }
  }

  const byTenant = new Map<string, AuditRecord[]>()
  let unchained = 0
  for (const record of records) {
    if (record.sequence === null) {
      unchained++
      continue
    }
    const list = byTenant.get(record.tenantId)
    if (list) list.push(record)
    else byTenant.set(record.tenantId, [record])
  }

  const firstSequence: Record<string, number> = {}

  for (const [tenantId, list] of byTenant) {
    const sorted = [...list].sort((a, b) => (a.sequence as number) - (b.sequence as number))
    firstSequence[tenantId] = sorted[0].sequence as number

    const seen = new Map<number, number>()
    for (const record of sorted) {
      const seq = record.sequence as number
      seen.set(seq, (seen.get(seq) ?? 0) + 1)
    }
    for (const [sequence, count] of seen) {
      if (count > 1) duplicates.push({ tenantId, sequence, count })
    }

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]
      const cur = sorted[i]
      const step = (cur.sequence as number) - (prev.sequence as number)

      // Two records at the same position: reported as a duplicate above, and
      // the link check is meaningless between them.
      if (step === 0) continue

      if (step > 1) {
        gaps.push({
          tenantId,
          after: prev.sequence as number,
          before: cur.sequence as number,
          missing: step - 1,
        })
      }

      if (cur.previousHash !== prev.recordHash) {
        tampered.push({
          tenantId,
          sequence: cur.sequence,
          recordHash: cur.recordHash,
          expectedHash: prev.recordHash,
          actualHash: cur.previousHash ?? "(none)",
          reason: "BROKEN_LINK",
          detail:
            step > 1
              ? `record ${cur.sequence} follows ${prev.sequence} in this set but does not link to it — ${step - 1} record(s) are missing between them.`
              : `record ${cur.sequence} does not link to record ${prev.sequence}.`,
        })
      }
    }
  }

  return {
    ok: tampered.length === 0 && gaps.length === 0 && duplicates.length === 0,
    checked: records.length,
    unchained,
    tenants: [...byTenant.keys()].sort(),
    firstSequence,
    tampered,
    gaps,
    duplicates,
  }
}

/**
 * One audit record as it may leave the system.
 *
 * Fields the reader is not cleared for are `null`, and named in `withheld` — a
 * silently absent field reads as "this did not happen", which is a worse lie
 * than "you may not see this".
 */
export interface AuditProjection {
  tenantId: string
  organizationId: string | null
  sequence: number | null
  previousHash: string | null
  recordHash: string
  actorId: string | null
  actorRole: string | null
  impersonatedBy: string | null
  action: string
  resourceType: string
  resourceId: string | null
  outcome: AuditOutcome
  reason: string | null
  traceId: string | null
  occurredAt: string
  metadata: Readonly<Record<string, unknown>>
  withheld: readonly string[]
}

/**
 * How much damage each part of a record does if disclosed.
 *
 * The chain fields are `public` deliberately: an export handed to someone with
 * low clearance still carries the hashes, so a holder of the full records can
 * confirm the export describes the same events. (It cannot be re-verified from
 * its own contents — redaction changes them. That is the trade, stated rather
 * than hidden.)
 */
const FIELD_SENSITIVITY = {
  tenantId: "public",
  action: "public",
  resourceType: "public",
  outcome: "public",
  occurredAt: "public",
  sequence: "public",
  previousHash: "public",
  recordHash: "public",
  organizationId: "internal",
  resourceId: "internal",
  actorRole: "internal",
  traceId: "internal",
  actorId: "confidential",
  reason: "confidential",
  impersonatedBy: "secret",
  metadata: "secret",
} as const satisfies Record<string, FieldSensitivity>

const RANK: Record<FieldSensitivity, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  secret: 3,
}

export interface ProjectionOptions {
  /**
   * The highest sensitivity this reader is cleared for. Defaults to `internal`:
   * an export whose clearance was forgotten should be too quiet, not too loud.
   */
  sensitivity?: FieldSensitivity
  /** Metadata keys this particular export must not carry, on top of the standing denylist. */
  redactKeys?: readonly string[]
}

/**
 * Project records for a query or an export at a stated clearance.
 *
 * Metadata that survives is passed through `redactMetadata` again. The write
 * already redacted it, and running the redactor twice is idempotent — the point
 * is that the denylist grows: a key that became sensitive after a record was
 * written is redacted in the export anyway.
 */
export function projectForQuery(
  records: readonly AuditRecord[],
  options: ProjectionOptions = {},
): AuditProjection[] {
  const clearance = RANK[options.sensitivity ?? "internal"]
  const visible = (field: keyof typeof FIELD_SENSITIVITY): boolean =>
    RANK[FIELD_SENSITIVITY[field]] <= clearance

  // One frozen array shared by every projection: it is the same list for all of
  // them, and a shared mutable array is a way for one caller to edit another's.
  const withheld = Object.freeze(
    (Object.keys(FIELD_SENSITIVITY) as (keyof typeof FIELD_SENSITIVITY)[])
      .filter((f) => !visible(f))
      .sort(),
  )

  return records.map((record) => ({
    tenantId: record.tenantId,
    action: record.action,
    resourceType: record.resourceType,
    outcome: record.outcome,
    occurredAt: record.occurredAt,
    sequence: record.sequence,
    previousHash: record.previousHash,
    recordHash: record.recordHash,
    organizationId: visible("organizationId") ? record.organizationId : null,
    resourceId: visible("resourceId") ? record.resourceId : null,
    actorRole: visible("actorRole") ? record.actorRole : null,
    traceId: visible("traceId") ? record.traceId : null,
    actorId: visible("actorId") ? record.actorId : null,
    reason: visible("reason") ? record.reason : null,
    impersonatedBy: visible("impersonatedBy") ? record.impersonatedBy : null,
    metadata: visible("metadata")
      ? Object.freeze(redactMetadata(record.metadata, options.redactKeys))
      : Object.freeze({}),
    withheld,
  }))
}
