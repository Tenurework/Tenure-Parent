import {
  validateSamlAssertion,
  type AssertionRefusal,
  type ExpectedAssertion,
  type SamlAssertionInput,
} from "./index"

/**
 * GE-043-001 — every check here is a class somebody has been breached by.
 *
 * A test that only asserts the happy path proves the validator runs. These
 * assert that each individual check is load-bearing, by removing exactly one
 * condition at a time from an otherwise valid assertion.
 */

const NOW = new Date("2026-08-03T12:00:00Z")
const iso = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString()

const SP = "https://tenure.example.edu/saml/sp"
const ACS = "https://tenure.example.edu/api/auth/saml/acs"
const IDP = "https://idp.rochester.example.edu/metadata"

const expected: ExpectedAssertion = {
  issuer: IDP,
  serviceProviderEntityId: SP,
  assertionConsumerServiceUrl: ACS,
  expectedInResponseTo: "req-abc123",
  allowIdpInitiated: false,
  clockSkewSeconds: 60,
}

const assertion = (over: Partial<SamlAssertionInput> = {}): SamlAssertionInput => ({
  issuer: IDP,
  audiences: [SP],
  assertionId: "_a1b2c3",
  inResponseTo: "req-abc123",
  recipient: ACS,
  destination: ACS,
  subjectNotOnOrAfter: iso(5),
  notBefore: iso(-1),
  notOnOrAfter: iso(60),
  confirmationMethod: "urn:oasis:names:tc:SAML:2.0:cm:bearer",
  nameId: "dana.whitfield@rochester.example.edu",
  signature: {
    signedElements: ["Assertion"],
    algorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    keyId: "key-1",
    // Assertion-only signing by default, which is what most identity providers
    // send. The Destination tests below turn this on deliberately.
    responseSigned: false,
  },
  ...over,
})

const validate = (
  input: Partial<SamlAssertionInput> = {},
  over: Partial<ExpectedAssertion> = {},
  seen: ReadonlySet<string> = new Set(),
) =>
  validateSamlAssertion(assertion(input), { ...expected, ...over }, { at: NOW, seenAssertionIds: seen })

/** Assert a refusal and its reason, with the accepted case never silently passing. */
function refusedBecause(verdict: ReturnType<typeof validate>, reason: AssertionRefusal) {
  expect(verdict.valid).toBe(false)
  if (verdict.valid) throw new Error("expected a refusal")
  expect(verdict.reason).toBe(reason)
  expect(verdict.detail.length).toBeGreaterThan(20)
}

describe("the assertion that should be accepted, is", () => {
  it("accepts a well-formed assertion", () => {
    // Without this every refusal below could be produced by a validator that
    // refuses everything, which is a different bug wearing the same green.
    const verdict = validate()
    expect(verdict.valid).toBe(true)
    if (!verdict.valid) throw new Error(verdict.detail)
    expect(verdict.nameId).toBe("dana.whitfield@rochester.example.edu")
    expect(verdict.assertionId).toBe("_a1b2c3")
  })

  it("reports when the assertion stops being replay-relevant", () => {
    // A replay cache needs an eviction time, and taking the later window plus
    // skew stops a short subject window evicting an id the Conditions window
    // still honours.
    const verdict = validate()
    if (!verdict.valid) throw new Error(verdict.detail)
    expect(Date.parse(verdict.repeatableAfter)).toBeGreaterThanOrEqual(Date.parse(iso(60)))
  })
})

describe("XML signature wrapping", () => {
  it("refuses an assertion the signature did not cover", () => {
    // The attack: leave the signed element intact, add an unsigned one the
    // application reads instead. "The document was signed" is the wrong
    // question; "was the element I am about to trust signed" is the right one.
    refusedBecause(validate({ signature: { ...assertion().signature, signedElements: ["Response"] } }), "NOT_SIGNED")
  })

  it("refuses an assertion with no signature at all", () => {
    // "No signature was found" and "the signature is fine" must never be the
    // same input.
    refusedBecause(validate({ signature: { ...assertion().signature, signedElements: [] } }), "NOT_SIGNED")
  })

  it("checks the signature before reading anything else", () => {
    // Every field below the signature check is attacker input until it is
    // covered. An assertion that is unsigned *and* expired must report
    // NOT_SIGNED, or the ordering has drifted and expiry is being read from an
    // unsigned document.
    refusedBecause(
      validate({
        signature: { ...assertion().signature, signedElements: [] },
        notOnOrAfter: iso(-600),
        issuer: "https://attacker.test",
      }),
      "NOT_SIGNED",
    )
  })
})

