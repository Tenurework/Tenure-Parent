"use client"

/**
 * Segmented pill control (This term / 12 months / All …). A local, self-contained
 * filter so the chart kit never depends on a shared control. Sits in ONE row
 * above the charts it scopes; the parent re-derives every chart against the
 * selected slice.
 */
export type RangeOption<T extends string> = { value: T; label: string }

export function RangeFilter<T extends string>({
  value,
  onChange,
  options,
  ariaLabel = "Time range",
}: {
  value: T
  onChange: (value: T) => void
  options: RangeOption<T>[]
  ariaLabel?: string
}) {
  return (
    <div
      data-testid="chart-range-filter"
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-full bg-subtle p-1"
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[--primary] ${
              active
                ? "bg-surface text-text-1 shadow-xs"
                : "text-text-2 hover:text-text-1"
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
