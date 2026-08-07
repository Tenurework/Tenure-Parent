import NextAuth, { type NextAuthConfig, type Session } from "next-auth"
import type { JWT } from "next-auth/jwt"
import Okta from "next-auth/providers/okta"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { db } from "@/lib/db"

import {
  ABSOLUTE_TIMEOUT_HOURS,
  IDLE_TIMEOUT_MINUTES,
  checkSession,
  type ServerSession,
} from "@tenure/identity"
import { checkDevLoginGate } from "@/lib/dev-login"
import { oktaIsUsable } from "@/lib/auth-connections"

// Pilot-only sign-in: pick a seeded demo user by email, no password.
// Enabled via AUTH_DEV_LOGIN=true — remove once Okta is configured.
const devLoginEnabled = process.env.AUTH_DEV_LOGIN === "true"

// Only register Okta when the identity registry considers the connection
// usable (GE-030-003). This used to be an inline check that the issuer was set
// and began with https, which is three of the registry's checks and none of
// the others — a missing
// client id, a credential pasted as a value rather than referenced, or an
// expired secret all produced a provider NextAuth registers happily and that
// fails at the callback: visibly to a user, invisibly to anyone watching.
const oktaConfigured = oktaIsUsable()

/**
 * GE-042-004 — the two session clocks, wired to the session the app actually
 * issues.
 *
 * `packages/identity/src/session.ts` has held both clocks since GE-042-004 was
 * first recorded, and its own ledger entry said so plainly: "Nothing calls any
 * of this." Meanwhile the running application was `session: { strategy: "jwt" }`
 * with no `maxAge` — NextAuth's default, which is a 30-day window that slides
 * forward on every read. A token used once a day therefore never expires at
 * all, which is exactly the loophole `session.ts` documents the absolute clock
 * as existing to close.
 *
 * The two clocks are enforced in two different places, because they are two
 * different mechanisms:
 *
 *   * **Idle** is `sessionOptions.maxAge`. Under the JWT strategy NextAuth
 *     re-encodes the token and re-sets the cookie on every session read with a
 *     fresh `now + maxAge` expiry (`@auth/core/lib/actions/session.js`), and
 *     `jwt.maxAge` defaults to `session.maxAge` (`@auth/core/lib/init.js`), so
 *     the same number bounds the cookie *and* the signed token. That is a
 *     sliding idle window, which is what idle expiry is. `updateAge` is
 *     deliberately not set: it is read only on the database-strategy path, so
 *     setting it here would be a configuration line that does nothing.
 *   * **Absolute** cannot be a cookie attribute, because every attribute
 *     NextAuth writes is refreshed on use. It has to be a claim stamped once at
 *     authentication and never re-stamped, which is `token.authAt` below.
 */
export const SESSION_IDLE_SECONDS = IDLE_TIMEOUT_MINUTES * 60
export const SESSION_ABSOLUTE_SECONDS = ABSOLUTE_TIMEOUT_HOURS * 60 * 60

export const sessionOptions: NonNullable<NextAuthConfig["session"]> = {
  // JWT sessions: required for the Credentials provider, and works for Okta too
  strategy: "jwt",
  maxAge: SESSION_IDLE_SECONDS,
}

/**
 * The token's absolute deadline, expressed as the record `checkSession` reads.
 *
 * `checkSession` is the single authority on session liveness in this codebase
 * and the rule it applies — absolute first, `NaN` counts as expired, `>=` not
 * `>` — is stated once there rather than re-typed here where it would drift.
 * Reaching it means handing it a `ServerSession`, and a NextAuth JWT is not one:
 * there is no server-side session row, so most of that record has no value to
 * carry. The filler is therefore chosen so that every branch it would reach is
 * *inert*, never so that it is *satisfied by accident*:
 *
 *   * `lastSeenAt` is the evaluation instant, so the idle branch cannot fire.
 *     Idle is `sessionOptions.maxAge` above; two places enforcing one rule is
 *     how they eventually disagree.
 *   * `tenantId` is the same value on both sides, so the tenant-binding branch
 *     cannot fire. The NextAuth token carries no tenant — the `session`
 *     callback below copies `sub` and nothing else — so there is nothing here
 *     to bind against, and inventing one would be a check that passes because
 *     it compares a value to itself.
 *   * `revokedAt` is `null`, because immediate server-side revocation needs a
 *     persisted session table this deployment does not have. Recorded as still
 *     open rather than faked.
 */
