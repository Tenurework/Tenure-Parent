import Link from "next/link"
import type { ReactNode } from "react"

import "./primitives.css"

/**
 * Where a multi-step process has got to: a change request through plan →
 * approve → execute → verify, an onboarding, a wave rollout.
 *
 * ## It is an ordered list, because that is what it is
 *
 * `<ol>` with `<li>`, so a screen reader says "3 of 6" without being told, and
 * the current step carries `aria-current="step"` — the value that means exactly
 * this. A row of divs with a tinted circle says nothing at all, which is what
 * most steppers are.
 *
 * ## Every status is a WORD
 *
 * "Done", "In progress", "Blocked", "Not started". Never a tick, never a tint,
 * never a filled circle on its own. Bible §26.3.2 forbids colour-only meaning
 * and this is the component where breaking that rule is most tempting, because
 * a row of coloured dots looks so much tidier than a row of labelled ones.
 *
 * ## A step is a link only when going there is safe
 *
 * `href` makes a step navigable — going BACK to review what was entered. A step
 * that has not been reached has no href and is not a link, because a stepper
 * that lets an operator jump to "Execute" from step two is a stepper that has
 * skipped an approval. Which steps are reachable is the caller's decision and
 * the caller's data; this component only refuses to invent one.
 *
 * ## It reflows rather than scrolling sideways
 *
 * At 320 CSS pixels the row becomes a column. `layout.spec.ts` treats a
 * horizontally scrolling page as a defect at every width, and a stepper is the
 * component that most often causes one — six labelled steps do not fit on a
 * phone in any typeface.
 */

export type StepStatus = "done" | "current" | "upcoming" | "blocked" | "failed"

const STATUS_WORD: Record<StepStatus, string> = {
  done: "Done",
  current: "In progress",
  upcoming: "Not started",
  blocked: "Blocked",
  failed: "Failed",
}

export interface Step {
  key: string
  label: string
  status: StepStatus
  /** One line: what happened, who approved it, what is waiting. */
  detail?: ReactNode
  /** Where to go to see or resume it. Omit for a step that must not be jumped to. */
  href?: string
}

export interface StepperProps {
  /** Names the process — "Change request TSC-4192". Required. */
  label: string
  steps: readonly Step[]
  /** `vertical` for a rail beside the content; `horizontal` above it. */
  orientation?: "horizontal" | "vertical"
  id?: string
}

export function Stepper({ label, steps, orientation = "horizontal", id }: StepperProps) {
  return (
    <nav aria-label={label} data-md3="stepper" data-orientation={orientation} id={id}>
      <ol data-md3="stepper-list">
        {steps.map((step, index) => {
          const content = (
            <>
              <span data-md3="step-index" aria-hidden="true">
                {index + 1}
              </span>
              <span data-md3="step-text">
                <span data-md3="step-label" className="md3-title-small">
                  {step.label}
                </span>
                {/*
                  The status, in words, as part of the item's text. Not a
                  `title`, not an `aria-label` that replaces the visible name —
                  a label that says something the screen does not is a second
                  version of the truth.
                */}
                <span data-md3="step-status" className="md3-label-small">
                  {STATUS_WORD[step.status]}
                </span>
                {step.detail ? (
                  <span data-md3="step-detail" className="md3-body-small">
                    {step.detail}
                  </span>
                ) : null}
              </span>
            </>
          )
          return (
            <li
              key={step.key}
              data-md3="step"
              data-status={step.status}
              {...(step.status === "current" ? { "aria-current": "step" as const } : {})}
            >
              {step.href ? (
                <Link href={step.href} className="md3-state" data-md3="step-body">
                  {content}
                </Link>
              ) : (
                <span data-md3="step-body">{content}</span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
