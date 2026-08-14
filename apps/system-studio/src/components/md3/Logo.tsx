/*
  A RELATIVE import, and it has to be.

  `@/components/brand/TenureLogo` is correct in the Next build and silently
  wrong under jest: this app has no jest of its own, its component tests run
  through `apps/web`'s config (see the comment in `apps/web/jest.config.js`),
  and that config maps `^@/(.*)$` to `apps/web/src/$1`. So `@/` here resolves to
  the TENANT app's brand file, which declares `PETAL` as a module-local const
  rather than exporting it — the import comes back `undefined`, React drops the
  `d` attribute entirely, and six empty `<path>` elements render as nothing at
  all. That is exactly what happened when this file was first written, and the
  only thing that said so was `Logo.test.tsx` counting the petals.

  Every other file in this directory already imports relatively. This one does
  now too, and the paragraph is here so the next person does not "tidy" it back.
*/
import { PETAL } from "../brand/TenureLogo"

/**
 * The Tenure mark, as an asset this console can actually put in a top bar.
 *
 * ## What was there before
 *
 * `<span className="mark">Tenure</span>` — a word in a pill with a 10px square
 * pseudo-element beside it. That is a placeholder that reads as a logo at a
 * glance and is not one: it cannot be a favicon, it cannot sit in a collapsed
 * rail at 20px without the word wrapping, and the square beside it is not the
 * Tenure rosette. The operator's note was "logo is still not put in there", and
 * this is the file that makes that false.
 *
 * ## Why inline SVG rather than `<img src="/logo.svg">`
 *
 * Three reasons, and each is a property an `<img>` cannot have:
 *
 *   * **It recolours with the theme.** The petals resolve
 *     `--md-sys-color-primary` and the letterforms resolve
 *     `--md-sys-color-on-surface` from the element they are rendered into. An
 *     `<img>` is a separate document; the page's custom properties do not cross
 *     into it, so a themed `<img>` mark means shipping one file per theme and a
 *     rule that swaps them — two assets that can disagree, and do.
 *   * **It costs no request.** The masthead is on every route. A logo that
 *     arrives one round trip after the shell is a logo that pops in.
 *   * **It carries no raster step.** The wordmark is drawn as paths on a 32-unit
 *     grid, so 20px in a rail and 96px in a sign-in card are the same geometry.
 *
 * ## The one colour in this change that IS a literal, and why
 *
 * `public/icon.svg`. A favicon is loaded as its own document by the browser
 * chrome, with no page and therefore no token layer, so `var(--md-sys-color-…)`
 * resolves to nothing there and the mark renders invisible. That file declares
 * two literal tones and switches between them on `prefers-color-scheme`, and
 * `Logo.test.tsx` measures both against the chrome they are for rather than
 * trusting them: the light-chrome tone must clear 3:1 on white, the dark-chrome
 * tone must clear 3:1 on black, and both must be green-family hues. That is the
 * honest shape — the constraint is real, so it is stated, bounded and measured
 * instead of being smuggled in as "just the favicon".
 *
 * Nothing in THIS file carries a colour. `e2e/md3-tokens-logic.spec.ts` reads
 * every non-test file in this directory and fails on a hex, an `rgb(`, a colour
 * keyword or an inline `style={`, and it is right to.
 *
 * ## The geometry is not redrawn here
 *
 * `PETAL` is imported from `@/components/brand/TenureLogo` rather than copied.
 * `tests/architecture/brand-mark-is-one-mark.test.mjs` guards that path against
 * its twin in `apps/web`, and a third copy written out in this file would be a
 * copy that guard does not know exists — the console's logo drifting a control
 * point from the product's, in the way that reads as a rendering bug months
 * later rather than as an edit. The import is what puts this component inside
 * the existing guarantee instead of beside it.
 */

/** The six 60° positions the rosette's single petal is rotated through. */
const ROTATIONS = [0, 60, 120, 180, 240, 300] as const

/**
 * The wordmark, drawn rather than typeset.
 *
 * Monoline geometric capitals on the same 32-unit grid as the rosette: cap top
 * at y=8, baseline at y=24, one stroke weight throughout. Drawn, because SVG
 * `<text>` is typeset by whatever font the machine actually has — a wordmark
 * that is a font reference is a wordmark that is a different shape on a machine
 * missing the font, and the width it occupies in the masthead changes with it,
 * which `layout.spec.ts` would see as an overflow on one runner and not
 * another.
 *
 * The letters are fitted optically rather than on a fixed pitch, which is the
 * correction the first render of this file needed. Stem-to-stem pairs — E|N,
 * N|U, U|R, R|E — carry 5 units of clearance. T|E carries 3, because the T's
 * right side below the crossbar is open and a metrically equal gap there reads
 * as a word break: the first render showed "TE NURE", which is the classic
 * failure of setting a wordmark on a rigid grid.
 *
 * It is Tenure's own: a geometric monoline capital set with a round-jointed U
 * bowl and a straight-legged R. It is not derived from the trade dress of any
 * console this one is measured against (Bible §20).
 */
