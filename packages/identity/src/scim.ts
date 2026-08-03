/**
 * GE-043-005 — the SCIM 2.0 boundary, decided.
 *
 * The item allows "the precise compatible boundary and tests if full SCIM is a
 * later milestone", and that is what this is. There is no HTTP surface here and
 * no store: `/Users` and `/Groups` need a connection registry and a SCIM bearer
 * token, both of which arrive with the Cognito cutover. What exists now, and is
 * decidable now, is every decision those routes will have to make — and each one
 * has a way of being wrong that hands out data or loses it.
 *
 * The two that matter most, because they fail silently:
 *
 *   * **An unsupported filter must be refused, not ignored.** A provisioning
 *     agent asks for `userName eq "x"`. If the server does not understand the
 *     filter and returns the collection anyway, the agent receives every user in
 *     the tenant and, worse, believes it asked a narrow question. RFC 7644 §3.4.2.2
 *     makes this a `400 invalidFilter`, and the reason is that the alternative
 *     is a tenant-wide disclosure through a query string.
 *   * **`active: false` is a suspension, not a deletion.** An HR system
 *     deprovisioning somebody must not take their history with them, and it must
 *     not be reversible only by re-creating a different person. GE-040-001 made
 *     memberships effective-dated precisely so this could be a state change.
 */

/* ────────────────────────────────────────────────────────────── filter ── */

/** The operators RFC 7644 §3.4.2.2 defines. Not all of them are supported. */
export const SCIM_OPERATORS = ["eq", "ne", "co", "sw", "ew", "gt", "ge", "lt", "le", "pr"] as const
export type ScimOperator = (typeof SCIM_OPERATORS)[number]

/**
 * The operators this boundary answers.
 *
 * Deliberately a small set. Every provisioning agent worth supporting filters on
 * `userName eq` and `externalId eq`; the ordering operators are for querying
 * `meta.lastModified`, which this boundary does not offer. Supporting an
 * operator badly is worse than refusing it, because a wrong answer to `co` looks
 * like a small result set rather than an error.
 */
const SUPPORTED_OPERATORS: ReadonlySet<ScimOperator> = new Set<ScimOperator>(["eq", "ne", "pr"])

/** The attributes a caller may filter on. An allowlist, for the usual reason. */
const FILTERABLE = new Set(["username", "externalid", "active", "displayname", "id"])

export interface ScimFilter {
  attribute: string
  operator: ScimOperator
  /** Absent for `pr` (present), which takes no comparison value. */
  value: string | null
}

export type FilterRefusal =
  | "UNPARSEABLE"
  | "UNSUPPORTED_OPERATOR"
  | "UNFILTERABLE_ATTRIBUTE"
  | "TOO_COMPLEX"

export type FilterOutcome =
  | { ok: true; filter: ScimFilter }
  | { ok: false; reason: FilterRefusal; detail: string }

/**
 * Parse one SCIM filter expression.
 *
 * Single-term only. `and`/`or`/`not` and grouping are refused as `TOO_COMPLEX`
 * rather than half-implemented — a parser that silently drops the second term of
 * `userName eq "a" and active eq false` answers a question nobody asked, and the
 * answer is a superset.
 */
