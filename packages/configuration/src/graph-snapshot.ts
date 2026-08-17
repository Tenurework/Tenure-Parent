import { createHash, createHmac, timingSafeEqual } from "node:crypto"

import {
  EXPRESSION_LANGUAGE_VERSION,
  ExpressionError,
  dependencies,
  evaluate,
  parse as parseExpression,
  typeOf,
  type ExprType,
  type Node as ExpressionNode,
  type TypeEnv,
  type ValueEnv,
} from "./expression"
import { adjacencyOf, affectedSubgraph, minimalCyclePaths, topologicalGroups, type Adjacency } from "./graph"
import { stableStringify } from "./merge"
import { moduleGraphRejections, type ModuleLike } from "./rejections"

/**
 * CFG-030 — the configuration graph compiler.
 *
 * Bible §11 states the contract in ten numbered steps, and this module is those
 * ten steps. Each is marked in the code with the step it implements, because a
 * compiler that does nine of them reads exactly like one that does ten:
 *
 *   1. Resolve package versions and namespaces.
 *   2. Validate unique stable identifiers.
 *   3. Type-check every reference.
 *   4. Extract static dependencies.
 *   5. Reject forbidden or unbounded expressions.
 *   6. Detect cycles and produce a human-readable minimal cycle path.
 *   7. Permit monotonic fixed-point groups only under a reviewed contract.
 *   8. Topologically order evaluation groups.
 *   9. Produce a signed `GraphSnapshot` with schema/package digests.
 *  10. Generate client-safe and server-authoritative projections from one snapshot.
 *
 * ## What it is built on, deliberately
 *
 * The expression half already existed — `expression.ts` parses, types, extracts
 * dependencies and evaluates inside four bounds, and `graph.ts` owns cycles,
 * ordering and affected subgraphs. Package reference resolution and the module
 * cycle report already existed in `rejections.ts`. This file adds the part that
 * was genuinely missing: turning a set of package manifests into ONE typed graph
 * with a digest, evaluating it in dependency order while recording a trace, and
 * re-evaluating only what a change reached. It re-implements none of the three.
 *
 * ## Two answers this module refuses to conflate
 *
 * A snapshot that could not be compiled and a snapshot that compiled with
 * nothing wrong are different objects here. `problems` is empty in the second
 * case and `publishable` is true; in the first, `publishable` is false and every
 * problem names the §11 step that produced it. Likewise a snapshot with no
 * signature says `unsigned` and why — it never carries a signature nobody
 * produced, following the same rule `packages/provisioning/src/execute.ts`
 * states for deployment manifests: a signature anyone can reproduce is worse
 * than a visibly missing one.
 *
 * ## Determinism, which is the whole point of the digest
 *
 * Nothing here reads a clock, iterates an object without sorting, or depends on
 * the order manifests were passed in. Two processes compiling the same packages
 * produce the same digest, and two processes evaluating the same snapshot over
 * the same inputs produce the same `outputDigest` — which is what lets an
 * approval be bound to a configuration (CFG-080-002) rather than to a promise.
 */

export const GRAPH_COMPILER_VERSION = "1.0.0"

/**
 * Node kinds, from §11: "questions, derived values, validations, sections,
 * capabilities, artifacts, approvals and external checks."
 */
export const NODE_KINDS = [
  "question",
  "derived",
  "validation",
  "section",
  "capability",
  "artifact",
  "approval",
  "external-check",
] as const
export type NodeKind = (typeof NODE_KINDS)[number]

/**
 * The rule slots a node may carry, from §10's vocabulary table.
 *
 * `audience` is the §11 step 10 split and it is a property of the RULE, not of
 * the node: whether a control is rendered is a presentation question the browser
 * may answer for itself, while whether a value is valid or what it derives to is
 * server-authoritative and a browser answer is a suggestion. Both come out of
 * one snapshot, which is the requirement — two snapshots would drift.
 */
export const RULE_SLOTS = {
  visibleWhen: { audience: "client-safe", returns: "boolean" },
  enabledWhen: { audience: "client-safe", returns: "boolean" },
  requiredWhen: { audience: "client-safe", returns: "boolean" },
  applicableWhen: { audience: "server-authoritative", returns: "boolean" },
  validateWhen: { audience: "server-authoritative", returns: "boolean" },
  /** `null` means "the node's own declared type", which only `deriveFrom` uses. */
  deriveFrom: { audience: "server-authoritative", returns: null },
} as const satisfies Record<string, { audience: "client-safe" | "server-authoritative"; returns: ExprType | null }>

export type RuleSlot = keyof typeof RULE_SLOTS
export const RULE_SLOT_NAMES = Object.keys(RULE_SLOTS).sort() as readonly RuleSlot[]

