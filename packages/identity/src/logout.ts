import type { ServerSession } from "./session"

/**
 * GE-042-006 — signing out, and the half of it nobody implements.
 *
 * Clearing the local session is the easy half and the one every application
 * does. The other half is that the identity provider's own session is still
 * live: the person clicks *sign out*, clicks *sign in*, and is straight back in
 * without being asked for anything. On a personal laptop that is a convenience.
 * On the shared machine in a school office — which is where a great many of
 * these sessions live — it means "sign out" did not do what the person read it
 * as doing, and the next person to sit down is them.
 *
 * OIDC RP-Initiated Logout is the remedy: redirect to the provider's
 * `end_session_endpoint`, which ends the upstream session and returns the
 * person to a page that says so.
 *
 * ## When the provider cannot do it
 *
 * Not every provider advertises `end_session_endpoint`, and one that does not
 * cannot be made to. The honest outcome then is not to pretend: revoke locally,
 * and *say* that the school account is still signed in. That sentence is the
 * deliverable. A sign-out screen that says "You have been signed out" while the
 * upstream session stands is not a smaller version of signing out; it is the
 * misleading one.
 */

/**
 * The two fields of an OIDC discovery document that logout depends on.
 *
 * Deliberately not a whole `openid-configuration` type. Nothing in this
 * repository reads one yet, and declaring thirty fields nobody populates would
 * be a specification pretending to be code. It grows when a caller needs more.
 */
export interface ProviderMetadata {
  issuer: string
  /** Absent when the provider does not support RP-initiated logout at all. */
  endSessionEndpoint?: string
}

export type UpstreamLogout =
  /** The provider will be asked to end its session too. */
  | { kind: "RP_INITIATED"; url: string }
  /** It cannot be, and the person is told. */
  | { kind: "UNSUPPORTED"; detail: string }

export interface LogoutPlan {
  /** Sessions to revoke locally. Always at least the current one. */
  revokeSessionIds: readonly string[]
  /** Cookies to clear, by name. */
  clearCookies: readonly string[]
  upstream: UpstreamLogout
  /** What to tell the person, matching what actually happened. */
  detail: string
}

export interface LogoutRequest {
  session: ServerSession
  /** Other sessions this person holds. Ended too when `everywhere`. */
  otherSessions?: readonly ServerSession[]
  /** "Sign out everywhere", after a lost device. */
  everywhere?: boolean
  provider: ProviderMetadata
  /**
   * The ID token from sign-in, if the server still holds one.
   *
   * `id_token_hint` is how the provider knows *which* session to end. Without
   * it a provider may show an "are you sure?" interstitial, or refuse, and some
   * require it outright.
   */
  idToken?: string
  /** Where the provider should return the person. Must be allowlisted. */
  postLogoutRedirectUri: string
  /** The URIs registered with the provider. */
  allowedPostLogoutRedirectUris: readonly string[]
  /** Opaque value echoed back, so the return leg can be tied to this request. */
  state: string
  cookiesToClear: readonly string[]
}

export class LogoutConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LogoutConfigurationError"
  }
}

/**
 * Decide what signing out does.
 *
 * The redirect target is checked against the registered list rather than
 * validated by shape. `post_logout_redirect_uri` is a redirect the provider
 * performs on our behalf, so an unchecked one is an open redirect wearing the
 * provider's name — the most credible phishing hop available, because the
 * person genuinely did just click sign out on the real site.
 *
 * Refused by throwing, not by falling back to a default. A fallback would make
 * a misconfiguration invisible, and the misconfiguration is the bug.
 */
export function planLogout(request: LogoutRequest): LogoutPlan {
  const {
    session,
    otherSessions = [],
    everywhere = false,
    provider,
    idToken,
    postLogoutRedirectUri,
    allowedPostLogoutRedirectUris,
    state,
    cookiesToClear,
  } = request

  // Exact string equality against the registered set. Not `startsWith`, which
  // accepts `https://tenure.app.evil.test` for a registered `https://tenure.app`,
  // and not a parsed-host comparison, which accepts any path on the host —
  // including one an uploaded file controls.
  if (!allowedPostLogoutRedirectUris.includes(postLogoutRedirectUri)) {
    throw new LogoutConfigurationError(
      `post_logout_redirect_uri ${postLogoutRedirectUri} is not registered. The provider redirects ` +
        `the person there on our behalf, so an unchecked value is an open redirect immediately after ` +
        `a real sign-out — the most credible phishing hop there is.`,
    )
  }

  // Local revocation happens whatever the provider supports. It is the part
  // this application controls, and it must not be conditional on the part it
  // does not.
  const revokeSessionIds = everywhere
    ? [session.id, ...otherSessions.filter((s) => s.personId === session.personId).map((s) => s.id)]
    : [session.id]

  const endSession = provider.endSessionEndpoint
  if (!endSession) {
    return {
      revokeSessionIds: [...new Set(revokeSessionIds)],
      clearCookies: cookiesToClear,
      upstream: {
        kind: "UNSUPPORTED",
        detail: `${provider.issuer} does not advertise an end_session_endpoint, so its session cannot be ended from here.`,
      },
      detail:
        "You are signed out of Tenure. Your school account is still signed in on this device — " +
        "close the browser, or sign out of it separately, before leaving a shared machine.",
    }
  }

  const url = new URL(endSession)
  // `id_token_hint` names the session to end. Omitted when the server does not
  // hold the token — sending an empty parameter is worse than sending none,
  // because a provider validating it will reject the request outright.
  if (idToken) url.searchParams.set("id_token_hint", idToken)
  url.searchParams.set("post_logout_redirect_uri", postLogoutRedirectUri)
  url.searchParams.set("state", state)

  return {
    revokeSessionIds: [...new Set(revokeSessionIds)],
    clearCookies: cookiesToClear,
    upstream: { kind: "RP_INITIATED", url: url.toString() },
    detail: idToken
      ? "You are signed out of Tenure and of your school account on this device."
      : "You are signed out of Tenure. Your school account is being asked to sign out too, and may " +
        "ask you to confirm.",
  }
}
