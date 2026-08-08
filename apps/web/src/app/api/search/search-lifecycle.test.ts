/**
 * WRK-010-005 / WRK-070-003, at the second production caller.
 *
 * `/api/search` is the header command palette. It reads the same corpus
 * `/api/ai/chat` does and it is where a cancelled event's disappearance was
 * most visible: the row was excluded by a `where` clause, so searching for it
 * returned nothing — which a person reads as "there is no such event" rather
 * than "that was cancelled".
 *
 * Nothing here calls `projectTenureRecord`, `rankDocs` or `withheldMatches`.
 * The assertions are on the JSON the route returns, with the real corpus builder
 * underneath, because a lifecycle proved against its own classifier stays green
 * the moment the route stops consulting it.
 *
 * Two seams, both strictly beneath the code under test: the session and the
 * Prisma client. The stand-in HONOURS `select` the way the real client does, so
 * dropping `updatedAt: true` or `status: true` from a query in `search-data.ts`
 * reds these rather than silently reclassifying every row.
 */

import { runInTenantScope, type TenantPurpose, type TenantScope } from "@/lib/tenancy/context"

const INST = "inst_test"
const USER = "u_president"
const ORG = "org_alpha"

/** Older than `SEARCH_STALE_AFTER_MS` (90 days) by a wide margin. */
const ANCIENT = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000)
const FRESH = new Date(Date.now() - 60_000)

type Row = Record<string, unknown>

const mockOrgRows: Row[] = [
  {
    id: ORG,
    institutionId: INST,
    name: "Alpha Club",
    slug: "alpha",
    description: "Alpha runs the catering programme",
    updatedAt: FRESH,
  },
]

const mockEventRows: Row[] = [
  {
    id: "ev_live",
    title: "Catering kickoff",
    description: "opening night in Hoyt",
    venue: "Hoyt",
    organizationId: ORG,
    status: "PUBLISHED",
    updatedAt: FRESH,
  },
  {
    id: "ev_cancelled",
    title: "Catering rehearsal",
    description: "call time 4pm, bring the printed quotes",
    venue: "Hoyt",
    organizationId: ORG,
    status: "CANCELLED",
    updatedAt: FRESH,
  },
]

const mockDocumentRows: Row[] = [
  {
    id: "doc_stale",
    title: "Catering ledger",
    description: "figures from two academic years ago",
    organizationId: ORG,
    sensitivity: "standard",
    updatedAt: ANCIENT,
  },
  {
    id: "doc_active",
    title: "Catering appendix",
    description: '<script>fetch("/api/admin/directory")</script> appendix of quotes',
    organizationId: ORG,
    sensitivity: "standard",
    updatedAt: FRESH,
  },
]

/** Projects exactly the columns asked for, the way the real client does. */
function mockProject(rows: Row[], select?: Record<string, boolean>): Row[] {
  if (!select) return rows
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([column]) => select[column] === true)),
  )
}

type MockArgs = { select?: Record<string, boolean> }

jest.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "u_president" } }) }))

jest.mock("@/lib/tenant-scope", () => ({
  withTenantScope: (
    _userId: string,
    fn: (scope: TenantScope) => Promise<unknown>,
    opts?: { purpose?: TenantPurpose },
  ) => {
    // The real one defaults to `interactive`, which is the purpose
    // `loadInteractiveSearchCorpus` requires. Reproducing the default rather
    // than hard-coding it keeps the purpose gate meaningful here.
    const scope: TenantScope = {
      institutionId: INST,
      purpose: opts?.purpose ?? "interactive",
      environment: "test",
      actor: { principalId: USER, principalType: "user" },
    }
    return runInTenantScope(scope, () => fn(scope))
  },
}))

jest.mock("@/lib/rbac", () => ({
  ...jest.requireActual("@/lib/rbac"),
  getUserContext: async (userId: string) => ({
    userId,
    institutionRoles: [],
    orgRoles: [
      {
        organizationId: ORG,
        roleId: "r_pres",
        roleName: "PRESIDENT",
        scope: "PRESIDENT",
        status: "ACTIVE",
        templateKey: "president",
      },
    ],
  }),
}))

