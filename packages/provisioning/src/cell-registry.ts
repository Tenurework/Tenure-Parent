/**
 * GE-030-002 — the cell registry.
 *
 * A cell is one deployment of the engine serving some set of tenants. The
 * tenant registry (GE-030-001) records which cell serves a tenant; this records
 * what that cell actually is — where it runs, what it is running, how full it
 * is, and whether it is fit to take another tenant.
 *
 * ## Capacity is a decision, not a number
 *
 * The reason this exists rather than a `cells.json` is placement. Deciding
 * where a new tenant goes means answering "which cells may legally hold it, of
 * those which are healthy, and of those which has room" — three different
 * questions with three different failure modes. Putting them in one predicate
 * is how a tenant lands in a cell that is at capacity because it was the only
 * one in the right region.
 *
 * ## Health is not a boolean
 *
 * A cell mid-upgrade is serving traffic and must not receive a new tenant. A
 * cell that is draining is serving traffic and must not receive one either, for
 * a different reason. Collapsing those into `healthy: false` loses the reason,
 * and the reason is what an operator needs to know whether to wait or to act.
 */

export type CellHealth =
  /** Serving, and fit to take more. */
  | "HEALTHY"
  /** Serving, but something is wrong. No new tenants until it clears. */
  | "DEGRADED"
  /** Serving, mid-release. Placement waits rather than racing the rollout. */
  | "UPGRADING"
  /** Serving its existing tenants and being emptied. Never takes a new one. */
  | "DRAINING"
  /** Not serving. */
  | "OFFLINE"

/** The health states in which a cell is still answering requests. */
const SERVING: ReadonlySet<CellHealth> = new Set<CellHealth>([
  "HEALTHY",
  "DEGRADED",
  "UPGRADING",
  "DRAINING",
])

/**
 * The health states in which a cell may receive a NEW tenant.
 *
 * Exactly one. Anything else is a cell where placing a tenant would either race
 * an operation already in progress or add load to something already unwell.
 */
const PLACEABLE: ReadonlySet<CellHealth> = new Set<CellHealth>(["HEALTHY"])

export function isCellServing(health: CellHealth): boolean {
  return SERVING.has(health)
}

export interface CellCapacity {
  /** Tenants currently placed. */
  tenants: number
  /**
   * The most this cell should hold.
   *
   * A soft limit that placement respects, not a hard one the cell enforces —
   * a cell at its limit keeps serving the tenants it has. Enforcing it at the
   * cell would take a working tenant offline to satisfy a planning number.
   */
  maxTenants: number
  /**
   * Slots at the top of `maxTenants` that onboarding may not consume.
   *
   * GE-101-004. Admission stopping at exhaustion means the last slot goes to
   * whoever signed up first, and the operator finds out when the *next* thing
   * that needs one — a tenant migrating in off a failing cell, a split, a
   * restore — has nowhere to land. Reserve is what makes onboarding stop
   * *before* the cell is out, so the remaining slots belong to the fleet rather
   * than to the queue.
   *
   * Omitted means {@link DEFAULT_CELL_RESERVE}, except on a cell so small the
   * default would consume it — see {@link cellReserve}.
   */
  reserve?: number
  /**
   * The tenant count at which this cell is "hot" — full enough that the fleet
   * should be doing something about it, not full enough to refuse anyone.
   *
   * The threshold is what turns a refusal into a warning with lead time. A cell
   * that only ever reports "no room" reports it on the day there is no room,
   * and building a cell is not a same-day operation.
   *
   * Omitted means {@link DEFAULT_WARN_FRACTION} of `maxTenants`, rounded up.
   */
  warnAt?: number
}

/**
 * Slots held back from onboarding by default.
 *
 * One, not a percentage. The reason to hold slots is that a *specific* discrete
 * thing needs one — a tenant migrating in, a split, a restore — and one is the
 * smallest number that keeps that possible. A fleet that wants more says so per
 * cell; a fleet that says nothing still gets the property this requirement is
 * about, which is that onboarding stops before exhaustion.
 */
export const DEFAULT_CELL_RESERVE = 1

/** The fraction of `maxTenants` at which a cell is hot, when it does not say. */
export const DEFAULT_WARN_FRACTION = 0.8

