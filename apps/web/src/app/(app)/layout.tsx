import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { ShellHeader } from "@/components/shell/ShellHeader"
import { SideNav } from "@/components/shell/SideNav"
import { Footer } from "@/components/shell/Footer"
import { SkipLink } from "@/components/shell/SkipLink"
import { MainRegion } from "@/components/shell/MainRegion"
import { AIProvider } from "@/components/ai/AIProvider"
import { TenureAIPanel } from "@/components/ai/TenureAIPanel"
import { brandingCss } from "@tenure/platform-config"
import { brandingFor } from "@tenure/platform-config"
import { modulesFor, navigationForSystem } from "@tenure/platform-config"
import { navigationCapabilitiesFor } from "@/lib/authz/navigation-capabilities"
import { actingInstitutions } from "@/lib/tenant-scope"
import { signOutAction, switchTenantAction } from "./actions"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session?.user) redirect("/signin")

  const [ctx, unreadNotifications, me, tenants] = await Promise.all([
    getUserContext(session.user.id),
    db.notification.count({ where: { userId: session.user.id, readAt: null } }),
    // Fresh image (JWT sessions don't refresh it when the user changes it).
    db.user.findUnique({ where: { id: session.user.id }, select: { image: true } }),
    // The user's own choice where they have made one, validated against their
    // live membership, and their default institution where they have not.
    // Returns a null active institution rather than throwing for an account
    // with neither an OSE membership nor a club seat: the shell has to render
    // for that user — it is how they reach sign-out — while the page inside it
    // still fails loudly the moment it queries a tenant-scoped row.
    actingInstitutions(session.user.id),
  ])

  // "" rather than undefined for an account with no institution: it resolves to
  // no tenant binding, which gives the minimal menu and no branding.
  const institution = { id: tenants.active?.id ?? "", slug: tenants.active?.slug ?? "" }

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

  // Empty string for a tenant that has not changed anything, so the common case
  // adds no bytes to the document. The values are validated to `#rgb`/`#rrggbb`
  // at publication AND again inside brandingCss, because this is the point where
  // they actually enter a page.
  const brandCss = brandingCss(brandingFor(institution.slug))

  return (
    <AIProvider>
      {brandCss && <style dangerouslySetInnerHTML={{ __html: brandCss }} />}
      {/* First in the DOM so it is the first thing Tab reaches. */}
      <SkipLink />
      <ShellHeader
        userName={session.user.name ?? session.user.email ?? "User"}
        userEmail={session.user.email ?? undefined}
        userImage={me?.image ?? undefined}
        activeTenant={tenants.active}
        tenantOptions={tenants.options}
        onSwitchTenant={switchTenantAction}
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
