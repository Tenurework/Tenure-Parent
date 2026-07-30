/** Friendly empty state — never a broken axis when there's no data. */
export function ChartEmpty({
  message = "No data yet",
  height = 160,
}: {
  message?: string
  height?: number
}) {
  return (
    <div
      className="flex items-center justify-center text-sm text-text-3"
      style={{ minHeight: height }}
    >
      {message}
    </div>
  )
}
