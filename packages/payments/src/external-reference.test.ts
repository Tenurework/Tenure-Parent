import {
  UnqualifiedReferenceError,
  qualify,
  refKey,
  tenantScopedIdempotencyKey,
} from "./external-reference"

/**
 * PAY-020-004 / PAY-030-003.
 *
 * The claim under test is narrow and worth stating: a provider id is not a key
 * until it is qualified, and this module refuses rather than defaults. A
 * default mode is how a live reconciliation ends up keyed as test — the caller
 * that did not know its mode is exactly the one whose guess is wrong.
 */

const COMPLETE = {
  institutionId: "inst_1",
  provider: "Stripe",
  mode: "live",
  programId: "prog_1",
  connectedAccountId: "acct_1",
  objectType: "customer",
  externalId: "cus_9",
  canonicalId: "tenure_cust_9",
}

describe("qualify", () => {
  it("returns the checked reference, normalising provider and mode", () => {
    const ref = qualify(COMPLETE)
    expect(ref.provider).toBe("stripe")
    expect(ref.mode).toBe("live")
    expect(ref.canonicalId).toBe("tenure_cust_9")
    expect(ref.programId).toBe("prog_1")
  })

  it.each([
    ["provider", { provider: undefined }],
    ["mode", { mode: undefined }],
    ["connectedAccountId", { connectedAccountId: "" }],
    ["objectType", { objectType: "   " }],
    ["externalId", { externalId: null }],
    ["canonicalId", { canonicalId: undefined }],
    ["institutionId", { institutionId: undefined }],
  ])("refuses a reference missing %s", (field, override) => {
    expect(() => qualify({ ...COMPLETE, ...override })).toThrow(UnqualifiedReferenceError)
    try {
      qualify({ ...COMPLETE, ...override })
    } catch (error) {
      // The refusal NAMES what is missing. "Invalid reference" is not something
      // a caller can act on.
      expect((error as UnqualifiedReferenceError).missing.join(" ")).toContain(field)
    }
  })

  it("refuses a mode that is neither test nor live", () => {
    // "sandbox" is a real word other providers use, and accepting it as a third
    // partition would make the uniqueness constraint stop constraining: the
    // same object could sit under "test" and under "sandbox" at once.
    expect(() => qualify({ ...COMPLETE, mode: "sandbox" })).toThrow(UnqualifiedReferenceError)
  })

  it("keeps programId optional — not every provider has one", () => {
    expect(qualify({ ...COMPLETE, programId: undefined }).programId).toBeNull()
  })
})

describe("refKey", () => {
  it("separates the same external id across modes and accounts", () => {
    const live = refKey(qualify(COMPLETE))
    const test = refKey(qualify({ ...COMPLETE, mode: "test" }))
    const otherAccount = refKey(qualify({ ...COMPLETE, connectedAccountId: "acct_2" }))
    const otherType = refKey(qualify({ ...COMPLETE, objectType: "payment_intent" }))

    expect(new Set([live, test, otherAccount, otherType]).size).toBe(4)
  })

  it("does not collide when a segment boundary is ambiguous", () => {
    // The classic delimiter bug: ("acct_1", "customer") joined by a character
    // that is legal inside a part would equal ("acct_1|customer", "").
    const a = refKey(qualify({ ...COMPLETE, connectedAccountId: "acct_1", objectType: "customer" }))
    const b = refKey(qualify({ ...COMPLETE, connectedAccountId: "acct_1", objectType: "cust" }))
    expect(a).not.toBe(b)
  })
})

describe("tenantScopedIdempotencyKey", () => {
  it("carries the tenant in the value, so two tenants cannot share a key", () => {
    expect(tenantScopedIdempotencyKey("inst_a", "req-1")).not.toBe(
      tenantScopedIdempotencyKey("inst_b", "req-1"),
    )
  })

  it("is stable for the same tenant and key, so a retry replays", () => {
    expect(tenantScopedIdempotencyKey("inst_a", "req-1")).toBe(
      tenantScopedIdempotencyKey("inst_a", "req-1"),
    )
  })

  it("refuses a blank tenant rather than composing a key every tenant shares", () => {
    expect(() => tenantScopedIdempotencyKey("", "req-1")).toThrow(UnqualifiedReferenceError)
    expect(() => tenantScopedIdempotencyKey("inst_a", "  ")).toThrow(UnqualifiedReferenceError)
  })
})
