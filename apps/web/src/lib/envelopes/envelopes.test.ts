/**
 * Envelopes, pagination and limits — tested on the cases that look fine.
 *
 * Every mechanism here fails quietly by default: a cursor that restarts a
 * listing, a page that stops one short, a rate limiter that says "wait 0
 * seconds", a bulk job that reports success with half its work undone. None
 * throws, none logs, and each sends the caller away with a wrong answer they
 * have no way to detect.
 */
import { describe, expect, it } from "@jest/globals"

import {
  PaginationError,
  decodeCursor,
  encodeCursor,
  parseSort,
  toPage,
} from "./pagination"
import {
  QUOTA_WARNING_RATIO,
  evaluatePrecondition,
  evaluateQuota,
  evaluateRateLimit,
  isTerminal,
  requirePrecondition,
  validateBulkJobStatus,
  type BulkJobStatus,
} from "./limits"

const NOW = "2026-08-01T12:00:00.000Z"

describe("cursors", () => {
  const cursor = { tenantId: "t-roch", sort: "createdAt:desc", after: "2026-01-01", afterId: "row-9" }

  it("round-trips", () => {
    expect(decodeCursor(encodeCursor(cursor), { tenantId: "t-roch", sort: "createdAt:desc" })).toEqual(cursor)
  })

  it("refuses a cursor issued for another tenant", () => {
    // A cursor is a small opaque-looking token that returns a page of rows.
    // Without this check it is one that returns another tenant's page.
    expect(() =>
      decodeCursor(encodeCursor(cursor), { tenantId: "t-mid", sort: "createdAt:desc" }),
    ).toThrow(/not issued for this tenant/)
  })

  it("does not reveal which tenant a foreign cursor belonged to", () => {
    // Otherwise the refusal is a way of learning that another tenant exists.
    try {
      decodeCursor(encodeCursor(cursor), { tenantId: "t-mid", sort: "createdAt:desc" })
    } catch (err) {
      expect((err as Error).message).not.toContain("t-roch")
    }
  })

  it("refuses a cursor issued against a different ordering", () => {
    // The position it names is meaningless in another sort, and using it would
    // silently return the wrong window rather than fail.
    expect(() =>
      decodeCursor(encodeCursor(cursor), { tenantId: "t-roch", sort: "name:asc" }),
    ).toThrow(/different ordering/)
  })

  it("refuses garbage rather than restarting the listing", () => {
    // A malformed cursor silently returning page one looks like data, and a
    // caller paging 10,000 rows would loop forever without noticing.
    for (const junk of ["not-base64!!", Buffer.from("{}").toString("base64url"), ""]) {
      expect(() => decodeCursor(junk, { tenantId: "t-roch", sort: "createdAt:desc" })).toThrow(
        PaginationError,
      )
    }
  })
})

describe("pages", () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({ id: `r${i}`, at: `2026-01-${10 + i}` }))
  const key = (r: { id: string; at: string }) => ({ value: r.at, id: r.id })

  it("uses the extra row to answer hasMore, and does not return it", () => {
    // `items.length === limit` cannot answer it: a final page that happens to
    // be exactly full is indistinguishable from one with more behind it.
    const page = toPage(rows.slice(0, 11), { limit: 10, tenantId: "t", sort: "at:asc", key })
    expect(page.items).toHaveLength(10)
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).not.toBeNull()
  })

  it("reports the last page as last, even when exactly full", () => {
    const page = toPage(rows.slice(0, 10), { limit: 10, tenantId: "t", sort: "at:asc", key })
    expect(page.items).toHaveLength(10)
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeNull()
  })

  it("issues a cursor pointing at the last returned row, not the extra one", () => {
    const page = toPage(rows.slice(0, 11), { limit: 10, tenantId: "t", sort: "at:asc", key })
    const decoded = decodeCursor(page.nextCursor!, { tenantId: "t", sort: "at:asc" })
    expect(decoded.afterId).toBe("r9")
  })

  it("refuses a limit above the cap", () => {
    expect(() => toPage(rows, { limit: 500, tenantId: "t", sort: "at:asc", key })).toThrow(
      /must not exceed/,
    )
    expect(() => toPage(rows, { limit: 0, tenantId: "t", sort: "at:asc", key })).toThrow(
      /positive integer/,
    )
  })
})

