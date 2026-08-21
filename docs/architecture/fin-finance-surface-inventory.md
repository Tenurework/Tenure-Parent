# Finance surface inventory — FIN-000-001

**Generated. Do not edit by hand.**

```
node tools/fin-finance-surface.mjs           # rewrite this file
node tools/fin-finance-surface.mjs --check   # fail if it is stale
```

`tests/architecture/fin-finance-surface.test.mjs` runs the `--check` and asserts that every path this document names exists, that no capability claim is left unadjudicated, and that the classifier is not vacuous. An inventory nothing re-derives is a paragraph.

## What was measured

- Roots scanned for `.ts`/`.tsx`/`.mjs`: `apps/web/src`, `apps/web/e2e`, `apps/system-studio/src`, `apps/system-studio/e2e`, `packages`, `modules`.
- Finance surface: **138 files** — 70 source, 62 unit/integration test, 6 e2e.
- Facet hits (a file can match several): budget 9 · expense 5 · ledger 13 · payment 73 · cost 39 · finance 18.
- Finance-bearing tables in `apps/web/prisma/schema.prisma`: **10**.
- Bible §3.2 canonical accounting objects present as tables: **0 of 20** — none. A further 1 (`Account`) has its name taken by an unrelated model, which is a migration hazard and is not coverage.
- Capability claims: **36** — 13 TRUE, 20 SCOPED, 3 OVERSTATED, 0 UNADJUDICATED.

## A. The finance surface

Every file whose POSIX path matches a finance facet. `plane` is derived from the root: `tenant` is what a club signs into, `operator` is the Studio, `shared` is a workspace package either can import. `cost` is a facet of its own because AWS spend attribution is finance-shaped code about Tenure's money, not a tenant's.

