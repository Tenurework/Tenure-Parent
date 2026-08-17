import { createHash } from "node:crypto"

import { cellHoldsResidency, cellHeadroom, type CellRecord } from "./cell-registry"
import type { IsolationTier } from "./manifest"
import { adapterFor, type PlacementAdapter } from "./placement-adapters"

/**
 * GE-101-001 / GE-101-003 — the placement policy, and why it said what it said.
 *
 * `choosePlacement` (GE-030-002, GE-101-004) answers three questions: may this
 * cell legally hold the tenant's region, is it healthy, and will admission give
 * it a slot. Those are the questions a fleet asks. They are not the questions a
 * *contract* asks, and the Bible names eleven of those — partition, allowed
 * regions, latency, classification, regulation, isolation tier, service and
 * model availability, capacity, KMS, DR and cost. Eight of them had nowhere to
 * be evaluated.
 *
 * ## Four verdicts, because three of them are not "no"
 *
 * The verdict that matters most is `unverifiable`. A gate whose requirement was
 * declared and whose fact the fleet does not publish has NOT passed and has NOT
 * failed: nobody looked, because there was nothing to look at. Collapsing that
 * into `pass` is how a tenant ends up on a cell nobody checked, and collapsing
 * it into `fail` is how an operator goes looking for a problem that does not
 * exist. `not-demanded` is the fourth: we looked, and the tenant asked for
 * nothing on this axis.
 *
 * An absent fact and an empty fact are therefore different values throughout.
 * `certifiedDataClasses: undefined` means the cell does not publish its
 * certifications; `certifiedDataClasses: []` means it publishes that it has
 * none. The first is `unverifiable` and the second is `fail`.
 *
 * ## Two gates are reported and not narrowed on
 *
 * `capacity` and `allowed-regions` are evaluated here because the requirement
 * lists them and a decision missing two of its eleven axes is not explainable.
 * They are in {@link GATES_ENFORCED_BY_ADMISSION} because `choosePlacement`
 * already enforces both, with better refusals than a boolean gate could give —
 * it tells "the cells are full" from "we are holding the last slots back", and
 * it names what the fleet should do about it. Narrowing the candidate set on
 * them here would replace those sentences with "policy refused", which is true
 * and useless.
 *
 * ## Determinism
 *
 * No clock, no random source, no environment read. `configVersion` is a digest
 * of the cells and facts the decision was made against, so "was this decision
 * made against the fleet as it is now" is a comparison rather than a memory.
 */

export const PLACEMENT_GATES = [
  "partition",
  "allowed-regions",
  "latency",
  "classification",
  "regulation",
  "isolation-tier",
  "service-availability",
  "capacity",
  "kms",
  "dr",
  "cost",
] as const

export type PlacementGate = (typeof PLACEMENT_GATES)[number]

/**
 * The version of this ruleset.
 *
 * On the decision, so an audited placement can be re-derived. Bumped when a
 * gate is added, removed, or changes what it accepts — not when a sentence is
 * reworded.
 */
export const PLACEMENT_POLICY_VERSION = "1.0"

/**
 * Gates an approved operator override may waive.
 *
 * The line is not how expensive the gate is. It is whether waiving it degrades
 * something visible and reversible, or breaks a boundary that cannot be put
 * back. Latency, capacity, cost, DR and a missing service are all degradations:
 * the tenant is slower, or more expensive, or cannot use a feature, and moving
 * it later fixes it. Partition, region, data classification, regulation,
 * isolation tier and key custody are the boundary — once a byte has landed on
 * the wrong side of one of those, no later decision unlands it.
 */
export const OVERRIDABLE_GATES: readonly PlacementGate[] = [
  "latency",
  "capacity",
  "cost",
  "dr",
  "service-availability",
]

/**
 * Gates `choosePlacement` enforces itself. Evaluated and reported here;
 * never used to narrow the candidate set. See the header.
 */
