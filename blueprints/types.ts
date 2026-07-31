/**
 * The shape of a Tenure-authored system definition, and of one tenant's binding
 * to it.
 *
 * Kept deliberately small. Every field here is one the configuration engine can
 * already resolve; the module selection, roles, policies, workflows, forms and
 * navigation that the platform architecture puts in a blueprint arrive as their
 * engines do, so that a blueprint never declares something nothing reads.
 */

import type { OrgTopology } from "@tenure/organization-model"

export interface SystemBlueprint {
  id: string
  /** Semantic version. A published blueprint is immutable; a change is a new version. */
  version: string
  name: string
  description: string
  /** Configuration set at the `blueprint` scope. Keys must be defined. */
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
   * Modules a system built from this blueprint runs.
   *
   * Listed exhaustively rather than as a delta from some default: reading a
   * blueprint should tell you what the system has, not what it has *extra*.
   * Dependencies are not implicit either — resolveModules refuses a set with a
   * missing dependency rather than quietly adding it.
   */
  modules: readonly string[]
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
  /** Configuration set at the `tenant` scope — this customer's own words. */
  values: Readonly<Record<string, unknown>>
}
