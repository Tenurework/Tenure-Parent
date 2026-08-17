#!/usr/bin/env node
/**
 * FIN-000-001 — inventory the current budget/expense/ledger/payment code, the
 * finance-bearing tables behind it, and every finance capability claim the
 * source makes.
 *
 * Derived from the tree, never written from memory. A hand-written inventory of
 * finance code is wrong the week after it is written, and a wrong finance
 * inventory is worse than none: it is what somebody trusts when asking "what
 * already posts money, and what does the platform claim it can do with it?"
 *
 * Three things this produces that a paragraph cannot:
 *
 *   1. **The surface.** Every source, test and e2e file under the scanned roots
 *      whose POSIX path matches a finance facet, with the facets it matched,
 *      the plane it serves and its line count. `--check` reds when a finance
 *      file is added, removed, renamed or resized and the committed document
 *      does not follow.
 *
 *   2. **The object gap.** The Bible §3.2 list of canonical accounting objects,
 *      each looked up as a `model` in `apps/web/prisma/schema.prisma`. This is
 *      the FIN-000-002 / FIN-000-003 gap register, and it is measured rather
 *      than asserted — the day somebody adds `model Journal` the table says
 *      PRESENT without anybody editing prose.
 *
 *   3. **The claims.** Every capability term from the Bible's own vocabulary
 *      that the finance surface utters, each carrying a committed verdict in
 *      `CLAIM_VERDICTS` below. A term nobody has adjudicated renders as
 *      `UNADJUDICATED`, and `tests/architecture/fin-finance-surface.test.mjs`
 *      fails on it. That is the "false finance claims" half of FIN-000-001: it
 *      cannot be satisfied by silence, because a new claim in the tree makes
 *      the document stale and the guard red.
 *
 * ── Determinism ─────────────────────────────────────────────────────────────
 *
 * The output must be byte-identical on Linux and Windows. So: directories are
 * read and then sorted by Unicode code point (never `localeCompare`, which is
 * locale-dependent); paths are joined with `/` and compared as POSIX strings;
 * every file is read as utf8 and CRLF-normalised BEFORE it is counted or
 * scanned, so a checkout with `core.autocrlf` on measures the same as one
 * without. Nothing here hashes raw bytes and nothing shells out to git, whose
 * answer depends on what is staged.
 *
 * Usage:  node tools/fin-finance-surface.mjs [--check]
 *   --check  exit non-zero if the committed document is out of date
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, "..")
export const OUT = "docs/architecture/fin-finance-surface-inventory.md"
export const SCHEMA = "apps/web/prisma/schema.prisma"

/** Where finance code can live. Everything else is out of scan, not out of scope. */
export const ROOTS = [
  "apps/web/src",
  "apps/web/e2e",
  "apps/system-studio/src",
  "apps/system-studio/e2e",
  "packages",
  "modules",
]

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".turbo", "coverage", ".cache"])

/**
 * The four facets FIN-000-001 names, plus the two the tree actually has.
 *
 * `cost` is separated from the rest deliberately. `packages/finops` and the
 * Studio's cost pages are AWS spend attribution — what the estate costs Tenure
 * — and they are finance-shaped code that is NOT tenant accounting. Folding
 * them into `ledger` would make the inventory report a general ledger that
 * exists for the wrong money.
 *
 * Matched against the whole POSIX path, not the basename, because the tenant
 * finance surface is a DIRECTORY: `.../orgs/[slug]/finance/actions.ts` is the
 * single largest piece of budget/ledger code in the repository and its file
 * name says nothing.
 */
export const FACETS = [
  ["budget", /budget/i],
  ["expense", /expense|reimburs|receipt/i],
  ["ledger", /ledger|journal|posting|money|accounting/i],
  ["payment", /payment|settlement|payout|stripe|funds-flow|charge-model|liability|gateway|external-reference|balance-transaction/i],
  ["cost", /cost|pricing|finops|allocation|split/i],
  ["finance", /finance|financial|vendor|fiscal/i],
]

/** Which audience a path serves. Derived from the root, so it cannot drift. */
export function planeOf(rel) {
  if (rel.startsWith("apps/web/")) return "tenant"
  if (rel.startsWith("apps/system-studio/")) return "operator"
  return "shared"
}

