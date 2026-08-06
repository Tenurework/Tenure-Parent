/**
 * May this person use somebody else's authority on this request?
 *
 * Its own function because the answer is the whole of a security decision and
 * the action it came out of talks to a database, which would have made every
 * assertion about it an integration test.
 *
 * ## What went wrong without it
 *
 * `effectiveApprovalContext` concatenates the delegator's seats onto the
 * borrower's context while keeping the borrower's identity — deliberately, so
 * that `isRequester` stays correct. But `workflowRolesFor` then pushes BOTH
 * `requester` and the borrowed `president`, roles are additive, and the workflow
 * engine matches them with `some()`. So `isRequester` was preserved and never
 * consulted as a disqualifier: acquiring an approving role could not be
 * cancelled by also being the person who asked.
 *
 * Any ACTIVE member of a club is an eligible backup approver, and naming one is
 * a normal, encouraged action. So a president naming a backup handed that member
 * the ability to approve their own reimbursement at the president gate.
 *
 * The borrowing branch is reached ONLY when the direct check has already
 * refused — so it fired precisely in the case the direct rules had just denied.
 *
 * Delegation lends authority. It does not lend the standing to use it on
 * yourself.
 */
export function mayBorrowAuthority(input: {
  actorId: string
  requestedByPrincipalId: string | null | undefined
}): { ok: boolean; refusal?: "OWN_REQUEST" | "UNKNOWN_REQUESTER"; detail?: string } {
  if (input.requestedByPrincipalId == null || input.requestedByPrincipalId === "") {
    // Fail closed. A request whose author cannot be established is the one case
    // where "is this your own?" has no answer, and borrowed authority is exactly
    // the wrong thing to hand somebody while that is true.
    return {
      ok: false,
      refusal: "UNKNOWN_REQUESTER",
      detail: "This request has no recorded author, so borrowed authority cannot be used on it.",
    }
  }
  if (input.actorId === input.requestedByPrincipalId) {
    return {
      ok: false,
      refusal: "OWN_REQUEST",
      detail:
        "A backup approver may not use borrowed authority on their own request. Delegation lends " +
        "authority, not the standing to use it on yourself.",
    }
  }
  return { ok: true }
}
