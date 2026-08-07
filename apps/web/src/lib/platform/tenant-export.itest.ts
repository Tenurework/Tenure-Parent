import { PrismaClient } from "@prisma/client"

import { tenancyExtension } from "@/lib/tenancy/extension"
import { runUnscoped } from "@/lib/tenancy/context"
import { TENANT_SCOPED, UNENFORCEABLE } from "@/lib/tenancy/registry"
import { checksumOfExport, exportTenant } from "./tenant-export"

/**
 * Tenant export, proved against a real database.
 *
 * The property that matters cannot be checked without one: that the export is
 * filtered by the *chokepoint* rather than by clauses someone remembered to
 * write. A unit test with a mocked client would pass whether or not the scope
 * was ever opened.
 *
 * Two tenants are created with deliberately overlapping content, and the
 * assertion is that A's export contains none of B's rows — the failure this
 * exists to prevent being a leak inside a file that is about to be handed to a
 * customer.
 *
 * Run with: npm run test:isolation   (needs DATABASE_URL)
 */

const db = new PrismaClient({ log: ["error"] }).$extends(tenancyExtension("enforce"))

const SUFFIX = "itest-export"
const INST_A = `inst-a-${SUFFIX}`
const INST_B = `inst-b-${SUFFIX}`
const AT = "2026-07-31T12:00:00Z"

async function cleanup() {
  await runUnscoped("migration", "export test cleanup", async () => {
    await db.organization.deleteMany({ where: { institutionId: { in: [INST_A, INST_B] } } })
    await db.resource.deleteMany({ where: { institutionId: { in: [INST_A, INST_B] } } })
    await db.institution.deleteMany({ where: { id: { in: [INST_A, INST_B] } } })
  })
}

beforeAll(async () => {
  await cleanup()
  await runUnscoped("control-plane", "export test fixture", async () => {
    await db.institution.createMany({
      data: [
        { serving: true, id: INST_A, name: "Tenant A", slug: `tenant-a-${SUFFIX}` },
        { serving: true, id: INST_B, name: "Tenant B", slug: `tenant-b-${SUFFIX}` },
      ],
    })
    await db.organization.createMany({
      data: [
        { institutionId: INST_A, name: "A's Club", slug: `a-club-${SUFFIX}` },
        { institutionId: INST_A, name: "A's Second Club", slug: `a-two-${SUFFIX}` },
        { institutionId: INST_B, name: "B's Club", slug: `b-club-${SUFFIX}` },
      ],
    })
    // Same key in both tenants, so a leak is unmistakable rather than plausible.
    await db.resource.createMany({
      data: [
        {
          institutionId: INST_A,
          key: `shared-${SUFFIX}`,
          title: "A's copy",
          description: "Tenant A's version of a resource both tenants key identically.",
          kind: "GUIDE",
          seats: ["ALL"],
          href: "https://a.test",
        },
        {
          institutionId: INST_B,
          key: `shared-${SUFFIX}`,
          title: "B's copy",
          description: "Tenant B's version, which must never appear in A's export.",
          kind: "GUIDE",
          seats: ["ALL"],
          href: "https://b.test",
        },
      ],
    })
  })
})

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

