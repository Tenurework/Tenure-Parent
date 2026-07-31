/**
 * Pure time-bucketing helpers. Server pages call these to pre-compute sparkline
 * and trend series from raw timestamps; the reports client dashboard calls them
 * to re-aggregate serialised rows as the range filter changes. No React, no
 * client-only APIs, so the module is safe on both sides of the boundary.
 */

const DAY = 86_400_000
const WEEK = 7 * DAY

/** Local start-of-day. */
export function startOfDay(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

/** Local start-of-month. */
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

/**
 * Start of the current academic term, used by the "This term" range preset.
 * Fall = Aug–Dec, Spring = Jan–May, Summer = Jun–Jul.
 */
export function startOfTerm(now: Date = new Date()): Date {
  const m = now.getMonth() // 0 = Jan
  const y = now.getFullYear()
  if (m >= 7) return new Date(y, 7, 1) // Aug
  if (m >= 5) return new Date(y, 5, 1) // Jun (summer)
  return new Date(y, 0, 1) // Jan
}

/** Count of dates falling in each of the last `weeks` weeks, oldest → newest. */
export function bucketByWeek(dates: Date[], weeks: number, now: Date = new Date()): number[] {
  const end = startOfDay(now).getTime() + DAY // exclusive upper bound (today included)
  const start = end - weeks * WEEK
  const buckets = new Array(weeks).fill(0)
  for (const d of dates) {
    const t = d.getTime()
    if (t < start || t >= end) continue
    const idx = Math.floor((t - start) / WEEK)
    if (idx >= 0 && idx < weeks) buckets[idx]++
  }
  return buckets
}

/** Count of dates per day over the last `days` days, oldest → newest. */
export function bucketByDay(
  dates: Date[],
  days: number,
  now: Date = new Date()
): { label: string; value: number }[] {
  const today = startOfDay(now)
  const start = today.getTime() - (days - 1) * DAY
  const buckets = new Array(days).fill(0)
  for (const d of dates) {
    const t = startOfDay(d).getTime()
    const idx = Math.round((t - start) / DAY)
    if (idx >= 0 && idx < days) buckets[idx]++
  }
  return buckets.map((value, i) => {
    const day = new Date(start + i * DAY)
    return { label: day.toLocaleDateString("en-US", { month: "short", day: "numeric" }), value }
  })
}

/**
 * Count of dates per month between `from` (inclusive) and `now`, oldest → newest.
 * When `from` is null, spans from the earliest date present (min one month).
 */
export function bucketByMonth(
  dates: Date[],
  from: Date | null,
  now: Date = new Date()
): { label: string; value: number }[] {
  if (dates.length === 0 && !from) return []
  const end = startOfMonth(now)
  let start = from ? startOfMonth(from) : end
  if (!from) {
    for (const d of dates) {
      const m = startOfMonth(d)
      if (m < start) start = m
    }
  }
  const months: { key: number; label: string; value: number }[] = []
  const cursor = new Date(start)
  // Cap runaway ranges so an ancient stray record can't produce hundreds of bars.
  let guard = 0
  while (cursor <= end && guard < 240) {
    months.push({
      key: cursor.getFullYear() * 12 + cursor.getMonth(),
      label: cursor.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      value: 0,
    })
    cursor.setMonth(cursor.getMonth() + 1)
    guard++
  }
  const index = new Map(months.map((m, i) => [m.key, i]))
  for (const d of dates) {
    const key = d.getFullYear() * 12 + d.getMonth()
    const i = index.get(key)
    if (i != null) months[i].value++
  }
  return months.map((m) => ({ label: m.label, value: m.value }))
}

/** Signed percent change of the last bucket vs the previous one. */
export function trendDelta(series: number[]): { direction: "up" | "down" | "flat"; pct: number } {
  if (series.length < 2) return { direction: "flat", pct: 0 }
  const last = series[series.length - 1]
  const prev = series[series.length - 2]
  if (prev === 0 && last === 0) return { direction: "flat", pct: 0 }
  if (prev === 0) return { direction: "up", pct: 100 }
  const pct = Math.round(((last - prev) / prev) * 100)
  return { direction: pct > 0 ? "up" : pct < 0 ? "down" : "flat", pct: Math.abs(pct) }
}

/**
 * Bucket dates FORWARD from today into `weeks` weekly buckets.
 *
 * `bucketByWeek` looks backwards and treats end-of-today as an exclusive upper
 * bound, so it silently discards every future timestamp. That makes it the
 * wrong tool for a forward-looking tile: the dashboard's "Upcoming Events"
 * counted events with startAt >= now, then charted them with the backward
 * bucketer, so the sparkline was structurally all zeros underneath a non-zero
 * count — and the trend chip read "0%" no matter what was scheduled.
 *
 * Bucket 0 is the next seven days, bucket 1 the seven after that, and so on.
 */
export function bucketByWeekForward(dates: Date[], weeks: number, now: Date = new Date()): number[] {
  const start = startOfDay(now).getTime()
  const end = start + weeks * WEEK
  const buckets = new Array(weeks).fill(0)
  for (const d of dates) {
    const t = d.getTime()
    if (t < start || t >= end) continue
    const idx = Math.floor((t - start) / WEEK)
    if (idx >= 0 && idx < weeks) buckets[idx]++
  }
  return buckets
}
