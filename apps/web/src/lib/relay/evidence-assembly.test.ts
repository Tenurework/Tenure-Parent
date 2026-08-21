/**
 * GE-092-004 / GE-092-007 — the seven things between retrieval and generation,
 * each asserted on a case where the previous `.slice(0, 6)` gave a different
 * and worse answer.
 *
 * Every fixture's `citation` is built by the REAL producer, `projectTenureRecord`,
 * for the reason `relay-prompt-safety.test.ts` records beside its own corpus: a
 * hand-written citation can assert a shape the corpus cannot produce, and a
 * completeness check proved against a fixture nobody's loader emits is proved
 * against nothing.
 *
 * The route-level half — that `/api/ai/chat` actually consults this — is in
 * `src/app/api/ai/chat/evidence-provenance.test.ts`. A selector proved only
 * against itself stays green the day its caller stops calling it.
 */

import { projectTenureRecord, SEARCH_STALE_AFTER_MS } from "@/lib/relay/citation"
import {
  assembleEvidence,
  citationGaps,
  citationResolves,
  detectContradictions,
  estimateTokens,
  extractAssertions,
  DEFAULT_MAX_SOURCES,
  type EvidenceSource,
} from "./evidence-assembly"

const NOW = new Date("2026-08-20T12:00:00.000Z")

function source(input: {
  id: string
  title: string
  body: string
  score: number
  context?: string
  kind?: EvidenceSource["kind"]
  ageMs?: number
  externalId?: string
}): EvidenceSource {
  const asOf = new Date(NOW.getTime() - (input.ageMs ?? 1000))
  const { citation } = projectTenureRecord({
    tenant: "inst_test",
    externalId: input.externalId ?? input.id,
    href: `/orgs/alpha/documents#${input.id}`,
    asOf,
    now: NOW,
  })
  return {
    id: input.id,
    kind: input.kind ?? "document",
    title: input.title,
    body: input.body,
    context: input.context ?? "Alpha Club",
    asOf,
    citation,
    score: input.score,
  }
}

const idsOf = (a: ReturnType<typeof assembleEvidence>) => a.selected.map((s) => s.source.id)

// ─── Deduplication ───────────────────────────────────────────────────────────

describe("one record does not get two of the six slots", () => {
  it("drops the second projection of the same external record", () => {
    // The same row reaching the corpus through two builders. Ranked, both would
    // have been offered, and a model reading one fact twice reads corroboration.
    const a = source({ id: "mem_1", title: "Budget process", body: "Two weeks ahead.", score: 10, externalId: "rec_9" })
    const b = source({ id: "doc_1", title: "Something else entirely", body: "Other text.", score: 9, externalId: "rec_9" })

    const out = assembleEvidence([a, b], { now: NOW })

    expect(idsOf(out)).toEqual(["mem_1"])
    expect(out.dropped).toEqual([{ id: "doc_1", reason: "duplicate", duplicateOf: "mem_1" }])
  })

  it("drops a different record whose title and body are the same text", () => {
    const a = source({ id: "doc_a", title: "Budget process", body: "Submit two weeks ahead.", score: 10 })
    const b = source({ id: "doc_b", title: "BUDGET  PROCESS!", body: "Submit two weeks ahead.", score: 9 })

    const out = assembleEvidence([a, b], { now: NOW })

    expect(idsOf(out)).toEqual(["doc_a"])
    expect(out.dropped[0]).toEqual({ id: "doc_b", reason: "duplicate", duplicateOf: "doc_a" })
  })

  it("keeps two records that merely share a title, because forty clubs file Minutes", () => {
    const a = source({ id: "doc_a", title: "Minutes", body: "Elected a treasurer.", score: 10 })
    const b = source({ id: "doc_b", title: "Minutes", body: "Approved the trip.", score: 9 })

    expect(idsOf(assembleEvidence([a, b], { now: NOW }))).toEqual(["doc_a", "doc_b"])
  })
})

// ─── Diversity ───────────────────────────────────────────────────────────────

describe("relevance is discounted by how much the answer already leans on one club", () => {
  it("promotes a lower-scoring source from a club nothing else covers", () => {
    const a = source({ id: "alpha_1", title: "Budget one", body: "text one", score: 10, context: "Alpha Club" })
    const b = source({ id: "alpha_2", title: "Budget two", body: "text two", score: 9, context: "Alpha Club" })
    const c = source({ id: "beta_1", title: "Budget three", body: "text three", score: 8, context: "Beta Club", kind: "event" })

    // Pure relevance is alpha_1, alpha_2, beta_1. The second slot goes to the
    // other club because 9/(1 + 0.25·2) = 6 is less than 8.
    expect(idsOf(assembleEvidence([a, b, c], { now: NOW }))).toEqual([
      "alpha_1",
      "beta_1",
      "alpha_2",
    ])
  })

  it("still returns the same club's records when they are the only ones there are", () => {
    // Diversity reorders; it never excludes. A question genuinely about one club
    // must not be answered from three of its records and a complaint.
    const docs = [1, 2, 3, 4, 5].map((n) =>
      source({ id: `alpha_${n}`, title: `Budget ${n}`, body: `text ${n}`, score: 10 - n }),
    )
    const out = assembleEvidence(docs, { now: NOW })

    expect(out.selected).toHaveLength(5)
    expect(out.dropped).toEqual([])
  })

  it("never lets the first pick be anything but the best-scoring candidate", () => {
    const docs = [
      source({ id: "b", title: "Budget b", body: "b", score: 5, context: "B" }),
      source({ id: "a", title: "Budget a", body: "a", score: 12, context: "A" }),
      source({ id: "c", title: "Budget c", body: "c", score: 7, context: "C" }),
    ]
    expect(idsOf(assembleEvidence(docs, { now: NOW }))[0]).toBe("a")
  })
})

