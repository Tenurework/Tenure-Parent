import type { ConfigDefinition } from "./definition"
import type { LayerKind, VersionedLayer } from "./layer-schema"

/**
 * GE-031-002 — the configuration domains, and who may write into each.
 *
 * The engine already knew how to resolve a value through ordered layers. What
 * it had no opinion about was *which layer is allowed to set which key*. Every
 * definition carried its own `allowedScopes`, so authority was decided one key
 * at a time by whoever added the key — and the question that actually matters
 * ("can a tenant administrator move their own data to another region?") had no
 * single place to be answered.
 *
 * A domain answers it once, for a whole namespace.
 *
 * ## Why this is not a table of names
 *
 * A domain is enforced in two directions:
 *
 *   * **At load.** `validateDomains` refuses a definition whose key belongs to
 *     no domain, or whose `allowedScopes` exceed what the domain permits. A key
 *     with a typo'd prefix would otherwise be governed by nothing at all.
 *   * **At resolution.** A layer that sets a key its kind may not write has the
 *     value STRIPPED and the attempt reported — the same shape as the invariant
 *     refusal in `layer-bridge.ts`, and for the same reason: a refusal that
 *     leaves the value in place is advisory, and advisory access control is
 *     access control that does not work.
 *
 * ## Reserved is declared, not implied
 *
 * The item names fourteen domains. Four have keys today. The other ten are
 * declared `reserved` with the item that will fill them, rather than omitted,
 * because an undeclared namespace is ungoverned: `platform.deployment.region`
 * with no `deployment` domain is a key any tenant layer may set. Reserving it
 * means the governance arrives before the first key does, which is the only
 * order that is safe.
 *
 * This is the same distinction `duplicate-sources.json` draws between a source
 * that is dead and one that is built and not connected. "Nothing here yet" and
 * "nothing here on purpose, and here is who owns it" must not look the same.
 */

/** What a domain governs, and who may change it. */
export interface ConfigDomain {
  /** Stable id. Also the segment after `platform.` for its own prefix. */
  id: string
  /** Key prefixes this domain owns. Usually one; `organization` owns two. */
  prefixes: readonly string[]
  /** One line, for an operator reading a diff. */
  governs: string
  /**
   * Layer kinds permitted to set keys in this domain.
   *
   * Anything not listed is refused at resolution and reported. Ordering is
   * irrelevant — precedence is `layerRank`'s job, and duplicating it here would
   * create a second precedence order to disagree with the first.
   */
  writableBy: readonly LayerKind[]
  /**
   * Whether a TENANT ADMINISTRATOR may edit this from the tenant console.
   *
   * Deliberately separate from `writableBy`. An operator writing a tenant layer
   * on a customer's behalf and a customer writing it themselves are different
   * acts with different blast radii, and collapsing them is how "configurable"
   * becomes "the customer can move their own students to another continent".
   * GE-032-002 enforces this in the console; the flag lives here so both halves
   * read the same answer.
   */
  tenantAdminMayWrite: boolean
  /** `active` — has keys today. `reserved` — governed before it exists. */
  status: "active" | "reserved"
  /** For a reserved domain: the item that will fill it. Required, so a reservation expires. */
  reservedFor?: string
}

/** Every layer kind. Domains that are simply "configuration" get this set. */
const ALL_TENANT_LAYERS: readonly LayerKind[] = [
  "platformInvariant",
  "partitionRegion",
  "environment",
  "plan",
  "industryPack",
  "orgTemplate",
  "tenantBaseline",
  "tenantOverlay",
  "orgUnitOverlay",
  "experiment",
  "emergencyDeny",
]

/** Estate shape. Set by Tenure, never by a customer, at any scope. */
const PLATFORM_ONLY: readonly LayerKind[] = [
  "platformInvariant",
  "partitionRegion",
  "environment",
  "plan",
]

