import {
  invitationLiveness,
  liveMemberships,
  membershipLiveness,
  personLiveness,
  recoveryLiveness,
  reviseMembership,
  sessionLiveness,
  usableRecoveryCount,
  type AuthSession,
  type Invitation,
  type Person,
  type RecoveryMethod,
  type TenantMembership,
} from "./index"

/**
 * GE-040-001 — the canonical identity model.
 *
 * Two properties carry the item, and most of these tests are about one or the
 * other. Liveness is computed from the clock, so nothing depends on a sweeper
 * having run; and no status change is expressible without its audit record, so
 * an unattributed one cannot be written by accident.
 */

const NOW = new Date("2026-08-02T12:00:00Z")
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000).toISOString()
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()

const membership = (over: Partial<TenantMembership> = {}): TenantMembership => ({
  id: "mem-1",
  personId: "person-1",
  tenantId: "rochester",
  origin: "INVITATION",
  status: "ACTIVE",
  interval: { effectiveFrom: days(-30), effectiveUntil: null },
  statusReason: null,
  ...over,
})

describe("liveness comes from the clock, not from a flag", () => {
  it("an active membership inside its window is live", () => {
    expect(membershipLiveness(membership(), NOW)).toEqual({ live: true })
  })

  it("expires on its own, with no job involved", () => {
    // A membership that ends because a sweeper runs is one that stays live when
    // the sweeper does not, and that window is access nobody granted.
    const ended = membership({ interval: { effectiveFrom: days(-30), effectiveUntil: hours(-1) } })
    const state = membershipLiveness(ended, NOW)
    expect(state.live).toBe(false)
    if (state.live) return
    expect(state.reason).toBe("EXPIRED")
  })

  it("is not live before it starts", () => {
    const future = membership({ interval: { effectiveFrom: days(1), effectiveUntil: null } })
    const state = membershipLiveness(future, NOW)
    expect(state.live).toBe(false)
    if (state.live) return
    expect(state.reason).toBe("NOT_YET_EFFECTIVE")
  })

  it("treats the end of the window as exclusive, so intervals compose", () => {
    // An interval ending exactly where the next begins must leave no gap and no
    // overlap — which is what an effective-dated handover needs.
    const handover = membership({ interval: { effectiveFrom: days(-30), effectiveUntil: NOW.toISOString() } })
    expect(membershipLiveness(handover, NOW).live).toBe(false)

    const successor = membership({ id: "mem-2", interval: { effectiveFrom: NOW.toISOString(), effectiveUntil: null } })
    expect(membershipLiveness(successor, NOW).live).toBe(true)
  })

  it("reports a revocation as a revocation, not as an expiry", () => {
    // Somebody acted. Reporting EXPIRED would make a deliberate removal look
    // like ordinary lapse, and those need different conversations.
    const revoked = membership({
      status: "REVOKED",
      statusReason: "Left the university.",
      interval: { effectiveFrom: days(-30), effectiveUntil: hours(-1) },
    })
    const state = membershipLiveness(revoked, NOW)
    if (state.live) throw new Error("expected not live")
    expect(state.reason).toBe("REVOKED")
  })

  it("distinguishes suspended from revoked", () => {
    // One can be lifted, the other needs a new grant. An interface answering
    // only false forces the caller to guess which.
    const suspended = membershipLiveness(membership({ status: "SUSPENDED", statusReason: "Under review" }), NOW)
    if (suspended.live) throw new Error("expected not live")
    expect(suspended.reason).toBe("SUSPENDED")
    expect(suspended.detail).toMatch(/without a new grant/)
  })

  it("filters a roster to the people who are actually members now", () => {
    const roster = [
      membership({ id: "live" }),
      membership({ id: "gone", status: "REVOKED", statusReason: "left" }),
      membership({ id: "future", interval: { effectiveFrom: days(3), effectiveUntil: null } }),
    ]
    expect(liveMemberships(roster, NOW).map((m) => m.id)).toEqual(["live"])
  })
})

describe("a person record survives being superseded", () => {
  const person = (over: Partial<Person> = {}): Person => ({
    id: "person-1",
    displayName: "A Person",
    primaryEmail: null,
    status: "ACTIVE",
    createdAt: days(-100),
    mergedIntoPersonId: null,
    ...over,
  })

  it("is live when active", () => {
    expect(personLiveness(person(), NOW)).toEqual({ live: true })
  })

  it("reports a merged record as superseded, and says where it went", () => {
    // Kept rather than deleted so older references still resolve — an approval
    // signed by this id must not become unreadable.
    const state = personLiveness(person({ mergedIntoPersonId: "person-9" }), NOW)
    if (state.live) throw new Error("expected not live")
    expect(state.reason).toBe("SUPERSEDED")
    expect(state.detail).toContain("person-9")
  })
})

