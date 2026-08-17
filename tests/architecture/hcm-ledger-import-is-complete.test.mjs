import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { requirementsIn, ROOT, STATUSES } from "../../tools/document-graph.mjs"

/**
 * HCM-000-004 — every `HCM-*` item the People, HR and Workforce Cloud Bible
 * states is in the canonical people ledger, exactly once, saying what the Bible
 * says, with a status the loop can act on; and that ledger states nothing else.
 *
 * The requirement is one sentence — "Import every `HCM-*` item into the
 * canonical ledger" — and it has been sitting at FAIL with the reason "imported
 * from … ; not yet implemented", which was self-contradictory: the rows existed.
 * What did not exist was anything that would notice if one of them went away.
 * "Imported" is not a state you reach by having run a script once; a row deleted
 * in an edit, a second row that silently overwrites the first, or a sentence
 * narrowed to something easier all leave the import incomplete with every
 * existing guard green. Four ways, and all four have happened somewhere in this
 * repository:
 *
 *   1. `ledgerStatuses()` in `tools/document-graph.mjs` reads rows into a `Map`
 *      keyed by id, so two rows for `HCM-040-003` collapse to one and whichever
 *      is written last decides the registry's answer.
 *   2. `buildRegistry()` iterates the requirements the DOCUMENTS state, never
 *      the rows the ledgers hold, so a row for an id no Bible states is not a
 *      wrong entry — it is invisible.
 *   3. `importedIds()` scans all of `docs/implementation`, so an `HCM-*` row that
 *      landed in another domain's ledger still counts as imported. For this
 *      family that is a live risk rather than a theoretical one: seats, role
 *      assignments and student-leadership transitions are also written about by
 *      `identity-eligibility-entitlement-execution-ledger.md`,
 *      `simon-ose-absorption-execution-ledger.md` and
 *      `universal-work-graph-execution-ledger.md`, and a requirement with two
 *      ledgers has two statuses and no owner.
 *   4. Nothing anywhere compares a row's SENTENCE to the Bible's. `HCM-030-005`
 *      — "Implement exact payroll capability modes, run exchange and
 *      reconciliation" — is one edit away from "Implement payroll capability
 *      modes", which drops both the exactness and the reconciliation and is a
 *      far easier claim to pass.
 *
 * The canonical row for an id is the row whose bolded text is exactly the id. A
 * qualified row (`**HCM-040-003 (the boundary half)**`) is permitted — that is
 * how one requirement is closed across several lanes — and is not held to the
 * sentence rule, but there must be exactly one canonical row, because that is
 * the row `ledgerStatuses()` and the reconciler read.
 *
 * Shape follows `fin-ledger-import-is-complete.test.mjs` and
 * `ier-ledger-import-is-complete.test.mjs`, which assert the same property for
 * their own families. The row parser is a third copy of theirs; extracting the
 * three into one helper needs a wave in which one agent owns all three files,
 * and is recorded in the people ledger rather than done here by editing another
 * domain's guard.
 *
 * Runner: `npm run test:platform` (bare `node --test`, no jest globals), which
 * `.github/workflows/ci.yml` runs as the "Platform tests" step; discovery is
 * `tools/run-platform-tests.mjs` walking `tests/`, so this file is a CI check the
 * moment it exists.
 */

const BIBLE = "Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md"
const LEDGER_DIR = "docs/implementation"
const LEDGER = `${LEDGER_DIR}/people-hr-workforce-execution-ledger.md`
const PREFIX_REGISTRY = "tools/import-requirements.mjs"

/**
 * Read as text with line endings normalised.
 *
 * This repository is edited on Windows and asserted on Linux, and a row regex
 * anchored on `$` matches `\r\n` differently from `\n`. Normalising on the way in
 * makes every derivation below byte-identical on both.
 */
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n")
}

/**
 * The `HCM-*` requirements the Bible states, with their sentences.
 *
 * Parsed with the graph's own `requirementsIn`. A second parser here could drift
 * from the one the registry counts with, and then this file would be asserting
 * that the ledger matches a Bible nobody else reads the same way.
 */
function bibleRequirements() {
  return requirementsIn(read(BIBLE)).filter((r) => r.id.startsWith("HCM-"))
}

/**
 * Every requirement row in a ledger, WITH duplicates preserved and the bolded
 * text kept intact so a qualified row can be told from a canonical one.
 *
 * A `Set` would defeat the point — the duplicate is the defect.
 */
function ledgerRows(rel) {
  const rows = []
  const ROW = /^- \[[ xX]\] \*\*([^*]+)\*\*\s*(?:—|-)?\s*(.*)$/gm
  let m
  const text = read(rel)
  while ((m = ROW.exec(text)) !== null) {
    const bold = m[1].trim()
    const id = /^([A-Z]{2,8}-(?:\d{3}-\d{3}|GATE-\d+))\b/.exec(bold)?.[1]
    if (!id) continue
    rows.push({
      id,
      bold,
      canonical: bold === id,
      statement: m[2].replace(/\s+/g, " ").trim(),
    })
  }
  return rows
}

