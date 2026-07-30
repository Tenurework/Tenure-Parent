/**
 * Approval SLA / aging — how long a request has sat in its current gate, and
 * whether that should raise a flag. Pure + framework-free so it runs the same on
 * the list, the detail page, and in reports.
 *
 * Calendar-day based for the pilot; pausing the clock over academic breaks is a
 * documented follow-on (it needs the term calendar wired in). Thresholds:
 *   0–2 days  ok         · nothing to see
 *   3–5 days  attention  · amber — nudge the gate owner
 *   6+  days  overdue    · red — this is stuck
 */

export type SlaLevel = "ok" | "attention" | "overdue" | "none"

const PENDING_STATES = new Set(["DRAFT", "PENDING_PRESIDENT", "NEEDS_CHANGES", "PENDING_OSE"])

export const SLA_ATTENTION_DAYS = 3
export const SLA_OVERDUE_DAYS = 6

export function approvalSla(
  status: string,
  since: Date,
  now: Date = new Date()
): { level: SlaLevel; days: number; label: string } {
  if (!PENDING_STATES.has(status)) return { level: "none", days: 0, label: "" }

  const days = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 86_400_000))
  const level: SlaLevel =
    days >= SLA_OVERDUE_DAYS ? "overdue" : days >= SLA_ATTENTION_DAYS ? "attention" : "ok"
  const label =
    days === 0 ? "in stage today" : days === 1 ? "1 day in stage" : `${days} days in stage`
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
