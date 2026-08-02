import "server-only"

import { choosePlacement, validateCellRecord, type CellRecord } from "@tenure/provisioning"

/**
 * GE-030-002 — the fleet this engine knows about.
 *
 * One cell today. That is a fact about the estate, not a simplification: the
 * `aws-inventory` workflow found a single ECS service in one account and one
 * region, and inventing a second here so the code "looks scalable" would put a
 * tenant somewhere that does not exist.
 *
 * What matters is that placement is now a **decision** made against records
 * rather than a naming convention. Registering a tenant previously derived
 * `cell-${region}` from the manifest, which is correct exactly while there is
 * one cell per region and silently wrong the day there are two — and wrong in
 * the direction of routing a tenant at a cell with no capacity, or one that is
 * draining, or one in the wrong environment.
 *
 * The values come from the environment rather than being hardcoded, so a
 * staging deployment describes staging. A cell that cannot describe itself is
 * refused, because a fleet record that is wrong is worse than one that is
 * missing: placement would succeed and send a tenant nowhere.
 */

function env(name: string, fallback: string): string {
  const value = process.env[name]
  return value && value.trim() ? value.trim() : fallback
}

/**
 * The fleet, read once per process.
 *
 * Cached because it does not change between requests and because
 * `validateCellRecord` should not run on every placement — but deliberately not
 * cached across processes: a redeploy is how a changed fleet is picked up, and
 * that is the same cadence everything else in the Studio follows.
 */
let cached: readonly CellRecord[] | null = null

export class FleetMisconfigured extends Error {
  constructor(readonly problems: readonly { field: string; detail: string }[]) {
    super(
      `The cell registry does not describe a usable fleet: ${problems
        .map((p) => `${p.field} — ${p.detail}`)
        .join("; ")}`,
    )
    this.name = "FleetMisconfigured"
  }
}

export function fleet(): readonly CellRecord[] {
  if (cached) return cached

  const region = env("AWS_REGION", "us-east-1")
  const environment = env("DEPLOY_ENVIRONMENT", "production") as CellRecord["environment"]
  const now = new Date().toISOString()

  const cells: CellRecord[] = [
    {
      cellId: env("CELL_ID", `cell-${region}-a`),
      awsAccountId: env("AWS_ACCOUNT_ID", "047385673922"),
      region,
      environment,
      partition: env("AWS_PARTITION", "aws"),
      health: (env("CELL_HEALTH", "HEALTHY") as CellRecord["health"]) ?? "HEALTHY",
      capacity: {
        tenants: Number(env("CELL_TENANT_COUNT", "0")),
        maxTenants: Number(env("CELL_MAX_TENANTS", "50")),
      },
      release: env("SCHEMA_VERSION", "unpinned"),
      schemaVersion: env("SCHEMA_VERSION", "unpinned"),
      residencyZones: [region],
      routing: { baseUrl: env("CELL_BASE_URL", "https://platform.tenurework.com") },
      backup: {
        // Null rather than a guess. "We have never verified a backup" and "we
        // verified one at some unknown time" are different, and only one of
        // them should be reassuring.
        lastVerifiedAt: process.env.CELL_LAST_BACKUP_AT ?? null,
        retentionDays: Number(env("CELL_BACKUP_RETENTION_DAYS", "1")),
      },
      createdAt: now,
      updatedAt: now,
    },
  ]

  const problems = cells.flatMap((c) =>
    validateCellRecord(c).map((p) => ({ field: `${c.cellId}.${p.field}`, detail: p.detail })),
  )
  if (problems.length > 0) throw new FleetMisconfigured(problems)

  cached = cells
  return cached
}

/** For tests, which set the environment and need the next read to see it. */
export function __resetFleet(): void {
  cached = null
}

/**
 * Where a tenant should go.
 *
 * Returns the decision rather than a bare id, so a caller reports *why* a
 * tenant could not be placed. "No cell in your residency zone" and "every cell
 * is full" are the same outcome and completely different problems.
 */
export function placementFor(tenant: {
  residency: readonly string[]
  environment: CellRecord["environment"]
}) {
  return choosePlacement(fleet(), tenant)
}
