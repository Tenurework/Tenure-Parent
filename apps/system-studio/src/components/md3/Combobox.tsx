"use client"

import { useCallback, useId, useRef, useState } from "react"

import "./primitives.css"
import { Field, describedBy, type FieldText } from "./Field"
import { Surface } from "./Surface"
import { useDismissableLayer } from "./hooks"
import { filterOptions, isDismiss, step, type FilterableOption, type ListState } from "./interaction"

/**
 * A text field that filters a long list: a tenant slug among four thousand, an
 * account among six hundred, a region.
 *
 * ## Why this exists when `Select` deliberately does not do it
 *
 * `Select` is the native control and its reasoning holds — for a list somebody
 * can read. A combobox is for the list nobody can: it is the control you reach
 * for when the answer must be TYPED to be found. That is a different job, and
 * it is the only reason to take on the keyboard work the native element would
 * have done.
 *
 * ## The keyboard model is APG's editable combobox, including the parts that
 * are about NOT taking keys
 *
 *   * ArrowDown and ArrowUp move through the filtered options, opening the list
 *     if it is closed. Alt+ArrowDown opens without moving.
 *   * Enter takes the highlighted option. Escape closes the list; pressed again
 *     with the list closed it clears the field, which is APG's rule and the one
 *     that gives an operator a way back to "no filter" without the mouse.
 *   * Home and End are LEFT ALONE. In an editable combobox they belong to the
 *     text cursor, and a widget that steals them makes a long ARN uneditable.
 *     `interaction.ts` has a Home/End rule and this component deliberately does
 *     not call it.
 *   * Tab closes the list and takes nothing. Silently committing a highlighted
 *     option on the way past is how a form ends up submitting a value nobody
 *     chose.
 *
 * ## Focus stays in the input, so the active option is `aria-activedescendant`
 *
 * The inverse of `Menu`, and for the inverse reason: the operator is typing, so
 * DOM focus cannot move to the option. `aria-activedescendant` is what tells a
 * screen reader which option is current while focus stays put, and it is only
 * honoured if the id it names is a `role="option"` inside the `role="listbox"`
 * that `aria-controls` names — which is why all three ids are built from one
 * base here rather than passed in.
 *
 * ## The count is on the screen, not only in a live region
 *
 * "12 of 340 match" is rendered as visible text with `role="status"`. A
 * screen-reader-only announcement would leave a sighted operator watching a
 * list of ten wondering whether it is all of them, and a visible line is
 * announced by the same live region anyway.
 *
 * ## It submits like a field
 *
 * `name` renders a hidden input carrying the chosen VALUE while the visible
 * input holds the label. Without that, a combobox inside a server-action form
 * submits whatever text was typed, and a slug that nearly matches a tenant is
 * the worst possible thing to hand a control plane.
 */

export interface ComboboxOption extends FilterableOption {
  /** One line under the label — an account id, a region, a state. */
  detail?: string
}

export type ComboboxProps = FieldText & {
  id?: string
  options: readonly ComboboxOption[]
  /** Submitted value's field name. Omit outside a form. */
  name?: string
  /** Chosen value on first render. */
  defaultValue?: string
  /** Told the value, never the typed text. `null` when the field is cleared. */
  onChange?: (value: string | null) => void
  placeholder?: string
  required?: boolean
  disabled?: boolean
}

