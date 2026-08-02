"use client"

import { useEffect, useState } from "react"

import {
  DEFAULT_PREFERENCES,
  STORAGE_KEYS,
  documentAttributes,
  type AccessibilityPreference,
  type ColorScheme,
  type Density,
  type Preferences,
} from "@/lib/preferences"

/**
 * GE-022-008 — display preferences for an operator who reads this console for
 * long stretches.
 *
 * Built on `<details>` rather than a custom popover. The element already has
 * the open/close semantics, the keyboard behaviour and the accessible name that
 * a hand-rolled menu has to reimplement, and reimplementations of exactly this
 * are where console accessibility usually goes wrong. What it does not give is
 * dismiss-on-outside-click, which is added below and is the only bespoke part.
 *
 * Each control is a radio group, not a cycling button. A cycle is fine for one
 * two-state toggle and wrong for four preferences: it cannot show the current
 * value alongside the alternatives, and it forces a screen-reader user to
 * activate a control to discover what it does.
 */

const MEDIA = {
  dark: "(prefers-color-scheme: dark)",
  reducedMotion: "(prefers-reduced-motion: reduce)",
  increasedContrast: "(prefers-contrast: more)",
} as const

function readDevice() {
  return {
    dark: window.matchMedia(MEDIA.dark).matches,
    reducedMotion: window.matchMedia(MEDIA.reducedMotion).matches,
    increasedContrast: window.matchMedia(MEDIA.increasedContrast).matches,
  }
}

function apply(preferences: Preferences) {
  const attributes = documentAttributes(preferences, readDevice())
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null) document.documentElement.removeAttribute(name)
    else document.documentElement.setAttribute(name, value)
  }
}

function readStored(): Preferences {
  const read = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = window.localStorage.getItem(key)
    return allowed.includes(value as T) ? (value as T) : fallback
  }
  return {
    colorScheme: read(STORAGE_KEYS.colorScheme, ["system", "light", "dark"] as const, "system"),
    density: read(STORAGE_KEYS.density, ["comfortable", "compact"] as const, "comfortable"),
    reducedMotion: read(STORAGE_KEYS.reducedMotion, ["system", "on", "off"] as const, "system"),
    increasedContrast: read(
      STORAGE_KEYS.increasedContrast,
      ["system", "on", "off"] as const,
      "system",
    ),
  }
}

interface ChoiceProps<T extends string> {
  legend: string
  hint: string
  name: keyof Preferences
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}

function Choice<T extends string>({ legend, hint, name, value, options, onChange }: ChoiceProps<T>) {
  return (
    <fieldset className="pref-group">
      <legend>{legend}</legend>
      {/* The hint is referenced by the group rather than left as adjacent text,
          so a screen reader reads WHY the setting exists and not only its name. */}
      <p className="pref-hint" id={`${name}-hint`}>
        {hint}
      </p>
      <div className="pref-options" role="radiogroup" aria-describedby={`${name}-hint`}>
        {options.map((option) => (
          <label key={option.value} className="pref-option">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

const ACCESSIBILITY_OPTIONS = [
  { value: "system", label: "Match device" },
  { value: "on", label: "Always on" },
] as const satisfies readonly { value: AccessibilityPreference; label: string }[]

export function PreferencesMenu() {
  // Starts at the defaults and is corrected on mount. Rendering the stored
  // values directly would mean the server and the first client render disagree,
  // which React resolves by discarding one of them without saying so.
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const stored = readStored()
    setPreferences(stored)
    apply(stored)
  }, [])

  useEffect(() => {
    // Following the machine means following it when it CHANGES, not only at
    // load. Without this, an operator on an automatic day/night schedule, or one
    // who turns on reduced motion mid-session because something made them ill,
    // keeps whatever state the page opened in.
    const queries = Object.values(MEDIA).map((q) => window.matchMedia(q))
    const onChange = () => apply(preferences)
    for (const query of queries) query.addEventListener("change", onChange)
    return () => {
      for (const query of queries) query.removeEventListener("change", onChange)
    }
  }, [preferences])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target as Element).closest(".preferences")) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    const next = { ...preferences, [key]: value }
    setPreferences(next)
    apply(next)
    window.localStorage.setItem(STORAGE_KEYS[key], value)
  }

  return (
    <details
      className="preferences"
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="pref-trigger" aria-label="Display preferences">
        Display
      </summary>
      {/*
        Rendered only when open, rather than left to `<details>` to hide.
        A closed `<details>` hides its children through the `::details-content`
        pseudo-element, and an absolutely-positioned child escapes that: the
        panel kept a real bounding box while closed, and the layout suite caught
        it drawing "Density" on top of the page's own text at 1180px and 900px.
        Nothing was visible on screen, which is why only a geometry test found it.
      */}
      {open && <div className="pref-panel">
        <Choice
          legend="Theme"
          hint="Match device follows your operating system, including when it changes."
          name="colorScheme"
          value={preferences.colorScheme}
          options={
            [
              { value: "system", label: "Match device" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ] as const satisfies readonly { value: ColorScheme; label: string }[]
          }
          onChange={(value) => set("colorScheme", value)}
        />
        <Choice
          legend="Density"
          hint="Compact tightens spacing only. Text size and click targets do not change."
          name="density"
          value={preferences.density}
          options={
            [
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ] as const satisfies readonly { value: Density; label: string }[]
          }
          onChange={(value) => set("density", value)}
        />
        <Choice
          legend="Reduced motion"
          hint="Your device's setting always applies. This can only add to it."
          name="reducedMotion"
          value={preferences.reducedMotion}
          options={ACCESSIBILITY_OPTIONS}
          onChange={(value) => set("reducedMotion", value)}
        />
        <Choice
          legend="Increased contrast"
          hint="Your device's setting always applies. This can only add to it."
          name="increasedContrast"
          value={preferences.increasedContrast}
          options={ACCESSIBILITY_OPTIONS}
          onChange={(value) => set("increasedContrast", value)}
        />
      </div>}
    </details>
  )
}
