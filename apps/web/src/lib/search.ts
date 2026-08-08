/**
 * Permission-aware retrieval (blueprint §Search & AI).
 * Pure scoring/snippet helpers — the query layer filters by RBAC first,
 * then these rank whatever the user is allowed to see.
 */

import type { ProjectedKind, ProjectionMode } from "@/lib/relay/projection-policy"
import { isAnswerable, type ProjectedState, type SourceCitation } from "@/lib/relay/citation"

export interface SearchDoc {
  id: string
  kind: ProjectedKind
  title: string
  body: string
  href: string
  context: string // e.g. club name — shown with the citation
  /**
   * WRK-010-003. How much of this source may be projected (Bible §3.4).
   *
   * Required, not optional, and that is the whole point: an optional field a
   * builder forgets to set compiles, passes every unit test that writes its own
   * fixtures, and fails only in production. Making it required means `tsc`
   * enumerates every construction site — the five in `search-data.ts`, the
   * fixture helper in `search.test.ts`, and any future one — and each has to
   * answer the question rather than inherit an answer.
   *
   * A `REFERENCE_ONLY` doc carries no `body` at all: `loadSearchCorpus` drops
   * it at construction, so it is absent from scoring, from `/api/search`'s
   * snippets, and from the model prompt.
   */
  mode: ProjectionMode
  /**
   * WRK-GATE-070. When the underlying row last changed.
   *
   * Required, for the reason `mode` states above and which held again here: the
   * five builders in `search-data.ts` selected no temporal column at all, so no
   * consumer *could* have shown freshness. Making this required is what made
   * `tsc` enumerate the five builders and the fixture helper rather than leaving
   * five silent `undefined`s that compile and fail in production.
   *
   * A `Date` and not a string because this is the value that gets compared —
   * `freshnessOf` reads its ISO form, `citation.observedAt`, and the two are
   * built together by `projectTenureRecord` so they cannot disagree.
   */
  asOf: Date
  /**
   * WRK-010-005. What the platform believes about this object right now.
   *
   * Not decoration: `rankDocs` below scores only an answerable state, and
   * `modelSourceFor` withholds the body of anything else at the vendor boundary.
   * A projected row used to be simply present or absent, so it could never be
   * stale, tombstoned or quarantined — and `loadSearchCorpus` DROPPED a
   * CANCELLED event, which to every consumer is indistinguishable from the event
   * never having existed.
   */
  state: ProjectedState
  /**
   * WRK-070-003. The §9.3 citation — origin, assertion kind, version time,
   * state, governed deep link.
   *
   * `citation.state` is the same value as `state` above by construction, not by
   * convention: `projectTenureRecord` returns both and the builders destructure
   * one call.
   */
  citation: SourceCitation
}

export interface ScoredDoc extends SearchDoc {
  score: number
  snippet: string
}

/**
 * A row that matched the query and was withheld, reduced to what may be said
 * about it.
 *
 * §3.5's "show freshness and uncertainty" cuts both ways: an answer must not
 * present a deleted source as current, and it must not present a deleted source
 * as *nothing*. A member searching for the event their club cancelled is better
 * served by "this was cancelled" than by silence, which reads as "there is no
 * such event" — a different and untrue statement.
 *
 * No `body` and no `snippet`, and the absence is structural rather than a field
 * somebody remembered to leave out: there is no property on this type that could
 * carry the withheld text.
 */
export interface WithheldMatch {
  id: string
  kind: ProjectedKind
  title: string
  href: string
  context: string
  state: ProjectedState
  observedAt: string
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

/**
 * The ranked, answerable results.
 *
 * WRK-010-005 gave the lifecycle state its teeth here. A doc whose state is not
 * answerable scores zero whatever its text says, so a tombstoned, quarantined,
 * access-lost or conflicted row cannot reach a result set, a snippet, `sources`
 * on either route, or the model prompt — not because every consumer remembered
 * to check, but because there is nothing for them to consume. `withheldMatches`
 * below is how such a row is still reported, without its text.
 *
 * The check is on the state and not on the emptied body deliberately: a
 * withheld row keeps its title, and a title alone scores 6 in `scoreDoc`, so
 * "the body is empty" would have let a quarantined record rank on its title.
 */
export function rankDocs(docs: SearchDoc[], query: string, limit = 12): ScoredDoc[] {
  const terms = tokenize(query)
  return docs
    .map((d) => ({
      ...d,
      score: isAnswerable(d.state) ? scoreDoc(d, terms) : 0,
      snippet: makeSnippet(d.body, terms),
    }))
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * The rows that matched but may not be answered from, and why.
 *
 * Scored on the same terms as `rankDocs` — a withheld row's body is already
 * empty, so in practice this matches on the title — and returned without any
 * field that could carry text. `/api/search` and `/api/ai/chat` both emit it
 * beside their results, which is what turns "silently absent" into "cancelled on
 * this date".
 */
export function withheldMatches(
  docs: SearchDoc[],
  query: string,
  limit = 6,
): WithheldMatch[] {
  const terms = tokenize(query)
  return docs
    .filter((d) => !isAnswerable(d.state))
    .map((d) => ({ doc: d, score: scoreDoc(d, terms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ doc: d }) => ({
      id: d.id,
      kind: d.kind,
      title: d.title,
      href: d.href,
      context: d.context,
      state: d.state,
      observedAt: d.citation.observedAt,
    }))
}

// ─── Citation verification (WRK-GATE-070) ────────────────────────────────────

/**
 * Bracketed source numbers in a generated answer, split into the ones that were
 * offered and the ones that were not.
 *
 * Both prompts tell the model to "cite every claim with its source number in
 * brackets, e.g. [1]", and until this existed both routes returned whatever came
 * back verbatim. An answer citing [7] against six sources shipped as a grounded
 * answer — and a fabricated citation is worse than an uncited claim, because the
 * bracket is precisely what tells the reader the sentence was checked.
 *
 * `[1, 2]` and `[1][2]` are both real model output, so a group is split on
 * commas rather than only whole-bracket matches being read. Zero and negative
 * numbers are invalid rather than ignored: `[0]` names no source in a
 * one-indexed list.
 *
 * Returns the cited set too, sorted and de-duplicated, because a caller that
 * wants to render "this answer rests on sources 1 and 4" must not re-parse the
 * prose to find out.
 */
export function verifyCitations(
  answer: string,
  sourceCount: number,
): { cited: number[]; invalid: number[] } {
  const cited = new Set<number>()
  const invalid = new Set<number>()
  if (typeof answer !== "string" || answer.length === 0) {
    return { cited: [], invalid: [] }
  }

  const groups = answer.matchAll(/\[\s*(\d+(?:\s*,\s*\d+)*)\s*\]/g)
  for (const group of groups) {
    for (const raw of group[1].split(",")) {
      const n = Number.parseInt(raw.trim(), 10)
      if (Number.isNaN(n)) continue
      if (n >= 1 && n <= sourceCount) cited.add(n)
      else invalid.add(n)
    }
  }

  const ascending = (a: number, b: number) => a - b
  return { cited: [...cited].sort(ascending), invalid: [...invalid].sort(ascending) }
}
