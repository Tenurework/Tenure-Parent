/**
 * IER-040-004 / IER-040-005 — what a workbook has to be before a parser sees it.
 *
 * `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`
 * §9.1:
 *
 *   > Accept only configured formats and versions.
 *   > Reject macro-enabled workbooks and active content.
 *   > Enforce file, sheet, row, column, cell, and decompression limits.
 *   > Reject external links, embedded objects, unsupported types, hidden
 *   > executable content, and password-protected files unless an approved
 *   > secure workflow handles them.
 *
 * Every one of those is a property of the *container*, and every one of them is
 * knowable from the archive index — so this runs first, and a refusal costs a
 * central-directory read rather than a parse.
 *
 * ## Why the part names are the check
 *
 * An OOXML package puts each feature in a part with a fixed, spec-defined path.
 * A macro lives in `xl/vbaProject.bin` and nowhere else; an ActiveX control in
 * `xl/activeX/`; a link to another workbook in `xl/externalLinks/`; an embedded
 * OLE object in `xl/embeddings/`. That makes "does this workbook contain a
 * macro" an exact string comparison against an index, not a heuristic over
 * content, and not a question of trusting the extension somebody typed.
 *
 * Extension and MIME are checked too but are never sufficient on their own:
 * renaming `payroll.xlsm` to `.xlsx` changes the declared type and not one byte
 * of the archive, and a pipeline that believed the declaration would open the
 * macro workbook it just refused.
 *
 * ## Refusals carry no data from the file (IER-040-009, in part)
 *
 * `detail` is assembled from literal sentences and integers. No member name, no
 * sheet name and no cell value can reach it, which is what makes it safe to put
 * in front of a user or into an import evidence record. The generic `catch` this
 * replaces was safe for the same reason and said nothing; these say which
 * control refused and what the limit is, which is the difference between "we
 * could not look" and "we looked and this is not allowed".
 */

import {
  looksLikeCompoundFile,
  looksLikeZip,
  readZipCentralDirectory,
  type ZipEntry,
  type ZipReadFailure,
} from "./zip-container"

/**
 * The limits, as one exported object.
 *
 * Exported because the tests assert against these names rather than against
 * numbers of their own: a fixture built as `PART_UNCOMPRESSED_BYTES + 1` still
 * proves the boundary after somebody tunes the number, and a fixture built as
 * `50_000_001` silently stops testing anything the day the limit moves.
 */
export const WORKBOOK_LIMITS = {
  /** The whole file, on the wire. */
  FILE_BYTES: 10 * 1024 * 1024,
  /** Members in the archive. A real workbook has tens; a bomb has thousands. */
  PARTS: 512,
  /** Any single member, inflated. */
  PART_UNCOMPRESSED_BYTES: 64 * 1024 * 1024,
  /** Every member, inflated, added up. */
  TOTAL_UNCOMPRESSED_BYTES: 256 * 1024 * 1024,
  /**
   * Total inflated bytes per compressed byte.
   *
   * Spreadsheet XML is repetitive and deflates well — 20:1 is ordinary and 40:1
   * happens on a wide sheet of short numbers. A zip bomb is not near this
   * number; the canonical one is 1000:1 and the pathological cases are 1e6:1.
   * The limit is set where a workbook cannot plausibly reach and a bomb cannot
   * plausibly avoid.
   */
  EXPANSION_RATIO: 200,
  /** Sheets read. Beyond this the file is offered as a download instead. */
  SHEETS: 3,
  /** Rows read per sheet. */
  ROWS_PER_SHEET: 300,
  /** Columns read per sheet. */
  COLUMNS_PER_SHEET: 64,
  /** Cells read across every sheet. */
  CELLS: 100_000,
} as const

/** Deflate and stored. A workbook using anything else is not one we read. */
const SUPPORTED_COMPRESSION_METHODS = new Set([0, 8])