export const GATES_ENFORCED_BY_ADMISSION: readonly PlacementGate[] = [
  "capacity",
  "allowed-regions",
]

export type GateVerdict = "pass" | "fail" | "unverifiable" | "not-demanded"

export interface GateResult {
  gate: PlacementGate
  verdict: GateVerdict
  /** What the placement demanded, in words. */
  demanded: string
  /**
   * What the cell was observed to offer — or, when the verdict is
   * `unverifiable`, the reason it could not be observed. Never a guess.
   */
  observed: string
  /** Whether an approved override may waive this gate for this shape. */
  overridable: boolean
  /** Set only by an applied override. */
  waived?: true
}

/**
 * Facts a cell publishes beyond {@link CellRecord}, for the axes a fleet record
 * does not carry.
 *
 * Every field is optional and absence is meaningful: it is the difference
 * between a cell that says it holds no certifications and a cell that says
 * nothing. A supplement rather than more fields on `CellRecord` because a
 * `CellRecord` is what the fleet is; these are measurements and attestations
 * about it, which arrive from different places at different times.
 */
export interface CellPlacementFacts {
  cellId: string
  /** Measured round trip, keyed by the region the users are in. */
  latencyMsByOriginRegion?: Readonly<Record<string, number>>
  /** Data classes this cell's controls have been certified to hold. */
  certifiedDataClasses?: readonly string[]
  /** Regulations this cell has been assessed against. */
  attestedRegulations?: readonly string[]
  /** Isolation shapes this cell can actually provide. */
  isolationClasses?: readonly IsolationTier[]
  availableServices?: readonly string[]
  availableModels?: readonly string[]
  kms?: { customerManagedKeySupported: boolean; keyRegion: string }
  /** Whether this cell is certified for sovereign placement. */
  sovereignCertified?: boolean
  dr?: { rpoMinutes: number; rtoMinutes: number }
  /** What one more tenant costs per month, in minor units. */
  marginalTenantCostMinor?: number
  /** ISO 4217, for the figure above. A comparison across currencies is refused. */
  costCurrency?: string
}

export interface PlacementRequest {
  tenantId: string
  environment: CellRecord["environment"]
  /** Regions the tenant's data may live in. Empty is undeclared, never "anywhere". */
  allowedRegions: readonly string[]
  isolation: IsolationTier
  sovereign?: boolean
  requiredPartition?: string
  /** Where the tenant's users are, for the latency measurement to be about them. */
  primaryUserRegion?: string
  latencyBudgetMs?: number
  dataClasses?: readonly string[]
  regulations?: readonly string[]
  requiredServices?: readonly string[]
  requiredModels?: readonly string[]
  kms?: { customerManagedKey: boolean; keyRegion?: string }
  dr?: { rpoMinutes: number; rtoMinutes: number }
  costCeilingMinor?: number
  /** ISO 4217, for the ceiling above. */
  costCurrency?: string
}

export interface CellPolicyEvaluation {
  cellId: string
  gates: readonly GateResult[]
  /** Gates that were demanded and refused. */
  failed: readonly PlacementGate[]
  /** Gates that were demanded and could not be checked. */
  unverifiable: readonly PlacementGate[]
  /**
   * Whether this cell may take the tenant on policy grounds.
   *
   * Blocking gates are the failures and the unverifiables, minus the two
   * admission enforces. An unverifiable blocks: a gate nobody could check is
   * not a gate that passed.
   */
  eligible: boolean
  /**
   * Every gate that did not pass, in {@link PLACEMENT_GATES} order, including
   * the two admission enforces. What the explanation is built from.
   */
  reported: readonly PlacementGate[]
  /** The subset of {@link reported} that decides eligibility here. */
  blocking: readonly PlacementGate[]
  /** Whether every blocking gate could be waived by an approved override. */
  overridable: boolean
}

