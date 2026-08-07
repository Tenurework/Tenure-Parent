/**
 * PAY-180-006 — the one control §0.3 makes absolute, as code.
 *
 * `docs/implementation/NEXT-SESSION.md` §0.3 forbids executing money movement
 * outright, and Bible §0.9 says the same from the product side: "One click may
 * initiate an approved state machine after validations and approvals. It never
 * bypasses maker-checker, step-up, sanctions/fraud checks, limits, funds
 * availability, provider confirmation or reconciliation."
 *
 * Until this existed, that was a promise in a prompt. Nothing in the codebase
 * could tell a memo apart from a disbursement: `actOnApproval` posted a
 * `LedgerEntry` with no gate distinguishing an internal allocation between two
 * clubs of one university from an instruction to pay an outside vendor.
 *
 * Three verdicts, because two is not enough:
 *
 *   * `REFUSED` — the effect leaves the platform. A payout, transfer, charge,
 *     payroll run or bank instruction. There is no amount small enough and no
 *     approver senior enough for this path to execute one.
 *   * `ESCALATE` — the shape is internal and something about it is not. A
 *     ledger allocation naming an external beneficiary is the canonical case:
 *     it posts internally and it describes paying somebody outside. Refusing it
 *     silently would break legitimate work; allowing it silently is how a
 *     disbursement gets booked as a memo.
 *   * `ALLOWED` — a memo or ledger write within one legal entity, naming
 *     nobody outside it.
 *
 * Fails closed: an unrecognised kind escalates rather than passing.
 */

export const MONEY_MOVEMENT_KINDS = [
  "memo",
  "ledger-allocation",
  "charge",
  "refund",
  "payout",
  "transfer",
  "disbursement",
  "payroll",
  "bank-instruction",
] as const

export type MoneyMovementKind = (typeof MONEY_MOVEMENT_KINDS)[number]

/** Kinds whose effect leaves the platform. Absolute refusal, not a limit. */
const LEAVES_THE_PLATFORM: readonly MoneyMovementKind[] = [
  "charge",
  "refund",
  "payout",
  "transfer",
  "disbursement",
  "payroll",
  "bank-instruction",
]

/** Kinds that post inside Tenure and move nothing. */
const INTERNAL_ONLY: readonly MoneyMovementKind[] = ["memo", "ledger-allocation"]

export interface Beneficiary {
  /** True when the payee is outside the source legal entity. */
  external: boolean
  name: string
}

export interface MoneyMovementRequest {
  kind: MoneyMovementKind | string
  /** The legal entity the value is recorded against. */
  sourceLegalEntityId: string
  /** Where it lands. Null for a pure memo. */
  destinationLegalEntityId: string | null
  beneficiary: Beneficiary | null
  amountMinorUnits: number
  currency: string
}

export type RefusalVerdict = "ALLOWED" | "REFUSED" | "ESCALATE"

export interface RefusalDecision {
  verdict: RefusalVerdict
  /** Stable code. What an AuditEvent records and a test asserts on. */
  code: string
  reason: string
  /** The queue that owns the ambiguity. Null when there is none to own. */
  escalateTo: string | null
}

/** The seat that adjudicates an ambiguous instruction. Bible §12 operations. */
export const PAYMENTS_OPERATIONS_QUEUE = "payments-operations"

/**
 * Classify one request.
 *
 * Called by `apps/web/src/app/(app)/approvals/actions.ts` before any
 * `LedgerEntry` write, so a REFUSED request blocks the write and records the
 * reason rather than posting and being discovered later.
 */
export function classifyRequest(request: MoneyMovementRequest): RefusalDecision {
  const kind = request.kind as MoneyMovementKind

  if (!(MONEY_MOVEMENT_KINDS as readonly string[]).includes(kind)) {
    return {
      verdict: "ESCALATE",
      code: "money-movement-unknown-kind",
      reason:
        `"${request.kind}" is not a movement kind this control knows. An unrecognised instruction ` +
        `is adjudicated by a human, not waved through — a new kind added upstream would otherwise ` +
        `arrive already exempt.`,
      escalateTo: PAYMENTS_OPERATIONS_QUEUE,
    }
  }

  if (LEAVES_THE_PLATFORM.includes(kind)) {
    return {
      verdict: "REFUSED",
      code: "money-movement-prohibited",
      reason:
        `A ${kind} moves ${request.amountMinorUnits} ${request.currency} out of Tenure's control. ` +
        `Executing payments, payouts, payroll or bank instructions is prohibited outright ` +
        `(NEXT-SESSION §0.3); this path may record a decision, never perform one.`,
      escalateTo: PAYMENTS_OPERATIONS_QUEUE,
    }
  }

  if (INTERNAL_ONLY.includes(kind)) {
    if (request.beneficiary?.external) {
      return {
        verdict: "ESCALATE",
        code: "money-movement-external-beneficiary",
        reason:
          `A ${kind} is an internal posting, and this one names "${request.beneficiary.name}" as ` +
          `a beneficiary outside ${request.sourceLegalEntityId}. Bible §0.10: an allocation under ` +
          `one legal owner is an internal ledger movement — naming an outside payee means it is ` +
          `not one, or the beneficiary is mislabelled. A human decides which.`,
        escalateTo: PAYMENTS_OPERATIONS_QUEUE,
      }
    }

    if (
      request.destinationLegalEntityId !== null &&
      request.destinationLegalEntityId !== request.sourceLegalEntityId
    ) {
      return {
        verdict: "ESCALATE",
        code: "money-movement-crosses-legal-entity",
        reason:
          `A ${kind} from ${request.sourceLegalEntityId} to ${request.destinationLegalEntityId} ` +
          `crosses a legal entity boundary. That is a transfer between two legal owners recorded ` +
          `as an internal posting, which is exactly the case Bible §0.10 separates.`,
        escalateTo: PAYMENTS_OPERATIONS_QUEUE,
      }
    }

    if (!Number.isInteger(request.amountMinorUnits) || request.amountMinorUnits < 0) {
      return {
        verdict: "ESCALATE",
        code: "money-movement-amount-unusable",
        reason:
          `${request.amountMinorUnits} is not a whole, non-negative count of minor units. An ` +
          `amount this control cannot read is one it cannot bound.`,
        escalateTo: PAYMENTS_OPERATIONS_QUEUE,
      }
    }

    return {
      verdict: "ALLOWED",
      code: "money-movement-internal",
      reason:
        `A ${kind} of ${request.amountMinorUnits} ${request.currency} within ` +
        `${request.sourceLegalEntityId}, naming no beneficiary outside it. Nothing leaves the ` +
        `platform, so nothing is executed.`,
      escalateTo: null,
    }
  }

  // Unreachable while every kind is in exactly one of the two lists above; kept
  // because "unreachable" is a claim about a list somebody will edit.
  return {
    verdict: "ESCALATE",
    code: "money-movement-unclassified",
    reason: `"${kind}" is a known kind that no rule classifies. That is a gap, not a permission.`,
    escalateTo: PAYMENTS_OPERATIONS_QUEUE,
  }
}
