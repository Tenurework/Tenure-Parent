import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * The Tenure mark is one mark, and the Tenure wordmark is one wordmark, drawn
 * in two applications.
 *
 * `apps/web` and `apps/system-studio` are deliberately separate origins
 * (PD-007) with separate builds, and `shell-separation.test.mjs` asserts that
 * neither imports the other's source. So the brand cannot be a shared component
 * today, and it is duplicated across files.
 *
 * A duplicated brand asset is exactly the thing nobody notices going wrong: the
 * two drift, and the console's logo is subtly not the product's logo in a way
 * that reads as a rendering bug rather than as an edit. This makes that a
 * failing build instead.
 *
 * ## Two halves, and the second one is new
 *
 *   * THE MARK — the rosette. A single `PETAL` path rotated through six 60°
 *     positions about the centre of a 32x32 box. Duplicated verbatim, compared
 *     verbatim.
 *   * THE WORDMARK — the mark beside the WORD "Tenure", set in the product's
 *     own type at 0.85x the mark, semibold, tight tracking, with the gap the
 *     brand uses. This half went wrong in exactly the way the paragraph above
 *     predicts: the console drew the letters as `<path>` outlines on a 32-unit
 *     grid — a monoline capital "TENURE" that is not Tenure's wordmark — while
 *     every assertion about the mark stayed green, because the rosette was
 *     never the part that had drifted.
 *
 *     So the wordmark's PARAMETERS are compared rather than its markup: the two
 *     apps cannot share a component, but they can be held to the same numbers.
 *     `apps/web` writes them as Tailwind classes and a `fontSize` expression;
 *     `apps/system-studio` writes them as named constants in a 32-unit grid
 *     because it composes one `<svg>` (see the header of `md3/Logo.tsx` for why
 *     it must). Both are read here and resolved to the same units.
 *
 * The right long-term home is a `packages/brand` workspace both apps depend on,
 * at which point this test is deleted along with the duplication. Until then it
 * is what keeps "one brand" true.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")
const require = createRequire(import.meta.url)

const COPIES = [
  "apps/web/src/components/brand/TenureLogo.tsx",
  "apps/system-studio/src/components/brand/TenureLogo.tsx",
]

/** The petal path, whether it is written as a bare const or exported. */
function petalOf(file) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8")
  const match = /const PETAL = "([^"]+)"/.exec(source)
  assert.ok(
    match,
    `${file} does not declare a PETAL path this test can read. If the mark was rewritten, ` +
      `rewrite this guard with it — do not leave it matching nothing, because a matcher that ` +
      `finds nothing reports agreement.`,
  )
  return match[1]
}

test("both apps carry the mark this test knows how to read", () => {
  // Every assertion below compares two strings, and two missing strings compare
  // equal. This is what stops that passing.
  for (const file of COPIES) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} does not exist`)
    const petal = petalOf(file)
    assert.ok(petal.length > 20, `${file}'s PETAL is ${petal.length} characters — too short to be the path`)
    assert.ok(petal.startsWith("M"), `${file}'s PETAL does not start with a moveto`)
  }
})

test("the two copies of the rosette are the same rosette", () => {
  const [web, studio] = COPIES.map(petalOf)

  assert.equal(
    studio,
    web,
    `The Tenure mark differs between the two apps.\n` +
      `  ${COPIES[0]}\n    ${web}\n` +
      `  ${COPIES[1]}\n    ${studio}\n` +
      `One of them was edited and the other was not. The rosette is the same mark in the product ` +
      `and in the deployment engine; if it is being redrawn, redraw both in the same change.`,
  )
})

test("both draw it as six petals about the same centre", () => {
  // The path alone is not the mark: the same petal rotated five times, or about
  // a different centre, is a different logo built from an identical string.
  for (const file of COPIES) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8")

    const rotations = /\[0, 60, 120, 180, 240, 300\]/.test(source)
    assert.ok(rotations, `${file} does not rotate the petal through the six 60° positions`)

    const centre = /rotate\(\$\{r\} 16 16\)/.test(source)
    assert.ok(centre, `${file} does not rotate about the 16,16 centre of its 32x32 viewBox`)

    assert.ok(
      /viewBox="0 0 32 32"/.test(source),
      `${file} does not use the 32x32 viewBox the petal's coordinates are drawn for`,
    )
  }
})

/* ── The wordmark ─────────────────────────────────────────────────────────── */

/**
 * The tenant application's wordmark, and the console's.
 *
 * The console's is in `md3/` rather than beside its `brand/TenureLogo.tsx`,
 * because that is where the console's design-system primitives live and where
 * the no-literal-colour scan (`e2e/md3-tokens-logic.spec.ts`) reaches. It
 * imports `PETAL` from the brand file above, which is what keeps it inside the
 * mark guarantee the first half of this file provides.
 */
const TENANT_WORDMARK = "apps/web/src/components/brand/TenureLogo.tsx"
const CONSOLE_WORDMARK = "apps/system-studio/src/components/md3/Logo.tsx"

