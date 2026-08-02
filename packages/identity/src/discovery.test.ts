import {
  DISCOVERY_MAX_PER_WINDOW,
  DISCOVERY_WINDOW_SECONDS,
  LOGIN_ENTRY_POINTS,
  PLATFORM_BRANDING,
  checkDiscoveryRate,
  offerLeaks,
  resolveLogin,
  tenantForHost,
  type DiscoverableTenant,
  type DiscoveryContext,
  type DiscoveryInput,
} from "./index"

/**
 * GE-042-001 — where sign-in starts, and what it refuses to tell you.
 *
 * Tenant existence is not secret — tenants are served at
 * `platform.tenurework.com/<slug>`, so anybody can learn which slugs resolve.
 * **Person existence is**, absolutely, and it is the fact an attacker actually
 * wants. Most of these tests are about the resolver never having an opinion
 * about it, which is easy to hold precisely because it never learns.
 */

const NOW = new Date("2026-08-02T12:00:00Z")

let minted = 0
const mintTransaction = () => `txn-${++minted}`

const rochester: DiscoverableTenant = {
  tenantId: "tnt-rochester",
  slug: "rochester",
  branding: {
    displayName: "Simon Business School",
    wordmark: "Ainslie OSE",
    primaryColor: "#003b71",
    primaryTextColor: "#ffffff",
  },
  connectionIds: ["conn-saml", "conn-local"],
  localSignIn: true,
}

const simon: DiscoverableTenant = {
  ...rochester,
  tenantId: "tnt-simon",
  slug: "simon",
  branding: { ...rochester.branding, displayName: "Simon" },
  connectionIds: ["conn-simon-oidc"],
  localSignIn: false,
}

const context = (over: Partial<DiscoveryContext> = {}): DiscoveryContext => ({
  tenants: [rochester, simon],
  verifiedDomains: [
    { domain: "rochester.example", tenantId: "tnt-rochester", state: "VERIFIED" },
    { domain: "claimed.example", tenantId: "tnt-simon", state: "PENDING" },
  ],
  connectionsByTenant: { "tnt-rochester": ["conn-saml", "conn-local"], "tnt-simon": ["conn-simon-oidc"] },
  mintTransaction,
  ...over,
})

beforeEach(() => {
  minted = 0
})

describe("five ways in, strongest evidence first", () => {
  it("prefers a prior session over everything else", () => {
    // A person with a live session at one tenant must not be moved elsewhere
    // because they also typed an address. That is the confusing case.
    const offer = resolveLogin(
      { sessionTenantId: "tnt-rochester", slug: "simon", email: "x@rochester.example" },
      context(),
    )
    expect(offer.via).toBe("session")
    expect(offer.branding.displayName).toBe("Simon Business School")
  })

  it("prefers a verified invitation over a slug", () => {
    const offer = resolveLogin({ invitationTenantId: "tnt-simon", slug: "rochester" }, context())
    expect(offer.via).toBe("invitation")
    expect(offer.connectionIds).toEqual(["conn-simon-oidc"])
  })

  it("resolves a verified domain", () => {
    const offer = resolveLogin({ host: "rochester.example" }, context())
    expect(offer.via).toBe("domain")
    expect(offer.branding.wordmark).toBe("Ainslie OSE")
  })

  it("resolves a subdomain whose first label is a slug", () => {
    expect(resolveLogin({ host: "simon.tenurework.com" }, context()).via).toBe("domain")
  })

  it("resolves a slug from the path", () => {
    const offer = resolveLogin({ slug: "Rochester" }, context())
    expect(offer.via).toBe("slug")
    expect(offer.branding.displayName).toBe("Simon Business School")
  })

  it("declares every entry point it implements", () => {
    expect(LOGIN_ENTRY_POINTS).toHaveLength(5)
  })
})

describe("an unknown identifier gets an answer, not an error", () => {
  it("returns platform branding for a slug nobody has", () => {
    // Returning "no such tenant" for one and branding for another is a
    // difference somebody can measure, and it makes discovery a scanner.
    const offer = resolveLogin({ slug: "does-not-exist" }, context())
    expect(offer.via).toBe("unresolved")
    expect(offer.branding).toEqual(PLATFORM_BRANDING)
    expect(offer.connectionIds).toEqual([])
  })

  it("returns the same shape whether or not anything resolved", () => {
    const known = resolveLogin({ slug: "rochester" }, context())
    const unknown = resolveLogin({ slug: "nope" }, context())
    expect(Object.keys(known).sort()).toEqual(Object.keys(unknown).sort())
  })

  it("always mints a transaction, including for an unknown identifier", () => {
    // A response with no transaction is a response that says "nothing here".
    expect(resolveLogin({ slug: "nope" }, context()).transaction).toMatch(/^txn-/)
  })

  it("does not treat a domain suffix as a match", () => {
    // `notrochester.example` ends with `rochester.example`. A suffix match
    // would hand a university's branding to anybody who could register it.
    expect(resolveLogin({ host: "notrochester.example" }, context()).via).toBe("unresolved")
  })

  it("ignores a domain that is only claimed, not verified", () => {
    expect(resolveLogin({ host: "claimed.example" }, context()).via).toBe("unresolved")
  })

  it("strips a port before matching a host", () => {
    expect(tenantForHost("rochester.example:3000", context())?.tenantId).toBe("tnt-rochester")
  })
})

