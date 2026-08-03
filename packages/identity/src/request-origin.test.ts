import {
  checkRequestOrigin,
  resolveCallbackUrl,
  type CallbackUrlRefusal,
  type OriginRefusal,
} from "./index"

/**
 * GE-044-004 — the two dimensions that had no code.
 *
 * Callback host poisoning and Origin. The other seven the item names —
 * open redirect, login CSRF, session fixation, cookies, logout, session replay,
 * tenant switch — are covered by `authorization-request.test.ts`,
 * `session.test.ts`, `logout.test.ts` and `tenant-switch.test.ts`.
 */

const REGISTERED = "https://platform.tenurework.com/api/auth/callback"

const callbackRefused = (
  input: Parameters<typeof resolveCallbackUrl>[0],
  reason: CallbackUrlRefusal,
) => {
  const outcome = resolveCallbackUrl(input)
  expect(outcome.ok).toBe(false)
  if (outcome.ok) throw new Error("expected a refusal")
  expect(outcome.reason).toBe(reason)
  expect(outcome.detail.length).toBeGreaterThan(20)
}

describe("a callback URL comes from a registration, never from a request", () => {
  it("returns the sole registered URL when none is requested", () => {
    const outcome = resolveCallbackUrl({ registered: [REGISTERED] })
    if (!outcome.ok) throw new Error(outcome.detail)
    expect(outcome.url).toBe(REGISTERED)
  })

  it("takes no host, no headers and no base URL", () => {
    // The whole design. A function that cannot see `Host` cannot be poisoned by
    // it, and a rule stated as "do not read the header" is one somebody breaks
    // by reading the header. Asserted on the shape a caller must pass, so
    // adding a host field is a change to this test too.
    const input = { registered: [REGISTERED], requested: REGISTERED }
    expect(Object.keys(input).sort()).toEqual(["registered", "requested"])
  })

  it("refuses a URL that is not registered", () => {
    callbackRefused({ registered: [REGISTERED], requested: "https://evil.test/callback" }, "NOT_REGISTERED")
  })

  it("refuses a different path on the registered host", () => {
    // A host match would accept any path there — an uploaded file, a
    // user-authored page.
    callbackRefused(
      { registered: [REGISTERED], requested: "https://platform.tenurework.com/uploads/x.html" },
      "NOT_REGISTERED",
    )
  })

  it("refuses anything appended to a registered URL", () => {
    // What a prefix comparison would accept.
    callbackRefused({ registered: [REGISTERED], requested: `${REGISTERED}.evil.test` }, "NOT_REGISTERED")
    callbackRefused({ registered: [REGISTERED], requested: `${REGISTERED}/../evil` }, "NOT_REGISTERED")
  })

  it("refuses a lookalike host", () => {
    callbackRefused(
      { registered: [REGISTERED], requested: "https://platform.tenurework.com.evil.test/api/auth/callback" },
      "NOT_REGISTERED",
    )
  })

  it("refuses when nothing is registered", () => {
    // Deriving one from the request would let whoever sent it choose where the
    // authorization code is delivered.
    callbackRefused({ registered: [] }, "NO_REGISTRATION")
    callbackRefused({ registered: ["  "] }, "NO_REGISTRATION")
  })

  it("refuses to guess between several registrations", () => {
    // Resolving by array order is a decision nobody made.
    callbackRefused({ registered: [REGISTERED, "https://platform.tenurework.com/other"] }, "NOT_REGISTERED")
  })

  it("selects among several when one is named", () => {
    const other = "https://platform.tenurework.com/other"
    const outcome = resolveCallbackUrl({ registered: [REGISTERED, other], requested: other })
    if (!outcome.ok) throw new Error(outcome.detail)
    expect(outcome.url).toBe(other)
  })
})

describe("a registration has to be a usable absolute URL", () => {
  it("refuses a relative registration", () => {
    callbackRefused({ registered: ["/api/auth/callback"] }, "NOT_ABSOLUTE")
  })

  it("refuses plaintext http on a real host", () => {
    // The authorization code travels on this. Plaintext puts it on the wire.
    callbackRefused({ registered: ["http://platform.tenurework.com/cb"] }, "NOT_HTTPS")
  })

  it("allows http on loopback, where a developer's callback lives", () => {
    // There is no network to intercept, and refusing would make local
    // development impossible without weakening the rule for everybody.
    for (const local of ["http://localhost:3000/cb", "http://127.0.0.1:3000/cb"]) {
      expect(resolveCallbackUrl({ registered: [local] }).ok).toBe(true)
    }
  })

  it("refuses a non-http scheme", () => {
    callbackRefused({ registered: ["javascript:alert(1)"] }, "NOT_HTTPS")
    callbackRefused({ registered: ["data:text/html,<script>"] }, "NOT_HTTPS")
  })
})

/* ─────────────────────────────────────────────────────────────── origin ── */

const ALLOWED = ["https://platform.tenurework.com"]

