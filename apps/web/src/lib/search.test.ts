/**
 * GE-062-004 — read-time authorization after retrieval in the shared search
 * corpus.
 *
 * Two halves, deliberately.
 *
 * The first is `authorizeRetrieved` itself: a pure decision over a row that has
 * already been fetched, so it can be exercised exhaustively without Postgres.
 *
 * The second is the wiring, and it is the half worth explaining. The corpus
 * behind `/search`, `/api/search` and the Tenure AI prompt used to re-check
 * exactly one of its five row types; the rest were trusted because a `where`
 * clause had fetched them. So the database stand-in below **deliberately
 * over-returns** — it hands back every fixture row whatever the `where` says.
 * That is not a lazy fake, it is the condition read-time authorization exists
 * for: a query layer that has stopped scoping, or a predicate somebody widened.
 * If `loadSearchCorpus` only ever filtered by asking Postgres nicely, every
 * refusal assertion below fails.
 *
 * It does honour `select`, projecting exactly the columns asked for the way the
 * real client does, so dropping `sensitivity: true` from the document query
 * reclassifies every document as `standard` and the restricted-document
 * assertions go red — the projection is part of the control, not decoration.
 */

import {
  authorizeRetrieved,
  makeSnippet,
  rankDocs,
  scoreDoc,
  sensitivityRank,
  tokenize,
  verifyCitations,
  withheldMatches,
  type RetrievalVisibility,
  type SearchDoc,
} from "./search"
import type { OrgRole, UserContext } from "./rbac"
import { PROJECTION_MODES } from "./relay/projection-policy"
import { SEARCH_STALE_AFTER_MS, projectTenureRecord } from "./relay/citation"
import { __resetCellContext, cellContext } from "./cell-context"
import { runInTenantScope } from "./tenancy/context"
import { loadSearchCorpus } from "./search-data"

// ─── Corpus fixtures ─────────────────────────────────────────────────────────

const INST = "inst_ainslie"
/** The club the caller belongs to. */
const ORG_ALPHA = "org_alpha"
/** A club at the same institution that the caller has no seat in. */
const ORG_BETA = "org_beta"

const MEMBER = "u_member"
const PRESIDENT = "u_president"
const OSE = "u_ose"
const STRANGER = "u_stranger"

type Row = Record<string, unknown>

/**
 * The clock every fixture row is dated against.
 *
 * `updatedAt` is a REAL column on all five models and is now selected, so the
 * stand-in has to carry it: a row without one is dated `undefined`, which
 * `freshnessOf` fails closed on (STALE), and every corpus assertion below would
 * then be about a fixture omission rather than about the code.
 */
const FRESH = new Date(Date.now() - 60_000)
/** Older than `SEARCH_STALE_AFTER_MS` by a clear margin. */
const ANCIENT = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)

const mockOrgRows: Row[] = [
  {
    id: ORG_ALPHA,
    institutionId: INST,
    name: "Alpha Club",
    slug: "alpha",
    description: "Alpha",
  },
  {
    id: ORG_BETA,
    institutionId: INST,
    name: "Beta Club",
    slug: "beta",
    description: "Beta",
  },
]

const mockMemoryRows: Row[] = [
  {
    id: "mem_alpha",
    title: "Alpha catering lesson",
    content: { body: "book two weeks out" },
    roleId: null,
    organizationId: ORG_ALPHA,
  },
]

const mockDocumentRows: Row[] = [
  {
    id: "doc_std",
    title: "Alpha catering agreement",
    description: "CampusEats terms",
    organizationId: ORG_ALPHA,
    sensitivity: "standard",
  },
  {
    id: "doc_restricted",
    title: "Alpha conduct investigation",
    description: "named students",
    organizationId: ORG_ALPHA,
    sensitivity: "restricted",
  },
  {
    id: "doc_unlabelled",
    title: "Alpha sealed file",
    description: "classified with a label this build does not know",
    organizationId: ORG_ALPHA,
    sensitivity: "board-eyes-only",
  },
  {
    id: "doc_beta",
    title: "Beta catering agreement",
    description: "another club's terms",
    organizationId: ORG_BETA,
    sensitivity: "standard",
  },
  {
    // WRK-GATE-070. Untouched for well over the freshness horizon. Still
    // answerable — §3.5 asks that staleness be SHOWN, not that stale sources be
    // suppressed — but labelled, and the label is what the assertions check.
    id: "doc_stale",
    title: "Alpha catering ledger",
    description: "figures from two academic years ago",
    organizationId: ORG_ALPHA,
    sensitivity: "standard",
    updatedAt: ANCIENT,
  },
  {
    // WRK-010-005 / §9.4. A caption whose substance is a program. There is no
    // cleaned version of this that is a record about a club, so the row is HELD:
    // title and link kept, body never in the corpus.
    id: "doc_active",
    title: "Alpha catering appendix",
    description: '<script>fetch("/api/admin/directory")</script> catering appendix',
    organizationId: ORG_ALPHA,
    sensitivity: "standard",
  },
]

