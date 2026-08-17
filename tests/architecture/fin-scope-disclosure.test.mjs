import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

import {
  CAPABILITY_ROWS,
  OUT,
  accountingBasis,
  collect,
  currencyFacts,
  exportsMatching,
  financeFiles,
  providerFacts,
  render,
  resolveRow,
  sourceFiles,
} from "../../tools/fin-scope-disclosure.mjs"
import { ROOT, SCHEMA, read } from "../../tools/fin-finance-surface.mjs"

/**
 * FIN-050-005 — the published limitations are the code's, and cannot go stale
 * quietly.
 *
 * A limitations page is the one document with an incentive to rot in both
 * directions: it over-disclaims once a capability lands, and it over-promises
 * once one is removed. So this asserts four different things, because any one of
 * them alone can be satisfied by a document that is wrong:
 *
 *   1. the committed file is what the generator produces now (`--check`);
 *   2. no row is CONTRADICTED — a claim the generator could not support;
 *   3. every AVAILABLE row is re-derived here, in process, against the module and
 *      the test it names, so a row cannot be available on the strength of a
 *      sentence;
 *   4. every NOT AVAILABLE row is re-derived too — its probes must still find
 *      nothing. This is the direction that matters most: the moment somebody
 *      lands revaluation or a period table, the corresponding limitation becomes
 *      false and this test reds until the document is regenerated.
 *
 * Plus the non-vacuity floor. A scanner that silently stops finding files reports
 * no contradictions and passes, which is the one way a guard like this fails
 * without saying so.
 */

const TOOL = path.join(ROOT, "tools/fin-scope-disclosure.mjs")

function document() {
  return fs.readFileSync(path.join(ROOT, OUT), "utf8").replace(/\r\n/g, "\n")
}

/** Rows of the capability table, as the document states them. */
function capabilityRows() {
  return document()
    .split("\n")
    .filter((l) => /^\| .+ \| (AVAILABLE|NOT AVAILABLE|CONTRADICTED) \|/.test(l))
    .map((l) => {
      const parts = l.split(" | ")
      return { capability: parts[0].replace(/^\| /, ""), state: parts[1] }
    })
}

test("the committed disclosure is what the generator produces now", () => {
  const result = spawnSync(process.execPath, [TOOL, "--check"], { cwd: ROOT, encoding: "utf8" })
  assert.equal(
    result.status,
    0,
    `\`node tools/fin-scope-disclosure.mjs --check\` exited ${result.status}.\n${result.stdout}${result.stderr}`,
  )
  // And again in process, so a --check that stopped comparing is caught too.
  assert.equal(render(collect()), document())
})

test("the disclosure is not empty, and the scanner still finds the tree", () => {
  const files = sourceFiles()
  assert.ok(
    files.length > 500,
    `the scanner found ${files.length} source files. It found 1035 when this was written; a number ` +
      `near zero means every claim below is vacuous.`,
  )
  const rows = capabilityRows()
  assert.equal(
    rows.length,
    CAPABILITY_ROWS.length,
    `the document states ${rows.length} capability rows and the generator declares ` +
      `${CAPABILITY_ROWS.length}. One of the two is stale.`,
  )
  assert.ok(
    rows.filter((r) => r.state === "AVAILABLE").length >= 10,
    "fewer than 10 AVAILABLE rows: either capabilities were removed, or the table stopped being read.",
  )
  assert.ok(
    rows.filter((r) => r.state === "NOT AVAILABLE").length >= 8,
    "fewer than 8 NOT AVAILABLE rows. This document's job is the limitations; a version with none " +
      "is not a disclosure.",
  )
})

test("the probes can find something that is there", () => {
  // The positive control, and it is not optional. Every "NOT AVAILABLE" row in
  // this document is an assertion that a probe found NOTHING — so a probe that
  // returns nothing whatever the tree contains makes ten limitations vacuously
  // true and this file green while it checks nothing at all. This is the one test
  // that fails when the probe machinery breaks rather than when the code changes.
  const files = sourceFiles()
  const symbol = exportsMatching(/^trialBalance$/, files)
  assert.deepEqual(
    symbol.map((h) => h.path),
    ["packages/finops/src/general-ledger.ts"],
    "the exported-symbol probe cannot find `trialBalance`, which is exported from exactly one file. " +
      "Every NOT AVAILABLE row below is proven by a probe like this one finding nothing.",
  )
  const prose = financeFiles(files)
  assert.ok(
    prose.length > 40 && prose.length < files.length,
    `the finance-surface classifier selected ${prose.length} of ${files.length} files. It selected ` +
      `88 when this was written; all of them or none of them means it has stopped classifying.`,
  )
})

test("no capability row is CONTRADICTED", () => {
  const contradicted = capabilityRows().filter((r) => r.state === "CONTRADICTED")
  assert.deepEqual(
    contradicted.map((r) => r.capability),
    [],
    "A CONTRADICTED row is a claim the generator could not support — an AVAILABLE capability whose " +
      "module, test or export is missing, or a limitation something in the tree disproves. Fix the " +
      "claim or fix the code; do not publish either.",
  )
})

