import { accessState, type TenantMembership } from "./index"

/**
 * GE-042-006 — why somebody has no access, when they have none.
 *
 * Before GE-040-001 made memberships effective-dated, a revoked person had no
 * row at all, so "no membership" and "membership ended" were the same fact.
 * They are not the same fact to the person: a suspended director who sees the
 * onboarding path a new account sees — *welcome, let's get you started* — has
 * been told one specific lie, and they are the person least able to work out
 * that it is one.
 */

const NOW = new Date("2026-08-02T12:00:00Z")
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()

const membership = (over: Partial<TenantMembership> = {}): TenantMembership => ({
  id: "mem-1",
  personId: "person-1",
  tenantId: "rochester",
  origin: "INVITATION",
  status: "ACTIVE",
  interval: { effectiveFrom: days(-100), effectiveUntil: null },
  statusReason: null,
  ...over,
})

describe("each way of having no access says something different", () => {
  it("reports ACTIVE when any membership is live", () => {
    expect(accessState([membership()], NOW).state).toBe("ACTIVE")
  })

  it("reports NEVER_PLACED for an account with no memberships at all", () => {
    // The genuine onboarding case, and the only one that should see it.
    const report = accessState([], NOW)
    expect(report.state).toBe("NEVER_PLACED")
    expect(report.detail).toMatch(/not a member of any organization yet/)
  })

  it("reports SUSPENDED, and says it can be lifted", () => {
    const report = accessState([membership({ status: "SUSPENDED", statusReason: "under review" })], NOW)
    expect(report.state).toBe("SUSPENDED")
    expect(report.detail).toMatch(/can lift it/)
  })

  it("reports REVOKED, and says a new grant is needed", () => {
    const report = accessState(
      [membership({ status: "REVOKED", statusReason: "left", interval: { effectiveFrom: days(-100), effectiveUntil: days(-1) } })],
      NOW,
    )
    expect(report.state).toBe("REVOKED")
    expect(report.detail).toMatch(/grant it again/)
  })

  it("reports ENDED for a term that simply ran out", () => {
    // Different from revoked: nobody acted, the calendar did.
    const report = accessState([membership({ interval: { effectiveFrom: days(-100), effectiveUntil: days(-1) } })], NOW)
    expect(report.state).toBe("ENDED")
    expect(report.detail).toMatch(/should be renewed/)
  })

  it("reports NOT_YET_STARTED for access scheduled to begin later", () => {
    // Somebody who was told they start on Monday should be told they start on
    // Monday, not that they have no account.
    const report = accessState([membership({ interval: { effectiveFrom: days(3), effectiveUntil: null } })], NOW)
    expect(report.state).toBe("NOT_YET_STARTED")
  })

  it("gives every non-active state its own sentence", () => {
    const states = [
      accessState([], NOW),
      accessState([membership({ status: "SUSPENDED", statusReason: "x" })], NOW),
      accessState([membership({ status: "REVOKED", statusReason: "x" })], NOW),
      accessState([membership({ interval: { effectiveFrom: days(-9), effectiveUntil: days(-1) } })], NOW),
      accessState([membership({ interval: { effectiveFrom: days(9), effectiveUntil: null } })], NOW),
    ]
    for (const report of states) {
      expect(report.detail.length).toBeGreaterThan(20)
    }
    // Five distinct states, and five distinct sentences. Equal counts are what
    // stops a copied `detail` from passing: the states could differ while two
    // of them told the person exactly the same thing.
    expect(new Set(states.map((s) => s.state)).size).toBe(5)
    expect(new Set(states.map((s) => s.detail)).size).toBe(5)
  })
})

describe("waiting is not the same obstacle as being blocked", () => {
  it("is waiting on the clock only when access is scheduled to begin", () => {
    // The one state that resolves with nobody doing anything: the date arrives.
    // Every other blocked state needs a person to act, so telling somebody to
    // check back would leave them checking back forever.
    const scheduled = accessState([membership({ interval: { effectiveFrom: days(3), effectiveUntil: null } })], NOW)
    expect(scheduled.waitingOnTheClock).toBe(true)
  })

  it("is not waiting on the clock in any other state", () => {
    const needsSomebody = [
      accessState([], NOW),
      accessState([membership()], NOW),
      accessState([membership({ status: "SUSPENDED", statusReason: "x" })], NOW),
      accessState([membership({ status: "REVOKED", statusReason: "x" })], NOW),
      accessState([membership({ interval: { effectiveFrom: days(-9), effectiveUntil: days(-1) } })], NOW),
    ]
    for (const report of needsSomebody) {
      expect(report.waitingOnTheClock).toBe(false)
    }
  })
})

