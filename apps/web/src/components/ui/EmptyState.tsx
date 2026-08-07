import { type ReactNode } from "react"

import { StateSurface } from "@/components/ui/StateSurface"
import { type IconType } from "@/components/ui/icons"

/**
 * TTES-020-001 — the product's blank panel, expressed through the state table.
 *
 * This used to be a bare `<div>` with a glyph and two lines of copy: no ARIA
 * role, no politeness, and no way for a reader to tell "there is genuinely
 * nothing here" from "your filter matched nothing". Both meanings went through
 * the same component, which is precisely the drift `states.ts` was written to
 * stop (see its header, "`no-results` is not `empty`").
 *
 * So it is now a thin wrapper over `StateSurface`, which reads the role and the
 * politeness out of `STATE_SEMANTICS` rather than letting a call site decide
 * them. That also gives `StateSurface` the production caller it did not have —
 * before this, the whole fourteen-state vocabulary was reachable only from its
 * own test.
 *
 * `state` is REQUIRED and deliberately has no default. A default is the
 * optional-field-nobody-sets failure: it type-checks at every existing call
 * site, every unit test keeps passing because tests build their own fixtures,
 * and the filtered-to-nothing panels keep announcing "nothing yet" forever.
 * Making it required means `tsc` names every site that has to choose.
 */
export function EmptyState({
  state,
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  /**
   * `empty` — the query ran with no filters and the honest answer is "none yet".
   * `no-results` — records exist, the viewer's filters excluded all of them.
   */
  state: "empty" | "no-results"
  icon: IconType
  title?: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <StateSurface
      state={state}
      icon={Icon}
      title={title}
      detail={description}
      action={action}
      centered
      className={className}
    />
  )
}
