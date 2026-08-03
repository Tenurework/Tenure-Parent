import {
  createSign,
  createVerify,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto"

import {
  authorityFromTenureRecords,
  proposalFromClaims,
  resolveAssertion,
  validateIdToken,
  validateSamlAssertion,
  type ClaimsMapping,
  type ConnectionState,
  type ExternalIdentity,
  type SamlAssertionInput,
  type TenantMembership,
  type TokenClaims,
} from "./index"

/**
 * GE-043-007 — federation proved end to end, with a controlled test IdP.
 *
 * "Controlled" means we hold the keys. This mints **real** RS256 tokens with
 * `node:crypto`, verifies them with `node:crypto`, and runs them through the
 * actual validators — no stubbed verifier, no hand-written `{ valid: true }`.
 * A token signed by the wrong key fails here for the same reason it would fail
 * in production: the mathematics says so.
 *
 * What that proves is the **decision chain**: assertion → signature → token
 * validation → identity resolution → claims mapping → authority. What it does
 * not prove is an HTTP round trip, because there is no callback route and no
 * Cognito to redirect to; that half is BLOCKED_EXTERNAL on the AWS Organization
 * and is recorded as such rather than simulated.
 *
 * ## Two synthetic tenants, and the property that matters
 *
 * Rochester and Ithaca each have their own IdP, their own keypair, their own
 * connection. The chain has to grant Rochester's person authority at Rochester
 * and **nothing at all** at Ithaca — not because a check happens to reject it,
 * but at every layer that could have let it through.
 */

/* ─────────────────────────────────────────────── the controlled test IdP ── */

const base64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

interface TestIdp {
  issuer: string
  privateKey: KeyObject
  publicKey: KeyObject
  /** Mint a real, signed compact JWS. */
  mint(claims: TokenClaims, header?: Record<string, unknown>): string
}

function createTestIdp(issuer: string): TestIdp {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })

  return {
    issuer,
    privateKey,
    publicKey,
    mint(claims, header = {}) {
      const encodedHeader = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", ...header }))
      const encodedClaims = base64url(JSON.stringify(claims))
      const signingInput = `${encodedHeader}.${encodedClaims}`

      const signer = createSign("RSA-SHA256")
      signer.update(signingInput)
      return `${signingInput}.${base64url(signer.sign(privateKey))}`
    },
  }
}

