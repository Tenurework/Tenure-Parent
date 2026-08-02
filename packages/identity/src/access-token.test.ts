import {
  validateAccessToken,
  validateIdToken,
  type ExpectedAccessToken,
  type ParsedToken,
  type TokenClaims,
} from "./index"

/**
 * GE-042-005 — an ID token is never an API access token.
 *
 * The confusion is easy to ship. An ID token is issued *to the client*, says
 * who signed in, and is the token nearest to hand when somebody is wiring an
 * API call. It carries `aud = clientId`, so an API checking "is the audience my
 * client id" accepts it happily — and has granted API access on a token never
 * scoped for it, never intended to leave the browser's session, and typically
 * far longer-lived than an access token.
 */

const NOW = new Date("2026-08-02T12:00:00Z")
const seconds = (d: Date) => Math.floor(d.getTime() / 1000)

const ISSUER = "https://idp.example/oidc"
const CLIENT = "client-abc"
const API = "https://api.tenurework.com"

const expected = (over: Partial<ExpectedAccessToken> = {}): ExpectedAccessToken => ({
  issuer: ISSUER,
  resourceServer: API,
  algorithm: "RS256",
  requiredScopes: ["approvals.read"],
  ...over,
})

const accessClaims = (over: Partial<TokenClaims> = {}): TokenClaims => ({
  iss: ISSUER,
  aud: API,
  exp: seconds(NOW) + 300,
  token_use: "access",
  scope: "approvals.read approvals.write",
  sub: "S-1",
  ...over,
})

const parsed = (claimsOver: Partial<TokenClaims> = {}, alg = "RS256"): ParsedToken => ({
  header: { alg, kid: "key-1" },
  claims: accessClaims(claimsOver),
})

const verifies = () => true

const validate = (over: Partial<Parameters<typeof validateAccessToken>[0]> = {}) =>
  validateAccessToken({
    token: "a.b.c",
    parsed: parsed(),
    expected: expected(),
    at: NOW,
    verify: verifies,
    ...over,
  })

describe("an access token is positively identified", () => {
  it("accepts a well-formed one and reports its scopes", () => {
    const outcome = validate()
    expect(outcome.valid).toBe(true)
    if (!outcome.valid) return
    expect(outcome.subject).toBe("S-1")
    expect(outcome.scopes).toEqual(["approvals.read", "approvals.write"])
  })

  it("refuses a token marked as an ID token", () => {
    const outcome = validate({ parsed: parsed({ token_use: "id" }) })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("NOT_AN_ACCESS_TOKEN")
  })

  it("refuses a token carrying no marker at all", () => {
    // An issuer emitting neither cannot be distinguished, so absence is refused
    // rather than assumed to mean "access".
    const outcome = validate({ parsed: parsed({ token_use: undefined }) })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("NOT_AN_ACCESS_TOKEN")
  })

  it("refuses a token whose audience is the client rather than the API", () => {
    // The second independent thing that stops an ID token passing.
    const outcome = validate({ parsed: parsed({ aud: CLIENT }) })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("AUDIENCE_MISMATCH")
  })
})

