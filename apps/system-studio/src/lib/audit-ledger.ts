import "server-only"

import {
  applyRetention,
  buildAuditRecord,
  redactSecretValues,
  safeLogText,
  verifyChain,
  REDACTED,
  type AuditOutcome,
  type AuditRecord,
  type ChainVerification,
  type LegalHold,
  type RetentionPlan,
} from "@tenure/audit"

// Relative, not `@/lib/registry`. The `@/` alias is a Next.js path mapping;
// this module is also exercised by `audit-ledger.itest.ts` under apps/web's
// jest, where `@/` resolves into the CELL's source tree — so the alias would
// silently point at a module that does not exist there.
import {
  AUDIT_HOLD_PREFIX,
  AUDIT_HOLD_RELEASE_PREFIX,
  AUDIT_SEQUENCE_PREFIX,
  AuditSequenceTaken,
  putAuditHold,
  putAuditRow,
  queryAuditRows,
  releaseAuditHold,
} from "./registry"

/**
 * STUDIO-110-005 / STUDIO-060-010 — the Studio's audit ledger.
 *
 * ## Why this exists at all
 *
 * Before it, the operator console wrote no audit row of any kind. Composing a
 * tenant, adopting one, advancing a lifecycle state, publishing a configuration
 * revision and every refusal of those happened with nothing recorded but the
 * lifecycle's own STEP# rows — which carry from/to/at/actor/reason/attempt and
 * no outcome, no ALLOW/DENY, no redaction and no hash. A history is not an audit
 * trail: it records what succeeded, in a table that could be rewritten, and says
 * nothing about what was refused.
 *
 * ## Why it is not `recordAuditEvent`
 *
 * `apps/web/src/lib/audit-record.ts` is the cell's writer and it is Prisma-bound.
 * `tests/security/operator-plane-content.test.mjs` refuses any Prisma import
 * under `apps/system-studio/src`, and it is right to: the console shows every
 * tenant's configuration, and one import would put every business table one call
 * away from a page about fleet health. So this is a SECOND implementation over a
 * different store — `@tenure/audit` builds, hashes and verifies the record,
 * DynamoDB holds it — rather than a second definition of what an audit record
 * is. There is exactly one definition of that, and it is in the package.
 *
 * ## What makes the chain worth having
 *
 * Every record carries `recordHash` over its own content and `previousHash`
 * pointing at the record before it, both computed by `buildAuditRecord`. That
 * turns two questions a `findMany` cannot answer into ones anybody can check:
 * was a row's content changed after it was written, and was a row removed. The
 * link is only meaningful because `putAuditRow` writes with
 * `attribute_not_exists(sk)` — without that condition two writers claim the same
 * sequence, the loser's act disappears, and the chain still verifies perfectly.
 *
 * The storage is protected to match: the Studio's IAM policy DENIES
 * `dynamodb:UpdateItem` and `dynamodb:DeleteItem` on every item whose partition
 * key begins `AUDIT#` (infrastructure/studio/dynamodb.tf), so a row written here
 * cannot be rewritten in place by the process that wrote it.
 *
 * ## Intent, then act, then outcome
 *
 * `appendIntent` is called BEFORE a mutating call and `appendOutcome` after.
 * That ordering is the whole value: a process that dies mid-flight leaves an
 * intent with no outcome — a durable "somebody started this and we cannot say
 * how it ended" — where an outcome-only trail leaves silence, which is
 * indistinguishable from nothing having been attempted.
 */

/** Estate-wide acts belong to no tenant. They get their own chain. */
export const PLATFORM_PARTITION = "PLATFORM"

/**
 * The ledger could not be written, so the act must not happen.
 *
 * A distinct type because callers fail CLOSED on it and say so to the operator
 * — "this could not be recorded, so it was not done" is a different sentence
 * from a stack trace, and it is the only honest one.
 */
export class AuditUnavailable extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = "AuditUnavailable"
  }
}

/**
 * How long a record must be kept before retention may plan its expiry.
 *
 * Seven years by default: the audit trail of a control plane that provisions
 * systems holding student records is read by the same people who read those
 * records, and the schedules they sit under are measured in years. Overridable
 * because a retention period is a policy decision rather than a property of the
 * code — but validated, because a policy expressed as an unparseable string is a
 * policy nobody is following.
 */
export function retentionDays(): number {
  const raw = process.env.AUDIT_RETENTION_DAYS
  if (!raw) return 2555
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `AUDIT_RETENTION_DAYS must be a whole number of days, got ${JSON.stringify(raw)}. ` +
        "Refusing to guess: a retention window read wrong is either a plan to destroy evidence " +
        "early or a plan that never expires anything.",
    )
  }
  return parsed
}

