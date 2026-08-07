import { z } from "zod"

// The sub-cent scale a Money carries internally. Imported rather than written as
// 10 ** 6 here, so a change to it is a failing test rather than a silently
// hundredfold-wrong assertion.
import { SCALE } from "@tenure/finops"

import {
  ConfigDefinitionError,
  ConfigRegistry,
  ConfigResolutionError,
  ConfigVersionError,
  defineConfig,
  diffVersions,
  includedInPlan,
  isChargeable,
  isRestrictive,
  mergeValues,
  publish,
  redact,
  resolveConfig,
  resolveConfigOrThrow,
  stableStringify,
  supersede,
  type ConfigDefinition,
  type ConfigLayer,
} from "./index"

// ── fixtures ────────────────────────────────────────────────────────────────

/**
 * Priced at nothing, with the reason, because every definition must be priced
 * (NEXT-SESSION §7) and these particular keys are not what the pricing tests
 * are about. The two that ARE priced — `staffOffice` and `aiAssist` — carry
 * real numbers, one per organisation and one per seat, so the running total has
 * both halves in it.
 */
const FIXTURE_INCLUDED = includedInPlan(
  "A test fixture, priced at nothing so the arithmetic under test is the test's own.",
)

const staffOffice = defineConfig({
  key: "platform.terminology.staffOffice",
  owner: "platform",
  type: z.string().min(1).max(80),
  default: "Student Engagement Office",
  allowedScopes: ["tenant"],
  mergeStrategy: "replace",
  sensitivity: "public",
  overridable: true,
  // Charged for the organisation, once, when the tenant chooses its own words.
  price: { perSeatMinor: 0, perOrgMinor: 9_900, currency: "USD", rounding: "half-up" },
  description: "What this institution calls the staff office that oversees organizations.",
})

const retentionDays = defineConfig({
  key: "platform.retention.days",
  owner: "platform",
  type: z.number().int().positive().max(3650),
  default: 365,
  allowedScopes: ["tenant", "legalEntity", "orgUnit"],
  mergeStrategy: "min",
  sensitivity: "internal",
  overridable: true,
  price: FIXTURE_INCLUDED,
  description: "Ceiling on how long records are kept. Narrows downward, never widens.",
})

const featuresEnabled = defineConfig({
  key: "platform.features.enabled",
  owner: "platform",
  type: z.array(z.string()),
  default: ["events", "documents", "approvals"],
  allowedScopes: ["tenant", "orgUnit"],
  mergeStrategy: "intersectSet",
  sensitivity: "internal",
  overridable: true,
  price: FIXTURE_INCLUDED,
  description: "Features available. A lower layer's removal cannot be undone below it.",
})

const branding = defineConfig({
  key: "platform.branding.theme",
  owner: "platform",
  type: z.object({
    primary: z.string(),
    logoUrl: z.string().optional(),
    dense: z.boolean().optional(),
  }),
  default: { primary: "#101010" },
  allowedScopes: ["tenant", "orgUnit", "user"],
  mergeStrategy: "deepMerge",
  sensitivity: "public",
  overridable: true,
  price: FIXTURE_INCLUDED,
  description: "Visual identity, merged so a unit can set one field without restating the rest.",
})

const pinned = defineConfig({
  key: "platform.security.auditImmutable",
  owner: "platform",
  type: z.boolean(),
  default: true,
  allowedScopes: [],
  mergeStrategy: "and",
  sensitivity: "internal",
  overridable: false,
  price: FIXTURE_INCLUDED,
  description: "Audit records cannot be edited. Configurable in shape, frozen in fact.",
})

/**
 * A boolean option that ships ON and costs money per seat.
 *
 * The shape `platform.flags.aiAssistant.enabled` really has: restrict-only,
 * default true, per-seat charge. It is here because a switch is charged while it
 * is on rather than when it differs from its default, and that rule has to be
 * exercised in both directions by something the resolver actually produces.
 */
const aiAssist = defineConfig({
  key: "platform.assistant.enabled",
  owner: "platform",
  type: z.boolean(),
  default: true,
  allowedScopes: ["tenant"],
  mergeStrategy: "and",
  sensitivity: "internal",
  overridable: true,
  price: { perSeatMinor: 400, perOrgMinor: 0, currency: "USD", rounding: "half-up" },
  description: "The assistant. Every question is a paid call to the model vendor.",
})

