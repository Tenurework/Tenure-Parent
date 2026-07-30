"use client"

import { useMeasuredWidth, useMounted } from "./hooks"

/**
 * A bare trend sparkline for stat tiles — no axes, no labels, one series. Uses
 * the slot-1 hue by default; a ~10% wash under the line and a ringed end marker.
 * Measured in real pixels so the line and end dot stay crisp at any width.
 */
export function Sparkline({
  values,
  height = 34,
  color = "var(--chart-1)",
  className,
}: {
  values: number[]
  height?: number
  color?: string
  className?: string
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
        <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} aria-hidden>
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
