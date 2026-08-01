import { NextResponse, type NextRequest } from "next/server"

import { sanitizeInternalHeaders } from "@/lib/http/internal-headers"

/**
 * GE-021-003 — the public boundary.
 *
 * The whole of this file is one control: a request arriving from outside may
 * not carry a header the platform reserves for talking to itself. What those
 * headers are, and why each is on the list, lives in
 * `lib/http/internal-headers.ts` — kept out of this file so the policy can be
 * asserted directly under jest, which cannot instantiate a Next request
 * lifecycle, and so that a change to the list is reviewed as a change to a
 * list rather than buried in routing code.
 *
 * This is the first middleware in the application. It resolves nothing and
 * authorizes nothing; GE-021-001 and GE-021-002 will add tenant resolution and
 * request context here once the tenant and cell registries exist (GE-030). It
 * is landing ahead of them on purpose. A deny-list is trivial to install while
 * no code reads these headers and expensive once code does, and the ordering
 * matters in one direction only: adding the readers first means shipping a
 * window in which the bypass is live.
 */

/**
 * Every path. No exclusions, including `/_next/static` and `/favicon.ico`.
 *
 * Excluding static assets is the conventional matcher and it is a real
 * saving, but it buys the saving by creating a set of paths where the control
 * is off — and "the control is off for paths matching this regex" is a
 * sentence that ages badly, because the regex is written against the routes
 * that exist when it is written. Next.js resolves `/_next/*` before user
 * routing, so the exclusion cannot be turned into a route, but the exclusion
 * would still have to be re-audited every time the matcher is edited for some
 * unrelated reason. The work per request is a handful of string comparisons
 * over the header names actually present; that is cheaper than the audit.
 *
 * The three routes `docs/architecture/entry-points.md` allowlists as the
 * entire unauthenticated surface — `/api/auth/[...nextauth]`, `/api/health`
 * and `/signin` — are covered by this matcher and are unaffected by it. A
 * request that carries no reserved header passes through untouched, so an ALB
 * health probe, a NextAuth callback and a sign-in page load behave exactly as
 * they did before this file existed. They are not exempted, either: a health
 * probe has no reason to send `x-tenant-id`, and if something starts to, that
 * is worth failing over rather than ignoring.
 */
export const config = {
  matcher: "/:path*",
}

export function middleware(request: NextRequest) {
  const { spoofed, headers } = sanitizeInternalHeaders(request.headers)

  if (spoofed.length > 0) {
    // 400, not 403. 403 says "you are not authorized", which invites the
    // client to authenticate differently and try again; no credential makes
    // this request acceptable. RFC 9110 §15.5.1 — the server will not process
    // the request because of something it perceives to be a client error — is
    // exactly the situation.
    //
    // The offending names are echoed back. They are already public (this
    // repository is public and the list is in it), and a caller that trips
    // this by accident — a proxy injecting a header, an SDK with an
    // over-eager default — is otherwise left debugging a bare 400 against a
    // boundary whose rules it cannot see.
    return NextResponse.json(
      {
        error:
          "This request carried a header reserved for Tenure's internal use. " +
          "Tenant and actor are resolved by the server; they are never accepted from a caller.",
        headers: spoofed,
      },
      {
        status: 400,
        headers: {
          // CloudFront sits in front of this origin. A cached 400 would be
          // replayed to every subsequent caller of the same path, turning one
          // hostile request into an outage for that route.
          "cache-control": "no-store",
        },
      },
    )
  }

  // The sanitized headers, not `request.headers`. On this branch the two have
  // the same contents — `spoofed` is empty, so nothing was removed — and it is
  // still the sanitized value that is forwarded, so the guarantee downstream
  // code relies on ("a header on the reserved list did not come from the
  // client") is a property of what this function passes on rather than a
  // conclusion drawn from which branch ran.
  return NextResponse.next({ request: { headers } })
}
