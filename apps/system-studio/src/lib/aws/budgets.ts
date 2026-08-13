/**
 * STUDIO-120-009 / STUDIO-000-006 — what the account's budgets actually say, and
 * the two things about them that are routinely reported as good news when they
 * are nothing of the kind.
 *
 * The first is the one the whole `AwsRead` vocabulary exists for: a denied
 * `budgets:ViewBudget` returns no budgets, and "no budgets" renders as a clean
 * cost page. Nothing here can produce that. `readAws` is the only path from an
 * exception to a state, and it has no arm that turns a throw into `EMPTY`.
 *
 * The second is specific to Budgets and is worse, because it survives a correct
 * IAM grant. A budget carries alert thresholds, and each threshold carries a
 * subscriber list. A threshold with an empty subscriber list fires into nothing:
 * the budget is breached, AWS evaluates the notification, and no human is told.
 * On every console that has ever shipped this reads exactly like a budget that
 * is fine — same green row, same limit, same spend.
 *
 * This engine cannot answer that question today, and the honest consequence is
 * written into the type rather than into a comment. `BudgetReading.alerting` is
 * an `AwsRead<readonly BudgetAlert[]>` in the `UNCONFIGURED` state, whose `why`
 * names the two capabilities that are missing from `capabilities.ts`:
 *
 *     budgets:DescribeNotificationsForBudget
 *     budgets:DescribeSubscribersForNotification
 *
 * Both are authorised by `budgets:ViewBudget`, which `infrastructure/studio/iam.tf`
 * ALREADY grants, so the IAM half of this is done. What is missing is the
 * registry entry and the `client.ts` switch arm, and this module is not allowed
 * to add either — the registry is the enumeration of everything the console can
 * reach, and a service adapter that extends it on its own way past a review is
 * how that enumeration stops being true. Until they land, every threshold on
 * every budget reads as `UNCONFIGURED`, which `isUnknown()` classifies as an
 * unknown and no surface may print as "alerts configured".
 *
 * ## Money
 *
 * Through `@tenure/finops`, in integer minor units, with the currency carried.
 * `BudgetLimit.Amount` arrives as a decimal STRING and `fromDecimal` parses the
 * string — never `Number(...)`, which is the float this platform's cost
 * arithmetic is specifically built to avoid.
 *
 * And the unit is only a currency for a COST budget. A USAGE budget's `Unit` is
 * `GB` or `Requests`; an `RI_UTILIZATION` budget's is `PERCENTAGE`. Feeding any
 * of those to `fromDecimal` produces a `Money` denominated in "GB", which then
 * sums with dollars and renders with a currency symbol. So the money arms are
 * `null` for those budget types and `quantity` carries the figure with its real
 * unit instead.
 */

import {
  compare,
  figure,
  fromDecimal,
  money,
  subtract,
  toMinorUnits,
  type BudgetState,
  type Figure,
  type FigureSource,
  type Money,
} from "@tenure/finops"

import { BUDGETS_TTL_MS, CAPABILITIES } from "./capabilities"
import { denialContextFrom, resolveIdentity, type Identity } from "./identity"
import {
  describeRead,
  liveGateway,
  readAws,
  type AwsGateway,
  type AwsRead,
  type DenialContext,
} from "./read"
import {
  TENANT_TAG,
  attributionOf,
  describeAttribution,
  tagIndex,
  taggedResources,
  type Attribution,
  type TaggedResource,
} from "./tags"
import { READ_ATTEMPTS, backoffMs } from "./throttle"

/* ------------------------------------------------------- the API's shape -- */

/**
 * The `DescribeBudgets` response, declared rather than imported.
 *
 * Same reason `tags.ts` and `retained.ts` declare theirs: `client.ts` is the one
 * module permitted to import `@aws-sdk/*`, and `tests/architecture/forbidden-clients.test.mjs`
 * fails the build for a second one — including for a type-only import, because a
 * type-only import today is a value import after one refactor.
 */
