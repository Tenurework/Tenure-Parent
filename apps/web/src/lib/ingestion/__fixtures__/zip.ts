/**
 * A ZIP writer for tests, deliberately able to lie.
 *
 * `readZipCentralDirectory` decides what a container claims to hold from the
 * central directory, and the whole point of the decompression check is that the
 * claim is read without being believed. Proving that needs an archive whose
 * declared sizes are whatever the test says — which is exactly what no real ZIP
 * writer will produce, and why this exists rather than a fixture file.
 *
 * Members are always STORED (method 0) on the wire; `declaredCompressedSize` and
 * `declaredUncompressedSize` override only what the directory says, so a 60-byte
 * archive can declare a gigabyte and the parser has to disbelieve it from the
 * index alone.
 *
 * Not a production module, and not collected by jest: a `__fixtures__` path
 * matches neither of the two `testMatch` patterns, which want a `__tests__`
 * directory or a `.test.` infix.
 */

export interface ZipMemberSpec {
  name: string
  /** The bytes actually written. Empty when the test only cares about the index. */
  data?: Uint8Array
  /** What the central directory should claim, if not the truth. */
  declaredCompressedSize?: number
  declaredUncompressedSize?: number
  /** 0 = stored, 8 = deflate, anything else = a method we do not read. */
  compressionMethod?: number
  /** Sets bit 0 of the general-purpose flags. */
  encrypted?: boolean
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_HEADER_SIGNATURE = 0x02014b50
const EOCD_SIGNATURE = 0x06054b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50

function bytesOf(name: string): Uint8Array {
  return Uint8Array.from(name, (ch) => ch.charCodeAt(0) & 0xff)
}

class Writer {
  private parts: number[] = []

  u16(n: number): void {
    this.parts.push(n & 0xff, (n >>> 8) & 0xff)
  }

  u32(n: number): void {
    this.parts.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff)
  }

  raw(bytes: Uint8Array): void {
    for (const b of bytes) this.parts.push(b)
  }

  get length(): number {
    return this.parts.length
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.parts)
  }
}

export function buildZip(members: readonly ZipMemberSpec[], opts: { zip64Locator?: boolean } = {}): Uint8Array {
  const out = new Writer()
  const offsets: number[] = []

  for (const member of members) {
    const name = bytesOf(member.name)
    const data = member.data ?? new Uint8Array(0)
    offsets.push(out.length)
    out.u32(LOCAL_HEADER_SIGNATURE)
    out.u16(20) // version needed
    out.u16(member.encrypted ? 1 : 0) // general-purpose flags
    out.u16(member.compressionMethod ?? 0)
    out.u16(0) // mod time
    out.u16(0) // mod date
    out.u32(0) // crc32 — nothing here validates it
    out.u32(data.length)
    out.u32(data.length)
    out.u16(name.length)
    out.u16(0) // extra length
    out.raw(name)
    out.raw(data)
  }

  const directoryAt = out.length
  members.forEach((member, i) => {
    const name = bytesOf(member.name)
    const data = member.data ?? new Uint8Array(0)
    out.u32(CENTRAL_HEADER_SIGNATURE)
    out.u16(20) // version made by
    out.u16(20) // version needed
    out.u16(member.encrypted ? 1 : 0)
    out.u16(member.compressionMethod ?? 0)
    out.u16(0)
    out.u16(0)
    out.u32(0)
    out.u32(member.declaredCompressedSize ?? data.length)
    out.u32(member.declaredUncompressedSize ?? data.length)
    out.u16(name.length)
    out.u16(0) // extra
    out.u16(0) // comment
    out.u16(0) // disk start
    out.u16(0) // internal attrs
    out.u32(0) // external attrs
    out.u32(offsets[i]!)
    out.raw(name)
  })
  const directoryBytes = out.length - directoryAt

  if (opts.zip64Locator) {
    out.u32(ZIP64_LOCATOR_SIGNATURE)
    out.u32(0) // disk with the zip64 record
    out.u32(0) // low half of its offset
    out.u32(0) // high half
    out.u32(1) // total disks
  }

  out.u32(EOCD_SIGNATURE)
  out.u16(0) // this disk
  out.u16(0) // disk with the directory
  out.u16(members.length)
  out.u16(members.length)
  out.u32(directoryBytes)
  out.u32(directoryAt)
  out.u16(0) // comment length

  return out.toBytes()
}

/** The one part every spreadsheet package has, so a fixture can be admitted. */
export const WORKBOOK_MEMBER: ZipMemberSpec = {
  name: "xl/workbook.xml",
  data: bytesOf('<workbook xmlns="x"/>'),
}
