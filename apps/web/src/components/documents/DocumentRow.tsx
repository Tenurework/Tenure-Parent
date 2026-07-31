"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Download,
  ExternalLink,
  FileText,
  Sparkles,
  Trash2,
} from "@/components/ui/icons"
import {
  DocumentViewerOverlay,
  type ViewerInitialMeta,
} from "@/components/documents/DocumentViewerOverlay"
import { ConfirmSubmit } from "@/components/ui/ConfirmDialog"

const rowActionBtn =
  "inline-flex items-center gap-1.5 h-8 rounded-md border border-border px-3 text-xs font-medium text-text-2 hover:bg-base transition-colors no-underline"

/**
 * One document list row. The title/main area is a real button that opens the
 * unified viewer overlay (no navigation, no download). Secondary actions —
 * open full page, summarize, download, delete — sit to the right.
 */
export function DocumentRow({
  slug,
  docId,
  title,
  sizeLabel,
  uploaderName,
  dateLabel,
  initialMeta,
  canDelete,
  showSummarize,
  downloadAction,
  deleteAction,
}: {
  slug: string
  docId: string
  title: string
  sizeLabel: string
  uploaderName: string
  dateLabel: string
  initialMeta: ViewerInitialMeta
  canDelete: boolean
  showSummarize: boolean
  downloadAction: (formData: FormData) => Promise<void>
  deleteAction: (formData: FormData) => Promise<void>
}) {
  const [open, setOpen] = useState(false)

  return (
    <li className="flex items-center gap-3 px-5 py-3.5">
      <button
        type="button"
        data-testid="document-row"
        onClick={() => setOpen(true)}
        className="-mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1 text-left transition-colors hover:bg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--primary]"
      >
        <FileText size={16} className="shrink-0 text-text-3" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-text-1">{title}</span>
          <span className="mt-0.5 block text-xs text-text-3">
            {sizeLabel} · {uploaderName} · {dateLabel}
          </span>
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-2">
        {showSummarize && (
          <Link
            href={`/orgs/${slug}/documents/${docId}/summary`}
            className={`${rowActionBtn} text-[--primary]`}
            aria-label={`Summarize ${title}`}
          >
            <Sparkles size={13} /> Summarize
          </Link>
        )}
        <Link
          href={`/orgs/${slug}/documents/${docId}/view`}
          className="grid h-8 w-8 place-items-center rounded-md border border-border text-text-2 no-underline transition-colors hover:bg-base"
          aria-label={`Open ${title} in a full page`}
          title="Open full page"
        >
          <ExternalLink size={14} />
        </Link>
        <form action={downloadAction}>
          <input type="hidden" name="documentId" value={docId} />
          <button type="submit" className={rowActionBtn} aria-label={`Download ${title}`}>
            <Download size={13} /> Download
          </button>
        </form>
        {canDelete && (
          <ConfirmSubmit
            action={deleteAction}
            hiddenFields={{ documentId: docId }}
            title="Delete this document?"
            description={`“${title}” is removed from this club's document library. An OSE admin can still restore it, and the deletion is recorded in the audit log.`}
            confirmLabel="Delete document"
            variant="danger"
            triggerClassName={`${rowActionBtn} text-[--error]`}
            triggerAriaLabel={`Delete ${title}`}
          >
            <Trash2 size={13} /> Delete
          </ConfirmSubmit>
        )}
      </div>

      <DocumentViewerOverlay
        open={open}
        onOpenChange={setOpen}
        docId={docId}
        slug={slug}
        initialMeta={initialMeta}
        downloadAction={downloadAction}
      />
    </li>
  )
}