describe("invitations expire without anyone sweeping them", () => {
  const invitation = (over: Partial<Invitation> = {}): Invitation => ({
    id: "inv-1",
    tenantId: "rochester",
    sentToEmail: "someone@example.invalid",
    invitedBy: "director@example.invalid",
    status: "PENDING",
    createdAt: days(-1),
    expiresAt: days(6),
    acceptedByPersonId: null,
    ...over,
  })

  it("is live while pending and unexpired", () => {
    expect(invitationLiveness(invitation(), NOW)).toEqual({ live: true })
  })

  it("expires from its own timestamp, with no stored EXPIRED status", () => {
    // A stored status would mean an invitation nobody swept stays acceptable
    // forever — the same class of bug as a stored isActive.
    const state = invitationLiveness(invitation({ expiresAt: hours(-1) }), NOW)
    if (state.live) throw new Error("expected not live")
    expect(state.reason).toBe("EXPIRED")
  })

  it("cannot be accepted twice", () => {
    const state = invitationLiveness(invitation({ status: "ACCEPTED", acceptedByPersonId: "person-2" }), NOW)
    if (state.live) throw new Error("expected not live")
    expect(state.reason).toBe("ALREADY_ACCEPTED")
    expect(state.detail).toMatch(/single-use/)
  })
})

describe("sessions", () => {
  const session = (over: Partial<AuthSession> = {}): AuthSession => ({
    id: "sess-1",
    personId: "person-1",
    tenantId: "rochester",
    externalIdentityId: "ext-1",
    issuedAt: hours(-1),
    expiresAt: hours(7),
    revokedAt: null,
    steppedUpAt: null,
    authorizationRevision: 4,
    ...over,
  })

  it("is live inside its window", () => {
    expect(sessionLiveness(session(), NOW)).toEqual({ live: true })
  })

  it("separates a revocation from an expiry", () => {
    // Both make it unusable; only one means somebody acted, and an incident
    // review needs to tell them apart.
    const revoked = sessionLiveness(session({ revokedAt: hours(-0.5) }), NOW)
    if (revoked.live) throw new Error("expected not live")
    expect(revoked.reason).toBe("REVOKED")

    const expired = sessionLiveness(session({ issuedAt: hours(-9), expiresAt: hours(-1) }), NOW)
    if (expired.live) throw new Error("expected not live")
    expect(expired.reason).toBe("EXPIRED")
  })

  it("records which authorization revision it was built on", () => {
    // GE-040-005 invalidates sessions when authorization changes, and can only
    // do that if the session says what it resolved against.
    expect(session().authorizationRevision).toBe(4)
  })
})

describe("recovery paths", () => {
  const method = (over: Partial<RecoveryMethod> = {}): RecoveryMethod => ({
    id: "rec-1",
    personId: "person-1",
    kind: "BACKUP_EMAIL",
    reference: "b***@example.invalid",
    verifiedAt: days(-5),
    status: "ACTIVE",
    createdAt: days(-5),
    ...over,
  })

  it("an unverified method is not a way back in", () => {
    // Otherwise an account is "recoverable" through a mailbox the person cannot
    // read — or one somebody else can.
    const state = recoveryLiveness(method({ verifiedAt: null }), NOW)
    if (state.live) throw new Error("expected not live")
    expect(state.reason).toBe("UNVERIFIED")
  })

  it("counts only usable methods toward the floor GE-040-004 defends", () => {
    const methods = [
      method({ id: "ok" }),
      method({ id: "unverified", verifiedAt: null }),
      method({ id: "gone", status: "REVOKED" }),
    ]
    expect(usableRecoveryCount(methods, NOW)).toBe(1)
  })
})

describe("no status change without its audit record", () => {
  it("returns the record together with the membership, not from a second call", () => {
    // An audit write issued separately is one a code path can skip — by an
    // early return, a throw between the two, or a developer who did not know.
    const outcome = reviseMembership(membership(), {
      change: "REVOKE",
      actorId: "director@example.invalid",
      reason: "Left the university at the end of term.",
      at: NOW,
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.audit.action).toBe("TenantMembership.REVOKE")
    expect(outcome.audit.resourceId).toBe("mem-1")
    expect(outcome.audit.reason).toBe("Left the university at the end of term.")
  })

  it("refuses a change with no actor", () => {
    const outcome = reviseMembership(membership(), { change: "SUSPEND", actorId: "  ", reason: "x".repeat(20), at: NOW })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.problem).toMatch(/cannot be audited/)
  })

  it("refuses to remove access without a reason", () => {
    // It is what the person is told and what a review reads.
    for (const change of ["SUSPEND", "REVOKE"] as const) {
      const outcome = reviseMembership(membership(), { change, actorId: "director", at: NOW })
      expect(outcome.ok).toBe(false)
      if (outcome.ok) continue
      expect(outcome.problem).toMatch(/needs a reason/)
    }
  })

  it("does not demand a reason for a grant", () => {
    expect(reviseMembership(membership({ status: "SUSPENDED", statusReason: "x" }), {
      change: "REINSTATE",
      actorId: "director",
      at: NOW,
    }).ok).toBe(true)
  })
})

