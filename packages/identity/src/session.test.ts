import {
  ABSOLUTE_TIMEOUT_HOURS,
  CSRF_COOKIE,
  IDLE_TIMEOUT_MINUTES,
  SESSION_COOKIE,
  checkCsrf,
  checkSession,
  cookieProblems,
  csrfCookie,
  revokeSessions,
  rotateSession,
  sessionCookie,
  sessionInventory,
  type ServerSession,
} from "./index"

/**
 * GE-042-004 — the browser holds a name, and the server holds everything else.
 *
 * The cookie carries an opaque session id and nothing else, because everything
 * in a cookie is exfiltratable by any XSS and a session id is the one value
 * that is useless without the server. Most of these tests are about the
 * attributes that make that true, and about the two expiry clocks that answer
 * different questions.
 */

const NOW = new Date("2026-08-02T12:00:00Z")
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000).toISOString()
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000).toISOString()

const session = (over: Partial<ServerSession> = {}): ServerSession => ({
  id: "sess-1",
  personId: "person-1",
  tenantId: "rochester",
  externalIdentityId: "ext-1",
  issuedAt: hours(-1),
  expiresAt: hours(ABSOLUTE_TIMEOUT_HOURS - 1),
  revokedAt: null,
  steppedUpAt: null,
  authorizationRevision: 7,
  csrfToken: "csrf-0123456789abcdef",
  lastSeenAt: minutes(-1),
  deviceLabel: "Chrome on macOS",
  rotatedFromId: null,
  ...over,
})

describe("the cookie carries a name, not a token", () => {
  it("is HttpOnly, Secure, Lax, host-scoped and carries only the id", () => {
    const cookie = sessionCookie("sess-1", NOW, hours(4))
    expect(cookie.httpOnly).toBe(true)
    expect(cookie.secure).toBe(true)
    expect(cookie.sameSite).toBe("Lax")
    expect(cookie.path).toBe("/")
    expect(cookie.value).toBe("sess-1")
    expect(cookie.name.startsWith("__Host-")).toBe(true)
    expect("domain" in cookie).toBe(false)
  })

  it("is Lax rather than Strict, so the OIDC callback still works", () => {
    // Strict withholds the cookie on a cross-site top-level navigation, which
    // is exactly what the identity provider's redirect back is — the callback
    // would arrive with no session and sign-in could never complete.
    expect(sessionCookie("s", NOW, hours(4)).sameSite).toBe("Lax")
  })

  it("expires with the session's absolute limit", () => {
    expect(sessionCookie("s", NOW, hours(2)).maxAgeSeconds).toBe(7200)
  })

  it("never goes negative for an already-expired session", () => {
    expect(sessionCookie("s", NOW, hours(-2)).maxAgeSeconds).toBe(0)
  })

  it("makes the CSRF cookie readable by script, deliberately", () => {
    // Double-submit needs the page to read it. A reviewer tightening this to
    // HttpOnly would silently break every write in the application.
    expect(csrfCookie("t", NOW, hours(4)).httpOnly).toBe(false)
    expect(csrfCookie("t", NOW, hours(4)).secure).toBe(true)
  })

  it("accepts the cookies it produces", () => {
    expect(cookieProblems([sessionCookie("s", NOW, hours(4)), csrfCookie("t", NOW, hours(4))])).toEqual([])
  })
})

describe("the cookie rules are asserted, not reviewed", () => {
  const base = sessionCookie("s", NOW, hours(4))

  it("catches a session cookie that is not HttpOnly", () => {
    // One XSS is one stolen session, and the whole BFF design becomes
    // decorative.
    const problems = cookieProblems([{ ...base, httpOnly: false }])
    expect(problems.map((p) => p.detail).join(" ")).toMatch(/must be HttpOnly/)
  })

  it("catches a cookie sent without Secure", () => {
    expect(cookieProblems([{ ...base, secure: false }])).not.toEqual([])
  })

  it("catches SameSite=None", () => {
    expect(cookieProblems([{ ...base, sameSite: "None" }])).not.toEqual([])
  })

  it("catches a Domain attribute", () => {
    // A domain cookie is shared with every subdomain, including any a tenant
    // controls — and __Host- forbids it outright.
    const withDomain = { ...base, domain: "tenurework.com" } as unknown as typeof base
    expect(cookieProblems([withDomain])).not.toEqual([])
  })

  it("catches a CSRF cookie made HttpOnly", () => {
    const problems = cookieProblems([{ ...csrfCookie("t", NOW, hours(4)), httpOnly: true }])
    expect(problems.map((p) => p.detail).join(" ")).toMatch(/every write breaks/)
  })
})

