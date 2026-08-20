import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { actingInstitutions } from "@/lib/tenant-scope"
import { modulesFor } from "@tenure/platform-config"
import { navigationCapabilitiesFor, worldFor } from "@/lib/authz/navigation-capabilities"
import { hiddenTargetReasons, visibleTargets } from "@/lib/eligibility/module-scope"
import { navigationTargetAccess } from "@/lib/eligibility/navigation-targets"
import { accessReportFor } from "@/lib/identity/access-report"
import { tenantEntryEligibility } from "@/lib/eligibility/tenant-entry"
import { explainDecision } from "@/lib/eligibility/explain"

/**
 * Who is signed in, which tenant they are acting in, and what that tenant runs.
 *
 * The bootstrap call. Everything a client needs before it can render anything
 * truthfully is here in one round trip, and — more to the point — in one place:
 * without it, "which institution am I in?" is answerable only by rendering a
 * page and reading the header, which is not something a client, a support
 * engineer or a test can do.
 *
 * It reports rather than decides. `capabilities` is the same navigation
 * capability set `(app)/layout.tsx` filters the menu with, so a client can hide
 * what a user cannot reach — but hiding a link has never been authorization
 * here and is not authorization now. Every route and action re-derives its own
 * answer server-side; see `packages/module-runtime/src/manifest.ts`.
 *
 * Deliberately not tenant-scoped. Its subject is the user's relationship to
 * their tenants, which is the question that has to be answered *before* one is
 * open — the auth-bootstrap case, and the reason `actingInstitutions` runs
 * unscoped internally rather than being wrapped here.
 */
