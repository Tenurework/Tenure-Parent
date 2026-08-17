/**
 * PLN-030-001 — spreading, allocation and top-down/bottom-up reconciliation.
 *
 * > Support even/proportional/driver/seasonal/historical/manual spreading;
 * > direct/step-down/reciprocal/activity-based allocations where supported;
 * > target distribution and contributor proposal reconciliation.
 * >
 * > Every rule declares source, target, basis, exclusions, order, currency/unit,
 * > precision, zero/negative behavior, effective period, owner, approval and
 * > test. Allocation results drill to basis and original source.
 * >
 * > — `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md` §7
 *
 * Three properties make this module worth having rather than a `map` over a
 * percentage, and each is a defect this repository has already paid for once.
 *
 * ## 1. The parts add back to exactly the whole
 *
 * A target of $10,000.00 spread across three categories is 333,333.33 cents
 * three times, and rounding each share on its own loses a cent. The FinOps
 * Center hit this and `allocateByWeight` in `@tenure/finops` exists because of
 * it: integer largest-remainder, ties to the earlier index, Σ parts === the
 * whole by construction. This module CALLS it rather than carrying a second
 * implementation — a repository with two largest-remainder functions has two
 * answers to "who got the leftover cent", and the note on `packages/finops/src/split.ts`
 * records what that cost.
 *
 * ## 2. A basis nobody chose is refused, not invented
 *
 * When every weight is zero — no prior actuals, no driver measurement, an
 * excluded list that excluded everything — there is no defensible split. Three
 * things can be done: spread it evenly so every number looks attributed, hand it
 * all to the first bucket, or refuse. The first is a driver nobody chose wearing
 * a driver's clothes; the second is what `allocateByWeight` does when handed all
 * zeros, documented in its own comment, and it is only correct for a caller that
 * has already decided that is acceptable. This module refuses, with the reason,
 * because a planning number whose basis is a coincidence of implementation is
 * one no reviewer can defend.
 *
 * ## 3. Both sides of a reconciliation survive
 *
 * A top-down target of $8,000 meeting a bottom-up proposal of $9,450 has two
 * true numbers and a decision to make. Overwriting either is the failure §9 of
 * the Bible names — "Top-down target and bottom-up submission retain both values
 * and reconciliation decisions" — so `reconcile()` returns a record carrying
 * both, the variance, and a decision that is `null` until somebody makes one. A
 * reconciliation with no decision is an open question, and it must not be
 * possible to read it as an agreement.
 *
 * ## What this does NOT do, stated rather than implied
 *
 * - It does not persist. There is no `SpreadRule`, `AllocationRule` or
 *   `Reconciliation` table — those are among the 36 canonical objects
 *   `docs/architecture/pln-planning-inventory.md` §5 records as absent, and
 *   PLN-000-002 is where they arrive. A rule here is a value a caller
 *   constructs and passes; it is complete, validated and traceable, and it is
 *   not durable.
 * - It does not do reciprocal or activity-based allocation. §7 says "where
 *   supported", and these are not: reciprocal needs simultaneous equations over
 *   a service matrix, activity-based needs an activity/cost-driver model, and
 *   neither has anywhere to live yet. `allocateReciprocal` and
 *   `allocateActivityBased` therefore throw a refusal that names what they would
 *   need, because a function that silently degrades to step-down is worse than
 *   one that is absent: the number it returns is wrong and looks right.
 */

import { allocateByWeight, money, type RoundingMode } from "@tenure/finops"

/* ─────────────────────────────────────────────────────────── the rule ──── */

/** The six spreading bases §7 requires. */
export const SPREAD_BASES = [
  "even",
  "proportional",
  "driver",
  "seasonal",
  "historical",
  "manual",
] as const

export type SpreadBasis = (typeof SPREAD_BASES)[number]

