import type { ComponentPropsWithoutRef, ReactNode } from "react"

import { describedBy } from "./Field"

/**
 * Material's switch, drawn on a real checkbox.
 *
 * ## It is an `<input type="checkbox">` with `role="switch"`
 *
 * Not a button with `aria-pressed`, and not a div. A checkbox posts with the
 * form, restores on back-navigation, is reachable with the space bar, and works
 * with no JavaScript at all — which matters because nothing in this directory
 * has a `"use client"` directive and the console's forms are server actions
 * reading `FormData`. `role="switch"` is the one thing added on top, and it
 * changes only how it is ANNOUNCED: "on/off" rather than "checked/unchecked",
 * which is what the control looks like.
 *
 * The track and the thumb are drawn by `globals.css` from the input itself
 * (`appearance: none` plus a `::before`), so there is no decorative span here
 * for a screen reader to trip over and no way for the visual state and the
 * checked state to disagree — they are the same element.
 *
 * ## A switch takes effect when the form is submitted
 *
 * Material's switch applies immediately. That is a phone-settings idiom, and it
 * is wrong for a control plane: applying on toggle means every accidental
 * keystroke is a change to the estate, and there is nowhere to show what the
 * change would do before it happens. Here a switch is a form control; the form's
 * button is what commits, and a high-risk change goes through the confirmation
 * in `components/states.tsx` first.
 *
 * ## Both states are readable without colour
 *
 * The thumb moves and the track's outline changes, and the required `label`
 * says which setting this is. `stateText` is the optional other half — "On" /
 * "Off" in words beside the control — for a form where the setting's name does
 * not make the current position obvious.
 */

export interface SwitchProps
  extends Omit<
    ComponentPropsWithoutRef<"input">,
    "className" | "id" | "type" | "role" | "children" | "aria-describedby"
  > {
  /** Required, as with every control here: a generated id is not stable. */
  id: string
  /** The setting this switch is. Required — an unlabelled switch is a toggle to nowhere. */
  label: ReactNode
  /** What turning it on will mean, and when it takes effect. */
  supportingText?: ReactNode
  /**
   * The position in words — "On", "Off", "Enforcing".
   *
   * Optional, and worth supplying whenever the label alone does not make the
   * position readable. It is rendered as text, so it survives a palette nobody
   * can distinguish.
   */
  stateText?: ReactNode
}

export function Switch({ id, label, supportingText, stateText, ...rest }: SwitchProps) {
  const { supportId, describedBy: described } = describedBy(id, !!supportingText, false)
  return (
    <div className="md3-switch">
      <input
        {...rest}
        id={id}
        type="checkbox"
        // Announced as on/off rather than checked/unchecked. The element stays a
        // checkbox, so everything a checkbox does — form submission, back/forward
        // restoration, the space bar — keeps working.
        role="switch"
        className="md3-switch-input"
        aria-describedby={described}
      />
      <label className="md3-switch-label md3-body-medium" htmlFor={id}>
        <span>{label}</span>
        {stateText ? <span className="md3-switch-state md3-label-small">{stateText}</span> : null}
      </label>
      {supportingText ? (
        <p className="md3-switch-support md3-body-small" id={supportId}>
          {supportingText}
        </p>
      ) : null}
    </div>
  )
}
