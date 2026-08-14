"use client"

import { useCallback, useId, useRef, useState, type ReactNode } from "react"

import "./primitives.css"
import { Surface } from "./Surface"
import { useDismissableLayer } from "./hooks"
import type { ButtonTone, ButtonVariant } from "./Button"

/**
 * A panel attached to a control, holding anything: a filter form, a details
 * card, an account summary.
 *
 * ## The keyboard contract, which is the whole product
 *
 * Enter or Space on the trigger opens it — because the trigger is a real
 * `<button>` and those are what a button does — Escape closes it FROM ANYWHERE
 * INSIDE and puts focus back on the trigger, Tab leaves and closes it on the
 * way out, and a pointer landing outside dismisses. `useDismissableLayer` owns
 * all four and the layer stack that makes Escape close only the top one.
 *
 * ## Rendered where it is written, not portalled to `<body>`
 *
 * A portal is the usual answer to a panel clipped by an ancestor's `overflow`,
 * and it costs the thing that matters more: DOM order. Portalled to the end of
 * the document, the panel is reached by Tab only after every remaining control
 * on the page, so a keyboard user opens it and tabs into the footer. Screen
 * reader reading order goes the same way.
 *
 * So the panel is a sibling of the trigger, inside an anchor wrapper, and
 * clipping is handled where clipping belongs — the surfaces that host a popover
 * do not set `overflow: hidden` on the axis it opens along. That is a rule a
 * stylesheet can hold; reading order is not something a stylesheet can restore.
 *
 * ## `role="dialog"`, and deliberately not `aria-modal`
 *
 * The panel is a named region a screen reader can enter and leave. It does NOT
 * set `aria-modal`, because the page behind it genuinely is still reachable —
 * that is what makes this a popover and not a dialog. `ModalDialog` is the one
 * that claims modality, and it claims it because it traps focus. Nothing in this
 * directory says something about itself that is not true.
 *
 * ## Open state may be the caller's
 *
 * Left alone it manages its own. Passing `open` and `onOpenChange` hands that to
 * the caller, which is what a shell needs when opening the account menu must
 * close the notification panel.
 */

export interface PopoverProps {
  /**
   * The accessible name of the PANEL — "Account", "Filters", "Cost breakdown".
   * Required: an unnamed dialog is announced as "dialog", which in a console
   * with six of them is no name at all.
   */
  label: string
  /** What the trigger button says. A word, never an icon alone. */
  trigger: ReactNode
  triggerVariant?: ButtonVariant
  triggerTone?: ButtonTone
  /**
   * The panel's content. Given the `close` function, because the action inside
   * a popover is usually the thing that should close it.
   */
  children: ReactNode | ((close: () => void) => ReactNode)
  /** Which edge of the trigger the panel lines up with. `end` for a right-hand account menu. */
  align?: "start" | "end"
  /** Controlled mode. Omit both for a self-managing popover. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  id?: string
  /** Extra content in the trigger after the label — a count, a chevron word. */
  triggerHint?: ReactNode
}

export function Popover({
  label,
  trigger,
  triggerVariant = "outlined",
  triggerTone = "neutral",
  children,
  align = "start",
  open: controlledOpen,
  onOpenChange,
  id,
  triggerHint,
}: PopoverProps) {
  const generatedId = useId()
  const baseId = id ?? generatedId
  const panelId = `${baseId}-panel`
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const panelRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [controlledOpen, onOpenChange],
  )

  const close = useCallback(() => setOpen(false), [setOpen])

  useDismissableLayer({
    open,
    onDismiss: close,
    panelRef,
    triggerRef,
    // Tab out of the last control in the panel closes it. That is what makes
    // the popover leave no debris behind a keyboard user.
    dismissOnFocusOut: true,
  })

  return (
    <div data-md3="anchor">
      <button
        ref={triggerRef}
        type="button"
        className="md3-button md3-state"
        data-variant={triggerVariant}
        data-tone={triggerTone}
        aria-haspopup="dialog"
        aria-expanded={open}
        // Pointing at the panel only while it exists: `aria-controls` naming an
        // element that is not in the document is a broken reference, and some
        // screen readers report it as one.
        {...(open ? { "aria-controls": panelId } : {})}
        onClick={() => setOpen(!open)}
      >
        {trigger}
        {triggerHint ? <span data-md3="trigger-hint">{triggerHint}</span> : null}
      </button>
      {open ? (
        /*
         * Two elements rather than one: the outer div is the POSITION and the
         * dismissal boundary, the Surface is the paint. `Surface` is a server
         * component with no ref forwarding, and a popover needs a node to ask
         * "did that pointer land inside me?" — so the ref goes on the wrapper
         * and the container ladder stays Surface's business rather than being
         * re-implemented here with its data attributes copied out.
         */
        <div data-md3="popover" data-align={align} ref={panelRef}>
          <Surface
            as="section"
            container="high"
            level={2}
            shape="medium"
            outlined
            id={panelId}
            role="dialog"
            aria-label={label}
            data-md3="popover-panel"
          >
            {typeof children === "function" ? children(close) : children}
          </Surface>
        </div>
      ) : null}
    </div>
  )
}
