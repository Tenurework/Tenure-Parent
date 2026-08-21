/**
 * GE-022-007 — what the command launcher can reach, and how it ranks.
 *
 * Bible §26.3.1 makes command search, keyboard shortcuts, recent items,
 * favourites and universal create "first-class paths" rather than conveniences.
 * The Studio has three sections and a growing tenant list, and the fastest path
 * to a tenant was previously: Tenants, find it in a table, click. That is three
 * decisions for something an operator does forty times a day.
 *
 * Everything here is pure so it can be tested without a browser, and because
 * the ranking is the part most likely to be quietly wrong — a launcher that
 * puts the right answer third is one people stop using.
 */

export interface Destination {
  /** Stable id. Used for recents and pins, so a renamed title keeps its history. */
  id: string
  title: string
  href: string
  /** What kind of thing this is, shown as a hint beside the title. */
  group: "Section" | "Tenant" | "Create"
  /**
   * Extra words that should match. A slug, an old name, the word an operator
   * would actually type. Never shown — this is for finding, not for reading.
   */
  keywords?: readonly string[]
}

/** The console's fixed destinations. Order is the operator's workflow, not the alphabet. */
export const STATIC_DESTINATIONS: readonly Destination[] = [
  {
    id: "tenants",
    title: "Tenants",
    href: "/tenants",
    group: "Section",
    keywords: ["fleet", "customers", "orgs", "institutions"],
  },
  { id: "systems", title: "Systems", href: "/", group: "Section", keywords: ["home", "overview", "configured"] },
  // The ten operator surfaces the rail reaches. They were absent, so Ctrl-K
  // offered three destinations for a console with fourteen — and the ONE
  // `/platform*` entry it did offer was `/platform`, the quarantined build
  // report, which is the worst possible page to be the only one findable. A
  // launcher that cannot reach most of the product is a second, worse
  // navigation, and an operator who misses twice stops opening it.
  //
  // Titles are the rail's `label` verbatim, not a synonym. The two navigations
  // naming the same page differently is how they drift apart; if a label
  // changes in Nav.tsx, it changes here in the same commit.
  { id: "estate", title: "Estate", href: "/platform/estate", group: "Section", keywords: ["aws", "account", "inventory", "resources", "topology"] },
  { id: "network", title: "Network", href: "/platform/network", group: "Section", keywords: ["vpc", "subnet", "security group", "elb", "tls", "edge"] },
  { id: "compute", title: "Compute", href: "/platform/compute", group: "Section", keywords: ["ecs", "service", "task", "lambda", "runtime", "stopped"] },
  { id: "messaging", title: "Messaging", href: "/platform/messaging", group: "Section", keywords: ["sqs", "sns", "eventbridge", "ses", "queue", "dlq"] },
  { id: "identity", title: "Identity", href: "/platform/identity", group: "Section", keywords: ["iam", "cognito", "secrets", "keys", "analyzer"] },
  { id: "data", title: "Data", href: "/platform/data", group: "Section", keywords: ["dynamodb", "rds", "s3", "cache", "backup", "restore"] },
  { id: "findings", title: "Findings", href: "/platform/security", group: "Section", keywords: ["security", "severity", "sla", "guardduty"] },
  { id: "health", title: "Health", href: "/platform/health", group: "Section", keywords: ["alarms", "cloudwatch", "coverage", "logs"] },
  { id: "cost", title: "Cost", href: "/platform/cost", group: "Section", keywords: ["finops", "budget", "spend", "allocation"] },
  { id: "audit", title: "Audit", href: "/platform/audit", group: "Section", keywords: ["evidence", "ledger", "chain", "retention", "hold"] },
  // Kept, and deliberately last of the sections: it is the engine's own build
  // report and is quarantined, so it should be findable and should not be what
  // an operator lands on first.
  { id: "platform", title: "Platform", href: "/platform", group: "Section", keywords: ["engine", "ledger", "build report"] },
  // Universal create. Bible §26.3.1 lists it beside command search for a
  // reason: the most common reason to open a launcher is to make something.
  {
    id: "create-tenant",
    title: "Compose a tenant",
    href: "/tenants/new",
    group: "Create",
    keywords: ["new", "add", "provision", "compose", "create"],
  },
]

