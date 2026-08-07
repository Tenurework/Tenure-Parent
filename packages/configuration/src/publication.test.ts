import { z } from "zod"

import { ConfigRegistry, defineConfig } from "./definition"
import { requiresApproval, type VersionedLayer } from "./layer-schema"
import { resolveVersionedLayers } from "./layer-bridge"
import { currentPaymentMode, lint, planPublication, renderDiff, simulate } from "./publication"

/**
 * GE-031-006 — the publication plan.
 *
 * The tests that matter are the boundaries: that lint never blocks, that a
 * rejection always does, that four eyes means two people, and that a first
 * publication says it has nothing to roll back to rather than implying it has.
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
  defineConfig({
  price: { perSeatMinor: 0, perOrgMinor: 0, currency: "USD", rounding: "half-up", includedBecause: "A test fixture, priced at nothing so the arithmetic under test is the test's own." },
    key: "platform.terminology.seatSingular",
    owner: "platform",
    type: z.string(),
    default: "Seat",
    allowedScopes: ["blueprint", "tenant"],
    mergeStrategy: "replace",
    sensitivity: "public",
    overridable: true,
    description: "What a seat is called.",
  }),
  defineConfig({
  price: { perSeatMinor: 0, perOrgMinor: 0, currency: "USD", rounding: "half-up", includedBecause: "A test fixture, priced at nothing so the arithmetic under test is the test's own." },
    key: "platform.flags.aiAssistant.enabled",
    owner: "platform",
    type: z.boolean(),
    // True, because a flag merged with "and" can only ever be restricted. A
    // default of false with an override of true is a no-op — the restrict-only
    // law working, and the wrong fixture for observing a change.
    default: true,
    allowedScopes: ["blueprint", "tenant"],
    mergeStrategy: "and",
    sensitivity: "internal",
    overridable: true,
    description: "Whether the assistant is on.",
  }),
])

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
      origin: "publication.test.ts",
      compatibility: { minEngine: "2026.7.0", maxEngine: null },
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      effectiveUntil: null,
      changeReason: "a reason long enough to be a reason",
      approvedBy: requiresApproval(kind) ? "operator:approver" : null,
      ...over,
    },
  }
}

/**
 * What a set of layers resolves to.
 *
 * The `current` side of a diff is a resolved configuration, so a hand-written
 * subset makes every default look "added". My first fixtures did exactly that
 * and reported one changed key plus one spurious addition.
 */
function resolvedValues(layers: readonly VersionedLayer[]): Readonly<Record<string, unknown>> {
  const result = resolveVersionedLayers(registry, layers, LATER, { collectProblems: true })
  if (!result.config) throw new Error("fixture does not resolve")
  return result.config.values
}

const CURRENT_LAYERS = [layer("tenantBaseline", "acme-baseline", { "platform.localization.currency": "USD" })]

const base = (over: Partial<Parameters<typeof planPublication>[0]> = {}) =>
  planPublication({
    registry,
    current: { values: resolvedValues(CURRENT_LAYERS), revision: 4 },
    proposed: [layer("tenantOverlay", "acme", { "platform.localization.currency": "GBP" })],
    publishedBy: "operator:publisher",
    activateAt: LATER,
    now: NOW,
    ...over,
  })

describe("lint advises and never blocks", () => {
  it("does not block a proposal whose only problems are lint findings", () => {
    // The whole design. Warnings that block become noise people route around.
    const plan = base({
      proposed: [
        layer(
          "tenantOverlay",
          "acme",
          // Set to the platform default, and a change reason nobody can use.
          { "platform.localization.currency": "USD" },
          { changeReason: "fix" },
        ),
      ],
    })
    expect(plan.lint.length).toBeGreaterThan(0)
    expect(plan.blocked).toBe(false)
  })

  it("notices a value set to the platform default", () => {
    const findings = lint(
      [layer("tenantOverlay", "a", { "platform.localization.currency": "USD" })],
      registry,
      "operator:publisher",
    )
    expect(findings.map((f) => f.code)).toContain("value-equals-default")
  })

  it("notices an experiment with no end date", () => {
    // An experiment that never ends is a permanent change wearing a temporary
    // label, and nobody comes back to it.
    const findings = lint([layer("experiment", "x", { a: 1 })], registry, "operator:publisher")
    expect(findings.map((f) => f.code)).toContain("no-effective-end")
  })

  it("notices a layer that sets nothing", () => {
    const findings = lint([layer("tenantOverlay", "a", {})], registry, "operator:publisher")
    expect(findings.map((f) => f.code)).toContain("layer-sets-nothing")
  })

  it("notices an approval by the author, as well as blocking it", () => {
    // Reported in lint AND blocked in the plan, deliberately: a reviewer
    // reading the findings should see it without opening the verdict. There
    // are two copies of this condition, so there are two tests — a mutation
    // that disabled only the lint copy went unnoticed until this existed.
    const findings = lint(
      [layer("tenantOverlay", "a", { x: 1 }, { approvedBy: "operator:publisher" })],
      registry,
      "operator:publisher",
    )
    expect(findings.map((f) => f.code)).toContain("approved-by-author")
  })

  it("notices a change reason that will mean nothing later", () => {
    const findings = lint([layer("tenantOverlay", "a", { x: 1 }, { changeReason: "wip" })], registry, "op")
    expect(findings.map((f) => f.code)).toContain("empty-change-reason")
  })
})

