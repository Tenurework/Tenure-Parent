import {
  bucketOf,
  groupWorkItems,
  needsAttentionCount,
  orderWorkItems,
  type WorkItem,
} from "./work-inbox"

const NOW = Date.parse("2026-03-10T12:00:00.000Z")
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function item(over: Partial<WorkItem> & Pick<WorkItem, "id">): WorkItem {
  return {
    kind: "approval",
    title: `item ${over.id}`,
    context: "Simon Consulting Club",
    href: `/approvals/${over.id}`,
    dueAtMs: null,
    createdAtMs: NOW,
    ...over,
  }
}

describe("which band a piece of work falls in", () => {
  it("puts a deadline that has passed in overdue, not in today", () => {
    expect(bucketOf(item({ id: "a", dueAtMs: NOW - HOUR }), NOW)).toBe("overdue")
  })

  it("counts the next 24 hours as today, so 09:00 tomorrow is not 'later'", () => {
    // Read at noon, due at 09:00 the next morning: 21 hours out. A calendar-day
    // rule would file this under "this week" and let somebody miss it.
    expect(bucketOf(item({ id: "a", dueAtMs: NOW + 21 * HOUR }), NOW)).toBe("today")
  })

  it("separates this week from later at the seven-day boundary", () => {
    expect(bucketOf(item({ id: "a", dueAtMs: NOW + 6 * DAY }), NOW)).toBe("this-week")
    expect(bucketOf(item({ id: "b", dueAtMs: NOW + 8 * DAY }), NOW)).toBe("later")
  })

  it("leaves a mention undated rather than inventing a deadline for it", () => {
    expect(bucketOf(item({ id: "a", kind: "mention", dueAtMs: null }), NOW)).toBe("no-date")
  })
})

describe("the single ordered list", () => {
  /**
   * The ids here are chosen to DEFEAT the id tiebreak, not to read nicely.
   *
   * With `a-mention` / `z-approval` the alphabetical fallback produces the
   * WRONG answer, so the expected order can only come from the bucket
   * comparison. Written the obvious way round — `approval` and `mention` — the
   * case passed with the bucket comparison deleted, because alphabetical order
   * happened to agree with it. That is a test that proves nothing, and it was
   * caught by running the mutation rather than by reading the test.
   */
  it("ranks an overdue approval above an unread mention", () => {
    // The defect this whole module exists to prevent: five sources merged by
    // recency would put a greeting that arrived a minute ago above a request
    // that went overdue yesterday.
    const mention = item({
      id: "a-mention",
      kind: "mention",
      dueAtMs: null,
      createdAtMs: NOW - 60_000,
    })
    const overdue = item({ id: "z-approval", dueAtMs: NOW - DAY })

    expect(orderWorkItems([mention, overdue], NOW).map((i) => i.id)).toEqual([
      "z-approval",
      "a-mention",
    ])
  })

  it("ranks even a far-off deadline above an undated mention", () => {
    // The bucket comparison is the ONLY thing separating a dated item from an
    // undated one — `dueAtMs` cannot be compared against `null`. Ids again
    // chosen so the alphabetical fallback would answer the other way.
    const mention = item({ id: "a-mention", kind: "mention", dueAtMs: null })
    const later = item({ id: "z-deliverable", kind: "due", dueAtMs: NOW + 40 * DAY })

    expect(orderWorkItems([mention, later], NOW).map((i) => i.id)).toEqual([
      "z-deliverable",
      "a-mention",
    ])
  })

  it("puts the longest-waiting overdue item first, not the most recent one", () => {
    const twoDays = item({ id: "old", dueAtMs: NOW - 2 * DAY })
    const oneHour = item({ id: "fresh", dueAtMs: NOW - HOUR })

    expect(orderWorkItems([oneHour, twoDays], NOW).map((i) => i.id)).toEqual(["old", "fresh"])
  })

  it("orders undated rows newest first, because recency is all a mention has", () => {
    const older = item({ id: "older", kind: "mention", createdAtMs: NOW - 5 * HOUR })
    const newer = item({ id: "newer", kind: "mention", createdAtMs: NOW - HOUR })

    expect(orderWorkItems([older, newer], NOW).map((i) => i.id)).toEqual(["newer", "older"])
  })

  it("is stable when two items share a deadline, so re-reading the page agrees with itself", () => {
    const b = item({ id: "b", dueAtMs: NOW + HOUR })
    const a = item({ id: "a", dueAtMs: NOW + HOUR })

    expect(orderWorkItems([b, a], NOW).map((i) => i.id)).toEqual(["a", "b"])
    expect(orderWorkItems([a, b], NOW).map((i) => i.id)).toEqual(["a", "b"])
  })

  it("does not mutate what it was handed", () => {
    const given = [item({ id: "z", dueAtMs: NOW + DAY }), item({ id: "a", dueAtMs: NOW - DAY })]
    orderWorkItems(given, NOW)
    expect(given.map((i) => i.id)).toEqual(["z", "a"])
  })
})

describe("grouping for the page", () => {
  it("drops empty buckets and keeps the rest in band order", () => {
    const groups = groupWorkItems(
      [
        item({ id: "later", dueAtMs: NOW + 30 * DAY }),
        item({ id: "overdue", dueAtMs: NOW - DAY }),
        item({ id: "mention", kind: "mention", dueAtMs: null }),
      ],
      NOW,
    )
    expect(groups.map((g) => g.bucket)).toEqual(["overdue", "later", "no-date"])
    expect(groups[0].items.map((i) => i.id)).toEqual(["overdue"])
  })
})

describe("the shell badge", () => {
  it("counts only what genuinely needs attention now", () => {
    const items = [
      item({ id: "overdue", dueAtMs: NOW - DAY }),
      item({ id: "today", dueAtMs: NOW + 2 * HOUR }),
      item({ id: "week", dueAtMs: NOW + 4 * DAY }),
      item({ id: "later", dueAtMs: NOW + 40 * DAY }),
      item({ id: "mention", kind: "mention", dueAtMs: null }),
    ]
    // Not 5. A badge that counts everything reads "41" on a quiet week and
    // stops meaning anything.
    expect(needsAttentionCount(items, NOW)).toBe(2)
  })
})
