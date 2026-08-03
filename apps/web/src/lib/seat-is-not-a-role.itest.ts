import { db } from "@/lib/db"
import { runUnscoped } from "@/lib/tenancy/context"

/**
 * GE-050-002 — the database agrees that a seat is not a role.
 *
 * `Role` used to carry three things: a permission scope, an organization-scoped
 * record, and a durable position. The schema comment said as much — "Permanent
 * position ID — the seat's identity outlives every holder" — while the model
 * kept that identity in the same row every authorization check reads.
 *
 * These assert the separation against a real database, because the interesting
 * claims are about columns and constraints rather than about types: TypeScript
 * would be satisfied by a `Seat` table nothing ever wrote to.
 *
 * Uses the application's own client rather than a raw `PrismaClient`. Seat and
 * Role are `UNENFORCEABLE` in the tenancy registry — they reach their tenant
 * through Organization and have no column to filter on — so the extension
 * passes them through, and testing the client the application actually uses is
 * worth more than an exemption in `forbidden-clients`.
 */

const RUN = Date.now().toString(36)
const institutionId = `inst-seat-${RUN}`
const organizationId = `org-seat-${RUN}`

beforeAll(async () => {
  await runUnscoped("seed", "seat-is-not-a-role fixture", async () => {
  await db.institution.create({
    data: { id: institutionId, name: `Seat fixture ${RUN}`, slug: institutionId },
  })
  await db.organization.create({
    data: {
      id: organizationId,
      institutionId,
      name: `Seat club ${RUN}`,
      slug: organizationId,
      category: "PROFESSIONAL",
    },
  })
  })
})

afterAll(async () => {
  await runUnscoped("seed", "seat-is-not-a-role teardown", async () => {
    await db.organization.deleteMany({ where: { institutionId } })
    await db.institution.deleteMany({ where: { id: institutionId } })
  })
})

describe("the position lives on the seat", () => {
  it("creates a role and its seat together", async () => {
    return runUnscoped("migration", "assert", async () => {
    const role = await db.role.create({
      data: {
        organizationId,
        name: "President",
        scope: "PRESIDENT",
        seat: { create: { organizationId, positionCode: `SEAT-${RUN}-PRES`, seatOrder: 0 } },
      },
      include: { seat: true },
    })

    expect(role.seat?.positionCode).toBe(`SEAT-${RUN}-PRES`)
    // The role row itself carries no position. Asserted on the returned object
    // rather than on the type, because the type is what a stale client would
    // still satisfy.
    expect(Object.keys(role)).not.toContain("positionCode")
    expect(Object.keys(role)).not.toContain("seatOrder")
    })
  })

  it("keeps the position when the role is renamed", async () => {
    return runUnscoped("migration", "assert", async () => {
    // The point of the split. Renaming a position used to edit the row
    // authorization reads; now the two are separate writes and only one of them
    // touches `scope`.
    const before = await db.role.findFirstOrThrow({
      where: { organizationId, name: "President" },
      include: { seat: true },
    })

    const after = await db.role.update({
      where: { id: before.id },
      data: { name: "Club President" },
      include: { seat: true },
    })

    expect(after.seat?.id).toBe(before.seat?.id)
    expect(after.seat?.positionCode).toBe(before.seat?.positionCode)
    expect(after.scope).toBe(before.scope)
    })
  })

  it("holds one seat per role", async () => {
    return runUnscoped("migration", "assert", async () => {
    // A second seat sharing a role is a real future case, and lifting the
    // constraint is a deliberate migration rather than something that happens
    // by accident.
    const role = await db.role.findFirstOrThrow({ where: { organizationId, name: "Club President" } })

    await expect(
      db.seat.create({ data: { organizationId, roleId: role.id, positionCode: `SEAT-${RUN}-DUP` } }),
    ).rejects.toThrow()
    })
  })

  it("keeps position codes globally unique", async () => {
    return runUnscoped("migration", "assert", async () => {
    // Two clubs with the same initials generate the same code, and the second
    // charter would silently take the first one's identity without this.
    const other = await db.organization.create({
      data: {
        id: `${organizationId}-b`,
        institutionId,
        name: `Seat club B ${RUN}`,
        slug: `${organizationId}-b`,
        category: "PROFESSIONAL",
      },
    })

    await expect(
      db.role.create({
        data: {
          organizationId: other.id,
          name: "President",
          scope: "PRESIDENT",
          seat: { create: { organizationId: other.id, positionCode: `SEAT-${RUN}-PRES` } },
        },
      }),
    ).rejects.toThrow()
    })
  })

  it("takes the seat with the role when the role goes", async () => {
    return runUnscoped("migration", "assert", async () => {
    // Cascade, so a deleted role cannot leave a position pointing at nothing.
    const role = await db.role.create({
      data: {
        organizationId,
        name: `Temporary ${RUN}`,
        scope: "FUNCTIONAL",
        seat: { create: { organizationId, positionCode: `SEAT-${RUN}-TEMP` } },
      },
      include: { seat: true },
    })

    await db.role.delete({ where: { id: role.id } })
    expect(await db.seat.findUnique({ where: { id: role.seat!.id } })).toBeNull()
    })
  })
})

describe("the seeded database keeps them one to one", () => {
  it("gives every role exactly one seat", async () => {
    return runUnscoped("migration", "assert", async () => {
    // The backfill produced one seat per role and the seed maintains it. A role
    // with no seat is authority attached to no post, which is the state the
    // split exists to make impossible to reach by accident.
    const roles = await db.role.count()
    const seats = await db.seat.count()
    const orphanRoles = await db.role.count({ where: { seat: null } })

    expect(roles).toBeGreaterThan(0)
    expect(orphanRoles).toBe(0)
    expect(seats).toBe(roles)
    })
  })

  it("carries the position codes the roster published", async () => {
    return runUnscoped("migration", "assert", async () => {
    // Proves the seed writes through to the new table rather than silently
    // dropping the columns it used to set.
    const coded = await db.seat.count({ where: { positionCode: { not: null } } })
    expect(coded).toBeGreaterThan(0)
    })
  })
})
