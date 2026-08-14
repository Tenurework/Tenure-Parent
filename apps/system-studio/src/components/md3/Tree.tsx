"use client"

import Link from "next/link"
import { useEffect, useId, useRef, useState } from "react"

import "./primitives.css"
import {
  isTypeaheadKey,
  treeCommand,
  treeRows,
  typeaheadBuffer,
  typeaheadIndex,
  type Direction,
  type TreeNode,
} from "./interaction"

/**
 * A hierarchy that can be walked from a keyboard: the navigation's sub-levels,
 * an account's resource graph, a blueprint's inheritance chain.
 *
 * ## What a tree owes a screen reader, and what it usually withholds
 *
 * `role="tree"` with `role="treeitem"` children is the easy half. The half that
 * decides whether the widget is usable is `aria-level`, `aria-setsize` and
 * `aria-posinset` — "3 of 7, level 2" — because without them a non-sighted
 * operator hears a flat list of names with no idea which belong to which. They
 * are computed in `treeRows` rather than written by hand at each node, so they
 * cannot be forgotten on the branch nobody screenshots.
 *
 * ## One tab stop, and the arrows do the rest
 *
 * A tree with two hundred nodes and two hundred tab stops is a tree nobody tabs
 * past. Exactly one item carries `tabIndex={0}`, arrows move real focus, and the
 * whole widget is one stop in the page's tab order.
 *
 * The movement rules are `treeCommand`, including the two that are usually
 * missing: ArrowRight on an already-expanded node steps to its first child, and
 * ArrowLeft on a collapsed node steps to its PARENT. Without the second, a
 * keyboard user who descends four levels has no way back up but Home. `*`
 * expands every sibling at the current level. Direction-aware, so in a
 * right-to-left document the keys swap.
 *
 * ## Type-ahead
 *
 * A printable character jumps to the next visible node starting with it, and
 * repeating one character cycles through them — the same model the menu uses,
 * because an operator should not have to learn two.
 *
 * ## Expansion state may be the caller's
 *
 * `expanded` and `onExpandedChange` hand it over, which is what a navigation
 * needs when the open branch is derived from the current route rather than from
 * what was clicked.
 */

export interface TreeProps {
  /** Names the tree. Required — "Deployment topology", "Navigation". */
  label: string
  nodes: readonly TreeNode[]
  /** Controlled expansion. Omit for a self-managing tree. */
  expanded?: ReadonlySet<string>
  onExpandedChange?: (expanded: ReadonlySet<string>) => void
  defaultExpanded?: readonly string[]
  /** Run when a node is activated by Enter, Space or click. Links navigate instead. */
  onActivate?: (id: string) => void
  /** The id of the node that is the current one — a route, a selection. */
  selectedId?: string
  dir?: Direction
  id?: string
}

