/**
 * GE-022-003 — the contrast audit.
 *
 * Every foreground/background pairing the product actually renders, in all four
 * themes, against the WCAG 2.2 AA threshold for what that pairing is. The token
 * values are read from `globals.css`, so this cannot drift into agreeing with a
 * palette nobody ships.
 */
import { describe, expect, it } from "@jest/globals"

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import resolveConfig from "tailwindcss/resolveConfig"

import tailwindConfig from "../../../tailwind.config"

import {
  AA_THRESHOLD,
  composite,
  contrastRatio,
  gamutViolations,
  meetsAA,
  parseColor,
  relativeLuminance,
} from "./contrast"
import { ALL_THEMES, declaredTokenNames, readThemes, token } from "./theme-tokens"

describe("the arithmetic", () => {
  it("agrees with the two ratios everyone knows", () => {
    // Black on white is exactly 21:1 and white on white exactly 1:1. If the
    // luminance curve is wrong, these are the first two numbers to move.
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5)
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5)
  })

  it("is symmetric", () => {
    expect(contrastRatio("#1c8c5a", "#fbfaf7")).toBeCloseTo(contrastRatio("#fbfaf7", "#1c8c5a"), 10)
  })

  it("applies the sRGB knee, not a plain gamma", () => {
    // #0a is below the 0.03928 threshold and takes the linear branch. A naive
    // pow() implementation gets a visibly different luminance here.
    expect(relativeLuminance({ r: 10, g: 10, b: 10, a: 1 })).toBeCloseTo(0.0030352, 6)
  })

  it("parses every colour syntax that appears in the stylesheet", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor("#191a1c")).toEqual({ r: 25, g: 26, b: 28, a: 1 })
    expect(parseColor("rgba(43, 182, 115, 0.14)")).toEqual({ r: 43, g: 182, b: 115, a: 0.14 })
    expect(parseColor("rgb(255, 255, 255)")).toEqual({ r: 255, g: 255, b: 255, a: 1 })
  })

  it("returns null for things that are not colours, rather than guessing", () => {
    // So a caller can tell "not a colour" from "a colour that fails".
    expect(parseColor("var(--text-1)")).toBeNull()
    expect(parseColor("transparent")).toBeNull()
    expect(parseColor("linear-gradient(#000, #fff)")).toBeNull()
  })

  it("composites a translucent colour before measuring it", () => {
    // The load-bearing one. Every dark-theme badge background is rgba(); its
    // raw rgb has no contrast meaning at all. 14% green over near-black is
    // nearly black — a ratio computed against the raw #2bb673 would claim a
    // legible surface that does not exist.
    const raw = contrastRatio("#2bb673", "#0f1113")
    const composited = contrastRatio("rgba(43, 182, 115, 0.14)", "#0f1113", "#0f1113")
    expect(raw).toBeGreaterThan(5)
    expect(composited).toBeLessThan(1.5)
  })

  it("refuses to composite onto a translucent backdrop", () => {
    // Translucent-on-translucent has no defined contrast, and quietly treating
    // the backdrop as opaque reports a ratio nobody sees.
    expect(() =>
      composite({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 0.5 }),
    ).toThrow(/opaque/)
  })

  it("does not let a near-miss round up into a pass", () => {
    expect(meetsAA(4.4996, "body").passes).toBe(false)
    expect(meetsAA(4.5, "body").passes).toBe(true)
    // 3:1 is for large text and non-text; applying it to body text is the
    // mistake the named thresholds exist to prevent.
    expect(AA_THRESHOLD.body).toBe(4.5)
    expect(AA_THRESHOLD.largeText).toBe(3)
    expect(AA_THRESHOLD.nonText).toBe(3)
  })
})