describe("an email is a hint about connections, never about a tenant", () => {
  it("offers that tenant's connections without adopting its branding", () => {
    // Showing a university's crest because somebody typed an address ending in
    // its domain confirms the domain is claimed here — to anybody who guesses.
    const offer = resolveLogin({ email: "a.person@rochester.example" }, context())
    expect(offer.via).toBe("email-hint")
    expect(offer.connectionIds).toEqual(["conn-local", "conn-saml"])
    expect(offer.branding).toEqual(PLATFORM_BRANDING)
  })

  it("does not offer local sign-in from a hint", () => {
    // Local sign-in is invitation-only (GE-041-004); offering it on the
    // strength of a typed address invites people to try.
    expect(resolveLogin({ email: "a.person@rochester.example" }, context()).offerLocalSignIn).toBe(false)
  })

  it("gives an unknown domain the unresolved answer", () => {
    expect(resolveLogin({ email: "somebody@elsewhere.example" }, context()).via).toBe("unresolved")
  })

  it("gives a merely-claimed domain the unresolved answer", () => {
    // Otherwise anybody could enumerate tenants by claiming their domains.
    expect(resolveLogin({ email: "somebody@claimed.example" }, context()).via).toBe("unresolved")
  })

  it("never says whether the address has an account", () => {
    // The resolver takes no person and queries for none, so the answer for an
    // address with an account and one without is identical by construction.
    const withAccount = resolveLogin({ email: "a.person@rochester.example" }, context())
    const without = resolveLogin({ email: "nobody.at.all@rochester.example" }, context())
    expect({ ...withAccount, transaction: "" }).toEqual({ ...without, transaction: "" })
  })
})

describe("the offer carries nothing that identifies anybody", () => {
  const inputs: DiscoveryInput[] = [
    { slug: "rochester" },
    { host: "rochester.example" },
    { email: "a.person@rochester.example" },
    { sessionTenantId: "tnt-rochester" },
    { invitationTenantId: "tnt-simon" },
  ]

  it("never echoes its input back", () => {
    // A decodable handle is one an attacker can construct, and a constructed
    // handle turns the callback into a second discovery surface with none of
    // these rules.
    for (const input of inputs) {
      const offer = resolveLogin(input, context())
      expect(offerLeaks(offer, input)).toEqual([])
    }
  })

  it("catches an offer that does echo its input", () => {
    // The leak detector, asserted rather than trusted — its failure mode is
    // silence, and a detector that matches nothing reports every offer clean.
    const leaky = { ...resolveLogin({ slug: "rochester" }, context()), transaction: "txn-rochester" }
    expect(offerLeaks(leaky, { slug: "rochester" })).not.toEqual([])
  })

  it("catches a transaction containing an address", () => {
    const leaky = { ...resolveLogin({}, context()), transaction: "txn-a.person@rochester.example" }
    expect(offerLeaks(leaky, {})).toContain("the transaction contains an address")
  })
})

describe("discovery is rate limited on the caller, not on what they asked", () => {
  const state = (over = {}) => ({
    callerKey: "hashed-caller",
    windowStartedAt: NOW.toISOString(),
    count: 0,
    ...over,
  })

  it("allows traffic inside the window", () => {
    const decision = checkDiscoveryRate(state({ count: 3 }), NOW)
    expect(decision.allowed).toBe(true)
    expect(decision.next.count).toBe(4)
  })

  it("refuses past the limit and says how long to wait", () => {
    const at = new Date(NOW.getTime() + 20_000)
    const decision = checkDiscoveryRate(state({ count: DISCOVERY_MAX_PER_WINDOW }), at)
    expect(decision.allowed).toBe(false)
    expect(decision.retryAfterSeconds).toBe(DISCOVERY_WINDOW_SECONDS - 20)
  })

  it("opens a fresh window once the old one has passed", () => {
    const later = new Date(NOW.getTime() + (DISCOVERY_WINDOW_SECONDS + 1) * 1000)
    const decision = checkDiscoveryRate(state({ count: 999 }), later)
    expect(decision.allowed).toBe(true)
    expect(decision.next.count).toBe(1)
  })

  it("counts a refused request too", () => {
    // Hammering extends nothing, but the caller also cannot tell how close
    // they were by watching the response change.
    const decision = checkDiscoveryRate(state({ count: DISCOVERY_MAX_PER_WINDOW + 5 }), NOW)
    expect(decision.allowed).toBe(false)
    expect(decision.next.count).toBe(DISCOVERY_MAX_PER_WINDOW + 6)
  })

  it("treats a malformed window as expired rather than blocking forever", () => {
    const decision = checkDiscoveryRate(state({ windowStartedAt: "not a time", count: 999 }), NOW)
    expect(decision.allowed).toBe(true)
  })

  it("is keyed on the caller and carries nothing about the query", () => {
    // A limiter keyed by email would itself be an oracle: different behaviour
    // for an address asked about before is exactly the signal being denied
    // everywhere else.
    expect(Object.keys(state()).sort()).toEqual(["callerKey", "count", "windowStartedAt"])
  })
})
