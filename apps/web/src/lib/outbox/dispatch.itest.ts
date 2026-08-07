import { db } from "@/lib/db"
import { runUnscoped } from "@/lib/tenancy/context"
import { withSystemTenantScope } from "@/lib/tenant-scope"
import { POST } from "@/app/api/jobs/outbox/route"
import { MAX_ATTEMPTS, backoffMs, dispatchOnce } from "@/lib/outbox/outbox"
import { CLAIM_LEASE_MS, prismaOutboxPorts } from "@/lib/outbox/prisma-ports"

/**
 * WRK-050-004 / WRK-GATE-060 — the dispatcher, against a real database.
 *
 * The unit test next door proves the state machine against a hand-written
 * `OutboxPorts`. That is the half a fake can prove. It cannot prove the half
 * that only exists in SQL: that a claim is atomic under two dispatchers, that a
 * retry actually moves `availableAt` forward in the column an index reads, that
 * a record dead-letters instead of being retried forever, or that a pass driven
 * per institution stays inside each institution. Those are the properties the
 * platform depends on and they were asserted nowhere.
 *
 * Every assertion below reads the row back out of Postgres. Nothing is checked
 * against the return value of the function that wrote it.
 *
 * Run with: npm run test:isolation   (needs DATABASE_URL)
 */

// Every case below is a round trip to Postgres, and several deliberately sleep
// inside a delivery to hold a claim open. Jest's 5s default is a stopwatch on
// the database, not on the code under test.
jest.setTimeout(120_000)

const SUFFIX = "itest-outbox-dispatch"
const INST_A = `inst-a-${SUFFIX}`
const INST_B = `inst-b-${SUFFIX}`

const JOB_SECRET = "itest-outbox-secret"

/** Unique across the whole table — `OutboxEvent.eventId` is globally unique. */
const evt = (name: string) => `evt-${SUFFIX}-${name}`

type SeedOptions = {
  institutionId: string
  eventId: string
  type?: string
  resourceId?: string
  state?: string
  attempts?: number
  availableAt?: Date
  payload?: Record<string, unknown>
}

async function seedEvent(o: SeedOptions) {
  return runUnscoped("migration", "outbox dispatch fixture", () =>
    db.outboxEvent.create({
      data: {
        institutionId: o.institutionId,
        eventId: o.eventId,
        // `ApprovalRequested` deliberately: `consumersFor` returns nothing for
        // it, and delivering to nobody is success. That keeps these assertions
        // about the dispatch state machine rather than about a handler.
        type: o.type ?? "ApprovalRequested",
        schemaVersion: 1,
        resourceType: "ApprovalRequest",
        resourceId: o.resourceId ?? "ar-1",
        correlationId: `corr-${o.eventId}`,
        origin: "tenure",
        payload: o.payload ?? {},
        state: o.state ?? "pending",
        attempts: o.attempts ?? 0,
        availableAt: o.availableAt ?? new Date(Date.now() - 1000),
        occurredAt: new Date(),
      },
      select: { id: true },
    }),
  )
}

const rowOf = (id: string) =>
  runUnscoped("migration", "outbox dispatch assert", () =>
    db.outboxEvent.findUniqueOrThrow({ where: { id } }),
  )

async function cleanup() {
  await runUnscoped("migration", "outbox dispatch cleanup", async () => {
    await db.inboxEvent.deleteMany({ where: { institutionId: { in: [INST_A, INST_B] } } })
    await db.outboxEvent.deleteMany({ where: { institutionId: { in: [INST_A, INST_B] } } })
    await db.institution.deleteMany({ where: { id: { in: [INST_A, INST_B] } } })
  })
}

beforeAll(async () => {
  process.env.JOB_SECRET = JOB_SECRET
  await cleanup()
  await runUnscoped("control-plane", "outbox dispatch institutions", () =>
    db.institution.createMany({
      data: [
        { serving: true, id: INST_A, name: "Outbox A", slug: `outbox-a-${SUFFIX}` },
        { serving: true, id: INST_B, name: "Outbox B", slug: `outbox-b-${SUFFIX}` },
      ],
    }),
  )
})

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

const runJob = () =>
  POST(
    new Request("http://localhost/api/jobs/outbox", {
      method: "POST",
      headers: { authorization: `Bearer ${JOB_SECRET}` },
    }),
  )

