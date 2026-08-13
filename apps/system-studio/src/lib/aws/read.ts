/**
 * STUDIO-140-007 / STUDIO-000-007 — "we looked and there is nothing" and "we
 * were not allowed to look" are opposite facts, and this is the type that stops
 * a surface printing one when it means the other.
 *
 * The collector this replaces did the opposite by construction:
 * `tools/aws-inventory.mjs` returns `null` on any failure and `list()` turns
 * `null` into `[]`, so a denied `cloudwatch:DescribeAlarms` produced an empty
 * alarm list which `/platform` rendered as four reassuring green chips. An
 * operator reading that page could not tell an estate with no alarms from a
 * role with no permissions.
 *
 * So `AwsRead<T>` has NO arm carrying an optional `T`. `DENIED` has no `value`
 * field at all; a caller that reaches for `read.value` without narrowing does
 * not compile. That is the whole mechanism — the discipline is in the type, not
 * in everyone remembering.
 *
 * `EMPTY` is deliberately separate from `ACTUAL` with an empty array, because a
 * page that says "no resources" and one that says "0 resources" are read
 * differently, and only the first is a claim.
 *
 * Three surveyors specified this union under three names — `Probe<T>`,
 * `Reading<T>` and `AwsRead<T>`. It is built once, here, and every AWS module in
 * this directory returns it. Two overlapping unions would be two vocabularies to
 * keep in step, which is the failure the vocabulary exists to prevent. It lives
 * in `read.ts` rather than `result.ts` because `result.ts` already owns the
 * HTTP-surface envelope for STUDIO-130-002; `result.ts` re-exports this, so
 * either import path resolves to one union.
 */

import {
  CAPABILITIES,
  minimumStatement,
  minimumStatementText,
  type Capability,
} from "./capabilities"

/* ------------------------------------------------------------ the union -- */

/** Who the call was made as, for a denial to name. Resolved from STS, never guessed. */
export interface DenialContext {
  /** The full principal ARN, or a sentence saying identity itself could not be read. */
  principal: string
  accountId: string | null
  region: string | null
  partition: string | null
}

/**
 * Identity is not resolved yet, or could not be.
 *
 * A denial still renders with this — "unknown principal" is worse than an ARN
 * and far better than a blank line, because it tells the operator that the
 * engine cannot even see itself, which is a different problem.
 */
export const UNRESOLVED_PRINCIPAL: DenialContext = {
  principal: "unknown principal — sts:GetCallerIdentity has not answered",
  accountId: null,
  region: null,
  partition: null,
}

export type AwsRead<T> =
  /** Read, and there is something. `fresh` is false once the reading is past its TTL. */
  | { state: "ACTUAL"; capability: Capability; value: T; asOf: string; fresh: boolean }
  /** Read, and there is genuinely nothing. Never produced by a call that threw. */
  | { state: "EMPTY"; capability: Capability; asOf: string }
  /** Refused. Carries everything needed to fix it without leaving the page. */
  | {
      state: "DENIED"
      capability: Capability
      /** The AWS action, spelled as IAM spells it. */
      action: string
      principal: string
      accountId: string | null
      region: string | null
      partition: string | null
      errorCode: string
      /** JSON an operator pastes into a policy. */
      minimumStatement: string
    }
  /** Held from a previous read, past its TTL, shown because nothing is better. */
  | { state: "STALE"; capability: Capability; value: T; asOf: string; ageMs: number }
  /** Rate-limited after backoff. Distinct from ERROR: retrying is the remedy. */
  | { state: "THROTTLED"; capability: Capability; retryAfterMs: number; asOf: string }
  /** The call was never made, because what it needs is not set. */
  | { state: "UNCONFIGURED"; capability: Capability; why: string }
  /** Something else broke. `safeDetail` is the operator's only lead. */
  | { state: "ERROR"; capability: Capability; code: string; safeDetail: string }

/* -------------------------------------------------------- classification -- */

/**
 * Error names AWS uses for "your principal may not do this".
 *
 * Matched on the SDK's `name`, which is the modelled error shape, rather than on
 * message text — message wording changes between SDK releases and a rule keyed
 * on it silently degrades to ERROR, which renders as a red box instead of a
 * fixable IAM statement.
 */
const DENIAL_NAMES = new Set([
  "AccessDenied",
  "AccessDeniedException",
  "UnauthorizedOperation",
  "AuthorizationError",
  "AuthorizationErrorException",
  "AuthFailure",
  "UnrecognizedClientException",
  "InvalidClientTokenId",
  "MissingAuthenticationToken",
])

const THROTTLE_NAMES = new Set([
  "ThrottlingException",
  "Throttling",
  "ThrottledException",
  "TooManyRequestsException",
  "RequestLimitExceeded",
  "RequestThrottled",
  "RequestThrottledException",
  "ProvisionedThroughputExceededException",
  "SlowDown",
])

