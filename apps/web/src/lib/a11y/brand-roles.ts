/**
 * GE-143-012 — the ROLE boundary on tenant branding.
 *
 * The requirement: "Restrict tenant branding to validated identity/accent roles.
 * Prevent tenant colors from changing focus, status, destructive, financial
 * polarity, permission, data quality, link, disabled, or security meanings;
 * automatically adjust or reject invalid accents with an explanation."
 *
 * What existed measured the accent's CONTRAST (`tenant-brand.ts`, TTES-010-004)
 * and validated its SYNTAX (`packages/platform-config/src/branding.ts`). Neither
 * is a boundary on WHAT a tenant colour is allowed to MEAN. Three things were
 * therefore unenforced, and one of them was live:
 *
 *   1. Nothing constrained which custom properties the injected `<style>` block
 *      may declare. `brandingCss` writes five, all in the accent family — but it
 *      is an ordinary function, and the day it grows a `--error` line the tenant
 *      owns the destructive colour with no test failing. `guardBrandingCss` is
 *      that constraint, applied at the one point tenant colours enter a page.
 *   2. Nothing asserted that a protected token does not DERIVE from the accent.
 *      `--error: color-mix(in srgb, var(--primary) …)` would hand a tenant the
 *      destructive palette without ever naming `--error` in the injected block.
 *      `brandDerivedTokens` closes the `var()` graph and the test runs it over
 *      the real stylesheet, in all four themes.
 *   3. Nothing stopped a COMPONENT from encoding a protected meaning in the
 *      brand token, which is how the boundary was actually being crossed:
 *
 *        FinanceDashboard.tsx:271  variance < 0 ? "text-[--error]" : "text-[--primary]"
 *        FinanceDashboard.tsx:439  tone === "good" ? "text-[--primary]" : … "text-[--error]"
 *        LiveStats.tsx:73          tone === "warn" && value > 0 ? "var(--warning)" : "var(--primary)"
 *
 *      Financial polarity in the first two: an institution whose accent is a
 *      maroon or a crimson — Harvard, Stanford, Texas A&M, and a long tail of
 *      others — shipped a budget table where money UNDER budget and money OVER
 *      budget were both red. Not a contrast failure; a sign error the contrast
 *      gate cannot see, because both colours pass it. `conditionalMeaningOffenders`
 *      finds that shape, the three call sites were changed to semantic tokens,
 *      and the scan runs over every product module so the fourth cannot land.
 *
 * No colour arithmetic here: contrast is `contrast.ts`, the accent's measured
 * floors are `tenant-brand.ts`, and this module is only about which properties
 * carry which meanings and who is allowed to write them.
 */
import { BRANDING_DEFINITIONS } from "@tenure/platform-config"

import type { ThemeBlocks } from "./theme-tokens"

/**
 * The custom properties tenant branding may declare.
 *
 * Exactly the accent family `brandingCss` emits. `brand-roles.test.ts` runs the
 * real `brandingCss` over a fully-overridden branding record and asserts the set
 * it writes equals this one, so the allowlist cannot drift in either direction —
 * a property added to the emitter without being added here is refused at the
 * page and reported, and one removed from the emitter fails the test rather than
 * sitting here as permission nobody uses.
 */
export const BRAND_WRITABLE_PROPERTIES: readonly string[] = [
  "--primary",
  "--primary-hover",
  "--primary-press",
  "--primary-light",
  "--primary-text",
]

/** The roles a branding key is allowed to occupy. Anything else is not branding. */
export type BrandRole = "identity" | "accent" | "ambience"

/**
 * Every branding configuration key, classified.
 *
 * The test asserts this covers `BRANDING_DEFINITIONS` exactly. That is the point:
 * a new `platform.branding.*` key cannot be added without a human deciding which
 * role it occupies, which is the "validated identity/accent roles" half of the
 * requirement. `ambience` is light/dark — a comfort default, not a colour.
 */
export const BRAND_ROLES: readonly { key: string; role: BrandRole; writes: readonly string[] }[] = [
  {
    key: "platform.branding.primaryColor",
    role: "accent",
    writes: ["--primary", "--primary-hover", "--primary-press", "--primary-light"],
  },
  { key: "platform.branding.primaryTextColor", role: "accent", writes: ["--primary-text"] },
  { key: "platform.branding.wordmark", role: "identity", writes: [] },
  { key: "platform.branding.colorScheme", role: "ambience", writes: [] },
]

