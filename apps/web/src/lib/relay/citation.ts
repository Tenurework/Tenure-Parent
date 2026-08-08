import {
  GRAPH_CALENDAR_REVIEW,
  GRAPH_CALENDAR_SCOPES,
  providerActivation,
  type ProviderReview,
} from "@tenure/platform-config"
import { requireTenantScope } from "@/lib/tenancy/context"
import {
  advance,
  bodyMayBeQuoted,
  isProjectionEvent,
  isProjectionState,
  type ProjectionEvent,
  type ProjectionState,
} from "@/lib/relay/projection-state"

/**
 * WRK-010-005 / WRK-070-003 / WRK-010-001 — what a projected source IS, how
 * fresh it is, and whether an answer may rest on it.
 *
 * Three requirements meet in this file because they are three halves of one
 * value. §9.3 wants a citation (origin, assertion kind, version time, state,
 * governed deep link). §3.5 wants a state ladder that a projection walks and
 * that a terminal state does not return from. §3.2 wants the canonical objects a
 * citation is made of — and `apps/web/src/lib/connections/capability-resolution.ts:15`
 * records, in prose, that none of them existed anywhere in this repository.
 *
 * ## Two vocabularies, one ladder
 *
 * `ProjectedState` is the OPERATIONAL verdict this platform can actually reach
 * about its own rows today: live, stale, tombstoned, quarantined, access-lost,
 * conflicted. `ProjectionState` (`projection-state.ts`) is Bible §3.5's sixteen
 * canonical names. They are not two answers to one question — the second is the
 * vocabulary, the first is the subset this system can currently observe — and
 * `CANONICAL_PROJECTION_STATE` maps every one of the six onto its §3.5 name, so
 * a `TOMBSTONED` row and a connector's `SOURCE_DELETED` row are the same fact
 * with one spelling. That mapping is what stops the vocabulary rotting into two
 * lists that drift, which is the failure `projection-policy.ts` already warns
 * about for the §3.4 modes.
 *
 * ## `Tombstone` is deliberately not declared
 *
 * §3.2 lists it. Nothing in this tree OBSERVES a deletion: the corpus reads live
 * rows and infers `TOMBSTONED` from a row's own status column, so a `Tombstone`
 * object here would have no producer and no consumer. A type nobody constructs,
 * carrying a comment claiming a section landed, is worse than the section
 * plainly not being there. The ledger says which §3.2 objects remain unwritten.
 */

// ── §3.2's canonical reference ───────────────────────────────────────────────

export class CitationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CitationError"
  }
}

/**
 * A pointer to an object in the system that holds it.
 *
 * All three fields are required and each is checked for emptiness rather than
 * merely for presence: `""` satisfies `typeof value === "string"` and is not an
 * identifier, and a citation whose tenant is `""` is a citation that has left
 * its partition — which principle 15 ("cross-tenant joins are impossible …
 * graph … boundaries carry and verify canonical tenant context") exists to
 * prevent.
 *
 * `provider` is `"tenure"` for every row in the corpus today, because every row
 * in the corpus today is a row in this platform's own database. Saying so
 * explicitly is the point: when a Drive file or a Slack message joins the
 * corpus, the SHAPE of a citation does not change and only the provider does. A
 * citation that named no system would have to be widened for the first
 * connector, and widening a required field across an unknown number of
 * construction sites is the failure this codebase has recorded twice.
 */
export interface ExternalObjectRef {
  tenant: string
  provider: string
  externalId: string
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CitationError(`a ${what} must be an object; got ${JSON.stringify(value)}`)
  }
  return value as Record<string, unknown>
}

function requireNonEmpty(record: Record<string, unknown>, field: string, what: string): string {
  const value = record[field]
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CitationError(
      `a ${what} must name "${field}", and this one carried ${JSON.stringify(value)}. ` +
        `An unattributed citation is a claim nobody can check.`,
    )
  }
  return value
}

/** An ISO-8601 instant, or a refusal. `Date.parse` alone accepts `"3"`. */
function requireInstant(record: Record<string, unknown>, field: string, what: string): string {
  const value = record[field]
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new CitationError(
      `a ${what} must carry "${field}" as an ISO-8601 instant, and this one carried ` +
        `${JSON.stringify(value)}. Freshness is the whole reason §3.5 has states: a projection ` +
        `with no observation time cannot honestly be shown as current, stale, or anything else.`,
    )
  }
  return value
}

