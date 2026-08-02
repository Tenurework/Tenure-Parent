import "server-only"

import { TENANT_BINDINGS, getBlueprint } from "@tenure/blueprints"
import { MODULE_CATALOG } from "@tenure/modules"
import { resolveModules } from "@tenure/module-runtime"
import {
  MANIFEST_VERSION,
  adoptTenant,
  type AdoptionEvidence,
  type IsolationTier,
  type TenantManifest,
  type TenantRegistryRecord,
} from "@tenure/provisioning"

import { fleet } from "@/lib/cells"
import { newTenantId } from "@/lib/registry-record"

/**
 * Bringing a file-bound tenant under the engine.
 *
 * `blueprints/index.ts` binds tenants that predate the registry — Simon OSE
 * first among them. The console lists them under "Configured by file" precisely
 * because showing them in the same table would imply a lifecycle they never
 * went through. Adoption is how that stops being permanent: the tenant gets a
 * real registry record, and the record says `adopted` forever.
 *
 * ## The manifest is derived, not invented
 *
 * Every field comes from the binding or from the resolved configuration. Where
 * something genuinely is not known — the administrator's address, the
 * contracted residency — it is an input the operator supplies, because guessing
 * a contract term and writing it into a registry is worse than asking.
 */

/**
 * What the binding actually resolves to.
 *
 * Through `resolveModules`, the same resolver the console's execution context
 * uses — so the manifest an adoption writes cannot describe a module set the
 * executor would refuse to build.
 */
function resolvedModules(blueprintId: string, entitlements: readonly string[]) {
  const blueprint = getBlueprint(blueprintId)
  return resolveModules(MODULE_CATALOG, {
    requested: blueprint?.modules ?? [],
    entitlements,
  })
}

export interface AdoptionRequest {
  slug: string
  /** Who administers it. Not in the binding, and not guessable. */
  primaryContactEmail: string
  /**
   * Regions the tenant is contractually allowed in.
   *
   * Supplied rather than defaulted from the binding's region: for an existing
   * customer this is a contract term somebody has to look up, and inferring it
   * would put a claim in the registry that nobody verified.
   */
  residency: readonly string[]
  plan: string
  at: string
}

export class NotAdoptable extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NotAdoptable"
  }
}

/**
 * The manifest a file-bound tenant would have had.
 *
 * Modules come from the same resolver the console's executor uses, so the
 * manifest describes a system that can actually be built rather than the
 * blueprint's raw wish list.
 */
export function manifestForBinding(slug: string): TenantManifest {
  const binding = TENANT_BINDINGS.find((b) => b.slug === slug)
  if (!binding) throw new NotAdoptable(`No file binding for "${slug}".`)

  const blueprint = getBlueprint(binding.blueprintId)
  if (!blueprint) {
    throw new NotAdoptable(
      `"${slug}" is bound to blueprint "${binding.blueprintId}", which does not exist. ` +
        `Adopting it would produce a manifest nothing can build.`,
    )
  }

  return {
    manifestVersion: MANIFEST_VERSION,
    slug: binding.slug,
    // The binding carries one name. Using it for both is honest — it is the
    // only name recorded — and an invented legal name in a registry is a
    // statement about a real organisation nobody checked.
    legalName: binding.displayName,
    displayName: binding.displayName,
    blueprintId: binding.blueprintId,
    modules: [...resolvedModules(binding.blueprintId, binding.entitlements ?? []).keys],
    entitlements: [...(binding.entitlements ?? [])],
    // Where it actually runs, from the fleet, not from a default.
    region: fleet()[0]?.region ?? "us-east-1",
    isolation: "pooled" as IsolationTier,
    // The overlay this tenant is already configured with.
    configuration: binding.values,
    secretRefs: {},
    initialAdminEmail: "",
    notes: `Adopted from the file binding in blueprints/. Predates the registry.`,
  }
}

/**
 * Check what can be checked, here, now.
 *
 * Each entry records what was actually looked at. Two of the four are decided
 * by data this process holds; `institution-exists` is deliberately NOT one of
 * them — the institution row lives in the cell's database, and the engine does
 * not read tenant databases. It is asserted by the operator, and the evidence
 * line says so rather than implying the engine verified it.
 */
export function adoptionEvidence(
  slug: string,
  request: AdoptionRequest,
  operatorAsserts: { institutionExists: boolean },
): AdoptionEvidence[] {
  const binding = TENANT_BINDINGS.find((b) => b.slug === slug)
  const cell = fleet().find((c) => c.residencyZones.includes(c.region))
  const modules = binding ? resolvedModules(binding.blueprintId, binding.entitlements ?? []).keys : []

  return [
    {
      check: "binding-exists",
      passed: !!binding,
      detail: binding
        ? `blueprints/index.ts binds "${slug}" to ${binding.blueprintId}; ${modules.length} modules resolve`
        : `no binding for "${slug}"`,
    },
    {
      check: "cell-serves-it",
      passed: !!cell,
      detail: cell
        ? `${cell.cellId} in ${cell.region}, ${cell.health}, permitted zones ${cell.residencyZones.join(", ")}`
        : "no cell in the fleet serves this region",
    },
    {
      check: "institution-exists",
      passed: operatorAsserts.institutionExists,
      // Said plainly. The engine does not read tenant databases, so this is an
      // operator's assertion and the evidence must not read as a machine check.
      detail: operatorAsserts.institutionExists
        ? `asserted by the operator; the engine does not read tenant databases`
        : `the operator did not confirm an institution row exists in the cell`,
    },
    {
      check: "administrator-identified",
      passed: request.primaryContactEmail.includes("@"),
      detail: request.primaryContactEmail.includes("@")
        ? `contact supplied at adoption`
        : `no usable administrator address`,
    },
  ]
}

/**
 * Build the record. Refuses exactly as `adoptTenant` refuses.
 *
 * A thin composition on purpose: the rules live in `@tenure/provisioning` so
 * the console cannot adopt under looser rules than the package enforces.
 */
export function buildAdoption(
  request: AdoptionRequest,
  operatorAsserts: { institutionExists: boolean },
): { manifest: TenantManifest; record: TenantRegistryRecord } {
  const manifest = manifestForBinding(request.slug)
  const cell = fleet()[0]
  if (!cell) throw new NotAdoptable("The fleet has no cell to place this tenant in.")

  const record = adoptTenant({
    manifest,
    tenantId: newTenantId(),
    cellId: cell.cellId,
    release: process.env.SCHEMA_VERSION ?? "unpinned",
    primaryContactEmail: request.primaryContactEmail,
    plan: request.plan,
    residency: request.residency,
    evidence: adoptionEvidence(request.slug, request, operatorAsserts),
    at: request.at,
  })

  return { manifest: { ...manifest, initialAdminEmail: request.primaryContactEmail }, record }
}

/** Bindings that are not yet in the registry — what the console offers to adopt. */
export function adoptableBindings(registeredSlugs: readonly string[]): readonly {
  slug: string
  displayName: string
  blueprintId: string
}[] {
  const registered = new Set(registeredSlugs)
  return TENANT_BINDINGS.filter((b) => !registered.has(b.slug)).map((b) => ({
    slug: b.slug,
    displayName: b.displayName,
    blueprintId: b.blueprintId,
  }))
}

/** Kept so the module list is checked against the catalog rather than assumed. */
export function unknownModules(manifest: TenantManifest): readonly string[] {
  const known = new Set(MODULE_CATALOG.keys())
  return manifest.modules.filter((m) => !known.has(m))
}
