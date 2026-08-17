import { z } from "zod"

import { MODULES } from "@tenure/modules"

import { ConfigRegistry, defineConfig } from "./definition"
import {
  GRAPH_COMPILER_VERSION,
  GraphCompilerError,
  compileGraph,
  evaluateGraph,
  graphSigningKeyFromEnv,
  presentationProjection,
  reevaluateGraph,
  signSnapshot,
  snapshotBlockers,
  verifySnapshot,
  type PackageManifest,
} from "./graph-snapshot"
import { requiresApproval, type VersionedLayer } from "./layer-schema"
import { planPublication } from "./publication"

/**
 * CFG-030 — the graph compiler, its evaluator and its two projections.
 *
 * Bible §11's ten steps, each tested by the thing that would go wrong if the
 * step were absent rather than by the step reporting itself. The two that carry
 * the most weight:
 *
 *   * `re-evaluating only the affected subgraph agrees with a full evaluation` —
 *     an incremental evaluator that is merely fast is a correctness bug with a
 *     benchmark, so the incremental result is compared against the full one over
 *     the same inputs, AND asserted to have done strictly less work. Either
 *     assertion alone passes for a broken implementation.
 *   * `withholds a node whose rules READ a protected value` — shipping the rule
 *     without the value looks safe. `salary > 100000` is a bisection oracle.
 */

const PACKAGES: readonly PackageManifest[] = [
  {
    key: "budgeting",
    version: "2.0.1",
    provides: ["finance.ledger"],
    declares: [{ id: "budgeting.cap", kind: "question", type: "number", defaultValue: 1_000 }],
  },
  {
    key: "payroll",
    version: "1.2.0",
    // Names a CAPABILITY, not a module key — the case a second dependency
    // resolver gets wrong.
    dependsOn: [{ module: "finance.ledger" }],
    declares: [
      { id: "payroll.seats", kind: "question", type: "number", defaultValue: 10, rules: { validateWhen: "payroll.seats > 0" } },
      { id: "payroll.rate", kind: "question", type: "number", defaultValue: 100 },
      { id: "payroll.subtotal", kind: "derived", type: "number", rules: { deriveFrom: "payroll.seats * payroll.rate" } },
      // Legal cross-namespace read: payroll depends on the capability budgeting provides.
      { id: "payroll.overCap", kind: "derived", type: "boolean", rules: { deriveFrom: "payroll.subtotal > budgeting.cap" } },
      {
        id: "payroll.approver",
        kind: "approval",
        type: "string",
        rules: { requiredWhen: "payroll.subtotal > 5000", visibleWhen: "payroll.subtotal > 0" },
      },
      { id: "payroll.salary", kind: "question", type: "number", sensitivity: "confidential", defaultValue: 250_000 },
      { id: "payroll.highEarner", kind: "derived", type: "boolean", rules: { deriveFrom: "payroll.salary > 100000" } },
      {
        id: "payroll.region",
        kind: "section",
        type: "boolean",
        defaultValue: true,
        rules: { visibleWhen: 'contains(context.jurisdiction, "US")' },
      },
    ],
  },
]

const CONTEXT = { "context.jurisdiction": "string" } as const

const compile = (over: Partial<Parameters<typeof compileGraph>[0]> = {}) =>
  compileGraph({ packages: PACKAGES, contextTypes: CONTEXT, ...over })

/** The same closure with `payroll` republished under a different version. */
const withVersion = (version: string): readonly PackageManifest[] => [PACKAGES[0], { ...PACKAGES[1], version }]

const INPUTS = { "context.jurisdiction": "US-NY" }

