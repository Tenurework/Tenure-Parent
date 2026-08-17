import { db } from "@/lib/db"
import { convertWithEvidence, type FxEvidence, type QuotedRate } from "@tenure/finops"
import {
  DEFAULT_MOVEMENT_LIMITS,
  evaluateMovementLimits,
  observationWindows,
  type LimitDecision,
  type LimitObservations,
  type MovementLimitPolicy,
} from "@tenure/payments"

/**
 * PAY-200-004 and PAY-190-002 on the one path that posts money.
 *
 * `actOnApproval` already asks `classifyRequest` whether a movement of this KIND
 * may happen at all (PAY-180-006). Two questions it did not ask:
 *
 *   1. **How much, how often, and how much in total** — the six ceilings in
 *      `@tenure/payments`' limits engine. An internal allocation is allowed by
 *      design, so before this the amount, the tempo and the daily total were
 *      unbounded, and two requests each under the approval ladder's ceiling
 *      summed to whatever their author chose.
 *   2. **Which currency the claim is actually in** — the entry is denominated in
 *      the BUDGET LINE's currency (`PAY-030-007`) and the claim's amount was
 *      posted into it unconverted. A €100.00 claim against a USD line posted
 *      $100.00: a different amount of money wearing the same digits, with no
 *      rate, no evidence and nothing to reconcile against later.
 *
 * Both are answered here, before the journal is built, and both fail closed. The
 * reads happen in this module rather than in the action so that the WINDOW read
 * is the window the engine judges — `observationWindows` derives it from the same
 * policy object — and so that a read that throws becomes `null` observations,
 * which the engine refuses, rather than a zero that looks like an empty history.
 *
 * Not a limiter of its own: every rule lives in the packages, and this is the
 * adapter that supplies them the facts from Prisma.
 */

/** Where a `payment.fx` block in an approval's metadata is read from. */
export interface DeclaredFxQuote {
  from?: unknown
  to?: unknown
  rate?: unknown
  asOf?: unknown
  source?: unknown
  quoteId?: unknown
}

export interface MovementGateInput {
  institutionId: string
  /** Who is issuing the command. */
  actorPrincipalId: string
  /** Who receives the value — for a reimbursement, whoever fronted the cash. */
  recipientKey: string
  /** The internal dimension it lands on — the budget line. */
  accountKey: string
  /** The claim as filed: amount and currency the requester stated. */
  presentmentMinorUnits: number
  presentmentCurrency: string
  /** Recoverable tax inside the claim, in presentment minor units. */
  presentmentTaxMinorUnits: number
  /** The currency the books settle in — the budget line's. */
  settlementCurrency: string
  /** The `payment.fx` block off the approval's metadata, when it carries one. */
  declaredQuote: DeclaredFxQuote | null
  /** Overridable so a test can price a currency the default policy does not. */
  policy?: MovementLimitPolicy
  /** How old a rate quote may be. Overridable for the same reason. */
  maxQuoteAgeSeconds?: number
}

export interface MovementGateRefusal {
  ok: false
  /** `Payments.<this>` is the audit action recorded for the refusal. */
  gate: "FX" | "LIMITS"
  code: string
  reason: string
}

export interface MovementGateClearance {
  ok: true
  /** What to post, in the settlement currency. */
  settlementGrossMinorUnits: number
  settlementTaxMinorUnits: number
  /** The FX record for the gross leg, and for the tax leg when there is one. */
  fx: FxEvidence
  taxFx: FxEvidence | null
  limits: LimitDecision
}

export type MovementGateOutcome = MovementGateClearance | MovementGateRefusal

/** A day, in seconds — the pilot has no intraday rate feed, so a quote is a day's quote. */
const DEFAULT_MAX_QUOTE_AGE_SECONDS = 86_400

/**
 * A quote off untrusted metadata, or null.
 *
 * Shape-checked here and validated for real by `convertWithEvidence`: pair,
 * positive-decimal rate, named source, usable date and age all have one
 * implementation, in `@tenure/finops`, and this must not grow a second opinion
 * about any of them. What this does is refuse to build a `QuotedRate` out of
 * values that are not strings, because a `rate` of `{}` would otherwise reach
 * the arithmetic as "[object Object]".
 */
export function declaredQuote(block: DeclaredFxQuote | null): QuotedRate | null {
  if (!block) return null
  const str = (value: unknown): string | null => (typeof value === "string" ? value : null)
  const from = str(block.from)
  const to = str(block.to)
  const rate = str(block.rate)
  const asOf = str(block.asOf)
  const source = str(block.source)
  if (from === null || to === null || rate === null || asOf === null || source === null) return null
  return { from, to, rate, asOf, source, quoteId: str(block.quoteId) }
}

/**
 * Read the six ceilings' history, or return null.
 *
 * Null when any read fails. That is the distinction the limits engine is built
 * around: an empty history is `0`, an unreadable one is `null`, and a caller
 * that collapses them hands every ceiling a clean slate on the day the database
 * is unhappy.
 *
 * Only positive postings count. A later reversal does not give the day's ceiling
 * back — the money moved, and the correction is its own event — so the
 * aggregates filter `amountCents > 0` rather than summing a signed total that a
 * reversal could pull below zero.
 */
