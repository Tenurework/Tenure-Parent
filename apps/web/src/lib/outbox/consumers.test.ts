import { describe, expect, it } from "@jest/globals"
import { MODULE_CATALOG } from "@tenure/modules"

import { __testing, allConsumers, consumersFor, type OutboxConsumer } from "./consumers"

/**
 * WRK-060-003 — the refusal that keeps the runner honest to the catalog.
 *
 * `modules/index.ts` declares which module consumes which event, and the runner
 * is held to that declaration rather than to a list of its own. The refusal is
 * loop prevention as much as bookkeeping: a handler may only receive what its
 * module said it consumes, so a handler cannot quietly subscribe to the event
 * type it emits and drive itself.
 *
 * It runs at import time, which is the only time it can stop a bad handler
 * shipping — and therefore the reason it cannot be provoked by importing this
 * module in a test. `__testing.assertDeclared` is the same function the module
 * body calls on the real list, so what these assert is the production check.
 */

const { assertDeclared } = __testing

const stub = (over: Partial<OutboxConsumer> = {}): OutboxConsumer => ({
  module: "memory",
  eventType: "ApprovalDecided",
  name: "memory.approval-decided",
  handle: async () => {},
  ...over,
})

describe("holding a consumer to what the catalog declares", () => {
  it("accepts a handler whose module declares the event type", () => {
    expect(() => assertDeclared([stub()])).not.toThrow()
    // The declaration it is being held to is real, not a fixture.
    expect(MODULE_CATALOG.get("memory")?.consumes).toContain("ApprovalDecided")
  })

  it("refuses a handler for a module that is not in the catalog", () => {
    expect(() => assertDeclared([stub({ module: "invented" })])).toThrow(
      /not in the module catalog/,
    )
  })

  it("refuses a handler for an event the module never declared", () => {
    // This is the loop prevention. `memory` does not declare that it consumes
    // `MemoryRecorded`, so a handler that reacted to its own output could not
    // be registered even if somebody wrote one.
    expect(() => assertDeclared([stub({ eventType: "MemoryRecorded" })])).toThrow(
      /which module "memory" does not/,
    )
  })

  it("refuses two consumers sharing a name, because InboxEvent keys on it", () => {
    // Two handlers under one name means one consuming marks the other consumed,
    // and the second one's work silently never happens.
    expect(() => assertDeclared([stub(), stub({ eventType: "ApprovalDecided" })])).toThrow(
      /share the name/,
    )
  })

  it("registers exactly the consumers the catalog can account for", () => {
    for (const consumer of allConsumers()) {
      expect(MODULE_CATALOG.get(consumer.module)?.consumes ?? []).toContain(consumer.eventType)
    }
    expect(consumersFor("ApprovalDecided").map((c) => c.name)).toEqual(["memory.approval-decided"])
    // An event with no consumer is a legitimate answer, not a misconfiguration:
    // `approvals` consumes `ApprovalRequested` by waiting for a person.
    expect(consumersFor("ApprovalRequested")).toEqual([])
  })
})
