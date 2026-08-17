/**
 * IER-040-005 — a ZIP container read from its index, before anything is inflated.
 *
 * `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`
 * §9.1 requires ingestion to "Enforce file, sheet, row, column, cell, and
 * decompression limits" and to "Parse with a maintained library" — in that
 * order. The order is the whole point: a decompression limit that is checked by
 * decompressing has already spent the memory it was meant to protect.
 *
 * Every OOXML workbook (.xlsx, .xlsm) is a ZIP, and a ZIP carries a central
 * directory at the end that declares, per member, its compressed and its
 * uncompressed size. That index is a few kilobytes for a workbook of any size,
 * and reading it answers "how much would this become" without becoming it. A
 * 40 KB file that declares 4 GB of members is refused having read 40 KB.
 *
 * This module therefore parses only the central directory. It never inflates a
 * byte, never trusts a local file header (which a crafted archive can disagree
 * with — the central directory is the authority the spec designates), and never
 * decides policy: it reports what the container says it contains, and
 * `workbook-admission.ts` decides.
 *
 * ## Why not JSZip, which the repository already depends on
 *
 * `JSZip.loadAsync` builds the whole object graph and holds every member's
 * bytes, which is the act being gated. It is the right tool once a container is
 * admitted — `content.ts` still uses it for PPTX — and the wrong tool for
 * deciding whether to admit one.
 */

/** One member of the archive, as the central directory declares it. */
export interface ZipEntry {
  /** The member's path inside the archive, as stored. */
  name: string
  /** 0 = stored, 8 = deflate. Anything else is a format we do not read. */
  compressionMethod: number
  /** Bytes on disk, as declared. */
  compressedSize: number
  /** Bytes after inflation, as declared. */
  uncompressedSize: number
  /** Bit 0 of the general-purpose flags: the member is encrypted. */
  encrypted: boolean
}

export type ZipReadResult =
  | { ok: true; entries: readonly ZipEntry[]; centralDirectoryBytes: number }
  | { ok: false; reason: ZipReadFailure }

/**
 * Why a container could not be indexed.
 *
 * These are *closed* values, and the strings that describe them live in
 * `workbook-admission.ts` — nothing here is built from bytes that came out of
 * the file, so no member name, sheet name or cell value can reach a caller
 * through this type.
 */
export type ZipReadFailure =
  /** No end-of-central-directory record. Not a ZIP, or truncated. */
  | "NOT_A_ZIP"
  /** ZIP64. Legal, and larger than anything this pipeline accepts. */
  | "ZIP64"
  /** Multi-disk (spanned) archive. */
  | "SPANNED"
  /** The central directory does not parse: sizes or offsets disagree. */
  | "MALFORMED_DIRECTORY"

const EOCD_SIGNATURE = 0x06054b50
const EOCD_MIN_BYTES = 22
const CENTRAL_HEADER_SIGNATURE = 0x02014b50
const CENTRAL_HEADER_MIN_BYTES = 46
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50

/**
 * A ZIP comment may be 65535 bytes, so the record can sit that far from the
 * end. Nothing is gained by searching further and a great deal is lost by
 * searching a whole 10 MB buffer backwards for a four-byte pattern.
 */
const MAX_EOCD_SEARCH_BYTES = 0xffff + EOCD_MIN_BYTES

/** The sentinel both 32-bit size fields use to mean "see the ZIP64 extra field". */
const ZIP64_SENTINEL = 0xffffffff

/** `PK\x03\x04` — the local file header that opens every non-empty ZIP. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

/**
 * `D0 CF 11 E0 A1 B1 1A E1` — the OLE2/CFB compound file header.
 *
 * Two very different files start this way and both must be refused: a legacy
 * BIFF8 `.xls` workbook, whose macro storage cannot be checked the way an OOXML
 * part name can, and a password-protected OOXML package, whose real contents
 * are an encrypted stream this pipeline has no key for. Telling them apart
 * would need a CFB reader; refusing both needs eight bytes.
 */
export function looksLikeCompoundFile(bytes: Uint8Array): boolean {
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  if (bytes.length < magic.length) return false
  return magic.every((b, i) => bytes[i] === b)
}

function u16(bytes: Uint8Array, at: number): number {
  return bytes[at]! | (bytes[at + 1]! << 8)
}

