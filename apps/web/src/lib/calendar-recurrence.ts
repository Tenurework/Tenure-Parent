import { addDaysToKey, parseDateKey, startOfWeekKey, zonedParts, zonedTimeToUtc } from "@/lib/time"

/**
 * WRK-060-005 — recurrence, for the subset `Event.recurrenceRule` promises.
 *
 * `apps/web/prisma/schema.prisma` has carried `recurrenceRule String? // RFC
 * 5545 RRULE` since the baseline migration, and until this module existed
 * nothing wrote it, nothing read it and no feed emitted it. A column that
 * exists and does nothing is worse than an absent one: it reads, to anybody
 * auditing the schema, exactly like support for weekly meetings.
 *
 * ## The subset, and why it is a subset
 *
 * `FREQ=DAILY|WEEKLY|MONTHLY`, `INTERVAL`, `COUNT`, `UNTIL`, `BYDAY`. That is
 * what a student club needs — "every Tuesday", "the first three Mondays",
 * "monthly until finals" — and every one of those parts changes which
 * occurrences exist, so every one is honoured rather than parsed and ignored.
 *
 * **An unrecognised part is a refusal, not a shrug.** `FREQ=WEEKLY;BYSETPOS=-1`
 * means "the last one of the week"; a parser that skipped the part it did not
 * know would return every day of the week instead and be confidently wrong.
 * `parseRecurrenceRule` returns `null` for anything outside the subset, and
 * both callers treat `null` as "not a recurring event" — the feed emits no
 * `RRULE` line and the grid shows only the stored occurrence. Silence beats a
 * fabricated schedule.
 *
 * `COUNT` and `UNTIL` together are refused for the same reason: RFC 5545 §3.3.10
 * makes them mutually exclusive, so a rule carrying both was produced by
 * something that does not know what it meant, and guessing which one wins is
 * guessing which meetings a club has.
 *
 * ## Why the zone is a parameter
 *
 * A weekly 6pm meeting is 6pm on both sides of a daylight-saving boundary, and
 * it is a DIFFERENT number of milliseconds after the previous one across that
 * boundary. Expansion therefore walks calendar days as wall-clock keys and
 * re-resolves each occurrence through `zonedTimeToUtc`, never by adding
 * `7 * 864e5` to an instant. `expandOccurrences` takes the zone rather than
 * looking it up so this module imports no database: `loadScopedEvents` resolves
 * it through `institution-time.ts` (which does) and passes it in, and the unit
 * test imports this file directly.
 */

export type Weekday = "SU" | "MO" | "TU" | "WE" | "TH" | "FR" | "SA"

/** Index order matters: it is the offset from the Sunday that starts a week. */
const WEEKDAYS: readonly Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]

export interface RecurrenceRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY"
  /** Whole periods between occurrences. Always >= 1; absent INTERVAL means 1. */
  interval: number
  /** Total occurrences INCLUDING the first. `null` when the rule is open-ended. */
  count: number | null
  /** Last instant an occurrence may start at, inclusive. `null` when open-ended. */
  until: Date | null
  /**
   * Weekdays the rule fires on, in Sunday-first order and deduplicated.
   *
   * Empty means "the weekday DTSTART falls on" for `WEEKLY`, and "every day in
   * the period" for `DAILY` / `MONTHLY`.
   */
  byDay: readonly Weekday[]
}

/**
 * A stored `recurrenceRule` string, or `null` if it is not one this can honour.
 *
 * Accepts the bare property list (`FREQ=WEEKLY;BYDAY=TU`) and the full content
 * line (`RRULE:FREQ=WEEKLY;BYDAY=TU`), because both spellings turn up in
 * exports from real calendar products and refusing one of them would refuse a
 * rule Tenure itself round-trips.
 */
