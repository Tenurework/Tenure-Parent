"use client"

import { scaleDisclosure } from "./chart-integrity"
import { useMeasuredWidth, useMounted } from "./hooks"

/**
 * A bare trend sparkline for stat tiles — no axes, no labels, one series. Uses
 * the slot-1 hue by default; a ~10% wash under the line and a ringed end marker.
 * Measured in real pixels so the line and end dot stay crisp at any width.
 *
 * GE-143-033 — the scale is min–max, and it SAYS SO. Thirty-four pixels of
 * height cannot show a 100-to-101 change against a zero baseline at all, so
 * min–max is the right scale here; what was wrong was that nothing disclosed it.
 * A series of 100, 100, 101 drew a full-height climb behind `aria-hidden`, which
 * is a 101× exaggeration a sighted reader could not check and a screen-reader
 * user was not offered. `scaleDisclosure` computes the sentence, the `<title>`
 * carries it to hover and to assistive technology, and the SVG is `role="img"`
 * with that label instead of being hidden outright.
 */
export function Sparkline({
  values,
  height = 34,
  color = "var(--chart-1)",
  className,
  labelPrefix,
}: {
  values: number[]
  height?: number
  color?: string
  className?: string
  /** What the series is OF, so the accessible label names it. */
  labelPrefix?: string
}) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>()
  const mounted = useMounted()

  if (!values || values.length < 2) {
    return <div ref={ref} className={className} style={{ height }} />
  }

  const pad = 3
  const w = Math.max(0, width)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  // The same floor the geometry below uses, so the sentence describes the line
  // that was actually drawn rather than one this component might have drawn.
  const disclosure = scaleDisclosure(values, min)
  const label = `${labelPrefix ? `${labelPrefix}. ` : ""}Trend of ${values.length} points. ${disclosure.sentence}`

  const pts = values.map((v, i) => {
    const x = values.length > 1 ? (i / (values.length - 1)) * (w - pad * 2) + pad : w / 2
    const y = height - pad - ((v - min) / span) * (height - pad * 2)
    return [x, y] as const
  })

  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ")
  const area = `${line} L${pts[pts.length - 1][0].toFixed(2)} ${height} L${pts[0][0].toFixed(2)} ${height} Z`
  const end = pts[pts.length - 1]

  return (
    <div ref={ref} className={className} style={{ height }}>
      {w > 0 && (
        <svg
          width={w}
          height={height}
          viewBox={`0 0 ${w} ${height}`}
          role="img"
          aria-label={label}
          data-scale-truncated={disclosure.truncated ? "true" : "false"}
        >
          <title>{label}</title>
          <path d={area} fill={color} opacity={0.1} />
          <path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            style={{
              strokeDasharray: 1,
              strokeDashoffset: mounted ? 0 : 1,
              transition: "stroke-dashoffset 400ms ease-out",
            }}
          />
          <circle cx={end[0]} cy={end[1]} r={2.5} fill={color} stroke="var(--bg-surface)" strokeWidth={1.5} />
        </svg>
      )}
    </div>
  )
}
