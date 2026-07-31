import { createHash } from "node:crypto"

import type { ConfigDefinition, ConfigRegistry } from "./definition"
import type { ConfigScope } from "./scopes"
import { scopeRank } from "./scopes"
import { mergeValues, stableStringify } from "./merge"

/**
 * One set of overrides, attributed to where it came from.
 *
 * `id` names the specific tenant, org unit or user — not the scope. Several
 * layers may share a scope: an organization hierarchy contributes one `orgUnit`
 * layer per node from root to leaf, and they must apply in that order so a
 * department can narrow what its school set. Callers supply that order.
 */
export interface ConfigLayer {
  scope: ConfigScope
  /** Which entity at that scope, e.g. a tenant id or an org-unit id. */
  id: string
  /** Optional human label for traces. */
  label?: string
  values: Readonly<Record<string, unknown>>
}

/** Where a resolved value came from. The answer to "why is it set to that?". */
export interface Provenance {
  key: string
  /** Layers that contributed, lowest precedence first. Empty means the default. */
  contributors: Array<{ scope: ConfigScope; id: string; label?: string; value: unknown }>
  usedDefault: boolean
}

export interface ResolutionProblem {
  key: string
  scope: ConfigScope
  layerId: string
  reason:
    | "unknown-key"
    | "scope-not-allowed"
    | "not-overridable"
    | "invalid-value"
    | "invalid-result"
    | "merge-failed"
    | "layers-out-of-order"
  detail: string
}

export class ConfigResolutionError extends Error {
  readonly problems: readonly ResolutionProblem[]

  constructor(problems: readonly ResolutionProblem[]) {
    super(
      `Configuration did not resolve (${problems.length} problem${problems.length === 1 ? "" : "s"}):\n` +
        problems.map((p) => `  [${p.reason}] ${p.key} @ ${p.scope}/${p.layerId}: ${p.detail}`).join("\n"),
    )
    this.name = "ConfigResolutionError"
    this.problems = problems
  }
}

export interface ResolvedConfig {
  /** Every defined key, with its effective value. Frozen. */
  readonly values: Readonly<Record<string, unknown>>
  /** Per-key attribution. Frozen. */
  readonly provenance: Readonly<Record<string, Provenance>>
  /**
   * Content hash of the resolved values, over a key-sorted encoding.
   *
   * Two resolutions that agree on every value produce the same checksum
   * regardless of the order layers arrived in. That is what lets a release
   * record what a system was configured as, and lets a cache key be honest.
   */
  readonly checksum: string
  /** Typed read. Throws on an unknown key rather than returning undefined. */
  get<T = unknown>(key: string): T
  explain(key: string): Provenance
}

export interface ResolveOptions {
  /**
   * Report problems instead of throwing.
   *
   * Off by default, and should stay off in request paths. A tenant whose
   * configuration is invalid must fail loudly: the alternative is serving them
   * platform defaults while their own settings are silently discarded, which
   * looks like the product ignoring them and reads in logs as success.
   *
   * The Studio turns it on to show every problem in a draft at once.
   */
  collectProblems?: boolean
}

export interface ResolveResult {
  config: ResolvedConfig | null
  problems: ResolutionProblem[]
}

/**
 * Fold layers over defaults, in precedence order, into one effective configuration.
 *
 * Fails closed. An override naming a key nobody defined, set at a scope its
 * definition forbids, or failing its schema, stops resolution — it does not fall
 * back to the default. Falling back would mean an admin's setting could vanish
 * because of a typo, with the system reporting itself healthy.
 */
