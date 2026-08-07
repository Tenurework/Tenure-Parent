import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { actingInstitutions } from "@/lib/tenant-scope"
import { modulesFor } from "@tenure/platform-config"
import { navigationCapabilitiesFor } from "@/lib/authz/navigation-capabilities"
import { accessReportFor } from "@/lib/identity/access-report"

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
      select: { name: true, email: true, image: true },
    }),
    // GE-042-006. Why this person has no access, when they have none — see
    // `accessReportFor`, which reads memberships that are deliberately not
    // filtered to live ones and is the only read in the application that does.
    accessReportFor(userId),
  ])

  const system = modulesFor(tenants.active?.slug ?? "")
  const enabledModules = system.keys
  const capabilities = navigationCapabilitiesFor(
    ctx,
    tenants.active?.id ?? "",
    enabledModules,
    new Date().toISOString(),
  )

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
    },
    {
      // Per-user, tenant-dependent, and changes the moment they switch. A
      // shared cache holding this would hand one user another's answer.
      headers: { "Cache-Control": "private, no-store" },
    },
  )
}