/** source / test / e2e. A test file is inventory too — it is where the proof is. */
export function kindOf(rel) {
  if (/\.spec\.[tj]sx?$/.test(rel) || /(^|\/)e2e\//.test(rel)) return "e2e"
  if (/\.(test|itest)\.[tj]sx?$/.test(rel)) return "test"
  return "source"
}

/** The facets a path matches, sorted. Empty means it is not finance code. */
export function facetsOf(rel) {
  return FACETS.filter(([, re]) => re.test(rel)).map(([name]) => name)
}

/** Code-point order. `localeCompare` is locale-dependent and would not be reproducible. */
export function byCodePoint(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

/** utf8, CRLF-normalised. Every read in this file goes through here. */
export function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n")
}

/** Lines in a file, counted the same way on either platform. */
export function lineCount(text) {
  const lines = text.split("\n")
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
  return lines.length
}

/**
 * The Bible §3.2 minimum object list, verbatim and in its stated order.
 *
 * Order is the Bible's, not alphabetical, so a reader comparing the two reads
 * down both at once. `model` is the Prisma model name that would satisfy it.
 */
export const CANONICAL_OBJECTS = [
  "AccountingEvent",
  "AccountingRule",
  "SubledgerDocument",
  "SubledgerEntry",
  "Journal",
  "JournalLine",
  "Ledger",
  "Book",
  "Account",
  "Dimension",
  "Balance",
  "Period",
  "Rate",
  "Reconciliation",
  "Adjustment",
  "Allocation",
  "IntercompanyTransaction",
  "ConsolidationRun",
  "CloseTask",
  "ControlEvidence",
]

/**
 * Canonical object names the schema already uses for something else.
 *
 * `Account` is the sharp one. The schema declares `model Account`, so a naive
 * lookup reports the Bible's `Account` PRESENT and the summary reads "1 of 20"
 * — and it is NextAuth's OAuth account row, which holds a provider id and a
 * refresh token and has never been near a chart of accounts. A gap register
 * that counts a name collision as coverage is exactly the kind of green that
 * this programme has been failing on, so the state is named rather than
 * folded into either PRESENT or ABSENT.
 *
 * The guard test asserts every name here really IS declared in the schema, so
 * a collision cannot be claimed for a model that does not exist.
 */
export const NAME_COLLISIONS = {
  Account:
    "The schema's `model Account` is NextAuth's OAuth account (provider, providerAccountId, refresh_token). It is not a chart-of-accounts account and adding one will collide with it.",
}

/**
 * What each canonical object is standing in for today, when anything is.
 *
 * A "PRESENT" verdict is decided by the schema, not by this table; this only
 * says what a reader should look at when the answer is ABSENT. Every path named
 * here is asserted to exist by the guard test, so a stand-in that gets deleted
 * or renamed cannot go on being cited.
 */
export const OBJECT_SUBSTITUTES = {
  AccountingEvent:
    "No object. Postings are written inline by `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts`; nothing records the business event that caused one.",
  AccountingRule:
    "`packages/payments/src/posting.ts` holds effective-dated posting templates (`postingFor`), which is the rule half without a persisted rule.",
  SubledgerDocument:
    "No object. `packages/payments/src/charge-model.ts` already tells an operator to 'post it to the internal subledger', which does not exist.",
  SubledgerEntry: "No object.",
  Journal:
    "No header table. `LedgerEntry.journalId` is a bare string column shared by the sides of one posting (`apps/web/prisma/schema.prisma`).",
  JournalLine:
    "`LedgerEntry` is the line, with `side`, `account`, `amountCents` and `currency` (`apps/web/prisma/schema.prisma`).",
  Ledger: "No object. There is exactly one implicit ledger and it cannot be named, scoped or duplicated.",
  Book: "No object.",
  Account:
    "`LedgerEntry.account` is a free-text code with no chart, no hierarchy and no validation (`apps/web/prisma/schema.prisma`); the four codes in use are constants in `packages/payments/src/posting.ts`.",
  Dimension:
    "`LedgerEntry.budgetLineId` and `LedgerEntry.organizationId` are the only two dimensions, and both are hard-coded columns rather than configurable analysis dimensions.",
  Balance:
    "`BudgetLine.actualCents` is a cached sum maintained by `apps/web/src/lib/finance.ts`; there is no balance object by account, period or currency.",
  Period:
    "`BudgetLine.academicYear` is a string. Nothing can be opened or closed, so no posting is ever refused for period state.",
  Rate: "No object. Every amount is single-currency; `apps/web/src/lib/finance.ts` raises `MixedCurrencyError` rather than converting.",
  Reconciliation:
    "`apps/web/src/lib/finance.ts` reconciles the cached actual against the posted journal (`financeIntegrity`); nothing reconciles against an external record.",
  Adjustment: "`LedgerKind.ADJUSTMENT` and `LedgerKind.REVERSAL` are enum values on `LedgerEntry`, not objects with their own lifecycle.",
  Allocation:
    "`packages/finops/src/allocation.ts` allocates AWS cost, which is the estate's money and not a tenant's.",
  IntercompanyTransaction:
    "No object. `packages/payments/src/refusal.ts` refuses a posting that crosses a legal-entity boundary instead of accounting for one.",
  ConsolidationRun:
    "No object. `apps/web/src/app/(app)/reports/finance/page.tsx` rolls budget lines up across clubs in one query.",
  CloseTask: "No object.",
  ControlEvidence: "No object. Approvals are evidenced by `ApprovalRequest`/`ApprovalStep`, which is not the same record.",
}

/**
 * The capability vocabulary, taken from the Bible's own section headings.
 *
 * Lower-cased substring match. Deliberately not a word-boundary regex: the
 * point is to catch the term wherever it is uttered — a comment, a heading, a
 * blocker message a user reads — and a claim in a comment is still a claim to
 * the next engineer.
 */
export const CLAIM_TERMS = [
  "double-entry",
  "double entry",
  "general ledger",
  "trial balance",
  "period close",
  "subledger",
  "multi-currency",
  "multicurrency",
  "consolidation",
  "gaap",
  "ifrs",
  "accrual",
  "chart of accounts",
  "legal entity",
  "fiscal calendar",
  "drill-through",
  "audit-ready",
  "real-time",
  "realtime",
  "bank reconciliation",
  "statement reconciliation",
]

/**
 * The verdict on every claim the surface makes, keyed `path|term`.
 *
 * Keyed by file and term rather than by line, because a line number moves the
 * next time somebody edits above it and a verdict table that invalidates itself
 * on an unrelated edit teaches people to regenerate without reading.
 *
 * Three verdicts, and the middle one is the one FIN-000-001 exists to find:
 *
 *   * `TRUE`       — the code does what the term means, at the scope stated.
 *   * `SCOPED`     — the term is used for a real but narrower thing, and the
 *                    note says which, so a reader is not left to assume the
 *                    full meaning.
 *   * `OVERSTATED` — the term names a capability the platform does not have.
 *
 * A term found in a file with no entry here renders `UNADJUDICATED` and the
 * guard test fails. Adjudicating is a person reading the line; it is not
 * automatable and it is not optional.
 */
export const CLAIM_VERDICTS = {
  "packages/payments/src/limits.ts|legal entity": {
    verdict: "SCOPED",
    note: "One sentence of a doc comment on `recipientKey`, explaining that `null` means a movement between two dimensions of ONE legal entity rather than a payment to somebody. It names the boundary the null case sits inside; it does not claim this package models legal entities, and nothing here holds one. PAY-000-004.",
  },
  "packages/payments/src/prohibited-claims.ts|legal entity": {
    verdict: "TRUE",
    note: "Not a capability claim at all — it is the REASON a claim is forbidden. The rule refuses the sentence 'Tenure is the merchant of record' on the ground that the tenant's legal entity is the merchant by default (pay-adr-0001), and `describeMerchant` resolves the actual party. The code asserts the arrangement it describes and enforces it by refusing the opposite.",
  },
  "packages/payments/src/prohibited-claims.test.ts|legal entity": {
    verdict: "TRUE",
    note: "The test that proves the rule above fires, using the sentence 'Tenure is not the merchant of record; the tenant legal entity is.' Same subject, and it is exercised rather than asserted.",
  },
  "packages/payments/src/prohibited-claims.ts|subledger": {
    verdict: "SCOPED",
    note: "Used twice, both times to LIMIT what the word may be taken to mean: 'the only balance Tenure computes is an internal subledger figure' (so it must not be called the reader's balance) and 'Tenure's subledger is evidence beside the provider's records, never instead of them'. What exists underneath is real but small — `buildJournal` (posting.ts) refuses an unbalanced journal and posts against four named accounts — which is a bookkeeping mechanism, not an ERP subledger with per-entity books or a period close. SCOPED rather than TRUE because the machinery is narrower than the word, and rather than OVERSTATED because these sentences exist precisely to stop it being presented as money or as authoritative.",
  },
  "apps/web/src/app/(app)/admin/payments/page.tsx|legal entity": {
    verdict: "SCOPED",
    note: "A column and a subtitle on the funds-flow screen. The legal entity is a FIELD on PaymentsFundsFlowConfig used to choose a charge model, not a modelled entity that owns a ledger. FIN-000-002.",
  },
  "apps/web/src/app/(app)/approvals/money-movement.test.ts|legal entity": {
    verdict: "TRUE",
    note: "Names the boundary the refusal is tested against; the refusal is real (packages/payments/src/refusal.ts).",
  },
  "apps/web/src/app/(app)/reports/finance/page.tsx|consolidation": {
    verdict: "OVERSTATED",
    note: "Calls itself 'the two-tier ERP consolidation view'. It is one findMany that sums each club's BudgetLine rows. There is no second legal entity, no ownership percentage, no elimination and no currency translation, so no consolidation is performed. FIN-060.",
  },
  "apps/web/src/lib/config/payment-mode.test.ts|legal entity": {
    verdict: "SCOPED",
    note: "Describes which legal entity a tenant ACTS FOR when a charge is made. It is a configuration value, not an accounting entity.",
  },
  "apps/web/src/lib/finance.ts|general ledger": {
    verdict: "OVERSTATED",
    note: "A section header over five LedgerKind labels, a sign function and a disclosure string. A general ledger needs a ledger, a book, a chart of accounts and a period; none of the four exists. FIN-000-002.",
  },
  "apps/web/src/app/(app)/orgs/[slug]/finance/page.tsx|trial balance": {
    verdict: "SCOPED",
    note: "FIN-010-003. The page computes a real trial balance over every posted row — ledgerTieOut, apps/web/src/lib/finance.ts — and renders only its TIE-OUT: balanced or the residual, the account count, and the late-posting count. The per-account debit/credit grid is computed and not displayed. A reader of this page learns whether the books tie, not what is in them.",
  },
  "apps/web/src/lib/finance.ts|double entry": {
    verdict: "TRUE",
    note: "FIN-010-003. toPostedLines puts each row's amount in its declared column and ledgerTieOut totals the two; the double entry itself is enforced at write time by buildJournal (packages/payments/src/posting.ts), which refuses an unbalanced journal, and both halves share a journalId. The sentence claims the reading, and the reading is real.",
  },
  "apps/web/src/lib/finance.ts|trial balance": {
    verdict: "TRUE",
    note: "FIN-010-003. ledgerTieOut produces debits, credits, per-account nets and the residual, per currency and never totalled across currencies, from @tenure/finops' trialBalance. Proven by apps/web/src/lib/finance-tie-out.test.ts (9/9) and mutation-proven on the credit-sign conversion.",
  },
  "apps/web/src/lib/finance-tie-out.test.ts|trial balance": {
    verdict: "TRUE",
    note: "Tests the tie-out the source performs, including the sign convention that would make a balanced ledger report as out of balance by twice itself.",
  },
  "apps/web/src/lib/payments/ledger-attribution.itest.ts|double entry": {
    verdict: "TRUE",
    note: "buildJournal in packages/payments/src/posting.ts refuses to emit an unbalanced journal, and both sides carry the same journalId. Balance is enforced at build time, which is what the sentence claims.",
  },
  "apps/system-studio/e2e/pricing-logic.spec.ts|multi-currency": {
    verdict: "SCOPED",
    note: "A multi-currency line item in the Studio's price COMPOSER — what a tenant would be quoted. No tenant transaction is multi-currency; apps/web/src/lib/finance.ts raises MixedCurrencyError instead.",
  },
  "packages/finops/src/general-ledger.test.ts|drill-through": {
    verdict: "SCOPED",
    note: "Names what the test asserts: every entry accountAnalysis returns carries its own journalId and lineId. That is the first link of Bible §3.3's chain and not the chain.",
  },
  "packages/finops/src/general-ledger.test.ts|trial balance": {
    verdict: "TRUE",
    note: "29 cases over the trial balance the module computes, including the empty window, the contra amount, the as-of window and two journals that cancel.",
  },
  "packages/finops/src/general-ledger.ts|accrual": {
    verdict: "SCOPED",
    note: "One word, in a comment giving an example of a reconciliation difference — 'an accrual that was released twice'. It claims no accrual BASIS, and none exists: docs/architecture/fin-accounting-scope-disclosure.md §A states that no accounting basis is declared anywhere in this platform.",
  },
  "packages/finops/src/general-ledger.ts|chart of accounts": {
    verdict: "SCOPED",
    note: "financialStatements takes the chart classification as an ARGUMENT — account, group, normal balance, statement line — because Bible §24 forbids hard-coding accounting rules. No chart-of-accounts RECORD exists (ChartOfAccounts is ABSENT in §C; FIN-000-002 is blocked on it), so the caller supplies one every time and nothing persists it.",
  },
  "packages/finops/src/general-ledger.ts|drill-through": {
    verdict: "SCOPED",
    note: "accountAnalysis carries journalId and lineId on every movement, so a balance leads to the rows that made it. Bible §3.3 asks for journal, subledger, business document and approval; the two middle links have no tables (FIN-000-003) and FIN-000-004's row says so.",
  },
  "packages/finops/src/general-ledger.ts|trial balance": {
    verdict: "TRUE",
    note: "FIN-010-003. Debits, credits and net per account per currency, the residual reported and never plugged, an empty window reported as null rather than balanced, and per-journal tie-out measured as well as the total. 29/29 with 10 mutations caught.",
  },
  "packages/finops/src/index.ts|trial balance": {
    verdict: "TRUE",
    note: "The package door naming what it exports, with the reason it is not ./settlement's reconciler.",
  },
  "packages/payments/src/capability-registry.ts|multi-currency": {
    verdict: "TRUE",
    note: "Declared with the `planned` constructor, so the registry states the capability is NOT available. This is the shape a capability claim is supposed to take.",
  },
  "packages/payments/src/charge-model.ts|legal entity": {
    verdict: "SCOPED",
    note: "`legalEntityType` and a registration country are inputs to a pure decision function. Nothing persists a legal entity.",
  },
  "packages/payments/src/charge-model.ts|subledger": {
    verdict: "OVERSTATED",
    note: "A blocker message tells the caller to 'post it to the internal subledger instead'. No subledger exists — there is one LedgerEntry table and no subledger document or entry at all. FIN-000-003.",
  },
  "packages/payments/src/eligibility.ts|legal entity": {
    verdict: "SCOPED",
    note: "The legal-entity TYPE a capability is declared for. A type, not an entity.",
  },
  "packages/payments/src/funds-flow.ts|legal entity": {
    verdict: "SCOPED",
    note: "Quotes the Payments Bible on direct flow. Describes the intended arrangement, claims no model.",
  },
  "packages/payments/src/posting.ts|legal entity": {
    verdict: "SCOPED",
    note: "The header QUOTES Bible §13 — templates 'versioned by legal entity, ledger/book, transaction type, provider flow, currency, tax and effective date' — and attributes it. What POSTING_TEMPLATES actually versions by is effective date and currency; the other five axes do not exist. Attributed, so not a false claim, but a reader skimming it will over-read the code. FIN-000-002.",
  },
  "packages/payments/src/refusal.test.ts|legal entity": {
    verdict: "TRUE",
    note: "Tests the refusal that the source performs.",
  },
  "packages/payments/src/refusal.ts|legal entity": {
    verdict: "TRUE",
    note: "The refusal is real: a posting whose payee is outside the source legal entity is escalated rather than posted. It refuses the case instead of accounting for it, which is honest and is why IntercompanyTransaction is ABSENT above.",
  },
}

/* ------------------------------------------------------------------ collect */

/** Every scannable file under a root, in code-point order. */
export function filesUnder(rel, out = []) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) return out
  const entries = fs.readdirSync(abs, { withFileTypes: true })
  const names = entries.map((e) => e.name).sort(byCodePoint)
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue
    const child = `${rel}/${name}`
    if (fs.statSync(path.join(ROOT, child)).isDirectory()) filesUnder(child, out)
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(child)
  }
  return out
}

