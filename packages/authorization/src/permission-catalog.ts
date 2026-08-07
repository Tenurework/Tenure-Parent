/**
 * GE-051-001 — the semantic permission catalog.
 *
 * Bible §9.3: permissions use stable semantic keys independent of tenant
 * terminology. "Tenant labels may rename Treasurer to Finance Lead or Division
 * to Faculty, but semantic permission keys do not change."
 *
 * Independence is not a promise this file can make on its own — it is a
 * property something has to be able to fail. Three things enforce it:
 *
 *   1. Nothing here imports configuration, terminology or blueprints, so no key
 *      can be derived from a tenant's vocabulary. `tests/architecture/`
 *      asserts the absence of those imports, because a rule about dependencies
 *      is only real if something reads the import list.
 *   2. `permission-catalog.test.ts` collects the words each blueprint uses to
 *      name a *particular thing* — its org-unit types, its oversight office —
 *      and asserts no key segment is one of them. That is what would catch
 *      `finance.treasurer.approve`, which reads as a permission and is really a
 *      role title. A tenant's word for a platform *concept* is a different
 *      thing and may coincide; the test says why at length.
 *   3. Keys are composed, not typed. `key` is asserted equal to
 *      `domain.resource.action`, so a key cannot drift from its own parts.
 *
 * ## Why the module is a field and not the first segment
 *
 * `decide()` used to derive the module from the text before the first dot. That
 * makes the *name* of a permission decide which module must be enabled, and the
 * two do not line up: `finance.budget.read` belongs to `budgeting` while
 * `finance.reimbursement.approve` belongs to `reimbursements` — one domain, two
 * modules. Deriving it also silently mishandled the malformed case, where a
 * permission with no dot was treated as platform-level and skipped the module
 * gate entirely.
 *
 * So the module is declared per permission, and `null` means platform-level on
 * purpose rather than by accident.
 */

/** Modules a permission can be gated on. Kept to what blueprints actually run. */
export const MODULE_KEYS = [
  "administration",
  "approvals",
  "budgeting",
  "dashboard",
  "events",
  "feed",
  "memory",
  "messaging",
  "organizations",
  "reimbursements",
  "resources",
  "search",
] as const

export type ModuleKey = (typeof MODULE_KEYS)[number]

/**
 * Semantic domains. Deliberately not module ids.
 *
 * A domain is the part of the business a permission is about; a module is a
 * unit of product somebody bought. They differ often enough that conflating
 * them costs more than keeping both.
 */
export const PERMISSION_DOMAINS = [
  "org",
  "approvals",
  "finance",
  "events",
  "communications",
  "resources",
  "memory",
  "search",
  "dashboard",
  "admin",
  "identity",
  "config",
] as const

export type PermissionDomain = (typeof PERMISSION_DOMAINS)[number]

/**
 * The closed set of verbs.
 *
 * Closed because two keys meaning the same thing is how a semantic catalog
 * stops being semantic: one module ships `.delete`, the next ships `.remove`,
 * and "who can destroy things here" is no longer a question anybody can answer
 * across domains. Every verb below is asserted to be in use — a word in the
 * vocabulary that names nothing is a word nobody has agreed on.
 */
export const PERMISSION_ACTIONS = [
  "read",
  "read_sensitive",
  "create",
  "update",
  "archive",
  "propose",
  "approve",
  "decide",
  "cancel",
  "publish",
  "assign",
  "release",
  "grant",
  "revoke",
  "post",
  // Undoing a posting is its own verb, and deliberately not `update` or
  // `archive`. A posted transaction is never edited and never removed — it is
  // answered by a second, opposite posting — so the authority to do that is a
  // different question from the authority to record one in the first place, and
  // a catalog with no word for it forces the two to share a key.
  "reverse",
  "export",
  "execute",
  "configure",
  "invite",
  "suspend",
  "promote",
  "query",
] as const

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number]

/**
 * The closed set of things a permission acts on.
 *
 * Closed for the same reason the verbs are, and for one more: this is where a
 * key gets named after a person. `finance.treasurer.approve` reads like a
 * permission and is really a job title, and the day a tenant renames Treasurer
 * to Finance Lead the key is a lie nothing can rename. Adding a resource has to
 * be a visible edit to a declared list rather than a string typed at a call
 * site, because "is this the thing acted on, or the person acting?" is a
 * question somebody has to actually ask.
 *
 * The engine declares no seat titles anywhere to check against — a seat carries
 * its title as tenant data, which is precisely why a permission must not be
 * named after one. So `looksLikeARoleTitle` below is shape, not data.
 */
