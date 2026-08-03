/**
 * GE-044-004 — where a request says it came from, and where we send it back.
 *
 * Two attacks that both work by getting the server to trust a header.
 *
 * ## Callback host poisoning
 *
 * An application that builds its own callback URL from the `Host` or
 * `X-Forwarded-Host` header hands the attacker the redirect. They send
 * `Host: evil.test`, the authorization request goes out with
 * `redirect_uri=https://evil.test/callback`, and the authorization code arrives
 * at their server. Nothing about the request looks unusual: the header is
 * exactly what a reverse proxy legitimately sets, and every other part of the
 * flow is correct.
 *
 * `validateReturnPath` (GE-042-002) already refuses an attacker-supplied *path*.
 * This refuses an attacker-supplied *host*, which is the half a path check
 * cannot see — and the defence is not to sanitise the header but to never read
 * it. A callback URL is one of a registered set or it does not exist.
 *
 * ## Origin
 *
 * `checkCsrf` (GE-042-004) is double-submit: the page reads a cookie and echoes
 * it in a header. That defends against a cross-site form post, and it depends on
 * the attacker being unable to read the cookie — which is true until it isn't,
 * because a subdomain takeover or one `document.domain` mistake makes it false.
 *
 * Checking `Origin` is a second, independent question: did the browser say this
 * request came from us? It is not a replacement, and this module does not treat
 * it as one. Two checks that fail for different reasons is the point.
 */

/* ────────────────────────────────────────────────────── callback URLs ── */

/**
 * Named for the URL, because `authorization-request.ts` already has a
 * `CallbackRefusal` for a different question — whether a callback *request* may
 * be believed. This is whether a callback *address* may be used.
 */
export type CallbackUrlRefusal =
  | "NOT_REGISTERED"
  | "NO_REGISTRATION"
  | "NOT_ABSOLUTE"
  | "NOT_HTTPS"

export type CallbackUrlOutcome =
  | { ok: true; url: string }
  | { ok: false; reason: CallbackUrlRefusal; detail: string }

/**
 * The callback URL to use, from a registered set.
 *
 * Takes no host, no headers and no base URL — there is nothing here for a
 * request to influence. That is the entire design: a function that cannot see
 * `Host` cannot be poisoned by it, and a rule stated as "do not read the header"
 * is one somebody breaks by reading the header.
 *
 * `requested` is compared by exact string equality against the registration.
 * Not by origin, because a registration is a full URL and any path on the host
 * may be attacker-controlled — an uploaded file, a user-authored page. Not by
 * prefix, because `https://tenure.test/cb` prefixes `https://tenure.test/cb.evil`.
 */
export function resolveCallbackUrl(input: {
  registered: readonly string[]
  /** What the caller wants to use. Absent means "the only registered one". */
  requested?: string
}): CallbackUrlOutcome {
  const registered = input.registered.filter((uri) => uri.trim().length > 0)

  if (registered.length === 0) {
    return {
      ok: false,
      reason: "NO_REGISTRATION",
      detail:
        "No callback URL is registered for this connection. Deriving one from the request would let " +
        "whoever sent it choose where the authorization code is delivered.",
    }
  }

  for (const uri of registered) {
    const problem = absoluteHttpsProblem(uri)
    if (problem) {
      return {
        ok: false,
        reason: problem,
        detail: `The registered callback ${uri} is not an absolute https URL, so it cannot be used as one.`,
      }
    }
  }

  if (input.requested === undefined) {
    if (registered.length > 1) {
      // Ambiguous rather than "take the first". Which callback a flow uses is a
      // decision, and resolving it by array order is a decision nobody made.
      return {
        ok: false,
        reason: "NOT_REGISTERED",
        detail: `${registered.length} callback URLs are registered and none was requested, so there is no way to tell which flow this is.`,
      }
    }
    return { ok: true, url: registered[0] }
  }

  if (!registered.includes(input.requested)) {
    return {
      ok: false,
      reason: "NOT_REGISTERED",
      detail: `${input.requested} is not a registered callback URL. It is compared exactly: a host match would accept any path on that host, and a prefix match would accept anything appended to it.`,
    }
  }

  return { ok: true, url: input.requested }
}

