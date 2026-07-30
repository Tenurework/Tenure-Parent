import Link from "next/link"
import { ChevronLeft, ChevronRight } from "@/components/ui/icons"
import { addDaysToKey, formatDateKey, parseDateKey } from "@/lib/time"

/**
 * Mini-month navigator for the calendar rail. Renders the month containing the
 * selected week; every date links the main view to the week containing it, the
 * displayed week is highlighted as a continuous pill, and today is a filled dot.
 *
 * Everything here is pure date-key arithmetic. The previous version built
 * `new Date()` objects and read `getUTCDate()` off them, so "today" was
 * whatever day it happened to be in UTC — wrong for the last five hours of
 * every evening in Rochester. Today now arrives already resolved in the
 * institution's zone.
 */
export function CalendarMiniMonth({
  baseKey,
  rangeStartKey,
  rangeEndKey,
  todayKey,
  filterQs,
}: {
  /** Any date in the month to display — the start of the shown week. */
  baseKey: string
  rangeStartKey: string
  rangeEndKey: string
  /** Today's date key, already resolved in the institution's timezone. */
  todayKey: string
  /** Active filter query string, carried onto every navigation link. */
  filterQs?: string
}) {
  const base = parseDateKey(baseKey)
  if (!base) return null

  const firstKey = `${base.year}-${String(base.month).padStart(2, "0")}-01`
  const firstWeekday = new Date(Date.UTC(base.year, base.month - 1, 1)).getUTCDay()
  const gridStartKey = addDaysToKey(firstKey, -firstWeekday)

  const href = (key: string) =>
    filterQs ? `/calendar?d=${key}&${filterQs}` : `/calendar?d=${key}`

  // Same day-of-month one month either side, clamped so the 31st cannot skip a
  // short month.
  const stepMonth = (delta: number) =>
    new Date(Date.UTC(base.year, base.month - 1 + delta, Math.min(base.day, 28)))
      .toISOString()
      .slice(0, 10)

  const cells = Array.from({ length: 42 }, (_, i) => addDaysToKey(gridStartKey, i))

  return (
    <div className="rounded-[10px] border border-border bg-surface p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-text-1">
          {formatDateKey(firstKey, { month: "long", year: "numeric" })}
        </span>
        <div className="flex items-center gap-0.5">
          <Link
            href={href(stepMonth(-1))}
            aria-label="Previous month"
            className="grid h-6 w-6 place-items-center rounded text-text-3 no-underline transition-colors hover:bg-base"
          >
            <ChevronLeft size={15} aria-hidden />
          </Link>
          <Link
            href={href(stepMonth(1))}
            aria-label="Next month"
            className="grid h-6 w-6 place-items-center rounded text-text-3 no-underline transition-colors hover:bg-base"
          >
            <ChevronRight size={15} aria-hidden />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span key={i} className="py-1 text-[10px] font-medium text-text-3" aria-hidden>
            {d}
          </span>
        ))}
        {cells.map((key) => {
          const isToday = key === todayKey
          const inMonth = key.slice(0, 7) === firstKey.slice(0, 7)
          const inRange = key >= rangeStartKey && key <= rangeEndKey
          return (
            <Link
              key={key}
              href={href(key)}
              aria-label={formatDateKey(key, { weekday: "long", month: "long", day: "numeric" })}
              aria-current={isToday ? "date" : undefined}
              className={`grid h-7 place-items-center text-[11px] tabular-nums no-underline transition-colors ${
                inRange
                  ? `bg-[--primary-light] ${key === rangeStartKey ? "rounded-l-md" : ""} ${
                      key === rangeEndKey ? "rounded-r-md" : ""
                    }`
                  : "rounded-md hover:bg-base"
              } ${inMonth ? "text-text-1" : "text-text-3"}`}
            >
              <span
                className={
                  isToday
                    ? "grid h-5 w-5 place-items-center rounded-full bg-[--primary] font-semibold text-[--primary-text]"
                    : ""
                }
              >
                {Number(key.slice(8, 10))}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
