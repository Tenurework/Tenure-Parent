import { PAYMENT_CAPABILITIES } from "./capability-registry"
import { decideChargeModel, type ChargeModelInput } from "./charge-model"
import type { ResponsibilityConfig } from "./responsibility"

/**
 * PAY-040-003. Every input in the requirement is load-bearing, and a decision
 * with no supporting configuration is REFUSED rather than defaulted to DIRECT.
 */

const LEAF = "funds-flow.direct-charge"

const COMPLETE: ResponsibilityConfig = {
  defaults: {
    merchantDisplay: "TENANT",
    feePayer: "TENANT",
    lossPayer: "TENANT",
    refundPayer: "TENANT",
    disputeOwner: "TENANT",
    kycUpdateOwner: "PROVIDER",
    accountCollectionOwner: "PROVIDER",
    supportOwner: "TENANT",
  },
}

function input(overrides: Partial<ChargeModelInput> = {}): ChargeModelInput {
  return {
    useCase: "TENANT_CUSTOMER_SALE",
    capabilityId: LEAF,
    seller: {
      legalEntityId: "le_rochester",
      country: "US",
      legalEntityType: "NON_PROFIT",
      businessType: "EDUCATION",
    },
    buyer: { country: "US", kind: "INDIVIDUAL" },
    region: "US",
    currency: "USD",
    connectedAccount: {
      accountId: "acct_1",
      chargesEnabled: true,
      payoutsEnabled: true,
      responsibility: { direct: COMPLETE },
    },
    lossBearer: "TENANT",
    amounts: { grossCents: 12000, platformFeeCents: 0 },
    ...overrides,
  }
}

/** See funds-flow.test.ts — the one narrow stub that reaches the eligible branch. */
function withCertifiedLeaf<T>(run: () => T): T {
  const leaf = PAYMENT_CAPABILITIES.find((c) => c.id === LEAF)!
  const original = leaf.state
  ;(leaf as { state: string }).state = "GA_LIMITED"
  try {
    return run()
  } finally {
    ;(leaf as { state: string }).state = original
  }
}

describe("the region is a real input", () => {
  it("blocks a region the capability is not certified to acquire in", () => {
    // MUTATION TARGET: dropping the region from the decision reds this.
    const decision = withCertifiedLeaf(() => decideChargeModel(input({ region: "ZZ" })))
    expect(decision.model).toBeNull()
    expect(decision.blockers.join(" ")).toContain("region-not-certified")
  })

  it("blocks cross-border acquiring even when both ends are certified", () => {
    const decision = withCertifiedLeaf(() => decideChargeModel(input({ region: "GB" })))
    expect(decision.model).toBeNull()
    expect(decision.blockers.join(" ")).toContain("region-cross-border-acquiring")
    expect(decision.blockers.join(" ")).toContain("GB")
  })

  it("blocks a region that is not a country code at all, and says so once", () => {
    const decision = withCertifiedLeaf(() => decideChargeModel(input({ region: "EUROPE" })))
    expect(decision.blockers.filter((b) => b.startsWith("region-"))).toHaveLength(1)
    expect(decision.blockers[0]).toContain("region-not-a-country")
  })

  it("does not block when the region matches the seller and the capability", () => {
    const decision = withCertifiedLeaf(() => decideChargeModel(input()))
    expect(decision.blockers.filter((b) => b.startsWith("region-"))).toEqual([])
    expect(decision.model).toBe("DIRECT")
    expect(decision.region).toBe("US")
  })
})

describe("a decision with no supporting configuration is refused", () => {
  it("returns model null — never DIRECT — when the responsibility matrix is empty", () => {
    const decision = withCertifiedLeaf(() =>
      decideChargeModel(
        input({
          connectedAccount: {
            accountId: "acct_1",
            chargesEnabled: true,
            payoutsEnabled: true,
            responsibility: {},
          },
        }),
      ),
    )
    expect(decision.model).toBeNull()
    expect(decision.liableParty).toBeNull()
    expect(decision.blockers.join(" ")).toContain("funds-flow-unavailable")
  })

  it("refuses with no connected account, and with one that cannot take charges", () => {
    const none = withCertifiedLeaf(() =>
      decideChargeModel(
        input({
          connectedAccount: {
            accountId: null,
            chargesEnabled: false,
            payoutsEnabled: false,
            responsibility: { direct: COMPLETE },
          },
        }),
      ),
    )
    expect(none.blockers.join(" ")).toContain("no-connected-account")

    const disabled = withCertifiedLeaf(() =>
      decideChargeModel(
        input({
          connectedAccount: {
            accountId: "acct_1",
            chargesEnabled: false,
            payoutsEnabled: true,
            responsibility: { direct: COMPLETE },
          },
        }),
      ),
    )
    expect(disabled.blockers.join(" ")).toContain("charges-not-enabled")
  })

  it("refuses an internal allocation — no external boundary is crossed", () => {
    const decision = withCertifiedLeaf(() =>
      decideChargeModel(input({ useCase: "INTERNAL_ALLOCATION" })),
    )
    expect(decision.model).toBeNull()
    expect(decision.blockers.join(" ")).toContain("internal-allocation-is-not-a-charge")
  })

  it("refuses a platform fee, which Bible §0.6 disables by default", () => {
    const decision = withCertifiedLeaf(() =>
      decideChargeModel(input({ amounts: { grossCents: 12000, platformFeeCents: 250 } })),
    )
    expect(decision.blockers.join(" ")).toContain("platform-fee-not-enabled")
  })

  it("refuses when nobody has said who bears loss", () => {
    const decision = withCertifiedLeaf(() => decideChargeModel(input({ lossBearer: null })))
    expect(decision.blockers.join(" ")).toContain("loss-bearer-unanswered")
  })

  it("refuses when the stated loss bearer contradicts the matrix", () => {
    const decision = withCertifiedLeaf(() => decideChargeModel(input({ lossBearer: "TENURE" })))
    expect(decision.blockers.join(" ")).toContain("loss-bearer-contradicts-configuration")
  })
})

describe("the decision carries its reasons, never a bare enum", () => {
  it("names the use case, both parties, the region and the currency", () => {
    const decision = withCertifiedLeaf(() => decideChargeModel(input()))
    const prose = decision.reasons.join(" ")
    expect(prose).toContain("TENANT_CUSTOMER_SALE")
    expect(prose).toContain("le_rochester")
    expect(prose).toContain("NON_PROFIT")
    expect(prose).toContain("INDIVIDUAL")
    expect(prose).toContain("USD")
    expect(prose).toContain("Charge model DIRECT")
    expect(decision.liableParty).toBe("TENANT")
  })

  it("maps a destination funds flow to DESTINATION and keeps the liable party", () => {
    const decision = withCertifiedLeaf(() =>
      decideChargeModel(
        input({
          lossBearer: "TENURE",
          connectedAccount: {
            accountId: "acct_1",
            chargesEnabled: true,
            payoutsEnabled: true,
            responsibility: {
              direct: { defaults: { merchantDisplay: "TENANT" } },
              destination: { defaults: { ...COMPLETE.defaults, lossPayer: "TENURE" } },
            },
          },
        }),
      ),
    )
    expect(decision.model).toBe("DESTINATION")
    expect(decision.liableParty).toBe("TENURE")
    expect(decision.blockers).toEqual([])
  })
})

describe("eligibility is upstream of the model", () => {
  it("refuses on the shipped registry, where nothing is transactable", () => {
    const decision = decideChargeModel(input())
    expect(decision.model).toBeNull()
    expect(decision.blockers.join(" ")).toContain("capability-not-transactable")
  })
})
