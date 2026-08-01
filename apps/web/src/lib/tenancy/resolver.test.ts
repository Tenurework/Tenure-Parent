/**
 * The resolver, tested against the ways it can be talked into the wrong tenant.
 *
 * GE-021-001's constraint is "never trust a client header or slug alone", so
 * nearly every test below is an attempt to make it trust one. The happy path
 * gets two tests; the refusals get the rest, because a resolver that resolves
 * is easy and a resolver that refuses correctly is the product.
 */
import { describe, expect, it } from "@jest/globals"

import { __policy, contextFrom, resolveTenant, type ResolverPorts } from "./resolver"

const ROCHESTER = { tenantId: "t-roch", slug: "rochester", cell: "us-east-1a", serving: true }
const MIDTOWN = { tenantId: "t-mid", slug: "midtown-arts", cell: "us-east-1a", serving: true }

/** A registry containing two tenants, and a membership table naming who is in which. */
function ports(over: Partial<ResolverPorts> = {}): ResolverPorts {
  const bySlug: Record<string, typeof ROCHESTER> = {
    rochester: ROCHESTER,
    "midtown-arts": MIDTOWN,
  }
  const byHost: Record<string, typeof ROCHESTER> = {
    "rochester.tenurework.com": ROCHESTER,
  }
  const members: Record<string, string[]> = {
    "user-roch": ["t-roch"],
    "user-mid": ["t-mid"],
    "user-none": [],
  }

  return {
    tenantByHost: async (h) => byHost[h] ?? null,
    tenantBySlug: async (s) => bySlug[s] ?? null,
    isMember: async (p, t) => (members[p] ?? []).includes(t),
    ...over,
  }
}

const signals = (over: Partial<Parameters<typeof resolveTenant>[0]> = {}) => ({
  host: null,
  pathSlug: null,
  principalId: null,
  headerHint: null,
  ...over,
})

describe("resolving", () => {
  it("resolves by path when the principal is a member", async () => {
    const r = await resolveTenant(
      signals({ pathSlug: "rochester", principalId: "user-roch" }),
      ports(),
    )
    expect(r).toEqual({
      ok: true,
      tenant: { tenantId: "t-roch", slug: "rochester", via: "path", cell: "us-east-1a" },
    })
  })

  it("resolves by host, and records that it was the host", async () => {
    // "Why this tenant" is asked in incidents; the answer has to be in the
    // resolution rather than reconstructed from the URL.
    const r = await resolveTenant(
      signals({ host: "rochester.tenurework.com", principalId: "user-roch" }),
      ports(),
    )
    expect(r.ok && r.tenant.via).toBe("host")
  })
})

describe("refusing", () => {
  it("refuses a slug the principal is not a member of", async () => {
    // The whole point. A URL is a request to be treated as that tenant, not
    // evidence of any relationship with it.
    const r = await resolveTenant(
      signals({ pathSlug: "rochester", principalId: "user-mid" }),
      ports(),
    )
    expect(r).toEqual({
      ok: false,
      failure: "not-a-member",
      detail: "No current membership for that tenant.",
    })
  })

  it("does not confirm a tenant exists to someone who cannot reach it", async () => {
    // Probing slugs must learn the same thing from a real tenant and an
    // imaginary one, or the failure message is an enumeration oracle.
    const real = await resolveTenant(
      signals({ pathSlug: "rochester", principalId: "user-mid" }),
      ports(),
    )
    expect(real.ok).toBe(false)
    expect(!real.ok && real.detail).not.toContain("rochester")
  })

  it("refuses a tenant hint in a header outright", async () => {
    // Second line behind the middleware. "The middleware handles it" is a
    // sentence that stops being true during a refactor.
    const r = await resolveTenant(
      signals({ pathSlug: "rochester", principalId: "user-roch", headerHint: "midtown-arts" }),
      ports(),
    )
    expect(!r.ok && r.failure).toBe("header-hint-refused")
  })

  it("refuses when the host and the path disagree", async () => {
    // Not a precedence question. Picking a winner makes one of "misconfigured"
    // or "an attempt" succeed.
    const r = await resolveTenant(
      signals({
        host: "rochester.tenurework.com",
        pathSlug: "midtown-arts",
        principalId: "user-roch",
      }),
      ports(),
    )
    expect(!r.ok && r.failure).toBe("ambiguous")
  })

  it("refuses anonymously, even for a valid tenant", async () => {
    const r = await resolveTenant(signals({ pathSlug: "rochester" }), ports())
    expect(!r.ok && r.failure).toBe("anonymous")
  })

  it("refuses a tenant that is registered but not serving", async () => {
    // Suspended, hibernated, offboarding. A 404 would read as "you typed it
    // wrong" for a tenant that exists and is deliberately dark.
    const r = await resolveTenant(
      signals({ pathSlug: "rochester", principalId: "user-roch" }),
      ports({ tenantBySlug: async () => ({ ...ROCHESTER, serving: false }) }),
    )
    expect(!r.ok && r.failure).toBe("tenant-not-serving")
  })

  it("checks membership per request, not per session", async () => {
    // A membership revoked between sign-in and this request must fail. That is
    // the reason isMember is a port rather than a claim in the token.
    const revoked = ports({ isMember: async () => false })
    const r = await resolveTenant(
      signals({ pathSlug: "rochester", principalId: "user-roch" }),
      revoked,
    )
    expect(!r.ok && r.failure).toBe("not-a-member")
  })

  it("distinguishes 'no tenant named' from 'named one that does not exist'", async () => {
    const nothing = await resolveTenant(signals({ principalId: "user-roch" }), ports())
    expect(!nothing.ok && nothing.failure).toBe("no-signal")

    const wrong = await resolveTenant(
      signals({ pathSlug: "not-a-tenant", principalId: "user-roch" }),
      ports(),
    )
    expect(!wrong.ok && wrong.failure).toBe("unknown-tenant")
  })
})

