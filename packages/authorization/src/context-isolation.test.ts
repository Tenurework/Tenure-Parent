import {
  checkSession,
  planTenantSwitch,
  type ServerSession,
  type TenantMembership,
} from "@tenure/identity"

import { decide, effectivePermissions, type AuthorizationWorld } from "./index"

/**
 * GE-053-004 — "Multi-seat and multi-tenant authority remains isolated;
 * switching context rotates/revalidates session."
 *
 * One sentence, two halves that are usually tested apart and fail together.
 *
 *   **Isolation** is an authorization property: a person who holds two seats
 *   holds each of them where it was granted, and a person who belongs to two
 *   tenants has two separate authorities that never sum. The dangerous version
 *   of the bug is not "authority leaks" — it is "authority is computed from the
 *   union of everything the person holds", which reads as generous rather than
 *   wrong until somebody notices the club treasurer approving the other club's
 *   spend.
 *
 *   **Switching** is a session property, and it is what makes the isolation
 *   reachable: a session is bound to one tenant, so moving between them has to
 *   revalidate membership at the instant of the move and rotate the identifier.
 *   `packages/identity/src/tenant-switch.test.ts` covers the rotation mechanics
 *   in depth. What is asserted here is the join the requirement actually names —
 *   that the authority answered after a switch is the target tenant's, and that
 *   the identifier the old tenant was served under stops working.
 */

const NOW = new Date("2026-08-17T12:00:00Z")
const T = NOW.toISOString()
const PAST = "2020-01-01T00:00:00Z"
const iso = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString()

const ROLES = [
  { key: "seat.president", permissions: ["approvals.request.decide", "finance.budget.update", "org.unit.read"] },
  { key: "seat.member", permissions: ["org.unit.read"] },
  { key: "office.director", permissions: ["admin.console.read", "org.unit.read"] },
]

/* ─────────────────────────────────────────────────────── multi-seat ── */

/**
 * `rowan` holds two seats in one tenant: president of `chess`, ordinary member
 * of `debate`. Both units sit under the same division.
 */
const twoSeats: AuthorizationWorld = {
  principals: [{ id: "rowan" }],
  memberships: [{ principalId: "rowan", tenantId: "alpha", state: "ACTIVE", effectiveFrom: PAST }],
  roles: ROLES,
  grants: [
    { principalId: "rowan", tenantId: "alpha", roleKey: "seat.president", scope: { kind: "orgUnit", orgUnitId: "chess" }, state: "CONFIRMED", effectiveFrom: PAST },
    { principalId: "rowan", tenantId: "alpha", roleKey: "seat.member", scope: { kind: "orgUnit", orgUnitId: "debate" }, state: "CONFIRMED", effectiveFrom: PAST },
  ],
  ancestorsOf: (id) => (id === "chess" || id === "debate" ? ["division", "root"] : id === "division" ? ["root"] : []),
  enabledModules: ["approvals", "organizations", "budgeting", "administration"],
}

const askIn = (world: AuthorizationWorld, tenantId: string, permission: string, orgUnitId?: string) =>
  decide(world, {
    principalId: "rowan",
    tenantId,
    permission,
    resource: orgUnitId ? { type: "Request", id: "r1", orgUnitId } : undefined,
    at: T,
  })

