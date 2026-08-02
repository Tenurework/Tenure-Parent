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
  | "no-capacity"
  | "cell-not-registered"

export interface PlacementDecision {
  cellId: string | null
  /** Why, either way. A refusal without a reason cannot be acted on. */
  reason: "placed" | PlacementRefusal
  /** How many cells survived each filter, so a refusal says where it narrowed to nothing. */
  considered: { inResidency: number; healthy: number; withCapacity: number }
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
 */
export function choosePlacement(
  cells: readonly CellRecord[],
  tenant: { residency: readonly string[]; environment: CellRecord["environment"] },
): PlacementDecision {
  const inResidency = cells.filter(
    (c) =>
      c.environment === tenant.environment &&
      // Every region the tenant is allowed in must be one this cell may hold,
      // OR the cell's region must be among the tenant's allowed regions. The
      // second is the real test: the tenant's data ends up in the cell's region.
      tenant.residency.includes(c.region) &&
      c.residencyZones.includes(c.region),
  )
  if (inResidency.length === 0) {
    return {
      cellId: null,
      reason: "no-cell-in-residency",
      considered: { inResidency: 0, healthy: 0, withCapacity: 0 },
    }
  }

  const healthy = inResidency.filter((c) => PLACEABLE.has(c.health))
  if (healthy.length === 0) {
    return {
      cellId: null,
      reason: "no-healthy-cell",
      considered: { inResidency: inResidency.length, healthy: 0, withCapacity: 0 },
    }
  }

  const withCapacity = healthy.filter((c) => c.capacity.tenants < c.capacity.maxTenants)
  if (withCapacity.length === 0) {
    return {
      cellId: null,
      reason: "no-capacity",
      considered: { inResidency: inResidency.length, healthy: healthy.length, withCapacity: 0 },
    }
  }

  const chosen = [...withCapacity].sort(
    (a, b) => a.capacity.tenants - b.capacity.tenants || a.cellId.localeCompare(b.cellId),
  )[0]

  return {
    cellId: chosen.cellId,
    reason: "placed",
    considered: {
      inResidency: inResidency.length,
      healthy: healthy.length,
      withCapacity: withCapacity.length,
    },
  }
}
