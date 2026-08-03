import { db } from "@/lib/db"
import { runUnscoped } from "@/lib/tenancy/context"

import { accessReportFor } from "./access-report"

/**
 * GE-042-006 — `/me` can tell a suspended director from a brand-new account.
 *
 * `accessState` decides this and is unit-tested. What that does not prove is
 * the part that made the bug possible in the first place: that the *route*
 * reads memberships which are not live. Every other membership read in this
 * application is filtered to live rows — correctly, and enforced by
 * `tests/architecture/live-membership.test.mjs` — and a `/me` that inherited
 * that filter would see nothing for a suspended person and report
 * `NEVER_PLACED`, which is precisely the lie the state exists to end.
 *
 * So this drives `accessReportFor` — the function the route calls, not a copy
 * of its query — against real Postgres, over rows in each state. A regression
 * that adds the live filter back fails here rather than shipping a welcome
 * screen to somebody who was suspended.
 */

const RUN = Date.now().toString(36)
const institutionId = `inst-access-${RUN}`

const days = (n: number) => new Date(Date.now() + n * 86_400_000)

interface Fixture {
  key: string
  status: "ACTIVE" | "SUSPENDED" | "REVOKED"
  effectiveFrom: Date
  effectiveUntil: Date | null
  expected: string
}

const FIXTURES: Fixture[] = [
  { key: "live", status: "ACTIVE", effectiveFrom: days(-30), effectiveUntil: null, expected: "ACTIVE" },
  { key: "suspended", status: "SUSPENDED", effectiveFrom: days(-30), effectiveUntil: null, expected: "SUSPENDED" },
  { key: "revoked", status: "REVOKED", effectiveFrom: days(-30), effectiveUntil: days(-1), expected: "REVOKED" },
  { key: "ended", status: "ACTIVE", effectiveFrom: days(-30), effectiveUntil: days(-1), expected: "ENDED" },
  { key: "future", status: "ACTIVE", effectiveFrom: days(7), effectiveUntil: null, expected: "NOT_YET_STARTED" },
]

const stateFor = (userId: string) => accessReportFor(userId)

describe("the access state a person is actually told", () => {
  beforeAll(async () => {
    await runUnscoped("seed", "access-state fixtures", async () => {
      await db.institution.create({
        data: { id: institutionId, name: `Access fixture ${RUN}`, slug: institutionId },
      })
      for (const fixture of FIXTURES) {
        const user = await db.user.create({
          data: {
            id: `user-access-${RUN}-${fixture.key}`,
            name: fixture.key,
            email: `access-${RUN}-${fixture.key}@example.invalid`,
          },
        })
        await db.institutionMembership.create({
          data: {
            userId: user.id,
            institutionId,
            role: "OSE_STAFF",
            status: fixture.status,
            effectiveFrom: fixture.effectiveFrom,
            effectiveUntil: fixture.effectiveUntil,
            statusReason: fixture.status === "ACTIVE" ? null : "fixture",
          },
        })
      }
      // A person with no membership at all — the only one that should ever see
      // the onboarding path.
      await db.user.create({
        data: {
          id: `user-access-${RUN}-unplaced`,
          name: "unplaced",
          email: `access-${RUN}-unplaced@example.invalid`,
        },
      })

      // A club member: a live seat and NO institution membership. The most
      // common shape in this application and the one missing from these
      // fixtures, which is why every test here passed while `/api/me` told
      // every club member they were not a member of any organization yet.
      const seatHolder = await db.user.create({
        data: {
          id: `user-access-${RUN}-seat`,
          name: "seat holder",
          email: `access-${RUN}-seat@example.invalid`,
        },
      })
      await db.organization.create({
        data: {
          id: `org-access-${RUN}`,
          institutionId,
          name: `Access fixture club ${RUN}`,
          slug: `access-club-${RUN}`,
          category: "PROFESSIONAL",
          roles: {
            create: {
              name: "President",
              scope: "PRESIDENT",
              assignments: { create: { userId: seatHolder.id, status: "ACTIVE" } },
            },
          },
        },
      })
    })
  })

  afterAll(async () => {
    await runUnscoped("seed", "access-state teardown", async () => {
      await db.institutionMembership.deleteMany({ where: { institutionId } })
      // Role cascades from Organization and RoleAssignment from Role, so
      // deleting the club takes the seat with it — and the seat has to go
      // before its holder, which the User delete below would otherwise trip on.
      await db.organization.deleteMany({ where: { institutionId } })
      await db.user.deleteMany({ where: { id: { startsWith: `user-access-${RUN}-` } } })
      await db.institution.deleteMany({ where: { id: institutionId } })
    })
  })

  it.each(FIXTURES.map((f) => [f.key, f.expected] as const))(
    "reports %s as %s",
    async (key, expected) => {
      const report = await stateFor(`user-access-${RUN}-${key}`)
      expect(report.state).toBe(expected)
    },
  )

  it("reports an account with no membership as never placed", async () => {
    const report = await stateFor(`user-access-${RUN}-unplaced`)
    expect(report.state).toBe("NEVER_PLACED")
  })

  it("does not tell a suspended person they are new", async () => {
    // The whole point, stated as its own assertion because it is the sentence
    // that was wrong: a suspended director and a brand-new account must not
    // receive the same answer.
    const suspended = await stateFor(`user-access-${RUN}-suspended`)
    const unplaced = await stateFor(`user-access-${RUN}-unplaced`)

    expect(suspended.state).not.toBe(unplaced.state)
    expect(suspended.detail).not.toBe(unplaced.detail)
  })

  it("gives everyone without access something to do about it", async () => {
    for (const key of ["suspended", "revoked", "ended", "future", "unplaced"]) {
      const report = await stateFor(`user-access-${RUN}-${key}`)
      expect(report.state).not.toBe("ACTIVE")
      expect(report.detail.length).toBeGreaterThan(20)
    }
  })

  it("reports a club member with a seat and no membership as ACTIVE", async () => {
    // The regression this file shipped. Every fixture above creates an
    // InstitutionMembership, and most people in this application have none —
    // they hold a seat in one student organization, which is how
    // `institutionCandidates` has always resolved their acting tenant. Reading
    // memberships alone told all of them "you are not a member of any
    // organization yet", on a page showing their own organization.
    const report = await stateFor(`user-access-${RUN}-seat`)
    expect(report.state).toBe("ACTIVE")
  })

  it("still tells a seatless account it has never been placed", async () => {
    // So the fix cannot be "report ACTIVE for everybody": the onboarding path
    // has to stay reachable by the account that genuinely needs it.
    const report = await stateFor(`user-access-${RUN}-unplaced`)
    expect(report.state).toBe("NEVER_PLACED")
  })
})
