import type { Dated, ISODate } from "./model"

/**
 * GE-051-003 — the controls that decide who may decide.
 *
 * Bible §9.2: "Policy-based rules for separation of duties, self-approval
 * prohibition, quorum, four-eyes review, and regulatory constraints."
 *
 * Two of these existed as one-line policies. The rest are the ones every
 * approval system needs, implements four times slightly differently at four
 * call sites, and then misses at the fifth.
 *
 * Each returns a **refusal with a reason**, never a bare boolean. "You cannot
 * approve this" is the answer somebody escalates; "you cannot approve this
 * because you raised it" is the answer they act on, and the difference is
 * whether support has to reconstruct the rule from the code.
 */

/* ────────────────────────────────────────────────────── conflicts and recusal ── */

/**
 * A standing declared interest.
 *
 * Declared, not detected. The platform cannot know that an approver's partner
 * works for the vendor, and a control that only catches what it can detect
 * gives an assurance it has not earned. What it can do is make the declaration
 * binding once made, and make its absence visible.
 */
export interface ConflictDeclaration extends Dated {
  principalId: string
  tenantId: string
  /** What the interest is in — a vendor, an org unit, a person. */
  subjectId: string
  /** Stated by the declarer. Required: a conflict nobody can describe is one nobody can review. */
  reason: string
}

/**
 * Standing down from one specific decision.
 *
 * Separate from a declaration on purpose. A declared interest is a fact about a
 * person; a recusal is an act about a decision. Collapsing them means either
 * every declaration blocks everything adjacent to it, or a recusal quietly
 * expires when the interest is reviewed.
 */
export interface Recusal {
  principalId: string
  tenantId: string
  resourceId: string
  reason: string
  at: ISODate
}

export function conflictHoldsAt(declaration: ConflictDeclaration, at: ISODate): boolean {
  const instant = Date.parse(at)
  if (Number.isNaN(instant)) return false
  const from = Date.parse(declaration.effectiveFrom)
  if (Number.isNaN(from) || instant < from) return false
  if (declaration.effectiveTo == null) return true
  const to = Date.parse(declaration.effectiveTo)
  return Number.isNaN(to) ? true : instant < to
}

/* ──────────────────────────────────────────────────────── the decision gate ── */

export type ControlRefusal =
  /** They raised it. */
  | "SELF_APPROVAL"
  /** They prepared it. Maker-checker: preparing and checking are different people. */
  | "SAME_MAKER"
  /** They stood down from this decision. */
  | "RECUSED"
  /** They hold a declared interest in something this decision touches. */
  | "DECLARED_CONFLICT"
  /** They already decided this at an earlier gate. */
  | "ALREADY_DECIDED"
  /** Two duties nobody may hold at once. */
  | "INCOMPATIBLE_DUTIES"

export interface ControlOutcome {
  ok: boolean
  refusal?: ControlRefusal
  detail?: string
}

const ALLOWED: ControlOutcome = { ok: true }

export interface DecisionUnderReview {
  resourceId: string
  tenantId: string
  /** Who raised it. */
  raisedByPrincipalId?: string | null
  /** Who prepared it, if that is somebody else. */
  preparedByPrincipalId?: string | null
  /** Subjects this decision touches — a vendor, the unit it spends from. */
  subjectIds?: readonly string[]
  /** Principals who have already decided at an earlier gate. */
  decidedByPrincipalIds?: readonly string[]
}

export interface ControlWorld {
  conflicts?: readonly ConflictDeclaration[]
  recusals?: readonly Recusal[]
  /** Permissions this principal holds, for the duties matrix. */
  permissionsHeld?: readonly string[]
  dutiesMatrix?: readonly IncompatibleDuties[]
}

/**
 * May this principal decide this?
 *
 * Ordered so the refusals that are about *them* come before the ones about
 * their duties: "you raised this" is a better answer than "your role combines
 * two duties", and both are true.
 */
export function mayDecide(
  principalId: string,
  decision: DecisionUnderReview,
  world: ControlWorld,
  at: ISODate,
): ControlOutcome {
  if (decision.raisedByPrincipalId === principalId) {
    return {
      ok: false,
      refusal: "SELF_APPROVAL",
      detail: "A request cannot be decided by the person who raised it.",
    }
  }

  if (decision.preparedByPrincipalId === principalId) {
    // Maker-checker. Preparing something and checking it are the same act done
    // twice by one pair of eyes, which is not a check.
    return {
      ok: false,
      refusal: "SAME_MAKER",
      detail:
        "This was prepared by you. Preparing something and checking it are the same act done " +
        "twice by one pair of eyes.",
    }
  }

  if (
    (world.recusals ?? []).some(
      (r) =>
        r.principalId === principalId &&
        r.tenantId === decision.tenantId &&
        r.resourceId === decision.resourceId,
    )
  ) {
    return {
      ok: false,
      refusal: "RECUSED",
      detail: "You stood down from this decision.",
    }
  }

  const subjects = new Set(decision.subjectIds ?? [])
  const conflict = (world.conflicts ?? []).find(
    (c) =>
      c.principalId === principalId &&
      c.tenantId === decision.tenantId &&
      subjects.has(c.subjectId) &&
      conflictHoldsAt(c, at),
  )
  if (conflict) {
    return {
      ok: false,
      refusal: "DECLARED_CONFLICT",
      detail: `You declared an interest in "${conflict.subjectId}": ${conflict.reason}`,
    }
  }

  if ((decision.decidedByPrincipalIds ?? []).includes(principalId)) {
    // Four-eyes across gates. One person approving at both ends of a two-gate
    // chain is a one-gate chain that took longer.
    return {
      ok: false,
      refusal: "ALREADY_DECIDED",
      detail:
        "You decided this at an earlier gate. Two gates cleared by one person is one gate that " +
        "took longer.",
    }
  }

  const violation = separationViolations(world.permissionsHeld ?? [], world.dutiesMatrix ?? [])[0]
  if (violation) {
    return { ok: false, refusal: "INCOMPATIBLE_DUTIES", detail: violation.detail }
  }

  return ALLOWED
}

