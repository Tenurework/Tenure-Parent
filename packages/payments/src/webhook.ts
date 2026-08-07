import { createHmac, timingSafeEqual } from "node:crypto"

import type { ProviderMode } from "./external-reference"

/**
 * PAY-140-008 — the five ways an inbound provider event goes wrong.
 *
 * There was no provider webhook endpoint at all, so forged signatures, rotated
 * secrets, duplicates, reordering and stale schemas were not "untested" — they
 * were unreachable, which reads identically in a coverage report and is worse.
 * Bible §16 names each of them:
 *
 *   * Verify signatures against the exact endpoint secret and the RAW body.
 *   * Apply a replay window and event-id deduplication.
 *   * Handle duplicates, reordering, delay and missing events.
 *
 * Three design decisions here are load-bearing:
 *
 *   1. **The raw body, as a string, never a parsed object.** Re-serialising
 *      JSON changes key order and whitespace, so the HMAC computed over a
 *      round-tripped body is a different HMAC and every real event fails —
 *      which is usually "fixed" by disabling verification.
 *   2. **An ARRAY of secrets.** Rotation with overlap (Bible §16: "Rotate with
 *      overlap, verification and rollback") means two secrets are valid at
 *      once. A single-secret verifier makes every rotation an outage, so
 *      rotations get skipped.
 *   3. **A timestamp tolerance.** Without it a signature stays valid forever
 *      and a captured event can be replayed a year later, correctly signed.
 *
 * Pure: takes the clock as an argument, holds no state, opens no connection.
 */

/** How far an event's timestamp may be from now. Provider convention is 5 min. */
export const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000

export type SignatureFailure =
  | "signature-header-malformed"
  | "signature-timestamp-missing"
  | "signature-no-candidates"
  | "signature-timestamp-outside-tolerance"
  | "signature-mismatch"

export type SignatureResult =
  | { ok: true; timestampMs: number; matchedSecretIndex: number }
  | { ok: false; code: SignatureFailure; reason: string }

/**
 * Constant-time equality over two hex digests.
 *
 * `timingSafeEqual` THROWS when the buffers differ in length, and a forged
 * signature of the wrong length is the common case — so the length is checked
 * first and a mismatch is a refusal, not an exception. Calling it unguarded
 * turns a routine forgery into a 500 and, worse, into a stack trace in the
 * logs; `webhook.test.ts` pins that.
 */
function digestsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex")
  const right = Buffer.from(b, "hex")
  if (left.length === 0 || left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/** `t=<unix seconds>,v1=<hex>` — possibly several `v1` during a rotation. */
function parseHeader(header: string): { timestamp: string | null; signatures: string[] } {
  let timestamp: string | null = null
  const signatures: string[] = []
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2)
    if (value === undefined) continue
    if (key.trim() === "t") timestamp = value.trim()
    else if (key.trim() === "v1") signatures.push(value.trim())
  }
  return { timestamp, signatures }
}

/**
 * Verify one inbound event's signature.
 *
 * @param rawBody the exact bytes received, as text. Never a re-serialised object.
 * @param header  the provider's signature header.
 * @param secrets every endpoint secret currently valid — two during a rotation.
 * @param nowMs   the clock, injected so the tolerance is testable.
 */
export function verifySignature(
  rawBody: string,
  header: string,
  secrets: readonly string[],
  nowMs: number,
  toleranceMs: number = DEFAULT_TOLERANCE_MS,
): SignatureResult {
  const { timestamp, signatures } = parseHeader(header)

  if (timestamp === null) {
    return {
      ok: false,
      code: "signature-timestamp-missing",
      reason: "The signature header carries no `t=` timestamp, so no replay window can be applied.",
    }
  }
  if (signatures.length === 0) {
    return {
      ok: false,
      code: "signature-header-malformed",
      reason: "The signature header carries no `v1=` signature.",
    }
  }

  const seconds = Number(timestamp)
  if (!Number.isFinite(seconds)) {
    return {
      ok: false,
      code: "signature-header-malformed",
      reason: `Timestamp "${timestamp}" is not a number of seconds.`,
    }
  }
  const timestampMs = seconds * 1000

  if (secrets.length === 0) {
    return {
      ok: false,
      code: "signature-no-candidates",
      reason:
        "No endpoint secret was supplied. Verifying against nothing is not verification; the " +
        "endpoint refuses rather than accepting every event.",
    }
  }

  if (Math.abs(nowMs - timestampMs) > toleranceMs) {
    return {
      ok: false,
      code: "signature-timestamp-outside-tolerance",
      reason:
        `Event timestamp is ${Math.round((nowMs - timestampMs) / 1000)}s from now and the ` +
        `tolerance is ${Math.round(toleranceMs / 1000)}s. A correctly signed event replayed ` +
        `outside the window is still a replay.`,
    }
  }

  const payload = `${timestamp}.${rawBody}`
  for (let index = 0; index < secrets.length; index++) {
    const expected = createHmac("sha256", secrets[index]).update(payload, "utf8").digest("hex")
    for (const candidate of signatures) {
      if (digestsEqual(expected, candidate)) {
        return { ok: true, timestampMs, matchedSecretIndex: index }
      }
    }
  }

  return {
    ok: false,
    code: "signature-mismatch",
    reason:
      `No supplied secret (${secrets.length} candidate${secrets.length === 1 ? "" : "s"}) produces ` +
      `this signature over the raw body. The event is forged, the body was re-serialised, or the ` +
      `rotation window has already closed.`,
  }
}

/* --------------------------------------------------------------- dedupe */

/**
 * The identity of one received event.
 *
 * Four parts, and dropping any one of them merges events that are not the same:
 * `evt_1` in test and in live are different objects, and the same id under two
 * connected accounts is two events.
 */
export interface ProviderEventKey {
  provider: string
  mode: ProviderMode
  /** The connected account the event is about, or the platform account. */
  accountId: string
  eventId: string
}

export interface ReceivedEvent extends ProviderEventKey {
  /**
   * Monotonic per (provider, mode, accountId), from the provider's ordering
   * signal. Reordering is normal at the transport layer; what is not normal is
   * applying an older state on top of a newer one.
   */
  sequence: number
}

export type DedupeVerdict = "new" | "duplicate" | "out-of-order"

function sameStream(a: ProviderEventKey, b: ProviderEventKey): boolean {
  return a.provider === b.provider && a.mode === b.mode && a.accountId === b.accountId
}

/**
 * Has this event been seen, and does it arrive in order?
 *
 * `duplicate` wins over `out-of-order`: a redelivered event is BOTH (its
 * sequence is behind the newest one), and reporting it as out-of-order would
 * send an ordinary provider retry to the exception queue.
 *
 * `seen` is the persisted `(provider, mode, accountId, eventId, sequence)` rows.
 */
export function dedupe(event: ReceivedEvent, seen: readonly ReceivedEvent[]): DedupeVerdict {
  for (const row of seen) {
    if (sameStream(row, event) && row.eventId === event.eventId) return "duplicate"
  }

  let highest: number | null = null
  for (const row of seen) {
    if (!sameStream(row, event)) continue
    if (highest === null || row.sequence > highest) highest = row.sequence
  }

  if (highest !== null && event.sequence <= highest) return "out-of-order"
  return "new"
}
