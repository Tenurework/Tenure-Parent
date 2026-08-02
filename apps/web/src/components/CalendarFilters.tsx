"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"

/**
 * Per-viewer calendar filters: narrow to one of your clubs, and/or show only
 * events you proposed. Filters ride URL params so they survive view/day
 * navigation and are shareable.
 */
export function CalendarFilters({ clubs }: { clubs: { id: string; name: string }[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const club = sp.get("club") ?? ""
  const mine = sp.get("mine") === "1"

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(sp.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    const qs = next.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    // min-w-0: this row is itself a flex item in PageHeader's action row, and
    // a flex item defaults to min-width:auto. Without it the row is sized by
    // the longest club name, `max-w-full` on the select below resolves against
    // that already-too-wide row, and nothing shrinks (WCAG 1.4.10).
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <select
        value={club}
        onChange={(e) => setParam("club", e.target.value)}
        aria-label="Filter calendar by club"
        className="h-9 min-w-0 max-w-full rounded-md border border-border bg-surface px-2 text-[13px] text-text-1"
      >
        <option value="">All my calendars</option>
        {clubs.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => setParam("mine", mine ? "" : "1")}
        aria-pressed={mine}
        className={`h-9 rounded-md border px-3 text-[13px] font-medium transition-colors ${
          mine
            ? "border-[--primary] bg-[--primary-light] text-[--primary]"
            : "border-border text-text-2 hover:bg-surface hover:text-text-1"
        }`}
      >
        My events
      </button>
    </div>
  )
}