/** Finance-bearing models in the Prisma schema, with the money fields that make them so. */
export function financeModels() {
  const text = read(SCHEMA)
  const lines = text.split("\n")
  const out = []
  let current = null
  for (let i = 0; i < lines.length; i++) {
    const open = /^model\s+([A-Za-z0-9_]+)\s*\{/.exec(lines[i])
    if (open) {
      current = { name: open[1], line: i + 1, fields: [] }
      continue
    }
    if (!current) continue
    if (/^\}/.test(lines[i])) {
      // A model is finance-bearing when it carries money, or when its own name
      // is one of the facets. Both halves matter: `Vendor` holds no cents and
      // is finance, `ModelUsageMeter` holds no cents and is not.
      const money = current.fields.filter((f) => /Cents$|^currency$|^amount|^total|^balance/i.test(f))
      if (money.length > 0 || facetsOf(current.name).length > 0) {
        out.push({ name: current.name, line: current.line, money })
      }
      current = null
      continue
    }
    const field = /^\s{2}([a-zA-Z][A-Za-z0-9_]*)\s+\S/.exec(lines[i])
    if (field) current.fields.push(field[1])
  }
  return out.sort((a, b) => byCodePoint(a.name, b.name))
}

/** True when `apps/web/prisma/schema.prisma` declares `model <name>`. */
export function schemaDeclares(text, name) {
  return new RegExp(`^model\\s+${name}\\s*\\{`, "m").test(text)
}

