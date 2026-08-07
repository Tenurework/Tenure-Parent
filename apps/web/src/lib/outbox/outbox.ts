import { parseDomainEvent, type DomainEvent, type OutboxRecord, type OutboxState } from "@tenure/contracts"

/**
 * GE-021-006 — the transactional outbox.
 *
 * The property this exists for is one sentence: **"the row changed" and "the
 * event exists" cannot disagree.** Publishing to a queue after committing gives
 * you a window where the change happened and the event did not, and nothing
 * downstream ever learns about it. Publishing before committing gives you the
 * opposite. Writing the event *in the same transaction* removes the window
 * entirely, and delivery becomes a separate, retryable problem.
 *
 * ── Idempotent dispatch means the consumer's problem is bounded ─────────────
 *
 * At-least-once is the only delivery guarantee available: a dispatcher that
 * marks a record dispatched before the consumer confirms can lose it, and one
 * that marks after can duplicate it. This chooses duplication, because a
 * consumer can deduplicate on `eventId` and cannot invent a message it never
 * received.
 *
 * ── What is deliberately not here ───────────────────────────────────────────
 *
 * No transport. The dispatcher hands an event to a `deliver` port and records
 * what happened; whether that is SQS, an HTTP call or an in-process handler is
 * not the outbox's business, and putting it here would make the retry and
 * dead-letter logic untestable without one.
 */

/**
 * The columns an `OutboxEvent` row carries, derived from a validated event.
 *
 * Deliberately a plain object rather than a Prisma call: this module stays free
 * of the client (see the note above about transport), and the caller spreads
 * this into `db.outboxEvent.create({ data })` **inside the transaction that
 * makes the change**. Anywhere else and the window this whole file exists to
 * close reopens.
 *
 * `parseDomainEvent` runs here rather than at the call site, which is the point
 * of the mapper existing at all: a row can only be written from a value that
 * satisfies the contract, so `dispatchOnce`'s "event no longer parses" branch
 * cannot be reached by something this application wrote. The tenant comes from
 * `event.tenantId` for the same reason — a row whose `institutionId` disagreed
 * with the event it carries would be an event delivered under the wrong tenant.
 */
export interface OutboxEventRow {
  institutionId: string
  eventId: string
  type: string
  schemaVersion: number
  resourceType: string
  resourceId: string
  correlationId: string
  causationId: string | null
  payload: Record<string, unknown>
  occurredAt: Date
}

export function outboxEventRow(event: DomainEvent): OutboxEventRow {
  const valid = parseDomainEvent(event)

  // The column is a JSON object. A scalar or an array would round-trip through
  // Prisma and then fail to spread on the consumer side, at delivery time, in
  // whatever process is reading the queue — a long way from whoever wrote it.
  const payload = valid.payload ?? {}
  if (typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError(
      "An outbox event's payload must be a JSON object. A scalar or an array reaches a consumer " +
        "as something it cannot read, and it fails there rather than here.",
    )
  }

  return {
    institutionId: valid.tenantId,
    eventId: valid.eventId,
    type: valid.type,
    schemaVersion: valid.schemaVersion,
    resourceType: valid.resourceType,
    resourceId: valid.resourceId,
    correlationId: valid.correlationId,
    causationId: valid.causationId,
    payload: payload as Record<string, unknown>,
    occurredAt: new Date(valid.occurredAt),
  }
}

export interface OutboxPorts {
  /**
   * Claim up to `limit` records that are due.
   *
   * Must be atomic — two dispatchers running at once must not claim the same
   * record, or the duplication stops being bounded by "at least once" and
   * becomes "as many times as there are dispatchers".
   */
  claimDue(now: string, limit: number): Promise<OutboxRecord[]>

  /** Deliver one event. Throwing means "did not deliver"; returning means it did. */
  deliver(event: DomainEvent): Promise<void>

  markDispatched(outboxId: string, at: string): Promise<void>

  /** Schedule a retry. `availableAt` is when the record becomes due again. */
  scheduleRetry(outboxId: string, availableAt: string, attempts: number, lastError: string): Promise<void>

  /** Move to the dead-letter state, with the reason it stopped. */
  deadLetter(outboxId: string, at: string, attempts: number, lastError: string): Promise<void>
}

export interface DispatchReport {
  claimed: number
  dispatched: number
  retried: number
  deadLettered: number
}

/** After this many failures a record stops being retried and waits for a human. */
export const MAX_ATTEMPTS = 8

