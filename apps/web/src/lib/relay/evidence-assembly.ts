import {
  freshnessOf,
  SEARCH_STALE_AFTER_MS,
  type SourceCitation,
} from "@/lib/relay/citation"
import type { ProjectedKind } from "@/lib/relay/projection-policy"

/**
 * GE-092-004 / GE-092-007 — what is between "these rows matched" and "this is
 * the evidence an answer may rest on".
 *
 * `/api/ai/chat` did this:
 *
 *     const ranked = rankDocs(corpus, question, 24)
 *     const scored = biasToScope(ranked, askScope).slice(0, 6)
 *
 * A relevance sort and a fixed count. Six of the seven things §9.2 asks of the
 * step between retrieval and generation were absent, and each absence has a
 * failure that is invisible from inside the route:
 *
 *   * **Deduplication.** The same record reaches the corpus twice whenever two
 *     builders project it (a memory card and the document it summarises share a
 *     title and a body). Both are offered, the model sees one fact stated twice
 *     and reads the repetition as corroboration, and two of the six slots are
 *     spent on one record.
 *   * **Diversity.** `.slice(0, 6)` off a relevance sort returns six rows from
 *     one club whenever that club's records happen to use the query's words
 *     most often. "What is the budget process" then gets answered from the one
 *     organization whose documents say "budget" most, and the person is never
 *     told the other five clubs were in the corpus.
 *   * **Freshness.** The corpus stamps `STALE` and the route forwards it, but
 *     nothing counted: an answer resting entirely on rows nobody has touched
 *     since two handovers ago is presented exactly like one resting on today's.
 *   * **Contradiction detection.** Two sources asserting different values for
 *     the same fact about the same subject were both handed over with no
 *     comment, and a model asked to answer "using only the numbered sources"
 *     picks one and states it flatly.
 *   * **Citation completeness.** A source whose citation cannot identify a
 *     record is a footnote to nothing. Nothing checked before it was offered.
 *   * **Context budgeting.** Six is a count, not a budget. Six 1000-character
 *     bodies and six 40-character ones cost the tenant thirty times different
 *     amounts for the same "six sources", and the ceiling that actually exists
 *     — the model's context window — was never the thing being managed.
 *
 * ## What this module does NOT claim
 *
 * `detectContradictions` is a lexical detector over *explicit* key/value
 * assertions (`status: approved`, `venue: Hoyt 104`), not a semantic one. It
 * finds the disagreements this corpus actually carries — approval bodies are
 * built as `${description} status:${status}` in `search-data.ts`, so the shape
 * is real and not hypothetical — and it will not find two paragraphs of prose
 * that mean opposite things. Saying so here matters more than the detector
 * does: a caller that believed this was semantic would report "no
 * contradictions" as "these sources agree", and those are different answers.
 *
 * ## Determinism
 *
 * Every ordering in this file is total. Selection ties break on score, then on
 * recency, then on id — never on array position, which is the database's answer
 * and not a decision. Two runs over the same candidates produce the same
 * selection, the same drops and the same contradictions, which is what lets a
 * refusal be explained to the person who received it.
 */

// ─── Cost ────────────────────────────────────────────────────────────────────

/**
 * Characters per token, for budgeting only.
 *
 * Four. An estimate, and labelled one everywhere it is used: the vendor's own
 * count arrives on the response and is what `recordModelUsage` meters. This
 * number exists to decide what to send BEFORE anything is sent, which the
 * measured count structurally cannot do. It is deliberately not tuned against a
 * tokenizer — a budget that silently depends on a vendor's vocabulary version
 * stops meaning what it says the day the vendor ships a new one.
 */
export const CHARS_PER_TOKEN = 4

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * How many estimated tokens of retrieved evidence one answer may carry.
 *
 * 2000, against the 600-token answer cap the route already sets. The ratio is
 * the judgement: evidence has to dominate the request for a grounded answer to
 * be possible at all, and a budget large enough that nothing is ever dropped is
 * not a budget. Six sources at the corpus's own 1000-character body cap plus a
 * 300-character heading come to roughly 1950 estimated tokens, so this is the
 * point at which the existing shape of the corpus just fits — and a seventh
 * source, or a wider body cap, has to displace something rather than silently
 * enlarging every prompt.
 */
export const DEFAULT_EVIDENCE_TOKEN_BUDGET = 2000

/** How many sources one answer may rest on. The route's existing six. */
export const DEFAULT_MAX_SOURCES = 6

