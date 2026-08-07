import { MODULE_CATALOG } from "@tenure/modules"
import type { DomainEvent } from "@tenure/contracts"

import type { TxClient } from "@/lib/db"

/**
 * PAY-020-005 — who actually receives an event.
 *
 * `dispatchOnce` takes a `deliver` port and does not care what is on the other
 * end. This is the other end, and it is deliberately not a transport: the only
 * consumer the platform declares today runs in this process, against the same
 * database, and putting it behind a queue would add a second delivery guarantee
 * to reason about without adding a second consumer.
 *
 * ── Held to the declaration, not to its own list ────────────────────────────
 *
 * `modules/index.ts` already says which module consumes which event, and its
 * comment on `memory.consumes` says exactly this: "That runner is the next
 * piece, and it will be held to this declaration rather than inventing its own
 * list." So every handler below names the module it runs for, and
 * `assertDeclared` refuses at import time if the manifest does not agree. A
 * handler for an event no module declares is a consumer nobody can discover by
 * reading the catalog — which is how a system passes `validateSystem` while
 * doing something the release never described.
 */
export interface OutboxConsumer {
  /** The module key in `@tenure/modules` whose manifest declares this. */
  module: string
  /** The `DomainEvent.type` this handles. */
  eventType: string
  /**
   * Written to `InboxEvent.consumer`. Stable across deploys — renaming it
   * re-runs every event this consumer has already handled.
   */
  name: string
  handle(tx: TxClient, event: DomainEvent): Promise<void>
}

/**
 * The last step of `request-to-approval-to-memory`.
 *
 * The chain in `modules/index.ts` is three steps and the third had no
 * implementation: approvals emits `ApprovalRequested`, a human turns it into
 * `ApprovalDecided`, and memory records what was decided. Memory's manifest
 * says why it owns the step — "what a decision was and why is the institutional
 * record a successor needs, and it belongs to the module whose whole purpose is
 * outliving the officers who made it."
 *
 * Everything written comes from the event or from the approval row it names.
 * Nothing is invented: the title is the request's own title, the content is the
 * transition that happened, and the author is whoever decided.
 */
const approvalDecidedToMemory: OutboxConsumer = {
  module: "memory",
  eventType: "ApprovalDecided",
  name: "memory.approval-decided",

  async handle(tx, event) {
    const payload = (event.payload ?? {}) as Record<string, unknown>

    // Read inside the same transaction as the write. The approval is what the
    // event is ABOUT, and re-reading it is what the platform requires of
    // consumers: an event carries references, and a consumer that needs detail
    // rereads rather than trusting a payload to still be true.
    const approval = await tx.approvalRequest.findFirst({
      where: { id: event.resourceId, institutionId: event.tenantId },
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        organizationId: true,
        submittedById: true,
      },
    })

    // Thrown, not swallowed. A decision whose request cannot be found is a
    // genuine inconsistency, and the outbox's retry-then-dead-letter path is
    // exactly the right response: it retries in case of a replica lag, and
    // stops after eight attempts with the reason on the row.
    if (!approval) {
      throw new Error(
        `ApprovalRequest ${event.resourceId} is not in institution ${event.tenantId}; nothing to record.`,
      )
    }

    const action = typeof payload.action === "string" ? payload.action : "decided"
    const decidedById = typeof payload.decidedById === "string" ? payload.decidedById : null

    await tx.memoryRecord.create({
      data: {
        institutionId: event.tenantId,
        organizationId: approval.organizationId,
        // LESSON is the type whose enum comment is "hard-won insight for the
        // successor", which is what a decision record is for. It is not a
        // CREDENTIAL, a BUDGET or a DEADLINE, and inventing a ninth type to
        // hold it would change a shared enum for one writer.
        type: "LESSON",
        title: `Decision: ${approval.title}`,
        content: {
          approvalId: approval.id,
          approvalType: approval.type,
          action,
          fromStatus: typeof payload.fromStatus === "string" ? payload.fromStatus : null,
          toStatus: typeof payload.toStatus === "string" ? payload.toStatus : approval.status,
          decidedAt: event.occurredAt,
          decidedById,
          submittedById: approval.submittedById,
        },
        authorId: decidedById,
      },
    })
  },
}

const CONSUMERS: readonly OutboxConsumer[] = [approvalDecidedToMemory]

/**
 * Refuses at import time, which is the only time it can help.
 *
 * A handler whose module does not declare its event type would otherwise run
 * happily in production while `validateSystem` released a system that never
 * mentioned it.
 */
function assertDeclared(consumers: readonly OutboxConsumer[]): readonly OutboxConsumer[] {
  for (const c of consumers) {
    const manifest = MODULE_CATALOG.get(c.module)
    if (!manifest) {
      throw new Error(
        `Outbox consumer "${c.name}" runs for module "${c.module}", which is not in the module catalog.`,
      )
    }
    if (!(manifest.consumes ?? []).includes(c.eventType)) {
      throw new Error(
        `Outbox consumer "${c.name}" handles "${c.eventType}", which module "${c.module}" does not ` +
          `declare in its manifest. Declare it there first — a consumer the catalog cannot see is a ` +
          `consumer no release can validate.`,
      )
    }
    const names = consumers.filter((o) => o.name === c.name)
    if (names.length > 1) {
      throw new Error(`Two outbox consumers share the name "${c.name}"; InboxEvent keys on it.`)
    }
  }
  return consumers
}

const DECLARED = assertDeclared(CONSUMERS)

/**
 * The consumers for an event type. Empty is a legitimate answer.
 *
 * `ApprovalRequested` has no in-process consumer and should not: the chain
 * declares that the module consuming it is `approvals` itself, and what it does
 * with the event is wait for a person to decide. Delivering to nobody is
 * therefore success, not a silent drop — the alternative, treating "no
 * consumer" as a failure, would dead-letter every request event after eight
 * pointless retries.
 */
export function consumersFor(eventType: string): readonly OutboxConsumer[] {
  return DECLARED.filter((c) => c.eventType === eventType)
}

/** Every registered consumer, for the operator surface and for tests. */
export function allConsumers(): readonly OutboxConsumer[] {
  return DECLARED
}

/**
 * The refusal itself, so its branches can be asserted.
 *
 * It runs at import time on the real list, which is the only time it can stop a
 * bad handler shipping — and also the reason it cannot be exercised by a test
 * that only imports this module: by then it has already passed. Exposed rather
 * than re-implemented in the test, so what is proven is the function production
 * actually calls.
 */
export const __testing = { assertDeclared }
