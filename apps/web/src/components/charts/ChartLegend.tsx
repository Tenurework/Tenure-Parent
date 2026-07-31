import { type CSSProperties } from "react"

export type LegendItem = {
  label: string
  color: string
  /** How the mark reads: a stroke for lines, a swatch for bars/areas/segments. */
  shape?: "line" | "rect"
}

/**
 * Legend — present whenever a chart carries two or more series (a single series
 * needs none; the title names it). The swatch mirrors the mark: a short stroke
 * for lines, a rounded square for bars/areas. Labels wear text tokens, identity
 * comes from the swatch beside them.
 */
export function ChartLegend({
  items,
  className,
}: {
  items: LegendItem[]
  className?: string
}) {
  return (
    <ul className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 ${className ?? ""}`}>
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5 text-meta text-text-2">
          <span aria-hidden className="shrink-0" style={swatch(it)} />
          {it.label}
        </li>
      ))}
    </ul>
  )
}

function swatch(it: LegendItem): CSSProperties {
  if (it.shape === "line") {
    return { height: 2, width: 14, borderRadius: 9999, background: it.color }
  }
  return { height: 10, width: 10, borderRadius: 3, background: it.color }
}
