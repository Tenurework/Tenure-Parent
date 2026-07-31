import "server-only"
import { cache } from "react"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import {
  runInTenantScope,
  runUnscoped,
  TenantContextError,
  type TenantScope,
} from "@/lib/tenancy/context"

/**
 * Where a request acquires its tenant.
 *
 * `src/lib/tenancy/` is the mechanism: it can demand a scope, but it cannot
 * know how this application decides which one. That decision lives here,
 * deliberately in one file, because it is the same decision at every entry
 * point — there is no `middleware.ts`, so server actions, route handlers and
 * RSC pages each resolve tenancy for themselves, and the only thing that can
 * make sixty call sites agree is a helper they all call.
 *
 * A layout is not that helper. Next renders a page as `children` of its layout
 * rather than by calling it, so the page body runs outside anything the layout
 * wrapped — an `AsyncLocalStorage` scope opened in `(app)/layout.tsx` would
 * cover the layout's own queries and none of the page's. The scope has to be
 * opened in the body that does the work: the action body, the handler body, the
 * page component body.
 */

/**
 * The institutions a user could legitimately be acting for.
 *
 * OSE membership first, then the institutions behind their club seats. That is
 * the order `viewerTimeZone` and `resourceInstitutionFor` already use, kept
 * identical on purpose: centralising this must not change which institution any
 * existing user resolves to.
 *
 * Club seats are counted at every status, ALUMNI included. This decides which
 * tenant's rows the query layer filters to, not what the user may do with them
 * — RBAC is untouched and still answers that. Dropping ALUMNI here would strip
 * a past officer of the institution they can currently still read the feed of,
 * which is a permission change smuggled in as a tenancy change.
 */
const institutionCandidates = cache(async (userId: string): Promise<string[]> => {
  // Resolving which institutions a user belongs to is *how* a tenant is
  // determined, so this read cannot itself require one. That is the deadlock
  // `auth-bootstrap` exists for; see ADR-0002 and context.ts.
  return runUnscoped("auth-bootstrap", `resolveTenantScope(${userId})`, async () => {
    const ctx = await getUserContext(userId)

    // getUserContext already orders memberships by institutionId, so this is
    // the same pick the ~15 existing `institutionRoles[0]` call sites make.
    if (ctx.institutionRoles.length > 0) {
      return [...new Set(ctx.institutionRoles.map((m) => m.institutionId))]
    }

    const orgIds = [...new Set(ctx.orgRoles.map((r) => r.organizationId))]
    if (orgIds.length === 0) return []

    const orgs = await db.organization.findMany({
      where: { id: { in: orgIds } },
      // Stable ordering, so a multi-club member resolves the same institution
      // on every request rather than whichever row the planner returned first.
      orderBy: { id: "asc" },
      select: { institutionId: true },
    })
    return [...new Set(orgs.map((o) => o.institutionId))]
  })
})

/**
 * Ambiguity is reported once per process per user, not per request: a warning
 * that repeats on every page load is a warning nobody reads. Same reasoning as
 * the dedupe in the tenancy extension's observe-mode recorder.
 */
const warnedAmbiguous = new Set<string>()

function warnAmbiguous(userId: string, candidates: string[]) {
  if (warnedAmbiguous.has(userId)) return
  warnedAmbiguous.add(userId)
  console.warn(
    `[tenancy] ${userId} belongs to ${candidates.length} institutions ` +
      `(${candidates.join(", ")}) and there is no way for them to say which one they are ` +
      `acting as, so the first is used. This needs an explicit institution switcher; ` +
      `see resolveTenantScope().`,
  )
}

function scopeForUser(institutionId: string, userId: string): TenantScope {
  return { institutionId, actor: { principalId: userId, principalType: "user" } }
}

/**
 * The tenant a signed-in user is acting in.
 *
 * `institutionId` names the acting institution explicitly, for the call sites
 * that already accept one (`requireCapability({ institutionId })`) and for the
 * institution switcher this is waiting on. It is validated against the user's
 * own memberships every time: a caller-supplied institution is a request, not a
 * fact, and accepting one unchecked would let any signed-in account name any
 * tenant — the same shape of defect the chokepoint exists to close.
 *
 * KNOWN GAP — a user with more than one institution. Today the acting
 * institution is derived, and this preserves that: the first candidate wins.
 * That is not correct behaviour, it is the absence of a decision. The correct
 * behaviour is that the user chooses, the choice is persisted (a cookie or a
 * session claim), and every request validates it against membership — exactly
 * the `institutionId` argument below, fed from that choice. Building the
 * switcher is a product decision, not a refactor, so it is flagged rather than
 * guessed at; until it lands, an ambiguous resolution logs a warning naming the
 * user and the candidates so this is visible rather than silent. It is
 * unreachable in the pilot, which has one Institution row and no code path that
 * creates a second.
 *
 * Throws when the user has no institution at all. There is no honest scope for
 * a signed-in account with neither an OSE membership nor a club seat, and every
 * tenant-scoped query in the body would throw anyway once enforcement is on —
 * failing here, with a message that names the cause, beats failing five queries
 * in with one that does not.
 */
