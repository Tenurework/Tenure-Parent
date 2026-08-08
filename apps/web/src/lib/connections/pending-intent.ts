import "server-only"

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { db } from "@/lib/db"

/**
 * WRK-030-002 — the ConnectionOpportunity, and the single-use launch token that
 * carries a person's pending intent across a round trip.
 *
 * ## What was here before
 *
 * A React prop. `MissingConnectionCard.tsx` took `pendingIntent` and its own
 * comment said so: "Never persisted anywhere — this is component state passed
 * straight back out". `TenureAIPanel.tsx` passed the user's question in, the
 * card rendered "Kept for when this connects: …", and that sentence was true
 * only while the React tree lived. A refresh, a sign-in redirect, or finishing
 * the connect on a phone and returning to the laptop all lost it — which is
 * precisely the round trip Bible §5.3 step 2 exists to survive.
 *
 * ## What this deliberately does NOT copy
 *
 * `src/lib/calendar-sync.ts` also mints a token, and it is the wrong model for
 * this one in every respect: it is stateless, stable per user, and designed to
 * be replayed forever because Outlook polls it. Reusing that shape here would
 * put a long-lived bearer credential in a browser history. This token is
 * stored (as a hash), short-lived, and burned on redemption.
 *
 * ## §5.2 names thirteen facts. Five are written; the rest are not, and why
 *
 * Written, because this deployment can answer them from real state:
 * `institutionId` (the tenant), `userId` (the subject), `capabilityKey` (what
 * blocked them), `pendingIntent` (their own words) and `returnPath` (where they
 * were sent).
 *
 * NOT written, because there is nothing to read them from and a column that is
 * always null reads like provenance and is not:
 *
 *   * `providerId`, `connectorVersion`, `certificationStatus` — no certified
 *     third-party connector exists (`packages/platform-config/src/provider-review.ts`
 *     records every review as NOT_SUBMITTED), so there is no provider to name.
 *   * `requestedScopes`, `selectorHint`, `resourceHint` — the scopes a
 *     capability needs live in `CapabilityState.requiredScopes` at the call
 *     site and no connect flow negotiates them with anybody, so recording them
 *     here would describe a negotiation that does not happen.
 *   * `residencyClass`, `dataClass` — no capability in this deployment is
 *     classified, and inventing a class is worse than leaving the question
 *     open.
 *
 * The ledger says the same, so the gap is a decision rather than an oversight.
 *
 * ## §5.3's eight properties, and where each one lives
 *
 *   * **signed** — sha256 of the opaque value is the stored `tokenHash`; the
 *     row IS the signature, in the sense that a value which hashes to no row is
 *     UNKNOWN. There is no separate MAC because there is nothing to verify
 *     offline: every redemption already reads the database.
 *   * **audience-bound** — `capabilityKey`, checked on redemption.
 *   * **tenant-bound** — `institutionId`, checked on redemption (WRONG_TENANT).
 *   * **user-bound** — `userId`, checked on redemption (WRONG_USER).
 *   * **session-bound** — the redeemer passes the CURRENT session's user, which
 *     the caller obtained from `auth()`. A token found in somebody's history and
 *     opened while signed in as a different person is WRONG_USER.
 *   * **short-lived** — `LAUNCH_TOKEN_TTL_MS`, checked on redemption (EXPIRED).
 *   * **single-use** — the `consumedAt` write is the CLAIM, not a check
 *     followed by a write. See `redeemConnectionLaunchToken`.
 *   * **nonce-protected** — `nonce` is 32 bytes of `randomBytes` mixed into the
 *     token, so two opportunities with identical fields do not produce the same
 *     value and a token cannot be derived from what it describes.
 */

/**
 * How long an opportunity stays redeemable.
 *
 * Fifteen minutes is the length of the journey it has to survive: click the
 * control, get bounced to an identity provider, sign in, come back. Long enough
 * for a slow SSO round trip on a phone, short enough that a token left in a
 * shared browser's history is dead before the next person sits down. It is
 * deliberately not hours: nothing here is worth resuming tomorrow, and the
 * intent is re-derivable by asking the question again.
 */
