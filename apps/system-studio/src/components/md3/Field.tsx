import type { ReactNode } from "react"

/**
 * The frame every labelled form control in this console shares: a persistent
 * label, the control, a supporting line and an error line.
 *
 * It exists as its own module because `TextField`, `TextArea` and `Select` must
 * describe themselves IDENTICALLY. Three copies of "build the describedby, hide
 * the error when absent, mark the wrapper invalid" is three chances for one
 * control to announce its hint and another to drop it — and the one that drops
 * it is invisible to `tsc`, to a screenshot and to anyone not using a screen
 * reader.
 *
 * It is exported for the same reason: a route that has to wrap a control this
 * directory does not provide — a native `<input type="date">`, a file input —
 * gets the same frame instead of inventing a fourth.
 *
 * The label does NOT float. `TextField` carries the argument in full; the short
 * version is that a floating label needs either JavaScript or a placeholder that
 * duplicates it, and a console where operators type ARNs cannot afford a label
 * that is sometimes drawn over the value.
 */

export interface FieldText {
  /** Required, persistent, and the control's accessible name. */
  label: ReactNode
  /** The format, the unit, the consequence. Read after the name. */
  supportingText?: ReactNode
  /**
   * What is wrong with what was entered.
   *
   * Its presence is what makes the control invalid — there is no separate
   * `invalid` prop that could disagree with it, which is how a field ends up
   * outlined in the error colour while announcing itself valid.
   */
  errorText?: ReactNode
}

/**
 * The ids the two message lines get, and the `aria-describedby` that points at
 * whichever exist.
 *
 * Exported so the control and its frame cannot compute different answers.
 */
export function describedBy(id: string, hasSupport: boolean, hasError: boolean) {
  const ids = [hasSupport ? `${id}-support` : null, hasError ? `${id}-error` : null].filter(
    (value): value is string => value !== null,
  )
  return {
    supportId: `${id}-support`,
    errorId: `${id}-error`,
    // `undefined` rather than `""`. An empty `aria-describedby` is a reference
    // to nothing, which some screen readers announce as a description that
    // exists and is blank.
    describedBy: ids.length ? ids.join(" ") : undefined,
  }
}

export interface FieldProps extends FieldText {
  /**
   * The control's id, which this frame's `<label for>` and message ids are all
   * built from. Required rather than generated: a generated id differs between
   * the server render and the hydrating client one.
   */
  id: string
  children: ReactNode
}

export function Field({ id, label, supportingText, errorText, children }: FieldProps) {
  const { supportId, errorId } = describedBy(id, !!supportingText, !!errorText)
  return (
    <div className="md3-field" data-invalid={errorText ? "true" : "false"}>
      <label className="md3-field-label md3-label-large" htmlFor={id}>
        {label}
      </label>
      {children}
      {supportingText ? (
        <p className="md3-field-support md3-body-small" id={supportId}>
          {supportingText}
        </p>
      ) : null}
      {errorText ? (
        /*
         * "Error" is a WORD here, not only a tint. Bible §26.3.2 forbids meaning
         * carried by colour alone, and a reader who cannot tell this line's
         * colour from the hint above it still gets told which of the two it is.
         */
        <p className="md3-field-error md3-body-small" id={errorId}>
          <span className="md3-field-error-word">Error</span> {errorText}
        </p>
      ) : null}
    </div>
  )
}
