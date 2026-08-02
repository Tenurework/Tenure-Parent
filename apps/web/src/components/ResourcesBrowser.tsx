"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  Search,
  ExternalLink,
  AlertCircle,
  BookOpen,
  PenSquare,
  ScrollText,
  SlidersHorizontal,
  ListTodo,
  ArrowRight,
  Plus,
  Archive,
  ArchiveRestore,
  type IconType,
} from "@/components/ui/icons"
import { Badge } from "@/components/ui/Badge"
import { EmptyState } from "@/components/ui/EmptyState"
import { Segmented } from "@/components/ui/Segmented"
import { ResourceEditor } from "@/components/resources/ResourceEditor"
import { retireResource } from "@/app/(app)/resources/actions"
import {
  KIND_LABELS,
  RESOURCE_KINDS,
  SEAT_LABELS,
  type Resource,
  type ResourceKind,
  type SeatKey,
} from "@/lib/resources"

const KIND_ICON: Record<ResourceKind, IconType> = {
  FORM: PenSquare,
  GUIDE: BookOpen,
  POLICY: ScrollText,
  TOOL: SlidersHorizontal,
  CHECKLIST: ListTodo,
}

const SEAT_ORDER: SeatKey[] = [
  "ALL",
  "PRESIDENT",
  "VP_FINANCE",
  "VP_EVENTS",
  "VP_MARKETING",
  "MBA_REP",
  "OSE",
]

