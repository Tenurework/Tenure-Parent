import {
  OPEN_APPROVAL_STATUSES,
  UNDECIDED_APPROVAL_STATUSES,
  countOpenApprovals,
  formatDuration,
  isOpenApproval,
  isUndecidedApproval,
  medianDurationMs,
} from "./metrics"

/**
 * ANL-000-002. The behaviour of the single metric definition.
 *
 * `tests/architecture/anl-single-metric-definition.test.mjs` asserts that no
 * second implementation exists. This asserts that the one that does is right —
 * and specifically at the boundary the two old implementations disagreed on,
 * which is the whole reason the module exists.
 */

const HOUR = 3_600_000
const DAY = 86_400_000

describe("open and undecided approvals are different populations", () => {
  it("counts only requests waiting on a decision as open", () => {
    expect([...OPEN_APPROVAL_STATUSES]).toEqual(["PENDING_PRESIDENT", "PENDING_OSE"])
    expect(isOpenApproval("PENDING_PRESIDENT")).toBe(true)
    expect(isOpenApproval("PENDING_OSE")).toBe(true)
    // The ball is with the requester, not a decider.
    expect(isOpenApproval("DRAFT")).toBe(false)
    expect(isOpenApproval("NEEDS_CHANGES")).toBe(false)
    expect(isOpenApproval("APPROVED")).toBe(false)
    expect(isOpenApproval("REJECTED")).toBe(false)
  })

  it("counts everything still in flight as undecided", () => {
    expect(isUndecidedApproval("DRAFT")).toBe(true)
    expect(isUndecidedApproval("NEEDS_CHANGES")).toBe(true)
    expect(isUndecidedApproval("APPROVED")).toBe(false)
  })

  it("keeps the two sets genuinely different, which is the defect", () => {
    // Both were rendered under the word "pending" on different pages. If these
    // ever became the same set, the two names would be a distinction without a
    // difference and the callers should collapse rather than drift.
    expect(UNDECIDED_APPROVAL_STATUSES.length).toBeGreaterThan(OPEN_APPROVAL_STATUSES.length)
    for (const status of OPEN_APPROVAL_STATUSES) {
      expect(isUndecidedApproval(status)).toBe(true)
    }
  })

  it("counts open requests out of a loaded set", () => {
    const requests = [
      { status: "DRAFT" },
      { status: "PENDING_PRESIDENT" },
      { status: "PENDING_OSE" },
      { status: "APPROVED" },
    ]
    expect(countOpenApprovals(requests)).toBe(2)
    expect(countOpenApprovals([])).toBe(0)
  })
})

describe("median time to decision", () => {
  it("is null when nothing has been decided, never zero", () => {
    // A median of zero and no decisions are different facts. The old code
    // rendered the first as "0 min" in one place and an em dash in the other.
    expect(medianDurationMs([])).toBe(null)
    expect(formatDuration(null)).toBe("—")
  })

  it("takes the lower middle value on an even population, as documented", () => {
    expect(medianDurationMs([1, 2, 3])).toBe(2)
    expect(medianDurationMs([4, 1, 3, 2])).toBe(3)
  })

  it("does not mutate the caller's array", () => {
    const durations = [3, 1, 2]
    medianDurationMs(durations)
    expect(durations).toEqual([3, 1, 2])
  })

  it("uses one ladder across minutes, hours and days", () => {
    // THE defect. The reports page had no day rung, so five days rendered as
    // `120.0 h` in a stat tile and `5.0 days` in the panel below it, under the
    // same words, on the same screen.
    expect(formatDuration(5 * DAY)).toBe("5.0 days")
    expect(formatDuration(5 * HOUR)).toBe("5.0 h")
    expect(formatDuration(20 * 60_000)).toBe("20 min")
  })

  it("never rounds a real wait down to zero minutes", () => {
    expect(formatDuration(1_000)).toBe("1 min")
  })

  it("switches rung exactly at the hour and the day", () => {
    expect(formatDuration(HOUR - 1)).toBe("60 min")
    expect(formatDuration(HOUR)).toBe("1.0 h")
    expect(formatDuration(DAY - 1)).toBe("24.0 h")
    expect(formatDuration(DAY)).toBe("1.0 days")
  })
})
