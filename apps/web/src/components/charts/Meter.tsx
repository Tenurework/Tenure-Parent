/**
 * A compact progress meter — the figure-tier "meter" for a single ratio (budget
 * used, seat fill). Server-compatible (no interactivity), so it drops straight
 * into server-rendered rails. The fill wears a chart token; when the ratio runs
 * over, it switches to the reserved error token. The track is a recessive
 * surface step, not a second data colour.
 */
export function Meter({
  pct,
  tone = "default",
  height = 6,
  className,
  ariaLabel,
}: {
  pct: number
  tone?: "default" | "over"
  height?: number
  className?: string
  ariaLabel?: string
}) {
  const w = Math.max(0, Math.min(100, pct))
  const fill = tone === "over" ? "var(--error)" : "var(--chart-1)"
  return (
    <div
      className={`w-full overflow-hidden rounded-full ${className ?? ""}`}
      style={{ height, background: "var(--bg-subtle)" }}
      role="progressbar"
      aria-valuenow={Math.round(w)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
    >
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: fill }} />
    </div>
  )
}
