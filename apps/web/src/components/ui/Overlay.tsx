"use client"

import { type ReactNode } from "react"
import {
  Dialog,
  DialogTrigger,
  Modal,
  ModalOverlay,
  Heading,
  Popover,
  Button as AriaButton,
} from "react-aria-components"
import { X } from "@/components/ui/icons"

/**
 * A single, product-wide modal overlay. Every "See all", detail peek, and
 * admin form opens through this so overlays feel identical everywhere:
 * centered, dimmed + blurred backdrop, soft-elevated panel, escape + click-away
 * to close.
 *
 * Built on react-aria's Modal for focus-trapping and accessibility. `children`
 * and `footer` accept either a plain node or a render function that receives
 * `{ close }`, so callers can dismiss the overlay from inside (e.g. after
 * clicking a link).
 */

const SIZES = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
} as const

type CloseFn = () => void
type Renderable = ReactNode | ((opts: { close: CloseFn }) => ReactNode)

export function Overlay({
  trigger,
  title,
  description,
  headerAction,
  children,
  footer,
  size = "md",
  isOpen,
  onOpenChange,
  isDismissable = true,
}: {
  /** Optional trigger element; omit when controlling with isOpen/onOpenChange. */
  trigger?: ReactNode
  title: string
  description?: string
  /** Optional header control rendered left of the close button. */
  headerAction?: ReactNode
  children: Renderable
  footer?: Renderable
  size?: keyof typeof SIZES
  isOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Allow click-away / escape to close (default true). */
  isDismissable?: boolean
}) {
  const modal = (
    <ModalOverlay
      isDismissable={isDismissable}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      className="overlay-backdrop fixed inset-0 z-overlay flex min-h-full items-center justify-center p-4 sm:p-6"
    >
      <Modal
        className={`overlay-panel w-full ${SIZES[size]} max-h-[86vh] overflow-hidden rounded-xl border border-border bg-surface shadow-lg outline-none flex flex-col`}
      >
        <Dialog className="outline-none flex flex-col max-h-[86vh]">
          {({ close }) => (
            <>
              <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
                <div className="min-w-0">
                  <Heading slot="title" className="text-lead font-display font-bold text-text-1">
                    {title}
                  </Heading>
                  {description && (
                    <p className="mt-1 text-sm text-text-2">{description}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {headerAction}
                  <AriaButton
                    onPress={close}
                    aria-label="Close"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-text-3 outline-none transition-colors data-[hovered]:bg-base data-[hovered]:text-text-1 data-[focus-visible]:ring-2 data-[focus-visible]:ring-[--border-focus]"
                  >
                    <X size={18} />
                  </AriaButton>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                {typeof children === "function" ? children({ close }) : children}
              </div>

              {footer && (
                <div className="flex items-center justify-end gap-3 border-t border-border bg-subtle px-6 py-4">
                  {typeof footer === "function" ? footer({ close }) : footer}
                </div>
              )}
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )

  if (trigger) {
    return (
      <DialogTrigger>
        {trigger}
        {modal}
      </DialogTrigger>
    )
  }
  return modal
}

/**
 * Overlay's anchored sibling: a dialog in a popover rather than a centered
 * modal, for a panel that belongs to the control that opened it. The
 * notification bell is the caller — its dropdown is a dialog (it holds a list,
 * a "mark all read" control and a footer link, none of which are menu items),
 * but it hangs off the bell instead of dimming the page.
 *
 * Placement, offset and width are not props. There is one shell dropdown shape
 * in the product and this is it; a `placement` prop would only be a way to have
 * two. `shell/NotificationBell.tsx` used to spell the same panel out inline
 * against the vendor's Popover — the class string that lives here now.
 */
export function PopoverDialog({
  trigger,
  label,
  onOpenChange,
  children,
}: {
  /** The control the panel hangs off. A Button from @/components/ui/Button. */
  trigger: ReactNode
  /** Accessible name — the panel has no `Heading slot="title"` to borrow one from. */
  label: string
  onOpenChange?: (isOpen: boolean) => void
  children: Renderable
}) {
  return (
    <DialogTrigger onOpenChange={onOpenChange}>
      {trigger}
      <Popover
        placement="bottom end"
        offset={10}
        className="pop-panel w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-border bg-surface shadow-lg outline-none"
      >
        <Dialog className="outline-none" aria-label={label}>
          {({ close }) => <>{typeof children === "function" ? children({ close }) : children}</>}
        </Dialog>
      </Popover>
    </DialogTrigger>
  )
}
