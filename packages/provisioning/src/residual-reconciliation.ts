import type { IsolationTier } from "./manifest"
import type { TenantState } from "./lifecycle"

/**
 * WRK-120-005 — the half of "residual-resource/cost reconciliation" that was
 * prose.
 *
 * `RESIDUAL_COST` was a `Record<TenantState, string>` of English sentences, and
 * every consumer rendered the sentence. "Zero runtime, not zero cost:
 * snapshots, retained object storage, audit evidence and any dedicated edge
 * resources continue to bill" is a good sentence and it is unfalsifiable: it
 * says what a hibernated tenant is SUPPOSED to retain, nothing compared it to
 * what one actually retains, and a hibernated tenant still running a dedicated
 * task rendered identically to one that is not.
 *
 * That is the "$0 that is not $0" failure the map's own comment says it exists
 * to prevent, one level up: the sentence prevents the console claiming zero,
 * and nothing prevented the sentence itself being wrong.
 *
 * So each state's claim is now a list of resource classes plus the same
 * sentence, and `reconcileResidual` compares the claim to what is observed.
 * Two different findings come out of that and they are not symmetric:
 *
 *   * `unexplained` — observed and not claimed. This is a bill nobody expected.
 *     A `HIBERNATED_ZERO_RUNTIME` tenant with observed `compute` is the exact
 *     case GE-103-012 names.
 *   * `overclaimed` — claimed and not observed. This is a console telling an
 *     operator they are paying for something they are not, which makes them
 *     distrust the whole panel and is how a real `unexplained` gets ignored.
 *
 * ## Ownership
 *
 * Cost ALLOCATION — dollars, budgets, tags — lives in `@tenure/finops`. This
 * package does not import it and must not: what a lifecycle state retains is a
 * property of the state machine, and asking a pricing package what a state
 * means would put the lifecycle's own vocabulary somewhere it cannot be
 * enforced.
 */

/**
 * What a cell can actually hold on a tenant's behalf.
 *
 * Six classes rather than a free-text list, because the whole value here is the
 * comparison: two sides spelling the same resource differently reconcile to
 * "everything is unexplained and everything is overclaimed", which is noise
 * wearing the shape of a finding.
 */
export type ResourceClass =
  /** A running task or container. The thing "zero runtime" is about. */
  | "compute"
  /** Rows in a database, whether pooled or dedicated. */
  | "database"
  /** Documents and exports in object storage. */
  | "object-storage"
  /** Backups and point-in-time snapshots covering this tenant's data. */
  | "snapshot"
  /** Lifecycle steps, evidence and audit records retained for compliance. */
  | "audit-evidence"
  /** A dedicated load balancer, certificate or CDN distribution. */
  | "edge"

export interface ResidualClaim {
  state: TenantState
  /** What this state is supposed to still hold. */
  retains: readonly ResourceClass[]
  /** The sentence a console shows. Kept verbatim; the list is what is checkable. */
  note: string
}

/**
 * The claims, carrying the exact sentences `RESIDUAL_COST` has always carried.
 *
 * `lifecycle.ts` derives `RESIDUAL_COST` from this map rather than declaring
 * the sentences a second time, so there is one place where "what does
 * hibernation cost" is answered and the prose and the list cannot disagree.
 */
