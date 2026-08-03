import {
  ASSURANCE_LEVELS,
  assuranceRank,
  checkAssurance,
  meetsAssurance,
  requirementFor,
  type AssuranceRequirement,
  type SessionAssurance,
} from "./assurance"
import { decide, type AuthorizationWorld } from "./decide"
import type { Policy } from "./model"
import {
  directReportsOf,
  hasRelationship,
  RELATIONSHIP_TYPES,
  relationshipHoldsAt,
  relationshipProblems,
  type Relationship,
} from "./relationships"
import {
  lookupRoleTemplate,
  permissionsOfTemplate,
  ROLE_TEMPLATES,
  validateRoleTemplates,
  type RoleTemplate,
} from "./role-templates"

/**
 * GE-051-002 — the three halves of the model the engine could not express:
 * relationships, session assurance, and reusable bundles.
 */

const PAST = "2020-01-01T00:00:00Z"
const NOW = "2026-08-03T12:00:00Z"
const TENANT = "t1"

const rel = (over: Partial<Relationship> = {}): Relationship => ({
  type: "ADVISES",
  fromPrincipalId: "avery",
  tenantId: TENANT,
  toOrgUnitId: "club1",
  effectiveFrom: PAST,
  effectiveTo: null,
  ...over,
})

/* ─────────────────────────────────────────────────────────── relationships ── */

describe("a relationship points at exactly one thing", () => {
  it("accepts one target", () => {
    expect(relationshipProblems(rel())).toEqual([])
  })

  it("refuses none", () => {
    expect(relationshipProblems(rel({ toOrgUnitId: null }))).toContain("NO_TARGET")
  })

  it("refuses two", () => {
    // A relationship pointing at both a person and a unit reads as either, so
    // two call sites resolve it two ways and one of them is wrong.
    expect(relationshipProblems(rel({ toPrincipalId: "dana" }))).toContain("TWO_TARGETS")
  })

  it("refuses an end before its start", () => {
    expect(
      relationshipProblems(rel({ effectiveFrom: NOW, effectiveTo: PAST })),
    ).toContain("ENDS_BEFORE_IT_STARTS")
  })

  it("refuses a type nobody declared", () => {
    expect(relationshipProblems(rel({ type: "BEFRIENDS" as never }))).toContain("UNKNOWN_TYPE")
  })

  it("declares each type once", () => {
    expect(new Set(RELATIONSHIP_TYPES).size).toBe(RELATIONSHIP_TYPES.length)
  })
})

describe("a relationship is live only inside its window", () => {
  it("holds from its start", () => {
    expect(relationshipHoldsAt(rel({ effectiveFrom: NOW }), NOW)).toBe(true)
  })

  it("does not hold before it", () => {
    expect(relationshipHoldsAt(rel({ effectiveFrom: NOW }), PAST)).toBe(false)
  })

  it("does not hold at its end", () => {
    // Half-open. Two relationships meeting at one instant must not both hold,
    // or "who advised this club at noon" has two answers.
    expect(relationshipHoldsAt(rel({ effectiveTo: NOW }), NOW)).toBe(false)
  })

  it("holds just before its end", () => {
    expect(relationshipHoldsAt(rel({ effectiveTo: NOW }), "2026-08-03T11:59:59Z")).toBe(true)
  })

  it("does not hold at an unreadable instant", () => {
    expect(relationshipHoldsAt(rel(), "not a date")).toBe(false)
  })
})

