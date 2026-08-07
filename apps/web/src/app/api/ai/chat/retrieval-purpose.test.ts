/**
 * WRK-070-002. Retrieval is bound to the purpose the tenant scope was opened
 * for, and this asserts it at the producer.
 *
 * `/api/ai/chat` is the one path in this application that takes a tenant's rows
 * and posts them to a model vendor. Before this, the scope it opened was
 * indistinguishable from the one behind a calendar render — same tenant, same
 * actor, same rows — so nothing below the route could tell "show this to the
 * person who asked" from "send this to a third party".
 *
 * ## What is faked, and what is deliberately not
 *
 * `@/lib/search-data` is **not** mocked. That is the whole point: the refusal
 * lives inside `loadSearchCorpus`, and a stand-in for it would return a canned
 * document whatever the route did with its scope, which proves nothing. The
 * fakes are strictly beneath the code under test:
 *
 *   * `@/lib/db` — a Prisma stand-in that returns fixture rows. It honours
 *     nothing about the `where`, which is fine here: the assertions below are
 *     about whether retrieval ran at all, not about what it filtered.
 *   * `@/lib/rbac`, `@/lib/config/server` — the identity and configuration
 *     reads, the same boundary `ai-kill-switch.test.ts` fakes.
 *   * `@/lib/ai` — the outbound vendor call.
 *
 * `withTenantScope` is replaced by a stand-in that behaves like the real one in
 * the only respect that matters here: it builds a `TenantScope` carrying the
 * caller's `opts.purpose` (defaulting to `interactive`, exactly as the real
 * implementation does) and runs the body through the **real**
 * `runInTenantScope`. Resolving a purpose from a membership table is not what is
 * under test; carrying it into the scope, and what happens downstream when it is
 * the wrong one, is.
 */

import { REGISTRY, decideFlag, layersFor, type FlagName } from "@tenure/platform-config"
import { resolveConfigOrThrow, type ConfigLayer } from "@tenure/configuration"

import {
  runInTenantScope,
  type TenantPurpose,
  type TenantScope,
} from "@/lib/tenancy/context"

const INSTITUTION = "inst_test"
const USER = "user_test"

/** The purpose the route asked for, captured so the tests can state it. */
let lastPurpose: TenantPurpose | undefined

jest.mock("@/lib/auth", () => ({
  auth: jest.fn(async () => ({ user: { id: "user_test" } })),
}))

jest.mock("@/lib/tenant-scope", () => ({
  withTenantScope: (
    _userId: string,
    fn: (scope: TenantScope) => Promise<unknown>,
    opts?: { purpose?: TenantPurpose },
  ) => {
    // The real `withTenantScope` defaults to `interactive`. Reproducing that
    // default here is what makes the "route forgot to say" case testable: a
    // stand-in that hard-coded `model-exposure` would pass whatever the route
    // did.
    const purpose: TenantPurpose = opts?.purpose ?? "interactive"
    lastPurpose = purpose
    const scope: TenantScope = {
      institutionId: INSTITUTION,
      purpose,
      environment: "test",
      actor: { principalId: USER, principalType: "user" },
    }
    return runInTenantScope(scope, () => fn(scope))
  },
}))

jest.mock("@/lib/rbac", () => ({
  getUserContext: async (userId: string) => ({
    userId,
    institutionRoles: [{ institutionId: "inst_test", role: "OSE_STAFF" }],
    orgRoles: [],
  }),
  // `search-data.ts` reads these two to decide a viewer's clearance in a club.
  isOse: () => true,
}))

jest.mock("@/lib/config/server", () => ({
  flagDecisionForInstitution: async (_institutionId: string, flag: string, subjectId: string) => {
    const layers: ConfigLayer[] = layersFor("rochester")
    return decideFlag(resolveConfigOrThrow(REGISTRY, layers), flag as FlagName, subjectId)
  },
  institutionSlugFor: async () => "rochester",
  legalEntityIdForInstitution: async () => null,
  configSnapshotForInstitution: async () => ({
    tenantId: INSTITUTION,
    revision: "university-student-organizations@1.0.0",
    checksum: "sha256:test",
    values: {},
  }),
}))

const ORG = {
  id: "org_1",
  institutionId: INSTITUTION,
  name: "Robotics Club",
  slug: "robotics",
  description: "Builds robots",
}

const DOCUMENT = {
  id: "doc_1",
  title: "Budget request process",
  description: "Submit the budget request two weeks before the event.",
  organizationId: ORG.id,
  sensitivity: "standard",
}

