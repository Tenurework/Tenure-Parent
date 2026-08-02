import { PrismaClient } from "@prisma/client"

import { membershipLiveness } from "@tenure/identity"

import { isLive, liveMembershipWhere, toEngineMembership } from "./live-membership"

/**
 * GE-040-001 — the SQL filter and the engine must agree, against a real database.
 *
 * `liveMembershipWhere` restates `membershipLiveness` as a Prisma `where`,
 * because asking Postgres for every membership row so that nine call sites can
 * filter nine of them in JavaScript is not a real option. That is a genuine
 * second definition of the same rule, and a second definition drifts.
 *
 * What makes it safe is this file: both are run over the same fixtures and the
 * results compared row by row. A boundary condition either satisfies both or
 * fails here — in particular the half-open window, where SQL's `gt` and the
 * engine's `>=` have to line up exactly or a membership is live in the roster
 * and dead in the permission check for one instant, which is the kind of bug
 * nobody reproduces.
 *
 * An integration test (`.itest.ts`), so it runs against the real Postgres the
 * e2e suite uses rather than a mock that would agree with whatever we wrote.
 */

const db = new PrismaClient()

const AT = new Date("2026-08-02T12:00:00Z")
const hours = (n: number) => new Date(AT.getTime() + n * 3_600_000)
const days = (n: number) => new Date(AT.getTime() + n * 86_400_000)

/** Distinct per run: this suite writes rows and is not idempotent. */
const RUN = Date.now().toString(36)
const institutionId = `inst-live-${RUN}`

interface Fixture {
  label: string
  status: "ACTIVE" | "SUSPENDED" | "REVOKED"
  effectiveFrom: Date
  effectiveUntil: Date | null
  expectLive: boolean
}

const FIXTURES: Fixture[] = [
  { label: "active, open-ended", status: "ACTIVE", effectiveFrom: days(-30), effectiveUntil: null, expectLive: true },
  { label: "active, window open", status: "ACTIVE", effectiveFrom: days(-30), effectiveUntil: days(30), expectLive: true },
  { label: "active, window closed", status: "ACTIVE", effectiveFrom: days(-30), effectiveUntil: hours(-1), expectLive: false },
  { label: "active, not yet started", status: "ACTIVE", effectiveFrom: days(1), effectiveUntil: null, expectLive: false },
  { label: "suspended", status: "SUSPENDED", effectiveFrom: days(-30), effectiveUntil: null, expectLive: false },
  { label: "revoked", status: "REVOKED", effectiveFrom: days(-30), effectiveUntil: hours(-1), expectLive: false },
  // The boundary. Half-open on both sides: an interval ending exactly at `AT`
  // is over, and one starting exactly at `AT` has begun. Get these two wrong in
  // opposite directions and a handover leaves either a gap or an overlap.
  { label: "ends exactly now", status: "ACTIVE", effectiveFrom: days(-30), effectiveUntil: AT, expectLive: false },
  { label: "starts exactly now", status: "ACTIVE", effectiveFrom: AT, effectiveUntil: null, expectLive: true },
]

describe("the SQL filter and the engine agree", () => {
  const created: string[] = []

  beforeAll(async () => {
    await db.institution.create({
      data: { id: institutionId, name: `Live fixture ${RUN}`, slug: institutionId },
    })
    for (const [index, fixture] of FIXTURES.entries()) {
      const user = await db.user.create({
        data: { id: `user-live-${RUN}-${index}`, name: fixture.label, email: `live-${RUN}-${index}@example.invalid` },
      })
      const membership = await db.institutionMembership.create({
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
      created.push(membership.id)
    }
  })

  afterAll(async () => {
    await db.institutionMembership.deleteMany({ where: { institutionId } })
    await db.user.deleteMany({ where: { id: { startsWith: `user-live-${RUN}-` } } })
    await db.institution.deleteMany({ where: { id: institutionId } })
    await db.$disconnect()
  })

  it("selects exactly the rows the fixtures say are live", async () => {
    const rows = await db.institutionMembership.findMany({
      where: { ...liveMembershipWhere(AT), institutionId },
      include: { user: { select: { name: true } } },
    })
    const selected = rows.map((row) => row.user.name).sort()
    const expected = FIXTURES.filter((f) => f.expectLive).map((f) => f.label).sort()
    expect(selected).toEqual(expected)
  })

  it("agrees with the engine on every row, including the boundaries", async () => {
    // The assertion that makes the second definition safe. Read every row
    // unfiltered, ask both, and compare.
    const all = await db.institutionMembership.findMany({ where: { institutionId } })
    const liveIds = new Set(
      (await db.institutionMembership.findMany({
        where: { ...liveMembershipWhere(AT), institutionId },
        select: { id: true },
      })).map((row) => row.id),
    )

    for (const row of all) {
      const engine = membershipLiveness(toEngineMembership(row), AT)
      expect({ id: row.id, sql: liveIds.has(row.id) }).toEqual({ id: row.id, sql: engine.live })
      // And the convenience wrapper agrees with the engine it wraps.
      expect(isLive(row, AT)).toBe(engine.live)
    }

    expect(all.length).toBe(FIXTURES.length)
  })
})
