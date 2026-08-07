import { type ReactNode } from "react"
import Link from "next/link"

import {
  ariaSortFor,
  REDACTION_MARKER,
  sortRows,
  type SortState,
} from "@/components/ui/data-table-model"

/**
 * TTES-020-002-GRID — the one owned grid contract.
 *
 * What it replaces: seven hand-rolled `<table>` elements, each with its own
 * markup and none with a `<caption>`, a `scope` on any header, an `aria-sort`
 * anywhere, or a rule for a cell the viewer may not see. The densest of them —
 * the 200-row audit log — emitted six bare `<th>`, so a screen-reader user got
 * an unlabelled grid (WCAG 1.3.1) on the most detail-heavy surface in the
 * product.
 *
 * Three decisions worth stating:
 *
 *   * **`caption` is required.** A table with no accessible name is announced
 *     as "table, 6 columns, 200 rows" and nothing else. `captionVisible`
 *     controls whether it is drawn; it is always in the accessibility tree.
 *   * **Sorting is a link, not a click handler.** Every table this replaces is
 *     rendered on the server. A `sortHref` keeps this component server-safe,
 *     survives a reload, and is shareable — and the ORDER is computed by
 *     `sortRows` from `data-table-model.ts`, which is unit-tested without a DOM.
 *   * **Redaction renders a marker, never an absent row.** Dropping the row
 *     would tell the viewer the object does not exist, which is the enumeration
 *     leak the API refusals already avoid. `redact` blanks the cells the viewer
 *     may not read and leaves the row where it is.
 */

export interface Column<T> {
  key: string
  header: string
  /** What the cell renders. */
  cell: (row: T) => ReactNode
  /** Sortable columns supply the value to order on. Absent means not sortable. */
  sortValue?: (row: T) => string | number | Date | null | undefined
  /** Hidden behind the redaction marker when `redact(row)` says so. */
  redactable?: boolean
  align?: "start" | "end"
  className?: string
}

export function DataTable<T>({
  caption,
  captionVisible = false,
  columns,
  rows,
  rowKey,
  sort = null,
  sortHref,
  redact,
  className,
  tableClassName,
}: {
  /** Required. The table's accessible name; see the header. */
  caption: string
  captionVisible?: boolean
  columns: readonly Column<T>[]
  rows: readonly T[]
  rowKey: (row: T, index: number) => string
  /** The column and direction currently applied, if any. */
  sort?: SortState | null
  /**
   * Where a header links to in order to sort by its column. Supplying it is
   * what makes the headers sortable at all — a table with no route to a
   * different order should not advertise one.
   */
  sortHref?: (columnKey: string) => string
  /** True for a row whose `redactable` cells this viewer may not read. */
  redact?: (row: T) => boolean
  className?: string
  tableClassName?: string
}) {
  const ordered = sortRows(rows, columns, sort)

  return (
    <div className={`data-table overflow-x-auto ${className ?? ""}`}>
      <table
        className={`w-full text-sm ${tableClassName ?? ""}`}
        // Announced before the rows are read, so a reader knows how far the
        // grid goes rather than discovering it at row 200.
        aria-rowcount={ordered.length}
      >
        <caption
          className={
            captionVisible
              ? "px-5 py-2 text-left text-[13px] text-text-2"
              : "sr-only"
          }
        >
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-border text-left text-[13px] text-text-3">
            {columns.map((c) => {
              const sortable = Boolean(c.sortValue && sortHref)
              return (
                <th
                  key={c.key}
                  // Not optional. Without it a reader is not told which column
                  // a cell belongs to, which is the whole of WCAG 1.3.1 here.
                  scope="col"
                  aria-sort={sortable ? ariaSortFor(c.key, sort) : undefined}
                  className={`px-5 py-2.5 font-medium ${c.align === "end" ? "text-right" : ""} ${c.className ?? ""}`}
                >
                  {sortable ? (
                    <Link
                      href={sortHref!(c.key)}
                      className="inline-flex items-center gap-1 text-text-3 no-underline hover:text-text-1"
                    >
                      {c.header}
                      <span aria-hidden>
                        {sort?.key === c.key ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </Link>
                  ) : (
                    c.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {ordered.map((row, i) => {
            const hidden = redact?.(row) ?? false
            return (
              <tr key={rowKey(row, i)} className="border-b border-border align-top last:border-0">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-5 py-2.5 ${c.align === "end" ? "text-right" : ""} ${c.className ?? ""}`}
                  >
                    {hidden && c.redactable ? (
                      <>
                        <span aria-hidden>{REDACTION_MARKER}</span>
                        <span className="sr-only">Redacted — not visible from your seat</span>
                      </>
                    ) : (
                      c.cell(row)
                    )}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
