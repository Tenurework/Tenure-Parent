"use client"

import type { ReactNode } from "react"
import {
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  Popover as AriaPopover,
  type MenuItemProps as AriaMenuItemProps,
  type MenuProps as AriaMenuProps,
  type PopoverProps as AriaPopoverProps,
} from "react-aria-components"

/**
 * The owned dropdown-menu family: `MenuTrigger` → `MenuPopover` → `Menu` →
 * `MenuItem`.
 *
 * Before this file existed, `shell/ShellHeader.tsx` and
 * `shell/TenantSwitcher.tsx` each imported the vendor's Menu / MenuItem /
 * MenuTrigger / Popover directly and repeated the same panel and row class
 * strings — the panel down to the character, the row differing only in how the
 * contents are spread. Those repeats now live here once, which is what makes
 * the `react-aria-components` ban in `eslint.config.mjs` obeyable: the rule
 * names this module as the alternative, so it has to exist first.
 *
 * `MenuTrigger` is re-exported untouched on purpose. It renders no DOM and has
 * nothing to style; wrapping it would add a layer that only forwards props.
 * What it gets from living here is the boundary — a domain module imports it
 * from `@/components/ui/Menu`, never from the vendor.
 */
export { MenuTrigger } from "react-aria-components"

/** The floating panel. `pop-panel` carries the entry animation in globals.css. */
const POPOVER_CLASS = "pop-panel rounded-lg border border-border bg-surface shadow-lg outline-none"

/** The list inside the panel; padding is the panel's, not each row's. */
const MENU_CLASS = "p-1.5 outline-none"

/**
 * A row. `data-[focused]` rather than `:hover` because keyboard focus has to
 * highlight identically to the pointer — that is the whole reason the menu is
 * the library's and not a `<ul>`.
 */
const MENU_ITEM_CLASS =
  "flex cursor-pointer items-center rounded-md px-3 py-2.5 text-sm text-text-1 outline-none data-[focused]:bg-base"

const MENU_ITEM_LAYOUT = {
  /** Icon then label, reading left to right. */
  inline: "gap-2",
  /** Label at the start, a state marker pushed to the end. */
  split: "justify-between gap-3",
} as const

const cx = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" ")

export interface MenuPopoverProps extends Omit<AriaPopoverProps, "className" | "children"> {
  /** Appended to the owned panel classes — width and placement, not chrome. */
  className?: string
  children: ReactNode
}

export function MenuPopover({ className, children, ...props }: MenuPopoverProps) {
  return (
    <AriaPopover {...props} className={cx(POPOVER_CLASS, className)}>
      {children}
    </AriaPopover>
  )
}

export interface MenuProps<T extends object> extends Omit<AriaMenuProps<T>, "className"> {
  className?: string
}

export function Menu<T extends object>({ className, ...props }: MenuProps<T>) {
  return <AriaMenu {...props} className={cx(MENU_CLASS, className)} />
}

export interface MenuItemProps extends Omit<AriaMenuItemProps<object>, "className"> {
  className?: string
  /** How the row spreads its contents. Defaults to icon-then-label. */
  layout?: keyof typeof MENU_ITEM_LAYOUT
}

export function MenuItem({ className, layout = "inline", ...props }: MenuItemProps) {
  return <AriaMenuItem {...props} className={cx(MENU_ITEM_CLASS, MENU_ITEM_LAYOUT[layout], className)} />
}