describe("matching a relationship", () => {
  const all = [rel(), rel({ fromPrincipalId: "blake", toOrgUnitId: "club2" })]

  it("finds one held now", () => {
    expect(
      hasRelationship(all, { principalId: "avery", tenantId: TENANT, toOrgUnitId: "club1" }, NOW),
    ).toBe(true)
  })

  it("does not find another unit's", () => {
    expect(
      hasRelationship(all, { principalId: "avery", tenantId: TENANT, toOrgUnitId: "club2" }, NOW),
    ).toBe(false)
  })

  it("does not cross tenants", () => {
    expect(
      hasRelationship(all, { principalId: "avery", tenantId: "other", toOrgUnitId: "club1" }, NOW),
    ).toBe(false)
  })

  it("drops a malformed relationship rather than reading it charitably", () => {
    // Taking the first non-null target is exactly how one pointing at two
    // things grants access to the wrong one.
    const malformed = [rel({ toPrincipalId: "dana" })]
    expect(
      hasRelationship(malformed, { principalId: "avery", tenantId: TENANT, toOrgUnitId: "club1" }, NOW),
    ).toBe(false)
  })

  it("drops an expired one", () => {
    expect(
      hasRelationship(
        [rel({ effectiveTo: "2026-01-01T00:00:00Z" })],
        { principalId: "avery", tenantId: TENANT, toOrgUnitId: "club1" },
        NOW,
      ),
    ).toBe(false)
  })
})

describe("management is not transitive", () => {
  const chain: Relationship[] = [
    rel({ type: "MANAGES", fromPrincipalId: "top", toPrincipalId: "mid", toOrgUnitId: null }),
    rel({ type: "MANAGES", fromPrincipalId: "mid", toPrincipalId: "low", toOrgUnitId: null }),
  ]

  it("lists direct reports", () => {
    expect(directReportsOf(chain, "top", TENANT, NOW)).toEqual(["mid"])
  })

  it("does not walk the chain", () => {
    // Deriving skip-level access from the chart makes it the default, and at the
    // top of an organization that means one person reads everything, having been
    // granted nothing.
    expect(directReportsOf(chain, "top", TENANT, NOW)).not.toContain("low")
  })

  it("ignores an expired report", () => {
    const ended = [rel({ type: "MANAGES", fromPrincipalId: "top", toPrincipalId: "mid", toOrgUnitId: null, effectiveTo: "2026-01-01T00:00:00Z" })]
    expect(directReportsOf(ended, "top", TENANT, NOW)).toEqual([])
  })
})

/* ───────────────────────────────────────────── relationships in decisions ── */

const advisorWorld = (over: Partial<AuthorizationWorld> = {}): AuthorizationWorld => ({
  principals: [{ id: "avery" }],
  memberships: [{ principalId: "avery", tenantId: TENANT, state: "ACTIVE", effectiveFrom: PAST }],
  roles: [{ key: "oversight.advisor", permissions: ["finance.budget.read"] }],
  grants: [],
  relationships: [rel()],
  relationshipGrants: [
    { tenantId: TENANT, via: "ADVISES", roleKey: "oversight.advisor", scope: "related" },
  ],
  enabledModules: ["budgeting"],
  ...over,
})

const ask = (world: AuthorizationWorld, orgUnitId?: string) =>
  decide(world, {
    principalId: "avery",
    tenantId: TENANT,
    permission: "finance.budget.read",
    resource: orgUnitId ? { type: "Budget", id: "b1", orgUnitId } : undefined,
    at: NOW,
  })

