/**
 * TTES-010-004 — the three clauses, tested against the real files.
 *
 * REJECTION  — an unsafe tenant accent is measured and dropped, not shipped.
 * SEMANTIC   — no focus indicator anywhere in the product resolves to a token
 *              branding can override.
 * PREVIEW    — the swatch table the preview draws from is the stylesheet's, not
 *              a copy of it.
 */
import { describe, expect, it } from "@jest/globals"

import fs from "node:fs"
import path from "node:path"

import { brandingCss, type Branding } from "@tenure/platform-config"

import { AA_THRESHOLD, contrastRatio } from "./contrast"
import {
  BRANDED_SURFACES,
  DEFAULT_PRIMARY,
  DEFAULT_PRIMARY_TEXT,
  THEME_SWATCHES,
  assessBrand,
  measuredRatios,
} from "./tenant-brand"
import { GLOBALS_CSS, readBlocks, readThemes, token } from "./theme-tokens"

const brand = (over: Partial<Branding> = {}): Branding => ({
  primaryColor: DEFAULT_PRIMARY,
  primaryTextColor: DEFAULT_PRIMARY_TEXT,
  wordmark: "Tenure",
  colorScheme: "system",
  ...over,
})

describe("unsafe tenant tokens are rejected, not shipped", () => {
  it("accepts the platform default unchanged", () => {
    const { accepted, rejections } = assessBrand(brand())
    expect(rejections).toEqual([])
    expect(accepted).toEqual(brand())
  })

  it("accepts a real institution colour that clears both floors", () => {
    // A deep maroon: 8.9:1 under white text, 8.5:1 against the light card.
    const { accepted, rejections } = assessBrand(brand({ primaryColor: "#8c1d40" }))
    expect(rejections).toEqual([])
    expect(accepted.primaryColor).toBe("#8c1d40")
  })

  it("rejects a low-contrast accent — the #ffff00 button nobody could read", () => {
    // The case in the requirement: primaryColor #ffff00 against the DEFAULT
    // primaryTextColor #ffffff is a 1.07:1 label on the most-clicked control in
    // the product, and syntax validation passes it without comment.
    const { accepted, rejections } = assessBrand(brand({ primaryColor: "#ffff00" }))

    expect(accepted.primaryColor).toBe(DEFAULT_PRIMARY)
    expect(rejections.map((r) => r.token)).toContain("platform.branding.primaryColor")
    const surfaceFailure = rejections.find((r) => r.against.includes("card surface"))
    expect(surfaceFailure).toBeDefined()
    expect(surfaceFailure!.ratio).toBeLessThan(AA_THRESHOLD.nonText)
    expect(surfaceFailure!.floor).toBe(AA_THRESHOLD.nonText)
    expect(surfaceFailure!.refused).toBe("#ffff00")
    expect(surfaceFailure!.fallback).toBe(DEFAULT_PRIMARY)
  })

  it("drops the ink rather than the colour when only the pair fails", () => {
    // #7a1e2b is a legitimate accent — 9.8:1 against the card. Asking for grey
    // ink on it is what fails, at 2.6:1, so the institution keeps its colour.
    const { accepted, rejections } = assessBrand(
      brand({ primaryColor: "#7a1e2b", primaryTextColor: "#8b8b8b" }),
    )
    expect(accepted.primaryColor).toBe("#7a1e2b")
    expect(accepted.primaryTextColor).toBe(DEFAULT_PRIMARY_TEXT)
    expect(rejections).toHaveLength(1)
    expect(rejections[0].token).toBe("platform.branding.primaryTextColor")
    expect(rejections[0].floor).toBe(AA_THRESHOLD.body)
  })

  it("drops the accent when no ink is legible on it", () => {
    // #8a8a8a clears the surface floor at 3.31:1, so step 1 keeps it. But its
    // own ink reads 2.54:1 and the platform's white only 3.45:1 — there is no
    // ink that works, so the accent is what has to go, and then #dddddd is
    // still only 3.64:1 on the default and goes with it.
    const { accepted, rejections } = assessBrand(
      brand({ primaryColor: "#8a8a8a", primaryTextColor: "#dddddd" }),
    )
    expect(accepted.primaryColor).toBe(DEFAULT_PRIMARY)
    expect(accepted.primaryTextColor).toBe(DEFAULT_PRIMARY_TEXT)
    expect(rejections.map((r) => r.token)).toEqual([
      "platform.branding.primaryColor",
      "platform.branding.primaryTextColor",
    ])
    expect(rejections[0].against).toBe("the label drawn on it")
  })

  it("refuses a value that is not a colour rather than measuring nothing", () => {
    const { accepted, rejections } = assessBrand(brand({ primaryColor: "url(https://x/y)" }))
    expect(accepted.primaryColor).toBe(DEFAULT_PRIMARY)
    expect(rejections[0].against).toContain("a colour this can measure")
  })

  it("whatever it accepts, clears both floors", () => {
    // The property, rather than six examples of it. If assessBrand ever returns
    // a value that fails, this is the test that says so regardless of which one.
    const candidates = [
      "#ffff00", "#198052", "#8c1d40", "#0d2f6b", "#767676", "#ffffff", "#000000",
      "#e8674c", "#2bb673", "#f5f5f5", "#6b21a8", "#1f4fd6",
    ]
    for (const primaryColor of candidates) {
      for (const primaryTextColor of ["#ffffff", "#000000", "#8b8b8b"]) {
        const { accepted } = assessBrand(brand({ primaryColor, primaryTextColor }))
        expect(contrastRatio(accepted.primaryTextColor, accepted.primaryColor)).toBeGreaterThanOrEqual(
          AA_THRESHOLD.body,
        )
        for (const swatch of BRANDED_SURFACES) {
          expect(contrastRatio(accepted.primaryColor, swatch.surface)).toBeGreaterThanOrEqual(
            AA_THRESHOLD.nonText,
          )
        }
      }
    }
  })

  it("is what the production path emits into the document", () => {
    // Mutating the helper is not enough — a test that calls assessBrand directly
    // stays green when the layout stops calling it. This asserts the CSS the
    // shell actually writes: the unsafe accent must not appear in it.
    const layout = fs.readFileSync(
      path.join(__dirname, "..", "..", "app", "(app)", "layout.tsx"),
      "utf8",
    )
    expect(layout).toContain("brandingCss(assessBrand(brandingFor(institution.slug)).accepted)")

    const unsafe = brand({ primaryColor: "#ffff00" })
    expect(brandingCss(unsafe)).toContain("#ffff00")
    expect(brandingCss(assessBrand(unsafe).accepted)).not.toContain("#ffff00")
    // The default is emitted as nothing at all, which is the point of the drop:
    // the tenant falls back to the stylesheet rather than to a re-stated copy.
    expect(brandingCss(assessBrand(unsafe).accepted)).toBe("")
  })
})

