"use client"

import { useCallback, useState } from "react"
import { Download, Loader2, Paperclip } from "@/components/ui/icons"
import { Overlay } from "@/components/ui/Overlay"
import { DocContentView } from "@/components/documents/DocContentView"
import type { AttachmentContentResponse, DocContent } from "@/components/documents/types"

function formatBytes(n: number | null): string {
  if (!n) return ""
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const chipClass =
  "inline-flex items-center gap-2 rounded-md border border-border bg-base px-3 py-1.5 text-[13px] text-text-1 no-underline transition-colors hover:border-[--primary]"

/** Mimes the unified viewer can render — everything else stays a plain download. */
function isPreviewable(mime: string): boolean {
  return (
    mime.startsWith("image/") ||
    mime === "application/pdf" ||
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/csv" ||
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel" ||
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  )
}

/**
 * A single message-attachment chip. Previewable types (pdf, images, text,
 * spreadsheets, slides) open in the shared read-only viewer overlay, fetching
 * parsed content from the ACL-protected `/api/attachment/[id]/content` route.
 * Everything else keeps the plain signed-URL download link. Attachments are
 * never editable.
 */
export function AttachmentChip({
  id,
  fileName,
  mimeType,
  sizeBytes,
}: {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number | null
}) {
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState<DocContent | null>(null)
  const [failed, setFailed] = useState(false)
  const size = formatBytes(sizeBytes)
  const href = `/api/attachment/${id}`

  const load = useCallback(async () => {
    setContent(null)
    setFailed(false)
    try {
      const res = await fetch(`/api/attachment/${id}/content`, { cache: "no-store" })
      if (!res.ok) {
        setFailed(true)
        return
      }
      const data = (await res.json()) as AttachmentContentResponse
      setContent(data.content)
    } catch {
      setFailed(true)
    }
  }, [id])

  const inner = (
    <>
      <Paperclip size={14} className="text-text-3" />
      <span className="max-w-[200px] truncate">{fileName}</span>
      {size ? <span className="text-text-3">{size}</span> : null}
    </>
  )

  if (!isPreviewable(mimeType)) {
    return (
      <a href={href} className={chipClass}>
        {inner}
      </a>
    )
  }

  return (
    <>
      <button
        type="button"
        data-testid="attachment-preview"
        onClick={() => {
          setOpen(true)
          load()
        }}
        className={chipClass}
      >
        {inner}
      </button>

      <Overlay
        isOpen={open}
        onOpenChange={setOpen}
        size="xl"
        title={fileName}
        description={[mimeType, size].filter(Boolean).join(" · ")}
      >
        <div className="space-y-3">
          {failed ? (
            <p className="rounded-lg border border-border bg-base px-4 py-6 text-center text-sm text-text-2">
              This attachment couldn&apos;t be previewed. Download it to open it.
            </p>
          ) : content ? (
            <DocContentView content={content} title={fileName} />
          ) : (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-text-3">
              <Loader2 size={16} className="animate-spin" /> Loading preview…
            </div>
          )}
          <a
            href={href}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-2 no-underline hover:bg-base"
          >
            <Download size={13} /> Download
          </a>
        </div>
      </Overlay>
    </>
  )
}
