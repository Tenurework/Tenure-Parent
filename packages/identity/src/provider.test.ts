import {
  IGNORED_CLAIMS,
  resolveAssertion,
  withoutIgnoredClaims,
  type AuthenticationResult,
  type ConnectionState,
  type ExternalIdentity,
  type IdentityProvider,
} from "./index"

/**
 * GE-041-001 — the port is implementable without AWS, and a provider's opinion
 * about groups never becomes an authorization decision.
 *
 * The honest test of a seam is whether something on the other side of it can be
 * built that has nothing to do with the vendor it was designed around. So this
 * file implements the port with a SAML fake that touches no AWS concept, and
 * drives Tenure's own resolution through it end to end.
 */

const NOW = new Date("2026-08-02T12:00:00Z")

/**
 * A provider with no AWS in it.
 *
 * Not a mock standing in for Cognito — a second real implementation, which is
 * the only thing that demonstrates the port is not Cognito-shaped. If this
 * could not be written without importing an SDK, the port would be wrong.
 */
class SamlProvider implements IdentityProvider {
  readonly kind = "saml"
  private readonly transactions = new Map<string, string>()
  private counter = 0

  constructor(private readonly issuer: string) {}

  async beginAuthentication(input: { connectionId: string; returnPath: string }) {
    const transaction = `txn-${++this.counter}`
    this.transactions.set(transaction, input.connectionId)
    return {
      redirectTo: `${this.issuer}/sso?RelayState=${encodeURIComponent(input.returnPath)}`,
      transaction,
    }
  }

  async completeAuthentication(callback: {
    transaction: string
    payload: Readonly<Record<string, string>>
  }): Promise<AuthenticationResult> {
    const connectionId = this.transactions.get(callback.transaction)
    if (!connectionId) {
      return { ok: false, failure: "TRANSACTION_UNKNOWN", detail: "That sign-in attempt is no longer valid." }
    }
    // Single use. A transaction that can be replayed is a sign-in that can be.
    this.transactions.delete(callback.transaction)

    if (!callback.payload.NameID) {
      return { ok: false, failure: "VERIFICATION_FAILED", detail: "That sign-in attempt is no longer valid." }
    }

    return {
      ok: true,
      assertion: {
        connectionId,
        issuer: this.issuer,
        subject: callback.payload.NameID,
        assertedEmail: callback.payload.email ?? null,
        emailVerified: callback.payload.emailVerified === "true",
      },
    }
  }

  async endProviderSession() {
    /* A SAML IdP with no back-channel logout: nothing to do, and saying so is
       honest. Tenure's own invalidation does not depend on this. */
  }
}

const ISSUER = "https://idp.rochester.example/saml"

