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
import { signOutAction } from "./actions"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session?.user) redirect("/signin")

  const [ctx, unreadNotifications, me] = await Promise.all([
    getUserContext(session.user.id),
    db.notification.count({ where: { userId: session.user.id, readAt: null } }),
    // Fresh image (JWT sessions don't refresh it when the user changes it).
    db.user.findUnique({ where: { id: session.user.id }, select: { image: true } }),
  ])

  return (
    <AIProvider>
      <ShellHeader
        userName={session.user.name ?? session.user.email ?? "User"}
        userEmail={session.user.email ?? undefined}
        userImage={me?.image ?? undefined}
        unreadNotifications={unreadNotifications}
        onSignOut={signOutAction}
      />
      <SideNav
        showReports={ctx.institutionRoles.length > 0}
        showAdmin={ctx.institutionRoles.length > 0}
      />
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
