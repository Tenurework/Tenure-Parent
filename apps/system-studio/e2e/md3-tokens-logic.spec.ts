import { test, expect } from "@playwright/test"
import fs from "fs"
import path from "path"

/*
 * The stylesheet reader is `apps/web/src/lib/a11y/css-declarations.mjs` and the
 * WCAG arithmetic is `apps/web/src/lib/a11y/contrast.ts`. Both are imported
 * rather than reimplemented, and that is a deliberate crossing of the app
 * boundary in a test file.
 *
 * The alternative is a second parser and a second luminance function, which is
 * the failure `css-declarations.mjs` was extracted to prevent: two readers of
 * one stylesheet that disagree about what it says, each passing its own tests.
 * `tools/entry-point-inventory.mjs` already imports the parser across the same
 * boundary for the same reason. Neither module touches a database, a client or
 * a tenant — the parser reads text and the arithmetic multiplies numbers — so
 * the separation `tests/security/operator-plane-content.test.mjs` enforces (the
 * console has no tenant-database client) is untouched.
 */
import { blockAt, paletteOf, resolveToken } from "../../web/src/lib/a11y/css-declarations.mjs"
import {
  AA_THRESHOLD,
  composite,
  contrastRatio,
  parseColor,
  relativeLuminance,
} from "../../web/src/lib/a11y/contrast"

/**
 * STUDIO — the Material 3 foundation, measured rather than described.
 *
 * `preferences.spec.ts` measures contrast on the RENDERED page, which is the
 * only way to catch a rule that overrides a correct token with a literal. It
 * cannot catch the other half: a token pair that is wrong but not yet rendered.
 * `--md-sys-color-on-tertiary-container` lands on no page in this console today
 * and will land on one the week somebody builds an environment chip, and by then
 * the palette that shipped with it is months old and nobody re-derives it.
 *
 * So this file audits the SYSTEM, not the page:
 *
 *   * every pair the design system declares, in all four theme/contrast
 *     combinations, against the WCAG 2.2 AA threshold for what that pair is
 *     actually used for;
 *   * every pair again with the state layer composited on top, because a hover
 *     tint moves the background under the text and 4.5:1 at rest can be 4.2:1
 *     under the cursor;
 *   * that no component in `components/md3/` contains a colour, which is what
 *     makes the audit above complete rather than merely large.
 *
 * It needs no browser and no server, like `preferences-logic.spec.ts` beside it.
 */

const STUDIO = path.join(__dirname, "..")
const GLOBALS = path.join(STUDIO, "src", "app", "globals.css")
const MD3_DIR = path.join(STUDIO, "src", "components", "md3")

const css = fs.readFileSync(GLOBALS, "utf8")

/**
 * Every stylesheet in the console, for the "is this token used" question only.
 *
 * `css` above is `globals.css` alone, and it stays that way: the token SYSTEM is
 * declared there and the assertions about the four themes must not start reading
 * a module's local variables as palette entries.
 *
 * But consumption happens everywhere. Reading only `globals.css` meant a token
 * declared there and used by a module stylesheet looked dead — which is exactly
 * what happened to `--console-nav-offset`, declared for `nav.module.css` and
 * consumed on its line 119, reported as referenced by nothing.
 */
const allStylesheets = (function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith(".css")) out.push(fs.readFileSync(full, "utf8"))
  }
  return out
})(path.join(STUDIO, "src")).join("\n")

/* ── The four themes, assembled the way the cascade assembles them ────────── */

type Tokens = Record<string, string>

