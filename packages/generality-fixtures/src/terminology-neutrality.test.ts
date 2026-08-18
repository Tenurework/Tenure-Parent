import { BLUEPRINTS, TENANT_BINDINGS } from "@tenure/blueprints"
import {
  MODULE_KEYS,
  ROLE_TEMPLATES,
  decide,
  lookupRoleTemplate,
  permissionKeys,
  type AuthorizationWorld,
  type Decision,
  type RoleGrant,
} from "@tenure/authorization"
import { resolveSystemConfig } from "@tenure/platform-config"

const AT = "2026-06-01T00:00:00Z"

/**
 * GE-053-005 — "Terminology changes do not change semantic permission
 * behavior."
 *
 * `permission-catalog.test.ts` already pins that the CATALOG is the same list
 * of keys under every blueprint's vocabulary. That is a claim about a constant
 * array, and it is not this requirement: a catalog can be perfectly stable
 * while `decide()` reaches a different verdict for a tenant that calls its
 * seats "posts", because the verdict is produced by role templates, grants,
 * scope inheritance and policies — none of which that test runs.
 *
 * So this one runs the DECISION. Every permission the catalog declares, decided
 * for every configured tenant, with everything held constant except the words
 * that tenant uses — and the words are put INTO the world as principal
 * attributes, where an attribute policy could read them, rather than left
 * outside it where nothing could.
 *
 * Two guards against the test being vacuous: the tenants must genuinely
 * disagree about their vocabulary, and the decision vector must contain both
 * allows and denials. A suite that compared two identical vocabularies, or one
 * that denied everything, would pass while proving nothing.
 */

/** The terminology one tenant actually resolves to, as plain words. */
function terminologyOf(slug: string): Readonly<Record<string, string>> {
  const resolved = resolveSystemConfig(slug)
  const words: Record<string, string> = {}
  for (const blueprint of BLUEPRINTS) {
    for (const key of Object.keys(blueprint.values)) {
      if (!key.startsWith("platform.terminology.")) continue
      const value = resolved.get<unknown>(key)
      if (typeof value === "string") words[key] = value
    }
  }
  return words
}

/**
 * The same world for every tenant, except the tenant id and its words.
 *
 * Every shipped template granted at tenant scope, every module enabled: the
 * point is to reach as much of `decide()` as possible, not to model a realistic
 * tenant. Anything that varied per tenant OTHER than vocabulary — the module
 * set, the entitlement, the grants — would be a legitimate reason for two
 * verdicts to differ and would make the comparison meaningless.
 */
function worldFor(slug: string): AuthorizationWorld {
  const grants: RoleGrant[] = ROLE_TEMPLATES.map((template) => ({
    principalId: "p1",
    tenantId: slug,
    roleKey: template.key,
    scope: { kind: "tenant" },
    state: "CONFIRMED",
    effectiveFrom: "2026-01-01",
  }))

  return {
    principals: [
      {
        id: "p1",
        kind: "user",
        // The words, inside the world. `decide` supports attribute policies, so
        // a policy that keyed off a tenant's vocabulary would be reachable from
        // here — which is what makes "nothing reads them" falsifiable rather
        // than structural.
        attributes: terminologyOf(slug),
      },
    ],
    memberships: [
      { principalId: "p1", tenantId: slug, state: "ACTIVE", effectiveFrom: "2026-01-01" },
    ],
    roles: ROLE_TEMPLATES,
    grants,
    enabledModules: MODULE_KEYS,
  }
}

/** (allowed, reason) for every catalog permission, in catalog order. */
function verdictVector(slug: string): string[] {
  const world = worldFor(slug)
  return permissionKeys().map((permission) => {
    const decision: Decision = decide(world, {
      principalId: "p1",
      tenantId: slug,
      permission,
      resource: { type: "Thing", id: "x1", orgUnitId: "unit-1" },
      at: AT,
    })
    return `${permission}=${decision.allowed ? "ALLOW" : `DENY:${decision.reason}`}`
  })
}

const SLUGS = TENANT_BINDINGS.map((b) => b.slug)

