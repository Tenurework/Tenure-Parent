import { digestsEqual } from "./assurance"

/**
 * GE-042-002 — starting an authorization, so the callback can be trusted.
 *
 * Bible §9.1: "Web authentication uses Authorization Code + PKCE and a
 * backend-for-frontend session… Every callback validates state, nonce, PKCE,
 * issuer, signature, time, token use, client/audience, scopes, connection,
 * return path, and single use."
 *
 * This is the half that happens *before* the redirect. Everything the callback
 * checks has to be decided and recorded here, because a callback can only
 * verify what the request committed to — which is why the transaction is the
 * unit rather than a bag of loose parameters.
 *
 * ## Each value has one job, and sharing them collapses the protection
 *
 * `state`, `nonce` and the PKCE verifier defend against three different
 * attacks, and the tempting simplification — generate one random value and use
 * it for all three — quietly removes two of them:
 *
 *   * **state** binds the callback to *this browser's* request. It is compared
 *     server-side against the stored transaction, so a callback delivered to a
 *     victim's browser with an attacker's code does not match.
 *   * **nonce** binds the eventual ID token to this request, and is checked
 *     inside the signed token (GE-042-003). State cannot do this: it never
 *     enters the token.
 *   * **verifier** proves the party redeeming the code is the party that
 *     started it. It is the only one of the three the authorization server ever
 *     hashes.
 *
 * Reusing one value for two of these means an attacker who learns it — from a
 * referrer header, a log, a redirect chain — defeats both.
 *
 * ## S256, never `plain`
 *
 * RFC 7636 permits `plain`, where the challenge *is* the verifier. That defends
 * against nothing: anyone who can intercept the authorization request can read
 * the verifier out of it. `CHALLENGE_METHOD` is a constant for that reason, and
 * there is no parameter to change it.
 */

/** The only challenge method this implementation will produce or accept. */
export const CHALLENGE_METHOD = "S256" as const

/** RFC 7636 §4.1: 43–128 characters from the unreserved set. */
export const VERIFIER_MIN_LENGTH = 43
export const VERIFIER_MAX_LENGTH = 128
const UNRESERVED = /^[A-Za-z0-9\-._~]+$/

export interface VerifierProblem {
  field: string
  detail: string
}

/**
 * Whether a code verifier is one.
 *
 * Length is a security parameter, not a formatting rule: 43 unreserved
 * characters is where RFC 7636 puts the entropy floor, and a short verifier is
 * one an attacker can search. Checked rather than assumed because the verifier
 * is supplied by the caller — this package has no CSPRNG of its own.
 */
export function validateVerifier(verifier: string): readonly VerifierProblem[] {
  const problems: VerifierProblem[] = []
  if (verifier.length < VERIFIER_MIN_LENGTH || verifier.length > VERIFIER_MAX_LENGTH) {
    problems.push({
      field: "verifier",
      detail: `A code verifier is ${VERIFIER_MIN_LENGTH}–${VERIFIER_MAX_LENGTH} characters. This one is ${verifier.length}, and a short verifier is one an attacker can search.`,
    })
  }
  if (!UNRESERVED.test(verifier)) {
    problems.push({
      field: "verifier",
      detail: "A code verifier uses only unreserved characters, or it will not survive being put in a URL.",
    })
  }
  return problems
}

export type ReturnPathRefusal =
  | "NOT_RELATIVE"
  | "PROTOCOL_RELATIVE"
  | "HAS_SCHEME"
  | "TRAVERSAL"
  | "CONTROL_CHARACTER"

export interface ReturnPathVerdict {
  ok: boolean
  reason: ReturnPathRefusal | null
  detail: string
}

/**
 * Whether a return path is somewhere on this site.
 *
 * This is the open-redirect defence, and it is a denylist of shapes rather than
 * a URL parse because the browser's parser is the one that matters and it is
 * more forgiving than any library:
 *
 *   * `//evil.example` is **protocol-relative**. It looks like a path, starts
 *     with a slash, and browsers navigate to another origin. This is the one
 *     that gets shipped.
 *   * `/\evil.example` — browsers normalise a backslash to a slash, so this is
 *     the same attack wearing a different character.
 *   * `https://evil.example` has a scheme, and a check that only looked for a
 *     leading `/` would already have rejected it; a check that looked for
 *     "contains ://" would miss `javascript:alert(1)`.
 *   * `/../../` traversal cannot leave the origin, but it can leave the
 *     *area* a return path was meant to stay in, and it is never legitimate in
 *     a value the server generated.
 *   * A newline or NUL can split a header in a response that echoes it.
 *
 * Decoded once before checking, because `%2F%2Fevil.example` is `//evil.example`
 * to anything that decodes it later, and something always does.
 */
