/**
 * GE-021-003 — headers this platform reserves for itself, and the rule that
 * stops a client from setting one.
 *
 * The design the architecture is heading toward (PLATFORM-ARCHITECTURE.md
 * §"The missing middleware", lines 4241-4314) has middleware resolve the tenant
 * and the principal and hand them to Node-side code **as request headers**:
 *
 *     headers.set("x-tenant-id", routed.tenantId)
 *     headers.set("x-principal-id", claims.pid)
 *
 * The moment any handler reads one of those, an inbound header of the same name
 * is a complete authentication and tenancy bypass — `curl -H "x-tenant-id:
 * <victim>"` and you are inside someone else's institution as whoever you like.
 * The header does not have to be trusted deliberately for this to happen: it is
 * enough that middleware sets it and a handler reads it, because `Headers` has
 * no notion of who wrote an entry. `NextResponse.next({ request: { headers } })`
 * merges the middleware's headers over the client's, so a header middleware
 * happens *not* to set on some path is passed straight through from the client.
 *
 * So the deny-list is installed first, while nothing reads these names at all.
 * Today the entire application reads exactly two inbound headers, both
 * `authorization` (`api/jobs/reminders/route.ts`, `api/platform/reconcile/route.ts`).
 * That is what makes this cheap now: there is no caller to break, no allowlist
 * to negotiate, and no existing integration quietly depending on being able to
 * send one. Doing it after GE-021-001/002 land means auditing every reader.
 *
 * ## What is on the list, and what deliberately is not
 *
 * A header earns a place here by *asserting authority* — by answering "which
 * tenant" or "which actor" in a way the server would otherwise have to derive
 * from a verified host, a verified session, or a database row.
 *
 * `x-correlation-id` and `x-request-id` are therefore **not** on the list, even
 * though they are equally internal-sounding and appear in the same architecture
 * snippet. A client-supplied correlation id is a tracing convenience: the worst
 * a forged one does is corrupt a log join, and accepting one is what makes a
 * trace span a caller's system and ours. The architecture explicitly accepts
 * the client's value when present (line 4282). Denying them would break
 * distributed tracing to buy nothing.
 *
 * The `x-forwarded-*` family is also absent. Those are the load balancer's to
 * manage — CloudFront sets `X-Forwarded-Proto` on every origin request
 * (`infrastructure/terraform/cloudfront.tf:24`) and ALB appends the rest.
 * Rejecting them would refuse every production request.
 *
 * This module is deliberately free of `server-only`, of `next/*`, and of every
 * Node builtin. It has to run in the edge runtime that executes middleware, and
 * it has to be directly assertable from jest without a Next request lifecycle.
 */

/**
 * Every header beginning with this prefix belongs to the platform.
 *
 * The explicit list below covers the names the architecture has already
 * written down. The prefix covers the ones it has not — which is the more
 * valuable half, because a deny-list assembled from names that exist today is
 * exactly one commit behind the name someone adds tomorrow. Reserving a
 * namespace means a future `x-tenure-cell-route` is refused from the outside
 * from the day it is invented, with no edit here.
 */
export const RESERVED_HEADER_PREFIX = "x-tenure-"

/**
 * Internal headers that predate the reserved prefix, or that follow an
 * industry convention and so cannot carry it.
 *
 * Each entry is a name that answers "which tenant" or "which actor". Nothing
 * else belongs here; see the module comment for why correlation ids do not.
 */
