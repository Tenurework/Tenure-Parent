import { z } from "zod"

import { defineConfig } from "./definition"
import {
  CONFIG_DOMAINS,
  domainOf,
  getDomain,
  refusedByDomain,
  validateDomains,
} from "./domains"
import { SCOPE_FOR_KIND, resolveVersionedLayers } from "./layer-bridge"
import { LAYER_KINDS, requiresApproval, type VersionedLayer } from "./layer-schema"
import { ConfigRegistry } from "./definition"

/**
 * GE-031-002 — the domains, and the authority they actually carry.
 *
 * The tests worth writing here are not "there are fifteen entries". They are
 * the ones that fail when a domain stops being enforced: a tenant layer
 * relocating its own data, a key nobody governs, a refusal that reports and
 * lets the value through anyway.
 */

const metadata = (kind: VersionedLayer["kind"]): VersionedLayer["metadata"] => ({
  version: 1,
  schemaVersion: "1.0.0",
  signer: "arn:aws:kms:us-east-1:000000000000:key/test",
  origin: "domains.test.ts",
  compatibility: { minEngine: "2026.7.0", maxEngine: null },
  effectiveFrom: "2020-01-01T00:00:00.000Z",
  effectiveUntil: null,
  changeReason: "exercising domain authority",
  // "unapproved" and "approval not needed" are different states, so this
  // follows the kind rather than always being a string.
  approvedBy: requiresApproval(kind) ? "operator:test" : null,
})

const layer = (kind: VersionedLayer["kind"], id: string, values: Record<string, unknown>): VersionedLayer => ({
  kind,
  id,
  label: id,
  values,
  metadata: metadata(kind),
})

describe("the fourteen domains the item names are all declared", () => {
  it("covers every one", () => {
    const required = [
      "identity",
      "organization",
      "permissions",
      "modules",
      "entities",
      "workflows",
      "reports",
      "connectors",
      "relay",
      "localization",
      "deployment",
      "recovery",
      "observability",
      "cost",
    ]
    // As a set difference, so a failure names which domain is missing rather
    // than stopping at the first.
    const declared = CONFIG_DOMAINS.map((d) => d.id)
    expect(required.filter((id) => !declared.includes(id))).toEqual([])
    expect(getDomain("deployment")).toBeDefined()
  })

  it("declares a reserved domain WITH the item that will fill it", () => {
    // A reservation with no owner is an empty namespace with a comment. The
    // point of reserving is that governance arrives before the first key does,
    // and that only holds if someone is going to arrive with it.
    for (const domain of CONFIG_DOMAINS) {
      if (domain.status !== "reserved") continue
      // Paired with the id so the assertion message names the domain.
      expect([domain.id, Boolean(domain.reservedFor)]).toEqual([domain.id, true])
    }
  })

  it("has no domain with an empty writableBy, which would be unsettable by anything", () => {
    for (const domain of CONFIG_DOMAINS) {
      expect([domain.id, domain.writableBy.length > 0]).toEqual([domain.id, true])
    }
  })

  it("names only real layer kinds", () => {
    // A typo'd kind silently narrows authority: the domain would refuse a layer
    // it meant to accept, and the failure would look like a permissions bug.
    for (const domain of CONFIG_DOMAINS) {
      const unknown = domain.writableBy.filter((k) => !LAYER_KINDS.includes(k))
      expect([domain.id, unknown]).toEqual([domain.id, []])
    }
  })

  it("keeps its private kind-to-scope map in step with the bridge's", () => {
    // domains.ts holds a local copy to avoid an import cycle. Two copies of a
    // mapping is exactly the thing GE-020-005 is about, so the divergence is a
    // test failure rather than a comment asking people to remember.
    for (const kind of LAYER_KINDS) {
      const viaDomains = validateDomains([
        defineConfig({
  price: { perSeatMinor: 0, perOrgMinor: 0, currency: "USD", rounding: "half-up", includedBecause: "A test fixture, priced at nothing so the arithmetic under test is the test's own." },
          key: "platform.organization.probe",
          owner: "platform",
          type: z.string(),
          default: "x",
          allowedScopes: SCOPE_FOR_KIND[kind] ? [SCOPE_FOR_KIND[kind]!] : [],
          mergeStrategy: "replace",
          sensitivity: "public",
          overridable: SCOPE_FOR_KIND[kind] !== null,
          description: "probe",
        }),
      ])
      // `organization` accepts every kind, so every mapped scope must validate.
      if (SCOPE_FOR_KIND[kind] !== null) {
        expect([kind, viaDomains]).toEqual([kind, []])
      }
    }
  })
})

