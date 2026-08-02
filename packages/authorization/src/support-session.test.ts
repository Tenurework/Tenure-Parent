import {
  MAX_DURATION_HOURS,
  STEP_UP_FRESHNESS_MINUTES,
  attributionFor,
  auditAccess,
  bannerFor,
  isActive,
  permits,
  validateSession,
  type SupportSession,
} from "./support-session"

/**
 * GE-033-003 — just-in-time support sessions.
 *
 * The failure mode of every one of the nine requirements is the same: a support
 * mechanism that is slightly too convenient becomes the way operators work, and
 * then "no default content access" is a sentence in a document rather than a
 * property of the system. Most of these tests are about it staying
 * inconvenient in the specific ways that matter.
 */

const NOW = new Date("2026-08-02T12:00:00Z")
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString()

const session = (over: Partial<SupportSession> = {}): SupportSession => ({
  id: "sess-1",
  tenantId: "acme",
  operator: "operator@tenure.example",
  representing: "director@acme.example",
  basis: "tenant-approved",
  ticket: "SUP-4821",
  reason: "Reconciling a duplicated approval the tenant reported on Friday.",
  scope: ["approval:req-993"],
  grantedAt: minutesAgo(10),
  expiresAt: hoursFromNow(1),
  steppedUpAt: minutesAgo(5),
  revokedAt: null,
  ...over,
})

describe("what makes a grant invalid", () => {
  it("accepts a well-formed session", () => {
    expect(validateSession(session(), NOW)).toEqual([])
  })

  it("refuses a session with no ticket", () => {
    // "An operator asked" is not something anyone can review later.
    expect(validateSession(session({ ticket: "  " }), NOW).map((p) => p.field)).toContain("ticket")
  })

  it("refuses a placeholder reason", () => {
    expect(validateSession(session({ reason: "checking" }), NOW).map((p) => p.field)).toContain("reason")
  })

  it("refuses a wildcard scope", () => {
    // The whole mechanism defeated in one character: a wildcard converts a
    // reviewed, time-boxed, attributed grant into ordinary access with
    // paperwork.
    for (const scope of [["*"], ["approval:*"], ["org:acme/*"]]) {
      expect(validateSession(session({ scope }), NOW).map((p) => p.field)).toContain("scope")
    }
  })

  it("refuses an empty scope", () => {
    expect(validateSession(session({ scope: [] }), NOW).map((p) => p.field)).toContain("scope")
  })

  it("refuses a session with no expiry or one that outlives the maximum", () => {
    expect(validateSession(session({ expiresAt: "never" }), NOW).map((p) => p.field)).toContain("expiresAt")
    const tooLong = validateSession(
      session({ grantedAt: minutesAgo(0), expiresAt: hoursFromNow(MAX_DURATION_HOURS + 1) }),
      NOW,
    )
    expect(tooLong.map((p) => p.detail).join(" ")).toMatch(/exceeds the 8-hour maximum/)
  })

  it("refuses one that expires before it starts", () => {
    expect(
      validateSession(session({ grantedAt: hoursFromNow(2), expiresAt: hoursFromNow(1) }), NOW).map(
        (p) => p.field,
      ),
    ).toContain("expiresAt")
  })

  it("refuses a basis that is neither tenant approval nor incident policy", () => {
    // There is no third way in. An "operational necessity" basis is how the
    // other two stop being used.
    expect(
      validateSession(session({ basis: "because-we-needed-to" as never }), NOW).map((p) => p.field),
    ).toContain("basis")
  })

  it("refuses a session with no represented party", () => {
    expect(validateSession(session({ representing: "" }), NOW).map((p) => p.field)).toContain("representing")
  })

  it("reports every problem, not the first", () => {
    const problems = validateSession(
      session({ ticket: "", reason: "x", scope: ["*"], representing: "", expiresAt: "nope" }),
      NOW,
    )
    expect(problems.length).toBeGreaterThanOrEqual(5)
  })
})