export function Tree({
  label,
  nodes,
  expanded: controlledExpanded,
  onExpandedChange,
  defaultExpanded = [],
  onActivate,
  selectedId,
  dir = "ltr",
  id,
}: TreeProps) {
  const generatedId = useId()
  const baseId = id ?? generatedId
  const [uncontrolled, setUncontrolled] = useState<ReadonlySet<string>>(
    () => new Set(defaultExpanded),
  )
  const expanded = controlledExpanded ?? uncontrolled
  const rows = treeRows(nodes, expanded)
  const [active, setActive] = useState(0)
  const itemRefs = useRef<(HTMLElement | null)[]>([])
  const anchorRefs = useRef<(HTMLAnchorElement | null)[]>([])
  const typed = useRef({ buffer: "", at: 0 })
  const moved = useRef(false)

  const setExpanded = (next: ReadonlySet<string>) => {
    if (controlledExpanded === undefined) setUncontrolled(next)
    onExpandedChange?.(next)
  }

  const withExpansion = (ids: readonly string[], open: boolean) => {
    const next = new Set(expanded)
    for (const id of ids) {
      if (open) next.add(id)
      else next.delete(id)
    }
    setExpanded(next)
  }

  // Focus follows the active row, but ONLY after a key moved it. Focusing on
  // every render would steal focus from the page when a parent re-renders,
  // which is the bug that makes a tree impossible to tab away from.
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    itemRefs.current[active]?.focus()
  }, [active])

  // A collapse can leave the active index past the end of the visible rows.
  const clamped = Math.min(active, Math.max(rows.length - 1, 0))

  const onKeyDown = (event: React.KeyboardEvent) => {
    const command = treeCommand(event.key, rows, clamped, dir)
    if (command.type === "none") {
      if (!isTypeaheadKey(event.key)) return
      const now = Date.now()
      const buffer = typeaheadBuffer(typed.current.buffer, event.key, now - typed.current.at)
      typed.current = { buffer, at: now }
      const found = typeaheadIndex(
        rows.map((row) => row.label),
        buffer,
        clamped,
        rows.flatMap((row, index) => (row.disabled ? [index] : [])),
      )
      if (found >= 0) {
        event.preventDefault()
        moved.current = true
        setActive(found)
      }
      return
    }
    event.preventDefault()
    if (command.type === "move") {
      moved.current = true
      setActive(command.index)
    } else if (command.type === "expand") {
      withExpansion([command.id], true)
    } else if (command.type === "collapse") {
      withExpansion([command.id], false)
    } else if (command.type === "expandSiblings") {
      withExpansion(command.ids, true)
    } else if (command.type === "activate") {
      // A branch toggles, a leaf activates, and a leaf with a destination
      // follows it through the anchor rather than through the router — so the
      // navigation is the same one a click performs.
      const row = rows[clamped]
      if (row?.hasChildren) withExpansion([row.id], !row.expanded)
      else if (row?.href) anchorRefs.current[clamped]?.click()
      onActivate?.(command.id)
    }
  }

  return (
    <ul
      id={baseId}
      role="tree"
      aria-label={label}
      data-md3="tree"
      onKeyDown={onKeyDown}
    >
      {rows.map((row, index) => {
        const isActive = index === clamped
        return (
          <li
            key={row.id}
            role="treeitem"
            data-md3="tree-item"
            data-level={row.level}
            className="md3-state md3-body-medium"
            /*
             * The tab stop is the TREEITEM, not something inside it. Focus on a
             * child span would land a screen reader on an element with no role
             * and no level, which is the whole announcement.
             */
            tabIndex={isActive ? 0 : -1}
            ref={(node) => {
              itemRefs.current[index] = node
            }}
            onClick={() => {
              setActive(index)
              if (row.hasChildren) withExpansion([row.id], !row.expanded)
              if (!row.disabled) onActivate?.(row.id)
            }}
            aria-level={row.level}
            aria-setsize={row.setsize}
            aria-posinset={row.posinset}
            // Only branches carry aria-expanded. On a leaf it is a promise of
            // children that do not exist.
            {...(row.hasChildren ? { "aria-expanded": row.expanded } : {})}
            {...(selectedId ? { "aria-selected": row.id === selectedId } : {})}
            {...(row.disabled ? { "aria-disabled": true } : {})}
          >
            <span data-md3="tree-row">
              {row.hasChildren ? (
                // The twisty is decorative and NOT a second tab stop: the row
                // is one focusable thing, and expansion is ArrowRight/ArrowLeft
                // or a click. A separate focusable twisty doubles the tab stops
                // of the whole tree.
                <span
                  data-md3="tree-twisty"
                  aria-hidden="true"
                  onClick={() => withExpansion([row.id], !row.expanded)}
                />
              ) : (
                <span data-md3="tree-twisty" data-leaf="true" aria-hidden="true" />
              )}
              {row.href && !row.disabled ? (
                /*
                 * A real anchor, so middle-click, copy-link-address and
                 * open-in-new-tab work — and `tabIndex={-1}`, so it is not a
                 * second tab stop inside a widget whose whole design is that it
                 * has one. Enter on the item clicks it (see `activate` above).
                 */
                <Link
                  href={row.href}
                  data-md3="tree-label"
                  tabIndex={-1}
                  ref={(node) => {
                    anchorRefs.current[index] = node
                  }}
                >
                  {row.label}
                </Link>
              ) : (
                <span data-md3="tree-label">{row.label}</span>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
