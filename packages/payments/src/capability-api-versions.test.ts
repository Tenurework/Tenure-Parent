import { PROVIDER_API_VERSION } from "./api-version"
import {
  PAYMENT_CAPABILITIES,
  PaymentCapabilityError,
  assertRegistry,
  capability,
  capabilityAvailabilityForModules,
  capabilityState,
  providerApiCompatibility,
  type CapabilityState,
  type PaymentCapability,
  type ProviderApiCompatibility,
} from "./capability-registry"

/**
 * PAY-010-003 — a capability definition declares WHEN it is true and AGAINST
 * WHAT it was reviewed, and both windows can invalidate it.
 *
 * The effective-date half already shipped (`capability-registry.test.ts` drives
 * it). This file is the provider/API-version half and the interaction: a leaf
 * inside its date window, certified, and reviewed under a version this build no
 * longer runs is `UNSUPPORTED`, because a certification reviewed against a
 * different API version is not a certification of the calls this build makes.
 *
 * The first test pins the shipped declarations by value. Without it a reader
 * that silently returned `null` for every leaf would make every other assertion
 * here vacuously green — the failure this repository has shipped more than once.
 */

const ALWAYS_ADR = { adrExists: () => true }

/** Swap one leaf's declaration for the duration of one call, then put it back. */
function withApiVersions<T>(
  id: string,
  value: ProviderApiCompatibility | null,
  run: () => T,
): T {
  const leaf = PAYMENT_CAPABILITIES.find((c) => c.id === id)!
  const original = leaf.apiVersions
  ;(leaf as { apiVersions: ProviderApiCompatibility | null }).apiVersions = value
  try {
    return run()
  } finally {
    ;(leaf as { apiVersions: ProviderApiCompatibility | null }).apiVersions = original
  }
}

describe("every leaf declares the provider API version it was reviewed under", () => {
  it("declares one for every provider-backed leaf and none for the leaf with no provider", () => {
    const withoutDeclaration = PAYMENT_CAPABILITIES.filter((c) => c.apiVersions === null).map(
      (c) => c.id,
    )
    // Pinned by value. Exactly one leaf makes no provider call.
    expect(withoutDeclaration).toEqual(["internal.allocations-and-settlement-instructions"])
    expect(capability(withoutDeclaration[0]).program).toBe("none")

    const declared = PAYMENT_CAPABILITIES.filter((c) => c.apiVersions !== null)
    expect(declared.length).toBeGreaterThanOrEqual(30)
    for (const cap of declared) {
      expect(cap.program).not.toBe("none")
      expect(cap.apiVersions!.reviewedUnder).toBe(PROVIDER_API_VERSION)
      // Null, not open-ended: nothing has been reviewed beyond the pin.
      expect(cap.apiVersions!.compatibleThrough).toBeNull()
    }
  })

  it("says the pinned version is covered, and names the version that is not", () => {
    const id = "acceptance.card-and-wallet"
    const covered = providerApiCompatibility(id, PROVIDER_API_VERSION)
    expect(covered.compatible).toBe(true)
    expect(covered.code).toBe("api-version-reviewed")

    for (const version of ["2026-04-30", "2025-12-31"]) {
      const verdict = providerApiCompatibility(id, version)
      expect(verdict.compatible).toBe(false)
      expect(verdict.code).toBe("api-version-not-reviewed")
      expect(verdict.reason).toContain(version)
    }
  })

  it("answers not-applicable rather than a bare true for the leaf with no provider call", () => {
    const verdict = providerApiCompatibility(
      "internal.allocations-and-settlement-instructions",
      "2027-01-01",
    )
    expect(verdict.compatible).toBe(true)
    expect(verdict.code).toBe("api-version-not-applicable")
  })

  it("refuses a candidate that is not a provider date version", () => {
    expect(() => providerApiCompatibility("acceptance.card-and-wallet", "v2")).toThrow(
      /not a provider API version/,
    )
  })

  it("honours an explicit upper bound, inclusively", () => {
    withApiVersions(
      "acceptance.card-and-wallet",
      { reviewedUnder: "2026-01-01", compatibleThrough: "2026-06-30" },
      () => {
        const id = "acceptance.card-and-wallet"
        expect(providerApiCompatibility(id, "2026-01-01").compatible).toBe(true)
        expect(providerApiCompatibility(id, "2026-03-15").compatible).toBe(true)
        expect(providerApiCompatibility(id, "2026-06-30").compatible).toBe(true)
        expect(providerApiCompatibility(id, "2026-07-01").compatible).toBe(false)
        expect(providerApiCompatibility(id, "2025-12-31").compatible).toBe(false)
      },
    )
  })
})

