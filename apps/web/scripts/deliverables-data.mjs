/**
 * Club deliverables and deadlines for the 2026-2027 academic year.
 *
 * Sources: "2026 Simon Club Deliverables & Timelines",
 * "2026-2027 Simon's Club Transition Process", "Club Deliverables &
 * Expectations".
 *
 * Year anchoring: the source PDFs give bare month/day, and their stated
 * weekdays only resolve against 2025-26. Per the decision to run the upcoming
 * year, month/day is preserved and re-anchored to 2026-27 — fall dates to
 * 2026, spring dates to 2027 — with weekday-sensitive deadlines recomputed
 * rather than copied, so "last weekday of the month" stays true.
 */

export const ACADEMIC_YEAR = "2026-2027"

/**
 * Mini-mester boundaries. Fall B and Spring B start dates come from the
 * source docs ("10/27 (Start of Fall B)", "3/16 (Start of Spring B)"),
 * shifted to the equivalent Monday in 2026-27.
 */
export const TERMS = {
  FALL_A: { label: "Fall A", start: "2026-08-24", end: "2026-10-23" },
  FALL_B: { label: "Fall B", start: "2026-10-26", end: "2026-12-18" },
  SPRING_A: { label: "Spring A", start: "2027-01-11", end: "2027-03-12" },
  SPRING_B: { label: "Spring B", start: "2027-03-15", end: "2027-05-07" },
}

/** Which mini-mester a date falls in, or null outside the academic year. */
export function termForDate(date) {
  const iso = typeof date === "string" ? date : date.toISOString().slice(0, 10)
  for (const [key, term] of Object.entries(TERMS)) {
    if (iso >= term.start && iso <= term.end) return key
  }
  return null
}

/** Last Mon-Fri of a month — audits are due "the last weekday of each month". */
function lastWeekdayOfMonth(year, month) {
  const d = new Date(Date.UTC(year, month, 0)) // day 0 of next month = last day
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return d.toISOString().slice(0, 10)
}

const AUDIT_MONTHS = [
  [2026, 9], [2026, 10], [2026, 11], [2026, 12],
  [2027, 1], [2027, 2], [2027, 3], [2027, 4],
]

/**
 * seat: which board position owns the item (matches SeatKey in lib/resources).
 * kind: DEADLINE (hard due date) | WINDOW (opens/closes) | TRAINING | MEETING
 */
