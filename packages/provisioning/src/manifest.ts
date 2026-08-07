/**
 * What a tenant is, before it exists.
 *
 * GE-100. An operator composes this in the Studio; provisioning reads it and
 * builds exactly what it says. Two properties make that safe:
 *
 *   * it is **complete** — every decision provisioning needs is in here, so
 *     nothing is left to a default buried in a script;
 *   * it is **digested** — the same manifest always produces the same digest,
 *     so "what did we agree to build?" and "what did we build?" are comparable
 *     rather than remembered.
 *
 * What is deliberately NOT here: secret values. A manifest is shown on a
 * screen, stored, diffed and logged. It carries secret *references*, and
 * `validateManifest` refuses one that carries a value.
 */

import { createHash } from "node:crypto"

import {
  coexistenceProblems,
  externalDomains,
  type CoexistenceProfile,
  type SystemOfRecordMap,
} from "@tenure/module-runtime"

/**
 * Version 2 adds the coexistence declaration.
 *
 * Bumped rather than added quietly. A version-1 manifest states nothing about
 * which system is authoritative for which domain, and reading one as though it
 * said "Tenure owns everything" is exactly the unrecorded assumption
 * PACK-020-004 exists to delete — so a v1 manifest is refused and re-composed
 * rather than silently reinterpreted.
 */
export const MANIFEST_VERSION = 2

/**
 * How much of the estate this tenant has to itself.
 *
 * Named honestly. `pooled` shares a database and a cluster with other tenants,
 * and the isolation is the application's tenant scope — which is real, tested,
 * and not the same thing as separate infrastructure. Anyone choosing a tier
 * should be able to read what they are getting.
 */
export type IsolationTier = "pooled" | "bridge" | "silo" | "dedicated-account"

/**
 * One value per single-valued axis, a list per multi-valued one.
 *
 * Deliberately `string`/`string[]` rather than the unions
 * `@tenure/blueprints` declares. A manifest is read back out of DynamoDB, and
 * a union type does not survive that trip — it would assert a guarantee nothing
 * checked. `validateManifest` is what checks, against the axis table its caller
 * passes in.
 */
export interface ArchetypeAxisSelection {
  organization: string
  operatingModel: string
  functional: readonly string[]
}

export interface TenantManifest {
  manifestVersion: number

  /** Identity. */
  slug: string
  legalName: string
  displayName: string

  /** What system to build. */
  blueprintId: string
  /**
   * Where this tenant sits on each archetype axis.
   *
   * A manifest used to carry a `blueprintId` and a flat module list, which is
   * the locked-tenant-type shape: two customers wanting the same blueprint with
   * one axis moved were two blueprints. This records the composition, so the
   * engine can rebuild the module set from the axes rather than trusting a list
   * somebody typed (PACK-GATE-020).
   *
   * Structural rather than imported from `@tenure/blueprints`: this package is
   * consumed by the cell, which must not depend on the engine's blueprint
   * catalog. The permitted values arrive through `validateManifest`'s context,
   * the same way `knownBlueprints` and `knownModules` do.
   *
   * Optional because manifests written before axes existed are still in the
   * registry, and a stored record does not change because a type did.
   */
  archetype?: ArchetypeAxisSelection
  modules: readonly string[]
  entitlements: readonly string[]

  /** Where, and how isolated. */
  region: string
  isolation: IsolationTier

  /**
   * PACK-020-004 — which system is authoritative for which business domain.
   *
   * Required, where `archetype` above is optional, and the difference is not an
   * inconsistency. A missing archetype can be recovered: the blueprint declares
   * the axes and the manifest's module list is what they compiled to. A missing
   * system of record can be recovered from nothing — there is no fact anywhere
   * in the engine that says whether this customer's ERP or Tenure writes the
   * ledger, and the reading everybody would apply to its absence ("Tenure owns
   * it") is precisely the unrecorded assumption that produces a dual write.
   *
   * `isolation` above is deliberately not this. It says how much infrastructure
   * a tenant has to itself; this says who owns a fact. A `pooled` tenant can be
   * authoritative for everything and a `silo` tenant for nothing.
   */
  coexistence: CoexistenceProfile
  /**
   * Exactly one authoritative writer per domain, per bible §2.
   *
   * A `Record` rather than a list of claims: a key cannot hold two values, so
   * "exactly one" is a property of the shape rather than a rule somebody has to
   * remember to check.
   */
  systemOfRecord: SystemOfRecordMap

  /** Configuration overlay — values only, never secrets. */
  configuration: Readonly<Record<string, unknown>>

