import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import {
  CheckCircle,
  Calendar,
  MessageSquare,
  Users,
  ArrowRight,
  Clock,
  type IconType,
} from "@/components/ui/icons"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import { QuickLinks } from "@/components/QuickLinks"
import { seatKeysForRole, type SeatKey } from "@/lib/resources"
import { listResources, resourceInstitutionFor } from "@/lib/resources-data"
import { Card } from "@/components/ui/Card"
import { StatGrid, StatTile, type StatDelta } from "@/components/ui/Bento"
import { Meter } from "@/components/charts"
import { ActivityChart } from "@/components/charts/panels/ActivityChart"
import { bucketByWeek, bucketByWeekForward, trendDelta } from "@/components/charts/timeseries"
import { SeeAllSection } from "@/components/ui/SeeAllSection"
import { Avatar } from "@/components/ui/Avatar"
import { carriesFinanceAuthority } from "@/lib/rbac"
import { formatCents } from "@/lib/finance"
import { OPEN_APPROVAL_STATUSES } from "@/lib/analytics/metrics"

export const metadata: Metadata = { title: "Dashboard" }
export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")

  return withTenantScope(session.user.id, async () => {
    const ctx = await getUserContext(session.user.id)

    // Same visibility scope as /orgs: OSE sees the institution, members see their clubs
    const oseInstitutionIds = ctx.institutionRoles.map((m) => m.institutionId)
    const memberOrgIds = ctx.orgRoles
      .filter((r) => r.status === "SHADOW" || r.status === "ACTIVE")
      .map((r) => r.organizationId)
    const isOse = oseInstitutionIds.length > 0

    const orgs = await db.organization.findMany({
      where: {
        OR: [
          { institutionId: { in: oseInstitutionIds } },
          { id: { in: memberOrgIds } },
        ],
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true },
    })
    const orgIds = orgs.map((o) => o.id)

    const mySeats = await db.roleAssignment.findMany({
      where: { userId: ctx.userId, status: { in: ["ACTIVE", "SHADOW"] } },
      include: {
        role: {
          include: { seat: true, organization: { select: { id: true, name: true, slug: true } } },
        },
      },
      orderBy: { startDate: "desc" },
    })

    // Clubs whose money this person answers for (VP Finance / president seats):
    // their budget summary belongs on the first page they land on, not three
    // clicks deep behind a club tab.
    const financeOrgs = [
      ...new Map(
        mySeats
          .filter(
            (s) =>
              s.status === "ACTIVE" &&
              (s.role.scope === "PRESIDENT" || carriesFinanceAuthority(s.role))
          )
          .map((s) => [s.role.organization.id, s.role.organization])
      ).values(),
    ]

    const financeSummaries =
      financeOrgs.length > 0
        ? await Promise.all(
            financeOrgs.map(async (org) => {
              const agg = await db.budgetLine.aggregate({
                where: { organizationId: org.id, academicYear: "2026-2027" },
                _sum: { budgetedCents: true, actualCents: true },
              })
              return {
                org,
                budgetedCents: agg._sum.budgetedCents ?? 0,
                actualCents: agg._sum.actualCents ?? 0,
              }
            })
          )
        : []

    // Trend windows for the KPI sparklines and the activity chart.
    const now = new Date()
    const TREND_WEEKS = 12
    const trendSince = new Date(now.getTime() - TREND_WEEKS * 7 * 86_400_000)
    // "Upcoming Events" is a forward-looking tile, so its series looks forward too.
    const trendUntil = new Date(now.getTime() + TREND_WEEKS * 7 * 86_400_000)
    const activitySince = new Date(now.getTime() - 30 * 86_400_000)

    const [
      pendingApprovals,
      upcomingEvents,
      unreadMessages,
      activeMembers,
      memberCounts,
      recentAudit,
      approvalTrend,
      eventTrend,
      activityAudit,
    ] = await Promise.all([
        db.approvalRequest.count({
          where: {
            organizationId: { in: orgIds },
            // ANL-000-002. The set is `lib/analytics/metrics.ts`, not a literal
            // here: this tile and the one on /reports name the same metric.
            status: { in: [...OPEN_APPROVAL_STATUSES] },
          },
        }),
        db.event.count({
          where: { organizationId: { in: orgIds }, startAt: { gte: now } },
        }),
        db.delivery.count({
          where: { readAt: null, participant: { userId: ctx.userId } },
        }),
        db.roleAssignment.count({
          where: { status: "ACTIVE", role: { organizationId: { in: orgIds } } },
        }),
        db.roleAssignment.groupBy({
          by: ["roleId"],
          where: { status: "ACTIVE", role: { organizationId: { in: orgIds } } },
          _count: true,
        }),
        db.auditEvent.findMany({
          where: { organizationId: { in: orgIds } },
          orderBy: { occurredAt: "desc" },
          take: 24,
          include: { institution: { select: { name: true } } },
        }),
        db.approvalRequest.findMany({
          where: { organizationId: { in: orgIds }, createdAt: { gte: trendSince } },
          select: { createdAt: true },
        }),
        db.event.findMany({
          where: { organizationId: { in: orgIds }, startAt: { gte: now, lt: trendUntil } },
          select: { startAt: true },
        }),
        db.auditEvent.findMany({
          where: { organizationId: { in: orgIds }, occurredAt: { gte: activitySince } },
          select: { occurredAt: true },
        }),
      ])

    // Weekly buckets → sparkline series, plus a week-over-week delta chip.
    const approvalSpark = bucketByWeek(approvalTrend.map((a) => a.createdAt), TREND_WEEKS, now)
    const eventSpark = bucketByWeekForward(eventTrend.map((e) => e.startAt), TREND_WEEKS, now)
    const fmtDelta = (d: { direction: "up" | "down" | "flat"; pct: number }) =>
      d.direction === "up" ? `+${d.pct}%` : d.direction === "down" ? `−${d.pct}%` : "0%"
    const approvalTrendDelta = trendDelta(approvalSpark)
    const eventTrendDelta = trendDelta(eventSpark)
    const activityEvents = activityAudit.map((a) => a.occurredAt.toISOString())

    // Map role→org so club cards show real member counts
    const rolesByOrg = await db.role.findMany({
      where: { organizationId: { in: orgIds } },
      select: { id: true, organizationId: true },
    })
    const orgMemberCount = new Map<string, number>()
    for (const rc of memberCounts) {
      const orgId = rolesByOrg.find((r) => r.id === rc.roleId)?.organizationId
      if (orgId) orgMemberCount.set(orgId, (orgMemberCount.get(orgId) ?? 0) + rc._count)
    }

    const actorNames = new Map<string, string>()
    const actorIds = [...new Set(recentAudit.map((a) => a.actorId).filter((x): x is string => !!x))]
    if (actorIds.length) {
      const users = await db.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, email: true },
      })
      for (const u of users) actorNames.set(u.id, u.name ?? u.email ?? "Unknown")
    }
    const orgNames = new Map(orgs.map((o) => [o.id, o.name]))

    type Kpi = {
      label: string
      value: number
      hint: string
      icon: IconType
      color: string
      bg: string
      href: string
      delta?: StatDelta
      spark?: number[]
    }

    const kpis: Kpi[] = [
      {
        label: "Pending Approvals",
        value: pendingApprovals,
        hint: "Awaiting a decision",
        icon: CheckCircle,
        color: "var(--warning)",
        bg: "var(--warning-light)",
        href: "/approvals",
        spark: approvalSpark,
        // A shrinking backlog is the good direction.
        delta: {
          value: fmtDelta(approvalTrendDelta),
          direction: approvalTrendDelta.direction,
          good: approvalTrendDelta.direction === "down",
        },
      },
      {
        label: "Upcoming Events",
        value: upcomingEvents,
        hint: "On the shared calendar",
        icon: Calendar,
        color: "var(--primary)",
        bg: "var(--primary-light)",
        href: "/calendar",
        spark: eventSpark,
        delta: {
          value: fmtDelta(eventTrendDelta),
          direction: eventTrendDelta.direction,
          good: eventTrendDelta.direction === "up",
        },
      },
      {
        label: "Unread Messages",
        value: unreadMessages,
        hint: "In your conversations",
        icon: MessageSquare,
        color: "var(--success)",
        bg: "var(--success-light)",
        href: "/messages",
      },
      {
        label: "Active Members",
        value: activeMembers,
        hint: `Across ${orgs.length} club${orgs.length === 1 ? "" : "s"}`,
        icon: Users,
        color: "var(--text-2)",
        bg: "var(--bg-base)",
        href: "/orgs",
      },
    ]

    // Resource audiences this person belongs to, across every seat they hold
    const quickLinkSeats: SeatKey[] = [
      ...new Set<SeatKey>([
        "ALL",
        ...ctx.orgRoles
          .filter((r) => r.status !== "ALUMNI")
          .flatMap((r) => seatKeysForRole(r.roleName)),
        ...(ctx.institutionRoles.length > 0 ? (["OSE"] as SeatKey[]) : []),
      ]),
    ]

    // Live from the institution's resource board, so anything OSE publishes shows
    // up here without a deploy.
    const resourceInstitutionId = await resourceInstitutionFor(ctx)
    const quickLinkResources = resourceInstitutionId
      ? await listResources(resourceInstitutionId)
      : []

    // Shared list renderers — the same markup drives the capped preview and the
    // full "See all" overlay, so nothing overflows a panel to a different height.
    const activityList = (items: typeof recentAudit) => (
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-3 py-3">
            <Clock size={15} className="mt-0.5 shrink-0 text-text-3" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text-1">
                <span className="font-medium">
                  {item.actorId ? actorNames.get(item.actorId) ?? "System" : "System"}
                </span>{" "}
                <span className="text-text-2">
                  {item.organizationId ? orgNames.get(item.organizationId) ?? "" : item.institution.name}
                </span>
                {" — "}
                {item.action}
                {item.outcome === "DENY" && " (denied)"}
              </p>
              <p className="mt-0.5 text-meta text-text-3">
                {item.occurredAt.toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </li>
        ))}
      </ul>
    )

    const seatsList = (items: typeof mySeats) => (
      <ul className="divide-y divide-border">
        {items.map((s) => {
          const isPres = s.role.scope === "PRESIDENT" && s.status === "ACTIVE"
          return (
            <li key={s.id} className="py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-text-1">
                  {s.role.name} · {s.role.organization.name}
                </p>
                {s.status === "SHADOW" && (
                  <span className="shrink-0 text-[13px]" style={{ color: "var(--info)" }}>
                    incoming
                  </span>
                )}
              </div>
              {s.role.seat?.positionCode && (
                <p className="mt-0.5 text-meta text-text-3">{s.role.seat.positionCode}</p>
              )}
              <div className="mt-1.5 flex flex-wrap gap-3 text-[13px]">
                <Link href={`/orgs/${s.role.organization.slug}/members`} className="text-[--text-link] no-underline hover:underline">
                  Members
                </Link>
                <Link href={`/orgs/${s.role.organization.slug}/memory`} className="text-[--text-link] no-underline hover:underline">
                  Seat memory
                </Link>
                {isPres ? (
                  <Link href="/approvals" className="text-[--text-link] no-underline hover:underline">
                    Review requests
                  </Link>
                ) : s.status === "ACTIVE" ? (
                  <Link href="/approvals/new" className="text-[--text-link] no-underline hover:underline">
                    New request
                  </Link>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    )

    const clubsList = (items: typeof orgs) => (
      <ul className="divide-y divide-border">
        {items.map((club) => (
          <li key={club.id}>
            <Link
              href={`/orgs/${club.slug}/members`}
              className="flex items-center gap-3 py-2.5 no-underline transition-colors hover:bg-base"
            >
              <Avatar name={club.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-1">{club.name}</p>
                <p className="text-meta text-text-3">
                  {orgMemberCount.get(club.id) ?? 0} active member
                  {(orgMemberCount.get(club.id) ?? 0) === 1 ? "" : "s"}
                </p>
              </div>
              <ArrowRight size={15} className="shrink-0 text-text-3" />
            </Link>
          </li>
        ))}
      </ul>
    )

    return (
      <div className="w-full">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-text-1">{isOse ? "OSE Dashboard" : "Dashboard"}</h1>
          <p className="mt-1 text-lead text-text-2">
            Welcome back, {session.user.name ?? session.user.email}
          </p>
        </div>

        {/* KPI tiles — uniform bento stat tiles, live counts scoped to this user */}
        <div className="mb-6">
          <StatGrid>
            {kpis.map((kpi) => (
              <StatTile
                key={kpi.label}
                label={kpi.label}
                value={kpi.value}
                hint={kpi.hint}
                icon={kpi.icon}
                href={kpi.href}
                delta={kpi.delta}
                spark={kpi.spark}
              />
            ))}
          </StatGrid>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Main column: activity trend chart above the recent-activity feed */}
          <div className="space-y-5 lg:col-span-2">
            <ActivityChart events={activityEvents} />

            {/* Recent activity — capped preview, full list in a See-all overlay */}
            <Card>
              <SeeAllSection
                title="Recent activity"
                count={recentAudit.length}
                overlayTitle="Recent activity"
                overlayDescription="From the institution audit log."
                full={recentAudit.length > 6 ? activityList(recentAudit) : undefined}
              >
                {recentAudit.length === 0 ? (
                  <p className="py-8 text-center text-sm text-text-3">
                    No activity yet — actions like roster changes will appear here.
                  </p>
                ) : (
                  activityList(recentAudit.slice(0, 6))
                )}
              </SeeAllSection>
            </Card>
          </div>

          {/* Right rail — the compact cards stack evenly beside recent activity */}
          <div className="space-y-5">
            {/* Budget at a glance for finance seats, linking to the full chart */}
            {financeSummaries.length > 0 && (
              <Card>
                <h2 className="text-sm font-semibold text-text-1">Club finances</h2>
                <ul className="mt-3 space-y-3">
                  {financeSummaries.map(({ org, budgetedCents, actualCents }) => {
                    const pct =
                      budgetedCents > 0
                        ? Math.min(100, Math.round((actualCents / budgetedCents) * 100))
                        : 0
                    const over = actualCents > budgetedCents
                    return (
                      <li key={org.id}>
                        <Link
                          href={`/orgs/${org.slug}/finance`}
                          className="group block no-underline"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm text-text-1 group-hover:text-[--primary]">
                              {org.name}
                            </span>
                            <ArrowRight size={13} className="shrink-0 text-text-3" />
                          </div>
                          {budgetedCents > 0 ? (
                            <>
                              <Meter
                                pct={pct}
                                tone={over ? "over" : "default"}
                                className="mt-1.5"
                                ariaLabel={`${org.name} budget used: ${pct}%`}
                              />
                              <p className="mt-1 text-meta text-text-3 tabular">
                                {formatCents(actualCents)} of {formatCents(budgetedCents)} spent
                                {over && (
                                  <span className="text-[--error]"> · over budget</span>
                                )}
                              </p>
                            </>
                          ) : (
                            <p className="mt-1 text-meta text-text-3">
                              No budget yet — set one up or upload a spreadsheet
                            </p>
                          )}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </Card>
            )}
            <QuickLinks resources={quickLinkResources} seats={quickLinkSeats} />
            {mySeats.length > 0 && (
              <Card>
                <SeeAllSection
                  title="My seats"
                  count={mySeats.length}
                  overlayTitle="My seats"
                  full={mySeats.length > 4 ? seatsList(mySeats) : undefined}
                >
                  {seatsList(mySeats.slice(0, 4))}
                </SeeAllSection>
              </Card>
            )}

            <Card>
              <SeeAllSection
                title={isOse ? "Enrolled Clubs" : "My Clubs"}
                count={orgs.length}
                overlayTitle={isOse ? "Enrolled Clubs" : "My Clubs"}
                full={orgs.length > 6 ? clubsList(orgs) : undefined}
              >
                {orgs.length === 0 ? (
                  <p className="py-6 text-center text-sm text-text-3">No clubs yet.</p>
                ) : (
                  clubsList(orgs.slice(0, 6))
                )}
              </SeeAllSection>
            </Card>
          </div>
        </div>
      </div>
    )
  })
}
