import { Prisma, PrismaClient } from "@prisma/client"

import { runUnscoped } from "@/lib/tenancy/context"
import { tenancyExtension } from "@/lib/tenancy/extension"
import { POST } from "@/app/api/jobs/outbox/route"
import { MAX_ATTEMPTS, dispatchOnce, gaps, outboxEventRow, replay } from "@/lib/outbox/outbox"
import { prismaOutboxPorts } from "@/lib/outbox/prisma-ports"

/**
 * PAY-020-005 / PAY-140-007 — the dispatcher, against a real database.
 *
 * Everything that makes this design correct is a property of PostgreSQL, not of
 * TypeScript: `FOR UPDATE SKIP LOCKED` is what stops two dispatchers claiming
 * the same row, and a UNIQUE index is what stops a redelivery running a handler
 * twice. Both are invisible to a mocked port — a fake `claimDue` returning an
 * array is atomic by construction, so a test built on one passes whatever the
 * SQL says.
 *
 * The route handler is called the way the scheduler calls it, so what is proven
 * is the production path: envelope, auth, per-institution scope, ports,
 * `dispatchOnce`, consumers, inbox.
 *
 * Run with: npm run test:isolation   (needs DATABASE_URL)
 */

const db = new PrismaClient({ log: ["error"] }).$extends(tenancyExtension("enforce"))

const SUFFIX = "itest-outbox"
const INST = `inst-${SUFFIX}`
const OTHER = `inst-other-${SUFFIX}`
const USER = `user-${SUFFIX}`

const JOB_SECRET = "itest-outbox-secret"

const iso = (d: Date) => d.toISOString()
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000)

let organizationId = ""
let approvalId = ""

async function cleanup() {
  await runUnscoped("migration", "outbox itest cleanup", async () => {
    await db.inboxEvent.deleteMany({ where: { institutionId: { in: [INST, OTHER] } } })
    await db.outboxEvent.deleteMany({ where: { institutionId: { in: [INST, OTHER] } } })
    await db.memoryRecord.deleteMany({ where: { institutionId: { in: [INST, OTHER] } } })
    await db.approvalRequest.deleteMany({ where: { institutionId: { in: [INST, OTHER] } } })
    await db.organization.deleteMany({ where: { institutionId: { in: [INST, OTHER] } } })
    await db.institution.deleteMany({ where: { id: { in: [INST, OTHER] } } })
    await db.user.deleteMany({ where: { id: USER } })
  })
}

/** One pending row, due `dueMinutesAgo` ago, for the approval fixture. */
async function seedEvent(
  eventId: string,
  over: { availableAt?: Date; type?: string; institutionId?: string } = {},
) {
  const institutionId = over.institutionId ?? INST
  return runUnscoped("migration", "outbox itest seed", () =>
    db.outboxEvent.create({
      data: {
        ...outboxEventRow({
          eventId,
          tenantId: institutionId,
          type: over.type ?? "ApprovalDecided",
          schemaVersion: 1,
          resourceType: "ApprovalRequest",
          resourceId: approvalId,
          occurredAt: iso(minutesAgo(10)),
          correlationId: approvalId,
          causationId: null,
          origin: "tenure",
          payload: {
            action: "approve",
            fromStatus: "PENDING_OSE",
            toStatus: "APPROVED",
            organizationId,
            decidedById: USER,
          },
        }),
        availableAt: over.availableAt ?? minutesAgo(5),
      } as Prisma.OutboxEventUncheckedCreateInput,
    }),
  )
}

const runJob = () =>
  POST(
    new Request("http://localhost/api/jobs/outbox", {
      method: "POST",
      headers: { authorization: `Bearer ${JOB_SECRET}` },
    }),
  )

/**
 * Generous, and not to make anything pass.
 *
 * Jest's 5s default is a limit on a hook, not an assertion: every expectation
 * below still has to hold. This suite shares one PostgreSQL with every other
 * `.itest.ts` in `test:isolation`, and a fixture that builds two institutions,
 * an organization and an approval takes longer than 5s under that load — which
 * fails the hook and reports thirteen red tests that say nothing about the
 * dispatcher.
 */
const DB_HOOK_TIMEOUT_MS = 120_000
jest.setTimeout(60_000)

