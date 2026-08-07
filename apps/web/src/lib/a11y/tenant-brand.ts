/**
 * TTES-010-004 — the contrast gate on tenant branding.
 *
 * Bible §14: "Automated contrast/gamut checks reject unsafe tenant tokens."
 * What existed validated only the SYNTAX. `packages/platform-config/src/
 * branding.ts` checks each value against `/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/`
 * — which is the right check for the injection risk it was written for, and no
 * check at all for the thing the Bible clause is about. A tenant setting
 * `primaryColor: "#ffff00"` against the default `primaryTextColor: "#ffffff"`
 * shipped a 1.07:1 primary button, on the most-clicked control in the product,
 * and nothing measured it: the contrast audit reads the four STATIC themes out
 * of the stylesheet, and tenant CSS is injected after that, at
 * `src/app/(app)/layout.tsx`.
 *
 * So this measures it, with the same arithmetic the static audit uses, at the
 * one place a tenant's colours enter a page. A value that fails is dropped back
 * to the platform default and the reason is returned — dropped rather than
 * clamped, because a colour nudged until it passes is no longer the colour the
 * institution asked for and nobody told them.
 *
 * WHICH THEMES THIS IS MEASURED IN, and why it is not all four
 *
 * Tenant branding arrives as an injected `:root { --primary: … }` block.
 * `:root` has specificity (0,1,0); the dark palette is declared in `html.dark`,
 * which has (0,1,1). The dark block therefore outranks the injected one, and a
 * tenant's accent reaches the light themes only. Measuring it against the dark
 * card would reject every deep navy and maroon in higher education for a
 * contrast failure that does not happen. `THEME_SWATCHES` carries that fact per
 * theme, and `tenant-brand.test.ts` proves the premise from the stylesheet
 * rather than from this paragraph.
 */
import { BRANDING_DEFINITIONS, type Branding } from "@tenure/platform-config"

import { AA_THRESHOLD, contrastRatio, parseColor } from "./contrast"

/** The platform default for a branding key, read from the definition that owns it. */
function platformDefault(key: string): string {
  const definition = BRANDING_DEFINITIONS.find((d) => d.key === key)
  if (!definition) throw new Error(`no branding definition for ${key}`)
  return definition.default as string
}

export const DEFAULT_PRIMARY = platformDefault("platform.branding.primaryColor")
export const DEFAULT_PRIMARY_TEXT = platformDefault("platform.branding.primaryTextColor")

/**
 * The surface a tenant's accent is measured against, and everything the preview
 * needs to draw a theme it is not currently rendering in.
 *
 * A hand-copied palette is the failure `theme-tokens.ts` exists to prevent, so
 * this table is reconciled against the real stylesheet by `tenant-brand.test.ts`
 * — token by token, in every theme. It is a table rather than a stylesheet read
 * because this module runs in the bundle, where `node:fs` and a build-relative
 * path to `globals.css` do not exist.
 */
export interface ThemeSwatch {
  theme: "light" | "dark" | "light-contrast" | "dark-contrast"
  label: string
  /** `--bg-surface` — the card an accent control sits on. */
  surface: string
  /** `--text-1`. */
  text: string
  /** `--border-focus` — the focus ring, which branding cannot reach. */
  focusRing: string
  /** `--primary` as the stylesheet declares it for this theme. */
  platformPrimary: string
  /** Whether an injected `:root { --primary }` wins here. See the header. */
  brandApplies: boolean
}

export const THEME_SWATCHES: readonly ThemeSwatch[] = [
  {
    theme: "light",
    label: "Light",
    surface: "#fbfaf7",
    text: "#191a1c",
    focusRing: "#198052",
    platformPrimary: "#198052",
    brandApplies: true,
  },
  {
    theme: "dark",
    label: "Dark",
    surface: "#0f1113",
    text: "#f2f3f5",
    focusRing: "#2bb673",
    platformPrimary: "#2bb673",
    brandApplies: false,
  },
  {
    theme: "light-contrast",
    label: "Light · high contrast",
    surface: "#fbfaf7",
    text: "#000000",
    focusRing: "#198052",
    platformPrimary: "#0f6b42",
    brandApplies: true,
  },
  {
    theme: "dark-contrast",
    label: "Dark · high contrast",
    surface: "#0f1113",
    text: "#ffffff",
    focusRing: "#2bb673",
    platformPrimary: "#34d399",
    brandApplies: false,
  },
]

/** The surfaces a tenant accent actually paints on. */
export const BRANDED_SURFACES = THEME_SWATCHES.filter((s) => s.brandApplies)

export interface BrandRejection {
  /** The configuration key that was dropped. */
  token: string
  /** What it was measured against, named for a human. */
  against: string
  /** The measured ratio, rounded to two places the way `meetsAA` reports. */
  ratio: number
  /** The WCAG floor it had to clear. */
  floor: number
  /** The value that was refused, and what it fell back to. */
  refused: string
  fallback: string
}

export interface BrandAssessment {
  accepted: Branding
  rejections: BrandRejection[]
}

