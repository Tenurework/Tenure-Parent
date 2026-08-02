"use client"

import { useEffect, useState } from "react"

import { THEME_STORAGE_KEY, type ColorScheme } from "@/lib/theme"

/**
 * Light or dark, for an operator who reads this console for long stretches.
 *
 * Three states rather than two. "System" is the default and is not the same as
 * "light" — a console pinned to light on a machine set to dark is a decision
 * somebody made once and cannot tell they made. The stored value distinguishes
 * "follow the machine" from "I chose light", which a boolean cannot.
 *
 * The engine supplies the DEFAULT (`platform.branding.colorScheme`); this is the
 * operator's own override of it, held in `localStorage` because it is a property
 * of this person at this screen, not of the tenant estate. Nothing here is sent
 * anywhere.
 */

export type { ColorScheme }

const NEXT: Record<ColorScheme, ColorScheme> = {
  system: "light",
  light: "dark",
  dark: "system",
}

const LABEL: Record<ColorScheme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
}

/** Resolve to what the page should actually be, and stamp the root element. */
export function applyScheme(scheme: ColorScheme): void {
  const dark =
    scheme === "dark" ||
    (scheme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  // The attribute the stylesheet keys on. Removed rather than set to "light",
  // so light is the CSS default and there is one place a theme can come from.
  if (dark) document.documentElement.setAttribute("data-theme", "dark")
  else document.documentElement.removeAttribute("data-theme")
}

export function ThemeToggle({ defaultScheme = "system" }: { defaultScheme?: ColorScheme }) {
  // Starts at the engine default and is corrected on mount. Rendering the
  // stored value directly would mean the server and the first client render
  // disagree, which React resolves by discarding one of them silently.
  const [scheme, setScheme] = useState<ColorScheme>(defaultScheme)

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as ColorScheme | null
    const initial = stored === "light" || stored === "dark" || stored === "system" ? stored : defaultScheme
    setScheme(initial)
    applyScheme(initial)
  }, [defaultScheme])

  useEffect(() => {
    if (scheme !== "system") return
    // Following the machine means following it when it changes, not only at
    // load. Without this, an operator on an automatic day/night schedule keeps
    // the theme they happened to open the console in.
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => applyScheme("system")
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [scheme])

  const cycle = () => {
    const next = NEXT[scheme]
    setScheme(next)
    applyScheme(next)
    window.localStorage.setItem(THEME_STORAGE_KEY, next)
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      // The control says what it is and what it will do. "Theme: System" alone
      // leaves a screen-reader user to discover by pressing.
      aria-label={`Theme: ${LABEL[scheme]}. Activate for ${LABEL[NEXT[scheme]]}.`}
      title={`Theme: ${LABEL[scheme]} — click for ${LABEL[NEXT[scheme]]}`}
    >
      {LABEL[scheme]}
    </button>
  )
}
