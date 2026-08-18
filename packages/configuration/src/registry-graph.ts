import type { ConfigRegistry } from "./definition"
import type { ExprType, ValueEnv } from "./expression"
import type { DeclaredNode, PackageManifest, RuleSlot } from "./graph-snapshot"
import type { ModuleLike } from "./rejections"

/**
 * CFG-020 / CFG-030 — the bridge that gives the configuration graph its nodes.
 *
 * `compileGraph` has always been able to compile a package closure. What it
 * received in production was the module catalogue, whose manifests declare
 * dependencies and capabilities and *no configuration nodes at all* — so the
 * live snapshot compiled a graph of zero nodes, and evaluating it, projecting it
 * or replaying it would have been arithmetic over an empty set. The tenant's
 * actual configurable fields were somewhere else entirely: the `ConfigRegistry`,
 * where each `ConfigDefinition` states a key, an owner, a default, a
 * sensitivity, whether it is overridable, what capability setting it takes and
 * whether it means anything outside live mode.
 *
 * This module turns those definitions into `DeclaredNode`s under their owner's
 * namespace, and — the part that matters — derives RULES from the flags that
 * already decide the same things imperatively elsewhere:
 *
 *   * `overridable: false` becomes `enabledWhen: "false"`. A key pinned to its
 *     default is a control nobody may move, and a form that renders it editable
 *     is a form that collects a decision the resolver will discard.
 *   * `requiresCapability` becomes `enabledWhen: "context.capability.<cap> ==
 *     true"`. `planPublication` already REFUSES a proposal touching such a key
 *     from a principal without the capability; the rule is the same predicate
 *     said in the client-safe half of the graph, so the control is disabled
 *     rather than the submission being rejected after the fact. Both read
 *     `definition.requiresCapability` — one source of truth, two surfaces, and
 *     `registry-graph.test.ts` pins that they agree.
 *   * `liveOnly: true` becomes `applicableWhen: "<mode key> == \"live\""`,
 *     against the tenant's CURRENT mode, which is the ordering `planPublication`
 *     documents at its own live-only blocker.
 *
 * ## What it will not do
 *
 * A definition whose default is an object or an array has no node. The graph's
 * type system is four scalars (`ExprType`), which is CFG-020-001's stated gap,
 * and a node typed as something the expression language cannot compare would
 * make every rule over it a type error at compile time. Those keys are NAMED in
 * `unrepresentable` with the reason, and the reason is carried onto the
 * publication plan, because "this key has no node" and "this registry has no
 * nodes" are different facts and a caller that saw neither could not tell them
 * apart.
 */

/** A registry key that could not become a graph node, and why. */
export interface UnrepresentableKey {
  key: string
  owner: string
  reason: string
}

export interface RegistryGraph {
  /** Package manifests to compile: the modules, with declarations attached. */
  packages: readonly PackageManifest[]
  /** Context paths the derived rules read, with their types. */
  contextTypes: Readonly<Record<string, ExprType>>
  /** Registry keys that became nodes, sorted. */
  declaredKeys: readonly string[]
  /** Registry keys that did not, with the reason each was refused. */
  unrepresentable: readonly UnrepresentableKey[]
}

export interface RegistryGraphOptions {
  /**
   * The key whose value decides live mode. A `liveOnly` definition gets an
   * `applicableWhen` rule against it — but only when both sit in the same
   * namespace, because a rule reading across namespaces is refused by the
   * compiler (§11 step 5) and emitting one would block every publication.
   */
  liveModeKey?: string
  /** The value of `liveModeKey` that means live. Defaults to `"live"`. */
  liveModeValue?: string
}

export const CAPABILITY_CONTEXT_PREFIX = "context.capability."

/** Path segments the expression tokenizer accepts as a name. */
const SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/

const namespaceOf = (key: string): string => key.slice(0, key.indexOf("."))

/**
 * The context path a capability check reads.
 *
 * One function, so the declaration side and the input side cannot disagree
 * about the spelling — a rule reading `context.capability.x` against an input
 * map that spells it `context.capabilities.x` evaluates to an error and the
 * field is disabled for everyone, which looks exactly like a permissions bug.
 */
export function capabilityPath(capability: string): string {
  return `${CAPABILITY_CONTEXT_PREFIX}${capability}`
}

function exprTypeOfDefault(value: unknown): ExprType | null {
  if (value === null) return "null"
  switch (typeof value) {
    case "string":
      return "string"
    case "number":
      return Number.isFinite(value) ? "number" : null
    case "boolean":
      return "boolean"
    default:
      return null
  }
}

