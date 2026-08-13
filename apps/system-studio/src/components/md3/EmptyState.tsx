import type { ReactNode } from "react"

/**
 * The layout of an empty region: what is absent, why, and what would create it.
 *
 * ## This is presentation. `components/states.tsx` is meaning.
 *
 * That file owns fourteen governed states — `empty`, `error`, `permissionDenied`,
 * `unknown` — and the distinction between them is the load-bearing part: a
 * denied AWS read rendered as an empty list is how an operator reads "no RDS
 * instances" off a role that may not call `DescribeDBInstances`. Nothing here
 * replaces that vocabulary, and a surface reporting a state must still use it.
 *
 * What this is, is the SHAPE such a report takes when it is the whole region
 * rather than a banner inside one: the body of an empty table, a card with
 * nothing in it yet. `states.tsx` decides which of fourteen words applies; this
 * decides where the headline, the explanation and the action sit. The two share
 * a name in different modules, which is a real overlap and is recorded rather
 * than glossed: the right end state is for `states.tsx`'s `EmptyState` to render
 * this shell, and that is a change to a file this component cannot make.
 *
 * ## `description` is required
 *
 * "No results" is the version of this component that gets shipped and then
 * generates a support ticket. The two nothings — nothing exists, versus nothing
 * matches the filter you have applied — are the same screen and completely
 * different facts, and only the description can tell them apart.
 */
export interface EmptyStateProps {
  /** What is absent. A noun phrase: "No tenants in this account". */
  headline: ReactNode
  /** Why it is absent, or which of the two nothings this is. */
  description: ReactNode
  /** What would create it. A `Button`, a `ButtonLink`, or nothing. */
  actions?: ReactNode
  headlineAs?: "h2" | "h3" | "h4" | "p"
}

export function EmptyState({
  headline,
  description,
  actions,
  headlineAs: Heading = "p",
}: EmptyStateProps) {
  return (
    /*
     * `role="status"` is deliberately NOT here, and `states.tsx` explains why it
     * is there instead: this is a layout, and a layout announced as a live
     * region makes a screen reader read a static panel every time the page
     * settles. The governed state block is the thing with a role.
     */
    <div className="md3-empty">
      <Heading className="md3-empty-headline md3-title-medium">{headline}</Heading>
      <p className="md3-empty-description md3-body-medium">{description}</p>
      {actions ? <div className="md3-empty-actions">{actions}</div> : null}
    </div>
  )
}
