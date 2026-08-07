import type { TenantContext } from "@tenure/contracts"

/**
 * GE-021-001 — deciding which tenant a request is for.
 *
 * The item's constraint is the whole design: **never trust a client header or
 * slug alone.** Both are claims made by whoever sent the request. A URL saying
 * `/rochester` is a request to be treated as Rochester, not evidence of any
 * relationship with it, and a system that reads the path and proceeds has
 * authorization by URL editing.
 *
 * So resolution is: gather every signal, decide a candidate, then **prove the
 * principal belongs to it**. The proof is the step that matters; everything
 * before it is narrowing.
 *
 * ── Why this is a pure function ─────────────────────────────────────────────
 *
 * Every lookup is injected. That is not testability theatre — it is what lets
 * the *decision* be tested exhaustively against combinations that are painful
 * to construct in a database: a session for a tenant that was deleted, a host
 * mapping to one tenant while the path claims another, a membership that
 * expired between sign-in and this request. Those are the cases that go wrong,
 * and they are unreachable through a fixture.
 */

/** Where a signal came from. Order here is not precedence — see `resolveTenant`. */
export type SignalSource = "host" | "path" | "session" | "header"

export interface ResolutionSignals {
  /** Verified host from the request. Not `X-Forwarded-Host` unless the edge signed it. */
  host: string | null
  /** First path segment, if the deployment routes tenants by path. A CLAIM. */
  pathSlug: string | null
  /** The signed-in principal, or null. */
  principalId: string | null
  /**
   * Any tenant hint that arrived in a header.
   *
   * Present in the type so the resolver can *refuse* it explicitly rather than
   * ignoring it silently. `middleware.ts` already strips internal headers at
   * the boundary; this is the second line, and it exists because "the
   * middleware handles it" is a sentence that stops being true during a
   * refactor.
   */
  headerHint: string | null
}

export type ResolutionFailure =
  | "no-signal"
  | "unknown-tenant"
  | "not-a-member"
  | "anonymous"
  | "ambiguous"
  | "header-hint-refused"
  | "tenant-not-serving"

export interface ResolvedTenant {
  // Readonly so the type agrees with the runtime. RequestContext deep-freezes
  // this object, and a mutable type over a frozen value is worse than either
  // alone: the compiler waves through an assignment that throws in production.
  // Caught by an unused @ts-expect-error in request-context.test.ts, which is
  // the only reason it surfaced at all.
  readonly tenantId: string
  readonly slug: string
  /** Which signal produced the candidate. Recorded, because "why this tenant" is asked in incidents. */
  readonly via: SignalSource
  /** The cell this tenant is served from. */
  readonly cell: string
}

export type Resolution =
  | { ok: true; tenant: ResolvedTenant }
  | { ok: false; failure: ResolutionFailure; detail: string }

/** What the resolver needs from the world. Injected so the decision stays testable. */
export interface ResolverPorts {
  /** Tenant registry lookup by host. Null when no tenant claims that host. */
  tenantByHost(host: string): Promise<{ tenantId: string; slug: string; cell: string; serving: boolean } | null>
  /** Tenant registry lookup by slug. */
  tenantBySlug(slug: string): Promise<{ tenantId: string; slug: string; cell: string; serving: boolean } | null>
  /**
   * Does this principal currently belong to this tenant?
   *
   * "Currently" is load-bearing. A membership that existed at sign-in and has
   * since been revoked must fail here — which is why this is asked per request
   * rather than baked into the session at login.
   */
  isMember(principalId: string, tenantId: string): Promise<boolean>
}

/**
 * Hosts that are the platform itself and can never be a tenant.
 *
 * A tenant that managed to claim one of these would receive requests intended
 * for the console.
 */
const PLATFORM_HOSTS = new Set(["platform.tenurework.com", "localhost", "127.0.0.1"])

/**
 * Path segments that are the application's own routes.
 *
 * Without this, `/settings` resolves as a tenant slug claim, fails lookup, and
 * returns `unknown-tenant` for a page that has nothing to do with tenancy.
 */
const RESERVED_SEGMENTS = new Set([
  "api", "signin", "signout", "admin", "platform", "tenants", "_next",
  "favicon.ico", "settings", "search", "dashboard", "notifications",
])

