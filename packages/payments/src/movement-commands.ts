/**
 * PAY-080-001 — the four command types Bible §10 says Tenure must distinguish.
 *
 * §10 is a list of four things that all look like "moving money" in a UI and
 * are four different acts in law and in the books:
 *
 *   * **Memo allocation** — budget/fund availability moves. Nothing posts.
 *   * **Internal ledger transfer** — a balanced journal between departments,
 *     clubs, funds, projects or cost centers UNDER THE SAME LEGAL ENTITY.
 *   * **Intercompany transfer** — due-to/due-from between separate legal
 *     entities, which needs a settlement policy before it is a transfer at all.
 *   * **External provider movement** — money crosses to or from an outside
 *     bank, merchant, beneficiary, connected account or card network.
 *
 * `refusal.ts` already answers a different question — may this execute at all —
 * over a nine-value `MoneyMovementKind`. That taxonomy is the input here, not a
 * second copy of it: this module imports `MONEY_MOVEMENT_KINDS` and adds the
 * §10 classification on top, so a kind added there cannot silently acquire a
 * command type here.
 *
 * Everything fails closed. A fact this cannot read produces `commandType: null`
 * and `decided: false` — "we could not tell", which is not "internal", and is
 * emphatically not a permission. The one thing an undecided classification
 * never carries is `providerCallPermitted: true`.
 */

import { MONEY_MOVEMENT_KINDS, type Beneficiary, type MoneyMovementKind } from "./refusal"
import { PAYOUT_COMMANDS, type PayoutCommand } from "./payout-commands"

export const MOVEMENT_COMMAND_TYPES = [
  "INTERNAL_ALLOCATION",
  "INTERNAL_LEDGER_TRANSFER",
  "INTERCOMPANY_TRANSFER",
  "EXTERNAL_PROVIDER_MOVEMENT",
] as const

export type MovementCommandType = (typeof MOVEMENT_COMMAND_TYPES)[number]

/** The kinds whose effect never leaves the platform. Mirrors Bible §10's first two. */
const INTERNAL_KINDS: readonly MoneyMovementKind[] = ["memo", "ledger-allocation"]

/** Which §11 outbound command a leaving kind is. Null where §11 has no verb for it. */
const PAYOUT_COMMAND_BY_KIND: Readonly<Partial<Record<MoneyMovementKind, PayoutCommand>>> = {
  refund: "REFUND",
  payout: "SETTLEMENT_PAYOUT",
  transfer: "BALANCE_TRANSFER",
  disbursement: "DISBURSEMENT",
  "bank-instruction": "OUTBOUND_PAYMENT",
}

export interface MovementCommandFacts {
  kind: MoneyMovementKind | string
  /** The legal entity the value is recorded against. Blank is unreadable, not a default. */
  sourceLegalEntityId: string
  /** Where it lands. Null for a pure memo — a memo has no destination entity. */
  destinationLegalEntityId: string | null
  beneficiary: Beneficiary | null
  /**
   * Whether this command writes accounting entries.
   *
   * Required, and not defaulted: §10's memo allocation is defined by having NO
   * accounting posting, and a default of `true` or `false` would decide that
   * for every caller that forgot to say.
   */
  postsJournal: boolean
}

export interface MovementCommandDecision {
  /** Null exactly when `decided` is false. */
  commandType: MovementCommandType | null
  decided: boolean
  /** Stable code. What an AuditEvent records and a test asserts on. */
  code: string
  reason: string
  /**
   * PAY-080-002's predicate. True only for `EXTERNAL_PROVIDER_MOVEMENT`, and
   * never for an undecided classification.
   */
  providerCallPermitted: boolean
  /** The §11 outbound verb, when this is an external movement and §11 names one. */
  payoutCommand: PayoutCommand | null
  /** True when Bible §10 requires an intercompany accounting and settlement policy. */
  requiresIntercompanyPolicy: boolean
}

function undecided(code: string, reason: string): MovementCommandDecision {
  return {
    commandType: null,
    decided: false,
    code,
    reason,
    providerCallPermitted: false,
    payoutCommand: null,
    requiresIntercompanyPolicy: false,
  }
}

/**
 * Which of Bible §10's four this command is.
 *
 * Called by `apps/web/src/app/(app)/approvals/actions.ts` on the one path that
 * posts a `LedgerEntry`, beside `classifyRequest`. The two answer different
 * questions and both are needed: `classifyRequest` says whether the request may
 * proceed, this says what it IS. Before both existed, a club reimbursement, a
 * transfer between two universities and an instruction to pay an outside vendor
 * reached the same `db.ledgerEntry.create`.
 */
