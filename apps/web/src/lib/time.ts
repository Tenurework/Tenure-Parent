/**
 * The one time authority for Tenure.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * Instants are stored in UTC (Prisma `DateTime`) and are ALWAYS rendered in the
 * institution's own timezone. Never render a stored instant with
 * `timeZone: "UTC"` and never position a calendar element with `getUTCHours()`.
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 * The calendar previously did exactly that: it formatted every event with
 * `timeZone: "UTC"` and placed it on the hour grid by `getUTCHours()`. Because
 * `new Date("2026-09-05T18:00")` from a `datetime-local` input parses as *local*
 * time, an event a Rochester officer entered as 6:00 PM was stored correctly as
 * 22:00Z — and then displayed as "10:00 PM". The ICS feed, which emits the true
 * instant, told Outlook 6:00 PM. Tenure disagreed with the calendar feed it
 * publishes, and the now-line sat four hours from the actual time.
 *
 * Everything here is built on `Intl.DateTimeFormat`, which ships with Node and
 * every browser and carries the full IANA database including DST history — so
 * there is no dependency and no rule table to maintain.
 *
 * Multi-tenancy: the zone is a property of the Institution, never a hardcoded
 * constant, so a second institution in another region is a data change.
 */

/** Fallback when an institution has not set one (Tenure's launch institution). */
export const DEFAULT_TIME_ZONE = "America/New_York"

export interface ZonedParts {
  year: number
  month: number // 1-12
  day: number // 1-31
  hour: number // 0-23
  minute: number
  second: number
}

// Intl.DateTimeFormat construction is comparatively expensive and the calendar
// calls these helpers once per event per render, so formatters are memoised.
const partsFormatters = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    partsFormatters.set(timeZone, f)
  }
  return f
}

/** Validate an IANA zone, falling back rather than throwing on bad tenant data. */
export function safeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return DEFAULT_TIME_ZONE
  try {
    new Intl.DateTimeFormat("en-US", { timeZone })
    return timeZone
  } catch {
    return DEFAULT_TIME_ZONE
  }
}

/** The wall-clock reading of an instant in a zone. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const out: Record<string, string> = {}
  for (const p of partsFormatter(timeZone).formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = p.value
  }
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    // Some ICU builds report midnight as hour 24 under h23; normalise it.
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
  }
}

/** The zone's UTC offset in milliseconds at a given instant (DST-aware). */
export function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone)
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  // Parts carry no milliseconds, so compare against a second-truncated instant.
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000
}

/**
 * The inverse of `zonedParts`: a wall-clock reading in a zone → the UTC instant.
 * This is what a `datetime-local` form field means — "6:00 PM here".
 *
 * Two passes, because the offset depends on the answer: guess with the offset at
 * the naive instant, then re-derive it at the corrected instant. That settles
 * every case except the one hour that does not exist on a spring-forward day,
 * where the result lands just after the gap — the standard, safe behaviour.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  let ts = naive - zoneOffsetMs(new Date(naive), timeZone)
  ts = naive - zoneOffsetMs(new Date(ts), timeZone)
  return new Date(ts)
}

/** "YYYY-MM-DD" for the instant's calendar day in the zone. */
export function dateKeyInZone(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone)
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
}

/** Minutes elapsed since local midnight — the calendar grid's y-axis unit. */
export function minutesOfDayInZone(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone)
  return p.hour * 60 + p.minute
}

/** Day of week in the zone, 0 = Sunday — for finding the start of the week. */
export function weekdayInZone(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone)
  // Date.UTC of the local wall-clock reading gives the right weekday index.
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
}

/** Today's "YYYY-MM-DD" in the zone. */
export function todayKeyInZone(timeZone: string, now: Date = new Date()): string {
  return dateKeyInZone(now, timeZone)
}

/** Parse a "YYYY-MM-DD" key into its numeric parts. Null when malformed. */
export function parseDateKey(key: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  // Reject well-formed-but-impossible dates such as 2026-02-31.
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null
  return { year, month, day }
}

/** Midnight (in the zone) of a date key, as a UTC instant. */
export function startOfDayInZone(key: string, timeZone: string): Date | null {
  const p = parseDateKey(key)
  if (!p) return null
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, timeZone)
}

/** Shift a date key by whole days. Calendar-safe across DST (no ms arithmetic). */
export function addDaysToKey(key: string, days: number): string {
  const p = parseDateKey(key)
  if (!p) return key
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day))
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** The Sunday on or before a date key. */
export function startOfWeekKey(key: string): string {
  const p = parseDateKey(key)
  if (!p) return key
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day))
  return addDaysToKey(key, -d.getUTCDay())
}

/** Format an instant in the institution's zone. The only formatter callers need. */
export function formatInZone(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(date)
}

/** Format a bare date key (no instant, no zone shift) — e.g. a day heading. */
export function formatDateKey(key: string, options: Intl.DateTimeFormatOptions): string {
  const p = parseDateKey(key)
  if (!p) return key
  // Render the key's own numbers by pinning the formatter to UTC against a
  // UTC-constructed date; this is display of a *date*, not of an instant.
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(
    new Date(Date.UTC(p.year, p.month - 1, p.day))
  )
}

/**
 * The value a `datetime-local` input expects ("YYYY-MM-DDTHH:mm"), rendered in
 * the institution's zone so the field shows the officer the same time the
 * calendar does.
 */
export function toDateTimeLocalValue(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/**
 * Read a `datetime-local` field as institution-local wall-clock time.
 *
 * `new Date("2026-09-05T18:00")` silently means "18:00 in whatever zone the
 * *server* happens to run in" — which in production is UTC, so every event an
 * officer filed shifted by the offset. Always parse through here.
 */
export function parseDateTimeLocal(value: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h, mi] = m
  const key = parseDateKey(`${y}-${mo}-${d}`)
  if (!key) return null
  const hour = Number(h)
  const minute = Number(mi)
  if (hour > 23 || minute > 59) return null
  return zonedTimeToUtc(key.year, key.month, key.day, hour, minute, timeZone)
}

/** Short zone label for the UI, e.g. "EDT" — so times are never ambiguous. */
export function zoneAbbreviation(timeZone: string, date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(date)
  return parts.find((p) => p.type === "timeZoneName")?.value ?? ""
}
