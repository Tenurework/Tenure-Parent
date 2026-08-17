/**
 * WRK-030-006 — the seven launch-token cases, against the SECOND launch token.
 *
 * `src/lib/calendar-sync.test.ts` already runs these seven cases against the
 * calendar feed credential, which is stateless, stable per user and designed to
 * be replayed forever. `ConnectionLaunchToken` is the opposite of that in every
 * respect — stored as a hash, fifteen minutes long, burned on redemption — and
 * `redeemConnectionLaunchToken` had NO test of any kind. Two credentials with
 * opposite designs cannot be proven by one suite: "replay is the feature and is
 * bounded by four other refusals" is true of the feed token and is the exact
 * defect for this one.
 *
 * ## Why the database is a stand-in, and what that costs
 *
 * `redeemConnectionLaunchToken` reads `db.connectionLaunchToken` and there is no
 * PostgreSQL in this environment, so the store below is in memory. It is not a
 * canned-answer double: `findUnique` really matches on `tokenHash`, `create`
 * really refuses a duplicate hash the way the `@unique` index does, and — the
 * one that matters — `updateMany` really evaluates `where.consumedAt === null`
 * against the row's CURRENT value and returns the count of rows it changed. A
 * fake that ignored that predicate would pass whatever the module did with it,
 * which is the whole property under test.
 *
 * What this suite therefore does NOT prove, stated rather than implied: that
 * PostgreSQL takes the row lock which makes two SIMULTANEOUS `updateMany`
 * statements serialise. That is a database property, it is asserted for the
 * outbox claim in `src/lib/outbox/dispatch.itest.ts` against real Postgres, and
 * the equivalent for this table needs a `pending-intent.itest.ts` that this
 * environment cannot run. What IS proven here is that the module states the
 * claim as an `updateMany` with the predicate on it rather than as a read
 * followed by a write — the two are distinguishable from outside, because the
 * second one consumes a row twice, and the case below that redeems twice
 * against a store with no locking at all would pass either implementation only
 * if the predicate were dropped.
 */

type Row = {
  id: string
  institutionId: string
  userId: string
  capabilityKey: string
  tokenHash: string
  nonce: string
  pendingIntent: string | null
  returnPath: string
  expiresAt: Date
  consumedAt: Date | null
  createdAt: Date
}

/** The rows the fake holds. Reset per test by `store.reset()`. */
const rows: Row[] = []
let nextId = 0

jest.mock("@/lib/db", () => {
  const client: Record<string, unknown> = {
    connectionLaunchToken: {
      create: async ({ data }: { data: Omit<Row, "id" | "consumedAt" | "createdAt"> }) => {
        // The `@unique` on `tokenHash`, as a real refusal. A fake that accepted
        // two rows with one hash would make `findUnique` ambiguous and hide it.
        if (rows.some((r) => r.tokenHash === data.tokenHash)) {
          throw new Error("Unique constraint failed on the fields: (`tokenHash`)")
        }
        const row: Row = {
          ...data,
          id: `clt_${++nextId}`,
          consumedAt: null,
          createdAt: new Date("2026-09-15T12:00:00.000Z"),
        }
        rows.push(row)
        return row
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) =>
        rows.find((r) => r.tokenHash === where.tokenHash) ?? null,
      // The claim. `where.consumedAt: null` is honoured against the row's
      // CURRENT value, and the return is the count of rows changed — which is
      // what makes ALREADY_CONSUMED a fact the statement reports rather than a
      // fact the caller checked first.
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; consumedAt: null }
        data: { consumedAt: Date }
      }) => {
        const matched = rows.filter(
          (r) =>
            r.id === where.id && (where.consumedAt === null ? r.consumedAt === null : true),
        )
        for (const row of matched) row.consumedAt = data.consumedAt
        return { count: matched.length }
      },
    },
  }
  client.$transaction = async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => Promise<unknown>)(client) : arg
  return { db: client }
})

import {
  LAUNCH_TOKEN_TTL_MS,
  openConnectionOpportunity,
  redeemConnectionLaunchToken,
} from "@/lib/connections/pending-intent"

const NOW = new Date("2026-09-15T12:00:00.000Z")
const SCOPE = { institutionId: "inst_rochester", userId: "user_abc123" }
const OTHER_TENANT = { institutionId: "inst_syracuse", userId: "user_abc123" }
const OTHER_USER = { institutionId: "inst_rochester", userId: "user_someone_else" }

