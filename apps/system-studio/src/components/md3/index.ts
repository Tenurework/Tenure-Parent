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

/* ── Two primitives owned elsewhere, exported here ─────────────────────────
 *
 * `Logo.tsx` (the mark) and `DangerZone.tsx` (STUDIO-030-004's spatially
 * separated irreversible actions) were written alongside this set by other
 * hands. They are exported from here because this barrel is the only place a
 * route may import a primitive from, and `md3-tokens-logic.spec.ts` reds the
 * build for any component in the directory that cannot be reached through it —
 * "a primitive that exists but is not exported is one each route either imports
 * by deep path or, far more likely, reimplements locally with a `<div>` and a
 * colour". Their APIs are theirs; only these two lines are this file's.
 */

export { Logo, LOGO_ICONS, LOGO_ICON_PATH } from "./Logo"
export type { LogoProps } from "./Logo"

export {
  DangerZone,
  DANGER_ZONE_ATTRIBUTE,
  DANGER_ZONE_GROUP,
  DANGER_ZONE_LEGEND,
  DANGER_ZONE_REGION,
  IRREVERSIBLE,
  REVERSIBLE,
  RISK_ATTRIBUTE,
  classifyConsequence,
  isIrreversible,
} from "./DangerZone"
export type { Consequence, DangerAction, DangerZoneProps } from "./DangerZone"

/* ── The interactive set ───────────────────────────────────────────────────
 *
 * STUDIO-030-003. Everything above this line renders in either tree because no
 * file above it carries `"use client"`. Everything below either carries one or
 * is a pure module, and that split is deliberate rather than incidental.
 *
 * The note at the top of this barrel says a primitive here "does not claim a
 * behaviour it cannot implement without client JavaScript" — `Tabs` are links,
 * `Dialog` does not claim `aria-modal`, `Snackbar` has no timer. That rule is
 * intact. What has changed is that the escape hatch each of those files names
 * ("a route that needs the client behaviour wraps the primitive, rather than
 * this directory pretending") now exists as primitives instead of as advice, so
 * a route that needs a menu gets one with a keyboard model rather than a
 * `<details>` with a list in it.
 *
 * The keyboard model itself is NOT in the components. `interaction.ts` is pure
 * — no DOM, no React — so the twenty-odd branches per widget (End on a list
 * whose last two items are disabled, ArrowLeft on a collapsed tree node,
 * repeated-character type-ahead) are enumerated in
 * `e2e/md3-primitives-logic.spec.ts` at node speed, and the components are
 * adapters proven in jsdom by `Primitives.test.tsx`.
 *
 * Importing one of these from a server component is fine: Next turns a
 * `"use client"` module into a client reference at the import boundary, and the
 * eleven route files that already import this barrel pull in only what they
 * name.
 *
 * ## The two primitives from the requirement that are not new files
 *
 *   * **Command menu** — `@/components/CommandPalette`, which predates this set
 *     and is already keyboard-complete (focus captured on open, restored on
 *     close, no history entry). It is a console component rather than a
 *     primitive, so it stays where it is rather than being duplicated here.
 *   * **Toast** — `Snackbar` is the message; `ToastRegion` below is the live
 *     region that announces a stack of them.
 */

export {
  ACTIVATION_KEYS,
  DISMISS_KEY,
  FOCUSABLE_SELECTOR,
  TYPEAHEAD_RESET_MS,
  filterOptions,
  firstEnabled,
  isActivation,
  isDismiss,
  isTypeaheadKey,
  lastEnabled,
  listCommand,
  nextTrapStop,
  step,
  treeCommand,
  treeRows,
  typeaheadBuffer,
  typeaheadIndex,
} from "./interaction"
export type {
  Direction,
  FilterableOption,
  ListCommand,
  ListState,
  Orientation,
  TreeCommand,
  TreeNode,
  TreeRow,
} from "./interaction"

export { openLayerCount, useDismissableLayer, useFocusTrap, useModalHost } from "./hooks"
export type { DismissableLayerOptions } from "./hooks"

export { Popover } from "./Popover"
export type { PopoverProps } from "./Popover"

export { Menu } from "./Menu"
export type { MenuProps, MenuGroup, MenuItem } from "./Menu"

export { ModalDialog } from "./ModalDialog"
export type { ModalDialogProps } from "./ModalDialog"

export { Drawer } from "./Drawer"
export type { DrawerProps } from "./Drawer"

export { Tooltip } from "./Tooltip"
export type { TooltipProps } from "./Tooltip"

export { Accordion } from "./Accordion"
export type { AccordionProps, AccordionSection } from "./Accordion"

export { Tree } from "./Tree"
export type { TreeProps } from "./Tree"

export { Combobox } from "./Combobox"
export type { ComboboxProps, ComboboxOption } from "./Combobox"

export { ToastRegion, LIMIT as TOAST_LIMIT } from "./ToastRegion"
export type { ToastRegionProps, ToastMessage } from "./ToastRegion"

export { CodeBlock, DiffView } from "./Code"
export type { CodeBlockProps, DiffViewProps } from "./Code"

export { diffLines, describeDiff, MAX_DIFF_CELLS } from "./diff"
export type { DiffKind, DiffResult, DiffRow } from "./diff"

export { DateTimeField } from "./DateTimeField"
export type { DateTimeFieldProps } from "./DateTimeField"

export { combineDateTime, formatUtc, splitIso, DATE_PATTERN, TIME_PATTERN } from "./datetime"
export type { DateTimeProblem, DateTimeResult } from "./datetime"

export { Stepper } from "./Stepper"
export type { StepperProps, Step, StepStatus } from "./Stepper"

export { FileUpload } from "./FileUpload"
export type { FileUploadProps } from "./FileUpload"

export { checkFiles, describeSelection, formatBytes, matchesAccept } from "./files"
export type { FileCandidate, FileCheckResult, FileRejection, FileRules } from "./files"

export { Chart } from "./Chart"
export type { ChartProps } from "./Chart"

export {
  DEFAULT_BOX,
  describeSeries,
  domainOf,
  niceTicks,
  scaleX,
  scaleY,
  seriesPath,
} from "./chart-model"
export type { Box, ChartPoint, ChartSeries, Domain } from "./chart-model"
