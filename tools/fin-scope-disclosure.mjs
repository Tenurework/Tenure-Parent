#!/usr/bin/env node
/**
 * FIN-050-005 — publish the exact accounting basis, jurisdiction, provider and
 * capability limitations of this platform's finance, derived from the code.
 *
 * The Bible's §23 says finance is done "for exact enabled scopes … global/
 * specialized modes disclose limits", and §24 forbids claiming a capability
 * nothing supports. A hand-written limitations page satisfies neither for long:
 * it is correct on the day it is written and silently wrong afterwards, and the
 * direction it rots in is always the same — capabilities land and the page keeps
 * disclaiming them, or the page keeps promising ones that were removed.
 *
 * So every figure and every row below is DERIVED, and each is derived in a shape
 * that can contradict itself:
 *
 *   · An AVAILABLE row names a module, a test and the symbols the module must
 *     export. If any of the three is missing the row is emitted as
 *     `CONTRADICTED`, not quietly downgraded, and
 *     `tests/architecture/fin-scope-disclosure.test.mjs` fails on any such row.
 *   · A NOT AVAILABLE row names the probes that would prove it wrong — Prisma
 *     models and exported symbol names. If a probe hits, the row is
 *     `CONTRADICTED` and names the hit. That is what makes a limitation
 *     impossible to leave standing after the limitation is fixed.
 *
 * This is the same machinery as `tools/fin-finance-surface.mjs` (FIN-000-001) and
 * imports its readers rather than re-deriving the tree, because two walkers of
 * the same directories will disagree and the only question is when.
 *
 * Determinism: directories are read then sorted by code point, paths are POSIX,
 * every file is CRLF-normalised before it is scanned, nothing hashes raw bytes
 * and nothing shells out to git.
 *
 * Usage:  node tools/fin-scope-disclosure.mjs [--check]
 *   --check  exit non-zero if the committed document is out of date
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  ROOT,
  ROOTS,
  SCHEMA,
  byCodePoint,
  canonicalObjects,
  facetsOf,
  filesUnder,
  read,
  schemaDeclares,
} from "./fin-finance-surface.mjs"

export const OUT = "docs/architecture/fin-accounting-scope-disclosure.md"
const REGISTRY = "packages/payments/src/capability-registry.ts"
const POSTING = "packages/payments/src/posting.ts"

/* ------------------------------------------------------------------ scanning */

/** Every scannable source path once, code-point sorted. */
export function sourceFiles() {
  const out = []
  for (const r of ROOTS) filesUnder(r, out)
  return [...new Set(out)].sort(byCodePoint)
}

/**
 * The finance surface only — the files FIN-000-001's classifier calls finance.
 *
 * Scoped deliberately, and not for speed. A vocabulary table derived from the
 * WHOLE tree makes this document a function of every other domain's comments: one
 * agent writing the word "accrual" in a scheduling module would red this
 * generator's `--check` and change a published finance disclosure. It happened on
 * the first run of this file, from a different direction — the header carried a
 * total file count, and the count moved because unrelated work landed while this
 * was being written.
 *
 * An accounting-basis claim would be made in accounting code. Everything below
 * that reads text reads this set; everything that reads DECLARATIONS (Prisma
 * models, exported symbol names) still reads the whole tree, because those are
 * rare and specific enough not to move under unrelated work.
 */
export function financeFiles(files = sourceFiles()) {
  return files.filter((rel) => facetsOf(rel).length > 0)
}

export function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel))
}

/** Paths whose text matches, with the first matching line number of each. */
export function filesMatching(pattern, files) {
  const hits = []
  for (const rel of files) {
    const text = read(rel)
    const lines = text.split("\n")
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        hits.push({ path: rel, line: i + 1 })
        break
      }
    }
  }
  return hits
}

/**
 * Every exported symbol name in a file, with its line.
 *
 * Declaration-anchored on purpose, and the lesson is recorded because it cost a
 * false CONTRADICTED on the first run: a probe for the WORD `revaluation` hit
 * `apps/web/src/app/(app)/calendar/actions.ts:110`, a comment reading "cannot
 * silently revalue a request in flight". A capability is code, not vocabulary —
 * an implementation of revaluation would EXPORT something — so a prose mention
 * must not be able to contradict a limitation, and a limitation must not be
 * disprovable by somebody writing a sentence.
 */