describe("the themes are read from the stylesheet, not copied from it", () => {
  const themes = readThemes()

  it("finds all four", () => {
    for (const name of ALL_THEMES) {
      expect(Object.keys(themes[name]).length).toBeGreaterThan(40)
    }
  })

  it("applies the dark overrides on top of the base, keeping what dark does not restate", () => {
    expect(token(themes.light, "--text-1")).toBe("#191a1c")
    expect(token(themes.dark, "--text-1")).toBe("#f2f3f5")
    // --space-4 is declared once, in :root, and must survive into dark.
    expect(themes.dark["--space-4"]).toBe("16px")
  })

  it("applies the prefers-contrast overrides on top of each base theme", () => {
    expect(token(themes["light-contrast"], "--text-1")).toBe("#000000")
    expect(token(themes["dark-contrast"], "--text-1")).toBe("#ffffff")
    // A token the override does not restate keeps its base value.
    expect(token(themes["light-contrast"], "--bg-surface")).toBe(
      token(themes.light, "--bg-surface"),
    )
  })

  it("refuses a token that does not exist rather than defaulting", () => {
    // A pairing naming a deleted token is a bug in the pairing list; a silent
    // fallback would keep the audit green against a colour nobody renders.
    expect(() => token(themes.light, "--no-such-token")).toThrow(/no such token/)
  })

  it("reads past a nested rule instead of stopping at its closing brace", () => {
    // CSS nesting inside :root is valid and PostCSS supports it, so a scan that
    // stops at the first `}` would silently return everything BEFORE the nested
    // block and nothing after — a partial palette that audits clean because the
    // tokens it never saw cannot fail.
    //
    // This is written against a fixture rather than globals.css because the real
    // file has no nesting today. A mutation that reduced the balanced-brace scan
    // to a first-brace scan passed the whole suite, which is exactly how a
    // defence with no test on it survives — the property was asserted in a
    // comment and nowhere else.
    const fixture = path.join(os.tmpdir(), `tenure-nested-${process.pid}.css`)
    fs.writeFileSync(
      fixture,
      [
        "@layer base {",
        "  :root {",
        "    --before: #111111;",
        "    @media (min-width: 40rem) {",
        "      --inside-a-nested-rule: #222222;",
        "    }",
        "    --after: #333333;",
        "  }",
        "}",
        "",
      ].join("\n"),
    )
    try {
      const parsed = readThemes(fixture)
      expect(parsed.light["--before"]).toBe("#111111")
      expect(parsed.light["--after"]).toBe("#333333")
      // The nested rule's declaration belongs to that rule, not to :root.
      expect(parsed.light["--inside-a-nested-rule"]).toBeUndefined()
    } finally {
      fs.unlinkSync(fixture)
    }
  })
})

/**
 * The pairings.
 *
 * Each one is a foreground the product renders on that background — not every
 * mathematically possible combination, which would be noise, and not a
 * convenient subset, which would be theatre.
 */