/**
 * How hard a repeated club or a repeated record type is penalised in selection.
 *
 * Multiplicative and scale-free — `score / (1 + λ·repeats)` — rather than
 * subtractive. A subtractive penalty has to be calibrated against whatever
 * `scoreDoc` currently returns, so the day somebody changes a weight in
 * `search.ts` from 6 to 60 the diversity term silently becomes a rounding
 * error. This one is a ratio and cannot.
 *
 * λ = 0.25 means a second row from the same club and the same kind must score
 * 1.5× a fresh perspective to keep its place, and never that a candidate is
 * excluded: this reorders, it does not drop. A cap that dropped would answer a
 * question genuinely about one club from four of its records and call the fifth
 * insufficiently diverse, which is the ranking substituting its taste for the
 * question.
 */
export const DIVERSITY_LAMBDA = 0.25

// ─── The candidate shape ─────────────────────────────────────────────────────

/**
 * The minimum a row must carry to be considered evidence.
 *
 * A structural subset of `ScoredDoc` rather than an import of it, and the
 * functions below are generic over `T extends EvidenceSource` so the route's
 * richer doc — `mode`, `snippet`, `href` — survives the round trip unchanged.
 * Naming the minimum is what keeps this module out of `search.ts`'s ranking
 * concerns: nothing here reads a score except to order by it.
 */
export interface EvidenceSource {
  id: string
  kind: ProjectedKind
  title: string
  body: string
  context: string
  asOf: Date
  citation: SourceCitation
  score: number
}

// ─── Citation completeness ───────────────────────────────────────────────────

/**
 * Which parts of §9.3's citation this source cannot supply.
 *
 * Reported rather than assumed, and the distinction this whole file is written
 * around: a source with no `versionAt` is not a fresh source, it is a source
 * whose age nobody can state. Those are different answers and collapsing them
 * is the failure. The gaps travel to the model in the unknowns channel, so an
 * answer resting on a source of unknowable age can say so.
 */
export function citationGaps(source: Pick<EvidenceSource, "citation">): readonly string[] {
  const gaps: string[] = []
  const c = source.citation as Partial<SourceCitation> | undefined
  if (!c) return ["ref", "versionAt", "observedAt", "state"]
  if (!c.ref || typeof c.ref.externalId !== "string" || c.ref.externalId === "")
    gaps.push("ref.externalId")
  if (!c.ref || typeof c.ref.provider !== "string" || c.ref.provider === "")
    gaps.push("ref.provider")
  if (typeof c.versionAt !== "string" || Number.isNaN(Date.parse(c.versionAt)))
    gaps.push("versionAt")
  if (typeof c.observedAt !== "string" || Number.isNaN(Date.parse(c.observedAt)))
    gaps.push("observedAt")
  if (typeof c.state !== "string") gaps.push("state")
  return gaps
}

/**
 * Can this citation identify the record it points at?
 *
 * The narrow half of `citationGaps`, and the only half that DROPS. A source
 * that cannot name its own record is uncitable — a `[3]` a reader cannot
 * resolve to anything is worse than no marker, because the marker is what tells
 * them the sentence was checked. A source missing only a timestamp is still
 * resolvable to an exact record, so it is offered and its gap is declared.
 */
export function citationResolves(source: Pick<EvidenceSource, "citation">): boolean {
  const gaps = citationGaps(source)
  return !gaps.includes("ref.externalId") && !gaps.includes("ref.provider")
}

// ─── Deduplication ───────────────────────────────────────────────────────────

/** Case, punctuation and whitespace folded away, so two projections of one row match. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * The identity two candidates are deduplicated on.
 *
 * Two keys, either of which is sufficient. The first is the record's own
 * external id: the same row reaching the corpus through two builders is one
 * record however it was projected, and offering it twice spends two of six
 * slots and reads as corroboration. The second is the normalised title and
 * body together — two DIFFERENT records whose text is identical are two
 * footnotes to the same sentence, and a reader gains nothing from the second.
 *
 * Title alone would be wrong: "Minutes" is a title forty clubs use.
 */
export function dedupeKeys(source: EvidenceSource): readonly string[] {
  const external = citationResolves(source)
    ? `ref:${source.citation.ref.provider}:${source.citation.ref.externalId}`
    : null
  const text = `text:${normalizeText(source.title)} ${normalizeText(source.body)}`
  return external ? [external, text] : [text]
}

// ─── Contradiction detection ─────────────────────────────────────────────────

/**
 * The keys a disagreement is detectable on.
 *
 * An allowlist, not a scan for anything shaped like `word: value`. A scan would
 * report "note: see below" against "note: attached" as a contradiction about
 * the facts of the world, and a detector that cries wolf is switched off. These
 * are the keys whose values are the answer to a question somebody asks the
 * assistant — is it approved, how much, when, where — and `status` in
 * particular is not hypothetical: `search-data.ts` builds every approval body
 * as `${description} status:${status.toLowerCase()}`.
 */
