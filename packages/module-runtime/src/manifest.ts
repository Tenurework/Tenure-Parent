import { lookupPermission } from "@tenure/authorization"
import {
  ContractViolation,
  isEventType,
  parseToolRegistration,
  type ToolRegistration,
} from "@tenure/contracts"

/**
 * What a module declares about itself.
 *
 * A module is a unit of product capability that a system can have or not have —
 * events, budgeting, reimbursements, organizational memory. The point of a
 * manifest is that enabling one is a *decision recorded in a release*, not a
 * feature flag someone flipped, and that the consequences of enabling it are
 * knowable before it happens.
 *
 * Deliberately smaller than the architecture's twelve declaration arrays. Each
 * field here is one something already reads. A manifest that declares workflow
 * actions, form components and integration hooks before any of those engines
 * exist is a manifest whose declarations cannot be wrong, because nothing checks
 * them — and that is worse than not declaring them.
 */

/**
 * Where a module is in its life.
 *
 * `certified-limited` is the state the twelve shipped modules are actually in,
 * and it exists because the alternative was a lie. Bible §6 says a pack missing
 * an applicable completeness dimension "remains SPECIFIED, DEVELOPING or
 * CERTIFIED_LIMITED", and every module here is missing at least one — no
 * reconciliation behind the ledger, no Relay evaluation boundary, no runbook.
 * The catalog previously declared `available` twelve times out of twelve, which
 * is precisely the false Available claim PACK-000-004 forbids.
 *
 * So `available` now means something a validator checks: seventeen dimensions
 * stated, none of them a gap. `certified-limited` means it runs, and the gaps
 * are declared and carried to whoever turns it on.
 */
export const MODULE_LIFECYCLE = [
  "development",
  "validated",
  "approved",
  "certified-limited",
  "available",
  "deprecated",
  "retired",
] as const

export type ModuleLifecycle = (typeof MODULE_LIFECYCLE)[number]

/** Lifecycle states in which a module may be turned on. */
export const ENABLEABLE: ReadonlySet<ModuleLifecycle> = new Set<ModuleLifecycle>([
  "approved",
  "certified-limited",
  "available",
  // Deprecated is deliberately included: a tenant that already has it keeps
  // working. Deprecation is a signal to stop adopting, not an outage — but it
  // is no longer silent either; `resolveModules` returns an advisory for it.
  "deprecated",
])

/**
 * Lifecycles that assert something about completeness, and are therefore held
 * to the seventeen-dimension contract below.
 *
 * `development` and `validated` claim nothing yet; `deprecated` and `retired`
 * are about the end of a life rather than the quality of one.
 */
export const CLAIMS_COMPLETENESS: ReadonlySet<ModuleLifecycle> = new Set<ModuleLifecycle>([
  "approved",
  "certified-limited",
  "available",
])

/**
 * Bible §6 — the seventeen dimensions a capability is "engineered" against.
 *
 * Stated as ids rather than numbers so a manifest reads as a claim rather than
 * a row of ticks, and so inserting a dimension cannot silently renumber every
 * existing assessment.
 */
export const COMPLETENESS_DIMENSIONS = [
  "authority-and-domain-boundary",
  "business-outcomes-and-personas",
  "canonical-objects-and-invariants",
  "state-machines-and-effective-dating",
  "commands-events-and-idempotency",
  "authorization-privacy-and-sod",
  "configuration-inheritance-and-terminology",
  "accounting-controls-and-reconciliation",
  "ux-routes-forms-and-accessibility",
  "external-integrations-and-failure",
  "migration-cutover-and-data-quality",
  "search-analytics-and-memory",
  "relay-boundaries-and-evaluations",
  "localization-legal-and-certification",
  "observability-slo-and-finops",
  "upgrade-rollback-and-deprecation",
  "test-and-certification-evidence",
] as const

export type CompletenessDimension = (typeof COMPLETENESS_DIMENSIONS)[number]

