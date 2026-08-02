import { cache } from "react"
import type { AssignmentStatus, InstitutionRole, RoleScope } from "@prisma/client"
import { db } from "@/lib/db"
import { liveMembershipWhere } from "@/lib/identity/live-membership"
import { runUnscoped } from "@/lib/tenancy/context"

// ─── User context ─────────────────────────────────────────────────────────────

export interface OrgRole {
  organizationId: string
  roleId: string
  roleName: string
  scope: RoleScope
  status: AssignmentStatus
}

export interface UserContext {
  userId: string
  /** Institution-level (OSE) memberships */
  institutionRoles: { institutionId: string; role: InstitutionRole }[]
  /** Club role assignments — all statuses, so callers can distinguish SHADOW/ALUMNI */
  orgRoles: OrgRole[]
}

/** Load everything permission checks need in one query round-trip per request. */
export const getUserContext = cache(async (userId: string): Promise<UserContext> => {
  // Reading a user's memberships is *how* a request works out which tenant it
  // belongs to, so it cannot itself require one — the bootstrap deadlock named
  // in ADR-0002. The grant also keeps this correct when it is called from
  // inside an open scope: permission checks need the user's whole membership
  // set, not the slice that happens to sit in the acting institution.
  const [memberships, assignments] = await runUnscoped("auth-bootstrap", "getUserContext", () =>
    Promise.all([
      db.institutionMembership.findMany({
        // Live only, and this is the call site where it matters most: every
        // capability check in the application resolves through this list. An
        // unfiltered read would mean a revoked person keeps their institution
        // role — the effective-dating that was supposed to preserve history
        // would instead have preserved access (GE-040-001).
        where: { ...liveMembershipWhere(), userId },
        select: { institutionId: true, role: true },
        // Stable ordering so a multi-institution admin always resolves the same
        // acting institution (requireCapability defaults to institutionRoles[0]).
        orderBy: [{ institutionId: "asc" }],
      }),
      db.roleAssignment.findMany({
        where: { userId },
        select: {
          status: true,
          role: {
            select: { id: true, name: true, scope: true, organizationId: true },
          },
        },
      }),
    ]),
  )

  return {
    userId,
    institutionRoles: memberships,
    orgRoles: assignments.map((a) => ({
      organizationId: a.role.organizationId,
      roleId: a.role.id,
      roleName: a.role.name,
      scope: a.role.scope,
      status: a.status,
    })),
  }
})

// ─── Pure permission checks (no DB — unit-testable) ──────────────────────────

/** Any OSE membership at this institution (Director, Staff, or Advisor). */
export function isOse(ctx: UserContext, institutionId: string): boolean {
  return ctx.institutionRoles.some((m) => m.institutionId === institutionId)
}

export function isOseDirector(ctx: UserContext, institutionId: string): boolean {
  return ctx.institutionRoles.some(
    (m) => m.institutionId === institutionId && m.role === "OSE_DIRECTOR"
  )
}

function orgRolesFor(ctx: UserContext, organizationId: string): OrgRole[] {
  return ctx.orgRoles.filter((r) => r.organizationId === organizationId)
}

/**
 * View an org's workspace and roster.
 * OSE sees every club; members see their own club while SHADOW (read-only
 * preview before term start) or ACTIVE. ALUMNI records are preserved but
 * access is revoked.
 */
export function canViewOrg(
  ctx: UserContext,
  org: { id: string; institutionId: string }
): boolean {
  if (isOse(ctx, org.institutionId)) return true
  return orgRolesFor(ctx, org.id).some(
    (r) => r.status === "SHADOW" || r.status === "ACTIVE"
  )
}

/**
 * Manage the roster: create role seats, assign people, transition statuses.
 * OSE Director (institution-wide authority) or the club's ACTIVE President.
 * SHADOW presidents are read-only until their term begins.
 */
export function canManageRoster(
  ctx: UserContext,
  org: { id: string; institutionId: string }
): boolean {
  if (isOseDirector(ctx, org.institutionId)) return true
  return orgRolesFor(ctx, org.id).some(
    (r) => r.scope === "PRESIDENT" && r.status === "ACTIVE"
  )
}

/** List every organization at the institution (OSE-only view). */
export function canListAllOrgs(ctx: UserContext, institutionId: string): boolean {
  return isOse(ctx, institutionId)
}

/**
 * Manage a club's own profile — name, description, and image.
 * OSE (any club) or the club's ACTIVE President (their own). Used for the club
 * image feature: administrators for all clubs, club leaders for their own.
 */
export function canManageOrg(
  ctx: UserContext,
  org: { id: string; institutionId: string }
): boolean {
  if (isOse(ctx, org.institutionId)) return true
  return orgRolesFor(ctx, org.id).some(
    (r) => r.scope === "PRESIDENT" && r.status === "ACTIVE"
  )
}

/** Write to the org workspace (requests, events, documents) — ACTIVE members only. */
export function canContribute(
  ctx: UserContext,
  org: { id: string; institutionId: string }
): boolean {
  if (isOse(ctx, org.institutionId)) return true
  return orgRolesFor(ctx, org.id).some((r) => r.status === "ACTIVE")
}

/**
 * Publish, edit and retire board resources for the institution.
 *
 * The board-resource programme is OSE's: the Director owns it and staff
 * maintain it day to day. Advisors are read-only, matching their standing
 * everywhere else (they advise clubs, they do not set institution policy).
 *
 * This check exists because the resource board previously had no author at all
 * — resources were a hardcoded array, so the OSE Director, the very person
 * accountable for them, had no way to add one without a code change and a
 * deploy.
 */
export function canManageResources(ctx: UserContext, institutionId: string): boolean {
  return ctx.institutionRoles.some(
    (m) =>
      m.institutionId === institutionId &&
      (m.role === "OSE_DIRECTOR" || m.role === "OSE_STAFF")
  )
}

/** True if a seat name is a finance role (VP of Finance, treasurer, CFO/COO). */
export function isFinanceRole(roleName: string): boolean {
  return /financ|treasur|\bcfo\b|chief financ|chief operating|\bcoo\b/i.test(roleName)
}

/**
 * See the club's finance dashboard. Read access is scoped to the club's own
 * members (SHADOW/ACTIVE seat holders) plus OSE oversight — same as every other
 * club tab. Editing stays locked to the people accountable for the money
 * (canManageFinance): VP of Finance, ACTIVE President, or OSE Director.
 */
export function canViewFinance(
  ctx: UserContext,
  org: { id: string; institutionId: string }
): boolean {
  return canViewOrg(ctx, org)
}

/**
 * Edit budget lines, upload a tracker, save a forecast. The people accountable
 * for the money: the club's ACTIVE VP of Finance (or equivalent), the ACTIVE
 * President, or the OSE Director. SHADOW holders preview but cannot write.
 */
export function canManageFinance(
  ctx: UserContext,
  org: { id: string; institutionId: string }
): boolean {
  if (isOseDirector(ctx, org.institutionId)) return true
  return orgRolesFor(ctx, org.id).some(
    (r) =>
      r.status === "ACTIVE" &&
      (r.scope === "PRESIDENT" || isFinanceRole(r.roleName))
  )
}
