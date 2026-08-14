import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { ROOT, configurationModules, trackedFiles } from "../../tools/cfg-configuration-truth.mjs"

/**
 * CFG-000-003 — the disposition mapping is a mapping, not a paragraph.
 *
 * A mapping is a claim that two things correspond, and the only thing that
 * makes such a claim worth anything is a check that reds when one side gains an
 * entry the other lacks. Both directions matter and they fail differently:
 *
 *   * a module in the tree with no disposition is the failure that MATTERS —
 *     somebody adds a form and the plan silently stops covering the code;
 *   * a disposition for a module that no longer exists is the failure that
 *     PERSUADES — a table full of paths nobody can open reads exactly like a
 *     table full of paths that were verified.
 *
 * The left-hand side is derived by `configurationModules()`, which is also what
 * `docs/architecture/cfg-configuration-truth.md` (CFG-000-001) enumerates. One
 * derivation, deliberately: two answers to "what counts as configuration code"
 * would disagree within a month, and the disposition table would then be
 * complete against a set nobody else computes.
 */

const DOC = "docs/architecture/cfg-form-and-configuration-disposition.md"
const DISPOSITIONS = ["RETAIN", "REFACTOR", "MIGRATE", "RETIRE"]

const text = () => fs.readFileSync(path.join(ROOT, DOC), "utf8").replace(/\r\n/g, "\n")

/**
 * The disposition rows: `| \`path\` | WORD | why | \`evidence\` |`.
 *
 * Anchored on a four-column row whose second cell is one of the four words, so
 * the explanatory tables at the top of the document — which are also markdown
 * tables — cannot be mistaken for data.
 */
function rows(source = text()) {
  const out = []
  for (const m of source.matchAll(/^\| `([^`]+)` \| ([A-Z]+) \| ([^|]+) \| `([^`]+)` \|$/gm)) {
    out.push({ module: m[1], disposition: m[2], why: m[3].trim(), evidence: m[4] })
  }
  return out
}

test("every configuration module in the tree has a disposition", () => {
  const declared = new Set(rows().map((r) => r.module))
  const missing = configurationModules(trackedFiles()).filter((m) => !declared.has(m))
  assert.deepEqual(
    missing,
    [],
    `these form/configuration modules have no disposition in ${DOC}: ${missing.join(", ")}.\n` +
      `Add a row saying RETAIN, REFACTOR, MIGRATE or RETIRE, why, and something to open. ` +
      `A plan that does not cover the code is not a plan.`,
  )
})

test("every disposition names a module that exists", () => {
  const inTree = new Set(configurationModules(trackedFiles()))
  const orphans = rows()
    .map((r) => r.module)
    .filter((m) => !inTree.has(m))
  assert.deepEqual(
    orphans,
    [],
    `${DOC} gives a disposition to modules the derivation does not produce: ${orphans.join(", ")}. ` +
      `Either the file is gone, or it is not configuration code and the row is describing ` +
      `something nobody has.`,
  )
})

test("each row uses one of the four words and cites something openable", () => {
  const all = rows()
  assert.ok(all.length > 0, "no disposition rows parsed — the table format changed")

  const badWords = all.filter((r) => !DISPOSITIONS.includes(r.disposition))
  assert.deepEqual(badWords.map((r) => `${r.module}=${r.disposition}`), [], "unknown disposition")

  const thin = all.filter((r) => r.why.length < 40)
  assert.deepEqual(
    thin.map((r) => r.module),
    [],
    "a disposition with a one-clause reason is a decision nobody has to defend",
  )

  const unopenable = all.filter((r) => !fs.existsSync(path.join(ROOT, r.evidence)))
  assert.deepEqual(
    unopenable.map((r) => `${r.module} -> ${r.evidence}`),
    [],
    "these rows cite evidence that is not in the tree",
  )
})

test("no module is given two dispositions", () => {
  const seen = new Map()
  const duplicated = []
  for (const r of rows()) {
    if (seen.has(r.module) && seen.get(r.module) !== r.disposition) duplicated.push(r.module)
    seen.set(r.module, r.disposition)
  }
  assert.deepEqual(duplicated, [], "a module cannot be both")
})

test("the stated counts are the counts in the table", () => {
  const source = text()
  const all = rows(source)
  for (const word of DISPOSITIONS) {
    const actual = all.filter((r) => r.disposition === word).length
    const stated = new RegExp(`^\\| ${word} \\| (\\d+) \\|$`, "m").exec(source)
    assert.ok(stated, `the summary has no line for ${word}`)
    assert.equal(
      Number(stated[1]),
      actual,
      `the summary says ${stated[1]} ${word} rows and the table has ${actual}`,
    )
  }
  const total = /^\| \*\*Total\*\* \| \*\*(\d+)\*\* \|$/m.exec(source)
  assert.ok(total, "the summary has no total")
  assert.equal(Number(total[1]), all.length, "the stated total is not the number of rows")
})
