import Link from "next/link"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { Plus, ChevronLeft, ChevronRight } from "@/components/ui/icons"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { getUserContext, isOse } from "@/lib/rbac"
import { withTenantScope } from "@/lib/tenant-scope"
import {
  calendarSelectorFor,
  calendarTokenEpochFor,
  loadScopedEvents,
} from "@/lib/calendar-data"
import { calendarToken } from "@/lib/calendar-sync"
import { selectorDigest } from "@/lib/connections/selector-consent"
import { recordAuditEvent, seatFor } from "@/lib/audit-record"
import { calendarSyncSentence } from "@tenure/platform-config"
import { canEditEvent } from "@/lib/calendar-write"
import { viewerTimeZone } from "@/lib/institution-time"
import {
  addDaysToKey,
  dateKeyInZone,
  formatDateKey,
  startOfDayInZone,
  startOfWeekKey,
  todayKeyInZone,
  zoneAbbreviation,
} from "@/lib/time"
import {
  CalendarTimeGrid,
  type AllDayItem,
  type TimeGridEvent,
} from "@/components/CalendarTimeGrid"
import { CalendarMiniMonth } from "@/components/CalendarMiniMonth"
import { CalendarSubscribe } from "@/components/CalendarSubscribe"
import { CalendarFilters } from "@/components/CalendarFilters"
import { clubSwatch } from "@/lib/calendar-color"
import { PageHeader } from "@/components/ui/PageHeader"

export const dynamic = "force-dynamic"

/**
 * WRK-020-005 — the re-consent receipt.
 *
 * A calendar feed URL is a standing grant: a third party polls it forever and
 * receives whatever the holder can see at the moment of the poll. The token now
 * pins the selector, so a widened scope serves the intersection rather than the
 * new set — and this is the other half, the act by which a person adopts the
 * wider scope and the record that they did.
 *
 * The digest arrives in the form rather than being recomputed and trusted, for
 * the reason `app/(app)/admin/payments/actions.ts` pins an approval to a
 * `decisionDigest`: consent is to what was on screen. If the scope moved
 * between the render and the click, this records a DENY naming both digests
 * instead of a consent to something nobody was shown.
 *
 * Written through `recordAuditEvent`, never `db.auditEvent.create` — so the row
 * is validated, seated and hash-chained like every other privileged decision
 * (`tests/security/audit-writes.test.mjs` ratchets the raw writers downward).
 */
async function confirmCalendarConsent(formData: FormData) {
  "use server"

  const session = await auth()
  if (!session?.user?.id) redirect("/signin")
  const userId = session.user.id
  const rendered = String(formData.get("digest") ?? "")

  await withTenantScope(userId, async (scope) => {
    const selector = await calendarSelectorFor(userId, scope.institutionId)
    const current = selectorDigest(selector)
    const ctx = await getUserContext(userId)
    const agrees = current === rendered

    await recordAuditEvent({
      institutionId: scope.institutionId,
      actor: { principalId: userId },
      seat: seatFor(ctx, { institutionId: scope.institutionId }),
      action: "CalendarFeed.SelectorConsented",
      resourceType: "CalendarFeed",
      resourceId: userId,
      outcome: agrees ? "ALLOW" : "DENY",
      reason: agrees
        ? undefined
        : "the scope changed between rendering the page and confirming it, so this confirms nothing",
      metadata: {
        selectorDigest: current,
        confirmedDigest: rendered,
        organizationIds: selector.organizationIds,
        institutionWide: selector.institutionWide,
      },
    })
  })

  // The page mints a fresh token on every render, so re-rendering is what puts
  // the newly-consented URL in front of the person who just confirmed it.
  revalidatePath("/calendar")
}

