import {
  ALLOWED_ALGORITHMS,
  CHECK_ORDER,
  CLOCK_SKEW_SECONDS,
  SAFE_TOKEN_MESSAGE,
  validateIdToken,
  type ExpectedToken,
  type ParsedToken,
  type TokenClaims,
} from "./index"

/**
 * GE-042-003 — validating what comes back, before believing any of it.
 *
 * Two of the best-known authentication failures are the same mistake: letting a
 * value inside the token decide how the token is checked. `alg: none` says the
 * token is unsigned; algorithm confusion says `HS256` where the issuer uses
 * `RS256`, so a verifier that reads `alg` HMACs the token with the public key.
 * Most of these tests are about the header never getting a vote.
 */

const NOW = new Date("2026-08-02T12:00:00Z")
const seconds = (d: Date) => Math.floor(d.getTime() / 1000)

/**
 * A generic OIDC issuer, not a Cognito one.
 *
 * The `forbidden-clients` guard flagged the Cognito URL this fixture used, and
 * it was right to: a literal provider endpoint outside an adapter is exactly
 * what it exists to stop. The fix is better than an exemption anyway — this
 * module is provider-independent by design (GE-041-001), and a fixture naming
 * one provider quietly suggests otherwise.
 */
const ISSUER = "https://idp.example/oidc"
const CLIENT = "client-abc"
const NONCE = "nonce-0123456789abcdef"

const expected = (over: Partial<ExpectedToken> = {}): ExpectedToken => ({
  issuer: ISSUER,
  clientId: CLIENT,
  algorithm: "RS256",
  requiredScopes: ["openid"],
  nonce: NONCE,
  ...over,
})

const claims = (over: Partial<TokenClaims> = {}): TokenClaims => ({
  iss: ISSUER,
  aud: CLIENT,
  exp: seconds(NOW) + 300,
  iat: seconds(NOW) - 10,
  nonce: NONCE,
  token_use: "id",
  scope: "openid profile",
  sub: "S-1-5-21-99",
  ...over,
})

const parsed = (over: { header?: Partial<ParsedToken["header"]>; claims?: Partial<TokenClaims> } = {}): ParsedToken => ({
  header: { alg: "RS256", kid: "key-1", ...over.header },
  claims: claims(over.claims),
})

/** Verifies anything. The point of most tests here is what happens BEFORE it. */
const alwaysVerifies = () => true
const neverVerifies = () => false

const validate = (over: Parameters<typeof validateIdToken>[0] extends infer T ? Partial<T> : never = {}) =>
  validateIdToken({
    token: "header.payload.signature",
    parsed: parsed(),
    expected: expected(),
    at: NOW,
    verify: alwaysVerifies,
    ...over,
  })

describe("a valid token is accepted, and only its subject is trusted", () => {
  it("accepts a well-formed token", () => {
    const outcome = validate()
    expect(outcome.valid).toBe(true)
    if (!outcome.valid) return
    expect(outcome.subject).toBe("S-1-5-21-99")
  })

  it("refuses a token with no subject", () => {
    expect(validate({ parsed: parsed({ claims: { sub: undefined } }) }).valid).toBe(false)
  })
})

describe("the algorithm is ours to choose, never the token's", () => {
  it("refuses alg: none without ever reaching the verifier", () => {
    // A library that honours `none` skips verification and every claim is
    // attacker-controlled. This must be refused before any verifier is asked.
    let verifierCalled = false
    const outcome = validate({
      parsed: parsed({ header: { alg: "none" } }),
      verify: () => {
        verifierCalled = true
        return true
      },
    })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("ALGORITHM_NOT_ALLOWED")
    expect(verifierCalled).toBe(false)
  })

  it("refuses a symmetric algorithm", () => {
    // HS256 plus a published key is a forgery: anybody with the public key can
    // mint a token.
    for (const alg of ["HS256", "HS384", "HS512"]) {
      const outcome = validate({ parsed: parsed({ header: { alg } }) })
      expect(outcome.valid).toBe(false)
      if (outcome.valid) continue
      expect(outcome.reason).toBe("ALGORITHM_NOT_ALLOWED")
    }
  })

  it("refuses a header that disagrees with the connection", () => {
    // Algorithm confusion. Even between two allowed asymmetric algorithms, the
    // header does not get to pick.
    const outcome = validate({
      parsed: parsed({ header: { alg: "ES256" } }),
      expected: expected({ algorithm: "RS256" }),
    })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("ALGORITHM_MISMATCH")
  })

  it("hands the verifier the connection's algorithm, not the header's", () => {
    // The contract that makes confusion impossible: the verifier is told which
    // algorithm to use and cannot be told otherwise.
    let seen: string | null = null
    validate({
      verify: ({ algorithm }) => {
        seen = algorithm
        return true
      },
    })
    expect(seen).toBe("RS256")
  })

  it("allows only asymmetric algorithms", () => {
    for (const alg of ALLOWED_ALGORITHMS) {
      expect(alg.startsWith("HS")).toBe(false)
    }
  })

  it("refuses a token whose signature does not verify", () => {
    const outcome = validate({ verify: neverVerifies })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("SIGNATURE_INVALID")
  })
})

