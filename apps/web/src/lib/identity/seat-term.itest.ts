import { db } from "@/lib/db"
import { getUserContext } from "@/lib/rbac"
import { runUnscoped } from "@/lib/tenancy/context"

/**
 * GE-040-003 — a seat past its term grants nothing, through the real authorization path.
 *
 * `packages/identity/src/seats.ts` decides this and is unit-tested for it. That
 * proves the rule, not the wiring — and the wiring is where it had been missing
 * for the entire life of the application: `RoleAssignment.startDate` and
 * `endDate` were in the schema and in no query, so authority came from `status`
 * alone, and `ALUMNI` is only ever written by a person clicking.
 *
 * A mutation that removed the filter from `rbac.ts` left every unit test green,
 * because nothing exercised `getUserContext` against a database. This file is
 * that missing test: real rows, real Postgres, the same function every
 * capability check in the application calls.
 *
 * Fixtures are written through `@/lib/db` inside `runUnscoped("seed", …)`
 * rather than through a client of this file's own. The other integration tests
 * build their own on purpose — they are asserting what the tenancy extension
 * does, so an extended client would answer from the thing under test. This one
 * is not: it asserts what `getUserContext` returns, and `getUserContext` already
 * runs its own reads unscoped. Using the real chokepoint keeps it off the
 * raw-client exemption list, which is a list worth not growing.
 *
 * The three cases are the ones a term boundary actually produces:
 *
 *   * an `ACTIVE` seat whose term has ended — the hole, and the only one that
 *     was ever a live authority bug;
 *   * an `ACTIVE` seat whose term has not started — a scheduled appointment
 *     that must not act early;
 *   * a `SHADOW` seat before its start — which must still be visible, because
 *     previewing before the term begins is the whole purpose of SHADOW, and a
 *     "fix" that removed it would look like a tightening.
 */

/** Distinct per run: this suite writes rows and is not idempotent. */
const RUN = Date.now().toString(36)
const institutionId = `inst-seat-${RUN}`
const userId = `user-seat-${RUN}`

const days = (n: number) => new Date(Date.now() + n * 86_400_000)

interface Fixture {
  key: string
  status: "SHADOW" | "ACTIVE" | "ALUMNI"
  startDate: Date
  endDate: Date | null
  expectPresent: boolean
}

const FIXTURES: Fixture[] = [
  { key: "current", status: "ACTIVE", startDate: days(-30), endDate: null, expectPresent: true },
  { key: "in-term", status: "ACTIVE", startDate: days(-30), endDate: days(30), expectPresent: true },
  // The hole. ACTIVE, term over, nobody has clicked ALUMNI.
  { key: "term-ended", status: "ACTIVE", startDate: days(-300), endDate: days(-1), expectPresent: false },
  { key: "not-started", status: "ACTIVE", startDate: days(7), endDate: null, expectPresent: false },
  // SHADOW before its start must survive: that is what SHADOW is for.
  { key: "shadow-incoming", status: "SHADOW", startDate: days(7), endDate: null, expectPresent: true },
  { key: "shadow-stale", status: "SHADOW", startDate: days(-300), endDate: days(-1), expectPresent: false },
  { key: "past-holder", status: "ALUMNI", startDate: days(-300), endDate: days(-10), expectPresent: false },
]

describe("seat terms are enforced by the real authorization path", () => {
  beforeAll(async () => {
    await runUnscoped("seed", "seat-term fixtures", async () => {
    await db.institution.create({
      data: { id: institutionId, name: `Seat fixture ${RUN}`, slug: institutionId },
    })
    await db.user.create({
      data: { id: userId, name: "Seat fixture holder", email: `seat-${RUN}@example.invalid` },
    })
    await db.institutionMembership.create({
      data: { userId, institutionId, role: "OSE_STAFF" },
    })

    const organization = await db.organization.create({
      data: {
        id: `org-seat-${RUN}`,
        institutionId,
        name: `Seat fixture club ${RUN}`,
        slug: `org-seat-${RUN}`,
      },
    })

    for (const fixture of FIXTURES) {
      const role = await db.role.create({
        data: {
          id: `role-${RUN}-${fixture.key}`,
          organizationId: organization.id,
          name: fixture.key,
          scope: "MEMBER",
        },
      })
      await db.roleAssignment.create({
        data: {
          userId,
          roleId: role.id,
          status: fixture.status,
          startDate: fixture.startDate,
          endDate: fixture.endDate,
        },
      })
      }
    })
  })

  afterAll(async () => {
    await runUnscoped("seed", "seat-term teardown", async () => {
      await db.roleAssignment.deleteMany({ where: { userId } })
      await db.role.deleteMany({ where: { id: { startsWith: `role-${RUN}-` } } })
      await db.organization.deleteMany({ where: { id: `org-seat-${RUN}` } })
      await db.institutionMembership.deleteMany({ where: { userId } })
      await db.user.deleteMany({ where: { id: userId } })
      await db.institution.deleteMany({ where: { id: institutionId } })
    })
  })

  it("includes exactly the seats whose terms grant something now", async () => {
    const context = await getUserContext(userId)
    const present = context.orgRoles.map((role) => role.roleName).sort()
    const expected = FIXTURES.filter((f) => f.expectPresent).map((f) => f.key).sort()
    expect(present).toEqual(expected)
  })

  it("drops an ACTIVE seat whose term has ended", async () => {
    // The one that was a live authority bug: a seat whose term ended in June
    // kept full authority until somebody remembered to close it.
    const context = await getUserContext(userId)
    expect(context.orgRoles.map((r) => r.roleName)).not.toContain("term-ended")
  })

  it("keeps a SHADOW seat that has not started", async () => {
    // Previewing before the term begins is the entire purpose of SHADOW. A
    // change that removed it would look like a tightening and would be a
    // regression.
    const context = await getUserContext(userId)
    const shadow = context.orgRoles.find((r) => r.roleName === "shadow-incoming")
    expect(shadow).toBeDefined()
    expect(shadow?.status).toBe("SHADOW")
  })

  it("still reports the institution membership it depends on", async () => {
    // A seat lives inside a tenant. If the membership vanished, the seat
    // assertions above would pass for the wrong reason.
    const context = await getUserContext(userId)
    expect(context.institutionRoles.map((m) => m.institutionId)).toContain(institutionId)
  })
})
