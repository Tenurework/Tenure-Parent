/**
 * TTES-010-001 — the token pipeline, held to the three things that make it one.
 *
 * Before this, the token list lived in three files that nothing reconciled:
 * `src/app/globals.css` declared it, `tailwind.config.ts` re-declared every name
 * as a `var(--x)` string, and `src/components/charts/palette.ts` held a third
 * copy of the eight chart slots. Renaming `--text-1` left `text-text-1`
 * resolving to an undeclared custom property — text quietly falling back to its
 * inherited colour — with every test in the suite still green.
 *
 * The four assertions below are what closes that. Each one is a reconciliation
 * against a real file, never against a list maintained beside it.
 */
import { describe, expect, it } from "@jest/globals"

import fs from "node:fs"
import path from "node:path"

import { catalogOf, layerOf as generatorLayerOf, renderTokensModule } from "../../../scripts/generate-design-tokens.mjs"
import { parseColor } from "./contrast"
import { ALL_THEMES, GLOBALS_CSS, readBlocks, readThemes, declaredTokenNames, token } from "./theme-tokens"
import { TOKENS, cssVar, layerOf, type TokenName } from "./tokens"
import { CHART_SLOTS } from "@/components/charts/palette"

const TAILWIND_CONFIG = path.join(__dirname, "..", "..", "..", "tailwind.config.ts")
const TOKENS_TS = path.join(__dirname, "tokens.ts")

describe("the catalog is generated from the stylesheet, not maintained beside it", () => {
  it("tokens.ts is exactly what the generator emits from globals.css", () => {
    // The whole pipeline rests on this. If tokens.ts can drift from the CSS then
    // TokenName is a union over a stale list, and a compile error that should
    // have fired at a rendering call site never does.
    const rendered = renderTokensModule(fs.readFileSync(GLOBALS_CSS, "utf8"))
    const current = fs.readFileSync(TOKENS_TS, "utf8")
    expect(current === rendered ? "up to date" : "STALE — run: node scripts/generate-design-tokens.mjs").toBe(
      "up to date",
    )
  })

  it("accounts for every custom property the four themes declare", () => {
    const declared = declaredTokenNames()
    const cataloged = new Set<string>(TOKENS.map((t) => t.name))
    expect(declared.filter((name) => !cataloged.has(name))).toEqual([])
    // And nothing in the catalog that the stylesheet no longer declares — a
    // catalog with a ghost in it is a TokenName that compiles and renders nothing.
    const declaredSet = new Set(declared)
    expect(TOKENS.map((t) => t.name).filter((name) => !declaredSet.has(name))).toEqual([])
  })

  it("refuses to classify a token it has no tier for", () => {
    // The generator's fallback throws rather than defaulting. A default would put
    // every future token into whichever tier the fallback picked, and the tier is
    // what the layering invariant below is asserted against.
    expect(() => generatorLayerOf("--something-nobody-classified")).toThrow(/no tier claims it/)
  })
})

describe("every catalog name resolves", () => {
  const themes = readThemes()

  for (const theme of ALL_THEMES) {
    it(`${theme}`, () => {
      const unresolved: string[] = []
      for (const entry of TOKENS) {
        try {
          token(themes[theme], entry.name)
        } catch (error) {
          unresolved.push(`${entry.name}: ${(error as Error).message}`)
        }
      }
      expect(unresolved).toEqual([])
    })
  }
})