export const SENSITIVITY_ORDER = ["public", "internal", "confidential", "secret"] as const
export type NodeSensitivity = (typeof SENSITIVITY_ORDER)[number]

/** One declaration inside a package. */
export interface DeclaredNode {
  /** Stable identifier, namespaced under the declaring package. */
  id: string
  kind: NodeKind
  type: ExprType
  /** Absent defaults to `internal`; only `public` and `internal` reach a browser. */
  sensitivity?: NodeSensitivity
  /** The value used when nothing supplies one. Type-checked against `type`. */
  defaultValue?: unknown
  /** Expressions, by slot. Every one is parsed, typed and bounded at compile time. */
  rules?: Partial<Record<RuleSlot, string>>
}

/**
 * What this module needs from a package manifest.
 *
 * Structurally a superset of `ModuleLike`, so the live module catalogue
 * (`modules/index.ts`, reaching here through `planPublication`) is already a
 * valid input and needs no adapter. `version` and `namespace` are optional
 * because that catalogue's entries reach `planPublication` without them, and the
 * snapshot SAYS SO rather than digesting an unversioned package as though it
 * were versioned — see `unversionedPackages`.
 */
export interface PackageManifest extends ModuleLike {
  version?: string
  /** Defaults to `key`. Every declared id must sit under it. */
  namespace?: string
  declares?: readonly DeclaredNode[]
}

export interface GraphProblem {
  /** The §11 compilation step that produced it. */
  step: number
  code:
    | "duplicate-package"
    | "duplicate-identifier"
    | "namespace-escape"
    | "cross-namespace-reference"
    | "unbounded-expression"
    | "type-error"
    | "rule-cycle"
    | "package-cycle"
    | "unresolved-dependency"
    | "fixed-point-group"
  detail: string
  /** The node or package the problem belongs to. */
  at?: string
}

export interface CompiledNode {
  id: string
  package: string
  namespace: string
  kind: NodeKind
  type: ExprType
  sensitivity: NodeSensitivity
  hasDefault: boolean
  defaultValue?: unknown
  rules: Readonly<Partial<Record<RuleSlot, string>>>
  /** Every path any of this node's rules reads, sorted. */
  dependsOn: readonly string[]
}

export interface GraphEdge {
  /** The node whose rule reads. */
  from: string
  /** The path it reads. */
  to: string
  /** Which rule created the edge — §11's edge kinds. */
  via: RuleSlot
}

export interface SnapshotSignature {
  keyId: string
  algorithm: "hmac-sha256"
  value: string
}

export interface GraphSigningKey {
  keyId: string
  secret: string
}

export interface GraphSnapshot {
  compilerVersion: string
  expressionLanguageVersion: string
  packages: readonly { key: string; namespace: string; version: string | null; digest: string }[]
  /**
   * Packages whose manifest stated no version.
   *
   * Named, not silently tolerated. The digest still covers everything the
   * manifest DOES say, so it detects a changed declaration — but it cannot
   * detect "the same declarations republished as 2.0.0", and a caller reading
   * `digest` deserves to know which of those two guarantees it has.
   */
  unversionedPackages: readonly string[]
  nodes: readonly CompiledNode[]
  edges: readonly GraphEdge[]
  /** Evaluation groups over declared nodes, prerequisites first. §11 step 8. */
  groups: readonly (readonly string[])[]
  /** Declared nodes no group could contain, because a cycle reaches them. */
  unordered: readonly string[]
  /** Minimal cycle paths. §11 step 6. */
  cycles: readonly string[]
  /** Every path read by a rule that no node declares — the graph's inputs. */
  contextPaths: readonly string[]
  problems: readonly GraphProblem[]
  /** True only when nothing is wrong. Never inferred from an empty cycle list. */
  publishable: boolean
  /** Canonical digest of everything above except `problems`, `publishable` and the signature. */
  digest: string
  signature?: SnapshotSignature
  /** Why there is no signature, when there is none. */
  unsigned?: string
}

export class GraphCompilerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GraphCompilerError"
  }
}

export interface CompileInput {
  packages: readonly PackageManifest[]
  /** Which packages the tenant has switched on. Feeds the reference checks. */
  enabled?: readonly string[]
  /** Context paths a rule may read — `context.*`, from §10's approved functions. */
  contextTypes?: Readonly<Record<string, ExprType>>
  /**
   * Node groups explicitly reviewed as monotonic fixed points (§11 step 7).
   *
   * Empty by default, which is the fail-closed direction: an unreviewed cycle is
   * a defect, and the only way to make one legal is to name it here — which
   * leaves a diff a reviewer can see.
   */
  fixedPointGroups?: readonly (readonly string[])[]
  signWith?: GraphSigningKey | null
}

