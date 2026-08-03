import {
  endAssignment,
  planHandover,
  releaseToSuccessor,
  type ClassifiedResource,
  type EndRefusal,
  type EndableAssignment,
  type ReleasePolicy,
  type SuccessionContext,
} from "./succession-release"

/**
 * GE-050-007 — ending an assignment, and what a successor actually gets.
 *
 * Bible §8.3: "Seat ownership never means a successor automatically receives
 * secrets." GE-050-001 left CONTROLLED material saying only "released by a
 * transition workflow"; this is what such a workflow may release.
 */

const NOW = new Date("2026-08-03T12:00:00Z")
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()

const assignment = (over: Partial<EndableAssignment> = {}): EndableAssignment => ({
  id: "asg-1",
  seatId: "seat-president",
  personId: "dana",
  stateId: "active",
  dated: { effectiveFrom: days(-100), effectiveTo: null },
  ...over,
})

const REASON = "Term ended at the July handover meeting."

const endRefused = (over: Partial<EndableAssignment>, reason: EndRefusal, at = NOW) => {
  const outcome = endAssignment(assignment(over), { at, reason: REASON })
  expect(outcome.ok).toBe(false)
  if (outcome.ok) throw new Error("expected a refusal")
  expect(outcome.reason).toBe(reason)
  expect(outcome.detail.length).toBeGreaterThan(20)
}

describe("ending an assignment sets a date and never removes a row", () => {
  it("returns the assignment with an end, not nothing", () => {
    // The record of who held a seat and when is what the platform exists to
    // keep. An implementation that deleted the row would remove authority
    // correctly and destroy the answer to "who approved this in March".
    const outcome = endAssignment(assignment(), { at: NOW, reason: REASON })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error("unreachable")

    expect(outcome.assignment.id).toBe("asg-1")
    expect(outcome.assignment.personId).toBe("dana")
    expect(outcome.assignment.dated.effectiveFrom).toBe(days(-100))
    expect(outcome.assignment.dated.effectiveTo).toBe(NOW.toISOString())
  })

  it("removes authority at the instant it ends, not at next sign-in", () => {
    const outcome = endAssignment(assignment(), { at: NOW, reason: REASON })
    if (!outcome.ok) throw new Error("unreachable")
    expect(outcome.authorityRemovedAt).toBe(NOW.toISOString())
  })

  it("refuses to end an assignment twice", () => {
    endRefused({ dated: { effectiveFrom: days(-100), effectiveTo: days(-1) } }, "ALREADY_ENDED")
  })

  it("allows shortening an assignment that ends in the future", () => {
    // Bringing an end date forward is an ordinary correction; refusing it would
    // mean the only way to end early is to leave a wrong date standing.
    const outcome = endAssignment(
      assignment({ dated: { effectiveFrom: days(-100), effectiveTo: days(30) } }),
      { at: NOW, reason: REASON },
    )
    expect(outcome.ok).toBe(true)
  })

  it("refuses to end an assignment that has not begun", () => {
    // Cancelling an appointment and ending one are different facts, and
    // recording the second as the first loses that somebody was appointed.
    endRefused({ dated: { effectiveFrom: days(10), effectiveTo: null } }, "ENDS_BEFORE_IT_STARTS")
  })

  it("refuses without a stated reason", () => {
    const outcome = endAssignment(assignment(), { at: NOW, reason: "done" })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe("NO_REASON")
  })
})

/* ──────────────────────────────────────────── release to a successor ── */

const POLICY: ReleasePolicy = {
  id: "club-handover",
  releases: ["OPERATIONAL", "RESTRICTED_COMMUNICATION"],
}

const context = (over: Partial<SuccessionContext> = {}): SuccessionContext => ({
  successorHoldsSeat: true,
  transitionCompleted: true,
  policy: POLICY,
  ...over,
})

const resource = (over: Partial<ClassifiedResource> = {}): ClassifiedResource => ({
  resourceId: "res-1",
  seatId: "seat-president",
  inheritance: "CONTROLLED",
  classification: "OPERATIONAL",
  ...over,
})

