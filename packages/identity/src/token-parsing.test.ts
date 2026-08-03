import {
  MAX_TOKEN_BYTES,
  parseCompactToken,
  validateIdToken,
  type ParseRefusal,
} from "./index"

/**
 * GE-044-003 — malformed tokens deny safely.
 *
 * This is the boundary where bytes an attacker chose become objects the rest of
 * the system reads. Its one job is to never throw and never return something
 * that only looks parsed: a callback route with a garbage token must produce a
 * refusal, not a stack trace.
 */

const b64 = (value: unknown) =>
  Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url")

const compact = (header: unknown, claims: unknown, signature = "c2ln") =>
  `${b64(header)}.${b64(claims)}.${signature}`

const refusedBecause = (token: unknown, reason: ParseRefusal) => {
  const outcome = parseCompactToken(token)
  expect(outcome.ok).toBe(false)
  if (outcome.ok) throw new Error("expected a refusal")
  expect(outcome.reason).toBe(reason)
  expect(outcome.detail.length).toBeGreaterThan(15)
}

describe("a well-formed token parses", () => {
  it("returns the header and claims", () => {
    const outcome = parseCompactToken(
      compact({ alg: "RS256", kid: "k1" }, { iss: "https://idp.test", sub: "abc" }),
    )
    if (!outcome.ok) throw new Error(outcome.detail)

    expect(outcome.parsed.header.alg).toBe("RS256")
    expect(outcome.parsed.header.kid).toBe("k1")
    expect(outcome.parsed.claims.iss).toBe("https://idp.test")
  })

  it("accepts base64url without padding, which is the only legal form", () => {
    // A JWS segment never carries `=`. Accepting padding would be tolerating a
    // token no compliant issuer emits.
    const token = compact({ alg: "RS256" }, { sub: "a" })
    expect(token).not.toContain("=")
    expect(parseCompactToken(token).ok).toBe(true)
  })
})

describe("nothing throws, whatever arrives", () => {
  it("refuses every shape of rubbish without raising", () => {
    // The property the callback route depends on. Asserted as "does not throw"
    // separately from the reasons, because a parser that threw on one input in
    // twenty would still pass a test that only checked reasons.
    for (const input of [
      "",
      ".",
      "..",
      "a.b",
      "a.b.c.d",
      "not a token at all",
      " . . ",
      "eyJ.eyJ.",
      null,
      undefined,
      42,
      {},
      [],
      Buffer.from("binary"),
    ]) {
      expect(() => parseCompactToken(input)).not.toThrow()
      expect(parseCompactToken(input).ok).toBe(false)
    }
  })

  it("refuses a non-string without inspecting it", () => {
    refusedBecause(null, "WRONG_SEGMENT_COUNT")
    refusedBecause({ alg: "RS256" }, "WRONG_SEGMENT_COUNT")
  })
})

describe("size is checked before anything is spent", () => {
  it("refuses a token past the limit", () => {
    // Without this, the cost of a request is chosen by whoever sent it.
    const huge = `${"A".repeat(MAX_TOKEN_BYTES + 1)}.b.c`
    refusedBecause(huge, "TOO_LARGE")
  })

  it("measures bytes, not characters", () => {
    // A token of multi-byte characters is bigger than it looks, and a length
    // check on `.length` would let it through at three times the limit.
    const multibyte = "é".repeat(MAX_TOKEN_BYTES - 100)
    expect(multibyte.length).toBeLessThan(MAX_TOKEN_BYTES)
    refusedBecause(multibyte, "TOO_LARGE")
  })

  it("accepts a large but legitimate token", () => {
    // A token with many group claims is real. Refusing it would break a
    // customer rather than an attacker.
    const claims = { sub: "a", groups: Array.from({ length: 200 }, (_, i) => `group-${i}`) }
    const token = compact({ alg: "RS256" }, claims)
    expect(Buffer.byteLength(token)).toBeGreaterThan(2000)
    expect(parseCompactToken(token).ok).toBe(true)
  })

  it("refuses on size before reporting a structural problem", () => {
    // Ordering matters: decoding a hundred megabytes to discover it has two
    // segments is the denial of service, not the diagnosis.
    refusedBecause("A".repeat(MAX_TOKEN_BYTES + 1), "TOO_LARGE")
  })
})