const mockApprovalRows: Row[] = [
  {
    id: "appr_alpha",
    title: "Alpha budget request",
    description: "speaker fee",
    status: "PENDING_PRESIDENT",
    organizationId: ORG_ALPHA,
    submittedById: "u_someone",
  },
  {
    id: "appr_beta_mine",
    title: "Beta request the caller filed",
    description: "filed before leaving",
    status: "APPROVED",
    organizationId: ORG_BETA,
    submittedById: MEMBER,
  },
  {
    id: "appr_beta_theirs",
    title: "Beta request somebody else filed",
    description: "another club's money",
    status: "PENDING_OSE",
    organizationId: ORG_BETA,
    submittedById: "u_someone",
  },
]

const mockEventRows: Row[] = [
  {
    id: "ev_alpha",
    title: "Alpha kickoff",
    description: "opening night",
    venue: "Hoyt",
    organizationId: ORG_ALPHA,
    status: "PUBLISHED",
  },
  {
    id: "ev_beta",
    title: "Beta kickoff",
    description: "another club's night",
    venue: "Strong",
    organizationId: ORG_BETA,
    status: "PUBLISHED",
  },
  {
    // WRK-010-005. The row `loadSearchCorpus` used to exclude with
    // `where: { status: { not: "CANCELLED" } }` — dropped, and therefore
    // indistinguishable from an event that never existed.
    id: "ev_alpha_cancelled",
    title: "Alpha kickoff rehearsal",
    description: "call time 4pm at Hoyt",
    venue: "Hoyt",
    organizationId: ORG_ALPHA,
    status: "CANCELLED",
  },
]

/**
 * Every fixture row carries an `updatedAt`, because every real row does.
 *
 * Applied here rather than repeated thirteen times so the two rows that mean
 * something by their date — `doc_stale` — stand out instead of being lost in a
 * column every other row also spells out. A row that sets its own keeps it.
 */
for (const row of [
  ...mockOrgRows,
  ...mockMemoryRows,
  ...mockDocumentRows,
  ...mockApprovalRows,
  ...mockEventRows,
]) {
  if (row.updatedAt === undefined) row.updatedAt = FRESH
}

/**
 * Project like the real client: a column that was not selected is not there, so
 * an implementation that reads `sensitivity` without asking for it breaks here
 * rather than quietly treating every document as unclassified.
 */
function mockProject(rows: Row[], select?: Record<string, boolean>): Row[] {
  if (!select) return rows
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([column]) => select[column] === true)),
  )
}

type MockArgs = { where?: unknown; select?: Record<string, boolean> }
type MockOrgWhere = {
  OR?: [{ institutionId?: { in?: string[] } }, { id?: { in?: string[] } }]
}

/**
 * The one query whose `where` is honoured, because it *is* the visible set —
 * faking it away would mean deciding the answer in the test rather than in
 * `loadSearchCorpus`.
 */
const mockFindOrganizations = jest.fn(async (args: MockArgs) => {
  const or = (args?.where as MockOrgWhere | undefined)?.OR ?? []
  const institutions = or[0]?.institutionId?.in ?? []
  const ids = or[1]?.id?.in ?? []
  const matched = mockOrgRows.filter(
    (o) => institutions.includes(o.institutionId as string) || ids.includes(o.id as string),
  )
  return mockProject(matched, args?.select)
})

/** The four that over-return on purpose — see the file comment. */
const mockFindMemory = jest.fn(async (args: MockArgs) =>
  mockProject(mockMemoryRows, args?.select),
)
const mockFindDocuments = jest.fn(async (args: MockArgs) =>
  mockProject(mockDocumentRows, args?.select),
)
const mockFindApprovals = jest.fn(async (args: MockArgs) =>
  mockProject(mockApprovalRows, args?.select),
)
const mockFindEvents = jest.fn(async (args: MockArgs) =>
  mockProject(mockEventRows, args?.select),
)

