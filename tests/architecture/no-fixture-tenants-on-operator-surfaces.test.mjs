import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import { test } from "node:test"

/**
 * A fixture tenant must never be rendered as a customer.
 *
 * `TENANT_BINDINGS` is every configured system, and three of the four in it
 * exist to exercise the platform rather than to serve anybody: `midtown-arts`,
 * `fixture-rtl` and `fixture-external-erp`. The System Studio's index mapped
 * over the whole list, so the console that runs the estate reported "4
 * configured" and drew three organisations that do not exist beside the one
 * real pilot, with nothing distinguishing them.
 *
 * That is not cosmetic. The index is where an operator decides to open a
 * tenant, advance its lifecycle or publish its configuration. A fixture
 * rendered as a customer is an invitation to act on one, and "Midtown Arts
 * Collective" reads exactly like a small charity — which is why the guard below
 * is not allowed to work by matching names.
 *
 * ## Why this reads source text
 *
 * The alternative is rendering the page and asserting on its DOM, which the
 * Studio Playwright suite already does for what IS shown. This asserts the
 * weaker, cheaper and more durable property: that no operator-facing module
 * reaches for the unfiltered list at all. A page that filters correctly today
 * and is edited tomorrow fails here at once, without a browser.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")

/**
 * Operator-facing source. Tests, fixtures and the blueprints package itself are
 * excluded: the package DECLARES the bindings and the suites deliberately reach
 * fixtures by slug, which is the whole reason they stay resolvable.
 */
const OPERATOR_ROOTS = ["apps/system-studio/src"]

const IS_TEST = /\.(test|itest|spec)\.tsx?$/

function operatorFiles() {
  const files = OPERATOR_ROOTS.flatMap((root) =>
    execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", root], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean),
  )
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => !IS_TEST.test(f))

  // Every assertion below is an absence, and an absence over an empty list is
  // not a finding. This is what tells the two apart.
  assert.ok(
    files.length > 40,
    `scanned ${files.length} operator source files, expected more than 40 — the listing is broken, not the code`,
  )
  return files
}

/** Comments stripped: a name discussed in prose is not a name rendered. */
const code = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n")

/**
 * The bindings, read as source.
 *
 * Parsed rather than imported for the reason every guard in this directory is:
 * the suite runs under `node --test` with no TypeScript transform, so
 * `import("@tenure/blueprints")` cannot resolve. Reading the declaration is also
 * the stricter check — it sees what a reviewer sees.
 */
function declaredBindings() {
  const source = fs.readFileSync(path.join(ROOT, "blueprints/index.ts"), "utf8")
  const start = source.indexOf("export const TENANT_BINDINGS")
  assert.ok(start > -1, "TENANT_BINDINGS is not declared where this test expects it")

  const out = []
  // Each binding opens with its slug; `fixture: true` appears within the same
  // object, i.e. before the next slug line.
  const slugRe = /^\s*slug:\s*"([^"]+)",/gm
  const marks = [...source.slice(start).matchAll(slugRe)]
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].index
    const to = i + 1 < marks.length ? marks[i + 1].index : source.length - start
    const body = source.slice(start + from, start + to)
    out.push({ slug: marks[i][1], fixture: /^\s*fixture:\s*true,/m.test(body) })
  }
  assert.ok(out.length >= 4, `parsed ${out.length} bindings — the declaration shape has changed`)
  return out
}

test("the fixture flag is declared on exactly the bindings that are fixtures", () => {
  const bindings = declaredBindings()

  const fixtures = bindings.filter((t) => t.fixture).map((t) => t.slug).sort()
  const customers = bindings.filter((t) => !t.fixture).map((t) => t.slug).sort()

  // Pinned by name, in both directions. Adding a real customer must not require
  // editing this file; adding a FIXTURE must, which is the point — an unmarked
  // fixture is one that reaches the console.
  // `fixture-corporate` (GE-052-002) is the corporate generality fixture: the
  // company/region/business-unit/department/team spine and the purchase chain
  // that spends its money. Not a customer, and it must not reach the console.
  assert.deepEqual(fixtures, [
    "fixture-corporate",
    "fixture-external-erp",
    "fixture-rtl",
    "midtown-arts",
  ])
  assert.deepEqual(customers, ["rochester"])

  // And the two partition the whole list, so nothing can be in neither.
  assert.equal(fixtures.length + customers.length, bindings.length)
})

test("no operator-facing module lists the unfiltered bindings", () => {
  const offenders = []

  for (const file of operatorFiles()) {
    const text = code(fs.readFileSync(path.join(ROOT, file), "utf8"))
    // Importing the constant is the defect regardless of what is done with it:
    // the only reason to reach for the unfiltered list on an operator surface
    // is to render it.
    if (/\bTENANT_BINDINGS\b/.test(text)) {
      offenders.push(file)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these operator-facing modules read the UNFILTERED tenant bindings:\n  ${offenders.join("\n  ")}\n` +
      `That list contains fixtures — organisations that do not exist — and rendering them beside ` +
      `the real pilot is how somebody advances a lifecycle on one. Import ` +
      `CUSTOMER_TENANT_BINDINGS instead; the fixtures stay reachable by slug through ` +
      `getTenantBinding for the suites that need them.`,
  )
})

test("no operator-facing module names a fixture slug", () => {
  const fixtureSlugs = declaredBindings().filter((t) => t.fixture).map((t) => t.slug)

  assert.ok(fixtureSlugs.length > 0, "no fixture bindings found — this test would be vacuous")

  const offenders = []
  for (const file of operatorFiles()) {
    const text = code(fs.readFileSync(path.join(ROOT, file), "utf8"))
    for (const slug of fixtureSlugs) {
      // A placeholder attribute is the one legitimate use: `placeholder="midtown-arts"`
      // on the compose form shows the SHAPE of a slug and renders no data.
      const uses = text.split("\n").filter((l) => l.includes(slug) && !/placeholder=/.test(l))
      if (uses.length > 0) offenders.push(`${file} — ${uses[0].trim().slice(0, 90)}`)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these operator-facing modules name a FIXTURE tenant outside a placeholder attribute:\n  ${offenders.join("\n  ")}\n` +
      `A hard-coded fixture slug in the console is data about an organisation that does not exist.`,
  )
})
