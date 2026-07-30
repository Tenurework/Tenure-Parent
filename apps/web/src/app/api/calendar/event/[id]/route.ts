import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { loadEditableEvent, updateEventDetails } from "@/lib/calendar-write"
import { toDateTimeLocalValue } from "@/lib/time"

/**
 * Single-event read/write for the calendar inspector — the panel that opens
 * when an officer clicks a tile on the week grid, so details can be corrected
 * without leaving the calendar.
 *
 * Times are returned pre-formatted for the institution's zone alongside the raw
 * instants, so the client never has to reconstruct a wall clock itself.
 */
export const dynamic = "force-dynamic"

const Patch = z.object({
  title: z.string().min(1).max(200),
  venue: z.string().max(200).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
})

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 })
  }
  const { id } = await params
  const event = await loadEditableEvent(session.user.id, id)
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({
    id: event.id,
    title: event.title,
    description: event.description,
    venue: event.venue,
    status: event.status,
    organizationName: event.organizationName,
    editable: event.editable,
    timeZone: event.timeZone,
    startISO: event.startAt.toISOString(),
    endISO: event.endAt.toISOString(),
    startLocal: toDateTimeLocalValue(event.startAt, event.timeZone),
    endLocal: toDateTimeLocalValue(event.endAt, event.timeZone),
  })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 })
  }
  const { id } = await params

  const parsed = Patch.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 })
  }

  const result = await updateEventDetails(session.user.id, id, {
    title: parsed.data.title,
    venue: parsed.data.venue ?? null,
    description: parsed.data.description ?? null,
  })
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 403 })
  }
  return NextResponse.json({ ok: true })
}
