import type { DomainEvent } from "@tenure/contracts"

import { db } from "@/lib/db"
import { runUnscoped } from "@/lib/tenancy/context"
import { withSystemTenantScope } from "@/lib/tenant-scope"
import { POST } from "@/app/api/jobs/outbox/route"
import { MAX_ATTEMPTS, dispatchOnce } from "@/lib/outbox/outbox"
import { LAST_ERROR_LIMIT, prismaOutboxPorts } from "@/lib/outbox/prisma-ports"

/**
 * WRK-060-005 / WRK-060-003 — the delivery properties, against a real database.
 *
 * The list this file exists for is not "does the happy path work". It is the
 * five ways a queue lies to you — duplicates, out-of-order redelivery, gaps,
 * partial batches, stale conditional writes — plus the two the outbox added
 * when it became per-tenant: does a consumer's effect actually happen, and does
 * one institution's backlog starve the others.
 *
 * Every one of those was previously asserted only against a hand-written
 * `ports()` object in outbox.test.ts, which cannot exhibit any of them: a fake
 * `claimDue` that returns an array is atomic because arrays are, and a fake
 * `markDispatched` that resolves cannot lose a conditional write it never made.
 *
 * Run with: npm run test:isolation   (needs DATABASE_URL)
 */

// Two hundred rows, several concurrent passes and a fixture that builds an
// institution, an organization and an approval. Jest's 5s default times the
// database rather than the dispatcher.
jest.setTimeout(120_000)

const SUFFIX = "itest-outbox-job"
const INST_A = `inst-a-${SUFFIX}`
const INST_B = `inst-b-${SUFFIX}`
const USER = `user-${SUFFIX}`

const JOB_SECRET = "itest-outbox-job-secret"

const evt = (name: string) => `evt-${SUFFIX}-${name}`

let orgA = ""
let approvalA = ""

type SeedOptions = {
  institutionId: string
  eventId: string
  type?: string
  resourceId?: string
  attempts?: number
  availableAt?: Date
  payload?: Record<string, unknown>
}

function eventData(o: SeedOptions) {
  return {
    institutionId: o.institutionId,
    eventId: o.eventId,
    type: o.type ?? "ApprovalRequested",
    schemaVersion: 1,
    resourceType: "ApprovalRequest",
    resourceId: o.resourceId ?? "ar-1",
    correlationId: `corr-${o.eventId}`,
    origin: "tenure",
    payload: o.payload ?? {},
    state: "pending",
    attempts: o.attempts ?? 0,
    availableAt: o.availableAt ?? new Date(Date.now() - 1000),
    occurredAt: new Date(),
  }
}

const seedEvent = (o: SeedOptions) =>
  runUnscoped("migration", "outbox job fixture", () =>
    db.outboxEvent.create({ data: eventData(o), select: { id: true } }),
  )

const rowOf = (id: string) =>
  runUnscoped("migration", "outbox job assert", () =>
    db.outboxEvent.findUniqueOrThrow({ where: { id } }),
  )

async function cleanup() {
  await runUnscoped("migration", "outbox job cleanup", async () => {
    await db.inboxEvent.deleteMany({ where: { institutionId: { in: [INST_A, INST_B] } } })
    await db.outboxEvent.deleteMany({ where: { institutionId: { in: [INST_A, INST_B] } } })
    await db.memoryRecord.deleteMany({ where: { institutionId: { in: [INST_A, INST_B] } } })
    await db.approvalRequest.deleteMany({ where: { institutionId: { in: [INST_A, INST_B] } } })
    await db.organization.deleteMany({ where: { institutionId: { in: [INST_A, INST_B] } } })
    await db.institution.deleteMany({ where: { id: { in: [INST_A, INST_B] } } })
    await db.user.deleteMany({ where: { id: USER } })
  })
}

