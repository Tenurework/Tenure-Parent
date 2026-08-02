import type { Metadata } from "next"

import "./globals.css"
import { Nav } from "@/components/Nav"
import { PreferencesMenu } from "@/components/PreferencesMenu"
import { OfflineBanner } from "@/components/OfflineBanner"
import { NO_FLASH_SCRIPT } from "@/lib/preferences"

export const metadata: Metadata = {
  title: "Tenure System Studio",
  description: "Internal. Configure and inspect Tenure organization systems.",
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
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
        <main>
          <OfflineBanner />
          {children}
        </main>
      </body>
    </html>
  )
}