const PAIRINGS: ReadonlyArray<{
  fg: string
  bg: string
  purpose: keyof typeof AA_THRESHOLD
  where: string
}> = [
  { fg: "--text-1", bg: "--bg-surface", purpose: "body", where: "card body text" },
  { fg: "--text-1", bg: "--bg-base", purpose: "body", where: "page body text" },
  { fg: "--text-1", bg: "--bg-subtle", purpose: "body", where: "inset panel text" },
  { fg: "--text-2", bg: "--bg-surface", purpose: "body", where: "secondary text on a card" },
  { fg: "--text-2", bg: "--bg-base", purpose: "body", where: "secondary text on the page" },
  { fg: "--text-2", bg: "--bg-subtle", purpose: "body", where: "secondary text in a panel" },

  // TTES-010-002 — the third text ramp. It was omitted from this list while
  // being the ramp the product writes metadata, table headers, timestamps and
  // captions in: 294 occurrences across 80 files (admin/audit/page.tsx:108,
  // ai/TenureAIPanel.tsx:124, .micro-label in globals.css). Light was 3.29 /
  // 2.98 / 2.84 and dark 3.91 / 4.12 / 3.68 — all five under the 4.5:1 floor
  // this same file enforces two lines up — and the suite was 17/17 green,
  // which is precisely the failure the header warns about. The palette moved
  // (#868b92 → #63686f light, #6b7280 → #7f8794 dark); the floor did not.
  { fg: "--text-3", bg: "--bg-surface", purpose: "body", where: "metadata and captions on a card" },
  { fg: "--text-3", bg: "--bg-base", purpose: "body", where: "metadata on the page" },
  { fg: "--text-3", bg: "--bg-subtle", purpose: "body", where: "metadata in a panel" },

  { fg: "--text-link", bg: "--bg-surface", purpose: "body", where: "links" },
  { fg: "--shell-text", bg: "--shell-bg", purpose: "body", where: "header and side nav" },
  { fg: "--shell-text-secondary", bg: "--shell-bg", purpose: "body", where: "nav secondary text" },
  { fg: "--primary-text", bg: "--primary", purpose: "body", where: "primary button label" },
  { fg: "--accent-text", bg: "--accent", purpose: "body", where: "accent button label" },
  // The accent carries words as well as fills: admin/clubs/page.tsx:105 writes
  // its "Manage" link in it. Found by the TTES-GATE-010 ratchet below on its
  // first run — it was declared, rendered as text, and in no row.
  { fg: "--accent", bg: "--bg-surface", purpose: "body", where: "administration link on a card" },
  // The accent on its own tint. Rendered by ui/Badge.tsx:23 (the `info`
  // variant), ThemeSwitcher.tsx:51 (the selected theme chip) and
  // CalendarFilters.tsx:50. It measured 4.28:1 in light and was in no pairing;
  // --primary-light moved #e4f2ea → #f0f9f4 to clear the floor.
  { fg: "--primary", bg: "--primary-light", purpose: "body", where: "accent label on an accent tint" },
  { fg: "--badge-approved-text", bg: "--badge-approved-bg", purpose: "body", where: "approved badge" },
  { fg: "--badge-pending-text", bg: "--badge-pending-bg", purpose: "body", where: "pending badge" },
  { fg: "--badge-rejected-text", bg: "--badge-rejected-bg", purpose: "body", where: "rejected badge" },
  { fg: "--badge-draft-text", bg: "--badge-draft-bg", purpose: "body", where: "draft badge" },
  { fg: "--badge-accent-text", bg: "--badge-accent-bg", purpose: "body", where: "accent badge" },

  // Each status hue is checked twice, because it is used two ways. The -text
  // step carries words and must clear 4.5:1 on all three surfaces — including
  // --bg-subtle, which is where --error dropped to 4.29:1 and where a
  // surface-only check would have missed it. The base hue is a fill, and is
  // held to 1.4.11's 3:1 further down.
  { fg: "--error-text", bg: "--bg-surface", purpose: "body", where: "error text on a card" },
  { fg: "--error-text", bg: "--bg-subtle", purpose: "body", where: "error text in a panel" },
  { fg: "--warning-text", bg: "--bg-surface", purpose: "body", where: "warning text on a card" },
  { fg: "--warning-text", bg: "--bg-subtle", purpose: "body", where: "warning text in a panel" },
  { fg: "--success-text", bg: "--bg-surface", purpose: "body", where: "success text on a card" },
  { fg: "--success-text", bg: "--bg-subtle", purpose: "body", where: "success text in a panel" },
  { fg: "--info-text", bg: "--bg-surface", purpose: "body", where: "informational text on a card" },
  { fg: "--info-text", bg: "--bg-subtle", purpose: "body", where: "informational text in a panel" },

  // Non-text: 1.4.11 — component boundaries and meaningful graphics.
  //
  // `--border` and `--border-strong` are deliberately NOT here. They are the
  // hairlines between cards and sections; the card is identifiable from its
  // surface, so 1.4.11 does not apply and holding them to 3:1 would make every
  // divider in the product heavy for no accessibility gain. `--border-control`
  // is the one that must clear it, because on an input the edge IS the
  // affordance — there is nothing else saying "you can type here".
  { fg: "--border-control", bg: "--bg-surface", purpose: "nonText", where: "input and control edges" },
  { fg: "--border-control", bg: "--bg-base", purpose: "nonText", where: "control edges on the page" },
  { fg: "--border-control", bg: "--bg-subtle", purpose: "nonText", where: "control edges in a panel" },
  { fg: "--border-focus", bg: "--bg-surface", purpose: "nonText", where: "focus ring" },
  { fg: "--primary", bg: "--bg-surface", purpose: "nonText", where: "primary control fill" },
  { fg: "--success", bg: "--bg-surface", purpose: "nonText", where: "success fill and icon" },
  { fg: "--warning", bg: "--bg-surface", purpose: "nonText", where: "warning fill and icon" },
  { fg: "--error", bg: "--bg-surface", purpose: "nonText", where: "error fill and icon" },
  { fg: "--info", bg: "--bg-surface", purpose: "nonText", where: "informational fill and icon" },
  { fg: "--success", bg: "--bg-surface", purpose: "nonText", where: "success fill and icon" },
  { fg: "--warning", bg: "--bg-surface", purpose: "nonText", where: "warning fill and icon" },
  { fg: "--error", bg: "--bg-surface", purpose: "nonText", where: "error fill and icon" },
  { fg: "--info", bg: "--bg-surface", purpose: "nonText", where: "informational fill and icon" },
  { fg: "--chart-1", bg: "--bg-surface", purpose: "nonText", where: "chart series 1" },
  { fg: "--chart-2", bg: "--bg-surface", purpose: "nonText", where: "chart series 2" },
  { fg: "--chart-3", bg: "--bg-surface", purpose: "nonText", where: "chart series 3" },
  { fg: "--chart-4", bg: "--bg-surface", purpose: "nonText", where: "chart series 4" },
  { fg: "--chart-5", bg: "--bg-surface", purpose: "nonText", where: "chart series 5" },
  { fg: "--chart-6", bg: "--bg-surface", purpose: "nonText", where: "chart series 6" },
  { fg: "--chart-7", bg: "--bg-surface", purpose: "nonText", where: "chart series 7" },
  { fg: "--chart-8", bg: "--bg-surface", purpose: "nonText", where: "chart series 8" },

  // The hover and press steps carry the same label the resting fill does, so
  // they are the same 4.5:1 question asked of a different colour.
  { fg: "--primary-text", bg: "--primary-hover", purpose: "body", where: "primary button label, hovered" },
  { fg: "--primary-text", bg: "--primary-press", purpose: "body", where: "primary button label, pressed" },
  { fg: "--accent-text", bg: "--accent-hover", purpose: "body", where: "accent button label, hovered" },
  // ui/Button.tsx:44 presses to --accent-strong, and admin/layout.tsx:52 writes
  // the administration badge in it.
  { fg: "--accent-strong", bg: "--bg-base", purpose: "body", where: "administration plane label" },
]