beforeAll(async () => {
  process.env.JOB_SECRET = JOB_SECRET
  await cleanup()

  await runUnscoped("control-plane", "outbox itest fixture", async () => {
    await db.institution.createMany({
      data: [
        { serving: true, id: INST, name: "Outbox Tenant", slug: `outbox-${SUFFIX}` },
        { serving: true, id: OTHER, name: "Other Tenant", slug: `outbox-other-${SUFFIX}` },
      ],
    })
    await db.user.create({ data: { id: USER, name: "Decider", email: `${USER}@example.test` } })

    const org = await db.organization.create({
      data: { institutionId: INST, name: "Robotics", slug: `robotics-${SUFFIX}` },
    })
    organizationId = org.id

    const approval = await db.approvalRequest.create({
      data: {
        institutionId: INST,
        organizationId: org.id,
        type: "BUDGET",
        title: "Regional competition travel",
        status: "APPROVED",
        submittedById: USER,
      },
    })
    approvalId = approval.id
  })
}, DB_HOOK_TIMEOUT_MS)

afterEach(async () => {
  await runUnscoped("migration", "outbox itest per-test reset", async () => {
    await db.inboxEvent.deleteMany({ where: { institutionId: { in: [INST, OTHER] } } })
    await db.outboxEvent.deleteMany({ where: { institutionId: { in: [INST, OTHER] } } })
    await db.memoryRecord.deleteMany({ where: { institutionId: { in: [INST, OTHER] } } })
  })
}, DB_HOOK_TIMEOUT_MS)

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
}, DB_HOOK_TIMEOUT_MS)

const rowFor = (eventId: string) =>
  runUnscoped("migration", "outbox itest read", () =>
    db.outboxEvent.findUnique({ where: { eventId } }),
  )

/**
 * This institution's undelivered backlog.
 *
 * Read per tenant rather than off the route's response totals: the route sweeps
 * every institution, and `test:isolation` runs every `.itest.ts` against one
 * database — so a neighbouring suite's rows would otherwise decide whether this
 * one passes.
 */
const overdueHere = () =>
  runUnscoped("migration", "outbox itest overdue", () =>
    db.outboxEvent.count({
      where: {
        institutionId: INST,
        state: { in: ["pending", "dispatching"] },
        availableAt: { lte: new Date() },
      },
    }),
  )

describe("the job route drains the outbox", () => {
  it("moves due rows pending → dispatched, and claims nothing on the second pass", async () => {
    await seedEvent("evt-a")
    await seedEvent("evt-b")
    await seedEvent("evt-c")

    const first = await runJob()
    expect(first.status).toBe(200)
    const body = (await first.json()) as Record<string, number>
    // At least, not exactly: the route sweeps every institution and this
    // database is shared with the other suites in `test:isolation`. The
    // per-row assertions below are the ones that cannot be satisfied by
    // somebody else's rows.
    expect(body.claimed).toBeGreaterThanOrEqual(3)
    expect(body.dispatched).toBeGreaterThanOrEqual(3)

    const dispatchedAt: Record<string, Date> = {}
    for (const id of ["evt-a", "evt-b", "evt-c"]) {
      const row = await rowFor(id)
      expect(row?.state).toBe("dispatched")
      expect(row?.dispatchedAt).not.toBeNull()
      dispatchedAt[id] = row!.dispatchedAt!
    }

    // Nothing of this tenant's is left due. Before this route existed, every
    // row ever written sat at `pending` forever and there was no second state.
    await runJob()
    expect(await overdueHere()).toBe(0)
    for (const id of ["evt-a", "evt-b", "evt-c"]) {
      // Unchanged, so the second pass did not re-claim and re-deliver them.
      expect((await rowFor(id))?.dispatchedAt).toEqual(dispatchedAt[id])
    }
  })

  it("leaves a row that is not due yet alone", async () => {
    await seedEvent("evt-future", { availableAt: new Date(Date.now() + 60 * 60_000) })
    await runJob()
    expect((await rowFor("evt-future"))?.state).toBe("pending")
    expect(await overdueHere()).toBe(0)
  })

  it("refuses an unauthenticated invocation", async () => {
    const res = await POST(new Request("http://localhost/api/jobs/outbox", { method: "POST" }))
    expect(res.status).toBe(401)
  })
})