/* ──────────────────────────────────────────────────── separation of duties ── */

/**
 * Two permissions nobody may hold at once.
 *
 * A pair rather than a group, so the refusal can name both sides. A group would
 * report "you hold three of these five", which nobody can act on.
 */
export interface IncompatibleDuties {
  id: string
  a: string
  b: string
  /** Why they are incompatible, in a sentence somebody can argue with. */
  reason: string
}

export interface DutiesViolation {
  id: string
  a: string
  b: string
  detail: string
}

/** Every pair held at once. All of them, because fixing one may not fix the next. */
export function separationViolations(
  permissionsHeld: readonly string[],
  matrix: readonly IncompatibleDuties[],
): readonly DutiesViolation[] {
  const held = new Set(permissionsHeld)
  const out: DutiesViolation[] = []
  for (const pair of matrix) {
    if (held.has(pair.a) && held.has(pair.b)) {
      out.push({
        id: pair.id,
        a: pair.a,
        b: pair.b,
        detail: `"${pair.a}" and "${pair.b}" may not be held together: ${pair.reason}`,
      })
    }
  }
  return out
}

/**
 * The pairs the platform ships.
 *
 * Deliberately short. A duties matrix that tries to be exhaustive is one nobody
 * reads, and every pair in it has to be defensible on its own — an
 * indefensible pair is worse than a missing one, because it gets exempted, and
 * an exemption mechanism is how the whole matrix stops meaning anything.
 */
export const INCOMPATIBLE_DUTIES: readonly IncompatibleDuties[] = [
  {
    id: "sod.fileAndApproveReimbursement",
    a: "finance.reimbursement.create",
    b: "finance.reimbursement.approve",
    reason:
      "one person able to do both leaves the self-approval rule as the only control, and that " +
      "rule only sees claims they filed under their own name",
  },
  {
    id: "sod.postAndApproveBudget",
    a: "finance.ledger.post",
    b: "finance.budget.approve",
    reason:
      "whoever records what was spent should not also be the one who decides the line it is " +
      "recorded against",
  },
  {
    id: "sod.decideAndOverride",
    a: "approvals.request.decide",
    b: "admin.override.execute",
    reason:
      "an approver who can also bypass approval has an approval gate only for as long as they " +
      "choose to use it",
  },
  {
    id: "sod.configureIdentityAndAdministerMembership",
    a: "identity.connection.configure",
    b: "identity.membership.invite",
    reason:
      "whoever decides which identity provider is trusted should not also be able to add the " +
      "accounts it vouches for",
  },
]

/* ────────────────────────────────────────────────────────────────── quorum ── */

export interface QuorumRule {
  /** How many distinct approvals are needed. */
  minimum: number
  /**
   * Approvals must come from this many distinct org units.
   *
   * Two approvals from the same team are two people who talk to each other
   * every day, which is what a quorum is trying not to be.
   */
  distinctOrgUnits?: number
  /** Every one of these roles must be represented among the approvals. */
  requiredRoleKeys?: readonly string[]
}

export interface CastApproval {
  principalId: string
  roleKey?: string
  orgUnitId?: string
  at: ISODate
}

export type QuorumShortfall =
  | "NOT_ENOUGH"
  | "NOT_ENOUGH_DISTINCT_UNITS"
  | "MISSING_REQUIRED_ROLE"
  | "IMPOSSIBLE_RULE"

export interface QuorumOutcome {
  met: boolean
  shortfall?: QuorumShortfall
  detail?: string
  /** Approvals that counted, after duplicates were dropped. */
  counted: number
}

/**
 * Is the quorum met?
 *
 * Counts **distinct principals**. One person approving twice is one approval;
 * counting the casts rather than the people is how a two-of-three rule is
 * satisfied by one determined person and a page refresh.
 *
 * A rule requiring more distinct units than approvals it requires is refused as
 * impossible rather than reported as unmet — the second reads as "keep
 * collecting approvals", and no number of them will ever satisfy it.
 */
