import fs from "node:fs"
import path from "node:path"

import { MODULE_CATALOG } from "@tenure/modules"

import { POST } from "@/app/api/jobs/slo/route"
import { db } from "@/lib/db"
import { runUnscoped } from "@/lib/tenancy/context"

/**
 * WRK-120-003 — the approvals SLO, proved end to end through the endpoint.
 *
 * The objective is declared on the `approvals` manifest and this asserts on
 * what `POST /api/jobs/slo` EMITS, never on `sloBurn` directly. That
 * distinction is the whole point of the test: a suite that calls the evaluator
 * itself stays green on the day the route stops using it, which is precisely
 * how a burn number can be correct, tested, and reaching nobody.
 *
 * Two institutions, seeded differently:
 *
 *   A  ten open requests, four of them thirty days stale — six or more WORKING
 *      days in their current gate, which is what approvals-sla.ts calls
 *      overdue. Attains 0.6 against a 0.95 target.
 *   B  two open requests touched today, plus a decided one. Attains 1.
 *
 * The pair matters. A single breaching tenant proves the alert fires; the
 * second proves the per-tenant split is real rather than a fleet average
 * wearing an institutionId — an average over both would read 0.67 and hide
 * which of the two has stopped.
 *
 * Run with: npm run test:isolation   (needs DATABASE_URL)
 */

/**
 * The application's own client, not a hand-built one.
 *
 * `reminders-isolation.itest.ts` builds an enforcing client because its claim
 * IS isolation, and an isolation proof that runs unenforced proves nothing.
 * This file's claim is different — that the burn the endpoint emits is computed
 * per institution from real rows — so the right client is the one the route
 * actually queries through. A second client here would let the fixture and the
 * code under test disagree about what a row is.
 */

// The fixture opens a connection, deletes four tables and writes thirteen rows
// before anything is asserted. Jest's 5s default is a timeout on the DATABASE
// coming up, not on this test's logic, and it reports as "can't reach the
// server" — a failure that looks like a broken change and is a cold pool.
jest.setTimeout(60_000)

const SUFFIX = "itest-slo"
const INST_BREACHING = `inst-breaching-${SUFFIX}`
const INST_HEALTHY = `inst-healthy-${SUFFIX}`
const SUBMITTER = `submitter-${SUFFIX}`

const JOB_SECRET = "itest-slo-secret"

/** Thirty calendar days is at least twenty working days on any calendar here. */
const STALE = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

const OVERDUE_IDS = ["a-late-1", "a-late-2", "a-late-3", "a-late-4"].map(
  (id) => `${id}-${SUFFIX}`,
)
const FRESH_A_IDS = ["a-ok-1", "a-ok-2", "a-ok-3", "a-ok-4", "a-ok-5", "a-ok-6"].map(
  (id) => `${id}-${SUFFIX}`,
)
const FRESH_B_IDS = ["b-ok-1", "b-ok-2"].map((id) => `${id}-${SUFFIX}`)
const DECIDED_B_ID = `b-approved-${SUFFIX}`

async function cleanup() {
  await runUnscoped("migration", "approvals slo cleanup", async () => {
    await db.approvalRequest.deleteMany({
      where: { institutionId: { in: [INST_BREACHING, INST_HEALTHY] } },
    })
    await db.organization.deleteMany({
      where: { institutionId: { in: [INST_BREACHING, INST_HEALTHY] } },
    })
    await db.institution.deleteMany({
      where: { id: { in: [INST_BREACHING, INST_HEALTHY] } },
    })
    await db.user.deleteMany({ where: { id: SUBMITTER } })
  })
}

beforeAll(async () => {
  process.env.JOB_SECRET = JOB_SECRET
  await cleanup()

  await runUnscoped("control-plane", "approvals slo fixture", async () => {
    await db.institution.createMany({
      data: [
        {
          serving: true,
          id: INST_BREACHING,
          name: "Stalled Queue University",
          slug: `stalled-${SUFFIX}`,
        },
        {
          serving: true,
          id: INST_HEALTHY,
          name: "Moving Queue College",
          slug: `moving-${SUFFIX}`,
        },
      ],
    })
    await db.user.create({
      data: { id: SUBMITTER, name: "Requester", email: `${SUBMITTER}@example.test` },
    })

    const orgA = await db.organization.create({
      data: {
        institutionId: INST_BREACHING,
        name: "Stalled Club",
        slug: `stalled-club-${SUFFIX}`,
      },
    })
    const orgB = await db.organization.create({
      data: {
        institutionId: INST_HEALTHY,
        name: "Moving Club",
        slug: `moving-club-${SUFFIX}`,
      },
    })

    const request = (
      id: string,
      institutionId: string,
      organizationId: string,
      status: "PENDING_OSE" | "APPROVED",
      updatedAt: Date,
    ) => ({
      id,
      institutionId,
      organizationId,
      type: "BUDGET" as const,
      title: id,
      status,
      submittedById: SUBMITTER,
      // Set explicitly. `updatedAt` is what the SLA ages from — time in the
      // CURRENT gate — and a fixture that let Prisma stamp it would seed ten
      // requests that are all zero days old, which no threshold can breach.
      updatedAt,
      createdAt: updatedAt,
    })

    await db.approvalRequest.createMany({
      data: [
        ...OVERDUE_IDS.map((id) =>
          request(id, INST_BREACHING, orgA.id, "PENDING_OSE", STALE()),
        ),
        ...FRESH_A_IDS.map((id) =>
          request(id, INST_BREACHING, orgA.id, "PENDING_OSE", new Date()),
        ),
        ...FRESH_B_IDS.map((id) => request(id, INST_HEALTHY, orgB.id, "PENDING_OSE", new Date())),
        // Decided, and stale. It must not be measured: the objective is about
        // requests still waiting, and counting a request that WAS decided
        // thirty days ago as a breach would make every finished queue an
        // incident.
        request(DECIDED_B_ID, INST_HEALTHY, orgB.id, "APPROVED", STALE()),
      ],
    })
  })
})

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