export function parseExternalObjectRef(value: unknown): ExternalObjectRef {
  const record = asRecord(value, "reference")
  return {
    tenant: requireNonEmpty(record, "tenant", "reference"),
    provider: requireNonEmpty(record, "provider", "reference"),
    externalId: requireNonEmpty(record, "externalId", "reference"),
  }
}

/**
 * What one read of a source actually saw, and when.
 *
 * The input side of a citation: `projectTenureRecord` builds one per row and
 * parses it, so a builder that stops setting `observedAt` fails at the corpus
 * load rather than producing a citation whose freshness is `undefined`.
 */
export interface SyncObservation {
  ref: ExternalObjectRef
  observedAt: string
  /** When the source itself last changed. Not the same instant as `observedAt`. */
  versionAt: string
  /** What happened, in §3.5's vocabulary. */
  event: ProjectionEvent
}

export function parseSyncObservation(value: unknown): SyncObservation {
  const record = asRecord(value, "sync observation")
  const event = record.event
  if (!isProjectionEvent(event)) {
    throw new CitationError(
      `"${String(event)}" is not a projection event. An observation this build cannot name is ` +
        `one it cannot decide a state from.`,
    )
  }
  return {
    ref: parseExternalObjectRef(record.ref),
    observedAt: requireInstant(record, "observedAt", "sync observation"),
    versionAt: requireInstant(record, "versionAt", "sync observation"),
    event,
  }
}

// ── the operational verdict ──────────────────────────────────────────────────

/**
 * What this platform can actually observe about one of its own projected rows.
 *
 * A strict subset of §3.5's sixteen — see `CANONICAL_PROJECTION_STATE` — chosen
 * because a state nothing can produce is a state nothing can be tested against.
 */
export const PROJECTED_STATES = [
  /** Read this request, from a row that changed recently enough to answer from. */
  "LIVE",
  /** Read this request, from a row nothing has touched in a long time. */
  "STALE",
  /** The source says this object is gone: a cancelled event, an archived record. */
  "TOMBSTONED",
  /** The text carried active content and is being held rather than cleaned. */
  "QUARANTINED",
  /** The projection exists and the way back to its source does not. */
  "ACCESS_LOST",
  /** The projection and its source disagree and nobody has reconciled them. */
  "CONFLICTED",
] as const

export type ProjectedState = (typeof PROJECTED_STATES)[number]

/**
 * Every operational verdict, in §3.5's own words.
 *
 * A `Record` over `ProjectedState`, so adding a seventh verdict is a compile
 * error here rather than a state with no canonical name.
 */
export const CANONICAL_PROJECTION_STATE: Record<ProjectedState, ProjectionState> = {
  LIVE: "CURRENT",
  STALE: "STALE",
  TOMBSTONED: "SOURCE_DELETED",
  QUARANTINED: "QUARANTINED",
  ACCESS_LOST: "ACCESS_REVOKED",
  CONFLICTED: "MAPPING_CONFLICT",
}

export function isProjectedState(value: unknown): value is ProjectedState {
  return typeof value === "string" && (PROJECTED_STATES as readonly string[]).includes(value)
}

/**
 * Whether an answer may rest on a source in this state.
 *
 * Delegated to §3.5's own rule rather than restated: `bodyMayBeQuoted` allows
 * `CURRENT`, `STALE` and `REFRESHING` and refuses everything else, so LIVE and
 * STALE are answerable and the four exceptional verdicts are not. Stating the
 * predicate twice is how the ladder and the corpus start to disagree.
 *
 * STALE is answerable ON PURPOSE and labelled rather than withheld: a budget
 * deadline from three months ago is still the best answer anybody has, and
 * hiding it is its own kind of wrong. §3.5 asks that freshness be SHOWN, not
 * that stale sources be suppressed.
 */
export function isAnswerable(state: ProjectedState): boolean {
  return bodyMayBeQuoted(CANONICAL_PROJECTION_STATE[state])
}

