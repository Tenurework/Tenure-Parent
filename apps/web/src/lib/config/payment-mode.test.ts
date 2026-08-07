/**
 * PAY-000-007 — the money-mode comes from the TENANT, never from the process.
 *
 * This is the assertion the whole separation rests on, so it is written to fail
 * for the one implementation that looks obvious and is wrong: reading
 * `NODE_ENV`. That value is a single string for the whole container, so a
 * platform serving a university still being set up beside one running real
 * budgets would report both the same. Two tenants, one process, two answers is
 * the property, and the only thing that can produce it is a value published per
 * tenant.
 *
 * `resolveSystemConfig` is the injected boundary because it is what turns a
 * tenant's slug into its published values. Everything above it — `modeOf`, the
 * snapshot stamp, the legal-entity read — is the real code under test. Nothing
 * here would notice a mistake in the resolver itself; `config-snapshot.test.ts`
 * runs that for real against the shipped registry and layers.
 */

const mockValuesBySlug: Record<string, Record<string, unknown>> = {}

jest.mock("@/lib/db", () => ({
  db: {
    institution: {
      // The id→slug bridge, and nothing else. `inst_<slug>` keeps the fixture
      // readable without a second mapping table.
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id.startsWith("inst_") ? { slug: where.id.slice("inst_".length) } : null,
    },
  },
}))

jest.mock("@tenure/platform-config", () => ({
  resolveSystemConfig: (slug: string) => ({
    values: mockValuesBySlug[slug] ?? {},
    checksum: `sha256:${slug || "none"}`,
  }),
  terminologyFor: () => ({}),
  decideFlag: () => ({ enabled: false, reason: "turnedOff" }),
  recordFlagExposure: () => {},
}))

jest.mock("@tenure/blueprints", () => ({
  getTenantBinding: () => undefined,
  getBlueprint: () => undefined,
}))

import {
  configSnapshotForInstitution,
  legalEntityIdForInstitution,
  paymentModeForInstitution,
} from "./server"

beforeEach(() => {
  for (const key of Object.keys(mockValuesBySlug)) delete mockValuesBySlug[key]
})

describe("the tenant's money-mode", () => {
  it("is live for a tenant that has published live, in the same process as one that has not", async () => {
    mockValuesBySlug["greenfield"] = { "platform.payments.mode": "live" }
    mockValuesBySlug["onboarding"] = { "platform.payments.mode": "test" }

    expect(await paymentModeForInstitution("inst_greenfield")).toBe("live")
    expect(await paymentModeForInstitution("inst_onboarding")).toBe("test")
  })

  it("is test for a tenant that has published nothing", async () => {
    // Fail closed. An institution nobody has configured is not moving money,
    // and the definition's own default says so.
    expect(await paymentModeForInstitution("inst_unbound")).toBe("test")
  })

  it("is test for a value nobody recognises", async () => {
    // A string from a database row or an imported layer is a string until
    // something checks it. "sandbox" is not a mode this platform has, and
    // treating an unrecognised one as live would be the worst reading of it.
    mockValuesBySlug["odd"] = { "platform.payments.mode": "sandbox" }
    expect(await paymentModeForInstitution("inst_odd")).toBe("test")
  })

  it("stamps the snapshot with the same value it reports", async () => {
    // Two readings of one key, so the scope a request runs in and the
    // configuration it is decided against cannot drift apart — which is exactly
    // what `dispatch` compares.
    mockValuesBySlug["greenfield"] = { "platform.payments.mode": "live" }
    const snapshot = await configSnapshotForInstitution("inst_greenfield")
    expect(snapshot.environment).toBe("live")
    expect(snapshot.environment).toBe(await paymentModeForInstitution("inst_greenfield"))
  })
})

describe("the legal entity a tenant acts for", () => {
  it("is null when the tenant has published none", async () => {
    // The contract requires the field to be present and lets null say "the
    // tenant's own entity" outright, rather than leaving it out.
    expect(await legalEntityIdForInstitution("inst_unbound")).toBeNull()
    mockValuesBySlug["blank"] = { "platform.payments.legalEntityId": "   " }
    expect(await legalEntityIdForInstitution("inst_blank")).toBeNull()
  })

  it("is the published entity when there is one", async () => {
    mockValuesBySlug["greenfield"] = { "platform.payments.legalEntityId": "le-ny" }
    expect(await legalEntityIdForInstitution("inst_greenfield")).toBe("le-ny")
  })
})
