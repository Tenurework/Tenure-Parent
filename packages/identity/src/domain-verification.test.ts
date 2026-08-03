import {
  CHALLENGE_PREFIX,
  CLAIM_EXPIRY_DAYS,
  REVERIFY_AFTER_DAYS,
  checkDomainChallenge,
  claimDomain,
  claimIsStale,
  domainIsAuthoritative,
  expiriesNeedingAttention,
  expiryReport,
  tenantForDomain,
  type ClaimRefusal,
  type DomainClaim,
  type ExpiringThing,
} from "./index"

/**
 * GE-043-004 — proving control of a name, and noticing before things expire.
 *
 * A verified domain decides which tenant's branding and login methods a visitor
 * is offered. It never decides who anybody is — Bible §9.1 forbids granting
 * membership from an email domain — so the question is only whether the
 * organization controls the name.
 */

const NOW = new Date("2026-08-03T12:00:00Z")
const daysFrom = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()

const TOKEN = "tenure-verify-8f3a91c40b2e"

const claim = (over: Partial<DomainClaim> = {}): DomainClaim => ({
  domain: "rochester.example.edu",
  tenantId: "rochester",
  state: "PENDING",
  challengeToken: TOKEN,
  claimedAt: daysFrom(-1),
  verifiedAt: null,
  ...over,
})

const refusedBecause = (outcome: ReturnType<typeof claimDomain>, reason: ClaimRefusal) => {
  expect(outcome.ok).toBe(false)
  if (outcome.ok) throw new Error("expected a refusal")
  expect(outcome.reason).toBe(reason)
  expect(outcome.detail.length).toBeGreaterThan(20)
}

const makeClaim = (domain: string, existing: readonly DomainClaim[] = []) =>
  claimDomain({ domain, tenantId: "rochester", challengeToken: TOKEN, at: NOW }, existing)

describe("claiming a domain", () => {
  it("issues the exact record to publish", () => {
    // An instructions screen that says "add a TXT record" and not which one is
    // a support ticket.
    const outcome = makeClaim("rochester.example.edu")
    if (!outcome.ok) throw new Error(outcome.detail)

    expect(outcome.record).toEqual({
      name: `${CHALLENGE_PREFIX}.rochester.example.edu`,
      type: "TXT",
      value: TOKEN,
    })
    expect(outcome.claim.state).toBe("PENDING")
    expect(outcome.claim.verifiedAt).toBeNull()
  })

  it("normalises case and surrounding space", () => {
    const outcome = makeClaim("  Rochester.Example.EDU  ")
    if (!outcome.ok) throw new Error(outcome.detail)
    expect(outcome.claim.domain).toBe("rochester.example.edu")
  })

  it("refuses something that is not a domain", () => {
    for (const bad of ["", "not a domain", "http://rochester.edu", "rochester.edu/path", "-bad.edu", ".edu"]) {
      refusedBecause(makeClaim(bad), "NOT_A_DOMAIN")
    }
  })

  it("refuses a single label", () => {
    // A tenant cannot own "intranet", and a claim on one would answer discovery
    // for anybody who typed it.
    refusedBecause(makeClaim("intranet"), "NOT_A_DOMAIN")
  })

  it("refuses a public suffix", () => {
    // Nobody controls it, so nobody can prove they do — and a tenant holding it
    // would answer discovery for every institution beneath it.
    refusedBecause(makeClaim("edu"), "NOT_A_DOMAIN")
    refusedBecause(makeClaim("ac.uk"), "PUBLIC_SUFFIX")
    refusedBecause(makeClaim("co.uk"), "PUBLIC_SUFFIX")
  })

  it("allows a registrable name under a public suffix", () => {
    // Otherwise the rule above would block every real customer.
    expect(makeClaim("rochester.ac.uk").ok).toBe(true)
  })
})

describe("one tenant per domain", () => {
  const heldByOther = claim({ tenantId: "ithaca", state: "VERIFIED", verifiedAt: daysFrom(-1) })

  it("refuses a domain another tenant has verified", () => {
    // Discovery has to resolve one tenant per domain, and two proofs is not
    // something to resolve at read time by taking whichever row came first.
    refusedBecause(makeClaim("rochester.example.edu", [heldByOther]), "HELD_BY_ANOTHER_TENANT")
  })

  it("refuses a domain another tenant is already proving", () => {
    // Without this, two tenants race to publish a TXT record and whoever polls
    // first takes the domain.
    refusedBecause(
      makeClaim("rochester.example.edu", [claim({ tenantId: "ithaca", state: "PENDING" })]),
      "CLAIM_PENDING_ELSEWHERE",
    )
  })

  it("lets the same tenant re-claim its own domain", () => {
    // Re-issuing a challenge is what somebody does when they lost the record.
    expect(makeClaim("rochester.example.edu", [claim({ tenantId: "rochester" })]).ok).toBe(true)
  })

  it("ignores a released claim from another tenant", () => {
    expect(makeClaim("rochester.example.edu", [claim({ tenantId: "ithaca", state: "RELEASED" })]).ok).toBe(true)
  })

  it("ignores a lapsed claim from another tenant", () => {
    // A lapsed proof is not a proof, so it must not block a genuine claimant.
    expect(makeClaim("rochester.example.edu", [claim({ tenantId: "ithaca", state: "LAPSED" })]).ok).toBe(true)
  })

  it("expires an unproved claim so it cannot squat", () => {
    expect(claimIsStale(claim({ claimedAt: daysFrom(-(CLAIM_EXPIRY_DAYS + 1)) }), NOW)).toBe(true)
    expect(claimIsStale(claim({ claimedAt: daysFrom(-1) }), NOW)).toBe(false)
  })

  it("does not expire a claim that was proved", () => {
    expect(claimIsStale(claim({ state: "VERIFIED", claimedAt: daysFrom(-999) }), NOW)).toBe(false)
  })
})

