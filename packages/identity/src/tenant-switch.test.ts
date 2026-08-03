import { planTenantSwitch, type ServerSession, type TenantMembership } from "./index"

/**
 * GE-042-006 — a tenant switch is a privilege change, not a preference.
 *
 * The session is bound to one tenant, so the identifier the browser holds
 * cannot serve the new one. Everything here follows from that.
 */

const NOW = new Date("2026-08-02T12:00:00Z")
const iso = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString()

const session = (over: Partial<ServerSession> = {}): ServerSession => ({
  id: "sess-old",
  personId: "person-1",
  tenantId: "rochester",
  externalIdentityId: "ext-1",
  issuedAt: iso(-60),
  expiresAt: iso(600),
  revokedAt: null,
  steppedUpAt: null,
  authorizationRevision: 4,
  csrfToken: "csrf-old",
  lastSeenAt: iso(-1),
  deviceLabel: "Chrome on Windows",
  rotatedFromId: null,
  rotationReason: null,
  ...over,
})

const membership = (over: Partial<TenantMembership> = {}): TenantMembership => ({
  id: "mem-1",
  personId: "person-1",
  tenantId: "ithaca",
  origin: "INVITATION",
  status: "ACTIVE",
  interval: { effectiveFrom: iso(-10_000), effectiveUntil: null },
  statusReason: null,
  ...over,
})

const NEXT = { sessionId: "sess-new", csrfToken: "csrf-new" }

const plan = (over: Partial<Parameters<typeof planTenantSwitch>[0]> = {}) =>
  planTenantSwitch({
    session: session(),
    memberships: [membership()],
    targetTenantId: "ithaca",
    next: NEXT,
    at: NOW,
    ...over,
  })

describe("a switch rebinds the session to the tenant it moved to", () => {
  it("rotates the identifier", () => {
    const outcome = plan()
    if (!outcome.ok) throw new Error(`expected an accepted switch, got ${outcome.reason}`)

    expect(outcome.rotation.session.id).toBe("sess-new")
    expect(outcome.rotation.session.csrfToken).toBe("csrf-new")
    // The old identifier stops working, or the switch has produced a second
    // session rather than moved one.
    expect(outcome.rotation.previous.id).toBe("sess-old")
    expect(outcome.rotation.previous.revokedAt).toBe(NOW.toISOString())
  })

  it("binds the new session to the target tenant", () => {
    // `rotateSession` spreads the old session, so a rotation that forgot to
    // rebind produces a fresh id still bound to the tenant just left — and
    // every request after the switch fails WRONG_TENANT.
    const outcome = plan()
    if (!outcome.ok) throw new Error(`expected an accepted switch, got ${outcome.reason}`)

    expect(outcome.rotation.session.tenantId).toBe("ithaca")
    expect(outcome.rotation.previous.tenantId).toBe("rochester")
  })

  it("does not extend the absolute expiry", () => {
    // Otherwise a session lives forever by switching back and forth, which is
    // the loophole the absolute clock exists to close.
    const outcome = plan()
    if (!outcome.ok) throw new Error(`expected an accepted switch, got ${outcome.reason}`)

    expect(outcome.rotation.session.expiresAt).toBe(session().expiresAt)
  })

  it("keeps the rotation chain followable, and says why it rotated", () => {
    // `rotatedFromId` alone answers *that* the id changed and leaves the useful
    // question open. Re-authentication, a tenant switch and a step-up are three
    // different stories at 02:14, and only one of them is alarming.
    //
    // `rotateSession` took a `reason` and dropped it until GE-042-006 — found
    // by a mutation that changed PRIVILEGE_CHANGE to AUTHENTICATION and broke
    // nothing, because nothing read it.
    const outcome = plan()
    if (!outcome.ok) throw new Error(`expected an accepted switch, got ${outcome.reason}`)

    expect(outcome.rotation.session.rotatedFromId).toBe("sess-old")
    expect(outcome.rotation.session.rotationReason).toBe("PRIVILEGE_CHANGE")
  })

  it("says the previous tenant's cached renders are void", () => {
    // A switch that rotates the session and leaves the old tenant's pages in a
    // cache has moved the person and not the page.
    const outcome = plan()
    if (!outcome.ok) throw new Error(`expected an accepted switch, got ${outcome.reason}`)

    expect(outcome.invalidatesCachedRenders).toBe(true)
  })
})

describe("membership is proved at the moment of the switch", () => {
  it("refuses a tenant the person has no membership of", () => {
    const outcome = plan({ targetTenantId: "cornell" })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe("NOT_A_MEMBER")
  })

  it("refuses a membership that has been suspended since the page rendered", () => {
    // The interval between rendering a switcher and clicking it is exactly when
    // somebody gets suspended, and the browser's list is that old.
    const outcome = plan({
      memberships: [membership({ status: "SUSPENDED", statusReason: "under review" })],
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe("NOT_A_MEMBER")
  })

  it("refuses a membership whose term has ended", () => {
    const outcome = plan({
      memberships: [membership({ interval: { effectiveFrom: iso(-10_000), effectiveUntil: iso(-1) } })],
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe("NOT_A_MEMBER")
  })

  it("refuses a membership that belongs to somebody else", () => {
    // Same tenant, live, wrong person. Without the personId check a switch
    // would succeed on any live membership in the list the caller happened to
    // pass — and callers pass lists.
    const outcome = plan({ memberships: [membership({ personId: "person-2" })] })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe("NOT_A_MEMBER")
  })
})

describe("the session presenting the switch has to be usable", () => {
  it("refuses a revoked session", () => {
    const outcome = plan({ session: session({ revokedAt: iso(-5) }) })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe("SESSION_NOT_LIVE")
  })

  it("refuses one past its absolute limit", () => {
    const outcome = plan({ session: session({ expiresAt: iso(-1) }) })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe("SESSION_NOT_LIVE")
  })

  it("refuses an idle one", () => {
    const outcome = plan({ session: session({ lastSeenAt: iso(-31) }) })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe("SESSION_NOT_LIVE")
  })

  it("refuses when there is no session at all", () => {
    const outcome = plan({ session: null })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe("SESSION_NOT_LIVE")
  })

  it("tells a dead session apart from a missing membership", () => {
    // They need different answers. Collapsing both into one refusal tells a
    // suspended person to sign in again — which they can do, successfully, to
    // no effect, forever.
    const dead = plan({ session: session({ revokedAt: iso(-5) }) })
    const notMember = plan({ targetTenantId: "cornell" })
    if (dead.ok || notMember.ok) throw new Error("unreachable")

    expect(dead.reason).not.toBe(notMember.reason)
    expect(dead.detail).not.toBe(notMember.detail)
  })
})

describe("switching to where you already are", () => {
  it("is refused rather than rotated", () => {
    // Rotation is not free: the old id stops working immediately, so rotating
    // on a double-click races the in-flight request and signs somebody out.
    const outcome = plan({ targetTenantId: "rochester", memberships: [membership({ tenantId: "rochester" })] })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe("ALREADY_ACTIVE")
  })

  it("is checked before membership, so the message is the useful one", () => {
    // Somebody already acting in a tenant is a member of it by construction;
    // reporting NOT_A_MEMBER here would be both alarming and false.
    const outcome = plan({ targetTenantId: "rochester", memberships: [] })
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe("ALREADY_ACTIVE")
  })
})