describe("weak algorithms", () => {
  it("refuses an SHA-1 signature", () => {
    refusedBecause(
      validate({
        signature: {
          ...assertion().signature,
          algorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
        },
      }),
      "WEAK_SIGNATURE_ALGORITHM",
    )
  })

  it("refuses an absent algorithm rather than assuming one", () => {
    refusedBecause(
      validate({ signature: { ...assertion().signature, algorithm: null } }),
      "WEAK_SIGNATURE_ALGORITHM",
    )
  })

  it("refuses a strong signature over a SHA-1 digest", () => {
    // The digest is what the signature commits to, so a weak digest inherits
    // its collisions to the whole document.
    refusedBecause(
      validate({
        signature: {
          ...assertion().signature,
          digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
        },
      }),
      "WEAK_DIGEST_ALGORITHM",
    )
  })

  it("refuses an unidentified verifying key", () => {
    refusedBecause(validate({ signature: { ...assertion().signature, keyId: null } }), "UNKNOWN_KEY")
  })
})

describe("who sent it and who it is for", () => {
  it("refuses another provider's issuer", () => {
    // A perfectly valid assertion from a different tenant's IdP is still not
    // valid here.
    refusedBecause(validate({ issuer: "https://idp.ithaca.example.edu/metadata" }), "WRONG_ISSUER")
  })

  it("refuses an assertion minted for another service", () => {
    // The provider signed it; it just was not for us. Without the audience
    // check, any service that federates with the same IdP can replay its
    // assertions here.
    refusedBecause(validate({ audiences: ["https://other.example.edu/sp"] }), "WRONG_AUDIENCE")
  })

  it("refuses an empty audience list", () => {
    refusedBecause(validate({ audiences: [] }), "WRONG_AUDIENCE")
  })

  it("accepts when our audience is one of several", () => {
    // Multi-audience assertions are legal, and refusing them would break real
    // providers for no security gain.
    expect(validate({ audiences: ["https://other.example.edu/sp", SP] }).valid).toBe(true)
  })

  it("refuses a recipient that is not our ACS", () => {
    refusedBecause(validate({ recipient: "https://evil.test/acs" }), "WRONG_RECIPIENT")
  })

  it("tolerates an absent recipient, which is optional in the standard", () => {
    expect(validate({ recipient: null }).valid).toBe(true)
  })
})

describe("time", () => {
  it("refuses one that has expired", () => {
    refusedBecause(validate({ notOnOrAfter: iso(-2) }), "EXPIRED")
  })

  it("treats NotOnOrAfter as exclusive", () => {
    // "On or after" — an assertion is dead at exactly its limit, and an
    // inclusive comparison here grants one extra instant on every assertion.
    refusedBecause(validate({ notOnOrAfter: iso(-1), subjectNotOnOrAfter: iso(5) }), "EXPIRED")
  })

  it("refuses one that is not valid yet", () => {
    refusedBecause(validate({ notBefore: iso(10) }), "NOT_YET_VALID")
  })

  it("allows the configured clock skew in both directions", () => {
    // IdP clocks drift, and a validator with no tolerance produces intermittent
    // failures nobody can reproduce.
    expect(validate({ notBefore: new Date(NOW.getTime() + 30_000).toISOString() }).valid).toBe(true)
    expect(validate({ notOnOrAfter: new Date(NOW.getTime() - 30_000).toISOString() }).valid).toBe(true)
  })

  it("does not allow skew beyond what was configured", () => {
    // Otherwise the tolerance is unbounded and the windows mean nothing.
    refusedBecause(validate({ notOnOrAfter: new Date(NOW.getTime() - 61_000).toISOString() }), "EXPIRED")
  })

  it("reports a spent subject window separately from a spent Conditions window", () => {
    // The subject window is usually minutes where Conditions is hours, and an
    // operator diagnosing this needs to know which clock to look at.
    refusedBecause(validate({ subjectNotOnOrAfter: iso(-5) }), "SUBJECT_EXPIRED")
  })

  it("refuses an unparseable window rather than ignoring it", () => {
    refusedBecause(validate({ notOnOrAfter: "not-a-time" }), "EXPIRED")
    refusedBecause(validate({ notBefore: "not-a-time" }), "NOT_YET_VALID")
  })
})

