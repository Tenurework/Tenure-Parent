/**
 * IER-040-006 / IER-050-005 — the one door a workbook is read through.
 *
 * `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`
 * §9.1: "Never evaluate formulas. Treat formula-looking cells as untrusted text
 * and prevent CSV/formula injection in exports." §10.2 and §10.3 add the other
 * half — a source person ID is a string, and a date carries explicit ISO and
 * timezone semantics:
 *
 *   > Source person IDs are strings, never numbers … dates are ISO-8601 with
 *   > stated timezone semantics.
 *
 * Both halves are lost in the same one line of ordinary SheetJS use:
 *
 *     XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })
 *
 * That returns a grid of JavaScript values, and the type information — was this
 * a string, a number, a date, a formula, an error — is gone by the time the
 * caller sees it. `"00417"` typed into a General cell comes back `417`; a date
 * comes back as an Excel serial or, with `cellDates`, as a `Date` built in the
 * *server's* local zone, so the same file read in two regions yields two days.
 *
 * ## What this does instead
 *
 * It reads cells, not rows. Every cell becomes a tagged `SafeCell`, so a caller
 * cannot confuse an identifier with a quantity, cannot mistake an Excel error
 * for an empty cell, and cannot receive a date without also receiving what its
 * timezone semantics are.
 *
 * ## `FLOATING_CIVIL` is the honest answer, not a placeholder
 *
 * A workbook records no UTC offset. None. A cell reading `2026-09-01` means the
 * first of September wherever the person filling it in was standing, and every
 * library that hands back an instant has invented an offset to do it. So a date
 * cell becomes an ISO-8601 *civil* string with no `Z` and no offset, tagged
 * `FLOATING_CIVIL`, and resolving it to an instant is the caller's decision made
 * against a stated institution timezone. "We do not know the offset" and "the
 * offset is the server's" are different answers, and this returns the true one.
 */

import * as XLSX from "xlsx"

import { admitWorkbook, WORKBOOK_LIMITS, type AdmissionRefusalReason } from "./workbook-admission"

/**
 * The SheetJS options this pipeline reads with, exported so they are assertable.
 *
 * `cellFormula: false` is the security control: with it, a formula cell yields
 * its cached value and its source is not retained, so there is no string in the
 * result that a later export could turn back into a live formula.
 *
 * `bookVBA: false` and `bookDeps: false` keep macro storage and the dependency
 * graph out of the parsed object entirely — belt to `admitWorkbook`'s braces,
 * which refuses a workbook carrying either.
 *
 * `cellDates: false` is deliberate and is the point of `FLOATING_CIVIL`: it
 * keeps SheetJS from constructing a `Date`, because constructing one requires an
 * offset the file does not contain.
 *
 * `cellNF: true` is required, not cosmetic — the number format is the only thing
 * that distinguishes serial 46000 the date from 46000 the amount.
 */
export const SAFE_READ_OPTIONS: XLSX.ParsingOptions = {
  type: "array",
  cellFormula: false,
  cellHTML: false,
  cellDates: false,
  cellNF: true,
  cellText: true,
  bookVBA: false,
  bookDeps: false,
  sheetStubs: false,
}

export type DateSemantics = "FLOATING_CIVIL"

export type SafeCell =
  /** No cell, or a cell with no value. Distinct from an error and from "". */
  | { kind: "empty" }
  /**
   * Text, exactly as stored. An identifier arrives here and stays a string.
   * `formulaLike` is true when a spreadsheet would read the text back as a
   * formula; it is reported so an exporter can neutralise it and is never acted
   * on here, because changing the value would corrupt the data to protect it.
   */
  | { kind: "text"; text: string; formulaLike: boolean }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  /** A date, as a civil ISO-8601 string. No offset, because the file has none. */
  | { kind: "date"; iso: string; semantics: DateSemantics }
  /**
   * A date-formatted serial of 60 under the 1900 system: Excel's 1900-02-29,
   * a day that never existed. Not an error cell and not a date.
   */
  | { kind: "impossibleDate"; serial: number }
  /**
   * A cell the file states as a formula, kept as untrusted text and never
   * evaluated.
   *
   * `SAFE_READ_OPTIONS` sets `cellFormula: false`, which the XLSX reader honours
   * — so on that path a formula cell arrives as its cached value and this kind
   * never appears. SheetJS's **CSV** reader ignores the option: a line reading
   * `=HYPERLINK("http://x"),ok` yields `{ t: "n", f: 'HYPERLINK("http://x")' }`
   * with no cached value at all. Classifying that as a number produces `NaN`,
   * and classifying it as empty loses the fact that somebody put an executable
   * string in a roster file. So it gets its own kind: `source` is the text the
   * file contains, `=` restored, and `cachedText` is what the authoring
   * application last computed — offered separately because a computed value is
   * not a value any source asserted.
   */
  | { kind: "formula"; source: string; cachedText: string | null }
  /** An Excel error (`#REF!`, `#DIV/0!`). Emphatically not empty. */
  | { kind: "error" }

