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

import { REGISTRY, decideFlag, layersFor, type FlagName } from "@tenure/platform-config"
import { resolveConfigOrThrow, type ConfigLayer } from "@tenure/configuration"

const ENABLED_KEY = "platform.flags.aiAssistant.enabled"
const ROLLOUT_KEY = "platform.flags.aiAssistant.rolloutPercent"
const KILL_LIST_KEY = "platform.flags.killed"

/** Overrides folded into the pilot's tenant layer, per test. */
let mockTenantValues: Record<string, unknown> = {}

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
      actor: { principalId: string; principalType: "user" }
    }) => Promise<unknown>,
  ) =>
    fn({
      institutionId: "inst_test",
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
    values: {},
  }),
}))

jest.mock("@/lib/search-data", () => ({
  loadSearchCorpus: async () => [
    {
      id: "doc_1",
      kind: "document",
      title: "Budget request process",
      body: "Submit the budget request two weeks before the event, with quotes attached.",
      href: "/resources/doc_1",
      context: "Ainslie OSE",
    },
  ],
}))

jest.mock("@/lib/ai", () => ({
  aiComplete: (...args: unknown[]) => mockAiComplete(...(args as [])),
  draftText: (...args: unknown[]) => mockDraftText(...(args as [])),
  aiConfigured: () => mockAiConfigured(),
}))

import { lookupPermission } from "@tenure/authorization"

import { relayToolsFor } from "@/lib/relay-tools"
import { POST as chat } from "./chat/route"
import { POST as draft } from "./draft/route"

const chatRequest = () =>
  new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "budget request" }),
  })

const draftRequest = () =>
  new Request("http://localhost/api/ai/draft", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "message", instruction: "ask the treasurer for receipts" }),
  })

beforeEach(() => {
  mockTenantValues = {}
  mockInstitutionRoles = [{ institutionId: "inst_test", role: "OSE_STAFF" }]
  mockAiComplete.mockClear()
  mockDraftText.mockClear()
  mockAiConfigured.mockReturnValue(true)
})

describe("/api/ai/chat honours the aiAssistant flag", () => {
  it("calls the vendor when the flag is on", async () => {
    const res = await chat(chatRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockAiComplete).toHaveBeenCalledTimes(1)
    expect(body.answer).toBe("an answer [1]")
    expect(body.aiEnabled).toBe(true)
    expect(body.aiDisabledReason).toBeNull()
  })

  it("degrades to sources and sends nothing to the vendor when the tenant switches it off", async () => {
    mockTenantValues = { [ENABLED_KEY]: false }

    const res = await chat(chatRequest())
    const body = await res.json()

    // Degrade, not error: the ranked sources are the requester's own rows and
    // never left the process.
    expect(res.status).toBe(200)
    expect(body.sources).toHaveLength(1)
    expect(body.answer).toBeNull()
    expect(body.aiEnabled).toBe(false)
    expect(body.aiDisabledReason).toBe("turnedOff")
    // The assertion this whole item exists for.
    expect(mockAiComplete).not.toHaveBeenCalled()
  })

  it("degrades when the flag is killed in an emergency, and says which", async () => {
    mockTenantValues = { [KILL_LIST_KEY]: ["aiAssistant"] }

    const body = await (await chat(chatRequest())).json()

    expect(body.aiEnabled).toBe(false)
    expect(body.aiDisabledReason).toBe("killed")
    expect(mockAiComplete).not.toHaveBeenCalled()
  })

  it("excludes a user outside the rollout cohort, and includes them inside it", async () => {
    mockTenantValues = { [ROLLOUT_KEY]: 0 }
    const out = await (await chat(chatRequest())).json()
    expect(out.aiEnabled).toBe(false)
    expect(out.aiDisabledReason).toBe("outsideCohort")
    expect(mockAiComplete).not.toHaveBeenCalled()

    mockTenantValues = { [ROLLOUT_KEY]: 100 }
    const inCohort = await (await chat(chatRequest())).json()
    expect(inCohort.aiEnabled).toBe(true)
    expect(mockAiComplete).toHaveBeenCalledTimes(1)
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
  it("retrieves and answers when the registration's permission is held", async () => {
    const body = await (await chat(chatRequest())).json()

    expect(body.sources).toHaveLength(1)
    expect(body.toolRefusal).toBeNull()
    expect(mockAiComplete).toHaveBeenCalledTimes(1)
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
