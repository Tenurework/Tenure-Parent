import {
  expandOccurrences,
  formatRecurrenceRule,
  parseRecurrenceRule,
  type RecurrenceRule,
} from "@/lib/calendar-recurrence"
import { zonedParts, zonedTimeToUtc } from "@/lib/time"

/**
 * WRK-060-005 — the recurrence half.
 *
 * `Event.recurrenceRule` was a column nothing wrote, nothing read and no feed
 * emitted, so "recurrence" could not be tested because recurrence did not
 * exist. These are the cases that decide whether the expansion is right, and
 * every one of them is a case a student club actually produces.
 *
 * The DST table is the load-bearing one. A weekly meeting expanded by adding
 * `7 * 864e5` milliseconds is correct until the first Sunday in November and
 * then an hour wrong, forever, in the direction nobody notices — the meeting
 * simply starts appearing at 5pm.
 */

const NY = "America/New_York"

/** The wall-clock hour an instant reads at in a zone. */
function hourIn(d: Date, timeZone: string): number {
  return zonedParts(d, timeZone).hour
}

function ruleOrThrow(raw: string): RecurrenceRule {
  const rule = parseRecurrenceRule(raw)
  if (!rule) throw new Error(`expected ${raw} to parse`)
  return rule
}

describe("parsing the subset the column promises", () => {
  const accepted: Array<[string, Partial<RecurrenceRule>]> = [
    ["FREQ=DAILY", { freq: "DAILY", interval: 1, count: null, until: null, byDay: [] }],
    ["FREQ=WEEKLY;INTERVAL=2", { freq: "WEEKLY", interval: 2 }],
    ["FREQ=WEEKLY;BYDAY=MO,WE", { freq: "WEEKLY", byDay: ["MO", "WE"] }],
    // Sunday-first ordering, deduplicated — so two spellings of one rule
    // produce one canonical form and the feed cannot drift from the grid.
    ["FREQ=WEEKLY;BYDAY=WE,MO,MO", { byDay: ["MO", "WE"] }],
    ["FREQ=MONTHLY;COUNT=3", { freq: "MONTHLY", count: 3 }],
    ["RRULE:FREQ=WEEKLY;BYDAY=TU", { freq: "WEEKLY", byDay: ["TU"] }],
    ["freq=weekly;byday=tu", { freq: "WEEKLY", byDay: ["TU"] }],
  ]

  it.each(accepted)("accepts %s", (raw, expected) => {
    expect(parseRecurrenceRule(raw)).toMatchObject(expected)
  })

  const refused: Array<[string, string]> = [
    ["", "an empty rule is not a rule"],
    ["FREQ=YEARLY", "outside the subset — yearly is not implemented"],
    ["INTERVAL=2", "no FREQ at all"],
    ["FREQ=WEEKLY;BYSETPOS=-1", "an unimplemented part must refuse, not be ignored"],
    ["FREQ=MONTHLY;BYMONTHDAY=13", "same — ignoring it would produce the wrong days"],
    ["FREQ=WEEKLY;BYDAY=2MO", "an ordinal BYDAY read as a plain Monday is four meetings, not one"],
    ["FREQ=WEEKLY;BYDAY=XX", "not a weekday"],
    ["FREQ=WEEKLY;BYDAY=", "BYDAY naming nothing"],
    ["FREQ=DAILY;INTERVAL=0", "an interval of zero never advances"],
    ["FREQ=DAILY;COUNT=0", "a series with no occurrences"],
    ["FREQ=DAILY;UNTIL=notadate", "an unreadable end"],
    ["FREQ=DAILY;UNTIL=20261332", "a well-formed impossible date"],
    ["FREQ=DAILY;COUNT=5;UNTIL=20261231Z", "RFC 5545 makes COUNT and UNTIL exclusive"],
    ["FREQ=DAILY;COUNT=3;UNTIL=20261231", "same, in the other spelling"],
  ]

  it.each(refused)("refuses %s — %s", (raw) => {
    expect(parseRecurrenceRule(raw)).toBeNull()
  })

  it("round-trips to a canonical property list the feed can emit", () => {
    expect(formatRecurrenceRule(ruleOrThrow("FREQ=WEEKLY;BYDAY=WE;INTERVAL=1"))).toBe(
      "FREQ=WEEKLY;BYDAY=WE"
    )
    expect(formatRecurrenceRule(ruleOrThrow("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=4"))).toBe(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=4"
    )
    expect(formatRecurrenceRule(ruleOrThrow("FREQ=MONTHLY;UNTIL=20270115T120000Z"))).toBe(
      "FREQ=MONTHLY;UNTIL=20270115T120000Z"
    )
  })
})

