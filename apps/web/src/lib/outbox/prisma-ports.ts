import { Prisma } from "@prisma/client"
import type { DomainEvent, EventOrigin, OutboxRecord, OutboxState } from "@tenure/contracts"

import { db } from "@/lib/db"
import { consumersFor } from "@/lib/outbox/consumers"
import type { GapPorts, OutboxPorts, ReplayPorts } from "@/lib/outbox/outbox"

/**
 * PAY-020-005 / PAY-140-007 — the outbox ports, over Prisma.
 *
 * `outbox.ts` deliberately knows nothing about the database, and until now
 * nothing implemented what it declared: `OutboxPorts` had no implementation
 * anywhere in the repository, so `dispatchOnce` had no production caller and
 * every row written since the table shipped has sat at `state = 'pending'`.
 * This is the missing half.
 *
 * ── Bound to one institution ────────────────────────────────────────────────
 *
 * Every port here is built for a single `institutionId`, and the job route runs
 * one pass per institution inside that institution's scope. That is not
 * ceremony: `claimDue` has to be raw SQL (below), and raw SQL does not pass
 * through the tenancy extension — a dispatcher that claimed across tenants
 * would be reading every institution's activity out of one query, which is the
 * exact leak the chokepoint exists to prevent. The predicate is written out by
 * hand for the same reason the reminders route writes its RoleAssignment
 * predicate by hand.
 */

/** The row shape `claimDue` returns. Snake-free: Prisma's columns are quoted. */
interface OutboxRow {
  id: string
  institutionId: string
  eventId: string
  type: string
  schemaVersion: number
  resourceType: string
  resourceId: string
  correlationId: string
  causationId: string | null
  origin: string
  payload: unknown
  state: string
  attempts: number
  lastError: string | null
  availableAt: Date
  deadLetteredAt: Date | null
  occurredAt: Date
}

/**
 * A row, as the record `dispatchOnce` reads.
 *
 * Deliberately NOT `parseOutboxRecord`. Parsing here would throw on exactly the
 * row `dispatchOnce` has a branch for — an event that no longer satisfies the
 * contract — and that throw would abort the whole pass instead of dead-lettering
 * the one bad record with a reason on it. The contract check belongs where the
 * dispatcher already does it.
 */
