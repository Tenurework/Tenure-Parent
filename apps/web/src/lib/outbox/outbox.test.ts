/**
 * The outbox, tested on failure rather than delivery.
 *
 * Delivering an event that works is the easy half. Everything below is a
 * downstream that is down, a record that can never succeed, a batch that fails
 * together, or an operator about to replay an incident back into production.
 */
import { describe, expect, it, jest } from "@jest/globals"

import type { DomainEvent, OutboxRecord } from "@tenure/contracts"

import {
  MAX_ATTEMPTS,
  backoffMs,
  dispatchOnce,
  outboxEventRow,
  replay,
  type OutboxPorts,
  type ReplayPorts,
} from "./outbox"

const NOW = "2026-08-01T12:00:00.000Z"

const event = (over: Partial<DomainEvent> = {}): DomainEvent => ({
  eventId: "evt-1",
  tenantId: "t-roch",
  type: "ApprovalDecided",
  schemaVersion: 1,
  resourceType: "ApprovalRequest",
  resourceId: "ar-9",
  occurredAt: NOW,
  correlationId: "corr-1",
  causationId: "cmd-1",
  payload: {},
  ...over,
})

const record = (over: Partial<OutboxRecord> = {}): OutboxRecord => ({
  outboxId: "ob-1",
  event: event(),
  state: "pending",
  attempts: 0,
  lastError: null,
  availableAt: NOW,
  deadLetteredAt: null,
  ...over,
})

function ports(over: Partial<OutboxPorts> = {}): OutboxPorts {
  return {
    claimDue: async () => [record()],
    deliver: async () => {},
    markDispatched: async () => {},
    scheduleRetry: async () => {},
    deadLetter: async () => {},
    ...over,
  }
}

/**
 * Writing one, which is the half that had no production caller at all.
 *
 * `outboxEventRow` is what `approvals/actions.ts` spreads into
 * `db.outboxEvent.create` inside the transaction that moves an approval, so
 * these assertions are about the only thing standing between a malformed event
 * and a row that `dispatchOnce` would later dead-letter.
 */
describe("recording an event", () => {
  it("carries the event onto the row, under the event's own tenant", () => {
    const row = outboxEventRow(event({ payload: { action: "approve" } }))

    expect(row).toMatchObject({
      institutionId: "t-roch",
      eventId: "evt-1",
      type: "ApprovalDecided",
      schemaVersion: 1,
      resourceType: "ApprovalRequest",
      resourceId: "ar-9",
      correlationId: "corr-1",
      causationId: "cmd-1",
      payload: { action: "approve" },
    })
    expect(row.occurredAt.toISOString()).toBe(NOW)
  })

  it("refuses an event the contract refuses, before it can become a row", () => {
    // The alternative is a row written now and dead-lettered later, by which
    // time the transaction that caused it has committed and the reason it was
    // malformed is three deploys ago.
    expect(() => outboxEventRow(event({ type: "DecideApproval" }))).toThrow(/past tense/)
    expect(() => outboxEventRow(event({ schemaVersion: 0 }))).toThrow(/positive integer/)
    expect(() => outboxEventRow(event({ tenantId: "" }))).toThrow(/tenantId/)
  })

  it("takes the tenant from the event rather than from a second argument", () => {
    // A row whose institutionId disagreed with the event it carries is an event
    // delivered under the wrong tenant, and nothing downstream could tell.
    expect(outboxEventRow(event({ tenantId: "t-midtown" })).institutionId).toBe("t-midtown")
  })
})

describe("delivering", () => {
  it("marks dispatched only after the consumer returns", async () => {
    // The other order loses a record whenever delivery fails between the mark
    // and the call.
    const order: string[] = []
    await dispatchOnce(
      ports({
        deliver: async () => {
          order.push("deliver")
        },
        markDispatched: async () => {
          order.push("mark")
        },
      }),
      { now: NOW },
    )
    expect(order).toEqual(["deliver", "mark"])
  })

  it("reports what it did", async () => {
    const report = await dispatchOnce(ports(), { now: NOW })
    expect(report).toEqual({ claimed: 1, dispatched: 1, retried: 0, deadLettered: 0 })
  })
})

