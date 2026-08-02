import type { TenantManifest } from "./manifest"
import type { TenantRegistryRecord } from "./tenant-registry"
import { validateRegistryRecord } from "./tenant-registry"

/**
 * Adopting a tenant that predates the registry.
 *
 * Simon OSE — slug `rochester` — has been serving real students since before
 * this control plane existed. It is bound in `blueprints/index.ts`, the Studio
 * lists it under "Configured by file", and the engine has no record of it: no
 * immutable id, no placement, no release, no lifecycle. Every fleet operation
 * that reads the registry therefore does not see the one tenant that matters.
 *
 * ## Adopted is not composed, and the record says so
 *
 * The tempting shortcut is to write a lifecycle history — DRAFT, VALIDATING,
 * PROVISIONING, PROVISIONED — so the tenant looks like every other. That would
 * be a lie in the one place the platform's honesty is load-bearing: an audit
 * trail. Nobody ran those steps. The tenant was built by hand, by people, over
 * months.
 *
 * So `provenance` is a field, it is `adopted`, and it is permanent. What the
 * engine gains is control from this point forward — placement, release,
 * config revision, lifecycle, drift detection — and what it does not gain is a
 * provisioning history it did not perform.
 *
 * ## What adoption actually asserts
 *
 * Only what was checked. `AdoptionEvidence` records each check, its outcome and
 * what it looked at, and `adoptTenant` refuses if a required check did not
 * pass. An adoption that skipped its checks is a registry record that claims a
 * cell holds a tenant it may not hold.
 */

export type AdoptionCheck =
  /** The slug is bound in `blueprints/`, so configuration resolves for it. */
  | "binding-exists"
  /** The cell named actually serves it — verified, not assumed. */
  | "cell-serves-it"
  /** The institution row exists in that cell's database. */
  | "institution-exists"
  /** An administrator was identified. A tenant nobody can administer is not adopted. */
  | "administrator-identified"

export const REQUIRED_ADOPTION_CHECKS: readonly AdoptionCheck[] = [
  "binding-exists",
  "cell-serves-it",
  "institution-exists",
  "administrator-identified",
]

export interface AdoptionEvidence {
  check: AdoptionCheck
  passed: boolean
  /** What was looked at. An evidence line nobody can retrace is not evidence. */
  detail: string
}

export class AdoptionRefused extends Error {
  constructor(
    readonly reason: "missing-check" | "failed-check" | "invalid-record",
    message: string,
  ) {
    super(message)
    this.name = "AdoptionRefused"
  }
}

export interface AdoptionInput {
  /** The file binding being adopted. */
  manifest: TenantManifest
  tenantId: string
  cellId: string
  release: string
  primaryContactEmail: string
  plan: string
  /**
   * Residency the tenant is contractually allowed. Supplied rather than
   * defaulted from the manifest's region: for an existing customer this is a
   * contract term somebody has to look up, and inferring it would put a
   * contractual claim in the registry that nobody verified.
   */
  residency: readonly string[]
  evidence: readonly AdoptionEvidence[]
  at: string
}

/**
 * Build the registry record for an adopted tenant.
 *
 * `lifecycle: "ACTIVE"` because it is — the tenant is serving. Starting it at
 * `REGISTERED` would be the mirror-image lie: a record saying nothing has been
 * provisioned for a system with live users in it.
 *
 * `configRevision: 0` because the engine has applied nothing. The tenant's
 * current configuration came from the file binding, not from a release this
 * control plane published, and claiming revision 1 would mean the next
 * reconcile compares against a revision that never existed.
 */
export function adoptTenant(input: AdoptionInput): TenantRegistryRecord {
  const byCheck = new Map(input.evidence.map((e) => [e.check, e]))

  const missing = REQUIRED_ADOPTION_CHECKS.filter((c) => !byCheck.has(c))
  if (missing.length > 0) {
    throw new AdoptionRefused(
      "missing-check",
      `Adoption of "${input.manifest.slug}" is missing evidence for: ${missing.join(", ")}. ` +
        `An adoption that skipped its checks is a registry record claiming a cell holds a tenant it may not hold.`,
    )
  }

  const failed = REQUIRED_ADOPTION_CHECKS.filter((c) => byCheck.get(c)?.passed === false)
  if (failed.length > 0) {
    throw new AdoptionRefused(
      "failed-check",
      `Adoption of "${input.manifest.slug}" refused: ${failed
        .map((c) => `${c} — ${byCheck.get(c)!.detail}`)
        .join("; ")}`,
    )
  }

  const record: TenantRegistryRecord = {
    tenantId: input.tenantId,
    slug: input.manifest.slug,
    lifecycle: "ACTIVE",
    provenance: "adopted",
    legalName: input.manifest.legalName,
    displayName: input.manifest.displayName,
    primaryContactEmail: input.primaryContactEmail,
    plan: input.plan,
    entitlements: input.manifest.entitlements,
    residency: input.residency,
    isolation: input.manifest.isolation,
    placement: { cellId: input.cellId, region: input.manifest.region, placedAt: input.at },
    release: input.release,
    configRevision: 0,
    createdAt: input.at,
    updatedAt: input.at,
  }

  const problems = validateRegistryRecord(record)
  if (problems.length > 0) {
    throw new AdoptionRefused(
      "invalid-record",
      `Adoption of "${input.manifest.slug}" would write an invalid record: ${problems
        .map((p) => `${p.field} — ${p.detail}`)
        .join("; ")}`,
    )
  }

  return record
}
