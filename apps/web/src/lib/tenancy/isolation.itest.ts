import { PrismaClient } from "@prisma/client"
import { tenancyExtension } from "./extension"
import { runInTenantScope, runUnscoped, TenantContextError, type TenantScope } from "./context"
// The APPLICATION's client, deliberately, and only for the transaction-guard
// block at the foot of this file. Everything above builds its own enforcing
// client because it is asserting on the extension; the guard is attached to
// this one, and a proof that ran against a hand-assembled client would show the
// guard works when somebody remembers to attach it.
import { db as appDb } from "@/lib/db"
import { viewerTimeZone } from "@/lib/institution-time"
import { withTenantScope } from "@/lib/tenant-scope"

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

/**
 * Two zones that are never the same wall clock, and never each other's default.
 *
 * `safeZone` collapses an unknown zone to `DEFAULT_TIME_ZONE`
 * (America/New_York), so neither of these may BE that default — otherwise "the
 * loader returned A's zone" and "the loader returned nothing and fell back"
 * would be the same string, and the cache assertions below would pass on a
 * lookup that had stopped working.
 */
const ZONE_A = "America/Chicago"
const ZONE_B = "Asia/Tokyo"

const scopeA: TenantScope = {
  institutionId: INST_A,
  purpose: "interactive",
  environment: "live",
  actor: { principalId: "user-a", principalType: "user" },
}
const scopeB: TenantScope = {
  institutionId: INST_B,
  purpose: "interactive",
  environment: "test",
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

const SEAT_HOLDER_EMAIL = `b-president-${SUFFIX}@example.test`
/** One person, a live OSE seat in BOTH tenants. See the cache describe below. */
const TWO_TENANT_EMAIL = `staffer-in-both-${SUFFIX}@example.test`
let twoTenantUserId = ""

async function cleanup() {
  await runUnscoped("migration", "isolation test cleanup", async () => {
    // Role cascades from Organization and RoleAssignment from Role, so deleting
    // the orgs takes the seat with them. InstitutionMembership cascades from
    // Institution. User is platform-global and hangs off neither, so it has to
    // be named.
    await db.organization.deleteMany({ where: { institutionId: { in: [INST_A, INST_B] } } })
    await db.institution.deleteMany({ where: { id: { in: [INST_A, INST_B] } } })
    await db.user.deleteMany({ where: { email: { in: [SEAT_HOLDER_EMAIL, TWO_TENANT_EMAIL] } } })
  })
}

beforeAll(async () => {
  await cleanup()

  // Institution is platform-global, so creating tenants is legitimately
  // unscoped work — this is the control-plane path.
  await runUnscoped("control-plane", "isolation test fixture", async () => {
    await db.institution.createMany({
      data: [
        {
          serving: true,
          id: INST_A,
          name: "Tenant A",
          slug: `tenant-a-${SUFFIX}`,
          timeZone: ZONE_A,
        },
        {
          serving: true,
          id: INST_B,
          name: "Tenant B",
          slug: `tenant-b-${SUFFIX}`,
          timeZone: ZONE_B,
        },
      ],
    })
  })

  await runInTenantScope(scopeA, async () => {
    await createOrg({ name: "A's Club", slug: `a-club-${SUFFIX}` })
  })
  await runInTenantScope(scopeB, async () => {
    await createOrg({ name: "B's Club", slug: `b-club-${SUFFIX}` })
  })

  // One seat, belonging to tenant B.
  //
  // The "does NOT protect" cases below are claims about a table that contains
  // another tenant's rows: that an unfiltered count sees them, and that adding
  // the relation predicate stops seeing them. Neither claim says anything about
  // an empty table — both pass trivially on one and prove nothing.
  //
  // Nothing else supplies that row. These run in CI against a database that was
  // created by `prisma migrate deploy` and never seeded, so a test that needs a
  // RoleAssignment to exist has to create it. Reading a precondition out of
  // ambient data is what made this suite fail on an empty database while passing
  // on a developer's seeded one.
  await runUnscoped("control-plane", "isolation test fixture", async () => {
    const orgB = await db.organization.findFirstOrThrow({
      where: { slug: `b-club-${SUFFIX}` },
      select: { id: true },
    })
    const holder = await db.user.create({
      data: { name: "B's President", email: SEAT_HOLDER_EMAIL },
    })
    const seat = await db.role.create({
      data: { organizationId: orgB.id, name: "President", scope: "PRESIDENT" },
    })
    await db.roleAssignment.create({
      data: { userId: holder.id, roleId: seat.id, status: "ACTIVE" },
    })

    // One person holding an OSE seat in both tenants. This is the shape the
    // cache invariant is about: `institutionCandidates` returns [A, B] for them,
    // so `withTenantScope` can legitimately open A and then B inside one
    // request, and any loader keyed on the person alone answers both with A.
    const staffer = await db.user.create({
      data: { name: "Staffer in both", email: TWO_TENANT_EMAIL },
    })
    twoTenantUserId = staffer.id
    await db.institutionMembership.createMany({
      data: [
        { userId: staffer.id, institutionId: INST_A, role: "OSE_STAFF" },
        { userId: staffer.id, institutionId: INST_B, role: "OSE_DIRECTOR" },
      ],
    })
  })
  // Jest's 5s default is a unit-test budget. This hook opens a Prisma engine,
  // runs a cleanup sweep and lays down two tenants, two clubs, three users, a
  // seat and two memberships — a dozen round trips before the first assertion.
  // On a loaded machine it went over 5s and every one of the 31 tests below
  // failed with a hook timeout, which reads exactly like a broken isolation
  // rule and is not one. The budget is generous on purpose: a slow fixture
  // should be slow, not red.
}, 120_000)

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
}, 120_000)

