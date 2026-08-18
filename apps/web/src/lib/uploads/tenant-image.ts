/**
 * GE-143-007 — sanitation rules for tenant-supplied imagery.
 *
 * A club logo and a member avatar are the two icons a TENANT provides, and they
 * were admitted on the strength of `file.type.startsWith("image/")`. That check
 * reads a string the browser was asked to attach to the upload; it is a claim by
 * the client about the bytes, not a fact about them, and everything downstream
 * then treats it as a fact:
 *
 *   * `fileRef({ mimeType: file.type })` records it as the object's content type,
 *   * `uploadDocument` sends it to S3 as `ContentType`,
 *   * `documentViewUrl` serves the object back with `Content-Disposition: inline`.
 *
 * So a file declared `image/svg+xml` is stored as SVG and served inline, and an
 * SVG is a document: it may carry `<script>`, `<foreignObject>` and external
 * references, and a browser navigating to it executes them. "PNG, JPG, or GIF up
 * to 5 MB" was the label under the control; nothing enforced it.
 *
 * The rule here is that the FORMAT IS DECIDED BY THE BYTES. The declared type is
 * only ever used to detect disagreement, the extension comes from the sniffed
 * format rather than from the file name, and anything the sniffer cannot
 * identify is refused with a reason rather than stored with a guess.
 *
 * Not claimed: this is not malware scanning, and it is not a promise that a
 * well-formed PNG is safe to decode. It is the format boundary — GE-150-005 is
 * where quarantine, scanning and polyglot analysis live, and pretending this
 * closed those would be worse than not writing it.
 */

/**
 * The upload paths that still record the content type the CLIENT declared.
 *
 * Three of them, and they are documents rather than tenant imagery: a message
 * attachment, a club document and a finance receipt. This item is the icon
 * boundary — a logo and an avatar, the two images a tenant supplies that the
 * product then renders as its own chrome — and the document paths need a
 * different answer, because the formats they accept (`xlsx`, `docx`, `pdf`) are
 * containers whose sanitation is quarantine and scanning rather than a
 * signature check. That is GE-150-005's sentence, not this one's.
 *
 * Recorded rather than implied, with the count, so the next reader knows the
 * boundary was drawn deliberately and knows exactly where it is.
 * `tenant-image.test.ts` compares this register to the tree as a map: a NEW path
 * that trusts `file.type` fails, and one of these that is fixed fails until its
 * number comes down.
 */
export const CLIENT_DECLARED_TYPE_BACKLOG: readonly {
  file: string
  occurrences: number
  what: string
  owner: string
}[] = [
  {
    file: "src/app/(app)/messages/actions.ts",
    occurrences: 2,
    what: "message attachments — any type, delivered through /api/attachment",
    owner: "GE-150-005 (file controls: quarantine, malware, MIME/polyglot)",
  },
  {
    file: "src/app/(app)/orgs/[slug]/documents/actions.ts",
    occurrences: 2,
    what: "club documents — docx/pdf/xlsx, parsed server-side and rendered",
    owner: "GE-150-005",
  },
  {
    file: "src/app/(app)/orgs/[slug]/finance/actions.ts",
    occurrences: 2,
    what: "finance receipts attached to a ledger entry",
    owner: "GE-150-005",
  },
]

/** The formats a tenant icon may be, by magic bytes. Order is not significant. */
export interface ImageFormat {
  /** The identifier used in refusals and in the stored extension. */
  id: "png" | "jpeg" | "gif" | "webp"
  /** The content type the object is stored and served with. */
  mimeType: string
  /** Extensions a browser may attach to this format; the first is what we store. */
  extension: string
  /** True when the buffer starts with this format's signature. */
  matches: (bytes: Uint8Array) => boolean
}

const startsWith = (bytes: Uint8Array, signature: readonly number[]) =>
  bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte)

export const IMAGE_FORMATS: readonly ImageFormat[] = [
  {
    id: "png",
    mimeType: "image/png",
    extension: "png",
    matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    id: "jpeg",
    mimeType: "image/jpeg",
    extension: "jpg",
    matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  },
  {
    id: "gif",
    mimeType: "image/gif",
    extension: "gif",
    // GIF87a and GIF89a. The version byte is checked rather than skipped: a
    // signature that accepts any third character accepts `GIF<script>`.
    matches: (b) =>
      startsWith(b, [0x47, 0x49, 0x46, 0x38]) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61,
  },
  {
    id: "webp",
    mimeType: "image/webp",
    extension: "webp",
    // RIFF....WEBP — the four size bytes in between are content, not signature.
    matches: (b) =>
      startsWith(b, [0x52, 0x49, 0x46, 0x46]) &&
      b.length >= 12 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
]

/** The one place the size limit is written. The control's label quotes it. */
export const TENANT_IMAGE_MAX_BYTES = 5 * 1024 * 1024

/** The format a buffer actually is, by its bytes, or null. */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  return IMAGE_FORMATS.find((format) => format.matches(bytes)) ?? null
}