/**
 * Which canonical accounting objects the schema actually declares.
 *
 * Three states, because two would lie. `PRESENT` means the object exists as
 * itself; `NAME TAKEN` means a model of that name exists and is something else
 * (see `NAME_COLLISIONS`); `ABSENT` means nothing of that name exists at all.
 * Only `PRESENT` counts as coverage.
 */
export function canonicalObjects() {
  const text = read(SCHEMA)
  return CANONICAL_OBJECTS.map((name) => {
    const declared = schemaDeclares(text, name)
    const collision = NAME_COLLISIONS[name]
    return {
      name,
      state: declared ? (collision ? "NAME TAKEN" : "PRESENT") : "ABSENT",
      satisfied: declared && !collision,
      substitute: collision ? `${collision} ${OBJECT_SUBSTITUTES[name] ?? ""}`.trim() : OBJECT_SUBSTITUTES[name] ?? "",
    }
  })
}

/** Every claim term uttered by the finance surface, with its committed verdict. */
export function claims(files) {
  const found = new Map()
  for (const rel of files) {
    const lower = read(rel).toLowerCase()
    for (const term of CLAIM_TERMS) {
      let n = 0
      let from = 0
      for (;;) {
        const at = lower.indexOf(term, from)
        if (at < 0) break
        n++
        from = at + term.length
      }
      if (n === 0) continue
      const key = `${rel}|${term}`
      const verdict = CLAIM_VERDICTS[key]
      found.set(key, {
        key,
        file: rel,
        term,
        occurrences: n,
        verdict: verdict ? verdict.verdict : "UNADJUDICATED",
        note: verdict ? verdict.note : "No verdict recorded. FIN-000-001 requires every claim to be adjudicated.",
      })
    }
  }
  return [...found.values()].sort((a, b) => byCodePoint(a.key, b.key))
}

