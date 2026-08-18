/**
 * IER-040-006 — "Never execute formulas and prevent CSV/formula injection on
 * import/export."
 *
 * IER-050-006 — "Produce row-level safe error output and remediation."
 *
 * IER-040-009 — "Keep raw values out of logs and ordinary evidence."
 *
 * The one door an uploaded spreadsheet walks through before any *feature* code
 * sees a value.
 *
 * `safe-workbook.ts` answers "what does this cell actually contain"; this module
 * answers the two questions a feature then has: *what grid do I work on*, and
 * *what do I tell the person about the cells I could not honour*. Before it
 * existed there was a second answer to the first question —
 * `components/finance/BudgetUpload.tsx` did its own `XLSX.read(buf, { type:
 * "array" })` followed by `XLSX.utils.sheet_to_json(sheet, { header: 1, defval:
 * "" })`, in the browser, with none of the admission checks the server path
 * grew. The repository already carries a note about what having two parsers
 * cost; this is that note applied to the one parser that was left.
 *
 * ## A formula is reported, never resolved
 *
 * `sheet_to_json` returns whatever the authoring application last cached in a
 * formula cell. That number is not a value any source asserted — it is the
 * result of an evaluation performed somewhere this system cannot see, by a
 * formula that may reference a file, a web query or a workbook that no longer
 * exists. Importing it as data collapses "we computed this" into "they told us
 * this". So the grid carries the formula's own text (via `displayCell`) and the
 * import carries an issue saying which cell it was and what to do about it.
 * That is the difference this codebase keeps finding between "we looked and
 * found nothing" and "we could not look".
 *
 * ## Issues locate a cell and describe it; they never quote it
 *
 * Every `ImportIssue` carries a sheet, a 1-based row, an A1 column letter, the
 * rule, a remediation sentence, and a `shape` — "text, 42 characters" — and
 * nothing else. That is enough for the person holding the file to find the cell
 * and not enough for the string to be evidence of what the cell said. A row
 * error that quotes the row is a roster leak wearing an error message's
 * clothing; `issueForEvidence` narrows it further for anything durable.
 */

import { displayCell, isFormulaLike, readWorkbookSafely, type SafeCell } from "./safe-workbook"
import type { AdmissionRefusalReason } from "./workbook-admission"

/**
 * How many issues are reported. A file where every cell is wrong would
 * otherwise produce an issue list larger than the file.
 *
 * The count of what was found is reported separately and is never capped, so a
 * truncated list still says how much it is a list *of*.
 */
export const MAX_REPORTED_ISSUES = 100

export type ImportIssueCode =
  /** The cell states a formula. Its text is imported; its cached value is not. */
  | "FORMULA_NOT_EVALUATED"
  /** Stored text that a spreadsheet would read back as a formula on export. */
  | "FORMULA_LIKE_TEXT"
  /** An Excel error value (`#REF!`, `#DIV/0!`). Emphatically not an empty cell. */
  | "CELL_ERROR"
  /** Excel's 1900-02-29 — a date-formatted serial for a day that never existed. */
  | "IMPOSSIBLE_DATE"
  /** The sheet had more rows than the row limit reads. */
  | "ROWS_TRUNCATED"
  /** The sheet had more columns than the column limit reads. */
  | "COLUMNS_TRUNCATED"
  /** The workbook had more sheets than the sheet limit reads. */
  | "SHEETS_TRUNCATED"
  /** The whole-workbook cell budget stopped the read. */
  | "CELLS_TRUNCATED"

export interface ImportIssue {
  code: ImportIssueCode
  /** The sheet, or null when the issue is about the file rather than a cell. */
  sheet: string | null
  /** 1-based spreadsheet row, as the person sees it. Null for a file-level issue. */
  row: number | null
  /** A1 column letter. Null when the issue is not about one cell. */
  column: string | null
  /** The rule, in one literal sentence. Never assembled from file content. */
  rule: string
  /** What to do about it, in one literal sentence. */
  remediation: string
  /** The value's shape. Never the value. */
  shape: string
}

