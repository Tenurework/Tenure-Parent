"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import * as XLSX from "xlsx"
import { Overlay } from "@/components/ui/Overlay"
import {
  AlertCircle,
  CheckCircle,
  Download,
  Eye,
  Loader2,
  PenSquare,
  Plus,
  Sparkles,
} from "@/components/ui/icons"
import { DocContentView } from "@/components/documents/DocContentView"
import { StateSurface } from "@/components/ui/StateSurface"
import type { DocContentResponse, SavePayload, SheetData } from "@/components/documents/types"

/**
 * TTES-040-002. `session-expired` is a separate state, not an `error`.
 *
 * An idle-expired session (SESSION_IDLE_SECONDS, src/lib/auth.ts) turned an
 * autosave into a 401, which fell into `error` — and `error` sets
 * `dirtyRef.current = true`, so the debounce fired again, got another 401, and
 * kept doing that until the reader navigated and lost everything they had
 * typed. The draft is worth more than the retry: this state stops retrying,
 * keeps the text exactly where it is in component state, and offers a
 * re-authenticate link back to the same URL.
 *
 * Nothing is written anywhere. The draft stays in memory only — no token, no
 * localStorage, no sessionStorage — so
 * tests/security/no-tokens-in-browser-storage.test.mjs stays satisfied.
 */
type SaveStatus =
  | "idle"
  | "dirty"
  | "saving"
  | "saved"
  | "error"
  | "conflict"
  | "session-expired"

/** Presigned URLs live 600 s; refresh a little early once the modal is stale. */
const STALE_MS = 9 * 60 * 1000
const AUTOSAVE_MS = 1500
const MAX_SAVE_BYTES = 15 * 1024 * 1024

export interface ViewerInitialMeta {
  title: string
  mimeType: string
  sizeBytes: number | null
  orgName: string
  updatedAt: string
}

function isCsv(mime: string): boolean {
  return mime === "text/csv" || mime === "application/csv"
}