describe("four eyes means two people", () => {
  it("blocks an approval by the identity publishing it", () => {
    const plan = base({
      proposed: [
        layer("tenantOverlay", "acme", { "platform.localization.currency": "GBP" }, {
          approvedBy: "operator:publisher",
        }),
      ],
    })
    expect(plan.blocked).toBe(true)
    expect(plan.blockers.join(" ")).toMatch(/not a second pair of eyes/)
  })

  it("allows an approval by anyone else", () => {
    expect(base().blocked).toBe(false)
  })
})

describe("scheduled activation", () => {
  it("refuses a schedule in the past", () => {
    const plan = base({ activateAt: new Date("2026-07-01T00:00:00Z") })
    expect(plan.blocked).toBe(true)
    expect(plan.blockers.join(" ")).toMatch(/in the past/)
  })

  it("records the activation instant on the plan", () => {
    expect(base().activateAt).toBe(LATER.toISOString())
  })
})

describe("rollback target", () => {
  it("names the revision it would return to", () => {
    expect(base().rollbackTo).toBe(4)
  })

  it("says null on a first publication rather than implying one exists", () => {
    // A change with nothing to roll back to is a different risk, and the
    // operator signing it should be told which they have.
    expect(base({ current: null }).rollbackTo).toBeNull()
  })
})

describe("diff", () => {
  it("reports added, removed and changed keys", () => {
    const plan = base({
      // `gone` models a key the registry no longer defines. Between two
      // resolutions of one registry every key exists on both sides, so removal
      // and addition only happen when the registry moves.
      current: { values: { ...resolvedValues(CURRENT_LAYERS), gone: 1 }, revision: 2 },
      proposed: [
        layer("tenantOverlay", "acme", {
          "platform.localization.currency": "GBP",
          "platform.terminology.seatSingular": "Chair",
        }),
      ],
    })
    const byKey = Object.fromEntries(plan.diff.map((d) => [d.key, d.change]))
    expect(byKey["platform.localization.currency"]).toBe("changed")
    expect(byKey["platform.terminology.seatSingular"]).toBe("changed")
    expect(byKey["gone"]).toBe("removed")
  })

  it("renders a diff a person can read", () => {
    const text = renderDiff([
      { key: "a", change: "added", after: 1 },
      { key: "b", change: "removed", before: 2 },
      { key: "c", change: "changed", before: 3, after: 4 },
    ])
    expect(text).toContain("+ a = 1")
    expect(text).toContain("- b  (was 2)")
    expect(text).toContain("~ c: 3 -> 4")
  })

  it("says so plainly when nothing changes", () => {
    expect(renderDiff([])).toBe("No values change.")
  })

  it("does not report a key-order change as a change", () => {
    // The machine diff treats these as equal; a human diff that disagreed would
    // be worse than none.
    const plan = base({
      // Same object, different key order, on a key the registry knows.
      current: { values: resolvedValues(CURRENT_LAYERS), revision: 1 },
      proposed: CURRENT_LAYERS,
    })
    expect(plan.diff).toEqual([])
  })
})

describe("impact names what changed, rather than counting it", () => {
  it("counts keys by kind of change", () => {
    const plan = base()
    expect(plan.impact.keysChanged).toBe(1)
    expect(plan.impact.keysAdded).toBe(0)
  })

  it("names the modules and flags whose values move", () => {
    // "3 modules affected" sends an operator to find out which, which is the
    // work a preview exists to remove.
    const plan = base({
      current: { values: resolvedValues(CURRENT_LAYERS), revision: 1 },
      proposed: [
        ...CURRENT_LAYERS,
        layer("tenantOverlay", "acme", { "platform.flags.aiAssistant.enabled": false }),
      ],
    })
    expect(plan.impact.modulesAffected).toEqual(["platform.flags.aiAssistant.enabled"])
  })
})