/**
 * Errors that mean "this account has not bought the thing you are asking about".
 *
 * `SubscriptionRequiredException` is what the AWS Health API raises on any
 * support plan below Business. It is not a denial — no IAM statement fixes it,
 * so rendering the pasteable minimum statement would send an operator to edit a
 * policy that is already correct. It is not an ERROR either — nothing is broken.
 * And it is emphatically not EMPTY: "we cannot ask whether AWS is having an
 * incident" and "AWS is not having an incident" are the two answers this whole
 * union exists to keep apart.
 *
 * So it maps to UNCONFIGURED, whose `why` names the remedy in the operator's
 * language: buy the plan, or accept that this panel stays dark.
 */
const SUBSCRIPTION_NAMES = new Set([
  "SubscriptionRequiredException",
  "OptInRequired",
])

/** Why each subscription error happened, in words that name what to buy. */
const SUBSCRIPTION_REMEDY: Readonly<Record<string, string>> = {
  SubscriptionRequiredException:
    "the AWS Health API is only available on a Business, Enterprise On-Ramp or Enterprise Support plan. " +
    "On a Basic or Developer plan this account cannot be asked whether AWS is having an incident, " +
    "which is not the same as AWS having none.",
  OptInRequired:
    "this AWS service has not been enabled for this account. Enabling it is an account action, not an IAM grant.",
}

export function isSubscriptionRequired(error: unknown): boolean {
  return SUBSCRIPTION_NAMES.has(errorName(error))
}

/** Anything with "NotAuthorized" in it, whatever the service calls it this year. */
const DENIAL_SHAPE = /not\s*authori[sz]/i

export function isDenial(error: unknown): boolean {
  const name = errorName(error)
  return DENIAL_NAMES.has(name) || DENIAL_SHAPE.test(name)
}

export function isThrottle(error: unknown): boolean {
  return THROTTLE_NAMES.has(errorName(error))
}

export function errorName(error: unknown): string {
  const e = error as { name?: unknown; code?: unknown; __type?: unknown } | null
  if (!e) return "UnknownError"
  for (const candidate of [e.name, e.code, e.__type]) {
    if (typeof candidate === "string" && candidate.trim()) {
      // Some services return `__type` as a Smithy shape id: strip the namespace.
      return candidate.includes("#") ? candidate.slice(candidate.lastIndexOf("#") + 1) : candidate
    }
  }
  return "UnknownError"
}

/* ------------------------------------------------------------- the read -- */

/** How a value decides whether it is EMPTY. Arrays get this for free. */
function looksEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0
  if (value && typeof value === "object") return Object.keys(value).length === 0
  return value === null || value === undefined
}

export interface ReadOptions {
  /** Injected in tests so a case with an explicit clock is deterministic. */
  now?: () => Date
  /** Who the call was made as. Defaults to unresolved, which still renders. */
  denial?: DenialContext
  /** Override the EMPTY test — a paged response with a `nextToken` is not empty. */
  isEmpty?: (value: unknown) => boolean
  /** Attempts before giving up on a throttle. One means no retry. */
  attempts?: number
  /** First backoff delay; doubles each attempt. Small in tests. */
  backoffMs?: number
  /** Injected so backoff is instant under test rather than a real wait. */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Run one AWS call and return what actually happened.
 *
 * The only function in the Studio that turns an exception into a rendered
 * state, so the mapping exists once. In particular there is no path from a
 * thrown error to `EMPTY`: `EMPTY` is returned only after `run()` resolved.
 *
 * Throttles are retried with exponential backoff before being reported, because
 * a single 400ms wait is usually the whole fix and a THROTTLED panel that a
 * refresh clears is noise.
 */
export async function readAws<T>(
  capability: Capability,
  run: () => Promise<T>,
  options: ReadOptions = {},
): Promise<AwsRead<T>> {
  const now = options.now ?? (() => new Date())
  const denial = options.denial ?? UNRESOLVED_PRINCIPAL
  const isEmpty = options.isEmpty ?? looksEmpty
  const attempts = Math.max(1, options.attempts ?? 3)
  const firstBackoff = options.backoffMs ?? 100
  const sleep = options.sleep ?? defaultSleep

  let backoff = firstBackoff
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const value = await run()
      const asOf = now().toISOString()
      if (isEmpty(value)) return { state: "EMPTY", capability, asOf }
      return { state: "ACTUAL", capability, value, asOf, fresh: true }
    } catch (error) {
      if (isDenial(error)) {
        return {
          state: "DENIED",
          capability,
          action: CAPABILITIES[capability].iamActions[0],
          principal: denial.principal,
          accountId: denial.accountId,
          region: denial.region,
          partition: denial.partition,
          errorCode: errorName(error),
          minimumStatement: minimumStatementText(capability),
        }
      }
      if (isSubscriptionRequired(error)) {
        const code = errorName(error)
        return {
          state: "UNCONFIGURED",
          capability,
          why:
            SUBSCRIPTION_REMEDY[code] ??
            `${capability} needs an account subscription this account does not hold (${code}).`,
        }
      }
      if (isThrottle(error)) {
        if (attempt < attempts) {
          await sleep(backoff)
          backoff *= 2
          continue
        }
        return { state: "THROTTLED", capability, retryAfterMs: backoff, asOf: now().toISOString() }
      }
      return {
        state: "ERROR",
        capability,
        code: errorName(error),
        safeDetail: safeDetail(error),
      }
    }
  }
  // Unreachable: the loop either returns or exhausts into the THROTTLED return.
  return { state: "THROTTLED", capability, retryAfterMs: backoff, asOf: now().toISOString() }
}

