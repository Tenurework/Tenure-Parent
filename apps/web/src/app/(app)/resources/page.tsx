import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { canManageResources, getUserContext, isOse } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import { PageHeader } from "@/components/ui/PageHeader"
import { ResourcesBrowser } from "@/components/ResourcesBrowser"
import {
  listArchivedResources,
  listResources,
  resourceInstitutionFor,
} from "@/lib/resources-data"
import { seatKeysForRole, type SeatKey } from "@/lib/resources"

export const dynamic = "force-dynamic"

export default async function ResourcesPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")

  return withTenantScope(session.user.id, async () => {
    const ctx = await getUserContext(session.user.id)
    const institutionId = await resourceInstitutionFor(ctx)

    const mySeats = new Set<SeatKey>(["ALL"])
    for (const role of ctx.orgRoles) {
      if (role.status === "ALUMNI") continue
      for (const key of seatKeysForRole(role.roleName)) mySeats.add(key)
    }
    if (ctx.institutionRoles.length > 0) mySeats.add("OSE")

    const isOseViewer = ctx.institutionRoles.some((m) => isOse(ctx, m.institutionId))
    const canManage = institutionId ? canManageResources(ctx, institutionId) : false

    // Retired resources are only loaded for the people who can restore them.
    const [resources, archived] = institutionId
      ? await Promise.all([
          listResources(institutionId),
          canManage ? listArchivedResources(institutionId) : Promise.resolve([]),
        ])
      : [[], []]

    return (
      <div className="w-full">
        <PageHeader
          title="Board Resources"
          subtitle="Every form, guide and policy your seat needs — searchable, so it survives the handoff instead of living in someone's bookmarks."
        />
        <ResourcesBrowser
          resources={resources}
          archived={archived}
          mySeats={[...mySeats]}
          isOse={isOseViewer}
          canManage={canManage}
        />
      </div>
    )
  })
}
