/**
 * WRK-030-006 — the launch-token cases, asserted on what the ROUTE returns.
 *
 * `calendar-sync.test.ts` states each case against `verifyCalendarToken`. That
 * is necessary and it is not sufficient: a test that proves a property by
 * calling the helper directly stays green the day the route stops calling it,
 * or calls it and ignores the answer. Every assertion here goes through
 * `GET /api/calendar/ics/[token]` — the production caller — against real
 * Postgres, so the mutations that matter (drop the max-age comparison, drop the
 * institution from the scope call, drop the epoch comparison) turn this red.
 *
 * ## The wrong-tenant leg, and why it is the reason this file exists
 *
 * One person seated in two institutions. Before this item the route called
 * `withTenantScope(userId, fn)` with no institution, which falls through to
 * `actingInstitutionChoice(userId)` and then to the FIRST of the user's
 * institutions in id order. So the same subscription URL — already pasted into
 * Outlook, polled every few hours — began returning a different institution's
 * events the moment the holder's acting choice changed. A cross-tenant
 * disclosure arriving as a 200 that no calendar client would ever question.
 *
 * The fixture makes `alpha` sort first, so it is exactly what the unpinned path
 * resolves to, and mints the token for `beta`. A feed that returns alpha's
 * events is the bug; a feed that returns beta's is the fix. The acting choice
 * itself lives in a cookie, which has no meaning outside a request — so the
 * test drives the same fallback the cookie path ends in rather than pretending
 * to set one.
 *
 * Needs a live database, so it is an `.itest.ts` and runs under
 * `npm run test:isolation`.
 *
 *   DATABASE_URL=postgresql://tenure:tenure@localhost:5544/tenure
 */

jest.setTimeout(60_000)

import { db } from "@/lib/db"
import { runUnscoped } from "@/lib/tenancy/context"
import { GET } from "@/app/api/calendar/ics/[token]/route"
import { calendarToken, CALENDAR_TOKEN_MAX_AGE_MS } from "@/lib/calendar-sync"
import { calendarSelectorFor } from "@/lib/calendar-data"

const RUN = Date.now().toString(36)
// `alpha` < `beta` as strings, and `getUserContext` orders memberships by
// institutionId ascending — so alpha is what the UNPINNED path resolves to.
const ALPHA = `inst-alpha-cal-${RUN}`
const BETA = `inst-beta-cal-${RUN}`
const ALPHA_ORG = `org-alpha-cal-${RUN}`
const BETA_ORG = `org-beta-cal-${RUN}`
const USER = `user-cal-${RUN}`
const ALPHA_EVENT_TITLE = `Alpha-only strategy session ${RUN}`
const BETA_EVENT_TITLE = `Beta-only strategy session ${RUN}`

/** Tomorrow, so both events sit inside the feed's -30/+180 day window. */
const START = new Date(Date.now() + 864e5)
const END = new Date(START.getTime() + 3600_000)

async function feed(token: string): Promise<Response> {
  return GET(new Request(`https://tenure.test/api/calendar/ics/${token}`), {
    params: Promise.resolve({ token }),
  })
}

async function mint(institutionId: string, epoch: number, at = new Date()): Promise<string> {
  const selector = await runUnscoped("seed", "mint calendar token for fixture", () =>
    calendarSelectorFor(USER, institutionId),
  )
  return calendarToken(USER, institutionId, epoch, selector, at)
}

async function cleanup() {
  await runUnscoped("seed", "calendar token fixture teardown", async () => {
    await db.event.deleteMany({ where: { institutionId: { in: [ALPHA, BETA] } } })
    await db.roleAssignment.deleteMany({ where: { userId: USER } })
    await db.role.deleteMany({ where: { organizationId: { in: [ALPHA_ORG, BETA_ORG] } } })
    await db.organization.deleteMany({ where: { id: { in: [ALPHA_ORG, BETA_ORG] } } })
    await db.institutionMembership.deleteMany({ where: { userId: USER } })
    await db.user.deleteMany({ where: { id: USER } })
    await db.institution.deleteMany({ where: { id: { in: [ALPHA, BETA] } } })
  })
}

