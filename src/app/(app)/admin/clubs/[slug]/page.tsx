import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { UserPlus, ArrowLeftRight, X, Plus, Trash2 } from "@/components/ui/icons"
import { db } from "@/lib/db"
import { requireAdminContext } from "@/lib/admin/guard"
import { hasCapability } from "@/lib/admin/capabilities"
import { storageConfigured } from "@/lib/s3"
import { Card, CardHeader } from "@/components/ui/Card"
import { Select } from "@/components/ui/Select"
import { Badge, AssignmentBadge } from "@/components/ui/Badge"
import { Avatar } from "@/components/ui/Avatar"
import { PageHeader } from "@/components/ui/PageHeader"
import { DirectoryPicker } from "@/components/admin/DirectoryPicker"
import { ClubImageEditor } from "@/components/ClubImageEditor"
import { ConfirmSubmit } from "@/components/ui/ConfirmDialog"
import { ConfirmInlineSubmit } from "@/components/ui/ConfirmInlineSubmit"
import {
  adminEditClub,
  adminAssignSeat,
  adminTransferSeat,
  adminRemoveAssignment,
  adminCreateSeat,
  adminDeleteSeat,
} from "../../actions"

export const metadata: Metadata = { title: "Admin · Club" }
export const dynamic = "force-dynamic"