function formatBytes(n?: number | null): string {
  if (!n) return "—"
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function shortType(mime: string): string {
  const map: Record<string, string> = {
    "application/pdf": "PDF",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
    "application/msword": "Word",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
    "application/vnd.ms-excel": "Excel",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
    "text/csv": "CSV",
    "application/csv": "CSV",
    "application/json": "JSON",
    "application/xml": "XML",
    "text/plain": "Text",
  }
  if (map[mime]) return map[mime]
  if (mime.startsWith("image/")) return "Image"
  if (mime.startsWith("text/")) return "Text"
  return mime
}

function deepCopySheets(sheets: SheetData[]): SheetData[] {
  return sheets.map((s) => ({ name: s.name, rows: s.rows.map((r) => [...r]) }))
}

const toolbarBtn =
  "inline-flex items-center gap-1.5 h-8 rounded-md border border-border px-3 text-xs font-medium text-text-2 hover:bg-base transition-colors disabled:opacity-50"

/**
 * The unified in-app document viewer overlay: header + toolbar + format-aware
 * body, with in-place editing and debounced autosave for text and spreadsheets.
 * Fully controlled via `open` / `onOpenChange`; on a close request it flushes
 * any pending save before actually closing.
 */
export function DocumentViewerOverlay({
  open,
  onOpenChange,
  docId,
  slug,
  initialMeta,
  downloadAction,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  docId: string
  slug: string
  initialMeta: ViewerInitialMeta
  downloadAction: (formData: FormData) => Promise<void>
}) {
  const [data, setData] = useState<DocContentResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<"view" | "edit">("view")
  const [status, setStatus] = useState<SaveStatus>("idle")
  const [textValue, setTextValue] = useState("")
  const [sheets, setSheets] = useState<SheetData[]>([])

  // Refs mirror the latest values for the debounced/flush paths (no stale closures).
  const dataRef = useRef<DocContentResponse | null>(null)
  const textRef = useRef("")
  const sheetsRef = useRef<SheetData[]>([])
  const baseUpdatedAtRef = useRef<string>(initialMeta.updatedAt)
  const fetchedAtRef = useRef(0)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const conflictRef = useRef(false)
  /** Latched on a 401. Stops the debounce re-firing into a signed-out session. */
  const expiredRef = useRef(false)
  const closingRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savePromiseRef = useRef<Promise<void> | null>(null)

  const load = useCallback(
    async (opts?: { keepMode?: boolean }) => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/documents/${docId}/content?slug=${encodeURIComponent(slug)}`,
          { cache: "no-store" }
        )
        if (!res.ok) {
          setError("This document could not be loaded.")
          return
        }
        const json = (await res.json()) as DocContentResponse
        setData(json)
        dataRef.current = json
        baseUpdatedAtRef.current = json.meta.updatedAt
        fetchedAtRef.current = Date.now()
        dirtyRef.current = false
        conflictRef.current = false
        expiredRef.current = false
        if (json.content.kind === "text") {
          textRef.current = json.content.text
          setTextValue(json.content.text)
        } else if (json.content.kind === "sheets") {
          const copy = deepCopySheets(json.content.sheets)
          sheetsRef.current = copy
          setSheets(copy)
        }
        if (!opts?.keepMode) setMode("view")
        setStatus("idle")
      } catch {
        setError("This document could not be loaded.")
      } finally {
        setLoading(false)
      }
    },
    [docId, slug]
  )

  // Fetch fresh content (and a fresh presigned URL + lock token) on each open.
  useEffect(() => {
    if (open) void load()
    // Reset transient state when fully closed so a reopen starts clean.
    if (!open) {
      closingRef.current = false
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [open, load])

  const buildPayload = useCallback((): SavePayload | null => {
    const d = dataRef.current
    if (!d) return null
    if (d.content.kind === "text") {
      return { kind: "text", content: textRef.current }
    }
    if (d.content.kind === "sheets") {
      const current = sheetsRef.current
      const norm = (rows: (string | number | null)[][]) =>
        rows.map((r) => r.map((c) => (c === null ? "" : c)))
      if (isCsv(d.meta.mimeType)) {
        const ws = XLSX.utils.aoa_to_sheet(norm(current[0]?.rows ?? []))
        return { kind: "text", content: XLSX.utils.sheet_to_csv(ws) }
      }
      const wb = XLSX.utils.book_new()
      current.forEach((s, i) => {
        const ws = XLSX.utils.aoa_to_sheet(norm(s.rows))
        XLSX.utils.book_append_sheet(wb, ws, (s.name || `Sheet${i + 1}`).slice(0, 31))
      })
      return { kind: "xlsx", base64: XLSX.write(wb, { type: "base64", bookType: "xlsx" }) }
    }
    return null
  }, [])

  const doSave = useCallback(async () => {
    if (conflictRef.current || expiredRef.current) return
    const payload = buildPayload()
    if (!payload) return
    dirtyRef.current = false
    savingRef.current = true
    setStatus("saving")
    const p = (async () => {
      try {
        const res = await fetch(`/api/documents/${docId}/save`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, baseUpdatedAt: baseUpdatedAtRef.current }),
        })
        if (res.status === 401) {
          // Do NOT set dirtyRef: that is what re-armed the debounce and made
          // this a loop. The text is still in `textValue` / `sheets`, and it
          // stays there until the reader signs back in.
          expiredRef.current = true
          setStatus("session-expired")
          return
        }
        if (res.status === 409) {
          conflictRef.current = true
          setStatus("conflict")
          return
        }
        if (!res.ok) {
          dirtyRef.current = true
          setStatus("error")
          return
        }
        const json = (await res.json()) as { updatedAt: string }
        baseUpdatedAtRef.current = json.updatedAt
        setStatus("saved")
      } catch {
        dirtyRef.current = true
        setStatus("error")
      } finally {
        savingRef.current = false
        savePromiseRef.current = null
      }
    })()
    savePromiseRef.current = p
    await p
  }, [buildPayload, docId])

  const scheduleSave = useCallback(() => {
    if (conflictRef.current || expiredRef.current) return
    dirtyRef.current = true
    setStatus("dirty")
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      void doSave()
    }, AUTOSAVE_MS)
  }, [doSave])

  const flush = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    if (dirtyRef.current) await doSave()
    else if (savePromiseRef.current) await savePromiseRef.current
  }, [doSave])

  const ensureFresh = useCallback(async () => {
    if (Date.now() - fetchedAtRef.current > STALE_MS) await load({ keepMode: true })
  }, [load])

  const requestClose = useCallback(async () => {
    if (closingRef.current) return
    closingRef.current = true
    try {
      if (dirtyRef.current || savingRef.current || debounceRef.current) {
        setStatus("saving")
        await flush()
      }
    } finally {
      onOpenChange(false)
    }
  }, [flush, onOpenChange])

  const toggleMode = useCallback(async () => {
    if (mode === "edit") {
      await flush()
      setMode("view")
    } else {
      await ensureFresh()
      setMode("edit")
    }
  }, [mode, flush, ensureFresh])

  const handleMediaError = useCallback(() => {
    if (Date.now() - fetchedAtRef.current > STALE_MS) void load({ keepMode: true })
  }, [load])

  const onTextChange = (v: string) => {
    textRef.current = v
    setTextValue(v)
    scheduleSave()
  }

  const onSheetsChange = (next: SheetData[]) => {
    sheetsRef.current = next
    setSheets(next)
    scheduleSave()
  }

  const meta = data?.meta
  const metaLine = [
    meta?.orgName ?? initialMeta.orgName,
    shortType(meta?.mimeType ?? initialMeta.mimeType),
    formatBytes(meta?.sizeBytes ?? initialMeta.sizeBytes),
    `Updated ${new Date(meta?.updatedAt ?? initialMeta.updatedAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`,
  ].join(" · ")

  const editableText = !!data?.editable && data.content.kind === "text"
  const editableSheets = !!data?.editable && data.content.kind === "sheets"

  return (
    <Overlay
      isOpen={open}
      onOpenChange={(o) => {
        if (!o) void requestClose()
      }}
      size="xl"
      title={meta?.title ?? initialMeta.title}
      description={metaLine}
    >
      <div data-testid="doc-viewer-overlay">
        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-border pb-3">
          <form action={downloadAction}>
            <input type="hidden" name="documentId" value={docId} />
            <button type="submit" data-testid="doc-viewer-download" className={toolbarBtn}>
              <Download size={13} /> Download
            </button>
          </form>

          {data?.editable && (
            <button
              type="button"
              data-testid="doc-edit-toggle"
              onClick={() => void toggleMode()}
              className={toolbarBtn}
            >
              {mode === "edit" ? (
                <>
                  <Eye size={13} /> View
                </>
              ) : (
                <>
                  <PenSquare size={13} /> Edit
                </>
              )}
            </button>
          )}

          {data?.editable && <SaveStatusPill status={status} onRetry={() => void doSave()} />}

          {data?.canSummarize && (
            <Link
              href={`/orgs/${slug}/documents/${docId}/summary`}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-[--primary] no-underline hover:bg-base"
            >
              <Sparkles size={13} /> Summarize
            </Link>
          )}
        </div>

        {status === "session-expired" && (
          <div className="mb-4">
            {/* The role and the politeness come from STATE_SEMANTICS, not from
                here — `permission-denied` is role="alert" / assertive, which is
                right: the reader is about to keep typing into a draft that is
                no longer being saved. */}
            <StateSurface
              state="permission-denied"
              title="Your session expired while you were editing"
              detail={
                <>
                  Your changes are still on screen and have not been lost, but nothing is being
                  saved. Sign in again in another tab, then press Save — this document is still
                  open at{" "}
                  <Link
                    href={`/signin?next=${encodeURIComponent(`/orgs/${slug}/documents`)}`}
                    target="_blank"
                    className="text-text-link underline"
                  >
                    the sign-in page
                  </Link>
                  .
                </>
              }
            />
          </div>
        )}

        {status === "conflict" && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-[--error] bg-base px-3 py-2 text-xs text-text-1">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-[--error]" />
            <span>Someone else saved a newer version — reopen to continue.</span>
          </div>
        )}

        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-3">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : error ? (
          <div className="py-10 text-center">
            <p className="text-sm text-text-2">{error}</p>
          </div>
        ) : data ? (
          editableText ? (
            mode === "edit" ? (
              <TextEditor value={textValue} onChange={onTextChange} />
            ) : (
              <DocContentView content={{ kind: "text", text: textValue }} title={data.meta.title} />
            )
          ) : editableSheets ? (
            mode === "edit" ? (
              <SheetEditor sheets={sheets} onChange={onSheetsChange} />
            ) : (
              <DocContentView
                content={{ kind: "sheets", sheets }}
                title={data.meta.title}
              />
            )
          ) : (
            <DocContentView
              content={data.content}
              title={data.meta.title}
              onMediaError={handleMediaError}
            />
          )
        ) : null}
      </div>
    </Overlay>
  )
}

function SaveStatusPill({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  return (
    <span
      data-testid="doc-save-status"
      className="inline-flex items-center gap-1.5 text-xs text-text-3"
      aria-live="polite"
    >
      {status === "saving" && <Loader2 size={13} className="animate-spin" />}
      {status === "saved" && <CheckCircle size={13} className="text-[--primary]" />}
      {(status === "error" || status === "conflict" || status === "session-expired") && (
        <AlertCircle size={13} className="text-[--error]" />
      )}
      {status === "error" ? (
        <button type="button" onClick={onRetry} className="underline">
          Save failed — retry
        </button>
      ) : (
        <span>
          {status === "dirty"
            ? "Unsaved changes"
            : status === "saving"
              ? "Saving…"
              : status === "saved"
                ? "Saved just now"
                : status === "conflict"
                  ? "Newer version exists"
                  : status === "session-expired"
                    ? "Not saving — session expired"
                    : ""}
        </span>
      )}
    </span>
  )
}

function TextEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const lines = value.length === 0 ? 0 : value.split("\n").length
  return (
    <div>
      <textarea
        data-testid="doc-editor-text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="h-[60vh] w-full resize-y rounded-md border border-border bg-base p-4 font-mono text-xs text-text-1 outline-none focus:border-[--border-focus]"
      />
      <p className="mt-1 text-xs text-text-3">
        {lines} line{lines === 1 ? "" : "s"} · edits autosave
      </p>
    </div>
  )
}

function SheetEditor({
  sheets,
  onChange,
}: {
  sheets: SheetData[]
  onChange: (next: SheetData[]) => void
}) {
  function updateCell(si: number, ri: number, ci: number, val: string) {
    onChange(
      sheets.map((s, i) =>
        i !== si
          ? s
          : {
              ...s,
              rows: s.rows.map((r, j) =>
                j !== ri ? r : r.map((c, k) => (k !== ci ? c : val))
              ),
            }
      )
    )
  }

  function addRow(si: number) {
    const cols = Math.max(1, ...sheets[si].rows.map((r) => r.length))
    onChange(
      sheets.map((s, i) =>
        i !== si
          ? s
          : { ...s, rows: [...s.rows, Array.from({ length: cols }, () => "")] }
      )
    )
  }

  return (
    <div className="space-y-6">
      {sheets.map((sheet, si) => (
        <div key={sheet.name || si}>
          {sheets.length > 1 && (
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-3">
              {sheet.name}
            </p>
          )}
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs text-text-1">
              <tbody>
                {sheet.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="border border-border p-0">
                        <input
                          value={cell === null ? "" : String(cell)}
                          onChange={(e) => updateCell(si, ri, ci, e.target.value)}
                          className={`w-full min-w-[6rem] bg-transparent px-2 py-1 tabular-nums outline-none focus:bg-base ${
                            ri === 0 ? "font-semibold" : ""
                          }`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            onClick={() => addRow(si)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-2 hover:bg-base"
          >
            <Plus size={13} /> Add row
          </button>
        </div>
      ))}
    </div>
  )
}
