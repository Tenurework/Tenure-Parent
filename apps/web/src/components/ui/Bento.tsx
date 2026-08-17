import { type CSSProperties, type ReactNode } from "react"
import Link from "next/link"
import { type IconType } from "@/components/ui/icons"
import { Sparkline } from "@/components/charts/Sparkline"

/** Signed trend chip shown on a stat tile. */
export type StatDelta = {
  /** Pre-formatted magnitude, e.g. "+12%" or "3". */
  value: string
  direction: "up" | "down" | "flat"
  /** Whether this movement is good. Defaults to "up is good" when omitted. */
  good?: boolean
}

/** Colour a delta chip by whether its movement is good, not merely its sign. */
function deltaChipStyle(delta: StatDelta): CSSProperties {
  if (delta.direction === "flat") {
    return { color: "var(--text-3)", background: "var(--bg-subtle)" }
  }
  const good = delta.good ?? delta.direction === "up"
  return good
    ? { color: "var(--success)", background: "var(--success-light)" }
    : { color: "var(--error)", background: "var(--error-light)" }
}

const DELTA_GLYPH: Record<StatDelta["direction"], string> = {
  up: "↑",
  down: "↓",
  flat: "→",
}

/**
 * The Bento system — one uniform tile grammar for the whole product.
 *
 * Every dashboard, worklet board and admin overview lays out on the same
 * 12-column grid with the same gaps, and every tile is the same surface,
 * radius, border and elevation. Vary a tile's width with `span`; never its
 * shape. This is what makes the product read as one system instead of a dozen
 * bespoke cards.
 */

const SPAN: Record<number, string> = {
  3: "col-span-12 sm:col-span-6 lg:col-span-3",
  4: "col-span-12 sm:col-span-6 lg:col-span-4",
  5: "col-span-12 lg:col-span-5",
  6: "col-span-12 lg:col-span-6",
  7: "col-span-12 lg:col-span-7",
  8: "col-span-12 lg:col-span-8",
  9: "col-span-12 lg:col-span-9",
  12: "col-span-12",
}

export function BentoGrid({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`grid grid-cols-12 gap-3 sm:gap-4 ${className ?? ""}`}>
      {children}
    </div>
  )
}

export function BentoTile({
  children,
  span = 4,
  className,
  padding = true,
  tone = "surface",
}: {
  children: ReactNode
  span?: keyof typeof SPAN | number
  className?: string
  padding?: boolean
  tone?: "surface" | "accent" | "subtle"
}) {
  const toneClass =
    tone === "accent"
      ? "bg-accent-light border-transparent"
      : tone === "subtle"
        ? "bg-subtle border-border"
        : "bg-surface border-border"
  return (
    <div
      className={`
        ${SPAN[span] ?? SPAN[4]}
        tile-float rounded-[10px] border ${toneClass}
        ${padding ? "p-4 sm:p-5" : ""}
        ${className ?? ""}
      `}
    >
      {children}
    </div>
  )
}

/** A uniform KPI row — the four-across summary stat pattern. */
export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">{children}</div>
  )
}

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  color = "var(--primary)",
  href,
  delta,
  spark,
}: {
  label: string
  value: ReactNode
  hint?: string
  icon: IconType
  color?: string
  href?: string
  /** Optional signed trend chip beside the value. */
  delta?: StatDelta
  /** Optional trend series rendered as a sparkline pinned to the tile foot. */
  spark?: number[]
}) {
  const inner = (
    <div className="tile-float flex h-full flex-col rounded-[10px] border border-border bg-surface p-4">
      {/* Label leads (ERP KPI convention); the icon recedes to the top-right.
          Bare outline glyph — no tinted plate behind it, so the colour lives on
          the stroke alone (see ICONOGRAPHY in globals.css). */}
      <div className="flex items-start justify-between gap-2">
        <p className="micro-label pt-0.5">{label}</p>
        <Icon size={18} style={{ color }} weight="regular" className="shrink-0" aria-hidden />
      </div>
      <div className="mt-2.5 flex items-baseline gap-2">
        <p
          className="text-[26px] font-bold leading-none tabular-nums"
          style={{ color: "var(--text-1)", letterSpacing: "-0.02em" }}
        >
          {value}
        </p>
        {delta && (
          <span
            className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-meta font-semibold tabular-nums"
            style={deltaChipStyle(delta)}
          >
            <span aria-hidden>{DELTA_GLYPH[delta.direction]}</span>
            {delta.value}
          </span>
        )}
      </div>
      {hint && <p className="mt-1.5 text-meta text-text-3">{hint}</p>}
      {spark && spark.length > 1 && (
        <div data-testid="stat-spark" className="mt-auto pt-3">
          {/* GE-143-033. The tile's own label, so the sparkline's disclosure
              names the series it is of rather than describing an anonymous
              trend: "Active members. Trend of 8 points. From 100 to 101 — the
              axis starts at 100, not zero…". */}
          <Sparkline values={spark} labelPrefix={label} />
        </div>
      )}
    </div>
  )
  if (href) {
    return (
      <Link href={href} className="block no-underline outline-none focus-visible:ring-2 focus-visible:ring-[--border-focus] rounded-lg">
        {inner}
      </Link>
    )
  }
  return inner
}
