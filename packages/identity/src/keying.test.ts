import {
  applyAssertedEmail,
  connectionsToOffer,
  emailCollisions,
  identityKey,
  keyOf,
  resolveAssertion,
  type ConnectionState,
  type ExternalIdentity,
  type IdentityAssertion,
} from "./index"

/**
 * GE-040-002 — keying, and the two things email must never do.
 *
 * Each rule here is something an identity system is tempted to do because it is
 * convenient, and each one is an account takeover. Most of these tests assert
 * that a tempting shortcut does *not* happen.
 */

const NOW = new Date("2026-08-02T12:00:00Z")

const identity = (over: Partial<ExternalIdentity> = {}): ExternalIdentity => ({
  id: "ext-1",
  personId: "person-1",
  connectionId: "conn-rochester-saml",
  issuer: "https://idp.rochester.example/saml",
  subject: "S-1-5-21-99",
  assertedEmail: "a.person@rochester.example",
  emailVerified: true,
  status: "ACTIVE",
  linkedAt: "2026-01-01T00:00:00Z",
  lastAuthenticatedAt: null,
  ...over,
})

const assertion = (over: Partial<IdentityAssertion> = {}): IdentityAssertion => ({
  connectionId: "conn-rochester-saml",
  issuer: "https://idp.rochester.example/saml",
  subject: "S-1-5-21-99",
  assertedEmail: "a.person@rochester.example",
  emailVerified: true,
  ...over,
})

const connection = (over: Partial<ConnectionState> = {}): ConnectionState => ({
  id: "conn-rochester-saml",
  status: "ACTIVE",
  issuer: "https://idp.rochester.example/saml",
  ...over,
})

describe("the key is connection + issuer + subject, all three", () => {
  it("matches an assertion to the identity with the same three parts", () => {
    const outcome = resolveAssertion(assertion(), [identity()], [connection()], NOW)
    expect(outcome.outcome).toBe("MATCHED")
    if (outcome.outcome !== "MATCHED") return
    expect(outcome.personId).toBe("person-1")
  })

  it("does not match the same subject through a different connection", () => {
    // A connection is *this tenant's* decision to trust an issuer. Dropping it
    // from the key means an assertion minted for one tenant resolves inside
    // another that happens to trust the same IdP.
    const other = resolveAssertion(
      assertion({ connectionId: "conn-other-tenant" }),
      [identity()],
      [connection({ id: "conn-other-tenant" })],
      NOW,
    )
    expect(other.outcome).toBe("UNKNOWN")
  })

  it("does not match the same subject from a different issuer", () => {
    const outcome = resolveAssertion(
      assertion({ issuer: "https://evil.example/saml" }),
      [identity()],
      [connection({ issuer: "https://evil.example/saml" })],
      NOW,
    )
    expect(outcome.outcome).toBe("UNKNOWN")
  })

  it("treats subjects differing only in case as different people", () => {
    // Normalising case here would silently merge two distinct subjects, on the
    // one value that decides who someone is. SAML NameIDs are case-sensitive.
    const outcome = resolveAssertion(assertion({ subject: "s-1-5-21-99" }), [identity()], [connection()], NOW)
    expect(outcome.outcome).toBe("UNKNOWN")
  })

  it("cannot be collided by moving a separator between parts", () => {
    // Joining on a printable character means an issuer ending in it and a
    // subject starting with it produce the same key as a different pair — a
    // collision an attacker constructs rather than a theoretical one.
    const left = identityKey({ connectionId: "c", issuer: "a", subject: "b:c" })
    const right = identityKey({ connectionId: "c", issuer: "a:b", subject: "c" })
    expect(left).not.toBe(right)

    const withPipe = identityKey({ connectionId: "c", issuer: "a", subject: "b|c" })
    const withPipeMoved = identityKey({ connectionId: "c", issuer: "a|b", subject: "c" })
    expect(withPipe).not.toBe(withPipeMoved)
  })

  it("keys an identity the same way it keys an assertion", () => {
    expect(keyOf(identity())).toBe(identityKey(assertion()))
  })
})