describe("nothing is read from the token until the signature holds", () => {
  it("reports the signature, not the claims, for a forged token", () => {
    // A validator reporting "wrong audience" for an unsigned token has told an
    // attacker their forgery parses.
    const forged = parsed({ claims: { iss: "https://evil.example", aud: "someone-else", nonce: "wrong" } })
    const outcome = validateIdToken({
      token: "x.y.z",
      parsed: forged,
      expected: expected(),
      at: NOW,
      verify: neverVerifies,
    })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("SIGNATURE_INVALID")
  })

  it("puts every claim check after the signature in the declared order", () => {
    // Ordering is the security property, so it is asserted rather than left to
    // a reading of the source.
    expect(CHECK_ORDER.indexOf("SIGNATURE_INVALID")).toBeLessThan(CHECK_ORDER.indexOf("ISSUER_MISMATCH"))
    expect(CHECK_ORDER.indexOf("ALGORITHM_NOT_ALLOWED")).toBeLessThan(CHECK_ORDER.indexOf("SIGNATURE_INVALID"))
    expect(CHECK_ORDER.indexOf("ISSUER_MISMATCH")).toBeLessThan(CHECK_ORDER.indexOf("NONCE_MISMATCH"))
  })
})

describe("issuer and audience", () => {
  it("refuses a different issuer", () => {
    const outcome = validate({ parsed: parsed({ claims: { iss: "https://evil.example" } }) })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("ISSUER_MISMATCH")
  })

  it("treats a trailing slash as a different issuer", () => {
    // Normalising it would be guessing at which of two issuers a token came
    // from, and the guess is the vulnerability.
    const outcome = validate({ parsed: parsed({ claims: { iss: `${ISSUER}/` } }) })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("ISSUER_MISMATCH")
  })

  it("refuses a token minted for a different client", () => {
    const outcome = validate({ parsed: parsed({ claims: { aud: "another-client" } }) })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("AUDIENCE_MISMATCH")
  })

  it("accepts a single-audience token that names us", () => {
    expect(validate({ parsed: parsed({ claims: { aud: [CLIENT] } }) }).valid).toBe(true)
  })

  it("requires azp when the audience has several values", () => {
    // Without this, a token issued for a different client that merely lists us
    // is accepted — which is how one application borrows another's sign-in.
    const outcome = validate({
      parsed: parsed({ claims: { aud: [CLIENT, "another-client"], azp: "another-client" } }),
    })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("AUTHORIZED_PARTY_MISMATCH")
  })

  it("accepts a multi-audience token whose azp is us", () => {
    expect(
      validate({ parsed: parsed({ claims: { aud: [CLIENT, "another"], azp: CLIENT } }) }).valid,
    ).toBe(true)
  })

  it("does not require azp for a single audience", () => {
    expect(validate({ parsed: parsed({ claims: { aud: CLIENT, azp: undefined } }) }).valid).toBe(true)
  })
})

describe("an access token is not an identity", () => {
  it("refuses token_use: access", () => {
    // An access token is a capability. Accepting one here is how a token minted
    // for an unrelated scope becomes a sign-in.
    const outcome = validate({ parsed: parsed({ claims: { token_use: "access" } }) })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("NOT_AN_ID_TOKEN")
  })

  it("refuses typ: at+jwt", () => {
    const outcome = validate({ parsed: parsed({ header: { typ: "at+JWT" } }) })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("NOT_AN_ID_TOKEN")
  })

  it("accepts a token that does not carry token_use at all", () => {
    // Not every issuer emits it. Requiring it would refuse conforming OIDC
    // providers, and the audience and nonce checks already bind the token.
    expect(validate({ parsed: parsed({ claims: { token_use: undefined } }) }).valid).toBe(true)
  })
})

