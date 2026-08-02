import { connectionsToOffer } from "./keying"

/**
 * GE-042-001 — where sign-in starts, and what it refuses to tell you.
 *
 * Bible §9.1, in one sentence:
 *
 *   > The login resolver starts from verified tenant domain/subdomain, tenant
 *   > slug, signed invitation, prior secure session, or normalized work email
 *   > used only as a discovery hint. It returns safe branding and allowed
 *   > methods through an opaque transaction. It never reveals whether a person
 *   > exists or grants membership from an email domain.
 *
 * Five ways in, one shape out, and a specific thing it must never say.
 *
 * ## What is secret here, and what is not
 *
 * Tenant existence is *not* secret and pretending otherwise would be theatre:
 * tenants are served at `platform.tenurework.com/<slug>`, so anybody can learn
 * which slugs resolve by visiting them. A verified domain is proved by a public
 * DNS TXT record. Neither is worth hiding, and hiding them would cost the thing
 * discovery exists for — showing somebody the right sign-in button.
 *
 * **Person existence is secret**, absolutely. Whether `a.person@rochester.example`
 * has an account is the fact an attacker actually wants, and it is the one this
 * resolver never has an opinion about. `resolveLogin` does not take a person,
 * does not query for one, and returns the same shape whether or not one exists —
 * which is easy to hold precisely because it never learns.
 *
 * ## An unknown identifier gets an answer, not an error
 *
 * Returning "no such tenant" for an unknown slug and branding for a known one
 * is a difference somebody can measure, and it makes discovery a scanner. Every
 * outcome here returns the same `LoginOffer` shape; an unknown identifier gets
 * the platform's own branding and its default methods, which is exactly what a
 * person who mistyped their slug should see.
 *
 * ## The transaction is opaque because a decodable one is a probe
 *
 * The handle the browser carries back must not encode the tenant, the email, or
 * anything else — not because those are secret in themselves, but because a
 * decodable handle is one an attacker can *construct*, and a constructed handle
 * turns the callback into a second discovery surface with none of these rules.
 */

export const LOGIN_ENTRY_POINTS = ["domain", "slug", "invitation", "session", "email-hint"] as const
export type LoginEntryPoint = (typeof LOGIN_ENTRY_POINTS)[number]

/** Branding safe to show anyone who reaches the sign-in page. */
export interface SafeBranding {
  /** The tenant's display name, or the platform's when nothing resolved. */
  displayName: string
  /** Wordmark text. Rendered as text, never as markup. */
  wordmark: string
  /** Accent colour, already contrast-checked against its text colour. */
  primaryColor: string
  primaryTextColor: string
}

export const PLATFORM_BRANDING: SafeBranding = {
  displayName: "Tenure",
  wordmark: "Tenure",
  primaryColor: "#198052",
  primaryTextColor: "#ffffff",
}

export interface LoginOffer {
  /** Opaque. Meaningful only to the server that issued it. */
  transaction: string
  branding: SafeBranding
  /** Connection ids to offer, in a stable order. Empty is a valid answer. */
  connectionIds: readonly string[]
  /** Whether invitation-only local sign-in is offered alongside them. */
  offerLocalSignIn: boolean
  /**
   * Which entry point produced this.
   *
   * For the server's own log and for tests. Deliberately not something the
   * browser is told: "we resolved you by email hint" is a statement about what
   * the server knows, and a person probing should not be able to tell a hint
   * that matched from one that did not.
   */
  readonly via: LoginEntryPoint | "unresolved"
}

export interface DiscoverableTenant {
  tenantId: string
  slug: string
  branding: SafeBranding
  /** Connection ids this tenant offers, already filtered to usable ones. */
  connectionIds: readonly string[]
  /** Whether tenant policy permits invitation-only local auth (GE-041-004). */
  localSignIn: boolean
}

export interface DiscoveryInput {
  /** The host the request arrived on, for domain/subdomain resolution. */
  host?: string
  /** A slug from the path. */
  slug?: string
  /** A signed invitation's tenant, already verified by the caller. */
  invitationTenantId?: string
  /** The tenant of a prior secure session, already verified by the caller. */
  sessionTenantId?: string
  /** A work email, used only as a hint. Never trusted as identity. */
  email?: string
}

export interface DiscoveryContext {
  tenants: readonly DiscoverableTenant[]
  /** Verified domains, from `@tenure/provisioning`'s registry. */
  verifiedDomains: readonly { domain: string; tenantId: string; state: string }[]
  /** Connection ids by tenant, for the email-hint path. */
  connectionsByTenant: Readonly<Record<string, readonly string[]>>
  /** Mints an opaque handle. Injected so this stays pure and testable. */
  mintTransaction: () => string
}

/**
 * The order entry points are tried, strongest evidence first.
 *
 * A prior session and a signed invitation are things the *server* verified; a
 * host and a slug are things the request asserts but which map to public facts;
 * an email is a hint the person typed. Trying them in that order means a person
 * with a live session at one tenant is not moved elsewhere because they also
 * typed an address, which is the confusing case.
 */
