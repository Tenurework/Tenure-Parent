import { auth } from "@/lib/auth"
import { authorizeCommand, decisionLine } from "@/lib/authorize"
import {
  CursorRejected,
  CursorUnavailable,
  decodeCursor,
  encodeCursor,
  envelope,
  etagFor,
  matchesEtag,
  newCorrelationId,
  pageSize,
} from "@/lib/api/envelope"
import { PROBLEM, problemResponse } from "@/lib/api/problem"
import { SURFACES, consumeRate, isSurfaceId, type SurfaceId } from "@/lib/aws/result"
import { listFleet, listOperations, putAuditEntry, registryConfigured } from "@/lib/registry"
import { matchesFilter, parseFleetFilter } from "@/lib/fleet-filter"
import { costSource } from "@/lib/cost-source"
import { advanceState } from "@/app/tenants/actions"

export const dynamic = "force-dynamic"

/**
 * STUDIO-130-002 — the Studio's control-plane API.
 *
 * Before this, `apps/system-studio/src/app/api` held exactly one route, and it
 * was NextAuth's. Everything else was a server component reading DynamoDB or a
 * server action, so none of the ten clauses the item names existed for any
 * endpoint: no pagination, no opaque ids, no ETag, no idempotency key, no rate
 * limit, no problem details, no correlation id. That mattered the moment a
 * surface needed a poller — re-rendering a page to find out whether an
 * operation finished is not a thing an external caller can do.
 *
 * ## One shape for every response
 *
 *   * A 2xx is an `Envelope`: `items`, an opaque `nextCursor`, `asOf`, and a
 *     `correlationId`.
 *   * A non-2xx is RFC 7807, and there is no other way to produce one. A denial
 *     and a throttle are told apart by `type`, not by prose, so a client can
 *     route them without pattern-matching English.
 *
 * ## What each clause is, concretely
 *
 *   * **Opaque ids** — the cursor is AES-256-GCM over the position, so a client
 *     cannot decode a table key out of it and cannot forge a scan position.
 *   * **ETags** — the body's digest. `If-None-Match` gets a 304 with no body,
 *     which is the whole point for a surface that is polled.
 *   * **Idempotency** — a write without `Idempotency-Key` is a 400. With one, it
 *     goes through the same `gate()` the form does, so a retry replays the first
 *     operation instead of starting a second.
 *   * **Rate limits** — per operator per surface, with the budget named in the
 *     429 and `Retry-After` set. Cost Explorer's budget is an order of magnitude
 *     below the others because it is billed per request.
 *   * **Correlation** — minted per request, on the envelope, on every problem
 *     document, and on the command the write path builds.
 *
 * ## Why the write path calls the server action
 *
 * `POST /api/aws/operations` builds a `FormData` and calls `advanceState`. Not
 * for brevity: it is the ONLY way the HTTP face and the browser form cannot
 * drift. Every control on that path — semantic authorization, the audit ledger's
 * intent row, the typed-target confirmation, the rendered-consequence digest,
 * the destructive-verb refusal, the cost band, the idempotency claim, the
 * operation record — applies to an API caller exactly because it is the same
 * function. A second implementation here would be a second lifecycle, and the
 * one somebody forgets to update is the one an attacker uses.
 */

type Params = { params: Promise<{ surface: string }> }

/** Which command each surface is, so authorization is the page's own decision. */
const SURFACE_COMMAND = {
  fleet: "tenants.read",
  operations: "tenant.lifecycle.read",
  cost: "cost.read",
} as const

interface RequestContext {
  correlationId: string
  instance: string
  principalId: string
  surface: SurfaceId
}

/**
 * Resolve the surface and the caller, or return the problem document.
 *
 * Everything decided here is decided BEFORE the request has been read for
 * meaning: which surface was asked for, and who is asking. Authorization is
 * deliberately not part of it — see `admit`.
 *
 * Returns a discriminated result rather than throwing, because every one of
 * these is a normal outcome with its own status and its own `type` — and a
 * thrown error would arrive at Next's handler as a 500 with a digest, which
 * tells a caller nothing.
 */
async function identify(
  request: Request,
  surfaceRaw: string,
): Promise<{ ok: true; ctx: RequestContext } | { ok: false; response: Response }> {
  const correlationId = newCorrelationId()
  const instance = new URL(request.url).pathname

  if (!isSurfaceId(surfaceRaw)) {
    return {
      ok: false,
      response: problemResponse({
        type: PROBLEM.notFound,
        title: "No such surface",
        status: 404,
        detail: `This control plane serves ${Object.keys(SURFACES).join(", ")}.`,
        instance,
        correlationId,
      }),
    }
  }
  const surface = surfaceRaw

  const session = await auth()
  const principalId = session?.user?.email
  if (!principalId) {
    return {
      ok: false,
      response: problemResponse({
        type: PROBLEM.unauthenticated,
        title: "Not signed in",
        status: 401,
        detail: "This control plane requires an operator session.",
        instance,
        correlationId,
      }),
    }
  }

  return { ok: true, ctx: { correlationId, instance, principalId, surface } }
}