describe("simulation runs the real resolver against fixtures", () => {
  it("resolves each fixture and reports its checksum", () => {
    const results = simulate(
      registry,
      [layer("tenantOverlay", "acme", { "platform.localization.currency": "GBP" })],
      [{ name: "plain" }, { name: "with-org-unit", layers: [layer("orgUnitOverlay", "west", {})] }],
      LATER,
    )
    expect(results.map((r) => r.fixture)).toEqual(["plain", "with-org-unit"])
    for (const result of results) expect(result.checksum).toMatch(/^sha256:/)
  })

  it("reports a fixture whose values do not validate", () => {
    const results = simulate(
      registry,
      [layer("tenantOverlay", "acme", { "platform.localization.currency": 42 })],
      [{ name: "bad" }, { name: "also-run" }],
      LATER,
    )
    expect(results).toHaveLength(2)
    expect(results[0].problems.length).toBeGreaterThan(0)
  })

  it("reports a fixture that THROWS rather than stopping the run", () => {
    // The case above returns problems; it never reaches the catch. A layer
    // whose compatibility range is not a version makes compareSemver throw, and
    // the point of simulating is to learn which environments break — so the
    // second fixture must still be reported. My first version of this test used
    // a bad VALUE, which resolves to problems, and a mutation that removed the
    // catch entirely went unnoticed.
    const results = simulate(
      registry,
      [layer("tenantOverlay", "acme", { "platform.localization.currency": "GBP" })],
      [
        { name: "broken", layers: [layer("orgUnitOverlay", "x", {}, { compatibility: { minEngine: "latest", maxEngine: null } })] },
        { name: "also-run" },
      ],
      LATER,
    )
    expect(results).toHaveLength(2)
    expect(results[0].values).toBeNull()
    expect(results[0].problems.join(" ")).toMatch(/Not a semantic version/)
    expect(results[1].checksum).toMatch(/^sha256:/)
  })

  it("names affected fixtures on the plan", () => {
    const plan = base({
      proposed: [layer("tenantOverlay", "acme", { "platform.localization.currency": 42 })],
      fixtures: [{ name: "pilot" }],
    })
    expect(plan.impact.fixturesAffected).toEqual(["pilot"])
  })
})

describe("rejections always block", () => {
  it("blocks on an ambiguous precedence conflict", () => {
    const plan = base({
      proposed: [
        layer("orgUnitOverlay", "west", { "platform.localization.currency": "GBP" }),
        layer("orgUnitOverlay", "east", { "platform.localization.currency": "EUR" }),
      ],
    })
    expect(plan.blocked).toBe(true)
    expect(plan.rejections.map((r) => r.rule)).toContain("ambiguous-precedence")
  })

  it("blocks on an unentitled module", () => {
    const plan = base({
      modules: [{ key: "finance", entitlement: "module.finance" }],
      enabledModules: ["finance"],
      entitlements: [],
    })
    expect(plan.blocked).toBe(true)
    expect(plan.rejections.map((r) => r.rule)).toContain("unentitled-feature")
  })
})

/**
 * PAY-000-007 — test and live are separated by something a publication respects.
 *
 * Two controls, and they are different questions. `requiresCapability` asks
 * "may this principal set this key at all" — it had been a declared field with
 * no enforcement anywhere, which is indistinguishable from no field. `liveOnly`
 * asks "does this key mean anything in the mode this tenant is currently in".
 *
 * The registry here declares both against real keys, so the check is exercised
 * through `planPublication` — the function the Studio calls — rather than
 * against a helper.
 */
const MODE_KEY = "platform.payments.mode"
const ENTITY_KEY = "platform.payments.legalEntityId"

