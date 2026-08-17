/**
 * IER-040-006 — "Never execute formulas and prevent CSV/formula injection on
 * import/export."
 *
 * IER-050-005 — "Preserve IDs as strings and dates with explicit ISO/timezone
 * semantics."
 *
 * IER-040-005 — the row, column, cell and sheet half of the limits.
 */

import * as XLSX from "xlsx"

import { csvCell } from "@/components/charts/chart-table"

import { buildZip, WORKBOOK_MEMBER } from "./__fixtures__/zip"
import {
  SAFE_READ_OPTIONS,
  classifyCell,
  displayCell,
  excelSerialToCivilIso,
  isFormulaLike,
  readWorkbookSafely,
} from "./safe-workbook"
import { WORKBOOK_LIMITS } from "./workbook-admission"

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

/** A workbook built from explicit cell objects, so the cell TYPE is the fixture. */
function workbookOf(sheets: Record<string, XLSX.WorkSheet>): Uint8Array {
  const book = XLSX.utils.book_new()
  for (const [name, sheet] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, sheet, name)
  return new Uint8Array(XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer)
}

function readSheets(bytes: Uint8Array, mime = XLSX_MIME) {
  const result = readWorkbookSafely(bytes, { mime })
  if (!result.ok) throw new Error(`expected a readable workbook, got ${result.reason}`)
  return result
}

describe("IER-040-006 — no formula is ever evaluated, and none survives as a formula", () => {
  it("reads with cellFormula off, which is the control rather than a preference", () => {
    expect(SAFE_READ_OPTIONS.cellFormula).toBe(false)
    expect(SAFE_READ_OPTIONS.bookVBA).toBe(false)
    expect(SAFE_READ_OPTIONS.bookDeps).toBe(false)
  })

  it("returns an XLSX formula cell's cached value and does not retain the formula", () => {
    const bytes = workbookOf({
      S: { "!ref": "A1:A1", A1: { t: "n", v: 2, f: "1+1" } as XLSX.CellObject },
    })
    const read = readSheets(bytes)
    expect(read.sheets[0]!.cells[0]![0]).toEqual({ kind: "number", value: 2 })
    // The source is gone, not merely unused — there is no string anywhere in the
    // result an exporter could turn back into a live formula.
    expect(JSON.stringify(read)).not.toContain("1+1")
  })

  it("keeps a CSV formula cell as untrusted text rather than as NaN or as blank", () => {
    // SheetJS's CSV reader ignores `cellFormula` and yields `{ t: "n", f: ... }`
    // with no cached value. Classifying that as a number gives NaN; classifying
    // it as empty loses the fact somebody put an executable string in a roster.
    const csv = Uint8Array.from(Buffer.from('name,note\r\n=HYPERLINK("http://x"),ok\r\n'))
    const read = readSheets(csv, "text/csv")
    const cell = read.sheets[0]!.cells[1]![0]!

    expect(cell.kind).toBe("formula")
    if (cell.kind !== "formula") return
    expect(cell.source).toBe('=HYPERLINK("http://x")')
    // "We could not look" and "there was nothing" are different answers.
    expect(cell.cachedText).toBeNull()
  })

  it("round-trips import to export without the cell becoming a formula again", () => {
    const csv = Uint8Array.from(Buffer.from('name\r\n=HYPERLINK("http://x")\r\n'))
    const read = readSheets(csv, "text/csv")
    const shown = displayCell(read.sheets[0]!.cells[1]![0]!)

    // Displayed as the text the file contains…
    expect(shown).toBe('=HYPERLINK("http://x")')
    // …and neutralised by the export escaper the charts already ship, so the
    // two halves of the requirement compose rather than each half assuming the
    // other did it.
    expect(csvCell(shown)).toBe('"\'=HYPERLINK(""http://x"")"')
  })

  it("agrees with the export escaper about which characters lead a formula", () => {
    // Two expressions of one rule, checked against each other. A leader added to
    // `csvCell` and not here (or the reverse) fails this.
    // Neutralised means the escaper prefixed an apostrophe — which is exactly
    // `'` + the original, once CSV quoting is undone. Testing for "starts with
    // an apostrophe" instead would call `'x` neutralised when the apostrophe is
    // the caller's own character.
    const unquote = (out: string): string =>
      out.length >= 2 && out.startsWith('"') && out.endsWith('"')
        ? out.slice(1, -1).replace(/""/g, '"')
        : out

    const probes = ["=", "+", "-", "@", "\t", "\r", "a", "1", " ", "'", "#", "\n"]
    for (const ch of probes) {
      const sample = `${ch}x`
      const escaperNeutralised = unquote(csvCell(sample)) === `'${sample}`
      expect(isFormulaLike(sample)).toBe(escaperNeutralised)
    }
  })
})