/** Exact part paths whose mere presence is disqualifying. */
const FORBIDDEN_PART_PATHS: ReadonlyMap<string, AdmissionRefusalReason> = new Map([
  ["xl/vbaProject.bin", "MACRO_ENABLED"],
  ["xl/macrosheets/sheet1.xml", "MACRO_ENABLED"],
  ["EncryptedPackage", "ENCRYPTED"],
])

/** Part-path prefixes whose presence is disqualifying. */
const FORBIDDEN_PART_PREFIXES: readonly (readonly [string, AdmissionRefusalReason])[] = [
  ["xl/macrosheets/", "MACRO_ENABLED"],
  ["xl/activeX/", "ACTIVE_CONTENT"],
  ["xl/ctrlProps/", "ACTIVE_CONTENT"],
  ["xl/externalLinks/", "EXTERNAL_LINK"],
  ["xl/embeddings/", "EMBEDDED_OBJECT"],
  ["xl/oleObjects/", "EMBEDDED_OBJECT"],
]

// Deliberately NOT here: `customXml/`, `docProps/`, `xl/drawings/`,
// `xl/printerSettings/`, `xl/media/`. Excel writes all of them for ordinary
// reasons — a content-type binding, a chart, a page setup, a pasted logo — and a
// control that refuses an ordinary workbook is a control somebody turns off.

/** The part every spreadsheet package has, and nothing else does. */
const WORKBOOK_PART = "xl/workbook.xml"

/** MIME types whose declaration alone is a refusal. */
const MACRO_ENABLED_MIMES: readonly string[] = [
  "application/vnd.ms-excel.sheet.macroEnabled.12",
  "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
  "application/vnd.ms-excel.template.macroEnabled.12",
  "application/vnd.ms-excel.addin.macroEnabled.12",
]

export type AdmissionRefusalReason =
  | "MACRO_ENABLED"
  | "ACTIVE_CONTENT"
  | "EXTERNAL_LINK"
  | "EMBEDDED_OBJECT"
  | "ENCRYPTED"
  | "LEGACY_BINARY_WORKBOOK"
  | "UNSUPPORTED_CONTAINER"
  | "UNSUPPORTED_COMPRESSION"
  | "UNSAFE_PART_NAME"
  | "NOT_A_SPREADSHEET_PACKAGE"
  | "FILE_TOO_LARGE"
  | "TOO_MANY_PARTS"
  | "PART_TOO_LARGE"
  | "EXPANSION_TOO_LARGE"
  | "EXPANSION_RATIO_TOO_HIGH"

/** What the container is, once admitted. */
export type AdmittedContainer =
  /** A ZIP package with `xl/workbook.xml`: .xlsx and friends. */
  | "ooxml"
  /** Not an archive at all: CSV or another delimited text file. */
  | "delimited"

export type WorkbookAdmission =
  | {
      admitted: true
      container: AdmittedContainer
      byteCount: number
      /** Members in the archive. 0 for a delimited file. */
      partCount: number
      /** What the archive says it would inflate to. 0 for a delimited file. */
      declaredUncompressedBytes: number
    }
  | {
      admitted: false
      reason: AdmissionRefusalReason
      /** Literal sentences and integers only. Never a byte from the file. */
      detail: string
    }

function refuse(reason: AdmissionRefusalReason, detail: string): WorkbookAdmission {
  return { admitted: false, reason, detail }
}

