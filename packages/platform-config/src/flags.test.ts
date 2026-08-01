import { BLUEPRINTS, TENANT_BINDINGS } from "@tenure/blueprints"
import {
  ConfigRegistry,
  resolveConfig,
  resolveConfigOrThrow,
  type ConfigLayer,
} from "@tenure/configuration"

import { PLATFORM_DEFINITIONS } from "./definitions"
import {
  FLAG_DEFINITIONS,
  FLAG_KILL_LIST_KEY,
  FLAG_NAMES,
  FlagDefinitionError,
  assertRestrictOnly,
  cohortBucket,
  decideFlag,
  flagEnabledKey,
  flagRolloutKey,
  type FlagName,
} from "./flags"
import { REGISTRY, layersFor } from "./resolve"

/**
 * The claim under test is a security one, so it is tested as a security claim:
 * not "the happy path works" but "no reachable input produces more than the
 * platform allows". A flag that can be talked into granting is a second
 * authorization system, and it would be one nobody audits.
 */

const FLAG: FlagName = "aiAssistant"

/** Resolve an arbitrary layer stack against the real platform registry. */
function resolve(layers: ConfigLayer[]) {
  return resolveConfigOrThrow(REGISTRY, layers)
}

const layer = (scope: ConfigLayer["scope"], id: string, values: Record<string, unknown>): ConfigLayer => ({
  scope,
  id,
  values,
})

/** A range of subject ids wide enough to land in every bucket. */
const SUBJECTS = Array.from({ length: 400 }, (_, i) => `user_${i}`)

describe("a flag may only restrict, never grant", () => {
  it("refuses at load any flag whose merge strategy could widen", () => {
    // The law is enforced in code, not just asserted in a comment — so the
    // enforcement itself has to be exercised. Every permissive strategy the
    // engine offers is rejected for a boolean flag.
    for (const strategy of ["or", "replace", "max", "unionSet", "deepMerge"] as const) {
      const forged = { ...FLAG_DEFINITIONS[0], mergeStrategy: strategy }
      expect(() => assertRestrictOnly([forged])).toThrow(FlagDefinitionError)
    }
    // …and the one that cannot is accepted.
    expect(() => assertRestrictOnly(FLAG_DEFINITIONS)).not.toThrow()
  })

  it("refuses a flag tied to a capability", () => {
    const forged = { ...FLAG_DEFINITIONS[0], requiresCapability: "administration.access" }
    expect(() => assertRestrictOnly([forged])).toThrow(/requiresCapability/)
  })

  it("refuses a flag key whose shape has no proven merge direction", () => {
    const forged = { ...FLAG_DEFINITIONS[0], key: "platform.flags.aiAssistant.mode" }
    expect(() => assertRestrictOnly([forged])).toThrow(/not one of the flag shapes/)
  })

  it("refuses a flag nothing could ever turn off", () => {
    const forged = { ...FLAG_DEFINITIONS[0], overridable: false }
    expect(() => assertRestrictOnly([forged])).toThrow(/not overridable/)
  })

  it("cannot be granted from any layer, for any subject, once a layer says no", () => {
    // The end-to-end proof. Every layer below the platform tries every way it
    // has of saying "yes" — enabled true, rollout wide open, kill list emptied —
    // on top of a layer that already said no. None of them wins.
    const grantAttempts: Record<string, unknown>[] = [
      { [flagEnabledKey(FLAG)]: true },
      { [flagRolloutKey(FLAG)]: 100 },
      { [FLAG_KILL_LIST_KEY]: [] },
      {
        [flagEnabledKey(FLAG)]: true,
        [flagRolloutKey(FLAG)]: 100,
        [FLAG_KILL_LIST_KEY]: [],
      },
    ]

    const denials: Record<string, unknown>[] = [
      { [flagEnabledKey(FLAG)]: false },
      { [flagRolloutKey(FLAG)]: 0 },
      { [FLAG_KILL_LIST_KEY]: [FLAG] },
    ]

    for (const denial of denials) {
      for (const attempt of grantAttempts) {
        const config = resolve([
          layer("blueprint", "b", denial),
          layer("tenant", "t", attempt),
        ])
        for (const subject of SUBJECTS) {
          expect(decideFlag(config, FLAG, subject).enabled).toBe(false)
        }
      }
    }
  })

  it("cannot be widened beyond the platform default by any layer stack", () => {
    // Same claim from the other end: with nothing denied anywhere, the resolved
    // decision must still be exactly what the platform ships, never more.
    const platformOnly = resolve([])
    const wideOpen = resolve([
      layer("blueprint", "b", {
        [flagEnabledKey(FLAG)]: true,
        [flagRolloutKey(FLAG)]: 100,
        [FLAG_KILL_LIST_KEY]: [],
      }),
      layer("tenant", "t", {
        [flagEnabledKey(FLAG)]: true,
        [flagRolloutKey(FLAG)]: 100,
        [FLAG_KILL_LIST_KEY]: [],
      }),
    ])

    for (const subject of SUBJECTS) {
      expect(decideFlag(wideOpen, FLAG, subject).enabled).toBe(
        decideFlag(platformOnly, FLAG, subject).enabled,
      )
    }
  })

  it("declares every flag at a scope some layer actually writes", () => {
    // A scope no writer can reach is a promise, not a control. resolve.ts
    // supplies blueprint and tenant; nothing supplies the rest yet.
    const written = new Set(["blueprint", "tenant"])
    for (const def of FLAG_DEFINITIONS) {
      expect(def.allowedScopes.length).toBeGreaterThan(0)
      for (const scope of def.allowedScopes) expect(written.has(scope)).toBe(true)
    }
  })
})

