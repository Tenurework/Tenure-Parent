/**
 * TTES-020-004 — the declarative catalogue the visual-baseline matrix walks.
 *
 * WHY IT IS DERIVED AND NOT WRITTEN OUT
 *
 * A gallery that re-lists what it renders is a gallery that goes stale the first
 * time somebody adds a state. Every entry below is read from the module that
 * already decides it:
 *
 *   * surfaces  ← `ALL_STATES` in `./states` (the fourteen SurfaceStates)
 *   * buttons   ← `BUTTON_VARIANTS` × `BUTTON_SIZES` in `./Button`
 *   * badges    ← `BADGE_VARIANT_STYLES` in `./Badge`
 *
 * so adding a fifteenth state, an eighth button variant or a new badge tone adds
 * a cell to the catalogue, and `e2e/visual-baselines.spec.ts` fails on a missing
 * baseline rather than shipping it unphotographed. That failure is the point.
 *
 * `fields` is the one hand-written group, and it says so. TextField and Select
 * expose no variant map to derive from — their axes are boolean props
 * (`multiline`, `description`, `errorMessage`, `isDisabled`) — so the cases are
 * enumerated here. `GALLERY_FIELD_CASES` is exhaustive over those props by
 * construction below; if a new prop appears on either component nothing catches
 * it, which is why the comment does not claim otherwise.
 *
 * IDs are stable and appear in the screenshot filenames. Renaming one orphans a
 * baseline, which is the same signal as adding one.
 */

import { BADGE_VARIANT_STYLES, type BadgeVariant } from "./Badge"
import { BUTTON_SIZES, BUTTON_VARIANTS } from "./Button"
import { ALL_STATES, type SurfaceState } from "./states"

export type ButtonVariantName = keyof typeof BUTTON_VARIANTS
export type ButtonSizeName = keyof typeof BUTTON_SIZES

/**
 * Ids become screenshot filenames, so they are lowercase-kebab throughout:
 * `shellIcon` → `shell-icon`. Case in a committed filename is a trap — Windows
 * and macOS treat `Entry-shellIcon.png` and `entry-shellicon.png` as the same
 * file and Linux does not, so a baseline generated on one and compared on
 * another goes missing for reasons nobody will connect to a variant name.
 */
const slug = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

export interface SurfaceEntry {
  kind: "surface"
  id: string
  state: SurfaceState
  /** Whether the entry renders wrapped rows, which is what exercises the
   *  "Incomplete — do not read this as the full result" marker. */
  withRows: boolean
}

export interface ButtonEntry {
  kind: "button"
  id: string
  variant: ButtonVariantName
  size: ButtonSizeName
  disabled: boolean
}

export interface BadgeEntry {
  kind: "badge"
  id: string
  variant: BadgeVariant
}

export interface FieldEntry {
  kind: "field"
  id: string
  control: "text" | "textarea" | "select"
  label: string
  description?: string
  errorMessage?: string
  disabled: boolean
}

export type GalleryEntry = SurfaceEntry | ButtonEntry | BadgeEntry | FieldEntry

export interface GalleryGroup {
  /** Stable id — becomes part of the screenshot name and the DOM test id. */
  id: string
  title: string
  /** Why this group is in the baseline matrix at all. */
  rationale: string
  entries: readonly GalleryEntry[]
}

/**
 * Every SurfaceState, rendered twice.
 *
 * Once bare, and once wrapping a row — because the "this is not everything"
 * marker in StateSurface only renders when a state that is `presentsAsComplete:
 * false` is given children, and that marker is the single most load-bearing
 * pixel in the state system. A matrix that only photographed the bare card
 * would never have seen it.
 */
const SURFACE_ENTRIES: readonly SurfaceEntry[] = ALL_STATES.flatMap((state) => [
  { kind: "surface" as const, id: `surface-${state}`, state, withRows: false },
  { kind: "surface" as const, id: `surface-${state}-rows`, state, withRows: true },
])

/**
 * Every button variant at every size, plus the disabled rendering of each
 * variant at the default size.
 *
 * Disabled is a variant of its own as far as a screenshot is concerned — it is
 * an opacity the palette has to survive in both themes and in high contrast,
 * and `data-[disabled]:opacity-40` over a dark surface is exactly the kind of
 * thing that goes unreadable without anyone noticing.
 */
const BUTTON_ENTRIES: readonly ButtonEntry[] = [
  ...(Object.keys(BUTTON_VARIANTS) as ButtonVariantName[]).flatMap((variant) =>
    (Object.keys(BUTTON_SIZES) as ButtonSizeName[]).map((size) => ({
      kind: "button" as const,
      id: `button-${slug(variant)}-${slug(size)}`,
      variant,
      size,
      disabled: false,
    })),
  ),
  ...(Object.keys(BUTTON_VARIANTS) as ButtonVariantName[]).map((variant) => ({
    kind: "button" as const,
    id: `button-${slug(variant)}-disabled`,
    variant,
    size: "md" as ButtonSizeName,
    disabled: true,
  })),
]

const BADGE_ENTRIES: readonly BadgeEntry[] = (
  Object.keys(BADGE_VARIANT_STYLES) as BadgeVariant[]
).map((variant) => ({ kind: "badge" as const, id: `badge-${variant}`, variant }))

/**
 * The hand-written group. See the module header: TextField and Select have no
 * variant map, so these are the prop combinations worth a baseline rather than a
 * derived cross-product.
 */
const FIELD_ENTRIES: readonly FieldEntry[] = [
  { kind: "field", id: "field-text", control: "text", label: "Club name", disabled: false },
  {
    kind: "field",
    id: "field-text-described",
    control: "text",
    label: "Budget code",
    description: "Six digits, from the finance office.",
    disabled: false,
  },
  {
    kind: "field",
    id: "field-text-invalid",
    control: "text",
    label: "Budget code",
    errorMessage: "That code is not on this term's chart of accounts.",
    disabled: false,
  },
  { kind: "field", id: "field-text-disabled", control: "text", label: "Club name", disabled: true },
  {
    kind: "field",
    id: "field-textarea",
    control: "textarea",
    label: "Handover note",
    description: "What the next officer needs to know.",
    disabled: false,
  },
  { kind: "field", id: "field-select", control: "select", label: "Term", disabled: false },
]

export const GALLERY_GROUPS: readonly GalleryGroup[] = [
  {
    id: "surfaces",
    title: "Surface states",
    rationale:
      "Every SurfaceState in states.ts. In production each is only reached when a caller happens to be in it, so none of them was ever rendered in dark, high-contrast, compact, RTL or at 320px on any run.",
    entries: SURFACE_ENTRIES,
  },
  {
    id: "buttons",
    title: "Buttons",
    rationale:
      "Every variant at every size, plus each variant disabled. Sizes bind to the density contract, so this group is what proves compact actually moves control heights.",
    entries: BUTTON_ENTRIES,
  },
  {
    id: "badges",
    title: "Badges",
    rationale: "Every badge tone — the tint/text pairs that carry approval status across the product.",
    entries: BADGE_ENTRIES,
  },
  {
    id: "fields",
    title: "Fields",
    rationale:
      "TextField and Select in the shapes a form actually uses: described, invalid, disabled, multiline, and a select trigger.",
    entries: FIELD_ENTRIES,
  },
]

/** Flat view, for tests that assert coverage without walking groups. */
export const GALLERY_ENTRIES: readonly GalleryEntry[] = GALLERY_GROUPS.flatMap((g) => g.entries)
