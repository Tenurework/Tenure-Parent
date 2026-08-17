import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { requirementsIn, ROOT, STATUSES } from "../../tools/document-graph.mjs"

/**
 * FIN-000-005 — every `FIN-*` item the Financial Management Cloud Bible states
 * is in the canonical finance ledger, exactly once, saying what the Bible says,
 * with a status the loop can act on; and the ledger states nothing else.
 *
 * Why this is not already covered. `document-graph.test.mjs` holds
 * `UNIMPORTED = 0` across every authority at once, which proves no requirement
 * is missing from EVERY execution document. That is a weaker claim than this one
 * in four ways, each of which has actually gone wrong somewhere in this
 * repository:
 *
 *   1. `ledgerStatuses()` in `tools/document-graph.mjs` reads rows into a `Map`
 *      keyed by id, so two rows for `FIN-010-003` collapse to one and whichever
 *      is written last decides the registry's answer. A domain can hold a PASS
 *      row and a FAIL row for the same requirement with every existing guard
 *      green.
 *   2. `buildRegistry()` iterates the requirements the DOCUMENTS state, never
 *      the rows the ledgers hold, so a row for an id no Bible states is not a
 *      wrong registry entry — it is invisible. That is how a domain comes to
 *      appear to have decided work nobody specified.
 *   3. `importedIds()` scans all of `docs/implementation`, so a `FIN-*` row that
 *      landed in the payments ledger counts as imported. Finance and payments
 *      genuinely overlap — the Bible's §8 hands treasury execution to the
 *      Payments Bible — which makes a stray row here likelier than anywhere
 *      else, and a requirement with two ledgers has two statuses and no owner.
 *   4. Nothing anywhere compares a row's SENTENCE to the Bible's. A row is free
 *      to restate the requirement more narrowly than the authority does and then
 *      pass against the narrower reading. `FIN-030-004` — "Implement
 *      tax/e-invoice/statutory modes with exact availability" — is one edit away
 *      from "Implement tax modes", which is a different and much easier claim.
 *
 * The canonical row for an id is the row whose bolded text is exactly the id.
 * The task instructions allow closing one requirement across several rows
 * (`**FIN-010-003 (the engine half)**`), so a qualified row is permitted and is
 * NOT held to the sentence rule — but there must be exactly one canonical row,
 * because that is the row `ledgerStatuses()` and the reconciler read.
 *
 * Runner: `npm run test:platform` (bare `node --test`, no jest globals), which
 * `.github/workflows/ci.yml` runs as the "Platform tests" step. Discovery is
 * `tools/run-platform-tests.mjs` walking `tests/`, so this file is a CI check
 * the moment it exists.
 */

const BIBLE = "Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md"
const LEDGER_DIR = "docs/implementation"
const LEDGER = `${LEDGER_DIR}/financial-management-execution-ledger.md`
const PREFIX_REGISTRY = "tools/import-requirements.mjs"

/**
 * Read as text with line endings normalised.
 *
 * Not cosmetic: this repository is edited on Windows and asserted on Linux, and
 * a row regex that anchors on `$` matches a line ending `\r\n` differently from
 * one ending `\n`. Normalising on the way in makes every derivation below
 * byte-identical on both.
 */
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n")
}

/**
 * The `FIN-*` requirements the Bible states, with their sentences.
 *
 * Parsed with the graph's own `requirementsIn`, deliberately: a second parser
 * here could drift from the one the registry counts with, and then this file
 * would be asserting that the ledger matches a Bible nobody else reads the same
 * way.
 */
function bibleRequirements() {
  return requirementsIn(read(BIBLE)).filter((r) => r.id.startsWith("FIN-"))
}

/**
 * Every requirement row in a ledger, WITH duplicates preserved and with the
 * bolded text kept intact so a qualified row can be told from a canonical one.
 *
 * A `Set` would defeat the point — the duplicate is the defect.
 */
function ledgerRows(rel) {
  const text = read(rel)
  const rows = []
  const ROW = /^- \[[ xX]\] \*\*([^*]+)\*\*\s*(?:—|-)?\s*(.*)$/gm
  let m
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

test("the Bible and the ledger state the same FIN requirements", () => {
  const stated = bibleRequirements()
  const rows = ledgerRows(LEDGER).filter((r) => r.id.startsWith("FIN-"))

  // Asserted first and separately. A parser that silently matched nothing would
  // make the comparisons below compare two empty arrays and pass, which is the
  // exact shape of a guard that cannot fail. The Bible's §22 checklist states 34
  // — 29 numbered items and 5 gates.
  assert.equal(
    stated.length,
    34,
    `Parsed ${stated.length} FIN requirements from ${BIBLE}. It states 34; any other number means ` +
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

test("no FIN requirement has two canonical rows", () => {
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
      `for one requirement must qualify its id, e.g. **FIN-010-003 (the adapter half)**.`,
  )
})

test("each canonical row quotes the Bible's own sentence", () => {
  const stated = new Map(bibleRequirements().map((r) => [r.id, r.statement]))
  const drifted = []
  for (const row of ledgerRows(LEDGER).filter((r) => r.canonical)) {
    const expected = stated.get(row.id)
    if (expected === undefined) continue // reported by the first test
    // Backticks are the ledger's own emphasis of a literal (`FIN-*`), not a
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

test("no other ledger claims a FIN requirement", () => {
  // Finance and payments genuinely overlap — the Bible's §8 hands treasury and
  // Stripe execution to the Payments Bible — so a `FIN-*` row filed under
  // payments is the likeliest stray in the repository, and the one hardest to
  // notice: `importedIds()` counts it as imported.
  const strays = []
  for (const name of fs.readdirSync(path.join(ROOT, LEDGER_DIR)).sort()) {
    if (!name.endsWith("-execution-ledger.md")) continue
    const rel = `${LEDGER_DIR}/${name}`
    if (rel === LEDGER) continue
    for (const row of ledgerRows(rel)) {
      if (row.id.startsWith("FIN-")) strays.push(`${rel} — ${row.bold}`)
    }
  }

  assert.deepEqual(
    strays,
    [],
    `FIN rows outside ${LEDGER}:\n  ${strays.join("\n  ")}\n` +
      `Move them; a requirement with two ledgers has two statuses and no owner.`,
  )
})

test("the prefix registry still points FIN at this ledger", () => {
  // `LEDGER_FOR` in the importer decides where a future re-import writes. If it
  // is repointed and this file is not, every test above keeps passing against a
  // ledger nothing writes to any more.
  const mapped = read(PREFIX_REGISTRY).match(/^\s*FIN:\s*"([^"]+)"/m)?.[1]

  assert.equal(
    mapped,
    path.posix.basename(LEDGER),
    `${PREFIX_REGISTRY} maps the FIN prefix to ${mapped ?? "nothing"}, and this guard reads ` +
      `${LEDGER}. One of the two is stale.`,
  )
})

test("every FIN row declares a status the loop can act on", () => {
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
