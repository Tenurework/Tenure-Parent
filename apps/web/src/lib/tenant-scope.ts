import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getUserContext } from "@/lib/rbac";
import {
  runInTenantScope,
  runUnscoped,
  TenantContextError,
  type TenantScope,
} from "@/lib/tenancy/context";
import {
  ACTING_TENANT_SLUG_COOKIE,
  LOCALE_COOKIE_OPTIONS,
} from "@/lib/tenancy/locale-cookie";

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
 * The institutions a user could legitimately be acting for, in preference order.
 *
 * OSE memberships first, then the institutions behind their club seats. That is
 * the order `viewerTimeZone` and `resourceInstitutionFor` already use, kept
 * identical on purpose: `candidates[0]` is the default acting institution, and
 * centralising this must not change which institution any existing user
 * resolves to.
 *
 * The two lists are unioned rather than short-circuited. Returning only the OSE
 * memberships when there is one would mean an OSE staffer who also holds a club
 * seat at a *different* institution could not choose that institution in the
 * switcher — the seat is real, they can already read its rows, and hiding it
 * from the chooser would not make it unreachable, only unselectable. Preference
 * order is preserved, so this widens what may be chosen without moving the
 * default for anyone.
 *
 * Club seats are counted at every status, ALUMNI included. This decides which
 * tenant's rows the query layer filters to, not what the user may do with them
 * — RBAC is untouched and still answers that. Dropping ALUMNI here would strip
 * a past officer of the institution they can currently still read the feed of,
 * which is a permission change smuggled in as a tenancy change.
 */
const institutionCandidates = cache(
  async (userId: string): Promise<string[]> => {
    // Resolving which institutions a user belongs to is *how* a tenant is
    // determined, so this read cannot itself require one. That is the deadlock
    // `auth-bootstrap` exists for; see ADR-0002 and context.ts.
    return runUnscoped(
      "auth-bootstrap",
      `resolveTenantScope(${userId})`,
      async () => {
        const ctx = await getUserContext(userId);

        // getUserContext already orders memberships by institutionId, so this is
        // the same pick the ~15 existing `institutionRoles[0]` call sites make.
        const fromMemberships = ctx.institutionRoles.map(
          (m) => m.institutionId,
        );

        const orgIds = [...new Set(ctx.orgRoles.map((r) => r.organizationId))];
        const fromSeats =
          orgIds.length === 0
            ? []
            : (
                await db.organization.findMany({
                  where: { id: { in: orgIds } },
                  // Stable ordering, so a multi-club member resolves the same
                  // institution on every request rather than whichever row the
                  // planner returned first.
                  orderBy: { id: "asc" },
                  select: { institutionId: true },
                })
              ).map((o) => o.institutionId);

        const belongsTo = [...new Set([...fromMemberships, ...fromSeats])];
        if (belongsTo.length === 0) return [];

        // Only institutions this cell may actually serve.
        //
        // `ACTIVATING` described itself as "the first moment a user can reach the
        // system, which is why it is a separate, approved act" — and nothing in this
        // application read a tenant lifecycle state at all, so a tenant was reachable
        // from the moment the reconciler created its Institution row at `MIGRATING`,
        // one state and one approval earlier. The approval guarded something that
        // had already happened.
        //
        // Filtered here rather than at the end of `resolveTenantScope`, because this
        // is the list every later decision is made from: the membership check, the
        // ambiguity warning and the acting-institution cookie all read it. A tenant
        // excluded here cannot be reached by any of them.
        // The query is a filter, and the order it returns rows in is thrown away.
        //
        // `belongsTo` is ordered deliberately — memberships before club seats, each
        // group stably sorted — and the first entry is the default institution a
        // user lands in. Returning `serving.map(...)` instead would hand that choice
        // to whatever order the planner felt like, which for a two-institution user
        // silently changes which tenant they open the app in.
        const serving = await db.institution.findMany({
          where: { id: { in: belongsTo }, serving: true },
          select: { id: true },
        });
        const mayServe = new Set(serving.map((i) => i.id));
        return belongsTo.filter((id) => mayServe.has(id));
      },
    );
  },
);

/**
 * Ambiguity is reported once per process per user, not per request: a warning
 * that repeats on every page load is a warning nobody reads. Same reasoning as
 * the dedupe in the tenancy extension's observe-mode recorder.
 */
const warnedAmbiguous = new Set<string>();

function warnAmbiguous(userId: string, candidates: string[]) {
  if (warnedAmbiguous.has(userId)) return;
  warnedAmbiguous.add(userId);
  console.warn(
    `[tenancy] ${userId} belongs to ${candidates.length} institutions ` +
      `(${candidates.join(", ")}) and has not chosen one, so the first is used. ` +
      `A choice is made in the shell's institution switcher and persisted in the ` +
      `${ACTING_INSTITUTION_COOKIE} cookie; see chooseActingInstitution().`,
  );
}

