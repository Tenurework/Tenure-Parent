import {
  decide,
  ROLE_TEMPLATES,
  type AuthorizationWorld,
  type RoleGrant,
} from "@tenure/authorization"

import type { InstitutionRole } from "@prisma/client"

import type { UserContext } from "@/lib/rbac"

/**
 * GE-051-005 — a seat, as the authorization engine sees it.
 *
 * This is what `Role.templateKey` was added for. A seat is a **grant of a role
 * template at an org unit**, which is exactly the shape `decide()` already
 * takes, so the engine can answer for a club action without a second model
 * being invented for the application.
 *
 ## Institution roles
 *
 * They are not seats, so they are not in `seatWorld` — a world built there
 * answers questions about **club seats only**, which is what
 * `submitReimbursement` needs, because filing a claim is deliberately closed to
 * the oversight office.
 *
 * `institutionWorld` is the other half. The three roles get three templates
 * (`institution.advisor` / `.staff` / `.director`) because they genuinely
 * differ: a Director may manage a roster, Staff may not, an Advisor may not
 * publish resources. Mapping all three to one template would have been tidier
 * and would have widened two of them, which is a permission change wearing a
 * refactor's clothes.
 *
 * The sets were derived from `rbac.ts`'s predicates rather than from what the
 * roles ought to confer, and `institution-equivalence.test.ts` compares the two
 * answer by answer.
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

/**
 * The institution role each oversight template stands for.
 *
 * A closed map rather than a naming convention: `InstitutionRole` is a Prisma
 * enum, and a value added there with no entry here would otherwise resolve to
 * `undefined` and confer nothing — failing closed, silently, for a role
 * somebody had just created.
 */
export const INSTITUTION_TEMPLATES: Readonly<Record<InstitutionRole, string>> = {
  OSE_DIRECTOR: "institution.director",
  OSE_STAFF: "institution.staff",
  OSE_ADVISOR: "institution.advisor",
}

/**
 * Grants derived from the institution roles this person holds.
 *
 * Tenant-scoped, and that is the point of them: the oversight office's
 * authority is over every unit rather than one, which is exactly what a club
 * seat's `orgUnit` scope is not.
 */
export function institutionGrants(ctx: UserContext, tenantId: string): RoleGrant[] {
  return ctx.institutionRoles
    .filter((m) => m.institutionId === tenantId)
    .map((m) => ({
      principalId: ctx.userId,
      tenantId,
      roleKey: INSTITUTION_TEMPLATES[m.role],
      scope: { kind: "tenant" as const },
      state: "CONFIRMED" as const,
      effectiveFrom: EPOCH,
    }))
}

/**
 * The facts a decision about institution-wide authority rests on.
 *
 * Carries the club seats too. Somebody can hold both — an OSE staffer who is
 * also a club treasurer — and a world that dropped one of them would answer a
 * question about the other wrongly. `decide()` takes the union and the most
 * specific scope that covers the resource wins, which is what a person holding
 * two hats should get.
 */
export function institutionWorld(
  ctx: UserContext,
  tenantId: string,
  enabledModules: readonly string[],
): AuthorizationWorld {
  const base = seatWorld(ctx, tenantId, enabledModules)
  return { ...base, grants: [...base.grants, ...institutionGrants(ctx, tenantId)] }
}

/**
 * Does an institution role — or a club seat — confer this permission?
 *
 * `organizationId` is optional: institution authority is not about one unit, so
 * a question with no unit is scoped to the tenant and answered by the
 * tenant-scoped grants alone.
 */
export function decideAcrossInstitution(
  ctx: UserContext,
  request: { permission: string; tenantId: string; enabledModules: readonly string[]; organizationId?: string; at?: string },
) {
  return decide(institutionWorld(ctx, request.tenantId, request.enabledModules), {
    principalId: ctx.userId,
    tenantId: request.tenantId,
    permission: request.permission,
    resource: request.organizationId
      ? { type: "Organization", id: request.organizationId, orgUnitId: request.organizationId }
      : undefined,
    at: request.at ?? new Date().toISOString(),
  })
}