/**
 * Whether a buffer is a document that a browser would EXECUTE rather than draw.
 *
 * Checked separately from "is it one of the four formats" so the refusal can say
 * which of the two problems it is. An SVG is a valid image and a valid script
 * host at the same time, and "that is not an image" is the wrong sentence to
 * show somebody who uploaded a perfectly good SVG logo — they need to know it
 * was refused deliberately, and what to upload instead.
 *
 * Leading whitespace and a byte-order mark are skipped, because a document
 * beginning with them is the same document.
 */
export function looksLikeActiveContent(bytes: Uint8Array): string | null {
  const head = Buffer.from(bytes.slice(0, 1024))
    .toString("utf8")
    .replace(/^﻿/, "")
    .trimStart()
    .toLowerCase()
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "an SVG"
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) return "an HTML document"
  if (head.includes("<script")) return "a document containing a script"
  return null
}

export interface AcceptedTenantImage {
  /** The content type derived from the BYTES, for storage and for serving. */
  mimeType: string
  /** The extension derived from the bytes, for the object key. */
  extension: string
  /** The format's identifier, for an audit line that says what was accepted. */
  format: ImageFormat["id"]
  sizeBytes: number
}

export interface RefusedTenantImage {
  /** A stable code, so a caller can branch without matching on prose. */
  code: "empty" | "too-large" | "active-content" | "unrecognised" | "type-mismatch"
  /** A sentence the person who chose the file can act on. */
  explanation: string
}

export type TenantImageVerdict =
  | { accepted: AcceptedTenantImage; refused?: undefined }
  | { accepted?: undefined; refused: RefusedTenantImage }

/**
 * Decides whether tenant-supplied bytes may be stored and served as an image.
 *
 * `declaredType` is the client's claim. It is never used to accept anything —
 * only to refuse when it disagrees with the bytes, because a file whose label
 * and content differ is either a mistake worth telling somebody about or a
 * deliberate polyglot, and both should stop here rather than at the browser
 * that eventually renders it.
 */
export function sanitizeTenantImage(input: {
  bytes: Uint8Array
  declaredType?: string
  maxBytes?: number
}): TenantImageVerdict {
  const { bytes, declaredType } = input
  const maxBytes = input.maxBytes ?? TENANT_IMAGE_MAX_BYTES

  if (bytes.length === 0) {
    return { refused: { code: "empty", explanation: "That file is empty. Choose an image file." } }
  }
  if (bytes.length > maxBytes) {
    return {
      refused: {
        code: "too-large",
        explanation: `Images must be under ${Math.floor(maxBytes / (1024 * 1024))} MB. That file is ${(
          bytes.length /
          (1024 * 1024)
        ).toFixed(1)} MB.`,
      },
    }
  }

  const format = sniffImageFormat(bytes)
  if (!format) {
    const active = looksLikeActiveContent(bytes)
    if (active) {
      return {
        refused: {
          code: "active-content",
          explanation:
            `That file is ${active}, which a browser can run as code rather than draw as a picture, ` +
            "so it is not accepted as a logo or a photo. Upload a PNG, JPG, GIF or WebP instead.",
        },
      }
    }
    return {
      refused: {
        code: "unrecognised",
        explanation:
          "That file is not a PNG, JPG, GIF or WebP. The format is read from the file's own contents, " +
          "so renaming it does not change the answer.",
      },
    }
  }

  if (declaredType && declaredType !== format.mimeType) {
    return {
      refused: {
        code: "type-mismatch",
        explanation:
          `That file says it is ${declaredType} and its contents are ${format.mimeType}. ` +
          "A file whose label and contents disagree is not stored, because whichever one is wrong, " +
          "something downstream would believe it.",
      },
    }
  }

  return {
    accepted: {
      mimeType: format.mimeType,
      extension: format.extension,
      format: format.id,
      sizeBytes: bytes.length,
    },
  }
}
