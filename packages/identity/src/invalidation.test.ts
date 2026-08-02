import {
  evaluateSession,
  sessionsEndedBy,
  type AuthSession,
  type ExternalIdentity,
  type SeatAssignment,
  type SessionContext,
  type TenantMembership,
} from "./index"

/**
 * GE-040-005 — access stops when the decision is made.
 *
 * Five triggers, and only one is a clock event. The other four are somebody
 * deciding something, which is why "immediate" is the hard word: a session
 * minted an hour ago carries a snapshot of authority that was true then, and
 * every trigger makes that snapshot wrong while the token stays valid.
 *
 * The mechanism is re-evaluation. There is no revocation list to publish, and
 * so no window in which it has not published yet — which is exactly the window
 * somebody is trying to use.
 */

const NOW = new Date("2026-08-02T12:00:00Z")
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000).toISOString()
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()

const session = (over: Partial<AuthSession> = {}): AuthSession => ({
  id: "sess-1",
  personId: "person-1",
  tenantId: "rochester",
  externalIdentityId: "ext-1",
  issuedAt: hours(-1),
  expiresAt: hours(7),
  revokedAt: null,
  steppedUpAt: null,
  authorizationRevision: 7,
  ...over,
})

const identity = (over: Partial<ExternalIdentity> = {}): ExternalIdentity => ({
  id: "ext-1",
  personId: "person-1",
  connectionId: "conn-saml",
  issuer: "https://idp.rochester.example/saml",
  subject: "S-1",
  assertedEmail: null,
  emailVerified: false,
  status: "ACTIVE",
  linkedAt: days(-30),
  lastAuthenticatedAt: hours(-1),
  ...over,
})

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

const seat = (over: Partial<SeatAssignment> = {}): SeatAssignment => ({
  id: "seat-1",
  personId: "person-1",
  organizationId: "org-chess",
  tenantId: "rochester",
  roleId: "role-treasurer",
  status: "ACTIVE",
  interval: { effectiveFrom: days(-30), effectiveUntil: null },
  ...over,
})

const context = (over: Partial<SessionContext> = {}): SessionContext => ({
  membership: membership(),
  identity: identity(),
  connectionStatus: "ACTIVE",
  authorizationRevision: 7,
  seats: [seat()],
  ...over,
})

describe("a healthy session stays valid and carries its live seats", () => {
  it("is valid when nothing has changed", () => {
    const result = evaluateSession(session(), context(), NOW)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.staleAuthority).toBe(false)
    expect(result.staleReason).toBeNull()
    expect(result.liveSeatIds).toEqual(["seat-1"])
  })

  it("recomputes seats rather than trusting anything in the token", () => {
    // The seats come from current state, not from the session. A seat granted
    // after sign-in appears without a new session.
    const result = evaluateSession(session(), context({ seats: [seat(), seat({ id: "seat-2", roleId: "r2" })] }), NOW)
    if (!result.valid) return
    expect(result.liveSeatIds).toEqual(["seat-1", "seat-2"])
  })

  it("never reports another person's seats", () => {
    const result = evaluateSession(session(), context({ seats: [seat(), seat({ id: "s-other", personId: "person-9" })] }), NOW)
    if (!result.valid) return
    expect(result.liveSeatIds).toEqual(["seat-1"])
  })
})

describe("the four deliberate triggers end the session immediately", () => {
  it("ends a revoked session, and says a person did it", () => {
    // An operator reading the log needs to know which, so a revocation must not
    // be reported as an expiry.
    const result = evaluateSession(session({ revokedAt: hours(-0.1) }), context(), NOW)
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.trigger).toBe("SESSION_REVOKED")
  })

  it("ends a session whose membership was suspended", () => {
    const result = evaluateSession(
      session(),
      context({ membership: membership({ status: "SUSPENDED", statusReason: "under review" }) }),
      NOW,
    )
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.trigger).toBe("MEMBERSHIP_SUSPENDED")
  })

  it("distinguishes a suspension from a membership that simply ended", () => {
    // They need different conversations: one can be lifted, the other needs a
    // new grant.
    const ended = evaluateSession(
      session(),
      context({ membership: membership({ interval: { effectiveFrom: days(-100), effectiveUntil: hours(-1) } }) }),
      NOW,
    )
    expect(ended.valid).toBe(false)
    if (ended.valid) return
    expect(ended.trigger).toBe("MEMBERSHIP_ENDED")
  })

  it("ends every session opened through a disabled connection", () => {
    // Disabling a connection is how a tenant turns off a compromised IdP. If
    // open sessions survived, the control would do nothing for eight hours.
    for (const status of ["DISABLED", "REVOKED", "PENDING", null]) {
      const result = evaluateSession(session(), context({ connectionStatus: status }), NOW)
      expect(result.valid).toBe(false)
      if (result.valid) continue
      expect(result.trigger).toBe("CONNECTION_DISABLED")
    }
  })

  it("ends a session whose credential was unlinked", () => {
    for (const identityState of [null, identity({ status: "REVOKED" }), identity({ status: "SUSPENDED" })]) {
      const result = evaluateSession(session(), context({ identity: identityState }), NOW)
      expect(result.valid).toBe(false)
      if (result.valid) continue
      expect(result.trigger).toBe("CREDENTIAL_UNLINKED")
    }
  })

  it("ends a session for a person who is no longer a member at all", () => {
    const result = evaluateSession(session(), context({ membership: null }), NOW)
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.trigger).toBe("MEMBERSHIP_ENDED")
  })

  it("reports the deliberate act when several things are wrong at once", () => {
    // A revoked session whose membership also lapsed reports the revocation:
    // somebody did that, and that is the fact worth surfacing.
    const result = evaluateSession(
      session({ revokedAt: hours(-0.1) }),
      context({ membership: membership({ status: "SUSPENDED", statusReason: "x" }), connectionStatus: "DISABLED" }),
      NOW,
    )
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.trigger).toBe("SESSION_REVOKED")
  })
})

