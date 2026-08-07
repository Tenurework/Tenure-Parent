import { PrismaClient } from "@prisma/client"

import { TenantContextError } from "./tenancy/context"
import { actingInstitutions, resolveTenantScope } from "./tenant-scope"

/**
 * GE-022-001 — switching tenants, proved against a real database.
 *
 * The shell, the `/me` bootstrap, the switcher and the entitlement-driven
 * navigation all existed before this file. What did not exist was any proof
 * that the load-bearing claim is true:
 *
 *   > every later request re-proves the membership rather than trusting the
 *   > cookie — that, not the switch action, is what stands between a forged
 *   > cookie and another tenant's rows.
 *
 * That claim is written in `(app)/actions.ts`. A comment asserting a security
 * property is worth exactly as much as the test underneath it, and there was
 * none. These are that test.
 *
 * Against Postgres, not a mock, because the property is "the membership row
 * decides" and a mock would decide whatever it was told.
 *
 *   DATABASE_URL=postgresql://tenure:tenure@localhost:5433/tenure
 */
const db = new PrismaClient({ log: ["error"] })

const SUFFIX = `sw-${process.pid}`
const A = `inst-a-${SUFFIX}`
const B = `inst-b-${SUFFIX}`
const MEMBER_OF_A = `user-a-${SUFFIX}@example.invalid`
const MEMBER_OF_BOTH = `user-ab-${SUFFIX}@example.invalid`

let memberOfA = ""
let memberOfBoth = ""

async function cleanup() {
  await db.institutionMembership.deleteMany({ where: { institutionId: { in: [A, B] } } })
  await db.institution.deleteMany({ where: { id: { in: [A, B] } } })
  await db.user.deleteMany({ where: { email: { in: [MEMBER_OF_A, MEMBER_OF_BOTH] } } })
}

beforeAll(async () => {
  await cleanup()

  await db.institution.create({ data: { serving: true, id: A, name: "Tenant A", slug: `a-${SUFFIX}` } })
  await db.institution.create({ data: { serving: true, id: B, name: "Tenant B", slug: `b-${SUFFIX}` } })

  const a = await db.user.create({ data: { email: MEMBER_OF_A, name: "A only" } })
  const ab = await db.user.create({ data: { email: MEMBER_OF_BOTH, name: "A and B" } })
  memberOfA = a.id
  memberOfBoth = ab.id

  await db.institutionMembership.create({
    data: { userId: memberOfA, institutionId: A, role: "OSE_STAFF" },
  })
  await db.institutionMembership.create({
    data: { userId: memberOfBoth, institutionId: A, role: "OSE_STAFF" },
  })
  await db.institutionMembership.create({
    data: { userId: memberOfBoth, institutionId: B, role: "OSE_DIRECTOR" },
  })
})

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

describe("what a user may act as", () => {
  it("offers only the tenants they belong to", async () => {
    const single = await actingInstitutions(memberOfA)
    expect(single.options.map((o) => o.id)).toEqual([A])

    const both = await actingInstitutions(memberOfBoth)
    expect(both.options.map((o) => o.id).sort()).toEqual([A, B].sort())
  })

  it("resolves a requested tenant the user belongs to", async () => {
    const scope = await resolveTenantScope(memberOfBoth, B)
    expect(scope.institutionId).toBe(B)
  })
})

describe("a requested tenant is a claim, not a fact", () => {
  it("refuses a tenant the user does not belong to", async () => {
    // The whole property. `memberOfA` naming B is exactly what a forged or
    // stale cookie looks like by the time it reaches this function.
    await expect(resolveTenantScope(memberOfA, B)).rejects.toThrow(TenantContextError)
  })

  it("refuses a tenant that does not exist at all", async () => {
    await expect(resolveTenantScope(memberOfBoth, "inst-does-not-exist")).rejects.toThrow(
      TenantContextError,
    )
  })

  it("re-proves on EVERY call, not once per session", async () => {
    // The claim in (app)/actions.ts is that a later request re-derives this
    // rather than trusting what an earlier one decided. Revoking the membership
    // between two identical calls is the only way to tell the difference: a
    // cached answer keeps working, a re-derived one stops.
    const before = await resolveTenantScope(memberOfBoth, B)
    expect(before.institutionId).toBe(B)

    await db.institutionMembership.deleteMany({
      where: { userId: memberOfBoth, institutionId: B },
    })

    await expect(resolveTenantScope(memberOfBoth, B)).rejects.toThrow(TenantContextError)

    // And the switcher stops offering it, so the UI cannot keep showing a
    // tenant the server would now refuse.
    const after = await actingInstitutions(memberOfBoth)
    expect(after.options.map((o) => o.id)).toEqual([A])

    // Restore for any test ordering that follows.
    await db.institutionMembership.create({
      data: { userId: memberOfBoth, institutionId: B, role: "OSE_DIRECTOR" },
    })
  })

  it("refuses a user with no memberships at all", async () => {
    const orphan = await db.user.create({
      data: { email: `orphan-${SUFFIX}@example.invalid`, name: "No tenants" },
    })
    try {
      await expect(resolveTenantScope(orphan.id)).rejects.toThrow(TenantContextError)
      const options = await actingInstitutions(orphan.id)
      expect(options.options).toEqual([])
    } finally {
      await db.user.delete({ where: { id: orphan.id } })
    }
  })
})

describe("the active tenant is one of the user's own", () => {
  it("defaults to a tenant the user belongs to when none is requested", async () => {
    // No request means the server picks, and what it picks must still be a
    // membership rather than, say, the first Institution row in the table.
    const scope = await resolveTenantScope(memberOfA)
    expect(scope.institutionId).toBe(A)
  })

  it("never defaults to a tenant the user does not belong to", async () => {
    const scope = await resolveTenantScope(memberOfA)
    const allowed = (await actingInstitutions(memberOfA)).options.map((o) => o.id)
    expect(allowed).toContain(scope.institutionId)
    expect(scope.institutionId).not.toBe(B)
  })
})