/**
 * The reserve actually applied to a cell.
 *
 * The default is capped so it can never take a small cell's only slot: a cell
 * with `maxTenants: 1` has nothing to hold back, and defaulting it to
 * unusable would be a fleet-wide capacity change disguised as a default. An
 * explicitly configured reserve is used exactly as written — including one that
 * consumes the cell, which `validateCellRecord` refuses rather than silently
 * clamping. A configuration that means something impossible should be said out
 * loud, not rounded into something reasonable.
 */
export function cellReserve(capacity: CellCapacity): number {
  if (capacity.reserve !== undefined) return capacity.reserve
  return Math.min(DEFAULT_CELL_RESERVE, Math.max(0, capacity.maxTenants - 1))
}

/** The tenant count above which admission refuses — `maxTenants` less the reserve. */
export function admissionLimit(capacity: CellCapacity): number {
  return Math.max(0, capacity.maxTenants - cellReserve(capacity))
}

/** How many more tenants this cell will admit. Never negative. */
export function cellHeadroom(capacity: CellCapacity): number {
  return Math.max(0, admissionLimit(capacity) - capacity.tenants)
}

/** The tenant count at which this cell is hot. */
export function warnThreshold(capacity: CellCapacity): number {
  return capacity.warnAt ?? Math.ceil(capacity.maxTenants * DEFAULT_WARN_FRACTION)
}

/**
 * Full enough that the fleet should act, not full enough to refuse anyone.
 *
 * At or above, not past: a threshold of 40 that fires at 41 is a threshold of
 * 41 written down wrong, and the difference is a cell's worth of lead time.
 */
export function isCellHot(capacity: CellCapacity): boolean {
  return capacity.tenants >= warnThreshold(capacity)
}

export interface CellRecord {
  cellId: string

  /** Where it runs. All three, because "which account" is the first incident question. */
  awsAccountId: string
  region: string
  environment: "development" | "staging" | "production"
  /**
   * The partition, for an estate that is not all in one.
   * `aws` for commercial, `aws-us-gov`, `aws-cn`. Not derivable from the region
   * name in a way worth relying on.
   */
  partition: string

  health: CellHealth
  capacity: CellCapacity

  /** The engine release this cell is actually running. */
  release: string
  /** The database schema this cell is actually migrated to. */
  schemaVersion: string

  /** Regions whose tenants this cell is permitted to hold. */
  residencyZones: readonly string[]

  /** Where requests for this cell's tenants go. */
  routing: { baseUrl: string }

  /** Backup and recovery, recorded because "when was the last one" is asked under pressure. */
  backup: {
    /** ISO timestamp of the last verified backup, or null if there has never been one. */
    lastVerifiedAt: string | null
    /** Retention in days, as configured. */
    retentionDays: number
  }

  /** Set while the cell is the source or target of a tenant migration. */
  migration?: {
    direction: "in" | "out"
    counterpartCellId: string
    startedAt: string
  }

  createdAt: string
  updatedAt: string
}

export interface CellProblem {
  field: string
  reason: string
  detail: string
}

