import type { AuthorizationTransaction } from "./authorization-request"

/**
 * GE-044-002 — redeeming an authorization code, from the relying party's side.
 *
 * `bindCallback` (GE-042-002) decides whether the *redirect* may be believed:
 * the transaction exists, the state matches, it has not been consumed, it has
 * not expired. This is the step after — taking the code to the token endpoint —
 * and it is a different decision with different failures.
 *
 * ## We are the client, not the authorization server
 *
 * A first draft of this module asked the caller to present a `code_verifier` and
 * compared it against a stored challenge. That is what an authorization server
 * does. Tenure is the relying party: `AuthorizationTransaction` already holds
 * `codeVerifier` **server-side**, deliberately, and the exchange is us sending
 * it onward. There is no client to distrust here, because we are it.
 *
 * So the questions this answers are ours: may we send this code at all, what do
 * we send with it, and what must happen if the same code comes back twice.
 *
 * ## Code replay is not callback replay
 *
 * `consumedAt` stops a second *callback*. It says nothing about a code lifted
 * from a redirect — out of a referrer header, a proxy log, a shared browser —
 * and taken to the token endpoint. RFC 6749 §4.1.2 makes a code single-use and
 * says a server seeing a second redemption should revoke everything issued for
 * the first, because two redemptions mean two parties hold it and there is no
 * way to tell which one was the person.
 *
 * That is why `CODE_REPLAYED` carries `revokeIssuedTokens`. Refusing the second
 * exchange while leaving the first party's session running protects nobody if
 * the first party was the attacker.
 */

export type ExchangeRefusal =
  | "UNKNOWN_TRANSACTION"
  | "CODE_REPLAYED"
  | "CALLBACK_NOT_BOUND"
  | "EXPIRED"
  | "NO_VERIFIER_STORED"
  | "METHOD_NOT_S256"

export interface ExchangeRefused {
  ok: false
  reason: ExchangeRefusal
  detail: string
  /**
   * Whether tokens already issued against this code must be revoked.
   *
   * True only for a replay. The party who redeemed first may be the attacker or
   * the person, and there is no way to tell — so the safe act is to end both and
   * make them sign in again.
   */
  revokeIssuedTokens: boolean
}

/** What we send to the token endpoint. The verifier appears here and nowhere else. */
export interface TokenRequest {
  grantType: "authorization_code"
  code: string
  redirectUri: string
  codeVerifier: string
}

export interface ExchangeAccepted {
  ok: true
  request: TokenRequest
  /** The transaction, marked redeemed. Persist it or the next replay succeeds. */
  transaction: RedeemableTransaction
}

export type ExchangeOutcome = ExchangeAccepted | ExchangeRefused

export interface RedeemableTransaction extends AuthorizationTransaction {
  /** The method this flow began with. Never renegotiated. */
  codeChallengeMethod: string
  /** Where the code came back to, repeated at the token endpoint per §4.1.3. */
  redirectUri: string
  /** Set when a code was redeemed. A second attempt is a replay. */
  codeRedeemedAt: string | null
}

export interface ExchangeInput {
  transaction: RedeemableTransaction | null
  /** The code from the callback. */
  code: string
  at: Date
}

function refuse(reason: ExchangeRefusal, detail: string, revokeIssuedTokens = false): ExchangeRefused {
  return { ok: false, reason, detail, revokeIssuedTokens }
}

/** How long a code may sit between the redirect and the exchange. */
export const EXCHANGE_WINDOW_SECONDS = 60

/**
 * Decide whether a code may be exchanged, and build the request.
 *
 * Replay is checked before anything else. It is the condition that most needs
 * to be reported accurately — it triggers a revocation — and a later refusal
 * masking it would turn an incident into a shrug.
 */
export function exchangeCode(input: ExchangeInput): ExchangeOutcome {
  const { transaction, at } = input

  if (!transaction) {
    return refuse(
      "UNKNOWN_TRANSACTION",
      "No transaction matches this code. It was never started here, or it has been cleaned up.",
    )
  }

  if (transaction.codeRedeemedAt !== null) {
    return refuse(
      "CODE_REPLAYED",
      `This code was already redeemed at ${transaction.codeRedeemedAt}. Two redemptions mean two parties ` +
        `hold it and there is no way to tell which was the person, so everything issued for it is revoked.`,
      true,
    )
  }

  if (transaction.consumedAt === null) {
    // A code arriving at the exchange without having come through our callback
    // is a code lifted from somewhere — a referrer header, a proxy log, a
    // shared browser.
    return refuse(
      "CALLBACK_NOT_BOUND",
      "This code never came back through the redirect it was issued for, so nothing ties it to a browser that started here.",
    )
  }

  const bound = Date.parse(transaction.consumedAt)
  if (Number.isNaN(bound) || at.getTime() - bound > EXCHANGE_WINDOW_SECONDS * 1000) {
    return refuse(
      "EXPIRED",
      `A code must be exchanged within ${EXCHANGE_WINDOW_SECONDS} seconds of the redirect. Longer than that is time somebody had to copy it.`,
    )
  }

  // Never renegotiated at the exchange. `plain` sends the verifier in a form an
  // interceptor can replay, which is the whole thing PKCE exists to prevent —
  // and a downgrade is only ever proposed by something that is not us.
  if (transaction.codeChallengeMethod !== "S256") {
    return refuse(
      "METHOD_NOT_S256",
      `This flow recorded ${transaction.codeChallengeMethod}. Only S256 is exchanged: "plain" puts the verifier on the wire, which is what PKCE exists to avoid.`,
    )
  }

  if (!transaction.codeVerifier) {
    // The verifier is held server-side and sent only here. Without it there is
    // nothing to prove the code belongs to the flow we started, and sending the
    // request anyway would be an exchange with the protection removed.
    return refuse(
      "NO_VERIFIER_STORED",
      "No code verifier was stored for this transaction, so the exchange cannot prove the code belongs to the flow we started.",
    )
  }

  return {
    ok: true,
    request: {
      grantType: "authorization_code",
      code: input.code,
      redirectUri: transaction.redirectUri,
      codeVerifier: transaction.codeVerifier,
    },
    transaction: { ...transaction, codeRedeemedAt: at.toISOString() },
  }
}