function absoluteHttpsProblem(uri: string): CallbackUrlRefusal | null {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return "NOT_ABSOLUTE"
  }
  // `http:` only for loopback, which is where a developer's callback lives and
  // where there is no network to intercept.
  if (parsed.protocol === "https:") return null
  if (parsed.protocol === "http:" && isLoopback(parsed.hostname)) return null
  return "NOT_HTTPS"
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
}

/* ───────────────────────────────────────────────────────────── origin ── */

export type OriginRefusal =
  | "ORIGIN_MISSING"
  | "ORIGIN_OPAQUE"
  | "ORIGIN_NOT_ALLOWED"
  | "NO_ALLOWLIST"

export interface OriginVerdict {
  ok: boolean
  reason: OriginRefusal | null
  detail: string
}

/** Methods that must not change anything, and so need no origin. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"])

/**
 * Whether a state-changing request may be believed to come from us.
 *
 * Deliberately **not** a replacement for `checkCsrf`. Two independent checks
 * that fail for different reasons is the design: double-submit assumes the
 * attacker cannot read our cookie, and this assumes the browser is telling the
 * truth about where the request started. Either assumption can break without
 * the other.
 *
 * `Referer` is a fallback and not a peer. It is stripped by privacy tooling,
 * suppressed by referrer policies and absent on many legitimate requests, so
 * requiring it would break the product — but when `Origin` is absent and
 * `Referer` is present, its origin is better evidence than nothing.
 */
export function checkRequestOrigin(input: {
  method: string
  origin: string | null
  referer: string | null
  /** Absolute origins this application is served from. */
  allowedOrigins: readonly string[]
}): OriginVerdict {
  if (SAFE_METHODS.has(input.method.toUpperCase())) {
    return { ok: true, reason: null, detail: "" }
  }

  const allowed = input.allowedOrigins.filter((origin) => origin.trim().length > 0)
  if (allowed.length === 0) {
    // Fails closed. An empty allowlist is a misconfiguration, and treating it as
    // "allow everything" turns a missing environment variable into an open door.
    return {
      ok: false,
      reason: "NO_ALLOWLIST",
      detail: "No allowed origins are configured, so no request can be shown to come from this application.",
    }
  }

  // `Origin: null` is a real value a browser sends — from a sandboxed iframe, a
  // `data:` document, some cross-origin redirects. It is *opaque*, not absent,
  // and treating it as absent would let those contexts fall through to the
  // Referer path or, worse, to a default.
  if (input.origin === "null") {
    return {
      ok: false,
      reason: "ORIGIN_OPAQUE",
      detail: "The request declares an opaque origin, which means it came from a context that cannot be identified.",
    }
  }

  const stated = input.origin ?? originOf(input.referer)
  if (!stated) {
    return {
      ok: false,
      reason: "ORIGIN_MISSING",
      detail: "This request carries neither an Origin nor a Referer, so nothing says where it started.",
    }
  }

  // Exact match. A suffix comparison accepts `https://evil-tenure.app` for
  // `tenure.app`, and a `startsWith` accepts `https://tenure.app.evil.test`.
  if (!allowed.includes(stated)) {
    return {
      ok: false,
      reason: "ORIGIN_NOT_ALLOWED",
      detail: `This request states it came from ${stated}, which is not an origin this application is served from.`,
    }
  }

  return { ok: true, reason: null, detail: "" }
}

/** The origin of a URL, or null if it is not one. */
function originOf(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    // `URL.origin` is "null" for opaque schemes, and returning that string would
    // then be compared against the allowlist as though it were a host.
    return parsed.origin === "null" ? null : parsed.origin
  } catch {
    return null
  }
}