describe("WCAG 2.2 AA contrast, in every theme", () => {
  const themes = readThemes()

  for (const theme of ALL_THEMES) {
    it(`${theme}`, () => {
      const failures: string[] = []
      for (const p of PAIRINGS) {
        // Translucent tokens composite onto the page base, which is the opaque
        // thing actually behind a card in every one of these placements.
        const backdrop = token(themes[theme], "--bg-base")
        const ratio = contrastRatio(
          token(themes[theme], p.fg),
          token(themes[theme], p.bg),
          backdrop,
        )
        const verdict = meetsAA(ratio, p.purpose)
        if (!verdict.passes) {
          failures.push(
            `${p.where}: ${p.fg} on ${p.bg} = ${verdict.ratio}:1, needs ${verdict.required}:1`,
          )
        }
      }
      expect(failures).toEqual([])
    })
  }
})

/**
 * TTES-010-002 — the gamut half.
 *
 * `parseColor` measures sRGB hex and `rgb()/rgba()`. A token authored in
 * `oklch()` or `color(display-p3 …)` is a valid colour that it cannot reach, so
 * a pairing naming it would throw and a token nothing paired would simply never
 * be audited — absent rather than failing, which is the quieter of the two.
 */
describe("every declared colour is one the audit can actually measure", () => {
  const themes = readThemes()

  for (const theme of ALL_THEMES) {
    it(`${theme}`, () => {
      expect(gamutViolations(themes[theme])).toEqual([])
    })
  }

  it("rejects the syntaxes it cannot measure, rather than skipping them", () => {
    expect(gamutViolations({ "--probe": "color(display-p3 1 0 0)" })).toEqual([
      { token: "--probe", value: "color(display-p3 1 0 0)", reason: expect.stringContaining("cannot measure") },
    ])
    expect(gamutViolations({ "--probe": "oklch(0.7 0.15 150)" })).toHaveLength(1)
    // Out of sRGB by number rather than by syntax. parseColor CLAMPS this to
    // pure red, so the audit would measure a colour nobody authored — the same
    // class of problem as oklch, reached a different way.
    expect(gamutViolations({ "--probe": "rgb(300, 0, 0)" })).toEqual([
      { token: "--probe", value: "rgb(300, 0, 0)", reason: expect.stringContaining("outside sRGB") },
    ])
    expect(gamutViolations({ "--probe": "rgba(0, 0, 0, 4)" })).toHaveLength(1)
  })

  it("leaves values that merely contain a colour alone", () => {
    // A shadow's alpha is an elevation decision, not a contrast one, and a
    // gradient has no single ratio. Flagging them would make the check noise,
    // and a noisy check gets an exception rather than a fix.
    expect(gamutViolations({ "--shadow-md": "0 4px 12px rgba(23, 24, 26, 0.08)" })).toEqual([])
    expect(gamutViolations({ "--space-4": "16px", "--font-sans": "var(--font-inter), system-ui" })).toEqual([])
  })
})

