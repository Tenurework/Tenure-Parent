import type { ReactNode } from "react"

/**
 * A status, carried by a word.
 *
 * Bible §26.3.2 forbids meaning conveyed by colour alone, so `children` is
 * required and there is no icon-only badge and no coloured dot. The tone tints
 * the pill; the text is what says what it means. In a palette this desaturated
 * the word is doing nearly all of the work anyway — which is the design, not a
 * compromise: a console where the eye is pulled to whatever is reddest stops
 * being read.
 *
 * ## Five tones, and none of them is "primary"
 *
 * A badge reports a state of the world. `ok`, `warn` and `bad` map onto the
 * three tones `components/states.tsx` already uses for its fourteen governed
 * states, so a badge and a state block describing the same fact agree. `info` is
 * the tertiary family — a fact that is neither good nor bad, like an environment
 * or a region. `neutral` has no status at all and is the default, because a
 * badge whose tone was not chosen must not imply one.
 *
 * There is deliberately no accent-coloured badge. The accent is for the thing to
 * DO on a page; a badge is a thing that IS, and giving it the action colour is
 * how a page ends up with six equally loud call-to-actions and one real one.
 */
export type BadgeTone = "neutral" | "info" | "ok" | "warn" | "bad"

export interface BadgeProps {
  children: ReactNode
  tone?: BadgeTone
  /**
   * What the badge means, for a reader who gets the word without its context.
   *
   * Rendered as `title` and as the accessible description. "PROVISIONING" is
   * clear beside a tenant name and opaque in a screen-reader's element list.
   */
  title?: string
  id?: string
}

export function Badge({ children, tone = "neutral", title, id }: BadgeProps) {
  return (
    <span className="md3-badge" data-tone={tone} title={title} id={id}>
      {children}
    </span>
  )
}
