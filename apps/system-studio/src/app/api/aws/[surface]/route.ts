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
import {
  SURFACES,
  consumeRate,
  describeRead,
  httpStatusFor,
  isLiveSurface,
  isSurfaceId,
  itemsOf,
  type AwsRead,
  type LiveSurfaceId,
  type RateDecision,
  type SurfaceId,
} from "@/lib/aws/result"
import { listFleet, listOperations, putAuditEntry, registryConfigured } from "@/lib/registry"
import { matchesFilter, parseFleetFilter } from "@/lib/fleet-filter"
import { costSource } from "@/lib/cost-source"
import { advanceState } from "@/app/tenants/actions"

/* ── the eleven readers this route is the production caller of ───────────── */
import { cdnReadings } from "@/lib/aws/cdn"
import { certificateReadings } from "@/lib/aws/certificates"
import { complianceReadings } from "@/lib/aws/compliance"
import { dashboardReadings } from "@/lib/aws/dashboards"
import { dnsReadings } from "@/lib/aws/dns"
import { guardDutyReadings } from "@/lib/aws/guardduty"
import { logGroupReadings } from "@/lib/aws/logs"
import { organizationSurface } from "@/lib/aws/organization"
import { pricingReadings } from "@/lib/aws/pricing"
import { quotaReadings } from "@/lib/aws/quotas"
import { wafReadings } from "@/lib/aws/waf"

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

/**
 * Which command each surface is, so authorization is the page's own decision.
 *
 * Every live surface reads control-plane state about the estate this console
 * runs, which is what `platform.read` names — the same command `/platform`
 * itself is authorized with, so an operator cannot be refused the page and
 * granted its data over HTTP. `pricing` is the exception and is `cost.read`:
 * a list price is money, and the role separation that keeps spend away from a
 * support engineer has to hold whichever door the number comes through.
 *
 * Typed against `SurfaceId` rather than left open, so a surface added to
 * `SURFACES` without an authorization decision does not compile.
 */
const SURFACE_COMMAND: Record<SurfaceId, "tenants.read" | "tenant.lifecycle.read" | "cost.read" | "platform.read"> = {
  fleet: "tenants.read",
  operations: "tenant.lifecycle.read",
  cost: "cost.read",
  cdn: "platform.read",
  certificates: "platform.read",
  compliance: "platform.read",
  dashboards: "platform.read",
  dns: "platform.read",
  guardduty: "platform.read",
  logs: "platform.read",
  organization: "platform.read",
  pricing: "cost.read",
  quotas: "platform.read",
  waf: "platform.read",
}

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
): { ok: true; rate: RateDecision } | { ok: false; response: Response } {
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
        headers: {
          "retry-after": String(rate.retryAfterSeconds),
          // Which limiter said no. AWS throttling this engine and this engine
          // throttling an operator are opposite facts with opposite remedies —
          // wait, versus poll at the cadence you were given — and they arrive
          // as the same status code. `problem.ts` has one `rateLimited` type,
          // so the distinction travels here until it has one of its own.
          "x-throttle-origin": "control-plane",
          ...rateHeaders(ctx.surface, rate),
          /*
           * The cadence, on the response that most needs it.
           *
           * A client is here because it polled too fast. Telling it how fast
           * the underlying reading actually moves is the whole remedy, and
           * withholding it leaves the client to guess an interval — which is
           * how it got throttled. `NOT_READ` rather than an arm of `AwsRead`:
           * no call was made, so there is no reading and no `as of` to claim.
           */
          ...(isLiveSurface(ctx.surface)
            ? liveHeaders(ctx.surface, "NOT_READ", null, rate.retryAfterSeconds * 1000)
            : {}),
        },
      }),
    }
  }

  return { ok: true, rate }
}

/* ────────────────────────────────────────────────────── live AWS surfaces -- */

/**
 * STUDIO-140-007 — what a poller is told, and why none of it is reassuring.
 *
 * Eleven capability-backed readers now answer over HTTP. Each is polled, and a
 * polled read is where the failure this whole vocabulary exists to prevent gets
 * its best chance: the first read succeeds and paints a screen, the tenth is
 * refused, and if the tenth answers `200 {items: []}` the screen quietly
 * changes from "nine distributions" to "no distributions" without anybody being
 * told a permission went away.
 *
 * So a live surface NEVER returns rows and a failure in the same response. The
 * status comes from `httpStatusFor`, which is the same function the UI's
 * unknown-state renderer branches on, and the body of a failure is a problem
 * document with no `items` field at all — a client that keeps its last good
 * value does so because there is nothing here to overwrite it with.
 */

