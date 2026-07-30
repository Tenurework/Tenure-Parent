/**
 * Number formatting + axis-tick helpers shared by every chart. Pure, so both
 * server pages (pre-computing series) and client charts can use them.
 */

/** Compact standalone value: 1,284 / 12.9K / 4.2M. */
export function formatCompact(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? "-" : ""
  if (abs >= 1_000_000) {
    const v = abs / 1_000_000
    return `${sign}${trim(v, abs >= 10_000_000 ? 0 : 1)}M`
  }
  if (abs >= 1_000) {
    const v = abs / 1_000
    return `${sign}${trim(v, abs >= 10_000 ? 0 : 1)}K`
  }
  return `${sign}${Math.round(abs)}`
}

/** Thousands-separated integer: 1,284. */
export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString("en-US")
}

function trim(v: number, digits: number): string {
  return v.toFixed(digits).replace(/\.0+$/, "")
}

/** Round a max up to a clean axis maximum (1 / 2 / 5 × 10ⁿ). */
export function niceMax(max: number): number {
  if (max <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(max)))
  const n = max / pow
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return nice * pow
}

/** Evenly spaced clean tick values from 0 to a nice max (inclusive). */
export function axisTicks(max: number, count = 4): number[] {
  const top = niceMax(max)
  const step = top / count
  return Array.from({ length: count + 1 }, (_, i) => i * step)
}
