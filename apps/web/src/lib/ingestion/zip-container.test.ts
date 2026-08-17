/**
 * IER-040-005 — the index is read, and nothing is inflated to read it.
 */

import * as XLSX from "xlsx"

import { buildZip, WORKBOOK_MEMBER } from "./__fixtures__/zip"
import { looksLikeCompoundFile, looksLikeZip, readZipCentralDirectory } from "./zip-container"

function realXlsx(): Uint8Array {
  const sheet = XLSX.utils.aoa_to_sheet([["id"], ["A-1"]])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, "PEOPLE")
  return new Uint8Array(XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer)
}

describe("readZipCentralDirectory", () => {
  it("indexes a real workbook written by the parser this app ships", () => {
    const bytes = realXlsx()
    expect(looksLikeZip(bytes)).toBe(true)

    const index = readZipCentralDirectory(bytes)
    expect(index.ok).toBe(true)
    if (!index.ok) return

    const names = index.entries.map((e) => e.name)
    expect(names).toContain("xl/workbook.xml")
    // Every member deflated or stored, and none encrypted: the properties
    // admission relies on, read from a file no test wrote by hand.
    expect(index.entries.every((e) => e.compressionMethod === 0 || e.compressionMethod === 8)).toBe(true)
    expect(index.entries.some((e) => e.encrypted)).toBe(false)
  })

  it("reports declared sizes without inflating: a 60-byte archive can declare a gigabyte", () => {
    const bytes = buildZip([
      { name: "xl/sharedStrings.xml", data: new Uint8Array(10), declaredCompressedSize: 10, declaredUncompressedSize: 1_073_741_824 },
    ])
    // The whole file is smaller than a kilobyte, and it claims a gigabyte.
    expect(bytes.length).toBeLessThan(1024)

    const index = readZipCentralDirectory(bytes)
    expect(index.ok).toBe(true)
    if (!index.ok) return
    expect(index.entries[0]!.uncompressedSize).toBe(1_073_741_824)
    expect(index.entries[0]!.compressedSize).toBe(10)
  })

  it("refuses a file with no end-of-central-directory record", () => {
    const result = readZipCentralDirectory(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]))
    expect(result).toEqual({ ok: false, reason: "NOT_A_ZIP" })
  })

  it("refuses ZIP64 rather than guessing at an index it does not read", () => {
    const bytes = buildZip([WORKBOOK_MEMBER], { zip64Locator: true })
    expect(readZipCentralDirectory(bytes)).toEqual({ ok: false, reason: "ZIP64" })
  })

  it("refuses a directory whose offset points past the end of the file", () => {
    const bytes = buildZip([WORKBOOK_MEMBER])
    // The central-directory offset lives at EOCD+16, and the EOCD is the last 22
    // bytes because the fixture writes no archive comment.
    const eocd = bytes.length - 22
    bytes[eocd + 16] = 0xff
    bytes[eocd + 17] = 0xff
    expect(readZipCentralDirectory(bytes)).toEqual({ ok: false, reason: "MALFORMED_DIRECTORY" })
  })

  it("refuses a directory that declares more members than it contains", () => {
    const bytes = buildZip([WORKBOOK_MEMBER])
    const eocd = bytes.length - 22
    // Total-entries field at EOCD+10.
    bytes[eocd + 10] = 9
    expect(readZipCentralDirectory(bytes)).toEqual({ ok: false, reason: "MALFORMED_DIRECTORY" })
  })

  it("reads the encrypted flag from the general-purpose bits", () => {
    const bytes = buildZip([{ ...WORKBOOK_MEMBER, encrypted: true }])
    const index = readZipCentralDirectory(bytes)
    expect(index.ok).toBe(true)
    if (!index.ok) return
    expect(index.entries[0]!.encrypted).toBe(true)
  })
})

describe("container sniffing", () => {
  it("recognises the OLE2 compound-file header a legacy .xls and a password-protected package share", () => {
    const cfb = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])
    expect(looksLikeCompoundFile(cfb)).toBe(true)
    expect(looksLikeZip(cfb)).toBe(false)
  })

  it("does not mistake a CSV for either container", () => {
    const csv = Uint8Array.from(Buffer.from("id,name\r\nA-1,Ada\r\n"))
    expect(looksLikeZip(csv)).toBe(false)
    expect(looksLikeCompoundFile(csv)).toBe(false)
  })
})
