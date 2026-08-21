import type { Metadata, Viewport } from "next"
import { THEME_BOOT_SCRIPT } from "@/lib/a11y/theme-resolution"
import { documentLocalization } from "@/lib/tenancy/locale-cookie"
import "./globals.css"

export const metadata: Metadata = {
  title: {
    template: "%s — Tenure",
    default: "Tenure",
  },
  description: "Institutional knowledge that survives every leadership transition.",
  applicationName: "Tenure",
  appleWebApp: { capable: true, title: "Tenure", statusBarStyle: "default" },
}

// The browser chrome follows the app's own surfaces rather than defaulting to
// white — matched to --bg-base in each theme so there is no bright seam above
// the header on mobile.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f0efe9" },
    { media: "(prefers-color-scheme: dark)", color: "#08090a" },
  ],
}

// Applied before hydration so the page never flashes the wrong theme, the wrong
// side-nav width or the wrong control heights. Reads localStorage "tenure-theme"
// (light/dark/system/scheduled), "tenure-theme-schedule" ("HH:MM-HH:MM"),
// "tenure-nav" (collapsed/expanded) and "tenure-density" (comfortable/compact)
// and stamps the matching class / attribute on <html> before first paint.
//
// GE-143-013 — the script itself now lives in `@/lib/a11y/theme-resolution`
// beside `resolveTheme`, the function the click path and the OS-change listener
// call. It was written out here as a literal, which made it the first of three
// copies of the same boolean; `theme-resolution.test.ts` evaluates the string
// against a fake document over the full input matrix and fails if it and
// `resolveTheme` ever disagree.
//
// Density is an ATTRIBUTE (`data-density`), matching
// `:root[data-density="compact"]` in globals.css, and it is always written —
// "comfortable" included — so the DOM states which density is in force rather
// than leaving the default implicit. It has to be here rather than in
// DensitySwitcher's effect: the tokens it selects are control and row HEIGHTS,
// so resolving them after hydration would reflow the entire frame one paint in.
// The narrowing is the same one DensitySwitcher.readDensity applies — anything
// that is not exactly "compact" is comfortable — so a corrupted localStorage
// value cannot produce a third, undefined density.
const themeInit = THEME_BOOT_SCRIPT

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // The tenant's language and direction, resolved before first paint. Correcting
  // them afterwards would flash the whole page the wrong way round for a
  // right-to-left reader, and `<html>` cannot be set from a nested layout.
  const { locale: lang, direction: dir } = await documentLocalization()
  return (
    <html lang={lang} dir={dir} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