describe("a key belongs to exactly one domain", () => {
  it("resolves a real platform key", () => {
    expect(domainOf("platform.localization.locale")?.id).toBe("localization")
    expect(domainOf("platform.terminology.seatSingular")?.id).toBe("organization")
    expect(domainOf("platform.flags.aiAssistant.enabled")?.id).toBe("modules")
    expect(domainOf("platform.branding.wordmark")?.id).toBe("branding")
  })

  it("returns null for a key no domain claims", () => {
    expect(domainOf("platform.somethingNobodyDeclared.x")).toBeNull()
    // A module's own namespace is NOT a platform domain, and must not be
    // captured by one — modules are governed by their entitlement.
    expect(domainOf("finance.budget.approvalThreshold")).toBeNull()
  })

  it("gives the longest matching prefix, so a domain can be split later", () => {
    // `platform.organization.` owns this today. If a future `platform.organization.seats.`
    // domain is carved out, this must follow it rather than staying behind.
    expect(domainOf("platform.organization.seats.maxPerUnit")?.id).toBe("organization")
  })

  it("does not match a prefix that merely starts the same", () => {
    // "platform.relay." must not claim "platform.relayed...". The trailing dot
    // in every prefix is what prevents it, and this is the test that keeps it there.
    expect(domainOf("platform.relayedThing.x")).toBeNull()
  })
})

describe("a definition may not grant itself authority its domain withholds", () => {
  const deploymentKey = (allowedScopes: readonly string[]) =>
    defineConfig({
  price: { perSeatMinor: 0, perOrgMinor: 0, currency: "USD", rounding: "half-up", includedBecause: "A test fixture, priced at nothing so the arithmetic under test is the test's own." },
      key: "platform.deployment.region",
      owner: "platform",
      type: z.string(),
      default: "us-east-1",
      allowedScopes: allowedScopes as never,
      mergeStrategy: "replace",
      sensitivity: "internal",
      overridable: true,
      description: "Where this tenant's data lives.",
    })

  it("refuses a tenant-settable key in a platform-only domain", () => {
    // The case the domain exists for. `deployment` decides where a tenant's
    // data physically is; a definition that quietly allows the `tenant` scope
    // routes around the residency constraint with one line in an unrelated file.
    const problems = validateDomains([deploymentKey(["tenant"])])
    expect(problems).toHaveLength(1)
    expect(problems[0].problem).toMatch(/domain "deployment" does not permit/)
  })

  it("accepts the same key at a scope the domain does permit", () => {
    expect(validateDomains([deploymentKey(["platform"])])).toEqual([])
  })

  it("refuses a key that belongs to no domain at all", () => {
    const orphan = defineConfig({
  price: { perSeatMinor: 0, perOrgMinor: 0, currency: "USD", rounding: "half-up", includedBecause: "A test fixture, priced at nothing so the arithmetic under test is the test's own." },
      key: "platform.ungoverned.thing",
      owner: "platform",
      type: z.string(),
      default: "x",
      allowedScopes: ["tenant"],
      mergeStrategy: "replace",
      sensitivity: "public",
      overridable: true,
      description: "Nobody's.",
    })
    const problems = validateDomains([orphan])
    expect(problems).toHaveLength(1)
    expect(problems[0].problem).toMatch(/no domain claims this key/)
  })

  it("names every problem, not the first", () => {
    const problems = validateDomains([deploymentKey(["tenant", "orgUnit"])])
    expect(problems).toHaveLength(2)
  })

  it("allows a scope no layer kind can produce, because nothing can write it", () => {
    // `user`, `legalEntity` and `workspace` are real scopes with no layer kind
    // mapping to them. Six localization keys allow them — a person choosing
    // their own locale is the product intent — and the first version of this
    // check refused all six, which would have narrowed correct definitions to
    // satisfy a rule about a risk that does not exist yet.
    expect(validateDomains([deploymentKey(["user"])])).toEqual([])
    expect(validateDomains([deploymentKey(["legalEntity"])])).toEqual([])
  })

  it("still refuses a reachable scope in the same definition", () => {
    // The permissive case above must not become a way through. A definition
    // mixing an unreachable scope with a forbidden reachable one is refused for
    // the reachable one only.
    const problems = validateDomains([deploymentKey(["user", "tenant"])])
    expect(problems).toHaveLength(1)
    expect(problems[0].problem).toMatch(/allows scope "tenant"/)
  })

  it("fails closed the day the scope becomes reachable", () => {
    // The property that makes the exemption safe: the reachable set is DERIVED
    // from the kind-to-scope mapping, not listed. Adding a layer kind that maps
    // to `user` turns every `user` grant in a domain that excludes that kind
    // into a refusal, with no change to validateDomains. This asserts the
    // derivation rather than the current answer.
    const reachable = new Set(
      LAYER_KINDS.map((k) => SCOPE_FOR_KIND[k]).filter((s): s is NonNullable<typeof s> => s !== null),
    )
    expect(reachable.has("tenant")).toBe(true)
    expect(reachable.has("user")).toBe(false)
    // If this fails, a kind now produces `user` — which is correct and expected;
    // the six localization definitions then need their scopes reviewed against
    // the localization domain, which is exactly the review this catches.
  })
})