describe("segment count", () => {
  it("refuses two segments", () => {
    refusedBecause("a.b", "WRONG_SEGMENT_COUNT")
  })

  it("refuses four segments", () => {
    refusedBecause("a.b.c.d", "WRONG_SEGMENT_COUNT")
  })

  it("names an encrypted token as what it is", () => {
    // Five segments is JWE — a valid thing that is not a signed token.
    // "Wrong segment count" would send somebody looking for a typo.
    refusedBecause("a.b.c.d.e", "ENCRYPTED_TOKEN")
  })

  it("refuses an empty signature segment", () => {
    // `alg: none` tokens are exactly this shape. Refusing at the parse boundary
    // means the unsigned token never becomes an object some later branch reads.
    refusedBecause(`${b64({ alg: "none" })}.${b64({ sub: "a" })}.`, "WRONG_SEGMENT_COUNT")
  })
})

describe("base64url is checked, because the decoder will not", () => {
  it("refuses a segment with characters outside the alphabet", () => {
    // Node's decoder ignores stray characters rather than failing, so a lenient
    // parse reads something the signer never signed.
    refusedBecause(`${b64({ alg: "RS256" })}!.${b64({ sub: "a" })}.c2ln`, "NOT_BASE64URL")
  })

  it("refuses standard base64 with + and /", () => {
    const standard = Buffer.from(JSON.stringify({ alg: "RS256", x: "??>>" })).toString("base64")
    if (!/[+/=]/.test(standard)) throw new Error("fixture does not exercise the case")
    refusedBecause(`${standard}.${b64({ sub: "a" })}.c2ln`, "NOT_BASE64URL")
  })

  it("refuses a padded segment", () => {
    refusedBecause(`${b64({ alg: "RS256" })}==.${b64({ sub: "a" })}.c2ln`, "NOT_BASE64URL")
  })

  it("checks the signature segment too", () => {
    refusedBecause(`${b64({ alg: "RS256" })}.${b64({ sub: "a" })}.not+base64url`, "NOT_BASE64URL")
  })
})

describe("what decodes has to be a JSON object", () => {
  it("refuses a header that is not JSON", () => {
    refusedBecause(`${b64("not json")}.${b64({ sub: "a" })}.c2ln`, "NOT_JSON")
  })

  it("refuses a payload that is not JSON", () => {
    refusedBecause(`${b64({ alg: "RS256" })}.${b64("{oops")}.c2ln`, "NOT_JSON")
  })

  it("refuses an array, which JSON.parse accepts", () => {
    // `[]` reaches the validator as something whose every claim is undefined,
    // and every check that only rejects a *wrong* value quietly passes.
    refusedBecause(`${b64({ alg: "RS256" })}.${b64([])}.c2ln`, "NOT_AN_OBJECT")
    refusedBecause(`${b64([])}.${b64({ sub: "a" })}.c2ln`, "NOT_AN_OBJECT")
  })

  it("refuses null, which is typeof object", () => {
    refusedBecause(`${b64({ alg: "RS256" })}.${b64(null)}.c2ln`, "NOT_AN_OBJECT")
  })

  it("refuses a bare string or number", () => {
    refusedBecause(`${b64({ alg: "RS256" })}.${b64(42)}.c2ln`, "NOT_AN_OBJECT")
  })
})

describe("an algorithm has to be declared", () => {
  it("refuses a header with no alg", () => {
    // Assuming one would be choosing on behalf of a token that declined to say.
    refusedBecause(compact({ kid: "k1" }, { sub: "a" }), "NO_ALGORITHM")
  })

  it("refuses an alg that is not a string", () => {
    refusedBecause(compact({ alg: 256 }, { sub: "a" }), "NO_ALGORITHM")
    refusedBecause(compact({ alg: null }, { sub: "a" }), "NO_ALGORITHM")
  })

  it("refuses an empty alg", () => {
    refusedBecause(compact({ alg: "" }, { sub: "a" }), "NO_ALGORITHM")
  })

  it("does not judge which algorithm, only that there is one", () => {
    // The parser's job is structure. `validateIdToken` decides whether the
    // algorithm is acceptable, and it must be the one place that does.
    expect(parseCompactToken(compact({ alg: "none" }, { sub: "a" })).ok).toBe(true)
    expect(parseCompactToken(compact({ alg: "HS256" }, { sub: "a" })).ok).toBe(true)
  })
})

describe("the parser hands the validator something it can refuse", () => {
  const NOW = new Date("2026-08-03T12:00:00Z")

  it("an alg:none token parses and is then refused on the algorithm", () => {
    // The two halves working together: structure here, policy there. A parser
    // that judged algorithms would put the decision in two places.
    const outcome = parseCompactToken(compact({ alg: "none" }, { iss: "https://idp.test", sub: "a" }))
    if (!outcome.ok) throw new Error(outcome.detail)

    const verdict = validateIdToken({
      token: "irrelevant",
      parsed: outcome.parsed,
      expected: {
        issuer: "https://idp.test",
        clientId: "client-1",
        algorithm: "RS256",
        requiredScopes: [],
        nonce: "n",
      },
      at: NOW,
      // Would accept anything. The algorithm check must refuse before it runs —
      // and if it does not, this test says so.
      verify: () => true,
    })

    expect(verdict.valid).toBe(false)
    if (verdict.valid) throw new Error("unreachable")
    expect(verdict.reason).toBe("ALGORITHM_NOT_ALLOWED")
  })
})

