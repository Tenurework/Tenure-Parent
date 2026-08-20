import { readFileSync } from "node:fs"
import { join } from "node:path"

import { SEPARATION_OF_DUTIES, type AuthorizationWorld } from "@tenure/authorization"

import type { Fact } from "./evaluate"
import {
  ACCESS_STAGES,
  decideTargetAccess,
  hiddenTargetReasons,
  visibleTargets,
  type TargetAccessRequest,
} from "./module-scope"
import { compilePolicyOrThrow, type AttributeCatalog, type EligibilityPolicy } from "./policy"
import type { ProofAssertion, ProofRequirement } from "./proofs"
import type { EligibilityTarget } from "./targets"

/**
 * IER-120-002 — "Require tenant capability entitlement before person
 * eligibility can activate a module."
 * IER-120-003 — "Require central server authorization after eligibility for
 * every action/resource."
 * IER-120-005 — "Enforce effective dates and future/expired states."
 * IER-120-008 — "Test hidden-button bypass through direct API/server calls."
 */

const NOW = new Date("2026-06-01T12:00:00.000Z")
const SUBJECT = "person-1"
const TENANT = "tenant-1"
const OBSERVED = "2026-06-01T11:59:00.000Z"

const CATALOG: AttributeCatalog = {
  "affiliation.status": {
    id: "affiliation.status",
    type: "enum",
    members: ["ACTIVE", "PENDING", "SUSPENDED", "REVOKED", "ENDED"],
    acceptedSourceRoles: ["SYSTEM_OF_RECORD"],
    maxAgeMs: 5 * 60 * 1000,
    derivation: "SOURCE_ASSERTED",
  },
  "assignment.interval": {
    id: "assignment.interval",
    type: "interval",
    acceptedSourceRoles: ["SYSTEM_OF_RECORD"],
    maxAgeMs: 5 * 60 * 1000,
    derivation: "SOURCE_ASSERTED",
  },
}

const POLICY: EligibilityPolicy = {
  policyId: "test.module-finance.v1",
  version: "1",
  owner: "platform-identity",
  purpose: "Decide whether a person belongs to the finance module's population.",
  target: "module:finance",
  requiresTenantCapability: "budgeting",
  subject: "member with a live finance assignment",
  risk: "LOW",
  activeFrom: "2026-01-01T00:00:00.000Z",
  expiresAt: null,
  rollout: { percent: 100, cohortSalt: "module-scope-test" },
  attributes: [
    { attribute: "affiliation.status", acceptedSourceRoles: ["SYSTEM_OF_RECORD"], maxAgeMs: 5 * 60 * 1000 },
    { attribute: "assignment.interval", acceptedSourceRoles: ["SYSTEM_OF_RECORD"], maxAgeMs: 5 * 60 * 1000 },
  ],
  requiredSources: ["tenure.membership"],
  deny: [],
  conditions: {
    all: [
      { attribute: "affiliation.status", op: "in", values: ["ACTIVE"] },
      { attribute: "assignment.interval", op: "evaluationTimeWithin" },
    ],
  },
  conditionallyEligible: [],
  onMissing: "INDETERMINATE",
  onStale: "INDETERMINATE",
  onConflict: "MANUAL_REVIEW_REQUIRED",
  onSourceUnavailable: "INDETERMINATE",
  exceptions: [],
  reviewEveryDays: 180,
  approvedBy: "platform-identity",
  rollbackTo: null,
}

const COMPILED = compilePolicyOrThrow(POLICY, CATALOG)

const TARGET: EligibilityTarget = {
  kind: "module",
  id: "finance",
  capability: "budgeting",
  orgUnitId: "club-1",
}

function facts(over: { status?: string; from?: string; to?: string | null } = {}): Fact[] {
  return [
    {
      attribute: "affiliation.status",
      presence: "PRESENT",
      value: over.status ?? "ACTIVE",
      sourceId: "tenure.membership",
      sourceRole: "SYSTEM_OF_RECORD",
      observedAt: OBSERVED,
    },
    {
      attribute: "assignment.interval",
      presence: "PRESENT",
      value: {
        from: over.from ?? "2026-01-01T00:00:00.000Z",
        until: over.to === undefined ? "2027-01-01T00:00:00.000Z" : over.to,
      },
      sourceId: "tenure.membership",
      sourceRole: "SYSTEM_OF_RECORD",
      observedAt: OBSERVED,
    },
  ]
}

