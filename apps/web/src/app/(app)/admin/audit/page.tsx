import type { Metadata } from "next"
import Link from "next/link"
import type { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { requireAdminContext } from "@/lib/admin/guard"
import { withTenantScope } from "@/lib/tenant-scope"
import { hasCapability } from "@/lib/admin/capabilities"
import { Card } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { EmptyState } from "@/components/ui/EmptyState"
import { StateSurface } from "@/components/ui/StateSurface"
import { DataTable } from "@/components/ui/DataTable"
import { formatSortParam, parseSortParam } from "@/components/ui/data-table-model"
import { ScrollText, Search } from "@/components/ui/icons"

export const metadata: Metadata = { title: "Admin · Audit log" }
export const dynamic = "force-dynamic"

type OutcomeFilter = "" | "allow" | "deny"

/** Compact one-line summary of an audit event's metadata JSON. */
function summarizeMetadata(meta: Prisma.JsonValue): string {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return ""
  const entries = Object.entries(meta as Record<string, unknown>)
  if (entries.length === 0) return ""
  return entries
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? "…" : String(v)}`)
    .join(" · ")
}

/**
 * Audit rows about club content — a memory card, a document — can quote the
 * moderator's own reason in `detail`. That sentence is about a body the reader
 * may not be able to open, so it is redacted from anyone who does not hold the
 * content-override capability. The ROW stays: dropping it would say the object
 * does not exist, which is the enumeration leak the API refusals avoid.
 */
const CONTENT_RESOURCE_TYPES = new Set(["MemoryRecord", "Document", "memory", "document"])

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string; q?: string; sort?: string }>
}) {
  const { userId, ctx, institutionId } = await requireAdminContext()
  // TTES-040-002. See the note in admin/overrides/page.tsx: a capability
  // refusal inside a console the viewer was already admitted to is the
  // `permission-denied` state, not a 404. Nothing about the audit log's
  // CONTENTS is disclosed by saying the seat does not include it.
  if (!hasCapability(ctx, "audit.view", institutionId)) {
    return <StateSurface state="permission-denied" />
  }

  return withTenantScope(userId, async () => {
    const sp = await searchParams
    const outcomeFilter: OutcomeFilter =
      sp.outcome === "deny" ? "deny" : sp.outcome === "allow" ? "allow" : ""
    const q = (sp.q ?? "").trim().slice(0, 80)
    // The grid's order is a URL parameter rather than component state: this
    // page is a server component, and a sort you cannot reload into or send to
    // a colleague is not a sort an audit reader can work with.
    const sort = parseSortParam(sp.sort)

    const where: Prisma.AuditEventWhereInput = {
      institutionId,
      ...(outcomeFilter ? { outcome: outcomeFilter.toUpperCase() } : {}),
      ...(q
        ? {
            OR: [
              { action: { contains: q, mode: "insensitive" } },
              { resourceType: { contains: q, mode: "insensitive" } },
              { reason: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    }

    const [events, totalCount, denyCount] = await Promise.all([
      db.auditEvent.findMany({ where, orderBy: { occurredAt: "desc" }, take: 200 }),
      db.auditEvent.count({ where: { institutionId } }),
      db.auditEvent.count({ where: { institutionId, outcome: "DENY" } }),
    ])

    const actorIds = [...new Set(events.map((e) => e.actorId).filter((x): x is string => !!x))]
    const actorNames = new Map<string, string>()
    if (actorIds.length) {
      for (const u of await db.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, email: true },
      }))
        actorNames.set(u.id, u.name ?? u.email ?? "Unknown")
    }

    const orgIds = [...new Set(events.map((e) => e.organizationId).filter((x): x is string => !!x))]
    const orgNames = new Map<string, string>()
    if (orgIds.length) {
      for (const o of await db.organization.findMany({
        where: { id: { in: orgIds } },
        select: { id: true, name: true },
      }))
        orgNames.set(o.id, o.name)
    }

    const tabHref = (val: OutcomeFilter) => {
      const params = new URLSearchParams()
      if (val) params.set("outcome", val)
      if (q) params.set("q", q)
      const s = params.toString()
      return `/admin/audit${s ? `?${s}` : ""}`
    }
    /** Where a header links to. Cycles asc -> desc -> unsorted, per `nextSort`. */
    const sortHref = (key: string) => {
      const next =
        !sort || sort.key !== key
          ? { key, direction: "asc" as const }
          : sort.direction === "asc"
            ? { key, direction: "desc" as const }
            : null
      const params = new URLSearchParams()
      if (outcomeFilter) params.set("outcome", outcomeFilter)
      if (q) params.set("q", q)
      const formatted = formatSortParam(next)
      if (formatted) params.set("sort", formatted)
      const s = params.toString()
      return `/admin/audit${s ? `?${s}` : ""}`
    }

    const canReadRestricted = hasCapability(ctx, "content.override", institutionId)
    const redactedResourceTypes = CONTENT_RESOURCE_TYPES

    const TABS: { label: string; val: OutcomeFilter }[] = [
      { label: "All", val: "" },
      { label: "Allowed", val: "allow" },
      { label: "Denied", val: "deny" },
    ]

    return (
      <Card padding="none">
        <div className="border-b border-border p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-text-1">Audit log</h2>
              <p className="mt-1 text-sm text-text-2">
                Append-only record of privileged actions — every allow and deny across the institution.
              </p>
            </div>
            <div className="flex items-center gap-4 text-[13px]">
              <span className="text-text-3">
                <span className="font-semibold tabular-nums text-text-1">{totalCount.toLocaleString()}</span> events
              </span>
              <span className="text-text-3">
                <span className="font-semibold tabular-nums text-[--error]">{denyCount.toLocaleString()}</span> denied
              </span>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex rounded-md border border-border p-0.5">
              {TABS.map((t) => {
                const active = t.val === outcomeFilter
                return (
                  <Link
                    key={t.val || "all"}
                    href={tabHref(t.val)}
                    className={`rounded px-3 py-1 text-[13px] font-medium no-underline ${
                      active ? "bg-[--primary] text-[--primary-text]" : "text-text-2 hover:text-text-1"
                    }`}
                  >
                    {t.label}
                  </Link>
                )
              })}
            </div>

            <form method="get" className="flex items-center gap-2">
              {outcomeFilter && <input type="hidden" name="outcome" value={outcomeFilter} />}
              <div className="flex h-8 items-center gap-2 rounded-md border border-border px-2.5">
                <Search size={14} className="text-text-3" />
                <input
                  name="q"
                  defaultValue={q}
                  placeholder="Filter by action, resource, reason…"
                  className="w-56 bg-transparent text-[13px] text-text-1 outline-none placeholder:text-text-3"
                />
              </div>
              <button className="h-8 rounded-md border border-border px-3 text-[13px] font-medium text-text-2 hover:bg-base">
                Search
              </button>
              {(q || outcomeFilter) && (
                <Link href="/admin/audit" className="text-[13px] text-text-link no-underline hover:underline">
                  Clear
                </Link>
              )}
            </form>
          </div>
        </div>

        {events.length === 0 ? (
          <EmptyState
            // Two different sentences, so two different states: a filtered log
            // that matched nothing is not an empty log, and telling an
            // administrator "no audit events yet" while an outcome chip is
            // still applied sends them looking for a logging failure.
            state={q || outcomeFilter ? "no-results" : "empty"}
            icon={ScrollText}
            title={q || outcomeFilter ? "No matching events" : "No audit events yet"}
            description={
              q || outcomeFilter
                ? "Try a broader filter — or clear it to see everything."
                : "Administrative actions will appear here as they happen."
            }
          />
        ) : (
          /* TTES-020-002-GRID. The densest surface in the product, through the
             owned contract: a caption, `scope="col"` on every header, a real
             `aria-sort`, and a redaction rule for a cell the viewer may not
             read. It was six bare <th> and nothing else. */
          <DataTable
            caption={`Audit log — ${events.length} of ${totalCount.toLocaleString()} events${
              outcomeFilter ? `, ${outcomeFilter} only` : ""
            }${q ? `, matching “${q}”` : ""}`}
            rows={events}
            rowKey={(e) => e.id}
            sort={sort}
            sortHref={sortHref}
            tableClassName="min-w-[820px] tabular-nums"
            columns={[
              {
                key: "when",
                header: "When",
                sortValue: (e) => e.occurredAt,
                className: "whitespace-nowrap text-[13px] text-text-3",
                cell: (e) =>
                  e.occurredAt.toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }),
              },
              {
                key: "actor",
                header: "Actor",
                sortValue: (e) => (e.actorId ? actorNames.get(e.actorId) ?? "Unknown" : "System"),
                className: "text-text-1",
                cell: (e) => (
                  <>
                    {e.actorId ? actorNames.get(e.actorId) ?? "Unknown" : "System"}
                    {e.actorRole && (
                      <span className="ml-1 text-[13px] text-text-3">
                        ({e.actorRole.replace("OSE_", "")})
                      </span>
                    )}
                  </>
                ),
              },
              {
                key: "action",
                header: "Action",
                sortValue: (e) => e.action,
                className: "font-medium text-text-1",
                cell: (e) => e.action,
              },
              {
                key: "resource",
                header: "Resource",
                sortValue: (e) => e.resourceType,
                className: "text-[13px] text-text-2",
                cell: (e) => (
                  <>
                    {e.organizationId
                      ? orgNames.get(e.organizationId) ?? e.resourceType
                      : e.resourceType}
                    {e.resourceId && (
                      <span className="ml-1 text-text-3">#{e.resourceId.slice(-6)}</span>
                    )}
                  </>
                ),
              },
              {
                key: "detail",
                header: "Detail",
                // The one column that can carry a reason written about a row
                // the reader may not open. Redacted rather than dropped: an
                // absent row would say the object does not exist.
                redactable: true,
                className: "max-w-[280px] text-[13px] text-text-3",
                cell: (e) => (
                  <span className="line-clamp-2">
                    {e.reason || summarizeMetadata(e.metadata) || "—"}
                  </span>
                ),
              },
              {
                key: "outcome",
                header: "Outcome",
                sortValue: (e) => e.outcome,
                cell: (e) => (
                  <Badge variant={e.outcome === "DENY" ? "error" : "success"}>
                    {e.outcome.toLowerCase()}
                  </Badge>
                ),
              },
            ]}
            redact={(e) => redactedResourceTypes.has(e.resourceType) && !canReadRestricted}
          />
        )}
      </Card>
    )
  })
}
