/**
 * GE-143-012, the two shapes the first pass could not see.
 *
 * `brand-roles.ts` closed three ways a tenant colour can take over a protected
 * meaning: the injected `<style>` block, the stylesheet's own `var()` graph, and
 * a component painting `condition ? <accent> : <protected token>`. A review of
 * that work found two more, both live in the product, and both invisible to the
 * detector that existed:
 *
 *   1. FINANCIAL POLARITY WITHOUT A PROTECTED TOKEN ON THE OTHER SIDE.
 *      `LedgerDrawer.tsx` painted `e.amountCents < 0 ? "text-[--primary]" :
 *      "text-text-1"`. The sign of a ledger amount — money out against money in
 *      — drawn in the tenant's colour. `conditionalMeaningOffenders` cannot see
 *      it, because it only fires when a PROTECTED token is on the other branch
 *      and here the other branch is an ordinary text colour. The meaning is not
 *      in the token that lost; it is in the QUESTION being asked. So this scan
 *      reads the condition: when the predicate is about a sum of money, a
 *      status, a permission, data quality, a disabled state or a security
 *      state, a branch painted in the accent is the same defect regardless of
 *      what the other branch paints.
 *
 *   2. THE LINK COLOUR.
 *      `--text-link` was registered as the token carrying the link meaning, and
 *      a third of the product's links were painted `text-[--primary]` instead —
 *      `<Link className="text-[--primary] hover:underline">` on the dashboard,
 *      the approval, the calendar event, the message, the document summary, the
 *      member row, and `[&_a]:text-[--primary]` on every anchor inside a
 *      document body. A register that protects a token the product does not use
 *      protects nothing. Links are now `--text-link` and this scan keeps them
 *      there.
 *
 * Both scans are static analyses over the shipped tree; the caller that runs
 * them is `brand-meaning-scan.test.ts`, which walks `src/app` and `src/components`
 * on every CI run, the same way the chart-integrity and brand-roles scans do.
 */
import {
  BRAND_WRITABLE_PROPERTIES,
  brandTokenIn,
  conditionalsIn,
  isColourExpression,
  stripComments,
} from "./brand-roles"

// ─── 1. The meaning is in the question, not only in the other branch ─────────

/**
 * A protected meaning, and the vocabulary a CONDITION uses when it is testing it.
 *
 * Deliberately narrow. Each pattern names words a predicate about that meaning
 * actually uses in this codebase, and the money one additionally requires a
 * comparison — `amountCents < 0` is a polarity test, `amountCents` alone in a
 * condition (`amountCents ? … : …`, a presence check) is not. A vocabulary wide
 * enough to catch everything would flag `active ? accent : muted` in the side
 * nav, which is the accent doing its declared job.
 */
export interface ProtectedPredicate {
  meaning: string
  /** What the condition has to say for this scan to call it that meaning. */
  pattern: RegExp
  /** Why a tenant colour on either branch of THIS question is a defect. */
  why: string
}

export const PROTECTED_PREDICATES: readonly ProtectedPredicate[] = [
  {
    meaning: "financial polarity",
    pattern:
      /\b(amount\w*|balance\w*|variance\w*|delta\w*|netCents|totalCents|spendCents|debit\w*|credit\w*|surplus|deficit|profit)\b[^?]{0,40}(<|>|<=|>=)\s*-?\s*0\b|\bisNegative\b|\bsign\s*(===|<|>)/,
    why: "money in and money out must not be told apart by a colour the tenant chooses; an institution with a red accent ships a ledger where a spend and a deposit are the same red",
  },
  {
    meaning: "status",
    pattern: /\b(status|state|decision|outcome)\b\s*(===|!==|==)|\bis(Approved|Rejected|Pending|Draft)\b/,
    why: "pending / approved / rejected must read the same in every tenant, because a reviewer learns them once",
  },
  {
    meaning: "permission",
    pattern: /\b(can[A-Z]\w*|isAllowed|isDenied|denied|hasPermission|permitted|authorized)\b/,
    why: "'you may not' is a refusal, and a refusal drawn in the house colour looks like an ordinary panel",
  },
  {
    meaning: "data quality",
    pattern: /\b(isStale|stale|estimated|isEstimated|partial|isPartial|freshness|unavailable)\b/,
    why: "a reader who cannot see the mark on an estimate believes the number",
  },
  {
    meaning: "disabled",
    pattern: /\b(disabled|isDisabled|readOnly|isReadOnly)\b/,
    why: "a disabled control drawn in a live colour invites a click that does nothing",
  },
]

export interface PredicateOffence {
  /** The meaning the condition is testing. */
  meaning: string
  /** The condition, as written. */
  condition: string
  /** The brand-writable property one of the branches paints with. */
  brandToken: string
  /** The whole conditional, for an error a human can find in the file. */
  conditional: string
}

