import {
  CALENDAR_TOKEN_MAX_AGE_MS,
  calendarToken,
  calendarTokenSubject,
  eventsToICS,
  verifyCalendarToken,
} from "@/lib/calendar-sync"
import type { ScopedEvent } from "@/lib/calendar-data"
import type { CalendarSelector } from "@/lib/connections/selector-consent"

/**
 * WRK-030-006 and WRK-060-005, at the unit level.
 *
 * This file did not exist. The module carrying Tenure's only launch-token-shaped
 * credential, and the one that renders the calendar every student subscribes to,
 * had no test of any kind.
 *
 * ## What this file proves and what it does NOT
 *
 * These are statements about the token FUNCTIONS. The route is the producer, and
 * a test that proves a property by calling the helper directly stays green the
 * day the route stops calling it — so every refusal below is ALSO asserted
 * against what `GET /api/calendar/ics/[token]` returns, in
 * `apps/web/src/lib/calendar-token.itest.ts`, against real Postgres. Both exist
 * on purpose: this one names the case, that one proves the case reaches a user.
 */

const NOW = new Date("2026-09-15T12:00:00.000Z")
const USER = "user_abc123"
const INSTITUTION = "inst_rochester"
const OTHER_INSTITUTION = "inst_syracuse"

const SELECTOR: CalendarSelector = {
  institutionId: INSTITUTION,
  organizationIds: ["org_consulting", "org_finance"],
  institutionWide: false,
}

function mint(overrides?: {
  userId?: string
  institutionId?: string
  epoch?: number
  selector?: CalendarSelector
  at?: Date
}): string {
  return calendarToken(
    overrides?.userId ?? USER,
    overrides?.institutionId ?? INSTITUTION,
    overrides?.epoch ?? 0,
    overrides?.selector ?? SELECTOR,
    overrides?.at ?? NOW
  )
}

