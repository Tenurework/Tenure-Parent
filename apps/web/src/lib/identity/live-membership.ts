import type { Prisma } from "@prisma/client"

import { membershipLiveness, type TenantMembership } from "@tenure/identity"

/**
 * GE-040-001 — the one definition of "is a member right now", as a query.
 *
 * `@tenure/identity`'s `membershipLiveness` is the authority, and it takes a
 * membership in hand. Most of this application needs the same question answered
 * by the database instead — "who are the directors", "which staff get notified"
 * — and asking Postgres for every row to filter nine of them in JavaScript is
 * not a real option.
 *
 * So this is the same rule expressed as a `where` fragment, in one place. The
 * duplication is real and deliberate; what makes it safe is that
 * `live-membership.test.ts` runs both against the same fixtures and fails when
 * they disagree. Two definitions that are checked against each other are a
 * different thing from two definitions.
 *
 * ## Why this exists at all
 *
 * Membership used to be a row that existed or did not, and revoking deleted it.
 * Now it is effective-dated, which means **every read that means "current
 * members" has to say so**. A read that forgets is not a subtle bug: a revoked
 * director still counts toward the last-director guard, a departed staff member
 * still receives notifications, and the change that was supposed to improve the
 * audit trail has quietly widened access instead.
 *
 * `tests/architecture/live-membership.test.mjs` refuses a membership query that
 * neither uses this fragment nor is exempted with a stated reason.
 */

/**
 * Rows that grant membership at `at`.
 *
 * Mirrors `membershipLiveness`: status must be ACTIVE, the window must have
 * opened, and it must not have closed. `effectiveUntil: null` is open-ended, so
 * it passes.
 */
export function liveMembershipWhere(at: Date = new Date()): Prisma.InstitutionMembershipWhereInput {
  return {
    status: "ACTIVE",
    effectiveFrom: { lte: at },
    // Half-open, matching the engine: an interval ending at 17:00 is not live
    // at 17:00, so one ending exactly where the next begins leaves no gap and
    // no overlap.
    OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }],
  }
}

/** The shape the engine reasons about, from the shape Prisma returns. */
export function toEngineMembership(row: {
  id: string
  userId: string
  institutionId: string
  status: string
  effectiveFrom: Date
  effectiveUntil: Date | null
  statusReason: string | null
}): TenantMembership {
  return {
    id: row.id,
    personId: row.userId,
    tenantId: row.institutionId,
    // Every membership that predates GE-040-001 was created by a grant through
    // the admin console, which is the operator path.
    origin: "OPERATOR",
    status: row.status as TenantMembership["status"],
    interval: {
      effectiveFrom: row.effectiveFrom.toISOString(),
      effectiveUntil: row.effectiveUntil?.toISOString() ?? null,
    },
    statusReason: row.statusReason,
  }
}

/** Whether a row read without the filter is live, using the engine itself. */
export function isLive(
  row: Parameters<typeof toEngineMembership>[0],
  at: Date = new Date(),
): boolean {
  return membershipLiveness(toEngineMembership(row), at).live
}
