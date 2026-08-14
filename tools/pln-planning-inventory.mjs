/**
 * PLN-000-001 — derive the planning/budget/report inventory from the tree.
 *
 * The requirement is "inventory current budget/planning/report code and false
 * EPM claims". A hand-written list would be stale the day after it was written
 * and unfalsifiable the whole time, so this derives the file set from the
 * repository and the canonical-object set from the Bible, and the guard test
 * `tests/architecture/pln-planning-inventory.test.mjs` re-derives both and
 * compares them against the committed document.
 *
 * Determinism, because a generated artefact that differs between a Windows
 * checkout and a Linux CI runner is worse than no artefact:
 *   - directories are read in `sort()` order, never `readdirSync` order;
 *   - paths are POSIX-normalised before they are sorted or printed;
 *   - file text is CRLF-normalised before it is matched;
 *   - nothing here reads a clock, a hostname, a git ref or an absolute path.
 *
 * This file is NOT wired into `npm run generate`: package.json is shared and
 * this domain does not own it. The guard test is what keeps the output honest —
 * it fails on drift rather than silently rewriting.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/** Read a file with line endings normalised, so a CRLF checkout matches LF CI. */
export function readText(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n")
}

/** `a\b\c` -> `a/b/c`, so sort order and printed rows do not depend on the OS. */
function posix(p) {
  return p.split(path.sep).join("/")
}

/**
 * The signal that a source file is budget/planning code.
 *
 * Named tokens rather than a loose keyword sweep: "budget" alone matches the
 * AI token budget (`model-budget.test.ts`) and the error budget in the SLO job,
 * neither of which is money. Every token below is either a column of the three
 * budget tables or the name of an exported budget calculation.
 */
export const ANCHORS = [
  "BudgetLine",
  "BudgetPeriod",
  "allocatedCents",
  "budgetedCents",
  "db.budget",
  "db.budgetLine",
  "forecastCents",
  "parseBudgetSheet",
  "rollUpPortfolio",
]

const ANCHOR_RE = new RegExp(
  ANCHORS.map((a) => a.replace(/\./g, "\\.")).map((a) => `\\b${a}\\b`).join("|"),
  "g",
)

/** Roots scanned for planning code. Sorted; each is walked in sorted order. */
export const SCAN_ROOTS = ["apps/system-studio/src", "apps/web/src", "modules", "packages"]

const SOURCE_EXT = new Set([".ts", ".tsx", ".mjs"])
/** Tests are evidence about the code, not the code. Inventoried separately. */
const TEST_RE = /\.(test|itest|spec)\.[cm]?[jt]sx?$/

function walk(relativeDir, out) {
  const abs = path.join(ROOT, relativeDir)
  if (!fs.existsSync(abs)) return
  for (const name of fs.readdirSync(abs).sort()) {
    if (name === "node_modules" || name === ".next" || name === "dist") continue
    const rel = `${relativeDir}/${name}`
    const stat = fs.statSync(path.join(ROOT, rel))
    if (stat.isDirectory()) walk(rel, out)
    else if (SOURCE_EXT.has(path.extname(name))) out.push(rel)
  }
}

/**
 * Every non-test source file carrying a budget anchor, with the anchors it
 * carries. Sorted by POSIX path; anchors sorted within a row.
 */
export function deriveCode() {
  const files = []
  for (const root of SCAN_ROOTS) walk(root, files)
  const rows = []
  for (const rel of files.map(posix).sort()) {
    if (TEST_RE.test(rel)) continue
    const hits = readText(rel).match(ANCHOR_RE)
    if (!hits) continue
    rows.push({ path: rel, anchors: [...new Set(hits)].sort() })
  }
  return rows
}

/** The same sweep restricted to test files — the evidence half of the inventory. */
export function deriveTests() {
  const files = []
  for (const root of SCAN_ROOTS) walk(root, files)
  const rows = []
  for (const rel of files.map(posix).sort()) {
    if (!TEST_RE.test(rel)) continue
    const hits = readText(rel).match(ANCHOR_RE)
    if (!hits) continue
    rows.push({ path: rel, anchors: [...new Set(hits)].sort() })
  }
  return rows
}

export const BIBLE = "Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md"
export const SCHEMA = "apps/web/prisma/schema.prisma"
/** AWS Budgets on the operator plane — named in the document, not a row in it. */
export const OPERATOR_BUDGETS = "apps/system-studio/src/lib/aws/budgets.ts"

/**
 * The 36 objects section 3 of the Bible says to implement "at minimum",
 * read from the Bible rather than copied out of it — a copied list stops
 * agreeing with the specification the moment the specification moves.
 */