describe("the seven launch-token cases", () => {
  it("WRONG-USER: the subject IS the payload, so a token cannot name one person and authenticate another", () => {
    const mine = mint({ userId: "user_me" })
    const theirs = mint({ userId: "user_them" })

    expect(verifyCalendarToken(mine, 0, NOW)?.userId).toBe("user_me")
    expect(verifyCalendarToken(theirs, 0, NOW)?.userId).toBe("user_them")

    // Swapping the subject field of a valid token invalidates the MAC — there
    // is no way to present one person's signature over another person's id.
    const parts = mine.split(".")
    const forged = [parts[0], theirs.split(".")[1], ...parts.slice(2)].join(".")
    expect(verifyCalendarToken(forged, 0, NOW)).toBeNull()
  })

  it("WRONG-TENANT: the institution travels in the token and comes back in the claims", () => {
    const inA = mint({ institutionId: INSTITUTION })
    expect(verifyCalendarToken(inA, 0, NOW)?.institutionId).toBe(INSTITUTION)

    // The route pins the scope to this value rather than resolving the acting
    // choice, which is what stops the same URL serving a second institution
    // after a switch. That leg is proved end-to-end in calendar-token.itest.ts.
    const inB = mint({
      institutionId: OTHER_INSTITUTION,
      selector: { ...SELECTOR, institutionId: OTHER_INSTITUTION },
    })
    expect(verifyCalendarToken(inB, 0, NOW)?.institutionId).toBe(OTHER_INSTITUTION)
    expect(verifyCalendarToken(inA, 0, NOW)?.institutionId).not.toBe(OTHER_INSTITUTION)
  })

  it("TAMPERED: every field is inside the MAC", () => {
    const good = mint()
    const parts = good.split(".")

    // One mutation per field, each re-signed by nobody.
    for (let i = 0; i < parts.length - 1; i += 1) {
      const broken = [...parts]
      broken[i] = i === 0 ? "v9" : `${parts[i]}x`
      expect(verifyCalendarToken(broken.join("."), 0, NOW)).toBeNull()
    }

    // And the MAC itself.
    expect(
      verifyCalendarToken([...parts.slice(0, -1), "notasignature"].join("."), 0, NOW)
    ).toBeNull()
    // A token signed with a different secret is the same failure.
    expect(verifyCalendarToken(`${parts.slice(0, -1).join(".")}.${"A".repeat(43)}`, 0, NOW)).toBeNull()
  })

  it("EXPIRED: a token older than the maximum age stops verifying", () => {
    const token = mint({ at: NOW })

    const justInside = new Date(NOW.getTime() + CALENDAR_TOKEN_MAX_AGE_MS - 1000)
    expect(verifyCalendarToken(token, 0, justInside)).not.toBeNull()

    const justOutside = new Date(NOW.getTime() + CALENDAR_TOKEN_MAX_AGE_MS + 1000)
    expect(verifyCalendarToken(token, 0, justOutside)).toBeNull()

    // A token dated far in the future is refused too — a clock that disagrees
    // by six months is not skew, it is a forged issue time buying extra life.
    const fromTheFuture = mint({ at: new Date(NOW.getTime() + 3600_000) })
    expect(verifyCalendarToken(fromTheFuture, 0, NOW)).toBeNull()
  })

  it("ALREADY-CONSUMED, as REVOCATION: the epoch is what stops honouring an issued token", () => {
    const token = mint({ epoch: 3 })

    expect(verifyCalendarToken(token, 3, NOW)?.epoch).toBe(3)
    // The counter moved — the holder or an administrator revoked the feed.
    expect(verifyCalendarToken(token, 4, NOW)).toBeNull()
    // And an older counter does not work either: this is equality, not a floor,
    // so a replayed OLD token cannot be honoured by a rolled-back row.
    expect(verifyCalendarToken(token, 2, NOW)).toBeNull()
  })

  it("REPLAYED: replay is the feature, and is bounded by the other four refusals", () => {
    // A calendar client polls this URL every few hours, forever. Single-use
    // would break the only thing the credential does, so the honest statement
    // is that replay SUCCEEDS while the token is unexpired and unrevoked, and
    // fails the instant either changes. Asserting "replay is refused" here
    // would be asserting a property this product must not have.
    const token = mint()
    for (let poll = 0; poll < 5; poll += 1) {
      expect(verifyCalendarToken(token, 0, new Date(NOW.getTime() + poll * 3600_000))).not.toBeNull()
    }
    expect(verifyCalendarToken(token, 1, NOW)).toBeNull()
    expect(
      verifyCalendarToken(token, 0, new Date(NOW.getTime() + CALENDAR_TOKEN_MAX_AGE_MS + 1))
    ).toBeNull()
  })

  it("WRONG-SESSION: there is no session to bind to, and that is the design", () => {
    // Outlook, Google Calendar and Apple Calendar cannot send a cookie; the
    // whole reason this credential exists is that they cannot. A token bound to
    // a browser session would stop working at the holder's next sign-out, so
    // this case has no mechanism ON PURPOSE and the token carries no session
    // field for one to hang off.
    const claims = verifyCalendarToken(mint(), 0, NOW)
    expect(claims).not.toBeNull()
    expect(Object.keys(claims!)).not.toContain("sessionId")
  })

  it("MALFORMED: a version prefix from another format is a refusal, not a misparse", () => {
    expect(verifyCalendarToken("", 0, NOW)).toBeNull()
    expect(verifyCalendarToken("garbage", 0, NOW)).toBeNull()
    // The exact shape the previous implementation issued: base64url(userId).mac.
    const legacy = `${Buffer.from(USER).toString("base64url")}.abcdef`
    expect(verifyCalendarToken(legacy, 0, NOW)).toBeNull()
    expect(calendarTokenSubject(legacy)).toBeNull()
  })

  it("the unverified subject reader is only good for choosing which counter to check", () => {
    expect(calendarTokenSubject(mint({ userId: "user_zed" }))).toBe("user_zed")
    // It reads a field; it authenticates nothing. A token whose MAC is wrong
    // still has a readable subject, and that is exactly why the route looks the
    // epoch up with it and then verifies rather than trusting it.
    const parts = mint({ userId: "user_zed" }).split(".")
    const tampered = [...parts.slice(0, -1), "x".repeat(43)].join(".")
    expect(calendarTokenSubject(tampered)).toBe("user_zed")
    expect(verifyCalendarToken(tampered, 0, NOW)).toBeNull()
  })
})

