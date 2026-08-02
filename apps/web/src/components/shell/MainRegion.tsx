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
      // The skip link's target (WCAG 2.4.1). tabIndex={-1} so the browser will
      // actually move focus here — without it the fragment scrolls the page but
      // leaves focus on the link, and the next Tab goes back into the nav the
      // user just skipped.
      id="main"
      tabIndex={-1}
      className={`min-h-screen bg-base outline-none transition-[padding] duration-200 ease-out ${open ? "lg:pr-[26rem]" : ""}`}
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
