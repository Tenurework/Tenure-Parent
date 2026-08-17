import "server-only"

import {
  applyOverride,
  choosePlacement,
  evaluatePlacementPolicy,
  validateCellRecord,
  type CellPlacementFacts,
  type CellRecord,
  type IsolationTier,
  type OverrideApproval,
  type OverrideRequest,
  type PlacementPolicyDecision,
} from "@tenure/provisioning"

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
  const region = process.env.AWS_REGION?.trim()
  const accountId = process.env.AWS_ACCOUNT_ID?.trim()
  const partition = process.env.AWS_PARTITION?.trim()
  if (region && accountId && partition) return
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
 * GE-101-001 — the facts a cell publishes beyond its fleet record.
 *
 * Read from the environment, like everything else in this file, and OMITTED
 * where the environment says nothing. That omission is the honest answer and it
 * has teeth: a gate whose requirement was declared and whose fact is absent is
 * `unverifiable`, which refuses the placement. Today's estate publishes none of
 * these, so a tenant asking for a silo, a customer-managed key or a recovery
 * objective is refused with the sentence that says the fleet cannot confirm it —
 * rather than placed on a cell nobody checked.
 *
 * Nothing here derives one axis from another. `backup.retentionDays` is on the
 * cell record and is NOT an RPO: publishing it as one would make the DR gate
 * answer a question it was never asked.
 */
function cellFacts(cells: readonly CellRecord[]): readonly CellPlacementFacts[] {
  const list = (name: string): readonly string[] | undefined => {
    const raw = process.env[name]
    if (raw === undefined) return undefined
    // An empty variable is "publishes none", which is a different fact from an
    // unset one and must survive as one.
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  }
  const num = (name: string): number | undefined => {
    const raw = process.env[name]?.trim()
    if (!raw) return undefined
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  const bool = (name: string): boolean | undefined => {
    const raw = process.env[name]?.trim().toLowerCase()
    if (!raw) return undefined
    return raw === "true" || raw === "1"
  }

  const rpo = num("CELL_RPO_MINUTES")
  const rto = num("CELL_RTO_MINUTES")
  const cmk = bool("CELL_KMS_CMK_SUPPORTED")
  const keyRegion = process.env.CELL_KMS_KEY_REGION?.trim()

  return cells.map((c) => ({
    cellId: c.cellId,
    isolationClasses: list("CELL_ISOLATION_CLASSES") as readonly IsolationTier[] | undefined,
    certifiedDataClasses: list("CELL_CERTIFIED_DATA_CLASSES"),
    attestedRegulations: list("CELL_ATTESTED_REGULATIONS"),
    availableServices: list("CELL_AVAILABLE_SERVICES"),
    availableModels: list("CELL_AVAILABLE_MODELS"),
    sovereignCertified: bool("CELL_SOVEREIGN_CERTIFIED"),
    // Both halves or neither. A recovery objective with an RPO and no RTO is
    // half a promise, and comparing against it would pass on the half that was
    // supplied.
    kms: cmk !== undefined && keyRegion ? { customerManagedKeySupported: cmk, keyRegion } : undefined,
    dr: rpo !== undefined && rto !== undefined ? { rpoMinutes: rpo, rtoMinutes: rto } : undefined,
    marginalTenantCostMinor: num("CELL_MARGINAL_TENANT_COST_MINOR"),
    costCurrency: process.env.CELL_COST_CURRENCY?.trim() || undefined,
  }))
}

/** The partition this control plane is in. See `estateFact`. */
function estatePartition(): string {
  return estateFact(
    "AWS_PARTITION",
    resolvedEstate?.partition,
    "The AWS partition this cell runs in",
  )
}

export interface PlacementOptions {
  /** The shape the tenant contracted. Selects the placement adapter. */
  isolation: IsolationTier
  /** Set when the placement is under a sovereignty constraint. */
  sovereign?: boolean
  /**
   * An approved operator override, or nothing.
   *
   * `at` is supplied rather than read from a clock here for the same reason
   * `change-class.ts` gives: a caller that supplies both the expiry and the now
   * can satisfy any window instantly, so the comparison belongs to whoever
   * holds the persisted request.
   */
  override?: { request: OverrideRequest; approval: OverrideApproval; at: string }
}

export type StudioPlacement = Omit<ReturnType<typeof choosePlacement>, "reason"> & {
  reason: ReturnType<typeof choosePlacement>["reason"] | "policy-refused"
  policy: PlacementPolicyDecision
}

/**
 * Where a tenant should go.
 *
 * Returns the decision rather than a bare id, so a caller reports *why* a
 * tenant could not be placed. "No cell in your residency zone" and "every cell
 * is full" are the same outcome and completely different problems.
 *
 * ## Two stages, in this order (GE-101-001, GE-101-003)
 *
 * The policy runs FIRST and narrows the fleet to the cells the tenant's
 * contract permits; `choosePlacement` then picks one of those. That order is
 * what makes a fleet with one non-compliant cell and one compliant cell place
 * the tenant on the compliant one instead of refusing — and running
 * `choosePlacement` first would have chosen before the contract was consulted.
 *
 * `capacity` and `allowed-regions` stay with `choosePlacement`: it tells "the
 * cells are full" from "we are holding the last slots back" and says what the
 * fleet should do about it, which a boolean gate cannot. The policy still
 * evaluates and explains both — see `GATES_ENFORCED_BY_ADMISSION`.
 */
export function placementFor(
  tenant: {
    tenantId: string
    residency: readonly string[]
    environment: CellRecord["environment"]
  },
  options: PlacementOptions,
): StudioPlacement {
  const cells = fleet()
  const facts = cellFacts(cells)

  const evaluated = evaluatePlacementPolicy({
    cells,
    facts,
    request: {
      tenantId: tenant.tenantId,
      environment: tenant.environment,
      allowedRegions: tenant.residency,
      isolation: options.isolation,
      sovereign: options.sovereign,
      // A tenant's data must not cross a partition boundary, and the partition
      // this control plane is in is the only one it can reach. Declared rather
      // than assumed, so the gate refuses the day a cell in another one appears.
      requiredPartition: estatePartition(),
    },
  })

  const policy = options.override
    ? applyOverride(evaluated, options.override.request, options.override.approval, options.override.at)
    : evaluated

  const eligible = cells.filter((c) => policy.eligibleCellIds.includes(c.cellId))
  const decision = choosePlacement(eligible, tenant)

  // A policy refusal is its own reason. Falling through to
  // `no-cell-in-residency` — which is what an empty candidate set produces —
  // would tell an operator to look at regions when the problem is a contract.
  const reason =
    policy.eligibleCellIds.length === 0 && cells.length > 0 ? "policy-refused" : decision.reason

  return { ...decision, reason, policy }
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
