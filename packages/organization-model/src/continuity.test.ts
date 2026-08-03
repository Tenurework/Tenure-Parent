import {
  attachmentSurvivesTurnover,
  delegationAllows,
  inTeam,
  mayRedelegate,
  redelegate,
  seatIsOpen,
  succeedsTo,
  teamConfers,
  type Delegation,
  type DelegationRefusal,
  type ResourceRelationship,
  type Seat,
  type SeatOwnedResource,
  type TeamMembership,
} from "./continuity"

/**
 * GE-050-001 — the four entities the continuity model was missing.
 *
 * Seat is the product's primary continuity primitive, and it only means
 * anything if it exists independently of whoever occupies it.
 */

const NOW = new Date("2026-08-03T12:00:00Z")
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()

const seat = (over: Partial<Seat> = {}): Seat => ({
  id: "seat-president",
  tenantId: "rochester",
  organizationUnitId: "unit-consulting-club",
  title: "President",
  dated: { effectiveFrom: days(-365), effectiveTo: null },
  retiredAt: null,
  ...over,
})

describe("a seat is a position, not an occupancy", () => {
  it("is open while its window is live and it is not retired", () => {
    expect(seatIsOpen(seat(), NOW)).toBe(true)
  })

  it("is closed once retired, whatever its window says", () => {
    // A retired position is not one somebody can be placed in, and its window
    // may well still be open — retirement is a decision, not a date passing.
    expect(seatIsOpen(seat({ retiredAt: days(-1) }), NOW)).toBe(false)
  })

  it("is closed before it begins and after it ends", () => {
    expect(seatIsOpen(seat({ dated: { effectiveFrom: days(7), effectiveTo: null } }), NOW)).toBe(false)
    expect(seatIsOpen(seat({ dated: { effectiveFrom: days(-30), effectiveTo: days(-1) } }), NOW)).toBe(false)
  })

  it("is closed when its window will not parse", () => {
    // A position nobody can date is not one to place somebody in.
    expect(seatIsOpen(seat({ dated: { effectiveFrom: "not-a-date", effectiveTo: null } }), NOW)).toBe(false)
    expect(seatIsOpen(seat({ dated: { effectiveFrom: days(-30), effectiveTo: "soon" } }), NOW)).toBe(false)
  })
})

describe("what a successor actually receives", () => {
  const resource = (over: Partial<SeatOwnedResource> = {}): SeatOwnedResource => ({
    resourceId: "res-1",
    seatId: "seat-president",
    inheritance: "SEAT_RECORD",
    classification: null,
    ...over,
  })

  it("passes the seat's own record on", () => {
    // Budgets, minutes, decisions — the continuity the product exists for.
    expect(succeedsTo(resource())).toEqual({ transfers: true })
  })

  it("does not pass the predecessor's personal material", () => {
    // Bible §341. A model that transferred "the seat's things" wholesale would
    // hand a successor the predecessor's mailbox.
    const outcome = succeedsTo(resource({ inheritance: "PERSONAL" }))
    expect(outcome.transfers).toBe(false)
    if (outcome.transfers) throw new Error("unreachable")
    expect(outcome.reason).toBe("PERSONAL")
  })

  it("holds controlled material for a transition workflow", () => {
    // Credentials are rotated or reassigned, not inherited by occupancy.
    const outcome = succeedsTo(resource({ inheritance: "CONTROLLED", classification: "credential" }))
    expect(outcome.transfers).toBe(false)
    if (outcome.transfers) throw new Error("unreachable")
    expect(outcome.reason).toBe("NEEDS_TRANSITION")
    expect(outcome.detail).toMatch(/rotated or reassigned/)
  })

  it("distinguishes the two refusals, which need different actions", () => {
    // "You cannot have this" and "you cannot have this yet" send somebody to
    // different places.
    const personal = succeedsTo(resource({ inheritance: "PERSONAL" }))
    const controlled = succeedsTo(resource({ inheritance: "CONTROLLED" }))
    if (personal.transfers || controlled.transfers) throw new Error("unreachable")

    expect(personal.reason).not.toBe(controlled.reason)
    expect(personal.detail).not.toBe(controlled.detail)
  })
})

/* ───────────────────────────────────────────────────────── delegation ── */

const delegation = (over: Partial<Delegation> = {}): Delegation => ({
  id: "del-1",
  tenantId: "rochester",
  fromSeatId: "seat-president",
  toPersonId: "person-vp",
  actions: ["budget.approve"],
  resourceIds: [],
  dated: { effectiveFrom: days(-1), effectiveTo: days(7) },
  revokedAt: null,
  redelegationDepth: 0,
  reason: "President on leave for two weeks; VP covers budget approvals.",
  ...over,
})