export interface DimensionAssessment {
  /**
   * `pass` needs evidence somebody can open. `not-applicable` is a claim too —
   * it says the dimension cannot apply to this capability, which is falsifiable.
   */
  status: "pass" | "gap" | "not-applicable"
  evidence: string
}

/**
 * A dimension this module does not satisfy, and what is missing.
 *
 * Deliberately beside the `gap` assessment rather than derived from it: the
 * assessment says what exists today, this says what does not. A reader deciding
 * whether to switch the module on needs the second sentence, and folding it into
 * the first is how "we know about that" becomes nobody's problem.
 */
export interface ModuleGap {
  dimension: CompletenessDimension
  detail: string
}

/**
 * Bible §11 — how a capability is fulfilled.
 *
 * Four of the nine, and only four, because these are the four this platform can
 * actually be in today. `PROVIDER_EMBEDDED`, `SHADOW` and the certified variants
 * describe arrangements with an outside processor that no module here has, and a
 * mode nothing can be in is a dropdown, not a contract.
 */
export const CAPABILITY_MODES = [
  "TENURE_NATIVE",
  "READ_ONLY",
  "EXPORT_ONLY",
  "UNAVAILABLE",
] as const

export type CapabilityMode = (typeof CAPABILITY_MODES)[number]

/** Why a module is suspended. Orthogonal to lifecycle — Bible §5. */
export const SUSPENSION_KINDS = ["security", "provider", "regulatory"] as const
export type SuspensionKind = (typeof SUSPENSION_KINDS)[number]

export interface ModuleSuspension {
  kind: SuspensionKind
  /** ISO date the suspension took effect. */
  since: string
  reason: string
}

export const DEPENDENCY_KINDS = ["required", "optional"] as const
export type DependencyKind = (typeof DEPENDENCY_KINDS)[number]

/**
 * One module's need of another, with a version range.
 *
 * A bare key was one-dimensional: `reimbursements` could be pinned beside
 * `budgeting@1.0.0` in a release even if it needed budgeting v2, and nothing
 * anywhere compared the two.
 *
 * `module` may name either a module key or a capability some module `provides`.
 * The second is what makes an alternative expressible: `reimbursements` needs a
 * ledger, not specifically the `budgeting` module, and the day a second ledger
 * ships it satisfies the same dependency without an edit here.
 *
 * `optional` means "if it is enabled, it must be compatible" — absence is fine,
 * an incompatible version is not. `search` reads memory cards when the memory
 * module is on (`apps/web/src/lib/search-data.ts`) and works without it.
 *
 * There is deliberately no `alternative` kind. An alternative is not a property
 * of one edge, it is a property of the capability being depended on, and that is
 * what `provides` expresses — a second kind saying the same thing would be a
 * second answer to "who may satisfy this".
 */
export interface ModuleDependency {
  module: string
  /** `>=1.0.0`, `<2.0.0`, `=1.2.3`, `1.2.3` or `*`. Compared numerically. */
  range: string
  kind: DependencyKind
}

export interface ModuleNavEntry {
  /** Stable id, namespaced by the module that owns it. */
  id: string
  label: string
  href: string
  /** Section heading it appears under. Sections are ordered by `sectionOrder`. */
  section: string
  sectionOrder: number
  /** Order within the section. */
  order: number
  /** Icon name resolved by the UI. Kept a string so this package stays render-free. */
  icon: string
  /**
   * A named UI behaviour instead of navigation, e.g. opening a panel.
   *
   * A string the UI resolves, not a handler: this package must stay renderable
   * from a server component and serializable across the boundary, so it names
   * behaviour rather than carrying it.
   */
  action?: string
  /**
   * PACK-070-001 — what firing this entry's `action` can do.
   *
   * Required beside `action` and meaningless without it: a link goes to a page
   * whose own route decides what may happen there, whereas a command entry is a
   * button in a menu that does something the moment it is pressed, and a menu
   * that cannot say which of its buttons are safe is a menu nobody can review.
   *
   * Three classes, because the review question is different for each:
   *
   *   `read`          shows something. Nothing changes.
   *   `write`         changes tenant data, and can be undone by changing it back.
   *   `irreversible`  cannot be undone from the product — a purge, an export of
   *                   data that has now left, a message that has been sent.
   *
   * Deliberately one field rather than the architecture's full page-schema,
   * data-query, saved-view and drill-through arrays. Those describe surfaces
   * nothing here renders, so declaring them would produce claims no test could
   * falsify. This one is read by `validateManifest` below — which refuses a
   * command that does not state its class — and by the Studio's fleet view,
   * where it sits beside the tenants a lifecycle change would reach.
   */
  riskClass?: "read" | "write" | "irreversible"
  /**
   * Capability a principal must hold for this entry to appear.
   *
   * Navigation is not authorization: hiding a link does not protect the route,
   * and the route must check for itself. This exists so the menu does not offer
   * people things they cannot do.
   */
  requiresCapability?: string
}

