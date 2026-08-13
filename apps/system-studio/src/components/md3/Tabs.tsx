import Link from "next/link"
import type { ReactNode } from "react"

/**
 * A row of tabs whose state is the URL.
 *
 * ## These are links, and they are not an ARIA tablist
 *
 * That is a decision, not an omission. An ARIA `tablist` promises a screen
 * reader that the tabs switch panels IN PLACE: arrow keys move between tabs
 * without activating them, the selected tab controls a `tabpanel` that is
 * already in the document, and nothing navigates. This console renders on the
 * server and its panels come from a request, so pressing one of these loads a
 * document. Claiming `role="tab"` over that behaviour tells assistive technology
 * something untrue and breaks the arrow-key contract it just promised.
 *
 * So this is a `<nav>` of links with `aria-current="page"` on the active one —
 * which is exactly what it is — and the visual language is Material's primary
 * tabs. The benefits of the URL being the state are the ones this console
 * already relies on elsewhere (`fleet-filter.ts` turns a filter into a query
 * string so a filtered view is a link somebody can send): a tab is
 * bookmarkable, shareable, survives a reload, and works with the back button.
 *
 * A route needing genuine in-place tabs needs client state, and that is a
 * different component with a `"use client"` directive at the top — not a prop on
 * this one.
 *
 * ## The indicator is not the only signal
 *
 * The selected tab gets Material's indicator AND a weight change AND
 * `aria-current`. Bible §26.3.2: meaning may not be carried by colour alone, and
 * a 2px underline in a desaturated palette is close enough to "colour alone" to
 * count.
 *
 * ## At 320 CSS pixels
 *
 * The row scrolls horizontally INSIDE itself rather than wrapping the page —
 * `layout.spec.ts` treats a horizontally scrolling page as a defect at every one
 * of its four widths. Material's own tabs scroll; the important part is that the
 * scroll is the strip's and not the document's.
 */

export interface TabItem {
  /** Stable and unique in the row. The React key, and not the label. */
  key: string
  label: ReactNode
  /** Where the tab goes. A real URL: this is a link, so it is one. */
  href: string
  /**
   * A count or a short status beside the label — "12", "3 overdue".
   *
   * Rendered inside the same link, after the label, so a screen reader reads
   * "Alarms 12" as one accessible name rather than announcing a stray number.
   */
  badge?: ReactNode
}

export interface TabsProps {
  /**
   * Required. A page can have more than one tab row — a configurator with an
   * environment strip above a section strip — and "navigation" repeated twice
   * with no name is two landmarks nobody can tell apart.
   */
  ariaLabel: string
  items: readonly TabItem[]
  /** The `key` of the tab that is current. */
  selected: string
  id?: string
}

export function Tabs({ ariaLabel, items, selected, id }: TabsProps) {
  return (
    <nav className="md3-tabs" aria-label={ariaLabel} id={id}>
      {items.map((item) => {
        const current = item.key === selected
        return (
          <Link
            key={item.key}
            href={item.href}
            className="md3-tab md3-state md3-title-small"
            data-selected={current ? "true" : "false"}
            // `page`, not `true`: these navigate, and `aria-current="page"` is
            // the value that means "this link is the document you are on".
            {...(current ? { "aria-current": "page" as const } : {})}
          >
            <span className="md3-tab-label">{item.label}</span>
            {item.badge ? <span className="md3-tab-badge md3-label-small">{item.badge}</span> : null}
          </Link>
        )
      })}
    </nav>
  )
}
