import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { ROOT, OUTPUT, derive, serialise, classify } from "../../tools/anl-analytics-inventory.mjs"

/**
 * ANL-000-001 — the analytics inventory is a claim about the repository, and
 * this is what makes it falsifiable.
 *
 * The requirement asks for an inventory of every dashboard, report, chart and
 * client-side metric, classified by source, owner and truth. An inventory is the
 * single easiest thing in this programme to fake: a plausible table assembled
 * from the Bible's own wording, naming code nobody has, reads exactly like a
 * survey somebody did. So the inventory is split in two and neither half is
 * trusted on its own.
 *
 *   * `docs/architecture/anl-analytics-inventory.json` is DERIVED, by
 *     `tools/anl-analytics-inventory.mjs`, from the source tree. This file
 *     re-derives it and demands byte equality — a committed artefact that
 *     disagrees with the tree it claims to describe is worse than none, because
 *     it is current on the machine that wrote it and stale everywhere else.
 *   * `docs/architecture/anl-analytics-inventory.md` is the CLASSIFICATION, and
 *     it must cover exactly the derived set. A chart added tomorrow reds this
 *     test until somebody says where its numbers come from.
 *
 * Both directions matter. Missing rows catch drift; surplus rows catch
 * invention, which is the failure mode the refuter looks for first — a path in
 * a table that nobody can open.
 */

const CLASSIFICATION = "docs/architecture/anl-analytics-inventory.md"

/** Every truth class the classification is allowed to use. */
const TRUTH_CLASSES = [
  "system-of-record",
  "derived-server",
  "derived-client",
  "polled",
  "presentation",
  "guard",
]

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n")

/**
 * Backticked strings in the classification that are repository paths.
 *
 * Deliberately anchored on the source roots: the Source column also names
 * modules the short way (`lib/aws/budgets`, `db.budgetLine`) and holding those
 * to `fs.existsSync` would report the whole document as invented.
 */
function citedPaths(markdown) {
  const out = new Set()
  for (const m of markdown.matchAll(/`((?:apps|packages|tools|tests|docs|infrastructure)\/[\w./()[\]@-]+)`/g)) {
    out.add(m[1])
  }
  return [...out].sort()
}

test("the committed inventory is what the tree derives, byte for byte", () => {
  // The failure this exists for is not "somebody forgot to re-run the
  // generator". It is the generated file that is checkout-dependent: sorted
  // with native separators, read in filesystem order, or hashed over raw CRLF,
  // so it is current on Windows and stale in CI and no single run ever tells
  // you which. Byte equality against a fresh derivation is the only assertion
  // that fails in both places.
  const derived = serialise(derive())
  const committed = read(OUTPUT)
  assert.equal(
    committed,
    derived,
    `${OUTPUT} disagrees with the tree. Re-run: node tools/anl-analytics-inventory.mjs`,
  )
})

test("the derivation actually found the analytics surface", () => {
  // Every assertion below passes trivially on an empty list. A scan that
  // matched nothing — a renamed directory, a token list edited to []- would
  // report a perfectly consistent, perfectly empty inventory.
  const inventory = derive()
  assert.ok(
    inventory.counts.artefacts >= 55,
    `Derived only ${inventory.counts.artefacts} analytics artefacts; the scan has stopped seeing the tree.`,
  )
  for (const kind of [
    "analytics-surface",
    "chart-kit",
    "chart-panel",
    "client-side-metric",
    "metric-endpoint",
    "metric-module",
  ]) {
    assert.ok(
      (inventory.counts.byKind[kind] ?? 0) > 0,
      `No artefact was classified \`${kind}\`, so that rule is no longer matching anything.`,
    )
  }
  // Both apps. The first version of this scan used tenant-side primitives only
  // and derived nine surfaces and zero operator ones, which made the FinOps
  // Center — the page somebody approves an Aurora cluster from — invisible to
  // an inventory whose whole claim was "every dashboard".
  for (const app of ["apps/web/src/", "apps/system-studio/src/"]) {
    assert.ok(
      inventory.artefacts.some((a) => a.id.startsWith(app)),
      `No artefact under ${app}; the inventory covers one app and claims to cover the platform.`,
    )
  }
})

test("every artefact the inventory names is a file somebody can open", () => {
  const missing = derive()
    .artefacts.map((a) => a.id)
    .filter((id) => !fs.existsSync(path.join(ROOT, id)))
  assert.deepEqual(missing, [], "The inventory names paths that do not exist.")
})

