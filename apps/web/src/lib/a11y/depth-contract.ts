/**
 * GE-143-015 — radius, border, translucency and elevation, audited.
 *
 * The requirement: "Define controlled radius, border, translucency, and
 * elevation systems. Use depth sparingly; prohibit glass/blur where variable
 * content, performance, contrast, or focus clarity suffers."
 *
 * The four systems were DEFINED — `--radius-*`, `--border*`, the `--shadow-*`
 * ramp art-directed separately for light and dark, and `--bg-overlay`. Two
 * things were not:
 *
 *   * **Nothing held them closed.** A rule could write `border-radius: 11px` or
 *     `box-shadow: 0 20px 60px rgba(0,0,0,.5)` and no test in the repository
 *     would have said a word. A scale that anything may step outside is a
 *     suggestion.
 *   * **Nothing prohibited the blur.** `.overlay-backdrop` blurs 6px behind
 *     every modal in the product. That is a defensible use — the content behind
 *     a modal is meant to recede — but "defensible" is a judgement somebody
 *     made once and wrote nowhere, and the requirement asks for a prohibition
 *     with named grounds, not a habit. `TRANSLUCENCY` is that register: each
 *     entry states what sits behind the surface, why contrast and focus clarity
 *     survive it, and what a reader who has asked their platform for reduced
 *     transparency gets instead. An unregistered blur is a finding.
 *
 * "Use depth sparingly" is checked as a CEILING on the elevation ramp rather
 * than as a rule about any one surface: five steps is a system, twelve is a
 * mood. And the ramp has to declare the same step names in dark as in light —
 * a missing step in one theme is a surface that loses its edge on that theme
 * only, which is the kind of defect that survives review because nobody looks
 * at both.
 *
 * Reads the shipped `globals.css` through `rulesIn` from `./density-contract`.
 * One CSS reader in this directory, deliberately.
 *
 * What this does NOT reach, said plainly rather than left to be discovered: a
 * component that writes `rounded-[10px]` or `shadow-[0_20px_60px_#000]` as a
 * Tailwind arbitrary value never appears in `globals.css`, so `radius-literal`
 * and `elevation-literal` cannot see it. Those are TSX class strings, and the
 * enforcement that reaches them is the ESLint rule in `apps/web/eslint.config.mjs`
 * — a different mechanism with a different scope. This module governs the
 * stylesheet; it does not claim to govern the class attribute.
 */
import fs from "node:fs"
import path from "node:path"

import { rulesIn } from "./density-contract"

/**
 * Every translucent surface the product is allowed to render.
 *
 * Not a ban, because a blanket ban is dishonest about the one case where the
 * effect earns its place; a register, because each case has to answer the four
 * questions the requirement names — variable content, performance, contrast,
 * focus clarity — in writing.
 */
export interface TranslucentSurface {
  readonly selector: string
  /** The declaration, exactly as the stylesheet writes it. */
  readonly declaration: string
  /** What sits behind it. */
  readonly behind: string
  /** Why contrast, focus clarity and performance survive it. */
  readonly justification: string
  /** What a reader with reduced transparency, or forced colors, gets instead. */
  readonly whenTransparencyReduced: string
}

export const TRANSLUCENCY: readonly TranslucentSurface[] = [
  {
    selector: ".overlay-backdrop",
    declaration: "blur(6px)",
    behind: "the page the modal was opened from — never text the reader is expected to read",
    justification:
      "the blur sits UNDER an opaque `.overlay-panel`, so no product text or content is ever read through it and no text/background contrast pair is computed across it; its only job is to stop the page behind a dialog competing for attention. Nothing focusable is behind it while it is up — the overlay traps focus — so focus clarity cannot suffer either. It is one full-viewport layer at a fixed 6px radius, composited once on open rather than animated per frame, so the performance cost is a single paint.",
    whenTransparencyReduced:
      "the `prefers-reduced-transparency: reduce` block drops the blur to `none`; the scrim keeps its `--bg-overlay` alpha, because an opaque scrim would remove the reader's context entirely rather than reduce an effect. Forced-colors mode drops it as well, through the separate `forced-colors: active` block, since the platform cannot recolour a blur.",
  },
]

/** More steps than this is a mood, not a system. */
export const MAX_ELEVATION_STEPS = 6

export interface DepthFinding {
  readonly code:
    | "radius-literal"
    | "elevation-literal"
    | "elevation-ramp-too-deep"
    | "elevation-ramp-incomplete-in-a-theme"
    | "unregistered-translucency"
    | "register-disagrees-with-stylesheet"
    | "reduced-transparency-incomplete"
  readonly where: string
  readonly detail: string
}

export interface DepthAudit {
  readonly radiusSteps: readonly string[]
  readonly elevationSteps: readonly string[]
  /** Rules that paint depth, by selector. */
  readonly depthRules: readonly string[]
  readonly findings: readonly DepthFinding[]
}

const REDUCED_TRANSPARENCY = "prefers-reduced-transparency"

/** `0`, `50%` and a pill are geometry, not steps on a scale. */
const RADIUS_EXEMPT = /^(0|0px|50%|9999px|inherit|initial|unset)$/

function tokenNames(rules: ReturnType<typeof rulesIn>, prefix: RegExp): string[] {
  const seen = new Set<string>()
  for (const rule of rules) {
    for (const name of Object.keys(rule.declarations)) {
      if (prefix.test(name)) seen.add(name)
    }
  }
  return [...seen].sort()
}

