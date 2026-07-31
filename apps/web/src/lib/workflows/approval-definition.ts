import { publishDefinition, type WorkflowDefinition } from "@tenure/workflow"

/**
 * The pilot's approval flow, expressed as a definition.
 *
 * This is a transcription of the state machine documented and implemented in
 * `lib/approvals.ts`, not a redesign. Every state, transition, gate and the
 * president gate-skip is reproduced exactly, and
 * `approval-definition.test.ts` proves equivalence across the full cross
 * product of states and actor roles rather than on a few examples.
 *
 * Doing it that way round matters. The value of moving a flow into data is that
 * a second organization system can have a different one; the risk is changing
 * the first one's behaviour while claiming to have merely moved it. An
 * exhaustive equivalence test is the only way to tell those apart.
 *
 *   DRAFT ──submit──▶ PENDING_PRESIDENT ──approve──▶ PENDING_OSE ──approve──▶ APPROVED
 *                        │        ▲                     │
 *                        │        └──resubmit── NEEDS_CHANGES ◀──changes──┘
 *                        └──reject──▶ REJECTED  (either gate may reject)
 *
 * A president's own request skips their own gate: submit → PENDING_OSE. That is
 * the `requesterIsPresident` condition, and it is the reason `when`/`unless`
 * exist on transitions at all.
 */

/** Roles an actor can play for one approval request. Resolved by the host. */
export const APPROVAL_ROLES = {
  requester: "requester",
  president: "president",
  oseGate: "oseGate",
} as const

export const APPROVAL_WORKFLOW: WorkflowDefinition = publishDefinition({
  key: "approval",
  version: "1.0.0",
  name: "Request approval",
  initial: "DRAFT",
  states: [
    { key: "DRAFT", label: "Draft" },
    { key: "PENDING_PRESIDENT", label: "Awaiting president" },
    { key: "PENDING_OSE", label: "Awaiting staff office" },
    { key: "NEEDS_CHANGES", label: "Changes requested" },
    { key: "APPROVED", label: "Approved", terminal: true },
    { key: "REJECTED", label: "Rejected", terminal: true },
    { key: "CANCELLED", label: "Cancelled", terminal: true },
  ],
  transitions: [
    // Submit: a president's own request skips their own gate. Two transitions
    // on one action, split by the condition — which is exactly what `when` and
    // `unless` are for.
    {
      action: "submit",
      from: "DRAFT",
      to: "PENDING_OSE",
      when: "requesterIsPresident",
      allowedRoles: [APPROVAL_ROLES.requester],
      label: "Submit for approval",
    },
    {
      action: "submit",
      from: "DRAFT",
      to: "PENDING_PRESIDENT",
      unless: "requesterIsPresident",
      allowedRoles: [APPROVAL_ROLES.requester],
      label: "Submit for approval",
    },

    { action: "cancel", from: "DRAFT", to: "CANCELLED", allowedRoles: [APPROVAL_ROLES.requester], label: "Cancel" },

    {
      action: "approve",
      from: "PENDING_PRESIDENT",
      to: "PENDING_OSE",
      allowedRoles: [APPROVAL_ROLES.president],
      label: "Approve",
    },
    {
      action: "request_changes",
      from: "PENDING_PRESIDENT",
      to: "NEEDS_CHANGES",
      allowedRoles: [APPROVAL_ROLES.president],
      label: "Request changes",
    },
    {
      action: "reject",
      from: "PENDING_PRESIDENT",
      to: "REJECTED",
      allowedRoles: [APPROVAL_ROLES.president],
      label: "Reject",
    },
    {
      action: "cancel",
      from: "PENDING_PRESIDENT",
      to: "CANCELLED",
      allowedRoles: [APPROVAL_ROLES.requester],
      label: "Cancel",
    },

    {
      action: "approve",
      from: "PENDING_OSE",
      to: "APPROVED",
      allowedRoles: [APPROVAL_ROLES.oseGate],
      label: "Approve",
    },
    {
      action: "request_changes",
      from: "PENDING_OSE",
      to: "NEEDS_CHANGES",
      allowedRoles: [APPROVAL_ROLES.oseGate],
      label: "Request changes",
    },
    {
      action: "reject",
      from: "PENDING_OSE",
      to: "REJECTED",
      allowedRoles: [APPROVAL_ROLES.oseGate],
      label: "Reject",
    },
    {
      action: "cancel",
      from: "PENDING_OSE",
      to: "CANCELLED",
      allowedRoles: [APPROVAL_ROLES.requester],
      label: "Cancel",
    },

    {
      action: "resubmit",
      from: "NEEDS_CHANGES",
      to: "PENDING_OSE",
      when: "requesterIsPresident",
      allowedRoles: [APPROVAL_ROLES.requester],
      label: "Resubmit",
    },
    {
      action: "resubmit",
      from: "NEEDS_CHANGES",
      to: "PENDING_PRESIDENT",
      unless: "requesterIsPresident",
      allowedRoles: [APPROVAL_ROLES.requester],
      label: "Resubmit",
    },
    {
      action: "cancel",
      from: "NEEDS_CHANGES",
      to: "CANCELLED",
      allowedRoles: [APPROVAL_ROLES.requester],
      label: "Cancel",
    },
  ],
})
