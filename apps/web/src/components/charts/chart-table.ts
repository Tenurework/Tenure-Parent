/**
 * TTES-020-002-CHART-FRAME — the data behind a chart, as a table and as a file.
 *
 * Pure, and separate from `ChartFrame.tsx`, for one reason: the CSV rule below
 * is a security control and has to be provable without a browser.
 */

export interface TableSeries {
  name: string
  values: readonly number[]
}

export interface ChartTable {
  columns: string[]
  rows: (string | number)[][]
}

/**
 * The same numbers the marks plot, arranged the way a screen reader can read
 * them: one row per category, one column per series.
 *
 * The alternative the marks ship today is a per-point `aria-label`, which for a
 * thirty-day series is a thirty-stop focus tour and cannot be compared,
 * scanned, or read backwards.
 */
export function tableFromSeries(
  categories: readonly string[],
  series: readonly TableSeries[],
  categoryHeader = "Period",
): ChartTable {
  return {
    columns: [categoryHeader, ...series.map((s) => s.name)],
    rows: categories.map((category, i) => [
      category,
      // A series shorter than the category list is a bug upstream, not a
      // reason to shift every later row up by one. Missing reads as 0.
      ...series.map((s) => s.values[i] ?? 0),
    ]),
  }
}

/**
 * One CSV cell, escaped.
 *
 * ## Formula injection (Bible §12)
 *
 * A spreadsheet treats a cell beginning `=`, `+`, `-`, `@`, a tab or a carriage
 * return as a FORMULA, not as text. A club named `=HYPERLINK("http://…")`, or a
 * venue somebody typed with a leading `-`, becomes executable the moment an
 * officer opens the export — and the officer who opens it is the one with the
 * permissions worth stealing. Excel's own prompt says "this file contains
 * formulas that refer to other files", which reads like something the export
 * did rather than something the data did.
 *
 * The apostrophe prefix is the fix every spreadsheet honours: it forces the
 * cell to be read as text and is not shown as part of the value.
 *
 * Quoting is separate and both are needed: a cell containing a comma, a quote
 * or a newline has to be quoted or it silently becomes several cells.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ""
  const raw = String(value)
  // The dangerous leaders, including the two whitespace ones that survive a
  // paste and are invisible in a diff.
  const dangerous = /^[=+\-@\t\r]/.test(raw)
  const body = dangerous ? `'${raw}` : raw
  return /[",\n\r]/.test(body) ? `"${body.replace(/"/g, '""')}"` : body
}

/** The whole file, header row included. CRLF because Excel expects it. */
export function toCsv(table: ChartTable): string {
  return [table.columns, ...table.rows].map((row) => row.map(csvCell).join(",")).join("\r\n")
}
