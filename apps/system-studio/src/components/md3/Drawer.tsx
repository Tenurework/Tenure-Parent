"use client"

import { createPortal } from "react-dom"
import { useId, useRef, type ReactNode } from "react"

import "./primitives.css"
import { Surface } from "./Surface"
import { useDismissableLayer, useFocusTrap, useModalHost } from "./hooks"

/**
 * A panel that slides in from an edge and holds a task: the inspector rail for
 * a selected resource, a filter sheet at 320 pixels, a change's evidence.
 *
 * ## It is a modal dialog that happens to be against an edge
 *
 * Same guarantees as `ModalDialog` and for the same reasons — portal, `inert`
 * background, Tab trap, Escape through the layer stack, focus returned to the
 * trigger — because a drawer that leaves the page behind it tabbable is a
 * keyboard user tabbing into content they cannot see. The differences are
 * where it sits and that it is sized to hold a long body.
 *
 * ## The body scrolls, not the page
 *
 * The header and the footer stay put and the middle scrolls, which is what
 * makes a drawer usable at 900px with a 40-row list in it. STUDIO-030-008 names
 * hidden scrolling actions: the actions live in the footer, outside the scroll
 * container, so a decision is never below the fold.
 *
 * The scroll container carries `tabIndex={0}` and a name, because a region that
 * scrolls and contains no focusable element cannot be scrolled from a keyboard
 * otherwise (WCAG 2.1.1). That is the same rule `CodeBlock` follows.
 *
 * ## `side` is logical
 *
 * `inline-start` and `inline-end`, not left and right, so the drawer is on the
 * correct side in a right-to-left document without a second component or a
 * conditional in the caller. `block-end` is the bottom sheet, which is what the
 * narrow breakpoint wants.
 */

export interface DrawerProps {
  open: boolean
  onClose: () => void
  /** The drawer's heading, and its accessible name. */
  title: ReactNode
  children: ReactNode
  /** Actions pinned below the scroll area. */
  footer?: ReactNode
  side?: "inline-start" | "inline-end" | "block-end"
  /** The label on the close button. */
  dismissLabel?: string
  id?: string
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  side = "inline-end",
  dismissLabel = "Close",
  id,
}: DrawerProps) {
  const generatedId = useId()
  const baseId = id ?? generatedId
  const titleId = `${baseId}-title`
  const bodyId = `${baseId}-body`
  const panelRef = useRef<HTMLDivElement | null>(null)
  const dismissRef = useRef<HTMLButtonElement | null>(null)
  const host = useModalHost(open)

  useDismissableLayer({ open, onDismiss: onClose, panelRef, dismissOnFocusOut: false })
  // `host !== null` for the reason `ModalDialog` sets out at length: the trap
  // must activate on the render that has a panel, not on the one that has only
  // decided to have one.
  useFocusTrap(open && host !== null, panelRef, dismissRef)

  if (!open || !host) return null

  return createPortal(
    <div
      className="md3-dialog-scrim"
      data-md3="drawer-scrim"
      data-side={side}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div ref={panelRef} data-md3="drawer" data-side={side} tabIndex={-1}>
        <Surface
          as="section"
          container="high"
          level={3}
          shape="large"
          outlined
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          data-md3="drawer-panel"
        >
          <header data-md3="drawer-header">
            <h2 id={titleId} className="md3-title-large">
              {title}
            </h2>
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
          </header>
          {/*
            Named and focusable: a scrollable region with no tab stop of its own
            is unreachable from a keyboard, and this one routinely holds a long
            read-only body.
          */}
          <div
            id={bodyId}
            data-md3="drawer-body"
            tabIndex={0}
            role="group"
            aria-labelledby={titleId}
          >
            {children}
          </div>
          {footer ? <footer data-md3="drawer-footer">{footer}</footer> : null}
        </Surface>
      </div>
    </div>,
    host,
  )
}