/**
 * A meaning a tenant colour must not be able to change, and the tokens that
 * carry it in this product.
 *
 * Every token named here is asserted to exist in all four themes by the test, so
 * the register cannot protect a property the stylesheet does not declare. Where
 * two meanings ride the same token that is recorded rather than hidden: the
 * product has one red, and it means "destructive", "this failed", "you may not"
 * and "money the wrong way" in four different places. The register's job is to
 * say which properties are off limits, not to pretend the vocabulary is larger
 * than it is.
 */
export interface ProtectedMeaning {
  /** The meaning, in the requirement's own word. */
  meaning: string
  /** Why a tenant accent moving it is a defect and not a preference. */
  why: string
  /** The tokens that carry it. */
  tokens: readonly string[]
}

export const PROTECTED_MEANINGS: readonly ProtectedMeaning[] = [
  {
    meaning: "focus",
    why: "the only indicator a keyboard user has of where they are; a tenant that could tint it could erase it",
    tokens: ["--border-focus", "--shadow-focus"],
  },
  {
    meaning: "status",
    why: "pending / approved / rejected / draft must read the same in every tenant, because a reviewer learns them once",
    tokens: [
      "--info",
      "--info-text",
      "--info-light",
      "--warning",
      "--warning-text",
      "--warning-light",
      "--success",
      "--success-text",
      "--success-light",
      "--badge-pending-bg",
      "--badge-pending-text",
      "--badge-approved-bg",
      "--badge-approved-text",
      "--badge-rejected-bg",
      "--badge-rejected-text",
      "--badge-draft-bg",
      "--badge-draft-text",
    ],
  },
  {
    meaning: "destructive",
    why: "the colour that says a control deletes something is a safety signal, not a decoration",
    tokens: ["--error", "--error-text", "--error-light"],
  },
  {
    meaning: "financial polarity",
    why: "over budget and under budget must not be the same colour; a brand-coloured positive makes them so whenever the brand is red",
    // The same red as destructive, and the same green as status-success. Stated
    // rather than duplicated under a new name: inventing --money-positive here
    // would be a token no component renders.
    tokens: ["--success-text", "--error", "--error-text"],
  },
  {
    meaning: "permission",
    why: "'you may not see this' is drawn in the danger family; a tenant able to move it could make a refusal look like an ordinary panel",
    tokens: ["--error", "--error-text"],
  },
  {
    meaning: "data quality",
    why: "stale, partial and estimated data are marked in the caution family; a reader who cannot see the mark believes the number",
    tokens: ["--warning", "--warning-text", "--warning-light"],
  },
  { meaning: "link", why: "a link that does not look like a link is not a link", tokens: ["--text-link"] },
  {
    meaning: "disabled",
    why: "a disabled control drawn in a live colour invites a click that does nothing",
    tokens: ["--text-disabled"],
  },
  {
    meaning: "security",
    why: "security-consequential surfaces borrow the destructive family; no separate token exists today and this register says so rather than naming one that does not",
    tokens: ["--error", "--error-text"],
  },
]

/** Every token any protected meaning names, deduplicated. */
export const PROTECTED_TOKENS: readonly string[] = [
  ...new Set(PROTECTED_MEANINGS.flatMap((m) => m.tokens)),
].sort()

/** The meanings a token carries, for an explanation a human can act on. */
export function meaningsOf(token: string): string[] {
  return PROTECTED_MEANINGS.filter((m) => m.tokens.includes(token)).map((m) => m.meaning)
}

// ─── 1. The guard at the injection point ─────────────────────────────────────

export interface RoleRejection {
  /** The custom property that was refused. */
  property: string
  /** The value it tried to set, verbatim. */
  refused: string
  /** Why, in a sentence a configuration administrator can act on. */
  explanation: string
}

export interface GuardedBrandingCss {
  /** The `<style>` body that is safe to ship. "" when nothing survives. */
  css: string
  rejections: RoleRejection[]
}

/**
 * Enforces the property allowlist on a branding `<style>` body.
 *
 * Takes the string `brandingCss` produced rather than the branding record: the
 * string is what reaches the document, and a guard that reads the input instead
 * of the output is a guard the emitter can walk around. Anything outside
 * `BRAND_WRITABLE_PROPERTIES` is dropped and explained — dropped rather than
 * rewritten, because a declaration this refuses is a bug in the emitter, and
 * silently repairing one is how it survives.
 *
 * Deliberately not a CSS parser. The input is a `:root{…}` block of
 * `--name: value;` declarations built by one known function; anything that does
 * not have that shape is refused whole, which is the safe direction for a string
 * about to be interpolated into a `<style>` tag.
 */