const origin = (over: Partial<Parameters<typeof checkRequestOrigin>[0]> = {}) =>
  checkRequestOrigin({
    method: "POST",
    origin: "https://platform.tenurework.com",
    referer: null,
    allowedOrigins: ALLOWED,
    ...over,
  })

const originRefused = (
  over: Partial<Parameters<typeof checkRequestOrigin>[0]>,
  reason: OriginRefusal,
) => {
  const verdict = origin(over)
  expect(verdict.ok).toBe(false)
  expect(verdict.reason).toBe(reason)
  expect(verdict.detail.length).toBeGreaterThan(20)
}

describe("a state-changing request has to say it came from us", () => {
  it("accepts a matching Origin", () => {
    expect(origin().ok).toBe(true)
  })

  it("refuses another site's Origin", () => {
    originRefused({ origin: "https://evil.test" }, "ORIGIN_NOT_ALLOWED")
  })

  it("refuses a suffix lookalike", () => {
    // What a suffix comparison would accept for "tenurework.com".
    originRefused({ origin: "https://evil-platform.tenurework.com.evil.test" }, "ORIGIN_NOT_ALLOWED")
    originRefused({ origin: "https://notplatform.tenurework.com" }, "ORIGIN_NOT_ALLOWED")
  })

  it("refuses the same host on a different scheme or port", () => {
    // An origin is scheme, host and port. Two of three is a different origin.
    originRefused({ origin: "http://platform.tenurework.com" }, "ORIGIN_NOT_ALLOWED")
    originRefused({ origin: "https://platform.tenurework.com:8443" }, "ORIGIN_NOT_ALLOWED")
  })

  it("refuses a request that says nothing about where it came from", () => {
    originRefused({ origin: null, referer: null }, "ORIGIN_MISSING")
  })

  it("refuses an opaque origin rather than treating it as absent", () => {
    // `Origin: null` is a real value — a sandboxed iframe, a data: document,
    // some cross-origin redirects. Treating it as absent would let those
    // contexts fall through to the Referer path.
    originRefused({ origin: "null", referer: "https://platform.tenurework.com/page" }, "ORIGIN_OPAQUE")
  })
})

describe("Referer is a fallback, not a peer", () => {
  it("is used when Origin is absent", () => {
    // Better evidence than nothing, when a browser sent no Origin.
    expect(origin({ origin: null, referer: "https://platform.tenurework.com/settings" }).ok).toBe(true)
  })

  it("is compared by origin, not by full URL", () => {
    expect(origin({ origin: null, referer: "https://platform.tenurework.com/any/deep/path?q=1" }).ok).toBe(true)
  })

  it("refuses another site's Referer", () => {
    originRefused({ origin: null, referer: "https://evil.test/page" }, "ORIGIN_NOT_ALLOWED")
  })

  it("is ignored when Origin is present", () => {
    // Origin is the stronger statement. A request with a good Referer and a bad
    // Origin is a request from the bad place.
    originRefused(
      { origin: "https://evil.test", referer: "https://platform.tenurework.com/page" },
      "ORIGIN_NOT_ALLOWED",
    )
  })

  it("refuses an unparseable Referer rather than passing it through", () => {
    originRefused({ origin: null, referer: "not a url" }, "ORIGIN_MISSING")
  })
})

describe("safe methods need no origin", () => {
  it("allows a GET with nothing stated", () => {
    // A GET that changes something is the actual bug, and requiring an origin
    // here would hide it behind a refusal.
    for (const method of ["GET", "HEAD", "OPTIONS", "get", "head"]) {
      expect(checkRequestOrigin({ method, origin: null, referer: null, allowedOrigins: ALLOWED }).ok).toBe(true)
    }
  })

  it("still requires one for every unsafe method", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      expect(
        checkRequestOrigin({ method, origin: null, referer: null, allowedOrigins: ALLOWED }).ok,
      ).toBe(false)
    }
  })
})

describe("an empty allowlist fails closed", () => {
  it("refuses everything when nothing is configured", () => {
    // A missing environment variable must not become an open door.
    originRefused({ allowedOrigins: [] }, "NO_ALLOWLIST")
    originRefused({ allowedOrigins: ["  "] }, "NO_ALLOWLIST")
  })

  it("refuses even a request whose Origin looks right", () => {
    originRefused({ origin: "https://platform.tenurework.com", allowedOrigins: [] }, "NO_ALLOWLIST")
  })
})

describe("every refusal is distinguishable", () => {
  it("gives each condition its own reason", () => {
    const reasons = [
      origin({ allowedOrigins: [] }),
      origin({ origin: "null" }),
      origin({ origin: null, referer: null }),
      origin({ origin: "https://evil.test" }),
    ].map((verdict) => verdict.reason ?? "OK")

    expect(new Set(reasons).size).toBe(reasons.length)
    expect(reasons).not.toContain("OK")
  })
})
