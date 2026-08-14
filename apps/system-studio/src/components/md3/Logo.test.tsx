import fs from "node:fs"
import path from "node:path"

import { renderToStaticMarkup } from "react-dom/server"

import { PETAL } from "../brand/TenureLogo"
import { Logo, LOGO_ICONS, LOGO_ICON_PATH } from "./Logo"

/**
 * The mark, proven as an asset rather than described as one.
 *
 * Four things have to be true, and each of them is the kind of thing that
 * silently stops being true:
 *
 *   1. It is vector markup in the page — an `<svg>`, not an `<img>` and not a
 *      word in a pill.
 *   2. It carries no colour value. The theme decides what green is; a literal
 *      here is a pair the contrast audit cannot see, on the one element that
 *      appears on every route.
 *   3. Its accessible name is correct for the shape it is in. Standing alone as
 *      the link to home it must have one; sitting beside a visible "Tenure" it
 *      must have none, because a name in that position is read aloud as
 *      "Tenure Tenure".
 *   4. It is the SAME rosette as the product's, and the favicon is the same
 *      rosette again.
 *
 * `e2e/md3-tokens-logic.spec.ts` already refuses a literal colour anywhere in
 * `components/md3`, and this file repeats a narrower version of that check
 * rather than relying on it: that spec needs a built server, this runs in jest,
 * and the check that runs on every unit run is the one that catches the edit on
 * the day it is made.
 *
 * Assertions carry no message argument on purpose — jest's `expect` takes one
 * argument, unlike the Playwright `expect` used across `e2e/`. Where a bare
 * boolean would produce an unreadable failure, the assertion compares a value
 * that contains the explanation instead.
 */

const HERE = __dirname
const STUDIO = path.resolve(HERE, "..", "..", "..")
const PUBLIC_DIR = path.join(STUDIO, "public")
const LOGO_SOURCE = path.join(HERE, "Logo.tsx")
const ROTATIONS = [0, 60, 120, 180, 240, 300]

/* ── Colour scanning ──────────────────────────────────────────────────────── */

/**
 * Every syntax a colour can be written in, matched as it would appear in
 * rendered markup or in source.
 *
 * The three-way split is deliberate and matches `md3-tokens-logic.spec.ts`: a
 * scan for `#` alone passes `rgb(11 92 61)`, and a scan for `#` and `rgb(`
 * still passes `forestgreen`.
 */