export function guardBrandingCss(css: string): GuardedBrandingCss {
  if (css.trim() === "") return { css: "", rejections: [] }

  const block = /^\s*:root\s*\{([^{}]*)\}\s*$/.exec(css)
  if (!block) {
    return {
      css: "",
      rejections: [
        {
          property: "(whole block)",
          refused: css,
          explanation:
            "Tenant branding must be a single `:root{ --property: value; }` block of custom-property declarations. " +
            "This was not, so none of it was applied.",
        },
      ],
    }
  }

  const kept: string[] = []
  const rejections: RoleRejection[] = []

  for (const raw of block[1].split(";")) {
    const declaration = raw.trim()
    if (declaration === "") continue

    const parsed = /^(--[\w-]+)\s*:\s*(.+)$/.exec(declaration)
    if (!parsed) {
      rejections.push({
        property: "(unparsable declaration)",
        refused: declaration,
        explanation:
          "Only `--property: value` declarations are applied. This one was not one, so it was dropped.",
      })
      continue
    }

    const [, property, value] = parsed
    if (BRAND_WRITABLE_PROPERTIES.includes(property)) {
      kept.push(`${property}: ${value};`)
      continue
    }

    const meanings = meaningsOf(property)
    rejections.push({
      property,
      refused: value,
      explanation: meanings.length
        ? `\`${property}\` carries the ${meanings.join(" / ")} meaning, which is the platform's and not a tenant's. ` +
          `Branding may set ${BRAND_WRITABLE_PROPERTIES.join(", ")} and nothing else.`
        : `\`${property}\` is not one of the properties tenant branding may set ` +
          `(${BRAND_WRITABLE_PROPERTIES.join(", ")}), so it was dropped.`,
    })
  }

  return { css: kept.length ? `:root{${kept.join("")}}` : "", rejections }
}

// ─── 2. The stylesheet's own var() graph ─────────────────────────────────────

/** Every `var(--x)` a declaration value references — including inside color-mix(). */
export function varReferences(value: string): string[] {
  return [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1])
}

/**
 * Every token whose value depends, transitively, on a brand-writable property.
 *
 * The closure over one theme's declaration map. A token is brand-derived when
 * its value names a writable property, or names a token that does — which is the
 * indirection an audit of the injected block alone cannot see.
 *
 * Returned sorted, and excluding the writable properties themselves: they are
 * the source of the influence, not victims of it.
 */
export function brandDerivedTokens(declarations: Readonly<Record<string, string>>): string[] {
  const tainted = new Set<string>(BRAND_WRITABLE_PROPERTIES)
  // Fixed point: a chain --a: var(--b); --b: var(--primary) needs two passes,
  // and the declaration order in a stylesheet guarantees nothing about which.
  for (let pass = 0; pass < Object.keys(declarations).length + 1; pass++) {
    let grew = false
    for (const [name, value] of Object.entries(declarations)) {
      if (tainted.has(name)) continue
      if (varReferences(value).some((ref) => tainted.has(ref))) {
        tainted.add(name)
        grew = true
      }
    }
    if (!grew) break
  }
  for (const writable of BRAND_WRITABLE_PROPERTIES) tainted.delete(writable)
  return [...tainted].sort()
}

export interface MeaningCapture {
  meaning: string
  token: string
}

/**
 * Protected meanings a tenant accent can reach through the stylesheet.
 *
 * `[]` is the passing answer. Runs over the four theme blocks unmerged, because
 * a capture that exists only in the high-contrast override is still a capture —
 * and the high-contrast themes are where a reader who most needs the status
 * colours to hold is reading.
 */
export function capturedMeanings(blocks: ThemeBlocks): MeaningCapture[] {
  const found: MeaningCapture[] = []
  const seen = new Set<string>()
  for (const declarations of [blocks.root, blocks.dark, blocks.rootContrast, blocks.darkContrast]) {
    // A block declares only its own overrides, so resolve it against the base
    // `:root` it cascades on top of; a `--error: var(--brand-ish)` in the dark
    // block whose right-hand side is declared in `:root` is still a capture.
    const merged = { ...blocks.root, ...declarations }
    for (const token of brandDerivedTokens(merged)) {
      for (const meaning of meaningsOf(token)) {
        const key = `${meaning}:${token}`
        if (seen.has(key)) continue
        seen.add(key)
        found.push({ meaning, token })
      }
    }
  }
  return found
}

// ─── 3. The shape the boundary was actually crossed in ───────────────────────