/**
 * The Tenure calendar — one view: the week.
 *
 * Month, Day and Agenda were removed deliberately. A student board runs on a
 * weekly rhythm (meetings, room bookings, the 3-week event lead time), and four
 * competing views meant four layouts to keep correct, four sets of URL state,
 * and an officer landing on whichever one they last used. One view is one
 * contract: the week grid is the calendar, everywhere, for every role.
 *
 * Legacy `?view=` and `?m=` links are still honoured — they resolve to the week
 * containing the date they asked for rather than 404ing.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; view?: string; d?: string; club?: string; mine?: string }>
}) {
  const { m, d, club, mine } = await searchParams
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")
  const userId = session.user.id

  return withTenantScope(userId, async (scope) => {
    const ctx = await getUserContext(userId)
    // The tenant is passed in, not derived: `viewerTimeZone` is React.cache()d
    // and reads a TENANT_SCOPED Organization, so the memo key has to carry the
    // tenant or the first scope opened in this request answers for every later
    // one. See the invariant beside `runInTenantScope`.
    const timeZone = await viewerTimeZone(userId, scope.institutionId)
    const canCreate = ctx.orgRoles.some((r) => r.status === "ACTIVE")

    // Per-viewer filters: narrow to one club and/or only events the user proposed.
    const mineOnly = mine === "1"
    const memberOrgIds = [
      ...new Set(
        ctx.orgRoles.filter((r) => r.status === "ACTIVE" || r.status === "SHADOW").map((r) => r.organizationId)
      ),
    ]

    // WRK-030-006. The token names the tenant it was minted in and carries the
    // holder's revocation counter, so the feed cannot follow a later switch into
    // another institution and a bumped counter kills every URL already issued.
    // WRK-020-005. It also pins the selector the holder is consenting to at the
    // moment they copy the URL, which is why this is minted AFTER `memberOrgIds`
    // is resolved rather than from the user id alone.
    //
    // The selector is read by `calendarSelectorFor`, which derives it from the
    // SAME `getUserContext` rows `loadScopedEvents` builds its visibility clause
    // from. Building it inline here from `memberOrgIds` would be a second answer
    // to "what does this feed carry", and the two would disagree the first time
    // either changed — the consent record would then pin a scope the feed does
    // not actually serve.
    const consentedSelector = await calendarSelectorFor(userId, scope.institutionId)
    const feedPath = `/api/calendar/ics/${calendarToken(
      userId,
      scope.institutionId,
      (await calendarTokenEpochFor(userId)) ?? 0,
      consentedSelector
    )}`
    // WRK-GATE-080. What the page may say about calendar sync is DERIVED from
    // the provider-side review record, never written here. Today that record is
    // NOT_SUBMITTED, so this resolves to the publish-only sentence; the day
    // somebody records a real Microsoft review it changes by itself.
    const sync = calendarSyncSentence(new Date().toISOString())
    const clubOptions = (
      await db.organization.findMany({
        where: ctx.institutionRoles.length
          ? { institutionId: { in: ctx.institutionRoles.map((x) => x.institutionId) }, status: "ACTIVE" }
          : { id: { in: memberOrgIds } },
        select: { id: true, name: true, shortName: true },
        orderBy: { name: "asc" },
      })
    ).map((c) => ({ id: c.id, name: c.shortName ?? c.name }))
    const clubFilter = club && clubOptions.some((c) => c.id === club) ? club : undefined
    const eventOpts = { organizationId: clubFilter, mineOnly }

    // Keep the active filters on every internal calendar link.
    const filterQs = (() => {
      const p = new URLSearchParams()
      if (clubFilter) p.set("club", clubFilter)
      if (mineOnly) p.set("mine", "1")
      return p.toString()
    })()
    const withFilters = (base: string) =>
      filterQs ? `${base}${base.includes("?") ? "&" : "?"}${filterQs}` : base

    // ── Which week? ───────────────────────────────────────────────────────────
    // `d` may be absent, repeated (string[]), or well-formed but impossible
    // (2026-13-40). `startOfDayInZone` returns null for anything it cannot
    // resolve, so a crafted or shared URL falls back to this week instead of
    // rendering an Invalid Date. `?m=YYYY-MM` from an old month link lands on the
    // first week of that month.
    const todayKey = todayKeyInZone(timeZone)
    const requestedKey =
      typeof d === "string" && startOfDayInZone(d, timeZone)
        ? d
        : typeof m === "string" && /^\d{4}-\d{2}$/.test(m)
          ? `${m}-01`
          : todayKey

    const weekStartKey = startOfWeekKey(requestedKey)
    const weekEndKey = addDaysToKey(weekStartKey, 6)
    const rangeStart = startOfDayInZone(weekStartKey, timeZone)!
    const rangeEnd = startOfDayInZone(addDaysToKey(weekStartKey, 7), timeZone)!

    const events = await loadScopedEvents(userId, rangeStart, rangeEnd, eventOpts)

    const days = Array.from({ length: 7 }, (_, i) => {
      const key = addDaysToKey(weekStartKey, i)
      return {
        date: key,
        weekday: formatDateKey(key, { weekday: "short" }),
        dayNum: Number(key.slice(8, 10)),
        isToday: key === todayKey,
      }
    })

    // Edit rights are resolved server-side, per event, against the event's real
    // institution — an OSE viewer's authority is institution-wide rather than
    // tied to a club seat, so the owning institution has to be known first. The
    // grid never decides for itself who may drag what, and the reschedule API
    // re-checks the identical rule on every write.
    const orgInstitutions = new Map(
      (
        await db.organization.findMany({
          where: { id: { in: [...new Set(events.map((e) => e.organizationId))] } },
          select: { id: true, institutionId: true },
        })
      ).map((o) => [o.id, o.institutionId])
    )

    // WRK-060-005. The grid draws days, so it draws OCCURRENCES: a one-off event
    // and each expansion of a recurring one. The series master is filtered out
    // here — it is the row that carries the rule, and `loadScopedEvents` returns
    // it whether or not its own start falls in this week so the ICS feed can
    // describe the series. Rendering it too would put a chip on the week the
    // series began, every week.
    const gridEvents: TimeGridEvent[] = events
      .filter((e) => e.recurrenceRule === null)
      .map((e) => ({
        id: e.id,
        title: e.title,
        startISO: e.startAt.toISOString(),
        endISO: e.endAt.toISOString(),
        org: e.organizationName,
        organizationId: e.organizationId,
        venue: e.venue,
        status: e.status,
        // A generated occurrence is not a row, so there is nothing to move: the
        // reschedule API would 404 on its synthetic id, and a chip a user can
        // drag into a change that silently does not happen is worse than one
        // they cannot. Editing the series is editing the master record.
        editable:
          e.occurrenceOf === null &&
          canEditEvent(ctx, {
            organizationId: e.organizationId,
            institutionId: orgInstitutions.get(e.organizationId) ?? "",
            status: e.status,
            ownerRoleId: e.ownerRoleId,
          }),
      }))

    // Institution deliverables (audits, reports, board deadlines) are all-day
    // markers, not timed blocks. The month grid used to be the only place they
    // appeared; retiring it must not quietly drop a compliance deadline, so they
    // ride an all-day band above the hours.
    //
    // The institution is resolved from who the VIEWER is, not from the events
    // that happen to fall in this week. Deriving it from events meant a club
    // officer looking at a quiet week saw no deadlines at all — precisely the
    // week when a looming audit matters most.
    const viewerOrgInstitutions = memberOrgIds.length
      ? (
          await db.organization.findMany({
            where: { id: { in: memberOrgIds } },
            select: { institutionId: true },
          })
        ).map((o) => o.institutionId)
      : []

    const institutionIds = [
      ...new Set([...ctx.institutionRoles.map((r) => r.institutionId), ...viewerOrgInstitutions]),
    ].filter(Boolean)

    const deliverables = institutionIds.length
      ? await db.deliverable.findMany({
          where: { institutionId: { in: institutionIds }, dueAt: { gte: rangeStart, lt: rangeEnd } },
          orderBy: { dueAt: "asc" },
          select: { id: true, title: true, dueAt: true, kind: true, term: true },
        })
      : []

    const TERM_LABELS: Record<string, string> = {
      FALL_A: "Fall A",
      FALL_B: "Fall B",
      SPRING_A: "Spring A",
      SPRING_B: "Spring B",
    }

    const allDay: AllDayItem[] = deliverables.map((x) => ({
      id: x.id,
      title: x.title,
      date: dateKeyInZone(x.dueAt, timeZone),
      kind: x.kind === "DEADLINE" ? "deadline" : "milestone",
      hint: x.term ? `Ainslie OSE · ${TERM_LABELS[x.term] ?? x.term}` : "Ainslie OSE",
    }))

    // Distinct clubs with events in view — the "My calendars" rail.
    const calendars = [...new Set(gridEvents.map((e) => e.org))]
      .sort()
      .map((org) => ({ org, sw: clubSwatch(org) }))

    const prevKey = addDaysToKey(weekStartKey, -7)
    const nextKey = addDaysToKey(weekStartKey, 7)
    const rangeLabel = `${formatDateKey(weekStartKey, { month: "short", day: "numeric" })} – ${formatDateKey(
      weekEndKey,
      { month: "short", day: "numeric", year: "numeric" }
    )}`

    return (
      <div className="w-full">
        <PageHeader
          title="Calendar"
          // Zone abbreviation for the week on screen, not for today — browsing to
          // a winter week in summer must not claim EDT over EST times.
          // The sync clause is the gate's answer, not a sentence written here:
          // `calendarSyncSentence` runs `providerActivation` over the recorded
          // Microsoft review, which is NOT_SUBMITTED, so this reads "publish"
          // and promises nothing. See packages/platform-config/src/provider-review.ts.
          subtitle={`One shared week across your clubs, in ${zoneAbbreviation(
            timeZone,
            startOfDayInZone(addDaysToKey(weekStartKey, 3), timeZone) ?? undefined
          )} — subscribe to ${sync.activated ? "sync it with" : "publish it to"} your calendar app.`}
          actions={
            <>
              {clubOptions.length > 0 && <CalendarFilters clubs={clubOptions} />}
              {/* WRK-020-005. The deliberate act that leaves a receipt. Copying
                  the URL mints a token pinned to the scope on screen; this is
                  where the person SAYS so, and `recordAuditEvent` writes a
                  hash-chained row naming the digest. The digest travels in the
                  form so the receipt records what was rendered — if the scope
                  changed between the render and the click, the row is a DENY
                  rather than a consent to something nobody saw. */}
              <form action={confirmCalendarConsent}>
                <input
                  type="hidden"
                  name="digest"
                  value={selectorDigest(consentedSelector)}
                />
                <button
                  type="submit"
                  className="inline-flex h-10 items-center rounded-md border border-border px-3 text-sm font-medium text-text-2 transition-colors hover:bg-surface"
                >
                  Confirm sharing
                </button>
              </form>
              <CalendarSubscribe feedPath={feedPath} sync={sync} />
              {canCreate && (
                <Link
                  href="/calendar/new"
                  className="inline-flex h-10 items-center gap-1.5 rounded-md bg-[--primary] px-4 text-sm font-medium text-[--primary-text] no-underline transition-colors hover:bg-[--primary-hover]"
                >
                  <Plus size={16} aria-hidden /> Propose event
                </Link>
              )}
            </>
          }
        />

        <div className="flex flex-col gap-5 lg:flex-row">
          {/* Left rail — mini-month navigator + "My calendars". */}
          <aside className="w-full shrink-0 space-y-4 lg:w-60">
            <CalendarMiniMonth
              baseKey={weekStartKey}
              rangeStartKey={weekStartKey}
              rangeEndKey={weekEndKey}
              todayKey={todayKey}
              filterQs={filterQs}
            />
            <div className="rounded-[10px] border border-border bg-surface p-3">
              <p className="micro-label mb-2">My calendars</p>
              {calendars.length === 0 ? (
                <p className="text-[13px] text-text-3">No events this week.</p>
              ) : (
                <ul className="space-y-1.5">
                  {calendars.map(({ org, sw }) => (
                    <li key={org} className="flex items-center gap-2 text-[13px] text-text-2">
                      <span
                        className="h-3 w-3 shrink-0 rounded-[3px]"
                        style={{ background: sw.border }}
                        aria-hidden
                      />
                      <span className="truncate">{org}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          {/* Right — week controls + the hourly time grid. */}
          <div className="min-w-0 flex-1">
            {/* flex-wrap: at the 320px reflow target the two arrows, the
                192px range label and "This week" come to 373px on one line
                (WCAG 1.4.10). */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Link
                href={withFilters(`/calendar?d=${prevKey}`)}
                aria-label="Previous week"
                className="grid h-9 w-9 place-items-center rounded-md border border-border text-text-2 no-underline transition-colors hover:bg-surface"
              >
                <ChevronLeft size={16} aria-hidden />
              </Link>
              {/* The 192px floor centres the label between the arrows on a
                  real screen; on a phone it is most of the viewport. */}
              <span className="text-center text-sm font-semibold text-text-1 sm:min-w-48">{rangeLabel}</span>
              <Link
                href={withFilters(`/calendar?d=${nextKey}`)}
                aria-label="Next week"
                className="grid h-9 w-9 place-items-center rounded-md border border-border text-text-2 no-underline transition-colors hover:bg-surface"
              >
                <ChevronRight size={16} aria-hidden />
              </Link>
              <Link
                href={withFilters("/calendar")}
                className="flex h-9 items-center rounded-md border border-border px-3 text-sm text-text-2 no-underline transition-colors hover:bg-surface"
              >
                This week
              </Link>
            </div>

            <CalendarTimeGrid
              days={days}
              events={gridEvents}
              allDay={allDay}
              timeZone={timeZone}
              canCreate={canCreate}
              onCreateHref="/calendar/new"
            />

            <p className="mt-3 text-[13px] text-text-3">
              {canCreate
                ? "Click an empty slot to propose an event. Drag an event you own to reschedule it, or select it and use the arrow keys."
                : "Select an event to see its details."}
            </p>
          </div>
        </div>
      </div>
    )
  })
}