describe("failing", () => {
  it("retries rather than aborting the pass", async () => {
    // A pass that aborted on the first failure would leave every later record
    // unattempted because one unrelated consumer was briefly down.
    const deliver = jest.fn(async (e: DomainEvent) => {
      if (e.eventId === "evt-1") throw new Error("consumer down")
    })
    const report = await dispatchOnce(
      ports({
        claimDue: async () => [record(), record({ outboxId: "ob-2", event: event({ eventId: "evt-2" }) })],
        deliver: deliver as OutboxPorts["deliver"],
      }),
      { now: NOW },
    )
    expect(report).toEqual({ claimed: 2, dispatched: 1, retried: 1, deadLettered: 0 })
    expect(deliver).toHaveBeenCalledTimes(2)
  })

  it("stores the downstream error on the record rather than returning it", async () => {
    // It may name anything. It belongs to an operator, not to a response.
    const scheduleRetry = jest.fn(async () => {})
    await dispatchOnce(
      ports({
        deliver: async () => {
          throw new Error("connection to tenant-b-replica refused")
        },
        scheduleRetry: scheduleRetry as OutboxPorts["scheduleRetry"],
      }),
      { now: NOW },
    )
    expect(scheduleRetry).toHaveBeenCalledWith(
      "ob-1",
      expect.any(String),
      1,
      "connection to tenant-b-replica refused",
    )
  })

  it("dead-letters at the attempt limit instead of retrying forever", async () => {
    const deadLetter = jest.fn(async () => {})
    const report = await dispatchOnce(
      ports({
        claimDue: async () => [record({ attempts: MAX_ATTEMPTS - 1 })],
        deliver: async () => {
          throw new Error("still down")
        },
        deadLetter: deadLetter as OutboxPorts["deadLetter"],
      }),
      { now: NOW },
    )
    expect(report.deadLettered).toBe(1)
    expect(report.retried).toBe(0)
    expect(deadLetter).toHaveBeenCalledWith("ob-1", NOW, MAX_ATTEMPTS, "still down")
  })

  it("dead-letters an unparseable event immediately", async () => {
    // It will never start parsing. Retrying burns eight attempts to reach the
    // same dead letter, and the reason recorded says what is actually wrong.
    const deadLetter = jest.fn<OutboxPorts["deadLetter"]>(async () => {})
    const report = await dispatchOnce(
      ports({
        claimDue: async () => [record({ event: event({ type: "DecideApproval" }) })],
        deadLetter: deadLetter as OutboxPorts["deadLetter"],
      }),
      { now: NOW },
    )
    expect(report.deadLettered).toBe(1)
    expect(deadLetter.mock.calls[0][3]).toMatch(/does not satisfy the DomainEvent contract/)
  })

  it("does not attempt delivery of an unparseable event", async () => {
    const deliver = jest.fn(async () => {})
    await dispatchOnce(
      ports({
        claimDue: async () => [record({ event: event({ schemaVersion: 0 }) })],
        deliver: deliver as OutboxPorts["deliver"],
      }),
      { now: NOW },
    )
    expect(deliver).not.toHaveBeenCalled()
  })
})

describe("backoff", () => {
  it("grows exponentially and caps", async () => {
    expect(backoffMs(1, 0.5)).toBeLessThan(backoffMs(3, 0.5))
    expect(backoffMs(3, 0.5)).toBeLessThan(backoffMs(6, 0.5))
    // Capped, or attempt 8 would schedule a retry weeks out.
    expect(backoffMs(30, 0.5)).toBeLessThanOrEqual(60 * 60 * 1000)
  })

  it("jitters, so a batch that failed together does not return together", async () => {
    // Without this, a transient downstream blip becomes a sustained one at
    // exactly the moment the downstream is least able to absorb it.
    const low = backoffMs(4, 0)
    const high = backoffMs(4, 1)
    expect(low).not.toBe(high)
    expect(high / low).toBeGreaterThan(1.5)
  })

  it("uses the injected jitter, so schedules are deterministic in a test", async () => {
    const scheduleRetry = jest.fn<OutboxPorts["scheduleRetry"]>(async () => {})
    await dispatchOnce(
      ports({
        deliver: async () => {
          throw new Error("x")
        },
        scheduleRetry: scheduleRetry as OutboxPorts["scheduleRetry"],
      }),
      { now: NOW, jitter: () => 0 },
    )
    const availableAt = scheduleRetry.mock.calls[0][1] as string
    expect(availableAt).toBe(new Date(Date.parse(NOW) + backoffMs(1, 0)).toISOString())
  })
})

describe("replay", () => {
  function replayPorts(dead: OutboxRecord[], over: Partial<ReplayPorts> = {}): ReplayPorts {
    return {
      listDead: async () => dead,
      requeue: async () => {},
      ...over,
    }
  }

  it("refuses to replay everything", async () => {
    // A dead letter failed eight times and the reason is usually still true.
    // Replaying the whole queue reproduces the incident and buries the one
    // record that would have succeeded.
    await expect(replay(replayPorts([]), [], { at: NOW })).rejects.toThrow(/needs explicit ids/)
  })

  it("refuses a bulk replay above the limit", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `ob-${i}`)
    await expect(replay(replayPorts([]), ids, { at: NOW })).rejects.toThrow(/load test/)
  })

  it("requeues only records that are actually dead", async () => {
    // Requeuing a pending or in-flight record duplicates it deliberately, which
    // is the one duplication this design does not accept.
    const requeue = jest.fn(async () => {})
    const out = await replay(
      replayPorts([record({ outboxId: "ob-dead", state: "dead", deadLetteredAt: NOW })], {
        requeue: requeue as ReplayPorts["requeue"],
      }),
      ["ob-dead", "ob-pending"],
      { at: NOW },
    )
    expect(out.requeued).toEqual(["ob-dead"])
    expect(out.refused).toEqual(["ob-pending"])
    expect(requeue).toHaveBeenCalledTimes(1)
    expect(requeue).toHaveBeenCalledWith("ob-dead", NOW)
  })
})
