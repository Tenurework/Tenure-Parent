/**
 * WRK-050-002 / WRK-GATE-050 — the plan digest and the confirmation bound to it.
 *
 * Nothing is mocked here. `planDigest`, `issueConfirmation` and
 * `confirmationMatches` are pure over their inputs, so the only honest way to
 * test them is to run them: mint a real HMAC with a real secret and present it
 * against a real plan.
 *
 * The properties being pinned are the ones §7.3 names. A confirmation is not a
 * password: it authorizes ONE plan, for ONE person, in ONE tenant, for a few
 * minutes. Each of those four is a separate test below, and each returns its own
 * reason — a boolean would make "your approval timed out" and "somebody swapped
 * the recipient list under you" the same event.
 */
import { describe, expect, it } from "@jest/globals"

import {
  CONFIRMATION_TTL_MS,
  confirmationMatches,
  confirmationSecret,
  issueConfirmation,
  planDigest,
  type ActionPlan,
} from "./action-plan"

const SECRET = "test-confirmation-secret-that-is-long-enough"
const NOW = Date.parse("2026-08-01T12:00:00.000Z")

const plan = (over: Partial<ActionPlan> = {}): ActionPlan => ({
  tenantId: "rochester",
  actorId: "user-1",
  toolKey: "approvals.raise",
  target: "req_1",
  recipients: ["treasurer@example.edu"],
  body: "Please approve the catering quote.",
  notifies: true,
  permissionImpact: [],
  args: { amountMinor: 12_000 },
  ...over,
})

const identity = { tenantId: "rochester", actorId: "user-1" }