const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8")

/** Source with comments stripped, so prose about the brand cannot satisfy a scan. */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/**
 * One capture, or a failure that says which file and what was being looked for.
 *
 * Every comparison below is between two extracted values, and two failed
 * extractions compare equal — `undefined === undefined`. This is what stops a
 * rewritten component reporting agreement with a component it no longer
 * resembles.
 */
function capture(file, pattern, what, source = read(file)) {
  const match = pattern.exec(source)
  assert.ok(
    match,
    `${file}: could not read ${what} (${pattern}). If the component was rewritten, rewrite this ` +
      `guard with it — a matcher that finds nothing reports agreement.`,
  )
  return match[1]
}

/**
 * `TenureWordmark`'s body alone.
 *
 * `TenureLogo` and `TenureAIMark` in the same file also declare a default
 * `size`, and a scan of the whole file would pick up whichever came first.
 */
function tenantWordmarkBody() {
  const source = read(TENANT_WORDMARK)
  const start = source.indexOf("export function TenureWordmark")
  assert.notEqual(
    start,
    -1,
    `${TENANT_WORDMARK} no longer exports TenureWordmark. That component IS the Tenure wordmark; ` +
      `if it moved, point this guard at where it moved to.`,
  )
  const rest = source.slice(start + 1)
  const end = rest.indexOf("export function")
  return rest.slice(0, end === -1 ? undefined : end)
}

/**
 * Tailwind's own scale, not a table typed out here.
 *
 * `font-semibold` and `tracking-tight` are values this repository inherits
 * rather than sets, so the honest way to compare them against the console's
 * numbers is to ask Tailwind what they are. A hand-copied 600/-0.025em would
 * be a third place the brand is written down.
 */
const tailwind = require("tailwindcss/defaultTheme")

/** Two decimals is finer than any of these ratios is specified to. */
const ratio = (n) => Number(n.toFixed(4))

test("the tenant wordmark is read, and the classes it uses mean what this test thinks", () => {
  // The floor for the whole block: an unreadable tenant component, or a
  // Tailwind config that redefines the utilities it uses, makes every
  // comparison below meaningless in a way that still passes.
  const body = tenantWordmarkBody()
  assert.match(body, /className=\{`font-semibold tracking-tight/)
  assert.match(body, /className="inline-flex items-center gap-\d+"/)
  assert.match(body, />\s*Tenure\s*</)

  assert.equal(tailwind.fontWeight.semibold, "600")
  assert.equal(tailwind.letterSpacing.tight, "-0.025em")
  assert.equal(tailwind.spacing["2"], "0.5rem")

  // And the app does not redefine them. `extend` cannot change an existing key
  // for a utility that is already generated from the default scale, but a
  // top-level `theme.letterSpacing` replaces it outright.
  const config = withoutComments(read("apps/web/tailwind.config.ts"))
  const overrides = ["letterSpacing", "fontWeight", "spacing"].filter((key) =>
    new RegExp(`^\\s{4}${key}\\s*:`, "m").test(config),
  )
  assert.deepEqual(
    overrides,
    [],
    `apps/web/tailwind.config.ts replaces ${overrides.join(", ")} at the top level of theme, so ` +
      `Tailwind's default scale is no longer what those class names mean here.`,
  )
})

test("both apps set the same word", () => {
  const tenant = capture(TENANT_WORDMARK, />\s*(Tenure)\s*</, "the word it sets", tenantWordmarkBody())
  const studio = capture(CONSOLE_WORDMARK, /const WORD = "([^"]+)"/, "the word it sets")
  assert.equal(studio, tenant)
  assert.equal(studio, "Tenure")
})

test("both apps set the word at 0.85 of the mark", () => {
  const tenant = Number(
    capture(
      TENANT_WORDMARK,
      /fontSize:\s*size\s*\*\s*([\d.]+)/,
      "the wordmark's size ratio",
      tenantWordmarkBody(),
    ),
  )
  // The console works in the mark's own 32-unit grid, because one `<svg>` gets
  // its proportions from geometry rather than from a style attribute it is not
  // allowed to write.
  const markBox = Number(capture(CONSOLE_WORDMARK, /const MARK_BOX = ([\d.]+)/, "the mark's box"))
  const wordSize = Number(capture(CONSOLE_WORDMARK, /const WORD_SIZE = ([\d.]+)/, "the word's size"))

  assert.equal(
    ratio(wordSize / markBox),
    ratio(tenant),
    `The console sets the wordmark at ${ratio(wordSize / markBox)}x the mark; the tenant app sets ` +
      `it at ${tenant}x. The proportion is the brand's, not either app's.`,
  )
})

