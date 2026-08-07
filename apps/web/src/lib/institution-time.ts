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

/**
 * Safe to memoize on `institutionId` alone: `Institution` is PLATFORM_GLOBAL
 * (`src/lib/tenancy/registry.ts`), so no tenant predicate is applied to this
 * read and the answer cannot vary with which scope happens to be open. Rule (1)
 * of the cache invariant stated beside `runInTenantScope`.
 */
export const institutionTimeZone = cache(async (institutionId: string): Promise<string> => {
  const inst = await db.institution.findUnique({
    where: { id: institutionId },
    select: { timeZone: true },
  })
  return safeZone(inst?.timeZone)
})

/**
 * The zone for the institution a viewer is acting in — their OSE institution if
 * they have one there, otherwise the institution behind their club seats. Falls
 * back to the platform default for a user with no affiliation yet.
 *
 * ## Why `institutionId` is a parameter and not derived
 *
 * `docs/architecture/REVIEW-FINDINGS.md:54`. This was `cache(async (userId) =>
 * ...)`, keyed on the viewer alone, and the fallback below reads
 * `Organization` — which is TENANT_SCOPED (`src/lib/tenancy/registry.ts`), so
 * under `TENANCY_ENFORCE=true` the query is filtered to whichever tenant was
 * open at the first call. A `React.cache()` memo lives for the whole request
 * and a tenant scope lives for a block, so the first caller's tenant was then
 * served to every later caller in that request, including one running inside a
 * different scope. For a person holding seats at two institutions in different
 * zones, that is the wrong clock on someone else's calendar.
 *
 * Carrying the tenant in the memo key is rule (2) of the invariant. It is a
 * required parameter rather than an optional one on purpose: the three callers
 * (`calendar/page.tsx`, `calendar/new/page.tsx`, `feed/page.tsx`) all already
 * receive `scope` from `withTenantScope`, and a parameter they may omit is one
 * `tsc` cannot make them pass.
 *
 * `getUserContext` is deliberately still keyed on the user alone: it runs under
 * an `auth-bootstrap` grant and returns the whole cross-tenant membership set on
 * purpose (rule (3)). The `institutionRoles` filter below is what narrows it to
 * this tenant.
 */
export const viewerTimeZone = cache(
  async (userId: string, institutionId: string): Promise<string> => {
    const ctx = await getUserContext(userId)
    // The membership at THIS institution, not `institutionRoles[0]`. The old
    // code took the first of a cross-tenant list, which for a two-institution
    // staffer resolved the same zone in both tenants.
    if (ctx.institutionRoles.some((m) => m.institutionId === institutionId)) {
      return institutionTimeZone(institutionId)
    }
    const orgIds = [...new Set(ctx.orgRoles.map((r) => r.organizationId))]
    if (orgIds.length === 0) return DEFAULT_TIME_ZONE
    const org = await db.organization.findFirst({
      // `institutionId` is stated rather than left to the query layer, so the
      // read is correct in observe mode too — enforcement is a configuration,
      // and a loader that is only right when it happens to be switched on is a
      // loader that is wrong in the environment it was tested in.
      where: { id: { in: orgIds }, institutionId },
      // Stable pick so a multi-club member always resolves the same zone.
      orderBy: { id: "asc" },
      select: { institution: { select: { timeZone: true } } },
    })
    // A viewer whose seats are all in other institutions has no club here; this
    // tenant's own zone is the honest answer, not another tenant's.
    if (!org) return institutionTimeZone(institutionId)
    return safeZone(org.institution.timeZone)
  },
)
