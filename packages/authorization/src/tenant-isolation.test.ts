import { SEPARATION_OF_DUTIES, decide, effectivePermissions, type AuthorizationWorld } from "./index"

/**
 * GE-053-007 — "Tenant A/B cross-tenant tests deny every organization/seat/
 * membership/delegation/policy path."
 *
 * The trap this suite is built to catch is a coincidence. A test where tenant A
 * uses `club1` and tenant B uses `club2` passes whether or not anything checks
 * the tenant, because the identifiers never collide — so it proves the fixture
 * is tidy and nothing about isolation.
 *
 * Here the two tenants are deliberately indistinguishable except by tenant id.
 * `unit-1` exists in both. `req-1` exists in both. The role keys are the same
 * words. `cleo` is a member of both and holds different authority in each. Every
 * assertion below therefore fails if the tenant id stops being read on the path
 * it covers, and each of the five paths the requirement names has its own filter
 * in `decide`: memberships, grants, delegations, relationship grants, and the
 * policy context's tenant.
 *
 * One boundary stated rather than glossed: `roles`, `policies` and
 * `enabledModules` are properties of the world, not of a tenant, and a caller
 * builds one world per tenant (`seatWorld(ctx, tenantId, ...)` in `apps/web`).
 * This suite passes a single world carrying **both** tenants' rows, which is the
 * harder case — every row for the other tenant is present and must be ignored.
 */

const T = "2026-08-17T00:00:00Z"
const PAST = "2020-01-01T00:00:00Z"

const A = "alpha"
const B = "beta"

/** The same unit ids in both tenants. That is the point. */
const ANCESTORS: Record<string, string[]> = {
  "unit-1": ["division-1", "root"],
  "unit-2": ["division-1", "root"],
  "division-1": ["root"],
}

const ROLES = [
  { key: "seat.president", permissions: ["approvals.request.decide", "org.unit.read"] },
  { key: "seat.member", permissions: ["org.unit.read"] },
  { key: "office.director", permissions: ["admin.console.read", "approvals.request.decide"] },
  { key: "office.treasurer", permissions: ["finance.ledger.post"], minTier: "ledger" },
]

/**
 * One world, both tenants.
 *
 * `ada` is alpha-only and holds the oversight office there. `bo` is beta-only
 * and holds one unit. `cleo` is in both, president of `unit-1` in alpha and an
 * ordinary member of the identically-named `unit-1` in beta.
 */
const both = (over: Partial<AuthorizationWorld> = {}): AuthorizationWorld => ({
  principals: [{ id: "ada" }, { id: "bo" }, { id: "cleo" }],
  memberships: [
    { principalId: "ada", tenantId: A, state: "ACTIVE", effectiveFrom: PAST },
    { principalId: "bo", tenantId: B, state: "ACTIVE", effectiveFrom: PAST },
    { principalId: "cleo", tenantId: A, state: "ACTIVE", effectiveFrom: PAST },
    { principalId: "cleo", tenantId: B, state: "ACTIVE", effectiveFrom: PAST },
  ],
  roles: ROLES,
  grants: [
    { principalId: "ada", tenantId: A, roleKey: "office.director", scope: { kind: "tenant" }, state: "CONFIRMED", effectiveFrom: PAST },
    { principalId: "ada", tenantId: A, roleKey: "office.treasurer", scope: { kind: "tenant" }, state: "CONFIRMED", effectiveFrom: PAST },
    { principalId: "bo", tenantId: B, roleKey: "seat.member", scope: { kind: "orgUnit", orgUnitId: "unit-1" }, state: "CONFIRMED", effectiveFrom: PAST },
    { principalId: "cleo", tenantId: A, roleKey: "seat.president", scope: { kind: "orgUnit", orgUnitId: "unit-1" }, state: "CONFIRMED", effectiveFrom: PAST },
    { principalId: "cleo", tenantId: B, roleKey: "seat.member", scope: { kind: "orgUnit", orgUnitId: "unit-1" }, state: "CONFIRMED", effectiveFrom: PAST },
  ],
  ancestorsOf: (id) => ANCESTORS[id] ?? [],
  enabledModules: ["approvals", "organizations", "administration", "budgeting"],
  policies: [...SEPARATION_OF_DUTIES],
  entitlements: [
    { tenantId: A, tiers: { budgeting: ["budget", "ledger", "enterprise"] }, currentTier: { budgeting: "ledger" } },
    { tenantId: B, tiers: { budgeting: ["budget", "ledger", "enterprise"] }, currentTier: { budgeting: "budget" } },
  ],
  ...over,
})