export interface PlacementPolicyDecision {
  policyVersion: string
  /** Digest of the cells and facts this decision was made against. */
  configVersion: string
  /** Which shape was selected, by id. */
  adapter: PlacementAdapter["id"]
  evaluations: readonly CellPolicyEvaluation[]
  /** Cell ids the policy will allow, in the order they were given. */
  eligibleCellIds: readonly string[]
  /** One sentence per blocking gate per cell, for an operator to read. */
  explanation: readonly string[]
  /** Set by {@link applyOverride}; null otherwise. */
  override: AppliedOverride | null
}

/**
 * Recorded on a decision an override was applied to.
 *
 * Declared here rather than in `placement-override.ts` because the decision
 * shape carries it and the two must not disagree about it; the workflow that
 * produces one lives there.
 */
export interface AppliedOverride {
  cellId: string
  gates: readonly PlacementGate[]
  requestedBy: string
  approvedBy: string
  approvedAt: string
  expiresAt: string
  reason: string
}

const GATE_ORDER = new Map<PlacementGate, number>(PLACEMENT_GATES.map((g, i) => [g, i]))

function isOverridable(gate: PlacementGate, adapter: PlacementAdapter): boolean {
  if (!OVERRIDABLE_GATES.includes(gate)) return false
  return !adapter.neverOverridable.includes(gate)
}

/**
 * A gate the shape demands but the tenant declared nothing for.
 *
 * `fail`, not `unverifiable`: the missing half is the *demand*, and the fix is
 * to declare it rather than to go measuring the fleet. Saying "could not check"
 * would send somebody to look at a cell about a form that was not filled in.
 */
function undeclared(gate: PlacementGate, adapter: PlacementAdapter, what: string): GateResult {
  return {
    gate,
    verdict: "fail",
    demanded: `${adapter.id} placement requires ${what} to be declared`,
    observed: "the placement request declares none",
    overridable: isOverridable(gate, adapter),
  }
}

function notDemanded(gate: PlacementGate, adapter: PlacementAdapter, what: string): GateResult {
  return {
    gate,
    verdict: "not-demanded",
    demanded: `no ${what} requirement was declared`,
    observed: "not checked, because nothing was asked of it",
    overridable: isOverridable(gate, adapter),
  }
}

function unverifiable(
  gate: PlacementGate,
  adapter: PlacementAdapter,
  demanded: string,
  why: string,
): GateResult {
  return { gate, verdict: "unverifiable", demanded, observed: why, overridable: isOverridable(gate, adapter) }
}

function decided(
  gate: PlacementGate,
  adapter: PlacementAdapter,
  ok: boolean,
  demanded: string,
  observed: string,
): GateResult {
  return {
    gate,
    verdict: ok ? "pass" : "fail",
    demanded,
    observed,
    overridable: isOverridable(gate, adapter),
  }
}

/** Whether a list-shaped fact is published at all, as distinct from empty. */
function published<T>(fact: readonly T[] | undefined): fact is readonly T[] {
  return fact !== undefined
}

function partitionGate(
  cell: CellRecord,
  request: PlacementRequest,
  adapter: PlacementAdapter,
): GateResult {
  if (request.requiredPartition === undefined) {
    return adapter.mandatoryGates.includes("partition")
      ? undeclared("partition", adapter, "the AWS partition")
      : notDemanded("partition", adapter, "partition")
  }
  return decided(
    "partition",
    adapter,
    cell.partition === request.requiredPartition,
    `partition ${request.requiredPartition}`,
    `the cell runs in ${cell.partition}`,
  )
}

