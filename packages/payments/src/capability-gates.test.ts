import {
  CAPABILITY_GATES,
  evaluateCapabilityGates,
  type CapabilityGateFacts,
  type GateVerdict,
} from "./capability-gates"
import {
  PAYMENT_CAPABILITIES,
  capabilityAvailabilityForModules,
  type CapabilityState,
} from "./capability-registry"

/**
 * PAY-010-002 — the four gates are four, they are independent, and UNDETERMINED
 * is not a pass.
 *
 * Every case below moves ONE fact and asserts one verdict, because a case that
 * moves two can be green while both are wrong. The last group drives the
 * production read path with a leaf stubbed certified, which is the assertion
 * that matters: before this, `transactable` was `isTransactable(state)` and a
 * certified leaf with no provider observation and no merchant account was
 * reported transactable to System Studio.
 */

const AT = "2026-08-01T00:00:00.000Z"

function facts(overrides: Partial<CapabilityGateFacts> = {}): CapabilityGateFacts {
  return {
    capabilityId: "funds-flow.direct-charge",
    certification: { state: "GA", transactable: true },
    servesModules: ["budgeting", "reimbursements"],
    providerCapability: { accountId: "acct_1", status: "active", observedAt: AT },
    entitledModules: ["budgeting"],
    merchantActivation: {
      accountId: "acct_1",
      chargesEnabled: true,
      payoutsEnabled: true,
      requirementsCurrentlyDue: [],
    },
    ...overrides,
  }
}

function verdictFor(f: CapabilityGateFacts, gate: string): GateVerdict {
  return evaluateCapabilityGates(f).gates.find((g) => g.gate === gate)!.verdict
}

describe("there are four gates and all four are always reported", () => {
  it("names exactly the four the requirement names, in a fixed order", () => {
    // Pinned by value. A fifth gate, a rename, or a reorder reds this — and a
    // reorder matters because callers render the list.
    expect([...CAPABILITY_GATES]).toEqual([
      "provider-capability",
      "tenure-certification",
      "tenant-entitlement",
      "merchant-activation",
    ])
  })

  it("returns all four even when the first one fails — no short-circuit", () => {
    const decision = evaluateCapabilityGates(
      facts({
        providerCapability: null,
        certification: { state: "PLANNED", transactable: false },
        entitledModules: [],
        merchantActivation: null,
      }),
    )
    expect(decision.gates.map((g) => g.gate)).toEqual([...CAPABILITY_GATES])
    expect(decision.gates.map((g) => g.verdict)).toEqual([
      "UNDETERMINED",
      "FAIL",
      "FAIL",
      "FAIL",
    ])
    // Four reasons, so an operator fixing them does not run the loop four times.
    expect(decision.blockers).toHaveLength(4)
  })

  it("allows only when every gate passes", () => {
    expect(evaluateCapabilityGates(facts()).allow).toBe(true)
    expect(evaluateCapabilityGates(facts()).blockers).toEqual([])
  })
})

describe("each gate answers its own fact and no other", () => {
  it("passes the provider gate only on an observed active account", () => {
    expect(verdictFor(facts(), "provider-capability")).toBe("PASS")
    for (const status of ["inactive", "pending", "unrequested"] as const) {
      const f = facts({ providerCapability: { accountId: "acct_1", status, observedAt: AT } })
      expect(verdictFor(f, "provider-capability")).toBe("FAIL")
      expect(evaluateCapabilityGates(f).allow).toBe(false)
      // And the other three are untouched by it.
      expect(verdictFor(f, "tenure-certification")).toBe("PASS")
      expect(verdictFor(f, "tenant-entitlement")).toBe("PASS")
      expect(verdictFor(f, "merchant-activation")).toBe("PASS")
    }
  })

  it("fails the certification gate on a state that is not money-facing", () => {
    const f = facts({ certification: { state: "PLANNED", transactable: false } })
    expect(verdictFor(f, "tenure-certification")).toBe("FAIL")
    expect(evaluateCapabilityGates(f).allow).toBe(false)
    expect(verdictFor(f, "provider-capability")).toBe("PASS")
  })

  it("fails the entitlement gate for a tenant running none of the served modules", () => {
    const f = facts({ entitledModules: ["messaging", "documents"] })
    expect(verdictFor(f, "tenant-entitlement")).toBe("FAIL")
    const gate = evaluateCapabilityGates(f).gates.find((g) => g.gate === "tenant-entitlement")!
    expect(gate.code).toBe("tenant-not-entitled")
    // The reason names both sides, which is what makes it actionable.
    expect(gate.reason).toContain("budgeting, reimbursements")
    expect(gate.reason).toContain("messaging, documents")
  })

  it("fails the entitlement gate for a leaf that serves no module at all", () => {
    const f = facts({ servesModules: [], entitledModules: ["budgeting"] })
    const gate = evaluateCapabilityGates(f).gates.find((g) => g.gate === "tenant-entitlement")!
    expect(gate.verdict).toBe("FAIL")
    expect(gate.code).toBe("capability-serves-no-module")
  })

  it("distinguishes the three ways merchant activation is unmet", () => {
    const cases: Array<[Partial<CapabilityGateFacts>, string]> = [
      [{ merchantActivation: null }, "merchant-account-absent"],
      [
        {
          merchantActivation: {
            accountId: "acct_1",
            chargesEnabled: false,
            payoutsEnabled: true,
            requirementsCurrentlyDue: [],
          },
        },
        "merchant-charges-disabled",
      ],
      [
        {
          merchantActivation: {
            accountId: "acct_1",
            chargesEnabled: true,
            payoutsEnabled: false,
            requirementsCurrentlyDue: [],
          },
        },
        "merchant-payouts-disabled",
      ],
      [
        {
          merchantActivation: {
            accountId: "acct_1",
            chargesEnabled: true,
            payoutsEnabled: true,
            requirementsCurrentlyDue: ["individual.verification.document"],
          },
        },
        "merchant-requirements-outstanding",
      ],
    ]
    for (const [override, code] of cases) {
      const decision = evaluateCapabilityGates(facts(override))
      const gate = decision.gates.find((g) => g.gate === "merchant-activation")!
      expect(gate.verdict).toBe("FAIL")
      expect(gate.code).toBe(code)
      expect(decision.allow).toBe(false)
    }
  })
})

