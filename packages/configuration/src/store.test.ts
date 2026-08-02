import { z } from "zod"

import { ConfigRegistry, defineConfig } from "./definition"
import { layerDigest } from "./integrity"
import { requiresApproval, type VersionedLayer } from "./layer-schema"
import { planPublication } from "./publication"
import { resolveVersionedLayers } from "./layer-bridge"
import { ConfigStoreError, InMemoryConfigStore, commit, rollbackTarget } from "./store"
import { EXPRESSION_LANGUAGE_VERSION } from "./expression"

/**
 * GE-031-007 — the single canonical write path.
 *
 * The tests that matter are the refusals: a blocked plan cannot be committed, a
 * version cannot be edited in place, and a revision cannot be replaced. Each is
 * the point of a different earlier item, and each was previously a function
 * taking an argument rather than a guarantee.
 */

const NOW = new Date("2026-08-02T00:00:00Z")
const LATER = new Date("2026-08-03T00:00:00Z")

const registry = ConfigRegistry.of([
  defineConfig({
    key: "platform.localization.currency",
    owner: "platform",
    type: z.string(),
    default: "USD",
    allowedScopes: ["blueprint", "tenant"],
    mergeStrategy: "replace",
    sensitivity: "public",
    overridable: true,
    description: "Currency.",
  }),
])

function layer(
  id: string,
  values: Record<string, unknown>,
  over: Partial<VersionedLayer["metadata"]> = {},
): VersionedLayer {
  const kind: VersionedLayer["kind"] = "tenantOverlay"
  return {
    kind,
    id,
    values,
    metadata: {
      version: 1,
      schemaVersion: "1.0.0",
      signer: "arn:aws:kms:us-east-1:000000000000:key/test",
      origin: "store.test.ts",
      compatibility: { minEngine: "2026.7.0", maxEngine: null },
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      effectiveUntil: null,
      changeReason: "a reason long enough to be a reason",
      approvedBy: requiresApproval(kind) ? "operator:approver" : null,
      ...over,
    },
  }
}

function planFor(layers: readonly VersionedLayer[], current: { values: Readonly<Record<string, unknown>>; revision: number } | null) {
  return planPublication({
    registry,
    current,
    proposed: layers,
    publishedBy: "operator:publisher",
    activateAt: LATER,
    now: NOW,
  })
}

function resolved(layers: readonly VersionedLayer[]) {
  const result = resolveVersionedLayers(registry, layers, LATER, { collectProblems: true })
  if (!result.config) throw new Error("fixture does not resolve")
  return { values: result.config.values, checksum: result.config.checksum }
}

async function commitOnce(store: InMemoryConfigStore, layers: readonly VersionedLayer[]) {
  const latest = await store.latest("acme")
  const { values, checksum } = resolved(layers)
  return commit({
    store,
    tenantId: "acme",
    plan: planFor(layers, latest ? { values: latest.values, revision: latest.revision } : null),
    layers,
    values,
    checksum,
    publishedBy: "operator:publisher",
    publishedAt: NOW,
  })
}

describe("committing a revision", () => {
  it("numbers revisions from one, monotonically", async () => {
    const store = new InMemoryConfigStore()
    const first = await commitOnce(store, [layer("acme", { "platform.localization.currency": "GBP" })])
    const second = await commitOnce(store, [
      layer("acme", { "platform.localization.currency": "EUR" }, { version: 2 }),
    ])
    expect(first.revision).toBe(1)
    expect(second.revision).toBe(2)
  })

  it("records the provenance and the per-layer digests", async () => {
    const store = new InMemoryConfigStore()
    const layers = [layer("acme", { "platform.localization.currency": "GBP" })]
    const record = await commitOnce(store, layers)
    expect(record.provenance).toMatch(/^sha256:/)
    expect(record.layerDigests).toEqual([
      { kind: "tenantOverlay", id: "acme", version: 1, digest: layerDigest(layers[0]) },
    ])
  })

  it("records the expression language version", async () => {
    // GE-031-005 declared it and stored it nowhere. An expression evaluated by
    // a different language version is a different expression.
    const store = new InMemoryConfigStore()
    const record = await commitOnce(store, [layer("acme", { "platform.localization.currency": "GBP" })])
    expect(record.languageVersion).toBe(EXPRESSION_LANGUAGE_VERSION)
  })

  it("stores the plan that justified it", async () => {
    // GE-031-006 produced everything an audit entry needs and wrote nothing.
    const store = new InMemoryConfigStore()
    const record = await commitOnce(store, [layer("acme", { "platform.localization.currency": "GBP" })])
    expect(record.plan.humanDiff).toContain("platform.localization.currency")
    expect(record.plan.activateAt).toBe(LATER.toISOString())
  })

  it("takes the rollback target from the plan rather than recomputing it", async () => {
    // The operator signed a plan naming a target; a rollback pointing somewhere
    // else is not the change they approved.
    const store = new InMemoryConfigStore()
    await commitOnce(store, [layer("acme", { "platform.localization.currency": "GBP" })])
    const second = await commitOnce(store, [
      layer("acme", { "platform.localization.currency": "EUR" }, { version: 2 }),
    ])
    expect(second.rollbackTo).toBe(1)
  })

  it("says null for the first revision rather than implying a predecessor", async () => {
    const store = new InMemoryConfigStore()
    const first = await commitOnce(store, [layer("acme", { "platform.localization.currency": "GBP" })])
    expect(first.rollbackTo).toBeNull()
  })
})