const TENANT_NOT_CARRIED = "nextauth-jwt-carries-no-tenant"

function absoluteDeadline(authAt: number, personId: string, at: Date): ServerSession {
  return {
    id: "",
    personId,
    tenantId: TENANT_NOT_CARRIED,
    externalIdentityId: "",
    issuedAt: new Date(authAt).toISOString(),
    // The one field that carries real information: authentication time plus the
    // absolute budget. It is derived from `authAt`, which is never re-stamped,
    // so this deadline does not move for as long as the session lives.
    expiresAt: new Date(authAt + SESSION_ABSOLUTE_SECONDS * 1000).toISOString(),
    revokedAt: null,
    steppedUpAt: null,
    authorizationRevision: 0,
    csrfToken: "",
    lastSeenAt: at.toISOString(),
    deviceLabel: null,
    rotatedFromId: null,
    rotationReason: null,
  }
}

/**
 * Extracted from the `NextAuth({...})` literal so the clock can be tested by
 * calling it, rather than by reasoning about a configuration object. It is the
 * same value passed as `callbacks` below — nothing else constructs one.
 */
export const sessionCallbacks = {
  jwt({ token, user }: { token: JWT; user?: { id?: string } | null }): JWT | null {
    // `user` is present on a sign-in or sign-up call and on no other: all four
    // of NextAuth's sign-in paths pass it with `trigger: "signIn" | "signUp"`
    // (`@auth/core/lib/actions/callback/index.js`), and the session-read path
    // passes only the token (`.../actions/session.js`). That is the only moment
    // we have actually checked who this is, and so the only moment the absolute
    // clock may be restarted. Stamping it on an ordinary read would make the
    // absolute clock slide, which is the same as not having one.
    if (user) {
      if (user.id) token.sub = user.id
      token.authAt = Date.now()
      return token
    }

    const authAt = token.authAt
    // A token with no authentication time is one whose age cannot be
    // established — every session issued before this clock existed. Refused
    // rather than adopted: stamping `Date.now()` here would hand an
    // arbitrarily old token a fresh full window, which is the loophole. The
    // cost is one forced sign-in at the deploy that introduces this.
    if (typeof authAt !== "number" || !Number.isFinite(authAt)) return null

    const at = new Date()
    const verdict = checkSession(absoluteDeadline(authAt, token.sub ?? "", at), {
      tenantId: TENANT_NOT_CARRIED,
      at,
    })
    // `null` is not "no change" — NextAuth deletes the session cookie when the
    // jwt callback returns it (`@auth/core/lib/actions/session.js`).
    if (!verdict.live) return null

    return token
  },
  session({ session, token }: { session: Session; token: JWT }): Session {
    if (token.sub) session.user.id = token.sub
    return session
  },
} satisfies NonNullable<NextAuthConfig["callbacks"]>

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  // Behind CloudFront + ALB the Host header is proxied — required for v5
  trustHost: true,
  session: sessionOptions,
  pages: { signIn: "/signin" },
  providers: [
    ...(oktaConfigured
      ? [
          Okta({
            clientId: process.env.OKTA_CLIENT_ID!,
            clientSecret: process.env.OKTA_CLIENT_SECRET!,
            issuer: process.env.OKTA_ISSUER!,
          }),
        ]
      : []),
    ...(devLoginEnabled
      ? [
          Credentials({
            id: "dev-login",
            name: "Pilot demo user",
            credentials: {
              email: { label: "Email", type: "email" },
              passphrase: { label: "Access passphrase", type: "password" },
            },
            async authorize(credentials) {
              // The gate is checked before the lookup, so a wrong passphrase
              // cannot be used to probe which emails exist.
              const gate = checkDevLoginGate({
                provided: typeof credentials?.passphrase === "string" ? credentials.passphrase : undefined,
                expected: process.env.DEV_LOGIN_PASSPHRASE,
                isProduction: process.env.NODE_ENV === "production",
              })
              if (!gate.allowed) {
                console.warn(`dev-login refused: ${gate.reason}`)
                return null
              }

              const email = credentials?.email
              if (typeof email !== "string") return null
              const user = await db.user.findUnique({ where: { email } })
              if (!user) return null
              return { id: user.id, name: user.name, email: user.email, image: user.image }
            },
          }),
        ]
      : []),
  ],
  callbacks: sessionCallbacks,
})