describe("that we asked for it", () => {
  it("refuses an assertion answering a different request", () => {
    // An assertion captured from somebody else's sign-in.
    refusedBecause(validate({ inResponseTo: "req-somebody-else" }), "WRONG_IN_RESPONSE_TO")
  })

  it("refuses an assertion with no InResponseTo when we started the flow", () => {
    refusedBecause(validate({ inResponseTo: null }), "WRONG_IN_RESPONSE_TO")
  })

  it("refuses an unsolicited assertion when IdP-initiated is off", () => {
    // Login CSRF: an assertion nobody asked for cannot be tied to a browser
    // that started at our door.
    refusedBecause(
      validate({ inResponseTo: null }, { expectedInResponseTo: null, allowIdpInitiated: false }),
      "UNSOLICITED",
    )
  })

  it("accepts an unsolicited assertion only where that was enabled", () => {
    expect(
      validate({ inResponseTo: null }, { expectedInResponseTo: null, allowIdpInitiated: true }).valid,
    ).toBe(true)
  })

  it("refuses one answering a request we did not send, even with IdP-initiated on", () => {
    // Enabling IdP-initiated permits assertions with no InResponseTo. It does
    // not permit one carrying somebody else's request id.
    refusedBecause(
      validate({ inResponseTo: "req-somebody-else" }, { expectedInResponseTo: null, allowIdpInitiated: true }),
      "UNSOLICITED",
    )
  })

  it("refuses a confirmation method other than bearer", () => {
    refusedBecause(
      validate({ confirmationMethod: "urn:oasis:names:tc:SAML:2.0:cm:sender-vouches" }),
      "WRONG_CONFIRMATION_METHOD",
    )
  })

  it("refuses an absent confirmation method", () => {
    refusedBecause(validate({ confirmationMethod: null }), "WRONG_CONFIRMATION_METHOD")
  })
})

describe("replay", () => {
  it("refuses an assertion id already accepted", () => {
    // A bearer assertion is a credential until it expires, and its window is
    // long enough to reuse.
    refusedBecause(validate({}, {}, new Set(["_a1b2c3"])), "REPLAYED")
  })

  it("accepts a different assertion id from the same sign-in window", () => {
    expect(validate({ assertionId: "_d4e5f6" }, {}, new Set(["_a1b2c3"])).valid).toBe(true)
  })
})

describe("the NameID comment-truncation class", () => {
  it("refuses a NameID carrying an XML comment", () => {
    // The Ruby SAML / GitHub Enterprise class: some parsers strip comments and
    // some treat them as text-node boundaries, so this reads as one identity to
    // the signature check and another to the application.
    refusedBecause(
      validate({ nameId: "admin@rochester.example.edu<!---->.evil.test" }),
      "AMBIGUOUS_NAME_ID",
    )
  })

  it("refuses surrounding whitespace rather than trimming it", () => {
    // Trimming picks one of the two readings, and the problem is that there
    // are two.
    refusedBecause(validate({ nameId: " dana@rochester.example.edu " }), "AMBIGUOUS_NAME_ID")
  })

  it("refuses control characters", () => {
    refusedBecause(validate({ nameId: `dana\u0000@rochester.example.edu` }), "AMBIGUOUS_NAME_ID")
  })

  it("refuses an assertion that identifies nobody", () => {
    refusedBecause(validate({ nameId: null }), "NO_NAME_ID")
    refusedBecause(validate({ nameId: "" }), "NO_NAME_ID")
  })

  it("accepts an ordinary address, so the checks above are not blanket", () => {
    expect(validate({ nameId: "priya.raman+ose@rochester.example.edu" }).valid).toBe(true)
  })
})

