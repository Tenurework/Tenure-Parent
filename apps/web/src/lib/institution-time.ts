import "server-only"
import { cache } from "react"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { DEFAULT_TIME_ZONE, safeZone } from "@/lib/time"

/**
 * Resolves the timezone a given request should render instants in.
 *
 * Every calendar-facing server component goes through here rather than reaching
 * for `timeZone: "UTC"` or the server's own clock — production runs in UTC, so
 * server-local formatting silently shifts every time an officer sees. Cached
 * per request by `react/cache`, so a page that formats fifty timestamps still
 * issues one query.
 */

export const institutionTimeZone = cache(async (institutionId: string): Promise<string> => {
  const inst = await db.institution.findUnique({
    where: { id: institutionId },
    select: { timeZone: true },
  })
  return safeZone(inst?.timeZone)
})

/**
 * The zone for the institution a viewer belongs to — their OSE institution if
 * they have one, otherwise the institution behind their club seats. Falls back
 * to the platform default for a user with no affiliation yet.
 */
export const viewerTimeZone = cache(async (userId: string): Promise<string> => {
  const ctx = await getUserContext(userId)
  if (ctx.institutionRoles.length > 0) {
    return institutionTimeZone(ctx.institutionRoles[0].institutionId)
  }
  const orgIds = [...new Set(ctx.orgRoles.map((r) => r.organizationId))]
  if (orgIds.length === 0) return DEFAULT_TIME_ZONE
  const org = await db.organization.findFirst({
    where: { id: { in: orgIds } },
    // Stable pick so a multi-club member always resolves the same zone.
    orderBy: { id: "asc" },
    select: { institution: { select: { timeZone: true } } },
  })
  return safeZone(org?.institution.timeZone)
})
