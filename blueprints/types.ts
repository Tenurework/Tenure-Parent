/**
 * The shape of a Tenure-authored system definition, and of one tenant's binding
 * to it.
 *
 * Kept deliberately small. Every field here is one the configuration engine can
 * already resolve; the module selection, roles, policies, workflows, forms and
 * navigation that the platform architecture puts in a blueprint arrive as their
 * engines do, so that a blueprint never declares something nothing reads.
 */

import type { CoexistenceDeclaration } from "@tenure/module-runtime"
import type { OrgTopology } from "@tenure/organization-model"

import type { ArchetypeOverride, ArchetypeSelection } from "./archetype"

export interface SystemBlueprint {
  id: string
  /** Semantic version. A published blueprint is immutable; a change is a new version. */
  version: string
  name: string
  description: string
  /**
   * Configuration set at the `blueprint` scope. Keys must be defined.
   *
   * A key that `compileArchetype` writes must NOT appear here: the `archetype`
   * scope sits above `blueprint`, so the blueprint's value would be silently
   * overridden. `modules.test.ts` fails on one that does.
   */
  values: Readonly<Record<string, unknown>>
  /**
   * The shape this kind of system may take: node types and what may contain what.
   *
   * This is what makes two blueprints *structurally* different rather than
   * differently worded. Terminology alone is a weak claim — a system that calls
   * clubs "programs" is still a system with clubs. A different topology is a
   * different organization.
   */
  topology: OrgTopology

  /**
   * Where this blueprint sits on each archetype axis.
   *
   * This replaced an exhaustive `modules` list. The distinction is the whole
   * point of an archetype: a frozen list makes a blueprint a locked tenant
   * type, whereas a selection is a DEFAULT that a binding may move one axis of
   * (`TenantBinding.archetype`), with the compiled result — not this object —
   * being what `resolveModules` sees and what a release pins.
   *
   * The module set follows from `axes.functional`; ask for it with
   * `compileArchetype(blueprint.axes).modules` rather than restating it.
   */
  axes: ArchetypeSelection
}

/**
 * PACK-020-002 — one tenant's edit to the preset its blueprint supplies.
 *
 * The preset — `compileArchetype(blueprint.axes).modules` — is a **starting
 * point**, not a locked tenant type. Before this existed, a tenant ran exactly
 * what its blueprint listed and
 * the only per-tenant lever was an entitlement, which can subtract but never
 * add: a customer on `university-student-organizations` that wanted the
 * knowledge module and nothing else could not be expressed at all, so the
 * answer would have been a fourth blueprint — and eventually a blueprint per
 * customer, which is the fork this platform exists to avoid.
 *
 * Stated as a **delta over the preset** rather than as an absolute list, and
 * that is the whole design. An absolute list looks identical whether the
 * operator chose those modules deliberately or the preset happened to contain
 * them, so nobody can later ask "what did this customer change?" — and when the
 * preset moves, an absolute list silently stops tracking it. A delta answers
 * both: the preset stays live, and the divergence is the record.
 *
 * An edit is NOT an escape hatch around entitlement. `add` puts a module into
 * the requested set; `resolveModules` still refuses it if the tenant holds no
 * entitlement for it, with that reason. Nothing here can grant capability.
 */
export interface ModuleEdits {
  /** Modules this tenant runs that its blueprint does not list. */
  add: readonly string[]
  /** Modules the blueprint lists that this tenant does not run. */
  remove: readonly string[]
}

/** A binding whose edit cannot be applied to its preset at all. */
export class ModuleEditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ModuleEditError"
  }
}

/**
 * The modules a tenant asks for: its blueprint's preset, edited.
 *
 * Throws rather than repairing, for the two cases where the edit is not a
 * choice but a mistake:
 *
 *   * a key in both `add` and `remove` — the binding does not say what it wants;
 *   * a `remove` naming something the preset never listed — a stale removal that
 *     reads as deliberate and does nothing, which is exactly how a preset change
 *     goes unnoticed.
 *
 * Neither is recoverable by guessing, and both are compile-time data in
 * `blueprints/index.ts`, so failing is deterministic and a test catches it. What
 * is NOT thrown for is a removal that breaks another module's dependency: that
 * one is reported through `resolveModules` as the existing `missing-dependency`
 * problem, beside every other reason a module did not start, rather than as an
 * exception that stops the tenant loading.
 */