export function parseRecurrenceRule(raw: string | null | undefined): RecurrenceRule | null {
  if (typeof raw !== "string") return null
  const body = raw.trim().replace(/^RRULE\s*:/i, "").trim()
  if (!body) return null

  let freq: RecurrenceRule["freq"] | null = null
  let interval = 1
  let count: number | null = null
  let until: Date | null = null
  let byDay: Weekday[] = []

  for (const part of body.split(";")) {
    if (!part.trim()) continue
    const eq = part.indexOf("=")
    if (eq <= 0) return null
    const name = part.slice(0, eq).trim().toUpperCase()
    const value = part.slice(eq + 1).trim()

    switch (name) {
      case "FREQ": {
        const v = value.toUpperCase()
        if (v !== "DAILY" && v !== "WEEKLY" && v !== "MONTHLY") return null
        freq = v
        break
      }
      case "INTERVAL": {
        if (!/^\d+$/.test(value)) return null
        interval = Number(value)
        // Zero would make expansion stand still; a four-figure interval is
        // somebody's fuzzer, not a club meeting.
        if (interval < 1 || interval > 999) return null
        break
      }
      case "COUNT": {
        if (!/^\d+$/.test(value)) return null
        count = Number(value)
        if (count < 1 || count > MAX_OCCURRENCES) return null
        break
      }
      case "UNTIL": {
        const parsed = parseUntil(value)
        if (!parsed) return null
        until = parsed
        break
      }
      case "BYDAY": {
        const days: Weekday[] = []
        for (const token of value.split(",")) {
          const day = token.trim().toUpperCase()
          // No ordinal prefixes ("2MO" = the second Monday). They are real RFC
          // 5545 and this does not implement them, so they are refused rather
          // than read as a plain Monday — which would be four meetings a month
          // where the rule asked for one.
          if (!WEEKDAYS.includes(day as Weekday)) return null
          if (!days.includes(day as Weekday)) days.push(day as Weekday)
        }
        if (days.length === 0) return null
        byDay = days
        break
      }
      default:
        // BYSETPOS, BYMONTHDAY, BYMONTH, WKST, RSCALE… Every one of them
        // changes the answer, and none of them is implemented here.
        return null
    }
  }

  if (!freq) return null
  if (count !== null && until !== null) return null

  byDay.sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b))
  return { freq, interval, count, until, byDay }
}

/** `UNTIL` is a DATE or a UTC DATE-TIME. A floating DATE-TIME is not accepted. */
function parseUntil(value: string): Date | null {
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value)
  if (dateOnly) {
    const [, y, m, d] = dateOnly
    if (!parseDateKey(`${y}-${m}-${d}`)) return null
    // End of that day, so `UNTIL=20261231` includes an occurrence on the 31st.
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 23, 59, 59, 999))
  }
  const utc = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value)
  if (!utc) return null
  const [, y, m, d, hh, mm, ss] = utc
  if (!parseDateKey(`${y}-${m}-${d}`)) return null
  if (Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 60) return null
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)))
}

/**
 * The canonical `RRULE` property list for a parsed rule.
 *
 * `eventsToICS` emits this rather than the stored string so a subscriber never
 * receives a rule Tenure could not itself expand — the feed and the grid then
 * describe the same meetings, which is the only property that makes the two
 * comparable at all. Parts are written in RFC 5545's own order and `INTERVAL=1`
 * is omitted, because it is the default and a redundant part is one more thing
 * for a client to disagree about.
 */
export function formatRecurrenceRule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.freq}`]
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`)
  if (rule.byDay.length > 0) parts.push(`BYDAY=${rule.byDay.join(",")}`)
  if (rule.count !== null) parts.push(`COUNT=${rule.count}`)
  if (rule.until !== null) parts.push(`UNTIL=${icsUtcStamp(rule.until)}`)
  return parts.join(";")
}

function icsUtcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}

/**
 * The ceiling on how many occurrences one rule may ever produce.
 *
 * An open-ended daily rule is unbounded by definition, so something has to stop
 * the walk. Two years of daily meetings is past any window this product asks
 * for and small enough that a crafted `INTERVAL=1;FREQ=DAILY` cannot turn one
 * feed request into a heap exhaustion.
 */
export const MAX_OCCURRENCES = 750

export interface Occurrence {
  /** 0 for DTSTART itself, then 1, 2, … in chronological order. */
  index: number
  startAt: Date
  endAt: Date
}

/**
 * Every occurrence of `rule` that starts inside `[windowStart, windowEnd)`.
 *
 * The stored event's own start is occurrence 0 — RFC 5545 says DTSTART is
 * always the first instance even when `BYDAY` does not name its weekday — and
 * later instances are generated on the days the rule selects, at DTSTART's
 * wall-clock time in `timeZone`.
 *
 * `COUNT` is counted from DTSTART, not from `windowStart`: a five-occurrence
 * series viewed in its fourth week must show one meeting, not five. The walk
 * therefore always begins at the seed and skips forward, which is also why it
 * carries its own iteration ceiling.
 */
