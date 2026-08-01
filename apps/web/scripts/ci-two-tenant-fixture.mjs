/**
 * A second tenant, so migrations meet data instead of an empty database.
 *
 * CI applies migrations to a database created moments earlier and never
 * populated. Every backfill therefore runs against zero rows and every check
 * passes vacuously — the shape of verification that reads green while proving
 * nothing. Nothing at any point in the tenancy programme would exercise a
 * backfill against real rows, which is exactly where they go wrong.
 *
 * This builds the second tenant that makes those checks mean something, and is
 * deliberately built to grow: the tenant-scoped-uniques work (ADR-0004, M2/M3/M4)
 * turns the COLLIDING constants below from "must not be used" into the whole
 * point. They are declared here now so that step is a one-line change to a flag
 * rather than a new fixture written under time pressure.
 *
 *   node scripts/ci-two-tenant-fixture.mjs           # create
 *   node scripts/ci-two-tenant-fixture.mjs --verify  # assert both tenants intact
 *
 * Run AFTER seed.mjs, so tenant A is the realistic 26-club dataset and B is a
 * small deliberate neighbour rather than a second copy of everything.
 */

import { PrismaClient } from "@prisma/client"

// The extension is not attached here on purpose. This is control-plane work —
// it creates a tenant — and it must be able to write across both. The app's
// client (src/lib/db.ts) is the one that enforces; using it here would need an
// unscoped grant for every statement and would prove nothing extra.
const db = new PrismaClient({ log: ["error"] })

const B = {
  institutionId: "ci-tenant-b",
  slug: "ci-tenant-b",
  name: "CI Tenant B",
}

/**
 * Names that currently MUST NOT collide with tenant A, because the constraints
 * that would allow it are still global:
 *
 *   Organization.slug, Role.positionCode, Deliverable.key, DirectoryPerson.email
 *
 * After ADR-0004's M2-M4 these become tenant-scoped composites, and this fixture
 * should switch to values that deliberately DO collide — that is the assertion
 * those steps exist to satisfy. Until then, colliding here would fail on a
 * constraint and prove only that the constraint exists.
 */
const COLLIDE_WITH_TENANT_A = false

const orgSlug = COLLIDE_WITH_TENANT_A ? "simon-consulting-club" : "ci-b-consulting-club"
// The colliding value is tenant A's seeded president, taken from the synthetic
// fixture that CI seeds from — not a real address. A fixture that hardcodes a
// real person's email is a real person's email in a public repository, and the
// collision it is testing works just as well against an invented one.
const personEmail = COLLIDE_WITH_TENANT_A ? "logan.ellery@example.invalid" : "ci-b-president@example.invalid"
const deliverableKey = COLLIDE_WITH_TENANT_A ? "budget-submission" : "ci-b-budget-submission"

async function create() {
  await db.institution.upsert({
    where: { id: B.institutionId },
    update: {},
    create: { id: B.institutionId, name: B.name, slug: B.slug },
  })

  const org = await db.organization.upsert({
    where: { slug: orgSlug },
    update: {},
    create: {
      institutionId: B.institutionId,
      name: "B's Consulting Club",
      slug: orgSlug,
      category: "PROFESSIONAL",
    },
  })

  const role = await db.role.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "President" } },
    update: {},
    create: { organizationId: org.id, name: "President", scope: "PRESIDENT" },
  })

  const user = await db.user.upsert({
    where: { email: "ci-b-user@example.invalid" },
    update: {},
    create: { email: "ci-b-user@example.invalid", name: "B's President" },
  })

  const existing = await db.roleAssignment.findFirst({ where: { userId: user.id, roleId: role.id } })
  if (!existing) {
    await db.roleAssignment.create({ data: { userId: user.id, roleId: role.id, status: "ACTIVE" } })
  }

  await db.directoryPerson.upsert({
    where: { email: personEmail },
    update: {},
    create: { email: personEmail, name: "B Directory Person", kind: "STUDENT" },
  })

  await db.deliverable.upsert({
    where: { key: deliverableKey },
    update: {},
    create: {
      institutionId: B.institutionId,
      key: deliverableKey,
      title: "B's budget submission",
      kind: "DEADLINE",
      dueAt: new Date("2027-01-15T17:00:00Z"),
    },
  })

  console.log(`✅ Tenant B created (collisions ${COLLIDE_WITH_TENANT_A ? "ON" : "off"})`)
}

/**
 * Assert both tenants survived whatever just ran.
 *
 * Counts per tenant rather than in total: a backfill that stamped every row
 * with the same institutionId would leave the total unchanged and is exactly
 * the failure worth catching.
 */
async function verify() {
  const problems = []

  const institutions = await db.institution.count()
  if (institutions < 2) problems.push(`expected >= 2 institutions, found ${institutions}`)

  const [orgsA, orgsB] = await Promise.all([
    db.organization.count({ where: { institutionId: { not: B.institutionId } } }),
    db.organization.count({ where: { institutionId: B.institutionId } }),
  ])
  if (orgsA < 1) problems.push(`tenant A has no organizations (${orgsA})`)
  if (orgsB !== 1) problems.push(`tenant B should have exactly 1 organization, has ${orgsB}`)

  const [delivA, delivB] = await Promise.all([
    db.deliverable.count({ where: { institutionId: { not: B.institutionId } } }),
    db.deliverable.count({ where: { institutionId: B.institutionId } }),
  ])
  if (delivA < 1) problems.push(`tenant A has no deliverables (${delivA})`)
  if (delivB !== 1) problems.push(`tenant B should have exactly 1 deliverable, has ${delivB}`)

  // A row whose institutionId points at no Institution means a backfill
  // produced a value nobody owns — the quarantine case ADR-0004's backfills
  // leave NULL rather than guess at. Organization.institution is a required
  // relation, so this can only happen through the eight models that carry
  // institutionId as bare TEXT with no foreign key behind it; checking it here
  // costs nothing and is the assertion that will matter once M1 backfills them.
  const known = (await db.institution.findMany({ select: { id: true } })).map((i) => i.id)
  const orphanedOrgs = await db.organization.count({
    where: { institutionId: { notIn: known } },
  })
  if (orphanedOrgs > 0) problems.push(`${orphanedOrgs} organizations reference an unknown institution`)

  console.log(
    `institutions=${institutions} orgs(A/B)=${orgsA}/${orgsB} deliverables(A/B)=${delivA}/${delivB}`,
  )

  if (problems.length) {
    console.error("❌ Two-tenant verification failed:")
    for (const p of problems) console.error(`   - ${p}`)
    process.exit(1)
  }
  console.log("✅ Both tenants intact after migration.")
}

const mode = process.argv.includes("--verify") ? verify : create
await mode()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