describe("primitive → semantic → component is a real layering, not three names", () => {
  it("only the primitive tier declares a raw colour", () => {
    // This is the whole content of "there is a primitive tier". Before it, the
    // semantic names WERE the raw hexes — `--primary: #198052` — so there was
    // nothing for a semantic token to be semantic ABOUT, and changing the brand
    // ramp meant a find-and-replace across the stylesheet. A semantic or
    // component token that carries a literal colour has skipped the tier.
    const blocks = readBlocks()
    const offenders: string[] = []
    for (const block of [blocks.root, blocks.dark, blocks.rootContrast, blocks.darkContrast]) {
      for (const [name, value] of Object.entries(block)) {
        if (!parseColor(value)) continue
        if (layerOf(name) !== "primitive") offenders.push(`${name}: ${value} (tier ${layerOf(name)})`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("has a primitive tier at all, and every tier is populated", () => {
    const counts = { primitive: 0, semantic: 0, component: 0 }
    for (const entry of TOKENS) counts[entry.layer]++
    expect(counts.primitive).toBeGreaterThan(50)
    expect(counts.semantic).toBeGreaterThan(20)
    expect(counts.component).toBeGreaterThan(10)
  })

  it("every colour-valued semantic and component token references a primitive", () => {
    // The declaration must be an indirection into the tier that owns the value.
    // Resolving to the right colour by coincidence is not the same as pointing
    // at the primitive: the second is what makes the ramp editable in one place.
    const blocks = readBlocks()
    const themes = readThemes()
    const pairs = [
      [blocks.root, themes.light],
      [blocks.dark, themes.dark],
      [blocks.rootContrast, themes["light-contrast"]],
      [blocks.darkContrast, themes["dark-contrast"]],
    ] as const

    const notLayered: string[] = []
    for (const [block, theme] of pairs) {
      for (const [name, value] of Object.entries(block)) {
        if (layerOf(name) === "primitive") continue
        // Only colour tokens: --density-gap points at --space-5, which is the
        // same discipline on a different axis and not this test's business.
        if (!parseColor(token(theme, name))) continue
        const indirect = /^var\((--[\w-]+)\)$/.exec(value.trim())
        if (!indirect) {
          notLayered.push(`${name}: ${value} — a colour written out, not a reference`)
          continue
        }
        if (layerOf(indirect[1]) !== "primitive") {
          notLayered.push(`${name} -> ${indirect[1]} (tier ${layerOf(indirect[1])})`)
        }
      }
    }
    expect(notLayered).toEqual([])
  })
})

describe("the three copies of the token list are now one", () => {
  it("every var() tailwind.config.ts binds a utility to is a catalog member", () => {
    // tailwind.config.ts re-declares every token name as a `var(--x)` string.
    // That is the hand-maintained copy theme-tokens.ts's own header warns about,
    // and until this ran nothing compared the two: renaming --text-1 left
    // `text-text-1` resolving to an undeclared property with the suite green.
    const config = fs.readFileSync(TAILWIND_CONFIG, "utf8")
    const referenced = [...config.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1])
    expect(referenced.length).toBeGreaterThan(30)
    const cataloged = new Set<string>(TOKENS.map((t) => t.name))
    const undeclared = [...new Set(referenced)].filter((name) => !cataloged.has(name))
    expect(undeclared).toEqual([])
  })

  it("the chart palette is built from the catalog, not from eight literal strings", () => {
    // The production caller. `cssVar` takes a TokenName, so a chart slot deleted
    // from globals.css fails `tsc` here rather than rendering as no fill.
    expect([...CHART_SLOTS]).toEqual([
      "var(--chart-1)",
      "var(--chart-2)",
      "var(--chart-3)",
      "var(--chart-4)",
      "var(--chart-5)",
      "var(--chart-6)",
      "var(--chart-7)",
      "var(--chart-8)",
    ])

    // …and it reaches them THROUGH the catalog. The values above are equal
    // whether palette.ts calls cssVar or writes the eight strings out, so on
    // their own they prove nothing about the coupling — the compile-time link is
    // the whole point of the change, and this is what asserts it is still there.
    const source = fs.readFileSync(
      path.join(__dirname, "..", "..", "components", "charts", "palette.ts"),
      "utf8",
    )
    expect(source).toContain('import { cssVar } from "@/lib/a11y/tokens"')
    for (let slot = 1; slot <= 8; slot++) expect(source).toContain(`cssVar("--chart-${slot}")`)
    expect(source).not.toMatch(/"var\(--chart-\d\)"/)
  })

  it("cssVar emits the reference the stylesheet answers to", () => {
    const name: TokenName = "--text-1"
    expect(cssVar(name)).toBe("var(--text-1)")
    expect(catalogOf(fs.readFileSync(GLOBALS_CSS, "utf8")).length).toBe(TOKENS.length)
  })
})