describe("GE-053-004 — two seats are two authorities, not one larger one", () => {
  it("answers each unit from the seat held there", () => {
    expect(askIn(twoSeats, "alpha", "approvals.request.decide", "chess").allowed).toBe(true)
    expect(askIn(twoSeats, "alpha", "org.unit.read", "debate").allowed).toBe(true)
  })

  it("does not carry the president's authority into the other unit", () => {
    // The union bug: rowan is *a* president, so a naive "what can rowan do"
    // answers yes here.
    const d = askIn(twoSeats, "alpha", "approvals.request.decide", "debate")
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe("OUT_OF_SCOPE")
  })

  it("does not reach the parent division from either seat", () => {
    // Inheritance is downward only. Two seats under one division must not add
    // up to authority over the division.
    expect(askIn(twoSeats, "alpha", "approvals.request.decide", "division").reason).toBe("OUT_OF_SCOPE")
  })

  it("names the seat that answered, so an audit can tell them apart", () => {
    expect(askIn(twoSeats, "alpha", "org.unit.read", "chess").viaRoles).toEqual(["seat.president"])
    expect(askIn(twoSeats, "alpha", "org.unit.read", "debate").viaRoles).toEqual(["seat.member"])
  })

  it("keeps neither seat's permissions in the resource-free capability set", () => {
    // Both are org-scoped, so neither can be answered without a unit. A menu
    // built from the union would offer the president's actions in the other
    // club — which is the union bug arriving through the navigation.
    expect(effectivePermissions(twoSeats, "rowan", "alpha", T).size).toBe(0)
  })

  it("adds a tenant-wide office to the seats without merging them", () => {
    // Somebody can hold both. The office answers everywhere; the seats still
    // answer only where they were granted.
    const alsoOffice: AuthorizationWorld = {
      ...twoSeats,
      grants: [
        ...twoSeats.grants,
        { principalId: "rowan", tenantId: "alpha", roleKey: "office.director", scope: { kind: "tenant" }, state: "CONFIRMED", effectiveFrom: PAST },
      ],
    }
    expect(askIn(alsoOffice, "alpha", "admin.console.read", "debate").allowed).toBe(true)
    // Still not a president in debate: the office does not carry the seat.
    expect(askIn(alsoOffice, "alpha", "approvals.request.decide", "debate").reason).toBe("OUT_OF_SCOPE")
  })
})

/* ───────────────────────────────────────────────────── multi-tenant ── */

/** The same person, in two tenants, with different authority in each. */
const twoTenants: AuthorizationWorld = {
  principals: [{ id: "rowan" }],
  memberships: [
    { principalId: "rowan", tenantId: "alpha", state: "ACTIVE", effectiveFrom: PAST },
    { principalId: "rowan", tenantId: "beta", state: "ACTIVE", effectiveFrom: PAST },
  ],
  roles: ROLES,
  grants: [
    { principalId: "rowan", tenantId: "alpha", roleKey: "office.director", scope: { kind: "tenant" }, state: "CONFIRMED", effectiveFrom: PAST },
    { principalId: "rowan", tenantId: "beta", roleKey: "seat.member", scope: { kind: "orgUnit", orgUnitId: "chess" }, state: "CONFIRMED", effectiveFrom: PAST },
  ],
  ancestorsOf: () => [],
  enabledModules: ["approvals", "organizations", "budgeting", "administration"],
}

describe("GE-053-004 — two tenants are two authorities for one person", () => {
  it("answers each tenant from its own grants", () => {
    expect(askIn(twoTenants, "alpha", "admin.console.read").allowed).toBe(true)
    expect(askIn(twoTenants, "beta", "org.unit.read", "chess").allowed).toBe(true)
  })

  it("does not carry the office held in alpha into beta", () => {
    expect(askIn(twoTenants, "beta", "admin.console.read").reason).toBe("NO_ROLE_GRANTING")
  })

  it("does not carry the seat held in beta into alpha", () => {
    // NO_ROLE_GRANTING rather than OUT_OF_SCOPE is the exact statement wanted:
    // the beta grant is not merely too narrow to cover `chess` in alpha, it is
    // not consulted at all. A reason of OUT_OF_SCOPE here would mean the row had
    // been read and then rejected on geography, which is one filter away from
    // being read and accepted.
    const d = askIn(twoTenants, "alpha", "approvals.request.decide", "chess")
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe("NO_ROLE_GRANTING")
  })

  it("produces two different capability sets for one principal", () => {
    const inAlpha = effectivePermissions(twoTenants, "rowan", "alpha", T)
    const inBeta = effectivePermissions(twoTenants, "rowan", "beta", T)
    expect(inAlpha.has("admin.console.read")).toBe(true)
    expect(inBeta.has("admin.console.read")).toBe(false)
    expect([...inAlpha].sort()).not.toEqual([...inBeta].sort())
  })
})

/* ──────────────────────────────────────── switching between them ── */