beforeAll(async () => {
  await cleanup()
  await runUnscoped("seed", "calendar token fixture", async () => {
    for (const [id, name] of [
      [ALPHA, "Alpha University"],
      [BETA, "Beta College"],
    ] as const) {
      await db.institution.create({
        data: { id, name, slug: `${id}`, serving: true, timeZone: "America/New_York" },
      })
    }

    await db.user.create({ data: { id: USER, email: `${USER}@example.invalid`, name: "Two Seats" } })

    // An OSE seat at BOTH institutions. That is the shape that makes the bug
    // reachable: one credential, two tenants, and nothing in the old token
    // saying which one it was for.
    for (const institutionId of [ALPHA, BETA]) {
      await db.institutionMembership.create({
        data: { userId: USER, institutionId, role: "OSE_STAFF" },
      })
    }

    for (const [orgId, institutionId, name] of [
      [ALPHA_ORG, ALPHA, "Alpha Consulting Club"],
      [BETA_ORG, BETA, "Beta Consulting Club"],
    ] as const) {
      await db.organization.create({
        data: { id: orgId, institutionId, name, slug: orgId, status: "ACTIVE" },
      })
    }

    for (const [orgId, institutionId, title] of [
      [ALPHA_ORG, ALPHA, ALPHA_EVENT_TITLE],
      [BETA_ORG, BETA, BETA_EVENT_TITLE],
    ] as const) {
      await db.event.create({
        data: {
          institutionId,
          organizationId: orgId,
          title,
          startAt: START,
          endAt: END,
          status: "PUBLISHED",
        },
      })
    }
  })
})

afterAll(async () => {
  await cleanup()
  await db.$disconnect()
})

/** The revocation counter as the database currently holds it. */
async function epochOf(): Promise<number> {
  const row = await runUnscoped("seed", "read epoch", () =>
    db.user.findUnique({ where: { id: USER }, select: { calendarTokenEpoch: true } }),
  )
  return row?.calendarTokenEpoch ?? 0
}

async function setEpoch(value: number) {
  await runUnscoped("seed", "bump epoch", () =>
    db.user.update({ where: { id: USER }, data: { calendarTokenEpoch: value } }),
  )
}

describe("the feed serves the tenant the token was minted in", () => {
  it("returns BETA's events for a BETA token, and none of ALPHA's", async () => {
    const res = await feed(await mint(BETA, await epochOf()))
    expect(res.status).toBe(200)

    const ics = await res.text()
    expect(ics).toContain(BETA_EVENT_TITLE)
    // The whole point. Without `{ institutionId }` on the scope call this line
    // fails: the unpinned path resolves ALPHA, which sorts first.
    expect(ics).not.toContain(ALPHA_EVENT_TITLE)
  })

  it("returns ALPHA's events for an ALPHA token, and none of BETA's", async () => {
    // The mirror case, so the assertion above cannot pass by the fixture
    // happening to make one institution unreachable.
    const res = await feed(await mint(ALPHA, await epochOf()))
    expect(res.status).toBe(200)

    const ics = await res.text()
    expect(ics).toContain(ALPHA_EVENT_TITLE)
    expect(ics).not.toContain(BETA_EVENT_TITLE)
  })

  it("never sets a shared-cache header on a per-user feed", async () => {
    const res = await feed(await mint(BETA, await epochOf()))
    // `public, max-age=1800` in front of a CDN hands one student's calendar to
    // the next request for the same path prefix.
    expect(res.headers.get("cache-control")).toBe("private, no-store")
  })
})

