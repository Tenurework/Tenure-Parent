/**
 * STUDIO-130-002 — RFC 7807 problem details, and the only way this control
 * plane returns a non-2xx.
 *
 * The rule is the value. When every failure is a problem document with a stable
 * `type`, a caller can tell a denial from a throttle from a stale precondition
 * BY FIELD, and a poller can back off on 429 without pattern-matching English.
 * When failures are prose, the first client written against them breaks the day
 * somebody improves the wording.
 *
 * `correlationId` is on every one of them. A support conversation that starts
 * "it failed" and a support conversation that starts "it failed, here is the id
 * in the response" are different conversations.
 *
 * Nothing here echoes a value the caller sent. These responses reach logs and
 * screenshots, and the same discipline `@tenure/contracts` applies to
 * `ContractViolation` applies here.
 */

/** Stable problem types. The URI is a namespace, not a fetchable page. */
export const PROBLEM = {
  unauthenticated: "https://tenure.dev/problems/unauthenticated",
  forbidden: "https://tenure.dev/problems/forbidden",
  notFound: "https://tenure.dev/problems/unknown-surface",
  badRequest: "https://tenure.dev/problems/invalid-request",
  idempotencyKeyRequired: "https://tenure.dev/problems/idempotency-key-required",
  idempotencyConflict: "https://tenure.dev/problems/idempotency-conflict",
  rateLimited: "https://tenure.dev/problems/rate-limited",
  surfaceNotConfigured: "https://tenure.dev/problems/surface-not-configured",
  awsDenied: "https://tenure.dev/problems/aws-access-denied",
  conflict: "https://tenure.dev/problems/state-conflict",
  internal: "https://tenure.dev/problems/internal",
} as const

export type ProblemType = (typeof PROBLEM)[keyof typeof PROBLEM]

export interface ProblemDocument {
  type: ProblemType
  title: string
  status: number
  detail: string
  /** The request this happened to. */
  instance: string
  correlationId: string
}

export interface ProblemInit {
  type: ProblemType
  title: string
  status: number
  detail: string
  instance: string
  correlationId: string
  /** Extra response headers — `Retry-After` on a throttle, `WWW-Authenticate`. */
  headers?: Record<string, string>
}

/**
 * The response.
 *
 * `application/problem+json` rather than `application/json`, because a client
 * that keys on the content type can route every failure through one handler
 * without inspecting the status first.
 */
export function problemResponse(init: ProblemInit): Response {
  const body: ProblemDocument = {
    type: init.type,
    title: init.title,
    status: init.status,
    detail: init.detail,
    instance: init.instance,
    correlationId: init.correlationId,
  }
  return new Response(JSON.stringify(body), {
    status: init.status,
    headers: {
      "content-type": "application/problem+json; charset=utf-8",
      // A problem is about one request and must never be reused for another.
      "cache-control": "no-store",
      ...(init.headers ?? {}),
    },
  })
}
