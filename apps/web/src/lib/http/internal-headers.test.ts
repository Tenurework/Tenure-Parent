import { NextRequest } from "next/server"

import { config, middleware } from "@/middleware"
import {
  RESERVED_HEADER_PREFIX,
  RESERVED_INTERNAL_HEADERS,
  isInternalHeader,
  sanitizeInternalHeaders,
} from "./internal-headers"

/**
 * GE-021-003. The deny-list, and the boundary that enforces it.
 *
 * ## Why the expected names are written out again here
 *
 * The obvious test is `it.each(RESERVED_INTERNAL_HEADERS)`, and it is worth
 * nothing. Deleting `x-tenant-id` from the module would delete the case that
 * checks `x-tenant-id`, and the suite would go green having stopped testing
 * the thing that was removed — a test that cannot fail in the direction the
 * control fails in.
 *
 * So the names are duplicated. This list is the specification; the module's
 * export is the implementation; `expect(implementation).toEqual(specification)`
 * is the assertion. Duplication is the point, and adding a header means
 * editing both files on purpose.
 */
const MUST_BE_REFUSED = [
  "x-actor-id",
  "x-cell-id",
  "x-impersonator-id",
  "x-institution-id",
  "x-on-behalf-of",
  "x-principal-id",
  "x-principal-type",
  "x-request-context",
  "x-session-epochs",
  "x-tenant-candidate",
  "x-tenant-id",
] as const

/**
 * Headers that are equally internal-sounding and are deliberately allowed.
 *
 * This half matters as much as the other. A deny-list that grows until it
 * refuses correlation ids has broken tracing, and one that refuses
 * `x-forwarded-proto` has refused every request CloudFront sends
 * (`infrastructure/terraform/cloudfront.tf:24`). Pinning the non-members
 * makes an over-broad rule — a prefix widened to `x-`, say — fail here rather
 * than in production.
 */
const MUST_BE_ALLOWED = [
  "authorization",
  "content-type",
  "cookie",
  "host",
  "user-agent",
  "x-correlation-id",
  "x-request-id",
  "x-forwarded-proto",
  "x-forwarded-for",
  "x-amz-cf-id",
] as const

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://pilot.tenure.app${path}`, { headers })
}

describe("the reserved list", () => {
  it("is exactly the specified set, in both directions", () => {
    // Sorted so the assertion is about membership, not declaration order —
    // the module groups its entries by what they claim, with comments.
    expect([...RESERVED_INTERNAL_HEADERS].sort()).toEqual([...MUST_BE_REFUSED].sort())
  })

  it("reserves a namespace, not only the names that exist today", () => {
    expect(RESERVED_HEADER_PREFIX).toBe("x-tenure-")
  })
})

describe("isInternalHeader", () => {
  it.each(MUST_BE_REFUSED)("refuses %s", (name) => {
    expect(isInternalHeader(name)).toBe(true)
  })

  it.each(MUST_BE_ALLOWED)("allows %s", (name) => {
    expect(isInternalHeader(name)).toBe(false)
  })

  it.each([
    "x-tenure-tenant-id",
    "x-tenure-actor",
    "x-tenure-cell-route",
    "x-tenure-",
  ])("refuses anything in the reserved namespace: %s", (name) => {
    expect(isInternalHeader(name)).toBe(true)
  })

  it("is case-insensitive, because field names are", () => {
    expect(isInternalHeader("X-Tenant-Id")).toBe(true)
    expect(isInternalHeader("X-TENURE-TENANT-ID")).toBe(true)
  })

  it("folds underscores, so x_tenant_id is not a way around x-tenant-id", () => {
    expect(isInternalHeader("x_tenant_id")).toBe(true)
    expect(isInternalHeader("X_TENURE_TENANT_ID")).toBe(true)
  })

  it("tolerates surrounding whitespace", () => {
    expect(isInternalHeader("  x-tenant-id  ")).toBe(true)
  })

  it("matches whole names, not substrings", () => {
    // A rule written with `includes` would refuse both of these, and refusing
    // a customer's own `my-x-tenant-id-note` is an outage, not a defence.
    expect(isInternalHeader("not-x-tenant-id")).toBe(false)
    expect(isInternalHeader("x-tenant-id-note")).toBe(false)
  })
})

