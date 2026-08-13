import type { HTMLAttributes, ReactNode } from "react"

/**
 * The base primitive: a container colour and an elevation.
 *
 * Every other primitive in this directory is a Surface with content rules on
 * top, which is the point — the elevation ramp and the container ladder appear
 * once, in `globals.css`, and a component chooses a LEVEL rather than a shadow.
 *
 * ## Why this is a component and not a class name
 *
 * `class="md3-surface"` alone would be a class name; what makes this worth a
 * module is that the two axes are CLOSED. `container` is one of six and `level`
 * is one of six, so a surface cannot be given a seventh of either, and a
 * reviewer reading a page can see which of the thirty-six combinations it asked
 * for. The stylesheet has a rule for each, so an invalid value is a compile
 * error rather than an element with no background.
 *
 * ## The two axes are independent on purpose
 *
 * Material ties elevation to a surface tint: higher surfaces get more of the
 * primary mixed in. This console does not, because it renders long tables of
 * neutral facts and a tinted table header is a table header with an opinion.
 * Elevation here is a shadow ramp only, and the container ladder is what
 * separates one region from another. Either can be used without the other —
 * `level={0}` with `container="high"` is a flat, distinct panel, and it is the
 * most common combination in a dense console.
 */

/** Where on the container ladder this surface sits. */
export type SurfaceContainer =
  | "lowest"
  | "low"
  | "default"
  | "high"
  | "highest"
  /**
   * A surface that must read as NOT part of the page — a transient panel over
   * the content it describes. It inverts the on-colours with it, and the
   * stylesheet re-points a text button's accent inside one: `primary` on
   * `inverse-surface` is 1.4:1 in the light theme, so the accent has to invert
   * or the button is invisible on exactly one of the two themes.
   */
  | "inverse"

/** Material's elevation ramp, 0 through 5. There is no 6. */
export type ElevationLevel = 0 | 1 | 2 | 3 | 4 | 5

/**
 * Material's corner ramp, by name.
 *
 * The names are Material's; the values in `globals.css` are tighter, because
 * every radius in this console is drawn around a data row, a status pill or a
 * form control and a 28px corner on a table card reads as a toy. What a caller
 * relies on is the ORDER, and that is what the ramp guarantees.
 */
export type SurfaceShape =
  | "none"
  | "extra-small"
  | "small"
  | "medium"
  | "large"
  | "extra-large"
  | "full"

/**
 * The elements a surface may be.
 *
 * A closed list rather than a generic `as`, because the generic version buys
 * polymorphic prop typing this console has no use for and costs every reader of
 * this file a type-level indirection. A surface is a region; these are the five
 * elements a region is.
 */
export type SurfaceElement = "div" | "section" | "article" | "aside" | "li"

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: SurfaceElement
  container?: SurfaceContainer
  level?: ElevationLevel
  shape?: SurfaceShape
  /**
   * Draws the decorative hairline (`--md-sys-color-outline-variant`).
   *
   * Decorative is the operative word and it is the rule stated at the top of the
   * MD3 section in `globals.css`: this edge marks a region that is ALREADY
   * distinguishable by its container colour. A boundary that is the only thing
   * separating a control from the page is drawn with `--md-sys-color-outline`,
   * which is audited at 3:1 (WCAG 2.2 AA 1.4.11); `Button` and `Chip` use that
   * one.
   */
  outlined?: boolean
  children?: ReactNode
}

export function Surface({
  as: Element = "div",
  container = "low",
  level = 0,
  shape = "medium",
  outlined = false,
  className,
  children,
  ...rest
}: SurfaceProps) {
  return (
    <Element
      {...rest}
      className={className ? `md3-surface ${className}` : "md3-surface"}
      data-container={container}
      data-level={level}
      data-shape={shape}
      // The attribute is present only when true. `data-outlined="false"` would
      // be a second thing the stylesheet has to know not to match, and an
      // attribute selector that has to exclude a value is how a "false" ends up
      // styled like a "true".
      {...(outlined ? { "data-outlined": "true" } : {})}
    >
      {children}
    </Element>
  )
}