test("every AVAILABLE row is re-derived against the module and test it names", () => {
  const files = sourceFiles()
  const schema = read(SCHEMA)
  const wrong = []
  for (const row of CAPABILITY_ROWS.filter((r) => r.module)) {
    const resolved = resolveRow(row, files, schema)
    if (resolved.state !== "AVAILABLE") wrong.push(`${row.capability} — ${resolved.evidence}`)
  }
  assert.deepEqual(
    wrong,
    [],
    `these rows claim a capability whose evidence does not hold:\n  ${wrong.join("\n  ")}`,
  )
})

test("every NOT AVAILABLE row still finds nothing", () => {
  // The direction that catches a stale disclosure: a limitation that has since
  // been fixed. It must red here rather than stand in the document.
  const files = sourceFiles()
  const schema = read(SCHEMA)
  const stale = []
  for (const row of CAPABILITY_ROWS.filter((r) => r.absent)) {
    const resolved = resolveRow(row, files, schema)
    if (resolved.state !== "NOT AVAILABLE") stale.push(`${row.capability} — ${resolved.evidence}`)
  }
  assert.deepEqual(
    stale,
    [],
    `these limitations are no longer true:\n  ${stale.join("\n  ")}\n` +
      `Regenerate the disclosure — \`node tools/fin-scope-disclosure.mjs\` — and update the ledger row.`,
  )
})

test("every path the disclosure cites is a path that exists", () => {
  // The failure mode of a generated document that names files: a rename leaves
  // the citation pointing at nothing, and a reader cannot tell an absent file
  // from an absent capability.
  const cited = [...document().matchAll(/`([\w./[\]()@-]+\.(?:ts|tsx|mjs|md|prisma))`/g)].map((m) => m[1])
  assert.ok(cited.length > 20, `only ${cited.length} paths cited; the citation reader is broken.`)
  const missing = [...new Set(cited)].filter((rel) => !fs.existsSync(path.join(ROOT, rel))).sort()
  assert.deepEqual(missing, [], `cited by ${OUT}, absent from the tree:\n  ${missing.join("\n  ")}`)
})

test("the provider figures come from a parser that found something", () => {
  const providers = providerFacts()
  assert.ok(providers !== null, `${"packages/payments/src/capability-registry.ts"} could not be read.`)
  assert.ok(
    providers.total >= 20,
    `${providers.total} capability leaves parsed out of the registry; it declares 31. A parser that ` +
      `finds nothing would report "0 of 0 transactable", which reads like an answer.`,
  )
  assert.ok(
    providers.transactableStates.length > 0,
    "no transactable states parsed out of STATES_REQUIRING_APPROVAL. This exact bug printed " +
      '"only in ;" into the first draft: the loose regex matched the EMPTY brackets of the ' +
      "`readonly CapabilityState[]` type annotation.",
  )
  assert.equal(
    providers.transactable,
    0,
    `${providers.transactable} payment capability leaf/leaves are in a transactable state. That is ` +
      `a real change — regenerate the disclosure, because §D says none are and the treasury ` +
      `limitations depend on it.`,
  )
})

test("no accounting basis is claimed while none is declared", () => {
  const basis = accountingBasis(sourceFiles())
  const text = document()
  if (basis.declarations.length === 0) {
    assert.match(
      text,
      /\*\*No accounting basis is declared anywhere in this platform\.\*\*/,
      "nothing in the code declares an accounting basis and §A does not say so plainly.",
    )
  } else {
    assert.doesNotMatch(
      text,
      /\*\*No accounting basis is declared anywhere in this platform\.\*\*/,
      `§A denies what the code declares: ${basis.declarations.map((d) => `${d.declaration} in ${d.path}`).join(", ")}.`,
    )
  }
})

test("the currency and tax claims match the code", () => {
  const currency = currencyFacts(sourceFiles())
  assert.deepEqual(
    currency.rateStore,
    [],
    `the schema now declares ${currency.rateStore.join(", ")}. §B says no stored exchange rate ` +
      `exists, and FIN-030-001's ledger row is blocked on exactly that; both need updating.`,
  )
  assert.ok(
    currency.currencyFields.length >= 5,
    `${currency.currencyFields.length} models carry a currency field; §B names them and there were 7.`,
  )
  const taxDetermination = exportsMatching(
    /^(taxRate|determineTax|taxJurisdiction|vatRate|salesTax)$/,
    sourceFiles(),
  )
  assert.deepEqual(
    taxDetermination.map((h) => `${h.path}:${h.line} ${h.name}`),
    [],
    "something now determines tax. §C says nothing does, which would make the published " +
      "jurisdiction scope wrong in the one direction that matters.",
  )
})
