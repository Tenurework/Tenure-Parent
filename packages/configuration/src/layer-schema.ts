/**
 * GE-031-001 — versioned schemas for every configuration layer.
 *
 * `ConfigLayer` (resolve.ts) is a scope, an id and a bag of values. That is
 * enough to resolve a value and not enough to answer any of the questions asked
 * after something goes wrong: which version of this layer is live, who signed
 * it, when does it stop applying, why was it changed, who approved it.
 *
 * The bible §7.1 requires all of that on **every** layer: "Every layer has an
 * immutable version, semantic schema version, signer, origin, compatibility
 * range, effective interval, change reason, and approval record."
 *
 * ## The eleven layers, and the two that are not really layers
 *
 * §7.1 lists eleven in precedence order, and two of them do not behave like the
 * other nine:
 *
 *   * **Platform invariants** are listed first — lowest precedence — and
 *     described as things "tenants cannot override". Those two statements
 *     contradict each other. Something at the bottom of a precedence order is
 *     precisely what everything above it overrides. The resolution is that an
 *     invariant is not a layer that competes; it is a **constraint on the
 *     others**, and a later layer that sets an invariant key is REFUSED rather
 *     than silently discarded. Refusing is visible; discarding is not, and a
 *     tenant whose setting quietly does nothing files a bug about the wrong
 *     thing.
 *
 *   * **Emergency deny** sits highest and may only restrict, never expand —
 *     the same law `flags.ts` establishes, for the same reason. A layer that
 *     could grant from the top of the precedence order is a second
 *     authorization system that answers to whoever can publish an emergency.
 *
 * The other nine order normally.
 */

/**
 * The layer kinds, in the bible's precedence order, lowest first.
 *
 * `platformInvariant` is at index 0 because that is where §7.1 puts it, and its
 * behaviour is handled by `invariantKeys` rather than by rank — see above. The
 * order is data, so `layerRank` cannot disagree with this list.
 */
export const LAYER_KINDS = [
  "platformInvariant",
  "partitionRegion",
  "environment",
  "plan",
  "industryPack",
  "orgTemplate",
  "tenantBaseline",
  "tenantOverlay",
  "orgUnitOverlay",
  "experiment",
  "emergencyDeny",
] as const

export type LayerKind = (typeof LAYER_KINDS)[number]

const RANK: ReadonlyMap<LayerKind, number> = new Map(LAYER_KINDS.map((k, i) => [k, i]))

export function isLayerKind(value: unknown): value is LayerKind {
  return typeof value === "string" && RANK.has(value as LayerKind)
}

export function layerRank(kind: LayerKind): number {
  const rank = RANK.get(kind)
  if (rank === undefined) {
    // Reachable from JSON even when the type system says otherwise — a kind read
    // off a database row is a string until something checks it.
    throw new RangeError(`Unknown configuration layer kind: ${JSON.stringify(kind)}`)
  }
  return rank
}

/**
 * Layers that may only narrow what is already permitted.
 *
 * One today. Named as a set rather than compared to a literal because the next
 * restrict-only layer must not require finding every `=== "emergencyDeny"` in
 * the codebase.
 */
export const RESTRICT_ONLY_KINDS: ReadonlySet<LayerKind> = new Set<LayerKind>(["emergencyDeny"])

export interface CompatibilityRange {
  /** Inclusive. */
  minEngine: string
  /** Inclusive, or null for no known upper bound — a claim, not an absence. */
  maxEngine: string | null
}

/**
 * What every layer carries, without exception.
 *
 * Optional fields would mean "we did not record it" is indistinguishable from
 * "there was nothing to record", and the questions this metadata answers are
 * asked precisely when nobody remembers.
 */
export interface LayerMetadata {
  /**
   * Immutable. A new version is a new record; editing one in place destroys the
   * only evidence of what was live at the time of an incident.
   */
  version: number
  /** Semantic version of the SCHEMA this layer's values conform to. */
  schemaVersion: string
  /** Who signed it. A KMS key ARN or an operator identity — never a value. */
  signer: string
  /** Where it came from: a file path, a console session, an import. */
  origin: string
  compatibility: CompatibilityRange
  /** ISO instant. Before this the layer contributes nothing. */
  effectiveFrom: string
  /** ISO instant, or null for open-ended. */
  effectiveUntil: string | null
  /** Why. Free text, required — a change nobody can explain cannot be reviewed. */
  changeReason: string
  /**
   * Who approved it, distinct from who wrote it.
   *
   * `null` only where the layer kind does not require approval; `requiresApproval`
   * decides which those are, so "unapproved" and "approval not needed" are
   * different states rather than the same empty field.
   */
  approvedBy: string | null
}