/**
 * Exponential backoff with jitter, capped.
 *
 * The jitter is not decoration. Without it, a batch that fails together retries
 * together — the thundering herd that turns a transient downstream blip into a
 * sustained one, at exactly the moment the downstream is least able to absorb
 * it. The jitter source is injected so the schedule is deterministic in tests.
 */
export function backoffMs(attempts: number, jitter: number): number {
  const base = Math.min(2 ** attempts * 1000, 60 * 60 * 1000)
  // ±25%, so two records failing at the same instant do not return together.
  return Math.round(base * (0.75 + jitter * 0.5))
}

/**
 * Run one dispatch pass.
 *
 * Returns counts rather than throwing on a delivery failure: a failed delivery
 * is the normal case this is built for, and a pass that aborted on the first
 * one would leave every later record unattempted because of an unrelated
 * consumer being briefly down.
 */
export async function dispatchOnce(
  ports: OutboxPorts,
  options: { now: string; limit?: number; jitter?: () => number },
): Promise<DispatchReport> {
  const { now } = options
  const limit = options.limit ?? 50
  const jitter = options.jitter ?? Math.random

  const claimed = await ports.claimDue(now, limit)
  const report: DispatchReport = { claimed: claimed.length, dispatched: 0, retried: 0, deadLettered: 0 }

  for (const record of claimed) {
    // A record whose event no longer parses cannot be delivered and will never
    // start parsing. Retrying it burns attempts to reach the same dead letter
    // eight failures later, so it goes straight there with a reason that says
    // what is wrong.
    try {
      parseDomainEvent(record.event)
    } catch (err) {
      await ports.deadLetter(
        record.outboxId,
        now,
        record.attempts + 1,
        `event does not satisfy the DomainEvent contract: ${err instanceof Error ? err.message : String(err)}`,
      )
      report.deadLettered += 1
      continue
    }

    try {
      await ports.deliver(record.event)
      // Marked dispatched only AFTER the consumer returned. The other order
      // loses a record whenever delivery fails between the mark and the call.
      await ports.markDispatched(record.outboxId, now)
      report.dispatched += 1
    } catch (err) {
      const attempts = record.attempts + 1
      // The message is stored, not returned — it is a downstream error and may
      // name anything. It lives on the record for an operator, not in a
      // response to a user.
      const lastError = err instanceof Error ? err.message : String(err)

      if (attempts >= MAX_ATTEMPTS) {
        await ports.deadLetter(record.outboxId, now, attempts, lastError)
        report.deadLettered += 1
      } else {
        const availableAt = new Date(Date.parse(now) + backoffMs(attempts, jitter())).toISOString()
        await ports.scheduleRetry(record.outboxId, availableAt, attempts, lastError)
        report.retried += 1
      }
    }
  }

  return report
}

export interface ReplayPorts {
  /** Dead records, for an operator to look at before replaying any. */
  listDead(limit: number): Promise<OutboxRecord[]>
  /** Return a dead record to `pending`, due immediately, with attempts reset. */
  requeue(outboxId: string, at: string): Promise<void>
}

/**
 * Replay dead-lettered records.
 *
 * Explicit ids, never "replay everything". A dead letter is a record that
 * failed eight times, and the reason is usually still true — replaying the
 * whole queue reproduces the incident and buries the one record that would
 * have succeeded. `select` exists so an operator can filter after reading
 * `listDead`, and it is applied here rather than trusted to the caller.
 */
export async function replay(
  ports: ReplayPorts,
  outboxIds: readonly string[],
  options: { at: string; max?: number },
): Promise<{ requeued: string[]; refused: string[] }> {
  const max = options.max ?? 100

  if (outboxIds.length === 0) {
    throw new Error("replay() needs explicit ids. Replaying everything reproduces the incident.")
  }
  if (outboxIds.length > max) {
    throw new Error(
      `replay() refuses ${outboxIds.length} records at once (max ${max}). A bulk replay is a ` +
        `load test against whatever was already failing.`,
    )
  }

  const dead = await ports.listDead(Math.max(max, outboxIds.length))
  const deadIds = new Set(dead.map((d) => d.outboxId))

  const requeued: string[] = []
  const refused: string[] = []

  for (const id of outboxIds) {
    // Only dead records may be replayed. Requeuing a record that is pending or
    // in flight duplicates it deliberately, which is the one duplication this
    // design does not accept.
    if (!deadIds.has(id)) {
      refused.push(id)
      continue
    }
    await ports.requeue(id, options.at)
    requeued.push(id)
  }

  return { requeued, refused }
}

/** States from which a record will be attempted again. */
export const RETRYABLE_STATES: readonly OutboxState[] = ["pending", "dispatching"]
