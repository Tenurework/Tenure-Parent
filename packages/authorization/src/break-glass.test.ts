import {
  MAX_MINUTES,
  REVIEW_DEADLINE_HOURS,
  ROUTINE_THRESHOLD,
  ROUTINE_WINDOW_DAYS,
  alarmFor,
  openBreakGlass,
  routineUse,
  unreviewedOverdue,
  validateReview,
  validateUse,
  type BreakGlassUse,
} from "./break-glass"

/**
 * GE-033-004 — break-glass.
 *
 * The fourth clause of the requirement is "no routine use", and it is the one
 * that decays first: every break-glass use has a good reason at the time, and a
 * mechanism used weekly is ordinary access with an alarming name. Most of these
 * tests are about the two things that make that pattern impossible to hold and
 * not notice.
 */

const NOW = new Date("2026-08-02T12:00:00Z")
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()
const minutesFromNow = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString()

const use = (over: Partial<BreakGlassUse> = {}): BreakGlassUse => ({
  id: "bg-1",
  tenantId: "acme",
  operator: "operator@tenure.example",
  incidentRef: "INC-2211",
  justification: "Approvals queue wedged; nobody at the tenant reachable at 03:00 to approve access.",
  openedAt: NOW.toISOString(),
  expiresAt: minutesFromNow(30),
  closedAt: null,
  review: null,
  ...over,
})

/** A past use, closed, with or without a review. */
const past = (over: Partial<BreakGlassUse> = {}): BreakGlassUse =>
  use({ id: "bg-old", openedAt: daysAgo(5), expiresAt: daysAgo(5), closedAt: daysAgo(5), ...over })

describe("what makes a use invalid", () => {
  it("accepts a well-formed use", () => {
    expect(validateUse(use())).toEqual([])
  })

  it("refuses one with no incident", () => {
    // Break-glass exists for an incident. Without one this is support access
    // taken the wrong way.
    expect(validateUse(use({ incidentRef: " " })).map((p) => p.field)).toContain("incidentRef")
  })

  it("refuses a thin justification", () => {
    // It skips the approval another party would have given, so this is the only
    // account of why.
    expect(validateUse(use({ justification: "prod issue" })).map((p) => p.field)).toContain("justification")
  })

  it("refuses one longer than an hour", () => {
    // An incident's timescale, not a working day's. A longer incident is a
    // support session requested properly.
    const tooLong = validateUse(use({ expiresAt: minutesFromNow(MAX_MINUTES + 1) }))
    expect(tooLong.map((p) => p.detail).join(" ")).toMatch(/exceeds the 60-minute maximum/)
  })

  it("refuses one with no expiry", () => {
    expect(validateUse(use({ expiresAt: "never" })).map((p) => p.field)).toContain("expiresAt")
  })

  it("is much shorter than a support session", () => {
    // Break-glass drops the control that needs another party, so every control
    // that does not gets tighter — not the same.
    expect(MAX_MINUTES).toBeLessThan(8 * 60)
  })
})

describe("the alarm cannot be skipped", () => {
  it("comes back with the grant, not from a separate call", () => {
    // An alarm raised by a second call is one somebody can forget, and the
    // forgetting looks exactly like a quiet incident.
    const outcome = openBreakGlass(use(), [], NOW)
    expect(outcome.opened).toBe(true)
    if (!outcome.opened) return
    expect(outcome.alarm.useId).toBe("bg-1")
    expect(outcome.alarm.severity).toBe("critical")
  })

  it("is always critical — there is no quiet break-glass", () => {
    expect(alarmFor(use()).severity).toBe("critical")
  })

  it("says no tenant approval was obtained", () => {
    // The fact that distinguishes it from a support session should be the one
    // the alarm leads with.
    expect(alarmFor(use()).message).toMatch(/No tenant approval was obtained/)
  })

  it("names the tenant, the operator and the incident", () => {
    const alarm = alarmFor(use())
    expect(alarm.message).toContain("acme")
    expect(alarm.message).toContain("operator@tenure.example")
    expect(alarm.message).toContain("INC-2211")
  })
})

describe("an unreviewed use blocks the next one", () => {
  it("refuses when a prior use is past the review deadline", () => {
    // This is what makes the review load-bearing rather than a courtesy.
    const overdue = past({ closedAt: hoursAgo(REVIEW_DEADLINE_HOURS + 1) })
    const outcome = openBreakGlass(use(), [overdue], NOW)
    expect(outcome.opened).toBe(false)
    if (outcome.opened) return
    expect(outcome.reason).toBe("UNREVIEWED_PRIOR_USE")
  })

  it("allows when the prior use was reviewed", () => {
    const reviewed = past({
      closedAt: hoursAgo(REVIEW_DEADLINE_HOURS + 1),
      review: { reviewedBy: "lead@tenure.example", reviewedAt: hoursAgo(1), finding: "Justified; queue bug fixed.", justified: true },
    })
    expect(openBreakGlass(use(), [reviewed], NOW).opened).toBe(true)
  })

  it("does not count a use that is still open", () => {
    // An open use has not finished. Demanding its review would mean break-glass
    // blocked itself the moment it was used.
    const open = past({ closedAt: null })
    expect(unreviewedOverdue([open], "operator@tenure.example", NOW)).toEqual([])
  })

  it("does not count one still inside the deadline", () => {
    const recent = past({ closedAt: hoursAgo(1) })
    expect(unreviewedOverdue([recent], "operator@tenure.example", NOW)).toEqual([])
  })

  it("only counts uses by the same operator", () => {
    // One operator's unreviewed use must not block a different operator during
    // an incident.
    const other = past({ operator: "someone-else@tenure.example", closedAt: hoursAgo(200) })
    expect(openBreakGlass(use(), [other], NOW).opened).toBe(true)
  })
})

