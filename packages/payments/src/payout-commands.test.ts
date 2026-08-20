/**
 * PAY-090-001 — five outbound commands, and the proof they are five.
 *
 * The requirement's own sentence is "Implement distinct semantic commands and
 * state machines for settlement payout, transfer, outbound payment, refund and
 * disbursement", and Bible §11 opens "Do not use one generic 'payout' verb."
 * So the tests that matter are the ones that would go red if the five machines
 * were one table wearing five names.
 */

import {
  PAYOUT_COMMANDS,
  PAYOUT_COMMAND_MACHINES,
  isTerminalPayoutState,
  statesOf,
  transitionPayoutCommand,
} from "./payout-commands"

describe("the five commands", () => {
  it("are exactly the five the requirement names", () => {
    expect(PAYOUT_COMMANDS).toEqual([
      "SETTLEMENT_PAYOUT",
      "BALANCE_TRANSFER",
      "OUTBOUND_PAYMENT",
      "REFUND",
      "DISBURSEMENT",
    ])
    expect(Object.keys(PAYOUT_COMMAND_MACHINES).sort()).toEqual([...PAYOUT_COMMANDS].sort())
  })

  it("has a non-empty, self-consistent machine for each", () => {
    for (const command of PAYOUT_COMMANDS) {
      const machine = PAYOUT_COMMAND_MACHINES[command]
      const states = statesOf(command)
      expect(states.length).toBeGreaterThan(3)
      expect(states).toContain(machine.initial)
      // Every destination is a state of the SAME machine.
      for (const [, tos] of Object.entries(machine.transitions)) {
        for (const to of tos) expect(states).toContain(to)
      }
      // At least one terminal state, or the command never finishes.
      expect(states.some((s) => isTerminalPayoutState(command, s))).toBe(true)
      // The initial state is not terminal.
      expect(isTerminalPayoutState(command, machine.initial)).toBe(false)
    }
  })
})

describe("distinct, not five labels on one table", () => {
  it("gives no two commands the same set of states", () => {
    const fingerprints = PAYOUT_COMMANDS.map((c) => statesOf(c).join("|"))
    expect(new Set(fingerprints).size).toBe(PAYOUT_COMMANDS.length)
  })

  it("gives no two commands the same counterparty", () => {
    const parties = PAYOUT_COMMANDS.map((c) => PAYOUT_COMMAND_MACHINES[c].counterparty)
    expect(new Set(parties).size).toBe(PAYOUT_COMMANDS.length)
  })

  it("puts BENEFICIARY_VERIFIED on the one command with a third party to verify", () => {
    const owners = PAYOUT_COMMANDS.filter((c) => statesOf(c).includes("BENEFICIARY_VERIFIED"))
    expect(owners).toEqual(["OUTBOUND_PAYMENT"])
    expect(PAYOUT_COMMAND_MACHINES.OUTBOUND_PAYMENT.counterparty).toBe("THIRD_PARTY_BENEFICIARY")
    // And it is not optional: approval is reachable only through it.
    expect(PAYOUT_COMMAND_MACHINES.OUTBOUND_PAYMENT.transitions.REQUESTED).not.toContain("APPROVED")
  })

  it("keeps RETURNED off the commands that touch no bank rail", () => {
    for (const command of PAYOUT_COMMANDS) {
      const machine = PAYOUT_COMMAND_MACHINES[command]
      expect(statesOf(command).includes("RETURNED")).toBe(machine.bankRail)
    }
    expect(PAYOUT_COMMAND_MACHINES.REFUND.bankRail).toBe(false)
    expect(PAYOUT_COMMAND_MACHINES.BALANCE_TRANSFER.bankRail).toBe(false)
  })

  it("refuses a refund the RETURNED state, and names the commands that own it", () => {
    const wrong = transitionPayoutCommand({
      command: "REFUND",
      from: "SUCCEEDED",
      to: "RETURNED",
    })
    expect(wrong.ok).toBe(false)
    if (wrong.ok) throw new Error("unreachable")
    expect(wrong.code).toBe("payout-state-not-of-command")
    expect(wrong.reason).toContain("SETTLEMENT_PAYOUT")
    expect(wrong.reason).toContain("OUTBOUND_PAYMENT")
    expect(wrong.reason).toContain("DISBURSEMENT")
  })

  it("refuses a settlement payout the beneficiary-verification state", () => {
    const wrong = transitionPayoutCommand({
      command: "SETTLEMENT_PAYOUT",
      from: "REQUESTED",
      to: "BENEFICIARY_VERIFIED",
    })
    expect(wrong.ok).toBe(false)
    if (wrong.ok) throw new Error("unreachable")
    expect(wrong.code).toBe("payout-state-not-of-command")
    expect(wrong.reason).toContain("OUTBOUND_PAYMENT")
  })

  it("refuses a balance transfer the payout rail entirely", () => {
    const wrong = transitionPayoutCommand({
      command: "BALANCE_TRANSFER",
      from: "POSTED",
      to: "IN_TRANSIT",
    })
    expect(wrong.ok).toBe(false)
    if (wrong.ok) throw new Error("unreachable")
    expect(wrong.code).toBe("payout-state-not-of-command")
  })
})

