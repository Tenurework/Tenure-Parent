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

/**
 * Which way facts are allowed to move for one object.
 *
 * A domain-level authority answers "who writes it". It does not answer "and how
 * does the other side ever learn", and those are different questions the moment
 * a profile says `COEXISTENCE_TRANSITION` — a bidirectional arrangement with no
 * direction recorded is exactly the unnamed dual write the header quote above
 * prohibits.
 *
 * Written from **Tenure's** point of view, always, because a relative word
 * ("upstream") means the opposite thing depending on who is reading:
 *
 *   `INBOUND`        the external system writes; Tenure receives a copy.
 *   `OUTBOUND`       Tenure writes; the external system receives a copy.
 *   `BIDIRECTIONAL`  both sides write different fields of the same object, and
 *                    the field-level owners below say which. Refused outside the
 *                    two profiles that declare bidirectional coexistence.
 *   `NONE`           no sync channel at all. The other side never learns.
 */
export const SYNC_DIRECTIONS = ["INBOUND", "OUTBOUND", "BIDIRECTIONAL", "NONE"] as const

export type SyncDirection = (typeof SYNC_DIRECTIONS)[number]

/**
 * One field of an object whose owner differs from the object's.
 *
 * The reason this exists rather than stopping at the object: a customer whose
 * ERP owns the invoice still types the internal note into Tenure, and a model
 * that can only say "external owns Invoice" either forbids that or leaves it
 * undeclared. Undeclared is what this repository had.
 */
export interface FieldAuthority {
  field: string
  authority: SystemOfRecordAuthority
}

/**
 * One canonical object's authority and sync contract.
 *
 * `domain` is stated rather than parsed out of `object`, so the contradiction
 * rule below compares two recorded facts instead of a fact and a naming
 * convention. An object whose domain is not in `systemOfRecord` is refused: a
 * domain nobody decided cannot be the thing an object is consistent with.
 */
export interface ObjectAuthority {
  /** The business domain this object belongs to — a key of `systemOfRecord`. */
  domain: string
  /** The canonical object, e.g. a Prisma model name. */
  object: string
  authority: SystemOfRecordAuthority
  direction: SyncDirection
  /** Fields whose owner differs from the object's. Absent means none do. */
  fields?: readonly FieldAuthority[]
}

export interface CoexistenceDeclaration {
  profile: CoexistenceProfile
  systemOfRecord: SystemOfRecordMap
  /**
   * Object- and field-level authority, refining the domain-level map.
   *
   * Optional, and that is not a soft rule: a tenant with no entry here has
   * declared authority at the domain grain only, which is what every tenant in
   * this repository has today. What it may NOT do is disagree with the domain
   * map — `coexistenceProblems` refuses that, because an object claiming Tenure
   * inside a domain an external system owns is a second writer at somebody
   * else's ledger wearing an object name.
   */
  objectAuthority?: readonly ObjectAuthority[]
}

/**
 * The profiles under which `BIDIRECTIONAL` is a declaration rather than a wish.
 *
 * Both name it in their own definition above. Every other profile has a single
 * authoritative side by construction, so a bidirectional object under one of
 * them is a contradiction between the profile and the object.
 */
