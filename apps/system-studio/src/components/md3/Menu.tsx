"use client"

import Link from "next/link"
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react"

import "./primitives.css"
import { Surface } from "./Surface"
import { useDismissableLayer } from "./hooks"
import {
  firstEnabled,
  isTypeaheadKey,
  lastEnabled,
  listCommand,
  typeaheadBuffer,
  typeaheadIndex,
  type Direction,
  type ListState,
} from "./interaction"
import type { ButtonTone, ButtonVariant } from "./Button"

/**
 * A list of actions or destinations behind a button: the account menu, a row's
 * overflow actions, an environment switcher.
 *
 * ## The keyboard model, in full, because this is the one people ship broken
 *
 * On the trigger — Enter, Space and ArrowDown open it with the FIRST item
 * focused; ArrowUp opens it with the LAST. (Opening on ArrowUp at the top of
 * the list is the bug that makes a keyboard user press ArrowUp nine more times.)
 *
 * Inside — ArrowDown and ArrowUp move and WRAP, Home and End go to the ends,
 * printable characters type-ahead (and repeating one character cycles through
 * the items that start with it), Enter and Space activate, Escape closes and
 * returns focus to the trigger, and Tab closes and lets focus continue to the
 * next control on the page rather than being dragged back.
 *
 * Disabled items are rendered, announced and skipped by every one of those
 * movements. They are not removed: an action that is unavailable is information,
 * and an operator hunting for "Purge" needs to be told it is unavailable rather
 * than left to conclude the console has lost it.
 *
 * Every one of those decisions is `interaction.ts` — this file is the adapter
 * that turns the returned command into focus and state, which is why the rules
 * can be enumerated in a node spec and only the wiring needs a DOM.
 *
 * ## Focus is roving, not `aria-activedescendant`
 *
 * The focused item is the one with `tabIndex={0}` and real DOM focus; the rest
 * are `-1`. Real focus is what makes the browser scroll the item into view, what
 * makes a magnifier follow, and what makes `:focus-visible` draw the ring the
 * console's contrast audit measures. `aria-activedescendant` is correct for a
 * combobox, where focus must stay in the text field; it is second best here.
 *
 * ## Groups, not nested submenus
 *
 * A menu may carry labelled groups (`role="group"` with a heading), which is how
 * "Signed in as…", "Preferences" and "Sign out" sit in one account menu without
 * a separator carrying the meaning. It does NOT do nested submenus, and that is
 * an honest gap rather than an oversight: a submenu needs its own hover-intent
 * timing, its own ArrowRight/ArrowLeft ownership, and a second layer in the
 * dismissal stack, and a half-built one is a menu that opens on hover and cannot
 * be reached from a keyboard at all. Sub-levels in the console's navigation are
 * `Tree` and `Accordion`, which are built here and do have their keyboard model.
 */

export interface MenuItem {
  key: string
  /**
   * A string, not a node.
   *
   * Type-ahead matches on it, the accessible name is it, and both of those stop
   * being true the moment an item is allowed to be arbitrary markup. A count or
   * a shortcut goes in `hint`, which is rendered separately and read after it.
   */
  label: string
  /** Where it goes. Mutually exclusive with `onSelect` in practice; both is a bug in the caller. */
  href?: string
  onSelect?: () => void
  disabled?: boolean
  /** A keyboard shortcut or a count, read after the label. */
  hint?: string
  /** `danger` for the irreversible ones. STUDIO-030-004 also wants them spatially apart — put them in their own group. */
  tone?: "neutral" | "danger"
  /** One line under the label: what the action does, or which account it targets. */
  detail?: string
}

export interface MenuGroup {
  key: string
  /** Rendered as a heading and referenced by the group's `aria-labelledby`. */
  label?: string
  items: readonly MenuItem[]
}

export interface MenuProps {
  /** The accessible name of the MENU. "Account", "Row actions for tenant westfield". */
  label: string
  trigger: ReactNode
  triggerVariant?: ButtonVariant
  triggerTone?: ButtonTone
  groups: readonly MenuGroup[]
  align?: "start" | "end"
  id?: string
  dir?: Direction
  onOpenChange?: (open: boolean) => void
}

