#!/usr/bin/env node
/**
 * EXT-000-006 — every EXT ID has an execution-ledger row, and that row is a
 * *final verification* row rather than a placeholder.
 *
 * The requirement: *"Extension execution ledger and final verification rows
 * exist for every EXT ID."*
 *
 * "A row exists" is the cheap half and is not the half that fails. The half
 * that fails is what the row says. §19.1 of the extension is explicit about
 * what makes a row final:
 *
 *   > 2. Use only `PASS`, `FAIL`, `BLOCKED_EXTERNAL`, or `NOT_APPLICABLE` with
 *   >    a reason. There is no final `PARTIAL`.
 *   > 3. `BLOCKED_EXTERNAL` requires exact missing customer/vendor/bank/legal/
 *   >    production input, owner, requested date, affected scope, safe work
 *   >    completed, and next action.
 *   > 4. `NOT_APPLICABLE` requires approved applicability evidence; lack of
 *   >    implementation is not N/A.
 *
 * and rule 1 says the checkbox stays `- [ ]` until the scope is evidenced, so
 * `- [x]` and `Status: FAIL` in the same row is a contradiction, not a style.
 *
 * So this checks nine things, and every one of them is a way the matrix has
 * actually gone wrong somewhere in this repository's history:
 *
 *   MISSING_ROW                  an ID the authority states and no ledger holds
 *   ORPHAN_ROW                   an EXT row for an ID the authority never states
 *   DUPLICATE_ROW               one ID opening two rows — `ledgerStatuses()`
 *                               resolves that silently, last file wins, so the
 *                               losing row is invisible rather than in conflict
 *   SPLIT_LEDGER                 EXT rows in more than one ledger file
 *   STATEMENT_DRIFT              a row quoting something other than the
 *                               requirement's own sentence
 *   STATUS_NOT_FINAL             a status word outside §19.1's four — `PARTIAL`
 *   CHECKBOX_DISAGREES           `[x]`/`FAIL` or `[ ]`/`PASS`
 *   BLOCKED_EXTERNAL_INCOMPLETE  §19.1(3)'s six fields, minus any that is absent
 *   NOT_APPLICABLE_UNEVIDENCED   §19.1(4)'s applicability evidence
 *
 * ## One answer to "what is the status"
 *
 * The status of a row is read by `document-graph.mjs`'s `ledgerStatuses()`,
 * imported rather than re-derived. That parser has been wrong twice — once on
 * `Status: **BLOCKED_EXTERNAL**` and once on an id qualified inside its own
 * bold run — and both times the cost was paid because a second parser existed
 * and disagreed. This module adds only what that one does not expose: where the
 * row is, what it says, and what its body contains. It never forms a second
 * opinion about the status word.
 *
 * ## The ledger path §19.1 names does not exist, and that is reported
 *
 * §19.1 says to copy the IDs into `docs/implementation/global-erp-extension-ledger.md`.
 * The repository put them in `docs/implementation/global-engine-execution-ledger.md`
 * instead, and the registry points every EXT ID at that file. One ledger holding
 * all 186 rows satisfies the requirement's own sentence; two would not, which is
 * why SPLIT_LEDGER is a failure and the path difference is a disclosure. It is
 * printed by the CLI and returned by `declaredLedgerDiscrepancy()` so it cannot
 * be lost, but it is not counted as a missing row — because no row is missing.
 *
 *   node tools/ext-verification-matrix.mjs
 */
import fs from "node:fs"
import path from "node:path"

import { ROOT, STATUSES, ledgerStatuses, requirementsIn } from "./document-graph.mjs"
import { LEDGER_DIR, declaredStatus, ledgerRows as allLedgerRows } from "./ext-ledger-rows.mjs"

export const EXTENSION_PATH = "docs/architecture/Tenure_Global_ERP_Implementation_Extension_v1.0.md"

/** The ledger path §19.1 of the extension names. It does not exist; see the header. */
export const DECLARED_LEDGER = "docs/implementation/global-erp-extension-ledger.md"

/**
 * §19.1(3)'s required qualifiers for a `BLOCKED_EXTERNAL` row, each with the
 * words that count as stating it.
 *
 * Matching on words rather than on a field name is deliberate: the ledger is
 * prose with a shape, not a form, and a row that says "waiting on the bank's
 * implementation guide, requested 2026-08-01, owner: treasury lead" has stated
 * the input, the date and the owner without writing three labels. What is not
 * negotiable is that all six subjects appear.
 */
