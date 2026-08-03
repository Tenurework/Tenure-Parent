import {
  decide,
  ROLE_TEMPLATES,
  type AuthorizationWorld,
  type RoleGrant,
} from "@tenure/authorization"

import type { UserContext } from "@/lib/rbac"

/**
 * GE-051-005 — a seat, as the authorization engine sees it.
 *
 * This is what `Role.templateKey` was added for. A seat is a **grant of a role
 * template at an org unit**, which is exactly the shape `decide()` already
 * takes, so the engine can answer for a club action without a second model
 * being invented for the application.
 *
 * ## What is deliberately not here
 *
 * **Institution (OSE) roles.** They are not seats and they do not map cleanly
 * onto the shipped templates: the three of them differ from each other in the
 * existing predicates — a Director may manage a roster, Staff may not, an
 * Advisor may not publish resources — and no template reproduces those three
 * shapes. Inventing templates to fit would be a permission change wearing a
 * refactor's clothes, and the call sites that need OSE keep their own check
 * until somebody decides what those three roles actually confer.
 *
 * So a world built here answers questions about **club seats only**, and a
 * caller that also wants to admit OSE has to say so.
 */

const EPOCH = "1970-01-01T00:00:00Z"

/**
 * Grants derived from the seats this person holds.
 *
 * A `SHADOW` seat becomes a `PENDING` grant rather than being dropped. Both
 * refuse, and the difference is the answer somebody gets: "your term has not
 * begun" instead of "you have no role here". Previewing before the term starts
 * is the whole point of SHADOW, and a denial that pretends the seat does not
 * exist is the one that generates a support ticket.
 */
export function seatGrants(ctx: UserContext, tenantId: string): RoleGrant[] {
  return ctx.orgRoles.map((seat) => ({
    principalId: ctx.userId,
    tenantId,
    roleKey: seat.templateKey,
    scope: { kind: "orgUnit" as const, orgUnitId: seat.organizationId },
    state: seat.status === "ACTIVE" ? ("CONFIRMED" as const) : ("PENDING" as const),
    effectiveFrom: EPOCH,
  }))
}

/**
 * The facts a decision about a club action rests on.
 *
 * Membership is projected ACTIVE from the epoch because the schema has neither
 * a membership state nor effective dates on it. That is the current schema
 * stated plainly, not a modelling choice made here — the engine already knows
 * what to do with both, and `authorization.test.ts` proves it against fixtures.
 */
export function seatWorld(
  ctx: UserContext,
  tenantId: string,
  enabledModules: readonly string[],
): AuthorizationWorld {
  return {
    principals: [{ id: ctx.userId, kind: "user" }],
    memberships:
      ctx.orgRoles.length > 0 || ctx.institutionRoles.length > 0
        ? [{ principalId: ctx.userId, tenantId, state: "ACTIVE", effectiveFrom: EPOCH }]
        : [],
    roles: ROLE_TEMPLATES,
    grants: seatGrants(ctx, tenantId),
    enabledModules: [...enabledModules],
  }
}

export interface SeatPermissionRequest {
  permission: string
  /** The club the action happens in. Scope is checked against it. */
  organizationId: string
  tenantId: string
  enabledModules: readonly string[]
  at?: string
}

/**
 * Does a seat this person holds confer this permission, in this club?
 *
 * Returns the whole decision rather than a boolean, because the reason is what
 * the caller shows. "You need an active role in this club" was the old message
 * for every refusal, including the one that should have said the module is off
 * and the one that should have said the term has not started.
 */
export function decideFromSeats(ctx: UserContext, request: SeatPermissionRequest) {
  return decide(seatWorld(ctx, request.tenantId, request.enabledModules), {
    principalId: ctx.userId,
    tenantId: request.tenantId,
    permission: request.permission,
    resource: { type: "Organization", id: request.organizationId, orgUnitId: request.organizationId },
    at: request.at ?? new Date().toISOString(),
  })
}
