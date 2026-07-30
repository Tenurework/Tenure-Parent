import NextAuth from "next-auth"
import Okta from "next-auth/providers/okta"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { db } from "@/lib/db"

import { checkDevLoginGate } from "@/lib/dev-login"

// Pilot-only sign-in: pick a seeded demo user by email, no password.
// Enabled via AUTH_DEV_LOGIN=true — remove once Okta is configured.
const devLoginEnabled = process.env.AUTH_DEV_LOGIN === "true"

// Only register Okta once real credentials are configured in Secrets Manager
const oktaConfigured =
  !!process.env.OKTA_ISSUER && process.env.OKTA_ISSUER.startsWith("https://")

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  // Behind CloudFront + ALB the Host header is proxied — required for v5
  trustHost: true,
  // JWT sessions: required for the Credentials provider, and works for Okta too
  session: { strategy: "jwt" },
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
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id
      return token
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub
      return session
    },
  },
})
