/**
 * INT-060-002 / INT-060-005 — the integration error taxonomy, and the one
 * classification that must never be guessed.
 *
 * Bible §14 states a MINIMUM set of classes and requires them to be stable.
 * "Stable" is the whole requirement: a taxonomy that drifts is not a taxonomy,
 * it is a habit, and an alert written against `TRANSIENT_PROVIDER` stops firing
 * the day somebody renames it to `PROVIDER_TRANSIENT`. So the list below is not
 * a copy of §14 that somebody keeps in step by hand —
 * `tests/architecture/int-error-taxonomy-matches-the-bible.test.mjs` slices the
 * code fence out of the Bible and fails when the two disagree in content or in
 * order. The authority states the vocabulary; this file declares it; the guard
 * is what makes "stable" mean something a reader can check.
 *
 * ── The class this file exists for ──────────────────────────────────────────
 *
 * `UNKNOWN_OUTCOME` is the only entry in §14 that is not a failure. It is the
 * ABSENCE of an answer, and the distinction this codebase most often collapses:
 * "we called the provider and it refused" and "we called the provider and never
 * found out" are different facts, and a classifier that folds the second into
 * `NETWORK_TIMEOUT` has just told a retry loop that nothing happened. If the
 * request bytes reached a provider that charges money, something may very well
 * have happened, and retrying is how one payment becomes two.
 *
 * So `classifyProviderAttempt` takes the two things that decide it and refuses
 * to work without them: what the call would DO if it succeeded (`effect`), and
 * whether the provider can recognise a repeat (`idempotencyKey`). A read that
 * times out is `NETWORK_TIMEOUT` and retries itself. A write that times out
 * carrying an idempotency key is also `NETWORK_TIMEOUT`, because the provider
 * deduplicates it. A write that times out with no key is `UNKNOWN_OUTCOME`, and
 * its disposition is `reconcile-before-retry` — never `retry-automatically`.
 * That is INT-060-005 in three lines, and the tests hold each of them.
 *
 * ── What this module deliberately is not ────────────────────────────────────
 *
 * Not a transport, not a retry loop and not a store. It maps an outcome that
 * already happened onto a word, and says what may be done next. The scheduling
 * lives with whoever owns the queue (`src/lib/outbox/outbox.ts` for the
 * platform's own events), and putting a `setTimeout` in here would make every
 * rule below untestable without one.
 */

/**
 * Bible §14's minimum classes, in the Bible's own order.
 *
 * Order is asserted as well as membership. §14 is a list a human reads top to
 * bottom — auth, then validation, then provider, then the two "we do not know"
 * classes at the end — and a set comparison would let the order rot while the
 * test stayed green.
 */
export const INTEGRATION_ERROR_CLASSES = [
  "AUTHENTICATION_FAILED",
  "AUTHORIZATION_DENIED",
  "CONSENT_REVOKED",
  "REAUTH_REQUIRED",
  "VALIDATION_FAILED",
  "SCHEMA_INCOMPATIBLE",
  "MAPPING_FAILED",
  "REFERENCE_NOT_FOUND",
  "DUPLICATE",
  "CONFLICT",
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "TRANSIENT_PROVIDER",
  "PERMANENT_PROVIDER",
  "NETWORK_TIMEOUT",
  "PAYLOAD_TOO_LARGE",
  "MALWARE_OR_POLICY_BLOCK",
  "REGION_OR_RESIDENCY_BLOCK",
  "BUSINESS_REJECTED",
  "ACKNOWLEDGED_NOT_SETTLED",
  "RECONCILIATION_VARIANCE",
  "UNKNOWN_OUTCOME",
] as const

export type IntegrationErrorClass = (typeof INTEGRATION_ERROR_CLASSES)[number]

/**
 * What a caller may do next. Four words, and the fourth is the point.
 *
 * `do-not-retry` and `reconcile-before-retry` are not synonyms. The first says
 * a repeat cannot change the answer; the second says a repeat might change the
 * WORLD, because we do not know what the first attempt did. Collapsing them is
 * how an unknown outcome becomes a duplicate business action.
 */
export type RetryDisposition =
  /** Safe to repeat unattended: nothing happened, or the provider deduplicates. */
  | "retry-automatically"
  /** A human or a configuration change must act first; repeating now repeats the refusal. */
  | "retry-after-remediation"
  /** Repeating cannot change the answer. The work is finished, wrongly or rightly. */
  | "do-not-retry"
  /** The outcome is unknown. Establish what happened before any repeat. */
  | "reconcile-before-retry"

/**
 * The disposition of every class, as a total map.
 *
 * A `Record` over the union rather than a lookup with a default: adding a class
 * is then a compile error here, which forces the decision to be made by whoever
 * adds it instead of falling into whatever the default happened to be. The
 * default that would have been chosen is `retry-automatically`, and a new class
 * silently inheriting it is the exact defect this file is about.
 */
