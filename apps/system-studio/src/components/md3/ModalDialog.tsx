"use client"

import { createPortal } from "react-dom"
import { useId, useRef, type ReactNode } from "react"

import "./primitives.css"
import { Surface } from "./Surface"
import { useDismissableLayer, useFocusTrap, useModalHost } from "./hooks"

/**
 * The modal half of `Dialog`: focus trapped, background inert, Escape closes,
 * focus returns.
 *
 * `Dialog` is a server component that renders a scrim and a titled panel and
 * refuses to claim `aria-modal`, on the grounds that nothing in it makes the
 * background unreachable. That reasoning is exact, and it ends with the
 * sentence this file is: *"A route that needs true modality needs a client
 * component that calls showModal() and restores focus on close. That component
 * would wrap this one rather than replace it."*
 *
 * It wraps it in structure rather than in JSX. `Dialog` cannot be given
 * `aria-modal`, a ref or a portal through its props, so this renders the same
 * shape — same scrim class, same Surface, same headline and action layout — and
 * adds the four things that make the attribute honest:
 *
 *   1. a portal to the end of `<body>`, so there is something to make inert;
 *   2. `inert` on every other child of `<body>` (`useModalHost`);
 *   3. a Tab trap that re-reads its stops on every press (`useFocusTrap`);
 *   4. Escape through the layer stack, so a dialog opened from a drawer closes
 *      itself and leaves the drawer open.
 *
 * ## `<dialog showModal()>` was considered
 *
 * The platform element gives the trap and the top layer for free, and takes
 * back control of the scrim (`::backdrop` cannot use the console's scrim token
 * in every engine), of open/close timing under React, and of what happens when
 * two are opened at once. React 19 still does not render into the top layer
 * declaratively. The trade favoured the explicit implementation, which is the
 * same call `CommandPalette` made.
 *
 * ## Double submit
 *
 * `busy` disables the confirming slot and says so in words. STUDIO-030-008 names
 * accidental double submit; a dialog whose confirm button stays live during the
 * server action is the most common way to get two of an irreversible thing.
 */

export interface ModalDialogProps {
  open: boolean
  /** Called by Escape, by the scrim, and by the dismiss button. */
  onClose: () => void
  headline: ReactNode
  /** One line saying what the confirming action would do. */
  supportingText?: ReactNode
  children?: ReactNode
  /** The confirming action(s). Right-most is the confirming one. */
  actions?: ReactNode
  /** The label on the built-in way out. It is a real button, always present. */
  dismissLabel?: string
  /** While true, the dialog says it is working and the dismiss control stays live. */
  busy?: boolean
  id?: string
}

export function ModalDialog({
  open,
  onClose,
  headline,
  supportingText,
  children,
  actions,
  dismissLabel = "Cancel",
  busy = false,
  id,
}: ModalDialogProps) {
  const generatedId = useId()
  const baseId = id ?? generatedId
  const headingId = `${baseId}-headline`
  const describeId = `${baseId}-support`
  const panelRef = useRef<HTMLDivElement | null>(null)
  const dismissRef = useRef<HTMLButtonElement | null>(null)
  const host = useModalHost(open)

  useDismissableLayer({
    open,
    onDismiss: onClose,
    panelRef,
    // A modal does not close because focus moved — there is nowhere for focus to
    // move to. It closes on Escape, on the scrim, and on its own button.
    dismissOnFocusOut: false,
  })
  /*
   * `open && host !== null`, not `open`.
   *
   * The portal host is created in an effect, so on the render where `open`
   * first becomes true there is no host, the component returns null, and
   * `panelRef.current` is still null. A trap activated on `open` alone runs its
   * effect exactly then, finds no container, and returns — and nothing changes
   * afterwards to make it run again, so the dialog mounts with focus still
   * behind it and Tab still walking the page. Including the host in the
   * condition is what makes the effect run on the render that actually has a
   * panel. The component test caught this; nothing on screen shows it.
   */
  // Focus starts on the way OUT, not on the confirming action. A dialog that
  // opens with Enter already on "Delete" turns a stray keypress into a purge.
  useFocusTrap(open && host !== null, panelRef, dismissRef)

  if (!open || !host) return null

  return createPortal(
    <div
      className="md3-dialog-scrim"
      data-md3="modal-scrim"
      onPointerDown={(event) => {
        // Only a press that STARTED on the scrim closes it. Otherwise a drag
        // that began on a text selection inside the panel and ended outside
        // closes the dialog and loses the form.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div ref={panelRef} data-md3="modal" tabIndex={-1}>
        <Surface
          as="section"
          container="high"
          level={3}
          shape="extra-large"
          className="md3-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          {...(supportingText ? { "aria-describedby": describeId } : {})}
        >
          <h2 className="md3-dialog-headline md3-headline-small" id={headingId}>
            {headline}
          </h2>
          {supportingText ? (
            <p className="md3-dialog-support md3-body-medium" id={describeId}>
              {supportingText}
            </p>
          ) : null}
          {children ? <div className="md3-dialog-body">{children}</div> : null}
          <div className="md3-dialog-actions">
            <button
              ref={dismissRef}
              type="button"
              className="md3-button md3-state"
              data-variant="text"
              data-tone="neutral"
              onClick={onClose}
            >
              {dismissLabel}
            </button>
            {busy ? (
              <p data-md3="modal-busy" className="md3-body-small" role="status">
                Working. Do not close this dialog.
              </p>
            ) : (
              actions
            )}
          </div>
        </Surface>
      </div>
    </div>,
    host,
  )
}
