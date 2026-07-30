import Link from "next/link"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import type { EventStatus } from "@prisma/client"
import { CheckCircle, X, Archive, ArchiveRestore, CalendarDays, BookOpen, FileText } from "@/components/ui/icons"
import { db } from "@/lib/db"
import { requireAdminContext } from "@/lib/admin/guard"
import { institutionTimeZone } from "@/lib/institution-time"
import { formatInZone } from "@/lib/time"
import { hasCapability } from "@/lib/admin/capabilities"
import { Card, CardHeader } from "@/components/ui/Card"
import { EventBadge, Badge } from "@/components/ui/Badge"
import { EmptyState } from "@/components/ui/EmptyState"
import { ConfirmSubmit } from "@/components/ui/ConfirmDialog"
import {
  adminSetEventStatus,
  adminSetMemoryArchived,
  adminSetDocumentArchived,
} from "../actions"

export const metadata: Metadata = { title: "Admin · Overrides" }
export const dynamic = "force-dynamic"

export default async function AdminOverridesPage() {
  const { ctx, institutionId } = await requireAdminContext()
  // Pinning to UTC here dated evening events a day ahead of the calendar an
  // admin cross-checks them against. src/lib/time.ts is the one authority.
  const tz = await institutionTimeZone(institutionId)
  const canEvent = hasCapability(ctx, "event.override", institutionId)
  const canContent = hasCapability(ctx, "content.override", institutionId)
  if (!canEvent && !canContent) notFound()

  const [events, memory, documents] = await Promise.all([
    canEvent
      ? db.event.findMany({
          where: { institutionId, status: { not: "CANCELLED" } },
          orderBy: { startAt: "desc" },
          take: 20,
          include: { organization: { select: { name: true } } },
        })
      : [],
    canContent
      ? db.memoryRecord.findMany({
          where: { institutionId },
          orderBy: { updatedAt: "desc" },
          take: 15,
          include: { organization: { select: { name: true } } },
        })
      : [],
    canContent
      ? db.document.findMany({
          where: { institutionId },
          orderBy: { updatedAt: "desc" },
          take: 15,
          include: { organization: { select: { name: true } } },
        })
      : [],
  ])

  return (
    <div className="w-full space-y-6">
      <p className="text-sm text-text-2">
        Institution-wide overrides. Every action here bypasses the normal workflow and is
        recorded in the audit log.
      </p>

      {canEvent && (
        <Card padding="none">
          <div className="flex items-center gap-2 border-b border-border p-5">
            <CalendarDays size={18} className="text-text-3" />
            <CardHeader title="Events" subtitle="Publish or cancel any club event." />
          </div>
          {events.length === 0 ? (
            <EmptyState icon={CalendarDays} title="No events" description="Club events appear here." />
          ) : (
            <ul className="divide-y divide-border">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/calendar/${e.id}`} className="truncate font-medium text-text-1 no-underline hover:text-[--accent]">
                      {e.title}
                    </Link>
                    <p className="text-[13px] text-text-3">
                      {e.organization.name} ·{" "}
                      {formatInZone(e.startAt, tz, { month: "short", day: "numeric" })}
                    </p>
                  </div>
                  <EventBadge status={e.status as EventStatus} />
                  {e.status !== "PUBLISHED" && (
                    <form action={adminSetEventStatus}>
                      <input type="hidden" name="eventId" value={e.id} />
                      <input type="hidden" name="status" value="PUBLISHED" />
                      <button className="inline-flex items-center gap-1.5 rounded-md bg-[--primary] px-3 py-1.5 text-[13px] font-medium text-[--primary-text] hover:bg-[--primary-hover]">
                        <CheckCircle size={14} /> Publish
                      </button>
                    </form>
                  )}
                  <ConfirmSubmit
                    action={adminSetEventStatus}
                    hiddenFields={{ eventId: e.id, status: "CANCELLED" }}
                    title={`Cancel “${e.title}”?`}
                    description={`Cancelling pulls ${e.organization.name}'s event off calendars across the institution. Because cancelled events drop off this override list, you won't be able to re-publish it from here.`}
                    confirmLabel="Cancel event"
                    variant="danger"
                    triggerClassName="inline-flex items-center gap-1.5 rounded-md border border-border-strong px-3 py-1.5 text-[13px] font-medium text-[--error] hover:bg-[--error-light]"
                  >
                    <X size={14} /> Cancel
                  </ConfirmSubmit>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {canContent && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ContentCard
            title="Memory records"
            noun="memory record"
            icon={BookOpen}
            items={memory.map((m) => ({ id: m.id, title: m.title, org: m.organization.name, archived: m.isArchived }))}
            action={adminSetMemoryArchived}
            idField="memoryId"
          />
          <ContentCard
            title="Documents"
            noun="document"
            icon={FileText}
            items={documents.map((d) => ({ id: d.id, title: d.title, org: d.organization.name, archived: d.isArchived }))}
            action={adminSetDocumentArchived}
            idField="documentId"
          />
        </div>
      )}
    </div>
  )
}

function ContentCard({
  title,
  noun,
  icon: Icon,
  items,
  action,
  idField,
}: {
  title: string
  noun: string
  icon: typeof BookOpen
  items: { id: string; title: string; org: string; archived: boolean }[]
  action: (formData: FormData) => Promise<void>
  idField: string
}) {
  return (
    <Card padding="none">
      <div className="flex items-center gap-2 border-b border-border p-5">
        <Icon size={18} className="text-text-3" />
        <CardHeader title={title} subtitle="Archive or restore across the institution." />
      </div>
      {items.length === 0 ? (
        <EmptyState icon={Icon} title={`No ${title.toLowerCase()}`} />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-1">{it.title}</p>
                <p className="text-[13px] text-text-3">{it.org}</p>
              </div>
              {it.archived && <Badge variant="default">archived</Badge>}
              {it.archived ? (
                <form action={action}>
                  <input type="hidden" name={idField} value={it.id} />
                  <input type="hidden" name="archived" value="false" />
                  <button className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-text-3 transition-colors hover:bg-base hover:text-text-1">
                    <ArchiveRestore size={14} /> Restore
                  </button>
                </form>
              ) : (
                <ConfirmSubmit
                  action={action}
                  hiddenFields={{ [idField]: it.id, archived: "true" }}
                  title={`Archive this ${noun}?`}
                  description={`“${it.title}” (${it.org}) is hidden from members across the institution. It's fully reversible — restore it from this same list whenever you need to.`}
                  confirmLabel={`Archive ${noun}`}
                  variant="danger"
                  triggerClassName="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-text-3 transition-colors hover:bg-base hover:text-text-1"
                >
                  <Archive size={14} /> Archive
                </ConfirmSubmit>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