export const PERMISSION_RESOURCES = [
  "announcement",
  "audit",
  "budget",
  "conflict",
  "connection",
  "comment",
  "console",
  "delegation",
  "event",
  "index",
  "ledger",
  "membership",
  "message",
  "note",
  "override",
  "policy",
  "reimbursement",
  "release",
  "report",
  "request",
  "resource",
  "roster",
  "seat",
  "setting",
  "summary",
  "thread",
  "unit",
] as const

export type PermissionResource = (typeof PERMISSION_RESOURCES)[number]

/**
 * Does this segment name a person's job rather than a thing?
 *
 * Shape, deliberately, plus the two the Bible names. A word list alone goes
 * stale the moment somebody invents a title; the endings are what job titles
 * actually look like across the customers this has to work for. `principal` is
 * absent on purpose — it is this engine's word for an actor, and
 * `identity.principal.read` would be a correct key.
 */
const ROLE_TITLE_ENDINGS = [
  "_officer",
  "_manager",
  "_director",
  "_lead",
  "_chair",
  "_head",
  "_coordinator",
  "_administrator",
]

const ROLE_TITLES = [
  "treasurer",
  "president",
  "secretary",
  "advisor",
  "adviser",
  "dean",
  "provost",
  "chancellor",
  "registrar",
  "supervisor",
  "officer",
  "manager",
  "director",
  "chair",
]

export function looksLikeARoleTitle(segment: string): boolean {
  if (ROLE_TITLES.includes(segment)) return true
  if (segment.startsWith("vp_") || segment.startsWith("head_of_")) return true
  return ROLE_TITLE_ENDINGS.some((ending) => segment.endsWith(ending))
}

export interface PermissionDefinition {
  /** `domain.resource.action`. Asserted to equal its parts. */
  key: string
  domain: PermissionDomain
  /** The thing acted on, in platform vocabulary. Declared, not free text. */
  resource: PermissionResource
  action: PermissionAction
  /**
   * The module that must be enabled for this permission to mean anything, or
   * `null` for a platform-level permission that exists whatever a tenant runs.
   */
  module: ModuleKey | null
  /**
   * What it lets somebody do, in one sentence support can read out of a denial.
   *
   * Written in platform vocabulary, deliberately. A tenant-facing surface that
   * wants "Finance Lead" applies terminology at render; nothing here does, and
   * nothing here should — the moment a description is resolved against a tenant
   * the catalog stops being the same catalog everywhere.
   */
  description: string
}

/**
 * The type parameters are what make `PermissionKey` below a real union.
 *
 * Each argument is a member of a closed string union, so TypeScript infers the
 * literal rather than widening to the union, and `key` comes out as the exact
 * template literal type. Without them every entry would have `key: string` and
 * `PermissionKey` would be `string` wearing a name — which is what a call site
 * asking for a "PermissionKey" would then be given, typo and all.
 */
const define = <
  D extends PermissionDomain,
  R extends PermissionResource,
  A extends PermissionAction,
>(
  domain: D,
  resource: R,
  action: A,
  module: ModuleKey | null,
  description: string,
) => ({
  key: `${domain}.${resource}.${action}` as `${D}.${R}.${A}`,
  domain,
  resource,
  action,
  module,
  description,
})

/**
 * The catalog.
 *
 * Covers the modules the platform ships. Relay/AI tool permissions and records
 * management are absent on purpose — see the honest limits in the ledger entry.
 */
