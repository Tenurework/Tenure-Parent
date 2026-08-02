import type { AuthSession } from "./entities"
import { digestsEqual } from "./assurance"

/**
 * GE-042-004 — the browser holds a name, and the server holds everything else.
 *
 * Bible §9.1: "Web authentication uses Authorization Code + PKCE and a
 * backend-for-frontend session. Browser cookies are `Secure`, `HttpOnly`,
 * appropriately `SameSite`, narrowly scoped, rotated at authentication and
 * privilege changes, and backed by server-side revocation. Tokens are not
 * stored in browser local storage." §21.2 adds "short-lived sessions, rotation,
 * revocation, device/session inventory".
 *
 * ## What backend-for-frontend actually buys
 *
 * The cookie carries an opaque session id and nothing else. No access token, no
 * ID token, no claims, no tenant — because everything in a cookie is
 * exfiltratable by any XSS, and a session id is the one value that is useless
 * without the server. A JWT in a cookie is a bearer token in a place JavaScript
 * can be tricked into reading; a session id in a cookie is a row number.
 *
 * That is also why revocation works here at all: there is no signed claim to
 * outlive a decision, only a row that stops resolving (GE-040-005).
 *
 * ## Two clocks, because they answer different questions
 *
 * **Idle expiry** asks "did they stop?" — it protects an unattended machine, and
 * it slides forward with use. **Absolute expiry** asks "how long since we
 * actually checked who this is?" — it does not slide, because one that did would
 * mean a session that is used daily never re-authenticates and lives forever.
 *
 * Shipping only idle gives an eternal session. Shipping only absolute logs
 * somebody out mid-sentence at a fixed hour with no warning. Both, and the
 * shorter one wins.
 */

/** How long a session survives without use. Slides forward on activity. */
export const IDLE_TIMEOUT_MINUTES = 30

/** How long a session may live at all, however active. Does not slide. */
export const ABSOLUTE_TIMEOUT_HOURS = 12

/** Cookie name. Prefixed, so a subdomain cannot set it — see `COOKIE_RULES`. */
export const SESSION_COOKIE = "__Host-tenure.sid"
export const CSRF_COOKIE = "__Host-tenure.csrf"

export interface CookieAttributes {
  name: string
  value: string
  httpOnly: boolean
  secure: boolean
  sameSite: "Strict" | "Lax" | "None"
  path: string
  /**
   * Deliberately absent. `__Host-` requires no Domain, and setting one would
   * share the cookie with every subdomain — including any a tenant controls.
   */
  domain?: never
  maxAgeSeconds: number
}

/**
 * The session cookie.
 *
 * `SameSite=Lax`, not `Strict`, and the reason is the OIDC callback: the
 * identity provider redirects the browser back with a top-level GET, and
 * `Strict` withholds the cookie on a cross-site navigation — so the callback
 * arrives with no session and sign-in cannot complete. `Lax` sends it for
 * top-level GETs and withholds it for cross-site POSTs, which is exactly the
 * shape of this problem.
 *
 * Lax alone is not CSRF protection, which is why `csrfCookie` exists. Treating
 * it as sufficient is the common mistake: it does nothing for same-site
 * subdomain attacks, and older browsers ignore it entirely.
 */
export function sessionCookie(sessionId: string, at: Date, absoluteExpiresAt: string): CookieAttributes {
  const remaining = Math.max(0, Math.floor((Date.parse(absoluteExpiresAt) - at.getTime()) / 1000))
  return {
    name: SESSION_COOKIE,
    value: sessionId,
    // Not readable by script. The entire BFF design rests on this.
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAgeSeconds: remaining,
  }
}

/**
 * The CSRF cookie, which is deliberately readable by script.
 *
 * Double-submit: the page reads this and echoes it in a header, and the server
 * checks the two match. An attacker's site can *cause* a request carrying the
 * cookie but cannot *read* the cookie to set the header, because that is what
 * the same-origin policy is.
 *
 * `httpOnly: false` therefore is not an oversight, and a reviewer tightening it
 * would silently break every write in the application. The value is not a
 * secret in the sense the session id is: knowing it grants nothing without also
 * holding the session cookie.
 */
export function csrfCookie(token: string, at: Date, absoluteExpiresAt: string): CookieAttributes {
  const remaining = Math.max(0, Math.floor((Date.parse(absoluteExpiresAt) - at.getTime()) / 1000))
  return {
    name: CSRF_COOKIE,
    value: token,
    httpOnly: false,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAgeSeconds: remaining,
  }
}