export function bibleObjects() {
  const text = readText(BIBLE)
  const start = text.indexOf("\n## 3. Canonical objects\n")
  if (start < 0) throw new Error(`${BIBLE}: section 3 not found`)
  const end = text.indexOf("\nEvery cell/value includes", start)
  if (end < 0) throw new Error(`${BIBLE}: section 3 has no closing sentence`)
  const names = [...text.slice(start, end).matchAll(/^- `([A-Za-z][A-Za-z0-9]*)`$/gm)].map(
    (m) => m[1],
  )
  if (names.length === 0) throw new Error(`${BIBLE}: section 3 listed no objects`)
  return names
}

/** Every `model X` declared in the tenant schema. */
export function schemaModels() {
  return new Set([...readText(SCHEMA).matchAll(/^model\s+([A-Za-z][A-Za-z0-9_]*)\s*\{/gm)].map((m) => m[1]))
}

/** Bible object -> is there a Prisma model of that exact name? */
export function deriveObjectMapping() {
  const models = schemaModels()
  return bibleObjects().map((name) => ({ name, present: models.has(name) }))
}

/**
 * The three surfaces that re-total budget cents with a raw `reduce`/`_sum`
 * instead of `summarize()`.
 *
 * This is not a style note. `summarize()` throws `MixedCurrencyError` when the
 * lines it is given disagree on currency, which is the whole point of
 * PAY-080-004 — `rollUpPortfolio` exists because the portfolio page used to add
 * yen to dollars and render the result with a dollar sign. These three add the
 * cents directly and format the result with `formatCents`, so the same defect
 * is live on them. Derived, not asserted: the pattern is looked for in the file.
 */
export const UNGUARDED_TOTAL_RE =
  /budgetLine\.aggregate\([\s\S]{0,400}?_sum|reduce\(\([^)]*\)\s*=>\s*[A-Za-z_$][\w$]*\s*\+\s*[A-Za-z_$][\w$]*\.(?:budgetedCents|actualCents)\s*,/

/** A file is guarded when the total goes through the guard, not around it. */
export const GUARDED_RE = /\b(summarize|rollUpPortfolio)\(/

export function deriveUnguardedTotals() {
  return deriveCode()
    .filter((row) => {
      const text = readText(row.path)
      return UNGUARDED_TOTAL_RE.test(text) && !GUARDED_RE.test(text)
    })
    .map((row) => row.path)
}

/**
 * Every production site that WRITES a budget table.
 *
 * `modules/index.ts` claims "apps/web/src/lib/finance.ts is the only writer".
 * `finance.ts` imports no database client at all; this is the real list.
 */
export const WRITE_RE =
  /\bdb\.(budget|budgetLine|transaction)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g

export function deriveWriters() {
  const rows = []
  for (const row of deriveCode()) {
    const hits = readText(row.path).match(WRITE_RE)
    if (hits) rows.push({ path: row.path, writes: [...new Set(hits)].sort() })
  }
  return rows.sort((a, b) => (a.path < b.path ? -1 : 1))
}

/**
 * What each inventoried file actually is.
 *
 * Curated because "what this code does" cannot be derived, and every line was
 * written after opening the file. `render()` refuses to emit a document when a
 * derived path has no note or a note names a path the sweep did not find, so
 * the curation cannot drift away from the tree without the guard test saying so.
 */
export const NOTES = {
  "apps/web/src/app/(app)/admin/actions.ts": [
    "server action",
    "`db.budget.update` sets `allocatedCents` and notes on one Budget row. The only writer of the Budget table.",
  ],
  "apps/web/src/app/(app)/approvals/[id]/page.tsx": [
    "surface",
    "Reads one BudgetLine's `budgetedCents`/`actualCents` to show what is left on the line an approval would spend against.",
  ],
  "apps/web/src/app/(app)/approvals/actions.ts": [
    "server action",
    "On approval, increments `BudgetLine.actualCents` by the budget-dimensioned side of the journal. Relative increment, inside the deciding transaction.",
  ],
  "apps/web/src/app/(app)/dashboard/page.tsx": [
    "surface",
    "`db.budgetLine.aggregate({_sum})` per organization for the home dashboard's spend bars. Sums in the database, so no currency check runs.",
  ],
  "apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts": [
    "server action",
    "The club finance writer: upsert/delete a BudgetLine, import a parsed sheet, and `saveForecast`, which writes `forecastCents` per line.",
  ],
  "apps/web/src/app/(app)/orgs/[slug]/finance/page.tsx": [
    "surface",
    "Loads a club's BudgetLine rows for one academic year and hands them to FinanceDashboard. Totals them with a raw reduce for the '% of budget spent' badge. Subtitle: 'actual vs budget ... with editable forecasting'.",
  ],
  "apps/web/src/app/(app)/orgs/[slug]/handoff/page.tsx": [
    "surface",
    "Sums `budgetedCents`/`actualCents` with a raw reduce for the outgoing board's handoff summary.",
  ],
  "apps/web/src/app/(app)/orgs/[slug]/impact/page.tsx": [
    "surface",
    "Sums `budgetedCents`/`actualCents` with a raw reduce for the club impact narrative.",
  ],
  "apps/web/src/app/api/templates/budget/route.ts": [
    "route",
    "Generates the standard club budget workbook on request — ten fixed categories whose headers are the ones `parseBudgetSheet` detects. The template IS the planning model: the category axis is a hard-coded literal, not a dimension.",
  ],
  "apps/web/src/lib/platform/tenant-export.ts": [
    "platform",
    "`Budget: () => db.budget.findMany()` — the budget tables in the tenant data export, read inside the tenant scope.",
  ],
  "apps/web/src/app/(app)/reports/finance/page.tsx": [
    "surface",
    "The institution portfolio: every club's lines through `rollUpPortfolio`, totalled per currency. The only multi-organization roll-up.",
  ],
  "apps/web/src/components/finance/BudgetBarChart.tsx": [
    "component",
    "Budgeted vs projected bars per category. Presentation only.",
  ],
  "apps/web/src/components/finance/BudgetUpload.tsx": [
    "component",
    "Client-side spreadsheet preview: parses the workbook, then totals the detected rows with a raw reduce before an import is committed.",
  ],
  "apps/web/src/components/finance/FinanceDashboard.tsx": [
    "component",
    "The grid. Projected = actual, else saved `forecastCents`, else budget; variance = budgeted - projected, recomputed as a number is typed. One flat category axis, one year, no version.",
  ],
  "apps/web/src/components/finance/LedgerDrawer.tsx": [
    "component",
    "Per-category drawer: the ledger entries behind one line's actual, against its budgeted figure.",
  ],
  "apps/web/src/lib/finance.ts": [
    "domain logic",
    "Pure calculation and sheet parsing: `summarize`, `rollUpPortfolio`, `parseBudgetSheet`, `financeIntegrity`, ledger signing. Imports no database client and writes nothing.",
  ],
  "apps/web/src/lib/tenancy/registry.ts": [
    "tenancy",
    "Declares Budget reachable via `Budget.institutionId`, Transaction via `Budget.institutionId` and BudgetLine via `Organization.institutionId` — how the tenant guard reaches each budget table.",
  ],
  "modules/index.ts": [
    "module manifest",
    "The `budgeting` ModuleManifest: objects, tiers budget/ledger/consolidation, permissions, and seventeen dimension verdicts. There is no `planning` manifest.",
  ],
  "packages/finops/src/settlement.ts": [
    "package",
    "Reconciliation arithmetic reused by `financeIntegrity`; its header names `BudgetLine.actualCents` as the balance it reconciles against.",
  ],
}

function table(headers, rows) {
  const out = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`]
  for (const row of rows) out.push(`| ${row.join(" | ")} |`)
  return out.join("\n")
}

/** The committed document, byte-for-byte. */
export function render() {
  const code = deriveCode()
  const tests = deriveTests()
  const objects = deriveObjectMapping()
  const writers = deriveWriters()
  const unguarded = deriveUnguardedTotals()

  const missingNote = code.map((r) => r.path).filter((p) => !(p in NOTES))
  if (missingNote.length > 0) {
    throw new Error(
      `PLN-000-001: these files carry a budget anchor and no note — open them and describe them:\n  ${missingNote.join("\n  ")}`,
    )
  }
  const derived = new Set(code.map((r) => r.path))
  const orphanNote = Object.keys(NOTES).sort().filter((p) => !derived.has(p))
  if (orphanNote.length > 0) {
    throw new Error(`PLN-000-001: notes describe files the sweep did not find:\n  ${orphanNote.join("\n  ")}`)
  }

  const present = objects.filter((o) => o.present)
  const absent = objects.filter((o) => !o.present)

  return `# PLN-000-001 — planning, budget and report inventory

Generated by \`tools/pln-planning-inventory.mjs\`. Do not edit by hand: the
guard \`tests/architecture/pln-planning-inventory.test.mjs\` re-derives every
table below from the tree and fails on any difference, so an edit here that the
repository does not support is a failing test rather than a believed sentence.

The sweep looks for ${ANCHORS.length} anchors — \`${ANCHORS.join("`, `")}\` — under
${SCAN_ROOTS.map((r) => `\`${r}\``).join(", ")}. Named columns and named functions rather
than the word "budget", because the word also names the AI token budget and the
SLO error budget, and neither is money.

## 1. Budget and planning code — ${code.length} files

${table(
  ["File", "Kind", "What it actually does"],
  code.map((r) => [`\`${r.path}\``, NOTES[r.path][0], NOTES[r.path][1]]),
)}

## 2. Tests over that code — ${tests.length} files

${table(["File", "Anchors"], tests.map((r) => [`\`${r.path}\``, r.anchors.map((a) => `\`${a}\``).join(", ")]))}

## 3. Every production writer of a budget table — ${writers.length} files

${table(
  ["File", "Writes"],
  writers.map((r) => [`\`${r.path}\``, r.writes.map((w) => `\`${w}\``).join(", ")]),
)}

**False claim, and it is in the module manifest.** \`modules/index.ts\` records
the \`budgeting\` module's \`state-machines-and-effective-dating\` dimension as
\`pass\` on the grounds that "apps/web/src/lib/finance.ts is the only writer".
\`finance.ts\` imports no database client and writes nothing; the writers are the
${writers.length} files above. Correcting the manifest means editing
\`modules/index.ts\`, which is shared with every other domain, so this inventory
records the defect and does not touch it.

## 4. Totals taken without the currency guard — ${unguarded.length} ${unguarded.length === 1 ? "surface" : "surfaces"}

${unguarded.map((p) => `- \`${p}\``).join("\n")}