describe("step 1-2: packages, namespaces and stable identifiers", () => {
  it("compiles the closure with nothing wrong", () => {
    const snapshot = compile()
    expect(snapshot.problems).toEqual([])
    expect(snapshot.publishable).toBe(true)
    expect(snapshot.compilerVersion).toBe(GRAPH_COMPILER_VERSION)
    expect(snapshot.packages.map((p) => `${p.key}@${p.version}`)).toEqual(["budgeting@2.0.1", "payroll@1.2.0"])
    expect(snapshot.unversionedPackages).toEqual([])
  })

  it("digests the same closure identically whichever order the manifests arrived in", () => {
    // Two processes compiling the same packages must agree, or the digest an
    // approval is bound to means nothing.
    expect(compile({ packages: [...PACKAGES].reverse() }).digest).toBe(compile().digest)
  })

  it("changes the digest when a declaration changes", () => {
    const changed: readonly PackageManifest[] = [
      { ...PACKAGES[0], declares: [{ id: "budgeting.cap", kind: "question", type: "number", defaultValue: 2_000 }] },
      PACKAGES[1],
    ]
    expect(compile({ packages: changed }).digest).not.toBe(compile().digest)
  })

  it("changes the digest when only the version changes", () => {
    expect(compile({ packages: withVersion("1.2.1") }).digest).not.toBe(compile().digest)
  })

  it("names a package whose manifest states no version rather than digesting it as if versioned", () => {
    // The honest half of the digest claim: it detects a changed declaration, and
    // it cannot detect the same declarations republished under a new version.
    const stripped = PACKAGES.map(({ version: _version, ...rest }) => rest)
    const snapshot = compile({ packages: stripped })
    expect(snapshot.unversionedPackages).toEqual(["budgeting", "payroll"])
    expect(snapshot.packages.every((p) => p.version === null)).toBe(true)
  })

  it("refuses two manifests for one package key", () => {
    const snapshot = compile({ packages: [...PACKAGES, { key: "payroll", version: "9.9.9" }] })
    expect(snapshot.problems.map((p) => p.code)).toContain("duplicate-package")
    expect(snapshot.publishable).toBe(false)
  })

  it("refuses two packages declaring one identifier", () => {
    const snapshot = compile({
      packages: [
        ...PACKAGES,
        { key: "payroll2", namespace: "payroll", declares: [{ id: "payroll.seats", kind: "question", type: "number" }] },
      ],
    })
    const problem = snapshot.problems.find((p) => p.code === "duplicate-identifier")
    expect(problem?.at).toBe("payroll.seats")
    expect(problem?.step).toBe(2)
  })

  it("refuses a package declaring an identifier outside its own namespace", () => {
    const snapshot = compile({
      packages: [...PACKAGES, { key: "rogue", declares: [{ id: "payroll.injected", kind: "question", type: "number" }] }],
    })
    const problem = snapshot.problems.find((p) => p.code === "namespace-escape")
    expect(problem?.at).toBe("payroll.injected")
    expect(problem?.detail).toMatch(/not under its namespace "rogue"/)
  })
})

