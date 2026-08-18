import { z } from "zod"

import { PAYMENT_MODE_CONFIG_KEY } from "@tenure/contracts"
import { MODULES } from "@tenure/modules"
import { REGISTRY } from "@tenure/platform-config"

import { ConfigRegistry, defineConfig, type ConfigDefinition } from "./definition"
import { compileGraph, evaluateGraph, presentationProjection } from "./graph-snapshot"
import { resolveVersionedLayers } from "./layer-bridge"
import { requiresApproval, type VersionedLayer } from "./layer-schema"
import { planPublication } from "./publication"
import {
  capabilityPath,
  changedNodes,
  registryGraphInput,
  registryInputs,
} from "./registry-graph"

/**
 * CFG-020-004 / CFG-030-003 / CFG-030-005.
 *
 * The graph compiler was reached by production and compiled NOTHING: the module
 * catalogue declares dependencies, not configuration nodes, so the live snapshot
 * had zero nodes, zero rules and an evaluation that could only be empty. These
 * tests are about the bridge that gives it nodes and about what the publication
 * path then does with them — evaluate incrementally, project the client-safe
 * half, and produce an output digest that replays.
 *
 * The live `REGISTRY` and `MODULES` are used deliberately wherever the assertion
 * is about production shape. A bridge that has only met fixtures has not met its
 * data, and the one key in the live registry that CANNOT become a node is the
 * most valuable case in the file.
 */

const NOW = new Date("2026-08-02T00:00:00Z")
const LATER = new Date("2026-08-03T00:00:00Z")

const price = {
  perSeatMinor: 0,
  perOrgMinor: 0,
  currency: "USD",
  rounding: "half-up",
  includedBecause: "A test fixture, priced at nothing so the arithmetic under test is the test's own.",
} as const

function definition(over: Partial<ConfigDefinition> & { key: string }): ConfigDefinition {
  return defineConfig({
    price,
    owner: "platform",
    type: z.string(),
    default: "",
    allowedScopes: ["blueprint", "tenant"],
    mergeStrategy: "replace",
    sensitivity: "internal",
    overridable: true,
    description: "A fixture definition.",
    ...over,
  } as ConfigDefinition)
}

/** The module shape the Studio passes to `planPublication`. */
const publicationModules = MODULES.map((m) => ({
  key: m.key,
  version: m.version,
  dependsOn: m.dependsOn,
  provides: m.provides,
  entitlement: m.requiresEntitlement,
}))

function layer(values: Record<string, unknown>, id = "acme"): VersionedLayer {
  const kind: VersionedLayer["kind"] = "tenantOverlay"
  return {
    kind,
    id,
    values,
    metadata: {
      version: 1,
      schemaVersion: "1.0.0",
      signer: "arn:aws:kms:us-east-1:000000000000:key/test",
      origin: "registry-graph.test.ts",
      compatibility: { minEngine: "2026.7.0", maxEngine: null },
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      effectiveUntil: null,
      changeReason: "a reason long enough to be a reason",
      approvedBy: requiresApproval(kind) ? "operator:approver" : null,
    },
  }
}

function resolved(layers: readonly VersionedLayer[]): Readonly<Record<string, unknown>> {
  const result = resolveVersionedLayers(REGISTRY, layers, LATER, { collectProblems: true })
  if (!result.config) throw new Error("fixture does not resolve")
  return result.config.values
}

const CURRENT = resolved([layer({ "platform.terminology.staffOfficeName": "Student Life" }, "acme-baseline")])

const plan = (over: Partial<Parameters<typeof planPublication>[0]> = {}) =>
  planPublication({
    registry: REGISTRY,
    current: { values: CURRENT, revision: 4 },
    proposed: [layer({ "platform.terminology.staffOfficeName": "Office of Student Belonging" })],
    publishedBy: "operator:publisher",
    activateAt: LATER,
    now: NOW,
    modules: publicationModules,
    enabledModules: [],
    entitlements: [],
    ...over,
  })

