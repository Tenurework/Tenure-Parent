/**
 * The decisions `/platform/cost` makes, separated from the markup that renders
 * them.
 *
 * ── Why this module exists ─────────────────────────────────────────────────
 *
 * The page answers three questions — what is the fleet costing, who is it
 * costing it for, and is anything running away — and each answer has an arm
 * that must not be reachable by accident. All three of the following are true
 * statements that read as reassurance and are not:
 *
 *   * "No budget is over its limit", said when `budgets:DescribeBudgets` was
 *     refused and the list this engine has is empty because it was never filled.
 *   * "Every budget is projected to land inside its limit", said about budgets
 *     whose alert thresholds notify nobody — a breach that is evaluated, fires,
 *     and reaches no human reads exactly like a budget that is fine.
 *   * "Everything is attributed", said by folding resources tagged
 *     `tenure:shared` together with resources carrying no tenant tag at all.
 *     The first is a decision somebody made; the second is a gap, and it is the
 *     spend that will land on whoever sorts first.
 *
 * Each of those has a distinct arm below and a test that reds when the arm is
 * removed. The page renders what these functions return; it does not re-decide.
 *
 * ── What this module may import ────────────────────────────────────────────
 *
 * Nothing that reaches AWS, React, or a database. `@tenure/finops` (the money
 * and the approval policy) and `lib/aws/read` (the `AwsRead` union and its one
 * renderer) are the only runtime imports, and both are pure TypeScript with no
 * SDK in their graph — which is what lets `cost-decisions.test.ts` run in
 * apps/web's jest with no server, no browser and no credentials.
 *
 * Everything else is `import type`, erased at compile time. In particular
 * `lib/aws/tags` and `lib/aws/budgets` are type-only here: their runtime graph
 * reaches `@tenure/provisioning`, which that runner does not map.
 */

import {
  EXECUTIVE_THRESHOLD_MINOR,
  PEER_THRESHOLD_MINOR,
  // The key the ALLOCATOR resolves a billed line through. `lib/aws/tags`
  // re-exports the same string from `@tenure/provisioning`, which is what the
  // Terraform that WRITES the tag is checked against; this module takes it from
  // the package whose arithmetic it is describing, and neither is a literal.
  TENANT_TAG,
  TWO_PERSON_THRESHOLD_MINOR,
  approvalFor,
  money,
  toDecimal,
  toMinorUnits,
  type ApprovalLevel,
  type Money,
} from "@tenure/finops"

import { describeRead, type AwsRead } from "../../../lib/aws/read"
import type { BadgeTone, UnknownRead } from "../../../components/md3"
import type { BudgetReading } from "../../../lib/aws/budgets"
import type { Attribution, TaggedResource } from "../../../lib/aws/tags"

/* ---------------------------------------------------------------- money -- */

/**
 * An amount, at its OWN currency's precision.
 *
 * `toDecimal` reads the currency's exponent, and the rounding mode is stated
 * rather than defaulted: `half-even` for display, because it is the only mode
 * whose bias over a page of figures is zero and because a debit and the credit
 * that reverses it must render with the same magnitude.
 *
 * Lived in `CostReportView.tsx` before, which meant the only way to check the
 * formatting was to render a React tree.
 */
export function formatAmount(amount: Money): string {
  const rendered = toDecimal(amount, "half-even")
  return amount.currency === "USD" ? `$${rendered}` : `${rendered} ${amount.currency}`
}

/**
 * The same amount as the integers it actually is.
 *
 * Rendered as a `title` beside every figure on this page. `$120.00` is what a
 * person reads; `12000 minor units of USD` is what the platform stores, and an
 * operator disputing a figure needs to be able to see that there is no float in
 * it. `down` matches `CUR_ROUNDING` and `budgets.ts`, so the same `Money`
 * cannot render one unit apart on two surfaces.
 */
export function minorUnits(amount: Money): string {
  return `${toMinorUnits(amount, "down")} minor units of ${amount.currency}`
}

