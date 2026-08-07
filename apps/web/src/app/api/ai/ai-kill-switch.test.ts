/**
 * The kill switch, at the only place it matters: the two routes that send
 * customer content to an external model vendor.
 *
 * A flag registry nothing consumes is a declaration, so this asserts the
 * consumption rather than the declaration — that with the tenant's `aiAssistant`
 * flag off, `/api/ai/chat` degrades to sources-only and `/api/ai/draft` refuses,
 * and in neither case does `lib/ai.ts` reach the vendor.
 *
 * `aiComplete` and `draftText` are the mocked boundary because they are the
 * exact functions holding the outbound `fetch` — the only outbound HTTP call in
 * the application (`docs/architecture/subsystem-paths.md` §7). Asserting they
 * were not called is asserting no customer content left the process.
 *
 * Everything below the routes is real: the decision comes from `decideFlag` over
 * a real `resolveConfigOrThrow` against the shipped registry and Rochester's own
 * layers, with the overrides written into the tenant layer exactly as editing
 * that binding would. Only the database read and the vendor call are faked.
 */

import {
  REGISTRY,
  RELAY_ANTHROPIC_REVIEW,
  RELAY_ANTHROPIC_SCOPES,
  decideFlag,
  layersFor,
  providerActivation,
  type FlagName,
  type ProviderReview,
} from "@tenure/platform-config"

/** The instant every provider-review decision below is made for. */
const NOW = "2026-08-01T00:00:00.000Z"
import { resolveConfigOrThrow, type ConfigLayer } from "@tenure/configuration"

const ENABLED_KEY = "platform.flags.aiAssistant.enabled"
const ROLLOUT_KEY = "platform.flags.aiAssistant.rolloutPercent"
const KILL_LIST_KEY = "platform.flags.killed"

/** Overrides folded into the pilot's tenant layer, per test. */
let mockTenantValues: Record<string, unknown> = {}

/**
 * Registrations the pilot's `search` manifest contributes on top of the shipped
 * one, per test.
 *
 * `modules/index.ts` declares exactly one tool and it is read-only, so the
 * surface's read-only ceiling and the risk classification would both be
 * asserted against the only case they do not fire on. This is not a stub of the
 * module catalog: `jest.requireActual` resolves the real one, the manifest, the
 * blueprint, the tenant binding and every other module are untouched, and the
 * added registration goes through the same `parseToolRegistration` the shipped
 * one does. What differs is one entry in one manifest's `tools` array — which
 * is exactly the change that will land when the platform declares its second
 * tool, and the thing this route has to already be right about.
 */
let mockExtraTools: import("@tenure/contracts").ToolRegistration[] = []

jest.mock("@tenure/platform-config", () => {
  const actual = jest.requireActual<typeof import("@tenure/platform-config")>(
    "@tenure/platform-config",
  )
  return {
    ...actual,
    modulesFor: (slug: string, at?: string) => {
      const resolved = at ? actual.modulesFor(slug, at) : actual.modulesFor(slug)
      if (mockExtraTools.length === 0) return resolved
      return {
        ...resolved,
        enabled: resolved.enabled.map((m) =>
          m.key === "search" ? { ...m, tools: [...(m.tools ?? []), ...mockExtraTools] } : m,
        ),
      }
    },
  }
})

/**
 * What `flagDecisionForInstitution` does minus the id→slug database read: the
 * real engine, the real layers, the real decision.
 */
function mockFlagDecision(flag: string, subjectId: string) {
  const layers: ConfigLayer[] = layersFor("rochester").map((l) =>
    l.scope === "tenant" ? { ...l, values: { ...l.values, ...mockTenantValues } } : l,
  )
  return decideFlag(resolveConfigOrThrow(REGISTRY, layers), flag as FlagName, subjectId)
}

const mockAiComplete = jest.fn(async () => "an answer [1]")
const mockDraftText = jest.fn(async () => "a draft")
const mockAiConfigured = jest.fn(() => true)

jest.mock("@/lib/auth", () => ({
  auth: jest.fn(async () => ({ user: { id: "user_test" } })),
}))

