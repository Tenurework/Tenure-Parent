import type { IdentityAssertion } from "./keying"

/**
 * GE-041-001 — what Tenure needs from an identity provider, in Tenure's words.
 *
 * Bible §9.1: "Amazon Cognito authenticates and federates. Tenure resolves the
 * person, tenant membership, identity connection, active assignments, policies,
 * and session." The division is the whole design — the provider proves who
 * somebody is, and Tenure decides what that means. This is the seam.
 *
 * ## Nothing here is an AWS concept
 *
 * No user pool, no app client, no `AdminGetUser`, no tokens. Those are how one
 * provider happens to work, and Bible §"Cells" is explicit that "region, pool,
 * database, bucket, search index, issuer, callback, KMS key, and service
 * endpoint are never globally hard-coded in business modules". A port that
 * mentioned a user pool would put Cognito's shape into every caller and make
 * the sharded/tenant/dedicated pool strategies of GE-041-002 a rewrite rather
 * than a configuration change.
 *
 * The test of whether this port is honest is that a SAML-only deployment with
 * no AWS account could implement it. It can: every type below is either a
 * Tenure entity or a string Tenure defined.
 *
 * ## Why an interface with no implementation is not speculative here
 *
 * There is no Cognito adapter yet — the AWS Organization does not exist. What
 * exists today, and what makes this worth writing before the adapter, is
 * `tests/security/provider-independence.test.mjs`: it refuses a Cognito SDK
 * import anywhere outside an adapter directory, and refuses provider vocabulary
 * in business modules. The rule is far cheaper to hold now, with zero
 * violations, than to retrofit across GE-041-002 through GE-041-005 once the
 * adapter exists and its types have spread.
 */

/**
 * An in-flight authentication.
 *
 * `transaction` is opaque to the browser and meaningful only to the server that
 * issued it. Bible §9.1 requires the login resolver to return "safe branding and
 * allowed methods through an opaque transaction" and to "never reveal whether a
 * person exists" — an identifier the client can decode is one that can be probed.
 */
export interface AuthenticationStart {
  /** Where to send the browser. The provider's URL; Tenure does not build it. */
  redirectTo: string
  /** Opaque handle the callback presents back. Never a person, never an email. */
  transaction: string
}

/** What the callback presents. Deliberately not "code" — not every provider has one. */
export interface AuthenticationCallback {
  transaction: string
  /** Whatever the provider returned, unparsed. The adapter owns its shape. */
  payload: Readonly<Record<string, string>>
}

export type AuthenticationFailure =
  | "TRANSACTION_UNKNOWN"
  | "TRANSACTION_REPLAYED"
  | "TRANSACTION_EXPIRED"
  | "VERIFICATION_FAILED"
  | "PROVIDER_UNAVAILABLE"

export interface AuthenticationVerified {
  ok: true
  /**
   * The provider's claim about who this is.
   *
   * An assertion, not a session and not a person. Turning it into either is
   * Tenure's job (`resolveAssertion`), and keeping that on this side of the
   * seam is what stops a provider's opinion becoming an authorization decision.
   */
  assertion: IdentityAssertion
}

export interface AuthenticationRejected {
  ok: false
  failure: AuthenticationFailure
  /** Safe to show. Never distinguishes "no such person" from "wrong password". */
  detail: string
}

export type AuthenticationResult = AuthenticationVerified | AuthenticationRejected

/** A person as a provider holds them, for lifecycle operations only. */
export interface ProviderAccount {
  /** The provider's opaque subject. The only stable handle a provider offers. */
  subject: string
  /** What the provider asserts. Display only — never a key (GE-040-002). */
  email: string | null
  emailVerified: boolean
  /** Whether the provider will currently let them in. */
  enabled: boolean
}

/**
 * The operations Tenure needs, and no others.
 *
 * Every method takes a `connectionId` because a connection is the tenant's
 * decision to trust an issuer, and it is the unit that GE-041-002's pool
 * strategies resolve. A port whose methods took a pool id would have baked one
 * strategy in.
 */
export interface IdentityProvider {
  /** The provider family this implements — for diagnostics, never for branching. */
  readonly kind: string

  /** Begin authentication for a connection. */
  beginAuthentication(input: {
    connectionId: string
    /** Where to return to afterwards. Validated by the adapter against its allowlist. */
    returnPath: string
  }): Promise<AuthenticationStart>

  /** Verify a callback and produce an assertion, or reject it. */
  completeAuthentication(callback: AuthenticationCallback): Promise<AuthenticationResult>

  /**
   * End the provider's own session for a subject.
   *
   * Tenure's session invalidation (GE-040-005) does not depend on this — it
   * recomputes on every request and does not ask the provider. This exists so a
   * revocation also ends the provider-side session, and a caller that cannot
   * reach the provider must still consider the Tenure session revoked.
   */
  endProviderSession(input: { connectionId: string; subject: string }): Promise<void>

  /** SCIM lifecycle. Absent when the connection does not support provisioning. */
  readAccount?(input: { connectionId: string; subject: string }): Promise<ProviderAccount | null>
  disableAccount?(input: { connectionId: string; subject: string }): Promise<void>
}

/**
 * Claims a provider may assert that Tenure ignores.
 *
 * Bible §9.1: "Cognito Groups are not canonical RBAC", and §"Decisions": authority
 * "comes from an active, scoped assignment or explicit delegation, not from a
 * title string, email domain, Cognito group, or UI state."
 *
 * Named here so the rule has somewhere to live and something to test against.
 * The failure this prevents is not somebody deciding groups should be
 * authoritative — it is somebody reading `claims.groups` because it is right
 * there in the token and saves a query.
 */
export const IGNORED_CLAIMS = ["groups", "cognito:groups", "roles", "cognito:roles", "custom:role"] as const

/**
 * Strip claims Tenure must not act on.
 *
 * Returns what is left, so an adapter can pass through a provider's extra
 * claims for display without any of them reaching an authorization path.
 */
export function withoutIgnoredClaims(
  claims: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const kept: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(claims)) {
    if ((IGNORED_CLAIMS as readonly string[]).includes(key)) continue
    kept[key] = value
  }
  return kept
}