describe("each machine walks its own path", () => {
  const walks: Record<string, string[]> = {
    SETTLEMENT_PAYOUT: ["REQUESTED", "SCHEDULED", "IN_TRANSIT", "PAID", "RETURNED"],
    BALANCE_TRANSFER: ["REQUESTED", "APPROVED", "POSTED", "REVERSED"],
    OUTBOUND_PAYMENT: [
      "REQUESTED",
      "BENEFICIARY_VERIFIED",
      "APPROVED",
      "SUBMITTED",
      "POSTED",
      "RETURNED",
    ],
    REFUND: ["REQUESTED", "SUBMITTED", "SUCCEEDED"],
    DISBURSEMENT: ["REQUESTED", "APPROVED", "SCHEDULED", "PAID", "RETURNED"],
  }

  it.each(PAYOUT_COMMANDS)("%s", (command) => {
    const walk = walks[command]
    expect(walk[0]).toBe(PAYOUT_COMMAND_MACHINES[command].initial)
    for (let i = 0; i < walk.length - 1; i += 1) {
      const step = transitionPayoutCommand({ command, from: walk[i], to: walk[i + 1] })
      expect(step.ok ? step.state : `${walk[i]} -> ${walk[i + 1]}: ${step.code}`).toBe(walk[i + 1])
    }
    expect(isTerminalPayoutState(command, walk[walk.length - 1])).toBe(true)
  })
})

describe("there is no generic verb to fall back to", () => {
  it("refuses the word 'payout' itself", () => {
    const generic = transitionPayoutCommand({ command: "payout", from: "REQUESTED", to: "PAID" })
    expect(generic.ok).toBe(false)
    if (generic.ok) throw new Error("unreachable")
    expect(generic.code).toBe("payout-command-unknown")
    expect(generic.reason).toContain("no generic payout verb")
  })

  it("refuses a step out of a terminal state rather than restarting the command", () => {
    const retry = transitionPayoutCommand({
      command: "REFUND",
      from: "FAILED",
      to: "SUBMITTED",
    })
    expect(retry.ok).toBe(false)
    if (retry.ok) throw new Error("unreachable")
    expect(retry.code).toBe("payout-state-terminal")
  })

  it("refuses an in-machine transition the table does not have", () => {
    const skip = transitionPayoutCommand({
      command: "OUTBOUND_PAYMENT",
      from: "REQUESTED",
      to: "SUBMITTED",
    })
    expect(skip.ok).toBe(false)
    if (skip.ok) throw new Error("unreachable")
    expect(skip.code).toBe("payout-transition-forbidden")
    expect(skip.reason).toContain("BENEFICIARY_VERIFIED")
  })
})