jest.mock("@/lib/db", () => ({
  db: {
    organization: { findMany: (...a: unknown[]) => mockFindOrganizations(...(a as [never])) },
    memoryRecord: { findMany: (...a: unknown[]) => mockFindMemory(...(a as [never])) },
    document: { findMany: (...a: unknown[]) => mockFindDocuments(...(a as [never])) },
    approvalRequest: { findMany: (...a: unknown[]) => mockFindApprovals(...(a as [never])) },
    event: { findMany: (...a: unknown[]) => mockFindEvents(...(a as [never])) },
  },
}))

/** Memberships, per caller. Only the database read is faked; `isOse`,
 *  `canViewOrg` and `canSeeMemoryCard` are the real ones. */
const mockContexts: Record<string, UserContext> = {}

jest.mock("@/lib/rbac", () => ({
  ...jest.requireActual("@/lib/rbac"),
  getUserContext: async (userId: string) => mockContexts[userId],
}))

function seat(
  organizationId: string,
  scope: OrgRole["scope"],
  status: OrgRole["status"],
): OrgRole {
  return {
    organizationId,
    roleId: `${organizationId}_${scope}`,
    roleName: scope,
    scope,
    status,
    templateKey: scope === "PRESIDENT" ? "president" : "member",
  }
}

mockContexts[MEMBER] = {
  userId: MEMBER,
  institutionRoles: [],
  orgRoles: [seat(ORG_ALPHA, "MEMBER", "ACTIVE")],
}
mockContexts[PRESIDENT] = {
  userId: PRESIDENT,
  institutionRoles: [],
  orgRoles: [seat(ORG_ALPHA, "PRESIDENT", "ACTIVE")],
}
mockContexts[OSE] = {
  userId: OSE,
  institutionRoles: [{ institutionId: INST, role: "OSE_DIRECTOR" }],
  orgRoles: [],
}
mockContexts[STRANGER] = { userId: STRANGER, institutionRoles: [], orgRoles: [] }

/**
 * WRK-070-002. `loadSearchCorpus` is the model-exposure entry point and refuses
 * any other purpose, so the corpus assertions below open the scope the way
 * `/api/ai/chat` does. Opening it as `interactive` here — the default every
 * other surface gets — makes every one of them throw, which is the behaviour
 * the gate exists for.
 */
async function corpusIds(userId: string): Promise<string[]> {
  const docs = await runInTenantScope(
    {
      institutionId: INST,
      environment: "test",
      purpose: "model-exposure",
      actor: { principalId: userId, principalType: "user" },
    },
    () => loadSearchCorpus(userId),
  )
  return docs.map((d) => d.id)
}

// ─── Ranking (unchanged behaviour, kept covered) ─────────────────────────────

/** The instant every fixture below is dated against. */
const NOW = new Date("2026-08-01T00:00:00.000Z")

/**
 * A fixture doc, with its state and citation built by the REAL producer.
 *
 * `state` and `citation` are deliberately not in the accepted partial. A test
 * that could write `state: "LIVE"` on a doc dated two years ago would be
 * asserting against a combination `projectTenureRecord` cannot produce, and a
 * ranking rule proved against an impossible doc proves nothing. So the lifecycle
 * is expressed the way the corpus expresses it — an age, a deletion, an unsafe
 * body — and the same function the five builders in `search-data.ts` call
 * decides what that means.
 *
 * WRK-010-003 / WRK-GATE-070 / WRK-010-005: `mode`, `asOf`, `state` and
 * `citation` are all REQUIRED on `SearchDoc`, and each of them in turn is what
 * made `tsc` point at this helper. That is the mechanism working.
 */
