import {
  DENY_REASONS,
  PERMISSIONS,
  decide,
  effectivePermissions,
  lookupPermission,
  type AuthorizationWorld,
  type Policy,
} from "./index"

/**
 * GE-053-001 — "Unknown action/resource/condition denies by default."
 *
 * Three separate things, and before this suite the engine got one of them right.
 *
 *   **Action.** A permission key the catalog does not declare is refused at the
 *   module gate rather than treated as platform-level. That was already true
 *   (`decide` returns UNKNOWN_PERMISSION); what was missing is a test that says
 *   so for every *shape* of unknown key, and — the part that matters — with the
 *   unknown key sitting inside a role the principal actually holds at tenant
 *   scope. Otherwise the denial is being produced by the absence of a grant and
 *   the catalog gate is untested.
 *
 *   **Resource.** A `related`-scoped relationship grant asked about *no*
 *   resource used to match any live relationship of its type, because the
 *   query was built with no target constraint. `scope: "related"` exists
 *   precisely so an advisor of one club is not an advisor of all of them, and
 *   this was that widening reached through a different door — including from
 *   `effectivePermissions`, which asks with no resource and therefore listed
 *   every relationship-conferred permission as if it were held everywhere.
 *
 *   **Condition.** A deny policy whose condition threw took the whole decision
 *   down (a thrown error is not a denial: nothing is audited, and the retry may
 *   be served from a cache), and one that answered with anything other than a
 *   boolean was falsy and therefore an allow. Both collapse "we could not look"
 *   into "we looked and found nothing", which is the defect this codebase names
 *   most often.
 */

const T = "2026-08-17T00:00:00Z"
const PAST = "2020-01-01T00:00:00Z"

/** club1 and club2 sit under school1. "ghost" is in the graph nowhere. */
const ANCESTORS: Record<string, string[]> = {
  club1: ["school1", "root"],
  club2: ["school1", "root"],
  school1: ["root"],
}

/**
 * A role carrying one real permission and one the catalog has never heard of.
 *
 * The made-up key is held at **tenant** scope, confirmed, by an active member of
 * an enabled system. Every reason to deny except the catalog has been removed,
 * so a test that still sees a denial is watching the catalog gate and nothing
 * else.
 */
const ROLES = [
  {
    key: "everything",
    permissions: [
      "finance.budget.read",
      "org.unit.read",
      "made.up.key",
      "finance.spaceship.read",
      "finance.budget.rubberstamp",
      "sorcery.budget.read",
      "finance.treasurer.approve",
      "admin",
      "",
      "*",
      "finance.budget.*",
      "Finance.Budget.Read",
      " finance.budget.read ",
    ],
  },
]

const base = (over: Partial<AuthorizationWorld> = {}): AuthorizationWorld => ({
  principals: [{ id: "dana" }],
  memberships: [{ principalId: "dana", tenantId: "t1", state: "ACTIVE", effectiveFrom: PAST }],
  roles: ROLES,
  grants: [
    {
      principalId: "dana",
      tenantId: "t1",
      roleKey: "everything",
      scope: { kind: "tenant" },
      state: "CONFIRMED",
      effectiveFrom: PAST,
    },
  ],
  ancestorsOf: (id) => ANCESTORS[id] ?? [],
  enabledModules: ["budgeting", "organizations", "administration", "approvals"],
  ...over,
})

const ask = (
  world: AuthorizationWorld,
  permission: string,
  resource?: Parameters<typeof decide>[1]["resource"],
) => decide(world, { principalId: "dana", tenantId: "t1", permission, resource, at: T })

/* ─────────────────────────────────────────────────── unknown action/key ── */

