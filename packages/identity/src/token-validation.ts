/**
 * GE-042-003 — validating what comes back, before believing any of it.
 *
 * Bible §9.1: "Every callback validates state, nonce, PKCE, issuer, signature,
 * time, token use, client/audience, scopes, connection, return path, and single
 * use." GE-042-002 covers state, PKCE, connection, return path and single use —
 * the things the *request* committed to. This is the token half.
 *
 * ## The algorithm is ours to choose, never the token's
 *
 * Two of the best-known authentication failures are both the same mistake:
 * letting a value inside the token decide how the token is checked.
 *
 *   * **`alg: none`.** The header says the token is unsigned, a library that
 *     honours it skips verification, and every claim is attacker-controlled.
 *   * **Algorithm confusion.** The header says `HS256` where the issuer uses
 *     `RS256`, so a verifier that reads `alg` and picks a method HMACs the
 *     token with the *public* key — which is public.
 *
 * Both are closed the same way: `ALLOWED_ALGORITHMS` is checked **before** the
 * signature is verified, and the algorithm passed to the verifier is the one
 * from the connection, not the one from the header. A header that disagrees is
 * a refusal, not an instruction.
 *
 * ## Order is a security property here
 *
 * Cheap structural checks run before the signature; the signature runs before
 * any claim is believed. A validator that reads `iss` to pick a key before
 * verifying is choosing a key on the attacker's say-so, and one that reports
 * "wrong audience" for an unsigned token has told the attacker their forgery
 * parses.
 */

/** Asymmetric only. A symmetric algorithm plus a published key is a forgery. */
export const ALLOWED_ALGORITHMS = ["RS256", "RS384", "RS512", "ES256", "ES384"] as const
export type AllowedAlgorithm = (typeof ALLOWED_ALGORITHMS)[number]

/** Tolerance for clock drift between us and the issuer. */
export const CLOCK_SKEW_SECONDS = 60

export interface TokenHeader {
  alg: string
  kid?: string
  typ?: string
}

export interface TokenClaims {
  iss?: string
  aud?: string | readonly string[]
  /** Present when `aud` has more than one value. OIDC requires it then. */
  azp?: string
  exp?: number
  nbf?: number
  iat?: number
  nonce?: string
  /** Cognito's marker. `id` or `access` — an access token is not an identity. */
  token_use?: string
  scope?: string
  sub?: string
  [claim: string]: unknown
}

export interface ParsedToken {
  header: TokenHeader
  claims: TokenClaims
}

/** What the connection says to expect. None of it comes from the token. */
export interface ExpectedToken {
  issuer: string
  clientId: string
  /** The algorithm this connection signs with. The header does not get a vote. */
  algorithm: AllowedAlgorithm
  /** Scopes the application requires. All must be present. */
  requiredScopes: readonly string[]
  /** The nonce from the transaction (GE-042-002). */
  nonce: string
}

export type TokenRefusal =
  | "ALGORITHM_NOT_ALLOWED"
  | "ALGORITHM_MISMATCH"
  | "SIGNATURE_INVALID"
  | "ISSUER_MISMATCH"
  | "AUDIENCE_MISMATCH"
  | "AUTHORIZED_PARTY_MISMATCH"
  | "NOT_AN_ID_TOKEN"
  | "EXPIRED"
  | "NOT_YET_VALID"
  | "ISSUED_IN_FUTURE"
  | "NO_EXPIRY"
  | "NONCE_MISMATCH"
  | "SCOPE_MISSING"
  | "REPLAYED"

export interface TokenRejected {
  valid: false
  reason: TokenRefusal
  /** One message for the person. The reason is for the log. */
  detail: string
}

export interface TokenAccepted {
  valid: true
  claims: TokenClaims
  /** The subject, which is the only identity claim callers should use. */
  subject: string
}

export type TokenOutcome = TokenAccepted | TokenRejected

/** One message whatever failed. Which check fired is not the caller's business. */
export const SAFE_TOKEN_MESSAGE = "That sign-in could not be completed. Please start again."

const reject = (reason: TokenRefusal): TokenRejected => ({
  valid: false,
  reason,
  detail: SAFE_TOKEN_MESSAGE,
})

/**
 * Verify a signature. Injected, like every other primitive in this package.
 *
 * Takes the algorithm to use as a *parameter* rather than reading it from the
 * token, which is the whole point: a verifier that decides for itself is one
 * that can be told what to decide.
 */
export type VerifySignature = (input: { token: string; algorithm: AllowedAlgorithm; kid?: string }) => boolean

/** Nonces already seen. Replay is a property of history, not of one token. */
export type SeenNonce = (nonce: string) => boolean

export interface ValidateInput {
  /** The raw compact token, for the verifier. */
  token: string
  parsed: ParsedToken
  expected: ExpectedToken
  at: Date
  verify: VerifySignature
  seenNonce?: SeenNonce
}