const canonicalDigest = (value: unknown): string =>
  `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`

/**
 * The signing key, from the environment.
 *
 * Two variables and a null return, the same convention
 * `apps/system-studio/src/lib/deliver.ts:40` uses for deployment signing and
 * `packages/platform-config/src/build-system.ts` for releases, so an operator
 * who has configured one already knows how to configure this. Null produces an
 * explicitly unsigned snapshot; it never produces a signature.
 */
export function graphSigningKeyFromEnv(
  env: Record<string, string | undefined> = process.env,
): GraphSigningKey | null {
  const keyId = env.CONFIG_GRAPH_SIGNING_KEY_ID?.trim()
  const secret = env.CONFIG_GRAPH_SIGNING_SECRET?.trim()
  if (!keyId || !secret) return null
  return { keyId, secret }
}

/** §11 step 9 — sign a compiled snapshot's digest. */
export function signSnapshot(digest: string, key: GraphSigningKey): SnapshotSignature {
  if (!key.keyId) throw new GraphCompilerError("A signature must name the key that produced it.")
  if (!key.secret) {
    throw new GraphCompilerError(
      "Refusing to sign a graph snapshot with an empty key. A signature anyone can reproduce " +
        "proves nothing, and would be worse than being visibly unsigned.",
    )
  }
  return { keyId: key.keyId, algorithm: "hmac-sha256", value: createHmac("sha256", key.secret).update(digest).digest("hex") }
}

export type SnapshotVerification =
  | { valid: true; keyId: string }
  | { valid: false; reason: "unsigned" | "unknown-key" | "content-altered" | "digest-altered"; detail: string }

/**
 * Verify a snapshot against the key that claims to have produced it.
 *
 * Recomputes the digest from the snapshot's own content first. A verifier that
 * only checked the signature over the stored `digest` field would accept a
 * snapshot whose nodes had been rewritten and whose digest had been rewritten to
 * match — the signature is over the digest, so both are attacker-controlled
 * unless the digest is re-derived. That is the mistake this branch exists for.
 */
export function verifySnapshot(
  snapshot: GraphSnapshot,
  resolveKey: (keyId: string) => string | undefined,
): SnapshotVerification {
  const recomputed = digestOf(snapshot)
  if (recomputed !== snapshot.digest) {
    return {
      valid: false,
      reason: "digest-altered",
      detail: `The snapshot's content digests to ${recomputed}, and it carries ${snapshot.digest}.`,
    }
  }
  if (!snapshot.signature) {
    return {
      valid: false,
      reason: "unsigned",
      detail: snapshot.unsigned ?? "This snapshot carries no signature, so nothing establishes who produced it.",
    }
  }
  const secret = resolveKey(snapshot.signature.keyId)
  if (!secret) {
    return {
      valid: false,
      reason: "unknown-key",
      detail: `Signed by "${snapshot.signature.keyId}", which this engine cannot resolve.`,
    }
  }
  const expected = createHmac("sha256", secret).update(snapshot.digest).digest("hex")
  const a = Buffer.from(expected, "hex")
  const b = Buffer.from(snapshot.signature.value, "hex")
  // Length-checked first: timingSafeEqual throws on a length mismatch, and a
  // thrown error is a verification that neither passed nor failed.
  const ok = a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
  return ok
    ? { valid: true, keyId: snapshot.signature.keyId }
    : { valid: false, reason: "content-altered", detail: "The signature does not match this snapshot's digest." }
}

/** Exactly what the digest covers. One function, so signer and verifier cannot diverge. */
function digestOf(snapshot: GraphSnapshot): string {
  return canonicalDigest({
    compilerVersion: snapshot.compilerVersion,
    expressionLanguageVersion: snapshot.expressionLanguageVersion,
    packages: snapshot.packages,
    unversionedPackages: snapshot.unversionedPackages,
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    groups: snapshot.groups,
    unordered: snapshot.unordered,
    contextPaths: snapshot.contextPaths,
  })
}

/**
 * Compile a package closure into one typed graph. §11 steps 1–9.
 *
 * Never throws for bad input: a compiler that throws on the first defect reports
 * one problem per run, and an operator fixing twelve declarations would need
 * twelve compiles. Everything is collected, and `publishable` is the verdict.
 */
