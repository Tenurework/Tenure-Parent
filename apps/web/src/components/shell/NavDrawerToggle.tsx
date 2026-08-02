"use client"

import { useCallback, useEffect, useState } from "react"

/**
 * GE-022-003 — WCAG 1.4.10, Reflow.
 *
 * The side nav is 224px wide and fixed. At the 320 CSS px reflow target that is
 * two thirds of the screen given to navigation, and the page beside it can only
 * be reached by scrolling sideways — which is the thing 1.4.10 exists to
 * prevent. Below `--nav-drawer-breakpoint` the nav therefore slides off-canvas
 * and this opens it.
 *
 * A class on <html> rather than React state shared through a context: the nav's
 * width and position are already CSS-driven (`--sidenav-current-width`), the
 * pre-hydration script in the root layout already sets `nav-collapsed` the same
 * way, and a second source of truth for "is the nav showing" is how the two
 * come to disagree.
 */
export function NavDrawerToggle() {
  const [open, setOpen] = useState(false)

  const set = useCallback((next: boolean) => {
    document.documentElement.classList.toggle("nav-open", next)
    setOpen(next)
  }, [])

  // Escape closes it. A drawer that covers the page and can only be dismissed
  // by finding the button again is a trap for anyone not using a mouse.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") set(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, set])

  // Widening past the breakpoint puts the nav back on screen permanently. If
  // the class stayed, the scrim would still be over the page.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 701px)")
    const onChange = () => {
      if (mq.matches) set(false)
    }
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [set])

  return (
    <>
      <button
        type="button"
        // Hidden above the breakpoint, where the nav is always visible and a
        // button that toggles nothing would just be another Tab stop.
        className="nav-drawer-toggle grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[--shell-text-secondary] hover:bg-[--shell-item-hover] hover:text-[--shell-text]"
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        aria-controls="primary-navigation"
        onClick={() => set(!open)}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden fill="none">
          <path
            d={open ? "M4 4l10 10M14 4L4 14" : "M2.5 4.5h13M2.5 9h13M2.5 13.5h13"}
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {/* Clicking beside the drawer closes it. aria-hidden because the button
          above is the accessible control; this is the pointer affordance. */}
      <div className="nav-drawer-scrim" aria-hidden onClick={() => set(false)} />
    </>
  )
}