export function tenantDestination(slug: string, displayName: string): Destination {
  return {
    id: `tenant:${slug}`,
    title: displayName,
    href: `/tenants/${slug}`,
    group: "Tenant",
    keywords: [slug],
  }
}

/**
 * How well a destination matches a query, or `null` for no match.
 *
 * Higher is better. The tiers exist because an operator typing `pl` means
 * `Platform`, not `Simon Business School` — a substring match anywhere would
 * rank them equally, and a launcher that does that is one people stop trusting
 * after the first wrong Enter.
 *
 *   3  the title starts with the query
 *   2  a word inside the title starts with it
 *   1  a keyword starts with it, or the title merely contains it
 *
 * Deliberately prefix-based rather than fuzzy. Fuzzy matching finds `Platform`
 * for `ptf`, and it also finds four other things, which is worse for a list a
 * person is about to press Enter on without reading.
 */
export function score(destination: Destination, query: string): number | null {
  const q = query.trim().toLowerCase()
  if (q === "") return 0

  const title = destination.title.toLowerCase()
  if (title.startsWith(q)) return 3
  if (title.split(/[\s-]+/).some((word) => word.startsWith(q))) return 2
  if ((destination.keywords ?? []).some((k) => k.toLowerCase().startsWith(q))) return 1
  if (title.includes(q)) return 1
  return null
}

/**
 * The list to show, ranked.
 *
 * With no query this is recents first, then everything else — the launcher's
 * most common use is "back to the thing I was just in". With a query, score
 * decides, and recency breaks ties: two equally good matches should not be
 * ordered by whichever happens to be earlier in an array.
 */
export function rank(
  destinations: readonly Destination[],
  query: string,
  recent: readonly string[],
  pinned: readonly string[] = [],
): readonly Destination[] {
  const recencyOf = (id: string) => {
    const index = recent.indexOf(id)
    return index === -1 ? -1 : recent.length - index
  }

  const scored = destinations
    .map((d) => ({ d, s: score(d, query) }))
    .filter((x): x is { d: Destination; s: number } => x.s !== null)

  return scored
    .sort((a, b) => {
      // Pins outrank everything, including a better text match. A pin is an
      // explicit statement about what matters; a score is a guess.
      const pinDelta = Number(pinned.includes(b.d.id)) - Number(pinned.includes(a.d.id))
      if (pinDelta !== 0) return pinDelta
      if (b.s !== a.s) return b.s - a.s
      const recencyDelta = recencyOf(b.d.id) - recencyOf(a.d.id)
      if (recencyDelta !== 0) return recencyDelta
      return a.d.title.localeCompare(b.d.title)
    })
    .map((x) => x.d)
}

/** How many recents are kept. Beyond this the list stops being "recent". */
export const RECENT_LIMIT = 5

/**
 * Record a visit.
 *
 * Most recent first, de-duplicated, bounded. Returns a new array — the caller
 * persists it, and a mutation here would change a list another render is
 * already showing.
 */
export function remember(recent: readonly string[], id: string): readonly string[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, RECENT_LIMIT)
}

/** Pin or unpin. Pins are unbounded on purpose: an operator who pins twenty things meant to. */
export function togglePin(pinned: readonly string[], id: string): readonly string[] {
  return pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id]
}

/**
 * Which destination a keyboard move lands on.
 *
 * Wraps at both ends, and returns 0 for an empty list rather than -1 — an index
 * of -1 into an empty list is the same as an index of 0 into an empty list, and
 * only one of them stays correct when the list refills.
 */
export function moveSelection(current: number, length: number, delta: number): number {
  if (length === 0) return 0
  return (current + delta + length) % length
}