describe("checking the challenge against DNS", () => {
  it("verifies when the record carries the token", () => {
    const outcome = checkDomainChallenge(claim(), [TOKEN], NOW)
    expect(outcome.state).toBe("VERIFIED")
    expect(outcome.claim.verifiedAt).toBe(NOW.toISOString())
  })

  it("tolerates surrounding whitespace from a resolver", () => {
    expect(checkDomainChallenge(claim(), [`  ${TOKEN}  `], NOW).state).toBe("VERIFIED")
  })

  it("finds the token among other TXT records", () => {
    // Domains carry SPF, DMARC and half a dozen vendor verifications.
    expect(checkDomainChallenge(claim(), ["v=spf1 include:_spf.google.com ~all", TOKEN], NOW).state).toBe(
      "VERIFIED",
    )
  })

  it("does not accept a record that merely contains the token", () => {
    // A token embedded in somebody else's TXT record is not proof of control.
    expect(checkDomainChallenge(claim(), [`v=spf1 ${TOKEN} ~all`], NOW).state).toBe("PENDING")
  })

  it("stays pending when nothing is published yet", () => {
    const outcome = checkDomainChallenge(claim(), [], NOW)
    expect(outcome.state).toBe("PENDING")
    if (outcome.state !== "PENDING") throw new Error("unreachable")
    expect(outcome.detail).toMatch(/propagate/)
  })

  it("lapses a verified domain whose record has gone", () => {
    // A domain that stops proving itself may have changed hands, and a verified
    // claim on a name somebody else now owns hands them a tenant's login page.
    const outcome = checkDomainChallenge(claim({ state: "VERIFIED", verifiedAt: daysFrom(-1) }), [], NOW)
    expect(outcome.state).toBe("LAPSED")
    expect(outcome.claim.state).toBe("LAPSED")
  })

  it("re-verifies a lapsed domain when the record comes back", () => {
    expect(checkDomainChallenge(claim({ state: "LAPSED" }), [TOKEN], NOW).state).toBe("VERIFIED")
  })
})

describe("a proof goes stale on the clock, not on a sweeper", () => {
  it("counts a fresh proof", () => {
    expect(domainIsAuthoritative(claim({ state: "VERIFIED", verifiedAt: daysFrom(-1) }), NOW)).toBe(true)
  })

  it("stops counting a proof older than the re-verification window", () => {
    expect(
      domainIsAuthoritative(claim({ state: "VERIFIED", verifiedAt: daysFrom(-(REVERIFY_AFTER_DAYS + 1)) }), NOW),
    ).toBe(false)
  })

  it("does not count a pending or lapsed claim", () => {
    expect(domainIsAuthoritative(claim({ state: "PENDING" }), NOW)).toBe(false)
    expect(domainIsAuthoritative(claim({ state: "LAPSED", verifiedAt: daysFrom(-1) }), NOW)).toBe(false)
  })

  it("does not count a verified claim with no verification time", () => {
    expect(domainIsAuthoritative(claim({ state: "VERIFIED", verifiedAt: null }), NOW)).toBe(false)
  })
})

describe("which tenant a domain resolves to", () => {
  const verified = claim({ state: "VERIFIED", verifiedAt: daysFrom(-1) })

  it("resolves an exactly matching verified domain", () => {
    expect(tenantForDomain("rochester.example.edu", [verified], NOW)).toBe("rochester")
  })

  it("does not resolve a subdomain of a verified domain", () => {
    // Subdomain delegation is common in universities — a department, a lab, a
    // society may control one. Treating a parent's proof as covering all of
    // them hands a tenant discovery for names it does not control.
    expect(tenantForDomain("lab.rochester.example.edu", [verified], NOW)).toBeNull()
  })

  it("does not resolve a parent of a verified domain", () => {
    expect(tenantForDomain("example.edu", [verified], NOW)).toBeNull()
  })

  it("does not resolve a domain whose proof has gone stale", () => {
    expect(
      tenantForDomain(
        "rochester.example.edu",
        [claim({ state: "VERIFIED", verifiedAt: daysFrom(-(REVERIFY_AFTER_DAYS + 1)) })],
        NOW,
      ),
    ).toBeNull()
  })

  it("does not resolve a lookalike", () => {
    expect(tenantForDomain("rochester.example.edu.evil.test", [verified], NOW)).toBeNull()
    expect(tenantForDomain("xrochester.example.edu", [verified], NOW)).toBeNull()
  })
})