/**
 * What a rule does when the target, or a member's basis, is zero or negative.
 *
 * Declared per rule rather than decided here, because both answers are right for
 * different rules. A budget reduction spread across categories is a legitimate
 * negative target; a headcount spread is not, and silently accepting one there
 * produces negative positions.
 */
export type ZeroNegativePolicy = "refuse-negative" | "allow-negative"

/**
 * Every field §7 requires a rule to declare. All of them are required, so an
 * incomplete rule cannot be constructed and then explained later.
 */
export interface SpreadRule {
  /** Stable identity, so a result can be traced back to the rule that made it. */
  id: string
  /** Where the target came from, in words a reviewer can check. */
  source: string
  /** What axis the target lands on. */
  target: string
  basis: SpreadBasis
  /** Member keys this rule must not touch. Recorded in the result, not dropped. */
  exclusions: readonly string[]
  /** Evaluation order when several rules run. Lower runs first. */
  order: number
  /** ISO 4217. A rule spans one currency; two currencies are two rules. */
  currency: string
  /** The unit the target is measured in. See `REPRESENTABLE_UNITS`. */
  unit: SpreadUnit
  /** How a share that does not land on a whole minor unit is rounded. */
  precision: RoundingMode
  zeroNegative: ZeroNegativePolicy
  /** `YYYY-MM-DD`, inclusive. */
  effectiveFrom: string
  /** `YYYY-MM-DD`, inclusive. */
  effectiveTo: string
  /** Who owns the rule. A rule with no owner is one nobody maintains. */
  owner: string
  /** The approval that authorised it, or `null` for a draft rule. */
  approval: string | null
  /** The test that proves it. §7 requires a rule to declare one. */
  test: string
}

/**
 * The units a spread can be expressed in TODAY.
 *
 * One, and it is not an oversight: `docs/architecture/pln-planning-limitations.md`
 * §1 derives that `BudgetLine` can represent exactly one of the nine unit kinds
 * §4.2 requires, because every measure column is an `Int` of cents. A rule
 * declaring `fte` would be a rule whose result has nowhere to go, so the type
 * refuses it rather than the storage layer discovering it later.
 */
export const REPRESENTABLE_UNITS = ["currency"] as const
export type SpreadUnit = (typeof REPRESENTABLE_UNITS)[number]

/** Raised when a rule or its inputs cannot produce a defensible answer. */
export class SpreadRuleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SpreadRuleError"
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Refuse an incomplete or incoherent rule.
 *
 * Every check here is a field §7 names. The blank-string checks are not
 * ceremony: `owner: ""` satisfies TypeScript and defeats the entire point of
 * requiring an owner, and a rule whose `test` is empty is a rule that declares
 * it is tested by nothing.
 */
export function assertRuleComplete(rule: SpreadRule): void {
  const blank = (["id", "source", "target", "currency", "owner", "test"] as const).filter(
    (field) => rule[field].trim() === "",
  )
  if (blank.length > 0) {
    throw new SpreadRuleError(
      `Spread rule is missing ${blank.join(", ")}. Section 7 of the Planning Bible requires a rule ` +
        `to declare source, target, basis, exclusions, order, currency/unit, precision, ` +
        `zero/negative behaviour, effective period, owner, approval and test. A blank field is a ` +
        `field that was not declared.`,
    )
  }
  if (!SPREAD_BASES.includes(rule.basis)) {
    throw new SpreadRuleError(`Unknown spreading basis "${rule.basis}".`)
  }
  if (!REPRESENTABLE_UNITS.includes(rule.unit)) {
    throw new SpreadRuleError(
      `Unit "${rule.unit}" cannot be spread: nothing in this schema can store it. ` +
        `BudgetLine has one measure kind — currency, as integer cents.`,
    )
  }
  if (!Number.isInteger(rule.order)) {
    throw new SpreadRuleError(`Rule order must be a whole number, got ${rule.order}.`)
  }
  if (!ISO_DATE.test(rule.effectiveFrom) || !ISO_DATE.test(rule.effectiveTo)) {
    throw new SpreadRuleError(
      `Effective period must be two YYYY-MM-DD dates, got "${rule.effectiveFrom}".."${rule.effectiveTo}".`,
    )
  }
  if (rule.effectiveFrom > rule.effectiveTo) {
    throw new SpreadRuleError(
      `Effective period ends before it starts: ${rule.effectiveFrom}..${rule.effectiveTo}.`,
    )
  }
  if (rule.currency !== rule.currency.toUpperCase() || rule.currency.length !== 3) {
    throw new SpreadRuleError(`Currency must be a three-letter ISO 4217 code, got "${rule.currency}".`)
  }
}

