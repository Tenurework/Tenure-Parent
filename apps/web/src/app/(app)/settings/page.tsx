import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import { storageConfigured } from "@/lib/s3"
import { Card, CardHeader, Attribute } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { PageHeader } from "@/components/ui/PageHeader"
import { ThemeSwitcher } from "@/components/ThemeSwitcher"
import { ProfileImageEditor } from "@/components/ProfileImageEditor"
import { updateProfile, setDelegation, revokeDelegation } from "./actions"

export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")

  return withTenantScope(session.user.id, async () => {
    const [user, ctx] = await Promise.all([
      db.user.findUnique({ where: { id: session.user.id } }),
      getUserContext(session.user.id),
    ])
    if (!user) redirect("/signin")

    const seats = await db.roleAssignment.findMany({
      where: { userId: user.id, status: { in: ["ACTIVE", "SHADOW"] } },
      include: { role: { include: { seat: true, organization: { select: { name: true } } } } },
      orderBy: { startDate: "desc" },
    })

    // Delegation: only gate owners (a president or OSE member) can name a backup.
    const isOse = ctx.institutionRoles.length > 0
    const presidentOrgIds = ctx.orgRoles
      .filter((r) => r.scope === "PRESIDENT" && r.status === "ACTIVE")
      .map((r) => r.organizationId)
    const canDelegate = isOse || presidentOrgIds.length > 0
    let eligibleBackups: { id: string; name: string }[] = []
    let currentDelegation:
      | { id: string; note: string | null; toUser: { name: string | null; email: string | null } }
      | null = null
    if (canDelegate) {
      let institutionId: string | undefined = ctx.institutionRoles[0]?.institutionId
      if (!institutionId && presidentOrgIds.length) {
        const org = await db.organization.findFirst({
          where: { id: presidentOrgIds[0] },
          select: { institutionId: true },
        })
        institutionId = org?.institutionId
      }
      const instId = institutionId // const narrows reliably across the awaits below
      const or: object[] = []
      if (isOse && instId) or.push({ institutionMembership: { some: { institutionId: instId } } })
      if (presidentOrgIds.length)
        or.push({ roleAssignments: { some: { status: "ACTIVE", role: { organizationId: { in: presidentOrgIds } } } } })
      if (or.length) {
        const users = await db.user.findMany({
          where: { id: { not: user.id }, OR: or },
          select: { id: true, name: true, email: true },
          take: 50,
        })
        eligibleBackups = users.map((u) => ({ id: u.id, name: u.name ?? u.email ?? "Unknown" }))
      }
      if (instId) {
        currentDelegation = await db.approvalDelegation.findFirst({
          where: { fromUserId: user.id, revokedAt: null, institutionId: instId },
          select: { id: true, note: true, toUser: { select: { name: true, email: true } } },
        })
      }
    }

    return (
      <div className="max-w-3xl">
        <PageHeader
          title="Settings"
          subtitle="Your profile, appearance, and access at a glance."
        />

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Profile picture"
              subtitle="Shown in the header, messages, and wherever you appear."
            />
            <ProfileImageEditor
              name={user.name ?? user.email ?? "You"}
              image={user.image}
              canUpload={storageConfigured()}
            />
          </Card>

          <Card>
            <CardHeader
              title="Appearance"
              subtitle="Choose a theme — System follows your device."
            />
            <ThemeSwitcher />
          </Card>

          <Card>
            <CardHeader title="Profile" />
            <form action={updateProfile} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs text-text-2 flex-1 min-w-52">
                Display name
                <input
                  name="name"
                  defaultValue={user.name ?? ""}
                  required
                  maxLength={120}
                  className="h-9 w-full rounded border border-border px-3 text-sm text-text-1 bg-surface"
                />
              </label>
              <button className="h-9 rounded bg-[--primary] px-4 text-sm font-medium text-[--primary-text] hover:opacity-90">
                Save
              </button>
            </form>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <Attribute label="Email" value={user.email} />
              <Attribute
                label="Institution role"
                value={
                  ctx.institutionRoles[0]
                    ? ctx.institutionRoles[0].role.replace(/_/g, " ").toLowerCase()
                    : "club member"
                }
              />
            </div>
          </Card>

          <Card padding="none">
            <div className="p-5 border-b border-border">
              <CardHeader
                title="Your seats"
                subtitle="Positions you currently hold or are inheriting"
              />
            </div>
            {seats.length === 0 ? (
              <p className="px-5 py-6 text-sm text-text-3 text-center">No club seats.</p>
            ) : (
              <ul className="divide-y divide-border">
                {seats.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-1">
                        {s.role.name} · {s.role.organization.name}
                      </p>
                      {s.role.seat?.positionCode && (
                        <p className="text-xs text-text-3 mt-0.5">
                          Position ID {s.role.seat.positionCode}
                        </p>
                      )}
                    </div>
                    <Badge variant={s.status === "ACTIVE" ? "success" : "info"}>
                      {s.status === "ACTIVE" ? "Active" : "Shadow"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {canDelegate && (
            <Card>
              <CardHeader
                title="Backup approver"
                subtitle="Name someone who can act on your approval gate while you're away — every action they take is recorded “on behalf of” you."
              />
              {currentDelegation ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-base px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm text-text-1">
                      <span className="font-medium">
                        {currentDelegation.toUser.name ?? currentDelegation.toUser.email}
                      </span>{" "}
                      can approve on your behalf.
                    </p>
                    {currentDelegation.note && (
                      <p className="mt-0.5 text-[13px] text-text-3">{currentDelegation.note}</p>
                    )}
                  </div>
                  <form action={revokeDelegation}>
                    <input type="hidden" name="id" value={currentDelegation.id} />
                    <button className="h-8 rounded border border-border px-3 text-[13px] font-medium text-text-2 hover:bg-surface hover:text-[--error]">
                      Revoke
                    </button>
                  </form>
                </div>
              ) : eligibleBackups.length === 0 ? (
                <p className="text-sm text-text-3">
                  No eligible backups yet — a backup must be a fellow OSE member or an active board
                  member of your club.
                </p>
              ) : (
                <form action={setDelegation} className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-xs text-text-2">
                    Backup approver
                    <select
                      name="toUserId"
                      required
                      className="h-9 rounded border border-border bg-surface px-2 text-sm text-text-1"
                    >
                      {eligibleBackups.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-text-2">
                    Note (optional)
                    <input
                      name="note"
                      maxLength={140}
                      placeholder="e.g. Covering while I'm on the career trek"
                      className="h-9 w-full rounded border border-border bg-surface px-3 text-sm text-text-1"
                    />
                  </label>
                  <button className="h-9 rounded bg-[--primary] px-4 text-sm font-medium text-[--primary-text] hover:opacity-90">
                    Set backup
                  </button>
                </form>
              )}
            </Card>
          )}

          <Card>
            <CardHeader title="Notifications" subtitle="Delivery preferences" />
            <p className="text-sm text-text-2">
              In-app notifications are always on. Email digests arrive with the
              university SSO rollout.
            </p>
          </Card>
        </div>
      </div>
    )
  })
}