/**
 * TTES-GATE-010 — the completeness ratchet.
 *
 * Everything above measures the pairings in PAIRINGS. Nothing, until here,
 * measured PAIRINGS itself. Its own header calls it "not a convenient subset,
 * which would be theatre" — and `--text-3` was the standing proof that it was
 * exactly that: declared in globals.css, bound to `text-text-3` in
 * tailwind.config.ts, rendered 294 times across 80 files, and in no row. Adding
 * a token, or a new foreground, was invisible to this gate forever.
 *
 * So the expectation is derived from the real files rather than from the array.
 */

/**
 * Every token the product can render as a foreground. Anchored, not prefixed:
 * `--primary-light` starts with "primary" and is a background.
 *
 * The ramps are matched by `\d+`, NOT by the index range that ships today.
 * `text-[123]` and `chart-[1-8]` were the ranges, and they put the ratchet's own
 * blind spot inside the pattern that exists to find blind spots: adding
 * `--text-4` — a fourth rung of the ink scale, which is a foreground by
 * construction — left this suite 26/26 green with the token declared, bound and
 * in no pairing. That is the exact sentence this gate was written to make
 * false. A ramp is open-ended; the pattern has to be too, or the next rung is
 * invisible for the same reason `--text-3` was.
 */
const FOREGROUND_TOKEN =
  /^--(text-\d+|text-link|text-inverse|text-disabled|shell-text|shell-text-secondary|[\w-]+-text|primary|accent|accent-strong|success|warning|error|info|chart-\d+|border-control|border-focus)$/

/**
 * The foregrounds that are deliberately in no pairing, each with the reason and
 * — where the reason is "nothing renders it" — a check that the reason is still
 * true. An exemption nobody re-verifies is how a subset calls itself complete.
 */
const NOT_PAIRED: ReadonlyArray<{ token: string; why: string; renderedNowhere?: true }> = [
  {
    token: "--text-disabled",
    why:
      "WCAG 1.4.3 exempts text that is part of an inactive user interface component. It is the disabled-control ink and the breadcrumb chevron; holding it to 4.5:1 would make a disabled control indistinguishable from an active one, which is a worse outcome for the same users.",
  },
  {
    token: "--text-inverse",
    why:
      "declared but rendered nowhere — it is bound to no Tailwind utility and named by no component, so there is no pairing to measure. The check below fails the moment that stops being true and this becomes a row instead of an exemption.",
    renderedNowhere: true,
  },
]

describe("TTES-GATE-010 — the pairing list is complete, not convenient", () => {
  const themes = readThemes()
  const pairedAsForeground = new Set(PAIRINGS.map((p) => p.fg))
  const exempt = new Map(NOT_PAIRED.map((e) => [e.token, e]))

  it("every foreground the stylesheet declares appears in a pairing", () => {
    const foregrounds = declaredTokenNames().filter((name) => FOREGROUND_TOKEN.test(name))
    // A guard on the guard: if the pattern stops matching anything, this test
    // passes vacuously and the ratchet is gone without a failure.
    expect(foregrounds.length).toBeGreaterThan(20)

    const unaudited = foregrounds.filter((name) => !pairedAsForeground.has(name) && !exempt.has(name))
    expect(unaudited).toEqual([])
  })

  it("the exemptions are still true", () => {
    // Every exempt token must still be declared — an exemption for a token that
    // no longer exists is dead weight that hides the next one.
    const declared = new Set(declaredTokenNames())
    for (const entry of NOT_PAIRED) {
      expect(declared.has(entry.token)).toBe(true)
      expect(pairedAsForeground.has(entry.token)).toBe(false)
      expect(entry.why.length).toBeGreaterThan(40)
    }

    // And "nothing renders it" is verified rather than asserted.
    const src = path.join(__dirname, "..", "..")
    const sources: string[] = []
    const walk = (dir: string) => {
      // `src/lib/a11y` is excluded: these modules name every token in order to
      // AUDIT it — tokens.ts is a generated catalog of all 224 — and a scan that
      // counted that as a render would make every exemption unprovable.
      if (path.resolve(dir) === path.resolve(__dirname)) return
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(tsx?|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) sources.push(full)
      }
    }
    walk(src)
    for (const entry of NOT_PAIRED) {
      if (!entry.renderedNowhere) continue
      const users = sources.filter((file) => {
        // globals.css DECLARES it; that is not rendering it.
        const text = fs.readFileSync(file, "utf8").replace(/^\s*--[\w-]+:.*$/gm, "")
        return text.includes(entry.token)
      })
      expect(users.map((f) => path.relative(src, f))).toEqual([])
    }
  })

  it("every token a colour utility is bound to resolves in all four themes", () => {
    // The other half. A token can be in a pairing and still be missing from one
    // theme — theme-tokens throws on a missing token, but only for tokens
    // something already pairs, so a Tailwind class bound to a token the dark
    // block dropped renders as an undeclared property and nothing notices.
    const config = fs.readFileSync(path.join(__dirname, "..", "..", "..", "tailwind.config.ts"), "utf8")
    const start = config.indexOf("colors: {")
    expect(start).toBeGreaterThan(0)
    let depth = 0
    let end = start
    for (let i = config.indexOf("{", start); i < config.length; i++) {
      if (config[i] === "{") depth++
      else if (config[i] === "}" && --depth === 0) {
        end = i
        break
      }
    }
    const colours = [...new Set([...config.slice(start, end).matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]))]
    expect(colours.length).toBeGreaterThan(25)

    const missing: string[] = []
    for (const theme of ALL_THEMES) {
      for (const name of colours) {
        try {
          token(themes[theme], name)
        } catch {
          missing.push(`${theme}: ${name}`)
        }
      }
    }
    expect(missing).toEqual([])
  })
})