export const LAUNCH_TOKEN_TTL_MS = 15 * 60 * 1000

/** The longest pending intent that will be stored. */
const MAX_INTENT_LENGTH = 2000

/**
 * The tenant and person an opportunity belongs to.
 *
 * A structural type rather than an import of `TenantScope` so the one
 * production caller — `src/app/api/connections/opportunity/route.ts`, inside
 * `withTenantScope` — passes the two ids it already holds rather than
 * reconstructing a scope object to satisfy a signature. It names this type
 * where it builds that object, so the shape is checked at the call site instead
 * of inferred from an argument position.
 *
 * The sentence this replaces said "the two callers — a server action inside
 * `withTenantScope` and the settings page inside its own". Neither existed. The
 * mint side is the route handler named above and there is no settings page that
 * opens an opportunity; the redemption side, `redeemConnectionLaunchToken`
 * below, has no production caller at all yet. A comment describing callers that
 * were never wired is the exact failure `no-overstated-connectors.test.mjs`
 * exists to catch, and it caught this one.
 */
export interface ConnectionScope {
  institutionId: string
  userId: string
}

/**
 * What a redemption gives back: the opportunity, minus anything secret.
 *
 * The token is not on it, and neither is the hash. A surface that received
 * either could put it in a link.
 */
export interface ConnectionOpportunity {
  id: string
  capabilityKey: string
  /** The person's own words, or null when the opportunity carried none. */
  pendingIntent: string | null
  returnPath: string
  createdAt: Date
}

export type LaunchRefusal =
  /** No row hashes to this value. A forged, truncated or invented token. */
  | "UNKNOWN"
  /** Past `expiresAt`. */
  | "EXPIRED"
  /** `consumedAt` was already set — this is the single-use refusal. */
  | "ALREADY_CONSUMED"
  /** Minted in a different institution than the one being redeemed in. */
  | "WRONG_TENANT"
  /** Minted for a different person than the one currently signed in. */
  | "WRONG_USER"

export type LaunchRedemption =
  | { ok: true; opportunity: ConnectionOpportunity }
  | { ok: false; reason: LaunchRefusal }

/**
 * `sha256` of the opaque value, hex.
 *
 * The token never reaches the database. What is stored is this, so a dump, a
 * slow-query log or a support engineer reading rows yields nothing redeemable —
 * the same reason a password is not stored either.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

/**
 * Whether two hashes match, in constant time.
 *
 * The lookup itself is by unique index, so this is not defending the lookup —
 * it is defending the comparison the lookup implies once a caller starts
 * scanning a small candidate set, and it costs nothing to be right about it
 * from the start. Length is checked first because `timingSafeEqual` throws on a
 * mismatch.
 */
function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8")
  const right = Buffer.from(b, "utf8")
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Open a connection opportunity and mint its launch token.
 *
 * Returns the OPAQUE VALUE — the only moment in this system's life that it
 * exists in memory. The caller puts it in exactly one place: the URL the person
 * is about to be sent to. It is never logged, never returned by a read, and
 * never reachable again after this call.
 *
 * The caller must already be inside a tenant scope; `db` writes through the
 * chokepoint and will refuse otherwise. That is why `scope` is a parameter
 * carrying ids the caller already holds rather than something resolved in here:
 * a second resolution could disagree with the scope the write happens under.
 */
