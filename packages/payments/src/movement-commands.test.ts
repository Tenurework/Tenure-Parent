/**
 * PAY-080-001 — Bible §10's four command types, told apart from each other.
 *
 * §10's four look identical in a UI and are four different acts: a memo that
 * posts nothing, a balanced journal inside one legal entity, a due-to/due-from
 * across two, and money leaving the platform. The tests below are the four
 * confusions that cost money, plus the fail-closed cases — because "we could
 * not classify this" must never come out as "internal".
 */

import { MONEY_MOVEMENT_KINDS } from "./refusal"
import {
  MOVEMENT_COMMAND_TYPES,
  MovementCommandError,
  assertProviderCallPermitted,
  classifyMovementCommand,
} from "./movement-commands"

const SOURCE = "inst_rochester"

function facts(over: Partial<Parameters<typeof classifyMovementCommand>[0]> = {}) {
  return {
    kind: "ledger-allocation" as const,
    sourceLegalEntityId: SOURCE,
    destinationLegalEntityId: SOURCE,
    beneficiary: null,
    postsJournal: true,
    ...over,
  }
}

describe("the four types", () => {
  it("are Bible §10's four, in §10's order", () => {
    expect(MOVEMENT_COMMAND_TYPES).toEqual([
      "INTERNAL_ALLOCATION",
      "INTERNAL_LEDGER_TRANSFER",
      "INTERCOMPANY_TRANSFER",
      "EXTERNAL_PROVIDER_MOVEMENT",
    ])
  })

  it("classifies every kind the refusal engine knows, and never leaves one undecided by accident", () => {
    // Not a smoke test: this is the coupling. `MONEY_MOVEMENT_KINDS` lives in
    // refusal.ts, and a kind added there must acquire a §10 type here rather
    // than falling through.
    expect(MONEY_MOVEMENT_KINDS.length).toBe(9)
    for (const kind of MONEY_MOVEMENT_KINDS) {
      const decision = classifyMovementCommand(
        facts({ kind, postsJournal: kind !== "memo", destinationLegalEntityId: SOURCE }),
      )
      expect(decision.decided).toBe(true)
      expect(MOVEMENT_COMMAND_TYPES).toContain(decision.commandType)
    }
  })
})

describe("internal allocation vs internal ledger transfer", () => {
  it("a memo that posts nothing is an INTERNAL_ALLOCATION", () => {
    const d = classifyMovementCommand(facts({ kind: "memo", postsJournal: false }))
    expect(d.commandType).toBe("INTERNAL_ALLOCATION")
    expect(d.code).toBe("movement-command-internal-allocation")
    expect(d.providerCallPermitted).toBe(false)
    expect(d.requiresIntercompanyPolicy).toBe(false)
  })

  it("a memo that claims to post a journal is refused, not reclassified", () => {
    const d = classifyMovementCommand(facts({ kind: "memo", postsJournal: true }))
    expect(d.decided).toBe(false)
    expect(d.commandType).toBeNull()
    expect(d.code).toBe("movement-command-memo-posts-journal")
    expect(d.providerCallPermitted).toBe(false)
  })

  it("a balanced journal inside one entity is an INTERNAL_LEDGER_TRANSFER", () => {
    const d = classifyMovementCommand(facts({ kind: "ledger-allocation", postsJournal: true }))
    expect(d.commandType).toBe("INTERNAL_LEDGER_TRANSFER")
    expect(d.providerCallPermitted).toBe(false)
  })

  it("a ledger allocation that posts nothing is refused — it is a memo mislabelled", () => {
    const d = classifyMovementCommand(facts({ kind: "ledger-allocation", postsJournal: false }))
    expect(d.decided).toBe(false)
    expect(d.code).toBe("movement-command-ledger-transfer-posts-nothing")
  })
})

describe("intercompany", () => {
  it("a posting whose two sides are different legal entities is INTERCOMPANY_TRANSFER", () => {
    const d = classifyMovementCommand(facts({ destinationLegalEntityId: "inst_cornell" }))
    expect(d.commandType).toBe("INTERCOMPANY_TRANSFER")
    expect(d.requiresIntercompanyPolicy).toBe(true)
    expect(d.providerCallPermitted).toBe(false)
    expect(d.reason).toContain("due-to/due-from")
  })

  it("does not become intercompany on whitespace", () => {
    const d = classifyMovementCommand(facts({ destinationLegalEntityId: `  ${SOURCE}  ` }))
    expect(d.commandType).toBe("INTERNAL_LEDGER_TRANSFER")
  })

  it("treats a null destination as 'no second entity', not as a different one", () => {
    const d = classifyMovementCommand(
      facts({ kind: "memo", postsJournal: false, destinationLegalEntityId: null }),
    )
    expect(d.commandType).toBe("INTERNAL_ALLOCATION")
  })
})

