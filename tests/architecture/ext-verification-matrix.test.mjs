/**
 * EXT-000-006 — the guard.
 *
 * Two halves, deliberately separated.
 *
 * The corpus half asserts the fact the requirement states: every EXT ID the
 * extension itself lists has a final verification row, and no row breaks any of
 * §19.1's rules. It reads the real extension and the real ledgers, so it fails
 * the day somebody adds an EXT ID without a row, or writes `Status: PARTIAL`.
 *
 * The fixture half drives every branch the corpus cannot reach today. There is
 * no `BLOCKED_EXTERNAL` and no `NOT_APPLICABLE` EXT row in this repository, so
 * the §19.1(3) and (4) checks would be dead code proven by nothing — which is
 * exactly the state a check is in when nobody has watched it fire.
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  BLOCKED_EXTERNAL_FIELDS,
  NOT_APPLICABLE_FIELDS,
  declaredLedgerDiscrepancy,
  extensionIds,
  ledgerRows,
  normalizeStatement,
  rowProblems,
  verificationMatrix,
  verificationProblems,
} from "../../tools/ext-verification-matrix.mjs"

const matrix = verificationMatrix()

test("the extension states EXT IDs, and the parse found them", () => {
  const ids = extensionIds()
  // A floor, not a count. The number is data and the authority may gain an ID;
  // zero is the failure this asserts against, because a parser that returns
  // nothing makes every assertion below vacuously true.
  assert.ok(ids.length >= 150, `only ${ids.length} EXT IDs parsed out of the extension`)
  assert.ok(ids.every((r) => /^EXT-(\d{3}-\d{3}|GATE-\d+)$/.test(r.id)), "an ID does not have the EXT shape")
  assert.ok(ids.every((r) => r.statement.length > 20), "an ID was parsed with no statement")
})

test("every EXT ID the extension states has a final verification row", () => {
  const without = matrix.filter((m) => !m.row).map((m) => m.id)
  assert.deepEqual(without, [], `EXT IDs with no ledger row: ${without.join(", ")}`)
  assert.equal(matrix.length, extensionIds().length)
})

test("no row breaks a §19.1 rule", () => {
  const problems = verificationProblems(matrix)
  assert.deepEqual(
    problems.map((p) => `${p.id} ${p.kind}: ${p.detail}`),
    [],
  )
})

test("the corpus check is not vacuous — take one real row away and it says so", () => {
  const damaged = matrix.map((m, i) => (i === 0 ? { ...m, row: null, rows: [] } : m))
  const problems = verificationProblems(damaged, ledgerRows())
  assert.deepEqual(
    problems.map((p) => `${p.id} ${p.kind}`),
    [`${matrix[0].id} MISSING_ROW`],
    "removing a row from the real matrix did not produce exactly one MISSING_ROW",
  )
})

test("every row carries a status word §19.1 allows, and the checkbox agrees with it", () => {
  // The same facts the problem list covers, asserted directly so a bug that
  // made `verificationProblems` return [] could not make this file green.
  for (const m of matrix) {
    assert.ok(["PASS", "FAIL", "BLOCKED_EXTERNAL", "NOT_APPLICABLE"].includes(m.status), `${m.id} status ${m.status}`)
    assert.equal(m.row.checked, m.status === "PASS", `${m.id} checkbox and status disagree`)
  }
})

test("the ledger §19.1 names is disclosed as absent rather than silently substituted", () => {
  const d = declaredLedgerDiscrepancy(matrix)
  if (d === null) {
    assert.ok(fs.existsSync(path.join(process.cwd(), "docs/implementation/global-erp-extension-ledger.md")))
  } else {
    assert.equal(d.declared, "docs/implementation/global-erp-extension-ledger.md")
    assert.deepEqual(d.actual, ["docs/implementation/global-engine-execution-ledger.md"])
  }
})

test("statement comparison ignores presentation and nothing else", () => {
  const s = "Implement `X` and Y."
  assert.equal(normalizeStatement('"Implement `X` and Y."'), normalizeStatement(s))
  assert.equal(normalizeStatement("**Implement `X`  and Y.**"), normalizeStatement(s))
  assert.notEqual(normalizeStatement("Implement X and Z."), normalizeStatement(s))
  assert.notEqual(normalizeStatement("Implement X"), normalizeStatement(s))
})

const row = (over = {}) => ({
  id: "EXT-999-001",
  checked: false,
  statement: "Do the thing.",
  ledger: "docs/implementation/fixture-ledger.md",
  line: 1,
  body: "  - Status: FAIL\n  - Reason: not yet implemented",
  ...over,
})
const entry = (over = {}, rowOver = {}) => ({
  id: "EXT-999-001",
  statement: "Do the thing.",
  row: row(rowOver),
  status: null,
  ...over,
})

test("MISSING_ROW is what a missing row is, and it is not a FAIL", () => {
  const p = rowProblems(entry({ row: null }))
  assert.equal(p.length, 1)
  assert.equal(p[0].kind, "MISSING_ROW")
})

test("STATEMENT_DRIFT fires when a row quotes something else", () => {
  assert.deepEqual(rowProblems(entry()), [])
  const drift = rowProblems(entry({}, { statement: "Do the other thing." }))
  assert.deepEqual(drift.map((p) => p.kind), ["STATEMENT_DRIFT"])
})

test("STATUS_NOT_FINAL fires on PARTIAL — §19.1(2) says there is no final PARTIAL", () => {
  const p = rowProblems(entry({}, { body: "  - Status: PARTIAL\n  - Reason: half done" }))
  assert.ok(p.some((x) => x.kind === "STATUS_NOT_FINAL" && /PARTIAL/.test(x.detail)))
})

test("CHECKBOX_DISAGREES fires in both directions", () => {
  const checkedFail = rowProblems(entry({}, { checked: true }))
  assert.deepEqual(checkedFail.map((p) => p.kind), ["CHECKBOX_DISAGREES"])
  const uncheckedPass = rowProblems(entry({ status: "PASS" }))
  assert.deepEqual(uncheckedPass.map((p) => p.kind), ["CHECKBOX_DISAGREES"])
  assert.deepEqual(rowProblems(entry({ status: "PASS" }, { checked: true })), [])
})

test("BLOCKED_EXTERNAL_INCOMPLETE names each §19.1(3) field the row omits", () => {
  const bare = rowProblems(entry({ status: "BLOCKED_EXTERNAL" }, { body: "  - Status: BLOCKED_EXTERNAL" }))
  assert.equal(bare.length, 1)
  assert.equal(bare[0].kind, "BLOCKED_EXTERNAL_INCOMPLETE")
  for (const f of BLOCKED_EXTERNAL_FIELDS) assert.ok(bare[0].detail.includes(f.field), `${f.field} not named`)

  const complete = rowProblems(
    entry(
      { status: "BLOCKED_EXTERNAL" },
      {
        body:
          "  - Status: BLOCKED_EXTERNAL\n" +
          "  - Missing: the bank's ISO 20022 implementation guide. Owner: treasury lead.\n" +
          "  - Requested 2026-08-01. Scope affected: pain.001 generation only.\n" +
          "  - Safe work completed: schema registry and golden fixtures. Next action: chase the guide.",
      },
    ),
  )
  assert.deepEqual(complete, [])
})

test("NOT_APPLICABLE_UNEVIDENCED fires when the row only says it is not applicable", () => {
  const bare = rowProblems(entry({ status: "NOT_APPLICABLE" }, { body: "  - Status: NOT_APPLICABLE\n  - Reason: no" }))
  assert.equal(bare.length, 1)
  assert.equal(bare[0].kind, "NOT_APPLICABLE_UNEVIDENCED")
  for (const f of NOT_APPLICABLE_FIELDS) assert.ok(bare[0].detail.includes(f.field), `${f.field} not named`)

  const evidenced = rowProblems(
    entry(
      { status: "NOT_APPLICABLE" },
      { body: "  - Status: NOT_APPLICABLE\n  - Applicability: no tenant is in scope; approved by the programme board 2026-07-02." },
    ),
  )
  assert.deepEqual(evidenced, [])
})

test("DUPLICATE_ROW and SPLIT_LEDGER are read off real files, not asserted about them", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ext-matrix-"))
  try {
    fs.writeFileSync(
      path.join(dir, "a-ledger.md"),
      "- [ ] **EXT-999-001** — Do the thing.\n  - Status: FAIL\n  - Reason: no\n",
    )
    fs.writeFileSync(
      path.join(dir, "b-ledger.md"),
      "- [ ] **EXT-999-001** — Do the thing.\n  - Status: FAIL\n  - Reason: also no\n" +
        "- [ ] **EXT-999-002** — Something the extension never states.\n  - Status: FAIL\n",
    )
    const rows = ledgerRows(dir)
    assert.equal(rows.length, 3, "the fixture parse did not find three rows")
    const declared = [{ id: "EXT-999-001", statement: "Do the thing.", section: "fixture" }]
    const kinds = verificationProblems(verificationMatrix(declared, rows, new Map()), rows).map((p) => p.kind).sort()
    assert.deepEqual(kinds, ["DUPLICATE_ROW", "ORPHAN_ROW", "SPLIT_LEDGER"])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("a row body stops at the next row, so one row cannot borrow another's evidence", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ext-matrix-body-"))
  try {
    fs.writeFileSync(
      path.join(dir, "c-ledger.md"),
      "- [ ] **GE-001-001** — Before.\n  - Missing: an earlier thing. Owner: nobody. Requested 2025-01-01.\n" +
        "  - Scope: none. Safe work completed: none. Next action: none.\n" +
        "- [ ] **EXT-999-001** — First.\n  - Status: BLOCKED_EXTERNAL\n" +
        "- [ ] **PAY-010-001** — Second.\n  - Missing: a thing. Owner: someone. Requested 2026-01-01.\n" +
        "  - Scope: all. Safe work completed: none. Next action: ask.\n",
    )
    const rows = ledgerRows(dir)
    const first = rows.find((r) => r.id === "EXT-999-001")
    assert.ok(!/an earlier thing/.test(first.body), "the EXT row absorbed the preceding row's body")
    assert.ok(!/Next action/.test(first.body), "the EXT row absorbed the following row's body")
    const p = rowProblems({ id: first.id, statement: "First.", row: first, status: "BLOCKED_EXTERNAL" })
    assert.deepEqual(p.map((x) => x.kind), ["BLOCKED_EXTERNAL_INCOMPLETE"])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