describe("an unreviewed API version withdraws the state, exactly as a closed date window does", () => {
  it("reports UNSUPPORTED for a leaf reviewed under a version this build does not run", () => {
    const id = "acceptance.card-and-wallet"
    // In its date window, and its stored state is PLANNED.
    expect(capabilityState(id, "2026-08-01T00:00:00.000Z")).toBe("PLANNED")

    withApiVersions(id, { reviewedUnder: "2025-01-01", compatibleThrough: null }, () => {
      // MUTATION TARGET: delete the `providerApiCompatibility` line from
      // `capabilityState` and this reds — the stored word comes back instead.
      expect(capabilityState(id, "2026-08-01T00:00:00.000Z")).toBe("UNSUPPORTED")
    })

    expect(capabilityState(id, "2026-08-01T00:00:00.000Z")).toBe("PLANNED")
  })

  it("carries that through the production read path", () => {
    const id = "acceptance.card-and-wallet"
    const before = capabilityAvailabilityForModules(["budgeting"], "2026-08-01T00:00:00.000Z")
    expect(before.find((r) => r.capabilityId === id)!.state).toBe("PLANNED")

    withApiVersions(id, { reviewedUnder: "2027-01-01", compatibleThrough: null }, () => {
      const rows = capabilityAvailabilityForModules(["budgeting"], "2026-08-01T00:00:00.000Z")
      expect(rows.find((r) => r.capabilityId === id)!.state).toBe("UNSUPPORTED")
      expect(rows.find((r) => r.capabilityId === id)!.transactable).toBe(false)
    })
  })
})

describe("assertRegistry refuses a declaration that cannot be true", () => {
  function leafWith(overrides: Partial<PaymentCapability>): PaymentCapability {
    return {
      ...(capability("acceptance.card-and-wallet") as PaymentCapability),
      ...overrides,
    }
  }

  function codeOf(caps: readonly PaymentCapability[]): string {
    try {
      assertRegistry(caps, ALWAYS_ADR)
    } catch (error) {
      return (error as PaymentCapabilityError).code
    }
    return "no-error"
  }

  it("refuses a provider-backed leaf that declares no reviewed version", () => {
    expect(codeOf([leafWith({ apiVersions: null })])).toBe("capability-api-version-missing")
  })

  it("refuses a non-provider leaf that claims one", () => {
    expect(
      codeOf([
        leafWith({
          program: "none",
          apiVersions: { reviewedUnder: PROVIDER_API_VERSION, compatibleThrough: null },
        }),
      ]),
    ).toBe("capability-api-version-on-non-provider-leaf")
  })

  it("refuses an unreadable version", () => {
    expect(
      codeOf([leafWith({ apiVersions: { reviewedUnder: "latest", compatibleThrough: null } })]),
    ).toBe("capability-bad-api-version")
  })

  it("refuses an upper bound that is not above the lower one", () => {
    expect(
      codeOf([
        leafWith({
          apiVersions: { reviewedUnder: "2026-05-01", compatibleThrough: "2026-01-01" },
        }),
      ]),
    ).toBe("capability-inverted-api-window")
  })

  it("refuses a money-facing state reviewed under a version this build does not run", () => {
    expect(
      codeOf([
        leafWith({
          state: "GA" as CapabilityState,
          approvedBy: { adr: "docs/decisions/pay-adr-0001-merchant-of-record-default-and-exception-paths.md" },
          apiVersions: { reviewedUnder: "2025-01-01", compatibleThrough: null },
        }),
      ]),
    ).toBe("capability-api-version-uncertified")
  })

  it("accepts the same money-facing leaf once the pinned version is inside the window", () => {
    // The control. Without it the case above could be passing on the state or
    // the ADR rather than on the window.
    expect(
      codeOf([
        leafWith({
          state: "GA" as CapabilityState,
          approvedBy: { adr: "docs/decisions/pay-adr-0001-merchant-of-record-default-and-exception-paths.md" },
          apiVersions: { reviewedUnder: "2025-01-01", compatibleThrough: PROVIDER_API_VERSION },
        }),
      ]),
    ).toBe("no-error")
  })

  it("passes the registry as shipped", () => {
    expect(codeOf(PAYMENT_CAPABILITIES)).toBe("no-error")
  })
})