const ask = (
  world: AuthorizationWorld,
  principalId: string,
  tenantId: string,
  permission: string,
  resource?: Parameters<typeof decide>[1]["resource"],
) => decide(world, { principalId, tenantId, permission, resource, at: T })

const unit = (orgUnitId: string, id = "req-1", createdByPrincipalId?: string) => ({
  type: "Request",
  id,
  orgUnitId,
  ...(createdByPrincipalId ? { createdByPrincipalId } : {}),
})

/* ────────────────────────────────────────────────────── membership path ── */

describe("GE-053-007 — the membership path", () => {
  it("denies a member of A asking in B", () => {
    const d = ask(both(), "ada", B, "admin.console.read")
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe("NO_MEMBERSHIP")
  })

  it("denies a member of B asking in A", () => {
    expect(ask(both(), "bo", A, "org.unit.read", unit("unit-1")).reason).toBe("NO_MEMBERSHIP")
  })

  it("still allows each of them at home, so the denials above are about the tenant", () => {
    expect(ask(both(), "ada", A, "admin.console.read").allowed).toBe(true)
    expect(ask(both(), "bo", B, "org.unit.read", unit("unit-1")).allowed).toBe(true)
  })

  it("does not let a membership of A satisfy a suspension in B", () => {
    // cleo is live in A and suspended in B. A lookup that ignored the tenant
    // would find the live row first and serve B from it.
    const suspended = both({
      memberships: [
        { principalId: "cleo", tenantId: A, state: "ACTIVE", effectiveFrom: PAST },
        { principalId: "cleo", tenantId: B, state: "SUSPENDED", effectiveFrom: PAST },
      ],
    })
    expect(ask(suspended, "cleo", B, "org.unit.read", unit("unit-1")).reason).toBe("MEMBERSHIP_NOT_ACTIVE")
    expect(ask(suspended, "cleo", A, "org.unit.read", unit("unit-1")).allowed).toBe(true)
  })
})

/* ────────────────────────────────────────── organization and seat paths ── */

describe("GE-053-007 — the organization and seat paths, with colliding unit ids", () => {
  it("does not answer a request about B's unit-1 from a seat in A's unit-1", () => {
    // Same person, same unit id, same permission, different tenant. cleo is
    // president in A and a plain member in B.
    expect(ask(both(), "cleo", A, "approvals.request.decide", unit("unit-1")).allowed).toBe(true)

    const d = ask(both(), "cleo", B, "approvals.request.decide", unit("unit-1"))
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe("NO_ROLE_GRANTING")
  })

  it("does not let a tenant-wide grant in A reach B", () => {
    // ada's office grant is `{ kind: "tenant" }`, which covers everything —
    // in the tenant it was granted in.
    const alsoInB = both({
      memberships: [
        ...both().memberships,
        { principalId: "ada", tenantId: B, state: "ACTIVE", effectiveFrom: PAST },
      ],
    })
    expect(ask(alsoInB, "ada", A, "admin.console.read").allowed).toBe(true)
    expect(ask(alsoInB, "ada", B, "admin.console.read").reason).toBe("NO_ROLE_GRANTING")
  })

  it("does not let ancestry in one tenant widen a grant in the other", () => {
    // `ancestorsOf` is a lookup by unit id with no tenant in it — one graph per
    // world. A grant on division-1 in A must still not answer for B, because
    // the grant row is filtered before ancestry is consulted at all.
    const divisionGrant = both({
      grants: [
        { principalId: "cleo", tenantId: A, roleKey: "seat.president", scope: { kind: "orgUnit", orgUnitId: "division-1" }, state: "CONFIRMED", effectiveFrom: PAST },
      ],
    })
    expect(ask(divisionGrant, "cleo", A, "approvals.request.decide", unit("unit-2")).allowed).toBe(true)
    expect(ask(divisionGrant, "cleo", B, "approvals.request.decide", unit("unit-2")).reason).toBe("NO_ROLE_GRANTING")
  })

  it("keeps the two capability sets different for the same person", () => {
    const inA = effectivePermissions(both(), "cleo", A, T)
    const inB = effectivePermissions(both(), "cleo", B, T)
    expect(inA.has("org.unit.read")).toBe(false) // org-scoped: answered per resource
    expect(inB.has("org.unit.read")).toBe(false)
    // ada's office role is tenant-scoped, so it is answerable without a
    // resource — and only in alpha.
    expect(effectivePermissions(both(), "ada", A, T).has("admin.console.read")).toBe(true)
    expect(effectivePermissions(both(), "ada", B, T).size).toBe(0)
  })
})

