"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { clubSwatch } from "@/lib/calendar-color"
import {
  dateKeyInZone,
  formatDateKey,
  formatInZone,
  minutesOfDayInZone,
  parseDateKey,
  todayKeyInZone,
  zoneAbbreviation,
  zonedTimeToUtc,
} from "@/lib/time"
import { EventInspector } from "@/components/calendar/EventInspector"
import { Overlay } from "@/components/ui/Overlay"

export interface TimeGridEvent {
  id: string
  title: string
  /** UTC instant, ISO-8601 with offset. Never a bare local string. */
  startISO: string
  endISO: string
  org: string
  organizationId: string
  venue: string | null
  status: string
  /** Whether this viewer may move/resize/edit this event. */
  editable: boolean
}

export interface TimeGridDay {
  /** "YYYY-MM-DD" in the institution's timezone. */
  date: string
  weekday: string
  dayNum: number
  isToday: boolean
}

/**
 * An institution deadline or milestone. These are dates, not timed blocks, so
 * they sit in a band above the hours rather than being pinned to a fake hour.
 */
export interface AllDayItem {
  id: string
  title: string
  /** "YYYY-MM-DD" in the institution's timezone. */
  date: string
  kind: "deadline" | "milestone"
  /** Owner and term, e.g. "Ainslie OSE · Fall A". Shown on hover and to AT. */
  hint?: string
}

const START_HOUR = 7
const END_HOUR = 23
const HOUR_PX = 52
const GUTTER_PX = 56
/** Drag/resize quantisation, and the smallest schedulable slot. */
const SNAP_MIN = 15
const MIN_EVENT_MIN = 15
const MINUTES_PER_ROW = 60
const PX_PER_MIN = HOUR_PX / MINUTES_PER_ROW
/**
 * Most side-by-side columns a cluster may occupy. Past this, a chip is thinner
 * than its own text and the grid stops being readable — a real risk here, where
 * every club in the institution shares one calendar and a Friday evening can
 * collect a dozen concurrent events. The remainder collapses into a "+N more"
 * chip that opens the full list.
 */
const MAX_COLS = 3

type DragMode = "move" | "resize-start" | "resize-end"

interface PlacedEvent {
  e: TimeGridEvent
  startMin: number
  /** Clamped to the visible band for drawing. Never send this to the server. */
  endMin: number
  /** The true end, past 24×60 for an event that runs into the next day. */
  writeEndMin: number
  col: number
  cols: number
  top?: number
  height?: number
}

/** Events past MAX_COLS, folded into one "+N more" chip. */
interface OverflowGroup {
  startMin: number
  endMin: number
  col: number
  cols: number
  events: TimeGridEvent[]
}

interface DayLayout {
  events: (PlacedEvent & { top: number; height: number })[]
  overflows: OverflowGroup[]
}

interface DragState {
  id: string
  mode: DragMode
  /** Original values, in minutes from midnight, so a drag is always absolute. */
  origStart: number
  origEnd: number
  /**
   * The event's true end, which for an event running past local midnight is
   * greater than 24×60 — unlike `origEnd`, which the layout clamps to the
   * bottom of the visible band so the chip can be drawn. Only this value may
   * reach the server: committing the clamped one silently truncated every
   * cross-midnight event to the end of the grid.
   */
  origWriteEnd: number
  origDate: string
  pointerStartY: number
  pointerStartX: number
  /** Live preview. */
  start: number
  end: number
  /** The end that will actually be written; see `origWriteEnd`. */
  writeEnd: number
  date: string
  moved: boolean
}

function clampToGrid(min: number): number {
  return Math.max(START_HOUR * 60, Math.min(END_HOUR * 60, min))
}

function snap(min: number): number {
  return Math.round(min / SNAP_MIN) * SNAP_MIN
}

/**
 * Noon on the middle day of the displayed range — a stable instant to resolve
 * the zone abbreviation against. Midday avoids the DST changeover hours, and
 * midweek keeps a week that straddles a changeover on the side it mostly lives.
 */
