import {
  exposureSnapshot,
  recordExperimentExposure,
  recordFlagExposure,
  resetExposureCounts,
} from "./exposure"

/**
 * GE-022-005 — exposure telemetry.
 *
 * What is worth asserting is not that a counter increments. It is that the
 * counters answer the question a rollout actually asks — "did that arm get any
 * traffic" — and that they do not quietly become a behavioural record of every
 * user.
 */
beforeEach(() => resetExposureCounts())

describe("what the counters hold", () => {
  it("separates a flag's reasons, because 'off' has several meanings", () => {
    // "It is off for 900 people" is not actionable. "It is off for 900 people
    // because they are outside the cohort, and for 4 because it was killed" is.
    recordFlagExposure({ flag: "aiAssistant", reason: "enabled" })
    recordFlagExposure({ flag: "aiAssistant", reason: "enabled" })
    recordFlagExposure({ flag: "aiAssistant", reason: "outsideCohort" })
    recordFlagExposure({ flag: "aiAssistant", reason: "killed" })

    expect(exposureSnapshot().flags).toEqual({
      "aiAssistant:enabled": 2,
      "aiAssistant:outsideCohort": 1,
      "aiAssistant:killed": 1,
    })
  })

  it("counts an unassigned subject as control rather than dropping it", () => {
    // A dropped subject makes the arms sum to less than the traffic, and the
    // difference is invisible — which is how an arm that served nobody looks
    // like an arm that performed neutrally.
    recordExperimentExposure({ experiment: "approvalsLayout", variant: "compact" })
    recordExperimentExposure({ experiment: "approvalsLayout", variant: null })

    expect(exposureSnapshot().experiments).toEqual({
      "approvalsLayout:compact": 1,
      "approvalsLayout:control": 1,
    })
  })

  it("holds no subject or tenant identity", () => {
    // The question is "did this arm get traffic", not "who was in it". An
    // exposure log keyed by person is a behavioural record of every user built
    // as a side effect of shipping a feature — and the sort of thing that ends
    // up in a public workflow log.
    recordFlagExposure({ flag: "aiAssistant", reason: "enabled" })
    const snapshot = exposureSnapshot()
    const serialized = JSON.stringify(snapshot)
    // The keys are (flag, reason) and (experiment, variant). Nothing else fits.
    for (const key of Object.keys(snapshot.flags)) {
      expect(key.split(":")).toHaveLength(2)
    }
    expect(serialized).not.toMatch(/user|@|inst_|cuid/i)
  })
})

describe("a snapshot is a copy", () => {
  it("cannot be mutated into the live counters", () => {
    // A reader that can write is a reader that can zero the numbers an operator
    // is about to make a rollout decision on.
    recordFlagExposure({ flag: "aiAssistant", reason: "enabled" })
    const snapshot = exposureSnapshot()
    ;(snapshot.flags as Record<string, number>)["aiAssistant:enabled"] = 9999
    expect(exposureSnapshot().flags["aiAssistant:enabled"]).toBe(1)
  })

  it("carries when counting started, so a rate can be derived", () => {
    // A bare count is unreadable without a window: 40 exposures is a lot in a
    // minute and nothing in a week.
    recordFlagExposure({ flag: "aiAssistant", reason: "enabled" })
    const since = new Date(exposureSnapshot().since)
    expect(since.getTime()).toBeGreaterThan(0)
    expect(since.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it("does not stamp the start time until something is counted", () => {
    // Captured at import, this would be the moment the bundle was first
    // required — which in a serverless runtime can be long before the first
    // request, making every rate wrong in the same direction.
    expect(new Date(exposureSnapshot().since).getTime()).toBe(0)
    recordFlagExposure({ flag: "aiAssistant", reason: "enabled" })
    expect(new Date(exposureSnapshot().since).getTime()).toBeGreaterThan(0)
  })
})
