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
  type IconType,
} from "@/components/ui/icons"

interface Result {
  id: string
  kind: "memory" | "document" | "approval" | "event" | "organization"
  title: string
  href: string
  context: string
  snippet: string
}

const KIND_ICON: Record<Result["kind"], IconType> = {
  memory: BookOpen,
  document: FileText,
  approval: CheckCircle,
  event: CalendarDays,
  organization: Building2,
}

/**
 * The activated global search: a header command palette with live,
 * permission-scoped results (/api/search) that you can arrow through and open
 * directly, while Enter still takes you to the full /search page.
 */
export function SearchCommand() {
  const router = useRouter()
  const [q, setQ] = useState("")
  const [results, setResults] = useState<Result[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const boxRef = useRef<HTMLDivElement>(null)

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

  const go = (href: string) => {
    setOpen(false)
    setQ("")
    router.push(href)
  }

  const submitSearch = () => {
    const query = q.trim()
    if (!query) return
    setOpen(false)
    router.push(`/search?q=${encodeURIComponent(query)}`)
  }

  const showDropdown = open && q.trim().length >= 2

  const list = useMemo(() => results.slice(0, 8), [results])

  return (
    <>
      <div ref={boxRef} className="relative hidden sm:block w-64 lg:w-80">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            if (active >= 0 && list[active]) go(list[active].href)
            else submitSearch()
          }}
        >
          <div
            className="flex h-9 items-center gap-2 rounded-full px-3.5 text-sm transition-colors focus-within:ring-2 focus-within:ring-[--primary]"
            style={{
              background: "transparent",
              border: "1px solid var(--shell-border)",
              color: "var(--shell-text-secondary)",
            }}
          >
            <Search size={16} className="shrink-0" />
            <input
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
                  setActive((a) => Math.min(a + 1, list.length - 1))
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
              className="flex-1 bg-transparent text-sm text-[--shell-text] outline-none placeholder:text-[--shell-text-secondary]"
            />
          </div>
        </form>

        {showDropdown && (
          <div className="pop-panel absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
            {list.length === 0 ? (
              <p className="px-4 py-5 text-center text-[13px] text-text-3">
                No matches. Press Enter to search everything.
              </p>
            ) : (
              <ul className="max-h-[70vh] overflow-y-auto py-1">
                {list.map((r, i) => {
                  const Icon = KIND_ICON[r.kind]
                  return (
                    <li key={`${r.kind}-${r.id}`}>
                      <Link
                        href={r.href}
                        onClick={() => go(r.href)}
                        onMouseEnter={() => setActive(i)}
                        className={`flex items-start gap-3 px-4 py-2.5 no-underline ${
                          i === active ? "bg-base" : ""
                        }`}
                      >
                        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-base text-text-3">
                          <Icon size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-text-1">{r.title}</span>
                          <span className="block truncate text-[13px] text-text-3">
                            <span className="capitalize">{r.kind}</span> · {r.context}
                          </span>
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="border-t border-border">
              <button
                onClick={submitSearch}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] font-medium text-text-link hover:bg-base"
              >
                <Search size={14} /> See all results for “{q.trim()}”
              </button>
            </div>
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
