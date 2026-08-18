/**
 * IER-040-006 — "Never execute formulas and prevent CSV/formula injection on
 * import/export."
 *
 * IER-050-006 — "Produce row-level safe error output and remediation."
 *
 * IER-040-009 — "Keep raw values out of logs and ordinary evidence."
 */

import fs from "fs"
import path from "path"

import * as XLSX from "xlsx"

import { csvCell } from "@/components/charts/chart-table"

import {
  MAX_REPORTED_ISSUES,
  cellShape,
  columnLabel,
  displayIsFormulaLike,
  issueForCell,
  issueForEvidence,
  readTabularUpload,
} from "./tabular-import"
import { WORKBOOK_LIMITS } from "./workbook-admission"

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const CSV_MIME = "text/csv"

function csv(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "utf8"))
}

function workbookOf(sheets: Record<string, XLSX.WorkSheet>): Uint8Array {
  const book = XLSX.utils.book_new()
  for (const [name, sheet] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, sheet, name)
  return new Uint8Array(XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer)
}

function ok(result: ReturnType<typeof readTabularUpload>) {
  if (!result.ok) throw new Error(`expected a readable upload, got ${result.reason}`)
  return result
}

describe("columnLabel — the coordinate a person can find in their own file", () => {
  it("is bijective base-26, so the carry does not produce a non-letter", () => {
    expect(columnLabel(0)).toBe("A")
    expect(columnLabel(25)).toBe("Z")
    expect(columnLabel(26)).toBe("AA")
    expect(columnLabel(51)).toBe("AZ")
    expect(columnLabel(52)).toBe("BA")
    expect(columnLabel(701)).toBe("ZZ")
    expect(columnLabel(702)).toBe("AAA")
  })

  it("produces letters only, for every column the reader can reach", () => {
    for (let i = 0; i < WORKBOOK_LIMITS.COLUMNS_PER_SHEET; i++) {
      expect(columnLabel(i)).toMatch(/^[A-Z]+$/)
    }
  })
})

describe("IER-040-006 — a formula is reported, never resolved", () => {
  it("imports a CSV formula cell as its own text and not as anything computed", () => {
    // SheetJS's CSV reader yields `{ t: "n", f: 'HYPERLINK("http://x")' }` with
    // no cached value at all — the one path where a formula is visible as a
    // formula, and the one an attacker can write with a text editor.
    const result = ok(readTabularUpload(csv('=HYPERLINK("http://x"),ok\n'), { mime: CSV_MIME }))

    expect(result.grid[0]![0]).toBe('=HYPERLINK("http://x")')
    expect(result.grid[0]![1]).toBe("ok")

    const issue = result.issues.find((i) => i.code === "FORMULA_NOT_EVALUATED")
    expect(issue).toBeDefined()
    expect(issue!.row).toBe(1)
    expect(issue!.column).toBe("A")
  })

  it("hands the exporter a value it neutralises, so the round trip cannot execute", () => {
    const result = ok(readTabularUpload(csv('=cmd|calc,2\n'), { mime: CSV_MIME }))
    const value = result.grid[0]![0]

    expect(displayIsFormulaLike(value)).toBe(true)
    // `csvCell` is the export side, in `components/charts/chart-table.ts`. The
    // apostrophe is what makes a spreadsheet read the cell as text.
    expect(csvCell(value as string)).toBe("'=cmd|calc")
  })

  it("does not carry an XLSX formula's source into the grid", () => {
    // On the XLSX path `SAFE_READ_OPTIONS.cellFormula` is false, so the reader's
    // formula machinery never runs and the cell arrives as the value the
    // authoring application cached. That is a deliberate boundary and this test
    // states it: what must never happen is the formula STRING surviving into a
    // grid an export could turn back into a live formula.
    const bytes = workbookOf({ S: { "!ref": "A1:A1", A1: { t: "n", v: 2, f: "1+1" } as XLSX.CellObject } })
    const result = ok(readTabularUpload(bytes, { mime: XLSX_MIME }))

    expect(result.grid[0]![0]).toBe(2)
    expect(JSON.stringify(result)).not.toContain("1+1")
  })

  it("reports stored text that would become a formula on the way out", () => {
    // A *stored string* that begins with a leader: not a formula in the file,
    // but a formula the moment the export is opened. The CSV reader would call
    // the same characters a formula, so the fixture is a workbook text cell.
    const bytes = workbookOf({
      S: { "!ref": "A1:A2", A1: { t: "s", v: "Category" }, A2: { t: "s", v: "=SUM(A1:A9)" } },
    })
    const result = ok(readTabularUpload(bytes, { mime: XLSX_MIME }))
    const issue = result.issues.find((i) => i.code === "FORMULA_LIKE_TEXT")

    expect(issue).toBeDefined()
    expect(issue!.row).toBe(2)
    expect(issue!.column).toBe("A")
  })

  it("does not report a negative amount, which a spreadsheet resolves to a number", () => {
    // The leader set is shared with the exporter, so `-1,234.50` IS formula-like
    // and IS neutralised on export. Reporting it as an issue would bury the
    // cells that matter under every negative amount in a budget file.
    const cell = { kind: "text", text: "-1,234.50", formulaLike: true } as const
    expect(issueForCell(cell, "S", 0, 0)).toBeNull()
    expect(issueForCell({ kind: "text", text: "-1+cmd", formulaLike: true }, "S", 0, 0)?.code).toBe(
      "FORMULA_LIKE_TEXT",
    )
  })
})

