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

/* ── The AWS-reading set ───────────────────────────────────────────────────
 *
 * Three primitives that exist because this console's job is to report readings
 * of somebody else's estate, and a reading has three outcomes a consumer UI
 * never has to think about: it worked, it is old, or it could not be taken.
 *
 * `UnknownState` is the load-bearing one. STUDIO-000-007 says a read this
 * engine could not perform must never render as an empty list, and this is how
 * twelve surfaces get that right at once instead of twelve times.
 *
 * ── Two names here also exist in `@/components/states` ──────────────────────
 *
 * `EmptyState` and `UnknownState`. That is a real overlap and it is recorded
 * rather than glossed: `states.tsx` owns the WORD — fourteen governed state
 * names — and this directory owns the MD3 FORM the word takes. Both are driven
 * by the same `AwsRead` union, so they say the same things.
 *
 * A surface importing from both must alias one of them; importing the same name
 * from two modules is a duplicate-identifier error, which is the compiler
 * telling you to decide which layer you meant. Eleven route files import this
 * barrel today and none of them names either component from both.
 */

export { KeyValue } from "./KeyValue"
export type { KeyValueProps, KeyValueItem } from "./KeyValue"

export { StaleIndicator, staleness, formatAge } from "./StaleIndicator"
export type { StaleIndicatorProps, Staleness } from "./StaleIndicator"

export { UnknownState } from "./UnknownState"
export type { UnknownStateProps, UnknownRead } from "./UnknownState"

/* ── Navigation, overlays and forms ────────────────────────────────────────
 *
 * Each of these declines to do something its consumer-Material counterpart
 * does, and each declines for the same reason: nothing in this directory has a
 * `"use client"` directive, so a primitive here does not claim a behaviour it
 * cannot implement without one. `Tabs` are links rather than an ARIA tablist,
 * `Dialog` does not claim `aria-modal`, `Snackbar` does not auto-dismiss, and
 * `Select` is the platform's own control. The reasoning is at the top of each
 * file, and the escape hatch is the same in every case — a route that needs the
 * client behaviour wraps the primitive, rather than this directory pretending.
 */

export { Tabs } from "./Tabs"
export type { TabsProps, TabItem } from "./Tabs"

export { Dialog } from "./Dialog"
export type { DialogProps } from "./Dialog"

export { Snackbar } from "./Snackbar"
export type { SnackbarProps } from "./Snackbar"

export { ProgressIndicator, IndeterminateProgress } from "./ProgressIndicator"
export type { DeterminateProgressProps, IndeterminateProgressProps } from "./ProgressIndicator"

export { Field, describedBy } from "./Field"
export type { FieldProps, FieldText } from "./Field"

export { TextField, TextArea } from "./TextField"
export type { TextFieldProps, TextAreaProps } from "./TextField"

export { Select } from "./Select"
export type { SelectProps, SelectOption } from "./Select"

export { Switch } from "./Switch"
export type { SwitchProps } from "./Switch"

export { SeverityChip, SEVERITIES } from "./SeverityChip"
export type { SeverityChipProps, Severity } from "./SeverityChip"