export interface ModuleManifest {
  /** Stable key, lowerCamelCase. Namespaces everything the module owns. */
  key: string
  version: string
  name: string
  description: string

  /**
   * The domain accountable for it — a key from `tools/ownership-map.mjs`, which
   * is what `docs/architecture/ownership.md` is generated from.
   *
   * Required, and checked against that map by
   * `tests/architecture/module-objects.test.mjs`. A capability nobody owns is
   * one nobody is paged for.
   */
  owner: string

  /**
   * Prisma models this module governs.
   *
   * Checked against `apps/web/prisma/schema.prisma` by
   * `tests/architecture/module-objects.test.mjs`: every name must be a real
   * model, no model may be claimed twice, and the number of unclaimed models may
   * only fall. This package must not read the schema itself — it is dependency-
   * free by design — so the join lives in that test.
   */
  objects?: readonly string[]

  lifecycle: ModuleLifecycle

  /** How the capability is fulfilled — Bible §11. Absent reads as TENURE_NATIVE. */
  mode?: CapabilityMode

  /**
   * The seventeen-dimension classification. Required for any lifecycle in
   * `CLAIMS_COMPLETENESS`; see `validateManifest`.
   */
  dimensions?: Partial<Record<CompletenessDimension, DimensionAssessment>>

  /** Dimensions this module does not satisfy, and what is missing. */
  gaps?: readonly ModuleGap[]

  /** Ordered tiers this module sells, lowest first. Position is the rank. */
  tiers?: readonly string[]

  /** Modules that must also be enabled. Not auto-added — see resolveModules. */
  dependsOn?: readonly ModuleDependency[]

  /**
   * Capabilities this module supplies, which another module's `dependsOn` may
   * name instead of naming this key.
   */
  provides?: readonly string[]

  /** Minimum engine version the running build must be at, `major.minor.patch`. */
  requiresEngine?: string

  /** Modules that must NOT be enabled alongside this one. */
  incompatibleWith?: readonly string[]

  /** Entitlement a tenant must hold. Absent means available to every tenant. */
  requiresEntitlement?: string

  /**
   * Operating models this module presumes. Absent means every model.
   *
   * An entitlement is commercial — has this customer bought it. This is
   * structural: some capability only means anything under some operating
   * models, and offering it under the others produces a surface nobody can use
   * correctly. Budgeting's portfolio roll-up is the shipped example: it
   * consolidates every organization's spend into one view, which presumes a
   * centre that consolidates. A `decentralized` system has none, so the roll-up
   * would be a page of numbers nobody owns.
   *
   * Checked BEFORE the entitlement, deliberately. "This system is not shaped for
   * that module" and "you have not bought it" are different answers, and the
   * first is the true one when both apply: selling the entitlement would not
   * make the module work.
   *
   * The value comes from the tenant's `operatingModel` archetype axis
   * (`blueprints/archetype.ts`), which is where the closed list of models lives.
   */
  requiresOperatingModel?: readonly string[]

  /** ISO date after which this module is refused. Bible §5 END_OF_SUPPORT. */
  supportEndsAt?: string

  /**
   * Orthogonal to lifecycle, and checked before everything else: a module
   * suspended for a security defect is refused whether or not the tenant is
   * entitled to it, and the refusal says which suspension it is.
   */
  suspension?: ModuleSuspension