describe("a write is stamped with the acting tenant", () => {
  it("assigns the row to the tenant that created it, without being told", () => {
    // The create above passed no institutionId at all.
    return runUnscoped("migration", "assert", async () => {
      const a = await db.organization.findFirst({ where: { slug: `a-club-${SUFFIX}` } })
      expect(a?.institutionId).toBe(INST_A)
    })
  })

  it("refuses a create that names another tenant, rather than redirecting it", async () => {
    // Landing it in the acting tenant would be the quiet option and the wrong
    // one: the caller passed that institutionId for a reason, so overriding it
    // writes a row whose institutionId and relations point at different
    // tenants — and institutionId has no foreign key behind it to catch that.
    await runInTenantScope(scopeA, async () => {
      await expect(
        createOrg({ name: "Trojan", slug: `trojan-${SUFFIX}`, institutionId: INST_B }),
      ).rejects.toThrow(TenantContextError)
    })

    await runUnscoped("migration", "assert", async () => {
      // Nothing was written to either tenant.
      expect(await db.organization.findFirst({ where: { slug: `trojan-${SUFFIX}` } })).toBeNull()
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
    const [scoped, unscoped, tenantBsSeatSeenFromA] = await Promise.all([
      runInTenantScope(scopeA, () => db.roleAssignment.count()),
      runUnscoped("migration", "assert", () => db.roleAssignment.count()),
      // Naming the leak rather than inferring it from two equal numbers: tenant
      // A, inside its own scope, counts a seat that belongs to tenant B. Equal
      // totals would also hold if both counts were 0.
      runInTenantScope(scopeA, () =>
        db.roleAssignment.count({
          where: { role: { organization: { institutionId: INST_B } } },
        }),
      ),
    ])

    expect(scoped).toBe(unscoped)
    expect(tenantBsSeatSeenFromA).toBe(1)
  })

  it("is filtered once the caller supplies the relation predicate", async () => {
    // The remedy available today, and the shape every UNENFORCEABLE model needs
    // until institutionId is denormalised onto it.
    const leaked = await runInTenantScope(scopeA, () =>
      db.roleAssignment.count({
        where: { role: { organization: { institutionId: INST_A } } },
      }),
    )

    // Tenant A is a fixture with no seats and tenant B holds exactly one, so a
    // correctly filtered count is 0 while the unfiltered one above is the whole
    // table — including B's row, which is the point.
    expect(leaked).toBe(0)
    expect(await runUnscoped("migration", "assert", () => db.roleAssignment.count())).toBeGreaterThan(0)

    // `toBe(0)` above cannot distinguish a predicate that filters correctly from
    // one that matches nothing at all — both produce 0. So run the same query
    // for the tenant that *does* own the seat: it must find it. Without this,
    // a predicate that had been broken to always-empty would still pass.
    const foundByItsOwner = await runInTenantScope(scopeB, () =>
      db.roleAssignment.count({
        where: { role: { organization: { institutionId: INST_B } } },
      }),
    )
    expect(foundByItsOwner).toBe(1)
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

/**
 * A Prisma query is a lazy thenable, and that makes the callback's shape matter.
 *
 * `db.organization.findMany()` builds an object and runs nothing. The query —
 * and with it the extension that applies the tenant filter — starts when
 * somebody calls `.then`. Written as
 *
 *     runInTenantScope(scope, () => db.organization.findMany())
 *
 * that `.then` is the caller's `await`, which happens after `storage.run` has
 * returned and the context has closed. The extension found no scope and, in the
 * mode this application actually runs in, returned every tenant's rows.
 *
 * It type-checks, it reads as obviously correct, and until GE-042-006 nothing
 * caught it: the suite's other bare-shaped calls are all on models a scope does
 * not filter anyway, so they were true either way.
 */
describe("the tenant context does not depend on how the callback is written", () => {
  // Observe mode on purpose. Enforcing turns a lost context into a throw, which
  // is loud; observe turns it into another tenant's data, which is the failure
  // that would have shipped — apps/web runs in observe until the coverage
  // report is empty.
  const observing = new PrismaClient({ log: ["error"] }).$extends(tenancyExtension("observe"))

  afterAll(async () => {
    await observing.$disconnect()
  })

  // Both fixture orgs, one per tenant, so a scoped read has something to
  // exclude. Filtering by suffix keeps it independent of whatever else the
  // database holds.
  const bothTenantsOrgs = { where: { slug: { endsWith: SUFFIX } }, select: { slug: true } }

  it("filters a query returned bare from the callback", async () => {
    const rows = await runInTenantScope(scopeA, () => observing.organization.findMany(bothTenantsOrgs))
    expect(rows.map((o) => o.slug)).toEqual([`a-club-${SUFFIX}`])
  })

  it("filters it identically to the awaited idiom", async () => {
    // The control: the shape that always worked, so a fixture that stopped
    // producing two rows cannot make the test above pass for the wrong reason.
    const rows = await runInTenantScope(scopeA, async () => observing.organization.findMany(bothTenantsOrgs))
    expect(rows.map((o) => o.slug)).toEqual([`a-club-${SUFFIX}`])
  })

  it("really is excluding a row it can otherwise see", async () => {
    // Without this, `toEqual([a])` above would also hold if B's club had never
    // been created — an assertion about filtering, passing on nothing to filter.
    const rows = await runUnscoped("migration", "assert", async () =>
      observing.organization.findMany(bothTenantsOrgs),
    )
    expect(rows.map((o) => o.slug).sort()).toEqual([`a-club-${SUFFIX}`, `b-club-${SUFFIX}`])
  })

  it("carries an unscoped grant into a bare query too", async () => {
    // The other direction, and the one GE-042-006 depends on: `/me` reads
    // memberships before any tenant is known. Under enforcement a grant that
    // did not survive the return is indistinguishable from no grant at all, so
    // this would throw rather than leak — the auth-bootstrap path failing shut
    // for every user at the moment enforcement is switched on.
    await expect(
      runUnscoped("auth-bootstrap", "bare-shaped read", () =>
        db.organization.count({ where: { slug: { endsWith: SUFFIX } } }),
      ),
    ).resolves.toBe(2)
  })
})

/**
 * `docs/architecture/REVIEW-FINDINGS.md:54` — a `React.cache()` memo is per
 * REQUEST; a tenant scope is per BLOCK.
 *
 * The invariant is stated beside `runInTenantScope` and guarded lexically by
 * `tests/architecture/cache-does-not-cross-tenant-scopes.test.mjs`. Neither can
 * show what breaking it does, which is this: one person with a live seat in two
 * institutions, one process, two scopes — and a loader that answers the second
 * with the first's tenant.
 *
 * Asserted on `viewerTimeZone` because it is the production loader the calendar,
 * the new-event form and the feed all call (`app/(app)/calendar/page.tsx:62`,
 * `calendar/new/page.tsx:39`, `feed/page.tsx:41`), and it is the one that was
 * wrong: keyed on `userId` alone, resolving from `ctx.institutionRoles[0]`, and
 * reading TENANT_SCOPED `Organization`. Reverting either half — the key or the
 * `institutionRoles` filter — reds the first case here, because
 * `getUserContext` orders memberships by `institutionId` and A sorts before B,
 * so "the first membership" is A's zone in both scopes.
 *
 * Driven through `withTenantScope`, not `runInTenantScope`, on purpose: that is
 * the entry point the three pages use, so this exercises membership resolution,
 * the acting-institution choice and the money-mode lookup exactly as a request
 * does. A test that opened the scope by hand would prove the loader right about
 * a scope no page ever builds.
 */
describe("a cache()d loader answers for the tenant that is open, not the first one", () => {
  // These two are the only cases in this file that go through the APPLICATION's
  // client rather than the enforcing one built at the top — `withTenantScope`
  // and `viewerTimeZone` both import `@/lib/db` — so the first of them pays for
  // a second Prisma engine boot on top of a membership resolution and a
  // money-mode lookup. That is comfortably over jest's 5s default on a loaded
  // machine, and a timeout here reads as "the tenants bled into each other",
  // which is the one conclusion it does not support.
  const SLOW = 60_000

  const zoneIn = (institutionId: string) =>
    withTenantScope(twoTenantUserId, (scope) => viewerTimeZone(twoTenantUserId, scope.institutionId), {
      institutionId,
    })

  it("gives each tenant its own zone, in one process, for one user", async () => {
    // Sequential and in this order deliberately: A first is what makes a memo
    // keyed on the user alone hold A's answer when B asks.
    const inA = await zoneIn(INST_A)
    const inB = await zoneIn(INST_B)

    expect(inA).toBe(ZONE_A)
    expect(inB).toBe(ZONE_B)
    // Stated separately so the failure message says "both tenants got one
    // zone", which is the defect, rather than only which constant mismatched.
    expect(inB).not.toBe(inA)
  }, SLOW)

  it(
    "gives the same tenant the same zone whichever scope was opened first",
    async () => {
      // The control. `toBe(ZONE_B)` above would also hold if the loader ignored
      // its arguments and read the innermost open scope directly — which would be
      // correct here and wrong the moment a caller passes an institution it
      // resolved itself. Asking for B first must not change B's answer.
      expect(await zoneIn(INST_B)).toBe(ZONE_B)
      expect(await zoneIn(INST_A)).toBe(ZONE_A)
    },
    SLOW,
  )

  it("really is reading the seeded zones, not falling back to the default", async () => {
    // `safeZone` answers DEFAULT_TIME_ZONE for an institution it cannot find, so
    // an assertion that only compared two strings would also pass if the lookup
    // had broken in a way that returned one fallback and one real zone. Neither
    // fixture zone is the default, and the rows say so.
    const rows = await runUnscoped("migration", "assert", async () =>
      db.institution.findMany({
        where: { id: { in: [INST_A, INST_B] } },
        orderBy: { id: "asc" },
        select: { id: true, timeZone: true },
      }),
    )
    expect(rows.map((r) => r.timeZone)).toEqual([ZONE_A, ZONE_B])
  })
})
/**
 * REVIEW-FINDINGS #16, proved rather than described.
 *
 * The claim `guardedTransaction` (src/lib/db.ts) makes is that a Next.js
 * navigation thrown out of a `db.$transaction` callback has already destroyed
 * that callback's writes, so the honest response is a loud failure rather than a
 * successful navigation. Both halves of that sentence are assertions about
 * PostgreSQL, and neither is checkable without one: a unit test against a fake
 * client would "roll back" whatever the fake decided to.
 *
 * These run against the APPLICATION's client — `@/lib/db`, the one every server
 * action calls — not the enforcing client the rest of this file builds.
 */
describe("a Next.js navigation thrown inside a transaction", () => {
  const REDIRECT_DIGEST = "NEXT_REDIRECT;replace;/feed;307;"

  /** An error shaped exactly as `redirect()` throws one. */
  function navigationThrow(digest = REDIRECT_DIGEST) {
    const error = new Error("NEXT_REDIRECT") as Error & { digest: string }
    error.digest = digest
    return error
  }

  const postsHere = () =>
    runUnscoped("migration", "assert", () =>
      appDb.feedPost.count({ where: { title: { startsWith: `${SUFFIX}-tx` } } }),
    )

  const postData = (title: string) => ({
    institutionId: INST_A,
    organizationId,
    authorId: `author-${SUFFIX}`,
    title: `${SUFFIX}-tx-${title}`,
    body: "written inside the transaction",
  })

  /** The club every post below is written against, resolved once. */
  let organizationId = ""

  beforeAll(async () => {
    organizationId = (
      await runUnscoped("migration", "isolation test fixture", () =>
        appDb.organization.findFirstOrThrow({
          where: { slug: `a-club-${SUFFIX}` },
          select: { id: true },
        }),
      )
    ).id
  })

  afterEach(async () => {
    await runUnscoped("migration", "isolation test cleanup", () =>
      appDb.feedPost.deleteMany({ where: { title: { startsWith: `${SUFFIX}-tx` } } }),
    )
  })

  it("commits the same writes when nothing throws", async () => {
    // The control, and it is not optional: every assertion below is "the row is
    // absent", which is equally what a transaction that never ran, a fixture
    // that never resolved and a filter matching nothing all look like.
    await runInTenantScope(scopeA, () =>
      appDb.$transaction(async (tx) => {
        await tx.feedPost.create({ data: postData("committed") })
      }),
    )

    expect(await postsHere()).toBe(1)
  })

  it("rolls the whole callback back", async () => {
    // The defect #16 names. The write happens, the redirect throws, Prisma
    // aborts — so without the guard the browser follows a 307 to a feed with no
    // post in it, having been told the post was created.
    await expect(
      runInTenantScope(scopeA, () =>
        appDb.$transaction(async (tx) => {
          await tx.feedPost.create({ data: postData("rolled-back") })
          throw navigationThrow()
        }),
      ),
    ).rejects.toThrow()

    expect(await postsHere()).toBe(0)
  })

  it("is refused loudly rather than answered with a navigation", async () => {
    // What the guard changes. Without it the caller receives the NEXT_REDIRECT
    // untouched, Next answers 307 at the request boundary, and the loss is
    // invisible; with it the request fails and names the rule. The message is
    // asserted because an error that does not say what to do instead is a 500
    // somebody eventually "fixes" by catching it.
    const failure = await runInTenantScope(scopeA, () =>
      appDb
        .$transaction(async (tx) => {
          await tx.feedPost.create({ data: postData("refused") })
          throw navigationThrow()
        })
        .then(
          () => null,
          (err: unknown) => err,
        ),
    )

    expect(failure).toBeInstanceOf(TenantContextError)
    expect((failure as Error).message).toContain(REDIRECT_DIGEST)
    expect((failure as Error).message).toContain("rolled back")
    // The digest must NOT survive. If it did, Next would still catch it at the
    // request boundary and answer 307, and the guard would have changed nothing
    // a user or an on-call engineer could observe.
    expect((failure as { digest?: unknown }).digest).toBeUndefined()
    expect(await postsHere()).toBe(0)
  })

  it("refuses notFound() too, which the scope guard deliberately permits", async () => {
    // The gap between the two boundaries, asserted so it cannot close by
    // accident. `runInTenantScope` lets a notFound() through on purpose — a page
    // read raising a 404 has nothing in flight. Inside a transaction it aborts
    // exactly like a redirect, so here it is refused.
    const failure = await runInTenantScope(scopeA, () =>
      appDb
        .$transaction(async (tx) => {
          await tx.feedPost.create({ data: postData("notfound") })
          throw navigationThrow("NEXT_HTTP_ERROR_FALLBACK;404")
        })
        .then(
          () => null,
          (err: unknown) => err,
        ),
    )

    expect(failure).toBeInstanceOf(TenantContextError)
    expect(await postsHere()).toBe(0)
  })

  it("lets an ordinary failure through unchanged", async () => {
    // Otherwise the guard is a catch-all that renames every transaction error,
    // and a unique-constraint violation — the one an operator most needs to read
    // verbatim — arrives as a lecture about redirects.
    await expect(
      runInTenantScope(scopeA, () =>
        appDb.$transaction(async () => {
          throw new Error("a perfectly ordinary failure")
        }),
      ),
    ).rejects.toThrow("a perfectly ordinary failure")
  })

  it("leaves the client's other methods reachable through the wrapper", async () => {
    // `db` is a Proxy intercepting one property. If that forwarding broke, every
    // query in the application would break with it — so it is asserted here,
    // where it is cheap, rather than discovered where it is not.
    expect(await runInTenantScope(scopeA, () => appDb.organization.count())).toBe(1)
    expect(await runUnscoped("migration", "assert", () => appDb.user.count())).toBeGreaterThan(0)
  })

  it("guards the array form as well as the callback form", async () => {
    // `db.$transaction([...])` is the shape half this codebase writes in, and it
    // reaches the wrapper by a different path: the operations are built before
    // the call, so the returned promise is the only place a failure can surface.
    // Two rows share a primary key, so PostgreSQL aborts the batch and the first
    // insert must vanish with it.
    await expect(
      runInTenantScope(scopeA, () =>
        appDb.$transaction([
          appDb.feedPost.create({ data: postData("array-first") }),
          appDb.feedPost.create({ data: { id: `fixed-${SUFFIX}`, ...postData("array-second") } }),
          appDb.feedPost.create({ data: { id: `fixed-${SUFFIX}`, ...postData("array-third") } }),
        ]),
      ),
    ).rejects.toThrow()

    expect(await postsHere()).toBe(0)
  })
})