export function quorumMet(
  approvals: readonly CastApproval[],
  rule: QuorumRule,
): QuorumOutcome {
  if (rule.minimum < 1) {
    return {
      met: false,
      shortfall: "IMPOSSIBLE_RULE",
      counted: 0,
      detail: "A quorum of fewer than one approval is not a quorum.",
    }
  }
  if (rule.distinctOrgUnits != null && rule.distinctOrgUnits > rule.minimum) {
    return {
      met: false,
      shortfall: "IMPOSSIBLE_RULE",
      counted: 0,
      detail:
        `This rule needs ${rule.distinctOrgUnits} distinct units from ${rule.minimum} approvals, ` +
        `which no number of approvals can satisfy.`,
    }
  }
  if ((rule.requiredRoleKeys?.length ?? 0) > rule.minimum) {
    return {
      met: false,
      shortfall: "IMPOSSIBLE_RULE",
      counted: 0,
      detail:
        `This rule needs ${rule.requiredRoleKeys?.length} roles represented among ${rule.minimum} ` +
        `approvals, which no number of approvals can satisfy.`,
    }
  }

  const byPrincipal = new Map<string, CastApproval>()
  for (const approval of approvals) {
    // First cast wins. The last one would let somebody change which unit or role
    // they counted under after seeing what the quorum was short of.
    if (!byPrincipal.has(approval.principalId)) byPrincipal.set(approval.principalId, approval)
  }
  const distinct = [...byPrincipal.values()]
  const counted = distinct.length

  if (counted < rule.minimum) {
    return {
      met: false,
      shortfall: "NOT_ENOUGH",
      counted,
      detail: `${counted} of ${rule.minimum} approvals.`,
    }
  }

  if (rule.distinctOrgUnits != null) {
    const units = new Set(distinct.map((a) => a.orgUnitId).filter((u) => u != null))
    if (units.size < rule.distinctOrgUnits) {
      return {
        met: false,
        shortfall: "NOT_ENOUGH_DISTINCT_UNITS",
        counted,
        detail:
          `Approvals came from ${units.size} unit(s); this decision needs ` +
          `${rule.distinctOrgUnits}.`,
      }
    }
  }

  for (const roleKey of rule.requiredRoleKeys ?? []) {
    if (!distinct.some((a) => a.roleKey === roleKey)) {
      return {
        met: false,
        shortfall: "MISSING_REQUIRED_ROLE",
        counted,
        detail: `No approval came from "${roleKey}", which this decision requires.`,
      }
    }
  }

  return { met: true, counted }
}

/* ───────────────────────────────────────────────────────────── thresholds ── */

/**
 * One rung: at or above this amount, this rule applies.
 *
 * Amounts in minor units, like everything else that touches money here.
 */
export interface ThresholdRung {
  /** Inclusive floor. */
  fromAmountCents: number
  rule: QuorumRule
  /** What this rung is for, shown when it is the one that applied. */
  label: string
}

export type LadderProblem = "EMPTY" | "NO_FLOOR" | "NOT_ASCENDING" | "DUPLICATE_FLOOR"

/**
 * Everything wrong with a ladder.
 *
 * `NO_FLOOR` is the one that matters. A ladder starting at 50,000 has nothing
 * to say about a 40,000 spend, and "no rung applied" reads as "no approval
 * needed" at every call site that forgets to check — which is the failure the
 * ladder exists to prevent, arriving through the ladder.
 */
export function ladderProblems(ladder: readonly ThresholdRung[]): readonly LadderProblem[] {
  const problems: LadderProblem[] = []
  if (ladder.length === 0) return ["EMPTY"]
  if (!ladder.some((r) => r.fromAmountCents <= 0)) problems.push("NO_FLOOR")

  const floors = ladder.map((r) => r.fromAmountCents)
  if (new Set(floors).size !== floors.length) problems.push("DUPLICATE_FLOOR")
  for (let i = 1; i < floors.length; i += 1) {
    if (floors[i] <= floors[i - 1]) {
      problems.push("NOT_ASCENDING")
      break
    }
  }
  return problems
}

/**
 * Which rung applies to this amount.
 *
 * The **highest** rung at or below it, and a malformed ladder returns nothing
 * rather than a guess. Callers must treat "no rung" as "cannot decide", which
 * `ladderProblems` exists to keep from ever being the answer in production.
 */
export function rungFor(
  amountCents: number,
  ladder: readonly ThresholdRung[],
): ThresholdRung | null {
  if (ladderProblems(ladder).length > 0) return null
  if (!Number.isFinite(amountCents)) return null

  // A negative amount is a credit, and it climbs no ladder — but it is not
  // nothing, so it takes the floor rung rather than none.
  const effective = Math.max(amountCents, 0)
  let best: ThresholdRung | null = null
  for (const rung of ladder) {
    if (rung.fromAmountCents <= effective) {
      if (best === null || rung.fromAmountCents > best.fromAmountCents) best = rung
    }
  }
  return best
}
