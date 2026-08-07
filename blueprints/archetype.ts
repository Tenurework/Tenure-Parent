/**
 * The axes a tenant system is composed along, and the compiler that turns a
 * selection on them into a system.
 *
 * ## Why this is not a nine-field type
 *
 * The pack-factory bible (§7) names nine axes: scale, organization/legal,
 * operating model, system-of-record, deployment, geography, functional,
 * industry and provider. Declaring all nine today would produce nine labels,
 * three of which nothing reads and six of which nothing *could* read, because
 * the engine has no deployment profile, no jurisdiction pack, no provider
 * qualification and no industry pack to route them into. A label that changes
 * nothing is worse than an absent field: it makes a system look composed when
 * it is still stamped.
 *
 * So this file declares exactly the axes that are an INPUT TO RESOLUTION, and
 * says plainly what each one changes:
 *
 *   organization    compiles the vocabulary for the unit a system is made of,
 *                   as an `archetype` configuration layer (see CONFIG_SCOPES).
 *   operatingModel  gates modules that only make sense under some models —
 *                   `resolveModules` refuses the rest with `wrong-operating-model`.
 *   functional      compiles the module set itself. This is the axis that
 *                   replaced `SystemBlueprint.modules`, which used to be a
 *                   frozen exhaustive list per blueprint.
 *
 * The six absent axes and what each would have to gate before it is declared
 * here, so that adding one is a decision rather than an omission:
 *
 *   scale             a capacity or default-supplying consumer. The bible is
 *                     explicit that scale supplies defaults and questions and
 *                     "never hard caps", so it may not gate a module; there is
 *                     no defaults surface for it to write yet.
 *   systemOfRecord    a coexistence profile — which system owns which record.
 *   deployment        a DeploymentProfile object; placement today is decided by
 *                     `placementFor` against the cell registry, not by an axis.
 *   geography         a JurisdictionPack; `platform.localization.*` is set per
 *                     blueprint and tenant, and a jurisdiction that only
 *                     restated it would be a fourth copy of the same fact.
 *   industry          an IndustryPack. `LayerKind.industryPack` exists in
 *                     packages/configuration and nothing produces one.
 *   provider          a ProviderQualification registry.
 *
 * ## Cardinality
 *
 * `organization` and `operatingModel` name one value; `functional` names a set.
 * That is not a modelling convenience — a system is one kind of organization
 * operating one way, and runs several functional suites at once.
 */

export const ARCHETYPE_AXIS_IDS = ["organization", "operatingModel", "functional"] as const
export type ArchetypeAxisId = (typeof ARCHETYPE_AXIS_IDS)[number]

/**
 * Organization/legal archetypes (bible §7.2), narrowed to the ones this engine
 * can actually build.
 *
 * The ids are the `OrgTopology` ids the blueprints declare, deliberately: the
 * archetype IS the structural shape, and two names for one shape is how a
 * "university" archetype ends up bound to a corporate topology with nothing to
 * catch it. `blueprintsDeclareTheirOwnTopology` in modules.test.ts holds them
 * equal.
 */
export const ORGANIZATION_ARCHETYPES = [
  "university-student-organizations",
  "nonprofit-program-operations",
  "corporate-divisions",
] as const
export type OrganizationArchetype = (typeof ORGANIZATION_ARCHETYPES)[number]

/** Operating models — bible §7.3, first family. */
export const OPERATING_MODELS = [
  "centralized",
  "decentralized",
  "federated",
  "matrix",
  "shared-services",
] as const
export type OperatingModel = (typeof OPERATING_MODELS)[number]

/**
 * Functional suites — bible §8, over the modules that exist.
 *
 * A suite is a group of modules bought and run together, not a rename of one
 * module: `finance` and `expenses` are separate because a system can budget
 * without reimbursing, and three blueprints on disk already differ on exactly
 * that line.
 */
export const FUNCTIONAL_SUITES = [
  "community",
  "operations",
  "knowledge",
  "library",
  "assistedSearch",
  "finance",
  "expenses",
  "administration",
] as const
export type FunctionalSuite = (typeof FUNCTIONAL_SUITES)[number]

/**
 * Modules every system runs whatever it selects.
 *
 * `dashboard` because a system with no front door is not a system, and
 * `organizations` because every other module hangs its records off one — it is
 * the dependency the whole catalog declares.
 */
export const ALWAYS_ON_MODULES: readonly string[] = ["dashboard", "organizations"]

const SUITE_MODULES: Readonly<Record<FunctionalSuite, readonly string[]>> = {
  community: ["feed", "messaging"],
  operations: ["approvals", "events"],
  knowledge: ["memory"],
  library: ["resources"],
  assistedSearch: ["search"],
  finance: ["budgeting"],
  expenses: ["reimbursements"],
  administration: ["administration"],
}

/**
 * The entitlement a suite needs, where it needs one.
 *
 * Required, not granted. A selection cannot buy itself an entitlement — that
 * comes from the contracted plan — so this is what the composition ASKS FOR,
 * and `composeTenant` refuses a plan that does not cover it.
 */
