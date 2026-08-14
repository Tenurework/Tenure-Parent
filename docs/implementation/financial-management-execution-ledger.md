# Financial Management Cloud — execution ledger

Every `FIN-*` requirement stated by `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`.

Seeded by `tools/import-requirements.mjs`. **Every entry is `FAIL` and
unchecked**, which is the truthful starting state: import is not progress. A
requirement becomes `PASS` when somebody builds it, proves it by mutation, and
records the evidence here — never because a script wrote a row for it.

Before this file existed these requirements were in no execution document at
all. They were not queued, not counted and not failing; they were invisible, and
invisible reads exactly like done. `tests/architecture/document-graph.test.mjs`
ratchets that number downward and it may only shrink.

Statuses: `PASS` · `FAIL` · `BLOCKED_EXTERNAL` · `NOT_APPLICABLE`. There is no
`PARTIAL` and no `BLOCKED_ARCHITECTURE` — `tools/loop/next-batch.mjs` decides on
`PASS`, `BLOCKED_EXTERNAL` and `NOT_APPLICABLE` only, so any other word reads as
undecided and returns the item to the queue every tick, forever. An unfinished
requirement is `FAIL` if the rest can be built now, and `BLOCKED_EXTERNAL` — naming
the commands or the ADR that would unblock it — if it cannot.

- [x] **FIN-000-001** — Inventory current budget/expense/ledger/payment code and false finance claims.
  - Status: PASS
  - Code: `tools/fin-finance-surface.mjs` (the generator: `facetsOf`, `planeOf`,
    `kindOf`, `financeModels`, `canonicalObjects`, `claims`, `render`, and the
    committed `CLAIM_VERDICTS`, `NAME_COLLISIONS` and `OBJECT_SUBSTITUTES`
    tables), producing `docs/architecture/fin-finance-surface-inventory.md`.
  - What it says, as generated on this run — the document is the live answer,
    these figures are the run that closed this row: the finance surface is
    **88 files** (50 source, 33 unit/integration test, 5 e2e) across three planes;
    **10 finance-bearing tables** in `apps/web/prisma/schema.prisma`; **0 of the
    20** canonical accounting objects the Bible §3.2 names exist, with a
    twenty-first state — `Account` is `NAME TAKEN` by NextAuth's OAuth model, so
    a naive lookup would have reported "1 of 20" and counted a collision as
    coverage; and **15 capability claims**, adjudicated 5 `TRUE`, 7 `SCOPED`,
    3 `OVERSTATED`. The three false ones are
    `apps/web/src/app/(app)/reports/finance/page.tsx` calling a single
    `findMany` roll-up "the two-tier ERP consolidation view",
    `apps/web/src/lib/finance.ts` heading five enum labels and a sign function
    "General ledger", and `packages/payments/src/charge-model.ts` telling a user
    to "post it to the internal subledger instead" of a subledger that does not
    exist. Each row names a path that was opened.
  - Derived, not written: the surface, the tables and the object register come
    from walking the tree and parsing the schema, so the document is stale the
    moment the finance code moves. Deterministic on Linux and Windows —
    directories read then sorted by code point, POSIX paths, every file
    CRLF-normalised before it is counted or scanned, no raw-byte hashing, no
    shell-out to git. Line counts were deliberately left OUT: they move when
    anybody edits a comment in `packages/payments` and would red this for
    changes that alter nothing it claims.
  - Tests: `node --test tests/architecture/fin-finance-surface.test.mjs` → 8/8.
    It runs the generator's `--check` in a subprocess, re-derives the surface
    and compares membership both ways, opens every path the document cites,
    fails on any `UNADJUDICATED` claim, asserts each `NAME_COLLISIONS` entry
    names a model the schema really declares, and exercises `facetsOf` /
    `planeOf` / `kindOf` directly so a classifier that stopped matching cannot
    make the other seven vacuous.
  - Mutations: **7 applied, 7 caught**, each restored to 8/8. Re-runnable —
    `node tools/loop/fin-mutation-run.mjs` applies every one, runs the guard,
    restores and re-runs, and exits non-zero if any is missed. Measured
    baseline 8/8, then:
    - removed the `apps/web/src/lib/finance.ts` rows from the committed
      document → 3 of 8 failed (the `--check`, the membership check, the
      in-process comparison) → restored 8/8.
    - removed the `packages/payments/src/posting.ts` row from table A → 3 of 8,
      the membership check naming that exact path → restored 8/8.
    - edited the committed register to claim `Journal` is `PRESENT` → 2 of 8 →
      restored 8/8.
    - deleted the `apps/web/src/lib/finance.ts|general ledger` entry from
      `CLAIM_VERDICTS` and regenerated → 1 of 8, "every capability claim the
      surface makes has been adjudicated" → restored 8/8.
    - pointed an `OBJECT_SUBSTITUTES` citation at
      `packages/finops/src/allocations.ts` and regenerated → 1 of 8, "every
      path the inventory cites is a path that exists" → restored 8/8.
    - added `Ledger` to `NAME_COLLISIONS`, which no model declares → 1 of 8,
      "the object gap register is measured against the schema" → restored 8/8.
    - made `facetsOf` return `[]` for every path → 3 of 8, including "the
      inventory is not empty, and the classifier is not vacuous" → restored
      8/8.
  - Guards restored: every mutation above was reverted and re-run green by the
    runner itself, which fails if it cannot get back to 8/8. No check was left
    disabled, weakened or deleted.

