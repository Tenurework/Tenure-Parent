/**
 * GE-143-020 — the density contract, audited against the stylesheet that ships.
 *
 * The requirement: "Implement governed comfortable and compact density on a
 * four-pixel grid. Preserve readable type, accessible touch targets, focus,
 * labels, error content, and safety context in every density."
 *
 * `globals.css` had the two densities and the switcher already, and
 * `design-contracts.test.ts` already asserted that compact overrides every
 * token and only shrinks. What nothing checked was the two halves of the
 * sentence that are not about ordering:
 *
 *   * **the four-pixel grid.** Compact shipped `--control-h: 34px` and
 *     `--control-h-lg: 38px`. Both are 2px off the grid every other spacing
 *     token in the file sits on, so a compact control could not align with a
 *     `--space-*` gutter beside it at any zoom. Nothing said so, because
 *     "smaller than comfortable" was the only property under test.
 *   * **what compact may NOT change.** A density that shrinks type, dims a
 *     label, drops an error message or hides the tenant/environment banner is
 *     no longer the same interface at a different size — it is a second, less
 *     safe interface. The rule is therefore expressed as a prohibition on the
 *     density blocks rather than as a hope: a `[data-density]` rule may declare
 *     the governed size tokens and nothing else.
 *
 * This module reads `src/app/globals.css` — the real file, not a fixture,
 * because a fixture keeps passing after the stylesheet drifts, and drift is the
 * entire failure mode. It reuses the brace-balanced reader nothing else here
 * duplicates: `rulesIn` below is the only CSS rule-walker in `lib/a11y`, and
 * `css-declarations.mjs` remains the only declaration reader for palettes.
 *
 * Every finding carries a reason. `auditDensity` returning an empty `findings`
 * array with a zero `governed.length` would be a vacuous pass, so the audit
 * reports what it FOUND as well as what it objects to, and the test asserts
 * both.
 */
import fs from "node:fs"
import path from "node:path"

/** One brace-balanced CSS rule, with the selector stack that reached it. */
export interface CssRule {
  /** Outermost first: `["@media (max-width: 900px)", ":root"]`. */
  readonly context: readonly string[]
  readonly declarations: Readonly<Record<string, string>>
}

/** Strips comments so a quoted defect in prose is not read as a declaration. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "")
}

/**
 * Every rule in a stylesheet, with its nesting.
 *
 * A regex that reads "everything up to the next `}`" is wrong here for the same
 * reason it was wrong in `css-declarations.mjs`: the density and forced-colors
 * blocks are nested inside `@layer` and `@media`, and a naive scan stops at the
 * wrong brace, returning a partial rule that then passes its own tests.
 */
export function rulesIn(css: string): CssRule[] {
  const source = withoutComments(css)
  const out: CssRule[] = []
  const stack: { prelude: string; declarations: Record<string, string> }[] = []
  let buffer = ""

  const flushDeclaration = () => {
    const decl = /^\s*(--[\w-]+|[a-zA-Z-]+)\s*:\s*([\s\S]+)$/.exec(buffer)
    if (decl && stack.length > 0) {
      stack[stack.length - 1].declarations[decl[1]] = decl[2].trim()
    }
    buffer = ""
  }

  for (const ch of source) {
    if (ch === "{") {
      stack.push({ prelude: buffer.trim().replace(/\s+/g, " "), declarations: {} })
      buffer = ""
    } else if (ch === "}") {
      flushDeclaration()
      const frame = stack.pop()
      if (frame) {
        out.push({
          context: [...stack.map((f) => f.prelude), frame.prelude],
          declarations: frame.declarations,
        })
      }
    } else if (ch === ";") {
      flushDeclaration()
    } else {
      buffer += ch
    }
  }
  return out
}

/** The primitive spacing scale, `--space-1` … `--space-16`, in px. */
export function spaceScale(rules: readonly CssRule[]): Map<string, number> {
  const scale = new Map<string, number>()
  for (const rule of rules) {
    for (const [name, value] of Object.entries(rule.declarations)) {
      if (!/^--space-\d+$/.test(name) || scale.has(name)) continue
      const px = /^(\d+(?:\.\d+)?)px$/.exec(value)
      if (px) scale.set(name, Number.parseFloat(px[1]))
    }
  }
  return scale
}

/** A resolved value, or the reason it could not be resolved. */
export type PxResolution =
  | { readonly ok: true; readonly px: number }
  | { readonly ok: false; readonly reason: string }

/**
 * Resolves a density value to CSS pixels.
 *
 * Only two forms are legal: a px literal, or a reference to the primitive
 * spacing scale. Anything else — an `em`, a `calc`, a reference to a token that
 * is not on the scale — is REFUSED with a reason rather than skipped, because a
 * value the grid check cannot read is exactly the value most likely to be off
 * the grid.
 */
