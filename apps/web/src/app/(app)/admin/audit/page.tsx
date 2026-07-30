import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import type { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { requireAdminContext } from "@/lib/admin/guard"
import { hasCapability } from "@/lib/admin/capabilities"
import { Card } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { EmptyState } from "@/components/ui/EmptyState"
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

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string; q?: string }>
}) {
  const { ctx, institutionId } = await requireAdminContext()
  if (!hasCapability(ctx, "audit.view", institutionId)) notFound()

  const sp = await searchParams
  const outcomeFilter: OutcomeFilter =
    sp.outcome === "deny" ? "deny" : sp.outcome === "allow" ? "allow" : ""
  const q = (sp.q ?? "").trim().slice(0, 80)

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
          icon={ScrollText}
          title={q || outcomeFilter ? "No matching events" : "No audit events yet"}
          description={
            q || outcomeFilter
              ? "Try a broader filter — or clear it to see everything."
              : "Administrative actions will appear here as they happen."
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm tabular-nums">
            <thead>
              <tr className="border-b border-border text-left text-[13px] text-text-3">
                <th className="px-5 py-2.5 font-medium">When</th>
                <th className="px-5 py-2.5 font-medium">Actor</th>
                <th className="px-5 py-2.5 font-medium">Action</th>
                <th className="px-5 py-2.5 font-medium">Resource</th>
                <th className="px-5 py-2.5 font-medium">Detail</th>
                <th className="px-5 py-2.5 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const detail = e.reason || summarizeMetadata(e.metadata)
                return (
                  <tr key={e.id} className="border-b border-border last:border-0 align-top">
                    <td className="whitespace-nowrap px-5 py-2.5 text-[13px] text-text-3">
                      {e.occurredAt.toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-5 py-2.5 text-text-1">
                      {e.actorId ? actorNames.get(e.actorId) ?? "Unknown" : "System"}
                      {e.actorRole && (
                        <span className="ml-1 text-[13px] text-text-3">({e.actorRole.replace("OSE_", "")})</span>
                      )}
                    </td>
                    <td className="px-5 py-2.5 font-medium text-text-1">{e.action}</td>
                    <td className="px-5 py-2.5 text-[13px] text-text-2">
                      {e.organizationId ? orgNames.get(e.organizationId) ?? e.resourceType : e.resourceType}
                      {e.resourceId && (
                        <span className="ml-1 text-text-3">#{e.resourceId.slice(-6)}</span>
                      )}
                    </td>
                    <td className="max-w-[280px] px-5 py-2.5 text-[13px] text-text-3">
                      <span className="line-clamp-2">{detail || "—"}</span>
                    </td>
                    <td className="px-5 py-2.5">
                      <Badge variant={e.outcome === "DENY" ? "error" : "success"}>
                        {e.outcome.toLowerCase()}
                      </Badge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