jest.mock("@/lib/tenant-scope", () => ({
  withTenantScope: (
    _userId: string,
    fn: (scope: {
      institutionId: string
      // PAY-020-003. The scope carries the tenant's money-mode, and the route
      // reads it straight onto the TenantContext it builds — so a stand-in that
      // omitted it would let the route pass a value the real one never could.
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

/**
 * The institution role the requester holds, per test.
 *
 * `institution.staff` carries `search.index.query`, which is what the
 * `search.corpus` tool registration requires — so the default here is a
 * requester the retrieval tool is offered to, and a test that empties it is a
 * requester it is refused to. Both paths matter: the flag assertions below are
 * only about the flag if the tool is not silently deciding the outcome.
 */
let mockInstitutionRoles: { institutionId: string; role: string }[] = [
  { institutionId: "inst_test", role: "OSE_STAFF" },
]

jest.mock("@/lib/rbac", () => ({
  getUserContext: async (userId: string) => ({
    userId,
    institutionRoles: mockInstitutionRoles,
    orgRoles: [],
  }),
}))

jest.mock("@/lib/config/server", () => ({
  flagDecisionForInstitution: async (_institutionId: string, flag: string, subjectId: string) =>
    mockFlagDecision(flag, subjectId),
  // The id→slug bridge, faked at the database read only: everything the slug
  // then reaches — the blueprint, the module catalog, the tool registrations —
  // is the real thing, which is what makes the tool assertions below mean
  // anything.
  institutionSlugFor: async () => "rochester",
  configSnapshotForInstitution: async () => ({
    tenantId: "inst_test",
    revision: "university-student-organizations@1.0.0",
    checksum: "sha256:test",
    environment: "test" as const,
    values: {},
  }),
  // Resolved from `platform.payments.legalEntityId`; null is the real answer
  // for a tenant that has published none, which is every tenant today.
  legalEntityIdForInstitution: async () => null,
}))

/**
 * The corpus, per principal — because the real loader is per principal.
 *
 * `loadSearchCorpus(userId)` derives the visible organizations from that user's
 * own memberships, so which rows come back IS the tenancy decision. Returning
 * the same document whoever asked would have made "the model cannot choose
 * whose data to read" unfalsifiable here: the assertion is that the route calls
 * it with the acting session's user and with nothing the request body proposed.
 */
const mockLoadSearchCorpus = jest.fn(async (userId: string) => [
  {
    id: `doc_${userId}`,
    kind: "document",
    title: "Budget request process",
    body: "Submit the budget request two weeks before the event, with quotes attached.",
    href: "/resources/doc_1",
    context: userId === "user_test" ? "Ainslie OSE" : "Somebody else's institution",
    // WRK-010-003. The real loader stamps a §3.4 projection mode on every
    // doc; a stand-in that omitted it would be projected as REFERENCE_ONLY
    // (the fail-closed default) and the body would silently stop reaching the
    // prompt — which is not what a `document` does in production.
    mode: "SEARCH_PROJECTION",
  },
])

jest.mock("@/lib/search-data", () => ({
  loadSearchCorpus: (...args: unknown[]) => mockLoadSearchCorpus(...(args as [string])),
}))

jest.mock("@/lib/ai", () => ({
  aiComplete: (...args: unknown[]) => mockAiComplete(...(args as [])),
  draftText: (...args: unknown[]) => mockDraftText(...(args as [])),
  aiConfigured: () => mockAiConfigured(),
}))

import { lookupPermission } from "@tenure/authorization"
import { parseTenantContext, parseToolRegistration } from "@tenure/contracts"

import { authorizeRelayTools, relayToolsFor } from "@/lib/relay-tools"
import { POST as chat } from "./chat/route"
import { POST as draft } from "./draft/route"

/** A body carrying whatever the caller — ultimately the model — proposed. */
const chatRequestWith = (extra: Record<string, unknown>) =>
  new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "budget request", ...extra }),
  })

const chatRequest = () => chatRequestWith({})

const draftRequest = () =>
  new Request("http://localhost/api/ai/draft", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "message", instruction: "ask the treasurer for receipts" }),
  })

beforeEach(() => {
  mockTenantValues = {}
  mockInstitutionRoles = [{ institutionId: "inst_test", role: "OSE_STAFF" }]
  mockExtraTools = []
  mockAiComplete.mockClear()
  mockDraftText.mockClear()
  mockLoadSearchCorpus.mockClear()
  mockAiConfigured.mockReturnValue(true)
})