describe("the emergency kill switch", () => {
  it("stops the flag when a tenant names it", () => {
    const config = resolve([layer("tenant", "t", { [FLAG_KILL_LIST_KEY]: [FLAG] })])
    const decision = decideFlag(config, FLAG, "user_1")
    expect(decision.enabled).toBe(false)
    expect(decision.reason).toBe("killed")
  })

  it("cannot be revoked by a lower-precedence layer, because the list unions", () => {
    const config = resolve([
      layer("blueprint", "b", { [FLAG_KILL_LIST_KEY]: [FLAG] }),
      layer("tenant", "t", { [FLAG_KILL_LIST_KEY]: ["somethingElse"] }),
    ])
    expect(config.get<string[]>(FLAG_KILL_LIST_KEY)).toEqual([FLAG, "somethingElse"])
    expect(decideFlag(config, FLAG, "user_1").enabled).toBe(false)
  })

  it("outranks a deliberate switch-off in the reason it reports", () => {
    // Both produce false. Which one a human is told decides whether they go
    // looking for an incident or for a setting.
    const config = resolve([
      layer("tenant", "t", { [flagEnabledKey(FLAG)]: false, [FLAG_KILL_LIST_KEY]: [FLAG] }),
    ])
    expect(decideFlag(config, FLAG, "user_1").reason).toBe("killed")
  })

  it("tolerates an entry naming a flag that does not exist", () => {
    // Strict validation here would turn a stale kill entry into a 500 on every
    // page for that tenant. Killing nothing is harmless; an outage is not.
    const config = resolve([layer("tenant", "t", { [FLAG_KILL_LIST_KEY]: ["aFlagWeDeleted"] })])
    expect(decideFlag(config, FLAG, "user_1").enabled).toBe(true)
  })

  it("still refuses a kill list that is not a list of strings", () => {
    // Lenient about which names, not about the shape.
    const { problems } = resolveConfig(
      REGISTRY,
      [layer("tenant", "t", { [FLAG_KILL_LIST_KEY]: "aiAssistant" })],
      { collectProblems: true },
    )
    expect(problems.map((p) => p.reason)).toEqual(["invalid-value"])
  })
})

