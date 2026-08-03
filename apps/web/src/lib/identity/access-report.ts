import { accessState, type AccessReport } from "@tenure/identity"

import { db } from "@/lib/db"
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
 * ## Why it is a function rather than a query in the route
 *
 * The integration test would otherwise assert against its own copy of the
 * query, and a regression that filtered the route's rows to live ones would
 * leave that copy — and the test — untouched. Both call this.
 */
export async function accessReportFor(userId: string): Promise<AccessReport> {
  const memberships = await runUnscoped("auth-bootstrap", `accessReportFor(${userId})`, () =>
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
  )

  return accessState(memberships.map(toEngineMembership), new Date())
}