function regionGate(
  cell: CellRecord,
  request: PlacementRequest,
  adapter: PlacementAdapter,
): GateResult {
  if (request.allowedRegions.length === 0) {
    return adapter.mandatoryGates.includes("allowed-regions")
      ? undeclared("allowed-regions", adapter, "an explicit region allowlist")
      : notDemanded("allowed-regions", adapter, "residency")
  }
  return decided(
    "allowed-regions",
    adapter,
    // The same predicate `choosePlacement` filters on, not a second copy of it.
    cellHoldsResidency(cell, request.allowedRegions),
    `data in ${[...request.allowedRegions].sort().join(", ")}`,
    `the cell runs in ${cell.region} and may hold ${[...cell.residencyZones].sort().join(", ") || "nothing"}`,
  )
}

function latencyGate(
  facts: CellPlacementFacts,
  request: PlacementRequest,
  adapter: PlacementAdapter,
): GateResult {
  if (request.latencyBudgetMs === undefined) return notDemanded("latency", adapter, "latency")
  const demanded = `${request.latencyBudgetMs}ms from the tenant's users`
  if (!request.primaryUserRegion) {
    return unverifiable(
      "latency",
      adapter,
      demanded,
      "the request sets a latency budget but names no region the users are in, so there is nothing to measure from",
    )
  }
  const measured = facts.latencyMsByOriginRegion?.[request.primaryUserRegion]
  if (measured === undefined) {
    return unverifiable(
      "latency",
      adapter,
      demanded,
      `the cell publishes no measurement from ${request.primaryUserRegion}`,
    )
  }
  return decided(
    "latency",
    adapter,
    measured <= request.latencyBudgetMs,
    demanded,
    `${measured}ms measured from ${request.primaryUserRegion}`,
  )
}

function classificationGate(
  facts: CellPlacementFacts,
  request: PlacementRequest,
  adapter: PlacementAdapter,
): GateResult {
  const wanted = request.dataClasses ?? []
  if (wanted.length === 0) return notDemanded("classification", adapter, "data-classification")
  const demanded = `certification to hold ${[...wanted].sort().join(", ")}`
  if (!published(facts.certifiedDataClasses)) {
    return unverifiable(
      "classification",
      adapter,
      demanded,
      "the cell publishes no data-class certifications, so whether it holds any is unknown",
    )
  }
  const missing = wanted.filter((c) => !facts.certifiedDataClasses!.includes(c))
  return decided(
    "classification",
    adapter,
    missing.length === 0,
    demanded,
    missing.length === 0
      ? `certified for all ${wanted.length}`
      : `not certified for ${[...missing].sort().join(", ")}`,
  )
}

function regulationGate(
  facts: CellPlacementFacts,
  request: PlacementRequest,
  adapter: PlacementAdapter,
): GateResult {
  const wanted = request.regulations ?? []
  if (wanted.length === 0) return notDemanded("regulation", adapter, "regulatory or contractual")
  const demanded = `assessment against ${[...wanted].sort().join(", ")}`
  if (!published(facts.attestedRegulations)) {
    return unverifiable(
      "regulation",
      adapter,
      demanded,
      "the cell publishes no regulatory attestations, so whether it holds any is unknown",
    )
  }
  const missing = wanted.filter((r) => !facts.attestedRegulations!.includes(r))
  return decided(
    "regulation",
    adapter,
    missing.length === 0,
    demanded,
    missing.length === 0
      ? `attested against all ${wanted.length}`
      : `no attestation for ${[...missing].sort().join(", ")}`,
  )
}