Derived, not asserted: a file is listed when it totals \`budgetedCents\` or
\`actualCents\` across lines — with \`reduce\`, or in the database with
\`budgetLine.aggregate({_sum})\` — and calls neither \`summarize()\` nor
\`rollUpPortfolio()\`.

\`summarize()\` throws \`MixedCurrencyError\` when the lines handed to it disagree
on currency; that is why \`rollUpPortfolio\` exists (PAY-080-004 — the portfolio
page used to add yen to dollars and print the result with a dollar sign). These
surfaces add the cents directly and put the sum in front of a user — as money,
or as a percentage of a total computed the same way — so the same defect is
live on them. They are club-level today, where a single club
rarely mixes currencies; that is a reason it has not been noticed, not a reason
it is correct. \`apps/web/src/lib/finance.ts\` is not listed and does total cents:
it is where \`summarize\` lives, its \`reduce\` hits are its own doc comment quoting
the old bug and a reconciliation that takes its currency as a parameter.

## 5. Canonical objects the Bible requires vs the schema — ${present.length} of ${objects.length} present

Section 3 of \`${BIBLE}\` lists ${objects.length} objects to implement "at minimum".
Read from the Bible, not copied from it. Present = a \`model\` of that exact name
in \`${SCHEMA}\`.

${table(["Object", "In schema"], objects.map((o) => [`\`${o.name}\``, o.present ? "yes" : "**no**"]))}