export const CONFIG_DOMAINS: readonly ConfigDomain[] = [
  {
    id: "identity",
    prefixes: ["platform.identity."],
    governs: "Authentication providers, session lifetime, step-up rules, account linking.",
    // Contracted at onboarding (`tenantBaseline`), not adjustable afterwards by
    // the customer. A tenant administrator who can repoint the identity provider
    // can issue themselves any identity in the tenant; that is an account
    // takeover with a configuration diff instead of an exploit.
    writableBy: [...PLATFORM_ONLY, "industryPack", "orgTemplate", "tenantBaseline"],
    tenantAdminMayWrite: false,
    status: "reserved",
    reservedFor: "GE-033 (identity and access)",
  },
  {
    id: "organization",
    // Terminology IS organization vocabulary — what this institution calls a
    // club, a board, a seat, the office that oversees them. It is grouped here
    // rather than under localization because translating "Organization" into
    // French and renaming it "Chapter" are different acts: one is a locale, the
    // other is this customer's model of itself.
    prefixes: ["platform.organization.", "platform.terminology."],
    governs: "Organization types, the unit graph, seats, and the words this institution uses for them.",
    writableBy: ALL_TENANT_LAYERS,
    tenantAdminMayWrite: true,
    status: "active",
  },
  {
    id: "permissions",
    prefixes: ["platform.permissions."],
    governs: "Roles, policy bindings, delegations, and the capabilities each seat carries.",
    // Not `orgUnitOverlay`. An org unit granting itself a capability its parent
    // did not give it is privilege escalation expressed as configuration, and
    // the overlay is the layer a unit administers itself with.
    writableBy: [...PLATFORM_ONLY, "industryPack", "orgTemplate", "tenantBaseline", "tenantOverlay", "emergencyDeny"],
    tenantAdminMayWrite: true,
    status: "reserved",
    reservedFor: "GE-034 (authorization)",
  },
  {
    id: "modules",
    // Flags gate features, and a feature is what a module ships. One domain, so
    // "is this on for this tenant" has one governed answer rather than a module
    // registry and a flag store that can disagree.
    prefixes: ["platform.modules.", "platform.flags."],
    governs: "Which modules and features are enabled, their rollout, and the emergency kill list.",
    writableBy: ALL_TENANT_LAYERS,
    tenantAdminMayWrite: true,
    status: "active",
  },
  {
    id: "entities",
    prefixes: ["platform.entities."],
    governs: "Custom entities, fields, validation, and the forms that capture them.",
    writableBy: ALL_TENANT_LAYERS,
    tenantAdminMayWrite: true,
    status: "reserved",
    reservedFor: "GE-035 (metadata and forms)",
  },
  {
    id: "workflows",
    prefixes: ["platform.workflows."],
    governs: "Approval chains, transitions, escalations, and automations.",
    writableBy: ALL_TENANT_LAYERS,
    tenantAdminMayWrite: true,
    status: "reserved",
    reservedFor: "GE-036 (workflow)",
  },
  {
    id: "reports",
    prefixes: ["platform.reports."],
    governs: "Report definitions, saved views, scheduled delivery, and export limits.",
    writableBy: ALL_TENANT_LAYERS,
    tenantAdminMayWrite: true,
    status: "reserved",
    reservedFor: "GE-037 (reporting)",
  },
  {
    id: "connectors",
    prefixes: ["platform.connectors."],
    governs: "Outbound integrations, their credentials' namespaces, and per-connector rate limits.",
    // A connector moves tenant data OUT. Which connectors exist is the
    // platform's and the plan's decision; a tenant configures the ones they are
    // entitled to, and cannot add a destination nobody reviewed.
    writableBy: [...PLATFORM_ONLY, "industryPack", "orgTemplate", "tenantBaseline", "tenantOverlay"],
    tenantAdminMayWrite: true,
    status: "reserved",
    reservedFor: "GE-038 (integrations)",
  },
  {
    id: "relay",
    prefixes: ["platform.relay."],
    governs: "Assistant tool exposure, grounding sources, retention, and per-tenant model policy.",
    writableBy: [...PLATFORM_ONLY, "industryPack", "orgTemplate", "tenantBaseline", "tenantOverlay"],
    tenantAdminMayWrite: true,
    status: "reserved",
    reservedFor: "GE-039 (Relay)",
  },
  {
    id: "localization",
    prefixes: ["platform.localization."],
    governs: "Locale, currency, calendar, working days, holidays, and text direction.",
    writableBy: ALL_TENANT_LAYERS,
    tenantAdminMayWrite: true,
    status: "active",
  },
  {
    id: "deployment",
    prefixes: ["platform.deployment."],
    governs: "Partition, region, cell placement, and residency constraints.",
    // The one that most needs to be here before its first key exists. This is
    // where a tenant's data physically lives; `apps/web/src/lib/cell-context.ts`
    // fails closed on an unset region for the same reason. A tenant layer able
    // to set it would route around a residency constraint with a text edit.
    writableBy: PLATFORM_ONLY,
    tenantAdminMayWrite: false,
    status: "reserved",
    reservedFor: "GE-012 (estate) / GE-030 (placement)",
  },
  {
    id: "recovery",
    prefixes: ["platform.recovery."],
    governs: "Backup schedule, retention, restore targets, and tested recovery objectives.",
    // A customer who can shorten their own backup retention can do so the day
    // before they need it, and the request looks exactly like cost tuning.
    writableBy: PLATFORM_ONLY,
    tenantAdminMayWrite: false,
    status: "reserved",
    reservedFor: "GE-040 (resilience)",
  },
  {
    id: "observability",
    prefixes: ["platform.observability."],
    governs: "Log retention and destinations, trace sampling, metric cardinality, alert routing.",
    // Audit integrity. Turning down one's own logging is the first step of most
    // incidents that are discovered late.
    writableBy: PLATFORM_ONLY,
    tenantAdminMayWrite: false,
    status: "reserved",
    reservedFor: "GE-041 (observability)",
  },
  {
    id: "cost",
    prefixes: ["platform.cost."],
    governs: "Quotas, rate limits, metered allowances, and budget alert thresholds.",
    writableBy: PLATFORM_ONLY,
    tenantAdminMayWrite: false,
    status: "reserved",
    reservedFor: "GE-042 (metering and billing)",
  },
  {
    // Not in the item's list of fourteen, and it has three live keys. Leaving it
    // out would mean `platform.branding.*` belongs to no domain and is therefore
    // governed by nothing — which is precisely the hole the reserved entries
    // above exist to close. The list in the item is a minimum.
    id: "branding",
    prefixes: ["platform.branding."],
    governs: "Wordmark, primary colour, and the text colour proven against it for contrast.",
    writableBy: ALL_TENANT_LAYERS,
    tenantAdminMayWrite: true,
    status: "active",
  },
]

