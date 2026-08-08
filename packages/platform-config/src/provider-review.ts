/**
 * WRK-040-003 — the PROVIDER's side of an integration, as an activation gate.
 *
 * Everything in `@tenure/provisioning/catalogs.ts` models *Tenure's* opinion of
 * a connector: did we review it, is the review dated, has it lapsed. None of it
 * says whether the provider on the other end has approved anything. Those are
 * different facts and only one of them was ever recorded, so a connector could
 * be Tenure-certified while asking Google for a restricted scope nobody at
 * Google had ever approved, and nothing in the code could tell.
 *
 * ## Why this lives in platform-config and not with the catalogs
 *
 * The same reason `model-policy.ts` does, in the same words: which egress a
 * cell may actually make is POLICY the engine distributes TO a cell, and the
 * cell has to read it at request time. `apps/web/src/app/api/ai/chat/route.ts`
 * is the request path that must consult it, and a cell importing
 * `@tenure/provisioning` is what `tests/security/cell-independence.test.mjs`
 * correctly refuses. `@tenure/provisioning` imports these types and attaches
 * them to `ConnectorEntry`, so there is one definition and two importers —
 * exactly the arrangement `ModelEntry` already has.
 *
 * ## Absent is refused, not assumed
 *
 * `providerActivation` returns `provider-review-missing` for a connector with
 * no review record at all. An integration whose provider-side status nobody
 * wrote down is not one somebody checked and found fine; it is one nobody
 * asked about, and those must not render identically.
 */

/**
 * Where a provider-side review stands.
 *
 * Named for what the provider did, not for what Tenure wants. `NOT_SUBMITTED`
 * and `REJECTED` are both "not approved" and are deliberately separate: one is
 * work nobody has started and the other is an answer somebody has given.
 */
export type ProviderReviewState =
  /** Nobody has asked the provider. */
  | "NOT_SUBMITTED"
  /** Submitted; the provider has not answered. */
  | "IN_REVIEW"
  /** Approved, for the scopes in `approvedScopes`, until `expiresAt`. */
  | "APPROVED"
  /** The provider said no. */
  | "REJECTED"
  /** Approved once and lapsed. */
  | "EXPIRED"

export interface ProviderReview {
  /**
   * The provider's own programme, by its name — "Google OAuth app
   * verification", "Microsoft Publisher Verification", "Slack app directory".
   * A review with no programme is a claim about nothing in particular.
   */
  program: string
  state: ProviderReviewState
  /**
   * The scopes the provider actually approved. Empty is meaningful: an
   * approval that names no scope approves nothing.
   */
  approvedScopes: readonly string[]
  /** When the provider granted it. `null` when they have not. */
  verifiedAt: string | null
  /**
   * When the grant lapses. `null` means the provider stated no end — which is
   * a claim about their programme, not an absence of one.
   */
  expiresAt: string | null
}

export type ProviderActivationReason =
  /** Approved, current, and covering every scope this integration asks for. */
  | "activated"
  /** No review record, or one that is not `APPROVED`. */
  | "provider-review-missing"
  /** Approved once; the grant has lapsed and nobody renewed it. */
  | "provider-review-expired"
  /** Approved, and this integration asks for more than the approval covers. */
  | "scopes-exceed-provider-approval"

/**
 * A discriminated union rather than a struct with a boolean and a string.
 *
 * `activated: false` narrows `reason` to the three refusals, so a caller
 * mapping it onto its own vocabulary — `isUsable` in `@tenure/provisioning`
 * does exactly that — cannot be handed `"activated"` in a refusal branch and
 * has no reason to re-derive the mapping with a chain of comparisons that could
 * disagree with this one.
 */
export type ProviderActivationVerdict =
  | {
      activated: true
      reason: "activated"
      detail: string
      unapprovedScopes: readonly string[]
    }
  | {
      activated: false
      reason: Exclude<ProviderActivationReason, "activated">
      /**
       * What to tell a person. Carries the exact scopes or the exact review
       * state, because "not activated" alone sends an operator to the wrong
       * console.
       */
      detail: string
      /** Scopes asked for that the approval does not cover. */
      unapprovedScopes: readonly string[]
    }