jest.mock("@/lib/db", () => ({
  db: {
    organization: { findMany: async () => [ORG] },
    memoryRecord: { findMany: async () => [] },
    document: { findMany: async () => [DOCUMENT] },
    approvalRequest: { findMany: async () => [] },
    event: { findMany: async () => [] },
  },
}))

const mockAiComplete = jest.fn(async () => "an answer [1]")
jest.mock("@/lib/ai", () => ({
  aiComplete: (...args: unknown[]) => mockAiComplete(...(args as [])),
  aiConfigured: () => true,
}))

import { policyRevisionOf } from "@tenure/authorization"
import { modulesFor, tiersFor } from "@tenure/platform-config"

import { institutionWorld } from "@/lib/authz/seat-world"
import { TenantContextError } from "@/lib/tenancy/context"
import { POST as chat } from "./route"

const request = () =>
  new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "budget request" }),
  })

beforeEach(() => {
  lastPurpose = undefined
  mockAiComplete.mockClear()
})

describe("/api/ai/chat opens its scope for model exposure", () => {
  it("declares the purpose, so the query layer can tell this apart from a page render", async () => {
    await chat(request())
    expect(lastPurpose).toBe("model-exposure")
  })

  it("retrieves, and the retrieved rows come back as sources", async () => {
    // The assertion the mutation reds. Flip `{ purpose: "model-exposure" }` in
    // route.ts to `"interactive"` — or delete the option so `withTenantScope`'s
    // default applies — and the real `loadSearchCorpus` refuses, this call
    // rejects, and neither expectation below is ever reached.
    //
    // Asserted on `sources` rather than on the vendor call. Whether the prose
    // is generated is decided by three further controls this run does not own
    // (the `aiAssistant` flag, a configured key, and the connector activation
    // gate in `providerActivation`), and any of them being off would make an
    // assertion about `aiComplete` red for reasons that have nothing to do with
    // the purpose. `sources` is the retrieval, which is what the purpose gates.
    const res = await chat(request())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.toolRefusal).toBeNull()
    expect(body.sources.map((s: { title: string }) => s.title)).toContain(
      "Budget request process",
    )
  })

  it("records the policy revision the exposure decision was taken against", async () => {
    // WRK-070-002's second clause. Asserted on the value the ROUTE EMITS, and
    // compared against `policyRevisionOf` recomputed here from the same shipped
    // world — so freezing the field to a constant in route.ts reds this, which
    // an assertion of `toMatch(/^pol-/)` would not.
    const body = await (await chat(request())).json()

    const world = institutionWorld(
      {
        userId: USER,
        institutionRoles: [{ institutionId: INSTITUTION, role: "OSE_STAFF" }],
        orgRoles: [],
      } as never,
      INSTITUTION,
      modulesFor("rochester").keys,
      tiersFor("rochester"),
    )
    const expected = policyRevisionOf(world)

    expect(body.relayTools.policyRevision).toBe(expected)
    const retrieval = body.relayTools.offered.find(
      (o: { toolKey: string }) => o.toolKey === "search.corpus",
    )
    expect(retrieval.policyRevision).toBe(expected)
  })

  it("is refused outright under any other purpose", async () => {
    // The gate itself, exercised through the same production loader the route
    // calls. This is what the route would hit if it stopped declaring its
    // purpose, and it is a refusal rather than an empty result set — an empty
    // corpus reads as "there is nothing here", which is a different and untrue
    // statement.
    const { loadSearchCorpus } = await import("@/lib/search-data")
    for (const purpose of ["interactive", "job", "support", "export"] as const) {
      await expect(
        runInTenantScope(
          {
            institutionId: INSTITUTION,
            purpose,
            environment: "test",
            actor: { principalId: USER, principalType: "user" },
          },
          () => loadSearchCorpus(USER),
        ),
      ).rejects.toThrow(TenantContextError)
    }
  })

  it("refuses the interactive entry point from a model-exposure scope, too", async () => {
    // Both directions. A gate that only stopped `interactive → model` would be
    // routed around by opening a model-exposure scope and calling the
    // interactive sibling, which is the same disclosure with one more step.
    const { loadInteractiveSearchCorpus } = await import("@/lib/search-data")
    await expect(
      runInTenantScope(
        {
          institutionId: INSTITUTION,
          purpose: "model-exposure",
          environment: "test",
          actor: { principalId: USER, principalType: "user" },
        },
        () => loadInteractiveSearchCorpus(USER),
      ),
    ).rejects.toThrow(/loadInteractiveSearchCorpus may only run/)
  })

  it("refuses with no tenant scope at all", async () => {
    const { loadSearchCorpus } = await import("@/lib/search-data")
    await expect(loadSearchCorpus(USER)).rejects.toThrow(TenantContextError)
  })
})
