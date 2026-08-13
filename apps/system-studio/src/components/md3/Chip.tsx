import type { ComponentPropsWithoutRef, ReactNode } from "react"

/**
 * A chip is a value, a filter or a choice — and which of the three it is decides
 * what element it must be.
 *
 * `Chip` renders a `<span>`: a value the reader can see and cannot press.
 * `ChipButton` renders a `<button>`: a filter or a choice, with the state layer
 * and a real hit area. They are separate exports for the reason `Button` and
 * `ButtonLink` are — a `<span>` with an `onClick` is invisible to the keyboard
 * and to every assistive technology, and a single component with an optional
 * handler is one prop away from shipping that.
 *
 * `--tap` is the minimum block size, and it is deliberately the same in both
 * densities (WCAG 2.2 AA 2.5.8, 24x24 CSS pixels). Compact tightens the space
 * around a chip; it never shrinks the chip.
 */

interface ChipBase {
  /**
   * Required. A chip with no text is a coloured rectangle, and this palette is
   * desaturated on purpose — there is not enough colour here for one to mean
   * anything on its own.
   */
  children: ReactNode
  /**
   * Filled with the secondary container when true.
   *
   * On `ChipButton` this is also written to `aria-pressed`, because "selected"
   * is a state a screen reader has to be able to read. A visual-only selection
   * is the most common defect in a filter row.
   */
  selected?: boolean
}

export type ChipProps = ChipBase & Omit<ComponentPropsWithoutRef<"span">, "className" | "children">

export type ChipButtonProps = ChipBase &
  Omit<ComponentPropsWithoutRef<"button">, "className" | "children">

export function Chip({ children, selected = false, ...rest }: ChipProps) {
  return (
    <span {...rest} className="md3-chip" data-selected={selected ? "true" : "false"}>
      {children}
    </span>
  )
}

export function ChipButton({
  children,
  selected = false,
  type = "button",
  ...rest
}: ChipButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className="md3-chip md3-state"
      data-selected={selected ? "true" : "false"}
      aria-pressed={selected}
    >
      {children}
    </button>
  )
}