/* ---------------------------------------------------------------- WRK-040-003 --
 * The connector's own activation gate now sits in front of the vendor call, and
 * it is currently CLOSED. `RELAY_ANTHROPIC_REVIEW` records that no provider-side
 * review of this integration has been submitted, which is true, so
 * `/api/ai/chat` refuses the vendor call for every requester regardless of the
 * flag.
 *
 * That is a deliberate behaviour change and these tests say so rather than being
 * relaxed around it. The flag's independent REPORTING is still asserted below —
 * `aiDisabledReason` still distinguishes turnedOff from killed from
 * outsideCohort from a missing key — and the flag's EFFECT on the vendor call is
 * proven on `/api/ai/draft`, which this gate does not cover. When somebody
 * performs and records a provider review, the assertions here flip back by
 * changing the record, not the gate.
 */
describe("/api/ai/chat reports the flag, the tool and the connector separately", () => {
  it("refuses the vendor call because the provider has not reviewed the connector", async () => {
    const res = await chat(chatRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    // Degrade, not error. The ranked sources are the requester's own rows and
    // never left the process.
    expect(body.sources).toHaveLength(1)
    expect(body.answer).toBeNull()
    expect(body.aiEnabled).toBe(false)
    // Not the flag, and not the tool. Naming the wrong one sends an institution
    // to a switch that is already on.
    expect(body.aiDisabledReason).toBeNull()
    expect(body.toolRefusal).toBeNull()
    expect(body.connectorRefusal).toBe("provider-review-missing")
    expect(body.connectorDetail).toMatch(/NOT_SUBMITTED/)
    expect(mockAiComplete).not.toHaveBeenCalled()
  })

  it("still names the flag as the reason when the tenant switches it off", async () => {
    mockTenantValues = { [ENABLED_KEY]: false }

    const body = await (await chat(chatRequest())).json()

    expect(body.sources).toHaveLength(1)
    expect(body.answer).toBeNull()
    expect(body.aiEnabled).toBe(false)
    // The whole point of separate fields: two things are wrong and the response
    // says both, rather than collapsing to whichever was checked first.
    expect(body.aiDisabledReason).toBe("turnedOff")
    expect(body.connectorRefusal).toBe("provider-review-missing")
    expect(mockAiComplete).not.toHaveBeenCalled()
  })

  it("distinguishes killed from switched off from outside the cohort", async () => {
    mockTenantValues = { [KILL_LIST_KEY]: ["aiAssistant"] }
    expect((await (await chat(chatRequest())).json()).aiDisabledReason).toBe("killed")

    mockTenantValues = { [ROLLOUT_KEY]: 0 }
    expect((await (await chat(chatRequest())).json()).aiDisabledReason).toBe("outsideCohort")

    mockTenantValues = { [ROLLOUT_KEY]: 100 }
    expect((await (await chat(chatRequest())).json()).aiDisabledReason).toBeNull()

    expect(mockAiComplete).not.toHaveBeenCalled()
  })

  it("does not blame the tenant when the model key is merely missing", async () => {
    // Two different facts. An institution that has turned nothing off must not
    // be told that it did.
    mockAiConfigured.mockReturnValue(false)

    const body = await (await chat(chatRequest())).json()

    expect(body.aiEnabled).toBe(false)
    expect(body.aiDisabledReason).toBeNull()
    expect(mockAiComplete).not.toHaveBeenCalled()
  })
})

describe("the connector gate the route consults is a real subset check", () => {
  // The route reads a module constant, so these exercise the same function it
  // calls with the records a real review would produce. Without them the gate
  // would be proven only in its refusing direction, and a gate that refuses
  // everything is indistinguishable from a gate that is broken.
  it("activates when the provider approved every requested scope", () => {
    const approved: ProviderReview = {
      program: "Anthropic API",
      state: "APPROVED",
      approvedScopes: [...RELAY_ANTHROPIC_SCOPES],
      verifiedAt: "2026-07-01T00:00:00.000Z",
      expiresAt: "2027-07-01T00:00:00.000Z",
    }
    expect(providerActivation(RELAY_ANTHROPIC_SCOPES, approved, NOW)).toMatchObject({
      activated: true,
      reason: "activated",
    })
  })

  it("refuses when the approval omits one requested scope", () => {
    const narrow: ProviderReview = {
      program: "Anthropic API",
      state: "APPROVED",
      approvedScopes: [],
      verifiedAt: "2026-07-01T00:00:00.000Z",
      expiresAt: "2027-07-01T00:00:00.000Z",
    }
    const verdict = providerActivation(RELAY_ANTHROPIC_SCOPES, narrow, NOW)
    expect(verdict).toMatchObject({
      activated: false,
      reason: "scopes-exceed-provider-approval",
    })
    expect(verdict.unapprovedScopes).toEqual([...RELAY_ANTHROPIC_SCOPES])
  })

  it("refuses an approval that has lapsed, distinctly from one never granted", () => {
    const lapsed: ProviderReview = {
      program: "Anthropic API",
      state: "APPROVED",
      approvedScopes: [...RELAY_ANTHROPIC_SCOPES],
      verifiedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-07-01T00:00:00.000Z",
    }
    expect(providerActivation(RELAY_ANTHROPIC_SCOPES, lapsed, NOW).reason).toBe(
      "provider-review-expired",
    )
    expect(providerActivation(RELAY_ANTHROPIC_SCOPES, undefined, NOW).reason).toBe(
      "provider-review-missing",
    )
  })

  it("records honestly that nobody has reviewed the shipped connector", () => {
    // The record the route actually reads. If this ever says APPROVED, somebody
    // has to have done the review and written the evidence down.
    expect(RELAY_ANTHROPIC_REVIEW.state).toBe("NOT_SUBMITTED")
    expect(RELAY_ANTHROPIC_REVIEW.approvedScopes).toEqual([])
  })
})

/**
 * PACK-070-004. The tool registration is the gate, not documentation.
 *
 * `modules/index.ts` declares `search.corpus` on the `search` module with
 * `requiredPermission: "search.index.query"`. These assert that the declaration
 * decides what the route does: retrieval runs when the requester holds that
 * permission and does not when they do not — and that a refusal is reported as
 * a refusal rather than as an empty result set, which is a different and untrue
 * statement to make to somebody.
 */
describe("/api/ai/chat retrieves only through an authorized tool registration", () => {
  it("retrieves when the registration's permission is held", async () => {
    const body = await (await chat(chatRequest())).json()

    expect(body.sources).toHaveLength(1)
    expect(body.toolRefusal).toBeNull()
    // WRK-040-003. Retrieval and the vendor call are separately gated, and the
    // connector gate is currently closed — so the sources come back and the
    // prose does not. Asserting a vendor call here would be asserting that the
    // connector gate does not work.
    expect(body.connectorRefusal).toBe("provider-review-missing")
    expect(mockAiComplete).not.toHaveBeenCalled()
  })

  it("retrieves nothing, and says why, when it is not", async () => {
    // No institution role and no seat: `decide()` refuses, so the tool is never
    // offered. The corpus loader is unchanged and would still have returned a
    // document — which is the point. The refusal is upstream of retrieval.
    mockInstitutionRoles = []

    const res = await chat(chatRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.sources).toEqual([])
    expect(body.answer).toBeNull()
    expect(body.aiEnabled).toBe(false)
    // Not the flag. The tenant switched nothing off.
    expect(body.aiDisabledReason).toBeNull()
    expect(typeof body.toolRefusal).toBe("string")
    expect(body.toolRefusal.length).toBeGreaterThan(0)
    // A model asked to answer from sources it was not allowed to retrieve would
    // answer from its training instead, so the vendor is not called either.
    expect(mockAiComplete).not.toHaveBeenCalled()
  })

  it("names a permission the catalog defines, so the gate is not a private string", () => {
    // Guards the two tests above: if the registration named a permission no
    // role could ever hold, the refusal case would pass for the wrong reason
    // and the allow case would be the only real assertion.
    const registrations = relayToolsFor("rochester")
    expect(registrations.map((t) => t.toolKey)).toContain("search.corpus")

    const corpus = registrations.find((t) => t.toolKey === "search.corpus")!
    expect(corpus.readOnly).toBe(true)
    expect(corpus.reauthorizesPerCall).toBe(true)
    expect(lookupPermission(corpus.requiredPermission)?.module).toBe("search")
  })
})

/**
 * A writing registration this route must never offer, contributed the way a
 * real one would be. `approvals.request.create` is a permission the requester
 * genuinely holds — under `allow: "any"` this tool IS offered
 * (relay-tools.test.ts proves that) — so a route that stopped passing
 * `"read-only"` would hand it to the model, and these assertions are what
 * notices.
 */
const writingRegistration = () =>
  parseToolRegistration({
    toolKey: "approvals.raise",
    module: "approvals",
    description: "Raise an approval request on the requester's behalf from what they described.",
    requiredPermission: "approvals.request.create",
    readOnly: false,
    reauthorizesPerCall: true,
  })

/**
 * WRK-050-005 / WRK-050-001 — the route says what each tool would do, and
 * refuses the ones it cannot safely run.
 */
describe("/api/ai/chat classifies the tools it was offered and the ones it was not", () => {
  it("reports the risk class of the tool it ran", async () => {
    const body = await (await chat(chatRequest())).json()

    // The one shipped registration, classified from its own `readOnly: true`.
    expect(body.toolRiskClass).toBe("READ")
    // `policyRevision` per offered tool is WRK-070-002: the policy the exposure
    // decision was taken under, which `configRevision` does not answer. Asserted
    // as equal to the top-level one rather than as a literal, because the value
    // is a hash of the authorization world — pinning it would red on any role
    // template edit, and `expect.any(String)` would not catch the two
    // disagreeing, which is the failure that actually matters here.
    expect(typeof body.relayTools.policyRevision).toBe("string")
    expect(body.relayTools.offered).toEqual([
      {
        toolKey: "search.corpus",
        riskClass: "READ",
        policyRevision: body.relayTools.policyRevision,
      },
    ])
  })

  it("refuses a writing registration on a surface that cannot confirm anything", async () => {
    mockExtraTools = [writingRegistration()]

    const body = await (await chat(chatRequest())).json()

    // Offered: the read. Not offered: the write — even though this requester
    // holds `approvals.request.create` and the approvals domain's own policy.
    expect(body.relayTools.offered.map((t: { toolKey: string }) => t.toolKey)).toEqual([
      "search.corpus",
    ])
    const refused = body.relayTools.refused.find(
      (r: { toolKey: string }) => r.toolKey === "approvals.raise",
    )
    expect(refused).toBeDefined()
    expect(refused.riskClass).toBe("WRITE")
    expect(refused.remedy).toEqual({ kind: "SURFACE_IS_READ_ONLY", toolKey: "approvals.raise" })
    expect(body.relayTools.policy).toBe("read-only")
    // Retrieval is unaffected: refusing one tool is not refusing the surface.
    expect(body.sources).toHaveLength(1)
  })
})

/**
 * WRK-050-006 — the proposal is the model's; the tenant, the actor and the
 * operation are not.
 */
describe("/api/ai/chat runs the proposal through one door", () => {
  it("loads the corpus for the session's own user, never a proposed one", async () => {
    const body = await (await chat(chatRequest())).json()

    expect(mockLoadSearchCorpus).toHaveBeenCalledTimes(1)
    expect(mockLoadSearchCorpus).toHaveBeenCalledWith("user_test")
    expect(body.sources[0].context).toBe("Ainslie OSE")
  })

  it("refuses a proposal that names another institution's tenant", async () => {
    const res = await chat(
      chatRequestWith({ toolKey: "search.corpus", args: { tenantId: "inst_other" } }),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.toolRemedy).toEqual({ kind: "PROPOSAL_NOT_ACCEPTED", rejected: "tenantId" })
    expect(body.toolRefusal).toContain("whose data")
    // The capability is available and the request was wrong. Reporting these as
    // one fact would tell this person they have no access to search, which is
    // false and is the thing they would then go and ask an administrator for.
    expect(body.relayTools.retrievalAvailable).toBe(true)
    // Nothing was retrieved for anybody — not for the proposed tenant and not
    // for the acting one, because a refused proposal does not run.
    expect(body.sources).toEqual([])
    expect(mockLoadSearchCorpus).not.toHaveBeenCalled()
    expect(mockAiComplete).not.toHaveBeenCalled()
  })

  it("refuses a proposal that tries to act as somebody else", async () => {
    const body = await (
      await chat(chatRequestWith({ args: { onBehalfOf: "user_other" } }))
    ).json()

    expect(body.toolRemedy).toEqual({ kind: "PROPOSAL_NOT_ACCEPTED", rejected: "onBehalfOf" })
    expect(mockLoadSearchCorpus).not.toHaveBeenCalled()
  })

  it("refuses a tool this system has no registration for", async () => {
    const body = await (await chat(chatRequestWith({ toolKey: "finance.ledger" }))).json()

    expect(body.toolRemedy).toEqual({ kind: "MODULE_NOT_INSTALLED", module: "finance" })
    expect(body.toolDisclosure).toBe("not-in-this-system")
    // Unknown, because there is nothing to classify — not silently "READ".
    expect(body.toolRiskClass).toBeNull()
    expect(body.sources).toEqual([])
    expect(mockLoadSearchCorpus).not.toHaveBeenCalled()
  })

  it("refuses an offered tool this surface does not execute", async () => {
    // Offered (the requester holds its permission and the approvals policy) and
    // still refused, because this route retrieves and does nothing else.
    mockExtraTools = [writingRegistration()]

    const body = await (await chat(chatRequestWith({ toolKey: "approvals.raise" }))).json()

    expect(body.sources).toEqual([])
    expect(mockLoadSearchCorpus).not.toHaveBeenCalled()
    expect(body.toolRefusal.length).toBeGreaterThan(0)
  })
})

/**
 * WRK-030-001 / WRK-GATE-030 — what the browser is told, and what it is not.
 */
describe("/api/ai/chat refuses without disclosing the engine's reasoning", () => {
  /** The same principal the route will decide against, decided here directly. */
  const internalRefusal = () =>
    authorizeRelayTools(
      { userId: "user_test", institutionRoles: [], orgRoles: [] },
      parseTenantContext({
        tenantId: "inst_test",
        actorId: "user_test",
        actorKind: "user",
        channel: "web",
        correlationId: "corr-1",
        configRevision: "university-student-organizations@1.0.0",
        environment: "test",
        legalEntityId: null,
        at: new Date().toISOString(),
      }),
      "rochester",
      "read-only",
    ).refused[0]

  /**
   * Every string anywhere in the response, however deeply nested.
   *
   * Searching `JSON.stringify(body)` for a substring is not the same check: the
   * engine's detail contains quotes, JSON escapes them, and the escaped form
   * does not contain the raw one — so a leaked reason would have passed a
   * stringify-and-includes assertion. That is not a hypothetical; it is what
   * this test did before, and returning `r.reason` slipped through it.
   */
  const stringsIn = (value: unknown): string[] =>
    typeof value === "string"
      ? [value]
      : Array.isArray(value)
        ? value.flatMap(stringsIn)
        : value && typeof value === "object"
          ? Object.values(value).flatMap(stringsIn)
          : []

  it("returns the safe half and none of the internal half", async () => {
    mockInstitutionRoles = []

    const body = await (await chat(chatRequest())).json()
    const onTheWire = stringsIn(body)
    const internal = internalRefusal()

    // The internal half exists and is worth logging.
    expect(internal.requiredPermission).toBe("search.index.query")
    expect(internal.reason.length).toBeGreaterThan(0)

    // And none of it is on the wire. Not the key that would unlock the
    // capability, and not the engine's own words about this principal.
    expect(onTheWire.filter((s) => s.includes(internal.requiredPermission))).toEqual([])
    expect(onTheWire.filter((s) => s.includes(internal.reason))).toEqual([])

    // What is on the wire is the same fact, said to the person.
    expect(body.toolRefusal).toBe(internal.safeReason)
    expect(body.toolDisclosure).toBe("not-permitted")
    // And here retrieval genuinely is unavailable — the other value of the
    // field asserted in "refuses a proposal that names another institution's
    // tenant", so it tracks the decision rather than being a constant.
    expect(body.relayTools.retrievalAvailable).toBe(false)
  })

  it("names somebody who could grant it, from the shipped role catalog", async () => {
    mockInstitutionRoles = []

    const body = await (await chat(chatRequest())).json()

    expect(body.toolRemedy.kind).toBe("PERMISSION_NOT_HELD")
    expect(body.toolRemedy.grantedByRoles).toContain("institution.director")
    expect(body.toolRemedy.grantedByRoles).toContain("unit.member")
    // The way out, without the key. Both halves matter: a remedy that carried
    // `requiredPermission` would put the disclosure straight back.
    expect(body.toolRemedy.requiredPermission).toBeUndefined()
  })

  it("says 'not part of this system' rather than 'you may not' when it is not here", async () => {
    // The other branch of the same decision, and the reason the two must not be
    // collapsed: nobody can grant access to a module the tenant does not run.
    const body = await (await chat(chatRequestWith({ toolKey: "finance.ledger" }))).json()

    expect(body.toolDisclosure).toBe("not-in-this-system")
    expect(body.toolRemedy.kind).toBe("MODULE_NOT_INSTALLED")
    expect(body.toolRemedy.kind).not.toBe("PERMISSION_NOT_HELD")
  })
})

describe("/api/ai/draft honours the aiAssistant flag", () => {
  it("drafts when the flag is on", async () => {
    const res = await draft(draftRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: "a draft" })
    expect(mockDraftText).toHaveBeenCalledTimes(1)
  })

  it("refuses with 403 and sends nothing to the vendor when the flag is off", async () => {
    mockTenantValues = { [ENABLED_KEY]: false }

    const res = await draft(draftRequest())

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: "feature_disabled",
      flag: "aiAssistant",
      reason: "turnedOff",
    })
    expect(mockDraftText).not.toHaveBeenCalled()
  })

  it("refuses with 403 when killed, and keeps 503 for an unconfigured model", async () => {
    mockTenantValues = { [KILL_LIST_KEY]: ["aiAssistant"] }
    const killed = await draft(draftRequest())
    expect(killed.status).toBe(403)
    expect((await killed.json()).reason).toBe("killed")

    // 503 is a different fact — no model configured anywhere — and DraftAssist
    // shows a different message for each.
    mockTenantValues = {}
    mockAiConfigured.mockReturnValue(false)
    const unconfigured = await draft(draftRequest())
    expect(unconfigured.status).toBe(503)
    expect(await unconfigured.json()).toEqual({ error: "ai_disabled" })
    expect(mockDraftText).not.toHaveBeenCalled()
  })

  it("checks the flag before it looks at the request body", async () => {
    // A refusal must not depend on the payload parsing, or a malformed body
    // would route around the switch with a 400.
    mockTenantValues = { [ENABLED_KEY]: false }

    const res = await draft(
      new Request("http://localhost/api/ai/draft", { method: "POST", body: "not json" }),
    )

    expect(res.status).toBe(403)
    expect(mockDraftText).not.toHaveBeenCalled()
  })

  it("excludes a user outside the rollout cohort", async () => {
    mockTenantValues = { [ROLLOUT_KEY]: 0 }
    const res = await draft(draftRequest())
    expect(res.status).toBe(403)
    expect((await res.json()).reason).toBe("outsideCohort")
    expect(mockDraftText).not.toHaveBeenCalled()
  })
})

describe("the decision the routes consume is the engine's, not a stub", () => {
  it("resolves through the shipped registry and the pilot's own layers", () => {
    // Guards the test itself: if the bridge stopped running the engine, every
    // assertion above would still pass against a hardcoded answer.
    // Three layers now, not two: an archetype layer sits between the blueprint
    // and the tenant. The exact list is asserted rather than a length or a
    // subset, because the thing this guards against is the bridge quietly
    // resolving against something other than the shipped stack, and a loose
    // assertion would not notice that.
    expect(layersFor("rochester").map((l) => l.scope)).toEqual([
      "blueprint",
      "archetype",
      "tenant",
    ])
    expect(mockFlagDecision("aiAssistant", "user_test")).toMatchObject({
      flag: "aiAssistant",
      enabled: true,
      reason: "enabled",
    })
  })
})