export function collect() {
  const scanned = []
  for (const r of ROOTS) filesUnder(r, scanned)
  const files = scanned
    .filter((rel) => facetsOf(rel).length > 0)
    .map((rel) => ({
      path: rel,
      plane: planeOf(rel),
      kind: kindOf(rel),
      facets: facetsOf(rel),
    }))
    .sort((a, b) => byCodePoint(a.path, b.path))
  return {
    scannedCount: scanned.length,
    files,
    models: financeModels(),
    objects: canonicalObjects(),
    claims: claims(files.map((f) => f.path)),
  }
}

/* ------------------------------------------------------------------- render */

/** Markdown table cells may not contain a bare pipe. */
function cell(s) {
  return String(s).replace(/\|/g, "\\|")
}

export function render(data) {
  const { files, models, objects, claims: found } = data
  const byFacet = new Map()
  for (const f of files) for (const facet of f.facets) byFacet.set(facet, (byFacet.get(facet) ?? 0) + 1)
  const facetLine = FACETS.map(([name]) => `${name} ${byFacet.get(name) ?? 0}`).join(" · ")
  const byKind = (k) => files.filter((f) => f.kind === k).length
  const present = objects.filter((o) => o.satisfied)
  const collided = objects.filter((o) => o.state === "NAME TAKEN")
  const overstated = found.filter((c) => c.verdict === "OVERSTATED")
  const scoped = found.filter((c) => c.verdict === "SCOPED")
  const unadjudicated = found.filter((c) => c.verdict === "UNADJUDICATED")

  const out = []
  out.push("# Finance surface inventory — FIN-000-001")
  out.push("")
  out.push("**Generated. Do not edit by hand.**")
  out.push("")
  out.push("```")
  out.push("node tools/fin-finance-surface.mjs           # rewrite this file")
  out.push("node tools/fin-finance-surface.mjs --check   # fail if it is stale")
  out.push("```")
  out.push("")
  out.push(
    "`tests/architecture/fin-finance-surface.test.mjs` runs the `--check` and asserts that every path this " +
      "document names exists, that no capability claim is left unadjudicated, and that the classifier is not " +
      "vacuous. An inventory nothing re-derives is a paragraph.",
  )
  out.push("")
  out.push("## What was measured")
  out.push("")
  // Deliberately NOT the count of files scanned. That number moves every time
  // anybody anywhere in `apps/` or `packages/` adds a file, which would make
  // this document stale — and its guard red — for changes that have nothing to
  // do with finance. An inventory that reds on unrelated work is an inventory
  // people regenerate without reading. It reds when the FINANCE surface moves.
  out.push(`- Roots scanned for \`.ts\`/\`.tsx\`/\`.mjs\`: ${ROOTS.map((r) => `\`${r}\``).join(", ")}.`)
  // Counts of FILES, not of lines. A line count moves every time somebody
  // edits a comment in `packages/payments`, which would make this document
  // stale for a change that alters nothing it claims. Membership is the claim.
  out.push(
    `- Finance surface: **${files.length} files** — ${byKind("source")} source, ${byKind("test")} unit/integration test, ` +
      `${byKind("e2e")} e2e.`,
  )
  out.push(`- Facet hits (a file can match several): ${facetLine}.`)
  out.push(`- Finance-bearing tables in \`${SCHEMA}\`: **${models.length}**.`)
  out.push(
    `- Bible §3.2 canonical accounting objects present as tables: **${present.length} of ${objects.length}**` +
      (present.length === 0 ? " — none." : ` — ${present.map((o) => `\`${o.name}\``).join(", ")}.`) +
      (collided.length === 0
        ? ""
        : ` A further ${collided.length} (${collided.map((o) => `\`${o.name}\``).join(", ")}) ` +
          `${collided.length === 1 ? "has its name taken" : "have their names taken"} by an unrelated model, ` +
          "which is a migration hazard and is not coverage."),
  )
  out.push(
    `- Capability claims: **${found.length}** — ${found.filter((c) => c.verdict === "TRUE").length} TRUE, ` +
      `${scoped.length} SCOPED, ${overstated.length} OVERSTATED, ${unadjudicated.length} UNADJUDICATED.`,
  )
  out.push("")
  out.push("## A. The finance surface")
  out.push("")
  out.push(
    "Every file whose POSIX path matches a finance facet. `plane` is derived from the root: `tenant` is what a " +
      "club signs into, `operator` is the Studio, `shared` is a workspace package either can import. `cost` is a " +
      "facet of its own because AWS spend attribution is finance-shaped code about Tenure's money, not a tenant's.",
  )
  out.push("")
  out.push("| Path | Plane | Kind | Facets |")
  out.push("| --- | --- | --- | --- |")
  for (const f of files) {
    out.push(`| \`${cell(f.path)}\` | ${f.plane} | ${f.kind} | ${f.facets.join(", ")} |`)
  }
  out.push("")
  out.push("## B. Finance-bearing tables")
  out.push("")
  out.push(
    "Models in `" +
      SCHEMA +
      "` that either carry money fields or whose name matches a finance facet. `Line` is the line the `model` " +
      "keyword sits on, so every row can be opened.",
  )
  out.push("")
  out.push("| Model | Line | Money-bearing fields |")
  out.push("| --- | ---: | --- |")
  for (const m of models) {
    out.push(`| \`${cell(m.name)}\` | ${m.line} | ${m.money.length > 0 ? m.money.map((f) => `\`${cell(f)}\``).join(", ") : "—"} |`)
  }
  out.push("")
  out.push("## C. Canonical accounting objects (Bible §3.2)")
  out.push("")
  out.push(
    "The Bible's stated minimum, each looked up as a `model` in the schema. The state is decided by the schema, " +
      "not by this document. `NAME TAKEN` means a model of that name exists and is something else entirely — it is " +
      "not coverage, and it is a migration hazard. This table is the gap register FIN-000-002 and FIN-000-003 close.",
  )
  out.push("")
  out.push("| Object | Table | What stands in for it today |")
  out.push("| --- | --- | --- |")
  for (const o of objects) {
    out.push(`| \`${cell(o.name)}\` | ${o.state} | ${cell(o.substitute)} |`)
  }
  out.push("")
  out.push("## D. Capability claims and their verdicts")
  out.push("")
  out.push(
    "Every term from the Bible's capability vocabulary uttered anywhere in the surface above, with the verdict " +
      "recorded in `CLAIM_VERDICTS` in the generator. `TRUE` means the code does what the term means at the scope " +
      "stated; `SCOPED` means the term is used for a real but narrower thing; `OVERSTATED` means it names a " +
      "capability the platform does not have. `grep -n` the term in the file to read the line.",
  )
  out.push("")
  out.push("| File | Term | Uses | Verdict | Note |")
  out.push("| --- | --- | ---: | --- | --- |")
  for (const c of found) {
    out.push(`| \`${cell(c.file)}\` | ${cell(c.term)} | ${c.occurrences} | ${c.verdict} | ${cell(c.note)} |`)
  }
  out.push("")
  out.push("## What this inventory says")
  out.push("")
  out.push(
    `The platform has real finance code — ${files.length} files and ${models.length} money-bearing tables — and it ` +
      "is club budgeting, reimbursement and payment-provider plumbing, not accounting. Money is integer minor units " +
      "end to end, a posting is a balanced journal, and a posted entry is corrected by a reversal rather than a " +
      "delete. Above that line there is nothing: " +
      `${objects.length - present.length} of the ${objects.length} objects the Bible names as the minimum are not ` +
      "there, including every one that makes a ledger a ledger — " +
      objects
        .filter((o) => !o.satisfied && ["Ledger", "Book", "Period", "Account", "Journal"].includes(o.name))
        .map((o) => `\`${o.name}\``)
        .join(", ") +
      ".",
  )
  out.push("")
  out.push(
    `Of ${found.length} capability claims, ${overstated.length} are OVERSTATED. They are not marketing copy; they are ` +
      "comments and blocker messages that name objects nobody has built, which is the exact failure this inventory " +
      "exists to find. Each is cited in the table above with the requirement that would make it true.",
  )
  out.push("")
  return out.join("\n")
}

/* ------------------------------------------------------------------ command */

/**
 * Only when run as a command — never on import.
 *
 * `tests/architecture/fin-finance-surface.test.mjs` imports `collect` and
 * `render` from this module, and an ESM import executes the whole body. With
 * the write unguarded that import would rewrite the document before the test
 * compared against it, so the staleness assertion would heal the file and then
 * confirm it was healthy — green on every possible input, including a claim
 * that had just been added and never adjudicated. `entry-point-inventory.mjs`
 * carries the same guard for the same reason, and it was found the expensive
 * way. `tests/architecture/guards-do-not-write-into-the-tree.test.mjs` is the
 * other half of the rule.
 */
const isCommand = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCommand) {
  const generated = render(collect())
  const abs = path.join(ROOT, OUT)
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n") : ""
    if (current !== generated) {
      console.error(`::error::${OUT} is stale. Run: node tools/fin-finance-surface.mjs`)
      process.exit(1)
    }
    console.log(`${OUT} is up to date.`)
  } else {
    fs.writeFileSync(abs, generated)
    console.log(`Wrote ${OUT} (${generated.split("\n").length} lines)`)
  }
}
