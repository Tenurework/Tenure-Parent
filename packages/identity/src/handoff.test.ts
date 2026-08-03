import {
  InventedValueError,
  buildHandoffPackage,
  handoffProblems,
  handoffReadiness,
  looksInvented,
  type DeploymentFacts,
  type HandoffFieldName,
} from "./index"

/**
 * GE-043-006 — a handoff package is pasted into a production identity provider.
 *
 * Every value in it is a thing a university's IT team configures once and
 * debugs from the outside. A made-up endpoint is not a smaller version of the
 * real one: it is configured, tested, and cannot be diagnosed, because both
 * sides believe they are correct.
 */

const nothingDeployed: DeploymentFacts = {
  serviceOrigin: null,
  issuer: null,
  spEntityId: null,
  hostedDomain: null,
  appClientId: null,
}

/**
 * Every provider value is a *recorded fact*, not a URL composed from a pool id.
 *
 * An earlier version derived these from the provider's URL convention, which is
 * guessing dressed as knowledge — a confident URL for a pool nobody looked at.
 * It also put provider host names in a package GE-041 keeps
 * provider-independent, and the `forbidden-clients` guard said so.
 */
const fullyDeployed: DeploymentFacts = {
  serviceOrigin: "https://platform.tenurework.com",
  issuer: "https://idp.internal.tenurework.com/pool-a1b2c3",
  spEntityId: "urn:tenure:sp:pool-a1b2c3",
  hostedDomain: "https://signin.tenurework.com",
  appClientId: "7q1k3n5p7r9t1v3x5z7b9d1f3h",
}

const field = (facts: DeploymentFacts, name: HandoffFieldName) => {
  const found = buildHandoffPackage(facts).find((f) => f.name === name)
  if (!found) throw new Error(`${name} is not in the package`)
  return found
}

describe("nothing is invented", () => {
  it("refuses a placeholder origin rather than emitting it", () => {
    // The moment somebody types example.com to make the generator produce a
    // complete-looking document is the moment this exists to interrupt.
    expect(() =>
      buildHandoffPackage({ ...nothingDeployed, serviceOrigin: "https://tenure.example.edu" }),
    ).toThrow(InventedValueError)
  })

  it("refuses every shape a template leaves behind", () => {
    for (const invented of [
      "https://your-domain.com",
      "https://localhost:3000",
      "https://{{ORIGIN}}",
      "https://<your-tenant>.example.com",
      "TODO",
      "changeme",
    ]) {
      expect(looksInvented(invented)).toBe(true)
    }
  })

  it("does not fire on a real origin", () => {
    // A detector that flagged the real value would get switched off.
    expect(looksInvented("https://platform.tenurework.com")).toBe(false)
    expect(looksInvented("urn:tenure:sp:pool-a1b2c3")).toBe(false)
  })

  it("says why, in the error somebody will read", () => {
    try {
      buildHandoffPackage({ ...nothingDeployed, serviceOrigin: "https://example.com" })
      throw new Error("expected a refusal")
    } catch (error) {
      expect((error as Error).message).toMatch(/production identity provider/)
      expect((error as Error).message).toMatch(/Leave it blocked instead/)
    }
  })
})

describe("with nothing deployed, everything is blocked and nothing is guessed", () => {
  const package_ = buildHandoffPackage(nothingDeployed)

  it("emits no value at all", () => {
    expect(package_.every((f) => f.value === null)).toBe(true)
  })

  it("gives every blocked field a reason", () => {
    for (const f of package_) {
      expect(f.blockedBy).toBeTruthy()
      expect((f.blockedBy ?? "").length).toBeGreaterThan(20)
    }
  })

  it("names the missing provider as the blocker for the IdP fields", () => {
    expect(field(nothingDeployed, "spEntityId").blockedBy).toMatch(/identity provider is not deployed/)
    expect(field(nothingDeployed, "oidcClientId").blockedBy).toMatch(/identity provider is not deployed/)
  })

  it("does not build a URL on a null origin", () => {
    // "null/api/scim/v2" is worse than a gap: it looks like a typo somebody can
    // fix.
    const scim = field(nothingDeployed, "scimBaseUrl")
    expect(scim.value).toBeNull()
    expect(scim.blockedBy).toMatch(/no URL to hand over/)
  })

  it("is internally consistent", () => {
    expect(handoffProblems(package_)).toEqual([])
  })

  it("is not sendable as a configuration", () => {
    const readiness = handoffReadiness(package_)
    expect(readiness.known).toBe(0)
    expect(readiness.sendable).toBe(false)
  })
})