describe("CSRF is checked on anything that changes something", () => {
  it("requires a matching token on unsafe methods", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      expect(checkCsrf({ method, cookieToken: "t", headerToken: "t" }).ok).toBe(true)
      expect(checkCsrf({ method, cookieToken: "t", headerToken: "other" }).ok).toBe(false)
    }
  })

  it("refuses when either half is missing", () => {
    expect(checkCsrf({ method: "POST", cookieToken: null, headerToken: "t" }).reason).toBe("TOKEN_MISSING")
    expect(checkCsrf({ method: "POST", cookieToken: "t", headerToken: null }).reason).toBe("TOKEN_MISSING")
  })

  it("exempts methods that must not change anything", () => {
    // A GET that mutates is the actual bug, and CSRF-protecting it would hide
    // that rather than fix it.
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(checkCsrf({ method, cookieToken: null, headerToken: null }).ok).toBe(true)
    }
  })

  it("compares the tokens in constant time", () => {
    // A secret checked against attacker-supplied input, same as a session state
    // or a verification code.
    expect(checkCsrf.toString()).toMatch(/digestsEqual/)
    expect(checkCsrf.toString()).not.toMatch(/cookieToken\s*!==\s*\w*[hH]eaderToken/)
  })
})

describe("two clocks, because they answer different questions", () => {
  it("serves a live session and slides the idle clock forward", () => {
    const check = checkSession(session(), { tenantId: "rochester", at: NOW })
    expect(check.live).toBe(true)
    if (!check.live) return
    expect(check.touched.lastSeenAt).toBe(NOW.toISOString())
  })

  it("ends a session that has been idle too long", () => {
    // Protects an unattended machine.
    const stale = session({ lastSeenAt: minutes(-(IDLE_TIMEOUT_MINUTES + 1)) })
    const check = checkSession(stale, { tenantId: "rochester", at: NOW })
    expect(check.live).toBe(false)
    if (check.live) return
    expect(check.reason).toBe("IDLE_EXPIRED")
  })

  it("ends a session past its absolute limit however recently it was used", () => {
    // Shipping only idle expiry gives an eternal session: one that is used
    // daily never re-authenticates.
    const old = session({ expiresAt: minutes(-1), lastSeenAt: NOW.toISOString() })
    const check = checkSession(old, { tenantId: "rochester", at: NOW })
    expect(check.live).toBe(false)
    if (check.live) return
    expect(check.reason).toBe("ABSOLUTE_EXPIRED")
  })

  it("reports the absolute limit rather than idle when both have passed", () => {
    // Reporting idle expiry would suggest that using it sooner would have
    // helped, and it would not have.
    const both = session({ expiresAt: minutes(-1), lastSeenAt: minutes(-999) })
    const check = checkSession(both, { tenantId: "rochester", at: NOW })
    if (check.live) return
    expect(check.reason).toBe("ABSOLUTE_EXPIRED")
  })

  it("keeps the two limits genuinely different", () => {
    expect(ABSOLUTE_TIMEOUT_HOURS * 60).toBeGreaterThan(IDLE_TIMEOUT_MINUTES)
  })
})

describe("a session belongs to exactly one tenant", () => {
  it("refuses to serve another tenant's request", () => {
    // Without this, a cookie obtained in one tenant acts in another the moment
    // the path changes — and the path is attacker-chosen.
    const check = checkSession(session(), { tenantId: "simon", at: NOW })
    expect(check.live).toBe(false)
    if (check.live) return
    expect(check.reason).toBe("WRONG_TENANT")
  })

  it("refuses a revoked session", () => {
    const check = checkSession(session({ revokedAt: minutes(-1) }), { tenantId: "rochester", at: NOW })
    expect(check.live).toBe(false)
    if (check.live) return
    expect(check.reason).toBe("REVOKED")
  })

  it("treats an unknown session as revoked", () => {
    expect(checkSession(null, { tenantId: "rochester", at: NOW }).live).toBe(false)
  })
})