describe("the port can be implemented with no AWS anywhere", () => {
  it("carries an authentication from start to a Tenure assertion", async () => {
    const provider = new SamlProvider(ISSUER)

    const start = await provider.beginAuthentication({ connectionId: "conn-saml", returnPath: "/dashboard" })
    expect(start.redirectTo).toContain(ISSUER)
    expect(start.transaction).not.toContain("@")

    const result = await provider.completeAuthentication({
      transaction: start.transaction,
      payload: { NameID: "S-1-5-21-99", email: "a.person@rochester.example", emailVerified: "true" },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.assertion).toEqual({
      connectionId: "conn-saml",
      issuer: ISSUER,
      subject: "S-1-5-21-99",
      assertedEmail: "a.person@rochester.example",
      emailVerified: true,
    })
  })

  it("produces an assertion Tenure's own resolver accepts", async () => {
    // The seam proven end to end: a provider that knows nothing about Tenure
    // hands over an assertion, and Tenure decides who that is.
    const provider = new SamlProvider(ISSUER)
    const start = await provider.beginAuthentication({ connectionId: "conn-saml", returnPath: "/" })
    const result = await provider.completeAuthentication({
      transaction: start.transaction,
      payload: { NameID: "S-1-5-21-99" },
    })
    if (!result.ok) throw new Error("expected a verified assertion")

    const identity: ExternalIdentity = {
      id: "ext-1",
      personId: "person-1",
      connectionId: "conn-saml",
      issuer: ISSUER,
      subject: "S-1-5-21-99",
      assertedEmail: null,
      emailVerified: false,
      status: "ACTIVE",
      linkedAt: "2026-01-01T00:00:00Z",
      lastAuthenticatedAt: null,
    }
    const connection: ConnectionState = { id: "conn-saml", status: "ACTIVE", issuer: ISSUER }

    const outcome = resolveAssertion(result.assertion, [identity], [connection], NOW)
    expect(outcome.outcome).toBe("MATCHED")
    if (outcome.outcome !== "MATCHED") return
    expect(outcome.personId).toBe("person-1")
  })

  it("refuses a replayed transaction", async () => {
    // A transaction that can be replayed is a sign-in that can be.
    const provider = new SamlProvider(ISSUER)
    const start = await provider.beginAuthentication({ connectionId: "conn-saml", returnPath: "/" })
    const payload = { NameID: "S-1" }

    expect((await provider.completeAuthentication({ transaction: start.transaction, payload })).ok).toBe(true)
    const second = await provider.completeAuthentication({ transaction: start.transaction, payload })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.failure).toBe("TRANSACTION_UNKNOWN")
  })

  it("says the same thing for an unknown transaction and a failed verification", async () => {
    // Bible §9.1: never reveals whether a person exists. Two different causes
    // must not be distinguishable from outside.
    const provider = new SamlProvider(ISSUER)
    const start = await provider.beginAuthentication({ connectionId: "conn-saml", returnPath: "/" })

    const unverified = await provider.completeAuthentication({ transaction: start.transaction, payload: {} })
    const unknown = await provider.completeAuthentication({ transaction: "txn-nope", payload: {} })

    if (unverified.ok || unknown.ok) throw new Error("expected both to fail")
    expect(unverified.detail).toBe(unknown.detail)
  })

  it("leaves optional lifecycle methods genuinely optional", () => {
    // A connection that cannot provision must be able to say so by not
    // implementing it, rather than by throwing at the call site.
    // Typed as the port, not the class: the claim is that a conforming
    // implementation may omit them, which is a statement about IdentityProvider.
    const provider: IdentityProvider = new SamlProvider(ISSUER)
    expect(provider.readAccount).toBeUndefined()
    expect(provider.disableAccount).toBeUndefined()
  })
})

describe("a provider's opinion about groups is not authority", () => {
  it("strips every claim Tenure must not act on", () => {
    // Bible: authority comes from an assignment, "not from a title string,
    // email domain, Cognito group, or UI state".
    const claims = {
      sub: "S-1",
      email: "a@b.example",
      groups: ["admins"],
      "cognito:groups": ["Directors"],
      roles: ["treasurer"],
      "cognito:roles": ["arn:aws:iam::1:role/x"],
      "custom:role": "president",
      department: "Chemistry",
    }

    expect(withoutIgnoredClaims(claims)).toEqual({
      sub: "S-1",
      email: "a@b.example",
      department: "Chemistry",
    })
  })

  it("keeps claims that are merely informational", () => {
    // Stripping everything would push adapters to bypass this to show a
    // display name, which is how a stripper stops being used at all.
    expect(withoutIgnoredClaims({ given_name: "A", family_name: "B" })).toEqual({
      given_name: "A",
      family_name: "B",
    })
  })

  it("names every claim shape a provider uses for authorization", () => {
    for (const claim of ["groups", "cognito:groups", "roles"]) {
      expect(IGNORED_CLAIMS).toContain(claim)
    }
  })

  it("returns a new object rather than mutating the caller's", () => {
    const claims = { groups: ["admins"], sub: "S-1" }
    withoutIgnoredClaims(claims)
    expect(claims.groups).toEqual(["admins"])
  })
})
