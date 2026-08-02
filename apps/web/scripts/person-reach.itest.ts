import { PrismaClient } from "@prisma/client"

// An ESM script module consumed by the jest transform. It ships as .mjs into
// the runtime image — no build step for scripts/ is what keeps them runnable
// inside the task, which is where the census has to run.
import { multiTenantPeople, reachFor, REACH_PATHS } from "./person-reach.mjs"

/**
 * GE-020-005 — the census counted people over a graph the application does not
 * write, and this is the proof, against Postgres rather than an argument.
 *
 * `scripts/census.mjs` section (5) is titled "PEOPLE WHO REACH MORE THAN ONE
 * TENANT" and says of itself that it blocks product decision B — whether one
 * person may belong to two institutions. Until 2026-08-02 it traversed
 * `DirectoryPerson -> SeatHolding` and `DirectoryPerson -> OrganizationAdvisor`
 * and nothing else.
 *
 * Neither of those is written by the application. `SeatHolding` has no writer
 * outside `scripts/seed.mjs`; `RoleAssignment` — the table the app actually
 * assigns officers with — has 55 write sites in `src/` and was not traversed at
 * all. So the operator who grants a user a second institution in the admin UI
 * creates exactly the row product decision B is about, and the census reports
 * zero.
 *
 * The test builds that person and asks both ways. The old traversal is written
 * out in full below rather than described, because "the previous query missed
 * this" is a claim, and running it is evidence.
 *
 *   DATABASE_URL=postgresql://tenure:tenure@localhost:5433/tenure
 */
const db = new PrismaClient({ log: ["error"] })

const SUFFIX = `reach-${process.pid}`
const A = `inst-a-${SUFFIX}`
const B = `inst-b-${SUFFIX}`
const CROSSER = `crosser-${SUFFIX}@example.invalid`
const ORG_B = `org-b-${SUFFIX}`

let crosserId = ""

async function cleanup() {
  await db.roleAssignment.deleteMany({ where: { user: { email: CROSSER } } })
  await db.institutionMembership.deleteMany({ where: { institutionId: { in: [A, B] } } })
  await db.role.deleteMany({ where: { organization: { slug: ORG_B } } })
  await db.organization.deleteMany({ where: { slug: ORG_B } })
  await db.institution.deleteMany({ where: { id: { in: [A, B] } } })
  await db.user.deleteMany({ where: { email: CROSSER } })
}

beforeAll(async () => {
  await cleanup()

  await db.institution.create({ data: { id: A, name: "Reach A", slug: A } })
  await db.institution.create({ data: { id: B, name: "Reach B", slug: B } })

  const user = await db.user.create({ data: { email: CROSSER, name: "Reaches Both" } })
  crosserId = user.id

  // Path one: OSE staff at institution A.
  await db.institutionMembership.create({
    data: { userId: user.id, institutionId: A, role: "OSE_STAFF" },
  })

  // Path two: a club officer at institution B. Two different mechanisms, which
  // is the point — a census that traverses one of them under-reports.
  const org = await db.organization.create({
    data: { institutionId: B, name: "B Club", slug: ORG_B, category: "PROFESSIONAL" },
  })
  const role = await db.role.create({
    data: { organizationId: org.id, name: "President", scope: "PRESIDENT" },
  })
  await db.roleAssignment.create({ data: { userId: user.id, roleId: role.id, status: "ACTIVE" } })
}, 60_000)

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

describe("a person who reaches two tenants", () => {
  it("is invisible to the traversal the census used", async () => {
    // Verbatim the query census.mjs (5) ran before this item, so the claim is
    // executed and not merely stated.
    const rows = await db.$queryRawUnsafe<Array<{ reaching_several: bigint }>>(`
      WITH reach AS (
        SELECT dp.id, o."institutionId" AS inst FROM "DirectoryPerson" dp
          JOIN "SeatHolding" sh ON sh."personId" = dp.id
          JOIN "Role" r ON r.id = sh."roleId"
          JOIN "Organization" o ON o.id = r."organizationId"
        UNION
        SELECT dp.id, o."institutionId" FROM "DirectoryPerson" dp
          JOIN "OrganizationAdvisor" oa ON oa."personId" = dp.id
          JOIN "Organization" o ON o.id = oa."organizationId"
      )
      SELECT count(*) FILTER (WHERE n > 1) AS reaching_several
        FROM (SELECT id, count(DISTINCT inst) AS n FROM reach GROUP BY id) p`)

    // Zero. The person exists, holds two institutions, and does not appear —
    // because they are a User and that query only ever looked at DirectoryPerson.
    expect(Number(rows[0].reaching_several)).toBe(0)
  })

  it("is counted once the User graph is traversed", async () => {
    const reach = await reachFor(db, "User")
    expect(reach.reachingSeveral).toBeGreaterThanOrEqual(1)
  })

  it("is named, not just counted", async () => {
    // A count says the decision applies to real rows. It does not say to which,
    // and "go and find them" is the step that gets skipped.
    const people = await multiTenantPeople(db, "User")
    const found = people.find((p: { id: string }) => p.id === crosserId)
    expect(found).toBeDefined()
    expect(found.tenants).toBe(2)
    expect(found.which).toContain(A)
    expect(found.which).toContain(B)
  })

  it("is reported against a denominator", async () => {
    // The census's own header: never report a failure count without the number
    // of rows examined, because "0 mismatches" and "0 rows examined" print the
    // same and only one is good news.
    const reach = await reachFor(db, "User")
    expect(reach.total).toBeGreaterThanOrEqual(reach.reachingATenant)
    expect(reach.reachingNone).toBe(reach.total - reach.reachingATenant)
  })
})

describe("the reach definition covers both person tables", () => {
  it("traverses every mechanism that ties a person to an institution", () => {
    // Adding a fifth way to belong to a tenant and not adding it here recreates
    // exactly the bug this item fixed, so the set is asserted rather than
    // trusted to review.
    const declared = REACH_PATHS.map((p: { identity: string; via: string }) => `${p.identity}.${p.via}`).sort()
    expect(declared).toEqual([
      "DirectoryPerson.OrganizationAdvisor",
      "DirectoryPerson.SeatHolding",
      "User.InstitutionMembership",
      "User.RoleAssignment",
    ])
  })

  it("keeps the two person tables separate rather than merging on email", async () => {
    // They are joinable only by address, and on the pilot database 2 of 172
    // directory people have a matching account. A union would invent one person
    // out of a coincidence of email and report a merged number as fact.
    const users = await reachFor(db, "User")
    const directory = await reachFor(db, "DirectoryPerson")
    expect(users.identity).toBe("User")
    expect(directory.identity).toBe("DirectoryPerson")
    expect(users.paths).not.toEqual(directory.paths)
  })
})