/**
 * The tenant a request names, when the surface is about one tenant.
 *
 * `operations` is backed by `tenant.lifecycle`, which is in
 * `TENANT_SCOPED_RESOURCES` (`src/lib/operators.ts`) — a lifecycle permission
 * that is not about a particular tenant is a permission over all of them, so
 * `authorizeOperator` refuses it outright when no tenant is in scope. The slug
 * is therefore not a filter the surface applies after it has been let in; it is
 * the subject the policy decision is ABOUT, and the request cannot be
 * authorized until it has been read out.
 *
 * Which is why a missing one is a 400 and not a 403. "You did not say which
 * tenant" is a property of the request, true whoever sends it and true before
 * anybody's role is consulted — and answering it with `tenant.lifecycle:read
 * was refused (TENANT_SCOPE_MISSING)` told a caller their operator lacked a
 * permission when what was actually wrong was their URL. It also made the
 * surface unreachable: every `GET /api/aws/operations` and every `POST` to it
 * was refused, because the route asked the policy a question about no tenant at
 * all and the policy correctly declined to answer it.
 */
function tenantRequired(ctx: RequestContext, where: string): Response {
  return problemResponse({
    type: PROBLEM.badRequest,
    title: "A tenant is required",
    status: 400,
    detail: `Operations are per tenant. ${where}`,
    instance: ctx.instance,
    correlationId: ctx.correlationId,
  })
}

/**
 * Authorize and rate-limit a request whose subject is now known.
 *
 * `tenantId` is the tenant the request named, or null for the surfaces that are
 * about the fleet rather than about one tenant (`tenants.read` and `cost.read`
 * are not tenant-scoped resources). Passing it is what makes the decision the
 * real one: without it the operations surface was authorized against no subject.
 */
function admit(
  ctx: RequestContext,
  tenantId: string | null,
): { ok: true } | { ok: false; response: Response } {
  const command = SURFACE_COMMAND[ctx.surface]
  const decision = authorizeCommand(command, {
    principalId: ctx.principalId,
    ...(tenantId ? { tenantId } : {}),
  })
  // STUDIO-020-012 — the allow as well as the deny.
  console.info(
    `[authz] ${decisionLine(ctx.principalId, command, decision)} correlation=${ctx.correlationId}`,
  )
  if (!decision.allowed) {
    return {
      ok: false,
      response: problemResponse({
        type: PROBLEM.forbidden,
        title: "Refused",
        status: 403,
        // Names the permission and the policy, never whether the resource
        // exists — the same discipline the console's denial state is built on.
        detail: `${decision.permission} was refused (${decision.reason}), policy ${decision.policyRevision}.`,
        instance: ctx.instance,
        correlationId: ctx.correlationId,
      }),
    }
  }

  const rate = consumeRate(ctx.surface, ctx.principalId)
  if (!rate.allowed) {
    return {
      ok: false,
      response: problemResponse({
        type: PROBLEM.rateLimited,
        title: "Too many requests",
        status: 429,
        detail:
          `The ${ctx.surface} surface allows ${rate.limit} requests per operator per ` +
          `${Math.round(SURFACES[ctx.surface].windowMs / 1000)}s. It backs ${SURFACES[ctx.surface].awsAction}, ` +
          `which is why the budget is what it is.`,
        instance: ctx.instance,
        correlationId: ctx.correlationId,
        headers: { "retry-after": String(rate.retryAfterSeconds) },
      }),
    }
  }

  return { ok: true }
}