describe("the registry becomes graph nodes", () => {
  it("declares a node for every representable key in the LIVE registry", () => {
    const input = registryGraphInput(REGISTRY, publicationModules, { liveModeKey: PAYMENT_MODE_CONFIG_KEY })
    const representable = REGISTRY.all().filter((d) => {
      const t = typeof d.default
      return t === "string" || t === "number" || t === "boolean" || d.default === null
    })
    expect(input.declaredKeys).toEqual(representable.map((d) => d.key).sort())
    expect(input.declaredKeys.length).toBeGreaterThan(0)
  })

  it("names the key it cannot represent, and why, instead of dropping it", () => {
    // `platform.payments.approvalThresholds` defaults to `{ USD: 500000 }`. The
    // graph types a node as one of four scalars, so it has no node — and a
    // silent omission would leave a reviewer reading an evaluation over nine of
    // ten keys with no way to tell the tenth was missing from unaffected.
    const input = registryGraphInput(REGISTRY, publicationModules, { liveModeKey: PAYMENT_MODE_CONFIG_KEY })
    const named = input.unrepresentable.find((u) => u.key === "platform.payments.approvalThresholds")
    expect(named).toBeDefined()
    expect(named!.reason).toContain("an object")
    expect(input.declaredKeys).not.toContain("platform.payments.approvalThresholds")
  })

  it("compiles the live registry over the live catalogue with no problems", () => {
    const input = registryGraphInput(REGISTRY, publicationModules, { liveModeKey: PAYMENT_MODE_CONFIG_KEY })
    const snapshot = compileGraph({
      packages: input.packages,
      enabled: [],
      contextTypes: input.contextTypes,
    })
    expect(snapshot.problems).toEqual([])
    expect(snapshot.publishable).toBe(true)
    expect(snapshot.nodes.map((n) => n.id).sort()).toEqual([...input.declaredKeys])
    // The owner of every registry key is `platform`, which is not a module, so
    // the closure is the catalogue plus one synthesised package.
    expect(snapshot.packages.length).toBe(MODULES.length + 1)
  })

  it("derives an enablement rule from requiresCapability, reading a declared context path", () => {
    const input = registryGraphInput(REGISTRY, publicationModules, { liveModeKey: PAYMENT_MODE_CONFIG_KEY })
    const gated = REGISTRY.all().filter((d) => d.requiresCapability && d.overridable)
    expect(gated.length).toBeGreaterThan(0)
    for (const def of gated) {
      if (!input.declaredKeys.includes(def.key)) continue
      const node = input.packages.flatMap((p) => p.declares ?? []).find((n) => n.id === def.key)
      const path = capabilityPath(def.requiresCapability!)
      expect(node?.rules?.enabledWhen).toBe(`${path} == true`)
      expect(input.contextTypes[path]).toBe("boolean")
    }
  })

  it("derives an applicability rule from liveOnly, against the mode key", () => {
    const input = registryGraphInput(REGISTRY, publicationModules, { liveModeKey: PAYMENT_MODE_CONFIG_KEY })
    const liveOnly = REGISTRY.all().filter((d) => d.liveOnly && input.declaredKeys.includes(d.key))
    expect(liveOnly.length).toBeGreaterThan(0)
    for (const def of liveOnly) {
      const node = input.packages.flatMap((p) => p.declares ?? []).find((n) => n.id === def.key)
      expect(node?.rules?.applicableWhen).toBe(`${PAYMENT_MODE_CONFIG_KEY} == "live"`)
    }
  })

  it("pins a key that may not be overridden, rather than rendering it editable", () => {
    const registry = ConfigRegistry.of([definition({ key: "platform.pinned", overridable: false })])
    const input = registryGraphInput(registry)
    const node = input.packages.flatMap((p) => p.declares ?? []).find((n) => n.id === "platform.pinned")
    expect(node?.rules?.enabledWhen).toBe("false")
  })

  it("refuses to derive a live-only rule across namespaces, and says so", () => {
    // A rule reading outside its package's closure is refused by the compiler,
    // so emitting one would block EVERY publication rather than leave one field
    // without an applicability rule.
    const registry = ConfigRegistry.of([
      definition({ key: "budgeting.threshold", owner: "budgeting", liveOnly: true }),
    ])
    const input = registryGraphInput(registry, [{ key: "budgeting" }], { liveModeKey: PAYMENT_MODE_CONFIG_KEY })
    const node = input.packages.flatMap((p) => p.declares ?? []).find((n) => n.id === "budgeting.threshold")
    expect(node?.rules?.applicableWhen).toBeUndefined()
    expect(input.unrepresentable.map((u) => u.reason).join(" ")).toContain("live-only")
    const snapshot = compileGraph({ packages: input.packages, contextTypes: input.contextTypes })
    expect(snapshot.problems).toEqual([])
  })

  it("does not re-check namespacing, because the registry cannot hold a key that breaks it", () => {
    // This module declares every key under its owner's namespace and does NOT
    // guard against one that is not. The guarantee is real and it lives one
    // level down: `ConfigRegistry.of` refuses the definition outright. Pinned
    // here so that a change loosening it shows up as a failure in the file that
    // depends on it.
    expect(() =>
      ConfigRegistry.of([{ ...definition({ key: "platform.x" }), key: "finance.y" } as ConfigDefinition]),
    ).toThrow(/namespaced under/)
  })

  it("leaves the enablement rule underived when a capability name is not a readable path", () => {
    const registry = ConfigRegistry.of([
      definition({ key: "platform.gated", requiresCapability: "payments-mode.publish" }),
    ])
    const input = registryGraphInput(registry)
    const node = input.packages.flatMap((p) => p.declares ?? []).find((n) => n.id === "platform.gated")
    expect(node).toBeDefined()
    expect(node!.rules?.enabledWhen).toBeUndefined()
    expect(input.unrepresentable.find((u) => u.key === "platform.gated")?.reason).toContain(
      "not a readable expression path",
    )
    // The node still exists. A capability whose name cannot be expressed costs
    // the rule, not the field.
    expect(input.declaredKeys).toContain("platform.gated")
  })
})

