"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Search,
  BookOpen,
  FileText,
  CheckCircle,
  CalendarDays,
  Building2,
  ArrowRight,
  type IconType,
} from "@/components/ui/icons"
import { stateCaveat } from "@/lib/relay/citation-display"
import type { NavSectionView } from "./SideNav"

interface Result {
  id: string
  kind: "memory" | "document" | "approval" | "event" | "organization"
  title: string
  href: string
  context: string
  snippet: string
  /**
   * WRK-070-003 / §3.5. The operational verdict `/api/search` returns with every
   * result — LIVE or STALE here, since `rankDocs` scores nothing else.
   *
   * Required, and it is what makes the palette stop asserting a currency nobody
   * checked: the route has emitted this since the lifecycle landed and this
   * interface listed five display strings, so a club record nobody had touched
   * in two years and one saved this morning rendered as the same two lines.
   */
  state: string
}

const KIND_ICON: Record<Result["kind"], IconType> = {
  memory: BookOpen,
  document: FileText,
  approval: CheckCircle,
  event: CalendarDays,
  organization: Building2,
}

/**
 * What an object row renders, from either of its two sources.
 *
 * `state` is `string | null` and the null is load-bearing: a live result from
 * `/api/search` carries a freshness verdict, and a row replayed out of
 * sessionStorage carries a title and a link and nothing else. Stamping the
 * recents with `"LIVE"` so the types lined up would be inventing a verdict
 * nothing checked — the precise thing §3.5 forbids — so the absence is modelled
 * instead, and `stateCaveat` is simply not called for it.
 */
interface PaletteObject {
  id: string
  kind: Result["kind"]
  title: string
  href: string
  context: string
  snippet: string
  state: string | null
}

/** A row in the palette — an action from the nav, or an object from /api/search. */
type Row =
  | { rowKind: "action"; key: string; label: string; href: string; group: string }
  | { rowKind: "object"; key: string; object: PaletteObject }

/** Where recently-opened objects are remembered. Titles and hrefs only. */
const RECENTS_KEY = "tenure.command.recents"
const MAX_RECENTS = 5

interface Recent {
  title: string
  href: string
  kind: Result["kind"]
  context: string
}

function readRecents(): Recent[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.sessionStorage.getItem(RECENTS_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (r): r is Recent =>
          !!r &&
          typeof r === "object" &&
          typeof (r as Recent).title === "string" &&
          typeof (r as Recent).href === "string",
      )
      .slice(0, MAX_RECENTS)
  } catch {
    return []
  }
}

/**
 * TTES-030-001 — the global command palette.
 *
 * Three things it did not have, all named by Bible §5.1:
 *
 *   * **A keyboard route to it.** The only key handler in the whole shell was
 *     an `onKeyDown` on this input, so the palette could not be reached from
 *     the keyboard from any route. The operator console has had ⌘/Ctrl-K since
 *     GE-022-007; the tenant product, whose specification names it, did not.
 *   * **Permission-aware actions.** The palette returned objects only. The
 *     actions here come from `sections` — the SAME capability-filtered
 *     navigation the layout resolves with
 *     `navigationForSystem(slug, capabilities)` and hands to `SideNav`. That is
 *     what makes "permission-aware" structural rather than a promise: an action
 *     a user's capabilities do not grant is not in `sections`, so there is
 *     nothing here to filter out and nothing to forget to filter.
 *   * **Combobox semantics.** The results were a plain `<div>/<ul>/<li>` and
 *     the `active` index moved a background colour. A screen-reader user
 *     arrowing through them was told nothing at all. `role="combobox"` +
 *     `aria-activedescendant` is what makes the arrow keys audible.
 *
 * Recents live in `sessionStorage` and hold a title, an href, a kind and a
 * context — no tokens, nothing beyond what is already in the URL, and gone
 * when the tab closes.
 */
