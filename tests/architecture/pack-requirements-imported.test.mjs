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
 * PACK-000-003 — every `PACK-*` requirement is in the canonical ledger, and
 * stays there.
 *
 * The global ratchet in `document-graph.test.mjs` counts requirements no
 * execution document mentions, and it is at zero. That is necessary and it is
 * not sufficient for this item, for two reasons a count cannot see:
 *
 *   * A PACK row could migrate into somebody else's ledger. The unimported
 *     count would not move — it is still in *an* execution document — while
 *     `next-batch.mjs` hands PACK work to whoever owns that file and the pack
 *     ledger silently stops being the canonical record of the domain.
 *   * A PACK row could be stated twice, in two ledgers. The count does not move
 *     there either, and the domain then reads as further along than it is,
 *     because two rows for one requirement can hold two different statuses.
 *
 * Both are invisible to a total and obvious to an equality, so this asserts the
 * equality: the set of `PACK-*` requirements the Bible states, the set the
 * execution system imported, the set the pack ledger owns, and the set the
 * generated registry resolves back to that Bible are all the same set.
 *
 * This proves IMPORT and nothing else. It does not claim any pack behaviour is
 * built — thirty-eight of the fifty-three rows it counts are FAIL, and that is
 * the honest state.
 */

const BIBLE = "Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md"
const LEDGER = "docs/implementation/erp-pack-factory-execution-ledger.md"

const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8")

/** The ids the Bible states, gates included. */
function statedByBible() {
  return requirementsIn(read(BIBLE))
    .map((r) => r.id)
    .filter((id) => id.startsWith("PACK-"))
    .sort()
}

test("the Bible still states the requirements this check counts", () => {
  // A floor and an exact count. The parser reads `- [ ] PACK-000-001 — text`;
  // if that shape ever changes it matches nothing, every set below becomes
  // empty, and every equality below holds vacuously.
  const stated = statedByBible()
  assert.equal(
    stated.length,
    53,
    `The pack Bible states ${stated.length} PACK requirements, not 53. If the Bible gained or ` +
      `lost one, import it and update this number; if it dropped to zero, the requirement parser ` +
      `has stopped reading the shape the Bible states them in.`,
  )
  assert.ok(
    stated.some((id) => /^PACK-GATE-\d{3}$/.test(id)),
    "No gate id parsed. Gates were invisible to the extractor once before, and 164 requirements " +
      "went missing behind it.",
  )
})

test("every PACK requirement is in the execution system", () => {
  const missing = statedByBible().filter((id) => !importedIds().has(id))
  assert.deepEqual(
    missing,
    [],
    `These PACK requirements are stated by the Bible and are in no execution document:\n${missing.join("\n")}`,
  )
})

test("every PACK requirement is owned by the pack ledger, and by that one alone", () => {
  const ledger = ledgerStatuses()
  const elsewhere = statedByBible()
    .map((id) => ({ id, owner: ledger.get(id)?.source_ledger }))
    .filter((r) => r.owner !== LEDGER)
    .map((r) => `${r.id} is owned by ${r.owner ?? "(no ledger)"}`)

  assert.deepEqual(
    elsewhere,
    [],
    `A PACK requirement's row is not in the pack ledger:\n${elsewhere.join("\n")}\n` +
      `The loop hands work to the ledger that owns the row, so a row in another file is work ` +
      `this domain will never be given.`,
  )
})

test("the pack ledger states each PACK requirement exactly once", () => {
  // Two rows for one id is not an import error the count above can see: both
  // are imported, and they may hold different statuses, so which one is true
  // depends on which the reader opened.
  const ids = [...read(LEDGER).matchAll(/^- \[[ xX]\] \*\*(PACK-[\w-]+)\*\*/gm)].map((m) => m[1])
  const seen = new Set()
  const duplicated = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)))
  assert.deepEqual(duplicated, [], `The pack ledger states these ids more than once: ${duplicated.join(", ")}`)
  assert.deepEqual(
    [...seen].sort(),
    statedByBible(),
    "The pack ledger's rows and the Bible's requirements are not the same set.",
  )
})

test("the generated registry owns exactly the PACK requirements the Bible states", () => {
  const rows = buildRegistry(classify(), ledgerStatuses(), importedIds()).filter(
    (r) => r.prefix === "PACK",
  )
  assert.deepEqual(
    rows.map((r) => r.id).sort(),
    statedByBible(),
    "The generated registry's PACK rows and the pack Bible's requirements are not the same set.",
  )
  assert.deepEqual(
    rows.filter((r) => r.source_document !== BIBLE).map((r) => `${r.id} → ${r.source_document}`),
    [],
    "A PACK registry row resolves to a document other than the pack Bible.",
  )
})
