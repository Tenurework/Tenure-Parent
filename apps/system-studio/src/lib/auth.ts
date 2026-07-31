import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"

import { authenticateOperator } from "./operators"

/**
 * Sign-in for the System Studio.
 *
 * JWT sessions and one credentials provider — deliberately no database and no
 * adapter. This console reads blueprints, module manifests, configuration
 * definitions and release artifacts, all of which are code, so giving it a
 * database connection would be granting an authority it does not need to do its
 * job. The tenant-data surfaces that DO need one stay in the application until
 * the tenancy chokepoint is extracted into a package they can both share.
 *
 * `trustHost` is on because this runs behind a load balancer under a hostname
 * the process cannot know. It is safe here only because there is no
 * email-callback flow to poison — the sign-in is a form post, and the session
 * cookie is signed with AUTH_SECRET.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  providers: [
    Credentials({
      id: "operator",
      name: "Tenure operator",
      credentials: {
        email: { label: "Email", type: "email" },
        secret: { label: "Operator secret", type: "password" },
      },
      authorize(raw) {
        const email = typeof raw?.email === "string" ? raw.email : ""
        const secret = typeof raw?.secret === "string" ? raw.secret : ""

        // Returning null is a refusal with no reason attached. The caller cannot
        // learn whether the address was unknown or the secret was wrong, which
        // is what stops this being an operator-address oracle.
        if (!authenticateOperator(email, secret)) return null

        return { id: email.trim().toLowerCase(), email: email.trim().toLowerCase(), name: email }
      },
    }),
  ],
  callbacks: {
    // The session carries an identity and nothing else. Authority is re-derived
    // from PLATFORM_OPERATORS on every request, so removing someone from the
    // list takes effect immediately rather than when their token expires.
    async session({ session, token }) {
      if (session.user && token.sub) session.user.email = token.sub
      return session
    },
  },
})
