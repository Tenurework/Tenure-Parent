import type { ReactNode } from "react"

import { Surface } from "./Surface"

/**
 * The outcome of something the operator just did, on the inverse surface.
 *
 * ## It does not disappear
 *
 * Material's snackbar auto-dismisses after four to ten seconds. This one has no
 * timer, and the reason is not that timers are hard. WCAG 2.2 AA 2.2.1 requires
 * that time limits be adjustable or extendable, and a message that removes
 * itself while an operator is reading the ARN inside it fails that outright — as
 * does one that vanishes while a screen reader is still on the previous
 * paragraph. In a control plane the message is often the only record on screen
 * that a mutation was accepted, which is the last thing that should evaporate.
 *
 * So it stays until the page navigates, and `dismiss` — a link or a submit
 * button — is how it goes. There is no `"use client"` directive here, so there
 * is nothing to dismiss it with in-place; that is the same trade `Dialog` makes,
 * and the same escape hatch applies (a client wrapper, if a route ever needs
 * one).
 *
 * ## `role="status"`, and why not `alert`
 *
 * `status` is polite: it is announced when the screen reader finishes what it is
 * saying. `alert` interrupts, and interrupting is right for "your session is
 * about to expire" and wrong for "the tenant moved to PROVISIONING". A surface
 * with something genuinely urgent should say so in words in the message, which
 * is readable by everyone, rather than by choosing a louder ARIA role, which is
 * readable by nobody who is looking at the screen.
 *
 * ## The inverse surface, and why the action colour has to invert with it
 *
 * The snackbar reads as NOT part of the page, which is what `inverse-surface` is
 * for. `globals.css` re-points a text button's colour inside an inverse surface
 * to `inverse-primary`, because `primary` on `inverse-surface` measures 1.4:1 in
 * the light theme — an action that is legible in dark and invisible in light is
 * the failure mode of every inverse surface shipped without that rule.
 */

export interface SnackbarProps {
  /**
   * What happened, in one sentence, in the past tense.
   *
   * Required and a string rather than a node: a snackbar is a sentence, and the
   * moment it can hold arbitrary markup somebody puts a table in it.
   */
  message: string
  /**
   * One action, at most — "Undo", "View the tenant".
   *
   * Material allows one and so does this. Two actions in a transient strip is a
   * dialog that has been drawn in the wrong place.
   */
  action?: ReactNode
  /** How it goes away. A link or a submit button; there is no timer. */
  dismiss?: ReactNode
  id?: string
}

export function Snackbar({ message, action, dismiss, id }: SnackbarProps) {
  return (
    <Surface
      as="aside"
      container="inverse"
      level={3}
      shape="extra-small"
      className="md3-snackbar"
      id={id}
      role="status"
    >
      <p className="md3-snackbar-message md3-body-medium">{message}</p>
      {action || dismiss ? (
        <div className="md3-snackbar-actions">
          {action}
          {dismiss}
        </div>
      ) : null}
    </Surface>
  )
}