export const RESIDUAL_CLAIMS: Readonly<Partial<Record<TenantState, ResidualClaim>>> = {
  SUSPENDED_LOGICAL: {
    state: "SUSPENDED_LOGICAL",
    // "Full infrastructure" is every class. Suspension revokes access and
    // changes nothing about what runs.
    retains: ["compute", "database", "object-storage", "snapshot", "audit-evidence", "edge"],
    note: "Full infrastructure is retained — compute, database and storage all still bill. Only access is revoked.",
  },
  HIBERNATED_ZERO_RUNTIME: {
    state: "HIBERNATED_ZERO_RUNTIME",
    // Deliberately without `compute` and without `database`: that is what the
    // name promises, and it is now a claim something can contradict rather than
    // a sentence.
    retains: ["snapshot", "object-storage", "audit-evidence", "edge"],
    note: "Zero runtime, not zero cost: snapshots, retained object storage, audit evidence and any dedicated edge resources continue to bill.",
  },
  LEGAL_HOLD: {
    state: "LEGAL_HOLD",
    retains: ["database", "object-storage", "snapshot", "audit-evidence"],
    note: "All data is retained by obligation; storage and backup continue to bill.",
  },
  PURGE_PENDING: {
    state: "PURGE_PENDING",
    retains: ["database", "object-storage", "snapshot", "audit-evidence"],
    note: "Data is retained until the purge is approved and executed.",
  },
  PURGED_ZERO_INCREMENTAL_COST: {
    state: "PURGED_ZERO_INCREMENTAL_COST",
    // Nothing. Anything observed here is the strongest possible finding: a
    // tenant reported as purged that is still holding something.
    retains: [],
    note: "No incremental tenant cost. Shared cell resources are unaffected.",
  },
}

export interface ResidualReconciliation {
  /** Observed and not claimed — the bill nobody expected. */
  unexplained: readonly ResourceClass[]
  /** Claimed and not observed — the console charging for nothing. */
  overclaimed: readonly ResourceClass[]
}

/**
 * Compare a state's claim to what is actually retained.
 *
 * Deliberately takes the claim rather than the state: a caller holding a state
 * with no claim (ACTIVE, DRAFT, anything still running) has nothing to
 * reconcile, and returning an empty reconciliation for it would read as "we
 * checked and it was fine".
 */
export function reconcileResidual(
  claim: ResidualClaim,
  observed: readonly ResourceClass[],
): ResidualReconciliation {
  const claimed = new Set(claim.retains)
  const seen = new Set(observed)
  return {
    unexplained: [...seen].filter((r) => !claimed.has(r)),
    overclaimed: [...claimed].filter((r) => !seen.has(r)),
  }
}

/**
 * What the control plane can say a tenant is holding, without reading inside
 * it.
 *
 * Every field is a fact the registry already owns —
 * `tests/security/operator-plane-content.test.mjs` fails if the Studio ever
 * needs a row from a tenant's database to answer an operational question, and
 * this must not become the exception.
 */
export interface ObservedTenantResources {
  /** From the manifest. Decides whether compute and edge are this tenant's. */
  isolation: IsolationTier
  /** Whether a signed deployment artifact was ever published for it. */
  hasDeployment: boolean
  /** Whether the published artifact still routes requests at it. */
  serving: boolean
  /** How many lifecycle-step evidence records the registry holds for it. */
  evidenceRecords: number
}

/**
 * The observation, derived from those facts.
 *
 * Each rule is the one `planFor` already prices, so the console's reconciliation
 * and the plan's cost basis rest on the same reading of what a tenant owns:
 *
 *   * a non-pooled tenant "takes dedicated resources within the cell", and
 *     `planFor` prices exactly an ALB and a task — so `edge` and `compute`;
 *   * a serving tenant is running, whatever its isolation;
 *   * a tenant with a published artifact has been migrated and has documents,
 *     so its rows and objects exist and are inside the cell's backups;
 *   * evidence records are retained by the registry itself, which is why they
 *     are counted rather than assumed.
 */
export function observeResidual(o: ObservedTenantResources): readonly ResourceClass[] {
  const observed = new Set<ResourceClass>()

  if (o.serving) observed.add("compute")
  if (o.isolation !== "pooled") {
    // A dedicated task keeps running whether or not routing points at it, which
    // is precisely how a hibernated tenant keeps billing for compute.
    observed.add("compute")
    observed.add("edge")
  }
  if (o.hasDeployment) {
    observed.add("database")
    observed.add("object-storage")
    observed.add("snapshot")
  }
  if (o.evidenceRecords > 0) observed.add("audit-evidence")

  return [...observed]
}
