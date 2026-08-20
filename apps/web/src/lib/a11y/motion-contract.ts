/**
 * GE-143-038 — the motion contract, audited against the stylesheet that ships.
 *
 * The requirement: "Implement restrained 120–220 ms standard motion,
 * continuity-preserving spatial transitions, complete reduced-motion
 * alternatives, and no continuous decorative background movement, forced sound,
 * or forced haptics."
 *
 * Five clauses. `design-contracts.test.ts` already covered a sixth of one of
 * them — three durations, strictly increasing, none above 400ms — and that is
 * genuinely all that was checked. What this adds, clause by clause:
 *
 *   * **120–220 ms.** The scale shipped 120 / 180 / **240**. The third is
 *     outside the band the requirement names, and the only assertion on it was
 *     `<= 400`, a bound chosen to exclude a hang rather than to implement a
 *     contract. It is 220 now, and `MOTION_BAND` is what says so.
 *   * **Continuity-preserving.** Two halves. A surface that ARRIVES must
 *     decelerate and one that LEAVES must accelerate — so a keyframe named
 *     `…-in` must be driven with `--ease-entry` and `…-out` with `--ease-exit`,
 *     never the other way round. And a panel that appears must TRAVEL: a
 *     keyframe that a reader is meant to follow from somewhere to somewhere
 *     must animate `transform`, not only `opacity`. A scrim may fade, because
 *     a scrim has no position to preserve.
 *   * **Complete reduced-motion alternatives.** The reduce block must neutralise
 *     all four of `animation-duration`, `animation-iteration-count`,
 *     `transition-duration` and `scroll-behavior`, on a universal selector,
 *     with `!important` — three of the four is a mode that still moves.
 *   * **No continuous decorative movement.** Any `infinite` animation must
 *     appear in `CONTINUOUS_MOTION` with a justification for why it is
 *     information rather than decoration, AND a written account of what it
 *     reads as once motion is reduced. An animation that carries meaning only
 *     while it moves has no reduced-motion alternative at all, and saying that
 *     out loud is the point of the register.
 *   * **No forced sound or haptics.** `scanForcedFeedback` walks the product's
 *     own modules for `navigator.vibrate`, `new Audio(...)` and autoplaying
 *     media. It finds nothing today. That is a real answer — "we looked and
 *     found nothing" — and it is different from not looking, which is why the
 *     detector is fed a positive fixture in the test rather than trusted
 *     because the repository is currently clean.
 *
 * The CSS reader is `rulesIn` from `./density-contract`. Not re-implemented
 * here: a second brace-walker that disagrees with the first about what the
 * stylesheet says is the defect this directory already paid for once.
 */
import fs from "node:fs"
import path from "node:path"

import { rulesIn, type CssRule } from "./density-contract"

/** The band the requirement names, in milliseconds, inclusive at both ends. */
export const MOTION_BAND = { minMs: 120, maxMs: 220 } as const

/**
 * Every continuous (`infinite`) animation the product is allowed to run.
 *
 * A registry rather than a prohibition because the honest answer is not "never
 * move continuously" — a live-data indicator that stops pulsing when the feed
 * dies is carrying information. It is a registry with a `whenMotionReduced`
 * field because that is the question a blanket ban never forces anyone to
 * answer: what does this tell the reader when it is not moving?
 */
export interface ContinuousMotion {
  /** The selector that runs it, exactly as written in the stylesheet. */
  readonly selector: string
  /** The `@keyframes` name it runs. */
  readonly keyframes: string
  /** The literal duration, which is off the standard scale by design. */
  readonly duration: string
  /** Why this is information and not decoration. */
  readonly justification: string
  /** What a reader who has reduced motion on sees instead. */
  readonly whenMotionReduced: string
}

