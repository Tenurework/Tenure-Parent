/**
 * GE-073-004 — a stored opt-out has to actually stop the notification.
 *
 * `NotificationPreference` has been in the schema and in the baseline migration
 * since the beginning and nothing read it, so `notifyUsers` wrote a row for
 * every recipient regardless of what they had asked for. Nine call sites fan out
 * through this one function (approvals, calendar, feed, messages, finance,
 * members, admin, the reminders job and `lib/calendar-write.ts`), which is why
 * the check belongs here and not in any of them.
 *
 * The database is the mocked boundary, and it is a small stand-in *table* rather
 * than a canned answer on purpose: a `mockResolvedValue([])` would leave every
 * assertion below green whether or not the production query filters on
 * `channel` and `enabled`, which is precisely the property under test. The fake
 * applies the `where` clause and the `select` projection the way Postgres would,
 * so deleting either predicate from `notify.ts` changes what comes back.
 */

type PreferenceRow = { userId: string; channel: string; enabled: boolean }

/** The NotificationPreference table for one test. Empty means nobody has changed anything. */
let preferences: PreferenceRow[] = []

const createManyNotification = jest.fn(async () => ({ count: 0 }))

type PreferenceWhere = {
  userId?: { in?: string[] }
  channel?: string
  enabled?: boolean
}

const findManyPreference = jest.fn(
  async (args: { where?: PreferenceWhere; select?: Record<string, boolean> }) => {
    const where = args?.where ?? {}
    const matched = preferences.filter((row) => {
      const asked = where.userId?.in
      if (asked !== undefined && !asked.includes(row.userId)) return false
      if (where.channel !== undefined && row.channel !== where.channel) return false
      if (where.enabled !== undefined && row.enabled !== where.enabled) return false
      return true
    })
    // Project like the real client: a column that was not selected is not there,
    // so an implementation that reads `enabled` without asking for it breaks
    // here rather than silently working.
    const select = args?.select
    if (!select) return matched
    return matched.map((row) =>
      Object.fromEntries(
        Object.entries(row).filter(([column]) => select[column] === true),
      ),
    ) as Array<Partial<PreferenceRow>>
  },
)

jest.mock("@/lib/db", () => ({
  db: {
    notification: {
      createMany: (...args: unknown[]) =>
        createManyNotification(...(args as Parameters<typeof createManyNotification>)),
    },
    notificationPreference: {
      findMany: (...args: unknown[]) =>
        findManyPreference(...(args as Parameters<typeof findManyPreference>)),
    },
  },
}))

import { notifyUsers } from "./notify"

/** Who actually got a row written for them. */
function notified(): string[] {
  const calls = createManyNotification.mock.calls as unknown as Array<
    [{ data: Array<{ userId: string }> }]
  >
  return calls.flatMap(([arg]) => arg.data.map((row) => row.userId))
}

const message = { title: "Budget request approved", href: "/approvals/req_1" }

beforeEach(() => {
  jest.clearAllMocks()
  preferences = []
})

describe("notifyUsers honours the in-app opt-out", () => {
  it("writes to everyone when nobody has set a preference", async () => {
    // Absence of a row is consent — the column defaults to true, so an empty
    // table has to behave exactly as it did before this check existed.
    await notifyUsers(["user_a", "user_b"], message)

    expect(notified()).toEqual(["user_a", "user_b"])
  })

  it("leaves out the user who turned the in-app channel off", async () => {
    preferences = [{ userId: "user_optout", channel: "IN_APP", enabled: false }]

    await notifyUsers(["user_a", "user_optout", "user_b"], message)

    // The assertion this whole item exists for.
    expect(notified()).not.toContain("user_optout")
    expect(notified()).toEqual(["user_a", "user_b"])
  })

  it("keeps writing to a user who explicitly turned the in-app channel on", async () => {
    preferences = [{ userId: "user_a", channel: "IN_APP", enabled: true }]

    await notifyUsers(["user_a"], message)

    expect(notified()).toEqual(["user_a"])
  })

  it("does not read an opt-out on one channel as an opt-out on another", async () => {
    // Someone who has silenced email has said nothing about the bell. Suppressing
    // the in-app row here would delete the only delivery they still have.
    preferences = [
      { userId: "user_a", channel: "EMAIL", enabled: false },
      { userId: "user_b", channel: "EMAIL_DIGEST", enabled: false },
    ]

    await notifyUsers(["user_a", "user_b"], message)

    expect(notified()).toEqual(["user_a", "user_b"])
  })

  it("writes nothing at all when every recipient has opted out", async () => {
    preferences = [
      { userId: "user_a", channel: "IN_APP", enabled: false },
      { userId: "user_b", channel: "IN_APP", enabled: false },
    ]

    await notifyUsers(["user_a", "user_b"], message)

    // Not an empty createMany: a fan-out to a fully opted-out audience is a
    // write that must not happen.
    expect(createManyNotification).not.toHaveBeenCalled()
  })

  it("asks only about the recipients of this notification, on the in-app channel", async () => {
    // A read of the whole preference table would be both a wider read than the
    // question needs and one that grows with the user count on every fan-out.
    await notifyUsers(["user_a", "user_b"], message)

    expect(findManyPreference).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: { in: ["user_a", "user_b"] },
          channel: "IN_APP",
        }),
      }),
    )
  })

  it("does not query preferences when there is no one left to notify", async () => {
    // The self-exclusion already emptied the list; a database round trip for a
    // notification nobody receives is pure cost.
    await notifyUsers(["user_a"], { ...message, excludeUserId: "user_a" })

    expect(findManyPreference).not.toHaveBeenCalled()
    expect(createManyNotification).not.toHaveBeenCalled()
  })
})

describe("the fan-out rules the consent check must not disturb", () => {
  it("still dedupes and still excludes the actor", async () => {
    await notifyUsers(["user_a", "user_a", "user_b", ""], {
      ...message,
      excludeUserId: "user_b",
    })

    expect(notified()).toEqual(["user_a"])
  })

  it("still carries the title, body and href through to the row", async () => {
    await notifyUsers(["user_a"], {
      title: "Event needs a room",
      body: "Pick a space before Friday.",
      href: "/calendar/evt_1",
    })

    expect(createManyNotification).toHaveBeenCalledWith({
      data: [
        {
          userId: "user_a",
          title: "Event needs a room",
          body: "Pick a space before Friday.",
          href: "/calendar/evt_1",
        },
      ],
    })
  })

  it("nulls an absent body and href rather than leaving them undefined", async () => {
    await notifyUsers(["user_a"], { title: "Seat transfer accepted" })

    expect(createManyNotification).toHaveBeenCalledWith({
      data: [{ userId: "user_a", title: "Seat transfer accepted", body: null, href: null }],
    })
  })
})

describe("the stand-in database is a table, not a canned answer", () => {
  it("returns different rows for different where clauses", async () => {
    // Guards the test itself: if the fake ignored `where`, every assertion above
    // would pass against an implementation that filters on nothing.
    preferences = [
      { userId: "user_a", channel: "IN_APP", enabled: false },
      { userId: "user_b", channel: "IN_APP", enabled: true },
      { userId: "user_c", channel: "EMAIL", enabled: false },
    ]

    await expect(
      findManyPreference({
        where: { userId: { in: ["user_a", "user_b", "user_c"] }, channel: "IN_APP", enabled: false },
        select: { userId: true },
      }),
    ).resolves.toEqual([{ userId: "user_a" }])

    await expect(
      findManyPreference({ where: { channel: "EMAIL" }, select: { userId: true } }),
    ).resolves.toEqual([{ userId: "user_c" }])
  })
})
