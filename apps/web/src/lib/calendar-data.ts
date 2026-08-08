import "server-only"
import { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import type { CalendarSelector } from "@/lib/connections/selector-consent"
import { getUserContext } from "@/lib/rbac"
import { institutionTimeZone } from "@/lib/institution-time"
import { expandOccurrences, parseRecurrenceRule } from "@/lib/calendar-recurrence"

export interface ScopedEvent {
  id: string
  title: string
  description: string | null
  startAt: Date
  endAt: Date
  venue: string | null
  status: string
  organizationId: string
  organizationName: string
  /** The seat that proposed it — drives edit rights (see canEditEvent). */
  ownerRoleId: string | null
  hardConflicts: number
  /**
   * WRK-060-005. The stored RFC 5545 rule, on the series master and nowhere
   * else. Non-null means "this row describes a series", which is exactly what
   * `eventsToICS` needs to decide whether to write an `RRULE:` line.
   *
   * Required rather than optional on purpose: an optional field is one every
   * construction site may silently omit, and `tsc` would never mention it.
   */
  recurrenceRule: string | null
  /**
   * `null` for a stored row; the series master's id for an occurrence this
   * module generated.
   *
   * The two readers use one predicate each and they are complements, which is
   * what keeps the feed and the grid describing the same meetings:
   *
   *   * `eventsToICS` emits `occurrenceOf === null` — the stored rows, with the
   *     rule attached. One VEVENT plus an RRULE is what a calendar client wants;
   *     sending it the expansion as well would double every meeting.
   *   * the week grid renders `recurrenceRule === null` — the non-recurring
   *     rows and the generated occurrences, which are the things that actually
   *     sit on a day at a time.
   */
  occurrenceOf: string | null
}

/**
 * The consented selector, as the same three-branch clause the visibility rule
 * above uses — built from what the holder AGREED to rather than from what they
 * can see now.
 *
 * Typed as `Prisma.EventWhereInput` rather than inferred: `status: "PUBLISHED"`
 * widens to `string` in a standalone literal and stops matching the generated
 * enum, which `tsc` reports as an unreadable error a hundred lines away.
 */
function consentClause(consented: CalendarSelector): Prisma.EventWhereInput {
  return {
    OR: [
      // Institution-wide visibility is an OSE seat. Only offered when the
      // consent carried one: a holder who has since GAINED one must not have
      // the whole institution published to their calendar client on the
      // strength of a URL minted before they had it.
      ...(consented.institutionWide ? [{ institutionId: consented.institutionId }] : []),
      { organizationId: { in: [...consented.organizationIds] } },
      // A club the holder never joined still reached them through this branch
      // at mint time, so it stays. Dropping it would make consent NARROW the
      // feed rather than pin it.
      { institutionId: consented.institutionId, status: "PUBLISHED" as const },
    ],
  }
}

/**
 * Every calendar event a user is allowed to see in a time range: their clubs'
 * events plus institution-published events. Shared by the calendar page and
 * the ICS subscription feed so both are scoped identically.
 *
 * A recurring event is returned TWICE over: once as the stored master row
 * (carrying `recurrenceRule`, at its own stored start, whether or not that
 * start is inside the range) and once per occurrence the rule places inside the
 * range. The master has to come back regardless of its start because a weekly
 * meeting that began in September is still a live series in November, and a
 * feed that dropped it would tell Outlook the club had stopped meeting.
 */
export async function loadScopedEvents(
  userId: string,
  from: Date,
  to: Date,
  opts?: {
    organizationId?: string
    mineOnly?: boolean
    /**
     * WRK-020-005. The selector the FEED HOLDER consented to, when it is
     * narrower than what this user can currently see.
     *
     * Applied as a predicate in the query rather than as a filter over the
     * result, because the two are not the same: a club the viewer is not a
     * member of contributes events through the institution-published branch of
     * the OR above, and post-filtering by organization id would drop those
     * whether or not the consented institution still covers them. Narrowing the
     * query keeps "the consented institution's published events" and drops
     * "a club joined since the URL was issued", which is exactly the line
     * consent draws.
     */
    consented?: CalendarSelector
  }
): Promise<ScopedEvent[]> {
  const ctx = await getUserContext(userId)
  const oseInstitutionIds = ctx.institutionRoles.map((x) => x.institutionId)
  const memberOrgIds = ctx.orgRoles
    .filter((r) => r.status === "SHADOW" || r.status === "ACTIVE")
    .map((r) => r.organizationId)
  const memberInstitutions = memberOrgIds.length
    ? (
        await db.organization.findMany({
          where: { id: { in: memberOrgIds } },
          select: { institutionId: true },
        })
      ).map((o) => o.institutionId)
    : []

  const events = await db.event.findMany({
    where: {
      status: { not: "CANCELLED" },
      AND: [
        {
          OR: [
            // A one-off, or a series whose master happens to start in range.
            { startAt: { gte: from, lt: to } },
            // A series that began before the range. Its occurrences are
            // expanded below; the rule decides whether any land in the window,
            // and a rule this codebase cannot parse contributes nothing.
            { recurrenceRule: { not: null }, startAt: { lt: to } },
          ],
        },
        {
          OR: [
            { institutionId: { in: oseInstitutionIds } },
            { organizationId: { in: memberOrgIds } },
            { institutionId: { in: memberInstitutions }, status: "PUBLISHED" },
          ],
        },
        // WRK-020-005. The SAME visibility clause, rebuilt from the selector the
        // holder consented to, and ANDed with the live one: the feed carries the
        // intersection, so consent may only ever take rows away. Written as a
        // mirror of the three branches above rather than as a simpler
        // organization filter, because the branches are not interchangeable — an
        // OSE holder sees unpublished institution events, and a club they have
        // never joined still reaches them through the published branch. A filter
        // that only compared organization ids would have quietly stopped
        // delivering both.
        ...(opts?.consented ? [consentClause(opts.consented)] : []),
      ],
      // Optional viewer filters: one specific club, and/or only events this user
      // proposed (the linked approval was submitted by them).
      ...(opts?.organizationId ? { organizationId: opts.organizationId } : {}),
      ...(opts?.mineOnly ? { approval: { submittedById: userId } } : {}),
    },
    orderBy: { startAt: "asc" },
    include: {
      organization: { select: { name: true } },
      conflicts: { where: { severity: "HARD", resolved: false }, select: { id: true } },
    },
  })

  const rows: ScopedEvent[] = []
  for (const e of events) {
    const stored: ScopedEvent = {
      id: e.id,
      title: e.title,
      description: e.description,
      startAt: e.startAt,
      endAt: e.endAt,
      venue: e.venue,
      status: e.status,
      organizationId: e.organizationId,
      organizationName: e.organization.name,
      ownerRoleId: e.ownerRoleId,
      hardConflicts: e.conflicts.length,
      recurrenceRule: null,
      occurrenceOf: null,
    }

    const rule = parseRecurrenceRule(e.recurrenceRule)
    if (!rule) {
      // Includes a stored rule this parser refuses. The event still appears at
      // its own time — dropping it because its repeat rule is unreadable would
      // hide a meeting that definitely happens once.
      rows.push(stored)
      continue
    }

    rows.push({ ...stored, recurrenceRule: e.recurrenceRule })

    // The institution's zone, not the server's and not `Event.timezone`: every
    // other reader in this application resolves a wall clock through
    // `institution-time.ts`, and a 6pm meeting that becomes 5pm on the far side
    // of a daylight-saving boundary is what a second answer would produce.
    const timeZone = await institutionTimeZone(e.institutionId)
    for (const occurrence of expandOccurrences({
      start: e.startAt,
      end: e.endAt,
      rule,
      timeZone,
      windowStart: from,
      windowEnd: to,
    })) {
      rows.push({
        ...stored,
        // Distinct from the master's id so React keys and the grid's optimistic
        // override map do not collapse a daily series into one chip. The
        // inspector route splits this back apart, so opening an occurrence
        // still loads the real event.
        id: occurrenceId(e.id, occurrence.startAt),
        startAt: occurrence.startAt,
        endAt: occurrence.endAt,
        occurrenceOf: e.id,
      })
    }
  }

  rows.sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
  return rows
}

/** The separator between a series master's id and one occurrence's start. */
const OCCURRENCE_SEPARATOR = "~"

/**
 * A generated occurrence's identifier: the master's id, its start, one string.
 *
 * `~` is unreserved in RFC 3986 so this needs no escaping in the feed URL or in
 * the inspector's fetch path, and a cuid never contains one — so
 * `eventIdOfOccurrence` can undo it without ambiguity.
 */
function occurrenceId(masterId: string, startAt: Date): string {
  return `${masterId}${OCCURRENCE_SEPARATOR}${startAt.getTime()}`
}

/**
 * The stored event behind a grid identifier.
 *
 * `apps/web/src/app/api/calendar/event/[id]/route.ts` calls this so clicking
 * the third Tuesday of a weekly series opens the series' own record rather than
 * 404ing on an id that names no row. Returns the input unchanged for a plain
 * event id, which is every non-recurring chip.
 */
export function eventIdOfOccurrence(id: string): string {
  const at = id.indexOf(OCCURRENCE_SEPARATOR)
  return at === -1 ? id : id.slice(0, at)
}

/**
 * What a user's calendar feed would carry right now (WRK-020-005).
 *
 * Derived from the SAME `getUserContext` rows `loadScopedEvents` builds its
 * visibility clause from, so the digest the calendar page pins and the scope
 * the feed serves cannot describe different things. Deriving it from anything
 * else — a stored preference, a second query — is how a consent record comes to
 * disagree with what is actually being shared.
 *
 * `institutionId` is a parameter rather than a lookup: both callers are already
 * inside a tenant scope and hold it, and a feed pinned to one institution must
 * not have its selector computed against another.
 */
export async function calendarSelectorFor(
  userId: string,
  institutionId: string,
): Promise<{ institutionId: string; organizationIds: string[]; institutionWide: boolean }> {
  const ctx = await getUserContext(userId)
  const memberOrgIds = [
    ...new Set(
      ctx.orgRoles
        .filter((r) => r.status === "SHADOW" || r.status === "ACTIVE")
        .map((r) => r.organizationId),
    ),
  ]

  // Only the clubs that belong to THIS institution: a person seated at two
  // institutions has two feeds, and one feed's selector must not name the
  // other's clubs — the digest would then change whenever the unrelated
  // institution's memberships changed, demanding re-consent for nothing.
  const orgs = memberOrgIds.length
    ? await db.organization.findMany({
        where: { id: { in: memberOrgIds }, institutionId },
        select: { id: true },
      })
    : []

  return {
    institutionId,
    organizationIds: orgs.map((o) => o.id).sort(),
    institutionWide: ctx.institutionRoles.some((m) => m.institutionId === institutionId),
  }
}

/**
 * The revocation counter for a user's calendar feed token (WRK-030-006).
 *
 * `User` is PLATFORM_GLOBAL in `src/lib/tenancy/registry.ts`, so the query
 * layer applies no tenant predicate and this is legitimately callable before a
 * tenant scope is open — which it has to be, because the ICS route resolves the
 * tenant FROM the token it is about to check against this number.
 *
 * `null` means no such user, which the route treats exactly like a bad
 * signature: a token naming an account that no longer exists must not be a 200.
 */
export async function calendarTokenEpochFor(userId: string): Promise<number | null> {
  const row = await db.user.findUnique({
    where: { id: userId },
    select: { calendarTokenEpoch: true },
  })
  return row?.calendarTokenEpoch ?? null
}