const SOURCE = { actions: ["budget.approve", "roster.read"], live: true }

const allows = (
  over: Partial<Delegation> = {},
  request: Partial<{ action: string; resourceId: string | null; at: Date }> = {},
  source = SOURCE,
) =>
  delegationAllows(
    delegation(over),
    { action: "budget.approve", resourceId: null, at: NOW, ...request },
    source,
  )

const refusedBecause = (verdict: ReturnType<typeof allows>, reason: DelegationRefusal) => {
  expect(verdict.ok).toBe(false)
  expect(verdict.reason).toBe(reason)
  expect(verdict.detail.length).toBeGreaterThan(20)
}

describe("a delegation is bounded on every axis", () => {
  it("allows the action it names, within its window, from a live source", () => {
    expect(allows().ok).toBe(true)
  })

  it("refuses an action it does not name", () => {
    // A delegation names what it permits; anything else is not implied.
    refusedBecause(allows({}, { action: "roster.read" }), "ACTION_NOT_DELEGATED")
  })

  it("refuses an action the delegator does not hold", () => {
    // Authority is derived, never invented. A delegator cannot lend what they
    // never had.
    refusedBecause(
      allows({ actions: ["contracts.sign"] }, { action: "contracts.sign" }, SOURCE),
      "EXCEEDS_SOURCE",
    )
  })

  it("re-checks the source every time, not once at creation", () => {
    // A delegator whose own access ended must not keep lending what they no
    // longer have. This is the difference between authority and a snapshot.
    refusedBecause(allows({}, {}, { actions: [], live: true }), "EXCEEDS_SOURCE")
  })

  it("refuses when the delegating seat is no longer live", () => {
    refusedBecause(allows({}, {}, { ...SOURCE, live: false }), "SOURCE_NOT_LIVE")
  })

  it("refuses before it begins and after it ends", () => {
    refusedBecause(allows({ dated: { effectiveFrom: days(3), effectiveTo: days(9) } }), "NOT_YET_EFFECTIVE")
    refusedBecause(allows({ dated: { effectiveFrom: days(-9), effectiveTo: days(-1) } }), "EXPIRED")
  })

  it("refuses a delegation with no end at all", () => {
    // Bible §649 asks for automatic expiry. A delegation with no end is not
    // bounded authority, it is a second permanent account nobody reviews.
    refusedBecause(allows({ dated: { effectiveFrom: days(-1), effectiveTo: null } }), "NO_EXPIRY")
  })

  it("refuses one that was revoked, before looking at the clock", () => {
    // Somebody acted, and that is the more useful fact than the window.
    refusedBecause(
      allows({ revokedAt: days(-1), dated: { effectiveFrom: days(-9), effectiveTo: days(-2) } }),
      "REVOKED",
    )
  })

  it("refuses one with no stated reason", () => {
    // A delegation nobody can review is one that outlives the situation that
    // justified it.
    refusedBecause(allows({ reason: "   " }), "NO_REASON")
  })

  it("refuses an unparseable window rather than ignoring it", () => {
    refusedBecause(allows({ dated: { effectiveFrom: "x", effectiveTo: days(7) } }), "NOT_YET_EFFECTIVE")
    refusedBecause(allows({ dated: { effectiveFrom: days(-1), effectiveTo: "y" } }), "EXPIRED")
  })
})

describe("a delegation limited to named resources", () => {
  const limited = { resourceIds: ["res-budget-2026"] }

  it("allows the named resource", () => {
    expect(allows(limited, { resourceId: "res-budget-2026" }).ok).toBe(true)
  })

  it("refuses another resource", () => {
    refusedBecause(allows(limited, { resourceId: "res-budget-2027" }), "RESOURCE_NOT_DELEGATED")
  })

  it("refuses a request naming no resource at all", () => {
    // A limited delegation exercised without saying what it is being exercised
    // on is a request that cannot be checked against its limit.
    refusedBecause(allows(limited, { resourceId: null }), "RESOURCE_NOT_DELEGATED")
  })

  it("allows any resource when the list is empty", () => {
    // An empty list means the delegator's whole scope, which the source check
    // above already bounds.
    expect(allows({ resourceIds: [] }, { resourceId: "anything" }).ok).toBe(true)
  })
})