/**
 * The semantic leak.
 *
 * Bible §4: tenant branding "cannot override focus, danger, warning, success,
 * security, disabled, selection or data-series semantic tokens". The focus ring
 * was painted from `--primary` — the very token branding replaces — in
 * globals.css and in twenty-one component class strings, while `--border-focus`
 * was declared per theme and used by exactly the input borders. The token
 * existed; the ring simply did not use it.
 */
const BRAND_OVERRIDABLE = ["--primary", "--primary-hover", "--primary-press", "--primary-light", "--primary-text"]

describe("branding cannot reach the focus indicator", () => {
  it("brandingCss writes these tokens and no others", () => {
    // The list above is not a guess. If branding.ts starts writing a sixth
    // token, this fails and the scans below have to be widened with it.
    const css = brandingCss(brand({ primaryColor: "#8c1d40", primaryTextColor: "#fff8f0" }))
    const written = [...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])
    expect(written.length).toBeGreaterThan(0)
    expect([...new Set(written)].sort()).toEqual([...BRAND_OVERRIDABLE].sort())
  })

  it("no focus rule in globals.css resolves to a token branding writes", () => {
    const css = fs.readFileSync(GLOBALS_CSS, "utf8")
    const themes = readThemes()
    const offenders: string[] = []

    // Every rule whose selector mentions focus, and every declaration in it.
    for (const match of css.matchAll(/([^{}]*focus[^{}]*)\{([^{}]*)\}/gi)) {
      const [, selector, body] = match
      if (selector.includes("@")) continue
      for (const ref of body.matchAll(/var\((--[\w-]+)\)/g)) {
        if (BRAND_OVERRIDABLE.includes(ref[1])) {
          offenders.push(`${selector.trim()} { … ${ref[1]} }`)
        }
        // And it must resolve — a focus ring pointing at a token no theme
        // declares is an invisible ring, which fails 2.4.7 outright.
        for (const theme of ["light", "dark", "light-contrast", "dark-contrast"] as const) {
          expect(() => token(themes[theme], ref[1])).not.toThrow()
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("no focus utility in any component resolves to a token branding writes", () => {
    // The class strings, which the stylesheet scan cannot see. Twenty-one of
    // these read `focus-visible:ring-[--primary]` before TTES-010-004.
    const src = path.join(__dirname, "..", "..")
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          fs.readFileSync(full, "utf8")
            .split("\n")
            .forEach((line, i) => {
              for (const chunk of line.split(/[\s"'`]+/)) {
                if (!/focus/i.test(chunk)) continue
                for (const utility of chunk.matchAll(/(ring|outline|border|shadow|bg|text)-\[(--[\w-]+)\]/g)) {
                  if (BRAND_OVERRIDABLE.includes(utility[2])) {
                    offenders.push(`${path.relative(src, full)}:${i + 1} ${chunk}`)
                  }
                }
              }
            })
        }
      }
    }
    walk(src)
    expect(offenders).toEqual([])
  })

  it("--border-focus is declared in every theme and is not what branding writes", () => {
    const themes = readThemes()
    for (const theme of ["light", "dark", "light-contrast", "dark-contrast"] as const) {
      expect(token(themes[theme], "--border-focus")).toMatch(/^#[0-9a-f]{6}$/i)
    }
    expect(BRAND_OVERRIDABLE).not.toContain("--border-focus")
  })
})

describe("the preview draws the stylesheet's colours, not a copy of them", () => {
  const themes = readThemes()

  for (const swatch of THEME_SWATCHES) {
    it(`${swatch.theme} matches globals.css`, () => {
      expect(swatch.surface).toBe(token(themes[swatch.theme], "--bg-surface"))
      expect(swatch.text).toBe(token(themes[swatch.theme], "--text-1"))
      expect(swatch.focusRing).toBe(token(themes[swatch.theme], "--border-focus"))
      expect(swatch.platformPrimary).toBe(token(themes[swatch.theme], "--primary"))
    })
  }

  it("brandApplies follows the cascade rather than a comment about it", () => {
    // The premise: a tenant's `:root { --primary }` is specificity (0,1,0) and
    // the dark palette's `html.dark { --primary }` is (0,1,1), so the dark block
    // wins and the accent never reaches the dark themes. That is only true while
    // html.dark restates --primary, so the test asserts THAT, from the file.
    const blocks = readBlocks()
    expect(blocks.dark["--primary"]).toBeDefined()
    expect(blocks.root["--primary"]).toBeDefined()

    for (const swatch of THEME_SWATCHES) {
      const darkTheme = swatch.theme.startsWith("dark")
      expect(swatch.brandApplies).toBe(!darkTheme)
    }
    expect(BRANDED_SURFACES.map((s) => s.theme)).toEqual(["light", "light-contrast"])
  })

  it("reports the ratios the preview prints", () => {
    const { accepted } = assessBrand(brand({ primaryColor: "#8c1d40" }))
    const ratios = measuredRatios(accepted)
    expect(ratios.label).toBeGreaterThanOrEqual(AA_THRESHOLD.body)
    expect(ratios.surfaces).toHaveLength(THEME_SWATCHES.length)
    // The dark rows report the PLATFORM accent, because that is what is painted
    // there — a preview claiming the tenant's maroon in dark mode would be a
    // confident lie.
    const dark = ratios.surfaces.find((s) => s.label === "Dark")!
    expect(dark.ratio).toBe(
      Math.round(contrastRatio(token(themes.dark, "--primary"), token(themes.dark, "--bg-surface")) * 100) / 100,
    )
    for (const row of ratios.surfaces) expect(row.passes).toBe(true)
  })

  it("the preview is mounted where a user can reach it", () => {
    const settings = fs.readFileSync(
      path.join(__dirname, "..", "..", "app", "(app)", "settings", "page.tsx"),
      "utf8",
    )
    expect(settings).toContain("<BrandPreview institutionSlug={activeSlug} />")
  })
})
