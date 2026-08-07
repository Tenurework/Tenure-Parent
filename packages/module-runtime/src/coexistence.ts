import { PERMISSION_DOMAINS, lookupPermission } from "@tenure/authorization"

import type { ModuleManifest } from "./manifest"

/**
 * PACK-020-004 — coexistence with the systems a customer already runs.
 *
 * Bible §2 is explicit that customer on-premise estates and other clouds are
 * **external systems**, not Tenure deployment targets, and that coexistence is
 * modelled through profiles. It is equally explicit about the rule that makes
 * the profiles mean something:
 *
 *   "Every business domain records exactly one authoritative write system per
 *    effective period. Dual write is prohibited unless a named reconciliation
 *    ownership protocol proves safety."
 *
 * Nothing in this repository recorded that. `TenantManifest` carried an
 * `IsolationTier` — which is about how much infrastructure a tenant has to
 * itself, not about who owns a fact — and every tenant was implicitly assumed
 * to be authoritative for everything. That assumption is invisible, and an
 * invisible assumption about who owns finance is how two systems both post to a
 * ledger.
 *
 * ## Why this lives here and not in `@tenure/provisioning`
 *
 * Two things need the vocabulary: the manifest an operator composes (the
 * engine) and module resolution (the cell reads it through
 * `@tenure/platform-config`). `apps/web` must not import the engine's control
 * plane — `tests/security/cell-independence.test.mjs` fails the build if it
 * does — so the definition sits in the package that *enforces* it, which both
 * sides may depend on.
 *
 * ## Why a domain is not a new list
 *
 * The permission catalog already names the business domains, and every module
 * declares the permissions it confers. So a module's domains are derived —
 * `budgeting` is `finance` because `finance.budget.read` is — rather than being
 * a second list that can disagree with the first. Two lists that can disagree
 * eventually do; this repository has that lesson written on
 * `packages/platform-config/src/module-permissions.test.ts`.
 */

/** Bible §2, in order. */
export const COEXISTENCE_PROFILES = [
  /** Tenure is authoritative for the selected domains. */
  "TENURE_CLOUD_PRIMARY",
  /** External ERP is authoritative; Tenure augments memory/workflow/modules. */
  "EXTERNAL_ERP_PRIMARY",
  /** Tenure runs subsidiary/local domains and consolidates to a corporate ERP. */
  "TWO_TIER_SUBSIDIARY",
  /** The system of record is assigned per process/domain. */
  "HYBRID_PROCESS_SPLIT",
  /** Temporary, controlled, bidirectional coexistence during transformation. */
  "COEXISTENCE_TRANSITION",
  /** Tenure becomes authoritative after reconciliation and cutover. */
  "MIGRATION_IN_PROGRESS",
  /** Legacy records retained and searchable under a read-only policy. */
  "ARCHIVE_AND_MEMORY",
] as const

export type CoexistenceProfile = (typeof COEXISTENCE_PROFILES)[number]

/** Who may write a domain's facts. Exactly one value per domain, always. */
export type SystemOfRecordAuthority = "tenure" | "external"

/**
 * Which system owns each business domain.
 *
 * A `Record`, not a list of claims, because the shape is the invariant: a key
 * cannot hold two values, so "exactly one authoritative write system per
 * domain" is unrepresentable-otherwise rather than checked-afterwards.
 */
export type SystemOfRecordMap = Readonly<Record<string, SystemOfRecordAuthority>>

export interface CoexistenceDeclaration {
  profile: CoexistenceProfile
  systemOfRecord: SystemOfRecordMap
}

/** The domains a system of record may be declared for. */
export const BUSINESS_DOMAINS: readonly string[] = PERMISSION_DOMAINS

export interface CoexistenceProblem {
  field: string
  reason: string
  detail: string
}

/**
 * Whether a declaration says something coherent.
 *
 * Each rule below refuses a declaration that would read as a decision and is
 * actually a contradiction. They are not stylistic: `TENURE_CLOUD_PRIMARY` with
 * an external domain is a tenant whose profile says Tenure owns everything and
 * whose data says otherwise, and whichever of the two a later reader believes
 * decides whether a second writer is allowed at the ledger.
 */
export function coexistenceProblems(
  declaration: CoexistenceDeclaration,
): readonly CoexistenceProblem[] {
  const problems: CoexistenceProblem[] = []
  const bad = (field: string, reason: string, detail: string) =>
    problems.push({ field, reason, detail })

  if (!COEXISTENCE_PROFILES.includes(declaration.profile)) {
    bad(
      "coexistence",
      "unknown-profile",
      `"${declaration.profile}" is not a coexistence profile. One of: ${COEXISTENCE_PROFILES.join(", ")}.`,
    )
  }

  const entries = Object.entries(declaration.systemOfRecord ?? {})
  if (entries.length === 0) {
    bad(
      "systemOfRecord",
      "empty",
      "No domain records an authoritative write system. 'Exactly one authoritative system per " +
        "domain' cannot be true of a map with no domains in it, and an empty map reads as " +
        "'Tenure owns everything' to anyone who does not look.",
    )
  }

  for (const [domain, authority] of entries) {
    if (!BUSINESS_DOMAINS.includes(domain)) {
      bad(
        `systemOfRecord.${domain}`,
        "unknown-domain",
        `No business domain "${domain}". One of: ${BUSINESS_DOMAINS.join(", ")}.`,
      )
    }
    if (authority !== "tenure" && authority !== "external") {
      bad(
        `systemOfRecord.${domain}`,
        "unknown-authority",
        `"${authority}" is not a system of record. Exactly one of "tenure" or "external".`,
      )
    }
  }

  const external = externalDomains(declaration.systemOfRecord)

  if (declaration.profile === "TENURE_CLOUD_PRIMARY" && external.length > 0) {
    bad(
      "coexistence",
      "contradicts-system-of-record",
      `TENURE_CLOUD_PRIMARY says Tenure is authoritative, and ${external.join(", ")} name an ` +
        `external system. Pick HYBRID_PROCESS_SPLIT if the split is deliberate.`,
    )
  }

  if (declaration.profile === "EXTERNAL_ERP_PRIMARY" && external.length === 0) {
    bad(
      "coexistence",
      "contradicts-system-of-record",
      "EXTERNAL_ERP_PRIMARY says an external ERP is authoritative, and no domain names one. " +
        "A profile nothing in the data supports is a label.",
    )
  }

  if (
    declaration.profile === "ARCHIVE_AND_MEMORY" &&
    entries.length > 0 &&
    external.length !== entries.length
  ) {
    bad(
      "coexistence",
      "contradicts-system-of-record",
      "ARCHIVE_AND_MEMORY retains legacy records under a read-only policy, so every domain it " +
        "declares belongs to the external system. A domain Tenure writes is not archived.",
    )
  }

  return problems
}

/** The domains an external system owns, sorted. */
export function externalDomains(map: SystemOfRecordMap): readonly string[] {
  return Object.entries(map ?? {})
    .filter(([, authority]) => authority === "external")
    .map(([domain]) => domain)
    .sort()
}

/**
 * The business domains a module writes into.
 *
 * Derived from the permissions it declares, through the same catalog
 * `validateManifest` checks them against. A module that confers no permission —
 * `dashboard` — writes nothing anybody owns and is never refused on this
 * ground, which is correct: a front door is not a system of record.
 */
export function moduleDomains(module: ModuleManifest): readonly string[] {
  const domains = new Set<string>()
  for (const permission of module.permissions ?? []) {
    const definition = lookupPermission(permission)
    if (definition) domains.add(definition.domain)
  }
  return [...domains].sort()
}
