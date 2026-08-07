import { simulateCurrencySelection, simulateEligibility } from "./eligibility"
import { PAYMENT_CAPABILITIES, settlementCurrencies } from "./capability-registry"

/**
 * PAY-010-006. The property under test is not "the answer is right" — it is
 * that ALL of the answer arrives at once, and that it comes from the declared
 * matrix rather than from a constant.
 */

const PLANNED_LEAF = "acceptance.card-and-wallet"
const UNSUPPORTED_LEAF = "cards.physical-and-virtual"

describe("every blocker, not the first", () => {
  it("returns five blockers for a request that is wrong on every axis", () => {
    // MUTATION TARGET: returning only the first blocker reds this.
    const result = simulateEligibility({
      capabilityId: UNSUPPORTED_LEAF,
      country: "ZZ",
      currency: "XPF",
      legalEntityType: "INDIVIDUAL",
      businessType: "RETAIL",
    })

    expect(result.eligible).toBe(false)
    expect(result.blockers.map((b) => b.subject)).toEqual([
      "capabilityState",
      "country",
      "currency",
      "entity",
      "businessType",
    ])
    expect(result.blockers).toHaveLength(5)
  })

  it("still returns every blocker when only some axes fail", () => {
    const result = simulateEligibility({
      capabilityId: PLANNED_LEAF,
      country: "ZZ",
      currency: "XPF",
      legalEntityType: "COMPANY",
      businessType: "EDUCATION",
    })

    expect(result.blockers.map((b) => b.code)).toEqual([
      "capability-not-transactable",
      "country-not-supported",
      "currency-not-supported",
    ])
  })

  it("names what would unblock each one, never 'contact support'", () => {
    const result = simulateEligibility({
      capabilityId: PLANNED_LEAF,
      country: "ZZ",
      currency: "XPF",
      legalEntityType: "INDIVIDUAL",
      businessType: "RETAIL",
    })
    for (const blocker of result.blockers) {
      expect(blocker.whatWouldUnblock.length).toBeGreaterThan(20)
      expect(blocker.whatWouldUnblock.toLowerCase()).not.toContain("contact support")
    }
  })
})

describe("the verdict comes from the registry, not from a constant", () => {
  it("blocks on state for an UNSUPPORTED capability even when every other axis is fine", () => {
    // MUTATION TARGET: ignoring the capability's state reds this.
    const result = simulateEligibility({
      capabilityId: UNSUPPORTED_LEAF,
      country: "US",
      currency: "USD",
      legalEntityType: "COMPANY",
      businessType: "EDUCATION",
    })
    expect(result.blockers.some((b) => b.subject === "capabilityState")).toBe(true)
    expect(result.blockers[0].code).toBe("capability-not-transactable")
  })

  it("blocks a PLANNED capability on state even with a perfect matrix match", () => {
    const cap = PAYMENT_CAPABILITIES.find((c) => c.id === PLANNED_LEAF)!
    const result = simulateEligibility({
      capabilityId: cap.id,
      country: cap.countries[0],
      currency: cap.currencies[0],
      legalEntityType: cap.legalEntityTypes[0],
      businessType: cap.businessTypes[0],
    })
    // Nothing is transactable today, and the ONLY thing wrong is the state.
    expect(result.eligible).toBe(false)
    expect(result.blockers).toHaveLength(1)
    expect(result.blockers[0].code).toBe("capability-not-transactable")
  })

  it("moves with the matrix rather than with a hardcoded list", () => {
    const cap = PAYMENT_CAPABILITIES.find((c) => c.id === PLANNED_LEAF)!
    const declared = cap.countries[1]
    const undeclared = "ZZ"
    expect(cap.countries).toContain(declared)
    expect(cap.countries).not.toContain(undeclared)

    const ok = simulateEligibility({
      capabilityId: cap.id,
      country: declared,
      currency: cap.currencies[0],
      legalEntityType: cap.legalEntityTypes[0],
      businessType: cap.businessTypes[0],
    })
    const bad = simulateEligibility({
      capabilityId: cap.id,
      country: undeclared,
      currency: cap.currencies[0],
      legalEntityType: cap.legalEntityTypes[0],
      businessType: cap.businessTypes[0],
    })
    expect(ok.blockers.some((b) => b.subject === "country")).toBe(false)
    expect(bad.blockers.some((b) => b.subject === "country")).toBe(true)
  })

  it("is case-insensitive about ISO codes, because operators type them both ways", () => {
    const lower = simulateEligibility({
      capabilityId: PLANNED_LEAF,
      country: "us",
      currency: "usd",
      legalEntityType: "COMPANY",
      businessType: "EDUCATION",
    })
    expect(lower.blockers.map((b) => b.subject)).toEqual(["capabilityState"])
  })

  it("refuses an unregistered capability rather than answering about it", () => {
    expect(() =>
      simulateEligibility({
        capabilityId: "acceptance.the-one-i-read-about",
        country: "US",
        currency: "USD",
        legalEntityType: "COMPANY",
        businessType: "EDUCATION",
      }),
    ).toThrow(/No payments capability/)
  })
})

describe("the currency selection reader behind platform.localization.currency", () => {
  it("accepts every currency the shipped blueprints publish", () => {
    for (const code of ["USD", "GBP", "AED"]) {
      expect(simulateCurrencySelection(code).eligible).toBe(true)
    }
  })

  it("refuses a formattable currency nothing can settle, and says what can", () => {
    const verdict = simulateCurrencySelection("XPF")
    expect(verdict.eligible).toBe(false)
    expect(verdict.blockers).toHaveLength(1)
    expect(verdict.blockers[0].code).toBe("currency-has-no-settleable-capability")
    for (const code of settlementCurrencies()) {
      expect(verdict.blockers[0].whatWouldUnblock).toContain(code)
    }
  })

  it("is the union across the registry, so it tracks the matrix", () => {
    for (const code of settlementCurrencies()) {
      expect(simulateCurrencySelection(code).eligible).toBe(true)
    }
  })
})