export function exportedSymbols(rel) {
  const lines = read(rel).split("\n")
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^export\s+(?:async\s+)?(?:function|const|class|enum)\s+(\w+)/.exec(lines[i])
    if (m) out.push({ name: m[1], line: i + 1 })
  }
  return out
}

/** Exported symbols across the tree whose NAME matches. */
export function exportsMatching(pattern, files) {
  const hits = []
  for (const rel of files) {
    for (const symbol of exportedSymbols(rel)) {
      if (pattern.test(symbol.name)) hits.push({ path: rel, line: symbol.line, name: symbol.name })
    }
  }
  return hits
}

/** Does this module export this name? Read from the file, not from a bundle. */
export function exportsSymbol(rel, name) {
  if (!exists(rel)) return false
  return new RegExp(
    `export\\s+(?:async\\s+)?(?:function|const|class|interface|type)\\s+${name}\\b`,
  ).test(read(rel))
}

/* -------------------------------------------------------- section A: basis */

/**
 * A declaration of an accounting basis, in the only shapes that would be one:
 * a Prisma model or enum, or a TypeScript declaration whose name ends in Basis.
 *
 * Deliberately NOT a search for the words. "accrual" appears in a comment in
 * `packages/finops/src/general-ledger.ts` describing a reconciliation example,
 * and a disclosure that counted that as support for accrual accounting would be
 * exactly the overstatement this document exists to prevent. The words are
 * reported separately, as prose.
 */
export const BASIS_VOCABULARY = [
  ["accrual", /\baccrual\b/i],
  ["cash basis", /\bcash basis\b/i],
  ["modified accrual", /\bmodified accrual\b/i],
  ["GAAP", /\bGAAP\b/],
  ["IFRS", /\bIFRS\b/],
  ["ASC 606", /\bASC\s?606\b/],
  ["IAS 21", /\bIAS\s?21\b/],
]

/**
 * Names that would BE an accounting basis, not names that end in the word.
 *
 * The first run of this generator reported five "declared" bases —
 * `VerdictBasis` (an AWS health verdict), `SpreadBasis` (a planning spread),
 * `SupportBasis` (a support-session justification) and `FluxBasis` twice (this
 * module's own reason-a-percentage-could-not-be-computed enum). Every one is a
 * different meaning of an English word, and a disclosure that counted them would
 * have announced an accounting basis this platform does not have.
 */
const BASIS_NAME = /^(AccountingBasis|LedgerBasis|ReportingBasis|StatutoryBasis|Basis)$/