export function classifyMovementCommand(facts: MovementCommandFacts): MovementCommandDecision {
  const source = facts.sourceLegalEntityId?.trim() ?? ""
  if (source.length === 0) {
    return undecided(
      "movement-command-source-unreadable",
      "The source legal entity is blank. Every one of the four types is defined by which legal " +
        "entity the value starts under, so with no source there is no classification to make — " +
        "and an unclassified movement is not an internal one by default.",
    )
  }

  if (!(MONEY_MOVEMENT_KINDS as readonly string[]).includes(facts.kind)) {
    return undecided(
      "movement-command-unknown-kind",
      `"${facts.kind}" is not a movement kind. A kind this module cannot name is a kind whose ` +
        `§10 classification nobody has decided; it is refused rather than assigned the safest-` +
        `looking type, because the safest-looking type is a permission.`,
    )
  }
  const kind = facts.kind as MoneyMovementKind

  const destination = facts.destinationLegalEntityId?.trim() ?? null
  const externalBeneficiary = facts.beneficiary?.external === true

  if (INTERNAL_KINDS.includes(kind)) {
    // An internal kind naming somebody outside the entity is the case Bible
    // §0.10 separates, and it is a conflict rather than a classification: it
    // describes paying an outsider and posts as if it did not.
    if (externalBeneficiary) {
      return undecided(
        "movement-command-internal-names-external-beneficiary",
        `A ${kind} is an internal command and this one names "${facts.beneficiary?.name}" as a ` +
          `beneficiary outside ${source}. Either it is an external provider movement wearing an ` +
          `internal kind, or the beneficiary is mislabelled. Both are decided by a human.`,
      )
    }
    if (destination !== null && destination !== source) {
      return {
        commandType: "INTERCOMPANY_TRANSFER",
        decided: true,
        code: "movement-command-intercompany",
        reason:
          `${source} -> ${destination} crosses a legal entity boundary, so this is a due-to/due-` +
          `from between two legal owners and not an internal posting. Bible §10 requires an ` +
          `intercompany accounting and settlement policy before it may be treated as a transfer.`,
        providerCallPermitted: false,
        payoutCommand: null,
        requiresIntercompanyPolicy: true,
      }
    }

    if (kind === "memo") {
      if (facts.postsJournal) {
        return undecided(
          "movement-command-memo-posts-journal",
          "A memo allocation moves budget or fund availability and makes no accounting posting " +
            "(Bible §10). This one claims to post a journal, so it is not a memo — and a journal " +
            "recorded under a type that says there is no journal reconciles to nothing.",
        )
      }
      return {
        commandType: "INTERNAL_ALLOCATION",
        decided: true,
        code: "movement-command-internal-allocation",
        reason:
          `A memo allocation within ${source}. Budget or fund availability moves; no accounting ` +
          `entry is written and no money moves, so no provider is involved.`,
        providerCallPermitted: false,
        payoutCommand: null,
        requiresIntercompanyPolicy: false,
      }
    }

    // kind === "ledger-allocation"
    if (!facts.postsJournal) {
      return undecided(
        "movement-command-ledger-transfer-posts-nothing",
        "An internal ledger transfer IS a balanced journal between dimensions of one legal " +
          "entity (Bible §10). This one posts nothing, which makes it a memo allocation filed " +
          "under the wrong kind — a difference that decides whether the books ever see it.",
      )
    }
    return {
      commandType: "INTERNAL_LEDGER_TRANSFER",
      decided: true,
      code: "movement-command-internal-ledger-transfer",
      reason:
        `A balanced journal between dimensions of ${source}. Both sides are under one legal ` +
        `owner, so nothing crosses an entity boundary and no provider is involved.`,
      providerCallPermitted: false,
      payoutCommand: null,
      requiresIntercompanyPolicy: false,
    }
  }

  // Everything else — charge, refund, payout, transfer, disbursement, payroll,
  // bank-instruction — crosses out of Tenure by definition.
  const payoutCommand = PAYOUT_COMMAND_BY_KIND[kind] ?? null
  return {
    commandType: "EXTERNAL_PROVIDER_MOVEMENT",
    decided: true,
    code: "movement-command-external",
    reason:
      `A ${kind} crosses to or from an outside bank, merchant, beneficiary, connected account or ` +
      `card network` +
      (payoutCommand === null
        ? `. Bible §11 names no single outbound command for it, so the outbound verb is decided ` +
          `case by case rather than assumed.`
        : `, and Bible §11's verb for it is ${payoutCommand}.`) +
      ` Executing it is separately prohibited — see classifyRequest.`,
    providerCallPermitted: true,
    payoutCommand,
    requiresIntercompanyPolicy: destination !== null && destination !== source,
  }
}

export class MovementCommandError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "MovementCommandError"
    this.code = code
  }
}

/**
 * PAY-080-002's guard: the precondition any provider-bound work must pass.
 *
 * Throws — rather than returning a verdict — because a caller that is about to
 * construct a provider request has nowhere useful to put a `false`. There is no
 * provider client in this tree today (`tests/architecture/payments-port-is-the-
 * only-door.test.mjs` fails the build if one appears), so this guards the door
 * that a future provider adapter must come through rather than an existing
 * call; the ledger row for PAY-080-002 says exactly that and does not claim
 * more.
 */
export function assertProviderCallPermitted(
  decision: MovementCommandDecision,
  operation: string,
): void {
  if (decision.providerCallPermitted) return
  throw new MovementCommandError(
    decision.decided ? "provider-call-blocked-internal-command" : "provider-call-blocked-undecided",
    decision.decided
      ? `"${operation}" would call the provider for a ${decision.commandType}. Bible §10: a memo ` +
        `allocation and an internal ledger transfer under one legal entity move no money outside ` +
        `Tenure, so there is nothing for a provider to do and a call would create a second, ` +
        `unreconciled record of a movement that never happened.`
      : `"${operation}" would call the provider for a movement this platform could not classify ` +
        `(${decision.code}). An unclassified command is not an external one; it is an undecided ` +
        `one, and undecided never authorises a call.`,
  )
}

/** The §11 verbs, re-exported so a caller needs one import for both halves. */
export { PAYOUT_COMMANDS }