/**
 * A pass whose transport is substituted, everything else production.
 *
 * `prismaOutboxPorts` is the object under test — the claim, the three outcome
 * writes and their predicates are all the real ones. Only `deliver` is
 * replaced, because a failure that is not injected is a failure that cannot be
 * asserted on.
 */
const passWith = (
  institutionId: string,
  deliver: (event: { eventId: string }) => Promise<void>,
  opts: { now?: string; limit?: number } = {},
) =>
  withSystemTenantScope(institutionId, "outbox-dispatch", () =>
    dispatchOnce(prismaOutboxPorts({ institutionId, deliver }), {
      now: opts.now ?? new Date().toISOString(),
      limit: opts.limit ?? 50,
      // Fixed, so the retry schedule below is an equality rather than a range.
      jitter: () => 0,
    }),
  )

describe("the job route drains the outbox, one institution at a time", () => {
  it("dispatches a pending row in every institution, and claims nothing on a second pass", async () => {
    const a = await seedEvent({ institutionId: INST_A, eventId: evt("route-a") })
    const b = await seedEvent({ institutionId: INST_B, eventId: evt("route-b") })

    const res = await runJob()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { dispatched: number; claimed: number }
    expect(body.dispatched).toBeGreaterThanOrEqual(2)

    // Read the rows, not the report. A dispatcher that counted a delivery it
    // never recorded would satisfy the report and leave the queue full.
    expect((await rowOf(a.id)).state).toBe("dispatched")
    expect((await rowOf(b.id)).state).toBe("dispatched")
    expect((await rowOf(a.id)).dispatchedAt).not.toBeNull()

    // Idempotence at the pass level: nothing is left due, so the second run is
    // a no-op rather than a redelivery of everything already handled.
    const second = (await (await runJob()).json()) as { claimed: number; dispatched: number }
    expect(second.claimed).toBe(0)
    expect(second.dispatched).toBe(0)
  })

  it("refuses an invocation with no secret, and one with the wrong secret", async () => {
    expect((await POST(new Request("http://localhost/api/jobs/outbox", { method: "POST" }))).status).toBe(401)
    expect(
      (
        await POST(
          new Request("http://localhost/api/jobs/outbox", {
            method: "POST",
            headers: { authorization: "Bearer not-the-secret" },
          }),
        )
      ).status,
    ).toBe(401)
  })
})

describe("a delivery that fails", () => {
  it("returns the record to pending, counts the attempt, and pushes availableAt by the backoff", async () => {
    const row = await seedEvent({ institutionId: INST_A, eventId: evt("retry") })
    const now = new Date().toISOString()

    const report = await passWith(
      INST_A,
      async () => {
        throw new Error("consumer down")
      },
      { now },
    )
    expect(report.retried).toBe(1)

    const after = await rowOf(row.id)
    expect(after.state).toBe("pending")
    expect(after.attempts).toBe(1)
    expect(after.lastError).toBe("consumer down")
    // The exact schedule, not "later than now": `availableAt` is the column the
    // dispatcher's index reads, and a retry that moved it by the wrong amount
    // is a retry storm or a record that never comes back.
    expect(after.availableAt.toISOString()).toBe(
      new Date(Date.parse(now) + backoffMs(1, 0)).toISOString(),
    )
  })

  it("is not claimed again until its backoff has elapsed", async () => {
    const row = await seedEvent({ institutionId: INST_A, eventId: evt("backoff-holds") })
    const now = new Date().toISOString()

    await passWith(
      INST_A,
      async () => {
        throw new Error("still down")
      },
      { now },
    )

    // A second pass at the same instant must not pick it up, or the backoff is
    // decoration and a failing consumer is hammered by every scheduled run.
    let attempted = 0
    const again = await passWith(
      INST_A,
      async () => {
        attempted += 1
      },
      { now },
    )
    expect(again.claimed).toBe(0)
    expect(attempted).toBe(0)
    expect((await rowOf(row.id)).attempts).toBe(1)
  })

  it("dead-letters at the attempt limit instead of retrying forever", async () => {
    const row = await seedEvent({
      institutionId: INST_A,
      eventId: evt("dead"),
      attempts: MAX_ATTEMPTS - 1,
    })
    const now = new Date().toISOString()

    const report = await passWith(
      INST_A,
      async () => {
        throw new Error("permanently broken")
      },
      { now },
    )
    expect(report.deadLettered).toBe(1)

    const after = await rowOf(row.id)
    expect(after.state).toBe("dead")
    expect(after.attempts).toBe(MAX_ATTEMPTS)
    expect(after.deadLetteredAt).not.toBeNull()
    expect(after.lastError).toBe("permanently broken")
  })

  it("survives eight real failures rather than assuming the counter", async () => {
    // The attempt counter is only meaningful if it actually accumulates across
    // passes: seeding attempts=7 proves the branch, and this proves the walk.
    const row = await seedEvent({ institutionId: INST_A, eventId: evt("walk") })

    let at = Date.now()
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await passWith(
        INST_A,
        async () => {
          throw new Error(`failure ${i}`)
        },
        // Each pass runs after the previous backoff has elapsed, which is what
        // a scheduler firing every minute does.
        { now: new Date(at).toISOString() },
      )
      at += backoffMs(i + 1, 0) + 1
    }

    const after = await rowOf(row.id)
    expect(after.state).toBe("dead")
    expect(after.attempts).toBe(MAX_ATTEMPTS)
  })
})

