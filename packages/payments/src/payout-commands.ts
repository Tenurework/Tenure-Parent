/**
 * PAY-090-001 — five outbound commands, five state machines, no generic verb.
 *
 * Bible §11 opens with the rule this file exists to enforce: "Do not use one
 * generic 'payout' verb." The five the requirement names are not synonyms and
 * their differences are the ones that cost money:
 *
 *   * `SETTLEMENT_PAYOUT` — a connected account's own balance to that account's
 *     own external bank destination. Tenure never chooses the destination and
 *     no beneficiary exists; the counterparty IS the account holder.
 *   * `BALANCE_TRANSFER` — value between platform and connected balances. No
 *     bank rail is touched, so it cannot be RETURNED by one, and it can be
 *     reversed, which a settlement payout cannot.
 *   * `OUTBOUND_PAYMENT` — treasury to a THIRD-PARTY beneficiary. The only one
 *     of the five with a beneficiary-verification state, because it is the only
 *     one where getting the counterparty wrong sends money to a stranger.
 *   * `REFUND` — back down the original payment method. The destination is not
 *     chosen at all, it is remembered; there is no beneficiary to verify and no
 *     approval of a destination to give.
 *   * `DISBURSEMENT` — reimbursement to a worker or member. An internal person,
 *     an approval ladder, and a bank rail that can return it.
 *
 * The machines are genuinely distinct rather than one table with different
 * labels. `payout-commands.test.ts` proves it two ways: no two commands have
 * the same set of states, and a state that is legal in one is refused in
 * another by name (`RETURNED` after a `REFUND`, `BENEFICIARY_VERIFIED` on
 * anything but an `OUTBOUND_PAYMENT`).
 *
 * Nothing here executes anything. `@tenure/payments` carries no write verb —
 * see the header of `gateway.ts` — so these are the shapes and the legal
 * sequences of commands, and `classifyMovementCommand` is what decides which
 * one a request is. Executing one is refused outright by `classifyRequest`.
 */

export const PAYOUT_COMMANDS = [
  "SETTLEMENT_PAYOUT",
  "BALANCE_TRANSFER",
  "OUTBOUND_PAYMENT",
  "REFUND",
  "DISBURSEMENT",
] as const

export type PayoutCommand = (typeof PAYOUT_COMMANDS)[number]

export interface PayoutCommandMachine {
  /** One sentence saying what this command is, and what it is not. */
  summary: string
  initial: string
  /** From-state → the states that may follow. A state with `[]` is terminal. */
  transitions: Readonly<Record<string, readonly string[]>>
  /** Who the money reaches. The axis the five commands actually differ on. */
  counterparty:
    | "CONNECTED_ACCOUNT_OWN_BANK"
    | "PLATFORM_OR_CONNECTED_BALANCE"
    | "THIRD_PARTY_BENEFICIARY"
    | "ORIGINAL_PAYMENT_METHOD"
    | "INTERNAL_PERSON"
  /** True when the command crosses a bank rail that can return the funds. */
  bankRail: boolean
}

export const PAYOUT_COMMAND_MACHINES: Readonly<Record<PayoutCommand, PayoutCommandMachine>> = {
  SETTLEMENT_PAYOUT: {
    summary:
      "A connected account's balance settling to that account's own external bank or debit " +
      "destination. No beneficiary: the counterparty is the account holder.",
    initial: "REQUESTED",
    counterparty: "CONNECTED_ACCOUNT_OWN_BANK",
    bankRail: true,
    transitions: {
      REQUESTED: ["SCHEDULED", "CANCELED", "FAILED"],
      SCHEDULED: ["IN_TRANSIT", "CANCELED", "FAILED"],
      IN_TRANSIT: ["PAID", "FAILED", "RETURNED"],
      PAID: ["RETURNED"],
      RETURNED: [],
      FAILED: [],
      CANCELED: [],
    },
  },
  BALANCE_TRANSFER: {
    summary:
      "Value moved between platform and connected-account balances. No bank rail, so nothing " +
      "can return it — but it can be reversed, which a settled payout cannot.",
    initial: "REQUESTED",
    counterparty: "PLATFORM_OR_CONNECTED_BALANCE",
    bankRail: false,
    transitions: {
      REQUESTED: ["APPROVED", "REJECTED"],
      APPROVED: ["POSTED", "FAILED"],
      POSTED: ["REVERSED"],
      REVERSED: [],
      REJECTED: [],
      FAILED: [],
    },
  },
  OUTBOUND_PAYMENT: {
    summary:
      "Treasury paying a third-party beneficiary. The only command of the five whose " +
      "counterparty has to be verified before it may be approved.",
    initial: "REQUESTED",
    counterparty: "THIRD_PARTY_BENEFICIARY",
    bankRail: true,
    transitions: {
      REQUESTED: ["BENEFICIARY_VERIFIED", "REJECTED", "CANCELED"],
      BENEFICIARY_VERIFIED: ["APPROVED", "REJECTED", "CANCELED"],
      APPROVED: ["SUBMITTED", "CANCELED"],
      SUBMITTED: ["POSTED", "FAILED", "RETURNED"],
      POSTED: ["RETURNED"],
      RETURNED: [],
      FAILED: [],
      REJECTED: [],
      CANCELED: [],
    },
  },
  REFUND: {
    summary:
      "Money back down the original payment method. The destination is remembered, not chosen, " +
      "so there is no beneficiary to verify and no bank return to receive.",
    initial: "REQUESTED",
    counterparty: "ORIGINAL_PAYMENT_METHOD",
    bankRail: false,
    transitions: {
      REQUESTED: ["SUBMITTED", "CANCELED"],
      SUBMITTED: ["SUCCEEDED", "FAILED"],
      SUCCEEDED: [],
      FAILED: [],
      CANCELED: [],
    },
  },
  DISBURSEMENT: {
    summary:
      "Reimbursing a worker or member. An internal counterparty, an approval ladder, and a bank " +
      "rail that can hand it back.",
    initial: "REQUESTED",
    counterparty: "INTERNAL_PERSON",
    bankRail: true,
    transitions: {
      REQUESTED: ["APPROVED", "REJECTED"],
      APPROVED: ["SCHEDULED", "CANCELED"],
      SCHEDULED: ["PAID", "FAILED", "RETURNED"],
      PAID: ["RETURNED"],
      RETURNED: [],
      FAILED: [],
      REJECTED: [],
      CANCELED: [],
    },
  },
}