export function validateIdToken(input: ValidateInput): TokenOutcome {
  const { parsed, expected, at } = input
  const { header, claims } = parsed

  // ── Algorithm, before anything reads a claim ─────────────────────────────
  //
  // An `alg: none` token must never reach a verifier, and a header claiming a
  // symmetric algorithm must never select one. Both checks are here, above the
  // signature, because after it they would be checking a token we had already
  // decided to trust.
  if (!(ALLOWED_ALGORITHMS as readonly string[]).includes(header.alg)) {
    return reject("ALGORITHM_NOT_ALLOWED")
  }
  if (header.alg !== expected.algorithm) {
    return reject("ALGORITHM_MISMATCH")
  }

  // ── Signature, before any claim is believed ──────────────────────────────
  //
  // The algorithm handed to the verifier is the connection's, not the header's.
  // `kid` is passed through as a hint for key selection only — a verifier that
  // trusts an unknown kid is choosing a key on the attacker's say-so, which is
  // its problem to refuse, and this contract does not let it be told the alg.
  if (!input.verify({ token: input.token, algorithm: expected.algorithm, kid: header.kid })) {
    return reject("SIGNATURE_INVALID")
  }

  // ── Issuer ───────────────────────────────────────────────────────────────
  //
  // Exact. A trailing slash is a different issuer as far as this is concerned:
  // normalising it would be guessing at which of two issuers a token came from,
  // and the guess is the vulnerability.
  if (claims.iss !== expected.issuer) return reject("ISSUER_MISMATCH")

  // ── Audience, and the party authorised when there is more than one ───────
  const audiences = claims.aud === undefined ? [] : Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!audiences.includes(expected.clientId)) return reject("AUDIENCE_MISMATCH")

  // OIDC requires `azp` when `aud` has several values, and it must be us.
  // Without this, a token issued for a different client that merely *lists* us
  // is accepted — which is how one tenant's application borrows another's.
  if (audiences.length > 1 && claims.azp !== expected.clientId) {
    return reject("AUTHORIZED_PARTY_MISMATCH")
  }

  // ── Token use ────────────────────────────────────────────────────────────
  //
  // An access token is a capability, not a statement about who somebody is.
  // Accepting one here is how an access token minted for an unrelated scope
  // becomes a sign-in.
  if (claims.token_use !== undefined && claims.token_use !== "id") return reject("NOT_AN_ID_TOKEN")
  if (header.typ !== undefined && header.typ.toLowerCase() === "at+jwt") return reject("NOT_AN_ID_TOKEN")

  // ── Time ─────────────────────────────────────────────────────────────────
  const now = Math.floor(at.getTime() / 1000)

  // A token with no expiry never stops being valid. Absent is refused rather
  // than treated as "no limit", which is the reading that makes it permanent.
  if (typeof claims.exp !== "number") return reject("NO_EXPIRY")
  if (now > claims.exp + CLOCK_SKEW_SECONDS) return reject("EXPIRED")
  if (typeof claims.nbf === "number" && now < claims.nbf - CLOCK_SKEW_SECONDS) return reject("NOT_YET_VALID")
  if (typeof claims.iat === "number" && now < claims.iat - CLOCK_SKEW_SECONDS) return reject("ISSUED_IN_FUTURE")

  // ── Nonce, which is what ties this token to our request ──────────────────
  if (typeof claims.nonce !== "string" || claims.nonce !== expected.nonce) {
    return reject("NONCE_MISMATCH")
  }
  // Replay. The nonce is single-use across the whole issuer, not merely within
  // one transaction — a token replayed into a *different* transaction would
  // otherwise pass every check above.
  if (input.seenNonce?.(claims.nonce)) return reject("REPLAYED")

  // ── Scopes ───────────────────────────────────────────────────────────────
  if (expected.requiredScopes.length > 0) {
    const granted = new Set(typeof claims.scope === "string" ? claims.scope.split(/\s+/).filter(Boolean) : [])
    if (!expected.requiredScopes.every((scope) => granted.has(scope))) return reject("SCOPE_MISSING")
  }

  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    // No subject is no identity. Reported as an audience-class failure rather
    // than inventing a code, because a token this malformed did not come from
    // a conforming issuer at all.
    return reject("AUDIENCE_MISMATCH")
  }

  return { valid: true, claims, subject: claims.sub }
}

/**
 * The order the checks run in, for the test that asserts it.
 *
 * Exported because ordering *is* the security property and asserting it from
 * outside means reading the source. A validator that reports "wrong audience"
 * for an unsigned token has told an attacker their forgery parses.
 */
export const CHECK_ORDER: readonly TokenRefusal[] = [
  "ALGORITHM_NOT_ALLOWED",
  "ALGORITHM_MISMATCH",
  "SIGNATURE_INVALID",
  "ISSUER_MISMATCH",
  "AUDIENCE_MISMATCH",
  "AUTHORIZED_PARTY_MISMATCH",
  "NOT_AN_ID_TOKEN",
  "NO_EXPIRY",
  "EXPIRED",
  "NOT_YET_VALID",
  "ISSUED_IN_FUTURE",
  "NONCE_MISMATCH",
  "REPLAYED",
  "SCOPE_MISSING",
]