/**
 * Whether the provider has authorised this integration, at this instant.
 *
 * `now` is a parameter rather than a clock read for the same reason the
 * certification gate takes one: "was this activated when we shipped it?" is a
 * question an audit asks, and a gate that reads `Date.now()` cannot answer it.
 *
 * The scope check is a subset test and it runs AFTER the approval check on
 * purpose — an unapproved integration asking for one scope and an unapproved
 * integration asking for twelve are the same problem, and reporting the scope
 * difference first would read as "narrow the request and it will work".
 */
export function providerActivation(
  requestedScopes: readonly string[],
  review: ProviderReview | undefined,
  now: string,
): ProviderActivationVerdict {
  if (!review) {
    return {
      activated: false,
      reason: "provider-review-missing",
      detail:
        "No provider-side review is recorded for this integration, so nothing says the provider " +
        "has authorised it. An unrecorded review is not a passed one.",
      unapprovedScopes: requestedScopes,
    }
  }

  if (review.state !== "APPROVED") {
    return {
      activated: false,
      reason: review.state === "EXPIRED" ? "provider-review-expired" : "provider-review-missing",
      detail: `${review.program} is ${review.state}, not APPROVED.`,
      unapprovedScopes: requestedScopes,
    }
  }

  if (review.expiresAt !== null) {
    const expires = Date.parse(review.expiresAt)
    const at = Date.parse(now)
    // Fails closed on either date being unreadable: an approval whose end
    // nobody can read is one nobody can renew on time.
    if (Number.isNaN(expires) || Number.isNaN(at) || at >= expires) {
      return {
        activated: false,
        reason: "provider-review-expired",
        detail: `${review.program} approval expired at ${review.expiresAt}.`,
        unapprovedScopes: requestedScopes,
      }
    }
  }

  const approved = new Set(review.approvedScopes)
  const unapprovedScopes = requestedScopes.filter((s) => !approved.has(s))
  if (unapprovedScopes.length > 0) {
    return {
      activated: false,
      reason: "scopes-exceed-provider-approval",
      detail:
        `${review.program} approved ${review.approvedScopes.join(", ") || "no scopes"}, and this ` +
        `integration asks for ${unapprovedScopes.join(", ")}.`,
      unapprovedScopes,
    }
  }

  return {
    activated: true,
    reason: "activated",
    detail: `${review.program} approved every requested scope.`,
    unapprovedScopes: [],
  }
}

/**
 * The one outbound integration this application actually makes.
 *
 * `apps/web/src/lib/ai.ts` posts to `api.anthropic.com/v1/messages`. That is
 * the whole of it: one API, one operation, one direction.
 */
export const RELAY_ANTHROPIC_SCOPES: readonly string[] = ["anthropic:messages.create"]

/**
 * The honest record, which is that there is no record.
 *
 * Nobody has submitted this integration to any Anthropic review programme, and
 * no approved-scope list signed by the provider exists anywhere in this
 * repository. Writing `APPROVED` here because the application has an API key
 * would be the "remove or relabel false Available claims" failure — a key is a
 * credential, not a review, and the difference is exactly what this gate is for.
 *
 * The consequence is deliberate and is stated at the call site: with this
 * record, `/api/ai/chat` reports `connectorRefusal` and does not call the
 * vendor. When somebody performs and records a provider-side review, the state,
 * the scopes and the dates go here and the route starts answering again.
 */
export const RELAY_ANTHROPIC_REVIEW: ProviderReview = {
  program: "Anthropic API — provider-side review of the Tenure Relay integration",
  state: "NOT_SUBMITTED",
  approvedScopes: [],
  verifiedAt: null,
  expiresAt: null,
}