export function compileGraph(input: CompileInput): GraphSnapshot {
  const { packages, enabled = [], contextTypes = {}, fixedPointGroups = [], signWith = null } = input
  const problems: GraphProblem[] = []

  // ── step 1: resolve package versions and namespaces ────────────────────────
  const seenPackages = new Set<string>()
  const resolved: { key: string; namespace: string; version: string | null; digest: string; manifest: PackageManifest }[] = []
  for (const manifest of [...packages].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    if (seenPackages.has(manifest.key)) {
      problems.push({
        step: 1,
        code: "duplicate-package",
        at: manifest.key,
        detail: `Two manifests declare the package "${manifest.key}". Which one's declarations apply is unanswerable.`,
      })
      continue
    }
    seenPackages.add(manifest.key)
    resolved.push({
      key: manifest.key,
      namespace: manifest.namespace ?? manifest.key,
      version: manifest.version ?? null,
      digest: canonicalDigest({
        key: manifest.key,
        namespace: manifest.namespace ?? manifest.key,
        version: manifest.version ?? null,
        dependsOn: [...(manifest.dependsOn ?? [])].map((d) => ({ module: d.module, kind: d.kind ?? "required" })),
        provides: [...(manifest.provides ?? [])].sort(),
        declares: [...(manifest.declares ?? [])].map((n) => ({ ...n })).sort((a, b) => (a.id < b.id ? -1 : 1)),
      }),
      manifest,
    })
  }

  // Package-level references and cycles come from `rejections.ts`, which already
  // resolves a dependency that names a CAPABILITY rather than a module key. A
  // second resolver here would be a second answer to the same question.
  for (const rejection of moduleGraphRejections(packages, enabled)) {
    if (rejection.rule === "dependency-cycle") {
      problems.push({ step: 6, code: "package-cycle", detail: rejection.detail })
    } else if (rejection.rule === "invalid-reference" || rejection.rule === "missing-dependency") {
      problems.push({ step: 1, code: "unresolved-dependency", detail: rejection.detail })
    }
  }

  /** Transitive package closure: which packages a package may read from. */
  const providers = new Map<string, string>()
  for (const entry of resolved) {
    providers.set(entry.key, entry.key)
    for (const capability of entry.manifest.provides ?? []) providers.set(capability, entry.key)
  }
  const closureOf = (key: string): ReadonlySet<string> => {
    const seen = new Set<string>([key])
    const queue = [key]
    while (queue.length > 0) {
      const current = queue.shift()!
      const manifest = resolved.find((r) => r.key === current)?.manifest
      for (const dependency of manifest?.dependsOn ?? []) {
        const provider = providers.get(dependency.module)
        if (provider && !seen.has(provider)) {
          seen.add(provider)
          queue.push(provider)
        }
      }
    }
    return seen
  }

  // ── step 2: unique stable identifiers, under the declaring namespace ───────
  const declarations = new Map<string, { node: DeclaredNode; package: string; namespace: string }>()
  for (const entry of resolved) {
    for (const node of [...(entry.manifest.declares ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (declarations.has(node.id)) {
        problems.push({
          step: 2,
          code: "duplicate-identifier",
          at: node.id,
          detail:
            `"${node.id}" is declared by both "${declarations.get(node.id)!.package}" and "${entry.key}". ` +
            `An identifier that resolves to two declarations makes every reference to it ambiguous.`,
        })
        continue
      }
      if (node.id !== entry.namespace && !node.id.startsWith(`${entry.namespace}.`)) {
        problems.push({
          step: 2,
          code: "namespace-escape",
          at: node.id,
          detail:
            `"${entry.key}" declares "${node.id}", which is not under its namespace "${entry.namespace}". ` +
            `A package that can name anything can shadow another package's declaration.`,
        })
        continue
      }
      declarations.set(node.id, { node, package: entry.key, namespace: entry.namespace })
    }
  }

  // ── step 3: type-check every reference · step 4: extract dependencies ──────
  // · step 5: reject forbidden or unbounded expressions
  const types: TypeEnv = {
    ...Object.fromEntries([...declarations].map(([id, d]) => [id, d.node.type])),
    ...contextTypes,
  }

  const nodes: CompiledNode[] = []
  const edges: GraphEdge[] = []
  const contextPaths = new Set<string>()

  for (const id of [...declarations.keys()].sort()) {
    const { node, package: pkg, namespace } = declarations.get(id)!
    const visible = closureOf(pkg)
    const readable = new Set<string>()

    for (const slot of RULE_SLOT_NAMES) {
      const source = node.rules?.[slot]
      if (source === undefined) continue

      let ast: ExpressionNode
      try {
        // step 5 — the four bounds and the closed AST live in `expression.ts`.
        ast = parseExpression(source)
      } catch (error) {
        problems.push({
          step: 5,
          code: "unbounded-expression",
          at: `${id}.${slot}`,
          detail: `"${id}" rule "${slot}" will not parse — ${error instanceof ExpressionError ? error.message : String(error)}`,
        })
        continue
      }

      let produced: ExprType
      try {
        produced = typeOf(ast, types)
      } catch (error) {
        problems.push({
          step: 3,
          code: "type-error",
          at: `${id}.${slot}`,
          detail: `"${id}" rule "${slot}" does not type-check — ${error instanceof ExpressionError ? error.message : String(error)}`,
        })
        continue
      }

      const expected = RULE_SLOTS[slot].returns ?? node.type
      if (produced !== expected) {
        problems.push({
          step: 3,
          code: "type-error",
          at: `${id}.${slot}`,
          detail: `"${id}" rule "${slot}" produces a ${produced}; ${slot === "deriveFrom" ? `the node is declared ${expected}` : `the slot requires a ${expected}`}.`,
        })
        continue
      }

      // step 4 — static dependency extraction, then the namespace rule.
      for (const path of dependencies(ast)) {
        // A rule reading its OWN node is an ordering prerequisite only for
        // `deriveFrom`. `validateWhen: "payroll.seats > 0"` reads the value it is
        // validating — that is what a validation IS — and treating it as a
        // dependency would report every validated field as a one-node cycle and
        // block every publication. `deriveFrom: "payroll.seats + 1"` on
        // `payroll.seats` genuinely defines a value in terms of itself, and that
        // one stays a cycle.
        if (path !== id || slot === "deriveFrom") readable.add(path)
        // The edge is recorded either way: it is a real read, and the provenance
        // panel showing "why am I seeing this" needs it.
        edges.push({ from: id, to: path, via: slot })
        const target = declarations.get(path)
        if (!target) {
          if (!(path in contextTypes)) {
            // Unreachable in practice — `typeOf` already refuses an undeclared
            // name — but stated so a future change to the type environment
            // cannot make an unknown path silently readable.
            problems.push({
              step: 3,
              code: "type-error",
              at: `${id}.${slot}`,
              detail: `"${id}" rule "${slot}" reads "${path}", which is neither a declared node nor declared context.`,
            })
            continue
          }
          contextPaths.add(path)
          continue
        }
        if (target.namespace !== namespace && !visible.has(target.package)) {
          problems.push({
            step: 3,
            code: "cross-namespace-reference",
            at: `${id}.${slot}`,
            detail:
              `"${id}" (package "${pkg}") reads "${path}", declared by "${target.package}", which "${pkg}" ` +
              `does not depend on. A rule that reads outside its package closure has escaped its namespace.`,
          })
        }
      }
    }

    if (node.defaultValue !== undefined && !matchesType(node.defaultValue, node.type)) {
      problems.push({
        step: 3,
        code: "type-error",
        at: id,
        detail: `"${id}" is declared ${node.type} and its default is ${typeName(node.defaultValue)}.`,
      })
    }

    nodes.push({
      id,
      package: pkg,
      namespace,
      kind: node.kind,
      type: node.type,
      sensitivity: node.sensitivity ?? "internal",
      hasDefault: node.defaultValue !== undefined,
      ...(node.defaultValue !== undefined ? { defaultValue: node.defaultValue } : {}),
      rules: Object.fromEntries(RULE_SLOT_NAMES.filter((s) => node.rules?.[s] !== undefined).map((s) => [s, node.rules![s]!])),
      dependsOn: [...readable].sort(),
    })
  }

  // ── step 6: cycles, minimal · step 8: topological groups ───────────────────
  const adjacency = adjacencyOf(nodes.map((n) => [n.id, n.dependsOn] as const))
  const order = topologicalGroups(adjacency)
  const declaredIds = new Set(nodes.map((n) => n.id))
  const reviewed = new Set(fixedPointGroups.map((group) => [...group].sort().join(",")))

  for (const cycle of order.cycles) {
    // step 7 — a cycle is legal ONLY if it was reviewed as a monotonic
    // fixed-point group and named in the input.
    const members = cycle
      .split(" → ")
      .filter((m, index, all) => all.indexOf(m) === index)
      .sort()
      .join(",")
    if (reviewed.has(members)) continue
    problems.push({
      step: 6,
      code: "rule-cycle",
      detail:
        `Rules depend on each other in a cycle: ${cycle}. This is the shortest cycle through those nodes, ` +
        `so it is the smallest set of declarations that has to change. A fixed-point group is permitted only ` +
        `by a separately reviewed contract.`,
    })
  }
  if (fixedPointGroups.length > 0 && order.cycles.length === 0) {
    problems.push({
      step: 7,
      code: "fixed-point-group",
      detail:
        `${fixedPointGroups.length} fixed-point group(s) are declared and the graph has no cycle. A reviewed ` +
        `exemption for a cycle that no longer exists is an exemption nobody will notice becoming live again.`,
    })
  }

  const snapshot: GraphSnapshot = {
    compilerVersion: GRAPH_COMPILER_VERSION,
    expressionLanguageVersion: EXPRESSION_LANGUAGE_VERSION,
    packages: resolved.map(({ key, namespace, version, digest }) => ({ key, namespace, version, digest })),
    unversionedPackages: resolved.filter((r) => r.version === null).map((r) => r.key),
    nodes,
    edges: [...edges].sort((a, b) => stableStringify(a).localeCompare(stableStringify(b))),
    groups: order.groups.map((group) => group.filter((id) => declaredIds.has(id))).filter((group) => group.length > 0),
    unordered: order.unordered.filter((id) => declaredIds.has(id)),
    cycles: order.cycles,
    contextPaths: [...contextPaths].sort(),
    problems: [...problems].sort((a, b) => stableStringify(a).localeCompare(stableStringify(b))),
    publishable: problems.length === 0,
    digest: "",
  }
  snapshot.digest = digestOf(snapshot)

  // ── step 9: sign it, or say why it is unsigned ─────────────────────────────
  if (signWith) snapshot.signature = signSnapshot(snapshot.digest, signWith)
  else {
    snapshot.unsigned =
      "No signing key was supplied, so this snapshot's digest establishes only that its content is " +
      "unaltered — nothing about who compiled it. Set CONFIG_GRAPH_SIGNING_KEY_ID and CONFIG_GRAPH_SIGNING_SECRET."
  }

  return snapshot
}

function typeName(value: unknown): ExprType | "unsupported" {
  if (value === null) return "null"
  if (typeof value === "number") return "number"
  if (typeof value === "string") return "string"
  if (typeof value === "boolean") return "boolean"
  return "unsupported"
}

function matchesType(value: unknown, type: ExprType): boolean {
  return typeName(value) === type
}

// ── Evaluation ───────────────────────────────────────────────────────────────

export interface RuleTrace {
  node: string
  slot: RuleSlot
  expression: string
  /** Only the paths this rule actually read, with the values it read. */
  inputs: Readonly<Record<string, unknown>>
  output: unknown
  /** Evaluation steps charged, from the bounded evaluator. */
  steps: number
  /** Null when it evaluated. A message when it did not — never both. */
  error: string | null
  /** True when this trace was carried over from a previous evaluation. */
  reused: boolean
}

export interface NodeState {
  visible: boolean
  applicable: boolean
  enabled: boolean
  required: boolean
  valid: boolean
}

export interface Evaluation {
  graphDigest: string
  compilerVersion: string
  /** Node id → value. Absent when nothing supplied one and no rule derived one. */
  values: Readonly<Record<string, unknown>>
  states: Readonly<Record<string, NodeState>>
  traces: readonly RuleTrace[]
  /** Every evaluation error, in one list, for a caller that wants the verdict. */
  errors: readonly string[]
  /** Canonical digest of graph + inputs + outputs. Equal iff the outputs are equal. */
  outputDigest: string
}

const DEFAULT_STATE: NodeState = { visible: true, applicable: true, enabled: true, required: false, valid: true }

/**
 * Evaluate a snapshot over an input map. Server-authoritative — §11 step 10.
 *
 * Refuses a snapshot that did not compile. Evaluating one would produce numbers
 * from a graph whose ordering is not known to be possible, and the caller would
 * have an answer with no way to tell it apart from a real one.
 */
export function evaluateGraph(snapshot: GraphSnapshot, inputs: ValueEnv): Evaluation {
  if (!snapshot.publishable) {
    throw new GraphCompilerError(
      `Refusing to evaluate a snapshot with ${snapshot.problems.length} unresolved compilation problem(s). ` +
        `The first is: ${snapshot.problems[0]?.detail ?? "(none recorded)"}`,
    )
  }
  return evaluateNodes(snapshot, inputs, new Set(snapshot.nodes.map((n) => n.id)), null)
}

/**
 * Re-evaluate only what a change reached. §16 — "evaluate only affected
 * subgraphs after a change."
 *
 * `changed` names the input paths whose values differ. Everything downstream of
 * them is recomputed in dependency order; everything else is carried over from
 * `previous` and its traces are marked `reused`, so a reader can see what was
 * recomputed rather than having to trust that something was not.
 *
 * The result is asserted to equal a full evaluation over the same inputs — that
 * is what `graph-snapshot.test.ts` proves, because an incremental evaluator that
 * is merely fast is a correctness bug with a benchmark.
 */
export function reevaluateGraph(
  snapshot: GraphSnapshot,
  previous: Evaluation,
  inputs: ValueEnv,
  changed: readonly string[],
): Evaluation {
  if (previous.graphDigest !== snapshot.digest) {
    throw new GraphCompilerError(
      `Cannot re-evaluate incrementally across graph versions: the previous evaluation was against ` +
        `${previous.graphDigest} and this snapshot is ${snapshot.digest}. Recompile and evaluate in full.`,
    )
  }
  const adjacency = adjacencyOf(snapshot.nodes.map((n) => [n.id, n.dependsOn] as const))
  const affected = new Set(affectedSubgraph(adjacency, changed))
  return evaluateNodes(snapshot, inputs, affected, previous)
}

function evaluateNodes(
  snapshot: GraphSnapshot,
  inputs: ValueEnv,
  recompute: ReadonlySet<string>,
  previous: Evaluation | null,
): Evaluation {
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]))
  const ordered = [...snapshot.groups.flat(), ...snapshot.unordered]

  const values: Record<string, unknown> = {}
  const states: Record<string, NodeState> = {}
  const traces: RuleTrace[] = []
  const errors: string[] = []

  // Context paths are inputs, not nodes: they enter the environment as given.
  const env: Record<string, unknown> = {}
  for (const path of snapshot.contextPaths) {
    if (Object.hasOwn(inputs, path)) env[path] = inputs[path]
  }

  for (const id of ordered) {
    const node = byId.get(id)!

    if (previous && !recompute.has(id)) {
      // Carried over. The value is what it was, and the traces say so.
      if (Object.hasOwn(previous.values, id)) {
        values[id] = previous.values[id]
        env[id] = previous.values[id]
      }
      states[id] = previous.states[id] ?? { ...DEFAULT_STATE }
      for (const trace of previous.traces.filter((t) => t.node === id)) {
        traces.push({ ...trace, reused: true })
        if (trace.error) errors.push(`${trace.node}.${trace.slot}: ${trace.error}`)
      }
      continue
    }

    const state: NodeState = { ...DEFAULT_STATE }

    // The node's own value first: derived, supplied, or its default.
    const derive = node.rules.deriveFrom
    if (derive !== undefined) {
      const outcome = runRule(node.id, "deriveFrom", derive, env)
      traces.push(outcome.trace)
      if (outcome.trace.error) errors.push(`${node.id}.deriveFrom: ${outcome.trace.error}`)
      else {
        values[node.id] = outcome.trace.output
        env[node.id] = outcome.trace.output
      }
    } else if (Object.hasOwn(inputs, node.id)) {
      values[node.id] = inputs[node.id]
      env[node.id] = inputs[node.id]
    } else if (node.hasDefault) {
      values[node.id] = node.defaultValue
      env[node.id] = node.defaultValue
    }

    for (const slot of RULE_SLOT_NAMES) {
      if (slot === "deriveFrom") continue
      const source = node.rules[slot]
      if (source === undefined) continue
      const outcome = runRule(node.id, slot, source, env)
      traces.push(outcome.trace)
      if (outcome.trace.error) {
        errors.push(`${node.id}.${slot}: ${outcome.trace.error}`)
        // A rule that could not be evaluated does not get to decide. Left at its
        // default, and the error is what says the state is not authoritative —
        // the alternative, defaulting a failed `validateWhen` to false, would
        // report a value invalid because a rule crashed.
        continue
      }
      const decided = outcome.trace.output as boolean
      if (slot === "visibleWhen") state.visible = decided
      else if (slot === "enabledWhen") state.enabled = decided
      else if (slot === "requiredWhen") state.required = decided
      else if (slot === "applicableWhen") state.applicable = decided
      else if (slot === "validateWhen") state.valid = decided
    }

    states[node.id] = state
  }

  // Key order is handled by `stableStringify` inside `canonicalDigest` rather
  // than by sorting here. Sorting the inputs as well would be a second answer to
  // the same question, and — worse — it would leave the canonical serialiser
  // untested on the one input whose key order a caller controls, so a change from
  // `stableStringify` to `JSON.stringify` would pass every test in this file.
  // `values` and `states` also reach the digest through it, which is what makes an
  // incremental evaluation's digest equal a full one's even if the two ever built
  // their maps in different orders.
  const outputDigest = canonicalDigest({ graph: snapshot.digest, inputs, values, states })

  return {
    graphDigest: snapshot.digest,
    compilerVersion: snapshot.compilerVersion,
    values,
    states,
    traces: [...traces].sort((a, b) => (a.node === b.node ? a.slot.localeCompare(b.slot) : a.node.localeCompare(b.node))),
    errors: [...errors].sort(),
    outputDigest,
  }
}