function recordOf(row: OutboxRow): OutboxRecord {
  const event: DomainEvent = {
    eventId: row.eventId,
    tenantId: row.institutionId,
    type: row.type,
    schemaVersion: row.schemaVersion,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    occurredAt: row.occurredAt.toISOString(),
    correlationId: row.correlationId,
    causationId: row.causationId,
    // Carried through unvalidated: a row whose origin is not one of the two
    // words is a row `parseDomainEvent` must reject in the dispatcher, and
    // coercing it here would hide that.
    origin: row.origin as EventOrigin,
    payload: (row.payload ?? {}) as Record<string, unknown>,
  }

  return {
    outboxId: row.id,
    event,
    state: row.state as OutboxState,
    attempts: row.attempts,
    lastError: row.lastError,
    availableAt: row.availableAt.toISOString(),
    deadLetteredAt: row.deadLetteredAt?.toISOString() ?? null,
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}

/**
 * How long a claim is honoured before another dispatcher may take the record.
 *
 * Without this, `state = 'dispatching'` is a terminal state by accident. A task
 * that is killed between claiming a batch and delivering it — a deploy, an ECS
 * scale-in, an OOM — leaves every record it held at `dispatching`, and a
 * `claimDue` that only ever matched `pending` would never look at them again.
 * That is precisely the defect this whole file exists to close, reintroduced one
 * state further along: rows stranded forever, invisible except as a number in
 * the gap report.
 *
 * Five minutes is longer than any pass this route can run (50 records against
 * in-process consumers) and short enough that recovery happens on the next
 * schedule rather than the next incident review. Reclaiming can redeliver an
 * event whose first delivery was in fact still running, and that is the
 * at-least-once trade the outbox already made: `InboxEvent` deduplicates it, so
 * a redelivery costs a rolled-back transaction and never a second business
 * effect.
 */
export const CLAIM_LEASE_MS = 5 * 60 * 1000

/** How much of a downstream failure is kept on the record. */
export const LAST_ERROR_LIMIT = 1024

/**
 * Truncate a downstream error without splitting a character in half.
 *
 * A plain `slice(0, 1024)` counts UTF-16 code units, so a message whose 1024th
 * unit is the high half of a surrogate pair is cut between the halves and the
 * stored string ends in a lone surrogate. That is not a cosmetic problem: a lone
 * surrogate is not valid UTF-8, so it round-trips as U+FFFD at best and makes
 * the row unserialisable at worst — and this is the column an operator reads to
 * find out why an event stopped being delivered. Downstream errors quote
 * downstream data, and downstream data is written by people with names and
 * clubs that use the whole of Unicode.
 */
export function truncateLastError(message: string, limit = LAST_ERROR_LIMIT): string {
  if (message.length <= limit) return message
  const cut = message.slice(0, limit)
  const last = cut.charCodeAt(cut.length - 1)
  // A high surrogate in the final position has lost its pair; drop it.
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
}

export interface PrismaOutboxPortsOptions {
  institutionId: string
  /**
   * Overridden only by the integration tests, which need a delivery that fails
   * on demand — retry, backoff, dead-lettering and the stale-write race cannot
   * be asserted against a transport that always succeeds. Production leaves it
   * alone and gets `deliverToConsumers`, so the route wires the real handlers.
   */
  deliver?: (event: DomainEvent) => Promise<void>
}

export function prismaOutboxPorts(
  options: PrismaOutboxPortsOptions,
): OutboxPorts & ReplayPorts & GapPorts {
  const { institutionId } = options

  const deliver = options.deliver ?? ((event: DomainEvent) => deliverToConsumers(institutionId, event))

  return {
    /**
     * Claim due records atomically.
     *
     * One statement, not a read followed by a write. THAT is what makes two
     * dispatchers running at once — two ECS tasks, a schedule that overlapped,
     * an operator running the job by hand during an incident — claim disjoint
     * sets: the state predicate is evaluated under the row lock the same
     * statement takes, so a row claimed between a read and a write cannot be
     * claimed twice. A `findMany` followed by an `updateMany` hands both
     * callers the same batch, and the at-least-once guarantee stops being
     * bounded by "once per consumer" and becomes "once per dispatcher".
     * `@@index([state, availableAt])` serves the predicate.
     *
     * `SKIP LOCKED` is liveness, not safety, and the comment here used to claim
     * otherwise. Removing it was run as a mutation against dispatch.itest.ts
     * and jobs/outbox-dispatch.itest.ts and every test stayed green: under READ
     * COMMITTED a plain `FOR UPDATE` blocks on the contended row and then
     * re-evaluates the predicate against the updated version (EvalPlanQual), by
     * which point the row says `dispatching` and is not returned. So it is kept
     * for the reason it is actually worth keeping — without it a second
     * dispatcher serialises behind the first for the length of its claim
     * instead of picking up the rows the first did not take.
     *
     * The second arm of that predicate is the recovery half: a record left at
     * `dispatching` by a task that died mid-pass is claimable again once its
     * lease has expired. See `CLAIM_LEASE_MS`.
     */
    async claimDue(now: string, limit: number): Promise<OutboxRecord[]> {
      const at = new Date(now)
      const leaseCutoff = new Date(at.getTime() - CLAIM_LEASE_MS)

      const rows = await db.$queryRaw<OutboxRow[]>`
        UPDATE "OutboxEvent" SET "state" = 'dispatching', "updatedAt" = NOW()
        WHERE "id" IN (
          SELECT "id" FROM "OutboxEvent"
          WHERE (
              "state" = 'pending'
              OR ("state" = 'dispatching' AND "updatedAt" <= ${leaseCutoff})
            )
            AND "availableAt" <= ${at}
            AND "institutionId" = ${institutionId}
          ORDER BY "availableAt" ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING "id", "institutionId", "eventId", "type", "schemaVersion", "resourceType",
                  "resourceId", "correlationId", "causationId", "origin", "payload", "state",
                  "attempts", "lastError", "availableAt", "deadLetteredAt", "occurredAt"
      `
      return rows.map(recordOf)
    },

    deliver,

    /**
     * Every outcome write is conditional on the record still being claimed.
     *
     * `state: "dispatching"` in the predicate is not belt-and-braces. Because a
     * lease can expire (`CLAIM_LEASE_MS`), a dispatcher that hung can come back
     * after another one has already taken the record, retried it eight times
     * and dead-lettered it — and an unconditional `UPDATE … SET state =
     * 'dispatched' WHERE id = …` would then resurrect a dead letter as
     * delivered, erasing `deadLetteredAt` and the reason with it. The stale
     * write has to lose, and the only way it loses is by naming the state it
     * believes the record is in.
     */
    async markDispatched(outboxId: string, at: string): Promise<void> {
      // updateMany rather than update: a unique `where` cannot carry the tenant
      // predicate, so `update({ where: { id } })` would be the one write in
      // this file the query layer could not scope.
      await db.outboxEvent.updateMany({
        where: { id: outboxId, institutionId, state: "dispatching" },
        data: { state: "dispatched", dispatchedAt: new Date(at), lastError: null },
      })
    },

    async scheduleRetry(
      outboxId: string,
      availableAt: string,
      attempts: number,
      lastError: string,
    ): Promise<void> {
      await db.outboxEvent.updateMany({
        where: { id: outboxId, institutionId, state: "dispatching" },
        data: {
          // Back to pending, not left at dispatching: `availableAt` is what
          // decides when it returns, and a record parked in a state no query
          // selects is a record nothing ever retries.
          state: "pending",
          availableAt: new Date(availableAt),
          attempts,
          // Truncated to the column's usable width. A downstream stack trace
          // can be megabytes, and the row exists to tell an operator what
          // happened, not to store the whole failure.
          lastError: truncateLastError(lastError),
        },
      })
    },

    async deadLetter(outboxId: string, at: string, attempts: number, lastError: string): Promise<void> {
      await db.outboxEvent.updateMany({
        where: { id: outboxId, institutionId, state: "dispatching" },
        data: {
          state: "dead",
          deadLetteredAt: new Date(at),
          attempts,
          lastError: truncateLastError(lastError),
        },
      })
    },

    // ── Operator path ───────────────────────────────────────────────────────

    async listDead(limit: number): Promise<OutboxRecord[]> {
      const rows = await db.outboxEvent.findMany({
        where: { institutionId, state: "dead" },
        orderBy: { deadLetteredAt: "desc" },
        take: limit,
      })
      return rows.map((r) => recordOf(r as unknown as OutboxRow))
    },

    async requeue(outboxId: string, at: string): Promise<void> {
      // `state: "dead"` in the predicate, even though `replay()` has already
      // checked it against `listDead`. Between that read and this write an
      // operator elsewhere can requeue the same record, and requeuing a record
      // that is now pending duplicates it deliberately — the one duplication
      // this design refuses.
      await db.outboxEvent.updateMany({
        where: { id: outboxId, institutionId, state: "dead" },
        data: {
          state: "pending",
          availableAt: new Date(at),
          attempts: 0,
          lastError: null,
          deadLetteredAt: null,
        },
      })
    },

    // ── Reconciliation ──────────────────────────────────────────────────────

    async overdue(now: string, limit: number): Promise<OutboxRecord[]> {
      const rows = await db.outboxEvent.findMany({
        where: {
          institutionId,
          state: { in: ["pending", "dispatching"] },
          availableAt: { lte: new Date(now) },
        },
        orderBy: { availableAt: "asc" },
        take: limit,
      })
      return rows.map((r) => recordOf(r as unknown as OutboxRow))
    },

    async countOverdue(now: string): Promise<number> {
      return db.outboxEvent.count({
        where: {
          institutionId,
          // `dispatching` counts too. A record left in flight by a task that
          // died is exactly as undelivered as one nobody claimed, and counting
          // only `pending` would report a healthy queue during the incident
          // that killed the dispatcher mid-pass.
          state: { in: ["pending", "dispatching"] },
          availableAt: { lte: new Date(now) },
        },
      })
    },

    async countDead(): Promise<number> {
      return db.outboxEvent.count({ where: { institutionId, state: "dead" } })
    },
  }
}

/**
 * PAY-020-005 — delivery, with the inbox that makes at-least-once survivable.
 *
 * The dispatcher marks a record dispatched only after this returns, so a crash
 * in between redelivers the event. That is the right trade — the other order
 * loses events — but it is only bounded if a consumer can recognise a
 * redelivery. The `InboxEvent` row is that recognition, and it is written in
 * the SAME transaction as the handler's own effects: "marked consumed" and
 * "the work happened" cannot disagree, which is the mirror image of the
 * property the outbox itself exists for.
 *
 * The unique index does the work, not the pre-check. Two dispatchers can reach
 * the same event after a replay, and a check-then-insert loses that race
 * silently; the second transaction hits the constraint and rolls back its own
 * effects with it.
 */
export async function deliverToConsumers(institutionId: string, event: DomainEvent): Promise<void> {
  for (const consumer of consumersFor(event.type)) {
    // Cheap first pass. The constraint below is what makes it correct, but a
    // redelivered event usually has nothing racing it, and this turns the
    // common case into one indexed read instead of a transaction that always
    // rolls back.
    const already = await db.inboxEvent.findFirst({
      where: { institutionId, eventId: event.eventId, consumer: consumer.name },
      select: { id: true },
    })
    if (already) continue

    try {
      await db.$transaction(async (tx) => {
        await tx.inboxEvent.create({
          data: { institutionId, eventId: event.eventId, consumer: consumer.name },
        })
        await consumer.handle(tx, event)
      })
    } catch (error) {
      // Somebody else consumed it while this transaction ran. Their handler's
      // effects committed; ours rolled back. That is a successful delivery, and
      // reporting it as a failure would retry an event that has been handled.
      if (isUniqueViolation(error)) continue
      throw error
    }
  }
}
