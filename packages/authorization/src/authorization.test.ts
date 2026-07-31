import {
  DENY_REASONS,
  SEPARATION_OF_DUTIES,
  decide,
  effectivePermissions,
  type AuthorizationWorld,
  type Policy,
} from "./index"

const T = "2026-07-31T00:00:00Z"
const PAST = "2020-01-01T00:00:00Z"
const FUTURE = "2030-01-01T00:00:00Z"

/** club1 sits under school1, which sits under the tenant root. */
const ANCESTORS: Record<string, string[]> = {
  club1: ["school1", "root"],
  club2: ["school1", "root"],
  school1: ["root"],
}

const ROLES = [
  { key: "member", permissions: ["organizations.view"] },
  { key: "president", permissions: ["organizations.view", "approvals.decide", "organizations.manageRoster"] },
  { key: "oseDirector", permissions: ["organizations.view", "approvals.decide", "institution.administer"] },
  { key: "financeOfficer", permissions: ["budgeting.manage"], minTier: "budget" },
  { key: "ledgerOfficer", permissions: ["budgeting.post"], minTier: "ledger" },
]

const base = (over: Partial<AuthorizationWorld> = {}): AuthorizationWorld => ({
  principals: [{ id: "pres" }, { id: "member" }, { id: "director" }, { id: "backup" }, { id: "gone" }],
  memberships: [
    { principalId: "pres", tenantId: "t1", state: "ACTIVE", effectiveFrom: PAST },
    { principalId: "member", tenantId: "t1", state: "ACTIVE", effectiveFrom: PAST },
    { principalId: "director", tenantId: "t1", state: "ACTIVE", effectiveFrom: PAST },
    { principalId: "backup", tenantId: "t1", state: "ACTIVE", effectiveFrom: PAST },
    { principalId: "gone", tenantId: "t1", state: "LEFT", effectiveFrom: PAST },
  ],
  roles: ROLES,
  grants: [
    { principalId: "pres", tenantId: "t1", roleKey: "president", scope: { kind: "orgUnit", orgUnitId: "club1" }, state: "CONFIRMED", effectiveFrom: PAST },
    { principalId: "member", tenantId: "t1", roleKey: "member", scope: { kind: "orgUnit", orgUnitId: "club1" }, state: "CONFIRMED", effectiveFrom: PAST },
    { principalId: "director", tenantId: "t1", roleKey: "oseDirector", scope: { kind: "tenant" }, state: "CONFIRMED", effectiveFrom: PAST },
    { principalId: "gone", tenantId: "t1", roleKey: "president", scope: { kind: "tenant" }, state: "CONFIRMED", effectiveFrom: PAST },
  ],
  ancestorsOf: (id) => ANCESTORS[id] ?? [],
  enabledModules: ["organizations", "approvals", "budgeting", "institution"],
  policies: [...SEPARATION_OF_DUTIES],
  ...over,
})

const ask = (world: AuthorizationWorld, principalId: string, permission: string, resource?: Parameters<typeof decide>[1]["resource"]) =>
  decide(world, { principalId, tenantId: "t1", permission, resource, at: T })

// ── the checks the architecture's SQL omits ─────────────────────────────────

describe("membership state and principal status beat every grant", () => {
  it("denies a member who has LEFT, despite a confirmed tenant-wide role", () => {
    // The architecture's `grants` CTE filters on assignment state and dates and
    // never joins membership, so this person keeps every capability there.
    const d = ask(base(), "gone", "approvals.decide")
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe("MEMBERSHIP_NOT_ACTIVE")
  })

  it("denies a suspended member, and the reason is reachable", () => {
    // MEMBERSHIP_SUSPENDED ships in the architecture as a deny reason with no
    // code path that can produce it. This one is produced.
    const world = base({
      memberships: [{ principalId: "pres", tenantId: "t1", state: "SUSPENDED", effectiveFrom: PAST }],
    })
    expect(ask(world, "pres", "organizations.view").reason).toBe("MEMBERSHIP_NOT_ACTIVE")
  })

  it("denies a disabled principal everything", () => {
    const world = base({ principals: [{ id: "director", disabledAt: PAST }] })
    expect(ask(world, "director", "institution.administer").reason).toBe("PRINCIPAL_DISABLED")
  })

  it("denies a principal who is not a member of the tenant at all", () => {
    const world = base({ memberships: [] })
    expect(ask(world, "pres", "organizations.view").reason).toBe("NO_MEMBERSHIP")
  })

  it("denies an unknown principal", () => {
    expect(ask(base(), "nobody", "organizations.view").reason).toBe("NO_PRINCIPAL")
  })

  it("denies a membership that has not started or has ended", () => {
    const notYet = base({
      memberships: [{ principalId: "pres", tenantId: "t1", state: "ACTIVE", effectiveFrom: FUTURE }],
    })
    expect(ask(notYet, "pres", "organizations.view").reason).toBe("MEMBERSHIP_NOT_ACTIVE")
  })
})

