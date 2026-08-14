import type { ComponentPropsWithoutRef, ReactNode } from "react"

/*
 * Relative, not `@/components/md3` — see the note at the top of `ComposeForm.tsx`.
 * The Studio's unit tests run through apps/web's jest, whose `@/` alias resolves
 * into apps/web's own src.
 */
import { describedBy } from "../../../components/md3"

import styles from "./compose.module.css"

/**
 * A set of checkboxes that answer one question, with the question as a `<legend>`.
 *
 * ## Why this is here and not in `components/md3/`
 *
 * It should be there. `components/md3/` has `Field`, `TextField`, `Select` and
 * `Switch`, and every one of them frames exactly ONE control: `Field` renders
 * `<label htmlFor={id}>`, which needs a single focusable element to point at. A
 * question answered by twelve checkboxes has no such element, and pointing the
 * label at the first checkbox gives that checkbox two accessible names while
 * leaving the other eleven ungrouped — a screen-reader user hears twelve
 * unrelated switches instead of twelve answers to one question.
 *
 * The correct primitive is a `<fieldset>` with a `<legend>`, and the directory
 * does not have one. Forking `Field` to emit a fieldset was the alternative and
 * it is explicitly not what this route is allowed to do, so this composes the
 * token layer instead of duplicating it:
 *
 *   * `describedBy` is IMPORTED from `components/md3/Field`, so a group's
 *     supporting text and error line get the same ids, the same
 *     `aria-describedby` construction and the same "omit rather than reference
 *     nothing" rule as every single-control field on the page;
 *   * the classes are the token layer's own — `md3-label-large`,
 *     `md3-field-support`, `md3-field-error`, `md3-field-error-word` — so a
 *     group's hint and a field's hint are the same size, the same colour role
 *     and the same word. Nothing here declares a colour or a size.
 *
 * A `FieldGroup` (or `CheckboxGroup`) primitive in `components/md3/` would
 * replace this file entirely and this route would consume it.
 *
 * ## "Error" is a word, not a tint
 *
 * Copied deliberately from `Field`: bible §26.3.2 forbids meaning carried by
 * colour alone, and a reader who cannot tell this line's colour from the hint
 * above it still has to be told which of the two it is.
 */
export function ChoiceGroup({
  id,
  legend,
  supportingText,
  errorText,
  children,
}: {
  /** The group's id. The message ids are built from it, as `Field` does. */
  id: string
  /** The question these choices answer. Required — an unlabelled group is noise. */
  legend: ReactNode
  supportingText?: ReactNode
  errorText?: ReactNode
  children: ReactNode
}) {
  const { supportId, errorId, describedBy: described } = describedBy(
    id,
    !!supportingText,
    !!errorText,
  )
  return (
    <fieldset id={id} className={styles.group} aria-describedby={described}>
      <legend className="md3-field-label md3-label-large">{legend}</legend>
      <div className={styles.choices}>{children}</div>
      {supportingText ? (
        <p className="md3-field-support md3-body-small" id={supportId}>
          {supportingText}
        </p>
      ) : null}
      {errorText ? (
        <p className="md3-field-error md3-body-small" id={errorId}>
          <span className="md3-field-error-word">Error</span> {errorText}
        </p>
      ) : null}
    </fieldset>
  )
}

/**
 * One choice: the control, and everything the choice says about itself.
 *
 * `<label>` wrapping the input rather than `htmlFor`, because there is no id to
 * point at for a checkbox rendered in a loop over a catalog — and a wrapping
 * label is the one form of association that cannot get the id wrong.
 */
export function Choice({
  children,
  ...input
}: {
  children: ReactNode
} & Omit<ComponentPropsWithoutRef<"input">, "type" | "className">) {
  return (
    <label className={styles.choice}>
      <input {...input} type="checkbox" className={styles.choiceMark} />
      <span className={styles.choiceBody}>{children}</span>
    </label>
  )
}
