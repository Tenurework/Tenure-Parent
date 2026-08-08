import {
  borrowProviderCredential,
  providerCredentialStatus,
} from "@/lib/connections/credential-broker"

/**
 * WRK-040-004 — the broker's three properties, each asserted directly.
 *
 * The value is a recognisable literal rather than a plausible key, so a test
 * that found it anywhere it should not be says so unambiguously.
 */
const SECRET = "sk-ant-DO-NOT-LET-THIS-ESCAPE"

const configured = {
  ANTHROPIC_API_KEY: SECRET,
  OKTA_CLIENT_SECRET: SECRET,
} as const

/** Every string reachable from a value, however deeply. */
function reachableStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") return [value]
  if (typeof value === "function") return [String(value)]
  if (value === null || typeof value !== "object") return []
  if (seen.has(value)) return []
  seen.add(value)
  return Object.values(value as Record<string, unknown>).flatMap((v) => reachableStrings(v, seen))
}

describe("borrowProviderCredential", () => {
  it("hands the secret to the callback and returns the callback's answer", () => {
    const borrowed = borrowProviderCredential("anthropic-api-key", configured)
    if (!borrowed.ok) throw new Error(`expected a borrow, got ${borrowed.reason}`)

    // The whole point: the value is only ever an argument.
    const seen = borrowed.use((secret) => secret.slice(0, 6))
    expect(seen).toBe("sk-ant")
  })

  it("never lets the value escape the call", () => {
    // The assertion the "return the string instead of a capability" mutation
    // reds. It walks EVERYTHING reachable from the returned object — own
    // properties, nested objects, and the source text of any function — so a
    // broker that returned `{ ok: true, secret }`, or one that closed over the
    // value in a getter, fails here rather than in review.
    const borrowed = borrowProviderCredential("anthropic-api-key", configured)
    if (!borrowed.ok) throw new Error(`expected a borrow, got ${borrowed.reason}`)

    const escaped = reachableStrings(borrowed).filter((s) => s.includes(SECRET))
    expect(escaped).toEqual([])
    expect(JSON.stringify(borrowed)).not.toContain(SECRET)

    // And the capability still works, so the test above cannot pass by the
    // broker simply refusing everything.
    expect(borrowed.use((s) => s)).toBe(SECRET)
  })

  it("supports an async caller without forcing a sync one to fake it", () => {
    // `src/lib/ai.ts` awaits a fetch inside `use`; `src/lib/auth.ts` builds a
    // NextAuth provider synchronously inside it at module load. A signature
    // fixed to `Promise<T>` would have left the second call site outside the
    // door.
    const borrowed = borrowProviderCredential("okta-client-secret", configured)
    if (!borrowed.ok) throw new Error(`expected a borrow, got ${borrowed.reason}`)

    const sync = borrowed.use((secret) => ({ clientSecret: secret }))
    expect(sync.clientSecret).toBe(SECRET)

    return borrowed.use(async (secret) => secret.length).then((n) => {
      expect(n).toBe(SECRET.length)
    })
  })

  it("refuses a deployment that has no credential", () => {
    const borrowed = borrowProviderCredential("anthropic-api-key", {})
    expect(borrowed.ok).toBe(false)
    if (borrowed.ok) return
    expect(borrowed.reason).toBe("not-configured")
  })

  it("refuses a reference that is a pasted value rather than a reference", () => {
    // The identity registry's own rule — "a real secret does not look like an
    // ARN" — reached through `credentialReferenceProblems`, not restated here.
    const borrowed = borrowProviderCredential("anthropic-api-key", {
      ...configured,
      ANTHROPIC_API_KEY_REF: SECRET,
    })
    expect(borrowed.ok).toBe(false)
    if (borrowed.ok) return
    expect(borrowed.reason).toBe("unreferenced")
  })

  it("accepts the two reference shapes the registry accepts", () => {
    for (const ref of [
      "/tenure/anthropic/api-key",
      "arn:aws:secretsmanager:us-east-1:1234:secret:tenure/anthropic",
    ]) {
      const borrowed = borrowProviderCredential("anthropic-api-key", {
        ...configured,
        ANTHROPIC_API_KEY_REF: ref,
      })
      expect(borrowed.ok).toBe(true)
    }
  })

  it("refuses an expired credential, by the registry's expiry rule", () => {
    const at = new Date("2026-08-07T00:00:00.000Z")
    const borrowed = borrowProviderCredential(
      "okta-client-secret",
      { ...configured, OKTA_CLIENT_SECRET_EXPIRES_AT: "2026-07-01T00:00:00.000Z" },
      at,
    )
    expect(borrowed.ok).toBe(false)
    if (borrowed.ok) return
    expect(borrowed.reason).toBe("expired")
  })

  it("does not refuse a credential that expires soon", () => {
    // `connectionHealth` calls this EXPIRING_SOON, and it works today. Refusing
    // it would take working sign-in away to prevent a future problem — the same
    // call `oktaIsUsable` makes.
    const at = new Date("2026-08-07T00:00:00.000Z")
    const borrowed = borrowProviderCredential(
      "okta-client-secret",
      { ...configured, OKTA_CLIENT_SECRET_EXPIRES_AT: "2026-08-12T00:00:00.000Z" },
      at,
    )
    expect(borrowed.ok).toBe(true)
  })

  it("treats an unreadable expiry as expired rather than ignoring it", () => {
    // Inherited from `connectionHealth`, deliberately: a credential whose
    // expiry nobody can parse is one nobody can promise works. Asserted here
    // because it is the behaviour a second, hand-written expiry rule would get
    // wrong.
    const borrowed = borrowProviderCredential("anthropic-api-key", {
      ...configured,
      ANTHROPIC_API_KEY_EXPIRES_AT: "not a date",
    })
    expect(borrowed.ok).toBe(false)
    if (borrowed.ok) return
    expect(borrowed.reason).toBe("expired")
  })
})

describe("providerCredentialStatus", () => {
  it("answers whether a capability is usable without handing anything over", () => {
    const status = providerCredentialStatus("anthropic-api-key", configured)
    expect(status).toEqual({ usable: true, reason: "ok", expiresAt: null })
    expect(reachableStrings(status).some((s) => s.includes(SECRET))).toBe(false)
  })

  it("names the refusal, so a surface can say 'expired' rather than 'not connected'", () => {
    const status = providerCredentialStatus("anthropic-api-key", {})
    expect(status.usable).toBe(false)
    expect(status.reason).toBe("not-configured")
  })
})
