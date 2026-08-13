import type { ComponentPropsWithoutRef } from "react"

import { Field, describedBy, type FieldText } from "./Field"

/**
 * Material's outlined text field, with the label above the box rather than
 * floating inside it.
 *
 * ## The label does not float
 *
 * Material's floating label is the most-copied thing in the system and the one
 * that most often ships broken. Floated, it is a 12px string sitting on the
 * field's border; unfloated, it occupies the place a placeholder would, and
 * every implementation has, at some state, the label and the user's text drawn
 * over each other. It also needs either JavaScript or a `:placeholder-shown`
 * trick that forces a placeholder to exist — and a placeholder duplicating the
 * label is announced twice and then vanishes the moment typing starts, taking
 * the only remaining description of the field with it.
 *
 * This is a console where operators type ARNs into fields they cannot afford to
 * mislabel. So: a persistent `<label>` above the box, always legible, always the
 * accessible name, never animated.
 *
 * ## `id` is required, not generated
 *
 * A generated id differs between the server render and the hydrating client one.
 * The form that submits this needs a `name` anyway, and an id the caller chose
 * is one a `<label for>`, a server action and an e2e locator can all name.
 *
 * ## There is no `"use client"`
 *
 * These are uncontrolled form controls — `defaultValue`, `name`, and a server
 * action reading `FormData`. That is how the rest of this console's forms work,
 * and it is why a `TextField` can be rendered inside a server component without
 * pulling a bundle. A route needing per-keystroke behaviour supplies its own
 * client wrapper; it does not need this file to have a directive.
 */

export type TextFieldProps = FieldText & {
  id: string
} & Omit<ComponentPropsWithoutRef<"input">, "className" | "id" | "aria-describedby" | "aria-invalid">

export type TextAreaProps = FieldText & {
  id: string
} & Omit<
    ComponentPropsWithoutRef<"textarea">,
    "className" | "id" | "aria-describedby" | "aria-invalid"
  >

export function TextField({ id, label, supportingText, errorText, ...rest }: TextFieldProps) {
  const { describedBy: described } = describedBy(id, !!supportingText, !!errorText)
  return (
    <Field id={id} label={label} supportingText={supportingText} errorText={errorText}>
      <input
        {...rest}
        id={id}
        className="md3-field-input md3-body-medium"
        aria-describedby={described}
        // Driven by the presence of the message, so a control cannot be drawn
        // invalid while announcing itself valid.
        aria-invalid={errorText ? true : undefined}
      />
    </Field>
  )
}

/**
 * The same field, for text that has newlines in it.
 *
 * A separate export rather than a `multiline` prop, for the reason `Button` and
 * `ButtonLink` are separate: the prop sets genuinely differ — `rows` and `wrap`
 * on one, `type`, `min`, `max`, `step` and `pattern` on the other — and a union
 * carrying all of them lets a caller write `<TextField multiline type="number">`,
 * which type-checks and then does something nobody intended.
 */
export function TextArea({ id, label, supportingText, errorText, rows = 4, ...rest }: TextAreaProps) {
  const { describedBy: described } = describedBy(id, !!supportingText, !!errorText)
  return (
    <Field id={id} label={label} supportingText={supportingText} errorText={errorText}>
      <textarea
        {...rest}
        id={id}
        rows={rows}
        className="md3-field-input md3-field-textarea md3-body-medium"
        aria-describedby={described}
        aria-invalid={errorText ? true : undefined}
      />
    </Field>
  )
}
