"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Overlay } from "@/components/ui/Overlay"
import { Button } from "@/components/ui/Button"
import { TextField } from "@/components/ui/TextField"
import { Badge, EventBadge } from "@/components/ui/Badge"
import { ArrowRight, Clock, MapPin } from "@/components/ui/icons"
import { formatInZone, zoneAbbreviation } from "@/lib/time"
import type { EventStatus } from "@prisma/client"

interface EventPayload {
  id: string
  title: string
  description: string | null
  venue: string | null
  status: string
  organizationName: string
  editable: boolean
  timeZone: string
  startISO: string
  endISO: string
}

/**
 * The panel that opens from a tile on the week grid.
 *
 * The grid used to link straight out to a full-page read-only detail route, so
 * correcting a typo in a room number meant leaving the calendar and coming
 * back. Officers who may edit get the fields inline; everyone else gets the
 * same details read-only with a link through to the full record. Times always
 * render in the institution's zone and say which zone that is.
 */
export function EventInspector({
  eventId,
  timeZone,
  onClose,
  onSaved,
}: {
  eventId: string
  timeZone: string
  onClose: () => void
  onSaved: () => void
}) {
  const [data, setData] = useState<EventPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState("")
  const [venue, setVenue] = useState("")
  const [description, setDescription] = useState("")

  useEffect(() => {
    let cancelled = false
    setError(null)
    setData(null)
    fetch(`/api/calendar/event/${eventId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("That event could not be loaded.")
        return (await res.json()) as EventPayload
      })
      .then((payload) => {
        if (cancelled) return
        setData(payload)
        setTitle(payload.title)
        setVenue(payload.venue ?? "")
        setDescription(payload.description ?? "")
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [eventId])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/calendar/event/${eventId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, venue: venue || null, description: description || null }),
      })
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error ?? "Could not save the change.")
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the change.")
    } finally {
      setSaving(false)
    }
  }

  const zone = data?.timeZone ?? timeZone
  const when = data
    ? `${formatInZone(new Date(data.startISO), zone, {
        weekday: "short",
        month: "short",
        day: "numeric",
      })} · ${formatInZone(new Date(data.startISO), zone, {
        hour: "numeric",
        minute: "2-digit",
      })} – ${formatInZone(new Date(data.endISO), zone, {
        hour: "numeric",
        minute: "2-digit",
      })} ${zoneAbbreviation(zone, new Date(data.startISO))}`
    : ""

  return (
    <Overlay
      isOpen
      onOpenChange={(open) => !open && onClose()}
      size="md"
      title={data?.title ?? "Event"}
      description={data?.organizationName}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <Link
            href={`/calendar/${eventId}`}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-link no-underline hover:underline"
          >
            Open full record <ArrowRight size={14} aria-hidden />
          </Link>
          <div className="flex items-center gap-2.5">
            <Button variant="secondary" size="sm" onPress={onClose}>
              {data?.editable ? "Cancel" : "Close"}
            </Button>
            {data?.editable && (
              <Button size="sm" onPress={save} isDisabled={saving || !title.trim()}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {!data && !error && <p className="py-6 text-center text-sm text-text-3">Loading…</p>}

      {error && (
        <p role="alert" className="rounded-md border border-[--error] px-3 py-2 text-[13px] text-[--error]">
          {error}
        </p>
      )}

      {data && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <EventBadge status={data.status as EventStatus} />
            {!data.editable && <Badge variant="default">Read only</Badge>}
          </div>

          <div className="space-y-1.5 text-sm text-text-2">
            <p className="flex items-center gap-2">
              <Clock size={15} className="shrink-0 text-text-3" aria-hidden />
              {when}
            </p>
            {data.venue && (
              <p className="flex items-center gap-2">
                <MapPin size={15} className="shrink-0 text-text-3" aria-hidden />
                {data.venue}
              </p>
            )}
          </div>

          {data.editable ? (
            <div className="space-y-3.5 border-t border-border pt-4">
              <TextField label="Title" value={title} onChange={setTitle} isRequired />
              <TextField
                label="Venue"
                value={venue}
                onChange={setVenue}
                placeholder="Schlegel Hall 203"
                description="Changing the room re-checks the shared calendar for venue clashes."
              />
              <TextField
                label="Description"
                value={description}
                onChange={setDescription}
                multiline
                rows={4}
              />
              <p className="text-xs text-text-3">
                To change the time, drag the event on the grid — or select it and use the arrow
                keys. Every move is re-checked for conflicts and recorded in the audit trail.
              </p>
            </div>
          ) : (
            data.description && (
              <p className="border-t border-border pt-4 text-sm text-text-2">{data.description}</p>
            )
          )}
        </div>
      )}
    </Overlay>
  )
}
