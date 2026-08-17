import { layerRank, type LayerKind, type VersionedLayer } from "./layer-schema"
import { ExpressionError, parse as parseExpression, typeOf, type TypeEnv } from "./expression"
import { adjacencyOf, minimalCyclePaths, type Adjacency } from "./graph"

/**
 * GE-031-004 — what the renderer refuses.
 *
 * Bible §7.1: "The renderer rejects ambiguous precedence, unknown fields,
 * dependency cycles, invalid permission references, unreachable workflows,
 * missing translations, unsafe expressions, and entitlements the tenant has not
 * purchased."
 *
 * Eight rejections. `resolve.ts` already refuses unknown fields, disallowed
 * scopes, un-overridable keys, values that fail their schema and merges that
 * cannot be performed. This module adds the ones that need to look across
 * layers or outside the registry, and it is explicit about the two that have
 * nothing to check yet rather than shipping a validator for absent data.
 *
 * ## Two are not implementable yet, and pretending otherwise is the failure
 *
 * **Unreachable workflows** and **missing required translations** both need a
 * domain that does not exist: `workflows` and the translation catalog are
 * `reserved` in `domains.ts`, with the items that will fill them. A validator
 * over an empty namespace passes on every input, which is the shape of check
 * that reads green and proves nothing — the thing §4 of the execution prompt
 * disqualifies. `UNIMPLEMENTED_REJECTIONS` names them and the item that brings
 * the data, and a test asserts the list shrinks rather than grows.
 */

/** Rejections the Bible requires that cannot be checked until their data exists. */
export const UNIMPLEMENTED_REJECTIONS: Readonly<Record<string, string>> = {
  "unreachable workflows":
    "the `workflows` domain is reserved (GE-036); there are no workflow definitions to walk",
  "missing required translations":
    "there is no translation catalog yet; `localization` carries locale and calendar, not message bundles (GE-022-004 extends it)",
}

export interface Rejection {
  rule:
    | "ambiguous-precedence"
    | "dependency-cycle"
    | "missing-dependency"
    | "invalid-reference"
    | "unsafe-expression"
    | "unentitled-feature"
  /** What is wrong, in the terms of whoever has to fix it. */
  detail: string
  /** The layer at fault, where one layer is at fault. */
  layerId?: string
  key?: string
}

/**
 * Two layers of the same rank contesting the same key.
 *
 * `orderLayers` already breaks ties deterministically — by id, then version
 * descending — so this is not a crash, and that is exactly why it needs
 * reporting. Determinism is not the same as being unambiguous: two org-unit
 * overlays that both set a seat limit resolve to whichever id sorts first, and
 * the operator who wrote the losing one gets no error, no warning, and a value
 * they did not choose.
 *
 * Reported rather than thrown. Which of the two is correct is a decision for
 * whoever published them, and refusing the whole resolution would take a tenant
 * down over a conflict that has a defined outcome.
 */
export function ambiguousPrecedence(layers: readonly VersionedLayer[]): readonly Rejection[] {
  const byRankAndKey = new Map<string, { id: string; kind: LayerKind }[]>()

  for (const layer of layers) {
    for (const key of Object.keys(layer.values)) {
      const bucket = `${layerRank(layer.kind)}\u0000${key}`
      const existing = byRankAndKey.get(bucket) ?? []
      existing.push({ id: layer.id, kind: layer.kind })
      byRankAndKey.set(bucket, existing)
    }
  }

  const rejections: Rejection[] = []
  for (const [bucket, contenders] of byRankAndKey) {
    if (contenders.length < 2) continue
    const key = bucket.split("\u0000")[1]
    // Same layer id twice at one rank is an immutability or replication
    // problem, not a precedence one — `immutabilityBreaches` owns that.
    const distinct = [...new Set(contenders.map((c) => c.id))]
    if (distinct.length < 2) continue
    rejections.push({
      rule: "ambiguous-precedence",
      key,
      detail:
        `${distinct.length} layers of equal precedence set "${key}": ${distinct.sort().join(", ")}. ` +
        `The tie breaks on id, so the outcome is deterministic and arbitrary — one author's value ` +
        `wins for a reason unrelated to the configuration.`,
    })
  }
  return rejections
}