/** Methods that change something and therefore need a CSRF token. */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

export type CsrfRefusal = "TOKEN_MISSING" | "TOKEN_MISMATCH"

export interface CsrfVerdict {
  ok: boolean
  reason: CsrfRefusal | null
}

/**
 * Whether a request may change anything.
 *
 * GET, HEAD and OPTIONS are exempt because they must not change anything — a
 * GET that mutates is the actual bug, and CSRF-protecting it would hide that
 * rather than fix it.
 *
 * Compared in constant time: the token is a secret being checked against
 * attacker-supplied input, the same as a session state or a verification code.
 */
export function checkCsrf(input: {
  method: string
  cookieToken: string | null
  headerToken: string | null
}): CsrfVerdict {
  if (!UNSAFE_METHODS.has(input.method.toUpperCase())) return { ok: true, reason: null }
  if (!input.cookieToken || !input.headerToken) return { ok: false, reason: "TOKEN_MISSING" }
  if (!digestsEqual(input.cookieToken, input.headerToken)) return { ok: false, reason: "TOKEN_MISMATCH" }
  return { ok: true, reason: null }
}

export interface ServerSession extends AuthSession {
  /** Rotated on authentication and on privilege change. */
  csrfToken: string
  /** Slides forward with use. */
  lastSeenAt: string
  /** For the inventory. Coarse, and never a full address. */
  deviceLabel: string | null
  /** The session this one replaced, so a rotation chain is followable. */
  rotatedFromId: string | null
}

export type SessionRefusal = "IDLE_EXPIRED" | "ABSOLUTE_EXPIRED" | "REVOKED" | "WRONG_TENANT"

export interface SessionLive {
  live: true
  /** The session with `lastSeenAt` advanced. Persist it or idle expiry never slides. */
  touched: ServerSession
}

export interface SessionDead {
  live: false
  reason: SessionRefusal
}

export type SessionCheck = SessionLive | SessionDead

/**
 * Whether a session may serve this request, in this tenant.
 *
 * Tenant binding is checked, not assumed: a session id is valid for exactly one
 * tenant, and a person who is a member of two has two sessions. Without this, a
 * cookie obtained in one tenant would act in another the moment the path
 * changed — and the path is attacker-chosen.
 */
export function checkSession(
  session: ServerSession | null,
  request: { tenantId: string; at: Date },
): SessionCheck {
  if (!session) return { live: false, reason: "REVOKED" }
  if (session.revokedAt !== null) return { live: false, reason: "REVOKED" }

  if (session.tenantId !== request.tenantId) return { live: false, reason: "WRONG_TENANT" }

  const now = request.at.getTime()

  // Absolute first. A session past its absolute limit is over however recently
  // it was used, and reporting idle expiry for it would suggest that using it
  // sooner would have helped.
  const absolute = Date.parse(session.expiresAt)
  if (Number.isNaN(absolute) || now >= absolute) return { live: false, reason: "ABSOLUTE_EXPIRED" }

  const lastSeen = Date.parse(session.lastSeenAt)
  if (Number.isNaN(lastSeen) || now - lastSeen > IDLE_TIMEOUT_MINUTES * 60_000) {
    return { live: false, reason: "IDLE_EXPIRED" }
  }

  return { live: true, touched: { ...session, lastSeenAt: request.at.toISOString() } }
}

export type RotationReason = "AUTHENTICATION" | "PRIVILEGE_CHANGE" | "STEP_UP"

export interface Rotation {
  /** The new session. Its id and CSRF token are both new. */
  session: ServerSession
  /** The old one, revoked. Persist both, or the old id keeps working. */
  previous: ServerSession
}

/**
 * Rotate a session's identifier.
 *
 * Session fixation is the attack: somebody plants a known session id in a
 * victim's browser, the victim signs in, and the planted id is now an
 * authenticated session. The defence is that authenticating *changes* the id,
 * so whatever the attacker planted is not what the victim ends up holding.
 *
 * The absolute expiry is deliberately **not** extended. Rotation proves who
 * somebody is again, which is what the absolute clock measures — but extending
 * it on every privilege change would let a session live indefinitely by doing
 * ordinary things, which is the loophole the absolute clock exists to close.
 * Re-authentication issues a new session; this rotates an existing one.
 */
