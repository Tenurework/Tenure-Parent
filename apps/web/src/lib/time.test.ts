import {
  addDaysToKey,
  dateKeyInZone,
  formatDateKey,
  minutesOfDayInZone,
  parseDateKey,
  parseDateTimeLocal,
  safeZone,
  startOfWeekKey,
  toDateTimeLocalValue,
  weekdayInZone,
  zoneAbbreviation,
  zoneOffsetMs,
  zonedParts,
  zonedTimeToUtc,
} from "./time"

const NY = "America/New_York"

describe("zonedParts", () => {
  it("reads an instant as wall-clock time in the zone", () => {
    // 22:00Z in September is 18:00 EDT (UTC-4).
    expect(zonedParts(new Date("2026-09-05T22:00:00Z"), NY)).toMatchObject({
      year: 2026,
      month: 9,
      day: 5,
      hour: 18,
      minute: 0,
    })
  })

  it("normalises midnight to hour 0, not 24", () => {
    expect(zonedParts(new Date("2026-09-06T04:00:00Z"), NY).hour).toBe(0)
  })

  it("follows DST — the same clock hour has different offsets in Jan and Jul", () => {
    expect(zonedParts(new Date("2026-01-15T17:00:00Z"), NY).hour).toBe(12) // EST, UTC-5
    expect(zonedParts(new Date("2026-07-15T17:00:00Z"), NY).hour).toBe(13) // EDT, UTC-4
  })
})

describe("zoneOffsetMs", () => {
  it("is -5h in winter and -4h in summer for New York", () => {
    expect(zoneOffsetMs(new Date("2026-01-15T12:00:00Z"), NY)).toBe(-5 * 3600_000)
    expect(zoneOffsetMs(new Date("2026-07-15T12:00:00Z"), NY)).toBe(-4 * 3600_000)
  })

  it("is zero for UTC", () => {
    expect(zoneOffsetMs(new Date("2026-07-15T12:00:00Z"), "UTC")).toBe(0)
  })
})

describe("zonedTimeToUtc", () => {
  it("round-trips with zonedParts", () => {
    const utc = zonedTimeToUtc(2026, 9, 5, 18, 0, NY)
    expect(utc.toISOString()).toBe("2026-09-05T22:00:00.000Z")
    expect(zonedParts(utc, NY)).toMatchObject({ hour: 18, minute: 0, day: 5 })
  })

  it("resolves the autumn fall-back hour to a real instant", () => {
    // 2026-11-01 01:30 occurs twice in New York; either instant is acceptable
    // so long as it reads back as 01:30 local.
    const utc = zonedTimeToUtc(2026, 11, 1, 1, 30, NY)
    expect(zonedParts(utc, NY)).toMatchObject({ hour: 1, minute: 30, day: 1 })
  })

  it("does not lose a spring-forward submission", () => {
    // 2026-03-08 02:30 does not exist in New York. The result must still be a
    // valid instant on that morning rather than NaN or a day-shift.
    const utc = zonedTimeToUtc(2026, 3, 8, 2, 30, NY)
    expect(isNaN(utc.getTime())).toBe(false)
    expect(dateKeyInZone(utc, NY)).toBe("2026-03-08")
  })

  it("handles a zone ahead of UTC", () => {
    const utc = zonedTimeToUtc(2026, 9, 5, 9, 0, "Asia/Tokyo") // UTC+9
    expect(utc.toISOString()).toBe("2026-09-05T00:00:00.000Z")
  })
})

describe("parseDateTimeLocal", () => {
  it("reads a datetime-local field as institution wall-clock, not server time", () => {
    // This is the regression that shifted every proposed event by the UTC
    // offset: the officer types 18:00, the officer means 18:00 in Rochester.
    expect(parseDateTimeLocal("2026-09-05T18:00", NY)?.toISOString()).toBe(
      "2026-09-05T22:00:00.000Z"
    )
  })

  it("round-trips through toDateTimeLocalValue", () => {
    const iso = "2026-09-05T22:00:00.000Z"
    const value = toDateTimeLocalValue(new Date(iso), NY)
    expect(value).toBe("2026-09-05T18:00")
    expect(parseDateTimeLocal(value, NY)?.toISOString()).toBe(iso)
  })

  it("rejects malformed and out-of-range input", () => {
    expect(parseDateTimeLocal("", NY)).toBeNull()
    expect(parseDateTimeLocal("not-a-date", NY)).toBeNull()
    expect(parseDateTimeLocal("2026-09-05T25:00", NY)).toBeNull()
    expect(parseDateTimeLocal("2026-02-31T10:00", NY)).toBeNull()
  })
})

describe("dateKeyInZone / minutesOfDayInZone", () => {
  it("assigns a late-evening event to the local day, not the UTC day", () => {
    // 2026-09-06T01:00Z is still the evening of the 5th in New York. Bucketing
    // by UTC would file it under the wrong column of the week grid.
    const d = new Date("2026-09-06T01:00:00Z")
    expect(dateKeyInZone(d, NY)).toBe("2026-09-05")
    expect(minutesOfDayInZone(d, NY)).toBe(21 * 60)
  })
})

