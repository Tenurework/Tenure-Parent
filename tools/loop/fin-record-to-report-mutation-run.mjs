/**
 * FIN-000-005 and FIN-010-003 evidence: re-runs every mutation those ledger rows
 * claim, against the tests that are supposed to catch them.
 *
 * Throwaway is the wrong instinct. The claim in the ledger is "apply the
 * mutation, run it, confirm it fails, restore, confirm it passes" — and a reader
 * who wants to disbelieve it should be able to re-run the sequence rather than
 * re-derive it from prose. Sibling of `tools/loop/fin-mutation-run.mjs`, which
 * does the same for FIN-000-001's inventory guard.
 *
 * ONE mutation at a time, always restored before the next. Two applied together
 * can mask each other: a broken tie-out and a broken emptiness check will both
 * red the same assertion, and then neither is proven. Every edit uses a literal
 * distinctive value so no other token in the file can absorb it.
 *
 * Usage: node tools/loop/fin-record-to-report-mutation-run.mjs
 *        node tools/loop/fin-record-to-report-mutation-run.mjs --only=engine
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const WEB = path.join(ROOT, "apps/web")
const JEST = path.join(ROOT, "node_modules/jest/bin/jest.js")

const ENGINE = path.join(ROOT, "packages/finops/src/general-ledger.ts")
const ADAPTER = path.join(WEB, "src/lib/finance.ts")
const LEDGER = path.join(ROOT, "docs/implementation/financial-management-execution-ledger.md")
const IMPORTER = path.join(ROOT, "tools/import-requirements.mjs")
const GUARD = path.join(ROOT, "tests/architecture/fin-ledger-import-is-complete.test.mjs")
const STRAY = path.join(ROOT, "docs/implementation/zz-mutation-probe-execution-ledger.md")

const DISCLOSURE_TOOL = path.join(ROOT, "tools/fin-scope-disclosure.mjs")
const DISCLOSURE_DOC = path.join(ROOT, "docs/architecture/fin-accounting-scope-disclosure.md")
const DISCLOSURE_GUARD = path.join(ROOT, "tests/architecture/fin-scope-disclosure.test.mjs")

const original = new Map(
  [ENGINE, ADAPTER, LEDGER, IMPORTER, DISCLOSURE_TOOL, DISCLOSURE_DOC].map((file) => [
    file,
    fs.readFileSync(file, "utf8"),
  ]),
)
const restore = () => {
  for (const [file, text] of original) fs.writeFileSync(file, text)
  if (fs.existsSync(STRAY)) fs.unlinkSync(STRAY)
}

/** Regenerate the published disclosure from whatever the tree now says. */
const regenerateDisclosure = () =>
  spawnSync(process.execPath, [DISCLOSURE_TOOL], { cwd: ROOT, encoding: "utf8" })

/** Replace exactly once, and refuse if the anchor is not there. */
function swap(file, from, to) {
  const text = original.get(file)
  const at = text.indexOf(from)
  if (at < 0) throw new Error(`anchor not found in ${path.relative(ROOT, file)}: ${from}`)
  if (text.indexOf(from, at + 1) >= 0) {
    throw new Error(`anchor is not unique in ${path.relative(ROOT, file)}: ${from}`)
  }
  fs.writeFileSync(file, text.slice(0, at) + to + text.slice(at + from.length))
}

/** node --test on one platform guard. */
function runNodeTest(file) {
  const r = spawnSync(process.execPath, ["--test", file], { cwd: ROOT, encoding: "utf8" })
  const failed = [...r.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1])
  const total = Number(/^# tests (\d+)$/m.exec(r.stdout)?.[1] ?? 0)
  return { failed, total }
}

const runGuard = () => runNodeTest(GUARD)
const runDisclosure = () => runNodeTest(DISCLOSURE_GUARD)

/** jest on one suite, through this app's next/jest transform. */
function runJest(pattern) {
  const r = spawnSync(process.execPath, [JEST, "--ci", "--silent", pattern], {
    cwd: WEB,
    encoding: "utf8",
  })
  const out = `${r.stdout}${r.stderr}`
  const summary = /Tests:\s+(?:(\d+) failed,\s+)?(?:(\d+) skipped,\s+)?(\d+) passed,\s+(\d+) total/.exec(out)
  const failed = [...out.matchAll(/●\s+(.+?)\s*›\s*(.+?)\n/g)].map((m) => `${m[1]} › ${m[2]}`)
  return {
    failedCount: summary ? Number(summary[1] ?? 0) : failed.length > 0 ? failed.length : 1,
    total: summary ? Number(summary[4]) : 0,
    failed: [...new Set(failed)],
  }
}

