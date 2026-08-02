import type { ConfigRegistry } from "./definition"
import {
  orderLayers,
  type LayerKind,
  type VersionedLayer,
} from "./layer-schema"
import { resolveConfig, type ConfigLayer, type ResolveOptions, type ResolveResult } from "./resolve"
import type { ConfigScope } from "./scopes"

/**
 * GE-031-001 — resolving through the versioned layer schema.
 *
 * `resolveConfig` takes `ConfigLayer` — a scope, an id and values — and requires
 * them already in precedence order. `VersionedLayer` is the same thing plus the
 * metadata §7.1 requires, and knows its own order. This is the bridge, and it
 * exists so the schema is what callers actually build rather than a parallel
 * description of the same thing.
 *
 * ## Eleven kinds, eight scopes
 *
 * The bible names eleven layers; `CONFIG_SCOPES` has eight. That is not a
 * mistake in either — they are two vocabularies that grew for different reasons,
 * and the honest thing is to state the mapping rather than let each caller
 * invent one. Where the mapping collapses two kinds onto one scope it is said
 * out loud, and where a kind has no scope at all the layer is **reported**, not
 * dropped: a configuration layer that silently contributes nothing is the
 * failure mode this whole item exists to prevent.
 */

/**
 * Which scope each layer kind resolves at.
 *
 * `null` means "no scope models this yet". Two kinds are in that position and
 * both are deliberate:
 *
 *   * `experiment` — GE-022-005 models experiments as flags with their own
 *     restrict-only merge strategies, not as a configuration scope. Giving them
 *     a scope here would create a second way to express the same thing.
 *   * `emergencyDeny` — likewise; the kill list is a config KEY under a
 *     `unionSet` strategy, which is what makes it un-revokable from below. A
 *     scope above `user` would let it grant, which is precisely the law that
 *     forbids it.
 *
 * Recorded as `null` rather than omitted so that adding a twelfth kind without
 * deciding its scope is a type error, not a silent drop.
 */
export const SCOPE_FOR_KIND: Readonly<Record<LayerKind, ConfigScope | null>> = {
  // An invariant does not compete for precedence — `orderLayers` refuses later
  // layers that touch its keys — but it still has to contribute its own values,
  // and `platform` is the floor everything else is measured from.
  platformInvariant: "platform",
  // The estate's own shape. Both sit at `platform` because they are set by
  // Tenure and are not a customer's to change; they are separate KINDS so an
  // operator can see which of the two a value came from.
  partitionRegion: "platform",
  environment: "platform",
  // A plan grants entitlements, and entitlements are what modules are gated on.
  plan: "module",
  industryPack: "blueprint",
  orgTemplate: "blueprint",
  // Both `tenant`. Separate kinds because "what the customer agreed to" and
  // "what they have since changed" must be distinguishable — a rollback with
  // one merged scope has nothing to roll back TO.
  tenantBaseline: "tenant",
  tenantOverlay: "tenant",
  orgUnitOverlay: "orgUnit",
  experiment: null,
  emergencyDeny: null,
}

export interface VersionedResolveResult extends ResolveResult {
  /** Layers outside their effective interval, with which side of it. */
  skipped: ReturnType<typeof orderLayers>["skipped"]
  /** Later layers that tried to set a platform invariant. */
  refused: ReturnType<typeof orderLayers>["refused"]
  /**
   * Layers whose kind has no configuration scope yet.
   *
   * Reported rather than dropped. A layer that contributes nothing and says
   * nothing is indistinguishable from one that was applied and had no effect,
   * and only one of those is a bug.
   */
  unmapped: readonly { kind: LayerKind; id: string }[]
}

/**
 * Resolve a configuration from versioned layers, at an instant.
 *
 * The instant is a parameter rather than `new Date()` so a resolution is
 * reproducible: "what was this tenant's configuration on the 3rd" is a question
 * that gets asked, and a resolver that can only answer "now" cannot answer it.
 */
export function resolveVersionedLayers(
  registry: ConfigRegistry,
  layers: readonly VersionedLayer[],
  at: Date,
  options: ResolveOptions = {},
): VersionedResolveResult {
  const { ordered, skipped, refused } = orderLayers(layers, at)

  const unmapped: { kind: LayerKind; id: string }[] = []
  const configLayers: ConfigLayer[] = []

  for (const layer of ordered) {
    const scope = SCOPE_FOR_KIND[layer.kind]
    if (scope === null) {
      unmapped.push({ kind: layer.kind, id: layer.id })
      continue
    }
    // Invariant keys are stripped from later layers rather than left to
    // overwrite. `refused` already records that it happened; dropping the value
    // here is what makes the refusal true rather than advisory.
    const pinnedForThisLayer = new Set(refused.filter((r) => r.id === layer.id).map((r) => r.key))
    const values =
      pinnedForThisLayer.size === 0
        ? layer.values
        : Object.fromEntries(
            Object.entries(layer.values).filter(([key]) => !pinnedForThisLayer.has(key)),
          )

    configLayers.push({ scope, id: layer.id, label: layer.label, values })
  }

  return { ...resolveConfig(registry, configLayers, options), skipped, refused, unmapped }
}
