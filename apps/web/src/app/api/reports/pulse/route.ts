import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"

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
  const ctx = await getUserContext(session.user.id)
  const institutionId = ctx.institutionRoles[0]?.institutionId
  if (!institutionId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }

  const [pendingPresident, pendingOse, publishedEvents, activeSeats, hardConflicts] = await Promise.all([
    db.approvalRequest.count({ where: { institutionId, status: "PENDING_PRESIDENT" } }),
    db.approvalRequest.count({ where: { institutionId, status: "PENDING_OSE" } }),
    db.event.count({ where: { institutionId, status: "PUBLISHED" } }),
    db.roleAssignment.count({ where: { status: "ACTIVE", role: { organization: { institutionId } } } }),
    db.conflictRecord.count({ where: { severity: "HARD", resolved: false, event: { institutionId } } }),
  ])

  return NextResponse.json(
    {
      pending: pendingPresident + pendingOse,
      publishedEvents,
      activeSeats,
      hardConflicts,
    },
    { headers: { "cache-control": "no-store" } }
  )
}