const WORDMARK = [
  /* T */ "M0 8H13M6.5 8V24",
  /* E */ "M16 8V24M16 8H27.5M16 16H24.5M16 24H27.5",
  /* N */ "M32.5 24V8L45.5 24V8",
  /* U */ "M50.5 8V17C50.5 20.9 53.4 24 57 24C60.6 24 63.5 20.9 63.5 17V8",
  /* R */ "M68.5 24V8H76C79.5 8 81.3 9.8 81.3 12C81.3 14.2 79.5 16 76 16H68.5M75 16L81.5 24",
  /* E */ "M86.5 8V24M86.5 8H98M86.5 16H95M86.5 24H98",
] as const

/**
 * The lockup box.
 *
 * 136 × 32. The rosette is centred at x=14 and scaled to 0.9, which puts its
 * extremities at y 4.66 and 27.34 against a cap band of 8 to 24 — the mark
 * standing about 1.2× the cap height, which is what stops a round mark reading
 * as smaller than the letters beside it. The gap from the rosette's edge to the
 * T is 8.7 units, a little over half a cap height.
 */
const LOCKUP_WIDTH = 136
const LOCKUP_HEIGHT = 32

/** The glyph box: the same rosette, scaled up to 1.12 to fill a square. */
const MARK_BOX = 32

/**
 * The default accessible names.
 *
 * The lockup says "Tenure" because that is the word it draws. The glyph says
 * "Tenure" too — it is the same mark, and a name that described the artwork
 * ("Tenure rosette") would be read aloud to somebody who cannot see that it is
 * a rosette.
 */
const DEFAULT_LABEL = "Tenure"

/**
 * `decorative` and `label` are mutually exclusive at the type level.
 *
 * The defect this shape exists to make unwritable: a mark with an accessible
 * name placed next to a visible "Tenure", which a screen reader reads out as
 * "Tenure Tenure". The caller has to say which of the two it is, and asking for
 * a name on a decorative mark does not compile.
 */
export type LogoProps = {
  /** Glyph only — the collapsed rail, a favicon-sized slot, a compact header. */
  mark?: boolean
  /** Rendered block size in CSS pixels. The inline size follows the aspect. */
  size?: number
  className?: string
} & (
  | {
      /** Beside a visible "Tenure": hidden from the accessibility tree. */
      decorative: true
      label?: never
    }
  | {
      decorative?: false
      /** Overrides the accessible name — e.g. "Tenure System Studio, home". */
      label?: string
    }
)

export function Logo({ mark = false, size = 24, label, decorative = false, className }: LogoProps) {
  /*
    Both dimensions are written as attributes, never left to CSS, because the
    masthead is the first thing painted on every route: an SVG with no intrinsic
    size is laid out at 300×150 until the stylesheet lands, and that is a
    layout shift on every navigation (STUDIO-030-008).
  */
  const height = size
  const width = mark ? size : Math.round((size * LOCKUP_WIDTH) / LOCKUP_HEIGHT)

  /*
    Two mutually exclusive shapes, never a name and a hidden flag together.
    `focusable` is set in both: IE-era SVG put every <svg> in the tab order, and
    a focus stop with no action is a keyboard trap-shaped nuisance either way.
  */
  const naming = decorative
    ? ({ "aria-hidden": true, focusable: false } as const)
    : ({ role: "img", "aria-label": label ?? DEFAULT_LABEL, focusable: false } as const)

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={mark ? `0 0 ${MARK_BOX} ${MARK_BOX}` : `0 0 ${LOCKUP_WIDTH} ${LOCKUP_HEIGHT}`}
      width={width}
      height={height}
      className={className}
      {...naming}
    >
      <g
        fill="var(--md-sys-color-primary)"
        transform={
          mark
            ? "translate(16 16) scale(1.12) translate(-16 -16)"
            : "translate(14 16) scale(0.9) translate(-16 -16)"
        }
      >
        {ROTATIONS.map((rotation) => (
          <path key={rotation} d={PETAL} transform={`rotate(${rotation} 16 16)`} />
        ))}
      </g>
      {mark ? null : (
        <g
          transform="translate(35 0)"
          fill="none"
          stroke="var(--md-sys-color-on-surface)"
          strokeWidth={3}
          strokeLinecap="butt"
          strokeLinejoin="round"
        >
          {WORDMARK.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      )}
    </svg>
  )
}

/** Where the favicon lives, named once so the test and the metadata agree. */
export const LOGO_ICON_PATH = "/icon.svg"

/**
 * The `icons` field for `app/layout.tsx`'s exported `metadata`.
 *
 * Exported from here rather than written there so the path and the file cannot
 * drift: `Logo.test.tsx` asserts that whatever this names exists under
 * `public/`, which a string typed straight into the layout would not be.
 *
 * Only the SVG ships. A raster fallback for the browsers that predate SVG
 * favicons would have to be generated by a rasteriser this change does not
 * add, and a checked-in binary nobody in this change could open and look at is
 * worse than an honest gap.
 */
export const LOGO_ICONS = {
  icon: [{ url: LOGO_ICON_PATH, type: "image/svg+xml" }],
} as const
