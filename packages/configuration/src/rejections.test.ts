import { MODULES } from "@tenure/modules"

import {
  UNIMPLEMENTED_REJECTIONS,
  allRejections,
  ambiguousPrecedence,
  moduleGraphRejections,
  unentitledFeatures,
  unsafeExpressions,
  type ModuleLike,
} from "./rejections"
import { requiresApproval, type VersionedLayer } from "./layer-schema"

/**
 * GE-031-004 — the eight rejections Bible §7.1 requires.
 *
 * Six are checked here. The module-graph cases run against the REAL catalogue
 * as well as fixtures, because a cycle detector that only ever sees a
 * hand-built graph has never met the data it exists to protect.
 */

function layer(
  kind: VersionedLayer["kind"],
  id: string,
  values: Record<string, unknown>,
): VersionedLayer {
  return {
    kind,
    id,
    values,
    metadata: {
      version: 1,
      schemaVersion: "1.0.0",
      signer: "arn:aws:kms:us-east-1:000000000000:key/test",
      origin: "rejections.test.ts",
      compatibility: { minEngine: "2026.7.0", maxEngine: null },
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      effectiveUntil: null,
      changeReason: "test",
      approvedBy: requiresApproval(kind) ? "operator:test" : null,
    },
  }
}

describe("ambiguous precedence", () => {
  it("names two same-rank layers contesting one key", () => {
    // Not a crash: `orderLayers` breaks the tie on id, so the outcome is
    // defined. That is exactly why it needs reporting — the author of the
    // losing layer gets no error and a value they did not choose.
    const found = ambiguousPrecedence([
      layer("orgUnitOverlay", "west", { "platform.organization.seatLimit": 10 }),
      layer("orgUnitOverlay", "east", { "platform.organization.seatLimit": 20 }),
    ])
    expect(found).toHaveLength(1)
    expect(found[0].rule).toBe("ambiguous-precedence")
    expect(found[0].detail).toContain("east, west")
  })

  it("says nothing when the ranks differ, because precedence decided it", () => {
    // A blueprint layer beaten by a tenant overlay is the design, not a
    // conflict.
    //
    // The ids must DIFFER for this test to mean anything. The first version
    // used "acme" for both, so the "same id twice" guard skipped the pair
    // before rank was ever consulted — and a mutation collapsing every rank to
    // a constant passed. The test named rank and did not exercise it.
    expect(
      ambiguousPrecedence([
        layer("industryPack", "higher-education", { k: 1 }),
        layer("tenantOverlay", "acme", { k: 2 }),
      ]),
    ).toEqual([])
  })

  it("says nothing when same-rank layers set different keys", () => {
    expect(
      ambiguousPrecedence([
        layer("orgUnitOverlay", "west", { a: 1 }),
        layer("orgUnitOverlay", "east", { b: 2 }),
      ]),
    ).toEqual([])
  })

  it("ignores one layer id appearing twice, which is a different problem", () => {
    // `immutabilityBreaches` owns that. Reporting it here too would send the
    // reader to reconcile a precedence conflict that does not exist.
    expect(
      ambiguousPrecedence([
        layer("orgUnitOverlay", "west", { k: 1 }),
        layer("orgUnitOverlay", "west", { k: 2 }),
      ]),
    ).toEqual([])
  })
})

describe("unsafe expressions", () => {
  it("refuses a template, because there is no engine to evaluate it", () => {
    // Storing it makes the string a literal today and an evaluated expression
    // the day GE-031-005 lands: live configuration changing meaning with no
    // diff and no deploy.
    const found = unsafeExpressions([layer("tenantOverlay", "acme", { greeting: "Hello ${user.name}" })])
    expect(found).toHaveLength(1)
    expect(found[0].rule).toBe("unsafe-expression")
  })

  it("finds one nested in an array or an object", () => {
    // A template one level down is the one nobody looks at.
    expect(unsafeExpressions([layer("tenantOverlay", "a", { list: ["fine", "${bad}"] })])).toHaveLength(1)
    expect(unsafeExpressions([layer("tenantOverlay", "a", { o: { deep: { x: "${bad}" } } })])).toHaveLength(1)
  })

  it("accepts a well-formed expression once an environment is declared", () => {
    // The engine (GE-031-005) decides, not a regex. Refusing this would mean
    // the language exists and cannot be used.
    expect(
      unsafeExpressions([layer("tenantOverlay", "a", { greeting: "Seats: ${tenant.seats}" })], {
        "tenant.seats": "number",
      }),
    ).toEqual([])
  })

  it("refuses reflection with the parser's reason, not an opaque 'unsafe'", () => {
    const found = unsafeExpressions([layer("tenantOverlay", "a", { x: "${tenant.constructor}" })], {
      "tenant.seats": "number",
    })
    expect(found).toHaveLength(1)
    expect(found[0].detail).toMatch(/parse: .*Reflection is not part of this language/)
  })

  it("refuses an expression reading a name nobody declared", () => {
    const found = unsafeExpressions([layer("tenantOverlay", "a", { x: "${secret}" })], {
      "tenant.seats": "number",
    })
    expect(found[0].detail).toMatch(/type: .*is not declared/)
  })

  it("still refuses everything when no environment is declared", () => {
    // An expression that cannot be checked against anything is one nobody can
    // say anything about.
    expect(unsafeExpressions([layer("tenantOverlay", "a", { x: "${tenant.seats}" })])).toHaveLength(1)
  })

  it("finds every expression in one string, not just the first", () => {
    const found = unsafeExpressions([layer("tenantOverlay", "a", { x: "${bad1} and ${bad2}" })], {})
    expect(found).toHaveLength(2)
  })

  it("leaves an ordinary string alone, including a lone dollar or brace", () => {
    expect(
      unsafeExpressions([
        layer("tenantOverlay", "a", { price: "$100", json: "{ not a template }", css: "var(--x)" }),
      ]),
    ).toEqual([])
  })
})

