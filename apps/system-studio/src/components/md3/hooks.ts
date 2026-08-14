"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { FOCUSABLE_SELECTOR, isDismiss, nextTrapStop } from "./interaction"

/**
 * The three behaviours every overlay in this directory needs, written once.
 *
 * A menu, a popover, a drawer, a modal dialog and a combobox listbox differ in
 * what they contain and agree on almost everything else: Escape closes the
 * TOP-MOST one, a pointer landing outside dismisses, and closing puts focus
 * back where it was. Each of those is a documented failure mode rather than a
 * nicety —
 *
 *   * an Escape handler on `document` with no stack closes every open layer at
 *     once, so a confirm dialog opened from a drawer takes the drawer with it;
 *   * an overlay that does not restore focus drops a keyboard user on `<body>`,
 *     which means Escape costs them their position in a 400-row table
 *     (STUDIO-030-008 names focus loss by name);
 *   * a trap that reads its stops once cannot see a control that appeared after
 *     it mounted, and the control it cannot see is usually the submit button of
 *     the form the operator just filled in.
 *
 * ## Why a module-level stack, and why it is a stack
 *
 * Layer order is a property of the PAGE, not of any component, so it cannot
 * live in a component's state. It is an array of tokens: opening pushes,
 * closing splices, and a key handler acts only when its token is on top. Splice
 * rather than pop, because layers do not always close in order — a route change
 * can unmount the drawer under an open menu.
 *
 * ## What is deliberately not here
 *
 * No body-scroll lock. `document.body.style.overflow = "hidden"` collapses the
 * scrollbar, shifts the page under the overlay, and is the layout shift
 * STUDIO-030-008 forbids. `CommandPalette` reached the same conclusion; the
 * overlay covers the page instead.
 */

type LayerToken = { id: number }

let nextLayerId = 1
const stack: LayerToken[] = []

/** Test seam: the number of layers currently open. Nothing in the UI reads it. */
export function openLayerCount(): number {
  return stack.length
}

function pushLayer(token: LayerToken) {
  if (!stack.includes(token)) stack.push(token)
}

function removeLayer(token: LayerToken) {
  const at = stack.indexOf(token)
  if (at !== -1) stack.splice(at, 1)
}

function isTopLayer(token: LayerToken): boolean {
  return stack.length > 0 && stack[stack.length - 1] === token
}

export interface DismissableLayerOptions {
  open: boolean
  /** Called for Escape, for an outside pointer, and for focus leaving — never for a route change. */
  onDismiss: () => void
  /** The panel. Everything inside it is "inside". */
  panelRef: React.RefObject<HTMLElement | null>
  /** The control that opened it. Clicking it again is the trigger's business, not a dismissal. */
  triggerRef?: React.RefObject<HTMLElement | null>
  /** A non-modal layer closes when focus leaves it — a menu should, a dialog must not. */
  dismissOnFocusOut?: boolean
  /** A pointer outside closes it. True for menus and popovers, true for modal scrims too. */
  dismissOnOutsidePointer?: boolean
  /** Put focus back on close. The default, and the reason this hook exists. */
  restoreFocus?: boolean
}

export function useDismissableLayer({
  open,
  onDismiss,
  panelRef,
  triggerRef,
  dismissOnFocusOut = false,
  dismissOnOutsidePointer = true,
  restoreFocus = true,
}: DismissableLayerOptions) {
  const tokenRef = useRef<LayerToken>({ id: 0 })
  if (tokenRef.current.id === 0) tokenRef.current = { id: nextLayerId++ }
  /** Who had focus before this layer took it. */
  const returnTo = useRef<HTMLElement | null>(null)
  // The callback is read through a ref so that a caller passing an inline
  // arrow — which every caller does — does not tear down and rebuild the
  // document listeners on every render, losing the pointerdown that was in
  // flight.
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  /**
   * Whether closing should pull focus back to the trigger.
   *
   * True for Escape, true for an outside pointer (the operator is looking at
   * the page, and body is not a place to be), and FALSE when focus left of its
   * own accord — a Tab out of the last control has already put focus where the
   * operator asked for it, and yanking it back to the trigger is the console
   * fighting the keyboard.
   */
  const restoreOnClose = useRef(true)

  useEffect(() => {
    const token = tokenRef.current
    if (!open) return
    pushLayer(token)
    restoreOnClose.current = true
    if (restoreFocus) {
      const active = document.activeElement
      returnTo.current = active instanceof HTMLElement ? active : null
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isDismiss(event.key)) return
      if (!isTopLayer(token)) return
      // Stopping propagation is what makes the stack a stack: without it the
      // layer beneath also sees Escape and closes in the same keystroke.
      event.stopPropagation()
      event.preventDefault()
      dismissRef.current()
    }

    const contains = (node: EventTarget | null) => {
      if (!(node instanceof Node)) return false
      return !!panelRef.current?.contains(node) || !!triggerRef?.current?.contains(node)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!dismissOnOutsidePointer || !isTopLayer(token)) return
      if (contains(event.target)) return
      dismissRef.current()
    }

    const onFocusIn = (event: FocusEvent) => {
      if (!dismissOnFocusOut || !isTopLayer(token)) return
      if (contains(event.target)) return
      restoreOnClose.current = false
      dismissRef.current()
    }

    document.addEventListener("keydown", onKeyDown, true)
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("focusin", onFocusIn, true)
    return () => {
      document.removeEventListener("keydown", onKeyDown, true)
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("focusin", onFocusIn, true)
      removeLayer(token)
    }
  }, [open, panelRef, triggerRef, dismissOnFocusOut, dismissOnOutsidePointer, restoreFocus])

  useEffect(() => {
    if (open || !restoreFocus) return
    const target = restoreOnClose.current ? returnTo.current : null
    returnTo.current = null
    // Only if it is still in the document. Calling focus() on a detached node
    // does nothing at all while looking exactly like it worked.
    if (target && document.contains(target)) target.focus()
  }, [open, restoreFocus])
}

