import type { ReactNode } from "react"

import { Card, Chip, Surface } from "@/components/md3"

import styles from "./cost.module.css"

/**
 * The answer an operator came to `/platform/cost` for, at the top of it.
 *
 * ## Why this is a component and not three lines in `page.tsx`
 *
 * Because the two arms of this page have to answer the SAME three questions,
 * and the previous layout let them answer different ones. When a Cost and Usage
 * Report is connected the page led with a four-row table of internal
 * accounting terms — actual, amortized, forecast, unallocated — and when none is
 * connected it led with an apparatus paragraph about allocation drivers. Neither
 * opening says what the fleet costs. This does, in the same three tiles, in both
 * states, and the second state fills all three with `Unknown`.
 *
 * ## `value: null` is the whole design
 *
 * A figure is a `string` that has been formatted at its own currency's
 * precision, or it is `null`. There is no zero, no dash and no placeholder, and
 * the component renders `null` as the word **Unknown** with the reason beside
 * it — never as `$0.00`. That is the one rule this page exists to hold: an empty
 * page is obviously empty, and `$0.00 spent this month` is a claim, a false one,
 * on the surface an Aurora cluster gets approved from.
 *
 * Making it `null` rather than an optional field is deliberate. An optional
 * `value?: string` is satisfied by a caller that simply forgets the key, and
 * `tsc` says nothing — so a figure that was never computed and a figure that is
 * genuinely not known would render identically. `null` has to be written down.
 *
 * ## The as-of is required, and may itself be unknown
 *
 * Every panel on this page states what it is as of. `asOf: null` renders "as of
 * — never read", which is the true answer while no bill has ever been ingested.
 * A panel with no timestamp at all is a panel whose reader has to guess, and the
 * guess is always "now".
 */
export interface CostFigure {
  /** What the figure is, in the operator's language. */
  label: string
  /**
   * The figure, already formatted at its own currency's precision — or `null`
   * when this engine does not know it. Never a zero standing in for a gap.
   */
  value: string | null
  /**
   * What the figure means when it is known, and plainly why it is not when it
   * is not. Required: "Unknown" with no reason is a defect report, not an
   * answer.
   */
  note: string
}

export interface CostAnswerProps {
  /** When the underlying data is current as of, or `null` if nothing was read. */
  asOf: string | null
  /** One line saying where these figures come from, or what stands in for them. */
  supportingText: ReactNode
  figures: readonly CostFigure[]
}

export function CostAnswer({ asOf, supportingText, figures }: CostAnswerProps) {
  return (
    <Card
      headline="What the fleet costs this month"
      supportingText={supportingText}
      /*
       * A Chip rather than a Badge, and the reason is measurable: `.md3-badge`
       * is `white-space: nowrap` because a status is one word, and an ISO
       * timestamp in one would run past the card at the 320 CSS pixels
       * `layout.spec.ts` measures. `.md3-chip` carries `overflow-wrap: anywhere`
       * and `max-inline-size: 100%`. A timestamp is a value, which is what a
       * chip is for; "not configured" is a status, which is what a badge is for.
       */
      headerAside={<Chip>{asOf === null ? "as of — never read" : `as of ${asOf}`}</Chip>}
    >
      <div className={styles.answers}>
        {figures.map((figure) => (
          <Surface
            key={figure.label}
            as="div"
            /*
             * A step above the card it sits in, so the three answers read as
             * three things rather than as one paragraph — and flat, because
             * `level={0}` with a higher container is how this console separates
             * regions. A shadow here would put the answer in front of the page
             * it is about.
             */
            container="high"
            level={0}
            shape="small"
            className={styles.answer}
          >
            {/* Muted by the base `p` rule, so the figure below it is the thing
                the eye lands on. No colour is set here — see cost.module.css. */}
            <p className={`${styles.answerLine} md3-label-large`}>{figure.label}</p>
            <span className={`${styles.answerLine} md3-display-small`}>
              {figure.value ?? "Unknown"}
            </span>
            <p className={`${styles.answerLine} md3-body-small`}>{figure.note}</p>
          </Surface>
        ))}
      </div>
    </Card>
  )
}