function doc(
  partial: Partial<Omit<SearchDoc, "state" | "citation">> & { id: string },
  lifecycle: { deleted?: boolean; quarantined?: boolean } = {},
): SearchDoc {
  const href = partial.href ?? `/x/${partial.id}`
  // One second old by default: unambiguously LIVE, so a ranking assertion never
  // passes or fails for a reason that has nothing to do with ranking.
  const asOf = partial.asOf ?? new Date(NOW.getTime() - 1000)
  const projected = projectTenureRecord({
    tenant: INST,
    externalId: partial.id,
    href,
    asOf,
    now: NOW,
    ...lifecycle,
  })
  return {
    kind: "memory",
    title: `Doc ${partial.id}`,
    body: "",
    context: "Club",
    // These docs exist to exercise scoring, so the retentive mode is the honest
    // one: a fixture at REFERENCE_ONLY would carry no body and every ranking
    // assertion below would pass vacuously.
    mode: "SEARCH_PROJECTION",
    ...partial,
    href,
    asOf,
    state: projected.state,
    citation: projected.citation,
  }
}

describe("tokenize", () => {
  it("lowercases, splits, and drops single characters", () => {
    expect(tokenize("Catering for the Spring-Gala!")).toEqual([
      "catering",
      "for",
      "the",
      "spring",
      "gala",
    ])
    expect(tokenize("a I")).toEqual([])
  })
})

describe("scoreDoc", () => {
  it("weights title matches above body matches", () => {
    const inTitle = scoreDoc(doc({ id: "t", title: "catering contact" }), ["catering"])
    const inBody = scoreDoc(doc({ id: "b", body: "ask about catering" }), ["catering"])
    expect(inTitle).toBeGreaterThan(inBody)
  })

  it("requires every term to appear (AND semantics)", () => {
    const d = doc({ id: "x", title: "catering contact", body: "CampusEats discount" })
    expect(scoreDoc(d, ["catering", "discount"])).toBeGreaterThan(0)
    expect(scoreDoc(d, ["catering", "missingterm"])).toBe(0)
  })
})

describe("makeSnippet", () => {
  it("centers the window on the first match", () => {
    const body = "x".repeat(300) + " the SIMON15 code works " + "y".repeat(300)
    const snip = makeSnippet(body, ["simon15"])
    expect(snip).toContain("SIMON15")
    expect(snip.length).toBeLessThan(200)
  })
})

describe("rankDocs", () => {
  it("filters non-matches and sorts by score", () => {
    const docs = [
      doc({ id: "1", title: "vendor list", body: "catering vendors" }),
      doc({ id: "2", title: "catering playbook", body: "how to book catering" }),
      doc({ id: "3", title: "budget", body: "no relevant terms" }),
    ]
    const ranked = rankDocs(docs, "catering")
    expect(ranked.map((r) => r.id)).toEqual(["2", "1"])
    expect(ranked[0].snippet).toBeTruthy()
  })
})

// ─── Lifecycle state, at the ranker (WRK-010-005) ────────────────────────────

describe("rankDocs scores only a state an answer may rest on", () => {
  it("refuses a tombstoned and a quarantined doc that both match on title", () => {
    // Both keep their title, and a title match alone scores 6 — so a filter
    // written against the emptied BODY would let either through. The state is
    // what refuses them.
    const docs = [
      doc({ id: "live", title: "catering playbook", body: "how to book catering" }),
      doc({ id: "gone", title: "catering rehearsal" }, { deleted: true }),
      doc({ id: "held", title: "catering appendix" }, { quarantined: true }),
    ]
    expect(rankDocs(docs, "catering").map((r) => r.id)).toEqual(["live"])
  })

  it("still ranks a stale doc, because §3.5 asks for freshness to be shown", () => {
    const stale = doc({
      id: "old",
      title: "catering ledger",
      asOf: new Date(NOW.getTime() - SEARCH_STALE_AFTER_MS - 1000),
    })
    expect(stale.state).toBe("STALE")
    // Suppressing it would replace a labelled answer with "nothing found",
    // which is a different and untrue statement.
    expect(rankDocs([stale], "catering").map((r) => r.id)).toEqual(["old"])
  })
})

describe("withheldMatches reports what ranking refused", () => {
  it("names the row and its state, and carries no text of any kind", () => {
    const docs = [
      doc({ id: "live", title: "catering playbook", body: "how to book catering" }),
      doc({ id: "gone", title: "catering rehearsal", body: "call time 4pm" }, { deleted: true }),
    ]

    const withheld = withheldMatches(docs, "catering")
    expect(withheld.map((w) => w.id)).toEqual(["gone"])
    expect(withheld[0].state).toBe("TOMBSTONED")
    expect(withheld[0].title).toBe("catering rehearsal")
    expect(withheld[0].observedAt).toBeTruthy()
    // The row it describes was constructed with a body; the withheld entry has
    // no field that could carry one, and this asserts on the serialised value
    // rather than on the absence of a property name.
    expect(JSON.stringify(withheld)).not.toContain("call time")
  })

  it("says nothing about an answerable row", () => {
    const docs = [doc({ id: "live", title: "catering playbook", body: "book catering" })]
    expect(withheldMatches(docs, "catering")).toEqual([])
  })
})