describe("step 3-5: types, dependencies and bounds", () => {
  it("refuses a rule that reads outside its package closure", () => {
    // CFG-020-005's namespace escape. `rogue` does not depend on `payroll`.
    const snapshot = compile({
      packages: [
        ...PACKAGES,
        { key: "rogue", declares: [{ id: "rogue.peek", kind: "derived", type: "boolean", rules: { deriveFrom: "payroll.seats > 1" } }] },
      ],
    })
    const problem = snapshot.problems.find((p) => p.code === "cross-namespace-reference")
    expect(problem?.at).toBe("rogue.peek.deriveFrom")
    expect(problem?.detail).toMatch(/escaped its namespace/)
  })

  it("permits a cross-namespace read the manifest depends on", () => {
    // `payroll.overCap` reads `budgeting.cap` and payroll depends on the
    // capability budgeting provides. Refusing this would mean the closure exists
    // and cannot be used.
    expect(compile().problems.filter((p) => p.code === "cross-namespace-reference")).toEqual([])
  })

  it("refuses a rule whose result is the wrong type for its slot", () => {
    const snapshot = compile({
      packages: [
        ...PACKAGES,
        { key: "typo", declares: [{ id: "typo.a", kind: "question", type: "number", rules: { visibleWhen: "1 + 1" } }] },
      ],
    })
    const problem = snapshot.problems.find((p) => p.at === "typo.a.visibleWhen")
    expect(problem?.code).toBe("type-error")
    expect(problem?.detail).toMatch(/produces a number; the slot requires a boolean/)
  })

  it("refuses a deriveFrom that does not produce the node's declared type", () => {
    const snapshot = compile({
      packages: [
        ...PACKAGES,
        { key: "typo", declares: [{ id: "typo.a", kind: "derived", type: "string", rules: { deriveFrom: "1 + 1" } }] },
      ],
    })
    expect(snapshot.problems.find((p) => p.at === "typo.a.deriveFrom")?.detail).toMatch(
      /produces a number; the node is declared string/,
    )
  })

  it("refuses a default that is not the declared type", () => {
    const snapshot = compile({
      packages: [...PACKAGES, { key: "typo", declares: [{ id: "typo.a", kind: "question", type: "number", defaultValue: "ten" }] }],
    })
    expect(snapshot.problems.find((p) => p.at === "typo.a")?.detail).toMatch(/declared number and its default is string/)
  })

  it("refuses a reference to a name nothing declares", () => {
    const snapshot = compile({
      packages: [
        ...PACKAGES,
        { key: "typo", declares: [{ id: "typo.a", kind: "derived", type: "number", rules: { deriveFrom: "nobody.declared + 1" } }] },
      ],
    })
    expect(snapshot.problems.find((p) => p.at === "typo.a.deriveFrom")?.detail).toMatch(/is not declared/)
  })

  it("refuses an expression outside the language's bounds", () => {
    const snapshot = compile({
      packages: [
        ...PACKAGES,
        {
          key: "huge",
          declares: [
            { id: "huge.a", kind: "derived", type: "number", rules: { deriveFrom: `1${" + 1".repeat(3_000)}` } },
          ],
        },
      ],
    })
    const problem = snapshot.problems.find((p) => p.at === "huge.a.deriveFrom")
    expect(problem?.code).toBe("unbounded-expression")
    expect(problem?.step).toBe(5)
  })

  it("extracts every path a rule reads as an edge, with the slot that read it", () => {
    const snapshot = compile()
    expect(snapshot.edges).toContainEqual({ from: "payroll.subtotal", to: "payroll.seats", via: "deriveFrom" })
    expect(snapshot.edges).toContainEqual({ from: "payroll.approver", to: "payroll.subtotal", via: "requiredWhen" })
    expect(snapshot.contextPaths).toEqual(["context.jurisdiction"])
  })

  it("does not call a validation that reads its own value a cycle", () => {
    // `validateWhen: "payroll.seats > 0"` reads the value it is validating. That
    // is what a validation IS, and treating it as an ordering dependency would
    // report every validated field as a one-node cycle.
    expect(compile().cycles).toEqual([])
    expect(compile().nodes.find((n) => n.id === "payroll.seats")?.dependsOn).toEqual([])
  })
})

describe("step 6-8: cycles and evaluation order", () => {
  const cyclic: readonly PackageManifest[] = [
    {
      key: "loop",
      version: "1.0.0",
      declares: [
        { id: "loop.a", kind: "derived", type: "number", rules: { deriveFrom: "loop.b + 1" } },
        { id: "loop.b", kind: "derived", type: "number", rules: { deriveFrom: "loop.a + 1" } },
      ],
    },
  ]

  it("reports a rule cycle as its minimal path and refuses to publish", () => {
    const snapshot = compileGraph({ packages: cyclic })
    expect(snapshot.cycles).toEqual(["loop.a → loop.b → loop.a"])
    expect(snapshot.problems.find((p) => p.code === "rule-cycle")?.detail).toMatch(/loop\.a → loop\.b → loop\.a/)
    expect(snapshot.publishable).toBe(false)
    expect(snapshot.unordered).toEqual(["loop.a", "loop.b"])
  })

  it("calls a deriveFrom that reads its own node a cycle", () => {
    // The other side of the validation case: a value defined in terms of itself.
    const snapshot = compileGraph({
      packages: [{ key: "self", declares: [{ id: "self.a", kind: "derived", type: "number", rules: { deriveFrom: "self.a + 1" } }] }],
    })
    expect(snapshot.cycles).toEqual(["self.a → self.a"])
  })

  it("permits a cycle only when it is named as a reviewed fixed-point group", () => {
    const snapshot = compileGraph({ packages: cyclic, fixedPointGroups: [["loop.b", "loop.a"]] })
    expect(snapshot.problems.filter((p) => p.code === "rule-cycle")).toEqual([])
    expect(snapshot.publishable).toBe(true)
  })

  it("refuses a fixed-point exemption for a cycle that no longer exists", () => {
    // An exemption nobody notices becoming live again is the failure here.
    const snapshot = compile({ fixedPointGroups: [["payroll.seats", "payroll.rate"]] })
    expect(snapshot.problems.find((p) => p.code === "fixed-point-group")?.step).toBe(7)
    expect(snapshot.publishable).toBe(false)
  })

  it("orders evaluation groups with prerequisites first", () => {
    const groups = compile().groups
    const groupOf = (id: string) => groups.findIndex((group) => group.includes(id))
    expect(groupOf("payroll.seats")).toBeLessThan(groupOf("payroll.subtotal"))
    expect(groupOf("payroll.subtotal")).toBeLessThan(groupOf("payroll.overCap"))
    expect(groupOf("payroll.subtotal")).toBeLessThan(groupOf("payroll.approver"))
  })
})

