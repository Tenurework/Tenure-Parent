# Finance surface inventory — FIN-000-001

**Generated. Do not edit by hand.**

```
node tools/fin-finance-surface.mjs           # rewrite this file
node tools/fin-finance-surface.mjs --check   # fail if it is stale
```

`tests/architecture/fin-finance-surface.test.mjs` runs the `--check` and asserts that every path this document names exists, that no capability claim is left unadjudicated, and that the classifier is not vacuous. An inventory nothing re-derives is a paragraph.

## What was measured

- Roots scanned for `.ts`/`.tsx`/`.mjs`: `apps/web/src`, `apps/web/e2e`, `apps/system-studio/src`, `apps/system-studio/e2e`, `packages`, `modules`.
- Finance surface: **91 files** — 52 source, 34 unit/integration test, 5 e2e.
- Facet hits (a file can match several): budget 7 · expense 3 · ledger 11 · payment 35 · cost 35 · finance 14.
- Finance-bearing tables in `apps/web/prisma/schema.prisma`: **10**.
- Bible §3.2 canonical accounting objects present as tables: **0 of 20** — none. A further 1 (`Account`) has its name taken by an unrelated model, which is a migration hazard and is not coverage.
- Capability claims: **15** — 5 TRUE, 7 SCOPED, 3 OVERSTATED, 0 UNADJUDICATED.

## A. The finance surface

Every file whose POSIX path matches a finance facet. `plane` is derived from the root: `tenant` is what a club signs into, `operator` is the Studio, `shared` is a workspace package either can import. `cost` is a facet of its own because AWS spend attribution is finance-shaped code about Tenure's money, not a tenant's.

