import type { UserContext } from "@/lib/rbac"

/**
 * The gate, exercised through the function the HTTP route actually calls.
 *
 * `calendar-conflict-policy.test.ts` proves the rule; this proves the rule is
 * REACHED — that `rescheduleEvent` refuses before it writes, that the row is
 * untouched afterwards, and that both outcomes leave an audit row. Testing the
 * policy alone would have passed just as happily while nothing called it, which
 * is exactly the state this requirement was opened against.
 *
 * The database stand-in is a table, not a canned answer: `findMany` filters the
 * same rows `update` mutates, so the conflicts under test are produced by the
 * real detector reading real state, and a write that should not have happened
 * shows up as a changed row.
 */

interface EventRow {
  id: string
  institutionId: string
  organizationId: string
  ownerRoleId: string | null
  title: string
  description: string | null
  venue: string | null
  startAt: Date
  endAt: Date
  status: string
  conflictSummary: unknown
}

const events = new Map<string, EventRow>()
const auditRows: { action: string; outcome: string; reason: string | null; metadata: Record<string, unknown> }[] = []
let conflictRows: { eventId: string; conflictWithEventId: string | null; severity: string; reason: string }[] = []
const notified: { title: string; body?: string }[] = []
let actorContext: UserContext = { userId: "u_actor", institutionRoles: [], orgRoles: [] }

const INST = "inst_1"
const ORG = "org_a"

function matchesWindow(row: EventRow, where: Record<string, never>): boolean {
  const w = where as unknown as {
    institutionId: string
    status: { not: string }
    id: { not: string }
    startAt: { gte: Date }
    endAt: { lte: Date }
  }
  return (
    row.institutionId === w.institutionId &&
    row.status !== w.status.not &&
    row.id !== w.id.not &&
    row.startAt >= w.startAt.gte &&
    row.endAt <= w.endAt.lte
  )
}

jest.mock("@/lib/db", () => ({
  db: {
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
    event: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = events.get(where.id)
        if (!row) return null
        return {
          ...row,
          organization: { name: "Consulting Club", institutionId: row.institutionId },
          approval: null,
        }
      },
      findMany: async ({ where }: { where: Record<string, never> }) =>
        [...events.values()].filter((r) => matchesWindow(r, where)),
      update: async ({ where, data }: { where: { id: string }; data: Partial<EventRow> }) => {
        const row = events.get(where.id)
        if (!row) throw new Error(`no such event ${where.id}`)
        Object.assign(row, data)
        return row
      },
    },
    conflictRecord: {
      deleteMany: async ({ where }: { where: { eventId: string } }) => {
        conflictRows = conflictRows.filter((c) => c.eventId !== where.eventId)
        return { count: 0 }
      },
      createMany: async ({ data }: { data: (typeof conflictRows)[number][] }) => {
        conflictRows.push(...data)
        return { count: data.length }
      },
    },
    auditEvent: {
      create: async ({ data }: { data: (typeof auditRows)[number] }) => {
        auditRows.push(data)
        return data
      },
    },
    approvalRequest: { update: async () => ({}) },
    approvalStep: { create: async () => ({}) },
  },
}))

jest.mock("@/lib/rbac", () => ({
  getUserContext: async () => actorContext,
  isOse: (ctx: UserContext, institutionId: string) =>
    ctx.institutionRoles.some((m) => m.institutionId === institutionId),
}))

jest.mock("@/lib/tenant-scope", () => ({
  withTenantScope: <T,>(_userId: string, fn: () => Promise<T>) => fn(),
}))

jest.mock("@/lib/institution-time", () => ({
  institutionTimeZone: async () => "UTC",
}))

jest.mock("@/lib/notify", () => ({
  notifyUsers: async (_ids: string[], opts: { title: string; body?: string }) => {
    notified.push(opts)
  },
  orgPresidentIds: async () => ["u_president"],
}))

import { rescheduleEvent, updateEventDetails } from "./calendar-write"

const d = (iso: string) => new Date(iso)

/** The event being moved: 1–3pm, and its own room. */
const SUBJECT: EventRow = {
  id: "ev_subject",
  institutionId: INST,
  organizationId: ORG,
  ownerRoleId: "role_1",
  title: "Case Prep Night",
  description: null,
  venue: "Schlegel 203",
  startAt: d("2026-10-01T13:00:00Z"),
  endAt: d("2026-10-01T15:00:00Z"),
  status: "PUBLISHED",
  conflictSummary: {},
}