/**
 * When the rows on a page were last current — which is NOT when they were read.
 *
 * `asOf` is part of the body, so it is part of the ETag (`etagFor` in
 * `src/lib/api/envelope.ts`, pinned by `envelope-contract.test.ts`). Stamping it
 * with `new Date()` therefore made every representation unique, every
 * `If-None-Match` a miss and the 304 path unreachable — precisely the "no-op
 * that looks implemented" that `etagFor` keeps the correlation id out of the
 * digest to avoid. The correlation id was excluded and this was missed, because
 * a clock reading does not look like a per-request value until you notice that
 * it is one.
 *
 * The registry stamps `updatedAt` on every write, so the newest one on the page
 * is the moment the page stopped changing — which is exactly what the contract
 * means by "when the underlying data was current" (`ApiEnvelope`,
 * `packages/contracts`). It moves the instant anything on the page does, so a
 * poller is never told "unchanged" about something that changed; it simply stops
 * moving when nothing else does. The cost surface already did this, reporting
 * the report's own `asOf` — this is the registry surfaces catching up with it.
 *
 * A page with no rows has no such moment, so it falls back to the read's own
 * clock. That leaves an empty page without a 304, which costs nothing: the
 * saving this mechanism exists for is not re-shipping a list, and there is no
 * list.
 */
function currencyOf(stamps: ReadonlyArray<string | null | undefined>, readAt: string): string {
  let newest: string | null = null
  for (const stamp of stamps) {
    // ISO-8601 UTC strings of equal precision compare correctly as strings,
    // which is the property the registry's own sort keys already rely on.
    if (typeof stamp === "string" && stamp !== "" && (newest === null || stamp > newest)) {
      newest = stamp
    }
  }
  return newest ?? readAt
}

