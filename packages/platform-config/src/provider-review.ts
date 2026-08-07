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
