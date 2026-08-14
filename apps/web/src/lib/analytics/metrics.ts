/**
 * ANL-000-002 — the one place a shared analytics metric is defined.
 *
 * ## What was wrong
 *
 * `/reports` rendered **median time to decision** twice, from two
 * implementations, and they did not agree:
 *
 *   * the page computed it on the server over EVERY decided approval, and
 *     formatted anything past an hour as hours — so five days read `120.0 h`;
 *   * `ReportsAnalytics` computed it again in the browser over the reader's
 *     selected range (twelve months by default), and formatted past a day as
 *     days — so the same five days read `5.0 days`.
 *
 * Both numbers were on screen at once, under the same words, and nothing in
 * either said which population it had measured. That is what the Bible's §19
 * prohibition — "do not calculate canonical metrics independently in clients" —
 * is about, and it is what ANL-GATE-000 means by "one governed definition".
 *
 * The same page also decided what an OPEN approval is in three places: the page
 * summed two `statusCount(...)` calls, `/api/reports/pulse` ran two
 * `db.approvalRequest.count` calls with the statuses written out again, and the
 * panel's funnel listed the stages a third time. A status added to the workflow
 * would have had to be found in all three.
 *
 * ## What this module is, and what it deliberately is not
 *
 * It is the formula and the presentation of these metrics, and nothing else. It
 * reads no rows: server pages and the polling endpoint fetch their own data
 * under their own tenant scope, and hand the numbers here. Putting a Prisma
 * client behind this would have made an analytics helper into a data-access
 * path that bypasses the scoping every caller already applies.
 *
 * It is NOT a semantic-model registry. Persisted `MetricDefinition` /
 * `MetricVersion` objects with effective dates are ANL-000-003, and they need a
 * schema change this file cannot make.
 *
 * A metric that lives here is one the product states in more than one place.
 * A figure rendered once, by one page, from one query, is that page's business —
 * moving it here would centralise nothing and hide the query from its reader.
 */

/**
 * ### Metric: open approvals
 *
 * **Question.** How many approval requests are waiting for a human decision?
 * **Grain.** One approval request. **Unit.** requests. **Additive** across
 * organizations within an institution. **Source.** `ApprovalRequest.status`.
 *
 * A request is open when it is waiting on somebody. `DRAFT` is not — nobody has
 * been asked yet — and `NEEDS_CHANGES` is not, because the ball is back with the
 * requester. Adding a status to the workflow means adding it here, once.
 */
export const OPEN_APPROVAL_STATUSES = ["PENDING_PRESIDENT", "PENDING_OSE"] as const

export type OpenApprovalStatus = (typeof OPEN_APPROVAL_STATUSES)[number]

/**
 * ### Metric: undecided approvals
 *
 * **Question.** How much approval work is still in flight — including what has
 * not been submitted and what has come back for changes?
 * **Grain.** One approval request. **Unit.** requests. **Additive** within an
 * organization. **Source.** `ApprovalRequest.status`.
 *
 * This is a DIFFERENT population from `OPEN_APPROVAL_STATUSES` and both were
 * being rendered under the word "pending": `/orgs/[slug]/impact` summed four
 * statuses, `/reports` summed two, and neither said which. They are both
 * legitimate questions — "what is waiting on me" and "what is unfinished" — and
 * the defect was never the arithmetic. It was that one word meant two things
 * and no caller could tell which one it had.
 */
export const UNDECIDED_APPROVAL_STATUSES = [
  "DRAFT",
  "PENDING_PRESIDENT",
  "NEEDS_CHANGES",
  "PENDING_OSE",
] as const

export type UndecidedApprovalStatus = (typeof UNDECIDED_APPROVAL_STATUSES)[number]

/** Whether a request in this status is still in flight, decided or not. */
export function isUndecidedApproval(status: string): boolean {
  return (UNDECIDED_APPROVAL_STATUSES as readonly string[]).includes(status)
}

/** Whether a request in this status is waiting on a decision. */
export function isOpenApproval(status: string): boolean {
  return (OPEN_APPROVAL_STATUSES as readonly string[]).includes(status)
}

/** Open approvals among a set of requests whose statuses are already loaded. */
export function countOpenApprovals(requests: readonly { status: string }[]): number {
  return requests.filter((r) => isOpenApproval(r.status)).length
}

/**
 * ### Metric: median time to decision
 *
 * **Question.** How long does an approval request wait before somebody decides
 * it? **Grain.** One decided request. **Unit.** milliseconds, presented by
 * `formatDuration`. **Non-additive** — a median of medians is not a median, so
 * this is never summed or rolled up. **Source.** `ApprovalStep.occurredAt` for
 * the step that reached `APPROVED` or `REJECTED`, minus
 * `ApprovalRequest.createdAt`.
 *
 * **Filters are the CALLER's, and must be stated by the caller.** This is the
 * defect the module exists for: the same metric over "all time" and over "the
 * last twelve months" are two legitimate numbers, and the page showed both
 * without saying which was which.
 *
 * **Limitation.** The lower median for an even-sized population, not the mean of
 * the middle two. Stated because it is a real difference on small populations,
 * which is every institution in the pilot.
 */
export function medianDurationMs(durations: readonly number[]): number | null {
  if (durations.length === 0) return null
  const sorted = [...durations].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/**
 * The one presentation ladder for a duration metric.
 *
 * Minutes below an hour, hours below a day, days above. The two implementations
 * this replaces disagreed at exactly one boundary — one of them had no day rung
 * — which is how `120.0 h` and `5.0 days` ended up on the same screen.
 *
 * `null` renders as an em dash, never as `0`: no decisions measured and a median
 * of zero are different facts, and a zero here would be a fabricated one.
 */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—"
  if (ms < HOUR_MS) return `${Math.max(1, Math.round(ms / MINUTE_MS))} min`
  if (ms < DAY_MS) return `${(ms / HOUR_MS).toFixed(1)} h`
  return `${(ms / DAY_MS).toFixed(1)} days`
}