/** A ZIP indexing failure, in this module's vocabulary. */
function fromZipFailure(reason: ZipReadFailure): WorkbookAdmission {
  switch (reason) {
    case "ZIP64":
      return refuse(
        "UNSUPPORTED_CONTAINER",
        `This file is a ZIP64 archive. ZIP64 exists for archives past 4 GB, and this pipeline accepts ${WORKBOOK_LIMITS.FILE_BYTES} bytes, so a workbook has no reason to use it.`,
      )
    case "SPANNED":
      return refuse(
        "UNSUPPORTED_CONTAINER",
        "This file is one disk of a multi-part archive. A workbook is a single file; a spanned archive is missing the rest of itself.",
      )
    case "MALFORMED_DIRECTORY":
      return refuse(
        "UNSUPPORTED_CONTAINER",
        "This file's archive index does not parse. Either it is truncated or the index disagrees with itself, and a parser handed it would be reading whatever the disagreement resolves to.",
      )
    case "NOT_A_ZIP":
      return refuse(
        "UNSUPPORTED_CONTAINER",
        "This file begins like an archive and has no archive index. It cannot be read as a workbook.",
      )
  }
}

/**
 * A part path that would escape the package.
 *
 * No spreadsheet part is absolute or relative-upward. One that is was written
 * to be extracted somewhere other than where the extractor intended, which is
 * the only reason to build one.
 */
function isUnsafePartName(name: string): boolean {
  if (name.startsWith("/") || name.startsWith("\\")) return true
  if (/^[A-Za-z]:/.test(name)) return true
  return name.split(/[/\\]/).includes("..")
}

/**
 * Admit a workbook, or say which control refused it and why.
 *
 * `bytes` is the whole file. `mime` is what the upload declared, used only to
 * refuse — never to accept — because the declaration is the one part of an
 * upload the uploader fully controls.
 */
