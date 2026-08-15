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
 * The Tenure mark and wordmark, as an asset this console can put in a top bar.
 *
 * ## The source of truth is the tenant application, not this file
 *
 * `apps/web/src/components/brand/TenureLogo.tsx` is the brand. Its
 * `TenureWordmark` is the rosette beside the WORD "Tenure", set in the
 * product's own type at 0.85x the mark, semibold, tight tracking. Everything
 * below is that construction expressed in the one element this console's
 * consumers already style.
 *
 * ## What was wrong, and it is the whole reason this file was rewritten
 *
 * The word used to be six `<path>` outlines on a 32-unit grid — a monoline
 * capital "TENURE" nobody at Tenure drew, sitting under a comment explaining
 * how its letters had been optically fitted. It was not the wordmark. A drawn
 * approximation of letterforms is the failure mode that reads as almost-right
 * from across a desk and as a different company's logo up close, and it is
 * worse than plain text because it looks deliberate.
 *
 * So the word is now the word: an SVG `<text>` element whose content is the
 * string `Tenure`, set in `--md-sys-type-font` — the same stack `body` sets in
 * `globals.css`, which is the same stack the tenant app's span inherits.
 *
 * ## Why it is still one `<svg>` and not the tenant's two spans
 *
 * This is the deviation from the tenant component, and it is forced rather
 * than chosen:
 *
 *   * `Logo` is consumed as a sized graphic by files this change does not own.
 *     `signin/signin.module.css` sets `display: block` on `.lockup`, and
 *     `TopBar` puts it in a flex row expecting one box. A wrapper `<span>`
 *     whose `display: inline-flex` loses to that `display: block` is a lockup
 *     whose gap silently collapses on one route only — the exact "almost
 *     right" defect this task exists to remove.
 *   * The proportion has to survive the `size` prop. The tenant reaches it with
 *     `style={{ fontSize: size * 0.85 }}`; an inline style is forbidden in this
 *     directory (`e2e/md3-tokens-logic.spec.ts`, and `Logo.test.tsx` repeats
 *     the check), and relocating the component to dodge that scanner would be
 *     obeying the letter of a rule while breaking it. Inside one `<svg>` the
 *     ratio is geometry: every length below is in the mark's own 32-unit grid,
 *     so 0.85x the mark is 0.85x the mark at 20px and at 96px, with no style
 *     attribute anywhere.
 *
 * The letterforms are identical either way — an SVG `<text>` is typeset by the
 * same font engine as a span. What changes is the box around them.
 *
 * ## `textLength`, which is what makes typesetting safe here
 *
 * The drawn paths did buy one real property: a fixed width. SVG `<text>` is as
 * wide as the face the machine actually has, and this console loads no webfont
 * (`--md-sys-type-font` resolves to Segoe UI on Windows, SF on macOS), so the
 * word's advance differs per platform. Measured in Chromium at this size,
 * semibold, with this tracking: Segoe UI 78.8 units, Roboto 77.5, Arial 84.6.
 * Left alone, the widest of those overflows a box cut for the narrowest, and
 * `e2e/layout.spec.ts` sees an overflow on one runner and not another.
 *
 * `textLength` with `lengthAdjust="spacing"` pins the advance to `WORD_LENGTH`
 * and reaches it by adjusting the gaps BETWEEN glyphs — the glyph outlines are
 * never scaled or distorted. `WORD_LENGTH` is 79.2: the measured Segoe UI
 * advance of 78.755 rounded up so the box closes on it exactly. On the face
 * this console is most often rendered in, the adjustment is 0.6% spread over
 * five gaps and the tracking is the tenant's `tracking-tight` untouched; the
 * worst case in the table above is Arial, tightened by 6%.
 *
 * ## No colour lives here
 *
 * The petals resolve `--md-sys-color-primary` and the word resolves
 * `--md-sys-color-on-surface`, both from the element they render into — the
 * same pairing as the tenant's (`--primary` rosette, foreground word). Which
 * step of the green ramp those roles carry is the token layer's decision, in
 * `globals.css`, where the contrast audit can see it.
 * `e2e/md3-tokens-logic.spec.ts` reads every non-test file in this directory
 * and fails on a hex, an `rgb(`, a colour keyword or an inline `style={`, and
 * it is right to.
 *
 * The one exception in this change is `public/icon.svg`, and it is not in this
 * file: a favicon is fetched as its own document by browser chrome, with no
 * page and therefore no token layer, so `var(--md-sys-color-…)` resolves to
 * nothing and the mark renders invisible. That file asks for the token first
 * and falls back to two literals, and `Logo.test.tsx` measures both against the
 * chrome they are for rather than trusting them.
 *
 * ## The geometry is not redrawn here
 *
 * `PETAL` is imported from `../brand/TenureLogo` rather than copied.
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
 * The word. A string, because it is a word.
 *
 * `Logo.test.tsx` asserts this reaches the markup as text content and that the
 * lockup renders no `<path>` beyond the six petals, which is what fails if
 * anybody draws the letters again.
 */
