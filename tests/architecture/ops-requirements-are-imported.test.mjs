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
 * OPS-000-004 — every `OPS-*` requirement is in the canonical ledger.
 *
 * The global ratchet in `document-graph.test.mjs` counts requirements that reach
 * NO execution document, and it is the right shape for the question it answers:
 * has a whole Bible been dropped. It is the wrong shape for this one, for the
 * three reasons `int-requirements-are-imported.test.mjs` sets out for INT and
 * which are not domain-specific:
 *
 *   * an `OPS-*` row that lands in somebody else's ledger. `importedIds()` is a
 *     union over every `*-ledger.md`, so an Operations requirement written into,
 *     say, the planning ledger is "imported" and the global count is unchanged —
 *     while the domain that owns it has no row to work.
 *   * a row whose id the Bible does not state. The unimported count only looks
 *     in one direction, so an invented `OPS-060-001` inflates a denominator
 *     nobody re-derives, and "how much Operations is left" stops adding up.
 *   * a duplicated id. Two rows for one requirement is two statuses, and the one
 *     the loop reads is whichever the parser saw last. That is not theoretical
 *     here: `a-ticked-box-is-a-passing-requirement.test.mjs` was written because
 *     `STUDIO-030-003` carried three rows and was ticked on the strength of one.
 *
 * So this compares the two sets in BOTH directions and pins the count. The count
 * assertion is not decoration: without it, a Bible edit that deletes ten
 * requirements and a ledger edit that deletes the same ten agree with each other
 * perfectly, and the pair reads as progress.
 *
 * Why it is a separate file from the INT one rather than a shared parameterised
 * helper: the numbers differ, the ledger paths differ, and the failure message a
 * reader needs names their own Bible. A shared helper would also mean one file
 * that every domain agent edits, which is precisely the shape this wave is
 * trying to avoid. The `ledgerIds` parser here is four lines and is proven
 * against synthetic input below.
 *
 * The Bible is read at its canonical path. The repository holds no `… (1).md`
 * alias for this one — `tools/duplicate-sources-doc.mjs` records the aliases —
 * but the path is named as a constant for the same reason INT names it: reading
 * an alias would make this pass from a file the document graph does not consider
 * authoritative.
 */

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8")

const OPS_BIBLE = "Tenure_Operations_Supply_Manufacturing_and_Service_Cloud_Claude_Bible_v1.0.md"

const OPS_LEDGER = "docs/implementation/operations-cloud-execution-ledger.md"

/**
 * The requirements the Bible states, in the graph's own reading of it.
 *
 * `requirementsIn` rather than a local regex, deliberately: two parsers of one
 * document will disagree, and the loop acts on that one's answer.
 */
function stated() {
  return requirementsIn(read(OPS_BIBLE))
    .map((r) => r.id)
    .filter((id) => id.startsWith("OPS-"))
    .sort()
}

/** Every `OPS-*` id the Operations ledger carries, in file order, with repeats. */
export function ledgerIds(text) {
  const out = []
  for (const line of text.split("\n")) {
    const m = /^- \[[ xX]\] \*\*(OPS-[A-Z0-9-]+)\*\*/.exec(line)
    if (m) out.push(m[1])
  }
  return out
}

test("the Operations Bible still states the requirements this pins", () => {
  const expected = stated()
  assert.equal(
    expected.length,
    32,
    `The Operations Bible states ${expected.length} OPS requirements, not 32. If a requirement was ` +
      `genuinely added or removed, import it and change this number in the same commit — a count ` +
      `that follows the document is not a check.`,
  )
})

test("every OPS requirement the Bible states has a row in the Operations ledger", () => {
  const expected = stated()
  const present = new Set(ledgerIds(read(OPS_LEDGER)))

  assert.deepEqual(
    expected.filter((id) => !present.has(id)),
    [],
    `An OPS requirement stated by the Bible has no row in ${OPS_LEDGER}. A requirement in no ` +
      `execution document is not failing — it is invisible, and invisible reads exactly like done.`,
  )
})

test("the Operations ledger invents no requirement and repeats none", () => {
  const expected = new Set(stated())
  const rows = ledgerIds(read(OPS_LEDGER))

  assert.deepEqual(
    rows.filter((id) => !expected.has(id)).sort(),
    [],
    `${OPS_LEDGER} carries an OPS id the Bible does not state. An invented row is a denominator ` +
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
    `${OPS_LEDGER} states an id twice. Two rows are two statuses, and the loop reads whichever the ` +
      `parser saw last.`,
  )
})

test("no other ledger claims an OPS requirement", () => {
  // The failure this catches is not a missing row, it is a row in the wrong
  // place: the global unimported count is a union, so an OPS row filed under
  // another domain reads as imported while the domain that owns it has nothing
  // to work.
  const ledger = ledgerStatuses()
  const misfiled = stated()
    .filter((id) => {
      const source = ledger.get(id)?.source_ledger
      return source !== undefined && source !== OPS_LEDGER
    })
    .sort()

  assert.deepEqual(misfiled, [], `An OPS requirement is filed in a ledger other than ${OPS_LEDGER}.`)
})

test("the generated registry owns exactly the OPS requirements the Bible states", () => {
  const expected = stated()
  const rows = buildRegistry(classify(), ledgerStatuses(), importedIds()).filter(
    (r) => r.prefix === "OPS",
  )

  assert.deepEqual(
    rows.map((r) => r.id).sort(),
    expected,
    "The capability registry must own exactly the OPS requirements stated by the Operations Bible.",
  )
  assert.deepEqual(
    rows.filter((r) => r.source_document !== OPS_BIBLE).map((r) => r.id),
    [],
    "Every OPS registry row must resolve back to the Operations Bible at its canonical path.",
  )
})

test("the detector reads ids rather than counting lines", () => {
  // Assembled here rather than read from the tree, so the parser is proven
  // against a shape it has never seen: a checked row, an unchecked row, another
  // domain's row, and prose that mentions an id without stating it.
  const sample = [
    "- [x] **OPS-000-001** — done",
    "- [ ] **OPS-000-002** — not done",
    "- [ ] **PLN-000-001** — another domain",
    "  - Reason: see OPS-000-001 for the inventory",
    "- [ ] **OPS-GATE-050** — a gate",
  ].join("\n")

  assert.deepEqual(ledgerIds(sample), ["OPS-000-001", "OPS-000-002", "OPS-GATE-050"])
})