export function Combobox({
  id,
  label,
  supportingText,
  errorText,
  options,
  name,
  defaultValue,
  onChange,
  placeholder,
  required,
  disabled,
}: ComboboxProps) {
  const generatedId = useId()
  const baseId = id ?? generatedId
  const listId = `${baseId}-listbox`
  const statusId = `${baseId}-status`
  const initial = options.find((option) => option.value === defaultValue)
  const [query, setQuery] = useState(initial?.label ?? "")
  const [value, setValue] = useState<string | null>(initial?.value ?? null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // When a value is committed the field shows its label, and the list must not
  // then filter down to the one option whose label is being displayed.
  const matches = value && query === initial?.label ? [...options] : filterOptions(options, query)
  const state: ListState = {
    index: active,
    count: matches.length,
    disabled: matches.flatMap((option, index) => (option.disabled ? [index] : [])),
    loop: true,
  }

  const close = useCallback(() => {
    setOpen(false)
    setActive(-1)
  }, [])

  useDismissableLayer({
    open,
    onDismiss: close,
    panelRef,
    triggerRef: inputRef,
    dismissOnFocusOut: true,
    // Focus is already in the input and must stay there. Restoring it would be
    // a no-op at best and a focus jump at worst.
    restoreFocus: false,
  })

  const commit = (index: number) => {
    const option = matches[index]
    if (!option || option.disabled) return
    setValue(option.value)
    setQuery(option.label)
    onChange?.(option.value)
    close()
    inputRef.current?.focus()
  }

  const { describedBy: described } = describedBy(baseId, !!supportingText, !!errorText)

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        if (event.altKey) return
      }
      setActive(step({ ...state, index: active }, event.key === "ArrowDown" ? 1 : -1))
      return
    }
    if (event.key === "Enter") {
      if (open && active >= 0) {
        // Only when the list is open with something highlighted. Otherwise
        // Enter is the form's, and swallowing it breaks submit-on-Enter.
        event.preventDefault()
        commit(active)
      }
      return
    }
    if (isDismiss(event.key)) {
      if (open) {
        event.stopPropagation()
        close()
      } else if (query) {
        event.stopPropagation()
        setQuery("")
        setValue(null)
        onChange?.(null)
      }
      return
    }
    if (event.key === "Tab" && open) close()
  }

  return (
    <Field id={baseId} label={label} supportingText={supportingText} errorText={errorText}>
      <div data-md3="anchor" data-block="true">
        {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}
        <input
          ref={inputRef}
          id={baseId}
          type="text"
          className="md3-field-input md3-body-medium"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-describedby={[described, open ? statusId : null].filter(Boolean).join(" ") || undefined}
          aria-invalid={errorText ? true : undefined}
          {...(open && active >= 0 && matches[active]
            ? { "aria-activedescendant": `${baseId}-option-${matches[active].value}` }
            : {})}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setActive(-1)
            if (value !== null) {
              // Typing over a committed choice un-commits it. Leaving the old
              // value in the hidden input while the text says something else is
              // the defect this whole component exists to avoid.
              setValue(null)
              onChange?.(null)
            }
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
        />
        {open ? (
          <div data-md3="popover" data-align="start" data-block="true" ref={panelRef}>
            <Surface container="high" level={2} shape="medium" outlined data-md3="popover-panel">
              <p id={statusId} role="status" data-md3="combobox-status" className="md3-label-small">
                {matches.length} of {options.length} match
              </p>
              <ul id={listId} role="listbox" aria-label={typeof label === "string" ? label : undefined} data-md3="listbox">
                {matches.map((option, index) => (
                  <li
                    key={option.value}
                    id={`${baseId}-option-${option.value}`}
                    role="option"
                    data-md3="listbox-option"
                    className="md3-state md3-body-medium"
                    aria-selected={index === active}
                    aria-disabled={option.disabled ? true : undefined}
                    data-current={option.value === value ? "true" : "false"}
                    onMouseEnter={() => setActive(index)}
                    onPointerDown={(event) => {
                      // Before blur, so the click lands while the option list
                      // still exists.
                      event.preventDefault()
                      commit(index)
                    }}
                  >
                    <span data-md3="listbox-label">{option.label}</span>
                    {option.detail ? (
                      <span data-md3="listbox-detail" className="md3-body-small">
                        {option.detail}
                      </span>
                    ) : null}
                  </li>
                ))}
                {matches.length === 0 ? (
                  <li role="option" aria-disabled="true" aria-selected="false" data-md3="listbox-empty" className="md3-body-small">
                    Nothing matches that.
                  </li>
                ) : null}
              </ul>
            </Surface>
          </div>
        ) : null}
      </div>
    </Field>
  )
}
