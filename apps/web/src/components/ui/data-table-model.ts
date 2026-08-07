/**
 * TTES-020-002-GRID — the sort and projection half of the owned grid contract,
 * kept out of the markup so it can be tested without a DOM.
 *
 * `apps/web/jest.config.js` runs `testEnvironment: "node"` with no
 * `@testing-library`, which is a real constraint and not an accident: putting
 * the comparator here means the ordering rule is provable, and the component
 * beside it stays markup. The bug this shape catches is the classic one — a
 * comparator that reads the sort KEY and forgets the DIRECTION, which looks
 * right in a screenshot and is wrong for half of every column.
 */

export type SortDirection = "asc" | "desc"

export interface SortState {
  key: string
  direction: SortDirection
}

/** The part of a column the model needs. The renderer adds `cell` on top. */
export interface SortableColumn<T> {
  key: string
  /** Sortable columns supply the value to order on. Absent means not sortable. */
  sortValue?: (row: T) => string | number | Date | null | undefined
}

/** What a cell the viewer may not see renders instead. Never an empty cell. */
export const REDACTION_MARKER = "—"

/**
 * Sorts a copy of `rows`.
 *
 * Nullish values sort last in BOTH directions rather than flipping to the top
 * on a descending sort: "no value" is not the largest value, and a descending
 * audit view whose first forty rows are blanks is a view nobody reads twice.
 */
export function sortRows<T>(
  rows: readonly T[],
  columns: readonly SortableColumn<T>[],
  sort: SortState | null,
): T[] {
  const out = [...rows]
  if (!sort) return out
  const column = columns.find((c) => c.key === sort.key)
  if (!column?.sortValue) return out

  const read = column.sortValue
  const sign = sort.direction === "desc" ? -1 : 1

  return out.sort((a, b) => {
    const av = normalize(read(a))
    const bv = normalize(read(b))
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * sign
    return String(av).localeCompare(String(bv), undefined, { numeric: true }) * sign
  })
}

function normalize(value: string | number | Date | null | undefined): string | number | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === "string" && value.trim() === "") return null
  return value
}

/**
 * What clicking a header does: unsorted → ascending → descending → unsorted.
 *
 * The third state exists because "back to the order the query returned" is a
 * thing people want and a two-state toggle cannot express — on an audit log,
 * the default order is newest-first and is the most useful one.
 */
export function nextSort(current: SortState | null, key: string): SortState | null {
  if (!current || current.key !== key) return { key, direction: "asc" }
  if (current.direction === "asc") return { key, direction: "desc" }
  return null
}

/** `aria-sort` for one header, from the table's single sort state. */
export function ariaSortFor(
  columnKey: string,
  sort: SortState | null,
): "ascending" | "descending" | "none" {
  if (!sort || sort.key !== columnKey) return "none"
  return sort.direction === "asc" ? "ascending" : "descending"
}

/** Parses the `?sort=key:dir` form used in URLs, refusing anything else. */
export function parseSortParam(raw: string | undefined | null): SortState | null {
  if (!raw) return null
  const [key, direction] = raw.split(":")
  if (!key) return null
  if (direction !== "asc" && direction !== "desc") return null
  return { key, direction }
}

/** The inverse, so a link and the parser cannot disagree about the format. */
export function formatSortParam(sort: SortState | null): string | null {
  return sort ? `${sort.key}:${sort.direction}` : null
}