describe("an assertion is trusted because of who signed it", () => {
  it("refuses a connection that is not active", () => {
    for (const status of ["PENDING", "DISABLED", "REVOKED"]) {
      const outcome = resolveAssertion(assertion(), [identity()], [connection({ status })], NOW)
      expect(outcome.outcome).toBe("REFUSED")
      if (outcome.outcome !== "REFUSED") continue
      expect(outcome.reason).toBe("CONNECTION_NOT_TRUSTED")
    }
  })

  it("refuses a connection that does not exist", () => {
    const outcome = resolveAssertion(assertion(), [identity()], [], NOW)
    expect(outcome.outcome).toBe("REFUSED")
  })

  it("refuses an issuer the connection was not configured for", () => {
    // Otherwise a connection is a label rather than a trust relationship, and
    // anyone who could reach the callback could name their own issuer.
    const outcome = resolveAssertion(
      assertion({ issuer: "https://evil.example/saml" }),
      [identity()],
      [connection()],
      NOW,
    )
    expect(outcome.outcome).toBe("REFUSED")
    if (outcome.outcome !== "REFUSED") return
    expect(outcome.reason).toBe("ISSUER_MISMATCH")
  })

  it("refuses an assertion missing any part of the key", () => {
    for (const missing of [{ connectionId: " " }, { issuer: "" }, { subject: "  " }]) {
      const outcome = resolveAssertion(assertion(missing), [identity()], [connection()], NOW)
      expect(outcome.outcome).toBe("REFUSED")
      if (outcome.outcome !== "REFUSED") continue
      expect(outcome.reason).toBe("MALFORMED_ASSERTION")
    }
  })

  it("refuses a revoked identity without saying whose it is", () => {
    // Bible §9.1: never reveals whether a person exists. The detail must not
    // name the person, the address, or anything that distinguishes "revoked"
    // from "never existed" to someone probing.
    const outcome = resolveAssertion(assertion(), [identity({ status: "REVOKED" })], [connection()], NOW)
    expect(outcome.outcome).toBe("REFUSED")
    if (outcome.outcome !== "REFUSED") return
    expect(outcome.reason).toBe("IDENTITY_NOT_USABLE")
    expect(outcome.detail).not.toContain("person-1")
    expect(outcome.detail).not.toContain("rochester.example")
  })

  it("carries no person data on an unknown subject", () => {
    // The leak is usually not a message but a *shape*: two branches returning
    // subtly different objects that a caller renders differently.
    const outcome = resolveAssertion(assertion({ subject: "nobody" }), [identity()], [connection()], NOW)
    expect(outcome).toEqual({ outcome: "UNKNOWN" })
  })
})

describe("email is an attribute, and it moves", () => {
  it("updates the address without changing who the identity points to", () => {
    // A system that keys on email loses the person the day HR does a domain
    // migration.
    const before = identity()
    const after = applyAssertedEmail(before, assertion({ assertedEmail: "new.name@rochester2.example" }), NOW)

    expect(after.assertedEmail).toBe("new.name@rochester2.example")
    expect(after.personId).toBe(before.personId)
    expect(keyOf(after)).toBe(keyOf(before))
  })

  it("still resolves after the address changes", () => {
    const moved = applyAssertedEmail(identity(), assertion({ assertedEmail: "elsewhere@example.invalid" }), NOW)
    const outcome = resolveAssertion(assertion(), [moved], [connection()], NOW)
    expect(outcome.outcome).toBe("MATCHED")
  })

  it("records the verification the provider claimed, and the time", () => {
    const after = applyAssertedEmail(identity(), assertion({ emailVerified: false }), NOW)
    expect(after.emailVerified).toBe(false)
    expect(after.lastAuthenticatedAt).toBe(NOW.toISOString())
  })

  it("cannot be made to re-key an identity through the assertion", () => {
    // A provider that starts asserting a different subject for the same human
    // is a NEW identity to be linked under review, not this row repointed.
    const after = applyAssertedEmail(
      identity(),
      assertion({ connectionId: "other", issuer: "https://elsewhere", subject: "different" }),
      NOW,
    )
    expect(keyOf(after)).toBe(keyOf(identity()))
  })
})