export const BLOCKED_EXTERNAL_FIELDS = [
  { field: "missing input", any: [/missing/i, /waiting on/i, /awaiting/i, /not provided/i] },
  { field: "owner", any: [/\bowner\b/i, /owned by/i, /accountable/i] },
  { field: "requested date", any: [/requested/i, /\b\d{4}-\d{2}-\d{2}\b/] },
  { field: "affected scope", any: [/\bscope\b/i, /\baffect/i, /\bblocks?\b/i] },
  { field: "safe work completed", any: [/safe work/i, /completed/i, /done so far/i, /work done/i] },
  { field: "next action", any: [/next action/i, /next step/i, /\bnext\b/i] },
]

/** §19.1(4). "Lack of implementation is not N/A" — so the row has to say why it does not apply. */
export const NOT_APPLICABLE_FIELDS = [
  { field: "applicability evidence", any: [/applicab/i, /does not apply/i, /out of scope/i, /not in scope/i] },
  { field: "approval", any: [/approv/i, /accepted by/i, /signed off/i, /decided/i] },
]

const abs = (p) => path.join(ROOT, p)

/**
 * Normalisation for statement comparison.
 *
 * Emphasis, backticks and the quotes a ledger row wraps the sentence in are
 * presentation. Case and inner whitespace are presentation. Everything else —
 * every word, every comma, every slash in `PASS/FAIL/BLOCKED_EXTERNAL` — is the
 * requirement, and a row that drops one has quoted something else.
 */
