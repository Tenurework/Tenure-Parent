import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { ShellHeader } from "@/components/shell/ShellHeader"
import { SideNav } from "@/components/shell/SideNav"
import { Footer } from "@/components/shell/Footer"
import { MainRegion } from "@/components/shell/MainRegion"
import { AIProvider } from "@/components/ai/AIProvider"
import { TenureAIPanel } from "@/components/ai/TenureAIPanel"
import { modulesFor, navigationForSystem } from "@/lib/config/system-modules"
import { navigationCapabilitiesFor } from "@/lib/authz/navigation-capabilities"
import { resolveTenantScope } from "@/lib/tenant-scope"
import { signOutAction } from "./actions"

/**
 * The slug of the institution this user is acting in, for configuration lookup.
 *
 * Returns "" when there is no honest answer — an account with neither an OSE
 * membership nor a club seat. `resolveTenantScope` throws for that case, which
 * is right for a page that is about to query tenant-scoped rows and wrong for a
 * layout, whose job is to render a shell. An empty slug resolves to no tenant
 * binding, which gives the minimal menu; the page inside still fails loudly.
 */
async function actingInstitution(userId: string): Promise<{ id: string; slug: string }> {
  try {
    const scope = await resolveTenantScope(userId)
    const institution = await db.institution.findUnique({
      where: { id: scope.institutionId },
      select: { slug: true },
    })
    return { id: scope.institutionId, slug: institution?.slug ?? "" }
  } catch {
    return { id: "", slug: "" }
  }
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session?.user) redirect("/signin")

  const [ctx, unreadNotifications, me, institution] = await Promise.all([
    getUserContext(session.user.id),
    db.notification.count({ where: { userId: session.user.id, readAt: null } }),
    // Fresh image (JWT sessions don't refresh it when the user changes it).
    db.user.findUnique({ where: { id: session.user.id }, select: { image: true } }),
    actingInstitution(session.user.id),
  ])

  // The menu is what the enabled modules contribute, filtered by what the
  // authorization engine says this principal actually holds. Both halves are
  // decided server-side; neither is a boolean threaded through a component.
  //
  // The outcome is unchanged today — every institution role maps to both
  // navigation capabilities, exactly as `institutionRoles.length > 0` did — but
  // it is now a decision the engine makes, so a suspended membership, an expired
  // grant or a disabled module removes the entry without anyone editing a layout.
  // Both halves use the institution resolveTenantScope validated against this
  // user's own memberships. Reaching for `ctx.institutionRoles[0]` here would
  // reintroduce the first-role fallback one line below the comment complaining
  // about it, and would not be validated at all.
  const enabledModules = modulesFor(institution.slug).keys
  const capabilities = navigationCapabilitiesFor(
    ctx,
    institution.id,
    enabledModules,
    new Date().toISOString(),
  )
  const navSections = navigationForSystem(institution.slug, capabilities)

  return (
    <AIProvider>
      <ShellHeader
        userName={session.user.name ?? session.user.email ?? "User"}
        userEmail={session.user.email ?? undefined}
        userImage={me?.image ?? undefined}
        unreadNotifications={unreadNotifications}
        onSignOut={signOutAction}
      />
      <SideNav sections={navSections} />
      {/* Width and gutters live inside MainRegion, which also squeezes the
          content in when the Tenure AI panel opens. */}
      <MainRegion>{children}</MainRegion>
      {/* Hardened frame: header + side nav + footer stay put; only this main
          content region scrolls. */}
      <Footer />
      <TenureAIPanel />
    </AIProvider>
  )
}