describe("sort whitelist", () => {
  it("refuses a field that is not allowed", () => {
    // The field arrives from a query string and reaches an ORDER BY. Allowing
    // an arbitrary one lets a caller sort by a column they cannot read, then
    // infer its values from the ordering.
    expect(() => parseSort("passwordHash:asc", ["createdAt", "name"], "createdAt:desc")).toThrow(
      /Cannot sort by/,
    )
  })

  it("refuses a direction that is not asc or desc", () => {
    expect(() => parseSort("createdAt:sideways", ["createdAt"], "createdAt:desc")).toThrow(
      /asc or desc/,
    )
  })

  it("falls back when none is given", () => {
    expect(parseSort(null, ["createdAt"], "createdAt:desc")).toBe("createdAt:desc")
    expect(parseSort("createdAt", ["createdAt"], "createdAt:desc")).toBe("createdAt:asc")
  })
})

describe("conditional operations", () => {
  it("lets a matching if-match through and blocks a stale one", () => {
    expect(evaluatePrecondition({ kind: "if-match", etag: "v3" }, "v3")).toEqual({ proceed: true })
    const stale = evaluatePrecondition({ kind: "if-match", etag: "v3" }, "v5")
    expect(stale).toMatchObject({ proceed: false, status: 412 })
    expect(!stale.proceed && stale.reason).toMatch(/Reload and try again/)
  })

  it("treats a vanished resource as a failed precondition, not a 404", () => {
    // The caller's assumption — that it was still there — is exactly what
    // failed, and 412 says that where 404 says something else.
    //
    // The MESSAGE is asserted, not just the status. Deleting the null branch
    // still yields 412, because null !== "v3" — so a status-only assertion
    // passes while the user is told "this changed since you loaded it" about
    // something that was deleted. Those are different situations and lead to
    // different actions: reload and retry, versus stop.
    const gone = evaluatePrecondition({ kind: "if-match", etag: "v3" }, null)
    expect(gone).toMatchObject({ proceed: false, status: 412 })
    expect(!gone.proceed && gone.reason).toBe("That no longer exists.")

    const changed = evaluatePrecondition({ kind: "if-match", etag: "v3" }, "v5")
    expect(!changed.proceed && changed.reason).not.toBe("That no longer exists.")
  })

  it("returns 304 for if-none-match on the current version", () => {
    expect(evaluatePrecondition({ kind: "if-none-match", etag: "v3" }, "v3")).toMatchObject({
      proceed: false,
      status: 304,
    })
    expect(evaluatePrecondition({ kind: "if-none-match", etag: "v3" }, "v5")).toEqual({ proceed: true })
  })

  it("can demand a precondition where a blind overwrite is unacceptable", () => {
    expect(() => requirePrecondition({ kind: "none" })).toThrow(/silently overwrites/)
    expect(() => requirePrecondition({ kind: "if-none-match", etag: "v" })).toThrow()
    expect(() => requirePrecondition({ kind: "if-match", etag: "v" })).not.toThrow()
  })
})

describe("rate limits", () => {
  const base = { limit: 10, windowStart: NOW, windowMs: 60_000, now: NOW }

  it("allows below the limit and denies at it", () => {
    expect(evaluateRateLimit({ ...base, count: 9 }).allowed).toBe(true)
    expect(evaluateRateLimit({ ...base, count: 10 }).allowed).toBe(false)
  })

  it("never tells a denied caller to wait zero seconds", () => {
    // 400ms remaining rounded down is an immediate retry that is denied again.
    const almost = evaluateRateLimit({
      ...base,
      count: 10,
      now: new Date(Date.parse(NOW) + 59_600).toISOString(),
    })
    expect(almost.allowed).toBe(false)
    expect(almost.retryAfterSeconds).toBeGreaterThanOrEqual(1)
  })

  it("rolls the window rather than counting a stale one", () => {
    const rolled = evaluateRateLimit({
      ...base,
      count: 100,
      now: new Date(Date.parse(NOW) + 61_000).toISOString(),
    })
    expect(rolled.allowed).toBe(true)
    expect(rolled.remaining).toBe(9)
  })

  it("never reports negative remaining", () => {
    expect(evaluateRateLimit({ ...base, count: 50 }).remaining).toBe(0)
  })
})