describe("every refusal is distinguishable", () => {
  it("gives each malformation its own reason", () => {
    // One reason for everything would make the audit trail useless at exactly
    // the moment somebody is reading it after an incident.
    const reasons = [
      parseCompactToken("A".repeat(MAX_TOKEN_BYTES + 1)),
      parseCompactToken("a.b"),
      parseCompactToken("a.b.c.d.e"),
      parseCompactToken(`${b64({ alg: "RS256" })}!.${b64({ sub: "a" })}.c2ln`),
      parseCompactToken(`${b64("nope")}.${b64({ sub: "a" })}.c2ln`),
      parseCompactToken(`${b64({ alg: "RS256" })}.${b64([])}.c2ln`),
      parseCompactToken(compact({ kid: "k" }, { sub: "a" })),
    ].map((outcome) => (outcome.ok ? "OK" : outcome.reason))

    expect(new Set(reasons).size).toBe(reasons.length)
    expect(reasons).not.toContain("OK")
  })
})

/**
 * GE-044-003 names "pool" and "region" as separate dimensions from "issuer".
 *
 * For a Cognito deployment they are not separate values — they are *inside* the
 * issuer, which has the shape `https://<service>.<region>.<provider>/<poolId>`.
 * So the question is whether the issuer comparison is exact enough that a
 * different pool in the same region, or the same pool id in a different region,
 * is refused. A `startsWith` or an `includes` would accept both, and both would
 * be tokens from a real service signed by a real key.
 *
 * The fixtures use a neutral host with that structure rather than the real
 * provider's. `tests/architecture/forbidden-clients.test.mjs` keeps provider
 * endpoints out of everything but their adapter, and its exemption list is
 * ratcheted at zero — so the honest move is to not need an exemption, not to
 * raise the ratchet. The shape is what these tests are about; the vendor is
 * not.
 */
describe("a token from the wrong pool or region is refused", () => {
  const NOW = new Date("2026-08-03T12:00:00Z")
  const OURS = "https://idp-service.us-east-1.provider.test/us-east-1_OurPool"

  const validateWithIssuer = (issuer: string) =>
    validateIdToken({
      token: "irrelevant",
      parsed: {
        header: { alg: "RS256" },
        claims: {
          iss: issuer,
          aud: "client-1",
          sub: "user-1",
          token_use: "id",
          nonce: "n",
          iat: Math.floor(NOW.getTime() / 1000) - 10,
          exp: Math.floor(NOW.getTime() / 1000) + 600,
        },
      },
      expected: {
        issuer: OURS,
        clientId: "client-1",
        algorithm: "RS256",
        requiredScopes: [],
        nonce: "n",
      },
      at: NOW,
      verify: () => true,
    })

  it("accepts our own issuer, so the refusals below are not blanket", () => {
    expect(validateWithIssuer(OURS).valid).toBe(true)
  })

  it("refuses a different pool in the same region", () => {
    // Same AWS service, same region, real key, different customer.
    const other = "https://idp-service.us-east-1.provider.test/us-east-1_OtherPool"
    const verdict = validateWithIssuer(other)
    expect(verdict.valid).toBe(false)
    if (verdict.valid) throw new Error("unreachable")
    expect(verdict.reason).toBe("ISSUER_MISMATCH")
  })

  it("refuses the same pool id in a different region", () => {
    const elsewhere = "https://idp-service.us-west-2.provider.test/us-east-1_OurPool"
    expect(validateWithIssuer(elsewhere).valid).toBe(false)
  })

  it("refuses an issuer that merely starts with ours", () => {
    // What a `startsWith` comparison would accept.
    expect(validateWithIssuer(`${OURS}.evil.test`).valid).toBe(false)
    expect(validateWithIssuer(`${OURS}/extra`).valid).toBe(false)
  })

  it("refuses an issuer that merely contains ours", () => {
    // What an `includes` comparison would accept.
    expect(validateWithIssuer(`https://evil.test/?u=${OURS}`).valid).toBe(false)
  })

  it("refuses a host that differs only by a lookalike label", () => {
    expect(
      validateWithIssuer("https://idp-service.us-east-1.provider.test.evil.test/us-east-1_OurPool").valid,
    ).toBe(false)
  })
})
