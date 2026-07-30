"use client"

import { useEffect, useRef, useState } from "react"
import { Search, X, UserRound, Loader2 } from "@/components/ui/icons"
import { Avatar } from "@/components/ui/Avatar"

interface Entry {
  id: string
  name: string
  email: string
  kind: "STUDENT" | "ADVISOR"
  affiliation: string | null
}

/**
 * Typeahead picker over the University of Rochester directory. Administrators
 * search real people by name or email and select one; the choice populates the
 * hidden personEmail / personName fields the assign/transfer actions read.
 * The data source is swappable behind DirectoryProvider (src/lib/directory.ts).
 */
export function DirectoryPicker({ kind }: { kind?: "STUDENT" | "ADVISOR" }) {
  const [q, setQ] = useState("")
  const [results, setResults] = useState<Entry[]>([])
  const [selected, setSelected] = useState<Entry | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (selected) return
    const handle = setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ q })
        if (kind) params.set("kind", kind)
        const res = await fetch(`/api/admin/directory?${params}`, { cache: "no-store" })
        const data = (await res.json()) as { results: Entry[] }
        setResults(data.results ?? [])
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 180)
    return () => clearTimeout(handle)
  }, [q, kind, selected])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  return (
    <div ref={boxRef} className="relative">
      <input type="hidden" name="personEmail" value={selected?.email ?? ""} />
      <input type="hidden" name="personName" value={selected?.name ?? ""} />

      {selected ? (
        <div className="flex items-center gap-3 rounded-md border border-border-strong bg-base px-3 py-2">
          <Avatar name={selected.name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-text-1">{selected.name}</p>
            <p className="truncate text-[13px] text-text-3">{selected.email}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelected(null)
              setQ("")
              setOpen(true)
            }}
            aria-label="Clear selection"
            className="grid h-8 w-8 place-items-center rounded-md text-text-3 hover:bg-surface hover:text-text-1"
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <>
          <div className="flex h-10 items-center gap-2 rounded-md border border-border bg-surface px-3 focus-within:border-[--border-focus]">
            {loading ? (
              <Loader2 size={16} className="shrink-0 animate-spin text-text-3" />
            ) : (
              <Search size={16} className="shrink-0 text-text-3" />
            )}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => setOpen(true)}
              placeholder="Search the directory by name or email…"
              className="flex-1 bg-transparent text-[15px] text-text-1 outline-none placeholder:text-text-3"
            />
          </div>

          {open && (
            <ul className="pop-panel absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg">
              {results.length === 0 ? (
                <li className="px-3 py-4 text-center text-[13px] text-text-3">
                  {q ? "No matching people." : "Start typing to search the directory."}
                </li>
              ) : (
                results.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(r)
                        setOpen(false)
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left outline-none transition-colors hover:bg-base"
                    >
                      <Avatar name={r.name} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-text-1">{r.name}</span>
                        <span className="block truncate text-[13px] text-text-3">
                          {r.email}
                          {r.affiliation ? ` · ${r.affiliation}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 rounded bg-base px-1.5 py-0.5 text-[11px] font-medium uppercase text-text-3">
                        {r.kind === "ADVISOR" ? "Advisor" : "Student"}
                      </span>
                    </button>
                  </li>
                ))
              )}
              <li className="border-t border-border px-3 py-2 text-[11px] text-text-3">
                <UserRound size={11} className="mr-1 inline" />
                University of Rochester directory
              </li>
            </ul>
          )}
        </>
      )}
    </div>
  )
}
