import {
  CHALLENGE_METHOD,
  SAFE_CALLBACK_MESSAGE,
  VERIFIER_MAX_LENGTH,
  VERIFIER_MIN_LENGTH,
  beginAuthorization,
  bindCallback,
  validateReturnPath,
  validateVerifier,
  type AuthorizationTransaction,
  type BeginInput,
} from "./index"

/**
 * GE-042-002 — starting an authorization, so the callback can be trusted.
 *
 * A callback can only verify what the request committed to, so everything
 * GE-042-003 checks has to be decided here. Most of these tests are about the
 * three values that must stay distinct, and about the return path — which is
 * where open redirects actually ship.
 */

const NOW = new Date("2026-08-02T12:00:00Z")

/**
 * A stand-in for SHA-256 that does not echo its input.
 *
 * The first version returned `s256(${input})`, and the assertion that the
 * verifier never reaches the request caught it — correctly. A fake hash that
 * contains its input is not a hash, and using one here would have made that
 * assertion untestable while looking like it passed.
 */
const fakeSha256 = (input: string) =>
  [...input].reduce((hash, ch) => (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0, 7).toString(36)

const VERIFIER = "a".repeat(64)

const input = (over: Partial<BeginInput> = {}): BeginInput => ({
  transactionId: "txn-1",
  connectionId: "conn-saml",
  tenantId: "tnt-rochester",
  clientId: "client-abc",
  redirectUri: "https://platform.tenurework.com/auth/callback",
  scope: "openid profile email",
  returnPath: "/dashboard",
  state: "state-0123456789abcdef",
  nonce: "nonce-0123456789abcdef",
  codeVerifier: VERIFIER,
  lifetimeSeconds: 600,
  at: NOW,
  ...over,
})

describe("a return path is a path on this site", () => {
  it("accepts ordinary paths, with query and fragment", () => {
    for (const path of ["/", "/dashboard", "/orgs/chess?tab=finance", "/a/b#section"]) {
      expect(validateReturnPath(path).ok).toBe(true)
    }
  })

  it("refuses a protocol-relative path", () => {
    // The one that gets shipped: it looks like a path, starts with a slash, and
    // browsers navigate to another origin.
    const verdict = validateReturnPath("//evil.example/steal")
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toBe("PROTOCOL_RELATIVE")
  })

  it("refuses the backslash forms browsers normalise", () => {
    for (const path of ["/\\evil.example", "/\\/evil.example"]) {
      expect(validateReturnPath(path).ok).toBe(false)
    }
  })

  it("refuses an absolute URL and a javascript: URL", () => {
    // A check for "contains ://" would miss the second one entirely.
    expect(validateReturnPath("https://evil.example").reason).toBe("HAS_SCHEME")
    expect(validateReturnPath("javascript:alert(1)").reason).toBe("HAS_SCHEME")
    expect(validateReturnPath("  javascript:alert(1)").reason).toBe("HAS_SCHEME")
  })

  it("refuses an encoded protocol-relative path", () => {
    // %2F%2Fevil.example is //evil.example to anything that decodes it later,
    // and something always does.
    expect(validateReturnPath("%2F%2Fevil.example").ok).toBe(false)
    expect(validateReturnPath("%2f%2fevil.example").ok).toBe(false)
  })

  it("refuses a path that looks relative until it is decoded", () => {
    // The case that actually needs the decode. `%2F%2Fevil.example` is rejected
    // either way — it does not start with a slash — so a mutation that skipped
    // decoding survived on it. `/%2F%2Fevil.example` does start with a slash,
    // and without decoding it passes every check and redirects off-site.
    expect(validateReturnPath("/%2F%2Fevil.example").reason).toBe("PROTOCOL_RELATIVE")
    expect(validateReturnPath("/%5Cevil.example").reason).toBe("PROTOCOL_RELATIVE")
    expect(validateReturnPath("/%2e%2e/admin").reason).toBe("TRAVERSAL")
  })

  it("refuses traversal segments", () => {
    expect(validateReturnPath("/orgs/../../admin").reason).toBe("TRAVERSAL")
    expect(validateReturnPath("/..").reason).toBe("TRAVERSAL")
  })

  it("does not mistake a filename containing dots for traversal", () => {
    // `..` is a segment, not a substring. Rejecting `/report..pdf` would be a
    // guard that fires on correct input, which is how guards get removed.
    expect(validateReturnPath("/files/report..pdf").ok).toBe(true)
    expect(validateReturnPath("/a..b/c").ok).toBe(true)
  })

  it("refuses control characters, which can split a header", () => {
    expect(validateReturnPath("/dash\nSet-Cookie:x=1").reason).toBe("CONTROL_CHARACTER")
    expect(validateReturnPath("/dash\u0000").reason).toBe("CONTROL_CHARACTER")
  })

  it("refuses anything that is not a path at all", () => {
    expect(validateReturnPath("dashboard").reason).toBe("NOT_RELATIVE")
    expect(validateReturnPath("").reason).toBe("NOT_RELATIVE")
  })

  it("treats a malformed encoding as itself rather than throwing", () => {
    expect(() => validateReturnPath("/%E0%A4%A")).not.toThrow()
  })
})

describe("the verifier is a security parameter, not a format", () => {
  it("accepts a well-formed verifier", () => {
    expect(validateVerifier(VERIFIER)).toEqual([])
  })

  it("refuses one below the entropy floor", () => {
    expect(validateVerifier("a".repeat(VERIFIER_MIN_LENGTH - 1))).not.toEqual([])
  })

  it("refuses one above the maximum", () => {
    expect(validateVerifier("a".repeat(VERIFIER_MAX_LENGTH + 1))).not.toEqual([])
  })

  it("refuses characters that will not survive a URL", () => {
    expect(validateVerifier("a".repeat(60) + "/+=")).not.toEqual([])
  })
})

describe("three values, three jobs", () => {
  it("starts an authorization and keeps the verifier out of the request", () => {
    // Sending the verifier would make PKCE a formality.
    const outcome = beginAuthorization(input(), fakeSha256)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.request.codeChallenge).toBe(fakeSha256(VERIFIER))
    expect(outcome.request.codeChallengeMethod).toBe("S256")
    expect(JSON.stringify(outcome.request)).not.toContain(VERIFIER)
    expect(outcome.transaction.codeVerifier).toBe(VERIFIER)
  })

  it("only ever uses S256", () => {
    // RFC 7636 permits `plain`, where the challenge IS the verifier — which
    // defends against nothing. There is no parameter to change it.
    expect(CHALLENGE_METHOD).toBe("S256")
    const outcome = beginAuthorization(input(), fakeSha256)
    if (!outcome.ok) return
    expect(outcome.request.codeChallengeMethod).not.toBe("plain")
  })

  it("refuses to reuse one random value for two purposes", () => {
    // The simplification somebody makes while tidying. An attacker who learns
    // a shared value defeats both protections.
    for (const collision of [
      { state: "same-value-0123456789", nonce: "same-value-0123456789" },
      { state: VERIFIER, codeVerifier: VERIFIER },
    ]) {
      const outcome = beginAuthorization(input(collision), fakeSha256)
      expect(outcome.ok).toBe(false)
      if (outcome.ok) continue
      expect(outcome.problems.map((p) => p.detail).join(" ")).toMatch(/three different values/)
    }
  })

  it("refuses a guessable state or nonce", () => {
    expect(beginAuthorization(input({ state: "abc" }), fakeSha256).ok).toBe(false)
    expect(beginAuthorization(input({ nonce: "abc" }), fakeSha256).ok).toBe(false)
  })

  it("refuses a bad return path before redirecting anywhere", () => {
    const outcome = beginAuthorization(input({ returnPath: "//evil.example" }), fakeSha256)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.problems.map((p) => p.field)).toContain("returnPath")
  })

  it("refuses a transaction that has already expired", () => {
    expect(beginAuthorization(input({ lifetimeSeconds: 0 }), fakeSha256).ok).toBe(false)
  })

  it("reports every problem, not the first", () => {
    const outcome = beginAuthorization(input({ codeVerifier: "short", returnPath: "//evil", state: "x" }), fakeSha256)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.problems.length).toBeGreaterThanOrEqual(3)
  })
})

