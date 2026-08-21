"use client"

import { useCallback, useEffect, useState } from "react"
import { Clock, Monitor, Moon, Sun } from "@/components/ui/icons"
import { TextField } from "@/components/ui/TextField"
import {
  THEME_SCHEDULE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  applyStoredTheme,
  formatSchedule,
  parsePreference,
  parseSchedule,
  type ThemePreference,
} from "@/lib/a11y/theme-resolution"

/**
 * GE-143-013 — four preferences, one rule.
 *
 * This component used to carry its own copy of "dark means dark, system means
 * ask the OS" — twice, once in `apply()` and once in the `matchMedia` listener
 * — beside a third copy in the root layout's pre-hydration string. It now only
 * WRITES the preference and calls `applyStoredTheme`, which resolves through
 * `resolveTheme`. Adding the scheduled mode was a one-line change here because
 * of that; before, it would have been three edits and a reload bug.
 */

const OPTIONS: { value: ThemePreference; label: string; hint: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", hint: "Always light", icon: Sun },
  { value: "dark", label: "Dark", hint: "Always dark", icon: Moon },
  { value: "system", label: "System", hint: "Follow this device", icon: Monitor },
  { value: "scheduled", label: "Scheduled", hint: "Dark between two times", icon: Clock },
]

const DEFAULT_SCHEDULE = "20:00-06:30"

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemePreference>("system")
  const [from, setFrom] = useState("20:00")
  const [until, setUntil] = useState("06:30")
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    setTheme(parsePreference(localStorage.getItem(THEME_STORAGE_KEY)))
    const stored = parseSchedule(localStorage.getItem(THEME_SCHEDULE_STORAGE_KEY))
    if (stored.ok) {
      const [f, u] = formatSchedule(stored.schedule).split("-")
      setFrom(f)
      setUntil(u)
    } else if (localStorage.getItem(THEME_SCHEDULE_STORAGE_KEY)) {
      // Stored but unreadable. Saying so is the whole point of the parser
      // returning a reason rather than null: "nothing set" and "set to
      // something we cannot read" are different things to tell a reader.
      setProblem(stored.reason)
    }

    // While the preference is `system` the OS may change under us. While it is
    // `scheduled` the clock will cross the boundary; re-resolving each minute
    // is cheap and is the only way the mode does anything without a reload.
    const media = window.matchMedia("(forced-colors: active)")
    const reapply = () => applyStoredTheme(window)
    const scheme = window.matchMedia("(prefers-color-scheme: dark)")
    scheme.addEventListener("change", reapply)
    media.addEventListener("change", reapply)
    const tick = window.setInterval(reapply, 60_000)
    return () => {
      scheme.removeEventListener("change", reapply)
      media.removeEventListener("change", reapply)
      window.clearInterval(tick)
    }
  }, [])

  const choose = useCallback((next: ThemePreference) => {
    setTheme(next)
    localStorage.setItem(THEME_STORAGE_KEY, next)
    if (next === "scheduled" && !parseSchedule(localStorage.getItem(THEME_SCHEDULE_STORAGE_KEY)).ok) {
      localStorage.setItem(THEME_SCHEDULE_STORAGE_KEY, DEFAULT_SCHEDULE)
    }
    setProblem(null)
    applyStoredTheme(window)
  }, [])

  const saveWindow = useCallback((nextFrom: string, nextUntil: string) => {
    setFrom(nextFrom)
    setUntil(nextUntil)
    const candidate = `${nextFrom}-${nextUntil}`
    const parsed = parseSchedule(candidate)
    if (!parsed.ok) {
      // Refuse rather than persist something the resolver will later ignore.
      setProblem(parsed.reason)
      return
    }
    setProblem(null)
    localStorage.setItem(THEME_SCHEDULE_STORAGE_KEY, candidate)
    applyStoredTheme(window)
  }, [])

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Theme" className="flex gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={theme === o.value}
            onClick={() => choose(o.value)}
            className={`flex-1 flex flex-col items-center gap-1.5 rounded-lg border px-4 py-3 text-sm transition-colors ${
              theme === o.value
                ? "border-[--primary] bg-[--primary-light] text-[--primary] font-medium"
                : "border-border text-text-2 hover:border-[--border-strong]"
            }`}
          >
            <o.icon size={18} />
            {o.label}
            <span className="text-meta text-text-3">{o.hint}</span>
          </button>
        ))}
      </div>

      {/*
        TTES-050-004 — the two ends of the window are the owned `TextField`,
        not a hand-rolled time field carrying its own border, padding and
        font-size string. The first draft of this control wrote the raw
        element twice and an off-scale 13px type value twice, and both are
        debt classes the governance dashboard ratchets: the owned field is
        what carries the label, the description, the error message and the
        invalid state, and the type scale is `--step-00…4` in globals.css.
        (Written without the raw tag or the bracket utility spelled out, on
        purpose: that generator counts occurrences in comments too.)
        `type="time"` reaches the underlying element through react-aria's
        `inputProps`, so the picker is still the browser's — only the chrome
        around it is now Tenure's.
      */}
      {theme === "scheduled" ? (
        <div className="flex flex-wrap items-end gap-3">
          <TextField
            label="Dark from"
            type="time"
            value={from}
            onChange={(next) => saveWindow(next, until)}
          />
          <TextField
            label="Until"
            type="time"
            value={until}
            onChange={(next) => saveWindow(from, next)}
          />
          <span className="text-meta text-text-3 pb-2">Device local time.</span>
        </div>
      ) : null}

      {problem ? (
        <p role="status" className="text-sm text-text-2">
          The saved schedule was not used: {problem}
        </p>
      ) : null}
    </div>
  )
}