export async function readLimitObservations(input: {
  institutionId: string
  actorPrincipalId: string
  recipientKey: string
  accountKey: string
  settlementCurrency: string
  policy: MovementLimitPolicy
  readAt: Date
}): Promise<LimitObservations | null> {
  const { institutionId, actorPrincipalId, recipientKey, accountKey, settlementCurrency } = input
  const windows = observationWindows(input.policy, input.readAt.toISOString())
  const positive = { gt: 0 }

  try {
    const [actorCommands, tenantCommands, recipient, account, tenant] = await Promise.all([
      db.ledgerEntry.count({
        where: {
          institutionId,
          postedById: actorPrincipalId,
          createdAt: { gte: new Date(windows.rateSince) },
        },
      }),
      db.ledgerEntry.count({
        where: { institutionId, createdAt: { gte: new Date(windows.velocitySince) } },
      }),
      db.ledgerEntry.aggregate({
        _sum: { amountCents: true },
        where: {
          institutionId,
          currency: settlementCurrency,
          amountCents: positive,
          budgetLineId: { not: null },
          createdAt: { gte: new Date(windows.aggregateSince) },
          approval: { submittedById: recipientKey },
        },
      }),
      db.ledgerEntry.aggregate({
        _sum: { amountCents: true },
        where: {
          institutionId,
          currency: settlementCurrency,
          amountCents: positive,
          budgetLineId: accountKey,
          createdAt: { gte: new Date(windows.aggregateSince) },
        },
      }),
      db.ledgerEntry.aggregate({
        _sum: { amountCents: true },
        where: {
          institutionId,
          currency: settlementCurrency,
          amountCents: positive,
          budgetLineId: { not: null },
          createdAt: { gte: new Date(windows.aggregateSince) },
        },
      }),
    ])

    return {
      observedAt: input.readAt.toISOString(),
      coversSince: windows.earliest,
      actorCommands,
      tenantCommands,
      recipientPriorMinorUnits: recipient._sum.amountCents ?? 0,
      accountPriorMinorUnits: account._sum.amountCents ?? 0,
      tenantPriorMinorUnits: tenant._sum.amountCents ?? 0,
      currency: settlementCurrency,
      recipientKey,
      accountKey,
    }
  } catch {
    // Deliberately swallowed and turned into null. The engine's refusal says
    // "we could not look", which is the sentence this case needs; re-throwing
    // here would produce a stack trace instead of a decision, and returning
    // zeros would produce a decision that is a lie.
    return null
  }
}

/**
 * Convert the claim into the posting currency, then bound it.
 *
 * FX first, deliberately: the ceilings are priced in the settlement currency, so
 * bounding the presentment amount would compare a euro figure against a dollar
 * ceiling — the exact mistake `evaluateMovementLimits` refuses when it is handed
 * a mismatched reading, and one worth not making a second time upstream.
 */
export async function gateMoneyMovement(
  input: MovementGateInput,
): Promise<MovementGateOutcome> {
  const policy = input.policy ?? DEFAULT_MOVEMENT_LIMITS
  const maxQuoteAgeSeconds = input.maxQuoteAgeSeconds ?? DEFAULT_MAX_QUOTE_AGE_SECONDS
  const readAt = new Date()
  const quote = declaredQuote(input.declaredQuote)

  const gross = convertWithEvidence({
    presentmentMinorUnits: input.presentmentMinorUnits,
    presentmentCurrency: input.presentmentCurrency,
    settlementCurrency: input.settlementCurrency,
    quote,
    providerFeeMinorUnits: null,
    recognitionQuote: null,
    providerSettledMinorUnits: null,
    at: readAt.toISOString(),
    maxQuoteAgeSeconds,
  })
  if (!gross.ok) {
    return { ok: false, gate: "FX", code: gross.code, reason: gross.reason }
  }

  let taxFx: FxEvidence | null = null
  if (input.presentmentTaxMinorUnits > 0) {
    const tax = convertWithEvidence({
      presentmentMinorUnits: input.presentmentTaxMinorUnits,
      presentmentCurrency: input.presentmentCurrency,
      settlementCurrency: input.settlementCurrency,
      quote,
      providerFeeMinorUnits: null,
      recognitionQuote: null,
      providerSettledMinorUnits: null,
      at: readAt.toISOString(),
      maxQuoteAgeSeconds,
    })
    if (!tax.ok) {
      return { ok: false, gate: "FX", code: tax.code, reason: tax.reason }
    }
    taxFx = tax.evidence
  }

  const settlementGrossMinorUnits = gross.evidence.settlement.minorUnits
  const settlementTaxMinorUnits = taxFx?.settlement.minorUnits ?? 0

  if (settlementTaxMinorUnits > settlementGrossMinorUnits) {
    return {
      ok: false,
      gate: "FX",
      code: "fx-tax-exceeds-gross",
      reason:
        `Converted, the recoverable tax (${settlementTaxMinorUnits}) is larger than the claim it is ` +
        `inside (${settlementGrossMinorUnits}) in ${input.settlementCurrency}. The net side of the ` +
        `journal would be negative, and a balanced journal built from a negative net is balanced ` +
        `around the wrong number.`,
    }
  }

  const observations = await readLimitObservations({
    institutionId: input.institutionId,
    actorPrincipalId: input.actorPrincipalId,
    recipientKey: input.recipientKey,
    accountKey: input.accountKey,
    settlementCurrency: input.settlementCurrency,
    policy,
    readAt,
  })

  const limits = evaluateMovementLimits(
    {
      institutionId: input.institutionId,
      actorPrincipalId: input.actorPrincipalId,
      recipientKey: input.recipientKey,
      accountKey: input.accountKey,
      amountMinorUnits: settlementGrossMinorUnits,
      currency: input.settlementCurrency,
      at: new Date().toISOString(),
    },
    observations,
    policy,
  )

  if (limits.verdict !== "WITHIN_LIMITS") {
    return { ok: false, gate: "LIMITS", code: limits.code, reason: limits.reason }
  }

  return {
    ok: true,
    settlementGrossMinorUnits,
    settlementTaxMinorUnits,
    fx: gross.evidence,
    taxFx,
    limits,
  }
}