/** A 2xx envelope, with its ETag, honouring `If-None-Match`. */
function envelopeResponse(
  request: Request,
  ctx: RequestContext,
  body: { items: readonly unknown[]; nextCursor: string | null; asOf: string },
): Response {
  const etag = etagFor(body)
  if (matchesEtag(request.headers.get("if-none-match"), etag)) {
    // No body, deliberately. A 304 carrying the payload it just told the client
    // it already has would make the whole mechanism a round trip that saves
    // nothing.
    return new Response(null, {
      status: 304,
      headers: { etag, "x-correlation-id": ctx.correlationId },
    })
  }

  return new Response(JSON.stringify(envelope({ ...body, correlationId: ctx.correlationId })), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      etag,
      "cache-control": "no-store",
      "x-correlation-id": ctx.correlationId,
    },
  })
}

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export async function GET(request: Request, { params }: Params) {
  const { surface: surfaceRaw } = await params
  const identified = await identify(request, surfaceRaw)
  if (!identified.ok) return identified.response
  const ctx = identified.ctx

  const url = new URL(request.url)
  /** When this read ran. The audit clock, not the envelope's `asOf` — see `currencyOf`. */
  const readAt = new Date().toISOString()

  // The subject, before the policy is asked about it. See `tenantRequired`.
  const slug =
    ctx.surface === "operations" ? (url.searchParams.get("slug") ?? "").trim() : ""
  if (ctx.surface === "operations" && !slug) return tenantRequired(ctx, "Pass ?slug=<tenant>.")

  const admitted = admit(ctx, slug || null)
  if (!admitted.ok) return admitted.response

  if (!registryConfigured() && ctx.surface !== "cost") {
    return problemResponse({
      type: PROBLEM.surfaceNotConfigured,
      title: "Not configured",
      status: 501,
      detail: "TENANT_TABLE is not set, so there is no registry to read.",
      instance: ctx.instance,
      correlationId: ctx.correlationId,
    })
  }

  try {
    if (ctx.surface === "cost") {
      const source = await costSource()
      if (source.state === "NOT_CONFIGURED") {
        // 501, not 200 with an empty list. "We looked and there is nothing" and
        // "nothing was connected to look at" are opposite facts, and a caller
        // that received `items: []` here would report a fleet spending nothing.
        return problemResponse({
          type: PROBLEM.surfaceNotConfigured,
          title: "No cost source is connected",
          status: 501,
          detail: `${source.why} Operator steps: ${source.operatorSteps.join(" ; ")}`,
          instance: ctx.instance,
          correlationId: ctx.correlationId,
        })
      }
      return envelopeResponse(request, ctx, {
        items: Object.entries(source.report.summary.byTenant).map(([slug, amount]) => ({
          slug,
          units: amount.units,
          currency: amount.currency,
        })),
        nextCursor: null,
        asOf: source.report.summary.actual.asOf,
      })
    }

    if (ctx.surface === "operations") {
      const cursorParam = url.searchParams.get("cursor")
      const start = cursorParam
        ? decodeCursor<Record<string, unknown>>(cursorParam)
        : null
      const limit = pageSize(url.searchParams.get("limit"))
      const page = await listOperations(slug, { limit, exclusiveStartKey: start })

      return envelopeResponse(request, ctx, {
        items: page.operations,
        // Sealed, so the DynamoDB key never leaves this process readable.
        nextCursor: page.lastEvaluatedKey ? encodeCursor(page.lastEvaluatedKey) : null,
        // An operation record never changes after it completes, so the newest
        // timestamp in the page is when this page stopped changing.
        asOf: currencyOf(
          page.operations.map((o) => o.completedAt ?? o.requestedAt),
          readAt,
        ),
      })
    }

    // ── fleet ────────────────────────────────────────────────────────────────
    const all = await listFleet()
    const filter = parseFleetFilter(Object.fromEntries(url.searchParams.entries()))
    // The signal filter needs health, which this surface does not compute — the
    // health read is two AWS calls and this endpoint is polled. `undefined`
    // health makes a `?signal=` filter match nothing rather than everything,
    // which is the safe direction and is stated in `matchesFilter`.
    const matching = all.filter((row) => matchesFilter(row, filter, undefined))

    /*
     * STUDIO-100-002. The projection an export runs through.
     *
     * Per tenant, with the region the registry recorded — so a tenant placed
     * outside this control plane's own region is refused by
     * `authorizeCommand` rather than exported. `refused` is counted rather than
     * dropped silently, because an export that is quietly short is worse than
     * one that says how much it left out.
     */
    const permitted: typeof matching = []
    const refused: string[] = []
    for (const row of matching) {
      const decision = authorizeCommand("tenants.read", {
        principalId: ctx.principalId,
        tenantId: row.slug,
        ...(row.region ? { region: row.region } : {}),
      })
      if (decision.allowed) permitted.push(row)
      else refused.push(row.slug)
    }

    if (url.searchParams.get("format") === "csv") {
      const header = [
        "slug",
        "displayName",
        "state",
        "lifecycle",
        "owner",
        "plan",
        "cell",
        "region",
        "isolation",
        "release",
        "registryConfigRevision",
        "storeConfigRevision",
        "hasDeployment",
        "updatedAt",
      ]
      const body = [
        header.join(","),
        ...permitted.map((r) =>
          [
            r.slug,
            r.displayName,
            r.state,
            r.lifecycle,
            r.owner,
            r.planId,
            r.cellId,
            r.region,
            r.isolation,
            r.release,
            r.registryConfigRevision,
            r.storeConfigRevision,
            r.hasDeployment,
            r.updatedAt,
          ]
            .map(csvCell)
            .join(","),
        ),
      ].join("\n")

      // STUDIO-020-012. What left the platform, who took it, and what they were
      // refused. Written before the bytes are returned; an export that cannot be
      // recorded is an export nobody can answer for.
      await putAuditEntry({
        actorId: ctx.principalId,
        action: "fleet.export",
        resourceType: "Fleet",
        resourceId: null,
        outcome: "ALLOW",
        reason: null,
        // The clock, not the data's currency: this records when somebody took
        // the file, which is a fact about the act rather than about the rows.
        occurredAt: readAt,
        correlationId: ctx.correlationId,
        detail: {
          format: "csv",
          exported: permitted.map((r) => r.slug),
          refused,
          filter,
        },
      })

      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="tenure-fleet-${readAt.slice(0, 10)}.csv"`,
          "cache-control": "no-store",
          "x-correlation-id": ctx.correlationId,
          "x-refused-count": String(refused.length),
        },
      })
    }

    const limit = pageSize(url.searchParams.get("limit"))
    const cursorParam = url.searchParams.get("cursor")
    const offset = cursorParam ? decodeCursor<{ offset: number }>(cursorParam).offset : 0
    const items = permitted.slice(offset, offset + limit)
    const nextOffset = offset + items.length

    return envelopeResponse(request, ctx, {
      items,
      nextCursor: nextOffset < permitted.length ? encodeCursor({ offset: nextOffset }) : null,
      asOf: currencyOf(
        items.map((row) => row.updatedAt),
        readAt,
      ),
    })
  } catch (err) {
    if (err instanceof CursorRejected) {
      return problemResponse({
        type: PROBLEM.badRequest,
        title: "Unusable cursor",
        status: 400,
        detail: err.message,
        instance: ctx.instance,
        correlationId: ctx.correlationId,
      })
    }
    if (err instanceof CursorUnavailable) {
      return problemResponse({
        type: PROBLEM.surfaceNotConfigured,
        title: "Pagination is not available",
        status: 501,
        detail: err.message,
        instance: ctx.instance,
        correlationId: ctx.correlationId,
      })
    }
    return problemResponse({
      type: PROBLEM.internal,
      title: "The read failed",
      status: 502,
      detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      instance: ctx.instance,
      correlationId: ctx.correlationId,
    })
  }
}

/**
 * Dispatch a lifecycle command.
 *
 * The one write route. It exists to be called by something that is not a
 * browser — a runbook, a poller, an operator's shell — and everything it does
 * happens inside `advanceState`, which is why an API caller cannot skip a
 * control the form enforces.
 */
export async function POST(request: Request, { params }: Params) {
  const { surface: surfaceRaw } = await params
  const identified = await identify(request, surfaceRaw)
  if (!identified.ok) return identified.response
  const ctx = identified.ctx

  if (ctx.surface !== "operations") {
    // Still authorized first, so a caller who may not read this surface is told
    // that rather than told its shape. Neither is tenant-scoped, so there is no
    // subject to resolve before asking.
    const admitted = admit(ctx, null)
    if (!admitted.ok) return admitted.response
    return problemResponse({
      type: PROBLEM.notFound,
      title: "This surface is read-only",
      status: 405,
      detail: "Only /api/aws/operations accepts a write.",
      instance: ctx.instance,
      correlationId: ctx.correlationId,
    })
  }

  // The header, before the body is even parsed. A write with no idempotency key
  // is a write that cannot be retried safely, and accepting one "just this once"
  // is how a retry storm becomes four provisioning attempts.
  const idempotencyKey = (request.headers.get("idempotency-key") ?? "").trim()
  if (!idempotencyKey) {
    return problemResponse({
      type: PROBLEM.idempotencyKeyRequired,
      title: "Idempotency-Key is required",
      status: 400,
      detail:
        "Send an Idempotency-Key header. The same key with the same body replays the first " +
        "operation; the same key with a different body is a conflict, never a replay.",
      instance: ctx.instance,
      correlationId: ctx.correlationId,
    })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return problemResponse({
      type: PROBLEM.badRequest,
      title: "Unreadable body",
      status: 400,
      detail: "The body must be JSON.",
      instance: ctx.instance,
      correlationId: ctx.correlationId,
    })
  }

  /*
   * The subject, and only now can it be read: on a write it is in the body, and
   * the body could not be parsed before the header check above, which is
   * deliberately the first thing this route does.
   *
   * So authorization happens here rather than at the top. That is not a
   * relaxation — nothing has acted yet; `advanceState` below is the first thing
   * that can — and it is what makes the decision a real one. Asked with no
   * tenant, `tenant.lifecycle:read` is refused as TENANT_SCOPE_MISSING whoever
   * is asking, which is why every write to this route used to be a 403.
   */
  const slug = String(body.slug ?? "").trim()
  if (!slug) return tenantRequired(ctx, 'Name one in the body as "slug".')

  const admitted = admit(ctx, slug)
  if (!admitted.ok) return admitted.response

  const form = new FormData()
  const put = (key: string, value: unknown) => {
    if (value !== undefined && value !== null) form.set(key, String(value))
  }
  put("slug", body.slug)
  put("to", body.to)
  put("approvedBy", body.approvedBy)
  put("ownerPrincipalId", body.ownerPrincipalId)
  put("reason", body.reason)
  put("expectedVersion", body.expectedVersion)
  put("expectedDigest", body.expectedDigest)
  // The two evidence fields the confirmation panel renders. An API caller
  // supplies them for the same reason a browser does — the server compares the
  // digest against one it computes itself, so this is not a bypass, it is the
  // same gate reached over HTTP.
  put("confirmTarget", body.confirmTarget)
  put("riskDigest", body.riskDigest)
  form.set("idempotencyKey", idempotencyKey)

  const result = await advanceState(null, form)

  if (result.error && !result.operationId) {
    const status =
      result.refusalCode === "not-authorized"
        ? 403
        : result.refusalCode === "idempotency-conflict" || result.refusalCode === "version-conflict"
          ? 409
          : result.refusalCode === "approval-required"
            ? 403
            : 400
    return problemResponse({
      type:
        result.refusalCode === "idempotency-conflict"
          ? PROBLEM.idempotencyConflict
          : result.refusalCode === "version-conflict"
            ? PROBLEM.conflict
            : result.refusalCode === "not-authorized" || result.refusalCode === "approval-required"
              ? PROBLEM.forbidden
              : PROBLEM.badRequest,
      title: "Refused",
      status,
      detail: result.error,
      instance: ctx.instance,
      correlationId: ctx.correlationId,
    })
  }

  return new Response(
    JSON.stringify({
      operationId: result.operationId ?? null,
      replayed: result.replayed === true,
      error: result.error ?? null,
      correlationId: ctx.correlationId,
    }),
    {
      // 200 rather than 201: a replay creates nothing, and two identical
      // requests that returned different statuses would make the second one
      // look like a different outcome.
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-correlation-id": ctx.correlationId,
      },
    },
  )
}