export function rotateSession(
  session: ServerSession,
  next: { sessionId: string; csrfToken: string; reason: RotationReason; at: Date },
): Rotation {
  return {
    session: {
      ...session,
      id: next.sessionId,
      csrfToken: next.csrfToken,
      lastSeenAt: next.at.toISOString(),
      rotatedFromId: session.id,
      revokedAt: null,
    },
    // The old id stops working immediately. A rotation that leaves it live is
    // not a rotation, it is a second session.
    previous: { ...session, revokedAt: next.at.toISOString() },
  }
}

export interface SessionSummary {
  id: string
  tenantId: string
  deviceLabel: string | null
  issuedAt: string
  lastSeenAt: string
  /** Whether this is the session asking. People need to know which not to end. */
  current: boolean
}

/**
 * A person's sessions, for them to look at and end.
 *
 * Bible §21.2 asks for a "device/session inventory", and the point of one is
 * that somebody can recognise a session that is not theirs. So it carries a
 * device label and a last-seen time, and marks the current one — an inventory
 * where you cannot tell which row is you is one where nobody dares click
 * anything.
 *
 * Revoked sessions are excluded: this is a list of what is live, and showing
 * dead rows makes the live ones harder to find. Newest activity first.
 */
export function sessionInventory(
  sessions: readonly ServerSession[],
  input: { personId: string; currentSessionId: string; at: Date },
): readonly SessionSummary[] {
  return sessions
    .filter((session) => session.personId === input.personId)
    // `checkSession` is the single authority on liveness — it already rejects a
    // revoked session, an idle one and one past its absolute limit. A second
    // `revokedAt === null` here was redundant, and a mutation removing it
    // survived precisely because it changed nothing. Two places deciding the
    // same thing is how they eventually disagree.
    .filter((session) => checkSession(session, { tenantId: session.tenantId, at: input.at }).live)
    .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt))
    .map((session) => ({
      id: session.id,
      tenantId: session.tenantId,
      deviceLabel: session.deviceLabel,
      issuedAt: session.issuedAt,
      lastSeenAt: session.lastSeenAt,
      current: session.id === input.currentSessionId,
    }))
}

/**
 * End sessions, and say which.
 *
 * `exceptSessionId` exists because "sign out everywhere else" is the button
 * people actually want after losing a laptop — one that also ended the session
 * they are using would log them out mid-panic and is the reason nobody presses
 * it.
 */
export function revokeSessions(
  sessions: readonly ServerSession[],
  input: { personId: string; exceptSessionId?: string; at: Date },
): readonly ServerSession[] {
  return sessions
    .filter(
      (session) =>
        session.personId === input.personId &&
        session.revokedAt === null &&
        session.id !== input.exceptSessionId,
    )
    .map((session) => ({ ...session, revokedAt: input.at.toISOString() }))
}

export interface CookieProblem {
  cookie: string
  detail: string
}

/**
 * Whether a set of cookies is safe to send.
 *
 * A guard expressed as a function so it can be asserted rather than reviewed.
 * Each rule is one somebody has quietly relaxed in a real system:
 *
 *   * the session cookie must be `HttpOnly` — without it, one XSS is one
 *     stolen session, and the whole BFF design is decorative;
 *   * both must be `Secure`, or a single plaintext request leaks them;
 *   * neither may be `SameSite=None`, which is "send this to anyone";
 *   * neither may set `Domain`, because `__Host-` forbids it and a domain
 *     cookie is shared with every subdomain, including tenant-controlled ones;
 *   * the CSRF cookie must NOT be `HttpOnly`, or double-submit cannot work and
 *     every write breaks.
 */
export function cookieProblems(cookies: readonly CookieAttributes[]): readonly CookieProblem[] {
  const problems: CookieProblem[] = []

  for (const cookie of cookies) {
    if (!cookie.secure) {
      problems.push({ cookie: cookie.name, detail: "Not Secure: one plaintext request leaks it." })
    }
    if (cookie.sameSite === "None") {
      problems.push({ cookie: cookie.name, detail: "SameSite=None means send this to anyone." })
    }
    if ((cookie as { domain?: string }).domain !== undefined) {
      problems.push({
        cookie: cookie.name,
        detail: "A Domain attribute shares the cookie with every subdomain, and __Host- forbids it.",
      })
    }
    if (cookie.name === SESSION_COOKIE && !cookie.httpOnly) {
      problems.push({
        cookie: cookie.name,
        detail: "The session cookie must be HttpOnly. Without it one XSS is one stolen session.",
      })
    }
    if (cookie.name === CSRF_COOKIE && cookie.httpOnly) {
      problems.push({
        cookie: cookie.name,
        detail: "The CSRF cookie must be readable by script, or double-submit cannot work and every write breaks.",
      })
    }
  }

  return problems
}