describe("cohort rollout", () => {
  it("is deterministic — the same subject gets the same bucket every time", () => {
    for (const subject of SUBJECTS.slice(0, 20)) {
      const first = cohortBucket(FLAG, subject)
      expect(cohortBucket(FLAG, subject)).toBe(first)
      expect(cohortBucket(FLAG, subject)).toBe(first)
    }
  })

  it("pins exact buckets, so a hash change cannot silently reshuffle everyone", () => {
    // A rollout that quietly re-randomises on deploy is worse than no rollout:
    // the 10% who had the feature yesterday lose it today. These are the real
    // outputs of the shipped hash.
    expect(cohortBucket(FLAG, "user_0")).toBe(cohortBucket(FLAG, "user_0"))
    expect([
      cohortBucket(FLAG, "user_0"),
      cohortBucket(FLAG, "user_1"),
      cohortBucket(FLAG, "user_2"),
    ]).toEqual([69, 46, 27])
  })

  it("puts the same subject in a different bucket for a different flag", () => {
    const differs = SUBJECTS.slice(0, 50).filter(
      (s) => cohortBucket(FLAG, s) !== cohortBucket("someOtherFlag", s),
    )
    // Two flags at 10% must not roll out to the same 10% of people.
    expect(differs.length).toBeGreaterThan(40)
  })

  it("spreads subjects across the range rather than clumping", () => {
    const buckets = SUBJECTS.map((s) => cohortBucket(FLAG, s))
    expect(Math.min(...buckets)).toBeLessThan(5)
    expect(Math.max(...buckets)).toBeGreaterThan(94)
    expect(new Set(buckets).size).toBeGreaterThan(80)
  })

  it("admits a subset when the percentage falls — never a different set", () => {
    // Monotonicity is what makes a rollout a rollout. If lowering the dial let
    // someone in who was previously out, "10% then 25%" would be two disjoint
    // experiments rather than one widening one.
    const admitted = (percent: number) => {
      const config = resolve([layer("tenant", "t", { [flagRolloutKey(FLAG)]: percent })])
      return new Set(SUBJECTS.filter((s) => decideFlag(config, FLAG, s).enabled))
    }

    const at10 = admitted(10)
    const at25 = admitted(25)
    const at100 = admitted(100)

    expect(at10.size).toBeGreaterThan(0)
    expect(at10.size).toBeLessThan(at25.size)
    for (const s of at10) expect(at25.has(s)).toBe(true)
    for (const s of at25) expect(at100.has(s)).toBe(true)
    expect(at100.size).toBe(SUBJECTS.length)
  })

  it("admits nobody at 0 and everybody at 100", () => {
    const none = resolve([layer("tenant", "t", { [flagRolloutKey(FLAG)]: 0 })])
    const all = resolve([layer("tenant", "t", { [flagRolloutKey(FLAG)]: 100 })])
    expect(SUBJECTS.every((s) => !decideFlag(none, FLAG, s).enabled)).toBe(true)
    expect(SUBJECTS.every((s) => decideFlag(all, FLAG, s).enabled)).toBe(true)
  })

  it("lets a tenant shrink the blueprint's cohort and not grow it", () => {
    const shrunk = resolve([
      layer("blueprint", "b", { [flagRolloutKey(FLAG)]: 50 }),
      layer("tenant", "t", { [flagRolloutKey(FLAG)]: 10 }),
    ])
    expect(shrunk.get<number>(flagRolloutKey(FLAG))).toBe(10)

    const grown = resolve([
      layer("blueprint", "b", { [flagRolloutKey(FLAG)]: 10 }),
      layer("tenant", "t", { [flagRolloutKey(FLAG)]: 50 }),
    ])
    expect(grown.get<number>(flagRolloutKey(FLAG))).toBe(10)
  })

  it("reports why a subject is out, and it is not the same reason as off", () => {
    const config = resolve([layer("tenant", "t", { [flagRolloutKey(FLAG)]: 10 })])
    const out = SUBJECTS.find((s) => !decideFlag(config, FLAG, s).enabled)!
    expect(decideFlag(config, FLAG, out).reason).toBe("outsideCohort")
    expect(decideFlag(config, FLAG, out).bucket).toBeGreaterThanOrEqual(10)
  })

  it("fails closed for a subject with no id, but only where a cohort was asked for", () => {
    const partial = resolve([layer("tenant", "t", { [flagRolloutKey(FLAG)]: 50 })])
    expect(decideFlag(partial, FLAG, "").enabled).toBe(false)
    expect(decideFlag(partial, FLAG, "").reason).toBe("unidentifiedSubject")

    // 100% admits everyone by definition, so an unidentified subject is not a
    // reason to withhold anything there.
    expect(decideFlag(resolve([]), FLAG, "").enabled).toBe(true)
  })
})

describe("flags resolve for the institutions the platform actually ships", () => {
  it("gives the pilot the assistant, because nothing has turned it off", () => {
    const decision = decideFlag(resolveConfigOrThrow(REGISTRY, layersFor("rochester")), FLAG, "u1")
    expect(decision.enabled).toBe(true)
    expect(decision.reason).toBe("enabled")
  })

  it("keeps every kill-list entry in every shipped blueprint and binding naming a real flag", () => {
    // The typo the lenient schema deliberately does not catch at runtime, caught
    // here instead — where it costs a red CI run rather than a tenant outage.
    const names = new Set<string>(FLAG_NAMES)
    const sources = [
      ...BLUEPRINTS.map((b) => [b.id, b.values] as const),
      ...TENANT_BINDINGS.map((t) => [t.slug, t.values] as const),
    ]
    for (const [id, values] of sources) {
      const killList = values[FLAG_KILL_LIST_KEY]
      if (killList === undefined) continue
      expect(Array.isArray(killList)).toBe(true)
      const unknown = (killList as unknown[]).filter((e) => !names.has(String(e)))
      // Named in the expectation so a failure says which overlay and which entry.
      expect({ source: id, unknownFlags: unknown }).toEqual({ source: id, unknownFlags: [] })
    }
  })

  it("declares no flag without a key in the platform registry", () => {
    for (const flag of FLAG_NAMES) {
      expect(REGISTRY.has(flagEnabledKey(flag))).toBe(true)
      expect(REGISTRY.has(flagRolloutKey(flag))).toBe(true)
    }
    expect(REGISTRY.has(FLAG_KILL_LIST_KEY)).toBe(true)
  })

  it("keeps the flag keys inside the same registry as everything else", () => {
    // One resolution, one checksum, one provenance trace. A separate flag store
    // would be a second precedence system.
    const built = ConfigRegistry.of(PLATFORM_DEFINITIONS)
    for (const def of FLAG_DEFINITIONS) expect(built.has(def.key)).toBe(true)
  })

  it("attributes a switched-off flag to the layer that switched it off", () => {
    const config = resolve([layer("tenant", "t", { [flagEnabledKey(FLAG)]: false })])
    const why = config.explain(flagEnabledKey(FLAG))
    expect(why.contributors.map((c) => `${c.scope}:${c.value}`)).toEqual(["tenant:false"])
    expect(decideFlag(config, FLAG, "u1").reason).toBe("turnedOff")
  })
})