describe("data that makes no sense is not access", () => {
  it("does not report ACTIVE for a membership whose window will not parse", () => {
    // `membershipLiveness` calls this MALFORMED, which is none of the four
    // reasons the precedence list handles, so it reaches the fall-through. That
    // branch is the only one that could fail *open*: a row nobody can evaluate
    // reported as access somebody has. The state it returns matters less than
    // it never being ACTIVE.
    const report = accessState(
      [membership({ interval: { effectiveFrom: "not-a-date", effectiveUntil: null } })],
      NOW,
    )
    expect(report.state).not.toBe("ACTIVE")
    expect(report.detail.length).toBeGreaterThan(20)
  })

  it("still reports ACTIVE when a good membership sits beside a malformed one", () => {
    // The other direction: one unreadable row must not take away access that a
    // readable one grants, or a single bad import locks people out.
    const report = accessState(
      [
        membership({ id: "bad", tenantId: "one", interval: { effectiveFrom: "not-a-date", effectiveUntil: null } }),
        membership({ id: "good", tenantId: "two" }),
      ],
      NOW,
    )
    expect(report.state).toBe("ACTIVE")
  })
})

describe("one live membership is enough", () => {
  it("reports ACTIVE even when other memberships have ended", () => {
    // Somebody who left one institution and joined another has access, and
    // reporting the one they left would be wrong in the most confusing way.
    const report = accessState(
      [
        membership({ id: "gone", tenantId: "old", status: "REVOKED", statusReason: "left" }),
        membership({ id: "current", tenantId: "new" }),
      ],
      NOW,
    )
    expect(report.state).toBe("ACTIVE")
  })
})

describe("when several memberships disagree, the most actionable wins", () => {
  it("prefers a suspension over a revocation", () => {
    // Somebody can lift a suspension. A revocation needs a new grant, so
    // reporting it would send the person to ask for the harder thing.
    const report = accessState(
      [
        membership({ id: "a", tenantId: "one", status: "REVOKED", statusReason: "left" }),
        membership({ id: "b", tenantId: "two", status: "SUSPENDED", statusReason: "under review" }),
      ],
      NOW,
    )
    expect(report.state).toBe("SUSPENDED")
  })

  it("prefers a scheduled start over anything that has ended", () => {
    // "You start on Monday" is the most useful thing to say, and it is true.
    const report = accessState(
      [
        membership({ id: "a", tenantId: "one", status: "REVOKED", statusReason: "left" }),
        membership({ id: "b", tenantId: "two", interval: { effectiveFrom: days(3), effectiveUntil: null } }),
      ],
      NOW,
    )
    expect(report.state).toBe("NOT_YET_STARTED")
  })

  it("prefers a scheduled start over a suspension", () => {
    // Adjacent in the precedence list, so nothing else pins their order: a
    // person who starts somewhere on Monday and is suspended elsewhere has
    // something to look forward to, and that is the more useful sentence.
    const report = accessState(
      [
        membership({ id: "a", tenantId: "one", status: "SUSPENDED", statusReason: "under review" }),
        membership({ id: "b", tenantId: "two", interval: { effectiveFrom: days(3), effectiveUntil: null } }),
      ],
      NOW,
    )
    expect(report.state).toBe("NOT_YET_STARTED")
  })

  it("prefers a suspension over an ended term", () => {
    // Also adjacent. A suspension is lifted by one person changing their mind;
    // an ended term needs a renewal decision. The cheaper remedy is reported.
    const report = accessState(
      [
        membership({ id: "a", tenantId: "one", interval: { effectiveFrom: days(-9), effectiveUntil: days(-1) } }),
        membership({ id: "b", tenantId: "two", status: "SUSPENDED", statusReason: "under review" }),
      ],
      NOW,
    )
    expect(report.state).toBe("SUSPENDED")
  })

  it("prefers an ended term over a revocation", () => {
    const report = accessState(
      [
        membership({ id: "a", tenantId: "one", status: "REVOKED", statusReason: "left" }),
        membership({ id: "b", tenantId: "two", interval: { effectiveFrom: days(-9), effectiveUntil: days(-1) } }),
      ],
      NOW,
    )
    expect(report.state).toBe("ENDED")
  })
})