/* ─────────────────────────────────────────────────────── WRK-020-001 ──────
 * Bible §4.1's connection classes, on the record a cell can read.
 *
 * §4.1 names eight classes and then states the rule they exist for:
 * "Connection class, provider consent, and Tenure authorization must all
 * agree." Before this, `grep -rn 'USER_DELEGATED|APPLICATION_ORG_WIDE|
 * WEBHOOK_ONLY|connectionClass' apps packages` returned nothing outside the
 * Bible — a webhook-only grant and an org-wide application identity were the
 * same thing to every decision in the tree, so there was no place in this
 * codebase where the sentence "this connection may not do that" could be
 * written.
 *
 * ## Why the class lives beside the provider review and not in the catalogs
 *
 * The same reason `providerActivation` does, in the same words: what a cell may
 * do on a connection is POLICY the engine distributes TO the cell, and the cell
 * reads it at request time. `apps/web/src/lib/relay-tools.ts` is the request
 * path that consults it, and a cell importing `@tenure/provisioning` — where the
 * connector packs live — is what `tests/security/cell-independence.test.mjs`
 * correctly refuses.
 *
 * ## Why a separate record rather than a field on `ProviderReview`
 *
 * A review is what the PROVIDER said. A class is what TENURE granted. They are
 * different assertions by different parties about the same connection, and
 * §4.1's requirement that they "all agree" only means something if they are
 * recorded separately enough to be able to disagree. `CapabilityOffer` carries
 * both and names the module whose tool registrations the connection serves.
 */
export const CONNECTION_CLASSES = [
  "USER_DELEGATED",
  "ADMIN_DELEGATED",
  "APPLICATION_ORG_WIDE",
  "BOT_OR_APP_INSTALLATION",
  "SERVICE_ACCOUNT",
  "WEBHOOK_ONLY",
  "FILE_OR_FEED",
  "PERSONAL_PRODUCTIVITY",
] as const

export type ConnectionClass = (typeof CONNECTION_CLASSES)[number]

export function isConnectionClass(value: unknown): value is ConnectionClass {
  return typeof value === "string" && (CONNECTION_CLASSES as readonly string[]).includes(value)
}

/** What a module's tool registrations are offered under. */
export interface CapabilityOffer {
  /** The module key whose registrations this connection serves. */
  module: string
  /** What Tenure granted: a §4.1 class. */
  connectionClass: ConnectionClass
  /** What the provider said about the same connection. */
  review: ProviderReview
}

/**
 * The connections this platform actually has, and what each is offered under.
 *
 * One entry, because there is one: the `search` module's registrations are
 * answered from this platform's own store and their results are carried to
 * `api.anthropic.com` under the application's own key. Nobody consents per user
 * and no administrator is asked per tenant, which is precisely
 * `APPLICATION_ORG_WIDE` — "service/app identity accesses approved organization
 * data" — and writing it down is what lets the escalation gate refuse a tool
 * that would exceed it.
 *
 * A module ABSENT from this list is not served by a connection at all; see
 * `connectionClassFor`.
 */
export const RELAY_CAPABILITY_OFFERS: readonly CapabilityOffer[] = [
  {
    module: "search",
    connectionClass: "APPLICATION_ORG_WIDE",
    review: RELAY_ANTHROPIC_REVIEW,
  },
]

/**
 * The class a module's tools are offered under, or `null` when no connection
 * serves them.
 *
 * `null` is NOT a refusal and that is a deliberate, narrow decision: a module
 * with no offer is answered entirely from this platform's own store, under
 * Tenure authorization alone, and §4.1's "class, consent and authorization must
 * agree" has nothing to disagree with when there is no third party. Making the
 * absence refuse would take every tool on the platform off the air to enforce a
 * contract no module has been given yet — the same wrong order `cell-context.ts`
 * describes for its unresolved fields.
 */
export function connectionClassFor(moduleKey: string): ConnectionClass | null {
  return RELAY_CAPABILITY_OFFERS.find((o) => o.module === moduleKey)?.connectionClass ?? null
}

/**
 * WRK-GATE-080 — what a two-way Outlook calendar sync would have to ask for.
 *
 * `Calendars.ReadWrite` is the Microsoft Graph permission that "edits made in
 * Outlook flow back into Tenure" requires: reading a user's calendar is
 * `Calendars.Read`, and writing Tenure's changes into it needs the write half
 * as well. The scope is written down here — rather than left implicit in a
 * connector nobody has built — so the gate below has something concrete to
 * compare an approval against. An integration that cannot name the scope it
 * wants cannot be told it is asking for too much.
 *
 * Declared in `@tenure/platform-config` and not in `@tenure/provisioning` for
 * the reason the header states: `apps/web` is a cell, and
 * `tests/security/cell-independence.test.mjs` refuses a cell that imports the
 * engine's control plane. The calendar page and the subscribe dialog are the
 * surfaces that must not overstate, so the fact they read has to live somewhere
 * they are allowed to read it from.
 */
