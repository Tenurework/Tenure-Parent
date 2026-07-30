import { NextResponse } from "next/server"
import { verifyCalendarToken, eventsToICS } from "@/lib/calendar-sync"
import { loadScopedEvents } from "@/lib/calendar-data"

/**
 * Per-user ICS subscription feed. Outlook / Google / Apple Calendar poll this
 * URL to keep a student's school calendar in sync with Tenure. Authenticated by
 * the unguessable signed token in the path (calendar clients can't send
 * cookies), so it needs no session.
 */
export const dynamic = "force-dynamic"

const DAY = 86_400_000

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const userId = verifyCalendarToken(token.replace(/\.ics$/i, ""))
  if (!userId) return new NextResponse("Invalid calendar token", { status: 403 })

  const now = new Date()
  const events = await loadScopedEvents(
    userId,
    new Date(now.getTime() - 30 * DAY),
    new Date(now.getTime() + 180 * DAY)
  )

  return new NextResponse(eventsToICS(events, "Tenure"), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="tenure.ics"',
      "cache-control": "public, max-age=1800",
    },
  })
}