/**
 * An error message safe to store in a table that cannot be rewritten.
 *
 * `safeLogText` from the audit package does the flattening and the VALUE scan —
 * reused rather than reimplemented, because it already carries the lesson a
 * second implementation would have to relearn: an `Error`'s `message` and
 * `stack` are not own enumerable properties, so walking one as an object
 * returns `{}` and discards the entire error.
 *
 * Truncated on top of that, because an exception with a stack in it is a row
 * nobody reads and this row cannot be shortened later.
 */
export function safeErrorOf(err: unknown): string {
  return safeLogText(err).slice(0, 300)
}

/* ────────────────────────────────────────────── the record-level ledger ── */

export interface StudioAuditInput {
  /** The tenant this concerns, or `PLATFORM_PARTITION` for estate-wide acts. */
  tenantId: string
  actor: { principalId: string; role?: string; impersonatedBy?: string }
  /** `Resource.Action` — e.g. `tenant.compose`, `configuration.publish`. */
  action: string
  resourceType: string
  resourceId?: string
  outcome: AuditOutcome
  reason?: string
  metadata?: Readonly<Record<string, unknown>>
  /** Metadata keys whose values must never be stored in full, beyond the standing denylist. */
  sensitiveKeys?: readonly string[]
  /**
   * One id shared by every record produced by one operator act.
   *
   * Required, not optional. A row that cannot be tied to the request that
   * produced it cannot be read alongside the intent that preceded it, which is
   * the only way to tell "started and failed" from "never attempted".
   */
  correlationId: string
  occurredAt: string
}

/** How many times to re-read the tail when another writer takes the position first. */
const APPEND_ATTEMPTS = 6

export interface StudioAuditLedger {
  /** Append one record to a partition's chain. Returns what was written. */
  append(input: StudioAuditInput): Promise<AuditRecord>
  /** Every record in a partition's chain, oldest first. */
  read(partition: string): Promise<AuditRecord[]>
  /** Whether that chain is intact: altered content, broken links, gaps, duplicates. */
  verify(partition: string): Promise<ChainVerification>
  /** Every legal hold on a partition, placements folded with their releases. */
  holds(partition: string): Promise<LegalHold[]>
  /** Place a preservation order. */
  placeHold(hold: LegalHold): Promise<void>
  /** Lift one, by writing a release rather than rewriting the placement. */
  releaseHold(partition: string, holdId: string, releasedAt: string, by: string): Promise<void>
  /** What retention WOULD expire, given the holds actually on record. Planned, never performed. */
  plan(partition: string, asOf: string): Promise<RetentionPlan>
}

/**
 * Rehydrate a stored row.
 *
 * Cast rather than re-validated, deliberately: `verifyChain` recomputes the hash
 * over exactly these fields, so a row that came back altered is reported as
 * `CONTENT_ALTERED` rather than quietly repaired here. A reader that "fixed" a
 * malformed record would be a reader that hides tampering.
 */
function recordFrom(row: Record<string, unknown>): AuditRecord {
  return row.record as AuditRecord
}