export function validateReturnPath(path: string): ReturnPathVerdict {
  const decoded = safeDecode(path)

  if (/[\u0000-\u001F\u007F]/.test(decoded)) {
    return { ok: false, reason: "CONTROL_CHARACTER", detail: "A return path cannot contain control characters." }
  }

  // A scheme, checked before the leading-slash rule so `javascript:` is named
  // for what it is rather than reported as "not relative".
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(decoded.trim())) {
    return { ok: false, reason: "HAS_SCHEME", detail: "A return path is a path on this site, not a URL." }
  }

  if (!decoded.startsWith("/")) {
    return { ok: false, reason: "NOT_RELATIVE", detail: "A return path must begin with a single /." }
  }

  // Protocol-relative, including the backslash forms browsers normalise.
  if (/^\/[/\\]/.test(decoded)) {
    return {
      ok: false,
      reason: "PROTOCOL_RELATIVE",
      detail: "A path beginning // or /\\ is another origin as far as a browser is concerned.",
    }
  }

  if (decoded.split(/[?#]/)[0].split("/").includes("..")) {
    return { ok: false, reason: "TRAVERSAL", detail: "A return path does not contain .. segments." }
  }

  return { ok: true, reason: null, detail: "" }
}

/** Decode once, and treat a malformed encoding as itself rather than throwing. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export interface AuthorizationTransaction {
  id: string
  /** The connection this started on. The callback must come back through it. */
  connectionId: string
  tenantId: string
  /** Compared against the callback's, in constant time. */
  state: string
  /** Checked inside the signed ID token by GE-042-003. */
  nonce: string
  /** Held server-side; sent only when redeeming the code. */
  codeVerifier: string
  /** Where to go afterwards. Already validated. */
  returnPath: string
  createdAt: string
  expiresAt: string
  /** Set the first time it is used. Single-use is enforced on this. */
  consumedAt: string | null
}

export interface AuthorizationRequest {
  /** What goes in the redirect. The verifier is deliberately absent. */
  responseType: "code"
  clientId: string
  redirectUri: string
  scope: string
  state: string
  nonce: string
  codeChallenge: string
  codeChallengeMethod: typeof CHALLENGE_METHOD
}

export interface BeginProblem {
  field: string
  detail: string
}

export interface BeginRefused {
  ok: false
  problems: readonly BeginProblem[]
}

export interface BeginStarted {
  ok: true
  transaction: AuthorizationTransaction
  request: AuthorizationRequest
}

export type BeginOutcome = BeginStarted | BeginRefused

export interface BeginInput {
  transactionId: string
  connectionId: string
  tenantId: string
  clientId: string
  redirectUri: string
  scope: string
  returnPath: string
  /** Three distinct random values, from the caller's CSPRNG. */
  state: string
  nonce: string
  codeVerifier: string
  /** How long the person has to complete sign-in. */
  lifetimeSeconds: number
  at: Date
}

/**
 * The S256 challenge, from an injected hash.
 *
 * Injected rather than imported, for the same reason `digestsEqual` takes
 * digests: `node:crypto` in this package would drag it into any browser bundle
 * that imports the package, and `packages/platform-config` already records that
 * lesson twice. The caller supplies base64url-encoded SHA-256; this module owns
 * the rule that it must be SHA-256 and never `plain`.
 */
export type Sha256Base64Url = (input: string) => string

