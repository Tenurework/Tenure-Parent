import "server-only"

import { db } from "@/lib/db"
import { modelTokenBudgetForInstitution } from "@/lib/config/server"

/**
 * WRK-120-004 — cost allocation and budgets for model use and provider calls.
 *
 * ## What was missing, exactly
 *
 * `apps/web/src/lib/ai.ts` holds the one outbound vendor call this application
 * makes. It parsed the response as `{ content?: … }` — a cast that names
 * `content` and nothing else — while the Anthropic messages API returns
 * `usage.input_tokens` and `usage.output_tokens` on every success. The numbers
 * arrived on the wire and were discarded, so no tenant could be charged for a
 * call and no budget could refuse one. The only token in that file was
 * `max_tokens`, which is a CAP on one response and the opposite of a
 * measurement: it bounds the next call and knows nothing about the last
 * thousand.
 *
 * ## Two halves, and both are needed
 *
 * MEASURE is `recordModelUsage`: one row per provider call, carrying the
 * vendor's own numbers, the model that produced them and the tenant they
 * belong to. ALLOCATE is `budgetVerdict`: the period total compared against a
 * ceiling resolved from that tenant's published configuration. Either alone is
 * decorative — a meter nobody reads is a bigger table, and a budget with no
 * meter is a number compared against zero forever.
 *
 * ## Tokens, not dollars
 *
 * Deliberately. `packages/finops` owns money — prices, currencies, rounding —
 * and it is the concurrent owner of that package this run must not edit. More
 * importantly a token count is MEASURED (the vendor reports it) while a dollar
 * figure is MODELLED (a price list we maintain), and a ceiling that silently
 * depends on a stale table is a ceiling that stops meaning what it says. The
 * rows carry `model` precisely so dollars can be derived later from something
 * that was recorded accurately.
 *
 * ## The period is a UTC calendar month
 *
 * Written onto the row rather than computed from `occurredAt` at read time, so
 * the aggregate can use the `[institutionId, period]` index and so the month
 * boundary is the application's single answer rather than the database
 * server's timezone.
 */

/** What one provider call consumed, as the vendor reported it. */
export interface ModelUsage {
  /** The model id actually invoked — two models do not cost the same. */
  model: string
  inputTokens: number
  outputTokens: number
}

/** One metered call: the usage, plus who it belongs to and when it happened. */
export interface ModelUsageEvent extends ModelUsage {
  institutionId: string
  at: Date
}

/**
 * The billing period an instant falls in: the UTC calendar month, `YYYY-MM`.
 *
 * UTC and not the institution's `timeZone`, deliberately. An allowance is a
 * commercial quantity and it has to add up the same way for every tenant on a
 * deployment; a per-tenant month boundary would make two institutions' meters
 * cover overlapping windows, and the sum over "August" would depend on who
 * asked.
 */
export function periodOf(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`
}

/**
 * Record one provider call.
 *
 * Called from `aiComplete`'s required `onUsage` callback — required rather than
 * optional precisely so that a new surface reaching the vendor is a `tsc`
 * error rather than a silently unmetered call. Every one of the four call
 * sites passes one.
 *
 * Negative or non-finite numbers are refused rather than clamped. A vendor
 * response that carried one would mean the field is not what this code thinks
 * it is, and a meter that silently rounded such a value to zero would report a
 * tenant as having spent nothing while it spent something.
 */
export async function recordModelUsage(event: ModelUsageEvent): Promise<void> {
  const { institutionId, model, inputTokens, outputTokens, at } = event

  for (const [name, value] of [
    ["inputTokens", inputTokens],
    ["outputTokens", outputTokens],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new TypeError(
        `A model-usage meter row needs a whole, non-negative ${name}; the vendor reported ` +
          `${JSON.stringify(value)}. Recording it as zero would report this tenant as having ` +
          `spent nothing on a call that spent something.`,
      )
    }
  }

  await db.modelUsageMeter.create({
    data: {
      institutionId,
      model,
      inputTokens,
      outputTokens,
      period: periodOf(at),
      occurredAt: at,
    },
  })
}

/**
 * This tenant's total tokens — input plus output — in the period `at` falls in.
 *
 * A SUM in the database rather than a page of rows summed here: the meter grows
 * by one row per assistant answer, and a budget check that loaded a month of
 * them onto the request path would get slower exactly as a tenant approached
 * its ceiling.
 */
export async function modelTokensUsedInPeriod(institutionId: string, at: Date): Promise<number> {
  const totals = await db.modelUsageMeter.aggregate({
    where: { institutionId, period: periodOf(at) },
    _sum: { inputTokens: true, outputTokens: true },
  })
  return (totals._sum.inputTokens ?? 0) + (totals._sum.outputTokens ?? 0)
}

/** Why a tenant may or may not make another model call right now. */
export type BudgetReason =
  /** Under the ceiling. The only value on which a vendor call may proceed. */
  | "within-budget"
  /** The period total has reached or passed the ceiling. */
  | "budget-exhausted"
  /**
   * The ceiling did not resolve to a number, which can only mean the definition
   * has left the registry. Reported separately from `budget-exhausted` because
   * one is a tenant at its limit and the other is a platform defect, and an
   * operator told the wrong one goes and raises the wrong allowance.
   */
  | "budget-unreadable"

export interface BudgetVerdict {
  /** True only for `within-budget`. Nothing else may reach the vendor. */
  allowed: boolean
  reason: BudgetReason
  /** `YYYY-MM`, so a refusal says which month is exhausted. */
  period: string
  /** Tokens already spent this period. */
  usedTokens: number
  /** The ceiling, or null when it could not be read. */
  capTokens: number | null
}

/**
 * May this tenant make another model call?
 *
 * The boundary is deliberate and it is tested: a tenant whose period total is
 * exactly AT the cap is still allowed. A budget of N tokens that refused the
 * call that would take it to N would be a budget of N-1, and the off-by-one
 * would show up as an allowance nobody could ever spend to the end of. One
 * token over is refused.
 *
 * Called by `/api/ai/chat` BEFORE the vendor call, and by nothing else that
 * decides — the route degrades to the sources-only answer it already returns
 * for an unconfigured key, so a refusal here lands on a path that already
 * exists rather than on a new error surface.
 */
export async function budgetVerdict(institutionId: string, at: Date): Promise<BudgetVerdict> {
  const period = periodOf(at)
  const [capTokens, usedTokens] = await Promise.all([
    modelTokenBudgetForInstitution(institutionId),
    modelTokensUsedInPeriod(institutionId, at),
  ])

  if (capTokens === null) {
    return { allowed: false, reason: "budget-unreadable", period, usedTokens, capTokens: null }
  }

  // `>` and not `>=`: at the cap is inside the allowance. See above.
  if (usedTokens > capTokens) {
    return { allowed: false, reason: "budget-exhausted", period, usedTokens, capTokens }
  }

  return { allowed: true, reason: "within-budget", period, usedTokens, capTokens }
}