function ResourceCard({
  resource,
  mine,
  canManage,
  onEdit,
  archived = false,
}: {
  resource: Resource
  mine: boolean
  canManage: boolean
  onEdit: (r: Resource) => void
  archived?: boolean
}) {
  const Icon = KIND_ICON[resource.kind]

  const body = (
    <>
      <div className="flex items-start gap-3">
        {/* Outline-only glyph in a hairline frame — see ICONOGRAPHY in
            globals.css. The old card set a --primary-light plate behind it. */}
        <span className="icon-frame h-9 w-9 rounded-md" style={{ color: "var(--primary)" }}>
          <Icon size={18} weight="regular" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-display text-[15px] font-semibold leading-snug text-text-1">
              {resource.title}
            </h3>
            {!archived &&
              (resource.external ? (
                <ExternalLink size={15} className="mt-0.5 shrink-0 text-text-3" aria-hidden />
              ) : (
                <ArrowRight size={15} className="mt-0.5 shrink-0 text-text-3" aria-hidden />
              ))}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-text-2">{resource.description}</p>
        </div>
      </div>

      {resource.rule && (
        <p className="mt-3 flex items-start gap-1.5 rounded-md border border-border px-2.5 py-2 text-[12px] leading-relaxed text-text-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-[--warning]" aria-hidden />
          {resource.rule}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge variant="default">{KIND_LABELS[resource.kind]}</Badge>
        {mine && <Badge variant="success">Your seat</Badge>}
        {!resource.ready && <Badge variant="info">Being built</Badge>}
        {archived && <Badge variant="draft">Retired</Badge>}
      </div>
    </>
  )

  const shell = "tile-float flex h-full flex-col rounded-[10px] border border-border bg-surface p-4"
  // Stable hook for tests and for scoping the manage controls to one card.
  const cardProps = { "data-resource-card": resource.key }

  // The management row sits outside the link so an Edit click never navigates.
  const manageRow = canManage && (
    <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-2.5">
      {!archived && (
        <button
          type="button"
          onClick={() => onEdit(resource)}
          className="rounded-md px-2 py-1 text-[12px] font-semibold text-text-2 transition-colors hover:bg-base hover:text-text-1"
        >
          Edit
        </button>
      )}
      <form action={retireResource}>
        <input type="hidden" name="id" value={resource.id} />
        <input type="hidden" name="archived" value={archived ? "0" : "1"} />
        <button
          type="submit"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold text-text-2 transition-colors hover:bg-base hover:text-text-1"
        >
          {archived ? (
            <>
              <ArchiveRestore size={13} aria-hidden /> Restore
            </>
          ) : (
            <>
              <Archive size={13} aria-hidden /> Retire
            </>
          )}
        </button>
      </form>
    </div>
  )

  if (archived || !resource.ready) {
    return (
      <div className={shell} {...cardProps}>
        <div className={resource.ready ? "" : "opacity-70"}>{body}</div>
        {manageRow}
      </div>
    )
  }

  const linkClass = "block no-underline outline-none focus-visible:ring-2 focus-visible:ring-[--primary] rounded-[10px]"
  const inner = resource.external ? (
    <a href={resource.href} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {body}
    </a>
  ) : resource.href.startsWith("/api/") ? (
    // File downloads (API routes) need a plain anchor: the client router would
    // try to soft-navigate to the route instead of saving the attachment.
    <a href={resource.href} download className={linkClass}>
      {body}
    </a>
  ) : (
    <Link href={resource.href} className={linkClass}>
      {body}
    </Link>
  )

  return (
    <div className={shell} {...cardProps}>
      <div className="flex-1">{inner}</div>
      {manageRow}
    </div>
  )
}

/**
 * The board-resource library: searchable by name, filterable by type, grouped
 * by seat with the viewer's own sections pinned to the top.
 *
 * OSE (Director or Staff) gets the authoring surface — publish, edit, retire,
 * restore — inline on the same board everyone else reads. That is the gap this
 * closes: the resource board had no Add control for anyone, including the
 * Director who owns the programme, because the content was a hardcoded array.
 */
export function ResourcesBrowser({
  resources,
  archived,
  mySeats,
  isOse,
  canManage,
}: {
  resources: Resource[]
  archived: Resource[]
  mySeats: SeatKey[]
  isOse: boolean
  canManage: boolean
}) {
  const mine = useMemo(() => new Set(mySeats), [mySeats])
  const [query, setQuery] = useState("")
  const [kind, setKind] = useState<ResourceKind | null>(null)
  const [mineOnly, setMineOnly] = useState(false)
  const [tab, setTab] = useState<"live" | "retired">("live")
  const [editing, setEditing] = useState<Resource | null>(null)
  const [creating, setCreating] = useState(false)

  const q = query.trim().toLowerCase()
  const matches = (r: Resource) =>
    (!kind || r.kind === kind) &&
    (!q || r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q))

  const groups = useMemo(() => {
    return SEAT_ORDER.map((seat) => ({
      seat,
      resources: resources.filter((r) => r.seats.includes(seat) && matches(r)),
      mine: mine.has(seat),
    }))
      .filter((g) => g.resources.length > 0)
      .filter((g) => isOse || g.mine || g.seat !== "OSE")
      .filter((g) => !mineOnly || g.mine)
      .sort((a, b) => Number(b.mine) - Number(a.mine))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, kind, mineOnly, mine, isOse, resources])

  const retired = useMemo(() => archived.filter(matches), [archived, q, kind])
  const total = groups.reduce((n, g) => n + g.resources.length, 0)
  // The Retired tab only exists while something is retired. Restoring the last
  // one used to leave the tab selected but its toggle unrendered, stranding OSE
  // on an empty panel with no control to get back to the board.
  const activeTab = archived.length > 0 ? tab : "live"
  const showing = activeTab === "live" ? total : retired.length

  return (
    <div>
      {/* Search + filters + authoring */}
      <div className="mb-6 space-y-3">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="flex h-10 flex-1 items-center gap-2 rounded-md border border-border bg-surface px-3 transition-colors focus-within:border-[--border-focus]">
            <Search size={17} className="shrink-0 text-text-3" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search forms, guides and policies…"
              aria-label="Search resources"
              className="h-6 flex-1 bg-transparent text-sm text-text-1 outline-none placeholder:text-text-3"
            />
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md bg-[--primary] px-4 text-sm font-medium text-[--primary-text] transition-colors hover:bg-[--primary-hover]"
            >
              <Plus size={16} aria-hidden /> Add resource
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterChip active={kind === null} onClick={() => setKind(null)}>
            All types
          </FilterChip>
          {RESOURCE_KINDS.map((k) => (
            <FilterChip key={k} active={kind === k} onClick={() => setKind(kind === k ? null : k)}>
              {KIND_LABELS[k]}
            </FilterChip>
          ))}
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
          <FilterChip active={mineOnly} onClick={() => setMineOnly((v) => !v)}>
            My seats only
          </FilterChip>

          {canManage && archived.length > 0 && (
            <div className="ml-auto">
              <Segmented
                aria-label="Resource status"
                value={activeTab}
                onChange={(v) => setTab(v as "live" | "retired")}
                items={[
                  { key: "live", label: "Live" },
                  { key: "retired", label: `Retired · ${archived.length}` },
                ]}
              />
            </div>
          )}
        </div>
      </div>

      {showing === 0 ? (
        <EmptyState
          icon={Search}
          title={activeTab === "retired" ? "Nothing retired" : "No matching resources"}
          description={
            activeTab === "retired"
              ? "Resources you retire are kept here and can be restored."
              : canManage
                ? "Try a different search, or publish the resource your officers keep asking for."
                : "Try a different search or clear the filters."
          }
        />
      ) : activeTab === "retired" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {retired.map((r) => (
            <ResourceCard
              key={r.id}
              resource={r}
              mine={false}
              canManage={canManage}
              onEdit={setEditing}
              archived
            />
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map(({ seat, resources: group, mine: isMine }) => (
            <section key={seat} aria-labelledby={`seat-${seat}`}>
              <div className="mb-3 flex items-center gap-2">
                <h2
                  id={`seat-${seat}`}
                  className="text-meta font-semibold uppercase tracking-wide text-text-3"
                >
                  {SEAT_LABELS[seat]}
                </h2>
                {isMine && seat !== "ALL" && <Badge variant="success">Your seat</Badge>}
                <span className="text-[13px] text-text-3">· {group.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {group.map((r) => (
                  <ResourceCard
                    key={`${seat}-${r.id}`}
                    resource={r}
                    mine={isMine && seat !== "ALL"}
                    canManage={canManage}
                    onEdit={setEditing}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {canManage && (
        <>
          {/* Remount per opening so useActionState starts clean, exactly as the
              edit dialog already does via its id key. */}
          <ResourceEditor
            key={creating ? "new-open" : "new-closed"}
            isOpen={creating}
            onClose={() => setCreating(false)}
          />
          <ResourceEditor
            key={editing?.id ?? "none"}
            resource={editing ?? undefined}
            isOpen={editing !== null}
            onClose={() => setEditing(null)}
          />
        </>
      )}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${
        active
          ? "border-[--primary] bg-[--primary] text-[--primary-text]"
          : "border-border text-text-2 hover:border-[--border-strong] hover:text-text-1"
      }`}
    >
      {children}
    </button>
  )
}