export function validateCellRecord(cell: CellRecord): readonly CellProblem[] {
  const problems: CellProblem[] = []

  if (!/^cell-[a-z0-9-]{3,40}$/.test(cell.cellId)) {
    problems.push({
      field: "cellId",
      reason: "invalid",
      detail: "cell-<something>, lowercase letters, digits and hyphens",
    })
  }

  if (!/^\d{12}$/.test(cell.awsAccountId)) {
    problems.push({
      field: "awsAccountId",
      reason: "invalid",
      // "Which account is this in" is the first question asked in an incident,
      // and a malformed one makes it unanswerable at the worst moment.
      detail: "an AWS account id is twelve digits",
    })
  }

  if (cell.capacity.maxTenants <= 0) {
    problems.push({
      field: "capacity.maxTenants",
      reason: "invalid",
      detail: "a cell that can hold no tenants is not a cell",
    })
  }

  if (cell.capacity.tenants < 0) {
    problems.push({ field: "capacity.tenants", reason: "invalid", detail: "cannot be negative" })
  }

  if (cell.capacity.reserve !== undefined) {
    if (cell.capacity.reserve < 0) {
      problems.push({
        field: "capacity.reserve",
        reason: "invalid",
        // A negative reserve is admission ABOVE maxTenants — the limit inverted
        // by a sign, which reads as a bigger cell rather than as a mistake.
        detail: "a negative reserve admits past the limit",
      })
    } else if (cell.capacity.reserve >= cell.capacity.maxTenants) {
      problems.push({
        field: "capacity.reserve",
        reason: "invalid",
        // Clamping this would be worse: the cell would quietly admit tenants
        // into slots somebody deliberately held back.
        detail: `a reserve of ${cell.capacity.reserve} in a cell of ${cell.capacity.maxTenants} admits nobody — that is DRAINING, said explicitly`,
      })
    }
  }

  if (cell.capacity.warnAt !== undefined) {
    if (cell.capacity.warnAt < 1) {
      problems.push({
        field: "capacity.warnAt",
        reason: "invalid",
        detail: "a threshold of zero is hot from the first tenant, which is not a warning",
      })
    } else if (cell.capacity.warnAt > cell.capacity.maxTenants) {
      problems.push({
        field: "capacity.warnAt",
        reason: "invalid",
        // Never firing looks exactly like never being hot, and the fleet finds
        // out the difference on the day it runs out.
        detail: `a threshold of ${cell.capacity.warnAt} in a cell of ${cell.capacity.maxTenants} can never fire`,
      })
    }
  }

  if (cell.residencyZones.length === 0) {
    problems.push({
      field: "residencyZones",
      reason: "required",
      // Empty means "no tenant may be placed here", which is a real state —
      // but it is `DRAINING`, said explicitly, not an empty array said by
      // accident.
      detail: "a cell that may hold no tenant's data should be DRAINING, not zone-less",
    })
  } else if (!cell.residencyZones.includes(cell.region)) {
    problems.push({
      field: "residencyZones",
      reason: "invalid",
      // A cell in us-east-1 that may not hold us-east-1 data holds its own
      // data somewhere it is not allowed to.
      detail: `a cell in ${cell.region} must be permitted to hold ${cell.region} data`,
    })
  }

  if (!/^https:\/\//.test(cell.routing.baseUrl)) {
    problems.push({
      field: "routing.baseUrl",
      reason: "invalid",
      detail: "must be https — a cell reachable over http is a cell whose sessions can be read",
    })
  }

  if (cell.backup.retentionDays < 1) {
    problems.push({
      field: "backup.retentionDays",
      reason: "invalid",
      detail: "a cell with no retention has no recovery",
    })
  }

  if (cell.migration && cell.migration.counterpartCellId === cell.cellId) {
    problems.push({
      field: "migration.counterpartCellId",
      reason: "invalid",
      detail: "a cell cannot migrate to itself",
    })
  }

  return problems
}

export type PlacementRefusal =
  | "no-cell-in-residency"
  | "no-healthy-cell"
  /**
   * Every healthy cell is inside its reserve — there are slots left, and
   * onboarding is not allowed to take them. Distinct from `no-capacity` on
   * purpose: this is the fleet stopping *early*, and an operator who reads it as
   * "we are out" will not believe the count they are looking at.
   */
  | "no-headroom"
  /** Every healthy cell is literally at `maxTenants`. */
  | "no-capacity"
  | "cell-not-registered"

/**
 * What the fleet should do about its own capacity, if anything.
 *
 * Four answers because they cost four different things and none substitutes for
 * another. Recommending a new cell when the load is merely lopsided buys
 * infrastructure to solve a distribution problem; recommending a rebalance when
 * every cell is hot moves tenants between two full cells.
 *
 * Unrelated to `shardFor` in pool-strategy.ts, which shards *identity pools*.
 * This is the tenants of one cell being split across cells.
 */
export type FleetRecommendation =
  /** Nothing to do. Either there is room to spare, or the block will clear itself. */
  | "none"
  /** Some cells are hot and some are not. Rebalance before buying anything. */
  | "shard-cell"
  /** Nothing cold left to move into. The residency needs another cell. */
  | "add-cell"
  /** The residency has no footprint at all while the rest of the estate is healthy. */
  | "vend-account"

/**
 * The capacity picture behind a placement decision.
 *
 * Carried on every decision, not only on refusals. A fleet that reports its
 * state only when it has already refused somebody reports it too late to act
 * on — the point of a threshold is that it fires while the answer is still yes.
 */
export interface FleetAdmission {
  /** Whether the fleet took this tenant. */
  admits: boolean
  recommendation: FleetRecommendation
  /** Healthy in-residency cells at or above their warn threshold. */
  hot: number
  /** Admissions left across every healthy in-residency cell, reserve deducted. */
  headroom: number
  /** Why this recommendation and not another. */
  detail: string
}