describe("IER-050-006 — row-level error output with remediation", () => {
  it("locates an error cell by sheet, 1-based row and column letter, and says what to do", () => {
    const bytes = workbookOf({
      Budget: {
        "!ref": "A1:C3",
        A1: { t: "s", v: "Category" },
        B1: { t: "s", v: "Budget" },
        A2: { t: "s", v: "Venue" },
        B2: { t: "n", v: 100 },
        A3: { t: "s", v: "Food" },
        C3: { t: "e", v: 0x17 },
      },
    })
    const result = ok(readTabularUpload(bytes, { mime: XLSX_MIME }))
    const issue = result.issues.find((i) => i.code === "CELL_ERROR")

    expect(issue).toBeDefined()
    expect(issue!.sheet).toBe("Budget")
    expect(issue!.row).toBe(3)
    expect(issue!.column).toBe("C")
    expect(issue!.remediation.length).toBeGreaterThan(0)
    expect(issue!.rule.length).toBeGreaterThan(0)
  })

  it("gives every issue a remediation, so none of them is only a complaint", () => {
    const bytes = workbookOf({
      S: {
        "!ref": "A1:C1",
        A1: { t: "e", v: 0x07 },
        B1: { t: "n", v: 60, z: "yyyy-mm-dd" },
        C1: { t: "s", v: "@SUM(1)" },
      },
    })
    const result = ok(readTabularUpload(bytes, { mime: XLSX_MIME }))

    expect(result.issues.length).toBeGreaterThanOrEqual(3)
    for (const issue of result.issues) {
      expect(issue.remediation.trim()).not.toBe("")
      expect(issue.rule.trim()).not.toBe("")
    }
    expect(result.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(["CELL_ERROR", "IMPOSSIBLE_DATE", "FORMULA_LIKE_TEXT"]),
    )
  })

  it("caps the list it reports and still says how many it found", () => {
    const rows = Array.from({ length: MAX_REPORTED_ISSUES + 20 }, () => "=cmd").join("\n")
    const result = ok(readTabularUpload(csv(rows + "\n"), { mime: CSV_MIME }))

    expect(result.issues).toHaveLength(MAX_REPORTED_ISSUES)
    expect(result.issuesFound).toBe(MAX_REPORTED_ISSUES + 20)
    expect(result.issuesTruncated).toBe(true)
  })

  it("says nothing was found when nothing was, which is a different answer", () => {
    const result = ok(readTabularUpload(csv("Category,Budget\nVenue,100\n"), { mime: CSV_MIME }))

    expect(result.issues).toHaveLength(0)
    expect(result.issuesFound).toBe(0)
    expect(result.issuesTruncated).toBe(false)
    expect(result.grid).toEqual([
      ["Category", "Budget"],
      ["Venue", 100],
    ])
  })

  it("reports nothing on the app's own template, whose total row is a live formula", () => {
    // `api/templates/budget/route.ts` writes `{ t: "n", f: "SUM(B2:B…)" }` with
    // no cached value, deliberately, so the sheet totals itself in Excel. Under
    // `cellFormula: false` those cells read as empty and the category is
    // "Total", which `parseBudgetSheet` skips. A person who downloads the
    // standard template and uploads it back must therefore see an empty issue
    // list — a control that cries on the happy path is a control people learn
    // to click past.
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Category", "Budgeted", "Actual Spent", "Notes"],
      ["Venue & Space", 1200, 1350, "Spring venue ran over"],
    ])
    XLSX.utils.sheet_add_aoa(sheet, [["Total", 0, 0, ""]], { origin: -1 })
    sheet.B3 = { t: "n", f: "SUM(B2:B2)" }
    sheet.C3 = { t: "n", f: "SUM(C2:C2)" }
    const result = ok(readTabularUpload(workbookOf({ "Club Budget": sheet }), { mime: XLSX_MIME }))

    expect(result.issues).toEqual([])
    expect(result.issuesFound).toBe(0)
    expect(result.grid[1]).toEqual(["Venue & Space", 1200, 1350, "Spring venue ran over"])
    expect(JSON.stringify(result)).not.toContain("SUM(")
  })

  it("reports a truncated read as a file-level issue rather than a short grid", () => {
    const wide = Array.from({ length: WORKBOOK_LIMITS.COLUMNS_PER_SHEET + 5 }, (_, i) => `c${i}`).join(",")
    const result = ok(readTabularUpload(csv(wide + "\n"), { mime: CSV_MIME }))
    const issue = result.issues.find((i) => i.code === "COLUMNS_TRUNCATED")

    expect(issue).toBeDefined()
    expect(issue!.row).toBeNull()
    expect(issue!.column).toBeNull()
    expect(result.grid[0]).toHaveLength(WORKBOOK_LIMITS.COLUMNS_PER_SHEET)
  })

  it("passes a container refusal through with the control's own sentence", () => {
    const result = readTabularUpload(new Uint8Array(WORKBOOK_LIMITS.FILE_BYTES + 1), { mime: XLSX_MIME })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.reason).toBe("FILE_TOO_LARGE")
    expect(result.detail).toContain(String(WORKBOOK_LIMITS.FILE_BYTES))
  })

  it("refuses a sheet name the file does not have without listing the ones it does", () => {
    const bytes = workbookOf({ Secret: { "!ref": "A1:A1", A1: { t: "s", v: "x" } } })
    const result = readTabularUpload(bytes, { mime: XLSX_MIME, sheetName: "Budget" })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.reason).toBe("NO_SHEET")
    expect(result.detail).not.toContain("Secret")
  })
})

