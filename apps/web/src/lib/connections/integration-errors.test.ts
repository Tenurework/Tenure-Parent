import {
  INTEGRATION_ERROR_CLASSES,
  RETRY_DISPOSITION,
  UnclassifiableAttempt,
  classifyPipelineFailure,
  classifyProviderAttempt,
  mayRetryUnattended,
  retryAfterMs,
  type IntegrationErrorClass,
  type PipelineStage,
  type ProviderAttempt,
} from "@/lib/connections/integration-errors"

const NOW = Date.parse("2026-08-17T12:00:00.000Z")

function attempt(over: Partial<ProviderAttempt>): ProviderAttempt {
  return { effect: "read", idempotencyKey: null, status: 500, ...over }
}

describe("the taxonomy itself", () => {
  it("declares every class exactly once", () => {
    expect(new Set(INTEGRATION_ERROR_CLASSES).size).toBe(INTEGRATION_ERROR_CLASSES.length)
    expect(INTEGRATION_ERROR_CLASSES.length).toBe(22)
  })

  it("gives every class a disposition — no class falls through to a default", () => {
    for (const c of INTEGRATION_ERROR_CLASSES) {
      expect(RETRY_DISPOSITION[c]).toBeDefined()
    }
    expect(Object.keys(RETRY_DISPOSITION).sort()).toEqual([...INTEGRATION_ERROR_CLASSES].sort())
  })

  it("has no dead class: every class is reachable from a classifier", () => {
    // A class nobody can raise is a class nobody handles. This walks the two
    // producers and asserts their combined image is the whole taxonomy.
    const produced = new Set<IntegrationErrorClass>()

    const providerCases: ProviderAttempt[] = [
      attempt({ status: 401 }),
      attempt({ status: 401, providerCode: "invalid_grant" }),
      attempt({ status: 403 }),
      attempt({ status: 403, providerCode: "consent_revoked" }),
      attempt({ status: 400 }),
      attempt({ status: 404 }),
      attempt({ status: 409 }),
      attempt({ status: 409, providerCode: "duplicate_request" }),
      attempt({ status: 413 }),
      attempt({ status: 415 }),
      attempt({ status: 422 }),
      attempt({ status: 429 }),
      attempt({ status: 429, providerCode: "quota_exhausted" }),
      attempt({ status: 451 }),
      attempt({ status: 501 }),
      attempt({ status: 503 }),
      attempt({ status: 202 }),
      attempt({ status: null, transport: "response-timeout" }),
      attempt({ status: null, transport: "dns-failure" }),
      attempt({ status: null, transport: "tls-failure" }),
      attempt({ status: null, transport: "response-timeout", effect: "write" }),
    ]
    for (const c of providerCases) produced.add(classifyProviderAttempt(c, NOW).errorClass)

    const stages: PipelineStage[] = [
      "mapping",
      "schema-registry",
      "malware-scan",
      "reconciliation",
      "reference-resolution",
      "duplicate-detected",
    ]
    for (const s of stages) produced.add(classifyPipelineFailure(s, "x").errorClass)

    const missing = INTEGRATION_ERROR_CLASSES.filter((c) => !produced.has(c))
    expect(missing).toEqual([])
  })

  it("lets a scheduler act alone only on retry-automatically", () => {
    expect(mayRetryUnattended("retry-automatically")).toBe(true)
    expect(mayRetryUnattended("retry-after-remediation")).toBe(false)
    expect(mayRetryUnattended("do-not-retry")).toBe(false)
    expect(mayRetryUnattended("reconcile-before-retry")).toBe(false)
  })
})