describe("GE-053-001 — an unknown permission key denies, whatever shape it takes", () => {
  /**
   * Each of these is held by the principal at tenant scope. The only thing
   * wrong with any of them is that the catalog does not declare it.
   */
  const unknown: readonly [string, string][] = [
    ["made.up.key", "a key from nowhere"],
    ["finance.spaceship.read", "a real domain and action, unknown resource segment"],
    ["finance.budget.rubberstamp", "a real domain and resource, unknown action segment"],
    ["sorcery.budget.read", "an unknown domain segment"],
    ["finance.treasurer.approve", "a role title where a resource belongs"],
    ["admin", "a bare word with no dots at all"],
    ["", "the empty string"],
    ["*", "a wildcard"],
    ["finance.budget.*", "a wildcard tail"],
    ["Finance.Budget.Read", "the right key in the wrong case"],
    [" finance.budget.read ", "the right key with whitespace around it"],
  ]

  for (const [permission, why] of unknown) {
    it(`denies ${why} (${JSON.stringify(permission)})`, () => {
      const d = ask(base(), permission)
      expect(d.allowed).toBe(false)
      expect(d.reason).toBe("UNKNOWN_PERMISSION")
    })
  }

  it("allows the one key in that role the catalog does declare", () => {
    // Without this the suite above would pass against a world where nothing is
    // allowed for some unrelated reason, and prove nothing about the catalog.
    expect(ask(base(), "finance.budget.read").allowed).toBe(true)
  })

  it("denies a bare word rather than treating it as platform-level", () => {
    // The specific old defect: the module was derived from the text before the
    // first dot, so a key with no dot skipped the module gate entirely.
    const d = ask(base({ enabledModules: [] }), "admin")
    expect(d.reason).toBe("UNKNOWN_PERMISSION")
    expect(d.detail).toMatch(/not in the permission catalog/)
  })

  it("keeps unknown keys out of the capability set, even when a held role names them", () => {
    // `effectivePermissions` iterates the permissions the roles claim. A gate
    // that only ran on the per-resource path would leave the menu wider than
    // the routes.
    const caps = effectivePermissions(base(), "dana", "t1", T)
    for (const [permission] of unknown) expect(caps.has(permission)).toBe(false)
    expect(caps.has("finance.budget.read")).toBe(true)
    for (const key of caps) expect(lookupPermission(key)).not.toBeNull()
  })

  it("declares every catalog key exactly once, so no key is unreachable", () => {
    // A duplicate would make one of the two definitions dead, and the dead one
    // might be the one with the module gate.
    const keys = PERMISSIONS.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

/* ────────────────────────────────────────────────────── unknown resource ── */

describe("GE-053-001 — a resource the request does not identify denies", () => {
  const advising = (over: Partial<AuthorizationWorld> = {}): AuthorizationWorld =>
    base({
      grants: [],
      roles: [{ key: "advisor", permissions: ["finance.budget.read"] }],
      relationships: [
        {
          type: "ADVISES",
          fromPrincipalId: "dana",
          tenantId: "t1",
          toOrgUnitId: "club1",
          effectiveFrom: PAST,
        },
      ],
      relationshipGrants: [
        { tenantId: "t1", via: "ADVISES", roleKey: "advisor", scope: "related" },
      ],
      ...over,
    })

  it("confers the related role on the unit actually advised", () => {
    expect(ask(advising(), "finance.budget.read", { type: "Budget", id: "b1", orgUnitId: "club1" }).allowed).toBe(true)
  })

  it("denies a related-scoped role when the request names no resource", () => {
    // THE DEFECT. With no resource the relationship query carried no target, so
    // any live ADVISES matched and the role landed as if granted tenant-wide.
    const d = ask(advising(), "finance.budget.read")
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe("NO_ROLE_GRANTING")
    expect(d.trace.some((s) => s.step === "relationship")).toBe(true)
  })

  it("keeps a related-scoped role out of the capability set", () => {
    // The menu is not an authorization, and this is the path that made it one.
    expect(effectivePermissions(advising(), "dana", "t1", T).has("finance.budget.read")).toBe(false)
  })

  it("still confers a tenant-scoped relationship grant with no resource", () => {
    // The fix must bound `related`, not relationship grants generally.
    const wide = advising({
      relationshipGrants: [{ tenantId: "t1", via: "ADVISES", roleKey: "advisor", scope: "tenant" }],
    })
    expect(ask(wide, "finance.budget.read").allowed).toBe(true)
  })

  it("denies a resource in an org unit the graph has never heard of", () => {
    // An unknown unit must not be silently treated as a descendant of whatever
    // the grant covers. `ancestorsOf` answers [] and [] contains nothing.
    const clubScoped = base({
      grants: [
        {
          principalId: "dana",
          tenantId: "t1",
          roleKey: "everything",
          scope: { kind: "orgUnit", orgUnitId: "club1" },
          state: "CONFIRMED",
          effectiveFrom: PAST,
        },
      ],
    })
    expect(ask(clubScoped, "finance.budget.read", { type: "Budget", id: "b1", orgUnitId: "ghost" }).reason).toBe(
      "OUT_OF_SCOPE",
    )
  })

  it("denies a resource with no org unit against an org-scoped grant", () => {
    const clubScoped = base({
      grants: [
        {
          principalId: "dana",
          tenantId: "t1",
          roleKey: "everything",
          scope: { kind: "orgUnit", orgUnitId: "club1" },
          state: "CONFIRMED",
          effectiveFrom: PAST,
        },
      ],
    })
    expect(ask(clubScoped, "finance.budget.read", { type: "Budget", id: "b1" }).reason).toBe("OUT_OF_SCOPE")
  })
})

/* ───────────────────────────────────────────────────── unknown condition ── */

describe("GE-053-001 — a deny policy that cannot be evaluated denies", () => {
  const withPolicy = (policy: Policy) => base({ policies: [policy] })

  const policy = (over: Partial<Policy>): Policy => ({
    id: "test.unreadable",
    permission: "finance.budget.read",
    effect: "deny",
    description: "Refuses when the thing it reads is absent.",
    condition: () => false,
    ...over,
  })

  it("denies when the condition throws", () => {
    const d = ask(
      withPolicy(
        policy({
          condition: (ctx) => {
            // The realistic shape: a condition reading a nested attribute the
            // caller did not supply.
            const nested = ctx.resource!.attributes!["amount"] as number
            return nested > 100
          },
        }),
      ),
      "finance.budget.read",
    )
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe("POLICY_INDETERMINATE")
    expect(d.detail).toMatch(/could not be evaluated/)
  })

  it("denies when the condition answers undefined", () => {
    const d = ask(
      withPolicy(policy({ condition: (() => undefined) as unknown as Policy["condition"] })),
      "finance.budget.read",
    )
    expect(d.reason).toBe("POLICY_INDETERMINATE")
    expect(d.detail).toMatch(/undefined/)
  })

  it("denies when the condition answers a truthy non-boolean", () => {
    // Fails closed in both directions on purpose. A truthy string used to fire
    // the deny, which happened to be safe; a Promise from an accidentally-async
    // condition is also truthy and fires it for the wrong reason. Neither is an
    // answer, so neither is treated as one.
    const d = ask(
      withPolicy(policy({ condition: (() => Promise.resolve(false)) as unknown as Policy["condition"] })),
      "finance.budget.read",
    )
    expect(d.reason).toBe("POLICY_INDETERMINATE")
    expect(d.detail).toMatch(/not a boolean/)
  })

  it("does not deny when the condition answers false properly", () => {
    // The fix must not turn every policy into a refusal. This is the case the
    // engine has to keep getting right.
    const d = ask(withPolicy(policy({ condition: () => false })), "finance.budget.read")
    expect(d.allowed).toBe(true)
  })

  it("still denies when the condition answers true properly", () => {
    const d = ask(withPolicy(policy({ condition: () => true })), "finance.budget.read")
    expect(d.reason).toBe("POLICY_DENIED")
  })

  it("does not evaluate a policy for another permission at all", () => {
    // A throwing condition attached to a different permission must not take
    // down an unrelated decision.
    const other = policy({
      permission: "org.unit.read",
      condition: () => {
        throw new Error("should never run")
      },
    })
    expect(ask(withPolicy(other), "finance.budget.read").allowed).toBe(true)
  })

  it("evaluates a wildcard policy, and an unreadable wildcard denies everything it covers", () => {
    const everywhere = policy({
      id: "test.wildcard",
      permission: "*",
      condition: () => {
        throw new Error("nothing to read")
      },
    })
    expect(ask(withPolicy(everywhere), "finance.budget.read").reason).toBe("POLICY_INDETERMINATE")
    expect(ask(withPolicy(everywhere), "org.unit.read").reason).toBe("POLICY_INDETERMINATE")
  })

  it("ignores an allow-effect policy, which decide never consults", () => {
    // Documented rather than assumed: only deny policies are read, so a
    // throwing allow condition is not a denial and not a crash either.
    const allowing = policy({
      id: "test.allow",
      effect: "allow",
      condition: () => {
        throw new Error("never consulted")
      },
    })
    expect(ask(withPolicy(allowing), "finance.budget.read").allowed).toBe(true)
  })
})

/* ─────────────────────────────────────────────────────────── the reasons ── */

describe("GE-053-001 — the reasons this suite produces are declared", () => {
  it("uses only declared deny reasons", () => {
    const produced = [
      ask(base(), "made.up.key").reason,
      ask(
        base({
          policies: [
            {
              id: "test.throws",
              permission: "finance.budget.read",
              effect: "deny",
              description: "Throws.",
              condition: () => {
                throw new Error("x")
              },
            },
          ],
        }),
        "finance.budget.read",
      ).reason,
    ]
    for (const reason of produced) expect(DENY_REASONS).toContain(reason)
  })

  it("declares POLICY_INDETERMINATE, and it is not a synonym of POLICY_DENIED", () => {
    // A denial that says "policy denied" when the policy never ran is the lie
    // this reason exists to prevent.
    expect(DENY_REASONS).toContain("POLICY_INDETERMINATE")
    expect(DENY_REASONS).toContain("POLICY_DENIED")
  })
})