| Path | Plane | Kind | Facets |
| --- | --- | --- | --- |
| `apps/system-studio/e2e/cost.spec.ts` | operator | e2e | cost |
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
| `apps/web/src/app/(app)/approvals/money-movement.test.ts` | tenant | test | ledger |
| `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts` | tenant | source | finance |
| `apps/web/src/app/(app)/orgs/[slug]/finance/money-path.itest.ts` | tenant | test | ledger, finance |
| `apps/web/src/app/(app)/orgs/[slug]/finance/page.tsx` | tenant | source | finance |
| `apps/web/src/app/(app)/reports/finance/page.tsx` | tenant | source | finance |
| `apps/web/src/app/api/ai/chat/model-budget.test.ts` | tenant | test | budget |
| `apps/web/src/app/api/payments/provider-events/route.ts` | tenant | source | payment |
| `apps/web/src/app/api/templates/budget/route.ts` | tenant | source | budget |
| `apps/web/src/components/finance/BudgetBarChart.tsx` | tenant | source | budget, finance |
| `apps/web/src/components/finance/BudgetUpload.tsx` | tenant | source | budget, finance |
| `apps/web/src/components/finance/FinanceDashboard.tsx` | tenant | source | finance |
| `apps/web/src/components/finance/LedgerDrawer.tsx` | tenant | source | ledger, finance |
| `apps/web/src/components/finance/PortfolioSankey.tsx` | tenant | source | finance |
| `apps/web/src/components/finance/ReimbursementForm.tsx` | tenant | source | expense, finance |
| `apps/web/src/lib/config/payment-mode.test.ts` | tenant | test | payment |
| `apps/web/src/lib/finance-integrity.test.ts` | tenant | test | finance |
| `apps/web/src/lib/finance.test.ts` | tenant | test | finance |
| `apps/web/src/lib/finance.ts` | tenant | source | finance |
| `apps/web/src/lib/payments/ledger-attribution.itest.ts` | tenant | test | ledger, payment |
| `packages/finops/src/allocation.ts` | shared | source | cost |
| `packages/finops/src/finops.test.ts` | shared | test | cost |
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
| `packages/payments/src/capability-registry.test.ts` | shared | test | payment |
| `packages/payments/src/capability-registry.ts` | shared | source | payment |
| `packages/payments/src/charge-model.test.ts` | shared | test | payment |
| `packages/payments/src/charge-model.ts` | shared | source | payment |
| `packages/payments/src/eligibility.test.ts` | shared | test | payment |
| `packages/payments/src/eligibility.ts` | shared | source | payment |
| `packages/payments/src/external-reference.test.ts` | shared | test | payment |
| `packages/payments/src/external-reference.ts` | shared | source | payment |
| `packages/payments/src/funds-flow.test.ts` | shared | test | payment |
| `packages/payments/src/funds-flow.ts` | shared | source | payment |
| `packages/payments/src/gateway.ts` | shared | source | payment |
| `packages/payments/src/index.ts` | shared | source | payment |
| `packages/payments/src/liability.test.ts` | shared | test | payment |
| `packages/payments/src/liability.ts` | shared | source | payment |
| `packages/payments/src/posting.test.ts` | shared | test | ledger, payment |
| `packages/payments/src/posting.ts` | shared | source | ledger, payment |
| `packages/payments/src/refusal.test.ts` | shared | test | payment |
| `packages/payments/src/refusal.ts` | shared | source | payment |
| `packages/payments/src/responsibility.test.ts` | shared | test | payment |
| `packages/payments/src/responsibility.ts` | shared | source | payment |
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
| `apps/web/src/app/(app)/reports/finance/page.tsx` | consolidation | 1 | OVERSTATED | Calls itself 'the two-tier ERP consolidation view'. It is one findMany that sums each club's BudgetLine rows. There is no second legal entity, no ownership percentage, no elimination and no currency translation, so no consolidation is performed. FIN-060. |
| `apps/web/src/lib/config/payment-mode.test.ts` | legal entity | 1 | SCOPED | Describes which legal entity a tenant ACTS FOR when a charge is made. It is a configuration value, not an accounting entity. |
| `apps/web/src/lib/finance.ts` | general ledger | 1 | OVERSTATED | A section header over five LedgerKind labels, a sign function and a disclosure string. A general ledger needs a ledger, a book, a chart of accounts and a period; none of the four exists. FIN-000-002. |
| `apps/web/src/lib/payments/ledger-attribution.itest.ts` | double entry | 1 | TRUE | buildJournal in packages/payments/src/posting.ts refuses to emit an unbalanced journal, and both sides carry the same journalId. Balance is enforced at build time, which is what the sentence claims. |
| `packages/payments/src/capability-registry.ts` | multi-currency | 1 | TRUE | Declared with the `planned` constructor, so the registry states the capability is NOT available. This is the shape a capability claim is supposed to take. |
| `packages/payments/src/charge-model.ts` | legal entity | 4 | SCOPED | `legalEntityType` and a registration country are inputs to a pure decision function. Nothing persists a legal entity. |
| `packages/payments/src/charge-model.ts` | subledger | 1 | OVERSTATED | A blocker message tells the caller to 'post it to the internal subledger instead'. No subledger exists — there is one LedgerEntry table and no subledger document or entry at all. FIN-000-003. |
| `packages/payments/src/eligibility.ts` | legal entity | 2 | SCOPED | The legal-entity TYPE a capability is declared for. A type, not an entity. |
| `packages/payments/src/funds-flow.ts` | legal entity | 1 | SCOPED | Quotes the Payments Bible on direct flow. Describes the intended arrangement, claims no model. |
| `packages/payments/src/posting.ts` | legal entity | 1 | SCOPED | The header QUOTES Bible §13 — templates 'versioned by legal entity, ledger/book, transaction type, provider flow, currency, tax and effective date' — and attributes it. What POSTING_TEMPLATES actually versions by is effective date and currency; the other five axes do not exist. Attributed, so not a false claim, but a reader skimming it will over-read the code. FIN-000-002. |
| `packages/payments/src/refusal.test.ts` | legal entity | 2 | TRUE | Tests the refusal that the source performs. |
| `packages/payments/src/refusal.ts` | legal entity | 4 | TRUE | The refusal is real: a posting whose payee is outside the source legal entity is escalated rather than posted. It refuses the case instead of accounting for it, which is honest and is why IntercompanyTransaction is ABSENT above. |

## What this inventory says

The platform has real finance code — 91 files and 10 money-bearing tables — and it is club budgeting, reimbursement and payment-provider plumbing, not accounting. Money is integer minor units end to end, a posting is a balanced journal, and a posted entry is corrected by a reversal rather than a delete. Above that line there is nothing: 20 of the 20 objects the Bible names as the minimum are not there, including every one that makes a ledger a ledger — `Journal`, `Ledger`, `Book`, `Account`, `Period`.

Of 15 capability claims, 3 are OVERSTATED. They are not marketing copy; they are comments and blocker messages that name objects nobody has built, which is the exact failure this inventory exists to find. Each is cited in the table above with the requirement that would make it true.
