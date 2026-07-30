/**
 * Server-side document → renderable content builder. This is the single place
 * that turns stored bytes into the `DocContent` discriminated union consumed by
 * the viewer overlay, the full-page /view route, and the attachment preview.
 *
 * Heavy parsers (mammoth / xlsx / jszip) live here and NOWHERE a client bundle
 * can reach — this module is imported only by route handlers and the server
 * `view` page. Every parse path is wrapped so a bad file degrades to
 * `{ kind: "unsupported" }` instead of throwing.
 *
 * Note: this folder is underscore-prefixed (`_lib`), so the App Router treats
 * it as private and never registers a route for it.
 */
import mammoth from "mammoth"
import * as XLSX from "xlsx"
import JSZip from "jszip"
import { documentsBucket, documentViewUrl, getDocumentBytes } from "@/lib/s3"
import type { DocContent, PptxSlide, SheetData } from "@/components/documents/types"

/** Existing native-parse ceiling — anything larger is offered as a download. */
const MAX_PARSE_BYTES = 10 * 1024 * 1024
const MAX_SHEETS = 3
const MAX_ROWS = 300
const MAX_TEXT_CHARS = 200_000

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const XLS = "application/vnd.ms-excel"
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

function is(mime: string, ...prefixes: string[]): boolean {
  return prefixes.some((p) => mime.startsWith(p) || mime === p)
}

/** True when the format edits as a plain textarea (JSON / XML / plain text). */
export function isTextMime(mime: string): boolean {
  return is(mime, "text/", "application/json", "application/xml", "application/csv")
}

/** True when the format edits as a spreadsheet grid. */
export function isSheetMime(mime: string): boolean {
  return is(mime, XLSX_MIME, XLS, "text/csv", "application/csv")
}

/**
 * Build the renderable content for a stored object. Never throws: storage
 * problems or unparseable files resolve to an `unsupported` (or `unconfigured`)
 * card. PDF / image resolve to short-lived presigned URLs; everything else is
 * parsed from bytes under the 10 MB cap.
 */
export async function buildDocContent(opts: {
  objectKey: string
  mime: string
  sizeBytes: number | null
}): Promise<DocContent> {
  const { objectKey, mime, sizeBytes } = opts

  if (!documentsBucket) return { kind: "unconfigured" }

  try {
    if (is(mime, "application/pdf")) {
      return { kind: "pdf", url: await documentViewUrl(objectKey) }
    }
    if (is(mime, "image/")) {
      return { kind: "image", url: await documentViewUrl(objectKey) }
    }
    if ((sizeBytes ?? 0) > MAX_PARSE_BYTES) {
      return {
        kind: "unsupported",
        reason: "This file is too large to preview natively — download it instead.",
        mime,
      }
    }

    const bytes = await getDocumentBytes(objectKey)

    if (is(mime, DOCX)) {
      const { value } = await mammoth.convertToHtml({ buffer: bytes })
      return { kind: "html", html: value }
    }

    if (isSheetMime(mime)) {
      const wb = XLSX.read(bytes, { type: "buffer" })
      const sheets: SheetData[] = wb.SheetNames.slice(0, MAX_SHEETS).map((name) => {
        const rows = XLSX.utils
          .sheet_to_json<(string | number | null)[]>(wb.Sheets[name], {
            header: 1,
            defval: "",
          })
          .slice(0, MAX_ROWS) as (string | number | null)[][]
        return { name, rows }
      })
      return { kind: "sheets", sheets }
    }

    if (is(mime, PPTX)) {
      const slides = await extractPptx(bytes)
      return { kind: "pptx", slides }
    }

    if (isTextMime(mime)) {
      return { kind: "text", text: bytes.toString("utf8").slice(0, MAX_TEXT_CHARS) }
    }

    return {
      kind: "unsupported",
      reason: `No preview for ${mime} yet — download it instead.`,
      mime,
    }
  } catch {
    return {
      kind: "unsupported",
      reason: "This file could not be previewed. Download it instead.",
      mime,
    }
  }
}

// ─── PPTX text extraction ────────────────────────────────────────────────────

const A_T = /<a:t>([\s\S]*?)<\/a:t>/g
const A_P = /<a:p\b[\s\S]*?<\/a:p>/g

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
}

/** One line per `<a:p>` paragraph, runs (`<a:t>`) concatenated, blanks dropped. */
function linesFromSlideXml(xml: string): string[] {
  const lines: string[] = []
  const paras = xml.match(A_P) ?? []
  for (const p of paras) {
    let text = ""
    let m: RegExpExecArray | null
    A_T.lastIndex = 0
    while ((m = A_T.exec(p)) !== null) text += m[1]
    const clean = decodeXml(text).replace(/\s+/g, " ").trim()
    if (clean) lines.push(clean)
  }
  return lines
}

async function extractPptx(bytes: Buffer): Promise<PptxSlide[]> {
  const zip = await JSZip.loadAsync(bytes)

  const slideFiles = Object.keys(zip.files)
    .map((path) => {
      const m = path.match(/^ppt\/slides\/slide(\d+)\.xml$/)
      return m ? { path, n: Number(m[1]) } : null
    })
    .filter((x): x is { path: string; n: number } => x !== null)
    .sort((a, b) => a.n - b.n)

  const slides: PptxSlide[] = []
  for (const { path, n } of slideFiles) {
    const xml = await zip.file(path)!.async("string")
    const lines = linesFromSlideXml(xml)

    let notes: string[] = []
    try {
      const relsFile = zip.file(`ppt/slides/_rels/slide${n}.xml.rels`)
      if (relsFile) {
        const rels = await relsFile.async("string")
        const target = rels.match(/Target="([^"]*notesSlide\d+\.xml)"/)?.[1]
        if (target) {
          // Targets are relative to ppt/slides/ (e.g. ../notesSlides/notesSlide1.xml)
          const resolved = target.replace(/^\.\.\//, "ppt/").replace(/^\/+/, "")
          const notesFile = zip.file(resolved) ?? zip.file(`ppt/${target.replace(/^\.\.\//, "")}`)
          if (notesFile) notes = linesFromSlideXml(await notesFile.async("string"))
        }
      }
    } catch {
      // Notes are optional — a missing/malformed rels file just drops them.
    }

    slides.push({ index: slides.length + 1, lines, notes })
  }

  return slides
}
