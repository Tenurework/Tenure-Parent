import {
  decide,
  type AuthorizationWorld,
  type RoleDefinition,
  type RoleGrant,
} from "@tenure/authorization"

import type { UserContext } from "@/lib/rbac"

/**
 * The capability set navigation is filtered by, decided by the authorization
 * engine rather than by counting rows.
 *
 * What this replaces, in `(app)/layout.tsx`:
 *
 *     showReports={ctx.institutionRoles.length > 0}
 *     showAdmin={ctx.institutionRoles.length > 0}
 *
 * A role *count* is not a capability. It cannot express that a suspended member
 * keeps their row but loses their access, that a grant has effective dates, that
 * a capability belongs to a module this system does not run, or that one of the
 * three institution roles should see less than the others.
 *
 * **The outcome is deliberately unchanged today.** All three institution roles —
 * Director, Staff, Advisor — map to both navigation capabilities, because that
 * is exactly what `institutionRoles.length > 0` grants now. Narrowing Advisor is
 * a product decision about who should see the admin console, and smuggling it in
 * as a refactor would be a permission change nobody asked for. What changes is
 * that the decision is now *expressible*: narrowing it later is an edit to
 * INSTITUTION_ROLES below, not a new boolean threaded through the layout.
 *
 * These are navigation capabilities only. Hiding a link does not protect a
 * route; `admin/guard.ts` and `requireCapability` remain authoritative for what
 * a request may actually do, and are untouched.
 */

/** Capabilities that decide what appears in the menu. */
export const NAV_CAPABILITIES = {
  // Namespaced under the module that contributes the entry, not under a made-up
  // "institution" module. That is what makes module gating real: a permission is
  // `<module>.<action>`, so `administration.access` is denied outright when the
  // administration module is not enabled, and the link cannot appear in a system
  // that does not have the console behind it.
  administer: "administration.access",
  viewReports: "budgeting.viewReports",
} as const

/**
 * Institution roles as authorization roles.
 *
 * Deliberately flat, and deliberately identical across the three, to preserve
 * today's behaviour exactly. `admin/capabilities.ts` already models the real
 * Director ⊇ Staff ⊇ Advisor hierarchy for privileged *operations*; this is only
 * about which menu entries render, and duplicating that hierarchy here would
 * create a second source of truth for it.
 */
const INSTITUTION_ROLES: readonly RoleDefinition[] = [
  {
    key: "institution.OSE_DIRECTOR",
    permissions: [NAV_CAPABILITIES.administer, NAV_CAPABILITIES.viewReports],
  },
  {
    key: "institution.OSE_STAFF",
    permissions: [NAV_CAPABILITIES.administer, NAV_CAPABILITIES.viewReports],
  },
  {
    key: "institution.OSE_ADVISOR",
    permissions: [NAV_CAPABILITIES.administer, NAV_CAPABILITIES.viewReports],
  },
]

/**
 * Build a world from what the application actually stores.
 *
 * The schema has no membership state and no effective dates on institution
 * membership, so every membership is projected as ACTIVE from the epoch. That is
 * not a modelling choice being made here — it is the current schema, stated
 * plainly. When ADR-0004's programme adds those columns, this projection reads
 * them and the engine already knows what to do with them: the tests for
 * SUSPENDED and expired memberships pass today against fixtures.
 */
export function worldFor(
  ctx: UserContext,
  institutionId: string,
  enabledModules: readonly string[],
): AuthorizationWorld {
  const EPOCH = "1970-01-01T00:00:00Z"

  const memberships = ctx.institutionRoles
    .filter((m) => m.institutionId === institutionId)
    .map((m) => ({
      principalId: ctx.userId,
      tenantId: m.institutionId,
      state: "ACTIVE" as const,
      effectiveFrom: EPOCH,
    }))

  // A club officer with no institution membership is still a member of the
  // tenant — their seat is what makes them one. Without this they would resolve
  // to NO_MEMBERSHIP and see an empty menu, which is a behaviour change.
  if (memberships.length === 0 && ctx.orgRoles.length > 0) {
    memberships.push({
      principalId: ctx.userId,
      tenantId: institutionId,
      state: "ACTIVE" as const,
      effectiveFrom: EPOCH,
    })
  }

  const grants: RoleGrant[] = ctx.institutionRoles
    .filter((m) => m.institutionId === institutionId)
    .map((m) => ({
      principalId: ctx.userId,
      tenantId: institutionId,
      roleKey: `institution.${m.role}`,
      scope: { kind: "tenant" as const },
      state: "CONFIRMED" as const,
      effectiveFrom: EPOCH,
    }))

  return {
    principals: [{ id: ctx.userId, kind: "user" }],
    memberships,
    roles: INSTITUTION_ROLES,
    grants,
    enabledModules: [...enabledModules],
  }
}

/**
 * Which navigation capabilities this principal holds in this institution.
 *
 * Asks the same engine the routes will ask, so the menu and the routes cannot
 * drift apart into two different opinions about what someone can do.
 */
export function navigationCapabilitiesFor(
  ctx: UserContext,
  institutionId: string,
  enabledModules: readonly string[],
  at: string,
): Set<string> {
  const world = worldFor(ctx, institutionId, enabledModules)
  const out = new Set<string>()

  for (const permission of Object.values(NAV_CAPABILITIES)) {
    if (decide(world, { principalId: ctx.userId, tenantId: institutionId, permission, at }).allowed) {
      out.add(permission)
    }
  }
  return out
}