describe("expansion across a daylight-saving boundary", () => {
  /**
   * A 6pm Wednesday club meeting seeded in EDT and read across the November
   * changeover, and the same rule seeded in EST and read across March.
   *
   * `wallHour` is the assertion that matters — it must be 18 on every
   * occurrence. `utcHour` is stated too, and it must CHANGE, because that is
   * what proves the expansion is re-resolving the zone rather than the numbers
   * happening to agree.
   */
  const table: Array<{
    name: string
    seedLocal: string
    rule: string
    weeks: number
    expectUtcHours: number[]
  }> = [
    {
      name: "weekly Wednesday 18:00 crossing EDT → EST (2 Nov 2026)",
      seedLocal: "2026-10-28T18:00",
      rule: "FREQ=WEEKLY;BYDAY=WE",
      weeks: 4,
      // 22:00Z while EDT (UTC-4); EST (UTC-5) starts Sun 1 Nov 2026, so every
      // occurrence from the 4th onward is 23:00Z for the same 18:00 wall clock.
      expectUtcHours: [22, 23, 23, 23],
    },
    {
      name: "weekly Wednesday 18:00 crossing EST → EDT (8 Mar 2027)",
      seedLocal: "2027-02-24T18:00",
      rule: "FREQ=WEEKLY;BYDAY=WE",
      weeks: 4,
      // EDT starts Sun 14 Mar 2027, so only the 17th has moved.
      expectUtcHours: [23, 23, 23, 22],
    },
    {
      name: "daily 06:00 across the spring-forward morning",
      seedLocal: "2027-03-12T06:00",
      rule: "FREQ=DAILY",
      weeks: 0,
      expectUtcHours: [11, 11, 10, 10],
    },
  ]

  it.each(table)("$name", ({ seedLocal, rule, expectUtcHours }) => {
    // Parsed as institution-local wall clock, exactly as the proposal form does.
    const [datePart, timePart] = seedLocal.split("T")
    const [y, m, d] = datePart.split("-").map(Number)
    const [hh, mm] = timePart.split(":").map(Number)
    const start = zonedTimeToUtcLocal(y, m, d, hh, mm)
    const end = new Date(start.getTime() + 2 * 3600_000)

    const occurrences = expandOccurrences({
      start,
      end,
      rule: ruleOrThrow(rule),
      timeZone: NY,
      windowStart: start,
      windowEnd: new Date(start.getTime() + 40 * 864e5),
    })

    const observed = occurrences.slice(0, expectUtcHours.length)
    expect(observed).toHaveLength(expectUtcHours.length)

    // The wall clock never moves…
    expect(observed.map((o) => hourIn(o.startAt, NY))).toEqual(
      expectUtcHours.map(() => hh)
    )
    // …and the UTC instant does, which is the only way that can be true.
    expect(observed.map((o) => o.startAt.getUTCHours())).toEqual(expectUtcHours)
    // The meeting is still two hours long on both sides of the boundary.
    for (const o of observed) {
      expect(o.endAt.getTime() - o.startAt.getTime()).toBe(2 * 3600_000)
    }
  })
})

/**
 * Local helper so the table above reads as wall-clock times, not instants.
 *
 * Reuses the production converter rather than writing a second one: a fixture
 * that computed the instant itself would agree with the code under test only by
 * coincidence, and would agree with it identically when both were wrong.
 */
function zonedTimeToUtcLocal(y: number, m: number, d: number, hh: number, mm: number): Date {
  return zonedTimeToUtc(y, m, d, hh, mm, NY)
}

