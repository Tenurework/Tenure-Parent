import { PAYMENT_CAPABILITIES } from "./capability-registry"
import { decideChargeModel, type ChargeModelDecision, type ChargeModelInput } from "./charge-model"
import {
  assertLiabilityApproved,
  chargeModelDigest,
  liabilityExceptionRequest,
  requiresLiabilityException,
  type ApprovalRecord,
} from "./liability"
import type { ResponsibilityConfig } from "./responsibility"

/**
 * PAY-070-003. Two halves: the flow that shifts liability needs an approval,
 * and the approval is pinned to the exact decision it approved.
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

function decisionFor(
  flowConfig: ChargeModelInput["connectedAccount"]["responsibility"],
  overrides: Partial<ChargeModelInput> = {},
): ChargeModelDecision {
  return withCertifiedLeaf(() =>
    decideChargeModel({
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
        responsibility: flowConfig,
      },
      lossBearer: "TENANT",
      amounts: { grossCents: 12000, platformFeeCents: 0 },
      ...overrides,
    }),
  )
}

const DIRECT = () => decisionFor({ direct: COMPLETE })

const DESTINATION_ON_TENURE = (grossCents = 12000) =>
  decisionFor(
    {
      direct: { defaults: { merchantDisplay: "TENANT" } },
      destination: { defaults: { ...COMPLETE.defaults, lossPayer: "TENURE" } },
    },
    { lossBearer: "TENURE", amounts: { grossCents, platformFeeCents: 0 } },
  )

const SEPARATE_ON_TENURE = () =>
  decisionFor(
    {
      direct: { defaults: { merchantDisplay: "TENANT" } },
      destination: { defaults: { merchantDisplay: "TENANT" } },
      separate_charges_and_transfers: {
        defaults: { ...COMPLETE.defaults, lossPayer: "TENURE" },
      },
    },
    { lossBearer: "TENURE" },
  )

describe("which decisions need an exception", () => {
  it("does not for a direct charge carried by the tenant", () => {
    expect(requiresLiabilityException(DIRECT())).toBe(false)
  })

  it("does for a destination charge whose loss lands on Tenure", () => {
    expect(requiresLiabilityException(DESTINATION_ON_TENURE())).toBe(true)
  })

  it("does for separate charges and transfers whose loss lands on Tenure", () => {
    // MUTATION TARGET: returning false for SEPARATE_CHARGE_AND_TRANSFER reds
    // this AND the configuration-writer test in apps/web.
    const decision = SEPARATE_ON_TENURE()
    expect(decision.model).toBe("SEPARATE_CHARGE_AND_TRANSFER")
    expect(requiresLiabilityException(decision)).toBe(true)
  })

  it("does not when the same flow's loss lands on the connected account", () => {
    const decision = decisionFor({
      direct: { defaults: { merchantDisplay: "TENANT" } },
      destination: COMPLETE,
    })
    expect(decision.model).toBe("DESTINATION")
    expect(decision.liableParty).toBe("TENANT")
    expect(requiresLiabilityException(decision)).toBe(false)
  })

  it("does not for a refused decision — there is no flow to shift anything", () => {
    expect(requiresLiabilityException(decisionFor({}))).toBe(false)
  })
})

describe("the digest pins the exact decision, amounts included", () => {
  it("is stable for the same decision", () => {
    expect(chargeModelDigest(DESTINATION_ON_TENURE())).toBe(
      chargeModelDigest(DESTINATION_ON_TENURE()),
    )
  })

  it("changes when the amount changes", () => {
    // MUTATION TARGET: dropping the amounts from the canonical form reds this
    // and the post-approval-mutation case below.
    expect(chargeModelDigest(DESTINATION_ON_TENURE(12000))).not.toBe(
      chargeModelDigest(DESTINATION_ON_TENURE(12_000_000)),
    )
  })

  it("changes when the model changes", () => {
    expect(chargeModelDigest(DESTINATION_ON_TENURE())).not.toBe(
      chargeModelDigest(SEPARATE_ON_TENURE()),
    )
  })
})

describe("the gate refuses in three distinguishable ways", () => {
  const decision = () => DESTINATION_ON_TENURE()

  it("passes straight through when no liability is shifted", () => {
    const gate = assertLiabilityApproved(DIRECT(), [])
    expect(gate.ok).toBe(true)
  })

  it("refuses with nothing raised at all", () => {
    const gate = assertLiabilityApproved(decision(), [])
    expect(gate.ok).toBe(false)
    if (gate.ok) throw new Error("unreachable")
    expect(gate.code).toBe("liability-exception-missing")
    expect(gate.raise.type).toBe("EXCEPTION")
    expect(gate.raise.metadata.payments.decisionDigest).toBe(chargeModelDigest(decision()))
  })

  it("refuses while the pinned request is still pending", () => {
    const pinned: ApprovalRecord = {
      id: "ar_1",
      type: "EXCEPTION",
      status: "PENDING_OSE",
      decisionDigest: chargeModelDigest(decision()),
    }
    const gate = assertLiabilityApproved(decision(), [pinned])
    expect(gate.ok).toBe(false)
    if (gate.ok) throw new Error("unreachable")
    expect(gate.code).toBe("liability-exception-not-decided")
  })

  it("allows the write when the pinned request is APPROVED", () => {
    const approved: ApprovalRecord = {
      id: "ar_2",
      type: "EXCEPTION",
      status: "APPROVED",
      decisionDigest: chargeModelDigest(decision()),
    }
    const gate = assertLiabilityApproved(decision(), [approved])
    expect(gate.ok).toBe(true)
    if (!gate.ok) throw new Error("unreachable")
    expect(gate.approvalId).toBe("ar_2")
  })

  it("refuses after the decision is mutated, even with an APPROVED exception", () => {
    const approvedForSmall: ApprovalRecord = {
      id: "ar_3",
      type: "EXCEPTION",
      status: "APPROVED",
      decisionDigest: chargeModelDigest(DESTINATION_ON_TENURE(12000)),
    }
    const gate = assertLiabilityApproved(DESTINATION_ON_TENURE(12_000_000), [approvedForSmall])
    expect(gate.ok).toBe(false)
    if (gate.ok) throw new Error("unreachable")
    expect(gate.code).toBe("liability-exception-digest-mismatch")
    expect(gate.reason).toContain("not what is being written")
  })

  it("ignores approvals of other types", () => {
    const budget: ApprovalRecord = {
      id: "ar_4",
      type: "BUDGET",
      status: "APPROVED",
      decisionDigest: chargeModelDigest(decision()),
    }
    const gate = assertLiabilityApproved(decision(), [budget])
    expect(gate.ok).toBe(false)
  })
})

describe("liabilityExceptionRequest describes what is being approved", () => {
  it("names the model, the entity, the region and the amount", () => {
    const request = liabilityExceptionRequest(DESTINATION_ON_TENURE())
    expect(request.title).toContain("DESTINATION")
    expect(request.title).toContain("le_rochester")
    expect(request.description).toContain("12000")
    expect(request.metadata.payments.liableParty).toBe("TENURE")
    expect(request.metadata.payments.region).toBe("US")
  })

  it("refuses to raise one nobody needs", () => {
    expect(() => liabilityExceptionRequest(DIRECT())).toThrow(/shifts no liability/)
  })
})