export function parseScimFilter(expression: string): FilterOutcome {
  const text = expression.trim()

  if (text.length === 0) {
    return { ok: false, reason: "UNPARSEABLE", detail: "The filter is empty." }
  }

  // Checked before parsing, so a compound filter is never partly honoured.
  // Word-boundary matching: `and` must not fire on `brandName`.
  if (/\b(and|or|not)\b/i.test(text) || text.includes("(") || text.includes("[")) {
    return {
      ok: false,
      reason: "TOO_COMPLEX",
      detail:
        "This boundary answers single-term filters only. A parser that dropped part of a compound " +
        "filter would answer a broader question than the one asked, and return more than the caller expects.",
    }
  }

  // `attribute op "value"` or `attribute pr`.
  const match = /^([A-Za-z][\w.$:]*)\s+([A-Za-z]{2})(?:\s+(.+))?$/.exec(text)
  if (!match) {
    return { ok: false, reason: "UNPARSEABLE", detail: `Could not read "${expression}" as a SCIM filter.` }
  }

  const [, rawAttribute, rawOperator, rawValue] = match
  const operator = rawOperator.toLowerCase() as ScimOperator

  if (!(SCIM_OPERATORS as readonly string[]).includes(operator)) {
    return {
      ok: false,
      reason: "UNSUPPORTED_OPERATOR",
      detail: `"${rawOperator}" is not a SCIM operator.`,
    }
  }
  if (!SUPPORTED_OPERATORS.has(operator)) {
    // Refused, never ignored. RFC 7644 §3.4.2.2 — an ignored filter returns the
    // collection, and the caller believes it asked a narrow question.
    return {
      ok: false,
      reason: "UNSUPPORTED_OPERATOR",
      detail: `"${operator}" is a valid SCIM operator this boundary does not answer. It is refused rather than ignored: ignoring it would return every record in the tenant to a caller who asked for one.`,
    }
  }

  const attribute = rawAttribute.toLowerCase()
  if (!FILTERABLE.has(attribute)) {
    return {
      ok: false,
      reason: "UNFILTERABLE_ATTRIBUTE",
      detail: `"${rawAttribute}" cannot be filtered on. Filtering on an unindexed attribute is a table scan per request, and a provisioning agent retries.`,
    }
  }

  if (operator === "pr") {
    if (rawValue !== undefined) {
      return { ok: false, reason: "UNPARSEABLE", detail: `"pr" takes no value.` }
    }
    return { ok: true, filter: { attribute, operator, value: null } }
  }

  if (rawValue === undefined) {
    return { ok: false, reason: "UNPARSEABLE", detail: `"${operator}" needs a value.` }
  }

  // Quoted strings, or the bare literals SCIM allows for booleans.
  const quoted = /^"(.*)"$/.exec(rawValue.trim())
  const value = quoted ? quoted[1] : rawValue.trim()
  if (!quoted && !/^(true|false|null)$/i.test(value)) {
    return {
      ok: false,
      reason: "UNPARSEABLE",
      detail: `Values must be quoted. "${rawValue.trim()}" is not.`,
    }
  }

  return { ok: true, filter: { attribute, operator, value } }
}

/* ────────────────────────────────────────────────────────── pagination ── */

/** RFC 7644 §3.4.2.4 pagination, which is 1-based and catches everybody once. */
export const SCIM_DEFAULT_COUNT = 100
export const SCIM_MAX_COUNT = 200

export interface ScimPage {
  /** 1-based, per the RFC. */
  startIndex: number
  count: number
}

/**
 * Normalise pagination parameters.
 *
 * Clamped rather than refused. A provisioning agent sending `count=10000` is not
 * attacking anything, it is trying to finish, and a 400 makes a sync that could
 * have worked fail permanently. Clamping and reporting `itemsPerPage` honestly
 * is what the RFC expects, and the agent pages.
 *
 * `startIndex` below 1 becomes 1, per §3.4.2.4. Treating 0 as 0 would silently
 * repeat the first record on every sync that began at zero, which is the sort of
 * duplicate somebody chases for a week.
 */
export function normaliseScimPage(input: { startIndex?: number; count?: number }): ScimPage {
  const rawStart = input.startIndex ?? 1
  const startIndex = !Number.isFinite(rawStart) || rawStart < 1 ? 1 : Math.floor(rawStart)

  const rawCount = input.count ?? SCIM_DEFAULT_COUNT
  const count = !Number.isFinite(rawCount)
    ? SCIM_DEFAULT_COUNT
    : Math.max(0, Math.min(Math.floor(rawCount), SCIM_MAX_COUNT))

  return { startIndex, count }
}

/** The envelope a SCIM list response carries. */
export interface ScimListResponse<T> {
  schemas: readonly string[]
  totalResults: number
  startIndex: number
  itemsPerPage: number
  Resources: readonly T[]
}

export const LIST_RESPONSE_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse"

export function scimListResponse<T>(
  resources: readonly T[],
  page: ScimPage,
  totalResults: number,
): ScimListResponse<T> {
  return {
    schemas: [LIST_RESPONSE_SCHEMA],
    totalResults,
    startIndex: page.startIndex,
    // What was actually returned, not what was asked for. A caller that trusted
    // the requested count would page past the end and report phantom users.
    itemsPerPage: resources.length,
    Resources: resources,
  }
}