// ─── Citation verification (WRK-GATE-070) ────────────────────────────────────

describe("verifyCitations", () => {
  it("separates the numbers that were offered from the ones that were not", () => {
    expect(verifyCitations("per [1] and [7]", 6)).toEqual({ cited: [1], invalid: [7] })
  })

  it("reports no citations at all rather than pretending there were some", () => {
    expect(verifyCitations("no citations here", 6)).toEqual({ cited: [], invalid: [] })
  })

  it("reads the grouped and repeated forms a model actually emits", () => {
    expect(verifyCitations("see [1, 3] and [2][3]", 3)).toEqual({ cited: [1, 2, 3], invalid: [] })
  })

  it("treats [0] as invalid, because a one-indexed list has no source zero", () => {
    expect(verifyCitations("as [0] shows", 6).invalid).toEqual([0])
  })

  it("invalidates every citation when nothing was offered", () => {
    expect(verifyCitations("the answer is [1]", 0)).toEqual({ cited: [], invalid: [1] })
  })
})

// ─── The decision itself ─────────────────────────────────────────────────────

function visibility(
  overrides: Partial<RetrievalVisibility> = {},
): RetrievalVisibility {
  return {
    viewerId: MEMBER,
    visibleOrgIds: new Set([ORG_ALPHA]),
    clearanceByOrg: new Map(),
    ...overrides,
  }
}

describe("sensitivityRank", () => {
  it("orders the ladder and treats an unknown label as the most restrictive", () => {
    expect(sensitivityRank(null)).toBe(0)
    expect(sensitivityRank(undefined)).toBe(0)
    expect(sensitivityRank("standard")).toBe(0)
    expect(sensitivityRank("restricted")).toBe(1)
    // Fail closed: a label this build does not recognise must not rank below
    // `restricted`, or adding a stricter classification would widen access.
    expect(sensitivityRank("board-eyes-only")).toBe(1)
  })
})

describe("authorizeRetrieved", () => {
  it("refuses a row whose organization is not in the visible set", () => {
    expect(
      authorizeRetrieved({ organizationId: ORG_BETA }, visibility()),
    ).toBe(false)
    expect(authorizeRetrieved({ organizationId: null }, visibility())).toBe(false)
  })

  it("allows a standard row in a visible organization", () => {
    expect(
      authorizeRetrieved({ organizationId: ORG_ALPHA, sensitivity: "standard" }, visibility()),
    ).toBe(true)
  })

  it("refuses a restricted row to a caller cleared only for standard", () => {
    expect(
      authorizeRetrieved(
        { organizationId: ORG_ALPHA, sensitivity: "restricted" },
        visibility(),
      ),
    ).toBe(false)
  })

  it("allows a restricted row to a caller cleared for restricted in that org", () => {
    expect(
      authorizeRetrieved(
        { organizationId: ORG_ALPHA, sensitivity: "restricted" },
        visibility({ clearanceByOrg: new Map([[ORG_ALPHA, "restricted"]]) }),
      ),
    ).toBe(true)
  })

  it("does not carry clearance from one organization into another", () => {
    // The reason the ceiling is a map and not a single number per caller:
    // president of Alpha, ordinary member of Beta.
    const v = visibility({
      visibleOrgIds: new Set([ORG_ALPHA, ORG_BETA]),
      clearanceByOrg: new Map([[ORG_ALPHA, "restricted"]]),
    })
    expect(
      authorizeRetrieved({ organizationId: ORG_ALPHA, sensitivity: "restricted" }, v),
    ).toBe(true)
    expect(
      authorizeRetrieved({ organizationId: ORG_BETA, sensitivity: "restricted" }, v),
    ).toBe(false)
  })

  it("lets the person who filed a row read it in an organization they cannot see", () => {
    // Matches `/approvals/[id]/page.tsx`, which the search result links to.
    expect(
      authorizeRetrieved({ organizationId: ORG_BETA, ownerId: MEMBER }, visibility()),
    ).toBe(true)
    expect(
      authorizeRetrieved({ organizationId: ORG_BETA, ownerId: "u_someone" }, visibility()),
    ).toBe(false)
  })

  it("grants no elevation for owning a row in an invisible organization", () => {
    expect(
      authorizeRetrieved(
        { organizationId: ORG_BETA, ownerId: MEMBER, sensitivity: "restricted" },
        visibility({ clearanceByOrg: new Map([[ORG_BETA, "restricted"]]) }),
      ),
    ).toBe(false)
  })
})

