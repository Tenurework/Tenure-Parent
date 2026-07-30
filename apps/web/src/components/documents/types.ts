/**
 * Shared, dependency-free types for the unified document viewer. Imported by
 * both the server-side content builder (src/app/api/documents/_lib/content.ts)
 * and the client viewer components — so this file must stay free of any
 * server-only imports (mammoth / xlsx / jszip / s3).
 */

/** A single parsed spreadsheet: a name plus a rectangular grid of cell values. */
export type SheetData = { name: string; rows: (string | number | null)[][] }

/** One PPTX slide reduced to a readable outline (title + bullet lines + notes). */
export type PptxSlide = { index: number; lines: string[]; notes: string[] }

/** Discriminated union describing how a document should be rendered. */
export type DocContent =
  | { kind: "unconfigured" }
  | { kind: "pdf"; url: string }
  | { kind: "image"; url: string }
  | { kind: "html"; html: string }
  | { kind: "sheets"; sheets: SheetData[] }
  | { kind: "text"; text: string }
  | { kind: "pptx"; slides: PptxSlide[] }
  | { kind: "unsupported"; reason: string; mime?: string }

export interface DocMeta {
  id: string
  title: string
  mimeType: string
  sizeBytes: number | null
  /** ISO string — doubles as the optimistic-lock token (baseUpdatedAt). */
  updatedAt: string
  version: number
  orgName: string
  orgSlug: string
}

export interface DocContentResponse {
  meta: DocMeta
  /** True only when the viewer both may edit (permission) and the format is editable. */
  editable: boolean
  canSummarize: boolean
  content: DocContent
}

export interface AttachmentMeta {
  id: string
  title: string
  mimeType: string
  sizeBytes: number | null
}

export interface AttachmentContentResponse {
  meta: AttachmentMeta
  /** Attachments are never editable. */
  content: DocContent
}

/** Save-request payload for POST /api/documents/[id]/save. */
export type SavePayload =
  | { kind: "text"; content: string }
  | { kind: "xlsx"; base64: string }