describe("a callback is bound to the transaction that started it", () => {
  const transaction = (over: Partial<AuthorizationTransaction> = {}): AuthorizationTransaction => {
    const outcome = beginAuthorization(input(), fakeSha256)
    if (!outcome.ok) throw new Error("fixture failed to start")
    return { ...outcome.transaction, ...over }
  }

  it("accepts a matching callback and hands back what redemption needs", () => {
    const result = bindCallback(transaction(), { state: input().state, connectionId: "conn-saml", at: NOW })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.codeVerifier).toBe(VERIFIER)
    expect(result.nonce).toBe(input().nonce)
    expect(result.returnPath).toBe("/dashboard")
  })

  it("consumes the transaction in the returned record", () => {
    // Persist this or the single-use rule is a comment.
    const result = bindCallback(transaction(), { state: input().state, connectionId: "conn-saml", at: NOW })
    if (!result.accepted) return
    expect(result.transaction.consumedAt).toBe(NOW.toISOString())
  })

  it("refuses a second use", () => {
    const spent = transaction({ consumedAt: NOW.toISOString() })
    const result = bindCallback(spent, { state: input().state, connectionId: "conn-saml", at: NOW })
    expect(result.accepted).toBe(false)
    if (result.accepted) return
    expect(result.reason).toBe("ALREADY_USED")
  })

  it("refuses a mismatched state", () => {
    const result = bindCallback(transaction(), { state: "attacker-supplied", connectionId: "conn-saml", at: NOW })
    expect(result.accepted).toBe(false)
    if (result.accepted) return
    expect(result.reason).toBe("STATE_MISMATCH")
  })

  it("refuses a callback that arrived through a different connection", () => {
    // Without this, a tenant with two connections lets an assertion minted by
    // the weaker one satisfy a request that chose the stronger.
    const result = bindCallback(transaction(), { state: input().state, connectionId: "conn-other", at: NOW })
    expect(result.accepted).toBe(false)
    if (result.accepted) return
    expect(result.reason).toBe("WRONG_CONNECTION")
  })

  it("refuses an expired transaction", () => {
    const late = new Date(NOW.getTime() + 601_000)
    const result = bindCallback(transaction(), { state: input().state, connectionId: "conn-saml", at: late })
    expect(result.accepted).toBe(false)
    if (result.accepted) return
    expect(result.reason).toBe("EXPIRED")
  })

  it("refuses an unknown transaction", () => {
    const result = bindCallback(null, { state: "anything", connectionId: "conn-saml", at: NOW })
    expect(result.accepted).toBe(false)
    if (result.accepted) return
    expect(result.reason).toBe("UNKNOWN_TRANSACTION")
  })

  it("checks expiry before the state comparison", () => {
    // Separate from the consumed case: moving the expiry check below the state
    // comparison survived a mutation, because the consumed fixture never
    // reached it. An expired transaction must be an equally poor oracle.
    const late = new Date(NOW.getTime() + 601_000)
    const right = bindCallback(transaction(), { state: input().state, connectionId: "conn-saml", at: late })
    const wrong = bindCallback(transaction(), { state: "nope", connectionId: "conn-saml", at: late })
    if (right.accepted || wrong.accepted) throw new Error("expected both to fail")
    expect(right.reason).toBe("EXPIRED")
    expect(right.reason).toBe(wrong.reason)
  })

  it("compares state in constant time", () => {
    // Timing is not observable from a unit test, so this is asserted on the
    // source: a `!==` on a secret exits at the first differing byte, and the
    // timing of that exit is measurable across enough attempts.
    // Matched loosely on the name, because the compiled output namespaces the
    // import — `(0, assurance_1.digestsEqual)(...)` — so the literal call shape
    // is a compilation detail. The second assertion is the one that matters:
    // a direct comparison of the two secrets must not appear.
    const compiled = bindCallback.toString()
    expect(compiled).toMatch(/digestsEqual/)
    expect(compiled).not.toMatch(/transaction\.state\s*!==\s*callback\.state/)
  })

  it("checks consumed before the state comparison", () => {
    // So a spent transaction cannot be used to grind at state: the correct
    // state against a consumed transaction must be indistinguishable from a
    // wrong one.
    const spent = transaction({ consumedAt: NOW.toISOString() })
    const right = bindCallback(spent, { state: input().state, connectionId: "conn-saml", at: NOW })
    const wrong = bindCallback(spent, { state: "nope", connectionId: "conn-saml", at: NOW })
    expect(right.accepted).toBe(false)
    expect(wrong.accepted).toBe(false)
    if (right.accepted || wrong.accepted) return
    expect(right.reason).toBe(wrong.reason)
  })

  it("says one thing to the caller whatever failed", () => {
    const failures = [
      bindCallback(null, { state: "x", connectionId: "conn-saml", at: NOW }),
      bindCallback(transaction(), { state: "wrong", connectionId: "conn-saml", at: NOW }),
      bindCallback(transaction(), { state: input().state, connectionId: "other", at: NOW }),
      bindCallback(transaction({ consumedAt: NOW.toISOString() }), { state: input().state, connectionId: "conn-saml", at: NOW }),
    ]
    const details = new Set(failures.map((f) => (f.accepted ? "accepted" : f.detail)))
    expect(details).toEqual(new Set([SAFE_CALLBACK_MESSAGE]))
  })

  it("keeps the causes distinct for the log", () => {
    const reasons = [
      bindCallback(null, { state: "x", connectionId: "conn-saml", at: NOW }),
      bindCallback(transaction(), { state: "wrong", connectionId: "conn-saml", at: NOW }),
      bindCallback(transaction(), { state: input().state, connectionId: "other", at: NOW }),
      bindCallback(transaction({ consumedAt: NOW.toISOString() }), { state: input().state, connectionId: "conn-saml", at: NOW }),
    ].map((f) => (f.accepted ? "accepted" : f.reason))
    expect(new Set(reasons).size).toBe(4)
  })
})