function u32(bytes: Uint8Array, at: number): number {
  // `>>> 0` because the top bit set would otherwise read as negative, and a
  // negative declared size compares as "under the limit".
  return (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0
}

/** The offset of the end-of-central-directory record, or -1. */
function findEocd(bytes: Uint8Array): number {
  const earliest = Math.max(0, bytes.length - MAX_EOCD_SEARCH_BYTES)
  for (let at = bytes.length - EOCD_MIN_BYTES; at >= earliest; at--) {
    if (u32(bytes, at) === EOCD_SIGNATURE) return at
  }
  return -1
}

/**
 * Index a ZIP container from its central directory.
 *
 * Reads no member and inflates nothing. Every returned size is what the archive
 * *declares*; a member that lies about its size is a separate problem, caught
 * when the parser is handed a container the declared sizes let through.
 */
export function readZipCentralDirectory(bytes: Uint8Array): ZipReadResult {
  const eocd = findEocd(bytes)
  if (eocd === -1) return { ok: false, reason: "NOT_A_ZIP" }

  // A ZIP64 locator sits immediately before the classic record. Its presence is
  // decisive on its own: an archive large enough to need it is past every limit
  // this pipeline has, and guessing at a 64-bit index we do not read is worse
  // than refusing a container we can name.
  if (eocd >= 20 && u32(bytes, eocd - 20) === ZIP64_LOCATOR_SIGNATURE) {
    return { ok: false, reason: "ZIP64" }
  }

  const disk = u16(bytes, eocd + 4)
  const diskWithDirectory = u16(bytes, eocd + 6)
  if (disk !== 0 || diskWithDirectory !== 0) return { ok: false, reason: "SPANNED" }

  const declaredEntries = u16(bytes, eocd + 10)
  const directoryBytes = u32(bytes, eocd + 12)
  const directoryAt = u32(bytes, eocd + 16)

  if (declaredEntries === 0xffff || directoryAt === ZIP64_SENTINEL || directoryBytes === ZIP64_SENTINEL) {
    return { ok: false, reason: "ZIP64" }
  }
  if (directoryAt + directoryBytes > bytes.length) return { ok: false, reason: "MALFORMED_DIRECTORY" }

  const entries: ZipEntry[] = []
  let at = directoryAt
  const end = directoryAt + directoryBytes

  while (at + CENTRAL_HEADER_MIN_BYTES <= end) {
    if (u32(bytes, at) !== CENTRAL_HEADER_SIGNATURE) return { ok: false, reason: "MALFORMED_DIRECTORY" }

    const flags = u16(bytes, at + 8)
    const compressionMethod = u16(bytes, at + 10)
    const compressedSize = u32(bytes, at + 20)
    const uncompressedSize = u32(bytes, at + 24)
    const nameLength = u16(bytes, at + 28)
    const extraLength = u16(bytes, at + 30)
    const commentLength = u16(bytes, at + 32)

    const nameAt = at + CENTRAL_HEADER_MIN_BYTES
    if (nameAt + nameLength > end) return { ok: false, reason: "MALFORMED_DIRECTORY" }

    // Either size field set to the sentinel means the true size is in a ZIP64
    // extra field. Reading the 32-bit sentinel as a size would report 4 GB as
    // 4 GB minus one byte and let a bomb through on a rounding argument.
    if (compressedSize === ZIP64_SENTINEL || uncompressedSize === ZIP64_SENTINEL) {
      return { ok: false, reason: "ZIP64" }
    }

    entries.push({
      // Latin-1 rather than UTF-8 on purpose: the only use of a member name is
      // an exact comparison against fixed ASCII OOXML part names, and a decoder
      // that replaces invalid sequences can turn two distinct names into one.
      name: Array.from(bytes.subarray(nameAt, nameAt + nameLength), (b) => String.fromCharCode(b)).join(""),
      compressionMethod,
      compressedSize,
      uncompressedSize,
      encrypted: (flags & 0x0001) !== 0,
    })

    at = nameAt + nameLength + extraLength + commentLength
  }

  // The count in the record and the count in the directory must agree. When
  // they do not, one of them is describing a container this code is not looking
  // at, and picking either is a guess.
  if (entries.length !== declaredEntries) return { ok: false, reason: "MALFORMED_DIRECTORY" }

  return { ok: true, entries, centralDirectoryBytes: directoryBytes }
}
