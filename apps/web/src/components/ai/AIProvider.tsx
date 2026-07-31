"use client"

import { createContext, useCallback, useContext, useState, type ReactNode } from "react"

interface AIContextValue {
  open: boolean
  openPanel: () => void
  closePanel: () => void
  toggle: () => void
}

const AIContext = createContext<AIContextValue | null>(null)

/** Shares the Tenure AI panel's open state across the shell (header, side nav). */
export function AIProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const openPanel = useCallback(() => setOpen(true), [])
  const closePanel = useCallback(() => setOpen(false), [])
  const toggle = useCallback(() => setOpen((o) => !o), [])
  return (
    <AIContext.Provider value={{ open, openPanel, closePanel, toggle }}>
      {children}
    </AIContext.Provider>
  )
}

export function useAI(): AIContextValue {
  const ctx = useContext(AIContext)
  if (!ctx) {
    // Safe no-op default so the shell renders outside a provider (e.g. tests).
    return { open: false, openPanel: () => {}, closePanel: () => {}, toggle: () => {} }
  }
  return ctx
}