export const FACT_KEYS: readonly string[] = [
  "status",
  "amount",
  "total",
  "cost",
  "budget",
  "balance",
  "due",
  "deadline",
  "date",
  "time",
  "venue",
  "location",
  "room",
  "quantity",
]

export interface FactAssertion {
  key: string
  /** The value, normalised for comparison. */
  value: string
  /** The value as the source wrote it, for the explanation. */
  raw: string
}

const ASSERTION_PATTERN = new RegExp(
  `\\b(${FACT_KEYS.join("|")})\\s*[:=]\\s*([^\\n,;]{1,40})`,
  "gi",
)

/**
 * The explicit key/value assertions in a piece of text.
 *
 * Deliberately shallow. It reads what a record SAYS about itself in the one
 * form a machine can check without inventing an interpretation, and everything
 * it cannot read it reports as nothing rather than as agreement.
 */
export function extractAssertions(text: string): readonly FactAssertion[] {
  const found: FactAssertion[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(ASSERTION_PATTERN)) {
    const key = match[1].toLowerCase()
    const raw = match[2].trim().replace(/[.\s]+$/, "")
    if (raw === "") continue
    const value = normalizeText(raw)
    if (value === "") continue
    // One assertion per key per source. A body repeating `status: approved`
    // twice asserts it once; a body saying `status: approved … status: denied`
    // is a record contradicting ITSELF, which is a different finding and one
    // this detector does not make — it would report every source as conflicted
    // against a corpus that concatenates a description and a status.
    if (seen.has(key)) continue
    seen.add(key)
    found.push({ key, value, raw })
  }
  return found
}

/** The subject two sources have to share before their assertions can disagree. */
export function subjectOf(source: Pick<EvidenceSource, "title">): string {
  return normalizeText(source.title)
}

export interface ContradictionSide {
  id: string
  /** The value as written, so an explanation can quote it. */
  raw: string
  /** When the record asserting it was last changed, ISO-8601, or null. */
  versionAt: string | null
}

export interface Contradiction {
  /** The fact key the two sources disagree on. */
  key: string
  /** The normalised subject both sources are about. */
  subject: string
  left: ContradictionSide
  right: ContradictionSide
  /**
   * The id of the side whose record was changed more recently, or null when
   * neither carries a usable version time.
   *
   * A supersession HINT and not a resolution. The newer statement is usually
   * the true one and sometimes is not — a corrected record can be re-saved with
   * an old value — so this names which is newer and refuses to say which is
   * right. Resolving it is the reader's, and §9.2 asks the answer to surface
   * the conflict rather than to pick a winner behind their back.
   */
  newer: string | null
}

/**
 * Sources about the same subject asserting different values for the same key.
 *
 * Pairwise within a subject group, deterministic in the order the pairs are
 * reported (by key, then by the two ids). Two sources that are the SAME record
 * cannot contradict each other — a record restated is not a disagreement — so
 * pairs sharing an external id are skipped.
 */
export function detectContradictions(
  sources: readonly EvidenceSource[],
): readonly Contradiction[] {
  const bySubject = new Map<string, EvidenceSource[]>()
  for (const source of sources) {
    const subject = subjectOf(source)
    if (subject === "") continue
    const group = bySubject.get(subject)
    if (group) group.push(source)
    else bySubject.set(subject, [source])
  }

  const out: Contradiction[] = []
  for (const [subject, group] of bySubject) {
    if (group.length < 2) continue
    const assertions = new Map(
      group.map((s) => [s.id, new Map(extractAssertions(s.body).map((a) => [a.key, a]))]),
    )
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]
        const b = group[j]
        if (
          citationResolves(a) &&
          citationResolves(b) &&
          a.citation.ref.externalId === b.citation.ref.externalId &&
          a.citation.ref.provider === b.citation.ref.provider
        )
          continue
        const left = assertions.get(a.id)
        const right = assertions.get(b.id)
        if (!left || !right) continue
        for (const key of FACT_KEYS) {
          const l = left.get(key)
          const r = right.get(key)
          if (!l || !r || l.value === r.value) continue
          out.push({
            key,
            subject,
            left: { id: a.id, raw: l.raw, versionAt: usableVersion(a) },
            right: { id: b.id, raw: r.raw, versionAt: usableVersion(b) },
            newer: newerOf(a, b),
          })
        }
      }
    }
  }
  return out.sort(
    (x, y) =>
      x.subject.localeCompare(y.subject) ||
      x.key.localeCompare(y.key) ||
      x.left.id.localeCompare(y.left.id) ||
      x.right.id.localeCompare(y.right.id),
  )
}