export const resolveTenantScope = cache(
  async (userId: string, institutionId?: string): Promise<TenantScope> => {
    const candidates = await institutionCandidates(userId)

    if (candidates.length === 0) {
      throw new TenantContextError(
        `${userId} holds no institution membership and no club seat, so there is no tenant to ` +
          `act in. An account in this state needs an onboarding path, not a tenant scope.`,
      )
    }

    if (institutionId !== undefined) {
      if (!candidates.includes(institutionId)) {
        throw new TenantContextError(
          `${userId} asked to act at institution ${institutionId}, which they are not a member ` +
            `of. Their institutions are: ${candidates.join(", ")}.`,
        )
      }
      return scopeForUser(institutionId, userId)
    }

    if (candidates.length > 1) warnAmbiguous(userId, candidates)

    return scopeForUser(candidates[0], userId)
  },
)

/**
 * Run `fn` with the acting user's tenant open. **This is the one pattern.**
 *
 * Takes an already-authenticated `userId` rather than resolving the session
 * itself, because the entry points disagree about what an unauthenticated
 * request means and they are all right: a page redirects to /signin, an action
 * throws, a route handler returns 401. Authentication stays where it is; this
 * adds the tenant and nothing else.
 *
 *   export async function createFeedPost(formData: FormData) {
 *     const userId = await requireUserId()
 *     await withTenantScope(userId, async () => {
 *       // every db call in here is filtered to the acting institution
 *     })
 *   }
 *
 * Everything the body awaits inherits the scope, including helpers several
 * calls deep — that is the point of carrying it in AsyncLocalStorage rather
 * than as a parameter. The corollary is that the wrapper has to enclose *all*
 * of the body: a query left above the call is a query with no tenant.
 */
export async function withTenantScope<T>(
  userId: string,
  fn: (scope: TenantScope) => Promise<T>,
  opts?: { institutionId?: string },
): Promise<T> {
  const scope = await resolveTenantScope(userId, opts?.institutionId)
  return runInTenantScope(scope, () => fn(scope))
}

/**
 * Run `fn` as the platform, inside one named institution.
 *
 * For work with no user behind it — scheduled jobs, webhooks. The actor is the
 * job, so an audit row still says who did it; `principalType: "system"` is the
 * honest answer, and it keeps "nobody was signed in" from being recorded as
 * though somebody was.
 */
export function withSystemTenantScope<T>(
  institutionId: string,
  jobName: string,
  fn: (scope: TenantScope) => Promise<T>,
): Promise<T> {
  const scope: TenantScope = {
    institutionId,
    actor: { principalId: jobName, principalType: "system" },
  }
  return runInTenantScope(scope, () => fn(scope))
}

/**
 * Run `fn` once per institution, each inside that institution's scope.
 *
 * The shape every cross-tenant job has to take. A job that "queries every
 * institution's deliverables" is not one operation spanning tenants, it is N
 * per-tenant operations that were never separated — and the separation is what
 * makes the query layer able to filter them at all.
 *
 * Enumerating the tenants is the one step that legitimately spans them.
 * `Institution` is PLATFORM_GLOBAL so the query layer would pass it through
 * regardless; the grant is stated anyway, so an audit of what runs across
 * tenants lists this job by name instead of missing it.
 *
 * Sequential on purpose. Fanning every tenant out at once turns one slow job
 * into a connection-pool exhaustion that takes user traffic down with it.
 */
export async function forEachInstitution<T>(
  jobName: string,
  fn: (scope: TenantScope) => Promise<T>,
): Promise<T[]> {
  const institutions = await runUnscoped(
    "control-plane",
    `${jobName}: enumerate institutions`,
    () => db.institution.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
  )

  const results: T[] = []
  for (const institution of institutions) {
    results.push(await withSystemTenantScope(institution.id, jobName, fn))
  }
  return results
}