/* ─────────────────────────────────────────────────────── delegation path ── */

describe("GE-053-007 — the delegation path", () => {
  it("does not let a delegation written in A act in B", () => {
    const crossed = both({
      delegations: [{ fromPrincipalId: "ada", toPrincipalId: "cleo", tenantId: A, effectiveFrom: PAST }],
    })
    // In A the delegation works: cleo borrows ada's office authority.
    expect(ask(crossed, "cleo", A, "admin.console.read").allowed).toBe(true)
    // In B the same row is not read at all.
    expect(ask(crossed, "cleo", B, "admin.console.read").reason).toBe("NO_ROLE_GRANTING")
  })

  it("does not let A's delegation reach the delegator's authority in B", () => {
    // The sharpest version of the delegation path, and the only one that
    // isolates the filter on the delegation row itself. In the case above the
    // grant filter is doing the work: the delegator has nothing in B, so the
    // delegation confers nothing whether or not its own tenant is checked.
    //
    // Here the delegator genuinely holds the office in **both** tenants and the
    // delegation names only A. The grant filter finds a real grant in B, so the
    // only thing standing between cleo and B's oversight console is the tenant
    // on the delegation row.
    const bothOffices = both({
      memberships: [
        ...both().memberships,
        { principalId: "ada", tenantId: B, state: "ACTIVE", effectiveFrom: PAST },
      ],
      grants: [
        ...both().grants,
        { principalId: "ada", tenantId: B, roleKey: "office.director", scope: { kind: "tenant" }, state: "CONFIRMED", effectiveFrom: PAST },
      ],
      delegations: [{ fromPrincipalId: "ada", toPrincipalId: "cleo", tenantId: A, effectiveFrom: PAST }],
    })
    expect(ask(bothOffices, "cleo", A, "admin.console.read").allowed).toBe(true)
    expect(ask(bothOffices, "cleo", B, "admin.console.read").reason).toBe("NO_ROLE_GRANTING")
  })

  it("confers nothing from a delegation in B whose delegator's authority is in A", () => {
    // The row names tenant B, so it is read; the intersection with what ada
    // holds *in B* is empty. Both halves have to hold or a delegation becomes a
    // way to import authority across the boundary.
    const importAttempt = both({
      memberships: [
        ...both().memberships,
        { principalId: "ada", tenantId: B, state: "ACTIVE", effectiveFrom: PAST },
      ],
      delegations: [{ fromPrincipalId: "ada", toPrincipalId: "cleo", tenantId: B, effectiveFrom: PAST }],
    })
    expect(ask(importAttempt, "cleo", B, "admin.console.read").reason).toBe("NO_ROLE_GRANTING")
  })

  it("does not let a delegate who is not a member of the tenant act in it", () => {
    // bo belongs to B only. A delegation in A naming bo dies at membership,
    // before any borrowed authority is considered.
    const toOutsider = both({
      delegations: [{ fromPrincipalId: "ada", toPrincipalId: "bo", tenantId: A, effectiveFrom: PAST }],
    })
    expect(ask(toOutsider, "bo", A, "admin.console.read").reason).toBe("NO_MEMBERSHIP")
  })
})

/* ───────────────────────────────────────────────────── relationship path ── */

describe("GE-053-007 — the relationship path", () => {
  const advisorIn = (relTenant: string, grantTenant: string): AuthorizationWorld =>
    both({
      relationships: [
        { type: "ADVISES", fromPrincipalId: "cleo", tenantId: relTenant, toOrgUnitId: "unit-1", effectiveFrom: PAST },
      ],
      relationshipGrants: [{ tenantId: grantTenant, via: "ADVISES", roleKey: "office.director", scope: "related" }],
    })

  it("confers the conferred role when both the relationship and the grant are in the asking tenant", () => {
    expect(ask(advisorIn(A, A), "cleo", A, "admin.console.read", unit("unit-1")).allowed).toBe(true)
  })

  it("denies when the relationship is recorded in the other tenant", () => {
    expect(ask(advisorIn(B, A), "cleo", A, "admin.console.read", unit("unit-1")).allowed).toBe(false)
  })

  it("denies when the relationship grant belongs to the other tenant", () => {
    expect(ask(advisorIn(A, B), "cleo", A, "admin.console.read", unit("unit-1")).allowed).toBe(false)
  })
})