const HEX = /#[0-9a-fA-F]{3,8}\b/g
const COLOUR_FUNCTION =
  /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\s*\(/g
/** The keywords most likely to reach a brand asset by hand, plus the two extremes. */
const KEYWORDS =
  /\b(?:black|white|green|darkgreen|forestgreen|seagreen|mediumseagreen|springgreen|teal|red|orange|currentColor)\b/g

function coloursIn(text: string): string[] {
  return [
    ...(text.match(HEX) ?? []),
    ...(text.match(COLOUR_FUNCTION) ?? []),
    ...(text.match(KEYWORDS) ?? []),
  ]
}

/** Comments stripped, the same way the e2e scan strips them. */
function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/* ── WCAG 2.2 relative luminance and contrast, computed rather than asserted ── */

function channel(eight: number): number {
  const s = eight / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function rgbOf(hex: string): { r: number; g: number; b: number } {
  const six = hex.replace("#", "")
  return {
    r: parseInt(six.slice(0, 2), 16),
    g: parseInt(six.slice(2, 4), 16),
    b: parseInt(six.slice(4, 6), 16),
  }
}

/** WCAG 2.2 relative luminance. */
function luminance(hex: string): number {
  const { r, g, b } = rgbOf(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Hue in degrees, so "is it green" is measured rather than eyeballed. */
function hue(hex: string): number {
  const { r, g, b } = rgbOf(hex)
  const [rr, gg, bb] = [r / 255, g / 255, b / 255]
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const delta = max - min
  if (delta === 0) return 0
  const raw =
    max === rr ? ((gg - bb) / delta + 6) % 6 : max === gg ? (bb - rr) / delta + 2 : (rr - gg) / delta + 4
  return (raw * 60) % 360
}

/* ── The component ────────────────────────────────────────────────────────── */

describe("the mark is vector markup in the page", () => {
  test("both forms render an svg element", () => {
    const forms = {
      lockup: renderToStaticMarkup(<Logo />),
      glyph: renderToStaticMarkup(<Logo mark />),
    }
    expect({
      lockup: forms.lockup.startsWith("<svg"),
      glyph: forms.glyph.startsWith("<svg"),
    }).toEqual({ lockup: true, glyph: true })

    // An `<img>` would satisfy "renders a logo" and none of the properties this
    // component exists for: it would not recolour with the theme, and it would
    // cost a request on the one element that is on every route.
    for (const markup of Object.values(forms)) {
      expect(markup).not.toContain("<img")
      expect(markup).not.toContain("background-image")
    }
  })

  test("the lockup draws the word, the glyph does not", () => {
    const lockup = renderToStaticMarkup(<Logo />)
    const glyph = renderToStaticMarkup(<Logo mark />)

    // The T's crossbar and stem — the first letterform, present only in the lockup.
    expect(lockup).toContain("M0 8H13M6.5 8V24")
    expect(glyph).not.toContain("M0 8H13M6.5 8V24")

    // Six letters plus six petals, against six petals alone.
    expect({
      lockup: (lockup.match(/<path/g) ?? []).length,
      glyph: (glyph.match(/<path/g) ?? []).length,
    }).toEqual({ lockup: 12, glyph: 6 })
  })

  test("both dimensions are attributes, and the aspect follows the box", () => {
    // Not left to CSS: an `<svg>` with no intrinsic size lays out at 300x150
    // until the stylesheet arrives, which is a masthead-height jump on every
    // route (STUDIO-030-008).
    const glyph = renderToStaticMarkup(<Logo mark size={20} />)
    expect(glyph).toContain('width="20"')
    expect(glyph).toContain('height="20"')
    expect(glyph).toContain('viewBox="0 0 32 32"')

    const lockup = renderToStaticMarkup(<Logo size={24} />)
    expect(lockup).toContain('viewBox="0 0 136 32"')
    expect(lockup).toContain('height="24"')
    // 24 * 136/32 = 102.
    expect(lockup).toContain('width="102"')
  })
})

describe("the mark carries no colour of its own", () => {
  test("neither form renders a colour value, in any syntax", () => {
    expect({
      lockup: coloursIn(renderToStaticMarkup(<Logo />)),
      glyph: coloursIn(renderToStaticMarkup(<Logo mark />)),
    }).toEqual({ lockup: [], glyph: [] })
  })

  test("it names the roles, so it moves when the theme moves", () => {
    // The complement of the check above, and the one that actually matters: a
    // component with NO fill at all also renders no colour value — and renders
    // black. These assert the tokens are the thing being asked for.
    const lockup = renderToStaticMarkup(<Logo />)
    expect(lockup).toContain('fill="var(--md-sys-color-primary)"')
    expect(lockup).toContain('stroke="var(--md-sys-color-on-surface)"')
    expect(renderToStaticMarkup(<Logo mark />)).toContain('fill="var(--md-sys-color-primary)"')
  })

  test("the source declares no colour and no inline style", () => {
    const source = code(LOGO_SOURCE)
    expect(source.match(HEX) ?? []).toEqual([])
    expect(source.match(COLOUR_FUNCTION) ?? []).toEqual([])
    // `style={{ fill: SOMETHING }}` defeats every lexical scan above the moment
    // the colour is a variable.
    expect(/\bstyle\s*=\s*\{/.test(source)).toBe(false)
  })
})

describe("the accessible name is correct for the shape the mark is in", () => {
  test("standing alone, it has a name", () => {
    const markup = renderToStaticMarkup(<Logo />)
    expect(markup).toContain('role="img"')
    expect(markup).toContain('aria-label="Tenure"')
    expect(markup).not.toContain("aria-hidden")
  })

  test("the glyph standing alone has a name too", () => {
    // The collapsed rail shows only the rosette and it is still the link to
    // home. A named lockup beside an unnamed glyph would mean the console loses
    // its home link's name at one breakpoint and nowhere else.
    const markup = renderToStaticMarkup(<Logo mark />)
    expect(markup).toContain('role="img"')
    expect(markup).toContain('aria-label="Tenure"')
  })

  test("the caller can say what the name is", () => {
    const markup = renderToStaticMarkup(<Logo label="Tenure System Studio, home" />)
    expect(markup).toContain('aria-label="Tenure System Studio, home"')
    expect(markup).not.toContain('aria-label="Tenure"')
  })

  test("decorative, it has no name at all — in any of the naming syntaxes", () => {
    // A screen reader announcing "Tenure Tenure" is the defect this shape
    // produces, so all four ways of naming an `<svg>` are refused, not only the
    // one this component happens to use.
    const named = (markup: string) => ({
      role: markup.includes('role="img"'),
      label: markup.includes("aria-label"),
      labelledby: markup.includes("aria-labelledby"),
      title: markup.includes("<title"),
      hidden: markup.includes('aria-hidden="true"'),
    })
    expect({
      lockup: named(renderToStaticMarkup(<Logo decorative />)),
      glyph: named(renderToStaticMarkup(<Logo mark decorative />)),
    }).toEqual({
      lockup: { role: false, label: false, labelledby: false, title: false, hidden: true },
      glyph: { role: false, label: false, labelledby: false, title: false, hidden: true },
    })
  })

  test("neither form is a tab stop", () => {
    for (const markup of [
      renderToStaticMarkup(<Logo />),
      renderToStaticMarkup(<Logo mark decorative />),
    ]) {
      expect(markup).toContain('focusable="false"')
    }
  })
})

describe("it is the same rosette everywhere", () => {
  test("the component draws the guarded petal, six times, about the guarded centre", () => {
    // PETAL is imported, not copied:
    // tests/architecture/brand-mark-is-one-mark.test.mjs guards that string
    // against apps/web's copy, and a third literal written out here would be a
    // copy that guard does not know exists.
    expect(PETAL.length).toBeGreaterThan(20)
    const markup = renderToStaticMarkup(<Logo mark />)
    expect(markup.split(PETAL).length - 1).toBe(6)
    expect(ROTATIONS.filter((r) => markup.includes(`rotate(${r} 16 16)`))).toEqual(ROTATIONS)
  })

  test("the favicon is that rosette and not a second drawing of it", () => {
    const svg = fs.readFileSync(path.join(PUBLIC_DIR, "icon.svg"), "utf8")
    expect(svg.split(PETAL).length - 1).toBe(6)
    expect(ROTATIONS.filter((r) => svg.includes(`rotate(${r} 16 16)`))).toEqual(ROTATIONS)
    expect(svg).toContain('viewBox="0 0 32 32"')
  })
})

describe("the favicon, which is the one place a value is written down", () => {
  const svg = () => fs.readFileSync(path.join(PUBLIC_DIR, "icon.svg"), "utf8")

  test("the metadata export names a file that is really there", () => {
    expect(LOGO_ICON_PATH.startsWith("/")).toBe(true)
    const onDisk = path.join(PUBLIC_DIR, LOGO_ICON_PATH.replace(/^\//, ""))
    expect({ path: LOGO_ICON_PATH, onDisk: fs.existsSync(onDisk) }).toEqual({
      path: LOGO_ICON_PATH,
      onDisk: true,
    })
    expect(LOGO_ICONS.icon[0]).toEqual({ url: LOGO_ICON_PATH, type: "image/svg+xml" })
  })

  test("it asks for the token first, and only falls back to a literal", () => {
    // The literal exists because browser chrome renders this file as its own
    // document with no token layer. That is a reason for a FALLBACK, not a
    // reason to stop asking.
    expect(svg()).toContain("var(--md-sys-color-primary, var(--tenure-mark))")
  })

  test("both chrome tones clear 3:1 against the chrome they are for", () => {
    const source = svg()
    const light = /--tenure-mark-light-chrome:\s*(#[0-9a-fA-F]{6})/.exec(source)?.[1]
    const dark = /--tenure-mark-dark-chrome:\s*(#[0-9a-fA-F]{6})/.exec(source)?.[1]
    // Two missing tones would make every ratio below NaN, and NaN comparisons
    // are silently false rather than loudly wrong.
    expect({ light: typeof light, dark: typeof dark }).toEqual({
      light: "string",
      dark: "string",
    })

    // A 16px icon is a non-text graphic: WCAG 2.2 puts the floor at 3:1 against
    // the surface it sits on, and browser chrome is white or near-black.
    const measured = {
      lightToneOnWhite: Number(contrast(light!, "#ffffff").toFixed(2)),
      darkToneOnBlack: Number(contrast(dark!, "#000000").toFixed(2)),
    }
    expect(measured.lightToneOnWhite).toBeGreaterThanOrEqual(3)
    expect(measured.darkToneOnBlack).toBeGreaterThanOrEqual(3)

    // And both are the Tenure green — not a green-ish grey, not a blue.
    const hues = { light: Math.round(hue(light!)), dark: Math.round(hue(dark!)) }
    expect(hues.light).toBeGreaterThanOrEqual(120)
    expect(hues.light).toBeLessThanOrEqual(180)
    expect(hues.dark).toBeGreaterThanOrEqual(120)
    expect(hues.dark).toBeLessThanOrEqual(180)

    // The light-chrome tone must be the DARKER of the two. Swapped, both
    // assertions above are still individually satisfiable while the pale tone
    // sits on white.
    expect(luminance(light!)).toBeLessThan(luminance(dark!))
  })

  test("the dark tone is actually wired to prefers-color-scheme", () => {
    // A second tone declared and never selected is a tone that does nothing,
    // and every assertion above would still pass.
    const media = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*?\}\s*\}/.exec(svg())
    expect(media === null).toBe(false)
    expect(media![0]).toContain("--tenure-mark-dark-chrome")
  })

  test("it is well-formed XML, which is what decides whether it renders at all", () => {
    /*
      This is the assertion every other one in this describe block depended on
      and none of them made.

      The first draft of this file carried the name of a custom property inside
      an XML comment. XML forbids two consecutive hyphens inside a comment, so
      the document was not well-formed, so every browser refused it and rendered
      the broken-image glyph — while `toContain("var(--md-sys-color-primary"`,
      the petal count, the rotations, the contrast measurement and the title
      check all still passed, because a string scan cannot tell a document from
      a text file. It was found by rendering the file in Chromium and looking at
      it, and this is that finding turned into something that runs.
    */
    const source = svg()

    const comments = [...source.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1])
    // An empty list would make the next assertion vacuous.
    expect(comments.length).toBeGreaterThan(0)
    // Every `<!--` opened is one this regex closed: an unterminated comment
    // swallows the rest of the document.
    expect((source.match(/<!--/g) ?? []).length).toBe(comments.length)
    expect(comments.filter((c) => c.includes("--"))).toEqual([])

    // Balanced elements. `<style>` holds no `<`, so a tag scan is sound here.
    const stack: string[] = []
    const problems: string[] = []
    for (const [, closing, name, , selfClosing] of source
      .replace(/<!--[\s\S]*?-->/g, "")
      .matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g)) {
      if (closing) {
        const open = stack.pop()
        if (open !== name) problems.push(`</${name}> closes <${open ?? "nothing"}>`)
      } else if (!selfClosing) {
        stack.push(name)
      }
    }
    expect(problems.concat(stack.map((n) => `<${n}> is never closed`))).toEqual([])

    // Served from `public/` as its own document, so the namespace is not
    // optional the way it is for SVG inlined in HTML.
    expect(source).toContain('xmlns="http://www.w3.org/2000/svg"')
    // A bare `&` is the other way a document stops parsing.
    expect(source.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, "").includes("&")).toBe(false)
  })

  test("it names itself for a reader, since it is also served as an image", () => {
    const source = svg()
    expect(source).toContain('role="img"')
    expect(source).toContain("<title")
    expect(source).toContain("Tenure")
  })
})
