/**
 * TTES-030-001, Bible §5.1 — the work inbox's ordering, as a pure function.
 *
 * §5.1 requires the universal shell to carry a "Work inbox with approvals,
 * tasks, exceptions, mentions and due items". The product had five separate
 * places to look — `/approvals` for requests, `/notifications` for mentions,
 * `/calendar` for deliverables, and nothing at all for exceptions — so the
 * question "what needs me today" had no page that could answer it.
 *
 * Five sources with five different shapes have to become ONE ordered list, and
 * the ordering is the whole point: an inbox that lists an unread greeting above
 * an approval that went overdue yesterday is a worse answer than five tabs. So
 * the merge and the ordering live here, in a module with no database, no React
 * and no `Date.now()` — `now` is a parameter — which is what makes the rule
 * testable at all under this app's `testEnvironment: "node"` jest.
 *
 * The route (`src/app/(app)/inbox/page.tsx`) is the production caller: it reads
 * the five sources, maps each row to a `WorkItem`, and renders exactly what
 * `orderWorkItems` returns, in that order, grouped by `bucketOf`.
 */

export type WorkKind = "approval" | "exception" | "mention" | "due" | "task"

export interface WorkItem {
  id: string
  kind: WorkKind
  title: string
  /** Which club or institution this belongs to — an inbox row with no home is unusable. */
  context: string
  href: string
  /**
   * When this needs attention, as epoch milliseconds. `null` for the genuinely
   * undated — a mention has no deadline, and inventing one to make the sort
   * simpler would rank it against work that really does expire.
   */
  dueAtMs: number | null
  /** When the row appeared, for ordering the undated ones. */
  createdAtMs: number
}

export type WorkBucket = "overdue" | "today" | "this-week" | "later" | "no-date"

/** Rendering order of the buckets, and the only place that order is written. */
export const BUCKET_ORDER: readonly WorkBucket[] = [
  "overdue",
  "today",
  "this-week",
  "later",
  "no-date",
]

export const BUCKET_LABELS: Record<WorkBucket, string> = {
  overdue: "Overdue",
  today: "Due today",
  "this-week": "Due this week",
  later: "Later",
  "no-date": "No deadline",
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Which band an item falls in.
 *
 * "Today" is the next 24 hours rather than the calendar day deliberately: a
 * deliverable due at 09:00 tomorrow is not "later" to somebody reading this at
 * 23:00, and a calendar-day rule would file it under "this week" and let them
 * miss it. The same reasoning puts the boundary for "this week" at seven days
 * out rather than at Sunday.
 */
export function bucketOf(item: WorkItem, nowMs: number): WorkBucket {
  if (item.dueAtMs === null) return "no-date"
  const delta = item.dueAtMs - nowMs
  if (delta < 0) return "overdue"
  if (delta <= DAY_MS) return "today"
  if (delta <= 7 * DAY_MS) return "this-week"
  return "later"
}

/**
 * The single ordered list.
 *
 * Within the dated buckets the soonest deadline comes first — including inside
 * `overdue`, where "soonest" means the one that has been waiting LONGEST, which
 * is the one most likely to be somebody else's blocker. Undated rows sort
 * newest-first, because for a mention recency is the only signal there is.
 *
 * `id` breaks ties, so two items sharing a timestamp cannot swap places between
 * two renders of the same data. Without it the list is unstable and a
 * screen-reader user re-reading the page gets a different order.
 */
export function orderWorkItems(items: readonly WorkItem[], nowMs: number): WorkItem[] {
  return [...items].sort((a, b) => {
    const bucketDelta =
      BUCKET_ORDER.indexOf(bucketOf(a, nowMs)) - BUCKET_ORDER.indexOf(bucketOf(b, nowMs))
    if (bucketDelta !== 0) return bucketDelta

    if (a.dueAtMs !== null && b.dueAtMs !== null && a.dueAtMs !== b.dueAtMs) {
      return a.dueAtMs - b.dueAtMs
    }
    if (a.dueAtMs === null && b.dueAtMs === null && a.createdAtMs !== b.createdAtMs) {
      return b.createdAtMs - a.createdAtMs
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** The ordered list, split into its buckets, with empty buckets dropped. */
export function groupWorkItems(
  items: readonly WorkItem[],
  nowMs: number,
): { bucket: WorkBucket; items: WorkItem[] }[] {
  const ordered = orderWorkItems(items, nowMs)
  return BUCKET_ORDER.map((bucket) => ({
    bucket,
    items: ordered.filter((i) => bucketOf(i, nowMs) === bucket),
  })).filter((g) => g.items.length > 0)
}

/**
 * How many rows genuinely need attention, for the shell's inbox badge.
 *
 * Counts the overdue and the due-today only. A badge that counted everything
 * would read "41" on a quiet week and stop meaning anything, which is the
 * failure mode §5.1 is guarding against when it asks for an inbox rather than
 * a list of everything that exists.
 */
export function needsAttentionCount(items: readonly WorkItem[], nowMs: number): number {
  return items.filter((i) => {
    const bucket = bucketOf(i, nowMs)
    return bucket === "overdue" || bucket === "today"
  }).length
}
