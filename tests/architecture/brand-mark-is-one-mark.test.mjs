import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

/**
 * The Tenure rosette is one mark, drawn in two apps.
 *
 * `apps/web` and `apps/system-studio` are deliberately separate origins
 * (PD-007) with separate builds, and `shell-separation.test.mjs` asserts that
 * neither imports the other's source. So the mark cannot be a shared component
 * today, and it is a duplicated path in two files.
 *
 * A duplicated brand asset is exactly the thing nobody notices going wrong: the
 * two drift by a control point, and the console's logo is subtly not the
 * product's logo in a way that reads as a rendering bug rather than as an edit.
 * This makes that a failing build instead.
 *
 * The right long-term home is a `packages/brand` workspace both apps depend on,
 * at which point this test is deleted along with the duplication. Until then it
 * is what keeps "one mark" true.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

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
