/**
 * The date and time helpers a control plane needs, which are all about the fact
 * that a console operates in one timezone and its operators do not.
 *
 * ## Everything is UTC, and it says so
 *
 * A maintenance window entered as "02:00" by an operator in Auckland and read
 * as "02:00" by one in Denver is an outage. Every value this module produces is
 * UTC, every field built on it is labelled UTC in the interface, and the
 * conversion happens once, here, rather than in whichever component last needed
 * a Date.
 *
 * ## No Date parsing of user text
 *
 * `new Date("03/04/2026")` is March in one locale and April in another, and
 * `new Date("2026-03-04")` is UTC midnight while `new Date("2026-03-04T00:00")`
 * is local midnight — a difference of up to a day, decided by a character. So
 * the inputs are the platform's own `type="date"` and `type="time"`, whose
 * VALUES are always `YYYY-MM-DD` and `HH:MM` regardless of how they are
 * displayed, and this module assembles them arithmetically.
 */

/** `YYYY-MM-DD`, which is what an `<input type="date">` always submits. */
export const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
/** `HH:MM` or `HH:MM:SS`, which is what an `<input type="time">` always submits. */
export const TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/

export interface DateTimeProblem {
  field: "date" | "time"
  message: string
}

export type DateTimeResult =
  | { ok: true; iso: string; epochMs: number }
  | { ok: false; problems: readonly DateTimeProblem[] }

/**
 * Turn the two field values into one instant, or say exactly which half is
 * wrong.
 *
 * Returning the problems rather than throwing is what lets a server action put
 * the message on the field that caused it. A single "invalid date" under a pair
 * of inputs is a message that makes the operator check both.
 */
export function combineDateTime(date: string, time: string): DateTimeResult {
  const problems: DateTimeProblem[] = []
  const dateMatch = DATE_PATTERN.exec(date.trim())
  const timeMatch = TIME_PATTERN.exec(time.trim())
  if (!dateMatch) problems.push({ field: "date", message: "Enter a date as YYYY-MM-DD." })
  if (!timeMatch) problems.push({ field: "time", message: "Enter a time as HH:MM, in UTC." })
  if (!dateMatch || !timeMatch) return { ok: false, problems }

  const [, year, month, day] = dateMatch
  const [, hour, minute, second = "00"] = timeMatch
  const epochMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  )
  const instant = new Date(epochMs)
  // Date.UTC rolls over silently: month 13 becomes January of the next year and
  // the 31st of February becomes March. Round-tripping is what catches a value
  // that parsed but does not exist.
  const roundTripped =
    instant.getUTCFullYear() === Number(year) &&
    instant.getUTCMonth() === Number(month) - 1 &&
    instant.getUTCDate() === Number(day)
  if (!roundTripped) {
    return { ok: false, problems: [{ field: "date", message: "That date does not exist." }] }
  }
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    return { ok: false, problems: [{ field: "time", message: "That time does not exist." }] }
  }
  return { ok: true, iso: instant.toISOString(), epochMs }
}

/** The inverse: an ISO instant back into the two field values, in UTC. */
export function splitIso(iso: string): { date: string; time: string } | null {
  const epochMs = Date.parse(iso)
  if (Number.isNaN(epochMs)) return null
  const instant = new Date(epochMs)
  const pad = (n: number, width = 2) => String(n).padStart(width, "0")
  return {
    date: `${pad(instant.getUTCFullYear(), 4)}-${pad(instant.getUTCMonth() + 1)}-${pad(instant.getUTCDate())}`,
    time: `${pad(instant.getUTCHours())}:${pad(instant.getUTCMinutes())}`,
  }
}

/**
 * The instant as a console writes it: `2026-08-14 09:30 UTC`.
 *
 * Not `toLocaleString`. A machine-readable, sortable, unambiguous stamp is what
 * an operator pastes into a ticket, and the locale-formatted version is the one
 * that says 8/14 to one reader and 14/8 to another.
 */
export function formatUtc(iso: string): string | null {
  const parts = splitIso(iso)
  return parts ? `${parts.date} ${parts.time} UTC` : null
}