function isolationGate(facts: CellPlacementFacts, adapter: PlacementAdapter): GateResult {
  const demanded = adapter.sovereign
    ? `${adapter.isolation} isolation under a sovereignty constraint`
    : `${adapter.isolation} isolation`

  if (adapter.sovereign) {
    if (facts.sovereignCertified === undefined) {
      return unverifiable(
        "isolation-tier",
        adapter,
        demanded,
        "the cell does not say whether it is certified for sovereign placement",
      )
    }
    if (!facts.sovereignCertified) {
      return decided("isolation-tier", adapter, false, demanded, "the cell is not sovereign-certified")
    }
  }

  // A cell IS a shared deployment, so a cell that exists can hold a pooled
  // tenant. Demanding a published attestation for the baseline would refuse
  // every tenant on a fleet that is doing exactly what it says.
  if (adapter.isolation === "pooled") {
    return decided(
      "isolation-tier",
      adapter,
      true,
      demanded,
      "every cell provides the shared shape by construction",
    )
  }

  if (!published(facts.isolationClasses)) {
    return unverifiable(
      "isolation-tier",
      adapter,
      demanded,
      `the cell does not publish which isolation shapes it can provide, so whether it can provide ${adapter.isolation} is unknown`,
    )
  }
  return decided(
    "isolation-tier",
    adapter,
    facts.isolationClasses.includes(adapter.isolation),
    demanded,
    `the cell provides ${[...facts.isolationClasses].sort().join(", ") || "nothing beyond the shared shape"}`,
  )
}

function availabilityGate(
  facts: CellPlacementFacts,
  request: PlacementRequest,
  adapter: PlacementAdapter,
): GateResult {
  const services = request.requiredServices ?? []
  const models = request.requiredModels ?? []
  if (services.length === 0 && models.length === 0) {
    return notDemanded("service-availability", adapter, "service or model availability")
  }
  const demanded = [
    services.length ? `services ${[...services].sort().join(", ")}` : null,
    models.length ? `models ${[...models].sort().join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" and ")

  if (services.length > 0 && !published(facts.availableServices)) {
    return unverifiable(
      "service-availability",
      adapter,
      demanded,
      "the cell publishes no service list for its region",
    )
  }
  if (models.length > 0 && !published(facts.availableModels)) {
    return unverifiable(
      "service-availability",
      adapter,
      demanded,
      "the cell publishes no model list for its region",
    )
  }
  const missing = [
    ...services.filter((s) => !facts.availableServices!.includes(s)),
    ...models.filter((m) => !facts.availableModels!.includes(m)),
  ]
  return decided(
    "service-availability",
    adapter,
    missing.length === 0,
    demanded,
    missing.length === 0
      ? "all available in the cell's own region"
      : `${[...missing].sort().join(", ")} not available in ${facts.cellId}'s region`,
  )
}

function capacityGate(cell: CellRecord, adapter: PlacementAdapter): GateResult {
  const headroom = cellHeadroom(cell.capacity)
  return decided(
    "capacity",
    adapter,
    headroom > 0,
    "a slot onboarding may take",
    `${headroom} above the reserve, ${cell.capacity.tenants} of ${cell.capacity.maxTenants} placed`,
  )
}

function kmsGate(
  facts: CellPlacementFacts,
  request: PlacementRequest,
  adapter: PlacementAdapter,
): GateResult {
  /**
   * A shape whose plan gives the tenant its own key has already demanded one.
   *
   * Derived rather than failed-as-undeclared, because the demand is not missing
   * — it is in the resource plan the tenant contracted. Silo, bridge and
   * dedicated-account all place `kms-key` outside the shared cell; a placement
   * that did not check the cell can hold such a key would be selling the plan
   * without checking it can be built. An RPO cannot be derived this way and is
   * not: no shape implies a number.
   */
  const shapeDemand: PlacementRequest["kms"] =
    adapter.mandatoryGates.includes("kms") &&
    adapter.resources.some((r) => r.resource === "kms-key" && r.sharing !== "shared-cell")
      ? { customerManagedKey: true }
      : undefined
  const demand = request.kms ?? shapeDemand
  if (!demand) {
    return adapter.mandatoryGates.includes("kms")
      ? undeclared("kms", adapter, "key custody")
      : notDemanded("kms", adapter, "key-custody")
  }
  const demanded = [
    demand.customerManagedKey ? "a customer-managed key" : "a platform-managed key",
    demand.keyRegion ? `held in ${demand.keyRegion}` : null,
  ]
    .filter(Boolean)
    .join(", ")
  if (!facts.kms) {
    return unverifiable(
      "kms",
      adapter,
      demanded,
      "the cell publishes nothing about key custody, so whether it can hold this tenant's key is unknown",
    )
  }
  const keyOk = !demand.customerManagedKey || facts.kms.customerManagedKeySupported
  const regionOk = !demand.keyRegion || facts.kms.keyRegion === demand.keyRegion
  return decided(
    "kms",
    adapter,
    keyOk && regionOk,
    demanded,
    `the cell ${facts.kms.customerManagedKeySupported ? "supports" : "does not support"} customer-managed keys and holds them in ${facts.kms.keyRegion}`,
  )
}