/**
 * Whether a row in this state may carry its text into the corpus at all.
 *
 * The same rule as `isAnswerable`, applied one step earlier — at construction,
 * in `search-data.ts`, rather than at consumption. The two are deliberately one
 * predicate and not two: a row an answer may not rest on has no business
 * carrying its body through ranking, snippets and a prompt on the chance that
 * every consumer remembers to check the state.
 */
export function projectsBody(state: ProjectedState): boolean {
  return isAnswerable(state)
}

// ── the citation ─────────────────────────────────────────────────────────────

/**
 * What kind of claim the citation makes about the object.
 *
 * `RECORD` — this IS the system of record's row. `PROJECTION` — a governed copy
 * or extract of somebody else's object. The distinction is §9.3's, and it
 * matters to a reader: "Tenure says" and "Tenure's copy of what Drive said"
 * carry different weight and different staleness risk.
 */
export const CITATION_ASSERTIONS = ["RECORD", "PROJECTION"] as const
export type CitationAssertion = (typeof CITATION_ASSERTIONS)[number]

// ── governed deep links (WRK-070-003) ────────────────────────────────────────

/**
 * What a provider must have before one of its URLs may be emitted as a link.
 *
 * `host` is DECLARED here and compared against the stored URL, never read out of
 * it. That is the whole control: a projected object's link is a string the
 * provider — or whoever wrote into the provider — chose, so "it says it is an
 * Outlook link" is a claim by the attacker-influenceable half of the pair. §9.4
 * already refuses to let a retrieved body carry a fetchable URL into a prompt
 * (`hostLabel` in `untrusted-content.ts`); this is the same refusal applied to
 * the one link a citation legitimately needs.
 */
export interface ProviderDeepLinkPolicy {
  providerId: string
  /** The single host whose URLs may be cited for this provider. */
  host: string
  /** The scopes the integration asks for — the input to `providerActivation`. */
  scopes: readonly string[]
  /** The provider-side review record. */
  review: ProviderReview
}

/**
 * Every provider whose links this platform would emit, and there is one.
 *
 * `microsoft-graph-calendar` is the only external provider this repository
 * catalogues at all: `GRAPH_CALENDAR_REVIEW` in `@tenure/platform-config`, read
 * today by `CalendarSubscribe.tsx` and the calendar page. Its review is honestly
 * `NOT_SUBMITTED`, so `governedDeepLink` refuses every Microsoft link as this
 * ships — which is what an activation gate IS, and is the same consequence
 * `/api/ai/chat` already accepts from `RELAY_ANTHROPIC_REVIEW`.
 *
 * A provider absent from this table is refused rather than defaulted, so adding
 * a connector without declaring its host produces a citation with no link rather
 * than one with an unchecked link.
 */
export const PROVIDER_DEEP_LINK_POLICIES: Readonly<Record<string, ProviderDeepLinkPolicy>> = {
  "microsoft-graph-calendar": {
    providerId: "microsoft-graph-calendar",
    // Where a Graph calendar event's `webLink` actually points. Declared, not
    // parsed out of the stored value.
    host: "outlook.office.com",
    scopes: GRAPH_CALENDAR_SCOPES,
    review: GRAPH_CALENDAR_REVIEW,
  },
}

/** A stored link, and whose it is. */
export interface DeepLinkCandidate {
  /** The provider this link belongs to, or null for one of Tenure's own paths. */
  providerId: string | null
  /** Whatever is stored against the source. Untrusted when `providerId` is set. */
  url: string
}

/** `null` for Tenure's own rows, so the gate below takes its internal branch. */
export function providerIdOf(ref: ExternalObjectRef): string | null {
  return ref.provider === TENURE_PROVIDER ? null : ref.provider
}

/**
 * The link a citation may carry, or null.
 *
 * Two branches, and the one production takes today is the first.
 *
 * **Tenure's own rows** cite an internal path — `/calendar/ev_1`,
 * `/orgs/alpha/documents`. It is emitted only when it really is a same-origin
 * absolute path: a leading `/`, and not `//`, which a browser reads as
 * protocol-relative and resolves against another host entirely. A corpus builder
 * that ever stamps an absolute external URL into `href` gets no deep link rather
 * than an off-platform link rendered as though Tenure had vouched for it.
 *
 * **A provider's rows** are refused unless that provider is activated for the
 * scopes it asks for AND the URL's origin is the host this platform declared for
 * it. Both halves are required and neither is sufficient: an activated provider
 * does not make an arbitrary URL safe, and a matching host does not make an
 * unreviewed integration reviewed.
 *
 * `now` and `policies` are parameters for the same reason `providerActivation`
 * takes its `now`: the activated branch cannot be exercised against a record
 * that is honestly `NOT_SUBMITTED`, and writing `APPROVED` into the shipped
 * record so a test can pass is the exact failure the gate exists to prevent.
 */