export async function resolveTenant(
  signals: ResolutionSignals,
  ports: ResolverPorts,
): Promise<Resolution> {
  // A tenant hint in a header is refused outright, and named in the failure so
  // it appears in logs rather than being quietly dropped. Silently ignoring an
  // attempt is indistinguishable from never having received one.
  if (signals.headerHint) {
    return {
      ok: false,
      failure: "header-hint-refused",
      detail:
        "A tenant hint arrived in a header. Headers are claims from the caller; " +
        "tenancy is resolved from the verified host or path and proved against membership.",
    }
  }

  const host = signals.host?.toLowerCase().split(":")[0] ?? null
  const pathSlug = signals.pathSlug?.toLowerCase() ?? null

  const hostCandidate =
    host && !PLATFORM_HOSTS.has(host) ? await ports.tenantByHost(host) : null

  const pathCandidate =
    pathSlug && !RESERVED_SEGMENTS.has(pathSlug) ? await ports.tenantBySlug(pathSlug) : null

  // Both present and disagreeing is not a precedence question. A host bound to
  // one tenant while the path claims another is either a misconfiguration or an
  // attempt, and picking a winner would make one of those succeed.
  if (hostCandidate && pathCandidate && hostCandidate.tenantId !== pathCandidate.tenantId) {
    return {
      ok: false,
      failure: "ambiguous",
      detail: "The host and the path name different tenants. Refusing rather than choosing one.",
    }
  }

  const candidate = hostCandidate ?? pathCandidate
  const via: SignalSource = hostCandidate ? "host" : "path"

  if (!candidate) {
    // Distinguish "nothing to go on" from "something, and it is not a tenant".
    // The first is a platform route; the second is worth noticing.
    const claimed = (host && !PLATFORM_HOSTS.has(host)) || (pathSlug && !RESERVED_SEGMENTS.has(pathSlug))
    return claimed
      ? { ok: false, failure: "unknown-tenant", detail: "No tenant is registered for that host or slug." }
      : { ok: false, failure: "no-signal", detail: "The request names no tenant." }
  }

  // Registered but not serving — suspended, hibernated, offboarding. A tenant
  // in that state must not receive traffic, and saying so beats a 404 that
  // reads as "you typed it wrong".
  if (!candidate.serving) {
    return {
      ok: false,
      failure: "tenant-not-serving",
      detail: `"${candidate.slug}" is registered but not currently serving requests.`,
    }
  }

  if (!signals.principalId) {
    return {
      ok: false,
      failure: "anonymous",
      detail: "A tenant was identified but nobody is signed in; membership cannot be proved.",
    }
  }

  // The step everything else exists to reach.
  if (!(await ports.isMember(signals.principalId, candidate.tenantId))) {
    return {
      ok: false,
      failure: "not-a-member",
      // Deliberately does not confirm the tenant exists. Someone probing slugs
      // learns the same thing from a real tenant they cannot reach and one that
      // was never there.
      detail: "No current membership for that tenant.",
    }
  }

  return {
    ok: true,
    tenant: { tenantId: candidate.tenantId, slug: candidate.slug, via, cell: candidate.cell },
  }
}

/**
 * Build the request context from a resolution, for the rest of the request.
 *
 * Separate from `resolveTenant` because resolution can fail and a context
 * cannot: there is no such thing as a context for an unresolved tenant, and a
 * function returning a partially-filled one would invite reading it.
 */
export function contextFrom(
  tenant: ResolvedTenant,
  actor: { principalId: string; kind: TenantContext["actorKind"] },
  request: {
    channel: string
    correlationId: string
    configRevision: string
    /**
     * The tenant's money-mode, resolved from its published configuration
     * (`paymentModeForInstitution`). Required rather than defaulted here: a
     * context built with a mode this function invented would be a mode nobody
     * published, recorded as though somebody had.
     */
    environment: TenantContext["environment"]
    /** The legal entity acted for, or null for the tenant itself. */
    legalEntityId: string | null
    at: string
  },
): TenantContext {
  return {
    tenantId: tenant.tenantId,
    actorId: actor.principalId,
    actorKind: actor.kind,
    channel: request.channel,
    correlationId: request.correlationId,
    configRevision: request.configRevision,
    environment: request.environment,
    legalEntityId: request.legalEntityId,
    at: request.at,
  }
}

/** Exported for the tests that assert the lists are what they claim to be. */
export const __policy = { PLATFORM_HOSTS, RESERVED_SEGMENTS }