export function normalizeStatement(s) {
  return String(s)
    .replace(/[`*"“”]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/** Every EXT ID the extension itself states, with its own sentence and section. */
export function extensionIds(text = fs.readFileSync(abs(EXTENSION_PATH), "utf8")) {
  return requirementsIn(text).filter((r) => /^EXT-/.test(r.id))
}

/**
 * The EXT rows, read by the shared reader in `ext-ledger-rows.mjs`.
 *
 * `dir` is a parameter so the fixtures below can drive the whole pipeline over
 * a ledger built to be broken, rather than asserting about the real one.
 */
export function ledgerRows(dir = path.join(ROOT, LEDGER_DIR)) {
  return allLedgerRows({ dir, id: /^EXT-/ })
}

/**
 * The matrix: one entry per EXT ID the authority states, joined to its row.
 *
 * `status` comes from `ledgerStatuses()` — see the header. `row` is null when
 * nothing holds the ID, and that is MISSING_ROW rather than a status of FAIL:
 * "no row" and "a row that says FAIL" are different answers, and this
 * repository's registry collapses them, which is the reason for this file.
 */
export function verificationMatrix(declared = extensionIds(), rows = ledgerRows(), statuses = ledgerStatuses()) {
  const byId = new Map()
  for (const r of rows) {
    if (!byId.has(r.id)) byId.set(r.id, [])
    byId.get(r.id).push(r)
  }
  return declared.map((d) => {
    const found = byId.get(d.id) ?? []
    return {
      id: d.id,
      section: d.section,
      statement: d.statement,
      rows: found,
      row: found[0] ?? null,
      status: statuses.get(d.id)?.status ?? null,
    }
  })
}

/**
 * Pure: everything §19.1 requires of ONE row, given the row and the sentence
 * the authority states for its ID.
 *
 * Split out from the corpus walk so the branches that no row in the repository
 * exercises today — `BLOCKED_EXTERNAL` and `NOT_APPLICABLE`, of which there are
 * currently none — are still driven by tests. A check only ever run against a
 * corpus that cannot trigger it is a check nobody has proven fires.
 */
export function rowProblems({ id, statement, row, status }) {
  const problems = []
  if (!row) {
    problems.push({ id, kind: "MISSING_ROW", detail: "the extension states this ID and no ledger holds a row for it" })
    return problems
  }
  if (normalizeStatement(row.statement) !== normalizeStatement(statement)) {
    problems.push({
      id,
      kind: "STATEMENT_DRIFT",
      detail: `row quotes "${row.statement}"; the extension states "${statement}"`,
    })
  }
  const declaredWord = declaredStatus(row.body)
  if (declaredWord !== null && !STATUSES.includes(declaredWord)) {
    problems.push({ id, kind: "STATUS_NOT_FINAL", detail: `Status: ${declaredWord} is not one of ${STATUSES.join(", ")}` })
  }
  // The `Status:` line is removed before the qualifier checks, and this is not
  // tidiness. `NOT_APPLICABLE` contains the string "APPLICAB", so a row reading
  // only `Status: NOT_APPLICABLE` / `Reason: no` satisfied the "applicability
  // evidence" pattern with the status word itself — the check passed on the
  // exact row §19.1(4) exists to refuse. A declaration is never its own evidence.
  const qualifiers = row.body.replace(/^\s*[-*]\s*Status:.*$/gm, "")
  const effective = status ?? declaredWord
  if (row.checked && effective !== "PASS") {
    problems.push({ id, kind: "CHECKBOX_DISAGREES", detail: `checked [x] with Status: ${effective}` })
  }
  if (!row.checked && effective === "PASS") {
    problems.push({ id, kind: "CHECKBOX_DISAGREES", detail: "Status: PASS with an unchecked [ ] box" })
  }
  if (effective === "BLOCKED_EXTERNAL") {
    const absent = BLOCKED_EXTERNAL_FIELDS.filter((f) => !f.any.some((re) => re.test(qualifiers))).map((f) => f.field)
    if (absent.length > 0) {
      problems.push({ id, kind: "BLOCKED_EXTERNAL_INCOMPLETE", detail: `§19.1(3) requires, and the row omits: ${absent.join(", ")}` })
    }
  }
  if (effective === "NOT_APPLICABLE") {
    const absent = NOT_APPLICABLE_FIELDS.filter((f) => !f.any.some((re) => re.test(qualifiers))).map((f) => f.field)
    if (absent.length > 0) {
      problems.push({ id, kind: "NOT_APPLICABLE_UNEVIDENCED", detail: `§19.1(4) requires, and the row omits: ${absent.join(", ")}` })
    }
  }
  return problems
}

/** Every problem across the whole matrix, corpus-level checks included. */
export function verificationProblems(matrix = verificationMatrix(), rows = ledgerRows()) {
  const problems = []
  for (const entry of matrix) {
    problems.push(...rowProblems(entry))
    if (entry.rows.length > 1) {
      problems.push({
        id: entry.id,
        kind: "DUPLICATE_ROW",
        detail: `${entry.rows.length} rows: ${entry.rows.map((r) => `${r.ledger}:${r.line}`).join(", ")}`,
      })
    }
  }
  const stated = new Set(matrix.map((m) => m.id))
  for (const r of rows) {
    if (!stated.has(r.id)) {
      problems.push({ id: r.id, kind: "ORPHAN_ROW", detail: `${r.ledger}:${r.line} — the extension states no such ID` })
    }
  }
  const files = [...new Set(matrix.flatMap((m) => m.rows.map((r) => r.ledger)))].sort()
  if (files.length > 1) {
    problems.push({ id: "*", kind: "SPLIT_LEDGER", detail: `EXT rows live in ${files.length} ledgers: ${files.join(", ")}` })
  }
  return problems
}

/**
 * The disclosure, not a problem: §19.1 names a ledger path that does not exist,
 * and the rows are somewhere else. Returns null once the two agree.
 */
export function declaredLedgerDiscrepancy(matrix = verificationMatrix()) {
  if (fs.existsSync(abs(DECLARED_LEDGER))) return null
  const files = [...new Set(matrix.flatMap((m) => m.rows.map((r) => r.ledger)))].sort()
  if (files.length === 0) return null
  return { declared: DECLARED_LEDGER, actual: files, why: "§19.1 names a ledger this repository never created; the rows are in the engine ledger and the registry points at it" }
}

export function renderMatrix(matrix = verificationMatrix()) {
  const width = Math.max(...matrix.map((m) => m.id.length))
  return matrix
    .map((m) => `${m.id.padEnd(width)}  ${(m.status ?? "NO ROW").padEnd(16)}  ${m.row ? `${m.row.ledger}:${m.row.line}` : "—"}`)
    .join("\n")
}

if (process.argv[1] && path.basename(process.argv[1]) === "ext-verification-matrix.mjs") {
  const matrix = verificationMatrix()
  console.log(renderMatrix(matrix))
  const counts = {}
  for (const m of matrix) counts[m.status ?? "NO ROW"] = (counts[m.status ?? "NO ROW"] ?? 0) + 1
  console.log(
    `\n${matrix.length} EXT IDs, ${matrix.filter((m) => m.row).length} with a final verification row ` +
      `(${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}).`,
  )
  const d = declaredLedgerDiscrepancy(matrix)
  if (d) console.log(`Disclosure: ${d.why} — declared ${d.declared}, actual ${d.actual.join(", ")}.`)
  const problems = verificationProblems(matrix)
  console.log(`${problems.length} problems.`)
  for (const p of problems) console.log(`  ✗ ${p.id} ${p.kind}: ${p.detail}`)
  process.exit(problems.length === 0 ? 0 : 1)
}
