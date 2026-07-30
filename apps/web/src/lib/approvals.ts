import type { ApprovalStatus } from "@prisma/client"
import { canManageRoster, isOse, type UserContext } from "@/lib/rbac"

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

/** All actions the actor may take from the current state. */
export function availableActions(
  ctx: UserContext,
  approval: ApprovalView
): ApprovalActionName[] {
  const { isRequester, isPresident, isOseGate } = actorRoles(ctx, approval)
  const actions: ApprovalActionName[] = []

  switch (approval.status) {
    case "DRAFT":
      if (isRequester) actions.push("submit", "cancel")
      break
    case "PENDING_PRESIDENT":
      if (isPresident) actions.push("approve", "request_changes", "reject")
      if (isRequester) actions.push("cancel")
      break
    case "PENDING_OSE":
      if (isOseGate) actions.push("approve", "request_changes", "reject")
      if (isRequester) actions.push("cancel")
      break
    case "NEEDS_CHANGES":
      if (isRequester) actions.push("resubmit", "cancel")
      break
    // APPROVED / REJECTED / CANCELLED are terminal
  }
  return actions
}

/**
 * Resolve the target status for an action, or null if illegal.
 * `requesterIsPresident` implements the gate-skip for presidents' own requests.
 */
export function nextStatus(
  action: ApprovalActionName,
  current: ApprovalStatus,
  opts: { requesterIsPresident: boolean }
): ApprovalStatus | null {
  switch (action) {
    case "submit":
      if (current !== "DRAFT") return null
      return opts.requesterIsPresident ? "PENDING_OSE" : "PENDING_PRESIDENT"
    case "resubmit":
      if (current !== "NEEDS_CHANGES") return null
      return opts.requesterIsPresident ? "PENDING_OSE" : "PENDING_PRESIDENT"
    case "approve":
      if (current === "PENDING_PRESIDENT") return "PENDING_OSE"
      if (current === "PENDING_OSE") return "APPROVED"
      return null
    case "request_changes":
      if (current === "PENDING_PRESIDENT" || current === "PENDING_OSE")
        return "NEEDS_CHANGES"
      return null
    case "reject":
      if (current === "PENDING_PRESIDENT" || current === "PENDING_OSE")
        return "REJECTED"
      return null
    case "cancel":
      if (
        current === "DRAFT" ||
        current === "PENDING_PRESIDENT" ||
        current === "PENDING_OSE" ||
        current === "NEEDS_CHANGES"
      )
        return "CANCELLED"
      return null
  }
}

export const ACTION_LABELS: Record<ApprovalActionName, string> = {
  submit: "Submit for approval",
  approve: "Approve",
  request_changes: "Request changes",
  reject: "Reject",
  resubmit: "Resubmit",
  cancel: "Cancel request",
}
