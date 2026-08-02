"use client"

import { useState, type ReactNode } from "react"
import { useMeasuredWidth, useMounted } from "./hooks"
import { slotColor, SURFACE } from "./palette"
import { formatCompact } from "./format"
import { ChartTooltip, TooltipHeader, TooltipRow } from "./ChartTooltip"
import { ChartEmpty } from "./ChartEmpty"

export type DonutDatum = { label: string; value: number; color?: string }

/**
 * Part-to-whole donut (≤ 8 segments). Arcs are drawn as a stroked ring with 2px
 * surface gaps between segments; each segment is its own hover/focus hit target
 * that lifts (thicker stroke) and opens a tooltip with its value and share. A
 * centre figure carries the headline; a legend names every segment.
 */
export function DonutChart({
  data,
  height = 184,
  thickness,
  centerValue,
  centerLabel,
  formatValue = (n) => formatCompact(n),
  className,
}: {
  data: DonutDatum[]
  height?: number
  thickness?: number
  centerValue?: ReactNode
  centerLabel?: string
  formatValue?: (n: number) => string
  className?: string
}) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>()
  const mounted = useMounted()
  const [active, setActive] = useState<number | null>(null)

  const total = data.reduce((n, d) => n + Math.max(0, d.value), 0)
  const size = height
  const stroke = thickness ?? Math.round(size * 0.16)
  const r = size / 2 - stroke / 2 - 2
  const cx = size / 2
  const cy = size / 2
  const C = 2 * Math.PI * r
  const gapLen = total > 0 ? Math.min(C * 0.012, 3) : 0

  // Precompute segment angles/lengths.
  let cum = 0
  const segs = data.map((d, i) => {
    const frac = total > 0 ? Math.max(0, d.value) / total : 0
    const startFrac = cum
    cum += frac
    const arcLen = frac * C
    const midFrac = startFrac + frac / 2
    const midAngle = (-90 + midFrac * 360) * (Math.PI / 180)
    return {
      i,
      color: d.color ?? slotColor(i),
      arcLen,
      startAngleDeg: -90 + startFrac * 360,
      point: [cx + r * Math.cos(midAngle), cy + r * Math.sin(midAngle)] as const,
      pct: Math.round(frac * 100),
    }
  })

  return (
    <div ref={ref} data-testid="chart-donut" className={`relative ${className ?? ""}`}>
      {total <= 0 ? (
        <ChartEmpty height={size} />
      ) : (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="group"
              aria-label={`Donut chart: ${data.map((d) => `${d.label} ${formatValue(d.value)}`).join(", ")}`}>
              {segs.map((s) => {
                const isActive = active === s.i
                return (
                  <circle key={s.i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color}
                    strokeWidth={isActive ? stroke + 3 : stroke} strokeLinecap="butt"
                    strokeDasharray={`${Math.max(s.arcLen - gapLen, 0.01)} ${C}`}
                    strokeDashoffset={mounted ? 0 : s.arcLen}
                    tabIndex={0} role="img"
                    aria-label={`${data[s.i].label}: ${formatValue(data[s.i].value)}, ${s.pct}%`}
                    onPointerEnter={() => setActive(s.i)}
                    onPointerLeave={() => setActive(null)}
                    onFocus={() => setActive(s.i)}
                    onBlur={() => setActive(null)}
                    style={{
                      transform: `rotate(${s.startAngleDeg}deg)`,
                      transformOrigin: "center",
                      transition: `stroke-dashoffset 420ms ease-out ${s.i * 40}ms, stroke-width 140ms ease-out`,
                      cursor: "default",
                    }}
                    // Same as LineAreaChart: outline:none inline left a focused
                    // segment invisible. .chart-hit carries the ring.
                    className="chart-hit" />
                )
              })}
            </svg>
            {(centerValue != null || centerLabel) && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                {centerValue != null && (
                  <span className="text-2xl font-bold text-text-1" style={{ letterSpacing: "-0.02em" }}>
                    {centerValue}
                  </span>
                )}
                {centerLabel && <span className="mt-0.5 text-meta text-text-3">{centerLabel}</span>}
              </div>
            )}
          </div>

          {/* legend with values */}
          <ul className="min-w-0 flex-1 space-y-1.5">
            {data.map((d, i) => (
              <li key={d.label} className="flex items-center gap-2 text-sm">
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: d.color ?? slotColor(i) }} />
                <span className="min-w-0 flex-1 truncate text-text-2">{d.label}</span>
                <span className="shrink-0 font-medium tabular-nums text-text-1">{formatValue(d.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {active != null && (
        <ChartTooltip x={segs[active].point[0]} y={segs[active].point[1]} containerWidth={width}>
          <TooltipHeader>{data[active].label}</TooltipHeader>
          <TooltipRow color={segs[active].color} name={`${segs[active].pct}%`}
            value={formatValue(data[active].value)} shape="rect" />
        </ChartTooltip>
      )}
    </div>
  )
}