export interface VersionedLayer {
  kind: LayerKind
  /** Which entity at that kind — a tenant id, an org-unit id, a region name. */
  id: string
  label?: string
  values: Readonly<Record<string, unknown>>
  metadata: LayerMetadata
}

/**
 * Which layer kinds a human must approve before they take effect.
 *
 * Everything a customer can reach, plus the emergency switch. `partitionRegion`
 * and `environment` describe the estate rather than a customer's system and are
 * changed by the same people who would approve them, so requiring a second
 * signature there is a rule that gets worked around rather than followed.
 */
const REQUIRES_APPROVAL: ReadonlySet<LayerKind> = new Set<LayerKind>([
  "platformInvariant",
  "plan",
  "industryPack",
  "orgTemplate",
  "tenantBaseline",
  "tenantOverlay",
  "orgUnitOverlay",
  "experiment",
  "emergencyDeny",
])

export function requiresApproval(kind: LayerKind): boolean {
  return REQUIRES_APPROVAL.has(kind)
}

export interface LayerProblem {
  field: string
  reason: string
  detail: string
}

/**
 * Validate a layer before it is published.
 *
 * Collects everything rather than throwing on the first, because an operator
 * who fixes one field and resubmits to be told about the next has lost a round
 * trip to a list that was already known.
 */
export function validateLayer(layer: VersionedLayer): readonly LayerProblem[] {
  const problems: LayerProblem[] = []
  const m = layer.metadata

  if (!isLayerKind(layer.kind)) {
    problems.push({ field: "kind", reason: "invalid", detail: `no such layer kind: ${layer.kind}` })
  }

  if (!layer.id.trim()) {
    problems.push({
      field: "id",
      reason: "required",
      detail: "a layer that names no entity applies to everything or nothing, and nobody can tell which",
    })
  }

  if (!Number.isInteger(m.version) || m.version < 1) {
    problems.push({
      field: "metadata.version",
      reason: "invalid",
      detail: "versions start at 1 and are integers",
    })
  }

  if (!/^\d+\.\d+\.\d+$/.test(m.schemaVersion)) {
    problems.push({
      field: "metadata.schemaVersion",
      reason: "invalid",
      detail: "major.minor.patch",
    })
  }

  for (const [field, value] of [
    ["metadata.signer", m.signer],
    ["metadata.origin", m.origin],
    ["metadata.changeReason", m.changeReason],
  ] as const) {
    if (!value.trim()) {
      problems.push({
        field,
        reason: "required",
        detail:
          field === "metadata.changeReason"
            ? "a change nobody can explain cannot be reviewed"
            : "recorded on every layer, because it is asked for when nobody remembers",
      })
    }
  }

  if (requiresApproval(layer.kind) && !m.approvedBy?.trim()) {
    problems.push({
      field: "metadata.approvedBy",
      reason: "required",
      // The four-eyes rule. A layer that reaches a customer's system on one
      // person's say-so is one person away from any change at all.
      detail: `${layer.kind} takes effect in a customer's system and needs an approver`,
    })
  }

  if (!requiresApproval(layer.kind) && m.approvedBy !== null && !m.approvedBy.trim()) {
    problems.push({
      field: "metadata.approvedBy",
      reason: "invalid",
      // Empty string is not "not required" — null is. Otherwise "nobody
      // approved this" and "approval does not apply" look identical.
      detail: "use null where approval does not apply, not an empty string",
    })
  }

  const from = Date.parse(m.effectiveFrom)
  if (Number.isNaN(from)) {
    problems.push({ field: "metadata.effectiveFrom", reason: "invalid", detail: "not an instant" })
  }
  if (m.effectiveUntil !== null) {
    const until = Date.parse(m.effectiveUntil)
    if (Number.isNaN(until)) {
      problems.push({ field: "metadata.effectiveUntil", reason: "invalid", detail: "not an instant" })
    } else if (!Number.isNaN(from) && until <= from) {
      problems.push({
        field: "metadata.effectiveUntil",
        reason: "invalid",
        // A window that closes before it opens never applies, and presents as
        // "the setting did nothing" with no obvious cause.
        detail: "the interval ends before it begins",
      })
    }
  }

  if (!/^\d+\.\d+\.\d+$/.test(m.compatibility.minEngine)) {
    problems.push({
      field: "metadata.compatibility.minEngine",
      reason: "invalid",
      detail: "major.minor.patch",
    })
  }
  if (m.compatibility.maxEngine !== null && !/^\d+\.\d+\.\d+$/.test(m.compatibility.maxEngine)) {
    problems.push({
      field: "metadata.compatibility.maxEngine",
      reason: "invalid",
      detail: "major.minor.patch, or null",
    })
  }

  return problems
}

