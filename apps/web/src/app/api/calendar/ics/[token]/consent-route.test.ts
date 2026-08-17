/**
 * WRK-020-005, at the ROUTE — the half nothing proved.
 *
 * `src/lib/connections/selector-consent.test.ts` proves the comparison:
 * `consentVerdict` calls a widened scope EXPANDED and `consentedIntersection`
 * returns no more than was agreed. Its header says the behavioural proof runs
 * "against real Postgres through the ICS route (`selector-consent.itest.ts`)"
 * and THAT FILE DOES NOT EXIST — `find src -name '*selector-consent*'` returns
 * the module and its unit test and nothing else, and `calendar-token.itest.ts`,
 * the only itest touching this route, contains no occurrence of "consent",
 * "EXPANDED" or "intersection". So the route's use of the comparison was
 * unproven in both places it was claimed.
 *
 * That gap is the one this repository keeps recording: a correct rule with
 * nothing standing on it. `GET /api/calendar/ics/[token]` is the producer, and
 * these assert what it emits — which selector `loadScopedEvents` is narrowed to,
 * what the calendar client is told, and what the response headers carry.
 *
 * ## What is mocked and what is real
 *
 * Real: `verifyCalendarToken` and `calendarToken` (the token is minted and
 * verified for real, so the pinned selector genuinely round-trips through an
 * HMAC), `selectorDigest`, `consentVerdict`, `consentedIntersection`,
 * `eventsToICS`. Mocked: the three database reads in `@/lib/calendar-data` and
 * `withTenantScope`, which is what a Postgres itest would supply.
 *
 * `loadScopedEvents` is a spy rather than a filter, deliberately: the property
 * under test is that the ROUTE decides to narrow the query, and applying the
 * predicate is `calendar-data.ts`'s own job (its `consentClause` is asserted
 * there). A fake that filtered would let the route pass its own decision through
 * unexamined as long as the fake got it right.
 */

const loadScopedEvents = jest.fn()
const calendarSelectorFor = jest.fn()
const calendarTokenEpochFor = jest.fn()

jest.mock("@/lib/calendar-data", () => ({
  loadScopedEvents: (...args: unknown[]) => loadScopedEvents(...args),
  calendarSelectorFor: (...args: unknown[]) => calendarSelectorFor(...args),
  calendarTokenEpochFor: (...args: unknown[]) => calendarTokenEpochFor(...args),
}))

jest.mock("@/lib/tenant-scope", () => ({
  withTenantScope: (
    _userId: string,
    fn: (scope: { institutionId: string }) => Promise<unknown>,
    opts?: { institutionId?: string },
  ) => fn({ institutionId: opts?.institutionId ?? "" }),
}))

import { calendarToken } from "@/lib/calendar-sync"
import type { CalendarSelector } from "@/lib/connections/selector-consent"

import { GET } from "./route"

const USER = "user-priya"
const INSTITUTION = "inst-rochester"
const EPOCH = 3

/** What the holder agreed to share when they pasted the URL into Outlook. */
const PINNED: CalendarSelector = {
  institutionId: INSTITUTION,
  organizationIds: ["org-consulting", "org-finance"],
  institutionWide: false,
}

function request(token: string) {
  return GET(new Request(`https://tenure.test/api/calendar/ics/${token}.ics`), {
    params: Promise.resolve({ token: `${token}.ics` }),
  })
}

/** The consented selector the route narrowed the query to, or undefined. */
function narrowedTo(): CalendarSelector | undefined {
  expect(loadScopedEvents).toHaveBeenCalledTimes(1)
  const opts = loadScopedEvents.mock.calls[0][3] as { consented?: CalendarSelector } | undefined
  return opts?.consented
}

beforeEach(() => {
  loadScopedEvents.mockReset().mockResolvedValue([])
  calendarSelectorFor.mockReset()
  calendarTokenEpochFor.mockReset().mockResolvedValue(EPOCH)
})