const secretish = defineConfig({
  key: "platform.integrations.webhookSecretHint",
  owner: "platform",
  type: z.string(),
  default: "unset",
  allowedScopes: ["tenant"],
  mergeStrategy: "replace",
  sensitivity: "secret",
  overridable: true,
  price: FIXTURE_INCLUDED,
  description: "Stands in for a sensitive value, to prove redaction.",
})

const REGISTRY = ConfigRegistry.of([
  staffOffice,
  retentionDays,
  featuresEnabled,
  branding,
  pinned,
  aiAssist,
  secretish,
])

const layer = (
  scope: ConfigLayer["scope"],
  id: string,
  values: Record<string, unknown>,
): ConfigLayer => ({ scope, id, values })

// ── definitions ─────────────────────────────────────────────────────────────

describe("definitions are checked when they are declared, not when they are read", () => {
  const base = {
    owner: "platform",
    type: z.string(),
    default: "x",
    allowedScopes: ["tenant"] as const,
    mergeStrategy: "replace" as const,
    sensitivity: "public" as const,
    overridable: true,
    price: FIXTURE_INCLUDED,
    description: "d",
  }

  it("requires the key to begin with its owner", () => {
    // The architecture document states this rule and then breaks it in its own
    // finance example (pack id `pack.finance`, capabilities `finance.*`). An
    // unenforced naming convention is a naming suggestion.
    expect(() => defineConfig({ ...base, key: "finance.thing", owner: "platform" })).toThrow(
      /owned by "platform" but namespaced under "finance"/,
    )
  })

  it("requires a namespace at all", () => {
    expect(() => defineConfig({ ...base, key: "thing" })).toThrow(/must be namespaced/)
  })

  it("rejects a default that fails its own schema", () => {
    expect(() =>
      defineConfig({ ...base, key: "platform.n", type: z.number(), default: "not a number" as never }),
    ).toThrow(/default that fails its own schema/)
  })

  it("rejects overridable with nowhere to override it", () => {
    expect(() => defineConfig({ ...base, key: "platform.k", allowedScopes: [] })).toThrow(
      /lists no allowed scopes/,
    )
  })

  it("rejects an unknown merge strategy arriving from outside the type system", () => {
    expect(() =>
      defineConfig({ ...base, key: "platform.k", mergeStrategy: "smoosh" as never }),
    ).toThrow(/unknown merge strategy/)
  })

  it("refuses two owners for one key", () => {
    const a = defineConfig({ ...base, key: "platform.dup" })
    const b = { ...a, owner: "platform", description: "another" } as ConfigDefinition
    expect(() => ConfigRegistry.of([a, b])).toThrow(ConfigDefinitionError)
    expect(() => ConfigRegistry.of([a, b])).toThrow(/Duplicate configuration key/)
  })

  /* NEXT-SESSION §7 — an option without a price is incomplete. */

  it("refuses a definition that carries no price at all", () => {
    // The whole point of making `price` required: a definition assembled by
    // spreading an older object compiles fine and has to fail here instead.
    expect(() =>
      defineConfig({ ...base, key: "platform.unpriced", price: undefined as never }),
    ).toThrow(/declares no price/)
    expect(() =>
      defineConfig({ ...base, key: "platform.unpriced", price: undefined as never }),
    ).toThrow(/without a price is incomplete/)
  })

  it("refuses a price in fractions of a minor unit", () => {
    // $4.005 per seat is not a price anyone can be invoiced for, and a float
    // that far down does not survive a total.
    expect(() =>
      defineConfig({
        ...base,
        key: "platform.fractional",
        price: { perSeatMinor: 4.5, perOrgMinor: 0, currency: "USD", rounding: "half-up" },
      }),
    ).toThrow(/not a whole number of minor units/)
  })

  it("refuses a negative list price", () => {
    expect(() =>
      defineConfig({
        ...base,
        key: "platform.credit",
        price: { perSeatMinor: -100, perOrgMinor: 0, currency: "USD", rounding: "half-up" },
      }),
    ).toThrow(/discount/)
  })

  it("refuses a free option that does not say why it is free", () => {
    // Zero is a commercial statement. One nobody wrote down is indistinguishable
    // from an option nobody has priced, which is the exact defect §7 names.
    expect(() =>
      defineConfig({
        ...base,
        key: "platform.silentlyFree",
        price: { perSeatMinor: 0, perOrgMinor: 0, currency: "USD", rounding: "half-up" },
      }),
    ).toThrow(/includedBecause/)
  })

  it("accepts a free option that does say why", () => {
    expect(() =>
      defineConfig({ ...base, key: "platform.statedFree", price: includedInPlan("included in every plan") }),
    ).not.toThrow()
  })

  it("refuses a price in something that is not a currency", () => {
    expect(() =>
      defineConfig({
        ...base,
        key: "platform.credits",
        price: { perSeatMinor: 100, perOrgMinor: 0, currency: "credits", rounding: "half-up" },
      }),
    ).toThrow(/ISO 4217/)
  })

  it("extends without mutating — enabling a module yields a new registry", () => {
    const extra = defineConfig({ ...base, key: "platform.extra" })
    const bigger = REGISTRY.with([extra])
    expect(bigger.has("platform.extra")).toBe(true)
    expect(REGISTRY.has("platform.extra")).toBe(false)
    expect(bigger.size).toBe(REGISTRY.size + 1)
  })
})