export const RESERVED_INTERNAL_HEADERS: readonly string[] = [
  // Answers "which tenant". PLATFORM-ARCHITECTURE.md:4256, :4280, :4298.
  "x-tenant-id",
  // The pre-authorization form of the same claim. PLATFORM-ARCHITECTURE.md:6100.
  "x-tenant-candidate",
  // This schema's own word for a tenant: the model is `Institution` and the
  // scoping column is `institutionId` (`lib/tenancy/context.ts`). A spoof
  // attempt written against this repository would try this name first.
  "x-institution-id",
  // Answers "which actor". PLATFORM-ARCHITECTURE.md:4256, :4281, :4299.
  "x-principal-id",
  // `TenantScope.actor.principalType` — the difference between `user` and
  // `system`, i.e. between a person and an unaudited superuser.
  "x-principal-type",
  // The ledger item's own vocabulary: "tenant/actor headers".
  "x-actor-id",
  // Support staff acting inside a customer tenant. PLATFORM-ARCHITECTURE.md:4256.
  "x-impersonator-id",
  // The delegation convention (Graph, Elastic). This product has real
  // delegation (`lib/delegation.ts`, `setDelegation`/`revokeDelegation`), so
  // actor substitution is a live concept here rather than a hypothetical one.
  "x-on-behalf-of",
  // Membership and policy epochs — the check that makes a stale JWT die.
  // PLATFORM-ARCHITECTURE.md:4281, :4302. Forging it re-validates a revoked
  // session.
  "x-session-epochs",
  // The whole request context serialized into one header.
  // PLATFORM-ARCHITECTURE.md:4256.
  "x-request-context",
  // Which cell serves this tenant (GE-030). A cell claim chooses a data plane.
  "x-cell-id",
]

/**
 * Normalize a header name for comparison.
 *
 * Case first: HTTP field names are case-insensitive (RFC 9110 §5.1), and while
 * `Headers` lowercases on the way in, this function is also called on names
 * that never went through a `Headers` — a middleware config, a test, a log line.
 *
 * Underscores second: `x_tenant_id` is a syntactically valid field name, and
 * enough of the stack between a browser and this code treats `_` and `-` as
 * interchangeable (CGI's `HTTP_X_TENANT_ID`, nginx's `underscores_in_headers`,
 * several API gateways) that treating them as different names here would leave
 * a spelling of the same claim outside the fence. No legitimate header is
 * distinguished from another only by that character, so folding it is free.
 */
function normalize(name: string): string {
  return name.trim().toLowerCase().replaceAll("_", "-")
}

/** True when `name` is a header the platform reserves and a client may not set. */
export function isInternalHeader(name: string): boolean {
  const normalized = normalize(name)
  return (
    normalized.startsWith(RESERVED_HEADER_PREFIX) ||
    RESERVED_INTERNAL_HEADERS.includes(normalized)
  )
}

export type SanitizedHeaders = {
  /**
   * The reserved headers the client actually sent, lowercased and sorted.
   *
   * Sorted so a rejection body and a log line are the same for the same
   * request regardless of header order, which is what makes them assertable.
   */
  spoofed: string[]
  /**
   * The request's headers with every reserved name removed.
   *
   * Always a new `Headers`; the input is never mutated. Callers forward this
   * rather than the original so that "no handler downstream can observe a
   * client-set internal header" holds by construction, on every path, instead
   * of holding because the rejection branch happened to be taken.
   */
  headers: Headers
}

/**
 * Split an inbound request's headers into what was smuggled and what is safe
 * to forward.
 *
 * Both halves are returned rather than one or the other because the two jobs
 * are different. Removing the header is what makes the request *safe*;
 * reporting it is what makes the attempt *visible*. A boundary that silently
 * strips is indistinguishable from one that was never installed — the first
 * evidence anyone gets is the incident.
 */
export function sanitizeInternalHeaders(incoming: Headers): SanitizedHeaders {
  const headers = new Headers(incoming)
  const spoofed: string[] = []

  // Iterate the copy's names into an array before deleting: mutating a
  // `Headers` while iterating it is not specified to be stable.
  for (const name of [...headers.keys()]) {
    if (!isInternalHeader(name)) continue
    spoofed.push(name.toLowerCase())
    headers.delete(name)
  }

  spoofed.sort()
  return { spoofed, headers }
}
