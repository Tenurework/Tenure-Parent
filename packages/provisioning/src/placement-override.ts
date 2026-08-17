import { classify, confirmationTokenFor, requirementsFor, type ChangeClass } from "./change-class"
import {
  GATES_ENFORCED_BY_ADMISSION,
  explain,
  type AppliedOverride,
  type CellPolicyEvaluation,
  type PlacementGate,
  type PlacementPolicyDecision,
} from "./placement-policy"

/**
 * GE-101-003 — the operator override, and what it is not allowed to be.
 *
 * A placement policy with no override is a policy that gets bypassed, because
 * the situations it refuses in include the ones somebody has to resolve at two
 * in the morning: a tenant migrating off a failing cell into one that is over
 * its cost ceiling, a region whose latency measurement is stale. An override
 * that is a boolean is the same thing with a worse audit trail.
 *
 * ## Four refusals that are the whole point
 *
 * `gate-not-overridable` — a boundary gate. Partition, region, classification,
 * regulation, isolation tier and key custody move bytes somewhere they may not
 * be, and no approval makes that reversible.
 *
 * `gate-not-blocking` — the gate passed, or was never demanded. An override for
 * a gate that is not refusing anything is a pre-authorization, and a
 * pre-authorization is a waiver with no expiry that nobody reviewed against a
 * real refusal.
 *
 * `gate-unverifiable` — the gate could not be checked. This is the one that
 * looks like an inconvenience and is not: waiving a *failure* is deciding to
 * accept a known cost, and waiving an *unknown* is deciding not to find out.
 * The fix for a gate nobody could check is to publish the fact, and an override
 * that accepted it would remove the only pressure to.
 *
 * `gate-enforced-by-admission` — capacity and residency are refused by
 * `choosePlacement`, which knows about the reserve and the fleet
 * recommendation. Waiving them here would produce a decision that says a cell
 * is eligible while admission still refuses it, which is worse than either
 * answer alone.
 *
 * ## Approval is not invented here
 *
 * A placement override routes a real tenant at a cell the policy refused, which
 * is exactly the C6 "customer-visible" class the change taxonomy already
 * defines — so it demands what C6 demands: two distinct people, and a typed
 * confirmation that names the cell. Reusing `requirementsFor` rather than
 * writing "requester !== approver" here means a change to the taxonomy reaches
 * this path instead of leaving it on the old rule.
 *
 * ## No clock
 *
 * `at` is a parameter. A caller that supplies both the expiry and the "now"
 * can satisfy any window instantly, which is why `change-class.ts` says the
 * same thing about cooling-off: the dispatcher compares against a persisted
 * time, and this function is given the time to compare against.
 */

/**
 * The class a placement override is held to.
 *
 * C6, from the taxonomy: it routes real users at a system, it is reversible by
 * moving the tenant, and it is not reversible before somebody noticed.
 */
export const OVERRIDE_CHANGE_CLASS: ChangeClass = classify({
  surface: "tenant-lifecycle",
  action: "ACTIVATING",
  target: "placement-override",
})

/**
 * The shortest reason accepted.
 *
 * A length, not a pattern. "ok" and "needed" are the reasons that get written
 * when a field is optional in practice, and the person reading the audit six
 * months later needs a sentence. Twenty characters is about one.
 */
export const MIN_OVERRIDE_REASON = 20

export interface OverrideRequest {
  cellId: string
  gates: readonly PlacementGate[]
  requestedBy: string
  reason: string
  /** ISO 8601. */
  requestedAt: string
  /** ISO 8601. An override with no end is a policy change nobody voted for. */
  expiresAt: string
}

export interface OverrideApproval {
  approvedBy: string
  /** ISO 8601. */
  approvedAt: string
  /** Must equal the token the class demands for this cell. */
  typedConfirmation: string
}

export type OverrideRefusal =
  | "unknown-cell"
  | "no-gates"
  | "gate-not-blocking"
  | "gate-not-overridable"
  | "gate-unverifiable"
  | "gate-enforced-by-admission"
  | "reason-too-short"
  | "self-approval"
  | "confirmation-mismatch"
  | "expired"
  | "expiry-before-request"

export interface OverrideProblem {
  field: string
  reason: OverrideRefusal
  detail: string
}

export class OverrideRefused extends Error {
  constructor(readonly problems: readonly OverrideProblem[]) {
    super(
      `The placement override was refused: ${problems.map((p) => `${p.field} — ${p.detail}`).join("; ")}`,
    )
    this.name = "OverrideRefused"
  }
}

/**
 * Everything wrong with this override, or an empty list.
 *
 * Every problem, not the first — an operator fixing one field at a time against
 * a form that reports one problem at a time is an operator who gives up and
 * asks somebody for the credentials instead.
 */