function describeDefault(value: unknown): string {
  if (Array.isArray(value)) return "an array"
  if (value === undefined) return "undefined"
  if (typeof value === "object") return "an object"
  if (typeof value === "number") return "a non-finite number"
  return `a ${typeof value}`
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

/**
 * Compile-ready package manifests for a registry, merged onto a module catalogue.
 *
 * Declarations are attached to the module that owns them where one exists, and
 * otherwise a manifest is synthesised for the owner (`platform` owns every key
 * in the current registry and is not a module). The synthesised manifest states
 * no version, which the snapshot reports in `unversionedPackages` rather than
 * digesting as though it were versioned — a registry is not a released package
 * and inventing a version number for it would put a false guarantee in the
 * digest.
 */
export function registryGraphInput(
  registry: ConfigRegistry,
  modules: readonly ModuleLike[] = [],
  options: RegistryGraphOptions = {},
): RegistryGraph {
  const { liveModeKey, liveModeValue = "live" } = options

  const declaresByOwner = new Map<string, DeclaredNode[]>()
  const contextTypes: Record<string, ExprType> = {}
  const declaredKeys: string[] = []
  const unrepresentable: UnrepresentableKey[] = []

  const liveModeNamespace = liveModeKey ? namespaceOf(liveModeKey) : null

  // Namespacing is not re-checked here. `validateDefinition` (definition.ts:148)
  // already refuses a definition whose key is not prefixed by its owner, and
  // `ConfigRegistry.of` runs it over every entry — so a registry that reaches
  // this function cannot contain one. A second check would be a branch no input
  // can reach, which is worse than no check: it reads as a guarantee this module
  // provides and is never exercised. `registry-graph.test.ts` pins the invariant
  // where it actually lives.
  for (const definition of registry.all()) {
    const { key, owner } = definition

    const type = exprTypeOfDefault(definition.default)
    if (type === null) {
      unrepresentable.push({
        key,
        owner,
        reason:
          `its default is ${describeDefault(definition.default)}, and a graph node carries one of four ` +
          `scalar types. The structural vocabulary that would type it is CFG-020-001 and does not exist ` +
          `yet, so this key has no node, no rules and no evaluated state.`,
      })
      continue
    }

    const rules: Partial<Record<RuleSlot, string>> = {}

    if (!definition.overridable) {
      rules.enabledWhen = "false"
    } else if (definition.requiresCapability) {
      const capability = definition.requiresCapability
      if (capability.split(".").every((segment) => SEGMENT.test(segment))) {
        const path = capabilityPath(capability)
        rules.enabledWhen = `${path} == true`
        contextTypes[path] = "boolean"
      } else {
        unrepresentable.push({
          key,
          owner,
          reason:
            `it requires the capability "${capability}", whose name is not a readable expression path, so ` +
            `the enablement rule was not derived. The key still has a node; only the rule is missing. ` +
            `\`planPublication\` still refuses a proposal touching it without the capability.`,
        })
      }
    }

    if (definition.liveOnly && liveModeKey) {
      if (liveModeNamespace === namespaceOf(key) && registry.has(liveModeKey)) {
        rules.applicableWhen = `${liveModeKey} == ${quote(liveModeValue)}`
      } else {
        unrepresentable.push({
          key,
          owner,
          reason:
            `it is live-only, but the mode key "${liveModeKey}" is ${
              registry.has(liveModeKey) ? "in another namespace" : "not in this registry"
            }, so no applicability rule was derived. The key still has a node; \`planPublication\` still ` +
            `blocks a live-only value published while the tenant is in test mode.`,
        })
      }
    }

    const node: DeclaredNode = {
      id: key,
      kind: "question",
      type,
      sensitivity: definition.sensitivity,
      defaultValue: definition.default,
      ...(Object.keys(rules).length > 0 ? { rules } : {}),
    }

    const list = declaresByOwner.get(owner)
    if (list) list.push(node)
    else declaresByOwner.set(owner, [node])
    declaredKeys.push(key)
  }

  const byKey = new Map(modules.map((m) => [m.key, m]))
  const packages: PackageManifest[] = modules.map((module) => {
    const declares = declaresByOwner.get(module.key)
    return declares ? { ...module, declares } : { ...module }
  })
  for (const [owner, declares] of declaresByOwner) {
    if (byKey.has(owner)) continue
    packages.push({ key: owner, namespace: owner, declares })
  }

  return {
    packages: packages.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    contextTypes,
    declaredKeys: [...declaredKeys].sort(),
    unrepresentable: [...unrepresentable].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  }
}

/**
 * The input environment for one evaluation of that graph.
 *
 * Only keys that BECAME nodes are carried: passing a value for a key the graph
 * does not declare would put a value in the digest that no rule can read, and
 * two callers disagreeing about which unrepresentable keys to include would
 * produce different `outputDigest`s for the same configuration.
 *
 * Every declared capability path is present, `true` or `false`. Absent is not
 * the same as false: an absent path makes its rule fail to evaluate, and a
 * failed rule is recorded as an error rather than as a decision — so an operator
 * with no capabilities would see errors where they should see disabled fields.
 */
export function registryInputs(
  graph: RegistryGraph,
  values: Readonly<Record<string, unknown>>,
  heldCapabilities: readonly string[] = [],
): ValueEnv {
  const held = new Set(heldCapabilities)
  const inputs: Record<string, unknown> = {}
  for (const key of graph.declaredKeys) {
    if (Object.hasOwn(values, key)) inputs[key] = values[key]
  }
  for (const path of Object.keys(graph.contextTypes)) {
    if (!path.startsWith(CAPABILITY_CONTEXT_PREFIX)) continue
    inputs[path] = held.has(path.slice(CAPABILITY_CONTEXT_PREFIX.length))
  }
  return inputs
}

/** The registry keys whose values a change touched, restricted to graph nodes. */
export function changedNodes(graph: RegistryGraph, keys: readonly string[]): readonly string[] {
  const declared = new Set(graph.declaredKeys)
  return [...new Set(keys.filter((key) => declared.has(key)))].sort()
}
