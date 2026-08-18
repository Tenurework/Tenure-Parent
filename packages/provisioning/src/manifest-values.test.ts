/**
 * GE-100-002 — the six kinds, and the difference between them.
 *
 * The assertions that matter here are the ones about what is NOT the same as
 * what: a default is not a confirmation, an externally required value is not an
 * optional one, and a reserved test domain is not a placeholder. Each of those
 * pairs looked identical before this module existed.
 */
import { describe, expect, it } from "@jest/globals"

import {
  MANIFEST_FIELD_SPECS,
  PLACEHOLDER_SHAPES,
  VALUE_KINDS,
  classifyManifestValues,
  placeholderProblems,
  placeholderReason,
} from "./manifest-values"
import { MANIFEST_VERSION, planFor, validateManifest, type TenantManifest } from "./manifest"

const manifest = (over: Partial<TenantManifest> = {}): TenantManifest => ({
  manifestVersion: MANIFEST_VERSION,
  slug: "midtown-arts",
  legalName: "Midtown Arts Collective",
  displayName: "Midtown Arts",
  blueprintId: "student-organizations",
  modules: ["governance"],
  entitlements: [],
  region: "us-east-1",
  isolation: "pooled",
  coexistence: "TENURE_CLOUD_PRIMARY",
  systemOfRecord: { finance: "tenure", org: "tenure" },
  configuration: {},
  secretRefs: {},
  initialAdminEmail: "admin@midtown.example",
  ...over,
})

const context = {
  knownBlueprints: ["student-organizations"],
  knownModules: ["governance", "finance"],
  takenSlugs: [],
}

const kindOf = (m: TenantManifest, field: string) =>
  classifyManifestValues(m).values.find((v) => v.field === field)?.kind

describe("the six kinds are six different answers", () => {
  it("names exactly the six the requirement names, in its order", () => {
    expect([...VALUE_KINDS]).toEqual([
      "confirmed",
      "default",
      "optional",
      "externally-required",
      "secret-reference",
      "forbidden-placeholder",
    ])
  })

  it("calls a supplied value confirmed", () => {
    expect(kindOf(manifest(), "region")).toBe("confirmed")
    expect(kindOf(manifest(), "legalName")).toBe("confirmed")
  })

  it("calls an unsupplied value with a stand-in a default, and says what stands in", () => {
    const classified = classifyManifestValues(manifest())
    const entitlements = classified.values.find((v) => v.field === "entitlements")
    expect(entitlements?.kind).toBe("default")
    expect(entitlements?.detail).toContain("the plan's own entitlement set")
    expect(kindOf(manifest(), "configuration")).toBe("default")
  })

  it("stops calling it a default the moment somebody supplies one", () => {
    const supplied = manifest({ entitlements: ["premium-support"] })
    expect(kindOf(supplied, "entitlements")).toBe("confirmed")
  })

  it("calls an unsupplied value with no stand-in and no need for one optional", () => {
    expect(kindOf(manifest(), "notes")).toBe("optional")
    expect(kindOf(manifest(), "objectAuthority")).toBe("optional")
  })

  it("separates the reference from the value behind it", () => {
    const withSecret = manifest({ secretRefs: { erpToken: "secretsmanager:tenure/midtown/erp" } })
    const classified = classifyManifestValues(withSecret)

    // The pointer is on the manifest and is a `secret-reference`.
    const ref = classified.values.find((v) => v.field === "secretRefs.erpToken")
    expect(ref?.kind).toBe("secret-reference")
    expect(ref?.detail).toContain("secretsmanager:tenure/midtown/erp")

    // The VALUE it points at is not, and cannot be produced here. These are two
    // facts about one field and collapsing them is how a manifest reads as
    // complete while provisioning is waiting on somebody outside it.
    const value = classified.values.find((v) => v.field === "secretRefs.erpToken:value")
    expect(value?.kind).toBe("externally-required")
    expect(value?.detail).toContain("Secrets Manager")
  })

  it("reports no secrets as optional rather than as an outstanding dependency", () => {
    expect(kindOf(manifest(), "secretRefs")).toBe("optional")
    expect(classifyManifestValues(manifest()).byKind["externally-required"]).toEqual([])
  })

  it("classifies every field a manifest carries, and says so when it cannot", () => {
    const known = new Set(MANIFEST_FIELD_SPECS.map((s) => s.field))
    for (const field of Object.keys(manifest())) expect(known.has(field)).toBe(true)
    expect(classifyManifestValues(manifest()).unclassified).toEqual([])
  })

  it("reports an unspecified field rather than assuming it was decided", () => {
    const rogue = { ...manifest(), retentionYears: 7 } as unknown as TenantManifest
    const classified = classifyManifestValues(rogue)
    expect(classified.unclassified).toEqual(["retentionYears"])
    expect(classified.summary).toContain("provenance undecided rather than assumed")
    // And it is NOT quietly counted as a confirmed value.
    expect(classified.byKind.confirmed).not.toContain("retentionYears")
  })

  it("is deterministic — the same manifest classifies identically twice", () => {
    const m = manifest({ secretRefs: { a: "ssm:tenure/midtown/a" } })
    expect(JSON.stringify(classifyManifestValues(m))).toBe(JSON.stringify(classifyManifestValues(m)))
  })
})