export function expandOccurrences(input: {
  start: Date
  end: Date
  rule: RecurrenceRule
  timeZone: string
  windowStart: Date
  windowEnd: Date
}): Occurrence[] {
  const { start, end, rule, timeZone, windowStart, windowEnd } = input
  const durationMs = end.getTime() - start.getTime()
  if (!Number.isFinite(durationMs) || durationMs < 0) return []

  const seed = zonedParts(start, timeZone)
  const seedKey = `${seed.year}-${pad(seed.month)}-${pad(seed.day)}`
  const at = (key: string): Date | null => {
    const p = parseDateKey(key)
    if (!p) return null
    return zonedTimeToUtc(p.year, p.month, p.day, seed.hour, seed.minute, timeZone)
  }

  const out: Occurrence[] = []
  let index = 0
  const limit = rule.count ?? MAX_OCCURRENCES

  for (const key of candidateDayKeys(rule, seedKey)) {
    if (index >= limit) break
    const startAt = at(key)
    if (!startAt) continue
    // Days the rule selects before DTSTART are not occurrences: a Monday /
    // Wednesday rule seeded on the Wednesday starts on that Wednesday.
    if (startAt.getTime() < start.getTime()) continue
    if (rule.until && startAt.getTime() > rule.until.getTime()) break

    const occurrence: Occurrence = {
      index,
      startAt,
      endAt: new Date(startAt.getTime() + durationMs),
    }
    index += 1

    // Past the window and monotonically increasing — nothing later can land
    // inside it, and COUNT has already been honoured for everything before.
    if (startAt.getTime() >= windowEnd.getTime()) break
    if (startAt.getTime() >= windowStart.getTime()) out.push(occurrence)
  }

  return out
}

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

/**
 * The day keys the rule selects, in order, starting at the seed's period.
 *
 * A generator so an open-ended rule costs one day key at a time and the caller
 * stops it the moment the window is passed. It yields at most
 * `MAX_OCCURRENCES` keys per period family so a rule whose every candidate is
 * filtered out still terminates.
 */
function* candidateDayKeys(rule: RecurrenceRule, seedKey: string): Generator<string> {
  const selected = new Set(rule.byDay)
  let emitted = 0

  if (rule.freq === "DAILY") {
    let key = seedKey
    for (let step = 0; step < MAX_OCCURRENCES * 4 && emitted < MAX_OCCURRENCES; step += 1) {
      if (selected.size === 0 || selected.has(weekdayOfKey(key))) {
        emitted += 1
        yield key
      }
      key = addDaysToKey(key, rule.interval)
    }
    return
  }

  if (rule.freq === "WEEKLY") {
    // Anchored on the week START, not on the seed day, so `INTERVAL=2` means
    // "every other week" rather than "every fourteen days from Wednesday" —
    // the two disagree the moment BYDAY names a day before the seed's.
    const days = selected.size > 0 ? [...selected] : [weekdayOfKey(seedKey)]
    let weekStart = startOfWeekKey(seedKey)
    for (let week = 0; week < MAX_OCCURRENCES && emitted < MAX_OCCURRENCES; week += 1) {
      for (const day of WEEKDAYS) {
        if (!days.includes(day)) continue
        emitted += 1
        yield addDaysToKey(weekStart, WEEKDAYS.indexOf(day))
        if (emitted >= MAX_OCCURRENCES) break
      }
      weekStart = addDaysToKey(weekStart, 7 * rule.interval)
    }
    return
  }

  // MONTHLY. With BYDAY it is every named weekday in the month; without it, the
  // seed's day-of-month. A month with no 31st simply has no occurrence — which
  // is RFC 5545's rule, and is why this walks months rather than adding days.
  const seed = parseDateKey(seedKey)
  if (!seed) return
  for (let month = 0; month < MAX_OCCURRENCES && emitted < MAX_OCCURRENCES; month += 1) {
    const total = seed.month - 1 + month * rule.interval
    const year = seed.year + Math.floor(total / 12)
    const monthNo = (total % 12) + 1
    if (selected.size === 0) {
      const key = `${year}-${pad(monthNo)}-${pad(seed.day)}`
      if (parseDateKey(key)) {
        emitted += 1
        yield key
      }
      continue
    }
    for (let day = 1; day <= 31; day += 1) {
      const key = `${year}-${pad(monthNo)}-${pad(day)}`
      if (!parseDateKey(key)) continue
      if (!selected.has(weekdayOfKey(key))) continue
      emitted += 1
      yield key
      if (emitted >= MAX_OCCURRENCES) break
    }
  }
}

/** The weekday a "YYYY-MM-DD" key falls on. Zone-free: a date key has no zone. */
function weekdayOfKey(key: string): Weekday {
  const p = parseDateKey(key)
  if (!p) return "SU"
  return WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()]
}
