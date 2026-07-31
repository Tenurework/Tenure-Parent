import type { Policy } from "./model"

/**
 * Separation of duties, as policies rather than as scattered `if` statements.
 *
 * The rule "you cannot approve your own request" is the one every approval
 * system needs and the one most often implemented four times, slightly
 * differently, at four call sites — and then missed at the fifth. As a policy it
 * is declared once, applies wherever the permission does, and produces a deny
 * reason support can read.
 *
 * These are functions, not a DSL. There is no rules engine yet, and a
 * half-finished expression language is worse than TypeScript for something this
 * load-bearing. What matters now is that they are pure and deterministic; when
 * the rules engine arrives these become its first test cases.
 */

/** A principal may not decide a request they raised. */
export const notOwnRequest: Policy = {
  id: "sod.notOwnRequest",
  permission: "approvals.decide",
  effect: "deny",
  description: "A request cannot be decided by the person who raised it.",
  condition: (ctx) =>
    ctx.resource?.createdByPrincipalId != null &&
    ctx.resource.createdByPrincipalId === ctx.principal.id,
}

/** A principal may not approve their own reimbursement claim. */
export const notOwnReimbursement: Policy = {
  id: "sod.notOwnReimbursement",
  permission: "reimbursements.approve",
  effect: "deny",
  description: "A reimbursement cannot be approved by the person claiming it.",
  condition: (ctx) =>
    ctx.resource?.createdByPrincipalId != null &&
    ctx.resource.createdByPrincipalId === ctx.principal.id,
}

export const SEPARATION_OF_DUTIES: readonly Policy[] = [notOwnRequest, notOwnReimbursement]