/**
 * TTES-GATE-010, the other direction.
 *
 * Everything above enumerates FROM `globals.css`: which declared token is
 * unpaired, which declared token fails to resolve, which name `tailwind.config.
 * ts` binds that the catalog does not carry. Every one of those walks
 * stylesheet → component. None walks component → stylesheet, and the gate's own
 * sentence has two halves: "adding a token, OR A NEW FOREGROUND-ON-SURFACE
 * COMBINATION IN A COMPONENT, is invisible to the gate forever." The first half
 * is closed. This is the second.
 *
 * It is not hypothetical. Two live defects were sitting in the product that
 * every assertion above was structurally unable to see, because in both the
 * component named something the stylesheet-first scan had no reason to look at:
 *
 *   1. `src/app/signin/page.tsx` painted the sign-in failure message with
 *      `text-[--danger]` and `border-[--danger]`. `--danger` is declared in no
 *      theme and is in no catalog — it was the only reference to that name in
 *      the product. An undefined custom property with no fallback is invalid at
 *      computed-value time, so `color` fell back to the inherited body ink and
 *      `border-color` to `currentColor`: the one message telling somebody their
 *      credentials failed rendered with no danger semantics whatsoever. A scan
 *      that enumerates declared tokens can never find this, because the token is
 *      precisely the one that is NOT declared.
 *
 *   2. `ui/Avatar.tsx`'s `lg` size wrote `text-base` for the font size, and
 *      `tailwind.config.ts` had a colour named `base`, so Tailwind emitted
 *      `.text-base { font-size: 1rem; …; color: var(--bg-base) }`. Every club
 *      card without a logo (`ClubCard.tsx:61`) drew its monogram initials in the
 *      page background colour. `--bg-base` is declared, resolves in all four
 *      themes and is in the catalog — it passes every assertion above — and it
 *      is a BACKGROUND by name, so the foreground pattern will never match it.
 *      The only way to see it is to notice that a component renders it as ink.
 *
 * So this reads the utilities a component can actually write, from the RESOLVED
 * Tailwind config rather than from the source text of it — `resolveConfig` is
 * what the build calls, so narrowing `textColor` there is measured here — and
 * requires every token reachable as ink to be declared, to resolve in all four
 * themes, and to be paired or explicitly exempt.
 */