interface DescribeBudgetsResponse {
  Budgets?: Array<{
    BudgetName?: string
    BudgetLimit?: { Amount?: string; Unit?: string }
    CalculatedSpend?: {
      ActualSpend?: { Amount?: string; Unit?: string }
      ForecastedSpend?: { Amount?: string; Unit?: string }
    }
    CostFilters?: Record<string, string[] | undefined>
    TimeUnit?: string
    TimePeriod?: { Start?: Date | string; End?: Date | string }
    BudgetType?: string
    LastUpdatedTime?: Date | string
  }>
  NextToken?: string
}

/** How many pages to walk before giving up. A runaway page loop is an outage. */
const MAX_PAGES = 20

/**
 * The only budget type whose amounts are money.
 *
 * `USAGE`, `RI_UTILIZATION`, `RI_COVERAGE`, `SAVINGS_PLANS_UTILIZATION` and
 * `SAVINGS_PLANS_COVERAGE` all use `Amount`/`Unit` for a quantity that is not a
 * currency amount, and the API gives no other signal that it is not.
 */
const MONETARY_BUDGET_TYPE = "COST"

/* ------------------------------------------------------------- the types -- */

/**
 * One alert threshold on a budget, and who it actually reaches.
 *
 * Declared and — today — never constructed, because the two capabilities that
 * would populate it are not in the registry. That is stated rather than hidden:
 * the field holding it is an `AwsRead` in the UNCONFIGURED state, so a caller
 * cannot reach a `BudgetAlert[]` without narrowing past a state that says the
 * question was not asked. A `readonly BudgetAlert[]` defaulted to `[]` would
 * have compiled everywhere and meant "no thresholds", which is the claim this
 * module refuses to make.
 */
export interface BudgetAlert {
  /** Whether the threshold watches spend so far or the projection. */
  notificationType: "ACTUAL" | "FORECASTED"
  comparisonOperator: string
  threshold: number
  thresholdType: "PERCENTAGE" | "ABSOLUTE_VALUE"
  /** Whether AWS considers the threshold currently breached. */
  state: "ALARM" | "OK" | "UNKNOWN"
  /**
   * Where a breach is sent. An EMPTY list here is the finding — a threshold
   * with no subscriber notifies nobody — which is why it is a list on a shape
   * that is only reachable through a successful read.
   */
  subscribers: readonly { via: "SNS" | "EMAIL"; address: string }[]
}

/**
 * A budget figure that is not money — GB, requests, percent.
 *
 * Separate from `Figure` on purpose. `Figure` holds a `Money`, and a `Money`
 * whose currency is "GB" adds to dollars without complaint.
 */
export interface BudgetQuantity {
  amount: string
  unit: string
}

/**
 * Where a budget stands.
 *
 * `finops`' own `BudgetState` plus one arm it does not have. AWS does not always
 * compute a `ForecastedSpend` — early in a period, and for budget types where a
 * projection is not modelled, the field is simply absent. Without it, "is this
 * on track" has no answer, and every one of `UNDER` / `ON_TRACK` / `AT_RISK`
 * would be a claim about a trajectory nothing computed.
 */
export type BudgetPosture = BudgetState | "NO_FORECAST"

