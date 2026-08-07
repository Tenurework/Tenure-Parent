/**
 * GE-022-003 — the four themes the product actually renders, read from
 * `globals.css` rather than copied out of it.
 *
 * A hand-maintained copy of the palette is the failure mode this avoids: it
 * passes the contrast audit forever while the stylesheet drifts underneath it,
 * and the audit gets *more* convincing as it gets less true. Parsing the real
 * file means changing a token either keeps the audit green or turns it red, and
 * there is no third option.
 *
 * Four themes, not two: `prefers-contrast: more` overrides a subset of tokens
 * on top of each base theme, and a palette that passes in default light can
 * still fail in high contrast — the override changes text but not every
 * surface, so the pairing is genuinely different.
 */
import fs from "node:fs"
import path from "node:path"

/**
 * The parser itself lives in `./css-declarations.mjs`.
 *
 * It was here, with one consumer. TTES-000-001 gave it a second — the design
 * token inventory in `tools/entry-point-inventory.mjs`, which runs under plain
 * `node` on the Node 20 CI pins and so cannot import a `.ts` module at all. The
 * choice was a second parser or one file both can reach, and two readers of the
 * same stylesheet that disagree about what it says is precisely the drift this
 * module was written to remove. It is re-exported here so this stays the name
 * anything inside `apps/web` reaches for.
 */
import { blockAt, declarationsIn, paletteOf, resolveToken, tokenNamesIn } from "./css-declarations.mjs"

export { blockAt, declarationsIn, paletteOf, tokenNamesIn }

/**
 * TTES-010-001 — the base palette is `paletteOf`, not the first `:root` block.
 *
 * `globals.css` declares tokens in THREE unconditional `:root` blocks: the
 * colour ramp in `@layer base`, the layout scale (`--content-max`, `--gutter`)
 * in `@layer components`, and the type scale (`--step-00 … --step-4`,
 * `--font-display`) in a second `@layer base`. A first-match scan saw only the
 * first, so nine tokens were declared, bound to Tailwind utilities, and
 * invisible to every audit built on this file. A completeness ratchet standing
 * on a parser that cannot see a third of the tokens has a hole in it by
 * construction, which is why the ratchet and this change land together.
 */

export type ThemeName = "light" | "dark" | "light-contrast" | "dark-contrast"

export type TokenMap = Readonly<Record<string, string>>

/** Where the stylesheet lives, relative to this file. Kept in one place. */
export const GLOBALS_CSS = path.join(__dirname, "..", "..", "app", "globals.css")

/**
 * Resolves each theme by applying the cascade in the order a browser would:
 * base `:root`, then `html.dark`, then the `prefers-contrast: more` overrides.
 */
export function readThemes(cssPath: string = GLOBALS_CSS): Record<ThemeName, TokenMap> {
  const blocks = readBlocks(cssPath)

  const light = { ...blocks.root }
  const darkResolved = { ...blocks.root, ...blocks.dark }

  return {
    light,
    dark: darkResolved,
    "light-contrast": { ...light, ...blocks.rootContrast },
    "dark-contrast": { ...darkResolved, ...blocks.darkContrast },
  }
}

/** The four declaration blocks the cascade is assembled from, unmerged. */
export interface ThemeBlocks {
  /** Every unconditional `:root` block, merged in document order. */
  root: Record<string, string>
  /** The unconditional `html.dark` block. */
  dark: Record<string, string>
  /** `:root` inside `@media (prefers-contrast: more)`. */
  rootContrast: Record<string, string>
  /** `html.dark` inside `@media (prefers-contrast: more)`. */
  darkContrast: Record<string, string>
}

/**
 * The blocks before the cascade merges them.
 *
 * Exposed because *which block* declares a token is load-bearing rather than an
 * implementation detail. `html.dark` has specificity (0,1,1); `:root` has
 * (0,1,0). A tenant's branding arrives as an injected `:root { … }`, so every
 * token `html.dark` restates outranks it — which is precisely why tenant
 * branding reaches the light themes and never the dark ones. `tenant-brand.ts`
 * asserts that from here instead of asserting it in a comment.
 */
export function readBlocks(cssPath: string = GLOBALS_CSS): ThemeBlocks {
  const css = fs.readFileSync(cssPath, "utf8")

  // Every unconditional `:root`, not the first: see the TTES-010-001 note above.
  const root = paletteOf(css)
  const dark = blockAt(css, /(^|\n)\s*html\.dark\s*\{/)

  // The high-contrast overrides live inside the @media block; slice to it first
  // so the :root / html.dark searches below cannot match the base blocks again.
  const mediaStart = css.indexOf("@media (prefers-contrast: more)")
  const contrastCss = mediaStart === -1 ? "" : css.slice(mediaStart)
  const rootContrast = blockAt(contrastCss, /(^|\n)\s*:root\s*\{/)
  const darkContrast = blockAt(contrastCss, /(^|\n)\s*html\.dark\s*\{/)

  return { root, dark, rootContrast, darkContrast }
}

/**
 * Every custom property the four themes declare, sorted.
 *
 * Derived from the parsed blocks rather than from a regex over the whole file:
 * a name declared only inside `@media (max-width: 700px)` is a responsive
 * override, not a palette token, and a catalog of the theme layer should not
 * have to account for it. This is the set `tokens.ts` is reconciled against.
 */
export function declaredTokenNames(cssPath: string = GLOBALS_CSS): string[] {
  const themes = readThemes(cssPath)
  const names = new Set<string>()
  for (const name of ALL_THEMES) for (const key of Object.keys(themes[name])) names.add(key)
  return [...names].sort()
}

export const ALL_THEMES: readonly ThemeName[] = [
  "light",
  "dark",
  "light-contrast",
  "dark-contrast",
]

/**
 * Reads one token, following `var(--other)` indirection within the theme.
 *
 * Throws on a missing token rather than returning a default. A pairing that
 * names a token which no longer exists is a bug in the pairing list, and a
 * silent fallback would let the audit keep passing against a colour nobody
 * renders.
 */
export function token(theme: TokenMap, name: string, seen: Set<string> = new Set()): string {
  // The body moved to `./css-declarations.mjs` at TTES-000-001, unchanged, so
  // the design-token inventory in `tools/entry-point-inventory.mjs` resolves
  // indirection the same way this audit does. It must: `apps/web` declares
  // `--accent: var(--tenure-navy-700)` and `apps/system-studio` declares a
  // literal, and a comparison that did not follow the alias would be comparing
  // spellings rather than colours. This stays the name apps/web reaches for.
  return resolveToken(theme as Record<string, string>, name, seen)
}