// ── roles and scope ─────────────────────────────────────────────────────────

describe("roles grant, and scope bounds what they grant over", () => {
  const world = base()

  it("allows a president to decide on their own club", () => {
    const d = ask(world, "pres", "approvals.decide", { type: "ApprovalRequest", id: "a1", orgUnitId: "club1" })
    expect(d.allowed).toBe(true)
    expect(d.viaRoles).toEqual(["president"])
  })

  it("denies the same president on a different club", () => {
    const d = ask(world, "pres", "approvals.decide", { type: "ApprovalRequest", id: "a2", orgUnitId: "club2" })
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe("OUT_OF_SCOPE")
  })

  it("inherits downward: a tenant-wide grant reaches every club", () => {
    expect(
      ask(world, "director", "approvals.decide", { type: "ApprovalRequest", id: "a2", orgUnitId: "club2" }).allowed,
    ).toBe(true)
  })

  it("inherits downward from a school, not upward from a club", () => {
    // A grant on school1 covers club1. The reverse would let a club officer act
    // on the whole school, which is the direction that matters.
    const schoolScoped = base({
      grants: [
        { principalId: "pres", tenantId: "t1", roleKey: "president", scope: { kind: "orgUnit", orgUnitId: "school1" }, state: "CONFIRMED", effectiveFrom: PAST },
      ],
    })
    expect(ask(schoolScoped, "pres", "approvals.decide", { type: "R", id: "1", orgUnitId: "club1" }).allowed).toBe(true)

    const clubScoped = base({
      grants: [
        { principalId: "pres", tenantId: "t1", roleKey: "president", scope: { kind: "orgUnit", orgUnitId: "club1" }, state: "CONFIRMED", effectiveFrom: PAST },
      ],
    })
    expect(ask(clubScoped, "pres", "approvals.decide", { type: "R", id: "1", orgUnitId: "school1" }).reason).toBe("OUT_OF_SCOPE")
  })

  it("denies a role nobody holds conferring the permission", () => {
    expect(ask(world, "member", "approvals.decide", { type: "R", id: "1", orgUnitId: "club1" }).reason).toBe(
      "NO_ROLE_GRANTING",
    )
  })

  it("denies an unconfirmed or expired grant, distinctly from having no role", () => {
    const pending = base({
      grants: [
        { principalId: "pres", tenantId: "t1", roleKey: "president", scope: { kind: "tenant" }, state: "PENDING", effectiveFrom: PAST },
      ],
    })
    expect(ask(pending, "pres", "approvals.decide").reason).toBe("GRANT_NOT_CONFIRMED")

    const expired = base({
      grants: [
        { principalId: "pres", tenantId: "t1", roleKey: "president", scope: { kind: "tenant" }, state: "CONFIRMED", effectiveFrom: PAST, effectiveTo: "2026-01-01T00:00:00Z" },
      ],
    })
    expect(ask(expired, "pres", "approvals.decide").reason).toBe("GRANT_NOT_CONFIRMED")
  })

  it("refuses an org-scoped grant to authorise a resource with no org unit", () => {
    expect(ask(world, "pres", "approvals.decide", { type: "R", id: "1" }).reason).toBe("OUT_OF_SCOPE")
  })
})

// ── modules and tiers ───────────────────────────────────────────────────────

