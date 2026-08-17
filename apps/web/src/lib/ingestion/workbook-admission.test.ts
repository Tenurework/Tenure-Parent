/**
 * IER-040-004 — "Reject macro-enabled, active-content, external-link,
 * embedded-object, and unsupported workbooks."
 *
 * IER-040-005 — "Enforce file/row/column/cell/decompression/resource limits."
 *
 * Every fixture is built against `WORKBOOK_LIMITS` rather than against a literal
 * number, so a tuned limit keeps being tested and does not quietly stop being.
 */

import * as XLSX from "xlsx"

import { buildZip, WORKBOOK_MEMBER, type ZipMemberSpec } from "./__fixtures__/zip"
import { admitWorkbook, WORKBOOK_LIMITS } from "./workbook-admission"

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

function pkg(...extra: ZipMemberSpec[]): Uint8Array {
  return buildZip([WORKBOOK_MEMBER, ...extra])
}

function admit(bytes: Uint8Array, mime = XLSX_MIME) {
  return admitWorkbook(bytes, { mime })
}

function realXlsx(): Uint8Array {
  const sheet = XLSX.utils.aoa_to_sheet([["source_person_id", "status"], ["A-1", "ACTIVE"]])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, "PEOPLE")
  return new Uint8Array(XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer)
}

describe("admitWorkbook — an ordinary workbook is admitted", () => {
  it("admits a workbook written by the parser this app ships", () => {
    const result = admit(realXlsx())
    expect(result.admitted).toBe(true)
    if (!result.admitted) return
    expect(result.container).toBe("ooxml")
    expect(result.partCount).toBeGreaterThan(0)
    expect(result.declaredUncompressedBytes).toBeGreaterThan(0)
  })

  it("admits a delimited file, which has no archive index to check", () => {
    const csv = Uint8Array.from(Buffer.from("source_person_id,status\r\nA-1,ACTIVE\r\n"))
    const result = admit(csv, "text/csv")
    expect(result.admitted).toBe(true)
    if (!result.admitted) return
    expect(result.container).toBe("delimited")
    expect(result.partCount).toBe(0)
  })

  it("admits the parts Excel writes for ordinary reasons", () => {
    // A control that refused these would be a control somebody turns off.
    const result = admit(
      pkg(
        { name: "docProps/core.xml" },
        { name: "customXml/item1.xml" },
        { name: "xl/drawings/drawing1.xml" },
        { name: "xl/media/image1.png" },
        { name: "xl/printerSettings/printerSettings1.bin" },
      ),
    )
    expect(result.admitted).toBe(true)
  })
})

describe("IER-040-004 — macro-enabled, active content, external links, embedded objects", () => {
  it("refuses a macro project however the file is named", () => {
    // The MIME says plain .xlsx. The macro is in the archive.
    const result = admit(pkg({ name: "xl/vbaProject.bin", data: new Uint8Array(8) }))
    expect(result.admitted).toBe(false)
    if (result.admitted) return
    expect(result.reason).toBe("MACRO_ENABLED")
  })

  it("refuses a declared macro-enabled MIME before it reads a byte of the archive", () => {
    const result = admit(realXlsx(), "application/vnd.ms-excel.sheet.macroEnabled.12")
    expect(result.admitted).toBe(false)
    if (result.admitted) return
    expect(result.reason).toBe("MACRO_ENABLED")
  })

  it("refuses an Excel 4.0 macro sheet", () => {
    const result = admit(pkg({ name: "xl/macrosheets/sheet1.xml" }))
    expect(result.admitted).toBe(false)
    if (result.admitted) return
    expect(result.reason).toBe("MACRO_ENABLED")
  })

  it("refuses active content", () => {
    for (const name of ["xl/activeX/activeX1.xml", "xl/ctrlProps/ctrlProp1.xml"]) {
      const result = admit(pkg({ name }))
      expect(result.admitted).toBe(false)
      if (result.admitted) continue
      expect(result.reason).toBe("ACTIVE_CONTENT")
    }
  })

  it("refuses a workbook whose values come from another file", () => {
    const result = admit(pkg({ name: "xl/externalLinks/externalLink1.xml" }))
    expect(result.admitted).toBe(false)
    if (result.admitted) return
    expect(result.reason).toBe("EXTERNAL_LINK")
  })

  it("refuses an embedded object", () => {
    for (const name of ["xl/embeddings/oleObject1.bin", "xl/oleObjects/object1.bin"]) {
      const result = admit(pkg({ name }))
      expect(result.admitted).toBe(false)
      if (result.admitted) continue
      expect(result.reason).toBe("EMBEDDED_OBJECT")
    }
  })

  it("refuses an encrypted member", () => {
    const result = admit(pkg({ name: "xl/sharedStrings.xml", encrypted: true }))
    expect(result.admitted).toBe(false)
    if (result.admitted) return
    expect(result.reason).toBe("ENCRYPTED")
  })

  it("refuses a legacy binary workbook, which is also how a password-protected package arrives", () => {
    const cfb = new Uint8Array(64)
    cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    const result = admit(cfb, "application/vnd.ms-excel")
    expect(result.admitted).toBe(false)
    if (result.admitted) return
    expect(result.reason).toBe("LEGACY_BINARY_WORKBOOK")
  })

  it("refuses an archive that is not a spreadsheet package whatever it is named", () => {
    const result = admit(buildZip([{ name: "notes.txt", data: new Uint8Array(4) }]))
    expect(result.admitted).toBe(false)
    if (result.admitted) return
    expect(result.reason).toBe("NOT_A_SPREADSHEET_PACKAGE")
  })

  it("refuses a compression method it does not read", () => {
    const result = admit(pkg({ name: "xl/sharedStrings.xml", compressionMethod: 14 }))
    expect(result.admitted).toBe(false)
    if (result.admitted) return
    expect(result.reason).toBe("UNSUPPORTED_COMPRESSION")
  })

  it("refuses a member named so that extracting it would escape the package", () => {
    for (const name of ["../../etc/passwd", "/etc/passwd", "C:/Windows/System32/x.dll"]) {
      const result = admit(pkg({ name }))
      expect(result.admitted).toBe(false)
      if (result.admitted) continue
      expect(result.reason).toBe("UNSAFE_PART_NAME")
    }
  })
})

