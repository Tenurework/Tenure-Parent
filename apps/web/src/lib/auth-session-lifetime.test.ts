import type { JWT } from "next-auth/jwt"
import type { Session } from "next-auth"
import { ABSOLUTE_TIMEOUT_HOURS, IDLE_TIMEOUT_MINUTES } from "@tenure/identity"

/**
 * GE-042-004 — the session clocks, tested by calling the thing the running
 * application runs.
 *
 * `next-auth` ships as ESM and this app's jest transform does not reach into
 * `node_modules`, so importing `@/lib/auth` unmocked fails to parse before any
 * assertion runs. The stand-in below is therefore not a convenience: it is the
 * only way to load the module at all.
 *
 * It is deliberately not a canned return. It *records the configuration object
 * `auth.ts` hands to NextAuth*, which is what lets these tests assert the
 * wiring rather than assume it — that the callbacks under test are the
 * callbacks the app installs, and that the idle window is the one it configures.
 * A change that tested `sessionCallbacks` while `NextAuth({...})` quietly kept
 * its own inline copy would fail here.
 */
// A hoisted function declaration, not a `const`: jest hoists `jest.mock` above
// the imports, so `@/lib/auth` is required — and the factory below runs — while
// any module-scoped `const` is still in its temporal dead zone. The `mock`
// prefix is what lets the factory reference it at all.
function mockNextAuthConfigs(): Record<string, unknown>[] {
  const scope = globalThis as { __nextAuthConfigs?: Record<string, unknown>[] }
  if (!scope.__nextAuthConfigs) scope.__nextAuthConfigs = []
  return scope.__nextAuthConfigs
}

jest.mock("next-auth", () => ({
  __esModule: true,
  default: (config: Record<string, unknown>) => {
    mockNextAuthConfigs().push(config)
    return { handlers: {}, auth: () => null, signIn: () => {}, signOut: () => {} }
  },
}))
jest.mock("next-auth/providers/okta", () => ({
  __esModule: true,
  default: () => ({ id: "okta" }),
}))
jest.mock("next-auth/providers/credentials", () => ({
  __esModule: true,
  default: (config: { id?: string }) => ({ id: config.id ?? "credentials" }),
}))
jest.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({}) }))
// The Prisma client opens a datasource at construction; nothing here queries.
jest.mock("@/lib/db", () => ({ db: {} }))

import {
  SESSION_ABSOLUTE_SECONDS,
  SESSION_IDLE_SECONDS,
  sessionCallbacks,
  sessionOptions,
} from "@/lib/auth"

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

function token(overrides: Partial<JWT> = {}): JWT {
  return { sub: "person_1", ...overrides }
}

describe("the idle clock is configured, not defaulted", () => {
  it("bounds the session at the identity engine's idle timeout", () => {
    expect(sessionOptions.strategy).toBe("jwt")
    expect(sessionOptions.maxAge).toBe(30 * 60)
    expect(SESSION_IDLE_SECONDS).toBe(IDLE_TIMEOUT_MINUTES * 60)
  })

  it("is nowhere near NextAuth's unset default, which is a 30-day sliding window", () => {
    // The defect this closes: `session: { strategy: "jwt" }` with no maxAge.
    expect(sessionOptions.maxAge).toBeDefined()
    expect(sessionOptions.maxAge!).toBeLessThan(30 * 24 * 60 * 60)
    // ...and no longer than the absolute budget, or idle could never bind.
    expect(sessionOptions.maxAge!).toBeLessThanOrEqual(SESSION_ABSOLUTE_SECONDS)
  })

  it("derives the absolute budget from the identity engine too", () => {
    expect(SESSION_ABSOLUTE_SECONDS).toBe(ABSOLUTE_TIMEOUT_HOURS * 60 * 60)
  })
})

describe("the callbacks under test are the callbacks the app installs", () => {
  it("passes sessionOptions and sessionCallbacks to NextAuth", () => {
    expect(mockNextAuthConfigs()).toHaveLength(1)
    const config = mockNextAuthConfigs()[0]
    expect(config.session).toBe(sessionOptions)
    expect(config.callbacks).toBe(sessionCallbacks)
  })
})