interface TenantBurn {
  institutionId: string
  total: number
  good: number
  bad: number
  attained: number
  burn: number
  met: boolean
  breaching: string[]
}

interface SloResponse {
  module: string
  objective: string
  target: number
  window: string
  measure: string
  runbook: string
  tenants: TenantBurn[]
  breachedTenants: number
  alert: boolean
}

const runJob = () =>
  POST(
    new Request("http://localhost/api/jobs/slo", {
      method: "POST",
      headers: { authorization: `Bearer ${JOB_SECRET}` },
    }),
  )

async function report(): Promise<SloResponse> {
  const res = await runJob()
  expect(res.status).toBe(200)
  return (await res.json()) as SloResponse
}

const rowFor = (body: SloResponse, institutionId: string) => {
  const row = body.tenants.find((t) => t.institutionId === institutionId)
  expect(row).toBeDefined()
  return row!
}

describe("a queue that has stopped moving is now visible without opening it", () => {
  it("reports the objective breached for the institution whose queue is stale", async () => {
    const body = await report()

    const stalled = rowFor(body, INST_BREACHING)
    expect(stalled.total).toBe(OVERDUE_IDS.length + FRESH_A_IDS.length)
    expect(stalled.bad).toBe(OVERDUE_IDS.length)
    // 6 good of 10 against a 0.95 target: 0.4 of a 0.05 error budget is 8x.
    expect(stalled.attained).toBeCloseTo(0.6, 5)
    expect(stalled.burn).toBeCloseTo(8, 5)
    expect(stalled.met).toBe(false)
    expect([...stalled.breaching].sort()).toEqual([...OVERDUE_IDS].sort())

    expect(body.alert).toBe(true)
    expect(body.breachedTenants).toBeGreaterThanOrEqual(1)
  })

  it("does not average the breach away across tenants", async () => {
    // The reason the burn is per institution. A fleet number would read 0.67
    // here and neither institution would be named — WRK-120-003's per-tenant
    // SLO is this row existing separately, not a label on a total.
    const body = await report()
    const healthy = rowFor(body, INST_HEALTHY)

    expect(healthy.total).toBe(FRESH_B_IDS.length)
    expect(healthy.bad).toBe(0)
    expect(healthy.attained).toBe(1)
    expect(healthy.burn).toBe(0)
    expect(healthy.met).toBe(true)
    // The decided request is not a measurement. It is thirty days stale and
    // nobody is waiting on it.
    expect(healthy.breaching).toEqual([])
  })

  it("reports the objective the manifest declares, not one written in the route", async () => {
    const body = await report()
    const declared = MODULE_CATALOG.get("approvals")?.slo?.[0]

    expect(declared).toBeDefined()
    expect(body.module).toBe("approvals")
    expect(body.objective).toBe(declared!.objective)
    expect(body.target).toBe(declared!.target)
    expect(body.window).toBe(declared!.window)
    expect(body.measure).toBe(declared!.measure)
  })

  it("names a runbook that exists", async () => {
    // The dimension is "SLO, alert AND runbook". A path in a manifest that
    // resolves to nothing is the same unfalsifiable claim the seventeen
    // dimensions replaced, so the endpoint's own answer is opened here.
    const body = await report()
    const onDisk = path.join(process.cwd(), "..", "..", body.runbook)

    expect(body.runbook).toBe("docs/runbooks/approvals-queue-stalled.md")
    expect(fs.existsSync(onDisk)).toBe(true)
    expect(fs.readFileSync(onDisk, "utf8")).toContain(body.objective)
  })

  it("refuses an unauthenticated invocation", async () => {
    const res = await POST(new Request("http://localhost/api/jobs/slo", { method: "POST" }))
    expect(res.status).toBe(401)
  })

  it("refuses a wrong secret", async () => {
    const res = await POST(
      new Request("http://localhost/api/jobs/slo", {
        method: "POST",
        headers: { authorization: "Bearer not-the-secret" },
      }),
    )
    expect(res.status).toBe(401)
  })
})
