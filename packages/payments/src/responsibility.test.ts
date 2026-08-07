import {
  FUNDS_FLOWS,
  RESPONSIBILITY_AXES,
  failingAxes,
  partyFor,
  resolveResponsibility,
  type ResponsibilityConfig,
} from "./responsibility"

/**
 * PAY-040-002. The property is that a gap is REPORTED, never filled. Every
 * plausible default on these axes is a way for Tenure to acquire a liability
 * nobody decided to take.
 */

const COMPLETE_DIRECT: ResponsibilityConfig = {
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

describe("all eight axes, always", () => {
  it("returns exactly eight entries in a fixed order for every flow", () => {
    for (const flow of FUNDS_FLOWS) {
      const resolved = resolveResponsibility(flow, {})
      expect(resolved).toHaveLength(8)
      expect(resolved.map((r) => r.axis)).toEqual([...RESPONSIBILITY_AXES])
    }
  })

  it("an empty configuration yields eight blockers, never eight defaults", () => {
    // MUTATION TARGET: defaulting an unset axis to TENANT reds this.
    const resolved = resolveResponsibility("direct", {})
    expect(resolved).toHaveLength(8)
    expect(failingAxes(resolved)).toEqual([...RESPONSIBILITY_AXES])
    for (const entry of resolved) {
      expect(entry.party).toBeNull()
      expect(entry.blockers.length).toBeGreaterThan(0)
    }
  })

  it("a partially answered configuration blocks exactly the unanswered axes", () => {
    const resolved = resolveResponsibility("direct", {
      defaults: { merchantDisplay: "TENANT", feePayer: "TENANT" },
    })
    expect(failingAxes(resolved)).toEqual([
      "lossPayer",
      "refundPayer",
      "disputeOwner",
      "kycUpdateOwner",
      "accountCollectionOwner",
      "supportOwner",
    ])
    expect(partyFor(resolved, "merchantDisplay")).toBe("TENANT")
  })
})

describe("where the answer came from", () => {
  it("marks a tenant override as such and lets it win", () => {
    const resolved = resolveResponsibility("destination", {
      defaults: { ...COMPLETE_DIRECT.defaults, feePayer: "TENANT" },
      overrides: { feePayer: "CUSTOMER" },
    })
    const fee = resolved.find((r) => r.axis === "feePayer")!
    expect(fee.party).toBe("CUSTOMER")
    expect(fee.source).toBe("tenant-override")
    expect(resolved.find((r) => r.axis === "lossPayer")!.source).toBe("default")
  })
})

describe("assignments Bible §2 forbids are refused, not recorded", () => {
  it("refuses TENURE as KYC update owner on every flow", () => {
    for (const flow of FUNDS_FLOWS) {
      const resolved = resolveResponsibility(flow, {
        defaults: { ...COMPLETE_DIRECT.defaults, kycUpdateOwner: "TENURE" },
      })
      expect(failingAxes(resolved)).toEqual(["kycUpdateOwner"])
      expect(partyFor(resolved, "kycUpdateOwner")).toBeNull()
    }
  })

  it("refuses the payer as loss payer, refund payer or dispute owner", () => {
    for (const axis of ["lossPayer", "refundPayer", "disputeOwner"] as const) {
      const resolved = resolveResponsibility("destination", {
        defaults: { ...COMPLETE_DIRECT.defaults, [axis]: "CUSTOMER" },
      })
      expect(failingAxes(resolved)).toEqual([axis])
    }
  })

  it("refuses TENURE on a direct charge for the axes the provider decides", () => {
    // A direct charge lands on the tenant's connected account. Recording that
    // Tenure carries the loss describes an arrangement the provider is not
    // implementing, so it is a blocker rather than a policy.
    for (const axis of ["lossPayer", "refundPayer", "disputeOwner", "merchantDisplay"] as const) {
      const resolved = resolveResponsibility("direct", {
        defaults: { ...COMPLETE_DIRECT.defaults, [axis]: "TENURE" },
      })
      expect(failingAxes(resolved)).toContain(axis)
    }
  })

  it("allows TENURE on the same axes for a destination charge — that is the exception path", () => {
    const resolved = resolveResponsibility("destination", {
      defaults: { ...COMPLETE_DIRECT.defaults, lossPayer: "TENURE" },
    })
    expect(failingAxes(resolved)).toEqual([])
    expect(partyFor(resolved, "lossPayer")).toBe("TENURE")
  })
})

describe("partyFor never reports a party for a blocked axis", () => {
  it("returns null rather than the recorded-but-illegal value", () => {
    const resolved = resolveResponsibility("direct", {
      defaults: { ...COMPLETE_DIRECT.defaults, lossPayer: "TENURE" },
    })
    expect(resolved.find((r) => r.axis === "lossPayer")!.party).toBe("TENURE")
    expect(partyFor(resolved, "lossPayer")).toBeNull()
  })

  it("returns null for an axis that is not in the list at all", () => {
    expect(partyFor([], "feePayer")).toBeNull()
  })
})