/** A real verifier, bound to one public key. This is what makes it end to end. */
function verifierFor(publicKey: KeyObject) {
  return ({ token, algorithm }: { token: string; algorithm: string }) => {
    if (algorithm !== "RS256") return false
    const parts = token.split(".")
    if (parts.length !== 3) return false

    const verifier = createVerify("RSA-SHA256")
    verifier.update(`${parts[0]}.${parts[1]}`)
    return verifier.verify(publicKey, Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/"), "base64"))
  }
}

function parse(token: string) {
  const [header, claims] = token.split(".")
  return {
    header: JSON.parse(Buffer.from(header, "base64url").toString()),
    claims: JSON.parse(Buffer.from(claims, "base64url").toString()),
  }
}

/* ────────────────────────────────────────────────── two synthetic tenants ── */

const NOW = new Date("2026-08-03T12:00:00Z")
const seconds = (n: number) => Math.floor(NOW.getTime() / 1000) + n
const iso = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString()

const rochester = {
  tenantId: "rochester",
  connectionId: "conn-rochester",
  clientId: "client-rochester",
  idp: createTestIdp("https://idp.rochester.test"),
  personId: "person-dana",
  subject: "idp|dana-0001",
}

const ithaca = {
  tenantId: "ithaca",
  connectionId: "conn-ithaca",
  clientId: "client-ithaca",
  idp: createTestIdp("https://idp.ithaca.test"),
  personId: "person-sam",
  subject: "idp|sam-0001",
}

const connections: ConnectionState[] = [
  { id: rochester.connectionId, status: "ACTIVE", issuer: rochester.idp.issuer },
  { id: ithaca.connectionId, status: "ACTIVE", issuer: ithaca.idp.issuer },
]

const identities: ExternalIdentity[] = [
  {
    id: "ext-dana",
    personId: rochester.personId,
    connectionId: rochester.connectionId,
    issuer: rochester.idp.issuer,
    subject: rochester.subject,
    assertedEmail: "dana@rochester.test",
    emailVerified: true,
    status: "ACTIVE",
    linkedAt: iso(-100),
    lastAuthenticatedAt: iso(-1),
  },
]

const memberships: TenantMembership[] = [
  {
    id: "mem-dana-rochester",
    personId: rochester.personId,
    tenantId: rochester.tenantId,
    origin: "INVITATION",
    status: "ACTIVE",
    interval: { effectiveFrom: iso(-100), effectiveUntil: null },
    statusReason: null,
  },
]

const mapping: ClaimsMapping = { subjectClaim: "sub", emailClaim: "email", displayNameClaim: "name" }

const NONCE = "nonce-7f3a91c40b2e"

const claimsFor = (idp: TestIdp, clientId: string, subject: string, over: Partial<TokenClaims> = {}) => ({
  iss: idp.issuer,
  aud: clientId,
  sub: subject,
  token_use: "id",
  nonce: NONCE,
  scope: "openid profile email",
  email: "dana@rochester.test",
  name: "Dana Whitfield",
  iat: seconds(-30),
  nbf: seconds(-30),
  exp: seconds(3600),
  ...over,
})

/**
 * One sign-in, from a minted token to a set of capabilities.
 *
 * The whole chain in one function, so a test can point it at either tenant and
 * assert what comes out. Nothing here is arranged to succeed: every step is the
 * production function, and the first refusal stops it.
 */
function signIn(input: {
  token: string
  verifyWith: KeyObject
  connectionId: string
  expectedIssuer: string
  clientId: string
  tenantId: string
}) {
  const token = validateIdToken({
    token: input.token,
    parsed: parse(input.token),
    expected: {
      issuer: input.expectedIssuer,
      clientId: input.clientId,
      algorithm: "RS256",
      requiredScopes: ["openid"],
      nonce: NONCE,
    },
    at: NOW,
    verify: verifierFor(input.verifyWith),
  })
  if (!token.valid) return { stage: "token" as const, refusal: token.reason }

  const claims = parse(input.token).claims
  const resolution = resolveAssertion(
    {
      connectionId: input.connectionId,
      issuer: String(claims.iss),
      subject: String(claims.sub),
      assertedEmail: typeof claims.email === "string" ? claims.email : null,
      emailVerified: true,
    },
    identities,
    connections,
    NOW,
  )
  if (resolution.outcome !== "MATCHED") {
    return { stage: "resolution" as const, refusal: resolution.outcome }
  }

  const proposal = proposalFromClaims(claims as Record<string, unknown>, mapping)
  if (!proposal.ok) return { stage: "proposal" as const, refusal: proposal.reason }

  const capabilities = authorityFromTenureRecords({
    memberships,
    seatCapabilities: ["roster.read"],
    policyCapabilities: ["calendar.write"],
    tenantId: input.tenantId,
    at: NOW,
  })

  return { stage: "authorised" as const, personId: resolution.personId, capabilities, proposal: proposal.proposal }
}

/* ─────────────────────────────────────────────────────────────── the tests ── */

describe("the controlled IdP is real, not a stand-in", () => {
  it("mints a token its own key verifies", () => {
    const token = rochester.idp.mint(claimsFor(rochester.idp, rochester.clientId, rochester.subject))
    expect(verifierFor(rochester.idp.publicKey)({ token, algorithm: "RS256" })).toBe(true)
  })

  it("mints a token the other tenant's key rejects", () => {
    // Without this the whole suite could pass against a verifier that returns
    // true — which is exactly the stub this test exists instead of.
    const token = rochester.idp.mint(claimsFor(rochester.idp, rochester.clientId, rochester.subject))
    expect(verifierFor(ithaca.idp.publicKey)({ token, algorithm: "RS256" })).toBe(false)
  })

  it("rejects a token whose payload was edited after signing", () => {
    // The property a real signature has and a stub does not.
    const token = rochester.idp.mint(claimsFor(rochester.idp, rochester.clientId, rochester.subject))
    const [header, , signature] = token.split(".")
    const tampered = `${header}.${base64url(JSON.stringify({ sub: "idp|attacker" }))}.${signature}`

    expect(verifierFor(rochester.idp.publicKey)({ token: tampered, algorithm: "RS256" })).toBe(false)
  })

  it("uses two genuinely different keys", () => {
    const a = rochester.idp.publicKey.export({ type: "spki", format: "pem" })
    const b = ithaca.idp.publicKey.export({ type: "spki", format: "pem" })
    expect(a).not.toEqual(b)
  })
})

describe("a federated sign-in reaches authority", () => {
  const token = rochester.idp.mint(claimsFor(rochester.idp, rochester.clientId, rochester.subject))

  const result = signIn({
    token,
    verifyWith: rochester.idp.publicKey,
    connectionId: rochester.connectionId,
    expectedIssuer: rochester.idp.issuer,
    clientId: rochester.clientId,
    tenantId: rochester.tenantId,
  })

  it("completes every stage", () => {
    expect(result.stage).toBe("authorised")
  })

  it("resolves the person the identity was linked to", () => {
    if (result.stage !== "authorised") throw new Error(`stopped at ${result.stage}: ${result.refusal}`)
    expect(result.personId).toBe(rochester.personId)
  })

  it("grants the capabilities Tenure's records carry", () => {
    if (result.stage !== "authorised") throw new Error(`stopped at ${result.stage}`)
    expect(result.capabilities).toEqual(["calendar.write", "roster.read"])
  })

  it("carries no authority from the token", () => {
    // The claims said nothing about roles, and the proposal has nowhere to put
    // them. GE-043-003, proved through the whole chain rather than in isolation.
    if (result.stage !== "authorised") throw new Error(`stopped at ${result.stage}`)
    expect(Object.keys(result.proposal).sort()).toEqual(["displayName", "email", "subject"])
  })
})

describe("the second tenant gets nothing", () => {
  const rochesterToken = rochester.idp.mint(claimsFor(rochester.idp, rochester.clientId, rochester.subject))

  it("refuses Rochester's token at Ithaca's connection", () => {
    // The issuer is checked against what the connection expects, so a token
    // valid at one tenant is not a token at another.
    const result = signIn({
      token: rochesterToken,
      verifyWith: rochester.idp.publicKey,
      connectionId: ithaca.connectionId,
      expectedIssuer: ithaca.idp.issuer,
      clientId: ithaca.clientId,
      tenantId: ithaca.tenantId,
    })
    expect(result.stage).toBe("token")
    if (result.stage === "authorised") throw new Error("unreachable")
    expect(result.refusal).toBe("ISSUER_MISMATCH")
  })

  it("refuses Rochester's token even when Ithaca's expectations are relaxed to match", () => {
    // The misconfiguration that makes cross-tenant acceptance possible,
    // isolated: everything matches except the key.
    const result = signIn({
      token: rochesterToken,
      verifyWith: ithaca.idp.publicKey,
      connectionId: ithaca.connectionId,
      expectedIssuer: rochester.idp.issuer,
      clientId: rochester.clientId,
      tenantId: ithaca.tenantId,
    })
    expect(result.stage).toBe("token")
    if (result.stage === "authorised") throw new Error("unreachable")
    expect(result.refusal).toBe("SIGNATURE_INVALID")
  })

  it("grants nothing at Ithaca even if every earlier stage were to pass", () => {
    // The last line of defence, asserted directly: Dana has no live membership
    // of Ithaca, so no seat and no policy can produce authority there.
    expect(
      authorityFromTenureRecords({
        memberships,
        seatCapabilities: ["roster.read"],
        policyCapabilities: ["calendar.write"],
        tenantId: ithaca.tenantId,
        at: NOW,
      }),
    ).toEqual([])
  })

  it("does not resolve Rochester's identity through Ithaca's connection", () => {
    // An identity is keyed by connection *and* issuer *and* subject. The same
    // human at two institutions is two identities, and one is not the other.
    const resolution = resolveAssertion(
      {
        connectionId: ithaca.connectionId,
        issuer: rochester.idp.issuer,
        subject: rochester.subject,
        assertedEmail: "dana@rochester.test",
        emailVerified: true,
      },
      identities,
      connections,
      NOW,
    )
    expect(resolution.outcome).not.toBe("MATCHED")
  })
})

describe("the chain refuses a forged or altered token at the first stage", () => {
  const good = claimsFor(rochester.idp, rochester.clientId, rochester.subject)

  const attempt = (token: string) =>
    signIn({
      token,
      verifyWith: rochester.idp.publicKey,
      connectionId: rochester.connectionId,
      expectedIssuer: rochester.idp.issuer,
      clientId: rochester.clientId,
      tenantId: rochester.tenantId,
    })

  it("refuses a token signed by nobody we trust", () => {
    const impostor = createTestIdp(rochester.idp.issuer)
    const result = attempt(impostor.mint(good))
    expect(result.stage).toBe("token")
    if (result.stage === "authorised") throw new Error("unreachable")
    expect(result.refusal).toBe("SIGNATURE_INVALID")
  })

  it("refuses a token whose subject was swapped after signing", () => {
    const token = rochester.idp.mint(good)
    const [header, , signature] = token.split(".")
    const tampered = `${header}.${base64url(JSON.stringify({ ...good, sub: "idp|attacker" }))}.${signature}`

    const result = attempt(tampered)
    expect(result.stage).toBe("token")
  })

  it("refuses an expired token", () => {
    const result = attempt(rochester.idp.mint({ ...good, exp: seconds(-3600) }))
    if (result.stage === "authorised") throw new Error("unreachable")
    expect(result.refusal).toBe("EXPIRED")
  })

  it("refuses a token minted for a different client", () => {
    const result = attempt(rochester.idp.mint({ ...good, aud: "client-somebody-else" }))
    if (result.stage === "authorised") throw new Error("unreachable")
    expect(result.refusal).toBe("AUDIENCE_MISMATCH")
  })

  it("refuses a replayed nonce", () => {
    const result = attempt(rochester.idp.mint({ ...good, nonce: "a-different-nonce" }))
    if (result.stage === "authorised") throw new Error("unreachable")
    expect(result.refusal).toBe("NONCE_MISMATCH")
  })

  it("refuses an access token presented as an identity", () => {
    const result = attempt(rochester.idp.mint({ ...good, token_use: "access" }))
    if (result.stage === "authorised") throw new Error("unreachable")
    expect(result.refusal).toBe("NOT_AN_ID_TOKEN")
  })

  it("refuses alg:none however the header is dressed", () => {
    const unsigned = `${base64url(JSON.stringify({ alg: "none" }))}.${base64url(JSON.stringify(good))}.`
    const result = attempt(unsigned)
    expect(result.stage).toBe("token")
    if (result.stage === "authorised") throw new Error("unreachable")
    expect(result.refusal).toBe("ALGORITHM_NOT_ALLOWED")
  })
})

describe("a person nobody linked is not signed in", () => {
  it("refuses a validly signed token for an unknown subject", () => {
    // The signature proves the IdP said it. It does not prove anybody at
    // Rochester ever placed this person.
    const token = rochester.idp.mint(
      claimsFor(rochester.idp, rochester.clientId, "idp|never-linked-0009"),
    )
    const result = signIn({
      token,
      verifyWith: rochester.idp.publicKey,
      connectionId: rochester.connectionId,
      expectedIssuer: rochester.idp.issuer,
      clientId: rochester.clientId,
      tenantId: rochester.tenantId,
    })

    expect(result.stage).toBe("resolution")
    if (result.stage === "authorised") throw new Error("unreachable")
    expect(result.refusal).toBe("UNKNOWN")
  })
})

describe("SAML federation, through the same two tenants", () => {
  /** A signed SAML assertion, and the facts a verifying library would report. */
  function mintAssertion(
    idp: TestIdp,
    assertion: Omit<SamlAssertionInput, "signature">,
  ): { assertion: Omit<SamlAssertionInput, "signature">; canonical: string; signature: Buffer } {
    const canonical = JSON.stringify(assertion)
    const signer = createSign("RSA-SHA256")
    signer.update(canonical)
    return { assertion, canonical, signature: signer.sign(idp.privateKey) }
  }

  /** Verify for real, then report what was proved — never assert it blindly. */
  function factsFrom(signed: ReturnType<typeof mintAssertion>, publicKey: KeyObject) {
    const verifier = createVerify("RSA-SHA256")
    verifier.update(signed.canonical)
    const ok = verifier.verify(publicKey, signed.signature)

    return {
      // An unverified assertion reports covering nothing, which is what makes
      // `validateSamlAssertion` refuse it. The facts are produced by the
      // mathematics rather than by the test's intent.
      signedElements: ok ? ["Assertion"] : [],
      algorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
      digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
      keyId: ok ? "key-1" : null,
    }
  }

  const ACS = "https://platform.tenurework.com/api/auth/saml/acs"
  const SP = "urn:tenure:sp:rochester"

  const body = (issuer: string, nameId: string): Omit<SamlAssertionInput, "signature"> => ({
    issuer,
    audiences: [SP],
    assertionId: "_e2e-1",
    inResponseTo: "req-e2e",
    recipient: ACS,
    subjectNotOnOrAfter: new Date(NOW.getTime() + 300_000).toISOString(),
    notBefore: new Date(NOW.getTime() - 60_000).toISOString(),
    notOnOrAfter: new Date(NOW.getTime() + 3_600_000).toISOString(),
    confirmationMethod: "urn:oasis:names:tc:SAML:2.0:cm:bearer",
    nameId,
  })

  const expected = {
    issuer: rochester.idp.issuer,
    serviceProviderEntityId: SP,
    assertionConsumerServiceUrl: ACS,
    expectedInResponseTo: "req-e2e",
    allowIdpInitiated: false,
    clockSkewSeconds: 60,
  }

  it("accepts an assertion this IdP really signed", () => {
    const signed = mintAssertion(rochester.idp, body(rochester.idp.issuer, "dana@rochester.test"))
    const verdict = validateSamlAssertion(
      { ...signed.assertion, signature: factsFrom(signed, rochester.idp.publicKey) },
      expected,
      { at: NOW, seenAssertionIds: new Set() },
    )
    expect(verdict.valid).toBe(true)
  })

  it("refuses one the other tenant's IdP signed", () => {
    // Verification fails, so the facts report no signed elements, so the
    // validator refuses. Three independent steps, none of them arranged.
    const signed = mintAssertion(ithaca.idp, body(rochester.idp.issuer, "dana@rochester.test"))
    const verdict = validateSamlAssertion(
      { ...signed.assertion, signature: factsFrom(signed, rochester.idp.publicKey) },
      expected,
      { at: NOW, seenAssertionIds: new Set() },
    )
    expect(verdict.valid).toBe(false)
    if (verdict.valid) throw new Error("unreachable")
    expect(verdict.reason).toBe("NOT_SIGNED")
  })

  it("refuses one altered after signing", () => {
    // The first version of this test verified the *pre-alteration* canonical
    // form, so the facts said "signed" and the validator accepted the
    // attacker's nameId. No real library behaves that way — it verifies the
    // document as received. Fixing the fake to match reality is what makes this
    // a proof rather than a demonstration of a badly-built test double.
    const signed = mintAssertion(rochester.idp, body(rochester.idp.issuer, "dana@rochester.test"))
    const altered = {
      ...signed,
      assertion: { ...signed.assertion, nameId: "attacker@evil.test" },
    }
    altered.canonical = JSON.stringify(altered.assertion)

    const verdict = validateSamlAssertion(
      { ...altered.assertion, signature: factsFrom(altered, rochester.idp.publicKey) },
      expected,
      { at: NOW, seenAssertionIds: new Set() },
    )

    expect(verdict.valid).toBe(false)
    if (verdict.valid) throw new Error("unreachable")
    expect(verdict.reason).toBe("NOT_SIGNED")
  })

  it("refuses a replayed assertion", () => {
    const signed = mintAssertion(rochester.idp, body(rochester.idp.issuer, "dana@rochester.test"))
    const verdict = validateSamlAssertion(
      { ...signed.assertion, signature: factsFrom(signed, rochester.idp.publicKey) },
      expected,
      { at: NOW, seenAssertionIds: new Set(["_e2e-1"]) },
    )
    expect(verdict.valid).toBe(false)
    if (verdict.valid) throw new Error("unreachable")
    expect(verdict.reason).toBe("REPLAYED")
  })
})