export interface SafeSheet {
  name: string
  /** Row-major, clipped to the row and column limits. */
  cells: SafeCell[][]
  /** True when the sheet had more rows than the limit reads. */
  rowsTruncated: boolean
  /** True when the sheet had more columns than the limit reads. */
  columnsTruncated: boolean
}

export type SafeWorkbook =
  | {
      ok: true
      sheets: SafeSheet[]
      /** True when the workbook had more sheets than the limit reads. */
      sheetsTruncated: boolean
      /** True when the whole-workbook cell budget stopped the read. */
      cellsTruncated: boolean
    }
  | { ok: false; reason: AdmissionRefusalReason | "UNREADABLE"; detail: string }

/** The characters a spreadsheet reads as the start of a formula. */
const FORMULA_LEADERS = ["=", "+", "-", "@", "\t", "\r"] as const

/**
 * Would a spreadsheet read this text back as a formula?
 *
 * The same leader set `csvCell` in `src/components/charts/chart-table.ts`
 * neutralises on the way out. There are deliberately two expressions of it and
 * `safe-workbook.test.ts` runs both over the same characters and fails when they
 * disagree — the pattern `src/lib/identity/live-membership.ts` uses for the same
 * reason. Two definitions checked against each other are a different thing from
 * two definitions.
 */
export function isFormulaLike(text: string): boolean {
  return FORMULA_LEADERS.some((leader) => text.startsWith(leader))
}

/** Days between the Unix epoch and the 1900-system serial origin, Excel's leap-year bug included. */
const EXCEL_1900_OFFSET = 25569
/** The same, for serials at or below Excel's fictional 1900-02-29. */
const EXCEL_1900_OFFSET_BEFORE_BUG = 25568
/** Days between the Unix epoch and the 1904-system serial origin. */
const EXCEL_1904_OFFSET = 24107
/** Excel's non-existent 1900-02-29. */
const IMPOSSIBLE_SERIAL = 60

function two(n: number): string {
  return String(n).padStart(2, "0")
}

/**
 * An Excel serial as a civil ISO-8601 string.
 *
 * The arithmetic runs entirely in UTC and the result is read back with
 * `getUTC*`, so the host's timezone cannot reach the output. That is not
 * pedantry: with `cellDates` SheetJS builds a local `Date`, and a spec that
 * asserted a particular day would pass in one region and fail in another.
 *
 * Returns null for the one serial that is not a date.
 */
export function excelSerialToCivilIso(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial)) return null
  if (!date1904 && Math.floor(serial) === IMPOSSIBLE_SERIAL) return null

  const offset = date1904
    ? EXCEL_1904_OFFSET
    : serial < IMPOSSIBLE_SERIAL
      ? EXCEL_1900_OFFSET_BEFORE_BUG
      : EXCEL_1900_OFFSET

  const unixDays = serial - offset
  const whole = Math.floor(unixDays)
  // Round to the nearest millisecond before splitting: an Excel time is a
  // binary fraction of a day and 09:00 arrives as 0.375000000000001.
  const msIntoDay = Math.round((unixDays - whole) * 86_400_000)
  const at = new Date(whole * 86_400_000 + msIntoDay)
  if (Number.isNaN(at.getTime())) return null

  const day = `${at.getUTCFullYear()}-${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())}`
  if (msIntoDay === 0) return day

  const time = `${two(at.getUTCHours())}:${two(at.getUTCMinutes())}:${two(at.getUTCSeconds())}`
  const millis = at.getUTCMilliseconds()
  return `${day}T${time}${millis === 0 ? "" : `.${String(millis).padStart(3, "0")}`}`
}

/** Does this number format make the cell a date? */
function isDateFormat(format: unknown): boolean {
  if (typeof format !== "string" || format.length === 0) return false
  const ssf = (XLSX as unknown as { SSF?: { is_date?: (fmt: string) => boolean } }).SSF
  if (typeof ssf?.is_date === "function") return ssf.is_date(format)
  // Fallback for a build without SSF: the date tokens, outside a literal.
  return /[yYmMdDhHsS]/.test(format.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, ""))
}

/** The format string Excel uses to mean "this is text, whatever it looks like". */
const TEXT_FORMAT = "@"

