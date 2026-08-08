import "server-only"

import { createCipheriv, createDecipheriv, createHash, createHmac } from "node:crypto"

import {
  CONTROL_PLANE_SCHEMA_VERSIONS,
  MAX_PAGE,
  parseApiEnvelope,
  type ApiEnvelope,
} from "@tenure/contracts"

/**
 * STUDIO-130-002 — the read envelope every control-plane endpoint returns.
 *
 * Built on `@tenure/contracts` rather than beside it: `correlationId` is
 * already a field on four envelope types there (`TenantContext`,
 * `DomainEvent`, `ContractError`, `AuditEntry`) and `MAX_PAGE` is already the
 * platform's page ceiling. A second envelope invented here would be a second
 * spelling of the same ideas, and two spellings is how a poller written against
 * one silently mis-parses the other.
 *
 * ## The cursor is opaque because it is ENCRYPTED, not because it is base64
 *
 * A base64 of the DynamoDB `LastEvaluatedKey` is not opaque. It is one
 * `atob` from a table key, and a client that learns to decode it learns the
 * partition layout, can forge a scan position into another partition, and will
 * eventually be broken by a schema change it had no right to depend on.
 *
 * So the cursor is AES-256-GCM over the JSON, keyed from `AUTH_SECRET`. A
 * client cannot read it, cannot construct one, and a tampered cursor fails the
 * authentication tag rather than scanning from somewhere unintended. This is
 * cheap — one cipher per page — and it is the difference between "opaque" as a
 * claim and "opaque" as a property.
 */

/** The read budget for one page, capped by the platform's own ceiling. */
export const DEFAULT_PAGE = 25

/**
 * STUDIO-030-011 — how many rows a server-rendered surface may put on one page.
 *
 * Named per surface rather than as one global number, because the surfaces are
 * not alike: an estate inventory row is five cells an operator scans, and a
 * ledger row is an id and a sentence. One number would be wrong for one of them
 * and nobody would know which.
 *
 * These are budgets in the literal sense — `layout.spec.ts` asserts a DOM node
 * ceiling per route, and a table that stops honouring its budget breaks that
 * assertion rather than merely getting slower. Server-side paging rather than a
 * windowing library: it needs no new dependency and keeps the page a server
 * component, which is what makes the row count a property of the RESPONSE
 * rather than of what a browser happened to render.
 */
export const INVENTORY_PAGE_ROWS = 25
export const LEDGER_PAGE_ROWS = 40

/**
 * "Showing N of M", said the same way everywhere.
 *
 * A truncated table that does not say so is a table that reads as complete, and
 * an operator who counts twenty-five tenants on a page listing a fleet of two
 * hundred has been told something false by omission.
 */
export function showingOf(shown: number, total: number, noun: string): string {
  return shown >= total
    ? `${total} ${noun}`
    : `showing ${shown} of ${total} ${noun} — the rest are on the next page`
}

export function pageSize(raw: string | null): number {
  if (raw === null || raw.trim() === "") return DEFAULT_PAGE
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) return DEFAULT_PAGE
  return Math.min(n, MAX_PAGE)
}

export class CursorUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CursorUnavailable"
  }
}

export class CursorRejected extends Error {
  constructor() {
    // Never says what was wrong with it. A cursor is server-minted; a caller
    // holding one this process will not accept has either kept it past a key
    // rotation or written it themselves, and neither deserves a hint.
    super("This cursor was not issued by this control plane.")
    this.name = "CursorRejected"
  }
}

function cursorKey(): Buffer {
  const secret = process.env.AUTH_SECRET?.trim()
  if (!secret) {
    throw new CursorUnavailable(
      "AUTH_SECRET is not set, so a page cursor cannot be sealed. Pagination is refused rather " +
        "than falling back to a readable cursor — a cursor a client can decode is a scan position " +
        "a client can forge.",
    )
  }
  return createHash("sha256").update(`tenure-studio-cursor:${secret}`).digest()
}

/**
 * The nonce for a position, derived from the position itself.
 *
 * Deliberately not `randomBytes`, and this is the one decision in the file that
 * needs its reasoning written down.
 *
 * A random nonce made the sealed token different on every call, so
 * `GET /api/aws/fleet?limit=2` returned a different `nextCursor` each time it
 * was asked — for the same page, at the same offset, over unchanged data. That
 * is not merely untidy: `nextCursor` is part of the body and therefore part of
 * the ETag (`etagFor`), so a surface with a next page could never answer
 * `If-None-Match` with a 304. The conditional-request mechanism was unreachable
 * on exactly the surfaces that have enough rows to need it.
 *
 * So the nonce is an HMAC of the plaintext, under a key derived separately from
 * the one that encrypts it. This is the construction AES-GCM-SIV exists for, and
 * it is safe in the way that matters here: GCM's catastrophic failure is
 * reusing one nonce across DIFFERENT plaintexts under the same key, and a nonce
 * that is a function of the plaintext cannot do that — equal plaintexts get the
 * same nonce, and different plaintexts get different ones.
 *
 * What is given up is that two identical positions now seal to identical bytes,
 * so a holder can tell that two cursors point at the same place. That is not a
 * secret: the holder is the one paging, and it already knows where it is. What
 * the cursor has to withhold — the table key inside it, and the ability to mint
 * one for a position nobody issued — is unchanged, because those rest on the key
 * and the authentication tag, not on the nonce being unpredictable.
 */