async function open(intent: string | null = "how much did Consulting Club spend on food?") {
  return openConnectionOpportunity(SCOPE, "ai.model", intent, "/settings", NOW)
}

/** The row behind a token, read for the assertions about consumption. */
function rowFor(index = 0): Row {
  return rows[index]
}

beforeEach(() => {
  rows.length = 0
  nextId = 0
})

describe("minting an opportunity", () => {
  it("stores a hash and never the token", async () => {
    const { token } = await open()
    expect(rows).toHaveLength(1)
    expect(rowFor().tokenHash).not.toBe(token)
    expect(rowFor().tokenHash).toHaveLength(64)
    // Nothing on the row is the redeemable value, including the nonce half that
    // is genuinely part of the token.
    for (const value of Object.values(rowFor())) {
      if (typeof value === "string") expect(value).not.toBe(token)
    }
  })

  it("refuses a returnPath that is not an in-app path", async () => {
    await expect(
      openConnectionOpportunity(SCOPE, "ai.model", null, "https://elsewhere.example", NOW),
    ).rejects.toThrow(/must be an in-app path/)
    await expect(
      openConnectionOpportunity(SCOPE, "ai.model", null, "//elsewhere.example", NOW),
    ).rejects.toThrow(/must be an in-app path/)
    expect(rows).toHaveLength(0)
  })

  it("two opportunities with identical fields are two different tokens", async () => {
    const first = await open()
    const second = await open()
    expect(first.token).not.toBe(second.token)
    expect(rows[0].tokenHash).not.toBe(rows[1].tokenHash)
  })
})

describe("the seven launch-token cases", () => {
  it("EXPIRED: a token past its expiry is refused, and is NOT consumed", async () => {
    const { token } = await open()
    const late = new Date(NOW.getTime() + LAUNCH_TOKEN_TTL_MS + 1)

    expect(await redeemConnectionLaunchToken(token, SCOPE, late)).toEqual({
      ok: false,
      reason: "EXPIRED",
    })
    // The refusal must not burn the row: if it did, anybody holding a leaked
    // token could destroy the opportunity without being able to use it.
    expect(rowFor().consumedAt).toBeNull()
  })

  it("EXPIRED is decided on the boundary, not one millisecond after it", async () => {
    const { token } = await open()
    const exactly = new Date(NOW.getTime() + LAUNCH_TOKEN_TTL_MS)
    expect(await redeemConnectionLaunchToken(token, SCOPE, exactly)).toEqual({
      ok: false,
      reason: "EXPIRED",
    })
  })

  it("REPLAYED: the second presentation of a good token is refused", async () => {
    const { token } = await open()

    const first = await redeemConnectionLaunchToken(token, SCOPE, NOW)
    expect(first.ok).toBe(true)
    expect(first.ok && first.opportunity.pendingIntent).toBe(
      "how much did Consulting Club spend on food?",
    )

    const second = await redeemConnectionLaunchToken(token, SCOPE, NOW)
    expect(second).toEqual({ ok: false, reason: "ALREADY_CONSUMED" })
  })

  it("ALREADY_CONSUMED: two redemptions racing on one row, and only one wins", async () => {
    const { token } = await open()

    // Started together and awaited together. With the `consumedAt: null`
    // predicate on the claim, exactly one statement changes a row and the other
    // reports zero; without it both report one and the token is used twice.
    const [a, b] = await Promise.all([
      redeemConnectionLaunchToken(token, SCOPE, NOW),
      redeemConnectionLaunchToken(token, SCOPE, NOW),
    ])

    const outcomes = [a.ok, b.ok].sort()
    expect(outcomes).toEqual([false, true])
    const refusal = a.ok ? b : a
    expect(refusal).toEqual({ ok: false, reason: "ALREADY_CONSUMED" })
  })

  it("WRONG_TENANT: a token minted in one institution is refused in another", async () => {
    const { token } = await open()
    expect(await redeemConnectionLaunchToken(token, OTHER_TENANT, NOW)).toEqual({
      ok: false,
      reason: "WRONG_TENANT",
    })
    expect(rowFor().consumedAt).toBeNull()
    // And the legitimate holder can still use it, which is the point of not
      // consuming on a refusal.
    expect((await redeemConnectionLaunchToken(token, SCOPE, NOW)).ok).toBe(true)
  })

  it("WRONG_USER: a token found in a shared browser is refused for the next person", async () => {
    const { token } = await open()
    expect(await redeemConnectionLaunchToken(token, OTHER_USER, NOW)).toEqual({
      ok: false,
      reason: "WRONG_USER",
    })
    expect(rowFor().consumedAt).toBeNull()
  })

  it("TAMPERED: changing any character of the token makes it UNKNOWN", async () => {
    const { token } = await open()

    const flipped = `${token.slice(0, -1)}${token.slice(-1) === "a" ? "b" : "a"}`
    expect(await redeemConnectionLaunchToken(flipped, SCOPE, NOW)).toEqual({
      ok: false,
      reason: "UNKNOWN",
    })
    // Truncated, extended, and the nonce half alone — each is a value that
    // hashes to no row, which is the only answer a stranger may be given.
    for (const forged of [
      token.slice(0, -1),
      `${token}x`,
      token.split(".")[0],
      "",
      "not-a-token",
    ]) {
      expect(await redeemConnectionLaunchToken(forged, SCOPE, NOW)).toEqual({
        ok: false,
        reason: "UNKNOWN",
      })
    }
    expect(rowFor().consumedAt).toBeNull()
  })

  it("WRONG_SESSION: there is no session binding, and the row has no field for one", async () => {
    // Stated as a gap rather than asserted as a property. §5.3 asks for a
    // session-bound token; `ConnectionLaunchToken` binds tenant and user, so the
    // same person's SECOND concurrent session redeems a token opened in the
    // first. Distinguishing them needs a `sessionId` column on the model and the
    // redeemer passing the current session id — a schema change, recorded in the
    // ledger rather than approximated here.
    const { token } = await open()
    expect(Object.keys(rowFor())).not.toContain("sessionId")

    // What DOES hold: the redemption is decided against the currently
    // authenticated person, so a token opened by one person and opened by
    // another — the only session confusion this model can represent — refuses.
    expect(await redeemConnectionLaunchToken(token, OTHER_USER, NOW)).toEqual({
      ok: false,
      reason: "WRONG_USER",
    })
  })
})

