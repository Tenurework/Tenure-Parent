"use client"

import { useEffect, useRef, type ReactNode } from "react"

/**
 * The refusal, announced.
 *
 * ## Why a live region is not enough here
 *
 * `role="alert"` announces content that ARRIVES in a region the reader is
 * already watching. A refused sign-in is not that: the action redirects, the
 * browser loads a whole new document, and the alert is present in the very
 * first paint. Nothing arrived, so nothing is announced — a screen-reader user
 * presses the button, the page reloads, and unless they happen to read back up
 * to the top they are never told why they are looking at the form again.
 *
 * So this moves FOCUS instead. Focus is what a new document resets, and a
 * programmatic focus after load is announced by every screen reader because the
 * user's own position changed. It lands on the message, and the message sits
 * immediately before the form, so the next Tab is the email field — which is
 * also the correct place to be after a refusal for somebody with no screen
 * reader at all.
 *
 * `tabIndex={-1}` makes the container focusable without adding a tab stop; the
 * outline is drawn on `:focus-visible` only, so a mouse user does not see a
 * focus ring appear on a paragraph they never touched.
 *
 * ## Why this is a client component and what it is given
 *
 * `element.focus()` is a browser call. Its props are a rendered message and a
 * boolean; it reads no environment and receives no configuration, so it adds
 * nothing to the client payload beyond the sentence already visible on screen.
 */

export interface AnnounceProps {
  /**
   * Whether to take focus. False for a state that is a CONDITION rather than an
   * event — the degraded-path notice is true on every load, and stealing focus
   * for it on every load would make the page hostile.
   */
  takeFocus: boolean
  className?: string
  /**
   * The state's name, put on the DOM as `data-state`.
   *
   * A test asserts the STATE rather than the sentence, so rewording a message
   * does not silently turn an assertion into one that passes for the wrong
   * reason — and so a state can be asserted ABSENT, which no sentence can.
   */
  dataState?: string
  children: ReactNode
}

export function Announce({ takeFocus, className, dataState, children }: AnnounceProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!takeFocus) return
    ref.current?.focus()
  }, [takeFocus])

  return (
    <div
      ref={ref}
      className={className}
      data-state={dataState}
      tabIndex={takeFocus ? -1 : undefined}
      /*
       * `alert` for the events, `status` for the conditions. Both are live
       * regions, so a message that changes without a navigation — which is what
       * happens when the network drops while the form is open — is still
       * spoken.
       */
      role={takeFocus ? "alert" : "status"}
    >
      {children}
    </div>
  )
}
