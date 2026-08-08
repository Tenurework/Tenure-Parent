import { gateChange, type ChangeGateInput } from "./command-handlers"

/**
 * STUDIO-060-007 — the C1–C7 gate, asserted on the DISPATCHER.
 *
 * Every assertion here calls `gateChange`, which is what `runAdvance` calls
 * before it reads a manifest or resolves anything. Nothing here calls
 * `requirementsFor` directly: a test that asserts a property by calling the
 * helper stays green on the day the dispatcher stops using it, and the mutation
 * proof recorded for this item is exactly that — `classify` frozen to return C1
 * for every operation, which leaves `requirementsFor` untouched and correct and
 * lets a tenant purge straight through.
 *
 * ── The cooling-off stand-in ───────────────────────────────────────────────
 *
 * `clock()` below reproduces the property that makes the real store safe rather
 * than the shape of its API: the FIRST write for a key wins and every later call
 * returns the stored record. That is what `startCoolingOff` gets from
 * DynamoDB's `attribute_not_exists`, and it is the only property the gate
 * depends on. A stand-in that returned `{ requestedAt: now }` every time would
 * make the cooling-off check pass instantly and prove nothing — which is
 * precisely the caller-supplied-clock defect this requirement was opened
 * against.
 */

function clock() {
  const stored = new Map<string, { requestedAt: string; requestedBy: string }>()
  return {
    calls: [] as string[],
    fn: async (action: string, requestedBy: string, at: string) => {
      const existing = stored.get(action)
      if (existing) return existing
      const record = { requestedAt: at, requestedBy }
      stored.set(action, record)
      return record
    },
    /** Pre-seed a clock that started earlier, the way a real one would read back. */
    seed(action: string, requestedAt: string, requestedBy: string) {
      stored.set(action, { requestedAt, requestedBy })
    },
    started(action: string) {
      return stored.has(action)
    },
  }
}

const AT = "2026-08-07T12:00:00.000Z"

function purge(over: Partial<ChangeGateInput> = {}, c = clock()): [Promise<ReturnType<typeof gateChange>>, ReturnType<typeof clock>] {
  const input: ChangeGateInput = {
    operation: { surface: "tenant-lifecycle", action: "PURGING", target: "simon-ose" },
    requestedBy: "dana@tenure.example",
    approvedBy: "sam@tenure.example",
    confirmation: "simon-ose",
    at: AT,
    coolingOffClock: c.fn,
    ...over,
  }
  return [gateChange(input) as never, c]
}

describe("the dispatcher refuses a change whose class demands more than it was given", () => {
  it("refuses a C7 whose typed confirmation does not exactly match", async () => {
    const [run] = purge({ confirmation: "Simon-OSE" })
    const result = await run
    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.changeClass).toBe("C7")
    expect(result.detail).toMatch(/Type exactly "simon-ose"/)
  })

  it("refuses a C7 with nothing typed, rather than treating absence as consent", async () => {
    const [run] = purge({ confirmation: undefined })
    const result = await run
    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.detail).toMatch(/Nothing was typed/)
  })

  it("does not start the cooling-off clock for a request refused on the token", async () => {
    // Otherwise an operator's typo starts a fifteen-minute wait they then have
    // to sit out for a request that was never valid.
    const c = clock()
    const [run] = purge({ confirmation: "wrong" }, c)
    await run
    expect(c.started("tenant-lifecycle:PURGING")).toBe(false)
  })

  it("refuses a C7 with no second approver", async () => {
    const [run] = purge({ approvedBy: undefined })
    const result = await run
    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.detail).toMatch(/second operator/)
  })

  it("refuses a C7 approved by the person who asked for it", async () => {
    const [run] = purge({ approvedBy: "dana@tenure.example" })
    const result = await run
    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.detail).toMatch(/SECOND identity/)
  })

  it("refuses a C7 on the first ask and starts the clock", async () => {
    const c = clock()
    const [run] = purge({}, c)
    const result = await run
    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.detail).toMatch(/cooling-off period/)
    expect(result.detail).toMatch(/15 minute\(s\) remain/)
    expect(c.started("tenant-lifecycle:PURGING")).toBe(true)
  })

  it("measures the wait against the PERSISTED start, not the submitted one", async () => {
    // The defect this exists for: a cooling-off period checked against a
    // caller-supplied `requestedAt` is satisfied by sending one from an hour
    // ago. Here the request claims to be happening a day later and the stored
    // start is what decides.
    const c = clock()
    c.seed("tenant-lifecycle:PURGING", "2026-08-07T11:59:00.000Z", "dana@tenure.example")
    const [stillWaiting] = purge({}, c)
    const waiting = await stillWaiting
    expect(waiting.allowed).toBe(false)
    if (waiting.allowed) return
    expect(waiting.detail).toMatch(/14 minute\(s\) remain/)
    expect(waiting.detail).toMatch(/it cannot be moved/)
  })

  it("refuses an elapsed, fully approved, correctly typed purge — because a machine must not do it", async () => {
    // Every earlier check passes. This is the refusal on principle, and it
    // carries the command a human runs under their own credentials.
    const c = clock()
    c.seed("tenant-lifecycle:PURGING", "2026-08-07T11:00:00.000Z", "dana@tenure.example")
    const [run] = purge({}, c)
    const result = await run
    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.changeClass).toBe("C7")
    expect(result.detail).toMatch(/not automatable/)
    expect(result.detail).toMatch(/aws dynamodb delete-item/)
    expect(result.detail).toMatch(/TENANT#simon-ose/)
  })
})

describe("the gate lets through what its class does not forbid", () => {
  const allow = (over: Partial<ChangeGateInput>) =>
    gateChange({
      operation: { surface: "tenant-lifecycle", action: "VALIDATING", target: "simon-ose" },
      requestedBy: "dana@tenure.example",
      at: AT,
      coolingOffClock: clock().fn,
      ...over,
    })

  it("allows a C3 lifecycle move with no token and one person", async () => {
    const result = await allow({})
    expect(result).toEqual({ allowed: true, changeClass: "C3" })
  })

  it("allows a C6 activation once the slug is typed and a second operator agrees", async () => {
    const result = await allow({
      operation: { surface: "tenant-lifecycle", action: "ACTIVATING", target: "simon-ose" },
      confirmation: "simon-ose",
      approvedBy: "sam@tenure.example",
    })
    expect(result).toEqual({ allowed: true, changeClass: "C6" })
  })

  it("refuses a C6 activation with the slug untyped", async () => {
    const result = await allow({
      operation: { surface: "tenant-lifecycle", action: "ACTIVATING", target: "simon-ose" },
      approvedBy: "sam@tenure.example",
    })
    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.changeClass).toBe("C6")
  })

  it("allows a C5 provisioning with two people and no typed token", async () => {
    // C5 spends money and is undone by tearing the resources down. A token here
    // would be one operators learn to type without reading, which is worse than
    // no token at all.
    const result = await allow({
      operation: { surface: "tenant-lifecycle", action: "PROVISIONING", target: "simon-ose" },
      approvedBy: "sam@tenure.example",
    })
    expect(result).toEqual({ allowed: true, changeClass: "C5" })
  })

  it("refuses a C5 provisioning with nobody else agreeing", async () => {
    const result = await allow({
      operation: { surface: "tenant-lifecycle", action: "PROVISIONING", target: "simon-ose" },
    })
    expect(result.allowed).toBe(false)
  })

  it("classifies reads as C1 and lets them through untouched", async () => {
    const result = await allow({ operation: { surface: "estate", action: "read", target: "*" } })
    expect(result).toEqual({ allowed: true, changeClass: "C1" })
  })
})