const WORD = "Tenure"

/* ── The lockup, in the mark's own 32-unit grid ───────────────────────────── */

/**
 * The rosette occupies the full 32-unit box, exactly as `TenureWordmark`
 * renders `<TenureLogo size={size} />` at its own size with no scaling. The
 * mark's ink runs y 3.4 to 28.6, so it stands 25.2 units against a cap band of
 * 19.0 — 1.32x the cap height, which is the tenant's proportion and is what
 * stops a round mark reading as smaller than the letters beside it.
 */
const MARK_BOX = 32

/**
 * 0.85x the mark. `TenureWordmark`'s `fontSize: size * 0.85`, in grid units:
 * 0.85 × 32.
 */
const WORD_SIZE = 27.2

/**
 * The gap, 0.4x the mark.
 *
 * The tenant uses Tailwind `gap-2` — a fixed 8px — beside a mark whose default
 * `size` is 20, so the ratio the brand was drawn at is 8/20. A single `<svg>`
 * scales as a whole and cannot hold a length fixed while the rest of it grows,
 * so the RATIO is what carries over: 0.4 × 32 = 12.8 units. At the top bar's
 * `size={22}` that lands on 8.8px against the tenant's 8px; at the sign-in
 * page's `size={40}` it opens to 16px, where a literal 8px would read as the
 * word crowding the mark.
 */
const WORD_X = MARK_BOX + 12.8

/**
 * The baseline, placed so the cap band is centred on the mark's centre.
 *
 * Cap height measured at 0.70em for the face this stack resolves to
 * (Chromium/Segoe UI; Inter 0.727, SF ~0.71 — a 0.4-unit spread, under a
 * quarter of a pixel at `size={22}`). So the caps run 19.0 units, and centring
 * them on y=16 puts the baseline at 16 + 19.0/2.
 *
 * The tenant's flex `items-center` centres the LINE box rather than the cap
 * band, which sits about 1px lower at this size. Cap-band centring is the one a
 * lockup wants — the line box is padded by a descender the word "Tenure" does
 * not have — and it is the only place this component optically departs from the
 * tenant's CSS.
 */
const WORD_BASELINE = 25.5

/** Tailwind `tracking-tight`, which is what `TenureWordmark` sets. */
const WORD_TRACKING = "-0.025em"

/** Tailwind `font-semibold`. */
const WORD_WEIGHT = 600

/**
 * The advance the word is pinned to: the measured Segoe UI value (78.8 units)
 * rounded up so the lockup box closes exactly on it. See `textLength` above.
 */
const WORD_LENGTH = 79.2

const LOCKUP_WIDTH = WORD_X + WORD_LENGTH
const LOCKUP_HEIGHT = 32

/**
 * The default accessible name.
 *
 * The lockup says "Tenure" because that is the word it sets. The glyph says
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
        /*
          The lone glyph fills its square — 1.12 of the drawn box, the optical
          padding a mark standing by itself in a rail wants. In the lockup the
          rosette is drawn at 1:1, which is what `TenureWordmark` renders, so
          there is no transform to apply.
        */
        transform={mark ? "translate(16 16) scale(1.12) translate(-16 -16)" : undefined}
      >
        {ROTATIONS.map((rotation) => (
          <path key={rotation} d={PETAL} transform={`rotate(${rotation} 16 16)`} />
        ))}
      </g>
      {mark ? null : (
        <text
          x={WORD_X}
          y={WORD_BASELINE}
          /*
            The lockup does not mirror, and this attribute is what stops it.

            `app/layout.tsx` writes `dir` on `<html>` and the pre-paint script
            flips it to `rtl` on request (STUDIO-030-007), and `direction`
            inherits into SVG. In an RTL context `text-anchor: start` means the
            RIGHT edge, so this element — with no `direction` of its own —
            renders from x=44.8 LEFTWARDS. Measured in Chromium: the word's box
            moves from 44.8…124.8 to -34.4…45.6, which puts the letters on top
            of the rosette and hangs the first three off the left of the
            viewBox, where the SVG clips them. The screenshot is "ure" printed
            over the mark.

            It is worth naming as a cost of typesetting the word rather than
            drawing it: `<path>` outlines were direction-immune for free. And
            `e2e/layout.spec.ts`'s RTL pass would not have found it — that
            detector reports text drawn over TEXT, and a wordmark drawn over a
            logotype is text over a graphic.

            `ltr` rather than mirroring, because a wordmark is not laid out
            text: "Tenure" is a Latin word and this is one fixed lockup. The
            SHELL still mirrors around it — in RTL the whole masthead flips and
            the lockup moves to the right-hand side, intact.
          */
          direction="ltr"
          fill="var(--md-sys-color-on-surface)"
          fontFamily="var(--md-sys-type-font)"
          fontSize={WORD_SIZE}
          fontWeight={WORD_WEIGHT}
          letterSpacing={WORD_TRACKING}
          textLength={WORD_LENGTH}
          lengthAdjust="spacing"
        >
          {WORD}
        </text>
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
