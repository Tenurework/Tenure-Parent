/**
 * GE-022-004 — the business calendar.
 *
 * Every deadline in the product is currently counted in calendar days. A
 * request submitted on Friday afternoon is two days old on Sunday and flagged
 * for attention on Monday morning, before anyone could have looked at it. The
 * SLA is measuring the weekend.
 *
 * Two things make a working day: which weekdays the institution works, and
 * which dates it does not. Both are configuration, because neither is universal
 * — Friday and Saturday are the weekend across much of the Gulf, and an
 * academic institution's closures are its own.
 *
 * Pure and dependency-free, like `money.ts` and for the same reason: the
 * approvals list is a client component, and reaching `@tenure/configuration`
 * from here would drag `node:crypto` into a browser bundle.
 */

export interface BusinessCalendar {
  /**
   * Days the institution works, as `Date.getUTCDay()` numbers: 0 = Sunday.
   *
   * A list rather than a "weekend starts on" index, because a four-day week and
   * a split weekend are both real and neither can be written as one number.
   */
  workingDays: readonly number[]
  /**
   * Dates the institution is closed, as `YYYY-MM-DD`.
   *
   * Plain date strings, not `Date`s: a holiday is a date in the institution's
   * own calendar, and the instant it starts depends on a time zone that is not
   * this function's business. Storing instants here is how a holiday lands on
   * the wrong day for half the users.
   */
  holidays: readonly string[]
}

/** Monday to Friday, no closures. The assumption the code made implicitly. */
export const DEFAULT_BUSINESS_CALENDAR: BusinessCalendar = {
  workingDays: [1, 2, 3, 4, 5],
  holidays: [],
}

/** `YYYY-MM-DD` for a date, in UTC. */
export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function isWorkingDay(date: Date, calendar: BusinessCalendar = DEFAULT_BUSINESS_CALENDAR): boolean {
  if (!calendar.workingDays.includes(date.getUTCDay())) return false
  return !calendar.holidays.includes(dateKey(date))
}

/**
 * Working days from `from` to `to`, counting neither endpoint twice.
 *
 * Counts the days STARTED, which is what an SLA means: something submitted
 * Monday and still open Tuesday is one working day old, not zero. Returns 0
 * rather than a negative for a `to` before `from` — a clock that runs backwards
 * produces an "overdue" flag on something submitted in the future, and silently.
 */
export function businessDaysBetween(
  from: Date,
  to: Date,
  calendar: BusinessCalendar = DEFAULT_BUSINESS_CALENDAR,
): number {
  if (to <= from) return 0

  // Iterating by day rather than arithmetic on the difference, because the
  // holiday list makes the answer non-uniform: two spans of the same length can
  // hold a different number of working days.
  let count = 0
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()))

  // A guard, not a limit anyone should hit: an unbounded loop over a corrupt
  // date is a hung request rather than an error anyone can see.
  let guard = 0
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    if (isWorkingDay(cursor, calendar)) count++
    if (++guard > 4000) {
      throw new Error("businessDaysBetween: span exceeds ten years — check the dates")
    }
  }
  return count
}

/**
 * `n` working days after `date`.
 *
 * `n = 0` returns the next working day if `date` itself is not one, rather than
 * a closure day. A due date that lands on a holiday is a due date nobody can
 * meet.
 */
export function addBusinessDays(
  date: Date,
  n: number,
  calendar: BusinessCalendar = DEFAULT_BUSINESS_CALENDAR,
): Date {
  const cursor = new Date(date.getTime())
  let guard = 0
  const step = () => {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    if (++guard > 4000) {
      throw new Error("addBusinessDays: no working day within ten years — is workingDays empty?")
    }
  }

  // Land on a working day first, then count from there. Doing both in one loop
  // reads as one rule and is two, which is how "0 working days from Saturday"
  // ends up on Sunday.
  while (!isWorkingDay(cursor, calendar)) step()
  for (let remaining = n; remaining > 0; ) {
    step()
    if (isWorkingDay(cursor, calendar)) remaining--
  }
  return cursor
}