/* ─────────────────────────────────────────────────────────────── PATCH ── */

export interface ScimPatchOperation {
  op: string
  path?: string
  value?: unknown
}

export type PatchRefusal = "UNKNOWN_OP" | "IMMUTABLE_PATH" | "MISSING_VALUE" | "UNSUPPORTED_PATH"

export interface PatchChange {
  /** Normalised lower-case path. */
  path: string
  op: "add" | "remove" | "replace"
  value: unknown
}

export type PatchOutcome =
  | { ok: true; changes: readonly PatchChange[] }
  | { ok: false; reason: PatchRefusal; detail: string }

/** Paths a provisioning agent may change. */
const PATCHABLE = new Set(["active", "displayname", "name.givenname", "name.familyname", "externalid"])

/**
 * Paths that are never a provisioning agent's to set.
 *
 * `id` is ours and stable; a rewritten id detaches every record that referenced
 * it. `members` is refused here because group membership is not authority in
 * this platform (GE-043-003) — accepting a `members` PATCH would look like it
 * did something, and doing nothing quietly is worse than saying no.
 */
const IMMUTABLE = new Set(["id", "meta", "schemas", "groups", "roles", "entitlements", "members"])

/**
 * Interpret a PATCH request.
 *
 * Every operation is validated before any is applied, so a request cannot land
 * half of itself. RFC 7644 §3.5.2 does not require atomicity in so many words,
 * but a partly-applied deprovisioning is the failure that matters here: `active:
 * false` applied and the rest refused leaves somebody locked out for a reason
 * nobody recorded.
 */
