import {
  LAYER_KINDS,
  RESTRICT_ONLY_KINDS,
  invariantKeys,
  isEffectiveAt,
  isLayerKind,
  layerRank,
  orderLayers,
  requiresApproval,
  validateLayer,
  type LayerKind,
  type VersionedLayer,
} from "./layer-schema"

/**
 * GE-031-001 — versioned layer schemas.
 *
 * The precedence order is data and is easy to get right. What is worth testing
 * is the two layers that do not behave like layers: a platform invariant that
 * sits at the BOTTOM of the order and must nonetheless win, and an emergency
 * deny that sits at the top and must nonetheless not grant.
 */
const NOW = new Date("2026-08-02T00:00:00.000Z")
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString()

const layer = (over: Partial<VersionedLayer> = {}): VersionedLayer => ({
  kind: "tenantOverlay",
  id: "rochester",
  values: { "platform.branding.wordmark": "Simon" },
  metadata: {
    version: 3,
    schemaVersion: "1.0.0",
    signer: "arn:aws:kms:us-east-1:047385673922:key/abc",
    origin: "console session 2026-08-02",
    compatibility: { minEngine: "2026.7.0", maxEngine: null },
    effectiveFrom: at(-1),
    effectiveUntil: null,
    changeReason: "Renamed at the customer's request",
    approvedBy: "director@tenure.example",
  },
  ...over,
})

describe("the eleven layers of §7.1", () => {
  it("names all eleven, in the bible's order", () => {
    expect([...LAYER_KINDS]).toEqual([
      "platformInvariant",
      "partitionRegion",
      "environment",
      "plan",
      "industryPack",
      "orgTemplate",
      "tenantBaseline",
      "tenantOverlay",
      "orgUnitOverlay",
      "experiment",
      "emergencyDeny",
    ])
  })

  it("ranks by that order, and nothing else", () => {
    // Rank is derived from the list, so a reordering cannot leave the two
    // disagreeing.
    for (let i = 1; i < LAYER_KINDS.length; i++) {
      expect(layerRank(LAYER_KINDS[i])).toBeGreaterThan(layerRank(LAYER_KINDS[i - 1]))
    }
  })

  it("refuses a kind that is not one, rather than ranking it zero", () => {
    // A kind read off a database row is a string until something checks it, and
    // ranking an unknown one as 0 would silently give it the lowest precedence.
    expect(() => layerRank("tenant" as LayerKind)).toThrow(RangeError)
    expect(isLayerKind("tenantOverlay")).toBe(true)
    expect(isLayerKind("tenant")).toBe(false)
  })

  it("keeps a separate baseline and overlay for a tenant", () => {
    // §7.1 lists both. Collapsing them means "what the customer agreed to" and
    // "what they have since changed" cannot be told apart, and a rollback has
    // nothing to roll back to.
    expect(layerRank("tenantOverlay")).toBeGreaterThan(layerRank("tenantBaseline"))
  })
})

describe("a platform invariant is a constraint, not a competitor", () => {
  const invariant = layer({
    kind: "platformInvariant",
    id: "platform",
    values: { "platform.audit.immutable": true },
    metadata: { ...layer().metadata, approvedBy: "security@tenure.example" },
  })

  it("sits lowest in the declared order", () => {
    // Which is what §7.1 says, and taken alone would mean everything overrides
    // it — the opposite of "tenants cannot override".
    expect(layerRank("platformInvariant")).toBe(0)
  })

  it("refuses a later layer that sets one of its keys", () => {
    // The resolution of that contradiction. Refusing is visible; silently
    // discarding is not, and a tenant whose setting quietly does nothing files
    // a bug about the wrong thing.
    const overreach = layer({
      kind: "tenantOverlay",
      values: { "platform.audit.immutable": false },
    })
    const { refused } = orderLayers([invariant, overreach], NOW)
    expect(refused).toEqual([
      { kind: "tenantOverlay", id: "rochester", key: "platform.audit.immutable" },
    ])
  })

  it("refuses an emergency deny that sets one too", () => {
    // Highest precedence is not exemption. An emergency that could rewrite an
    // invariant is an invariant that holds until someone declares an emergency.
    const deny = layer({
      kind: "emergencyDeny",
      id: "incident-4471",
      values: { "platform.audit.immutable": false },
    })
    expect(orderLayers([invariant, deny], NOW).refused).toHaveLength(1)
  })

  it("does not refuse a key it does not pin", () => {
    const unrelated = layer({ values: { "platform.branding.wordmark": "Simon" } })
    expect(orderLayers([invariant, unrelated], NOW).refused).toEqual([])
  })

  it("collects pinned keys across several invariant layers", () => {
    // There is no reason a platform would express every invariant in one record
    // and every reason it would not.
    const second = layer({
      kind: "platformInvariant",
      id: "platform-tenancy",
      values: { "platform.tenancy.isolation": "enforced" },
      metadata: { ...layer().metadata, approvedBy: "security@tenure.example" },
    })
    expect([...invariantKeys([invariant, second], NOW)].sort()).toEqual([
      "platform.audit.immutable",
      "platform.tenancy.isolation",
    ])
  })

  it("stops pinning once the invariant layer expires", () => {
    const expired = {
      ...invariant,
      metadata: { ...invariant.metadata, effectiveFrom: at(-10), effectiveUntil: at(-5) },
    }
    expect(invariantKeys([expired], NOW).size).toBe(0)
  })
})