const session = (over: Partial<ServerSession> = {}): ServerSession => ({
  id: "sess-alpha",
  personId: "rowan",
  tenantId: "alpha",
  externalIdentityId: "ext-1",
  issuedAt: iso(-60),
  expiresAt: iso(600),
  revokedAt: null,
  steppedUpAt: null,
  authorizationRevision: 1,
  csrfToken: "csrf-alpha",
  lastSeenAt: iso(-1),
  deviceLabel: "Firefox on macOS",
  rotatedFromId: null,
  rotationReason: null,
  ...over,
})

const membership = (over: Partial<TenantMembership> = {}): TenantMembership => ({
  id: "mem-beta",
  personId: "rowan",
  tenantId: "beta",
  origin: "INVITATION",
  status: "ACTIVE",
  interval: { effectiveFrom: iso(-10_000), effectiveUntil: null },
  statusReason: null,
  ...over,
})

describe("GE-053-004 — switching context rotates and revalidates", () => {
  const switchToBeta = (over: Partial<Parameters<typeof planTenantSwitch>[0]> = {}) =>
    planTenantSwitch({
      session: session(),
      memberships: [membership()],
      targetTenantId: "beta",
      next: { sessionId: "sess-beta", csrfToken: "csrf-beta" },
      at: NOW,
      ...over,
    })

  it("rotates the identifier and rebinds it to the target", () => {
    const outcome = switchToBeta()
    if (!outcome.ok) throw new Error(`expected an accepted switch, got ${outcome.reason}`)
    expect(outcome.rotation.session.id).toBe("sess-beta")
    expect(outcome.rotation.session.tenantId).toBe("beta")
    expect(outcome.rotation.previous.revokedAt).toBe(T)
  })

  it("makes the old identifier unusable, in either tenant", () => {
    // The whole point of rotating. The revoked session must not serve the
    // tenant it was issued for, and could never serve the new one — a session
    // is bound to exactly one tenant.
    const outcome = switchToBeta()
    if (!outcome.ok) throw new Error("expected an accepted switch")

    const revoked = outcome.rotation.previous
    expect(checkSession(revoked, { tenantId: "alpha", at: NOW }).live).toBe(false)
    expect(checkSession(revoked, { tenantId: "beta", at: NOW }).live).toBe(false)
  })

  it("serves the new tenant's authority after the switch, not the one just left", () => {
    // THE JOIN. The two halves of the requirement, together: after the switch
    // the session names beta, and the decision made under it is beta's answer.
    const outcome = switchToBeta()
    if (!outcome.ok) throw new Error("expected an accepted switch")

    const live = checkSession(outcome.rotation.session, { tenantId: "beta", at: NOW })
    expect(live.live).toBe(true)

    const actingTenant = outcome.rotation.session.tenantId
    expect(askIn(twoTenants, actingTenant, "admin.console.read").allowed).toBe(false)
    expect(askIn(twoTenants, actingTenant, "org.unit.read", "chess").allowed).toBe(true)
  })

  it("revalidates membership at the instant of the switch, not from the rendered list", () => {
    // The interval between rendering a switcher and clicking it is exactly when
    // somebody is suspended, and the browser's list is that old.
    const suspended = switchToBeta({ memberships: [membership({ status: "SUSPENDED", statusReason: "under review" })] })
    expect(suspended.ok).toBe(false)
    if (suspended.ok) throw new Error("unreachable")
    expect(suspended.reason).toBe("NOT_A_MEMBER")
  })

  it("refuses a switch presented with a dead session", () => {
    const dead = switchToBeta({ session: session({ revokedAt: iso(-5) }) })
    expect(dead.ok).toBe(false)
    if (dead.ok) throw new Error("unreachable")
    expect(dead.reason).toBe("SESSION_NOT_LIVE")
  })

  it("refuses to move somewhere the person is not a member, leaving them where they were", () => {
    const nowhere = switchToBeta({ targetTenantId: "gamma" })
    expect(nowhere.ok).toBe(false)
    if (nowhere.ok) throw new Error("unreachable")
    expect(nowhere.reason).toBe("NOT_A_MEMBER")
    // And the authority question for gamma is refused too, so a caller that
    // ignored the refusal would still get nothing.
    expect(askIn(twoTenants, "gamma", "org.unit.read", "chess").reason).toBe("NO_MEMBERSHIP")
  })
})