/** The shape this module needs from a module manifest. Structural, so `@tenure/modules` is not a dependency. */
export interface ModuleLike {
  key: string
  /**
   * What this module needs. `module` names a module key OR a capability some
   * module `provides`; `optional` means the system works without it.
   *
   * It was `readonly string[]` and that made this check quietly wrong once
   * dependencies gained version ranges and alternatives (PACK-010-002,
   * PACK-030-003): a dependency on `finance.ledger` would have been reported
   * here as naming a module that does not exist, because the module that
   * satisfies it does so by providing the capability rather than by being it.
   */
  dependsOn?: readonly { module: string; kind?: string }[]
  /** Capabilities this module supplies, which another's `dependsOn` may name. */
  provides?: readonly string[]
  /** The entitlement a plan must grant for this module to be enabled. */
  entitlement?: string
}

/**
 * Which modules could satisfy a dependency target — the key itself, or every
 * provider of it.
 *
 * Exported because the graph compiler (`graph-snapshot.ts`) needs the same
 * answer, and a dependency that names a CAPABILITY rather than a module key is
 * exactly the case a second resolver would get wrong: `reimbursements` depends on
 * `finance.ledger`, which `budgeting` provides, and a resolver that only knows
 * keys reports a dangling reference that blocks every publication.
 */
export function satisfiersOf(modules: readonly ModuleLike[], target: string): string[] {
  if (modules.some((m) => m.key === target)) return [target]
  return modules.filter((m) => (m.provides ?? []).includes(target)).map((m) => m.key)
}

/**
 * The module graph as edges: module → the modules it depends on.
 *
 * Targets nothing satisfies are OMITTED rather than added as empty nodes. They
 * are reported separately as `invalid-reference`, and inventing a node for a
 * module that is not in the catalogue would put a phantom into every topological
 * order taken over these edges.
 */
export function dependencyAdjacency(modules: readonly ModuleLike[]): Adjacency {
  return adjacencyOf(
    modules.map(
      (module) =>
        [
          module.key,
          (module.dependsOn ?? []).flatMap((dependency) => satisfiersOf(modules, dependency.module)),
        ] as const,
    ),
  )
}

/**
 * Cycles and missing links in the module graph.
 *
 * A cycle is not a configuration error a tenant can see: it is a catalogue
 * error that makes "enable A" unanswerable, because A needs B needs A and
 * neither can start first. Depth-first with an explicit stack so the cycle is
 * reported as the path that forms it rather than as "a cycle exists somewhere".
 */
export function moduleGraphRejections(
  modules: readonly ModuleLike[],
  enabled: readonly string[],
): readonly Rejection[] {
  const byKey = new Map(modules.map((m) => [m.key, m]))
  const rejections: Rejection[] = []
  const satisfiers = (target: string): string[] => satisfiersOf(modules, target)

  // Every dependency names something that exists — a module, or a capability
  // some module supplies.
  for (const module of modules) {
    for (const dependency of module.dependsOn ?? []) {
      if (satisfiers(dependency.module).length === 0) {
        rejections.push({
          rule: "invalid-reference",
          detail: `Module "${module.key}" depends on "${dependency.module}", which is not in the catalogue.`,
        })
      }
    }
  }

  // Cycles, reported once per cycle and as the MINIMAL path through it.
  //
  // This was twenty lines of depth-first search here and another twenty in
  // `expression.ts`, and both answered a question Bible §11 step 6 does not ask:
  // they reported whichever cycle the traversal order closed first, not the
  // shortest one. Given `a → b → c → a` and also `a → c`, the depth-first answer
  // sent an operator to look at `b`, which is not part of the smallest set of
  // declarations that has to change. Both now delegate to `graph.ts`, so there is
  // one detector rather than three.
  for (const cycle of minimalCyclePaths(dependencyAdjacency(modules))) {
    rejections.push({
      rule: "dependency-cycle",
      detail: `Modules depend on each other in a cycle: ${cycle}. Neither can be enabled first.`,
    })
  }

  // An enabled module whose dependency is not enabled. Distinct from a missing
  // catalogue entry: the module exists, it is simply not switched on, and the
  // fix is a different one.
  const enabledSet = new Set(enabled)
  for (const key of enabled) {
    if (!byKey.has(key)) {
      rejections.push({
        rule: "invalid-reference",
        detail: `Configuration enables "${key}", which is not a module.`,
      })
      continue
    }
    for (const dependency of byKey.get(key)!.dependsOn ?? []) {
      // An optional dependency that is switched off is the case it exists for,
      // not a rejection.
      if (dependency.kind === "optional") continue
      if (!satisfiers(dependency.module).some((s) => enabledSet.has(s))) {
        rejections.push({
          rule: "missing-dependency",
          detail: `"${key}" is enabled but depends on "${dependency.module}", which is not.`,
        })
      }
    }
  }

  return rejections
}