describe("emergency deny is highest, and may only restrict", () => {
  it("outranks everything", () => {
    for (const kind of LAYER_KINDS) {
      if (kind === "emergencyDeny") continue
      expect(layerRank("emergencyDeny")).toBeGreaterThan(layerRank(kind))
    }
  })

  it("is the restrict-only set, named rather than compared to a literal", () => {
    // So the next restrict-only layer does not require finding every
    // `=== "emergencyDeny"` in the codebase.
    expect([...RESTRICT_ONLY_KINDS]).toEqual(["emergencyDeny"])
  })
})

describe("the effective interval decides whether a layer applies at all", () => {
  it("applies inside the window", () => {
    expect(isEffectiveAt(layer(), NOW)).toBe(true)
  })

  it("does not apply before it starts", () => {
    expect(isEffectiveAt(layer({ metadata: { ...layer().metadata, effectiveFrom: at(1) } }), NOW))
      .toBe(false)
  })

  it("does not apply after it ends", () => {
    expect(
      isEffectiveAt(
        layer({ metadata: { ...layer().metadata, effectiveFrom: at(-5), effectiveUntil: at(-1) } }),
        NOW,
      ),
    ).toBe(false)
  })

  it("fails closed on an interval nobody can read", () => {
    // A layer whose window cannot be parsed is one nobody can promise is live,
    // and applying it anyway means a value takes effect outside the period
    // somebody agreed to.
    expect(isEffectiveAt(layer({ metadata: { ...layer().metadata, effectiveFrom: "soon" } }), NOW))
      .toBe(false)
    expect(
      isEffectiveAt(layer({ metadata: { ...layer().metadata, effectiveUntil: "later" } }), NOW),
    ).toBe(false)
  })

  it("says WHY a layer was skipped", () => {
    // "Not yet" and "no longer" need different operator responses, and a single
    // "skipped" makes an experiment that has not started look like one that has
    // finished.
    const future = layer({ id: "future", metadata: { ...layer().metadata, effectiveFrom: at(5) } })
    const past = layer({
      id: "past",
      metadata: { ...layer().metadata, effectiveFrom: at(-9), effectiveUntil: at(-2) },
    })
    const { ordered, skipped } = orderLayers([future, past, layer()], NOW)
    expect(ordered).toHaveLength(1)
    expect(skipped.map((s) => [s.layer.id, s.reason]).sort()).toEqual([
      ["future", "not-yet-effective"],
      ["past", "expired"],
    ])
  })
})

describe("ordering is deterministic", () => {
  it("folds lowest precedence first", () => {
    const layers = [
      layer({ kind: "emergencyDeny", id: "incident", values: {} }),
      layer({ kind: "environment", id: "production", values: {} }),
      layer({ kind: "tenantBaseline", id: "rochester", values: {} }),
    ]
    expect(orderLayers(layers, NOW).ordered.map((l) => l.kind)).toEqual([
      "environment",
      "tenantBaseline",
      "emergencyDeny",
    ])
  })

  it("gives the same answer whatever order it is handed", () => {
    // A precedence that depends on array order cannot be reproduced when
    // somebody asks why a value is what it is.
    const layers = [
      layer({ kind: "orgUnitOverlay", id: "unit-c", values: {} }),
      layer({ kind: "orgUnitOverlay", id: "unit-a", values: {} }),
      layer({ kind: "orgUnitOverlay", id: "unit-b", values: {} }),
    ]
    const forwards = orderLayers(layers, NOW).ordered.map((l) => l.id)
    const backwards = orderLayers([...layers].reverse(), NOW).ordered.map((l) => l.id)
    expect(forwards).toEqual(["unit-a", "unit-b", "unit-c"])
    expect(backwards).toEqual(forwards)
  })

  it("puts the newest version of one id last", () => {
    const v1 = layer({ id: "rochester", metadata: { ...layer().metadata, version: 1 } })
    const v9 = layer({ id: "rochester", metadata: { ...layer().metadata, version: 9 } })
    expect(orderLayers([v1, v9], NOW).ordered.map((l) => l.metadata.version)).toEqual([9, 1])
  })
})