function runRule(node: string, slot: RuleSlot, source: string, env: Record<string, unknown>): { trace: RuleTrace } {
  const ast = parseExpression(source)
  const read = dependencies(ast)
  const inputs = Object.fromEntries(read.filter((p) => Object.hasOwn(env, p)).map((p) => [p, env[p]]))
  try {
    const { value, steps } = evaluate(ast, env)
    return { trace: { node, slot, expression: source, inputs, output: value, steps, error: null, reused: false } }
  } catch (error) {
    return {
      trace: {
        node,
        slot,
        expression: source,
        inputs,
        output: null,
        steps: 0,
        error: error instanceof ExpressionError ? `${error.phase}: ${error.message}` : String(error),
        reused: false,
      },
    }
  }
}

// ── §11 step 10: two projections, one snapshot ───────────────────────────────

export interface PresentationNode {
  id: string
  kind: NodeKind
  type: ExprType
  sensitivity: NodeSensitivity
  /** Only the client-safe slots. `deriveFrom` and `validateWhen` are never here. */
  rules: Readonly<Partial<Record<RuleSlot, string>>>
  dependsOn: readonly string[]
}

export interface PresentationProjection {
  graphDigest: string
  compilerVersion: string
  nodes: readonly PresentationNode[]
  groups: readonly (readonly string[])[]
  /** Nodes withheld entirely, and why. Named, so the client knows its view is partial. */
  withheld: readonly { id: string; reason: string }[]
  /** Slots withheld from nodes that ARE present. */
  serverOnlySlots: readonly RuleSlot[]
}