describe("the inputs one evaluation is given", () => {
  const input = registryGraphInput(REGISTRY, publicationModules, { liveModeKey: PAYMENT_MODE_CONFIG_KEY })

  it("carries only keys that became nodes", () => {
    const inputs = registryInputs(input, { ...CURRENT, "not.a.key": 1 }, [])
    expect(Object.keys(inputs)).not.toContain("not.a.key")
    expect(Object.keys(inputs)).not.toContain("platform.payments.approvalThresholds")
    expect(inputs["platform.terminology.staffOfficeName"]).toBe("Student Life")
  })

  it("supplies every capability path as false rather than leaving it absent", () => {
    // Absent is not false. An absent path makes its rule fail to evaluate, and a
    // failed rule is recorded as an error rather than as a decision — so an
    // operator with no capabilities would see errors where they should see
    // disabled fields.
    const inputs = registryInputs(input, CURRENT, [])
    for (const path of Object.keys(input.contextTypes)) {
      expect(inputs[path]).toBe(false)
    }
    const held = registryInputs(input, CURRENT, ["payments.mode.publish"])
    expect(held[capabilityPath("payments.mode.publish")]).toBe(true)
  })

  it("restricts a changed key list to nodes the graph has", () => {
    expect(changedNodes(input, ["platform.payments.approvalThresholds", "platform.payments.mode"])).toEqual([
      "platform.payments.mode",
    ])
  })
})