  /** Secrets by reference. The value lives in Secrets Manager, never here. */
  secretRefs: Readonly<Record<string, string>>

  /** Who gets the first invitation. Provisioning creates exactly one. */
  initialAdminEmail: string

  /** Free text, shown on the plan. */
  notes?: string
}

export interface ManifestProblem {
  field: string
  reason: string
  detail: string
}

/** Anything that looks like a credential rather than a pointer to one. */
const SECRET_REF_SHAPE = /^(secretsmanager|ssm):[\w/@.-]+$/

/**
 * A slug becomes a URL path segment (`platform.tenurework.com/<slug>`), a
 * DynamoDB partition key and part of resource names. Getting it wrong later is
 * a migration, so it is constrained tightly now.
 */
const SLUG_SHAPE = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/

/**
 * Slugs that would collide with the engine's own routes, or read as official.
 * `platform.tenurework.com/admin` must never be a customer.
 */
const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "auth",
  "console",
  "internal",
  "login",
  "platform",
  "signin",
  "signout",
  "static",
  "studio",
  "support",
  "system",
  "tenure",
  "www",
])

export function validateManifest(
  manifest: TenantManifest,
  context: {
    /** Blueprint ids that exist. A manifest naming a missing one cannot build. */
    knownBlueprints: readonly string[]
    /** Module keys the catalog offers. */
    knownModules: readonly string[]
    /**
     * Axis id → the values that axis accepts, from `ARCHETYPE_AXIS_VALUES`.
     *
     * Passed in for the same reason `knownBlueprints` is: this package cannot
     * import the engine's catalogs. Omit it and an archetype on the manifest is
     * refused outright rather than accepted unchecked — a composition validated
     * against nothing is the failure this whole function exists to prevent.
     */
    archetypeAxes?: Readonly<Record<string, readonly string[]>>
    /** Slugs already taken. GE-102-003 — reserve before provisioning. */
    takenSlugs: readonly string[]
  },
): { valid: boolean; problems: ManifestProblem[] } {
  const problems: ManifestProblem[] = []
  const bad = (field: string, reason: string, detail: string) =>
    problems.push({ field, reason, detail })

  if (manifest.manifestVersion !== MANIFEST_VERSION) {
    bad(
      "manifestVersion",
      "unsupported",
      `This engine writes and reads version ${MANIFEST_VERSION}; got ${manifest.manifestVersion}.`,
    )
  }

  // ── Identity ─────────────────────────────────────────────────────────────
  if (!SLUG_SHAPE.test(manifest.slug)) {
    bad(
      "slug",
      "malformed",
      "A slug is 3–40 characters, lowercase letters, digits and hyphens, starting with a letter " +
        "and not ending in a hyphen. It becomes a URL segment and part of resource names, so " +
        "changing it later is a migration rather than an edit.",
    )
  } else if (RESERVED_SLUGS.has(manifest.slug)) {
    bad("slug", "reserved", `"${manifest.slug}" is reserved by the platform and cannot be a tenant.`)
  } else if (context.takenSlugs.includes(manifest.slug)) {
    bad("slug", "taken", `Another tenant already holds "${manifest.slug}".`)
  }

  if (!manifest.legalName?.trim()) {
    bad("legalName", "required", "The legal entity this system belongs to. Appears on exports and contracts.")
  }
  if (!manifest.displayName?.trim()) {
    bad("displayName", "required", "What users of the system see.")
  }

  // ── System definition ────────────────────────────────────────────────────
  if (!context.knownBlueprints.includes(manifest.blueprintId)) {
    bad(
      "blueprintId",
      "unknown",
      `No blueprint "${manifest.blueprintId}". Available: ${context.knownBlueprints.join(", ")}.`,
    )
  }

  // The composition, checked exactly the way the blueprint id is: against the
  // list of what exists. An axis value nobody implemented compiles to a system
  // nobody can build, and the failure would surface as a missing module three
  // lifecycle states later (PACK-GATE-020).
  if (manifest.archetype) {
    const axes = context.archetypeAxes
    if (!axes) {
      bad(
        "archetype",
        "unvalidatable",
        "This manifest is composed along archetype axes and no axis table was supplied to check " +
          "it against. Accepting it would record a composition nothing verified.",
      )
    } else {
      const single = [
        ["organization", manifest.archetype.organization],
        ["operatingModel", manifest.archetype.operatingModel],
      ] as const
      for (const [axis, value] of single) {
        const permitted = axes[axis]
        if (!permitted) {
          bad("archetype", "unknown-axis", `No archetype axis "${axis}" in this engine.`)
        } else if (!permitted.includes(value)) {
          bad(
            `archetype.${axis}`,
            "unknown-value",
            `"${value}" is not a value of the ${axis} axis. Available: ${permitted.join(", ")}.`,
          )
        }
      }

      const functional = axes.functional
      if (!functional) {
        bad("archetype", "unknown-axis", `No archetype axis "functional" in this engine.`)
      } else {
        if (manifest.archetype.functional.length === 0) {
          bad(
            "archetype.functional",
            "empty",
            "A system with no functional suite compiles to its front door and nothing else.",
          )
        }
        for (const suite of manifest.archetype.functional) {
          if (!functional.includes(suite)) {
            bad(
              "archetype.functional",
              "unknown-value",
              `"${suite}" is not a functional suite. Available: ${functional.join(", ")}.`,
            )
          }
        }
      }
    }
  }

  if (manifest.modules.length === 0) {
    bad("modules", "empty", "A system with no modules has no surfaces and nothing to do.")
  }
  for (const key of manifest.modules) {
    if (!context.knownModules.includes(key)) {
      bad("modules", "unknown", `No module "${key}" in the catalog.`)
    }
  }

  // ── Placement ────────────────────────────────────────────────────────────
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(manifest.region)) {
    bad("region", "malformed", `"${manifest.region}" is not an AWS region id.`)
  }

  // ── Coexistence ──────────────────────────────────────────────────────────
  //
  // PACK-020-004. Delegated to the package that enforces it, so a manifest
  // cannot be accepted under looser rules than `resolveModules` applies — the
  // failure mode that produces a manifest an operator approved and the executor
  // then refuses to build.
  for (const problem of coexistenceProblems({
    profile: manifest.coexistence,
    systemOfRecord: manifest.systemOfRecord ?? {},
  })) {
    bad(problem.field, problem.reason, problem.detail)
  }

  // Stated rather than silently accepted: the tiers above `pooled` need an
  // Organization to vend accounts into, and there isn't one (ADR-0007).
  if (manifest.isolation === "dedicated-account") {
    bad(
      "isolation",
      "unavailable",
      "A dedicated Tenure account requires an AWS Organization to vend it. None exists yet " +
        "(ADR-0007, GE-010). Choosing this would produce a tenant that cannot be built, so it is " +
        "refused here rather than at provisioning time.",
    )
  }

  // ── Secrets ──────────────────────────────────────────────────────────────
  for (const [name, ref] of Object.entries(manifest.secretRefs)) {
    if (!SECRET_REF_SHAPE.test(ref)) {
      bad(
        `secretRefs.${name}`,
        "not-a-reference",
        "A manifest is displayed, stored, diffed and logged. It carries a reference such as " +
          "`secretsmanager:tenure/<slug>/<name>`, never a value. What was given does not look " +
          "like a reference, so it is refused without being echoed back.",
      )
    }
  }

  // A configuration value that looks like a credential is the same mistake
  // wearing a different key.
  for (const [key, value] of Object.entries(manifest.configuration)) {
    if (typeof value !== "string") continue
    if (/(SECRET|PASSWORD|TOKEN|PRIVATE_KEY|CREDENTIAL)/i.test(key) && value.length > 0) {
      bad(
        `configuration.${key}`,
        "secret-in-configuration",
        "This key names a credential. Move it to secretRefs; configuration is rendered on screen.",
      )
    }
  }

  // ── The first human ──────────────────────────────────────────────────────
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(manifest.initialAdminEmail)) {
    bad(
      "initialAdminEmail",
      "malformed",
      "Provisioning creates exactly one invitation, and this is who receives it. A system nobody " +
        "can sign into is not deployed.",
    )
  }

  return { valid: problems.length === 0, problems }
}

