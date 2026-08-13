import type { ComponentPropsWithoutRef } from "react"

import { Field, describedBy, type FieldText } from "./Field"

/**
 * A native `<select>` in the console's frame.
 *
 * ## Native, and not a listbox this file draws
 *
 * A custom dropdown means owning keyboard interaction, typeahead, focus
 * restoration, portalling, scroll-locking and the mobile picker — and getting
 * every one of them right in every browser, forever. The native control already
 * has all of it, is the only version that works before hydration, and on a
 * phone opens the platform's own picker. What it costs is the ability to style
 * the open menu, which is worth nothing here: the console's selects hold
 * regions, environments and tenant slugs, not swatches.
 *
 * This is the same reasoning `Tabs` uses to stay links and `Dialog` uses not to
 * claim modality. A primitive in this directory does not take on a behaviour it
 * cannot implement correctly without client JavaScript.
 *
 * ## Options are data
 *
 * `options` is an array rather than `<option>` children, for the reason
 * `DataTable`'s columns are data: the caller cannot then write a `<div>` into a
 * `<select>`, an option cannot be missing its value, and a route mapping AWS
 * regions to options writes the mapping once rather than a JSX loop each time.
 *
 * ## The placeholder is a disabled option, not a blank one
 *
 * `placeholder` renders a selected, disabled, valueless first option — which is
 * how a native select says "nothing chosen yet" while `required` still refuses
 * the form. A blank enabled option would let an empty string pass validation and
 * arrive at a server action as a legitimate choice.
 */

export interface SelectOption {
  /** The value the form submits. Never blank — use `placeholder` for that. */
  value: string
  /** What the operator reads. */
  label: string
  disabled?: boolean
}

export type SelectProps = FieldText & {
  id: string
  options: readonly SelectOption[]
  /**
   * The "nothing chosen yet" line, rendered as a disabled option with no value.
   *
   * Omit it when the field has a real default; a placeholder above an already
   * correct answer is one more thing to read past.
   */
  placeholder?: string
} & Omit<
    ComponentPropsWithoutRef<"select">,
    "className" | "id" | "children" | "aria-describedby" | "aria-invalid"
  >

export function Select({
  id,
  label,
  supportingText,
  errorText,
  options,
  placeholder,
  defaultValue,
  ...rest
}: SelectProps) {
  const { describedBy: described } = describedBy(id, !!supportingText, !!errorText)
  return (
    <Field id={id} label={label} supportingText={supportingText} errorText={errorText}>
      <select
        {...rest}
        id={id}
        className="md3-field-input md3-field-select md3-body-medium"
        aria-describedby={described}
        aria-invalid={errorText ? true : undefined}
        /*
         * When there is a placeholder and the caller named no default, the
         * placeholder IS the default. Saying so explicitly rather than letting
         * the browser pick the first option is what keeps "nothing chosen" from
         * silently becoming "the first region in the list", which is a real
         * answer nobody gave.
         */
        defaultValue={defaultValue ?? (placeholder ? "" : undefined)}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )
}