/** Another club already holds that room 6–9pm — the wall the move runs into. */
const BLOCKER: EventRow = {
  id: "ev_blocker",
  institutionId: INST,
  organizationId: "org_b",
  ownerRoleId: null,
  title: "Robotics Build",
  description: null,
  venue: "schlegel 203",
  startAt: d("2026-10-01T18:00:00Z"),
  endAt: d("2026-10-01T21:00:00Z"),
  status: "PUBLISHED",
  conflictSummary: {},
}

/** Move onto the blocker: 7–8pm, same room. */
const INTO_CLASH = { date: "2026-10-01", startMinute: 19 * 60, endMinute: 20 * 60 }
/** A clear slot the same day: 9–10am. */
const CLEAR = { date: "2026-10-01", startMinute: 9 * 60, endMinute: 10 * 60 }

const president: UserContext = {
  userId: "u_actor",
  institutionRoles: [],
  orgRoles: [
    {
      organizationId: ORG,
      roleId: "role_1",
      roleName: "President",
      templateKey: "unit.lead",
      scope: "PRESIDENT",
      status: "ACTIVE",
    },
  ],
}

const director: UserContext = {
  userId: "u_actor",
  institutionRoles: [{ institutionId: INST, role: "OSE_DIRECTOR" }],
  orgRoles: [],
}

/** OSE Staff: administrative, but below the `event.override` bar. */
const staff: UserContext = {
  userId: "u_actor",
  institutionRoles: [{ institutionId: INST, role: "OSE_STAFF" }],
  orgRoles: [],
}

const REASON = "Robotics released the room in writing; facilities confirmed."

beforeEach(() => {
  events.clear()
  events.set(SUBJECT.id, { ...SUBJECT })
  events.set(BLOCKER.id, { ...BLOCKER })
  auditRows.length = 0
  conflictRows = []
  notified.length = 0
  actorContext = president
})

const subject = () => events.get(SUBJECT.id)!
const actions = () => auditRows.map((a) => a.action)

describe("rescheduleEvent — the hard-conflict gate", () => {
  it("moves the event when nothing blocks", async () => {
    const result = await rescheduleEvent("u_actor", SUBJECT.id, CLEAR)

    expect(result).toEqual({
      startISO: "2026-10-01T09:00:00.000Z",
      endISO: "2026-10-01T10:00:00.000Z",
    })
    expect(subject().startAt.toISOString()).toBe("2026-10-01T09:00:00.000Z")
    expect(actions()).toContain("Event.Rescheduled")
    expect(actions()).not.toContain("Event.ConflictBlocked")
    expect(actions()).not.toContain("Event.ConflictOverridden")
  })

  it("refuses the move into a venue clash, and leaves the row where it was", async () => {
    const result = await rescheduleEvent("u_actor", SUBJECT.id, INTO_CLASH)

    expect(result).toEqual({
      error: expect.stringContaining("venue double-booking"),
    })
    // The decisive assertion: the write did not happen.
    expect(subject().startAt).toEqual(SUBJECT.startAt)
    expect(subject().endAt).toEqual(SUBJECT.endAt)
    // Nor did the rejected proposal leave conflicts behind on the calendar.
    expect(conflictRows).toEqual([])
    expect(actions()).toEqual(["Event.ConflictBlocked"])

    const blocked = auditRows[0]
    expect(blocked.outcome).toBe("DENY")
    expect(blocked.metadata.rules).toEqual(["VENUE_DOUBLE_BOOKING"])
    expect(blocked.metadata.code).toBe("NO_OVERRIDE_AUTHORITY")
    expect(blocked.metadata.attempted).toBe("Event.Rescheduled")
    expect(blocked.reason).toContain("Robotics Build")
  })

  it("refuses an OSE role that sits below the override capability", async () => {
    actorContext = staff
    const result = await rescheduleEvent("u_actor", SUBJECT.id, INTO_CLASH)

    expect(result).toEqual({ error: expect.stringContaining("Blocked by") })
    expect(auditRows[0].metadata.code).toBe("NO_OVERRIDE_AUTHORITY")
    expect(subject().startAt).toEqual(SUBJECT.startAt)
  })

  it("refuses an override-holder who did not ask to override", async () => {
    actorContext = director
    const result = await rescheduleEvent("u_actor", SUBJECT.id, INTO_CLASH)

    expect(result).toEqual({ error: expect.stringContaining("Override events") })
    expect(auditRows[0].metadata.code).toBe("OVERRIDE_NOT_REQUESTED")
    expect(subject().startAt).toEqual(SUBJECT.startAt)
  })

  it("refuses an override that records no usable reason", async () => {
    actorContext = director
    const result = await rescheduleEvent("u_actor", SUBJECT.id, {
      ...INTO_CLASH,
      override: { requested: true, reason: "why" },
    })

    expect(result).toEqual({ error: expect.stringContaining("at least") })
    expect(auditRows[0].metadata.code).toBe("OVERRIDE_REASON_REQUIRED")
    expect(subject().startAt).toEqual(SUBJECT.startAt)
  })

  it("allows an explicit, reasoned override and records it as its own decision", async () => {
    actorContext = director
    const result = await rescheduleEvent("u_actor", SUBJECT.id, {
      ...INTO_CLASH,
      override: { requested: true, reason: REASON },
    })

    expect(result).toEqual({
      startISO: "2026-10-01T19:00:00.000Z",
      endISO: "2026-10-01T20:00:00.000Z",
    })
    expect(subject().startAt.toISOString()).toBe("2026-10-01T19:00:00.000Z")

    expect(actions()).toEqual(["Event.Rescheduled", "Event.ConflictOverridden"])
    const overridden = auditRows[1]
    expect(overridden.outcome).toBe("ALLOW")
    expect(overridden.reason).toBe(REASON)
    expect(overridden.metadata.rules).toEqual(["VENUE_DOUBLE_BOOKING"])
    expect(overridden.metadata.conflictWithEventIds).toEqual(["ev_blocker"])
    expect(overridden.metadata.capability).toBe("event.override")
    expect(auditRows[0].metadata.overriddenRules).toEqual(["VENUE_DOUBLE_BOOKING"])

    // The conflict it was moved onto is recorded on the calendar, and the
    // presidents are told why the clash is there.
    expect(conflictRows.map((c) => c.severity)).toEqual(["HARD"])
    expect(notified[0].body).toContain(REASON)
  })

  it("does not treat an advisory conflict as a wall", async () => {
    // Same time as the blocker, different room: AUDIENCE_OVERLAP only.
    events.get(BLOCKER.id)!.venue = "Gleason 118"
    const result = await rescheduleEvent("u_actor", SUBJECT.id, INTO_CLASH)

    expect(result).toEqual({
      startISO: "2026-10-01T19:00:00.000Z",
      endISO: "2026-10-01T20:00:00.000Z",
    })
    expect(actions()).toEqual(["Event.Rescheduled"])
    expect(conflictRows.map((c) => c.severity)).toEqual(["SOFT"])
  })
})