describe("a layer may not write a domain its kind does not own", () => {
  it("refuses a tenant overlay setting a deployment key", () => {
    const refusals = refusedByDomain([
      layer("tenantOverlay", "rochester", { "platform.deployment.region": "eu-west-1" }),
    ])
    expect(refusals).toHaveLength(1)
    expect(refusals[0].domain).toBe("deployment")
    expect(refusals[0].reason).toMatch(/not writable by a tenantOverlay layer/)
  })

  it("permits the same key from a layer that does own it", () => {
    expect(
      refusedByDomain([layer("environment", "prod", { "platform.deployment.region": "eu-west-1" })]),
    ).toEqual([])
  })

  it("leaves an unclaimed key alone rather than refusing it twice", () => {
    // validateDomains rejects an ungoverned key at load. Refusing it again at
    // resolution would make a typo in a tenant overlay resolve silently to the
    // default, which is the worst possible place to fail quietly.
    expect(refusedByDomain([layer("tenantOverlay", "t", { "platform.nothing.here": 1 })])).toEqual([])
  })
})

describe("the refusal is true, not advisory", () => {
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
    defineConfig({
  price: { perSeatMinor: 0, perOrgMinor: 0, currency: "USD", rounding: "half-up", includedBecause: "A test fixture, priced at nothing so the arithmetic under test is the test's own." },
      key: "platform.observability.logRetentionDays",
      owner: "platform",
      type: z.number(),
      default: 365,
      allowedScopes: ["platform"],
      mergeStrategy: "replace",
      sensitivity: "internal",
      overridable: true,
      description: "How long logs are kept.",
    }),
  ])

  const at = new Date("2026-01-01T00:00:00Z")

  it("strips the value a layer was not permitted to set", () => {
    // The entire point. A tenant shortening its own log retention is how an
    // incident gets discovered after the evidence has expired — so the resolved
    // value must be the default, not the 7 the layer asked for.
    const result = resolveVersionedLayers(registry, [
      layer("tenantOverlay", "rochester", {
        "platform.localization.currency": "GBP",
        "platform.observability.logRetentionDays": 7,
      }),
    ], at)

    // A null config means resolution FAILED, which is a different outcome from
    // the value being refused — assert it resolved before reading through it.
    expect(result.config).not.toBeNull()
    expect(result.config!.get<number>("platform.observability.logRetentionDays")).toBe(365)
    // The permitted key in the same layer still applies — a refusal is per key,
    // not a rejection of the whole layer.
    expect(result.config!.get<string>("platform.localization.currency")).toBe("GBP")
  })

  it("reports what it refused, so the operator is not left guessing", () => {
    const result = resolveVersionedLayers(registry, [
      layer("tenantOverlay", "rochester", { "platform.observability.logRetentionDays": 7 }),
    ], at)

    expect(result.domainRefused).toHaveLength(1)
    expect(result.domainRefused[0]).toMatchObject({
      id: "rochester",
      kind: "tenantOverlay",
      key: "platform.observability.logRetentionDays",
      domain: "observability",
    })
  })

  it("keeps domain refusals separate from invariant refusals", () => {
    // Both strip. They are reported apart because "an invariant pins that key"
    // and "your layer has no authority over that namespace" send an operator to
    // different places.
    const result = resolveVersionedLayers(registry, [
      layer("tenantOverlay", "rochester", { "platform.observability.logRetentionDays": 7 }),
    ], at)
    expect(result.refused).toEqual([])
    expect(result.domainRefused).toHaveLength(1)
  })
})