export function admitWorkbook(bytes: Uint8Array, opts: { mime: string }): WorkbookAdmission {
  if (bytes.length > WORKBOOK_LIMITS.FILE_BYTES) {
    return refuse(
      "FILE_TOO_LARGE",
      `This file is larger than the ${WORKBOOK_LIMITS.FILE_BYTES}-byte ingestion limit. Split it or upload it through a governed connector.`,
    )
  }

  const declaredMime = opts.mime.trim().toLowerCase()
  if (MACRO_ENABLED_MIMES.some((m) => declaredMime === m.toLowerCase())) {
    return refuse(
      "MACRO_ENABLED",
      "This upload declares a macro-enabled Excel format. Macro-enabled workbooks are refused: a macro runs on the machine of whoever opens it, and the person who opens a roster file is the person whose permissions are worth taking.",
    )
  }

  if (looksLikeCompoundFile(bytes)) {
    return refuse(
      "LEGACY_BINARY_WORKBOOK",
      "This file is a legacy binary Office document (or a password-protected one, which uses the same container). Neither can be checked for macros the way a modern workbook can. Save it as .xlsx and upload that.",
    )
  }

  if (!looksLikeZip(bytes)) {
    // Not an archive and not a compound file: a delimited text file. There is
    // no index to check, so the only container control that applies is size,
    // which was applied above.
    return { admitted: true, container: "delimited", byteCount: bytes.length, partCount: 0, declaredUncompressedBytes: 0 }
  }

  const index = readZipCentralDirectory(bytes)
  if (!index.ok) return fromZipFailure(index.reason)

  const entries: readonly ZipEntry[] = index.entries

  if (entries.length > WORKBOOK_LIMITS.PARTS) {
    return refuse(
      "TOO_MANY_PARTS",
      `This archive declares more than ${WORKBOOK_LIMITS.PARTS} members. A workbook has tens; an archive with thousands is either not a workbook or is built to exhaust whatever opens it.`,
    )
  }

  let totalUncompressed = 0
  let totalCompressed = 0
  let hasWorkbookPart = false

  for (const entry of entries) {
    if (entry.encrypted) {
      return refuse(
        "ENCRYPTED",
        "A member of this archive is encrypted. There is no approved workflow for password-protected roster files, and a file that cannot be read cannot be validated, previewed or approved.",
      )
    }

    if (isUnsafePartName(entry.name)) {
      return refuse(
        "UNSAFE_PART_NAME",
        "A member of this archive is named so that extracting it would write outside the package. No spreadsheet part is; one that is was built to be extracted somewhere else.",
      )
    }

    if (!SUPPORTED_COMPRESSION_METHODS.has(entry.compressionMethod)) {
      return refuse(
        "UNSUPPORTED_COMPRESSION",
        "A member of this archive uses a compression method this pipeline does not read. Only stored and deflated members are accepted.",
      )
    }

    if (entry.uncompressedSize > WORKBOOK_LIMITS.PART_UNCOMPRESSED_BYTES) {
      return refuse(
        "PART_TOO_LARGE",
        `A member of this archive declares more than ${WORKBOOK_LIMITS.PART_UNCOMPRESSED_BYTES} bytes once expanded. That is past the per-part limit, and the limit is checked against the declaration precisely so nothing has to be expanded to find out.`,
      )
    }

    const normalised = entry.name.replace(/\\/g, "/")
    const exact = FORBIDDEN_PART_PATHS.get(normalised)
    if (exact) return refuse(exact, detailForPart(exact))
    for (const [prefix, reason] of FORBIDDEN_PART_PREFIXES) {
      if (normalised.startsWith(prefix)) return refuse(reason, detailForPart(reason))
    }

    if (normalised === WORKBOOK_PART) hasWorkbookPart = true

    totalUncompressed += entry.uncompressedSize
    totalCompressed += entry.compressedSize
  }

  if (totalUncompressed > WORKBOOK_LIMITS.TOTAL_UNCOMPRESSED_BYTES) {
    return refuse(
      "EXPANSION_TOO_LARGE",
      `This archive declares more than ${WORKBOOK_LIMITS.TOTAL_UNCOMPRESSED_BYTES} bytes once expanded. Nothing was expanded to find that out.`,
    )
  }

  // A stored-only archive has a ratio of 1 and a compressed size of 0 only when
  // every member is empty, in which case there is nothing to expand and no ratio
  // to exceed. Guarding the divisor rather than special-casing the result keeps
  // the comparison the same shape in both branches.
  if (totalCompressed > 0 && totalUncompressed / totalCompressed > WORKBOOK_LIMITS.EXPANSION_RATIO) {
    return refuse(
      "EXPANSION_RATIO_TOO_HIGH",
      `This archive would expand to more than ${WORKBOOK_LIMITS.EXPANSION_RATIO} times its own size. Spreadsheet XML compresses well, and not that well; a ratio past this is a decompression bomb.`,
    )
  }

  if (!hasWorkbookPart) {
    return refuse(
      "NOT_A_SPREADSHEET_PACKAGE",
      `This archive has no ${WORKBOOK_PART} part, so it is not a spreadsheet package whatever it is named. Upload the workbook itself rather than an archive of it.`,
    )
  }

  return {
    admitted: true,
    container: "ooxml",
    byteCount: bytes.length,
    partCount: entries.length,
    declaredUncompressedBytes: totalUncompressed,
  }
}

/** The sentence for a forbidden part, chosen by reason and nothing else. */
function detailForPart(reason: AdmissionRefusalReason): string {
  switch (reason) {
    case "MACRO_ENABLED":
      return "This workbook contains a macro project. Macro-enabled workbooks are refused whatever they are named: the extension is a declaration and the macro is in the file."
    case "ACTIVE_CONTENT":
      return "This workbook contains active content — an embedded control that runs when the file is opened. Roster data does not need one."
    case "EXTERNAL_LINK":
      return "This workbook links to another workbook. What it would show depends on a file this pipeline cannot see, so the values in it are not the values that were approved. Paste the values in and upload that."
    case "EMBEDDED_OBJECT":
      return "This workbook contains an embedded object. An embedded object is a second file travelling inside the first, and it is neither scanned nor validated by anything that validates the sheet."
    case "ENCRYPTED":
      return "This workbook is encrypted. A file that cannot be read cannot be validated, previewed or approved."
    default:
      return "This workbook contains a part this pipeline does not accept."
  }
}
