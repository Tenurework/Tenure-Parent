/**
 * The shape of a Tenure-authored system definition, and of one tenant's binding
 * to it.
 *
 * Kept deliberately small. Every field here is one the configuration engine can
 * already resolve; the module selection, roles, policies, workflows, forms and
 * navigation that the platform architecture puts in a blueprint arrive as their
 * engines do, so that a blueprint never declares something nothing reads.
 */

export interface SystemBlueprint {
  id: string
  /** Semantic version. A published blueprint is immutable; a change is a new version. */
  version: string
  name: string
  description: string
  /** Configuration set at the `blueprint` scope. Keys must be defined. */
  values: Readonly<Record<string, unknown>>
}

export interface TenantBinding {
  /** Institution slug, as it exists in the database today. */
  slug: string
  blueprintId: string
  /** Human name, for operator-facing surfaces. */
  displayName: string
  /** Configuration set at the `tenant` scope — this customer's own words. */
  values: Readonly<Record<string, unknown>>
}