/**
 * Where a number came from, in one line.
 *
 * PAY-180-003. `as of` says when the DATA is current; this says which system
 * produced it and when this engine last read that system — "the bill says so"
 * and "we estimated it" are different claims that otherwise render identically.
 */
export function citation(source: { system: string; reference: string; retrievedAt: string }): string {
  return `source: ${source.system} · ${source.reference} · read ${source.retrievedAt}`
}

/* ------------------------------------------------------------ narrowing -- */

/**
 * The arm of a reading that carries no value, or null when the read produced
 * one.
 *
 * A `switch` rather than `isUnknown()`, because a boolean does not narrow: the
 * caller needs the arm ITSELF to hand to `UnknownState`, and `UnknownState`
 * accepts only the four valueless arms. Written once here so eleven call sites
 * on this page cannot each spell the list of four differently — and so that an
 * arm added to `AwsRead` stops compiling here rather than falling silently into
 * a `default` that renders it as "fine".
 */
export function unknownArm<T>(read: AwsRead<T>): UnknownRead | null {
  switch (read.state) {
    case "DENIED":
    case "THROTTLED":
    case "UNCONFIGURED":
    case "ERROR":
      return read
    case "ACTUAL":
    case "STALE":
    case "EMPTY":
      return null
  }
}

/* --------------------------------------------------- approval thresholds -- */

export interface ThresholdRow {
  band: string
  approval: string
  why: string
}

/** What each verdict is called, once. `approvalFor` decides which one applies. */
const APPROVAL_LABEL: Record<ApprovalLevel, string> = {
  NONE: "none",
  PEER: "one reviewer",
  TWO_PERSON: "two people",
  EXECUTIVE: "executive",
}

/**
 * Why each verdict is what it is, in the voice of a policy table.
 *
 * Written here rather than taken from `approvalFor`'s own `detail`, which is
 * deliberately phrased about a PARTICULAR change — "…adds a material recurring
 * cost. Two people must agree, and neither may be the requester." Rendering
 * that in a policy table repeats the verdict inside its own justification, and
 * it repeats it in the cell beside the cell that already says it:
 * `e2e/cost.spec.ts` resolves `getByRole("cell", { name: "two people" })` to
 * exactly one element, and a justification containing the words "Two people"
 * makes that two.
 */
const APPROVAL_WHY: Record<ApprovalLevel, string> = {
  NONE: "Recorded but not gated, so the pattern is visible even when each instance is not.",
  PEER: "Small but recurring. One reviewer, so that it is at least seen.",
  TWO_PERSON: "Material. Neither approver may be the requester.",
  EXECUTIVE: "A budget decision, not an engineering one.",
}

/**
 * The approval thresholds, DERIVED rather than transcribed.
 *
 * A hand-written table agrees with the policy on the day it is written: raising
 * `TWO_PERSON_THRESHOLD_MINOR` moves the number in the cell and leaves the
 * verdict beside it — "two people" — sitting on whatever row it had always been
 * on, with nothing to notice. Here the boundary amount is fed to `approvalFor`,
 * the same function `previewPlanCost` uses to gate a real plan, and the verdict
 * and its justification are its answer. The page cannot disagree with the
 * policy, because it is reading it.
 *
 * The BANDS are a chain: each begins exactly where the previous one ends. That
 * property is asserted both here and in `e2e/cost.spec.ts`, which parses the
 * rendered cells — the constants are policy and may legitimately change, while
 * a gap or an overlap between two bands is a range of spend with two answers or
 * none.
 */
export function thresholdRows(): readonly ThresholdRow[] {
  const usd = (units: number) => formatAmount(money(units, "USD"))
  const bands = [
    { at: 0, band: `under ${usd(PEER_THRESHOLD_MINOR)}` },
    {
      at: PEER_THRESHOLD_MINOR,
      band: `${usd(PEER_THRESHOLD_MINOR)} to under ${usd(TWO_PERSON_THRESHOLD_MINOR)}`,
    },
    {
      at: TWO_PERSON_THRESHOLD_MINOR,
      band: `${usd(TWO_PERSON_THRESHOLD_MINOR)} to under ${usd(EXECUTIVE_THRESHOLD_MINOR)}`,
    },
    { at: EXECUTIVE_THRESHOLD_MINOR, band: `${usd(EXECUTIVE_THRESHOLD_MINOR)} and above` },
  ]

  return bands.map(({ at, band }) => {
    const decision = approvalFor({
      change: "A commitment in this band",
      estimated: money(at, "USD"),
    })
    return {
      band,
      approval: APPROVAL_LABEL[decision.level],
      why: APPROVAL_WHY[decision.level],
    }
  })
}