describe("quotas", () => {
  it("denies without offering a retry, because waiting will not help", () => {
    const d = evaluateQuota({ used: 95, limit: 100, requesting: 10 })
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/Waiting will not help/)
  })

  it("warns on the request that crosses the threshold, and not after", () => {
    // Reporting it on every subsequent request turns a useful warning into
    // noise that gets filtered out.
    const crossing = evaluateQuota({ used: 79, limit: 100, requesting: 5 })
    expect(crossing.crossedWarningThreshold).toBe(true)

    const already = evaluateQuota({ used: 85, limit: 100, requesting: 5 })
    expect(already.crossedWarningThreshold).toBe(false)
  })

  it("uses the stated threshold", () => {
    expect(QUOTA_WARNING_RATIO).toBe(0.8)
  })

  it("refuses a zero-unit check", () => {
    expect(() => evaluateQuota({ used: 0, limit: 100, requesting: 0 })).toThrow(/at least one unit/)
  })
})

describe("bulk jobs", () => {
  const status = (over: Partial<BulkJobStatus> = {}): BulkJobStatus => ({
    jobId: "job-1",
    state: "running",
    total: 100,
    processed: 40,
    failed: 0,
    resultRef: null,
    reason: null,
    ...over,
  })

  it("accepts a coherent running status", () => {
    expect(validateBulkJobStatus(status()).state).toBe("running")
  })

  it("refuses success with work outstanding", () => {
    // A caller polls this to decide whether to stop waiting, and takes an
    // incomplete result as complete.
    expect(() =>
      validateBulkJobStatus(status({ state: "succeeded", processed: 40, resultRef: "r" })),
    ).toThrow(/items unprocessed/)
  })

  it("refuses success with failures", () => {
    expect(() =>
      validateBulkJobStatus(
        status({ state: "succeeded", processed: 100, failed: 3, resultRef: "r" }),
      ),
    ).toThrow(/use failed, or report partial success/)
  })

  it("refuses success with nothing to fetch", () => {
    expect(() =>
      validateBulkJobStatus(status({ state: "succeeded", processed: 100, resultRef: null })),
    ).toThrow(/nothing to fetch/)
  })

  it("refuses a failure or cancellation with no reason", () => {
    expect(() => validateBulkJobStatus(status({ state: "failed" }))).toThrow(/no reason/)
    expect(() => validateBulkJobStatus(status({ state: "cancelled" }))).toThrow(/no reason/)
  })

  it("refuses counts that contradict each other", () => {
    expect(() => validateBulkJobStatus(status({ processed: 200 }))).toThrow(/exceeds total/)
    expect(() => validateBulkJobStatus(status({ failed: 50, processed: 40 }))).toThrow(
      /exceeds processed/,
    )
    expect(() => validateBulkJobStatus(status({ processed: -1 }))).toThrow(/negative/)
  })

  it("refuses a result that exists before the job finished", () => {
    expect(() => validateBulkJobStatus(status({ state: "running", resultRef: "r" }))).toThrow(
      /before the job finished/,
    )
  })

  it("knows which states are terminal", () => {
    expect(isTerminal("succeeded")).toBe(true)
    expect(isTerminal("failed")).toBe(true)
    expect(isTerminal("cancelled")).toBe(true)
    expect(isTerminal("running")).toBe(false)
    expect(isTerminal("accepted")).toBe(false)
  })
})