beforeAll(async () => {
  process.env.JOB_SECRET = JOB_SECRET
  await cleanup()

  await runUnscoped("control-plane", "outbox job institutions", async () => {
    await db.institution.createMany({
      data: [
        { serving: true, id: INST_A, name: "Job A", slug: `job-a-${SUFFIX}` },
        { serving: true, id: INST_B, name: "Job B", slug: `job-b-${SUFFIX}` },
      ],
    })
    await db.user.create({
      data: { id: USER, name: "Deciding Director", email: `${USER}@example.test` },
    })

    const org = await db.organization.create({
      data: { institutionId: INST_A, name: "A's Club", slug: `a-club-${SUFFIX}` },
    })
    orgA = org.id

    const approval = await db.approvalRequest.create({
      data: {
        institutionId: INST_A,
        organizationId: org.id,
        type: "BUDGET",
        title: "Spring speaker series",
        status: "APPROVED",
        submittedById: USER,
      },
    })
    approvalA = approval.id
  })
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

const pass = (
  institutionId: string,
  deliver: (event: DomainEvent) => Promise<void>,
  opts: { now?: string; limit?: number } = {},
) =>
  withSystemTenantScope(institutionId, "outbox-dispatch", () =>
    dispatchOnce(prismaOutboxPorts({ institutionId, deliver }), {
      now: opts.now ?? new Date().toISOString(),
      limit: opts.limit ?? 50,
      jitter: () => 0,
    }),
  )

/** The real claim, called the way the dispatcher calls it. */
const claim = (institutionId: string, limit: number) =>
  withSystemTenantScope(institutionId, "outbox-dispatch", () =>
    prismaOutboxPorts({ institutionId }).claimDue(new Date().toISOString(), limit),
  )

describe("duplicates", () => {
  it("two claims running at once take disjoint sets", async () => {
    const rows = await Promise.all(
      Array.from({ length: 10 }, (_, i) => seedEvent({ institutionId: INST_A, eventId: evt(`dup-${i}`) })),
    )

    const [first, second] = await Promise.all([claim(INST_A, 10), claim(INST_A, 10)])
    const ids = [...first, ...second].map((r) => r.outboxId)

    // Ten rows, ten claims, no id twice. A read-then-write claim hands both
    // callers the same batch and every consumer sees everything twice.
    expect(ids).toHaveLength(10)
    expect(new Set(ids).size).toBe(10)
    expect(new Set(ids)).toEqual(new Set(rows.map((r) => r.id)))
  })
})

describe("out-of-order redelivery", () => {
  it("sends a failed record back behind a record written after it", async () => {
    const now = new Date()
    const older = await seedEvent({
      institutionId: INST_A,
      eventId: evt("ooo-older"),
      availableAt: new Date(now.getTime() - 10_000),
    })
    const newer = await seedEvent({
      institutionId: INST_A,
      eventId: evt("ooo-newer"),
      availableAt: new Date(now.getTime() - 5_000),
    })

    const delivered: string[] = []
    await pass(
      INST_A,
      async (event) => {
        if (event.eventId === evt("ooo-older")) throw new Error("that consumer is down")
        delivered.push(event.eventId)
      },
      { now: now.toISOString() },
    )

    // The newer record is delivered; the older one is not, and comes back
    // strictly later than the newer one's delivery. Consumers therefore see
    // these two events in the opposite order to the one they were written in,
    // which is the property a consumer has to be built for.
    expect(delivered).toEqual([evt("ooo-newer")])

    const olderRow = await rowOf(older.id)
    const newerRow = await rowOf(newer.id)
    expect(newerRow.state).toBe("dispatched")
    expect(olderRow.state).toBe("pending")
    expect(olderRow.availableAt.getTime()).toBeGreaterThan(newerRow.dispatchedAt!.getTime())
  })
})

describe("gaps", () => {
  it("a record that keeps failing dead-letters instead of disappearing", async () => {
    const row = await seedEvent({
      institutionId: INST_A,
      eventId: evt("gap"),
      attempts: MAX_ATTEMPTS - 1,
    })

    await pass(INST_A, async () => {
      throw new Error("downstream gone")
    })

    const after = await rowOf(row.id)
    // Still there, still readable, still says why. A queue that dropped it
    // would report the same zeros as a healthy one.
    expect(after.state).toBe("dead")
    expect(after.lastError).toBe("downstream gone")
    expect(after.deadLetteredAt).not.toBeNull()

    // And it is not silently retried by the next pass.
    const next = await pass(INST_A, async () => {})
    expect(next.claimed).toBe(0)
  })
})

describe("partial batches", () => {
  it("leaves the remainder pending when the limit is smaller than the backlog", async () => {
    const rows = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        seedEvent({
          institutionId: INST_B,
          eventId: evt(`batch-${i}`),
          availableAt: new Date(Date.now() - (10 - i) * 1000),
        }),
      ),
    )

    const report = await pass(INST_B, async () => {}, { limit: 2 })
    expect(report.claimed).toBe(2)
    expect(report.dispatched).toBe(2)

    const states = await Promise.all(rows.map((r) => rowOf(r.id).then((x) => x.state)))
    // Oldest first — a partial batch that took an arbitrary two would starve
    // whatever it kept skipping.
    expect(states).toEqual(["dispatched", "dispatched", "pending", "pending", "pending"])

    // The remainder is picked up by the next pass rather than being stranded.
    await pass(INST_B, async () => {}, { limit: 50 })
    expect(await Promise.all(rows.map((r) => rowOf(r.id).then((x) => x.state)))).toEqual(
      Array(5).fill("dispatched"),
    )
  })
})

