"use client"

import { useLayoutEffect, useRef, useState, type ReactNode } from "react"

/**
 * The one floating tooltip used by every chart. An absolutely-positioned div
 * inside the chart's relative wrapper; it measures itself and clamps/flips so it
 * never spills past a card edge. Names arrive as JSX text (never innerHTML), so
 * untrusted series/category labels can't inject markup.
 */
export function ChartTooltip({
  x,
  y,
  containerWidth,
  children,
}: {
  x: number
  y: number
  containerWidth: number
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useLayoutEffect(() => {
    if (ref.current) {
      setSize({ w: ref.current.offsetWidth, h: ref.current.offsetHeight })
    }
  }, [children])

  const left = Math.max(4, Math.min(x - size.w / 2, containerWidth - size.w - 4))
  let top = y - size.h - 10
  if (top < 4) top = y + 16 // flip below when there's no room above

  return (
    <div
      ref={ref}
      data-testid="chart-tooltip"
      role="tooltip"
      className="pointer-events-none absolute z-30 rounded-md border border-border bg-surface px-2.5 py-2 shadow-lg"
      style={{ left, top, minWidth: 108, maxWidth: 240 }}
    >
      {children}
    </div>
  )
}

/** Small muted heading (the X value / category the readout is for). */
export function TooltipHeader({ children }: { children: ReactNode }) {
  return <div className="mb-1 text-meta font-medium text-text-3">{children}</div>
}

/**
 * One series row inside the tooltip. Value LEADS (bold, primary ink), name
 * follows (secondary ink); identity is a short colour stroke, never a filled
 * box and never coloured text.
 */
export function TooltipRow({
  color,
  name,
  value,
  shape = "line",
}: {
  color: string
  name: ReactNode
  value: ReactNode
  shape?: "line" | "rect"
}) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span
        aria-hidden
        className="shrink-0 self-center"
        style={
          shape === "line"
            ? { height: 2, width: 12, borderRadius: 9999, background: color }
            : { height: 10, width: 10, borderRadius: 2, background: color }
        }
      />
      <span className="font-semibold text-text-1 tabular-nums">{value}</span>
      <span className="text-meta text-text-2">{name}</span>
    </div>
  )
}
