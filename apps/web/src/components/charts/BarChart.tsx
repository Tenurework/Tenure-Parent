"use client"

import { useState } from "react"
import { useMeasuredWidth, useMounted } from "./hooks"
import { slotColor, CHART_GRID } from "./palette"
import { axisTicks, niceMax, formatCompact } from "./format"
import { ChartTooltip, TooltipHeader, TooltipRow } from "./ChartTooltip"
import { ChartLegend, type LegendItem } from "./ChartLegend"
import { ChartEmpty } from "./ChartEmpty"

export type BarSeries = { name: string; values: number[]; color?: string }

const MAX_BAR = 24
const GAP = 2 // surface-colour gap between touching marks

/** Path for a bar with a 4px-rounded data-end and a square baseline. */
function roundedTopPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`
}

/**
 * Vertical bar chart — single, grouped, or stacked. Bars cap at 24px with a 4px
 * rounded top, square baseline, and a 2px surface gap between touching marks.
 * Every bar is its own hover/focus hit target with a floating tooltip and a
 * slight lift.
 */
export function BarChart({
  categories,
  series,
  stacked = false,
  overlayLine,
  height = 240,
  yMax: yMaxProp,
  formatValue = (n) => formatCompact(n),
  formatAxis = (n) => formatCompact(n),
  className,
}: {
  categories: string[]
  series: BarSeries[]
  stacked?: boolean
  /** A trend line drawn on the SAME y-scale over the bars (cash-flow style).
      Defaults to neutral ink so it reads as a trend, not another series. */
  overlayLine?: { name: string; values: number[]; color?: string }
  height?: number
  yMax?: number
  formatValue?: (n: number) => string
  formatAxis?: (n: number) => string
  className?: string
}) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>()
  const mounted = useMounted()
  const [active, setActive] = useState<{ c: number; s: number } | null>(null)

  const n = categories.length
  const hasData = n > 0 && series.some((s) => s.values.some((v) => v > 0))
  const multi = series.length > 1

  const padTop = 14
  const padBottom = 28
  const padLeft = 46
  const padRight = 14
  const plotW = Math.max(0, width - padLeft - padRight)
  const plotH = Math.max(0, height - padTop - padBottom)
  const baseline = padTop + plotH

  const barsMax = stacked
    ? Math.max(1, ...categories.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0)))
    : Math.max(1, ...series.flatMap((s) => s.values))
  const overlayMax = overlayLine ? Math.max(0, ...overlayLine.values.filter((v) => Number.isFinite(v))) : 0
  const rawMax = Math.max(barsMax, overlayMax)
  const yMax = yMaxProp ?? niceMax(rawMax)
  const ticks = axisTicks(yMax, 4)

  const bandW = n > 0 ? plotW / n : plotW
  const hAt = (v: number) => (Math.max(0, v) / yMax) * plotH

  const legend: LegendItem[] = [
    ...series.map((s, i) => ({
      label: s.name,
      color: s.color ?? slotColor(multi ? i : 0),
      shape: "rect" as const,
    })),
    ...(overlayLine
      ? [{ label: overlayLine.name, color: overlayLine.color ?? "var(--text-1)", shape: "line" as const }]
      : []),
  ]

  const labelEvery = Math.max(1, Math.ceil((n * 48) / Math.max(plotW, 1)))

  return (
    <div ref={ref} data-testid="chart-bar" className={className}>
      {(multi || overlayLine) && <ChartLegend items={legend} className="mb-3" />}
      <div className="relative" style={{ height }}>
        {!hasData ? (
          <ChartEmpty height={height} />
        ) : (
          width > 0 && (
            <>
              <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group"
                aria-label={`Bar chart across ${n} categories`}>
                {ticks.map((t) => {
                  const gy = baseline - hAt(t)
                  return (
                    <g key={t}>
                      <line x1={padLeft} y1={gy} x2={width - padRight} y2={gy} stroke={CHART_GRID} strokeWidth={1} />
                      <text x={padLeft - 8} y={gy} fontSize={10} fill="var(--text-3)" textAnchor="end"
                        dominantBaseline="middle" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {formatAxis(t)}
                      </text>
                    </g>
                  )
                })}

                {categories.map((cat, ci) => {
                  const bx = padLeft + ci * bandW
                  // group geometry
                  const groupW = Math.min(bandW * 0.72, multi ? series.length * MAX_BAR + (series.length - 1) * GAP : MAX_BAR)
                  const barW = stacked
                    ? Math.min(MAX_BAR, groupW)
                    : Math.min(MAX_BAR, (groupW - (series.length - 1) * GAP) / series.length)
                  const groupStart = bx + (bandW - (stacked ? barW : series.length * barW + (series.length - 1) * GAP)) / 2

                  let stackTop = baseline // running top for stacked mode

                  return (
                    <g key={cat}>
                      {series.map((s, si) => {
                        const v = s.values[ci] ?? 0
                        const color = s.color ?? slotColor(multi ? si : 0)
                        const h = hAt(v)
                        let x: number
                        let y: number
                        if (stacked) {
                          x = groupStart
                          y = stackTop - h
                          stackTop = y - (h > 0 ? GAP : 0)
                        } else {
                          x = groupStart + si * (barW + GAP)
                          y = baseline - h
                        }
                        const isActive = active?.c === ci && active?.s === si
                        if (v <= 0) return null
                        return (
                          <g key={s.name}
                            style={{
                              transformBox: "fill-box",
                              transformOrigin: "bottom",
                              transform: mounted ? "scaleY(1)" : "scaleY(0)",
                              transition: `transform 300ms ease-out ${ci * 18}ms`,
                            }}>
                            <path d={roundedTopPath(x, y, barW, h, 4)} fill={color}
                              opacity={isActive ? 0.82 : 1} />
                            {/* enlarged transparent hit target */}
                            <rect x={x - GAP} y={y} width={barW + GAP * 2} height={Math.max(h, 24)}
                              fill="transparent" tabIndex={0} role="img"
                              aria-label={`${cat}${multi ? `, ${s.name}` : ""}: ${formatValue(v)}`}
                              onPointerEnter={() => setActive({ c: ci, s: si })}
                              onPointerLeave={() => setActive(null)}
                              onFocus={() => setActive({ c: ci, s: si })}
                              onBlur={() => setActive(null)}
                              className="chart-hit" style={{ cursor: "default" }} />
                          </g>
                        )
                      })}
                    </g>
                  )
                })}

                {/* Overlay trend line — same y-scale, drawn on top (cash-flow style). */}
                {overlayLine &&
                  (() => {
                    const oc = overlayLine.color ?? "var(--text-1)"
                    const pts = overlayLine.values.map(
                      (v, i) => [padLeft + i * bandW + bandW / 2, baseline - hAt(v)] as const
                    )
                    if (pts.length === 0) return null
                    const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ")
                    return (
                      <g>
                        <path
                          d={d}
                          fill="none"
                          stroke={oc}
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          pathLength={1}
                          style={{
                            strokeDasharray: 1,
                            strokeDashoffset: mounted ? 0 : 1,
                            transition: "stroke-dashoffset 460ms ease-out 140ms",
                          }}
                        />
                        {pts.map((p, i) => (
                          <circle
                            key={i}
                            cx={p[0]}
                            cy={p[1]}
                            r={3}
                            fill={oc}
                            stroke="var(--bg-surface)"
                            strokeWidth={1.5}
                            style={{ opacity: mounted ? 1 : 0, transition: "opacity 200ms ease-out 360ms" }}
                          />
                        ))}
                      </g>
                    )
                  })()}

                {categories.map((c, i) =>
                  i % labelEvery === 0 ? (
                    <text key={`x${i}`} x={padLeft + i * bandW + bandW / 2} y={height - 8} fontSize={10}
                      fill="var(--text-3)" textAnchor="middle">
                      {c.length > 12 ? c.slice(0, 11) + "…" : c}
                    </text>
                  ) : null
                )}
              </svg>

              {active != null &&
                (() => {
                  const s = series[active.s]
                  const v = s.values[active.c] ?? 0
                  const groupW = Math.min(bandW * 0.72, multi ? series.length * MAX_BAR + (series.length - 1) * GAP : MAX_BAR)
                  const barW = stacked
                    ? Math.min(MAX_BAR, groupW)
                    : Math.min(MAX_BAR, (groupW - (series.length - 1) * GAP) / series.length)
                  const groupStart =
                    padLeft + active.c * bandW +
                    (bandW - (stacked ? barW : series.length * barW + (series.length - 1) * GAP)) / 2
                  const cx = stacked ? groupStart + barW / 2 : groupStart + active.s * (barW + GAP) + barW / 2
                  // stacked: anchor near total top; grouped/single: bar top
                  let topY = baseline - hAt(v)
                  if (stacked) {
                    let acc = baseline
                    for (let k = 0; k <= active.s; k++) acc -= hAt(s.values && series[k].values[active.c] ? series[k].values[active.c] : 0)
                    topY = acc
                  }
                  return (
                    <ChartTooltip x={cx} y={topY} containerWidth={width}>
                      <TooltipHeader>{categories[active.c]}</TooltipHeader>
                      <TooltipRow color={s.color ?? slotColor(multi ? active.s : 0)} name={s.name}
                        value={formatValue(v)} shape="rect" />
                      {overlayLine && overlayLine.values[active.c] != null && (
                        <TooltipRow
                          color={overlayLine.color ?? "var(--text-1)"}
                          name={overlayLine.name}
                          value={formatValue(overlayLine.values[active.c])}
                          shape="line"
                        />
                      )}
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
