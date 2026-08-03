/**
 * GE-043-002 — an enterprise OIDC connection, from metadata to health.
 *
 * The lifecycle itself is `connection-lifecycle.ts` — draft, validate, test,
 * activate, rotate, disable, rollback are the same states whatever the
 * protocol, and having two copies of them would mean two places for a tenant to
 * lock itself out of. This module is the OIDC-specific parts of `VALIDATE` and
 * of health: what a discovery document has to say before it may be trusted,
 * which JWKS key verifies a token, how a client secret is referred to, and what
 * a provider's claims are allowed to decide.
 */

/* ────────────────────────────────────────────────────────── discovery ── */

export interface DiscoveryDocument {
  issuer: string
  authorization_endpoint?: string
  token_endpoint?: string
  jwks_uri?: string
  userinfo_endpoint?: string
  end_session_endpoint?: string
  id_token_signing_alg_values_supported?: readonly string[]
  code_challenge_methods_supported?: readonly string[]
}

export type DiscoveryProblem =
  | "ISSUER_MISMATCH"
  | "NOT_HTTPS"
  | "ENDPOINT_OFF_ISSUER"
  | "MISSING_ENDPOINT"
  | "NO_ACCEPTABLE_SIGNING_ALGORITHM"
  | "NO_PKCE_S256"

export interface DiscoveryFinding {
  problem: DiscoveryProblem
  detail: string
}

/**
 * Signing algorithms an ID token may use.
 *
 * `none` is absent and so is `HS256`. `none` is the algorithm-confusion attack
 * itself. `HS256` is symmetric: the "verification key" is the client secret, so
 * a provider — or anyone who has read our configuration — can mint tokens we
 * accept. Neither belongs in a list of things a *tenant* may configure.
 */
const ACCEPTABLE_ID_TOKEN_ALGORITHMS: ReadonlySet<string> = new Set([
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
])

/** Endpoints without which the connection cannot complete a sign-in. */
const REQUIRED_ENDPOINTS = ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const

function sameOrigin(url: string, issuer: string): boolean {
  try {
    return new URL(url).origin === new URL(issuer).origin
  } catch {
    return false
  }
}

/**
 * Everything wrong with a discovery document, rather than the first thing.
 *
 * An operator pasting a URL wants the whole list. Returning on the first
 * problem produces a fix-one-run-again loop through a form that takes a minute
 * to submit, and the loop is where people give up and disable the checks.
 */
export function validateDiscovery(
  document: DiscoveryDocument,
  expected: { issuer: string },
): readonly DiscoveryFinding[] {
  const findings: DiscoveryFinding[] = []

  // Exact string equality, per OIDC Discovery §4.3. Not a normalised or
  // prefix comparison: `https://idp.test` and `https://idp.test/` are different
  // issuers to a token validator, so accepting either here guarantees every
  // token is later refused for an issuer mismatch nobody can explain.
  if (document.issuer !== expected.issuer) {
    findings.push({
      problem: "ISSUER_MISMATCH",
      detail: `The document declares issuer ${document.issuer}, and this connection is configured for ${expected.issuer}. These must match exactly, including any trailing slash.`,
    })
  }

  for (const endpoint of REQUIRED_ENDPOINTS) {
    const url = document[endpoint]
    if (!url) {
      findings.push({
        problem: "MISSING_ENDPOINT",
        detail: `${endpoint} is absent, so a sign-in could not be completed.`,
      })
      continue
    }
    if (!url.startsWith("https://")) {
      findings.push({
        problem: "NOT_HTTPS",
        detail: `${endpoint} is ${url}. A plaintext endpoint puts the authorization code and the client secret on the wire.`,
      })
      continue
    }
    // A discovery document is fetched from the issuer, so an endpoint pointing
    // somewhere else is either a misconfiguration or a document somebody
    // tampered with. Refusing costs a rare legitimate split-host deployment an
    // explicit exemption; allowing it costs everybody a silent redirect of
    // every authorization request.
    if (!sameOrigin(url, document.issuer)) {
      findings.push({
        problem: "ENDPOINT_OFF_ISSUER",
        detail: `${endpoint} (${url}) is not on the issuer's origin. An endpoint pointing away from the issuer sends every authorization request somewhere the issuer did not vouch for.`,
      })
    }
  }

  const algorithms = document.id_token_signing_alg_values_supported
  if (algorithms && !algorithms.some((algorithm) => ACCEPTABLE_ID_TOKEN_ALGORITHMS.has(algorithm))) {
    findings.push({
      problem: "NO_ACCEPTABLE_SIGNING_ALGORITHM",
      detail: `This provider offers [${algorithms.join(", ")}] and none is asymmetric. "none" is the algorithm-confusion attack; HS256 verifies with the client secret, so anyone holding it can mint tokens we would accept.`,
    })
  }

  const pkce = document.code_challenge_methods_supported
  if (pkce && !pkce.includes("S256")) {
    findings.push({
      problem: "NO_PKCE_S256",
      detail: `This provider offers PKCE methods [${pkce.join(", ")}] without S256. "plain" puts the verifier on the wire, which is the thing PKCE exists to avoid.`,
    })
  }

  return findings
}