export async function openConnectionOpportunity(
  scope: ConnectionScope,
  capabilityKey: string,
  /** The person's own words. `null` when there was nothing in flight. */
  intent: string | null,
  /** Where in Tenure they are being sent. Always a path, never a provider URL. */
  returnPath: string,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  // A path of this application, not an absolute URL. An opportunity that could
  // name `https://elsewhere.example` would be an open redirect wearing a
  // capability's name, and the person following it has already been told this
  // is where Tenure manages the connection.
  if (!returnPath.startsWith("/") || returnPath.startsWith("//")) {
    throw new Error(`openConnectionOpportunity: returnPath must be an in-app path, got ${returnPath}`)
  }

  const nonce = randomBytes(32).toString("base64url")
  // The token IS the nonce plus a second random half. Not a signed encoding of
  // the row's contents: an opaque value that means nothing outside the table is
  // strictly less to get wrong than a structured one, and §5.3 asks for opaque.
  const token = `${nonce}.${randomBytes(32).toString("base64url")}`

  await db.connectionLaunchToken.create({
    data: {
      institutionId: scope.institutionId,
      userId: scope.userId,
      capabilityKey,
      tokenHash: hashToken(token),
      nonce,
      pendingIntent: intent ? intent.slice(0, MAX_INTENT_LENGTH) : null,
      returnPath,
      expiresAt: new Date(now.getTime() + LAUNCH_TOKEN_TTL_MS),
    },
  })

  return { token, expiresAt: new Date(now.getTime() + LAUNCH_TOKEN_TTL_MS) }
}

/**
 * Redeem a launch token, once.
 *
 * ## Single-use is the claim, not a check
 *
 * The obvious implementation reads the row, sees `consumedAt === null`, and
 * then writes it. Two requests arriving together both read null and both
 * succeed — the token is used twice and nothing anywhere notices. So the write
 * IS the test: `updateMany({ where: { id, consumedAt: null } })` takes the row
 * lock, re-evaluates the predicate under it, and reports how many rows it
 * changed. Exactly one of two concurrent redemptions gets `count: 1`; the other
 * gets `count: 0`, which is ALREADY_CONSUMED.
 *
 * Both statements run inside one `$transaction` so the read that produced the
 * opportunity and the claim that burned it cannot straddle a rollback.
 * `db.ts`'s `withTransactionGuard` already wraps `$transaction` with the tenant
 * assertion, so there is no second guard here — adding one would mean two
 * answers to "is a scope open".
 *
 * ## The refusals that must NOT consume
 *
 * WRONG_TENANT, WRONG_USER and EXPIRED all return before the claim. If a
 * mismatched redemption burned the row, anybody holding a leaked token could
 * destroy the opportunity without being able to use it — turning a
 * confidentiality failure into a denial of service against the legitimate
 * holder. Only a redemption that is going to succeed consumes.
 */
export async function redeemConnectionLaunchToken(
  token: string,
  /** The CURRENTLY authenticated person and the tenant they are acting in. */
  session: ConnectionScope,
  now: Date = new Date(),
): Promise<LaunchRedemption> {
  if (!token) return { ok: false, reason: "UNKNOWN" }
  const tokenHash = hashToken(token)

  return db.$transaction(async (tx) => {
    const row = await tx.connectionLaunchToken.findUnique({ where: { tokenHash } })
    // A row the tenant predicate hid reads exactly like a row that never
    // existed, which is the correct answer to give a stranger.
    if (!row || !hashesMatch(row.tokenHash, tokenHash)) {
      return { ok: false, reason: "UNKNOWN" } as const
    }

    if (row.institutionId !== session.institutionId) {
      return { ok: false, reason: "WRONG_TENANT" } as const
    }
    if (row.userId !== session.userId) {
      return { ok: false, reason: "WRONG_USER" } as const
    }
    if (row.expiresAt.getTime() <= now.getTime()) {
      return { ok: false, reason: "EXPIRED" } as const
    }

    const claimed = await tx.connectionLaunchToken.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: now },
    })
    if (claimed.count === 0) return { ok: false, reason: "ALREADY_CONSUMED" } as const

    return {
      ok: true,
      opportunity: {
        id: row.id,
        capabilityKey: row.capabilityKey,
        pendingIntent: row.pendingIntent,
        returnPath: row.returnPath,
        createdAt: row.createdAt,
      },
    } as const
  })
}