/**
 * A stable digest of a manifest.
 *
 * Key order must not change the answer — an operator reordering a form field
 * would otherwise produce a "different" manifest and a spurious diff. Keys are
 * sorted at every level before hashing.
 */
export function digestOf(manifest: TenantManifest): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, canonical(v)]),
      )
    }
    return value
  }

  return createHash("sha256").update(JSON.stringify(canonical(manifest))).digest("hex").slice(0, 32)
}

export interface PlanStep {
  /** What this step brings into existence, in an operator's words. */
  what: string
  /** The lifecycle state during which it runs. */
  during: string
  /** True when the step cannot be undone by rolling back. */
  destructive: boolean
  detail: string
}

export interface ProvisioningPlan {
  slug: string
  digest: string
  steps: readonly PlanStep[]
  /** Monthly USD, in minor units, so no float arithmetic reaches a bill. */
  estimatedMonthlyCostCents: number
  costBasis: string
  warnings: readonly string[]
}

/**
 * What provisioning would do, before it does it.
 *
 * GE-100-004. The point of a plan is that a person reads it — so it is written
 * in what will be created, not in the names of internal steps, and it says
 * plainly which parts cannot be rolled back.
 */
export function planFor(manifest: TenantManifest): ProvisioningPlan {
  const steps: PlanStep[] = [
    {
      what: `Reserve the slug "${manifest.slug}" and its routing`,
      during: "PROVISIONING",
      destructive: false,
      detail:
        "Claims the identifier before anything is built, so two concurrent provisions cannot both " +
        "think they own it (GE-102-003).",
    },
    {
      what: `Create the tenant record and its ${manifest.isolation} placement`,
      during: "PROVISIONING",
      destructive: false,
      detail:
        manifest.isolation === "pooled"
          ? "A pooled tenant shares the cell's database and cluster. Isolation is the application's " +
            "tenant scope, enforced at the query layer and asserted by the isolation suite — real, " +
            "and not the same thing as separate infrastructure."
          : `A ${manifest.isolation} tenant takes dedicated resources within the cell.`,
    },
    {
      what: `Apply the ${manifest.blueprintId} blueprint and enable ${manifest.modules.length} modules`,
      during: "CONFIGURING",
      destructive: false,
      detail: manifest.modules.join(", "),
    },
    {
      what: "Apply the configuration overlay and resolve every value",
      during: "CONFIGURING",
      destructive: false,
      detail:
        Object.keys(manifest.configuration).length === 0
          ? "No overrides — every value resolves from the blueprint and platform defaults."
          : `${Object.keys(manifest.configuration).length} overrides on top of the blueprint.`,
    },
    {
      what: "Run database migrations to the current schema",
      during: "MIGRATING",
      destructive: false,
      detail: "Forward-only. A migration that fails leaves the tenant in FAILED with nothing routed.",
    },
    {
      what: "Verify isolation, authorization, and that the system answers",
      during: "VERIFYING",
      destructive: false,
      detail:
        "Includes a cross-tenant read that MUST fail. A tenant that cannot prove its own isolation " +
        "does not reach READY.",
    },
    {
      what: `Invite ${manifest.initialAdminEmail} as the first administrator`,
      during: "VERIFYING",
      destructive: false,
      detail: "Exactly one invitation, audited. Retrying provisioning must not send a second.",
    },
    {
      what: "Switch routing on",
      during: "ACTIVATING",
      destructive: false,
      detail:
        "The separate act. Everything above happens with no user able to reach the system; this is " +
        "the step that changes that, and it needs a second person's approval.",
    },
  ]

  // Cost, stated in what is actually consumed rather than as a single number
  // with no derivation. A pooled tenant adds no standing infrastructure.
  const POOLED_CENTS = 0
  const DEDICATED_CENTS = 2_500 // ALB ~$16 + a small task ~$9

  const estimatedMonthlyCostCents = manifest.isolation === "pooled" ? POOLED_CENTS : DEDICATED_CENTS

  const warnings: string[] = []
  if (manifest.isolation === "pooled") {
    warnings.push(
      "Pooled placement adds no standing infrastructure, so the marginal monthly cost is zero. " +
        "It is not free: this tenant's share of the cell's database, cluster and storage is real, " +
        "and is attributed by tag rather than by a billing boundary. An account per tenant is what " +
        "makes that exact, and requires GE-010.",
    )
  }
  if (Object.keys(manifest.secretRefs).length === 0) {
    warnings.push("No secrets referenced. Correct for a pooled tenant with no external integrations.")
  }

  // PACK-020-004. On the plan, because this is the sentence an operator has to
  // read before approving: modules that write these domains will be refused,
  // and a system that looks short of features for a reason nobody wrote down is
  // how somebody "fixes" it by removing the coexistence declaration.
  const external = externalDomains(manifest.systemOfRecord ?? {})
  if (external.length > 0) {
    warnings.push(
      `Coexistence profile ${manifest.coexistence}: an external system is authoritative for ` +
        `${external.join(", ")}. Modules that write ${external.length === 1 ? "that domain" : "those domains"} ` +
        `are refused, because exactly one system writes a domain's facts.`,
    )
  }

  return {
    slug: manifest.slug,
    digest: digestOf(manifest),
    steps,
    estimatedMonthlyCostCents,
    costBasis:
      manifest.isolation === "pooled"
        ? "No new billable resources; marginal cost only."
        : "One ALB and one 0.25 vCPU Fargate task, at us-east-1 on-demand rates.",
    warnings,
  }
}
