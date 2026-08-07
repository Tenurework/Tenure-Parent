import { z } from "zod"

import { ConfigRegistry, defineConfig } from "./definition"
import {
  ENGINE_VERSION,
  compareSemver,
  immutabilityBreaches,
  incompatibleLayers,
  layerDigest,
  provenanceDigest,
} from "./integrity"
import { requiresApproval, type VersionedLayer } from "./layer-schema"
import { resolveVersionedLayers } from "./layer-bridge"

/**
 * GE-031-003 — the metadata checked against something.
 *
 * GE-031-001 required nine fields on every layer and, apart from the effective
 * interval, checked none of them against anything. These are the checks: a
 * digest that binds a version to its content, a compatibility range compared to
 * a real engine version, and immutability that detects an edit in place.
 */

const AT = new Date("2026-01-01T00:00:00Z")

function layer(
  kind: VersionedLayer["kind"],
  id: string,
  values: Record<string, unknown>,
  over: Partial<VersionedLayer["metadata"]> = {},
): VersionedLayer {
  return {
    kind,
    id,
    values,
    metadata: {
      version: 1,
      schemaVersion: "1.0.0",
      signer: "arn:aws:kms:us-east-1:000000000000:key/test",
      origin: "integrity.test.ts",
      compatibility: { minEngine: "2026.7.0", maxEngine: null },
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      effectiveUntil: null,
      changeReason: "test",
      approvedBy: requiresApproval(kind) ? "operator:test" : null,
      ...over,
    },
  }
}

describe("semantic versions compare numerically", () => {
  it("orders by component, not by string", () => {
    // "1.10.0" < "1.9.0" as strings, and the whole compatibility check is wrong
    // for every tenant the moment a minor version reaches ten.
    expect(compareSemver("1.10.0", "1.9.0")).toBe(1)
    expect(compareSemver("2.0.0", "10.0.0")).toBe(-1)
    // The scheme in use: 2026.8.0 is above 2026.7.0 and below 2027.1.0.
    expect(compareSemver("2026.8.0", "2026.7.0")).toBe(1)
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0)
  })

  it("refuses something that is not a version rather than guessing", () => {
    expect(() => compareSemver("1.2", "1.2.3")).toThrow(/Not a semantic version/)
  })
})

describe("a layer's digest identifies what it says", () => {
  it("is independent of key order", () => {
    // The same layer from DynamoDB and from YAML must digest identically, or
    // every immutability check fires on the storage format instead of on a
    // change.
    const a = layer("tenantOverlay", "acme", { "platform.terminology.seatSingular": "Seat", "platform.localization.locale": "en-GB" })
    const b = layer("tenantOverlay", "acme", { "platform.localization.locale": "en-GB", "platform.terminology.seatSingular": "Seat" })
    expect(layerDigest(a)).toBe(layerDigest(b))
  })

  it("changes when a value changes", () => {
    const a = layer("tenantOverlay", "acme", { "platform.localization.locale": "en-GB" })
    const b = layer("tenantOverlay", "acme", { "platform.localization.locale": "fr-FR" })
    expect(layerDigest(a)).not.toBe(layerDigest(b))
  })

  it("changes when the version changes, even with identical values", () => {
    // A digest over values alone would be equal for the same values published
    // under two versions — exactly the case this exists to tell apart.
    const a = layer("tenantOverlay", "acme", { x: 1 }, { version: 1 })
    const b = layer("tenantOverlay", "acme", { x: 1 }, { version: 2 })
    expect(layerDigest(a)).not.toBe(layerDigest(b))
  })

  it("does NOT change when the change reason or signer is corrected", () => {
    // Those describe the act of publishing, not the content. Correcting a typo
    // in a change reason must not make a layer look like different
    // configuration, or every audit trail becomes noise and stops being read.
    const a = layer("tenantOverlay", "acme", { x: 1 }, { changeReason: "typo", signer: "arn:one", origin: "a" })
    const b = layer("tenantOverlay", "acme", { x: 1 }, { changeReason: "fixed", signer: "arn:two", origin: "b" })
    expect(layerDigest(a)).toBe(layerDigest(b))
  })

  it("distinguishes two layers that differ only in id", () => {
    expect(layerDigest(layer("tenantOverlay", "a", { x: 1 }))).not.toBe(
      layerDigest(layer("tenantOverlay", "b", { x: 1 })),
    )
  })
})

describe("provenance identifies the stack, not just the outcome", () => {
  it("differs when the same values come from a different order", () => {
    // Precedence changes meaning, so a provenance digest that ignores order
    // would claim two different resolutions were the same one.
    const a = layer("tenantBaseline", "acme", { x: 1 })
    const b = layer("tenantOverlay", "acme", { x: 2 })
    expect(provenanceDigest([a, b])).not.toBe(provenanceDigest([b, a]))
  })

  it("is stable for the same stack", () => {
    const stack = [layer("tenantBaseline", "acme", { x: 1 }), layer("tenantOverlay", "acme", { x: 2 })]
    expect(provenanceDigest(stack)).toBe(provenanceDigest([...stack]))
  })
})