describe("an export contains one tenant and only one tenant", () => {
  it("exports A's organizations and none of B's", async () => {
    const dump = await exportTenant(INST_A, `tenant-a-${SUFFIX}`, { at: AT, requestedBy: "ops@tenure" })

    const orgs = dump.data.Organization as { name: string; institutionId: string }[]
    expect(orgs.map((o) => o.name).sort()).toEqual(["A's Club", "A's Second Club"])
    expect(orgs.every((o) => o.institutionId === INST_A)).toBe(true)
  })

  it("takes A's copy of a row whose key exists in both tenants", async () => {
    const dump = await exportTenant(INST_A, `tenant-a-${SUFFIX}`, { at: AT, requestedBy: "ops@tenure" })
    const resources = dump.data.Resource as { title: string }[]
    expect(resources.map((r) => r.title)).toEqual(["A's copy"])
  })

  it("gives B a different export from the same code", async () => {
    const a = await exportTenant(INST_A, `tenant-a-${SUFFIX}`, { at: AT, requestedBy: "ops@tenure" })
    const b = await exportTenant(INST_B, `tenant-b-${SUFFIX}`, { at: AT, requestedBy: "ops@tenure" })

    expect(b.counts.Organization).toBe(1)
    expect(a.counts.Organization).toBe(2)
    expect(a.checksum).not.toBe(b.checksum)
  })

  it("covers every model the chokepoint can enforce on", async () => {
    // A model added to TENANT_SCOPED without a reader here would be a silent
    // empty section in a customer's export.
    const dump = await exportTenant(INST_A, `tenant-a-${SUFFIX}`, { at: AT, requestedBy: "ops@tenure" })
    for (const model of TENANT_SCOPED) {
      expect(Object.prototype.hasOwnProperty.call(dump.data, model)).toBe(true)
      expect(Array.isArray(dump.data[model])).toBe(true)
    }
  })

  it("reports what it could not export, rather than omitting it", async () => {
    // An export that quietly excludes a table looks identical to one where the
    // table was empty.
    const dump = await exportTenant(INST_A, `tenant-a-${SUFFIX}`, { at: AT, requestedBy: "ops@tenure" })
    expect(dump.gaps.length).toBe(Object.keys(UNENFORCEABLE).length)
    for (const gap of dump.gaps) {
      expect(gap.reachableVia).toBeTruthy()
      expect(gap.reason).toMatch(/No tenant column/)
    }
  })

  it("counts what it exported", async () => {
    const dump = await exportTenant(INST_A, `tenant-a-${SUFFIX}`, { at: AT, requestedBy: "ops@tenure" })
    const summed = Object.values(dump.counts).reduce((a, b) => a + b, 0)
    expect(dump.totalRows).toBe(summed)
    expect(dump.totalRows).toBeGreaterThanOrEqual(3) // 2 orgs + 1 resource
  })
})

describe("an export is verifiable", () => {
  it("is stable across two exports of unchanged data", async () => {
    const one = await exportTenant(INST_A, `tenant-a-${SUFFIX}`, { at: AT, requestedBy: "ops@tenure" })
    const two = await exportTenant(INST_A, `tenant-a-${SUFFIX}`, { at: "2027-01-01T00:00:00Z", requestedBy: "someone-else" })
    // Same content, different timestamp and requester: the digest covers the
    // data, not the envelope.
    expect(two.checksum).toBe(one.checksum)
  })

  it("changes when the tenant's data changes", async () => {
    const before = await exportTenant(INST_A, `tenant-a-${SUFFIX}`, { at: AT, requestedBy: "ops@tenure" })

    // `async` and `await` inside, deliberately. A Prisma call is lazy — the
    // extension runs when the promise is awaited, not when it is built — so a
    // non-async callback returning `db.x.create(...)` executes AFTER
    // runUnscoped's AsyncLocalStorage scope has closed, and the chokepoint
    // correctly refuses it. It refused this exact line while it was written
    // that way.
    await runUnscoped("control-plane", "export test mutation", async () => {
      await db.organization.create({
        data: { institutionId: INST_A, name: "A's Third Club", slug: `a-three-${SUFFIX}` },
      })
    })

    const after = await exportTenant(INST_A, `tenant-a-${SUFFIX}`, { at: AT, requestedBy: "ops@tenure" })
    expect(after.checksum).not.toBe(before.checksum)
    expect(after.counts.Organization).toBe(3)

    await runUnscoped("migration", "export test mutation cleanup", async () => {
      await db.organization.deleteMany({ where: { slug: `a-three-${SUFFIX}` } })
    })
  })

  it("hashes by content, not by key order", () => {
    expect(checksumOfExport({ A: [{ b: 1, a: 2 }] })).toBe(checksumOfExport({ A: [{ a: 2, b: 1 }] }))
  })
})