export const CONTINUOUS_MOTION: readonly ContinuousMotion[] = [
  {
    selector: ".live-dot",
    keyframes: "tenure-pulse-soft",
    duration: "2s",
    justification:
      "the live-data indicator. Its motion IS the claim that the figure beside it is being refreshed; a static dot beside a stale number is the failure this exists to make visible. It is 2s — slower than any transition on the scale — precisely so it reads as a heartbeat in the corner of the eye rather than as something asking to be looked at.",
    whenMotionReduced:
      "the global reduce block collapses it to a single 0.01ms iteration, which settles at the 100% keyframe: opacity 1, a solid dot. The liveness claim is then carried by the label beside it rather than by movement, so nothing is conveyed by motion alone.",
  },
]

export interface MotionFinding {
  readonly code:
    | "duration-out-of-band"
    | "ungoverned-duration"
    | "ungoverned-easing"
    | "easing-reversed"
    | "spatial-transition-does-not-travel"
    | "unregistered-continuous-motion"
    | "register-disagrees-with-stylesheet"
    | "reduced-motion-incomplete"
  readonly where: string
  readonly detail: string
}

export interface MotionAudit {
  /** `--motion-*` token → milliseconds. */
  readonly scale: ReadonlyMap<string, number>
  /** Every rule that animates or transitions, by selector. */
  readonly animated: readonly string[]
  readonly findings: readonly MotionFinding[]
}

const DURATION_LITERAL = /(?<![\w-])(\d+(?:\.\d+)?)(ms|s)(?![\w-])/g
const MOTION_TOKEN = /var\(\s*(--motion-[\w-]+)\s*\)/g
const EASE_TOKEN = /var\(\s*(--ease-[\w-]+)\s*\)/g

function toMs(value: number, unit: string): number {
  return unit === "s" ? value * 1000 : value
}

/** The governed duration scale, read from `:root`. */
export function motionScale(rules: readonly CssRule[]): Map<string, number> {
  const scale = new Map<string, number>()
  for (const rule of rules) {
    for (const [name, value] of Object.entries(rule.declarations)) {
      if (!/^--motion-[\w-]+$/.test(name) || scale.has(name)) continue
      const m = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(value.trim())
      if (m) scale.set(name, toMs(Number.parseFloat(m[1]), m[2]))
    }
  }
  return scale
}

const REDUCE_CONTEXT = "prefers-reduced-motion"

/** The four properties a complete reduced-motion override has to neutralise. */
export const REDUCED_MOTION_PROPERTIES = [
  "animation-duration",
  "animation-iteration-count",
  "transition-duration",
  "scroll-behavior",
] as const