export function resolvePx(value: string, scale: Map<string, number>): PxResolution {
  const literal = /^(\d+(?:\.\d+)?)px$/.exec(value.trim())
  if (literal) return { ok: true, px: Number.parseFloat(literal[1]) }
  const reference = /^var\(\s*(--space-\d+)\s*\)$/.exec(value.trim())
  if (reference) {
    const px = scale.get(reference[1])
    if (px === undefined) {
      return { ok: false, reason: `${reference[1]} is not declared on the spacing scale` }
    }
    return { ok: true, px }
  }
  return { ok: false, reason: `expected a px literal or var(--space-N), read "${value.trim()}"` }
}

export interface DensityFinding {
  readonly code:
    | "off-grid"
    | "below-minimum-target"
    | "unresolvable"
    | "ungoverned-declaration"
    | "missing-default"
    | "hides-content"
  readonly token: string
  readonly context: string
  readonly detail: string
}

export interface DensityAudit {
  /** The token names any `[data-density]` rule governs. */
  readonly governed: readonly string[]
  /** Every governed value found, keyed `context::token`. */
  readonly values: ReadonlyMap<string, number>
  readonly findings: readonly DensityFinding[]
}

/** The grid every spacing and sizing decision in the product sits on. */
export const GRID_PX = 4

/**
 * WCAG 2.2 SC 2.5.8 Target Size (Minimum), level AA. A control shorter than
 * this is a target a person with a tremor cannot reliably hit, and "compact"
 * is not a reason to ship one.
 */
export const MINIMUM_TARGET_PX = 24

/** Tokens that size a pointer target rather than a gap. */
const TARGET_TOKENS = /^--(control-h|row-h)/

/**
 * What a `[data-density]` rule is allowed to say.
 *
 * Deliberately a prefix allow-list rather than a deny-list of colours and font
 * sizes: a deny-list is only ever as complete as the last person to think about
 * it, and the thing being defended — the reader's ability to read a label, an
 * error and the tenant banner at either density — is defended by the density
 * blocks changing SIZE and nothing else.
 */
const GOVERNABLE = /^--(control-h(-sm|-lg)?|row-h|density-gap)$/

export function auditDensity(css: string): DensityAudit {
  const rules = rulesIn(css)
  const scale = spaceScale(rules)

  const densityRules = rules.filter((r) => r.context.some((c) => c.includes("[data-density")))
  const governed = new Set<string>()
  for (const rule of densityRules) {
    for (const name of Object.keys(rule.declarations)) {
      if (name.startsWith("--")) governed.add(name)
    }
  }

  const findings: DensityFinding[] = []
  const values = new Map<string, number>()

  // A density rule may only move the governed size tokens.
  for (const rule of densityRules) {
    const context = rule.context.join(" ")
    for (const [name, value] of Object.entries(rule.declarations)) {
      if (name.startsWith("--")) {
        if (!GOVERNABLE.test(name)) {
          findings.push({
            code: "ungoverned-declaration",
            token: name,
            context,
            detail:
              "a density may change size and nothing else; type, colour and focus are the same at both densities",
          })
        }
        continue
      }
      if (/^(display|visibility|content-visibility)$/.test(name) && /none|hidden/.test(value)) {
        findings.push({
          code: "hides-content",
          token: name,
          context,
          detail: `compact tightens the interface, it does not remove part of it (${name}: ${value})`,
        })
      }
    }
  }

  // Every governed token, in every rule that sets it, on the grid and above the
  // minimum target — including the `:root` defaults, which are the comfortable
  // density and are just as subject to the grid.
  for (const rule of rules) {
    const context = rule.context.join(" ")
    for (const [name, value] of Object.entries(rule.declarations)) {
      if (!governed.has(name)) continue
      const resolved = resolvePx(value, scale)
      if (!resolved.ok) {
        findings.push({ code: "unresolvable", token: name, context, detail: resolved.reason })
        continue
      }
      values.set(`${context}::${name}`, resolved.px)
      if (resolved.px % GRID_PX !== 0) {
        findings.push({
          code: "off-grid",
          token: name,
          context,
          detail: `${resolved.px}px is not a multiple of ${GRID_PX}px`,
        })
      }
      if (TARGET_TOKENS.test(name) && resolved.px < MINIMUM_TARGET_PX) {
        findings.push({
          code: "below-minimum-target",
          token: name,
          context,
          detail: `${resolved.px}px is below the ${MINIMUM_TARGET_PX}px WCAG 2.2 SC 2.5.8 minimum`,
        })
      }
    }
  }

  // A token a density overrides but nothing declares by default renders as an
  // empty custom property at comfortable — an invisible control.
  const declaredAnywhere = new Set<string>()
  for (const rule of rules) {
    if (rule.context.some((c) => c.includes("[data-density"))) continue
    for (const name of Object.keys(rule.declarations)) declaredAnywhere.add(name)
  }
  for (const name of governed) {
    if (!declaredAnywhere.has(name)) {
      findings.push({
        code: "missing-default",
        token: name,
        context: ":root",
        detail: "overridden by a density but never declared as the comfortable default",
      })
    }
  }

  return { governed: [...governed].sort(), values, findings }
}

/** Audits the stylesheet the product actually ships. */
export function auditShippedDensity(): DensityAudit {
  const css = fs.readFileSync(
    path.join(__dirname, "..", "..", "app", "globals.css"),
    "utf8",
  )
  return auditDensity(css)
}
