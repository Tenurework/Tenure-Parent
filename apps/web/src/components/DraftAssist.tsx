"use client"

import { useState } from "react"
import { Sparkles, Loader2 } from "@/components/ui/icons"

/**
 * Tenure AI drafting assist: describe what you need, the draft lands in the
 * target textarea (matched by name within the same form).
 */
export function DraftAssist({
  kind,
  targetName,
}: {
  kind: "message" | "memory" | "event"
  targetName: string
}) {
  const [instruction, setInstruction] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function draft(e: React.MouseEvent<HTMLButtonElement>) {
    if (!instruction.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, instruction }),
      })
      if (!res.ok) {
        setError(res.status === 503 ? "Tenure AI is not enabled" : "Drafting failed — try again")
        return
      }
      const { text } = (await res.json()) as { text: string }
      const form = (e.target as HTMLElement).closest("form")
      const target = form?.querySelector<HTMLTextAreaElement>(`textarea[name="${targetName}"]`)
      if (target) {
        target.value = text
        target.dispatchEvent(new Event("input", { bubbles: true }))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded border border-dashed border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <Sparkles size={13} style={{ color: "var(--primary)" }} className="shrink-0" />
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Tenure AI — describe it and I'll draft it…"
          aria-label="Tenure AI drafting instruction"
          className="flex-1 bg-transparent outline-none text-xs text-text-1 placeholder:text-text-3"
        />
        <button
          type="button"
          onClick={draft}
          disabled={busy || !instruction.trim()}
          className="inline-flex items-center gap-1 text-xs font-medium text-[--primary] disabled:opacity-40"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : null}
          Draft
        </button>
      </div>
      {error && <p className="mt-1 text-xs" style={{ color: "var(--error)" }}>{error}</p>}
    </div>
  )
}