export function applyModuleEdits(
  preset: readonly string[],
  edits: ModuleEdits | undefined,
): readonly string[] {
  if (!edits) return preset

  const contradictory = edits.add.filter((key) => edits.remove.includes(key))
  if (contradictory.length > 0) {
    throw new ModuleEditError(
      `Module edit both adds and removes ${contradictory.map((k) => `"${k}"`).join(", ")}. ` +
        `A binding that says both does not say either.`,
    )
  }

  const stale = edits.remove.filter((key) => !preset.includes(key))
  if (stale.length > 0) {
    throw new ModuleEditError(
      `Module edit removes ${stale.map((k) => `"${k}"`).join(", ")}, which the preset does not ` +
        `list. A removal that removes nothing reads as a deliberate opt-out and is not one.`,
    )
  }

  const removed = new Set(edits.remove)
  const kept = preset.filter((key) => !removed.has(key))
  // An `add` that is already in the preset is a no-op rather than a duplicate:
  // the operator asked for something they already had.
  return [...kept, ...edits.add.filter((key) => !kept.includes(key))]
}

/**
 * The edit that turns a preset into this selection.
 *
 * The inverse of `applyModuleEdits`, and the function the Studio's composer uses
 * so an operator's checkbox state is recorded as what they *changed* rather than
 * as an absolute list that no longer names the preset it came from.
 */
export function moduleEditsBetween(
  preset: readonly string[],
  selected: readonly string[],
): ModuleEdits {
  const chosen = new Set(selected)
  const from = new Set(preset)
  return {
    add: [...new Set(selected)].filter((key) => !from.has(key)),
    remove: [...new Set(preset)].filter((key) => !chosen.has(key)),
  }
}

export interface TenantBinding {
  /** Institution slug, as it exists in the database today. */
  slug: string
  blueprintId: string
  /** Human name, for operator-facing surfaces. */
  displayName: string
  /**
   * What this tenant has bought.
   *
   * Separate from the blueprint's module list on purpose: the blueprint says
   * what this *kind* of system is made of, the entitlement says what this
   * customer is entitled to run. A module the blueprint lists but the tenant is
   * not entitled to is refused with that reason, not silently dropped.
   */
  entitlements?: readonly string[]
  /**
   * The tier this customer is on, per module — `{ budgeting: "ledger" }`.
   *
   * Entitlement is binary: the tenant may run budgeting or may not. A tier is
   * ordered, and it is what a role template's `minTier` is ranked against, so
   * "may run budgeting" and "may put a budget into force" stop being the same
   * question. The ordering itself is the module's, declared in its manifest;
   * this only says where in it the tenant sits.
   *
   * Absent for a module is deliberately NOT the lowest tier. `decide()` denies
   * TIER_TOO_LOW when a role demands a tier and the tenant has none recorded,
   * which is the fail-closed direction — defaulting would grant the bottom tier
   * to every tenant nobody had recorded a sale for.
   */
  currentTier?: Readonly<Record<string, string>>
  /**
   * This tenant's move along one or more archetype axes. Absent means none.
   *
   * The editable-preset property, at the axis level: a binding that overrides
   * `functional` keeps its blueprint's `organization` and `operatingModel`, so
   * a tenant is a *point in the composition space* rather than an instance of a
   * locked type. `mergeArchetype` applies it, and the compiled result — not the
   * blueprint's selection — is what `modulesFor` resolves and what a release
   * pins (PACK-020-003).
   *
   * Distinct from `moduleEdits` below and deliberately so: an axis says WHAT
   * KIND of system this is and everything follows from it, whereas an edit is a
   * one-off divergence from what the axes compiled to. Collapsing the two would
   * make "this tenant runs a different suite" and "this tenant turned one module
   * off" the same record, and only one of them survives a preset change.
   */
  archetype?: ArchetypeOverride
  /**
   * This tenant's divergence from its blueprint's preset. Absent means none.
   *
   * Applied by `modulesFor` before resolution, so an edit is subject to every
   * rule the preset is: entitlement, lifecycle, dependency, incompatibility.
   */
  moduleEdits?: ModuleEdits
  /**
   * PACK-020-004 — which system is authoritative for which business domain.
   *
   * Customer on-premise estates and other clouds are **external systems**, not
   * Tenure deployment targets (bible §2), and coexistence with them is modelled
   * as a profile plus one authoritative writer per domain. Absent means every
   * domain is Tenure's, which is what all three shipped bindings are.
   *
   * Read by `modulesFor`, which passes it to `resolveModules`: a module that
   * writes into a domain an external system owns is refused with
   * `system-of-record-external` rather than enabled into a dual write. That is
   * the difference between a profile and a label.
   *
   * This is the declaration the `systemOfRecord` axis in `./archetype.ts` says
   * it is waiting for. It sits on the binding rather than on an axis because a
   * coexistence arrangement is a fact about one customer's estate — two tenants
   * on the same archetype routinely differ — whereas an axis compiles to the
   * same system for everyone who selects it.
   */
  coexistence?: CoexistenceDeclaration
  /** Configuration set at the `tenant` scope — this customer's own words. */
  values: Readonly<Record<string, unknown>>
}