/* ────────────────────────────────────────────────────────── spreading ──── */

/**
 * A member of the axis a target is spread across, with every basis it could be
 * spread by.
 *
 * All the basis fields are optional and the one the rule names is required at
 * run time — checked, with the rule's basis in the message, rather than
 * defaulting to zero. A member missing its driver measurement must not silently
 * receive nothing.
 */
export interface SpreadMember {
  key: string
  /** `proportional` — the contributor's own bottom-up proposal, in minor units. */
  proposedMinorUnits?: number
  /** `driver` — the measured driver value. Any non-negative finite number. */
  driverWeight?: number
  /** `seasonal` — the period's share of a season profile. */
  seasonalWeight?: number
  /** `historical` — what this member actually spent last period, in minor units. */
  priorActualMinorUnits?: number
  /** `manual` — the figure a planner typed, in minor units. */
  manualMinorUnits?: number
}

/** One spread value, with everything needed to defend it. */
export interface SpreadCell {
  key: string
  minorUnits: number
  currency: string
  /** Which rule produced it. */
  ruleId: string
  /** The basis used, so a reader never has to infer it from the numbers. */
  basis: SpreadBasis
  /** This member's weight and the total, so the share can be recomputed by hand. */
  weight: number
  totalWeight: number
  /** Where the target came from — §7's "drill to basis and original source". */
  source: string
  /** True when the rule excluded this member. Recorded, never dropped. */
  excluded: boolean
}

export interface SpreadResult {
  ruleId: string
  basis: SpreadBasis
  currency: string
  /** The target that was spread. */
  targetMinorUnits: number
  cells: readonly SpreadCell[]
  /** Σ cells. Equal to the target by construction; returned so a caller can assert it. */
  spreadMinorUnits: number
  /** Member keys the rule excluded, in the order given. */
  excluded: readonly string[]
}

/** The weight a member contributes under each basis, and the field it comes from. */
type BasisField = keyof Omit<SpreadMember, "key">

const BASIS_FIELD: Record<SpreadBasis, BasisField | null> = {
  even: null,
  proportional: "proposedMinorUnits",
  driver: "driverWeight",
  seasonal: "seasonalWeight",
  historical: "priorActualMinorUnits",
  manual: "manualMinorUnits",
}

/**
 * Distribute a target across members by a declared rule.
 *
 * `manual` is not a weighting and is not treated as one: the planner's figures
 * ARE the answer, so they are used verbatim and refused when they do not add to
 * the target. Reweighting them to fit would silently overwrite what a human
 * typed, which is the one thing a manual spread must never do.
 */
