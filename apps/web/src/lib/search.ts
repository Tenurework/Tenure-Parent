/**
 * Permission-aware retrieval (blueprint §Search & AI).
 * Pure scoring/snippet helpers — the query layer filters by RBAC first,
 * then these rank whatever the user is allowed to see.
 */

export interface SearchDoc {
  id: string
  kind: "memory" | "document" | "approval" | "event" | "organization"
  title: string
  body: string
  href: string
  context: string // e.g. club name — shown with the citation
}

export interface ScoredDoc extends SearchDoc {
  score: number
  snippet: string
}

// ─── Read-time authorization (GE-062-004) ────────────────────────────────────

/**
 * The classification ladder, ordered least → most restrictive.
 *
 * `Document.sensitivity` and `MemoryRecord.sensitivity` have been in the schema
 * (`@default("standard")`) since the baseline migration and were read by nothing
 * — a classification label that no read path consults is a comment, not a
 * control. This is the ladder those columns are ranked on.
 */
export const SENSITIVITY_LEVELS = ["standard", "restricted"] as const
export type Sensitivity = (typeof SENSITIVITY_LEVELS)[number]

/**
 * Where a stored label sits on the ladder.
 *
 * The column is a free `String`, so it can hold something this ladder does not
 * know — a label a future migration adds, or a typo. An unrecognised label is
 * ranked at the **most restrictive** known level rather than waved through, so
 * the failure mode of an unknown classification is that ordinary members stop
 * seeing the row, not that everyone starts seeing it. Absent/empty means the
 * schema default, `standard`.
 */
export function sensitivityRank(label: string | null | undefined): number {
  if (label === null || label === undefined || label === "") return 0
  const known = (SENSITIVITY_LEVELS as readonly string[]).indexOf(label)
  return known === -1 ? SENSITIVITY_LEVELS.length - 1 : known
}

/** A row that has already come back from the database, before it is shown. */
export interface RetrievedRow {
  organizationId: string | null
  /** Classification label, for the row types that carry one. */
  sensitivity?: string | null
  /**
   * The person who filed the row, where the record has one. Approvals are the
   * case: `/approvals/[id]` lets a submitter read their own request whether or
   * not they can still see the club, and the corpus has to agree with the page
   * it links to.
   */
  ownerId?: string | null
}

/** What the caller may read, resolved once per request. */
export interface RetrievalVisibility {
  viewerId: string
  /** Orgs the caller may see at all. */
  visibleOrgIds: ReadonlySet<string>
  /**
   * The highest sensitivity the caller may read **in each org**, which is not
   * one number per caller: somebody can be the president of one club and an
   * ordinary member of another, and a single ceiling would carry the first
   * club's clearance into the second. An org absent from the map reads at
   * `standard`. Required rather than optional so `tsc` enumerates every call
   * site that has to answer the question.
   */
  clearanceByOrg: ReadonlyMap<string, Sensitivity>
}

/**
 * Is this already-retrieved row allowed to reach this caller?
 *
 * Read-time authorization, applied **after** retrieval and independently of the
 * `where` clause that fetched the row. The corpus that feeds `/search`,
 * `/api/search` and the Tenure AI prompt previously re-checked exactly one of
 * its five row types (memory, via `canSeeMemoryCard`) and trusted the query for
 * the rest — so the approvals loop had no check at all, and a document's
 * classification was never consulted by anything. A query predicate is not an
 * authorization decision: it is one, in one place, and it stops being correct
 * the moment somebody widens the `where`.
 *
 * Pure and database-free on purpose, so it is unit-testable without Postgres.
 */
export function authorizeRetrieved(
  row: RetrievedRow,
  visibility: RetrievalVisibility,
): boolean {
  const orgId = row.organizationId
  const orgVisible = orgId !== null && visibility.visibleOrgIds.has(orgId)
  const isOwner = row.ownerId != null && row.ownerId === visibility.viewerId
  if (!orgVisible && !isOwner) return false

  // Clearance is a property of the caller's standing *in that org*. Reading
  // one's own row in an org that is no longer visible carries no elevation.
  const ceiling =
    (orgVisible && orgId !== null ? visibility.clearanceByOrg.get(orgId) : undefined) ??
    "standard"
  return sensitivityRank(row.sensitivity) <= sensitivityRank(ceiling)
}

export function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1)
}

export function scoreDoc(doc: SearchDoc, terms: string[]): number {
  if (terms.length === 0) return 0
  const title = doc.title.toLowerCase()
  const body = doc.body.toLowerCase()
  let score = 0
  for (const t of terms) {
    if (title === t) score += 12
    else if (title.includes(t)) score += 6
    if (body.includes(t)) score += 2
  }
  // Require every term to appear somewhere — AND semantics
  const all = terms.every((t) => title.includes(t) || body.includes(t))
  return all ? score : 0
}

/** A short window of body text around the first matched term. */
export function makeSnippet(body: string, terms: string[], width = 160): string {
  const lower = body.toLowerCase()
  let idx = -1
  for (const t of terms) {
    const i = lower.indexOf(t)
    if (i !== -1 && (idx === -1 || i < idx)) idx = i
  }
  if (idx === -1) return body.slice(0, width) + (body.length > width ? "…" : "")
  const start = Math.max(0, idx - Math.floor(width / 3))
  const end = Math.min(body.length, start + width)
  return (
    (start > 0 ? "…" : "") + body.slice(start, end) + (end < body.length ? "…" : "")
  )
}

export function rankDocs(docs: SearchDoc[], query: string, limit = 12): ScoredDoc[] {
  const terms = tokenize(query)
  return docs
    .map((d) => ({ ...d, score: scoreDoc(d, terms), snippet: makeSnippet(d.body, terms) }))
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
