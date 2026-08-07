"use client"

import { Button as AriaButton, type ButtonProps as AriaButtonProps } from "react-aria-components"
import { cva, type VariantProps } from "class-variance-authority"

/**
 * The owned button — the only button a product module may build on.
 *
 * `eslint.config.mjs` (`RESTRICTED_VENDOR_IMPORTS`) refuses
 * `react-aria-components` and `class-variance-authority` anywhere outside
 * `src/components/ui/**`, so the vendor is named here and in the other
 * wrappers, and nowhere in a domain module. That rule is only honest while
 * every shape a caller needs is a variant here, which is why `shell` exists:
 * the app shell's chrome buttons (header user menu, tenant switcher,
 * notification bell) used to hand-write the same
 * `data-[hovered]:bg-[--shell-item-hover]` string in three files.
 *
 * Radius and the focus-ring offset live on the variants rather than the base
 * so a variant can differ without depending on Tailwind's stylesheet ordering
 * to break the tie — `rounded-lg` beating `rounded-md` because of where the
 * two land in the generated CSS is not a thing to build on.
 */

/**
 * The variant and size maps are named consts rather than object literals inline
 * in the `cva()` call because `cva` does not expose its configuration at
 * runtime — the function it returns is opaque. `src/components/ui/gallery-catalog.ts`
 * reads `Object.keys(BUTTON_VARIANTS)` / `BUTTON_SIZES` to build the visual
 * baseline matrix, so adding a variant here adds a screenshot cell that has no
 * baseline yet and `e2e/visual-baselines.spec.ts` fails. Re-listing the names in
 * the catalogue would have let a new variant ship unphotographed.
 */
export const BUTTON_VARIANTS = {
  primary: [
    "rounded-md data-[focus-visible]:ring-offset-2",
    "bg-[--primary] text-[--primary-text] shadow-xs",
    "data-[hovered]:bg-[--primary-hover]",
    "data-[pressed]:bg-[--primary-press]",
  ],
  accent: [
    "rounded-md data-[focus-visible]:ring-offset-2",
    "bg-[--accent] text-[--accent-text] shadow-xs",
    "data-[hovered]:bg-[--accent-hover]",
    "data-[pressed]:bg-[--accent-strong]",
  ],
  secondary: [
    "rounded-md data-[focus-visible]:ring-offset-2",
    "bg-surface text-[--text-1] border border-[--border-strong]",
    "data-[hovered]:bg-[--bg-base] data-[hovered]:border-[--text-3]",
    "data-[pressed]:bg-[--bg-subtle]",
  ],
  ghost: [
    "rounded-md data-[focus-visible]:ring-offset-2",
    "text-[--text-2]",
    "data-[hovered]:bg-[--bg-base] data-[hovered]:text-[--text-1]",
    "data-[pressed]:bg-[--bg-subtle]",
  ],
  destructive: [
    "rounded-md data-[focus-visible]:ring-offset-2",
    "bg-[--error] text-white shadow-xs",
    "data-[hovered]:opacity-90",
    "data-[pressed]:opacity-80",
  ],
  link: [
    // rounded-md, not rounded-none: the base used to carry rounded-md and
    // won on stylesheet order, so this is what a link button has always
    // rendered as. Stating it keeps the rendering and drops the lie.
    "rounded-md data-[focus-visible]:ring-offset-2",
    "text-[--text-link] underline-offset-4",
    "data-[hovered]:underline",
  ],
  /**
   * Chrome inside the fixed app shell: header, tenant switcher, bell.
   * Tinted by the `--shell-*` tokens rather than the page palette, and
   * with no ring offset because the shell has no page background behind
   * the control for an offset ring to sit on.
   */
  shell: [
    "rounded-lg text-[--shell-text-secondary]",
    "data-[hovered]:bg-[--shell-item-hover] data-[hovered]:text-[--shell-text]",
    "data-[pressed]:bg-[--shell-item-hover]",
  ],
} as const

/**
 * Page-control heights come from the density contract (globals.css
 * `--control-h*`), so `data-density="compact"` on <html> shrinks every button
 * in the product at once. Comfortable resolves to exactly the h-8 / h-10 / h-11
 * these replaced, so binding them moved nothing. `icon` takes `w-control` too,
 * or compact turns a square button into an oblong one.
 *
 * The two `shell*` sizes deliberately stay on a fixed 36px: they sit inside a
 * 52px header whose height is not a density decision, and shrinking the control
 * inside a fixed bar just adds dead space.
 */
export const BUTTON_SIZES = {
  sm: "h-control-sm px-3.5 text-[13px]",
  md: "h-control px-4 text-sm",
  lg: "h-control-lg px-6 text-[15px]",
  icon: "h-control w-control p-0",
  shell: "h-9 px-2 text-sm",
  shellIcon: "h-9 w-9 p-0",
} as const

const button = cva(
  [
    "inline-flex items-center justify-center gap-2 font-medium transition-colors cursor-default",
    "outline-none",
    "data-[focus-visible]:ring-2 data-[focus-visible]:ring-[--border-focus]",
    "data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed",
  ],
  {
    variants: {
      variant: BUTTON_VARIANTS,
      size: BUTTON_SIZES,
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
)

export interface ButtonProps
  extends AriaButtonProps,
    VariantProps<typeof button> {
  className?: string
}

export function Button({ variant, size, className, ...props }: ButtonProps) {
  return (
    <AriaButton
      {...props}
      className={button({ variant, size, className })}
    />
  )
}
