import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import { OPEN_APPROVAL_STATUSES } from "@/lib/analytics/metrics"

export const dynamic = "force-dynamic"

/**
 * Lightweight live-metrics endpoint for the Reports "Live now" strip. OSE-only,
 * mirrors the headline counts on /reports so the tiles can poll and update
 * without a full page reload. No-store so every poll is fresh.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  }
  const userId = session.user.id

  return withTenantScope(userId, async () => {
    const ctx = await getUserContext(userId)
    const institutionId = ctx.institutionRoles[0]?.institutionId
    if (!institutionId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    // ANL-000-002. The statuses that mean "waiting on a decision" are defined in
    // `lib/analytics/metrics.ts`, not written out here. This route's numbers
    // replace the ones `/reports` server-rendered fifteen seconds earlier, so a
    // status added to the workflow in one place and not the other would show a
    // reader the count changing on its own with nothing having happened.
    const [pending, publishedEvents, activeSeats, hardConflicts] = await Promise.all([
      db.approvalRequest.count({
        where: { institutionId, status: { in: [...OPEN_APPROVAL_STATUSES] } },
      }),
      db.event.count({ where: { institutionId, status: "PUBLISHED" } }),
      db.roleAssignment.count({ where: { status: "ACTIVE", role: { organization: { institutionId } } } }),
      db.conflictRecord.count({ where: { severity: "HARD", resolved: false, event: { institutionId } } }),
    ])

    return NextResponse.json(
      {
        pending,
        publishedEvents,
        activeSeats,
        hardConflicts,
      },
      { headers: { "cache-control": "no-store" } }
    )
  })
}
