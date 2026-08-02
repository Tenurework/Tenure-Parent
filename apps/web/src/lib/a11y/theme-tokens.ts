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

export type ThemeName = "light" | "dark" | "light-contrast" | "dark-contrast"

export type TokenMap = Readonly<Record<string, string>>

/** Where the stylesheet lives, relative to this file. Kept in one place. */
export const GLOBALS_CSS = path.join(__dirname, "..", "..", "app", "globals.css")

/**
 * Pulls `--name: value;` declarations out of one brace-balanced block.
 *
 * Brace-balanced rather than "until the next `}`", because the high-contrast
 * blocks are nested inside `@media` and a naive scan stops at the wrong line —
 * silently returning a partial palette, which is worse than returning none.
 */
function declarationsIn(css: string, openIndex: number): Record<string, string> {
  let depth = 0
  let end = openIndex
  for (let i = openIndex; i < css.length; i++) {
    if (css[i] === "{") depth++
    else if (css[i] === "}") {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }

  const body = css.slice(openIndex + 1, end)
  const out: Record<string, string> = {}
  // Only declarations at this block's own depth; a nested rule's declarations
  // belong to that rule, not to this one.
  let nesting = 0
  for (const line of body.split("\n")) {
    const opens = (line.match(/\{/g) ?? []).length
    const closes = (line.match(/\}/g) ?? []).length
    if (nesting === 0) {
      const decl = /^\s*(--[\w-]+)\s*:\s*([^;]+);/.exec(line)
      if (decl) out[decl[1]] = decl[2].trim()
    }
    nesting += opens - closes
  }
  return out
}

/** Finds a selector's block at top level of the file and returns its declarations. */
function blockAt(css: string, pattern: RegExp): Record<string, string> {
  const match = pattern.exec(css)
  if (!match) return {}
  const open = css.indexOf("{", match.index + match[0].length - 1)
  if (open === -1) return {}
  return declarationsIn(css, open)
}

/**
 * Resolves each theme by applying the cascade in the order a browser would:
 * base `:root`, then `html.dark`, then the `prefers-contrast: more` overrides.
 */
export function readThemes(cssPath: string = GLOBALS_CSS): Record<ThemeName, TokenMap> {
  const css = fs.readFileSync(cssPath, "utf8")

  const root = blockAt(css, /(^|\n)\s*:root\s*\{/)
  const dark = blockAt(css, /(^|\n)\s*html\.dark\s*\{/)

  // The high-contrast overrides live inside the @media block; slice to it first
  // so the :root / html.dark searches below cannot match the base blocks again.
  const mediaStart = css.indexOf("@media (prefers-contrast: more)")
  const contrastCss = mediaStart === -1 ? "" : css.slice(mediaStart)
  const rootContrast = blockAt(contrastCss, /(^|\n)\s*:root\s*\{/)
  const darkContrast = blockAt(contrastCss, /(^|\n)\s*html\.dark\s*\{/)

  const light = { ...root }
  const darkResolved = { ...root, ...dark }

  return {
    light,
    dark: darkResolved,
    "light-contrast": { ...light, ...rootContrast },
    "dark-contrast": { ...darkResolved, ...darkContrast },
  }
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
  const value = theme[name]
  if (value === undefined) throw new Error(`no such token in this theme: ${name}`)
  const indirect = /^var\((--[\w-]+)\)$/.exec(value.trim())
  if (!indirect) return value
  if (seen.has(name)) throw new Error(`token ${name} resolves in a cycle`)
  seen.add(name)
  return token(theme, indirect[1], seen)
}