/* ------------------------------------------------- who it is costing for -- */

export interface TenantShare {
  slug: string
  resources: number
}

/**
 * Who the estate is tagged for, and — separately, always — who it is not.
 *
 * `shared` and `unattributed` are two fields and will stay two fields. Folding
 * them, which is what any `tenant ?? "shared"` does, turns an untagged NAT
 * gateway into platform overhead somebody has decided to absorb. One of those
 * is a decision and the other is a gap; the gap is the spend that lands on
 * whoever sorts first once a bill arrives.
 */
export interface AttributionAnswer {
  /** False when the tag read did not produce a value. Then every count is null. */
  known: boolean
  tenants: readonly TenantShare[]
  attributed: number
  shared: number
  unattributed: number
  total: number
  /** The sentence the page leads the panel with. Never "everything is fine". */
  headline: string
  tone: BadgeTone
  badge: string
}

export function attributionAnswer(read: AwsRead<readonly TaggedResource[]>): AttributionAnswer {
  /*
   * A `switch` on the state, with the value-carrying arms falling through to the
   * body below, rather than a chain of `if`s. Two reasons, and the second is the
   * one that matters: the compiler narrows `read` to ACTUAL | STALE after it, so
   * `read.value` is reachable without a cast — and an arm added to `AwsRead`
   * fails to compile here rather than falling into a `default` that renders a
   * new failure mode as "nothing found".
   */
  const nothing = { tenants: [], attributed: 0, shared: 0, unattributed: 0, total: 0 } as const
  switch (read.state) {
    case "DENIED":
    case "THROTTLED":
    case "UNCONFIGURED":
    case "ERROR":
      return {
        ...nothing,
        known: false,
        headline:
          `Which tenant the fleet is running for is UNKNOWN — the resource tags could not be read. ` +
          `${describeRead(read, "the tag inventory")} This is not a report that nothing is tagged.`,
        tone: "warn",
        badge: "unknown",
      }
    case "EMPTY":
      return {
        ...nothing,
        known: true,
        headline:
          "The Resource Groups Tagging API returned no resources at all. Nothing in this account " +
          "carries a tag this engine can attribute, so no bill it ever reads can be charged to a tenant.",
        tone: "warn",
        badge: "nothing tagged",
      }
    case "ACTUAL":
    case "STALE":
      break
  }

  const resources = read.value
  const counts = new Map<string, number>()
  let shared = 0
  let unattributed = 0

  for (const resource of resources) {
    switch (resource.attribution.kind) {
      case "tenant":
        counts.set(
          resource.attribution.tenantSlug,
          (counts.get(resource.attribution.tenantSlug) ?? 0) + 1,
        )
        break
      case "shared":
        shared += 1
        break
      case "unattributed":
        unattributed += 1
        break
    }
  }

  const tenants = [...counts.entries()]
    .map(([slug, count]) => ({ slug, resources: count }))
    // Biggest first, then alphabetically — a stable order, and no `Math.random`
    // or insertion order deciding which tenant an operator reads first.
    .sort((a, b) => b.resources - a.resources || a.slug.localeCompare(b.slug))

  const attributed = resources.length - shared - unattributed

  return {
    known: true,
    tenants,
    attributed,
    shared,
    unattributed,
    total: resources.length,
    headline:
      `${tenants.length} tenant(s) own ${attributed} of ${resources.length} tagged resources. ` +
      `${shared} are tagged shared — platform overhead somebody decided nobody owns — and ` +
      `${unattributed} carry no ${TENANT_TAG} tag at all. The last group is not shared: it is ` +
      `spend that would reach no tenant, and it is reported rather than spread.`,
    tone: unattributed > 0 ? "warn" : "ok",
    badge: unattributed > 0 ? `${unattributed} unattributable` : "fully attributed",
  }
}