describe("liveness is computed from the clock, never swept", () => {
  it("is active when everything holds", () => {
    expect(isActive(session(), NOW)).toEqual({ active: true, reason: null })
  })

  it("expires on its own, with no job involved", () => {
    // A session that expires because a sweeper runs is one that stays live when
    // the sweeper does not — and that window is exactly an incident.
    // Two hours, not ten: a span over the 8-hour maximum is MALFORMED before
    // it is EXPIRED, and my first fixture tripped that instead of the expiry.
    const past = session({ grantedAt: minutesAgo(120), expiresAt: minutesAgo(1) })
    expect(isActive(past, NOW)).toEqual({ active: false, reason: "EXPIRED" })
  })

  it("is inactive once revoked, whatever the expiry says", () => {
    expect(isActive(session({ revokedAt: minutesAgo(1) }), NOW).reason).toBe("REVOKED")
  })

  it("is inactive before it starts", () => {
    expect(isActive(session({ grantedAt: hoursFromNow(1), expiresAt: hoursFromNow(2) }), NOW).reason).toBe(
      "NOT_YET_GRANTED",
    )
  })

  it("refuses a session that never stepped up", () => {
    expect(isActive(session({ steppedUpAt: null }), NOW).reason).toBe("STEP_UP_MISSING")
  })

  it("refuses one whose step-up has gone stale", () => {
    // Step-up that lasts as long as the session is step-up once, which is a
    // login with extra words.
    const stale = session({ steppedUpAt: minutesAgo(STEP_UP_FRESHNESS_MINUTES + 1) })
    expect(isActive(stale, NOW).reason).toBe("STEP_UP_STALE")
  })

  it("distinguishes malformed from expired", () => {
    // They need different actions — a malformed session is a bad request, an
    // expired one is a new request.
    expect(isActive(session({ scope: ["*"] }), NOW).reason).toBe("MALFORMED")
  })
})

describe("scope is exact", () => {
  it("permits a resource it names", () => {
    expect(permits(session(), "approval:req-993", NOW)).toBe(true)
  })

  it("refuses one it does not", () => {
    expect(permits(session(), "approval:req-994", NOW)).toBe(false)
  })

  it("does not let a prefix reach a longer identifier", () => {
    // `startsWith` would make "org-1" reach "org-10" — the kind of near-miss
    // that is invisible in a log.
    const s = session({ scope: ["org-1"] })
    expect(permits(s, "org-10", NOW)).toBe(false)
    expect(permits(s, "org-1", NOW)).toBe(true)
  })

  it("permits nothing once the session is inactive", () => {
    expect(permits(session({ revokedAt: minutesAgo(1) }), "approval:req-993", NOW)).toBe(false)
  })
})

describe("dual attribution", () => {
  it("returns both names", () => {
    const attribution = attributionFor(session())
    expect(attribution.operator).toBe("operator@tenure.example")
    expect(attribution.representing).toBe("director@acme.example")
  })

  it("carries the ticket and session, so a record traces back", () => {
    expect(attributionFor(session())).toMatchObject({ sessionId: "sess-1", ticket: "SUP-4821" })
  })

  it("has no single-actor form", () => {
    // The only way an audit record loses the operator is if some call site can
    // ask for one name. Asserted on the module's surface rather than trusted.
    const surface = attributionFor(session())
    expect(Object.keys(surface).sort()).toEqual(["operator", "representing", "sessionId", "ticket"])
  })
})

describe("the banner", () => {
  it("is present while the session is live, and counts down", () => {
    const banner = bannerFor(session(), NOW)
    expect(banner?.visible).toBe(true)
    expect(banner?.minutesRemaining).toBe(60)
    expect(banner?.text).toContain("SUP-4821")
    expect(banner?.text).toContain("operator@tenure.example")
  })

  it("is absent when there is nothing to announce", () => {
    expect(bannerFor(session({ revokedAt: minutesAgo(1) }), NOW)).toBeNull()
    expect(bannerFor(session({ steppedUpAt: null }), NOW)).toBeNull()
  })

  it("names the operator, not the represented party", () => {
    // A banner saying the customer's own director is viewing tells them nothing.
    expect(bannerFor(session(), NOW)?.text).not.toContain("director@acme.example")
  })
})

describe("audit", () => {
  it("records an allowed access with both names", () => {
    const entry = auditAccess(session(), "read", "approval:req-993", NOW)
    expect(entry.outcome).toBe("ALLOW")
    expect(entry.operator).toBe("operator@tenure.example")
    expect(entry.representing).toBe("director@acme.example")
    expect(entry.reason).toBeNull()
  })

  it("records a refusal too, with why", () => {
    // A trail containing only successful reads cannot answer "did anyone try",
    // which is the question asked after an incident.
    const outOfScope = auditAccess(session(), "read", "approval:req-994", NOW)
    expect(outOfScope.outcome).toBe("DENY")
    expect(outOfScope.reason).toBe("OUT_OF_SCOPE")

    const expired = auditAccess(
      session({ grantedAt: minutesAgo(120), expiresAt: minutesAgo(1) }),
      "read",
      "approval:req-993",
      NOW,
    )
    expect(expired.outcome).toBe("DENY")
    expect(expired.reason).toBe("EXPIRED")
  })

  it("carries the ticket and basis, so the record justifies itself", () => {
    expect(auditAccess(session(), "read", "approval:req-993", NOW)).toMatchObject({
      ticket: "SUP-4821",
      basis: "tenant-approved",
      tenantId: "acme",
    })
  })
})
