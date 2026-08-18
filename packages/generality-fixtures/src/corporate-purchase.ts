import {
  mayDecide,
  rungFor,
  ladderProblems,
  type ControlRefusal,
  type ControlWorld,
  type ISODate,
  type ThresholdRung,
} from "@tenure/authorization"
import {
  delegationAllows,
  type Delegation,
  type DelegationVerdict,
} from "@tenure/organization-model"
import {
  applyAction,
  availableActions,
  publishDefinition,
  type AvailableAction,
  type TransitionRefusal,
  type WorkflowDefinition,
} from "@tenure/workflow"

import { CORPORATE_SEAT_LADDER, rungByKey, type CorporateRung } from "./corporate-org"

/**
 * GE-052-003 — the corporate purchase chain: amount thresholds, a department
 * gate, a finance gate, a procurement gate, delegation, and self-approval
 * denied.
 *
 * Everything load-bearing here is a call into a shipped platform module. The
 * ladder is `rungFor`, the gates are `@tenure/workflow`, the refusals are
 * `mayDecide`, and a borrowed gate is `delegationAllows`. That is deliberate
 * and it is what GE-052-004 rests on: if this file re-implemented any of the
 * four, the corporate fixture would prove the platform can be COPIED for a
 * second organization shape rather than CONFIGURED for one.
 *
 * What is genuinely new is the composition — which gates a given amount has to
 * clear, and in which order the three engines get consulted.
 */

/* ─────────────────────────────────────────────────────────────── the gates ── */

export const CORPORATE_GATES = {
  requester: "requester",
  /** The manager who runs the department the spend lands in. */
  departmentGate: "departmentGate",
  /** The director who owns the business unit's P&L. */
  financeGate: "financeGate",
  /** The executive who signs what the company is committed to. */
  procurementGate: "procurementGate",
} as const

export type CorporateGate =
  (typeof CORPORATE_GATES)[keyof typeof CORPORATE_GATES]

/**
 * The lowest ladder rung that may hold each gate.
 *
 * Ranks, not titles — see `CorporateRung.rank`. A higher rung reaches a lower
 * gate, which is how escalation works everywhere and is also the reason
 * `mayDecide`'s ALREADY_DECIDED arm matters here: a director reaches both the
 * department gate and the finance gate, and taking both is one gate that took
 * longer.
 */
export const GATE_MINIMUM_RANK: Readonly<Record<CorporateGate, number>> = {
  requester: 0,
  departmentGate: 1,
  financeGate: 2,
  procurementGate: 3,
}

/**
 * The priced ladder, in minor units of the tenant's currency.
 *
 * `requiredRoleKeys` is the single source of truth for which gates an amount
 * has to clear — `gatesForAmount` reads it rather than restating the chain, so
 * a rung whose rule and whose gate list disagreed is not a state this file can
 * be in.
 *
 * `distinctOrgUnits` on the upper two rungs is the point of a corporate chain
 * over a two-gate one: the department that wants the spend and the business
 * unit that funds it are different bodies, and two approvals from inside the
 * same department are two people who sit together.
 */
export const CORPORATE_PURCHASE_LADDER: readonly ThresholdRung[] = [
  {
    fromAmountCents: 0,
    label: "Departmental spend",
    rule: { minimum: 1, requiredRoleKeys: [CORPORATE_GATES.departmentGate] },
  },
  {
    // $5,000.00
    fromAmountCents: 500_000,
    label: "Business-unit spend",
    rule: {
      minimum: 2,
      distinctOrgUnits: 2,
      requiredRoleKeys: [CORPORATE_GATES.departmentGate, CORPORATE_GATES.financeGate],
    },
  },
  {
    // $50,000.00
    fromAmountCents: 5_000_000,
    label: "Company commitment",
    rule: {
      minimum: 3,
      distinctOrgUnits: 2,
      requiredRoleKeys: [
        CORPORATE_GATES.departmentGate,
        CORPORATE_GATES.financeGate,
        CORPORATE_GATES.procurementGate,
      ],
    },
  },
]

/**
 * Which gates this amount has to clear, or `null` when that cannot be answered.
 *
 * `null` is not "no gates". `rungFor` returns nothing for a malformed ladder or
 * a non-finite amount, and reporting that as an empty gate list is the exact
 * collapse this codebase keeps finding: "we looked and it needs nobody" and "we
 * could not look" would then be the same value, and the second is how an
 * unpriced purchase walks through.
 */