// ── resolution ──────────────────────────────────────────────────────────────

describe("resolution folds layers over defaults", () => {
  it("uses the default when nothing sets a key", () => {
    const config = resolveConfigOrThrow(REGISTRY, [])
    expect(config.get("platform.terminology.staffOffice")).toBe("Student Engagement Office")
    expect(config.explain("platform.terminology.staffOffice").usedDefault).toBe(true)
  })

  it("lets a tenant override, and says who did", () => {
    const config = resolveConfigOrThrow(REGISTRY, [
      layer("tenant", "rochester", { "platform.terminology.staffOffice": "Ainslie OSE" }),
    ])
    expect(config.get("platform.terminology.staffOffice")).toBe("Ainslie OSE")

    const why = config.explain("platform.terminology.staffOffice")
    expect(why.usedDefault).toBe(false)
    expect(why.contributors).toEqual([
      { scope: "tenant", id: "rochester", label: undefined, value: "Ainslie OSE" },
    ])
  })

  it("gives two tenants different answers from one registry", () => {
    // The whole premise: no branch anywhere names either of them.
    const a = resolveConfigOrThrow(REGISTRY, [
      layer("tenant", "rochester", { "platform.terminology.staffOffice": "Ainslie OSE" }),
    ])
    const b = resolveConfigOrThrow(REGISTRY, [
      layer("tenant", "midtown-arts", { "platform.terminology.staffOffice": "Programs Team" }),
    ])
    expect(a.get("platform.terminology.staffOffice")).toBe("Ainslie OSE")
    expect(b.get("platform.terminology.staffOffice")).toBe("Programs Team")
    expect(a.checksum).not.toBe(b.checksum)
  })

  it("applies an org-unit chain in the order given, ancestors first", () => {
    const config = resolveConfigOrThrow(REGISTRY, [
      layer("tenant", "t", { "platform.branding.theme": { primary: "#111", dense: false } }),
      layer("orgUnit", "school", { "platform.branding.theme": { logoUrl: "/school.svg" } }),
      layer("orgUnit", "club", { "platform.branding.theme": { dense: true } }),
    ])
    expect(config.get("platform.branding.theme")).toEqual({
      primary: "#111",
      logoUrl: "/school.svg",
      dense: true,
    })
    expect(config.explain("platform.branding.theme").contributors.map((c) => c.id)).toEqual([
      "t",
      "school",
      "club",
    ])
  })
})

describe("restrictive strategies mean a lower layer's limit cannot be undone", () => {
  it("narrows a retention ceiling downward and refuses to widen it", () => {
    const narrowed = resolveConfigOrThrow(REGISTRY, [
      layer("tenant", "t", { "platform.retention.days": 180 }),
      layer("orgUnit", "dept", { "platform.retention.days": 90 }),
    ])
    expect(narrowed.get("platform.retention.days")).toBe(90)

    // The department asks for longer than the tenant allows; min keeps the tenant's.
    const attemptedWiden = resolveConfigOrThrow(REGISTRY, [
      layer("tenant", "t", { "platform.retention.days": 180 }),
      layer("orgUnit", "dept", { "platform.retention.days": 3650 }),
    ])
    expect(attemptedWiden.get("platform.retention.days")).toBe(180)
  })

  it("cannot re-enable a feature the tenant removed", () => {
    const config = resolveConfigOrThrow(REGISTRY, [
      layer("tenant", "t", { "platform.features.enabled": ["events", "documents"] }),
      layer("orgUnit", "club", { "platform.features.enabled": ["events", "documents", "approvals"] }),
    ])
    // "approvals" is gone for good below the tenant that dropped it.
    expect(config.get("platform.features.enabled")).toEqual(["events", "documents"])
  })

  it("classifies the strategies that guarantee that", () => {
    expect(isRestrictive("and")).toBe(true)
    expect(isRestrictive("min")).toBe(true)
    expect(isRestrictive("intersectSet")).toBe(true)
    expect(isRestrictive("replace")).toBe(false)
    expect(isRestrictive("or")).toBe(false)
    expect(isRestrictive("max")).toBe(false)
  })
})