// ─── The corpus, with the decision wired in ──────────────────────────────────

describe("loadSearchCorpus applies authorization after retrieval", () => {
  it("keeps another club's rows out even when the query hands them over", async () => {
    const ids = await corpusIds(MEMBER)

    expect(ids).toContain("doc_std")
    expect(ids).toContain("ev_alpha")
    expect(ids).toContain("appr_alpha")
    expect(ids).toContain("mem_alpha")

    expect(ids).not.toContain("doc_beta")
    expect(ids).not.toContain("ev_beta")
    // The loop that had no post-retrieval check at all: an approval for a club
    // the caller cannot see, pushed with its full title and description into
    // the search index and the model prompt.
    expect(ids).not.toContain("appr_beta_theirs")
  })

  it("still shows the caller the request they filed themselves", async () => {
    expect(await corpusIds(MEMBER)).toContain("appr_beta_mine")
  })

  it("withholds a restricted document from an ordinary member", async () => {
    const ids = await corpusIds(MEMBER)
    expect(ids).not.toContain("doc_restricted")
    expect(ids).not.toContain("doc_unlabelled")
  })

  it("shows restricted documents to the club's ACTIVE president", async () => {
    const ids = await corpusIds(PRESIDENT)
    expect(ids).toContain("doc_std")
    expect(ids).toContain("doc_restricted")
    expect(ids).toContain("doc_unlabelled")
    // Elevation is per club — the president of Alpha is nobody in Beta.
    expect(ids).not.toContain("doc_beta")
  })

  it("shows restricted documents to the institution's OSE across its clubs", async () => {
    const ids = await corpusIds(OSE)
    expect(ids).toContain("doc_restricted")
    expect(ids).toContain("doc_beta")
  })

  it("gives a caller with no membership nothing, not everything", async () => {
    expect(await corpusIds(STRANGER)).toEqual([])
  })
})

// ─── Projection mode, at the corpus builder (WRK-010-003) ────────────────────

/**
 * Authorization decides *who* may read a row. These decide *how much of it* the
 * corpus is allowed to carry — a different question, and one nothing in this
 * file used to ask. The president below is authorized for every row in Alpha,
 * and that is the point: clearance to read a memory card is not clearance to
 * copy its text into an index and post it to a model vendor.
 */
describe("loadSearchCorpus stamps a §3.4 projection mode on every doc", () => {
  /** The scope `/api/ai/chat` opens — see `corpusIds` above (WRK-070-002). */
  async function corpusFor(userId: string) {
    return runInTenantScope(
      {
        institutionId: INST,
        environment: "test",
        purpose: "model-exposure",
        actor: { principalId: userId, principalType: "user" },
      },
      () => loadSearchCorpus(userId),
    )
  }

  it("gives every doc a mode drawn from the declared vocabulary", async () => {
    const corpus = await corpusFor(PRESIDENT)
    expect(corpus.length).toBeGreaterThan(0)
    for (const d of corpus) expect(PROJECTION_MODES).toContain(d.mode)
  })

  it("drops a memory card's body from the corpus entirely", async () => {
    const corpus = await corpusFor(PRESIDENT)
    const card = corpus.find((d) => d.id === "mem_alpha")

    expect(card).toBeDefined()
    expect(card!.title).toBe("Alpha catering lesson")
    // Stated before the label, so flipping `projectionModeFor("memory")` reds
    // on the disclosure rather than on the name of the mode. Not merely
    // unprinted: absent. Nothing downstream — scoring, `/api/search` snippets,
    // the model prompt — can leak what was never put in the doc.
    expect(corpus.map((d) => d.body).join("\n")).not.toContain("book two weeks out")
    expect(card!.body).toBe("")
    expect(card!.mode).toBe("REFERENCE_ONLY")
  })

  it("keeps the description-shaped kinds indexed, so the mode is the difference", async () => {
    const corpus = await corpusFor(PRESIDENT)
    const byId = new Map(corpus.map((d) => [d.id, d]))

    expect(byId.get("doc_std")!.mode).toBe("SEARCH_PROJECTION")
    expect(byId.get("doc_std")!.body).toBe("CampusEats terms")
    expect(byId.get("ev_alpha")!.mode).toBe("SEARCH_PROJECTION")
    expect(byId.get("ev_alpha")!.body).toContain("opening night")
    expect(byId.get("appr_alpha")!.mode).toBe("SEARCH_PROJECTION")
    expect(byId.get("appr_alpha")!.body).toContain("speaker fee")
    expect(byId.get(ORG_ALPHA)!.mode).toBe("SEARCH_PROJECTION")
  })
})

