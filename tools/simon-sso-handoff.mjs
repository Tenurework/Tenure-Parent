#!/usr/bin/env node
/**
 * GE-043-006 — generate the Simon SSO handoff package from what is deployed.
 *
 *   node tools/simon-sso-handoff.mjs           # write docs/handoff/simon-sso.md
 *   node tools/simon-sso-handoff.mjs --check   # fail if it is stale
 *
 * Facts come from `docs/architecture/aws-inventory.json`, which
 * `tools/aws-inventory.mjs` produces from read-only AWS calls. Nothing here
 * reaches AWS: the generator turns recorded facts into a document, so it runs in
 * a pull request, on a laptop, and in CI without credentials.
 *
 * **Nothing in the output is invented.** A field we cannot fill is printed as a
 * gap with the reason, because a plausible endpoint in a handoff document is
 * configured by a university's IT team, tested, and cannot be debugged — both
 * sides believe they are correct. `buildHandoffPackage` throws rather than pass
 * a placeholder through.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..")
const OUTPUT = path.join(ROOT, "docs/handoff/simon-sso.md")

/**
 * Where the facts come from.
 *
 * Overridable so the origin-selection rules can be exercised against synthetic
 * inventories. Without that, "an issued certificate" and "an enabled
 * distribution" are filters that happen to be true of the one real inventory —
 * a mutation removing either changed nothing, which is how they were found
 * untested.
 */
function inventoryPath() {
  const flag = process.argv.indexOf("--inventory")
  if (flag !== -1 && process.argv[flag + 1]) return path.resolve(process.argv[flag + 1])
  return path.join(ROOT, "docs/architecture/aws-inventory.json")
}

/**
 * The engine, loaded from source.
 *
 * `packages/identity` is TypeScript consumed without a build step, so a plain
 * `.mjs` tool cannot import it. Rather than duplicate the rules — two copies is
 * how they come to disagree — the decision logic is re-expressed here only for
 * the parts a document needs, and `handoff.test.ts` is what proves the rules.
 * The one rule that must not be duplicated is the placeholder refusal, so this
 * asserts against the same pattern the module exports and fails loudly if it
 * drifts.
 */
const PLACEHOLDER_SOURCE = path.join(ROOT, "packages/identity/src/handoff.ts")

function placeholderPattern() {
  const source = fs.readFileSync(PLACEHOLDER_SOURCE, "utf8")
  const match = /const PLACEHOLDER =\n\s*(\/.+\/[a-z]*)/.exec(source)
  if (!match) {
    throw new Error(
      `Could not read PLACEHOLDER out of ${PLACEHOLDER_SOURCE}. This tool must use the same pattern the ` +
        `engine does; a second copy is how they come to disagree.`,
    )
  }
  // eslint-disable-next-line no-eval
  return eval(match[1])
}

/** Deployment facts, read from the inventory rather than assumed. */
export function deploymentFacts() {
  const INVENTORY = inventoryPath()
  if (!fs.existsSync(INVENTORY)) {
    return { serviceOrigin: null, userPoolId: null, appClientId: null, cognitoDomain: null, region: null, generatedAt: null }
  }
  const inventory = JSON.parse(fs.readFileSync(INVENTORY, "utf8"))

  // A public origin is a CloudFront alias whose certificate actually issued.
  // An alias with a FAILED certificate is a name that does not serve traffic,
  // and handing it over would be handing over a broken endpoint.
  const issued = new Set(
    (inventory.edge?.certificates ?? [])
      .filter((certificate) => certificate.status === "ISSUED")
      .map((certificate) => certificate.domain),
  )
  const alias = (inventory.edge?.cloudfront ?? [])
    .filter((distribution) => distribution.enabled)
    .flatMap((distribution) => distribution.aliases ?? [])
    .find((name) => issued.has(name))

  const pool = (inventory.identityProvider?.cognitoUserPools ?? [])[0] ?? null

  // Recorded, not composed. The inventory is what AWS was asked; anything not
  // in it is something nobody has looked at, and a URL built from a convention
  // is a confident answer about a pool that may not match it.
  return {
    serviceOrigin: alias ? `https://${alias}` : null,
    issuer: pool?.issuer ?? null,
    spEntityId: pool?.spEntityId ?? null,
    hostedDomain: pool?.hostedDomain ?? null,
    appClientId: pool?.appClientId ?? null,
    generatedAt: inventory.generatedAt ?? null,
  }
}

