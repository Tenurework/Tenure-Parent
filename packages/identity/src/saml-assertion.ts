/**
 * GE-043-001 — strict SAML assertion validation.
 *
 * SAML fails in ways that look like success. Every check below corresponds to a
 * documented, repeatedly-exploited class, and each one has been shipped missing
 * by products that had the others.
 *
 * This validates a **parsed and signature-verified** assertion. Parsing XML and
 * checking a signature belong to a hardened library, not to code written here —
 * XML canonicalisation is not a thing to reimplement. What this owns is the
 * decision the library cannot make: given a document whose signature checked
 * out, is *this* assertion, from *this* provider, addressed to *us*, right now,
 * and not one we have already accepted.
 *
 * The caller states what the library proved via `signature`, and this refuses
 * anything short of it. A caller passing `signedElements: []` gets a refusal
 * rather than a pass, because "no signature was found" and "the signature is
 * fine" must never be the same input.
 */

export interface SamlAssertionInput {
  /** `saml:Issuer`. Compared against the connection's configured entity id. */
  issuer: string
  /** `AudienceRestriction/Audience`. Every value present. */
  audiences: readonly string[]
  /** `Assertion/@ID`, for replay detection. */
  assertionId: string
  /** `SubjectConfirmationData/@InResponseTo`, when the flow was SP-initiated. */
  inResponseTo: string | null
  /** `SubjectConfirmationData/@Recipient`. */
  recipient: string | null
  /** `SubjectConfirmationData/@NotOnOrAfter`. */
  subjectNotOnOrAfter: string | null
  /** `Conditions/@NotBefore`. */
  notBefore: string | null
  /** `Conditions/@NotOnOrAfter`. */
  notOnOrAfter: string | null
  /** `SubjectConfirmation/@Method`. */
  confirmationMethod: string | null
  /** The `NameID` text, exactly as the parser returned it. */
  nameId: string | null
  /** What the signature-verifying library actually proved. */
  signature: SignatureFacts
}

export interface SignatureFacts {
  /**
   * Which elements the verified signature covered, by local name.
   *
   * A response signature does not protect the assertion inside it. XML
   * signature wrapping works by leaving a signed element intact and adding an
   * unsigned one the application reads instead — so "the document was signed"
   * is not the question. "Was the element I am about to trust signed" is.
   */
  signedElements: readonly string[]
  /** The `SignatureMethod/@Algorithm` URI. */
  algorithm: string | null
  /** The `DigestMethod/@Algorithm` URI. */
  digestAlgorithm: string | null
  /** The id of the connection signing key that verified. */
  keyId: string | null
}

export interface ExpectedAssertion {
  /** The connection's configured IdP entity id. */
  issuer: string
  /** Our SP entity id. The only acceptable audience. */
  serviceProviderEntityId: string
  /** Our ACS URL. The only acceptable recipient. */
  assertionConsumerServiceUrl: string
  /** The request id, when we started the flow. Null for IdP-initiated. */
  expectedInResponseTo: string | null
  /** Whether IdP-initiated sign-in is permitted for this connection. */
  allowIdpInitiated: boolean
  /** Tolerated clock difference, in seconds. */
  clockSkewSeconds: number
}

export type AssertionRefusal =
  | "NOT_SIGNED"
  | "WEAK_SIGNATURE_ALGORITHM"
  | "WEAK_DIGEST_ALGORITHM"
  | "UNKNOWN_KEY"
  | "WRONG_ISSUER"
  | "WRONG_AUDIENCE"
  | "WRONG_RECIPIENT"
  | "NOT_YET_VALID"
  | "EXPIRED"
  | "SUBJECT_EXPIRED"
  | "UNSOLICITED"
  | "WRONG_IN_RESPONSE_TO"
  | "WRONG_CONFIRMATION_METHOD"
  | "REPLAYED"
  | "AMBIGUOUS_NAME_ID"
  | "NO_NAME_ID"

export interface AssertionRejected {
  valid: false
  reason: AssertionRefusal
  /** For the audit record. Never shown to the person — see GE-042-007. */
  detail: string
}

export interface AssertionAccepted {
  valid: true
  nameId: string
  assertionId: string
  /** When this assertion stops being replay-relevant, so a cache can expire it. */
  repeatableAfter: string
}

export type AssertionVerdict = AssertionAccepted | AssertionRejected

/**
 * Signature algorithms that must be refused.
 *
 * SHA-1 is collision-broken and RSA-MD5 was broken long before that. A denylist
 * rather than an allowlist would let anything unrecognised through, so this is
 * used only to explain *why* — the allowlist below is what decides.
 */