| Path | Plane | Kind | Facets |
| --- | --- | --- | --- |
| `apps/system-studio/e2e/cost.spec.ts` | operator | e2e | cost |
| `apps/system-studio/e2e/density-budget.spec.ts` | operator | e2e | budget |
| `apps/system-studio/e2e/pricing-logic.spec.ts` | operator | e2e | cost |
| `apps/system-studio/e2e/pricing-surface.spec.ts` | operator | e2e | cost |
| `apps/system-studio/src/app/platform/cost/CostAnswer.tsx` | operator | source | cost |
| `apps/system-studio/src/app/platform/cost/CostAttribution.tsx` | operator | source | cost |
| `apps/system-studio/src/app/platform/cost/CostBudgets.tsx` | operator | source | budget, cost |
| `apps/system-studio/src/app/platform/cost/CostRates.tsx` | operator | source | cost |
| `apps/system-studio/src/app/platform/cost/CostReportView.tsx` | operator | source | cost |
| `apps/system-studio/src/app/platform/cost/cost-citation.test.tsx` | operator | test | cost |
| `apps/system-studio/src/app/platform/cost/cost-decisions.test.ts` | operator | test | cost |
| `apps/system-studio/src/app/platform/cost/cost-decisions.ts` | operator | source | cost |
| `apps/system-studio/src/app/platform/cost/cost-rates.test.tsx` | operator | test | cost |
| `apps/system-studio/src/app/platform/cost/cost-rates.ts` | operator | source | cost |
| `apps/system-studio/src/app/platform/cost/page.tsx` | operator | source | cost |
| `apps/system-studio/src/app/tenants/[slug]/configuration/change-cost.test.ts` | operator | test | cost |
| `apps/system-studio/src/app/tenants/[slug]/configuration/change-cost.ts` | operator | source | cost |
| `apps/system-studio/src/app/tenants/new/compose-pricing.test.tsx` | operator | test | cost |
| `apps/system-studio/src/lib/audit-ledger.itest.ts` | operator | test | ledger |
| `apps/system-studio/src/lib/audit-ledger.test.ts` | operator | test | ledger |
| `apps/system-studio/src/lib/audit-ledger.ts` | operator | source | ledger |
| `apps/system-studio/src/lib/aws/budgets.test.ts` | operator | test | budget |
| `apps/system-studio/src/lib/aws/budgets.ts` | operator | source | budget |
| `apps/system-studio/src/lib/aws/pricing.test.ts` | operator | test | cost |
| `apps/system-studio/src/lib/aws/pricing.ts` | operator | source | cost |
| `apps/system-studio/src/lib/cost-report.ts` | operator | source | cost |
| `apps/system-studio/src/lib/cost-source.ts` | operator | source | cost |
| `apps/web/e2e/finance.spec.ts` | tenant | e2e | finance |
| `apps/web/e2e/reimbursement.spec.ts` | tenant | e2e | expense |
| `apps/web/src/app/(app)/admin/payments/actions.ts` | tenant | source | payment |
| `apps/web/src/app/(app)/admin/payments/liability-gate.test.ts` | tenant | test | payment |
| `apps/web/src/app/(app)/admin/payments/page.tsx` | tenant | source | payment |
| `apps/web/src/app/(app)/admin/payments/unsupported-capability.test.ts` | tenant | test | payment |
| `apps/web/src/app/(app)/approvals/money-movement.test.ts` | tenant | test | ledger |
| `apps/web/src/app/(app)/approvals/payment-movement-gate.test.ts` | tenant | test | payment |
| `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts` | tenant | source | finance |
| `apps/web/src/app/(app)/orgs/[slug]/finance/money-path.itest.ts` | tenant | test | ledger, finance |
| `apps/web/src/app/(app)/orgs/[slug]/finance/page.tsx` | tenant | source | finance |
| `apps/web/src/app/(app)/reports/finance/page.tsx` | tenant | source | finance |
| `apps/web/src/app/api/ai/chat/model-budget.test.ts` | tenant | test | budget |
| `apps/web/src/app/api/jobs/payments-version-watch/route.test.ts` | tenant | test | payment |
| `apps/web/src/app/api/jobs/payments-version-watch/route.ts` | tenant | source | payment |
| `apps/web/src/app/api/payments/provider-events/route.test.ts` | tenant | test | payment |
| `apps/web/src/app/api/payments/provider-events/route.ts` | tenant | source | payment |
| `apps/web/src/app/api/templates/budget/route.ts` | tenant | source | budget |
| `apps/web/src/app/api/templates/budget/target-spread.test.ts` | tenant | test | budget |
| `apps/web/src/components/ai/relay-payments-claims.test.ts` | tenant | test | payment |
| `apps/web/src/components/finance/BudgetBarChart.tsx` | tenant | source | budget, finance |
| `apps/web/src/components/finance/BudgetUpload.tsx` | tenant | source | budget, finance |
| `apps/web/src/components/finance/FinanceDashboard.tsx` | tenant | source | finance |
| `apps/web/src/components/finance/LedgerDrawer.tsx` | tenant | source | ledger, finance |
| `apps/web/src/components/finance/PortfolioSankey.tsx` | tenant | source | finance |
| `apps/web/src/components/finance/ReimbursementForm.tsx` | tenant | source | expense, finance |
| `apps/web/src/components/payments/MaskedNote.tsx` | tenant | source | payment |
| `apps/web/src/lib/config/payment-mode.test.ts` | tenant | test | payment |
| `apps/web/src/lib/eligibility/receipt.test.ts` | tenant | test | expense |
| `apps/web/src/lib/eligibility/receipt.ts` | tenant | source | expense |
| `apps/web/src/lib/finance-integrity.test.ts` | tenant | test | finance |
| `apps/web/src/lib/finance-tie-out.test.ts` | tenant | test | finance |
| `apps/web/src/lib/finance.test.ts` | tenant | test | finance |
| `apps/web/src/lib/finance.ts` | tenant | source | finance |
| `apps/web/src/lib/payments/audit-evidence-wired.test.ts` | tenant | test | payment |
| `apps/web/src/lib/payments/authority-attacks.test.ts` | tenant | test | payment |
| `apps/web/src/lib/payments/delegation-expiry-wired.test.ts` | tenant | test | payment |
| `apps/web/src/lib/payments/financial-redaction.ts` | tenant | source | payment, finance |
| `apps/web/src/lib/payments/ledger-attribution.itest.ts` | tenant | test | ledger, payment |
| `apps/web/src/lib/payments/masked-display-wired.test.tsx` | tenant | test | payment |
| `apps/web/src/lib/payments/masked-display.test.ts` | tenant | test | payment |
| `apps/web/src/lib/payments/masked-display.ts` | tenant | source | payment |
| `apps/web/src/lib/payments/movement-gate.ts` | tenant | source | payment |
| `apps/web/src/lib/payments/prompt-redaction.test.ts` | tenant | test | payment |
| `apps/web/src/lib/relay/payments-claim-review.ts` | tenant | source | payment |
| `packages/finops/src/allocation.ts` | shared | source | cost |
| `packages/finops/src/finops.test.ts` | shared | test | cost |
| `packages/finops/src/fx-evidence.test.ts` | shared | test | cost |
| `packages/finops/src/fx-evidence.ts` | shared | source | cost |
| `packages/finops/src/general-ledger.test.ts` | shared | test | ledger, cost |
| `packages/finops/src/general-ledger.ts` | shared | source | ledger, cost |
| `packages/finops/src/grounding.test.ts` | shared | test | cost |
| `packages/finops/src/grounding.ts` | shared | source | cost |
| `packages/finops/src/index.ts` | shared | source | cost |
| `packages/finops/src/money.ts` | shared | source | ledger, cost |
| `packages/finops/src/pricing.test.ts` | shared | test | cost |
| `packages/finops/src/pricing.ts` | shared | source | cost |
| `packages/finops/src/receipt-allocation.test.ts` | shared | test | expense, cost |
| `packages/finops/src/reporting.ts` | shared | source | cost |
| `packages/finops/src/settlement-components.ts` | shared | source | payment, cost |
| `packages/finops/src/settlement.test.ts` | shared | test | payment, cost |
| `packages/finops/src/settlement.ts` | shared | source | payment, cost |
| `packages/finops/src/split.ts` | shared | source | cost |
| `packages/payments/src/api-version.test.ts` | shared | test | payment |
| `packages/payments/src/api-version.ts` | shared | source | payment |
| `packages/payments/src/balance-transactions.test.ts` | shared | test | payment |
| `packages/payments/src/balance-transactions.ts` | shared | source | payment |
| `packages/payments/src/capability-api-versions.test.ts` | shared | test | payment |
| `packages/payments/src/capability-gates.test.ts` | shared | test | payment |
| `packages/payments/src/capability-gates.ts` | shared | source | payment |
| `packages/payments/src/capability-registry.test.ts` | shared | test | payment |
| `packages/payments/src/capability-registry.ts` | shared | source | payment |
| `packages/payments/src/capability-states.test.ts` | shared | test | payment |
| `packages/payments/src/charge-model.test.ts` | shared | test | payment |
| `packages/payments/src/charge-model.ts` | shared | source | payment |
| `packages/payments/src/eligibility.test.ts` | shared | test | payment |
| `packages/payments/src/eligibility.ts` | shared | source | payment |
| `packages/payments/src/external-reference.test.ts` | shared | test | payment |
| `packages/payments/src/external-reference.ts` | shared | source | payment |
| `packages/payments/src/financial-identifiers.test.ts` | shared | test | payment, finance |
| `packages/payments/src/financial-identifiers.ts` | shared | source | payment, finance |
| `packages/payments/src/funds-flow.test.ts` | shared | test | payment |
| `packages/payments/src/funds-flow.ts` | shared | source | payment |
| `packages/payments/src/gateway.ts` | shared | source | payment |
| `packages/payments/src/high-risk-actions.test.ts` | shared | test | payment |
| `packages/payments/src/high-risk-actions.ts` | shared | source | payment |
| `packages/payments/src/index.ts` | shared | source | payment |
| `packages/payments/src/liability.test.ts` | shared | test | payment |
| `packages/payments/src/liability.ts` | shared | source | payment |
| `packages/payments/src/limits.test.ts` | shared | test | payment |
| `packages/payments/src/limits.ts` | shared | source | payment |
| `packages/payments/src/movement-commands.test.ts` | shared | test | payment |
| `packages/payments/src/movement-commands.ts` | shared | source | payment |
| `packages/payments/src/payment-order-state.test.ts` | shared | test | payment |
| `packages/payments/src/payment-order-state.ts` | shared | source | payment |
| `packages/payments/src/payout-commands.test.ts` | shared | test | payment |
| `packages/payments/src/payout-commands.ts` | shared | source | payment |
| `packages/payments/src/posting.test.ts` | shared | test | ledger, payment |
| `packages/payments/src/posting.ts` | shared | source | ledger, payment |
| `packages/payments/src/prohibited-claims-content-review.test.ts` | shared | test | payment |
| `packages/payments/src/prohibited-claims.test.ts` | shared | test | payment |
| `packages/payments/src/prohibited-claims.ts` | shared | source | payment |
| `packages/payments/src/refusal.test.ts` | shared | test | payment |
| `packages/payments/src/refusal.ts` | shared | source | payment |
| `packages/payments/src/responsibility.test.ts` | shared | test | payment |
| `packages/payments/src/responsibility.ts` | shared | source | payment |
| `packages/payments/src/version-watch.test.ts` | shared | test | payment |
| `packages/payments/src/version-watch.ts` | shared | source | payment |
| `packages/payments/src/webhook.test.ts` | shared | test | payment |
| `packages/payments/src/webhook.ts` | shared | source | payment |
| `packages/platform-config/src/money.ts` | shared | source | ledger |

