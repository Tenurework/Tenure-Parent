/**
 * WRK-120-004 at the production caller: `/api/ai/chat` will not spend a tenant's
 * money it has already spent.
 *
 * Every other gate on this route asks whether the call is PERMITTED — the
 * tenant's flag, a configured key, the retrieval tool, the connector's provider
 * review. This one asks whether it has been PAID FOR, and nothing anywhere
 * asked that before: `aiComplete` parsed the vendor's `usage` away with a cast
 * that named only `content`, so the platform could not have said what any
 * tenant had spent, let alone refused a call on it.
 *
 * ## Why this file exists beside `ai-kill-switch.test.ts`
 *
 * That suite asserts the route's behaviour with the connector gate CLOSED,
 * which is its true state today (`RELAY_ANTHROPIC_REVIEW` is NOT_SUBMITTED), so
 * the vendor branch is unreachable there and `aiComplete` is never called. The
 * budget sits on that branch. This file records an APPROVED provider review —
 * the record the gate reads, changed at the record and not at the gate — so the
 * one path that reaches the vendor can be exercised at all.
 *
 * `budgetVerdict` is stubbed HERE and only here, because what is under test is
 * whether the ROUTE consults it and honours the answer. The verdict's own
 * correctness is proven against the real configuration engine in
 * `src/lib/metering/model-usage.test.ts` and against real Postgres in
 * `model-usage.itest.ts`.
 */

import type { BudgetVerdict } from "@/lib/metering/model-usage"

const NOW = new Date()

/** What `budgetVerdict` answers with, per test. */
let mockVerdict: BudgetVerdict = {
  allowed: true,
  reason: "within-budget",
  period: "2026-08",
  usedTokens: 1_000,
  capTokens: 20_000_000,
}

/** Every call the route charged, in the order it charged them. */
const mockCharges: { institutionId: string; model: string; inputTokens: number }[] = []

jest.mock("@/lib/metering/model-usage", () => ({
  budgetVerdict: async () => mockVerdict,
  recordModelUsage: async (event: {
    institutionId: string
    model: string
    inputTokens: number
  }) => {
    mockCharges.push(event)
  },
}))

/**
 * The provider review, recorded as APPROVED.
 *
 * Everything else in `@tenure/platform-config` is the real module — including
 * `providerActivation`, the function the route actually calls — so the gate
 * still decides; it is decided against a record that says a review happened.
 */
jest.mock("@tenure/platform-config", () => {
  const actual = jest.requireActual<typeof import("@tenure/platform-config")>(
    "@tenure/platform-config",
  )
  return {
    ...actual,
    RELAY_ANTHROPIC_REVIEW: {
      program: "Anthropic API",
      state: "APPROVED",
      approvedScopes: [...actual.RELAY_ANTHROPIC_SCOPES],
      verifiedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2030-01-01T00:00:00.000Z",
    },
  }
})

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
  isOse: () => true,
}))

jest.mock("@/lib/config/server", () => {
  const actual = jest.requireActual<typeof import("@tenure/platform-config")>(
    "@tenure/platform-config",
  )
  const engine = jest.requireActual<typeof import("@tenure/configuration")>("@tenure/configuration")
  return {
    flagDecisionForInstitution: async (_i: string, flag: string, subjectId: string) =>
      actual.decideFlag(
        engine.resolveConfigOrThrow(actual.REGISTRY, actual.layersFor("rochester")),
        flag as import("@tenure/platform-config").FlagName,
        subjectId,
      ),
    institutionSlugFor: async () => "rochester",
    legalEntityIdForInstitution: async () => null,
    configSnapshotForInstitution: async () => ({
      tenantId: "inst_test",
      revision: "university-student-organizations@1.0.0",
      checksum: "sha256:test",
      environment: "test" as const,
      values: {},
    }),
  }
})

/** The audit chain writes to Postgres; the decision it records is not under test here. */
const mockAuditRows: Record<string, unknown>[] = []
jest.mock("@/lib/audit-record", () => ({
  recordAuditEvent: async (row: Record<string, unknown>) => {
    mockAuditRows.push(row)
  },
  seatFor: () => null,
}))

jest.mock("@/lib/search-data", () => ({
  loadSearchCorpus: async (userId: string) => [
    {
      id: `doc_${userId}`,
      kind: "document",
      title: "Budget request process",
      body: "Submit the budget request two weeks before the event.",
      href: "/resources/doc_1",
      context: "Ainslie OSE",
      mode: "SEARCH_PROJECTION",
      asOf: NOW,
      state: "LIVE",
      citation: {
        ref: { provider: "tenure", externalId: "doc_1" },
        assertion: "STATED",
        state: "LIVE",
        versionAt: 1,
      },
    },
  ],
}))

/**
 * The vendor boundary, stubbed at `aiComplete`.
 *
 * It returns the answer AND drives the `onUsage` callback the route passes, so
 * the charge recorded below is the one the route's own closure produced rather
 * than one this file wrote.
 */
