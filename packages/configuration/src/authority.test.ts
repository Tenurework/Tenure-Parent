import { z } from "zod"

import { INVARIANT_DOMAINS, authorityViolations, tenantAdminMayWrite } from "./authority"
import { ConfigRegistry, defineConfig } from "./definition"
import { requiresApproval, type VersionedLayer } from "./layer-schema"
import { planPublication } from "./publication"

/**
 * GE-032-002 — the five things a tenant administrator may never alter.
 *
 * The test that matters most is the last group: before this, a change carrying
 * a withheld key produced a plan with no blockers, published cleanly, and then
 * silently did nothing. An operator who submits a residency change and sees it
 * accepted has been told their data moved.
 */

const NOW = new Date("2026-08-02T00:00:00Z")
const LATER = new Date("2026-08-03T00:00:00Z")

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

function layer(values: Record<string, unknown>, kind: VersionedLayer["kind"] = "tenantOverlay"): VersionedLayer {
  return {
    kind,
    id: "acme",
    values,
    metadata: {
      version: 1,
      schemaVersion: "1.0.0",
      signer: "arn:aws:kms:us-east-1:000000000000:key/test",
      origin: "authority.test.ts",
      compatibility: { minEngine: "2026.7.0", maxEngine: null },
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      effectiveUntil: null,
      changeReason: "a reason long enough to be a reason",
      approvedBy: requiresApproval(kind) ? "operator:approver" : null,
    },
  }
}

const KNOWN = new Set(["platform.localization.currency"])

describe("the five invariants, each named", () => {
  it("refuses physical placement", () => {
    // The one an operator would most believe had worked. Data residency is a
    // contract term, and a change that is accepted and discarded is a change
    // somebody will cite in an audit.
    const found = authorityViolations({
      layers: [layer({ "platform.deployment.region": "eu-west-1" })],
      knownKeys: new Set([...KNOWN, "platform.deployment.region"]),
    })
    expect(found.map((v) => v.invariant)).toContain("physical-placement")
  })

  it("refuses operator access", () => {
    const found = authorityViolations({
      layers: [layer({ "platform.identity.provider": "evil-idp" })],
      knownKeys: new Set([...KNOWN, "platform.identity.provider"]),
    })
    expect(found.map((v) => v.invariant)).toContain("operator-access")
  })

  it("refuses audit integrity", () => {
    // Shortening one's own log retention is the first step of most incidents
    // that are discovered late.
    const found = authorityViolations({
      layers: [layer({ "platform.observability.logRetentionDays": 1 })],
      knownKeys: new Set([...KNOWN, "platform.observability.logRetentionDays"]),
    })
    expect(found.map((v) => v.invariant)).toContain("audit-integrity")
  })

  it("refuses core schemas — a key nothing declares", () => {
    // A tenant that can define a configuration key can define its own meaning
    // for a value the platform later reads.
    const found = authorityViolations({
      layers: [layer({ "platform.localization.inventedByMe": "x" })],
      knownKeys: KNOWN,
    })
    expect(found.map((v) => v.invariant)).toContain("core-schemas")
  })

  it("refuses unrestricted code execution", () => {
    const found = authorityViolations({
      layers: [layer({ "platform.localization.currency": "${tenant.secret}" })],
      knownKeys: KNOWN,
    })
    expect(found.map((v) => v.invariant)).toContain("unrestricted-code-execution")
  })

  it("finds an expression nested inside an object or array", () => {
    // A template one level down is the one nobody looks at.
    expect(
      authorityViolations({
        layers: [layer({ "platform.localization.currency": { a: ["${x}"] } })],
        knownKeys: KNOWN,
      }).map((v) => v.invariant),
    ).toContain("unrestricted-code-execution")
  })

  it("maps each withheld domain to the invariant it carries", () => {
    // The mapping is data so the error can say WHICH of the five was violated.
    expect(Object.values(INVARIANT_DOMAINS).sort()).toEqual([
      "audit-integrity",
      "operator-access",
      "physical-placement",
    ])
  })

  it("reports every violation, not the first", () => {
    // An operator who fixes one, resubmits and is told about the next has lost
    // a cycle to a list that was already known.
    const found = authorityViolations({
      layers: [
        layer({
          "platform.deployment.region": "eu-west-1",
          "platform.observability.logRetentionDays": 1,
        }),
      ],
      knownKeys: new Set([...KNOWN, "platform.deployment.region", "platform.observability.logRetentionDays"]),
    })
    expect(found.length).toBeGreaterThanOrEqual(2)
  })

  it("leaves a legitimate tenant change alone", () => {
    expect(
      authorityViolations({ layers: [layer({ "platform.localization.currency": "GBP" })], knownKeys: KNOWN }),
    ).toEqual([])
  })
})

describe("entitlements", () => {
  it("refuses a module the plan does not grant", () => {
    const found = authorityViolations({
      layers: [layer({ "platform.localization.currency": "GBP" })],
      knownKeys: KNOWN,
      enabledModules: ["finance"],
      entitlements: [],
      moduleEntitlements: { finance: "module.finance" },
    })
    expect(found.map((v) => v.invariant)).toContain("entitlement")
  })

  it("accepts one the plan grants", () => {
    expect(
      authorityViolations({
        layers: [layer({ "platform.localization.currency": "GBP" })],
        knownKeys: KNOWN,
        enabledModules: ["finance"],
        entitlements: ["module.finance"],
        moduleEntitlements: { finance: "module.finance" },
      }),
    ).toEqual([])
  })

  it("leaves a module needing no entitlement alone", () => {
    expect(
      authorityViolations({
        layers: [layer({ "platform.localization.currency": "GBP" })],
        knownKeys: KNOWN,
        enabledModules: ["basic"],
        moduleEntitlements: { basic: undefined },
      }),
    ).toEqual([])
  })
})

describe("the plan blocks on a violation", () => {
  // Before GE-032-002 this was the hole: the domain refusal happened at
  // resolution, the value was stripped, the plan showed no blockers, and the
  // change published cleanly and did nothing.

  const plan = (values: Record<string, unknown>) =>
    planPublication({
      registry,
      current: null,
      proposed: [layer(values)],
      publishedBy: "operator:publisher",
      activateAt: LATER,
      now: NOW,
    })

  it("blocks a withheld key rather than stripping it silently", () => {
    const result = plan({ "platform.deployment.region": "eu-west-1" })
    expect(result.blocked).toBe(true)
    expect(result.violations.map((v) => v.invariant)).toContain("physical-placement")
  })

  it("does not block a legitimate change", () => {
    const result = plan({ "platform.localization.currency": "GBP" })
    expect(result.blocked).toBe(false)
    expect(result.violations).toEqual([])
  })

  it("keeps violations separate from rejections", () => {
    // "This configuration is wrong" and "this is not yours to change" need
    // different answers, and an operator should know which they are looking at
    // before deciding whether to fix it or to ask.
    const result = plan({ "platform.deployment.region": "eu-west-1" })
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.rejections.every((r) => r.rule !== "unsafe-expression")).toBe(true)
  })
})

describe("tenantAdminMayWrite is a courtesy, not the control", () => {
  it("agrees with the domain registry", () => {
    expect(tenantAdminMayWrite("platform.localization.currency")).toBe(true)
    expect(tenantAdminMayWrite("platform.deployment.region")).toBe(false)
  })

  it("is false for a key no domain claims", () => {
    expect(tenantAdminMayWrite("platform.nothing.here")).toBe(false)
  })
})