// ─── Lifecycle state, at the corpus builder (WRK-010-005 / WRK-070-003) ──────

/**
 * The state machine, asserted through the loader rather than through
 * `projectTenureRecord`.
 *
 * The five loops in `search-data.ts` are the producer. A test that called the
 * classifier directly would stay green the moment a loop stopped calling it —
 * which is exactly the failure that dropped the CANCELLED filter's replacement
 * on the floor in the first place — so every assertion below goes through
 * `loadSearchCorpus`, against the mocked Prisma client that HONOURS `select`.
 */
describe("loadSearchCorpus gives every row a lifecycle state and a citation", () => {
  async function corpusFor(userId: string) {
    return runInTenantScope(
      {
        institutionId: INST,
        environment: "test",
        purpose: "model-exposure",
        actor: { principalId: userId, principalType: "user" },
      },
      () => loadSearchCorpus(userId),
    )
  }

  it("tombstones a cancelled event instead of dropping it", async () => {
    const corpus = await corpusFor(PRESIDENT)
    const cancelled = corpus.find((d) => d.id === "ev_alpha_cancelled")

    // Present at all — which it was not, because the query excluded it and an
    // absent row is indistinguishable from an event that never existed.
    expect(cancelled).toBeDefined()
    expect(cancelled!.title).toBe("Alpha kickoff rehearsal")
    expect(cancelled!.state).toBe("TOMBSTONED")
    expect(cancelled!.citation.state).toBe("TOMBSTONED")
    // And carrying no text: stated on the whole corpus, so the assertion is
    // about the disclosure rather than about one field of one doc.
    expect(cancelled!.body).toBe("")
    expect(corpus.map((d) => d.body).join("\n")).not.toContain("call time 4pm")

    // The live sibling is untouched, so the difference is the status and not
    // the plumbing.
    expect(corpus.find((d) => d.id === "ev_alpha")!.state).toBe("LIVE")
  })

  it("quarantines a body whose substance is a program, and keeps the row", async () => {
    const corpus = await corpusFor(PRESIDENT)
    const held = corpus.find((d) => d.id === "doc_active")

    expect(held).toBeDefined()
    expect(held!.state).toBe("QUARANTINED")
    expect(held!.body).toBe("")
    // Neither the payload nor the prose that surrounded it: this row is held
    // whole, not cleaned into a plausible-looking remainder and indexed.
    expect(JSON.stringify(corpus)).not.toContain("api/admin/directory")
    expect(corpus.map((d) => d.body).join("\n")).not.toContain("catering appendix")
  })

  it("marks a row nobody has touched in two years stale, and still projects it", async () => {
    const corpus = await corpusFor(PRESIDENT)
    const old = corpus.find((d) => d.id === "doc_stale")

    expect(old).toBeDefined()
    expect(old!.state).toBe("STALE")
    // Answerable and labelled, which is what §3.5 asks for. Withholding it
    // would substitute "there is nothing" for "this may be out of date".
    expect(old!.body).toBe("figures from two academic years ago")
  })

  it("stamps a checkable citation on every row", async () => {
    const corpus = await corpusFor(PRESIDENT)
    expect(corpus.length).toBeGreaterThan(0)

    for (const d of corpus) {
      // The tenant comes from the OPEN SCOPE, not from the row: a citation that
      // took the tenant off the row would be the row asserting its own tenancy.
      expect(d.citation.ref.tenant).toBe(INST)
      expect(d.citation.ref.provider).toBe("tenure")
      expect(d.citation.ref.externalId).toBe(d.id)
      expect(d.citation.assertion).toBe("RECORD")
      expect(d.citation.state).toBe(d.state)
      // §9.3's version time, and it is the row's own `updatedAt` rather than the
      // clock: the four `select:` lists named no temporal column at all before
      // this, so nothing downstream could have shown freshness.
      expect(d.citation.versionAt).toBe(d.asOf.toISOString())
      expect(Number.isNaN(Date.parse(d.citation.observedAt))).toBe(false)
      // The governed deep link, and for a Tenure row it is the internal path.
      expect(d.citation.href).toBe(d.href)
    }
  })
})