export interface ConditionalOffence {
  /** The conditional, trimmed, as it appears in the source. */
  conditional: string
  /** The brand-writable property one branch paints with. */
  brandToken: string
  /** The protected token the other branch paints with. */
  protectedToken: string
  /** The meanings that token carries. */
  meanings: string[]
}

const BRAND_TOKEN_PATTERN = new RegExp(
  `(?<![\\w-])(${BRAND_WRITABLE_PROPERTIES.map((p) => p.replace(/-/g, "\\-")).join("|")})(?![\\w-])`,
)

function firstMatch(source: string, tokens: readonly string[]): string | null {
  for (const token of tokens) {
    if (new RegExp(`(?<![\\w-])${token.replace(/-/g, "\\-")}(?![\\w-])`).test(source)) return token
  }
  return null
}

/**
 * Finds `condition ? <brand colour> : <protected colour>` in a module's source.
 *
 * This is the live defect's shape, and it is worth naming precisely: the two
 * colours are ALTERNATIVES, so the reader is being asked to tell them apart, and
 * one of them is a value the tenant chooses. `--primary` beside `--border-focus`
 * in one unconditional class list is not this — a hover accent and a focus ring
 * are both true at once and neither encodes the other's state — so a conditional
 * is required rather than mere proximity.
 *
 * Branch extraction walks the source tracking bracket depth and quoting, so a
 * ternary whose branches contain `:` inside a Tailwind class (`hover:text-…`),
 * a nested call or a template literal is split at the right colon. What it does
 * NOT do is parse TypeScript: a conditional assembled across two variables, or a
 * `switch` returning colours, is invisible to it. That is a false negative and
 * it is written down here rather than implied — the scan is a ratchet on the one
 * shape three call sites had, not a proof about all of them.
 */
export function conditionalMeaningOffenders(source: string): ConditionalOffence[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
  const offences: ConditionalOffence[] = []

  for (const i of conditionalPositions(code)) {
    const branches = splitConditional(code, i)
    if (!branches) continue

    const { consequent, alternative, end } = branches
    // Both branches have to be a COLOUR CHOICE for this to be the defect. Two
    // JSX subtrees that happen to contain an accent in one and a status colour
    // in the other are two different pieces of UI, not two paints on one thing;
    // `settings/page.tsx` is that shape and reporting it would have had somebody
    // "fix" correct code.
    if (!isColourExpression(consequent) || !isColourExpression(alternative)) continue

    const pairs: [string, string][] = [
      [consequent, alternative],
      [alternative, consequent],
    ]
    for (const [brandSide, protectedSide] of pairs) {
      const brand = BRAND_TOKEN_PATTERN.exec(brandSide)?.[1]
      if (!brand) continue
      const captured = firstMatch(protectedSide, PROTECTED_TOKENS)
      if (!captured) continue
      offences.push({
        conditional: code.slice(i, end).replace(/\s+/g, " ").trim().slice(0, 160),
        brandToken: brand,
        protectedToken: captured,
        meanings: meaningsOf(captured),
      })
      break
    }
  }

  return offences
}

/**
 * Whether a branch is a colour choice rather than a piece of UI.
 *
 * A class string, a `var(--x)`, a short expression built from them. Not a JSX
 * subtree: `cond ? <PanelInTheAccent/> : <PanelWithAnError/>` is two components,
 * and the tokens inside them are not alternatives painted on one element.
 */
function isColourExpression(branch: string): boolean {
  return branch.length <= 300 && !/<[A-Za-z]/.test(branch)
}

/**
 * Every `?` that actually opens a conditional expression.
 *
 * A `?` inside a string is not one, and this had to be taught: the first run of
 * the product-tree scan reported `src/app/(app)/messages/[id]/page.tsx` and
 * `NotificationBell.tsx`, both on the `?` in a query string
 * (`fetch("/api/notifications?limit=100")`). Scanning from there ran the split
 * across unrelated code until it found a token on each side, which is a false
 * positive that would have been "fixed" by editing correct code.
 *
 * So string, template and interpolation state is tracked: a template literal is
 * opaque until its closing backtick EXCEPT inside `${ … }`, which is code again —
 * and every ternary this scan exists to find lives inside one, in a `className`.
 * Not tracked: regular-expression literals, because telling `/` division from a
 * regex needs the preceding token's grammar. A `?` inside a regex would be a
 * false positive; there is none in the tree today and the scan reports its
 * findings with the source text, so one would be visible rather than silent.
 */
