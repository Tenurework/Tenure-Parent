import type { ConflictSeverity } from "@prisma/client"

/**
 * Conflict detection (blueprint §Calendar).
 *
 * Four named rules, each with a fixed severity and one explanation function:
 *
 *  - VENUE_DOUBLE_BOOKING  HARD          same venue at an overlapping time
 *  - SELF_DOUBLE_BOOKING   HARD          the same club double-booking itself
 *  - AUDIENCE_OVERLAP      SOFT          another club overlaps — audience competition
 *  - SAME_DAY              INFORMATIONAL same day, no time overlap
 *
 * ── Why the rule is an identifier and not just a sentence ────────────────────
 * The classifier used to return only `{severity, reason}`, where `reason` was an
 * interpolated English sentence built at the point of detection. Nothing
 * downstream could name the rule that fired: the policy layer could not decide
 * per rule, an audit row could not record which rule was overridden, and a test
 * could only assert on prose. A change of wording silently changed the contract.
 *
 * So a conflict now carries `rule` (a stable id), `severity` (read from the rule
 * table, never passed in) and `inputs` — the facts that fired it. The sentence
 * is DERIVED from those inputs by `CONFLICT_RULES[rule].explain`, so the same
 * explanation can be re-rendered later from the record without re-running
 * detection, and two callers cannot drift into two wordings of one rule.
 */

export interface CalendarEventLike {
  id: string
  organizationId: string
  title: string
  startAt: Date
  endAt: Date
  venue?: string | null
}

/** Stable identifiers. These appear in audit metadata — do not rename lightly. */
export type ConflictRule =
  | "VENUE_DOUBLE_BOOKING"
  | "SELF_DOUBLE_BOOKING"
  | "AUDIENCE_OVERLAP"
  | "SAME_DAY"

/** The facts that fired a rule, kept so the explanation is derivable. */
export interface ConflictInputs {
  /** The proposed event's venue, normalized (lowercased, trimmed) or null. */
  venue: string | null
  otherTitle: string
  otherVenue: string | null
  otherStartAt: Date
  otherEndAt: Date
}

export interface ConflictRuleSpec {
  rule: ConflictRule
  severity: ConflictSeverity
  /** Short human name of the rule itself, for UI and audit prose. */
  label: string
  explain(inputs: ConflictInputs): string
}

export const CONFLICT_RULES: Record<ConflictRule, ConflictRuleSpec> = {
  VENUE_DOUBLE_BOOKING: {
    rule: "VENUE_DOUBLE_BOOKING",
    severity: "HARD",
    label: "venue double-booking",
    explain: (i) =>
      `Venue clash: “${i.otherTitle}” is booked in ${i.otherVenue ?? i.venue} at the same time`,
  },
  SELF_DOUBLE_BOOKING: {
    rule: "SELF_DOUBLE_BOOKING",
    severity: "HARD",
    label: "club double-booking",
    explain: (i) => `Double booking: your club already has “${i.otherTitle}” at this time`,
  },
  AUDIENCE_OVERLAP: {
    rule: "AUDIENCE_OVERLAP",
    severity: "SOFT",
    label: "audience overlap",
    explain: (i) => `Overlaps “${i.otherTitle}” — students may have to choose between them`,
  },
  SAME_DAY: {
    rule: "SAME_DAY",
    severity: "INFORMATIONAL",
    label: "same day",
    explain: (i) => `Same day as “${i.otherTitle}”`,
  },
}

export interface DetectedConflict {
  conflictWithEventId: string
  /** Which rule fired. The policy layer decides on this, not on prose. */
  rule: ConflictRule
  /** Always `CONFLICT_RULES[rule].severity` — carried for the persisted row. */
  severity: ConflictSeverity
  /** Derived from `inputs` by the rule; never authored at the call site. */
  reason: string
  inputs: ConflictInputs
}

/** Re-derive a conflict's explanation from the facts that fired it. */
export function explainConflict(rule: ConflictRule, inputs: ConflictInputs): string {
  return CONFLICT_RULES[rule].explain(inputs)
}

/**
 * Is this conflict blocking?
 *
 * Severity is read from the rule table rather than from the record, so a
 * hand-built or round-tripped conflict cannot claim a severity its rule does not
 * carry. An unrecognised rule falls back to the record's own severity, which
 * fails closed for anything that says HARD.
 */
export function isBlockingConflict(c: Pick<DetectedConflict, "rule" | "severity">): boolean {
  return (CONFLICT_RULES[c.rule]?.severity ?? c.severity) === "HARD"
}

export function overlaps(a: { startAt: Date; endAt: Date }, b: { startAt: Date; endAt: Date }): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  )
}

function normalizeVenue(v?: string | null): string | null {
  const s = v?.trim().toLowerCase()
  return s ? s : null
}

function fire(
  rule: ConflictRule,
  other: CalendarEventLike,
  proposedVenue: string | null
): DetectedConflict {
  const inputs: ConflictInputs = {
    venue: proposedVenue,
    otherTitle: other.title,
    otherVenue: other.venue ?? null,
    otherStartAt: other.startAt,
    otherEndAt: other.endAt,
  }
  const spec = CONFLICT_RULES[rule]
  return {
    conflictWithEventId: other.id,
    rule,
    severity: spec.severity,
    reason: spec.explain(inputs),
    inputs,
  }
}

/**
 * Compare a proposed event against existing events (same institution,
 * excluding cancelled ones) and classify each collision.
 */
export function detectConflicts(
  proposed: Omit<CalendarEventLike, "id"> & { id?: string },
  existing: CalendarEventLike[]
): DetectedConflict[] {
  const conflicts: DetectedConflict[] = []
  const venue = normalizeVenue(proposed.venue)

  for (const other of existing) {
    if (proposed.id && other.id === proposed.id) continue

    if (overlaps(proposed, other)) {
      const otherVenue = normalizeVenue(other.venue)
      if (venue && otherVenue && venue === otherVenue) {
        conflicts.push(fire("VENUE_DOUBLE_BOOKING", other, venue))
      } else if (other.organizationId === proposed.organizationId) {
        conflicts.push(fire("SELF_DOUBLE_BOOKING", other, venue))
      } else {
        conflicts.push(fire("AUDIENCE_OVERLAP", other, venue))
      }
    } else if (sameDay(proposed.startAt, other.startAt)) {
      conflicts.push(fire("SAME_DAY", other, venue))
    }
  }

  // HARD first, then SOFT, then INFORMATIONAL
  const rank: Record<ConflictSeverity, number> = { HARD: 0, SOFT: 1, INFORMATIONAL: 2 }
  return conflicts.sort((a, b) => rank[a.severity] - rank[b.severity])
}