/** Header block naming the operator's remaining allowance on THIS surface. */
function rateHeaders(surface: SurfaceId, rate: RateDecision): Record<string, string> {
  return {
    "x-ratelimit-limit": String(rate.limit),
    "x-ratelimit-remaining": String(rate.remaining),
    "x-ratelimit-window-ms": String(SURFACES[surface].windowMs),
    "x-ratelimit-scope": `operator:${surface}`,
  }
}

/**
 * One live surface's load: the reads its rows come from, the rows, and when.
 *
 * `gate` is not every read the module performed — it is exactly the reads the
 * ROWS come from. That distinction is the difference between an honest surface
 * and a plausible one: `cdnReadings` also resolves identity and the tag index,
 * and gating on those would let a refused `cloudfront:ListDistributions` through
 * as an empty distribution list because the tag read succeeded.
 */
interface LiveLoad {
  gate: readonly AwsRead<unknown>[]
  items: readonly unknown[]
  /** When this load was assembled. The module's own stamp, never invented here. */
  asOf: string
}

/**
 * Perform one named surface's read.
 *
 * A `switch`, exhaustive over `LiveSurfaceId`, and deliberately not a table of
 * functions keyed by a string. Bible §20 forbids a generic "AWS action runner"
 * endpoint, and the property that keeps this route on the right side of that
 * line is mechanical: the only thing a caller controls is which of these eleven
 * branches runs. There is no service parameter, no action parameter and no
 * parameter bag — each module below calls named capabilities with input it
 * narrowed itself, and `gateway.call` switches on the capability again.
 */
async function readLiveSurface(surface: LiveSurfaceId): Promise<LiveLoad> {
  switch (surface) {
    case "cdn": {
      const r = await cdnReadings()
      return { gate: [r.distributions], items: itemsOf(r.distributions), asOf: r.asOf }
    }
    case "certificates": {
      const r = await certificateReadings()
      return { gate: [r.certificates], items: itemsOf(r.certificates), asOf: r.asOf }
    }
    case "compliance": {
      const r = await complianceReadings()
      return { gate: [r.rules], items: itemsOf(r.rules), asOf: r.asOf }
    }
    case "dashboards": {
      const r = await dashboardReadings()
      return { gate: [r.dashboards], items: itemsOf(r.dashboards), asOf: r.asOf }
    }
    case "dns": {
      const r = await dnsReadings()
      return { gate: [r.zones], items: itemsOf(r.zones), asOf: r.asOf }
    }
    case "guardduty": {
      const r = await guardDutyReadings()
      return { gate: [r.detectors], items: itemsOf(r.detectors), asOf: r.asOf }
    }
    case "logs": {
      const r = await logGroupReadings()
      return { gate: [r.groups], items: itemsOf(r.groups), asOf: r.asOf }
    }
    case "organization": {
      const r = await organizationSurface()
      // No Organization is UNCONFIGURED inside the module, not an empty account
      // list — so "this account is not in an Organization" arrives here as a 501
      // naming that, and never as a fleet of zero accounts.
      const asOf = "asOf" in r.accounts ? r.accounts.asOf : new Date().toISOString()
      return { gate: [r.accounts], items: itemsOf(r.accounts), asOf }
    }
    case "pricing": {
      const r = await pricingReadings()
      // Every shape gates. A price list missing one shape because that read was
      // refused is an UNDERSTATED cost, which is the direction that gets
      // somebody a bill they did not plan for.
      return {
        gate: r.shapes.map((shape) => shape.products),
        items: r.shapes.map((shape) => ({
          shape: shape.shape,
          reads: shape.reads,
          rate: shape.rate,
          truncated: shape.truncated,
          attribution: shape.attribution,
          refreshMs: shape.refreshMs,
          asOf: shape.asOf,
        })),
        asOf: r.asOf,
      }
    }
    case "quotas": {
      const r = await quotaReadings()
      // Same rule: a headroom picture with one quota missing is a ceiling an
      // operator plans against and then hits.
      return { gate: r.quotas.map((q) => q.quota), items: r.quotas, asOf: r.asOf }
    }
    case "waf": {
      const r = await wafReadings()
      // Two scopes, two endpoints, two catalogues. A refused CLOUDFRONT scope
      // with a readable REGIONAL one would render as "these are the web ACLs",
      // and the missing half is exactly where an internet-facing distribution
      // sits.
      const acls = (read: AwsRead<{ scope: string; acls: readonly unknown[] }>) =>
        read.state === "ACTUAL" || read.state === "STALE"
          ? read.value.acls.map((acl) => ({ scope: read.value.scope, acl }))
          : []
      return {
        gate: [r.regional, r.cloudfront],
        items: [...acls(r.regional), ...acls(r.cloudfront)],
        asOf: r.asOf,
      }
    }
  }
}

