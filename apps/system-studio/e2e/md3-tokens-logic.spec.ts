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
import { AA_THRESHOLD, composite, contrastRatio, parseColor } from "../../web/src/lib/a11y/contrast"

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

const md3Files = fs
  .readdirSync(MD3_DIR)
  // Sorted, because a directory listing is not ordered and this list reaches an
  // assertion message. `readdirSync` order differs between filesystems, which is
  // how a test's output becomes machine-dependent.
  .filter((name) => /\.tsx?$/.test(name))
  .sort()

test.describe("a component may not contain a colour", () => {
  test("the directory being scanned is the real one", () => {
    // An absence check over an empty list passes on every input.
    expect(md3Files.length, "components/md3 has stopped being read").toBeGreaterThanOrEqual(6)
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
    }
    expect(
      offences,
      "A colour in a component is a pair the contrast audit above does not know exists, in the " +
        "file it is least likely to be pointed at. Name a --md-sys-color-* role instead.",
    ).toEqual([])
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
  ["--md-sys-color-surface-dim", "Material's dimmest surface. Same"],
  ["--md-sys-state-pressed", "the pre-composited pressed layer. New work uses the opacity token instead"],
  ["--md-sys-type-mono", "declared before the one monospace rule that exists, which spells its own stack"],
  ["--surface", "product contract: SHARED_TOKENS and the architecture inventory read this name"],
  ["--surface-2", "product contract, as above"],
])

test("no token is declared without either a consumer or a recorded reason", () => {
  const declared = new Set([...css.matchAll(/^\s*(--[\w-]+)\s*:\s*[^;]+;/gm)].map((m) => m[1]))
  const referenced = new Set([...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]))

  const unreferenced = [...declared].filter((name) => !referenced.has(name)).sort()
  const unrecorded = unreferenced.filter((name) => !DECLARED_NOT_REFERENCED.has(name))

  expect(
    unrecorded,
    "These tokens are declared and reached by nothing. Either use one, or record it in " +
      "DECLARED_NOT_REFERENCED with the reason it exists anyway.",
  ).toEqual([])

  // A cap rather than an exact match, so referencing one of the recorded twelve
  // does not red a test. It may only fall.
  expect(DECLARED_NOT_REFERENCED.size).toBeLessThanOrEqual(12)
})
