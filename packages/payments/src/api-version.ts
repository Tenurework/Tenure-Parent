/**
 * PAY-140-002 — the provider API version, pinned in one place.
 *
 * Bible §16: "Pin and intentionally upgrade API versions." Nothing was pinned,
 * so nothing could be held still: a provider upgrade would have changed event
 * shapes under a running reconciliation and no test in the repository would
 * have gone red, because no test knew what version it was written against.
 *
 * The constant is here and only here. `tests/architecture/provider-api-version-is-pinned.test.mjs`
 * asserts three things about that: the ledger's evidence line quotes this exact
 * value, no other source file holds a bare provider version literal, and every
 * entry in `SUPPORTED_EVENT_TYPES` has a parser. The second is the one that
 * matters — a version restated in a second file is a version that will be
 * upgraded in one of them.
 *
 * There is deliberately no second version comparator. Provider versions are
 * dates and `packages/platform-config/src/compatibility.ts` compares
 * `major.minor.patch`, so this normalises the date into that shape and delegates
 * to the comparator the caller passes in. That file's own header says why:
 * "two copies of a version comparator is two chances to disagree." The
 * comparator is injected rather than imported for the same reason `module-runtime`
 * takes one — `platform-config` imports THIS package (see modules.ts), so this
 * package must not import it back.
 */

/**
 * The provider API version every gateway call and every event is read against.
 *
 * Frozen literal, `as const`, so a caller cannot widen it to `string` and then
 * assign something else to it. Changing it is an intentional upgrade: run the
 * contract tests, update the ledger evidence line, and do both in one commit or
 * the architecture test refuses the change.
 */
export const PROVIDER_API_VERSION = "2026-03-31" as const

/** The provider this version belongs to. There is exactly one today. */
export const PROVIDER = "stripe" as const

/**
 * Test and live are different accounts, keys, secrets and event streams.
 *
 * The TYPE is `external-reference.ts`'s, not a second declaration of the same
 * two words: a mode that means one thing when a reference is qualified and
 * another when an event is verified is the disagreement this repository keeps
 * one comparator to avoid. This adds only the runtime tuple, which that module
 * does not need and a `mode` validator does.
 */
export type { ProviderMode } from "./external-reference"

export const PROVIDER_MODES = ["test", "live"] as const

/**
 * An event type Tenure will accept, and the fields it is read for.
 *
 * The field list is not documentation. It is the contract a stale-schema check
 * holds the provider to: an event that no longer carries a field named here is
 * an event whose meaning changed, and it is refused rather than processed with
 * `undefined` where an amount used to be.
 */
export interface SupportedEventType {
  type: string
  /** Dot paths into the event's `data.object`, in the order they are read. */
  fields: readonly string[]
  summary: string
}

export const SUPPORTED_EVENT_TYPES: readonly SupportedEventType[] = [
  {
    type: "account.updated",
    fields: ["id", "charges_enabled", "payouts_enabled", "requirements.currently_due"],
    summary: "A connected account's capabilities or outstanding requirements changed.",
  },
  {
    type: "payment_intent.succeeded",
    fields: ["id", "amount_received", "currency", "on_behalf_of"],
    summary: "A payment completed. Evidence, not authority to post (Bible §4).",
  },
  {
    type: "payment_intent.payment_failed",
    fields: ["id", "amount", "currency", "last_payment_error.code"],
    summary: "A payment attempt failed with a provider reason code.",
  },
  {
    type: "charge.refunded",
    fields: ["id", "amount_refunded", "currency", "refunded"],
    summary: "A charge was refunded in whole or in part.",
  },
  {
    type: "charge.dispute.created",
    fields: ["id", "amount", "currency", "reason", "evidence_details.due_by"],
    summary: "A dispute opened, with the evidence deadline.",
  },
  {
    type: "payout.paid",
    fields: ["id", "amount", "currency", "arrival_date", "destination"],
    summary: "A payout settled to an external account.",
  },
  {
    type: "payout.failed",
    fields: ["id", "amount", "currency", "failure_code"],
    summary: "A payout was returned or rejected.",
  },
]

/** The minimal, provider-neutral shape a supported event is reduced to. */
export interface ParsedProviderEvent {
  type: string
  /** The provider's id for the object the event is about. */
  objectId: string
  /** Field path → value, for exactly the fields the type declares. */
  fields: Readonly<Record<string, unknown>>
}

