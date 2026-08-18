import { notFound, redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { canManageOrg, canManageRoster, canViewOrg, getUserContext } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import { storageConfigured } from "@/lib/s3"
import { Card, CardHeader } from "@/components/ui/Card"
import { AssignmentBadge, Badge } from "@/components/ui/Badge"
import { OrgRecordHeader } from "@/components/OrgRecordHeader"
import { EmailLink } from "@/components/EmailLink"
import { ClubImageEditor } from "@/components/ClubImageEditor"
import { ConfirmSubmit } from "@/components/ui/ConfirmDialog"
import { getAllowedRecipients } from "@/lib/messaging-data"
import { assignMember, transitionAssignment } from "./actions"
import { startDm } from "@/app/(app)/messages/actions"

export const dynamic = "force-dynamic"

/** An empty seat is a fact worth stating plainly, not a blank space. */
const VACANT_LABEL = "Vacant Position"

export default async function MembersPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")

  return withTenantScope(session.user.id, async () => {
    const org = await db.organization.findUnique({
      where: { slug },
      include: {
        advisors: {
          include: { person: true },
        },
        roles: {
          // seatOrder preserves the order OSE publishes; nulls (e.g. the generic
          // Member seat) sort last
          orderBy: [{ seat: { seatOrder: "asc" } }, { scope: "asc" }],
          include: {
            seat: true,
            assignments: {
              orderBy: { startDate: "desc" },
              include: { user: { select: { name: true, email: true } } },
            },
            holdings: {
              include: { person: true },
              orderBy: { term: "desc" },
            },
          },
        },
      },
    })
    if (!org) notFound()

    const ctx = await getUserContext(session.user.id)
    if (!canViewOrg(ctx, org)) notFound()
    const canManage = canManageRoster(ctx, org)
    const canEditImage = canManageOrg(ctx, org)

    // Board members you're allowed to message get a name that opens an in-app DM.
    const viewerId = session.user.id
    const messageableIds = new Set((await getAllowedRecipients(viewerId)).map((u) => u.id))

    const assignWithSlug = assignMember.bind(null, slug)
    const transitionWithSlug = transitionAssignment.bind(null, slug)

    const current = org.roles.map((role) => ({
      ...role,
      assignments: role.assignments.filter((a) => a.status !== "ALUMNI"),
    }))
    const alumni = org.roles.flatMap((role) =>
      role.assignments
        .filter((a) => a.status === "ALUMNI")
        .map((a) => ({ ...a, roleName: role.name }))
    )

    // The record's STATE, for the header's status row. A seat counts as filled
    // when the OSE roster names a current holder OR an in-app assignment does;
    // that is the same test `isVacant` applies per row below, hoisted so the
    // header and the rows cannot disagree about how many seats are empty.
    const filledSeats = current.filter(
      (role) => role.holdings.some((h) => h.isCurrent) || role.assignments.length > 0
    ).length

    return (
      <div className="w-full">
        <OrgRecordHeader
          slug={slug}
          org={org}
          section="Members and roster"
          subtitle="Member list & roster — every board seat, who holds it now, and who held it before."
          status={
            <>
              <Badge variant={filledSeats === current.length ? "success" : "warning"}>
                {filledSeats}/{current.length} seats filled
              </Badge>
              <Badge variant="default">{alumni.length} alumni</Badge>
              <Badge variant="default">{org.advisors.length} advisors</Badge>
            </>
          }
          actions={
            canEditImage ? (
              <ClubImageEditor
                orgId={org.id}
                orgName={org.name}
                logoUrl={org.logoUrl}
                canUpload={storageConfigured()}
              />
            ) : undefined
          }
        />

        {org.advisors.length > 0 && (
          <Card className="mb-4">
            <CardHeader
              title="Club advisors"
              subtitle="Your staff and faculty contacts — boards must meet with an advisor at least twice per mini-mester."
            />
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {org.advisors.map(({ person }) => (
                <li
                  key={person.id}
                  className="rounded border border-border p-3"
                >
                  <p className="text-sm font-medium text-text-1">{person.name}</p>
                  {person.affiliation && (
                    <p className="text-xs text-text-3">{person.affiliation}</p>
                  )}
                  <p className="mt-1 text-xs">
                    <EmailLink email={person.email} showIcon />
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="space-y-4">
          {current.map((role) => {
            const holders = role.holdings.filter((h) => h.isCurrent)
            const past = role.holdings.filter((h) => !h.isCurrent)
            const isVacant = holders.length === 0 && role.assignments.length === 0

            return (
            <Card key={role.id}>
              <CardHeader
                title={role.name}
                subtitle={
                  role.seat?.positionCode
                    ? `Position ID ${role.seat.positionCode} — permanent seat, knowledge stays with the job`
                    : role.description ?? undefined
                }
                action={
                  <div className="flex items-center gap-2">
                    {isVacant && <Badge variant="warning">{VACANT_LABEL}</Badge>}
                    <Badge variant="info">{role.scope.toLowerCase()}</Badge>
                  </div>
                }
              />

              {role.seat?.positionNote && (
                <p className="mb-3 text-xs text-text-2">Note: {role.seat.positionNote}</p>
              )}

              {/* Current holders from the OSE roster */}
              {holders.length > 0 && (
                <ul className="mb-3 divide-y divide-border">
                  {holders.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-1">{h.person.name}</p>
                        <p className="text-xs">
                          <EmailLink
                            email={h.person.email}
                            subject={`${org.shortName ?? org.name} — ${role.name}`}
                          />
                        </p>
                      </div>
                      <Badge variant="success">{h.term}</Badge>
                    </li>
                  ))}
                </ul>
              )}

              {isVacant && (
                <p className="mb-3 text-sm text-text-3">
                  {VACANT_LABEL}
                  {role.seat?.vacancyNote ? ` — ${role.seat.vacancyNote}` : ""}
                </p>
              )}

              {/* Who held this seat before — the handoff contact */}
              {past.length > 0 && (
                <div className="mb-3 rounded border border-dashed border-border p-3">
                  <p className="text-xs font-medium text-text-2">
                    Previously held by
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {past.map((h) => (
                      <li key={h.id} className="text-xs text-text-3">
                        <span className="text-text-1">{h.person.name}</span> ({h.term}) ·{" "}
                        <EmailLink
                          email={h.person.email}
                          subject={`${org.shortName ?? org.name} — question about the ${role.name} role`}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {role.assignments.length === 0 ? null : (
                <ul className="divide-y divide-border">
                  {role.assignments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between py-2.5">
                      <div>
                        {messageableIds.has(a.userId) && a.userId !== viewerId ? (
                          <form action={startDm}>
                            <input type="hidden" name="userId" value={a.userId} />
                            <button
                              type="submit"
                              className="text-sm font-medium text-text-1 transition-colors hover:text-[--text-link] hover:underline"
                              title={`Message ${a.user.name ?? a.user.email} in Tenure`}
                            >
                              {a.user.name ?? a.user.email}
                            </button>
                          </form>
                        ) : (
                          <p className="text-sm font-medium text-text-1">
                            {a.user.name ?? a.user.email}
                          </p>
                        )}
                        <p className="text-xs text-text-3">
                          {a.user.email && <EmailLink email={a.user.email} />} · since{" "}
                          {a.startDate.toLocaleDateString("en-US", {
                            month: "short",
                            year: "numeric",
                          })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <AssignmentBadge status={a.status} />
                        {canManage && a.status === "SHADOW" && (
                          <form action={transitionWithSlug}>
                            <input type="hidden" name="assignmentId" value={a.id} />
                            <input type="hidden" name="to" value="ACTIVE" />
                            <button className="text-xs font-medium text-[--text-link] hover:underline">
                              Activate
                            </button>
                          </form>
                        )}
                        {canManage && a.status === "ACTIVE" && (
                          <ConfirmSubmit
                            action={transitionWithSlug}
                            hiddenFields={{ assignmentId: a.id, to: "ALUMNI" }}
                            title="End this term?"
                            description={`${a.user.name ?? a.user.email} becomes an alum of the ${role.name} seat. Their access to ${org.name} is revoked immediately and they're notified. The seat's history is kept, but there's no undo — restoring access means adding them back as a new assignment.`}
                            confirmLabel="End term"
                            variant="danger"
                            triggerClassName="text-xs font-medium text-text-3 hover:underline hover:text-[--error]"
                            triggerAriaLabel={`End term for ${a.user.name ?? a.user.email}`}
                          >
                            End term
                          </ConfirmSubmit>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            )
          })}

          {canManage && (
            <Card>
              <CardHeader
                title="Add to roster"
                subtitle="Assign someone to a role seat. Shadow gives read-only access before the term begins."
              />
              <form action={assignWithSlug} className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs text-text-2">
                  Email
                  <input
                    type="email"
                    name="email"
                    required
                    placeholder="student@rochester.edu"
                    className="h-9 w-64 rounded border border-border px-3 text-sm text-text-1 bg-surface placeholder:text-text-3"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-text-2">
                  Role
                  <select
                    name="roleId"
                    required
                    className="h-9 rounded border border-border px-2 text-sm text-text-1 bg-surface"
                  >
                    {org.roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-text-2">
                  Status
                  <select
                    name="status"
                    className="h-9 rounded border border-border px-2 text-sm text-text-1 bg-surface"
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="SHADOW">Shadow (incoming)</option>
                  </select>
                </label>
                <button
                  type="submit"
                  className="h-9 rounded bg-[--primary] px-4 text-sm font-medium text-[--primary-text] hover:opacity-90"
                >
                  Add
                </button>
              </form>
            </Card>
          )}

          {alumni.length > 0 && (
            <Card>
              <CardHeader
                title="Past holders"
                subtitle="Institutional record — access revoked, history preserved."
              />
              <ul className="divide-y divide-border">
                {alumni.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="text-sm font-medium text-text-1">
                        {a.user.name ?? a.user.email}
                      </p>
                      <p className="text-xs text-text-3">
                        {a.roleName} ·{" "}
                        {a.startDate.toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                        {" – "}
                        {a.endDate?.toLocaleDateString("en-US", { month: "short", year: "numeric" }) ?? "?"}
                      </p>
                    </div>
                    <AssignmentBadge status="ALUMNI" />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    )
  })
}