/* ------------------------------------------------- is anything running away -- */

/**
 * Whether a budget can be shown to reach a human when it is breached.
 *
 * Three distinct answers, and only one of them is good news:
 *
 *   * `NOTIFIES` — thresholds were read, there is at least one, and every one
 *     of them has at least one subscriber.
 *   * `SILENT` — thresholds were read, and either there are none or one of them
 *     has an empty subscriber list. AWS evaluates the notification, it fires,
 *     and no human is told. On every console that has ever shipped this reads
 *     as the same green row as a budget that is fine.
 *   * `UNKNOWN` — the thresholds were not read at all. Today this is every
 *     budget: `budgets.ts` returns `alerting` in the UNCONFIGURED state,
 *     because the two capabilities that would populate it
 *     (`DescribeNotificationsForBudget`, `DescribeSubscribersForNotification`)
 *     are not in the capability registry. UNKNOWN is not SILENT and neither is
 *     NOTIFIES.
 */
export type Notifies = "NOTIFIES" | "SILENT" | "UNKNOWN"

export interface NotifyVerdict {
  verdict: Notifies
  /** The cell's word. Never "ok", never a tick, never blank. */
  word: string
  /** The whole reason, for the cell's title and for anything reading the page out. */
  detail: string
  tone: BadgeTone
}

export function notifyVerdict(budget: BudgetReading): NotifyVerdict {
  const alerting = budget.alerting
  const noThresholds: NotifyVerdict = {
    verdict: "SILENT",
    word: "nobody",
    detail:
      `"${budget.name}" carries no alert threshold at all. It can be breached without anything ` +
      `being sent to anyone.`,
    tone: "bad",
  }

  switch (alerting.state) {
    case "DENIED":
    case "THROTTLED":
    case "UNCONFIGURED":
    case "ERROR":
      return {
        verdict: "UNKNOWN",
        word: "unknown",
        detail: describeRead(alerting, `alert thresholds on "${budget.name}"`),
        tone: "warn",
      }
    case "EMPTY":
      return noThresholds
    case "ACTUAL":
    case "STALE":
      break
  }

  const thresholds = alerting.value
  if (thresholds.length === 0) return noThresholds

  const silent = thresholds.filter((threshold) => threshold.subscribers.length === 0)
  if (silent.length > 0) {
    return {
      verdict: "SILENT",
      word: `${silent.length} of ${thresholds.length} notify nobody`,
      detail:
        `${silent.length} of ${thresholds.length} thresholds on "${budget.name}" have an empty ` +
        `subscriber list. AWS evaluates them, they fire, and no human is told.`,
      tone: "bad",
    }
  }

  const subscribers = thresholds.reduce((running, t) => running + t.subscribers.length, 0)
  return {
    verdict: "NOTIFIES",
    word: `${thresholds.length} threshold(s), ${subscribers} subscriber(s)`,
    detail: `Every threshold on "${budget.name}" has at least one subscriber.`,
    tone: "ok",
  }
}

export interface RunawayCounts {
  total: number
  /** Already past the limit, in fact rather than in projection. */
  over: number
  /** Inside the limit today, projected past it. The only state anyone can still act on. */
  atRisk: number
  /** AWS computed no forecast, so "on track" has no answer at all. */
  noForecast: number
  /** No spend limit is set, so there is nothing to be over or under. */
  noLimit: number
  /** Projected to land inside the limit. */
  within: number
}

export interface RunawayAnswer {
  /** False when the budget read produced no value. Then `counts` is null. */
  known: boolean
  counts: RunawayCounts | null
  /**
   * How many budgets could NOT be shown to reach a human. Includes both the
   * ones proven silent and the ones whose thresholds were never read: a page
   * that counted only the proven ones would report zero today, which is the
   * most reassuring possible rendering of "we did not look".
   */
  unreachable: number | null
  headline: string
  /**
   * The sentence that must survive good news. Present whenever at least one
   * budget cannot be shown to notify anybody, INCLUDING when every budget is
   * comfortably within its limit — that combination is exactly the one that
   * renders as a clean page on every console that has ever shipped.
   */
  caveat: string | null
  tone: BadgeTone
  badge: string
}