/** Why no grid came back. `NO_SHEET` is this module's; the rest are admission's. */
export type TabularRefusalReason = AdmissionRefusalReason | "UNREADABLE" | "NO_SHEET"

export type TabularImport =
  | {
      ok: true
      /** The sheet the grid came from. */
      sheetName: string
      /** Row-major display values, ready for a feature parser. */
      grid: (string | number)[][]
      /** Up to `MAX_REPORTED_ISSUES` of them, in reading order. */
      issues: readonly ImportIssue[]
      /** Every issue found, including the ones past the cap. */
      issuesFound: number
      /** True when `issues` is shorter than `issuesFound`. */
      issuesTruncated: boolean
    }
  | { ok: false; reason: TabularRefusalReason; detail: string }

/**
 * The A1 column letter for a 0-based index. 0 → A, 25 → Z, 26 → AA.
 *
 * Spreadsheet columns are bijective base-26: there is no zero digit, so the
 * usual base conversion is off by one at every carry and produces `A@` for 26.
 */
export function columnLabel(index: number): string {
  let n = index + 1
  let out = ""
  while (n > 0) {
    const remainder = (n - 1) % 26
    out = String.fromCharCode(65 + remainder) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/** Plain signed decimals, with or without thousands separators. */
const PLAIN_NUMBER = /^[+-]?\d[\d,]*(\.\d+)?$/

/**
 * A safe description of what a cell holds. Length and kind, never content.
 *
 * A length is a shape, not a value: it narrows a cell to nothing an attacker or
 * an over-broad log reader can act on, while still letting somebody looking at
 * their own file tell an empty cell from a long one.
 */
export function cellShape(cell: SafeCell): string {
  switch (cell.kind) {
    case "empty":
      return "empty"
    case "text":
      return `text, ${cell.text.length} character${cell.text.length === 1 ? "" : "s"}`
    case "number":
      return "number"
    case "boolean":
      return "boolean"
    case "date":
      return "date"
    case "impossibleDate":
      return "a date-formatted serial for a day that never existed"
    case "formula":
      return `formula, ${cell.source.length} character${cell.source.length === 1 ? "" : "s"}${
        cell.cachedText === null ? ", no cached value" : ", with a cached value"
      }`
    case "error":
      return "a spreadsheet error value"
  }
}

/**
 * The issue a cell raises, or null when it raises none.
 *
 * Exported so a caller can classify a cell it obtained some other way, and so
 * the rule text lives in exactly one place rather than once per surface.
 */
export function issueForCell(cell: SafeCell, sheet: string, rowIndex: number, columnIndex: number): ImportIssue | null {
  const at = { sheet, row: rowIndex + 1, column: columnLabel(columnIndex), shape: cellShape(cell) }

  switch (cell.kind) {
    case "formula":
      return {
        ...at,
        code: "FORMULA_NOT_EVALUATED",
        rule: "A formula is imported as the text it is, never as the value an authoring application last cached for it.",
        remediation:
          "Replace the formula with its result in the file (copy, then paste as values) and upload it again.",
      }
    case "error":
      return {
        ...at,
        code: "CELL_ERROR",
        rule: "A cell holding a spreadsheet error has no value to import, and is not the same thing as an empty cell.",
        remediation: "Fix the cell in the file, or clear it if the row is meant to be blank, and upload it again.",
      }
    case "impossibleDate":
      return {
        ...at,
        code: "IMPOSSIBLE_DATE",
        rule: "The 1900 date system contains 1900-02-29, a day that never existed, so this serial names no date.",
        remediation: "Retype the date in this cell and upload the file again.",
      }
    case "text":
      // A leading sign in front of a plain number is the one formula leader a
      // spreadsheet resolves to the number itself, so reporting it would bury
      // the cells that matter under every negative amount in the file. Anything
      // else with a leader is an expression, and is reported.
      if (cell.formulaLike && !PLAIN_NUMBER.test(cell.text)) {
        return {
          ...at,
          code: "FORMULA_LIKE_TEXT",
          rule: "This text starts with a character a spreadsheet reads as the start of a formula, so it would become executable in an export.",
          remediation:
            "The value is imported unchanged and is neutralised on the way out; remove the leading character in the file if it was not deliberate.",
        }
      }
      return null
    default:
      return null
  }
}

/** `isFormulaLike` for a display value, so an exporter and this agree by construction. */
export function displayIsFormulaLike(value: string | number): boolean {
  return typeof value === "string" && isFormulaLike(value)
}

/**
 * Narrow an issue to what may be kept durably — no sheet name, no lengths.
 *
 * A sheet name and a value length are both fine in front of the person who just
 * chose the file: they own it and they are looking at it. Neither belongs in an
 * audit row or a metric that outlives the upload, where the reader is not the
 * uploader and the retention is not the file's. What survives is the rule that
 * fired and where, which is what a durable record is for.
 */
export function issueForEvidence(issue: ImportIssue): {
  code: ImportIssueCode
  row: number | null
  column: string | null
} {
  return { code: issue.code, row: issue.row, column: issue.column }
}

/**
 * Read an uploaded spreadsheet or delimited file into a grid and a list of
 * everything about it that could not be honoured.
 *
 * Never throws. Container refusals arrive from `admitWorkbook` with their own
 * literal sentence and are passed through unchanged.
 */
export function readTabularUpload(
  bytes: Uint8Array,
  opts: { mime: string; sheetName?: string },
): TabularImport {
  const read = readWorkbookSafely(bytes, { mime: opts.mime })
  if (!read.ok) return { ok: false, reason: read.reason, detail: read.detail }

  const sheet =
    opts.sheetName === undefined
      ? read.sheets[0]
      : read.sheets.find((candidate) => candidate.name === opts.sheetName)

  if (!sheet) {
    return {
      ok: false,
      reason: "NO_SHEET",
      // Says nothing about which sheets the file does have: a sheet name is
      // content, and a caller that asked for one it did not get already knows
      // what it asked for.
      detail: "This file has no sheet to read.",
    }
  }

  const issues: ImportIssue[] = []
  let issuesFound = 0
  const add = (issue: ImportIssue): void => {
    issuesFound += 1
    if (issues.length < MAX_REPORTED_ISSUES) issues.push(issue)
  }

  // File-level issues first: a truncated read is the one thing a reader must
  // know before they trust a count taken from the grid.
  if (read.sheetsTruncated) {
    add(fileIssue("SHEETS_TRUNCATED", "This file has more sheets than the ingestion limit reads.", "Split the workbook, or upload the sheet you need as its own file."))
  }
  if (read.cellsTruncated) {
    add(fileIssue("CELLS_TRUNCATED", "The whole-workbook cell budget stopped the read before the end of the file.", "Split the file into smaller uploads, or use a governed connector for a file this size."))
  }
  if (sheet.rowsTruncated) {
    add({ ...fileIssue("ROWS_TRUNCATED", "This sheet has more rows than the ingestion limit reads, so rows past the limit were not read at all.", "Split the sheet, or use a governed connector for a file this size."), sheet: sheet.name })
  }
  if (sheet.columnsTruncated) {
    add({ ...fileIssue("COLUMNS_TRUNCATED", "This sheet has more columns than the ingestion limit reads, so columns past the limit were not read at all.", "Remove the unused columns, or split the sheet."), sheet: sheet.name })
  }

  const grid: (string | number)[][] = []
  for (const [rowIndex, row] of sheet.cells.entries()) {
    const out: (string | number)[] = []
    for (const [columnIndex, cell] of row.entries()) {
      const issue = issueForCell(cell, sheet.name, rowIndex, columnIndex)
      if (issue) add(issue)
      out.push(displayCell(cell))
    }
    grid.push(out)
  }

  return {
    ok: true,
    sheetName: sheet.name,
    grid,
    issues,
    issuesFound,
    issuesTruncated: issuesFound > issues.length,
  }
}

function fileIssue(code: ImportIssueCode, rule: string, remediation: string): ImportIssue {
  return { code, sheet: null, row: null, column: null, rule, remediation, shape: "whole file" }
}
