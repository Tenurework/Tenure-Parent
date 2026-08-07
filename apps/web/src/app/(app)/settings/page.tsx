import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { actingInstitutions, withTenantScope } from "@/lib/tenant-scope"
import { BrandPreview } from "@/components/brand/BrandPreview"
import { storageConfigured } from "@/lib/s3"
import { aiConfigured } from "@/lib/ai"
import {
  resolveCapability,
  type CapabilityState,
  type ConnectionResolution,
} from "@/lib/connections/capability-resolution"
import { Card, CardHeader, Attribute } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { PageHeader } from "@/components/ui/PageHeader"
import { ThemeSwitcher } from "@/components/ThemeSwitcher"
import { DensitySwitcher } from "@/components/DensitySwitcher"
import { ProfileImageEditor } from "@/components/ProfileImageEditor"
import { updateProfile, setDelegation, revokeDelegation } from "./actions"

export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")

  // `null` means "no user row behind this session" — the scope returns it and
  // the redirect happens after the scope has closed. `redirect()` is a throw,
  // and a throw crossing `runInTenantScope` aborts anything in flight; the guard
  // in src/lib/tenancy/context.ts now refuses it outright rather than letting it
  // pass on the pages that happen to have no write open.
  const page = await withTenantScope(session.user.id, async () => {
    const [user, ctx] = await Promise.all([
      db.user.findUnique({ where: { id: session.user.id } }),
      getUserContext(session.user.id),
    ])
    if (!user) return null

    /**
     * TTES-030-005. The connections that genuinely exist in this deployment,
     * with their REAL health — each `configured` is read from the same
     * function the feature gates on, so this page cannot say "connected" about
     * something the feature would refuse.
     *
     * The provider half of the requirement (a certified third-party
     * `Connection` with a launch token and a pending-action intent) is not
     * here, and its absence is deliberate rather than an oversight: no
     * `Connection` model exists in the schema, so a row claiming one would be
     * a canned value.
     */
    const declaredConnections: { state: CapabilityState; whereToFix: string }[] = [
      {
        state: {
          key: "ai.model",
          label: "Tenure AI model",
          certified: true,
          configured: aiConfigured(),
          reachable: true,
          connectableBy: "admin",
        },
        whereToFix:
          "Configured by your Tenure operator (ANTHROPIC_API_KEY on the application). Retrieval and search keep working without it — answers arrive as cited sources instead of prose.",
      },
      {
        state: {
          key: "documents.storage",
          label: "Document storage",
          certified: true,
          configured: storageConfigured(),
          reachable: true,
          connectableBy: "admin",
        },
        whereToFix:
          "Configured by your Tenure operator (S3_DOCUMENTS_BUCKET). Without it, document upload is hidden rather than broken — existing documents still open.",
      },
      {
        state: {
          key: "calendar.feed",
          label: "Calendar subscription (ICS)",
          certified: true,
          // Per-user and always available: the feed is generated from rows this
          // account can already read, so there is nothing to provision.
          configured: true,
          reachable: true,
          connectableBy: "user",
        },
        whereToFix:
          "Yours to connect: open the calendar and choose Subscribe to copy a private feed URL into Google, Outlook or Apple Calendar.",
      },
    ]
    const connections: {
      state: CapabilityState
      resolved: ConnectionResolution
      whereToFix: string
    }[] = declaredConnections.map((c) => ({ ...c, resolved: resolveCapability(c.state) }))

    const seats = await db.roleAssignment.findMany({
      where: { userId: user.id, status: { in: ["ACTIVE", "SHADOW"] } },
      include: { role: { include: { seat: true, organization: { select: { name: true } } } } },
      orderBy: { startDate: "desc" },
    })

    // The tenant whose branding this account actually renders under — the same
    // resolution the shell layout uses, so the preview cannot show one
    // institution's accent to somebody browsing under another's.
    const activeSlug = (await actingInstitutions(session.user.id)).active?.slug ?? ""

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

          {/* TTES-010-004. Beside Appearance because it answers the same
              question from the other end: Appearance is the theme this person
              chose, this is the accent their institution set and what it
              measures against every theme the product ships. Rendered only for
              an account with a tenant — there is nothing to preview without
              one. */}
          {activeSlug && (
            <Card>
              <CardHeader
                title="Institution branding"
                subtitle="Your institution's accent, as it is actually painted — and anything the contrast gate refused."
              />
              <BrandPreview institutionSlug={activeSlug} />
            </Card>
          )}

          <Card>
            <CardHeader
              title="Density"
              subtitle="How much of a long table fits on screen. Compact tightens rows, buttons and inputs; nothing else changes."
            />
            <DensitySwitcher />
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

          {/* TTES-030-005 — the Connection Centre, for the connections that
              genuinely exist today. Each row's status is READ from the same
              function the feature itself gates on (aiConfigured,
              storageConfigured), never from a stored flag that could be stale,
              and the outcome + the one available path come from
              resolveCapability so a non-certified capability can never grow a
              Connect button. */}
          <Card padding="none">
            <div className="border-b border-border p-5">
              <CardHeader
                title="Connections"
                subtitle="What this workspace is wired to, who owns each one, and where to fix it."
              />
            </div>
            <ul className="divide-y divide-border">
              {connections.map(({ state, resolved, whereToFix }) => (
                <li
                  key={state.key}
                  className="px-5 py-4"
                  data-connection={state.key}
                  data-connection-outcome={resolved.outcome}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-1">{state.label}</p>
                      <p className="mt-0.5 text-[13px] text-text-2">{resolved.explanation}</p>
                      <p className="mt-1 text-meta uppercase tracking-wide text-text-3">
                        Owned by {resolved.owner}
                      </p>
                    </div>
                    <Badge variant={resolved.outcome === "CONNECTED" ? "success" : "default"}>
                      {resolved.outcome === "CONNECTED" ? "Connected" : "Not connected"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-[13px] text-text-3">{whereToFix}</p>
                </li>
              ))}
            </ul>
          </Card>

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

  if (!page) redirect("/signin")
  return page
}
