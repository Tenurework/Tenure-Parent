import fs from "node:fs"
import path from "node:path"

import {
  CAPABILITY_STATES,
  PAYMENT_CAPABILITIES,
  PaymentCapabilityError,
  STATES_REQUIRING_APPROVAL,
  adrExistsOnDisk,
  assertRegistry,
  capability,
  capabilityAvailabilityForModules,
  capabilityState,
  isTransactable,
  settlementCurrencies,
  type CapabilityState,
  type PaymentCapability,
} from "./capability-registry"

/**
 * PAY-000-008. The registry's job is to make one specific lie impossible:
 * "Stripe supports it, therefore we support it."
 */

const ALWAYS = () => true
const NEVER = () => false

function seeded(id: string): PaymentCapability {
  return capability(id)
}

describe("the seeded registry is the truthful reading", () => {
  it("registers every Bible §3 leaf and marks none of them available", () => {
    // The number matters less than the property: not one leaf claims a state
    // that would put money in front of a tenant, because not one has an ADR.
    expect(PAYMENT_CAPABILITIES.length).toBeGreaterThanOrEqual(30)
    const available = PAYMENT_CAPABILITIES.filter((c) =>
      STATES_REQUIRING_APPROVAL.includes(c.state),
    )
    expect(available).toEqual([])
  })

  it("uses only states from the declared vocabulary", () => {
    for (const cap of PAYMENT_CAPABILITIES) {
      expect(CAPABILITY_STATES).toContain(cap.state)
      expect(["PLANNED", "UNSUPPORTED"]).toContain(cap.state)
    }
  })

  it("marks the things Bible §2 says Tenure is not as UNSUPPORTED, with an empty matrix", () => {
    // Not an arbitrary choice: Tenure is not an issuer, not a bank, not the
    // KYC decision owner, and platform fees are off by default (§0.6).
    for (const id of [
      "cards.physical-and-virtual",
      "financial-account.embedded",
      "identity.kyc-kyb",
      "funds-flow.application-fee",
    ]) {
      const cap = seeded(id)
      expect(cap.state).toBe("UNSUPPORTED")
      expect(cap.countries).toEqual([])
      expect(cap.currencies).toEqual([])
    }
  })

  it("passes its own approval check against the real filesystem", () => {
    expect(() =>
      assertRegistry(PAYMENT_CAPABILITIES, { adrExists: adrExistsOnDisk }),
    ).not.toThrow()
  })
})