describe("resolution fails closed", () => {
  const expectProblem = (layers: ConfigLayer[], reason: string) => {
    const { config, problems } = resolveConfig(REGISTRY, layers, { collectProblems: true })
    expect(config).toBeNull()
    expect(problems.map((p) => p.reason)).toContain(reason)
  }

  it("refuses a key nobody defined", () => {
    expectProblem([layer("tenant", "t", { "platform.nope": 1 })], "unknown-key")
  })

  it("refuses an override at a scope the definition does not allow", () => {
    // Terminology is a tenant decision. A user cannot rename the institution.
    expectProblem([layer("user", "u1", { "platform.terminology.staffOffice": "My Office" })], "scope-not-allowed")
  })

  it("refuses to override a pinned key", () => {
    expectProblem([layer("tenant", "t", { "platform.security.auditImmutable": false })], "not-overridable")
  })

  it("refuses a value that fails its schema", () => {
    expectProblem([layer("tenant", "t", { "platform.retention.days": -5 })], "invalid-value")
  })

  it("refuses layers supplied out of precedence order", () => {
    expectProblem(
      [
        layer("orgUnit", "club", { "platform.retention.days": 90 }),
        layer("tenant", "t", { "platform.retention.days": 180 }),
      ],
      "layers-out-of-order",
    )
  })

  it("reports a merge that cannot apply rather than coercing", () => {
    // A schema permissive enough to accept the value, and a strategy that cannot
    // combine it — the merge has to say so rather than produce NaN.
    const { config, problems } = resolveConfig(
      ConfigRegistry.of([{ ...retentionDays, type: z.any() } as ConfigDefinition]),
      [layer("tenant", "t", { "platform.retention.days": "ninety" })],
      { collectProblems: true },
    )
    expect(config).toBeNull()
    expect(problems.map((p) => p.reason)).toContain("merge-failed")
  })

  it("refuses a value of the wrong shape entirely", () => {
    expectProblem([layer("tenant", "t", { "platform.features.enabled": "events" })], "invalid-value")
  })

  it("refuses an object fragment where deepMerge expects one and gets a scalar", () => {
    expectProblem([layer("tenant", "t", { "platform.branding.theme": "#fff" })], "invalid-value")
  })

  it("catches a merged result that no single layer would have been rejected for", () => {
    // Every layer here is individually fine. The intersection is empty, and the
    // schema forbids empty — a failure that exists only after merging, which is
    // why the result is validated and not just the inputs.
    const atLeastOne = ConfigRegistry.of([
      { ...featuresEnabled, type: z.array(z.string()).min(1) } as ConfigDefinition,
    ])
    const { config, problems } = resolveConfig(
      atLeastOne,
      [
        layer("tenant", "t", { "platform.features.enabled": ["events"] }),
        layer("orgUnit", "club", { "platform.features.enabled": ["documents"] }),
      ],
      { collectProblems: true },
    )
    expect(config).toBeNull()
    expect(problems[0].reason).toBe("invalid-result")
    expect(problems[0].detail).toContain("tenant/t → orgUnit/club")
  })

  it("throws by default, so a bad tenant configuration cannot be served as defaults", () => {
    // Falling back would show the tenant the platform's settings while reporting
    // success — their own configuration silently discarded.
    expect(() =>
      resolveConfigOrThrow(REGISTRY, [layer("tenant", "t", { "platform.retention.days": -1 })]),
    ).toThrow(ConfigResolutionError)
  })

  it("collects every problem at once for the Studio, not just the first", () => {
    const { problems } = resolveConfig(
      REGISTRY,
      [
        layer("tenant", "t", {
          "platform.nope": 1,
          "platform.retention.days": -1,
          "platform.security.auditImmutable": false,
        }),
      ],
      { collectProblems: true },
    )
    expect(problems).toHaveLength(3)
  })

  it("refuses to read a key that is not defined, rather than returning undefined", () => {
    const config = resolveConfigOrThrow(REGISTRY, [])
    // `undefined` would take a caller's `?? fallback` branch and look deliberate.
    expect(() => config.get("platform.typo")).toThrow(/is not defined/)
  })
})