export function accountingBasis(files) {
  const schema = read(SCHEMA)
  const declarations = [
    ...[...schema.matchAll(/^(model|enum)\s+(\w+)\s*\{/gm)]
      .filter((m) => BASIS_NAME.test(m[2]))
      .map((m) => ({ path: SCHEMA, declaration: `${m[1]} ${m[2]}` })),
    ...files.flatMap((rel) =>
      [...read(rel).matchAll(/^\s*(?:export\s+)?(?:const|enum|type|interface)\s+(\w+)\b/gm)]
        .filter((m) => BASIS_NAME.test(m[1]))
        .map((m) => ({ path: rel, declaration: m[1] })),
    ),
  ]
  const vocabulary = BASIS_VOCABULARY.map(([term, pattern]) => ({
    term,
    files: filesMatching(pattern, financeFiles(files)).map((h) => h.path),
  }))
  return { declarations, vocabulary }
}

/* --------------------------------------------------- section B: currencies */

export function currencyFacts(files) {
  const schema = read(SCHEMA)
  const currencyFields = []
  let model = null
  for (const raw of schema.split("\n")) {
    const open = /^model\s+(\w+)\s*\{/.exec(raw)
    if (open) model = open[1]
    else if (/^\}/.test(raw)) model = null
    else if (model && /^\s{2}currency\s+\S/.test(raw)) currencyFields.push(model)
  }
  return {
    currencyFields: currencyFields.sort(byCodePoint),
    // The value type every amount in the platform packages travels in.
    integerMinorUnits: exportsSymbol("packages/finops/src/money.ts", "money"),
    nonHundredthCurrencies: exportsSymbol("packages/finops/src/money.ts", "minorDigits"),
    conversion: exportsSymbol("packages/finops/src/settlement-components.ts", "convert"),
    rateStore: ["Rate", "ExchangeRate", "FxRate", "CurrencyRate"].filter((name) =>
      schemaDeclares(schema, name),
    ),
    trialBalancePerCurrency: exportsSymbol("packages/finops/src/general-ledger.ts", "trialBalance"),
    files,
  }
}

/* ------------------------------------------- section C: jurisdiction and tax */

export const JURISDICTION_SENSES = [
  [
    "data residency and provider country",
    /jurisdiction/i,
    "packages/payments/src/capability-registry.ts",
  ],
]

export function taxFacts(files) {
  // Exported symbols, not words: a comment about tax is not tax determination.
  const determination = exportsMatching(
    /^(taxRate|TAX_RATES|determineTax|taxJurisdiction|vatRate|salesTax|withholdingRate)$/,
    files,
  )
  const eInvoicing = exportsMatching(/^(eInvoice|issueEInvoice|transmitEInvoice|statutoryReport)$/, files)
  const taxAccounts = exists(POSTING)
    ? [...read(POSTING).matchAll(/export const (\w*TAX\w*) = "([^"]+)"/g)].map((m) => ({
        symbol: m[1],
        account: m[2],
      }))
    : []
  // Two named examples rather than every file in the tree that says the word.
  // The claim being made is about the SENSE the platform uses "jurisdiction" in,
  // and two files a reader can open prove it as well as fifteen — while a
  // tree-wide list would change every time any domain mentioned the word.
  const jurisdictionExamples = [
    "packages/payments/src/capability-registry.ts",
    "packages/provisioning/src/catalogs.ts",
  ].filter((rel) => exists(rel))
  return { determination, eInvoicing, taxAccounts, jurisdictionExamples }
}

/* -------------------------------------------------- section D: providers */

/**
 * The payment/treasury capability registry's own answer about itself.
 *
 * Parsed out of the source rather than imported: this file is `.mjs` run by bare
 * node, and `capability-registry.ts` is TypeScript compiled only by the apps. A
 * parser is the honest option; guessing the numbers is not.
 */