const paymentsRegistry = registry.with([
  defineConfig({
    price: { perSeatMinor: 0, perOrgMinor: 0, currency: "USD", rounding: "half-up", includedBecause: "A test fixture, priced at nothing so the arithmetic under test is the test's own." },
    key: MODE_KEY,
    owner: "platform",
    type: z.enum(["test", "live"]),
    default: "test",
    allowedScopes: ["tenant"],
    mergeStrategy: "replace",
    sensitivity: "internal",
    overridable: true,
    requiresCapability: "payments.mode.publish",
    description: "Which money-mode this tenant is in.",
  }),
  defineConfig({
    price: { perSeatMinor: 0, perOrgMinor: 0, currency: "USD", rounding: "half-up", includedBecause: "A test fixture, priced at nothing so the arithmetic under test is the test's own." },
    key: ENTITY_KEY,
    owner: "platform",
    type: z.string(),
    default: "",
    allowedScopes: ["tenant"],
    mergeStrategy: "replace",
    sensitivity: "internal",
    overridable: true,
    requiresCapability: "payments.legalEntity.publish",
    liveOnly: true,
    description: "The legal entity this tenant's money moves under.",
  }),
])

/** A tenant whose current configuration puts it in `mode`. */
const inMode = (mode: "test" | "live") => ({
  values: { ...resolvedValues(CURRENT_LAYERS), [MODE_KEY]: mode },
  revision: 4,
})

const paymentsPlan = (over: Partial<Parameters<typeof planPublication>[0]> = {}) =>
  planPublication({
    registry: paymentsRegistry,
    current: inMode("test"),
    proposed: [layer("tenantOverlay", "acme", { [MODE_KEY]: "live" })],
    publishedBy: "operator:publisher",
    publisherCapabilities: ["payments.mode.publish"],
    activateAt: LATER,
    now: NOW,
    ...over,
  })

describe("money-mode is an authorised publication", () => {
  it("blocks a mode change published by someone who does not hold the capability", () => {
    // The failure this closes: `requiresCapability` was declared on the type and
    // read by nothing, so the field said the key was governed while anyone who
    // could reach the form could set it.
    const plan = paymentsPlan({ publisherCapabilities: [] })
    expect(plan.blocked).toBe(true)
    expect(plan.blockers.join("\n")).toMatch(/payments\.mode\.publish/)
  })

  it("lets the mode change through for a principal who holds it, with a diff", () => {
    const plan = paymentsPlan()
    expect(plan.blocked).toBe(false)
    // A change with a diff, not a switch somebody flipped: the operator signing
    // it sees the before and the after.
    expect(plan.diff).toContainEqual({
      key: MODE_KEY,
      change: "changed",
      before: "test",
      after: "live",
    })
    expect(plan.rollbackTo).toBe(4)
  })

  it("refuses a live-only value while the tenant is in test mode", () => {
    const plan = paymentsPlan({
      proposed: [layer("tenantOverlay", "acme", { [ENTITY_KEY]: "le-ny" })],
      publisherCapabilities: ["payments.legalEntity.publish"],
    })
    expect(plan.blocked).toBe(true)
    expect(plan.blockers.join("\n")).toMatch(/only means anything in live mode/)
  })

  it("accepts the same live-only value once the tenant is live", () => {
    const plan = paymentsPlan({
      current: inMode("live"),
      proposed: [layer("tenantOverlay", "acme", { [ENTITY_KEY]: "le-ny" })],
      publisherCapabilities: ["payments.legalEntity.publish"],
    })
    expect(plan.blocked).toBe(false)
  })

  it("refuses one publication that both flips the mode and sets a live-only value", () => {
    // The ordering is the control. The tenant's mode is what its CURRENT
    // configuration says, not what this proposal would make it — so a live-only
    // value cannot ride in on the same change that makes it meaningful, with
    // nobody having reviewed it under a live tenant.
    const plan = paymentsPlan({
      proposed: [layer("tenantOverlay", "acme", { [MODE_KEY]: "live", [ENTITY_KEY]: "le-ny" })],
      publisherCapabilities: ["payments.mode.publish", "payments.legalEntity.publish"],
    })
    expect(plan.blocked).toBe(true)
    expect(plan.blockers.join("\n")).toMatch(/only means anything in live mode/)
  })

  it("reads the tenant's mode off its current configuration, defaulting to test", () => {
    // A first publication has no `current` at all. Treating that as live would
    // make the most dangerous mode the one a tenant gets by having no history.
    expect(currentPaymentMode(null)).toBe("test")
    expect(currentPaymentMode({ values: {} })).toBe("test")
    expect(currentPaymentMode({ values: { [MODE_KEY]: "sandbox" } })).toBe("test")
    expect(currentPaymentMode({ values: { [MODE_KEY]: "live" } })).toBe("live")
  })
})
