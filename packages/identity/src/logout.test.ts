import { LogoutConfigurationError, planLogout, type ProviderMetadata, type ServerSession } from "./index"

/**
 * GE-042-006 — signing out, including the half that is usually skipped.
 *
 * Clearing the local session is the part every application does. The provider's
 * own session is the part that decides whether "sign out" meant anything on the
 * shared machine in a school office.
 */

const NOW = new Date("2026-08-02T12:00:00Z")
const iso = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString()

const session = (over: Partial<ServerSession> = {}): ServerSession => ({
  id: "sess-1",
  personId: "person-1",
  tenantId: "rochester",
  externalIdentityId: "ext-1",
  issuedAt: iso(-60),
  expiresAt: iso(600),
  revokedAt: null,
  steppedUpAt: null,
  authorizationRevision: 4,
  csrfToken: "csrf-1",
  lastSeenAt: iso(-1),
  deviceLabel: "Chrome on Windows",
  rotatedFromId: null,
  rotationReason: null,
  ...over,
})

const WITH_LOGOUT: ProviderMetadata = {
  issuer: "https://login.example.edu",
  endSessionEndpoint: "https://login.example.edu/oidc/logout",
}
const WITHOUT_LOGOUT: ProviderMetadata = { issuer: "https://login.example.edu" }

const RETURN_TO = "https://tenure.example.edu/signed-out"

const plan = (over: Partial<Parameters<typeof planLogout>[0]> = {}) =>
  planLogout({
    session: session(),
    provider: WITH_LOGOUT,
    idToken: "the-id-token",
    postLogoutRedirectUri: RETURN_TO,
    allowedPostLogoutRedirectUris: [RETURN_TO],
    state: "state-1",
    cookiesToClear: ["__Host-tenure.sid", "__Host-tenure.csrf"],
    ...over,
  })

describe("the local session always ends", () => {
  it("revokes the current session", () => {
    expect(plan().revokeSessionIds).toEqual(["sess-1"])
  })

  it("revokes it even when the provider cannot be asked", () => {
    // The part this application controls must not be conditional on the part it
    // does not. A provider without RP-initiated logout is not a reason to leave
    // somebody signed in here.
    expect(plan({ provider: WITHOUT_LOGOUT }).revokeSessionIds).toEqual(["sess-1"])
  })

  it("clears the cookies it was given", () => {
    expect(plan().clearCookies).toEqual(["__Host-tenure.sid", "__Host-tenure.csrf"])
  })
})

describe("sign out everywhere", () => {
  const others = [
    session({ id: "sess-2", deviceLabel: "Safari on iPhone" }),
    session({ id: "sess-3", deviceLabel: "Firefox" }),
  ]

  it("ends this person's other sessions too", () => {
    const result = plan({ everywhere: true, otherSessions: others })
    expect([...result.revokeSessionIds].sort()).toEqual(["sess-1", "sess-2", "sess-3"])
  })

  it("leaves them alone when it was not asked for", () => {
    expect(plan({ otherSessions: others }).revokeSessionIds).toEqual(["sess-1"])
  })

  it("never ends somebody else's session", () => {
    // The list a caller passes is a query result, and a query that widened by
    // one predicate would sign out a whole institution from one click.
    const result = plan({
      everywhere: true,
      otherSessions: [...others, session({ id: "sess-other-person", personId: "person-2" })],
    })
    expect(result.revokeSessionIds).not.toContain("sess-other-person")
  })

  it("does not list the current session twice", () => {
    const result = plan({ everywhere: true, otherSessions: [session(), ...others] })
    expect(result.revokeSessionIds).toEqual([...new Set(result.revokeSessionIds)])
  })
})