/**
 * A host node at the end of `<body>` for a MODAL layer, and the `inert` that
 * makes its modality true.
 *
 * ## Why a portal here and nowhere else
 *
 * `Popover` argues against portalling and is right to: moving a panel to the
 * end of the document destroys reading order. A modal has no reading order to
 * destroy — focus is trapped inside it and returns to the trigger on close — and
 * it needs the one thing an inline panel cannot have, which is a page it can
 * mark inert.
 *
 * ## `aria-modal` is only true if the rest is actually inert
 *
 * `Dialog.tsx` refuses `aria-modal` precisely because it cannot make the
 * background unreachable, and it is right about its own case. This hook is what
 * earns the attribute: every other child of `<body>` gets the `inert` attribute
 * while the layer is open, which removes it from the tab order, from the
 * accessibility tree and from pointer events in every browser that ships inert
 * (Chrome 102+, Safari 15.5+, Firefox 112+). The attribute is set rather than
 * the property, so it is visible in the DOM and a test can assert it.
 *
 * Elements that were ALREADY inert are recorded and left alone on the way out.
 * Restoring blindly is how a page that was inert for another reason quietly
 * becomes interactive again.
 */
export function useModalHost(active: boolean): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!active) {
      setHost(null)
      return
    }
    const node = document.createElement("div")
    node.setAttribute("data-md3", "modal-host")
    document.body.append(node)
    setHost(node)

    const madeInert: Element[] = []
    for (const child of [...document.body.children]) {
      if (child === node) continue
      if (child.hasAttribute("inert")) continue
      child.setAttribute("inert", "")
      madeInert.push(child)
    }

    return () => {
      for (const child of madeInert) child.removeAttribute("inert")
      node.remove()
      setHost(null)
    }
  }, [active])

  return host
}

/**
 * Keep Tab inside a container while it is open.
 *
 * The stops are read at the moment Tab is pressed rather than when the trap
 * mounts, because a dialog whose content changes — a form that reveals a
 * confirmation field, a list that finishes loading — would otherwise trap
 * against a stale list and skip the control that appeared.
 *
 * When there is nothing focusable inside, focus goes to the container itself
 * (which the caller must give `tabIndex={-1}`), because the alternative is Tab
 * escaping to the page behind a modal that has told a screen reader the page is
 * not there.
 */
export function useFocusTrap(
  active: boolean,
  containerRef: React.RefObject<HTMLElement | null>,
  initialFocusRef?: React.RefObject<HTMLElement | null>,
) {
  const stops = useCallback((): HTMLElement[] => {
    const container = containerRef.current
    if (!container) return []
    return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((element) => {
      // A hidden stop is a Tab that appears to do nothing. `offsetParent` is
      // the usual test and it is wrong twice: it is null for every element
      // inside a `position: fixed` ancestor in some engines, and null for
      // everything in a DOM with no layout — which is what the component test
      // runs in, so the trap would test as broken while working in a browser.
      if (element.hasAttribute("hidden")) return false
      const style = element.ownerDocument.defaultView?.getComputedStyle(element)
      return !style || (style.display !== "none" && style.visibility !== "hidden")
    })
  }, [containerRef])

  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    const wanted = initialFocusRef?.current ?? stops()[0] ?? container
    // A frame later: the panel is in the DOM but may not be laid out yet, and
    // focusing an element with no box is a focus that silently lands on body.
    const raf = requestAnimationFrame(() => wanted.focus())

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return
      const list = stops()
      if (list.length === 0) {
        event.preventDefault()
        container.focus()
        return
      }
      const current = list.indexOf(document.activeElement as HTMLElement)
      const next = nextTrapStop(list.length, current, event.shiftKey)
      // Only intervene at the ends. Letting the browser move focus in the
      // middle keeps its own order — which is the reading order, and which a
      // manual implementation gets wrong the first time a control is moved.
      const atEdge =
        current === -1 ||
        (event.shiftKey && current === 0) ||
        (!event.shiftKey && current === list.length - 1)
      if (!atEdge) return
      event.preventDefault()
      list[next]?.focus()
    }

    container.addEventListener("keydown", onKeyDown)
    return () => {
      cancelAnimationFrame(raf)
      container.removeEventListener("keydown", onKeyDown)
    }
  }, [active, containerRef, initialFocusRef, stops])
}
