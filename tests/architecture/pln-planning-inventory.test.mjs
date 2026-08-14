import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import {
  ANCHORS,
  BIBLE,
  OPERATOR_BUDGETS,
  ROOT,
  SCHEMA,
  bibleObjects,
  deriveCode,
  deriveObjectMapping,
  deriveTests,
  deriveUnguardedTotals,
  deriveWriters,
  readText,
  render,
  schemaModels,
} from "../../tools/pln-planning-inventory.mjs"

/**
 * PLN-000-001 — the inventory is a claim about the repository, so it is checked
 * against the repository.
 *
 * An inventory nobody re-derives is prose. Every table in
 * `docs/architecture/pln-planning-inventory.md` is generated from the tree by
 * `tools/pln-planning-inventory.mjs`, and this re-runs the generator and
 * compares the result byte-for-byte with the committed file. Add a budget
 * surface, delete one, add a `PlanningModel` to the schema, correct the false
 * "only writer" claim in the module manifest, or route one of the five
 * unguarded totals through `summarize()` — every one of those changes reds this
 * until the document is regenerated, which is the whole difference between an
 * inventory and a paragraph.
 *
 * Plain `node --test` at the repository root: no jest globals, no TypeScript.
 */

const DOC = "docs/architecture/pln-planning-inventory.md"

test("the committed inventory is what the tree derives", () => {
  assert.equal(
    readText(DOC),
    render(),
    `${DOC} is stale. Re-derive it with \`node tools/pln-planning-inventory.mjs\`.`,
  )
})

test("every inventoried path exists and still carries the anchor it was found by", () => {
  const rows = [...deriveCode(), ...deriveTests()]
  assert.ok(rows.length >= 20, `expected the sweep to find budget code, found ${rows.length} files`)
  const doc = readText(DOC)
  for (const row of rows) {
    assert.ok(fs.existsSync(path.join(ROOT, row.path)), `inventoried path does not exist: ${row.path}`)
    assert.ok(doc.includes(`\`${row.path}\``), `${row.path} is not named in ${DOC}`)
    const text = readText(row.path)
    for (const anchor of row.anchors) {
      assert.ok(ANCHORS.includes(anchor), `${row.path}: ${anchor} is not a declared anchor`)
      assert.ok(text.includes(anchor), `${row.path} no longer contains ${anchor}`)
    }
  }
})

/**
 * The correspondence the mapping in section 5 asserts, checked from both ends.
 *
 * The Bible names 36 objects; the schema declares its models. A row that says
 * "no" is only true while no model of that name exists, so this re-reads both
 * sides rather than trusting the table.
 */
test("the Bible-to-schema mapping agrees with both sides", () => {
  const objects = bibleObjects()
  assert.equal(objects.length, 36, "section 3 of the Bible no longer lists 36 canonical objects")
  const models = schemaModels()
  assert.ok(models.size > 30, `expected the tenant schema to declare models, found ${models.size}`)
  const doc = readText(DOC)
  for (const { name, present } of deriveObjectMapping()) {
    assert.equal(models.has(name), present, `${name}: schema and mapping disagree`)
    assert.ok(
      doc.includes(`| \`${name}\` | ${present ? "yes" : "**no**"} |`),
      `${name} is not stated in ${DOC} with the verdict the schema supports`,
    )
  }
})

/** The false claim this inventory exists to record, still false. */
test("the module manifest's 'only writer' claim still contradicts the writers", () => {
  const manifest = readText("modules/index.ts")
  const claim = "apps/web/src/lib/finance.ts is the only writer"
  assert.ok(
    manifest.includes(claim),
    `modules/index.ts no longer makes the claim this inventory records — regenerate ${DOC}`,
  )
  assert.ok(
    !/\bdb\.(budget|budgetLine|transaction)\.(create|update|upsert|delete)/.test(readText("apps/web/src/lib/finance.ts")),
    "finance.ts now writes a budget table, which would make the manifest's claim closer to true",
  )
  const writers = deriveWriters()
  assert.ok(writers.length > 1, "expected more than one writer of a budget table")
  assert.ok(
    !writers.some((w) => w.path === "apps/web/src/lib/finance.ts"),
    "finance.ts is now a writer — the recorded false claim needs re-checking",
  )
  // Section 3 specifically. Looking anywhere in the document would find the
  // same path in section 1 and pass while section 3 had lost the row.
  const doc = readText(DOC)
  const section = doc.slice(doc.indexOf("## 3."), doc.indexOf("## 4."))
  const listed = [...section.matchAll(/^\| `([^`]+)` \| /gm)].map((m) => m[1])
  assert.deepEqual(listed, writers.map((w) => w.path), "section 3 does not list exactly the derived writers")
})

/** The five unguarded totals, still unguarded and still listed. */
test("the unguarded totals are the ones the document lists", () => {
  const unguarded = deriveUnguardedTotals()
  assert.ok(unguarded.length > 0, "expected at least one unguarded total")
  const doc = readText(DOC)
  const section = doc.slice(doc.indexOf("## 4."), doc.indexOf("## 5."))
  for (const p of unguarded) assert.ok(section.includes(`- \`${p}\``), `${p} is missing from section 4`)
  const listed = [...section.matchAll(/^- `(.+)`$/gm)].map((m) => m[1])
  assert.deepEqual(listed, unguarded, "section 4 does not list exactly the derived set")
})

/** The one file named in prose rather than a table still exists and still forecasts. */
test("the operator-plane budget file is where the document says it is", () => {
  assert.ok(fs.existsSync(path.join(ROOT, OPERATOR_BUDGETS)), `${OPERATOR_BUDGETS} does not exist`)
  assert.match(readText(OPERATOR_BUDGETS), /forecast/i, `${OPERATOR_BUDGETS} no longer mentions a forecast`)
  assert.ok(readText(DOC).includes(`\`${OPERATOR_BUDGETS}\``), `${OPERATOR_BUDGETS} is not named in ${DOC}`)
})

/** The sources the derivation reads. A moved Bible or schema is a silent lie. */
test("the sources the inventory derives from exist", () => {
  for (const p of [BIBLE, SCHEMA, "modules/index.ts", DOC]) {
    assert.ok(fs.existsSync(path.join(ROOT, p)), `${p} does not exist`)
  }
})

/**
 * Byte-identical on Linux and Windows.
 *
 * The generator normalises CRLF before matching and reads directories in
 * `sort()` order, so the rendered document must not depend on either. This
 * asserts the two properties that would otherwise make the committed file
 * "current here, stale in CI": no carriage return survives into the output, and
 * no absolute path does.
 */
test("the generated document is checkout-independent", () => {
  const raw = fs.readFileSync(path.join(ROOT, DOC), "utf8")
  assert.ok(!raw.includes("\r"), `${DOC} contains a carriage return`)
  assert.ok(!/[A-Za-z]:\\|\\\\/.test(raw), `${DOC} contains a native path`)
  assert.ok(!raw.includes(ROOT), `${DOC} contains an absolute path`)
  assert.equal(render(), render(), "the generator is not deterministic across two runs")
})