export function spread(input: {
  rule: SpreadRule
  targetMinorUnits: number
  members: readonly SpreadMember[]
}): SpreadResult {
  const { rule, targetMinorUnits, members } = input
  assertRuleComplete(rule)

  if (members.length === 0) {
    throw new SpreadRuleError(
      `Rule "${rule.id}" has no members to spread across. Returning nothing would let a caller ` +
        `record a target that was distributed nowhere.`,
    )
  }
  if (!Number.isInteger(targetMinorUnits)) {
    throw new SpreadRuleError(
      `A target is a whole number of minor units, got ${targetMinorUnits}. Rounding it here would ` +
        `move money the caller did not decide to move.`,
    )
  }
  if (targetMinorUnits < 0 && rule.zeroNegative === "refuse-negative") {
    throw new SpreadRuleError(
      `Rule "${rule.id}" declares zeroNegative="refuse-negative" and the target is ` +
        `${targetMinorUnits}. Either the target is wrong or the rule is.`,
    )
  }

  const duplicated = members.map((m) => m.key).filter((key, index, all) => all.indexOf(key) !== index)
  if (duplicated.length > 0) {
    throw new SpreadRuleError(
      `Rule "${rule.id}" was given the member key(s) ${[...new Set(duplicated)].join(", ")} twice. ` +
        `One key is one cell; two would silently collapse into whichever the caller read last.`,
    )
  }

  const excludedSet = new Set(rule.exclusions)
  const unknownExclusions = rule.exclusions.filter((key) => !members.some((m) => m.key === key))
  if (unknownExclusions.length > 0) {
    throw new SpreadRuleError(
      `Rule "${rule.id}" excludes ${unknownExclusions.join(", ")}, which is not a member of this ` +
        `axis. An exclusion that matches nothing is a rule that does not do what it says.`,
    )
  }

  const included = members.filter((m) => !excludedSet.has(m.key))
  if (included.length === 0) {
    throw new SpreadRuleError(
      `Rule "${rule.id}" excluded every member, so there is nothing to spread onto.`,
    )
  }

  const field = BASIS_FIELD[rule.basis]
  const weights = included.map((member) => {
    if (field === null) return 1
    const value = member[field]
    if (value === undefined) {
      throw new SpreadRuleError(
        `Rule "${rule.id}" spreads on basis "${rule.basis}" and member "${member.key}" has no ` +
          `${String(field)}. A missing basis is not a zero one: treating it as zero gives the ` +
          `member nothing and reports a complete spread.`,
      )
    }
    if (!Number.isFinite(value)) {
      throw new SpreadRuleError(`Member "${member.key}" has a non-finite ${String(field)}.`)
    }
    if (value < 0 && rule.zeroNegative === "refuse-negative") {
      throw new SpreadRuleError(
        `Member "${member.key}" has a negative ${String(field)} (${value}) and rule "${rule.id}" ` +
          `declares zeroNegative="refuse-negative".`,
      )
    }
    return value
  })

  if (rule.basis === "manual") {
    const total = weights.reduce((running, value) => running + value, 0)
    if (!weights.every((value) => Number.isInteger(value))) {
      throw new SpreadRuleError(`A manual spread is whole minor units for every member of "${rule.id}".`)
    }
    if (total !== targetMinorUnits) {
      throw new SpreadRuleError(
        `A manual spread must add to the target: rule "${rule.id}" was given ${total} against a ` +
          `target of ${targetMinorUnits}. Reweighting the planner's figures to fit would overwrite ` +
          `what a human typed, and dropping the difference would lose it.`,
      )
    }
    return assemble(rule, targetMinorUnits, members, included, weights, weights, excludedSet)
  }

  const totalWeight = weights.reduce((running, value) => running + value, 0)
  if (totalWeight === 0) {
    throw new SpreadRuleError(
      `Rule "${rule.id}" measured zero on basis "${rule.basis}" for every member, so there is no ` +
        `defensible split. Spreading evenly here would be a basis nobody chose, and handing the ` +
        `whole target to the first member — which is what an unguarded largest-remainder split ` +
        `does — would be worse.`,
    )
  }

  const parts = allocateByWeight(money(targetMinorUnits, rule.currency), weights, rule.precision)
  return assemble(
    rule,
    targetMinorUnits,
    members,
    included,
    weights,
    parts.map((part) => part.units),
    excludedSet,
  )
}

