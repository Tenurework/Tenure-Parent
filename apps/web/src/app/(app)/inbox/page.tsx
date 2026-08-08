import Link from "next/link"
import { redirect } from "next/navigation"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import { documentLocalization } from "@/lib/tenancy/locale-cookie"
import { PENDING_STATES, SLA_OVERDUE_DAYS } from "@/lib/approvals-sla"
import { seatKeysForRole } from "@/lib/resources"
import {
  BUCKET_LABELS,
  groupWorkItems,
  needsAttentionCount,
  type WorkItem,
  type WorkKind,
} from "@/lib/inbox/work-inbox"
import { addBusinessDays } from "@tenure/platform-config"
import { Card } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { PageHeader } from "@/components/ui/PageHeader"
import { EmptyState } from "@/components/ui/EmptyState"
import { Bell, CalendarDays, CheckCircle, FileText, ListTodo } from "@/components/ui/icons"

export const dynamic = "force-dynamic"

/**
 * TTES-030-001, Bible §5.1 — the work inbox.
 *
 * §5.1 asks the universal shell for a "Work inbox with approvals, tasks,
 * exceptions, mentions and due items", and the product had no such page. It had
 * five places to look instead: `/approvals` for requests, `/notifications` for
 * mentions, `/calendar` for OSE deliverables, nothing at all for exceptions,
 * and nothing that told a submitter their own request had come back needing
 * changes. "What needs me today" was a question the product could not answer.
 *
 * Every row here is a real row of real state — no aggregate table, no cached
 * counter, and nothing synthesised to fill a band. The five kinds map to what
 * actually exists in the schema:
 *
 *   * `approval` — a request in a pending gate that this person can see.
 *   * `exception` — the same, of `type: EXCEPTION`; separated because a policy
 *     override is not a routine request and burying it among twenty budget
 *     lines is how one gets nodded through.
 *   * `task` — a request THIS person submitted that came back `NEEDS_CHANGES`.
 *     The distinction is real and is not cosmetic: an approval is somebody
 *     else's decision to make and this is the submitter's own work to redo.
 *   * `mention` — an unread `Notification`.
 *   * `due` — an OSE `Deliverable` whose seat this person actually holds.
 *
 * There is deliberately no sixth kind invented for "tasks" beyond the one
 * above: the schema has no `Task` model, and a band populated from nothing
 * would be the fixture this codebase keeps refusing to ship.
 *
 * ## Where the deadline on an approval comes from
 *
 * Not invented here. `approvals-sla.ts` already defines a request as overdue at
 * `SLA_OVERDUE_DAYS` WORKING days in its current stage, and the SLO in
 * `modules/index.ts` measures against that same module. So the deadline is
 * `addBusinessDays(updatedAt, SLA_OVERDUE_DAYS, businessCalendar)` — the
 * institution's own calendar, the same one the `/approvals` list ages against.
 * Two definitions of "overdue" in one product is how a queue turns red on one
 * page and green on another.
 *
 * The ordering is NOT here: it is `src/lib/inbox/work-inbox.ts`, a pure module
 * with `now` as a parameter, so the rule that an overdue approval outranks a
 * minute-old greeting is a unit test rather than a claim.
 */
const KIND_ICON: Record<WorkKind, typeof Bell> = {
  approval: CheckCircle,
  exception: FileText,
  task: FileText,
  mention: Bell,
  due: CalendarDays,
}

const KIND_LABEL: Record<WorkKind, string> = {
  approval: "Approval",
  exception: "Exception",
  task: "Needs your changes",
  mention: "Mention",
  due: "Deliverable",
}