export const dynamic = "force-dynamic"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    // 401 with a body, not a redirect: this is consumed by fetch, and a 302 to
    // /signin would arrive as an opaque HTML page a caller cannot act on.
    return NextResponse.json({ error: "Not signed in." }, { status: 401 })
  }
  const userId = session.user.id

  const [ctx, tenants, me, access] = await Promise.all([
    getUserContext(userId),
    actingInstitutions(userId),
    // The session is a JWT minted at sign-in, so name and image in it are as
    // old as the session. The header reads them fresh for the same reason.
    db.user.findUnique({
      where: { id: userId },
      // `emailVerified` is read for gate 2 below: a timestamp when the person
      // proved they control the address, null when they have not.
      select: { name: true, email: true, image: true, emailVerified: true },
    }),
    // GE-042-006. Why this person has no access, when they have none — see
    // `accessReportFor`, which reads memberships that are deliberately not
    // filtered to live ones and is the only read in the application that does.
    accessReportFor(userId),
  ])

  const system = modulesFor(tenants.active?.slug ?? "")
  const enabledModules = system.keys
  /**
   * IER-070 gate 2 — the tenant-entry eligibility policy, evaluated.
   *
   * Bible §2.1 requires three separate gates and forbids collapsing them into
   * one boolean. `capabilities` below is gate 3's navigation shadow and
   * `modules` is gate 1's; neither of them is the person-eligibility question,
   * and until now nothing answered it at all.
   *
   * It reports, exactly as the rest of this route does. The decision is a
   * policy conclusion with a digest and reason codes, not an authorization: a
   * client showing "your membership is suspended" instead of the onboarding
   * path is the point, and every route still decides for itself.
   */
  const eligibility = tenantEntryEligibility(userId, {
    accessState: access.state,
    emailVerifiedAt: me?.emailVerified ?? null,
    tenantCapabilities: enabledModules,
    now: new Date(),
  })

  const capabilities = navigationCapabilitiesFor(
    ctx,
    tenants.active?.id ?? "",
    enabledModules,
    new Date().toISOString(),
  )

  /**
   * IER-120-002 / IER-120-003 / IER-120-004 — the same two menu entries, run
   * through all three of §2.1's gates instead of gate 3 alone.
   *
   * §17: "Tenant entry is only the first eligibility level." `capabilities`
   * above asks `decide()` whether this principal may exercise a permission, and
   * that is gate 3. It cannot say whether the TENANT is entitled to the module
   * behind the entry, and it cannot say whether this person is in the
   * population the module is for — so a menu built from it alone can render a
   * link into a module nobody bought.
   *
   * `navigationTargets` is a HINT, exactly as `capabilities` is. §17's second
   * clause — "servers independently enforce every action and data query" — is
   * unaffected: `decideTargetAccess` takes no menu, so a client that calls a
   * route for a target this payload hid gets the same refusal it would have
   * got had the target been shown.
   */
  const navigationTargets = navigationTargetAccess({
    subjectId: userId,
    tenantId: tenants.active?.id ?? "",
    tenantCapabilities: enabledModules,
    entry: {
      accessState: access.state,
      emailVerifiedAt: me?.emailVerified ?? null,
      tenantCapabilities: enabledModules,
      now: new Date(),
    },
    world: worldFor(ctx, tenants.active?.id ?? "", enabledModules),
  })

  return NextResponse.json(
    {
      user: {
        id: userId,
        name: me?.name ?? session.user.name ?? null,
        email: me?.email ?? session.user.email ?? null,
        image: me?.image ?? null,
      },
      /**
       * `null` for an account with neither an OSE membership nor a club seat.
       * That account exists — it is what a provisioned-but-unplaced user looks
       * like — and reporting it honestly is what lets a client show an
       * onboarding path instead of an empty dashboard.
       */
      activeInstitution: tenants.active,
      /**
       * Why there is no active institution, when there is none.
       *
       * `ACTIVE` when they have one. Otherwise the state says which of the four
       * ways access can be absent applies, so a client can show the right
       * sentence instead of assuming everybody with no tenant is new.
       */
      access,
      /**
       * Gate 2 (§2.1), decided by `tenure.tenant-entry.v1` and explained at the
       * END_USER layer (§12.3, IER-070-010).
       *
       * This route answers to the signed-in person, so it gets the end-user
       * explanation and nothing else: a disposition, the sentence that goes
       * with it, and the codes they can act on. The policy id, the version
       * digest and the engine's internal reason codes are deliberately absent —
       * they belong to the admin, auditor and operator layers, which are
       * different projections reached by different callers, not this payload
       * with a flag on it.
       */
      eligibility: explainDecision(eligibility, "END_USER"),
      institutions: tenants.options.map((institution) => ({
        ...institution,
        active: institution.id === tenants.active?.id,
      })),
      modules: enabledModules,
      /**
       * What is true of the modules this tenant IS running.
       *
       * A deprecated module, one in a read-only mode, and one certified with
       * declared gaps all used to render exactly like a fully supported one:
       * `modulesFor` returned keys and nothing else, and every consumer took
       * `.keys`. Bible §11 says the UI must show the mode and its limitations,
       * and it cannot show what the bootstrap call does not carry.
       */
      moduleAdvisories: system.advisories,
      /**
       * And the modules this tenant does NOT get, with the reason.
       *
       * "Why is Reports missing?" was answerable only by reading a blueprint, an
       * entitlement list and a module catalog side by side. The resolver has
       * always produced the sentence; nothing carried it to anyone.
       */
      moduleProblems: system.problems,
      capabilities: [...capabilities].sort(),
      /**
       * IER-120-004 — the menu entries this person may reach, and why the
       * others are absent.
       *
       * Both halves are carried deliberately. A hidden link with no reason is
       * the state that generates a support ticket: "Reports is missing" is
       * answerable from `hidden` — the tenant is not entitled to budgeting,
       * or this person's membership is suspended — without anybody reading
       * three tables side by side. The codes are the same stable codes the
       * server recorded when it refused, so the sentence a person is shown and
       * the reason the server logged cannot drift apart.
       */
      navigationTargets: {
        visible: visibleTargets(navigationTargets),
        hidden: hiddenTargetReasons(navigationTargets),
      },
    },
    {
      // Per-user, tenant-dependent, and changes the moment they switch. A
      // shared cache holding this would hand one user another's answer.
      headers: { "Cache-Control": "private, no-store" },
    },
  )
}