describe("sanitizeInternalHeaders", () => {
  it("names the header it removed and keeps everything else", () => {
    const { spoofed, headers } = sanitizeInternalHeaders(
      new Headers({
        "x-tenant-id": "inst_victim",
        authorization: "Bearer real-token",
        "content-type": "application/json",
      }),
    )

    expect(spoofed).toEqual(["x-tenant-id"])
    expect(headers.get("x-tenant-id")).toBeNull()
    expect(headers.get("authorization")).toBe("Bearer real-token")
    expect(headers.get("content-type")).toBe("application/json")
  })

  it("removes a namespaced header nobody has invented yet", () => {
    const { spoofed, headers } = sanitizeInternalHeaders(
      new Headers({ "x-tenure-tenant-id": "inst_victim" }),
    )

    expect(spoofed).toEqual(["x-tenure-tenant-id"])
    expect(headers.get("x-tenure-tenant-id")).toBeNull()
  })

  it("reports every offender, sorted, so the message is the same each time", () => {
    const { spoofed } = sanitizeInternalHeaders(
      new Headers({
        "x-principal-id": "usr_admin",
        "x-tenant-id": "inst_victim",
        "x-impersonator-id": "usr_support",
      }),
    )

    expect(spoofed).toEqual(["x-impersonator-id", "x-principal-id", "x-tenant-id"])
  })

  it("does not mutate the caller's headers", () => {
    const original = new Headers({ "x-tenant-id": "inst_victim" })

    sanitizeInternalHeaders(original)

    // The middleware forwards the copy. If sanitizing edited the request's own
    // headers in place, an unrelated later reader of `request.headers` would
    // silently see a different request than the one that arrived.
    expect(original.get("x-tenant-id")).toBe("inst_victim")
  })

  it("passes an ordinary request through untouched", () => {
    const { spoofed, headers } = sanitizeInternalHeaders(
      new Headers({ "x-correlation-id": "trace-1", "x-forwarded-proto": "https" }),
    )

    expect(spoofed).toEqual([])
    expect(headers.get("x-correlation-id")).toBe("trace-1")
    expect(headers.get("x-forwarded-proto")).toBe("https")
  })
})

describe("the public boundary refuses a spoofed header", () => {
  it.each(MUST_BE_REFUSED)("rejects a request carrying %s", async (name) => {
    const response = middleware(request("/dashboard", { [name]: "forged" }))

    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.headers).toContain(name)
    expect(body.error).toMatch(/never accepted from a caller/)
  })

  it("rejects x-tenure-tenant-id, which no code has ever set", async () => {
    const response = middleware(request("/dashboard", { "x-tenure-tenant-id": "inst_victim" }))

    expect(response.status).toBe(400)
    expect((await response.json()).headers).toEqual(["x-tenure-tenant-id"])
  })

  it("rejects the mixed-case spelling too", async () => {
    const response = middleware(request("/dashboard", { "X-Tenant-Id": "inst_victim" }))

    expect(response.status).toBe(400)
    expect((await response.json()).headers).toEqual(["x-tenant-id"])
  })

  it("is not cacheable, so one hostile request cannot take a route down", () => {
    const response = middleware(request("/dashboard", { "x-tenant-id": "inst_victim" }))

    // CloudFront fronts this origin. A cached 400 would be replayed to
    // everyone who asked for the same path afterwards.
    expect(response.headers.get("cache-control")).toBe("no-store")
  })
})