describe("claiming is atomic", () => {
  it("does not hand the same row to two dispatchers running at once", async () => {
    // The property `SKIP LOCKED` exists for. Two passes in flight together —
    // two ECS tasks, an overlapping schedule, an operator running the job by
    // hand during an incident — must claim disjoint sets, or "at least once"
    // stops being bounded by the consumer and becomes once per dispatcher.
    for (let i = 0; i < 6; i++) await seedEvent(`evt-race-${i}`)

    const ports = prismaOutboxPorts({
      institutionId: INST,
      // Delivery is irrelevant here; what is under test is the claim.
      deliver: async () => {},
    })
    const now = new Date().toISOString()

    const [a, b] = await runUnscoped("control-plane", "outbox itest race", () =>
      Promise.all([ports.claimDue(now, 6), ports.claimDue(now, 6)]),
    )

    const ids = [...a, ...b].map((r) => r.outboxId)
    expect(ids.length).toBe(6)
    expect(new Set(ids).size).toBe(6)
  })
})

describe("a claim is a lease, not a transfer of ownership", () => {
  it("reclaims a record stranded at dispatching once the lease expires", async () => {
    // A task killed between claiming a batch and delivering it — a deploy, an
    // ECS scale-in, an OOM — leaves rows at `dispatching`. Without the lease
    // arm in claimDue those rows are stranded exactly as `pending` rows were
    // before this file existed, one state further along.
    const stranded = await seedEvent("evt-stranded")
    await runUnscoped("migration", "outbox itest strand", () =>
      db.$executeRaw`
        UPDATE "OutboxEvent" SET "state" = 'dispatching',
               "updatedAt" = NOW() - INTERVAL '10 minutes'
        WHERE "id" = ${stranded.id}
      `,
    )

    await runJob()
    expect((await rowFor("evt-stranded"))?.state).toBe("dispatched")
  })

  it("leaves a record another dispatcher is still working on alone", async () => {
    // The lease has to be a lease. Reclaiming immediately would make every
    // concurrent pass a duplicate delivery rather than an exceptional one.
    const inFlight = await seedEvent("evt-in-flight")
    await runUnscoped("migration", "outbox itest in-flight", () =>
      db.$executeRaw`
        UPDATE "OutboxEvent" SET "state" = 'dispatching', "updatedAt" = NOW()
        WHERE "id" = ${inFlight.id}
      `,
    )

    await runJob()
    expect((await rowFor("evt-in-flight"))?.state).toBe("dispatching")
    // And it is still counted as a gap, because it is still undelivered.
    expect(await overdueHere()).toBe(1)
  })

  it("refuses a stale dispatcher's write over a record that has since died", async () => {
    // The failure this prevents: a hung task returns after its lease expired,
    // another dispatcher has already dead-lettered the record, and an
    // unconditional UPDATE would mark it delivered — erasing deadLetteredAt and
    // the reason with it.
    const row = await seedEvent("evt-resurrect")
    await runUnscoped("migration", "outbox itest kill", () =>
      db.outboxEvent.updateMany({
        where: { id: row.id },
        data: { state: "dead", deadLetteredAt: new Date(), attempts: MAX_ATTEMPTS, lastError: "gave up" },
      }),
    )

    const ports = prismaOutboxPorts({ institutionId: INST, deliver: async () => {} })
    await runUnscoped("control-plane", "outbox itest stale write", () =>
      ports.markDispatched(row.id, new Date().toISOString()),
    )

    const after = await rowFor("evt-resurrect")
    expect(after?.state).toBe("dead")
    expect(after?.deadLetteredAt).not.toBeNull()
    expect(after?.lastError).toBe("gave up")
  })
})

describe("failing delivery", () => {
  it("backs off: availableAt moves forward and attempts increments", async () => {
    const row = await seedEvent("evt-fail")

    const ports = prismaOutboxPorts({
      institutionId: INST,
      deliver: async () => {
        throw new Error("consumer down")
      },
    })
    const now = new Date()

    await runUnscoped("control-plane", "outbox itest retry", async () => {
      const report = await dispatchOnce(ports, { now: iso(now), jitter: () => 0 })
      expect(report.retried).toBe(1)
    })

    const after = await rowFor("evt-fail")
    expect(after?.state).toBe("pending")
    expect(after?.attempts).toBe(1)
    expect(after?.lastError).toBe("consumer down")
    expect(after!.availableAt.getTime()).toBeGreaterThan(row.availableAt.getTime())
    expect(after!.availableAt.getTime()).toBeGreaterThan(now.getTime())
  })

  it("dead-letters at the attempt limit, and an operator can redrive it", async () => {
    await seedEvent("evt-dead")

    const ports = prismaOutboxPorts({
      institutionId: INST,
      deliver: async () => {
        throw new Error("still down")
      },
    })
    await runUnscoped("control-plane", "outbox itest dead-letter", async () => {
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        // Each pass claims what is due; the backoff pushes availableAt forward,
        // so `now` has to move with it.
        const now = new Date(Date.now() + i * 2 * 60 * 60_000).toISOString()
        await dispatchOnce(ports, { now, jitter: () => 0 })
      }
    })

    const dead = await rowFor("evt-dead")
    expect(dead?.state).toBe("dead")
    expect(dead?.attempts).toBe(MAX_ATTEMPTS)
    expect(dead?.deadLetteredAt).not.toBeNull()

    // The operator path: explicit ids only, and only records that are dead.
    const at = new Date().toISOString()
    const outcome = await runUnscoped("control-plane", "outbox itest redrive", () =>
      replay(ports, [dead!.id], { at }),
    )
    expect(outcome.requeued).toEqual([dead!.id])

    const requeued = await rowFor("evt-dead")
    expect(requeued?.state).toBe("pending")
    expect(requeued?.attempts).toBe(0)
    expect(requeued?.deadLetteredAt).toBeNull()
  })
})