describe("IER-040-009 — an issue locates a cell and never quotes it", () => {
  const CANARY = "Zq7-ROSTER-CANARY-9F"

  it("puts no cell value into any issue, for every kind of cell that raises one", () => {
    const bytes = workbookOf({
      [`Sheet-${CANARY}`]: {
        "!ref": "A1:D1",
        A1: { t: "s", v: `=${CANARY}()` },
        B1: { t: "e", v: 0x17 },
        C1: { t: "n", v: 60, z: "yyyy-mm-dd" },
        D1: { t: "s", v: CANARY },
      },
    })
    const result = ok(readTabularUpload(bytes, { mime: XLSX_MIME }))

    expect(result.issues.length).toBeGreaterThan(0)
    for (const issue of result.issues) {
      expect(`${issue.rule} ${issue.remediation} ${issue.shape}`).not.toContain(CANARY)
      expect(JSON.stringify(issueForEvidence(issue))).not.toContain(CANARY)
    }
    // The grid is data and is allowed to hold the value; the issues are not.
    expect(JSON.stringify(result.grid)).toContain(CANARY)
  })

  it("describes a value by shape and length, never by content", () => {
    expect(cellShape({ kind: "text", text: "abcdef", formulaLike: false })).toBe("text, 6 characters")
    expect(cellShape({ kind: "text", text: "a", formulaLike: false })).toBe("text, 1 character")
    expect(cellShape({ kind: "number", value: 12345 })).toBe("number")
    expect(cellShape({ kind: "error" })).toBe("a spreadsheet error value")
    expect(cellShape({ kind: "formula", source: "=A1", cachedText: null })).toContain("no cached value")
  })

  it("drops the sheet name and the length from anything kept durably", () => {
    const issue = issueForCell({ kind: "error" }, `Sheet-${CANARY}`, 4, 2)!
    const evidence = issueForEvidence(issue)

    expect(evidence).toEqual({ code: "CELL_ERROR", row: 5, column: "C" })
    expect(Object.keys(evidence)).toEqual(["code", "row", "column"])
  })

  it("keeps the ingestion pipeline out of the log entirely", () => {
    // Every refusal detail in this directory is assembled from literal sentences
    // and integers, which is only a property worth having if nothing here also
    // writes the value it refused to a console the browser or the task
    // definition collects.
    const dir = path.join(__dirname)
    const sources = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")] as const)

    expect(sources.length).toBeGreaterThanOrEqual(4)
    for (const [name, text] of sources) {
      const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
      expect([name, /\bconsole\s*\./.test(withoutComments)]).toEqual([name, false])
    }
  })
})
