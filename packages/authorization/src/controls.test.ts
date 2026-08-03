import {
  conflictHoldsAt,
  INCOMPATIBLE_DUTIES,
  ladderProblems,
  mayDecide,
  quorumMet,
  rungFor,
  separationViolations,
  type CastApproval,
  type ConflictDeclaration,
  type ControlWorld,
  type DecisionUnderReview,
  type QuorumRule,
  type ThresholdRung,
} from "./controls"
import { isPermissionKey } from "./permission-catalog"
import { ROLE_TEMPLATES } from "./role-templates"

/**
 * GE-051-003 — who may decide, how many of them, and when the answer changes
 * with the amount.
 */

const NOW = "2026-08-03T12:00:00Z"
const PAST = "2020-01-01T00:00:00Z"
const TENANT = "t1"

const decision = (over: Partial<DecisionUnderReview> = {}): DecisionUnderReview => ({
  resourceId: "req-1",
  tenantId: TENANT,
  raisedByPrincipalId: "maya",
  ...over,
})

const world = (over: Partial<ControlWorld> = {}): ControlWorld => ({ ...over })

const refused = (
  principalId: string,
  d: Partial<DecisionUnderReview>,
  w: Partial<ControlWorld>,
  refusal: string,
) => {
  const outcome = mayDecide(principalId, decision(d), world(w), NOW)
  expect(outcome.ok).toBe(false)
  expect(outcome.refusal).toBe(refusal)
  expect(outcome.detail?.length ?? 0).toBeGreaterThan(20)
}

describe("who may not decide", () => {
  it("allows an unconnected approver", () => {
    // Without this every refusal below could come from a rule that refuses
    // everybody.
    expect(mayDecide("priya", decision(), world(), NOW).ok).toBe(true)
  })

  it("refuses the person who raised it", () => {
    refused("maya", {}, {}, "SELF_APPROVAL")
  })

  it("refuses the person who prepared it", () => {
    // Maker-checker. Preparing something and checking it are the same act done
    // twice by one pair of eyes.
    refused("victor", { preparedByPrincipalId: "victor" }, {}, "SAME_MAKER")
  })

  it("refuses somebody who stood down from it", () => {
    refused(
      "priya",
      {},
      { recusals: [{ principalId: "priya", tenantId: TENANT, resourceId: "req-1", reason: "Knows the vendor.", at: NOW }] },
      "RECUSED",
    )
  })

  it("does not carry a recusal to a different decision", () => {
    // A recusal is an act about a decision, not a fact about a person. Carrying
    // it would make standing down once mean standing down permanently.
    const w = world({
      recusals: [{ principalId: "priya", tenantId: TENANT, resourceId: "other", reason: "Knows the vendor.", at: NOW }],
    })
    expect(mayDecide("priya", decision(), w, NOW).ok).toBe(true)
  })

  it("refuses somebody with a declared interest in what it touches", () => {
    refused(
      "priya",
      { subjectIds: ["vendor-7"] },
      {
        conflicts: [
          { principalId: "priya", tenantId: TENANT, subjectId: "vendor-7", reason: "Partner works there.", effectiveFrom: PAST },
        ],
      },
      "DECLARED_CONFLICT",
    )
  })

  it("names the interest in the refusal", () => {
    const outcome = mayDecide(
      "priya",
      decision({ subjectIds: ["vendor-7"] }),
      world({
        conflicts: [
          { principalId: "priya", tenantId: TENANT, subjectId: "vendor-7", reason: "Partner works there.", effectiveFrom: PAST },
        ],
      }),
      NOW,
    )
    expect(outcome.detail).toMatch(/Partner works there/)
  })

  it("ignores a declared interest in something this decision does not touch", () => {
    const w = world({
      conflicts: [
        { principalId: "priya", tenantId: TENANT, subjectId: "vendor-9", reason: "Partner works there.", effectiveFrom: PAST },
      ],
    })
    expect(mayDecide("priya", decision({ subjectIds: ["vendor-7"] }), w, NOW).ok).toBe(true)
  })

  it("ignores an interest that has lapsed", () => {
    const w = world({
      conflicts: [
        {
          principalId: "priya",
          tenantId: TENANT,
          subjectId: "vendor-7",
          reason: "Partner worked there until June.",
          effectiveFrom: PAST,
          effectiveTo: "2026-06-01T00:00:00Z",
        },
      ],
    })
    expect(mayDecide("priya", decision({ subjectIds: ["vendor-7"] }), w, NOW).ok).toBe(true)
  })

  it("does not read another tenant's declaration", () => {
    const w = world({
      conflicts: [
        { principalId: "priya", tenantId: "other", subjectId: "vendor-7", reason: "Partner works there.", effectiveFrom: PAST },
      ],
    })
    expect(mayDecide("priya", decision({ subjectIds: ["vendor-7"] }), w, NOW).ok).toBe(true)
  })

  it("refuses somebody who already decided at an earlier gate", () => {
    // Two gates cleared by one person is one gate that took longer.
    refused("priya", { decidedByPrincipalIds: ["priya"] }, {}, "ALREADY_DECIDED")
  })

  it("refuses somebody whose duties should never have been combined", () => {
    refused(
      "priya",
      {},
      {
        permissionsHeld: ["approvals.request.decide", "admin.override.execute"],
        dutiesMatrix: INCOMPATIBLE_DUTIES,
      },
      "INCOMPATIBLE_DUTIES",
    )
  })

  it("answers with the reason about them before the one about their role", () => {
    // "You raised this" is a better answer than "your role combines two
    // duties", and both are true.
    const outcome = mayDecide(
      "maya",
      decision(),
      world({
        permissionsHeld: ["approvals.request.decide", "admin.override.execute"],
        dutiesMatrix: INCOMPATIBLE_DUTIES,
      }),
      NOW,
    )
    expect(outcome.refusal).toBe("SELF_APPROVAL")
  })
})

