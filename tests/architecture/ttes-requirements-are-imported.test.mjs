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
 * TTES-000-003 — every `TTES-*` requirement the tenant-experience Bible states
 * has exactly one row, in the tenant-experience ledger, and that ledger states
 * nothing else.
 *
 * The rows already existed when this guard was written; what did not exist was
 * anything that would notice them leaving. That distinction is the whole point.
 * A completed import with no check over it is indistinguishable from an import
 * that quietly lost ten rows six commits later, because the number nobody
 * re-derives is the number everybody trusts.
 *
 * `document-graph.test.mjs` holds a global ratchet over requirements that reach
 * NO execution document. It is the right shape for "has a whole Bible been
 * dropped" and the wrong shape for this question, in three ways this file fixes,
 * the same three `int-requirements-are-imported.test.mjs` fixes for INT:
 *
 *   * a `TTES-*` row filed in ANOTHER domain's ledger is still "imported" to a
 *     union, so the global count does not move — while the domain accountable
 *     for it has no row to work and no status to decide.
 *   * an INVENTED id (a `TTES-000-005` the Bible never states) only inflates the
 *     denominator; the unimported count looks in one direction only.
 *   * a DUPLICATED id is two rows and therefore two statuses, and the one
 *     `tools/loop/next-batch.mjs` acts on is whichever the parser read last.
 *
 * So the two sets are compared in BOTH directions, and the count is pinned. The
 * count is not decoration: a Bible edit deleting ten requirements and a ledger
 * edit deleting the same ten agree with each other perfectly, and only a literal
 * written down by a human disagrees with both.
 *
 * The Bible is read at its canonical path. The repository also carries a
 * `… (1).md` copy which the document graph records as an alias; reading the
 * alias would let this pass from a file the graph does not treat as
 * authoritative.
 */

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8")

const TTES_BIBLE = "Tenure_Tenant_Experience_System_and_Product_UIUX_Claude_Bible_v1.0.md"

const TTES_LEDGER = "docs/implementation/tenant-experience-execution-ledger.md"

/**
 * The requirements the Bible states, in the document graph's own reading of it.
 *
 * `requirementsIn` rather than a regex local to this file, deliberately: two
 * parsers of one document will eventually disagree, and the loop acts on that
 * one's answer, not on this one's.
 */
function stated() {
  return requirementsIn(read(TTES_BIBLE))
    .map((r) => r.id)
    .filter((id) => id.startsWith("TTES-"))
    .sort()
}

/** Every `TTES-*` id the ledger states as a row, in file order, with repeats. */
export function ledgerIds(text) {
  const out = []
  for (const line of text.split("\n")) {
    const m = /^- \[[ xX]\] \*\*(TTES-[A-Z0-9-]+)\*\*/.exec(line)
    if (m) out.push(m[1])
  }
  return out
}

test("the tenant-experience Bible still states the requirements this pins", () => {
  const expected = stated()
  assert.equal(
    expected.length,
    34,
    `The tenant-experience Bible states ${expected.length} TTES requirements, not 34. If one was ` +
      `genuinely added or removed, import it and change this number in the same commit — a count ` +
      `that follows the document it checks is not a check.`,
  )
})

test("every TTES requirement the Bible states has a row in the tenant-experience ledger", () => {
  const expected = stated()
  const present = new Set(ledgerIds(read(TTES_LEDGER)))

  assert.deepEqual(
    expected.filter((id) => !present.has(id)),
    [],
    `A TTES requirement stated by the Bible has no row in ${TTES_LEDGER}. A requirement in no ` +
      `execution document is not failing — it is invisible, and invisible reads exactly like done.`,
  )
})

test("the tenant-experience ledger invents no requirement and repeats none", () => {
  const expected = new Set(stated())
  const rows = ledgerIds(read(TTES_LEDGER))

  assert.deepEqual(
    rows.filter((id) => !expected.has(id)).sort(),
    [],
    `${TTES_LEDGER} carries a TTES id the Bible does not state. An invented row is a denominator ` +
      `nobody can re-derive, and it reads as progress the moment somebody ticks it.`,
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
    `${TTES_LEDGER} states an id twice. Two rows are two statuses, and the loop reads whichever ` +
      `the parser saw last.`,
  )
})

test("no other ledger claims a TTES requirement", () => {
  // Not a missing row — a row in the WRONG PLACE. The global unimported count is
  // a union over every `*-ledger.md`, so a TTES row filed under, say, the
  // payments ledger reads as imported while the tenant-experience domain has
  // nothing to work.
  const ledger = ledgerStatuses()
  const misfiled = stated()
    .filter((id) => {
      const source = ledger.get(id)?.source_ledger
      return source !== undefined && source !== TTES_LEDGER
    })
    .sort()

  assert.deepEqual(
    misfiled,
    [],
    `A TTES requirement is filed in a ledger other than ${TTES_LEDGER}.`,
  )
})

test("the generated registry owns exactly the TTES requirements the Bible states", () => {
  const expected = stated()
  const rows = buildRegistry(classify(), ledgerStatuses(), importedIds()).filter(
    (r) => r.prefix === "TTES",
  )

  assert.deepEqual(
    rows.map((r) => r.id).sort(),
    expected,
    "The capability registry must own exactly the TTES requirements stated by the tenant-experience Bible.",
  )
  assert.deepEqual(
    rows.filter((r) => r.source_document !== TTES_BIBLE).map((r) => r.id),
    [],
    "Every TTES registry row must resolve back to the tenant-experience Bible at its canonical path.",
  )
})

test("the detector reads ids rather than counting lines", () => {
  // Assembled here rather than read from the tree, so the parser meets a shape
  // it has never seen: a checked row, an unchecked row, another domain's row, a
  // gate, and prose that MENTIONS an id without stating it as a row. The last is
  // the one that matters — this ledger's evidence paragraphs cite sibling ids
  // constantly, and a regex that matched them would report every requirement as
  // duplicated and never go red for a real duplicate again.
  const sample = [
    "- [x] **TTES-000-001** — done",
    "- [ ] **TTES-000-002** — not done",
    "- [ ] **PAY-000-001** — another domain",
    "  - Reason: see TTES-000-001 for the inventory",
    "- [ ] **TTES-GATE-000** — a gate",
  ].join("\n")

  assert.deepEqual(ledgerIds(sample), ["TTES-000-001", "TTES-000-002", "TTES-GATE-000"])
})