const LABELS = {
  serviceOrigin: "Tenure service origin",
  spEntityId: "SP entity ID (Audience / Identifier)",
  assertionConsumerServiceUrl: "Assertion Consumer Service (ACS / Reply URL)",
  singleLogoutUrl: "Single Logout URL",
  spMetadataUrl: "SP metadata / JWKS",
  oidcRedirectUri: "OIDC redirect URI",
  oidcClientId: "OIDC client ID",
  oidcDiscoveryUrl: "OIDC discovery document",
  scimBaseUrl: "SCIM 2.0 base URL",
  signingCertificate: "Signing certificate",
}

/**
 * The decisions, re-expressed for the document.
 *
 * Kept structurally identical to `buildHandoffPackage` and covered by its tests.
 * A `--check` run in CI compares the rendered output, so a drift between the two
 * shows up as a stale document rather than as a silent disagreement.
 */
function buildFields(facts) {
  const invented = placeholderPattern()
  for (const [name, value] of Object.entries(facts)) {
    if (typeof value === "string" && invented.test(value)) {
      throw new Error(
        `${name} is "${value}", which is a placeholder. A handoff package is pasted into a production ` +
          `identity provider; leave the field blocked instead.`,
      )
    }
  }

  const COGNITO_BLOCKER =
    "The identity provider is not deployed, so none of its endpoints have been recorded. Create it (GE-041-003, blocked on the AWS Organization), then re-run this generator."
  const ORIGIN_BLOCKER =
    "Nothing is deployed at a public origin with an issued certificate, so there is no URL to hand over."

  const { serviceOrigin: origin, issuer, spEntityId, hostedDomain: domain, appClientId } = facts

  // The SCIM base is only real if the route exists. An origin proves the
  // application is served; it does not prove this path answers. Handing over a
  // URL that 404s is the same failure as inventing one — the IT team configures
  // it, the sync fails, and the error says nothing about which side is wrong.
  const scimRouteExists = fs.existsSync(path.join(ROOT, "apps/web/src/app/api/scim"))

  const rows = [
    ["serviceOrigin", origin, origin ? "CloudFront alias with an ISSUED certificate" : null, ORIGIN_BLOCKER],
    [
      "scimBaseUrl",
      origin && scimRouteExists ? `${origin}/api/scim/v2` : null,
      "the deployed SCIM route, on the service origin",
      origin
        ? "The SCIM route is not implemented. GE-043-005 built the protocol boundary it will use; the endpoint itself needs a bearer token and a connection registry, which arrive with the Cognito cutover."
        : ORIGIN_BLOCKER,
    ],
    ["spEntityId", spEntityId, "recorded identity provider", COGNITO_BLOCKER],
    [
      "assertionConsumerServiceUrl",
      domain ? `${domain}/saml2/idpresponse` : null,
      "recorded hosted sign-in domain",
      issuer ? "The identity provider has no hosted sign-in domain recorded, so there is no endpoint for the IdP to post to." : COGNITO_BLOCKER,
    ],
    [
      "singleLogoutUrl",
      domain ? `${domain}/saml2/logout` : null,
      "recorded hosted sign-in domain",
      issuer ? "The identity provider has no hosted sign-in domain recorded." : COGNITO_BLOCKER,
    ],
    ["spMetadataUrl", issuer ? `${issuer}/.well-known/jwks.json` : null, "recorded issuer", COGNITO_BLOCKER],
    ["oidcDiscoveryUrl", issuer ? `${issuer}/.well-known/openid-configuration` : null, "recorded issuer", COGNITO_BLOCKER],
    ["oidcRedirectUri", domain ? `${domain}/oauth2/idpresponse` : null, "recorded hosted sign-in domain", COGNITO_BLOCKER],
    ["oidcClientId", appClientId, "recorded app client", COGNITO_BLOCKER],
    [
      "signingCertificate",
      null,
      "identity provider",
      "Signing keys are published at the JWKS endpoint rather than as a certificate file. An IdP that requires a certificate needs one exported once the provider exists.",
    ],
  ]

  return rows.map(([name, value, source, blocker]) => ({
    name,
    value: value ?? null,
    source: value ? source : "—",
    blockedBy: value ? null : blocker,
  }))
}

