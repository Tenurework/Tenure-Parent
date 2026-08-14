import "./primitives.css"
import { splitIso } from "./datetime"

/**
 * A UTC instant, entered as the platform's own date and time controls.
 *
 * ## Two controls, so a `<fieldset>` and a `<legend>` — not a `<label>`
 *
 * `Field` gives one control one label. This is two controls that mean one
 * thing, and the element for that is a fieldset: a screen reader announces the
 * legend before each of the two, so "Maintenance window opens, date" and
 * "Maintenance window opens, time" rather than two orphan fields called "date"
 * and "time" somewhere on a form with four of each.
 *
 * ## Native pickers, for the reason `Select` is native
 *
 * `<input type="date">` and `<input type="time">` bring the platform's picker,
 * its keyboard model, its locale-correct display, and its own validation — and
 * on a phone they bring the system control. A hand-built calendar has to
 * reimplement arrow-key navigation across months, the announcement of a
 * selected day, and every locale's week start, and the console gains nothing it
 * can use. What is lost is styling of the open picker, which is worth nothing
 * here.
 *
 * The DISPLAY is the operator's locale; the VALUE is always `YYYY-MM-DD` and
 * `HH:MM`. That is the property that makes `combineDateTime` safe, and it is
 * the reason no text parsing happens anywhere in this pair.
 *
 * ## It submits two names, and the server assembles them
 *
 * `name` produces `${name}-date` and `${name}-time`. The server action calls
 * `combineDateTime`, which returns either an ISO instant or which of the two
 * halves is wrong. A hidden third field assembled by client JavaScript would be
 * a value the server has to trust, in a console where a form is the beginning of
 * an authorization decision.
 *
 * ## UTC is on the screen
 *
 * In the legend's supporting line and beside the time field. Not in a tooltip.
 */

export interface DateTimeFieldProps {
  /** Base name; the two inputs submit `${name}-date` and `${name}-time`. */
  name: string
  /** The legend: what this instant is. */
  legend: string
  /** Read after the legend — what the window does, what the limits are. */
  supportingText?: string
  /** An ISO instant to prefill both halves with. */
  defaultIso?: string
  /** What is wrong. Rendered under whichever half it names. */
  error?: { field: "date" | "time"; message: string }
  required?: boolean
  /** Earliest acceptable date, `YYYY-MM-DD`. Passed to the native control. */
  min?: string
  max?: string
  id?: string
}

export function DateTimeField({
  name,
  legend,
  supportingText,
  defaultIso,
  error,
  required,
  min,
  max,
  id,
}: DateTimeFieldProps) {
  const baseId = id ?? name
  const dateId = `${baseId}-date`
  const timeId = `${baseId}-time`
  const supportId = `${baseId}-support`
  const errorId = `${baseId}-error`
  const parts = defaultIso ? splitIso(defaultIso) : null

  return (
    <fieldset data-md3="datetime" data-invalid={error ? "true" : "false"}>
      <legend className="md3-label-large" data-md3="datetime-legend">
        {legend}
      </legend>
      {supportingText ? (
        <p id={supportId} data-md3="datetime-support" className="md3-body-small">
          {supportingText}
        </p>
      ) : null}
      <div data-md3="datetime-parts">
        <span data-md3="datetime-part">
          <label className="md3-label-medium" htmlFor={dateId}>
            Date
          </label>
          <input
            id={dateId}
            name={`${name}-date`}
            type="date"
            className="md3-field-input md3-body-medium"
            defaultValue={parts?.date}
            required={required}
            min={min}
            max={max}
            aria-describedby={
              [supportingText ? supportId : null, error?.field === "date" ? errorId : null]
                .filter(Boolean)
                .join(" ") || undefined
            }
            aria-invalid={error?.field === "date" ? true : undefined}
          />
        </span>
        <span data-md3="datetime-part">
          <label className="md3-label-medium" htmlFor={timeId}>
            Time (UTC)
          </label>
          <input
            id={timeId}
            name={`${name}-time`}
            type="time"
            className="md3-field-input md3-body-medium"
            defaultValue={parts?.time}
            required={required}
            aria-describedby={
              [supportingText ? supportId : null, error?.field === "time" ? errorId : null]
                .filter(Boolean)
                .join(" ") || undefined
            }
            aria-invalid={error?.field === "time" ? true : undefined}
          />
        </span>
      </div>
      {error ? (
        <p id={errorId} data-md3="datetime-error" className="md3-body-small">
          {/* The word, for the same reason `Field` writes one. */}
          <span className="md3-field-error-word">Error</span> {error.message}
        </p>
      ) : null}
    </fieldset>
  )
}