function assemble(
  rule: SpreadRule,
  targetMinorUnits: number,
  members: readonly SpreadMember[],
  included: readonly SpreadMember[],
  weights: readonly number[],
  amounts: readonly number[],
  excludedSet: ReadonlySet<string>,
): SpreadResult {
  const totalWeight = weights.reduce((running, value) => running + value, 0)
  const byKey = new Map(included.map((member, index) => [member.key, index]))

  const cells: SpreadCell[] = members.map((member) => {
    const index = byKey.get(member.key)
    const excluded = index === undefined
    return {
      key: member.key,
      minorUnits: excluded ? 0 : amounts[index],
      currency: rule.currency,
      ruleId: rule.id,
      basis: rule.basis,
      weight: excluded ? 0 : weights[index],
      totalWeight,
      source: rule.source,
      excluded,
    }
  })

  return {
    ruleId: rule.id,
    basis: rule.basis,
    currency: rule.currency,
    targetMinorUnits,
    cells,
    spreadMinorUnits: cells.reduce((running, cell) => running + cell.minorUnits, 0),
    excluded: members.filter((m) => excludedSet.has(m.key)).map((m) => m.key),
  }
}

/* ───────────────────────────────────────────────────────── allocation ──── */

/** A cost pool to be pushed onto the members that consumed it. */
export interface CostPool {
  id: string
  minorUnits: number
  /** Consumer key → measured consumption. Absent consumers receive nothing. */
  consumption: Readonly<Record<string, number>>
}

/**
 * Direct allocation: every pool goes straight to its consumers.
 *
 * One pass, no ordering, no pool consuming another. It is the honest method
 * whenever the service departments do not serve each other, and it is the only
 * one whose result needs no defence beyond its driver.
 */
export function allocateDirect(input: {
  rule: SpreadRule
  pools: readonly CostPool[]
  consumers: readonly string[]
}): readonly SpreadResult[] {
  const { rule, pools, consumers } = input
  assertRuleComplete(rule)
  if (consumers.length === 0) throw new SpreadRuleError("Direct allocation needs at least one consumer.")

  return pools.map((pool) =>
    spread({
      rule: { ...rule, id: `${rule.id}:${pool.id}`, source: `${rule.source} → pool ${pool.id}`, basis: "driver" },
      targetMinorUnits: pool.minorUnits,
      members: consumers.map((key) => ({ key, driverWeight: pool.consumption[key] ?? 0 })),
    }),
  )
}

/**
 * Step-down allocation: pools are allocated in a declared order, and a pool may
 * charge the pools that come AFTER it but never one that came before.
 *
 * That asymmetry is the whole method. It is what makes step-down solvable in one
 * pass while reciprocal allocation needs simultaneous equations, and it is also
 * why the ORDER is a rule field rather than an implementation detail: two
 * different orders give two different answers from the same data, both
 * arithmetically correct, and only one of them is the policy somebody approved.
 *
 * A pool's own residual balance grows as earlier pools charge it, so the amount
 * it allocates is its opening balance plus everything pushed onto it — which is
 * why this cannot be expressed as a sequence of independent `spread` calls and
 * carries its own loop.
 */
