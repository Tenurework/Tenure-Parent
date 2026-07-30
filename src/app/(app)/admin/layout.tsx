import { notFound, redirect } from "next/navigation"
import { ShieldCheck } from "@/components/ui/icons"
import { auth } from "@/lib/auth"
import { getUserContext } from "@/lib/rbac"
import { adminRoleAt, capabilitiesForRole, isAdmin, roleLabel } from "@/lib/admin/capabilities"
import { AdminNav } from "@/components/admin/AdminNav"

/**
 * The administration console is a separate, more powerful surface than the
 * club/student experience. This layout is the boundary: only administrators
 * pass, and it stamps every admin page with the accent-themed banner + section
 * nav so the console always reads as its own system.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")

  const ctx = await getUserContext(session.user.id)
  if (!isAdmin(ctx)) notFound()

  const institutionId = ctx.institutionRoles[0].institutionId
  const role = adminRoleAt(ctx, institutionId)!
  const capCount = capabilitiesForRole(role).length

  return (
    <div className="w-full">
      {/* The console announces itself with a hairline accent frame rather than
          a filled slab. It is still unmistakably its own plane, but it is built
          from the same primitives as every other Tenure surface — the previous
          version was a tinted card carrying a solid accent icon plate, which is
          why the console read as a different product. Icon colour rides the
          outline only; see the iconography rule in globals.css. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="icon-frame h-11 w-11 rounded-lg" style={{ color: "var(--accent)" }}>
            <ShieldCheck size={22} weight="regular" aria-hidden />
          </span>
          <div>
            <h1 className="font-display text-lead font-bold text-text-1">Administration Console</h1>
            <p className="text-[13px] text-text-2">
              Override and manage every club, role, and person across the institution.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* The role chip keeps its fill — a status chip's fill IS the signal,
              which the iconography rule exempts by name. */}
          <span className="rounded-full bg-[--accent] px-3 py-1 text-[13px] font-semibold text-[--accent-text]">
            OSE {roleLabel(role)}
          </span>
          <span className="hidden rounded-full border border-border-strong px-3 py-1 text-[13px] font-medium text-[--accent-strong] sm:inline">
            {capCount} capabilities
          </span>
        </div>
      </div>

      <div className="mb-6">
        <AdminNav />
      </div>

      {children}
    </div>
  )
}
