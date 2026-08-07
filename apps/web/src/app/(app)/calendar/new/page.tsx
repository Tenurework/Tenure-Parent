import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { withTenantScope } from "@/lib/tenant-scope"
import { Card, CardHeader } from "@/components/ui/Card"
import { BackButton } from "@/components/BackButton"
import { EmptyState } from "@/components/ui/EmptyState"
import { CalendarDays } from "@/components/ui/icons"
import { DraftAssist } from "@/components/DraftAssist"
import { aiConfigured } from "@/lib/ai"
import { viewerTimeZone } from "@/lib/institution-time"
import { addDaysToKey, parseDateKey, todayKeyInZone, zoneAbbreviation } from "@/lib/time"
import { createEvent } from "../actions"

export const dynamic = "force-dynamic"

const fieldClass =
  "mt-1 h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-1 outline-none transition-colors focus:border-[--border-focus] focus:[box-shadow:var(--shadow-focus)]"
const labelClass = "block text-[13px] font-semibold text-text-2"

/**
 * Propose an event.
 *
 * Reached from the header button or by clicking an empty slot on the week grid,
 * which passes `?date=&time=` so the form opens on the slot the officer
 * actually pointed at rather than making them retype it. All times are entered
 * and read as institution-local wall clock (see src/lib/time.ts).
 */
export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; time?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")

  return withTenantScope(session.user.id, async (scope) => {
    const { date, time } = await searchParams
    const timeZone = await viewerTimeZone(session.user.id, scope.institutionId)

    const seats = await db.roleAssignment.findMany({
      where: { userId: session.user.id, status: "ACTIVE" },
      include: { role: { include: { organization: true } } },
    })
    const orgs = [...new Map(seats.map((s) => [s.role.organization.id, s.role.organization])).values()]

    if (orgs.length === 0) {
      return (
        <div className="max-w-2xl">
          <BackButton />
          <Card className="mt-2">
            <EmptyState
              state="empty"
              icon={CalendarDays}
              title="You need an active club seat"
              description="Only officers holding an active seat can propose events. If you have just been elected, your seat may still be in shadow status until your term begins."
            />
          </Card>
        </div>
      )
    }

    // Prefill from the clicked slot. Anything malformed falls back to a blank
    // field rather than producing an Invalid Date in the input.
    const dayKey = date && parseDateKey(date) ? date : todayKeyInZone(timeZone)
    const startTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(time ?? "") ? time! : ""
    const endTime = startTime
      ? (() => {
          const [h, m] = startTime.split(":").map(Number)
          const end = (h * 60 + m + 90) % (24 * 60)
          return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`
        })()
      : ""
    // A 90-minute default that runs past midnight belongs on the next day.
    const endDayKey = startTime && endTime && endTime < startTime ? addDaysToKey(dayKey, 1) : dayKey

    const startValue = startTime ? `${dayKey}T${startTime}` : ""
    const endValue = endTime ? `${endDayKey}T${endTime}` : ""

    return (
      <div className="max-w-2xl">
        <BackButton />
        <div className="mb-6 mt-2">
          <h1 className="text-text-1">Propose an event</h1>
          <p className="mt-1 text-sm text-text-2">
            Submitting checks the shared calendar for conflicts and routes the proposal into the
            approval chain. It publishes once approved. Times are in {zoneAbbreviation(timeZone)}.
          </p>
        </div>

        <Card>
          <CardHeader title="Event details" />
          <form action={createEvent} className="space-y-4">
            <label className={labelClass}>
              Club
              <select name="organizationId" required className={fieldClass}>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>

            <label className={labelClass}>
              Title
              <input
                name="title"
                required
                maxLength={200}
                placeholder="Spring Case Competition"
                className={fieldClass}
              />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={labelClass}>
                Starts
                <input
                  type="datetime-local"
                  name="startAt"
                  required
                  defaultValue={startValue}
                  className={fieldClass}
                />
              </label>
              <label className={labelClass}>
                Ends
                <input
                  type="datetime-local"
                  name="endAt"
                  required
                  defaultValue={endValue}
                  className={fieldClass}
                />
              </label>
            </div>

            <label className={labelClass}>
              Venue
              <input name="venue" placeholder="Schlegel Hall 203" className={fieldClass} />
            </label>

            <label className={labelClass}>
              Description
              <textarea
                name="description"
                rows={3}
                placeholder="What's happening and who should come."
                className={`${fieldClass} h-auto py-2.5`}
              />
            </label>

            {aiConfigured() && <DraftAssist kind="event" targetName="description" />}

            <button
              type="submit"
              className="inline-flex h-10 items-center rounded-md bg-[--primary] px-4 text-sm font-medium text-[--primary-text] transition-colors hover:bg-[--primary-hover]"
            >
              Check conflicts &amp; submit
            </button>
          </form>
        </Card>
      </div>
    )
  })
}