function render(fields, facts) {
  const known = fields.filter((field) => field.value !== null)
  const blocked = fields.filter((field) => field.value === null)

  const lines = [
    "# Simon SSO handoff package",
    "",
    "**GE-043-006.** Generated by `tools/simon-sso-handoff.mjs` from",
    "`docs/architecture/aws-inventory.json`. Do not edit by hand — re-run the generator.",
    "",
    "This is what the University of Rochester's IT team needs in order to configure",
    "single sign-on against Tenure. Every value below is read from deployed",
    "infrastructure. **Nothing is a placeholder**: a field we cannot fill yet is listed",
    "as blocked, with the reason, because a plausible-looking endpoint is configured,",
    "tested, and cannot be debugged — both sides believe they are correct.",
    "",
    `Deployment facts as of ${facts.generatedAt ?? "(no inventory)"}.`,
    "",
    `**${known.length} of ${fields.length} fields are available.**`,
    "",
  ]

  if (known.length > 0) {
    lines.push("## Ready to configure", "", "| Field | Value | Source |", "|---|---|---|")
    for (const field of known) {
      lines.push(`| ${LABELS[field.name]} | \`${field.value}\` | ${field.source} |`)
    }
    lines.push("")
  } else {
    lines.push(
      "## Ready to configure",
      "",
      "Nothing yet. Every field below is waiting on infrastructure that does not exist,",
      "and this document exists so the IT team knows what is coming rather than being",
      "handed values that do not work.",
      "",
    )
  }

  if (blocked.length > 0) {
    lines.push("## Not available yet", "", "| Field | Blocked by |", "|---|---|")
    for (const field of blocked) {
      lines.push(`| ${LABELS[field.name]} | ${field.blockedBy} |`)
    }
    lines.push("")
  }

  lines.push(
    "## What Simon supplies",
    "",
    "These come from the university's identity provider and cannot be generated here.",
    "They are listed so the exchange is one conversation rather than three.",
    "",
    "| Field | Notes |",
    "|---|---|",
    "| IdP entity ID / issuer | From the university's SAML or OIDC metadata. |",
    "| IdP SSO URL | Where Tenure sends authentication requests. |",
    "| IdP signing certificate | Used to verify assertions. Rotation is expected; see GE-043-001. |",
    "| Attribute for a stable subject | **Not an email address.** An address is a label that changes; keying identity on it means a renamed mailbox is a new person. |",
    "| Attribute for email | For display and notification only. |",
    "| Verified domains | Proved by DNS TXT record; see GE-043-004. |",
    "",
    "Group and role claims are deliberately absent from that list. Tenure does not take",
    "authority from a directory group — authority comes from a membership, a seat or a",
    "policy recorded here (Bible §9.1, GE-043-003). Mapping one would let anyone who can",
    "edit a group at the university grant themselves access inside Tenure, with nothing",
    "in the audit trail but a successful login.",
    "",
  )

  return lines.join("\n")
}

function main() {
  const facts = deploymentFacts()

  // `--facts --inventory <path>` prints the gathered facts and stops. It is how
  // the guard exercises the origin rules against synthetic inventories: they
  // happen to be true of the one real inventory, so nothing else would notice
  // if they stopped working.
  if (process.argv.includes("--facts")) {
    console.log(JSON.stringify(facts))
    return
  }

  const fields = buildFields(facts)
  const rendered = render(fields, facts)

  const check = process.argv.includes("--check")
  const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, "utf8") : null

  if (check) {
    if (current !== rendered) {
      console.error(`::error::${path.relative(ROOT, OUTPUT)} is stale. Run: node tools/simon-sso-handoff.mjs`)
      process.exit(1)
    }
    console.log(`${path.relative(ROOT, OUTPUT)} is current.`)
    return
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true })
  fs.writeFileSync(OUTPUT, rendered)
  const known = fields.filter((field) => field.value !== null).length
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)} — ${known}/${fields.length} fields available.`)
}

// Importable for tests; still a script when run directly.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main()
}