describe("a declared interest is dated", () => {
  const conflict: ConflictDeclaration = {
    principalId: "priya",
    tenantId: TENANT,
    subjectId: "vendor-7",
    reason: "Partner works there.",
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveTo: "2026-07-01T00:00:00Z",
  }

  it("holds inside its window", () => {
    expect(conflictHoldsAt(conflict, "2026-03-01T00:00:00Z")).toBe(true)
  })

  it("does not hold before it", () => {
    expect(conflictHoldsAt(conflict, "2025-12-31T00:00:00Z")).toBe(false)
  })

  it("does not hold at its end", () => {
    expect(conflictHoldsAt(conflict, "2026-07-01T00:00:00Z")).toBe(false)
  })

  it("does not hold at an unreadable instant", () => {
    expect(conflictHoldsAt(conflict, "sometime")).toBe(false)
  })
})

describe("separation of duties reports every pair", () => {
  it("finds nothing when nothing conflicts", () => {
    expect(separationViolations(["org.unit.read"], INCOMPATIBLE_DUTIES)).toEqual([])
  })

  it("finds a pair held together", () => {
    const found = separationViolations(
      ["finance.reimbursement.create", "finance.reimbursement.approve"],
      INCOMPATIBLE_DUTIES,
    )
    expect(found).toHaveLength(1)
    expect(found[0].id).toBe("sod.fileAndApproveReimbursement")
  })

  it("finds every pair, not the first", () => {
    // Fixing one may not fix the next, and reporting one at a time turns an
    // access review into several.
    const found = separationViolations(
      [
        "finance.reimbursement.create",
        "finance.reimbursement.approve",
        "approvals.request.decide",
        "admin.override.execute",
      ],
      INCOMPATIBLE_DUTIES,
    )
    expect(found.map((f) => f.id).sort()).toEqual([
      "sod.decideAndOverride",
      "sod.fileAndApproveReimbursement",
    ])
  })

  it("names both sides and the reason", () => {
    const [found] = separationViolations(
      ["finance.ledger.post", "finance.budget.approve"],
      INCOMPATIBLE_DUTIES,
    )
    expect(found.detail).toContain("finance.ledger.post")
    expect(found.detail).toContain("finance.budget.approve")
    expect(found.detail.length).toBeGreaterThan(60)
  })
})