describe("the digest is a property of the plan's meaning, not its spelling", () => {
  it("does not depend on key order anywhere in the plan", () => {
    // The plan survives a JSON round trip on the way to a form field and back,
    // and a digest that changed with key order would refuse its own
    // confirmations. Two objects, the same content, keys written the other way.
    const a = plan({ args: { alpha: 1, beta: { x: "1", y: [1, 2] } } })
    const b = plan({ args: { beta: { y: [1, 2], x: "1" }, alpha: 1 } })

    expect(planDigest(a)).toBe(planDigest(b))
    expect(planDigest(a)).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it("treats recipients as a set, so reordering is the same plan", () => {
    const a = plan({ recipients: ["a@example.edu", "b@example.edu"] })
    const b = plan({ recipients: ["b@example.edu", "a@example.edu", "a@example.edu"] })
    expect(planDigest(a)).toBe(planDigest(b))
  })

  it("changes when any field §7.3 names changes", () => {
    const base = planDigest(plan())

    // Each of these is one of the Bible's own invalidating edits.
    expect(planDigest(plan({ recipients: ["someone.else@example.edu"] }))).not.toBe(base)
    expect(planDigest(plan({ recipients: [] }))).not.toBe(base)
    expect(planDigest(plan({ body: "Please approve the catering quote!" }))).not.toBe(base)
    expect(planDigest(plan({ target: "req_2" }))).not.toBe(base)
    expect(planDigest(plan({ notifies: false }))).not.toBe(base)
    expect(planDigest(plan({ permissionImpact: ["finance.budget.approve"] }))).not.toBe(base)
    expect(planDigest(plan({ toolKey: "approvals.withdraw" }))).not.toBe(base)
    expect(planDigest(plan({ tenantId: "midtown-arts" }))).not.toBe(base)
    expect(planDigest(plan({ actorId: "user-2" }))).not.toBe(base)
    // And the catch-all: an argument nobody named a field for still moves it.
    expect(planDigest(plan({ args: { amountMinor: 12_001 } }))).not.toBe(base)
  })
})

describe("a confirmation authorizes one plan and nothing else", () => {
  it("verifies the plan it was issued for", () => {
    const token = issueConfirmation(plan(), SECRET, NOW)
    const verdict = confirmationMatches(token, plan(), identity, NOW, SECRET)

    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.digest).toBe(planDigest(plan()))
    expect(verdict.expiresAt).toBe(NOW + CONFIRMATION_TTL_MS)
  })

  it("refuses it for a plan whose recipient changed, as PLAN_CHANGED", () => {
    // §7.3, verbatim: "A changed recipient … invalidates prior approval."
    const token = issueConfirmation(plan(), SECRET, NOW)
    const changed = plan({ recipients: ["everyone@example.edu"] })

    const verdict = confirmationMatches(token, changed, identity, NOW, SECRET)
    expect(verdict).toMatchObject({ ok: false, reason: "PLAN_CHANGED" })
  })

  it("refuses it for a different tool, because the tool is in the digest", () => {
    // The tool key lives ONLY in the digest — it is deliberately not a second
    // copy in the token payload — so this is the digest doing the work.
    const token = issueConfirmation(plan({ toolKey: "search.corpus" }), SECRET, NOW)
    const verdict = confirmationMatches(
      token,
      plan({ toolKey: "approvals.raise" }),
      identity,
      NOW,
      SECRET,
    )
    expect(verdict).toMatchObject({ ok: false, reason: "PLAN_CHANGED" })
  })

  it("refuses somebody else's confirmation, and says whose problem it is", () => {
    const token = issueConfirmation(plan(), SECRET, NOW)

    // A different person, presenting a real confirmation for the same plan.
    expect(
      confirmationMatches(token, plan(), { ...identity, actorId: "user-2" }, NOW, SECRET),
    ).toMatchObject({ ok: false, reason: "WRONG_ACTOR" })

    // A different tenant. Distinct from WRONG_ACTOR because a cross-tenant
    // presentation is an isolation event and a cross-actor one is not.
    expect(
      confirmationMatches(token, plan(), { ...identity, tenantId: "midtown-arts" }, NOW, SECRET),
    ).toMatchObject({ ok: false, reason: "WRONG_TENANT" })
  })

  it("expires, and says so rather than reporting a changed plan", () => {
    const token = issueConfirmation(plan(), SECRET, NOW, 60_000)

    expect(confirmationMatches(token, plan(), identity, NOW + 59_999, SECRET).ok).toBe(true)
    expect(confirmationMatches(token, plan(), identity, NOW + 60_001, SECRET)).toMatchObject({
      ok: false,
      reason: "EXPIRED",
    })
  })

  it("refuses everything a shape check would have accepted", () => {
    // The behaviour this file replaces: `typeof token === "string" && length > 0`.
    for (const forged of ["y", "confirm_9f2", "true", "   x"]) {
      expect(confirmationMatches(forged, plan(), identity, NOW, SECRET)).toMatchObject({
        ok: false,
        reason: "MALFORMED",
      })
    }
    expect(confirmationMatches("", plan(), identity, NOW, SECRET)).toMatchObject({
      ok: false,
      reason: "MALFORMED",
    })
    expect(confirmationMatches(undefined, plan(), identity, NOW, SECRET)).toMatchObject({
      ok: false,
      reason: "MALFORMED",
    })
  })

  it("refuses a token minted under another key, and one whose payload was edited", () => {
    const other = issueConfirmation(plan(), "a-different-signing-secret", NOW)
    expect(confirmationMatches(other, plan(), identity, NOW, SECRET)).toMatchObject({
      ok: false,
      reason: "MALFORMED",
    })

    // The attack the MAC exists for: keep the signature, rewrite the expiry.
    const token = issueConfirmation(plan(), SECRET, NOW, 60_000)
    const [version, encoded, mac] = token.split(".")
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
      x: number
    }
    payload.x = NOW + 10 * 365 * 24 * 3_600_000
    const tampered = `${version}.${Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    )}.${mac}`

    expect(confirmationMatches(tampered, plan(), identity, NOW + 120_000, SECRET)).toMatchObject({
      ok: false,
      reason: "MALFORMED",
    })
  })

  it("refuses everything when no secret is configured, rather than passing", () => {
    // A process with no signing key cannot check a confirmation. "Cannot check"
    // must not read as "checked out" — that is how an unsigned build authorizes
    // every write it is offered.
    const token = issueConfirmation(plan(), SECRET, NOW)
    expect(confirmationMatches(token, plan(), identity, NOW, "")).toMatchObject({
      ok: false,
      reason: "MALFORMED",
    })
    expect(() => issueConfirmation(plan(), "", NOW)).toThrow(/secret/)
  })
})

describe("the signing key comes from the environment the app already requires", () => {
  it("prefers a dedicated key and falls back to AUTH_SECRET", () => {
    expect(confirmationSecret({ RELAY_CONFIRMATION_SECRET: "a", AUTH_SECRET: "b" })).toBe("a")
    expect(confirmationSecret({ AUTH_SECRET: "b" })).toBe("b")
    // Empty rather than thrown: the refusal belongs at the door, where it
    // becomes an answer somebody sees.
    expect(confirmationSecret({})).toBe("")
  })
})