/** Every state one command knows, sorted. */
export function statesOf(command: PayoutCommand): readonly string[] {
  return Object.keys(PAYOUT_COMMAND_MACHINES[command].transitions).sort()
}

export interface PayoutTransitionRefusal {
  ok: false
  code: string
  reason: string
}

export type PayoutTransition = { ok: true; command: PayoutCommand; state: string } | PayoutTransitionRefusal

/**
 * Move one outbound command, or refuse and name the command it confused.
 *
 * The refusal for a state that belongs to a DIFFERENT command says so, because
 * that is the mistake this file exists to catch: code written against "payout"
 * generically, asking a refund to go `RETURNED`.
 */
export function transitionPayoutCommand(input: {
  command: PayoutCommand | string
  from: string
  to: string
}): PayoutTransition {
  if (!(PAYOUT_COMMANDS as readonly string[]).includes(input.command)) {
    return {
      ok: false,
      code: "payout-command-unknown",
      reason:
        `"${input.command}" is not one of the five outbound commands ` +
        `(${PAYOUT_COMMANDS.join(", ")}). Bible §11: there is no generic payout verb, so there is ` +
        `no generic machine to fall back to.`,
    }
  }
  const command = input.command as PayoutCommand
  const machine = PAYOUT_COMMAND_MACHINES[command]

  if (!Object.prototype.hasOwnProperty.call(machine.transitions, input.from)) {
    return {
      ok: false,
      code: "payout-state-not-of-command",
      reason: `${input.from} is not a state of ${command}. ${describeForeignState(input.from, command)}`,
    }
  }
  if (!Object.prototype.hasOwnProperty.call(machine.transitions, input.to)) {
    return {
      ok: false,
      code: "payout-state-not-of-command",
      reason: `${input.to} is not a state of ${command}. ${describeForeignState(input.to, command)}`,
    }
  }

  const allowed = machine.transitions[input.from]
  if (allowed.length === 0) {
    return {
      ok: false,
      code: "payout-state-terminal",
      reason:
        `${input.from} is terminal for ${command}. A retry is a new command that references this ` +
        `one, never a step out of a finished state.`,
    }
  }
  if (!allowed.includes(input.to)) {
    return {
      ok: false,
      code: "payout-transition-forbidden",
      reason: `${command}: ${input.from} -> ${input.to} is not a transition. From ${input.from}: ${allowed.join(", ")}.`,
    }
  }
  return { ok: true, command, state: input.to }
}

/** Which OTHER command owns a state, when one does. Half of the refusal text. */
function describeForeignState(state: string, notThisOne: PayoutCommand): string {
  const owners = PAYOUT_COMMANDS.filter(
    (c) => c !== notThisOne && Object.prototype.hasOwnProperty.call(PAYOUT_COMMAND_MACHINES[c].transitions, state),
  )
  if (owners.length === 0) {
    return `No outbound command has a state by that name.`
  }
  return (
    `It belongs to ${owners.join(", ")}. ${PAYOUT_COMMAND_MACHINES[notThisOne].summary} ` +
    `Treating the two as one verb is what Bible §11 forbids.`
  )
}

/** True when nothing follows this state for this command. */
export function isTerminalPayoutState(command: PayoutCommand, state: string): boolean {
  const transitions = PAYOUT_COMMAND_MACHINES[command].transitions
  return Object.prototype.hasOwnProperty.call(transitions, state) && transitions[state].length === 0
}
