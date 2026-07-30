"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { CapabilityId } from "@/lib/admin/capabilities"
import {
  LayoutGrid,
  Building2,
  Users,
  ScrollText,
  CheckCircle,
  SlidersHorizontal,
  type IconType,
} from "@/components/ui/icons"

/**
 * Each tab carries the capabilities its page requires. A tab is shown only if
 * the viewer holds at least one of them — matching the guard on the page
 * itself, which calls notFound() otherwise.
 *
 * Without this the console linked to its own 404s: every tab rendered for every
 * admin, so OSE_STAFF clicking "Approvals" and OSE_ADVISOR clicking "Approvals"
 * or "Overrides" landed on a not-found page inside the console they had just
 * been admitted to. Overview and Clubs have no capability gate — Clubs renders
 * read-only for roles that cannot create or archive.
 */
const TABS: {
  href: string
  label: string
  icon: IconType
  exact?: boolean
  /** Any one of these grants the tab. Empty means ungated. */
  needs: CapabilityId[]
}[] = [
  { href: "/admin", label: "Overview", icon: LayoutGrid, exact: true, needs: [] },
  { href: "/admin/clubs", label: "Clubs", icon: Building2, needs: [] },
  { href: "/admin/approvals", label: "Approvals", icon: CheckCircle, needs: ["approval.override"] },
  {
    href: "/admin/overrides",
    label: "Overrides",
    icon: SlidersHorizontal,
    needs: ["event.override", "content.override"],
  },
  {
    href: "/admin/people",
    label: "Directory & Access",
    icon: Users,
    needs: ["institution.grantRole", "directory.manage", "institution.transferRole"],
  },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText, needs: ["audit.view"] },
]

export function AdminNav({ capabilities }: { capabilities: CapabilityId[] }) {
  const pathname = usePathname()
  const held = new Set(capabilities)
  const visible = TABS.filter((t) => t.needs.length === 0 || t.needs.some((c) => held.has(c)))
  return (
    <nav className="flex flex-wrap gap-1 border-b border-border" aria-label="Admin sections">
      {visible.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href)
        const Icon = t.icon
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`relative -mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-[15px] font-medium no-underline transition-colors ${
              active
                ? "border-[--accent] text-[--accent]"
                : "border-transparent text-text-2 hover:text-text-1"
            }`}
          >
            <Icon size={17} className={active ? "text-[--accent]" : "text-text-3"} />
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
