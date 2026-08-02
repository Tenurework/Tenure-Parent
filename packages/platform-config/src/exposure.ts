import type { Assignment } from "./experiments"
import type { FlagDecision } from "./flags"

/**
 * GE-022-005 — exposure telemetry.
 *
 * `decideFlag` already answers "why is this off for me?". What nothing answers
 * is "how many people is it on for, and did the second arm of that experiment
 * get any traffic at all?" — and without that, a rollout is a guess and an
 * experiment can report a clean null result because one arm was never served.
 *
 * ## Counts, not events
 *
 * A flag is decided on nearly every request. Emitting one record per decision
 * would put a write on the hot path of every page and produce a table nobody
 * queries. This counts instead: `(flag, reason)` and `(experiment, variant)`,
 * incremented in memory, read as a snapshot.
 *
 * ## What it deliberately does not hold
 *
 * No subject ids, no tenant ids. The question is "did this arm get traffic",
 * not "who was in it", and an exposure log keyed by person is a behavioural
 * record of every user built as a side effect of shipping a feature. It is also
 * the sort of thing that ends up in a public workflow log, which is a hazard
 * this repository has already had once.
 *
 * ## Honest limit: per process
 *
 * These counters live in the process. On several tasks behind a load balancer,
 * each holds its own share, and a restart loses them. That is stated rather
 * than papered over: the numbers answer "is this arm getting traffic" and
 * "is this flag reaching anyone", which is what a rollout needs. They are not
 * an analytics store and must not be read as exact totals.
 */

export interface ExposureCounts {
  /** `flag:reason` → count. */
  flags: Readonly<Record<string, number>>
  /** `experiment:variant` → count. `variant` is `control` when unassigned. */
  experiments: Readonly<Record<string, number>>
  /** When counting started, so a rate can be derived from a snapshot. */
  since: string
}

let flagCounts: Record<string, number> = Object.create(null)
let experimentCounts: Record<string, number> = Object.create(null)
let startedAt = new Date(0).toISOString()

/**
 * `Date` is read lazily rather than at module load.
 *
 * A timestamp captured at import is the moment the bundle was first required,
 * which in a serverless runtime can be long before the first request and is
 * not when counting began.
 */
function ensureStarted(): void {
  if (startedAt === new Date(0).toISOString()) startedAt = new Date().toISOString()
}

export function recordFlagExposure(decision: Pick<FlagDecision, "flag" | "reason">): void {
  ensureStarted()
  const key = `${decision.flag}:${decision.reason}`
  flagCounts[key] = (flagCounts[key] ?? 0) + 1
}

export function recordExperimentExposure(assignment: Pick<Assignment, "experiment" | "variant">): void {
  ensureStarted()
  const key = `${assignment.experiment}:${assignment.variant ?? "control"}`
  experimentCounts[key] = (experimentCounts[key] ?? 0) + 1
}

/** A snapshot. Copied, so a caller cannot mutate the counters it is reading. */
export function exposureSnapshot(): ExposureCounts {
  return {
    flags: { ...flagCounts },
    experiments: { ...experimentCounts },
    since: startedAt,
  }
}

/** For tests. Not exported from the package index — nothing in production resets counters. */
export function resetExposureCounts(): void {
  flagCounts = Object.create(null)
  experimentCounts = Object.create(null)
  startedAt = new Date(0).toISOString()
}