describe("a role can be conferred by a relationship", () => {
  it("allows the advisor in the unit they advise", () => {
    expect(ask(advisorWorld(), "club1").allowed).toBe(true)
  })

  it("does not allow them in a unit they do not", () => {
    // `related` means *this* unit. Conferring at tenant scope would make an
    // advisor of one club an advisor of all of them.
    expect(ask(advisorWorld(), "club2").allowed).toBe(false)
  })

  it("stops the instant the relationship ends", () => {
    // No second write. An advisor who left in June is not an advisor in July.
    const ended = advisorWorld({ relationships: [rel({ effectiveTo: "2026-01-01T00:00:00Z" })] })
    expect(ask(ended, "club1").reason).toBe("NO_ROLE_GRANTING")
  })

  it("does not confer a role the relationship grant does not name", () => {
    const other = advisorWorld({
      relationshipGrants: [
        { tenantId: TENANT, via: "OVERSEES", roleKey: "oversight.advisor", scope: "related" },
      ],
    })
    expect(ask(other, "club1").allowed).toBe(false)
  })

  it("does not cross tenants", () => {
    const elsewhere = advisorWorld({
      relationshipGrants: [
        { tenantId: "other", via: "ADVISES", roleKey: "oversight.advisor", scope: "related" },
      ],
    })
    expect(ask(elsewhere, "club1").allowed).toBe(false)
  })

  it("still goes through the module gate", () => {
    // The conferred role is resolved the same way a named grant is. A second
    // path that skipped the later steps would be a second, quieter model.
    expect(ask(advisorWorld({ enabledModules: [] }), "club1").reason).toBe("MODULE_NOT_ENABLED")
  })

  it("still goes through deny policies", () => {
    const forbidden: Policy = {
      id: "test.never",
      permission: "finance.budget.read",
      effect: "deny",
      description: "Never, for this test.",
      condition: () => true,
    }
    expect(ask(advisorWorld({ policies: [forbidden] }), "club1").reason).toBe("POLICY_DENIED")
  })
})

describe("a policy can read relationships and attributes", () => {
  const managerWorld: AuthorizationWorld = {
    principals: [{ id: "dana", attributes: { employment: "STAFF" } }],
    memberships: [{ principalId: "dana", tenantId: TENANT, state: "ACTIVE", effectiveFrom: PAST }],
    roles: [{ key: "r", permissions: ["finance.reimbursement.read"] }],
    grants: [
      {
        principalId: "dana",
        tenantId: TENANT,
        roleKey: "r",
        scope: { kind: "tenant" },
        state: "CONFIRMED",
        effectiveFrom: PAST,
      },
    ],
    relationships: [
      rel({ type: "MANAGES", fromPrincipalId: "dana", toPrincipalId: "kim", toOrgUnitId: null }),
    ],
    enabledModules: ["reimbursements"],
  }

  const onlyOwnReports: Policy = {
    id: "test.onlyOwnReports",
    permission: "finance.reimbursement.read",
    effect: "deny",
    description: "A claim may be read by the claimant's manager, not by every manager.",
    condition: (ctx) => {
      const claimant = ctx.resource?.createdByPrincipalId
      if (!claimant) return false
      return !ctx.relatedTo?.({ type: "MANAGES", toPrincipalId: claimant })
    },
  }

  const readClaim = (claimant: string, world = managerWorld) =>
    decide({ ...world, policies: [onlyOwnReports] }, {
      principalId: "dana",
      tenantId: TENANT,
      permission: "finance.reimbursement.read",
      resource: { type: "Reimbursement", id: "r1", createdByPrincipalId: claimant },
      at: NOW,
    })

  it("allows a manager to read their own report's claim", () => {
    expect(readClaim("kim").allowed).toBe(true)
  })

  it("denies them somebody else's", () => {
    // The question a scope cannot phrase.
    expect(readClaim("sam").reason).toBe("POLICY_DENIED")
  })

  it("denies it once the management relationship has ended", () => {
    const ended: AuthorizationWorld = {
      ...managerWorld,
      relationships: [
        rel({
          type: "MANAGES",
          fromPrincipalId: "dana",
          toPrincipalId: "kim",
          toOrgUnitId: null,
          effectiveTo: "2026-01-01T00:00:00Z",
        }),
      ],
    }
    expect(readClaim("kim", ended).reason).toBe("POLICY_DENIED")
  })

  it("hands the policy the principal's own attributes, not the resource's", () => {
    // One merged bag would let a resource attribute shadow a principal one, and
    // a condition reading `attributes.employment` would change meaning
    // depending on what the resource happened to carry.
    let seen: unknown
    const capture: Policy = {
      id: "test.capture",
      permission: "finance.reimbursement.read",
      effect: "deny",
      description: "Captures what the condition was given, for this test.",
      condition: (ctx) => {
        seen = ctx.principalAttributes?.employment
        return false
      },
    }
    decide({ ...managerWorld, policies: [capture] }, {
      principalId: "dana",
      tenantId: TENANT,
      permission: "finance.reimbursement.read",
      resource: { type: "R", id: "1", attributes: { employment: "CONTRACTOR" } },
      at: NOW,
    })
    expect(seen).toBe("STAFF")
  })
})