describe("COUNT and UNTIL bound the series", () => {
  const start = new Date("2026-09-02T22:00:00.000Z") // Wed 2 Sep 2026, 18:00 EDT
  const end = new Date("2026-09-03T00:00:00.000Z")
  const wide = {
    windowStart: new Date("2026-01-01T00:00:00.000Z"),
    windowEnd: new Date("2027-06-01T00:00:00.000Z"),
  }

  it("COUNT includes DTSTART and stops there", () => {
    const out = expandOccurrences({
      start,
      end,
      rule: ruleOrThrow("FREQ=WEEKLY;BYDAY=WE;COUNT=3"),
      timeZone: NY,
      ...wide,
    })
    expect(out.map((o) => o.startAt.toISOString().slice(0, 10))).toEqual([
      "2026-09-02",
      "2026-09-09",
      "2026-09-16",
    ])
  })

  it("UNTIL is inclusive of an occurrence on the named day", () => {
    const out = expandOccurrences({
      start,
      end,
      rule: ruleOrThrow("FREQ=WEEKLY;BYDAY=WE;UNTIL=20260916"),
      timeZone: NY,
      ...wide,
    })
    expect(out).toHaveLength(3)
    expect(out[2].startAt.toISOString().slice(0, 10)).toBe("2026-09-16")
  })

  it("counts from DTSTART, not from the window — a spent series shows nothing", () => {
    // Weeks 1-3 of the series are in September; this window is December.
    const out = expandOccurrences({
      start,
      end,
      rule: ruleOrThrow("FREQ=WEEKLY;BYDAY=WE;COUNT=3"),
      timeZone: NY,
      windowStart: new Date("2026-12-01T00:00:00.000Z"),
      windowEnd: new Date("2027-01-01T00:00:00.000Z"),
    })
    expect(out).toEqual([])
  })

  it("an open-ended daily rule terminates instead of running away", () => {
    const out = expandOccurrences({
      start,
      end,
      rule: ruleOrThrow("FREQ=DAILY"),
      timeZone: NY,
      windowStart: start,
      windowEnd: new Date("2099-01-01T00:00:00.000Z"),
    })
    expect(out.length).toBeGreaterThan(300)
    expect(out.length).toBeLessThanOrEqual(750)
  })
})

describe("the shapes a club calendar actually produces", () => {
  const start = new Date("2026-09-02T22:00:00.000Z") // Wed 18:00 EDT
  const end = new Date("2026-09-03T00:00:00.000Z")

  it("BYDAY with two days fires twice a week, and never before DTSTART", () => {
    const out = expandOccurrences({
      start,
      end,
      rule: ruleOrThrow("FREQ=WEEKLY;BYDAY=MO,WE"),
      timeZone: NY,
      windowStart: new Date("2026-08-01T00:00:00.000Z"),
      windowEnd: new Date("2026-09-21T00:00:00.000Z"),
    })
    // The Monday of the seed's own week (31 Aug) precedes DTSTART and is
    // excluded; the series starts on the Wednesday it was filed for.
    expect(out.map((o) => o.startAt.toISOString().slice(0, 10))).toEqual([
      "2026-09-02",
      "2026-09-07",
      "2026-09-09",
      "2026-09-14",
      "2026-09-16",
    ])
  })

  it("INTERVAL=2 skips a whole week rather than fourteen days from the seed", () => {
    const out = expandOccurrences({
      start,
      end,
      rule: ruleOrThrow("FREQ=WEEKLY;INTERVAL=2;BYDAY=WE"),
      timeZone: NY,
      windowStart: new Date("2026-08-01T00:00:00.000Z"),
      windowEnd: new Date("2026-10-15T00:00:00.000Z"),
    })
    expect(out.map((o) => o.startAt.toISOString().slice(0, 10))).toEqual([
      "2026-09-02",
      "2026-09-16",
      "2026-09-30",
      "2026-10-14",
    ])
  })

  it("a monthly rule on the 31st skips the months that have no 31st", () => {
    const jan31 = new Date("2027-01-31T23:00:00.000Z") // 18:00 EST
    const out = expandOccurrences({
      start: jan31,
      end: new Date(jan31.getTime() + 3600_000),
      rule: ruleOrThrow("FREQ=MONTHLY;COUNT=4"),
      timeZone: NY,
      windowStart: jan31,
      windowEnd: new Date("2027-12-31T00:00:00.000Z"),
    })
    expect(out.map((o) => o.startAt.toISOString().slice(0, 10))).toEqual([
      "2027-01-31",
      "2027-03-31",
      "2027-05-31",
      "2027-07-31",
    ])
  })

  it("returns nothing for a zero-length window", () => {
    expect(
      expandOccurrences({
        start,
        end,
        rule: ruleOrThrow("FREQ=DAILY"),
        timeZone: NY,
        windowStart: start,
        windowEnd: start,
      })
    ).toEqual([])
  })
})
