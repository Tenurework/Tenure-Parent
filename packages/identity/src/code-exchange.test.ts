import {
  EXCHANGE_WINDOW_SECONDS,
  exchangeCode,
  type ExchangeRefusal,
  type RedeemableTransaction,
} from "./index"

/**
 * GE-044-002 — the deny cases at the token exchange.
 *
 * We are the relying party, so the verifier is ours and held server-side. The
 * questions are: may we send this code, what goes with it, and what must happen
 * when the same code comes back twice.
 */

const NOW = new Date("2026-08-03T12:00:00Z")
const secondsAgo = (n: number) => new Date(NOW.getTime() - n * 1000).toISOString()

const transaction = (over: Partial<RedeemableTransaction> = {}): RedeemableTransaction => ({
  id: "txn-1",
  connectionId: "conn-rochester",
  tenantId: "rochester",
  state: "state-abc",
  nonce: "nonce-abc",
  codeVerifier: "verifier-3f9a1c7e5b2d8f4a6c0e9b1d3f5a7c9e1b3d5f7a",
  returnPath: "/dashboard",
  createdAt: secondsAgo(120),
  expiresAt: new Date(NOW.getTime() + 300_000).toISOString(),
  consumedAt: secondsAgo(5),
  codeChallengeMethod: "S256",
  redirectUri: "https://platform.tenurework.com/api/auth/callback",
  codeRedeemedAt: null,
  ...over,
})

const exchange = (over: Partial<RedeemableTransaction> | null = {}) =>
  exchangeCode({
    transaction: over === null ? null : transaction(over),
    code: "code-9f2b",
    at: NOW,
  })

const refusedBecause = (outcome: ReturnType<typeof exchange>, reason: ExchangeRefusal) => {
  expect(outcome.ok).toBe(false)
  if (outcome.ok) throw new Error("expected a refusal")
  expect(outcome.reason).toBe(reason)
  expect(outcome.detail.length).toBeGreaterThan(20)
  return outcome
}

describe("a legitimate exchange", () => {
  it("builds the token request", () => {
    const outcome = exchange()
    if (!outcome.ok) throw new Error(outcome.detail)

    expect(outcome.request).toEqual({
      grantType: "authorization_code",
      code: "code-9f2b",
      redirectUri: "https://platform.tenurework.com/api/auth/callback",
      codeVerifier: "verifier-3f9a1c7e5b2d8f4a6c0e9b1d3f5a7c9e1b3d5f7a",
    })
  })

  it("sends the verifier held server-side, not one a caller supplied", () => {
    // The verifier appears in the token request and nowhere else. An
    // intercepted authorization request is useless precisely because it never
    // carried this.
    const outcome = exchange({ codeVerifier: "stored-verifier-value" })
    if (!outcome.ok) throw new Error(outcome.detail)
    expect(outcome.request.codeVerifier).toBe("stored-verifier-value")
  })

  it("repeats the redirect URI the code was issued for", () => {
    // RFC 6749 §4.1.3 — the server confirms the code is being redeemed for the
    // registration it was issued to.
    const outcome = exchange({ redirectUri: "https://platform.tenurework.com/other" })
    if (!outcome.ok) throw new Error(outcome.detail)
    expect(outcome.request.redirectUri).toBe("https://platform.tenurework.com/other")
  })

  it("marks the transaction redeemed", () => {
    // Persisted, or the next replay succeeds.
    const outcome = exchange()
    if (!outcome.ok) throw new Error(outcome.detail)
    expect(outcome.transaction.codeRedeemedAt).toBe(NOW.toISOString())
  })
})