describe("a resolved configuration is frozen and hashed", () => {
  it("cannot be mutated after resolution", () => {
    const config = resolveConfigOrThrow(REGISTRY, [])
    expect(Object.isFrozen(config.values)).toBe(true)
    expect(() => {
      ;(config.values as Record<string, unknown>)["platform.retention.days"] = 1
    }).toThrow()
  })

  it("hashes by content, not by the order layers arrived in", () => {
    const one = resolveConfigOrThrow(REGISTRY, [
      layer("tenant", "t", {
        "platform.terminology.staffOffice": "Ainslie OSE",
        "platform.retention.days": 180,
      }),
    ])
    const other = resolveConfigOrThrow(REGISTRY, [
      layer("tenant", "t", {
        "platform.retention.days": 180,
        "platform.terminology.staffOffice": "Ainslie OSE",
      }),
    ])
    expect(one.checksum).toBe(other.checksum)
  })

  it("changes the checksum when any value changes", () => {
    const before = resolveConfigOrThrow(REGISTRY, [])
    const after = resolveConfigOrThrow(REGISTRY, [
      layer("tenant", "t", { "platform.retention.days": 364 }),
    ])
    expect(after.checksum).not.toBe(before.checksum)
  })

  it("sorts object keys so equal values hash equal", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it("redacts by sensitivity, from the definition rather than the call site", () => {
    const config = resolveConfigOrThrow(REGISTRY, [
      layer("tenant", "t", { "platform.integrations.webhookSecretHint": "hunter2" }),
    ])
    const safe = redact(config, REGISTRY)
    expect(safe["platform.integrations.webhookSecretHint"]).toBe("[redacted:secret]")
    expect(safe["platform.terminology.staffOffice"]).toBe("Student Engagement Office")
  })
})

// ── the running total, from the resolver ────────────────────────────────────

/**
 * NEXT-SESSION §7 — every option priced per seat AND for the whole
 * organisation, with a running total.
 *
 * Every assertion below reads `config.runningCost`, which is what
 * `resolveConfig` EMITS. Calling `runningTotal` directly here would prove that
 * the helper adds up and prove nothing about whether the resolver still calls
 * it — which is exactly how a frozen producer stays green.
 */
describe("resolution prices the configuration it resolved", () => {
  /** Minor units — cents — out of a Money's internal sub-cent scale. */
  const minor = (amount: { units: number }) => amount.units / 10 ** SCALE

  it("charges a switch while it is on, and says which seat count it used", () => {
    const config = resolveConfigOrThrow(REGISTRY, [])

    // Nothing has been overridden, so the only charge is the assistant, which
    // ships on. $4.00 per seat, nothing for the organisation.
    expect(minor(config.runningCost.perSeat)).toBe(400)
    expect(minor(config.runningCost.organization)).toBe(0)
    // Default seat count, echoed back rather than implied.
    expect(config.runningCost.seats).toBe(1)
    expect(minor(config.runningCost.total)).toBe(400)
    expect(config.runningCost.currency).toBe("USD")
  })

  it("multiplies the per-seat half by the seats it was given", () => {
    const { config } = resolveConfig(REGISTRY, [], { seats: 250 })
    expect(config!.runningCost.seats).toBe(250)
    expect(minor(config!.runningCost.perSeat)).toBe(400)
    expect(minor(config!.runningCost.total)).toBe(400 * 250)
  })

  it("adds the organisation charge when the tenant chooses its own words", () => {
    const { config } = resolveConfig(
      REGISTRY,
      [layer("tenant", "rochester", { "platform.terminology.staffOffice": "Ainslie OSE" })],
      { seats: 250 },
    )
    // Per seat unchanged; the white-label charge is a one-off for the org.
    expect(minor(config!.runningCost.perSeat)).toBe(400)
    expect(minor(config!.runningCost.organization)).toBe(9_900)
    expect(minor(config!.runningCost.total)).toBe(400 * 250 + 9_900)
  })

  it("drops the per-seat charge when the switch is turned off", () => {
    // The direction that matters: a restrict-only flag that ships on is charged
    // for until somebody turns it off. Charging on "differs from the default"
    // would bill a tenant MORE for switching a feature off.
    const { config } = resolveConfig(
      REGISTRY,
      [layer("tenant", "rochester", { "platform.assistant.enabled": false })],
      { seats: 250 },
    )
    expect(minor(config!.runningCost.perSeat)).toBe(0)
    expect(minor(config!.runningCost.total)).toBe(0)
  })

  it("lists every charged option, so a total can be read line by line", () => {
    const { config } = resolveConfig(
      REGISTRY,
      [layer("tenant", "rochester", { "platform.terminology.staffOffice": "Ainslie OSE" })],
      { seats: 10 },
    )
    const byKey = Object.fromEntries(config!.runningCost.lines.map((l) => [l.key, l]))
    expect(minor(byKey["platform.terminology.staffOffice"].organization)).toBe(9_900)
    expect(minor(byKey["platform.assistant.enabled"].perSeat)).toBe(400)
    // A key left at its default is not on the quote at all — the tenant did not
    // choose it, so there is nothing to charge them for.
    expect(byKey["platform.retention.days"]).toBeUndefined()
  })

  it("says why an included line is included", () => {
    // `pinned` is a boolean that ships true, so it is on the quote — at nothing,
    // with the reason. A zero with no reason is indistinguishable from an
    // option nobody priced, which is the defect §7 names.
    const config = resolveConfigOrThrow(REGISTRY, [])
    const line = config.runningCost.lines.find((l) => l.key === "platform.security.auditImmutable")!
    expect(line.included).toBe(true)
    expect(line.includedBecause).toMatch(/test fixture/)
  })

  it("refuses to total a registry priced in two currencies", () => {
    // A total across currencies is not a total. It fails at resolution rather
    // than rendering a number that is wrong in a way that looks right.
    const mixed = ConfigRegistry.of([
      aiAssist,
      {
        ...staffOffice,
        price: { perSeatMinor: 0, perOrgMinor: 8_000, currency: "EUR", rounding: "half-up" },
      } as ConfigDefinition,
    ])
    expect(() =>
      resolveConfigOrThrow(mixed, [
        layer("tenant", "t", { "platform.terminology.staffOffice": "Bureau" }),
      ]),
    ).toThrow(/Cannot combine/)
  })

  it("decides chargeability from the effective value, not from who set it", () => {
    // A tenant that writes the platform default back has chosen the included
    // option and owes nothing for it. Charging on "a layer touched this key"
    // would bill them for typing the same word again.
    expect(isChargeable(staffOffice as ConfigDefinition, "Student Engagement Office")).toBe(false)
    expect(isChargeable(staffOffice as ConfigDefinition, "Ainslie OSE")).toBe(true)
    expect(isChargeable(aiAssist as ConfigDefinition, true)).toBe(true)
    expect(isChargeable(aiAssist as ConfigDefinition, false)).toBe(false)
  })

  it("does not fold the price into the checksum", () => {
    // The checksum answers "what was this system configured as". A price change
    // is not a configuration change, and folding it in would make every
    // published revision differ from its predecessor the day a price moves.
    const cheap = ConfigRegistry.of([
      { ...aiAssist, price: { perSeatMinor: 1, perOrgMinor: 0, currency: "USD", rounding: "half-up" } } as ConfigDefinition,
    ])
    const dear = ConfigRegistry.of([
      { ...aiAssist, price: { perSeatMinor: 9_999, perOrgMinor: 0, currency: "USD", rounding: "half-up" } } as ConfigDefinition,
    ])
    const a = resolveConfigOrThrow(cheap, [])
    const b = resolveConfigOrThrow(dear, [])
    expect(a.checksum).toBe(b.checksum)
    expect(minor(a.runningCost.total)).not.toBe(minor(b.runningCost.total))
  })
})

// ── merge strategies, directly ──────────────────────────────────────────────

describe("merge strategies", () => {
  it("replaces arrays rather than concatenating them under deepMerge", () => {
    // A tenant that sets three nav items means three, not the platform's five plus three.
    expect(mergeValues("deepMerge", { nav: [1, 2, 3] }, { nav: [9] })).toEqual({ nav: [9] })
  })

  it("treats undefined as absent, not as an instruction to unset", () => {
    expect(mergeValues("deepMerge", { a: 1, b: 2 }, { b: undefined })).toEqual({ a: 1, b: 2 })
  })

  it("unions in a stable order with duplicates dropped", () => {
    expect(mergeValues("unionSet", ["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"])
  })

  it("compares set members by content, not identity", () => {
    expect(mergeValues("unionSet", [{ x: 1 }], [{ x: 1 }])).toEqual([{ x: 1 }])
    expect(mergeValues("intersectSet", [{ x: 1 }, { y: 2 }], [{ x: 1 }])).toEqual([{ x: 1 }])
  })

  it("refuses a strategy applied to the wrong shape instead of coercing", () => {
    expect(() => mergeValues("min", "10", 5)).toThrow(/needs two numbers/)
    expect(() => mergeValues("and", 1, true)).toThrow(/needs two booleans/)
    expect(() => mergeValues("unionSet", "ab", ["c"])).toThrow(/needs two arrays/)
  })
})

// ── versioning ──────────────────────────────────────────────────────────────

describe("a published configuration is immutable and citable", () => {
  const AT = "2026-07-31T12:00:00.000Z"
  const layers = [layer("tenant", "rochester", { "platform.terminology.staffOffice": "Ainslie OSE" })]
  const config = resolveConfigOrThrow(REGISTRY, layers)

  const v1 = publish({
    tenantId: "rochester",
    config,
    layers,
    publishedBy: "user_ose_director",
    note: "Name the staff office as the institution says it.",
    publishedAt: AT,
    previous: null,
  })

  it("records what it was, who published it, and what it replaced", () => {
    expect(v1.revision).toBe(1)
    expect(v1.state).toBe("published")
    expect(v1.supersedes).toBeNull()
    expect(v1.checksum).toBe(config.checksum)
    expect(v1.versionId).toBe("rochester@1")
    expect(Object.isFrozen(v1)).toBe(true)
  })

  it("refuses a publication that changes nothing", () => {
    // Otherwise "which revision introduced this?" stops having one answer.
    expect(() =>
      publish({ ...{ tenantId: "rochester", config, layers, publishedBy: "u", note: "again", publishedAt: AT }, previous: v1 }),
    ).toThrow(/Nothing changed/)
  })

  it("requires a note, an actor and a tenant", () => {
    const base = { tenantId: "rochester", config, layers, publishedBy: "u", note: "n", publishedAt: AT }
    expect(() => publish({ ...base, note: "   " })).toThrow(ConfigVersionError)
    expect(() => publish({ ...base, publishedBy: "" })).toThrow(/no actor/)
    expect(() => publish({ ...base, tenantId: "" })).toThrow(/no tenant/)
  })

  it("refuses to follow another tenant's version", () => {
    const foreign = { ...v1, tenantId: "midtown-arts" }
    expect(() =>
      publish({
        tenantId: "rochester",
        config,
        layers,
        publishedBy: "u",
        note: "n",
        publishedAt: AT,
        previous: foreign,
      }),
    ).toThrow(/belongs to tenant "midtown-arts"/)
  })

  it("supersedes without mutating the original", () => {
    const gone = supersede(v1)
    expect(gone.state).toBe("superseded")
    expect(v1.state).toBe("published")
  })

  it("diffs two revisions per key, which is what an approver reads", () => {
    const layers2 = [
      layer("tenant", "rochester", {
        "platform.terminology.staffOffice": "Office of Student Engagement",
        "platform.retention.days": 200,
      }),
    ]
    const v2 = publish({
      tenantId: "rochester",
      config: resolveConfigOrThrow(REGISTRY, layers2),
      layers: layers2,
      publishedBy: "u",
      note: "Longer name, shorter retention.",
      publishedAt: AT,
      previous: v1,
    })

    expect(v2.revision).toBe(2)
    expect(v2.supersedes).toBe(1)
    expect(diffVersions(v1, v2)).toEqual([
      { key: "platform.retention.days", change: "changed", before: 365, after: 200 },
      {
        key: "platform.terminology.staffOffice",
        change: "changed",
        before: "Ainslie OSE",
        after: "Office of Student Engagement",
      },
    ])
  })
})