const MUTATIONS = [
  // ── the engine: packages/finops/src/general-ledger.ts ──────────────────────
  {
    group: "engine",
    name: "compare the debit column against itself, so the residual is always zero",
    run: () => runJest("general-ledger"),
    apply: () => swap(ENGINE, "const outOfBalance = subtract(debits, credits)", "const outOfBalance = subtract(debits, debits)"),
  },
  {
    group: "engine",
    name: "report an empty window as balanced instead of as nothing-to-report",
    run: () => runJest("general-ledger"),
    apply: () =>
      swap(
        ENGINE,
        "const balanced = sections.length === 0 ? null : sections.every((s) => s.balanced)",
        "const balanced = sections.length === 0 ? true : sections.every((s) => s.balanced)",
      ),
  },
  {
    group: "engine",
    name: "treat a date-only upper bound as the first instant of that day",
    run: () => runJest("general-ledger"),
    apply: () =>
      swap(
        ENGINE,
        'return DATE_ONLY.test(value) ? `${value}T23:59:59.999Z` : value',
        'return DATE_ONLY.test(value) ? `${value}T00:00:00.000Z` : value',
      ),
  },
  {
    group: "engine",
    name: "ignore knownAt, so an as-of report answers with what is known now",
    run: () => runJest("general-ledger"),
    apply: () => swap(ENGINE, "if (knownAt !== null && recorded > knownAt) {", "if (false && recorded > knownAt) {"),
  },
  {
    group: "engine",
    name: "report a movement from a zero base as 0.00%",
    run: () => runJest("general-ledger"),
    apply: () =>
      swap(
        ENGINE,
        'const changePercent = moved === null ? null : formatHundredths(moved)',
        'const changePercent = moved === null ? "0.00" : formatHundredths(moved)',
      ),
  },
  {
    group: "engine",
    name: "drop the unclassified-account refusal from the statements",
    run: () => runJest("general-ledger"),
    apply: () => swap(ENGINE, "    unclassified.length > 0\n      ? {", "    false\n      ? {"),
  },
  {
    group: "engine",
    name: "recover the statement line name from the composite key again",
    run: () => runJest("general-ledger"),
    apply: () => swap(ENGINE, "      line: value.line,", '      line: key.split(" ")[1],'),
    // the key is still in scope as the destructured first element; put it back
    also: () => {
      const text = fs.readFileSync(ENGINE, "utf8")
      fs.writeFileSync(ENGINE, text.replace(".map(([, value]) => ({", ".map(([key, value]) => ({"))
    },
  },
  {
    group: "engine",
    name: "call every referenced item matched, whatever the amounts say",
    run: () => runJest("general-ledger"),
    apply: () => swap(ENGINE, "    if (isZero(difference)) matched.push(row)", "    if (true) matched.push(row)"),
  },
  {
    group: "engine",
    name: "call a posting late by days rather than by period",
    run: () => runJest("general-ledger"),
    apply: () =>
      swap(
        ENGINE,
        ".filter((line) => periodOf(line.recordedAt) > periodOf(line.effectiveAt))",
        ".filter((line) => line.recordedAt > line.effectiveAt)",
      ),
  },
  {
    group: "engine",
    name: "stop refusing a duplicated posted line",
    run: () => runJest("general-ledger"),
    apply: () => swap(ENGINE, "  requireUniqueLineIds(lines)\n", "  void lines\n"),
  },

  // ── the adapter: apps/web/src/lib/finance.ts ───────────────────────────────
  {
    group: "adapter",
    name: "hand the stored debit-positive sign straight to the trial balance",
    run: () => runJest("finance-tie-out"),
    apply: () =>
      swap(
        ADAPTER,
        "      row.side === \"DEBIT\" ? row.amountCents : -row.amountCents,",
        "      row.amountCents,",
      ),
  },
  {
    group: "adapter",
    name: "take the magnitude of every amount, moving a contra into the other column",
    run: () => runJest("finance-tie-out"),
    apply: () =>
      swap(
        ADAPTER,
        "      row.side === \"DEBIT\" ? row.amountCents : -row.amountCents,",
        "      row.side === \"DEBIT\" ? Math.abs(row.amountCents) : Math.abs(row.amountCents),",
      ),
  },

  // ── the import guard: tests/architecture/fin-ledger-import-is-complete ─────
  {
    group: "guard",
    name: "delete the FIN-030-004 row from the ledger",
    run: runGuard,
    apply: () => {
      const text = original.get(LEDGER)
      const at = text.indexOf("- [ ] **FIN-030-004**")
      const end = text.indexOf("\n- [", at + 1)
      fs.writeFileSync(LEDGER, text.slice(0, at) + text.slice(end + 1))
    },
  },
  {
    group: "guard",
    name: "narrow a ledger row's sentence away from the Bible's",
    run: runGuard,
    apply: () =>
      swap(
        LEDGER,
        "**FIN-030-004** — Implement tax/e-invoice/statutory modes with exact availability.",
        "**FIN-030-004** — Implement tax modes.",
      ),
  },
  {
    group: "guard",
    name: "file FIN-050-004 twice, with two different statuses",
    run: runGuard,
    apply: () => {
      const text = original.get(LEDGER)
      // Anchored on a row this wave does not rewrite. An anchor on a row whose
      // checkbox changes when somebody closes the requirement makes the runner
      // throw instead of proving anything.
      const at = text.indexOf("- [ ] **FIN-GATE-000**")
      const second =
        "- [ ] **FIN-050-004** — Instrument scorecard baseline/targets/results and competitor workflow benchmarks.\n" +
        "  - Status: NOT_APPLICABLE\n" +
        "  - Reason: a second row, which ledgerStatuses() would silently prefer.\n\n"
      fs.writeFileSync(LEDGER, text.slice(0, at) + second + text.slice(at))
    },
  },
  {
    group: "guard",
    name: "file a FIN row in another execution ledger",
    run: runGuard,
    apply: () =>
      fs.writeFileSync(
        STRAY,
        "# Probe ledger\n\n- [ ] **FIN-020-001** — Implement procure-to-pay and AP exception/reconciliation.\n" +
          "  - Status: PASS\n  - Evidence: none; this file is a mutation probe.\n",
      ),
  },
  // ── the published disclosure: FIN-050-005 ─────────────────────────────────
  {
    group: "disclosure",
    name: "hand-edit the committed disclosure to call a missing capability available",
    run: runDisclosure,
    apply: () =>
      swap(
        DISCLOSURE_DOC,
        "| Fixed assets, depreciation and lease accounting | NOT AVAILABLE |",
        "| Fixed assets, depreciation and lease accounting | AVAILABLE |",
      ),
  },
  {
    group: "disclosure",
    name: "rename an export the disclosure claims, then regenerate",
    run: runDisclosure,
    regenerate: true,
    apply: () =>
      swap(
        ENGINE,
        "export function lateAdjustments(",
        "export function lateAdjustmentsRenamed(",
      ),
  },
  {
    group: "disclosure",
    name: "land a revaluation export, so the FX limitation stops being true",
    run: runDisclosure,
    regenerate: true,
    apply: () =>
      swap(
        ENGINE,
        "export type PostingSide = ",
        "export function revalueBalances() {}\n\nexport type PostingSide = ",
      ),
  },
  {
    group: "disclosure",
    name: "loosen the transactable-state parser back to the bracket-matching version",
    run: runDisclosure,
    regenerate: true,
    apply: () =>
      swap(
        DISCLOSURE_TOOL,
        "/STATES_REQUIRING_APPROVAL[\\s\\S]*?=\\s*\\[([\\s\\S]*?)\\]/",
        "/STATES_REQUIRING_APPROVAL[^[]*\\[([^\\]]*)\\]/",
      ),
  },
  {
    group: "disclosure",
    name: "make the exported-symbol probe find nothing at all",
    run: runDisclosure,
    regenerate: true,
    apply: () =>
      swap(
        DISCLOSURE_TOOL,
        "      if (pattern.test(symbol.name)) hits.push({ path: rel, line: symbol.line, name: symbol.name })",
        "      if (false) hits.push({ path: rel, line: symbol.line, name: symbol.name })",
      ),
  },

  {
    group: "guard",
    name: "repoint the FIN prefix at another ledger in the importer",
    run: runGuard,
    apply: () =>
      swap(
        IMPORTER,
        'FIN: "financial-management-execution-ledger.md"',
        'FIN: "payments-treasury-execution-ledger.md"',
      ),
  },
]