/* ─────────────────────────────────────────────────────── session assurance ── */

describe("assurance is ordered, not matched", () => {
  it("ranks the levels in the declared order", () => {
    const ranks = ASSURANCE_LEVELS.map(assuranceRank)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(new Set(ranks).size).toBe(ranks.length)
  })

  it("accepts a stronger level than required", () => {
    // Equality on an ordered thing produces a step-up prompt that cannot be
    // satisfied: a hardware key refused for want of a one-time code.
    expect(meetsAssurance("HARDWARE", "STEP_UP")).toBe(true)
  })

  it("refuses a weaker one", () => {
    expect(meetsAssurance("PASSWORD", "MFA")).toBe(false)
  })

  it("refuses an unrecognised held level against anything", () => {
    expect(meetsAssurance("VERY_SURE", "SESSION")).toBe(false)
  })

  it("refuses an unrecognised requirement", () => {
    expect(meetsAssurance("HARDWARE", "PARANOID")).toBe(false)
  })
})

describe("checking a session against a requirement", () => {
  const requirement: AssuranceRequirement = {
    permission: "finance.reimbursement.approve",
    minimum: "STEP_UP",
    maxAgeSeconds: 300,
  }
  const session = (over: Partial<SessionAssurance> = {}): SessionAssurance => ({
    level: "STEP_UP",
    establishedAt: "2026-08-03T11:58:00Z",
    ...over,
  })

  it("passes a fresh, strong-enough session", () => {
    expect(checkAssurance(requirement, session(), NOW).ok).toBe(true)
  })

  it("passes anything when nothing is required", () => {
    expect(checkAssurance(undefined, undefined, NOW).ok).toBe(true)
  })

  it("fails closed when the session cannot be described", () => {
    expect(checkAssurance(requirement, undefined, NOW).failure).toBe("NO_SESSION")
  })

  it("fails a weaker level", () => {
    expect(checkAssurance(requirement, session({ level: "MFA" }), NOW).failure).toBe("TOO_LOW")
  })

  it("fails a stale one", () => {
    // A step-up satisfied at 09:00 is not a step-up at 17:00; recording only the
    // level turns "confirm it is you" into "confirm it was you once today".
    expect(
      checkAssurance(requirement, session({ establishedAt: "2026-08-03T09:00:00Z" }), NOW).failure,
    ).toBe("STALE")
  })

  it("fails when the age cannot be read", () => {
    expect(checkAssurance(requirement, session({ establishedAt: "whenever" }), NOW).failure).toBe(
      "STALE",
    )
  })

  it("fails a session the platform scored as too risky", () => {
    const risky = { ...requirement, maxRisk: 40 }
    expect(checkAssurance(risky, session({ risk: 80 }), NOW).failure).toBe("TOO_RISKY")
  })

  it("allows a risky session when no risk ceiling is declared", () => {
    expect(checkAssurance(requirement, session({ risk: 99 }), NOW).ok).toBe(true)
  })

  it("explains itself in every refusal", () => {
    for (const [req, sess] of [
      [requirement, undefined],
      [requirement, session({ level: "SESSION" })],
      [requirement, session({ establishedAt: "2026-08-03T09:00:00Z" })],
      [{ ...requirement, maxRisk: 10 }, session({ risk: 90 })],
    ] as [AssuranceRequirement, SessionAssurance | undefined][]) {
      const outcome = checkAssurance(req, sess, NOW)
      expect(outcome.ok).toBe(false)
      expect(outcome.detail?.length ?? 0).toBeGreaterThan(20)
    }
  })
})

