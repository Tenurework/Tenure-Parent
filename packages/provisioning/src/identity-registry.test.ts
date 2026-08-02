import {
  EXPIRY_WARNING_DAYS,
  connectionHealth,
  connectionsNeedingAttention,
  discoverTenantByDomain,
  domainMatches,
  findDomainConflicts,
  loginMethods,
  normalizeDomain,
  validateConnection,
  validateDomain,
  type IdentityConnection,
  type VerifiedDomain,
} from "./identity-registry"

/**
 * GE-030-003 — the identity-connection registry.
 *
 * Three things here can be wrong in a way that is invisible from the outside
 * and expensive: a domain match that is too loose, a projection that leaks the
 * estate's configuration onto a public page, and a credential expiry that is
 * noticed by users rather than by an operator. Most of these are about those.
 */
const NOW = new Date("2026-08-02T00:00:00.000Z")
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString()

const SAML: IdentityConnection = {
  connectionId: "conn-rochester-saml",
  tenantId: "tnt_rochester",
  kind: "SAML",
  status: "ACTIVE",
  displayName: "University of Rochester SSO",
  issuer: "https://idp.rochester.edu/saml",
  poolId: "us-east-1_AbCdEfGh",
  appClientId: "1a2b3c4d5e6f7g8h9i0j",
  credentials: [
    {
      purpose: "saml-signing-certificate",
      ref: "arn:aws:secretsmanager:us-east-1:047385673922:secret:tenure/idp/rochester-AbC123",
      expiresAt: at(400),
      lastRotatedAt: at(-30),
    },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
}

const conn = (over: Partial<IdentityConnection>): IdentityConnection => ({ ...SAML, ...over })

const DOMAIN: VerifiedDomain = {
  domain: "rochester.edu",
  tenantId: "tnt_rochester",
  state: "VERIFIED",
  method: "dns-txt",
  challenge: "tenure-verify=abc123",
  verifiedAt: "2026-01-02T00:00:00.000Z",
}

const dom = (over: Partial<VerifiedDomain>): VerifiedDomain => ({ ...DOMAIN, ...over })

describe("domain matching is on label boundaries, not on string suffixes", () => {
  it("matches the domain itself and its subdomains", () => {
    expect(domainMatches("rochester.edu", "rochester.edu")).toBe(true)
    expect(domainMatches("simon.rochester.edu", "rochester.edu")).toBe(true)
    expect(domainMatches("a.b.rochester.edu", "rochester.edu")).toBe(true)
  })

  it("does NOT match a domain that merely ends with the same characters", () => {
    // The attack this exists to stop. A naive `endsWith` makes every one of
    // these match, and whoever registers the name is handed a route to
    // Rochester's own sign-in page — branded, and looking exactly right.
    expect(domainMatches("evil-rochester.edu", "rochester.edu")).toBe(false)
    expect(domainMatches("notrochester.edu", "rochester.edu")).toBe(false)
    expect(domainMatches("xrochester.edu", "rochester.edu")).toBe(false)
  })

  it("does not match a parent of the verified domain", () => {
    // Verifying `simon.rochester.edu` proves nothing about `rochester.edu`.
    expect(domainMatches("rochester.edu", "simon.rochester.edu")).toBe(false)
    expect(domainMatches("edu", "rochester.edu")).toBe(false)
  })

  it("normalises case and a trailing dot", () => {
    // `Rochester.EDU` and `rochester.edu.` are the same domain; a registry that
    // treats them as three lets one name be claimed three times.
    expect(normalizeDomain("Rochester.EDU.")).toBe("rochester.edu")
    expect(domainMatches("SIMON.Rochester.EDU.", "rochester.edu")).toBe(true)
    expect(domainMatches("rochester.edu", "ROCHESTER.EDU")).toBe(true)
  })

  it("matches nothing on empty input", () => {
    expect(domainMatches("", "rochester.edu")).toBe(false)
    expect(domainMatches("rochester.edu", "")).toBe(false)
  })
})

describe("discovery answers which tenant, and nothing else", () => {
  it("resolves a verified domain to a tenant id", () => {
    // A tenant id. Not a user, not a membership, not a list of anything.
    expect(discoverTenantByDomain("simon.rochester.edu", [DOMAIN])).toBe("tnt_rochester")
    expect(typeof discoverTenantByDomain("rochester.edu", [DOMAIN])).toBe("string")
  })

  it("does not resolve a domain that is only claimed", () => {
    // PENDING is a claim. Resolving it would let anyone who can type a domain
    // into the console point a sign-in page at a tenant they do not own.
    expect(discoverTenantByDomain("rochester.edu", [dom({ state: "PENDING" })])).toBeNull()
  })

  it("stops resolving the moment a domain is revoked", () => {
    expect(discoverTenantByDomain("rochester.edu", [dom({ state: "REVOKED" })])).toBeNull()
  })

  it("refuses an ambiguous domain rather than picking one", () => {
    // Two tenants verified for one domain is a state the registry must not
    // have. Silently picking the first would let whichever was written first
    // hijack the other's sign-in — an attack nobody has to attack anything to
    // perform.
    const contested = [DOMAIN, dom({ tenantId: "tnt_impostor" })]
    expect(discoverTenantByDomain("rochester.edu", contested)).toBeNull()
  })

  it("finds the conflict, which no single record shows", () => {
    // Each record is individually valid. The problem only exists in the set.
    const contested = [DOMAIN, dom({ tenantId: "tnt_impostor" })]
    expect(validateDomain(contested[0])).toEqual([])
    expect(validateDomain(contested[1])).toEqual([])
    expect(findDomainConflicts(contested)).toEqual([
      { domain: "rochester.edu", tenantIds: ["tnt_impostor", "tnt_rochester"] },
    ])
  })

  it("does not count a pending or revoked claim as a conflict", () => {
    // Otherwise every rejected claim permanently poisons the domain for its
    // real owner.
    expect(findDomainConflicts([DOMAIN, dom({ tenantId: "x", state: "PENDING" })])).toEqual([])
    expect(findDomainConflicts([DOMAIN, dom({ tenantId: "x", state: "REVOKED" })])).toEqual([])
  })

  it("resolves nothing for an unknown host", () => {
    expect(discoverTenantByDomain("example.invalid", [DOMAIN])).toBeNull()
  })
})

describe("a verified domain proves ownership, not membership", () => {
  it("returns a tenant id and no user-shaped information at all", () => {
    // The bible's invariant, §9.1: a work email is a discovery HINT. Owning
    // rochester.edu and having an account at Rochester are different facts, and
    // a system that conflates them lets anyone with an address at a verified
    // domain in.
    // Note what is passed: a DOMAIN. The caller splits an address and keeps the
    // right-hand side, and the local part never reaches this function — which
    // is the mechanical reason it cannot answer a question about a person.
    // (Written without an example address at all: a plausible-looking one in a
    // public repository is worth avoiding even when it is invented, and the
    // `no-personal-data` guard is right to say so.)
    const answer = discoverTenantByDomain("rochester.edu", [DOMAIN])
    expect(answer).toBe("tnt_rochester")
    // There is no shape here that could carry a person: it is a string.
    expect(typeof answer).toBe("string")
  })
})

describe("domain records validate", () => {
  it("accepts a real hostname", () => {
    expect(validateDomain(DOMAIN)).toEqual([])
    expect(validateDomain(dom({ domain: "simon.rochester.edu" }))).toEqual([])
  })

  it("refuses things that are not hostnames", () => {
    for (const bad of ["", "rochester", "roch ester.edu", "-rochester.edu", "rochester.e", "@x.edu"]) {
      expect(validateDomain(dom({ domain: bad })).map((p) => p.field)).toContain("domain")
    }
  })

  it("refuses a verified domain with no record of when", () => {
    // "When did we start trusting this" is the question asked after a hijacked
    // domain is discovered, and an unauditable answer is no answer.
    expect(validateDomain(dom({ verifiedAt: null })).map((p) => p.field)).toContain("verifiedAt")
  })

  it("refuses a pending claim with nothing to publish", () => {
    expect(
      validateDomain(dom({ state: "PENDING", verifiedAt: null, challenge: "" })).map((p) => p.field),
    ).toContain("challenge")
  })
})

describe("connection health", () => {
  it("is healthy when the credential is comfortably in date", () => {
    expect(connectionHealth(SAML, NOW)).toEqual({
      connectionId: "conn-rochester-saml",
      health: "HEALTHY",
      reason: "ok",
      daysUntilExpiry: 400,
    })
  })

  it("warns before a certificate expires, not after", () => {
    // Thirty days: long enough that a renewal fits in a change window. A
    // warning that arrives on the day is a warning nobody can act on.
    const soon = conn({ credentials: [{ ...SAML.credentials[0], expiresAt: at(10) }] })
    const report = connectionHealth(soon, NOW)
    expect(report.health).toBe("EXPIRING_SOON")
    expect(report.reason).toBe("credential-expiring")
    expect(report.credential).toBe("saml-signing-certificate")
    expect(report.daysUntilExpiry).toBe(10)
  })

  it("warns exactly at the boundary and not one day past it", () => {
    const boundary = (days: number) =>
      connectionHealth(conn({ credentials: [{ ...SAML.credentials[0], expiresAt: at(days) }] }), NOW)
        .health
    expect(boundary(EXPIRY_WARNING_DAYS)).toBe("EXPIRING_SOON")
    expect(boundary(EXPIRY_WARNING_DAYS + 1)).toBe("HEALTHY")
  })

  it("reports an expired credential as expired", () => {
    const dead = conn({ credentials: [{ ...SAML.credentials[0], expiresAt: at(-1) }] })
    expect(connectionHealth(dead, NOW).health).toBe("EXPIRED")
  })

  it("treats an unreadable expiry as expired rather than ignoring it", () => {
    // Failing closed on a login method is an inconvenience. Failing open is an
    // outage discovered by users at the sign-in page.
    const garbled = conn({ credentials: [{ ...SAML.credentials[0], expiresAt: "soon" }] })
    expect(connectionHealth(garbled, NOW).health).toBe("EXPIRED")
  })

  it("reports the SOONEST expiry when there are several credentials, in either order", () => {
    // Both orders, because a connection is only as healthy as its nearest
    // expiry — and a "take the last one" implementation gets the right answer
    // whenever the list happens to be sorted, which is most of the time.
    const cert = { ...SAML.credentials[0], expiresAt: at(400) }
    const token = {
      purpose: "scim-token" as const,
      ref: "/tenure/scim/rochester",
      expiresAt: at(5),
      lastRotatedAt: null,
    }

    for (const credentials of [
      [cert, token],
      [token, cert],
    ]) {
      const report = connectionHealth(conn({ credentials }), NOW)
      expect(report.health).toBe("EXPIRING_SOON")
      expect(report.credential).toBe("scim-token")
      expect(report.daysUntilExpiry).toBe(5)
    }
  })

  it("is healthy when nothing expires", () => {
    const local = conn({
      kind: "COGNITO_LOCAL",
      issuer: "",
      credentials: [],
    })
    expect(connectionHealth(local, NOW)).toEqual({
      connectionId: "conn-rochester-saml",
      health: "HEALTHY",
      reason: "ok",
      daysUntilExpiry: null,
    })
  })

  it("checks status before expiry", () => {
    // A revoked connection with a fresh certificate is still revoked. Reporting
    // it as healthy-but-not-offered puts "revoked" and "fine" in the same
    // bucket on a fleet health page.
    for (const [status, reason] of [
      ["PENDING", "status-pending"],
      ["DISABLED", "status-disabled"],
      ["REVOKED", "status-revoked"],
    ] as const) {
      const report = connectionHealth(conn({ status }), NOW)
      expect(report.health).toBe("NOT_OFFERED")
      expect(report.reason).toBe(reason)
    }
  })
})

describe("the sign-in page's projection", () => {
  it("carries exactly two fields", () => {
    // The counterpart to the tenant registry's login projection. A stranger at
    // a sign-in page may learn which buttons to draw. They may not learn the
    // customer's IdP issuer or the app client id — the second is half of what
    // an attacker needs to craft an authorization request that looks like ours.
    const offered = loginMethods([SAML], NOW)
    expect(offered).toHaveLength(1)
    expect(Object.keys(offered[0]).sort()).toEqual(["displayName", "kind"])
  })

  it("leaks no issuer, pool, app client or credential reference", () => {
    const serialized = JSON.stringify(loginMethods([SAML], NOW))
    for (const secret of [
      SAML.issuer,
      SAML.poolId,
      SAML.appClientId,
      SAML.credentials[0].ref,
      SAML.tenantId,
      SAML.connectionId,
    ]) {
      expect(serialized).not.toContain(secret)
    }
  })

  it("offers nothing that is not active", () => {
    for (const status of ["PENDING", "DISABLED", "REVOKED"] as const) {
      expect(loginMethods([conn({ status })], NOW)).toEqual([])
    }
  })

  it("offers nothing whose credential has expired", () => {
    const dead = conn({ credentials: [{ ...SAML.credentials[0], expiresAt: at(-1) }] })
    expect(loginMethods([dead], NOW)).toEqual([])
  })

  it("still offers a connection that is expiring soon", () => {
    // It works today. Removing it early takes a working tenant offline to
    // prevent a future problem.
    const soon = conn({ credentials: [{ ...SAML.credentials[0], expiresAt: at(3) }] })
    expect(loginMethods([soon], NOW)).toHaveLength(1)
  })

  it("orders deterministically", () => {
    // A sign-in page that reshuffles its buttons between requests looks like a
    // bug and trains people to click wherever the button was last time.
    const many = [
      conn({ connectionId: "c1", kind: "OIDC", displayName: "Zebra", issuer: "https://z.example" }),
      conn({ connectionId: "c2", kind: "SAML", displayName: "Alpha" }),
      conn({ connectionId: "c3", kind: "OIDC", displayName: "Alpha", issuer: "https://a.example" }),
    ]
    expect(loginMethods(many, NOW).map((m) => `${m.kind}:${m.displayName}`)).toEqual([
      "OIDC:Alpha",
      "OIDC:Zebra",
      "SAML:Alpha",
    ])
    expect(loginMethods([...many].reverse(), NOW).map((m) => m.displayName)).toEqual([
      "Alpha",
      "Zebra",
      "Alpha",
    ])
  })
})

describe("what an operator is asked to look at", () => {
  it("lists only what needs doing, soonest first", () => {
    const connections = [
      conn({ connectionId: "fine", credentials: [{ ...SAML.credentials[0], expiresAt: at(400) }] }),
      conn({ connectionId: "dead", credentials: [{ ...SAML.credentials[0], expiresAt: at(-5) }] }),
      conn({ connectionId: "soon", credentials: [{ ...SAML.credentials[0], expiresAt: at(20) }] }),
      // Disabled on purpose. Not an operational problem, and mixing it in makes
      // the list mostly noise — which is how the one that matters gets missed.
      conn({ connectionId: "off", status: "DISABLED" }),
    ]
    expect(connectionsNeedingAttention(connections, NOW).map((r) => r.connectionId)).toEqual([
      "dead",
      "soon",
    ])
  })

  it("is empty when the fleet is fine", () => {
    expect(connectionsNeedingAttention([SAML], NOW)).toEqual([])
  })
})

describe("connections validate before they are stored", () => {
  it("accepts a well-formed SAML connection", () => {
    expect(validateConnection(SAML)).toEqual([])
  })

  it("refuses a credential that is a value rather than a reference", () => {
    // The check that keeps a certificate out of a registry that is read by the
    // console, projected into login discovery, and serialised into artifacts.
    const pasted = conn({
      credentials: [
        {
          purpose: "saml-signing-certificate",
          ref: "-----BEGIN CERTIFICATE-----MIIDdzCCAl+gAwIBAgIE",
          expiresAt: at(100),
          lastRotatedAt: null,
        },
      ],
    })
    expect(validateConnection(pasted).map((p) => p.field)).toContain("credentials.ref")
  })

  it("accepts an SSM parameter path as well as an ARN", () => {
    const ssm = conn({
      credentials: [
        {
          purpose: "saml-signing-certificate",
          ref: "/tenure/idp/rochester/cert",
          expiresAt: at(100),
          lastRotatedAt: null,
        },
      ],
    })
    expect(validateConnection(ssm)).toEqual([])
  })

  it("refuses an external connection with no issuer to check a callback against", () => {
    // An empty issuer either rejects everything or, worse, is skipped by a
    // caller that finds it falsy.
    expect(validateConnection(conn({ issuer: "" })).map((p) => p.field)).toContain("issuer")
  })

  it("refuses an http issuer", () => {
    // Metadata fetched over http can be rewritten in transit.
    expect(
      validateConnection(conn({ issuer: "http://idp.rochester.edu/saml" })).map((p) => p.field),
    ).toContain("issuer")
  })

  it("does not require an issuer of the local pool, which has none", () => {
    const local = conn({ kind: "COGNITO_LOCAL", issuer: "", credentials: [] })
    expect(validateConnection(local)).toEqual([])
  })

  it("refuses a SAML connection with no signing certificate", () => {
    expect(validateConnection(conn({ credentials: [] })).map((p) => p.detail).join(" ")).toMatch(
      /cannot verify an assertion/,
    )
  })

  it("refuses an OIDC connection with no client secret", () => {
    const oidc = conn({ kind: "OIDC", credentials: [] })
    expect(validateConnection(oidc).map((p) => p.detail).join(" ")).toMatch(/code exchange/)
  })

  it("refuses a connection belonging to no tenant", () => {
    // One that could be offered to any tenant.
    expect(validateConnection(conn({ tenantId: "" })).map((p) => p.field)).toContain("tenantId")
  })

  it("refuses a connection with no pool or app client", () => {
    expect(validateConnection(conn({ appClientId: "" })).map((p) => p.field)).toContain(
      "appClientId",
    )
    expect(validateConnection(conn({ poolId: "" })).map((p) => p.field)).toContain("appClientId")
  })
})
