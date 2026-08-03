/**
 * GE-043-006 — the SSO handoff package, generated rather than written.
 *
 * A university's IT team configures SSO on their side from a document we give
 * them: our entity id, our assertion consumer service, our redirect URIs, our
 * signing certificate. Every value in it is a thing they will paste into a
 * production identity provider.
 *
 * ## Why a plausible placeholder is worse than a gap
 *
 * The tempting document has every field filled in, because a document with holes
 * looks unfinished. But a made-up ACS URL is not a smaller version of the real
 * one — it is a value somebody configures, tests, and cannot debug, because both
 * sides believe they are correct. `https://tenure.example.edu/saml/acs` reads
 * exactly like a real endpoint and is not one.
 *
 * A gap is self-describing. "We cannot give you this yet, here is what has to
 * happen first" costs an email; a wrong value costs a scheduled cutover.
 *
 * So this refuses to emit a placeholder — `buildHandoffPackage` throws rather
 * than passing one through, because the moment where somebody types
 * `example.com` to make the generator produce a complete-looking document is the
 * moment this exists to interrupt.
 */

export type HandoffFieldName =
  | "serviceOrigin"
  | "spEntityId"
  | "assertionConsumerServiceUrl"
  | "singleLogoutUrl"
  | "spMetadataUrl"
  | "oidcRedirectUri"
  | "oidcClientId"
  | "oidcDiscoveryUrl"
  | "scimBaseUrl"
  | "signingCertificate"

export interface HandoffField {
  name: HandoffFieldName
  /** What the IT team should read. Null when we do not know it yet. */
  value: string | null
  /** Where the value came from, so a reader can check it. */
  source: string
  /** Present exactly when `value` is null. What has to happen first. */
  blockedBy: string | null
}

/** The facts a deployment actually knows about itself. */
export interface DeploymentFacts {
  /**
   * The public origin, from a CloudFront alias with an issued certificate.
   *
   * Null when nothing is deployed — which is a fact about the deployment, not a
   * reason to guess.
   */
  serviceOrigin: string | null
  /**
   * The identity provider's issuer URL, **as recorded**, not as derived.
   *
   * An earlier version composed this from a pool id and a region using the
   * provider's URL convention. That is guessing dressed as knowledge: it
   * produces a confident URL for a pool nobody has looked at, which is the
   * failure this whole item exists to prevent. It also put provider-specific
   * host names in a package that GE-041 keeps provider-independent, and the
   * `forbidden-clients` guard said so.
   */
  issuer: string | null
  /** The provider's SP entity id, as recorded. */
  spEntityId: string | null
  /** The provider's hosted sign-in domain, as recorded. */
  hostedDomain: string | null
  /** App client id, as recorded. Not a secret — the client *secret* is. */
  appClientId: string | null
}

export class InventedValueError extends Error {
  constructor(field: string, value: string) {
    super(
      `${field} was given the value "${value}", which is a placeholder. A handoff package is pasted ` +
        `into a production identity provider: a made-up endpoint is configured, tested, and cannot be ` +
        `debugged, because both sides believe they are correct. Leave it blocked instead.`,
    )
    this.name = "InventedValueError"
  }
}

/**
 * Strings that are examples rather than endpoints.
 *
 * `example.com`, `example.edu` and friends are reserved by RFC 2606 precisely so
 * they can never resolve — which makes them the most likely thing somebody
 * writes and the least likely thing that works. The rest are the shapes
 * templates leave behind.
 */
const PLACEHOLDER =
  /(example\.(com|org|net|edu|test)|localhost|127\.0\.0\.1|\bTODO\b|\bTBD\b|\bFIXME\b|changeme|xxxx|<[^>]+>|\{\{[^}]+\}\}|your-|my-domain)/i

export function looksInvented(value: string): boolean {
  return PLACEHOLDER.test(value)
}

const PROVIDER_BLOCKER =
  "The identity provider is not deployed, so none of its endpoints have been recorded. Create it (GE-041-003, blocked on the AWS Organization), then re-run this generator."

const DOMAIN_BLOCKER =
  "The identity provider has no hosted sign-in domain recorded, so there is no endpoint for the IdP to post to."

const ORIGIN_BLOCKER =
  "Nothing is deployed at a public origin with an issued certificate, so there is no URL to hand over."

/**
 * Build the package from what is actually deployed.
 *
 * Nothing is derived from a value that is itself unknown: an ACS URL built on a
 * null origin would be the string "null/saml/acs", which is worse than a gap
 * because it looks like a typo somebody can fix.
 */