const only = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length)
const selected = only ? MUTATIONS.filter((m) => m.group === only) : MUTATIONS

console.log(`baseline`)
const baselines = new Map()
for (const group of new Set(selected.map((m) => m.group))) {
  const first = selected.find((m) => m.group === group)
  const result = first.run()
  const failedCount = result.failedCount ?? result.failed.length
  baselines.set(group, result)
  console.log(`  ${group}: ${result.total - failedCount}/${result.total} passing`)
  if (failedCount > 0) {
    console.error(`Refusing to run: ${group} is already red.`)
    process.exit(1)
  }
}

let allCaught = true
for (const m of selected) {
  m.apply()
  if (m.also) m.also()
  if (m.regenerate) regenerateDisclosure()
  const mutated = m.run()
  const mutatedFailures = mutated.failedCount ?? mutated.failed.length
  restore()
  if (m.regenerate) regenerateDisclosure()
  const after = m.run()
  const afterFailures = after.failedCount ?? after.failed.length
  const caught = mutatedFailures > 0 && afterFailures === 0
  allCaught = allCaught && caught
  console.log(`\n${caught ? "CAUGHT" : "MISSED"}  [${m.group}] ${m.name}`)
  console.log(`  ${mutatedFailures} of ${mutated.total} failed`)
  for (const f of mutated.failed) console.log(`    - ${f}`)
  console.log(`  restored: ${after.total - afterFailures}/${after.total}`)
}

console.log(`\n${allCaught ? "every mutation was caught" : "A MUTATION WAS NOT CAUGHT"}`)
process.exit(allCaught ? 0 : 1)
