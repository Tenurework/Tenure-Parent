import { PrismaClient } from "@prisma/client"
import { tenancyExtension } from "./extension"
import { runInTenantScope, runUnscoped, TenantContextError, type TenantScope } from "./context"

/**
 * Tenant isolation, proved against a real PostgreSQL database.
 *
 * The unit tests prove the rule is correct. These prove the rule is actually
 * reached — that the extension is wired into the client, that Prisma accepts
 * the predicates it builds, and that a query which should return nothing
 * returns nothing. A filter that is right in principle and never applied looks
 * identical to one that works, in every test that does not touch a database.
 *
 * Run with: npm run test:isolation   (needs DATABASE_URL)
 */

// An enforcing client, regardless of how the app is currently configured.
const db = new PrismaClient({ log: ["error"] }).$extends(tenancyExtension("enforce"))

const SUFFIX = "itest-isolation"
const INST_A = `inst-a-${SUFFIX}`
const INST_B = `inst-b-${SUFFIX}`

const scopeA: TenantScope = {
  institutionId: INST_A,
  actor: { principalId: "user-a", principalType: "user" },
}
const scopeB: TenantScope = {
  institutionId: INST_B,
  actor: { principalId: "user-b", principalType: "user" },
}

/**
 * Create an Organization without naming a tenant.
 *
 * Prisma's generated types require `institutionId` because the relation is
 * mandatory, and the extension supplies it at runtime — so demonstrating the
 * runtime stamp means stepping around the compile-time requirement. The cast
 * is the subject of these tests, not a shortcut inside them.
 *
 * Worth being clear about what the stamp is and is not for: TypeScript callers
 * are already obliged to pass a value, so its value is in *overriding a wrong
 * one*, and in covering callers the type system never sees — the plain-JS
 * scripts under scripts/, and any future non-TypeScript consumer.
 */
type OrgCreateArgs = Parameters<typeof db.organization.create>[0]
const createOrg = (data: Record<string, unknown>) =>
  db.organization.create({ data } as unknown as OrgCreateArgs)

async function cleanup() {
  await runUnscoped("migration", "isolation test cleanup", async () => {
    await db.organization.deleteMany({ where: { institutionId: { in: [INST_A, INST_B] } } })
    await db.institution.deleteMany({ where: { id: { in: [INST_A, INST_B] } } })
  })
}

beforeAll(async () => {
  await cleanup()

  // Institution is platform-global, so creating tenants is legitimately
  // unscoped work — this is the control-plane path.
  await runUnscoped("control-plane", "isolation test fixture", async () => {
    await db.institution.createMany({
      data: [
        { id: INST_A, name: "Tenant A", slug: `tenant-a-${SUFFIX}` },
        { id: INST_B, name: "Tenant B", slug: `tenant-b-${SUFFIX}` },
      ],
    })
  })

  await runInTenantScope(scopeA, async () => {
    await createOrg({ name: "A's Club", slug: `a-club-${SUFFIX}` })
  })
  await runInTenantScope(scopeB, async () => {
    await createOrg({ name: "B's Club", slug: `b-club-${SUFFIX}` })
  })
})

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

describe("a write is stamped with the acting tenant", () => {
  it("assigns the row to the tenant that created it, without being told", () => {
    // The create above passed no institutionId at all.
    return runUnscoped("migration", "assert", async () => {
      const a = await db.organization.findFirst({ where: { slug: `a-club-${SUFFIX}` } })
      expect(a?.institutionId).toBe(INST_A)
    })
  })

  it("refuses to create into another tenant", async () => {
    await runInTenantScope(scopeA, async () => {
      await createOrg({ name: "Trojan", slug: `trojan-${SUFFIX}`, institutionId: INST_B })
    })

    await runUnscoped("migration", "assert", async () => {
      const row = await db.organization.findFirst({ where: { slug: `trojan-${SUFFIX}` } })
      // The caller asked for B. The acting tenant was A. A wins.
      expect(row?.institutionId).toBe(INST_A)
      await db.organization.deleteMany({ where: { slug: `trojan-${SUFFIX}` } })
    })
  })
})

describe("tenant A cannot read tenant B", () => {
  it("does not list B's rows", async () => {
    await runInTenantScope(scopeA, async () => {
      const all = await db.organization.findMany({
        where: { slug: { contains: SUFFIX } },
      })

      expect(all.map((o) => o.slug)).toEqual([`a-club-${SUFFIX}`])
    })
  })

  it("does not count B's rows", async () => {
    await runInTenantScope(scopeA, async () => {
      expect(await db.organization.count({ where: { slug: { contains: SUFFIX } } })).toBe(1)
    })
  })

  // The insecure-direct-object-reference case. `slug` is globally unique, so
  // this lookup succeeds for anyone holding the value unless it is filtered.
  it("does not return B's row from a by-unique-key lookup", async () => {
    await runInTenantScope(scopeA, async () => {
      const stolen = await db.organization.findUnique({ where: { slug: `b-club-${SUFFIX}` } })
      expect(stolen).toBeNull()
    })
  })

  it("does not return B's row when A supplies B's institutionId", async () => {
    await runInTenantScope(scopeA, async () => {
      const stolen = await db.organization.findMany({ where: { institutionId: INST_B } })
      expect(stolen).toEqual([])
    })
  })

  it("sees its own row through the same lookups", async () => {
    // Guards against the filter simply breaking every query, which would make
    // every assertion above pass for the wrong reason.
    await runInTenantScope(scopeA, async () => {
      expect(await db.organization.findUnique({ where: { slug: `a-club-${SUFFIX}` } })).not.toBeNull()
      expect(await db.organization.count({ where: { slug: { contains: SUFFIX } } })).toBe(1)
    })
  })
})