export function SearchCommand({
  sections,
}: {
  /**
   * The navigation this principal actually holds, from the layout. REQUIRED —
   * an optional prop here would let the one construction site ship an
   * action-less palette without `tsc` saying a word.
   */
  sections: readonly NavSectionView[]
}) {
  const router = useRouter()
  const [q, setQ] = useState("")
  const [results, setResults] = useState<Result[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [recents, setRecents] = useState<Recent[]>([])
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setRecents(readRecents())
  }, [])

  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) {
      setResults([])
      return
    }
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { cache: "no-store" })
        const data = (await res.json()) as { results: Result[] }
        setResults(data.results ?? [])
        setActive(-1)
      } catch {
        setResults([])
      }
    }, 160)
    return () => clearTimeout(handle)
  }, [q])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  /**
   * ⌘K / Ctrl-K from anywhere. On `document`, not on the input — the whole
   * point is that it works when the input does not have focus.
   *
   * `preventDefault` because Ctrl-K is the browser's own "focus the search bar"
   * on some builds and Firefox's web-search shortcut; without it the palette
   * opens and the browser takes focus back a frame later.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen(true)
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  const rememberRecent = (r: Recent) => {
    const next = [r, ...readRecents().filter((x) => x.href !== r.href)].slice(0, MAX_RECENTS)
    setRecents(next)
    try {
      window.sessionStorage.setItem(RECENTS_KEY, JSON.stringify(next))
    } catch {
      // A browser refusing session storage is not a reason to break navigation.
    }
  }

  const go = (href: string) => {
    setOpen(false)
    setQ("")
    router.push(href)
  }

  const submitSearch = () => {
    const value = q.trim()
    if (!value) return
    setOpen(false)
    router.push(`/search?q=${encodeURIComponent(value)}`)
  }

  const query = q.trim()

  /** Actions the viewer genuinely holds, matched against what they typed. */
  const actions = useMemo(() => {
    const all = sections.flatMap((section) =>
      section.items
        // An entry that runs a UI behaviour rather than navigating has no href
        // worth pushing. It is offered by the side nav, not here.
        .filter((item) => !item.action && item.href)
        .map((item) => ({
          rowKind: "action" as const,
          key: `action-${item.id}`,
          label: item.label,
          href: item.href,
          group: section.label,
        })),
    )
    if (query.length < 2) return all.slice(0, 5)
    const needle = query.toLowerCase()
    return all
      .filter((a) => a.label.toLowerCase().includes(needle) || a.group.toLowerCase().includes(needle))
      .slice(0, 5)
  }, [sections, query])

  const objects = useMemo(() => results.slice(0, 8), [results])

  /**
   * One flat list, because `aria-activedescendant` addresses one option at a
   * time and the arrow keys have to walk actions and objects as a single run.
   */
  const rows: Row[] = useMemo(() => {
    const objectRows: Row[] = objects.map((r) => ({
      rowKind: "object",
      key: `object-${r.kind}-${r.id}`,
      object: { ...r, state: r.state },
    }))
    if (query.length >= 2) return [...actions, ...objectRows]
    // Nothing typed yet: the actions, then what this person opened recently.
    const recentRows: Row[] = recents.map((r, i) => ({
      rowKind: "object",
      key: `recent-${i}`,
      object: {
        id: `recent-${i}`,
        kind: r.kind,
        title: r.title,
        href: r.href,
        context: r.context,
        snippet: "",
        // sessionStorage holds a title and a link. It has never held a
        // freshness verdict, and this is where saying so costs nothing.
        state: null,
      },
    }))
    return [...actions, ...recentRows]
  }, [actions, objects, recents, query])

  const showDropdown = open && rows.length > 0

  const openRow = (row: Row) => {
    if (row.rowKind === "action") return go(row.href)
    const r = row.object
    rememberRecent({ title: r.title, href: r.href, kind: r.kind, context: r.context })
    go(r.href)
  }

  const optionId = (i: number) => `shell-search-opt-${i}`

  /**
   * Focus leaving the palette closes it — WCAG 2.4.11 Focus Not Obscured.
   *
   * The dropdown is `position: absolute` under a `position: fixed` header, so
   * it hangs over the page. Opening it on focus and only closing it on Escape
   * or an outside *mousedown* meant a keyboard user who tabbed past the input
   * carried an open panel with them: the next several tab stops were covered by
   * an option row they had no way to dismiss. `e2e/a11y.spec.ts`'s 2.4.11 probe
   * caught exactly that, naming the option row's own class as the coverer.
   *
   * `relatedTarget` inside the box keeps it open — the option rows are
   * `tabIndex={-1}` but a pointer still focuses them, so closing on any blur
   * would tear the panel down before the row's own click handler ran.
   */
  const onFocusLeave = (e: React.FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null
    if (next && boxRef.current?.contains(next)) return
    setOpen(false)
  }

  return (
    <>
      <div
        ref={boxRef}
        onBlur={onFocusLeave}
        className="relative hidden sm:block w-64 lg:w-80"
      >
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            if (active >= 0 && rows[active]) openRow(rows[active])
            else submitSearch()
          }}
        >
          <div
            className="flex h-9 items-center gap-2 rounded-full px-3.5 text-sm transition-colors focus-within:ring-2 focus-within:ring-[--border-focus]"
            style={{
              background: "transparent",
              border: "1px solid var(--shell-border)",
              color: "var(--shell-text-secondary)",
            }}
          >
            <Search size={16} className="shrink-0" />
            <input
              ref={inputRef}
              name="q"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault()
                  setActive((a) => Math.min(a + 1, rows.length - 1))
                } else if (e.key === "ArrowUp") {
                  e.preventDefault()
                  setActive((a) => Math.max(a - 1, -1))
                } else if (e.key === "Escape") {
                  setOpen(false)
                }
              }}
              placeholder="Search Tenure…"
              aria-label="Search Tenure"
              autoComplete="off"
              // The combobox contract. Without `aria-activedescendant` the
              // arrow keys move a background colour and nothing else: a screen
              // reader keeps announcing the textbox and never the row.
              role="combobox"
              aria-expanded={showDropdown}
              aria-controls="shell-search-listbox"
              aria-autocomplete="list"
              aria-activedescendant={active >= 0 && rows[active] ? optionId(active) : undefined}
              // h-6 so the input's own box clears 24px (WCAG 2.5.8). The
              // surrounding pill is already taller, but the target a pointer
              // has to hit is this element, and it was 20px.
              className="h-6 flex-1 bg-transparent text-sm text-[--shell-text] outline-none placeholder:text-[--shell-text-secondary]"
            />
          </div>
        </form>

        {showDropdown && (
          <div className="pop-panel absolute left-0 right-0 top-full z-chrome-popover mt-2 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
            <ul
              id="shell-search-listbox"
              role="listbox"
              aria-label="Commands and results"
              className="max-h-[70vh] overflow-y-auto py-1"
            >
              {rows.map((row, i) => {
                const selected = i === active
                if (row.rowKind === "action") {
                  return (
                    <li key={row.key} id={optionId(i)} role="option" aria-selected={selected}>
                      <button
                        type="button"
                        onClick={() => openRow(row)}
                        onMouseEnter={() => setActive(i)}
                        tabIndex={-1}
                        className={`flex w-full items-start gap-3 px-4 py-2.5 text-left ${
                          selected ? "bg-base" : ""
                        }`}
                      >
                        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-base text-text-3">
                          <ArrowRight size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-text-1">
                            Go to {row.label}
                          </span>
                          <span className="block truncate text-[13px] text-text-3">{row.group}</span>
                        </span>
                      </button>
                    </li>
                  )
                }
                const r = row.object
                const Icon = KIND_ICON[r.kind] ?? FileText
                // §3.5. Null for a remembered row, and null for LIVE — a
                // caveat on every line is a caveat nobody reads, and the
                // absence of a warning is what "current" already says.
                const caveat = r.state === null ? null : stateCaveat(r.state)
                return (
                  <li key={row.key} id={optionId(i)} role="option" aria-selected={selected}>
                    <Link
                      href={r.href}
                      onClick={() => openRow(row)}
                      onMouseEnter={() => setActive(i)}
                      tabIndex={-1}
                      className={`flex items-start gap-3 px-4 py-2.5 no-underline ${
                        selected ? "bg-base" : ""
                      }`}
                    >
                      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-base text-text-3">
                        <Icon size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-text-1">{r.title}</span>
                        <span className="block truncate text-[13px] text-text-3">
                          <span className="capitalize">{r.kind}</span>
                          {r.context ? ` · ${r.context}` : ""}
                          {caveat ? ` · ${caveat}` : ""}
                        </span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
            {query.length >= 2 && (
              <div className="border-t border-border">
                <button
                  onClick={submitSearch}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] font-medium text-text-link hover:bg-base"
                >
                  <Search size={14} /> See all results for “{query}”
                </button>
              </div>
            )}
          </div>
        )}

        {open && query.length >= 2 && rows.length === 0 && (
          <div className="pop-panel absolute left-0 right-0 top-full z-chrome-popover mt-2 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
            <p className="px-4 py-5 text-center text-[13px] text-text-3">
              No matches. Press Enter to search everything.
            </p>
          </div>
        )}
      </div>

      {/* Narrow screens: an icon that opens the full search page */}
      <Link
        href="/search"
        aria-label="Search Tenure"
        className="grid h-9 w-9 place-items-center rounded-lg text-[--shell-text-secondary] no-underline transition-colors hover:bg-[--shell-item-hover] hover:text-[--shell-text] sm:hidden"
      >
        <Search size={18} />
      </Link>
    </>
  )
}