export function providerFacts() {
  if (!exists(REGISTRY)) return null
  const text = read(REGISTRY)

  const stateOfHelper = {}
  for (const m of text.matchAll(/^function (\w+)\(/gm)) {
    const start = m.index
    const end = text.indexOf("\n}", start)
    const body = text.slice(start, end < 0 ? text.length : end)
    const state = /state:\s*"([A-Z_]+)"/.exec(body)?.[1]
    if (state) stateOfHelper[m[1]] = state
  }

  const arrayStart = text.indexOf("export const PAYMENT_CAPABILITIES")
  const arrayEnd = text.indexOf("\n]", arrayStart)
  const array = arrayStart < 0 ? "" : text.slice(arrayStart, arrayEnd)
  const byState = {}
  let total = 0
  for (const m of array.matchAll(/\n\s{2}(\w+)\(/g)) {
    const state = stateOfHelper[m[1]]
    if (!state) continue
    byState[state] = (byState[state] ?? 0) + 1
    total++
  }

  // `[\s\S]*?=\s*\[`, not `[^[]*\[`: the declaration reads
  // `STATES_REQUIRING_APPROVAL: readonly CapabilityState[] = [`, and the loose
  // version matched the EMPTY brackets of the type annotation — which reported
  // zero transactable states and printed "only in ;" into the document. A parser
  // that finds nothing must not read as an answer.
  const approvalBlock = /STATES_REQUIRING_APPROVAL[\s\S]*?=\s*\[([\s\S]*?)\]/.exec(text)?.[1] ?? ""
  const transactableStates = [...approvalBlock.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]).sort(byCodePoint)
  const transactable = transactableStates.reduce((n, state) => n + (byState[state] ?? 0), 0)

  return {
    total,
    byState: Object.fromEntries(Object.entries(byState).sort(([a], [b]) => byCodePoint(a, b))),
    transactableStates,
    transactable,
  }
}

/* ------------------------------------------------- section E: capabilities */

/**
 * What finance can do, and what it cannot, as rows that check themselves.
 *
 * `requires` on an AVAILABLE row is the list of exported names the module has to
 * carry. `absent` on a NOT AVAILABLE row is the list of things whose EXISTENCE
 * would disprove it. Neither is decoration: the generator resolves both and
 * marks a row CONTRADICTED rather than emitting a claim it cannot support.
 */
export const CAPABILITY_ROWS = [
  {
    capability: "Balanced double-entry journals, refused rather than repaired when they do not balance",
    module: "packages/payments/src/posting.ts",
    test: "packages/payments/src/posting.test.ts",
    requires: ["buildJournal"],
  },
  {
    capability: "Trial balance and per-journal tie-out, by currency, as-of a date and as-known-at an instant",
    module: "packages/finops/src/general-ledger.ts",
    test: "packages/finops/src/general-ledger.test.ts",
    requires: ["trialBalance", "accountAnalysis"],
  },
  {
    capability: "Flux/variance with the reason a percentage could not be computed",
    module: "packages/finops/src/general-ledger.ts",
    test: "packages/finops/src/general-ledger.test.ts",
    requires: ["flux"],
  },
  {
    capability: "Balance sheet and income statement against a caller-stated chart classification",
    module: "packages/finops/src/general-ledger.ts",
    test: "packages/finops/src/general-ledger.test.ts",
    requires: ["financialStatements"],
  },
  {
    capability: "Item-level account reconciliation, naming the item rather than the variance",
    module: "packages/finops/src/general-ledger.ts",
    test: "packages/finops/src/general-ledger.test.ts",
    requires: ["reconcileAccountBalance"],
  },
  {
    capability: "Late-posting detection by accounting period",
    module: "packages/finops/src/general-ledger.ts",
    test: "packages/finops/src/general-ledger.test.ts",
    requires: ["lateAdjustments"],
  },
  {
    capability: "Cache-versus-journal reconciliation for every budget line",
    module: "apps/web/src/lib/finance.ts",
    test: "apps/web/src/lib/finance-integrity.test.ts",
    requires: ["financeIntegrity"],
  },
  {
    capability: "Correction by reversal only — posted history is never edited",
    module: "apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts",
    test: "tests/security/ledger-is-not-deleted.test.mjs",
    requires: ["reverseLedgerEntry"],
  },
  {
    capability: "Exact decimal money with a per-currency minor unit and a stated rounding mode",
    module: "packages/finops/src/money.ts",
    test: "packages/finops/src/finops.test.ts",
    requires: ["money", "minorDigits", "roundToInteger"],
  },
  {
    capability: "Currency conversion at a rate carrying its own date",
    module: "packages/finops/src/settlement-components.ts",
    test: "packages/finops/src/settlement.test.ts",
    requires: ["convert"],
  },

  // ── and what is not here ──────────────────────────────────────────────────
  {
    capability: "Legal entity, chart of accounts, ledger, book and fiscal calendar as records",
    absent: {
      schemaModels: ["LegalEntity", "ChartOfAccounts", "AccountingAccount", "Ledger", "Book", "FiscalCalendar"],
    },
    wouldProvideIt:
      "`FIN-000-002`, which is BLOCKED_EXTERNAL on `apps/web/prisma/schema.prisma` and a migration",
  },
  {
    capability: "Period open / close / reopen, and a posting refused for period state",
    absent: {
      schemaModels: ["Period", "AccountingPeriod", "CloseTask"],
      exportedLike: [/^(openPeriod|closePeriod|reopenPeriod|periodIsOpen|assertPeriodOpen)$/],
    },
    wouldProvideIt: "`FIN-010-002`, which needs the period table `FIN-000-002` is blocked on",
  },
  {
    capability: "Accounting event, subledger document and a journal header with a status",
    absent: {
      schemaModels: ["AccountingEvent", "AccountingRule", "SubledgerDocument", "SubledgerEntry", "Journal"],
    },
    wouldProvideIt: "`FIN-000-003`, which is BLOCKED_EXTERNAL on the same schema file",
  },
  {
    capability: "A stored exchange rate, revaluation and translation",
    absent: {
      schemaModels: ["Rate", "ExchangeRate", "FxRate"],
      exportedLike: [/^(revalue|revalueBalances|translateTrialBalance|cumulativeTranslationAdjustment|unrealizedGainLoss|realizedGainLoss)$/],
    },
    wouldProvideIt:
      "`FIN-030-001`; the conversion arithmetic exists (`convert`) and has nowhere to read a rate from",
  },
  {
    capability: "Tax determination, tax jurisdiction packs and e-invoicing",
    absent: {
      exportedLike: [/^(taxRate|TAX_RATE|determineTax|taxJurisdiction|vatRate|salesTax|TAX_RATES|JURISDICTION_PACKS)$/, /^(eInvoice|issueEInvoice|transmitEInvoice)$/],
    },
    wouldProvideIt:
      "`FIN-030-004`; a tax amount supplied by a caller is posted to a recoverable-tax account and nothing computes one",
  },
  {
    capability: "Intercompany transactions, consolidation runs and eliminations",
    absent: {
      schemaModels: ["IntercompanyTransaction", "ConsolidationRun"],
      exportedLike: [/^(intercompany|matchIntercompany|consolidate|consolidationRun|eliminate|eliminations)$/i],
    },
    wouldProvideIt: "`FIN-030-002`",
  },
  {
    capability: "Encumbrance, fund, grant and budgetary control",
    absent: {
      schemaModels: ["Fund", "Grant", "Encumbrance", "ControlBudget"],
      exportedLike: [/^(encumber|releaseEncumbrance|availableFunds|checkFunds|reserveFunds)$/],
    },
    wouldProvideIt:
      "`FIN-030-003`; `LedgerEntry.fundCode` is a free-text code with no fund record behind it",
  },
  {
    capability: "Fixed assets, depreciation and lease accounting",
    absent: {
      schemaModels: ["FixedAsset", "AssetBook", "DepreciationSchedule", "Lease"],
      exportedLike: [/^(depreciate|depreciation|depreciationSchedule|capitalize)$/i],
    },
    wouldProvideIt: "`FIN-020-004`",
  },
  {
    capability: "Revenue recognition, performance obligations and contract assets",
    absent: {
      schemaModels: ["PerformanceObligation", "RevenueSchedule", "ContractAsset"],
      exportedLike: [/^(recognizeRevenue|revenueSchedule|allocateTransactionPrice|performanceObligations)$/],
    },
    wouldProvideIt: "`FIN-020-003`",
  },
  {
    capability: "Bank statement import and bank-to-book reconciliation",
    absent: {
      schemaModels: ["BankAccount", "BankStatement", "BankTransaction"],
      exportedLike: [/^(importBankStatement|matchBankTransactions|reconcileBankToBook)$/],
    },
    wouldProvideIt: "`FIN-020-004`, and the Payments Bible for the provider half",
  },
]

/** Resolve one row into a state a reader can check. */
export function resolveRow(row, files, schema) {
  if (row.module) {
    const problems = []
    if (!exists(row.module)) problems.push(`module ${row.module} does not exist`)
    if (!exists(row.test)) problems.push(`test ${row.test} does not exist`)
    for (const name of row.requires ?? []) {
      if (!exportsSymbol(row.module, name)) problems.push(`${row.module} does not export ${name}`)
    }
    return {
      capability: row.capability,
      state: problems.length === 0 ? "AVAILABLE" : "CONTRADICTED",
      evidence:
        problems.length === 0
          ? `\`${row.module}\` (${(row.requires ?? []).join(", ")}), proven by \`${row.test}\``
          : problems.join("; "),
    }
  }

  const hits = []
  for (const name of row.absent?.schemaModels ?? []) {
    if (schemaDeclares(schema, name)) hits.push(`${SCHEMA} declares model ${name}`)
  }
  for (const pattern of row.absent?.exportedLike ?? []) {
    for (const hit of exportsMatching(pattern, files)) {
      hits.push(`${hit.path}:${hit.line} exports ${hit.name}`)
    }
  }
  return {
    capability: row.capability,
    state: hits.length === 0 ? "NOT AVAILABLE" : "CONTRADICTED",
    evidence:
      hits.length === 0
        ? `no probe hit: ${[
            ...(row.absent?.schemaModels ?? []).map((m) => `model ${m}`),
            ...(row.absent?.exportedLike ?? []).map((p) => `an export named ${p}`),
          ].join(", ")}. Would provide it: ${row.wouldProvideIt}`
        : `claimed absent, but ${hits.join("; ")}`,
  }
}

export function collect() {
  const files = sourceFiles()
  const schema = read(SCHEMA)
  return {
    files,
    basis: accountingBasis(files),
    currency: currencyFacts(files),
    tax: taxFacts(files),
    providers: providerFacts(),
    objects: canonicalObjects(),
    rows: CAPABILITY_ROWS.map((row) => resolveRow(row, files, schema)),
  }
}

/* -------------------------------------------------------------------- render */

function cell(s) {
  return String(s).replace(/\|/g, "\\|")
}

export function render(data) {
  const { basis, currency, tax, providers, objects, rows } = data
  const present = objects.filter((o) => o.satisfied)
  const out = []

  out.push("# Finance scope disclosure — the exact limits of this platform's accounting")
  out.push("")
  out.push(
    "GENERATED by `tools/fin-scope-disclosure.mjs` — do not edit by hand. `FIN-050-005`. Every " +
      "figure below is derived from the code at the paths it names; a claim this document cannot " +
      "support is emitted as **CONTRADICTED** and " +
      "`tests/architecture/fin-scope-disclosure.test.mjs` fails on it.",
  )
  out.push("")
  out.push(
    `Derived from ${ROOTS.map((r) => `\`${r}\``).join(", ")} and \`${SCHEMA}\`. No count of files ` +
      `appears here on purpose: a figure that moves when unrelated work lands makes a published ` +
      `disclosure look stale when nothing about finance has changed.`,
  )
  out.push("")

  out.push("## A. Accounting basis")
  out.push("")
  if (basis.declarations.length === 0) {
    out.push(
      "**No accounting basis is declared anywhere in this platform.** There is no basis field, " +
        "enum or constant: not accrual, not cash, not modified accrual, and no framework " +
        "(GAAP, IFRS) is named or implemented. Postings are recorded in one unnamed basis, and " +
        "no statement produced from them may be described as prepared under any standard.",
    )
  } else {
    out.push("Declared:")
    out.push("")
    for (const d of basis.declarations) out.push(`- \`${d.declaration}\` in \`${d.path}\``)
  }
  out.push("")
  out.push("Where the vocabulary appears at all, it is prose and not implementation:")
  out.push("")
  out.push("| term | files mentioning it |")
  out.push("| --- | --- |")
  for (const v of basis.vocabulary) {
    out.push(
      `| ${cell(v.term)} | ${v.files.length === 0 ? "none" : v.files.map((f) => `\`${f}\``).join(", ")} |`,
    )
  }
  out.push("")

  out.push("## B. Ledgers, books, currencies and valuation")
  out.push("")
  out.push(
    `- Money is exact integer minor units with a per-currency exponent and a caller-stated ` +
      `rounding mode: ${currency.integerMinorUnits && currency.nonHundredthCurrencies ? "**yes**" : "**no**"} ` +
      "(`packages/finops/src/money.ts`). No amount in the platform packages is a float.",
  )
  out.push(
    `- Currency travels on the row in ${currency.currencyFields.length} Prisma model(s): ` +
      `${currency.currencyFields.map((m) => `\`${m}\``).join(", ")}.`,
  )
  out.push(
    `- A trial balance is produced per currency and never totalled across them: ` +
      `${currency.trialBalancePerCurrency ? "**yes**" : "**no**"}.`,
  )
  out.push(
    `- Conversion at a rate carrying its own date: ${currency.conversion ? "**available as a function**" : "**absent**"} ` +
      "(`convert`, `packages/finops/src/settlement-components.ts`).",
  )
  out.push(
    `- A STORED exchange rate: ${currency.rateStore.length === 0 ? "**none**" : `\`${currency.rateStore.join("`, `")}\``}. ` +
      "With no rate record there is no revaluation, no translation, no realized/unrealized " +
      "gain-or-loss and no reporting currency: a caller must supply every rate itself, and " +
      "nothing reproduces the rate a past posting used.",
  )
  out.push(
    "- Secondary ledgers, books, accounting bases and reporting currencies: **none**. There is one " +
      "set of postings and no ledger record to attribute them to.",
  )
  out.push("")

  out.push("## C. Jurisdiction, tax and statutory reporting")
  out.push("")
  out.push(
    `- Tax determination: ${tax.determination.length === 0 ? "**none**" : `**present** (${tax.determination.map((h) => `\`${h.path}:${h.line}\` ${h.name}`).join(", ")})`}. ` +
      "No rate is looked up, no rule is applied, no recoverability is decided.",
  )
  out.push(
    `- Tax accounts that exist: ${
      tax.taxAccounts.length === 0
        ? "none"
        : tax.taxAccounts.map((t) => `\`${t.symbol}\` = \`${t.account}\``).join(", ")
    } — a tax amount SUPPLIED BY THE CALLER is posted there by a template revision. That is ` +
      "posting, not determination.",
  )
  out.push(
    `- E-invoicing and statutory transmission: ${tax.eInvoicing.length === 0 ? "**none**" : `**present** (${tax.eInvoicing.map((h) => `\`${h.path}\``).join(", ")})`}. ` +
      "Nothing is generated, validated, transmitted, accepted or amended.",
  )
  out.push(
    `- Where this platform says "jurisdiction" it means provider country, data residency or a ` +
      `pricing region — see ${tax.jurisdictionExamples.map((f) => `\`${f}\``).join(" and ")}. ` +
      "Neither is a tax jurisdiction, and nothing exports a jurisdiction pack. " +
      "**No tax jurisdiction is supported, in any country.**",
  )
  out.push("")

  out.push("## D. Providers — bank, payment, tax, payroll, procurement, commerce, ERP")
  out.push("")
  if (providers === null) {
    out.push(`\`${REGISTRY}\` is missing, so no provider claim can be checked at all.`)
  } else {
    out.push(
      `\`${REGISTRY}\` declares ${providers.total} payment/treasury capability leaf/leaves. ` +
        `A leaf can put money in front of a tenant only in ${providers.transactableStates.join(", ")}; ` +
        `**${providers.transactable} of ${providers.total} are in one of those states.**`,
    )
    out.push("")
    out.push("| state | leaves |")
    out.push("| --- | --- |")
    for (const [state, n] of Object.entries(providers.byState)) out.push(`| ${cell(state)} | ${n} |`)
    out.push("")
    out.push(
      "No bank, tax, payroll, procurement, commerce or ERP connector is certified or transactable. " +
        "Every treasury and settlement execution path in the Financial Management Bible §8 is " +
        "therefore unavailable, and the Payments Bible owns the certification that would change it.",
    )
  }
  out.push("")

  out.push("## E. Capability limitations")
  out.push("")
  out.push(
    `${present.length} of ${objects.length} of the Bible §3.2 universal accounting objects exist as ` +
      `records (see \`docs/architecture/fin-finance-surface-inventory.md\` §C for the register, ` +
      `including the one whose NAME IS TAKEN by NextAuth).`,
  )
  out.push("")
  out.push("| capability | state | evidence |")
  out.push("| --- | --- | --- |")
  for (const row of rows) {
    out.push(`| ${cell(row.capability)} | ${cell(row.state)} | ${cell(row.evidence)} |`)
  }
  out.push("")
  out.push(
    `${rows.filter((r) => r.state === "AVAILABLE").length} available, ` +
      `${rows.filter((r) => r.state === "NOT AVAILABLE").length} not available, ` +
      `${rows.filter((r) => r.state === "CONTRADICTED").length} contradicted.`,
  )
  out.push("")
  out.push(
    "An AVAILABLE row is a function with a test, not a workflow: none of them is a period close, " +
      "an approval chain or a persisted report. What finance can do end to end is only what the " +
      "execution ledger records as PASS — `docs/implementation/financial-management-execution-ledger.md`.",
  )
  out.push("")

  return out.join("\n")
}

/* ------------------------------------------------------------------ command */

const isCommand = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCommand) {
  const text = render(collect())
  const target = path.join(ROOT, OUT)
  if (process.argv.includes("--check")) {
    const committed = fs.existsSync(target)
      ? fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n")
      : null
    if (committed !== text) {
      console.error(
        `${OUT} is out of date. Run \`node tools/fin-scope-disclosure.mjs\` and commit the result.`,
      )
      process.exit(1)
    }
    console.log(`${OUT} is current.`)
  } else {
    fs.writeFileSync(target, text)
    console.log(`wrote ${OUT}`)
  }
}
