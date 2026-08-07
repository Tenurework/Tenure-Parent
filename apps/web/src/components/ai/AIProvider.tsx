"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { usePathname } from "next/navigation"

/**
 * TTES-030-003 — what Relay is allowed to be asked *about*.
 *
 * `kind`/`id` are what the request carries; `label` is what the panel shows.
 * A record page declares one by mounting `AIScopeAnchor`; every other route
 * falls back to the pathname, so "asking from the calendar" is still a
 * narrower thing than "asking from nowhere".
 */
export interface AIScope {
  /** `record` when a specific object is on screen, `route` otherwise. */
  kind: "record" | "route"
  /** The record's id, when there is one. Sent to the route as a ranking bias. */
  id: string | null
  /** Human label for the visible scope indicator. */
  label: string
}

export interface AIScopeAnchorInput {
  kind: "record"
  id: string
  label: string
}

interface AIContextValue {
  open: boolean
  openPanel: () => void
  closePanel: () => void
  toggle: () => void
  /**
   * The scope the panel must display and send. Never optional: a panel that can
   * render without knowing its scope is a panel that ships without one.
   */
  scope: AIScope
  /** Used by AIScopeAnchor. Not for general call sites. */
  setRecordScope: (scope: AIScopeAnchorInput | null) => void
}

const AIContext = createContext<AIContextValue | null>(null)

/**
 * Pathname → a scope label, for every route that is not a specific record.
 *
 * Deliberately coarse. The point is not to name the page precisely; it is that
 * the panel never claims a scope wider than the one the request actually uses.
 */
function routeScope(pathname: string | null): AIScope {
  const segments = (pathname ?? "/").split("/").filter(Boolean)
  if (segments.length === 0) return { kind: "route", id: null, label: "Everything you can see" }
  const first = segments[0]
  const LABELS: Record<string, string> = {
    dashboard: "Everything you can see",
    orgs: "Your clubs",
    calendar: "The calendar",
    approvals: "Approvals",
    messages: "Messages",
    resources: "Board resources",
    reports: "Reports",
    admin: "The administration console",
    settings: "Your settings",
    search: "Everything you can see",
    feed: "Your feed",
  }
  return { kind: "route", id: null, label: LABELS[first] ?? "Everything you can see" }
}

/** Shares the Tenure AI panel's open state and its scope across the shell. */
export function AIProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [record, setRecord] = useState<AIScopeAnchorInput | null>(null)
  const pathname = usePathname()

  const openPanel = useCallback(() => setOpen(true), [])
  const closePanel = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => setOpen((o) => !o), [])
  const setRecordScope = useCallback((next: AIScopeAnchorInput | null) => setRecord(next), [])

  const scope: AIScope = useMemo(
    () => (record ? { kind: "record", id: record.id, label: record.label } : routeScope(pathname)),
    [record, pathname],
  )

  const value = useMemo(
    () => ({ open, openPanel, closePanel, toggle, scope, setRecordScope }),
    [open, openPanel, closePanel, toggle, scope, setRecordScope],
  )

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>
}

export function useAI(): AIContextValue {
  const ctx = useContext(AIContext)
  if (!ctx) {
    // Safe no-op default so the shell renders outside a provider (e.g. tests).
    return {
      open: false,
      openPanel: () => {},
      closePanel: () => {},
      toggle: () => {},
      scope: { kind: "route", id: null, label: "Everything you can see" },
      setRecordScope: () => {},
    }
  }
  return ctx
}

/**
 * Declares the record a page is showing, so "ask from this record" has a
 * mechanism rather than a claim. Renders nothing.
 *
 * Mounted by a record page (see `src/app/(app)/orgs/[slug]/layout` callers).
 * Clears on unmount, so navigating away narrows the scope back to the route
 * rather than leaving the panel naming a club the reader has left.
 */
export function AIScopeAnchor({ id, label }: { id: string; label: string }) {
  const { setRecordScope } = useAI()
  useEffect(() => {
    setRecordScope({ kind: "record", id, label })
    return () => setRecordScope(null)
  }, [id, label, setRecordScope])
  return null
}