export const PERMISSIONS = [
  // ── organization ──────────────────────────────────────────────────────────
  define("org", "unit", "read", "organizations", "See an organizational unit and its details."),
  define("org", "unit", "create", "organizations", "Create a new organizational unit."),
  define("org", "unit", "update", "organizations", "Change an organizational unit's details or place in the graph."),
  define("org", "unit", "archive", "organizations", "Archive an organizational unit, ending its active life without deleting its history."),
  define("org", "seat", "read", "organizations", "See a seat, its holder, and its history."),
  define("org", "seat", "assign", "organizations", "Place somebody in a seat."),
  define("org", "seat", "release", "organizations", "End somebody's assignment to a seat."),
  define("org", "roster", "read", "organizations", "See the full membership of an organizational unit."),
  define("org", "roster", "update", "organizations", "Add or remove people from an organizational unit's roster."),
  define("org", "delegation", "grant", "organizations", "Let somebody act with a seat holder's authority for a bounded time."),
  define("org", "delegation", "revoke", "organizations", "End a delegation before its own end date."),

  // ── approvals ─────────────────────────────────────────────────────────────
  define("approvals", "request", "create", "approvals", "Raise a request that needs a decision."),
  define("approvals", "request", "read", "approvals", "See a request and its decision trail."),
  define("approvals", "request", "decide", "approvals", "Approve or reject a request at a gate you hold."),
  define("approvals", "request", "cancel", "approvals", "Withdraw a request before it is decided."),
  define("approvals", "request", "assign", "approvals", "Route a request to a different approver."),
  define("approvals", "policy", "read", "approvals", "See the approval chain a request will follow and why."),

  // ── finance ───────────────────────────────────────────────────────────────
  // Two modules, one domain. This is the pair that makes deriving the module
  // from the key's first segment wrong.
  define("finance", "budget", "read", "budgeting", "See a budget and what has been spent against it."),
  define("finance", "budget", "propose", "budgeting", "Propose a budget or a change to one."),
  define("finance", "budget", "approve", "budgeting", "Approve a proposed budget, making it the one in force."),
  define("finance", "budget", "update", "budgeting", "Change a budget line that is already in force."),
  define("finance", "ledger", "read", "budgeting", "See the transactions behind a budget's actuals."),
  define("finance", "ledger", "post", "budgeting", "Record a transaction against a budget line."),
  // PAY-150-001. Separate from `post` because correcting the record is a larger
  // authority than adding to it: a reversal restates money the institution has
  // already recognised, and the only alternative the platform used to have was
  // deleting the row, which needed no permission of its own because it needed
  // no concept of its own.
  define("finance", "ledger", "reverse", "budgeting", "Reverse a posted transaction with an opposite entry, stating why."),
  define("finance", "ledger", "export", "budgeting", "Take a copy of ledger data out of the platform."),
  define("finance", "reimbursement", "create", "reimbursements", "File a claim to be reimbursed."),
  define("finance", "reimbursement", "read", "reimbursements", "See a reimbursement claim and its supporting documents."),
  define("finance", "reimbursement", "approve", "reimbursements", "Approve a reimbursement claim for payment."),
  define("finance", "report", "read", "budgeting", "See financial reporting across units."),
  define("finance", "report", "export", "budgeting", "Take a copy of financial reporting out of the platform."),

  // ── events ────────────────────────────────────────────────────────────────
  define("events", "event", "read", "events", "See an event and its details."),
  define("events", "event", "create", "events", "Propose an event for approval."),
  define("events", "event", "update", "events", "Change an event's details."),
  define("events", "event", "publish", "events", "Put an event on the shared calendar."),
  define("events", "event", "cancel", "events", "Cancel a published event."),
  define("events", "conflict", "read", "events", "See scheduling and venue conflicts an event would cause."),

  // ── communications ────────────────────────────────────────────────────────
  define("communications", "message", "read", "messaging", "Read messages in a conversation."),
  define("communications", "message", "create", "messaging", "Post a message to a conversation."),
  define("communications", "thread", "create", "messaging", "Start a new conversation."),
  define("communications", "comment", "create", "feed", "Comment on something in the feed."),
  define("communications", "announcement", "create", "feed", "Draft an announcement."),
  define("communications", "announcement", "publish", "feed", "Publish an announcement to a unit's feed."),

  // ── resources ─────────────────────────────────────────────────────────────
  define("resources", "resource", "read", "resources", "See published guidance, forms and links."),
  define("resources", "resource", "create", "resources", "Publish guidance, a form or a link."),
  define("resources", "resource", "update", "resources", "Change published guidance."),
  define("resources", "resource", "archive", "resources", "Retire guidance so it stops being offered."),

  // ── memory ────────────────────────────────────────────────────────────────
  define("memory", "note", "read", "memory", "Read what previous holders of a seat recorded."),
  define("memory", "note", "create", "memory", "Record something for whoever holds this seat next."),
  define("memory", "note", "read_sensitive", "memory", "Read memory a previous holder marked restricted."),

  // ── search and dashboard ──────────────────────────────────────────────────
  define("search", "index", "query", "search", "Search across everything you can already see."),
  define("dashboard", "summary", "read", "dashboard", "See the dashboard's roll-up of your work."),

  // ── administration ────────────────────────────────────────────────────────
  define("admin", "console", "read", "administration", "Open the administration console."),
  define("admin", "override", "execute", "administration", "Act outside the normal gates, with the reason recorded."),
  define("admin", "audit", "read", null, "Read the audit trail. Platform-level: an audit trail nobody can read is not a control."),

  // ── identity, platform-level ──────────────────────────────────────────────
  define("identity", "membership", "read", null, "See who belongs to this system."),
  define("identity", "membership", "invite", null, "Invite somebody into this system."),
  define("identity", "membership", "suspend", null, "Suspend a membership, removing every capability it carried."),
  define("identity", "connection", "read", null, "See how this system federates identity."),
  define("identity", "connection", "configure", null, "Change how this system federates identity."),

  // ── configuration, platform-level ─────────────────────────────────────────
  define("config", "setting", "read", null, "See a governed configuration value and where it came from."),
  define("config", "setting", "update", null, "Change a governed configuration value at a layer you may write."),
  define("config", "release", "promote", null, "Promote a configuration release to an environment."),
] as const