describe("every layer carries its provenance, and it is checked", () => {
  it("accepts a complete layer", () => {
    expect(validateLayer(layer())).toEqual([])
  })

  it("requires a signer, an origin and a reason", () => {
    // Asked for precisely when nobody remembers.
    for (const field of ["signer", "origin", "changeReason"] as const) {
      const broken = layer({ metadata: { ...layer().metadata, [field]: "  " } })
      expect(validateLayer(broken).map((p) => p.field)).toContain(`metadata.${field}`)
    }
  })

  it("requires an approver on anything that reaches a customer's system", () => {
    // A layer that lands on one person's say-so is one person away from any
    // change at all.
    for (const kind of [
      "platformInvariant",
      "tenantBaseline",
      "tenantOverlay",
      "orgUnitOverlay",
      "experiment",
      "emergencyDeny",
      "plan",
    ] as LayerKind[]) {
      expect(requiresApproval(kind)).toBe(true)
      const unapproved = layer({ kind, metadata: { ...layer().metadata, approvedBy: null } })
      expect(validateLayer(unapproved).map((p) => p.field)).toContain("metadata.approvedBy")
    }
  })

  it("does not require one for layers that describe the estate", () => {
    // Changed by the same people who would approve them; a second signature
    // there is a rule that gets worked around rather than followed.
    for (const kind of ["partitionRegion", "environment"] as LayerKind[]) {
      expect(requiresApproval(kind)).toBe(false)
      const layerNoApproval = layer({ kind, metadata: { ...layer().metadata, approvedBy: null } })
      expect(validateLayer(layerNoApproval)).toEqual([])
    }
  })

  it("distinguishes 'nobody approved' from 'approval does not apply'", () => {
    // Empty string for both would make them the same field value.
    const empty = layer({
      kind: "environment",
      metadata: { ...layer().metadata, approvedBy: "" },
    })
    expect(validateLayer(empty).map((p) => p.detail).join(" ")).toMatch(/use null/)
  })

  it("requires an immutable, positive version", () => {
    for (const version of [0, -1, 1.5]) {
      expect(
        validateLayer(layer({ metadata: { ...layer().metadata, version } })).map((p) => p.field),
      ).toContain("metadata.version")
    }
  })

  it("requires a semantic schema version and a compatibility range", () => {
    expect(
      validateLayer(layer({ metadata: { ...layer().metadata, schemaVersion: "1.0" } })).map(
        (p) => p.field,
      ),
    ).toContain("metadata.schemaVersion")
    expect(
      validateLayer(
        layer({
          metadata: {
            ...layer().metadata,
            compatibility: { minEngine: "latest", maxEngine: null },
          },
        }),
      ).map((p) => p.field),
    ).toContain("metadata.compatibility.minEngine")
  })

  it("refuses an interval that ends before it begins", () => {
    // Never applies, and presents as "the setting did nothing" with no obvious
    // cause.
    const backwards = layer({
      metadata: { ...layer().metadata, effectiveFrom: at(5), effectiveUntil: at(1) },
    })
    expect(validateLayer(backwards).map((p) => p.field)).toContain("metadata.effectiveUntil")
  })

  it("refuses a layer that names no entity", () => {
    expect(validateLayer(layer({ id: "  " })).map((p) => p.field)).toContain("id")
  })

  it("reports every problem, not the first", () => {
    const broken = layer({
      id: "",
      metadata: {
        ...layer().metadata,
        version: 0,
        signer: "",
        changeReason: "",
        schemaVersion: "x",
      },
    })
    expect(validateLayer(broken).length).toBeGreaterThanOrEqual(5)
  })
})
