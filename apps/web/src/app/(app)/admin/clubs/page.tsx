import Link from "next/link"
import type { Metadata } from "next"
import { Archive, ArchiveRestore, ArrowRight, Plus } from "@/components/ui/icons"
import { db } from "@/lib/db"
import { requireAdminContext } from "@/lib/admin/guard"
import { withTenantScope } from "@/lib/tenant-scope"
import { hasCapability } from "@/lib/admin/capabilities"
import { Card, CardHeader } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { Avatar } from "@/components/ui/Avatar"
import { Select } from "@/components/ui/Select"
import { ConfirmSubmit } from "@/components/ui/ConfirmDialog"
import { adminCharterClub, adminSetOrgStatus } from "../actions"

const rowArchiveBtn =
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-text-3 transition-colors hover:bg-base hover:text-text-1"

const CATEGORY_OPTIONS = [
  { value: "PROFESSIONAL", label: "Professional" },
  { value: "COMMUNITY", label: "Community" },
  { value: "ORGANIZATION", label: "Organization" },
  { value: "SOCIAL", label: "Social" },
]

export const metadata: Metadata = { title: "Admin · Clubs" }
export const dynamic = "force-dynamic"

const CATEGORY_LABEL = {
  ORGANIZATION: "Organization",
  PROFESSIONAL: "Professional",
  COMMUNITY: "Community",
  SOCIAL: "Social",
} as const

export default async function AdminClubsPage() {
  const { userId, ctx, institutionId } = await requireAdminContext()
  const canCreate = hasCapability(ctx, "club.create", institutionId)
  const canArchive = hasCapability(ctx, "club.archive", institutionId)

  return withTenantScope(userId, async () => {
    const clubs = await db.organization.findMany({
      where: { institutionId },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      include: {
        roles: {
          select: {
            name: true,
            _count: { select: { assignments: true, holdings: true } },
          },
        },
      },
    })

    const active = clubs.filter((c) => c.status !== "ARCHIVED")
    const archived = clubs.filter((c) => c.status === "ARCHIVED")

    function seats(club: (typeof clubs)[number]) {
      const board = club.roles.filter((r) => r.name !== "Member")
      const filled = board.filter((r) => r._count.assignments > 0 || r._count.holdings > 0).length
      return { filled, total: board.length }
    }

    const Row = ({ club }: { club: (typeof clubs)[number] }) => {
      const s = seats(club)
      return (
        <li className="flex items-center gap-4 px-5 py-3.5">
          <Avatar name={club.name} imageUrl={club.logoUrl} size="md" />
          <div className="min-w-0 flex-1">
            <Link
              href={`/admin/clubs/${club.slug}`}
              className="truncate font-medium text-text-1 no-underline hover:text-[--accent]"
            >
              {club.name}
            </Link>
            <p className="text-[13px] text-text-3">
              {CATEGORY_LABEL[club.category]} · {s.filled}/{s.total} seats filled
            </p>
          </div>
          {club.status === "PENDING" && <Badge variant="warning">pending</Badge>}
          {canArchive &&
            (club.status === "ARCHIVED" ? (
              <form action={adminSetOrgStatus}>
                <input type="hidden" name="organizationId" value={club.id} />
                <input type="hidden" name="status" value="ACTIVE" />
                <button className={rowArchiveBtn} aria-label={`Reactivate ${club.name}`}>
                  <ArchiveRestore size={14} /> Reactivate
                </button>
              </form>
            ) : (
              <ConfirmSubmit
                action={adminSetOrgStatus}
                hiddenFields={{ organizationId: club.id, status: "ARCHIVED" }}
                title={`Archive ${club.name}?`}
                description={`${club.name} moves to the archived list and drops out of active views for the whole institution. Nothing is deleted and its history stays intact — you can reactivate it here whenever you like.`}
                confirmLabel="Archive club"
                variant="danger"
                triggerClassName={rowArchiveBtn}
                triggerAriaLabel={`Archive ${club.name}`}
              >
                <Archive size={14} /> Archive
              </ConfirmSubmit>
            ))}
          <Link
            href={`/admin/clubs/${club.slug}`}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px] font-semibold text-[--accent] no-underline hover:bg-[--accent-light]"
          >
            Manage <ArrowRight size={14} />
          </Link>
        </li>
      )
    }

    return (
      <div className="w-full space-y-6">
        {canCreate && (
          <Card>
            <CardHeader
              title="Charter a new club"
              subtitle="Creates the club with standard board seats — each with a permanent position ID."
            />
            <form action={adminCharterClub} className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-48 flex-1 flex-col gap-1.5 text-[13px] font-semibold text-text-2">
                Club name
                <input
                  name="name"
                  required
                  maxLength={120}
                  placeholder="Simon Real Estate Club"
                  className="h-10 w-full rounded-md border border-border px-3.5 text-[15px] text-text-1 bg-surface outline-none focus:border-[--border-focus] placeholder:text-text-3"
                />
              </label>
              <Select
                label="Category"
                name="category"
                defaultSelectedKey="PROFESSIONAL"
                options={CATEGORY_OPTIONS}
                className="min-w-44"
              />
              <label className="flex min-w-48 flex-1 flex-col gap-1.5 text-[13px] font-semibold text-text-2">
                Description
                <input
                  name="description"
                  placeholder="What the club does"
                  className="h-10 w-full rounded-md border border-border px-3.5 text-[15px] text-text-1 bg-surface outline-none focus:border-[--border-focus] placeholder:text-text-3"
                />
              </label>
              <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[--accent] px-5 text-sm font-medium text-[--accent-text] hover:bg-[--accent-hover]">
                <Plus size={16} /> Charter club
              </button>
            </form>
          </Card>
        )}

        <Card padding="none">
          <div className="border-b border-border p-5">
            <CardHeader title={`Active clubs (${active.length})`} />
          </div>
          <ul className="divide-y divide-border">
            {active.map((club) => (
              <Row key={club.id} club={club} />
            ))}
          </ul>
        </Card>

        {archived.length > 0 && (
          <Card padding="none">
            <div className="border-b border-border p-5">
              <CardHeader title={`Archived clubs (${archived.length})`} subtitle="History preserved — reactivate to restore." />
            </div>
            <ul className="divide-y divide-border">
              {archived.map((club) => (
                <Row key={club.id} club={club} />
              ))}
            </ul>
          </Card>
        )}
      </div>
    )
  })
}