const ACCEPTABLE_SIGNATURE_ALGORITHMS: ReadonlySet<string> = new Set([
  "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
  "http://www.w3.org/2001/04/xmldsig-more#rsa-sha384",
  "http://www.w3.org/2001/04/xmldsig-more#rsa-sha512",
  "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256",
  "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha384",
  "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512",
  "http://www.w3.org/2007/05/xmldsig-more#sha256-rsa-MGF1",
])

const ACCEPTABLE_DIGEST_ALGORITHMS: ReadonlySet<string> = new Set([
  "http://www.w3.org/2001/04/xmlenc#sha256",
  "http://www.w3.org/2001/04/xmldsig-more#sha384",
  "http://www.w3.org/2001/04/xmlenc#sha512",
])

const BEARER = "urn:oasis:names:tc:SAML:2.0:cm:bearer"

function reject(reason: AssertionRefusal, detail: string): AssertionRejected {
  return { valid: false, reason, detail }
}

/**
 * Whether a NameID is safe to key a person on.
 *
 * The Ruby SAML / GitHub Enterprise class: XML comments are stripped by some
 * parsers and treated as text-node boundaries by others, so
 * `<NameID>admin@corp.test<!---->.evil.test</NameID>` reads as one identity to
 * the signature check and another to the application. Any NameID carrying
 * comment syntax, control characters, or leading/trailing whitespace is refused
 * rather than normalised — normalising picks one of the two readings, and the
 * whole problem is that there are two.
 */
function nameIdIsAmbiguous(nameId: string): boolean {
  if (nameId !== nameId.trim()) return true
  if (nameId.includes("<!--") || nameId.includes("-->")) return true
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(nameId)) return true
  return false
}

/**
 * Decide one assertion.
 *
 * `seenAssertionIds` is supplied by the caller because replay detection needs
 * storage that outlives a function call. Passing it in keeps this decidable and
 * makes the caller's omission visible: an empty set is a caller that is not
 * detecting replay, which is a deployment decision rather than a default.
 */