/**
 * The projection a browser may have.
 *
 * §11 step 10 and §10: "The browser may evaluate client-safe presentation rules
 * for responsiveness, but the server remains authoritative and returns the
 * evaluated state and trace."
 *
 * Two rules decide what crosses:
 *
 *   * Only the presentation slots. A `validateWhen` or `deriveFrom` source
 *     shipped to a browser is a policy published as a hint — the client can then
 *     compute what the server would decide, and any difference reads as a bug
 *     rather than as the server being in charge.
 *   * No `confidential` or `secret` node at all, and no node whose rules READ
 *     one. Sending the rule without the value looks safe and is not: a rule like
 *     `salary > 100000` is a bisection oracle that recovers the value it was
 *     supposed to protect.
 *
 * Withheld nodes are LISTED. A client that silently receives 40 of 60 nodes
 * renders a form missing twenty fields and nothing says so.
 */
export function presentationProjection(snapshot: GraphSnapshot): PresentationProjection {
  const clientSlots = RULE_SLOT_NAMES.filter((slot) => RULE_SLOTS[slot].audience === "client-safe")
  const serverSlots = RULE_SLOT_NAMES.filter((slot) => RULE_SLOTS[slot].audience === "server-authoritative")
  const protectedIds = new Set(
    snapshot.nodes.filter((n) => n.sensitivity === "confidential" || n.sensitivity === "secret").map((n) => n.id),
  )

  const withheld: { id: string; reason: string }[] = []
  const nodes: PresentationNode[] = []

  for (const node of snapshot.nodes) {
    if (protectedIds.has(node.id)) {
      withheld.push({ id: node.id, reason: `declared ${node.sensitivity}` })
      continue
    }
    const leak = node.dependsOn.find((path) => protectedIds.has(path))
    if (leak) {
      withheld.push({
        id: node.id,
        reason: `its rules read "${leak}", which is protected; a rule over a protected value discloses it by inference`,
      })
      continue
    }
    nodes.push({
      id: node.id,
      kind: node.kind,
      type: node.type,
      sensitivity: node.sensitivity,
      rules: Object.fromEntries(clientSlots.filter((s) => node.rules[s] !== undefined).map((s) => [s, node.rules[s]!])),
      dependsOn: node.dependsOn,
    })
  }

  const present = new Set(nodes.map((n) => n.id))
  return {
    graphDigest: snapshot.digest,
    compilerVersion: snapshot.compilerVersion,
    nodes,
    groups: snapshot.groups.map((group) => group.filter((id) => present.has(id))).filter((group) => group.length > 0),
    withheld: [...withheld].sort((a, b) => a.id.localeCompare(b.id)),
    serverOnlySlots: serverSlots,
  }
}

/**
 * The compilation problems a publication must block on, and only those.
 *
 * `planPublication` already reports package-level cycles and unresolved
 * dependencies through `allRejections` — the same `moduleGraphRejections` this
 * compiler delegates to. Returning them here as well would show an operator the
 * same defect twice and make the count of blockers meaningless, so this filters
 * to the problems only the graph compiler can find.
 */
export function snapshotBlockers(snapshot: GraphSnapshot): readonly string[] {
  const alreadyReported = new Set(["package-cycle", "unresolved-dependency"])
  return snapshot.problems
    .filter((problem) => !alreadyReported.has(problem.code))
    .map((problem) => `Graph compilation (Bible §11 step ${problem.step}, ${problem.code}): ${problem.detail}`)
}

export type { Adjacency }