export default async function AdminClubDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { ctx, institutionId } = await requireAdminContext()

  const org = await db.organization.findUnique({
    where: { slug },
    include: {
      roles: {
        orderBy: [{ seatOrder: "asc" }, { scope: "asc" }],
        include: {
          assignments: {
            where: { status: { not: "ALUMNI" } },
            include: { user: { select: { name: true, email: true } } },
          },
          holdings: { where: { isCurrent: true }, include: { person: true } },
          _count: { select: { assignments: true, holdings: true, memoryRecords: true } },
        },
      },
    },
  })
  if (!org || org.institutionId !== institutionId) notFound()

  const can = {
    edit: hasCapability(ctx, "club.edit", institutionId),
    image: hasCapability(ctx, "club.image", institutionId),
    assign: hasCapability(ctx, "role.assign", institutionId),
    remove: hasCapability(ctx, "role.remove", institutionId),
    transfer: hasCapability(ctx, "role.transfer", institutionId),
    seat: hasCapability(ctx, "seat.manage", institutionId),
  }
  const canPlace = can.assign || can.transfer

  return (
    <div className="w-full space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: "Admin", href: "/admin" },
          { label: "Clubs", href: "/admin/clubs" },
          { label: org.name },
        ]}
        title={org.name}
        subtitle="Manage this club's profile, image, board seats and role assignments."
        actions={
          can.image ? (
            <ClubImageEditor
              orgId={org.id}
              orgName={org.name}
              logoUrl={org.logoUrl}
              canUpload={storageConfigured()}
            />
          ) : undefined
        }
      />

      {/* Profile */}
      {can.edit && (
        <Card>
          <CardHeader title="Club profile" subtitle="Name, short name, category and description." />
          <form action={adminEditClub} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="organizationId" value={org.id} />
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-text-2">
              Name
              <input
                name="name"
                required
                defaultValue={org.name}
                className="h-10 rounded-md border border-border px-3.5 text-[15px] text-text-1 bg-surface outline-none focus:border-[--border-focus] placeholder:text-text-3"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-text-2">
              Short name
              <input
                name="shortName"
                defaultValue={org.shortName ?? ""}
                className="h-10 rounded-md border border-border px-3.5 text-[15px] text-text-1 bg-surface outline-none focus:border-[--border-focus] placeholder:text-text-3"
              />
            </label>
            <Select
              label="Category"
              name="category"
              defaultSelectedKey={org.category}
              options={[
                { value: "PROFESSIONAL", label: "Professional" },
                { value: "COMMUNITY", label: "Community" },
                { value: "ORGANIZATION", label: "Organization" },
                { value: "SOCIAL", label: "Social" },
              ]}
            />
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-text-2 sm:col-span-2">
              Description
              <input
                name="description"
                defaultValue={org.description ?? ""}
                className="h-10 rounded-md border border-border px-3.5 text-[15px] text-text-1 bg-surface outline-none focus:border-[--border-focus] placeholder:text-text-3"
              />
            </label>
            <div className="sm:col-span-2">
              <button className="h-10 rounded-md bg-[--accent] px-5 text-sm font-medium text-[--accent-text] hover:bg-[--accent-hover]">
                Save profile
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* Seats + role assignments */}
      <div className="space-y-4">
        <h2 className="font-display text-lead font-semibold text-text-1">Board seats & roles</h2>
        {org.roles.map((role) => {
          const holders = role.holdings.filter((h) => h.isCurrent)
          const deletable = role._count.assignments + role._count.holdings + role._count.memoryRecords === 0
          return (
            <Card key={role.id}>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-semibold text-text-1">{role.name}</h3>
                  {role.positionCode && (
                    <p className="text-[13px] text-text-3">Position ID {role.positionCode}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="info">{role.scope.toLowerCase()}</Badge>
                  {can.seat && deletable && (
                    <ConfirmSubmit
                      action={adminDeleteSeat}
                      hiddenFields={{ roleId: role.id }}
                      title={`Delete the ${role.name} seat?`}
                      description={`This permanently removes the ${role.name} seat from ${org.name}. It carries no assignments, holders, or memory, so no history is lost — but the seat and its position ID are gone for good and can't be recreated with the same ID.`}
                      details={`Type the seat name to confirm you mean this exact seat.`}
                      requireText={role.name}
                      confirmLabel="Delete seat"
                      variant="danger"
                      triggerClassName="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-[--error] hover:bg-[--error-light]"
                      triggerAriaLabel={`Delete ${role.name} seat`}
                    >
                      <Trash2 size={14} /> Delete
                    </ConfirmSubmit>
                  )}
                </div>
              </div>

              {/* Current directory holders (from the roster) */}
              {holders.length > 0 && (
                <ul className="mb-3 space-y-2">
                  {holders.map((h) => (
                    <li key={h.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                      <Avatar name={h.person.name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-text-1">{h.person.name}</p>
                        <p className="truncate text-[13px] text-text-3">{h.person.email}</p>
                      </div>
                      <Badge variant="success">{h.term}</Badge>
                    </li>
                  ))}
                </ul>
              )}

              {/* Login-account assignments, with remove */}
              {role.assignments.length > 0 && (
                <ul className="mb-3 space-y-2">
                  {role.assignments.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                      <Avatar name={a.user.name ?? a.user.email ?? "?"} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-text-1">
                          {a.user.name ?? a.user.email}
                        </p>
                        {a.user.email && <p className="truncate text-[13px] text-text-3">{a.user.email}</p>}
                      </div>
                      <AssignmentBadge status={a.status} />
                      {can.remove && (
                        <ConfirmSubmit
                          action={adminRemoveAssignment}
                          hiddenFields={{ assignmentId: a.id }}
                          title="Remove this person from the seat?"
                          description={`${a.user.name ?? a.user.email} is moved to alumni for ${role.name} and loses access to ${org.name} immediately. They're notified that the role has ended. To restore access you'd assign them again.`}
                          confirmLabel="Remove from seat"
                          variant="danger"
                          triggerClassName="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-text-3 hover:bg-base hover:text-[--error]"
                          triggerAriaLabel={`Remove ${a.user.name ?? a.user.email} from ${role.name}`}
                        >
                          <X size={15} /> Remove
                        </ConfirmSubmit>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {holders.length === 0 && role.assignments.length === 0 && (
                <p className="mb-3 text-sm text-text-3">Vacant — no current holder.</p>
              )}

              {/* Assign / transfer via the directory picker */}
              {canPlace && (
                <form className="rounded-lg border border-dashed border-border p-3">
                  <input type="hidden" name="organizationId" value={org.id} />
                  <input type="hidden" name="roleId" value={role.id} />
                  <p className="mb-2 text-[13px] font-semibold text-text-2">Place a person in this seat</p>
                  <DirectoryPicker />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <select
                      name="status"
                      className="h-9 rounded-md border border-border bg-surface px-2.5 text-[13px] text-text-1"
                    >
                      <option value="ACTIVE">As active holder</option>
                      <option value="SHADOW">As shadow (incoming)</option>
                    </select>
                    {can.assign && (
                      <button
                        formAction={adminAssignSeat}
                        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[--primary] px-3.5 text-[13px] font-medium text-[--primary-text] hover:bg-[--primary-hover]"
                      >
                        <UserPlus size={15} /> Assign
                      </button>
                    )}
                    {can.transfer && holders.length + role.assignments.length > 0 && (
                      <ConfirmInlineSubmit
                        formAction={adminTransferSeat}
                        title={`Transfer the ${role.name} seat?`}
                        description={`The current holder${
                          holders.length + role.assignments.length > 1 ? "s" : ""
                        } of ${role.name} become alumni immediately and lose access, and the person you selected is notified that they now hold the seat. There's no undo from here.`}
                        confirmLabel="Transfer seat"
                        variant="danger"
                        triggerClassName="inline-flex h-9 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3.5 text-[13px] font-medium text-text-1 hover:bg-base"
                      >
                        <ArrowLeftRight size={15} /> Transfer to this person
                      </ConfirmInlineSubmit>
                    )}
                  </div>
                </form>
              )}
            </Card>
          )
        })}
      </div>

      {/* Add a seat */}
      {can.seat && (
        <Card>
          <CardHeader title="Add a board seat" subtitle="Creates a new seat with a permanent position ID." />
          <form action={adminCreateSeat} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="organizationId" value={org.id} />
            <label className="flex min-w-48 flex-1 flex-col gap-1.5 text-[13px] font-semibold text-text-2">
              Seat name
              <input
                name="name"
                required
                placeholder="VP Technology"
                className="h-10 w-full rounded-md border border-border px-3.5 text-[15px] text-text-1 bg-surface outline-none focus:border-[--border-focus] placeholder:text-text-3"
              />
            </label>
            <Select
              label="Scope"
              name="scope"
              defaultSelectedKey="FUNCTIONAL"
              className="min-w-48"
              options={[
                { value: "FUNCTIONAL", label: "Functional (VP / Chair)" },
                { value: "PRESIDENT", label: "President" },
                { value: "MEMBER", label: "Member" },
              ]}
            />
            <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[--accent] px-5 text-sm font-medium text-[--accent-text] hover:bg-[--accent-hover]">
              <Plus size={16} /> Add seat
            </button>
          </form>
        </Card>
      )}
    </div>
  )
}