function usableVersion(source: EvidenceSource): string | null {
  const v = source.citation?.versionAt
  return typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null
}

function newerOf(a: EvidenceSource, b: EvidenceSource): string | null {
  const av = usableVersion(a)
  const bv = usableVersion(b)
  if (av === null || bv === null) return null
  const at = Date.parse(av)
  const bt = Date.parse(bv)
  if (at === bt) return null
  return at > bt ? a.id : b.id
}

// ─── Assembly ────────────────────────────────────────────────────────────────

export type DropReason =
  /** The citation cannot name a record, so a marker pointing at it resolves to nothing. */
  | "unresolvable-citation"
  /** Another candidate is the same record, or the same text. */
  | "duplicate"
  /** It did not fit the evidence token budget. */
  | "budget"
  /** The answer already rests on `maxSources` better-ranked candidates. */
  | "rank"

export interface DroppedSource {
  id: string
  reason: DropReason
  /** For `duplicate`, the id of the candidate that was kept instead. */
  duplicateOf?: string
}

export interface SelectedSource<T> {
  source: T
  /** From the row's own version time, against the §3.5 horizon. */
  freshness: "LIVE" | "STALE"
  /** Parts of §9.3's citation this source could not supply. Usually empty. */
  citationGaps: readonly string[]
  /** Estimated tokens this source contributes to the prompt. */
  cost: number
}

/**
 * What the evidence, taken as a whole, supports.
 *
 * Five outcomes and one order of precedence, stated here because the ordering
 * is the decision:
 *
 *   1. `INACCESSIBLE` — nothing may be answered from, and rows DID match. The
 *      honest answer is "records exist and you may not read them", which is not
 *      "there is nothing".
 *   2. `INSUFFICIENT` — nothing may be answered from and nothing matched, or
 *      every selected source projected no text at all. "We looked and found
 *      nothing."
 *   3. `CONFLICTING` — the sources disagree. Ranked above staleness because a
 *      reader told "these may be out of date" and not told "these disagree"
 *      has been told the less important of the two.
 *   4. `STALE` — every selected source is past the freshness horizon.
 *   5. `SUFFICIENT`.
 */
export type EvidenceVerdict =
  | "SUFFICIENT"
  | "INSUFFICIENT"
  | "CONFLICTING"
  | "STALE"
  | "INACCESSIBLE"

export interface EvidenceAssembly<T> {
  selected: readonly SelectedSource<T>[]
  dropped: readonly DroppedSource[]
  contradictions: readonly Contradiction[]
  verdict: EvidenceVerdict
  /** Estimated tokens the selected sources will cost. */
  tokensUsed: number
  tokenBudget: number
  staleCount: number
  /** Matching rows the caller may not be answered from at all. */
  inaccessibleCount: number
  /** The freshness horizon in days, so a consumer can state it. */
  staleAfterDays: number
}

export interface AssembleOptions<T extends EvidenceSource = EvidenceSource> {
  now: Date
  maxSources?: number
  tokenBudget?: number
  /**
   * What one source will actually cost, in estimated tokens.
   *
   * Required in spirit and defaulted in fact: the route knows what crosses the
   * boundary (`modelSourceFor` applies the §3.4 projection, so a REFERENCE_ONLY
   * row contributes a heading and no body) and this module does not. The
   * default charges title plus body, which over-charges exactly the rows whose
   * text is withheld — the safe direction, since the alternative is a budget
   * that under-counts what is sent.
   */
  costOf?: (source: T) => number
  /**
   * How many matching rows were withheld from this caller entirely.
   *
   * Counts only. A withheld row's title is tenant text about a record the
   * caller may not read, and this number travels into the model prompt.
   */
  inaccessibleCount?: number
}

function defaultCost(source: EvidenceSource): number {
  return estimateTokens(source.title) + estimateTokens(source.body)
}

/**
 * Rank, dedupe, diversify, budget, and say what the result supports.
 *
 * Order matters and is not arbitrary. Unresolvable citations go first because
 * they are not evidence at all. Deduplication precedes selection so a duplicate
 * cannot consume a slot or a diversity penalty. Diversity is applied during
 * selection rather than after, because a post-hoc filter can only delete and
 * this has to be able to PROMOTE the fifth-ranked row from a club nothing else
 * covers. Budgeting is applied last, per admitted source, so the thing that
 * gets cut is the marginal source rather than the whole tail.
 */