/**
 * An error message with no credential material in it.
 *
 * SDK errors carry request ids and occasionally echo request parameters. The
 * message is kept — it is the only lead an operator has — and truncated, and
 * anything that looks like a key or a session token is removed rather than
 * trusted to be absent.
 */
export function safeDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/(?:ASIA|AKIA)[0-9A-Z]{16}/g, "[access-key-id]")
    .replace(/[A-Za-z0-9/+=]{40,}/g, "[redacted]")
    .slice(0, 300)
}

/* --------------------------------------------------------- one renderer -- */

/**
 * The sentence a surface prints for a reading.
 *
 * Every page and the read-only API go through this, so a denial cannot be
 * worded as an absence on one surface and correctly on another — which is
 * precisely how the two drift. The DENIED string contains the action name and
 * the minimum statement verbatim; the EMPTY string contains neither, and says
 * "none", which is what makes the two provably different text.
 */
export function describeRead(read: AwsRead<unknown>, what: string): string {
  switch (read.state) {
    case "ACTUAL":
      return `${what} — as of ${read.asOf}${read.fresh ? "" : " (past its refresh window)"}`
    case "EMPTY":
      return `none — ${what} returned nothing, as of ${read.asOf}`
    case "DENIED":
      return (
        `unknown — this engine's role was refused ${read.action} (${read.errorCode}). ` +
        `Principal ${read.principal}` +
        `${read.accountId ? ` in account ${read.accountId}` : ""}` +
        `${read.region ? `, region ${read.region}` : ""}` +
        `${read.partition ? `, partition ${read.partition}` : ""}. ` +
        `Minimum statement: ${read.minimumStatement}`
      )
    case "STALE":
      return `${what} — held from ${read.asOf}, ${Math.round(read.ageMs / 1000)}s old and not re-read`
    case "THROTTLED":
      return `throttled — AWS rate-limited ${read.capability}; retrying in ${read.retryAfterMs}ms, as of ${read.asOf}`
    case "UNCONFIGURED":
      return `not configured — ${read.why}`
    case "ERROR":
      return `error — ${read.code}: ${read.safeDetail}`
  }
}

/** The HTTP status the read-only API answers with, so API and UI cannot drift. */
export function httpStatusFor(read: AwsRead<unknown>): number {
  switch (read.state) {
    case "ACTUAL":
    case "EMPTY":
    case "STALE":
      return 200
    case "DENIED":
      return 403
    case "THROTTLED":
      return 429
    case "UNCONFIGURED":
      return 501
    case "ERROR":
      return 502
  }
}

/** Items when there are some, and `[]` ONLY when the read said EMPTY. */
export function itemsOf<T>(read: AwsRead<readonly T[]>): readonly T[] {
  if (read.state === "ACTUAL" || read.state === "STALE") return read.value
  return []
}

/** Whether a reading is one the engine could not perform, for any reason. */
export function isUnknown(read: AwsRead<unknown>): boolean {
  return (
    read.state === "DENIED" ||
    read.state === "THROTTLED" ||
    read.state === "ERROR" ||
    read.state === "UNCONFIGURED"
  )
}

export { minimumStatement, minimumStatementText }

/* ------------------------------------------------------------- the seam -- */

/**
 * The one door to AWS.
 *
 * Every module in this directory takes an `AwsGateway` and never imports an SDK
 * package: `tests/architecture/forbidden-clients.test.mjs` allows exactly one
 * owner, and more importantly a client built at a second call site picks its own
 * region and credential chain. The interface is declared here rather than in
 * `client.ts` so a caller — or a test standing in for AWS — can name the type
 * without pulling a credential path into scope.
 */
export interface AwsGateway {
  /**
   * Perform one named capability. The input is the API's, narrowed by the
   * calling module; there is no path from an HTTP request to this argument.
   */
  call(capability: Capability, input?: Record<string, unknown>): Promise<unknown>
  /** The region the SDK resolved, never a literal. */
  resolvedRegion(): Promise<string>
}

/**
 * The production gateway, resolved lazily.
 *
 * `client.ts` imports `server-only` and the AWS SDK; importing it at module
 * scope here would make every module in this directory unloadable outside a
 * server component, including from the tests that prove the denial states. The
 * dynamic import happens on the first call, in a request, which is the only
 * place it is ever wanted.
 */
export function liveGateway(): AwsGateway {
  return {
    async call(capability, input) {
      const { gateway } = await import("./client")
      return gateway().call(capability, input)
    },
    async resolvedRegion() {
      const { gateway } = await import("./client")
      return gateway().resolvedRegion()
    },
  }
}
