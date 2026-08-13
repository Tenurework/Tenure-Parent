import type { ReactNode } from "react"

/**
 * A finding's severity, in the vocabulary AWS actually returns.
 *
 * ## The words are Security Hub's
 *
 * `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFORMATIONAL` — the five labels of
 * `securityhub:GetFindings`, in that order, because a console that renames the
 * levels it is displaying forces every operator to hold a translation table
 * while comparing this screen against the AWS one. `SEVERITIES` is exported in
 * descending order so a page can iterate it without inventing a sort.
 *
 * ## The tone comes from a family, never from a colour
 *
 * There is no red here and no green. `critical` and `high` are the ERROR family,
 * `medium` is the warning family, `low` is the TERTIARY family — the one this
 * console uses for "a fact that is neither good nor bad" — and `informational`
 * has no status family at all. Every one of those is a `--md-sys-color-*` role
 * that the contrast audit measures in four theme/contrast combinations; a hex
 * code in this file would be a pair the audit does not know exists.
 *
 * Two levels sharing a family is deliberate and is why the border matters:
 * `critical` is the filled error, `high` is the error CONTAINER, and they are
 * distinguishable by fill, by border and — decisively — by the word, which is
 * always rendered. Bible §26.3.2 forbids meaning carried by colour alone, and a
 * severity scale is the single most common place a product breaks that rule.
 *
 * ## The word is always drawn
 *
 * `children` is the detail — a count, a control id, a finding title — and it
 * never replaces the severity word. A chip reading "14" in a slightly redder
 * pill than the one next to it is a chip nobody can read, in a palette
 * deliberately too quiet to carry the difference.
 */

export const SEVERITIES = ["critical", "high", "medium", "low", "informational"] as const

export type Severity = (typeof SEVERITIES)[number]

/** The word, as Security Hub spells it. Uppercased by the stylesheet, not here. */
const WORD: Readonly<Record<Severity, string>> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  informational: "Informational",
}

export interface SeverityChipProps {
  severity: Severity
  /** The detail beside the word — a count, a control id. Never instead of it. */
  children?: ReactNode
  /**
   * What this severity means here, for a reader meeting the word without its
   * column heading. Rendered as `title` and as the accessible description.
   */
  title?: string
  id?: string
}

export function SeverityChip({ severity, children, title, id }: SeverityChipProps) {
  return (
    <span className="md3-severity" data-severity={severity} title={title} id={id}>
      <span className="md3-severity-word md3-label-small">{WORD[severity]}</span>
      {children ? <span className="md3-severity-detail md3-label-large">{children}</span> : null}
    </span>
  )
}