describe("UNDETERMINED is a third answer and it never allows", () => {
  it("reports an unread provider account as UNDETERMINED, not FAIL", () => {
    const decision = evaluateCapabilityGates(facts({ providerCapability: null }))
    const gate = decision.gates.find((g) => g.gate === "provider-capability")!
    expect(gate.verdict).toBe("UNDETERMINED")
    expect(gate.code).toBe("provider-capability-unobserved")
    expect(decision.allow).toBe(false)
    // The distinction is the whole point: an unread account is not a refusal,
    // and a gate that called it FAIL would send somebody to fix the account.
    expect(gate.verdict).not.toBe("FAIL")
  })

  it("separates an unreadable entitlement from an empty one", () => {
    const unreadable = evaluateCapabilityGates(facts({ entitledModules: null }))
    const empty = evaluateCapabilityGates(facts({ entitledModules: [] }))

    expect(unreadable.gates.find((g) => g.gate === "tenant-entitlement")!.verdict).toBe(
      "UNDETERMINED",
    )
    expect(empty.gates.find((g) => g.gate === "tenant-entitlement")!.verdict).toBe("FAIL")
    // Neither allows. `null` and `[]` differ in what they say, not in what they permit.
    expect(unreadable.allow).toBe(false)
    expect(empty.allow).toBe(false)
  })
})

describe("the production read path enforces all four, not just the state", () => {
  /**
   * Certify one leaf for the duration of one call, exactly as the app tests do.
   *
   * The ADR is stubbed alongside the state because `assertRegistry` refuses a
   * money-facing state that names no approving document, and the file named
   * here is a real one — `adrExistsOnDisk` opens it. Without both, the read
   * path throws before any gate is consulted and the assertion below would be
   * measuring PAY-000-008's refusal rather than this one.
   */
  const REAL_ADR =
    "docs/decisions/pay-adr-0001-merchant-of-record-default-and-exception-paths.md"

  function certified<T>(id: string, run: () => T): T {
    const leaf = PAYMENT_CAPABILITIES.find((c) => c.id === id)!
    const originalState = leaf.state
    const originalApproval = leaf.approvedBy
    ;(leaf as { state: CapabilityState }).state = "GA_LIMITED"
    ;(leaf as { approvedBy: { adr: string } | null }).approvedBy = { adr: REAL_ADR }
    try {
      return run()
    } finally {
      ;(leaf as { state: CapabilityState }).state = originalState
      ;(leaf as { approvedBy: { adr: string } | null }).approvedBy = originalApproval
    }
  }

  it("carries the four verdicts onto every row", () => {
    const rows = capabilityAvailabilityForModules(["budgeting"], AT)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.gates.map((g) => g.gate)).toEqual([...CAPABILITY_GATES])
      // The tenant IS entitled — the row exists because it runs the module —
      // and the provider account has not been read at this layer.
      expect(row.gates.find((g) => g.gate === "tenant-entitlement")!.verdict).toBe("PASS")
      expect(row.gates.find((g) => g.gate === "provider-capability")!.verdict).toBe(
        "UNDETERMINED",
      )
    }
  })

  it("does NOT report a certified, ADR-approved leaf transactable when three gates are unmet", () => {
    // MUTATION TARGET, and the one that proves the wiring rather than the
    // function. Restore `transactable: isTransactable(state)` in
    // `capabilityAvailabilityForModules` and this reds: the leaf is GA_LIMITED
    // with a real approving ADR, so certification alone says yes — and there is
    // no observed provider account and no connected account anywhere in this
    // repository, so three of the four gates are unmet.
    certified("acceptance.card-and-wallet", () => {
      const row = capabilityAvailabilityForModules(["budgeting"], AT).find(
        (r) => r.capabilityId === "acceptance.card-and-wallet",
      )!
      expect(row.state).toBe("GA_LIMITED")
      expect(row.gates.find((g) => g.gate === "tenure-certification")!.verdict).toBe("PASS")
      expect(row.transactable).toBe(false)
      const unmet = row.gates.filter((g) => g.verdict !== "PASS").map((g) => g.code)
      expect(unmet).toEqual(["provider-capability-unobserved", "merchant-account-absent"])
    })

    // And back to the truthful state once the stub is off.
    const after = capabilityAvailabilityForModules(["budgeting"], AT).find(
      (r) => r.capabilityId === "acceptance.card-and-wallet",
    )!
    expect(after.state).toBe("PLANNED")
    expect(after.transactable).toBe(false)
  })

  it("reports nothing transactable today, and says which gates say so", () => {
    const rows = capabilityAvailabilityForModules(["budgeting", "reimbursements"], AT)
    expect(rows.every((r) => r.transactable === false)).toBe(true)
    for (const row of rows) {
      const failing = row.gates.filter((g) => g.verdict !== "PASS").map((g) => g.gate)
      expect(failing).toContain("tenure-certification")
      expect(failing).toContain("merchant-activation")
    }
  })
})
