import type { OrgRole, UserContext } from "@/lib/rbac"

/**
 * `viewerTimeZone` resolves the tenant it is TOLD about, not the first one the
 * viewer belongs to — `docs/architecture/REVIEW-FINDINGS.md:54`.
 *
 * The behavioural proof against a real database is
 * `src/lib/tenancy/isolation.itest.ts`. This file is the cheap half, and it is
 * here for the branch the itest cannot reach without a second fixture: the club
 * officer with no OSE membership, whose zone is read THROUGH an `Organization`
 * — the TENANT_SCOPED model that made the old, `userId`-keyed version a
 * cross-tenant leak in the first place.
 *
 * ## The fake behaves like Prisma, or it proves nothing
 *
 * A stub that returns a canned row would pass whatever `viewerTimeZone` did with
 * its arguments, including ignoring them. So `organization.findFirst` below
 * really applies `where.id.in`, really applies `where.institutionId`, and really
 * sorts by `orderBy.id` — those three are the whole subject. If the loader stops
 * filtering by the acting institution, this fake hands back the other tenant's
 * club exactly as Postgres would.
 */

type OrgRow = { id: string; institutionId: string }

const INST_A = "inst_a"
const INST_B = "inst_b"
const ZONE_A = "America/Chicago"
const ZONE_B = "Asia/Tokyo"

const ZONES: Record<string, string> = { [INST_A]: ZONE_A, [INST_B]: ZONE_B }

/** A's club sorts first, so "the first org" and "this tenant's org" differ. */
const ORGS: OrgRow[] = [
  { id: "org_a", institutionId: INST_A },
  { id: "org_b", institutionId: INST_B },
]

let context: UserContext
/** Every institution the loader looked up, in order. Asserted on below. */
const institutionLookups: string[] = []

jest.mock("@/lib/db", () => ({
  db: {
    institution: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        institutionLookups.push(where.id)
        const timeZone = ZONES[where.id]
        return timeZone ? { timeZone } : null
      },
    },
    organization: {
      findFirst: async ({
        where,
        orderBy,
      }: {
        where: { id: { in: string[] }; institutionId?: string }
        orderBy?: { id: "asc" | "desc" }
      }) => {
        const matches = ORGS.filter(
          (o) =>
            where.id.in.includes(o.id) &&
            (where.institutionId === undefined || o.institutionId === where.institutionId),
        ).sort((x, y) => (orderBy?.id === "desc" ? y.id.localeCompare(x.id) : x.id.localeCompare(y.id)))

        const first = matches[0]
        if (!first) return null
        // Prisma resolves the nested select through the relation, so the zone a
        // caller sees is the zone of the institution behind the org it matched.
        return { institution: { timeZone: ZONES[first.institutionId] } }
      },
    },
  },
}))

jest.mock("@/lib/rbac", () => ({
  getUserContext: async () => context,
}))

import { viewerTimeZone } from "./institution-time"
import { DEFAULT_TIME_ZONE } from "./time"

const ctx = (over: Partial<UserContext>): UserContext =>
  ({
    userId: "u_viewer",
    institutionRoles: [],
    orgRoles: [],
    ...over,
  }) as UserContext

/** Memberships arrive from `getUserContext` ordered by institutionId. */
const memberOf = (...institutionIds: string[]) =>
  institutionIds.map((institutionId) => ({ institutionId, role: "OSE_STAFF" }))

const seatIn = (organizationId: string): OrgRole => ({
  organizationId,
  roleId: `role_${organizationId}`,
  roleName: "President",
  scope: "PRESIDENT",
  status: "ACTIVE",
  templateKey: "club.president",
})

beforeEach(() => {
  institutionLookups.length = 0
})

describe("an OSE staffer with a seat in two institutions", () => {
  beforeEach(() => {
    context = ctx({ institutionRoles: memberOf(INST_A, INST_B) as UserContext["institutionRoles"] })
  })

  it("renders the tenant it was given, not the first one they belong to", async () => {
    expect(await viewerTimeZone("u_viewer", INST_B)).toBe(ZONE_B)
    // The control, and the one that made the bug invisible: A is `institutionRoles[0]`,
    // so a loader resolving from the viewer instead of the scope is right here and
    // wrong above. Asserting only this would pass on the broken version.
    expect(await viewerTimeZone("u_viewer", INST_A)).toBe(ZONE_A)
  })

  it("looks the acting institution up directly, without consulting the club table", async () => {
    await viewerTimeZone("u_viewer", INST_B)
    expect(institutionLookups).toEqual([INST_B])
  })
})

describe("a club officer with no OSE membership", () => {
  it("resolves through the club they hold in the acting tenant", async () => {
    // Seats in BOTH tenants. `orderBy: { id: "asc" }` puts org_a first, so a
    // query that forgot to filter by the acting institution returns A's club and
    // A's zone — which is what the old code did.
    context = ctx({ orgRoles: [seatIn("org_a"), seatIn("org_b")] })

    expect(await viewerTimeZone("u_viewer", INST_B)).toBe(ZONE_B)
    expect(await viewerTimeZone("u_viewer", INST_A)).toBe(ZONE_A)
  })

  it("falls back to the acting tenant's own zone when they hold no club there", async () => {
    // A seat in A only, acting in B. The honest answer is B's zone — never A's,
    // which is the value the memo used to be carrying across the boundary.
    context = ctx({ orgRoles: [seatIn("org_a")] })

    const zone = await viewerTimeZone("u_viewer", INST_B)
    expect(zone).toBe(ZONE_B)
    expect(zone).not.toBe(ZONE_A)
  })
})

describe("a viewer with no affiliation at all", () => {
  it("gets the platform default rather than somebody else's clock", async () => {
    context = ctx({})
    expect(await viewerTimeZone("u_viewer", INST_A)).toBe(DEFAULT_TIME_ZONE)
    // Nothing was looked up: there is no membership and no seat to resolve
    // through, so the loader must not go fishing for an institution.
    expect(institutionLookups).toEqual([])
  })
})

describe("the fake is not answering for the code under test", () => {
  it("filters by institution and by id, the way the query does", async () => {
    // Asserted on the fake itself, because a fake that ignores its `where` makes
    // every case above pass regardless of what the loader asks for — the exact
    // shape of a test that proves nothing.
    const { db } = jest.requireMock<{
      db: {
        organization: {
          findFirst: (args: {
            where: { id: { in: string[] }; institutionId?: string }
            orderBy?: { id: "asc" | "desc" }
          }) => Promise<{ institution: { timeZone: string } } | null>
        }
      }
    }>("@/lib/db")

    const both = { id: { in: ["org_a", "org_b"] } }
    expect(await db.organization.findFirst({ where: both, orderBy: { id: "asc" } })).toEqual({
      institution: { timeZone: ZONE_A },
    })
    expect(
      await db.organization.findFirst({ where: { ...both, institutionId: INST_B }, orderBy: { id: "asc" } }),
    ).toEqual({ institution: { timeZone: ZONE_B } })
    expect(
      await db.organization.findFirst({ where: { id: { in: ["org_a"] }, institutionId: INST_B } }),
    ).toBeNull()
  })
})