describe("two dispatchers running at once", () => {
  it("delivers a single due record exactly once", async () => {
    const row = await seedEvent({ institutionId: INST_A, eventId: evt("concurrent") })

    const delivered: string[] = []
    const slowDeliver = async (event: { eventId: string }) => {
      // Long enough that both passes are inside their claim at the same time.
      await new Promise((r) => setTimeout(r, 120))
      delivered.push(event.eventId)
    }

    const [one, two] = await Promise.all([
      passWith(INST_A, slowDeliver),
      passWith(INST_A, slowDeliver),
    ])

    expect(delivered).toEqual([evt("concurrent")])
    expect(one.claimed + two.claimed).toBe(1)
    expect((await rowOf(row.id)).state).toBe("dispatched")
  })

  it("splits a batch between them rather than handing both the same rows", async () => {
    const ids = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        seedEvent({ institutionId: INST_B, eventId: evt(`split-${i}`) }),
      ),
    )

    const claimed: string[] = []
    const collect = async (event: { eventId: string }) => {
      await new Promise((r) => setTimeout(r, 20))
      claimed.push(event.eventId)
    }

    await Promise.all([passWith(INST_B, collect), passWith(INST_B, collect)])

    // Disjoint: every row delivered, none twice.
    expect(claimed).toHaveLength(12)
    expect(new Set(claimed).size).toBe(12)
    for (const { id } of ids) expect((await rowOf(id)).state).toBe("dispatched")
  })
})

describe("a dispatcher that died mid-pass", () => {
  it("leaves its claim recoverable once the lease expires", async () => {
    const row = await seedEvent({ institutionId: INST_A, eventId: evt("stranded") })

    // The state a killed task leaves behind: claimed, never resolved.
    await runUnscoped("migration", "strand the claim", () =>
      db.outboxEvent.update({
        where: { id: row.id },
        data: { state: "dispatching", updatedAt: new Date(Date.now() - CLAIM_LEASE_MS - 60_000) },
      }),
    )

    let delivered = 0
    const report = await passWith(INST_A, async () => {
      delivered += 1
    })

    expect(report.claimed).toBe(1)
    expect(delivered).toBe(1)
    expect((await rowOf(row.id)).state).toBe("dispatched")
  })

  it("does not steal a claim that is still inside its lease", async () => {
    const row = await seedEvent({ institutionId: INST_A, eventId: evt("in-flight") })

    await runUnscoped("migration", "claim held", () =>
      db.outboxEvent.update({
        where: { id: row.id },
        data: { state: "dispatching", updatedAt: new Date() },
      }),
    )

    // Stealing a live claim would double-deliver every record on every pass,
    // which is the unbounded duplication the lease exists to avoid.
    const report = await passWith(INST_A, async () => {})
    expect(report.claimed).toBe(0)
    expect((await rowOf(row.id)).state).toBe("dispatching")
  })
})

describe("tenancy", () => {
  it("does not claim another institution's rows", async () => {
    const mine = await seedEvent({ institutionId: INST_A, eventId: evt("scope-mine") })
    const theirs = await seedEvent({ institutionId: INST_B, eventId: evt("scope-theirs") })

    const seen: string[] = []
    await passWith(INST_A, async (event) => {
      seen.push(event.eventId)
    })

    expect(seen).toContain(evt("scope-mine"))
    expect(seen).not.toContain(evt("scope-theirs"))
    expect((await rowOf(mine.id)).state).toBe("dispatched")
    expect((await rowOf(theirs.id)).state).toBe("pending")
  })
})