- [ ] **FIN-000-002** — Implement legal entity/COA/ledger/book/period/currency/dimension models.
  - Status: BLOCKED_EXTERNAL
  - Blocked on: `apps/web/prisma/schema.prisma` plus a migration under
    `apps/web/prisma/migrations/`. Every object this requirement names is a
    persisted table, and that file is owned by no single domain — the ledger,
    budgeting and payments models in it already carry `PAY-030-006`,
    `PAY-030-007`, `PAY-080-004` and `PAY-130-002` annotations from other
    waves. It is on the shared-file list this wave's agents may not edit, so
    the change has to be serialised rather than merged.
  - The change, exactly: add `LegalEntity`, `ChartOfAccounts`,
    `ChartOfAccountsSegment`, `AccountingAccount` (NOT `Account` — see below),
    `Ledger`, `Book`, `FiscalCalendar`, `AccountingPeriod`, `Currency`,
    `ExchangeRate`, `AnalysisDimension` and `DimensionValue`; then make
    `LedgerEntry.account` a foreign key to `AccountingAccount` instead of the
    free-text string it is today, and give `LedgerEntry` a `ledgerId`,
    `bookId` and `periodId`.
  - Name hazard, measured not assumed: `apps/web/prisma/schema.prisma:19`
    already declares `model Account`, and it is NextAuth's OAuth account. The
    Bible's `Account` cannot take that name. This is recorded as `NAME TAKEN`
    in `docs/architecture/fin-finance-surface-inventory.md` §C and asserted by
    `node --test tests/architecture/fin-finance-surface.test.mjs`.
  - Not blocked on judgement: the gap is measured. §C of that inventory shows
    `Ledger`, `Book`, `Period`, `Dimension` and `Rate` all `ABSENT`, with what
    stands in for each — `BudgetLine.academicYear` is the only period-shaped
    field and nothing can be opened or closed, so no posting is ever refused
    for period state.
  - Also not a route around it: a new `packages/finance-model` workspace would
    have to reach `package-lock.json`, which is on the same shared list and
    which `tests/architecture/lockfile-knows-every-workspace.test.mjs` exists
    to enforce — `npm ci` fails on step one otherwise.
  - Unblocked by: a serialised wave that owns `apps/web/prisma/schema.prisma`,
    then `cd apps/web && npx prisma migrate dev --name fin_000_002_accounting_foundation`
    against the Postgres in `CLAUDE.md`, then `npm run test --workspace apps/web -- --ci`.

