/**
 * GE-033-004 — break-glass.
 *
 * Bible §14.6, the sentence after the one that governs support sessions:
 * "Break-glass is separately controlled, alarms immediately, and requires
 * post-incident review."
 *
 * A support session (GE-033-003) needs tenant approval or incident policy.
 * Break-glass is what exists when neither is available in time — nobody at the
 * tenant can approve at 03:00 and the incident is now. It therefore drops the
 * one control that requires another party, and **tightens every control that
 * does not**: an hour rather than eight, an alarm that is not optional, and a
 * review that blocks the next use rather than being requested politely.
 *
 * ## "No routine use" is enforced, not asked for
 *
 * The requirement's fourth clause is the one that decays first. Every
 * break-glass use has a good reason at the time, and a mechanism used weekly is
 * ordinary access with an alarming name. Two things make that visible here:
 *
 *   * an unreviewed use **blocks the next one by the same operator**, so the
 *     review is load-bearing rather than a courtesy; and
 *   * `routineUse` reports when the rate crosses a threshold, so "we break glass
 *     a lot" is a number somebody sees rather than a feeling nobody raises.
 *
 * Neither is a technical control against a determined operator. Both make the
 * pattern impossible to hold and not notice, which is the realistic goal.
 */

/** Break-glass is measured in an incident's timescale, not a working day's. */
export const MAX_MINUTES = 60

/** How long after closing a use may go unreviewed before it blocks the next one. */
export const REVIEW_DEADLINE_HOURS = 72

/** More than this many uses by one operator inside the window is not exceptional. */
export const ROUTINE_THRESHOLD = 3
export const ROUTINE_WINDOW_DAYS = 30

export interface BreakGlassReview {
  reviewedBy: string
  reviewedAt: string
  /** What the review concluded. Required — "reviewed" with no finding is a tick. */
  finding: string
  /** Whether the reviewer judged the use justified. Recorded either way. */
  justified: boolean
}

export interface BreakGlassUse {
  id: string
  tenantId: string
  operator: string
  /** The incident this was taken under. Not a support ticket — a live incident. */
  incidentRef: string
  justification: string
  openedAt: string
  expiresAt: string
  /** When the operator ended it, or null while open. */
  closedAt: string | null
  review: BreakGlassReview | null
}

export interface BreakGlassProblem {
  field: string
  detail: string
}

export function validateUse(use: BreakGlassUse): readonly BreakGlassProblem[] {
  const problems: BreakGlassProblem[] = []

  if (!use.incidentRef.trim()) {
    problems.push({
      field: "incidentRef",
      detail: "No incident. Break-glass exists for an incident; without one this is support access taken the wrong way.",
    })
  }
  if (use.justification.trim().length < 20) {
    problems.push({
      field: "justification",
      detail:
        "Break-glass skips the approval another party would have given, so the justification is the " +
        "only account of why. A sentence fragment is not one.",
    })
  }
  if (!use.operator.trim()) problems.push({ field: "operator", detail: "No operator recorded." })

  const opened = Date.parse(use.openedAt)
  const expires = Date.parse(use.expiresAt)
  if (Number.isNaN(opened)) problems.push({ field: "openedAt", detail: "Not a time." })
  if (Number.isNaN(expires)) {
    problems.push({ field: "expiresAt", detail: "No expiry. Break-glass with no end is a standing key." })
  } else if (!Number.isNaN(opened)) {
    const minutes = (expires - opened) / 60_000
    if (minutes <= 0) problems.push({ field: "expiresAt", detail: "Expires before it opens." })
    else if (minutes > MAX_MINUTES) {
      problems.push({
        field: "expiresAt",
        detail: `${minutes.toFixed(0)} minutes exceeds the ${MAX_MINUTES}-minute maximum. A longer incident is a support session, requested properly.`,
      })
    }
  }

  return problems
}

export interface BreakGlassAlarm {
  useId: string
  tenantId: string
  operator: string
  incidentRef: string
  at: string
  /** Always the highest. There is no quiet break-glass. */
  severity: "critical"
  message: string
}

/**
 * The alarm for a use.
 *
 * `openBreakGlass` is the only way to construct a use, and it returns the alarm
 * alongside it — so there is no code path that opens break-glass without
 * producing one. An alarm raised by a separate call is an alarm somebody can
 * forget, and the forgetting looks exactly like a quiet incident.
 */
export function alarmFor(use: BreakGlassUse): BreakGlassAlarm {
  return {
    useId: use.id,
    tenantId: use.tenantId,
    operator: use.operator,
    incidentRef: use.incidentRef,
    at: use.openedAt,
    severity: "critical",
    message:
      `Break-glass opened on ${use.tenantId} by ${use.operator} under incident ${use.incidentRef}. ` +
      `No tenant approval was obtained. Expires ${use.expiresAt}.`,
  }
}

export type RefusalReason = "MALFORMED" | "UNREVIEWED_PRIOR_USE" | "ROUTINE_USE"

export interface OpenRefused {
  opened: false
  reason: RefusalReason
  detail: string
}

export interface OpenGranted {
  opened: true
  use: BreakGlassUse
  /** Produced here, so it cannot be skipped. */
  alarm: BreakGlassAlarm
}

export type OpenOutcome = OpenGranted | OpenRefused

/**
 * Uses by this operator that are closed and still unreviewed past the deadline.
 *
 * Only closed uses count: an open one has not finished, and demanding its review
 * would mean break-glass blocked itself the moment it was used.
 */
export function unreviewedOverdue(
  history: readonly BreakGlassUse[],
  operator: string,
  at: Date,
): readonly BreakGlassUse[] {
  return history.filter((use) => {
    if (use.operator !== operator) return false
    if (use.review !== null) return false
    if (use.closedAt === null) return false
    const closed = Date.parse(use.closedAt)
    if (Number.isNaN(closed)) return false
    return at.getTime() - closed > REVIEW_DEADLINE_HOURS * 3_600_000
  })
}

/**
 * Whether this operator's break-glass has stopped being exceptional.
 *
 * Counts uses inside the window regardless of whether they were reviewed or
 * judged justified. Four justified uses in a month is still four; "each one was
 * fine" is how a pattern is explained rather than noticed.
 */
export function routineUse(
  history: readonly BreakGlassUse[],
  operator: string,
  at: Date,
): { routine: boolean; count: number } {
  const since = at.getTime() - ROUTINE_WINDOW_DAYS * 86_400_000
  const count = history.filter((use) => {
    if (use.operator !== operator) return false
    const opened = Date.parse(use.openedAt)
    return !Number.isNaN(opened) && opened >= since
  }).length
  return { routine: count >= ROUTINE_THRESHOLD, count }
}

/**
 * Open break-glass, or refuse and say why.
 *
 * The only constructor. Every refusal is a decision somebody can appeal by
 * doing the thing that was skipped — reviewing the last use, or requesting a
 * support session instead.
 */
export function openBreakGlass(
  use: BreakGlassUse,
  history: readonly BreakGlassUse[],
  at: Date,
): OpenOutcome {
  const problems = validateUse(use)
  if (problems.length > 0) {
    return {
      opened: false,
      reason: "MALFORMED",
      detail: problems.map((p) => `${p.field}: ${p.detail}`).join("; "),
    }
  }

  const overdue = unreviewedOverdue(history, use.operator, at)
  if (overdue.length > 0) {
    return {
      opened: false,
      reason: "UNREVIEWED_PRIOR_USE",
      detail:
        `${overdue.length} earlier use(s) by ${use.operator} are past the ${REVIEW_DEADLINE_HOURS}-hour ` +
        `review deadline: ${overdue.map((u) => u.id).join(", ")}. Review makes the next use possible; ` +
        `that is what stops it becoming a formality.`,
    }
  }

  const routine = routineUse(history, use.operator, at)
  if (routine.routine) {
    return {
      opened: false,
      reason: "ROUTINE_USE",
      detail:
        `${use.operator} has opened break-glass ${routine.count} times in ${ROUTINE_WINDOW_DAYS} days. ` +
        `At that rate it is not exceptional access, and the underlying reason needs fixing rather ` +
        `than working around. Request a support session, or escalate the gap.`,
    }
  }

  return { opened: true, use, alarm: alarmFor(use) }
}

export interface ReviewProblem {
  field: string
  detail: string
}

/**
 * Whether a post-use review is one.
 *
 * The reviewer must not be the operator, for the same reason every other
 * approval in this system requires a second identity: a review of one's own
 * emergency is a note to file.
 */
export function validateReview(use: BreakGlassUse, review: BreakGlassReview): readonly ReviewProblem[] {
  const problems: ReviewProblem[] = []

  if (review.reviewedBy === use.operator) {
    problems.push({
      field: "reviewedBy",
      detail: `${review.reviewedBy} opened this use. A review of one's own emergency is a note to file.`,
    })
  }
  if (!review.reviewedBy.trim()) problems.push({ field: "reviewedBy", detail: "No reviewer." })
  if (review.finding.trim().length < 12) {
    problems.push({
      field: "finding",
      detail: "A review with no finding is a tick. Say what happened and whether it should have.",
    })
  }
  if (use.closedAt === null) {
    problems.push({
      field: "use",
      detail: "This use is still open. A post-use review of an ongoing access has nothing to conclude.",
    })
  }

  return problems
}