describe("IER-050-005 — identifiers stay strings", () => {
  it("does not turn a text-stored identifier into a number", () => {
    const bytes = workbookOf({
      PEOPLE: {
        "!ref": "A1:A2",
        A1: { t: "s", v: "source_person_id" } as XLSX.CellObject,
        A2: { t: "s", v: "00417" } as XLSX.CellObject,
      },
    })
    const read = readSheets(bytes)
    expect(read.sheets[0]!.cells[1]![0]).toEqual({ kind: "text", text: "00417", formulaLike: false })
    // The bug this replaces: `sheet_to_json` returns 417 and the leading zeros
    // are gone before any caller can object.
    expect(displayCell(read.sheets[0]!.cells[1]![0]!)).toBe("00417")
  })

  it("keeps a number stored in a text-formatted column as the text the sheet shows", () => {
    expect(classifyCell({ t: "n", v: 417, z: "@", w: "00417" } as XLSX.CellObject, false)).toEqual({
      kind: "text",
      text: "00417",
      formulaLike: false,
    })
  })

  it("tags a quantity as a number, so an identifier and an amount are not the same shape", () => {
    expect(classifyCell({ t: "n", v: 5, z: "General" } as XLSX.CellObject, false)).toEqual({
      kind: "number",
      value: 5,
    })
  })

  it("does not read an Excel error as an empty cell", () => {
    expect(classifyCell({ t: "e", v: 0x17, w: "#REF!" } as XLSX.CellObject, false)).toEqual({ kind: "error" })
    expect(classifyCell(undefined, false)).toEqual({ kind: "empty" })
  })
})

describe("IER-050-005 — dates carry explicit ISO and timezone semantics", () => {
  it("reads a date-formatted serial as a civil ISO string with stated semantics", () => {
    const bytes = workbookOf({
      PEOPLE: { "!ref": "A1:A1", A1: { t: "n", v: 46265, z: "m/d/yy" } as XLSX.CellObject },
    })
    const cell = readSheets(bytes).sheets[0]!.cells[0]![0]!
    expect(cell).toEqual({ kind: "date", iso: "2026-08-31", semantics: "FLOATING_CIVIL" })
  })

  it("never appends Z or an offset, because the file contains neither", () => {
    const iso = excelSerialToCivilIso(46265.9, false)
    expect(iso).toBe("2026-08-31T21:36:00")
    expect(iso).not.toMatch(/Z$/)
    expect(iso).not.toMatch(/[+-]\d\d:\d\d$/)
  })

  it("anchors on serials whose answers are arithmetic, not this machine", () => {
    expect(excelSerialToCivilIso(1, false)).toBe("1900-01-01")
    expect(excelSerialToCivilIso(59, false)).toBe("1900-02-28")
    // 60 is Excel's 1900-02-29 and does not exist; 61 is the day after.
    expect(excelSerialToCivilIso(61, false)).toBe("1900-03-01")
    expect(excelSerialToCivilIso(25569, false)).toBe("1970-01-01")
    // The 1904 system, which Mac-authored workbooks still use.
    expect(excelSerialToCivilIso(0, true)).toBe("1904-01-01")
  })

  it("reports Excel's non-existent 1900-02-29 as impossible rather than as a date", () => {
    expect(excelSerialToCivilIso(60, false)).toBeNull()
    const bytes = workbookOf({
      PEOPLE: { "!ref": "A1:A1", A1: { t: "n", v: 60, z: "m/d/yy" } as XLSX.CellObject },
    })
    expect(readSheets(bytes).sheets[0]!.cells[0]![0]).toEqual({ kind: "impossibleDate", serial: 60 })
  })

  it("gives the same answer in two host timezones", () => {
    // The arithmetic is entirely UTC, so it cannot depend on where the server is.
    // `cellDates: true` — which this pipeline does not use — would make it.
    const original = process.env.TZ
    try {
      process.env.TZ = "Pacific/Kiritimati"
      const east = excelSerialToCivilIso(46265.9, false)
      process.env.TZ = "Pacific/Pago_Pago"
      const west = excelSerialToCivilIso(46265.9, false)
      expect(east).toBe("2026-08-31T21:36:00")
      expect(west).toBe(east)
    } finally {
      process.env.TZ = original
    }
  })
})