describe("the absolute clock", () => {
  it("stamps authAt on the sign-in call, the one where user is present", () => {
    const before = Date.now()
    const result = sessionCallbacks.jwt({ token: token({ sub: undefined }), user: { id: "person_9" } })

    expect(result).not.toBeNull()
    expect(result!.sub).toBe("person_9")
    expect(typeof result!.authAt).toBe("number")
    expect(result!.authAt as number).toBeGreaterThanOrEqual(before)
    expect(result!.authAt as number).toBeLessThanOrEqual(Date.now())
  })

  it("lets a freshly authenticated token through", () => {
    const result = sessionCallbacks.jwt({ token: token({ authAt: Date.now() }) })

    expect(result).not.toBeNull()
    expect(result!.sub).toBe("person_1")
  })

  it("lets a token through just inside the absolute window", () => {
    const authAt = Date.now() - (SESSION_ABSOLUTE_SECONDS * 1000 - MINUTE)

    expect(sessionCallbacks.jwt({ token: token({ authAt }) })).not.toBeNull()
  })

  it("drops a token past the absolute window, however recently it was used", () => {
    const authAt = Date.now() - (SESSION_ABSOLUTE_SECONDS * 1000 + MINUTE)

    expect(sessionCallbacks.jwt({ token: token({ authAt }) })).toBeNull()
  })

  it("drops a token exactly on the deadline", () => {
    // `checkSession` refuses at `now >= expiresAt`, not after it.
    expect(sessionCallbacks.jwt({ token: token({ authAt: Date.now() - 12 * HOUR }) })).toBeNull()
  })

  it("does not slide: using a token repeatedly never moves authAt forward", () => {
    // 11h59m old — live, and it must still be 11h59m old after being used.
    const authAt = Date.now() - (12 * HOUR - MINUTE)
    let carried = token({ authAt })

    for (let use = 0; use < 5; use += 1) {
      const result = sessionCallbacks.jwt({ token: carried })
      expect(result).not.toBeNull()
      expect(result!.authAt).toBe(authAt)
      carried = result!
    }

    // One more minute of ordinary use, and the same token is over. A sliding
    // clock would have carried it indefinitely.
    const past = token({ authAt: authAt - 2 * MINUTE })
    expect(sessionCallbacks.jwt({ token: past })).toBeNull()
  })

  it("refuses a token that carries no authAt rather than adopting it", () => {
    // A session issued before this clock existed. Its age is unknowable, and
    // stamping `now` would hand it a fresh full window.
    expect(sessionCallbacks.jwt({ token: token() })).toBeNull()
  })

  it("refuses an authAt that is not a finite number", () => {
    expect(sessionCallbacks.jwt({ token: token({ authAt: "yesterday" }) })).toBeNull()
    expect(sessionCallbacks.jwt({ token: token({ authAt: Number.NaN }) })).toBeNull()
    expect(sessionCallbacks.jwt({ token: token({ authAt: null }) })).toBeNull()
  })

  it("restarts the clock on a fresh authentication, and only there", () => {
    const stale = token({ authAt: Date.now() - 20 * HOUR })

    // Re-authenticating issues a live session from the same token.
    const reauthed = sessionCallbacks.jwt({ token: { ...stale }, user: { id: "person_1" } })
    expect(reauthed).not.toBeNull()
    expect(sessionCallbacks.jwt({ token: reauthed! })).not.toBeNull()

    // Merely using it does not.
    expect(sessionCallbacks.jwt({ token: { ...stale } })).toBeNull()
  })
})

describe("the session callback", () => {
  it("copies the subject onto the session user", () => {
    const session = { user: { id: "" }, expires: "" } as unknown as Session
    const result = sessionCallbacks.session({ session, token: token({ sub: "person_7" }) })

    expect(result.user.id).toBe("person_7")
  })
})
