import "server-only"

import {
  validateRegistryRecord,
  type TenantManifest,
  type TenantRegistryRecord,
} from "@tenure/provisioning"

/**
 * GE-030-001 — turning a manifest into the registry record.
 *
 * A manifest is what somebody asked for. A registry record is what is true, and
 * the two are built at the same moment for the first tenant only because there
 * is nothing true yet — after that the record moves on its own as the tenant is
 * provisioned, placed, migrated and released, while the manifest does not.
 *
 * So this is deliberately a one-way projection with defaults for everything the
 * manifest cannot know, and every one of those defaults is the *safe* end of its
 * range rather than the convenient one.
 */

/**
 * A tenant id.
 *
 * Prefixed so that an id in a log is self-describing, and random rather than
 * derived from the slug — an id derived from a name is an id that changes when
 * the name does, which is the entire thing `tenantId` exists to avoid.
 *
 * `crypto.randomUUID` rather than a counter: a counter needs a source of truth
 * for "the last one", and the registry is the thing being written.
 */
export function newTenantId(): string {
  return `tnt_${globalThis.crypto.randomUUID().replace(/-/g, "")}`
}

export class RegistryRecordInvalid extends Error {
  constructor(readonly problems: readonly { field: string; detail: string }[]) {
    super(
      `Registry record is not valid: ${problems.map((p) => `${p.field} — ${p.detail}`).join("; ")}`,
    )
    this.name = "RegistryRecordInvalid"
  }
}

/**
 * Build the record for a newly registered tenant.
 *
 * Throws rather than writing something invalid. A registry that accepts a
 * tenant placed outside its own residency is a registry whose residency field
 * is decoration, and the moment to find that out is before the row exists.
 */
export function registryRecordFor(
  manifest: TenantManifest,
  context: {
    /** Where the engine will place it. Today, one cell per region. */
    cellId: string
    /** The engine build doing the registering. */
    release: string
    primaryContactEmail: string
    plan: string
    at: string
  },
): TenantRegistryRecord {
  const record: TenantRegistryRecord = {
    tenantId: newTenantId(),
    slug: manifest.slug,
    // REGISTERED, not ACTIVE. Nothing has been provisioned yet, and a registry
    // that marks a tenant active on registration would route traffic at a cell
    // that has never heard of it.
    lifecycle: "REGISTERED",
    provenance: "composed",
    legalName: manifest.legalName,
    displayName: manifest.displayName,
    primaryContactEmail: context.primaryContactEmail || manifest.initialAdminEmail,
    plan: context.plan,
    entitlements: manifest.entitlements,
    // The manifest names one region, and that is the only region this tenant is
    // known to be allowed in. Widening it is a commercial decision, not a
    // default — so residency starts as exactly what was asked for.
    residency: [manifest.region],
    isolation: manifest.isolation,
    placement: { cellId: context.cellId, region: manifest.region, placedAt: context.at },
    release: context.release,
    // Nothing has been applied to a cell yet. The first successful reconcile
    // takes it to 1.
    configRevision: 0,
    createdAt: context.at,
    updatedAt: context.at,
  }

  const problems = validateRegistryRecord(record)
  if (problems.length > 0) throw new RegistryRecordInvalid(problems)
  return record
}