/**
 * Every key the catalog declares, as a union of the literals themselves.
 *
 * PAY-150-001, and the reason it is not `string`: the money write path takes
 * one of these instead of the free-text `action` it used to take, so a call
 * site that asks for `finance.ledger.reveerse` fails to compile rather than
 * reaching `decide()`, being answered UNKNOWN_PERMISSION, and refusing
 * everybody — a typo that fails closed is still an outage.
 */
export type PermissionKey = (typeof PERMISSIONS)[number]["key"]

const BY_KEY: ReadonlyMap<string, PermissionDefinition> = new Map(
  PERMISSIONS.map((p) => [p.key, p]),
)

/** The definition, or `null` — never a guess. */
export function lookupPermission(key: string): PermissionDefinition | null {
  return BY_KEY.get(key) ?? null
}

export function isPermissionKey(key: string): key is PermissionKey {
  return BY_KEY.has(key)
}

/** Every key, sorted, so callers that render them are deterministic. */
export function permissionKeys(): readonly string[] {
  return [...BY_KEY.keys()].sort()
}

/** Every permission gated on a module, for "what does turning this off cost". */
export function permissionsForModule(module: ModuleKey): readonly PermissionDefinition[] {
  return PERMISSIONS.filter((p) => p.module === module)
}

const SEGMENT = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/

/**
 * Everything wrong with a catalog, as sentences.
 *
 * Returns problems rather than throwing on the first: a catalog with four
 * mistakes should report four, or fixing it is four rounds of the same edit.
 */
export function validatePermissionCatalog(
  entries: readonly PermissionDefinition[] = PERMISSIONS,
): readonly string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  const domains = new Set<string>(PERMISSION_DOMAINS)
  const actions = new Set<string>(PERMISSION_ACTIONS)
  const modules = new Set<string>(MODULE_KEYS)
  const resources = new Set<string>(PERMISSION_RESOURCES)
  const usedActions = new Set<string>()
  const usedResources = new Set<string>()

  for (const entry of entries) {
    const where = `"${entry.key}"`

    if (entry.key !== `${entry.domain}.${entry.resource}.${entry.action}`) {
      problems.push(
        `${where} does not equal its own parts (${entry.domain}.${entry.resource}.${entry.action}). ` +
          `A key edited by hand has stopped meaning what its fields say.`,
      )
    }
    if (seen.has(entry.key)) {
      problems.push(`${where} is declared twice. Two entries for one key means one of them is unreachable.`)
    }
    seen.add(entry.key)

    if (!domains.has(entry.domain)) {
      problems.push(`${where} is in domain "${entry.domain}", which is not a declared domain.`)
    }
    if (!actions.has(entry.action)) {
      problems.push(`${where} uses action "${entry.action}", which is not in the closed verb set.`)
    }
    usedActions.add(entry.action)

    if (!resources.has(entry.resource)) {
      problems.push(
        `${where} acts on "${entry.resource}", which is not a declared resource. Adding one is a ` +
          `visible edit to the vocabulary, so that "is this the thing acted on, or the person ` +
          `acting?" gets asked.`,
      )
    }
    usedResources.add(entry.resource)
    if (looksLikeARoleTitle(entry.resource)) {
      problems.push(
        `${where} is named after a job title. Tenant labels rename Treasurer to Finance Lead; a ` +
          `key built from one is a key that has to be renamed, which is the one thing a stable ` +
          `semantic key is defined by not needing.`,
      )
    }
    if (!SEGMENT.test(entry.resource)) {
      problems.push(
        `${where} has resource "${entry.resource}", which is not lower snake_case. Segments have to ` +
          `sort and compare the same way everywhere or the catalog is not one vocabulary.`,
      )
    }
    if (entry.module !== null && !modules.has(entry.module)) {
      problems.push(`${where} is gated on module "${entry.module}", which the platform does not ship.`)
    }
    if (entry.description.trim().length < 20 || !entry.description.trim().endsWith(".")) {
      problems.push(
        `${where} has no usable description. It is read out in a denial, so "budget read" is not one.`,
      )
    }
  }

  for (const resource of PERMISSION_RESOURCES) {
    if (!usedResources.has(resource)) {
      problems.push(
        `Resource "${resource}" is declared and nothing acts on it. A vocabulary that grows and ` +
          `never shrinks stops describing the platform and starts describing its history.`,
      )
    }
  }

  for (const action of PERMISSION_ACTIONS) {
    if (!usedActions.has(action)) {
      problems.push(
        `Action "${action}" is in the vocabulary and names nothing. An unused verb is one nobody agreed ` +
          `on; either a permission needs it or it does not belong in the set.`,
      )
    }
  }

  return problems
}