export const RETRY_DISPOSITION: Record<IntegrationErrorClass, RetryDisposition> = {
  // Credentials and consent: the call will keep being refused until somebody
  // fixes the credential, so an unattended retry is a loop, not a recovery.
  AUTHENTICATION_FAILED: "retry-after-remediation",
  AUTHORIZATION_DENIED: "retry-after-remediation",
  CONSENT_REVOKED: "retry-after-remediation",
  REAUTH_REQUIRED: "retry-after-remediation",

  // Our payload is wrong. Sending it again sends the same wrong payload.
  VALIDATION_FAILED: "retry-after-remediation",
  SCHEMA_INCOMPATIBLE: "retry-after-remediation",
  MAPPING_FAILED: "retry-after-remediation",
  REFERENCE_NOT_FOUND: "retry-after-remediation",

  // The work already exists. Repeating it is the duplicate we were avoiding.
  DUPLICATE: "do-not-retry",
  // Somebody else changed the resource. A blind repeat overwrites their change;
  // the caller must re-read and decide.
  CONFLICT: "retry-after-remediation",

  // Pressure, not failure. These are the two the scheduler may handle alone.
  RATE_LIMITED: "retry-automatically",
  QUOTA_EXCEEDED: "retry-after-remediation",
  TRANSIENT_PROVIDER: "retry-automatically",
  PERMANENT_PROVIDER: "do-not-retry",
  NETWORK_TIMEOUT: "retry-automatically",

  // Bounded by something about the content itself.
  PAYLOAD_TOO_LARGE: "retry-after-remediation",
  MALWARE_OR_POLICY_BLOCK: "do-not-retry",
  REGION_OR_RESIDENCY_BLOCK: "do-not-retry",

  // The provider understood us and said no. That is an answer.
  BUSINESS_REJECTED: "do-not-retry",
  // The provider took it and has not finished. Repeating submits it twice.
  ACKNOWLEDGED_NOT_SETTLED: "do-not-retry",
  // Two records disagree. Retrying the call does not reconcile them.
  RECONCILIATION_VARIANCE: "reconcile-before-retry",

  // The one that must never be automatic.
  UNKNOWN_OUTCOME: "reconcile-before-retry",
}

/** Dispositions under which an automated scheduler may act with no human. */
export const UNATTENDED_DISPOSITIONS: readonly RetryDisposition[] = ["retry-automatically"]

/**
 * True when a scheduler may repeat the call by itself.
 *
 * Exported as a function rather than left to `=== "retry-automatically"` at
 * each call site, because that comparison is the one a future caller writes as
 * `!== "do-not-retry"` — which lets `reconcile-before-retry` through.
 */
export function mayRetryUnattended(disposition: RetryDisposition): boolean {
  return UNATTENDED_DISPOSITIONS.includes(disposition)
}

/** How the transport ended when no HTTP response arrived. */
export type TransportOutcome =
  /** The connection was never established. Nothing was sent. */
  | "connect-timeout"
  /** DNS did not resolve. Nothing was sent. */
  | "dns-failure"
  /** The TLS handshake failed. Nothing was sent, and trust is a configuration fact. */
  | "tls-failure"
  /** The request was sent and no response arrived within the deadline. */
  | "response-timeout"
  /** The connection dropped mid-exchange. */
  | "connection-reset"

/** What a call would do to the provider's state if it succeeded. */
export type CallEffect = "read" | "write"

export interface ProviderAttempt {
  /**
   * Required, with no default. A default of `"read"` would make every
   * unannotated write safe to retry, and a default of `"write"` would make
   * every unannotated read need a human — the first is a duplication bug and
   * the second is an outage. The caller knows; it must say.
   */
  effect: CallEffect
  /**
   * The key WE sent so the provider can recognise a repeat, or null when we
   * sent none. Not "does the provider support idempotency" — whether this
   * particular request carried one.
   */
  idempotencyKey: string | null
  /** The HTTP status, or null when no response was received at all. */
  status: number | null
  /** How the transport ended. Required when `status` is null, ignored otherwise. */
  transport?: TransportOutcome | null
  /** Response headers with lower-cased names, as `fetch` yields them. */
  headers?: Readonly<Record<string, string>>
  /** The provider's own machine-readable code, when it sent one. */
  providerCode?: string | null
  /**
   * For a 2xx: whether the provider says the business effect is FINISHED.
   * A 202 that means "queued" is `false`, and §14 has a word for it.
   */
  settled?: boolean
}

export interface Classification {
  errorClass: IntegrationErrorClass
  disposition: RetryDisposition
  /** Milliseconds the provider asked us to wait, when it said so. Null otherwise. */
  retryAfterMs: number | null
  /** Why this class was chosen, in the terms of the inputs. Never a payload. */
  reason: string
}

