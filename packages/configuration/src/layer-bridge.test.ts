import { ConfigRegistry, defineConfig } from "./definition"
import { SCOPE_FOR_KIND, resolveVersionedLayers } from "./layer-bridge"
import { LAYER_KINDS, type LayerKind, type VersionedLayer } from "./layer-schema"

import { z } from "zod"

/**
 * GE-031-001 — resolving through the versioned layer schema.
 *
 * The bridge's job is to be the only place the eleven kinds meet the eight
 * scopes. What matters is that nothing goes missing on the way across: a layer
 * outside its window, a layer whose kind has no scope, and a layer that tried to
 * overwrite an invariant must each come back named.
 */
const wordmark = defineConfig({
  key: "platform.branding.wordmark",
  owner: "platform",
  type: z.string().min(1).max(40),
  default: "Tenure",
  allowedScopes: ["platform", "blueprint", "tenant", "orgUnit"],
  mergeStrategy: "replace",
  sensitivity: "public",
  overridable: true,
  description: "The name shown in the shell.",
})

const auditImmutable = defineConfig({
  key: "platform.audit.immutable",
  owner: "platform",
  type: z.boolean(),
  default: true,
  allowedScopes: ["platform", "tenant"],
  mergeStrategy: "replace",
  sensitivity: "internal",
  overridable: true,
  description: "Whether audit records can be edited. Never, in practice.",
})

const REGISTRY = ConfigRegistry.of([wordmark, auditImmutable])

const NOW = new Date("2026-08-02T00:00:00.000Z")
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString()

const meta = (over: Partial<VersionedLayer["metadata"]> = {}): VersionedLayer["metadata"] => ({
  version: 1,
  schemaVersion: "1.0.0",
  signer: "arn:aws:kms:us-east-1:047385673922:key/abc",
  origin: "test",
  compatibility: { minEngine: "2026.7.0", maxEngine: null },
  effectiveFrom: at(-1),
  effectiveUntil: null,
  changeReason: "test fixture",
  approvedBy: "director@tenure.example",
  ...over,
})

const layer = (over: Partial<VersionedLayer>): VersionedLayer => ({
  kind: "tenantOverlay",
  id: "rochester",
  values: {},
  metadata: meta(),
  ...over,
})

describe("every kind has a decided scope, or is decided to have none", () => {
  it("covers all eleven", () => {
    // Recorded as null rather than omitted, so adding a twelfth kind without
    // deciding its scope is a type error rather than a silent drop.
    for (const kind of LAYER_KINDS) {
      expect(Object.prototype.hasOwnProperty.call(SCOPE_FOR_KIND, kind)).toBe(true)
    }
    expect(Object.keys(SCOPE_FOR_KIND).sort()).toEqual([...LAYER_KINDS].sort())
  })

  it("puts both tenant kinds at the tenant scope", () => {
    // Separate kinds, one scope. "What the customer agreed to" and "what they
    // have since changed" must stay distinguishable — a rollback with one
    // merged scope has nothing to roll back to.
    expect(SCOPE_FOR_KIND.tenantBaseline).toBe("tenant")
    expect(SCOPE_FOR_KIND.tenantOverlay).toBe("tenant")
  })

  it("gives experiment and emergency deny no scope, deliberately", () => {
    // GE-022-005 models both as configuration KEYS with restrict-only merge
    // strategies. A scope for the kill switch would sit above `user` and could
    // therefore grant, which is exactly the law that forbids it.
    expect(SCOPE_FOR_KIND.experiment).toBeNull()
    expect(SCOPE_FOR_KIND.emergencyDeny).toBeNull()
  })
})

describe("resolution folds the layers in order", () => {
  it("lets a tenant overlay beat its own baseline", () => {
    const { config } = resolveVersionedLayers(
      REGISTRY,
      [
        layer({ kind: "tenantOverlay", values: { "platform.branding.wordmark": "Simon" } }),
        layer({ kind: "tenantBaseline", values: { "platform.branding.wordmark": "Rochester" } }),
      ],
      NOW,
      { collectProblems: true },
    )
    expect(config!.get("platform.branding.wordmark")).toBe("Simon")
  })

  it("resolves at an instant, not at 'now'", () => {
    // "What was this tenant's configuration on the 3rd" is a question that gets
    // asked, and a resolver that can only answer for the present cannot answer
    // it.
    const scheduled = layer({
      values: { "platform.branding.wordmark": "Renamed" },
      metadata: meta({ effectiveFrom: at(5) }),
    })
    expect(
      resolveVersionedLayers(REGISTRY, [scheduled], NOW, { collectProblems: true }).config!.get(
        "platform.branding.wordmark",
      ),
    ).toBe("Tenure")
    expect(
      resolveVersionedLayers(REGISTRY, [scheduled], new Date(at(6)), {
        collectProblems: true,
      }).config!.get("platform.branding.wordmark"),
    ).toBe("Renamed")
  })
})

describe("nothing goes missing on the way across", () => {
  it("names a layer skipped for being outside its window", () => {
    const expired = layer({
      id: "old",
      values: { "platform.branding.wordmark": "Former" },
      metadata: meta({ effectiveFrom: at(-9), effectiveUntil: at(-2) }),
    })
    const result = resolveVersionedLayers(REGISTRY, [expired], NOW, { collectProblems: true })
    expect(result.skipped.map((s) => [s.layer.id, s.reason])).toEqual([["old", "expired"]])
    expect(result.config!.get("platform.branding.wordmark")).toBe("Tenure")
  })

  it("names a layer whose kind has no scope, rather than dropping it", () => {
    // A layer that contributes nothing and says nothing is indistinguishable
    // from one that was applied and had no effect, and only one of those is a
    // bug.
    const deny = layer({ kind: "emergencyDeny", id: "incident-4471", values: {} })
    const result = resolveVersionedLayers(REGISTRY, [deny], NOW, { collectProblems: true })
    expect(result.unmapped).toEqual([{ kind: "emergencyDeny", id: "incident-4471" }])
  })

  it("names a refused invariant AND does not apply the value", () => {
    // The refusal has to be true rather than advisory: reporting it and then
    // letting the value through would be worse than not reporting it, because
    // the console would show a conflict that had no consequence.
    const invariant = layer({
      kind: "platformInvariant",
      id: "platform",
      values: { "platform.audit.immutable": true },
    })
    const overreach = layer({
      kind: "tenantOverlay",
      id: "rochester",
      values: { "platform.audit.immutable": false, "platform.branding.wordmark": "Simon" },
    })

    const result = resolveVersionedLayers(REGISTRY, [invariant, overreach], NOW, {
      collectProblems: true,
    })

    expect(result.refused).toEqual([
      { kind: "tenantOverlay", id: "rochester", key: "platform.audit.immutable" },
    ])
    // The invariant holds…
    expect(result.config!.get("platform.audit.immutable")).toBe(true)
    // …and the rest of that layer still applies. Refusing one key is not
    // refusing the layer; a tenant that renamed itself in the same change
    // should not lose the rename.
    expect(result.config!.get("platform.branding.wordmark")).toBe("Simon")
  })
})