/** A world in which the subject holds a role carrying `finance.budget.read`. */
function world(over: Partial<AuthorizationWorld> = {}): AuthorizationWorld {
  return {
    principals: [{ id: SUBJECT, kind: "user" }],
    memberships: [
      { principalId: SUBJECT, tenantId: TENANT, state: "ACTIVE", effectiveFrom: "2026-01-01T00:00:00.000Z" },
    ],
    roles: [{ key: "club.treasurer", permissions: ["finance.budget.read"] }],
    grants: [
      {
        principalId: SUBJECT,
        tenantId: TENANT,
        roleKey: "club.treasurer",
        scope: { kind: "tenant" },
        state: "CONFIRMED",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
      },
    ],
    enabledModules: ["budgeting"],
    ...over,
  }
}

function request(over: Partial<TargetAccessRequest> = {}): TargetAccessRequest {
  return {
    target: TARGET,
    subjectId: SUBJECT,
    tenantId: TENANT,
    permission: "finance.budget.read",
    now: NOW,
    tenantCapabilities: ["dashboard", "budgeting"],
    policy: COMPILED,
    facts: facts(),
    world: world(),
    ...over,
  }
}

describe("the allow, so every refusal below is not a function that always says no", () => {
  it("allows an entitled tenant, an eligible person, and an authorized action — and only at the last stage", () => {
    const decision = decideTargetAccess(request())
    expect(decision.allowed).toBe(true)
    expect(decision.stage).toBe("SERVER_AUTHORIZATION")
    expect(decision.targetRef).toBe("module:finance")
    expect(decision.eligibility?.outcome).toBe("ELIGIBLE")
    expect(decision.authorization?.allowed).toBe(true)
    expect(decision.reasonCodes).toEqual([])
    expect(decision.trace.map((s) => s.stage)).toEqual([...ACCESS_STAGES])
  })
})

describe("IER-120-002 — tenant capability entitlement comes BEFORE person eligibility", () => {
  it("refuses at gate 1 when the tenant is not entitled to the target's capability", () => {
    const decision = decideTargetAccess(request({ tenantCapabilities: ["dashboard"] }))
    expect(decision.allowed).toBe(false)
    expect(decision.stage).toBe("TENANT_CAPABILITY")
    expect(decision.reasonCodes).toEqual(["TENANT_CAPABILITY_NOT_ENTITLED"])
  })

  it("does not evaluate the person's eligibility at all when gate 1 refuses", () => {
    // `eligibility: null` is the load-bearing assertion: "before" in the
    // requirement's sentence means the roster read does not happen, not that it
    // happens and is then ignored.
    const decision = decideTargetAccess(request({ tenantCapabilities: ["dashboard"] }))
    expect(decision.eligibility).toBeNull()
    expect(decision.authorization).toBeNull()
    expect(decision.trace.some((s) => s.stage === "PERSON_ELIGIBILITY")).toBe(false)
  })

  it("refuses even a principal holding a confirmed grant of the permission", () => {
    // Gate 1 is about the TENANT. A grant is a statement about a person and
    // cannot buy a module.
    const decision = decideTargetAccess(request({ tenantCapabilities: [] }))
    expect(decision.allowed).toBe(false)
    expect(decision.stage).toBe("TENANT_CAPABILITY")
  })

  it("reads the capability from the target, not from the permission's module", () => {
    const decision = decideTargetAccess(
      request({ target: { ...TARGET, capability: "reimbursements" } }),
    )
    expect(decision.stage).toBe("TENANT_CAPABILITY")
  })
})