describe("time", () => {
  it("refuses a token with no expiry", () => {
    // Absent is refused rather than read as "no limit", which is the reading
    // that makes it permanent.
    const outcome = validate({ parsed: parsed({ claims: { exp: undefined } }) })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("NO_EXPIRY")
  })

  it("refuses an expired token", () => {
    const outcome = validate({ parsed: parsed({ claims: { exp: seconds(NOW) - CLOCK_SKEW_SECONDS - 1 } }) })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("EXPIRED")
  })

  it("tolerates clock drift within the allowance", () => {
    // An issuer a few seconds ahead is normal, and refusing it is an outage
    // that looks like an attack.
    expect(validate({ parsed: parsed({ claims: { exp: seconds(NOW) - 5 } }) }).valid).toBe(true)
    expect(validate({ parsed: parsed({ claims: { nbf: seconds(NOW) + 5 } }) }).valid).toBe(true)
    expect(validate({ parsed: parsed({ claims: { iat: seconds(NOW) + 5 } }) }).valid).toBe(true)
  })

  it("refuses a token that is not valid yet", () => {
    const outcome = validate({ parsed: parsed({ claims: { nbf: seconds(NOW) + CLOCK_SKEW_SECONDS + 10 } }) })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("NOT_YET_VALID")
  })

  it("refuses a token issued in the future", () => {
    const outcome = validate({ parsed: parsed({ claims: { iat: seconds(NOW) + CLOCK_SKEW_SECONDS + 10 } }) })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("ISSUED_IN_FUTURE")
  })
})

describe("the nonce ties this token to our request", () => {
  it("refuses a token whose nonce is not ours", () => {
    const outcome = validate({ parsed: parsed({ claims: { nonce: "somebody-elses" } }) })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("NONCE_MISMATCH")
  })

  it("refuses a token with no nonce at all", () => {
    const outcome = validate({ parsed: parsed({ claims: { nonce: undefined } }) })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("NONCE_MISMATCH")
  })

  it("refuses a replayed nonce", () => {
    // Single-use across the issuer, not merely within one transaction: a token
    // replayed into a DIFFERENT transaction passes every other check.
    const outcome = validate({ seenNonce: (n) => n === NONCE })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("REPLAYED")
  })

  it("accepts when the nonce has not been seen", () => {
    expect(validate({ seenNonce: () => false }).valid).toBe(true)
  })
})

describe("scopes", () => {
  it("refuses a token missing a required scope", () => {
    const outcome = validate({
      parsed: parsed({ claims: { scope: "profile" } }),
      expected: expected({ requiredScopes: ["openid", "email"] }),
    })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("SCOPE_MISSING")
  })

  it("accepts when every required scope is present among extras", () => {
    expect(
      validate({
        parsed: parsed({ claims: { scope: "openid profile email offline_access" } }),
        expected: expected({ requiredScopes: ["openid", "email"] }),
      }).valid,
    ).toBe(true)
  })

  it("does not match a scope as a substring", () => {
    // "openid_admin" contains "openid". Splitting on whitespace is what makes
    // this a set membership test rather than a string search.
    const outcome = validate({
      parsed: parsed({ claims: { scope: "openid_admin" } }),
      expected: expected({ requiredScopes: ["openid"] }),
    })
    expect(outcome.valid).toBe(false)
    if (outcome.valid) return
    expect(outcome.reason).toBe("SCOPE_MISSING")
  })

  it("requires nothing when nothing is required", () => {
    expect(
      validate({
        parsed: parsed({ claims: { scope: undefined } }),
        expected: expected({ requiredScopes: [] }),
      }).valid,
    ).toBe(true)
  })
})

describe("every refusal says the same thing", () => {
  it("uses one message whatever failed", () => {
    const failures = [
      validate({ parsed: parsed({ header: { alg: "none" } }) }),
      validate({ verify: neverVerifies }),
      validate({ parsed: parsed({ claims: { iss: "https://evil.example" } }) }),
      validate({ parsed: parsed({ claims: { nonce: "wrong" } }) }),
      validate({ parsed: parsed({ claims: { exp: seconds(NOW) - 999 } }) }),
    ]
    const details = new Set(failures.map((f) => (f.valid ? "valid" : f.detail)))
    expect(details).toEqual(new Set([SAFE_TOKEN_MESSAGE]))
  })

  it("keeps the causes distinct for the log", () => {
    const reasons = [
      validate({ parsed: parsed({ header: { alg: "none" } }) }),
      validate({ verify: neverVerifies }),
      validate({ parsed: parsed({ claims: { iss: "https://evil.example" } }) }),
      validate({ parsed: parsed({ claims: { nonce: "wrong" } }) }),
      validate({ parsed: parsed({ claims: { exp: seconds(NOW) - 999 } }) }),
    ].map((f) => (f.valid ? "valid" : f.reason))
    expect(new Set(reasons).size).toBe(5)
  })
})