/**
 * Reported once per process per user for the same reason, and separately:
 * "this user's stored choice is no longer one of their institutions" is a
 * different event from "this user has never chosen", and an operator reading
 * logs after a membership change needs to be able to tell them apart.
 */
const warnedRejected = new Set<string>();

function warnRejectedChoice(
  userId: string,
  chosen: string,
  candidates: string[],
) {
  const key = `${userId}:${chosen}`;
  if (warnedRejected.has(key)) return;
  warnedRejected.add(key);
  console.warn(
    `[tenancy] ${userId} presented ${chosen} as their acting institution and is not a member ` +
      `of it. Ignored; acting at ${candidates[0]} instead. Their institutions are: ` +
      `${candidates.join(", ")}.`,
  );
}

function scopeForUser(institutionId: string, userId: string): TenantScope {
  return {
    institutionId,
    actor: { principalId: userId, principalType: "user" },
  };
}

/**
 * Where a user's choice of institution is kept.
 *
 * A cookie rather than a session claim, deliberately. The session is a signed
 * JWT minted at sign-in (`session: { strategy: "jwt" }`), so putting the choice
 * in it would mean re-minting the token on every switch and would make the
 * choice survive a sign-out on a shared machine. A cookie is the smaller
 * mechanism and needs no session surgery.
 *
 * It carries no authority of its own. Nothing downstream trusts this value:
 * every read validates it against the user's live membership set before it is
 * used, so a forged or stale cookie selects nothing rather than granting
 * anything. `httpOnly` is therefore not what makes it safe — it is set because
 * no client code needs to read it, not because reading it would matter.
 */
export const ACTING_INSTITUTION_COOKIE = "tenure.acting-institution";

/** A year: this is a preference, and re-choosing on every session is friction. */
const CHOICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

async function readChoiceCookie(): Promise<string | undefined> {
  try {
    const jar = await cookies();
    return jar.get(ACTING_INSTITUTION_COOKIE)?.value || undefined;
  } catch {
    // No request to read a cookie from — a scheduled job, a script, a unit
    // test. There is no user to have chosen anything, and the entry points
    // that run without one (`withSystemTenantScope`, `forEachInstitution`)
    // name their institution outright.
    return undefined;
  }
}

/**
 * The user's stored choice, if it is still one of their institutions.
 *
 * **This is the validation.** The cookie is attacker-controlled — it is a
 * request, not a fact — so it is checked against `institutionCandidates` on
 * every read rather than once at the moment it was written. A membership that
 * was revoked after the choice was made is revoked here too, on the next
 * request, without anyone having to remember to clear a cookie.
 *
 * An unrecognised value is ignored rather than fatal. Failing the request would
 * be equally safe and strictly worse to be on the receiving end of: a user
 * whose seat ended would get an error page on every route, including the one
 * carrying the switcher that could fix it. Ignoring it falls back to an
 * institution they *are* a member of, which is both safe and recoverable, and
 * says so in the log.
 */
export const actingInstitutionChoice = cache(
  async (userId: string): Promise<string | undefined> => {
    const chosen = await readChoiceCookie();
    if (!chosen) return undefined;

    const candidates = await institutionCandidates(userId);
    if (candidates.includes(chosen)) return chosen;

    if (candidates.length > 0) warnRejectedChoice(userId, chosen, candidates);
    return undefined;
  },
);

export type ActingInstitution = { id: string; slug: string; name: string };

/**
 * What the institution switcher renders: where the user is acting, and where
 * else they could be.
 *
 * Returns `active: null` rather than throwing for an account with no
 * institution at all. The shell has to render for that user — it is how they
 * reach a sign-out — and `resolveTenantScope` is right to refuse for the pages
 * inside it, which are about to query tenant-scoped rows.
 *
 * `options` is in candidate order, so the first entry is the default the user
 * gets before they have chosen anything.
 */
export const actingInstitutions = cache(
  async (
    userId: string,
  ): Promise<{
    active: ActingInstitution | null;
    options: ActingInstitution[];
  }> => {
    const candidates = await institutionCandidates(userId);
    if (candidates.length === 0) return { active: null, options: [] };

    // Institution is platform-global, so this is legitimately unscoped — and it
    // has to be, because it runs before the tenant is settled.
    const rows = await runUnscoped(
      "auth-bootstrap",
      `actingInstitutions(${userId})`,
      () =>
        db.institution.findMany({
          where: { id: { in: candidates } },
          select: { id: true, slug: true, name: true },
        }),
    );

    const byId = new Map(rows.map((r) => [r.id, r]));
    const options = candidates
      .map((id) => byId.get(id))
      .filter((r): r is ActingInstitution => !!r);
    const activeId = (await actingInstitutionChoice(userId)) ?? candidates[0];

    return { active: byId.get(activeId) ?? null, options };
  },
);