export function runawayAnswer(read: AwsRead<readonly BudgetReading[]>): RunawayAnswer {
  // See `attributionAnswer` for why this is a switch: it narrows `read` to the
  // value-carrying arms, and it stops compiling if `AwsRead` gains an arm.
  switch (read.state) {
    case "DENIED":
    case "THROTTLED":
    case "UNCONFIGURED":
    case "ERROR":
      return {
        known: false,
        counts: null,
        unreachable: null,
        headline:
          `Whether anything is running away is UNKNOWN — this engine could not read the account's ` +
          `budgets. ${describeRead(read, "the account's budgets")} An unread budget list is not ` +
          `an account with no budgets, and neither is an account with nothing running away.`,
        caveat: null,
        tone: "warn",
        badge: "unknown",
      }
    case "EMPTY":
      return {
        known: true,
        counts: { total: 0, over: 0, atRisk: 0, noForecast: 0, noLimit: 0, within: 0 },
        unreachable: 0,
        headline:
          "AWS returned no budgets for this account. Nothing is watching what it spends, so nothing " +
          "would raise its hand if spend tripled tomorrow. That is not the same as spend being under control.",
        caveat: null,
        tone: "warn",
        badge: "no budgets",
      }
    case "ACTUAL":
    case "STALE":
      break
  }

  const budgets = read.value
  const counts: RunawayCounts = {
    total: budgets.length,
    over: budgets.filter((b) => b.posture === "OVER").length,
    atRisk: budgets.filter((b) => b.posture === "AT_RISK").length,
    noForecast: budgets.filter((b) => b.posture === "NO_FORECAST").length,
    noLimit: budgets.filter((b) => b.posture === "NO_BUDGET").length,
    within: budgets.filter((b) => b.posture === "UNDER" || b.posture === "ON_TRACK").length,
  }

  const unreachable = budgets.filter((b) => notifyVerdict(b).verdict !== "NOTIFIES").length
  const caveat =
    unreachable > 0
      ? `${unreachable} of ${budgets.length} budget(s) cannot be shown to notify anybody. A budget ` +
        `whose thresholds have no subscriber — or whose subscribers were never read — breaches in ` +
        `silence, and a silent breach renders exactly like a budget that is fine.`
      : null

  if (counts.over > 0) {
    return {
      known: true,
      counts,
      unreachable,
      headline: `${counts.over} budget(s) are already past their limit.`,
      caveat,
      tone: "bad",
      badge: "over limit",
    }
  }

  if (counts.atRisk > 0) {
    return {
      known: true,
      counts,
      unreachable,
      headline:
        `${counts.atRisk} budget(s) are inside their limit today and projected past it. This is the ` +
        `only state at which anyone can still act.`,
      caveat,
      tone: "warn",
      badge: "projected over",
    }
  }

  /*
   * A budget with no forecast, or with no limit at all, is NOT within its
   * limit — it is a budget with no answer. Counting either as good news is the
   * defect this arm exists to prevent: `assess()` in `budgets.ts` returns
   * NO_FORECAST precisely because "it is not over today" is a different
   * statement from "it is on track", and a page that merges them says the
   * second while knowing only the first.
   */
  if (counts.noForecast > 0 || counts.noLimit > 0) {
    return {
      known: true,
      counts,
      unreachable,
      headline:
        `No budget is over its limit, but ${counts.noForecast} have no AWS forecast and ` +
        `${counts.noLimit} have no spend limit set — for those, whether anything is running away has ` +
        `no answer rather than a good one.`,
      caveat,
      tone: "warn",
      badge: "partly unknown",
    }
  }

  return {
    known: true,
    counts,
    unreachable,
    headline: `All ${counts.total} budget(s) are projected to land inside their limit on AWS's own forecast.`,
    caveat,
    tone: caveat ? "warn" : "ok",
    badge: caveat ? "within limits, unwatched" : "within limits",
  }
}