describe("IER-120-003 — central server authorization runs after eligibility, and is the only stage that can allow", () => {
  it("refuses an eligible person who holds no role granting the action", () => {
    const decision = decideTargetAccess(request({ world: world({ grants: [] }) }))
    expect(decision.allowed).toBe(false)
    expect(decision.stage).toBe("SERVER_AUTHORIZATION")
    expect(decision.eligibility?.outcome).toBe("ELIGIBLE")
    expect(decision.authorization?.reason).toBe("NO_ROLE_GRANTING")
    expect(decision.reasonCodes).toEqual(["NO_ROLE_GRANTING"])
  })

  it("refuses an eligible person whose grant of the role is not yet effective", () => {
    const notYet = world({
      grants: [
        {
          principalId: SUBJECT,
          tenantId: TENANT,
          roleKey: "club.treasurer",
          scope: { kind: "tenant" },
          state: "CONFIRMED",
          effectiveFrom: "2026-09-01T00:00:00.000Z",
        },
      ],
    })
    const decision = decideTargetAccess(request({ world: notYet }))
    expect(decision.allowed).toBe(false)
    // `decide()` reports "held, but no grant of it is both CONFIRMED and
    // effective" under one reason; the person's own eligibility was ELIGIBLE,
    // so this refusal comes from stage 3 and nowhere else.
    expect(decision.authorization?.reason).toBe("GRANT_NOT_CONFIRMED")
    expect(decision.eligibility?.outcome).toBe("ELIGIBLE")
  })

  it("authorizes the action that was asked about, not the target as a whole", () => {
    const decision = decideTargetAccess(request({ permission: "finance.budget.approve" }))
    expect(decision.allowed).toBe(false)
    expect(decision.stage).toBe("SERVER_AUTHORIZATION")
    expect(decision.authorization?.reason).toBe("NO_ROLE_GRANTING")
  })

  it("never allows without an authorization decision, across every case in this file", () => {
    const cases: TargetAccessRequest[] = [
      request(),
      request({ tenantCapabilities: [] }),
      request({ facts: facts({ status: "SUSPENDED" }) }),
      request({ facts: facts({ from: "2027-01-01T00:00:00.000Z" }) }),
      request({ world: world({ grants: [] }) }),
      request({ world: world({ enabledModules: [] }) }),
      request({ permission: "finance.budget.approve" }),
      request({ target: { ...TARGET, id: "" } }),
    ]
    for (const c of cases) {
      const decision = decideTargetAccess(c)
      if (decision.allowed) {
        expect(decision.authorization?.allowed).toBe(true)
        expect(decision.stage).toBe("SERVER_AUTHORIZATION")
      }
    }
    // …and at least one of them did allow, so the loop is not vacuous.
    expect(cases.map((c) => decideTargetAccess(c).allowed).filter(Boolean)).toHaveLength(1)
  })

  it("still consults authorization for a module the tenant bought but the runtime does not run", () => {
    const decision = decideTargetAccess(request({ world: world({ enabledModules: [] }) }))
    expect(decision.stage).toBe("SERVER_AUTHORIZATION")
    expect(decision.authorization?.reason).toBe("MODULE_NOT_ENABLED")
  })

  it("refuses a malformed target before it asks anybody anything", () => {
    const decision = decideTargetAccess(request({ target: { ...TARGET, capability: "" } }))
    expect(decision.stage).toBe("TARGET")
    expect(decision.reasonCodes).toEqual(["MALFORMED_TARGET:capability"])
    expect(decision.eligibility).toBeNull()
    expect(decision.authorization).toBeNull()
  })
})

describe("IER-120-005 — effective dates, on the target and on the person, kept apart", () => {
  it("refuses a target whose own window has not opened", () => {
    const decision = decideTargetAccess(
      request({ target: { ...TARGET, window: { from: "2026-09-01T00:00:00.000Z", to: null } } }),
    )
    expect(decision.stage).toBe("TARGET_WINDOW")
    expect(decision.reasonCodes).toEqual(["TARGET_NOT_YET_ACTIVE"])
    expect(decision.eligibility).toBeNull()
  })

  it("refuses a target whose own window has closed", () => {
    const decision = decideTargetAccess(
      request({
        target: {
          ...TARGET,
          window: { from: "2025-01-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" },
        },
      }),
    )
    expect(decision.stage).toBe("TARGET_WINDOW")
    expect(decision.reasonCodes).toEqual(["TARGET_EXPIRED"])
  })

  it("reports a person whose assignment has not started as pending, not as ineligible", () => {
    const decision = decideTargetAccess(request({ facts: facts({ from: "2027-01-01T00:00:00.000Z" }) }))
    expect(decision.stage).toBe("PERSON_ELIGIBILITY")
    expect(decision.eligibility?.outcome).toBe("PENDING_EFFECTIVE_DATE")
    expect(decision.reasonCodes[0]).toBe("INELIGIBLE_FOR_TARGET:PENDING_EFFECTIVE_DATE")
  })

  it("reports a person whose assignment has ended as expired", () => {
    const decision = decideTargetAccess(
      request({ facts: facts({ from: "2025-01-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" }) }),
    )
    expect(decision.eligibility?.outcome).toBe("EXPIRED")
    expect(decision.reasonCodes[0]).toBe("INELIGIBLE_FOR_TARGET:EXPIRED")
  })

  it("carries the eligibility engine's own reason codes through", () => {
    const decision = decideTargetAccess(request({ facts: facts({ status: "SUSPENDED" }) }))
    expect(decision.allowed).toBe(false)
    expect(decision.stage).toBe("PERSON_ELIGIBILITY")
    expect(decision.reasonCodes).toContain("INELIGIBLE_FOR_TARGET:INELIGIBLE")
  })
})