describe("a feed whose holder's access has widened", () => {
  it("serves the intersection, not what they can see today", async () => {
    // Joined the robotics club after subscribing.
    calendarSelectorFor.mockResolvedValue({
      institutionId: INSTITUTION,
      organizationIds: ["org-consulting", "org-finance", "org-robotics"],
      institutionWide: false,
    })

    const response = await request(calendarToken(USER, INSTITUTION, EPOCH, PINNED))

    expect(response.status).toBe(200)
    expect(narrowedTo()).toEqual({
      institutionId: INSTITUTION,
      organizationIds: ["org-consulting", "org-finance"],
      institutionWide: false,
    })
  })

  it("tells the calendar client why, and where to get a wider link", async () => {
    calendarSelectorFor.mockResolvedValue({
      institutionId: INSTITUTION,
      organizationIds: ["org-consulting", "org-finance", "org-robotics"],
      institutionWide: false,
    })

    const response = await request(calendarToken(USER, INSTITUTION, EPOCH, PINNED))
    const body = await response.text()

    // Shown by every calendar client as the subscription's description, so the
    // holder finds out from the thing they are looking at rather than from an
    // email nobody sent.
    expect(body).toContain("Your Tenure access has widened")
    expect(response.headers.get("link")).toBe(
      '</calendar>; rel="related"; title="Re-subscribe with your current access"',
    )
    // Never cacheable by a shared proxy, expanded or not.
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  it("does not hand over institution-wide events to a URL that predates the seat", async () => {
    // The largest expansion available on this platform: an OSE seat turns the
    // feed from "my clubs" into "every event of the institution".
    calendarSelectorFor.mockResolvedValue({
      institutionId: INSTITUTION,
      organizationIds: ["org-consulting", "org-finance"],
      institutionWide: true,
    })

    await request(calendarToken(USER, INSTITUTION, EPOCH, PINNED))

    expect(narrowedTo()).toEqual({
      institutionId: INSTITUTION,
      organizationIds: ["org-consulting", "org-finance"],
      institutionWide: false,
    })
  })
})

describe("a feed whose holder's access has not widened", () => {
  it("is not narrowed at all when the scope is identical", async () => {
    calendarSelectorFor.mockResolvedValue({ ...PINNED })

    const response = await request(calendarToken(USER, INSTITUTION, EPOCH, PINNED))

    expect(response.status).toBe(200)
    // `undefined`, not "the same selector again": a narrowing predicate that
    // happens to match is still a second place the query can be wrong, and the
    // route's decision here is that there is nothing to reconcile.
    expect(narrowedTo()).toBeUndefined()
    expect(response.headers.get("link")).toBeNull()
    expect(await response.text()).not.toContain("has widened")
  })

  it("needs no new consent when the holder LEAVES a club", async () => {
    // NARROWED. Nothing is being shared that was not agreed to, so the feed
    // simply gets smaller — narrowing it again by the old, wider consent would
    // be applying a predicate that cannot remove anything.
    calendarSelectorFor.mockResolvedValue({
      institutionId: INSTITUTION,
      organizationIds: ["org-consulting"],
      institutionWide: false,
    })

    const response = await request(calendarToken(USER, INSTITUTION, EPOCH, PINNED))

    expect(response.status).toBe(200)
    expect(narrowedTo()).toBeUndefined()
    expect(response.headers.get("link")).toBeNull()
  })

  it("treats a moved institution as an expansion, whatever the club list says", async () => {
    // Fewer clubs, and a different tenant. The pinned consent covers one
    // institution's events and nothing authorises another's, so this must not
    // come back NARROWED because the list happens to be shorter.
    calendarSelectorFor.mockResolvedValue({
      institutionId: "inst-syracuse",
      organizationIds: ["org-consulting"],
      institutionWide: false,
    })

    await request(calendarToken(USER, INSTITUTION, EPOCH, PINNED))

    expect(narrowedTo()).toEqual({
      institutionId: INSTITUTION,
      organizationIds: ["org-consulting"],
      institutionWide: false,
    })
  })
})

describe("the feed still refuses before it reaches the consent question", () => {
  it("refuses a revoked token without reading a selector", async () => {
    calendarTokenEpochFor.mockResolvedValue(EPOCH + 1)

    const response = await request(calendarToken(USER, INSTITUTION, EPOCH, PINNED))

    expect(response.status).toBe(403)
    expect(calendarSelectorFor).not.toHaveBeenCalled()
    expect(loadScopedEvents).not.toHaveBeenCalled()
  })

  it("refuses a token whose holder no longer has an account", async () => {
    calendarTokenEpochFor.mockResolvedValue(null)

    const response = await request(calendarToken(USER, INSTITUTION, EPOCH, PINNED))

    expect(response.status).toBe(403)
    expect(loadScopedEvents).not.toHaveBeenCalled()
  })

  it("pins the scope to the institution the token names, not the holder's current choice", async () => {
    calendarSelectorFor.mockResolvedValue({ ...PINNED })

    await request(calendarToken(USER, INSTITUTION, EPOCH, PINNED))

    // The live selector is read FOR the token's institution. Reading it for
    // whichever tenant the holder last switched to is the defect the route's
    // own comment records.
    expect(calendarSelectorFor).toHaveBeenCalledWith(USER, INSTITUTION)
  })
})