const BY_ID = new Map(CONFIG_DOMAINS.map((d) => [d.id, d]))

/** The domain a key belongs to, or `null` if no domain claims it. */
export function domainOf(key: string): ConfigDomain | null {
  // Longest prefix wins, so a future `platform.organization.seats.` domain can
  // be carved out of `platform.organization.` without ambiguity.
  let best: ConfigDomain | null = null
  let bestLength = -1
  for (const domain of CONFIG_DOMAINS) {
    for (const prefix of domain.prefixes) {
      if (key.startsWith(prefix) && prefix.length > bestLength) {
        best = domain
        bestLength = prefix.length
      }
    }
  }
  return best
}

export function getDomain(id: string): ConfigDomain | undefined {
  return BY_ID.get(id)
}

/**
 * Which scopes a domain's `writableBy` implies.
 *
 * Kept as a local mapping rather than imported from `layer-bridge` to avoid a
 * cycle; `domains.test.ts` asserts the two agree, so a divergence fails rather
 * than silently widening authority.
 */
const SCOPES_FOR_KIND: Readonly<Record<LayerKind, string | null>> = {
  platformInvariant: "platform",
  partitionRegion: "platform",
  environment: "platform",
  plan: "module",
  industryPack: "blueprint",
  orgTemplate: "blueprint",
  tenantBaseline: "tenant",
  tenantOverlay: "tenant",
  orgUnitOverlay: "orgUnit",
  experiment: null,
  emergencyDeny: null,
}

export interface DomainProblem {
  key: string
  problem: string
}

