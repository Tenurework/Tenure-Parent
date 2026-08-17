import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { canViewOrg, getUserContext } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import {
  Users,
  CheckCircle,
  CalendarDays,
  DollarSign,
  BookOpen,
  Handshake,
} from "@/components/ui/icons"
import { Card, CardHeader } from "@/components/ui/Card"
import { StatGrid, StatTile } from "@/components/ui/Bento"
import { Badge, ApprovalBadge } from "@/components/ui/Badge"
import { OrgRecordHeader } from "@/components/OrgRecordHeader"
import { AIScopeAnchor } from "@/components/ai/AIProvider"
import { EmailLink } from "@/components/EmailLink"
import { EmptyState } from "@/components/ui/EmptyState"
import { formatCents } from "@/lib/finance"
import { successorHandoffPacket } from "@/lib/people/seat-memory-boundary"
import type { ApprovalStatus } from "@prisma/client"
import { UNDECIDED_APPROVAL_STATUSES } from "@/lib/analytics/metrics"

export const dynamic = "force-dynamic"

const CURRENT_YEAR = "2026-2027"

/**
 * The term-transition handoff packet — Tenure's reason to exist. When a seat
 * changes hands, the successor needs one place with: who held this job and how
 * to reach them, how much preserved knowledge is attached to the seat, and what
 * is still open (approvals, deadlines, budget). Assembled live from the seat
 * lifecycle so it is always current, never a stale onboarding doc.
 */
