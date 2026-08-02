import { approvalSla, slaColor } from "./approvals-sla"

// A Wednesday. Named, because every threshold below is now counted in WORKING
// days and which weekday "now" falls on decides where the weekend lands.
const NOW = new Date("2026-07-22T12:00:00.000Z")
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)
/** Calendar days back from NOW that contain `n` working days. */
const workingDaysAgo = (n: number) => {
  const cursor = new Date(NOW.getTime())
  let counted = 0
  while (counted < n) {
    cursor.setUTCDate(cursor.getUTCDate() - 1)
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) counted++
  }
  return cursor
}

describe("approvalSla", () => {
  it("returns 'none' for terminal statuses (nothing to chase)", () => {
    for (const s of ["APPROVED", "REJECTED", "CANCELLED"]) {
      expect(approvalSla(s, daysAgo(30), NOW).level).toBe("none")
    }
  })

  it("is ok for fresh pending requests (0–2 working days)", () => {
    expect(approvalSla("PENDING_PRESIDENT", workingDaysAgo(0), NOW).level).toBe("ok")
    expect(approvalSla("PENDING_OSE", workingDaysAgo(2), NOW).level).toBe("ok")
  })

  it("escalates to attention at 3 working days and overdue at 6", () => {
    expect(approvalSla("PENDING_OSE", workingDaysAgo(3), NOW).level).toBe("attention")
    expect(approvalSla("PENDING_OSE", workingDaysAgo(5), NOW).level).toBe("attention")
    expect(approvalSla("PENDING_OSE", workingDaysAgo(6), NOW).level).toBe("overdue")
    expect(approvalSla("NEEDS_CHANGES", daysAgo(30), NOW).level).toBe("overdue")
  })

  it("does not age a request over a weekend", () => {
    // GE-022-004. NOW is a Wednesday, so six CALENDAR days back is the previous
    // Thursday — with a weekend in between, that is four working days, not six.
    // Under the old calendar-day clock this read "overdue" on a request that
    // had been sitting for four days anyone could have acted on.
    expect(approvalSla("PENDING_OSE", daysAgo(6), NOW)).toMatchObject({
      days: 4,
      level: "attention",
    })
    // And nothing at all ages between Friday evening and Monday morning.
    const fridayEvening = new Date("2026-07-17T16:00:00.000Z")
    const mondayMorning = new Date("2026-07-20T09:00:00.000Z")
    expect(approvalSla("PENDING_OSE", fridayEvening, mondayMorning).days).toBe(1)
  })

  it("honours an institution's own closures", () => {
    // Wednesday to the following Wednesday is five working days; closing on the
    // Friday and the Monday makes it three.
    const lastWed = new Date("2026-07-15T12:00:00.000Z")
    expect(approvalSla("PENDING_OSE", lastWed, NOW).days).toBe(5)
    expect(
      approvalSla("PENDING_OSE", lastWed, NOW, {
        workingDays: [1, 2, 3, 4, 5],
        holidays: ["2026-07-17", "2026-07-20"],
      }).days,
    ).toBe(3)
  })

  it("reports the days in stage with readable labels", () => {
    expect(approvalSla("PENDING_OSE", workingDaysAgo(0), NOW).label).toBe("in stage today")
    expect(approvalSla("PENDING_OSE", workingDaysAgo(1), NOW).label).toBe("1 working day in stage")
    expect(approvalSla("PENDING_OSE", workingDaysAgo(4), NOW)).toMatchObject({
      days: 4,
      label: "4 working days in stage",
    })
  })

  it("never goes negative when a clock is skewed", () => {
    expect(approvalSla("PENDING_OSE", new Date(NOW.getTime() + 86_400_000), NOW).days).toBe(0)
  })
})

describe("slaColor", () => {
  it("maps each level to its status token", () => {
    expect(slaColor("overdue")).toContain("error")
    expect(slaColor("attention")).toContain("warning")
    expect(slaColor("ok")).toContain("text-3")
  })
})
