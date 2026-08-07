"use client"

import Link from "next/link"
import { Button } from "@/components/ui/Button"
import { Menu, MenuItem, MenuPopover, MenuTrigger } from "@/components/ui/Menu"
import { ChevronDown, LogOut, UserRound } from "@/components/ui/icons"
import { TenureAIMark, TenureLogo } from "@/components/brand/TenureLogo"
import { EmailLink } from "@/components/EmailLink"
import { SearchCommand } from "./SearchCommand"
import { NavDrawerToggle } from "./NavDrawerToggle"
import { NotificationBell } from "./NotificationBell"
import { TenantSwitcher, type TenantOption } from "./TenantSwitcher"
import type { NavSectionView } from "./SideNav"
import { useAI } from "@/components/ai/AIProvider"

interface ShellHeaderProps {
  userName?: string
  userEmail?: string
  userImage?: string
  /**
   * The institution every query on the page below is filtered to. Named in the
   * header rather than on individual pages because it is true of all of them,
   * and because a user who cannot see which tenant they are in will eventually
   * act in the wrong one.
   */
  activeTenant?: TenantOption | null
  tenantOptions?: TenantOption[]
  onSwitchTenant?: (institutionId: string) => Promise<void>
  unreadNotifications?: number
  onSignOut?: () => Promise<void>
  /**
   * The capability-filtered navigation, resolved by the layout. Passed through
   * to `SearchCommand` so the command palette's actions are exactly the ones
   * this principal holds.
   *
   * REQUIRED, deliberately. Every other prop here is optional with a default,
   * and an optional `sections` would compile at the one construction site
   * unchanged while shipping a palette with no actions in it — the
   * optional-field-nobody-sets failure, invisible to `tsc` and to every unit
   * test that builds its own fixture.
   */
  sections: readonly NavSectionView[]
}

export function ShellHeader({
  userName = "User",
  userEmail,
  userImage,
  activeTenant = null,
  tenantOptions = [],
  onSwitchTenant,
  unreadNotifications = 0,
  onSignOut,
  sections,
}: ShellHeaderProps) {
  const { openPanel } = useAI()
  return (
    <header
      className="fixed top-0 left-0 right-0 z-header flex h-shell items-center gap-2.5 px-3 sm:px-4"
      style={{ background: "var(--shell-bg)", borderBottom: "1px solid var(--shell-border)" }}
    >
      {/* Below 700px the side nav is off-canvas; this is how it opens. */}
      <NavDrawerToggle />

      {/* Brand — rosette + wordmark */}
      <Link
        href="/dashboard"
        className="flex shrink-0 items-center gap-2.5 text-[--shell-text] no-underline"
      >
        <TenureLogo size={22} color="var(--primary)" />
        {/* NB: not `text-base` — a custom Tailwind colour named `base` makes that
            class also emit `color: var(--bg-base)`, which hides the wordmark. */}
        <span className="font-display text-[17px] font-bold tracking-tight">Tenure</span>
      </Link>

      {onSwitchTenant && (
        <TenantSwitcher
          active={activeTenant}
          options={tenantOptions}
          onSwitch={onSwitchTenant}
        />
      )}

      {/* Flexible gap pushes the utilities to the right */}
      <div className="min-w-0 flex-1" />

      {/* Right utilities — Tenure AI sits directly beside global search, and
          search sits directly left of the notification bell. */}
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openPanel}
            className="hidden h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors md:inline-flex"
            style={{
              color: "var(--primary)",
              background: "var(--primary-light)",
              border: "1px solid var(--primary)",
            }}
            aria-label="Ask Tenure AI"
          >
            <TenureAIMark size={16} color="var(--primary)" />
            Tenure AI
          </button>

          <SearchCommand sections={sections} />
        </div>

        <NotificationBell initialUnread={unreadNotifications} />

        {/* User menu */}
        <MenuTrigger>
          <Button variant="shell" size="shell" aria-label="User menu">
            {userImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={userImage}
                alt=""
                className="h-7 w-7 rounded-full object-cover ring-1 ring-border"
              />
            ) : (
              <div
                className="grid h-7 w-7 place-items-center rounded-full text-[13px] font-semibold text-white"
                style={{ background: "var(--primary)" }}
              >
                {userName[0]?.toUpperCase()}
              </div>
            )}
            <span className="hidden text-sm text-[--shell-text] sm:block">{userName}</span>
            <ChevronDown size={14} />
          </Button>
          <MenuPopover placement="bottom end" className="min-w-60">
            <div className="border-b border-border px-4 py-3.5">
              <p className="flex items-center gap-2 text-sm font-semibold text-text-1">
                <UserRound size={15} className="text-text-3" /> {userName}
              </p>
              {userEmail && (
                <p className="mt-0.5 text-[13px]">
                  <EmailLink email={userEmail} />
                </p>
              )}
            </div>
            <Menu>
              <MenuItem onAction={() => onSignOut?.()}>
                <LogOut size={15} className="text-text-3" />
                Sign out / switch user
              </MenuItem>
            </Menu>
          </MenuPopover>
        </MenuTrigger>
      </div>
    </header>
  )
}
