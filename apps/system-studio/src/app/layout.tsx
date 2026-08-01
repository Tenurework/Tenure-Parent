import type { Metadata } from "next"

import "./globals.css"
import { Nav } from "@/components/Nav"

export const metadata: Metadata = {
  title: "Tenure System Studio",
  description: "Internal. Configure and inspect Tenure organization systems.",
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="masthead">
          <span className="mark">Tenure</span>
          <span className="title">System Studio</span>
          <span className="internal">Internal</span>
        </header>
        <Nav />
        <main>{children}</main>
      </body>
    </html>
  )
}