describe("updateEventDetails — the same gate on the other door", () => {
  it("refuses a venue edit that books an occupied room", async () => {
    // The subject already sits 1–3pm; move the blocker onto those hours in a
    // different room, then try to type that room into the inspector.
    const blocker = events.get(BLOCKER.id)!
    blocker.startAt = d("2026-10-01T13:00:00Z")
    blocker.endAt = d("2026-10-01T15:00:00Z")
    blocker.venue = "Gleason 118"

    const result = await updateEventDetails("u_actor", SUBJECT.id, {
      title: "Case Prep Night",
      venue: "Gleason 118",
      description: null,
    })

    expect(result).toEqual({ error: expect.stringContaining("venue double-booking") })
    expect(subject().venue).toBe("Schlegel 203")
    expect(actions()).toEqual(["Event.ConflictBlocked"])
    expect(auditRows[0].metadata.attempted).toBe("Event.Edited")
  })

  it("lets an authorized, reasoned override through and audits it", async () => {
    actorContext = director
    const blocker = events.get(BLOCKER.id)!
    blocker.startAt = d("2026-10-01T13:00:00Z")
    blocker.endAt = d("2026-10-01T15:00:00Z")
    blocker.venue = "Gleason 118"

    const result = await updateEventDetails("u_actor", SUBJECT.id, {
      title: "Case Prep Night",
      venue: "Gleason 118",
      description: null,
      override: { requested: true, reason: REASON },
    })

    expect(result).toEqual({ ok: true })
    expect(subject().venue).toBe("Gleason 118")
    expect(actions()).toEqual(["Event.ConflictOverridden", "Event.Edited"])
    expect(auditRows[0].metadata.rules).toEqual(["VENUE_DOUBLE_BOOKING"])
  })

  it("leaves an edit that does not touch the venue ungated", async () => {
    const result = await updateEventDetails("u_actor", SUBJECT.id, {
      title: "Case Prep Night — week 2",
      venue: "Schlegel 203",
      description: "Bring laptops.",
    })

    expect(result).toEqual({ ok: true })
    expect(subject().title).toBe("Case Prep Night — week 2")
    expect(actions()).toEqual(["Event.Edited"])
  })
})
