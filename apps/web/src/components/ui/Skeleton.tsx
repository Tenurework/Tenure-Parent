/**
 * GE-143-022 — a skeleton whose geometry matches the content it stands in for.
 *
 * The point is not the shimmer. The point is that the box the placeholder
 * occupies is the box the loaded content will occupy, so nothing reflows when
 * the data lands. A generic "Loading…" card is one line tall; the table it
 * precedes is forty rows tall; and the gap between those two heights is a
 * layout shift that arrives exactly when someone has started reading — or, on
 * an approvals queue, exactly when their pointer is over a button that is about
 * to move. That is a real misclick, not a cosmetic one.
 *
 * So the caller states the geometry it is about to render — how many rows, how
 * tall each one is, the gap between them, an optional header strip, and the
 * relative widths of the columns — and `skeletonHeight` reserves precisely
 * that. The arithmetic is exported and tested separately from the markup
 * because an off-by-one on the gap count (rows * gap instead of (rows - 1) *
 * gap) is invisible on screen at small row counts and compounds at large ones.
 *
 * The skeleton is `aria-hidden`. A screen reader gets the polite "Loading"
 * announcement from the surrounding StateSurface once; it must not be read
 * forty empty bars.
 */

const DEFAULT_GAP = 8

export interface SkeletonGeometry {
  /** How many content rows the loaded surface will render. */
  rows: number
  /** The height of one loaded row, in px. */
  rowHeight: number
  /** Vertical gap between rows, in px. Defaults to 8 — matches `gap-2`. */
  gap?: number
  /** Height of a header or toolbar strip above the rows, in px. Omit if none. */
  headerHeight?: number
  /**
   * Relative column widths. `[3, 1, 1]` reserves half the width for the first
   * column. Omitted means one full-width column.
   */
  columns?: readonly number[]
}

/**
 * The exact height, in px, the loaded content will occupy.
 *
 * n rows have n - 1 gaps between them, not n. A header adds its own height
 * plus one more gap, and only when there are rows beneath it to be separated
 * from. Zero rows reserve nothing beyond the header.
 */
export function skeletonHeight(geometry: SkeletonGeometry): number {
  const rows = Math.max(0, Math.floor(geometry.rows))
  const rowHeight = Math.max(0, geometry.rowHeight)
  const gap = Math.max(0, geometry.gap ?? DEFAULT_GAP)
  const header = Math.max(0, geometry.headerHeight ?? 0)

  const rowBlock = rows > 0 ? rows * rowHeight + (rows - 1) * gap : 0
  if (header === 0) return rowBlock
  return rows > 0 ? header + gap + rowBlock : header
}

/**
 * Column weights normalised to fractions of the row's width, summing to 1.
 *
 * Returned as `flex-grow` values rather than percentages so the inter-column
 * gaps come out of the flex layout instead of overflowing a 100% total. A
 * caller passing garbage — zeroes, negatives, NaN — gets equal columns rather
 * than a collapsed row, because a placeholder is never worth an exception.
 */
export function skeletonColumnShares(columns?: readonly number[]): number[] {
  const raw = columns && columns.length > 0 ? columns : [1]
  const weights = raw.map((w) => (Number.isFinite(w) && w > 0 ? w : 0))
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return weights.map(() => 1 / weights.length)
  return weights.map((w) => w / total)
}

export function Skeleton({
  geometry,
  className,
}: {
  geometry: SkeletonGeometry
  className?: string
}) {
  const rows = Math.max(0, Math.floor(geometry.rows))
  const gap = Math.max(0, geometry.gap ?? DEFAULT_GAP)
  const rowHeight = Math.max(0, geometry.rowHeight)
  const header = Math.max(0, geometry.headerHeight ?? 0)
  const shares = skeletonColumnShares(geometry.columns)
  const height = skeletonHeight(geometry)

  return (
    <div
      className={["skeleton flex flex-col", className].filter(Boolean).join(" ")}
      // Both, deliberately. `height` is what stops the reflow; `minHeight`
      // stops a flex or grid parent from compressing the reservation away and
      // reintroducing the shift this component exists to remove.
      style={{ height, minHeight: height, gap }}
      data-skeleton-height={height}
      data-skeleton-rows={rows}
      // Decorative. The announcement belongs to the surface around it.
      aria-hidden="true"
    >
      {header > 0 ? (
        <div
          className="skeleton-header animate-pulse rounded-sm bg-subtle"
          style={{ height: header, flex: "0 0 auto" }}
        />
      ) : null}

      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className="skeleton-row flex"
          style={{ height: rowHeight, flex: "0 0 auto", gap }}
        >
          {shares.map((share, column) => (
            <div
              key={column}
              className="skeleton-cell animate-pulse rounded-sm bg-subtle"
              style={{ flexGrow: share, flexBasis: 0, minWidth: 0 }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
