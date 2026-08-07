import type { ApprovalStatus, OrgStatus } from "@prisma/client";
import {
  mayDecide,
  type ControlOutcome,
  type ControlWorld,
  type ISODate,
} from "@tenure/authorization";
import {
  applyAction,
  availableActions as engineActions,
} from "@tenure/workflow";

import { acceptsWrites, canManageRoster, isOse, type UserContext } from "@/lib/rbac";
import {
  APPROVAL_ROLES,
  APPROVAL_WORKFLOW,
} from "@/lib/workflows/approval-definition";

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
 *   Neither gate is held by the person who raised the request — see
 *   `decisionControl`. That is what stops the gate-skip above from leaving a
 *   request with no second human on it at all.
 */

export type ApprovalActionName =
  "submit" | "approve" | "request_changes" | "reject" | "resubmit" | "cancel";

export interface ApprovalView {
  id: string;
  status: ApprovalStatus;
  submittedById: string;
  organizationId: string;
  institutionId: string;
  /**
   * The club's lifecycle status, carried on the view because the approval
   * actions are writes and an archived club takes none of them. Required
   * rather than optional so a new producer of this view has to answer the
   * question rather than inherit a default that silently re-opens the hole.
   */
  organizationStatus: OrgStatus;
}

/**
 * What this call site knows about standing declarations.
 *
 * Empty, and truthfully so: the schema has no ConflictDeclaration and no
 * Recusal model, so there are none to pass. `mayDecide` still answers
 * SELF_APPROVAL from the decision itself, which needs no world at all — the
 * world only feeds the DECLARED_CONFLICT / RECUSED / INCOMPATIBLE_DUTIES arms,
 * and this is the seam those get threaded through when they are persisted.
 */
const NO_STANDING_DECLARATIONS: ControlWorld = {};

/**
 * May this actor DECIDE this request, rather than merely having raised it?
 *
 * The rule is not re-implemented here. `mayDecide` in `@tenure/authorization`
 * is the platform's decision gate — self-approval, maker-checker, recusal,
 * declared conflicts, four-eyes across gates and the duties matrix, each
 * returning a named refusal instead of a bare boolean. It shipped with zero
 * callers in the app, which is the only reason this hole was open: an OSE
 * member who raised a request was still handed the OSE gate on it, so one
 * person could carry their own request from DRAFT to APPROVED with no second
 * human. (A president's own request already skips the president gate, so the
 * OSE gate was the only remaining pair of eyes.)
 *
 * `at` is a parameter rather than a fixed instant because the conflict arm is
 * time-bounded; with no declarations stored it changes no answer today, and
 * defaulting it keeps every existing call site unchanged.
 */
export function decisionControl(
  ctx: UserContext,
  approval: ApprovalView,
  at: ISODate = new Date().toISOString(),
): ControlOutcome {
  return mayDecide(
    ctx.userId,
    {
      resourceId: approval.id,
      tenantId: approval.institutionId,
      raisedByPrincipalId: approval.submittedById,
    },
    NO_STANDING_DECLARATIONS,
    at,
  );
}

/**
 * Role the actor plays for THIS request.
 *
 * The two gate roles are per-request standing, not standing facts about the
 * person: holding the president seat, or an institution membership, is what
 * makes you eligible for a gate, and `decisionControl` is what says whether you
 * hold it on THIS request. Deciding it here rather than in `availableActions`
 * puts the answer in the one place every reader of these roles already goes
 * through, so a caller cannot pick up `isOseGate` and act on it without the
 * control having run.
 */
export function actorRoles(ctx: UserContext, approval: ApprovalView) {
  const org = {
    id: approval.organizationId,
    institutionId: approval.institutionId,
    status: approval.organizationStatus,
  };
  // Roles are additive and the workflow engine matches them with `some()`, so
  // a disqualifier cannot be expressed as another role — it has to remove the
  // gate role itself, or being the requester would simply be one more role
  // alongside the one that approves.
  const mayGate = decisionControl(ctx, approval).ok;
  return {
    isRequester: ctx.userId === approval.submittedById,
    // The president gate: the club's ACTIVE president (OSE Director also
    // holds club-admin authority via canManageRoster).
    isPresident:
      mayGate &&
      ctx.orgRoles.some(
        (r) =>
          r.organizationId === approval.organizationId &&
          r.scope === "PRESIDENT" &&
          r.status === "ACTIVE",
      ),
    isOseGate: mayGate && isOse(ctx, approval.institutionId),
    // Not a gate. Roster administration is a standing capability, and an
    // archived club is what limits it — see canManageRoster.
    canAdmin: canManageRoster(ctx, org),
  };
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
  approval: ApprovalView,
): ApprovalActionName[] {
  return engineActions(APPROVAL_WORKFLOW, {
    state: approval.status,
    roles: workflowRolesFor(ctx, approval),
  }).map((a) => a.action as ApprovalActionName);
}

/**
 * The roles this actor plays for THIS request, as the definition names them.
 *
 * `requester` is pushed unconditionally — submit / resubmit / cancel are the
 * requester's own actions and stay theirs. The two gate roles come from
 * `actorRoles`, which has already run `decisionControl`, so the person who
 * raised the request arrives here holding `requester` and nothing else.
 */
function workflowRolesFor(ctx: UserContext, approval: ApprovalView): string[] {
  const { isRequester, isPresident, isOseGate } = actorRoles(ctx, approval);
  const roles: string[] = [];
  if (isRequester) roles.push(APPROVAL_ROLES.requester);
  if (isPresident) roles.push(APPROVAL_ROLES.president);
  if (isOseGate) roles.push(APPROVAL_ROLES.oseGate);
  return roles;
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
  opts: { requesterIsPresident: boolean },
): ApprovalStatus | null {
  const result = applyAction(
    APPROVAL_WORKFLOW,
    {
      state: current,
      roles: [
        APPROVAL_ROLES.requester,
        APPROVAL_ROLES.president,
        APPROVAL_ROLES.oseGate,
      ],
      conditions: { requesterIsPresident: opts.requesterIsPresident },
    },
    action,
  );
  return result.ok ? (result.to as ApprovalStatus) : null;
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
  );
}

export const ACTION_LABELS: Record<ApprovalActionName, string> = {
  submit: "Submit for approval",
  approve: "Approve",
  request_changes: "Request changes",
  reject: "Reject",
  resubmit: "Resubmit",
  cancel: "Cancel request",
};