export function governedDeepLink(
  candidate: DeepLinkCandidate,
  now: Date = new Date(),
  policies: Readonly<Record<string, ProviderDeepLinkPolicy>> = PROVIDER_DEEP_LINK_POLICIES,
): string | null {
  const { providerId, url } = candidate
  if (typeof url !== "string" || url.length === 0) return null

  if (providerId === null) {
    return url.startsWith("/") && !url.startsWith("//") ? url : null
  }

  const policy = policies[providerId]
  if (!policy) return null
  if (!providerActivation(policy.scopes, policy.review, now.toISOString()).activated) return null

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== "https:") return null
  return parsed.host.toLowerCase() === policy.host.toLowerCase() ? parsed.href : null
}

/** §9.3's citation: origin, assertion kind, version time, state, deep link. */
export interface SourceCitation {
  /** The origin, as a checked reference rather than a display string. */
  ref: ExternalObjectRef
  assertion: CitationAssertion
  /** When the source last changed. */
  versionAt: string
  /** When this projection read it. */
  observedAt: string
  state: ProjectedState
  /**
   * The governed deep link — where a person goes to read the source itself, or
   * null when no link may be governed.
   *
   * Nullable, and minted by `governedDeepLink` inside `parseSourceCitation`
   * rather than copied off the input. Until that gate existed this field held
   * whatever string the caller passed, under a comment that called it governed:
   * a claim, not a control. Null rather than a throw for an ungoverned link,
   * because a source whose provider nobody activated is still a source worth
   * naming — §9.3 wants the reader to know it exists and that they cannot be
   * sent to it, which is a different statement from "no such record".
   */
  href: string | null
}

export function parseSourceCitation(value: unknown): SourceCitation {
  const record = asRecord(value, "citation")
  const state = record.state
  if (!isProjectedState(state)) {
    throw new CitationError(
      `"${String(state)}" is not a projected state. A projection whose state this build cannot ` +
        `name must not be cited as though it were current.`,
    )
  }
  const assertion = record.assertion
  if (
    typeof assertion !== "string" ||
    !(CITATION_ASSERTIONS as readonly string[]).includes(assertion)
  ) {
    throw new CitationError(
      `"${String(assertion)}" is not a citation assertion (${CITATION_ASSERTIONS.join(", ")}).`,
    )
  }
  const ref = parseExternalObjectRef(record.ref)
  return {
    ref,
    assertion: assertion as CitationAssertion,
    versionAt: requireInstant(record, "versionAt", "citation"),
    observedAt: requireInstant(record, "observedAt", "citation"),
    state,
    // The gate runs HERE and nowhere else, so no construction path can put an
    // ungoverned link on a citation — not `projectTenureRecord`, not a cached
    // payload, not a test double. `ref.provider` decides which branch applies,
    // which is why the provider is part of the reference rather than a display
    // string: the link and the authority to emit it come from one value.
    href: governedDeepLink({
      providerId: providerIdOf(ref),
      url: typeof record.href === "string" ? record.href : "",
    }),
  }
}

/**
 * The citation, in one short bracketed label.
 *
 * Short on purpose: `modelSourceFor` puts it at the FRONT of a heading that
 * `fenceUntrusted` caps at 300 characters, so a label a long club name could
 * push off the end would be present exactly when it is not needed. Platform
 * authored end to end — no tenant text is interpolated, so a club that renames
 * itself `LIVE` cannot forge one.
 */
export function citationLabel(citation: SourceCitation): string {
  return `[${citation.ref.provider} ${citation.assertion.toLowerCase()} · ${citation.state} · v${citation.versionAt}]`
}