export const BIDIRECTIONAL_PROFILES: readonly CoexistenceProfile[] = [
  "COEXISTENCE_TRANSITION",
  "HYBRID_PROCESS_SPLIT",
]

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

  // ── object and field authority ────────────────────────────────────────────
  //
  // The domain map answers "who writes finance". These answer "who writes THIS
  // object, THIS field, and by what channel does the other side learn". Three
  // rules, each refusing a declaration that reads as a decision and is a
  // contradiction:
  //
  //   (a) an object disagreeing with its own domain — the invisible second
  //       writer;
  //   (b) BIDIRECTIONAL under a profile that is not bidirectional — a direction
  //       the arrangement does not have;
  //   (c) a field owned by the other side with no sync channel — a field that
  //       silently never updates, which looks identical to a field nobody has
  //       changed yet.
  const seenObjects = new Set<string>()
  for (const entry of declaration.objectAuthority ?? []) {
    const at = `objectAuthority.${entry?.domain ?? "?"}.${entry?.object ?? "?"}`

    if (!entry || !entry.object?.trim() || !entry.domain?.trim()) {
      bad(
        "objectAuthority",
        "malformed",
        "An object-level authority names both the business domain it belongs to and the object " +
          "itself. One without the other cannot be checked against the domain map, and an entry " +
          "nothing can check is a claim, not a declaration.",
      )
      continue
    }

    const key = `${entry.domain}.${entry.object}`
    if (seenObjects.has(key)) {
      bad(
        at,
        "duplicate-object",
        `"${key}" is declared twice. Exactly one authoritative writer per object is the same ` +
          `invariant the domain map holds by being a Record; a list has to be checked for it.`,
      )
    }
    seenObjects.add(key)

    if (entry.authority !== "tenure" && entry.authority !== "external") {
      bad(
        at,
        "unknown-authority",
        `"${entry.authority}" is not a system of record. Exactly one of "tenure" or "external".`,
      )
    }
    if (!SYNC_DIRECTIONS.includes(entry.direction)) {
      bad(
        at,
        "unknown-direction",
        `"${entry.direction}" is not a sync direction. One of: ${SYNC_DIRECTIONS.join(", ")}. ` +
          `A copy with no stated direction is a copy nobody can say is allowed.`,
      )
    }

    // (a) — the object against its domain.
    const domainAuthority = declaration.systemOfRecord?.[entry.domain]
    if (domainAuthority === undefined) {
      bad(
        at,
        "domain-not-declared",
        `"${entry.domain}" records no authoritative write system, so there is nothing for ` +
          `"${entry.object}" to be consistent with. Declare the domain before refining it.`,
      )
    } else if (
      (entry.authority === "tenure" || entry.authority === "external") &&
      entry.authority !== domainAuthority
    ) {
      bad(
        at,
        "contradicts-system-of-record",
        `"${entry.object}" claims ${entry.authority} is authoritative and the ${entry.domain} ` +
          `domain records ${domainAuthority}. Whichever of the two a later reader believes ` +
          `decides whether a second writer reaches the ledger, so the declaration is refused ` +
          `rather than resolved. Move the whole domain, or drop the object.`,
      )
    }

    // (b) — a direction the profile does not have.
    if (
      entry.direction === "BIDIRECTIONAL" &&
      !BIDIRECTIONAL_PROFILES.includes(declaration.profile)
    ) {
      bad(
        at,
        "bidirectional-outside-coexistence",
        `"${entry.object}" declares BIDIRECTIONAL sync under ${declaration.profile}, which has a ` +
          `single authoritative side by construction. Only ${BIDIRECTIONAL_PROFILES.join(" and ")} ` +
          `declare bidirectional coexistence; under anything else this is the dual write a ` +
          `named reconciliation protocol would have to prove safe.`,
      )
    }

    // (c) — a field owned by the other side, with no channel to reach it.
    const seenFields = new Set<string>()
    for (const field of entry.fields ?? []) {
      const fieldAt = `${at}.${field?.field ?? "?"}`
      if (!field || !field.field?.trim()) {
        bad(fieldAt, "malformed", `${at} declares a field-level owner with no field name.`)
        continue
      }
      if (seenFields.has(field.field)) {
        bad(fieldAt, "duplicate-field", `"${field.field}" is declared twice on "${entry.object}".`)
      }
      seenFields.add(field.field)

      if (field.authority !== "tenure" && field.authority !== "external") {
        bad(
          fieldAt,
          "unknown-authority",
          `"${field.authority}" is not a system of record. Exactly one of "tenure" or "external".`,
        )
        continue
      }

      if (field.authority !== entry.authority && entry.direction === "NONE") {
        bad(
          fieldAt,
          "field-owner-without-sync",
          `"${field.field}" is owned by ${field.authority} while "${entry.object}" is owned by ` +
            `${entry.authority}, and the object declares no sync channel. A field the other side ` +
            `writes and this side never receives does not fail — it silently never updates, ` +
            `which is indistinguishable from a field nobody has changed yet.`,
        )
      }
    }
  }

  return problems
}

/**
 * Objects whose authority or sync contract an operator has to read before
 * approving, in a stable order.
 *
 * Used by the provisioning plan: the domain-level warning already says which
 * domains an external system owns, and this is the sentence that says which
 * objects inside them move, in which direction, and which fields the other side
 * writes. An operator approving a `COEXISTENCE_TRANSITION` without seeing that
 * is approving the word "bidirectional".
 */
export function objectAuthorityNotes(
  declaration: Pick<CoexistenceDeclaration, "objectAuthority">,
): readonly string[] {
  return [...(declaration.objectAuthority ?? [])]
    .filter((entry) => entry?.domain && entry?.object)
    .sort((a, b) => `${a.domain}.${a.object}`.localeCompare(`${b.domain}.${b.object}`))
    .map((entry) => {
      const split = (entry.fields ?? [])
        .filter((f) => f?.field && f.authority !== entry.authority)
        .map((f) => `${f.field} → ${f.authority}`)
      return (
        `${entry.domain}.${entry.object}: ${entry.authority} writes it, sync ${entry.direction}` +
        (split.length > 0 ? `, except ${split.join(", ")}` : "") +
        "."
      )
    })
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