export function gatesForAmount(amountCents: number): readonly CorporateGate[] | null {
  const rung = rungFor(amountCents, CORPORATE_PURCHASE_LADDER)
  if (rung === null) return null
  const gates = rung.rule.requiredRoleKeys
  if (gates === undefined || gates.length === 0) return null
  return gates as readonly CorporateGate[]
}

/** The rung whose label an explanation should cite, or `null`. */
export function rungForAmount(amountCents: number): ThresholdRung | null {
  return rungFor(amountCents, CORPORATE_PURCHASE_LADDER)
}

/**
 * The named booleans the definition's `when`/`unless` refer to.
 *
 * Derived from `gatesForAmount`, so the workflow and the ladder cannot drift:
 * there is one statement of which gates an amount needs, and the state machine
 * reads it.
 */
export function purchaseConditions(
  amountCents: number,
): Readonly<Record<string, boolean>> | null {
  const gates = gatesForAmount(amountCents)
  if (gates === null) return null
  return {
    withinDepartmentLimit: !gates.includes(CORPORATE_GATES.financeGate),
    requiresProcurement: gates.includes(CORPORATE_GATES.procurementGate),
  }
}

/* ───────────────────────────────────────────────────────── the definition ── */

/**
 * The corporate purchase flow.
 *
 * Structurally different from the pilot's — three gates rather than two, and
 * the escalation is driven by the ladder rather than by one published ceiling —
 * and it runs on the identical engine. That pair is the whole of GE-052-004:
 * two organization systems, one `applyAction`.
 *
 *   DRAFT ──submit──▶ PENDING_DEPARTMENT ──approve──▶ APPROVED        (small)
 *                              │
 *                              └──approve──▶ PENDING_FINANCE ──approve──▶ APPROVED
 *                                                   │
 *                                                   └──approve──▶ PENDING_PROCUREMENT ──approve──▶ APPROVED
 */
export const CORPORATE_PURCHASE_WORKFLOW: WorkflowDefinition = publishDefinition({
  key: "corporate-purchase",
  version: "1.0.0",
  name: "Purchase approval",
  initial: "DRAFT",
  states: [
    { key: "DRAFT", label: "Draft" },
    { key: "PENDING_DEPARTMENT", label: "Awaiting department manager" },
    { key: "PENDING_FINANCE", label: "Awaiting business-unit director" },
    { key: "PENDING_PROCUREMENT", label: "Awaiting procurement" },
    { key: "NEEDS_CHANGES", label: "Changes requested" },
    { key: "APPROVED", label: "Approved", terminal: true },
    { key: "REJECTED", label: "Rejected", terminal: true },
    { key: "CANCELLED", label: "Cancelled", terminal: true },
  ],
  transitions: [
    { action: "submit", from: "DRAFT", to: "PENDING_DEPARTMENT", allowedRoles: [CORPORATE_GATES.requester], label: "Submit for approval" },
    { action: "cancel", from: "DRAFT", to: "CANCELLED", allowedRoles: [CORPORATE_GATES.requester], label: "Cancel" },

    // Small spend clears at the department and is done; anything the ladder
    // prices above the departmental rung escalates. One action, split by the
    // condition — the same mechanism the pilot's president gate-skip uses.
    {
      action: "approve",
      from: "PENDING_DEPARTMENT",
      to: "APPROVED",
      when: "withinDepartmentLimit",
      allowedRoles: [CORPORATE_GATES.departmentGate],
      label: "Approve",
    },
    {
      action: "approve",
      from: "PENDING_DEPARTMENT",
      to: "PENDING_FINANCE",
      unless: "withinDepartmentLimit",
      allowedRoles: [CORPORATE_GATES.departmentGate],
      label: "Approve and send to finance",
    },
    { action: "request_changes", from: "PENDING_DEPARTMENT", to: "NEEDS_CHANGES", allowedRoles: [CORPORATE_GATES.departmentGate], label: "Request changes" },
    { action: "reject", from: "PENDING_DEPARTMENT", to: "REJECTED", allowedRoles: [CORPORATE_GATES.departmentGate], label: "Reject" },
    { action: "cancel", from: "PENDING_DEPARTMENT", to: "CANCELLED", allowedRoles: [CORPORATE_GATES.requester], label: "Cancel" },

    {
      action: "approve",
      from: "PENDING_FINANCE",
      to: "PENDING_PROCUREMENT",
      when: "requiresProcurement",
      allowedRoles: [CORPORATE_GATES.financeGate],
      label: "Approve and send to procurement",
    },
    {
      action: "approve",
      from: "PENDING_FINANCE",
      to: "APPROVED",
      unless: "requiresProcurement",
      allowedRoles: [CORPORATE_GATES.financeGate],
      label: "Approve",
    },
    { action: "request_changes", from: "PENDING_FINANCE", to: "NEEDS_CHANGES", allowedRoles: [CORPORATE_GATES.financeGate], label: "Request changes" },
    { action: "reject", from: "PENDING_FINANCE", to: "REJECTED", allowedRoles: [CORPORATE_GATES.financeGate], label: "Reject" },
    { action: "cancel", from: "PENDING_FINANCE", to: "CANCELLED", allowedRoles: [CORPORATE_GATES.requester], label: "Cancel" },

    { action: "approve", from: "PENDING_PROCUREMENT", to: "APPROVED", allowedRoles: [CORPORATE_GATES.procurementGate], label: "Approve" },
    { action: "request_changes", from: "PENDING_PROCUREMENT", to: "NEEDS_CHANGES", allowedRoles: [CORPORATE_GATES.procurementGate], label: "Request changes" },
    { action: "reject", from: "PENDING_PROCUREMENT", to: "REJECTED", allowedRoles: [CORPORATE_GATES.procurementGate], label: "Reject" },
    { action: "cancel", from: "PENDING_PROCUREMENT", to: "CANCELLED", allowedRoles: [CORPORATE_GATES.requester], label: "Cancel" },

    // Back to the bottom of the chain. A resubmitted request that re-entered
    // at the gate it left would keep an approval nobody gave to the new
    // version of it.
    { action: "resubmit", from: "NEEDS_CHANGES", to: "PENDING_DEPARTMENT", allowedRoles: [CORPORATE_GATES.requester], label: "Resubmit" },
    { action: "cancel", from: "NEEDS_CHANGES", to: "CANCELLED", allowedRoles: [CORPORATE_GATES.requester], label: "Cancel" },
  ],
})