// ─── Residency, at the corpus builder (WRK-070-001) ──────────────────────────

/**
 * The projection was global: `projectionModeFor(kind)` decided over a
 * module-level constant, so every tenant, in every cell, in every region got the
 * same retention answer. `lib/ai.ts` already refused to INVOKE a model from a
 * partition with no route to the vendor (GE-010-007) and the CORPUS was never
 * capped — so a GovCloud cell assembled full-retention bodies of tenant text and
 * held them in memory ready to post.
 *
 * Asserted on what `loadSearchCorpus` — the production entry point `/api/ai/chat`
 * calls — actually returns, never on `projectionModeFor` directly.
 */
describe("the corpus projects at the residency the cell is running in", () => {
  /**
   * All five variables `resolveCellContext` reads. Setting two would leave the
   * others unresolved, and the resolver falls back to its development default
   * WHOLESALE in that case — which would have made this pass against
   * `us-east-1` while claiming GovCloud.
   */
  const CELL_VARS = [
    "AWS_PARTITION",
    "AWS_ACCOUNT_ID",
    "AWS_REGION",
    "DEPLOY_ENVIRONMENT",
    "CELL_ID",
  ] as const
  const previous = Object.fromEntries(CELL_VARS.map((v) => [v, process.env[v]]))

  function runningIn(partition: string, region: string) {
    process.env.AWS_PARTITION = partition
    process.env.AWS_ACCOUNT_ID = "000000000001"
    process.env.AWS_REGION = region
    process.env.DEPLOY_ENVIRONMENT = "production"
    process.env.CELL_ID = "cell-test-01"
    __resetCellContext()
    expect(cellContext()).toMatchObject({ partition, region, resolved: "environment" })
  }

  afterEach(() => {
    for (const variable of CELL_VARS) {
      const restored = previous[variable]
      if (restored === undefined) delete process.env[variable]
      else process.env[variable] = restored
    }
    __resetCellContext()
  })

  async function corpusFor(userId: string) {
    return runInTenantScope(
      {
        institutionId: INST,
        environment: "test",
        purpose: "model-exposure",
        actor: { principalId: userId, principalType: "user" },
      },
      () => loadSearchCorpus(userId),
    )
  }

  it("keeps every body out of the corpus from a partition the vendor is not in", async () => {
    runningIn("aws-us-gov", "us-gov-west-1")

    const corpus = await corpusFor(PRESIDENT)

    // The rows are still there — findable and citable by title and link — so a
    // passing assertion below is about the mode and not about an empty corpus.
    expect(corpus.length).toBeGreaterThan(0)
    for (const d of corpus) {
      expect(d.mode).toBe("REFERENCE_ONLY")
      expect(d.body).toBe("")
    }
    // Stated on the disclosure as well as on the label: not merely unprinted,
    // absent. Nothing downstream can leak what was never put in the doc.
    expect(JSON.stringify(corpus)).not.toContain("CampusEats terms")
    expect(JSON.stringify(corpus)).not.toContain("opening night")
  })

  it("still projects the description-shaped kinds in the pilot's own partition", async () => {
    // The contrast that makes the assertion above about residency rather than
    // about a corpus that withholds everything.
    runningIn("aws", "us-east-1")

    const corpus = await corpusFor(PRESIDENT)
    const byId = new Map(corpus.map((d) => [d.id, d]))

    expect(byId.get("doc_std")!.mode).toBe("SEARCH_PROJECTION")
    expect(byId.get("doc_std")!.body).toBe("CampusEats terms")
  })

  it("refuses a residency whose region and partition contradict each other", async () => {
    // Two environment variables, and nothing had ever checked they describe the
    // same place.
    runningIn("aws", "us-gov-west-1")

    const corpus = await corpusFor(PRESIDENT)
    for (const d of corpus) expect(d.mode).toBe("REFERENCE_ONLY")
  })
})