describe("IER-120-006 — proofs are checked at the target's scope, between eligibility and authorization", () => {
  const TRAINING: ProofRequirement = {
    kind: "TRAINING",
    proofId: "training.finance-controls",
    acceptedStatuses: ["VALID"],
    acceptedSourceRoles: ["AUTHORITATIVE"],
    maxAgeMs: 30 * 24 * 60 * 60 * 1000,
    scope: {},
  }
  const held = (orgUnitId: string): ProofAssertion => ({
    kind: "TRAINING",
    proofId: "training.finance-controls",
    status: "VALID",
    sourceId: "lms",
    sourceRole: "AUTHORITATIVE",
    observedAt: OBSERVED,
    scope: { orgUnitId },
  })

  it("allows when the proof is held for this target's org unit", () => {
    const decision = decideTargetAccess(
      request({ proofRequirements: [TRAINING], proofs: [held("club-1")] }),
    )
    expect(decision.allowed).toBe(true)
    expect(decision.proofChecks.map((c) => c.outcome)).toEqual(["SATISFIED"])
  })

  it("refuses when the proof is held for a different org unit", () => {
    const decision = decideTargetAccess(
      request({ proofRequirements: [TRAINING], proofs: [held("club-2")] }),
    )
    expect(decision.allowed).toBe(false)
    expect(decision.stage).toBe("PROOFS")
    expect(decision.reasonCodes).toEqual(["OUT_OF_SCOPE:TRAINING:training.finance-controls"])
    expect(decision.authorization).toBeNull()
  })

  it("refuses when no proof was asserted, and says so distinctly", () => {
    const decision = decideTargetAccess(request({ proofRequirements: [TRAINING], proofs: [] }))
    expect(decision.reasonCodes).toEqual(["MISSING:TRAINING:training.finance-controls"])
  })
})