/* ──────────────────────────────────────────────────── who plays which role ── */

/** Gates a rung reaches on its own authority. */
export function gatesOfRung(rung: CorporateRung | null): readonly CorporateGate[] {
  if (rung === null) return []
  return (Object.keys(GATE_MINIMUM_RANK) as CorporateGate[]).filter(
    (gate) => gate !== CORPORATE_GATES.requester && rung.rank >= GATE_MINIMUM_RANK[gate],
  )
}

export interface CorporateActor {
  principalId: string
  /** The ladder rung this person's seat is on, or `null` for none. */
  rungKey: string | null
  /** Did this person raise the purchase? */
  isRequester: boolean
}

/**
 * The workflow roles an actor plays for one purchase, on their own authority.
 *
 * The corporate analogue of the pilot's `workflowRolesFor`: a per-request
 * standing derived from a seat, not a standing fact about the person. An
 * unrecognised rung key confers nothing — `rungByKey` returns `null` and
 * `gatesOfRung(null)` is empty, so a typo fails closed.
 */
export function corporateWorkflowRoles(actor: CorporateActor): readonly string[] {
  const roles: string[] = []
  if (actor.isRequester) roles.push(CORPORATE_GATES.requester)
  roles.push(...gatesOfRung(rungByKey(actor.rungKey ?? "")))
  return roles
}

export interface DelegatedGates {
  roles: readonly CorporateGate[]
  verdict: DelegationVerdict
}

/**
 * The gates somebody borrows by holding a delegation, and why they borrowed
 * none.
 *
 * The delegate gets exactly the SOURCE seat's gates — never more, and never the
 * ones a rung above the source would reach. `delegationAllows` is what enforces
 * the six bounds (revoked, not yet effective, expired, unbounded, action not
 * delegated, source no longer live, exceeds source), and it is called on every
 * request rather than at grant time, so a director who loses their seat stops
 * lending the finance gate in the same instant.
 */
export function delegatedGates(
  delegation: Delegation,
  sourceRungKey: string | null,
  source: { actions: readonly string[]; live: boolean },
  request: { action: string; resourceId: string | null; at: Date },
): DelegatedGates {
  const verdict = delegationAllows(delegation, request, source)
  if (!verdict.ok) return { roles: [], verdict }
  return { roles: gatesOfRung(rungByKey(sourceRungKey ?? "")), verdict }
}

/* ───────────────────────────────────────────────── the composed decision ── */

