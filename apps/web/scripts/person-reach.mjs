/**
 * "Which tenants does this person reach?" — one definition, four paths.
 *
 * GE-020-005. This module exists because the question had two different answers
 * depending on which table you asked, and the census asked only one of them.
 *
 * ## The two person graphs
 *
 * Tenure stores people twice, on purpose:
 *
 *   * `User` — an authenticated account. Reaches a tenant through
 *     `InstitutionMembership` (OSE staff) or `RoleAssignment -> Role ->
 *     Organization` (a club officer).
 *   * `DirectoryPerson` — roster directory data that deliberately CANNOT be
 *     signed in as (see the model comment: seeding the real roster as login
 *     accounts would let anyone impersonate a student while dev sign-in is on).
 *     Reaches a tenant through `SeatHolding -> Role -> Organization` or
 *     `OrganizationAdvisor -> Organization`.
 *
 * Both are legitimate. What was not legitimate is measuring "people who reach
 * more than one tenant" across one graph and reporting it as the answer for
 * people. On the pilot database that is 172 directory people counted and 11
 * users not counted, and the users are the ones whose reach the application
 * actually grants at runtime — `RoleAssignment` has 55 write sites in `src/`,
 * `SeatHolding` has none outside the seed.
 *
 * So a person granted membership of a second institution through the admin UI
 * today does not appear in a census whose stated purpose is to decide whether
 * that is allowed to happen. It answers with seed-authored rows.
 *
 * ## Why the two graphs are not merged here
 *
 * They are joinable only by email, and only 2 of 172 directory people have a
 * matching account. Merging on that would invent a person out of a coincidence
 * of address. `REACH_BY_IDENTITY` reports each graph separately with its own
 * denominator; `docs/migrations/DUPLICATE-SOURCES.md` holds the plan for making
 * the link explicit (a nullable `DirectoryPerson.userId`, backfilled from
 * VERIFIED email only), which is a migration and not a query.
 */

/**
 * Every way a row in a person table is tied to an institution.
 *
 * Kept as data rather than one hand-written UNION so that adding a path is a
 * line here and is picked up by every caller — the failure this module exists
 * to fix was one caller knowing about two paths and nobody noticing the other
 * two.
 */
export const REACH_PATHS = [
  {
    identity: "User",
    via: "InstitutionMembership",
    sql: `SELECT u.id::text AS id, im."institutionId" AS inst
            FROM "User" u JOIN "InstitutionMembership" im ON im."userId" = u.id`,
  },
  {
    identity: "User",
    via: "RoleAssignment",
    sql: `SELECT u.id::text AS id, o."institutionId" AS inst
            FROM "User" u
            JOIN "RoleAssignment" ra ON ra."userId" = u.id
            JOIN "Role" r ON r.id = ra."roleId"
            JOIN "Organization" o ON o.id = r."organizationId"`,
  },
  {
    identity: "DirectoryPerson",
    via: "SeatHolding",
    sql: `SELECT dp.id::text AS id, o."institutionId" AS inst
            FROM "DirectoryPerson" dp
            JOIN "SeatHolding" sh ON sh."personId" = dp.id
            JOIN "Role" r ON r.id = sh."roleId"
            JOIN "Organization" o ON o.id = r."organizationId"`,
  },
  {
    identity: "DirectoryPerson",
    via: "OrganizationAdvisor",
    sql: `SELECT dp.id::text AS id, o."institutionId" AS inst
            FROM "DirectoryPerson" dp
            JOIN "OrganizationAdvisor" oa ON oa."personId" = dp.id
            JOIN "Organization" o ON o.id = oa."organizationId"`,
  },
]

/** The table each identity's total is taken from — the denominator. */
const TOTAL_TABLE = { User: `"User"`, DirectoryPerson: `"DirectoryPerson"` }

/**
 * Reach for one identity table, with its denominator.
 *
 * Returns `{ identity, paths, total, reachingATenant, reachingNone,
 * reachingSeveral }`. `total` is every row in the table, not every row that
 * reached something — reporting a count of multi-tenant people without saying
 * how many people were examined is the failure the census's own header warns
 * about twice.
 */
export async function reachFor(db, identity) {
  const paths = REACH_PATHS.filter((p) => p.identity === identity)
  if (paths.length === 0) throw new Error(`no reach paths declared for ${identity}`)

  const union = paths.map((p) => p.sql).join("\n          UNION\n          ")
  const total = TOTAL_TABLE[identity]

  const [row] = await db.$queryRawUnsafe(`
    WITH reach AS (
          ${union}
    ), per_person AS (SELECT id, count(DISTINCT inst) AS n FROM reach GROUP BY id)
    SELECT (SELECT count(*) FROM ${total})                                   AS total,
           (SELECT count(*) FROM per_person)                                 AS reaching_a_tenant,
           (SELECT count(*) FROM ${total}) - (SELECT count(*) FROM per_person) AS reaching_none,
           (SELECT count(*) FROM per_person WHERE n > 1)                     AS reaching_several`)

  return {
    identity,
    paths: paths.map((p) => p.via),
    total: Number(row.total),
    reachingATenant: Number(row.reaching_a_tenant),
    reachingNone: Number(row.reaching_none),
    reachingSeveral: Number(row.reaching_several),
  }
}

/** Both identity tables, each with its own denominator. Never summed: a person
 *  present in both would be counted twice, and only 2 of 172 are even joinable. */
export async function reachSummary(db) {
  const identities = [...new Set(REACH_PATHS.map((p) => p.identity))]
  return Promise.all(identities.map((i) => reachFor(db, i)))
}

/**
 * The ids that reach more than one tenant, so a finding can be acted on.
 *
 * A count tells an operator that product decision B applies to real rows; it
 * does not tell them which rows, and "go find them" is the part that gets
 * skipped. Capped, because this is a report and not an export.
 */
export async function multiTenantPeople(db, identity, limit = 50) {
  const paths = REACH_PATHS.filter((p) => p.identity === identity)
  const union = paths.map((p) => p.sql).join("\n        UNION\n        ")
  const rows = await db.$queryRawUnsafe(`
    WITH reach AS (
        ${union}
    )
    SELECT id, count(DISTINCT inst) AS tenants, string_agg(DISTINCT inst, ', ' ORDER BY inst) AS which
      FROM reach GROUP BY id HAVING count(DISTINCT inst) > 1
     ORDER BY count(DISTINCT inst) DESC, id
     LIMIT ${Number(limit)}`)
  return rows.map((r) => ({ id: r.id, tenants: Number(r.tenants), which: r.which }))
}