describe("expiry monitoring", () => {
  const thing = (over: Partial<ExpiringThing> = {}): ExpiringThing => ({
    kind: "CERTIFICATE",
    label: "Rochester SAML signing certificate",
    expiresAt: daysFrom(90),
    ...over,
  })

  it("is quiet when there is nothing to do", () => {
    expect(expiryReport(thing(), NOW).urgency).toBe("OK")
  })

  it("warns a certificate weeks out and a JWKS cache hours out", () => {
    // Not one threshold. A certificate needs weeks — somebody has to raise a
    // ticket with an identity team that does not work weekends. A JWKS cache
    // needs hours, because refreshing it is automatic and a stale one means the
    // automation stopped.
    expect(expiryReport(thing({ expiresAt: daysFrom(20) }), NOW).urgency).toBe("WARN")
    expect(expiryReport(thing({ kind: "JWKS_CACHE", expiresAt: daysFrom(20) }), NOW).urgency).toBe("OK")
    expect(expiryReport(thing({ kind: "JWKS_CACHE", expiresAt: daysFrom(0.5) }), NOW).urgency).toBe("WARN")
  })

  it("escalates as the deadline closes", () => {
    expect(expiryReport(thing({ expiresAt: daysFrom(3) }), NOW).urgency).toBe("URGENT")
  })

  it("reports an expired thing as expired, not urgent", () => {
    const report = expiryReport(thing({ expiresAt: daysFrom(-2) }), NOW)
    expect(report.urgency).toBe("EXPIRED")
    expect(report.daysRemaining).toBeLessThan(0)
  })

  it("reports something with no expiry rather than treating it as healthy", () => {
    // A credential with no expiry is a decision somebody made, and it should be
    // visible rather than looking like a healthy row.
    const report = expiryReport(thing({ expiresAt: null }), NOW)
    expect(report.urgency).toBe("UNKNOWN")
    expect(report.detail).toMatch(/no expiry/)
  })

  it("reports an unparseable expiry rather than ignoring it", () => {
    expect(expiryReport(thing({ expiresAt: "soon" }), NOW).urgency).toBe("UNKNOWN")
  })

  it("gives every non-OK report a sentence naming the thing", () => {
    for (const t of [
      thing({ expiresAt: daysFrom(-1) }),
      thing({ expiresAt: daysFrom(3) }),
      thing({ expiresAt: daysFrom(20) }),
      thing({ expiresAt: null }),
    ]) {
      const report = expiryReport(t, NOW)
      expect(report.detail).toContain(t.label)
      expect(report.detail.length).toBeGreaterThan(20)
    }
  })
})

describe("the list an operator actually reads", () => {
  const at = NOW
  const things: ExpiringThing[] = [
    { kind: "CERTIFICATE", label: "healthy cert", expiresAt: daysFrom(200) },
    { kind: "CLIENT_SECRET", label: "expired secret", expiresAt: daysFrom(-5) },
    { kind: "CERTIFICATE", label: "urgent cert", expiresAt: daysFrom(3) },
    { kind: "DOMAIN_PROOF", label: "warn proof", expiresAt: daysFrom(5) },
    { kind: "CLIENT_SECRET", label: "no expiry", expiresAt: null },
    { kind: "CERTIFICATE", label: "sooner expired cert", expiresAt: daysFrom(-40) },
  ]

  it("drops what needs no attention", () => {
    // Burying four urgent rows in two hundred healthy ones is how the four get
    // missed.
    const list = expiriesNeedingAttention(things, at)
    expect(list.map((r) => r.label)).not.toContain("healthy cert")
    expect(list).toHaveLength(5)
  })

  it("puts the worst first", () => {
    const list = expiriesNeedingAttention(things, at)
    expect(list.map((r) => r.urgency)).toEqual(["EXPIRED", "EXPIRED", "URGENT", "WARN", "UNKNOWN"])
  })

  it("orders within an urgency by how soon", () => {
    const list = expiriesNeedingAttention(things, at)
    expect(list.slice(0, 2).map((r) => r.label)).toEqual(["sooner expired cert", "expired secret"])
  })

  it("puts things with no deadline last, not first", () => {
    // They have no position on a timeline, and floating them up would push real
    // deadlines down.
    const list = expiriesNeedingAttention(things, at)
    expect(list[list.length - 1].label).toBe("no expiry")
  })

  it("returns nothing when everything is healthy", () => {
    expect(expiriesNeedingAttention([things[0]], at)).toEqual([])
  })
})
