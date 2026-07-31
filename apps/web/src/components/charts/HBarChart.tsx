"use client"

import { useState } from "react"
import { useMeasuredWidth, useMounted } from "./hooks"
import { slotColor, CHART_GRID } from "./palette"
import { axisTicks, niceMax, formatCompact } from "./format"
import { ChartTooltip, TooltipHeader, TooltipRow } from "./ChartTooltip"
import { ChartLegend, type LegendItem } from "./ChartLegend"
import { ChartEmpty } from "./ChartEmpty"

export type HBarRow = { label: string; values: number[] }

const MAX_BAR = 22
const GAP = 2

/** Path for a bar with a 4px-rounded data-end (right) and square baseline (left). */
function roundedRightPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w, h / 2)
  return `M${x},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} L${x},${y + h} Z`
}

/**
 * Horizontal bar chart — grouped or single. Used for the approval funnel
 * (single series, ordered stages) and the budget comparison (two grouped
 * series). Bars cap at 22px with a 4px rounded data-end and 2px surface gaps;
 * `cellColor` lets a caller paint a mark with a status token (e.g. over-budget
 * red) without disturbing the categorical slot order.
 */
export function HBarChart({
  data,
  series,
  height: heightProp,
  labelWidth,
  formatValue = (n) => formatCompact(n),
  formatAxis = (n) => formatCompact(n),
  cellColor,
  showTipLabels,
  className,
  ariaLabel,
}: {
  data: HBarRow[]
  series: { name: string }[]
  height?: number
  labelWidth?: number
  formatValue?: (n: number) => string
  formatAxis?: (n: number) => string
  cellColor?: (rowIndex: number, seriesIndex: number, value: number) => string | undefined
  /** Draw the value at each bar tip. Defaults on for a single series. */
  showTipLabels?: boolean
  className?: string
  ariaLabel?: string
}) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>()
  const mounted = useMounted()
  const [active, setActive] = useState<{ r: number; s: number } | null>(null)

  const n = data.length
  const multi = series.length > 1
  const hasData = n > 0 && data.some((d) => d.values.some((v) => v > 0))
  const tipLabels = showTipLabels ?? !multi

  const labelW = labelWidth ?? Math.min(160, Math.max(96, width * 0.3))
  const padTop = 18
  const padBottom = 8
  const padRight = tipLabels ? 52 : 16
  const plotLeft = labelW
  const plotW = Math.max(0, width - labelW - padRight)

  const barH = Math.min(MAX_BAR, multi ? 16 : 18)
  const rowInner = series.length * barH + (series.length - 1) * GAP
  const rowH = rowInner + 18
  const height = heightProp ?? padTop + n * rowH + padBottom

  const rawMax = Math.max(1, ...data.flatMap((d) => d.values))
  const xMax = niceMax(rawMax)
  const ticks = axisTicks(xMax, 4)
  const wAt = (v: number) => (Math.max(0, v) / xMax) * plotW

  const legend: LegendItem[] = series.map((s, i) => ({
    label: s.name,
    color: slotColor(multi ? i : 0),
    shape: "rect",
  }))

  return (
    <div ref={ref} data-testid="chart-bar" className={className}>
      {multi && <ChartLegend items={legend} className="mb-3" />}
      <div className="relative" style={{ height }}>
        {!hasData ? (
          <ChartEmpty height={Math.min(height, 200)} />
        ) : (
          width > 0 && (
            <>
              <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group"
                aria-label={ariaLabel ?? `Horizontal bar chart of ${n} rows`}>
                {/* vertical gridlines + axis ticks */}
                {ticks.map((t) => {
                  const gx = plotLeft + wAt(t)
                  return (
                    <g key={t}>
                      <line x1={gx} y1={padTop} x2={gx} y2={height - padBottom} stroke={CHART_GRID} strokeWidth={1} />
                      <text x={gx} y={padTop - 6} fontSize={10} fill="var(--text-3)" textAnchor="middle"
                        style={{ fontVariantNumeric: "tabular-nums" }}>
                        {formatAxis(t)}
                      </text>
                    </g>
                  )
                })}

                {data.map((row, ri) => {
                  const rowTop = padTop + ri * rowH + 9
                  return (
                    <g key={row.label}>
                      <text x={plotLeft - 10} y={rowTop + rowInner / 2} fontSize={11} fill="var(--text-1)"
                        textAnchor="end" dominantBaseline="middle">
                        {row.label.length > 20 ? row.label.slice(0, 19) + "…" : row.label}
                      </text>
                      {series.map((s, si) => {
                        const v = row.values[si] ?? 0
                        const y = rowTop + si * (barH + GAP)
                        const w = wAt(v)
                        const color = cellColor?.(ri, si, v) ?? slotColor(multi ? si : 0)
                        const isActive = active?.r === ri && active?.s === si
                        return (
                          <g key={s.name}>
                            {v > 0 && (
                              <g style={{
                                transformBox: "fill-box",
                                transformOrigin: "left",
                                transform: mounted ? "scaleX(1)" : "scaleX(0)",
                                transition: `transform 300ms ease-out ${ri * 16}ms`,
                              }}>
                                <path d={roundedRightPath(plotLeft, y, Math.max(w, 0.5), barH, 4)}
                                  fill={color} opacity={isActive ? 0.82 : 1} />
                              </g>
                            )}
                            {tipLabels && v > 0 && (
                              <text x={plotLeft + w + 6} y={y + barH / 2} fontSize={10} fill="var(--text-2)"
                                dominantBaseline="middle" style={{ fontVariantNumeric: "tabular-nums" }}>
                                {formatValue(v)}
                              </text>
                            )}
                            {/* hit target ≥24px tall */}
                            <rect x={plotLeft} y={y + barH / 2 - 12} width={Math.max(w, 8) + padRight} height={24}
                              fill="transparent" tabIndex={0} role="img"
                              aria-label={`${row.label}${multi ? `, ${s.name}` : ""}: ${formatValue(v)}`}
                              onPointerEnter={() => setActive({ r: ri, s: si })}
                              onPointerLeave={() => setActive(null)}
                              onFocus={() => setActive({ r: ri, s: si })}
                              onBlur={() => setActive(null)}
                              className="chart-hit" style={{ cursor: "default" }} />
                          </g>
                        )
                      })}
                    </g>
                  )
                })}
              </svg>

              {active != null &&
                (() => {
                  const row = data[active.r]
                  const v = row.values[active.s] ?? 0
                  const rowTop = padTop + active.r * rowH + 9
                  const y = rowTop + active.s * (barH + GAP)
                  const cx = plotLeft + wAt(v)
                  const color = cellColor?.(active.r, active.s, v) ?? slotColor(multi ? active.s : 0)
                  return (
                    <ChartTooltip x={cx} y={y} containerWidth={width}>
                      <TooltipHeader>{row.label}</TooltipHeader>
                      <TooltipRow color={color} name={multi ? series[active.s].name : "Total"}
                        value={formatValue(v)} shape="rect" />
                    </ChartTooltip>
                  )
                })()}
            </>
          )
        )}
      </div>
    </div>
  )
}