describe("email never merges anything", () => {
  it("reports two people asserting one address without resolving it", () => {
    // The single most common identity vulnerability: an attacker who can
    // receive mail at a re-issued alias inherits the account.
    const shared = [
      identity({ id: "ext-1", personId: "person-1", assertedEmail: "shared@rochester.example" }),
      identity({ id: "ext-2", personId: "person-2", subject: "S-2", assertedEmail: "shared@rochester.example" }),
    ]
    const collisions = emailCollisions(shared)

    expect(collisions).toHaveLength(1)
    expect(collisions[0].personIds).toEqual(["person-1", "person-2"])
    expect(collisions[0].detail).toMatch(/reported, not resolved/)
  })

  it("says a verified claim proves only that the provider believes it", () => {
    const shared = [
      identity({ id: "ext-1", personId: "person-1", assertedEmail: "s@x.example", emailVerified: true }),
      identity({ id: "ext-2", personId: "person-2", subject: "S-2", assertedEmail: "s@x.example", emailVerified: true }),
    ]
    expect(emailCollisions(shared)[0].detail).toMatch(/believe it today/)
  })

  it("distinguishes one person's two credentials from two people", () => {
    // Expected when somebody has both an SSO and a local credential. Reporting
    // it as a conflict would train reviewers to dismiss the real ones.
    const same = [
      identity({ id: "ext-1", personId: "person-1", assertedEmail: "one@x.example" }),
      identity({ id: "ext-2", personId: "person-1", connectionId: "conn-local", subject: "cognito-sub", assertedEmail: "one@x.example" }),
    ]
    const collisions = emailCollisions(same)
    expect(collisions[0].personIds).toEqual(["person-1"])
    expect(collisions[0].detail).toMatch(/nothing to do/)
  })

  it("detects a collision that differs only in case", () => {
    // Mailbox providers treat addresses case-insensitively, so this is still a
    // collision worth a human looking at. The normalisation is for detection
    // only and never touches a key.
    const shared = [
      identity({ id: "ext-1", personId: "person-1", assertedEmail: "Shared@X.example" }),
      identity({ id: "ext-2", personId: "person-2", subject: "S-2", assertedEmail: "shared@x.example" }),
    ]
    expect(emailCollisions(shared)).toHaveLength(1)
  })

  it("ignores identities with no address at all", () => {
    const none = [
      identity({ id: "ext-1", assertedEmail: null }),
      identity({ id: "ext-2", personId: "person-2", subject: "S-2", assertedEmail: null }),
    ]
    expect(emailCollisions(none)).toEqual([])
  })

  it("returns the same report in the same order every time", () => {
    const many = [
      identity({ id: "b", personId: "p1", assertedEmail: "b@x.example" }),
      identity({ id: "a", personId: "p2", subject: "S-2", assertedEmail: "b@x.example" }),
      identity({ id: "d", personId: "p3", subject: "S-3", assertedEmail: "a@x.example" }),
      identity({ id: "c", personId: "p4", subject: "S-4", assertedEmail: "a@x.example" }),
    ]
    const once = emailCollisions(many)
    expect(once.map((c) => c.email)).toEqual(["a@x.example", "b@x.example"])
    expect(once[0].identityIds).toEqual(["c", "d"])
    expect(emailCollisions(many)).toEqual(once)
  })
})

describe("an email domain is a discovery hint and nothing more", () => {
  const domains = [
    { domain: "rochester.example", tenantId: "rochester", state: "VERIFIED" },
    { domain: "claimed.example", tenantId: "someone-else", state: "PENDING" },
  ]
  const byTenant = { rochester: ["conn-rochester-saml", "conn-local"], "someone-else": ["conn-theirs"] }

  it("offers the connections of a tenant whose domain is verified", () => {
    expect(connectionsToOffer("a.person@rochester.example", domains, byTenant)).toEqual([
      "conn-local",
      "conn-rochester-saml",
    ])
  })

  it("offers nothing for a domain that is merely claimed", () => {
    // Honouring a pending claim would let anyone enumerate which tenants exist
    // by claiming their domains.
    expect(connectionsToOffer("someone@claimed.example", domains, byTenant)).toEqual([])
  })

  it("offers nothing for an unknown domain", () => {
    expect(connectionsToOffer("someone@nowhere.example", domains, byTenant)).toEqual([])
  })

  it("returns connection ids only — there is no tenant or membership in the result", () => {
    // The rule is structural, not a convention: the shape has nowhere to put a
    // grant, so "grant membership from this" is unwritable rather than merely
    // discouraged.
    const offered = connectionsToOffer("a.person@ROCHESTER.example", domains, byTenant)
    expect(offered.every((entry) => typeof entry === "string")).toBe(true)
    expect(JSON.stringify(offered)).not.toContain("rochester\"")
  })

  it("handles an address with no domain without throwing", () => {
    expect(connectionsToOffer("not-an-address", domains, byTenant)).toEqual([])
    expect(connectionsToOffer("trailing@", domains, byTenant)).toEqual([])
  })
})
