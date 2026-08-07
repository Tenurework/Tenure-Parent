"use client"

import { useEffect, useState } from "react"

import { StateSurface } from "@/components/ui/StateSurface"

/**
 * TTES-030-002 — the bounded offline pattern, as an actual boundary.
 *
 * `states.ts` has declared an `offline` state since the vocabulary was written:
 * role `status`, `aria-live: polite`, `presentsAsComplete: false`, and copy that
 * says in as many words that changes will not save. Nothing rendered it. The
 * manifest ships `display: "standalone"`, so an installed instance with no
 * service worker and no offline surface showed the browser's network-error page
 * — and, worse, kept its submit buttons live right up until the POST failed.
 *
 * Two halves, and the second is the one the requirement means by "bounded":
 *
 *   1. The banner. Rendered from `StateSurface`, so the role, the politeness
 *      and the wording all come from `STATE_SEMANTICS` / `DEFAULT_COPY` rather
 *      than from this call site. Flipping `offline.live` to `off` in the table
 *      changes what a reader is told here, which is the point of having a table.
 *   2. The boundary. `document.documentElement.dataset.offline` is set while
 *      the connection is down, and `globals.css` keys the submit affordances off
 *      it (`html[data-offline] form button[type=submit]`). A promise in copy
 *      that "changes will not save" while the button still submits is not a
 *      bound; a pointer-events rule plus `aria-disabled` on the same elements
 *      is. `aria-disabled` rather than `disabled` deliberately: a disabled
 *      control leaves the tab order, so a keyboard user loses their place the
 *      moment a train enters a tunnel and gets it back somewhere else.
 *
 * The initial `navigator.onLine` read matters as much as the listeners: a page
 * loaded from the HTTP cache while already offline fires no `offline` event,
 * and a component that only subscribes shows nothing at all on exactly the load
 * where the banner is most needed.
 */
export function OfflineBoundary() {
  // Server render and first client render must agree, so this starts online and
  // the effect below corrects it. Reading `navigator` during render would be a
  // hydration mismatch on every offline load.
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline = () => setOffline(false)

    // The load-while-offline case; see the header.
    if (typeof navigator !== "undefined" && navigator.onLine === false) setOffline(true)

    window.addEventListener("offline", goOffline)
    window.addEventListener("online", goOnline)
    return () => {
      window.removeEventListener("offline", goOffline)
      window.removeEventListener("online", goOnline)
    }
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (offline) root.dataset.offline = "true"
    else delete root.dataset.offline

    // Every submit control the CSS is about to make inert, told to assistive
    // technology as well. CSS alone stops the pointer and says nothing.
    const submits = document.querySelectorAll<HTMLElement>(
      'form button[type="submit"], form button:not([type]), form input[type="submit"]',
    )
    for (const el of Array.from(submits)) {
      if (offline) el.setAttribute("aria-disabled", "true")
      else if (el.getAttribute("aria-disabled") === "true") el.removeAttribute("aria-disabled")
    }
  }, [offline])

  if (!offline) return null

  return (
    <div className="offline-boundary fixed left-1/2 z-toast w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 shadow-md"
      style={{ top: "calc(var(--shell-height) + 0.5rem)" }}
    >
      <StateSurface state="offline" />
    </div>
  )
}