export function assembleEvidence<T extends EvidenceSource>(
  candidates: readonly T[],
  options: AssembleOptions<T>,
): EvidenceAssembly<T> {
  const maxSources = options.maxSources ?? DEFAULT_MAX_SOURCES
  const tokenBudget = options.tokenBudget ?? DEFAULT_EVIDENCE_TOKEN_BUDGET
  const costOf = options.costOf ?? defaultCost
  const inaccessibleCount = options.inaccessibleCount ?? 0
  const dropped: DroppedSource[] = []

  // 1. A citation that cannot name a record is not a footnote.
  const resolvable: T[] = []
  for (const candidate of candidates) {
    if (citationResolves(candidate)) resolvable.push(candidate)
    else dropped.push({ id: candidate.id, reason: "unresolvable-citation" })
  }

  // 2. One record, one slot. First-seen wins, and "first" is the total order
  //    below rather than array position, so which twin survives is a decision.
  const ordered = [...resolvable].sort(compareCandidates)
  const claimed = new Map<string, string>()
  const unique: T[] = []
  for (const candidate of ordered) {
    const keys = dedupeKeys(candidate)
    const owner = keys.map((k) => claimed.get(k)).find((o) => o !== undefined)
    if (owner !== undefined) {
      dropped.push({ id: candidate.id, reason: "duplicate", duplicateOf: owner })
      continue
    }
    for (const key of keys) claimed.set(key, candidate.id)
    unique.push(candidate)
  }

  // 3. Selection: relevance discounted by how much the answer already leans on
  //    one club and one record type.
  const remaining = [...unique]
  const selected: SelectedSource<T>[] = []
  const contextCounts = new Map<string, number>()
  const kindCounts = new Map<string, number>()
  let tokensUsed = 0

  while (remaining.length > 0 && selected.length < maxSources) {
    let bestIndex = 0
    let bestValue = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]
      const repeats =
        (contextCounts.get(candidate.context) ?? 0) + (kindCounts.get(candidate.kind) ?? 0)
      const value = candidate.score / (1 + DIVERSITY_LAMBDA * repeats)
      if (
        value > bestValue ||
        (value === bestValue && compareCandidates(candidate, remaining[bestIndex]) < 0)
      ) {
        bestValue = value
        bestIndex = i
      }
    }
    const chosen = remaining.splice(bestIndex, 1)[0]
    const cost = costOf(chosen)
    if (tokensUsed + cost > tokenBudget) {
      // Dropped, and the loop continues: a 900-token source that does not fit
      // must not stop a 40-token one behind it from being offered. That is the
      // difference between a budget and a truncation.
      dropped.push({ id: chosen.id, reason: "budget" })
      continue
    }
    tokensUsed += cost
    contextCounts.set(chosen.context, (contextCounts.get(chosen.context) ?? 0) + 1)
    kindCounts.set(chosen.kind, (kindCounts.get(chosen.kind) ?? 0) + 1)
    selected.push({
      source: chosen,
      freshness: freshnessOf(chosen.asOf, options.now),
      citationGaps: citationGaps(chosen),
      cost,
    })
  }
  for (const leftover of remaining) dropped.push({ id: leftover.id, reason: "rank" })

  const contradictions = detectContradictions(selected.map((s) => s.source))
  const staleCount = selected.filter((s) => s.freshness === "STALE").length
  const withText = selected.filter((s) => s.source.body.trim() !== "").length

  let verdict: EvidenceVerdict
  if (selected.length === 0)
    verdict = inaccessibleCount > 0 ? "INACCESSIBLE" : "INSUFFICIENT"
  else if (withText === 0) verdict = "INSUFFICIENT"
  else if (contradictions.length > 0) verdict = "CONFLICTING"
  else if (staleCount === selected.length) verdict = "STALE"
  else verdict = "SUFFICIENT"

  return {
    selected,
    dropped,
    contradictions,
    verdict,
    tokensUsed,
    tokenBudget,
    staleCount,
    inaccessibleCount,
    staleAfterDays: Math.round(SEARCH_STALE_AFTER_MS / 86_400_000),
  }
}

/**
 * The total order candidates are compared on: score, then recency, then id.
 *
 * Total on purpose. A comparator that returns 0 for two candidates leaves their
 * relative order to `Array.prototype.sort`'s stability over whatever order the
 * database returned, which makes the selection a property of the query plan.
 */
function compareCandidates(a: EvidenceSource, b: EvidenceSource): number {
  if (a.score !== b.score) return b.score - a.score
  const at = a.asOf instanceof Date ? a.asOf.getTime() : 0
  const bt = b.asOf instanceof Date ? b.asOf.getTime() : 0
  if (at !== bt) return bt - at
  return a.id.localeCompare(b.id)
}
