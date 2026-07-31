import {
  buildOrgGraph,
  type OrgGraph,
  type OrgTopology,
  type OrgUnitInput,
} from "@tenure/organization-model"

/**
 * Project the live schema onto the organization model.
 *
 * The database has `Institution` and `Organization` and nothing else: a fixed
 * two-level hierarchy with no node types, no containment rules, and no way to
 * express a school between them or a board beneath them. The organization model
 * has all of that and no table.
 *
 * This is the seam between them. It reads what exists — an institution and its
 * organizations — and produces a validated `OrgGraph` under the blueprint's
 * declared topology. Nothing is migrated and no schema changes: `Institution`
 * becomes the root unit, each `Organization` becomes a `club` beneath it.
 *
 * Why bother, when today's projection is trivially two levels deep? Because it
 * makes the topology *load-bearing before the migration*. Every consumer written
 * from here on asks the graph rather than assuming `organization.institutionId`,
 * so when `org_unit` lands under ADR-0004's programme the change is to this
 * function and to nothing above it. The alternative — write the callers against
 * the flat shape now, migrate later — is the same rewrite, deferred and larger.
 *
 * Kept free of Prisma imports so it can be tested without a database. The caller
 * supplies rows; `server.ts` is what fetches them.
 */

export interface InstitutionRow {
  id: string
  name: string
  slug: string
  createdAt: Date
}

export interface OrganizationRow {
  id: string
  name: string
  institutionId: string
  status: string
  createdAt: Date
}

export interface ProjectionOptions {
  /**
   * The unit type each `Organization` maps to.
   *
   * Read from the blueprint rather than hardcoded to `"club"`, because the
   * nonprofit topology has no such type — its second level is `portfolio`.
   */
  organizationType: string
  /** The unit type the `Institution` maps to. Must be the topology's root type. */
  institutionType: string
}

const iso = (d: Date): string => d.toISOString()

/**
 * `Organization.status` is an enum whose ARCHIVED member means the club is no
 * longer running. The organization model expresses that as `archivedAt`, and
 * the schema has no column recording *when* — so the projection uses the row's
 * `updatedAt`-free fallback: archived-since-forever is wrong, and archived-now
 * is wrong the moment you ask a historical question.
 *
 * Rather than invent a date, an archived organization is projected with
 * `archivedAt` at its own `createdAt`, and this is called out because it is a
 * genuine limitation of the current schema rather than a modelling choice.
 * A real `archivedAt` column arrives with the schema programme; until then,
 * historical queries about archived clubs are not reliable and should not be
 * built on.
 */
export function projectToUnits(
  institution: InstitutionRow,
  organizations: readonly OrganizationRow[],
  options: ProjectionOptions,
): OrgUnitInput[] {
  const root: OrgUnitInput = {
    id: institution.id,
    typeId: options.institutionType,
    name: institution.name,
    effectiveFrom: iso(institution.createdAt),
  }

  const children: OrgUnitInput[] = organizations
    // A row naming a different tenant is not a hierarchy problem to be validated
    // — it is a tenancy failure, and it is refused rather than drawn.
    .filter((o) => {
      if (o.institutionId !== institution.id) {
        throw new Error(
          `Organization "${o.id}" belongs to institution "${o.institutionId}", not "${institution.id}". ` +
            `Refusing to project another tenant's organization into this graph.`,
        )
      }
      return true
    })
    .map((o) => ({
      id: o.id,
      typeId: options.organizationType,
      name: o.name,
      // An organization cannot predate its institution. The pilot's rows were
      // created by a seed in one transaction, so these can be equal; clamping
      // keeps that legal rather than off by milliseconds.
      effectiveFrom: iso(o.createdAt < institution.createdAt ? institution.createdAt : o.createdAt),
      ...(o.status === "ARCHIVED" ? { archivedAt: iso(o.createdAt) } : {}),
      parentage: [
        {
          parentId: institution.id,
          effectiveFrom: iso(o.createdAt < institution.createdAt ? institution.createdAt : o.createdAt),
        },
      ],
    }))

  return [root, ...children]
}

/** Project and validate in one step. Throws if the result is not a legal hierarchy. */
export function projectToGraph(
  topology: OrgTopology,
  institution: InstitutionRow,
  organizations: readonly OrganizationRow[],
  options: ProjectionOptions,
): OrgGraph {
  return buildOrgGraph(topology, projectToUnits(institution, organizations, options))
}