/* ─────────────────────────────────────────────────────────────── JWKS ── */

export interface JsonWebKey {
  kid?: string
  kty: string
  use?: string
  alg?: string
  n?: string
  e?: string
  crv?: string
}

export type KeySelection =
  | { ok: true; key: JsonWebKey }
  | { ok: false; reason: "NO_KEYS" | "KID_NOT_FOUND" | "AMBIGUOUS" | "WRONG_USE"; detail: string }

/**
 * The key a token's `kid` names.
 *
 * When a token names a `kid`, that key or nothing. Falling back to "try them
 * all" is how a rotated-out key keeps working long after it was withdrawn, and
 * it turns key rotation into something that never actually takes effect.
 *
 * When a token names none, exactly one candidate or nothing. A provider
 * publishing several keys and a token identifying none is ambiguous, and
 * guessing is how a token signed by a key we would have rejected gets verified
 * by one we would not have.
 */
export function selectVerificationKey(
  keys: readonly JsonWebKey[],
  token: { kid: string | null },
): KeySelection {
  const signing = keys.filter((key) => key.use === undefined || key.use === "sig")

  if (keys.length === 0) {
    return { ok: false, reason: "NO_KEYS", detail: "The JWKS holds no keys." }
  }
  if (signing.length === 0) {
    return {
      ok: false,
      reason: "WRONG_USE",
      detail: "Every published key is marked for encryption, so none may verify a signature.",
    }
  }

  if (token.kid !== null) {
    const named = signing.filter((key) => key.kid === token.kid)
    if (named.length === 0) {
      return {
        ok: false,
        reason: "KID_NOT_FOUND",
        detail: `No published key has kid ${token.kid}. Trying the others would keep a withdrawn key working and make rotation meaningless.`,
      }
    }
    if (named.length > 1) {
      return {
        ok: false,
        reason: "AMBIGUOUS",
        detail: `${named.length} published keys share kid ${token.kid}, so the token does not identify one.`,
      }
    }
    return { ok: true, key: named[0] }
  }

  if (signing.length > 1) {
    return {
      ok: false,
      reason: "AMBIGUOUS",
      detail: `The token names no kid and ${signing.length} signing keys are published. Guessing would let a token signed by any of them pass as any other.`,
    }
  }
  return { ok: true, key: signing[0] }
}

/* ─────────────────────────────────────────────────── client secrets ── */

export interface ClientSecretReference {
  /** The name in the secret store. Never the value. */
  secretName: string
  /** Which version is live, so a rotation is a version change and not an edit. */
  version: string
  rotatedAt: string | null
}

export class SecretValueError extends Error {
  constructor() {
    super(
      "A client secret is held by reference, never by value. Bible §11: connector setup uses secret " +
        "references and OAuth grants, never raw long-lived credentials in UI state — a value that " +
        "reaches this record reaches every backup, export and log line that touches it.",
    )
    this.name = "SecretValueError"
  }
}

/**
 * Anything that looks like a secret value rather than a name.
 *
 * A name is short, has no whitespace and is not high-entropy base64. This is a
 * shape check and cannot be exhaustive — its purpose is to fail the obvious
 * paste, which is the one that actually happens.
 */
export function assertSecretReference(reference: ClientSecretReference): void {
  const name = reference.secretName
  if (name.length === 0 || name.length > 200) throw new SecretValueError()
  if (/\s/.test(name)) throw new SecretValueError()
  // A base64-ish run of 40+ characters is a secret, not a name.
  if (/[A-Za-z0-9+/_-]{40,}/.test(name)) throw new SecretValueError()
}

/* ────────────────────────────────────────────────── claims mapping ── */

export interface ClaimsMapping {
  /** The claim that stably identifies a person. Never `email`. */
  subjectClaim: string
  emailClaim: string
  displayNameClaim: string | null
}