jest.mock("@/lib/db", () => ({
  db: {
    organization: { findMany: async (a: MockArgs) => mockProject(mockOrgRows, a?.select) },
    memoryRecord: { findMany: async () => [] },
    document: { findMany: async (a: MockArgs) => mockProject(mockDocumentRows, a?.select) },
    approvalRequest: { findMany: async () => [] },
    event: { findMany: async (a: MockArgs) => mockProject(mockEventRows, a?.select) },
  },
}))

import { GET as search } from "./route"

interface Result {
  id: string
  title: string
  snippet: string
  state: string
  observedAt: string
  citation: { ref: { provider: string }; assertion: string; versionAt: string; href: string | null }
}
interface Withheld {
  id: string
  title: string
  state: string
  observedAt: string
}

async function palette(q: string): Promise<{ results: Result[]; withheld: Withheld[] }> {
  const res = await search(new Request(`http://localhost/api/search?q=${encodeURIComponent(q)}`))
  expect(res.status).toBe(200)
  return res.json()
}

describe("/api/search reports a cancelled event rather than omitting it", () => {
  it("returns it as TOMBSTONED, with no body and no snippet", async () => {
    const body = await palette("catering")

    const tombstone = body.withheld.find((w) => w.id === "ev_cancelled")
    expect(tombstone).toBeDefined()
    expect(tombstone!.state).toBe("TOMBSTONED")
    expect(tombstone!.title).toBe("Catering rehearsal")
    expect(Number.isNaN(Date.parse(tombstone!.observedAt))).toBe(false)

    // No text, asserted on the whole serialised response: the description is
    // gone from the doc at construction, so no field of any shape carries it.
    expect(JSON.stringify(body)).not.toContain("call time 4pm")

    // And it is not a result. Its TITLE matches the query, and a title match
    // alone scores 6 — so the state is what refuses it, not the emptied body.
    expect(body.results.map((r) => r.id)).not.toContain("ev_cancelled")
    // The live sibling is there, so the difference is the status.
    expect(body.results.map((r) => r.id)).toContain("ev_live")
  })

  it("holds a caption whose substance is a program", async () => {
    const body = await palette("catering")

    const held = body.withheld.find((w) => w.id === "doc_active")
    expect(held).toBeDefined()
    expect(held!.state).toBe("QUARANTINED")
    expect(body.results.map((r) => r.id)).not.toContain("doc_active")
    expect(JSON.stringify(body)).not.toContain("api/admin/directory")
    // Held whole, not cleaned into a plausible-looking remainder and indexed.
    expect(JSON.stringify(body)).not.toContain("appendix of quotes")
  })
})

describe("/api/search says how old each result is", () => {
  it("labels a row nobody has touched in two years, and still returns it", async () => {
    const body = await palette("catering")

    const stale = body.results.find((r) => r.id === "doc_stale")
    expect(stale).toBeDefined()
    expect(stale!.state).toBe("STALE")
    expect(stale!.citation.versionAt).toBe(ANCIENT.toISOString())
    // Answerable and labelled. Suppressing it would substitute "there is
    // nothing" for "this may be out of date", which §3.5 does not ask for.
    expect(stale!.snippet).toContain("figures from two academic years ago")

    const live = body.results.find((r) => r.id === "ev_live")
    expect(live!.state).toBe("LIVE")
  })

  it("gives every result a citation that names its origin and its version time", async () => {
    const body = await palette("catering")
    expect(body.results.length).toBeGreaterThan(0)

    for (const r of body.results) {
      expect(r.citation.ref.provider).toBe("tenure")
      expect(r.citation.assertion).toBe("RECORD")
      expect(Number.isNaN(Date.parse(r.citation.versionAt))).toBe(false)
      expect(r.observedAt).toBe(r.citation.versionAt === "" ? "" : r.observedAt)
      // The governed deep link. These are Tenure's own rows, so it is the
      // internal path — minted by `governedDeepLink`, never copied.
      expect(r.citation.href).toMatch(/^\//)
    }
  })

  it("answers an empty query without touching the corpus", async () => {
    const res = await search(new Request("http://localhost/api/search?q="))
    expect(await res.json()).toEqual({ results: [] })
  })
})