describe("the publication path evaluates the graph it compiled", () => {
  it("returns a server-authoritative evaluation bound to the snapshot it came from", () => {
    const p = plan()
    expect(p.graph).toBeDefined()
    expect(p.evaluationSkipped).toBeNull()
    expect(p.evaluation).not.toBeNull()
    expect(p.evaluation!.graphDigest).toBe(p.graph!.digest)
    expect(Object.keys(p.evaluation!.states).sort()).toEqual(p.graph!.nodes.map((n) => n.id).sort())
    expect(p.evaluation!.values["platform.terminology.staffOfficeName"]).toBe("Office of Student Belonging")
  })

  it("agrees with a full evaluation over the same inputs", () => {
    // The incremental path is the one production takes, so the equality has to
    // hold HERE and not only in the compiler's own unit tests. Correctness alone
    // would also pass for an evaluator that quietly recomputes everything, which
    // is why the next test counts the work.
    const p = plan()
    const input = registryGraphInput(REGISTRY, publicationModules, { liveModeKey: PAYMENT_MODE_CONFIG_KEY })
    const after = resolved([layer({ "platform.terminology.staffOfficeName": "Office of Student Belonging" })])
    const full = evaluateGraph(p.graph!, registryInputs(input, after, []))
    expect(p.evaluation!.outputDigest).toBe(full.outputDigest)
    expect(p.evaluation!.values).toEqual(full.values)
    expect(p.evaluation!.states).toEqual(full.states)
  })

  it("recomputes only what the change reached", () => {
    const p = plan()
    const recomputed = p.evaluation!.traces.filter((t) => !t.reused)
    const reused = p.evaluation!.traces.filter((t) => t.reused)
    // The changed key carries no rules, so nothing downstream of it recomputes,
    // and every rule in the graph is carried over. A full evaluation would have
    // recomputed all of them.
    expect(recomputed.length).toBe(0)
    expect(reused.length).toBeGreaterThan(0)
  })

  it("names the nodes a change moves, and no others", () => {
    const p = plan()
    expect(p.nodesAffected).toEqual(["platform.terminology.staffOfficeName"])
  })

  it("names a node whose STATE moved even though its value did not", () => {
    // The capability the publisher holds decides an `enabledWhen`. Publishing
    // the same values with different capabilities moves no value at all, and
    // the field's enablement still changes — which is exactly the consequence a
    // diff cannot show.
    const withoutCapability = plan()
    const withCapability = plan({ publisherCapabilities: ["payments.mode.publish"] })
    expect(withoutCapability.evaluation!.states[PAYMENT_MODE_CONFIG_KEY].enabled).toBe(false)
    expect(withCapability.evaluation!.states[PAYMENT_MODE_CONFIG_KEY].enabled).toBe(true)
  })

  it("carries every registry key it could not represent onto the plan", () => {
    const p = plan()
    expect(p.unrepresentableKeys!.map((u) => u.key)).toContain("platform.payments.approvalThresholds")
  })

  it("says why there is no evaluation when the graph did not compile", () => {
    const p = plan({
      // A module depending on something no module provides: the compile fails,
      // so there is nothing to evaluate and the plan must say so rather than
      // returning an empty evaluation that reads like a clean one.
      modules: [...publicationModules, { key: "ghost", dependsOn: [{ module: "nothing-provides-this" }] }],
    })
    expect(p.evaluation).toBeNull()
    expect(p.evaluationSkipped).toContain("did not compile")
    expect(p.blocked).toBe(true)
  })
})

describe("one snapshot, two projections", () => {
  it("projects the client-safe half of the same snapshot the server evaluated", () => {
    const p = plan()
    expect(p.presentation).not.toBeNull()
    expect(p.presentation!.graphDigest).toBe(p.graph!.digest)
    expect(p.presentation!.serverOnlySlots).toEqual(["applicableWhen", "deriveFrom", "validateWhen"])
    for (const node of p.presentation!.nodes) {
      expect(node.rules.validateWhen).toBeUndefined()
      expect(node.rules.applicableWhen).toBeUndefined()
      expect(node.rules.deriveFrom).toBeUndefined()
    }
    // The enablement rule IS presentation, and it crosses.
    const mode = p.presentation!.nodes.find((n) => n.id === PAYMENT_MODE_CONFIG_KEY)
    expect(mode?.rules.enabledWhen).toBe(`${capabilityPath("payments.mode.publish")} == true`)
  })

  it("keeps the server-authoritative applicability rule off the client", () => {
    const p = plan()
    const liveOnly = REGISTRY.all().find((d) => d.liveOnly)!
    const server = p.graph!.nodes.find((n) => n.id === liveOnly.key)
    expect(server?.rules.applicableWhen).toBe(`${PAYMENT_MODE_CONFIG_KEY} == "live"`)
    const client = p.presentation!.nodes.find((n) => n.id === liveOnly.key)
    expect(client).toBeDefined()
    expect(client!.rules.applicableWhen).toBeUndefined()
  })

  it("withholds a confidential registry key, and names it", () => {
    const registry = ConfigRegistry.of([
      definition({ key: "platform.public", sensitivity: "public" }),
      definition({ key: "platform.secret", sensitivity: "confidential" }),
    ])
    const input = registryGraphInput(registry)
    const snapshot = compileGraph({ packages: input.packages, contextTypes: input.contextTypes })
    const projection = presentationProjection(snapshot)
    expect(projection.nodes.map((n) => n.id)).toEqual(["platform.public"])
    expect(projection.withheld).toEqual([{ id: "platform.secret", reason: "declared confidential" }])
  })
})