/** Whether a read produced a value, or a claim that there is none. */
function answered(read: AwsRead<unknown>): boolean {
  return read.state === "ACTUAL" || read.state === "EMPTY" || read.state === "STALE"
}

/**
 * The first read that did not answer, or null when every one of them did.
 *
 * Asked of the reads rather than of the row count, which is the guard that a
 * `rows.length === 0` test cannot be: an empty array is what a denial and an
 * empty estate both look like once the narrowing has been dropped one layer up.
 */
function firstValueless(gate: readonly AwsRead<unknown>[]): AwsRead<unknown> | null {
  return gate.find((read) => !answered(read)) ?? null
}

/**
 * The state a serving response reports.
 *
 * Weakest-first: one STALE read among fresh ones makes the whole response
 * STALE, because the client is being handed rows that include held ones and
 * "some of this is old" is the only true thing to say about that. All-EMPTY is
 * EMPTY — a claim — and anything else is ACTUAL.
 */
function servingState(gate: readonly AwsRead<unknown>[]): string {
  /*
   * Defence in depth, and it earned its place.
   *
   * The gate above already refuses to serve when a read did not answer, so this
   * line should be unreachable — but "should be unreachable" is exactly what was
   * said about every empty list this vocabulary exists to prevent. Two surfaces
   * build their rows from per-item readings (`pricing` shapes, `quotas`
   * targets), so their `items` are non-empty even when every underlying read was
   * refused; a mutation that removed the gate served those rows and the header
   * still said ACTUAL. Deriving the state from the reads rather than assuming
   * the gate ran means the response cannot claim what the reads did not say,
   * whichever way it got here.
   */
  const unknown = gate.find((read) => !answered(read))
  if (unknown) return unknown.state
  if (gate.some((read) => read.state === "STALE")) return "STALE"
  if (gate.length > 0 && gate.every((read) => read.state === "EMPTY")) return "EMPTY"
  return "ACTUAL"
}

/**
 * The staleness and cadence headers every live response carries — including the
 * failures, and including the 304.
 *
 * The cadence is here rather than in the body for two reasons. The envelope is
 * a published contract with `additionalProperties: false`, so a body field
 * would be a contract change; and a 304 has no body at all, which is precisely
 * the response after which a client most needs to know when to ask again.
 */
function liveHeaders(
  surface: LiveSurfaceId,
  state: string,
  asOf: string | null,
  pollAfterMs: number,
): Record<string, string> {
  const entry = SURFACES[surface]
  return {
    "x-aws-surface": surface,
    "x-aws-capability": String(entry.capability),
    // The capability's own declared cadence, from `capabilities.ts`. A client
    // that polls faster than this is asking AWS a question whose answer it was
    // already told cannot have changed.
    "x-aws-refresh-ms": String(entry.refreshMs),
    "x-aws-read-state": state,
    ...(asOf ? { "x-aws-as-of": asOf } : {}),
    // How long before asking again is worth anything. The cadence normally;
    // AWS's own backoff when AWS is the one saying slow down.
    "x-poll-after-ms": String(pollAfterMs),
  }
}

/**
 * Turn a read that did not answer into the response for it.
 *
 * `httpStatusFor` decides the code, so this endpoint and the console's
 * `UnknownState` cannot disagree about what a denial is. `describeRead` writes
 * the sentence, so the principal, the action, the error code and the pasteable
 * minimum IAM statement are the same words on both — one renderer, as its own
 * header says.
 */
