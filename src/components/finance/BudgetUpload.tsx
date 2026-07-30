"use client"

import { useRef, useState, useTransition } from "react"
import * as XLSX from "xlsx"
// FileSpreadsheet/Check have no direct alias in the icon source; using the
// closest existing FileText/CheckCircle (see notes).
import { Upload, FileText as FileSpreadsheet, AlertCircle, CheckCircle as Check } from "@/components/ui/icons"
import { Card, CardHeader } from "@/components/ui/Card"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { formatCents, parseBudgetSheet, type ImportResult } from "@/lib/finance"
import { importBudget } from "@/app/(app)/orgs/[slug]/finance/actions"

/**
 * Upload an Excel/CSV budget tracker and turn it into the dashboard.
 *
 * Parsing happens in the browser (the xlsx dependency already ships for the
 * document viewer), so we never store the raw file — only the clean rows are
 * sent to the server, which re-validates and owns the write.
 */
export function BudgetUpload({ slug }: { slug: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [pending, startTransition] = useTransition()

  async function handleFile(file: File) {
    setError(null)
    setDone(false)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: "array" })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      if (!sheet) {
        setError("That file has no readable sheet.")
        return
      }
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" })
      const result = parseBudgetSheet(rows)
      if (result.rows.length === 0) {
        setError(
          "Couldn't find any budget rows. The sheet needs a category column and at least one of a budget or actual column."
        )
        setPreview(null)
        return
      }
      setFileName(file.name)
      setPreview(result)
    } catch {
      setError("Couldn't read that file. Supported: .xlsx, .xls, .csv")
    }
  }

  function doImport(mode: "replace" | "merge") {
    if (!preview) return
    startTransition(async () => {
      try {
        await importBudget(slug, preview.rows, mode)
        setDone(true)
        setPreview(null)
        setFileName(null)
        if (inputRef.current) inputRef.current.value = ""
      } catch (e) {
        setError(e instanceof Error ? e.message : "Import failed")
      } finally {
        setConfirmReplace(false)
      }
    })
  }

  const totalBudget = preview?.rows.reduce((n, r) => n + r.budgetedCents, 0) ?? 0
  const totalActual = preview?.rows.reduce((n, r) => n + r.actualCents, 0) ?? 0

  return (
    <Card>
      <CardHeader
        title="Upload a spreadsheet"
        subtitle="Excel or CSV with a category column and budget / actual columns."
      />

      <p className="mb-3 text-xs text-text-2">
        Starting fresh?{" "}
        <a
          href="/api/templates/budget"
          download
          className="font-medium text-[--text-link] hover:underline"
        >
          Download the standard club budget template
        </a>{" "}
        — fill it in and upload it here.
      </p>

      <label
        className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center hover:border-[--primary]"
      >
        <Upload size={20} className="text-text-3" />
        <span className="text-sm text-text-2">
          Click to choose an .xlsx, .xls or .csv file
        </span>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
          }}
        />
      </label>

      {error && (
        <p className="mt-3 flex items-start gap-1.5 rounded bg-[--warning-light] px-3 py-2 text-xs text-text-1">
          <AlertCircle size={13} className="mt-0.5 shrink-0 text-[--warning]" />
          {error}
        </p>
      )}

      {done && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-[--primary]">
          <Check size={14} /> Imported — the dashboard above is updated.
        </p>
      )}

      {preview && (
        <div className="mt-4 rounded-lg border border-border p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-text-1">
            <FileSpreadsheet size={14} className="text-text-3" /> {fileName}
          </p>

          <p className="mt-2 text-xs text-text-2">
            Read {preview.rows.length} categor{preview.rows.length === 1 ? "y" : "ies"}
            {preview.skipped > 0 && `, skipped ${preview.skipped} row(s)`}. Columns:{" "}
            <span className="text-text-1">{preview.mapping.category ?? "col 1"}</span> →
            category,{" "}
            <span className="text-text-1">{preview.mapping.budgeted ?? "none"}</span> → budget,{" "}
            <span className="text-text-1">{preview.mapping.actual ?? "none"}</span> → actual.
          </p>

          {preview.warnings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {preview.warnings.map((w) => (
                <li key={w} className="flex items-start gap-1.5 text-xs text-[--warning]">
                  <AlertCircle size={12} className="mt-0.5 shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 max-h-40 overflow-y-auto rounded border border-border">
            <table className="w-full text-xs tabular">
              <tbody>
                {preview.rows.slice(0, 50).map((r) => (
                  <tr key={r.category} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5 text-text-1">{r.category}</td>
                    <td className="px-3 py-1.5 text-right text-text-2">
                      {formatCents(r.budgetedCents)}
                    </td>
                    <td className="px-3 py-1.5 text-right text-text-2">
                      {formatCents(r.actualCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-xs text-text-3">
            Totals: {formatCents(totalBudget)} budgeted · {formatCents(totalActual)} spent
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setConfirmReplace(true)}
              disabled={pending}
              className="rounded bg-[--primary] px-3 py-1.5 text-xs font-medium text-[--primary-text] hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Importing…" : "Replace imported lines"}
            </button>
            <button
              onClick={() => doImport("merge")}
              disabled={pending}
              className="rounded border border-border px-3 py-1.5 text-xs text-text-2 hover:bg-base disabled:opacity-50"
            >
              Merge into existing
            </button>
            <button
              onClick={() => {
                setPreview(null)
                setFileName(null)
              }}
              className="rounded px-3 py-1.5 text-xs text-text-3 hover:text-text-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmReplace}
        onOpenChange={setConfirmReplace}
        title="Replace all imported budget lines?"
        description={`This deletes the club's previously imported budget lines for the current year and replaces them with the ${
          preview?.rows.length ?? 0
        } row${preview?.rows.length === 1 ? "" : "s"} from this file. Lines you added by hand are kept, but replaced imported data can't be recovered.`}
        confirmLabel="Replace lines"
        variant="danger"
        busy={pending}
        onConfirm={() => doImport("replace")}
      />
    </Card>
  )
}