export function beginAuthorization(input: BeginInput, sha256: Sha256Base64Url): BeginOutcome {
  const problems: BeginProblem[] = [...validateVerifier(input.codeVerifier)]

  const path = validateReturnPath(input.returnPath)
  if (!path.ok) problems.push({ field: "returnPath", detail: path.detail })

  // Distinct values, checked rather than assumed. Generating one random value
  // and using it for two of these removes the protection of both, and it is the
  // simplification somebody makes while tidying.
  const values = [input.state, input.nonce, input.codeVerifier]
  if (new Set(values).size !== values.length) {
    problems.push({
      field: "state",
      detail:
        "state, nonce and the code verifier must be three different values. Each defends against a " +
        "different attack, and an attacker who learns a shared one defeats both.",
    })
  }
  for (const [field, value] of [["state", input.state], ["nonce", input.nonce]] as const) {
    if (value.length < 16) {
      problems.push({ field, detail: `${field} is too short to be unguessable.` })
    }
  }

  if (input.lifetimeSeconds <= 0) {
    problems.push({ field: "lifetimeSeconds", detail: "A transaction that has already expired cannot be completed." })
  }

  if (problems.length > 0) return { ok: false, problems }

  return {
    ok: true,
    transaction: {
      id: input.transactionId,
      connectionId: input.connectionId,
      tenantId: input.tenantId,
      state: input.state,
      nonce: input.nonce,
      codeVerifier: input.codeVerifier,
      returnPath: input.returnPath,
      createdAt: input.at.toISOString(),
      expiresAt: new Date(input.at.getTime() + input.lifetimeSeconds * 1000).toISOString(),
      consumedAt: null,
    },
    request: {
      responseType: "code",
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      scope: input.scope,
      state: input.state,
      nonce: input.nonce,
      // The challenge goes out; the verifier stays here. Sending the verifier
      // would make PKCE a formality.
      codeChallenge: sha256(input.codeVerifier),
      codeChallengeMethod: CHALLENGE_METHOD,
    },
  }
}

export type CallbackRefusal =
  | "UNKNOWN_TRANSACTION"
  | "ALREADY_USED"
  | "EXPIRED"
  | "STATE_MISMATCH"
  | "WRONG_CONNECTION"

export interface CallbackRefused {
  accepted: false
  reason: CallbackRefusal
  /** One message for every cause. The reason is for the log. */
  detail: string
}

export interface CallbackAccepted {
  accepted: true
  /** The verifier to redeem the code with. */
  codeVerifier: string
  /** The nonce GE-042-003 must find inside the ID token. */
  nonce: string
  returnPath: string
  /** The transaction, consumed. Persist this or the single-use rule is a comment. */
  transaction: AuthorizationTransaction
}

export type CallbackOutcome = CallbackAccepted | CallbackRefused

/** One message whatever failed. Which check fired is not the caller's business. */
export const SAFE_CALLBACK_MESSAGE = "That sign-in attempt is no longer valid. Please start again."

export interface CallbackInput {
  state: string
  /** The connection the callback actually arrived through. */
  connectionId: string
  at: Date
}

/**
 * Bind a callback to the transaction that started it.
 *
 * Order is deliberate: consumed and expired before the state comparison, so a
 * spent transaction cannot be used to grind at `state`. The state comparison is
 * constant-time for the same reason a verification code's is — it is a secret
 * being compared against attacker-supplied input.
 */
export function bindCallback(
  transaction: AuthorizationTransaction | null,
  callback: CallbackInput,
): CallbackOutcome {
  if (!transaction) {
    return { accepted: false, reason: "UNKNOWN_TRANSACTION", detail: SAFE_CALLBACK_MESSAGE }
  }
  if (transaction.consumedAt !== null) {
    return { accepted: false, reason: "ALREADY_USED", detail: SAFE_CALLBACK_MESSAGE }
  }

  const expires = Date.parse(transaction.expiresAt)
  if (Number.isNaN(expires) || callback.at.getTime() >= expires) {
    return { accepted: false, reason: "EXPIRED", detail: SAFE_CALLBACK_MESSAGE }
  }

  if (!digestsEqual(transaction.state, callback.state)) {
    return { accepted: false, reason: "STATE_MISMATCH", detail: SAFE_CALLBACK_MESSAGE }
  }

  // The connection the callback arrived through must be the one it started on.
  // Without this, a tenant with two connections lets an assertion minted by the
  // weaker one satisfy a request that chose the stronger.
  if (transaction.connectionId !== callback.connectionId) {
    return { accepted: false, reason: "WRONG_CONNECTION", detail: SAFE_CALLBACK_MESSAGE }
  }

  return {
    accepted: true,
    codeVerifier: transaction.codeVerifier,
    nonce: transaction.nonce,
    returnPath: transaction.returnPath,
    transaction: { ...transaction, consumedAt: callback.at.toISOString() },
  }
}