function drGate(
  facts: CellPlacementFacts,
  request: PlacementRequest,
  adapter: PlacementAdapter,
): GateResult {
  if (!request.dr) {
    return adapter.mandatoryGates.includes("dr")
      ? undeclared("dr", adapter, "a recovery objective")
      : notDemanded("dr", adapter, "recovery-objective")
  }
  const demanded = `RPO ${request.dr.rpoMinutes}m, RTO ${request.dr.rtoMinutes}m`
  if (!facts.dr) {
    return unverifiable(
      "dr",
      adapter,
      demanded,
      "the cell publishes no recovery objectives, so whether it meets these is unknown",
    )
  }
  return decided(
    "dr",
    adapter,
    facts.dr.rpoMinutes <= request.dr.rpoMinutes && facts.dr.rtoMinutes <= request.dr.rtoMinutes,
    demanded,
    `the cell offers RPO ${facts.dr.rpoMinutes}m, RTO ${facts.dr.rtoMinutes}m`,
  )
}

function costGate(
  facts: CellPlacementFacts,
  request: PlacementRequest,
  adapter: PlacementAdapter,
): GateResult {
  if (request.costCeilingMinor === undefined) return notDemanded("cost", adapter, "cost-ceiling")
  const currency = request.costCurrency ?? "unstated"
  const demanded = `no more than ${request.costCeilingMinor} ${currency} per month`
  if (facts.marginalTenantCostMinor === undefined) {
    return unverifiable(
      "cost",
      adapter,
      demanded,
      "the cell publishes no marginal cost per tenant",
    )
  }
  if (request.costCurrency && facts.costCurrency && request.costCurrency !== facts.costCurrency) {
    // Two figures in different currencies are not comparable without a rate,
    // and a rate this function invented would be a number nobody could audit.
    return unverifiable(
      "cost",
      adapter,
      demanded,
      `the cell prices in ${facts.costCurrency} and the ceiling is in ${request.costCurrency}; no rate is available here to compare them`,
    )
  }
  return decided(
    "cost",
    adapter,
    facts.marginalTenantCostMinor <= request.costCeilingMinor,
    demanded,
    `${facts.marginalTenantCostMinor} ${facts.costCurrency ?? "unstated"} per additional tenant`,
  )
}

/** Every gate, for one cell. */
export function evaluateCell(
  cell: CellRecord,
  facts: CellPlacementFacts,
  request: PlacementRequest,
  adapter: PlacementAdapter = adapterFor(request),
): CellPolicyEvaluation {
  const gates: readonly GateResult[] = [
    partitionGate(cell, request, adapter),
    regionGate(cell, request, adapter),
    latencyGate(facts, request, adapter),
    classificationGate(facts, request, adapter),
    regulationGate(facts, request, adapter),
    isolationGate(facts, adapter),
    availabilityGate(facts, request, adapter),
    capacityGate(cell, adapter),
    kmsGate(facts, request, adapter),
    drGate(facts, request, adapter),
    costGate(facts, request, adapter),
  ]

  const failed = gates.filter((g) => g.verdict === "fail" && !g.waived).map((g) => g.gate)
  const notChecked = gates.filter((g) => g.verdict === "unverifiable" && !g.waived).map((g) => g.gate)
  const byGateOrder = (a: PlacementGate, b: PlacementGate) => GATE_ORDER.get(a)! - GATE_ORDER.get(b)!
  // Everything that did not pass, whoever enforces it. This is what an operator
  // reads: a decision that hid two of its eleven axes because another function
  // owns the refusal would be a decision nobody could check.
  const reported = [...failed, ...notChecked].sort(byGateOrder)
  const blocking = reported.filter((g) => !GATES_ENFORCED_BY_ADMISSION.includes(g))

  return {
    cellId: cell.cellId,
    gates,
    failed,
    unverifiable: notChecked,
    eligible: blocking.length === 0,
    reported,
    blocking,
    overridable:
      blocking.length > 0 &&
      blocking.every((g) => gates.find((r) => r.gate === g)!.overridable),
  }
}