const SUITE_ENTITLEMENT: Readonly<Partial<Record<FunctionalSuite, string>>> = {
  finance: "finance",
  expenses: "finance",
}

const ORGANIZATION_VOCABULARY: Readonly<
  Record<OrganizationArchetype, { singular: string; plural: string }>
> = {
  "university-student-organizations": { singular: "club", plural: "clubs" },
  "nonprofit-program-operations": { singular: "program", plural: "programs" },
  "corporate-divisions": { singular: "department", plural: "departments" },
}

/**
 * Configuration keys the compiler writes.
 *
 * Exported because the `archetype` scope sits ABOVE `blueprint` in
 * `CONFIG_SCOPES`: a blueprint that also set one of these would be setting a
 * value the archetype layer silently overrides. `modules.test.ts` asserts no
 * blueprint does, so "compiled by an axis, or set by the blueprint, never both"
 * is a test rather than a convention.
 */
export const ARCHETYPE_COMPILED_KEYS: readonly string[] = [
  "platform.terminology.organizationSingular",
  "platform.terminology.organizationPlural",
]

export interface ArchetypeAxisValue {
  id: string
  label: string
  description: string
}

export interface ArchetypeAxis {
  id: ArchetypeAxisId
  label: string
  /** One value, or a set of them. */
  cardinality: "one" | "many"
  /** What selecting a value on this axis actually changes. Named, not prose. */
  effect: string
  values: readonly ArchetypeAxisValue[]
}

/**
 * The closed table. Every axis, every value it may take.
 *
 * Built from the same constants the compiler reads, so the table an operator is
 * shown and the values the compiler accepts cannot drift.
 */
export const ARCHETYPE_AXES: readonly ArchetypeAxis[] = [
  {
    id: "organization",
    label: "Organization archetype",
    cardinality: "one",
    effect:
      "Compiles the vocabulary for one organizational unit into the `archetype` configuration layer.",
    values: [
      {
        id: "university-student-organizations",
        label: "University student organizations",
        description: "Clubs run by student executive boards under a staff office.",
      },
      {
        id: "nonprofit-program-operations",
        label: "Nonprofit program operations",
        description: "Programs run by steering committees under a program office.",
      },
      {
        id: "corporate-divisions",
        label: "Corporate divisions",
        description: "Divisions, departments and teams inside a company.",
      },
    ],
  },
  {
    id: "operatingModel",
    label: "Operating model",
    cardinality: "one",
    effect:
      "Gates modules that presume a particular operating model; `resolveModules` refuses the rest with `wrong-operating-model`.",
    values: [
      {
        id: "centralized",
        label: "Centralized",
        description: "One centre owns policy, ledger and approval.",
      },
      {
        id: "decentralized",
        label: "Decentralized",
        description: "Each unit keeps its own books and decides for itself; there is no consolidating centre.",
      },
      {
        id: "federated",
        label: "Federated",
        description: "Units are autonomous within a centre that consolidates and sets standards.",
      },
      {
        id: "matrix",
        label: "Matrix",
        description: "Units report along two lines at once — functional and divisional.",
      },
      {
        id: "shared-services",
        label: "Shared services",
        description: "A shared centre executes back-office work on behalf of every unit.",
      },
    ],
  },
  {
    id: "functional",
    label: "Functional suites",
    cardinality: "many",
    effect: "Compiles the module set the system runs.",
    values: [
      { id: "community", label: "Community", description: "Announcements and messaging." },
      { id: "operations", label: "Operations", description: "Requests, approvals and scheduling." },
      { id: "knowledge", label: "Institutional memory", description: "Knowledge that outlives officeholders." },
      { id: "library", label: "Published library", description: "The staff office's forms, guides and policies." },
      { id: "assistedSearch", label: "Assisted search", description: "Search and drafting across what the principal can see." },
      { id: "finance", label: "Budgeting", description: "Budgets, actuals and the portfolio roll-up. Needs the finance entitlement." },
      { id: "expenses", label: "Reimbursements", description: "Matched claims that post to the ledger. Needs the finance entitlement." },
      { id: "administration", label: "Administration", description: "The staff office's console and audit trail." },
    ],
  },
]

/** Axis id → the value ids it accepts. What a validator outside this package needs. */
export const ARCHETYPE_AXIS_VALUES: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(ARCHETYPE_AXES.map((axis) => [axis.id, axis.values.map((v) => v.id)])),
)

/**
 * A point on every axis.
 *
 * Every field required. A selection missing an axis is not "the default" — the
 * default belongs to the blueprint, and `mergeArchetype` is how it is applied.
 */
export interface ArchetypeSelection {
  organization: OrganizationArchetype
  operatingModel: OperatingModel
  functional: readonly FunctionalSuite[]
}

/** What a tenant may change about its blueprint's selection. Any subset of axes. */
export type ArchetypeOverride = Partial<ArchetypeSelection>