describe("IER-120-004 / IER-120-008 — the menu is derived, and calling the server directly does not bypass it", () => {
  const REPORTS: EligibilityTarget = { kind: "report", id: "spend-by-club", capability: "budgeting" }
  const CONNECTOR: EligibilityTarget = { kind: "connector", id: "bank-feed", capability: "treasury" }

  function menuFor(over: Partial<TargetAccessRequest> = {}) {
    const decisions = [TARGET, REPORTS, CONNECTOR].map((target) =>
      decideTargetAccess(request({ target, permission: "finance.budget.read", ...over })),
    )
    return { decisions, visible: visibleTargets(decisions) }
  }

  it("shows only what the same gate allowed", () => {
    const { visible } = menuFor()
    // `connector:bank-feed` needs a capability this tenant never bought.
    expect(visible).toEqual(["module:finance", "report:spend-by-club"])
  })

  it("refuses a hidden target when a client calls the server for it directly", () => {
    const { visible } = menuFor()
    expect(visible).not.toContain("connector:bank-feed")

    // The "hidden button" pressed anyway: the same server entry point, called
    // with the target the menu never rendered.
    const direct = decideTargetAccess(request({ target: CONNECTOR }))
    expect(direct.allowed).toBe(false)
    expect(direct.reasonCodes).toEqual(["TENANT_CAPABILITY_NOT_ENTITLED"])
  })

  it("refuses a target that is visible to somebody else when this person calls for it", () => {
    const theirs = menuFor()
    expect(theirs.visible).toContain("module:finance")

    const mine = decideTargetAccess(request({ target: TARGET, world: world({ grants: [] }) }))
    expect(mine.allowed).toBe(false)
    expect(mine.authorization?.reason).toBe("NO_ROLE_GRANTING")
  })

  it("gives the same answer whether or not a menu was ever derived", () => {
    const withoutMenu = decideTargetAccess(request({ target: CONNECTOR }))
    menuFor()
    const afterMenu = decideTargetAccess(request({ target: CONNECTOR }))
    expect(afterMenu).toEqual(withoutMenu)
  })

  it("takes no navigation input at all — the gate cannot be told what the menu showed", () => {
    // Structural, not behavioural: a menu that could be passed in is a menu
    // that will eventually be trusted.
    const source = readFileSync(join(__dirname, "module-scope.ts"), "utf8")
    const body = source.slice(source.indexOf("export function decideTargetAccess"))
    const gate = body
      .slice(0, body.indexOf("export function visibleTargets"))
      // Comments stripped: the prose above `visibleTargets` explains the rule by
      // naming it, and a scan over raw text would fail on the explanation.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n")
    expect(gate).not.toMatch(/visibleTargets|hiddenTargetReasons|menu|navigation/i)
  })

  it("explains an absent target with the same codes the refusal carried", () => {
    const { decisions } = menuFor()
    expect(hiddenTargetReasons(decisions)).toEqual({
      "connector:bank-feed": ["TENANT_CAPABILITY_NOT_ENTITLED"],
    })
  })
})

