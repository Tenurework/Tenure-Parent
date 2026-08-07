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
  type RetrievalVisibility,
  type SearchDoc,
} from "./search"
import type { OrgRole, UserContext } from "./rbac"
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
  },
  {
    id: "ev_beta",
    title: "Beta kickoff",
    description: "another club's night",
    venue: "Strong",
    organizationId: ORG_BETA,
  },
]

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

async function corpusIds(userId: string): Promise<string[]> {
  return (await loadSearchCorpus(userId)).map((d) => d.id)
}

// ─── Ranking (unchanged behaviour, kept covered) ─────────────────────────────

function doc(partial: Partial<SearchDoc> & { id: string }): SearchDoc {
  return {
    kind: "memory",
    title: `Doc ${partial.id}`,
    body: "",
    href: `/x/${partial.id}`,
    context: "Club",
    ...partial,
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