describe("step 9: the signature", () => {
  const key = { keyId: "cfg-graph-test", secret: "a-secret" }

  it("carries no signature when no key is configured, and says why", () => {
    const snapshot = compile()
    expect(snapshot.signature).toBeUndefined()
    expect(snapshot.unsigned).toMatch(/CONFIG_GRAPH_SIGNING_KEY_ID/)
    expect(verifySnapshot(snapshot, () => key.secret)).toEqual({
      valid: false,
      reason: "unsigned",
      detail: snapshot.unsigned,
    })
  })

  it("verifies a signed snapshot against the key that produced it", () => {
    const snapshot = compile({ signWith: key })
    expect(snapshot.signature).toEqual({ keyId: "cfg-graph-test", algorithm: "hmac-sha256", value: expect.any(String) })
    expect(verifySnapshot(snapshot, () => key.secret)).toEqual({ valid: true, keyId: "cfg-graph-test" })
  })

  it("refuses to sign with an empty key", () => {
    // A signature anyone can reproduce is worse than a visibly missing one.
    expect(() => signSnapshot("sha256:abc", { keyId: "k", secret: "" })).toThrow(/anyone can reproduce/)
    expect(() => signSnapshot("sha256:abc", { keyId: "", secret: "s" })).toThrow(/must name the key/)
  })

  it("detects content rewritten together with its digest", () => {
    // The digest is re-derived from the content before the signature is checked.
    // A verifier that only checked the signature over the STORED digest would
    // accept this, because both fields are attacker-controlled.
    const snapshot = compile({ signWith: key })
    const forged = {
      ...snapshot,
      nodes: snapshot.nodes.map((n) => (n.id === "budgeting.cap" ? { ...n, defaultValue: 999_999 } : n)),
    }
    expect(verifySnapshot(forged, () => key.secret).valid).toBe(false)
    expect(verifySnapshot(forged, () => key.secret)).toMatchObject({ reason: "digest-altered" })
  })

  it("detects a swapped signature value", () => {
    const snapshot = compile({ signWith: key })
    const forged = { ...snapshot, signature: { ...snapshot.signature!, value: "00".repeat(32) } }
    expect(verifySnapshot(forged, () => key.secret)).toMatchObject({ reason: "content-altered" })
  })

  it("fails closed on a key it cannot resolve", () => {
    const snapshot = compile({ signWith: key })
    expect(verifySnapshot(snapshot, () => undefined)).toMatchObject({ reason: "unknown-key" })
  })

  it("reads the key from two environment variables, or returns null", () => {
    expect(graphSigningKeyFromEnv({})).toBeNull()
    expect(graphSigningKeyFromEnv({ CONFIG_GRAPH_SIGNING_KEY_ID: "k" })).toBeNull()
    expect(graphSigningKeyFromEnv({ CONFIG_GRAPH_SIGNING_SECRET: "s" })).toBeNull()
    expect(graphSigningKeyFromEnv({ CONFIG_GRAPH_SIGNING_KEY_ID: " k ", CONFIG_GRAPH_SIGNING_SECRET: " s " })).toEqual({
      keyId: "k",
      secret: "s",
    })
  })
})