describe("the order the refusals are decided in", () => {
  it("a wrong-tenant redemption of an expired token says WRONG_TENANT", async () => {
    const { token } = await open()
    const late = new Date(NOW.getTime() + LAUNCH_TOKEN_TTL_MS + 1)
    // Tenant before expiry, deliberately: "that is not yours" is the stronger
    // statement, and telling a stranger their timing was off implies it would
    // have worked.
    expect(await redeemConnectionLaunchToken(token, OTHER_TENANT, late)).toEqual({
      ok: false,
      reason: "WRONG_TENANT",
    })
  })

  it("an already-consumed token still refuses the wrong person as WRONG_USER", async () => {
    const { token } = await open()
    expect((await redeemConnectionLaunchToken(token, SCOPE, NOW)).ok).toBe(true)
    // Not ALREADY_CONSUMED: whether it was used is none of a stranger's
    // business, and the identity check comes first for that reason.
    expect(await redeemConnectionLaunchToken(token, OTHER_USER, NOW)).toEqual({
      ok: false,
      reason: "WRONG_USER",
    })
  })
})

describe("what a successful redemption returns", () => {
  it("carries the opportunity and nothing secret", async () => {
    const { token } = await open("who approved the Finance Club budget?")
    const result = await redeemConnectionLaunchToken(token, SCOPE, NOW)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.opportunity).toEqual({
      id: rowFor().id,
      capabilityKey: "ai.model",
      pendingIntent: "who approved the Finance Club budget?",
      returnPath: "/settings",
      createdAt: rowFor().createdAt,
    })
    // Neither the token nor its hash may reach a surface that could put it in a
    // link.
    expect(JSON.stringify(result.opportunity)).not.toContain(token)
    expect(JSON.stringify(result.opportunity)).not.toContain(rowFor().tokenHash)
    expect(JSON.stringify(result.opportunity)).not.toContain(rowFor().nonce)
  })

  it("an opportunity opened with no intent redeems with a null one", async () => {
    const { token } = await open(null)
    const result = await redeemConnectionLaunchToken(token, SCOPE, NOW)
    expect(result.ok && result.opportunity.pendingIntent).toBeNull()
  })

  it("burns the row it returned", async () => {
    const { token } = await open()
    await redeemConnectionLaunchToken(token, SCOPE, NOW)
    expect(rowFor().consumedAt).toEqual(NOW)
  })
})