describe("GE-053-005 — terminology does not move a permission decision", () => {
  it("has tenants that genuinely disagree about their vocabulary", () => {
    // Without this the comparison below is between copies of one vocabulary.
    expect(SLUGS.length).toBeGreaterThanOrEqual(4)

    const officeNames = SLUGS.map(
      (slug) => terminologyOf(slug)["platform.terminology.staffOfficeName"],
    )
    expect(new Set(officeNames).size).toBeGreaterThanOrEqual(4)

    const seatWords = SLUGS.map((slug) => terminologyOf(slug)["platform.terminology.seatSingular"])
    expect(new Set(seatWords).size).toBeGreaterThan(1)
  })

  it("produces a decision vector with both allows and denials", () => {
    // A vector of all-denials would be identical across tenants for the wrong
    // reason, and would pass the next test while proving nothing.
    const vector = verdictVector(SLUGS[0])
    expect(vector.length).toBeGreaterThanOrEqual(40)
    expect(vector.filter((v) => v.endsWith("=ALLOW")).length).toBeGreaterThan(20)
    expect(vector.filter((v) => v.includes("=DENY:")).length).toBeGreaterThan(0)
  })

  it("decides every permission identically for every tenant", () => {
    const baseline = verdictVector(SLUGS[0])
    for (const slug of SLUGS.slice(1)) {
      expect({ slug, vector: verdictVector(slug) }).toEqual({ slug, vector: baseline })
    }
  })

  it("confers the same permissions from a role template under every vocabulary", () => {
    // A template is what a decision is assembled from. Renaming a role in a
    // tenant's vocabulary must rename the display and nothing else.
    const before = ROLE_TEMPLATES.map((t) => `${t.key}:${[...t.permissions].sort().join(",")}`)
    for (const slug of SLUGS) {
      // Resolving this tenant's whole vocabulary is the "terminology change".
      expect(Object.keys(terminologyOf(slug)).length).toBeGreaterThan(0)
      expect(ROLE_TEMPLATES.map((t) => `${t.key}:${[...t.permissions].sort().join(",")}`)).toEqual(
        before,
      )
    }
    expect(lookupRoleTemplate("unit.lead")!.permissions).toContain("approvals.request.decide")
  })

  it("explains a denial without naming another tenant's words", () => {
    // The same defect one layer down: a denial read out to a corporate user
    // that cites a university's office name is terminology leaking into
    // behaviour through the explanation.
    //
    // INSTANCE names only — one customer's office, never a unit-type label. An
    // earlier draft added the topology labels and immediately caught
    // "Institution", which is not a leak: `institution` is this platform's own
    // word for a tenant (`institutionSlug` is a parameter name in four
    // packages) and it happens to also be what the education blueprint calls
    // its root. A guard that cannot tell a customer's name from the platform's
    // vocabulary is a guard somebody switches off.
    const instanceWords = new Set<string>()
    for (const blueprint of BLUEPRINTS) {
      for (const [key, value] of Object.entries(blueprint.values)) {
        if (!key.startsWith("platform.terminology.")) continue
        if (typeof value !== "string" || value.length < 8) continue
        // Concept words — "seat", "post", "role" — are platform vocabulary and
        // may legitimately appear; instance names never may.
        if (/(Singular|Plural)$|leadershipBody$/.test(key)) continue
        instanceWords.add(value)
      }
    }
    expect(instanceWords.size).toBeGreaterThan(0)

    const leaks: string[] = []
    for (const slug of SLUGS) {
      const world = worldFor(slug)
      for (const permission of [...permissionKeys(), "not.a.permission"]) {
        const decision = decide(world, {
          principalId: "p1",
          tenantId: slug,
          permission,
          resource: { type: "Thing", id: "x1", orgUnitId: "unit-1" },
          at: AT,
        })
        const text = `${decision.detail ?? ""} ${decision.trace.map((s) => s.detail).join(" ")}`
        for (const word of instanceWords) {
          if (text.toLowerCase().includes(word.toLowerCase())) {
            leaks.push(`${slug} ${permission}: "${word}"`)
          }
        }
      }
    }
    expect(leaks).toEqual([])
  })
})