function midweekInstant(days: TimeGridDay[], timeZone: string): Date {
  const key = days[Math.floor(days.length / 2)]?.date
  const parsed = key ? parseDateKey(key) : null
  if (!parsed) return new Date()
  return zonedTimeToUtc(parsed.year, parsed.month, parsed.day, 12, 0, timeZone)
}

function label(min: number): string {
  const h24 = Math.floor(min / 60) % 24
  const m = Math.abs(min % 60)
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`
}

/**
 * The Outlook-style hourly time grid — Tenure's single calendar view.
 *
 * Correctness notes, because all three were previously wrong:
 *
 *  1. TIME. Events are placed and labelled in the institution's timezone via
 *     lib/time, not by reading the UTC wall clock off the instant. The old grid
 *     used `getUTCHours()`, so a 6pm Rochester event rendered at 10pm and the
 *     now-line sat four hours from the truth.
 *  2. ALIGNMENT. The header and the body are ONE css grid template
 *     (`GUTTER_PX` + N equal columns) rather than two independently-flexed
 *     rows, so day columns line up with their headers to the pixel. Hour rows
 *     draw as a single repeating background gradient on the column, so
 *     horizontal rules cannot drift out of step with the gutter labels.
 *  3. OVERLAP. Concurrent events are clustered before being columned, so one
 *     three-way overlap at 9am no longer squeezes the entire day to a third
 *     width.
 *
 * Editability: an event the viewer owns can be dragged to a new time or day,
 * resized from either edge, and opened in an inspector. Drags are optimistic
 * with a rollback on failure, and quantised to 15 minutes.
 */
export function CalendarTimeGrid({
  days,
  events,
  allDay = [],
  timeZone,
  canCreate,
  onCreateHref,
}: {
  days: TimeGridDay[]
  events: TimeGridEvent[]
  /** Institution deadlines/milestones falling in this week. */
  allDay?: AllDayItem[]
  timeZone: string
  canCreate: boolean
  /** Base path for "click an empty slot to propose an event". */
  onCreateHref: string
}) {
  const router = useRouter()
  const scrollRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  /** Set when a drag actually moved something, so the trailing click is ignored. */
  const draggedRef = useRef(false)
  const [pending, setPending] = useState<Record<string, { startISO: string; endISO: string }>>({})
  const [failed, setFailed] = useState<string | null>(null)
  const [inspect, setInspect] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<{ date: string; events: TimeGridEvent[] } | null>(null)

  const hours = useMemo(
    () => Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i),
    []
  )
  const rows = END_HOUR - START_HOUR
  const gridHeight = rows * HOUR_PX
  // Label the zone for the week being displayed, not for today: browsing to a
  // February week in July would otherwise stamp "EDT" over a grid whose times
  // are all EST, which is exactly the kind of quiet one-hour lie that gets an
  // officer to the wrong room.
  const zoneLabel = zoneAbbreviation(timeZone, midweekInstant(days, timeZone))

  // Merge optimistic drag results over the server-rendered events.
  const effective = useMemo(
    () => events.map((e) => (pending[e.id] ? { ...e, ...pending[e.id] } : e)),
    [events, pending]
  )

  /**
   * Retire an optimistic override once the server render agrees with it.
   *
   * Without this the entry stayed in `pending` for the life of the page: the
   * override kept masking the real row, so a change made by anyone else was
   * invisible until a hard reload, and the chip never lost its saving-dim.
   * Comparing against the incoming props — rather than clearing on response —
   * means the chip never flashes back to its old position while the refresh is
   * still in flight.
   */
  useEffect(() => {
    setPending((p) => {
      const ids = Object.keys(p)
      if (ids.length === 0) return p
      const settled = ids.filter((id) => {
        const server = events.find((e) => e.id === id)
        return server && server.startISO === p[id].startISO && server.endISO === p[id].endISO
      })
      if (settled.length === 0) return p
      const next = { ...p }
      for (const id of settled) delete next[id]
      return next
    })
  }, [events])

  // ── Current-time indicator ────────────────────────────────────────────────
  // Rendered only after mount: "now" differs between the server render and the
  // client, and emitting it during SSR is a guaranteed hydration mismatch.
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  const nowMin = now == null ? null : minutesOfDayInZone(now, timeZone)
  const nowKey = now == null ? null : todayKeyInZone(timeZone, now)
  const nowIndex = nowKey == null ? -1 : days.findIndex((d) => d.date === nowKey)
  const nowY =
    nowMin == null ? null : (nowMin - START_HOUR * 60) * PX_PER_MIN
  const showNow = nowIndex >= 0 && nowY != null && nowY >= 0 && nowY <= gridHeight

  // Open on the working day rather than at 7am — scroll to just above "now"
  // when today is in view, otherwise to the first event of the range.
  const didScroll = useRef(false)
  // Re-anchor when the visible week changes, so paging to another week does not
  // inherit the previous week's scroll position.
  const weekStartKey = days[0]?.date
  useEffect(() => {
    didScroll.current = false
  }, [weekStartKey])
  useEffect(() => {
    // Wait for the client clock. `now` is null on the first commit, so latching
    // here meant the "open near now" branch was never reachable — the grid
    // always opened at the earliest event of the week instead.
    if (now == null || didScroll.current || !scrollRef.current) return
    const target =
      showNow && nowY != null
        ? nowY - 120
        : effective.length
          ? Math.min(
              ...effective.map(
                (e) => (minutesOfDayInZone(new Date(e.startISO), timeZone) - START_HOUR * 60) * PX_PER_MIN
              )
            ) - 60
          : 2 * HOUR_PX
    scrollRef.current.scrollTop = Math.max(0, target)
    didScroll.current = true
  }, [now, showNow, nowY, effective, timeZone])

  // ── Layout: cluster, then column within each cluster ──────────────────────
  const layoutByDay = useMemo(() => {
    const map = new Map<string, DayLayout>()

    for (const day of days) {
      const dayEvents = effective
        .filter((e) => dateKeyInZone(new Date(e.startISO), timeZone) === day.date)
        .map((e) => {
          const startMin = minutesOfDayInZone(new Date(e.startISO), timeZone)
          let endMin = minutesOfDayInZone(new Date(e.endISO), timeZone)
          // The event's real length, which survives a midnight crossing. The
          // clamp below is a drawing concession and must never be written back.
          const writeEndMin =
            startMin +
            Math.max(
              MIN_EVENT_MIN,
              Math.round((new Date(e.endISO).getTime() - new Date(e.startISO).getTime()) / 60000)
            )
          // An event ending after local midnight reads as a smaller number;
          // clamp it to the end of the visible band instead of inverting.
          if (endMin <= startMin) endMin = END_HOUR * 60
          return {
            e,
            startMin,
            endMin: Math.max(startMin + MIN_EVENT_MIN, endMin),
            writeEndMin,
          }
        })
        .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)

      // A cluster is a maximal run of events connected by overlap. Column count
      // is computed per cluster, so an isolated afternoon event stays full width
      // even when the morning has a three-way collision.
      const placed: PlacedEvent[] = []
      const overflows: OverflowGroup[] = []
      let cluster: typeof dayEvents = []
      let clusterEnd = -1

      const flush = () => {
        if (!cluster.length) return
        const colEnds: number[] = []
        const withCols = cluster.map((item) => {
          let col = colEnds.findIndex((end) => end <= item.startMin)
          if (col === -1) {
            col = colEnds.length
            colEnds.push(item.endMin)
          } else {
            colEnds[col] = item.endMin
          }
          return { ...item, col }
        })
        const rawCols = Math.max(1, colEnds.length)
        const cols = Math.min(rawCols, MAX_COLS)

        if (rawCols > MAX_COLS) {
          // Keep the earliest MAX_COLS-1 columns legible and roll the rest into
          // one chip in the final slot, rather than shaving every event in the
          // day down to a few pixels.
          const shown = withCols.filter((x) => x.col < MAX_COLS - 1)
          const hidden = withCols.filter((x) => x.col >= MAX_COLS - 1)
          for (const item of shown) placed.push({ ...item, cols })
          if (hidden.length) {
            overflows.push({
              startMin: Math.min(...hidden.map((x) => x.startMin)),
              endMin: Math.max(...hidden.map((x) => x.endMin)),
              col: MAX_COLS - 1,
              cols,
              events: hidden.map((x) => x.e),
            })
          }
        } else {
          for (const item of withCols) placed.push({ ...item, cols })
        }

        cluster = []
        clusterEnd = -1
      }

      for (const item of dayEvents) {
        if (cluster.length && item.startMin >= clusterEnd) flush()
        cluster.push(item)
        clusterEnd = Math.max(clusterEnd, item.endMin)
      }
      flush()

      map.set(day.date, {
        events: placed.map((p) => ({
          ...p,
          top: (p.startMin - START_HOUR * 60) * PX_PER_MIN,
          height: Math.max(20, (p.endMin - p.startMin) * PX_PER_MIN - 2),
        })),
        overflows,
      })
    }
    return map
  }, [days, effective, timeZone])

  // ── Drag / resize ─────────────────────────────────────────────────────────
  const commit = useCallback(
    async (id: string, date: string, startMin: number, endMin: number) => {
      const prev = pending[id]
      const body = { id, date, startMinute: startMin, endMinute: endMin, timeZone }
      // Optimistic: paint the new position immediately, roll back on failure.
      try {
        const res = await fetch("/api/calendar/reschedule", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not save")
        const json = (await res.json()) as { startISO: string; endISO: string }
        setPending((p) => ({ ...p, [id]: json }))
        setFailed(null)
        // The override is retired by the reconcile effect below, once the
        // refreshed server render actually carries the new time.
        router.refresh()
      } catch (err) {
        setPending((p) => {
          const next = { ...p }
          if (prev) next[id] = prev
          else delete next[id]
          return next
        })
        setFailed(err instanceof Error ? err.message : "Could not save the change")
      }
    },
    [pending, router, timeZone]
  )

  useEffect(() => {
    if (!drag) return

    const dayWidth = () => {
      const el = bodyRef.current
      if (!el) return 1
      return (el.clientWidth - GUTTER_PX) / Math.max(1, days.length)
    }

    const onMove = (ev: PointerEvent) => {
      const dyMin = snap((ev.clientY - drag.pointerStartY) / PX_PER_MIN)
      const dxCols =
        days.length > 1 && drag.mode === "move"
          ? Math.round((ev.clientX - drag.pointerStartX) / dayWidth())
          : 0
      setDrag((d) => {
        if (!d) return d
        let start = d.origStart
        let end = d.origEnd
        // `end` drives the preview rectangle; `writeEnd` is what gets saved.
        // They differ for an event whose real end is past local midnight.
        let writeEnd = d.origWriteEnd
        if (d.mode === "move") {
          // Preserve the true duration. Using the clamped span here shortened a
          // cross-midnight event every time it was dragged anywhere.
          const trueSpan = d.origWriteEnd - d.origStart
          const drawnSpan = d.origEnd - d.origStart
          start = clampToGrid(d.origStart + dyMin)
          if (start + drawnSpan > END_HOUR * 60) start = END_HOUR * 60 - drawnSpan
          end = start + drawnSpan
          writeEnd = start + trueSpan
        } else if (d.mode === "resize-end") {
          // An explicit resize is the user setting a new end, so the drawn and
          // written ends agree by definition.
          end = clampToGrid(Math.max(d.origStart + MIN_EVENT_MIN, d.origEnd + dyMin))
          writeEnd = end
        } else {
          start = clampToGrid(Math.min(d.origEnd - MIN_EVENT_MIN, d.origStart + dyMin))
        }
        const idx = days.findIndex((x) => x.date === d.origDate)
        const nextIdx = Math.max(0, Math.min(days.length - 1, idx + dxCols))
        return {
          ...d,
          start,
          end,
          writeEnd,
          date: days[nextIdx].date,
          moved: d.moved || start !== d.origStart || end !== d.origEnd || days[nextIdx].date !== d.origDate,
        }
      })
    }

    const onUp = () => {
      setDrag((d) => {
        if (d?.moved) {
          draggedRef.current = true
          void commit(d.id, d.date, d.start, d.writeEnd)
        }
        return null
      })
    }

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setDrag(null)
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("keydown", onKey)
    }
  }, [drag, days, commit])

  const beginDrag = (
    ev: React.PointerEvent,
    mode: DragMode,
    id: string,
    date: string,
    startMin: number,
    endMin: number,
    writeEndMin: number
  ) => {
    // Left button only; let modifier-clicks fall through to the browser.
    if (ev.button !== 0 || ev.ctrlKey || ev.metaKey) return
    ev.preventDefault()
    ev.stopPropagation()
    setDrag({
      id,
      mode,
      origStart: startMin,
      origEnd: endMin,
      origWriteEnd: writeEndMin,
      origDate: date,
      pointerStartY: ev.clientY,
      pointerStartX: ev.clientX,
      start: startMin,
      end: endMin,
      writeEnd: writeEndMin,
      date,
      moved: false,
    })
  }

  /**
   * WCAG 2.2 SC 2.5.7, Dragging Movements — a duration is a thing you could
   * only set by dragging an edge, so there has to be another way to set it.
   *
   * The pointer half lives in the inspector (open the event with one click,
   * press "15 min longer"), which is what the criterion literally asks for: a
   * single pointer, no dragging. This is the keyboard half.
   *
   * Alt, not Shift. Shift+Arrow already means "move by an hour" — asserted by
   * e2e/calendar.spec.ts — and taking that key for resize would have made an
   * existing test red rather than making the product more accessible.
   */
  const resizeEnd = (
    id: string,
    date: string,
    startMin: number,
    writeEndMin: number,
    deltaMin: number
  ) => {
    const span = Math.max(MIN_EVENT_MIN, writeEndMin - startMin)
    // Never shorter than one slot, never past the bottom of the grid. Both are
    // the same clamps the pointer resize uses, so the two paths cannot produce
    // events the other could not.
    const nextEnd = Math.max(
      startMin + MIN_EVENT_MIN,
      Math.min(clampToGrid(startMin + span + deltaMin), END_HOUR * 60)
    )
    if (nextEnd === startMin + span) return
    void commit(id, date, startMin, nextEnd)
  }

  /** Nudge an event by keyboard — drag-and-drop is not an accessible-only path. */
  const nudge = (
    ev: React.KeyboardEvent,
    id: string,
    date: string,
    startMin: number,
    writeEndMin: number,
    editable: boolean
  ) => {
    if (!editable) return
    const step = ev.shiftKey ? 60 : SNAP_MIN
    // Moving an event never changes how long it is. Clamping the end to the
    // bottom of the grid instead shortened the event as it approached 11pm, and
    // at 11pm exactly produced a zero-length request the server rejected.
    const span = Math.max(MIN_EVENT_MIN, writeEndMin - startMin)
    let handled = true
    if (ev.altKey && (ev.key === "ArrowUp" || ev.key === "ArrowDown")) {
      // Resize: the start stays put, the end moves. Down lengthens.
      resizeEnd(id, date, startMin, writeEndMin, ev.key === "ArrowDown" ? step : -step)
    } else if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
      const dir = ev.key === "ArrowDown" ? 1 : -1
      const start = clampToGrid(startMin + dir * step)
      void commit(id, date, start, start + span)
    } else if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
      const idx = days.findIndex((d) => d.date === date)
      const next = idx + (ev.key === "ArrowRight" ? 1 : -1)
      if (next < 0 || next >= days.length) return
      void commit(id, days[next].date, startMin, startMin + span)
    } else {
      handled = false
    }
    if (handled) ev.preventDefault()
  }

  const openSlot = (date: string, minute: number) => {
    if (!canCreate) return
    const h = String(Math.floor(minute / 60)).padStart(2, "0")
    const m = String(minute % 60).padStart(2, "0")
    router.push(`${onCreateHref}?date=${date}&time=${h}:${m}`)
  }

  const columns = `${GUTTER_PX}px repeat(${days.length}, minmax(0, 1fr))`

  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
      {/* Day headers — same grid template as the body, so columns cannot drift. */}
      <div className="grid border-b border-border" style={{ gridTemplateColumns: columns }}>
        <div className="flex items-end justify-end px-2 pb-1.5 text-[10px] font-medium uppercase tracking-wide text-text-3">
          {zoneLabel}
        </div>
        {days.map((d) => (
          <div
            key={d.date}
            data-day-header={d.date}
            className="border-l border-border px-2 py-2 text-center"
          >
            <span className="block text-meta uppercase tracking-wide text-text-3">{d.weekday}</span>
            <span
              className={`mx-auto mt-0.5 grid h-7 w-7 place-items-center rounded-full text-sm font-semibold ${
                d.isToday ? "bg-[--primary] text-[--primary-text]" : "text-text-1"
              }`}
            >
              {d.dayNum}
            </span>
          </div>
        ))}
      </div>

      {/* All-day band — institution deadlines and milestones. Rendered on the
          same grid template so a deadline sits over the day it is due. */}
      {allDay.length > 0 && (
        <div
          className="grid border-b border-border bg-[--bg-subtle]"
          style={{ gridTemplateColumns: columns }}
        >
          <div className="flex items-center justify-end px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-text-3">
            Due
          </div>
          {days.map((d) => (
            // The date is on the cell so a deadline can be asserted against the
            // day it belongs to. Asserting only that the text is visible passes
            // for every day in the week, which is not what these rules mean.
            <div
              key={d.date}
              data-allday-date={d.date}
              className="min-h-[26px] space-y-1 border-l border-border p-1"
            >
              {allDay
                .filter((x) => x.date === d.date)
                .map((x) => {
                  // Deliverables are institution rules, not club activity, so
                  // they are deliberately inert — there is no detail page to
                  // link to and a dead link is worse than plain text.
                  const full = x.hint ? `${x.title} · ${x.hint}` : x.title
                  return (
                    <span
                      key={x.id}
                      title={full}
                      aria-label={full}
                      className={`block truncate rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                        x.kind === "deadline"
                          ? "bg-[--badge-pending-bg] text-[--badge-pending-text]"
                          : "bg-[--badge-accent-bg] text-[--badge-accent-text]"
                      }`}
                    >
                      {x.title}
                    </span>
                  )
                })}
            </div>
          ))}
        </div>
      )}

      {failed && (
        <p role="alert" className="border-b border-border bg-[--error-light] px-3 py-2 text-[13px] text-[--error]">
          {failed}
        </p>
      )}

      <div ref={scrollRef} className="max-h-[64vh] overflow-y-auto">
        <div
          ref={bodyRef}
          className="relative grid"
          style={{ gridTemplateColumns: columns, height: gridHeight }}
        >
          {/* Hour gutter. Labels sit ON the rule they name, so 9am labels the
              9 o'clock line rather than floating between two rows. The first
              label would be half-clipped by the header at that offset, so it
              hangs just below its rule instead of being centred on it — the
              start of the day still has to be readable. */}
          <div className="relative">
            {hours.map((h, i) => (
              <span
                key={h}
                className={`absolute right-2 text-[11px] tabular-nums text-text-3 ${
                  i === 0 ? "" : "-translate-y-1/2"
                }`}
                style={{ top: i * HOUR_PX }}
              >
                {h % 12 === 0 ? 12 : h % 12}
                {h < 12 ? "am" : "pm"}
              </span>
            ))}
          </div>

          {days.map((d) => {
            const layout = layoutByDay.get(d.date) ?? { events: [], overflows: [] }
            const placed = layout.events
            return (
              <div
                key={d.date}
                className="relative border-l border-border"
                style={{
                  // One repeating gradient draws every hour rule, so the lines
                  // are mathematically in step with the gutter labels and the
                  // event positions — no accumulating 1px border drift.
                  backgroundImage: `repeating-linear-gradient(to bottom, var(--chart-grid) 0 1px, transparent 1px ${HOUR_PX}px)`,
                }}
              >
                {/* Half-hour slots: click an empty one to propose an event there. */}
                {canCreate &&
                  Array.from({ length: rows * 2 }, (_, i) => {
                    const minute = START_HOUR * 60 + i * 30
                    return (
                      <button
                        key={i}
                        type="button"
                        tabIndex={-1}
                        aria-label={`Propose an event on ${d.date} at ${label(minute)}`}
                        onClick={() => openSlot(d.date, minute)}
                        className="absolute left-0 right-0 cursor-copy transition-colors hover:bg-[--shell-item-hover]"
                        style={{ top: i * (HOUR_PX / 2), height: HOUR_PX / 2 }}
                      />
                    )
                  })}

                {placed.map(({ e, top, height, col, cols, startMin, endMin, writeEndMin }) => {
                  const sw = clubSwatch(e.org)
                  const isDragging = drag?.id === e.id
                  const onThisDay = !isDragging || drag!.date === d.date
                  if (isDragging && !onThisDay) return null
                  const liveStart = isDragging ? drag!.start : startMin
                  const liveEnd = isDragging ? drag!.end : endMin
                  const liveTop = isDragging ? (liveStart - START_HOUR * 60) * PX_PER_MIN : top
                  const liveHeight = isDragging
                    ? Math.max(20, (liveEnd - liveStart) * PX_PER_MIN - 2)
                    : height
                  const widthPct = 100 / cols
                  const saving = pending[e.id] != null && !isDragging

                  return (
                    <div
                      key={e.id}
                      data-event-id={e.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${e.title}, ${e.org}, ${label(startMin)} to ${label(endMin)}${
                        e.venue ? `, ${e.venue}` : ""
                      }${
                        e.editable
                          ? ". Drag to reschedule, or use arrow keys. Hold Alt with up or down to change how long it runs. Open it to change the time without dragging."
                          : ""
                      }`}
                      onPointerDown={(ev) =>
                        e.editable && beginDrag(ev, "move", e.id, d.date, startMin, endMin, writeEndMin)
                      }
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault()
                          setInspect(e.id)
                          return
                        }
                        nudge(ev, e.id, d.date, startMin, writeEndMin, e.editable)
                      }}
                      onClick={() => {
                        // `drag` is already null by the time the click lands —
                        // pointerup clears it — so testing drag?.moved here
                        // always passed and every completed drag also opened the
                        // inspector. The ref survives that teardown.
                        if (draggedRef.current) {
                          draggedRef.current = false
                          return
                        }
                        setInspect(e.id)
                      }}
                      className={`cal-chip absolute overflow-hidden rounded-md border-l-[3px] px-2 py-1 text-[12px] leading-tight outline-none focus-visible:ring-2 focus-visible:ring-[--border-focus] ${
                        e.editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
                      } ${isDragging ? "z-dragged opacity-90 shadow-md" : "shadow-xs"} ${saving ? "opacity-70" : ""}`}
                      style={{
                        ...sw.vars,
                        top: liveTop,
                        height: liveHeight,
                        left: `calc(${col * widthPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        touchAction: "none",
                      }}
                    >
                      {/* Resize handles — top and bottom edges.
                          Named rather than `aria-hidden`: they were the only
                          way to change a duration and they announced nothing,
                          so a reader was not told the affordance existed, let
                          alone that there was another route to it. They stay
                          non-focusable spans — the keyboard path is Alt+Arrow
                          on the chip itself and the pointer path is in the
                          inspector, so a 6px tab stop would be a WCAG 2.5.8
                          target-size failure offering nothing. */}
                      {e.editable && (
                        <>
                          <span
                            role="img"
                            aria-label={`Drag to change when ${e.title} starts. Not needed: open the event to set the time without dragging.`}
                            onPointerDown={(ev) =>
                              beginDrag(ev, "resize-start", e.id, d.date, startMin, endMin, writeEndMin)
                            }
                            className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
                          />
                          <span
                            role="img"
                            aria-label={`Drag to change how long ${e.title} runs, or hold Alt and press the down arrow.`}
                            onPointerDown={(ev) =>
                              beginDrag(ev, "resize-end", e.id, d.date, startMin, endMin, writeEndMin)
                            }
                            className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                          />
                        </>
                      )}
                      <span className="block truncate font-semibold">{e.title}</span>
                      {liveHeight > 30 && (
                        <span className="block truncate opacity-80">
                          {label(liveStart)}
                          {e.venue ? ` · ${e.venue}` : ""}
                        </span>
                      )}
                    </div>
                  )
                })}

                {/* "+N more" — the tail of an over-full cluster. */}
                {layout.overflows.map((g) => {
                  const widthPct = 100 / g.cols
                  return (
                    <button
                      key={`of-${d.date}-${g.startMin}`}
                      type="button"
                      onClick={() => setExpanded({ date: d.date, events: g.events })}
                      className="absolute overflow-hidden rounded-md border border-dashed border-[--border-strong] bg-surface px-1.5 py-1 text-[11px] font-semibold leading-tight text-text-2 outline-none transition-colors hover:border-[--primary] hover:text-text-1 focus-visible:ring-2 focus-visible:ring-[--border-focus]"
                      style={{
                        top: (g.startMin - START_HOUR * 60) * PX_PER_MIN,
                        height: Math.max(20, (g.endMin - g.startMin) * PX_PER_MIN - 2),
                        left: `calc(${g.col * widthPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                      }}
                    >
                      +{g.events.length} more
                    </button>
                  )
                })}
              </div>
            )
          })}

          {/* Current-time line — a dot in the gutter and a hairline across the
              days, positioned from the institution's clock. */}
          {showNow && (
            <div
              className="pointer-events-none absolute z-marker flex items-center"
              // translateY(-50%) is load-bearing: `top` positions the top edge
              // of this flex row, but the hairline is centred inside it, so
              // without the shift the line drew ~7.5px — about nine minutes —
              // later than the time it claims to mark.
              style={{ top: nowY!, left: 0, right: 0, transform: "translateY(-50%)" }}
            >
              <span
                // Opaque plate: the label sits in the gutter directly over an
                // hour label for roughly half of every hour.
                className="shrink-0 rounded bg-surface px-1 text-[10px] font-semibold tabular-nums text-[--error]"
                style={{ width: GUTTER_PX, textAlign: "right" }}
              >
                {formatInZone(now!, timeZone, { hour: "numeric", minute: "2-digit" })}
              </span>
              <span
                className="h-2 w-2 shrink-0 -translate-x-1 rounded-full"
                style={{ background: "var(--error)" }}
              />
              <div className="h-px flex-1" style={{ background: "var(--error)" }} />
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <Overlay
          isOpen
          onOpenChange={(open) => !open && setExpanded(null)}
          size="sm"
          title={formatDateKey(expanded.date, { weekday: "long", month: "long", day: "numeric" })}
          description={`${expanded.events.length} overlapping events`}
        >
          <ul className="space-y-2">
            {expanded.events
              .slice()
              .sort((a, b) => a.startISO.localeCompare(b.startISO))
              .map((e) => {
                const sw = clubSwatch(e.org)
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setExpanded(null)
                        setInspect(e.id)
                      }}
                      className="cal-chip flex w-full items-start gap-2 rounded-md border-l-[3px] px-2.5 py-2 text-left text-[13px] outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[--border-focus]"
                      style={sw.vars}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{e.title}</span>
                        <span className="block truncate opacity-80">
                          {label(minutesOfDayInZone(new Date(e.startISO), timeZone))} · {e.org}
                          {e.venue ? ` · ${e.venue}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
          </ul>
        </Overlay>
      )}

      {inspect && (
        <EventInspector
          eventId={inspect}
          timeZone={timeZone}
          onClose={() => setInspect(null)}
          onSaved={() => {
            setInspect(null)
            router.refresh()
          }}
          // SC 2.5.7. Resolved from `effective` rather than from the layout, so
          // an event folded into a "+N more" cluster resizes exactly like one
          // that is drawn — a hidden chip is not a less accessible chip.
          onResize={(deltaMinutes) => {
            const e = effective.find((x) => x.id === inspect)
            if (!e || !e.editable) return
            const start = new Date(e.startISO)
            const date = dateKeyInZone(start, timeZone)
            const startMin = minutesOfDayInZone(start, timeZone)
            const span = Math.max(
              MIN_EVENT_MIN,
              Math.round((new Date(e.endISO).getTime() - start.getTime()) / 60000)
            )
            resizeEnd(e.id, date, startMin, startMin + span, deltaMinutes)
          }}
        />
      )}
    </div>
  )
}
