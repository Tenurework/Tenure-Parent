import { ContractViolation, MAX_PAGE } from "@tenure/contracts"

/**
 * GE-021-007 — cursor pagination, and why the cursor is checked.
 *
 * Offset pagination over a table that is being written to skips and repeats
 * rows, and the caller cannot tell which happened. A cursor points at a
 * position in a deterministic ordering instead, so a row inserted behind you
 * does not shift everything you have not read yet.
 *
 * ── The cursor is a client-supplied value ───────────────────────────────────
 *
 * It comes back from a browser, so it is a claim like any other. Two things
 * follow, and both are easy to skip:
 *
 *   * it carries the tenant it was issued for, and a cursor from another
 *     tenant is refused — otherwise a cursor is a small, opaque-looking token
 *     that reads another tenant's next page
 *   * it carries the sort it was issued for, and a cursor used against a
 *     different sort is refused, because the position it names is meaningless
 *     in a different ordering and would silently return the wrong window
 *
 * It is deliberately **not** signed. Signing would make it tamper-evident, and
 * tamper-evidence is not the property that matters: the tenant is checked
 * against the caller's resolved tenant, so a forged cursor naming another
 * tenant is refused by the check rather than by the signature. A signature
 * would add key management for a guarantee already held elsewhere.
 */

export interface Cursor {
  /** The tenant this cursor was issued for. */
  tenantId: string
  /** The sort it was issued against. A cursor is only meaningful within one. */
  sort: string
  /** The last row's sort value, as text. */
  after: string
  /** The last row's id, breaking ties so the ordering is total. */
  afterId: string
}

export interface Page<T> {
  items: T[]
  /** Null when there is nothing after this page. */
  nextCursor: string | null
  /** Whether a further page exists. Distinct from `items.length === limit`. */
  hasMore: boolean
}

export class PaginationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PaginationError"
  }
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
}

/**
 * Decode a cursor and prove it belongs here.
 *
 * Refuses rather than falling back to the first page. A malformed cursor
 * silently restarting a listing looks like data to whoever is reading it, and
 * a caller paging through 10,000 rows would loop forever without noticing.
 */
export function decodeCursor(
  raw: string,
  expected: { tenantId: string; sort: string },
): Cursor {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
  } catch {
    throw new PaginationError("The cursor is not readable. Start the listing again without one.")
  }

  if (!parsed || typeof parsed !== "object") {
    throw new PaginationError("The cursor is not readable. Start the listing again without one.")
  }

  const c = parsed as Record<string, unknown>
  for (const field of ["tenantId", "sort", "after", "afterId"] as const) {
    if (typeof c[field] !== "string" || c[field] === "") {
      throw new PaginationError(`The cursor is missing ${field}.`)
    }
  }

  if (c.tenantId !== expected.tenantId) {
    // Deliberately does not say which tenant it was for. That would turn a
    // refusal into a way of learning that another tenant exists.
    throw new PaginationError("That cursor was not issued for this tenant.")
  }

  if (c.sort !== expected.sort) {
    throw new PaginationError(
      `That cursor was issued for a different ordering. A position in one sort is meaningless ` +
        `in another, and using it would silently return the wrong window.`,
    )
  }

  return c as unknown as Cursor
}

/**
 * Turn a query result into a page.
 *
 * Takes `limit + 1` rows from the caller and uses the extra one to answer
 * `hasMore` without a second `count(*)`. `items.length === limit` cannot answer
 * it: a final page that happens to be exactly full is indistinguishable from
 * one with more behind it, and the caller then makes one pointless request that
 * returns nothing — or, worse, stops early because it guessed the other way.
 */
export function toPage<T>(
  rows: readonly T[],
  options: {
    limit: number
    tenantId: string
    sort: string
    key: (row: T) => { value: string; id: string }
  },
): Page<T> {
  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new PaginationError("limit must be a positive integer")
  }
  if (options.limit > MAX_PAGE) {
    throw new PaginationError(`limit must not exceed ${MAX_PAGE}`)
  }

  const hasMore = rows.length > options.limit
  const items = hasMore ? rows.slice(0, options.limit) : [...rows]

  const last = items[items.length - 1]
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          tenantId: options.tenantId,
          sort: options.sort,
          ...(({ value, id }) => ({ after: value, afterId: id }))(options.key(last)),
        })
      : null

  return { items, nextCursor, hasMore }
}

/**
 * A sort is a whitelist, not a passthrough.
 *
 * The field arrives from a query string and reaches an ORDER BY. Allowing an
 * arbitrary one lets a caller sort by a column they cannot read, which orders
 * rows by a value they then infer from the ordering.
 */
export function parseSort(raw: string | null, allowed: readonly string[], fallback: string): string {
  if (!raw) return fallback

  const [field, direction = "asc"] = raw.split(":")
  if (!allowed.includes(field)) {
    throw new PaginationError(`Cannot sort by "${field}". Allowed: ${allowed.join(", ")}.`)
  }
  if (direction !== "asc" && direction !== "desc") {
    throw new PaginationError(`Sort direction must be asc or desc.`)
  }

  return `${field}:${direction}`
}

/** Re-exported so callers do not have to know which package the cap lives in. */
export { MAX_PAGE, ContractViolation }
