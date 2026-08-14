import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"

import { requirementsIn, ROOT, STATUSES } from "../../tools/document-graph.mjs"

/**
 * IER-000-002 — every `IER-*` requirement is in the execution ledger exactly
 * once, and the ledger invents none of its own.
 *
 * What was already guarded, and what was not. `document-graph.test.mjs` holds
 * `UNIMPORTED = 0`, which proves that no requirement is missing from EVERY
 * execution document. That is a coarser claim than this one, in three ways that
 * matter:
 *
 *   1. `ledgerStatuses()` in `tools/document-graph.mjs` reads ledger rows into a
 *      `Map` keyed by id. Two rows for `IER-040-003` collapse to one, silently,
 *      and whichever is written second decides the status. A domain can
 *      therefore carry a duplicate row — one PASS, one FAIL — and every
 *      existing guard stays green while the registry reports only one of them.
 *   2. `buildRegistry()` iterates the requirements the DOCUMENTS state, never
 *      the rows the LEDGERS hold. A ledger row for an id no Bible states is
 *      invisible to it: it is not an extra registry row, it is nothing at all.
 *      An invented id is how a domain appears to have decided work nobody
 *      specified.
 *   3. `importedIds()` scans all of `docs/implementation`, so an `IER-*` row
 *      that landed in the payments ledger counts as imported. The requirement
 *      says "the unified execution ledger", singular, and a requirement filed
 *      under two domains is the divergent duplication the Bible's section 0
 *      forbids.
 *
 * So this compares the two sides directly and by equality rather than by
 * containment: the ids the Bible states, and the ids the IER ledger holds. It
 * reds when either side gains an entry the other lacks, which is the difference
 * between a mapping and a paragraph.
 *
 * Runner: `npm run test:platform` (bare `node --test`, no jest globals), which
 * `.github/workflows/ci.yml` runs as the "Platform tests" step. Discovery is by
 * `tools/run-platform-tests.mjs` walking `tests/`, so this file is a CI check
 * the moment it exists.
 */

const BIBLE =
  "Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md"
const LEDGER_DIR = "docs/implementation"
const LEDGER = `${LEDGER_DIR}/identity-eligibility-entitlement-execution-ledger.md`
const PREFIX_REGISTRY = "tools/import-requirements.mjs"

/**
 * Read as text with line endings normalised.
 *
 * Not cosmetic: this repository is edited on Windows and asserted on Linux, and
 * `^- \[ \] \*\*ID\*\*` with the `m` flag matches a line that ends `\r\n`
 * differently from one that ends `\n` once anything anchors on `$`. Normalising
 * on the way in means every derivation below is byte-identical on both.
 */
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n")
}

/**
 * The `IER-*` ids the Bible states, in the order it states them.
 *
 * Parsed with the graph's own `requirementsIn`, deliberately. A second parser
 * here could drift from the one the registry counts with, and then this file
 * would be asserting that the ledger matches a Bible nobody else reads the same
 * way. `requirementsIn` distinguishes a statement from a mention, which is the
 * whole difficulty: section 0 of this Bible mentions ids in prose.
 */
function bibleIds() {
  return requirementsIn(read(BIBLE))
    .map((r) => r.id)
    .filter((id) => id.startsWith("IER-"))
}

/**
 * Every row in a ledger, WITH duplicates preserved.
 *
 * A `Set` here would defeat the point — the duplicate is the defect. Matches
 * the row shape `- [ ] **IER-000-001** — …` that `tools/import-requirements.mjs`
 * writes and that `ledgerStatuses()` reads.
 */
function ledgerRows(rel) {
  const text = read(rel)
  const rows = []
  const ROW = /^- \[[ xX]\] \*\*([A-Z]{2,8}-\d{3}-\d{3}|[A-Z]{2,8}-GATE-\d+)\*\*/gm
  let m
  while ((m = ROW.exec(text)) !== null) rows.push(m[1])
  return rows
}