/**
 * Conditionals that test a protected meaning and answer it in the tenant accent.
 *
 * Complements `conditionalMeaningOffenders`, which asks the mirror question:
 * that one starts from the two COLOURS and requires a protected token opposite
 * the accent; this one starts from the QUESTION and requires nothing of the
 * other branch. `LedgerDrawer` was the case only the second one sees, and the
 * finance dashboard's variance column is the case both see — an overlap that is
 * fine, because the two scans are checked separately and neither is the other's
 * fallback.
 *
 * Both branches still have to be colour expressions: `canManage ? <Button/> :
 * null` is a permission deciding whether a control EXISTS, which is authorization
 * doing its job, not a colour carrying a meaning.
 */
export function predicateMeaningOffenders(source: string): PredicateOffence[] {
  const offences: PredicateOffence[] = []

  for (const { condition, consequent, alternative, text } of conditionalsIn(source)) {
    if (!isColourExpression(consequent) || !isColourExpression(alternative)) continue
    const brand = brandTokenIn(consequent) ?? brandTokenIn(alternative)
    if (!brand) continue
    // A conditional between two shades of the same accent is a hover state, not
    // a meaning: `--primary` against `--primary-light` says nothing about money.
    if (brandTokenIn(consequent) && brandTokenIn(alternative)) continue

    for (const predicate of PROTECTED_PREDICATES) {
      if (!predicate.pattern.test(condition)) continue
      offences.push({ meaning: predicate.meaning, condition, brandToken: brand, conditional: text })
      break
    }
  }

  return offences
}

// ─── 2. The link colour ──────────────────────────────────────────────────────

/** Utilities that paint text in a brand-writable property, at rest. */
const RESTING_BRAND_TEXT = new RegExp(
  `^text-\\[(${BRAND_WRITABLE_PROPERTIES.map((p) => p.replace(/-/g, "\\-")).join("|")})\\]$`,
)

/** The same utilities behind a state variant — `hover:`, `group-hover:`, `data-[…]:`. */
const VARIANT_BRAND_TEXT = new RegExp(
  `:text-\\[(${BRAND_WRITABLE_PROPERTIES.map((p) => p.replace(/-/g, "\\-")).join("|")})\\]$`,
)

/**
 * `[&_a]:text-[--primary]` — an accent applied to every anchor inside a subtree.
 *
 * A separate pattern because it does not appear on an `<a>` at all: it is a
 * descendant rule on a container, which is how a document body paints the links
 * inside authored content. `DocContentView` carried exactly this.
 */
const DESCENDANT_ANCHOR_BRAND_TEXT = new RegExp(
  `\\[&_a\\]:text-\\[(${BRAND_WRITABLE_PROPERTIES.map((p) => p.replace(/-/g, "\\-")).join("|")})\\]`,
)

export interface LinkOffence {
  /** `a`, `Link`, or `[&_a]` for a descendant-anchor rule. */
  element: string
  brandToken: string
  /** The class list as written, trimmed for an error a human can find. */
  classes: string
}

/**
 * Elements whose RESTING link colour comes from the tenant accent.
 *
 * What counts as a link, precisely, because the boundary is the whole argument:
 *
 *   · any element whose class list has an underline affordance — `underline`,
 *     `hover:underline` — and a resting brand text colour. The underline is what
 *     makes it link vocabulary rather than an icon or a chip, and the TAG is not
 *     the test: `members/page.tsx` painted a `button` element in exactly the link
 *     vocabulary, and a reader deciding whether that word is clickable is
 *     reading its colour and its underline, not its element name. An anchor
 *     styled as a button (`border`, a height, `no-underline` and nothing else)
 *     is a CONTROL, and the accent is a primary control's declared role;
 *     `DocumentViewerOverlay`'s download anchor is that shape and is not
 *     reported.
 *   · any descendant-anchor rule painting a brand token — `[&_a]:text-[--primary]`
 *     and its siblings across `BRAND_WRITABLE_PROPERTIES` — regardless of
 *     underline: every anchor inside authored content is a link by construction.
 *
 * What is deliberately NOT reported, and why it is a scope decision rather than
 * an oversight: a HOVER tint. `hover:text-[--primary]` on a row title whose
 * resting colour is `--text-1` does not tell the reader what the thing is; the
 * resting state does, and it is platform-owned. `linksWithoutPlatformRest`
 * asserts that separately, so the exclusion cannot quietly become a hole.
 */
export function linkMeaningOffenders(source: string): LinkOffence[] {
  const code = stripComments(source)
  const offences: LinkOffence[] = []

  for (const { element, classes } of jsxClassLists(code)) {
    const descendant = DESCENDANT_ANCHOR_BRAND_TEXT.exec(classes)
    if (descendant) {
      offences.push({ element: "[&_a]", brandToken: descendant[1], classes: trim(classes) })
      continue
    }
    const utilities = classes.split(/\s+/).filter(Boolean)
    if (!utilities.some(isUnderlineAffordance)) continue
    const resting = utilities.find((u) => RESTING_BRAND_TEXT.test(u))
    if (!resting) continue
    offences.push({
      element,
      brandToken: RESTING_BRAND_TEXT.exec(resting)![1],
      classes: trim(classes),
    })
  }

  return offences
}