describe("the live registry's applicability agrees with the publication blocker", () => {
  // One flag — `definition.liveOnly` — decides both. The blocker refuses the
  // publication; the rule says the field is inapplicable. Two surfaces reading
  // one source of truth, pinned so they cannot drift apart silently.
  const liveOnlyKey = REGISTRY.all().find((d) => d.liveOnly)!.key
  const input = registryGraphInput(REGISTRY, publicationModules, { liveModeKey: PAYMENT_MODE_CONFIG_KEY })
  const snapshot = compileGraph({
    packages: input.packages,
    contextTypes: input.contextTypes,
  })

  const applicableWhenModeIs = (mode: string) => {
    const evaluation = evaluateGraph(
      snapshot,
      registryInputs(input, { ...CURRENT, [PAYMENT_MODE_CONFIG_KEY]: mode }, []),
    )
    return evaluation.states[liveOnlyKey].applicable
  }

  const blockedWhenModeIs = (mode: string) => {
    const p = plan({
      current: { values: { ...CURRENT, [PAYMENT_MODE_CONFIG_KEY]: mode }, revision: 4 },
      proposed: [layer({ [liveOnlyKey]: "entity-1" })],
      publisherCapabilities: [REGISTRY.get(liveOnlyKey)!.requiresCapability!],
    })
    return p.blockers.some((b) => b.includes("only means anything in live mode"))
  }

  it("marks a live-only field inapplicable in test mode, which is when publishing it is blocked", () => {
    expect(applicableWhenModeIs("test")).toBe(false)
    expect(blockedWhenModeIs("test")).toBe(true)
  })

  it("marks it applicable in live mode, which is when publishing it is allowed", () => {
    expect(applicableWhenModeIs("live")).toBe(true)
    expect(blockedWhenModeIs("live")).toBe(false)
  })
})

describe("identical inputs and versions replay to identical outputs", () => {
  it("produces the same output digest twice over the same configuration", () => {
    expect(plan().evaluation!.outputDigest).toBe(plan().evaluation!.outputDigest)
    expect(plan().graph!.digest).toBe(plan().graph!.digest)
  })

  it("produces a DIFFERENT digest when a package version changes and nothing else does", () => {
    // The half the previous attempt could not prove on the shipped path: the
    // Studio dropped `version` when it built its module list, so every package
    // resolved unversioned and republishing the same declarations under a new
    // version produced an identical digest. It carries `version` now.
    const bumped = publicationModules.map((m) => (m.key === "budgeting" ? { ...m, version: "2.0.0" } : m))
    const a = plan()
    const b = plan({ modules: bumped })
    expect(a.graph!.digest).not.toBe(b.graph!.digest)
    expect(a.evaluation!.outputDigest).not.toBe(b.evaluation!.outputDigest)
    expect(a.evaluation!.values).toEqual(b.evaluation!.values)
  })

  it("names no package as unversioned except the registry's own", () => {
    // A registry is not a released package: it has no version, and the snapshot
    // says so rather than digesting it as though it were versioned.
    expect([...plan().graph!.unversionedPackages]).toEqual(["platform"])
  })

  it("digests a fixed graph to a value pinned in this file, not to itself", () => {
    // "Canonical" means the same answer in another process, on another machine,
    // in another week — not merely the same answer twice in this one. A literal
    // is the only assertion that can fail when the serialisation changes.
    const registry = ConfigRegistry.of([
      definition({ key: "platform.alpha", sensitivity: "public" }),
      definition({ key: "platform.beta", default: "b", overridable: false }),
    ])
    const input = registryGraphInput(registry)
    const snapshot = compileGraph({ packages: input.packages })
    expect(snapshot.digest).toBe("sha256:485707561e6aed45b58ac60500b2c8f8fff9804b4b0d427d9e414dad0c129f19")
    const evaluation = evaluateGraph(snapshot, registryInputs(input, { "platform.alpha": "a" }))
    expect(evaluation.outputDigest).toBe("sha256:161af37db129b04cc32154a4ac4376a86214b56fc213ea303f402b9deca73830")
  })
})