/**
 * Values that look like an expression.
 *
 * Decided by the engine (GE-031-005), not by a regular expression. The
 * distinction matters in both directions: a well-formed expression over
 * declared names is safe and refusing it anyway would mean the language exists
 * and cannot be used, while `${tenant.constructor}` is a parse-time refusal
 * with a reason rather than an opaque "unsafe".
 *
 * Without a declared environment every template is still refused. An expression
 * that cannot be checked against anything is one nobody can say anything about,
 * and storing it makes the string a literal now and an evaluated expression the
 * day someone supplies an environment — the same configuration changing meaning
 * with no diff and no deploy.
 *
 * Scanned inside arrays and nested objects too, because a template one level
 * down is the one nobody looks at.
 */
export function unsafeExpressions(
  layers: readonly VersionedLayer[],
  /** The names an expression may read, with their types. See above for why omitting it refuses everything. */
  types?: TypeEnv,
): readonly Rejection[] {
  const rejections: Rejection[] = []
  const TEMPLATE = /\$\{([^}]*)\}/g

  const scan = (value: unknown, layerId: string, key: string) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(TEMPLATE)) {
        if (!types) {
          rejections.push({
            rule: "unsafe-expression",
            layerId,
            key,
            detail:
              `"${key}" contains an expression and no environment was declared for it, so nothing ` +
              `can be said about what it reads or what it returns.`,
          })
          continue
        }
        try {
          typeOf(parseExpression(match[1]), types)
        } catch (error) {
          const reason = error instanceof ExpressionError ? `${error.phase}: ${error.message}` : String(error)
          rejections.push({
            rule: "unsafe-expression",
            layerId,
            key,
            detail: `"${key}" contains an expression that will not run — ${reason}`,
          })
        }
      }
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) scan(item, layerId, key)
      return
    }
    if (value && typeof value === "object") {
      for (const nested of Object.values(value)) scan(nested, layerId, key)
    }
  }

  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer.values)) scan(value, layer.id, key)
  }
  return rejections
}

/**
 * Features a layer switches on that the tenant has not bought.
 *
 * Bible §14: "Frontend entitlements improve UX but never provide security." So
 * this is not the enforcement point — the module runtime is — and it exists to
 * stop the configuration from being *published* in a state that claims
 * something the contract does not support. A tenant whose console shows a
 * module enabled while every request for it is refused has a worse experience
 * than one where it never appeared.
 */
export function unentitledFeatures(
  modules: readonly ModuleLike[],
  enabled: readonly string[],
  entitlements: readonly string[],
): readonly Rejection[] {
  const held = new Set(entitlements)
  const byKey = new Map(modules.map((m) => [m.key, m]))

  return enabled
    .map((key) => byKey.get(key))
    .filter((m): m is ModuleLike => m !== undefined && m.entitlement !== undefined)
    .filter((m) => !held.has(m.entitlement!))
    .map((m) => ({
      rule: "unentitled-feature" as const,
      detail: `"${m.key}" is enabled but needs entitlement "${m.entitlement}", which this tenant's plan does not grant.`,
    }))
}

/** Everything, in one pass, for a caller that wants a single verdict. */
export function allRejections(input: {
  layers: readonly VersionedLayer[]
  modules?: readonly ModuleLike[]
  enabledModules?: readonly string[]
  entitlements?: readonly string[]
}): readonly Rejection[] {
  const { layers, modules = [], enabledModules = [], entitlements = [] } = input
  return [
    ...ambiguousPrecedence(layers),
    ...unsafeExpressions(layers),
    ...moduleGraphRejections(modules, enabledModules),
    ...unentitledFeatures(modules, enabledModules, entitlements),
  ]
}