export default async function HandoffPage({
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
        advisors: { include: { person: true } },
        roles: {
          orderBy: [{ seat: { seatOrder: "asc" } }, { scope: "asc" }],
          include: {
            seat: true,
            holdings: { include: { person: true }, orderBy: { term: "desc" } },
            assignments: {
              where: { status: { in: ["ACTIVE", "SHADOW"] } },
              include: { user: { select: { name: true, email: true } } },
            },
            // HCM-040-003. The classification columns, not a count. A count
            // said "12 knowledge cards" to an incoming officer over a set that
            // included the seat's login card and everything labelled
            // `restricted` — a promise of knowledge that will not be handed
            // over. `successorHandoffPacket` splits it three ways.
            memoryRecords: {
              where: { isArchived: false },
              select: { id: true, roleId: true, type: true, sensitivity: true },
            },
          },
        },
      },
    })
    if (!org) notFound()

    const ctx = await getUserContext(session.user.id)
    if (!canViewOrg(ctx, org)) notFound()

    const now = new Date()
    const [deliverables, pendingApprovals, budgetLines] = await Promise.all([
      db.deliverable.findMany({
        where: { institutionId: org.institutionId, dueAt: { gte: now } },
        orderBy: { dueAt: "asc" },
        take: 6,
      }),
      db.approvalRequest.findMany({
        where: {
          organizationId: org.id,
          // ANL-000-002. "Still in flight" is `UNDECIDED_APPROVAL_STATUSES`,
          // which is a different population from "awaiting decision" and is now
          // named as such rather than spelled out here.
          status: { in: [...UNDECIDED_APPROVAL_STATUSES] },
        },
        orderBy: { updatedAt: "desc" },
        take: 6,
        select: { id: true, title: true, status: true },
      }),
      db.budgetLine.findMany({
        where: { organizationId: org.id, academicYear: CURRENT_YEAR },
        select: { budgetedCents: true, actualCents: true },
      }),
    ])

    const seats = org.roles.filter((r) => r.name !== "Member")
    const filledSeats = seats.filter(
      (r) => r.holdings.some((h) => h.isCurrent) || r.assignments.some((a) => a.status === "ACTIVE")
    ).length
    const budgeted = budgetLines.reduce((s, l) => s + l.budgetedCents, 0)
    const actual = budgetLines.reduce((s, l) => s + l.actualCents, 0)
    const budgetPct = budgeted > 0 ? Math.round((actual / budgeted) * 100) : 0

    return (
      <div className="w-full">
        {/* TTES-030-003. Declares the record this page is showing, so a
            question asked from here is asked about THIS club: the panel names
            it in its scope line and the id travels with the request. Renders
            nothing; clears on navigation. */}
        <AIScopeAnchor id={org.slug} label={org.name} />

        {/* TTES-030-001, Bible section 5.3 — record anatomy through the shared
            primitive: identity, then state, then the primary actions, then the
            content tabs, in that order and in the same place on every one of
            the club's six surfaces. This page used to reach for `PageHeader`
            directly, which put the anatomy right here and nowhere else; it now
            goes through the same `OrgRecordHeader` the other five do, so the
            order is a component rather than six agreements.

            ANL-000-002. The subtitle below said "live from the seat lifecycle"
            over four tiles that are read once, when the page renders, and never
            move again — a reader who left the tab open read an hour-old number
            labelled live. Nothing on this page polls; the honest word is "when
            this page loaded", and §19 names calling stale data real time. */}
        <OrgRecordHeader
          slug={slug}
          org={org}
          section="Transition and handoff"
          subtitle="Everything a new officer needs on day one, read from the seat lifecycle when this page loaded."
          status={
            <>
              <Badge variant={filledSeats === seats.length ? "success" : "info"}>
                {filledSeats}/{seats.length} seats filled
              </Badge>
              <Badge variant={pendingApprovals.length ? "info" : "default"}>
                {pendingApprovals.length} open approvals
              </Badge>
              <Badge variant="default">{CURRENT_YEAR}</Badge>
            </>
          }
          actions={
            <Link
              href={`/orgs/${slug}/memory`}
              className="inline-flex h-9 items-center rounded-md border border-border-strong px-3 text-sm font-medium text-text-1 no-underline transition-colors hover:bg-subtle"
            >
              Open institutional memory
            </Link>
          }
        />

        <div className="mb-5">
          <StatGrid>
            <StatTile label="Board seats filled" value={`${filledSeats}/${seats.length}`} icon={Users} />
            <StatTile
              label="Open approvals"
              value={pendingApprovals.length}
              hint="in the pipeline now"
              icon={CheckCircle}
            />
            <StatTile
              label="Upcoming deadlines"
              value={deliverables.length}
              hint="OSE deliverables ahead"
              icon={CalendarDays}
            />
            <StatTile
              label="Budget used"
              value={`${budgetPct}%`}
              hint={budgeted > 0 ? `${formatCents(actual)} of ${formatCents(budgeted)}` : "no budget set"}
              icon={DollarSign}
            />
          </StatGrid>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Board seats — who to ask, and how much knowledge is waiting */}
          <div className="space-y-3 lg:col-span-2">
            <div className="flex items-center gap-2">
              <Handshake size={18} className="text-[--primary]" />
              <h2 className="text-[15px] font-semibold text-text-1">Seats &amp; handoff contacts</h2>
            </div>
            {seats.map((role) => {
              const current = role.holdings.find((h) => h.isCurrent)
              const activeAssignee = role.assignments.find((a) => a.status === "ACTIVE")
              const shadow = role.assignments.find((a) => a.status === "SHADOW")
              const predecessor = role.holdings.find((h) => !h.isCurrent)
              // HCM-040-003. What this seat can actually pass on, decided per
              // card. `transferred` is the successor's inheritance; `rotated` is
              // access that must be reissued to them rather than handed over;
              // `withheld` stays with the person leaving, each with its reason.
              const packet = successorHandoffPacket(role.memoryRecords)
              const knowledge = packet.transferred.length
              return (
                <Card key={role.id} padding="sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text-1">{role.name}</p>
                      {role.seat?.positionCode && (
                        <p className="text-meta text-text-3">Position ID {role.seat.positionCode}</p>
                      )}
                    </div>
                    <Link
                      href={`/orgs/${slug}/memory`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[12px] text-text-2 no-underline hover:bg-base"
                    >
                      <BookOpen size={13} /> {knowledge} card{knowledge === 1 ? "" : "s"} you inherit
                    </Link>
                  </div>

                  {/* HCM-040-003. Said, not hidden. A successor who is told
                      only what transfers spends the term discovering the gaps
                      one confused request at a time; a predecessor who is told
                      nothing cannot check that what should have stayed did. */}
                  {(packet.rotated.length > 0 || packet.withheld.length > 0) && (
                    <p className="mt-2 text-[12px] text-text-3">
                      {packet.rotated.length > 0 && (
                        <>
                          {packet.rotated.length} access card
                          {packet.rotated.length === 1 ? "" : "s"} reissued to you, never handed
                          over
                          {packet.withheld.length > 0 ? " · " : ""}
                        </>
                      )}
                      {packet.withheld.length > 0 && (
                        <>
                          {packet.withheld.length} stay{packet.withheld.length === 1 ? "s" : ""}{" "}
                          with the outgoing holder: {packet.withheld[0].reason}
                        </>
                      )}
                    </p>
                  )}

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <HandoffContact
                      role="Holds it now"
                      name={current?.person.name ?? activeAssignee?.user.name ?? activeAssignee?.user.email ?? null}
                      email={current?.person.email ?? activeAssignee?.user.email ?? null}
                      term={current?.term}
                      orgName={org.shortName ?? org.name}
                      seat={role.name}
                      tone="current"
                    />
                    <HandoffContact
                      role="Held it before — ask them"
                      name={predecessor?.person.name ?? null}
                      email={predecessor?.person.email ?? null}
                      term={predecessor?.term}
                      orgName={org.shortName ?? org.name}
                      seat={role.name}
                      tone="past"
                    />
                  </div>
                  {shadow && (
                    <p className="mt-2 flex items-center gap-1.5 text-[12px] text-text-3">
                      <Badge variant="info">Incoming</Badge>
                      {shadow.user.name ?? shadow.user.email} is shadowing this seat
                    </p>
                  )}
                </Card>
              )
            })}
          </div>

          {/* Open items sidebar */}
          <div className="space-y-5">
            <Card padding="sm">
              <CardHeader title="Upcoming deadlines" subtitle="OSE deliverables you inherit" />
              {deliverables.length === 0 ? (
                <p className="text-[13px] text-text-3">Nothing due soon.</p>
              ) : (
                <ul className="space-y-2.5">
                  {deliverables.map((d) => (
                    <li key={d.id} className="flex items-start justify-between gap-3">
                      <span className="min-w-0 text-[13px] text-text-1">{d.title}</span>
                      <span className="shrink-0 text-meta tabular-nums text-text-3">
                        {d.dueAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card padding="sm">
              <CardHeader title="Open approvals" subtitle="Requests still in flight" />
              {pendingApprovals.length === 0 ? (
                <p className="text-[13px] text-text-3">Nothing pending.</p>
              ) : (
                <ul className="space-y-2.5">
                  {pendingApprovals.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/approvals/${a.id}`}
                        className="flex items-start justify-between gap-2 no-underline"
                      >
                        <span className="min-w-0 text-[13px] text-text-1 hover:text-[--primary]">{a.title}</span>
                        <ApprovalBadge status={a.status as ApprovalStatus} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {org.advisors.length > 0 && (
              <Card padding="sm">
                <CardHeader title="Advisors" subtitle="Your staff & faculty contacts" />
                <ul className="space-y-2.5">
                  {org.advisors.map(({ person }) => (
                    <li key={person.id}>
                      <p className="text-[13px] font-medium text-text-1">{person.name}</p>
                      <p className="text-meta">
                        <EmailLink email={person.email} showIcon />
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>

        {seats.length === 0 && (
          <Card className="mt-5">
            <EmptyState
              state="empty"
              icon={Handshake}
              title="No board seats yet"
              description="Once this club has board positions, each one's handoff contacts and knowledge will appear here."
            />
          </Card>
        )}
      </div>
    )
  })
}

function HandoffContact({
  role,
  name,
  email,
  term,
  orgName,
  seat,
  tone,
}: {
  role: string
  name: string | null
  email: string | null
  term?: string
  orgName: string
  seat: string
  tone: "current" | "past"
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        tone === "past" ? "border-dashed border-border bg-base" : "border-border bg-surface"
      }`}
    >
      <p className="micro-label">{role}</p>
      {name ? (
        <>
          <p className="mt-1 text-sm font-medium text-text-1">{name}</p>
          {email && (
            <p className="mt-0.5 text-meta">
              <EmailLink email={email} subject={`${orgName} — ${seat}`} />
            </p>
          )}
          {term && <p className="mt-0.5 text-meta text-text-3">{term}</p>}
        </>
      ) : (
        <p className="mt-1 text-sm text-text-3">
          {tone === "past" ? "No predecessor on record" : "Currently vacant"}
        </p>
      )}
    </div>
  )
}