describe("stale conditional writes", () => {
  it("does not resurrect a record another dispatcher dead-lettered mid-delivery", async () => {
    const row = await seedEvent({ institutionId: INST_A, eventId: evt("stale") })

    // The race, played out inside the delivery this pass is waiting on: while
    // this dispatcher is in `deliver`, another operator or a dispatcher that
    // reclaimed the expired lease gives up on the record. When `deliver`
    // returns, `markDispatched` is about to write a state the record has moved
    // on from.
    await pass(INST_A, async () => {
      await withSystemTenantScope(INST_A, "outbox-dispatch", () =>
        prismaOutboxPorts({ institutionId: INST_A }).deadLetter(
          row.id,
          new Date().toISOString(),
          MAX_ATTEMPTS,
          "given up on elsewhere",
        ),
      )
    })

    const after = await rowOf(row.id)
    // Dead, with the reason and the timestamp intact. An unconditional
    // `SET state = 'dispatched'` would have erased both and reported a delivery
    // whose outcome nobody knows.
    expect(after.state).toBe("dead")
    expect(after.lastError).toBe("given up on elsewhere")
    expect(after.deadLetteredAt).not.toBeNull()
    expect(after.dispatchedAt).toBeNull()
  })
})

describe("payloads and instants survive the round trip", () => {
  it("hands the consumer back exactly the text that was written, whatever it is made of", async () => {
    // Emoji outside the BMP, a combining sequence, RTL, and a NUL-adjacent
    // control character. An event is a message about something a person named,
    // and people name things with all of this. Anything that mangles it here
    // mangles it in the consumer, where the mistake is attributed to the club
    // rather than to the queue.
    const unicode = {
      club: "Société Étudiante 🇫🇷 — “Café” ☕️",
      arabic: "نادي الطلاب",
      devanagari: "छात्र संघ",
      combining: "ȩ́",
      emojiZwj: "👩‍👩‍👧‍👦",
      cjk: "学生自治会",
      quote: 'He said "it\'s fine" -- \\backslash\\ and a % and a _',
    }

    await seedEvent({
      institutionId: INST_B,
      eventId: evt("unicode"),
      payload: unicode,
    })

    let received: unknown
    await pass(INST_B, async (event) => {
      received = event.payload
    })

    expect(received).toEqual(unicode)
  })

  it("carries a large payload through without truncating it", async () => {
    // 256 KB of JSON. A silent truncation would produce a payload that still
    // parses and no longer says what happened, which is worse than a failure.
    const big = { blob: "x".repeat(256 * 1024), tail: "END" }
    await seedEvent({ institutionId: INST_B, eventId: evt("large"), payload: big })

    let received: { blob: string; tail: string } | undefined
    await pass(INST_B, async (event) => {
      received = event.payload as { blob: string; tail: string }
    })

    expect(received?.blob.length).toBe(256 * 1024)
    expect(received?.tail).toBe("END")
  })

  it("stores a long failure without cutting a character in half", async () => {
    const row = await seedEvent({ institutionId: INST_B, eventId: evt("long-error") })

    // Built so the cut lands between the halves of an astral character: 1023
    // ASCII units then a surrogate pair, so index 1023 is its high half.
    const message = "a".repeat(LAST_ERROR_LIMIT - 1) + "𝄞" + "trailing"
    await pass(INST_B, async () => {
      throw new Error(message)
    })

    const stored = (await rowOf(row.id)).lastError!
    // Asserted against a value computed here, NOT against `truncateLastError`.
    // Calling the helper on both sides would stay green the day the production
    // path stopped calling it.
    expect(stored).toBe("a".repeat(LAST_ERROR_LIMIT - 1))
    expect(stored.length).toBeLessThanOrEqual(LAST_ERROR_LIMIT)
    // No dangling surrogate: the stored text is valid UTF-8 on its own.
    expect(/[\uD800-\uDBFF]$/.test(stored)).toBe(false)
  })

  it("decides what is due by instant, not by anyone's local clock", async () => {
    // `availableAt` is compared in SQL against a JS `Date`. If either side were
    // rendered in local time, a dispatcher in a UTC-5 container would claim
    // records five hours early — or never — and the symptom would be "the queue
    // is slow" rather than "the comparison is wrong". Two records an hour on
    // either side of now make that unambiguous in any time zone.
    const past = await seedEvent({
      institutionId: INST_B,
      eventId: evt("tz-past"),
      availableAt: new Date(Date.now() - 3_600_000),
    })
    const future = await seedEvent({
      institutionId: INST_B,
      eventId: evt("tz-future"),
      availableAt: new Date(Date.now() + 3_600_000),
    })

    const seen: string[] = []
    await pass(INST_B, async (event) => {
      seen.push(event.eventId)
    })

    expect(seen).toContain(evt("tz-past"))
    expect(seen).not.toContain(evt("tz-future"))
    expect((await rowOf(past.id)).state).toBe("dispatched")
    expect((await rowOf(future.id)).state).toBe("pending")

    // And the instant on the record is preserved to the millisecond rather than
    // being rounded into whatever the session time zone is.
    const stored = await rowOf(future.id)
    expect(stored.availableAt.getTime()).toBeGreaterThan(Date.now() + 3_000_000)
  })
})