describe("INT-060-005 — an unknown outcome is never a blind retry", () => {
  it("a write with no idempotency key whose response never arrived is UNKNOWN_OUTCOME", () => {
    const result = classifyProviderAttempt(
      attempt({ effect: "write", idempotencyKey: null, status: null, transport: "response-timeout" }),
      NOW,
    )
    expect(result.errorClass).toBe("UNKNOWN_OUTCOME")
    expect(result.disposition).toBe("reconcile-before-retry")
    expect(mayRetryUnattended(result.disposition)).toBe(false)
  })

  it("the same write CARRYING an idempotency key is a plain timeout, because the provider deduplicates", () => {
    const result = classifyProviderAttempt(
      attempt({ effect: "write", idempotencyKey: "idem-9001", status: null, transport: "response-timeout" }),
      NOW,
    )
    expect(result.errorClass).toBe("NETWORK_TIMEOUT")
    expect(mayRetryUnattended(result.disposition)).toBe(true)
  })

  it("a READ that times out retries itself — a read has no effect to duplicate", () => {
    const result = classifyProviderAttempt(
      attempt({ effect: "read", status: null, transport: "response-timeout" }),
      NOW,
    )
    expect(result.errorClass).toBe("NETWORK_TIMEOUT")
    expect(mayRetryUnattended(result.disposition)).toBe(true)
  })

  it("a write that never left this process is safe: nothing reached the provider", () => {
    for (const transport of ["connect-timeout", "dns-failure"] as const) {
      const result = classifyProviderAttempt(
        attempt({ effect: "write", idempotencyKey: null, status: null, transport }),
        NOW,
      )
      expect(result.errorClass).not.toBe("UNKNOWN_OUTCOME")
      expect(mayRetryUnattended(result.disposition)).toBe(true)
    }
  })

  it("502 and 504 on an unkeyed write are UNKNOWN_OUTCOME — the origin may have applied it", () => {
    for (const status of [502, 504]) {
      const result = classifyProviderAttempt(
        attempt({ effect: "write", idempotencyKey: null, status }),
        NOW,
      )
      expect(result.errorClass).toBe("UNKNOWN_OUTCOME")
      expect(result.disposition).toBe("reconcile-before-retry")
    }
  })

  it("502 and 504 on a READ are transient — nothing was applied on our behalf", () => {
    for (const status of [502, 504]) {
      const result = classifyProviderAttempt(attempt({ effect: "read", status }), NOW)
      expect(result.errorClass).toBe("TRANSIENT_PROVIDER")
      expect(mayRetryUnattended(result.disposition)).toBe(true)
    }
  })

  it("503 on an unkeyed write is transient, not unknown — the request was refused, not lost", () => {
    const result = classifyProviderAttempt(
      attempt({ effect: "write", idempotencyKey: null, status: 503 }),
      NOW,
    )
    expect(result.errorClass).toBe("TRANSIENT_PROVIDER")
  })

  it("every class that means 'we do not know' is reconcile-before-retry, and no other class is", () => {
    const unknown = INTEGRATION_ERROR_CLASSES.filter(
      (c) => RETRY_DISPOSITION[c] === "reconcile-before-retry",
    )
    expect([...unknown].sort()).toEqual(["RECONCILIATION_VARIANCE", "UNKNOWN_OUTCOME"])
  })
})

describe("classification refuses to guess", () => {
  it("refuses an attempt with no status and no transport outcome", () => {
    expect(() => classifyProviderAttempt(attempt({ status: null, transport: null }), NOW)).toThrow(
      UnclassifiableAttempt,
    )
  })

  it("refuses to put an error class on a settled success", () => {
    expect(() => classifyProviderAttempt(attempt({ status: 200 }), NOW)).toThrow(UnclassifiableAttempt)
    expect(() => classifyProviderAttempt(attempt({ status: 201, settled: true }), NOW)).toThrow(
      UnclassifiableAttempt,
    )
  })

  it("names a 2xx that is not finished rather than calling it done", () => {
    expect(classifyProviderAttempt(attempt({ status: 202 }), NOW).errorClass).toBe(
      "ACKNOWLEDGED_NOT_SETTLED",
    )
    expect(classifyProviderAttempt(attempt({ status: 200, settled: false }), NOW).errorClass).toBe(
      "ACKNOWLEDGED_NOT_SETTLED",
    )
  })

  it("refuses a status nobody mapped instead of dropping it into a neighbour", () => {
    expect(() => classifyProviderAttempt(attempt({ status: 418 }), NOW)).toThrow(UnclassifiableAttempt)
  })
})

