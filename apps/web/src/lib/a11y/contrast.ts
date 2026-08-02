/**
 * GE-022-003 — WCAG 2.2 contrast, computed rather than asserted.
 *
 * A design system's contrast claim is either arithmetic or it is a hope. This
 * is the arithmetic: sRGB → relative luminance → ratio, exactly as WCAG 2.x
 * §1.4.3 defines it, so a token pair either passes or it does not and nobody
 * has to squint at it.
 *
 * The part that is easy to get wrong is **alpha**. Contrast is undefined for a
 * translucent colour — `rgba(43, 182, 115, 0.14)` has no luminance until you
 * know what is behind it. Several real tokens are translucent (every dark-theme
 * badge background, `--primary-light`, `--accent-light`), so compositing is
 * load-bearing here, not a nicety. Computing the ratio against the raw rgb and
 * ignoring the alpha reports a number that is not what anyone sees.
 */

export interface Rgb {
  r: number
  g: number
  b: number
  /** 0–1. 1 is opaque. */
  a: number
}

/**
 * Parses the colour syntaxes that actually appear in `globals.css`:
 * `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb(...)` and `rgba(...)`.
 *
 * Returns null rather than throwing for anything else — `var(...)`, a gradient,
 * a keyword — so a caller can tell "not a colour" from "a colour that fails".
 */
export function parseColor(input: string): Rgb | null {
  const value = input.trim()

  const hex = /^#([0-9a-f]{3,8})$/i.exec(value)
  if (hex) {
    const digits = hex[1]
    const expand = (s: string) => parseInt(s.length === 1 ? s + s : s, 16)
    if (digits.length === 3 || digits.length === 4) {
      return {
        r: expand(digits[0]),
        g: expand(digits[1]),
        b: expand(digits[2]),
        a: digits.length === 4 ? expand(digits[3]) / 255 : 1,
      }
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        r: expand(digits.slice(0, 2)),
        g: expand(digits.slice(2, 4)),
        b: expand(digits.slice(4, 6)),
        a: digits.length === 8 ? expand(digits.slice(6, 8)) / 255 : 1,
      }
    }
    return null
  }

  const fn = /^rgba?\(([^)]+)\)$/i.exec(value)
  if (fn) {
    const parts = fn[1].split(/[,/\s]+/).filter(Boolean)
    if (parts.length < 3) return null
    const channel = (s: string) => {
      const n = s.endsWith("%") ? (parseFloat(s) / 100) * 255 : parseFloat(s)
      return Number.isFinite(n) ? Math.min(255, Math.max(0, n)) : null
    }
    const r = channel(parts[0])
    const g = channel(parts[1])
    const b = channel(parts[2])
    if (r === null || g === null || b === null) return null
    let a = 1
    if (parts[3] !== undefined) {
      a = parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
      if (!Number.isFinite(a)) return null
      a = Math.min(1, Math.max(0, a))
    }
    return { r, g, b, a }
  }

  return null
}

/**
 * Composites `fg` over `backdrop` (simple source-over).
 *
 * The backdrop must be opaque; a translucent thing on a translucent thing has
 * no defined contrast, and silently treating the second as opaque would report
 * a ratio nobody sees.
 */
export function composite(fg: Rgb, backdrop: Rgb): Rgb {
  if (backdrop.a !== 1) {
    throw new Error("composite(): the backdrop must be opaque, or the result is not what is rendered")
  }
  if (fg.a === 1) return fg
  const blend = (f: number, b: number) => f * fg.a + b * (1 - fg.a)
  return {
    r: blend(fg.r, backdrop.r),
    g: blend(fg.g, backdrop.g),
    b: blend(fg.b, backdrop.b),
    a: 1,
  }
}

/** WCAG 2.x relative luminance. The 0.03928 knee and 2.4 exponent are the spec's. */
export function relativeLuminance(color: Rgb): number {
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

/**
 * Contrast ratio, 1–21.
 *
 * Both colours are composited onto `backdrop` first when translucent, because
 * that is what the eye is given.
 */
export function contrastRatio(a: string | Rgb, b: string | Rgb, backdrop?: string | Rgb): number {
  const toRgb = (v: string | Rgb) => (typeof v === "string" ? parseColor(v) : v)
  const parsedA = toRgb(a)
  const parsedB = toRgb(b)
  if (!parsedA || !parsedB) {
    throw new Error(`contrastRatio(): not a colour — ${JSON.stringify([a, b])}`)
  }

  const base = backdrop ? toRgb(backdrop) : null
  const resolve = (c: Rgb) => {
    if (c.a === 1) return c
    if (!base) {
      throw new Error("contrastRatio(): a translucent colour needs an explicit opaque backdrop")
    }
    return composite(c, base)
  }

  const la = relativeLuminance(resolve(parsedA))
  const lb = relativeLuminance(resolve(parsedB))
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * The three AA thresholds, named for what they apply to rather than by number,
 * because "3.0" applied to body text is the mistake this naming prevents.
 *
 *   * `body`     — 1.4.3, normal text: 4.5:1
 *   * `largeText`— 1.4.3, ≥24px, or ≥18.66px bold: 3:1
 *   * `nonText`  — 1.4.11, UI component boundaries and meaningful graphics: 3:1
 *
 * AAA (7:1) is not a target here; the item says AA and claiming AAA would be a
 * claim nothing in the suite checks.
 */
export const AA_THRESHOLD = {
  body: 4.5,
  largeText: 3,
  nonText: 3,
} as const

export type ContrastPurpose = keyof typeof AA_THRESHOLD

export function meetsAA(
  ratio: number,
  purpose: ContrastPurpose,
): { passes: boolean; required: number; ratio: number } {
  const required = AA_THRESHOLD[purpose]
  return {
    // Compared raw, reported rounded. Rounding first would let 4.4996 — which
    // is below the threshold — pass as "4.5", and a threshold that rounds up is
    // not a threshold.
    passes: ratio >= required,
    required,
    ratio: Math.round(ratio * 100) / 100,
  }
}
