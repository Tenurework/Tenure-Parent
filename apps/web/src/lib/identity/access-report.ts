import { accessState, type AccessReport } from "@tenure/identity"

import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { runUnscoped } from "@/lib/tenancy/context"

import { toEngineMembership } from "./live-membership"

/**
 * GE-042-006 — why this person has no access, when they have none.
 *
 * ## Why this is deliberately unfiltered
 *
 * Every other membership read in this application filters to live rows, and
 * `tests/architecture/live-membership.test.mjs` enforces that. This one must
 * not. A live filter returns nothing for a suspended person, nothing for one
 * whose term ended, and nothing for a brand-new account — so the report would
 * say `NEVER_PLACED` to all three, which is the exact confusion it exists to
 * end.
 *
 * The rows it reads grant nothing. `accessState` never returns a tenant, only a
 * reason, and the caller still resolves what somebody may actually do through
 * the live-filtered path. Reading a revoked row to say "this was revoked" is
 * not the same act as honouring it.
 *
 * ## An institution membership is not the only way in
 *
 * Most people in this application have no `InstitutionMembership` row at all.
 * A club member holds a seat — a `RoleAssignment` on a `Role` in an
 * `Organization` — and `institutionCandidates` resolves their acting tenant
 * through that seat, which is why the switcher has always worked for them.
 *
 * Deciding from memberships alone told every one of them *you are not a member
 * of any organization yet*, on a page showing their own organization. The
 * end-to-end suite caught it; the integration test did not, because its
 * fixtures create membership rows and the people this breaks have none.
 *
 * `getUserContext` answers the seat question, already filtered to live seats by
 * the same engine rule every capability check uses — so this reads authority
 * from where authority lives rather than restating the rule.
 *
 * ## Why it is a function rather than a query in the route
 *
 * The integration test would otherwise assert against its own copy of the
 * query, and a regression that filtered the route's rows to live ones would
 * leave that copy — and the test — untouched. Both call this.
 */
export async function accessReportFor(userId: string): Promise<AccessReport> {
  const [memberships, ctx] = await Promise.all([
    runUnscoped("auth-bootstrap", `accessReportFor(${userId})`, () =>
      db.institutionMembership.findMany({
        where: { userId },
        select: {
          id: true,
          userId: true,
          institutionId: true,
          status: true,
          effectiveFrom: true,
          effectiveUntil: true,
          statusReason: true,
        },
      }),
    ),
    getUserContext(userId),
  ])

  return accessState(memberships.map(toEngineMembership), new Date(), {
    otherLiveAccess: ctx.orgRoles.length > 0,
  })
}