describe("it refuses what the earlier items exist to refuse", () => {
  it("refuses a blocked plan", async () => {
    // Committing one would make the GE-031-006 gate advisory, and an advisory
    // gate is one people learn to click past.
    const store = new InMemoryConfigStore()
    const layers = [
      layer("acme", { "platform.localization.currency": "GBP" }, { approvedBy: "operator:publisher" }),
    ]
    const { values, checksum } = resolved(layers)
    await expect(
      commit({
        store,
        tenantId: "acme",
        plan: planFor(layers, null),
        layers,
        values,
        checksum,
        publishedBy: "operator:publisher",
        publishedAt: NOW,
      }),
    ).rejects.toThrow(/Refusing to publish a blocked plan/)
  })

  it("refuses a version edited in place, against real history", async () => {
    // GE-031-003's check took the published digests as an argument; here they
    // come from the store, which is what makes it a guarantee.
    const store = new InMemoryConfigStore()
    await commitOnce(store, [layer("acme", { "platform.localization.currency": "GBP" })])

    // Same id, same version, different content.
    await expect(
      commitOnce(store, [layer("acme", { "platform.localization.currency": "EUR" })]),
    ).rejects.toThrow(/A version is immutable; publish a new one/)
  })

  it("accepts the same version republished with identical content", async () => {
    // Re-reading from a replica is not a breach, and treating it as one would
    // fire on every redeploy.
    const store = new InMemoryConfigStore()
    const layers = [layer("acme", { "platform.localization.currency": "GBP" })]
    await commitOnce(store, layers)
    await expect(commitOnce(store, layers)).resolves.toBeDefined()
  })

  it("refuses a plan reviewed against a revision the tenant has moved past", async () => {
    // The operator approved a diff computed against revision 1; the tenant is
    // now at 2. Applying it would publish a change nobody reviewed. Found by a
    // mutation that recomputed the rollback target instead of taking the signed
    // one — the two agreed in every linear test, and only because this hole
    // existed.
    const store = new InMemoryConfigStore()
    await commitOnce(store, [layer("acme", { "platform.localization.currency": "GBP" })])
    const stalePlan = planFor(
      [layer("acme", { "platform.localization.currency": "EUR" }, { version: 2 })],
      null,
    )
    const layers = [layer("acme", { "platform.localization.currency": "EUR" }, { version: 2 })]
    const { values, checksum } = resolved(layers)
    await expect(
      commit({
        store,
        tenantId: "acme",
        plan: stalePlan,
        layers,
        values,
        checksum,
        publishedBy: "operator:publisher",
        publishedAt: NOW,
      }),
    ).rejects.toThrow(/is not the diff this would apply/)
  })

  it("refuses a tenant with no id and an actor with no name", async () => {
    const store = new InMemoryConfigStore()
    const layers = [layer("acme", { "platform.localization.currency": "GBP" })]
    const { values, checksum } = resolved(layers)
    const shared = { store, plan: planFor(layers, null), layers, values, checksum, publishedAt: NOW }
    await expect(commit({ ...shared, tenantId: " ", publishedBy: "op" })).rejects.toThrow(/no tenant/)
    await expect(commit({ ...shared, tenantId: "acme", publishedBy: " " })).rejects.toThrow(/no actor/)
  })
})

describe("the store is append-only", () => {
  it("refuses a revision that already exists", async () => {
    const store = new InMemoryConfigStore()
    const record = await commitOnce(store, [layer("acme", { "platform.localization.currency": "GBP" })])
    await expect(store.append(record)).rejects.toThrow(ConfigStoreError)
  })

  it("has no update and no delete", () => {
    // A published revision that can be edited is not a record of what was live,
    // and every claim built on it becomes a guess. Asserted on the interface so
    // an adapter cannot quietly add one and still satisfy the type.
    const store = new InMemoryConfigStore()
    expect((store as unknown as Record<string, unknown>).update).toBeUndefined()
    expect((store as unknown as Record<string, unknown>).delete).toBeUndefined()
  })

  it("keeps history oldest first and does not hand out its own array", async () => {
    const store = new InMemoryConfigStore()
    await commitOnce(store, [layer("acme", { "platform.localization.currency": "GBP" })])
    await commitOnce(store, [layer("acme", { "platform.localization.currency": "EUR" }, { version: 2 })])

    const history = await store.history("acme")
    expect(history.map((r) => r.revision)).toEqual([1, 2])
    // Mutating what a caller was given must not change the store.
    ;(history as unknown as unknown[]).push({} as never)
    expect((await store.history("acme")).length).toBe(2)
  })
})

describe("rollback", () => {
  it("names the revision to return to", async () => {
    const store = new InMemoryConfigStore()
    await commitOnce(store, [layer("acme", { "platform.localization.currency": "GBP" })])
    await commitOnce(store, [layer("acme", { "platform.localization.currency": "EUR" }, { version: 2 })])

    const target = await rollbackTarget(store, "acme")
    expect(target.to?.revision).toBe(1)
    expect(target.from?.revision).toBe(2)
  })

  it("explains why there is nothing to roll back to, rather than returning null alone", async () => {
    const store = new InMemoryConfigStore()
    await commitOnce(store, [layer("acme", { "platform.localization.currency": "GBP" })])
    const target = await rollbackTarget(store, "acme")
    expect(target.to).toBeNull()
    expect("why" in target && target.why).toMatch(/first publication/)
  })

  it("explains a tenant that has never published", async () => {
    const target = await rollbackTarget(new InMemoryConfigStore(), "nobody")
    expect(target.to).toBeNull()
    expect("why" in target && target.why).toMatch(/never published/)
  })
})