export function auditMotion(css: string): MotionAudit {
  const rules = rulesIn(css)
  const scale = motionScale(rules)
  const findings: MotionFinding[] = []
  const animated: string[] = []

  for (const [token, ms] of scale) {
    if (ms < MOTION_BAND.minMs || ms > MOTION_BAND.maxMs) {
      findings.push({
        code: "duration-out-of-band",
        where: token,
        detail: `${ms}ms is outside the governed ${MOTION_BAND.minMs}–${MOTION_BAND.maxMs}ms band`,
      })
    }
  }

  // Which keyframes travel, and which only fade.
  const keyframeProperties = new Map<string, Set<string>>()
  for (const rule of rules) {
    const frame = rule.context.find((c) => c.startsWith("@keyframes "))
    if (!frame) continue
    const name = frame.slice("@keyframes ".length).trim()
    const set = keyframeProperties.get(name) ?? new Set<string>()
    for (const property of Object.keys(rule.declarations)) set.add(property)
    keyframeProperties.set(name, set)
  }
  for (const [name, properties] of keyframeProperties) {
    // A scrim has no position to preserve, so `overlay-in` may fade. A panel,
    // a popover or anything the reader is meant to follow does.
    if (!/(panel|pop|rise|slide|draw)/.test(name)) continue
    const travels = [...properties].some((p) => /^(transform|translate|scale|rotate|stroke-dashoffset|inset|top|left|right|bottom)$/.test(p))
    if (!travels) {
      findings.push({
        code: "spatial-transition-does-not-travel",
        where: `@keyframes ${name}`,
        detail: `changes only ${[...properties].sort().join(", ")}; a surface the reader is meant to follow has to move, not blink`,
      })
    }
  }

  const registered = new Map(CONTINUOUS_MOTION.map((c) => [c.selector, c]))
  const seenRegistered = new Set<string>()

  for (const rule of rules) {
    const selector = rule.context[rule.context.length - 1] ?? ""
    const inReduceBlock = rule.context.some((c) => c.includes(REDUCE_CONTEXT))
    const inKeyframes = rule.context.some((c) => c.startsWith("@keyframes "))
    if (inKeyframes) continue

    for (const [property, value] of Object.entries(rule.declarations)) {
      if (!/^(animation|transition)(-|$)/.test(property)) continue
      animated.push(`${selector} { ${property} }`)

      if (inReduceBlock) continue

      const entry = registered.get(selector)
      const isContinuous = /\binfinite\b/.test(value)

      if (isContinuous) {
        if (!entry) {
          findings.push({
            code: "unregistered-continuous-motion",
            where: selector,
            detail:
              "an infinite animation that is not in CONTINUOUS_MOTION — say what it tells the reader and what it reads as with motion reduced, or stop it",
          })
        } else {
          seenRegistered.add(selector)
          const keyframes = /^\s*([\w-]+)/.exec(value)?.[1] ?? ""
          if (keyframes !== entry.keyframes || !value.includes(entry.duration)) {
            findings.push({
              code: "register-disagrees-with-stylesheet",
              where: selector,
              detail: `register says ${entry.keyframes} at ${entry.duration}; stylesheet says "${value}"`,
            })
          }
        }
        continue
      }

      // Every other duration and easing must come from the scale.
      const literals = [...value.matchAll(DURATION_LITERAL)]
      for (const literal of literals) {
        findings.push({
          code: "ungoverned-duration",
          where: `${selector} { ${property} }`,
          detail: `${literal[0]} is a hand-picked duration; use var(--motion-fast|base|slow)`,
        })
      }
      const eases = [...value.matchAll(EASE_TOKEN)].map((m) => m[1])
      const usesTiming = /cubic-bezier|\bease(-in|-out|-in-out)?\b|\blinear\b|\bsteps\(/.test(value)
      if (usesTiming && eases.length === 0) {
        findings.push({
          code: "ungoverned-easing",
          where: `${selector} { ${property} }`,
          detail: "a hand-written timing function; use var(--ease-entry) or var(--ease-exit)",
        })
      }

      // Arrivals decelerate, departures accelerate. Reversing them is the
      // thing that makes an interface feel wrong without looking wrong.
      if (property === "animation") {
        const keyframes = /^\s*([\w-]+)/.exec(value)?.[1] ?? ""
        const arriving = /-in$/.test(keyframes)
        const leaving = /-out$/.test(keyframes)
        const wanted = arriving ? "--ease-entry" : leaving ? "--ease-exit" : null
        if (wanted && eases.length > 0 && !eases.includes(wanted)) {
          findings.push({
            code: "easing-reversed",
            where: `${selector} { animation: ${keyframes} }`,
            detail: `${keyframes} ${arriving ? "arrives" : "leaves"}, so it needs ${wanted}, not ${eases.join(", ")}`,
          })
        }
      }

      // A motion declaration with neither a token nor a literal is inheriting
      // a duration from somewhere else, which is the same defect as a literal —
      // but reported only when there was no literal, or one bad declaration
      // would produce two findings and the count would stop meaning anything.
      if (
        /^(animation|transition)$/.test(property) &&
        literals.length === 0 &&
        [...value.matchAll(MOTION_TOKEN)].length === 0 &&
        !/\bnone\b/.test(value)
      ) {
        findings.push({
          code: "ungoverned-duration",
          where: `${selector} { ${property} }`,
          detail: `"${value}" names no duration from the scale`,
        })
      }
    }
  }

  for (const entry of CONTINUOUS_MOTION) {
    if (!seenRegistered.has(entry.selector)) {
      findings.push({
        code: "register-disagrees-with-stylesheet",
        where: entry.selector,
        detail: "registered as continuous motion, but no such rule animates in the stylesheet",
      })
    }
  }

  // The reduced-motion override, in full.
  const reduceRules = rules.filter((r) => r.context.some((c) => c.includes(REDUCE_CONTEXT)))
  const neutralised = new Map<string, string>()
  let universal = false
  for (const rule of reduceRules) {
    const selector = rule.context[rule.context.length - 1] ?? ""
    if (/(^|,)\s*\*/.test(selector)) universal = true
    for (const [property, value] of Object.entries(rule.declarations)) {
      neutralised.set(property, value)
    }
  }
  if (reduceRules.length === 0) {
    findings.push({
      code: "reduced-motion-incomplete",
      where: "@media (prefers-reduced-motion: reduce)",
      detail: "there is no reduced-motion override at all",
    })
  } else {
    if (!universal) {
      findings.push({
        code: "reduced-motion-incomplete",
        where: "@media (prefers-reduced-motion: reduce)",
        detail: "the override does not reach every element; it must be written against `*`",
      })
    }
    for (const property of REDUCED_MOTION_PROPERTIES) {
      const value = neutralised.get(property)
      if (value === undefined) {
        findings.push({
          code: "reduced-motion-incomplete",
          where: "@media (prefers-reduced-motion: reduce)",
          detail: `${property} is not neutralised; three of the four is a mode that still moves`,
        })
      } else if (!/!important/.test(value)) {
        findings.push({
          code: "reduced-motion-incomplete",
          where: `@media (prefers-reduced-motion: reduce) { ${property} }`,
          detail: "without !important a component's own declaration outranks it",
        })
      }
    }
  }

  return { scale, animated, findings }
}

/* ── forced sound and haptics ─────────────────────────────────────────────── */

export interface ForcedFeedbackFinding {
  readonly file: string
  readonly kind: "haptics" | "sound" | "autoplay"
  readonly evidence: string
}

const FORCED_FEEDBACK: { kind: ForcedFeedbackFinding["kind"]; pattern: RegExp }[] = [
  { kind: "haptics", pattern: /navigator\s*\.\s*vibrate\s*\(/ },
  { kind: "sound", pattern: /new\s+Audio\s*\(/ },
  { kind: "sound", pattern: /\bnew\s+AudioContext\s*\(/ },
  { kind: "autoplay", pattern: /\bautoPlay\b|<(audio|video)[^>]*\bautoplay\b/ },
]

/** Walks a directory of product modules for forced sound or haptics. */
export function scanForcedFeedback(root: string): ForcedFeedbackFinding[] {
  const out: ForcedFeedbackFinding[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry.name) || /\.(test|itest)\.tsx?$/.test(entry.name)) continue
      const source = fs
        .readFileSync(full, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
      for (const { kind, pattern } of FORCED_FEEDBACK) {
        const m = pattern.exec(source)
        if (m) {
          out.push({
            file: path.relative(root, full).split(path.sep).join("/"),
            kind,
            evidence: m[0],
          })
        }
      }
    }
  }
  walk(root)
  return out.sort((a, b) => a.file.localeCompare(b.file))
}

const WEB_SRC = path.join(__dirname, "..", "..")

/** Audits the stylesheet the product actually ships. */
export function auditShippedMotion(): MotionAudit {
  return auditMotion(fs.readFileSync(path.join(WEB_SRC, "app", "globals.css"), "utf8"))
}

/** Scans the product's own modules. */
export function scanShippedForcedFeedback(): ForcedFeedbackFinding[] {
  return scanForcedFeedback(WEB_SRC)
}
