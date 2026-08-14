"use client"

import type { ReactNode } from "react"

import "./primitives.css"
import { Surface } from "./Surface"

/**
 * Where outcomes appear, and where they stay until somebody has read them.
 *
 * ## It is one live region, not one per message
 *
 * A live region works by being IN the document before the thing it announces is
 * put inside it. Mounting a `role="status"` element and its message together is
 * the single most common reason a toast is never announced — the observer had
 * nothing to observe. So the region is always rendered, empty or not, and
 * messages are appended into it.
 *
 * ## Nothing disappears on a timer
 *
 * `Snackbar` argues this at length and it is right: WCAG 2.2 AA 2.2.1 requires
 * time limits to be adjustable or extendable, and in a control plane the toast
 * is often the only record on screen that a mutation was accepted. Every toast
 * here has a Dismiss button and no clock. The stack is capped instead — past
 * `LIMIT` the oldest is dropped, because twelve stacked messages hide the page
 * they are describing.
 *
 * ## `status`, not `alert`
 *
 * Polite. `alert` interrupts whatever a screen reader is saying, which is right
 * for "your session expires in one minute" and wrong for "the tenant moved to
 * PROVISIONING". Anything genuinely urgent says so in words, which everybody
 * can read.
 *
 * ## Why it does not render `Snackbar`
 *
 * It renders the same shape — the same inverse Surface, the same
 * `md3-snackbar` classes, the same message-then-actions order — but not the
 * component, because `Snackbar` carries its own `role="status"`. Nesting a live
 * region inside a live region is how a message gets announced twice, or once by
 * the wrong region, depending on the screen reader. There is exactly one live
 * region here and it is the one that is always in the document.
 *
 * ## It is not a portal and it is not fixed by this component
 *
 * The region is rendered where the shell puts it. Positioning belongs to the
 * shell's layout, and a component that pins itself to a viewport corner is one
 * that overlaps whatever the shell already put there — which is exactly the
 * "toast covering the primary action" defect it would be introduced to avoid.
 */

export interface ToastMessage {
  id: string
  /** One sentence, past tense: what happened. */
  message: string
  /** At most one action — "Undo", "View the change". */
  action?: ReactNode
}

/** More than four stacked messages is a page nobody can read. */
export const LIMIT = 4

export interface ToastRegionProps {
  toasts: readonly ToastMessage[]
  /** Called with the id of the toast whose Dismiss button was pressed. */
  onDismiss: (id: string) => void
  /** Names the region. "Notifications" unless the shell has a better word. */
  label?: string
}

export function ToastRegion({ toasts, onDismiss, label = "Notifications" }: ToastRegionProps) {
  // Newest first, and capped. `slice` on a copy, never a mutation of the prop —
  // a component that reverses its caller's array in place is a bug that appears
  // three renders later somewhere else.
  const shown = [...toasts].reverse().slice(0, LIMIT)

  return (
    <div
      data-md3="toast-region"
      role="status"
      aria-live="polite"
      aria-atomic="false"
      aria-label={label}
    >
      {shown.map((toast) => (
        <Surface
          key={toast.id}
          as="aside"
          container="inverse"
          level={3}
          shape="extra-small"
          className="md3-snackbar"
          id={toast.id}
          data-md3="toast"
        >
          <p className="md3-snackbar-message md3-body-medium">{toast.message}</p>
          <div className="md3-snackbar-actions">
            {toast.action}
            <button
              type="button"
              className="md3-button md3-state"
              data-variant="text"
              data-tone="neutral"
              onClick={() => onDismiss(toast.id)}
            >
              {/* Named with the message it dismisses would be better still, but
                  the message is a sentence; "Dismiss" beside its own text is
                  unambiguous in a stack of four. */}
              Dismiss
            </button>
          </div>
        </Surface>
      ))}
    </div>
  )
}
