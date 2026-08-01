"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

/**
 * One navigation, in the layout.
 *
 * It used to be re-declared in every page, which meant each page decided which
 * siblings existed — `/tenants` knew about `/platform`, `/platform` knew about
 * `/`, and a new page was reachable only from wherever someone remembered to
 * add a link. Declared once here, every page gets the same set and the active
 * entry is derived from the path rather than passed in and occasionally wrong.
 *
 * Order is the operator's workflow, not the alphabet: find or create a tenant,
 * inspect the systems that exist, then check the platform underneath them.
 */
const ENTRIES = [
  { href: "/tenants", label: "Tenants", hint: "compose, provision and operate" },
  { href: "/", label: "Systems", hint: "what each configured system currently is" },
  { href: "/platform", label: "Platform", hint: "the engine's own state" },
] as const

export function Nav() {
  const pathname = usePathname() ?? "/"

  // `/` must match only itself; every other entry matches its subtree, so a
  // tenant detail page keeps Tenants lit rather than dropping the highlight.
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)

  // The sign-in page has no sections to navigate between.
  if (pathname.startsWith("/signin")) return null

  return (
    <nav className="tabs" aria-label="Console sections">
      {ENTRIES.map((e) =>
        isActive(e.href) ? (
          <span key={e.href} className="here" aria-current="page" title={e.hint}>
            {e.label}
          </span>
        ) : (
          <Link key={e.href} href={e.href} title={e.hint}>
            {e.label}
          </Link>
        ),
      )}
    </nav>
  )
}