describe("IER-040-005 — file, part, expansion and ratio limits", () => {
  it("refuses a file past the byte limit", () => {
    const result = admit(new Uint8Array(WORKBOOK_LIMITS.FILE_BYTES + 1))
    expect(result.admitted).toBe(false)
    if (result.admitted) return
    expect(result.reason).toBe("FILE_TOO_LARGE")
  })

  it("refuses more members than the part limit", () => {
    const many: ZipMemberSpec[] = Array.from({ length: WORKBOOK_LIMITS.PARTS + 1 }, (_, i) => ({
      name: `xl/worksheets/sheet${i}.xml`,
    }))
    const result = admit(buildZip([WORKBOOK_MEMBER, ...many]))
    expect(result.admitted).toBe(false)
    if (result.admitted) return
    expect(result.reason).toBe("TOO_MANY_PARTS")
  })

  it("refuses a single member that declares more than the per-part limit", () => {
    const result = admit(
      pkg({
        name: "xl/sharedStrings.xml",
        declaredCompressedSize: 1024,
        declaredUncompressedSize: WORKBOOK_LIMITS.PART_UNCOMPRESSED_BYTES + 1,
      }),
    )
    expect(result.admitted).toBe(false)
    if (result.admitted) return
    expect(result.reason).toBe("PART_TOO_LARGE")
  })

  it("refuses a total expansion past the whole-archive limit, having expanded nothing", () => {
    // Each member sits under the per-part limit; together they are over the
    // total. Compressed sizes are set so the ratio stays legal, which is what
    // makes this the total-expansion branch and not the ratio branch.
    const perPart = Math.floor(WORKBOOK_LIMITS.PART_UNCOMPRESSED_BYTES / 2)
    const count = Math.ceil(WORKBOOK_LIMITS.TOTAL_UNCOMPRESSED_BYTES / perPart) + 1
    const members: ZipMemberSpec[] = Array.from({ length: count }, (_, i) => ({
      name: `xl/worksheets/sheet${i}.xml`,
      declaredCompressedSize: perPart,
      declaredUncompressedSize: perPart,
    }))
    const bytes = buildZip([WORKBOOK_MEMBER, ...members])
    expect(bytes.length).toBeLessThan(WORKBOOK_LIMITS.FILE_BYTES)

    const result = admit(bytes)
    expect(result.admitted).toBe(false)
    if (result.admitted) return
    expect(result.reason).toBe("EXPANSION_TOO_LARGE")
  })

  // The ratio is a property of the archive as a whole, so these fixtures have
  // exactly ONE member — the workbook part itself. A second member would dilute
  // the ratio and the test would be asserting a different number than it says.
  const COMPRESSED = 4096
  function singleMemberArchive(declaredUncompressedSize: number): Uint8Array {
    return buildZip([
      { name: "xl/workbook.xml", declaredCompressedSize: COMPRESSED, declaredUncompressedSize },
    ])
  }

  it("refuses a decompression bomb on its declared ratio", () => {
    const result = admit(singleMemberArchive(COMPRESSED * WORKBOOK_LIMITS.EXPANSION_RATIO + COMPRESSED))
    expect(result.admitted).toBe(false)
    if (result.admitted) return
    expect(result.reason).toBe("EXPANSION_RATIO_TOO_HIGH")
  })

  it("admits a ratio exactly at the limit — the boundary is not off by one", () => {
    const result = admit(singleMemberArchive(COMPRESSED * WORKBOOK_LIMITS.EXPANSION_RATIO))
    expect(result.admitted).toBe(true)
  })

  it("does not divide by zero on an archive of empty members", () => {
    const result = admit(buildZip([WORKBOOK_MEMBER, { name: "xl/styles.xml" }]))
    expect(result.admitted).toBe(true)
  })
})

describe("IER-040-009 — a refusal carries nothing out of the file", () => {
  const CANARY = "SSN-078-05-1120-CANARY"

  it("names no member, sheet or cell value in any refusal detail", () => {
    // The canary is in a member name, which is the only string a container-level
    // check ever sees. If a detail interpolated it, this fails.
    const refusals = [
      admit(pkg({ name: `xl/vbaProject.bin` })),
      admit(pkg({ name: `xl/externalLinks/${CANARY}.xml` })),
      admit(pkg({ name: `../${CANARY}` })),
      admit(pkg({ name: `xl/${CANARY}.xml`, compressionMethod: 14 })),
      admit(buildZip([{ name: `${CANARY}.txt` }])),
    ]

    for (const result of refusals) {
      expect(result.admitted).toBe(false)
      expect(JSON.stringify(result)).not.toContain(CANARY)
    }
  })

  it("still says which control refused, so the answer is not merely silence", () => {
    const result = admit(pkg({ name: `xl/embeddings/${CANARY}.bin` }))
    expect(result.admitted).toBe(false)
    if (result.admitted) return
    expect(result.reason).toBe("EMBEDDED_OBJECT")
    expect(result.detail.length).toBeGreaterThan(40)
  })
})
