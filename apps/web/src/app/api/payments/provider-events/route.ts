import {
  PROVIDER,
  PROVIDER_API_VERSION,
  PROVIDER_MODES,
  checkEventApiVersion,
  dedupe,
  parseProviderEvent,
  verifySignature,
  type ProviderMode,
  type ReceivedEvent,
} from "@tenure/payments"
import { compareVersionStrings } from "@tenure/platform-config/compatibility"

import { db } from "@/lib/db"

/**
 * PAY-140-008 / PAY-140-002 — the provider event inbox. Read-only by design.
 *
 * This route RECORDS an event and does nothing else. Bible §4 is explicit that
 * "Provider webhooks are evidence, not automatically authoritative business
 * permission", and §16 asks for a minimized immutable receipt persisted BEFORE
 * any asynchronous processing. Applying a business transition here would make
 * an unauthenticated inbound request the thing that moves Tenure's state, which
 * is the failure the verification below exists to prevent — so the processing
 * half is deliberately absent rather than stubbed.
 *
 * The order of the checks is the design:
 *
 *   1. **Raw body first.** `request.text()` before anything parses it. A body
 *      round-tripped through `JSON.parse`/`stringify` produces a different HMAC
 *      — different key order, different whitespace — so every real event would
 *      fail and somebody would "fix" it by disabling verification.
 *   2. **Signature, against an ARRAY of secrets.** Two are valid during a
 *      rotation (Bible §16: "Rotate with overlap"). A single-secret verifier
 *      makes every rotation an outage, which is why rotations get skipped.
 *   3. **API version.** An event declaring a version other than the pinned one
 *      carries a schema nobody reviewed. Refused, not read leniently.
 *   4. **Parse against the declared field set.** A missing declared field is a
 *      stale schema; reading it anyway posts `undefined` where an amount was.
 *   5. **Dedupe.** Duplicate and out-of-order are recorded and acknowledged —
 *      a provider that is retried must not be retried forever — but they are
 *      recorded as what they are.
 *
 * Returns quickly and returns 200 for a duplicate: a non-2xx makes the provider
 * redeliver an event that was already received, which is how a redelivery storm
 * starts.
 */

export const dynamic = "force-dynamic"

/** The endpoint secrets currently valid, newest first. Two during a rotation. */
function endpointSecrets(): string[] {
  return [process.env.PAYMENTS_WEBHOOK_SECRET, process.env.PAYMENTS_WEBHOOK_SECRET_PREVIOUS]
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0)
}

function mode(): ProviderMode | null {
  const raw = (process.env.PAYMENTS_PROVIDER_MODE ?? "test").trim().toLowerCase()
  return (PROVIDER_MODES as readonly string[]).includes(raw) ? (raw as ProviderMode) : null
}

export async function POST(request: Request) {
  const secrets = endpointSecrets()
  if (secrets.length === 0) {
    // Not "accept everything until configured". An endpoint with no secret
    // cannot verify, and an unverified provider event is an anonymous one.
    return Response.json({ error: "webhook_secret_not_configured" }, { status: 503 })
  }
  const providerMode = mode()
  if (providerMode === null) {
    return Response.json({ error: "provider_mode_not_configured" }, { status: 503 })
  }

  const rawBody = await request.text()
  const signature = request.headers.get("stripe-signature") ?? ""

  const verified = verifySignature(rawBody, signature, secrets, Date.now())
  if (!verified.ok) {
    // The code, never the reason: the reason names the tolerance and the number
    // of candidate secrets, which tells an attacker how the endpoint is set up.
    return Response.json({ error: verified.code }, { status: 400 })
  }

  let envelope: {
    id?: unknown
    type?: unknown
    api_version?: unknown
    account?: unknown
    data?: { object?: unknown }
  }
  try {
    envelope = JSON.parse(rawBody)
  } catch {
    return Response.json({ error: "event_not_json" }, { status: 400 })
  }

  const eventId = typeof envelope.id === "string" ? envelope.id : null
  const eventType = typeof envelope.type === "string" ? envelope.type : null
  const apiVersion = typeof envelope.api_version === "string" ? envelope.api_version : null
  if (!eventId || !eventType || !apiVersion) {
    return Response.json({ error: "event_envelope_incomplete" }, { status: 400 })
  }

  const versionVerdict = checkEventApiVersion(apiVersion, compareVersionStrings)
  if (!versionVerdict.ok) {
    return Response.json(
      { error: versionVerdict.code, pinned: PROVIDER_API_VERSION },
      { status: 400 },
    )
  }

  try {
    parseProviderEvent(eventType, envelope.data?.object)
  } catch (error) {
    return Response.json(
      {
        error: "event_schema_refused",
        detail: error instanceof Error ? error.message : "unreadable",
      },
      { status: 400 },
    )
  }

  // The platform account when the event is not about a connected one. Never a
  // default of "": an empty account id merges every platform event onto one key.
  const accountId = typeof envelope.account === "string" ? envelope.account : "platform"

  const stream = { provider: PROVIDER, mode: providerMode, accountId }
  const seen: ReceivedEvent[] = (
    await db.providerEventReceipt.findMany({
      where: stream,
      select: { provider: true, mode: true, accountId: true, eventId: true, sequence: true },
      orderBy: { sequence: "desc" },
      take: 500,
    })
  ).map((row) => ({ ...row, mode: row.mode as ProviderMode }))

  // The provider's ordering signal. `created` is seconds and is monotonic per
  // stream, which is exactly what an ordering comparison needs.
  const sequence =
    typeof (envelope as { created?: unknown }).created === "number"
      ? (envelope as { created: number }).created
      : Math.floor(verified.timestampMs / 1000)

  const verdict = dedupe({ ...stream, eventId, sequence }, seen)

  if (verdict === "duplicate") {
    // 200, deliberately. A non-2xx here asks the provider to send it again.
    return Response.json({ received: true, verdict })
  }

  await db.providerEventReceipt.create({
    data: {
      ...stream,
      eventId,
      eventType,
      sequence,
      apiVersion,
      dedupeVerdict: verdict,
      verifiedBySecretIndex: verified.matchedSecretIndex,
    },
  })

  return Response.json({ received: true, verdict })
}