describe("the module graph, against the real catalogue", () => {
  it("has no cycles today", () => {
    // The check that matters: a detector that only sees fixtures has never met
    // the data it protects.
    expect(moduleGraphRejections(MODULES, []).filter((r) => r.rule === "dependency-cycle")).toEqual([])
  })

  it("has no dependency naming a module that does not exist", () => {
    expect(moduleGraphRejections(MODULES, []).filter((r) => r.rule === "invalid-reference")).toEqual([])
  })

  it("accepts a real module enabled with its real dependencies", () => {
    expect(moduleGraphRejections(MODULES, ["organizations", "feed"])).toEqual([])
  })

  it("catches a real module enabled without its dependency", () => {
    // `feed` depends on `organizations`. Enabling it alone is a configuration
    // that renders navigation for a module whose data layer is switched off.
    const found = moduleGraphRejections(MODULES, ["feed"])
    expect(found).toHaveLength(1)
    expect(found[0].rule).toBe("missing-dependency")
    expect(found[0].detail).toContain("organizations")
  })
})

describe("the module graph, on shapes the catalogue does not have yet", () => {
  const cyclic: ModuleLike[] = [
    { key: "a", dependsOn: ["b"] },
    { key: "b", dependsOn: ["c"] },
    { key: "c", dependsOn: ["a"] },
  ]

  it("reports a cycle as the path that forms it", () => {
    const found = moduleGraphRejections(cyclic, [])
    expect(found).toHaveLength(1)
    expect(found[0].rule).toBe("dependency-cycle")
    expect(found[0].detail).toMatch(/a → b → c → a/)
  })

  it("reports one cycle once, not once per participant", () => {
    // Three modules in one cycle is one problem with one fix.
    expect(moduleGraphRejections(cyclic, []).filter((r) => r.rule === "dependency-cycle")).toHaveLength(1)
  })

  it("reports a self-dependency", () => {
    expect(
      moduleGraphRejections([{ key: "a", dependsOn: ["a"] }], []).filter((r) => r.rule === "dependency-cycle"),
    ).toHaveLength(1)
  })

  it("does not mistake a diamond for a cycle", () => {
    // a → b, a → c, b → d, c → d. Two paths to d and no cycle; a visited-set
    // that forgot to distinguish "on the current stack" from "seen before"
    // would call this one.
    expect(
      moduleGraphRejections(
        [
          { key: "a", dependsOn: ["b", "c"] },
          { key: "b", dependsOn: ["d"] },
          { key: "c", dependsOn: ["d"] },
          { key: "d" },
        ],
        [],
      ),
    ).toEqual([])
  })

  it("names a dependency that is not in the catalogue", () => {
    const found = moduleGraphRejections([{ key: "a", dependsOn: ["ghost"] }], [])
    expect(found[0].rule).toBe("invalid-reference")
    expect(found[0].detail).toContain("ghost")
  })

  it("names an enabled module that is not a module", () => {
    const found = moduleGraphRejections([{ key: "a" }], ["nonesuch"])
    expect(found[0].rule).toBe("invalid-reference")
    expect(found[0].detail).toContain("nonesuch")
  })
})

describe("entitlements", () => {
  const catalogue: ModuleLike[] = [
    { key: "basic" },
    { key: "finance", entitlement: "module.finance" },
    { key: "relay", entitlement: "module.relay" },
  ]

  it("refuses a module the plan does not grant", () => {
    const found = unentitledFeatures(catalogue, ["finance"], ["module.relay"])
    expect(found).toHaveLength(1)
    expect(found[0].detail).toContain("module.finance")
  })

  it("accepts one the plan grants", () => {
    expect(unentitledFeatures(catalogue, ["finance"], ["module.finance"])).toEqual([])
  })

  it("leaves a module needing no entitlement alone", () => {
    expect(unentitledFeatures(catalogue, ["basic"], [])).toEqual([])
  })

  it("checks every enabled module, not the first", () => {
    expect(unentitledFeatures(catalogue, ["finance", "relay"], [])).toHaveLength(2)
  })
})

describe("what is not implemented is declared, not implied", () => {
  it("names the two rejections that have no data to check", () => {
    // A validator over an empty namespace passes on every input — green, and
    // proving nothing. Naming them keeps the gap visible instead of letting an
    // absent check look like a passing one.
    expect(Object.keys(UNIMPLEMENTED_REJECTIONS).sort()).toEqual([
      "missing required translations",
      "unreachable workflows",
    ])
  })

  it("says which item brings the data for each", () => {
    for (const reason of Object.values(UNIMPLEMENTED_REJECTIONS)) {
      expect(reason).toMatch(/GE-\d{3}/)
    }
  })
})

describe("allRejections runs every implemented rule", () => {
  it("collects across categories in one pass", () => {
    const found = allRejections({
      layers: [
        layer("orgUnitOverlay", "west", { k: 1 }),
        layer("orgUnitOverlay", "east", { k: 2, t: "${bad}" }),
      ],
      modules: [{ key: "a", entitlement: "module.a" }],
      enabledModules: ["a"],
      entitlements: [],
    })
    expect(found.map((r) => r.rule).sort()).toEqual([
      "ambiguous-precedence",
      "unentitled-feature",
      "unsafe-expression",
    ])
  })

  it("is empty for a clean configuration", () => {
    expect(
      allRejections({
        layers: [layer("tenantOverlay", "acme", { k: 1 })],
        modules: MODULES,
        enabledModules: ["organizations"],
        entitlements: [],
      }),
    ).toEqual([])
  })
})
