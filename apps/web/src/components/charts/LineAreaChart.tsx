"use client"

import { useId, useState, type PointerEvent } from "react"
import { useMeasuredWidth, useMounted } from "./hooks"
import { slotColor, CHART_GRID, CHART_AXIS, SURFACE } from "./palette"
import { axisTicks, niceMax, formatCompact } from "./format"
import { ChartTooltip, TooltipHeader, TooltipRow } from "./ChartTooltip"
import { ChartLegend, type LegendItem } from "./ChartLegend"
import { ChartEmpty } from "./ChartEmpty"

export type LineSeries = { name: string; values: number[]; color?: string }

/**
 * Multi-series line / area chart with a mandatory hover layer: a vertical
 * crosshair snaps to the nearest X and one floating tooltip lists every series
 * at that X. Keyboard users tab through per-X hit rects that open the same
 * readout. Single-series charts fill a ~10% area wash and label their endpoint.
 */
export function LineAreaChart({
  categories,
  series,
  height = 240,
  area,
  yMax: yMaxProp,
  formatValue = (n) => formatCompact(n),
  formatAxis = (n) => formatCompact(n),
  className,
}: {
  categories: string[]
  series: LineSeries[]
  height?: number
  /** Fill under the line. Defaults on for a single series, off for many. */
  area?: boolean
  yMax?: number
  formatValue?: (n: number) => string
  formatAxis?: (n: number) => string
  className?: string
}) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>()
  const mounted = useMounted()
  const [active, setActive] = useState<number | null>(null)
  const uid = useId().replace(/:/g, "") // SVG ids can't contain ':'

  const n = categories.length
  const hasData = n > 0 && series.some((s) => s.values.length > 0)
  const showArea = area ?? series.length === 1

  const padTop = 14
  const padBottom = 28
  const padLeft = 46
  const padRight = 14
  const plotW = Math.max(0, width - padLeft - padRight)
  const plotH = Math.max(0, height - padTop - padBottom)

  const rawMax = Math.max(1, ...series.flatMap((s) => s.values))
  const yMax = yMaxProp ?? niceMax(rawMax)
  const ticks = axisTicks(yMax, 4)

  const xAt = (i: number) => (n > 1 ? padLeft + (i / (n - 1)) * plotW : padLeft + plotW / 2)
  const yAt = (v: number) => padTop + plotH - (Math.max(0, v) / yMax) * plotH

  // Thin out x labels so they never collide.
  const labelEvery = Math.max(1, Math.ceil((n * 46) / Math.max(plotW, 1)))

  const legend: LegendItem[] = series.map((s, i) => ({
    label: s.name,
    color: s.color ?? slotColor(series.length === 1 ? 0 : i),
    shape: "line",
  }))

  function onMove(e: PointerEvent<SVGRectElement>) {
    if (n === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const idx = n > 1 ? Math.round(((px - padLeft) / plotW) * (n - 1)) : 0
    setActive(Math.max(0, Math.min(n - 1, idx)))
  }

  return (
    <div ref={ref} data-testid="chart-line" className={className}>
      {series.length > 1 && <ChartLegend items={legend} className="mb-3" />}
      <div className="relative" style={{ height }}>
        {!hasData ? (
          <ChartEmpty height={height} />
        ) : (
          width > 0 && (
            <>
              <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group"
                aria-label={`Line chart of ${series.map((s) => s.name).join(", ")}`}>
                {/* Per-series vertical gradient — rich near the line, fading to the
                    surface at the baseline (the Monarch-style area wash). */}
                <defs>
                  {series.map((s, si) => {
                    const color = s.color ?? slotColor(series.length === 1 ? 0 : si)
                    return (
                      <linearGradient key={si} id={`area-${uid}-${si}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity={0.34} />
                        <stop offset="55%" stopColor={color} stopOpacity={0.1} />
                        <stop offset="100%" stopColor={color} stopOpacity={0} />
                      </linearGradient>
                    )
                  })}
                </defs>
                {/* horizontal gridlines + y ticks */}
                {ticks.map((t) => {
                  const gy = yAt(t)
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

                {/* x labels */}
                {categories.map((c, i) =>
                  i % labelEvery === 0 ? (
                    <text key={i} x={xAt(i)} y={height - 8} fontSize={10} fill="var(--text-3)" textAnchor="middle">
                      {c}
                    </text>
                  ) : null
                )}

                {/* crosshair */}
                {active != null && (
                  <line x1={xAt(active)} y1={padTop} x2={xAt(active)} y2={padTop + plotH}
                    stroke={CHART_AXIS} strokeWidth={1} />
                )}

                {/* series */}
                {series.map((s, si) => {
                  const color = s.color ?? slotColor(series.length === 1 ? 0 : si)
                  const pts = s.values.map((v, i) => [xAt(i), yAt(v)] as const)
                  if (pts.length === 0) return null
                  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ")
                  const areaD = `${line} L${pts[pts.length - 1][0].toFixed(2)} ${padTop + plotH} L${pts[0][0].toFixed(2)} ${padTop + plotH} Z`
                  return (
                    <g key={s.name}>
                      {showArea && <path d={areaD} fill={`url(#area-${uid}-${si})`} />}
                      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round"
                        strokeLinejoin="round" pathLength={1}
                        style={{ strokeDasharray: 1, strokeDashoffset: mounted ? 0 : 1, transition: "stroke-dashoffset 320ms ease-out" }} />
                      {/* endpoint marker (ringed) */}
                      {pts.length > 0 && (
                        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={4}
                          fill={color} stroke={SURFACE} strokeWidth={2}
                          style={{ opacity: mounted ? 1 : 0, transition: "opacity 200ms ease-out 260ms" }} />
                      )}
                      {/* active-point markers */}
                      {active != null && s.values[active] != null && (
                        <circle cx={xAt(active)} cy={yAt(s.values[active])} r={4} fill={color}
                          stroke={SURFACE} strokeWidth={2} />
                      )}
                    </g>
                  )
                })}

                {/* selective endpoint value label for a single series */}
                {series.length === 1 &&
                  series[0].values.length > 0 &&
                  (() => {
                    const last = series[0].values.length - 1
                    return (
                      <text x={xAt(last)} y={yAt(series[0].values[last]) - 10} fontSize={11}
                        fill="var(--text-2)" textAnchor="end" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {formatValue(series[0].values[last])}
                      </text>
                    )
                  })()}

                {/* keyboard hit targets, one per X */}
                {categories.map((c, i) => (
                  <rect key={`k${i}`} x={xAt(i) - Math.min(16, plotW / Math.max(n, 1) / 2)} y={padTop}
                    width={Math.min(32, plotW / Math.max(n, 1))} height={plotH} fill="transparent"
                    tabIndex={0} role="img"
                    aria-label={`${c}: ${series.map((s) => `${s.name} ${formatValue(s.values[i] ?? 0)}`).join(", ")}`}
                    onFocus={() => setActive(i)} onBlur={() => setActive(null)}
                    // .chart-hit, not an inline outline:none. The inline rule
                    // removed the focus ring and put nothing back, so every
                    // datum in this chart was a Tab stop you could not see
                    // (WCAG 2.4.7). The class carries the :focus-visible ring.
                    className="chart-hit" />
                ))}

                {/* pointer capture layer */}
                <rect x={padLeft} y={padTop} width={plotW} height={plotH} fill="transparent"
                  onPointerMove={onMove} onPointerLeave={() => setActive(null)} />
              </svg>

              {active != null && (
                <ChartTooltip
                  x={xAt(active)}
                  y={Math.min(...series.map((s) => yAt(s.values[active] ?? 0)))}
                  containerWidth={width}
                >
                  <TooltipHeader>{categories[active]}</TooltipHeader>
                  {series.map((s, si) => (
                    <TooltipRow key={s.name} color={s.color ?? slotColor(series.length === 1 ? 0 : si)}
                      name={s.name} value={formatValue(s.values[active] ?? 0)} shape="line" />
                  ))}
                </ChartTooltip>
              )}
            </>
          )
        )}
      </div>
    </div>
  )
}
