/**
 * Approval SLA / aging — how long a request has sat in its current gate, and
 * whether that should raise a flag. Pure + framework-free so it runs the same on
 * the list, the detail page, and in reports.
 *
 * Counted in WORKING days, from the institution's own calendar — the documented
 * follow-on that used to sit here, now closed by GE-022-004. A closure day and
 * a weekend do not age a request, because nobody was there to move it.
 * Thresholds:
 *   0–2 days  ok         · nothing to see
 *   3–5 days  attention  · amber — nudge the gate owner
 *   6+  days  overdue    · red — this is stuck
 */
import {
  DEFAULT_BUSINESS_CALENDAR,
  businessDaysBetween,
  type BusinessCalendar,
} from "@tenure/platform-config"

export type SlaLevel = "ok" | "attention" | "overdue" | "none"

const PENDING_STATES = new Set(["DRAFT", "PENDING_PRESIDENT", "NEEDS_CHANGES", "PENDING_OSE"])

export const SLA_ATTENTION_DAYS = 3
export const SLA_OVERDUE_DAYS = 6

export function approvalSla(
  status: string,
  since: Date,
  now: Date = new Date(),
  calendar: BusinessCalendar = DEFAULT_BUSINESS_CALENDAR,
): { level: SlaLevel; days: number; label: string } {
  if (!PENDING_STATES.has(status)) return { level: "none", days: 0, label: "" }

  // Working days, not calendar days (GE-022-004). A request submitted on Friday
  // afternoon was two days old on Sunday and flagged for attention on Monday
  // morning, before anyone could have looked at it — the SLA was measuring the
  // weekend. The institution says which days it works and which dates it is
  // closed; both come from the resolved localization.
  const days = businessDaysBetween(since, now, calendar)
  const level: SlaLevel =
    days >= SLA_OVERDUE_DAYS ? "overdue" : days >= SLA_ATTENTION_DAYS ? "attention" : "ok"
  const label =
    days === 0
      ? "in stage today"
      : days === 1
        ? "1 working day in stage"
        : `${days} working days in stage`
  return { level, days, label }
}

/** The token colour for an SLA level (used for the aging dot/flag). */
export function slaColor(level: SlaLevel): string {
  return level === "overdue"
    ? "var(--error)"
    : level === "attention"
      ? "var(--warning)"
      : "var(--text-3)"
}
