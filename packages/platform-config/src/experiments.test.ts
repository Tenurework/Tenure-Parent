import { REGISTRY, decideFlag, layersFor } from "./index"
import { resolveConfig } from "@tenure/configuration"

import {
  ExperimentDefinitionError,
  assignVariant,
  defineExperiment,
  type Experiment,
} from "./experiments"
import { cohortBucket } from "./flags"

/**
 * GE-022-005 — experiments.
 *
 * The two things worth testing are not "does it pick a variant". They are that
 * an experiment cannot become a second way to turn a feature on, and that the
 * arms actually get traffic.
 */
const TWO_ARM = defineExperiment({
  name: "approvalsLayout",
  flag: "aiAssistant",
  variants: [
    { key: "control", weight: 50 },
    { key: "compact", weight: 50 },
  ],
})

describe("a malformed experiment is refused at definition, not at assignment", () => {
  it("refuses weights that do not sum to 100", () => {
    // 90 leaves a tenth of subjects unassigned, and missing traffic looks
    // exactly like control — a broken assignment reported as a null result.
    expect(() =>
      defineExperiment({
        name: "x",
        flag: "aiAssistant",
        variants: [
          { key: "a", weight: 50 },
          { key: "b", weight: 40 },
        ],
      }),
    ).toThrow(/sum to 90.*10% of subjects would be silently unassigned/)
  })

  it("refuses fewer than two variants", () => {
    expect(() =>
      defineExperiment({ name: "x", flag: "aiAssistant", variants: [{ key: "a", weight: 100 }] }),
    ).toThrow(ExperimentDefinitionError)
  })

  it("refuses duplicate variant keys", () => {
    expect(() =>
      defineExperiment({
        name: "x",
        flag: "aiAssistant",
        variants: [
          { key: "a", weight: 50 },
          { key: "a", weight: 50 },
        ],
      }),
    ).toThrow(/share a key/)
  })

  it("refuses a zero or fractional weight", () => {
    expect(() =>
      defineExperiment({
        name: "x",
        flag: "aiAssistant",
        variants: [
          { key: "a", weight: 0 },
          { key: "b", weight: 100 },
        ],
      }),
    ).toThrow(/positive integer/)
  })
})

describe("an experiment can never grant anything", () => {
  it("assigns nobody when the gating flag is off", () => {
    // The property the whole design rests on. If this ever returned a variant,
    // an experiment would be a second authorization system — which is exactly
    // what the restrict-only flag law exists to prevent.
    for (const subject of ["u1", "u2", "u3", "u4", "u5"]) {
      expect(assignVariant(TWO_ARM, { enabled: false }, subject)).toEqual({
        experiment: "approvalsLayout",
        variant: null,
        reason: "flagOff",
        bucket: 0,
      })
    }
  })

  it("assigns nobody when the flag is killed, through the real decision path", () => {
    // Not a hand-made `{ enabled: false }` — the actual kill switch, resolved
    // through the actual registry.
    const { config } = resolveConfig(
      REGISTRY,
      [
        ...layersFor("rochester"),
        { scope: "tenant", id: "rochester", values: { "platform.flags.killed": ["aiAssistant"] } },
      ],
      { collectProblems: true },
    )
    const decision = decideFlag(config!, "aiAssistant", "u1")
    expect(decision.reason).toBe("killed")
    expect(assignVariant(TWO_ARM, decision, "u1").variant).toBeNull()
  })

  it("assigns nobody without a stable subject id", () => {
    // Guessing would put the same person in different arms on consecutive
    // requests, which does not add noise — it makes the measurement meaningless.
    expect(assignVariant(TWO_ARM, { enabled: true }, "").reason).toBe("unidentifiedSubject")
    expect(assignVariant(TWO_ARM, { enabled: true }, "").variant).toBeNull()
  })
})

describe("assignment is stable, and independent of the rollout cohort", () => {
  it("gives the same subject the same variant every time", () => {
    const first = assignVariant(TWO_ARM, { enabled: true }, "user-42")
    for (let i = 0; i < 20; i++) {
      expect(assignVariant(TWO_ARM, { enabled: true }, "user-42").variant).toBe(first.variant)
    }
  })

  it("does not assign from the same hash the rollout cohort uses", () => {
    // The bug this prevents is subtle and produces a confident wrong answer.
    // If the variant bucket were `cohortBucket(flag, subject)` — the same call
    // the rollout uses — then at 50% rollout the admitted half is buckets 0–49,
    // and those are exactly the subjects that fall in the first variant. One arm
    // would get every subject and the other none, and the experiment would
    // report a clean null result.
    let sameAsRollout = 0
    for (let i = 0; i < 500; i++) {
      const subject = `user-${i}`
      const rolloutBucket = cohortBucket("aiAssistant", subject)
      const variantBucket = assignVariant(TWO_ARM, { enabled: true }, subject).bucket
      if (rolloutBucket === variantBucket) sameAsRollout++
    }
    // Independent hashes collide about 1% of the time over 100 buckets. Equal
    // hashes would collide 100% of the time.
    expect(sameAsRollout).toBeLessThan(40)
  })

  it("puts traffic in every arm, in roughly the declared proportion", () => {
    // An arm with no traffic is the failure that looks like a result.
    const counts: Record<string, number> = {}
    for (let i = 0; i < 2000; i++) {
      const v = assignVariant(TWO_ARM, { enabled: true }, `user-${i}`).variant!
      counts[v] = (counts[v] ?? 0) + 1
    }
    expect(Object.keys(counts).sort()).toEqual(["compact", "control"])
    // 50/50 within five points on 2000 subjects. Deterministic input, so this
    // is a fixed number rather than a flaky one.
    expect(Math.abs(counts.control - counts.compact) / 2000).toBeLessThan(0.05)
  })

  it("honours uneven weights", () => {
    const uneven: Experiment = defineExperiment({
      name: "uneven",
      flag: "aiAssistant",
      variants: [
        { key: "big", weight: 90 },
        { key: "small", weight: 10 },
      ],
    })
    const counts: Record<string, number> = { big: 0, small: 0 }
    for (let i = 0; i < 2000; i++) {
      counts[assignVariant(uneven, { enabled: true }, `user-${i}`).variant!]++
    }
    expect(counts.small).toBeGreaterThan(120)
    expect(counts.small).toBeLessThan(280)
    expect(counts.big + counts.small).toBe(2000)
  })
})
