import { NextResponse } from "next/server"
import {
  calendarTokenSubject,
  verifyCalendarToken,
  eventsToICS,
} from "@/lib/calendar-sync"
import {
  calendarSelectorFor,
  calendarTokenEpochFor,
  loadScopedEvents,
} from "@/lib/calendar-data"
import {
  consentVerdict,
  consentedIntersection,
  selectorDigest,
} from "@/lib/connections/selector-consent"
import { withTenantScope } from "@/lib/tenant-scope"
import { TenantContextError } from "@/lib/tenancy/context"

/**
 * Per-user ICS subscription feed. Outlook / Google / Apple Calendar poll this
 * URL to keep a student's school calendar up to date from Tenure — one way,
 * out. Authenticated by the signed token in the path, because a calendar client
 * cannot send a cookie, so it needs no session.
 *
 * WRK-030-006. Three refusals live here and all three used to be missing:
 *
 *   1. The token is checked against the holder's CURRENT revocation counter, so
 *      bumping `User.calendarTokenEpoch` kills every URL already handed out.
 *   2. The scope is pinned to the institution NAMED IN THE TOKEN. Before, this
 *      called `withTenantScope(userId, fn)` with no institution, which falls
 *      through to `actingInstitutionChoice(userId)` — so the same feed URL
 *      started serving a different institution's events the moment the holder
 *      used the tenant switcher, and a calendar client would have swallowed it
 *      as a normal poll. `resolveTenantScope` still re-proves the membership, so
 *      a token naming an institution the user has left is refused there.
 *   3. `cache-control` is `private, no-store`. It was `public, max-age=1800` on
 *      a per-user private feed, which authorises a CDN or any shared proxy to
 *      keep one student's calendar and hand it to the next request for the same
 *      path prefix.
 */
export const dynamic = "force-dynamic"

const DAY = 86_400_000

/** Every refusal is the same answer — see `verifyCalendarToken`. */
function refuse() {
  return new NextResponse("Invalid calendar token", {
    status: 403,
    headers: { "cache-control": "private, no-store" },
  })
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const presented = token.replace(/\.ics$/i, "")

  // Unverified — it only chooses which revocation counter to check against.
  const subject = calendarTokenSubject(presented)
  if (!subject) return refuse()

  const epoch = await calendarTokenEpochFor(subject)
  // A token naming an account that no longer exists is not a 200.
  if (epoch === null) return refuse()

  const claims = verifyCalendarToken(presented, epoch)
  if (!claims) return refuse()

  // `resolveTenantScope` throws when the holder no longer belongs to the
  // institution the token names — a revoked staffer's subscription, or a forged
  // institution field. That is a refusal, not a server fault, so it answers 403
  // like every other bad token rather than a 500 a monitor would page on.
  try {
    return await withTenantScope(
      claims.userId,
      async () => {
        const now = new Date()

        // WRK-020-005. What the holder can see TODAY, against what they
        // consented to share when the URL was minted. `loadScopedEvents` runs
        // freshly on every poll, so without this comparison joining a second
        // club silently began publishing that club's events to whichever third
        // party holds the URL — no audit row, no notification, a 200 the
        // calendar client swallows as an ordinary poll.
        const live = await calendarSelectorFor(claims.userId, claims.institutionId)

        // The digest is the fast, total comparison — the same "is this still
        // the thing that was approved" test `admin/payments/actions.ts` makes
        // before money moves. `consentVerdict` then says WHICH WAY it moved,
        // which a digest cannot: serving the intersection rather than refusing
        // is deliberate, because a subscriber whose feed went empty because they
        // joined a club would report a bug, and the safe answer is to keep
        // giving them exactly what they agreed to.
        const verdict =
          selectorDigest(live) === claims.selectorDigest
            ? { outcome: "UNCHANGED" as const }
            : consentVerdict(claims.selector, live)

        const consented =
          verdict.outcome === "EXPANDED"
            ? consentedIntersection(claims.selector, live)
            : undefined

        const events = await loadScopedEvents(
          claims.userId,
          new Date(now.getTime() - 30 * DAY),
          new Date(now.getTime() + 180 * DAY),
          consented ? { consented } : undefined
        )

        const description =
          verdict.outcome === "EXPANDED"
            ? "Your Tenure access has widened since this subscription was created. This feed is " +
              "still limited to what you agreed to share. Open Tenure > Calendar > Subscribe to " +
              "issue a new link that includes everything."
            : undefined

        return new NextResponse(eventsToICS(events, "Tenure", description), {
          headers: {
            "content-type": "text/calendar; charset=utf-8",
            "content-disposition": 'inline; filename="tenure.ics"',
            "cache-control": "private, no-store",
            // A calendar client shows X-WR-CALDESC; a person or a script
            // inspecting the response finds the same answer here. RFC 8288
            // `rel="related"` — the page that re-issues the URL.
            ...(verdict.outcome === "EXPANDED"
              ? { link: '</calendar>; rel="related"; title="Re-subscribe with your current access"' }
              : {}),
          },
        })
      },
      { institutionId: claims.institutionId }
    )
  } catch (error) {
    if (error instanceof TenantContextError) return refuse()
    throw error
  }
}