export class ArchetypeError extends Error {
  readonly problems: readonly string[]
  constructor(problems: readonly string[]) {
    super(`Invalid archetype selection:\n  ${problems.join("\n  ")}`)
    this.name = "ArchetypeError"
    this.problems = problems
  }
}

/**
 * Everything wrong with a selection, in the caller's words.
 *
 * Takes `unknown` on purpose. A selection is typed where it is written in this
 * repository and is a bag of strings the moment it arrives from a form, a
 * DynamoDB item or a manifest — which is exactly where an unchecked axis value
 * would compile to a system nobody asked for.
 */
export function archetypeProblems(selection: unknown): string[] {
  const problems: string[] = []
  if (typeof selection !== "object" || selection === null || Array.isArray(selection)) {
    return [`An archetype selection is an object with one value per axis; got ${typeof selection}.`]
  }
  const s = selection as Record<string, unknown>

  for (const axis of ARCHETYPE_AXES) {
    const value = s[axis.id]
    const permitted = ARCHETYPE_AXIS_VALUES[axis.id]

    if (axis.cardinality === "one") {
      if (typeof value !== "string") {
        problems.push(`Axis "${axis.id}" needs one of ${permitted.join(", ")}; got ${JSON.stringify(value)}.`)
      } else if (!permitted.includes(value)) {
        problems.push(`Axis "${axis.id}" does not accept "${value}". Permitted: ${permitted.join(", ")}.`)
      }
      continue
    }

    if (!Array.isArray(value)) {
      problems.push(`Axis "${axis.id}" needs a list of ${permitted.join(", ")}; got ${JSON.stringify(value)}.`)
      continue
    }
    if (value.length === 0) {
      problems.push(
        `Axis "${axis.id}" is empty. A system with no functional suite runs only its front door, ` +
          `which is a system nobody can use — say so deliberately rather than by omission.`,
      )
    }
    for (const entry of value) {
      if (typeof entry !== "string" || !permitted.includes(entry)) {
        problems.push(`Axis "${axis.id}" does not accept ${JSON.stringify(entry)}. Permitted: ${permitted.join(", ")}.`)
      }
    }
  }

  for (const key of Object.keys(s)) {
    if (!(ARCHETYPE_AXIS_IDS as readonly string[]).includes(key)) {
      problems.push(
        `"${key}" is not an archetype axis. Axes are ${ARCHETYPE_AXIS_IDS.join(", ")}; an unknown ` +
          `one is silently ignored by a compiler that does not check, which is how a system ends ` +
          `up composed along an axis nobody implemented.`,
      )
    }
  }

  return problems
}

export interface CompiledArchetype {
  /** The module set this composition runs, before dependency and entitlement resolution. */
  modules: readonly string[]
  /** Entitlements the composition REQUIRES. Not a grant — the plan grants. */
  entitlements: readonly string[]
  /** Configuration this composition sets, applied at the `archetype` scope. */
  values: Readonly<Record<string, unknown>>
}

/**
 * Turn a selection into a system.
 *
 * This is the whole point of an archetype: what `resolveModules` receives and
 * what a release pins are compiled from the axes, not read from a list frozen
 * into a blueprint. Two tenants on the same blueprint that differ on one axis
 * get genuinely different systems, and that is a property a test can fail.
 *
 * Throws on an invalid selection rather than compiling what it can. A system
 * built from an axis value nobody implemented is the failure this whole file
 * exists to prevent.
 */
export function compileArchetype(selection: ArchetypeSelection): CompiledArchetype {
  const problems = archetypeProblems(selection)
  if (problems.length > 0) throw new ArchetypeError(problems)

  const modules = new Set<string>(ALWAYS_ON_MODULES)
  const entitlements = new Set<string>()
  for (const suite of selection.functional) {
    for (const key of SUITE_MODULES[suite]) modules.add(key)
    const entitlement = SUITE_ENTITLEMENT[suite]
    if (entitlement) entitlements.add(entitlement)
  }

  const vocabulary = ORGANIZATION_VOCABULARY[selection.organization]

  return {
    // Sorted so a compiled set is stable regardless of the order the suites
    // were selected in — a release checksum must not change because an operator
    // ticked the boxes in a different order.
    modules: [...modules].sort(),
    entitlements: [...entitlements].sort(),
    values: Object.freeze({
      "platform.terminology.organizationSingular": vocabulary.singular,
      "platform.terminology.organizationPlural": vocabulary.plural,
    }),
  }
}

/**
 * The blueprint's selection with a tenant's overrides applied.
 *
 * This is what makes a blueprint an editable preset rather than a locked type:
 * a binding may move one axis and inherits every other from the blueprint it
 * was composed from.
 *
 * Written axis by axis rather than as a spread, so that adding a fourth axis is
 * a compile error here instead of an axis that silently never merges.
 */
export function mergeArchetype(
  base: ArchetypeSelection,
  override?: ArchetypeOverride,
): ArchetypeSelection {
  if (!override) return base
  return {
    organization: override.organization ?? base.organization,
    operatingModel: override.operatingModel ?? base.operatingModel,
    functional: override.functional ?? base.functional,
  }
}