describe("the boundary leaves the unauthenticated surface working", () => {
  // The three routes docs/architecture/entry-points.md allowlists as the whole
  // of the unauthenticated surface. The matcher covers them; a clean request
  // to each must behave exactly as it did before middleware existed.
  it.each(["/api/health", "/api/auth/callback/credentials", "/signin"])(
    "passes %s through",
    (path) => {
      const response = middleware(request(path, { "user-agent": "ELB-HealthChecker/2.0" }))

      expect(response.status).toBe(200)
      // What `NextResponse.next()` sets. Asserting it, rather than only the
      // status, distinguishes "continue to the route" from "a 200 was
      // returned from here" — the second would mean the route never ran.
      expect(response.headers.get("x-middleware-next")).toBe("1")
    },
  )

  it("passes the root path through", () => {
    expect(middleware(request("/")).status).toBe(200)
  })

  it("does not exempt the allowlisted routes from the deny-list", async () => {
    // An ALB probe has no reason to send this. If one starts to, that is worth
    // failing rather than ignoring — a public route is the cheapest place to
    // aim a spoofed header at, precisely because it needs no credential.
    const response = middleware(request("/api/health", { "x-institution-id": "inst_victim" }))

    expect(response.status).toBe(400)
    expect((await response.json()).headers).toEqual(["x-institution-id"])
  })

  it("leaves a bearer token alone", () => {
    // /api/jobs/reminders and /api/platform/reconcile are the only two inbound
    // header reads in the application. Breaking `authorization` would break
    // the nightly reminder job and cell provisioning.
    const response = middleware(
      request("/api/jobs/reminders", { authorization: "Bearer job-secret" }),
    )

    expect(response.status).toBe(200)
  })

  it("leaves a client-supplied correlation id alone", () => {
    const response = middleware(request("/dashboard", { "x-correlation-id": "trace-1" }))

    expect(response.status).toBe(200)
  })
})

/**
 * Everything above calls `middleware()` as a function, which proves what it
 * does and says nothing about whether Next.js will ever call it. That is
 * decided by `config.matcher`, and a matcher narrowed to exclude a path turns
 * the control off for that path while leaving all fifty-odd assertions above
 * green — the exact shape of a security check that silently stops running.
 *
 * So the matcher is compiled the way the build compiles it and run the way the
 * server runs it, using Next's own two functions. This reaches into
 * `next/dist/**`, which is unstable by convention: if a future Next moves
 * either module the import throws and this suite goes red. That is the right
 * failure direction — red says "re-verify the matcher against the new
 * version", and the alternative (a `try`/`catch` that skips when the import
 * fails) would quietly stop checking the one thing this block exists to check.
 */
describe("the matcher makes Next.js actually run it", () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const {
    getMiddlewareMatchers,
  } = require("next/dist/build/analysis/get-page-static-info")
  const {
    getMiddlewareRouteMatcher,
  } = require("next/dist/shared/lib/router/utils/middleware-route-matcher")
  /* eslint-enable @typescript-eslint/no-require-imports */

  // `{}` is the whole of next.config.ts that this compilation reads: no `i18n`
  // and no `basePath` (apps/web/next.config.ts sets neither), which is what
  // makes the compiled regexp here the same one the build emits.
  const matches = getMiddlewareRouteMatcher(getMiddlewareMatchers(config.matcher, {}))
  const covers = (pathname: string) => matches(pathname, { headers: {} }, {})

  it.each([
    // The entire unauthenticated surface, per docs/architecture/entry-points.md.
    "/signin",
    "/api/health",
    "/api/auth/callback/credentials",
    "/api/auth/session",
    // The two routes that read an inbound header today.
    "/api/jobs/reminders",
    "/api/platform/reconcile",
    // Ordinary authenticated traffic, including a nested dynamic segment.
    "/",
    "/dashboard",
    "/orgs/acme/finance",
    "/api/documents/doc_1/save",
    // Static assets. The conventional matcher excludes these; this one does
    // not, so that there is no path at all where the deny-list is off.
    "/_next/static/chunks/main.js",
    "/favicon.ico",
  ])("covers %s", (pathname) => {
    expect(covers(pathname)).toBe(true)
  })
})