/**
 * Record which institution this user is acting in.
 *
 * Validates first, and returns the institution it accepted, so the caller
 * cannot persist a value the user has no claim to. That check is duplicated on
 * every read (`actingInstitutionChoice`) on purpose — this one exists so a
 * mistaken switch fails loudly at the moment it is made, with a message naming
 * the institution, rather than silently doing nothing on the next page load.
 * The read-side check is the one that guards the data.
 *
 * Only callable from a server action or a route handler; Next.js refuses cookie
 * writes from a page render, which is correct — a GET should not change which
 * tenant a user is in.
 */
export async function chooseActingInstitution(
  userId: string,
  institutionId: string,
): Promise<ActingInstitution> {
  const scope = await resolveTenantScope(userId, institutionId);

  const { options } = await actingInstitutions(userId);
  const chosen = options.find((o) => o.id === scope.institutionId);
  if (!chosen) {
    throw new TenantContextError(
      `${userId} may act at ${scope.institutionId}, but no Institution row with that id exists. ` +
        `Something has deleted the tenant out from under its memberships.`,
    );
  }

  const jar = await cookies();
  jar.set(ACTING_INSTITUTION_COOKIE, scope.institutionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // Loopback development is served over http, where a Secure cookie is
    // dropped silently — the switch would appear to do nothing.
    secure: process.env.NODE_ENV === "production",
    maxAge: CHOICE_MAX_AGE_SECONDS,
  });

  // The slug beside the id, for the root layout's `lang` and `dir` (GE-022-004).
  // Written here, from `chosen`, so it can only ever name a tenant this user was
  // just proved to be a member of. It still decides nothing — see
  // `lib/tenancy/locale-cookie.ts` for why a forged value is harmless.
  jar.set(ACTING_TENANT_SLUG_COOKIE, chosen.slug, LOCALE_COOKIE_OPTIONS);

  return chosen;
}

/**
 * The tenant a signed-in user is acting in.
 *
 * `institutionId` names the acting institution explicitly, for the call sites
 * that already accept one (`requireCapability({ institutionId })`) and for the
 * institution switcher, which feeds it the user's persisted choice. It is
 * validated against the user's own memberships every time: a caller-supplied
 * institution is a request, not a fact, and accepting one unchecked would let
 * any signed-in account name any tenant — the same shape of defect the
 * chokepoint exists to close.
 *
 * Omitting it means "whichever institution this user is currently acting in",
 * which `withTenantScope` resolves from their stored choice and falls back to
 * `candidates[0]` for. The fallback is a default, not a guess: it is the same
 * institution the ~15 `institutionRoles[0]` call sites already pick, and a user
 * with more than one now has a control that changes it.
 *
 * Throws when the user has no institution at all. There is no honest scope for
 * a signed-in account with neither an OSE membership nor a club seat, and every
 * tenant-scoped query in the body would throw anyway once enforcement is on —
 * failing here, with a message that names the cause, beats failing five queries
 * in with one that does not.
 */
export const resolveTenantScope = cache(
  async (userId: string, institutionId?: string): Promise<TenantScope> => {
    const candidates = await institutionCandidates(userId);

    if (candidates.length === 0) {
      throw new TenantContextError(
        `${userId} holds no institution membership and no club seat in a tenant this cell is ` +
          `serving, so there is no tenant to act in. Either the account needs an onboarding ` +
          `path, or its tenant has not been activated — activation is what publishes a ` +
          `deployment manifest setting \`serving\`, and until then the cell holds the tenant ` +
          `created and unreachable.`,
      );
    }

    if (institutionId !== undefined) {
      if (!candidates.includes(institutionId)) {
        throw new TenantContextError(
          `${userId} asked to act at institution ${institutionId}, which they are not a member ` +
            `of. Their institutions are: ${candidates.join(", ")}.`,
        );
      }
      return scopeForUser(institutionId, userId);
    }

    if (candidates.length > 1) warnAmbiguous(userId, candidates);

    return scopeForUser(candidates[0], userId);
  },
);

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
 *
 * With no `opts.institutionId`, the tenant is the user's stored choice — which
 * is why the switcher needed no edit at sixty call sites. `actingInstitutionChoice`
 * validates that choice against live membership before it is returned, so a
 * forged cookie resolves to `undefined` here and the user acts in their default
 * institution, not the one they named.
 */
export async function withTenantScope<T>(
  userId: string,
  fn: (scope: TenantScope) => Promise<T>,
  opts?: { institutionId?: string },
): Promise<T> {
  const institutionId =
    opts?.institutionId ?? (await actingInstitutionChoice(userId));
  const scope = await resolveTenantScope(userId, institutionId);
  return runInTenantScope(scope, () => fn(scope));
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
  };
  return runInTenantScope(scope, () => fn(scope));
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
    () =>
      db.institution.findMany({ select: { id: true }, orderBy: { id: "asc" } }),
  );

  const results: T[] = [];
  for (const institution of institutions) {
    results.push(await withSystemTenantScope(institution.id, jobName, fn));
  }
  return results;
}