describe("evaluation, with a trace", () => {
  it("derives values in dependency order", () => {
    const evaluation = evaluateGraph(compile(), INPUTS)
    expect(evaluation.values["payroll.subtotal"]).toBe(1_000)
    expect(evaluation.values["payroll.overCap"]).toBe(false)
    expect(evaluation.errors).toEqual([])
  })

  it("takes a supplied value over a default, and a derived value over both", () => {
    const evaluation = evaluateGraph(compile(), { ...INPUTS, "payroll.seats": 60, "payroll.subtotal": 1 })
    expect(evaluation.values["payroll.seats"]).toBe(60)
    expect(evaluation.values["payroll.subtotal"]).toBe(6_000)
  })

  it("computes each node's state from its rules and leaves undeclared slots at their default", () => {
    const evaluation = evaluateGraph(compile(), { ...INPUTS, "payroll.seats": 60 })
    expect(evaluation.states["payroll.approver"]).toEqual({
      visible: true,
      applicable: true,
      enabled: true,
      required: true,
      valid: true,
    })
    expect(evaluation.states["payroll.region"].visible).toBe(true)
    expect(evaluateGraph(compile(), { "context.jurisdiction": "GB" }).states["payroll.region"].visible).toBe(false)
  })

  it("records a trace per rule with the inputs it read, its output and its cost", () => {
    const evaluation = evaluateGraph(compile(), INPUTS)
    const trace = evaluation.traces.find((t) => t.node === "payroll.subtotal" && t.slot === "deriveFrom")!
    expect(trace.expression).toBe("payroll.seats * payroll.rate")
    expect(trace.inputs).toEqual({ "payroll.rate": 100, "payroll.seats": 10 })
    expect(trace.output).toBe(1_000)
    expect(trace.steps).toBeGreaterThan(0)
    expect(trace.error).toBeNull()
  })

  it("records an evaluation error instead of throwing, and does not let a failed rule decide", () => {
    // A `validateWhen` that could not run must not report the value invalid. A
    // rule that crashed and a rule that returned false are different answers.
    const evaluation = evaluateGraph(compile(), {})
    const trace = evaluation.traces.find((t) => t.node === "payroll.region" && t.slot === "visibleWhen")!
    expect(trace.error).toMatch(/not in the environment/)
    expect(trace.output).toBeNull()
    expect(evaluation.states["payroll.region"].visible).toBe(true)
    expect(evaluation.errors).toContain(`payroll.region.visibleWhen: ${trace.error}`)
  })

  it("refuses to evaluate a snapshot that did not compile", () => {
    // An answer from a graph whose ordering is not known to be possible is
    // indistinguishable from a real one.
    const broken = compileGraph({
      packages: [
        {
          key: "loop",
          declares: [
            { id: "loop.a", kind: "derived", type: "number", rules: { deriveFrom: "loop.b + 1" } },
            { id: "loop.b", kind: "derived", type: "number", rules: { deriveFrom: "loop.a + 1" } },
          ],
        },
      ],
    })
    expect(() => evaluateGraph(broken, {})).toThrow(GraphCompilerError)
    expect(() => evaluateGraph(broken, {})).toThrow(/unresolved compilation problem/)
  })
})

describe("deterministic replay", () => {
  it("gives the same outputs and the same digest for the same inputs", () => {
    const snapshot = compile()
    const first = evaluateGraph(snapshot, INPUTS)
    for (let i = 0; i < 5; i++) {
      const again = evaluateGraph(snapshot, INPUTS)
      expect(again.values).toEqual(first.values)
      expect(again.states).toEqual(first.states)
      expect(again.outputDigest).toBe(first.outputDigest)
    }
  })

  it("does not depend on the order the inputs were declared in", () => {
    const snapshot = compile()
    const inputs = { ...INPUTS, "payroll.seats": 12, "payroll.rate": 7 }
    const reversed = Object.fromEntries(Object.entries(inputs).reverse())
    expect(evaluateGraph(snapshot, reversed).outputDigest).toBe(evaluateGraph(snapshot, inputs).outputDigest)
  })

  it("changes the output digest when an input changes", () => {
    const snapshot = compile()
    expect(evaluateGraph(snapshot, { ...INPUTS, "payroll.seats": 11 }).outputDigest).not.toBe(
      evaluateGraph(snapshot, INPUTS).outputDigest,
    )
  })

  it("binds the outputs to the graph that produced them", () => {
    // The same inputs against a different graph version are a different answer,
    // and the digest has to say so or an approval could be replayed onto a graph
    // nobody approved.
    expect(evaluateGraph(compile({ packages: withVersion("1.3.0") }), INPUTS).outputDigest).not.toBe(
      evaluateGraph(compile(), INPUTS).outputDigest,
    )
  })
})