describe("onward delegation is off by default", () => {
  it("refuses to re-delegate at depth zero", () => {
    expect(mayRedelegate(delegation())).toBe(false)
    expect(redelegate(delegation(), { id: "d2", toPersonId: "p3", actions: ["budget.approve"], reason: "cover" })).toBeNull()
  })

  it("allows one hop when a budget was granted, and spends it", () => {
    // Each hop looks reasonable, and the person at the end holds authority the
    // original delegator never met. So the budget is finite and visible.
    const next = redelegate(delegation({ redelegationDepth: 1 }), {
      id: "d2",
      toPersonId: "person-treasurer",
      actions: ["budget.approve"],
      reason: "VP unavailable Thursday; treasurer covers.",
    })

    expect(next).not.toBeNull()
    expect(next!.redelegationDepth).toBe(0)
    expect(mayRedelegate(next!)).toBe(false)
  })

  it("cannot widen the actions on the way down", () => {
    // A hop that could add an action is not a delegation of authority, it is a
    // new grant wearing one's name.
    const next = redelegate(delegation({ redelegationDepth: 1 }), {
      id: "d2",
      toPersonId: "p3",
      actions: ["budget.approve", "contracts.sign"],
      reason: "cover",
    })
    expect(next!.actions).toEqual(["budget.approve"])
  })

  it("refuses a hop that would carry nothing", () => {
    expect(
      redelegate(delegation({ redelegationDepth: 1 }), {
        id: "d2",
        toPersonId: "p3",
        actions: ["contracts.sign"],
        reason: "cover",
      }),
    ).toBeNull()
  })

  it("refuses to re-delegate a revoked delegation", () => {
    expect(mayRedelegate(delegation({ redelegationDepth: 2, revokedAt: days(-1) }))).toBe(false)
  })
})

/* ────────────────────────────────────────────────────── team / cohort ── */

describe("a team is not a security principal", () => {
  it("confers nothing", () => {
    // Bible entity table: a Team/Cohort is "not an automatic security principal
    // unless policy binds it". The pressure to make membership grant something
    // is constant and reasonable-sounding, and what it buys is authority that
    // changes when somebody edits a group, with nothing in the audit trail.
    expect(teamConfers()).toEqual([])
  })

  it("still answers who is in it, which is a different question", () => {
    // Membership decides who a thing is shown to and who is notified. It does
    // not decide what anybody may do.
    const memberships: TeamMembership[] = [
      { teamId: "team-exec", personId: "person-vp", dated: { effectiveFrom: days(-10), effectiveTo: null } },
    ]
    expect(inTeam(memberships, { personId: "person-vp", teamId: "team-exec", at: NOW })).toBe(true)
    expect(inTeam(memberships, { personId: "person-other", teamId: "team-exec", at: NOW })).toBe(false)
    expect(inTeam(memberships, { personId: "person-vp", teamId: "team-other", at: NOW })).toBe(false)
  })

  it("computes membership from the clock", () => {
    const memberships: TeamMembership[] = [
      { teamId: "t", personId: "p", dated: { effectiveFrom: days(-10), effectiveTo: days(-1) } },
      { teamId: "t2", personId: "p", dated: { effectiveFrom: days(5), effectiveTo: null } },
    ]
    expect(inTeam(memberships, { personId: "p", teamId: "t", at: NOW })).toBe(false)
    expect(inTeam(memberships, { personId: "p", teamId: "t2", at: NOW })).toBe(false)
  })

  it("treats an unparseable window as not a membership", () => {
    const memberships: TeamMembership[] = [
      { teamId: "t", personId: "p", dated: { effectiveFrom: "x", effectiveTo: null } },
    ]
    expect(inTeam(memberships, { personId: "p", teamId: "t", at: NOW })).toBe(false)
  })
})

/* ──────────────────────────────────────────── resource relationships ── */

describe("what an attachment does to continuity", () => {
  const relationship = (kind: ResourceRelationship["ownerKind"]): ResourceRelationship => ({
    resourceId: "res-1",
    ownerKind: kind,
    ownerId: "owner-1",
    typeId: "owns",
    dated: { effectiveFrom: days(-10), effectiveTo: null },
  })

  it("survives turnover when attached to a seat, unit or team", () => {
    for (const kind of ["SEAT", "ORGANIZATION_UNIT", "TEAM"] as const) {
      expect(attachmentSurvivesTurnover(relationship(kind))).toBe(true)
    }
  })

  it("does not survive turnover when attached to a person", () => {
    // Sometimes right — their own notes, their own drafts — and it is the
    // default people reach for because it needs no thought. Naming it at the
    // point of attachment is the only moment anybody reconsiders.
    expect(attachmentSurvivesTurnover(relationship("PERSON"))).toBe(false)
  })
})
