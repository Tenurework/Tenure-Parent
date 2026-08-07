/**
 * TTES-010-001 — the token pipeline.
 *
 * `src/app/globals.css` is the source of truth for the design tokens, and it is
 * CSS: nothing in the TypeScript bundle can name a token in a way the compiler
 * checks. Before this generator the token list was hand-copied into three files
 * that nothing reconciled — the stylesheet, `tailwind.config.ts`, and the eight
 * literal `"var(--chart-N)"` strings in `src/components/charts/palette.ts` — so
 * renaming `--text-1` left `text-text-1` resolving to an undeclared custom
 * property (text silently falling back to its inherited colour) with every test
 * still green.
 *
 * This reads the stylesheet and emits `src/lib/a11y/tokens.ts`: the catalog as
 * data, a `TokenName` union derived from it, and `cssVar(name)`. The union is
 * the point — a token deleted from the stylesheet fails `tsc` at the rendering
 * call site rather than at runtime in a chart nobody screenshotted.
 *
 *   node scripts/generate-design-tokens.mjs           # rewrite tokens.ts
 *   node scripts/generate-design-tokens.mjs --check   # exit 1 if it is stale
 *
 * `src/lib/a11y/tokens.test.ts` runs the same comparison, so a stylesheet edit
 * that forgets the generator reds the suite rather than drifting.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { paletteOf, blockAt } from "../src/lib/a11y/css-declarations.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const GLOBALS_CSS = path.join(HERE, "..", "src", "app", "globals.css")
export const TOKENS_TS = path.join(HERE, "..", "src", "lib", "a11y", "tokens.ts")

/**
 * The three tiers, and which names live in each.
 *
 * `primitive` — a raw value. A colour that exists, a millisecond, a pixel step.
 *   It carries no meaning and does not change between themes.
 * `semantic`  — a decision, expressed as a reference to a primitive. `--primary`
 *   is "the accent", `--text-2` is "secondary prose"; both are a different
 *   primitive in each theme, which is what makes a theme a theme.
 * `component` — a token scoped to one surface: the shell, a badge, a chart slot.
 *
 * An unclassified name throws rather than defaulting. A default would put every
 * future token in whichever tier the fallback picked, and the tier is the thing
 * the layering invariant in tokens.test.ts is asserted against.
 */
const PRIMITIVE_EXACT = new Set([
  "--shell-height",
  "--sidenav-width",
  "--sidenav-width-collapsed",
  "--footer-height",
  "--content-max",
  "--gutter",
  "--font-sans",
  "--font-display",
  "--control-h",
  "--control-h-sm",
  "--control-h-lg",
  "--row-h",
])
const COMPONENT_EXACT = new Set(["--segment-active-bg", "--sidenav-current-width"])
const SEMANTIC_EXACT = new Set(["--density-gap"])

export function layerOf(name) {
  if (name.startsWith("--tenure-")) return "primitive"
  if (PRIMITIVE_EXACT.has(name)) return "primitive"
  if (/^--(space|radius|step|z|motion|ease)-/.test(name)) return "primitive"
  if (COMPONENT_EXACT.has(name)) return "component"
  if (SEMANTIC_EXACT.has(name)) return "semantic"
  if (/^--(shell|badge|chart)-/.test(name)) return "component"
  if (/^--(primary|accent|bg|border|text|success|warning|error|info|shadow)(-|$)/.test(name)) {
    return "semantic"
  }
  throw new Error(
    `generate-design-tokens: ${name} is declared in globals.css but no tier claims it. ` +
      `Add it to PRIMITIVE_EXACT / SEMANTIC_EXACT / COMPONENT_EXACT or to one of the prefix rules ` +
      `in scripts/generate-design-tokens.mjs — a token with no tier cannot be held to the layering invariant.`,
  )
}

/** Every custom property the four themes declare, sorted, with its tier. */
export function catalogOf(css) {
  const contrastStart = css.indexOf("@media (prefers-contrast: more)")
  const contrastCss = contrastStart === -1 ? "" : css.slice(contrastStart)
  const blocks = [
    paletteOf(css),
    blockAt(css, /(^|\n)\s*html\.dark\s*\{/),
    blockAt(contrastCss, /(^|\n)\s*:root\s*\{/),
    blockAt(contrastCss, /(^|\n)\s*html\.dark\s*\{/),
  ]
  const names = new Set()
  for (const block of blocks) for (const name of Object.keys(block)) names.add(name)
  return [...names].sort().map((name) => ({ name, layer: layerOf(name) }))
}

const HEADER = `/**
 * The design token catalog — GENERATED. Do not edit by hand.
 *
 *   node scripts/generate-design-tokens.mjs
 *
 * Emitted from \`src/app/globals.css\` by \`scripts/generate-design-tokens.mjs\`,
 * which is where the tiers are decided and where the header of this comment
 * explains why the pipeline exists. \`src/lib/a11y/tokens.test.ts\` re-runs the
 * generator against the real stylesheet and fails if this file is stale, so the
 * catalog cannot quietly disagree with the CSS the product ships.
 *
 * \`TokenName\` is the payoff: it is a union over the names below, so a token
 * removed from the stylesheet stops compiling at every call site that named it
 * — \`src/components/charts/palette.ts\` is the first — instead of resolving to
 * an undeclared custom property at runtime, which is invisible.
 */

export type TokenLayer = "primitive" | "semantic" | "component"

export interface TokenEntry {
  readonly name: string
  readonly layer: TokenLayer
}

/** Every custom property \`globals.css\` declares, in the tier it belongs to. */
export const TOKENS = [
`

const FOOTER = `] as const satisfies readonly TokenEntry[]

/** Every token name the stylesheet declares, as a compile-time union. */
export type TokenName = (typeof TOKENS)[number]["name"]

/**
 * The \`var()\` reference for a token, checked against the catalog at compile time.
 *
 * This is what makes the catalog load-bearing rather than documentation: a
 * consumer writes \`cssVar("--chart-1")\` and a rename in the stylesheet — which
 * regenerates this file — turns that call site red.
 */
export function cssVar(name: TokenName): string {
  return \`var(\${name})\`
}

/** The tier a token belongs to, or undefined when it is not in the catalog. */
export function layerOf(name: string): TokenLayer | undefined {
  return TOKENS.find((token) => token.name === name)?.layer
}
`

export function renderTokensModule(css) {
  const entries = catalogOf(css)
    .map(({ name, layer }) => `  { name: "${name}", layer: "${layer}" },`)
    .join("\n")
  return `${HEADER}${entries}\n${FOOTER}`
}

function main() {
  const css = fs.readFileSync(GLOBALS_CSS, "utf8")
  const rendered = renderTokensModule(css)
  const check = process.argv.includes("--check")
  const current = fs.existsSync(TOKENS_TS) ? fs.readFileSync(TOKENS_TS, "utf8") : ""
  if (current === rendered) {
    console.log(`tokens.ts is up to date (${catalogOf(css).length} tokens).`)
    return
  }
  if (check) {
    console.error("tokens.ts is stale. Run: node scripts/generate-design-tokens.mjs")
    process.exitCode = 1
    return
  }
  fs.writeFileSync(TOKENS_TS, rendered)
  console.log(`wrote tokens.ts (${catalogOf(css).length} tokens).`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main()