## B. Finance-bearing tables

Models in `apps/web/prisma/schema.prisma` that either carry money fields or whose name matches a finance facet. `Line` is the line the `model` keyword sits on, so every row can be opened.

| Model | Line | Money-bearing fields |
| --- | ---: | --- |
| `Budget` | 819 | `totalCents`, `allocatedCents`, `currency` |
| `BudgetLine` | 869 | `budgetedCents`, `actualCents`, `forecastCents`, `currency` |
| `LedgerEntry` | 947 | `amountCents`, `currency` |
| `PaymentsFundsFlowConfig` | 1222 | `currency`, `grossCents`, `platformFeeCents` |
| `ProviderBalanceTransaction` | 1155 | `currency` |
| `ProviderEventReceipt` | 1190 | — |
| `ReceiptAllocation` | 1072 | `currency` |
| `Settlement` | 1130 | `currency` |
| `Transaction` | 846 | `amountCents` |
| `Vendor` | 894 | — |

## C. Canonical accounting objects (Bible §3.2)

The Bible's stated minimum, each looked up as a `model` in the schema. The state is decided by the schema, not by this document. `NAME TAKEN` means a model of that name exists and is something else entirely — it is not coverage, and it is a migration hazard. This table is the gap register FIN-000-002 and FIN-000-003 close.