export interface BudgetReading {
  name: string
  /**
   * Built from the RESOLVED identity's partition and account, never a literal.
   *
   * Budgets ARNs carry no region — the service is partition-scoped — so the
   * region segment is genuinely empty here rather than omitted by accident.
   */
  arn: string
  /** `COST`, `USAGE`, `RI_UTILIZATION`, … as AWS spells it. */
  type: string
  /** `DAILY`, `MONTHLY`, `QUARTERLY`, `ANNUALLY`. */
  timeUnit: string
  period: { start: string | null; end: string | null }
  lastUpdated: string | null
  /** The limit, for a COST budget. Null for every other type — see `quantity`. */
  limit: Figure | null
  actual: Figure | null
  /** AWS's own projection, not a straight line computed here. */
  forecast: Figure | null
  /** The non-monetary figures, for a budget whose unit is not a currency. */
  quantity: { limit: BudgetQuantity | null; actual: BudgetQuantity | null; forecast: BudgetQuantity | null } | null
  posture: BudgetPosture
  postureDetail: string
  /** Forecast minus limit. Negative is headroom. Null when either is missing. */
  variance: Money | null
  /** From the resource's tags, through the Resource Groups Tagging API. */
  attribution: Attribution
  /**
   * The tenant whose spend this budget WATCHES, from its own cost filters.
   *
   * Distinct from `attribution`, which is who owns the budget resource. A budget
   * tagged for one tenant and filtered to another's spend is a real
   * misconfiguration, and collapsing the two fields would hide it.
   */
  watchesTenant: string | null
  /** Whether any threshold notifies anybody. Never inferred, never defaulted. */
  alerting: AwsRead<readonly BudgetAlert[]>
}

export interface BudgetReadings {
  identity: AwsRead<Identity>
  tagged: AwsRead<readonly TaggedResource[]>
  budgets: AwsRead<readonly BudgetReading[]>
  /** When this engine performed the read. Present whatever the outcome was. */
  asOf: string
  /** This capability's own cadence, so a surface can say how old is too old. */
  refreshMs: number
}

/* ------------------------------------------------------------ the reader -- */

/**
 * Every budget in the resolved account.
 *
 * `accountId` is threaded from `sts:GetCallerIdentity` and never from an
 * environment default, because `DescribeBudgets` against the wrong account does
 * not error — it returns an empty list, which is the one answer this surface
 * must never produce by accident. When identity did not resolve, the call is not
 * made at all and the read is UNCONFIGURED naming why; `String(undefined)` in
 * `client.ts` would otherwise send the literal string "undefined" as the account
 * and get exactly that empty list back.
 */