describe("the two validators are not interchangeable", () => {
  const idToken: ParsedToken = {
    header: { alg: "RS256", kid: "key-1" },
    claims: {
      iss: ISSUER,
      aud: CLIENT,
      exp: seconds(NOW) + 300,
      nonce: "nonce-0123456789abcdef",
      token_use: "id",
      scope: "openid approvals.read",
      sub: "S-1",
    },
  }

  it("refuses a genuine, valid ID token at an API", () => {
    // The whole item, in one assertion: this token is perfectly valid as a
    // sign-in and must not open an API.
    const asIdToken = validateIdToken({
      token: "a.b.c",
      parsed: idToken,
      expected: {
        issuer: ISSUER,
        clientId: CLIENT,
        algorithm: "RS256",
        requiredScopes: ["openid"],
        nonce: "nonce-0123456789abcdef",
      },
      at: NOW,
      verify: verifies,
    })
    expect(asIdToken.valid).toBe(true)

    const asAccessToken = validateAccessToken({
      token: "a.b.c",
      parsed: idToken,
      expected: expected(),
      at: NOW,
      verify: verifies,
    })
    expect(asAccessToken.valid).toBe(false)
    if (asAccessToken.valid) return
    expect(asAccessToken.reason).toBe("NOT_AN_ACCESS_TOKEN")
  })

  it("refuses a genuine access token as a sign-in, on the audience", () => {
    // The other direction. It fails on AUDIENCE_MISMATCH rather than
    // NOT_AN_ID_TOKEN, because an access token's audience is the API and the
    // audience is checked first — which is the stronger result, not a weaker
    // one: the two barriers are independent and either alone suffices.
    const outcome = validateIdToken({
      token: "a.b.c",
      parsed: parsed({ nonce: "nonce-0123456789abcdef" }),
      expected: {
        issuer: ISSUER,
        clientId: CLIENT,
        algorithm: "RS256",
        requiredScopes: [],
        nonce: "nonce-0123456789abcdef",
      },
      at: NOW,
      verify: verifies,
    })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("AUDIENCE_MISMATCH")
  })

  it("still refuses it when the audience happens to match", () => {
    // The second barrier, isolated. A resource server configured with the
    // client id as its audience — the misconfiguration that makes this whole
    // confusion possible — must still not accept an access token as a sign-in.
    const outcome = validateIdToken({
      token: "a.b.c",
      parsed: parsed({ aud: CLIENT, nonce: "nonce-0123456789abcdef" }),
      expected: {
        issuer: ISSUER,
        clientId: CLIENT,
        algorithm: "RS256",
        requiredScopes: [],
        nonce: "nonce-0123456789abcdef",
      },
      at: NOW,
      verify: verifies,
    })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("NOT_AN_ID_TOKEN")
  })
})

describe("an API that requires no scope has not decided what the token is for", () => {
  it("refuses to validate against an empty scope list", () => {
    // Refused rather than defaulted, because the default somebody would pick is
    // "none", and a token minted for anything would then open this API.
    const outcome = validate({ expected: expected({ requiredScopes: [] }) })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("NO_SCOPES_REQUIRED")
  })

  it("refuses a token missing a required scope", () => {
    const outcome = validate({ expected: expected({ requiredScopes: ["approvals.delete"] }) })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("SCOPE_MISSING")
  })

  it("does not match a scope as a substring", () => {
    const outcome = validate({
      parsed: parsed({ scope: "approvals.readonly" }),
      expected: expected({ requiredScopes: ["approvals.read"] }),
    })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("SCOPE_MISSING")
  })
})

describe("the same algorithm and time rules apply", () => {
  it("refuses alg: none", () => {
    const outcome = validate({ parsed: parsed({}, "none") })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("ALGORITHM_NOT_ALLOWED")
  })

  it("refuses a symmetric algorithm", () => {
    const outcome = validate({ parsed: parsed({}, "HS256") })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("ALGORITHM_NOT_ALLOWED")
  })

  it("refuses an unverified signature before reading any claim", () => {
    const forged = parsed({ iss: "https://evil.example", aud: "someone-else" })
    const outcome = validate({ parsed: forged, verify: () => false })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("SIGNATURE_INVALID")
  })

  it("refuses a different issuer", () => {
    const outcome = validate({ parsed: parsed({ iss: "https://evil.example" }) })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("ISSUER_MISMATCH")
  })

  it("refuses a token with no expiry", () => {
    const outcome = validate({ parsed: parsed({ exp: undefined }) })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("NO_EXPIRY")
  })

  it("refuses an expired token", () => {
    const outcome = validate({ parsed: parsed({ exp: seconds(NOW) - 999 }) })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("EXPIRED")
  })

  it("refuses one that is not valid yet", () => {
    const outcome = validate({ parsed: parsed({ nbf: seconds(NOW) + 999 }) })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("NOT_YET_VALID")
  })
})
