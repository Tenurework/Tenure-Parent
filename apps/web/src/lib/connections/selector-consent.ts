import { createHash } from "node:crypto"

/**
 * WRK-020-005 — a live grant may not widen without new consent.
 *
 * ## The expansion this closes, and why it was silent
 *
 * The one grant this platform issues is the calendar feed: a signed URL a
 * student pastes into Outlook, Google or Apple Calendar, which then polls it
 * forever. `api/calendar/ics/[token]/route.ts` calls `loadScopedEvents` FRESHLY
 * on every poll, so the set of events the third party receives is whatever the
 * holder can see TODAY — not what they consented to share when they subscribed.
 * The moment the holder joins a second club or is seated in a second
 * organization, that third party starts receiving events nobody re-consented
 * to, with no audit row, no notification, and a 200 the calendar client
 * swallows as an ordinary poll.
 *
 * Nothing anywhere required re-consent. `grep -rn 'consent|reconsent'` across
 * `packages/provisioning`, `packages/identity`, `packages/authorization` and
 * `apps/web/src/lib` found only the PROVIDER-side scope check
 * (`providerActivation`, which is Microsoft's or Google's approval, not the
 * tenant's), and the schema has no Consent or Grant model of any kind.
 *
 * ## The pattern is borrowed, not invented
 *
 * `app/(app)/admin/payments/actions.ts` pins an exception approval to a
 * `decisionDigest` so that — in the schema's own words at
 * `prisma/schema.prisma:1205-1210` — "a later edit that changes the amounts
 * produces a different digest and needs a new approval rather than inheriting
 * the old one's authority". A widened selector is the same problem with a
 * different noun, so it gets the same mechanism: the digest of what was
 * consented to is embedded in the credential, and the reader recomputes it from
 * the live scope before serving anything.
 *
 * ## Digest, and also the ids
 *
 * A digest alone can say "different"; it cannot say "wider". `consentVerdict`
 * therefore compares the SETS and reports which organizations were added, which
 * is what lets the route serve the intersection rather than refusing outright —
 * a subscriber whose feed goes empty because they joined a club would file a
 * bug, and the safe answer is to keep giving them exactly what they agreed to.
 */

export interface CalendarSelector {
  /** The institution the feed is pinned to. */
  institutionId: string
  /** The organizations whose events the feed may carry. */
  organizationIds: readonly string[]
  /**
   * Whether the holder had institution-wide visibility — an OSE seat, which
   * `loadScopedEvents` honours by returning every event of the institution
   * rather than only the published ones.
   *
   * Part of the selector, not a detail beside it: gaining an OSE seat is the
   * largest expansion available on this platform, and a digest over club ids
   * alone would call it UNCHANGED. It is also what keeps the intersection
   * honest in the other direction — an OSE holder whose feed narrowed to
   * "published events only" would silently stop receiving the unpublished
   * events they had been receiving all term.
   */
  institutionWide: boolean
}

/**
 * `sha256` over the sorted, de-duplicated selector.
 *
 * Sorted and de-duplicated because the digest must answer "is this the same
 * SET", and `getUserContext` returns role rows in whatever order the planner
 * produced — two identical scopes that hashed differently would demand
 * re-consent on every poll, which trains people to ignore the prompt.
 *
 * The institution is included rather than assumed: moving a feed to a different
 * institution is the widest expansion there is, and a digest over club ids
 * alone would call it UNCHANGED whenever the club list happened to match.
 */
export function selectorDigest(selector: CalendarSelector): string {
  const organizationIds = [...new Set(selector.organizationIds)].sort()
  return createHash("sha256")
    .update(
      JSON.stringify({
        institutionId: selector.institutionId,
        organizationIds,
        institutionWide: selector.institutionWide,
      }),
    )
    .digest("hex")
}

export type ConsentOutcome =
  /** Exactly what was consented to. */
  | "UNCHANGED"
  /** A subset of it — the holder left a club. Never needs new consent. */
  | "NARROWED"
  /** Something is being shared that was not consented to. */
  | "EXPANDED"

export interface ConsentVerdict {
  outcome: ConsentOutcome
  /** Organizations in the live scope that the pinned consent does not cover. */
  addedOrganizationIds: readonly string[]
  /** Organizations that were consented to and are no longer in scope. */
  removedOrganizationIds: readonly string[]
}

/**
 * Compare what was consented to against what the live scope now is.
 *
 * A different institution is EXPANDED whatever the club lists say: the pinned
 * consent covers one tenant's events and nothing authorises another's. That is
 * checked first, so a token moved to a second institution cannot come back
 * NARROWED because it happens to name fewer clubs.
 */
export function consentVerdict(
  pinned: CalendarSelector,
  current: CalendarSelector,
): ConsentVerdict {
  const consented = new Set(pinned.organizationIds)
  const live = new Set(current.organizationIds)

  const addedOrganizationIds = [...live].filter((id) => !consented.has(id)).sort()
  const removedOrganizationIds = [...consented].filter((id) => !live.has(id)).sort()

  const gainedInstitutionWide = current.institutionWide && !pinned.institutionWide
  const lostInstitutionWide = pinned.institutionWide && !current.institutionWide

  if (current.institutionId !== pinned.institutionId) {
    return { outcome: "EXPANDED", addedOrganizationIds, removedOrganizationIds }
  }
  if (addedOrganizationIds.length > 0 || gainedInstitutionWide) {
    return { outcome: "EXPANDED", addedOrganizationIds, removedOrganizationIds }
  }
  if (removedOrganizationIds.length > 0 || lostInstitutionWide) {
    return { outcome: "NARROWED", addedOrganizationIds, removedOrganizationIds }
  }
  return { outcome: "UNCHANGED", addedOrganizationIds, removedOrganizationIds }
}

/**
 * The most this consent permits, expressed as a selector to filter a query by.
 *
 * The route serves `intersection(pinned, current)` on an EXPANDED verdict —
 * never more than was consented to, and never more than the holder may
 * currently see. Both halves matter: dropping the second would let a revoked
 * membership keep delivering through an old token, which is the failure the
 * revocation epoch exists to prevent.
 */
export function consentedIntersection(
  pinned: CalendarSelector,
  current: CalendarSelector,
): CalendarSelector {
  const live = new Set(current.organizationIds)
  return {
    institutionId: pinned.institutionId,
    organizationIds: [...new Set(pinned.organizationIds)].filter((id) => live.has(id)).sort(),
    institutionWide: pinned.institutionWide && current.institutionWide,
  }
}