/** Every unconditional `:root` block, merged in document order. */
const light: Tokens = paletteOf(css)
const darkBlock: Tokens = blockAt(css, /(^|\n)\s*:root\[data-theme="dark"\]\s*\{/)
const contrastBlock: Tokens = blockAt(css, /(^|\n)\s*:root\[data-contrast="more"\]\s*\{/)
const darkContrastBlock: Tokens = blockAt(
  css,
  /(^|\n)\s*:root\[data-theme="dark"\]\[data-contrast="more"\]\s*\{/,
)

const THEMES = {
  light,
  dark: { ...light, ...darkBlock },
  "light-contrast": { ...light, ...contrastBlock },
  // Both attribute blocks apply, and the two-attribute selector has the higher
  // specificity — which is the order a browser resolves them in, and the order
  // that matters: `:root[data-contrast="more"]` sets a LIGHT-theme outline that
  // would be invisible on a dark surface if it were allowed to win.
  "dark-contrast": { ...light, ...darkBlock, ...contrastBlock, ...darkContrastBlock },
} satisfies Record<string, Tokens>

type ThemeName = keyof typeof THEMES

const THEME_NAMES = Object.keys(THEMES) as ThemeName[]

/** A token's resolved value in one theme, following `var()` indirection. */
const value = (theme: ThemeName, token: string) => resolveToken(THEMES[theme], token)

/* ── The role set ─────────────────────────────────────────────────────────── */

/**
 * Material's colour roles, and the two families this console adds.
 *
 * Listed rather than derived: a list derived from the stylesheet would pass
 * whatever the stylesheet happened to contain, which is not a completeness
 * check, it is a mirror.
 */
const REQUIRED_COLOUR_ROLES = [
  "primary",
  "on-primary",
  "primary-container",
  "on-primary-container",
  "secondary",
  "on-secondary",
  "secondary-container",
  "on-secondary-container",
  "tertiary",
  "on-tertiary",
  "tertiary-container",
  "on-tertiary-container",
  "error",
  "on-error",
  "error-container",
  "on-error-container",
  // Not Material roles. This console reports status, and status has three more
  // shapes than "something went wrong".
  "warning",
  "on-warning",
  "warning-container",
  "on-warning-container",
  "success",
  "on-success",
  "success-container",
  "on-success-container",
  "background",
  "on-background",
  "surface",
  "surface-dim",
  "surface-bright",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
  "surface-variant",
  "on-surface",
  "on-surface-variant",
  "outline",
  "outline-variant",
  "inverse-surface",
  "inverse-on-surface",
  "inverse-primary",
  "scrim",
].map((role) => `--md-sys-color-${role}`)

/** The type scale: five roles, three sizes, four parts each. */
const TYPE_ROLES = [
  "display-large",
  "display-medium",
  "display-small",
  "headline-large",
  "headline-medium",
  "headline-small",
  "title-large",
  "title-medium",
  "title-small",
  "body-large",
  "body-medium",
  "body-small",
  "label-large",
  "label-medium",
  "label-small",
]
const TYPE_PARTS = ["size", "line-height", "weight", "tracking"]

const SHAPE_STEPS = [
  "none",
  "extra-small",
  "small",
  "medium",
  "large",
  "extra-large",
  "full",
].map((step) => `--md-sys-shape-corner-${step}`)

const ELEVATION_LEVELS = [0, 1, 2, 3, 4, 5].map((n) => `--md-sys-elevation-${n}`)

const STATE_OPACITIES = [
  "--md-sys-state-hover-opacity",
  "--md-sys-state-focus-opacity",
  "--md-sys-state-pressed-opacity",
]

const MOTION_TOKENS = [
  "--md-sys-motion-duration-short",
  "--md-sys-motion-duration-medium",
  "--md-sys-motion-easing-standard",
  "--md-sys-motion-easing-decelerate",
  "--md-sys-motion-easing-accelerate",
]

test.describe("the token set is complete", () => {
  test("every colour role is declared, in light and again in dark", () => {
    const missingLight = REQUIRED_COLOUR_ROLES.filter((role) => !(role in light))
    expect(missingLight, "roles absent from the light palette").toEqual([])

    /*
     * The dark block must RESTATE every role, not inherit it. A role the dark
     * theme does not override keeps its light value, and the ones that go
     * unnoticed are precisely the ones nothing renders yet: a light
     * `on-tertiary-container` inherited into dark is 1.2:1 and nothing says so
     * until the chip that uses it ships.
     */
    const missingDark = REQUIRED_COLOUR_ROLES.filter((role) => !(role in darkBlock))
    expect(missingDark, "roles the dark theme silently inherits from light").toEqual([])
  })

  test("every type role carries all four parts of a type style", () => {
    const missing: string[] = []
    for (const role of TYPE_ROLES) {
      for (const part of TYPE_PARTS) {
        const token = `--md-sys-typescale-${role}-${part}`
        if (!(token in light)) missing.push(token)
      }
    }
    // Three of the four is what a "type scale" usually means in practice, and
    // the missing one is always tracking.
    expect(missing).toEqual([])
  })

  test("the shape ramp is complete and monotonic", () => {
    const missing = SHAPE_STEPS.filter((token) => !(token in light))
    expect(missing).toEqual([])

    // The ORDER is the only thing a component can rely on. A ramp where `large`
    // is smaller than `medium` type-checks, renders, and makes every component
    // that picked a step by name wrong.
    const pixels = SHAPE_STEPS.slice(0, -1).map((token) => parseFloat(value("light", token)))
    for (let i = 1; i < pixels.length; i++) {
      expect(pixels[i], `${SHAPE_STEPS[i]} is not larger than ${SHAPE_STEPS[i - 1]}`).toBeGreaterThan(
        pixels[i - 1],
      )
    }
    // `full` is the pill, and it is last by definition.
    expect(parseFloat(value("light", SHAPE_STEPS[SHAPE_STEPS.length - 1]))).toBeGreaterThan(
      pixels[pixels.length - 1],
    )
  })

  test("elevation runs 0 to 5 in both themes, and 0 is no shadow", () => {
    for (const theme of ["light", "dark"] as const) {
      const declared = theme === "light" ? light : darkBlock
      const missing = ELEVATION_LEVELS.filter((token) => !(token in declared))
      expect(missing, `${theme} is missing elevation levels`).toEqual([])
      expect(value(theme, "--md-sys-elevation-0")).toBe("none")
    }
  })

  test("the state layer is opacities, and they are Material's", () => {
    const missing = STATE_OPACITIES.filter((token) => !(token in light))
    expect(missing).toEqual([])
    expect(value("light", "--md-sys-state-hover-opacity")).toBe("0.08")
    expect(value("light", "--md-sys-state-focus-opacity")).toBe("0.12")
    expect(value("light", "--md-sys-state-pressed-opacity")).toBe("0.12")
  })

  /**
   * The scrim, which `Dialog` is the first thing in this console to render.
   *
   * Four properties, and each of them is a defect that has shipped somewhere:
   *
   *   * it is TRANSLUCENT. An opaque scrim is not a scrim, it is a page, and the
   *     dialog above it loses the context it was drawn over.
   *   * it is not so light that it fails to separate. Below about a fifth the
   *     panel stops reading as lifted and the content behind it stays the thing
   *     the eye lands on.
   *   * it is not pure WHITE, which would lighten the page it is meant to dim.
   *   * it DOES ITS JOB — measured, not assumed: composited over the brightest
   *     surface the theme has, it must cut that surface's relative luminance by
   *     at least half.
   *
   * ## What this replaces, and why the replacement is the stronger rule
   *
   * This assertion used to require the scrim's colour not be pure black,
   * because `preferences.spec.ts` read every rendered background looking for
   * `rgb(0, 0, 0)`. That was a correct rule about the OLD palette and is the
   * wrong rule for this one: the dark theme's base surface IS #000 now, so a
   * green-charcoal scrim was a TINT over black rather than a dimming of it, and
   * the prohibition would have forced exactly that.
   *
   * Alpha alone is not a substitute — `rgba(250, 250, 250, 0.62)` is 62% opaque
   * and makes the page brighter. So the colour constraint was not dropped, it
   * was replaced with the property the old one was a proxy for.
   */
  test("the scrim is translucent, is not pure white, and halves the page's luminance", () => {
    for (const theme of ["light", "dark"] as const) {
      const raw = value(theme, "--md-sys-color-scrim")
      const parsed = parseColor(raw)
      expect(parsed, `${theme} scrim ${raw} is not a colour this audit can measure`).not.toBeNull()
      if (!parsed) continue
      expect(parsed.a, `${theme} scrim is opaque`).toBeLessThan(1)
      expect(parsed.a, `${theme} scrim is too faint to separate`).toBeGreaterThanOrEqual(0.2)
      expect(
        parsed.r === 255 && parsed.g === 255 && parsed.b === 255,
        `${theme} scrim is pure white`,
      ).toBe(false)

      // The brightest thing the scrim can be drawn over, which is the hardest
      // case: if it dims that by half it dims everything below it by more.
      const brightest = parseColor(value(theme, "--md-sys-color-surface-bright"))
      expect(brightest, `${theme} surface-bright is not a colour this audit can measure`).not.toBeNull()
      if (!brightest) continue
      const before = relativeLuminance(brightest)
      const after = relativeLuminance(composite(parsed, brightest))
      expect(
        after / before,
        `${theme} scrim leaves surface-bright at ${((after / before) * 100).toFixed(1)}% of its ` +
          `luminance — it is a tint, not a scrim`,
      ).toBeLessThanOrEqual(0.5)
    }
  })

  test("motion durations stay inside the console's documented band", () => {
    const missing = MOTION_TOKENS.filter((token) => !(token in light))
    expect(missing).toEqual([])

    // Bible §26.3.7: 120-220 ms. Outside that band a transition is either
    // imperceptible or slow enough to read as lag. `preferences.spec.ts`
    // asserts the same ceiling against the rendered page; this asserts it
    // against the token, so a duration cannot be out of band before it is used.
    for (const token of MOTION_TOKENS.filter((t) => t.includes("duration"))) {
      const ms = parseFloat(value("light", token))
      expect(ms, `${token} is below the band`).toBeGreaterThanOrEqual(120)
      expect(ms, `${token} is above the band`).toBeLessThanOrEqual(220)
    }

    // Reduced motion zeroes them by zeroing what they alias. A duration token
    // that still reads 180ms while the page has stopped moving is a trap for
    // the next rule that reads it.
    const reduced = { ...light, ...blockAt(css, /(^|\n)\s*:root\[data-motion="reduced"\]\s*\{/) }
    for (const token of MOTION_TOKENS.filter((t) => t.includes("duration"))) {
      expect(parseFloat(resolveToken(reduced, token)), `${token} under reduced motion`).toBe(0)
    }
  })
})

/* ── Contrast ─────────────────────────────────────────────────────────────── */

/**
 * What a pair is FOR, which is what decides its threshold.
 *
 *   * `body`       — WCAG 2.2 AA 1.4.3, normal text: 4.5:1.
 *   * `nonText`    — 1.4.11, the boundary of a control or a meaningful graphic:
 *                    3:1.
 *   * `decorative` — a hairline between two regions that are ALREADY
 *                    distinguishable without it. WCAG requires nothing of these,
 *                    and the floor here is only "visible at all". Every pair
 *                    carrying this purpose is named individually below, so
 *                    "decorative" is a claim someone made about a specific edge
 *                    rather than a category anything can fall into.
 */
type Purpose = "body" | "nonText" | "decorative"

const THRESHOLD: Record<Purpose, number> = {
  body: AA_THRESHOLD.body,
  nonText: AA_THRESHOLD.nonText,
  decorative: 1.2,
}

interface Pair {
  content: string
  container: string
  purpose: Purpose
  /** Where this pair actually lands. A pair nobody can point at is a guess. */
  where: string
}

const role = (name: string) => `--md-sys-color-${name}`

/**
 * Every container a text role can be drawn on.
 *
 * All ten, including the three a control never sits on, because TEXT does: a
 * table's header band is `surface-variant`, and the heading in it is
 * `on-surface-variant`.
 */
const TEXT_SURFACES = [
  "background",
  "surface",
  "surface-dim",
  "surface-bright",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
  "surface-variant",
]

/**
 * The subset a CONTROL can sit on, which is a smaller question.
 *
 * `Surface`'s `container` prop offers exactly these plus `inverse`; there is no
 * way in this system to place a button or an outlined card on `surface-dim`,
 * `surface-bright` or `surface-variant`. The last of those is the table header
 * band and holds heading text and nothing else.
 *
 * The distinction is not a convenience. Auditing a hover state that cannot
 * occur would have forced `--md-sys-color-error` two steps darker to satisfy a
 * danger button inside a table heading — a real colour changed for an imaginary
 * placement, which is how a palette drifts away from what it renders.
 */
const CONTROL_SURFACES = [
  "background",
  "surface",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
]

const PAIRS: Pair[] = [
  ...TEXT_SURFACES.flatMap((surface): Pair[] => [
    { content: role("on-surface"), container: role(surface), purpose: "body", where: `body text on ${surface}` },
    {
      content: role("on-surface-variant"),
      container: role(surface),
      purpose: "body",
      where: `secondary text, table headings and disabled labels on ${surface}`,
    },
    {
      content: role("primary"),
      container: role(surface),
      purpose: "body",
      where: `the label of a text or outlined button on ${surface}`,
    },
    { content: role("error"), container: role(surface), purpose: "body", where: `error text on ${surface}` },
    { content: role("warning"), container: role(surface), purpose: "body", where: `warning text on ${surface}` },
    { content: role("success"), container: role(surface), purpose: "body", where: `success text on ${surface}` },
    {
      content: role("outline"),
      container: role(surface),
      purpose: "nonText",
      where: `the border of a control — an outlined button, a chip — on ${surface}`,
    },
  ]),

  ...CONTROL_SURFACES.map(
    (surface): Pair => ({
      content: role("outline-variant"),
      container: role(surface),
      purpose: "decorative",
      where: `the hairline round a card that is already distinct by its own background, on ${surface}`,
    }),
  ),

  // The filled families. Every one of the four parts, whether or not a component
  // reaches for it today — the ones nothing renders are exactly the ones that
  // will be wrong when something does.
  { content: role("on-primary"), container: role("primary"), purpose: "body", where: "a filled button" },
  {
    content: role("on-primary-container"),
    container: role("primary-container"),
    purpose: "body",
    where: "the masthead mark, the current tab, a primary-tonal surface",
  },
  { content: role("on-secondary"), container: role("secondary"), purpose: "body", where: "a filled secondary control" },
  {
    content: role("on-secondary-container"),
    container: role("secondary-container"),
    purpose: "body",
    where: "a tonal button, a selected chip",
  },
  { content: role("on-tertiary"), container: role("tertiary"), purpose: "body", where: "a filled tertiary control" },
  {
    content: role("on-tertiary-container"),
    container: role("tertiary-container"),
    purpose: "body",
    where: "an info badge — a region, an environment, a fact that is neither good nor bad",
  },
  { content: role("on-error"), container: role("error"), purpose: "body", where: "a filled danger button" },
  {
    content: role("on-error-container"),
    container: role("error-container"),
    purpose: "body",
    where: "a bad badge, a tonal danger button",
  },
  { content: role("on-warning"), container: role("warning"), purpose: "body", where: "a filled warning control" },
  {
    content: role("on-warning-container"),
    container: role("warning-container"),
    purpose: "body",
    where: "a warn badge",
  },
  { content: role("on-success"), container: role("success"), purpose: "body", where: "a filled success control" },
  {
    content: role("on-success-container"),
    container: role("success-container"),
    purpose: "body",
    where: "an ok badge",
  },
  { content: role("on-background"), container: role("background"), purpose: "body", where: "text on the page itself" },

  // The inverse surface, and the accent that has to invert with it.
  {
    content: role("inverse-on-surface"),
    container: role("inverse-surface"),
    purpose: "body",
    where: "text on a surface that must read as not part of the page",
  },
  {
    content: role("inverse-primary"),
    container: role("inverse-surface"),
    purpose: "body",
    where: "a text button inside an inverse surface",
  },

  // Boundaries that are not the edge of the page.
  {
    content: role("secondary"),
    container: role("secondary-container"),
    purpose: "nonText",
    where: "the border of a selected chip against its own fill",
  },
  /*
   * A family's base colour drawn on that family's own container.
   *
   * `SeverityChip` needs this and nothing before it did. Two of Security Hub's
   * five levels share the error family — `critical` is the filled error,
   * `high` is the error container — and the border is what tells them apart at
   * a glance for a reader who has not read the word. A border doing that job is
   * a meaningful graphic, so 3:1 (WCAG 2.2 AA 1.4.11) rather than a hairline's
   * 1.2. All three measure above 5:1 in both themes, which is comfortable; the
   * assertion exists so that stays true when a container tone is next adjusted.
   */
  {
    content: role("error"),
    container: role("error-container"),
    purpose: "nonText",
    where: "the border of a HIGH severity chip, which is what distinguishes it from CRITICAL",
  },
  {
    content: role("warning"),
    container: role("warning-container"),
    purpose: "nonText",
    where: "the border of a MEDIUM severity chip, and of an overdue stale indicator",
  },
  {
    content: role("tertiary"),
    container: role("tertiary-container"),
    purpose: "nonText",
    where: "the border of a LOW severity chip — the tertiary family, not a green",
  },
  {
    content: role("outline"),
    container: role("surface-container-highest"),
    purpose: "nonText",
    where: "the border of a disabled filled button — the only thing left marking where the control is",
  },
]

test.describe("every declared pair clears its WCAG 2.2 AA threshold", () => {
  for (const theme of THEME_NAMES) {
    test(theme, () => {
      const failures: string[] = []
      for (const pair of PAIRS) {
        const content = value(theme, pair.content)
        const container = value(theme, pair.container)
        const required = THRESHOLD[pair.purpose]
        const ratio = contrastRatio(content, container, container)
        if (ratio < required) {
          failures.push(
            `${pair.content} (${content}) on ${pair.container} (${container}) = ${ratio.toFixed(2)}:1, ` +
              `needs ${required}:1 — ${pair.where}`,
          )
        }
      }
      expect(failures).toEqual([])
    })
  }
})

/* ── The near-black neutral family, and what has to be true because of it ─── */

/**
 * The dark theme the product owner asked for, pinned as arithmetic.
 *
 * The console shipped an OLED-black dark theme with an invented `#12cc7e`
 * accent. The owner has asked for the near-black neutral greys instead, and for
 * the real Tenure green. So this block asserts the new instruction the way the
 * old one was asserted — positively, on the values themselves — rather than
 * relaxing into "some dark colour":
 *
 *   * the base planes really are the family's values, so a palette that drifts
 *     back toward black (or toward a charcoal nobody chose) reds;
 *   * no surface, content colour or boundary carries a hue, because "the green
 *     is the accent and nothing else" is the other half of the instruction and a
 *     green-tinted grey is the failure that is hardest to see in a screenshot
 *     and trivial to see in a hex code;
 *   * no foreground is pure WHITE — 21:1 is where halation and the smearing of
 *     adjacent glyphs come from, and that is true on #212121 as it was on #000;
 *   * every adjacent container step is measurably distinct. Shadow carries
 *     elevation now that there are darker pixels to draw with, but the ladder is
 *     what separates two adjacent PLANES, and a ladder tuned for black sitting
 *     on grey is the specific thing this asserts against.
 */

const CONTAINER_RAMP = [
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
]

/**
 * The planes the dark theme is built on, and the value each one must be.
 *
 * This replaces a test that required four roles to be exactly `#000000`. That
 * test was right about the palette it was written for and is the wrong shape for
 * this one — the roles no longer share a value, because the page, the rail and
 * the deepest well are three different planes rather than three names for the
 * black underneath everything. Pinning the three values separately is strictly
 * more than the old assertion checked, not less: it catches a drift in any one
 * of them, and it catches the page and the rail collapsing back into each other.
 */
const BASE_PLANES: [string, string][] = [
  ["background", "#212121"],
  ["surface", "#212121"],
  ["surface-dim", "#171717"],
  ["surface-container-lowest", "#0d0d0d"],
]

const BASE_ROLES = BASE_PLANES.map(([name]) => name)

/**
 * Roles that must carry NO hue in dark: r = g = b.
 *
 * Surfaces, the two content colours, both boundaries, the inverse pair, and the
 * whole secondary family — secondary is the tonal button and the selected chip,
 * which are surface-like fills, and a second green family beside `primary` is
 * how a console reads as tinted while every token is individually defensible.
 *
 * Deliberately NOT here: `primary` (the accent and the mark, which is the ONE
 * green), and the status families — `error`, `warning`, `success`, `tertiary`
 * carry hue because hue is part of what they mean.
 */
const NEUTRAL_IN_DARK = [
  ...BASE_ROLES,
  "surface-bright",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
  "surface-variant",
  "on-background",
  "on-surface",
  "on-surface-variant",
  "outline",
  "outline-variant",
  "secondary",
  "on-secondary",
  "secondary-container",
  "on-secondary-container",
  "inverse-surface",
  "inverse-on-surface",
]

/** Every role a glyph is ever painted in, in any theme. */
const FOREGROUND_ROLES = [
  "on-background",
  "on-surface",
  "on-surface-variant",
  "on-primary",
  "on-primary-container",
  "on-secondary",
  "on-secondary-container",
  "on-tertiary",
  "on-tertiary-container",
  "on-error",
  "on-error-container",
  "on-warning",
  "on-warning-container",
  "on-success",
  "on-success-container",
  "inverse-on-surface",
  "inverse-primary",
  "primary",
  "secondary",
  "tertiary",
  "error",
  "warning",
  "success",
]

const DARK_THEMES = ["dark", "dark-contrast"] as const

/** The step between two adjacent containers, below which two panels smear. */
const RAMP_STEP_MINIMUM = 1.12

test.describe("the dark theme is the neutral family, neutral throughout, and stepped", () => {
  test("the base planes are the family's values, in both dark variants", () => {
    for (const theme of DARK_THEMES) {
      for (const [name, expected] of BASE_PLANES) {
        expect(
          value(theme, role(name)).toLowerCase(),
          `${theme} ${name} is not the near-black neutral the product owner asked for`,
        ).toBe(expected)
      }
    }
  })

  test("the page, the rail and the deepest well are three planes, not one", () => {
    // The property the four-way `#000000` equality used to give for free and
    // this palette has to state: three of the roles above are DIFFERENT, and a
    // future edit that collapses the rail into the page would otherwise satisfy
    // every ratio in this file while deleting the rail.
    for (const theme of DARK_THEMES) {
      const planes = ["background", "surface-dim", "surface-container-lowest"].map((n) =>
        value(theme, role(n)).toLowerCase(),
      )
      expect(new Set(planes).size, `${theme}: ${planes.join(", ")}`).toBe(3)
    }
  })

  test("no surface, content colour or boundary carries a hue", () => {
    const tinted: string[] = []
    for (const theme of DARK_THEMES) {
      for (const name of NEUTRAL_IN_DARK) {
        const raw = value(theme, role(name))
        const parsed = parseColor(raw)
        expect(parsed, `${theme} ${name} (${raw}) is not a colour this audit can measure`).not.toBeNull()
        if (!parsed) continue
        if (!(parsed.r === parsed.g && parsed.g === parsed.b)) {
          tinted.push(`${theme} ${name} = ${raw}`)
        }
      }
    }
    expect(
      tinted,
      "A tinted grey. The surfaces are neutral and the green is the accent and the mark — a " +
        "green-charcoal surface is the defect the operator named, and it is invisible in a " +
        "screenshot and obvious in a hex code.",
    ).toEqual([])
  })

  test("no foreground is pure white, in any theme", () => {
    // The half of "no pure-black glare" that survives the override intact.
    // #ffffff on #000 is 21:1, which is where halation and the smearing of
    // adjacent glyphs actually come from on an OLED panel.
    const glaring: string[] = []
    for (const theme of THEME_NAMES) {
      for (const name of FOREGROUND_ROLES) {
        const raw = value(theme, role(name))
        const parsed = parseColor(raw)
        if (!parsed) continue
        if (parsed.r === 255 && parsed.g === 255 && parsed.b === 255) {
          glaring.push(`${theme} ${name} = ${raw}`)
        }
      }
    }
    expect(glaring).toEqual([])
  })

  test("every adjacent container step is visibly distinct", () => {
    // Shadow carries elevation now — #212121 has darker pixels below it and
    // `--md-sys-elevation-*` was deepened to use them. The ladder's job is to
    // separate two adjacent PLANES, which a shadow does not do: two steps that
    // measure the same are two panels the operator cannot tell apart, and
    // nothing else in the suite would say so. The floor is unchanged from the
    // OLED palette on purpose — the ladder got a second carrier, not a pardon.
    const failures: string[] = []
    for (const theme of DARK_THEMES) {
      for (let i = 1; i < CONTAINER_RAMP.length; i++) {
        const lower = value(theme, role(CONTAINER_RAMP[i - 1]))
        const upper = value(theme, role(CONTAINER_RAMP[i]))
        const ratio = contrastRatio(upper, lower)
        if (ratio < RAMP_STEP_MINIMUM) {
          failures.push(
            `${theme}: ${CONTAINER_RAMP[i - 1]} (${lower}) → ${CONTAINER_RAMP[i]} (${upper}) = ` +
              `${ratio.toFixed(3)}:1, needs ${RAMP_STEP_MINIMUM}:1`,
          )
        }
      }
    }
    expect(failures).toEqual([])
  })

  /**
   * The other carrier of elevation, now that there is one.
   *
   * At #000 a drop shadow is nothing at any opacity — there are no darker pixels
   * — so the elevation ramp was five declarations nothing could check and
   * nothing did. The decision recorded in `globals.css` is that on #212121
   * SHADOW carries elevation and the container ladder separates planes, and this
   * is that decision as arithmetic rather than as a paragraph:
   *
   *   * the ramp deepens monotonically, or a "level" is not a level;
   *   * and level 1 — the shallowest, the one a card gets — actually darkens the
   *     page it sits on. 1.15:1 is the floor because that is roughly where an
   *     edge stops being something the eye infers from the geometry; the ramp as
   *     written measures 1.159:1 there.
   *
   * The alpha of the FIRST shadow in each declaration is the one measured: it is
   * the ambient layer, the wider and softer of the two, and it is what a viewer
   * reads as depth.
   */
  test("the dark elevation ramp deepens, and level 1 is visible on the page", () => {
    const alphaOf = (level: number) => {
      const raw = value("dark", `--md-sys-elevation-${level}`)
      const match = raw.match(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([\d.]+)\s*\)/)
      expect(match, `elevation-${level} is not a black shadow this audit can measure: ${raw}`).not.toBeNull()
      return parseFloat(match![1])
    }

    const alphas = [1, 2, 3, 4, 5].map(alphaOf)
    for (let i = 1; i < alphas.length; i++) {
      expect(alphas[i], `elevation-${i + 1} (${alphas[i]}) is not deeper than elevation-${i} (${alphas[i - 1]})`).toBeGreaterThan(
        alphas[i - 1],
      )
    }

    const page = parseColor(value("dark", role("background")))
    expect(page).not.toBeNull()
    const shadowed = composite({ r: 0, g: 0, b: 0, a: alphas[0] }, page!)
    const ratio = contrastRatio(page!, shadowed)
    expect(
      ratio,
      `a level-1 shadow leaves the page at ${ratio.toFixed(3)}:1 — an edge nobody can see, which ` +
        `is what every one of these five declarations was worth while the base was #000`,
    ).toBeGreaterThanOrEqual(1.15)
  })

  test("the container ladder climbs in one direction, in every theme", () => {
    // Direction differs by theme — on paper the containers get DARKER as they
    // rise, on black they get LIGHTER — but a ladder that reverses halfway is a
    // ladder whose steps mean nothing, and equal steps are caught here too in
    // the themes the ratio floor above does not cover.
    for (const theme of THEME_NAMES) {
      const luminances = CONTAINER_RAMP.map((name) => {
        const parsed = parseColor(value(theme, role(name)))
        expect(parsed, `${theme} ${name} is not a colour this audit can measure`).not.toBeNull()
        return relativeLuminance(parsed!)
      })
      const rising = luminances.every((l, i) => i === 0 || l > luminances[i - 1])
      const falling = luminances.every((l, i) => i === 0 || l < luminances[i - 1])
      expect(
        rising || falling,
        `${theme} container ladder is not strictly monotonic: ` +
          CONTAINER_RAMP.map((n, i) => `${n}=${luminances[i].toFixed(4)}`).join(", "),
      ).toBe(true)
    }
  })
})

/* ── The green is the brand's, and this file is not allowed to invent one ─── */

/**
 * The guard that would have stopped `#12cc7e`.
 *
 * The console shipped an accent described in its own comment as a "deep forest
 * green" which appears in no Tenure palette — an agent mixed it while building
 * the OLED theme, every contrast assertion in this file passed on it, and the
 * product owner is the thing that eventually caught it. Nothing here could have:
 * the audit measured whether the colour was LEGIBLE, and it was.
 *
 * So the ramp is read out of the tenant application — the source of truth, in
 * this same repository — and every role whose job is to be the brand green has
 * to BE one of its steps. A ratio cannot express "this is the right green"; set
 * membership can.
 *
 * The tenant's stylesheet is read rather than copied for the same reason
 * `css-declarations.mjs` is imported rather than reimplemented above: a second
 * copy of the ramp is a second thing to update and a second thing to be wrong.
 */
const BRAND_CSS = fs.readFileSync(
  path.join(STUDIO, "..", "web", "src", "app", "globals.css"),
  "utf8",
)

const FOREST_RAMP = new Map(
  [...BRAND_CSS.matchAll(/(--tenure-forest-\d+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [
    m[2].toLowerCase(),
    m[1],
  ]),
)

/**
 * The roles that ARE the brand green, in every theme.
 *
 * Not "every role that contains green": `on-primary` is a near-black in dark and
 * a near-white in light, and both are correct. These three are the ones whose
 * whole purpose is to be the accent — as a glyph (`primary`), as a fill
 * (`primary-container`), and as the accent on an inverted surface
 * (`inverse-primary`).
 */
const GREEN_ROLES = ["primary", "primary-container", "inverse-primary"]

test.describe("every green is a step of the Tenure forest ramp", () => {
  test("the ramp was actually read", () => {
    // An absence check against an empty set passes on every input, and the
    // failure mode is silent: a moved file, a renamed token, and this whole
    // describe block becomes decoration.
    expect(FOREST_RAMP.size, "the tenure forest ramp was not found in apps/web").toBeGreaterThanOrEqual(14)
    expect([...FOREST_RAMP.keys()], "the ramp read does not contain --primary's value").toContain(
      "#198052",
    )
  })

  for (const theme of THEME_NAMES) {
    test(theme, () => {
      const invented: string[] = []
      for (const name of GREEN_ROLES) {
        const raw = value(theme, role(name)).toLowerCase()
        if (!FOREST_RAMP.has(raw)) invented.push(`${role(name)} = ${raw}`)
      }
      expect(
        invented,
        "A green that is in no Tenure palette. Pick a STEP of the ramp in " +
          "apps/web/src/app/globals.css — that is what the ramp is for, and it is what " +
          "distinguishes using the brand from mixing a colour that looks like it.",
      ).toEqual([])
    })
  }

  test("the invented accent is declared nowhere in the console", () => {
    // Every stylesheet, not just `globals.css` — a module stylesheet is exactly
    // where a colour someone was told to stop using would reappear.
    //
    // Comments are stripped first, and that is the difference between a rule and
    // a taboo: the paragraph in `globals.css` explaining what `#12cc7e` was and
    // why it went is the record of the decision, and a test that forbade the
    // record would delete the only reason the next reader has not to remix it.
    const declarations = allStylesheets.replace(/\/\*[\s\S]*?\*\//g, "").toLowerCase()
    expect(declarations).not.toContain("#12cc7e")
  })
})

/* ── The state layer ──────────────────────────────────────────────────────── */

/**
 * A hovered control's background is not its container colour.
 *
 * `.md3-state::before` fills the control with `currentColor` at the state
 * opacity, so the background under the label moves TOWARD the label — hover
 * always costs contrast, and it costs most where the ratio was tightest. 4.5:1
 * at rest can be 4.2:1 under the cursor, and no screenshot and no rendered-page
 * audit that does not hover will ever see it.
 */
interface Interactive {
  content: string
  container: string
  where: string
}

const INTERACTIVE: Interactive[] = [
  { content: role("on-primary"), container: role("primary"), where: "filled button" },
  { content: role("on-secondary-container"), container: role("secondary-container"), where: "tonal button, selected chip" },
  { content: role("on-error"), container: role("error"), where: "filled danger button" },
  { content: role("on-error-container"), container: role("error-container"), where: "tonal danger button" },
  { content: role("inverse-primary"), container: role("inverse-surface"), where: "text button on an inverse surface" },
  ...CONTROL_SURFACES.flatMap((surface): Interactive[] => [
    { content: role("primary"), container: role(surface), where: `text or outlined button on ${surface}` },
    { content: role("error"), container: role(surface), where: `danger text button on ${surface}` },
    { content: role("on-surface"), container: role(surface), where: `unselected chip on ${surface}` },
  ]),
]

const STATES = ["hover", "focus", "pressed"] as const

test.describe("the state layer does not spend the contrast budget", () => {
  for (const theme of THEME_NAMES) {
    test(theme, () => {
      const failures: string[] = []
      for (const control of INTERACTIVE) {
        const content = value(theme, control.content)
        const container = value(theme, control.container)
        const parsedContent = parseColor(content)
        const parsedContainer = parseColor(container)
        expect(parsedContent, `${control.content} is not a colour this audit can measure`).not.toBeNull()
        expect(parsedContainer, `${control.container} is not a colour this audit can measure`).not.toBeNull()
        if (!parsedContent || !parsedContainer) continue

        for (const state of STATES) {
          const opacity = parseFloat(value(theme, `--md-sys-state-${state}-opacity`))
          // The layer IS the content colour. That is the mechanism, not an
          // approximation of it: `background: currentColor` in `globals.css`.
          const layered = composite({ ...parsedContent, a: opacity }, parsedContainer)
          const ratio = contrastRatio(parsedContent, layered)
          if (ratio < AA_THRESHOLD.body) {
            failures.push(
              `${control.where}: ${control.content} on ${control.container} under ${state} ` +
                `(${(opacity * 100).toFixed(0)}%) = ${ratio.toFixed(2)}:1, needs ${AA_THRESHOLD.body}:1`,
            )
          }
        }
      }
      expect(failures).toEqual([])
    })
  }
})

/* ── The rule that makes the audit above complete ─────────────────────────── */

/** Source with comments removed, so a guard cannot fire on the prose about it. */
function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

const md3Entries = fs
  .readdirSync(MD3_DIR)
  // Sorted, because a directory listing is not ordered and this list reaches an
  // assertion message. `readdirSync` order differs between filesystems, which is
  // how a test's output becomes machine-dependent.
  .filter((name) => /\.tsx?$/.test(name))
  .sort()

/**
 * The test files in the directory, which are not components.
 *
 * `aws-outcomes.test.tsx` lives beside the components it renders — jest's roots
 * include `apps/system-studio/src`, and this app has no jest of its own. It is
 * excluded from the scans below because a test may legitimately need to name a
 * colour in order to prove the ban catches one, and a rule that cannot be
 * demonstrated is a rule nobody can check.
 *
 * The exclusion is pinned rather than trusted: the assertion below requires it
 * to be exactly the files whose names say `.test.`, so "excluded" cannot quietly
 * grow to include a component somebody wanted to write a hex in.
 */
const md3TestFiles = md3Entries.filter((name) => /\.test\.tsx?$/.test(name))
const md3Files = md3Entries.filter((name) => !/\.test\.tsx?$/.test(name))

/**
 * Every CSS named colour, which is the third way to write one.
 *
 * The hex scan and the function scan below have always been here; a component
 * could still have said `color: "rebeccapurple"` and passed both. The list is
 * the CSS Color Module Level 4 keyword set, written out rather than derived,
 * because there is nowhere in this repository to derive it from and a
 * half-remembered subset is a scan with holes exactly where the unusual names
 * are.
 */
const NAMED_COLOURS = [
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque", "black",
  "blanchedalmond", "blue", "blueviolet", "brown", "burlywood", "cadetblue", "chartreuse",
  "chocolate", "coral", "cornflowerblue", "cornsilk", "crimson", "cyan", "darkblue", "darkcyan",
  "darkgoldenrod", "darkgray", "darkgreen", "darkgrey", "darkkhaki", "darkmagenta",
  "darkolivegreen", "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen",
  "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise", "darkviolet", "deeppink",
  "deepskyblue", "dimgray", "dimgrey", "dodgerblue", "firebrick", "floralwhite", "forestgreen",
  "fuchsia", "gainsboro", "ghostwhite", "gold", "goldenrod", "gray", "green", "greenyellow",
  "grey", "honeydew", "hotpink", "indianred", "indigo", "ivory", "khaki", "lavender",
  "lavenderblush", "lawngreen", "lemonchiffon", "lightblue", "lightcoral", "lightcyan",
  "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey", "lightpink", "lightsalmon",
  "lightseagreen", "lightskyblue", "lightslategray", "lightslategrey", "lightsteelblue",
  "lightyellow", "lime", "limegreen", "linen", "magenta", "maroon", "mediumaquamarine",
  "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen", "mediumslateblue",
  "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue", "mintcream",
  "mistyrose", "moccasin", "navajowhite", "navy", "oldlace", "olive", "olivedrab", "orange",
  "orangered", "orchid", "palegoldenrod", "palegreen", "paleturquoise", "palevioletred",
  "papayawhip", "peachpuff", "peru", "pink", "plum", "powderblue", "purple", "rebeccapurple",
  "red", "rosybrown", "royalblue", "saddlebrown", "salmon", "sandybrown", "seagreen", "seashell",
  "sienna", "silver", "skyblue", "slateblue", "slategray", "slategrey", "snow", "springgreen",
  "steelblue", "tan", "teal", "thistle", "tomato", "turquoise", "violet", "wheat", "white",
  "whitesmoke", "yellow", "yellowgreen",
]

/**
 * Where a named colour is a colour, rather than an English word.
 *
 * Two shapes, and deliberately not "the bare word anywhere in the file":
 * `tan`, `plum`, `linen` and `peru` are all real CSS keywords and all things a
 * comment or an identifier can legitimately contain, and a scan that flagged
 * `Math.tan` would be turned off within a week. So a name counts when it is
 *
 *   * a whole string literal — `"red"`, `'tomato'`, the form an inline style or
 *     a class-name switch would take; or
 *   * the value of something colour-shaped — `color: red`, `borderColor: gold`,
 *     which is the form a style object takes.
 *
 * Comments are already stripped by `code()` before either runs, so the prose
 * above a rule cannot fire the rule.
 */
const NAMED_COLOUR_TESTS = NAMED_COLOURS.flatMap((name) => [
  { name, pattern: new RegExp(String.raw`(["'\`])${name}\1`, "i") },
  {
    name,
    pattern: new RegExp(
      String.raw`\b(?:color|colour|background|backgroundColor|border|borderColor|outline|outlineColor|fill|stroke|caretColor|accentColor)\s*:\s*["'\`]?${name}\b`,
      "i",
    ),
  },
])

test.describe("a component may not contain a colour", () => {
  test("the directory being scanned is the real one", () => {
    // An absence check over an empty list passes on every input. The floor is a
    // count of what is actually there: eighteen primitives, and it may only
    // rise — a component that vanishes from this directory takes its colour
    // guarantee with it.
    expect(md3Files.length, "components/md3 has stopped being read").toBeGreaterThanOrEqual(18)
  })

  test("the scan skips test files and nothing else", () => {
    // The one hole in every assertion below, pinned so it cannot be widened.
    const excluded = md3Entries.filter((name) => !md3Files.includes(name))
    expect(excluded).toEqual(md3TestFiles)
    expect(excluded.every((name) => /\.test\.tsx?$/.test(name))).toBe(true)
  })

  test("no literal colour, in any syntax", () => {
    const offences: string[] = []
    for (const name of md3Files) {
      const source = code(path.join(MD3_DIR, name))
      for (const match of source.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        offences.push(`${name}: ${match[0]}`)
      }
      for (const match of source.matchAll(
        /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\s*\(/g,
      )) {
        offences.push(`${name}: ${match[1]}(`)
      }
      // The third syntax: the 148 keywords. A component saying `color: "red"`
      // passed both scans above until this one existed.
      for (const { name: colour, pattern } of NAMED_COLOUR_TESTS) {
        const match = source.match(pattern)
        if (match) offences.push(`${name}: named colour ${colour} — ${match[0]}`)
      }
    }
    expect(
      offences,
      "A colour in a component is a pair the contrast audit above does not know exists, in the " +
        "file it is least likely to be pointed at. Name a --md-sys-color-* role instead.",
    ).toEqual([])
  })

  test("the named-colour scan is the whole keyword set", () => {
    // A guard whose input list has been trimmed is a guard that reads green.
    expect(NAMED_COLOURS.length).toBe(148)
    expect(new Set(NAMED_COLOURS).size).toBe(148)
    // The three that most often reach a status component by hand.
    for (const required of ["red", "green", "orange"]) {
      expect(NAMED_COLOURS).toContain(required)
    }
  })

  test("no inline style attribute, which is where a colour would hide", () => {
    // The structural half. `style={{ background: SOMETHING }}` defeats the
    // lexical scan above the moment the colour is a variable, and there is no
    // legitimate inline style in this set — every one of these components is a
    // class name and a data attribute.
    const offences = md3Files.filter((name) => /\bstyle\s*=\s*\{/.test(code(path.join(MD3_DIR, name))))
    expect(offences).toEqual([])
  })
})

/* ── The classes and the components cannot drift apart ────────────────────── */

const classesInCss = new Set(
  [...css.matchAll(/\.(md3-[\w-]+)/g)].map((match) => match[1]),
)

const classesInComponents = new Set(
  md3Files.flatMap((name) =>
    [...code(path.join(MD3_DIR, name)).matchAll(/\b(md3-[\w-]+)\b/g)].map((match) => match[1]),
  ),
)

/** The type scale is a vocabulary a page applies directly, not component CSS. */
const TYPE_CLASSES = new Set(TYPE_ROLES.map((r) => `md3-${r}`))

test.describe("the stylesheet and the components describe the same set", () => {
  test("every class a component emits is declared", () => {
    const undeclared = [...classesInComponents].filter((c) => !classesInCss.has(c)).sort()
    // A class name with no rule is a component that renders unstyled and looks,
    // in a screenshot, exactly like a component whose rule stopped matching.
    expect(undeclared).toEqual([])
  })

  test("every component class in the stylesheet is emitted by a component", () => {
    const dead = [...classesInCss]
      .filter((c) => !classesInComponents.has(c) && !TYPE_CLASSES.has(c))
      .sort()
    expect(
      dead,
      "Dead component CSS. Either a component stopped emitting it, or it was written for one " +
        "that was never built.",
    ).toEqual([])
  })

  /**
   * Every component is reachable from `components/md3`, which is the whole
   * point of a barrel.
   *
   * Twelve route surfaces are adopting this layer. A primitive that exists but
   * is not exported is one each of them either imports by deep path — twelve
   * import lines that break when a file is renamed — or, far more likely,
   * reimplements locally with a `<div>` and a colour. That is precisely how a
   * design system acquires a second, unaudited palette, and the file it happens
   * in is never the one anybody reviews.
   */
  test("every component in the directory is exported from the barrel", () => {
    const barrel = fs.readFileSync(path.join(MD3_DIR, "index.ts"), "utf8")
    const missing = md3Files
      .filter((name) => name !== "index.ts")
      .map((name) => name.replace(/\.tsx?$/, ""))
      .filter((module) => !barrel.includes(`from "./${module}"`))
      .sort()
    expect(missing, "primitives a route cannot import from `components/md3`").toEqual([])
  })

  test("the type-scale exemption is exactly the fifteen roles", () => {
    // The exemption above is the one hole in the previous assertion, so it is
    // pinned. Without this, adding `md3-anything` to TYPE_CLASSES would exempt
    // it, and the dead-CSS check would be a check with an editable answer.
    const declaredTypeClasses = [...classesInCss].filter((c) => TYPE_CLASSES.has(c)).sort()
    expect(declaredTypeClasses).toEqual([...TYPE_CLASSES].sort())
    expect(TYPE_CLASSES.size).toBe(15)
  })
})

/* ── Declared and not yet used ────────────────────────────────────────────── */

/**
 * A token nothing references is either about to be wrong or already is.
 *
 * Not all of them can be removed. `--surface` and `--surface-2` are the product
 * contract the architecture inventory reads; `on-secondary`, `on-tertiary`,
 * `on-warning` and `on-success` are the filled halves of families whose
 * container halves ARE used, and a half-declared family is how somebody in a
 * hurry ends up writing a hex. So the set is recorded with a reason each, and
 * the assertion is a SUBSET check with a cap: referencing one of these breaks
 * nothing, and declaring a thirteenth reds the build.
 */
const DECLARED_NOT_REFERENCED = new Map([
  ["--md-sys-color-on-background", "the page background carries no text of its own; `main` sits on a surface"],
  ["--md-sys-color-on-secondary", "the filled half of the secondary family. Only the container half is used"],
  ["--md-sys-color-on-tertiary", "the filled half of the tertiary family. Only the container half is used"],
  ["--md-sys-color-on-warning", "the filled half of the warning family. Only the container half is used"],
  ["--md-sys-color-on-success", "the filled half of the success family. Only the container half is used"],
  ["--md-sys-color-tertiary", "declared for its container and its on-colour; nothing is filled tertiary yet"],
  ["--md-sys-color-surface-bright", "Material's brightest surface. This console's ladder is the containers"],
  // `--md-sys-color-surface-dim` was here and is gone: `.console-rail` paints it
  // now. The rail is the plane BELOW the page in the neutral family, which is
  // what this role has always meant and what nothing in the console had ever
  // needed while the page was #000 and there was nothing below it.
  ["--md-sys-state-pressed", "the pre-composited pressed layer. New work uses the opacity token instead"],
  ["--md-sys-type-mono", "declared before the one monospace rule that exists, which spells its own stack"],
  ["--surface", "product contract: SHARED_TOKENS and the architecture inventory read this name"],
  ["--surface-2", "product contract, as above"],
])

test("no token is declared without either a consumer or a recorded reason", () => {
  const declared = new Set([...css.matchAll(/^\s*(--[\w-]+)\s*:\s*[^;]+;/gm)].map((m) => m[1]))

  // `[,)]`, not `)`. The old pattern required the closing paren to follow the
  // name immediately, so `var(--console-nav-offset, 9rem)` — a reference WITH A
  // FALLBACK, which is the careful way to write one — matched nothing. Every
  // token used defensively read as dead, and the only reason that stayed hidden
  // is that the shell was the first code to use fallbacks at all.
  //
  // Across every stylesheet, not just `globals.css`: see `allStylesheets`.
  const referenced = new Set(
    [...allStylesheets.matchAll(/var\(\s*(--[\w-]+)\s*[,)]/g)].map((m) => m[1]),
  )

  const unreferenced = [...declared].filter((name) => !referenced.has(name)).sort()
  const unrecorded = unreferenced.filter((name) => !DECLARED_NOT_REFERENCED.has(name))

  expect(
    unrecorded,
    "These tokens are declared and reached by nothing. Either use one, or record it in " +
      "DECLARED_NOT_REFERENCED with the reason it exists anyway.",
  ).toEqual([])

  // A cap rather than an exact match, so referencing one of the recorded eleven
  // does not red a test. It may only fall — and it just did, from twelve, when
  // the rail started painting `surface-dim`.
  expect(DECLARED_NOT_REFERENCED.size).toBeLessThanOrEqual(11)
})
