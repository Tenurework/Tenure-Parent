"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import {
  RECENT_LIMIT,
  moveSelection,
  rank,
  remember,
  togglePin,
  type Destination,
} from "@/lib/commands"

/**
 * GE-022-007 — the command launcher.
 *
 * Bible §26.3.1: command search, keyboard shortcuts, recent items, favourites
 * and universal create are first-class paths. §26.3.8 adds the constraint that
 * matters more than any of them — minimise **context loss**.
 *
 * Three things a launcher usually gets wrong, and what is done here instead:
 *
 *   * **Focus.** Opening moves focus into the input, and closing must put it
 *     back where it came from. A launcher that drops focus on `<body>` sends a
 *     keyboard user to the top of the document, so Escape costs them their
 *     place — which is exactly the context loss §26.3.8 names.
 *   * **History.** Opening is NOT a navigation. Pushing a history entry makes
 *     the browser Back button close the palette instead of going back, and the
 *     operator who wanted the previous page presses it twice and overshoots.
 *   * **Scroll.** The usual `document.body.style.overflow = "hidden"` collapses
 *     the scrollbar and, in a page taller than the viewport, jumps the content.
 *     The overlay covers the page without touching body scroll at all.
 */

export const RECENT_KEY = "tenure-studio-recent"
export const PINNED_KEY = "tenure-studio-pinned"

function readList(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []
  } catch {
    // A corrupt value is a lost preference, never a broken console.
    return []
  }
}

export function CommandPalette({ destinations }: { destinations: readonly Destination[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState(0)
  const [recent, setRecent] = useState<readonly string[]>([])
  const [pinned, setPinned] = useState<readonly string[]>([])

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  /** Who had focus before we took it. The whole of "safe focus restoration". */
  const returnFocusTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    setRecent(readList(RECENT_KEY))
    setPinned(readList(PINNED_KEY))
  }, [])

  const results = rank(destinations, query, recent, pinned)

  const close = useCallback(() => {
    setOpen(false)
    setQuery("")
    setSelected(0)
    // Restore focus, and only if the element is still in the document — a
    // result that navigated away leaves a detached node, and calling focus() on
    // one silently does nothing while looking like it worked.
    const target = returnFocusTo.current
    if (target && document.contains(target)) target.focus()
    returnFocusTo.current = null
  }, [])

  const go = useCallback(
    (destination: Destination) => {
      const next = remember(recent, destination.id)
      setRecent(next)
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      setOpen(false)
      setQuery("")
      setSelected(0)
      // Focus is NOT restored here. The trigger is about to be unmounted by the
      // navigation, and returning focus to a dying node is worse than letting
      // the new route take it.
      returnFocusTo.current = null
      router.push(destination.href)
    },
    [recent, router],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isLauncher = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k"
      if (isLauncher) {
        // Chrome binds Ctrl+K to the address bar and Firefox to search. Without
        // this the palette opens AND the browser steals focus, which reads as
        // the palette being broken.
        event.preventDefault()
        if (open) {
          close()
        } else {
          returnFocusTo.current = document.activeElement as HTMLElement | null
          setOpen(true)
        }
        return
      }
      if (!open) return

      if (event.key === "Escape") {
        event.preventDefault()
        close()
      } else if (event.key === "ArrowDown") {
        event.preventDefault()
        setSelected((s) => moveSelection(s, results.length, 1))
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        setSelected((s) => moveSelection(s, results.length, -1))
      } else if (event.key === "Enter") {
        event.preventDefault()
        const destination = results[selected]
        if (destination) go(destination)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, results, selected, close, go])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    // Keep the selection reachable without scrolling the PAGE. `nearest` moves
    // the list only, so a long result set does not drag the document under the
    // overlay and leave the operator somewhere else when they close it.
    if (!open) return
    const node = listRef.current?.children[selected] as HTMLElement | undefined
    node?.scrollIntoView({ block: "nearest" })
  }, [open, selected])

  if (!open) return null

  return (
    <div
      className="palette-backdrop"
      // Closes on the backdrop only, never on the panel: a click that lands on
      // the panel and drifts one pixel should not discard what was typed.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command search">
        <input
          ref={inputRef}
          className="palette-input"
          type="text"
          placeholder="Go to, or create…"
          value={query}
          aria-label="Search destinations"
          // The listbox is described rather than owned by `aria-activedescendant`
          // pointing at nothing when the list is empty.
          aria-controls="palette-results"
          onChange={(event) => {
            setQuery(event.target.value)
            setSelected(0)
          }}
        />

        <ul className="palette-results" id="palette-results" role="listbox" ref={listRef}>
          {results.length === 0 ? (
            <li className="palette-none">Nothing matches “{query}”.</li>
          ) : (
            results.map((destination, index) => (
              <li
                key={destination.id}
                role="option"
                aria-selected={index === selected}
                className={`palette-result ${index === selected ? "chosen" : ""}`}
                onMouseEnter={() => setSelected(index)}
              >
                <button type="button" className="palette-go" onMouseDown={() => go(destination)}>
                  <span className="palette-title">{destination.title}</span>
                  <span className="palette-group">{destination.group}</span>
                </button>
                <button
                  type="button"
                  className="palette-pin"
                  aria-pressed={pinned.includes(destination.id)}
                  aria-label={`${pinned.includes(destination.id) ? "Unpin" : "Pin"} ${destination.title}`}
                  onMouseDown={(event) => {
                    // The list re-sorts on pin, and a click that lands on a row
                    // which has since moved is the classic way to pin the wrong
                    // thing. Stopping propagation keeps this from also
                    // navigating.
                    event.stopPropagation()
                    const next = togglePin(pinned, destination.id)
                    setPinned(next)
                    window.localStorage.setItem(PINNED_KEY, JSON.stringify(next))
                  }}
                >
                  {pinned.includes(destination.id) ? "Pinned" : "Pin"}
                </button>
              </li>
            ))
          )}
        </ul>

        <p className="palette-hint">
          {query === "" && recent.length > 0
            ? `Your last ${Math.min(recent.length, RECENT_LIMIT)} first. `
            : ""}
          Arrow keys to move, Enter to go, Escape to close.
        </p>
      </div>
    </div>
  )
}
