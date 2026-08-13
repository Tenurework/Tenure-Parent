import type { ReactNode } from "react"

import {
  Surface,
  type ElevationLevel,
  type SurfaceContainer,
  type SurfaceElement,
  type SurfaceShape,
} from "./Surface"

/**
 * A Surface with the three parts a console card always has: a headline, the
 * supporting line that says what the numbers below it mean, and an action row.
 *
 * ## `headlineAs` exists because heading level is a document decision
 *
 * A card does not know whether it is the second heading on the page or the
 * fourth, and a component that hardcodes `<h2>` produces a page whose outline is
 * wrong everywhere it is used twice. The default is `h2` because most Studio
 * pages have one `<h1>` and a column of cards under it; a card nested inside
 * another section passes `h3` and the outline stays true.
 *
 * The VISUAL size does not follow the level — it is `md3-title-large` whatever
 * the element is. That separation is the point: a heading level is for the
 * document, a type role is for the eye, and tying them is how a page ends up
 * with an `<h4>` chosen because `<h3>` looked too big.
 *
 * ## `headerAside` rather than `badge`
 *
 * The slot beside the headline takes any node. Naming it `badge` would make the
 * card know about one primitive and shut out the other thing that legitimately
 * sits there — a timestamp, a count, a link to the AWS console. The header wraps
 * rather than truncating, so at 320 CSS pixels the aside moves to its own line
 * instead of colliding with the headline.
 */
export interface CardProps {
  headline: ReactNode
  headlineAs?: "h2" | "h3" | "h4"
  /** One line saying what this card is. Optional, because some cards are a list. */
  supportingText?: ReactNode
  /** The slot beside the headline: a status badge, a count, a timestamp. */
  headerAside?: ReactNode
  /** The action row, below the content. */
  actions?: ReactNode
  container?: SurfaceContainer
  level?: ElevationLevel
  shape?: SurfaceShape
  outlined?: boolean
  as?: SurfaceElement
  id?: string
  children?: ReactNode
}

export function Card({
  headline,
  headlineAs: Heading = "h2",
  supportingText,
  headerAside,
  actions,
  // A card is a distinct region on a page, so it defaults to the lowest
  // container plus the decorative hairline rather than to a shadow: this
  // console prints long lists of cards, and a page of level-1 shadows reads as
  // a page of things floating over nothing.
  container = "lowest",
  level = 0,
  shape = "medium",
  outlined = true,
  as = "section",
  id,
  children,
}: CardProps) {
  return (
    <Surface
      as={as}
      container={container}
      level={level}
      shape={shape}
      outlined={outlined}
      className="md3-card"
      id={id}
    >
      <div className="md3-card-header">
        <Heading className="md3-card-headline md3-title-large">{headline}</Heading>
        {headerAside}
      </div>
      {supportingText ? <p className="md3-card-support md3-body-medium">{supportingText}</p> : null}
      {children}
      {actions ? <div className="md3-card-actions">{actions}</div> : null}
    </Surface>
  )
}