export interface CorporatePurchase {
  requestId: string
  tenantId: string
  state: string
  /** Minor units. `NaN` or a non-finite value is unpriced, and is refused. */
  amountCents: number
  raisedByPrincipalId: string
  preparedByPrincipalId?: string | null
  /** What the decision touches — the vendor, the unit it spends from. */
  subjectIds?: readonly string[]
  /** Principals who cleared an earlier gate on this purchase. */
  decidedByPrincipalIds?: readonly string[]
}

export type PurchaseRefusal =
  | { ok: false; stage: "ladder"; reason: "NO_RUNG"; detail: string }
  | { ok: false; stage: "controls"; reason: ControlRefusal; detail: string }
  | { ok: false; stage: "workflow"; reason: TransitionRefusal["reason"]; detail: string }

export type PurchaseOutcome =
  | { ok: true; to: string; gates: readonly CorporateGate[] }
  | PurchaseRefusal

/** Actions that are a DECISION on somebody else's request. */
const DECIDING_ACTIONS = new Set(["approve", "reject", "request_changes"])

/**
 * Take an action on a purchase, or refuse with the stage and reason.
 *
 * Three engines, consulted in an order that is itself a decision:
 *
 *   1. the ladder, because an amount nobody can price has no chain at all and
 *      the honest answer is "we could not look";
 *   2. the controls, because "you raised this" is the answer somebody acts on,
 *      and it must be given even when they also happen to hold the gate;
 *   3. the state machine, which is the only one of the three that can say what
 *      the request becomes.
 *
 * The controls run only for actions that DECIDE. A requester cancelling their
 * own request is not self-approval, and refusing it as such would make the
 * self-approval rule the reason nobody can withdraw anything.
 */
export function decidePurchase(
  purchase: CorporatePurchase,
  actor: { principalId: string; roles: readonly string[] },
  world: ControlWorld,
  action: string,
  at: ISODate,
): PurchaseOutcome {
  const conditions = purchaseConditions(purchase.amountCents)
  if (conditions === null) {
    return {
      ok: false,
      stage: "ladder",
      reason: "NO_RUNG",
      detail:
        `No rung of the purchase ladder prices ${purchase.amountCents}. ` +
        `An unpriced purchase has no approval chain, which is not the same as needing none.`,
    }
  }

  if (DECIDING_ACTIONS.has(action)) {
    const control = mayDecide(
      actor.principalId,
      {
        resourceId: purchase.requestId,
        tenantId: purchase.tenantId,
        raisedByPrincipalId: purchase.raisedByPrincipalId,
        preparedByPrincipalId: purchase.preparedByPrincipalId ?? null,
        subjectIds: purchase.subjectIds ?? [],
        decidedByPrincipalIds: purchase.decidedByPrincipalIds ?? [],
      },
      world,
      at,
    )
    if (!control.ok) {
      return {
        ok: false,
        stage: "controls",
        reason: control.refusal as ControlRefusal,
        detail: control.detail ?? "Refused by the decision controls.",
      }
    }
  }

  const result = applyAction(
    CORPORATE_PURCHASE_WORKFLOW,
    { state: purchase.state, roles: actor.roles, conditions },
    action,
  )
  if (!result.ok) {
    return { ok: false, stage: "workflow", reason: result.reason, detail: result.detail }
  }

  return { ok: true, to: result.to, gates: gatesForAmount(purchase.amountCents) ?? [] }
}

/**
 * What this actor may do right now — for rendering, not for authorising.
 *
 * Returns nothing at all for an unpriced purchase, and that is the same
 * fail-closed answer `decidePurchase` gives: a UI that offered buttons the
 * decision path would refuse is a UI that reports a permissions failure as a
 * bug.
 */
export function availablePurchaseActions(
  purchase: CorporatePurchase,
  actor: { principalId: string; roles: readonly string[] },
  world: ControlWorld,
  at: ISODate,
): readonly AvailableAction[] {
  const conditions = purchaseConditions(purchase.amountCents)
  if (conditions === null) return []

  const offered = availableActions(CORPORATE_PURCHASE_WORKFLOW, {
    state: purchase.state,
    roles: actor.roles,
    conditions,
  })

  return offered.filter((a) =>
    DECIDING_ACTIONS.has(a.action)
      ? decidePurchase(purchase, actor, world, a.action, at).ok
      : true,
  )
}

/** The ladder itself must be well formed; a caller can assert it at boot. */
export function purchaseLadderProblems(): readonly string[] {
  return ladderProblems(CORPORATE_PURCHASE_LADDER)
}

/** Every rung key the seat ladder declares, lowest first. */
export const CORPORATE_RUNG_KEYS: readonly string[] = CORPORATE_SEAT_LADDER.map((r) => r.key)