describe("compatibility is enforced, in both directions", () => {
  it("refuses a layer built for a newer engine", () => {
    // The dangerous direction. Such a layer may use a field this build cannot
    // read, and applying the parts it understands produces a configuration
    // nobody authored.
    const future = layer("tenantOverlay", "acme", { x: 1 }, { compatibility: { minEngine: "2027.1.0", maxEngine: null } })
    const problems = incompatibleLayers([future])
    expect(problems).toHaveLength(1)
    expect(problems[0].reason).toMatch(/needs engine 2027.1.0 or later/)
  })

  it("refuses a layer the publisher retired", () => {
    const retired = layer("tenantOverlay", "acme", { x: 1 }, { compatibility: { minEngine: "0.1.0", maxEngine: "2026.7.0" } })
    expect(incompatibleLayers([retired])[0].reason).toMatch(/retired at engine 2026\.7\.0/)
  })

  it("accepts the current engine at both boundaries, which are inclusive", () => {
    const atMin = layer("tenantOverlay", "a", { x: 1 }, { compatibility: { minEngine: ENGINE_VERSION, maxEngine: null } })
    const atMax = layer("tenantOverlay", "b", { x: 1 }, { compatibility: { minEngine: "0.1.0", maxEngine: ENGINE_VERSION } })
    expect(incompatibleLayers([atMin, atMax])).toEqual([])
  })

  it("treats a null maximum as a claim, not as unset", () => {
    const open = layer("tenantOverlay", "acme", { x: 1 }, { compatibility: { minEngine: "0.1.0", maxEngine: null } })
    expect(incompatibleLayers([open], "42.0.0")).toEqual([])
  })
})

describe("an incompatible layer is excluded, not partially applied", () => {
  const registry = ConfigRegistry.of([
    defineConfig({
  price: { perSeatMinor: 0, perOrgMinor: 0, currency: "USD", rounding: "half-up", includedBecause: "A test fixture, priced at nothing so the arithmetic under test is the test's own." },
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

  it("does not apply any of its values", () => {
    const result = resolveVersionedLayers(
      registry,
      [
        layer(
          "tenantOverlay",
          "acme",
          { "platform.localization.currency": "GBP" },
          { compatibility: { minEngine: "2027.1.0", maxEngine: null } },
        ),
      ],
      AT,
    )
    expect(result.config!.get<string>("platform.localization.currency")).toBe("USD")
    expect(result.incompatible).toHaveLength(1)
  })

  it("leaves it out of the provenance, because it did not contribute", () => {
    const result = resolveVersionedLayers(
      registry,
      [
        layer("tenantBaseline", "acme", { "platform.localization.currency": "EUR" }),
        layer(
          "tenantOverlay",
          "acme",
          { "platform.localization.currency": "GBP" },
          { compatibility: { minEngine: "2027.1.0", maxEngine: null } },
        ),
      ],
      AT,
    )
    expect(result.layerDigests.map((d) => d.kind)).toEqual(["tenantBaseline"])
    expect(result.config!.get<string>("platform.localization.currency")).toBe("EUR")
  })

  it("cites its inputs by digest", () => {
    const result = resolveVersionedLayers(registry, [layer("tenantBaseline", "acme", { "platform.localization.currency": "EUR" })], AT)
    expect(result.provenance).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.layerDigests[0].digest).toMatch(/^sha256:/)
  })
})

describe("a published version cannot quietly say something else", () => {
  it("detects an edit in place", () => {
    // The version is unchanged, so every cache, audit record and "we ran v4"
    // claim still says v4 — while v4 now means something else. That is how an
    // incident review reconstructs the wrong configuration.
    const published = layer("tenantOverlay", "acme", { x: 1 }, { version: 4 })
    const edited = layer("tenantOverlay", "acme", { x: 2 }, { version: 4 })

    const breaches = immutabilityBreaches(
      [edited],
      [{ kind: "tenantOverlay", id: "acme", version: 4, digest: layerDigest(published) }],
    )
    expect(breaches).toHaveLength(1)
    expect(breaches[0].actualDigest).toBe(layerDigest(edited))
  })

  it("accepts a republished version with identical content", () => {
    // Re-reading the same layer from a replica is not a breach, and treating it
    // as one would fire on every deploy.
    const l = layer("tenantOverlay", "acme", { x: 1 }, { version: 4 })
    expect(
      immutabilityBreaches([l], [{ kind: "tenantOverlay", id: "acme", version: 4, digest: layerDigest(l) }]),
    ).toEqual([])
  })

  it("accepts a new version with different content, which is the normal case", () => {
    const v4 = layer("tenantOverlay", "acme", { x: 1 }, { version: 4 })
    const v5 = layer("tenantOverlay", "acme", { x: 2 }, { version: 5 })
    expect(
      immutabilityBreaches([v5], [{ kind: "tenantOverlay", id: "acme", version: 4, digest: layerDigest(v4) }]),
    ).toEqual([])
  })

  it("detects one identity appearing twice in a single resolution", () => {
    // A merge or replication bug rather than an edit, and invisible without
    // this: the fold would silently apply whichever came last.
    const breaches = immutabilityBreaches([
      layer("tenantOverlay", "acme", { x: 1 }, { version: 4 }),
      layer("tenantOverlay", "acme", { x: 2 }, { version: 4 }),
    ])
    expect(breaches).toHaveLength(1)
  })

  it("does not confuse the same version of two different layers", () => {
    expect(
      immutabilityBreaches([
        layer("tenantOverlay", "acme", { x: 1 }, { version: 4 }),
        layer("tenantOverlay", "other", { x: 2 }, { version: 4 }),
        layer("tenantBaseline", "acme", { x: 3 }, { version: 4 }),
      ]),
    ).toEqual([])
  })
})