describe("affected-subgraph re-evaluation", () => {
  const snapshot = compile()
  const before = evaluateGraph(snapshot, INPUTS)
  const after = { ...INPUTS, "payroll.rate": 900 }

  it("agrees with a full evaluation over the same inputs", () => {
    const incremental = reevaluateGraph(snapshot, before, after, ["payroll.rate"])
    const full = evaluateGraph(snapshot, after)
    expect(incremental.values).toEqual(full.values)
    expect(incremental.states).toEqual(full.states)
    expect(incremental.outputDigest).toBe(full.outputDigest)
    expect(incremental.values["payroll.subtotal"]).toBe(9_000)
    expect(incremental.values["payroll.overCap"]).toBe(true)
  })

  it("does strictly less work than a full evaluation", () => {
    // Correctness alone would pass for an implementation that quietly recomputed
    // everything, which is how an incremental evaluator stops being incremental.
    const incremental = reevaluateGraph(snapshot, before, after, ["payroll.rate"])
    const recomputed = incremental.traces.filter((t) => !t.reused).length
    const total = evaluateGraph(snapshot, after).traces.length
    expect(recomputed).toBeGreaterThan(0)
    expect(recomputed).toBeLessThan(total)
  })

  it("marks what it carried over, so a reader can see what was not recomputed", () => {
    const incremental = reevaluateGraph(snapshot, before, after, ["payroll.rate"])
    expect(incremental.traces.find((t) => t.node === "payroll.highEarner")?.reused).toBe(true)
    expect(incremental.traces.find((t) => t.node === "payroll.subtotal")?.reused).toBe(false)
  })

  it("recomputes nothing when nothing changed", () => {
    const incremental = reevaluateGraph(snapshot, before, INPUTS, [])
    expect(incremental.traces.every((t) => t.reused)).toBe(true)
    expect(incremental.outputDigest).toBe(before.outputDigest)
  })

  it("refuses to re-evaluate across graph versions", () => {
    // Reusing values computed under a different graph is the one failure an
    // incremental evaluator cannot detect after the fact.
    expect(() => reevaluateGraph(compile({ packages: withVersion("1.4.0") }), before, after, ["payroll.rate"])).toThrow(
      /across graph versions/,
    )
  })
})

describe("step 10: two projections from one snapshot", () => {
  const projection = presentationProjection(compile())

  it("ships the presentation rules and never the server-authoritative ones", () => {
    const approver = projection.nodes.find((n) => n.id === "payroll.approver")!
    expect(Object.keys(approver.rules).sort()).toEqual(["requiredWhen", "visibleWhen"])
    for (const node of projection.nodes) {
      expect(node.rules).not.toHaveProperty("deriveFrom")
      expect(node.rules).not.toHaveProperty("validateWhen")
    }
    expect(projection.serverOnlySlots).toEqual(["applicableWhen", "deriveFrom", "validateWhen"])
  })

  it("withholds a protected node, and says it did", () => {
    expect(projection.nodes.map((n) => n.id)).not.toContain("payroll.salary")
    expect(projection.withheld).toContainEqual({ id: "payroll.salary", reason: "declared confidential" })
  })

  it("withholds a node whose rules READ a protected value", () => {
    // `payroll.salary > 100000` shipped without the salary looks safe. It is a
    // bisection oracle that recovers the value it was supposed to protect.
    expect(projection.nodes.map((n) => n.id)).not.toContain("payroll.highEarner")
    expect(projection.withheld.find((w) => w.id === "payroll.highEarner")?.reason).toMatch(/by inference/)
  })

  it("keeps the groups it does ship consistent with what it shipped", () => {
    const present = new Set(projection.nodes.map((n) => n.id))
    for (const group of projection.groups) for (const id of group) expect(present.has(id)).toBe(true)
  })

  it("comes from the same snapshot the server evaluates, and names it", () => {
    // Two snapshots would drift; the digest is what makes them one.
    expect(projection.graphDigest).toBe(compile().digest)
  })
})