export function dynamoAuditLedger(): StudioAuditLedger {
  const readRecords = async (partition: string): Promise<AuditRecord[]> =>
    (await queryAuditRows(partition, AUDIT_SEQUENCE_PREFIX)).map(recordFrom)

  /**
   * Placements folded with their releases.
   *
   * A local rather than a method, because `plan` needs it too and a method
   * calling itself through `this` inside an object literal is one refactor away
   * from a wrong binding.
   */
  const holdsOf = async (partition: string): Promise<LegalHold[]> => {
    const placed = await queryAuditRows(partition, AUDIT_HOLD_PREFIX)
    const released = new Map<string, string>()
    for (const row of await queryAuditRows(partition, AUDIT_HOLD_RELEASE_PREFIX)) {
      const release = row.release as { holdId?: string; releasedAt?: string }
      if (release?.holdId && release.releasedAt) released.set(release.holdId, release.releasedAt)
    }

    return placed.map((row) => {
      const hold = row.hold as LegalHold
      const releasedAt = released.get(hold.id)
      return releasedAt ? { ...hold, releasedAt } : hold
    })
  }

  const tail = async (partition: string): Promise<AuditRecord | null> => {
    const rows = await queryAuditRows(partition, AUDIT_SEQUENCE_PREFIX, {
      newestFirst: true,
      limit: 1,
    })
    return rows.length > 0 ? recordFrom(rows[0]) : null
  }

  return {
    async append(input) {
      const partition = input.tenantId

      for (let attempt = 0; attempt < APPEND_ATTEMPTS; attempt++) {
        const previous = await tail(partition)

        /**
         * `previous` rather than a hand-computed sequence, on purpose.
         *
         * `buildAuditRecord` refuses to extend a record whose content no longer
         * hashes to its own recorded hash — so a tampered chain STOPS GROWING at
         * the tamper instead of burying it under a valid-looking suffix. Passing
         * `sequence` and `previousHash` separately would skip that check.
         */
        const record = buildAuditRecord({
          tenantId: input.tenantId,
          actor: input.actor,
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          outcome: input.outcome,
          reason: input.reason,
          metadata: input.metadata,
          sensitiveKeys: input.sensitiveKeys,
          traceId: input.correlationId,
          occurredAt: input.occurredAt,
          ...(previous
            ? { previous }
            : // The head of a chain: position 0, with nothing before it.
              { sequence: 0, previousHash: null }),
        })

        try {
          await putAuditRow(partition, record.sequence as number, {
            partition,
            sequence: record.sequence,
            record,
          })
          return record
        } catch (err) {
          // Another writer took this position between the read and the write.
          // Re-read the tail and chain onto what is actually there — the only
          // correct response, and the reason the condition exists.
          if (err instanceof AuditSequenceTaken) continue
          throw err
        }
      }

      throw new AuditUnavailable(
        `Could not append to the ${partition} audit chain after ${APPEND_ATTEMPTS} attempts — ` +
          "another writer claimed the position every time. The act must not proceed unrecorded.",
      )
    },

    read: readRecords,

    async verify(partition) {
      return verifyChain(await readRecords(partition))
    },

    holds: holdsOf,

    async placeHold(hold) {
      await putAuditHold(hold.tenantId, hold.id, hold as unknown as Record<string, unknown>)
    },

    async releaseHold(partition, holdId, releasedAt, by) {
      await releaseAuditHold(partition, holdId, { holdId, releasedAt, releasedBy: by })
    },

    async plan(partition, asOf) {
      const [records, holds] = await Promise.all([readRecords(partition), holdsOf(partition)])
      /**
       * The holds are passed EXPLICITLY, read from storage.
       *
       * `applyRetention`'s hold argument defaults to empty, and a caller that
       * took the default would produce a plan that expires records under an
       * active preservation order — a plan that looks correct and destroys the
       * evidence a hold exists to keep.
       */
      return applyRetention(records, { retainDays: retentionDays(), asOf }, holds)
    },
  }
}

/** One instance. The registry behind it holds the only DynamoDB client there is. */
const ledger = dynamoAuditLedger()

/* ─────────────────────────────────────────── the attempt-level ledger ── */

/**
 * One attempted act, as the console renders it.
 *
 * This is the projection the tenant page and the operator-facing pages read.
 * `digest` and `previousDigest` are the chain, unchanged — `recordHash` and
 * `previousHash` from `@tenure/audit` — so what is drawn on the page is the
 * thing `verifyChain` checks, not a second hash computed for display.
 */
export interface AuditRow {
  /** Position in this subject's chain. */
  seq: number
  at: string
  action: string
  target: string
  actor: string
  detail: string
  /** The outcome CODE, or null while the attempt is still open. */
  outcome: string | null
  /** The `seq` of the intent this row closes, on an outcome row. */
  resolves: number | null
  digest: string
  previousDigest: string | null
}

/**
 * Where `appendIntent` and `appendOutcome` PUT the projection's fields. One
 * convention out; see `ROW_KEY_ALIASES` for what comes back in.
 */
const ROW_KEYS = {
  target: "_target",
  detail: "_detail",
  outcome: "_outcomeCode",
  resolves: "_resolves",
  phase: "_phase",
} as const

/**
 * Every spelling of each field, in the order the reader tries them.
 *
 * TWO writers put records into this chain and they do not agree on the names.
 * `appendIntent`/`appendOutcome` here write the underscored ones. `advanceState`
 * in `app/tenants/actions.ts` — the lifecycle writer, and the one that records
 * every high-risk refusal — calls `ledger.append` directly and writes the bare
 * ones: `phase`, `code`, `target`, `intentSequence`. Both are production
 * writers, so a reader that knows only one convention silently drops half of
 * what the ledger means.
 *
 * It dropped exactly that. Reading `_outcomeCode` alone, every lifecycle row
 * fell through to the record-level ALLOW/DENY, so `REFUSED_CONFIRMATION`,
 * `REFUSED_STALE_CONSEQUENCE` and `REFUSED_IRREVERSIBLE` all rendered as an
 * undifferentiated "DENY" — the tenant page could say a move was refused and
 * not which gate refused it — and every INTENT row was drawn as though it had
 * been decided, which is the one distinction the intent/outcome pair exists to
 * make. `src/lib/high-risk-gate.test.ts` pins the record those refusals are
 * written as (`metadata.code === "REFUSED_CONFIRMATION"`), and
 * `e2e/high-risk-fails-closed.spec.ts` is what reads it back off the page.
 *
 * The underscored name is tried FIRST, so no record that already carries one
 * changes meaning, and a record carrying neither still falls back to the
 * record-level fields exactly as before.
 */