describe("date-key helpers", () => {
  it("parses and rejects date keys", () => {
    expect(parseDateKey("2026-09-05")).toEqual({ year: 2026, month: 9, day: 5 })
    expect(parseDateKey("2026-13-40")).toBeNull()
    expect(parseDateKey("2026-02-30")).toBeNull()
    expect(parseDateKey("nope")).toBeNull()
  })

  it("adds days across a month boundary", () => {
    expect(addDaysToKey("2026-09-30", 1)).toBe("2026-10-01")
    expect(addDaysToKey("2026-01-01", -1)).toBe("2025-12-31")
  })

  it("adds days across a DST boundary without drifting", () => {
    // Pure calendar arithmetic: the 23-hour spring-forward day must not make
    // "+1 day" land back on the same date.
    expect(addDaysToKey("2026-03-07", 1)).toBe("2026-03-08")
    expect(addDaysToKey("2026-03-08", 1)).toBe("2026-03-09")
  })

  it("finds the Sunday that starts the week", () => {
    expect(startOfWeekKey("2026-09-05")).toBe("2026-08-30") // a Saturday
    expect(startOfWeekKey("2026-08-30")).toBe("2026-08-30") // already Sunday
  })

  it("formats a date key without a zone shift", () => {
    expect(formatDateKey("2026-09-05", { month: "short", day: "numeric" })).toBe("Sep 5")
  })

  it("reports the weekday in the zone", () => {
    expect(weekdayInZone(new Date("2026-09-05T22:00:00Z"), NY)).toBe(6) // Saturday
    // The same instant is already Sunday in UTC — the zone must win.
    expect(weekdayInZone(new Date("2026-09-06T01:00:00Z"), NY)).toBe(6)
  })
})

describe("safeZone", () => {
  it("passes valid zones through and falls back on junk", () => {
    expect(safeZone("Europe/Paris")).toBe("Europe/Paris")
    expect(safeZone(null)).toBe("America/New_York")
    expect(safeZone("Mars/Olympus_Mons")).toBe("America/New_York")
  })
})

describe("zoneAbbreviation", () => {
  it("labels the zone so a printed time is never ambiguous", () => {
    expect(zoneAbbreviation(NY, new Date("2026-07-15T12:00:00Z"))).toBe("EDT")
    expect(zoneAbbreviation(NY, new Date("2026-01-15T12:00:00Z"))).toBe("EST")
  })
})

describe("zone abbreviation follows the date it is asked about", () => {
  it("does not report a summer abbreviation for a winter week", () => {
    // The calendar previously labelled every week with today's abbreviation, so
    // browsing to a February week in July stamped "EDT" over EST times.
    const februaryNoon = zonedTimeToUtc(2027, 2, 17, 12, 0, NY)
    const julyNoon = zonedTimeToUtc(2027, 7, 17, 12, 0, NY)
    expect(zoneAbbreviation(NY, februaryNoon)).toBe("EST")
    expect(zoneAbbreviation(NY, julyNoon)).toBe("EDT")
  })
})

describe("minutes past midnight roll into the next day", () => {
  /**
   * The week grid expresses an event as a date key plus minutes from local
   * midnight, so an event ending after midnight has to be expressible as a
   * minute count beyond 24×60 against its *start* date. Without this, the grid
   * clamped such an event to the bottom of the visible band and then wrote that
   * clamped value back — silently truncating every event that ran past 11pm.
   */
  it("treats hour 25 as 1am the following day", () => {
    const tenPm = zonedTimeToUtc(2026, 9, 5, 22, 0, NY)
    const oneAmNext = zonedTimeToUtc(2026, 9, 5, 25, 0, NY)

    expect(oneAmNext.getTime() - tenPm.getTime()).toBe(3 * 60 * 60 * 1000)
    expect(dateKeyInZone(oneAmNext, NY)).toBe("2026-09-06")
    expect(minutesOfDayInZone(oneAmNext, NY)).toBe(60)
  })

  it("carries a midnight-crossing event across a month boundary", () => {
    const end = zonedTimeToUtc(2026, 9, 30, 24 + 1, 30, NY)
    expect(dateKeyInZone(end, NY)).toBe("2026-10-01")
    expect(minutesOfDayInZone(end, NY)).toBe(90)
  })

  it("stays correct when the crossing happens on the fall-back night", () => {
    // 2026-11-01 is the US DST fall-back. A 10pm Oct 31 event running six hours
    // ends at 3am by the wall clock but seven real hours later.
    const start = zonedTimeToUtc(2026, 10, 31, 22, 0, NY)
    const end = zonedTimeToUtc(2026, 10, 31, 24 + 4, 0, NY)
    expect(dateKeyInZone(end, NY)).toBe("2026-11-01")
    expect(end.getTime() - start.getTime()).toBe(7 * 60 * 60 * 1000)
  })
})
