"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

// useLayoutEffect warns during SSR; charts are client leaves that only matter
// after hydration, so fall back to useEffect on the server.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

/**
 * ResponsiveContainer pattern: measure the parent with a ResizeObserver and
 * re-render in real pixels, so a chart's SVG user units equal container pixels
 * (which makes tooltip/crosshair positioning exact) and the chart stays fluid.
 */
export function useMeasuredWidth<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useIsoLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w != null) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

/**
 * Flips true one frame after mount so CSS transitions run the 300ms grow/draw.
 * Because the animation is transition-based, the global reduced-motion rule in
 * globals.css collapses it to ~0ms automatically.
 */
export function useMounted() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return mounted
}

/**
 * Live polling for the dashboards. Runs `fetcher` immediately, then on an
 * interval and on window focus/visibility, exposing the latest value plus the
 * timestamp it arrived. Errors are swallowed (the next tick retries) so a blip
 * never blanks a live tile. `refresh()` forces an out-of-band update. The
 * interval pauses while the tab is hidden and fires once on return.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  opts?: { enabled?: boolean; initial?: T }
): { data: T | null; updatedAt: number | null; loading: boolean; refresh: () => void } {
  const enabled = opts?.enabled ?? true
  const [data, setData] = useState<T | null>(opts?.initial ?? null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const saved = useRef(fetcher)
  saved.current = fetcher

  const run = useCallback(async () => {
    setLoading(true)
    try {
      const d = await saved.current()
      setData(d)
      setUpdatedAt(Date.now())
    } catch {
      /* transient — next tick retries */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    let stop = false
    const tick = () => {
      if (!stop && document.visibilityState !== "hidden") run()
    }
    run()
    const id = setInterval(tick, intervalMs)
    const onVis = () => {
      if (document.visibilityState === "visible") run()
    }
    window.addEventListener("focus", onVis)
    document.addEventListener("visibilitychange", onVis)
    return () => {
      stop = true
      clearInterval(id)
      window.removeEventListener("focus", onVis)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [enabled, intervalMs, run])

  return { data, updatedAt, loading, refresh: run }
}

/** "just now" / "12s ago" / "3m ago" from a ms timestamp, recomputed each second. */
export function useTimeAgo(ts: number | null): string {
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  if (ts == null) return "—"
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 3) return "just now"
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}