describe("tenant A cannot mutate tenant B", () => {
  it("cannot update B's row", async () => {
    await runInTenantScope(scopeA, async () => {
      const result = await db.organization.updateMany({
        where: { slug: `b-club-${SUFFIX}` },
        data: { name: "Owned by A" },
      })
      expect(result.count).toBe(0)
    })

    await runUnscoped("migration", "assert", async () => {
      const b = await db.organization.findFirst({ where: { slug: `b-club-${SUFFIX}` } })
      expect(b?.name).toBe("B's Club")
    })
  })

  it("cannot delete B's row", async () => {
    await runInTenantScope(scopeA, async () => {
      const result = await db.organization.deleteMany({ where: { slug: `b-club-${SUFFIX}` } })
      expect(result.count).toBe(0)
    })

    await runUnscoped("migration", "assert", async () => {
      expect(await db.organization.findFirst({ where: { slug: `b-club-${SUFFIX}` } })).not.toBeNull()
    })
  })
})

describe("failing closed", () => {
  it("refuses a scoped read with no tenant context at all", async () => {
    await expect(db.organization.findMany()).rejects.toThrow(TenantContextError)
  })

  it("refuses a scoped write with no tenant context at all", async () => {
    await expect(
      createOrg({ name: "Orphan", slug: `orphan-${SUFFIX}` }),
    ).rejects.toThrow(TenantContextError)
  })

  it("still allows platform-global models without a tenant", async () => {
    // Or nobody could authenticate: resolving identity precedes knowing a tenant.
    await expect(db.user.count()).resolves.toEqual(expect.any(Number))
  })

  it("allows the auth bootstrap to read a scoped model", async () => {
    await runUnscoped("auth-bootstrap", "getUserContext", async () => {
      await expect(db.institutionMembership.findMany({ take: 1 })).resolves.toBeDefined()
    })
  })
})

/**
 * The edge of the protection, asserted rather than described.
 *
 * 24 of 39 models have no column the query layer can filter on, so a scope does
 * NOT protect them. registry.ts names every one; this proves what that means at
 * runtime, because "documented in a comment" and "true of the running system"
 * are different claims and only one of them is testable.
 *
 * A caller reaching one of these models inside a scope must filter it itself,
 * through the relation registry.ts records in `reachableVia`. The reminders
 * cron is the worked example of getting that wrong: it was made per-tenant, but
 * its `roleAssignment` query kept returning every institution's board.
 */
describe("what a tenant scope does NOT protect", () => {
  it("does not filter a model with no tenant column", async () => {
    // RoleAssignment reaches its tenant only via Role -> Organization, which is
    // a join the extension cannot add. Inside tenant A's scope it still sees
    // rows belonging to every tenant.
    const [scoped, unscoped] = await Promise.all([
      runInTenantScope(scopeA, () => db.roleAssignment.count()),
      runUnscoped("migration", "assert", () => db.roleAssignment.count()),
    ])

    expect(scoped).toBe(unscoped)
  })

  it("is filtered once the caller supplies the relation predicate", async () => {
    // The remedy available today, and the shape every UNENFORCEABLE model needs
    // until institutionId is denormalised onto it.
    const leaked = await runInTenantScope(scopeA, () =>
      db.roleAssignment.count({
        where: { role: { organization: { institutionId: INST_A } } },
      }),
    )

    // Tenant A is a fixture with no seats, so a correctly filtered count is 0
    // while the unfiltered one above is the whole table.
    expect(leaked).toBe(0)
    expect(await runUnscoped("migration", "assert", () => db.roleAssignment.count())).toBeGreaterThan(0)
  })

  it("does not filter platform-global models either, by design", async () => {
    // Same observable behaviour, entirely different reason: User is global
    // because one person holds seats at more than one institution.
    const [scoped, unscoped] = await Promise.all([
      runInTenantScope(scopeA, () => db.user.count()),
      runUnscoped("migration", "assert", () => db.user.count()),
    ])

    expect(scoped).toBe(unscoped)
  })
})

describe("concurrent tenants do not bleed into each other", () => {
  it("keeps two interleaved operations separate", async () => {
    // Sequential code cannot catch a context that is shared rather than
    // per-async-chain; overlapping awaits can.
    const [aRows, bRows] = await Promise.all([
      runInTenantScope(scopeA, async () => {
        await new Promise((r) => setTimeout(r, 25))
        return db.organization.findMany({ where: { slug: { contains: SUFFIX } } })
      }),
      runInTenantScope(scopeB, async () => {
        await new Promise((r) => setTimeout(r, 1))
        return db.organization.findMany({ where: { slug: { contains: SUFFIX } } })
      }),
    ])

    expect(aRows.map((o) => o.slug)).toEqual([`a-club-${SUFFIX}`])
    expect(bRows.map((o) => o.slug)).toEqual([`b-club-${SUFFIX}`])
  })
})