describe("a permission from a module the system does not run is denied", () => {
  it("denies it with that reason", () => {
    const world = base({ enabledModules: ["organizations"] })
    expect(ask(world, "director", "approvals.decide").reason).toBe("MODULE_NOT_ENABLED")
  })

  it("does not module-gate a platform-level permission", () => {
    const world = base({
      enabledModules: [],
      roles: [{ key: "r", permissions: ["ping"] }],
      grants: [{ principalId: "pres", tenantId: "t1", roleKey: "r", scope: { kind: "tenant" }, state: "CONFIRMED", effectiveFrom: PAST }],
    })
    expect(ask(world, "pres", "ping").allowed).toBe(true)
  })
})

describe("tiers compare by rank, so upgrading never revokes", () => {
  const financeWorld = (currentTier: string) =>
    base({
      grants: [
        { principalId: "pres", tenantId: "t1", roleKey: "financeOfficer", scope: { kind: "tenant" }, state: "CONFIRMED", effectiveFrom: PAST },
      ],
      entitlements: [
        {
          tenantId: "t1",
          tiers: { budgeting: ["budget", "ledger", "consolidation"] },
          currentTier: { budgeting: currentTier },
        },
      ],
    })

  it("allows a budget-tier permission on the budget tier", () => {
    expect(ask(financeWorld("budget"), "pres", "budgeting.manage").allowed).toBe(true)
  })

  it("STILL allows it after upgrading to a higher tier", () => {
    // String equality — `i.tier = c.min_tier OR i.tier = 'enterprise'` — makes
    // this deny, so selling the upgrade 404s the budgets UI.
    expect(ask(financeWorld("ledger"), "pres", "budgeting.manage").allowed).toBe(true)
    expect(ask(financeWorld("consolidation"), "pres", "budgeting.manage").allowed).toBe(true)
  })

  it("denies a permission above the tenant's tier, and names both tiers", () => {
    const w = base({
      grants: [
        { principalId: "pres", tenantId: "t1", roleKey: "ledgerOfficer", scope: { kind: "tenant" }, state: "CONFIRMED", effectiveFrom: PAST },
      ],
      entitlements: [
        { tenantId: "t1", tiers: { budgeting: ["budget", "ledger"] }, currentTier: { budgeting: "budget" } },
      ],
    })
    const d = ask(w, "pres", "budgeting.post")
    expect(d.reason).toBe("TIER_TOO_LOW")
    expect(d.detail).toContain('tier "ledger"')
    expect(d.detail).toContain('"budget"')
  })
})

// ── delegation ──────────────────────────────────────────────────────────────

describe("delegation borrows authority and cannot widen it", () => {
  const delegated = (over = {}) =>
    base({
      delegations: [{ fromPrincipalId: "pres", toPrincipalId: "backup", tenantId: "t1", effectiveFrom: PAST, ...over }],
    })

  it("lets a backup act with the delegator's authority", () => {
    const d = ask(delegated(), "backup", "approvals.decide", { type: "R", id: "1", orgUnitId: "club1" })
    expect(d.allowed).toBe(true)
    expect(d.viaDelegationFrom).toBe("pres")
  })

  it("is bounded by the delegator's own scope, not widened by delegation", () => {
    expect(
      ask(delegated(), "backup", "approvals.decide", { type: "R", id: "1", orgUnitId: "club2" }).allowed,
    ).toBe(false)
  })

  it("ends the moment the delegator's grant does — with no second write", () => {
    const revoked = base({
      grants: [
        { principalId: "pres", tenantId: "t1", roleKey: "president", scope: { kind: "orgUnit", orgUnitId: "club1" }, state: "REVOKED", effectiveFrom: PAST },
      ],
      delegations: [{ fromPrincipalId: "pres", toPrincipalId: "backup", tenantId: "t1", effectiveFrom: PAST }],
    })
    expect(ask(revoked, "backup", "approvals.decide", { type: "R", id: "1", orgUnitId: "club1" }).allowed).toBe(false)
  })

  it("respects an expired delegation", () => {
    const expired = delegated({ effectiveTo: "2026-01-01T00:00:00Z" })
    expect(ask(expired, "backup", "approvals.decide", { type: "R", id: "1", orgUnitId: "club1" }).allowed).toBe(false)
  })

  it("respects a delegation narrowed to specific permissions", () => {
    const narrow = delegated({ permissions: ["organizations.view"] })
    expect(ask(narrow, "backup", "approvals.decide", { type: "R", id: "1", orgUnitId: "club1" }).allowed).toBe(false)
    expect(ask(narrow, "backup", "organizations.view", { type: "R", id: "1", orgUnitId: "club1" }).allowed).toBe(true)
  })
})