// ─── WRK-060-005: the document a subscriber receives ─────────────────────────

function event(over: Partial<ScopedEvent> = {}): ScopedEvent {
  return {
    id: "evt_1",
    title: "Weekly board meeting",
    description: null,
    startAt: new Date("2026-09-02T22:00:00.000Z"),
    endAt: new Date("2026-09-03T00:00:00.000Z"),
    venue: "Schlegel 203",
    status: "PUBLISHED",
    organizationId: "org_consulting",
    organizationName: "Consulting Club",
    ownerRoleId: null,
    hardConflicts: 0,
    recurrenceRule: null,
    occurrenceOf: null,
    ...over,
  }
}

/** The lines of one VEVENT, unfolded enough for these assertions. */
function vevents(ics: string): string[][] {
  const out: string[][] = []
  let current: string[] | null = null
  for (const line of ics.split("\r\n")) {
    if (line === "BEGIN:VEVENT") current = []
    else if (line === "END:VEVENT") {
      if (current) out.push(current)
      current = null
    } else if (current) current.push(line)
  }
  return out
}

describe("a recurring event reaches a calendar client as one VEVENT and a rule", () => {
  it("emits an RRULE line for the series master", () => {
    const ics = eventsToICS([event({ recurrenceRule: "FREQ=WEEKLY;BYDAY=WE" })])
    const [only] = vevents(ics)
    expect(only).toContain("RRULE:FREQ=WEEKLY;BYDAY=WE")
    expect(only).toContain("DTSTART:20260902T220000Z")
  })

  it("emits no RRULE for a one-off event", () => {
    const ics = eventsToICS([event()])
    expect(ics).not.toContain("RRULE")
  })

  it("skips the generated occurrences, so a weekly meeting is not sent twelve times", () => {
    const master = event({ id: "evt_1", recurrenceRule: "FREQ=WEEKLY;BYDAY=WE;COUNT=3" })
    const generated = [1, 2].map((n) =>
      event({
        id: `evt_1~${n}`,
        recurrenceRule: null,
        occurrenceOf: "evt_1",
        startAt: new Date(`2026-09-${9 + (n - 1) * 7}T22:00:00.000Z`),
      })
    )

    const produced = vevents(eventsToICS([master, ...generated]))
    expect(produced).toHaveLength(1)
    expect(produced[0]).toContain("UID:evt_1@tenure")
    expect(produced[0]).toContain("RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=3")
  })

  it("normalises the stored rule rather than forwarding it verbatim", () => {
    // Stored with a redundant INTERVAL=1 and an unsorted BYDAY. What goes out is
    // the canonical form Tenure's own grid expands, so the feed and the grid
    // cannot describe different meetings.
    const ics = eventsToICS([event({ recurrenceRule: "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=WE,MO" })])
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO,WE")
    expect(ics).not.toContain("INTERVAL=1")
  })

  it("emits NO rule at all for a stored rule Tenure cannot expand", () => {
    // `BYSETPOS` is real RFC 5545 and this application does not implement it.
    // Forwarding it would have a subscriber's client show meetings Tenure never
    // shows; silence is the honest answer, and the event still appears once.
    const ics = eventsToICS([event({ recurrenceRule: "FREQ=WEEKLY;BYSETPOS=-1" })])
    expect(ics).not.toContain("RRULE")
    expect(vevents(ics)).toHaveLength(1)
  })
})