- [ ] **FIN-000-003** — Implement universal accounting event, subledger and immutable balanced journal.
  - Status: BLOCKED_EXTERNAL
  - Blocked on: `apps/web/prisma/schema.prisma` — same shared file as
    FIN-000-002, and this requirement additionally depends on it, because an
    `AccountingEvent` has to name the ledger, book and period the journal it
    produces will post into.
  - What already exists, and what does not. The balanced-journal half is
    partly built and belongs to Payments, not to a document: `buildJournal` in
    `packages/payments/src/posting.ts` refuses to emit an unbalanced journal
    and both sides of a posting share a `journalId`
    (`apps/web/prisma/schema.prisma`, `LedgerEntry.journalId`), and
    immutability is real — `tests/security/ledger-is-not-deleted.test.mjs`
    holds an absolute zero on `ledgerEntry.delete` in application code, so a
    correction is a `REVERSAL` posting. That claim was verified, not taken on
    trust: it is the `TRUE` verdict on
    `apps/web/src/lib/payments/ledger-attribution.itest.ts|double entry` in
    `docs/architecture/fin-finance-surface-inventory.md` §D.
  - The change, exactly: add `AccountingEvent` (source module, source document
    id, event type, effective date, and an idempotency key so one business
    event cannot post twice), `AccountingRule` persisting what
    `POSTING_TEMPLATES` currently holds in a TypeScript constant,
    `SubledgerDocument`, `SubledgerEntry`, and a `Journal` header table so a
    journal is an object with a status rather than a bare string column shared
    by two rows. All five are `ABSENT` in §C of that inventory.
  - The false claim this closes: `packages/payments/src/charge-model.ts` tells
    a caller to "post it to the internal subledger instead", and no subledger
    exists. Adjudicated `OVERSTATED` in §D.
  - Unblocked by: FIN-000-002 landing first, then the same serialised wave and
    `cd apps/web && npx prisma migrate dev --name fin_000_003_accounting_event_and_subledger`,
    then `npm run test --workspace apps/web -- --ci` and `npm run test:platform`.

- [ ] **FIN-000-004** — Implement idempotency, corrections, projection rebuild and full drill-through.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-000-005** — Import every `FIN-*` item into the canonical ledger.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-010-001** — Implement journal families, approval, posting, reversals and allocations.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-010-002** — Implement period controls and close command center with dependencies/evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-010-003** — Implement account reconciliation, trial balance, flux and statements.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-010-004** — Prove as-of history, concurrency, reopen and late-adjustment controls.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-020-001** — Implement procure-to-pay and AP exception/reconciliation.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-020-002** — Implement order-to-cash, AR, cash application, collections and refunds boundary.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-020-003** — Implement revenue/contract accounting for declared modes.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-020-004** — Implement expenses/cards boundary, assets/capital and bank reconciliation.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-030-001** — Implement multi-currency, revaluation and translation.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-030-002** — Implement intercompany and consolidation for declared scope.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-030-003** — Implement budget/fund/grant/encumbrance controls.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-030-004** — Implement tax/e-invoice/statutory modes with exact availability.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-030-005** — Integrate Payments Bible for treasury/Stripe/banking execution.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-040-001** — Implement server-side finance authorization, limits, SoD and continuous controls.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-040-002** — Deliver accountant-grade workspaces with WCAG 2.2 AA and long-session tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-040-003** — Implement finance institutional memory, lineage and successor handoff.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-040-004** — Implement safe Relay finance tools, approval classes and evaluations.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-040-005** — Pass security, fraud/abuse, tenant isolation and audit-integrity tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-050-001** — Certify enabled bank/payment/tax/payroll/procurement/commerce/ERP connectors.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-050-002** — Pass all twelve E2E scenarios with zero unexplained critical variance.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-050-003** — Pass scale, posting finality, backup/restore, DR and provider-outage tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-050-004** — Instrument scorecard baseline/targets/results and competitor workflow benchmarks.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-050-005** — Publish exact accounting basis/jurisdiction/provider/capability limitations.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-GATE-000** — Accounting foundation passes property and isolation tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-GATE-010** — Record-to-report is complete for declared scope.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-GATE-020** — Major transaction cycles post and reconcile end to end.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-GATE-030** — Global/specialized finance is truthful and exact-scope.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-GATE-040** — Finance is controlled, explainable and usable.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-GATE-050** — “Best” is supported only by measured evidence for the released scope.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented
