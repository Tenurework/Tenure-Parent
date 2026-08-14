import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import {
  buildRegistry,
  classify,
  importedIds,
  ledgerStatuses,
  requirementsIn,
  ROOT,
} from "../../tools/document-graph.mjs"

/**
 * INT-000-003 — every `INT-*` requirement is in the canonical ledger.
 *
 * The global ratchet in `document-graph.test.mjs` counts requirements that
 * reach NO execution document, and it is the right shape for the question it
 * answers: has a whole Bible been dropped. It is the wrong shape for this one.
 * Three things it cannot see:
 *
 *   * an `INT-*` row that lands in somebody else's ledger. `importedIds()` is a
 *     union over every `*-ledger.md`, so an integration requirement written
 *     into, say, the payments ledger is "imported" and the global count is
 *     unchanged — while the domain that owns it has no row to work.
 *   * a row whose id does not exist in the Bible. The unimported count only
 *     looks in one direction; an invented `INT-000-006` inflates a denominator
 *     nobody re-derives.
 *   * a duplicated id. Two rows for one requirement means two statuses, and the
 *     one the loop reads is whichever the parser saw last.
 *
 * So this compares the two sets in BOTH directions and pins the count, the same
 * way `document-graph.test.mjs` does for CAT and CFG. The count assertion is
 * not decoration: without it, a Bible edit that deletes ten requirements and a
 * ledger edit that deletes the same ten agree with each other perfectly.
 *
 * The Bible is read at its canonical path. The repository also holds a
 * byte-identical `… (1).md` copy, recorded in the document graph as an alias;
 * reading the alias would make this test pass from a file the graph does not
 * consider authoritative.
 */

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8")

const INT_BIBLE =
  "Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md"

const INT_LEDGER = "docs/implementation/integration-ecosystem-execution-ledger.md"

/**
 * The requirements the Bible states, in the graph's own reading of it.
 *
 * `requirementsIn` rather than a local regex, deliberately: two parsers of one
 * document will disagree, and the loop acts on that one's answer.
 */
function stated() {
  return requirementsIn(read(INT_BIBLE))
    .map((r) => r.id)
    .filter((id) => id.startsWith("INT-"))
    .sort()
}

/** Every `INT-*` id the integration ledger carries, in file order, with repeats. */
export function ledgerIds(text) {
  const out = []
  for (const line of text.split("\n")) {
    const m = /^- \[[ xX]\] \*\*(INT-[A-Z0-9-]+)\*\*/.exec(line)
    if (m) out.push(m[1])
  }
  return out
}

test("the integration Bible still states the requirements this pins", () => {
  const expected = stated()
  assert.equal(
    expected.length,
    65,
    `The integration Bible states ${expected.length} INT requirements, not 65. If a requirement ` +
      `was genuinely added or removed, import it and change this number in the same commit — a ` +
      `count that follows the document is not a check.`,
  )
})

test("every INT requirement the Bible states has a row in the integration ledger", () => {
  const expected = stated()
  const rows = ledgerIds(read(INT_LEDGER))
  const present = new Set(rows)

  assert.deepEqual(
    expected.filter((id) => !present.has(id)),
    [],
    `An INT requirement stated by the Bible has no row in ${INT_LEDGER}. A requirement in no ` +
      `execution document is not failing — it is invisible, and invisible reads exactly like done.`,
  )
})

test("the integration ledger invents no requirement and repeats none", () => {
  const expected = new Set(stated())
  const rows = ledgerIds(read(INT_LEDGER))

  assert.deepEqual(
    rows.filter((id) => !expected.has(id)).sort(),
    [],
    `${INT_LEDGER} carries an INT id the Bible does not state. An invented row is a denominator ` +
      `nobody can re-derive.`,
  )

  const seen = new Set()
  const duplicated = []
  for (const id of rows) {
    if (seen.has(id)) duplicated.push(id)
    seen.add(id)
  }
  assert.deepEqual(
    duplicated,
    [],
    `${INT_LEDGER} states an id twice. Two rows are two statuses, and the loop reads whichever ` +
      `the parser saw last.`,
  )
})

test("no other ledger claims an INT requirement", () => {
  // The failure this catches is not a missing row, it is a row in the wrong
  // place: the global unimported count is a union, so an INT row filed under
  // another domain reads as imported while the domain that owns it has nothing
  // to work.
  const ledger = ledgerStatuses()
  const misfiled = stated()
    .filter((id) => {
      const source = ledger.get(id)?.source_ledger
      return source !== undefined && source !== INT_LEDGER
    })
    .sort()

  assert.deepEqual(
    misfiled,
    [],
    `An INT requirement is filed in a ledger other than ${INT_LEDGER}.`,
  )
})

test("the generated registry owns exactly the INT requirements the Bible states", () => {
  const expected = stated()
  const rows = buildRegistry(classify(), ledgerStatuses(), importedIds()).filter(
    (r) => r.prefix === "INT",
  )

  assert.deepEqual(
    rows.map((r) => r.id).sort(),
    expected,
    "The capability registry must own exactly the INT requirements stated by the integration Bible.",
  )
  assert.deepEqual(
    rows.filter((r) => r.source_document !== INT_BIBLE).map((r) => r.id),
    [],
    "Every INT registry row must resolve back to the integration Bible at its canonical path.",
  )
})

test("the detector reads ids rather than counting lines", () => {
  // Assembled here rather than read from the tree, so the parser is proven
  // against a shape it has never seen: a checked row, an unchecked row, a
  // non-INT row and prose that mentions an id without stating it.
  const sample = [
    "- [x] **INT-000-001** — done",
    "- [ ] **INT-000-002** — not done",
    "- [ ] **CAT-000-001** — another domain",
    "  - Reason: see INT-000-001 for the inventory",
    "- [ ] **INT-GATE-000** — a gate",
  ].join("\n")

  assert.deepEqual(ledgerIds(sample), ["INT-000-001", "INT-000-002", "INT-GATE-000"])
})
