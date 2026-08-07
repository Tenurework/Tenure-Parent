import { PrismaClient } from "@prisma/client"

import { tenancyExtension } from "@/lib/tenancy/extension"
import { runUnscoped } from "@/lib/tenancy/context"
import { POST } from "@/app/api/jobs/reminders/route"

/**
 * Job and notification isolation, proved across two tenants.
 *
 * §9.8 of the build directive asks for isolation to hold for jobs and for
 * notifications. This is the case where getting it wrong is least visible and
 * most damaging: a cron has no session, so there is no signed-in user whose
 * tenant bounds the query, and the failure — one institution's deadlines mailed
 * to another institution's officers — surfaces as an email somebody outside the
 * tenant receives, not as an error anyone sees.
 *
 * The route already handles this carefully: it runs `forEachInstitution` and
 * writes the `RoleAssignment` predicate out by hand, because that model reaches
 * its tenant only through Role → Organization, a join the query extension cannot
 * add. The comment there says so. This is the test that the comment is true.
 *
 * Two institutions, each with a deliverable due inside the 24-hour window and an
 * officer holding the same seat, and the assertion that each officer is notified
 * exactly once about their own institution's deadline and never about the other's.
 *
 * Run with: npm run test:isolation   (needs DATABASE_URL)
 */

const db = new PrismaClient({ log: ["error"] }).$extends(tenancyExtension("enforce"))

const SUFFIX = "itest-reminders"
const INST_A = `inst-a-${SUFFIX}`
const INST_B = `inst-b-${SUFFIX}`
const USER_A = `user-a-${SUFFIX}`
const USER_B = `user-b-${SUFFIX}`
const KEY_A = `deliverable-a-${SUFFIX}`
const KEY_B = `deliverable-b-${SUFFIX}`

const JOB_SECRET = "itest-reminders-secret"

/** Inside the job's 24-hour window, whenever the suite happens to run. */
const dueSoon = () => new Date(Date.now() + 6 * 60 * 60 * 1000)

async function cleanup() {
  await runUnscoped("migration", "reminders isolation cleanup", async () => {
    await db.deliverable.deleteMany({ where: { key: { in: [KEY_A, KEY_B] } } })
    await db.organization.deleteMany({ where: { institutionId: { in: [INST_A, INST_B] } } })
    await db.institution.deleteMany({ where: { id: { in: [INST_A, INST_B] } } })
    await db.user.deleteMany({ where: { id: { in: [USER_A, USER_B] } } })
  })
}

beforeAll(async () => {
  process.env.JOB_SECRET = JOB_SECRET
  await cleanup()

  await runUnscoped("control-plane", "reminders isolation fixture", async () => {
    await db.institution.createMany({
      data: [
        { serving: true, id: INST_A, name: "Tenant A", slug: `tenant-a-${SUFFIX}` },
        { serving: true, id: INST_B, name: "Tenant B", slug: `tenant-b-${SUFFIX}` },
      ],
    })
    await db.user.createMany({
      data: [
        { id: USER_A, name: "A's President", email: `${USER_A}@example.test` },
        { id: USER_B, name: "B's President", email: `${USER_B}@example.test` },
      ],
    })

    for (const [inst, user, key, label] of [
      [INST_A, USER_A, KEY_A, "A"],
      [INST_B, USER_B, KEY_B, "B"],
    ] as const) {
      const org = await db.organization.create({
        data: { institutionId: inst, name: `${label}'s Club`, slug: `${label.toLowerCase()}-club-${SUFFIX}` },
      })
      const role = await db.role.create({
        data: { organizationId: org.id, name: "President", scope: "PRESIDENT" },
      })
      await db.roleAssignment.create({ data: { userId: user, roleId: role.id, status: "ACTIVE" } })
      await db.deliverable.create({
        data: {
          institutionId: inst,
          key,
          // The same seat in both tenants, so a leak cannot be explained away
          // as a seat mismatch.
          seat: "PRESIDENT",
          title: `${label}: quarterly filing`,
          dueAt: dueSoon(),
        },
      })
    }
  })
})

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

const runJob = () =>
  POST(
    new Request("http://localhost/api/jobs/reminders", {
      method: "POST",
      headers: { authorization: `Bearer ${JOB_SECRET}` },
    }),
  )

async function notificationsFor(userId: string) {
  return runUnscoped("migration", "reminders isolation assert", () =>
    db.notification.findMany({ where: { userId }, select: { title: true } }),
  )
}

describe("a cron with no session still stays inside each tenant", () => {
  it("notifies each institution's officer about their own deadline only", async () => {
    const res = await runJob()
    expect(res.status).toBe(200)

    const [aNotes, bNotes] = await Promise.all([notificationsFor(USER_A), notificationsFor(USER_B)])

    // Each got their own.
    expect(aNotes.some((n) => n.title.includes("A: quarterly filing"))).toBe(true)
    expect(bNotes.some((n) => n.title.includes("B: quarterly filing"))).toBe(true)

    // And neither got the other's. This is the failure the hand-written
    // RoleAssignment predicate in the route exists to prevent: without it the
    // open scope filters the deliverables and not the people, so A's deadline
    // reaches B's officers.
    expect(aNotes.some((n) => n.title.includes("B: quarterly filing"))).toBe(false)
    expect(bNotes.some((n) => n.title.includes("A: quarterly filing"))).toBe(false)
  })

  it("is idempotent — a retry does not notify anyone twice", async () => {
    // A schedule that fires twice, an ALB retry, or two tasks running the same
    // invocation must not double-notify. The DeliverableReminder row per
    // (deliverable, user) is what makes that true.
    const before = (await notificationsFor(USER_A)).length

    await runJob()
    await runJob()

    expect((await notificationsFor(USER_A)).length).toBe(before)
  })

  it("refuses an unauthenticated invocation", async () => {
    const res = await POST(
      new Request("http://localhost/api/jobs/reminders", { method: "POST" }),
    )
    expect(res.status).toBe(401)
  })

  it("refuses a wrong secret", async () => {
    const res = await POST(
      new Request("http://localhost/api/jobs/reminders", {
        method: "POST",
        headers: { authorization: "Bearer not-the-secret" },
      }),
    )
    expect(res.status).toBe(401)
  })
})