describe("the shipped duties matrix is defensible", () => {
  it("names only real permissions", () => {
    // A pair naming a permission nobody declares can never fire, which looks
    // identical to a pair nobody violates.
    const unknown = INCOMPATIBLE_DUTIES.flatMap((p) =>
      [p.a, p.b].filter((k) => !isPermissionKey(k)).map((k) => `${p.id} -> "${k}"`),
    )
    expect(unknown).toEqual([])
  })

  it("pairs two different permissions", () => {
    expect(INCOMPATIBLE_DUTIES.filter((p) => p.a === p.b)).toEqual([])
  })

  it("gives every pair a reason somebody can argue with", () => {
    for (const pair of INCOMPATIBLE_DUTIES) {
      expect(pair.reason.length).toBeGreaterThan(40)
    }
  })

  it("declares each pair once, in one direction", () => {
    const keys = INCOMPATIBLE_DUTIES.map((p) => [p.a, p.b].sort().join("|"))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("is not violated by any shipped role template", () => {
    // The matrix and the bundles are two statements about the same thing, and a
    // template that violates the matrix ships the violation to every tenant.
    const violations = ROLE_TEMPLATES.flatMap((t) =>
      separationViolations(t.permissions, INCOMPATIBLE_DUTIES).map((v) => `${t.key}: ${v.id}`),
    )
    expect(violations).toEqual([])
  })
})

/* ────────────────────────────────────────────────────────────────── quorum ── */

const cast = (principalId: string, over: Partial<CastApproval> = {}): CastApproval => ({
  principalId,
  at: NOW,
  ...over,
})

describe("a quorum counts people, not casts", () => {
  it("is met by enough distinct approvers", () => {
    expect(quorumMet([cast("a"), cast("b")], { minimum: 2 }).met).toBe(true)
  })

  it("is not met by one person approving twice", () => {
    // Counting the casts is how a two-of-three rule is satisfied by one
    // determined person and a page refresh.
    const outcome = quorumMet([cast("a"), cast("a")], { minimum: 2 })
    expect(outcome.met).toBe(false)
    expect(outcome.counted).toBe(1)
    expect(outcome.shortfall).toBe("NOT_ENOUGH")
  })

  it("keeps the first cast, not the last", () => {
    // The last would let somebody change which unit they counted under after
    // seeing what the quorum was short of.
    const outcome = quorumMet(
      [cast("a", { orgUnitId: "u1" }), cast("a", { orgUnitId: "u2" }), cast("b", { orgUnitId: "u1" })],
      { minimum: 2, distinctOrgUnits: 2 },
    )
    expect(outcome.met).toBe(false)
    expect(outcome.shortfall).toBe("NOT_ENOUGH_DISTINCT_UNITS")
  })

  it("says how far short it is", () => {
    expect(quorumMet([cast("a")], { minimum: 3 }).detail).toMatch(/1 of 3/)
  })
})

describe("a quorum can require breadth", () => {
  const rule: QuorumRule = { minimum: 2, distinctOrgUnits: 2 }

  it("is met by approvals from two units", () => {
    expect(quorumMet([cast("a", { orgUnitId: "u1" }), cast("b", { orgUnitId: "u2" })], rule).met).toBe(
      true,
    )
  })

  it("is not met by two people from the same unit", () => {
    // Two approvals from one team are two people who talk to each other every
    // day, which is what a quorum is trying not to be.
    expect(quorumMet([cast("a", { orgUnitId: "u1" }), cast("b", { orgUnitId: "u1" })], rule).met).toBe(
      false,
    )
  })

  it("does not count an approval with no unit toward the breadth", () => {
    expect(quorumMet([cast("a", { orgUnitId: "u1" }), cast("b")], rule).shortfall).toBe(
      "NOT_ENOUGH_DISTINCT_UNITS",
    )
  })

  it("requires every named role to be represented", () => {
    const withRoles: QuorumRule = { minimum: 2, requiredRoleKeys: ["finance.approver"] }
    expect(quorumMet([cast("a", { roleKey: "unit.lead" }), cast("b", { roleKey: "unit.lead" })], withRoles).shortfall).toBe(
      "MISSING_REQUIRED_ROLE",
    )
    expect(
      quorumMet([cast("a", { roleKey: "unit.lead" }), cast("b", { roleKey: "finance.approver" })], withRoles).met,
    ).toBe(true)
  })
})

describe("an unsatisfiable quorum says so", () => {
  it("refuses more distinct units than approvals", () => {
    // "Keep collecting approvals" is the wrong answer when no number of them
    // will do.
    const outcome = quorumMet([cast("a"), cast("b")], { minimum: 2, distinctOrgUnits: 3 })
    expect(outcome.shortfall).toBe("IMPOSSIBLE_RULE")
    expect(outcome.detail).toMatch(/no number of approvals/)
  })

  it("refuses more required roles than approvals", () => {
    expect(
      quorumMet([cast("a")], { minimum: 1, requiredRoleKeys: ["a", "b"] }).shortfall,
    ).toBe("IMPOSSIBLE_RULE")
  })

  it("refuses a quorum of zero", () => {
    expect(quorumMet([], { minimum: 0 }).shortfall).toBe("IMPOSSIBLE_RULE")
  })
})

/* ───────────────────────────────────────────────────────────── thresholds ── */

const LADDER: ThresholdRung[] = [
  { fromAmountCents: 0, rule: { minimum: 1 }, label: "Routine" },
  { fromAmountCents: 100_000, rule: { minimum: 2 }, label: "Second signature" },
  { fromAmountCents: 1_000_000, rule: { minimum: 3, distinctOrgUnits: 2 }, label: "Board" },
]

describe("a ladder decides how many approvals an amount needs", () => {
  it("takes the highest rung at or below the amount", () => {
    expect(rungFor(0, LADDER)?.label).toBe("Routine")
    expect(rungFor(99_999, LADDER)?.label).toBe("Routine")
    expect(rungFor(100_000, LADDER)?.label).toBe("Second signature")
    expect(rungFor(999_999, LADDER)?.label).toBe("Second signature")
    expect(rungFor(5_000_000, LADDER)?.label).toBe("Board")
  })

  it("is inclusive at the floor of each rung", () => {
    // Exclusive floors leave a gap exactly at the round number people choose.
    expect(rungFor(1_000_000, LADDER)?.label).toBe("Board")
  })

  it("puts a credit on the floor rung rather than none", () => {
    // A negative amount climbs no ladder, but it is not nothing.
    expect(rungFor(-5_000, LADDER)?.label).toBe("Routine")
  })

  it("returns nothing for an amount that is not a number", () => {
    expect(rungFor(Number.NaN, LADDER)).toBeNull()
  })
})

describe("a ladder with a gap is refused, not used", () => {
  it("accepts a well-formed one", () => {
    expect(ladderProblems(LADDER)).toEqual([])
  })

  it("catches a ladder that does not start at zero", () => {
    // A ladder starting at 50,000 has nothing to say about a 40,000 spend, and
    // "no rung applied" reads as "no approval needed" at every call site that
    // forgets to check.
    expect(ladderProblems(LADDER.slice(1))).toContain("NO_FLOOR")
  })

  it("catches an empty ladder", () => {
    expect(ladderProblems([])).toEqual(["EMPTY"])
  })

  it("catches rungs out of order", () => {
    expect(ladderProblems([LADDER[0], LADDER[2], LADDER[1]])).toContain("NOT_ASCENDING")
  })

  it("catches two rungs at the same floor", () => {
    expect(ladderProblems([LADDER[0], { ...LADDER[1], fromAmountCents: 0 }])).toContain(
      "DUPLICATE_FLOOR",
    )
  })

  it("returns nothing from a malformed ladder rather than a guess", () => {
    expect(rungFor(500_000, LADDER.slice(1))).toBeNull()
  })
})