describe("no routine use", () => {
  const reviewed = (id: string, openedAt: string) =>
    past({
      id,
      openedAt,
      closedAt: openedAt,
      review: { reviewedBy: "lead@tenure.example", reviewedAt: openedAt, finding: "Justified at the time.", justified: true },
    })

  it("refuses once the rate crosses the threshold", () => {
    const history = Array.from({ length: ROUTINE_THRESHOLD }, (_, i) => reviewed(`bg-${i}`, daysAgo(i + 1)))
    const outcome = openBreakGlass(use(), history, NOW)
    expect(outcome.opened).toBe(false)
    if (outcome.opened) return
    expect(outcome.reason).toBe("ROUTINE_USE")
    expect(outcome.detail).toMatch(/not exceptional access/)
  })

  it("counts justified uses too", () => {
    // "Each one was fine" is how a pattern is explained rather than noticed.
    const history = Array.from({ length: ROUTINE_THRESHOLD }, (_, i) => reviewed(`bg-${i}`, daysAgo(i + 1)))
    expect(routineUse(history, "operator@tenure.example", NOW)).toEqual({
      routine: true,
      count: ROUTINE_THRESHOLD,
    })
  })

  it("forgets uses outside the window", () => {
    const old = Array.from({ length: ROUTINE_THRESHOLD }, (_, i) =>
      reviewed(`bg-${i}`, daysAgo(ROUTINE_WINDOW_DAYS + i + 1)),
    )
    expect(routineUse(old, "operator@tenure.example", NOW).routine).toBe(false)
    expect(openBreakGlass(use(), old, NOW).opened).toBe(true)
  })

  it("counts per operator, not per fleet", () => {
    const others = Array.from({ length: ROUTINE_THRESHOLD + 2 }, (_, i) =>
      reviewed(`bg-${i}`, daysAgo(i + 1)),
    ).map((u) => ({ ...u, operator: `op${u.id}@tenure.example` }))
    expect(routineUse(others, "operator@tenure.example", NOW).count).toBe(0)
  })

  it("says what to do instead", () => {
    // A refusal during an incident has to point somewhere, or it is an
    // obstruction rather than a control.
    const history = Array.from({ length: ROUTINE_THRESHOLD }, (_, i) => reviewed(`bg-${i}`, daysAgo(i + 1)))
    const outcome = openBreakGlass(use(), history, NOW)
    if (outcome.opened) throw new Error("expected a refusal")
    expect(outcome.detail).toMatch(/Request a support session, or escalate/)
  })
})

describe("the post-use review", () => {
  const closed = past({ closedAt: hoursAgo(2) })

  it("accepts a real review", () => {
    expect(
      validateReview(closed, {
        reviewedBy: "lead@tenure.example",
        reviewedAt: hoursAgo(1),
        finding: "Justified; the approval path had genuinely failed.",
        justified: true,
      }),
    ).toEqual([])
  })

  it("refuses a self-review", () => {
    // A review of one's own emergency is a note to file.
    const problems = validateReview(closed, {
      reviewedBy: closed.operator,
      reviewedAt: hoursAgo(1),
      finding: "It was fine, I was there.",
      justified: true,
    })
    expect(problems.map((p) => p.field)).toContain("reviewedBy")
  })

  it("refuses a review with no finding", () => {
    expect(
      validateReview(closed, {
        reviewedBy: "lead@tenure.example",
        reviewedAt: hoursAgo(1),
        finding: "ok",
        justified: true,
      }).map((p) => p.field),
    ).toContain("finding")
  })

  it("refuses reviewing a use that is still open", () => {
    const problems = validateReview(past({ closedAt: null }), {
      reviewedBy: "lead@tenure.example",
      reviewedAt: hoursAgo(1),
      finding: "Looks reasonable so far.",
      justified: true,
    })
    expect(problems.map((p) => p.field)).toContain("use")
  })

  it("records an unjustified finding as a valid review", () => {
    // The review's job is to conclude, not to absolve. A use found unjustified
    // is still reviewed, and still unblocks the operator — the consequence for
    // it belongs to a person, not to this function.
    expect(
      validateReview(closed, {
        reviewedBy: "lead@tenure.example",
        reviewedAt: hoursAgo(1),
        finding: "Not justified; a support session would have been available.",
        justified: false,
      }),
    ).toEqual([])
  })
})

describe("refusals are reported before the alarm exists", () => {
  it("produces no use and no alarm when refused", () => {
    // A refused open must not leave an alarm behind, or the signal that means
    // "someone has fleet access right now" starts firing when nobody does.
    const outcome = openBreakGlass(use({ incidentRef: "" }), [], NOW)
    expect(outcome.opened).toBe(false)
    expect("alarm" in outcome).toBe(false)
  })
})
