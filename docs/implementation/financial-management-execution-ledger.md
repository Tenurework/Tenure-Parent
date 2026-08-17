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

## FIN-000-004 — two of the four now exist as functions; idempotency has nowhere to keep a key

- [ ] **FIN-000-004** — Implement idempotency, corrections, projection rebuild and full drill-through.
  - Status: FAIL
  - What now exists, and it is half of this requirement:
    - **Projection rebuild.** `trialBalance` in `packages/finops/src/general-ledger.ts` IS a
      rebuild: every balance it reports is folded from the postings themselves,
      with no stored aggregate anywhere in the path, so the projection cannot
      drift from the ledger by construction. Proven by
      `packages/finops/src/general-ledger.test.ts` → 29/29.
    - **Drill-through**, partly. `accountAnalysis` returns every movement on an
      account carrying its `journalId` and `lineId`, so a balance leads to the
      rows that made it. §3.3 asks for the whole chain — "journal, subledger,
      business document and approval" — and the two middle links do not exist:
      there is no `SubledgeDocument` table and `LedgerEntry.approvalId` is
      nullable and unjoined by this path.
    - **Corrections** are already reversal-only, and were before this wave:
      `reverseLedgerEntry` in
      `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts`, held by
      `tests/security/ledger-is-not-deleted.test.mjs`.
  - What is missing, precisely: **idempotency**. There is no `AccountingEvent`
    row and therefore no place to keep an idempotency key, so nothing can refuse
    a second posting of one business event. `docs/architecture/fin-finance-surface-inventory.md`
    §C records `AccountingEvent` as ABSENT, and `FIN-000-003` — which would add
    it — is `BLOCKED_EXTERNAL` on `apps/web/prisma/schema.prisma`, a file this
    wave's agents may not edit.
  - Not closable by a function: an idempotency key that lives in memory is not
    idempotency. Two requests in two processes both find nothing and both post.
  - Unblocked by: `FIN-000-003` landing the `AccountingEvent` table with a unique
    index on (source module, source document id, event type), then a posting path
    that inserts the event in the same transaction as the journal.

## FIN-000-005 — every FIN requirement is in this ledger once, saying what the Bible says, with a decidable status