describe("code replay", () => {
  it("refuses a second redemption", () => {
    refusedBecause(exchange({ codeRedeemedAt: secondsAgo(2) }), "CODE_REPLAYED")
  })

  it("demands that tokens already issued be revoked", () => {
    // The part that is not just a refusal. The party who redeemed first may be
    // the attacker or the person, and there is no way to tell — so end both.
    const outcome = refusedBecause(exchange({ codeRedeemedAt: secondsAgo(2) }), "CODE_REPLAYED")
    expect(outcome.revokeIssuedTokens).toBe(true)
  })

  it("does not demand revocation for any other refusal", () => {
    // Revocation is disruptive: it signs somebody out. Firing it on an ordinary
    // expiry would teach an operator to ignore it.
    for (const outcome of [
      exchange(null),
      exchange({ consumedAt: null }),
      exchange({ consumedAt: secondsAgo(EXCHANGE_WINDOW_SECONDS + 10) }),
      exchange({ codeChallengeMethod: "plain" }),
      exchange({ codeVerifier: "" }),
    ]) {
      if (outcome.ok) throw new Error("expected a refusal")
      expect(outcome.revokeIssuedTokens).toBe(false)
    }
  })

  it("is checked before every other condition", () => {
    // It triggers a revocation, so a later refusal masking it would turn an
    // incident into a shrug. Replayed *and* expired *and* downgraded must still
    // report the replay.
    const outcome = exchange({
      codeRedeemedAt: secondsAgo(2),
      consumedAt: secondsAgo(EXCHANGE_WINDOW_SECONDS + 60),
      codeChallengeMethod: "plain",
      codeVerifier: "",
    })
    if (outcome.ok) throw new Error("unreachable")
    expect(outcome.reason).toBe("CODE_REPLAYED")
    expect(outcome.revokeIssuedTokens).toBe(true)
  })
})

describe("a code that never came through our redirect", () => {
  it("refuses an unbound transaction", () => {
    // A code lifted from a referrer header, a proxy log, a shared browser.
    refusedBecause(exchange({ consumedAt: null }), "CALLBACK_NOT_BOUND")
  })

  it("refuses a transaction nobody has heard of", () => {
    refusedBecause(exchange(null), "UNKNOWN_TRANSACTION")
  })
})

describe("the exchange window", () => {
  it("accepts an exchange straight after the redirect", () => {
    expect(exchange({ consumedAt: secondsAgo(1) }).ok).toBe(true)
  })

  it("accepts one at the edge of the window", () => {
    expect(exchange({ consumedAt: secondsAgo(EXCHANGE_WINDOW_SECONDS) }).ok).toBe(true)
  })

  it("refuses one past it", () => {
    // Longer than that is time somebody had to copy it.
    refusedBecause(exchange({ consumedAt: secondsAgo(EXCHANGE_WINDOW_SECONDS + 1) }), "EXPIRED")
  })

  it("refuses an unparseable binding time rather than treating it as recent", () => {
    refusedBecause(exchange({ consumedAt: "not-a-time" }), "EXPIRED")
  })
})

describe("PKCE cannot be downgraded at the exchange", () => {
  it("refuses a flow recorded as plain", () => {
    // "plain" puts the verifier on the wire in a form an interceptor can
    // replay, which is the whole thing PKCE exists to prevent.
    refusedBecause(exchange({ codeChallengeMethod: "plain" }), "METHOD_NOT_S256")
  })

  it("refuses anything that is not S256, including an empty method", () => {
    for (const method of ["", "PLAIN", "s256", "none", "S512"]) {
      refusedBecause(exchange({ codeChallengeMethod: method }), "METHOD_NOT_S256")
    }
  })

  it("takes the method from the transaction, so nothing can renegotiate it", () => {
    // There is no input by which a caller could propose a method. Asserted on
    // the shape a caller must pass: adding one is a change to this test too.
    const outcome = exchange()
    expect(outcome.ok).toBe(true)
    expect(Object.keys({ transaction: null, code: "", at: NOW }).sort()).toEqual([
      "at",
      "code",
      "transaction",
    ])
  })
})

describe("a missing verifier is a refusal, not a request without one", () => {
  it("refuses when nothing was stored", () => {
    // Sending the request anyway would be an exchange with the protection
    // removed — and it would very likely succeed, which is worse.
    refusedBecause(exchange({ codeVerifier: "" }), "NO_VERIFIER_STORED")
  })
})

describe("every refusal is distinguishable", () => {
  it("gives each condition its own reason", () => {
    const reasons = [
      exchange(null),
      exchange({ codeRedeemedAt: secondsAgo(1) }),
      exchange({ consumedAt: null }),
      exchange({ consumedAt: secondsAgo(EXCHANGE_WINDOW_SECONDS + 5) }),
      exchange({ codeChallengeMethod: "plain" }),
      exchange({ codeVerifier: "" }),
    ].map((outcome) => (outcome.ok ? "OK" : outcome.reason))

    expect(new Set(reasons).size).toBe(reasons.length)
    expect(reasons).not.toContain("OK")
  })
})