export const DELIVERABLES = [
  // ── VP Finance: monthly audits ─────────────────────────────────────────────
  ...AUDIT_MONTHS.map(([year, month]) => ({
    key: `audit-${year}-${String(month).padStart(2, "0")}`,
    title: `Monthly club audit due — ${new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" })}`,
    description:
      "Submit the monthly budget audit. Failure to submit by the due date results in frozen club accounts.",
    date: lastWeekdayOfMonth(year, month),
    seat: "VP_FINANCE",
    kind: "DEADLINE",
    source: "2026 Simon Club Deliverables & Timelines",
  })),

  // ── Refresher sessions ─────────────────────────────────────────────────────
  {
    key: "refresher-vp-events",
    title: "VP Events refresher session",
    description: "Role refresher for VPs of Events & Partnerships. 3:30 pm.",
    date: "2026-09-04",
    seat: "VP_EVENTS",
    kind: "TRAINING",
    source: "2026 Simon Club Deliverables & Timelines",
  },
  {
    key: "refresher-finance-president",
    title: "VP Finance & President refresher session",
    description: "Role refresher for VPs of Finance and club Presidents. 3:30 pm.",
    date: "2026-09-11",
    seat: "VP_FINANCE",
    kind: "TRAINING",
    source: "2026 Simon Club Deliverables & Timelines",
  },

  // ── GBC MBA 1Y Rep recruitment ─────────────────────────────────────────────
  {
    key: "gbc-1y-apps-open",
    title: "GBC MBA 1Y Rep applications open",
    description: "Applications open for Graduate Business Council MBA first-year representatives.",
    date: "2026-09-22",
    seat: "PRESIDENT",
    kind: "WINDOW",
    source: "2026 Simon Club Deliverables & Timelines",
  },
  {
    key: "gbc-1y-apps-close",
    title: "GBC MBA 1Y Rep applications close",
    description: "Final deadline for GBC MBA first-year representative applications.",
    date: "2026-10-02",
    seat: "PRESIDENT",
    kind: "DEADLINE",
    source: "2026 Simon Club Deliverables & Timelines",
  },
  {
    key: "gbc-1y-announced",
    title: "GBC MBA 1Y Rep positions announced & onboarding",
    description: "Positions announced and onboarding begins — start of Fall B.",
    date: "2026-10-26",
    seat: "PRESIDENT",
    kind: "DEADLINE",
    source: "2026 Simon Club Deliverables & Timelines",
  },

  // ── MS VP and MBA 1Y Rep recruitment (full board) ──────────────────────────
  {
    key: "msvp-apps-open",
    title: "MS VP & MBA 1Y Rep applications open",
    description:
      "Clubs open applications for one MBA first-year rep and two MS VPs.",
    date: "2026-09-29",
    seat: "ALL",
    kind: "WINDOW",
    source: "2026 Simon Club Deliverables & Timelines",
  },
  {
    key: "msvp-apps-close",
    title: "MS VP & MBA 1Y Rep applications close",
    description: "Applications close; interviews follow immediately.",
    date: "2026-10-07",
    seat: "ALL",
    kind: "DEADLINE",
    source: "2026 Simon Club Deliverables & Timelines",
  },
  {
    key: "msvp-offers",
    title: "MS VP & MBA 1Y Rep offers made",
    description: "Offers sent after Student Life review.",
    date: "2026-10-15",
    seat: "ALL",
    kind: "DEADLINE",
    source: "2026 Simon Club Deliverables & Timelines",
  },
  {
    key: "msvp-accept",
    title: "MS VP & MBA 1Y Rep offers accepted or declined",
    description: "Deadline for candidates to accept or decline.",
    date: "2026-10-22",
    seat: "ALL",
    kind: "DEADLINE",
    source: "2026 Simon Club Deliverables & Timelines",
  },
  {
    key: "msvp-onboarding",
    title: "MS VP & MBA 1Y Rep onboarding",
    description: "Positions announced and onboarding begins — start of Fall B.",
    date: "2026-10-26",
    seat: "ALL",
    kind: "DEADLINE",
    source: "2026 Simon Club Deliverables & Timelines",
  },

  // ── Board evaluations ──────────────────────────────────────────────────────
  {
    key: "evals-fall-submit",
    title: "Fall board evaluations due",
    description:
      "Submit board evaluations. The President is responsible for ensuring submissions meet the deadline — missing it freezes club accounts.",
    date: "2026-11-13",
    seat: "ALL",
    kind: "DEADLINE",
    source: "2026 Simon Club Deliverables & Timelines",
  },
  {
    key: "evals-fall-review",
    title: "Fall evaluations reviewed by advisor & President",
    description: "Club advisor and President complete their review of submitted evaluations.",
    date: "2026-11-24",
    seat: "PRESIDENT",
    kind: "DEADLINE",
    source: "2026 Simon Club Deliverables & Timelines",
  },
  {
    key: "evals-spring-submit",
    title: "Spring board evaluations due",
    description: "Submit board evaluations for the spring cycle.",
    date: "2027-02-19",
    seat: "ALL",
    kind: "DEADLINE",
    source: "2026 Simon Club Deliverables & Timelines",
  },
  {
    key: "evals-spring-review",
    title: "Spring evaluations reviewed by advisor & President",
    description: "Club advisor and President complete their review.",
    date: "2027-02-26",
    seat: "PRESIDENT",
    kind: "DEADLINE",
    source: "2026 Simon Club Deliverables & Timelines",
  },

  // ── New board transition ───────────────────────────────────────────────────
  {
    key: "transition-apps-open",
    title: "New board applications open",
    description: "Call for applications for next year's club boards.",
    date: "2027-01-29",
    seat: "PRESIDENT",
    kind: "WINDOW",
    source: "2026-2027 Simon's Club Transition Process",
  },
  {
    key: "transition-apps-close",
    title: "New board applications close",
    description: "Applications close; interviews run 2/8-2/15.",
    date: "2027-02-05",
    seat: "PRESIDENT",
    kind: "DEADLINE",
    source: "2026-2027 Simon's Club Transition Process",
  },
  {
    key: "transition-decisions-to-student-life",
    title: "Selections sent to Student Life",
    description:
      "Decisions due to the Student Life team by 11:59 pm, for approval by advisors and Benet CMC.",
    date: "2027-02-16",
    seat: "PRESIDENT",
    kind: "DEADLINE",
    source: "2026-2027 Simon's Club Transition Process",
  },
  {
    key: "transition-offers",
    title: "Offers sent to new club leaders",
    description: "Offers sent after Student Life approval.",
    date: "2027-02-19",
    seat: "PRESIDENT",
    kind: "DEADLINE",
    source: "2026-2027 Simon's Club Transition Process",
  },
  {
    key: "transition-accept",
    title: "New leaders accept or decline",
    description: "Deadline for new club leaders to accept or reject offers.",
    date: "2027-02-24",
    seat: "PRESIDENT",
    kind: "DEADLINE",
    source: "2026-2027 Simon's Club Transition Process",
  },
  {
    key: "transition-announced",
    title: "New boards announced",
    description: "Positions announced — start of Spring B. Transition meetings begin.",
    date: "2027-03-15",
    seat: "ALL",
    kind: "DEADLINE",
    source: "2026-2027 Simon's Club Transition Process",
  },
  {
    key: "transition-meetings-end",
    title: "Transition meetings with previous board complete",
    description:
      "At least two joint transition meetings, plus a 1:1 between each new officer and their predecessor.",
    date: "2027-04-02",
    seat: "ALL",
    kind: "DEADLINE",
    source: "2026-2027 Simon's Club Transition Process",
  },
  {
    key: "business-plan-review",
    title: "Business plan review with advisors complete",
    description:
      "Final draft review meetings with club advisor(s) should occur before this date.",
    date: "2027-04-16",
    seat: "PRESIDENT",
    kind: "DEADLINE",
    source: "2026-2027 Simon's Club Transition Process",
  },

  // ── Event submission deadlines ─────────────────────────────────────────────
  {
    key: "events-fall-a-submission",
    title: "Fall A event submissions due",
    description:
      "All Fall A events must be submitted in SimonSource. New boards cannot plan events or spend budget until Fall A.",
    date: "2027-04-30",
    seat: "VP_EVENTS",
    kind: "DEADLINE",
    source: "2026-2027 Simon's Club Transition Process",
  },
  {
    key: "events-fall-b-submission",
    title: "Fall B event submissions due",
    description: "Submit Fall B event dates in SimonSource (early October).",
    date: "2026-10-07",
    seat: "VP_EVENTS",
    kind: "DEADLINE",
    source: "2026-2027 Simon's Club Transition Process",
  },
  {
    key: "events-spring-a-submission",
    title: "Spring A event submissions due",
    description: "Submit Spring A event dates in SimonSource (early December).",
    date: "2026-12-04",
    seat: "VP_EVENTS",
    kind: "DEADLINE",
    source: "2026-2027 Simon's Club Transition Process",
  },
  {
    key: "events-spring-b-submission",
    title: "Spring B event submissions due",
    description:
      "Submit Spring B event dates in SimonSource (early February). Note: new boards host no new events during Spring B.",
    date: "2027-02-04",
    seat: "VP_EVENTS",
    kind: "DEADLINE",
    source: "2026-2027 Simon's Club Transition Process",
  },
]

/** Deliverables that carry a term label, computed rather than hand-tagged. */
export function deliverablesWithTerms() {
  return DELIVERABLES.map((d) => ({ ...d, term: termForDate(d.date) }))
}