export function allocateStepDown(input: {
  rule: SpreadRule
  /** Allocated in this exact order. */
  pools: readonly CostPool[]
  consumers: readonly string[]
}): {
  readonly steps: readonly SpreadResult[]
  readonly consumerTotals: Readonly<Record<string, number>>
  readonly allocatedMinorUnits: number
} {
  const { rule, pools, consumers } = input
  assertRuleComplete(rule)
  if (consumers.length === 0) throw new SpreadRuleError("Step-down allocation needs at least one consumer.")
  const poolIds = pools.map((p) => p.id)
  if (new Set(poolIds).size !== poolIds.length) {
    throw new SpreadRuleError("Step-down allocation was given the same pool twice; the order would be ambiguous.")
  }
  for (const consumer of consumers) {
    if (poolIds.includes(consumer)) {
      throw new SpreadRuleError(
        `"${consumer}" is both a pool and a final consumer. Step-down needs the two sets disjoint, ` +
          `or a pool would charge itself and the residual would never close.`,
      )
    }
  }

  const balance = new Map(pools.map((pool) => [pool.id, pool.minorUnits]))
  const consumerTotals: Record<string, number> = Object.fromEntries(consumers.map((key) => [key, 0]))
  const steps: SpreadResult[] = []
  let allocated = 0

  pools.forEach((pool, index) => {
    // Downstream = the pools not yet allocated. A charge back onto an already
    // closed pool is exactly what step-down does not do.
    const downstream = pools.slice(index + 1).map((p) => p.id)
    const receivers = [...consumers, ...downstream]
    const amount = balance.get(pool.id)!
    if (amount === 0) return

    const result = spread({
      rule: {
        ...rule,
        id: `${rule.id}:${pool.id}`,
        source: `${rule.source} → pool ${pool.id} (step ${index + 1} of ${pools.length})`,
        basis: "driver",
        order: rule.order + index,
      },
      targetMinorUnits: amount,
      members: receivers.map((key) => ({ key, driverWeight: pool.consumption[key] ?? 0 })),
    })
    steps.push(result)

    for (const cell of result.cells) {
      if (balance.has(cell.key)) balance.set(cell.key, balance.get(cell.key)! + cell.minorUnits)
      else {
        consumerTotals[cell.key] += cell.minorUnits
        allocated += cell.minorUnits
      }
    }
  })

  return { steps, consumerTotals, allocatedMinorUnits: allocated }
}

/** Methods §7 lists that this repository does not support, with what they need. */
export const UNSUPPORTED_ALLOCATION_METHODS = ["reciprocal", "activity-based"] as const

function refuseUnsupported(method: (typeof UNSUPPORTED_ALLOCATION_METHODS)[number], needs: string): never {
  throw new SpreadRuleError(
    `${method} allocation is not supported. §7 of the Planning Bible says "where supported", and ` +
      `this is not: it needs ${needs}. It is refused rather than degraded to step-down, because a ` +
      `step-down answer labelled ${method} is wrong and looks right.`,
  )
}

export function allocateReciprocal(): never {
  refuseUnsupported(
    "reciprocal",
    "simultaneous equations over a service-consumption matrix, and a matrix to solve — there is no " +
      "table of inter-service consumption in this schema",
  )
}

export function allocateActivityBased(): never {
  refuseUnsupported(
    "activity-based",
    "an activity model with cost drivers per activity, which is `Driver` and `Measure` — two of " +
      "the 36 canonical objects PLN-000-002 has not built yet",
  )
}

/* ───────────────────────────────────────────────────── reconciliation ──── */

/** What a reviewer decided about a gap between a target and a proposal. */
export interface ReconciliationDecision {
  outcome: "accept-top-down" | "accept-bottom-up" | "negotiated"
  /** The negotiated total, in minor units. Required for `negotiated`, refused otherwise. */
  negotiatedMinorUnits?: number
  by: string
  /** ISO instant. */
  at: string
  rationale: string
}

export interface ReconciliationLine {
  key: string
  topDownMinorUnits: number
  bottomUpMinorUnits: number
  /** bottom-up − top-down. Positive means the contributor asked for more. */
  varianceMinorUnits: number
}

export interface ReconciliationRecord {
  currency: string
  /** The target, exactly as set. Never overwritten by the proposal. */
  topDownTotalMinorUnits: number
  /** The proposal, exactly as submitted. Never overwritten by the target. */
  bottomUpTotalMinorUnits: number
  varianceMinorUnits: number
  lines: readonly ReconciliationLine[]
  /** `null` until somebody decides. An open question must not read as agreement. */
  decision: ReconciliationDecision | null
}

/**
 * Compare a top-down target with a bottom-up proposal, keeping both.
 *
 * Line keys are the union of both sides, so a category the target names and the
 * proposal does not — and the reverse — both appear with the missing side at
 * zero and the variance that implies. Dropping either would make the totals
 * disagree with the lines, and the totals are what a reviewer reads first.
 */