/**
 * Anchors that take an accent on hover but no resting text colour at all.
 *
 * The complement of the exclusion above, and the reason it is safe: a link whose
 * resting colour is inherited and whose only colour is the hover accent IS
 * identified by the tenant's colour, at the one moment the reader is deciding
 * whether to click. `[]` is the passing answer, and the assertion is what stops
 * "hover is out of scope" from becoming a way to move a link back into the
 * accent one variant at a time.
 */
export function linksWithoutPlatformRest(source: string): LinkOffence[] {
  const code = stripComments(source)
  const offences: LinkOffence[] = []

  for (const { element, classes } of jsxClassLists(code)) {
    if (element !== "a" && element !== "Link") continue
    const utilities = classes.split(/\s+/).filter(Boolean)
    const variant = utilities.find((u) => VARIANT_BRAND_TEXT.test(u))
    if (!variant) continue
    // A resting text colour of any kind — a platform token, an inherited class,
    // anything that is not itself the accent.
    const rest = utilities.filter((u) => /^text-/.test(u) && !u.includes(":"))
    if (rest.length > 0 && !rest.some((u) => RESTING_BRAND_TEXT.test(u))) continue
    offences.push({
      element,
      brandToken: VARIANT_BRAND_TEXT.exec(variant)![1],
      classes: trim(classes),
    })
  }

  return offences
}

/** `underline` or `hover:underline`, but never `no-underline`. */
function isUnderlineAffordance(utility: string): boolean {
  const base = utility.split(":").pop() ?? ""
  return base === "underline"
}

function trim(classes: string): string {
  return classes.replace(/\s+/g, " ").trim().slice(0, 160)
}

/**
 * Every JSX element in a module paired with the class names it can carry.
 *
 * Not a JSX parser: it finds `<Tag`, walks to the end of the opening tag
 * tracking quotes and braces, and collects every string and template literal
 * inside a `className=` attribute — so a conditional class list contributes all
 * of its alternatives, which is the safe direction. An element whose classes are
 * assembled in a variable declared elsewhere is a false negative, and this is
 * where it is written down: `Button`'s variant table lives in `Button.tsx`, and
 * `--text-link` is what its `link` variant already uses.
 */
function jsxClassLists(code: string): { element: string; classes: string }[] {
  const found: { element: string; classes: string }[] = []
  const tag = /<([A-Za-z][\w.]*)\s/g
  let match: RegExpExecArray | null

  while ((match = tag.exec(code))) {
    const end = openingTagEnd(code, match.index + match[0].length)
    if (end === -1) continue
    // Cut at the first nested `<`: an element passed as a prop
    // (`<Attribute value={<Link className="…"/>} />`) is inside its parent's
    // opening tag, and reading the parent's attributes as far as `>` would
    // report the child's class list twice, once under the wrong element name.
    const whole = code.slice(match.index, end)
    const nested = whole.indexOf("<", 1)
    const attributes = nested === -1 ? whole : whole.slice(0, nested)
    const className = /className\s*=\s*/.exec(attributes)
    if (!className) continue
    const value = attributes.slice(className.index + className[0].length)
    const classes = stringLiteralsIn(value).join(" ")
    if (classes.trim() !== "") found.push({ element: match[1], classes })
  }

  return found
}

/** The index just past the `>` that closes an opening tag, or -1. */
function openingTagEnd(code: string, from: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = from; i < code.length; i++) {
    const ch = code[i]
    if (quote) {
      if (ch === "\\") i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch
    else if (ch === "{") depth++
    else if (ch === "}") depth--
    else if (ch === ">" && depth === 0) return i + 1
  }
  return -1
}

/**
 * Every string and template literal in an attribute value, in order.
 *
 * `${…}` interpolations are dropped rather than descended into: their contents
 * are code, and a class name inside one arrives here anyway through whichever
 * literal that code is built from when it is written inline.
 */
function stringLiteralsIn(value: string): string[] {
  const literals: string[] = []
  let current: { quote: string; text: string } | null = null
  let depth = 0

  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (current) {
      if (ch === "\\") {
        i++
        continue
      }
      if (ch === current.quote) {
        literals.push(current.text)
        current = null
        continue
      }
      if (current.quote === "`" && ch === "$" && value[i + 1] === "{") {
        // Skip the interpolation, brace-balanced, and keep reading the literal.
        let interpolation = 1
        i += 2
        for (; i < value.length && interpolation > 0; i++) {
          if (value[i] === "{") interpolation++
          else if (value[i] === "}") interpolation--
        }
        i--
        current.text += " "
        continue
      }
      current.text += ch
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") current = { quote: ch, text: "" }
    else if (ch === "{") depth++
    else if (ch === "}") {
      if (depth === 0) break
      depth--
    } else if (ch === ">" && depth === 0) break
  }

  return literals
}