test("every artefact carries an owner the ownership map recognises", () => {
  // Owner is joined from tools/ownership-map.mjs rather than decided here, so
  // the failure this catches is the join silently returning nothing — every row
  // reading `(shared)`, which is a real answer for a design-system file and a
  // lie for the other sixty.
  const artefacts = derive().artefacts
  const unowned = artefacts.filter((a) => a.owner === "(shared)").map((a) => a.id)
  assert.ok(
    unowned.length <= 3,
    `${unowned.length} artefacts have no owning domain: ${unowned.join(", ")}. The ownership join has broken.`,
  )
  assert.ok(
    new Set(artefacts.map((a) => a.owner)).size >= 4,
    "Every artefact resolved to the same owner; the ownership join is not reading the map.",
  )
})

test("the classification covers exactly the artefacts the tree derives", () => {
  const markdown = read(CLASSIFICATION)
  const derived = derive().artefacts.map((a) => a.id)

  const unclassified = derived.filter((id) => !markdown.includes(`\`${id}\``))
  assert.deepEqual(
    unclassified,
    [],
    `${CLASSIFICATION} does not say where these artefacts' numbers come from. ` +
      "A new chart is not inventoried until somebody classifies its source and truth.",
  )
})

test("the classification invents nothing — every path it cites exists", () => {
  // The failure mode the refuter opens one path to find. A plausible table
  // describing code nobody has passes every other check in this file.
  const markdown = read(CLASSIFICATION)
  const cited = citedPaths(markdown)
  assert.ok(cited.length >= 55, `Only ${cited.length} repository paths cited; the table shape has changed.`)
  const missing = cited.filter((p) => !fs.existsSync(path.join(ROOT, p)))
  assert.deepEqual(missing, [], `${CLASSIFICATION} cites paths that do not exist.`)
})

test("the classification uses only the truth vocabulary it declares", () => {
  const markdown = read(CLASSIFICATION)
  // Truth classes are written in backticks in the tables and in the vocabulary
  // section. Any backticked lowercase-hyphenated word in a table cell that
  // looks like a class but is not one is a category somebody invented.
  const used = new Set()
  for (const m of markdown.matchAll(/\|\s*`([a-z][a-z-]+)`\s*\|/g)) used.add(m[1])
  assert.ok(used.size > 0, "No truth class was read out of the classification; the table shape has changed.")
  const unknown = [...used].filter((c) => !TRUTH_CLASSES.includes(c)).sort()
  assert.deepEqual(unknown, [], `Truth classes outside the declared vocabulary: ${unknown.join(", ")}`)
  // And the vocabulary is exercised: a document that only ever says
  // `presentation` has classified nothing.
  assert.ok(used.size >= 4, `Only ${used.size} distinct truth classes used; the classification is not discriminating.`)
})

test("the two surfaces the scan admits it misses are named and real", () => {
  // ANL-040-005 asks for published limitations, and a limitation that names no
  // path is an apology. These two count with `.filter(...).length`, a shape too
  // common to classify on, so they are carried by hand — and held to existing.
  const markdown = read(CLASSIFICATION)
  for (const known of [
    "apps/system-studio/src/app/page.tsx",
    "apps/system-studio/src/app/platform/security/page.tsx",
  ]) {
    assert.ok(markdown.includes(`\`${known}\``), `${CLASSIFICATION} no longer names the known rule-miss ${known}.`)
    assert.ok(fs.existsSync(path.join(ROOT, known)), `${known} no longer exists; the stated limitation is stale.`)
  }
})

test("the classifier fires on real shapes and abstains on ordinary code", () => {
  // Exercised directly, because every assertion above is about a list this
  // function produces. A classifier that returned an artefact for every file,
  // or for none, would look identical in CI.
  assert.equal(classify("apps/web/src/components/charts/BarChart.tsx", "const a = 1")?.kinds[0], "chart-kit")
  assert.equal(classify("apps/web/src/lib/util.ts", "export const x = 1"), null)
  // A test is evidence about an artefact, never one.
  assert.equal(classify("apps/web/src/components/charts/palette.test.ts", "x"), null)
  assert.equal(classify("apps/web/src/app/(app)/x/money-path.itest.ts", "db.a.count()"), null)
  // A route that asks the database for a count is publishing a metric.
  assert.ok(
    classify("apps/web/src/app/api/x/route.ts", "db.a.count({})").kinds.includes("metric-endpoint"),
  )
  // A page that folds rows into a total in plain JavaScript is too.
  assert.ok(
    classify("apps/web/src/app/(app)/x/page.tsx", "rows.reduce((n, r) => n + 1, 0)").kinds.includes(
      "analytics-surface",
    ),
  )
  // Unit formatting is not a metric. This is the rule that used to classify an
  // attachment chip's `${Math.round(n / 1024)} KB` as one.
  assert.equal(classify("apps/web/src/components/X.tsx", '"use client"\nMath.round(n / 1024)'), null)
})