  /** Permission keys the module introduces. Namespaced under `key`. */
  permissions?: readonly string[]

  navigation?: readonly ModuleNavEntry[]

  /**
   * Capabilities this module offers the assistant.
   *
   * A pack declares its own tools here rather than an AI surface holding a
   * hardcoded list, which is the difference between "Relay can do what the
   * enabled modules offer" and "Relay can do whatever the one route was
   * written to do". Each is a `ToolRegistration`, so `requiredPermission` is
   * not optional and a writing tool must reauthorize per call — a tool
   * registered without a permission is a tool an assistant can call on any
   * tenant's data with nothing in the way.
   *
   * Consumed by `apps/web/src/lib/relay-tools.ts`, which resolves this list for
   * a tenant and puts every entry through `decide()` before offering it.
   */
  tools?: readonly ToolRegistration[]

  /**
   * `DomainEvent.type` names this module publishes, and the ones it acts on.
   *
   * Declared so a *process* that crosses modules has somewhere to be checked.
   * A consumer with no emitter anywhere in the catalog is a module waiting for
   * an event that will never arrive, and until these existed nothing could
   * tell — the wait looks identical to a quiet system.
   */
  emits?: readonly string[]
  consumes?: readonly string[]
}

export class ModuleManifestError extends Error {
  readonly problems: readonly string[]
  constructor(problems: readonly string[]) {
    super(`Invalid module manifest:\n  ${problems.join("\n  ")}`)
    this.name = "ModuleManifestError"
    this.problems = problems
  }
}

const KEY = /^[a-z][a-zA-Z0-9]*$/
const RANGE = /^(?:\*|(?:>=|<=|>|<|=)?\d+\.\d+\.\d+)$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?$/

/** The risk classes a command entry may declare. See `ModuleNavEntry.riskClass`. */
export const RISK_CLASSES = ["read", "write", "irreversible"] as const

export type RiskClass = (typeof RISK_CLASSES)[number]

