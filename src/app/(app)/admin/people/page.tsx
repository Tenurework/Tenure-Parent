import type { Metadata } from "next"
import { UserPlus, ShieldCheck, X } from "@/components/ui/icons"
import { db } from "@/lib/db"
import { requireAdminContext } from "@/lib/admin/guard"
import { hasCapability, roleLabel } from "@/lib/admin/capabilities"
import { Card, CardHeader } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { Avatar } from "@/components/ui/Avatar"
import { Select } from "@/components/ui/Select"
import { EmailLink } from "@/components/EmailLink"
import { ConfirmSubmit } from "@/components/ui/ConfirmDialog"
import { RoleTransferPanel, type TransferView } from "@/components/admin/RoleTransferPanel"
import { adminGrantInstitutionRole, adminRevokeInstitutionRole, adminAddDirectoryPerson } from "../actions"

export const metadata: Metadata = { title: "Admin · Directory & Access" }
export const dynamic = "force-dynamic"

export default async function AdminPeoplePage() {
  const { userId, ctx, institutionId } = await requireAdminContext()
  const canGrant = hasCapability(ctx, "institution.grantRole", institutionId)
  const canDirectory = hasCapability(ctx, "directory.manage", institutionId)
  const canTransfer = hasCapability(ctx, "institution.transferRole", institutionId)

  const [memberships, people, peopleCount, incomingTransfers, outgoingTransfers] = await Promise.all([
    db.institutionMembership.findMany({
      where: { institutionId },
      orderBy: { role: "asc" },
      include: { user: { select: { name: true, email: true } } },
    }),
    db.directoryPerson.findMany({ orderBy: { name: "asc" }, take: 60 }),
    db.directoryPerson.count(),
    db.roleTransfer.findMany({
      where: { institutionId, toUserId: userId, status: "PENDING" },
      include: {
        fromUser: { select: { name: true, email: true } },
        toUser: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.roleTransfer.findMany({
      where: {
        institutionId,
        status: "PENDING",
        OR: [{ fromUserId: userId }, { initiatedById: userId }],
      },
      include: {
        fromUser: { select: { name: true, email: true } },
        toUser: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ])

  const toView = (t: (typeof incomingTransfers)[number]): TransferView => ({
    id: t.id,
    fromName: t.fromUser.name ?? t.fromUser.email ?? "The outgoing Director",
    fromEmail: t.fromUser.email,
    toName: t.toUser.name ?? t.toUser.email ?? "your successor",
    toEmail: t.toUser.email,
    note: t.note,
    stepDownRole: t.stepDownRole ? "OSE_STAFF" : null,
    createdAt: t.createdAt.toISOString(),
  })
  const incoming = incomingTransfers.map(toView)
  const outgoing = outgoingTransfers.map(toView)

  return (
    <div className="w-full space-y-6">
      {/* OSE administrator access */}
      <Card>
        <CardHeader
          title="OSE administrator access"
          subtitle="Who can enter this console, and at what level. Director ⊇ Staff ⊇ Advisor."
        />
        <ul className="mb-4 divide-y divide-border">
          {memberships.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-2.5">
              <Avatar name={m.user.name ?? m.user.email ?? "?"} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-1">
                  {m.user.name ?? m.user.email}
                </p>
                {m.user.email && (
                  <p className="truncate text-[13px]">
                    <EmailLink email={m.user.email} />
                  </p>
                )}
              </div>
              <Badge variant="accent">OSE {roleLabel(m.role)}</Badge>
              {canGrant && (
                <ConfirmSubmit
                  action={adminRevokeInstitutionRole}
                  hiddenFields={{ membershipId: m.id }}
                  title="Remove OSE access?"
                  description={`Remove ${m.user.name ?? m.user.email}'s OSE access? They'll lose the Admin console immediately. Their audit history is kept.`}
                  details={
                    m.role === "OSE_DIRECTOR"
                      ? "This person is an OSE Director. If they're the last Director, use “Transfer Director role” instead — the institution must always keep at least one Director."
                      : undefined
                  }
                  confirmLabel="Remove access"
                  variant="danger"
                  triggerClassName="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-text-3 hover:bg-base hover:text-[--error]"
                  triggerAriaLabel={`Revoke access for ${m.user.name ?? m.user.email}`}
                >
                  <X size={15} /> Revoke
                </ConfirmSubmit>
              )}
            </li>
          ))}
        </ul>

        {canGrant && (
          <form action={adminGrantInstitutionRole} className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
            <label className="flex min-w-56 flex-1 flex-col gap-1.5 text-[13px] font-semibold text-text-2">
              Grant access to (email)
              <input
                type="email"
                name="email"
                required
                placeholder="staff@rochester.edu"
                className="h-10 w-full rounded-md border border-border px-3.5 text-[15px] text-text-1 outline-none focus:border-[--border-focus]"
              />
            </label>
            <Select
              label="Role"
              name="role"
              defaultSelectedKey="OSE_STAFF"
              className="min-w-40"
              options={[
                { value: "OSE_STAFF", label: "Staff" },
                { value: "OSE_ADVISOR", label: "Advisor" },
                { value: "OSE_DIRECTOR", label: "Director" },
              ]}
            />
            <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[--accent] px-5 text-sm font-medium text-[--accent-text] hover:bg-[--accent-hover]">
              <ShieldCheck size={16} /> Grant access
            </button>
          </form>
        )}
      </Card>

      {/* Director transfer pipeline */}
      <RoleTransferPanel incoming={incoming} outgoing={outgoing} canInitiate={canTransfer} />

      {/* Directory */}
      <Card padding="none">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
          <CardHeader
            title={`University directory (${peopleCount})`}
            subtitle="People available to assign to board seats. The picker searches this source."
          />
        </div>

        {canDirectory && (
          <form action={adminAddDirectoryPerson} className="flex flex-wrap items-end gap-3 border-b border-border p-5">
            <label className="flex min-w-40 flex-1 flex-col gap-1.5 text-[13px] font-semibold text-text-2">
              Name
              <input name="name" required placeholder="Jordan Lee" className="h-10 rounded-md border border-border px-3.5 text-[15px] text-text-1 outline-none focus:border-[--border-focus]" />
            </label>
            <label className="flex min-w-40 flex-1 flex-col gap-1.5 text-[13px] font-semibold text-text-2">
              Email
              <input type="email" name="email" required placeholder="jlee@rochester.edu" className="h-10 rounded-md border border-border px-3.5 text-[15px] text-text-1 outline-none focus:border-[--border-focus]" />
            </label>
            <Select
              label="Kind"
              name="kind"
              defaultSelectedKey="STUDENT"
              className="min-w-36"
              options={[
                { value: "STUDENT", label: "Student" },
                { value: "ADVISOR", label: "Advisor" },
              ]}
            />
            <label className="flex min-w-40 flex-1 flex-col gap-1.5 text-[13px] font-semibold text-text-2">
              Affiliation (optional)
              <input name="affiliation" placeholder="Ainslie OSE" className="h-10 rounded-md border border-border px-3.5 text-[15px] text-text-1 outline-none focus:border-[--border-focus]" />
            </label>
            <button className="inline-flex h-10 items-center gap-2 rounded-md bg-[--primary] px-5 text-sm font-medium text-[--primary-text] hover:bg-[--primary-hover]">
              <UserPlus size={16} /> Add person
            </button>
          </form>
        )}

        <ul className="grid gap-x-6 gap-y-1 p-5 sm:grid-cols-2 xl:grid-cols-3">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <Avatar name={p.name} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text-1">{p.name}</p>
                <p className="truncate text-[13px] text-text-3">
                  {p.email}
                  {p.affiliation ? ` · ${p.affiliation}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
        {peopleCount > people.length && (
          <p className="border-t border-border px-5 py-3 text-[13px] text-text-3">
            Showing {people.length} of {peopleCount}. Use the directory picker on a seat to search everyone.
          </p>
        )}
      </Card>
    </div>
  )
}
