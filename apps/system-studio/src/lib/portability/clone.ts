import {
  MANIFEST_VERSION,
  type CoexistenceProfile,
  type IsolationTier,
  type TenantManifest,
} from "@tenure/provisioning"

import { bundleLeaks, type PortableBundle } from "./bundle"

/**
 * STUDIO-040-009 — cloning a tenant, which is copying what it IS and nothing
 * about what it HOLDS.
 *
 * > "Implement tenant clone as a sanitized blueprint/manifest copy, never a
 * >  production-data or credential copy."
 *
 * ## Why the source is a bundle and not a `TenantRecord`
 *
 * A clone built from the registry record would have the whole record in scope:
 * the secret references, the placement, the deployment artifact, the evidence
 * rows. Every one of those is a field somebody has to remember NOT to copy, and
 * the failure mode of that design is a clone that carries a secret pointer
 * because a field was added after the clone code was written.
 *
 * So a clone is built from the PORTABLE BUNDLE (`./bundle.ts`), which has
 * already had everything unportable taken out of it and is checked on the way
 * in. The set of things a clone could accidentally copy is therefore the set of
 * things `exportBundle` lets out, which is one rule in one place with a
 * self-check over its own output. `cloneTenant` runs `bundleLeaks` again anyway
 * — a bundle can arrive from a file — and refuses rather than sanitising, so a
 * clone can never be made from a source nobody sanitised.
 *
 * ## What a clone deliberately does not carry
 *
 * Every drop is returned, named, with its reason, rather than being silently
 * absent. An operator cloning a live tenant needs to know that the new one has
 * no secrets bound, no domain, no placement and no data — because each of those
 * is a step they now have to perform, and a clone that looks complete and is
 * not is worse than one that lists what is missing.
 *
 * ## The clone is not created here
 *
 * This produces a manifest. Creating a tenant from it still goes through
 * `composeTenant` in `src/app/tenants/actions.ts`, which is the only writer and
 * which runs `validateManifest` against the real blueprint and module
 * catalogues. A second creation path would be a second set of rules.
 */

/** Something the clone deliberately did not copy. */
export interface CloneDrop {
  field: string
  reason: string
}

export interface CloneRequest {
  /** The NEW tenant's slug. Never the source's. */
  slug: string
  displayName: string
  legalName: string
  /** The new tenant's first administrator. Never the source's. */
  initialAdminEmail: string
  /** Overrides the source's region when the clone lands elsewhere. */
  region?: string
}

export interface CloneProblem {
  field: string
  reason: string
  detail: string
}

export type CloneOutcome =
  | { ok: true; manifest: TenantManifest; dropped: readonly CloneDrop[] }
  | { ok: false; problems: readonly CloneProblem[] }

export interface CloneContext {
  /** Every slug this installation already uses. A clone may not take one. */
  existingSlugs: readonly string[]
}

/**
 * A sanitized copy of `source`, as a manifest for a new tenant.
 */
export function cloneTenant(
  source: PortableBundle,
  request: CloneRequest,
  context: CloneContext,
): CloneOutcome {
  const problems: CloneProblem[] = []

  if (request.slug === source.slug) {
    problems.push({
      field: "slug",
      reason: "same-slug",
      detail: `A clone is a new tenant. "${source.slug}" is the source.`,
    })
  }
  if (context.existingSlugs.includes(request.slug)) {
    problems.push({
      field: "slug",
      reason: "slug-taken",
      detail: `"${request.slug}" already exists in this installation.`,
    })
  }
  if (source.manifestVersion > MANIFEST_VERSION) {
    problems.push({
      field: "manifestVersion",
      reason: "from-the-future",
      detail: `The bundle was written at manifest version ${source.manifestVersion} and this engine reads ${MANIFEST_VERSION}. Fields this engine does not know about would be dropped without anyone deciding to drop them.`,
    })
  }

  const leaks = bundleLeaks(source, context.existingSlugs)
  for (const leak of leaks) {
    problems.push({
      field: leak.at,
      reason: `leak:${leak.kind}`,
      detail: `Refusing to clone from an unsanitised source: ${leak.detail}.`,
    })
  }

  if (problems.length > 0) return { ok: false, problems }

  const dropped: CloneDrop[] = []

  // Secret slots: the clone knows WHICH secrets it needs and none of their
  // values or pointers. Each is a binding the operator now has to make.
  for (const slot of source.secretSlots) {
    dropped.push({
      field: `secretRefs.${slot}`,
      reason: "a clone binds its own secret; nothing about the source's is copied",
    })
  }

  // A configuration value that names the source tenant is about the source
  // tenant — a hostname, a bucket prefix, a support address. Carrying it into
  // a clone points the new system at the old one.
  const configuration: Record<string, unknown> = {}
  const namesSource = new RegExp(`\\b${source.slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
  for (const [key, value] of Object.entries(source.configuration)) {
    if (typeof value === "string" && namesSource.test(value)) {
      dropped.push({
        field: `configuration.${key}`,
        reason: `its value names the source tenant (${source.slug}), so it describes that system and not this one`,
      })
      continue
    }
    configuration[key] = value
  }

  dropped.push(
    {
      field: "data",
      reason: "no records of any kind are copied — a clone is a manifest, and the control plane holds no tenant rows to copy even if it were asked to",
    },
    {
      field: "placement",
      reason: "the clone is placed by the placement policy against its own residency and capacity, not by inheriting the source's cell",
    },
    {
      field: "domains",
      reason: "a verified domain belongs to the organisation that proved it; the clone verifies its own",
    },
    {
      field: "initialAdminEmail",
      reason: "taken from this request; the source's administrator is a person who did not ask to administer this",
    },
  )

  const manifest: TenantManifest = {
    manifestVersion: MANIFEST_VERSION,
    slug: request.slug,
    legalName: request.legalName,
    displayName: request.displayName,
    blueprintId: source.blueprintId,
    ...(source.archetype
      ? { archetype: source.archetype as TenantManifest["archetype"] }
      : {}),
    modules: [...source.modules],
    entitlements: [...source.entitlements],
    region: request.region ?? source.region,
    isolation: source.isolation as IsolationTier,
    coexistence: source.coexistence as CoexistenceProfile,
    systemOfRecord: { ...source.systemOfRecord } as TenantManifest["systemOfRecord"],
    configuration,
    secretRefs: {},
    initialAdminEmail: request.initialAdminEmail,
  }

  return {
    ok: true,
    manifest,
    dropped: dropped.sort((a, b) => a.field.localeCompare(b.field)),
  }
}

/** The lines the panel renders, and the lines a test reads. */
export function cloneLines(outcome: CloneOutcome): readonly string[] {
  if (!outcome.ok) {
    return outcome.problems.map((p) => `refused ${p.field}: ${p.detail}`)
  }
  return [
    `clone of ${outcome.manifest.blueprintId} as ${outcome.manifest.slug} — ${outcome.manifest.modules.length} modules, ${Object.keys(outcome.manifest.configuration).length} configuration values`,
    ...outcome.dropped.map((d) => `not copied: ${d.field} — ${d.reason}`),
  ]
}
