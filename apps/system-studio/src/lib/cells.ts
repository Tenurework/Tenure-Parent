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

/**
 * GE-010-007 / STUDIO-000-006 — the estate this process is actually in.
 *
 * Resolved from `sts:GetCallerIdentity` and cached here, so `fleet()` can stay
 * synchronous — it is called from `placementFor`, from three pages and from
 * `lib/adopt.ts`, and turning all of those async to reach an AWS call would be a
 * far larger change than the fact justifies.
 *
 * `primeEstate()` is awaited by the pages that render fleet facts. Nothing
 * breaks if it has not run: the environment variables win where they are set,
 * and where neither the environment nor an identity supplies a value `fleet()`
 * refuses with `FleetMisconfigured` naming what to set. It used to default —
 * `us-east-1`, a literal twelve-digit account, and partition `aws` — which is
 * why this file was on the `no-hardcoded-estate` exemption list. It is not any
 * more, and that deletion is the proof.
 */
let resolvedEstate: { accountId: string; region: string; partition: string } | null = null

export async function primeEstate(): Promise<void> {
  if (resolvedEstate) return
  const { resolveIdentity } = await import("./aws/identity")
  const identity = await resolveIdentity()
  if (identity.state !== "ACTUAL" && identity.state !== "STALE") return
  resolvedEstate = {
    accountId: identity.value.accountId,
    region: identity.value.region,
    partition: identity.value.partition,
  }
  // The fleet was built before identity resolved, from the environment alone.
  // Rebuilding it is the point of priming.
  cached = null
}

/** For tests, which need the next read to see a different estate. */
export function __resetEstate(): void {
  resolvedEstate = null
  cached = null
}

/**
 * An estate fact, from the environment, then from the resolved identity, and
 * then not at all.
 *
 * The third arm is the whole change: there is no fallback literal. A missing
 * region does not become us-east-1 — it becomes a refusal that names the two
 * ways to supply it.
 */
function estateFact(variable: string, fromIdentity: string | undefined, what: string): string {
  const configured = process.env[variable]
  if (configured && configured.trim()) return configured.trim()
  if (fromIdentity && fromIdentity.trim()) return fromIdentity.trim()
  throw new FleetMisconfigured([
    {
      field: variable,
      detail:
        `${what} is neither set in the environment nor resolvable from sts:GetCallerIdentity. ` +
        `A default here would place tenants in an estate nobody chose — set ${variable}, or grant ` +
        `this task role sts:GetCallerIdentity so it can answer for itself.`,
    },
  ])
}

export function fleet(): readonly CellRecord[] {
  if (cached) return cached

  const region = estateFact("AWS_REGION", resolvedEstate?.region, "The region this cell serves")
  const environment = env("DEPLOY_ENVIRONMENT", "production") as CellRecord["environment"]
  const now = new Date().toISOString()

  const cells: CellRecord[] = [
    {
      cellId: env("CELL_ID", `cell-${region}-a`),
      awsAccountId: estateFact(
        "AWS_ACCOUNT_ID",
        resolvedEstate?.accountId,
        "The AWS account this cell runs in",
      ),
      region,
      environment,
      partition: estateFact(
        "AWS_PARTITION",
        resolvedEstate?.partition,
        "The AWS partition this cell runs in",
      ),
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

/**
 * Regions the fleet can actually place a tenant in.
 *
 * The compose and adopt forms offered a hard-coded list, which let an
 * operator pick a region no cell serves — placement then refused with "no
 * cell in your residency", which is a confusing way to learn the list was a
 * guess. Derived from the fleet so the two cannot disagree.
 */
export function placeableRegions(): readonly string[] {
  return [...new Set(fleet().map((c) => c.region))].sort()
}