export function overrideProblems(
  decision: PlacementPolicyDecision,
  request: OverrideRequest,
  approval: OverrideApproval,
  at: string,
): readonly OverrideProblem[] {
  const problems: OverrideProblem[] = []
  const evaluation = decision.evaluations.find((e) => e.cellId === request.cellId)

  if (!evaluation) {
    problems.push({
      field: "cellId",
      reason: "unknown-cell",
      detail:
        `${request.cellId} was not among the ${decision.evaluations.length} cells this decision evaluated. ` +
        `An override for a cell the policy never considered would place a tenant somewhere nothing was checked.`,
    })
  }

  if (request.gates.length === 0) {
    problems.push({
      field: "gates",
      reason: "no-gates",
      detail:
        "An override waives named gates. One that names none is a request to ignore the policy, " +
        "which is not something this platform can grant.",
    })
  }

  if (evaluation) {
    for (const gate of request.gates) {
      const result = evaluation.gates.find((g) => g.gate === gate)
      if (GATES_ENFORCED_BY_ADMISSION.includes(gate)) {
        problems.push({
          field: `gates.${gate}`,
          reason: "gate-enforced-by-admission",
          detail:
            `${gate} is refused by fleet admission, not by this policy. Waiving it here would report the ` +
            `cell as eligible while admission still refuses it — raise the cell's reserve or its capacity instead.`,
        })
        continue
      }
      if (!result || !evaluation.blocking.includes(gate)) {
        problems.push({
          field: `gates.${gate}`,
          reason: "gate-not-blocking",
          detail:
            `${gate} is not refusing this placement, so there is nothing to waive. An override for a gate ` +
            `that is passing is a pre-authorization: a waiver with an expiry nobody set against a refusal nobody saw.`,
        })
        continue
      }
      if (result.verdict === "unverifiable") {
        problems.push({
          field: `gates.${gate}`,
          reason: "gate-unverifiable",
          detail:
            `${gate} could not be checked — ${result.observed}. Waiving a failure accepts a known cost; ` +
            `waiving this would be deciding not to find out. Publish the fact and evaluate again.`,
        })
        continue
      }
      if (!result.overridable) {
        problems.push({
          field: `gates.${gate}`,
          reason: "gate-not-overridable",
          detail:
            `${gate} decides where this tenant's data may exist. Once a byte has landed on the wrong side of ` +
            `it no later decision unlands it, so no approval waives it.`,
        })
      }
    }
  }

  if (request.reason.trim().length < MIN_OVERRIDE_REASON) {
    problems.push({
      field: "reason",
      reason: "reason-too-short",
      detail: `At least ${MIN_OVERRIDE_REASON} characters. The audit is read by somebody who was not here.`,
    })
  }

  const requirements = requirementsFor(OVERRIDE_CHANGE_CLASS, request.cellId)
  if (requirements.approvers === 2 && approval.approvedBy === request.requestedBy) {
    problems.push({
      field: "approvedBy",
      reason: "self-approval",
      detail:
        `A ${OVERRIDE_CHANGE_CLASS} change needs ${requirements.approvers} distinct people. ` +
        `${request.requestedBy} asked for this one.`,
    })
  }
  const token = confirmationTokenFor(OVERRIDE_CHANGE_CLASS, request.cellId)
  if (token !== null && approval.typedConfirmation !== token) {
    problems.push({
      field: "typedConfirmation",
      reason: "confirmation-mismatch",
      // Never echoes what was typed. A confirmation that reports the near miss
      // teaches the next person what to paste.
      detail:
        `The approver must type the cell this override applies to. Compared exactly — a confirmation that ` +
        `accepts a near miss accepts a paste of the wrong cell's id.`,
    })
  }

  if (Date.parse(request.expiresAt) <= Date.parse(request.requestedAt)) {
    problems.push({
      field: "expiresAt",
      reason: "expiry-before-request",
      detail: "An override that expires at or before it was asked for has never been valid.",
    })
  } else if (Date.parse(at) >= Date.parse(request.expiresAt)) {
    problems.push({
      field: "expiresAt",
      reason: "expired",
      detail: `This override expired at ${request.expiresAt}. Ask again, so somebody decides again.`,
    })
  }

  return problems
}

/**
 * The decision with the waiver applied, or a refusal.
 *
 * Returns a NEW decision rather than mutating: the un-overridden evaluation is
 * the evidence for why an override was needed, and a caller that has to
 * reconstruct it has lost it. `override` on the result is what makes the
 * placement explainable afterwards — the cell, the gates, both people, the
 * expiry and the reason, on the same object as the gate results they waive.
 */
export function applyOverride(
  decision: PlacementPolicyDecision,
  request: OverrideRequest,
  approval: OverrideApproval,
  at: string,
): PlacementPolicyDecision {
  const problems = overrideProblems(decision, request, approval, at)
  if (problems.length > 0) throw new OverrideRefused(problems)

  const waived = new Set<PlacementGate>(request.gates)
  const evaluations = decision.evaluations.map((e) =>
    e.cellId === request.cellId ? waive(e, waived) : e,
  )

  const applied: AppliedOverride = {
    cellId: request.cellId,
    gates: [...request.gates],
    requestedBy: request.requestedBy,
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
    expiresAt: request.expiresAt,
    reason: request.reason.trim(),
  }

  return {
    ...decision,
    evaluations,
    eligibleCellIds: evaluations.filter((e) => e.eligible).map((e) => e.cellId),
    explanation: [
      ...explain(evaluations),
      `${request.cellId}: ${request.gates.join(", ")} waived by ${approval.approvedBy} at the request of ` +
        `${request.requestedBy}, expiring ${request.expiresAt} — ${request.reason.trim()}`,
    ],
    override: applied,
  }
}

/** The same evaluation with the named gates marked waived, recomputed. */
function waive(
  evaluation: CellPolicyEvaluation,
  waived: ReadonlySet<PlacementGate>,
): CellPolicyEvaluation {
  const gates = evaluation.gates.map((g) => (waived.has(g.gate) ? { ...g, waived: true as const } : g))
  const failed = evaluation.failed.filter((g) => !waived.has(g))
  const unverifiable = evaluation.unverifiable.filter((g) => !waived.has(g))
  const reported = evaluation.reported.filter((g) => !waived.has(g))
  const blocking = evaluation.blocking.filter((g) => !waived.has(g))
  return {
    ...evaluation,
    gates,
    failed,
    unverifiable,
    reported,
    blocking,
    eligible: blocking.length === 0,
    overridable: blocking.length > 0 && blocking.every((g) => gates.find((r) => r.gate === g)!.overridable),
  }
}