export class UnclassifiableAttempt extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnclassifiableAttempt"
  }
}

/**
 * Parse `Retry-After` — seconds, or an HTTP-date — and the common reset header.
 *
 * Returns null rather than 0 when the header is absent or unreadable, because 0
 * means "retry immediately" and absent means "we were not told". A parser that
 * returned 0 for both would turn a missing header into a hot loop.
 */
export function retryAfterMs(
  headers: Readonly<Record<string, string>> | undefined,
  now: number,
): number | null {
  if (!headers) return null

  const raw = headers["retry-after"] ?? headers["x-ratelimit-reset-after"]
  if (typeof raw === "string" && raw.trim().length > 0) {
    const trimmed = raw.trim()
    // Seconds. `Number` on "" is 0, which is why the emptiness check is above.
    if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000)
    const asDate = Date.parse(trimmed)
    // A date in the past means "now"; a negative wait would schedule backwards.
    if (Number.isFinite(asDate)) return Math.max(0, asDate - now)
    return null
  }

  // Unix-epoch reset, in seconds. Distinguished from a duration by magnitude:
  // a duration this large would be eleven days, and an epoch this small would
  // be 1970. The boundary is stated rather than guessed.
  const reset = headers["x-ratelimit-reset"]
  if (typeof reset === "string" && /^\d+$/.test(reset)) {
    const seconds = Number(reset)
    if (seconds > 1_000_000_000) return Math.max(0, seconds * 1000 - now)
    return seconds * 1000
  }

  return null
}

/** Whether the provider's own code names a consent/reauth condition. */
function codeSays(code: string | null | undefined, ...needles: string[]): boolean {
  if (!code) return false
  const lower = code.toLowerCase()
  return needles.some((n) => lower.includes(n))
}

/**
 * Whether a quota header says the allowance for the period is gone.
 *
 * A 429 is "too fast"; an exhausted quota is "not until the period rolls". They
 * have different dispositions — the first retries itself, the second needs
 * somebody to raise a limit or wait for a month boundary — so they must not
 * share a class.
 */
function quotaExhausted(
  headers: Readonly<Record<string, string>> | undefined,
  providerCode: string | null | undefined,
): boolean {
  if (codeSays(providerCode, "quota", "limit_exceeded_period", "monthly")) return true
  if (!headers) return false
  const remaining = headers["x-quota-remaining"] ?? headers["x-ratelimit-remaining-day"]
  return typeof remaining === "string" && /^0+$/.test(remaining.trim())
}

/**
 * Classify one attempt against a provider.
 *
 * The order of the branches is the design, and it starts with the case that has
 * no HTTP status at all — because that is where `UNKNOWN_OUTCOME` lives and a
 * classifier that checks statuses first never reaches it.
 */