describe("an ended assignment is not a dead session", () => {
  it("keeps the session and marks the authority stale", () => {
    // Logging somebody out because a term ended on schedule would be punishing
    // them for the calendar.
    const ended = seat({ interval: { effectiveFrom: days(-30), effectiveUntil: hours(-0.5) } })
    const result = evaluateSession(session(), context({ seats: [ended] }), NOW)

    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.staleAuthority).toBe(true)
    expect(result.staleReason).toBe("ASSIGNMENT_ENDED")
    expect(result.liveSeatIds).toEqual([])
  })

  it("does not call a seat that ended before sign-in an ending", () => {
    // It is not news. Reporting it would make every session of a former
    // treasurer permanently "stale", and a flag that is always on is ignored.
    const longGone = seat({ interval: { effectiveFrom: days(-300), effectiveUntil: hours(-5) } })
    const result = evaluateSession(session(), context({ seats: [longGone] }), NOW)
    if (!result.valid) return
    expect(result.staleAuthority).toBe(false)
  })

  it("does not call a seat granted after sign-in an ending", () => {
    // Comparing counts would report a new seat as a removal, which is the
    // opposite of what happened.
    const result = evaluateSession(
      session(),
      context({ seats: [seat(), seat({ id: "seat-new", interval: { effectiveFrom: hours(-0.2), effectiveUntil: null } })] }),
      NOW,
    )
    if (!result.valid) return
    expect(result.staleAuthority).toBe(false)
    expect(result.liveSeatIds).toEqual(["seat-1", "seat-new"])
  })
})

describe("an authorization revision change re-resolves, it does not sign anybody out", () => {
  it("marks the session stale when the tenant's revision has moved", () => {
    const result = evaluateSession(session(), context({ authorizationRevision: 8 }), NOW)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.staleAuthority).toBe(true)
    expect(result.staleReason).toBe("AUTHORIZATION_REVISION_CHANGED")
  })

  it("marks it stale when the revision moved backwards, too", () => {
    // A rollback is a change. "Newer than mine" is the wrong test — what
    // matters is that the snapshot is not the current one.
    const result = evaluateSession(session(), context({ authorizationRevision: 6 }), NOW)
    if (!result.valid) return
    expect(result.staleAuthority).toBe(true)
  })

  it("does not end the session", () => {
    // Killing every session on every policy edit would be hostile, and would
    // make operators reluctant to edit policy.
    expect(evaluateSession(session(), context({ authorizationRevision: 99 }), NOW).valid).toBe(true)
  })
})

describe("what a change just did, for the operator who made it", () => {
  it("names the sessions a suspension ended", () => {
    // A control whose effect nobody can see is one nobody trusts, and the usual
    // failure is that the answer is only knowable by waiting for complaints.
    const sessions = [
      session({ id: "sess-a" }),
      session({ id: "sess-b", personId: "person-2" }),
      session({ id: "sess-c", revokedAt: hours(-1) }),
    ]
    const suspended = context({ membership: membership({ status: "SUSPENDED", statusReason: "x" }) })

    const ended = sessionsEndedBy(sessions, () => suspended, NOW)
    expect(ended.map((e) => e.sessionId)).toEqual(["sess-a", "sess-b", "sess-c"])
    expect(ended.find((e) => e.sessionId === "sess-c")?.trigger).toBe("SESSION_REVOKED")
    expect(ended.find((e) => e.sessionId === "sess-a")?.trigger).toBe("MEMBERSHIP_SUSPENDED")
  })

  it("reports nothing when a change ended nothing", () => {
    expect(sessionsEndedBy([session()], () => context(), NOW)).toEqual([])
  })

  it("does not report a merely-stale session as ended", () => {
    // Stale is not ended. Conflating them would tell an operator they had
    // signed people out when they had not.
    expect(sessionsEndedBy([session()], () => context({ authorizationRevision: 9 }), NOW)).toEqual([])
  })
})