export async function budgetReadings(
  supplied?: AwsGateway,
  options: {
    now?: () => Date
    identity?: AwsRead<Identity>
    tagged?: AwsRead<readonly TaggedResource[]>
    /** Injected so a throttle's backoff is instant under test rather than a real wait. */
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<BudgetReadings> {
  const gw = supplied ?? liveGateway()
  const now = options.now ?? (() => new Date())
  const identity = options.identity ?? (await resolveIdentity(supplied, { now }))
  const denial = denialContextFrom(identity)
  const tagged = options.tagged ?? (await taggedResources(supplied, { now, denial }))

  const budgets = await readBudgets(gw, {
    now,
    denial,
    identity,
    tags: tagIndex(tagged.state === "ACTUAL" || tagged.state === "STALE" ? tagged.value : []),
    sleep: options.sleep,
  })

  return {
    identity,
    tagged,
    budgets,
    asOf: now().toISOString(),
    refreshMs: CAPABILITIES["budgets:DescribeBudgets"].refreshMs,
  }
}

interface ReadContext {
  now: () => Date
  denial: DenialContext
  identity: AwsRead<Identity>
  tags: Map<string, Readonly<Record<string, string>>>
  sleep?: (ms: number) => Promise<void>
}

async function readBudgets(
  gw: AwsGateway,
  ctx: ReadContext,
): Promise<AwsRead<readonly BudgetReading[]>> {
  const estate = resolvedEstate(ctx.identity)
  if (!estate) {
    // The call is never made. UNCONFIGURED rather than EMPTY, because "we did
    // not ask" and "there are none" are the two answers this whole vocabulary
    // exists to keep apart — and rather than DENIED, because nothing was
    // refused and no IAM statement would fix it.
    return {
      state: "UNCONFIGURED",
      capability: "budgets:DescribeBudgets",
      // Spelled inside `why`: `describeRead` renders UNCONFIGURED as
      // "not configured — <why>" and drops the label, so a reason that does not
      // name its own subject reaches the page unattributed.
      why:
        `AWS budgets were not read — DescribeBudgets is scoped by account id and this engine ` +
        `could not resolve which account it is running as. ` +
        `${describeRead(ctx.identity, "caller identity")}`,
    }
  }

  return readAws<readonly BudgetReading[]>(
    "budgets:DescribeBudgets",
    async () => {
      const out: BudgetReading[] = []
      let token: string | undefined
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = (await gw.call("budgets:DescribeBudgets", {
          AccountId: estate.accountId,
          NextToken: token,
        })) as DescribeBudgetsResponse

        for (const budget of response?.Budgets ?? []) {
          if (!budget.BudgetName) continue
          out.push(project(budget, estate, ctx))
        }

        token = response?.NextToken || undefined
        if (!token) break
      }
      return out
    },
    {
      now: ctx.now,
      denial: ctx.denial,
      // The console has ONE retry schedule and it lives in throttle.ts. A number
      // typed here would drift from the one the tenants page uses, and "how long
      // until it tries again" would be two different answers on two pages.
      // `backoffMs(2)` is the pause after the first failure; `readAws` doubles it
      // from there, which reproduces throttle.ts's curve exactly.
      attempts: READ_ATTEMPTS,
      backoffMs: backoffMs(2),
      sleep: ctx.sleep,
    },
  )
}

/** Account and partition, only when both are actually known. */
function resolvedEstate(identity: AwsRead<Identity>): { accountId: string; partition: string } | null {
  if (identity.state !== "ACTUAL" && identity.state !== "STALE") return null
  const { accountId, partition } = identity.value
  if (!accountId || !partition) return null
  return { accountId, partition }
}

/* --------------------------------------------------------- the projection -- */

function project(
  budget: NonNullable<DescribeBudgetsResponse["Budgets"]>[number],
  estate: { accountId: string; partition: string },
  ctx: ReadContext,
): BudgetReading {
  const name = budget.BudgetName ?? ""
  // Partition-scoped, no region segment. Both halves come from the resolved
  // identity; a literal "aws" here would point a GovCloud estate's budget at a
  // resource id that exists in another partition, which is GE-010-007 again.
  const arn = `arn:${estate.partition}:budgets::${estate.accountId}:budget/${name}`
  const type = budget.BudgetType ?? "UNKNOWN"
  const retrievedAt = ctx.now().toISOString()

  const monetary = type === MONETARY_BUDGET_TYPE
  const source: FigureSource = {
    system: "aws-budgets",
    reference: `DescribeBudgets ${arn}`,
    retrievedAt,
  }

  const limitPair = budget.BudgetLimit
  const actualPair = budget.CalculatedSpend?.ActualSpend
  const forecastPair = budget.CalculatedSpend?.ForecastedSpend

  const limit = monetary ? toFigure(limitPair, "BUDGET", retrievedAt, source) : null
  const actual = monetary ? toFigure(actualPair, "ACTUAL", retrievedAt, source) : null
  const forecast = monetary ? toFigure(forecastPair, "FORECAST", retrievedAt, source) : null

  const posture = assess(limit, actual, forecast)
  const tags = ctx.tags.get(arn) ?? {}

  return {
    name,
    arn,
    type,
    timeUnit: budget.TimeUnit ?? "UNKNOWN",
    period: { start: isoOrNull(budget.TimePeriod?.Start), end: isoOrNull(budget.TimePeriod?.End) },
    lastUpdated: isoOrNull(budget.LastUpdatedTime),
    limit,
    actual,
    forecast,
    quantity: monetary
      ? null
      : {
          limit: toQuantity(limitPair),
          actual: toQuantity(actualPair),
          forecast: toQuantity(forecastPair),
        },
    posture: posture.state,
    postureDetail: posture.detail,
    variance: posture.variance,
    attribution: attributionOf(tags),
    watchesTenant: watchedTenant(budget.CostFilters),
    alerting: alertingIsUnreadable(name),
  }
}

/**
 * A `Figure` from the API's amount/unit pair, or null when either is missing.
 *
 * `fromDecimal` takes the STRING AWS sent. Parsing to a number first and passing
 * that would reintroduce the float this package exists to keep out, and would do
 * it silently — `Number("0.0000004")` looks fine right up to the point where a
 * few thousand of them are summed.
 */
function toFigure(
  pair: { Amount?: string; Unit?: string } | undefined,
  kind: "BUDGET" | "ACTUAL" | "FORECAST",
  asOf: string,
  source: FigureSource,
): Figure | null {
  const amount = pair?.Amount
  const currency = pair?.Unit
  if (typeof amount !== "string" || !amount.trim() || !currency) return null
  // A malformed amount is not a zero. `fromDecimal` throws on anything that is
  // not a decimal, and swallowing that into `money(0, …)` would render a budget
  // with a $0.00 limit — permanently, silently over budget.
  return figure(fromDecimal(amount, currency), kind, asOf, source, 1)
}

function toQuantity(pair: { Amount?: string; Unit?: string } | undefined): BudgetQuantity | null {
  if (typeof pair?.Amount !== "string" || !pair.Amount.trim() || !pair.Unit) return null
  return { amount: pair.Amount, unit: pair.Unit }
}

/**
 * Where a budget stands, assessed against the FORECAST rather than spend so far.
 *
 * Comparing a month-to-date actual against a whole-month limit reports "under
 * budget" on the first of every month. `AT_RISK` — over on trajectory, not yet
 * over in fact — is the only state at which anybody can still act, and it is the
 * reason this is not a subtraction.
 */
function assess(
  limit: Figure | null,
  actual: Figure | null,
  forecast: Figure | null,
): { state: BudgetPosture; detail: string; variance: Money | null } {
  if (!limit) {
    return {
      state: "NO_BUDGET",
      detail:
        "No spend limit is set on this budget, so there is nothing to be over or under. " +
        "That is not the same as being on track.",
      variance: null,
    }
  }

  if (actual && compare(actual.amount, limit.amount) > 0) {
    return {
      state: "OVER",
      detail: `Spend has already passed the limit (${plain(actual.amount)} of ${plain(limit.amount)}).`,
      variance: subtract(actual.amount, limit.amount),
    }
  }

  if (!forecast) {
    return {
      state: "NO_FORECAST",
      detail:
        "AWS has not computed a forecast for this budget, so whether it is on track is unknown. " +
        "It is not over today, which is a different statement.",
      variance: null,
    }
  }

  const variance = subtract(forecast.amount, limit.amount)

  if (compare(forecast.amount, limit.amount) > 0) {
    return {
      state: "AT_RISK",
      detail: `Inside the limit today, but AWS projects ${plain(forecast.amount)} against ${plain(limit.amount)}.`,
      variance,
    }
  }

  // 80% on trajectory is close enough to want watching and far enough from the
  // threshold to be worth telling apart from comfortable.
  const eightyPercent = money(Math.trunc(limit.amount.units * 0.8), limit.amount.currency)
  if (compare(forecast.amount, eightyPercent) > 0) {
    return { state: "ON_TRACK", detail: "Projected to land inside the limit.", variance }
  }

  return { state: "UNDER", detail: "Well inside the limit on AWS's own projection.", variance }
}

/** Minor units and the currency code. Never a symbol — the code is the fact. */
function plain(amount: Money): string {
  return `${toMinorUnits(amount, "down")} minor units ${amount.currency}`
}

/**
 * The tenant whose spend a budget filters to.
 *
 * AWS spells a tag filter `"TagKeyValue": ["user:tenure:tenant$acme"]` — the
 * `user:` prefix is the tagging namespace and `$` separates key from value.
 * Returns null rather than guessing when no filter names the tenant tag; a
 * budget with no tenant filter genuinely covers the whole account, and reporting
 * it as one tenant's would attribute the fleet's bill to whoever sorted first.
 */
export function watchedTenant(filters: Record<string, string[] | undefined> | undefined): string | null {
  for (const value of filters?.TagKeyValue ?? []) {
    const separator = value.indexOf("$")
    if (separator < 0) continue
    const key = value.slice(0, separator).replace(/^user:/, "")
    const tenant = value.slice(separator + 1)
    // `TENANT_TAG` is `tags.ts`'s re-export of the contract in `@tenure/provisioning`,
    // which is also what the Terraform that WRITES the tag is checked against.
    // Spelling the key again here would be a second source: a budget filtered on
    // the contract's key would stop being recognised the day the contract renamed
    // it, and `watchesTenant` would go quietly null on every tenant budget.
    if (key === TENANT_TAG && tenant) return tenant
  }
  return null
}

/**
 * The alerting read, which cannot be performed.
 *
 * Not a stub and not a default: an `AwsRead` in the state that means "the call
 * was never made, because what it needs is not set", carrying the two capability
 * names that would let it be made. `isUnknown()` returns true for UNCONFIGURED,
 * and `httpStatusFor()` answers 501 — so a route that forgets to narrow gets a
 * "not implemented" rather than a page claiming the thresholds are wired.
 */
export function alertingIsUnreadable(budgetName: string): AwsRead<readonly BudgetAlert[]> {
  return {
    state: "UNCONFIGURED",
    capability: "budgets:DescribeBudgets",
    why:
      `whether budget "${budgetName}" notifies anybody is UNKNOWN. Its thresholds and their ` +
      `subscribers were not read, because this engine holds no capability for ` +
      `budgets:DescribeNotificationsForBudget or budgets:DescribeSubscribersForNotification. ` +
      `Both are authorised by budgets:ViewBudget, which the task role already holds, so the ` +
      `remedy is two entries in capabilities.ts and two arms in client.ts — not an IAM change. ` +
      `Until then a threshold with no subscriber is indistinguishable from one with a subscriber, ` +
      `and neither may be reported as configured.`,
  }
}

function isoOrNull(value: Date | string | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/* --------------------------------------------------------- one renderer -- */

/**
 * The sentence a surface prints for the budget read as a whole.
 *
 * `describeRead` for the states, so a denial cannot be worded as an absence
 * here and correctly on the estate page. The ACTUAL arm adds the count and the
 * cadence, because a budget list is only meaningful with how old it may be.
 */
export function describeBudgets(readings: BudgetReadings): string {
  const read = readings.budgets
  if (read.state === "ACTUAL" || read.state === "STALE") {
    const unwired = read.value.filter((b) => b.alerting.state !== "ACTUAL").length
    return (
      `${read.value.length} budget(s) — as of ${read.asOf}, re-read every ${readings.refreshMs}ms. ` +
      `${unwired} of them cannot be shown to notify anybody.`
    )
  }
  return describeRead(read, "AWS budgets")
}

/** One budget's line, attribution included, for a list a person reads. */
export function describeBudget(budget: BudgetReading): string {
  const limit = budget.limit ? plain(budget.limit.amount) : "no monetary limit"
  const alerting =
    budget.alerting.state === "ACTUAL"
      ? `${budget.alerting.value.length} threshold(s)`
      : describeRead(budget.alerting, "alert thresholds")
  return (
    `${budget.name} (${budget.type}, ${budget.timeUnit}) — ${limit}; ${budget.posture}: ${budget.postureDetail} ` +
    `Owner: ${describeAttribution(budget.attribution)}. ` +
    `Watches: ${budget.watchesTenant ?? "the whole account"}. ` +
    `Alerting: ${alerting}`
  )
}

/** Budgets when the read produced some, and `[]` ONLY when it said EMPTY. */
export function budgetsOf(read: AwsRead<readonly BudgetReading[]>): readonly BudgetReading[] {
  if (read.state === "ACTUAL" || read.state === "STALE") return read.value
  return []
}

export { BUDGETS_TTL_MS }