/**
 * How long a row may go untouched before an answer must call it stale.
 *
 * Ninety days, and the number is a judgement rather than a constant somebody
 * needed: a student organization's records move on a semester rhythm, so a
 * fortnight would mark every ordinary record stale in the summer and a year
 * would call an officer roster current across two handovers. §3.5 asks for
 * freshness to be SHOWN; this is the line at which showing it changes the
 * answer.
 */
export const SEARCH_STALE_AFTER_MS = 90 * 24 * 60 * 60 * 1000

/**
 * LIVE or STALE, from the row's own version time.
 *
 * Fails closed to STALE on an unreadable date. A row whose `updatedAt` did not
 * survive its projection has no freshness anybody can vouch for, and the safe
 * direction for "I do not know how old this is" is to say so.
 */
export function freshnessOf(asOf: Date, now: Date): "LIVE" | "STALE" {
  const at = asOf instanceof Date ? asOf.getTime() : Number.NaN
  const reference = now instanceof Date ? now.getTime() : Number.NaN
  if (Number.isNaN(at) || Number.isNaN(reference)) return "STALE"
  return reference - at > SEARCH_STALE_AFTER_MS ? "STALE" : "LIVE"
}

/**
 * The system of record for every row in this corpus, named once.
 *
 * A constant rather than a literal at five construction sites, so the first
 * connector-backed row is a value change and not a search-and-replace.
 */
export const TENURE_PROVIDER = "tenure"

/** What `projectTenureRecord` needs to decide a state and build a citation. */
export interface TenureRecordProjection {
  /**
   * The tenant this row belongs to. REQUIRED, and not defaulted from the open
   * scope: a citation whose tenant is inferred is a citation that cannot be
   * checked, and an optional tenant is the field a caller forgets — invisible to
   * `tsc`, green in every test that builds its own fixture, wrong in production.
   */
  tenant: string
  /** The row's id in its system of record. */
  externalId: string
  /** The governed deep link. */
  href: string
  /** The row's own version time — `updatedAt`, not the clock. */
  asOf: Date
  /** One instant for the whole corpus, so two rows cannot disagree about "now". */
  now: Date
  /** The source says this object is gone. */
  deleted?: boolean
  /** The text carried active content (`activeContentFindings`). */
  quarantined?: boolean
}

/**
 * The state and the citation for one row of this platform's own data.
 *
 * Both are returned from ONE call so `SearchDoc.state` and
 * `SearchDoc.citation.state` are equal by construction rather than by a
 * convention two builders could break independently.
 *
 * The §3.5 ladder is WALKED rather than asserted: the query discovered the row,
 * the caller authorized it — every row that failed authorization has already
 * been dropped by the time this runs — and the same query is the fetch that
 * returned it. If `advance` stops admitting that walk, the corpus load fails
 * loudly instead of handing a model a state nothing produced. That is a real
 * coupling to `projection-state.ts` and it is the point of having a ladder.
 */
export function projectTenureRecord(input: TenureRecordProjection): {
  state: ProjectedState
  citation: SourceCitation
} {
  const observedAt = input.now.toISOString()
  // A row whose version time did not survive its projection still gets a
  // citation — it is the observation instant, and `freshnessOf` has already
  // failed it closed to STALE, so the citation says "we read this now and we
  // cannot vouch for how old it is" rather than throwing away the row.
  const versionAt =
    input.asOf instanceof Date && !Number.isNaN(input.asOf.getTime())
      ? input.asOf.toISOString()
      : observedAt

  const observation = parseSyncObservation({
    ref: { tenant: input.tenant, provider: TENURE_PROVIDER, externalId: input.externalId },
    observedAt,
    versionAt,
    event: input.deleted
      ? "SOURCE_DELETED"
      : input.quarantined
        ? "QUARANTINE"
        : "FETCH_SUCCEEDED",
  })

  let ladder: ProjectionState = "DISCOVERED"
  for (const event of ["AUTHORIZE", "REQUEST_FETCH", observation.event] as const) {
    const step = advance(ladder, event)
    if (!step.ok) throw new CitationError(step.reason)
    ladder = step.state
  }

  const state: ProjectedState = input.deleted
    ? "TOMBSTONED"
    : input.quarantined
      ? "QUARANTINED"
      : freshnessOf(input.asOf, input.now)

  // The two vocabularies must agree on this row, or one of them is lying about
  // it. `AGE` is the only step the walk above cannot take on its own: the
  // ladder reaches CURRENT, and freshness is what turns CURRENT into STALE.
  const canonical = CANONICAL_PROJECTION_STATE[state]
  if (canonical !== ladder && !(canonical === "STALE" && ladder === "CURRENT")) {
    throw new CitationError(
      `the ladder reached ${ladder} and the verdict is ${state} (${canonical}). Two vocabularies ` +
        `for one projection must not disagree about it.`,
    )
  }

  return {
    state,
    citation: parseSourceCitation({
      ref: observation.ref,
      assertion: "RECORD",
      versionAt: observation.versionAt,
      observedAt: observation.observedAt,
      state,
      href: input.href,
    }),
  }
}

