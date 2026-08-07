import { cache } from "react";
import type {
  AssignmentStatus,
  InstitutionRole,
  OrgStatus,
  RoleScope,
} from "@prisma/client";
import { db } from "@/lib/db";
import { ROLE_TEMPLATES } from "@tenure/authorization";
import { seatState } from "@tenure/identity";

import { liveMembershipWhere } from "@/lib/identity/live-membership";
import { runUnscoped } from "@/lib/tenancy/context";

// ─── User context ─────────────────────────────────────────────────────────────

export interface OrgRole {
  organizationId: string;
  roleId: string;
  roleName: string;
  scope: RoleScope;
  status: AssignmentStatus;
  /**
   * The authority this seat carries (GE-051-005), as a role-template key.
   *
   * `roleName` is still here because the UI shows it. Nothing may decide from
   * it: a tenant renames a seat whenever it likes, and a rename that changes
   * what somebody may do is a permission change with no record and no date.
   */
  templateKey: string;
}

export interface UserContext {
  userId: string;
  /** Institution-level (OSE) memberships */
  institutionRoles: { institutionId: string; role: InstitutionRole }[];
  /** Club role assignments — all statuses, so callers can distinguish SHADOW/ALUMNI */
  orgRoles: OrgRole[];
}

/** Load everything permission checks need in one query round-trip per request. */
export const getUserContext = cache(
  async (userId: string): Promise<UserContext> => {
    // Reading a user's memberships is *how* a request works out which tenant it
    // belongs to, so it cannot itself require one — the bootstrap deadlock named
    // in ADR-0002. The grant also keeps this correct when it is called from
    // inside an open scope: permission checks need the user's whole membership
    // set, not the slice that happens to sit in the acting institution.
    const [memberships, assignments] = await runUnscoped(
      "auth-bootstrap",
      "getUserContext",
      () =>
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
            // GE-040-003. The term is read, not merely stored. `startDate` and
            // `endDate` existed in the schema and in no query: authority came from
            // `status` alone, and ALUMNI is only ever written by a person clicking,
            // so a seat whose term ended in June kept full authority until somebody
            // remembered. Bible §9.2 requires temporal rules for assignment
            // start/end boundaries; this is where they enter.
            where: { userId },
            select: {
              status: true,
              startDate: true,
              endDate: true,
              role: {
                select: {
                  id: true,
                  name: true,
                  scope: true,
                  organizationId: true,
                  templateKey: true,
                },
              },
            },
          }),
        ]),
    );

    return {
      userId,
      institutionRoles: memberships,
      // Filtered by the engine, not by a second copy of the rule written here.
      // The three statuses do not share one window rule — SHADOW is deliberately
      // live *before* its start date, because previewing before the term begins
      // is the whole point of it — and encoding that in a `where` clause would
      // have quietly deleted the feature while looking like a tightening.
      orgRoles: assignments
        .filter(
          (a) =>
            seatState(
              {
                id: a.role.id,
                personId: userId,
                organizationId: a.role.organizationId,
                tenantId: "",
                roleId: a.role.id,
                status: a.status,
                interval: {
                  effectiveFrom: a.startDate.toISOString(),
                  effectiveUntil: a.endDate?.toISOString() ?? null,
                },
              },
              new Date(),
            ).liveness.live,
        )
        .map((a) => ({
          organizationId: a.role.organizationId,
          roleId: a.role.id,
          roleName: a.role.name,
          scope: a.role.scope,
          status: a.status,
          templateKey: a.role.templateKey,
        })),
    };
  },
);

// ─── Pure permission checks (no DB — unit-testable) ──────────────────────────

/**
 * The club a permission check is about, as far as *reading* it is concerned.
 *
 * Reads stay on this shape deliberately: an archived club's history has to
 * remain fully visible (GE-085-004), so no read check may ever get to see the
 * status and be tempted to filter on it.
 */
export interface OrgRef {
  id: string;
  institutionId: string;
}

/**
 * The club a permission check is about, as far as *writing* to it is concerned.
 *
 * `status` is required rather than optional, and that is the whole point of the
 * type. `Organization.status` existed and was a display filter: `/orgs` and
 * `/admin/clubs` greyed an archived club out, and every write path — documents,
 * memory, budget lines, the roster — went on accepting changes to it, because
 * the authority checks took `{ id, institutionId }` and never looked. Making
 * the field optional would have fixed today's call sites and left tomorrow's
 * free to forget. Required means `tsc --noEmit` enumerates every write path
 * that reaches these checks, so a new one cannot be added without answering
 * the question.
 */
export interface OrgWriteTarget extends OrgRef {
  status: OrgStatus;
}

/**
 * GE-085-004. Archiving a club suspends what can be done to it, not what is
 * recorded about it.
 *
 * Only an ACTIVE club takes writes. ARCHIVED is the retired club whose record
 * is kept; PENDING is the one that has not been approved into existence yet,
 * and neither should be accumulating new documents, budget lines or seats. The
 * lifecycle transition itself does NOT come through here — `setClubStatus`
 * gates on `isOseDirector` directly — so a club can always be reactivated,
 * which a check written into these four predicates would otherwise have made
 * impossible.
 */
function acceptsWrites(org: OrgWriteTarget): boolean {
  return org.status === "ACTIVE";
}