const mockAiComplete = jest.fn(
  async (
    _system: string,
    _user: string,
    options: { onUsage: (u: { model: string; inputTokens: number; outputTokens: number }) => unknown },
  ) => {
    await options.onUsage({ model: "claude-x", inputTokens: 137, outputTokens: 42 })
    return "an answer [1]"
  },
)

jest.mock("@/lib/ai", () => ({
  aiComplete: (...args: unknown[]) =>
    mockAiComplete(...(args as Parameters<typeof mockAiComplete>)),
  aiConfigured: () => true,
}))

import { POST as chat } from "./route"

const request = () =>
  new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "budget request" }),
  })

beforeEach(() => {
  mockAiComplete.mockClear()
  mockCharges.length = 0
  mockAuditRows.length = 0
  mockVerdict = {
    allowed: true,
    reason: "within-budget",
    period: "2026-08",
    usedTokens: 1_000,
    capTokens: 20_000_000,
  }
})

describe("a tenant inside its allowance still gets an answer", () => {
  it("calls the vendor and returns prose", async () => {
    const body = await (await chat(request())).json()

    expect(body.answer).toBe("an answer [1]")
    expect(body.aiEnabled).toBe(true)
    expect(body.budgetRefusal).toBeNull()
    expect(mockAiComplete).toHaveBeenCalledTimes(1)
  })

  it("charges the call to the tenant whose scope it ran in", async () => {
    await chat(request())

    // The route's own `onUsage` closure, driven by the stubbed vendor. Without
    // it the budget above would compare every tenant's spend against zero
    // forever, which is a ceiling nothing ever reaches.
    expect(mockCharges).toEqual([
      expect.objectContaining({
        institutionId: "inst_test",
        model: "claude-x",
        inputTokens: 137,
      }),
    ])
  })

  it("reports the numbers behind the allowance, not only whether it was hit", async () => {
    // A panel that can show a limit only once it is exceeded cannot warn
    // anybody before it is.
    const body = await (await chat(request())).json()
    expect(body.budget).toEqual({ period: "2026-08", usedTokens: 1_000, capTokens: 20_000_000 })
  })
})

describe("a tenant over its allowance gets sources and no prose", () => {
  beforeEach(() => {
    mockVerdict = {
      allowed: false,
      reason: "budget-exhausted",
      period: "2026-08",
      usedTokens: 20_000_001,
      capTokens: 20_000_000,
    }
  })

  it("does not reach the vendor", async () => {
    const body = await (await chat(request())).json()

    // The assertion the mutation reds: delete `budget.allowed` from `available`
    // in route.ts and an exhausted tenant gets prose.
    expect(mockAiComplete).not.toHaveBeenCalled()
    expect(body.answer).toBeNull()
    expect(body.aiEnabled).toBe(false)
    expect(mockCharges).toEqual([])
  })

  it("degrades rather than erroring — the sources still come back", async () => {
    const res = await chat(request())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.sources).toHaveLength(1)
    expect(body.sources[0].title).toBe("Budget request process")
  })

  it("names the budget, and blames nothing else", async () => {
    const body = await (await chat(request())).json()

    expect(body.budgetRefusal).toBe("budget-exhausted")
    // Not the flag, not the tool, not the connector. An institution sent to a
    // switch that is already on is an institution that files the wrong ticket.
    expect(body.aiDisabledReason).toBeNull()
    expect(body.toolRefusal).toBeNull()
    expect(body.connectorRefusal).toBeNull()
  })

  it("distinguishes an unreadable ceiling from an exhausted one", async () => {
    mockVerdict = {
      allowed: false,
      reason: "budget-unreadable",
      period: "2026-08",
      usedTokens: 0,
      capTokens: null,
    }

    const body = await (await chat(request())).json()

    expect(body.budgetRefusal).toBe("budget-unreadable")
    expect(body.budget.capTokens).toBeNull()
    expect(mockAiComplete).not.toHaveBeenCalled()
  })

  it("writes the verdict onto the audit row, beside the exposure it decided", async () => {
    await chat(request())

    const metadata = mockAuditRows[0]?.metadata as Record<string, unknown>
    expect(metadata.budgetReason).toBe("budget-exhausted")
    expect(metadata.budgetUsedTokens).toBe(20_000_001)
    expect(metadata.budgetCapTokens).toBe(20_000_000)
    // And the exposure it produced, which is the fact the row exists for.
    expect(metadata.modelExposure).toBe(false)
  })
})

describe("the connector gate this file opens is still the real one", () => {
  it("is decided by providerActivation over the recorded review", async () => {
    // Guards the whole file: if the route stopped consulting the activation
    // gate, every budget assertion above would still pass and one control would
    // have silently disappeared. Asserted through the response the route emits.
    const body = await (await chat(request())).json()
    expect(body.connectorRefusal).toBeNull()
    expect(body.connectorDetail).toBeNull()
  })
})
