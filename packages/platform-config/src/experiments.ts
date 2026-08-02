import { cohortBucket, type FlagDecision } from "./flags"

/**
 * GE-022-005 — experiments, on top of the restrict-only flag law.
 *
 * ## An experiment never grants anything
 *
 * `flags.ts` establishes that a flag may only restrict, because a flag that can
 * turn a feature *on* is a second authorization system nobody audits. An
 * experiment has to inherit that, and the way it does is by having no opinion at
 * all about access: an experiment chooses **between presentations of something
 * the subject may already do**. It is gated by a flag, and when that flag is off
 * the assignment is `null` — control, meaning "whatever the product does
 * normally".
 *
 * So there is no path where being in an experiment lets someone do something
 * they could not otherwise do. That is a property, not a convention, and
 * `experiments.test.ts` asserts it by trying.
 *
 * ## Why the salt matters more than it looks
 *
 * Variant assignment is bucketed the same way rollout is, but with a **different
 * salt**. Without that, a flag at 10% rollout and an experiment on the same flag
 * assign from the same hash — so the people in the rollout cohort are, in bucket
 * order, exactly the people who get the first variant. Every subject in the
 * experiment would land in one arm, the other arms would get no traffic at all,
 * and the result would look like a clean null result rather than a broken
 * assignment. It is the kind of bug that produces a confident wrong decision.
 */

export interface Variant {
  key: string
  /**
   * Relative weight. Integers, and they must sum to 100 — an experiment whose
   * weights sum to 90 silently leaves 10% of subjects unassigned, and the
   * missing traffic looks like control.
   */
  weight: number
}

export interface Experiment {
  name: string
  /** The flag that gates it. No flag, no experiment. */
  flag: string
  variants: readonly Variant[]
}

export class ExperimentDefinitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ExperimentDefinitionError"
  }
}

/**
 * Checked at definition rather than at assignment.
 *
 * A malformed experiment discovered when the first subject hits it is a
 * malformed experiment that has already been shipped.
 */
export function defineExperiment(spec: Experiment): Experiment {
  if (spec.variants.length < 2) {
    throw new ExperimentDefinitionError(
      `${spec.name}: an experiment with fewer than two variants is a flag`,
    )
  }

  const keys = new Set(spec.variants.map((v) => v.key))
  if (keys.size !== spec.variants.length) {
    throw new ExperimentDefinitionError(`${spec.name}: two variants share a key`)
  }

  const total = spec.variants.reduce((sum, v) => sum + v.weight, 0)
  if (total !== 100) {
    throw new ExperimentDefinitionError(
      `${spec.name}: weights sum to ${total}, not 100 — ${100 - total}% of subjects would be silently unassigned`,
    )
  }

  if (spec.variants.some((v) => !Number.isInteger(v.weight) || v.weight <= 0)) {
    throw new ExperimentDefinitionError(
      `${spec.name}: every weight must be a positive integer`,
    )
  }

  return spec
}

export interface Assignment {
  experiment: string
  /** `null` means control — the flag is off, or the subject is unidentified. */
  variant: string | null
  reason: "assigned" | "flagOff" | "unidentifiedSubject"
  /** 0–99, stable for a (experiment, subject) pair. Independent of the rollout bucket. */
  bucket: number
}

/**
 * The salt that keeps variant assignment independent of rollout assignment.
 *
 * Prefixed rather than hashed twice: `cohortBucket` already salts by name, and
 * changing the name it sees is enough to decorrelate the two. Changing this
 * string reshuffles every subject in every experiment, so it is a constant
 * rather than a parameter — reshuffling mid-experiment invalidates the result.
 */
const VARIANT_SALT = "variant/"

export function assignVariant(
  experiment: Experiment,
  decision: Pick<FlagDecision, "enabled">,
  subjectId: string,
): Assignment {
  // Gated. This is the line that keeps an experiment from being a second way to
  // turn something on.
  if (!decision.enabled) {
    return { experiment: experiment.name, variant: null, reason: "flagOff", bucket: 0 }
  }

  // No stable id means no honest assignment, and guessing would put the same
  // person in different arms on consecutive requests — which does not just add
  // noise, it makes the measurement meaningless.
  if (!subjectId) {
    return {
      experiment: experiment.name,
      variant: null,
      reason: "unidentifiedSubject",
      bucket: 0,
    }
  }

  const bucket = cohortBucket(`${VARIANT_SALT}${experiment.name}`, subjectId)

  let ceiling = 0
  for (const variant of experiment.variants) {
    ceiling += variant.weight
    if (bucket < ceiling) {
      return { experiment: experiment.name, variant: variant.key, reason: "assigned", bucket }
    }
  }

  // Unreachable while `defineExperiment` holds the weights to 100. Kept as a
  // throw rather than a silent control, because reaching it means the invariant
  // was bypassed and quietly returning control would hide that from the results.
  throw new Error(
    `${experiment.name}: bucket ${bucket} fell past every variant — weights no longer sum to 100`,
  )
}
