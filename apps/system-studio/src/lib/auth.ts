import NextAuth from "next-auth"
import Cognito from "next-auth/providers/cognito"
import Credentials from "next-auth/providers/credentials"

import { cognitoProviderConfig, studioAuthMode } from "./auth-config"
import { authenticateOperator, roleOf } from "./operators"

/**
 * Sign-in for the System Studio.
 *
 * JWT sessions and no database adapter. In production the provider is AWS
 * Cognito: it authenticates and federates, then the Studio's allowlist decides
 * whether the authenticated email is an operator. Credentials mode is retained
 * only as an explicit local/CI harness so Playwright can exercise the console
 * without a live hosted UI.
 *
 * `trustHost` is on because this runs behind CloudFront -> ALB -> Next. It is
 * safe here because there is no email-callback flow to poison, and the session
 * cookie is signed with AUTH_SECRET.
 */
const cognito = cognitoProviderConfig()
const missingIssuer = "https://example.invalid/missing-cognito-issuer"

const provider =
  studioAuthMode() === "credentials"
    ? Credentials({
        id: "operator",
        name: "Tenure operator",
        credentials: {
          email: { label: "Email", type: "email" },
          secret: { label: "Operator secret", type: "password" },
        },
        authorize(raw) {
          const email = typeof raw?.email === "string" ? raw.email : ""
          const secret = typeof raw?.secret === "string" ? raw.secret : ""

          if (!authenticateOperator(email, secret)) return null

          const normalized = email.trim().toLowerCase()
          return { id: normalized, email: normalized, name: normalized }
        },
      })
    : Cognito({
        clientId: cognito.clientId || "missing-cognito-client-id",
        clientSecret: cognito.clientSecret || "missing-cognito-client-secret",
        issuer: cognito.issuer || missingIssuer,
      })

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  providers: [provider],
  callbacks: {
    async signIn({ user }) {
      if (studioAuthMode() === "credentials") return true
      const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : ""
      return roleOf(email) !== null
    },
    async jwt({ token, user, profile }) {
      const profileEmail =
        profile && typeof profile.email === "string" ? profile.email.trim().toLowerCase() : ""
      const userEmail = typeof user?.email === "string" ? user.email.trim().toLowerCase() : ""
      const tokenEmail = typeof token.email === "string" ? token.email.trim().toLowerCase() : ""
      token.email = userEmail || profileEmail || tokenEmail
      return token
    },
    async session({ session, token }) {
      if (session.user && typeof token.email === "string") session.user.email = token.email
      return session
    },
  },
})