describe("revocation is effective-dating, not deletion", () => {
  it("closes the window and keeps the row", () => {
    // apps/web deleted the row while telling the person "your past activity
    // stays on record". Nothing could then answer "was this person a Director
    // on 12 March" — which is what an approval signed on 12 March raises.
    const outcome = reviseMembership(membership(), {
      change: "REVOKE",
      actorId: "director",
      reason: "Left the university.",
      at: NOW,
    })
    if (!outcome.ok) throw new Error("expected the revoke to apply")

    expect(outcome.membership.status).toBe("REVOKED")
    expect(outcome.membership.interval.effectiveUntil).toBe(NOW.toISOString())
    // The start is untouched: when they joined is still true.
    expect(outcome.membership.interval.effectiveFrom).toBe(days(-30))
    expect(outcome.membership.id).toBe("mem-1")
  })

  it("does not leave the window open on a revoked row", () => {
    // Anything reading the interval rather than the status would otherwise see
    // a live membership.
    const outcome = reviseMembership(membership(), {
      change: "REVOKE",
      actorId: "d",
      reason: "Left the university.",
      at: NOW,
    })
    if (!outcome.ok) return
    expect(outcome.membership.interval.effectiveUntil).not.toBeNull()
    expect(membershipLiveness(outcome.membership, NOW).live).toBe(false)
  })

  it("refuses to revive a revoked membership as a grant", () => {
    // Reusing the row would erase the fact that it ended. A new grant is a new
    // membership.
    const revoked = membership({ status: "REVOKED", statusReason: "left" })
    const outcome = reviseMembership(revoked, { change: "GRANT", actorId: "director", at: NOW })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.problem).toMatch(/new membership/)
  })

  it("only reinstates something that is suspended", () => {
    const outcome = reviseMembership(membership(), { change: "REINSTATE", actorId: "director", at: NOW })
    expect(outcome.ok).toBe(false)
  })
})

describe("the audit record says whether access actually changed", () => {
  it("marks a revoke of a live membership as changing access", () => {
    const outcome = reviseMembership(membership(), {
      change: "REVOKE",
      actorId: "d",
      reason: "Left the university.",
      at: NOW,
    })
    if (!outcome.ok) return
    expect(outcome.audit.metadata.accessChanged).toBe(true)
    expect(outcome.audit.metadata.liveAfter).toBe(false)
  })

  it("marks a reschedule that changes nothing today as not changing access", () => {
    // A review reading only "RESCHEDULE" cannot tell a year-long extension from
    // a revocation-by-backdating.
    const outcome = reviseMembership(membership(), {
      change: "RESCHEDULE",
      actorId: "d",
      effectiveUntil: days(365),
      at: NOW,
    })
    if (!outcome.ok) return
    expect(outcome.audit.metadata.accessChanged).toBe(false)
    expect(outcome.audit.metadata.liveAfter).toBe(true)
  })

  it("catches a reschedule that ends access by backdating", () => {
    const outcome = reviseMembership(membership(), {
      change: "RESCHEDULE",
      actorId: "d",
      effectiveUntil: hours(-1),
      at: NOW,
    })
    if (!outcome.ok) return
    expect(outcome.audit.metadata.accessChanged).toBe(true)
    expect(outcome.audit.metadata.liveAfter).toBe(false)
  })

  it("refuses a window that ends before it starts", () => {
    const outcome = reviseMembership(membership(), {
      change: "RESCHEDULE",
      actorId: "d",
      effectiveFrom: days(5),
      effectiveUntil: days(1),
      at: NOW,
    })
    expect(outcome.ok).toBe(false)
  })

  it("carries both the before and the after", () => {
    const outcome = reviseMembership(membership(), {
      change: "SUSPEND",
      actorId: "d",
      reason: "Under investigation by the office.",
      at: NOW,
    })
    if (!outcome.ok) return
    expect(outcome.audit.metadata.from).toMatchObject({ status: "ACTIVE" })
    expect(outcome.audit.metadata.to).toMatchObject({ status: "SUSPENDED" })
  })
})
