import type { ReactNode } from "react"

import { StaleIndicator } from "./StaleIndicator"

/**
 * A definition list: "fact — value — as of T".
 *
 * The shape nearly every AWS panel in this console is. A cluster's ARN, a
 * queue's depth, the resolved partition, the number of days a certificate has
 * left: each is one term, one value, and one timestamp, and before this each
 * surface built that row itself out of a `<dl>`, a `<div>` or a two-column
 * table depending on who wrote it.
 *
 * ## Why a `<dl>` and not a table
 *
 * These are name/value pairs about ONE subject, not rows of one kind of thing.
 * A table of two columns announces "column 1 of 2, row 4 of 9" to a screen
 * reader, which is a navigational structure over what is really a paragraph of
 * facts; a description list announces the term and then its description. The
 * `<dl>` is also what lets the pair collapse to one column at 320 CSS pixels
 * without the value column being squeezed to zero width first — the failure
 * `.kv` in `globals.css` records having met with `minmax(0, max-content)`.
 *
 * ## `asOf` is per item, not per list
 *
 * Because it is per READ, and one panel routinely shows facts from several
 * capabilities with different cadences: an ECS service count refreshed every
 * fifteen seconds beside an ACM inventory refreshed hourly. A single
 * list-level timestamp would have to be the oldest of them to be honest, which
 * would make the fast-moving figure look stale, or the newest, which would be a
 * claim about the slow one that is not true.
 *
 * The timestamp is rendered by `StaleIndicator`, so the "is this still allowed
 * to be the answer" arithmetic exists once and every panel gets the same verdict
 * for the same age.
 *
 * ## What this is NOT for
 *
 * A value that could not be read. `UnknownState` is that, and it is a different
 * component on purpose: a `<dd>` reading "—" beside a term is exactly the
 * "denied renders as absent" defect STUDIO-000-007 exists to end. Give a
 * `KeyValue` only facts that were actually read.
 */

export interface KeyValueItem {
  /** Stable, unique within the list, and the React key. Not the term text. */
  key: string
  /** The fact's name, in the operator's language rather than the API's. */
  term: ReactNode
  /**
   * The fact.
   *
   * Long AWS identifiers are expected here; `.md3-kv-value` sets
   * `overflow-wrap: anywhere`, so an ARN wraps inside the column rather than
   * setting the column's minimum width and pushing the panel past the viewport
   * at 320 CSS pixels (WCAG 2.2 AA 1.4.10 reflow).
   */
  value: ReactNode
  /**
   * When this particular fact was read, and how often its capability allows it
   * to be re-read.
   *
   * Both or neither. `cadenceMs` is `CAPABILITIES[capability].refreshMs`; a
   * timestamp without its cadence is a number a reader cannot judge.
   */
  asOf?: { at: string; cadenceMs: number; now?: number }
}

export interface KeyValueProps {
  items: readonly KeyValueItem[]
  /**
   * Names the list for anything reading the page out.
   *
   * Optional because a `KeyValue` inside a `Card` is already named by the
   * card's headline, and a second name read immediately after the first is
   * noise. Supply it when the list stands alone.
   */
  ariaLabel?: string
  id?: string
}

export function KeyValue({ items, ariaLabel, id }: KeyValueProps) {
  return (
    <dl className="md3-kv" aria-label={ariaLabel} id={id}>
      {items.map((item) => (
        /*
         * `<div>` wrapping each pair. HTML has permitted this since the living
         * standard adopted it, and it is what makes one pair a grid item rather
         * than the `<dt>` and the `<dd>` being two independent items that can be
         * split across a column break — which at 320 CSS pixels put a term at
         * the bottom of one column and its value at the top of the next.
         */
        <div className="md3-kv-row" key={item.key}>
          <dt className="md3-kv-term md3-label-medium">{item.term}</dt>
          <dd className="md3-kv-value md3-body-medium">
            {item.value}
            {item.asOf ? (
              <span className="md3-kv-note">
                <StaleIndicator
                  asOf={item.asOf.at}
                  cadenceMs={item.asOf.cadenceMs}
                  now={item.asOf.now}
                />
              </span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}