/**
 * The digest of what a decision was made against.
 *
 * Cells and facts are sorted by id and the fact keys are serialized in a fixed
 * order, so the same fleet produces the same version whatever order it was
 * listed in — the same property `choosePlacement`'s tiebreak exists for.
 */
export function placementConfigVersion(
  cells: readonly CellRecord[],
  facts: readonly CellPlacementFacts[],
): string {
  const canonical = JSON.stringify({
    policy: PLACEMENT_POLICY_VERSION,
    cells: [...cells]
      .sort((a, b) => a.cellId.localeCompare(b.cellId))
      .map((c) => [c.cellId, c.partition, c.region, c.environment, c.health, [...c.residencyZones].sort()]),
    facts: [...facts].sort((a, b) => a.cellId.localeCompare(b.cellId)).map(sortedFact),
  })
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16)
}

function sortedFact(fact: CellPlacementFacts): unknown {
  return Object.keys(fact)
    .sort()
    .map((k) => [k, (fact as unknown as Record<string, unknown>)[k]])
}

export interface PolicyInput {
  cells: readonly CellRecord[]
  /** Facts by cell. A cell with no entry publishes nothing, which is not the same as failing. */
  facts: readonly CellPlacementFacts[]
  request: PlacementRequest
}

/**
 * Evaluate the policy over a fleet, and say why for every cell.
 *
 * Returns the eligible ids rather than choosing one: `choosePlacement` owns the
 * choice, and running it over the eligible subset is what keeps its capacity
 * refusals and its fleet recommendation intact.
 */
export function evaluatePlacementPolicy(input: PolicyInput): PlacementPolicyDecision {
  const adapter = adapterFor(input.request)
  const byId = new Map(input.facts.map((f) => [f.cellId, f]))
  const evaluations = input.cells.map((cell) =>
    evaluateCell(cell, byId.get(cell.cellId) ?? { cellId: cell.cellId }, input.request, adapter),
  )

  return {
    policyVersion: PLACEMENT_POLICY_VERSION,
    configVersion: placementConfigVersion(input.cells, input.facts),
    adapter: adapter.id,
    evaluations,
    eligibleCellIds: evaluations.filter((e) => e.eligible).map((e) => e.cellId),
    explanation: explain(evaluations),
    override: null,
  }
}

/** One sentence per gate that did not pass, per cell. Empty when all eleven passed. */
export function explain(evaluations: readonly CellPolicyEvaluation[]): readonly string[] {
  return evaluations.flatMap((e) =>
    e.reported.map((gate) => {
      const result = e.gates.find((g) => g.gate === gate)!
      const verb = result.verdict === "unverifiable" ? "could not be checked" : "refused"
      const who = GATES_ENFORCED_BY_ADMISSION.includes(gate)
        ? " (enforced by fleet admission)"
        : result.overridable
          ? " (waivable by approved override)"
          : " (not waivable)"
      return `${e.cellId}: ${gate} ${verb} — demanded ${result.demanded}; ${result.observed}${who}`
    }),
  )
}
