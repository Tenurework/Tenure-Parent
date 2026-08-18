import "server-only"

import { db } from "@/lib/db"
import type { DeadDelivery, DeadDeliveryPorts } from "@/lib/connections/exception-worklist"

/**
 * INT-060-002 — the exception worklist's only source of truth, over Prisma.
 *
 * `exception-worklist.ts` deliberately knows nothing about the database, for
 * the same reason `outbox.ts` does not: the ordering, the SLA arithmetic and
 * the refusal-to-guess rules have to be exercisable against the records that go
 * wrong, and a rule that needs Postgres to reach is a rule nobody reaches.
 *
 * `OutboxEvent` is TENANT_SCOPED (`src/lib/tenancy/registry.ts:28`), so this
 * must be called INSIDE an open tenant scope and the extension supplies the
 * institution predicate. It deliberately does not take an `institutionId`
 * argument: an argument would be a second place the tenant is decided, and the
 * two would disagree the first time a caller passed the wrong one.
 *
 * Read-only, and that is the whole surface. Replaying a dead letter is
 * `replay()` in `src/lib/outbox/outbox.ts`, which refuses anything that is not
 * already dead and refuses a bulk request; wiring a write into the page that
 * LISTS failures is how "replay everything" gets built by accident.
 */
export function prismaDeadDeliveryPorts(): DeadDeliveryPorts {
  return {
    async deadDeliveries(limit: number): Promise<readonly DeadDelivery[]> {
      const rows = await db.outboxEvent.findMany({
        where: { state: "dead" },
        orderBy: { deadLetteredAt: "desc" },
        take: limit,
        select: {
          id: true,
          type: true,
          resourceType: true,
          resourceId: true,
          attempts: true,
          lastError: true,
          deadLetteredAt: true,
          correlationId: true,
          updatedAt: true,
        },
      })

      return rows.map((row) => ({
        outboxId: row.id,
        eventType: row.type,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        attempts: row.attempts,
        lastError: row.lastError,
        // `deadLetteredAt` is nullable in the schema and a row at `state =
        // 'dead'` should always carry it. Should is not the same as does, and
        // the exception builder REFUSES an unparseable timestamp rather than
        // dating an SLA from now — so the fallback is the row's own last write,
        // which is a real time this record was touched, not the time somebody
        // opened the worklist.
        deadLetteredAt: (row.deadLetteredAt ?? row.updatedAt).toISOString(),
        correlationId: row.correlationId,
      }))
    },
  }
}