describe("the inbox makes a redelivery a no-op", () => {
  it("runs the declared consumer exactly once, however often the event arrives", async () => {
    await seedEvent("evt-once")

    await runJob()

    const afterFirst = await runUnscoped("migration", "outbox itest memory read", () =>
      db.memoryRecord.findMany({ where: { institutionId: INST } }),
    )
    // The last step of `request-to-approval-to-memory`, which had no
    // implementation at all: memory consumes ApprovalDecided.
    expect(afterFirst).toHaveLength(1)
    expect(afterFirst[0].title).toBe("Decision: Regional competition travel")

    const inbox = await runUnscoped("migration", "outbox itest inbox read", () =>
      db.inboxEvent.findMany({ where: { institutionId: INST } }),
    )
    expect(inbox).toHaveLength(1)
    expect(inbox[0].consumer).toBe("memory.approval-decided")

    // Redelivery: the same event id, put back on the queue exactly as a crash
    // between `deliver` and `markDispatched` would leave it.
    await runUnscoped("migration", "outbox itest redeliver", () =>
      db.outboxEvent.updateMany({
        where: { eventId: "evt-once" },
        data: { state: "pending", availableAt: minutesAgo(1), dispatchedAt: null },
      }),
    )

    await runJob()
    expect((await rowFor("evt-once"))?.state).toBe("dispatched")

    const afterSecond = await runUnscoped("migration", "outbox itest memory read 2", () =>
      db.memoryRecord.findMany({ where: { institutionId: INST } }),
    )
    // Still one. The InboxEvent row is what makes at-least-once survivable.
    expect(afterSecond).toHaveLength(1)
  })

  it("delivers an event no module consumes without dead-lettering it", async () => {
    // `ApprovalRequested` is consumed by a person, not by a handler. Treating
    // "no consumer" as a failure would dead-letter every request event after
    // eight pointless retries.
    await seedEvent("evt-requested", { type: "ApprovalRequested" })
    await runJob()
    expect((await rowFor("evt-requested"))?.state).toBe("dispatched")
  })
})

describe("reconciliation", () => {
  it("counts what is overdue, which is what a dispatch report cannot say", async () => {
    await seedEvent("evt-stuck", { availableAt: minutesAgo(120) })

    const ports = prismaOutboxPorts({ institutionId: INST, deliver: async () => {} })

    const report = await runUnscoped("control-plane", "outbox itest gaps", () =>
      gaps(ports, { now: new Date().toISOString() }),
    )

    expect(report.overdue).toBe(1)
    expect(report.oldestOverdueByMs).toBeGreaterThan(110 * 60_000)
    expect(report.sample[0].type).toBe("ApprovalDecided")
  })

  it("counts only this tenant's rows", async () => {
    // `claimDue` is raw SQL and raw SQL does not pass through the tenancy
    // extension, so the predicate is written by hand — and this is the test
    // that the hand-written one is actually there.
    await seedEvent("evt-mine")
    await seedEvent("evt-theirs", { institutionId: OTHER })

    const mine = prismaOutboxPorts({ institutionId: INST, deliver: async () => {} })
    const claimed = await runUnscoped("control-plane", "outbox itest isolation", () =>
      mine.claimDue(new Date().toISOString(), 50),
    )

    expect(claimed.map((r) => r.event.eventId)).toEqual(["evt-mine"])
  })
})