export function interpretScimPatch(operations: readonly ScimPatchOperation[]): PatchOutcome {
  const changes: PatchChange[] = []

  for (const operation of operations) {
    const op = operation.op?.toLowerCase()
    if (op !== "add" && op !== "remove" && op !== "replace") {
      return { ok: false, reason: "UNKNOWN_OP", detail: `"${operation.op}" is not a SCIM PATCH operation.` }
    }

    // A pathless `replace` carries an object of attributes, which SCIM allows.
    // Refused here rather than guessed at: the shape is ambiguous enough that
    // agents disagree about it, and guessing wrong writes the wrong field.
    if (!operation.path) {
      return {
        ok: false,
        reason: "UNSUPPORTED_PATH",
        detail: "This boundary requires an explicit path. A pathless operation is interpreted differently by different agents.",
      }
    }

    const path = operation.path.toLowerCase().replace(/^urn:[^:]+:[^:]+:[^:]+:[\w.:]+:/i, "")
    const head = path.split(/[.[]/)[0]

    if (IMMUTABLE.has(head) || IMMUTABLE.has(path)) {
      return {
        ok: false,
        reason: "IMMUTABLE_PATH",
        detail: `"${operation.path}" is not a provisioning agent's to set. Authority in this platform comes from a membership, a seat or a policy — never from a group a directory asserts.`,
      }
    }

    if (!PATCHABLE.has(path)) {
      return {
        ok: false,
        reason: "UNSUPPORTED_PATH",
        detail: `"${operation.path}" is not a path this boundary changes.`,
      }
    }

    if (op !== "remove" && operation.value === undefined) {
      return { ok: false, reason: "MISSING_VALUE", detail: `"${op}" on "${operation.path}" carries no value.` }
    }

    changes.push({ path, op, value: op === "remove" ? null : operation.value })
  }

  return { ok: true, changes }
}

/* ───────────────────────────────────────────────── version and ETag ── */

export type ConcurrencyOutcome =
  | { ok: true }
  | { ok: false; reason: "VERSION_MISMATCH" | "VERSION_REQUIRED"; detail: string }

/**
 * Whether a write may proceed against the version the caller last saw.
 *
 * `requireMatch` exists because two agents syncing the same directory is normal
 * — an HR system and an identity provider both think they own `active` — and
 * last-write-wins between them produces a person who is deactivated and
 * reactivated on alternate hours. An `If-Match` that does not match is a 412,
 * and the agent re-reads.
 *
 * A caller that sends no `If-Match` at all is refused when `requireMatch` is on,
 * rather than treated as a match. "I did not check" and "I checked and it is
 * current" must never be the same input.
 */
export function checkScimVersion(input: {
  ifMatch: string | null
  currentVersion: string
  requireMatch: boolean
}): ConcurrencyOutcome {
  if (input.ifMatch === null) {
    if (!input.requireMatch) return { ok: true }
    return {
      ok: false,
      reason: "VERSION_REQUIRED",
      detail: "This resource requires If-Match. A write with no version is a write that did not check.",
    }
  }

  // Weak comparison per RFC 7232 §2.3.2: `W/"abc"` and `"abc"` are the same
  // entity. Agents differ on emitting the prefix, and treating them as different
  // makes every write from one of them a 412 forever.
  const normalise = (tag: string) => tag.trim().replace(/^W\//, "").replace(/^"|"$/g, "")

  if (normalise(input.ifMatch) !== normalise(input.currentVersion)) {
    return {
      ok: false,
      reason: "VERSION_MISMATCH",
      detail: `This resource has changed since version ${input.ifMatch}. Re-read it and apply the change again.`,
    }
  }
  return { ok: true }
}

/* ────────────────────────────────────────────────────── idempotency ── */

export interface ScimCreateSubject {
  externalId: string | null
  userName: string
}

export type CreateOutcome =
  | { ok: true; action: "CREATE" }
  | { ok: true; action: "RETURN_EXISTING"; id: string }
  | { ok: false; reason: "CONFLICT" | "NO_IDENTIFIER"; detail: string }

/**
 * Whether a create is a create.
 *
 * Provisioning agents retry, and a retried POST that creates a second user
 * produces two people who are one person. The `externalId` is the directory's
 * own identifier and the only thing stable across a retry — `userName` is not,
 * because it changes when somebody marries.
 *
 * A repeat is answered with the existing resource rather than a conflict:
 * §3.3 permits either, and a 409 sends a well-behaved agent into an error path
 * for having done nothing wrong.
 */
export function decideScimCreate(
  subject: ScimCreateSubject,
  existing: readonly { id: string; externalId: string | null; userName: string }[],
): CreateOutcome {
  if (!subject.userName) {
    return { ok: false, reason: "NO_IDENTIFIER", detail: "A SCIM user needs a userName." }
  }

  if (subject.externalId) {
    const same = existing.find((record) => record.externalId === subject.externalId)
    if (same) return { ok: true, action: "RETURN_EXISTING", id: same.id }
  }

  // No externalId, or a new one. A colliding userName is a genuine conflict:
  // two directories have sent two different people under one name, and picking
  // either would merge them.
  const collision = existing.find(
    (record) => record.userName.toLowerCase() === subject.userName.toLowerCase(),
  )
  if (collision) {
    return {
      ok: false,
      reason: "CONFLICT",
      detail: `userName "${subject.userName}" already exists under a different externalId. Merging them would join two people into one.`,
    }
  }

  return { ok: true, action: "CREATE" }
}

/* ──────────────────────────────────────────── deactivate / reactivate ── */

export interface DeactivationEffect {
  /** What happens to the membership. Never a delete. */
  membership: "SUSPEND" | "REINSTATE"
  /**
   * Whether every session this person holds ends now.
   *
   * True on deactivation, and that is the whole point of it. A deprovisioning
   * that leaves a live session running has removed somebody's ability to sign in
   * again and nothing else — they keep working until the session expires, which
   * is exactly the window an offboarding exists to close.
   */
  revokeSessions: boolean
  detail: string
}

/**
 * What `active` actually does.
 *
 * Never a delete. An HR system deprovisioning somebody must not take their
 * history with them, and reinstatement must not require re-creating a different
 * person with a new id. GE-040-001 made memberships effective-dated so that this
 * could be a state change, and this is the state change.
 */
export function scimActiveEffect(active: boolean): DeactivationEffect {
  return active
    ? {
        membership: "REINSTATE",
        revokeSessions: false,
        detail: "Membership is reinstated. Existing sessions are unaffected — there are none to revoke, and ending them would sign out an account that was just restored.",
      }
    : {
        membership: "SUSPEND",
        revokeSessions: true,
        detail: "Membership is suspended and every session ends immediately. The record is kept: deprovisioning removes access, not history.",
      }
}