${
  present.length === 0
    ? "None of them exist."
    : `Present: ${present.map((o) => `\`${o.name}\``).join(", ")}.`
} Absent: ${absent.length} of ${objects.length}.

## 6. What this means

There is no planning system in this repository. What exists is single-currency,
single-year, single-version club budgeting: a flat list of \`BudgetLine\`
categories per organization per academic year, an optional \`forecastCents\`
override per line, and one cross-organization roll-up. There is no dimension,
no hierarchy, no measure type, no time grain, no scenario, no plan version, no
calculation rule, no lineage on a value and no decision record — the platform
cannot say who proposed a number or why.

Nothing in the product markets itself as EPM, so the false claims are internal:
the manifest's "only writer" sentence in section 3, and the tiers list
\`["budget", "ledger", "consolidation"]\` in the same manifest, whose third tier
names a consolidation that is one currency-grouped roll-up query
(\`rollUpPortfolio\`) with no elimination, no ownership percentage and no
intercompany step.

The only forecast in this repository produced by anything that forecasts is
AWS's, in \`${OPERATOR_BUDGETS}\` — Tenure's own cloud spend, on the operator
plane, reading no tenant data. It carries none of the anchors above and is not
a row in section 1 for that reason; it is named here so a reader looking for
"the forecast code" is not sent to it by mistake.
`
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("pln-planning-inventory.mjs")) {
  const out = "docs/architecture/pln-planning-inventory.md"
  fs.writeFileSync(path.join(ROOT, out), render(), "utf8")
  process.stdout.write(`wrote ${out}\n`)
}