describe("external provider movement", () => {
  it.each([
    ["payout", "SETTLEMENT_PAYOUT"],
    ["transfer", "BALANCE_TRANSFER"],
    ["bank-instruction", "OUTBOUND_PAYMENT"],
    ["refund", "REFUND"],
    ["disbursement", "DISBURSEMENT"],
  ] as const)("a %s is EXTERNAL_PROVIDER_MOVEMENT and Bible §11's %s", (kind, verb) => {
    const d = classifyMovementCommand(facts({ kind, postsJournal: true }))
    expect(d.commandType).toBe("EXTERNAL_PROVIDER_MOVEMENT")
    expect(d.payoutCommand).toBe(verb)
    expect(d.providerCallPermitted).toBe(true)
  })

  it("names no outbound verb for a kind §11 does not give one", () => {
    for (const kind of ["charge", "payroll"] as const) {
      const d = classifyMovementCommand(facts({ kind, postsJournal: true }))
      expect(d.commandType).toBe("EXTERNAL_PROVIDER_MOVEMENT")
      expect(d.payoutCommand).toBeNull()
      expect(d.reason).toContain("case by case")
    }
  })
})

describe("fails closed", () => {
  it("refuses a kind it does not know rather than guessing the safe-looking one", () => {
    const d = classifyMovementCommand(facts({ kind: "sweep" }))
    expect(d.decided).toBe(false)
    expect(d.commandType).toBeNull()
    expect(d.code).toBe("movement-command-unknown-kind")
    expect(d.providerCallPermitted).toBe(false)
  })

  it("refuses a blank source legal entity", () => {
    for (const blank of ["", "   "]) {
      const d = classifyMovementCommand(facts({ sourceLegalEntityId: blank }))
      expect(d.decided).toBe(false)
      expect(d.code).toBe("movement-command-source-unreadable")
    }
  })

  it("refuses an internal kind that names a beneficiary outside the entity", () => {
    const d = classifyMovementCommand(
      facts({ beneficiary: { external: true, name: "Rochester Catering Co." } }),
    )
    expect(d.decided).toBe(false)
    expect(d.code).toBe("movement-command-internal-names-external-beneficiary")
    expect(d.reason).toContain("Rochester Catering Co.")
  })

  it("allows an internal kind naming an INTERNAL beneficiary", () => {
    const d = classifyMovementCommand(
      facts({ beneficiary: { external: false, name: "Chess Club treasurer" } }),
    )
    expect(d.commandType).toBe("INTERNAL_LEDGER_TRANSFER")
  })

  it("never marks an undecided classification provider-callable", () => {
    const undecidedCases = [
      facts({ kind: "sweep" }),
      facts({ sourceLegalEntityId: "" }),
      facts({ kind: "memo", postsJournal: true }),
      facts({ kind: "ledger-allocation", postsJournal: false }),
      facts({ beneficiary: { external: true, name: "outsider" } }),
    ]
    for (const input of undecidedCases) {
      const d = classifyMovementCommand(input)
      expect(d.decided).toBe(false)
      expect(d.providerCallPermitted).toBe(false)
      expect(d.payoutCommand).toBeNull()
    }
  })
})

describe("assertProviderCallPermitted", () => {
  it("throws for an internal ledger transfer and says why a provider call would be wrong", () => {
    const d = classifyMovementCommand(facts())
    expect(() => assertProviderCallPermitted(d, "createTransfer")).toThrow(MovementCommandError)
    try {
      assertProviderCallPermitted(d, "createTransfer")
      throw new Error("unreachable")
    } catch (error) {
      const e = error as MovementCommandError
      expect(e.code).toBe("provider-call-blocked-internal-command")
      expect(e.message).toContain("INTERNAL_LEDGER_TRANSFER")
      expect(e.message).toContain("createTransfer")
    }
  })

  it("throws with a DIFFERENT code for an undecided classification", () => {
    const d = classifyMovementCommand(facts({ kind: "sweep" }))
    try {
      assertProviderCallPermitted(d, "createTransfer")
      throw new Error("unreachable")
    } catch (error) {
      expect((error as MovementCommandError).code).toBe("provider-call-blocked-undecided")
    }
  })

  it("permits an external movement", () => {
    const d = classifyMovementCommand(facts({ kind: "payout" }))
    expect(() => assertProviderCallPermitted(d, "createPayout")).not.toThrow()
  })
})