describe("the composed gate is as deterministic as the two engines it composes", () => {
  const FILES = ["targets.ts", "proofs.ts", "module-scope.ts"] as const
  const PROHIBITED: readonly { pattern: RegExp; why: string }[] = [
    { pattern: /\bfetch\s*\(/, why: "a network call inside a decision" },
    { pattern: /\bDate\.now\s*\(/, why: "a clock other than the explicit evaluation clock" },
    { pattern: /new Date\s*\(\s*\)/, why: "an implicit clock" },
    { pattern: /\bMath\.random\b|\brandomUUID\b|\brandomBytes\b/, why: "nondeterminism" },
    { pattern: /\bprocess\.env\b/, why: "an ambient default nobody declared" },
    { pattern: /\bnew Function\b|(^|[^.\w])eval\s*\(/m, why: "arbitrary code evaluation" },
  ]

  it.each(FILES)("%s contains none of the prohibited constructs", (file) => {
    const code = readFileSync(join(__dirname, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n")
    expect(PROHIBITED.filter((r) => r.pattern.test(code)).map((r) => r.why)).toEqual([])
  })

  it("the guard would catch a violation if one were introduced", () => {
    const violating = "const at = Date.now()\nconst r = Math.random()\nfetch(url)"
    expect(PROHIBITED.filter((r) => r.pattern.test(violating)).map((r) => r.why)).toEqual([
      "a network call inside a decision",
      "a clock other than the explicit evaluation clock",
      "nondeterminism",
    ])
  })

  it("the same request decided twice produces the same decision", () => {
    expect(decideTargetAccess(request())).toEqual(decideTargetAccess(request()))
  })
})

describe("IER-120-007 — relationship, assignment, delegation and separation of duties all reach the composed gate", () => {
  const APPROVALS: EligibilityTarget = {
    kind: "workflow",
    id: "approvals",
    capability: "approvals",
    orgUnitId: "club-1",
  }
  const CAPS = ["dashboard", "budgeting", "approvals"]

  /**
   * The four are not re-implemented here — `decide()` has carried them since
   * GE-051/GE-053. What IER-120-007 asks is that they are *integrated*: that a
   * person whose only authority is a relationship, or a delegation, or who is
   * blocked by a separation-of-duties rule, gets that answer from the same
   * composed gate rather than from a second code path nobody joined up.
   */

  it("allows through a role conferred by a live relationship, with no grant naming the person", () => {
    const decision = decideTargetAccess(
      request({
        target: APPROVALS,
        tenantCapabilities: CAPS,
        permission: "approvals.request.decide",
        resource: { type: "Request", id: "req-1", orgUnitId: "club-1" },
        world: world({
          grants: [],
          roles: [{ key: "club.advisor", permissions: ["approvals.request.decide"] }],
          enabledModules: ["approvals"],
          relationships: [
            {
              type: "ADVISES",
              fromPrincipalId: SUBJECT,
              tenantId: TENANT,
              toOrgUnitId: "club-1",
              effectiveFrom: "2026-01-01T00:00:00.000Z",
            },
          ],
          relationshipGrants: [
            { tenantId: TENANT, via: "ADVISES", roleKey: "club.advisor", scope: "related" },
          ],
        }),
      }),
    )
    expect(decision.allowed).toBe(true)
    expect(decision.stage).toBe("SERVER_AUTHORIZATION")
  })

  it("refuses once that relationship has ended", () => {
    const decision = decideTargetAccess(
      request({
        target: APPROVALS,
        tenantCapabilities: CAPS,
        permission: "approvals.request.decide",
        resource: { type: "Request", id: "req-1", orgUnitId: "club-1" },
        world: world({
          grants: [],
          roles: [{ key: "club.advisor", permissions: ["approvals.request.decide"] }],
          enabledModules: ["approvals"],
          relationships: [
            {
              type: "ADVISES",
              fromPrincipalId: SUBJECT,
              tenantId: TENANT,
              toOrgUnitId: "club-1",
              effectiveFrom: "2025-01-01T00:00:00.000Z",
              effectiveTo: "2026-05-01T00:00:00.000Z",
            },
          ],
          relationshipGrants: [
            { tenantId: TENANT, via: "ADVISES", roleKey: "club.advisor", scope: "related" },
          ],
        }),
      }),
    )
    expect(decision.allowed).toBe(false)
    expect(decision.eligibility?.outcome).toBe("ELIGIBLE")
  })

  it("allows through a delegation, and says whose authority was borrowed", () => {
    const decision = decideTargetAccess(
      request({
        world: world({
          grants: [
            {
              principalId: "person-2",
              tenantId: TENANT,
              roleKey: "club.treasurer",
              scope: { kind: "tenant" },
              state: "CONFIRMED",
              effectiveFrom: "2026-01-01T00:00:00.000Z",
            },
          ],
          delegations: [
            {
              fromPrincipalId: "person-2",
              toPrincipalId: SUBJECT,
              tenantId: TENANT,
              permissions: ["finance.budget.read"],
              effectiveFrom: "2026-05-01T00:00:00.000Z",
              effectiveTo: "2026-07-01T00:00:00.000Z",
            },
          ],
        }),
      }),
    )
    expect(decision.allowed).toBe(true)
    expect(decision.authorization?.viaDelegationFrom).toBe("person-2")
  })

  it("refuses when a separation-of-duties rule fires on the person's own resource", () => {
    const base = {
      target: APPROVALS,
      tenantCapabilities: CAPS,
      permission: "approvals.request.decide",
      world: world({
        roles: [{ key: "club.treasurer", permissions: ["approvals.request.decide"] }],
        enabledModules: ["approvals"],
        policies: SEPARATION_OF_DUTIES,
      }),
    }
    const somebodyElses = decideTargetAccess(
      request({ ...base, resource: { type: "Request", id: "r1", createdByPrincipalId: "person-2" } }),
    )
    expect(somebodyElses.allowed).toBe(true)

    const theirOwn = decideTargetAccess(
      request({ ...base, resource: { type: "Request", id: "r1", createdByPrincipalId: SUBJECT } }),
    )
    expect(theirOwn.allowed).toBe(false)
    expect(theirOwn.authorization?.reason).toBe("SEPARATION_OF_DUTIES")
    // The person is still ELIGIBLE. Separation of duties is an authorization
    // rule about one action, not a statement about who somebody is.
    expect(theirOwn.eligibility?.outcome).toBe("ELIGIBLE")
  })

  it("keeps the assignment's own dates at gate 2, where the person is, not at gate 3", () => {
    const ended = decideTargetAccess(
      request({ facts: facts({ from: "2025-01-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" }) }),
    )
    expect(ended.stage).toBe("PERSON_ELIGIBILITY")
    expect(ended.authorization).toBeNull()
  })
})