| Object | Table | What stands in for it today |
| --- | --- | --- |
| `AccountingEvent` | ABSENT | No object. Postings are written inline by `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts`; nothing records the business event that caused one. |
| `AccountingRule` | ABSENT | `packages/payments/src/posting.ts` holds effective-dated posting templates (`postingFor`), which is the rule half without a persisted rule. |
| `SubledgerDocument` | ABSENT | No object. `packages/payments/src/charge-model.ts` already tells an operator to 'post it to the internal subledger', which does not exist. |
| `SubledgerEntry` | ABSENT | No object. |
| `Journal` | ABSENT | No header table. `LedgerEntry.journalId` is a bare string column shared by the sides of one posting (`apps/web/prisma/schema.prisma`). |
| `JournalLine` | ABSENT | `LedgerEntry` is the line, with `side`, `account`, `amountCents` and `currency` (`apps/web/prisma/schema.prisma`). |
| `Ledger` | ABSENT | No object. There is exactly one implicit ledger and it cannot be named, scoped or duplicated. |
| `Book` | ABSENT | No object. |
| `Account` | NAME TAKEN | The schema's `model Account` is NextAuth's OAuth account (provider, providerAccountId, refresh_token). It is not a chart-of-accounts account and adding one will collide with it. `LedgerEntry.account` is a free-text code with no chart, no hierarchy and no validation (`apps/web/prisma/schema.prisma`); the four codes in use are constants in `packages/payments/src/posting.ts`. |
| `Dimension` | ABSENT | `LedgerEntry.budgetLineId` and `LedgerEntry.organizationId` are the only two dimensions, and both are hard-coded columns rather than configurable analysis dimensions. |
| `Balance` | ABSENT | `BudgetLine.actualCents` is a cached sum maintained by `apps/web/src/lib/finance.ts`; there is no balance object by account, period or currency. |
| `Period` | ABSENT | `BudgetLine.academicYear` is a string. Nothing can be opened or closed, so no posting is ever refused for period state. |
| `Rate` | ABSENT | No object. Every amount is single-currency; `apps/web/src/lib/finance.ts` raises `MixedCurrencyError` rather than converting. |
| `Reconciliation` | ABSENT | `apps/web/src/lib/finance.ts` reconciles the cached actual against the posted journal (`financeIntegrity`); nothing reconciles against an external record. |
| `Adjustment` | ABSENT | `LedgerKind.ADJUSTMENT` and `LedgerKind.REVERSAL` are enum values on `LedgerEntry`, not objects with their own lifecycle. |
| `Allocation` | ABSENT | `packages/finops/src/allocation.ts` allocates AWS cost, which is the estate's money and not a tenant's. |
| `IntercompanyTransaction` | ABSENT | No object. `packages/payments/src/refusal.ts` refuses a posting that crosses a legal-entity boundary instead of accounting for one. |
| `ConsolidationRun` | ABSENT | No object. `apps/web/src/app/(app)/reports/finance/page.tsx` rolls budget lines up across clubs in one query. |
| `CloseTask` | ABSENT | No object. |
| `ControlEvidence` | ABSENT | No object. Approvals are evidenced by `ApprovalRequest`/`ApprovalStep`, which is not the same record. |