describe("the strictest requirement wins, not the first", () => {
  const weak: AssuranceRequirement = { permission: "p", minimum: "MFA", maxAgeSeconds: 3600 }
  const strong: AssuranceRequirement = { permission: "p", minimum: "STEP_UP" }

  it("takes the higher level whichever order they are in", () => {
    // Order-dependence in a security rule means adding a requirement can weaken
    // one already there, and the person adding it has no reason to look.
    expect(requirementFor([weak, strong], "p")?.minimum).toBe("STEP_UP")
    expect(requirementFor([strong, weak], "p")?.minimum).toBe("STEP_UP")
  })

  it("keeps the tighter age when levels tie", () => {
    const a: AssuranceRequirement = { permission: "p", minimum: "MFA", maxAgeSeconds: 600 }
    const b: AssuranceRequirement = { permission: "p", minimum: "MFA", maxAgeSeconds: 60 }
    expect(requirementFor([a, b], "p")?.maxAgeSeconds).toBe(60)
    expect(requirementFor([b, a], "p")?.maxAgeSeconds).toBe(60)
  })

  it("keeps constraints from both when each declares a different one", () => {
    // Choosing one whole requirement would silently drop the other's.
    const a: AssuranceRequirement = { permission: "p", minimum: "MFA", maxAgeSeconds: 60 }
    const b: AssuranceRequirement = { permission: "p", minimum: "MFA", maxRisk: 10 }
    const merged = requirementFor([a, b], "p")
    expect(merged?.maxAgeSeconds).toBe(60)
    expect(merged?.maxRisk).toBe(10)
  })

  it("returns nothing when the permission is not mentioned", () => {
    expect(requirementFor([weak], "other")).toBeUndefined()
  })
})

describe("assurance in a decision", () => {
  const world: AuthorizationWorld = {
    principals: [{ id: "dana" }],
    memberships: [{ principalId: "dana", tenantId: TENANT, state: "ACTIVE", effectiveFrom: PAST }],
    roles: [{ key: "r", permissions: ["finance.reimbursement.approve"] }],
    grants: [
      {
        principalId: "dana",
        tenantId: TENANT,
        roleKey: "r",
        scope: { kind: "tenant" },
        state: "CONFIRMED",
        effectiveFrom: PAST,
      },
    ],
    enabledModules: ["reimbursements"],
    assuranceRequirements: [
      { permission: "finance.reimbursement.approve", minimum: "STEP_UP", maxAgeSeconds: 300 },
    ],
  }

  const approve = (session?: SessionAssurance) =>
    decide(world, {
      principalId: "dana",
      tenantId: TENANT,
      permission: "finance.reimbursement.approve",
      at: NOW,
      session,
    })

  it("allows a stepped-up session", () => {
    expect(approve({ level: "STEP_UP", establishedAt: "2026-08-03T11:59:00Z" }).allowed).toBe(true)
  })

  it("denies an ordinary one, with its own reason", () => {
    const decision = approve({ level: "MFA", establishedAt: "2026-08-03T11:59:00Z" })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toBe("ASSURANCE_TOO_LOW")
  })

  it("denies when the caller says nothing about the session", () => {
    expect(approve().reason).toBe("ASSURANCE_TOO_LOW")
  })

  it("does not require assurance for a permission that declares none", () => {
    expect(
      decide(
        { ...world, roles: [{ key: "r", permissions: ["finance.reimbursement.read"] }] },
        {
          principalId: "dana",
          tenantId: TENANT,
          permission: "finance.reimbursement.read",
          at: NOW,
        },
      ).allowed,
    ).toBe(true)
  })

  it("tells somebody with no grant that, rather than sending them to re-authenticate", () => {
    // A step-up prompt is also a disclosure that the action exists and is worth
    // prompting for.
    const ungranted = decide(
      { ...world, grants: [] },
      {
        principalId: "dana",
        tenantId: TENANT,
        permission: "finance.reimbursement.approve",
        at: NOW,
      },
    )
    expect(ungranted.reason).toBe("NO_ROLE_GRANTING")
  })
})

