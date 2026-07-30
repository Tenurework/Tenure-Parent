"use client"

import { useAI } from "@/components/ai/AIProvider"

/**
 * The scrolling content region. When the Tenure AI panel opens on a wide
 * screen it squeezes the content in (adds right padding) instead of covering
 * it, so you can read the page and the assistant side by side. On narrow
 * screens the panel overlays instead (there isn't room to squeeze).
 */
export function MainRegion({ children }: { children: React.ReactNode }) {
  const { open } = useAI()
  return (
    <main
      className={`min-h-screen bg-base transition-[padding] duration-200 ease-out ${open ? "lg:pr-[26rem]" : ""}`}
      style={{
        paddingTop: "var(--shell-height)",
        paddingLeft: "var(--sidenav-current-width)",
        paddingBottom: "var(--footer-height)",
      }}
    >
      <div className="page-shell py-5 sm:py-6">{children}</div>
    </main>
  )
}