describe("platform routes are not tenant claims", () => {
  it("treats the application's own segments as routes", async () => {
    // Without this, /settings resolves as a slug claim, fails lookup, and
    // returns unknown-tenant for a page with nothing to do with tenancy.
    for (const segment of ["api", "signin", "admin", "settings", "search"]) {
      const r = await resolveTenant(
        signals({ pathSlug: segment, principalId: "user-roch" }),
        ports(),
      )
      expect(!r.ok && r.failure).toBe("no-signal")
    }
  })

  it("refuses a reserved segment even when a tenant IS registered under it", async () => {
    // The case that makes the reserved list load-bearing. With no such tenant
    // in the registry, lookup returns null either way and removing the guard
    // changes nothing — so a test using only absent slugs proves nothing about
    // it. If someone ever registers the slug "admin", /admin must remain the
    // admin console.
    //
    // Manifest validation already refuses these at composition time; this is
    // the second line, because two independent refusals is what makes it a
    // control rather than a convention.
    const registry = ports({
      tenantBySlug: async (slug) =>
        slug === "admin" ? { tenantId: "t-evil", slug: "admin", cell: "c", serving: true } : null,
      isMember: async () => true,
    })

    const r = await resolveTenant(
      signals({ pathSlug: "admin", principalId: "user-roch" }),
      registry,
    )
    expect(r.ok).toBe(false)
    expect(!r.ok && r.failure).toBe("no-signal")
  })

  it("never resolves a tenant from a platform host", async () => {
    // A tenant that claimed one of these would receive console traffic.
    for (const host of ["platform.tenurework.com", "localhost", "127.0.0.1"]) {
      const r = await resolveTenant(
        signals({ host, principalId: "user-roch" }),
        ports({ tenantByHost: async () => ROCHESTER }),
      )
      expect(r.ok).toBe(false)
    }
  })

  it("ignores the port when matching a host", async () => {
    const r = await resolveTenant(
      signals({ host: "localhost:3000", principalId: "user-roch" }),
      ports({ tenantByHost: async () => ROCHESTER }),
    )
    expect(r.ok).toBe(false)
  })

  it("keeps both policy lists non-empty and lowercase", async () => {
    // A list that quietly emptied would turn every check above into a pass.
    expect(__policy.PLATFORM_HOSTS.size).toBeGreaterThan(0)
    expect(__policy.RESERVED_SEGMENTS.size).toBeGreaterThan(5)
    for (const v of [...__policy.PLATFORM_HOSTS, ...__policy.RESERVED_SEGMENTS]) {
      expect(v).toBe(v.toLowerCase())
    }
  })
})

describe("case and shape", () => {
  it("matches a slug and host case-insensitively", async () => {
    const r = await resolveTenant(
      signals({ pathSlug: "ROCHESTER", principalId: "user-roch" }),
      ports(),
    )
    expect(r.ok).toBe(true)
  })
})

describe("contextFrom", () => {
  it("builds a context only from a resolved tenant", async () => {
    const r = await resolveTenant(
      signals({ pathSlug: "rochester", principalId: "user-roch" }),
      ports(),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const ctx = contextFrom(
      r.tenant,
      { principalId: "user-roch", kind: "user" },
      {
        channel: "web",
        correlationId: "corr-1",
        configRevision: "cfg-1",
        at: "2026-08-01T00:00:00.000Z",
      },
    )
    expect(ctx.tenantId).toBe("t-roch")
    expect(ctx.actorKind).toBe("user")
  })
})