/** One SheetJS cell as a tagged value. */
export function classifyCell(cell: XLSX.CellObject | undefined, date1904: boolean): SafeCell {
  if (!cell || cell.t === "z") return { kind: "empty" }

  // Before the type switch, because a formula cell carries a type describing the
  // value it would produce and this pipeline never produces it.
  if (typeof cell.f === "string" && cell.f.length > 0) {
    const cached = cell.v === undefined || cell.v === null ? null : String(cell.v)
    return { kind: "formula", source: `=${cell.f}`, cachedText: cached }
  }

  if (cell.t === "e") return { kind: "error" }
  if (cell.t === "b") return { kind: "boolean", value: Boolean(cell.v) }

  // `"str"` is not in SheetJS's published `ExcelDataType`, and its CSV and HTML
  // readers emit it anyway. Widening the comparison rather than narrowing the
  // check: a cell type the types say cannot happen still has to be classified as
  // something, and text is the only safe answer for one carrying a string.
  const cellType: string = cell.t
  if (cellType === "s" || cellType === "str") {
    const text = String(cell.v ?? "")
    return { kind: "text", text, formulaLike: isFormulaLike(text) }
  }

  if (cell.t === "d") {
    // Only reachable if someone passes `cellDates: true`. Read in UTC anyway, so
    // the option cannot change which day a spec sees.
    const at = cell.v instanceof Date ? cell.v : new Date(String(cell.v))
    if (Number.isNaN(at.getTime())) return { kind: "error" }
    const iso = `${at.getUTCFullYear()}-${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())}`
    return { kind: "date", iso, semantics: "FLOATING_CIVIL" }
  }

  if (cell.t === "n") {
    const value = Number(cell.v)
    if (isDateFormat(cell.z)) {
      const iso = excelSerialToCivilIso(value, date1904)
      if (iso === null) return { kind: "impossibleDate", serial: value }
      return { kind: "date", iso, semantics: "FLOATING_CIVIL" }
    }
    if (cell.z === TEXT_FORMAT) {
      // Stored as a number, formatted as text: an identifier somebody typed into
      // a text column. `w` is what the sheet shows, leading zeros included, and
      // the shown value is the identifier.
      const text = typeof cell.w === "string" && cell.w.length > 0 ? cell.w : String(value)
      return { kind: "text", text, formulaLike: isFormulaLike(text) }
    }
    return { kind: "number", value }
  }

  return { kind: "empty" }
}

/**
 * Read a workbook, or say which control refused it.
 *
 * Admission runs first and its refusal is returned unchanged — including its
 * `detail`, which is built from literal sentences and integers and carries
 * nothing out of the file.
 */
export function readWorkbookSafely(bytes: Uint8Array, opts: { mime: string }): SafeWorkbook {
  const admission = admitWorkbook(bytes, opts)
  if (!admission.admitted) return { ok: false, reason: admission.reason, detail: admission.detail }

  let book: XLSX.WorkBook
  try {
    book = XLSX.read(bytes, SAFE_READ_OPTIONS)
  } catch {
    // Deliberately says nothing about the exception. A parser message can quote
    // the bytes it choked on, and those bytes are roster data.
    return {
      ok: false,
      reason: "UNREADABLE",
      detail: "This file passed the container checks and then would not parse as a workbook.",
    }
  }

  const date1904 = Boolean(book.Workbook?.WBProps?.date1904)
  const names = book.SheetNames ?? []
  const sheets: SafeSheet[] = []
  let cellBudget = WORKBOOK_LIMITS.CELLS
  let cellsTruncated = false

  for (const name of names.slice(0, WORKBOOK_LIMITS.SHEETS)) {
    const sheet = book.Sheets[name]
    if (!sheet) continue

    const ref = sheet["!ref"]
    if (typeof ref !== "string" || ref.length === 0) {
      sheets.push({ name, cells: [], rowsTruncated: false, columnsTruncated: false })
      continue
    }

    const range = XLSX.utils.decode_range(ref)
    const lastRow = Math.min(range.e.r, range.s.r + WORKBOOK_LIMITS.ROWS_PER_SHEET - 1)
    const lastColumn = Math.min(range.e.c, range.s.c + WORKBOOK_LIMITS.COLUMNS_PER_SHEET - 1)

    const cells: SafeCell[][] = []
    for (let r = range.s.r; r <= lastRow; r++) {
      if (cellBudget <= 0) {
        cellsTruncated = true
        break
      }
      const row: SafeCell[] = []
      for (let c = range.s.c; c <= lastColumn; c++) {
        if (cellBudget <= 0) {
          cellsTruncated = true
          break
        }
        cellBudget--
        row.push(classifyCell(sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined, date1904))
      }
      cells.push(row)
    }

    sheets.push({
      name,
      cells,
      rowsTruncated: range.e.r > lastRow,
      columnsTruncated: range.e.c > lastColumn,
    })
  }

  return { ok: true, sheets, sheetsTruncated: names.length > WORKBOOK_LIMITS.SHEETS, cellsTruncated }
}

/**
 * A `SafeCell` as one display string or number.
 *
 * The lossy step, kept in one named place rather than spread through callers, so
 * a surface that needs the tag can still have it. A date renders as its civil
 * ISO string — the only rendering that does not imply an offset — and an error
 * renders as its Excel token rather than as an empty cell, because a reader who
 * cannot tell `#REF!` from blank will read a broken sheet as a sparse one.
 */
export function displayCell(cell: SafeCell): string | number {
  switch (cell.kind) {
    case "empty":
      return ""
    case "text":
      return cell.text
    case "number":
      return cell.value
    case "boolean":
      return cell.value ? "TRUE" : "FALSE"
    case "date":
      return cell.iso
    case "formula":
      // The text the file contains, shown as text. Not the cached value: a
      // reader who sees `4` cannot tell it came from a formula, and a reader who
      // sees `=2+2` can. Exporting this string is safe because `csvCell` in
      // `src/components/charts/chart-table.ts` neutralises the leader.
      return cell.source
    case "impossibleDate":
      return `#DATE(${cell.serial})`
    case "error":
      return "#ERROR"
  }
}
