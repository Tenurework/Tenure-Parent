import type { ReactNode } from "react"

/**
 * The table shell: a bounded scroll region, a caption, a header row and cells.
 *
 * It is a SHELL. It does not sort, page, filter or fetch — the Studio's tables
 * are server-rendered from a URL (`fleet-filter.ts` turns a GET form into a
 * query string, so a filtered fleet view is a link somebody can send), and a
 * component that owned sorting would have to own that URL too.
 *
 * ## The scroll region is the point
 *
 * A wide table scrolls INSIDE its own border so the page never scrolls
 * sideways. `layout.spec.ts` runs every route at 1440, 1180, 900 and 320 CSS
 * pixels and treats a horizontally scrolling page as a defect (WCAG 2.2 AA
 * 1.4.10 reflow); the fleet view has sixteen columns and fits at none of those
 * widths. The visible border is the other half — without an edge, a table that
 * continues past the fold reads as a table that ends there.
 *
 * ## Why columns are data rather than markup
 *
 * `columns` is an array with a `cell` renderer per column, instead of the caller
 * writing `<tr><td>…` itself. That is what lets the header and the body be
 * derived from ONE declaration: a column added to the header and forgotten in
 * the body is not expressible, and neither is a cell that lands under the wrong
 * heading. In a console whose tables print account ids, ARNs and money, a row
 * shifted by one column is worse than a missing table.
 *
 * `align: "end"` is per column and reaches BOTH the `<th>` and every `<td>`,
 * because a right-aligned column of figures under a left-aligned heading is the
 * other half of the same defect.
 */

export interface DataColumn<Row> {
  /** Stable, unique, and the React key for the cell. Not the header text. */
  key: string
  header: ReactNode
  /**
   * `end` for figures read against a fixed unit — money, counts, durations. It
   * also switches on `tabular-nums`, so the digits line up column-wise.
   *
   * Logical, not physical: `layout.spec.ts` re-runs every route under
   * `dir="rtl"`, and `end` is the one alignment that stays correct there.
   */
  align?: "start" | "end"
  cell: (row: Row) => ReactNode
}

export interface DataTableProps<Row> {
  /**
   * Required, and rendered visibly.
   *
   * A table of eleven ARNs with no caption is a table nobody can describe, and
   * the reader who most needs the caption is the one hearing the page read
   * aloud. Visible rather than screen-reader-only because a sighted operator
   * scrolling past four tables needs it just as much.
   */
  caption: ReactNode
  columns: readonly DataColumn<Row>[]
  rows: readonly Row[]
  /**
   * The identity of a row, from the row itself.
   *
   * Not the array index. An index key makes React reuse the DOM of row 3 for
   * whatever lands at position 3 next, so a re-render after a filter change
   * leaves the previous row's expanded state, focus and selection attached to a
   * different tenant.
   */
  rowKey: (row: Row) => string
  /**
   * What to render when there are no rows. Required.
   *
   * An empty `<tbody>` is indistinguishable from a table that failed to load,
   * and the two have opposite next actions. `EmptyState` is the shape this
   * usually takes; the governed vocabulary in `components/states.tsx` is what
   * decides whether "empty" is even the right word for it — a denied read is
   * not an empty list.
   */
  empty: ReactNode
}

export function DataTable<Row>({ caption, columns, rows, rowKey, empty }: DataTableProps<Row>) {
  return (
    <div className="md3-table-shell">
      <table className="md3-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" data-align={column.align ?? "start"}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="md3-table-empty">
              {/*
                One cell spanning the whole width. A single `<td>` in a
                multi-column table leaves the row short, and a short row under a
                full-width header is a rendering artefact a reader has to
                interpret rather than an empty state they can read.
              */}
              <td colSpan={columns.length}>{empty}</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key} data-align={column.align ?? "start"}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