export function resolveLogin(input: DiscoveryInput, context: DiscoveryContext): LoginOffer {
  const byId = (tenantId: string) => context.tenants.find((t) => t.tenantId === tenantId) ?? null

  const attempts: readonly [LoginEntryPoint, DiscoverableTenant | null][] = [
    ["session", input.sessionTenantId ? byId(input.sessionTenantId) : null],
    ["invitation", input.invitationTenantId ? byId(input.invitationTenantId) : null],
    ["domain", input.host ? tenantForHost(input.host, context) : null],
    ["slug", input.slug ? context.tenants.find((t) => t.slug === normalise(input.slug!)) ?? null : null],
  ]

  for (const [via, tenant] of attempts) {
    if (tenant) {
      return {
        transaction: context.mintTransaction(),
        branding: tenant.branding,
        connectionIds: [...tenant.connectionIds].sort(),
        offerLocalSignIn: tenant.localSignIn,
        via,
      }
    }
  }

  // The email hint. It may only narrow which connections to *offer* — never
  // which tenant somebody belongs to, and never whether they have an account
  // (GE-040-002's `connectionsToOffer` has no access to memberships at all).
  if (input.email) {
    const offered = connectionsToOffer(input.email, context.verifiedDomains, context.connectionsByTenant)
    if (offered.length > 0) {
      return {
        transaction: context.mintTransaction(),
        // Platform branding, not the tenant's. Showing a university's crest
        // because somebody typed an address ending in its domain confirms that
        // the domain is claimed by a tenant here — to anybody who guesses.
        branding: PLATFORM_BRANDING,
        connectionIds: offered,
        offerLocalSignIn: false,
        via: "email-hint",
      }
    }
  }

  // Unknown. Same shape, platform branding, platform default — which is what a
  // person who mistyped their slug should see, and what a scanner learns
  // nothing from.
  return {
    transaction: context.mintTransaction(),
    branding: PLATFORM_BRANDING,
    connectionIds: [],
    offerLocalSignIn: false,
    via: "unresolved",
  }
}

const normalise = (value: string) => value.trim().toLowerCase()

/**
 * The tenant a host belongs to.
 *
 * Exact match on a verified domain, or on a subdomain's first label matching a
 * tenant slug. Suffix matching is deliberately absent: `notrochester.example`
 * ends with `rochester.example`, and a suffix match would hand a university's
 * branding to anybody who could register that name.
 */
export function tenantForHost(host: string, context: DiscoveryContext): DiscoverableTenant | null {
  const hostname = normalise(host).split(":")[0]

  const verified = context.verifiedDomains.find(
    (entry) => entry.state === "VERIFIED" && normalise(entry.domain) === hostname,
  )
  if (verified) return context.tenants.find((t) => t.tenantId === verified.tenantId) ?? null

  const [label] = hostname.split(".")
  if (!label) return null
  return context.tenants.find((t) => t.slug === label) ?? null
}

/**
 * Discovery is the cheapest enumeration surface there is, so it is limited.
 *
 * Keyed on the caller, never on what they asked about. A limiter keyed by email
 * would itself be an oracle — different behaviour for an address that had been
 * asked about before is exactly the signal being denied everywhere else.
 */
export const DISCOVERY_WINDOW_SECONDS = 60
export const DISCOVERY_MAX_PER_WINDOW = 20

export interface RateLimitState {
  /** Opaque caller key — a hashed source address, a session, an API client. */
  callerKey: string
  windowStartedAt: string
  count: number
}

export interface RateLimitDecision {
  allowed: boolean
  next: RateLimitState
  /** Seconds until the window resets. Shown as a wait, never as a count. */
  retryAfterSeconds: number
}

export function checkDiscoveryRate(state: RateLimitState, at: Date): RateLimitDecision {
  const started = Date.parse(state.windowStartedAt)
  const elapsed = Number.isNaN(started) ? Infinity : (at.getTime() - started) / 1000

  if (elapsed >= DISCOVERY_WINDOW_SECONDS) {
    return {
      allowed: true,
      next: { callerKey: state.callerKey, windowStartedAt: at.toISOString(), count: 1 },
      retryAfterSeconds: 0,
    }
  }

  const count = state.count + 1
  const next: RateLimitState = { ...state, count }
  // The count is incremented even when refused, so hammering the endpoint
  // extends nothing but also gains nothing — and the caller cannot tell how
  // close they were by watching the response change.
  if (count > DISCOVERY_MAX_PER_WINDOW) {
    return {
      allowed: false,
      next,
      retryAfterSeconds: Math.ceil(DISCOVERY_WINDOW_SECONDS - elapsed),
    }
  }

  return { allowed: true, next, retryAfterSeconds: 0 }
}

/**
 * Whether an offer would tell somebody something it should not.
 *
 * A guard against the shapes that leak, expressed as a function so it can be
 * asserted rather than reviewed: an offer must never carry an email, a person
 * id, or a tenant id, and its transaction must not contain any input that
 * produced it.
 */
export function offerLeaks(offer: LoginOffer, input: DiscoveryInput): readonly string[] {
  const leaks: string[] = []
  const serialised = JSON.stringify({ ...offer, via: undefined })

  for (const [name, value] of Object.entries(input)) {
    if (typeof value !== "string" || value.length === 0) continue
    if (serialised.includes(value)) leaks.push(`${name} appears in the offer`)
  }
  if (offer.transaction.includes("@")) leaks.push("the transaction contains an address")

  return leaks
}