const ROW_KEY_ALIASES: Readonly<Record<keyof typeof ROW_KEYS, readonly string[]>> = {
  target: [ROW_KEYS.target, "target"],
  detail: [ROW_KEYS.detail],
  outcome: [ROW_KEYS.outcome, "code"],
  resolves: [ROW_KEYS.resolves, "intentSequence"],
  phase: [ROW_KEYS.phase, "phase"],
}

/** The first of a field's spellings this record actually carries. */
function metaValue(meta: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = meta[key]
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

/**
 * Which outcome codes are an ALLOW.
 *
 * The audit record's `outcome` is ALLOW or DENY and nothing else — that is the
 * vocabulary the package validates and the one a reader across two stores can
 * compare. The console's richer code (`APPLIED`, `REFUSED_IRREVERSIBLE`,
 * `REFUSED_RISK_CHANGED`, …) is kept beside it rather than instead of it, so a
 * new refusal code cannot silently become an ALLOW.
 */
function outcomeOf(code: string): AuditOutcome {
  return /^(APPLIED|ALLOWED|SUCCEEDED|OK)$/.test(code) ? "ALLOW" : "DENY"
}

function rowFrom(record: AuditRecord): AuditRow {
  const meta = (record.metadata ?? {}) as Record<string, unknown>
  const resolves = metaValue(meta, ROW_KEY_ALIASES.resolves)
  return {
    seq: record.sequence ?? 0,
    at: record.occurredAt,
    action: record.action,
    target: String(
      metaValue(meta, ROW_KEY_ALIASES.target) ?? record.resourceId ?? record.resourceType,
    ),
    actor: record.actorId,
    detail: String(metaValue(meta, ROW_KEY_ALIASES.detail) ?? record.reason ?? ""),
    outcome:
      metaValue(meta, ROW_KEY_ALIASES.phase) === "INTENT"
        ? null
        : String(metaValue(meta, ROW_KEY_ALIASES.outcome) ?? record.outcome),
    resolves: typeof resolves === "number" ? resolves : null,
    digest: record.recordHash,
    previousDigest: record.previousHash,
  }
}

/**
 * Turn a storage failure into the one thing a caller can act on.
 *
 * `AuditRecordError` is NOT wrapped: a record that cannot be BUILT is a caller
 * bug — a missing actor, a DENY with no reason — and reporting it as "the audit
 * store is unavailable" would send an operator to look at DynamoDB.
 */
async function appended(input: StudioAuditInput): Promise<AuditRow> {
  try {
    return rowFrom(await ledger.append(input))
  } catch (err) {
    if (err instanceof AuditUnavailable) throw err
    if ((err as { name?: string })?.name === "AuditRecordError") throw err
    throw new AuditUnavailable(
      `The audit ledger could not be written, so this was not done: ${safeErrorOf(err)}`,
      err,
    )
  }
}

export interface IntentInput {
  /** The tenant the act is against, or `PLATFORM_PARTITION`. */
  subject: string
  action: string
  /** What the act would do, in the operator's terms — e.g. `DRAFT -> VALIDATING`. */
  target: string
  actor: string
  at: string
  detail: string
}

/**
 * Record that an act is ABOUT to happen.
 *
 * Written before the mutating call, and its failure is fatal to the act. That
 * is not defensive coding, it is the requirement — no material change may
 * bypass audit — and the cheapest way to violate it is a `try { audit() }
 * catch {}` around the write.
 */
export async function appendIntent(input: IntentInput): Promise<AuditRow> {
  const detail = redactSecretValues(input.detail, REDACTED)
  return appended({
    tenantId: input.subject,
    actor: { principalId: input.actor },
    action: input.action,
    resourceType: "Tenant",
    resourceId: input.subject,
    // An intent is not a decision. It is recorded as an ALLOW of "this was
    // begun", and the DENY that matters is written by the outcome row.
    outcome: "ALLOW",
    reason: detail,
    metadata: {
      [ROW_KEYS.phase]: "INTENT",
      [ROW_KEYS.target]: input.target,
      [ROW_KEYS.detail]: detail,
    },
    correlationId: `${input.action}:${input.subject}:${input.at}`,
    occurredAt: input.at,
  })
}

export interface OutcomeInput extends IntentInput {
  /** The `seq` of the intent this closes. */
  resolves: number
  /** The console's outcome code — `APPLIED`, `REFUSED_*`, `FAILED_*`. */
  outcome: string
}

/** Record how the act ended — including, especially, that it was refused. */
export async function appendOutcome(input: OutcomeInput): Promise<AuditRow> {
  const detail = redactSecretValues(input.detail, REDACTED)
  return appended({
    tenantId: input.subject,
    actor: { principalId: input.actor },
    action: input.action,
    resourceType: "Tenant",
    resourceId: input.subject,
    outcome: outcomeOf(input.outcome),
    // A DENY with no reason cannot answer the only question anyone asks about
    // one. `buildAuditRecord` refuses to build it, which is why this is not
    // conditional.
    reason: detail || input.outcome,
    metadata: {
      [ROW_KEYS.phase]: "OUTCOME",
      [ROW_KEYS.target]: input.target,
      [ROW_KEYS.detail]: detail,
      [ROW_KEYS.outcome]: input.outcome,
      [ROW_KEYS.resolves]: input.resolves,
    },
    correlationId: `${input.action}:${input.subject}:${input.at}`,
    occurredAt: input.at,
  })
}

/**
 * Every attempt recorded against one subject, oldest first.
 *
 * Oldest first because that is the order the chain is in, and a page that
 * renders `previousDigest` beside `digest` is only checkable when the row above
 * is the row the link points at.
 */
export async function readLedger(subject: string): Promise<AuditRow[]> {
  try {
    return (await ledger.read(subject)).map(rowFrom)
  } catch (err) {
    // A page must render. An unreadable ledger is reported as an empty one by
    // the CALLER only if it chooses to; here it is an explicit failure so that
    // "nothing has been attempted" and "the ledger could not be read" cannot be
    // the same screen.
    throw new AuditUnavailable(`The audit ledger could not be read: ${safeErrorOf(err)}`, err)
  }
}

/**
 * One subject's chain as RECORDS rather than as the console's projection.
 *
 * `/platform/audit` reads this once and hands the same array to `verifyChain`
 * and `applyRetention` — the read half of `@tenure/audit`, which until now had
 * no production caller anywhere in this repository and was reachable only from
 * the package's own test. Reading once matters: verifying one array and planning
 * retention over a second, separately-read one would let the page report a chain
 * as intact and a plan as safe over two different reads of the table.
 */
export async function readRecordsFor(subject: string): Promise<AuditRecord[]> {
  return ledger.read(subject)
}

/** Every legal hold on a subject, placements folded with their releases. */
export async function holdsFor(subject: string): Promise<LegalHold[]> {
  return ledger.holds(subject)
}

/** Place a preservation order over some slice of a subject's trail. */
export async function placeLegalHold(hold: LegalHold): Promise<void> {
  await ledger.placeHold(hold)
}

/** Lift one, by writing a release rather than rewriting the placement. */
export async function releaseLegalHold(
  subject: string,
  holdId: string,
  releasedAt: string,
  by: string,
): Promise<void> {
  await ledger.releaseHold(subject, holdId, releasedAt, by)
}

/**
 * Run a mutating act between an INTENT row and an OUTCOME row.
 *
 * The same shape the lifecycle path writes by hand, for the callers that do not
 * need to name a refusal code per branch. Throws whatever `act` threw, after
 * recording a refusal carrying a safe error — so a thrown exception leaves a
 * closed attempt rather than an intent nobody resolved.
 */
export async function auditedAct<T>(
  intent: IntentInput,
  act: () => Promise<T>,
  /** What to say on the outcome row when the act succeeds. */
  succeeded: (result: T) => { outcome: string; detail: string },
): Promise<T> {
  const opened = await appendIntent(intent)

  let result: T
  try {
    result = await act()
  } catch (err) {
    await appendOutcome({
      ...intent,
      at: new Date().toISOString(),
      resolves: opened.seq,
      outcome: "FAILED",
      detail: safeErrorOf(err),
    })
    throw err
  }

  const closing = succeeded(result)
  await appendOutcome({
    ...intent,
    at: new Date().toISOString(),
    resolves: opened.seq,
    outcome: closing.outcome,
    detail: closing.detail,
  })
  return result
}
