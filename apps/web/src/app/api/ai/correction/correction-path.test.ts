/**
 * GE-092-007 — the correction path, at the endpoint rather than at the parser.
 *
 * The parser's own refusals are proven in `src/lib/relay/correction.test.ts`.
 * This file POSTs to `/api/ai/correction` with the real `parseCorrectionReport`,
 * the real `parseSourceCitation`, the real `recordAuditEvent` and the real
 * chaining ledger, and reads the row that came out — because a validator with
 * no writer behind it stores nothing, and a report nothing stores is a form.
 *
 * The seams are the session, the database, and nothing else.
 */

import { projectTenureRecord } from "@/lib/relay/citation"

jest.mock("@/lib/auth", () => ({
  auth: jest.fn(async () => ({ user: { id: "user_test" } })),
}))

jest.mock("@/lib/tenant-scope", () => ({
  withTenantScope: (
    _userId: string,
    fn: (scope: {
      institutionId: string
      environment: "test" | "live"
      actor: { principalId: string; principalType: "user" }
    }) => Promise<unknown>,
  ) =>
    fn({
      institutionId: "inst_test",
      environment: "test",
      actor: { principalId: "user_test", principalType: "user" },
    }),
}))

jest.mock("@/lib/rbac", () => ({
  getUserContext: async (userId: string) => ({
    userId,
    institutionRoles: [{ institutionId: "inst_test", role: "OSE_STAFF" }],
    orgRoles: [],
  }),
}))

const mockAuditRows: Record<string, unknown>[] = []

jest.mock("@/lib/db", () => {
  const tx = {
    auditEvent: {
      findFirst: async () => mockAuditRows[mockAuditRows.length - 1] ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        mockAuditRows.push(data)
        return data
      },
    },
  }
  return {
    db: {
      ...tx,
      $transaction: (arg: unknown) =>
        typeof arg === "function"
          ? (arg as (client: unknown) => Promise<unknown>)(tx)
          : Promise.all(arg as Promise<unknown>[]),
    },
  }
})

import { POST as report, GET as reasons } from "./route"
import { CORRECTION_REASONS } from "@/lib/relay/correction"

/** A citation built by the producer `/api/ai/chat` actually returns. */
function citation(ageMs = 1000) {
  const now = new Date()
  return projectTenureRecord({
    tenant: "inst_test",
    externalId: "doc_ledger",
    href: "/orgs/alpha/documents",
    asOf: new Date(now.getTime() - ageMs),
    now,
  }).citation
}

function post(body: unknown) {
  return new Request("http://localhost/api/ai/correction", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mockAuditRows.length = 0
})

describe("a reader can say the record behind an answer is wrong", () => {
  it("files the report against the exact version they were shown", async () => {
    const cited = citation()
    const res = await report(post({ reason: "OUT_OF_DATE", citation: cited, note: "Last year's figures." }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.recorded).toBe(true)
    expect(body.citedVersionAt).toBe(cited.versionAt)

    expect(mockAuditRows).toHaveLength(1)
    const row = mockAuditRows[0]
    expect(row.action).toBe("Relay.CorrectionReported")
    expect(row.resourceType).toBe("RelaySource")
    // The record the reader disputed, by the identity the citation carried.
    expect(row.resourceId).toBe("doc_ledger")
    expect(row.institutionId).toBe("inst_test")
    expect(row.actorId).toBe("user_test")

    const metadata = row.metadata as Record<string, unknown>
    expect(metadata.reason).toBe("OUT_OF_DATE")
    // The version they saw, not the record's state now — which is what a
    // steward would otherwise re-read and find perfectly fine.
    expect(metadata.citedVersionAt).toBe(cited.versionAt)
    expect(metadata.note).toBe("Last year's figures.")
    expect(metadata.hasNote).toBe(true)
  })

  it("chains the report like every other audit row", async () => {
    await report(post({ reason: "WRONG_FACT", citation: citation() }))
    await report(post({ reason: "WRONG_FACT", citation: citation() }))

    const first = mockAuditRows[0].metadata as Record<string, unknown>
    const second = mockAuditRows[1].metadata as Record<string, unknown>
    expect(first._sequence).toBe(0)
    expect(second._sequence).toBe(1)
    expect(typeof second._previousHash).toBe("string")
  })

  it("files a disclosure complaint as a refusal, where an auditor is already looking", async () => {
    await report(post({ reason: "SHOULD_NOT_SEE", citation: citation() }))
    expect(mockAuditRows[0].outcome).toBe("DENY")

    mockAuditRows.length = 0
    await report(post({ reason: "WRONG_FACT", citation: citation() }))
    expect(mockAuditRows[0].outcome).toBe("ALLOW")
  })

  it("cleans a note before it is stored, because an admin page will render it", async () => {
    const zwj = String.fromCodePoint(0x200d)
    await report(
      post({
        reason: "WRONG_FACT",
        citation: citation(),
        note: `See${zwj} https://collect.example.com/steal?roster=all`,
      }),
    )
    const metadata = mockAuditRows[0].metadata as Record<string, unknown>
    expect(metadata.note).not.toContain(zwj)
    expect(metadata.note).toContain("[link: collect.example.com]")
    expect(metadata.note).not.toContain("roster=all")
  })
})

describe("a report the platform cannot act on is refused, and nothing is written", () => {
  it("refuses a reason that is not one of the five", async () => {
    const res = await report(post({ reason: "ANNOYED", citation: citation() }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/is not a correction reason/)
    expect(mockAuditRows).toEqual([])
  })

  it("refuses a report that names no source", async () => {
    const res = await report(post({ reason: "WRONG_FACT" }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/must name the source it is about/)
    expect(mockAuditRows).toEqual([])
  })

  it("refuses a citation this platform never emitted", async () => {
    const res = await report(
      post({ reason: "WRONG_FACT", citation: { ...citation(), versionAt: "whenever" } }),
    )
    expect(res.status).toBe(400)
    expect(mockAuditRows).toEqual([])
  })
})

describe("the reasons a client offers come from the list the server enforces", () => {
  it("serves them", async () => {
    expect((await (await reasons()).json()).reasons).toEqual([...CORRECTION_REASONS])
  })
})
