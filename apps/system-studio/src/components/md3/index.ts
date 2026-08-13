/**
 * The Material 3 primitives, and the one place a Studio surface imports them
 * from.
 *
 * ── The rule this directory exists to make checkable ────────────────────────
 *
 * **A component may not contain a colour.** Not a hex code, not an `rgb(`, not a
 * colour keyword, not a `style` attribute carrying one. Every colour in this
 * console is a `--md-sys-color-*` role declared once in
 * `src/app/globals.css`, and a component's job is to decide which ROLE applies —
 * never what the role's value is.
 *
 * It is a rule rather than a preference because the contrast guarantee depends
 * on it. `e2e/md3-tokens-logic.spec.ts` computes WCAG 2.2 AA ratios for every
 * token pair in every one of the four theme/contrast combinations, and it can
 * only do that for colours it can find. One literal in one component is a pair
 * the audit does not know exists, in the file the audit is least likely to be
 * pointed at. The spec therefore reads every file in this directory and fails on
 * a literal, so the guarantee and the code cannot drift apart.
 *
 * `docs/architecture/studio-design-system.md` is the written half: what each
 * token group is for, and which role to reach for.
 */

export { Surface } from "./Surface"
export type {
  SurfaceProps,
  SurfaceContainer,
  SurfaceElement,
  SurfaceShape,
  ElevationLevel,
} from "./Surface"

export { Card } from "./Card"
export type { CardProps } from "./Card"

export { Button, ButtonLink } from "./Button"
export type { ButtonProps, ButtonLinkProps, ButtonVariant, ButtonTone } from "./Button"

export { Chip, ChipButton } from "./Chip"
export type { ChipProps, ChipButtonProps } from "./Chip"

export { Badge } from "./Badge"
export type { BadgeProps, BadgeTone } from "./Badge"

export { DataTable } from "./DataTable"
export type { DataTableProps, DataColumn } from "./DataTable"

export { EmptyState } from "./EmptyState"
export type { EmptyStateProps } from "./EmptyState"
