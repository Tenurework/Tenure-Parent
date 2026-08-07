/**
 * The brace-balanced CSS reader, in one implementation.
 *
 * It used to live inside `theme-tokens.ts` and had exactly one consumer, the
 * contrast audit. TTES-000-001 gave it a second: `tools/entry-point-inventory.mjs`
 * inventories the design tokens of BOTH experiences, and a generator that ran
 * `node` could not import a `.ts` module — CI pins Node 20, which has no type
 * stripping. The choice was therefore a second parser or one file both can
 * reach, and a second parser is the failure this whole inventory exists to
 * prevent: two readers of the same stylesheet that disagree about what it says,
 * each passing its own tests.
 *
 * So the code is here, in plain ESM. `theme-tokens.ts` imports and re-exports
 * it, so nothing that used it before had to change; the generator imports it
 * directly. There is one implementation, and if it breaks, both break.
 */

/**
 * Pulls `--name: value;` declarations out of one brace-balanced block.
 *
 * Brace-balanced rather than "until the next `}`", because the high-contrast
 * blocks are nested inside `@media` and a naive scan stops at the wrong line —
 * silently returning a partial palette, which is worse than returning none.
 *
 * @param {string} css
 * @param {number} openIndex index of the block's opening `{`
 * @returns {Record<string, string>}
 */
export function declarationsIn(css, openIndex) {
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
  /** @type {Record<string, string>} */
  const out = {}
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

/**
 * Finds a selector's block and returns its declarations.
 *
 * @param {string} css
 * @param {RegExp} pattern must end at the block's opening `{`
 * @returns {Record<string, string>}
 */
export function blockAt(css, pattern) {
  const match = pattern.exec(css)
  if (!match) return {}
  const open = css.indexOf("{", match.index + match[0].length - 1)
  if (open === -1) return {}
  return declarationsIn(css, open)
}

/** The index of the block's opening `{` for every match of `pattern`. */
function openIndexes(css, pattern) {
  const global = pattern.flags.includes("g")
    ? pattern
    : new RegExp(pattern.source, `${pattern.flags}g`)
  const out = []
  for (const match of css.matchAll(global)) {
    const open = css.indexOf("{", match.index + match[0].length - 1)
    if (open !== -1) out.push(open)
  }
  return out
}

/** `[start, end]` of the brace-balanced block opening at `openIndex`. */
function extentOf(css, openIndex) {
  let depth = 0
  for (let i = openIndex; i < css.length; i++) {
    if (css[i] === "{") depth++
    else if (css[i] === "}" && --depth === 0) return [openIndex, i]
  }
  return [openIndex, css.length]
}

/**
 * The palette a browser resolves with no media query matched and no state
 * attribute set: every `:root { … }` block that is NOT inside an `@media`,
 * merged in document order so a later block wins, as the cascade would.
 *
 * Every `:root`, not the first one. `apps/web/src/app/globals.css` declares the
 * colour ramp in `@layer base { :root { … } }` and the layout scale in a second
 * `@layer components { :root { … } }`; `apps/system-studio/src/app/globals.css`
 * splits palette and spacing across two `:root` blocks the same way. Reading
 * only the first would have reported `--space-6` as declared by one experience
 * and not the other, and the divergence this inventory exists to catch is
 * exactly `--space-6`.
 *
 * @param {string} css
 * @returns {Record<string, string>}
 */
export function paletteOf(css) {
  const mediaBlocks = openIndexes(css, /@media[^{]*\{/g).map((open) => extentOf(css, open))
  const insideMedia = (index) => mediaBlocks.some(([start, end]) => index > start && index < end)

  /** @type {Record<string, string>} */
  const merged = {}
  for (const open of openIndexes(css, /(^|\n)\s*:root\s*\{/g)) {
    if (insideMedia(open)) continue
    Object.assign(merged, declarationsIn(css, open))
  }
  return merged
}

/**
 * Reads one token out of a resolved map, following `var(--other)` indirection.
 *
 * Throws on a missing token rather than returning a default. A pairing that
 * names a token which no longer exists is a bug in the pairing list, and a
 * silent fallback would let the audit keep passing against a colour nobody
 * renders. `theme-tokens.ts` exports this as `token`.
 *
 * Indirection is why this matters twice over: `apps/web` declares
 * `--accent: var(--tenure-navy-700)` while `apps/system-studio` declares a
 * literal, so a comparison of raw declarations would report two experiences as
 * disagreeing about a colour they might actually share — or, worse, as agreeing
 * because both spell it `var(--accent-base)` while the two base ramps differ.
 *
 * @param {Record<string, string>} map
 * @param {string} name
 * @param {Set<string>} [seen]
 * @returns {string}
 */
export function resolveToken(map, name, seen = new Set()) {
  const value = map[name]
  if (value === undefined) throw new Error(`no such token in this theme: ${name}`)
  const indirect = /^var\((--[\w-]+)\)$/.exec(value.trim())
  if (!indirect) return value
  if (seen.has(name)) throw new Error(`token ${name} resolves in a cycle`)
  seen.add(name)
  return resolveToken(map, indirect[1], seen)
}

/**
 * Every custom property name declared anywhere in the file, sorted.
 *
 * Anywhere, not only in `:root` — `html.dark`, `:root[data-density="compact"]`
 * and the `prefers-contrast` overrides all declare tokens, and a count that
 * skipped them would understate what each stylesheet defines.
 *
 * @param {string} css
 * @returns {string[]}
 */
export function tokenNamesIn(css) {
  const names = new Set()
  for (const match of css.matchAll(/^\s*(--[\w-]+)\s*:\s*[^;]+;/gm)) names.add(match[1])
  return [...names].sort()
}