describe("the seat's own record passes on", () => {
  it("transfers a seat record", () => {
    // The continuity the product exists for.
    const decision = releaseToSuccessor(resource({ inheritance: "SEAT_RECORD" }), context())
    expect(decision.action).toBe("TRANSFER")
  })

  it("transfers it even with no transition completed", () => {
    // A seat record is not controlled material. Gating it behind a workflow
    // would make ordinary handover paperwork block the thing handover is for.
    const decision = releaseToSuccessor(
      resource({ inheritance: "SEAT_RECORD" }),
      context({ transitionCompleted: false }),
    )
    expect(decision.action).toBe("TRANSFER")
  })
})

describe("personal material never transfers", () => {
  it("withholds it", () => {
    const decision = releaseToSuccessor(resource({ inheritance: "PERSONAL" }), context())
    expect(decision.action).toBe("WITHHOLD")
    expect(decision.reason).toMatch(/not to the seat/)
  })

  it("withholds it however the policy is configured", () => {
    // It is not the seat's to release, so no seat policy reaches it.
    const decision = releaseToSuccessor(
      resource({ inheritance: "PERSONAL", classification: "OPERATIONAL" }),
      context({ policy: { id: "permissive", releases: ["OPERATIONAL", "HR_RECORD"] } }),
    )
    expect(decision.action).toBe("WITHHOLD")
  })
})

describe("a credential is rotated, never handed over", () => {
  it("returns ROTATE rather than TRANSFER or WITHHOLD", () => {
    // Bible §8.3. Passing the predecessor's password gives the successor the
    // predecessor's identity, so every later action is attributed to somebody
    // who has left — and if misused, to somebody who could not have done it.
    //
    // Not WITHHOLD either: the successor does need access. They need their own.
    const decision = releaseToSuccessor(resource({ classification: "CREDENTIAL" }), context())
    expect(decision.action).toBe("ROTATE")
    expect(decision.reason).toMatch(/rotated or reassigned/)
  })

  it("rotates even when the policy names credentials", () => {
    const decision = releaseToSuccessor(
      resource({ classification: "CREDENTIAL" }),
      context({ policy: { id: "reckless", releases: ["CREDENTIAL", "OPERATIONAL"] } }),
    )
    expect(decision.action).toBe("ROTATE")
  })

  it("rotates a credential attached as a seat record", () => {
    const decision = releaseToSuccessor(
      resource({ inheritance: "SEAT_RECORD", classification: "CREDENTIAL" }),
      context(),
    )
    expect(decision.action).toBe("ROTATE")
  })
})

describe("some material no transition can release", () => {
  it("withholds material under legal hold", () => {
    const decision = releaseToSuccessor(resource({ classification: "LEGAL_HOLD" }), context())
    expect(decision.action).toBe("WITHHOLD")
    expect(decision.reason).toMatch(/however the policy is configured/)
  })

  it("withholds material in an open investigation", () => {
    expect(releaseToSuccessor(resource({ classification: "INVESTIGATION" }), context()).action).toBe(
      "WITHHOLD",
    )
  })

  it("withholds it even when a policy names it", () => {
    // Checked before the policy lookup on purpose: a misconfigured policy must
    // not be able to reach these.
    for (const classification of ["LEGAL_HOLD", "INVESTIGATION"] as const) {
      const decision = releaseToSuccessor(
        resource({ classification }),
        context({ policy: { id: "reckless", releases: [classification] } }),
      )
      expect(decision.action).toBe("WITHHOLD")
    }
  })

  it("withholds it even when attached as a seat record", () => {
    const decision = releaseToSuccessor(
      resource({ inheritance: "SEAT_RECORD", classification: "LEGAL_HOLD" }),
      context(),
    )
    expect(decision.action).toBe("WITHHOLD")
  })
})