/* ────────────────────────────────────────────────────────── policy path ── */

describe("GE-053-007 — the policy path", () => {
  it("applies separation of duties identically in both tenants", () => {
    // A control that only holds in the tenant it was first tested in is the
    // failure mode of a generality fixture. cleo may decide in A, and not on
    // their own request in A.
    const own = unit("unit-1", "req-1", "cleo")
    expect(ask(both(), "cleo", A, "approvals.request.decide", own).reason).toBe("SEPARATION_OF_DUTIES")

    const presidentInB = both({
      grants: [
        { principalId: "cleo", tenantId: B, roleKey: "seat.president", scope: { kind: "orgUnit", orgUnitId: "unit-1" }, state: "CONFIRMED", effectiveFrom: PAST },
      ],
    })
    expect(ask(presidentInB, "cleo", B, "approvals.request.decide", own).reason).toBe("SEPARATION_OF_DUTIES")
  })

  it("gives a policy the tenant of the request, not of the resource", () => {
    // A policy that scopes itself by tenant must see the tenant being asked
    // about. Presenting the other tenant's id cannot be a way past a deny.
    const seen: string[] = []
    const recording = both({
      policies: [
        {
          id: "test.records-tenant",
          permission: "approvals.request.decide",
          effect: "deny",
          description: "Records the tenant it was asked about.",
          condition: (ctx) => {
            seen.push(ctx.tenantId)
            return ctx.tenantId === B
          },
        },
      ],
    })
    expect(ask(recording, "cleo", A, "approvals.request.decide", unit("unit-1")).allowed).toBe(true)
    expect(seen).toEqual([A])
  })

  it("denies in B for a tier B has not bought, while A keeps it", () => {
    // Entitlements are per tenant and the comparison is by rank. A tenant that
    // shares a world with a higher-tier one must not inherit its tier.
    const treasurerInBoth = both({
      memberships: [
        ...both().memberships,
        { principalId: "ada", tenantId: B, state: "ACTIVE", effectiveFrom: PAST },
      ],
      grants: [
        { principalId: "ada", tenantId: A, roleKey: "office.treasurer", scope: { kind: "tenant" }, state: "CONFIRMED", effectiveFrom: PAST },
        { principalId: "ada", tenantId: B, roleKey: "office.treasurer", scope: { kind: "tenant" }, state: "CONFIRMED", effectiveFrom: PAST },
      ],
    })
    expect(ask(treasurerInBoth, "ada", A, "finance.ledger.post").allowed).toBe(true)
    expect(ask(treasurerInBoth, "ada", B, "finance.ledger.post").reason).toBe("TIER_TOO_LOW")
  })
})

/* ──────────────────────────────────────────────────────── the whole sweep ── */

describe("GE-053-007 — no permission crosses, for anybody", () => {
  it("gives every principal in the other tenant nothing at all", () => {
    // The sweep, not a sample. `effectivePermissions` runs `decide` for every
    // permission any role in the world claims, so this is 1 principal x 2
    // tenants x the whole role vocabulary.
    const world = both()
    expect(effectivePermissions(world, "ada", B, T).size).toBe(0)
    expect(effectivePermissions(world, "bo", A, T).size).toBe(0)
  })

  it("names the same unit in both tenants, so the fixture cannot pass by accident", () => {
    // Guarding the guard. If somebody renames B's units later, every assertion
    // above still passes and none of them means anything.
    const unitsInA = both().grants.filter((g) => g.tenantId === A && g.scope.kind === "orgUnit")
    const unitsInB = both().grants.filter((g) => g.tenantId === B && g.scope.kind === "orgUnit")
    const idsOf = (grants: typeof unitsInA) =>
      new Set(grants.map((g) => (g.scope.kind === "orgUnit" ? g.scope.orgUnitId : "")))
    expect(idsOf(unitsInA)).toEqual(idsOf(unitsInB))
    expect(idsOf(unitsInA).has("unit-1")).toBe(true)
  })
})
