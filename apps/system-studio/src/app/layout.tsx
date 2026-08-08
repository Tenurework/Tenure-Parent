import type { Metadata } from "next"

import "./globals.css"
import { Nav } from "@/components/Nav"
import { PreferencesMenu } from "@/components/PreferencesMenu"
import { OfflineBanner } from "@/components/OfflineBanner"
import { Launcher } from "@/components/Launcher"
import { NO_FLASH_SCRIPT } from "@/lib/preferences"

export const metadata: Metadata = {
  title: "Tenure System Studio",
  description: "Internal. Configure and inspect Tenure organization systems.",
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
      STUDIO-030-007. `dir` is written explicitly rather than left to the
      browser's default, because it is the attribute every logical property in
      globals.css resolves against and an attribute that is absent is an
      attribute the pre-paint script has nothing to flip. The script below
      replaces it with `rtl` when the stored preference says so, before the
      first paint — a direction changed after hydration reflows the whole page
      under the reader.
    */
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body>
        {/*
          First child of <body>, not inside <head>: the App Router does not
          render an arbitrary <script> placed in <head> — it was silently
          dropped from the served HTML, which is a flash nobody would have
          traced back to here. Parsed and executed before any content below it,
          so the attribute is set before the first paint either way.
        */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
        <header className="masthead">
          <span className="mark">Tenure</span>
          <span className="title">System Studio</span>
          <PreferencesMenu />
          <span className="internal">Internal</span>
        </header>
        <Nav />
        {/* GE-022-007. In the layout so Ctrl/Cmd-K reaches it from every route. */}
        <Launcher />
        <main>
          <OfflineBanner />
          {children}
        </main>
      </body>
    </html>
  )
}