test("the Bible and the ledger state the same IER requirements", () => {
  const stated = bibleIds()
  const rows = ledgerRows(LEDGER).filter((id) => id.startsWith("IER-"))

  // Asserted first and separately. A parser that silently matched nothing would
  // make the equality below compare two empty arrays and pass, which is the
  // exact shape of a guard that cannot fail.
  assert.ok(
    stated.length >= 200,
    `Parsed ${stated.length} IER requirements from ${BIBLE}. It states 219; a count near zero ` +
      `means the statement shape changed and this file is now measuring nothing.`,
  )

  const missing = stated.filter((id) => !rows.includes(id))
  const invented = rows.filter((id) => !stated.includes(id))

  assert.deepEqual(
    missing,
    [],
    `stated by the Bible, absent from ${LEDGER}:\n  ${missing.join("\n  ")}\n` +
      `An unimported requirement is not queued, not counted and not failing. Run ` +
      `\`node tools/import-requirements.mjs\` to add the rows.`,
  )
  assert.deepEqual(
    invented,
    [],
    `held by ${LEDGER}, stated by no Bible:\n  ${invented.join("\n  ")}\n` +
      `buildRegistry() iterates documents, not ledgers, so an invented id is invisible to every ` +
      `other guard — and a decision recorded against it is a decision about nothing.`,
  )
})

test("no IER requirement is filed twice", () => {
  const rows = ledgerRows(LEDGER)
  const seen = new Set()
  const duplicated = []
  for (const id of rows) {
    if (seen.has(id)) duplicated.push(id)
    seen.add(id)
  }

  assert.deepEqual(
    duplicated,
    [],
    `these ids have more than one row in ${LEDGER}:\n  ${duplicated.join("\n  ")}\n` +
      `ledgerStatuses() keys a Map by id, so the second row silently overwrites the first and one ` +
      `of the two statuses — possibly the honest one — is never read by anything.`,
  )
})

test("no other ledger claims an IER requirement", () => {
  // The requirement says "the unified execution ledger", singular. Two domains
  // deciding one requirement is how the same id ends up PASS in one file and
  // FAIL in another, with `readdirSync` order picking the winner.
  const strays = []
  for (const name of fs.readdirSync(path.join(ROOT, LEDGER_DIR)).sort()) {
    if (!name.endsWith("-execution-ledger.md")) continue
    const rel = `${LEDGER_DIR}/${name}`
    if (rel === LEDGER) continue
    for (const id of ledgerRows(rel)) {
      if (id.startsWith("IER-")) strays.push(`${rel} — ${id}`)
    }
  }

  assert.deepEqual(
    strays,
    [],
    `IER rows outside ${LEDGER}:\n  ${strays.join("\n  ")}\n` +
      `Move them; a requirement with two ledgers has two statuses and no owner.`,
  )
})

test("the prefix registry still points IER at this ledger", () => {
  // `LEDGER_FOR` in the importer is what decides where a future re-import
  // writes. If it is renamed or repointed and this file is not, the tests above
  // keep passing against a ledger nothing writes to any more.
  const registry = read(PREFIX_REGISTRY)
  const mapped = registry.match(/^\s*IER:\s*"([^"]+)"/m)?.[1]

  assert.equal(
    mapped,
    path.posix.basename(LEDGER),
    `${PREFIX_REGISTRY} maps the IER prefix to ${mapped ?? "nothing"}, and this guard reads ` +
      `${LEDGER}. One of the two is stale.`,
  )
})

test("every imported IER row declares a status the loop can act on", () => {
  // An imported row whose status is a word `next-batch.mjs` does not recognise
  // returns to the queue every tick, forever. Import is only complete if the
  // rows it wrote are decidable.
  const text = read(LEDGER)
  const offenders = []
  for (const chunk of text.split(/\n(?=- \[[ xX]\] \*\*)/)) {
    const id = chunk.match(/^- \[[ xX]\] \*\*([^*]+)\*\*/)?.[1]
    if (!id) continue
    const declared = chunk.match(/^\s*[-*]\s*Status:\s*\*{0,2}([A-Z_]+)/m)?.[1]
    if (!declared) offenders.push(`${id} — no Status line`)
    else if (!STATUSES.includes(declared)) offenders.push(`${id} — ${declared}`)
  }

  assert.deepEqual(
    offenders,
    [],
    `rows in ${LEDGER} the loop cannot decide on:\n  ${offenders.join("\n  ")}\n` +
      `Allowed: ${STATUSES.join(" | ")}.`,
  )
})
