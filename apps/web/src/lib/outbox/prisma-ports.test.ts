import { Prisma } from "@prisma/client"
import { describe, expect, it, beforeEach } from "@jest/globals"

import type { DomainEvent } from "@tenure/contracts"

/**
 * PAY-020-005 — delivery, against a store that behaves like the real one.
 *
 * What a fake can and cannot prove is the whole design of this file.
 *
 * It CANNOT prove `claimDue`. That claim is one `UPDATE … WHERE id IN (SELECT …
 * FOR UPDATE SKIP LOCKED) RETURNING *`, and its correctness is entirely
 * PostgreSQL's row locking; a fake `claimDue` that returns an array is atomic
 * because arrays are, which is the "fake test proves nothing" trap. That
 * property is asserted against a live database in dispatch.itest.ts and
 * ../jobs/outbox-dispatch.itest.ts, and nowhere else.
 *
 * It CAN prove `deliverToConsumers`, because everything that function decides
 * is decided in JavaScript: whether to skip a redelivery, whether a unique
 * violation is a failure or a success, and whether the handler's effects and
 * the record that it ran commit together. So the store below enforces the two
 * things the real database enforces — the UNIQUE index on
 * (institutionId, eventId, consumer), and a transaction that rolls back
 * everything it wrote when the callback throws — and the REAL consumer from
 * consumers.ts runs against it.
 */

type Row = Record<string, unknown>

class FakeStore {
  inbox: Row[] = []
  memory: Row[] = []
  approvals: Row[] = []
  /** Every insert attempted, including the ones the unique index refused. */
  inboxAttempts = 0
}

let mockStore = new FakeStore()

function uniqueViolation(): Error {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.0.0",
    meta: { target: ["institutionId", "eventId", "consumer"] },
  })
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => row[k] === v)
}

/**
 * One connection, so transactions run to completion rather than interleaving.
 *
 * That is what the database does to two transactions racing on the same unique
 * key: the second blocks on the index entry and then fails. Modelling them as
 * overlapping snapshots would model MVCC wrongly and make the rollback
 * assertion below meaningless.
 */
function makeFakeDb(store: FakeStore) {
  let queue: Promise<unknown> = Promise.resolve()

  const client = {
    inboxEvent: {
      findFirst: async ({ where }: { where: Row }) => {
        // A real query is not synchronous, and the race this file is about only
        // exists because it is not.
        await Promise.resolve()
        return store.inbox.find((r) => matches(r, where)) ?? null
      },
      create: async ({ data }: { data: Row }) => {
        store.inboxAttempts += 1
        const clash = store.inbox.some(
          (r) =>
            r.institutionId === data.institutionId &&
            r.eventId === data.eventId &&
            r.consumer === data.consumer,
        )
        if (clash) throw uniqueViolation()
        const row = { id: `inbox-${store.inbox.length + 1}`, ...data }
        store.inbox.push(row)
        return row
      },
    },
    memoryRecord: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: `mem-${store.memory.length + 1}`, ...data }
        store.memory.push(row)
        return row
      },
    },
    approvalRequest: {
      findFirst: async ({ where }: { where: Row }) => {
        await Promise.resolve()
        return store.approvals.find((r) => matches(r, where)) ?? null
      },
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const run = async (): Promise<T> => {
        const before = { inbox: [...store.inbox], memory: [...store.memory] }
        try {
          return await fn(client)
        } catch (err) {
          // The rollback. Without it "marked consumed" and "the work happened"
          // can disagree, which is the property the InboxEvent row exists for.
          store.inbox = before.inbox
          store.memory = before.memory
          throw err
        }
      }
      const result = queue.then(run, run)
      queue = result.catch(() => {})
      return result
    },
  }

  return client
}

jest.mock("@/lib/db", () => ({
  get db() {
    return mockDb
  },
}))

let mockDb = makeFakeDb(mockStore)

// Imported after the mock is declared; jest hoists the factory above it.
import { deliverToConsumers } from "./prisma-ports"
import { consumersFor } from "./consumers"

const INST = "inst-1"
const APPROVAL = "ar-1"

const decided = (over: Partial<DomainEvent> = {}): DomainEvent => ({
  eventId: "evt-1",
  tenantId: INST,
  type: "ApprovalDecided",
  schemaVersion: 1,
  resourceType: "ApprovalRequest",
  resourceId: APPROVAL,
  occurredAt: "2026-08-01T12:00:00.000Z",
  correlationId: "corr-1",
  causationId: null,
  origin: "tenure",
  payload: { action: "approve", fromStatus: "PENDING_OSE", toStatus: "APPROVED", decidedById: "u-1" },
  ...over,
})