/**
 * Scopes some layer kind can actually produce.
 *
 * Derived, never listed. `CONFIG_SCOPES` has nine and only five are reachable
 * — `user`, `legalEntity`, `workspace` and `archetype` have no layer kind.
 * `archetype` is written directly by `layersFor` and the Studio's execution
 * context rather than through the versioned layer schema, so it is unreachable
 * here for the same reason `user` is: no `LayerKind` produces one. Writing the
 * reachable set out by hand would be a third copy of the same fact, and it
 * would stop being true the moment a twelfth kind is added, which is exactly
 * when this check needs to be right.
 */
const REACHABLE_SCOPES: ReadonlySet<string> = new Set(
  Object.values(SCOPES_FOR_KIND).filter((s): s is string => s !== null),
)


/**
 * Every definition belongs to a domain, and stays inside its authority.
 *
 * Run at registry construction. Two failures it catches, both silent otherwise:
 * a key whose prefix matches no domain (governed by nothing), and a definition
 * declaring a scope its domain does not permit (authority granted per-key,
 * routing around the domain that exists to decide it).
 */
export function validateDomains(definitions: readonly ConfigDefinition[]): readonly DomainProblem[] {
  const problems: DomainProblem[] = []

  for (const definition of definitions) {
    const domain = domainOf(definition.key)
    if (!domain) {
      problems.push({
        key: definition.key,
        problem:
          `no domain claims this key. Add its prefix to a domain in domains.ts — an unclaimed ` +
          `key is governed by nothing, and any layer may set it.`,
      })
      continue
    }

    const permitted = new Set(
      domain.writableBy.map((kind) => SCOPES_FOR_KIND[kind]).filter((s): s is string => s !== null),
    )

    for (const scope of definition.allowedScopes) {
      if (permitted.has(scope)) continue

      // A scope that NO layer kind produces is not authority the domain can be
      // routed around — nothing can write it. `user`, `legalEntity` and
      // `workspace` are in that position today: they are real scopes with no
      // layer kind mapping to them, and six localization keys legitimately
      // allow them (a person choosing their own locale is the product intent).
      //
      // The first version of this check refused those, which would have forced
      // six correct definitions to be narrowed to satisfy a rule about a risk
      // that does not exist yet. It fails closed at the moment it starts to
      // matter instead: the day a layer kind maps to `user`, a `user` scope on
      // a key whose domain excludes that kind becomes a real grant and is
      // refused here, with no change to this function.
      const reachableBySomeKind = REACHABLE_SCOPES.has(scope)
      if (!reachableBySomeKind) continue

      problems.push({
        key: definition.key,
        problem:
          `allows scope "${scope}", which domain "${domain.id}" does not permit ` +
          `(${[...permitted].sort().join(", ") || "none"}). Widen the domain deliberately, or ` +
          `narrow the definition — do not grant authority one key at a time.`,
      })
    }
  }

  return problems
}

export interface DomainRefusal {
  /** The layer that tried. */
  id: string
  kind: LayerKind
  key: string
  domain: string
  reason: string
}

/**
 * Keys a layer may not set, given its kind.
 *
 * Returns the refusals; stripping them is the caller's job, exactly as with
 * invariants, so that "it was refused" and "the value did not apply" are the
 * same event rather than two things that can disagree.
 */
export function refusedByDomain(layers: readonly VersionedLayer[]): readonly DomainRefusal[] {
  const refusals: DomainRefusal[] = []

  for (const layer of layers) {
    for (const key of Object.keys(layer.values)) {
      const domain = domainOf(key)
      // An unclaimed key is NOT refused here. `validateDomains` rejects those at
      // load, and refusing them again at resolution would mean a typo in a
      // tenant overlay silently resolved to the default instead of erroring —
      // failing quietly in the layer a customer edits is the worst place for it.
      if (!domain) continue
      if (domain.writableBy.includes(layer.kind)) continue
      refusals.push({
        id: layer.id,
        kind: layer.kind,
        key,
        domain: domain.id,
        reason:
          `domain "${domain.id}" (${domain.governs}) is not writable by a ${layer.kind} layer; ` +
          `it accepts ${domain.writableBy.join(", ")}.`,
      })
    }
  }

  return refusals
}