export function resolveConfig(
  registry: ConfigRegistry,
  layers: readonly ConfigLayer[],
  options: ResolveOptions = {},
): ResolveResult {
  const problems: ResolutionProblem[] = []

  // Layers must already be in precedence order. Sorting them here would hide a
  // caller bug — and would be wrong anyway, because several layers legitimately
  // share a scope (an org-unit chain) and their relative order carries meaning
  // that a stable sort by scope cannot recover.
  for (let i = 1; i < layers.length; i++) {
    const prev = layers[i - 1]
    const cur = layers[i]
    if (scopeRank(cur.scope) < scopeRank(prev.scope)) {
      problems.push({
        key: "(layers)",
        scope: cur.scope,
        layerId: cur.id,
        reason: "layers-out-of-order",
        detail:
          `Layer ${cur.scope}/${cur.id} follows ${prev.scope}/${prev.id}, which is higher precedence. ` +
          `Supply layers lowest-precedence first; within one scope, ancestors before descendants.`,
      })
    }
  }

  const values: Record<string, unknown> = {}
  const provenance: Record<string, Provenance> = {}

  for (const def of registry.all()) {
    values[def.key] = def.default
    provenance[def.key] = { key: def.key, contributors: [], usedDefault: true }
  }

  for (const layer of layers) {
    for (const [key, rawValue] of Object.entries(layer.values)) {
      // Not "unset". Treating it as a delete would make the resolved shape depend
      // on whether a caller spread an object containing holes.
      if (rawValue === undefined) continue

      const def = registry.get(key)
      if (!def) {
        problems.push({
          key,
          scope: layer.scope,
          layerId: layer.id,
          reason: "unknown-key",
          detail: `No definition. A key must be declared before it can be set.`,
        })
        continue
      }

      if (!def.overridable) {
        problems.push({
          key,
          scope: layer.scope,
          layerId: layer.id,
          reason: "not-overridable",
          detail: `Pinned to its default by its definition.`,
        })
        continue
      }

      if (!def.allowedScopes.includes(layer.scope)) {
        problems.push({
          key,
          scope: layer.scope,
          layerId: layer.id,
          reason: "scope-not-allowed",
          detail: `Allowed at ${def.allowedScopes.join(", ") || "(none)"}; not at ${layer.scope}.`,
        })
        continue
      }

      // Under deepMerge a layer supplies a *fragment*, not a whole value: an
      // org unit sets `{ logoUrl }` and inherits `primary` from its tenant.
      // Parsing that fragment against the full schema would reject it for
      // missing the fields it is deliberately not restating, which makes
      // partial override — the entire reason deepMerge exists — impossible.
      //
      // So fragments are shape-checked here and the *merged* value is validated
      // below, once, against the full schema. Nothing weakens: a fragment that
      // introduces a bad field still fails, it just fails as a result.
      let contribution: unknown
      if (def.mergeStrategy === "deepMerge") {
        if (typeof rawValue !== "object" || rawValue === null || Array.isArray(rawValue)) {
          problems.push({
            key,
            scope: layer.scope,
            layerId: layer.id,
            reason: "invalid-value",
            detail: `deepMerge expects an object fragment, got ${
              Array.isArray(rawValue) ? "array" : typeof rawValue
            }.`,
          })
          continue
        }
        contribution = rawValue
      } else {
        const parsed = def.type.safeParse(rawValue)
        if (!parsed.success) {
          problems.push({
            key,
            scope: layer.scope,
            layerId: layer.id,
            reason: "invalid-value",
            detail: parsed.error.issues
              .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
              .join("; "),
          })
          continue
        }
        contribution = parsed.data
      }

      try {
        values[key] = mergeValues(def.mergeStrategy, values[key], contribution)
      } catch (err) {
        problems.push({
          key,
          scope: layer.scope,
          layerId: layer.id,
          reason: "merge-failed",
          detail: err instanceof Error ? err.message : String(err),
        })
        continue
      }

      provenance[key].contributors.push({
        scope: layer.scope,
        id: layer.id,
        label: layer.label,
        value: contribution,
      })
      provenance[key].usedDefault = false
    }
  }

  // The effective value is what the system will actually run on, and no single
  // layer necessarily equals it. A merge can land somewhere no contributor did:
  // deepMerge assembles a whole object out of fragments, and intersectSet can
  // empty a list that every layer wanted non-empty. Validating only the inputs
  // would let those through.
  for (const def of registry.all()) {
    const provenanceEntry = provenance[def.key]
    if (provenanceEntry.usedDefault) continue // the default was validated at registration

    const parsed = def.type.safeParse(values[def.key])
    if (parsed.success) {
      values[def.key] = parsed.data
      continue
    }

    const last = provenanceEntry.contributors[provenanceEntry.contributors.length - 1]
    problems.push({
      key: def.key,
      scope: last?.scope ?? "platform",
      layerId: last?.id ?? "(merged)",
      reason: "invalid-result",
      detail:
        `The merged value fails the schema even though each layer was accepted: ` +
        parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") +
        `. Contributors: ${provenanceEntry.contributors.map((c) => `${c.scope}/${c.id}`).join(" → ")}.`,
    })
  }

  if (problems.length > 0 && !options.collectProblems) {
    throw new ConfigResolutionError(problems)
  }
  if (problems.length > 0) {
    return { config: null, problems }
  }

  return { config: freezeResolved(values, provenance, registry), problems }
}

/** `resolveConfig` for the common case: give me the configuration or throw. */
export function resolveConfigOrThrow(
  registry: ConfigRegistry,
  layers: readonly ConfigLayer[],
): ResolvedConfig {
  const { config } = resolveConfig(registry, layers)
  // Unreachable: without collectProblems, resolveConfig throws instead of
  // returning null. Asserted rather than cast, so a future change to that
  // contract fails here instead of producing a null at a call site.
  if (!config) throw new Error("resolveConfig returned no configuration and did not throw")
  return config
}

function freezeResolved(
  values: Record<string, unknown>,
  provenance: Record<string, Provenance>,
  registry: ConfigRegistry,
): ResolvedConfig {
  for (const p of Object.values(provenance)) {
    Object.freeze(p.contributors)
    Object.freeze(p)
  }
  Object.freeze(values)
  Object.freeze(provenance)

  const checksum = checksumOf(values)

  return Object.freeze({
    values,
    provenance,
    checksum,
    get<T = unknown>(key: string): T {
      if (!registry.has(key)) {
        // Returning undefined would let a typo read as "not configured" and take
        // the caller's `?? fallback` branch, silently.
        throw new Error(
          `Configuration key "${key}" is not defined. Declare it before reading it.`,
        )
      }
      return values[key] as T
    },
    explain(key: string): Provenance {
      const p = provenance[key]
      if (!p) throw new Error(`Configuration key "${key}" is not defined.`)
      return p
    },
  })
}

/** Deterministic content hash of a resolved value set. */
export function checksumOf(values: Readonly<Record<string, unknown>>): string {
  return `sha256:${createHash("sha256").update(stableStringify(values)).digest("hex")}`
}

/**
 * Values with anything above `maxSensitivity` replaced by a marker.
 *
 * For logs, audit records and support views. Redaction is a function of the
 * definition, so it cannot be forgotten at an individual call site.
 */
export function redact(
  config: ResolvedConfig,
  registry: ConfigRegistry,
  maxSensitivity: "public" | "internal" | "confidential" = "internal",
): Record<string, unknown> {
  const order = ["public", "internal", "confidential", "secret"] as const
  const ceiling = order.indexOf(maxSensitivity)

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config.values)) {
    const def = registry.get(key)
    const rank = def ? order.indexOf(def.sensitivity) : order.length - 1
    out[key] = rank > ceiling ? `[redacted:${def?.sensitivity ?? "unknown"}]` : value
  }
  return out
}

export type { ConfigDefinition }
