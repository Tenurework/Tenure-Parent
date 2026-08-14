"use client"

import { useId, useState, type ReactNode } from "react"

import "./primitives.css"
import { isDismiss } from "./interaction"

/**
 * A short line about the control it is attached to.
 *
 * ## The three rules of WCAG 2.2 AA 1.4.13, which is what a tooltip is
 *
 *   * **Dismissible.** Escape hides it without moving focus. A tooltip that
 *     cannot be dismissed covers the thing underneath it for anyone using
 *     magnification.
 *   * **Hoverable.** The pointer can travel onto the tooltip itself without it
 *     vanishing. Here the tooltip is a child of the same wrapper the pointer is
 *     already inside, so moving onto it never fires the leave.
 *   * **Persistent.** It stays until the pointer leaves, focus leaves, or
 *     Escape. There is no timer, for the reason `Snackbar` gives at length: a
 *     message that removes itself while it is being read fails 2.2.1.
 *
 * ## It is reachable without a pointer
 *
 * Focus shows it, which is the half most implementations skip. That is why the
 * trigger must be a focusable control — this component renders the tip, and the
 * caller passes the button or link it describes. A tooltip on a `<span>` is a
 * tooltip a keyboard cannot reach, so `children` is typed as the control and
 * the wrapper listens on the focus events that bubble from it.
 *
 * ## The description is always in the accessibility tree
 *
 * `aria-describedby` points at the tip whether or not it is visible, and hiding
 * is done by clipping rather than by `display: none` or by unmounting. A
 * reference that appears and disappears is one screen readers announce
 * inconsistently — some read the description only on the focus event that
 * happened before the element existed. Clipped-but-present is stable, and it is
 * why the closed state is a data attribute rather than a conditional render.
 *
 * ## It is not for anything that matters
 *
 * A tooltip is a hint. Anything an operator must read before acting — what a
 * purge will delete, why an action is unavailable — goes in the page, in
 * `supportingText`, or in a dialog. Content available only on hover is content
 * a touch user does not have.
 */

export interface TooltipProps {
  /** The hint. A phrase, not a paragraph. */
  tip: string
  /** The control being described. Must be focusable — a button, a link, a field. */
  children: ReactNode
  /** Which side of the trigger it sits on. */
  placement?: "block-start" | "block-end"
  id?: string
}

export function Tooltip({ tip, children, placement = "block-end", id }: TooltipProps) {
  const generatedId = useId()
  const tipId = `${id ?? generatedId}-tip`
  const [shown, setShown] = useState(false)
  // Escape hides it until the pointer or focus leaves and comes back. Without
  // this, moving the mouse one pixel inside the trigger re-shows what the
  // operator just dismissed.
  const [dismissed, setDismissed] = useState(false)
  const open = shown && !dismissed

  return (
    <span
      data-md3="tooltip-anchor"
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => {
        setShown(false)
        setDismissed(false)
      }}
      onFocus={() => setShown(true)}
      onBlur={() => {
        setShown(false)
        setDismissed(false)
      }}
      onKeyDown={(event) => {
        if (isDismiss(event.key) && shown) {
          // No preventDefault and no stopPropagation past this: Escape inside a
          // dialog must still close the dialog once the tip is gone. Stopping
          // it here only means the same keystroke does not do both.
          event.stopPropagation()
          setDismissed(true)
        }
      }}
    >
      {/*
        `aria-describedby` lives on the wrapper rather than being forced onto
        the child, because a component cannot clone arbitrary children without
        assuming their type. The description resolves through the wrapper for
        the control inside it.
      */}
      <span aria-describedby={tipId} data-md3="tooltip-trigger">
        {children}
      </span>
      <span
        id={tipId}
        role="tooltip"
        data-md3="tooltip"
        data-placement={placement}
        data-open={open ? "true" : "false"}
        className="md3-body-small"
      >
        {tip}
      </span>
    </span>
  )
}
