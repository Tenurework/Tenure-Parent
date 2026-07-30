import { notFound, redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { canViewOrg, getUserContext } from "@/lib/rbac"
import {
  CalendarCheck,
  CheckCircle,
  DollarSign,
  BookOpen,
  Users,
  Handshake,
} from "@/components/ui/icons"
import { Card, CardHeader } from "@/components/ui/Card"
import { StatGrid, StatTile } from "@/components/ui/Bento"
import { OrgTabs } from "@/components/OrgTabs"
import { formatCents } from "@/lib/finance"

export const dynamic = "force-dynamic"

const CURRENT_YEAR = "2026-2027"

/**
 * The club Impact page — an auto-generated, shareable outcome summary for OSE
 * reporting and successor onboarding, built entirely from data the club already
 * produces (events, approvals, budget, knowledge, collaboration). No manual
 * assembly; it's always current.
 */
export default async function ImpactPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")

  const org = await db.organization.findUnique({ where: { slug } })
  if (!org) notFound()
  const ctx = await getUserContext(session.user.id)
  if (!canViewOrg(ctx, org)) notFound()

  const [eventsPublished, approvalGroups, budgetLines, memoryCards, activeMembers, collaborations] =
    await Promise.all([
      db.event.count({ where: { organizationId: org.id, status: "PUBLISHED" } }),
      db.approvalRequest.groupBy({
        by: ["status"],
        where: { organizationId: org.id },
        _count: { _all: true },
      }),
      db.budgetLine.findMany({
        where: { organizationId: org.id, academicYear: CURRENT_YEAR },
        select: { budgetedCents: true, actualCents: true },
      }),
      db.memoryRecord.count({ where: { organizationId: org.id, isArchived: false } }),
      db.roleAssignment.count({
        where: { status: "ACTIVE", role: { organizationId: org.id } },
      }),
      db.collabInterest.count({ where: { organizationId: org.id, status: "APPROVED" } }),
    ])

  const countBy = Object.fromEntries(approvalGroups.map((g) => [g.status, g._count._all]))
  const approved = countBy["APPROVED"] ?? 0
  const rejected = countBy["REJECTED"] ?? 0
  const pending =
    (countBy["PENDING_PRESIDENT"] ?? 0) +
    (countBy["PENDING_OSE"] ?? 0) +
    (countBy["NEEDS_CHANGES"] ?? 0) +
    (countBy["DRAFT"] ?? 0)
  const decided = approved + rejected
  const approvalRate = decided > 0 ? Math.round((approved / decided) * 100) : null

  const budgeted = budgetLines.reduce((s, l) => s + l.budgetedCents, 0)
  const actual = budgetLines.reduce((s, l) => s + l.actualCents, 0)
  const budgetPct = budgeted > 0 ? Math.round((actual / budgeted) * 100) : 0

  const name = org.shortName ?? org.name
  const narrative = [
    `${name} published ${eventsPublished} event${eventsPublished === 1 ? "" : "s"}`,
    `cleared ${approved} approval${approved === 1 ? "" : "s"}${approvalRate !== null ? ` (${approvalRate}% approval rate)` : ""}`,
    budgeted > 0 ? `delivered ${formatCents(actual)} of a ${formatCents(budgeted)} budget` : null,
    `and captured ${memoryCards} knowledge card${memoryCards === 1 ? "" : "s"} for the next board`,
  ]
    .filter(Boolean)
    .join(", ")

  const approvalTotal = approved + rejected + pending || 1
  const segs = [
    { label: "Approved", value: approved, color: "var(--success)" },
    { label: "Rejected", value: rejected, color: "var(--error)" },
    { label: "In flight", value: pending, color: "var(--border-strong)" },
  ]

  return (
    <div className="w-full">
      <div className="mb-6">
        <h1 className="text-text-1">{org.name}</h1>
        <p className="mt-1 text-lead text-text-2">
          Impact — a shareable summary of what this club has achieved, auto-built from its own record.
        </p>
      </div>
      <OrgTabs slug={slug} />

      <p className="mb-5 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-1">
        {narrative}.
      </p>

      <div className="mb-5">
        <StatGrid>
          <StatTile label="Events published" value={eventsPublished} icon={CalendarCheck} />
          <StatTile
            label="Approvals cleared"
            value={approved}
            hint={approvalRate !== null ? `${approvalRate}% approval rate` : "no decisions yet"}
            icon={CheckCircle}
          />
          <StatTile
            label="Budget delivered"
            value={`${budgetPct}%`}
            hint={budgeted > 0 ? `${formatCents(actual)} of ${formatCents(budgeted)}` : "no budget set"}
            icon={DollarSign}
          />
          <StatTile label="Knowledge captured" value={memoryCards} hint="cards for successors" icon={BookOpen} />
        </StatGrid>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Approval outcomes" subtitle="Every request this club has put through the chain" />
          <div className="flex h-3 overflow-hidden rounded-full bg-base">
            {segs.map(
              (s) =>
                s.value > 0 && (
                  <div
                    key={s.label}
                    style={{ width: `${(s.value / approvalTotal) * 100}%`, background: s.color }}
                    title={`${s.label}: ${s.value}`}
                  />
                )
            )}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-text-2">
            {segs.map((s) => (
              <li key={s.label} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                {s.label} <span className="font-semibold tabular-nums text-text-1">{s.value}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="This year at a glance" subtitle="Engagement + collaboration" />
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="micro-label">Active members</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 text-lead font-semibold text-text-1">
                <Users size={16} className="text-text-3" /> {activeMembers}
              </dd>
            </div>
            <div>
              <dt className="micro-label">Collaborations</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 text-lead font-semibold text-text-1">
                <Handshake size={16} className="text-text-3" /> {collaborations}
              </dd>
            </div>
            <div>
              <dt className="micro-label">Budget used</dt>
              <dd className="mt-0.5 text-lead font-semibold text-text-1">{budgetPct}%</dd>
            </div>
            <div>
              <dt className="micro-label">Knowledge cards</dt>
              <dd className="mt-0.5 text-lead font-semibold text-text-1">{memoryCards}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  )
}
