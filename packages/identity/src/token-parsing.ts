import type { ParsedToken, TokenClaims, TokenHeader } from "./token-validation"

/**
 * GE-044-003 — turning attacker-controlled bytes into structured data, safely.
 *
 * `validateIdToken` takes a `ParsedToken`, which means somebody has to parse
 * one, and until now that somebody was the caller. A callback route doing
 * `JSON.parse(Buffer.from(segment, "base64"))` throws on a malformed token, and
 * an unhandled throw is a 500 — which is not "denying safely", it is denying
 * loudly and telling the caller their input reached the parser.
 *
 * This is the boundary where bytes an attacker chose first become objects the
 * rest of the system reads. It has exactly one job: never throw, and never
 * return something that only looks parsed.
 *
 * ## Everything is refused before it is spent
 *
 * The size check runs before base64, base64 before JSON, JSON before any field
 * is read. That ordering is the point: a ten-megabyte "token" costs nothing here
 * because it is refused on length, and a segment that is not base64 never
 * becomes a string somebody parses.
 */

export type ParseRefusal =
  | "TOO_LARGE"
  | "WRONG_SEGMENT_COUNT"
  | "ENCRYPTED_TOKEN"
  | "NOT_BASE64URL"
  | "NOT_JSON"
  | "NOT_AN_OBJECT"
  | "NO_ALGORITHM"

export interface ParseRejected {
  ok: false
  reason: ParseRefusal
  /** For the audit record. GE-042-007 decides what a person is told. */
  detail: string
}

export interface ParseAccepted {
  ok: true
  parsed: ParsedToken
}

export type ParseOutcome = ParseAccepted | ParseRejected

/**
 * The largest token worth looking at.
 *
 * Real ID tokens are one to four kilobytes; a token with a lot of group claims
 * might reach eight. Sixteen is generous. The number matters less than the
 * check existing: without it, the cost of a request is chosen by whoever sent
 * it, and base64-decoding a hundred megabytes is a denial of service that costs
 * the sender nothing.
 */
export const MAX_TOKEN_BYTES = 16 * 1024

/** Strict base64url: no padding, no `+` or `/`, nothing outside the alphabet. */
const BASE64URL = /^[A-Za-z0-9_-]+$/

function reject(reason: ParseRefusal, detail: string): ParseRejected {
  return { ok: false, reason, detail }
}

/**
 * Decode one segment, or refuse.
 *
 * Node's base64 decoder is lenient — it ignores characters outside the alphabet
 * rather than failing — so a segment containing `!` decodes to *something*, and
 * that something is not what the signer signed. The pattern is checked first
 * because the decoder will not do it.
 */
function decodeSegment(segment: string): string | null {
  if (!BASE64URL.test(segment)) return null
  try {
    return Buffer.from(segment, "base64url").toString("utf8")
  } catch {
    return null
  }
}

/**
 * Parse a compact JWS.
 *
 * Returns a verdict for every input. There is no path out of this function that
 * throws, which is the property the callback route depends on: a request with a
 * garbage token must produce a refusal, not a stack trace.
 */
export function parseCompactToken(token: unknown): ParseOutcome {
  if (typeof token !== "string" || token.length === 0) {
    return reject("WRONG_SEGMENT_COUNT", "No token was supplied.")
  }

  // Length before anything else. Byte length, not character count: a token of
  // multi-byte characters is bigger than it looks.
  const bytes = Buffer.byteLength(token, "utf8")
  if (bytes > MAX_TOKEN_BYTES) {
    return reject(
      "TOO_LARGE",
      `This token is ${bytes} bytes and the limit is ${MAX_TOKEN_BYTES}. Decoding it would let the sender choose what a request costs us.`,
    )
  }

  const segments = token.split(".")

  // Five segments is JWE — a *valid* thing that is not a signed token, and
  // accepting it would mean treating an encrypted payload we cannot read as an
  // identity. Named separately because "wrong segment count" would send
  // somebody looking for a typo.
  if (segments.length === 5) {
    return reject(
      "ENCRYPTED_TOKEN",
      "This is a JWE. An encrypted token is not a signed one, and nothing here can read it or verify who produced it.",
    )
  }

  if (segments.length !== 3) {
    return reject(
      "WRONG_SEGMENT_COUNT",
      `A compact JWS has three segments and this has ${segments.length}.`,
    )
  }

  const [rawHeader, rawClaims, rawSignature] = segments

  // The signature is not decoded here — verification owns that — but an empty
  // one is refused now. `alg: none` tokens are exactly this shape, and refusing
  // at the parse boundary means the unsigned token never becomes an object that
  // some later branch might read.
  if (rawSignature.length === 0) {
    return reject(
      "WRONG_SEGMENT_COUNT",
      "The signature segment is empty. An unsigned token is not a token with a problem, it is not a token.",
    )
  }

  const headerText = decodeSegment(rawHeader)
  if (headerText === null) {
    return reject("NOT_BASE64URL", "The header is not base64url. Node's decoder ignores stray characters, so a lenient parse here would read something the signer never signed.")
  }

  const claimsText = decodeSegment(rawClaims)
  if (claimsText === null) {
    return reject("NOT_BASE64URL", "The payload is not base64url.")
  }

  if (!BASE64URL.test(rawSignature)) {
    return reject("NOT_BASE64URL", "The signature is not base64url.")
  }

  let header: unknown
  let claims: unknown
  try {
    header = JSON.parse(headerText)
  } catch {
    return reject("NOT_JSON", "The header is not JSON.")
  }
  try {
    claims = JSON.parse(claimsText)
  } catch {
    return reject("NOT_JSON", "The payload is not JSON.")
  }

  // `JSON.parse("[]")` and `JSON.parse("null")` both succeed, and both would
  // give the validator something it reads properties off without error — every
  // claim `undefined`, every check quietly passing the ones that only reject on
  // a *wrong* value.
  if (!isPlainObject(header)) {
    return reject("NOT_AN_OBJECT", "The header decoded to something that is not an object.")
  }
  if (!isPlainObject(claims)) {
    return reject("NOT_AN_OBJECT", "The payload decoded to something that is not an object.")
  }

  // A token with no algorithm is refused rather than defaulted. Whatever the
  // default would be, it is a decision made on behalf of a token that declined
  // to state one.
  if (typeof header.alg !== "string" || header.alg.length === 0) {
    return reject(
      "NO_ALGORITHM",
      "The header declares no algorithm. Assuming one would be choosing on behalf of a token that declined to say.",
    )
  }

  return {
    ok: true,
    parsed: {
      header: header as unknown as TokenHeader,
      claims: claims as unknown as TokenClaims,
    },
  }
}

/**
 * A JSON object, not an array and not null.
 *
 * `typeof null === "object"` and `typeof [] === "object"`, so the obvious check
 * admits both — and both would reach the validator as something whose every
 * claim reads `undefined`.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