describe("asking the provider to end its session", () => {
  it("builds an RP-initiated logout URL", () => {
    const result = plan()
    if (result.upstream.kind !== "RP_INITIATED") throw new Error("expected RP-initiated logout")

    const url = new URL(result.upstream.url)
    expect(url.origin + url.pathname).toBe("https://login.example.edu/oidc/logout")
    expect(url.searchParams.get("id_token_hint")).toBe("the-id-token")
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe(RETURN_TO)
    expect(url.searchParams.get("state")).toBe("state-1")
  })

  it("omits id_token_hint rather than sending an empty one", () => {
    // A provider that validates the hint rejects an empty value outright, so an
    // empty parameter is worse than no parameter.
    const result = plan({ idToken: undefined })
    if (result.upstream.kind !== "RP_INITIATED") throw new Error("expected RP-initiated logout")

    expect(new URL(result.upstream.url).searchParams.has("id_token_hint")).toBe(false)
  })

  it("keeps a query string the endpoint already carried", () => {
    // Some deployments hang a tenant parameter off the endpoint. Rebuilding the
    // URL from its origin and path would drop it and the request would 400.
    const result = plan({
      provider: { issuer: WITH_LOGOUT.issuer, endSessionEndpoint: "https://login.example.edu/logout?realm=staff" },
    })
    if (result.upstream.kind !== "RP_INITIATED") throw new Error("expected RP-initiated logout")

    const url = new URL(result.upstream.url)
    expect(url.searchParams.get("realm")).toBe("staff")
    expect(url.searchParams.get("state")).toBe("state-1")
  })
})

describe("a provider that cannot end its session says so", () => {
  it("reports the upstream logout as unsupported", () => {
    const result = plan({ provider: WITHOUT_LOGOUT })
    expect(result.upstream.kind).toBe("UNSUPPORTED")
    if (result.upstream.kind !== "UNSUPPORTED") throw new Error("unreachable")
    expect(result.upstream.detail).toContain("login.example.edu")
  })

  it("tells the person their school account is still signed in", () => {
    // The deliverable. "You have been signed out" while the upstream session
    // stands is not a smaller version of signing out; it is the misleading one,
    // and the machine it misleads on is shared.
    const result = plan({ provider: WITHOUT_LOGOUT })
    expect(result.detail).toMatch(/still signed in/i)
    expect(result.detail).toMatch(/shared/i)
  })

  it("does not claim the school account was signed out", () => {
    const unsupported = plan({ provider: WITHOUT_LOGOUT })
    const supported = plan()
    expect(unsupported.detail).not.toBe(supported.detail)
    expect(supported.detail).toMatch(/school account/i)
  })
})

describe("the return address is checked against the registered list", () => {
  it("refuses one that is not registered", () => {
    // The provider performs this redirect on our behalf, so an unchecked value
    // is an open redirect immediately after a real sign-out — the most credible
    // phishing hop available.
    expect(() => plan({ postLogoutRedirectUri: "https://evil.test/signed-out" })).toThrow(
      LogoutConfigurationError,
    )
  })

  it("refuses a prefix match on a registered one", () => {
    // `startsWith` accepts `https://tenure.example.edu.evil.test` for a
    // registered `https://tenure.example.edu`, which is the whole trick.
    expect(() => plan({ postLogoutRedirectUri: `${RETURN_TO}.evil.test` })).toThrow(
      LogoutConfigurationError,
    )
  })

  it("refuses another path on a registered host", () => {
    // Same host is not the same URI. Any path on it may be attacker-controlled
    // — an uploaded file, a user-authored page.
    expect(() => plan({ postLogoutRedirectUri: "https://tenure.example.edu/uploads/x.html" })).toThrow(
      LogoutConfigurationError,
    )
  })

  it("refuses rather than falling back to a default", () => {
    // A fallback would make the misconfiguration invisible, and the
    // misconfiguration is the bug.
    expect(() => plan({ allowedPostLogoutRedirectUris: [] })).toThrow(LogoutConfigurationError)
  })

  it("accepts the registered one, so the refusals above are not vacuous", () => {
    expect(() => plan()).not.toThrow()
  })

  it("checks the address even when the provider has no logout endpoint", () => {
    // The redirect target is still used to bring the person back, and a check
    // that only ran on one branch would be no check at all.
    expect(() =>
      plan({ provider: WITHOUT_LOGOUT, postLogoutRedirectUri: "https://evil.test/x" }),
    ).toThrow(LogoutConfigurationError)
  })
})
