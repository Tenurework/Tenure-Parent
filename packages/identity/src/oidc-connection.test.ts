import {
  SecretValueError,
  assertSecretReference,
  connectionHealth,
  selectVerificationKey,
  validateClaimsMapping,
  validateDiscovery,
  type ClaimsMapping,
  type DiscoveryDocument,
  type DiscoveryProblem,
  type JsonWebKey,
} from "./index"

/** GE-043-002 — what a provider has to say before it may be trusted. */

const ISSUER = "https://idp.rochester.example.edu"

const discovery = (over: Partial<DiscoveryDocument> = {}): DiscoveryDocument => ({
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/oauth2/v1/authorize`,
  token_endpoint: `${ISSUER}/oauth2/v1/token`,
  jwks_uri: `${ISSUER}/oauth2/v1/keys`,
  id_token_signing_alg_values_supported: ["RS256"],
  code_challenge_methods_supported: ["S256"],
  ...over,
})

const problems = (document: DiscoveryDocument, issuer = ISSUER): DiscoveryProblem[] =>
  validateDiscovery(document, { issuer }).map((finding) => finding.problem)

describe("a discovery document has to be about the issuer we configured", () => {
  it("accepts a well-formed document", () => {
    // Without this every refusal below could come from a validator that refuses
    // everything.
    expect(validateDiscovery(discovery(), { issuer: ISSUER })).toEqual([])
  })

  it("refuses a document declaring a different issuer", () => {
    expect(problems(discovery({ issuer: "https://idp.evil.test" }))).toContain("ISSUER_MISMATCH")
  })

  it("treats a trailing slash as a different issuer", () => {
    // OIDC Discovery requires exact equality, and a token validator will do the
    // same later. Normalising here means every token is refused for an issuer
    // mismatch nobody can explain.
    expect(problems(discovery({ issuer: `${ISSUER}/` }))).toContain("ISSUER_MISMATCH")
  })

  it("refuses a plaintext endpoint", () => {
    expect(problems(discovery({ token_endpoint: "http://idp.rochester.example.edu/oauth2/v1/token" }))).toContain(
      "NOT_HTTPS",
    )
  })

  it("refuses an endpoint pointing away from the issuer", () => {
    // A document fetched from the issuer that sends authorization somewhere
    // else is either a misconfiguration or a tampered document.
    expect(problems(discovery({ authorization_endpoint: "https://evil.test/authorize" }))).toContain(
      "ENDPOINT_OFF_ISSUER",
    )
  })

  it("refuses a document missing an endpoint a sign-in needs", () => {
    expect(problems(discovery({ jwks_uri: undefined }))).toContain("MISSING_ENDPOINT")
    expect(problems(discovery({ token_endpoint: undefined }))).toContain("MISSING_ENDPOINT")
  })

  it("does not require endpoints a sign-in does not need", () => {
    // userinfo and end_session are genuinely optional, and demanding them would
    // reject working providers.
    expect(validateDiscovery(discovery({ userinfo_endpoint: undefined, end_session_endpoint: undefined }), { issuer: ISSUER })).toEqual([])
  })

  it("reports every problem rather than the first", () => {
    // An operator pasting a URL wants the whole list. Fix-one-run-again through
    // a slow form is the loop where people give up and disable the checks.
    const found = problems(
      discovery({
        issuer: "https://other.test",
        token_endpoint: "http://other.test/token",
        jwks_uri: undefined,
      }),
    )
    expect(found.length).toBeGreaterThan(2)
    expect(new Set(found).size).toBeGreaterThan(1)
  })
})

describe("algorithms a tenant may not configure", () => {
  it("refuses a provider offering only none", () => {
    // The algorithm-confusion attack, offered as a feature.
    expect(problems(discovery({ id_token_signing_alg_values_supported: ["none"] }))).toContain(
      "NO_ACCEPTABLE_SIGNING_ALGORITHM",
    )
  })

  it("refuses a provider offering only HS256", () => {
    // Symmetric: the verification key is the client secret, so anyone holding
    // it can mint tokens we would accept.
    expect(problems(discovery({ id_token_signing_alg_values_supported: ["HS256"] }))).toContain(
      "NO_ACCEPTABLE_SIGNING_ALGORITHM",
    )
  })

  it("accepts a provider offering an asymmetric algorithm among others", () => {
    expect(
      problems(discovery({ id_token_signing_alg_values_supported: ["HS256", "none", "RS256"] })),
    ).not.toContain("NO_ACCEPTABLE_SIGNING_ALGORITHM")
  })

  it("refuses PKCE without S256", () => {
    // "plain" puts the verifier on the wire, which is the thing PKCE exists to
    // avoid.
    expect(problems(discovery({ code_challenge_methods_supported: ["plain"] }))).toContain("NO_PKCE_S256")
  })

  it("says nothing when the provider declares neither list", () => {
    // Absent is not the same as empty: a provider that does not advertise is
    // not a provider that refuses, and failing it here would reject working
    // deployments on a metadata omission.
    expect(
      validateDiscovery(
        discovery({ id_token_signing_alg_values_supported: undefined, code_challenge_methods_supported: undefined }),
        { issuer: ISSUER },
      ),
    ).toEqual([])
  })
})

describe("which JWKS key verifies a token", () => {
  const key = (over: Partial<JsonWebKey> = {}): JsonWebKey => ({ kid: "k1", kty: "RSA", use: "sig", ...over })

  it("selects the key the token names", () => {
    const chosen = selectVerificationKey([key({ kid: "k1" }), key({ kid: "k2" })], { kid: "k2" })
    expect(chosen.ok).toBe(true)
    if (!chosen.ok) throw new Error(chosen.detail)
    expect(chosen.key.kid).toBe("k2")
  })

  it("refuses rather than trying the others when the kid is unknown", () => {
    // "Try them all" is how a rotated-out key keeps working long after it was
    // withdrawn, which makes rotation something that never takes effect.
    const chosen = selectVerificationKey([key({ kid: "k1" })], { kid: "k-withdrawn" })
    expect(chosen.ok).toBe(false)
    if (chosen.ok) throw new Error("unreachable")
    expect(chosen.reason).toBe("KID_NOT_FOUND")
  })

  it("refuses when several published keys share a kid", () => {
    const chosen = selectVerificationKey([key({ kid: "k1" }), key({ kid: "k1" })], { kid: "k1" })
    expect(chosen.ok).toBe(false)
    if (chosen.ok) throw new Error("unreachable")
    expect(chosen.reason).toBe("AMBIGUOUS")
  })

  it("accepts a single key when the token names no kid", () => {
    expect(selectVerificationKey([key({ kid: undefined })], { kid: null }).ok).toBe(true)
  })

  it("refuses to guess when the token names no kid and several keys exist", () => {
    // Guessing lets a token signed by any published key pass as any other.
    const chosen = selectVerificationKey([key({ kid: "k1" }), key({ kid: "k2" })], { kid: null })
    expect(chosen.ok).toBe(false)
    if (chosen.ok) throw new Error("unreachable")
    expect(chosen.reason).toBe("AMBIGUOUS")
  })

  it("ignores keys published for encryption", () => {
    const chosen = selectVerificationKey([key({ kid: "k1", use: "enc" }), key({ kid: "k2", use: "sig" })], { kid: null })
    expect(chosen.ok).toBe(true)
    if (!chosen.ok) throw new Error(chosen.detail)
    expect(chosen.key.kid).toBe("k2")
  })

  it("refuses when every published key is for encryption", () => {
    const chosen = selectVerificationKey([key({ use: "enc" })], { kid: null })
    expect(chosen.ok).toBe(false)
    if (chosen.ok) throw new Error("unreachable")
    expect(chosen.reason).toBe("WRONG_USE")
  })

  it("refuses an empty JWKS", () => {
    const chosen = selectVerificationKey([], { kid: "k1" })
    expect(chosen.ok).toBe(false)
    if (chosen.ok) throw new Error("unreachable")
    expect(chosen.reason).toBe("NO_KEYS")
  })
})

describe("a client secret is held by reference", () => {
  const reference = { secretName: "tenure/oidc/rochester/client-secret", version: "3", rotatedAt: null }

  it("accepts a secret store name", () => {
    expect(() => assertSecretReference(reference)).not.toThrow()
  })

  it("refuses something pasted where a name belongs", () => {
    // The obvious paste is the one that actually happens, and a value that
    // reaches this record reaches every backup, export and log line.
    expect(() =>
      assertSecretReference({ ...reference, secretName: "8Kd93jfLs0aQ2mZx7bVn4rT6yUiOpAsDfGhJkLzXcVbN" }),
    ).toThrow(SecretValueError)
  })

  it("refuses an empty name", () => {
    expect(() => assertSecretReference({ ...reference, secretName: "" })).toThrow(SecretValueError)
  })

  it("refuses a name with whitespace", () => {
    expect(() => assertSecretReference({ ...reference, secretName: "my secret" })).toThrow(SecretValueError)
  })

  it("carries a version, so rotation is a version change and not an edit", () => {
    expect(reference.version).toBeTruthy()
  })
})

describe("what a provider's claims may decide", () => {
  const mapping = (over: Partial<ClaimsMapping> = {}): ClaimsMapping => ({
    subjectClaim: "sub",
    emailClaim: "email",
    displayNameClaim: "name",
    ...over,
  })

  it("accepts an ordinary mapping", () => {
    expect(validateClaimsMapping(mapping())).toEqual([])
  })

  it("refuses email as the subject claim", () => {
    // An address is a label somebody can change. Keying on it means a renamed
    // mailbox is a new person, and a reassigned one inherits the old person's
    // history.
    expect(validateClaimsMapping(mapping({ subjectClaim: "email" })).map((f) => f.problem)).toContain(
      "EMAIL_AS_SUBJECT",
    )
  })

  it("refuses a missing subject claim", () => {
    expect(validateClaimsMapping(mapping({ subjectClaim: "" })).map((f) => f.problem)).toContain("MISSING_SUBJECT")
  })

  it("refuses a mapping that takes authority from a provider group", () => {
    // Bible §9.1. Anyone who can edit a group at the identity provider could
    // otherwise grant themselves authority inside Tenure, with nothing in the
    // audit trail but a successful login.
    expect(validateClaimsMapping(mapping({ displayNameClaim: "groups" })).map((f) => f.problem)).toContain(
      "AUTHORITY_CLAIM",
    )
  })

  it("refuses every spelling of an authority claim, not just groups", () => {
    for (const claim of ["roles", "role", "permissions", "isAdmin", "entitlements"]) {
      expect(validateClaimsMapping(mapping({ displayNameClaim: claim })).map((f) => f.problem)).toContain(
        "AUTHORITY_CLAIM",
      )
    }
  })

  it("does not fire on claims that merely describe somebody", () => {
    // A guard that flags `department` gets switched off.
    expect(validateClaimsMapping(mapping({ displayNameClaim: "department" }))).toEqual([])
  })
})

describe("whether a connection would work right now", () => {
  const NOW = new Date("2026-08-03T12:00:00Z")
  const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString()

  const health = (over: Partial<Parameters<typeof connectionHealth>[0]> = {}) =>
    connectionHealth({
      discoveryFindings: [],
      jwksKeyCount: 2,
      jwksFetchedAt: hoursAgo(1),
      jwksMaxAgeHours: 24,
      secretVersionLive: true,
      at: NOW,
      ...over,
    })

  it("is healthy when everything checks out", () => {
    expect(health().state).toBe("HEALTHY")
    expect(health().findings).toEqual([])
  })

  it("is failing when the provider publishes no signing keys", () => {
    expect(health({ jwksKeyCount: 0 }).state).toBe("FAILING")
  })

  it("is failing when the named secret version is not live", () => {
    expect(health({ secretVersionLive: false }).state).toBe("FAILING")
  })

  it("is failing when the discovery document has a problem", () => {
    expect(
      health({ discoveryFindings: [{ problem: "ISSUER_MISMATCH", detail: "issuer does not match" }] }).state,
    ).toBe("FAILING")
  })

  it("is failing when the keys have never been fetched", () => {
    expect(health({ jwksFetchedAt: null }).state).toBe("FAILING")
  })

  it("is degraded, not failing, on stale keys", () => {
    // Cached keys still verify tokens until the provider rotates, and then stop
    // all at once. Reporting that as FAILING is how an operator learns to
    // ignore the alarm.
    const stale = health({ jwksFetchedAt: hoursAgo(48) })
    expect(stale.state).toBe("DEGRADED")
    expect(stale.findings.length).toBe(1)
  })

  it("says what is wrong, in every state that is not healthy", () => {
    for (const report of [health({ jwksKeyCount: 0 }), health({ jwksFetchedAt: hoursAgo(48) })]) {
      expect(report.findings.length).toBeGreaterThan(0)
      expect(report.findings[0].length).toBeGreaterThan(20)
    }
  })

  it("reports every problem when several are wrong at once", () => {
    const broken = health({ jwksKeyCount: 0, secretVersionLive: false, jwksFetchedAt: null })
    expect(broken.state).toBe("FAILING")
    expect(broken.findings.length).toBe(3)
  })
})