export class ApiVersionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "ApiVersionError"
    this.code = code
  }
}

/** Read a dot path out of a nested payload without throwing on a gap. */
function readPath(source: unknown, path: string): unknown {
  let cursor: unknown = source
  for (const segment of path.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

/**
 * Reduce one supported event to the fields its type declares.
 *
 * Refuses an event missing a declared field. That is the stale-schema case:
 * the provider renamed or removed something, the event still parses as JSON,
 * and every field read downstream becomes `undefined`. Detecting it here is
 * the difference between a refusal with the field name in it and a reconciliation
 * that quietly books zero.
 */
export function parseProviderEvent(type: string, dataObject: unknown): ParsedProviderEvent {
  const declared = SUPPORTED_EVENT_TYPES.find((e) => e.type === type)
  if (!declared) {
    throw new ApiVersionError(
      "event-type-unsupported",
      `"${type}" is not a supported event type under API version ${PROVIDER_API_VERSION}. ` +
        `Accepting an event nobody wrote a reader for is how an unhandled type is recorded as processed.`,
    )
  }

  const fields: Record<string, unknown> = {}
  for (const path of declared.fields) {
    const value = readPath(dataObject, path)
    if (value === undefined) {
      throw new ApiVersionError(
        "event-field-missing",
        `Event "${type}" is missing "${path}", which API version ${PROVIDER_API_VERSION} declares ` +
          `it carries. The schema moved; reading it anyway would post undefined.`,
      )
    }
    fields[path] = value
  }

  const objectId = fields["id"]
  if (typeof objectId !== "string") {
    throw new ApiVersionError(
      "event-object-id-missing",
      `Event "${type}" carries no string id, so nothing can be keyed on it.`,
    )
  }

  return { type, objectId, fields }
}

/**
 * `2026-03-31` → `2026.3.31`, so a `major.minor.patch` comparator can order it.
 *
 * A normalisation, not a parser: it refuses anything that is not a provider
 * date version rather than producing something that compares as very old.
 */
export function normalizeProviderApiVersion(version: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(version.trim())
  if (!match) {
    throw new ApiVersionError(
      "api-version-unparseable",
      `"${version}" is not a provider API version (expected YYYY-MM-DD). Defaulting it would ` +
        `compare as older than everything and make every compatibility check pass.`,
    )
  }
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`
}

/**
 * Negative when `a` is older, 0 when equal, positive when newer.
 *
 * `compare` is `compareVersionStrings` from `@tenure/platform-config` at every
 * production call site. Injected, not imported — see the header.
 */
export function compareProviderApiVersions(
  a: string,
  b: string,
  compare: (x: string, y: string) => number,
): number {
  return compare(normalizeProviderApiVersion(a), normalizeProviderApiVersion(b))
}

export type ApiVersionVerdict =
  | { ok: true; relation: "pinned" }
  | { ok: false; code: string; reason: string }

/**
 * Is an event's declared API version one this build can read?
 *
 * Exact match only, in both directions, and each direction is a different
 * failure. An OLDER event carries the schema this build no longer reads; a
 * NEWER one carries a schema nobody has reviewed. Bible §16 calls the upgrade
 * intentional, and accepting a version drift silently is the opposite.
 */
export function checkEventApiVersion(
  eventApiVersion: string,
  compare: (x: string, y: string) => number,
): ApiVersionVerdict {
  let ordering: number
  try {
    ordering = compareProviderApiVersions(eventApiVersion, PROVIDER_API_VERSION, compare)
  } catch (error) {
    return {
      ok: false,
      code: "api-version-unparseable",
      reason: error instanceof Error ? error.message : String(error),
    }
  }

  if (ordering === 0) return { ok: true, relation: "pinned" }

  return {
    ok: false,
    code: ordering < 0 ? "api-version-stale" : "api-version-ahead",
    reason:
      ordering < 0
        ? `Event declares API version ${eventApiVersion}; this build is pinned to ${PROVIDER_API_VERSION}. ` +
          `The event carries a schema this build no longer reads.`
        : `Event declares API version ${eventApiVersion}, which is newer than the pinned ` +
          `${PROVIDER_API_VERSION}. Nobody has reviewed that schema; an upgrade is intentional ` +
          `(Bible §16), never something an inbound event performs.`,
  }
}