- [x] **FIN-000-005** — Import every `FIN-*` item into the canonical ledger.
  - Status: PASS
  - Code: `tests/architecture/fin-ledger-import-is-complete.test.mjs` — six checks
    over `requirementsIn` (the graph's own parser, `tools/document-graph.mjs`) and
    this ledger's rows.
  - Caller: `tools/run-platform-tests.mjs` discovers every `tests/**/*.test.mjs`,
    and `.github/workflows/ci.yml` runs it as the "Platform tests" step, so this
    is a CI check the moment the file exists. `npm run test:platform`.
  - What it asserts, and why each is not already covered by
    `document-graph.test.mjs`'s `UNIMPORTED = 0`:
    1. the 34 ids the Bible states and the 34 canonical rows here are the same
       set, compared BOTH ways — `UNIMPORTED` only proves no requirement is
       missing from EVERY execution document, and says nothing about a row for an
       id no Bible states, which `buildRegistry()` cannot see at all;
    2. no id has two canonical rows — `ledgerStatuses()` keys a `Map` by id, so a
       second row silently overwrites the first and one of the two statuses,
       possibly the honest one, is never read;
    3. **each row quotes the Bible's own sentence.** Nothing anywhere checked
       this before. A row is otherwise free to restate its requirement more
       narrowly and then pass against the narrower reading;
    4. no other ledger holds a `FIN-*` row — finance and payments genuinely
       overlap (Bible §8 hands treasury to the Payments Bible), which makes this
       the likeliest stray in the repository and the hardest to see, because
       `importedIds()` counts it as imported;
    5. `tools/import-requirements.mjs` still maps the `FIN` prefix at this file,
       so the guard cannot end up reading a ledger nothing writes to;
    6. every row's status is one `tools/loop/next-batch.mjs` can act on — a
       `PARTIAL` returns the item to the queue every tick, forever.
  - Tests: `node --test tests/architecture/fin-ledger-import-is-complete.test.mjs`
    → `# pass 6`, `# fail 0`. The first assertion is an EQUALITY on the parsed
    count (34), not a floor, so a parser that silently matched nothing fails
    instead of comparing two empty arrays.
  - Mutations: **5 applied, 5 caught**, each by a different check, each restored
    to 6/6. Re-runnable: `node tools/loop/fin-record-to-report-mutation-run.mjs --only=guard`.
    Baseline 6/6, then:
    - deleted the `FIN-030-004` row → 1 of 6 failed, "the Bible and the ledger
      state the same FIN requirements" → restored 6/6.
    - narrowed that row's sentence to "Implement tax modes." → 1 of 6, "each
      canonical row quotes the Bible's own sentence" → restored 6/6.
    - filed `FIN-050-004` twice with two different statuses → 1 of 6, "no FIN
      requirement has two canonical rows" → restored 6/6.
    - wrote a `FIN-020-001` row into another execution ledger → 1 of 6, "no other
      ledger claims a FIN requirement" → restored 6/6.
    - repointed the `FIN` prefix in `tools/import-requirements.mjs` at the
      payments ledger → 1 of 6, "the prefix registry still points FIN at this
      ledger" → restored 6/6.
  - Guards restored: the runner reverts every mutation and re-runs, and exits
    non-zero if it cannot get back to 6/6. Nothing was weakened or deleted.

- [ ] **FIN-010-001** — Implement journal families, approval, posting, reversals and allocations.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **FIN-010-002** — Implement period controls and close command center with dependencies/evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Financial_Management_Cloud_Claude_Bible_v1.0.md`; not yet implemented

## FIN-010-003 — the ledger is read back and tied out: trial balance, account analysis, flux, statements, item-level reconciliation

- [ ] **FIN-010-003** — Implement account reconciliation, trial balance, flux and statements.
  - Status: FAIL
  - Overturned on review: Engine arithmetic is real and mutation-solid — I re-ran all 12 claimed mutations one at a time (10 engine, 2 adapter): 12/12 CAUGHT, restored 29/29 and 9/9. I added 10 independent mutations and 9 were caught. But the requirement's own sentence names FOUR deliverables: account reconciliation, trial balance, flux, statements. Only trialBalance reaches a surface (via ledgerTieOut in apps/web/src/lib/finance.ts:874 -> apps/web/src/app/(app)/orgs/[slug]/finance/page.tsx:16,159). Grep for callers across apps packages modules blueprints tools tests shows flux, financialStatements, reconcileAccountBalance and accountAnalysis have NO caller outside their own test file — the only non-test references are the re-export list at packages/finops/src/index.ts:61-66 and prose in tools/fin-finance-surface.mjs / tools/fin-scope-disclosure.mjs. accountAnalysis is reached only from reconcileAccountBalance, which nothing calls. So three of the four named items are library code no surface imports: 'no surface imports it yet' is FAIL, and closing part of a requirement is FAIL not PASS. The ledger row admits flux and financialStatements are not rendered, but is silent on reconcileAccountBalance — the first noun in the requirement — and is still Status: PASS. Secondary: one of MY mutations SURVIVED — packages/finops/src/general-ledger.ts:792 'const ties = isZero(residual) && unclassified.length === 0' -> 'const ties = isZero(residual)' fails 0 of 29, so nothing asserts ties is false when accounts are unclassified; the suite permits ties:true alongside refusal:ACCOUNTS_NOT_CLASSIFIED, the exact 'balances and is wrong' state the module says it prevents.
  - Code: `packages/finops/src/general-ledger.ts` — `trialBalance`,
    `accountAnalysis`, `flux`, `financialStatements`, `reconcileAccountBalance`,
    `lateAdjustments`, `periodOf`, `GeneralLedgerInputError`; exported from
    `packages/finops/src/index.ts`. Adapter: `toPostedLines` and `ledgerTieOut` in
    `apps/web/src/lib/finance.ts`.
  - Caller: `apps/web/src/app/(app)/orgs/[slug]/finance/page.tsx` imports
    `ledgerTieOut` at line 16, calls it on the `LedgerEntry` rows the page already
    reads, and renders the result in a `data-testid="ledger-tie-out"` paragraph.
    `apps/web/src/lib/finance.ts` is itself imported by 14 modules, so the
    conversion is on the same path the finance dashboard already uses. Inside the
    package, `financialStatements` consumes `trialBalance`'s own section type, so
    the statements cannot be produced from a figure the trial balance did not tie.
  - What it does that nothing here did before. Grep for "trial balance" across
    `apps`, `packages`, `modules` and `blueprints` returned nothing but CSS
    transforms; `docs/architecture/fin-finance-surface-inventory.md` §C records
    `Balance`, `Reconciliation` and `Adjustment` as ABSENT. The one comparison that
    existed — `financeIntegrity` — asks whether `BudgetLine.actualCents` equals the
    sum of that line's postings. It never reads `LedgerEntry.account`, never adds a
    debit to a credit, and stays green while BOTH halves of a journal are
    mis-coded. `ledgerTieOut` answers the other question.
  - The load-bearing line, stated because getting it wrong is invisible:
    `LedgerEntry.amountCents` is DEBIT-POSITIVE SIGNED (`buildJournal` in
    `packages/payments/src/posting.ts` writes
    `signedMinorUnits: line.side === "debit" ? value : -value`), so a CREDIT row
    holds a NEGATIVE amount. `toPostedLines` negates the credit arm — not
    `Math.abs`, because a reversal is persisted as the flipped side with the
    negated amount, and taking the magnitude would move a contra amount into the
    other column and tie a ledger that does not.
  - Decisions a reader should be able to argue with:
    - an empty window reports `balanced: null`, never `true` — "we looked and
      found nothing" is not "the books tie";
    - out-of-balance is REPORTED with the residual and a refusal code, never
      plugged;
    - per-journal tie-out is measured as well as the total, because two journals
      out by equal and opposite amounts cancel in every total ever printed;
    - a flux percentage against a zero or absent prior balance is `null` with a
      named `basis` (`PRIOR_IS_ZERO`, `NEW_ACCOUNT`, `CLOSED_ACCOUNT`,
      `NO_PRIOR_PERIOD`), never 0%;
    - statements REFUSE on an unclassified account rather than dropping it, which
      would produce a balance sheet that balances and is wrong; the chart
      classification is an argument, because §24 forbids hard-coding accounting
      rules and a baked chart would assert one chart for every tenant;
    - dates are compared as text and a string carrying a numeric offset is
      refused, so a period boundary cannot move with the reader's timezone.
  - Tests: `packages/finops/src/general-ledger.test.ts` → 29/29
    (`cd apps/web && npx jest --ci general-ledger`), and
    `apps/web/src/lib/finance-tie-out.test.ts` → 9/9
    (`cd apps/web && npx jest --ci finance-tie-out`). `npm run type-check` reports
    no error in any file this row touches.
  - Mutations: **12 applied, 12 caught**, one at a time, each with a literal
    value so no other token could absorb it, each restored. Re-runnable:
    `node tools/loop/fin-record-to-report-mutation-run.mjs --only=engine` and
    `--only=adapter`. Baselines 29/29 and 9/9, then:
    - `subtract(debits, credits)` → `subtract(debits, debits)` → 1 of 29 failed,
      "reports the residual when the books do not tie, and plugs nothing".
    - empty window `null` → `true` → 1 of 29, "says nothing-to-report rather than
      balanced when no line falls in the window".
    - date-only upper bound `T23:59:59.999Z` → `T00:00:00.000Z` → 1 of 29, "treats
      a date-only upper bound as the whole of that day".
    - `if (knownAt !== null && …)` → `if (false && …)` → 1 of 29, "answers as-of:
      what was known then, not what is known now".
    - `changePercent` for an incomputable base `null` → `"0.00"` → 3 of 29,
      including "will not report a movement from zero as a percentage".
    - the unclassified-account refusal condition → `false` → 1 of 29, "refuses
      rather than dropping an account it cannot classify".
    - statement line name read off the composite key again → 2 of 29, "keeps a
      statement line's whole name".
    - `if (isZero(difference))` → `if (true)` → 1 of 29, "names the item, not just
      the variance".
    - late-posting compared by instant instead of by period → 1 of 29, "counts
      periods, not days".
    - `requireUniqueLineIds(lines)` → `void lines` → 1 of 29, "refuses a
      duplicated line rather than doubling a balance".
    - adapter: dropped the credit negation → 6 of 9, including "ties a normal set
      of journals".
    - adapter: `Math.abs` on both arms → 1 of 9, "keeps a contra amount negative
      instead of moving it to the other column".
  - Every mutation was reverted and re-run green by the runner, which fails if it
    cannot get back to 29/29 and 9/9.
  - What this row does NOT claim. `financialStatements` and `flux` are computed
    and are not rendered anywhere yet; the page shows the tie-out sentence and the
    late-posting count. Statements as an accountant-grade workspace is
    `FIN-040-002`, and the rendered paragraph was verified by type-check and unit
    test, not by a screenshot — no e2e was run this wave.

## FIN-010-004 — as-of and late adjustment are answered; concurrency and reopen have no period record to control

- [ ] **FIN-010-004** — Prove as-of history, concurrency, reopen and late-adjustment controls.
  - Status: FAIL
  - Two of the four are now proven, and this row is FAIL because two are not:
    - **as-of history.** `trialBalance` takes `through` (effective date) and
      `knownAt` (recorded instant) separately, so "the books as they stood on 31
      March, as known on 31 March" and "…as known now" are different answers from
      the same rows. Proven in `packages/finops/src/general-ledger.test.ts` →
      "answers as-of: what was known then, not what is known now", and
      mutation-proven by disabling the `knownAt` filter (1 of 29 failed).
    - **late adjustment**, detection only. `lateAdjustments` reports every posting
      whose `recordedAt` month is later than its `effectiveAt` month, and the
      finance page shows the count. Mutation-proven by comparing instants instead
      of periods.
  - What is missing, precisely:
    - **concurrency.** There is no optimistic-concurrency token on anything
      finance writes: `LedgerEntry` has no `version` column and the posting path
      in `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts` recomputes
      `BudgetLine.actualCents` with an aggregate inside the transaction rather than
      a compare-and-set. Proving a concurrency control needs a control to prove,
      and adding one is a schema change this wave may not make.
    - **reopen.** A period cannot be reopened because it cannot be closed: there
      is no period record at all (`Period` and `AccountingPeriod` are ABSENT in
      `docs/architecture/fin-finance-surface-inventory.md` §C, and
      `docs/architecture/fin-accounting-scope-disclosure.md` §E states the
      limitation with the probes that would disprove it). A late adjustment can
      therefore be FOUND and cannot be REFUSED, which is the difference between an
      indicator and a control.
  - Unblocked by: `FIN-000-002` (the `AccountingPeriod` table) and `FIN-010-002`
    (open/close/reopen with two-person protection), then a `version` column and a
    compare-and-set on the posting path for the concurrency half.

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

## FIN-030-001 — the arithmetic exists and has nowhere to read a rate from

- [ ] **FIN-030-001** — Implement multi-currency, revaluation and translation.
  - Status: FAIL
  - Considered and rejected this wave, with the reason, because it looked closable
    and is not. §14 has four bullets; the pieces stand like this:
    - **Deterministic decimal arithmetic: done, and it was done before this wave.**
      `packages/finops/src/money.ts` counts integer minor units with a
      per-currency exponent and a caller-stated rounding mode, and `convert` in
      `packages/finops/src/settlement-components.ts` converts at a rate carrying
      its own date, in one BigInt division, with no float anywhere.
    - **Currency preservation: partly.** A trial balance is produced per currency
      and never totalled across them (`trialBalance`, this wave), and `currency`
      travels on the row in seven Prisma models. Transaction / accounting / ledger
      / reporting currency as four distinct amounts does not exist, because there
      is no ledger record to have a currency.
    - **Rate types, sources, triangulation, direct/inverse quotes, missing and
      stale controls: absent.** `convert` takes ONE rate the caller hands it. There
      is no rate table, so there is nothing to resolve a rate FROM, nothing to
      call stale, and no way to distinguish "no rate for that date" from "a rate
      nobody recorded a source for".
    - **Revaluation, translation, realized/unrealized gain or loss: absent.**
      Verified by probe rather than by reading: `docs/architecture/fin-accounting-scope-disclosure.md`
      §E carries the row "A stored exchange rate, revaluation and translation —
      NOT AVAILABLE", proven by probes for the models `Rate`, `ExchangeRate`,
      `FxRate` and for an export named `revalue|revalueBalances|translateTrialBalance|
      cumulativeTranslationAdjustment|unrealizedGainLoss|realizedGainLoss`. That
      row is asserted by `tests/architecture/fin-scope-disclosure.test.mjs` and
      mutation-proven: adding a `revalueBalances` export reds it (2 of 10 failed).
  - Why a module was not written anyway. A revaluation engine with no rate store
    has no production caller — `convert` has none today either; grep for
    `convert(` outside `packages/finops` returns only its own tests — and this
    programme's rule is that a module nothing calls is not shipped. The honest
    output is this row rather than an untested engine and a PASS.
  - Unblocked by: `FIN-000-002`'s `ExchangeRate` table (rate type, source, quote
    direction, effective date, and a uniqueness rule that makes two sources for one
    date a refusal rather than a coin toss), which is `BLOCKED_EXTERNAL` on
    `apps/web/prisma/schema.prisma`. With that, the engine is a day's work on top
    of `convert`, and it can be proven against a caller.

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

## FIN-050-005 — the limitations are published, derived from the code, and cannot go stale quietly

- [x] **FIN-050-005** — Publish exact accounting basis/jurisdiction/provider/capability limitations.
  - Status: PASS
  - Code: `tools/fin-scope-disclosure.mjs` — `sourceFiles`, `financeFiles`,
    `exportedSymbols`, `exportsMatching`, `exportsSymbol`, `accountingBasis`,
    `currencyFacts`, `taxFacts`, `providerFacts`, `CAPABILITY_ROWS`, `resolveRow`,
    `collect`, `render`, and a `--check` mode. It imports its tree readers from
    `tools/fin-finance-surface.mjs` (FIN-000-001) rather than walking the
    directories a second time.
  - Published at: `docs/architecture/fin-accounting-scope-disclosure.md`, five
    sections — accounting basis, ledgers/books/currencies, jurisdiction and tax,
    providers, capability limitations.
  - Caller: `tests/architecture/fin-scope-disclosure.test.mjs`, discovered by
    `tools/run-platform-tests.mjs` and run in CI as the "Platform tests" step
    (`npm run test:platform`). The generator is the document's only author and the
    guard is its reader; nothing else may edit the file.
  - What it publishes, as derived on this run:
    - **no accounting basis is declared anywhere in the platform** — not accrual,
      not cash, not modified accrual, no GAAP, no IFRS. So no statement this
      platform produces may be described as prepared under any standard;
    - money is exact integer minor units with a per-currency exponent; `currency`
      travels on the row in 7 models; a trial balance is per-currency; conversion
      exists as a function and **no stored exchange rate exists**, therefore no
      revaluation, no translation, no reporting currency;
    - **tax determination: none.** A tax amount supplied by a caller is posted to
      `RECOVERABLE_TAX_ACCOUNT` = `1400-recoverable-tax` by a template revision,
      which is posting and not determination. No e-invoicing. Where this platform
      says "jurisdiction" it means provider country, data residency or a pricing
      region — **no tax jurisdiction is supported, in any country**;
    - **0 of 31** payment/treasury capability leaves in
      `packages/payments/src/capability-registry.ts` are in a transactable state
      (24 PLANNED, 7 UNSUPPORTED; transactable means TENANT_PILOT, GA_LIMITED or
      GA). No bank, tax, payroll, procurement, commerce or ERP connector is
      certified;
    - **0 of 20** of the Bible §3.2 universal accounting objects exist as records;
    - a capability table: **10 AVAILABLE, 10 NOT AVAILABLE, 0 CONTRADICTED**.
  - Why it cannot rot, which is the whole design: an AVAILABLE row names a module,
    a test and the symbols the module must export, and a NOT AVAILABLE row names
    the Prisma models and exported symbol names whose EXISTENCE would disprove it.
    The generator resolves both and emits `CONTRADICTED` — not a quiet downgrade —
    when a claim does not hold, and the guard fails on any such row. So the moment
    somebody lands revaluation or a period table, the matching limitation reds.
  - Two false answers this found and fixed, recorded because they are the failure
    mode: the first run reported five "declared accounting bases" that were
    `VerdictBasis`, `SpreadBasis`, `SupportBasis` and `FluxBasis` — four unrelated
    meanings of an English word — and printed "transactable only in ;" because the
    regex reading `STATES_REQUIRING_APPROVAL` matched the EMPTY brackets of the
    `readonly CapabilityState[]` type annotation. Both are now name-anchored, and
    the second is asserted directly ("the provider figures come from a parser that
    found something").
  - Word probes were also replaced by export probes: a search for `revaluation`
    hit a comment in `apps/web/src/app/(app)/calendar/actions.ts:110` reading
    "cannot silently revalue a request in flight", and a prose mention must not be
    able to contradict a limitation.
  - Churn: no file count and no tree-wide word list appears in the document, and
    the vocabulary table is scoped to the finance surface. A published disclosure
    that reds because an unrelated domain used a word is a disclosure people stop
    regenerating.
  - Tests: `node --test tests/architecture/fin-scope-disclosure.test.mjs` →
    `# pass 10`, `# fail 0`. Ten checks: `--check` in a subprocess AND an
    in-process re-render, a non-vacuity floor, a POSITIVE CONTROL that the probe
    machinery can still find `trialBalance`, no CONTRADICTED row, every AVAILABLE
    row re-derived, every NOT AVAILABLE row re-probed, every cited path opened
    (25+), the provider parser, the basis claim in both directions, and the
    currency/tax claims.
  - Mutations: **5 applied, 5 caught**, each restored to 10/10. Re-runnable:
    `node tools/loop/fin-record-to-report-mutation-run.mjs --only=disclosure`.
    - hand-edited the committed document to call fixed-asset accounting AVAILABLE
      → 1 of 10 failed, "the committed disclosure is what the generator produces
      now" → restored.
    - renamed the `lateAdjustments` export and regenerated → 3 of 10, including
      "no capability row is CONTRADICTED" → restored.
    - added a `revalueBalances` export and regenerated → 2 of 10, "every NOT
      AVAILABLE row still finds nothing" → restored. This is the stale-limitation
      direction, and it is the one that matters.
    - loosened the transactable-state parser back to the bracket-matching version
      → 1 of 10, "the provider figures come from a parser that found something" →
      restored.
    - made the exported-symbol probe return nothing at all → 1 of 10, "the probes
      can find something that is there" → restored. Without that positive control
      a broken probe would have made ten limitations vacuously true and this suite
      green.
  - What this row does NOT claim: the document is a disclosure, not a product
    surface. Nothing renders it to a tenant. `FIN-GATE-050` stays FAIL — a
    scorecard with measured baselines and targets is `FIN-050-004`, and this
    publishes limits, not evidence of superiority.

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