export interface PlacementDecision {
  cellId: string | null
  /** Why, either way. A refusal without a reason cannot be acted on. */
  reason: "placed" | PlacementRefusal
  /**
   * How many cells survived each filter, so a refusal says where it narrowed to
   * nothing. `withCapacity` counts cells with a literal slot free;
   * `withHeadroom` counts those that will actually admit. The gap between them
   * is the reserve, and seeing it is how an operator tells "we are full" from
   * "we are holding the last slots back".
   */
  considered: {
    inResidency: number
    healthy: number
    withCapacity: number
    withHeadroom: number
  }
  admission: FleetAdmission
}

function recommendationFor(input: {
  reason: "placed" | PlacementRefusal
  inResidency: readonly CellRecord[]
  healthy: readonly CellRecord[]
  hot: number
  healthyElsewhere: number
}): FleetRecommendation {
  if (input.reason === "no-cell-in-residency") {
    // The estate is serving; this residency simply has no footprint in it.
    // Adding a cell to a region Tenure has no account in is not the move that
    // gets made first — the account is.
    return input.healthyElsewhere > 0 ? "vend-account" : "add-cell"
  }

  if (input.reason === "no-healthy-cell") {
    // Cells exist here, so this is a wait or a build, and which one depends on
    // whether any of them is coming back. DEGRADED and UPGRADING clear.
    // DRAINING and OFFLINE do not — a fleet whose only cells here are being
    // emptied has no capacity in this residency and will not grow any.
    const recoverable = input.inResidency.some(
      (c) => c.health === "DEGRADED" || c.health === "UPGRADING",
    )
    return recoverable ? "none" : "add-cell"
  }

  // Capacity-shaped: placed, no-headroom, or no-capacity. The question is the
  // same in all three — is there anywhere cold left to put load.
  if (input.hot === input.healthy.length) return "add-cell"
  if (input.hot > 0) return "shard-cell"
  // Nothing hot and still refused means the warn threshold is set above the
  // admission limit, so it can never fire before the reserve blocks. The fleet
  // cannot take a tenant either way, and "none" would be a lie about that.
  return input.reason === "placed" ? "none" : "add-cell"
}

/**
 * Choose a cell for a tenant.
 *
 * The filters run in a fixed order — residency, then health, then capacity —
 * and the count surviving each is reported. That order is deliberate: residency
 * is a contract, health is a fact, capacity is a preference, and reporting
 * "no capacity" when the real problem was that no cell may legally hold the
 * tenant sends an operator to add hardware that will not help.
 *
 * Ties break on the emptiest cell, then on cell id. Deterministic, because a
 * placement decision that depends on map iteration order cannot be reproduced
 * when someone asks why a tenant went where it did.
 *
 * ## Admission stops before exhaustion (GE-101-004)
 *
 * Capacity is two tests, not one. `withCapacity` is whether a slot exists;
 * `withHeadroom` is whether onboarding may have it. They differ by the reserve,
 * and the whole point of the reserve is that they differ: the last slots of a
 * cell belong to the fleet — a tenant migrating in off a failing cell, a split,
 * a restore — not to whoever happened to sign up. Refusing only at exhaustion
 * means the fleet discovers it has no room at the moment it needs some.
 *
 * Every decision also carries what the fleet should DO about its capacity, on
 * successes as well as refusals, because a recommendation that only appears
 * after a refusal appears too late to act on.
 */
/**
 * Whether this cell may legally hold a tenant with these allowed regions.
 *
 * Extracted from `choosePlacement` so the placement policy's `allowed-regions`
 * gate (GE-101-001) asks the same question with the same code. A second copy of
 * a residency predicate is the defect worth avoiding here: two implementations
 * that disagree by one operator disagree about where a tenant's data may live,
 * and only one of them is the one placement actually used.
 *
 * An empty `allowedRegions` is false, never "anywhere". A tenant that has
 * declared no residency has not declared that every region is acceptable.
 */
export function cellHoldsResidency(
  cell: CellRecord,
  allowedRegions: readonly string[],
): boolean {
  // The cell's region must be among the tenant's allowed regions — that is the
  // real test, because the tenant's data ends up in the cell's region — and the
  // cell must itself be permitted to hold data in the region it runs in.
  return allowedRegions.includes(cell.region) && cell.residencyZones.includes(cell.region)
}