// ── separation of duties ────────────────────────────────────────────────────

describe("separation of duties is declared once, not at four call sites", () => {
  it("stops a president deciding their own request", () => {
    const d = ask(base(), "pres", "approvals.decide", {
      type: "ApprovalRequest",
      id: "a1",
      orgUnitId: "club1",
      createdByPrincipalId: "pres",
    })
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe("SEPARATION_OF_DUTIES")
    expect(d.detail).toContain("cannot be decided by the person who raised it")
  })

  it("still lets them decide someone else's", () => {
    expect(
      ask(base(), "pres", "approvals.decide", {
        type: "ApprovalRequest",
        id: "a1",
        orgUnitId: "club1",
        createdByPrincipalId: "member",
      }).allowed,
    ).toBe(true)
  })

  it("applies to the director too — authority does not exempt", () => {
    expect(
      ask(base(), "director", "approvals.decide", {
        type: "ApprovalRequest",
        id: "a1",
        orgUnitId: "club1",
        createdByPrincipalId: "director",
      }).reason,
    ).toBe("SEPARATION_OF_DUTIES")
  })

  it("lets deny beat allow, whatever the order", () => {
    const alwaysAllow: Policy = {
      id: "test.allowEverything",
      permission: "*",
      effect: "allow",
      description: "Would allow anything.",
      condition: () => true,
    }
    const world = base({ policies: [alwaysAllow, ...SEPARATION_OF_DUTIES] })
    expect(
      ask(world, "pres", "approvals.decide", {
        type: "ApprovalRequest",
        id: "a1",
        orgUnitId: "club1",
        createdByPrincipalId: "pres",
      }).allowed,
    ).toBe(false)
  })
})

// ── explainability and the capability set ───────────────────────────────────

describe("a decision explains itself", () => {
  it("traces every step that was checked, in order", () => {
    const d = ask(base(), "director", "approvals.decide", { type: "R", id: "1", orgUnitId: "club1" })
    expect(d.trace.map((s) => s.step)).toEqual(["principal", "membership", "module", "grant", "policy"])
    expect(d.trace.every((s) => s.detail.length > 0)).toBe(true)
  })

  it("names the failing step when it denies", () => {
    const d = ask(base(), "member", "approvals.decide", { type: "R", id: "1", orgUnitId: "club1" })
    expect(d.trace[d.trace.length - 1]).toMatchObject({ step: "NO_ROLE_GRANTING", outcome: "fail" })
  })

  it("uses only declared deny reasons", () => {
    const reasons = [
      ask(base(), "nobody", "x"),
      ask(base(), "gone", "approvals.decide"),
      ask(base(), "member", "approvals.decide", { type: "R", id: "1", orgUnitId: "club1" }),
      ask(base({ enabledModules: [] }), "director", "approvals.decide"),
    ].map((d) => d.reason)
    for (const r of reasons) expect(DENY_REASONS).toContain(r)
  })
})

describe("the capability set is the same engine the routes use", () => {
  it("lists what a director effectively holds", () => {
    const caps = effectivePermissions(base(), "director", "t1", T)
    expect(caps.has("institution.administer")).toBe(true)
    expect(caps.has("organizations.view")).toBe(true)
  })

  it("gives a plain member almost nothing", () => {
    const caps = effectivePermissions(base(), "member", "t1", T)
    expect(caps.has("institution.administer")).toBe(false)
    expect(caps.has("approvals.decide")).toBe(false)
  })

  it("gives someone who has left nothing at all", () => {
    expect(effectivePermissions(base(), "gone", "t1", T).size).toBe(0)
  })

  it("omits org-scoped permissions, because a menu is not an authorization", () => {
    // The president's grant is scoped to club1, so it cannot be answered without
    // a resource. decide() answers it per resource; the capability set does not
    // pretend to.
    const caps = effectivePermissions(base(), "pres", "t1", T)
    expect(caps.has("approvals.decide")).toBe(false)
    expect(
      ask(base(), "pres", "approvals.decide", { type: "R", id: "1", orgUnitId: "club1" }).allowed,
    ).toBe(true)
  })
})
