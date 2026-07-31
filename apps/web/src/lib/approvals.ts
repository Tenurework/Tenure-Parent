import type { ApprovalStatus } from "@prisma/client"
import { applyAction, availableActions as engineActions } from "@tenure/workflow"

import { canManageRoster, isOse, type UserContext } from "@/lib/rbac"
import { APPROVAL_ROLES, APPROVAL_WORKFLOW } from "@/lib/workflows/approval-definition"

/**
 * Approval state machine (blueprint §Approvals):
 *
 *   DRAFT ──submit──▶ PENDING_PRESIDENT ──approve──▶ PENDING_OSE ──approve──▶ APPROVED
 *                        │        ▲                     │
 *                        │        └──resubmit── NEEDS_CHANGES ◀──changes──┘
 *                        └──reject──▶ REJECTED  (either gate may reject)
 *
 *   Requester may cancel while DRAFT / PENDING_* / NEEDS_CHANGES.
 *   A president's own request skips their gate: submit → PENDING_OSE.
 */

export type ApprovalActionName =
  | "submit"
  | "approve"
  | "request_changes"
  | "reject"
  | "resubmit"
  | "cancel"

export interface ApprovalView {
  id: string
  status: ApprovalStatus
  submittedById: string
  organizationId: string
  institutionId: string
}

/** Role the actor plays for THIS request. */
export function actorRoles(ctx: UserContext, approval: ApprovalView) {
  const org = { id: approval.organizationId, institutionId: approval.institutionId }
  return {
    isRequester: ctx.userId === approval.submittedById,
    // The president gate: the club's ACTIVE president (OSE Director also
    // holds club-admin authority via canManageRoster).
    isPresident: ctx.orgRoles.some(
      (r) =>
        r.organizationId === approval.organizationId &&
        r.scope === "PRESIDENT" &&
        r.status === "ACTIVE"
    ),
    isOseGate: isOse(ctx, approval.institutionId),
    canAdmin: canManageRoster(ctx, org),
  }
}

/**
 * All actions the actor may take from the current state.
 *
 * Delegates to the workflow engine rather than switching on status. The gates,
 * their order and the president gate-skip all live in APPROVAL_WORKFLOW now, so
 * a second organization system gets a different flow by pinning a different
 * definition instead of by adding a branch here.
 *
 * The signature is unchanged on purpose: six call sites across actions.ts, the
 * detail page, the calendar and finance keep working untouched, which is what
 * makes this a substitution rather than a rewrite. approval-definition.test.ts
 * holds the pre-delegation switch as an oracle and compares this against it
 * across the full cross product of statuses and actor roles.
 */
export function availableActions(
  ctx: UserContext,
  approval: ApprovalView
): ApprovalActionName[] {
  return engineActions(APPROVAL_WORKFLOW, {
    state: approval.status,
    roles: workflowRolesFor(ctx, approval),
  }).map((a) => a.action as ApprovalActionName)
}

/** The roles this actor plays for THIS request, as the definition names them. */
function workflowRolesFor(ctx: UserContext, approval: ApprovalView): string[] {
  const { isRequester, isPresident, isOseGate } = actorRoles(ctx, approval)
  const roles: string[] = []
  if (isRequester) roles.push(APPROVAL_ROLES.requester)
  if (isPresident) roles.push(APPROVAL_ROLES.president)
  if (isOseGate) roles.push(APPROVAL_ROLES.oseGate)
  return roles
}

/**
 * Resolve the target status for an action, or null if illegal.
 * `requesterIsPresident` implements the gate-skip for presidents' own requests.
 *
 * Role-agnostic, as it always was: this answers where the flow GOES, and the
 * caller has already established that the actor may take the action (via
 * availableActions). Every role is therefore passed to the engine, so role
 * filtering cannot mask a routing answer.
 */
export function nextStatus(
  action: ApprovalActionName,
  current: ApprovalStatus,
  opts: { requesterIsPresident: boolean }
): ApprovalStatus | null {
  const result = applyAction(
    APPROVAL_WORKFLOW,
    {
      state: current,
      roles: [APPROVAL_ROLES.requester, APPROVAL_ROLES.president, APPROVAL_ROLES.oseGate],
      conditions: { requesterIsPresident: opts.requesterIsPresident },
    },
    action
  )
  return result.ok ? (result.to as ApprovalStatus) : null
}

/**
 * True when a write failed because someone else moved the request first.
 *
 * `actOnApproval` names the status it read in the `where` of its status update,
 * so the update matches no row exactly when another approver has already changed
 * it. Prisma reports that as P2025 ("record to update not found") — the same code
 * it uses for a genuinely missing record, which is why this is deliberately
 * narrow: it is only meaningful at a call site that added the status predicate,
 * and callers must not use it to swallow a real not-found.
 */
export function isConcurrentDecision(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2025"
  )
}

export const ACTION_LABELS: Record<ApprovalActionName, string> = {
  submit: "Submit for approval",
  approve: "Approve",
  request_changes: "Request changes",
  reject: "Reject",
  resubmit: "Resubmit",
  cancel: "Cancel request",
}
