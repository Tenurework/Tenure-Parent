"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Button as AriaButton,
  Focusable,
  Tooltip,
  TooltipTrigger,
} from "react-aria-components"
import {
  LayoutDashboard,
  CheckCircle,
  Calendar,
  MessageSquare,
  Newspaper,
  Settings,
  Building2,
  BarChart3,
  BookOpen,
  ShieldCheck,
  CaretDoubleLeft,
  CaretDoubleRight,
  type IconType,
} from "@/components/ui/icons"
import { TenureAIMark } from "@/components/brand/TenureLogo"
import { useAI } from "@/components/ai/AIProvider"

interface NavItem {
  label: string
  href: string
  icon: IconType | typeof TenureAIMark
  ai?: boolean
}

interface NavSection {
  label?: string
  items: NavItem[]
}

function buildNav(showReports?: boolean, showAdmin?: boolean): NavSection[] {
  return [
    ...(showAdmin
      ? [
          {
            label: "Administration",
            items: [{ label: "Admin Console", href: "/admin", icon: ShieldCheck }],
          },
        ]
      : []),
    {
      label: "Overview",
      items: [
        { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
        ...(showReports ? [{ label: "Reports", href: "/reports", icon: BarChart3 }] : []),
      ],
    },
    {
      label: "Community",
      items: [
        { label: "Community Feed", href: "/feed", icon: Newspaper },
        { label: "All Clubs", href: "/orgs", icon: Building2 },
        { label: "Messages", href: "/messages", icon: MessageSquare },
      ],
    },
    {
      label: "Operations",
      items: [
        { label: "Approvals", href: "/approvals", icon: CheckCircle },
        { label: "Calendar", href: "/calendar", icon: Calendar },
      ],
    },
    {
      label: "Knowledge",
      items: [
        { label: "Resources", href: "/resources", icon: BookOpen },
        { label: "Tenure AI", href: "/search", icon: TenureAIMark, ai: true },
      ],
    },
  ]
}

interface SideNavProps {
  showReports?: boolean
  showAdmin?: boolean
}

const TOOLTIP_CLASS =
  "pop-panel z-50 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] font-medium text-text-1 shadow-lg outline-none"

const ITEM_BASE =
  "nav-item group relative flex h-[32px] items-center gap-2.5 rounded-[8px] px-2.5 text-[13.5px] no-underline transition-colors"

function ItemLink({
  item,
  active,
  collapsed,
}: {
  item: NavItem
  active: boolean
  collapsed: boolean
}) {
  const Icon = item.icon
  const { openPanel } = useAI()
  const className = `mx-2.5 ${ITEM_BASE} ${
    active
      ? "bg-[--shell-item-active] font-semibold text-text-1"
      : "text-text-2 hover:bg-[--shell-item-hover] hover:text-text-1"
  }`
  const inner = (
    <>
      {/* Rounded grove-green left rail indicator (active only) */}
      <span
        className={`pointer-events-none absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full ${
          active ? "bg-[--primary]" : "bg-transparent"
        }`}
        aria-hidden
      />
      <Icon size={18} className={`shrink-0 ${active ? "text-[--primary]" : "text-text-3"}`} />
      <span className="nav-label truncate">{item.label}</span>
    </>
  )

  // Tenure AI opens the right-side assistant panel instead of navigating.
  const trigger = item.ai ? (
    <button type="button" onClick={openPanel} className={`w-[calc(100%-1.25rem)] ${className}`}>
      {inner}
    </button>
  ) : (
    <Link href={item.href} className={className} aria-current={active ? "page" : undefined}>
      {inner}
    </Link>
  )

  return (
    <TooltipTrigger delay={250} closeDelay={0} isDisabled={!collapsed}>
      <Focusable>{trigger}</Focusable>
      <Tooltip placement="right" offset={12} className={TOOLTIP_CLASS}>
        {item.label}
      </Tooltip>
    </TooltipTrigger>
  )
}

function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const Icon = collapsed ? CaretDoubleRight : CaretDoubleLeft
  const label = collapsed ? "Expand navigation" : "Collapse navigation"
  return (
    <TooltipTrigger delay={250} closeDelay={0} isDisabled={!collapsed}>
      <AriaButton
        onPress={onToggle}
        aria-label={label}
        className={`mx-2.5 w-[calc(100%-1.25rem)] ${ITEM_BASE} text-text-2 outline-none data-[hovered]:bg-[--shell-item-hover] data-[hovered]:text-text-1 data-[focus-visible]:ring-2 data-[focus-visible]:ring-[--primary]`}
      >
        <Icon size={18} className="shrink-0 text-text-3" />
        <span className="nav-label truncate">Collapse</span>
      </AriaButton>
      <Tooltip placement="right" offset={12} className={TOOLTIP_CLASS}>
        {label}
      </Tooltip>
    </TooltipTrigger>
  )
}

export function SideNav({ showReports, showAdmin }: SideNavProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  // Sync React state with the class the pre-hydration script already applied
  // (the width + label visibility are CSS-driven, so this only enables the
  // tooltips and flips the toggle affordance — no layout flash).
  useEffect(() => {
    setCollapsed(document.documentElement.classList.contains("nav-collapsed"))
  }, [])

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem("tenure-nav", next ? "collapsed" : "expanded")
      } catch {
        /* private mode — falls back to the in-memory state */
      }
      document.documentElement.classList.toggle("nav-collapsed", next)
      return next
    })
  }, [])

  const sections = buildNav(showReports, showAdmin)
  const isActive = (href: string, label: string) =>
    label === "Tenure AI"
      ? false // Search entry owns the highlight for /search
      : pathname === href || (href !== "/dashboard" && pathname.startsWith(href))

  return (
    <nav
      className="fixed left-0 z-40 flex w-sidenav-current flex-col border-r border-border bg-[--shell-bg] transition-[width] duration-200 ease-out"
      style={{ top: "var(--shell-height)", bottom: "var(--footer-height)" }}
      aria-label="Primary navigation"
    >
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2.5">
        {sections.map((section, si) => (
          <div key={si} className="mb-3.5">
            {section.label && (
              <p className="micro-label nav-section-label mb-1 px-3.5">{section.label}</p>
            )}
            {section.items.map((item) => (
              <ItemLink
                key={item.label}
                item={item}
                active={isActive(item.href, item.label)}
                collapsed={collapsed}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Collapse toggle + Settings pinned at the bottom */}
      <div className="shrink-0 border-t border-border py-2">
        <CollapseToggle collapsed={collapsed} onToggle={toggle} />
        <ItemLink
          item={{ label: "Settings", href: "/settings", icon: Settings }}
          active={pathname.startsWith("/settings")}
          collapsed={collapsed}
        />
      </div>
    </nav>
  )
}