/* ------------------------------------------------------ the budget table -- */

/**
 * One budget's row, with every money cell already a string.
 *
 * A missing figure renders as the reason it is missing, never as `0`, never as
 * an empty cell. `toFigure` in `budgets.ts` returns null when AWS sent no
 * amount — for a USAGE budget it never sends one, because the figure is in GB —
 * and a blank money column beside a budget name is read as zero spend.
 */
export interface BudgetRow {
  key: string
  name: string
  arn: string
  /** The tenant this budget's own cost filters watch, or the whole account. */
  watches: string
  limit: FigureCell
  actual: FigureCell
  forecast: FigureCell
  posture: string
  postureDetail: string
  notifies: NotifyVerdict
  tone: BadgeTone
  /**
   * Who owns the budget RESOURCE, from its own tags.
   *
   * Carried as the union rather than as a string so the page renders it through
   * `describeAttribution` — the console's one renderer — instead of this module
   * inventing a second wording in which an unattributable budget reads as "—".
   */
  owner: Attribution
}

/** The word for each posture. AWS's own vocabulary is not shown to a person raw. */
const POSTURE_WORD: Readonly<Record<BudgetReading["posture"], string>> = {
  OVER: "over",
  AT_RISK: "projected over",
  ON_TRACK: "on track",
  UNDER: "under",
  NO_BUDGET: "no limit set",
  NO_FORECAST: "no forecast",
}

const POSTURE_TONE: Readonly<Record<BudgetReading["posture"], BadgeTone>> = {
  OVER: "bad",
  AT_RISK: "warn",
  ON_TRACK: "ok",
  UNDER: "ok",
  // Neither of the last two is good news, and neither is bad news. They are the
  // absence of an answer, which is the third thing this console keeps separate.
  NO_BUDGET: "warn",
  NO_FORECAST: "warn",
}

export function budgetRows(budgets: readonly BudgetReading[]): readonly BudgetRow[] {
  return budgets.map((budget) => ({
    key: budget.arn,
    name: budget.name,
    arn: budget.arn,
    watches: budget.watchesTenant ?? "the whole account",
    limit: figureCell("limit", budget, budget.limit?.amount ?? null, budget.quantity?.limit ?? null),
    actual: figureCell("actual", budget, budget.actual?.amount ?? null, budget.quantity?.actual ?? null),
    forecast: figureCell(
      "forecast",
      budget,
      budget.forecast?.amount ?? null,
      budget.quantity?.forecast ?? null,
    ),
    posture: POSTURE_WORD[budget.posture],
    postureDetail: budget.postureDetail,
    notifies: notifyVerdict(budget),
    tone: POSTURE_TONE[budget.posture],
    owner: budget.attribution,
  }))
}

/** A figure and the whole truth about it, for the cell's `title`. */
export interface FigureCell {
  text: string
  title: string
  /** False when AWS returned nothing here. The cell says so; it never says 0. */
  present: boolean
}

/**
 * One money cell, or the non-money quantity that stands in its place.
 *
 * A USAGE budget's `Unit` is `GB`; an `RI_UTILIZATION` budget's is
 * `PERCENTAGE`. `budgets.ts` deliberately leaves `limit`/`actual`/`forecast`
 * null for those and carries the figure in `quantity` with its real unit,
 * because a `Money` denominated in "GB" sums with dollars without complaint.
 * This renders that unit rather than dropping the figure.
 */
function figureCell(
  field: "limit" | "actual" | "forecast",
  budget: BudgetReading,
  amount: Money | null,
  quantity: { amount: string; unit: string } | null,
): FigureCell {
  if (amount) return { text: formatAmount(amount), title: minorUnits(amount), present: true }
  if (quantity) {
    return {
      text: `${quantity.amount} ${quantity.unit}`,
      title: `A ${budget.type} budget. This figure is not money — its unit is ${quantity.unit}.`,
      present: true,
    }
  }
  return {
    text: "not set",
    title: `AWS returned no ${field} for this budget. "Not set" is not zero.`,
    present: false,
  }
}