describe("TTES-GATE-010 — every foreground a component RENDERS is declared and paired", () => {
  const themes = readThemes()
  const pairedAsForeground = new Set(PAIRINGS.map((p) => p.fg))
  const exempt = new Set(NOT_PAIRED.map((e) => e.token))

  /**
   * Utility suffix → token, for every `text-*` class Tailwind will emit.
   *
   * From `theme.textColor` of the resolved config, which is the map the text
   * utilities are generated from. Reading `colors` instead would be wrong in the
   * one direction that matters: `textColor` is deliberately narrower, and a test
   * that ignored the narrowing could not tell whether removing it re-armed the
   * `text-base` collision.
   */
  const textUtilities = (): Map<string, string> => {
    const theme = resolveConfig(tailwindConfig as never).theme as Record<string, unknown>
    const out = new Map<string, string>()
    const add = (suffix: string, value: unknown) => {
      if (typeof value !== "string") return
      const ref = /^var\((--[\w-]+)\)$/.exec(value.trim())
      // Only token-valued entries. Tailwind's stock palette (`text-red-500`) is
      // literal hex; a component writing one is a raw-value violation, which is
      // the ESLint design-token boundary's job and not this file's.
      if (ref) out.set(suffix, ref[1])
    }
    for (const [key, value] of Object.entries(theme.textColor as Record<string, unknown>)) {
      if (value && typeof value === "object") {
        for (const [inner, v] of Object.entries(value as Record<string, unknown>)) {
          add(inner === "DEFAULT" ? key : `${key}-${inner}`, v)
        }
      } else add(key, value)
    }
    return out
  }

  /**
   * Comments are blanked before scanning, preserving offsets so line numbers
   * still point at the real line. `shell/ShellHeader.tsx` carries a comment
   * reading "NB: not `text-base`" — a warning ABOUT the hazard is not an
   * instance of it, and a scanner that cannot tell the difference reports the
   * documentation as the defect.
   */
  const strip = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (block) => block.replace(/[^\n]/g, " "))

  /** Every token a component renders as ink, with where it does it. */
  const renderedForegrounds = (): Map<string, string[]> => {
    const utilities = textUtilities()
    const root = path.join(__dirname, "..", "..")
    const files: string[] = []
    const walk = (dir: string) => {
      // `src/lib/a11y` names every token in order to audit it.
      if (path.resolve(dir) === path.resolve(__dirname)) return
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(full)
      }
    }
    walk(root)

    const found = new Map<string, string[]>()
    for (const file of files) {
      strip(fs.readFileSync(file, "utf8"))
        .split("\n")
        .forEach((line, i) => {
          for (const chunk of line.split(/[\s"'`{}()=]+/)) {
            // Strip Tailwind variant prefixes: `hover:`, `focus-visible:`,
            // `group-hover:md:` and so on, down to the bare utility.
            const utility = chunk.replace(/^(?:[\w-]+:)+/, "")
            if (!utility.startsWith("text-")) continue
            const suffix = utility.slice(5).replace(/\/\d+$/, "")
            const arbitrary = /^\[(--[\w-]+)\]$/.exec(suffix)
            const name = arbitrary ? arbitrary[1] : utilities.get(suffix)
            if (!name) continue
            if (!found.has(name)) found.set(name, [])
            found.get(name)!.push(`${path.relative(root, file)}:${i + 1}`)
          }
        })
    }
    return found
  }

  it("every token rendered as ink is declared and resolves in all four themes", () => {
    const found = renderedForegrounds()
    // A guard on the guard. If the scan stops finding anything — a changed class
    // convention, a broken variant strip — every assertion here passes
    // vacuously and the ratchet is gone without a single failure.
    expect(found.size).toBeGreaterThan(15)

    const undeclared: string[] = []
    for (const [name, sites] of found) {
      for (const theme of ALL_THEMES) {
        try {
          token(themes[theme], name)
        } catch {
          undeclared.push(`${name} (${theme}) rendered as ink at ${sites[0]}`)
        }
      }
    }
    expect(undeclared).toEqual([])
  })

  it("every token rendered as ink is measured by a pairing", () => {
    const found = renderedForegrounds()
    const unaudited = [...found]
      .filter(([name]) => !pairedAsForeground.has(name) && !exempt.has(name))
      .map(([name, sites]) => `${name} rendered as ink at ${sites.slice(0, 3).join(", ")}`)
    expect(unaudited).toEqual([])
  })

  it("no background-role token is reachable as a text utility at all", () => {
    // The root cause of the Avatar defect, asserted where it was introduced
    // rather than where it surfaced. These three name a surface; a `text-*`
    // class for them has no legitimate use, and one of them collides with the
    // built-in `text-base` font size, which is how it went unnoticed.
    const utilities = textUtilities()
    const surfaces = [...utilities].filter(([, name]) => /^--bg-/.test(name))
    expect(surfaces).toEqual([])
  })
})