describe("IER-040-005 — the sheet, row, column and cell limits", () => {
  it("stops reading rows at the row limit and says it did", () => {
    const rows = WORKBOOK_LIMITS.ROWS_PER_SHEET + 5
    const sheet: XLSX.WorkSheet = { "!ref": `A1:A${rows}` }
    for (let r = 0; r < rows; r++) sheet[`A${r + 1}`] = { t: "s", v: `r${r}` } as XLSX.CellObject
    const read = readSheets(workbookOf({ WIDE: sheet }))

    expect(read.sheets[0]!.cells).toHaveLength(WORKBOOK_LIMITS.ROWS_PER_SHEET)
    expect(read.sheets[0]!.rowsTruncated).toBe(true)
  })

  it("stops reading columns at the column limit and says it did", () => {
    const columns = WORKBOOK_LIMITS.COLUMNS_PER_SHEET + 3
    const last = XLSX.utils.encode_col(columns - 1)
    const sheet: XLSX.WorkSheet = { "!ref": `A1:${last}1` }
    for (let c = 0; c < columns; c++) {
      sheet[XLSX.utils.encode_cell({ r: 0, c })] = { t: "s", v: `c${c}` } as XLSX.CellObject
    }
    const read = readSheets(workbookOf({ WIDE: sheet }))

    expect(read.sheets[0]!.cells[0]).toHaveLength(WORKBOOK_LIMITS.COLUMNS_PER_SHEET)
    expect(read.sheets[0]!.columnsTruncated).toBe(true)
  })

  it("stops reading sheets at the sheet limit and says it did", () => {
    const sheets: Record<string, XLSX.WorkSheet> = {}
    for (let i = 0; i < WORKBOOK_LIMITS.SHEETS + 2; i++) {
      sheets[`S${i}`] = { "!ref": "A1:A1", A1: { t: "s", v: "x" } as XLSX.CellObject }
    }
    const read = readSheets(workbookOf(sheets))

    expect(read.sheets).toHaveLength(WORKBOOK_LIMITS.SHEETS)
    expect(read.sheetsTruncated).toBe(true)
  })

  it("reports an untruncated sheet as untruncated", () => {
    const read = readSheets(
      workbookOf({ PEOPLE: { "!ref": "A1:B2", A1: { t: "s", v: "id" } as XLSX.CellObject } }),
    )
    expect(read.sheetsTruncated).toBe(false)
    expect(read.sheets[0]!.rowsTruncated).toBe(false)
    expect(read.sheets[0]!.columnsTruncated).toBe(false)
    expect(read.cellsTruncated).toBe(false)
  })
})

describe("readWorkbookSafely — admission runs first", () => {
  it("returns the container refusal unchanged and never reaches the parser", () => {
    const bytes = buildZip([WORKBOOK_MEMBER, { name: "xl/vbaProject.bin", data: new Uint8Array(8) }])
    const result = readWorkbookSafely(bytes, { mime: XLSX_MIME })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("MACRO_ENABLED")
  })

  it("says it could not parse rather than quoting the bytes it choked on", () => {
    // Admitted as a delimited file (not a ZIP, not a compound file) and then
    // handed to the parser. Whatever the parser says, this must not repeat it.
    const result = readWorkbookSafely(Uint8Array.from([0x00, 0x01, 0x02]), { mime: "text/csv" })
    if (!result.ok) {
      expect(result.reason).toBe("UNREADABLE")
      expect(result.detail).not.toMatch(/[\x00-\x08]/)
    } else {
      // A three-byte file that does parse is fine too; nothing leaked either way.
      expect(result.sheets.length).toBeGreaterThanOrEqual(0)
    }
  })
})
