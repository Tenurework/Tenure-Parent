import { chooseFundsFlow, type FundsFlowConfig, type MerchantProfile } from "./funds-flow"
import { PAYMENT_CAPABILITIES } from "./capability-registry"
import type { ResponsibilityConfig } from "./responsibility"

/**
 * PAY-070-002. Every assertion here is on what `chooseFundsFlow` EMITS.
 *
 * Calling `resolveResponsibility` directly and asserting on its output would
 * stay green the day this function stopped consulting it, which is the exact
 * regression the requirement is about.
 */

const DIRECT_LEAF = "funds-flow.direct-charge"

/** The pilot's shape: a US university, eligible on every matrix axis. */
const MERCHANT: MerchantProfile = {
  id: "le_rochester",
  capabilityId: DIRECT_LEAF,
  country: "US",
  currency: "USD",
  legalEntityType: "NON_PROFIT",
  businessType: "EDUCATION",
}

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

/**
 * The capability as if Tenure had certified it.
 *
 * Nothing in the shipped registry is transactable, and that is correct — but a
 * flow decision that could only ever be tested against an ineligible merchant
 * would never exercise the branch that matters. So eligibility is made to pass
 * by pointing the merchant at a leaf and stubbing ONLY the registry read, with
 * the real matrix values, in the one test that needs it.
 */
function withCertifiedLeaf<T>(run: () => T): T {
  const leaf = PAYMENT_CAPABILITIES.find((c) => c.id === DIRECT_LEAF)!
  const original = leaf.state
  // The registry is a frozen-by-convention literal, not a frozen object; this
  // is the narrowest possible way to reach the "eligible" branch and it is put
  // back in a finally so no other test sees it.
  ;(leaf as { state: string }).state = "GA_LIMITED"
  try {
    return run()
  } finally {
    ;(leaf as { state: string }).state = original
  }
}

describe("direct is the default, when it is earned", () => {
  it("chooses direct for an eligible merchant whose eight axes resolve", () => {
    const choice = withCertifiedLeaf(() =>
      chooseFundsFlow(MERCHANT, { direct: COMPLETE } as FundsFlowConfig),
    )
    expect(choice.flow).toBe("direct")
    expect(choice.reason).toContain("direct charge")
    expect(choice.eligibility).toEqual([])
  })

  it("does NOT choose direct when lossPayer is unset", () => {
    // MUTATION TARGET: returning `direct` unconditionally reds this.
    const partial: ResponsibilityConfig = {
      defaults: { ...COMPLETE.defaults, lossPayer: undefined },
    }
    const choice = withCertifiedLeaf(() =>
      chooseFundsFlow(MERCHANT, { direct: partial } as FundsFlowConfig),
    )
    expect(choice.flow).not.toBe("direct")
    expect(choice.flow).toBeNull()
    const directRefusal = choice.refusedFlows.find((r) => r.flow === "direct")!
    expect(directRefusal.blockers.join(" ")).toContain("lossPayer")
  })

  it("names the failing axes on every refused flow", () => {
    const choice = withCertifiedLeaf(() => chooseFundsFlow(MERCHANT, {}))
    expect(choice.flow).toBeNull()
    expect(choice.refusedFlows).toHaveLength(3)
    for (const refusal of choice.refusedFlows) {
      expect(refusal.blockers[0]).toContain("8 responsibility axes unresolved")
      expect(refusal.blockers[0]).toContain("merchantDisplay")
    }
  })
})

describe("the lowest-liability complete flow wins", () => {
  it("falls to destination only when direct is incomplete and destination is not", () => {
    const choice = withCertifiedLeaf(() =>
      chooseFundsFlow(MERCHANT, {
        direct: { defaults: { merchantDisplay: "TENANT" } },
        destination: { defaults: { ...COMPLETE.defaults, lossPayer: "TENURE" } },
      } as FundsFlowConfig),
    )
    expect(choice.flow).toBe("destination")
    expect(choice.reason).toContain("exception approval")
    expect(choice.refusedFlows.map((r) => r.flow)).toEqual([
      "direct",
      "separate_charges_and_transfers",
    ])
  })

  it("prefers direct even when a liability-shifting flow is also complete", () => {
    const choice = withCertifiedLeaf(() =>
      chooseFundsFlow(MERCHANT, {
        direct: COMPLETE,
        destination: { defaults: { ...COMPLETE.defaults, lossPayer: "TENURE" } },
      } as FundsFlowConfig),
    )
    expect(choice.flow).toBe("direct")
  })
})

describe("eligibility comes first", () => {
  it("returns no flow at all when the merchant is not eligible", () => {
    // The shipped registry has nothing transactable, so this is the real
    // production answer today and it should be a refusal, not `direct`.
    const choice = chooseFundsFlow(MERCHANT, { direct: COMPLETE } as FundsFlowConfig)
    expect(choice.flow).toBeNull()
    expect(choice.eligibility.map((b) => b.code)).toContain("capability-not-transactable")
    expect(choice.reason).toContain("not eligible")
    for (const refusal of choice.refusedFlows) {
      expect(refusal.blockers[0]).toContain("not eligible")
    }
  })

  it("refuses on eligibility even when all three flows are fully configured", () => {
    const choice = chooseFundsFlow(MERCHANT, {
      direct: COMPLETE,
      destination: COMPLETE,
      separate_charges_and_transfers: COMPLETE,
    } as FundsFlowConfig)
    expect(choice.flow).toBeNull()
  })

  it("always reports eight axes for the direct flow, even on a refusal", () => {
    const choice = chooseFundsFlow(MERCHANT, {})
    expect(choice.responsibility).toHaveLength(8)
  })
})