describe("with an origin but no provider, the half we own is filled in", () => {
  const originOnly: DeploymentFacts = { ...nothingDeployed, serviceOrigin: "https://platform.tenurework.com" }

  it("gives the SCIM base, which is served by this application", () => {
    expect(field(originOnly, "scimBaseUrl").value).toBe("https://platform.tenurework.com/api/scim/v2")
  })

  it("still blocks everything the provider owns", () => {
    for (const name of ["spEntityId", "assertionConsumerServiceUrl", "oidcClientId"] as const) {
      expect(field(originOnly, name).value).toBeNull()
    }
  })

  it("counts as partially known", () => {
    const readiness = handoffReadiness(buildHandoffPackage(originOnly))
    expect(readiness.known).toBeGreaterThan(0)
    expect(readiness.blocked).toBeGreaterThan(0)
  })
})

describe("with everything deployed, the values are the recorded ones", () => {
  it("reports the SP entity id as recorded, not as composed", () => {
    expect(field(fullyDeployed, "spEntityId").value).toBe("urn:tenure:sp:pool-a1b2c3")
  })

  it("appends the SAML path to the recorded hosted domain", () => {
    expect(field(fullyDeployed, "assertionConsumerServiceUrl").value).toBe(
      "https://signin.tenurework.com/saml2/idpresponse",
    )
  })

  it("appends the standard OIDC path to the recorded issuer", () => {
    // The path is the specification's; the host is not ours to guess.
    expect(field(fullyDeployed, "oidcDiscoveryUrl").value).toBe(
      "https://idp.internal.tenurework.com/pool-a1b2c3/.well-known/openid-configuration",
    )
  })

  it("passes through the app client id, which is not a secret", () => {
    expect(field(fullyDeployed, "oidcClientId").value).toBe("7q1k3n5p7r9t1v3x5z7b9d1f3h")
  })

  it("says a certificate is not how the provider publishes its keys", () => {
    // An IdP that demands a certificate file needs one exported. Saying so beats
    // handing over a JWKS URL labelled "certificate".
    const cert = field(fullyDeployed, "signingCertificate")
    expect(cert.value).toBeNull()
    expect(cert.blockedBy).toMatch(/JWKS/)
  })

  it("is internally consistent and sendable", () => {
    const package_ = buildHandoffPackage(fullyDeployed)
    expect(handoffProblems(package_)).toEqual([])
    expect(handoffReadiness(package_).sendable).toBe(true)
  })

  it("says where every known value came from", () => {
    for (const f of buildHandoffPackage(fullyDeployed)) {
      expect(f.source.length).toBeGreaterThan(5)
    }
  })
})

describe("a provider with no hosted sign-in domain", () => {
  const noDomain: DeploymentFacts = { ...fullyDeployed, hostedDomain: null }

  it("blocks the endpoints that need one, and says which", () => {
    const acs = field(noDomain, "assertionConsumerServiceUrl")
    expect(acs.value).toBeNull()
    expect(acs.blockedBy).toMatch(/hosted sign-in domain/)
  })

  it("still gives the values that do not need one", () => {
    expect(field(noDomain, "spEntityId").value).toBe("urn:tenure:sp:pool-a1b2c3")
    expect(field(noDomain, "oidcDiscoveryUrl").value).toBeTruthy()
  })
})

describe("the package cannot contradict itself", () => {
  it("reports a field with both a value and a blocker", () => {
    const problems = handoffProblems([
      { name: "serviceOrigin", value: "https://a.test", source: "s", blockedBy: "b" },
    ])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/both a value and a blocker/)
  })

  it("reports a field with neither", () => {
    const problems = handoffProblems([{ name: "serviceOrigin", value: null, source: "s", blockedBy: null }])
    expect(problems[0]).toMatch(/no value and no reason/)
  })

  it("reports a placeholder that reached a field", () => {
    const problems = handoffProblems([
      { name: "serviceOrigin", value: "https://example.com", source: "s", blockedBy: null },
    ])
    expect(problems[0]).toMatch(/placeholder/)
  })

  it("reports a value with no stated source", () => {
    const problems = handoffProblems([
      { name: "serviceOrigin", value: "https://a.test", source: "  ", blockedBy: null },
    ])
    expect(problems[0]).toMatch(/where it came from/)
  })

  it("passes a well-formed package, so the checks are not blanket", () => {
    expect(
      handoffProblems([{ name: "serviceOrigin", value: "https://a.test", source: "inventory", blockedBy: null }]),
    ).toEqual([])
  })
})