/* ────────────────────────────────────────────────────────── role templates ── */

describe("the shipped role templates are usable bundles", () => {
  it("validate", () => {
    const problems = validateRoleTemplates()
    if (problems.length) throw new Error(problems.join(String.fromCharCode(10)))
  })

  it("exist", () => {
    expect(ROLE_TEMPLATES.length).toBeGreaterThanOrEqual(5)
  })

  it("confer only catalog permissions", () => {
    for (const t of ROLE_TEMPLATES) {
      expect(permissionsOfTemplate(t.key).length).toBe(t.permissions.length)
    }
  })

  it("look up by key and return null otherwise", () => {
    expect(lookupRoleTemplate("unit.member")?.key).toBe("unit.member")
    expect(lookupRoleTemplate("unit.emperor")).toBeNull()
  })

  it("say which may be granted below the tenant", () => {
    // A tenant-only role granted on a club is a role whose scope check silently
    // passes for everything under it.
    expect(lookupRoleTemplate("unit.lead")?.scopable).toBe(true)
    expect(lookupRoleTemplate("platform.administrator")?.scopable).toBe(false)
  })

  it("give the lead everything the member has", () => {
    // Otherwise a promotion takes something away, and nobody finds out until
    // the person who was promoted cannot do what they could yesterday.
    const member = new Set(lookupRoleTemplate("unit.member")?.permissions ?? [])
    const lead = new Set(lookupRoleTemplate("unit.lead")?.permissions ?? [])
    expect([...member].filter((p) => !lead.has(p))).toEqual([])
  })

  it("keep the advisor read-only", () => {
    const advisor = lookupRoleTemplate("oversight.advisor")?.permissions ?? []
    const writes = advisor.filter((p) => !/\.(read|read_sensitive|query)$/.test(p))
    expect(writes).toEqual([])
  })
})

describe("the template validator catches what a bundle hides", () => {
  const base = ROLE_TEMPLATES[0]
  const bend = (over: Partial<RoleTemplate>): RoleTemplate[] => [{ ...base, ...over }]

  it("catches a permission the catalog does not declare", () => {
    // Nobody reads a list of twenty strings.
    const problems = validateRoleTemplates(bend({ permissions: ["org.unit.read", "org.unit.rule"] }))
    expect(problems.join(" ")).toMatch(/does not declare/)
  })

  it("catches a duplicate key", () => {
    expect(validateRoleTemplates([base, base]).join(" ")).toMatch(/declared twice/)
  })

  it("catches a repeated permission", () => {
    const problems = validateRoleTemplates(bend({ permissions: ["org.unit.read", "org.unit.read"] }))
    expect(problems.join(" ")).toMatch(/lists a permission twice/)
  })

  it("catches an empty bundle", () => {
    expect(validateRoleTemplates(bend({ permissions: [] })).join(" ")).toMatch(/confers nothing/)
  })

  it("catches a thin description", () => {
    expect(validateRoleTemplates(bend({ description: "finance" })).join(" ")).toMatch(
      /no usable description/,
    )
  })

  it("catches a bundle that both files and approves reimbursements", () => {
    // The self-approval policy only sees claims they filed themselves, so it is
    // not a control against the person who can do both.
    const problems = validateRoleTemplates(
      bend({
        permissions: ["finance.reimbursement.create", "finance.reimbursement.approve"],
      }),
    )
    expect(problems.join(" ")).toMatch(/both files and approves/)
  })

  it("finds nothing wrong with the shipped set on that count", () => {
    expect(validateRoleTemplates().join(" ")).not.toMatch(/both files and approves/)
  })
})
