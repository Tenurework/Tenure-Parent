import type { ModuleSlo } from "./manifest"

/**
 * WRK-120-003 — evaluating a declared objective against what actually happened.
 *
 * A manifest can now declare that a module promises something (`ModuleSlo`).
 * This is the arithmetic that makes the promise checkable, and it is separate
 * from the declaration on purpose: the declaration lives in a catalog that must
 * stay free of clocks and databases, and the measurements come from whichever
 * request path knows how to count the thing being promised.
 *
 * ## Why an error budget rather than a pass/fail
 *
 * "Is the objective met" is a boolean and it is the wrong question on its own.
 * An approvals queue at 94.9% against a 95% target and one at 40% both answer
 * "no", and only one of them is an outage. `burn` is the fraction of the error
 * budget consumed — 1.0 is exactly at target, 2.0 is twice the failure the
 * objective allows — so an operator can tell the difference between a target
 * that has slipped and a queue that has stopped.
 *
 * ## What a measurement is
 *
 * One thing that either met the objective or did not, named. The name is not
 * decoration: a burn number nobody can turn into a list of the specific
 * requests that breached is a number people learn to scroll past.
 */

export interface SloMeasurement {
  /** What was measured — an id, so a breach can be opened rather than admired. */
  subject: string
  /** Whether this one met the objective. */
  good: boolean
}

export interface SloBurn {
  objective: string
  target: number
  window: string
  /** How many measurements the window produced. */
  total: number
  good: number
  bad: number
  /** `good / total`. 1 when nothing was measured — see below. */
  attained: number
  /**
   * Fraction of the error budget consumed: `(1 - attained) / (1 - target)`.
   *
   * 0 is perfect, 1 is exactly at target, above 1 is over budget. Finite
   * always, because `validateManifest` refuses a target of 1 — a zero error
   * budget makes this a division by zero rather than a big number.
   */
  burn: number
  met: boolean
  /** The path whoever reads a breach opens. Carried so the caller need not. */
  runbook: string
  /** The subjects that did not meet it, in the order they were measured. */
  breaching: readonly string[]
}

export class SloObjectiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SloObjectiveError"
  }
}

/**
 * How much of `objective`'s error budget `measurements` consumed.
 *
 * An empty window attains 1 and is met. That is the honest answer and not a
 * convenient one: "no pending approval breached its SLA" is true of an
 * institution with no pending approvals, and reporting a breach there would
 * train whoever reads it to ignore the report. `total: 0` is on the result so a
 * caller that wants to distinguish "healthy" from "quiet" can.
 *
 * Throws on an objective outside `0 < target < 1`. `validateManifest` refuses
 * one at declaration, so reaching this means an objective was constructed
 * somewhere other than a manifest — and returning `Infinity`, or silently
 * clamping, would put a meaningless number on a dashboard beside real ones.
 */
export function sloBurn(
  measurements: readonly SloMeasurement[],
  objective: ModuleSlo,
): SloBurn {
  if (
    typeof objective?.target !== "number" ||
    !Number.isFinite(objective.target) ||
    !(objective.target > 0 && objective.target < 1)
  ) {
    throw new SloObjectiveError(
      `Objective ${JSON.stringify(objective?.objective ?? "(unnamed)")} has target ` +
        `${JSON.stringify(objective?.target)}, which is not a fraction strictly between 0 and 1. ` +
        `Burn against a zero error budget is undefined, not infinite.`,
    )
  }

  const total = measurements.length
  const breaching = measurements.filter((m) => !m.good).map((m) => m.subject)
  const bad = breaching.length
  const good = total - bad

  const attained = total === 0 ? 1 : good / total
  const burn = (1 - attained) / (1 - objective.target)

  return {
    objective: objective.objective,
    target: objective.target,
    window: objective.window,
    total,
    good,
    bad,
    attained,
    burn,
    met: attained >= objective.target,
    runbook: objective.runbook,
    breaching,
  }
}