describe("rotation defeats session fixation", () => {
  it("issues a new id and revokes the old one", () => {
    // Somebody plants a known id in a victim's browser; the victim signs in;
    // the planted id must not be what they end up holding.
    const rotated = rotateSession(session(), {
      sessionId: "sess-2",
      csrfToken: "csrf-new",
      reason: "AUTHENTICATION",
      at: NOW,
    })

    expect(rotated.session.id).toBe("sess-2")
    expect(rotated.session.csrfToken).toBe("csrf-new")
    expect(rotated.session.rotatedFromId).toBe("sess-1")
    expect(rotated.previous.revokedAt).toBe(NOW.toISOString())
  })

  it("leaves the old id unusable immediately", () => {
    // A rotation that leaves it live is not a rotation, it is a second session.
    const rotated = rotateSession(session(), { sessionId: "sess-2", csrfToken: "c", reason: "AUTHENTICATION", at: NOW })
    expect(checkSession(rotated.previous, { tenantId: "rochester", at: NOW }).live).toBe(false)
  })

  it("rotates the CSRF token too", () => {
    const rotated = rotateSession(session(), { sessionId: "sess-2", csrfToken: "c-new", reason: "PRIVILEGE_CHANGE", at: NOW })
    expect(rotated.session.csrfToken).not.toBe(session().csrfToken)
  })

  it("does not extend the absolute limit", () => {
    // Extending it on every privilege change would let a session live
    // indefinitely by doing ordinary things — the loophole the absolute clock
    // exists to close.
    const before = session()
    const rotated = rotateSession(before, { sessionId: "s2", csrfToken: "c", reason: "STEP_UP", at: NOW })
    expect(rotated.session.expiresAt).toBe(before.expiresAt)
  })

  it("keeps the rotated session usable", () => {
    const rotated = rotateSession(session(), { sessionId: "s2", csrfToken: "c", reason: "AUTHENTICATION", at: NOW })
    expect(checkSession(rotated.session, { tenantId: "rochester", at: NOW }).live).toBe(true)
  })
})

describe("the inventory is something a person can act on", () => {
  const mine = [
    session({ id: "a", lastSeenAt: minutes(-1), deviceLabel: "Chrome on macOS" }),
    session({ id: "b", lastSeenAt: minutes(-5), deviceLabel: "Safari on iPhone" }),
    session({ id: "dead", revokedAt: minutes(-2) }),
    session({ id: "stale", lastSeenAt: minutes(-(IDLE_TIMEOUT_MINUTES + 5)) }),
    session({ id: "theirs", personId: "person-9" }),
  ]

  it("lists only live sessions, newest activity first", () => {
    // Showing dead rows makes the live ones harder to find.
    const list = sessionInventory(mine, { personId: "person-1", currentSessionId: "a", at: NOW })
    expect(list.map((s) => s.id)).toEqual(["a", "b"])
  })

  it("marks the current session", () => {
    // An inventory where you cannot tell which row is you is one where nobody
    // dares click anything.
    const list = sessionInventory(mine, { personId: "person-1", currentSessionId: "b", at: NOW })
    expect(list.find((s) => s.id === "b")?.current).toBe(true)
    expect(list.find((s) => s.id === "a")?.current).toBe(false)
  })

  it("never lists another person's sessions", () => {
    const list = sessionInventory(mine, { personId: "person-1", currentSessionId: "a", at: NOW })
    expect(list.map((s) => s.id)).not.toContain("theirs")
  })

  it("carries a device label so a session can be recognised", () => {
    const list = sessionInventory(mine, { personId: "person-1", currentSessionId: "a", at: NOW })
    expect(list[0].deviceLabel).toBe("Chrome on macOS")
  })
})

describe("signing out everywhere else", () => {
  const all = [
    session({ id: "a" }),
    session({ id: "b" }),
    session({ id: "dead", revokedAt: minutes(-5) }),
    session({ id: "theirs", personId: "person-9" }),
  ]

  it("ends every other session and keeps the current one", () => {
    // The button people want after losing a laptop. One that also ended the
    // session they are using would log them out mid-panic.
    const revoked = revokeSessions(all, { personId: "person-1", exceptSessionId: "a", at: NOW })
    expect(revoked.map((s) => s.id)).toEqual(["b"])
    expect(revoked[0].revokedAt).toBe(NOW.toISOString())
  })

  it("ends everything when no exception is given", () => {
    const revoked = revokeSessions(all, { personId: "person-1", at: NOW })
    expect(revoked.map((s) => s.id).sort()).toEqual(["a", "b"])
  })

  it("never touches another person's sessions", () => {
    const revoked = revokeSessions(all, { personId: "person-1", at: NOW })
    expect(revoked.map((s) => s.id)).not.toContain("theirs")
  })

  it("does not re-revoke what is already revoked", () => {
    const revoked = revokeSessions(all, { personId: "person-1", at: NOW })
    expect(revoked.map((s) => s.id)).not.toContain("dead")
  })
})