export function validateSamlAssertion(
  assertion: SamlAssertionInput,
  expected: ExpectedAssertion,
  context: { at: Date; seenAssertionIds: ReadonlySet<string> },
): AssertionVerdict {
  const { at, seenAssertionIds } = context
  const skew = expected.clockSkewSeconds * 1000
  const now = at.getTime()

  // ── The signature, first, and about the right element ──────────────────────
  //
  // Everything below reads fields. If they are not covered by the signature,
  // reading them is reading attacker input, so nothing else may run first.

  if (!assertion.signature.signedElements.includes("Assertion")) {
    return reject(
      "NOT_SIGNED",
      `The signature covered [${assertion.signature.signedElements.join(", ") || "nothing"}] and not the ` +
        `Assertion. A signed Response does not protect the assertion inside it — that gap is XML ` +
        `signature wrapping, and it is exploited by leaving the signed element intact and adding ` +
        `an unsigned one the application reads instead.`,
    )
  }

  if (!assertion.signature.algorithm || !ACCEPTABLE_SIGNATURE_ALGORITHMS.has(assertion.signature.algorithm)) {
    return reject(
      "WEAK_SIGNATURE_ALGORITHM",
      `Signature algorithm ${assertion.signature.algorithm ?? "(absent)"} is not accepted. SHA-1 is ` +
        `collision-broken; an absent algorithm is refused rather than assumed.`,
    )
  }

  if (!assertion.signature.digestAlgorithm || !ACCEPTABLE_DIGEST_ALGORITHMS.has(assertion.signature.digestAlgorithm)) {
    return reject(
      "WEAK_DIGEST_ALGORITHM",
      `Digest algorithm ${assertion.signature.digestAlgorithm ?? "(absent)"} is not accepted. A strong ` +
        `signature over a SHA-1 digest inherits the digest's collisions.`,
    )
  }

  if (!assertion.signature.keyId) {
    return reject(
      "UNKNOWN_KEY",
      "The verifying key was not identified, so it cannot be tied to a live signing certificate on this connection.",
    )
  }

  // ── Who sent it, and who it is for ─────────────────────────────────────────

  if (assertion.issuer !== expected.issuer) {
    return reject(
      "WRONG_ISSUER",
      `Issuer ${assertion.issuer} is not this connection's provider (${expected.issuer}). A valid ` +
        `assertion from a different tenant's provider is still not valid here.`,
    )
  }

  if (!assertion.audiences.includes(expected.serviceProviderEntityId)) {
    return reject(
      "WRONG_AUDIENCE",
      `Audience [${assertion.audiences.join(", ") || "(none)"}] does not include ` +
        `${expected.serviceProviderEntityId}. Without this check an assertion minted for another ` +
        `service is accepted here — the provider signed it, it just was not for us.`,
    )
  }

  if (assertion.recipient !== null && assertion.recipient !== expected.assertionConsumerServiceUrl) {
    return reject(
      "WRONG_RECIPIENT",
      `Recipient ${assertion.recipient} is not our assertion consumer service ` +
        `(${expected.assertionConsumerServiceUrl}).`,
    )
  }

  // ── When ───────────────────────────────────────────────────────────────────

  if (assertion.notBefore !== null) {
    const from = Date.parse(assertion.notBefore)
    if (Number.isNaN(from)) return reject("NOT_YET_VALID", "Conditions/@NotBefore is not a time.")
    if (now + skew < from) {
      return reject("NOT_YET_VALID", `This assertion is not valid until ${assertion.notBefore}.`)
    }
  }

  if (assertion.notOnOrAfter !== null) {
    const until = Date.parse(assertion.notOnOrAfter)
    if (Number.isNaN(until)) return reject("EXPIRED", "Conditions/@NotOnOrAfter is not a time.")
    // On-or-after, so an assertion is dead at exactly its limit.
    if (now - skew >= until) {
      return reject("EXPIRED", `This assertion expired at ${assertion.notOnOrAfter}.`)
    }
  }

  if (assertion.subjectNotOnOrAfter !== null) {
    const until = Date.parse(assertion.subjectNotOnOrAfter)
    if (Number.isNaN(until)) {
      return reject("SUBJECT_EXPIRED", "SubjectConfirmationData/@NotOnOrAfter is not a time.")
    }
    if (now - skew >= until) {
      // Separate from EXPIRED on purpose: the subject window is usually minutes
      // where Conditions is usually hours, and an operator diagnosing a failure
      // needs to know which clock to look at.
      return reject("SUBJECT_EXPIRED", `The subject confirmation expired at ${assertion.subjectNotOnOrAfter}.`)
    }
  }

  // ── That we asked for it ───────────────────────────────────────────────────

  if (expected.expectedInResponseTo !== null) {
    if (assertion.inResponseTo !== expected.expectedInResponseTo) {
      return reject(
        "WRONG_IN_RESPONSE_TO",
        `InResponseTo ${assertion.inResponseTo ?? "(absent)"} does not match the request we sent ` +
          `(${expected.expectedInResponseTo}). An assertion captured from another sign-in is refused here.`,
      )
    }
  } else if (assertion.inResponseTo !== null) {
    // We did not start a flow, yet this answers one. Either a stale assertion
    // or one lifted from somebody else's session.
    return reject(
      "UNSOLICITED",
      `This assertion answers request ${assertion.inResponseTo}, and we did not send it.`,
    )
  } else if (!expected.allowIdpInitiated) {
    return reject(
      "UNSOLICITED",
      "IdP-initiated sign-in is not enabled for this connection. An assertion nobody asked for cannot " +
        "be tied to a browser that started at our door, which is what makes login CSRF possible.",
    )
  }

  if (assertion.confirmationMethod !== BEARER) {
    return reject(
      "WRONG_CONFIRMATION_METHOD",
      `SubjectConfirmation method ${assertion.confirmationMethod ?? "(absent)"} is not ${BEARER}. ` +
        `Holder-of-key and sender-vouches carry obligations this flow does not discharge.`,
    )
  }

  // ── Once ───────────────────────────────────────────────────────────────────

  if (seenAssertionIds.has(assertion.assertionId)) {
    return reject(
      "REPLAYED",
      `Assertion ${assertion.assertionId} has been accepted before. A bearer assertion is a credential ` +
        `until it expires, and its window is long enough to reuse.`,
    )
  }

  // ── Who ────────────────────────────────────────────────────────────────────

  if (assertion.nameId === null || assertion.nameId === "") {
    return reject("NO_NAME_ID", "The assertion identifies nobody.")
  }

  if (nameIdIsAmbiguous(assertion.nameId)) {
    return reject(
      "AMBIGUOUS_NAME_ID",
      "The NameID contains comment syntax, control characters or surrounding whitespace, so two parsers " +
        "could read it as two different people. Refused rather than normalised: normalising picks one " +
        "of the readings, and the problem is that there are two.",
    )
  }

  return {
    valid: true,
    nameId: assertion.nameId,
    assertionId: assertion.assertionId,
    // A replay cache may forget an assertion once no clock would accept it
    // again. Taking the later of the two windows, plus skew, keeps a short
    // subject window from evicting an id the Conditions window still honours.
    repeatableAfter: new Date(
      Math.max(
        assertion.notOnOrAfter ? Date.parse(assertion.notOnOrAfter) : 0,
        assertion.subjectNotOnOrAfter ? Date.parse(assertion.subjectNotOnOrAfter) : 0,
        now,
      ) + skew,
    ).toISOString(),
  }
}