/**
 * Whether a layer applies at an instant.
 *
 * Fails closed on an unreadable interval. A layer whose window nobody can parse
 * is one nobody can promise is live, and applying it anyway means a value takes
 * effect outside the period somebody agreed to.
 */
export function isEffectiveAt(layer: VersionedLayer, at: Date): boolean {
  const from = Date.parse(layer.metadata.effectiveFrom)
  if (Number.isNaN(from) || at.getTime() < from) return false
  if (layer.metadata.effectiveUntil === null) return true
  const until = Date.parse(layer.metadata.effectiveUntil)
  if (Number.isNaN(until)) return false
  return at.getTime() < until
}

/**
 * The keys a set of layers pins as invariant.
 *
 * Every key any `platformInvariant` layer sets. Collected across layers rather
 * than taken from one, because there is no reason a platform would express all
 * its invariants in a single record and every reason it would not.
 */
export function invariantKeys(layers: readonly VersionedLayer[], at: Date): ReadonlySet<string> {
  const keys = new Set<string>()
  for (const layer of layers) {
    if (layer.kind !== "platformInvariant") continue
    if (!isEffectiveAt(layer, at)) continue
    for (const key of Object.keys(layer.values)) keys.add(key)
  }
  return keys
}

export interface OrderedLayers {
  /** Effective layers, lowest precedence first. Deterministic. */
  ordered: readonly VersionedLayer[]
  /** Layers excluded because they are outside their interval, with the reason. */
  skipped: readonly { layer: VersionedLayer; reason: "not-yet-effective" | "expired" }[]
  /**
   * Attempts to set a platform invariant from a later layer.
   *
   * Reported, not silently dropped. A tenant whose setting quietly does nothing
   * files a bug about the wrong thing, and an operator looking at the console
   * sees a value that is not in effect anywhere.
   */
  refused: readonly { kind: LayerKind; id: string; key: string }[]
}

/**
 * Put layers in the order the resolver should fold them, at an instant.
 *
 * Ties within a kind break on `id`, then on `version` descending — so two
 * org-unit overlays at the same rank resolve the same way in every process and
 * the newest version of the same id wins. A precedence that depends on array
 * order cannot be reproduced when somebody asks why a value is what it is.
 */
export function orderLayers(layers: readonly VersionedLayer[], at: Date): OrderedLayers {
  const skipped: OrderedLayers["skipped"] = []
  const mutableSkipped = skipped as { layer: VersionedLayer; reason: "not-yet-effective" | "expired" }[]

  const live = layers.filter((layer) => {
    if (isEffectiveAt(layer, at)) return true
    const from = Date.parse(layer.metadata.effectiveFrom)
    mutableSkipped.push({
      layer,
      reason: !Number.isNaN(from) && at.getTime() < from ? "not-yet-effective" : "expired",
    })
    return false
  })

  const pinned = invariantKeys(layers, at)
  const refused: { kind: LayerKind; id: string; key: string }[] = []
  for (const layer of live) {
    if (layer.kind === "platformInvariant") continue
    for (const key of Object.keys(layer.values)) {
      if (pinned.has(key)) refused.push({ kind: layer.kind, id: layer.id, key })
    }
  }

  const ordered = [...live].sort(
    (a, b) =>
      layerRank(a.kind) - layerRank(b.kind) ||
      a.id.localeCompare(b.id) ||
      b.metadata.version - a.metadata.version,
  )

  return { ordered, skipped, refused }
}