function conditionalPositions(code: string): number[] {
  const positions: number[] = []
  const stack: { kind: "single" | "double" | "template" | "interpolation"; braces: number }[] = []

  for (let i = 0; i < code.length; i++) {
    const ch = code[i]
    const top = stack[stack.length - 1]

    if (top?.kind === "single" || top?.kind === "double") {
      if (ch === "\\") i++
      else if (ch === (top.kind === "single" ? "'" : '"')) stack.pop()
      continue
    }

    if (top?.kind === "template") {
      if (ch === "\\") i++
      else if (ch === "`") stack.pop()
      else if (ch === "$" && code[i + 1] === "{") {
        stack.push({ kind: "interpolation", braces: 0 })
        i++
      }
      continue
    }

    if (ch === "'") stack.push({ kind: "single", braces: 0 })
    else if (ch === '"') stack.push({ kind: "double", braces: 0 })
    else if (ch === "`") stack.push({ kind: "template", braces: 0 })
    else if (top?.kind === "interpolation" && ch === "{") top.braces++
    else if (top?.kind === "interpolation" && ch === "}") {
      if (top.braces === 0) stack.pop()
      else top.braces--
    } else if (ch === "?" && code[i + 1] !== "?" && code[i + 1] !== "." && code[i - 1] !== "?") {
      positions.push(i)
    }
  }

  return positions
}

/** The `?`-to-`:` and `:`-to-end spans of the conditional starting at `start`. */
function splitConditional(
  code: string,
  start: number,
): { consequent: string; alternative: string; end: number } | null {
  let depth = 0
  let quote: string | null = null
  let colon = -1

  for (let i = start + 1; i < code.length; i++) {
    const ch = code[i]

    if (quote) {
      if (ch === "\\") i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch
      continue
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return colon === -1 ? null : finish(code, start, colon, i)
      depth--
    } else if (ch === "?" && depth === 0 && code[i + 1] !== "?" && code[i + 1] !== ".") {
      // A CHAINED conditional — `a ? x : b ? y : z`. The outer alternative is the
      // whole tail, chain included, so scanning continues rather than stopping at
      // this `?`: `tone === "good" ? brand : tone === "bad" ? protected : neutral`
      // is exactly the shape FinanceDashboard's SummaryCard had, and stopping
      // here missed it. A `?` reached before the first top-level `:` is a nesting
      // this cannot pair up, and it gives up rather than guessing.
      if (colon === -1) return null
    } else if (ch === ":" && depth === 0 && colon === -1) {
      colon = i
    } else if ((ch === ";" || ch === ",") && depth === 0) {
      return colon === -1 ? null : finish(code, start, colon, i)
    }
  }
  return colon === -1 ? null : finish(code, start, colon, code.length)
}

function finish(code: string, start: number, colon: number, end: number) {
  return {
    consequent: code.slice(start + 1, colon),
    alternative: code.slice(colon + 1, end),
    end,
  }
}

/**
 * Conditionals that pair the accent with a protected token LEGITIMATELY.
 *
 * The accent's own declared role is "active navigation, primary buttons", so a
 * primary button beside a destructive button is the pattern, not the defect —
 * the two are CONTROLS carrying their own labels, and the reader is choosing an
 * action rather than reading a value. The three call sites GE-143-012 changed
 * were the other thing: a NUMBER and a live COUNT whose only difference was the
 * colour, one of which the tenant sets.
 *
 * The exception process, following GE-143-004's: written down, reasoned, and
 * checked in both directions — the test fails if an exception stops matching
 * anything, so one cannot outlive the code it was granted for.
 *
 * Residual risk, recorded rather than argued away: an institution whose accent
 * is a red ships an Approve button that looks like the Reject button beside it.
 * The labels differ, both are explicit buttons, and confirmation stands between
 * either one and its effect. Making Approve green instead would move a
 * consequential control out of the primary-action vocabulary the rest of the
 * product uses, which is a larger change than this item is entitled to make.
 */
export const MEANING_CONDITIONAL_EXCEPTIONS: readonly { file: string; reason: string }[] = [
  {
    file: "src/app/(app)/approvals/[id]/page.tsx",
    reason:
      "Primary-action button vs destructive-action button. Both are controls with their own labels, " +
      "the accent is in its declared primary-button role, and the destructive red stays the platform's.",
  },
]

/** The branding keys the platform defines, for the coverage assertion in the test. */
export function definedBrandingKeys(): string[] {
  return BRANDING_DEFINITIONS.map((d) => d.key).sort()
}
