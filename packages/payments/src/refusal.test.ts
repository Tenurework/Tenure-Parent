import {
  MONEY_MOVEMENT_KINDS,
  PAYMENTS_OPERATIONS_QUEUE,
  classifyRequest,
  type MoneyMovementRequest,
} from "./refusal"

/**
 * PAY-180-006. The control §0.3 makes absolute, exercised at its own boundary.
 * The ACTION-level proof — that a payout-shaped approval never reaches the
 * ledger — lives in `apps/web/src/app/(app)/approvals/money-movement.test.ts`,
 * because a classifier tested only here stays green when its caller stops
 * calling it.
 */

function request(overrides: Partial<MoneyMovementRequest> = {}): MoneyMovementRequest {
  return {
    kind: "ledger-allocation",
    sourceLegalEntityId: "inst_rochester",
    destinationLegalEntityId: "inst_rochester",
    beneficiary: null,
    amountMinorUnits: 4200,
    currency: "USD",
    ...overrides,
  }
}

describe("anything whose effect leaves the platform is REFUSED", () => {
  it("refuses every outbound kind, whatever the amount", () => {
    for (const kind of [
      "charge",
      "refund",
      "payout",
      "transfer",
      "disbursement",
      "payroll",
      "bank-instruction",
    ] as const) {
      const verdict = classifyRequest(request({ kind, amountMinorUnits: 1 }))
      expect(verdict.verdict).toBe("REFUSED")
      expect(verdict.code).toBe("money-movement-prohibited")
      expect(verdict.reason).toContain(kind)
    }
  })

  it("refuses regardless of who the beneficiary is or whether one is named", () => {
    for (const beneficiary of [null, { external: false, name: "the club" }]) {
      expect(classifyRequest(request({ kind: "payout", beneficiary })).verdict).toBe("REFUSED")
    }
  })
})

describe("ambiguity ESCALATES rather than being guessed", () => {
  it("escalates an internal posting naming a beneficiary outside the entity", () => {
    const verdict = classifyRequest(
      request({ beneficiary: { external: true, name: "Rochester Catering Co." } }),
    )
    expect(verdict.verdict).toBe("ESCALATE")
    expect(verdict.code).toBe("money-movement-external-beneficiary")
    expect(verdict.escalateTo).toBe(PAYMENTS_OPERATIONS_QUEUE)
    expect(verdict.reason).toContain("Rochester Catering Co.")
  })

  it("escalates a posting that crosses a legal entity boundary", () => {
    const verdict = classifyRequest(request({ destinationLegalEntityId: "inst_other" }))
    expect(verdict.verdict).toBe("ESCALATE")
    expect(verdict.code).toBe("money-movement-crosses-legal-entity")
  })

  it("escalates an unrecognised kind rather than allowing it", () => {
    const verdict = classifyRequest(request({ kind: "sweep" }))
    expect(verdict.verdict).toBe("ESCALATE")
    expect(verdict.code).toBe("money-movement-unknown-kind")
  })

  it("escalates an amount it cannot bound", () => {
    for (const amountMinorUnits of [-1, 42.5]) {
      const verdict = classifyRequest(request({ amountMinorUnits }))
      expect(verdict.verdict).toBe("ESCALATE")
      expect(verdict.code).toBe("money-movement-amount-unusable")
    }
  })
})

describe("only a same-entity internal posting is ALLOWED", () => {
  it("allows a memo and a ledger allocation inside one legal entity", () => {
    for (const kind of ["memo", "ledger-allocation"] as const) {
      const verdict = classifyRequest(request({ kind }))
      expect(verdict.verdict).toBe("ALLOWED")
      expect(verdict.code).toBe("money-movement-internal")
      expect(verdict.escalateTo).toBeNull()
    }
  })

  it("allows a memo with no destination at all", () => {
    expect(classifyRequest(request({ kind: "memo", destinationLegalEntityId: null })).verdict).toBe(
      "ALLOWED",
    )
  })

  it("classifies every declared kind — no kind falls through unclassified", () => {
    for (const kind of MONEY_MOVEMENT_KINDS) {
      const verdict = classifyRequest(request({ kind }))
      expect(verdict.code).not.toBe("money-movement-unclassified")
      expect(["ALLOWED", "REFUSED", "ESCALATE"]).toContain(verdict.verdict)
    }
  })
})