export function choosePlacement(
  cells: readonly CellRecord[],
  tenant: { residency: readonly string[]; environment: CellRecord["environment"] },
): PlacementDecision {
  const inResidency = cells.filter(
    (c) => c.environment === tenant.environment && cellHoldsResidency(c, tenant.residency),
  )

  const healthy = inResidency.filter((c) => PLACEABLE.has(c.health))
  const withCapacity = healthy.filter((c) => c.capacity.tenants < c.capacity.maxTenants)
  const withHeadroom = healthy.filter((c) => cellHeadroom(c.capacity) > 0)

  const reason: "placed" | PlacementRefusal =
    inResidency.length === 0
      ? "no-cell-in-residency"
      : healthy.length === 0
        ? "no-healthy-cell"
        : withHeadroom.length === 0
          ? // Both are "no room for you", and they are not the same fact. One
            // says the cells are full; the other says they are not, and we are
            // still not putting a tenant there.
            withCapacity.length === 0
            ? "no-capacity"
            : "no-headroom"
          : "placed"

  const chosen =
    reason === "placed"
      ? [...withHeadroom].sort(
          (a, b) => a.capacity.tenants - b.capacity.tenants || a.cellId.localeCompare(b.cellId),
        )[0]
      : null

  const hot = healthy.filter((c) => isCellHot(c.capacity)).length
  const headroom = healthy.reduce((total, c) => total + cellHeadroom(c.capacity), 0)
  const healthyElsewhere = cells.filter(
    (c) => !inResidency.includes(c) && PLACEABLE.has(c.health),
  ).length

  const recommendation = recommendationFor({
    reason,
    inResidency,
    healthy,
    hot,
    healthyElsewhere,
  })

  return {
    cellId: chosen ? chosen.cellId : null,
    reason,
    considered: {
      inResidency: inResidency.length,
      healthy: healthy.length,
      withCapacity: withCapacity.length,
      withHeadroom: withHeadroom.length,
    },
    admission: {
      admits: reason === "placed",
      recommendation,
      hot,
      headroom,
      detail: admissionDetail({ reason, recommendation, healthy, hot, headroom, healthyElsewhere }),
    },
  }
}

function admissionDetail(input: {
  reason: "placed" | PlacementRefusal
  recommendation: FleetRecommendation
  healthy: readonly CellRecord[]
  hot: number
  headroom: number
  healthyElsewhere: number
}): string {
  const cells = (n: number) => `${n} ${n === 1 ? "cell" : "cells"}`

  switch (input.recommendation) {
    case "vend-account":
      return (
        `No cell serves this residency, and ${cells(input.healthyElsewhere)} elsewhere ${input.healthyElsewhere === 1 ? "is" : "are"} healthy. ` +
        `The estate is fine; this residency has no footprint in it. Vend an account there and build a cell.`
      )
    case "shard-cell":
      return (
        `${input.hot} of ${cells(input.healthy.length)} are at or above their warn threshold and the rest are not, ` +
        `with ${input.headroom} ${input.headroom === 1 ? "admission" : "admissions"} left in total. ` +
        `Placement only moves NEW tenants, so the hot cells stay hot on their own; rebalance them before buying a cell.`
      )
    case "add-cell":
      if (input.reason === "no-cell-in-residency") {
        return "No cell serves this residency and none elsewhere is healthy either. This is a fleet with nowhere to put anybody."
      }
      if (input.reason === "no-healthy-cell") {
        return "Every cell in this residency is draining or offline. None of them is coming back to take a tenant, so waiting does not fix it."
      }
      if (input.hot === 0) {
        return (
          `Every healthy cell is inside its reserve while none has reached its warn threshold — the threshold is set ` +
          `above the admission limit and can never fire. Fix the threshold, and add a cell: the fleet is refusing tenants now.`
        )
      }
      return (
        `All ${cells(input.healthy.length)} are at or above their warn threshold, with ${input.headroom} ` +
        `${input.headroom === 1 ? "admission" : "admissions"} left in total. There is nothing cold to rebalance into.`
      )
    case "none":
      if (input.reason === "no-healthy-cell") {
        return "Every cell in this residency is degraded or upgrading. That clears on its own — this is a wait, not a build."
      }
      return `${input.headroom} ${input.headroom === 1 ? "admission" : "admissions"} left across ${cells(input.healthy.length)}, none of them hot.`
  }
}
