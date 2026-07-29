import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { rescheduleEvent } from "@/lib/calendar-write"

/**
 * Drag-to-reschedule endpoint for the week grid.
 *
 * The client sends institution-local wall-clock values (a date key plus minutes
 * from midnight) and never an instant, so the server owns the timezone
 * conversion. Permission, conflict re-detection and the audit record all happen
 * in lib/calendar-write — this route is only transport and validation.
 */
export const dynamic = "force-dynamic"

const Body = z.object({
  id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startMinute: z.number().int().min(0).max(24 * 60),
  // Past 24×60 means the event ends on the following day — a 10pm–1am event is
  // startMinute 1320, endMinute 1500. Capping this at 24×60 made a late event
  // inexpressible, so the grid quietly truncated it to the end of the day.
  endMinute: z.number().int().min(0).max(48 * 60),
})

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 })
  }

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 })
  }

  const { id, ...input } = parsed.data
  const result = await rescheduleEvent(session.user.id, id, input)
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 403 })
  }
  return NextResponse.json(result)
}