describe("status and provider code mapping", () => {
  const cases: [Partial<ProviderAttempt>, IntegrationErrorClass][] = [
    [{ status: 401 }, "AUTHENTICATION_FAILED"],
    [{ status: 401, providerCode: "token_expired" }, "REAUTH_REQUIRED"],
    [{ status: 403 }, "AUTHORIZATION_DENIED"],
    [{ status: 403, providerCode: "consent_revoked" }, "CONSENT_REVOKED"],
    [{ status: 400 }, "VALIDATION_FAILED"],
    [{ status: 404 }, "REFERENCE_NOT_FOUND"],
    [{ status: 410 }, "REFERENCE_NOT_FOUND"],
    [{ status: 409 }, "CONFLICT"],
    [{ status: 409, providerCode: "already_exists" }, "DUPLICATE"],
    [{ status: 413 }, "PAYLOAD_TOO_LARGE"],
    [{ status: 415 }, "SCHEMA_INCOMPATIBLE"],
    [{ status: 422 }, "BUSINESS_REJECTED"],
    [{ status: 429 }, "RATE_LIMITED"],
    [{ status: 429, headers: { "x-quota-remaining": "0" } }, "QUOTA_EXCEEDED"],
    [{ status: 451 }, "REGION_OR_RESIDENCY_BLOCK"],
    [{ status: 501 }, "PERMANENT_PROVIDER"],
    [{ status: 505 }, "PERMANENT_PROVIDER"],
    [{ status: 500 }, "TRANSIENT_PROVIDER"],
  ]

  it.each(cases)("%j classifies as %s", (over, expected) => {
    expect(classifyProviderAttempt(attempt(over), NOW).errorClass).toBe(expected)
  })

  it("separates rate pressure from an exhausted allowance", () => {
    expect(classifyProviderAttempt(attempt({ status: 429 }), NOW).disposition).toBe(
      "retry-automatically",
    )
    expect(
      classifyProviderAttempt(attempt({ status: 429, providerCode: "quota_exceeded" }), NOW)
        .disposition,
    ).toBe("retry-after-remediation")
  })
})

describe("Retry-After", () => {
  it("reads seconds", () => {
    expect(retryAfterMs({ "retry-after": "30" }, NOW)).toBe(30_000)
  })

  it("reads an HTTP-date and never returns a negative wait", () => {
    expect(retryAfterMs({ "retry-after": new Date(NOW + 45_000).toUTCString() }, NOW)).toBe(45_000)
    expect(retryAfterMs({ "retry-after": new Date(NOW - 45_000).toUTCString() }, NOW)).toBe(0)
  })

  it("distinguishes 'we were not told' from 'retry immediately'", () => {
    expect(retryAfterMs(undefined, NOW)).toBeNull()
    expect(retryAfterMs({}, NOW)).toBeNull()
    expect(retryAfterMs({ "retry-after": "  " }, NOW)).toBeNull()
    expect(retryAfterMs({ "retry-after": "later please" }, NOW)).toBeNull()
    expect(retryAfterMs({ "retry-after": "0" }, NOW)).toBe(0)
  })

  it("reads an epoch reset as an absolute time and a small reset as a duration", () => {
    const epochSeconds = Math.floor(NOW / 1000) + 60
    expect(retryAfterMs({ "x-ratelimit-reset": String(epochSeconds) }, NOW)).toBe(60_000)
    expect(retryAfterMs({ "x-ratelimit-reset": "12" }, NOW)).toBe(12_000)
  })

  it("travels on the classification of a rate limit", () => {
    const result = classifyProviderAttempt(
      attempt({ status: 429, headers: { "retry-after": "2" } }),
      NOW,
    )
    expect(result.retryAfterMs).toBe(2000)
  })
})

describe("pipeline failures", () => {
  it("produces the four classes no provider response can produce", () => {
    expect(classifyPipelineFailure("mapping", "field absent").errorClass).toBe("MAPPING_FAILED")
    expect(classifyPipelineFailure("malware-scan", "blocked").errorClass).toBe(
      "MALWARE_OR_POLICY_BLOCK",
    )
    expect(classifyPipelineFailure("reconciliation", "2 rows differ").errorClass).toBe(
      "RECONCILIATION_VARIANCE",
    )
    expect(classifyPipelineFailure("schema-registry", "v3 unknown").errorClass).toBe(
      "SCHEMA_INCOMPATIBLE",
    )
  })

  it("carries the stage and the detail into the reason", () => {
    expect(classifyPipelineFailure("mapping", "amount had no source").reason).toBe(
      "mapping: amount had no source",
    )
  })
})
