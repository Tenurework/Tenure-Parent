/**
 * GE-030-001 — the global tenant registry record.
 *
 * `TenantManifest` is what someone *asked for*. This is what is *true*: which
 * cell actually serves the tenant, which release it is actually on, which
 * configuration revision was actually applied, and where it is in its life.
 * Keeping them apart matters — a manifest is edited by a person and a record is
 * written by the system, and a single structure serving both ends up with an
 * operator editing a field that describes reality.
 *
 * ## The id is not the slug
 *
 * A slug is a URL, and a URL is a thing customers ask to change. `tenantId` is
 * generated once, never reused, and is what every other record points at. If the
 * two were the same value, renaming `rochester` to `simon` would either break
 * every reference or require rewriting them — and the second is how a tenant's
 * audit trail ends up pointing at a tenant that no longer exists under that
 * name.
 *
 * ## Residency is a constraint, not a note
 *
 * `region` says where it runs today; `residency` says where it is *allowed* to
 * run. They are different fields because they answer to different people, and a
 * migration that satisfies capacity while violating residency is exactly what
 * a single field cannot express.
 */

import type { IsolationTier } from "./manifest"

export type TenantLifecycle =
  | "REGISTERED"
  | "PROVISIONING"
  | "ACTIVE"
  | "SUSPENDED"
  | "MIGRATING"
  | "DEPROVISIONING"
  | "ARCHIVED"

/**
 * Which lifecycle states may follow which.
 *
 * Declared rather than checked ad hoc at each call site, because "can a
 * suspended tenant go straight to archived" is a question that gets answered
 * differently in two places otherwise.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<TenantLifecycle, readonly TenantLifecycle[]>> = {
  REGISTERED: ["PROVISIONING", "ARCHIVED"],
  PROVISIONING: ["ACTIVE", "REGISTERED", "ARCHIVED"],
  // Suspension is reversible and migration is not a suspension.
  ACTIVE: ["SUSPENDED", "MIGRATING", "DEPROVISIONING"],
  SUSPENDED: ["ACTIVE", "DEPROVISIONING"],
  MIGRATING: ["ACTIVE", "SUSPENDED"],
  // Deprovisioning is the one-way door. Nothing comes back from ARCHIVED —
  // restoring a tenant is a new registration against a restored backup, which
  // is a different operation with a different approval.
  DEPROVISIONING: ["ARCHIVED"],
  ARCHIVED: [],
}

export function canTransition(from: TenantLifecycle, to: TenantLifecycle): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/** Every state a tenant may serve traffic in. Everything else must not resolve. */
const SERVING: ReadonlySet<TenantLifecycle> = new Set<TenantLifecycle>(["ACTIVE", "MIGRATING"])

export function isServing(lifecycle: TenantLifecycle): boolean {
  return SERVING.has(lifecycle)
}

export interface CellPlacement {
  /** The cell actually serving this tenant. */
  cellId: string
  /** AWS region the cell runs in. Denormalised so routing does not need a join. */
  region: string
  /** When placement last changed. A migration is visible here before anywhere else. */
  placedAt: string
}

export interface TenantRegistryRecord {
  /** Immutable, generated once, never reused. Not the slug. */
  tenantId: string
  /** The URL segment. Changeable; every reference points at `tenantId` instead. */
  slug: string

  lifecycle: TenantLifecycle

  /**
   * How this tenant came to be in the registry.
   *
   * `composed` went through the console: DRAFT, validation, provisioning, a
   * signed manifest. `adopted` was already serving when the control plane was
   * built and was brought under it — Simon OSE is the reason this exists.
   *
   * Required rather than optional, and permanent. Writing a provisioning
   * history for a tenant that never went through one would be a lie in the
   * one place the platform's honesty is load-bearing, and an absent field
   * reads as "composed" to anyone scanning.
   */
  provenance: "composed" | "adopted"

  /** Who the customer legally is. Distinct from `displayName`, which is chrome. */
  legalName: string
  displayName: string
  /** Where a real person can be reached about this account. */
  primaryContactEmail: string

