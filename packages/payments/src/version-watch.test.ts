import { PROVIDER_API_VERSION, SUPPORTED_EVENT_TYPES } from "./api-version"
import { PAYMENT_CAPABILITIES, capabilityState } from "./capability-registry"
import { PAYMENTS_OPERATIONS_QUEUE } from "./refusal"
import { watchProviderApiVersion, watchProviderFeatures } from "./version-watch"

/**
 * PAY-010-007 — a provider change produces review tasks and changes nothing.
 *
 * The property that carries this requirement is negative, so it is asserted the
 * only way a negative can be: a deep snapshot of the registry and the pin taken
 * before the watch runs, compared after. A watcher that "helpfully" widened a
 * reviewed window would be caught by that and by nothing else — every task
 * assertion below would still be green, because it would have widened the
 * window and then reported the task it no longer needed.
 */

const ORIGINAL_STATES = PAYMENT_CAPABILITIES.map((c) => `${c.id}=${c.state}`)

describe("a candidate version the leaves were not reviewed under raises one task each", () => {
  it("raises a task for every provider-backed leaf and none for the leaf with no provider", () => {
    const report = watchProviderApiVersion("2027-02-28")

    expect(report.candidateVersion).toBe("2027-02-28")
    expect(report.pinnedVersion).toBe(PROVIDER_API_VERSION)
    expect(report.alreadyReviewed).toEqual([])
    expect(report.notApplicable).toEqual(["internal.allocations-and-settlement-instructions"])
    expect(report.tasks).toHaveLength(PAYMENT_CAPABILITIES.length - 1)

    for (const task of report.tasks) {
      expect(task.queue).toBe(PAYMENTS_OPERATIONS_QUEUE)
      expect(task.reviewedUnder).toBe(PROVIDER_API_VERSION)
      expect(task.candidateVersion).toBe("2027-02-28")
      expect(task.question).toContain(task.capabilityId)
      expect(task.question).toContain("2027-02-28")
      // Nothing is money-facing today, so nothing is withdrawn by adopting it.
      expect(task.withdrawsMoneyFacingCapability).toBe(false)
    }
  })

  it("raises nothing for the version production is already pinned to", () => {
    const report = watchProviderApiVersion(PROVIDER_API_VERSION)
    expect(report.tasks).toEqual([])
    expect(report.alreadyReviewed).toHaveLength(PAYMENT_CAPABILITIES.length - 1)
  })

  it("flags the tasks that would withdraw a live capability", () => {
    // The distinction the field exists for: a PLANNED leaf falling out of its
    // window is backlog, a GA one is somebody's payments stopping.
    const leaf = PAYMENT_CAPABILITIES.find((c) => c.id === "acceptance.card-and-wallet")!
    const original = leaf.state
    ;(leaf as { state: string }).state = "GA"
    try {
      const report = watchProviderApiVersion("2027-02-28")
      const task = report.tasks.find((t) => t.capabilityId === "acceptance.card-and-wallet")!
      expect(task.withdrawsMoneyFacingCapability).toBe(true)
      expect(report.tasks.filter((t) => t.withdrawsMoneyFacingCapability)).toHaveLength(1)
    } finally {
      ;(leaf as { state: string }).state = original
    }
  })

  it("refuses a candidate that is not a provider date version", () => {
    // Not an empty task list. A string that is not a version sorts as older
    // than everything, which would report "nothing to review".
    expect(() => watchProviderApiVersion("next")).toThrow(/not a provider API version/)
  })
})

describe("the watch mutates nothing", () => {
  it("leaves every state and every reviewed window exactly as it found them", () => {
    const before = JSON.stringify(PAYMENT_CAPABILITIES)
    const pinnedBefore = PROVIDER_API_VERSION
    const stateBefore = capabilityState("acceptance.card-and-wallet", "2026-08-01T00:00:00.000Z")

    watchProviderApiVersion("2027-02-28")
    watchProviderFeatures(["treasury.outbound_payment.posted"], ["cards.unlimited-spending"])

    expect(JSON.stringify(PAYMENT_CAPABILITIES)).toBe(before)
    expect(PROVIDER_API_VERSION).toBe(pinnedBefore)
    expect(capabilityState("acceptance.card-and-wallet", "2026-08-01T00:00:00.000Z")).toBe(
      stateBefore,
    )
    expect(PAYMENT_CAPABILITIES.map((c) => `${c.id}=${c.state}`)).toEqual(ORIGINAL_STATES)
  })

  it("says so in the report, as a value", () => {
    expect(watchProviderApiVersion("2027-02-28").mutatesProduction).toBe(false)
  })

  it("does not register the announced feature it raises a task about", () => {
    const tasks = watchProviderFeatures(["treasury.outbound_payment.posted"])
    expect(tasks).toHaveLength(1)
    expect(SUPPORTED_EVENT_TYPES.map((e) => e.type)).not.toContain(
      "treasury.outbound_payment.posted",
    )
  })
})

describe("an announced feature this build has no reader for is a task, not an import", () => {
  it("raises one per unknown event type and per unknown capability id", () => {
    const tasks = watchProviderFeatures(
      ["treasury.outbound_payment.posted", "issuing_authorization.request"],
      ["cards.unlimited-spending"],
    )
    expect(tasks.map((t) => t.kind)).toEqual(["event-type", "event-type", "capability"])
    for (const task of tasks) {
      expect(task.queue).toBe(PAYMENTS_OPERATIONS_QUEUE)
      expect(task.question).toContain(task.announced)
    }
  })

  it("is silent about everything this build already knows", () => {
    const known = SUPPORTED_EVENT_TYPES.map((e) => e.type)
    expect(known.length).toBeGreaterThanOrEqual(7)
    expect(watchProviderFeatures(known, PAYMENT_CAPABILITIES.map((c) => c.id))).toEqual([])
  })
})