function cursorNonce(plaintext: string): Buffer {
  const secret = process.env.AUTH_SECRET?.trim()
  if (!secret) {
    throw new CursorUnavailable(
      "AUTH_SECRET is not set, so a page cursor cannot be sealed. Pagination is refused rather " +
        "than falling back to a readable cursor — a cursor a client can decode is a scan position " +
        "a client can forge.",
    )
  }
  // A separate key from `cursorKey()`. Deriving the nonce and the encryption key
  // from the same bytes would tie two independent uses of one secret together
  // for no reason; domain separation costs one string.
  return createHmac("sha256", createHash("sha256").update(`tenure-studio-cursor-nonce:${secret}`).digest())
    .update(plaintext)
    .digest()
    .subarray(0, 12)
}

/** Seal a continuation position into a token a caller can hold and cannot read. */
export function encodeCursor(position: unknown): string {
  const plaintext = JSON.stringify(position)
  const iv = cursorNonce(plaintext)
  const cipher = createCipheriv("aes-256-gcm", cursorKey(), iv)
  const sealed = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString("base64url")
}

export function decodeCursor<T>(token: string): T {
  let raw: Buffer
  try {
    raw = Buffer.from(token, "base64url")
  } catch {
    throw new CursorRejected()
  }
  if (raw.length < 29) throw new CursorRejected()

  try {
    const decipher = createDecipheriv("aes-256-gcm", cursorKey(), raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()])
    return JSON.parse(plain.toString("utf8")) as T
  } catch (err) {
    if (err instanceof CursorUnavailable) throw err
    throw new CursorRejected()
  }
}

/**
 * STUDIO-130-001 — the envelope is `@tenure/contracts`' `ApiEnvelope`, not a
 * second declaration of the same fields.
 *
 * It used to be an interface declared here, which is exactly what the contracts
 * package's header says constrains nothing: erased at build time, on a shape
 * that crosses a process boundary on every request. Aliasing rather than
 * redeclaring means there is one definition, one version, and one published
 * JSON Schema (`docs/contracts/api-envelope.schema.json`) for a client in
 * another language to validate against.
 */
export type Envelope<T> = ApiEnvelope<T>

/**
 * Build the envelope, stamped with the version this build implements — and
 * PARSED, so a malformed one is refused here rather than served.
 *
 * The parse is not ceremony. `asOf` arrives from four different places in the
 * route (a report's own timestamp, a fresh ISO string, a cost source), and an
 * endpoint that shipped an unparseable date or an absent correlation id would
 * look completely normal to every test that reads `items`. This is the one
 * funnel every 2xx body goes through, so it is the one place that can refuse.
 *
 * `schemaVersion` is stamped INSIDE this function rather than passed in: a
 * caller able to choose the version is a caller able to lie about it.
 */
export function envelope<T>(input: {
  items: readonly T[]
  nextCursor: string | null
  asOf: string
  correlationId: string
}): Envelope<T> {
  return parseApiEnvelope<T>({
    schemaVersion: CONTROL_PLANE_SCHEMA_VERSIONS.ApiEnvelope,
    items: input.items,
    nextCursor: input.nextCursor,
    asOf: input.asOf,
    correlationId: input.correlationId,
  })
}

/**
 * A strong ETag over the response body.
 *
 * The read surfaces are polled. Re-shipping an unchanged service list every few
 * seconds is the throttling the brief warns about, and a 304 is the difference
 * between a poller that costs a byte and one that costs a page.
 *
 * Computed over the body WITHOUT the correlation id, which changes per request
 * — including it would make every ETag unique and the whole mechanism a no-op
 * that looks implemented. That is the exact bug this comment exists to prevent.
 */
export function etagFor(body: { items: unknown; nextCursor: string | null; asOf: string }): string {
  const canonical = JSON.stringify({
    // The contract version participates, because it is part of the body. A
    // client holding an ETag from before a version bump would otherwise get a
    // 304 and go on reading the old shape from its cache — the one case where
    // "nothing changed" is false in the only way that matters.
    schemaVersion: CONTROL_PLANE_SCHEMA_VERSIONS.ApiEnvelope,
    items: body.items,
    nextCursor: body.nextCursor,
    asOf: body.asOf,
  })
  return `"${createHash("sha256").update(canonical).digest("hex")}"`
}

/** Whether an `If-None-Match` header matches. Handles the comma-separated form. */
export function matchesEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false
  if (ifNoneMatch.trim() === "*") return true
  return ifNoneMatch
    .split(",")
    .map((v) => v.trim())
    .some((v) => v === etag || v === `W/${etag}`)
}

/** A request id. Regenerated per request; `id()` in contracts accepts this shape. */
export function newCorrelationId(): string {
  return `req-${globalThis.crypto.randomUUID().replace(/-/g, "")}`
}
