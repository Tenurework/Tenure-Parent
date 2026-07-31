"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const TABS = [
  { segment: "members", label: "Members" },
  { segment: "finance", label: "Finance" },
  { segment: "documents", label: "Documents" },
  { segment: "memory", label: "Memory" },
  { segment: "handoff", label: "Handoff" },
  { segment: "impact", label: "Impact" },
]

export function OrgTabs({ slug }: { slug: string }) {
  const pathname = usePathname()
  return (
    <nav className="flex gap-1 border-b border-border mb-6" aria-label="Club sections">
      {TABS.map((t) => {
        const href = `/orgs/${slug}/${t.segment}`
        const active = pathname.startsWith(href)
        return (
          <Link
            key={t.segment}
            href={href}
            className={`px-4 h-9 flex items-center text-sm no-underline border-b-2 -mb-px transition-colors ${
              active
                ? "border-[--primary] text-[--primary] font-medium"
                : "border-transparent text-text-2 hover:text-text-1"
            }`}
            aria-current={active ? "page" : undefined}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