export function validateManifest(m: ModuleManifest): void {
  const problems: string[] = []
  const where = `Module "${m.key}"`

  if (!KEY.test(m.key ?? "")) {
    problems.push(`Module key ${JSON.stringify(m.key)} must be lowerCamelCase.`)
  }
  if (!m.version) problems.push(`${where} has no version.`)
  if (!m.name) problems.push(`${where} has no name.`)
  if (!(m.owner ?? "").trim()) {
    problems.push(
      `${where} names no owner. A capability nobody owns is one nobody is paged for; the value ` +
        `is a domain key from tools/ownership-map.mjs.`,
    )
  }
  if (!MODULE_LIFECYCLE.includes(m.lifecycle)) {
    problems.push(`${where} has unknown lifecycle ${JSON.stringify(m.lifecycle)}.`)
  }
  if (m.mode !== undefined && !CAPABILITY_MODES.includes(m.mode)) {
    problems.push(`${where} has unknown capability mode ${JSON.stringify(m.mode)}.`)
  }
  if (m.requiresOperatingModel !== undefined && m.requiresOperatingModel.length === 0) {
    problems.push(
      `${where} declares requiresOperatingModel: [], which no system can satisfy. Omit the field ` +
        `to mean "every operating model" — an empty list is a module nobody can ever enable, and ` +
        `it fails as a missing feature rather than as the declaration error it is.`,
    )
  }

  // ── dependencies ──────────────────────────────────────────────────────────
  const dependsOnKeys = (m.dependsOn ?? []).map((d) => d?.module)
  if (dependsOnKeys.includes(m.key)) problems.push(`${where} depends on itself.`)
  if (m.incompatibleWith?.includes(m.key)) problems.push(`${where} is incompatible with itself.`)

  for (const dep of m.dependsOn ?? []) {
    if (!dep || typeof dep.module !== "string" || !dep.module) {
      problems.push(`${where} declares a dependency naming no module.`)
      continue
    }
    if (!RANGE.test(dep.range ?? "")) {
      problems.push(
        `${where} depends on "${dep.module}" with range ${JSON.stringify(dep.range)}, which is ` +
          `not one of >=x.y.z, <=x.y.z, >x.y.z, <x.y.z, =x.y.z, x.y.z or *.`,
      )
    }
    if (!DEPENDENCY_KINDS.includes(dep.kind)) {
      problems.push(
        `${where} depends on "${dep.module}" with kind ${JSON.stringify(dep.kind)}; expected ` +
          `${DEPENDENCY_KINDS.join(" or ")}.`,
      )
    }
    if (m.incompatibleWith?.includes(dep.module)) {
      problems.push(`${where} both depends on and is incompatible with "${dep.module}".`)
    }
  }
  if (new Set(dependsOnKeys).size !== dependsOnKeys.length) {
    problems.push(`${where} declares the same dependency twice.`)
  }

  for (const capability of m.provides ?? []) {
    if (!capability.trim()) problems.push(`${where} provides an empty capability name.`)
    if (capability === m.key) {
      problems.push(
        `${where} declares that it provides its own key. A capability name colliding with a ` +
          `module key makes every dependency on it ambiguous.`,
      )
    }
  }

  if (m.requiresEngine !== undefined && !/^\d+\.\d+\.\d+$/.test(m.requiresEngine)) {
    problems.push(
      `${where} requires engine ${JSON.stringify(m.requiresEngine)}, which is not major.minor.patch.`,
    )
  }

  // ── tiers ─────────────────────────────────────────────────────────────────
  if (m.tiers !== undefined) {
    if (m.tiers.length === 0) {
      problems.push(
        `${where} declares an empty tier list. A module that is not tiered omits the field; an ` +
          `empty list makes every minTier naming it silently inert.`,
      )
    }
    if (new Set(m.tiers).size !== m.tiers.length) {
      problems.push(
        `${where} declares a duplicate tier. Rank is position, so a duplicate has two ranks.`,
      )
    }
    for (const tier of m.tiers) {
      if (!tier.trim()) problems.push(`${where} declares an empty tier name.`)
    }
  }

  // ── support window and suspension ─────────────────────────────────────────
  if (m.supportEndsAt !== undefined && !ISO_DATE.test(m.supportEndsAt)) {
    problems.push(
      `${where} has supportEndsAt ${JSON.stringify(m.supportEndsAt)}, which is not a date.`,
    )
  }
  if (m.suspension) {
    if (!SUSPENSION_KINDS.includes(m.suspension.kind)) {
      problems.push(`${where} is suspended with unknown kind ${JSON.stringify(m.suspension.kind)}.`)
    }
    if (!ISO_DATE.test(m.suspension.since ?? "")) {
      problems.push(
        `${where} is suspended since ${JSON.stringify(m.suspension.since)}, which is not a date.`,
      )
    }
    if ((m.suspension.reason ?? "").trim().length < 10) {
      problems.push(
        `${where} is suspended with no usable reason. Whoever cannot turn it on has to be told why.`,
      )
    }
  }

  // ── the seventeen-dimension completeness contract (Bible §6) ──────────────
  //
  // The availability claim is evidence-gated rather than hand-written. Before
  // this, twelve of twelve manifests said `available` and nothing checked the
  // claim against anything: a product name, a navigation item and a table
  // passed, which §6 says explicitly does not.
  //
  // Nothing is downgraded automatically. The manifest is refused, and the author
  // states the lifecycle that is true.
  const assessed = m.dimensions ?? {}
  const gapDimensions = new Set((m.gaps ?? []).map((g) => g.dimension))

  if (CLAIMS_COMPLETENESS.has(m.lifecycle)) {
    const missing = COMPLETENESS_DIMENSIONS.filter((d) => !assessed[d])
    if (missing.length > 0) {
      problems.push(
        `${where} claims lifecycle "${m.lifecycle}" without assessing ${missing.length} of the ` +
          `seventeen completeness dimensions: ${missing.join(", ")}.`,
      )
    }
  }

  for (const dimension of COMPLETENESS_DIMENSIONS) {
    const entry = assessed[dimension]
    if (!entry) continue
    if (!["pass", "gap", "not-applicable"].includes(entry.status)) {
      problems.push(`${where} assesses "${dimension}" as ${JSON.stringify(entry.status)}.`)
    }
    if ((entry.evidence ?? "").trim().length < 10) {
      problems.push(
        `${where} assesses "${dimension}" as "${entry.status}" with no evidence. An assessment ` +
          `nobody can go and check is the claim it was meant to replace.`,
      )
    }
    if (entry.status === "gap" && !gapDimensions.has(dimension)) {
      problems.push(
        `${where} assesses "${dimension}" as a gap but does not list it in \`gaps\`. The ` +
          `assessment says what exists; the gap says what is missing, and the second is the ` +
          `sentence somebody deciding whether to enable it needs.`,
      )
    }
  }

  for (const gap of m.gaps ?? []) {
    if (!COMPLETENESS_DIMENSIONS.includes(gap.dimension)) {
      problems.push(`${where} declares a gap in unknown dimension ${JSON.stringify(gap.dimension)}.`)
      continue
    }
    if ((gap.detail ?? "").trim().length < 10) {
      problems.push(`${where} declares a gap in "${gap.dimension}" without saying what is missing.`)
    }
    const entry = assessed[gap.dimension]
    if (entry && entry.status !== "gap") {
      problems.push(
        `${where} declares a gap in "${gap.dimension}" while assessing it as "${entry.status}".`,
      )
    }
  }

  if ((m.lifecycle === "available" || m.lifecycle === "approved") && (m.gaps ?? []).length > 0) {
    problems.push(
      `${where} is "${m.lifecycle}" and declares ${(m.gaps ?? []).length} gap(s). An available ` +
        `module with a declared gap is a contradiction — state "certified-limited" or ` +
        `"development" instead. Bible §6: a pack missing an applicable dimension does not pass.`,
    )
  }

  if (m.lifecycle === "certified-limited" && (m.gaps ?? []).length === 0) {
    problems.push(
      `${where} is "certified-limited" and declares no gap. Limited by what? State "available" ` +
        `if nothing is missing.`,
    )
  }

  // A module may only declare permissions the catalog declares, gated on this
  // module.
  //
  // The rule used to be that a permission had to start with `<key>.`, on the
  // assumption that a permission *is* `<module>.<action>`. The architecture
  // states that rule and then breaks it in its own finance example, and so does
  // the platform: `finance.budget.read` is the budgeting module and
  // `finance.reimbursement.approve` is the reimbursements one. Prefix-matching
  // could only be satisfied by inventing a key per module, which is how three
  // parts of this platform ended up gating the same link on three strings none
  // of which existed anywhere else.
  //
  // Checking against the catalog is strictly stronger: it catches the typo the
  // prefix rule caught, and also the permission that is spelled plausibly and
  // means nothing.
  for (const p of m.permissions ?? []) {
    const definition = lookupPermission(p)
    if (!definition) {
      problems.push(
        `${where} declares permission "${p}", which is not in the permission catalog. A module ` +
          `cannot confer a capability nothing can grant.`,
      )
    } else if (definition.module !== null && definition.module !== m.key) {
      problems.push(
        `${where} declares permission "${p}", which the catalog gates on module ` +
          `"${definition.module}". Turning "${m.key}" on would not grant it.`,
      )
    }
  }

  // Tools are held to the ToolRegistration contract itself, not to a second
  // copy of its rules. `parseToolRegistration` is the runtime gate — it is what
  // refuses a writing tool that does not reauthorize per call — and running it
  // here is what makes a manifest a place that declaration can be caught, at
  // catalog construction, rather than at the first invocation.
  const toolKeys = new Set<string>()
  for (const tool of m.tools ?? []) {
    try {
      parseToolRegistration(tool)
    } catch (err) {
      problems.push(
        `${where} declares tool "${tool?.toolKey ?? "(unnamed)"}", which does not satisfy the ` +
          `ToolRegistration contract: ${err instanceof ContractViolation ? err.message : String(err)}`,
      )
      continue
    }

    if (tool.module !== m.key) {
      problems.push(
        `${where} declares tool "${tool.toolKey}" owned by module "${tool.module}". A module ` +
          `cannot register a capability on another module's behalf — the other module would not ` +
          `know it had one, and disabling it would not remove the tool.`,
      )
    }
    if (toolKeys.has(tool.toolKey)) {
      problems.push(`${where} declares tool "${tool.toolKey}" twice.`)
    }
    toolKeys.add(tool.toolKey)

    // Same catalog check the permissions loop makes, and for the same reason:
    // a tool gated on a permission nothing can grant is a tool nobody can ever
    // use, and one gated on another module's permission is a tool this module
    // being enabled does not actually confer.
    const definition = lookupPermission(tool.requiredPermission)
    if (!definition) {
      problems.push(
        `${where} declares tool "${tool.toolKey}" requiring permission ` +
          `"${tool.requiredPermission}", which is not in the permission catalog. A tool gated on ` +
          `a capability nothing can grant is a tool that can never be offered.`,
      )
    } else if (definition.module !== null && definition.module !== m.key) {
      problems.push(
        `${where} declares tool "${tool.toolKey}" requiring permission ` +
          `"${tool.requiredPermission}", which the catalog gates on module "${definition.module}". ` +
          `Turning "${m.key}" on would not grant it.`,
      )
    }
  }

  for (const [field, names] of [
    ["emits", m.emits],
    ["consumes", m.consumes],
  ] as const) {
    const seen = new Set<string>()
    for (const name of names ?? []) {
      if (!isEventType(name)) {
        problems.push(
          `${where} declares ${field} "${name}", which is not a past-tense event type. It must be ` +
            `spelled exactly as DomainEvent.type requires, or the declaration and the event that ` +
            `arrives can disagree about which event this is.`,
        )
      }
      if (seen.has(name)) problems.push(`${where} declares ${field} "${name}" twice.`)
      seen.add(name)
    }
  }

  const navIds = new Set<string>()
  for (const nav of m.navigation ?? []) {
    if (!nav.id.startsWith(`${m.key}.`)) {
      problems.push(`${where} declares nav entry "${nav.id}", which is not namespaced under "${m.key}.".`)
    }
    if (navIds.has(nav.id)) problems.push(`${where} declares nav entry "${nav.id}" twice.`)
    navIds.add(nav.id)
    if (!nav.href.startsWith("/")) {
      problems.push(`${where} nav entry "${nav.id}" has href "${nav.href}", which is not an app path.`)
    }
    if (!nav.label) problems.push(`${where} nav entry "${nav.id}" has no label.`)

    // PACK-070-001. A command has to say what it can do before it may be
    // offered. `action` makes the entry a button that does something when it is
    // pressed rather than a link to a route that decides for itself, and a
    // module shipping one without a declared risk class is exactly the
    // unreviewed shell this rule exists to refuse.
    if (nav.action && !nav.riskClass) {
      problems.push(
        `${where} nav entry "${nav.id}" fires the command "${nav.action}" without declaring a ` +
          `riskClass. A menu entry that acts must say whether acting reads, writes or cannot be undone.`,
      )
    }
    // And the reverse: a link with a risk class is claiming a review that does
    // not apply to it, which makes the field mean less everywhere it is real.
    if (nav.riskClass && !nav.action) {
      problems.push(
        `${where} nav entry "${nav.id}" declares riskClass "${nav.riskClass}" but fires no command. ` +
          `Navigating to a route is governed by that route, not by this menu entry.`,
      )
    }
    if (nav.riskClass && !RISK_CLASSES.includes(nav.riskClass)) {
      problems.push(
        `${where} nav entry "${nav.id}" has unknown riskClass ${JSON.stringify(nav.riskClass)}.`,
      )
    }
  }

  if (problems.length > 0) throw new ModuleManifestError(problems)
}