  plan: string
  entitlements: readonly string[]

  /** Where the tenant's data is ALLOWED to live. A constraint, checked. */
  residency: readonly string[]
  // The manifest's own vocabulary, not a narrower one invented here. Two
  // spellings of "how isolated" is how a record and the manifest that produced
  // it come to disagree about the same tenant.
  isolation: IsolationTier
  placement: CellPlacement

  /** The engine release this tenant is actually on. */
  release: string
  /** Monotonic. Which configuration revision the cell has actually applied. */
  configRevision: number

  createdAt: string
  updatedAt: string
}

export interface RegistryProblem {
  field: string
  reason: string
  detail: string
}

/**
 * Validate a record before it is written.
 *
 * Collects every problem rather than throwing on the first. An operator who
 * fixes one field, resubmits, and is told about the next has lost a round trip
 * to a list that was already known.
 */
export function validateRegistryRecord(
  record: TenantRegistryRecord,
): readonly RegistryProblem[] {
  const problems: RegistryProblem[] = []
  const require = (field: string, value: string, detail: string) => {
    if (!value || !value.trim()) problems.push({ field, reason: "required", detail })
  }

  require("tenantId", record.tenantId, "every other record points at this; it cannot be empty")
  require("slug", record.slug, "the tenant has no URL without it")
  require("legalName", record.legalName, "who the customer legally is")
  require("release", record.release, "which engine build is serving this tenant")

  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(record.slug)) {
    problems.push({
      field: "slug",
      reason: "invalid",
      detail: "lowercase letters, digits and hyphens, 3–40 characters, not starting or ending with a hyphen",
    })
  }

  if (!record.primaryContactEmail.includes("@")) {
    problems.push({
      field: "primaryContactEmail",
      reason: "invalid",
      // An account nobody can be reached about is an account that gets
      // suspended by silence.
      detail: "no usable address for the account",
    })
  }

  if (record.residency.length === 0) {
    problems.push({
      field: "residency",
      reason: "required",
      // An empty list reads as "anywhere", and "anywhere" is never what a
      // customer with a residency requirement agreed to.
      detail: "an empty residency list would permit any region",
    })
  } else if (!record.residency.includes(record.placement.region)) {
    problems.push({
      field: "placement.region",
      reason: "residency-violation",
      detail: `placed in ${record.placement.region}, which is not among ${record.residency.join(", ")}`,
    })
  }

  if (!Number.isInteger(record.configRevision) || record.configRevision < 0) {
    problems.push({
      field: "configRevision",
      reason: "invalid",
      detail: "a revision counter is a non-negative integer",
    })
  }

  return problems
}

/**
 * What the sign-in path is allowed to see.
 *
 * The registry holds every tenant's placement, plan and contact. The login page
 * is reachable by anyone, so whatever it can read is effectively public — and
 * "which universities use Tenure, in which regions, on which plan" is a
 * customer list. This is the projection: enough to route a request, and nothing
 * that would answer a question the asker has no business asking.
 *
 * `null` for a tenant that is not serving. A suspended tenant that still
 * resolved would present a sign-in form that cannot work, and the difference
 * between "wrong password" and "your institution is suspended" is a fact about
 * that institution's commercial relationship.
 *
 * `tenant-registry.test.ts` asserts the field list rather than trusting this
 * comment — a projection is only safe while nobody adds a field to it.
 */
export interface LoginProjection {
  /** Needed to build the URL. Already public: it is in the URL. */
  slug: string
  /** Shown on the sign-in page so a user knows they are in the right place. */
  displayName: string
  /** Needed to route the request to the cell that can serve it. */
  cellId: string
  region: string
}

export function loginProjection(record: TenantRegistryRecord): LoginProjection | null {
  if (!isServing(record.lifecycle)) return null
  return {
    slug: record.slug,
    displayName: record.displayName,
    cellId: record.placement.cellId,
    region: record.placement.region,
  }
}