describe("forbidden placeholders are refused, not reported", () => {
  it("refuses a template slot anywhere in the manifest", () => {
    const { valid, problems } = validateManifest(
      manifest({ displayName: "<Institution Name>" }),
      context,
    )
    expect(valid).toBe(false)
    expect(problems.map((p) => p.field)).toContain("displayName")
    expect(problems.find((p) => p.field === "displayName")?.reason).toBe("forbidden-placeholder")
  })

  it("refuses one buried inside the configuration overlay", () => {
    const { problems } = validateManifest(
      manifest({ configuration: { branding: { supportUrl: "https://{{domain}}/help" } } }),
      context,
    )
    expect(problems.map((p) => p.field)).toContain("configuration.branding.supportUrl")
  })

  it("refuses one inside a secret reference", () => {
    const { problems } = validateManifest(
      manifest({ secretRefs: { db: "secretsmanager:tenure/<slug>/db" } }),
      context,
    )
    expect(problems.filter((p) => p.field === "secretRefs.db").map((p) => p.reason)).toContain(
      "forbidden-placeholder",
    )
  })

  it("refuses the documentation domains", () => {
    const { problems } = validateManifest(
      manifest({ initialAdminEmail: "admin@example.com" }),
      context,
    )
    expect(problems.find((p) => p.field === "initialAdminEmail")?.reason).toBe(
      "forbidden-placeholder",
    )
  })

  it("does NOT refuse the reserved names this repository uses on purpose", () => {
    // `admin@simon.example` and `ose@example.invalid` are fixtures across this
    // repository, chosen because RFC 2606 guarantees they cannot resolve. A rule
    // that refused them would be refusing the convention.
    expect(placeholderReason("admin@simon.example")).toBeNull()
    expect(placeholderReason("ose@example.invalid")).toBeNull()
    expect(placeholderReason("admin@midtown.example")).toBeNull()
    expect(validateManifest(manifest(), context).valid).toBe(true)
  })

  it("does not refuse a real name that merely contains a stand-in as a substring", () => {
    // `Todos` contains `todo`; the rule is whole-token, so it does not fire.
    expect(placeholderReason("Los Todos Community College")).toBeNull()
    expect(placeholderReason("Barnard College")).toBeNull()
    expect(validateManifest(manifest({ legalName: "Los Todos Community College" }), context).valid).toBe(
      true,
    )
  })

  it("leaves prose alone — a TODO in notes is a note", () => {
    const { valid } = validateManifest(
      manifest({ notes: "TODO: ask legal about the retention clause before activating." }),
      context,
    )
    expect(valid).toBe(true)
    expect(placeholderProblems(manifest({ notes: "TODO: anything" }))).toEqual([])
  })

  it("every declared shape catches something and each is reachable", () => {
    const specimens: Readonly<Record<string, string>> = {
      "angle-template": "<your-domain>",
      "brace-template": "https://{{host}}/x",
      "shell-substitution": "$TENANT_SLUG",
      "stand-in-word": "changeme",
      "documentation-domain": "admin@example.org",
    }
    for (const shape of PLACEHOLDER_SHAPES) {
      const specimen = specimens[shape.id]
      expect(specimen).toBeDefined()
      expect(placeholderReason(specimen)).toContain(shape.id)
    }
    expect(Object.keys(specimens).sort()).toEqual(PLACEHOLDER_SHAPES.map((s) => s.id).sort())
  })

  it("marks a placeholder field as the sixth kind rather than as confirmed", () => {
    expect(kindOf(manifest({ displayName: "TBD" }), "displayName")).toBe("forbidden-placeholder")
  })
})

describe("the plan says which values were decided", () => {
  it("warns that defaults are not decisions, naming them", () => {
    const plan = planFor(manifest())
    const warning = plan.warnings.find((w) => w.includes("not a decision"))
    expect(warning).toBeDefined()
    expect(warning).toContain("entitlements")
    expect(warning).toContain("configuration")
  })

  it("warns that a secret's value has to come from outside, naming it", () => {
    const plan = planFor(manifest({ secretRefs: { erpToken: "ssm:tenure/midtown/erp" } }))
    const warning = plan.warnings.find((w) => w.includes("supplied from outside"))
    expect(warning).toBeDefined()
    expect(warning).toContain("secretRefs.erpToken:value")
  })

  it("says nothing about outside dependencies when there are none", () => {
    expect(planFor(manifest()).warnings.some((w) => w.includes("supplied from outside"))).toBe(false)
  })

  it("carries the classification itself, so a surface does not re-derive it", () => {
    const plan = planFor(manifest())
    expect(plan.values.byKind.confirmed).toContain("region")
    expect(plan.values.summary).toContain("confirmed value")
  })
})