/** Any OSE membership at this institution (Director, Staff, or Advisor). */
export function isOse(ctx: UserContext, institutionId: string): boolean {
  return ctx.institutionRoles.some((m) => m.institutionId === institutionId);
}

export function isOseDirector(
  ctx: UserContext,
  institutionId: string,
): boolean {
  return ctx.institutionRoles.some(
    (m) => m.institutionId === institutionId && m.role === "OSE_DIRECTOR",
  );
}

function orgRolesFor(ctx: UserContext, organizationId: string): OrgRole[] {
  return ctx.orgRoles.filter((r) => r.organizationId === organizationId);
}

/**
 * View an org's workspace and roster.
 * OSE sees every club; members see their own club while SHADOW (read-only
 * preview before term start) or ACTIVE. ALUMNI records are preserved but
 * access is revoked.
 */
export function canViewOrg(ctx: UserContext, org: OrgRef): boolean {
  if (isOse(ctx, org.institutionId)) return true;
  return orgRolesFor(ctx, org.id).some(
    (r) => r.status === "SHADOW" || r.status === "ACTIVE",
  );
}

/**
 * Manage the roster: create role seats, assign people, transition statuses.
 * OSE Director (institution-wide authority) or the club's ACTIVE President.
 * SHADOW presidents are read-only until their term begins.
 */
export function canManageRoster(
  ctx: UserContext,
  org: OrgWriteTarget,
): boolean {
  if (!acceptsWrites(org)) return false;
  if (isOseDirector(ctx, org.institutionId)) return true;
  return orgRolesFor(ctx, org.id).some(
    (r) => r.scope === "PRESIDENT" && r.status === "ACTIVE",
  );
}

/** List every organization at the institution (OSE-only view). */
export function canListAllOrgs(
  ctx: UserContext,
  institutionId: string,
): boolean {
  return isOse(ctx, institutionId);
}

/**
 * Manage a club's own profile — name, description, and image.
 * OSE (any club) or the club's ACTIVE President (their own). Used for the club
 * image feature: administrators for all clubs, club leaders for their own.
 */
export function canManageOrg(ctx: UserContext, org: OrgWriteTarget): boolean {
  if (!acceptsWrites(org)) return false;
  if (isOse(ctx, org.institutionId)) return true;
  return orgRolesFor(ctx, org.id).some(
    (r) => r.scope === "PRESIDENT" && r.status === "ACTIVE",
  );
}

/** Write to the org workspace (requests, events, documents) — ACTIVE members only. */
export function canContribute(ctx: UserContext, org: OrgWriteTarget): boolean {
  if (!acceptsWrites(org)) return false;
  if (isOse(ctx, org.institutionId)) return true;
  return orgRolesFor(ctx, org.id).some((r) => r.status === "ACTIVE");
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
export function canManageResources(
  ctx: UserContext,
  institutionId: string,
): boolean {
  return ctx.institutionRoles.some(
    (m) =>
      m.institutionId === institutionId &&
      (m.role === "OSE_DIRECTOR" || m.role === "OSE_STAFF"),
  );
}

/**
 * Does this seat carry authority over money?
 *
 * Read from the template the seat was given, never from its title. The previous
 * version tested a regular expression against `roleName`, which meant a club
 * calling the seat "Budget Lead" had somebody accountable for money who could
 * not touch it, and a club with a "Financial Inclusion Officer" — a diversity
 * seat — had somebody who could. Renaming a seat silently moved spending
 * authority, with no record and no date on either side of the change.
 */
export function carriesFinanceAuthority(seat: {
  templateKey: string;
}): boolean {
  return FINANCE_TEMPLATES.has(seat.templateKey);
}

/**
 * Templates whose bundle contains budget editing.
 *
 * Derived from the catalog rather than listed by hand, so a template that gains
 * or loses the permission changes this set with it. Two lists would disagree
 * eventually, and the disagreement would be silent.
 */
const FINANCE_TEMPLATES: ReadonlySet<string> = new Set(
  ROLE_TEMPLATES.filter((t) =>
    t.permissions.includes("finance.budget.update"),
  ).map((t) => t.key),
);

/**
 * See the club's finance dashboard. Read access is scoped to the club's own
 * members (SHADOW/ACTIVE seat holders) plus OSE oversight — same as every other
 * club tab. Editing stays locked to the people accountable for the money
 * (canManageFinance): VP of Finance, ACTIVE President, or OSE Director.
 */
export function canViewFinance(ctx: UserContext, org: OrgRef): boolean {
  return canViewOrg(ctx, org);
}

/**
 * Edit budget lines, upload a tracker, save a forecast. The people accountable
 * for the money: the club's ACTIVE VP of Finance (or equivalent), the ACTIVE
 * President, or the OSE Director. SHADOW holders preview but cannot write.
 */
export function canManageFinance(
  ctx: UserContext,
  org: OrgWriteTarget,
): boolean {
  if (!acceptsWrites(org)) return false;
  if (isOseDirector(ctx, org.institutionId)) return true;
  return orgRolesFor(ctx, org.id).some(
    (r) =>
      r.status === "ACTIVE" &&
      (r.scope === "PRESIDENT" || carriesFinanceAuthority(r)),
  );
}