describe("the real module catalogue", () => {
  it("compiles, because a compiler that has only met fixtures has not met its data", () => {
    const snapshot = compileGraph({ packages: MODULES as readonly PackageManifest[], enabled: [] })
    expect(snapshot.problems).toEqual([])
    expect(snapshot.packages.length).toBe(MODULES.length)
    expect(snapshot.unversionedPackages).toEqual([])
  })

  it("names every package as unversioned when the catalogue reaches it stripped of versions", () => {
    // This is the shape `planPublication` receives: `ModuleLike` has no version.
    const asPublicationSeesIt = MODULES.map((m) => ({
      key: m.key,
      dependsOn: m.dependsOn,
      provides: m.provides,
      entitlement: m.requiresEntitlement,
    }))
    const snapshot = compileGraph({ packages: asPublicationSeesIt, enabled: [] })
    expect(snapshot.problems).toEqual([])
    expect([...snapshot.unversionedPackages].sort()).toEqual(MODULES.map((m) => m.key).sort())
  })
})

describe("what a publication blocks on", () => {
  it("does not report a package cycle twice", () => {
    // `allRejections` already reports it. Two blockers for one defect makes the
    // count of blockers meaningless.
    const snapshot = compileGraph({
      packages: [
        { key: "a", dependsOn: [{ module: "b" }] },
        { key: "b", dependsOn: [{ module: "a" }] },
      ],
    })
    expect(snapshot.problems.map((p) => p.code)).toContain("package-cycle")
    expect(snapshotBlockers(snapshot)).toEqual([])
  })

  it("reports the problems only the graph compiler can find", () => {
    const snapshot = compileGraph({
      packages: [
        { key: "loop", declares: [{ id: "loop.a", kind: "derived", type: "number", rules: { deriveFrom: "loop.a + 1" } }] },
      ],
    })
    expect(snapshotBlockers(snapshot)).toEqual([
      expect.stringMatching(/Bible §11 step 6, rule-cycle.*loop\.a → loop\.a/),
    ])
  })
})

describe("planPublication compiles the graph it would publish", () => {
  const registry = ConfigRegistry.of([
    defineConfig({
      key: "platform.localization.currency",
      owner: "platform",
      type: z.string(),
      default: "USD",
      allowedScopes: ["tenant"],
      mergeStrategy: "replace",
      sensitivity: "public",
      overridable: true,
      description: "Currency.",
      price: {
        perSeatMinor: 0,
        perOrgMinor: 0,
        currency: "USD",
        rounding: "half-up",
        includedBecause: "A test fixture, priced at nothing so the arithmetic under test is the test's own.",
      },
    }),
  ])

  const layer = (values: Record<string, unknown>): VersionedLayer => ({
    kind: "tenantOverlay",
    id: "acme",
    values,
    metadata: {
      version: 1,
      schemaVersion: "1.0.0",
      signer: "arn:aws:kms:us-east-1:000000000000:key/test",
      origin: "graph-snapshot.test.ts",
      compatibility: { minEngine: "2026.7.0", maxEngine: null },
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      effectiveUntil: null,
      changeReason: "a reason long enough to be a reason",
      approvedBy: requiresApproval("tenantOverlay") ? "operator:approver" : null,
    },
  })

  const plan = (modules: readonly PackageManifest[]) =>
    planPublication({
      registry,
      current: null,
      proposed: [layer({ "platform.localization.currency": "GBP" })],
      publishedBy: "operator:publisher",
      activateAt: new Date("2026-08-03T00:00:00Z"),
      now: new Date("2026-08-02T00:00:00Z"),
      modules,
    })

  it("carries a snapshot on every plan, so 'compiled cleanly' and 'nobody compiled' differ", () => {
    const clean = plan(MODULES as readonly PackageManifest[])
    expect(clean.graph).toBeDefined()
    expect(clean.graph!.publishable).toBe(true)
    expect(clean.graph!.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(clean.blocked).toBe(false)
  })

  it("blocks a publication whose package closure declares a rule cycle", () => {
    const blockedPlan = plan([
      ...(MODULES as readonly PackageManifest[]),
      {
        key: "loop",
        version: "1.0.0",
        declares: [{ id: "loop.a", kind: "derived", type: "number", rules: { deriveFrom: "loop.a + 1" } }],
      },
    ])
    expect(blockedPlan.graph!.publishable).toBe(false)
    expect(blockedPlan.blocked).toBe(true)
    expect(blockedPlan.blockers.some((b) => /rule-cycle/.test(b))).toBe(true)
  })
})