describe("the refusals, through the route", () => {
  it("EXPIRED: a token older than the maximum age is 403", async () => {
    const epoch = await epochOf()
    const stale = await mint(BETA, epoch, new Date(Date.now() - CALENDAR_TOKEN_MAX_AGE_MS - 60_000))
    const res = await feed(stale)
    expect(res.status).toBe(403)

    // …and one just inside the window still works, so the assertion above is
    // about the age and not about the fixture being broken.
    const fresh = await mint(BETA, epoch, new Date(Date.now() - CALENDAR_TOKEN_MAX_AGE_MS + 600_000))
    expect((await feed(fresh)).status).toBe(200)
  })

  it("REVOKED: bumping the counter kills every URL already issued", async () => {
    const before = await epochOf()
    const token = await mint(BETA, before)
    expect((await feed(token)).status).toBe(200)

    await setEpoch(before + 1)
    try {
      // Same URL, same signature, same age. The only thing that changed is a
      // number in the database, and that is what "already consumed" means for a
      // credential a calendar client is supposed to replay forever.
      expect((await feed(token)).status).toBe(403)

      // A freshly minted one works immediately — revocation is not a lockout.
      expect((await feed(await mint(BETA, before + 1))).status).toBe(200)
    } finally {
      await setEpoch(before)
    }
  })

  it("TAMPERED: editing any field of a valid token is 403", async () => {
    const token = await mint(BETA, await epochOf())
    const parts = token.split(".")

    for (let i = 0; i < parts.length; i += 1) {
      const broken = [...parts]
      broken[i] = i === 0 ? "v9" : `${parts[i]}x`
      const res = await feed(broken.join("."))
      expect([403, 200]).toContain(res.status)
      expect(res.status).toBe(403)
    }
  })

  it("WRONG-USER: a token naming an account that does not exist is 403, not 200", async () => {
    const token = await mint(BETA, await epochOf())
    const parts = token.split(".")
    const stranger = [
      parts[0],
      Buffer.from(`${USER}-does-not-exist`).toString("base64url"),
      ...parts.slice(2),
    ].join(".")
    expect((await feed(stranger)).status).toBe(403)
  })

  it("WRONG-TENANT: a token naming an institution the holder has left is 403", async () => {
    const token = await mint(BETA, await epochOf())
    await runUnscoped("seed", "revoke the beta seat", () =>
      db.institutionMembership.deleteMany({ where: { userId: USER, institutionId: BETA } }),
    )
    try {
      // `resolveTenantScope` re-proves the membership on every request, so the
      // pinned institution is a claim the database still has to agree with.
      // A 500 here would mean the refusal escaped as a server fault.
      expect((await feed(token)).status).toBe(403)
    } finally {
      await runUnscoped("seed", "restore the beta seat", () =>
        db.institutionMembership.create({
          data: { userId: USER, institutionId: BETA, role: "OSE_STAFF" },
        }),
      )
    }
  })

  it("MALFORMED: the token format this replaced is refused rather than misread", async () => {
    const legacy = `${Buffer.from(USER).toString("base64url")}.abcdef`
    expect((await feed(legacy)).status).toBe(403)
    expect((await feed("")).status).toBe(403)
  })

  it("REPLAYED: a valid token answers every poll, which is what a subscription is", async () => {
    const token = await mint(BETA, await epochOf())
    for (let poll = 0; poll < 3; poll += 1) {
      expect((await feed(token)).status).toBe(200)
    }
  })
})

describe("WRK-060-005 — recurrence reaches the feed and the grid", () => {
  const SERIES_TITLE = `Weekly board meeting ${RUN}`

  beforeAll(async () => {
    await runUnscoped("seed", "recurring fixture", async () => {
      // Seeded four weeks in the past so the series master starts OUTSIDE any
      // week a grid would show, which is the case that used to produce nothing.
      const seeded = new Date(Date.now() - 28 * 864e5)
      await db.event.create({
        data: {
          institutionId: BETA,
          organizationId: BETA_ORG,
          title: SERIES_TITLE,
          startAt: seeded,
          endAt: new Date(seeded.getTime() + 3600_000),
          status: "PUBLISHED",
          recurrenceRule: "FREQ=WEEKLY",
        },
      })
    })
  })

  it("the ICS feed carries the series as one VEVENT and an RRULE line", async () => {
    const ics = await (await feed(await mint(BETA, await epochOf()))).text()

    expect(ics).toContain(SERIES_TITLE)
    expect(ics).toContain("RRULE:FREQ=WEEKLY")

    // One VEVENT for the series, not one per occurrence — otherwise a student's
    // Outlook shows the same meeting a dozen times.
    const summaries = ics.split("\r\n").filter((l) => l === `SUMMARY:${SERIES_TITLE}`)
    expect(summaries).toHaveLength(1)
  })

  it("`loadScopedEvents` expands the series into the week a grid asks for", async () => {
    const { loadScopedEvents } = await import("@/lib/calendar-data")
    const { runInTenantScope } = await import("@/lib/tenancy/context")

    // A week two weeks AFTER the master's start — the master itself is nowhere
    // near it, so anything returned here is a generated occurrence.
    const from = new Date(Date.now() - 15 * 864e5)
    const to = new Date(from.getTime() + 7 * 864e5)

    const rows = await runInTenantScope(
      {
        institutionId: BETA,
        purpose: "interactive",
        environment: "test",
        actor: { principalId: USER, principalType: "user" },
      },
      () => loadScopedEvents(USER, from, to),
    )

    const series = rows.filter((r) => r.title === SERIES_TITLE)
    // The master (carrying the rule) plus at least one generated occurrence.
    expect(series.some((r) => r.recurrenceRule !== null)).toBe(true)

    const generated = series.filter((r) => r.occurrenceOf !== null)
    expect(generated.length).toBeGreaterThan(0)
    for (const row of generated) {
      expect(row.startAt.getTime()).toBeGreaterThanOrEqual(from.getTime())
      expect(row.startAt.getTime()).toBeLessThan(to.getTime())
      // A synthetic id the inspector route splits back apart.
      expect(row.id.startsWith(`${row.occurrenceOf}~`)).toBe(true)
    }
  })
})
