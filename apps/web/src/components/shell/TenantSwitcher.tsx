"use client"

import { useTransition } from "react"
import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components"
import { Building2, CheckCircle, ChevronDown, Loader2 } from "@/components/ui/icons"

export interface TenantOption {
  id: string
  slug: string
  name: string
}

interface TenantSwitcherProps {
  /** Where the user is acting right now. `null` only for an account with no institution. */
  active: TenantOption | null
  /** Every institution this user may act in, in preference order. */
  options: TenantOption[]
  /** Server action. Validates membership before it persists anything. */
  onSwitch: (institutionId: string) => Promise<void>
}

/**
 * The active institution, named on every page, and the control that changes it.
 *
 * It renders whether or not there is anything to switch to, because the two
 * jobs are separate: a user with one institution still needs to know which
 * tenant's data they are looking at, and "no switcher visible" would be
 * indistinguishable from "the tenant you assumed". A single-institution user
 * gets a label; a multi-institution user gets the same label as a menu button.
 *
 * The menu is a `MenuTrigger`, matching the user menu beside it, so keyboard
 * and screen-reader behaviour is the library's rather than something
 * hand-rolled per control.
 *
 * Selecting an entry calls a server action inside a transition. The action
 * revalidates the whole layout, so React swaps in the tree the *new* tenant
 * renders — navigation, branding, page contents — rather than this component
 * optimistically claiming a switch the server may have refused.
 */
export function TenantSwitcher({ active, options, onSwitch }: TenantSwitcherProps) {
  const [switching, startSwitching] = useTransition()

  if (!active) return null

  const label = (
    <span
      data-testid="active-tenant"
      className="max-w-[110px] truncate text-sm sm:max-w-[220px]"
      style={{ color: "var(--shell-text-secondary)" }}
    >
      {active.name}
    </span>
  )

  const divider = (
    <div
      aria-hidden
      className="h-6 w-px shrink-0"
      style={{ background: "var(--shell-border)" }}
    />
  )

  if (options.length < 2) {
    return (
      <>
        {divider}
        <div className="flex min-w-0 items-center gap-1.5">
          <Building2 size={15} aria-hidden style={{ color: "var(--shell-text-secondary)" }} />
          {/* Announced, not merely displayed: which tenant you are in is not a
              decoration a screen-reader user should have to infer. */}
          <span className="sr-only">Acting at institution:</span>
          {label}
        </div>
      </>
    )
  }

  return (
    <>
      {divider}
      <MenuTrigger>
        <Button
          className="inline-flex h-9 min-w-0 items-center gap-1.5 rounded-lg px-2 transition-colors outline-none data-[hovered]:bg-[--shell-item-hover] data-[focus-visible]:ring-2 data-[focus-visible]:ring-[--primary]"
          aria-label={`Institution: ${active.name}. Switch institution`}
          isDisabled={switching}
        >
          {switching ? (
            <Loader2 size={15} aria-hidden className="animate-spin" style={{ color: "var(--shell-text-secondary)" }} />
          ) : (
            <Building2 size={15} aria-hidden style={{ color: "var(--shell-text-secondary)" }} />
          )}
          {label}
          <ChevronDown size={14} aria-hidden style={{ color: "var(--shell-text-secondary)" }} />
        </Button>
        <Popover
          placement="bottom start"
          className="pop-panel min-w-64 rounded-lg border border-border bg-surface shadow-lg outline-none"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="micro-label">Switch institution</p>
            <p className="mt-1 text-xs text-text-3">
              Everything below the header — clubs, approvals, calendar, reports — is that
              institution&apos;s and only that institution&apos;s.
            </p>
          </div>
          <Menu
            className="p-1.5 outline-none"
            aria-label="Institutions you can act in"
            onAction={(key) => {
              if (String(key) === active.id) return
              startSwitching(async () => {
                await onSwitch(String(key))
              })
            }}
          >
            {options.map((option) => (
              <MenuItem
                key={option.id}
                id={option.id}
                textValue={option.name}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2.5 text-sm text-text-1 outline-none data-[focused]:bg-base"
              >
                <span className="min-w-0">
                  <span className="block truncate">{option.name}</span>
                  <span className="block truncate text-xs text-text-3">{option.slug}</span>
                </span>
                {option.id === active.id ? (
                  <>
                    <CheckCircle size={15} aria-hidden className="shrink-0 text-text-3" />
                    <span className="sr-only">(current)</span>
                  </>
                ) : null}
              </MenuItem>
            ))}
          </Menu>
        </Popover>
      </MenuTrigger>
    </>
  )
}