export default async function InboxPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")
  const userId = session.user.id

  return withTenantScope(userId, async () => {
    const ctx = await getUserContext(userId)
    const { businessCalendar } = await documentLocalization()
    const now = new Date()
    const nowMs = now.getTime()

    const institutionIds = ctx.institutionRoles.map((m) => m.institutionId)
    // SHADOW seats count. An incoming officer previewing before their term
    // starts is exactly who most needs to see what is waiting.
    const liveSeats = ctx.orgRoles.filter((r) => r.status === "SHADOW" || r.status === "ACTIVE")
    const memberOrgIds = liveSeats.map((r) => r.organizationId)
    const mySeatKeys = new Set(liveSeats.flatMap((r) => seatKeysForRole(r.roleName)))

    const pending = [...PENDING_STATES] as (
      | "DRAFT"
      | "PENDING_PRESIDENT"
      | "NEEDS_CHANGES"
      | "PENDING_OSE"
    )[]

    const [approvals, notifications, deliverables] = await Promise.all([
      db.approvalRequest.findMany({
        // The same visibility predicate the approvals list uses. Written out
        // rather than imported because that route belongs to another change in
        // flight; if the two ever disagree, this is the one to correct.
        where: {
          status: { in: pending },
          OR: [
            { institutionId: { in: institutionIds } },
            { organizationId: { in: memberOrgIds } },
            { submittedById: userId },
          ],
        },
        orderBy: { updatedAt: "asc" },
        take: 100,
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          submittedById: true,
          updatedAt: true,
          createdAt: true,
          organization: { select: { name: true } },
        },
      }),
      db.notification.findMany({
        where: { userId, readAt: null },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      institutionIds.length > 0
        ? db.deliverable.findMany({
            // A deliverable that went by three months ago is history, not work.
            // Everything still ahead, plus a fortnight of recently-missed ones,
            // which is the window in which "overdue" is still actionable.
            where: {
              institutionId: { in: institutionIds },
              dueAt: { gte: new Date(nowMs - 14 * 24 * 60 * 60 * 1000) },
            },
            orderBy: { dueAt: "asc" },
            take: 60,
          })
        : Promise.resolve([]),
    ])

    const items: WorkItem[] = [
      ...approvals.map((a): WorkItem => {
        const mine = a.submittedById === userId && a.status === "NEEDS_CHANGES"
        const kind: WorkKind = mine ? "task" : a.type === "EXCEPTION" ? "exception" : "approval"
        return {
          id: `approval:${a.id}`,
          kind,
          title: a.title,
          context: a.organization.name,
          href: `/approvals/${a.id}`,
          dueAtMs: addBusinessDays(a.updatedAt, SLA_OVERDUE_DAYS, businessCalendar).getTime(),
          createdAtMs: a.createdAt.getTime(),
        }
      }),
      ...notifications.map(
        (n): WorkItem => ({
          id: `mention:${n.id}`,
          kind: "mention",
          title: n.title,
          context: n.body ?? "Unread",
          href: n.href ?? "/notifications",
          dueAtMs: null,
          createdAtMs: n.createdAt.getTime(),
        }),
      ),
      // Seat-filtered, not institution-filtered. The marketing VP does not need
      // the treasurer's audit in their inbox, and an inbox that shows everybody
      // everything is the list nobody reads.
      ...deliverables
        .filter((d) => mySeatKeys.has("ALL") || mySeatKeys.has(d.seat as never) || d.seat === "ALL")
        .map(
          (d): WorkItem => ({
            id: `due:${d.id}`,
            kind: "due",
            title: d.title,
            context: d.description ?? "Office of Student Experience",
            href: "/calendar",
            dueAtMs: d.dueAt.getTime(),
            createdAtMs: d.createdAt.getTime(),
          }),
        ),
    ]

    const groups = groupWorkItems(items, nowMs)
    const attention = needsAttentionCount(items, nowMs)

    return (
      <div className="w-full max-w-screen-md">
        <PageHeader
          title="Inbox"
          subtitle="Everything waiting on you — approvals, exceptions, your own requests to revise, mentions and deliverables, in one order."
          status={
            <>
              <Badge variant={attention > 0 ? "warning" : "success"} data-testid="inbox-attention">
                {attention} need{attention === 1 ? "s" : ""} attention
              </Badge>
              <Badge variant="default">{items.length} total</Badge>
            </>
          }
        />

        {items.length === 0 ? (
          <EmptyState
            state="empty"
            icon={ListTodo}
            title="Nothing is waiting on you"
            description="Approvals, exceptions, mentions and deliverables that need you will appear here."
          />
        ) : (
          <div className="space-y-5" data-testid="inbox-groups">
            {groups.map((group) => (
              <section key={group.bucket} aria-labelledby={`inbox-${group.bucket}`}>
                <h2
                  id={`inbox-${group.bucket}`}
                  className="mb-2 text-sm font-semibold text-text-1"
                  data-bucket={group.bucket}
                >
                  {BUCKET_LABELS[group.bucket]}{" "}
                  <span className="font-normal text-text-3">({group.items.length})</span>
                </h2>
                <Card padding="none">
                  <ul className="divide-y divide-border">
                    {group.items.map((item) => {
                      const Icon = KIND_ICON[item.kind]
                      return (
                        <li key={item.id} data-work-kind={item.kind}>
                          <Link
                            href={item.href}
                            className="flex items-start gap-3 px-5 py-3.5 no-underline transition-colors hover:bg-base"
                          >
                            <Icon size={15} className="mt-0.5 shrink-0 text-text-3" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-text-1">
                                {item.title}
                              </p>
                              <p className="mt-0.5 truncate text-meta text-text-3">
                                {KIND_LABEL[item.kind]} · {item.context}
                              </p>
                            </div>
                            {item.dueAtMs !== null && (
                              <span className="shrink-0 text-meta tabular-nums text-text-3">
                                {new Date(item.dueAtMs).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                            )}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </Card>
              </section>
            ))}
          </div>
        )}
      </div>
    )
  })
}
