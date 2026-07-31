"use client"

import { useEffect, useRef, useState } from "react"
import { usePolling, useTimeAgo } from "./hooks"
import { formatNumber } from "./format"

export type LiveStatItem = { key: string; label: string; tone?: "default" | "warn" }

/**
 * A "Live now" strip: polls a JSON endpoint returning a flat record of numbers
 * and renders one tile per item, flashing a tile whose value changed and
 * showing how fresh the data is. This is the real-time surface — the numbers
 * move without a page reload. Server-rendered `initial` values mean the tiles
 * are correct on first paint, before the first poll returns.
 */
export function LiveStats({
  endpoint,
  items,
  initial,
  intervalMs = 15000,
}: {
  endpoint: string
  items: LiveStatItem[]
  initial?: Record<string, number>
  intervalMs?: number
}) {
  const { data, updatedAt } = usePolling<Record<string, number>>(
    async () => {
      const res = await fetch(endpoint, { cache: "no-store" })
      if (!res.ok) throw new Error(`pulse ${res.status}`)
      return (await res.json()) as Record<string, number>
    },
    intervalMs,
    { initial }
  )
  const values = data ?? initial ?? {}
  const ago = useTimeAgo(updatedAt)

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="micro-label text-text-3">Live now</span>
        <span className="inline-flex items-center gap-1.5 text-meta text-text-3">
          <span
            className="live-dot inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--primary)" }}
            aria-hidden
          />
          Updated {ago}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((it) => (
          <LiveTile key={it.key} label={it.label} value={values[it.key] ?? 0} tone={it.tone} />
        ))}
      </div>
    </div>
  )
}

function LiveTile({ label, value, tone }: { label: string; value: number; tone?: "default" | "warn" }) {
  const prev = useRef(value)
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value
      setFlash(true)
      const id = setTimeout(() => setFlash(false), 800)
      return () => clearTimeout(id)
    }
  }, [value])

  const accent = tone === "warn" && value > 0 ? "var(--warning)" : "var(--primary)"
  return (
    <div
      className="rounded-lg border bg-surface px-3.5 py-2.5 transition-colors duration-300"
      style={{ borderColor: flash ? accent : "var(--border)" }}
    >
      <div className="text-[19px] font-semibold tabular-nums text-text-1">{formatNumber(value)}</div>
      <div className="text-meta text-text-2">{label}</div>
    </div>
  )
}
