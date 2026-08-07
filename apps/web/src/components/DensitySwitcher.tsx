"use client"

import { useEffect, useState } from "react"
import { RowsComfortable, RowsCompact } from "@/components/ui/icons"

/**
 * TTES-010-003 — the production caller for the density contract.
 *
 * The tokens in `globals.css` (`--control-h*`, `--row-h`, `--density-gap`) and
 * their `:root[data-density="compact"]` overrides are inert until something
 * stamps the attribute. Two things do: the pre-hydration script in
 * `src/app/layout.tsx`, which reads the same `tenure-density` key before first
 * paint so the frame never flashes at the wrong height, and this control, which
 * is how a person changes it.
 *
 * Deliberately the same shape as ThemeSwitcher, including writing the attribute
 * itself rather than waiting for a reload: both are `<html>`-level preferences
 * persisted in localStorage, and a settings page where one applies instantly and
 * the other does not reads as a bug.
 *
 * The value is always written, `comfortable` included, rather than removing the
 * attribute for the default. A DOM that states which density is in force is one
 * an e2e matrix and a support screenshot can both read.
 */

export const DENSITIES = ["comfortable", "compact"] as const
export type Density = (typeof DENSITIES)[number]

const STORAGE_KEY = "tenure-density"

const OPTIONS: { value: Density; label: string; detail: string; icon: typeof RowsComfortable }[] = [
  {
    value: "comfortable",
    label: "Comfortable",
    detail: "Standard row and control heights.",
    icon: RowsComfortable,
  },
  {
    value: "compact",
    label: "Compact",
    detail: "Tighter rows — more of a long table on screen at once.",
    icon: RowsCompact,
  },
]

/** Narrows an untrusted stored value; anything else falls back to the default. */
export function readDensity(raw: string | null | undefined): Density {
  return raw === "compact" ? "compact" : "comfortable"
}

function apply(density: Density) {
  document.documentElement.setAttribute("data-density", density)
}

export function DensitySwitcher() {
  const [density, setDensity] = useState<Density>("comfortable")

  useEffect(() => {
    setDensity(readDensity(localStorage.getItem(STORAGE_KEY)))
  }, [])

  function choose(next: Density) {
    setDensity(next)
    localStorage.setItem(STORAGE_KEY, next)
    apply(next)
  }

  return (
    <div role="radiogroup" aria-label="Density" className="flex gap-2">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={density === o.value}
          onClick={() => choose(o.value)}
          className={`flex-1 flex flex-col items-center gap-1.5 rounded-lg border px-4 py-3 text-sm transition-colors ${
            density === o.value
              ? "border-[--primary] bg-[--primary-light] text-[--primary] font-medium"
              : "border-border text-text-2 hover:border-[--border-strong]"
          }`}
        >
          <o.icon size={18} />
          {o.label}
          <span className="text-xs font-normal text-text-3">{o.detail}</span>
        </button>
      ))}
    </div>
  )
}
