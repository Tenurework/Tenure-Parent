import { approvalSla, slaColor } from "./approvals-sla"

const NOW = new Date("2026-07-22T12:00:00.000Z")
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

describe("approvalSla", () => {
  it("returns 'none' for terminal statuses (nothing to chase)", () => {
    for (const s of ["APPROVED", "REJECTED", "CANCELLED"]) {
      expect(approvalSla(s, daysAgo(30), NOW).level).toBe("none")
    }
  })

  it("is ok for fresh pending requests (0–2 days)", () => {
    expect(approvalSla("PENDING_PRESIDENT", daysAgo(0), NOW).level).toBe("ok")
    expect(approvalSla("PENDING_OSE", daysAgo(2), NOW).level).toBe("ok")
  })

  it("escalates to attention at 3 days and overdue at 6", () => {
    expect(approvalSla("PENDING_OSE", daysAgo(3), NOW).level).toBe("attention")
    expect(approvalSla("PENDING_OSE", daysAgo(5), NOW).level).toBe("attention")
    expect(approvalSla("PENDING_OSE", daysAgo(6), NOW).level).toBe("overdue")
    expect(approvalSla("NEEDS_CHANGES", daysAgo(30), NOW).level).toBe("overdue")
  })

  it("reports the days in stage with readable labels", () => {
    expect(approvalSla("PENDING_OSE", daysAgo(0), NOW).label).toBe("in stage today")
    expect(approvalSla("PENDING_OSE", daysAgo(1), NOW).label).toBe("1 day in stage")
    expect(approvalSla("PENDING_OSE", daysAgo(4), NOW)).toMatchObject({ days: 4, label: "4 days in stage" })
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
