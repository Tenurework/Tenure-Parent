import { bucketByWeek, bucketByWeekForward } from "./timeseries"

/**
 * The two bucketers point in opposite directions, and using the wrong one is
 * silent: you get a plausible all-zero series rather than an error. That is
 * exactly what happened to the dashboard's "Upcoming Events" tile, which
 * counted future events and then charted them with the backward bucketer.
 */
const NOW = new Date("2026-07-30T12:00:00Z")
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000)

describe("bucketByWeek (backward)", () => {
  it("counts the recent past and excludes the future", () => {
    const out = bucketByWeek([days(-1), days(-8), days(-8), days(3)], 4, NOW)
    // Newest bucket last; the +3-day event must not appear anywhere.
    expect(out.reduce((a, b) => a + b, 0)).toBe(3)
    expect(out[3]).toBe(1)
    expect(out[2]).toBe(2)
  })

  it("drops every future date — the trap the dashboard fell into", () => {
    expect(bucketByWeek([days(1), days(5), days(20)], 4, NOW)).toEqual([0, 0, 0, 0])
  })
})

describe("bucketByWeekForward", () => {
  it("counts the coming weeks, nearest first", () => {
    const out = bucketByWeekForward([days(1), days(2), days(9), days(20)], 4, NOW)
    expect(out[0]).toBe(2) // within the next 7 days
    expect(out[1]).toBe(1) // days 7-13
    expect(out[2]).toBe(1) // days 14-20
    expect(out[3]).toBe(0)
  })

  it("excludes the past and anything beyond the window", () => {
    expect(bucketByWeekForward([days(-1), days(-30), days(400)], 4, NOW)).toEqual([0, 0, 0, 0])
  })

  it("includes something happening later today", () => {
    const laterToday = new Date(NOW.getTime() + 6 * 3600_000)
    expect(bucketByWeekForward([laterToday], 4, NOW)[0]).toBe(1)
  })
})