export function Menu({
  label,
  trigger,
  triggerVariant = "outlined",
  triggerTone = "neutral",
  groups,
  align = "start",
  id,
  dir = "ltr",
  onOpenChange,
}: MenuProps) {
  const generatedId = useId()
  const baseId = id ?? generatedId
  const menuId = `${baseId}-menu`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<(HTMLElement | null)[]>([])
  const typed = useRef({ buffer: "", at: 0 })

  const items = groups.flatMap((group) => group.items)
  const state: ListState = {
    index: active,
    count: items.length,
    disabled: items.flatMap((item, index) => (item.disabled ? [index] : [])),
    loop: true,
    dir,
  }

  const change = useCallback(
    (next: boolean) => {
      setOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange],
  )

  const close = useCallback(() => {
    change(false)
    setActive(-1)
  }, [change])

  useDismissableLayer({ open, onDismiss: close, panelRef, triggerRef, dismissOnFocusOut: true })

  // Focus follows the active index. In an effect rather than in the key
  // handler, because the item that must receive focus may not be in the
  // document yet on the render that opened the menu.
  useEffect(() => {
    if (!open || active < 0) return
    itemRefs.current[active]?.focus()
  }, [open, active])

  const openAt = (index: number) => {
    change(true)
    setActive(index)
  }

  const select = (item: MenuItem) => {
    if (item.disabled) return
    // Close FIRST so that focus restoration happens before whatever the action
    // does with focus — a handler that opens a dialog must not have the menu's
    // restoration land on top of it a tick later.
    close()
    item.onSelect?.()
  }

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      openAt(firstEnabled(state))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      openAt(lastEnabled(state))
    }
    // Enter and Space are left alone: this is a <button>, and the browser's own
    // activation fires onClick. Handling them here would open the menu twice.
  }

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Tab") {
      // No preventDefault. Focus continues to the next control on the page and
      // the layer's focus-out rule closes the menu behind it.
      close()
      return
    }
    const command = listCommand(event.key, state)
    if (command.type === "move") {
      event.preventDefault()
      if (command.index >= 0) setActive(command.index)
      return
    }
    if (command.type === "dismiss") {
      // The layer's document handler also sees Escape; this one only stops the
      // key reaching a parent widget. Both call the same close.
      event.preventDefault()
      close()
      return
    }
    if (command.type === "activate") {
      const item = items[active]
      if (!item) return
      // A link item is a real anchor: let Enter follow it rather than
      // synthesising a click, so modified clicks and the browser's own
      // behaviour keep working. Space never scrolls a menu.
      if (item.href && event.key === "Enter") {
        close()
        return
      }
      event.preventDefault()
      select(item)
      return
    }
    if (isTypeaheadKey(event.key)) {
      const now = Date.now()
      const buffer = typeaheadBuffer(typed.current.buffer, event.key, now - typed.current.at)
      typed.current = { buffer, at: now }
      const found = typeaheadIndex(
        items.map((item) => item.label),
        buffer,
        active,
        state.disabled,
      )
      if (found >= 0) {
        event.preventDefault()
        setActive(found)
      }
    }
  }

  let flatIndex = -1

  return (
    <div data-md3="anchor">
      <button
        ref={triggerRef}
        type="button"
        className="md3-button md3-state"
        data-variant={triggerVariant}
        data-tone={triggerTone}
        aria-haspopup="menu"
        aria-expanded={open}
        {...(open ? { "aria-controls": menuId } : {})}
        onClick={() => (open ? close() : openAt(firstEnabled(state)))}
        onKeyDown={onTriggerKeyDown}
      >
        {trigger}
      </button>
      {open ? (
        <div data-md3="popover" data-align={align} ref={panelRef}>
          <Surface container="high" level={2} shape="medium" outlined data-md3="popover-panel">
            {/*
              `onKeyDown` sits on the menu rather than on each item: the event
              bubbles from whichever item has focus, so there is one handler and
              one place where the model is consulted.
            */}
            <div
              id={menuId}
              role="menu"
              aria-label={label}
              aria-orientation="vertical"
              data-md3="menu"
              onKeyDown={onMenuKeyDown}
            >
              {groups.map((group) => {
                const labelId = `${baseId}-${group.key}-label`
                return (
                  <div
                    key={group.key}
                    role="group"
                    data-md3="menu-group"
                    {...(group.label ? { "aria-labelledby": labelId } : {})}
                  >
                    {group.label ? (
                      <p
                        id={labelId}
                        data-md3="menu-group-label"
                        className="md3-label-small"
                        // Presentational to the menu's own structure: a menu's
                        // children are menuitems, and a stray paragraph inside
                        // it is announced as one more thing to step over. The
                        // group still gets the name through aria-labelledby.
                        role="presentation"
                      >
                        {group.label}
                      </p>
                    ) : null}
                    {group.items.map((item) => {
                      flatIndex += 1
                      const index = flatIndex
                      const shared = {
                        role: "menuitem" as const,
                        "data-md3": "menu-item",
                        "data-tone": item.tone ?? "neutral",
                        className: "md3-state md3-body-medium",
                        // Roving tabindex: exactly one stop for the whole menu.
                        tabIndex: index === active ? 0 : -1,
                        ref: (node: HTMLElement | null) => {
                          itemRefs.current[index] = node
                        },
                        onMouseEnter: () => {
                          if (!item.disabled) setActive(index)
                        },
                      }
                      const body = (
                        <>
                          <span data-md3="menu-item-label">{item.label}</span>
                          {item.detail ? (
                            <span data-md3="menu-item-detail" className="md3-body-small">
                              {item.detail}
                            </span>
                          ) : null}
                          {item.hint ? (
                            <span data-md3="menu-hint" className="md3-label-small">
                              {item.hint}
                            </span>
                          ) : null}
                        </>
                      )
                      if (item.href && !item.disabled) {
                        return (
                          <Link key={item.key} {...shared} href={item.href} onClick={() => close()}>
                            {body}
                          </Link>
                        )
                      }
                      return (
                        <button
                          key={item.key}
                          {...shared}
                          type="button"
                          // `aria-disabled`, not `disabled`. A disabled button is
                          // removed from the accessibility tree by some
                          // combinations, and an action an operator cannot find
                          // is indistinguishable from one the console never had.
                          aria-disabled={item.disabled ? true : undefined}
                          onClick={() => select(item)}
                        >
                          {body}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </Surface>
        </div>
      ) : null}
    </div>
  )
}
