import {
  DEFAULT_BUSINESS_CALENDAR,
  addBusinessDays,
  businessDaysBetween,
  isWorkingDay,
  type BusinessCalendar,
} from "./business-calendar"

/**
 * GE-022-004 — the business calendar.
 *
 * Dates are written as UTC so the assertions say what they mean. 2026-08-03 is
 * a Monday; every date below is anchored to that week.
 */
const MON = new Date("2026-08-03T09:00:00Z")
const TUE = new Date("2026-08-04T09:00:00Z")
const WED = new Date("2026-08-05T09:00:00Z")
const FRI = new Date("2026-08-07T16:00:00Z")
const SAT = new Date("2026-08-08T09:00:00Z")
const SUN = new Date("2026-08-09T09:00:00Z")
const NEXT_MON = new Date("2026-08-10T09:00:00Z")
const NEXT_TUE = new Date("2026-08-11T09:00:00Z")

describe("which days are worked", () => {
  it("defaults to Monday through Friday", () => {
    expect(isWorkingDay(MON)).toBe(true)
    expect(isWorkingDay(FRI)).toBe(true)
    expect(isWorkingDay(SAT)).toBe(false)
    expect(isWorkingDay(SUN)).toBe(false)
  })

  it("takes a Friday–Saturday weekend, which is most of the Gulf", () => {
    // The reason workingDays is a list rather than a "weekend starts here"
    // index: this weekend is not a rotation of the default one.
    const gulf: BusinessCalendar = { workingDays: [0, 1, 2, 3, 4], holidays: [] }
    expect(isWorkingDay(SUN, gulf)).toBe(true)
    expect(isWorkingDay(FRI, gulf)).toBe(false)
    expect(isWorkingDay(SAT, gulf)).toBe(false)
  })

  it("treats a closure as a non-working day even on a weekday", () => {
    const closed: BusinessCalendar = { workingDays: [1, 2, 3, 4, 5], holidays: ["2026-08-05"] }
    expect(isWorkingDay(WED, closed)).toBe(false)
    expect(isWorkingDay(WED)).toBe(true)
  })
})

describe("counting the days a request has been waiting", () => {
  it("counts days started, not whole days elapsed", () => {
    // Submitted Monday, still open Tuesday: one working day old. Zero would
    // mean nothing waits until its second full day, and every SLA would fire
    // a day late.
    expect(businessDaysBetween(MON, TUE)).toBe(1)
    expect(businessDaysBetween(MON, WED)).toBe(2)
  })

  it("does not age a request over the weekend", () => {
    // The defect this closes. Friday afternoon to Monday morning was three
    // calendar days, which put a request into "attention" before anyone could
    // have looked at it.
    expect(businessDaysBetween(FRI, SAT)).toBe(0)
    expect(businessDaysBetween(FRI, SUN)).toBe(0)
    expect(businessDaysBetween(FRI, NEXT_MON)).toBe(1)
    // For comparison: the calendar-day arithmetic this replaced.
    expect(Math.floor((NEXT_MON.getTime() - FRI.getTime()) / 86_400_000)).toBe(2)
  })

  it("skips a closure inside the span", () => {
    const closed: BusinessCalendar = { workingDays: [1, 2, 3, 4, 5], holidays: ["2026-08-04"] }
    expect(businessDaysBetween(MON, WED)).toBe(2)
    expect(businessDaysBetween(MON, WED, closed)).toBe(1)
  })

  it("returns zero rather than a negative when the clock runs backwards", () => {
    // A clock that counts down produces an "overdue" flag on something
    // submitted in the future, and does it silently.
    expect(businessDaysBetween(NEXT_MON, MON)).toBe(0)
    expect(businessDaysBetween(MON, MON)).toBe(0)
  })

  it("refuses a span longer than the guard rather than looping forever", () => {
    // An unbounded loop over a corrupt date is a hung request, which is harder
    // to find than an error.
    expect(() => businessDaysBetween(new Date("1900-01-01T00:00:00Z"), MON)).toThrow(/ten years/)
  })
})

describe("setting a due date", () => {
  it("counts forward in working days", () => {
    expect(addBusinessDays(MON, 1).toISOString().slice(0, 10)).toBe("2026-08-04")
    // Thursday + 2 crosses the weekend and lands on Monday, not Saturday.
    expect(addBusinessDays(new Date("2026-08-06T09:00:00Z"), 2).toISOString().slice(0, 10)).toBe(
      "2026-08-10",
    )
  })

  it("moves off a closure day rather than landing on one", () => {
    // A due date nobody can meet is not a due date.
    const closed: BusinessCalendar = { workingDays: [1, 2, 3, 4, 5], holidays: ["2026-08-04"] }
    expect(addBusinessDays(MON, 1, closed).toISOString().slice(0, 10)).toBe("2026-08-05")
  })

  it("moves a zero-day due date off a weekend", () => {
    // Two rules, not one: land on a working day, THEN count. Merging them puts
    // "0 working days from Saturday" on Sunday.
    expect(addBusinessDays(SAT, 0).toISOString().slice(0, 10)).toBe("2026-08-10")
    expect(addBusinessDays(MON, 0).toISOString().slice(0, 10)).toBe("2026-08-03")
  })

  it("keeps the time of day", () => {
    // A due date at 16:00 Friday should not become midnight on Monday.
    expect(addBusinessDays(FRI, 1).toISOString()).toBe("2026-08-10T16:00:00.000Z")
  })
})

describe("the default calendar is the assumption the code used to make", () => {
  it("is Monday to Friday with no closures", () => {
    expect(DEFAULT_BUSINESS_CALENDAR).toEqual({ workingDays: [1, 2, 3, 4, 5], holidays: [] })
  })

  it("agrees with calendar days when every day is worked", () => {
    // A useful sanity check on the counting itself: with a seven-day week the
    // business-day count and the calendar-day count must be the same number.
    const always: BusinessCalendar = { workingDays: [0, 1, 2, 3, 4, 5, 6], holidays: [] }
    expect(businessDaysBetween(FRI, NEXT_TUE, always)).toBe(4)
  })
})
