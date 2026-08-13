import type { ReactNode } from "react"

import { Surface } from "./Surface"

/**
 * A dialog whose openness is the caller's decision, not this component's state.
 *
 * ## What it claims, and what it deliberately does not
 *
 * It renders a scrim and a titled panel. It does **not** set `aria-modal="true"`
 * and it is not a `<dialog>` opened with `showModal()`, because neither would be
 * true here: `aria-modal` promises that everything behind the dialog is
 * unreachable, and nothing in this component makes that so. There is no
 * `"use client"` directive in this directory, so there is no focus trap, no
 * Escape handler and no inert background — and a dialog that claims modality
 * while the page behind it is still in the tab order is worse than one that does
 * not claim it, because a screen-reader user is told the rest of the document is
 * gone and then finds it.
 *
 * What it is instead is honest and useful: a `role="dialog"` region, named by its
 * own heading, drawn over a scrim, with a REQUIRED way out that is a plain link
 * or submit button. `dismiss` is required for exactly that reason — a dialog
 * with no visible exit and no Escape key is a trap.
 *
 * A route that needs true modality needs a client component that calls
 * `showModal()` and restores focus on close. That component would wrap this one
 * rather than replace it; the shape, the tokens and the scrim stay here.
 *
 * ## Openness is a prop, and the caller usually reads it from the URL
 *
 * `open={false}` renders nothing at all — not a hidden element. A hidden
 * element is still in the accessibility tree unless every path that hides it is
 * correct, and `globals.css` already carries one rule about a collapsed
 * `<details>` still reporting a bounding rectangle in Chrome. Rendering nothing
 * has no such failure mode.
 *
 * In this console the state behind that boolean is normally a query parameter,
 * which makes a confirmation step a link somebody can send and a back button
 * that works.
 */

export interface DialogProps {
  /** When false, nothing is rendered. Not hidden — absent. */
  open: boolean
  /**
   * The id the heading is given, and what names the dialog region.
   *
   * Required rather than generated, because a generated id differs between the
   * server render and the client one and React reports that as a hydration
   * mismatch — and because a page with two dialogs needs to be able to say which
   * is which.
   */
  id: string
  headline: ReactNode
  /**
   * One line saying what pressing the confirming action would do. Optional, but
   * a confirmation dialog without one is "are you sure?", which is not a control.
   */
  supportingText?: ReactNode
  children?: ReactNode
  /**
   * The actions. Right-most is the confirming one, by Material's convention and
   * by this console's.
   */
  actions?: ReactNode
  /**
   * The way out. Required.
   *
   * A `ButtonLink` back to the page without the query parameter, or a submit
   * button that closes a form. Nothing here handles Escape, so this is the exit.
   */
  dismiss: ReactNode
}

export function Dialog({
  open,
  id,
  headline,
  supportingText,
  children,
  actions,
  dismiss,
}: DialogProps) {
  if (!open) return null

  const headingId = `${id}-headline`

  return (
    <div className="md3-dialog-scrim">
      {/*
        `container="high"` and `level={3}`: Material's dialog elevation, and the
        container step that reads as lifted off the page under the scrim without
        the tinting this console's surfaces deliberately do not do.
      */}
      <Surface
        as="section"
        container="high"
        level={3}
        shape="extra-large"
        className="md3-dialog"
        id={id}
        role="dialog"
        aria-labelledby={headingId}
      >
        <h2 className="md3-dialog-headline md3-headline-small" id={headingId}>
          {headline}
        </h2>
        {supportingText ? (
          <p className="md3-dialog-support md3-body-medium">{supportingText}</p>
        ) : null}
        {children ? <div className="md3-dialog-body">{children}</div> : null}
        <div className="md3-dialog-actions">
          {/*
            Dismiss first in the DOM and last visually is the usual arrangement,
            and it is wrong for a keyboard: the first thing tabbed to should be
            the way out, and the confirming action should not be reachable by
            pressing Enter on arrival. So dismiss is first in both.
          */}
          {dismiss}
          {actions}
        </div>
      </Surface>
    </div>
  )
}