export function reconcile(input: {
  currency: string
  topDown: Readonly<Record<string, number>>
  bottomUp: Readonly<Record<string, number>>
  decision?: ReconciliationDecision | null
}): ReconciliationRecord {
  const { currency, topDown, bottomUp } = input
  const keys = [...new Set([...Object.keys(topDown), ...Object.keys(bottomUp)])].sort()

  const lines = keys.map((key) => {
    const top = topDown[key] ?? 0
    const bottom = bottomUp[key] ?? 0
    if (!Number.isInteger(top) || !Number.isInteger(bottom)) {
      throw new SpreadRuleError(`Reconciliation values are whole minor units; "${key}" is not.`)
    }
    return { key, topDownMinorUnits: top, bottomUpMinorUnits: bottom, varianceMinorUnits: bottom - top }
  })

  const topTotal = lines.reduce((running, line) => running + line.topDownMinorUnits, 0)
  const bottomTotal = lines.reduce((running, line) => running + line.bottomUpMinorUnits, 0)
  const decision = input.decision ?? null

  if (decision) {
    if (decision.outcome === "negotiated" && decision.negotiatedMinorUnits === undefined) {
      throw new SpreadRuleError(
        "A negotiated reconciliation must state the negotiated total. Without it the record says a " +
          "decision was made and cannot say what it was.",
      )
    }
    if (decision.outcome !== "negotiated" && decision.negotiatedMinorUnits !== undefined) {
      throw new SpreadRuleError(
        `A ${decision.outcome} reconciliation must not carry a negotiated total — the accepted ` +
          `figure is one of the two already recorded, and a third number invites the reader to ` +
          `believe a fourth.`,
      )
    }
    if (decision.rationale.trim() === "" || decision.by.trim() === "") {
      throw new SpreadRuleError("A reconciliation decision needs an owner and a rationale.")
    }
  }

  return {
    currency,
    topDownTotalMinorUnits: topTotal,
    bottomUpTotalMinorUnits: bottomTotal,
    varianceMinorUnits: bottomTotal - topTotal,
    lines,
    decision,
  }
}

/**
 * The settled figures a decision implies, spread back over the axis.
 *
 * `accept-top-down` and `accept-bottom-up` return the side that won, verbatim —
 * no arithmetic, because the numbers already exist and recomputing them could
 * only introduce a difference. `negotiated` spreads the agreed total across the
 * lines in proportion to the bottom-up proposal, which is the only basis in the
 * record that reflects what the contributors said they needed; the rule is
 * returned with the result so the basis is not implicit.
 */
export function applyDecision(
  record: ReconciliationRecord,
  rule: SpreadRule,
): { readonly settled: Readonly<Record<string, number>>; readonly spreadResult: SpreadResult | null } {
  if (!record.decision) {
    throw new SpreadRuleError(
      "This reconciliation has no decision, so there are no settled figures. An undecided " +
        "reconciliation must not resolve to either side by default.",
    )
  }
  const { decision } = record

  if (decision.outcome === "accept-top-down") {
    return {
      settled: Object.fromEntries(record.lines.map((l) => [l.key, l.topDownMinorUnits])),
      spreadResult: null,
    }
  }
  if (decision.outcome === "accept-bottom-up") {
    return {
      settled: Object.fromEntries(record.lines.map((l) => [l.key, l.bottomUpMinorUnits])),
      spreadResult: null,
    }
  }

  const spreadResult = spread({
    rule: { ...rule, basis: "proportional" },
    targetMinorUnits: decision.negotiatedMinorUnits!,
    members: record.lines.map((line) => ({ key: line.key, proposedMinorUnits: line.bottomUpMinorUnits })),
  })
  return {
    settled: Object.fromEntries(spreadResult.cells.map((cell) => [cell.key, cell.minorUnits])),
    spreadResult,
  }
}
