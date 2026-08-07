"use client"

import {
  Tooltip as AriaTooltip,
  TooltipTrigger as AriaTooltipTrigger,
  type TooltipProps as AriaTooltipProps,
  type TooltipTriggerComponentProps,
} from "react-aria-components"

/**
 * The owned tooltip.
 *
 * `shell/SideNav.tsx` is the caller: when the nav is collapsed to icons, every
 * item needs its label back on hover or focus. It used to import the vendor's
 * Tooltip / TooltipTrigger / Focusable directly and keep the panel classes in a
 * local `TOOLTIP_CLASS` constant, plus `delay={250} closeDelay={0}` repeated at
 * every trigger. Both now live here, which is what lets `eslint.config.mjs`
 * refuse `react-aria-components` in a domain module and still name a real
 * alternative.
 *
 * `Focusable` is re-exported rather than wrapped: it renders no DOM of its own,
 * it exists so a plain `<a>` or `<button>` can be a tooltip trigger, and there
 * is nothing about it to own. Re-exporting keeps the import line inside the
 * wrapper layer.
 */
export { Focusable } from "react-aria-components"

const TOOLTIP_CLASS =
  "pop-panel z-chrome-popover rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] font-medium text-text-1 shadow-lg outline-none"

export interface TooltipProps extends Omit<AriaTooltipProps, "className"> {
  className?: string
}

/**
 * Placement defaults to `right` and offset to 12: the tooltip's job here is to
 * name a collapsed side-nav icon, so it opens away from the rail.
 */
export function Tooltip({ className, placement = "right", offset = 12, ...props }: TooltipProps) {
  return (
    <AriaTooltip
      {...props}
      placement={placement}
      offset={offset}
      className={[TOOLTIP_CLASS, className].filter(Boolean).join(" ")}
    />
  )
}

/**
 * The hover/focus timing, owned once. 250ms is long enough that sweeping the
 * pointer across a nav column does not strobe labels; closing immediately is
 * what keeps the label from covering the item you just clicked.
 */
export function TooltipTrigger({ delay = 250, closeDelay = 0, ...props }: TooltipTriggerComponentProps) {
  return <AriaTooltipTrigger delay={delay} closeDelay={closeDelay} {...props} />
}