export function auditDepth(css: string): DepthAudit {
  const rules = rulesIn(css)
  const findings: DepthFinding[] = []
  const depthRules: string[] = []

  const radiusSteps = tokenNames(rules, /^--radius-/)
  const elevationSteps = tokenNames(rules, /^--shadow-/)

  if (elevationSteps.length > MAX_ELEVATION_STEPS) {
    findings.push({
      code: "elevation-ramp-too-deep",
      where: "--shadow-*",
      detail: `${elevationSteps.length} steps; depth used sparingly is at most ${MAX_ELEVATION_STEPS}`,
    })
  }

  // Every theme that redefines any elevation step must redefine all of them.
  for (const rule of rules) {
    const declared = Object.keys(rule.declarations).filter((n) => n.startsWith("--shadow-"))
    if (declared.length === 0 || declared.length === elevationSteps.length) continue
    const missing = elevationSteps.filter((s) => !declared.includes(s))
    findings.push({
      code: "elevation-ramp-incomplete-in-a-theme",
      where: rule.context.join(" "),
      detail: `re-art-directs ${declared.length} of ${elevationSteps.length} steps; ${missing.join(", ")} keep the other theme's value`,
    })
  }

  const registered = new Map(TRANSLUCENCY.map((t) => [t.selector, t]))
  const seenRegistered = new Set<string>()

  for (const rule of rules) {
    const selector = rule.context[rule.context.length - 1] ?? ""
    const inReducedBlock = rule.context.some(
      (c) => c.includes(REDUCED_TRANSPARENCY) || c.includes("forced-colors"),
    )
    const inKeyframes = rule.context.some((c) => c.startsWith("@keyframes "))

    for (const [property, value] of Object.entries(rule.declarations)) {
      if (property === "border-radius") {
        depthRules.push(`${selector} { border-radius }`)
        if (!/var\(\s*--radius-/.test(value) && !RADIUS_EXEMPT.test(value.trim())) {
          findings.push({
            code: "radius-literal",
            where: `${selector} { border-radius }`,
            detail: `"${value}" is off the scale; use var(--radius-sm|md|lg|xl|full)`,
          })
        }
      }

      if (property === "box-shadow" && !inKeyframes) {
        depthRules.push(`${selector} { box-shadow }`)
        if (!/var\(\s*--shadow-/.test(value) && !/^none( !important)?$/.test(value.trim())) {
          findings.push({
            code: "elevation-literal",
            where: `${selector} { box-shadow }`,
            detail: `"${value}" is a hand-built shadow; use var(--shadow-xs|sm|md|lg|focus)`,
          })
        }
      }

      const isBlur =
        /^(-webkit-)?backdrop-filter$/.test(property) ||
        (property === "filter" && /\bblur\(/.test(value))
      if (!isBlur) continue
      if (inReducedBlock || /^none( !important)?$/.test(value.trim())) continue

      depthRules.push(`${selector} { ${property} }`)
      const entry = registered.get(selector)
      if (!entry) {
        findings.push({
          code: "unregistered-translucency",
          where: `${selector} { ${property}: ${value} }`,
          detail:
            "glass or blur that is not in TRANSLUCENCY — state what is behind it, why contrast, focus and performance survive it, and what reduced transparency gives instead, or remove it",
        })
        continue
      }
      seenRegistered.add(selector)
      if (!value.includes(entry.declaration)) {
        findings.push({
          code: "register-disagrees-with-stylesheet",
          where: selector,
          detail: `register says ${entry.declaration}; stylesheet says "${value}"`,
        })
      }
    }
  }

  for (const entry of TRANSLUCENCY) {
    if (!seenRegistered.has(entry.selector)) {
      findings.push({
        code: "register-disagrees-with-stylesheet",
        where: entry.selector,
        detail: "registered as translucent, but no such rule blurs in the stylesheet",
      })
    }
  }

  // The reduced-transparency override.
  const reducedRules = rules.filter((r) =>
    r.context.some((c) => c.includes(REDUCED_TRANSPARENCY)),
  )
  if (reducedRules.length === 0) {
    findings.push({
      code: "reduced-transparency-incomplete",
      where: `@media (${REDUCED_TRANSPARENCY}: reduce)`,
      detail: "there is no reduced-transparency override at all",
    })
  } else {
    let neutralised = false
    let universal = false
    for (const rule of reducedRules) {
      const selector = rule.context[rule.context.length - 1] ?? ""
      if (/(^|,)\s*\*/.test(selector)) universal = true
      const value = rule.declarations["backdrop-filter"]
      if (value && /none/.test(value) && /!important/.test(value)) neutralised = true
    }
    if (!neutralised) {
      findings.push({
        code: "reduced-transparency-incomplete",
        where: `@media (${REDUCED_TRANSPARENCY}: reduce)`,
        detail: "backdrop-filter is not set to none !important, so the blur survives the preference",
      })
    }
    if (!universal) {
      findings.push({
        code: "reduced-transparency-incomplete",
        where: `@media (${REDUCED_TRANSPARENCY}: reduce)`,
        detail: "the override does not reach every element; it must be written against `*`",
      })
    }
  }

  return { radiusSteps, elevationSteps, depthRules, findings }
}

/** Audits the stylesheet the product actually ships. */
export function auditShippedDepth(): DepthAudit {
  return auditDepth(
    fs.readFileSync(path.join(__dirname, "..", "..", "app", "globals.css"), "utf8"),
  )
}
