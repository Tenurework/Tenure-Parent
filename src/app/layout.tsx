import type { Metadata, Viewport } from "next"
import { Inter, Plus_Jakarta_Sans } from "next/font/google"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

// Display face for headings and brand moments — a modern, humanist geometric
// sans that pairs with Inter's neutral UI text. Self-hosted at build by
// next/font, so no runtime network request and no CSP concern.
const displayFace = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-display-face",
  display: "swap",
  weight: ["500", "600", "700", "800"],
})

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

// Applied before hydration so the page never flashes the wrong theme or the
// wrong side-nav width. Reads localStorage "tenure-theme" (light/dark/system)
// and "tenure-nav" (collapsed/expanded) and stamps the matching classes on
// <html> before first paint.
const themeInit = `(function(){try{var t=localStorage.getItem("tenure-theme")||"system";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);var n=localStorage.getItem("tenure-nav");document.documentElement.classList.toggle("nav-collapsed",n==="collapsed")}catch(e){}})()`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${displayFace.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