function unknownResponse(
  ctx: RequestContext,
  surface: LiveSurfaceId,
  read: AwsRead<unknown>,
  rate: RateDecision,
): Response {
  const status = httpStatusFor(read)
  const type =
    read.state === "DENIED"
      ? PROBLEM.awsDenied
      : read.state === "THROTTLED"
        ? PROBLEM.rateLimited
        : read.state === "UNCONFIGURED"
          ? PROBLEM.surfaceNotConfigured
          : PROBLEM.internal
  const title =
    read.state === "DENIED"
      ? "This engine's role was refused the read"
      : read.state === "THROTTLED"
        ? "AWS rate-limited the read"
        : read.state === "UNCONFIGURED"
          ? "Not configured"
          : "The read failed"

  /*
   * Where the poller is told to go next.
   *
   * A THROTTLED read has already been retried with exponential backoff inside
   * `readAws` and gave up — three attempts, not forever. Reporting it with
   * AWS's own backoff as `Retry-After` is what makes the client's retry the
   * continuation of that policy rather than a second, uncoordinated one.
   * Everything else waits a cadence: a denial is not fixed by asking sooner.
   */
  const backoffMs =
    read.state === "THROTTLED" ? read.retryAfterMs : (SURFACES[surface].refreshMs ?? 60_000)
  const asOf = "asOf" in read ? read.asOf : null

  return problemResponse({
    type,
    title,
    status,
    detail: describeRead(read, `the ${surface} surface`),
    instance: ctx.instance,
    correlationId: ctx.correlationId,
    headers: {
      "x-correlation-id": ctx.correlationId,
      ...liveHeaders(surface, read.state, asOf, backoffMs),
      ...rateHeaders(surface, rate),
      ...(read.state === "THROTTLED"
        ? {
            "retry-after": String(Math.max(1, Math.ceil(read.retryAfterMs / 1000))),
            "x-throttle-origin": "aws",
          }
        : {}),
    },
  })
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
  extraHeaders: Record<string, string> = {},
): Response {
  const etag = etagFor(body)
  if (matchesEtag(request.headers.get("if-none-match"), etag)) {
    // No body, deliberately. A 304 carrying the payload it just told the client
    // it already has would make the whole mechanism a round trip that saves
    // nothing.
    //
    // The staleness headers still travel, because a 304 is the one response
    // where the body cannot carry them and the client still has to decide when
    // to ask again.
    return new Response(null, {
      status: 304,
      headers: { etag, "x-correlation-id": ctx.correlationId, ...extraHeaders },
    })
  }

  return new Response(JSON.stringify(envelope({ ...body, correlationId: ctx.correlationId })), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      etag,
      "cache-control": "no-store",
      "x-correlation-id": ctx.correlationId,
      ...extraHeaders,
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
  const rate = admitted.rate

  // Only the two registry-backed surfaces need the registry. Naming them is not
  // a tidy-up: `!== "cost"` admitted every surface added after it, so each of
  // the eleven live ones would have answered "TENANT_TABLE is not set" — a
  // 501 about a DynamoDB table, on a route reading CloudFront.
  if ((ctx.surface === "fleet" || ctx.surface === "operations") && !registryConfigured()) {
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
    if (isLiveSurface(ctx.surface)) {
      const surface = ctx.surface
      const load = await readLiveSurface(surface)

      // The gate, before a single row is looked at. A read that did not answer
      // leaves this function here, with no `items` in the body at all.
      const unknown = firstValueless(load.gate)
      if (unknown) return unknownResponse(ctx, surface, unknown, rate)

      const limit = pageSize(url.searchParams.get("limit"))
      const cursorParam = url.searchParams.get("cursor")
      const offset = cursorParam ? decodeCursor<{ offset: number }>(cursorParam).offset : 0
      const items = load.items.slice(offset, offset + limit)
      const nextOffset = offset + items.length
      const state = servingState(load.gate)

      return envelopeResponse(
        request,
        ctx,
        {
          items,
          nextCursor: nextOffset < load.items.length ? encodeCursor({ offset: nextOffset }) : null,
          /*
           * The module's own stamp, which is when AWS was asked.
           *
           * It moves on every poll, so a live surface rarely produces a 304 —
           * and that is the correct direction rather than a missed saving.
           * Rounding it to make representations repeat would report a reading
           * as older or newer than it is, and "shows a number that implies now"
           * is the failure this field exists to prevent. `x-poll-after-ms`
           * carries the bandwidth argument instead: a client that honours the
           * cadence does not need a 304, because it does not ask.
           */
          asOf: load.asOf,
        },
        {
          ...liveHeaders(surface, state, load.asOf, SURFACES[surface].refreshMs ?? 0),
          ...rateHeaders(surface, rate),
        },
      )
    }

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
      }, rateHeaders(ctx.surface, rate))
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
      }, rateHeaders(ctx.surface, rate))
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
    }, rateHeaders(ctx.surface, rate))
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