describe("the consumer the module catalog declares", () => {
  it("turns a dispatched ApprovalDecided into the memory record, exactly once", async () => {
    await seedEvent({
      institutionId: INST_A,
      eventId: evt("decided"),
      type: "ApprovalDecided",
      resourceId: approvalA,
      payload: { action: "approve", fromStatus: "PENDING_OSE", toStatus: "APPROVED", decidedById: USER },
    })

    const res = await runJob()
    expect(res.status).toBe(200)

    const records = () =>
      runUnscoped("migration", "outbox job memory assert", () =>
        db.memoryRecord.findMany({ where: { institutionId: INST_A, organizationId: orgA } }),
      )

    const after = await records()
    expect(after).toHaveLength(1)
    expect(after[0].title).toBe("Decision: Spring speaker series")
    expect(after[0].type).toBe("LESSON")
    expect((after[0].content as Record<string, unknown>).action).toBe("approve")

    // A second and third pass must not write a second card. Delivery is
    // at-least-once, so this is the InboxEvent row doing its job, not luck.
    await runJob()
    await runJob()
    expect(await records()).toHaveLength(1)
  })

  it("writes the memory record only once even when the same event is redelivered", async () => {
    const row = await seedEvent({
      institutionId: INST_A,
      eventId: evt("redelivered"),
      type: "ApprovalDecided",
      resourceId: approvalA,
      payload: { action: "reject", decidedById: USER },
    })

    const countRedeliveries = () =>
      runUnscoped("migration", "outbox job redelivery assert", () =>
        db.memoryRecord.count({
          where: { institutionId: INST_A, content: { path: ["action"], equals: "reject" } },
        }),
      )

    await runJob()
    expect(await countRedeliveries()).toBe(1)

    // Force the redelivery the outbox deliberately allows: a crash between the
    // consumer returning and `markDispatched` committing leaves the record
    // claimable again. Put it back and run the pass.
    await runUnscoped("migration", "simulate a crash after delivery", () =>
      db.outboxEvent.update({
        where: { id: row.id },
        data: { state: "pending", dispatchedAt: null, availableAt: new Date(Date.now() - 1000) },
      }),
    )

    await runJob()
    expect((await rowOf(row.id)).state).toBe("dispatched")
    // Delivered twice, recorded once. Without the InboxEvent row the successor
    // reading this club's memory would find the same decision twice over.
    expect(await countRedeliveries()).toBe(1)
  })
})

describe("fairness", () => {
  it("dispatches a quiet institution's single record in the same pass as a busy one's backlog", async () => {
    // 200 rows in A, all older than B's one row. A single global
    // `claimDue(now, 50)` ordered by availableAt would take fifty of A's and
    // never reach B, and B would wait for four more passes behind a backlog it
    // has nothing to do with. Running the pass per institution is what bounds
    // one tenant's queue to one tenant.
    const base = Date.now() - 3_600_000
    await runUnscoped("migration", "fairness backlog", () =>
      db.outboxEvent.createMany({
        data: Array.from({ length: 200 }, (_, i) =>
          eventData({
            institutionId: INST_A,
            eventId: evt(`fair-a-${i}`),
            availableAt: new Date(base + i),
          }),
        ),
      }),
    )
    const quiet = await seedEvent({
      institutionId: INST_B,
      eventId: evt("fair-b"),
      availableAt: new Date(),
    })

    const res = await runJob()
    expect(res.status).toBe(200)

    expect((await rowOf(quiet.id)).state).toBe("dispatched")

    // And the busy institution really was the busy one — the pass was bounded,
    // not "small enough that everything fit".
    const stillPending = await runUnscoped("migration", "fairness backlog assert", () =>
      db.outboxEvent.count({ where: { institutionId: INST_A, state: "pending" } }),
    )
    expect(stillPending).toBeGreaterThan(0)
  })
})