export type MappingProblem = "EMAIL_AS_SUBJECT" | "MISSING_SUBJECT" | "AUTHORITY_CLAIM"

export interface MappingFinding {
  problem: MappingProblem
  detail: string
}

/**
 * Claims a tenant might try to map, and must not.
 *
 * Bible §9.1: "Cognito Groups are not canonical RBAC", and authority "comes from
 * an active, scoped assignment or explicit delegation, not from a title string,
 * email domain, Cognito group, or UI state."
 *
 * The pressure to do this is real — the provider already knows who the
 * directors are, and mapping the claim is one line. What it buys is a system
 * where anyone who can edit a group at the identity provider can grant
 * themselves authority inside Tenure, with no assignment record, no approval,
 * and nothing in the audit trail but a successful login.
 */
const AUTHORITY_CLAIMS = ["groups", "roles", "role", "permissions", "scope", "isadmin", "admin", "entitlements"]

export function validateClaimsMapping(mapping: ClaimsMapping): readonly MappingFinding[] {
  const findings: MappingFinding[] = []

  if (!mapping.subjectClaim) {
    findings.push({
      problem: "MISSING_SUBJECT",
      detail: "Without a subject claim there is nothing stable to key a person on between sign-ins.",
    })
  }

  // GE-040-002's rule, arriving here: an email address is a label somebody can
  // change, and keying identity on it means a renamed mailbox is a new person
  // — or worse, a reassigned one is the old person.
  if (mapping.subjectClaim && /^email(_verified)?$/i.test(mapping.subjectClaim)) {
    findings.push({
      problem: "EMAIL_AS_SUBJECT",
      detail: "An email address is a label, not an identifier. Keying on it means a renamed mailbox is a new person, and a reassigned one inherits the old person's history.",
    })
  }

  for (const [field, claim] of Object.entries(mapping)) {
    if (typeof claim !== "string") continue
    if (AUTHORITY_CLAIMS.includes(claim.toLowerCase())) {
      findings.push({
        problem: "AUTHORITY_CLAIM",
        detail: `${field} maps "${claim}", which is an authority claim. Authority comes from an active, scoped assignment — not from a group at the identity provider, where anyone who can edit it can grant themselves access with nothing in the audit trail but a successful login.`,
      })
    }
  }

  return findings
}

/* ────────────────────────────────────────────────────────── health ── */

export type HealthState = "HEALTHY" | "DEGRADED" | "FAILING"

export interface HealthReport {
  state: HealthState
  findings: readonly string[]
}

/**
 * Whether a connection would work if somebody tried to sign in right now.
 *
 * `DEGRADED` is a real state and not a hedge: a connection whose JWKS was last
 * fetched two days ago still verifies tokens from the keys it cached, and will
 * keep doing so until the provider rotates. That is worth a warning and is not
 * worth an alarm — and reporting it as `FAILING` is how an operator learns to
 * ignore the alarm.
 */
export function connectionHealth(input: {
  discoveryFindings: readonly DiscoveryFinding[]
  jwksKeyCount: number
  jwksFetchedAt: string | null
  jwksMaxAgeHours: number
  secretVersionLive: boolean
  at: Date
}): HealthReport {
  const findings: string[] = []
  let failing = false

  for (const finding of input.discoveryFindings) {
    findings.push(finding.detail)
    failing = true
  }

  if (input.jwksKeyCount === 0) {
    findings.push("The provider publishes no signing keys, so no token could be verified.")
    failing = true
  }

  if (!input.secretVersionLive) {
    findings.push("The client secret version this connection names is not live in the secret store.")
    failing = true
  }

  if (input.jwksFetchedAt === null) {
    findings.push("The signing keys have never been fetched.")
    failing = true
  } else {
    const age = input.at.getTime() - Date.parse(input.jwksFetchedAt)
    if (Number.isNaN(age)) {
      findings.push("The signing-key fetch time is not a time.")
      failing = true
    } else if (age > input.jwksMaxAgeHours * 3_600_000) {
      findings.push(
        `The signing keys were last fetched ${Math.floor(age / 3_600_000)} hours ago. Cached keys keep ` +
          `working until the provider rotates, and then stop all at once.`,
      )
    }
  }

  if (failing) return { state: "FAILING", findings }
  if (findings.length > 0) return { state: "DEGRADED", findings }
  return { state: "HEALTHY", findings: [] }
}