describe("controlled material needs occupancy, a transition, and a policy", () => {
  it("transfers when all three hold", () => {
    // Without this the refusals below could come from a rule that withholds
    // everything.
    expect(releaseToSuccessor(resource(), context()).action).toBe("TRANSFER")
  })

  it("withholds when the successor does not hold the seat", () => {
    const decision = releaseToSuccessor(resource(), context({ successorHoldsSeat: false }))
    expect(decision.action).toBe("WITHHOLD")
    expect(decision.reason).toMatch(/does not hold this seat/)
  })

  it("withholds when no transition has completed", () => {
    // Controlled material is released by that step, not by occupancy — which is
    // exactly what GE-050-001 left unstated.
    const decision = releaseToSuccessor(resource(), context({ transitionCompleted: false }))
    expect(decision.action).toBe("WITHHOLD")
    expect(decision.reason).toMatch(/transition workflow/)
  })

  it("withholds a classification the policy does not name", () => {
    const decision = releaseToSuccessor(resource({ classification: "HR_RECORD" }), context())
    expect(decision.action).toBe("WITHHOLD")
    expect(decision.reason).toMatch(/does not release/)
  })

  it("releases a classification the policy does name", () => {
    expect(
      releaseToSuccessor(resource({ classification: "RESTRICTED_COMMUNICATION" }), context()).action,
    ).toBe("TRANSFER")
  })

  it("withholds unclassified controlled material", () => {
    // Default deny. An unclassified controlled resource is one nobody has
    // decided about, and releasing it treats an omission as permission.
    const decision = releaseToSuccessor(resource({ classification: null }), context())
    expect(decision.action).toBe("WITHHOLD")
    expect(decision.reason).toMatch(/Classify it first/)
  })

  it("uses an allowlist, so a policy cannot release what it never considered", () => {
    // A denylist would release anything an author had not thought of, and the
    // material worth restricting is exactly the material nobody anticipated.
    const narrow = context({ policy: { id: "narrow", releases: [] } })
    for (const classification of ["OPERATIONAL", "HR_RECORD", "RESTRICTED_COMMUNICATION"] as const) {
      expect(releaseToSuccessor(resource({ classification }), narrow).action).toBe("WITHHOLD")
    }
  })
})

describe("the handover is planned before it happens", () => {
  const resources: ClassifiedResource[] = [
    resource({ resourceId: "budget", inheritance: "SEAT_RECORD", classification: "OPERATIONAL" }),
    resource({ resourceId: "vendor-login", classification: "CREDENTIAL" }),
    resource({ resourceId: "predecessor-notes", inheritance: "PERSONAL", classification: null }),
    resource({ resourceId: "grievance", classification: "HR_RECORD" }),
    resource({ resourceId: "sponsor-emails", classification: "RESTRICTED_COMMUNICATION" }),
    resource({ resourceId: "unfiled", classification: null }),
  ]

  it("says what moves, what is reissued, and what stays", () => {
    const plan = planHandover(resources, context())

    expect([...plan.transferred].sort()).toEqual(["budget", "sponsor-emails"])
    expect(plan.rotated).toEqual(["vendor-login"])
    expect(plan.withheld.map((w) => w.resourceId).sort()).toEqual([
      "grievance",
      "predecessor-notes",
      "unfiled",
    ])
  })

  it("gives every withheld item its reason", () => {
    // A handover reporting only what moved would leave the successor
    // discovering the gaps one confused request at a time, and the predecessor
    // unable to check that what should have stayed did.
    const plan = planHandover(resources, context())
    for (const withheld of plan.withheld) {
      expect(withheld.reason.length).toBeGreaterThan(20)
    }
    expect(new Set(plan.withheld.map((w) => w.reason)).size).toBe(3)
  })

  it("accounts for every resource exactly once", () => {
    const plan = planHandover(resources, context())
    const total = plan.transferred.length + plan.rotated.length + plan.withheld.length
    expect(total).toBe(resources.length)
  })

  it("moves nothing controlled before the transition completes", () => {
    const plan = planHandover(resources, context({ transitionCompleted: false }))
    expect(plan.transferred).toEqual(["budget"])
    expect(plan.rotated).toEqual(["vendor-login"])
  })
})