export function buildHandoffPackage(facts: DeploymentFacts): readonly HandoffField[] {
  for (const [name, value] of Object.entries(facts)) {
    if (typeof value === "string" && looksInvented(value)) {
      throw new InventedValueError(name, value)
    }
  }

  const fields: HandoffField[] = []
  const origin = facts.serviceOrigin

  fields.push({
    name: "serviceOrigin",
    value: origin,
    source: origin
      ? "CloudFront alias with an ISSUED certificate, from docs/architecture/aws-inventory.json"
      : "docs/architecture/aws-inventory.json",
    blockedBy: origin ? null : ORIGIN_BLOCKER,
  })

  // The SCIM base is ours, not Cognito's — it is served by this application, so
  // it needs the origin and nothing else.
  fields.push({
    name: "scimBaseUrl",
    value: origin ? `${origin}/api/scim/v2` : null,
    source: origin ? "derived from the service origin" : "docs/architecture/aws-inventory.json",
    blockedBy: origin ? null : ORIGIN_BLOCKER,
  })

  const { issuer, hostedDomain, spEntityId } = facts

  fields.push({
    name: "spEntityId",
    value: spEntityId,
    source: spEntityId ? "recorded identity provider" : "identity provider",
    blockedBy: spEntityId ? null : PROVIDER_BLOCKER,
  })

  // Standard OIDC paths appended to a recorded issuer. The paths are the
  // specification's; the host is not ours to guess.
  fields.push({
    name: "oidcDiscoveryUrl",
    value: issuer ? `${issuer}/.well-known/openid-configuration` : null,
    source: issuer ? "recorded issuer" : "identity provider",
    blockedBy: issuer ? null : PROVIDER_BLOCKER,
  })
  fields.push({
    name: "spMetadataUrl",
    value: issuer ? `${issuer}/.well-known/jwks.json` : null,
    source: issuer ? "recorded issuer" : "identity provider",
    blockedBy: issuer ? null : PROVIDER_BLOCKER,
  })

  for (const [name, suffix] of [
    ["assertionConsumerServiceUrl", "/saml2/idpresponse"],
    ["singleLogoutUrl", "/saml2/logout"],
  ] as const) {
    fields.push({
      name,
      value: hostedDomain ? `${hostedDomain}${suffix}` : null,
      source: hostedDomain ? "recorded hosted sign-in domain" : "identity provider",
      blockedBy: hostedDomain ? null : issuer ? DOMAIN_BLOCKER : PROVIDER_BLOCKER,
    })
  }

  fields.push({
    name: "signingCertificate",
    value: null,
    source: "identity provider",
    blockedBy:
      "Signing keys are published at the JWKS endpoint rather than as a certificate file. An IdP that requires a certificate needs one exported once the provider exists.",
  })

  fields.push({
    name: "oidcRedirectUri",
    value: hostedDomain ? `${hostedDomain}/oauth2/idpresponse` : null,
    source: hostedDomain ? "recorded hosted sign-in domain" : "identity provider",
    blockedBy: hostedDomain ? null : PROVIDER_BLOCKER,
  })

  fields.push({
    name: "oidcClientId",
    value: facts.appClientId,
    source: "recorded app client",
    blockedBy: facts.appClientId ? null : PROVIDER_BLOCKER,
  })

  return fields
}

/**
 * Whether the package is safe to send.
 *
 * A field with both a value and a blocker, or neither, is a bug in the
 * generator rather than a fact about the deployment — and either shape would
 * reach the reader as a contradiction.
 */
export function handoffProblems(fields: readonly HandoffField[]): readonly string[] {
  const problems: string[] = []

  for (const field of fields) {
    if (field.value !== null && field.blockedBy !== null) {
      problems.push(`${field.name} has both a value and a blocker.`)
    }
    if (field.value === null && field.blockedBy === null) {
      problems.push(`${field.name} has no value and no reason.`)
    }
    if (field.value !== null && looksInvented(field.value)) {
      problems.push(`${field.name} carries a placeholder: ${field.value}`)
    }
    if (field.source.trim().length === 0) {
      problems.push(`${field.name} does not say where it came from.`)
    }
  }

  return problems
}

/** How complete the package is, for the covering note. */
export function handoffReadiness(fields: readonly HandoffField[]): {
  known: number
  blocked: number
  sendable: boolean
} {
  const known = fields.filter((field) => field.value !== null).length
  return {
    known,
    blocked: fields.length - known,
    // Sendable when anything at all is known and nothing contradicts itself. A
    // package that is entirely blocked is still worth sending — it tells the IT
    // team what is coming — but it is not a configuration.
    sendable: known > 0 && handoffProblems(fields).length === 0,
  }
}