test("both apps set the same weight and the same tracking", () => {
  const weight = Number(capture(CONSOLE_WORDMARK, /const WORD_WEIGHT = (\d+)/, "the word's weight"))
  const tracking = capture(CONSOLE_WORDMARK, /const WORD_TRACKING = "([^"]+)"/, "the word's tracking")

  assert.equal(
    String(weight),
    tailwind.fontWeight.semibold,
    `The tenant wordmark is font-semibold (${tailwind.fontWeight.semibold}); the console sets ${weight}.`,
  )
  assert.equal(
    tracking,
    tailwind.letterSpacing.tight,
    `The tenant wordmark is tracking-tight (${tailwind.letterSpacing.tight}); the console sets ${tracking}.`,
  )
})

test("the gap between mark and word is the same fraction of the mark", () => {
  const body = tenantWordmarkBody()
  // `gap-2` is 0.5rem — a FIXED length beside a mark whose size is a prop, so
  // the ratio the brand was drawn at is the one at this component's own default
  // size. A single `<svg>` scales as a whole and cannot hold one length fixed
  // while the rest of it grows, so the ratio is what the console carries over.
  const gapStep = capture(TENANT_WORDMARK, /className="inline-flex items-center gap-(\d+)"/, "the gap", body)
  const gapRem = Number.parseFloat(tailwind.spacing[gapStep])
  assert.ok(gapRem > 0, `Tailwind has no spacing step ${gapStep}`)
  const gapPx = gapRem * 16
  const defaultSize = Number(capture(TENANT_WORDMARK, /size = (\d+)/, "its default size", body))

  const markBox = Number(capture(CONSOLE_WORDMARK, /const MARK_BOX = ([\d.]+)/, "the mark's box"))
  const gapUnits = Number(
    capture(CONSOLE_WORDMARK, /const WORD_X = MARK_BOX \+ ([\d.]+)/, "the gap before the word"),
  )

  assert.equal(
    ratio(gapUnits / markBox),
    ratio(gapPx / defaultSize),
    `The console opens ${ratio(gapUnits / markBox)}x the mark before the word; the tenant app's ` +
      `gap-${gapStep} is ${ratio(gapPx / defaultSize)}x its ${defaultSize}px default.`,
  )
})

test("the console sets the word as TEXT, and draws no letterform anywhere", () => {
  /*
    The defect this whole half exists for, asserted directly.

    `md3/Logo.tsx` used to carry a `WORDMARK` array of six path strings —
    "M0 8H13M6.5 8V24" and five more — drawn on the mark's grid and stroked at 3
    units. It rendered a monoline capital nobody at Tenure drew, and it read as
    almost-right, which is worse than plain text because it looks deliberate.

    Two properties, and the second is the one that survives a clever rewrite:
    the word reaches the document as an SVG `<text>` element, and there is no
    SVG path data written in the file at all. `PETAL` is imported, so any path
    literal here is by definition a new drawing.
  */
  const source = withoutComments(read(CONSOLE_WORDMARK))

  assert.match(
    source,
    /<text[\s\S]*?>\s*\{?\s*WORD\s*\}?\s*<\/text>/,
    `${CONSOLE_WORDMARK} does not set the word in an SVG <text> element.`,
  )

  const literals = [...source.matchAll(/"([^"]*)"/g)].map((m) => m[1])
  const pathData = literals.filter((s) => /^[Mm]\s*-?[\d.]/.test(s))
  assert.deepEqual(
    pathData,
    [],
    `${CONSOLE_WORDMARK} declares SVG path data: ${pathData.join(" | ")}. The rosette comes from ` +
      `PETAL in the brand file; a path drawn here is a letterform or a second rosette.`,
  )
})

test("the console's wordmark stays inside the mark guarantee", () => {
  // The first half of this file guards `brand/TenureLogo.tsx` against its twin.
  // That guard only covers the component operators actually see for as long as
  // that component IMPORTS the petal rather than pasting it.
  const source = withoutComments(read(CONSOLE_WORDMARK))
  assert.match(
    source,
    /import\s*\{[^}]*\bPETAL\b[^}]*\}\s*from\s*["']\.\.\/brand\/TenureLogo["']/,
    `${CONSOLE_WORDMARK} no longer imports PETAL from the guarded brand file, so the console's ` +
      `rosette is now free to drift from the product's.`,
  )
  assert.doesNotMatch(
    source,
    /\bconst\s+PETAL\b/,
    `${CONSOLE_WORDMARK} declares its own PETAL, shadowing the guarded one.`,
  )
})

test("neither copy hardcodes a colour", () => {
  // The mark is shared; the palette is not. `apps/web` resolves `--primary` and
  // the Studio resolves `--md-sys-color-primary`, and a literal in either would
  // be invisible to the contrast audits that read the token layers.
  for (const file of COPIES) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8")
    const literals = source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    assert.deepEqual(
      literals,
      [],
      `${file} carries ${literals.length} literal colour value(s): ${literals.join(", ")}. ` +
        `The default must be a token — the contrast audits read the stylesheet and cannot see a literal.`,
    )
  }
})