// ─── Context budget ──────────────────────────────────────────────────────────

describe("six is a count; the ceiling that exists is a budget", () => {
  it("drops the source that does not fit and keeps a smaller one behind it", () => {
    const big = source({ id: "big", title: "Budget big", body: "x".repeat(2000), score: 10 })
    const huge = source({ id: "huge", title: "Budget huge", body: "y".repeat(4000), score: 9 })
    const small = source({ id: "small", title: "Budget small", body: "z".repeat(40), score: 8 })

    const out = assembleEvidence([big, huge, small], { now: NOW, tokenBudget: 600 })

    // `big` costs ~503 estimated tokens and fits; `huge` costs ~1003 and does
    // not; `small` costs ~13 and still does. A truncation would have stopped at
    // `huge` and lost `small` too.
    expect(idsOf(out)).toEqual(["big", "small"])
    expect(out.dropped).toEqual([{ id: "huge", reason: "budget" }])
    expect(out.tokensUsed).toBeLessThanOrEqual(600)
  })

  it("charges what the caller says a source costs, not what its body length says", () => {
    // The route charges `modelSourceFor`'s projection: a REFERENCE_ONLY card
    // costs its heading, because its body is never sent.
    const card = source({ id: "mem", title: "Budget card", body: "z".repeat(4000), score: 10 })

    const out = assembleEvidence([card], { now: NOW, tokenBudget: 100, costOf: () => 12 })

    expect(idsOf(out)).toEqual(["mem"])
    expect(out.tokensUsed).toBe(12)
  })

  it("stops at maxSources and says the rest were outranked", () => {
    const docs = Array.from({ length: DEFAULT_MAX_SOURCES + 2 }, (_, n) =>
      source({ id: `doc_${n}`, title: `Budget ${n}`, body: `body ${n}`, score: 20 - n, context: `Club ${n}` }),
    )
    const out = assembleEvidence(docs, { now: NOW })

    expect(out.selected).toHaveLength(DEFAULT_MAX_SOURCES)
    expect(out.dropped.filter((d) => d.reason === "rank")).toHaveLength(2)
  })
})

// ─── Citation completeness ───────────────────────────────────────────────────

describe("a marker a reader cannot resolve is worse than no marker", () => {
  it("drops a source whose citation cannot name a record", () => {
    const ok = source({ id: "doc_ok", title: "Budget ok", body: "text", score: 10 })
    const nameless = {
      ...source({ id: "doc_bad", title: "Budget bad", body: "text", score: 9 }),
      citation: { ...ok.citation, ref: { ...ok.citation.ref, externalId: "" } },
    }

    expect(citationResolves(nameless)).toBe(false)
    const out = assembleEvidence([ok, nameless], { now: NOW })
    expect(idsOf(out)).toEqual(["doc_ok"])
    expect(out.dropped).toEqual([{ id: "doc_bad", reason: "unresolvable-citation" }])
  })

  it("offers a source missing only a timestamp, and declares the gap", () => {
    // "We could not look" and "we looked and found nothing" are different
    // answers. A source of unknowable age is still an identifiable record.
    const ok = source({ id: "doc_ok", title: "Budget ok", body: "text", score: 10 })
    const undated = {
      ...ok,
      id: "doc_undated",
      citation: { ...ok.citation, observedAt: "not-a-date" },
    }

    const out = assembleEvidence([undated], { now: NOW })
    expect(idsOf(out)).toEqual(["doc_undated"])
    expect(out.selected[0].citationGaps).toEqual(["observedAt"])
    expect(citationGaps(ok)).toEqual([])
  })
})

// ─── Freshness ───────────────────────────────────────────────────────────────

describe("freshness is counted, not merely carried", () => {
  it("marks a source past the horizon STALE and says every source was", () => {
    const old = source({
      id: "doc_old",
      title: "Budget ledger",
      body: "text",
      score: 10,
      ageMs: SEARCH_STALE_AFTER_MS + 86_400_000,
    })
    const out = assembleEvidence([old], { now: NOW })

    expect(out.selected[0].freshness).toBe("STALE")
    expect(out.staleCount).toBe(1)
    expect(out.verdict).toBe("STALE")
  })

  it("does not call the set stale when one source is current", () => {
    const old = source({ id: "doc_old", title: "Budget ledger", body: "text", score: 10, ageMs: SEARCH_STALE_AFTER_MS + 1 })
    const fresh = source({ id: "doc_new", title: "Budget notes", body: "text", score: 9 })

    const out = assembleEvidence([old, fresh], { now: NOW })
    expect(out.staleCount).toBe(1)
    expect(out.verdict).toBe("SUFFICIENT")
  })
})