/**
 * The tenant the current work is being done for, for callers that build a
 * citation inside an open scope.
 *
 * Exported so `search-data.ts` reads the tenant from the SCOPE — the value
 * `resolveTenantScope` validated against live membership — rather than from a
 * row's own column, which is the row asserting its own tenancy.
 */
export function citingTenant(entryPoint: string): string {
  return requireTenantScope(entryPoint).institutionId
}

/**
 * A citation for a value that came from somewhere this module does not own.
 *
 * Fails closed, matching `projectionModeOf`'s convention one file away: a doc
 * whose citation is missing or malformed is treated as a source nobody could
 * resolve, so `isAnswerable` refuses its text. The failure mode of a loader that
 * forgot to cite a row is a source with no words attached, not a body shipped to
 * a vendor on the strength of a field nobody checked.
 */
export const UNRESOLVED_CITATION: SourceCitation = {
  ref: { tenant: "unknown", provider: "unknown", externalId: "unknown" },
  assertion: "PROJECTION",
  versionAt: "1970-01-01T00:00:00.000Z",
  observedAt: "1970-01-01T00:00:00.000Z",
  state: "ACCESS_LOST",
  href: null,
}

export function citationOf(value: unknown): SourceCitation {
  try {
    return parseSourceCitation(value)
  } catch {
    return UNRESOLVED_CITATION
  }
}

// ── what the model is told about its citations (WRK-GATE-070) ────────────────

/**
 * The system-prompt paragraph that gives `citationLabel` its meaning.
 *
 * Beside the label for the reason `untrustedContentRules` is beside
 * `fenceUntrusted`: a prompt describing a marker the renderer stopped emitting is
 * a control that has quietly become a comment. Both surfaces that build a source
 * block — `/api/ai/chat` and `synthesizeAnswer` in `lib/ai.ts` — include this, so
 * the two cannot disagree about what a numbered source means.
 *
 * It states the §3.5 and §9.3 obligations that only the model can carry:
 *
 *   * A `STALE` source may be used and must be reported as out of date, with its
 *     version time. §3.5 asks that freshness be SHOWN, and the failure it names
 *     is answering "as though a stale source is current" — not answering at all.
 *   * A source whose state is not answerable carries no text, and an answer must
 *     not fill the gap from anywhere else.
 *   * A claim not traceable to a numbered source is the model's own inference,
 *     and §9.3 requires the reader to be able to tell the two apart.
 *   * Cite only numbers that were offered. The route verifies this after the
 *     fact through `verifyCitations` and suppresses an answer that fabricates
 *     one — this paragraph is what makes the suppression rare rather than what
 *     makes it unnecessary.
 */
export function citationRules(): string {
  return (
    `CITATIONS. Each numbered source is prefixed with a platform-authored label ` +
    `[provider assertion · STATE · vVERSION-TIME]. Cite every claim with the source number in ` +
    `brackets, e.g. [1], and use only numbers that appear in the list you were given — an answer ` +
    `citing a number that was not offered is discarded and the reader sees nothing. A source ` +
    `labelled STALE was last changed before the freshness horizon: you may answer from it, and ` +
    `you must say in the answer that it may be out of date and give the version time from its ` +
    `label. A source labelled TOMBSTONED, QUARANTINED, ACCESS_LOST or CONFLICTED carries no text ` +
    `at all: say that it exists in that state and that it must be opened directly, and never ` +
    `supply its contents from anywhere else. Anything you state that is not traceable to a ` +
    `numbered source is your own inference and not a Tenure record — write "(inference)" in the ` +
    `sentence that makes it.`
  )
}