test("the Bible and the ledger state the same HCM requirements", () => {
  const stated = bibleRequirements()
  const rows = ledgerRows(LEDGER).filter((r) => r.id.startsWith("HCM-"))

  // Asserted first and separately. A parser that silently matched nothing would
  // make the comparisons below compare two empty arrays and pass, which is the
  // exact shape of a guard that cannot fail. §15 states 33 — 27 numbered items
  // across HCM-000…HCM-050, and 6 gates.
  assert.equal(
    stated.length,
    33,
    `Parsed ${stated.length} HCM requirements from ${BIBLE}. It states 33; any other number means ` +
      `the statement shape changed and this file is now measuring something else.`,
  )

  const canonical = rows.filter((r) => r.canonical).map((r) => r.id)
  const missing = stated.map((r) => r.id).filter((id) => !canonical.includes(id))
  const invented = rows.map((r) => r.id).filter((id) => !stated.some((r) => r.id === id))

  assert.deepEqual(
    missing,
    [],
    `stated by the Bible, no canonical row in ${LEDGER}:\n  ${missing.join("\n  ")}\n` +
      `An unimported requirement is not queued, not counted and not failing — it is invisible, ` +
      `and invisible reads exactly like done. Run \`node tools/import-requirements.mjs\`.`,
  )
  assert.deepEqual(
    invented,
    [],
    `held by ${LEDGER}, stated by no Bible:\n  ${invented.join("\n  ")}\n` +
      `buildRegistry() iterates documents, not ledgers, so an invented id is invisible to every ` +
      `other guard — and a decision recorded against it is a decision about nothing.`,
  )
})

test("no HCM requirement has two canonical rows", () => {
  const seen = new Set()
  const duplicated = []
  for (const row of ledgerRows(LEDGER).filter((r) => r.canonical)) {
    if (seen.has(row.id)) duplicated.push(row.id)
    seen.add(row.id)
  }

  assert.deepEqual(
    duplicated,
    [],
    `these ids have more than one canonical row in ${LEDGER}:\n  ${duplicated.join("\n  ")}\n` +
      `ledgerStatuses() keys a Map by id, so the second row silently overwrites the first and one ` +
      `of the two statuses — possibly the honest one — is never read by anything. A second lane ` +
      `for one requirement must qualify its id, e.g. **HCM-040-003 (the boundary half)**.`,
  )
})

test("each canonical row quotes the Bible's own sentence", () => {
  const stated = new Map(bibleRequirements().map((r) => [r.id, r.statement]))
  const drifted = []
  for (const row of ledgerRows(LEDGER).filter((r) => r.canonical)) {
    const expected = stated.get(row.id)
    if (expected === undefined) continue // reported by the first test
    // Backticks are the ledger's own emphasis of a literal (`HCM-*`), not a
    // change of claim, and the Bible uses them in the same places — compared
    // with them stripped so a row may quote either way.
    const strip = (s) => s.replace(/`/g, "").replace(/\s+/g, " ").trim()
    if (strip(row.statement) !== strip(expected)) {
      drifted.push(`${row.id}\n    ledger: ${row.statement}\n    Bible:  ${expected}`)
    }
  }

  assert.deepEqual(
    drifted,
    [],
    `rows whose sentence is not the requirement's own:\n  ${drifted.join("\n  ")}\n` +
      `A requirement is closed when what it SAYS is true. A row that restates it more narrowly ` +
      `passes against the narrower reading, and the registry copies the ledger's wording into the ` +
      `place everyone reads.`,
  )
})

test("no other ledger claims an HCM requirement", () => {
  const strays = []
  for (const name of fs.readdirSync(path.join(ROOT, LEDGER_DIR)).sort()) {
    if (!name.endsWith("-execution-ledger.md")) continue
    const rel = `${LEDGER_DIR}/${name}`
    if (rel === LEDGER) continue
    for (const row of ledgerRows(rel)) {
      if (row.id.startsWith("HCM-")) strays.push(`${rel} — ${row.bold}`)
    }
  }

  assert.deepEqual(
    strays,
    [],
    `HCM rows outside ${LEDGER}:\n  ${strays.join("\n  ")}\n` +
      `Move them; a requirement with two ledgers has two statuses and no owner.`,
  )
})

test("the prefix registry still points HCM at this ledger", () => {
  // `LEDGER_FOR` in the importer decides where a future re-import writes. If it
  // is repointed and this file is not, every test above keeps passing against a
  // ledger nothing writes to any more.
  const mapped = read(PREFIX_REGISTRY).match(/^\s*HCM:\s*"([^"]+)"/m)?.[1]

  assert.equal(
    mapped,
    path.posix.basename(LEDGER),
    `${PREFIX_REGISTRY} maps the HCM prefix to ${mapped ?? "nothing"}, and this guard reads ` +
      `${LEDGER}. One of the two is stale.`,
  )
})

test("every HCM row declares a status the loop can act on", () => {
  // `tools/loop/next-batch.mjs` decides on PASS, BLOCKED_EXTERNAL and
  // NOT_APPLICABLE only. Any other word — PARTIAL, IN_PROGRESS,
  // BLOCKED_ARCHITECTURE — reads as undecided and returns the item to the queue
  // every tick, forever. Import is only complete if the rows it wrote are
  // decidable.
  const text = read(LEDGER)
  const offenders = []
  for (const chunk of text.split(/\n(?=- \[[ xX]\] \*\*)/)) {
    const bold = chunk.match(/^- \[[ xX]\] \*\*([^*]+)\*\*/)?.[1]
    if (!bold) continue
    const declared = chunk.match(/^\s*[-*]\s*Status:\s*\*{0,2}([A-Z_]+)/m)?.[1]
    if (!declared) offenders.push(`${bold} — no Status line`)
    else if (!STATUSES.includes(declared)) offenders.push(`${bold} — ${declared}`)
  }

  assert.ok(
    offenders.length === 0,
    `rows in ${LEDGER} the loop cannot decide on:\n  ${offenders.join("\n  ")}\n` +
      `Allowed: ${STATUSES.join(" | ")}.`,
  )
})