// ─── Contradiction detection ─────────────────────────────────────────────────

describe("sources that disagree are reported as disagreeing", () => {
  it("reads an explicit key/value assertion out of a body", () => {
    expect(extractAssertions("Trip request. status:approved")).toEqual([
      { key: "status", value: "approved", raw: "approved" },
    ])
    // Not in the allowlist, so not a fact this detector claims to check.
    expect(extractAssertions("note: see below")).toEqual([])
  })

  it("finds two records about one subject asserting different values", () => {
    const approved = source({
      id: "app_1",
      title: "Spring Formal budget",
      body: "Requested for the formal. status:approved",
      score: 10,
      kind: "approval",
      ageMs: 60 * 86_400_000,
    })
    const denied = source({
      id: "app_2",
      title: "Spring Formal Budget",
      body: "Requested for the formal. status:denied",
      score: 9,
      kind: "approval",
      context: "Beta Club",
      ageMs: 1000,
    })

    const out = assembleEvidence([approved, denied], { now: NOW })

    expect(out.contradictions).toHaveLength(1)
    expect(out.contradictions[0].key).toBe("status")
    expect(out.contradictions[0].left.id).toBe("app_1")
    expect(out.contradictions[0].right.id).toBe("app_2")
    // A hint, not a resolution: the newer record is named and no winner is picked.
    expect(out.contradictions[0].newer).toBe("app_2")
    expect(out.verdict).toBe("CONFLICTING")
  })

  it("does not call one record restated a disagreement", () => {
    const a = source({ id: "a", title: "Spring Formal budget", body: "status:approved", score: 10, externalId: "rec_1" })
    const b = source({ id: "b", title: "Spring Formal budget", body: "status:denied", score: 9, externalId: "rec_1" })

    // Called directly: `assembleEvidence` would have deduplicated these first.
    expect(detectContradictions([a, b])).toEqual([])
  })

  it("does not call two different subjects a disagreement", () => {
    const a = source({ id: "a", title: "Spring Formal budget", body: "status:approved", score: 10 })
    const b = source({ id: "b", title: "Winter Formal budget", body: "status:denied", score: 9 })

    expect(assembleEvidence([a, b], { now: NOW }).contradictions).toEqual([])
  })
})

// ─── The verdict ─────────────────────────────────────────────────────────────

describe("what the evidence supports is a value, not a tone", () => {
  it("distinguishes 'you may not read these' from 'there are none'", () => {
    expect(assembleEvidence([], { now: NOW, inaccessibleCount: 3 }).verdict).toBe("INACCESSIBLE")
    expect(assembleEvidence([], { now: NOW, inaccessibleCount: 0 }).verdict).toBe("INSUFFICIENT")
  })

  it("calls a set of sources that project no text at all insufficient", () => {
    // A REFERENCE_ONLY card reaches the prompt as a heading and no body. It is
    // citable and it is not evidence.
    const card = source({ id: "mem", title: "Budget card", body: "", score: 10 })
    expect(assembleEvidence([card], { now: NOW }).verdict).toBe("INSUFFICIENT")
  })

  it("ranks a disagreement above staleness", () => {
    const a = source({ id: "a", title: "Formal budget", body: "status:approved", score: 10, ageMs: SEARCH_STALE_AFTER_MS + 1 })
    const b = source({ id: "b", title: "Formal budget", body: "status:denied", score: 9, ageMs: SEARCH_STALE_AFTER_MS + 2 })

    const out = assembleEvidence([a, b], { now: NOW })
    expect(out.staleCount).toBe(2)
    expect(out.verdict).toBe("CONFLICTING")
  })
})

// ─── Determinism ─────────────────────────────────────────────────────────────

describe("the same candidates produce the same answer", () => {
  it("does not depend on the order the corpus returned them in", () => {
    const docs = [
      source({ id: "d", title: "Budget d", body: "d", score: 6, context: "D" }),
      source({ id: "a", title: "Budget a", body: "a", score: 6, context: "A" }),
      source({ id: "c", title: "Budget c", body: "c", score: 6, context: "C" }),
      source({ id: "b", title: "Budget b", body: "b", score: 6, context: "B" }),
    ]
    const forward = idsOf(assembleEvidence(docs, { now: NOW }))
    const backward = idsOf(assembleEvidence([...docs].reverse(), { now: NOW }))

    // Four identical scores, four identical ages: the tie breaks on id, which is
    // a decision, rather than on array position, which is the query plan.
    expect(forward).toEqual(["a", "b", "c", "d"])
    expect(backward).toEqual(forward)
  })
})

describe("the token estimate is arithmetic", () => {
  it("counts four characters to a token, rounding up", () => {
    expect(estimateTokens("")).toBe(0)
    expect(estimateTokens("abcd")).toBe(1)
    expect(estimateTokens("abcde")).toBe(2)
  })
})
