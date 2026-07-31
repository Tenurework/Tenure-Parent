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
import { navigationForSystem } from "@/lib/config/system-modules"
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
async function actingInstitutionSlug(userId: string): Promise<string> {
  try {
    const scope = await resolveTenantScope(userId)
    const institution = await db.institution.findUnique({
      where: { id: scope.institutionId },
      select: { slug: true },
    })
    return institution?.slug ?? ""
  } catch {
    return ""
  }
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session?.user) redirect("/signin")

  const [ctx, unreadNotifications, me, institutionSlug] = await Promise.all([
    getUserContext(session.user.id),
    db.notification.count({ where: { userId: session.user.id, readAt: null } }),
    // Fresh image (JWT sessions don't refresh it when the user changes it).
    db.user.findUnique({ where: { id: session.user.id }, select: { image: true } }),
    actingInstitutionSlug(session.user.id),
  ])

  // Deliberately the same predicate the two booleans used before —
  // `institutionRoles.length > 0` — so routing navigation through modules
  // changes where the menu comes from and not who can see what. That predicate
  // is itself wrong (a role *count* is not a capability), and it is the
  // authorization engine's job to replace it, not this change's.
  const isStaff = ctx.institutionRoles.length > 0
  const capabilities = new Set<string>(
    isStaff ? ["institution.administer", "institution.viewReports"] : [],
  )
  const navSections = navigationForSystem(institutionSlug, capabilities)

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