describe("assertRegistry refuses availability that has not been earned", () => {
  const base = seeded("acceptance.card-and-wallet")

  it("throws when a money-facing state names no ADR", () => {
    // MUTATION TARGET: flip a seeded capability to GA without adding an ADR.
    for (const state of STATES_REQUIRING_APPROVAL) {
      let error: unknown
      try {
        assertRegistry([{ ...base, state, approvedBy: null }], { adrExists: ALWAYS })
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(PaymentCapabilityError)
      expect((error as PaymentCapabilityError).code).toBe("capability-state-unapproved")
    }
  })

  it("throws a DIFFERENT refusal when the named ADR is not on disk", () => {
    // The second mutation, and the codes must differ: one needs a decision,
    // the other needs the decision to have been written down. A single code
    // would send both to the same wrong fix.
    let error: unknown
    try {
      assertRegistry(
        [{ ...base, state: "GA", approvedBy: { adr: "docs/decisions/ADR-9999-nope.md" } }],
        { adrExists: NEVER },
      )
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(PaymentCapabilityError)
    expect((error as PaymentCapabilityError).code).toBe("capability-adr-missing")
  })

  it("accepts a money-facing state whose ADR does exist", () => {
    expect(() =>
      assertRegistry([{ ...base, state: "GA", approvedBy: { adr: "docs/decisions/ADR-0001-x.md" } }], {
        adrExists: ALWAYS,
      }),
    ).not.toThrow()
  })

  it("leaves pre-approval states alone — they reach no tenant", () => {
    for (const state of ["DISCOVERED", "ARCHITECTED", "PLANNED", "BUILDING", "INTERNAL_PREVIEW"] as const) {
      expect(() =>
        assertRegistry([{ ...base, state, approvedBy: null }], { adrExists: NEVER }),
      ).not.toThrow()
    }
  })

  it("refuses a duplicate id, an unknown state and an inverted window", () => {
    const codes: string[] = []
    const attempt = (caps: PaymentCapability[]) => {
      try {
        assertRegistry(caps, { adrExists: ALWAYS })
      } catch (error) {
        codes.push((error as PaymentCapabilityError).code)
      }
    }
    attempt([base, { ...base }])
    attempt([{ ...base, state: "SORT-OF" as PaymentCapability["state"] }])
    attempt([{ ...base, effectiveFrom: "2027-01-01", effectiveTo: "2026-01-01" }])
    attempt([{ ...base, effectiveFrom: "whenever" }])
    expect(codes).toEqual([
      "capability-duplicate-id",
      "capability-unknown-state",
      "capability-inverted-window",
      "capability-bad-effective-from",
    ])
  })
})

describe("adrExistsOnDisk reads the actual repository", () => {
  it("finds a file that exists and refuses one that does not", () => {
    // Not a stand-in: this is the function the production read path passes,
    // pointed at real ADRs. A fake that returned true for everything would
    // make the guard above vacuous in production while these tests stayed green.
    const real = fs
      .readdirSync(path.join(process.cwd(), "..", "..", "docs", "decisions"))
      .find((n) => n.startsWith("ADR-"))
    expect(real).toBeDefined()
    expect(adrExistsOnDisk(`docs/decisions/${real}`)).toBe(true)
    expect(adrExistsOnDisk("docs/decisions/ADR-9999-does-not-exist.md")).toBe(false)
    expect(adrExistsOnDisk("")).toBe(false)
  })
})

describe("capabilityState is effective-dated and refuses the unknown", () => {
  it("refuses an id nobody registered rather than treating it as unrestricted", () => {
    expect(() => capabilityState("payments.whatever-i-typed")).toThrow(PaymentCapabilityError)
    try {
      capability("payments.whatever-i-typed")
    } catch (error) {
      expect((error as PaymentCapabilityError).code).toBe("capability-unknown")
    }
  })

  it("reports UNSUPPORTED before the window opens, whatever the stored state says", () => {
    const cap = seeded("acceptance.card-and-wallet")
    expect(cap.state).toBe("PLANNED")
    expect(capabilityState(cap.id, "2025-06-01T00:00:00.000Z")).toBe("UNSUPPORTED")
    expect(capabilityState(cap.id, "2026-06-01T00:00:00.000Z")).toBe("PLANNED")
  })

  it("says no PLANNED capability is transactable", () => {
    expect(isTransactable("PLANNED")).toBe(false)
    expect(isTransactable("UNSUPPORTED")).toBe(false)
    expect(isTransactable("GA")).toBe(true)
    expect(isTransactable("TENANT_PILOT")).toBe(true)
  })
})

describe("settlementCurrencies is the union across leaves Tenure has not written off", () => {
  it("covers every currency the shipped blueprints publish", () => {
    // blueprints/ publishes USD, GBP and AED. A registry that could not settle
    // one of them would make `localization.ts` refuse a tenant that exists.
    const codes = settlementCurrencies()
    for (const code of ["USD", "GBP", "AED", "EUR"]) expect(codes).toContain(code)
  })

  it("excludes currencies only UNSUPPORTED leaves declare", () => {
    const unsupportedOnly = PAYMENT_CAPABILITIES.filter((c) => c.state === "UNSUPPORTED").flatMap(
      (c) => c.currencies,
    )
    expect(unsupportedOnly).toEqual([])
  })
})

describe("capabilityAvailabilityForModules is the production read path", () => {
  it("reports a state per (module, capability) pair, never a boolean", () => {
    const rows = capabilityAvailabilityForModules(["budgeting"], "2026-08-01T00:00:00.000Z")
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.moduleKey).toBe("budgeting")
      expect(CAPABILITY_STATES).toContain(row.state)
      expect(row.transactable).toBe(false)
      expect(row.summary.length).toBeGreaterThan(0)
    }
  })

  it("returns nothing for a module no capability serves", () => {
    expect(capabilityAvailabilityForModules(["messaging"])).toEqual([])
  })

  it("is stable in order, so a snapshot of it means something", () => {
    const a = capabilityAvailabilityForModules(["reimbursements", "budgeting"])
    const b = capabilityAvailabilityForModules(["budgeting", "reimbursements"])
    expect(a).toEqual(b)
  })

  it("VALIDATES on every read — an unapproved GA entry throws rather than rendering", () => {
    // MUTATION TARGET, and the one the first draft of this file missed:
    // deleting the `assertRegistry` call from the read path left every other
    // assertion green, because they all called `assertRegistry` themselves. A
    // guard that is only exercised by a direct call is a guard the production
    // path can stop using without anything going red.
    //
    // So this mutates the registry the way a careless promotion would and
    // asserts the READER refuses. `state` is put back in a `finally` so no
    // other test sees it.
    const leaf = PAYMENT_CAPABILITIES.find((c) => c.id === "acceptance.card-and-wallet")!
    const original = leaf.state
    ;(leaf as { state: CapabilityState }).state = "GA"
    try {
      expect(() => capabilityAvailabilityForModules(["budgeting"])).toThrow(PaymentCapabilityError)
      try {
        capabilityAvailabilityForModules(["budgeting"])
      } catch (error) {
        expect((error as PaymentCapabilityError).code).toBe("capability-state-unapproved")
      }
    } finally {
      ;(leaf as { state: CapabilityState }).state = original
    }

    // And it is green again once the registry is truthful, so the throw above
    // is the registry's state and not a permanently broken reader.
    expect(capabilityAvailabilityForModules(["budgeting"]).length).toBeGreaterThan(0)
  })
})
