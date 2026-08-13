import Link from "next/link"
import type { ComponentPropsWithoutRef, ReactNode } from "react"

/**
 * The four Material button variants, and the two tones this console needs.
 *
 * ## Variant is emphasis, tone is consequence
 *
 * They are separate props because they answer different questions and the
 * product needs both answers. `variant` says how loud the button is — one filled
 * button per screen, tonal for a secondary action, outlined and text for
 * everything else. `tone` says what pressing it does: `danger` is for the
 * actions this console cannot undo.
 *
 * Collapsing them into one `variant="destructive"` is the usual shortcut and it
 * loses the ability to say "this is the quiet, irreversible one" — which is
 * exactly what a purge control in a row of ordinary transitions is. The
 * separation between an irreversible action and an ordinary one is SPATIAL in
 * this console (`fieldset.destructive` in `globals.css`, measured as a rectangle
 * by `layout.spec.ts`), because meaning carried by colour alone is forbidden
 * (Bible §26.3.2). `tone` supports that separation; it does not replace it, and
 * a danger button still has to say what it will do.
 *
 * ## A control that navigates is a link
 *
 * `Button` renders a `<button>` and `ButtonLink` renders a `next/link`. They are
 * two exports rather than one component with an optional `href` because the two
 * have genuinely different prop sets — a link has no `disabled`, no `type` and
 * no `form`, and a union that carries all of them lets a caller write
 * `<Button href="…" disabled>`, which type-checks and then silently does
 * nothing. Middle-click, copy-link-address and open-in-new-tab work on the link
 * and on none of the alternatives, and in a console where an operator opens six
 * tenants in six tabs that is the difference between the tool working and the
 * tool being fought.
 *
 * ## Disabled keeps its label
 *
 * Material dims disabled content to 38%, which WCAG 1.4.3 permits by name. This
 * console does not, and the reason is in the stylesheet beside the rule: the
 * control an operator cannot press is usually the one they came to press, and
 * the label is how they find out which one it was. A disabled button here keeps
 * `on-surface-variant` — 4.5:1 or better on every surface in the file, in both
 * themes and in increased contrast — and loses its fill and its state layer.
 *
 * ## It is not a client component
 *
 * There is no `"use client"` here, deliberately. A module with the directive
 * cannot be rendered into a server tree without pulling a bundle, and most of
 * this console's buttons are `type="submit"` inside a server-action form. With
 * no directive the component renders in either tree, and a client parent can
 * still hand it an `onClick`.
 */

export type ButtonVariant = "filled" | "tonal" | "outlined" | "text"

/** `neutral` is the accent family. `danger` is the error family. */
export type ButtonTone = "neutral" | "danger"

interface Emphasis {
  variant?: ButtonVariant
  tone?: ButtonTone
  /**
   * Required, and never optional.
   *
   * An icon-only control is untranslatable, unreadable to a screen reader
   * without an attribute somebody has to remember, and ambiguous in a console
   * where two adjacent actions can differ only in which environment they target.
   * Every button in this console says what it does.
   */
  children: ReactNode
}

export type ButtonProps = Emphasis &
  Omit<ComponentPropsWithoutRef<"button">, "className" | "children">

export type ButtonLinkProps = Emphasis &
  Omit<ComponentPropsWithoutRef<typeof Link>, "className" | "children">

/** `md3-state` carries the hover/focus/pressed layer; see `globals.css`. */
const CLASS_NAMES = "md3-button md3-state"

export function Button({
  variant = "text",
  tone = "neutral",
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      /*
       * Explicit, and not left to the browser. An unset `type` inside a <form>
       * is `submit`, so a button added to open a panel submits the form — a
       * defect that appears only once somebody moves the button into a form,
       * which is where every button in this console eventually ends up.
       */
      type={type}
      className={CLASS_NAMES}
      data-variant={variant}
      data-tone={tone}
    >
      {children}
    </button>
  )
}

export function ButtonLink({ variant = "text", tone = "neutral", children, ...rest }: ButtonLinkProps) {
  return (
    <Link {...rest} className={CLASS_NAMES} data-variant={variant} data-tone={tone}>
      {children}
    </Link>
  )
}