export function classifyProviderAttempt(attempt: ProviderAttempt, now: number): Classification {
  const { status, effect, idempotencyKey, headers, providerCode } = attempt
  const wait = retryAfterMs(headers, now)
  const deduplicated = typeof idempotencyKey === "string" && idempotencyKey.length > 0

  const of = (errorClass: IntegrationErrorClass, reason: string): Classification => ({
    errorClass,
    disposition: RETRY_DISPOSITION[errorClass],
    retryAfterMs: wait,
    reason,
  })

  // ── No response at all ────────────────────────────────────────────────────
  if (status === null) {
    const transport = attempt.transport ?? null
    if (transport === null) {
      // Refused rather than defaulted. "No status and no transport outcome" is
      // a caller that did not look, and guessing here would put a made-up class
      // on a real failure.
      throw new UnclassifiableAttempt(
        "An attempt with no HTTP status must say how the transport ended. Without it there is no " +
          "way to tell a request that was never sent from one whose outcome is unknown, and those " +
          "two have opposite dispositions.",
      )
    }

    // Nothing left this process. Whatever the effect was, it did not happen.
    if (transport === "connect-timeout" || transport === "dns-failure") {
      return of(
        transport === "dns-failure" ? "TRANSIENT_PROVIDER" : "NETWORK_TIMEOUT",
        `no connection was established (${transport}), so the request was never delivered`,
      )
    }
    if (transport === "tls-failure") {
      // Trust is configuration, not weather. Retrying a handshake that failed
      // on a certificate hammers a provider that will keep refusing.
      return of("PERMANENT_PROVIDER", "the TLS handshake failed, which is a trust configuration fact")
    }

    // The request was sent and we never learned what it did.
    if (effect === "read") {
      return of("NETWORK_TIMEOUT", `a read timed out (${transport}); a read has no effect to duplicate`)
    }
    if (deduplicated) {
      return of(
        "NETWORK_TIMEOUT",
        `a write timed out (${transport}) carrying an idempotency key, so a repeat is deduplicated by the provider`,
      )
    }
    return of(
      "UNKNOWN_OUTCOME",
      `a write with no idempotency key ended as ${transport} after the request was sent; whether the provider applied it is not known`,
    )
  }

  // ── A response arrived ────────────────────────────────────────────────────
  if (status >= 200 && status < 300) {
    if (attempt.settled === false || status === 202) {
      return of(
        "ACKNOWLEDGED_NOT_SETTLED",
        `the provider accepted the request (${status}) without saying the business effect is complete`,
      )
    }
    throw new UnclassifiableAttempt(
      `HTTP ${status} with settled !== false is a success, not a failure. Classifying a success ` +
        `would put an error class on work that completed.`,
    )
  }

  if (status === 401) {
    if (codeSays(providerCode, "expired", "reauth", "invalid_grant")) {
      return of("REAUTH_REQUIRED", `the provider returned 401 with code ${providerCode}`)
    }
    return of("AUTHENTICATION_FAILED", "the provider returned 401")
  }
  if (status === 403) {
    if (codeSays(providerCode, "consent", "revoked", "access_denied")) {
      return of("CONSENT_REVOKED", `the provider returned 403 with code ${providerCode}`)
    }
    return of("AUTHORIZATION_DENIED", "the provider returned 403")
  }
  if (status === 404 || status === 410) {
    return of("REFERENCE_NOT_FOUND", `the provider returned ${status} for the referenced object`)
  }
  if (status === 409) {
    if (codeSays(providerCode, "duplicate", "idempot", "already_exists")) {
      return of("DUPLICATE", `the provider returned 409 with code ${providerCode}`)
    }
    return of("CONFLICT", "the provider returned 409")
  }
  if (status === 413) return of("PAYLOAD_TOO_LARGE", "the provider returned 413")
  if (status === 415) return of("SCHEMA_INCOMPATIBLE", "the provider returned 415")
  if (status === 422) {
    return of("BUSINESS_REJECTED", "the provider returned 422 — it understood the request and refused it")
  }
  if (status === 429) {
    if (quotaExhausted(headers, providerCode)) {
      return of("QUOTA_EXCEEDED", "the provider returned 429 and reports no allowance left for the period")
    }
    return of("RATE_LIMITED", "the provider returned 429")
  }
  if (status === 451) {
    return of("REGION_OR_RESIDENCY_BLOCK", "the provider returned 451")
  }
  if (status === 400) return of("VALIDATION_FAILED", "the provider returned 400")

  if (status >= 500) {
    // 502 and 504 mean an intermediary gave up waiting for the origin. The
    // origin may have applied the write. That is the same "we never found out"
    // as a client-side timeout, and it gets the same class.
    const gatewayGaveUp = status === 502 || status === 504
    if (gatewayGaveUp && effect === "write" && !deduplicated) {
      return of(
        "UNKNOWN_OUTCOME",
        `the provider returned ${status}, which means an intermediary stopped waiting for the origin; whether the write was applied is not known`,
      )
    }
    if (status === 501 || status === 505) {
      return of("PERMANENT_PROVIDER", `the provider returned ${status}`)
    }
    return of("TRANSIENT_PROVIDER", `the provider returned ${status}`)
  }

  // A status nobody mapped. Named as unclassifiable rather than dropped into a
  // class, because "we could not look" and "we looked and found nothing" are
  // different answers and this codebase's characteristic defect is writing them
  // as one.
  throw new UnclassifiableAttempt(
    `HTTP ${status} has no mapping in the taxonomy. Add one deliberately rather than letting it ` +
      `fall into a neighbouring class.`,
  )
}

/**
 * Stages of our OWN pipeline that fail before or after the provider call.
 *
 * Four §14 classes cannot be produced by a provider response — nothing a
 * provider returns says "our mapping failed" — so they would be dead entries in
 * the taxonomy if this did not exist, and a dead class is one nobody can raise
 * and therefore one nobody handles.
 */
export type PipelineStage =
  | "mapping"
  | "schema-registry"
  | "malware-scan"
  | "reconciliation"
  | "reference-resolution"
  | "duplicate-detected"

const PIPELINE_CLASSES: Record<PipelineStage, IntegrationErrorClass> = {
  mapping: "MAPPING_FAILED",
  "schema-registry": "SCHEMA_INCOMPATIBLE",
  "malware-scan": "MALWARE_OR_POLICY_BLOCK",
  reconciliation: "RECONCILIATION_VARIANCE",
  "reference-resolution": "REFERENCE_NOT_FOUND",
  "duplicate-detected": "DUPLICATE",
}

export function classifyPipelineFailure(stage: PipelineStage, detail: string): Classification {
  const errorClass = PIPELINE_CLASSES[stage]
  return {
    errorClass,
    disposition: RETRY_DISPOSITION[errorClass],
    retryAfterMs: null,
    reason: `${stage}: ${detail}`,
  }
}
