/**
 * GE-143-007 — one coherent outline icon family, and what may not be one.
 *
 * The requirement has four clauses. Three of them are shapes in the source and
 * are checked here; the fourth is measured somewhere that already measures it,
 * and saying so is cheaper than owning a second copy of the same scan:
 *
 *   1. ONE FAMILY. `icons.tsx` aliases exactly one vendor family, and it is the
 *      only module allowed to import it. A component that reaches past the
 *      barrel gets a second family the day the barrel is re-pointed, which is
 *      the whole reason the barrel exists.
 *   2. OUTLINE. Phosphor draws six weights; `fill` and `duotone` are not
 *      outlines. A filled glyph beside stroked ones does not read as emphasis,
 *      it reads as a different icon set.
 *   3. NO HAND-DRAWN GLYPHS AND NO EMOJI IN OPERATIONAL CONTROLS. A `<path>`
 *      somebody wrote in a component is a one-icon family — `NavDrawerToggle`
 *      carried a hand-rolled hamburger and close glyph, stroked at 1.6 against
 *      the family's own weight — and an emoji is a third family drawn by the
 *      reader's operating system in a style nobody chose. Brand marks are
 *      exempt and registered by name: a wordmark is not an icon.
 *   4. SEMANTIC LABELS. "An icon-only control carries an accessible name" is
 *      measured by `tools/tes-ui-stack-inventory.mjs`'s
 *      `icon-only-control-without-a-name` signal, asserted at zero for both
 *      applications by `tests/architecture/tes-ui-stack-inventory.test.mjs`.
 *      One implementation, one ratchet; a second copy here would be a second
 *      answer to the same question the day one of them was edited.
 *
 * These scans run over the shipped tree from `icon-family.test.ts`, which is
 * what makes them a boundary rather than a description.
 */

/** The one module allowed to name the vendor, and the one vendor it may name. */
export const ICON_BARREL = "src/components/ui/icons.tsx"
export const ICON_VENDOR = "@phosphor-icons/react"

/** Phosphor's weights, split by whether they are strokes or fills. */
export const OUTLINE_WEIGHTS = ["thin", "light", "regular", "bold"] as const
export const FILLED_WEIGHTS = ["fill", "duotone"] as const

/**
 * Modules that may draw their own SVG, and why each is not an icon.
 *
 * A brand mark is a logotype: it is drawn once, it is not part of a vocabulary,
 * and no icon family contains it. A chart mark is data — a bar is not a glyph.
 * Both are exempt by NAME so the exemption cannot quietly widen, and the test
 * fails on an entry that has stopped drawing anything.
 */
export const OWN_SVG_ALLOWED: readonly { file: string; reason: string }[] = [
  {
    file: "src/components/brand/TenureLogo.tsx",
    reason: "the Tenure rosette — a brand mark, drawn once, in no icon vocabulary",
  },
  {
    file: "src/app/apple-icon.tsx",
    reason: "the home-screen icon route: an image the platform generates, not a glyph in the UI",
  },
]

/** A module under the chart kit, whose marks are data rather than icons. */
export function isChartMark(file: string): boolean {
  return /\/components\/charts\//.test(file)
}

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")

/* ─── 1. one family ────────────────────────────────────────────────────────── */

/** Vendor icon packages a module imports directly, bypassing the barrel. */
export function vendorIconImports(source: string): string[] {
  return [...stripComments(source).matchAll(/from\s+["']([^"']+)["']/g)]
    .map((m) => m[1])
    .filter((specifier) => /^(@phosphor-icons|lucide-react|react-icons|@heroicons|@tabler\/icons)/.test(specifier))
}

/** The vendor families the barrel itself pulls from. One is the passing answer. */
export function barrelFamilies(source: string): string[] {
  return [
    ...new Set(
      vendorIconImports(source).map((specifier) =>
        specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier,
      ),
    ),
  ].sort()
}

/* ─── 2. outline ───────────────────────────────────────────────────────────── */

export interface WeightUse {
  weight: string
  filled: boolean
}

/** Every `weight="…"` a module sets on an icon. */
export function iconWeights(source: string): WeightUse[] {
  return [...stripComments(source).matchAll(/weight=["'](\w+)["']/g)].map((m) => ({
    weight: m[1],
    filled: (FILLED_WEIGHTS as readonly string[]).includes(m[1]),
  }))
}

/* ─── 3. hand-drawn glyphs, and emoji in controls ──────────────────────────── */

/**
 * Whether a module draws its own SVG when it should be using the family.
 *
 * The `<svg` element itself, not `<path>`: a component can only get a path onto
 * the page inside one, and looking for the container is the check that cannot be
 * walked around by moving the path into a constant.
 */
export function drawsOwnGlyph(file: string, source: string): boolean {
  if (isChartMark(file)) return false
  if (OWN_SVG_ALLOWED.some((entry) => file.endsWith(entry.file))) return false
  return /<svg[\s>]/.test(stripComments(source))
}

/**
 * Emoji, as opposed to typography.
 *
 * `→`, `↔`, `×` and `•` are punctuation this product uses in prose and in
 * generated spreadsheets, and calling them icons would be a scan people turn
 * off. This is the pictographic range plus the enclosed-symbol ranges an
 * operating system draws in colour and in its own house style — which is the
 * requirement's actual concern: an icon nobody on the team chose.
 */
const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F0FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u

export interface EmojiUse {
  /** The control's tag. */
  element: string
  /** The emoji found. */
  emoji: string
  /** The control, trimmed, so it can be found in the file. */
  context: string
}

/**
 * Emoji inside an operational control, or inside the name of one.
 *
 * "Operational control" is read narrowly and deliberately: a button, a link, a
 * label, and any `aria-label` — the things a person operates the product with.
 * The requirement's own exemption is content: a message a member TYPED with an
 * emoji in it is content passing through, and this cannot see it because it
 * scans source rather than data.
 */
export function emojiInControls(source: string): EmojiUse[] {
  const code = stripComments(source)
  const found: EmojiUse[] = []

  for (const match of code.matchAll(/<(button|a|label)\b[^>]*>([\s\S]{0,400}?)<\/\1>/g)) {
    const emoji = EMOJI.exec(match[2])
    if (emoji) {
      found.push({
        element: match[1],
        emoji: emoji[0],
        context: match[0].replace(/\s+/g, " ").slice(0, 120),
      })
    }
  }
  for (const match of code.matchAll(/aria-label=["']([^"']*)["']/g)) {
    const emoji = EMOJI.exec(match[1])
    if (emoji) found.push({ element: "aria-label", emoji: emoji[0], context: match[0].slice(0, 120) })
  }

  return found
}