const round = (ratio: number) => Math.round(ratio * 100) / 100

/**
 * Measures a tenant's branding and returns the branding that is safe to ship.
 *
 * Two floors, both from WCAG 2.2 AA and both named for what they protect:
 *
 *   * the accent against the text drawn ON it — 1.4.3, 4.5:1. This is the
 *     primary button's label, and it is the pairing `#ffff00` on `#ffffff`
 *     breaks completely.
 *   * the accent against the card it sits on — 1.4.11, 3:1. A button whose fill
 *     has no edge against the surface is a button a low-vision user cannot find,
 *     even when its label is perfectly legible.
 *
 * Order matters. The accent is checked against the surface first, because if it
 * is dropped there the text pairing has to be re-measured against the default.
 * The text colour is preferred as the thing to drop when a PAIR fails: an
 * institution's colour is the identity, the ink on it is the consequence.
 */
export function assessBrand(
  branding: Branding,
  surfaces: readonly ThemeSwatch[] = BRANDED_SURFACES,
): BrandAssessment {
  const rejections: BrandRejection[] = []

  const reject = (
    token: string,
    against: string,
    ratio: number,
    floor: number,
    refused: string,
    fallback: string,
  ) => {
    rejections.push({ token, against, ratio: round(ratio), floor, refused, fallback })
    return fallback
  }

  // 0 — a value that is not a colour cannot be measured, so it cannot be
  //     accepted. This should be unreachable: every value passed its schema at
  //     publication. "Should be unreachable" is why it is checked here, at the
  //     point the value enters a page, rather than trusted from the far end of a
  //     call chain.
  let primary = parseColor(branding.primaryColor)
    ? branding.primaryColor
    : reject("platform.branding.primaryColor", "a colour this can measure", 0, AA_THRESHOLD.nonText, branding.primaryColor, DEFAULT_PRIMARY)
  let primaryText = parseColor(branding.primaryTextColor)
    ? branding.primaryTextColor
    : reject("platform.branding.primaryTextColor", "a colour this can measure", 0, AA_THRESHOLD.body, branding.primaryTextColor, DEFAULT_PRIMARY_TEXT)

  // 1 — the accent against every surface it paints on. WCAG 1.4.11: the fill IS
  //     the affordance, so a button with no edge against its card is a button a
  //     low-vision user cannot find however legible its label is.
  for (const swatch of surfaces) {
    if (primary === DEFAULT_PRIMARY) break
    const ratio = contrastRatio(primary, swatch.surface)
    if (ratio >= AA_THRESHOLD.nonText) continue
    primary = reject(
      "platform.branding.primaryColor",
      `the ${swatch.label.toLowerCase()} card surface`,
      ratio,
      AA_THRESHOLD.nonText,
      primary,
      DEFAULT_PRIMARY,
    )
  }

  // 2 — the label drawn on the accent, against whatever the accent now is.
  //     WCAG 1.4.3, 4.5:1. This is the pairing #ffff00 on #ffffff breaks.
  const pairRatio = contrastRatio(primaryText, primary)
  if (pairRatio < AA_THRESHOLD.body) {
    if (contrastRatio(DEFAULT_PRIMARY_TEXT, primary) >= AA_THRESHOLD.body) {
      // The institution's colour survives; the ink on it does not. That is the
      // right way round — the colour is the identity, the ink is a consequence.
      primaryText = reject(
        "platform.branding.primaryTextColor",
        "the accent it is drawn on",
        pairRatio,
        AA_THRESHOLD.body,
        primaryText,
        DEFAULT_PRIMARY_TEXT,
      )
    } else {
      // Neither the tenant's ink nor the platform's is legible on this accent.
      primary = reject(
        "platform.branding.primaryColor",
        "the label drawn on it",
        pairRatio,
        AA_THRESHOLD.body,
        primary,
        DEFAULT_PRIMARY,
      )
      const afterFallback = contrastRatio(primaryText, primary)
      if (afterFallback < AA_THRESHOLD.body) {
        primaryText = reject(
          "platform.branding.primaryTextColor",
          "the accent it is drawn on",
          afterFallback,
          AA_THRESHOLD.body,
          primaryText,
          DEFAULT_PRIMARY_TEXT,
        )
      }
    }
  }

  return {
    accepted: { ...branding, primaryColor: primary, primaryTextColor: primaryText },
    rejections,
  }
}

/** The ratios a preview reports, measured on the branding that will actually ship. */
export function measuredRatios(accepted: Branding): {
  label: number
  surfaces: { label: string; ratio: number; floor: number; passes: boolean }[]
} {
  return {
    label: round(contrastRatio(accepted.primaryTextColor, accepted.primaryColor)),
    surfaces: THEME_SWATCHES.map((swatch) => {
      const accent = swatch.brandApplies ? accepted.primaryColor : swatch.platformPrimary
      const ratio = round(contrastRatio(accent, swatch.surface))
      return {
        label: swatch.label,
        ratio,
        floor: AA_THRESHOLD.nonText,
        passes: ratio >= AA_THRESHOLD.nonText,
      }
    }),
  }
}
