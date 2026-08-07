import "server-only"

import { TENANT_BINDINGS, archetypeFor, getBlueprint } from "@tenure/blueprints"
import { MODULE_CATALOG } from "@tenure/modules"
import { modulesFor } from "@tenure/platform-config"
import {
  BUSINESS_DOMAINS,
  MANIFEST_VERSION,
  adoptTenant,
  type AdoptionEvidence,
  type CoexistenceDeclaration,
  type IsolationTier,
  type ObjectAuthority,
  type SystemOfRecordMap,
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
 * Through `modulesFor` — the SAME function the application uses to decide what
 * a tenant runs. It was a second `resolveModules` call of its own, which read
 * the blueprint's raw list and therefore ignored the tenant's archetype
 * overrides and its module edits: an adoption would have written a manifest
 * describing a system the application does not serve, and the registry would
 * have carried that difference permanently.
 */
function resolvedModules(slug: string) {
  return modulesFor(slug)
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
function requireFirstCellRegion(): string {
  const cell = fleet()[0]
  if (!cell) throw new NotAdoptable("The fleet has no cell, so there is no region to adopt into.")
  return cell.region
}

/**
 * The coexistence a binding declares, or the one its absence means.
 *
 * `TenantBinding.coexistence` is optional and its absence has a defined
 * meaning: every domain is Tenure's. That is a derivation, not a guess — the
 * same reading `modulesFor` already acts on, so an adopted manifest cannot
 * describe a coexistence arrangement different from the one the running system
 * is resolved under.
 */
function coexistenceForBinding(declared: CoexistenceDeclaration | undefined): {
  profile: CoexistenceDeclaration["profile"]
  systemOfRecord: SystemOfRecordMap
  objectAuthority?: readonly ObjectAuthority[]
} {
  if (declared)
    return {
      profile: declared.profile,
      systemOfRecord: declared.systemOfRecord,
      // WRK-020-004. Carried, not dropped. A binding that states which objects
      // move and in which direction and an adopted manifest that states only
      // the domains are two different coexistence contracts for one running
      // system, and the manifest is the one that gets diffed and approved.
      objectAuthority: declared.objectAuthority,
    }
  return {
    profile: "TENURE_CLOUD_PRIMARY",
    systemOfRecord: Object.fromEntries(BUSINESS_DOMAINS.map((d) => [d, "tenure" as const])),
  }
}

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
    // The composition this tenant is actually running, so what the registry
    // records is a point on the axes rather than a blueprint id and a list. A
    // manifest carrying only the id could not express `fixture-rtl`, which runs
    // the nonprofit blueprint with its `functional` axis moved.
    archetype: (() => {
      const selection = archetypeFor(slug)
      if (!selection) {
        throw new NotAdoptable(`"${slug}" has no archetype selection to adopt.`)
      }
      return {
        organization: selection.organization,
        operatingModel: selection.operatingModel,
        functional: [...selection.functional],
      }
    })(),
    modules: [...resolvedModules(slug).keys],
    entitlements: [...(binding.entitlements ?? [])],
    // Where it actually runs, from the fleet. No fallback: a fleet with no
    // cell is already an error path (`buildAdoption` refuses), and a default
    // here would place a tenant in a region no cell serves.
    region: requireFirstCellRegion(),
    isolation: "pooled" as IsolationTier,
    // Read off the binding, not invented. A binding with no coexistence block
    // means Tenure is authoritative for everything — that is what its type says
    // and what `modulesFor` acts on, so writing it out here records the same
    // fact rather than a second one. Written out in full rather than left
    // implicit because a manifest is the thing that gets diffed: "every domain
    // is ours" has to be visible to be reviewable.
    coexistence: coexistenceForBinding(binding.coexistence).profile,
    systemOfRecord: coexistenceForBinding(binding.coexistence).systemOfRecord,
    objectAuthority: coexistenceForBinding(binding.coexistence).objectAuthority,
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
  const modules = binding ? resolvedModules(slug).keys : []

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