export const GRAPH_CALENDAR_SCOPES: readonly string[] = ["microsoft:Calendars.ReadWrite"]

/**
 * The honest record, which is again that there is no record.
 *
 * No Microsoft Graph calendar connector exists in this repository — no app
 * registration, no token exchange, no `graph.microsoft.com` call site — and
 * nobody has submitted anything to Microsoft Publisher Verification or to any
 * other Microsoft review programme. `NOT_SUBMITTED` is therefore the only state
 * that is true. Writing `APPROVED` because a tenant administrator could in
 * principle consent to the scope would be the same mistake `RELAY_ANTHROPIC_REVIEW`
 * refuses one paragraph above: a credential is not a review, and a consent
 * dialog somebody has not opened is not a credential either.
 *
 * The consequence is stated at the call sites and is the point of the record:
 * `providerActivation(GRAPH_CALENDAR_SCOPES, GRAPH_CALENDAR_REVIEW, now)`
 * returns `provider-review-missing`, so `apps/web/src/components/CalendarSubscribe.tsx`
 * and `apps/web/src/app/(app)/calendar/page.tsx` render "publish-only feed"
 * copy and promise no future. The day somebody performs and records the review,
 * the state, the scopes and the dates go here and the sentence a student reads
 * changes by itself — which is why the sentence is a lookup and not a literal.
 */
export const GRAPH_CALENDAR_REVIEW: ProviderReview = {
  program: "Microsoft Publisher Verification — Graph calendar (Calendars.ReadWrite)",
  // NOT_SUBMITTED, which is what the twenty lines above argue it must be, and
  // what four tests across three packages assert.
  //
  // This shipped as `APPROVED` with a scope list and a pair of dates, in the
  // same commit as the paragraph explaining that writing `APPROVED` here would
  // be a mistake. Nothing was reviewed: there is still no app registration, no
  // token exchange and no `graph.microsoft.com` call site in this repository,
  // so the record described a Microsoft Publisher Verification that nobody
  // submitted and a verification date in the past that nobody holds.
  //
  // It is not a typo, it is the one thing §0.3 forbids outright — an agent
  // standing in for a human approval. And it was load-bearing: `APPROVED` makes
  // `providerActivation` return activated, which turns the student-facing
  // sentence back into a two-way-sync promise and lets `governedDeepLink` emit
  // Outlook URLs Tenure has no basis to vouch for.
  state: "NOT_SUBMITTED",
  approvedScopes: [],
  // Null, exactly as `RELAY_ANTHROPIC_REVIEW` above — the type requires both,
  // and "when the provider granted it" has no honest answer while nobody has
  // asked them. The dates it shipped with, 2026-07-01 to 2027-07-01, described
  // a verification window that does not exist.
  verifiedAt: null,
  expiresAt: null,
}

/**
 * The one sentence about calendar sync that any surface may render.
 *
 * A function rather than a constant so the copy is DERIVED from the gate on
 * every render: flipping `GRAPH_CALENDAR_REVIEW` to `APPROVED` changes what a
 * student reads without anybody editing a component, and — the direction that
 * actually matters — nobody can leave an approving sentence behind after the
 * approval lapses, because there is no approving sentence written down to
 * leave behind.
 *
 * `now` is threaded through rather than read here for the same reason
 * `providerActivation` takes it: an expiry that depends on a clock read inside
 * the helper cannot be tested at a chosen instant.
 */
export function calendarSyncSentence(now: string): {
  activated: boolean
  reason: ProviderActivationReason
  sentence: string
} {
  const verdict = providerActivation(GRAPH_CALENDAR_SCOPES, GRAPH_CALENDAR_REVIEW, now)
  return {
    activated: verdict.activated,
    reason: verdict.reason,
    sentence: verdict.activated
      ? "Changes you make in your calendar app are written back to Tenure."
      : "This feed publishes one way. Tenure sends your events out to your calendar app; " +
        "anything you change there stays there and never reaches Tenure. " +
        verdict.detail,
  }
}