## D. Capability claims and their verdicts

Every term from the Bible's capability vocabulary uttered anywhere in the surface above, with the verdict recorded in `CLAIM_VERDICTS` in the generator. `TRUE` means the code does what the term means at the scope stated; `SCOPED` means the term is used for a real but narrower thing; `OVERSTATED` means it names a capability the platform does not have. `grep -n` the term in the file to read the line.

| File | Term | Uses | Verdict | Note |
| --- | --- | ---: | --- | --- |
| `apps/system-studio/e2e/pricing-logic.spec.ts` | multi-currency | 1 | SCOPED | A multi-currency line item in the Studio's price COMPOSER — what a tenant would be quoted. No tenant transaction is multi-currency; apps/web/src/lib/finance.ts raises MixedCurrencyError instead. |
| `apps/web/src/app/(app)/admin/payments/page.tsx` | legal entity | 2 | SCOPED | A column and a subtitle on the funds-flow screen. The legal entity is a FIELD on PaymentsFundsFlowConfig used to choose a charge model, not a modelled entity that owns a ledger. FIN-000-002. |
| `apps/web/src/app/(app)/approvals/money-movement.test.ts` | legal entity | 1 | TRUE | Names the boundary the refusal is tested against; the refusal is real (packages/payments/src/refusal.ts). |
| `apps/web/src/app/(app)/orgs/[slug]/finance/page.tsx` | trial balance | 1 | SCOPED | FIN-010-003. The page computes a real trial balance over every posted row — ledgerTieOut, apps/web/src/lib/finance.ts — and renders only its TIE-OUT: balanced or the residual, the account count, and the late-posting count. The per-account debit/credit grid is computed and not displayed. A reader of this page learns whether the books tie, not what is in them. |
| `apps/web/src/app/(app)/reports/finance/page.tsx` | consolidation | 1 | OVERSTATED | Calls itself 'the two-tier ERP consolidation view'. It is one findMany that sums each club's BudgetLine rows. There is no second legal entity, no ownership percentage, no elimination and no currency translation, so no consolidation is performed. FIN-060. |
| `apps/web/src/lib/config/payment-mode.test.ts` | legal entity | 1 | SCOPED | Describes which legal entity a tenant ACTS FOR when a charge is made. It is a configuration value, not an accounting entity. |
| `apps/web/src/lib/finance-tie-out.test.ts` | trial balance | 1 | TRUE | Tests the tie-out the source performs, including the sign convention that would make a balanced ledger report as out of balance by twice itself. |
| `apps/web/src/lib/finance.ts` | chart-of-accounts | 1 | SCOPED | One field label — `/** Chart-of-accounts code. */` on `LedgerLineInput.account`, the shape `toPostedLines` reads and `ledgerTieOut` groups by. The codes are real and they are numbered the way accounts are numbered: `1000-cash-clearing`, `1400-recoverable-tax`, `2100-reimbursement-payable`, `6000-program-expense`, all four exported from `packages/payments/src/posting.ts`. What does not exist is the chart. `LedgerEntry.account` is a bare `String` with no relation and no constraint (`apps/web/prisma/schema.prisma`), `ChartOfAccounts` is ABSENT in §C, and nothing anywhere gives a code a name, a parent, a normal balance or a statement line — `packages/finops/src/general-ledger.ts` has to be HANDED that classification because no record holds it. So the term names a code drawn from four constants in a payments module, not membership of a chart this platform keeps. Same absence the `general ledger` verdict on this file calls OVERSTATED; SCOPED here because a field label naming what a string is, is a smaller claim than a section header naming a ledger. FIN-000-002. |
| `apps/web/src/lib/finance.ts` | double entry | 1 | TRUE | FIN-010-003. toPostedLines puts each row's amount in its declared column and ledgerTieOut totals the two; the double entry itself is enforced at write time by buildJournal (packages/payments/src/posting.ts), which refuses an unbalanced journal, and both halves share a journalId. The sentence claims the reading, and the reading is real. |
| `apps/web/src/lib/finance.ts` | general ledger | 2 | OVERSTATED | A section header over five LedgerKind labels, a sign function and a disclosure string. A general ledger needs a ledger, a book, a chart of accounts and a period; none of the four exists. FIN-000-002. |
| `apps/web/src/lib/finance.ts` | trial balance | 2 | TRUE | FIN-010-003. ledgerTieOut produces debits, credits, per-account nets and the residual, per currency and never totalled across currencies, from @tenure/finops' trialBalance. Proven by apps/web/src/lib/finance-tie-out.test.ts (9/9) and mutation-proven on the credit-sign conversion. |
| `apps/web/src/lib/payments/ledger-attribution.itest.ts` | double entry | 1 | TRUE | buildJournal in packages/payments/src/posting.ts refuses to emit an unbalanced journal, and both sides carry the same journalId. Balance is enforced at build time, which is what the sentence claims. |
| `packages/finops/src/general-ledger.test.ts` | drill-through | 1 | SCOPED | Names what the test asserts: every entry accountAnalysis returns carries its own journalId and lineId. That is the first link of Bible §3.3's chain and not the chain. |
| `packages/finops/src/general-ledger.test.ts` | trial balance | 1 | TRUE | 29 cases over the trial balance the module computes, including the empty window, the contra amount, the as-of window and two journals that cancel. |
| `packages/finops/src/general-ledger.ts` | accrual | 1 | SCOPED | One word, in a comment giving an example of a reconciliation difference — 'an accrual that was released twice'. It claims no accrual BASIS, and none exists: docs/architecture/fin-accounting-scope-disclosure.md §A states that no accounting basis is declared anywhere in this platform. |
| `packages/finops/src/general-ledger.ts` | chart of accounts | 1 | SCOPED | financialStatements takes the chart classification as an ARGUMENT — account, group, normal balance, statement line — because Bible §24 forbids hard-coding accounting rules. No chart-of-accounts RECORD exists (ChartOfAccounts is ABSENT in §C; FIN-000-002 is blocked on it), so the caller supplies one every time and nothing persists it. |
| `packages/finops/src/general-ledger.ts` | chart-of-accounts | 2 | SCOPED | The same claim as this file's `chart of accounts` entry, in the other spelling: `/** Chart-of-accounts code this side hits. */` on `PostedLine.account`, and `financialStatements` documented as working from 'a stated chart-of-accounts classification'. Both spellings are adjudicated because the scanner matches literal substrings and a term written with hyphens is a term it would otherwise not see. Verdict unchanged — the classification is an ARGUMENT the caller supplies every time, per Bible §24, and an account with a balance and no classification is refused (`ACCOUNTS_NOT_CLASSIFIED`) rather than dropped. Nothing here persists a chart. |
| `packages/finops/src/general-ledger.ts` | drill-through | 1 | SCOPED | accountAnalysis carries journalId and lineId on every movement, so a balance leads to the rows that made it. Bible §3.3 asks for journal, subledger, business document and approval; the two middle links have no tables (FIN-000-003) and FIN-000-004's row says so. |
| `packages/finops/src/general-ledger.ts` | trial balance | 8 | TRUE | FIN-010-003. Debits, credits and net per account per currency, the residual reported and never plugged, an empty window reported as null rather than balanced, and per-journal tie-out measured as well as the total. 29/29 with 10 mutations caught. |
| `packages/finops/src/index.ts` | trial balance | 1 | TRUE | The package door naming what it exports, with the reason it is not ./settlement's reconciler. |
| `packages/payments/src/capability-registry.ts` | multi-currency | 1 | TRUE | Declared with the `planned` constructor, so the registry states the capability is NOT available. This is the shape a capability claim is supposed to take. |
| `packages/payments/src/charge-model.ts` | legal entity | 4 | SCOPED | `legalEntityType` and a registration country are inputs to a pure decision function. Nothing persists a legal entity. |
| `packages/payments/src/charge-model.ts` | subledger | 1 | OVERSTATED | A blocker message tells the caller to 'post it to the internal subledger instead'. No subledger exists — there is one LedgerEntry table and no subledger document or entry at all. FIN-000-003. |
| `packages/payments/src/eligibility.ts` | legal entity | 2 | SCOPED | The legal-entity TYPE a capability is declared for. A type, not an entity. |
| `packages/payments/src/funds-flow.ts` | legal entity | 1 | SCOPED | Quotes the Payments Bible on direct flow. Describes the intended arrangement, claims no model. |
| `packages/payments/src/high-risk-actions.ts` | legal entity | 1 | SCOPED | One occurrence, in the module header quoting Bible §22's enumeration of what an audit event carries. The slot behind the word is real — `legalEntity` is one of the 18 `EVIDENCE_FIELDS`, and a value supplied under that name is carried into the package and into its sha256 digest even when the class did not ask for it. But it is in neither `ALWAYS` nor any of the six `EVIDENCE_REQUIREMENTS`, so no high-risk action is ever reported incomplete for want of one, and the module never resolves, validates or looks one up. What a caller would have to hand it is the bare `legalEntityId` string on `PaymentsFundsFlowConfig` (`apps/web/prisma/schema.prisma`); no `LegalEntity` model exists. The term names a field the evidence package will carry if it is given one, not an entity this platform models. FIN-000-002. |
| `packages/payments/src/limits.ts` | legal entity | 1 | SCOPED | One sentence of a doc comment on `recipientKey`, explaining that `null` means a movement between two dimensions of ONE legal entity rather than a payment to somebody. It names the boundary the null case sits inside; it does not claim this package models legal entities, and nothing here holds one. PAY-000-004. |
| `packages/payments/src/movement-commands.test.ts` | legal entity | 2 | SCOPED | PAY-080-001. Exercises the classification the source performs rather than asserting it: a destination different from the source gives INTERCOMPANY_TRANSFER with requiresIntercompanyPolicy true and providerCallPermitted false, a whitespace-padded destination does NOT become intercompany, a null destination reads as no second entity rather than a different one, a blank source is refused (movement-command-source-unreadable), and an internal kind naming an outside beneficiary is refused. All of that is real behaviour of packages/payments/src/movement-commands.ts. SCOPED, tracking the verdict on the source below, because the entity this file supplies is the literal string inst_rochester - an institution id - so what its header calls a balanced journal inside one legal entity and a due-to/due-from across two is proven at the granularity of two ids the test hands in, not of two legal entities this platform models. FIN-000-002. |
| `packages/payments/src/movement-commands.ts` | legal entity | 5 | SCOPED | PAY-080-001. The strongest legal-entity claim in this package, and still narrower than the word. The boundary genuinely DRIVES behaviour instead of decorating a comment: source !== destination is the entire INTERCOMPANY_TRANSFER branch, it is what sets requiresIntercompanyPolicy true and withholds providerCallPermitted, and a blank source returns decided false rather than defaulting to internal - an unclassified movement is not an internal one by default. What the module never does is model, resolve or validate an entity. sourceLegalEntityId is an opaque string, and the only operations performed on it in the file are trim, a length check and inequality. No LegalEntity model exists: `apps/web/prisma/schema.prisma` carries one bare legalEntityId String on PaymentsFundsFlowConfig with no relation, and the one production caller passes approval.institutionId as the source and defaults the destination to that same value (`apps/web/src/app/(app)/approvals/actions.ts`). So what is compared is two INSTITUTION ids standing in for legal-entity identity - two institutions under one legal owner classify as intercompany, and one legal owner spanning two institutions never does. SCOPED for that substitution rather than TRUE, and not OVERSTATED because the module claims no entity model and every unreadable case fails closed. FIN-000-002. |
| `packages/payments/src/posting.ts` | chart-of-accounts | 1 | SCOPED | `/** Chart-of-accounts code. Stable; the journal is keyed on it. */` on `PostingLine.account`. The second sentence is TRUE and this is the file that earns it: the four codes are declared here as constants, `POSTING_TEMPLATES` names them per side, `buildJournal` refuses a journal that does not balance across them, and `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts` takes the account off the template rather than choosing one. The first sentence is the scoped half — the chart is four exported strings in a payments module, versioned by nothing, held by no table and configurable by no tenant, where Bible §12/§3.1 put the chart and its segment hierarchies in tenant configuration. A reader who takes the label at face value will expect a chart to exist; four constants is the whole of it. FIN-000-002. |
| `packages/payments/src/posting.ts` | legal entity | 1 | SCOPED | The header QUOTES Bible §13 — templates 'versioned by legal entity, ledger/book, transaction type, provider flow, currency, tax and effective date' — and attributes it. What POSTING_TEMPLATES actually versions by is effective date and currency; the other five axes do not exist. Attributed, so not a false claim, but a reader skimming it will over-read the code. FIN-000-002. |
| `packages/payments/src/prohibited-claims.test.ts` | legal entity | 1 | TRUE | The test that proves the rule above fires, using the sentence 'Tenure is not the merchant of record; the tenant legal entity is.' Same subject, and it is exercised rather than asserted. |
| `packages/payments/src/prohibited-claims.ts` | legal entity | 1 | TRUE | Not a capability claim at all — it is the REASON a claim is forbidden. The rule refuses the sentence 'Tenure is the merchant of record' on the ground that the tenant's legal entity is the merchant by default (pay-adr-0001), and `describeMerchant` resolves the actual party. The code asserts the arrangement it describes and enforces it by refusing the opposite. |
| `packages/payments/src/prohibited-claims.ts` | subledger | 2 | SCOPED | Used twice, both times to LIMIT what the word may be taken to mean: 'the only balance Tenure computes is an internal subledger figure' (so it must not be called the reader's balance) and 'Tenure's subledger is evidence beside the provider's records, never instead of them'. What exists underneath is real but small — `buildJournal` (posting.ts) refuses an unbalanced journal and posts against four named accounts — which is a bookkeeping mechanism, not an ERP subledger with per-entity books or a period close. SCOPED rather than TRUE because the machinery is narrower than the word, and rather than OVERSTATED because these sentences exist precisely to stop it being presented as money or as authoritative. |
| `packages/payments/src/refusal.test.ts` | legal entity | 2 | TRUE | Tests the refusal that the source performs. |
| `packages/payments/src/refusal.ts` | legal entity | 4 | TRUE | The refusal is real: a posting whose payee is outside the source legal entity is escalated rather than posted. It refuses the case instead of accounting for it, which is honest and is why IntercompanyTransaction is ABSENT above. |

## What this inventory says

The platform has real finance code — 138 files and 10 money-bearing tables — and it is club budgeting, reimbursement and payment-provider plumbing, not accounting. Money is integer minor units end to end, a posting is a balanced journal, and a posted entry is corrected by a reversal rather than a delete. Above that line there is nothing: 20 of the 20 objects the Bible names as the minimum are not there, including every one that makes a ledger a ledger — `Journal`, `Ledger`, `Book`, `Account`, `Period`.

Of 36 capability claims, 3 are OVERSTATED. They are not marketing copy; they are comments and blocker messages that name objects nobody has built, which is the exact failure this inventory exists to find. Each is cited in the table above with the requirement that would make it true.