beforeEach(() => {
  mockStore = new FakeStore()
  mockDb = makeFakeDb(mockStore)
  mockStore.approvals.push({
    id: APPROVAL,
    institutionId: INST,
    title: "Spring speaker series",
    type: "BUDGET",
    status: "APPROVED",
    organizationId: "org-1",
    submittedById: "u-9",
  })
})

describe("delivering to the declared consumers", () => {
  it("runs the handler and records that it ran, in one transaction", async () => {
    await deliverToConsumers(INST, decided())

    expect(mockStore.memory).toHaveLength(1)
    expect(mockStore.memory[0]).toMatchObject({
      institutionId: INST,
      organizationId: "org-1",
      type: "LESSON",
      title: "Decision: Spring speaker series",
    })
    expect(mockStore.inbox).toEqual([
      { id: "inbox-1", institutionId: INST, eventId: "evt-1", consumer: "memory.approval-decided" },
    ])
  })

  it("skips a redelivery it has already consumed", async () => {
    await deliverToConsumers(INST, decided())
    await deliverToConsumers(INST, decided())
    await deliverToConsumers(INST, decided())

    // At-least-once means this happens routinely; the effect must not.
    expect(mockStore.memory).toHaveLength(1)
    // And the cheap pre-check really is doing the skipping — only the first
    // delivery reached the insert at all.
    expect(mockStore.inboxAttempts).toBe(1)
  })

  it("treats a lost race as a delivery, not a failure", async () => {
    // Both pass the pre-check, because at that moment neither has consumed it.
    // The second reaches the unique index and loses. Reporting that as a
    // failure would retry an event that has been fully handled.
    await Promise.all([deliverToConsumers(INST, decided()), deliverToConsumers(INST, decided())])

    expect(mockStore.inboxAttempts).toBe(2)
    expect(mockStore.inbox).toHaveLength(1)
    // The loser's handler effects rolled back with its inbox row. Two memory
    // cards for one decision is the duplicate business effect WRK-GATE-060 is
    // about.
    expect(mockStore.memory).toHaveLength(1)
  })

  it("leaves nothing marked consumed when the handler throws", async () => {
    // The approval the event names is not there — a genuine inconsistency the
    // consumer refuses rather than papering over.
    mockStore.approvals = []

    await expect(deliverToConsumers(INST, decided())).rejects.toThrow(/nothing to record/)

    // Rolled back. If the inbox row survived, the dispatcher's retry would skip
    // the event forever and the decision would never be recorded — an event
    // marked consumed by a consumer that did nothing.
    expect(mockStore.inbox).toHaveLength(0)
    expect(mockStore.memory).toHaveLength(0)
  })

  it("re-raises the failure so the dispatcher can retry and eventually dead-letter", async () => {
    mockStore.approvals = []
    await expect(deliverToConsumers(INST, decided())).rejects.toThrow()
    // Swallowing it would report a delivery that never happened, and the row
    // would be marked dispatched with nothing on the other end.
  })

  it("succeeds without doing anything for an event no module consumes", async () => {
    // `ApprovalRequested` has no in-process consumer by design: the module that
    // consumes it is approvals, and what it does is wait for a person.
    // Delivering to nobody must be success, or every request event dead-letters
    // after eight pointless retries.
    expect(consumersFor("ApprovalRequested")).toHaveLength(0)

    await expect(
      deliverToConsumers(INST, decided({ eventId: "evt-2", type: "ApprovalRequested" })),
    ).resolves.toBeUndefined()

    expect(mockStore.inbox).toHaveLength(0)
    expect(mockStore.memory).toHaveLength(0)
  })

  it("keys the consumption on the consumer, not only on the event", async () => {
    // Two consumers of one event are two pieces of work, and one having run
    // says nothing about the other. The row the real consumer writes therefore
    // has to name it — a bare (institutionId, eventId) key would make the
    // second consumer's delivery look like a redelivery of the first.
    await deliverToConsumers(INST, decided())
    expect(mockStore.inbox[0].consumer).toBe("memory.approval-decided")
    expect(consumersFor("ApprovalDecided").map((c) => c.name)).toEqual(["memory.approval-decided"])
  })
})