describe("every refusal is distinguishable", () => {
  it("gives each class its own reason", () => {
    // One reason for everything would make the audit trail useless at exactly
    // the moment somebody is reading it.
    const reasons = [
      validate({ signature: { ...assertion().signature, signedElements: [] } }),
      validate({ signature: { ...assertion().signature, algorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1" } }),
      validate({ issuer: "https://elsewhere.test" }),
      validate({ audiences: [] }),
      validate({ recipient: "https://evil.test/acs" }),
      validate({ notOnOrAfter: iso(-9) }),
      validate({ notBefore: iso(9) }),
      validate({ subjectNotOnOrAfter: iso(-9) }),
      validate({ inResponseTo: "other" }),
      validate({ confirmationMethod: null }),
      validate({}, {}, new Set(["_a1b2c3"])),
      validate({ nameId: null }),
    ].map((verdict) => (verdict.valid ? "VALID" : verdict.reason))

    expect(new Set(reasons).size).toBe(reasons.length)
    expect(reasons).not.toContain("VALID")
  })
})

/**
 * GE-044-006 — `Response/@Destination`, and why checking it is conditional.
 *
 * This is the check most implementations get backwards. Destination sits on the
 * Response element, so an Assertion-only signature leaves it completely
 * unprotected: an attacker replaying an assertion to a different endpoint simply
 * rewrites it. Checking an unprotected value refuses nothing an attacker cannot
 * trivially fix, while reading as a defence in the code and in a review.
 *
 * When the Response *is* signed, Destination is real evidence.
 */
describe("Response/@Destination", () => {
  const signedResponse = (over: Partial<SamlAssertionInput> = {}) =>
    assertion({
      ...over,
      signature: { ...assertion().signature, responseSigned: true, ...(over.signature ?? {}) },
    })

  const verdictFor = (input: SamlAssertionInput) =>
    validateSamlAssertion(input, expected, { at: NOW, seenAssertionIds: new Set() })

  it("refuses a signed Response addressed somewhere else", () => {
    const verdict = verdictFor(signedResponse({ destination: "https://evil.test/acs" }))
    expect(verdict.valid).toBe(false)
    if (verdict.valid) throw new Error("unreachable")
    expect(verdict.reason).toBe("WRONG_DESTINATION")
  })

  it("accepts a signed Response addressed to us", () => {
    // Without this the refusal above could come from a rule that refuses every
    // signed Response.
    expect(verdictFor(signedResponse({ destination: ACS })).valid).toBe(true)
  })

  it("ignores Destination when the Response is unsigned", () => {
    // The subtle half. An attacker who can rewrite Destination gains nothing
    // from us checking it, and a validator that refused here would reject
    // legitimate assertions from every Assertion-only provider — which is most
    // of them — for a value that proves nothing either way.
    const verdict = verdictFor(assertion({ destination: "https://evil.test/acs" }))
    expect(verdict.valid).toBe(true)
  })

  it("still refuses a wrong Recipient when the Response is unsigned", () => {
    // Because Recipient lives inside the signed Assertion, it is the check that
    // carries the weight in that deployment. Ignoring Destination is only safe
    // because this is not ignored.
    const verdict = verdictFor(assertion({ recipient: "https://evil.test/acs" }))
    expect(verdict.valid).toBe(false)
    if (verdict.valid) throw new Error("unreachable")
    expect(verdict.reason).toBe("WRONG_RECIPIENT")
  })

  it("tolerates an absent Destination on a signed Response", () => {
    // Optional in the standard for an unsolicited response, and refusing an
    // absent attribute would break providers that omit it legitimately.
    expect(verdictFor(signedResponse({ destination: null })).valid).toBe(true)
  })

  it("reports Destination separately from Recipient", () => {
    // Two attributes, two protections, two diagnoses. An operator told "wrong
    // recipient" would look inside the assertion for a value that is fine.
    const destination = verdictFor(signedResponse({ destination: "https://evil.test/acs" }))
    const recipient = verdictFor(signedResponse({ recipient: "https://evil.test/acs" }))
    if (destination.valid || recipient.valid) throw new Error("unreachable")

    expect(destination.reason).not.toBe(recipient.reason)
  })
})
