/**
 * The arithmetic behind a chart, separated from the drawing of one.
 *
 * A chart is the component where a wrong number looks exactly like a right one:
 * a mis-scaled axis, a domain that excludes the maximum, a path whose last
 * point is off the box — none of them throws, and none of them is visible in a
 * screenshot unless you already know the answer. So the numbers are computed
 * here, where they can be asserted against known inputs, and `Chart.tsx` only
 * turns them into elements.
 */

export interface ChartPoint {
  /** The x value. An epoch millisecond for a time series, or an index. */
  x: number
  /** The y value, in the chart's unit. `null` is a genuine gap, not a zero. */
  y: number | null
}

export interface ChartSeries {
  key: string
  label: string
  points: readonly ChartPoint[]
}

export interface Box {
  width: number
  height: number
  /** Room for the axis labels. */
  padTop: number
  padRight: number
  padBottom: number
  padLeft: number
}

export const DEFAULT_BOX: Box = {
  width: 640,
  height: 220,
  padTop: 8,
  padRight: 8,
  padBottom: 24,
  padLeft: 56,
}

export interface Domain {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * The domain of every series together, with `null` points excluded.
 *
 * Excluded, not treated as zero. A gap in a cost series is "we did not read
 * this hour", and drawing it as zero is the component inventing a fact — which
 * is the specific failure `UnknownState` exists to prevent elsewhere in this
 * console.
 */
export function domainOf(series: readonly ChartSeries[]): Domain | null {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let seen = false
  for (const one of series) {
    for (const point of one.points) {
      if (point.y === null || !Number.isFinite(point.y)) continue
      seen = true
      minX = Math.min(minX, point.x)
      maxX = Math.max(maxX, point.x)
      minY = Math.min(minY, point.y)
      maxY = Math.max(maxY, point.y)
    }
  }
  if (!seen) return null
  // A flat series has zero height, which would divide by zero and draw a line
  // through the top of the box. Widening by one unit puts it in the middle,
  // which is what it is.
  if (minY === maxY) {
    minY -= 1
    maxY += 1
  }
  if (minX === maxX) maxX = minX + 1
  return { minX, maxX, minY, maxY }
}

/**
 * Axis ticks at 1, 2 or 5 times a power of ten, covering the domain.
 *
 * `Math.ceil(range / count)` — the version everyone writes first — produces
 * ticks at 7, 14, 21, which nobody reads. This produces 0, 5, 10, 15, which
 * everybody does. The returned ticks may extend past the domain on both sides;
 * that is deliberate, because an axis that stops at 97 makes 97 look like a
 * limit.
 *
 * The step is chosen by rounding the raw step to the NEAREST of 1, 2, 5 or 10
 * in log space (the thresholds are the geometric means, √2, √10 and √50), not
 * by rounding up. Rounding up is the version that turns a request for four
 * ticks over 0–100 into two of them, 50 apart, on a chart 220 pixels tall —
 * technically nice numbers, and a useless axis.
 */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || count < 1) return []
  if (min === max) return [min]
  const rawStep = (max - min) / count
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const normalized = rawStep / magnitude
  const step =
    (normalized >= Math.sqrt(50) ? 10 : normalized >= Math.sqrt(10) ? 5 : normalized >= Math.SQRT2 ? 2 : 1) *
    magnitude
  const first = Math.floor(min / step) * step
  // Out to the tick at or beyond the maximum, not to the last one below it: an
  // axis whose top gridline is under the highest reading draws the line above
  // the chart's own scale.
  const last = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let value = first; value <= last + step / 2; value += step) {
    // Floating-point addition drifts: 0.1 + 0.2 + 0.3 is not 0.6, and a tick
    // labelled 0.6000000000000001 is a chart nobody trusts again.
    ticks.push(Number(value.toPrecision(12)))
  }
  return ticks
}

/** A domain value to an x pixel inside the plotting area. */
export function scaleX(value: number, domain: Domain, box: Box): number {
  const span = domain.maxX - domain.minX || 1
  const inner = box.width - box.padLeft - box.padRight
  return box.padLeft + ((value - domain.minX) / span) * inner
}

/** A domain value to a y pixel. Inverted, because SVG y grows downward. */
export function scaleY(value: number, domain: Domain, box: Box): number {
  const span = domain.maxY - domain.minY || 1
  const inner = box.height - box.padTop - box.padBottom
  return box.padTop + inner - ((value - domain.minY) / span) * inner
}

/**
 * A series as SVG path data, with gaps as gaps.
 *
 * A `null` point starts a new subpath (`M`) rather than being skipped, so a
 * missing hour leaves a break in the line instead of a straight segment across
 * it. The straight segment is the one that gets read as "flat", which is the
 * opposite of "unknown".
 */
export function seriesPath(points: readonly ChartPoint[], domain: Domain, box: Box): string {
  const parts: string[] = []
  let penDown = false
  for (const point of points) {
    if (point.y === null || !Number.isFinite(point.y)) {
      penDown = false
      continue
    }
    const x = scaleX(point.x, domain, box).toFixed(2)
    const y = scaleY(point.y, domain, box).toFixed(2)
    parts.push(`${penDown ? "L" : "M"}${x},${y}`)
    penDown = true
  }
  return parts.join(" ")
}

/**
 * The sentence a screen reader hears instead of the picture.
 *
 * First value, last value, direction, minimum and maximum, and the number of
 * gaps — which is the reading a sighted operator takes from the shape in about
 * a second. Without it `role="img"` is an image with a name and no content.
 */
export function describeSeries(series: ChartSeries, unit: string): string {
  const values = series.points.filter((p): p is ChartPoint & { y: number } => p.y !== null)
  const gaps = series.points.length - values.length
  if (values.length === 0) return `${series.label}: no readings.`
  const first = values[0].y
  const last = values[values.length - 1].y
  const min = Math.min(...values.map((p) => p.y))
  const max = Math.max(...values.map((p) => p.y))
  const direction = last > first ? "rising" : last < first ? "falling" : "flat"
  const gapNote = gaps ? ` ${gaps} reading${gaps === 1 ? "" : "s"} missing.` : ""
  return (
    `${series.label}: ${direction}, from ${first} to ${last} ${unit}. ` +
    `Lowest ${min}, highest ${max}.${gapNote}`
  )
}
