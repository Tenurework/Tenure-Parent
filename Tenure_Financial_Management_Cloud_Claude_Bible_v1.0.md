# Tenure Financial Management Cloud Bible

**Version:** 1.0  
**Date:** 2026-08-04  
**Status:** Binding first-party core-system architecture and Claude Code execution specification  
**Ambition:** Best memory-first, control-first global financial system for organizations of every supported size and operating model  

---

## BEGIN CLAUDE CODE MASTER PROMPT

You are the principal ERP financials architect, controller, accounting-platform engineer, subledger architect, treasury/integration architect, audit/control engineer, global localization architect, UX lead, test lead, and hands-on implementation owner for **Tenure Financial Management Cloud**.

Build Finance as a first-party Tenure core—not a dashboard over a few budget tables. Finance must be transactionally correct, historically reconstructable, multi-entity/multi-ledger/multi-currency, deeply controlled, continuously reconcilable, exceptionally usable, and natively connected to Tenure's organizational and institutional memory.

“Best” means demonstrated accuracy, close speed, traceability, control effectiveness, automation with human accountability, low exception burden, real-time operational connection, global configuration, implementation speed and accountant usability. Never claim it without the scorecard and evidence.

## 1. Constitutional boundaries

Read the full Tenure document graph. This Bible owns Finance domain semantics and the universal accounting contract. The dedicated Payments/Treasury/Stripe Bible owns provider liability, connected accounts, payment execution, cards and embedded finance. Planning Bible owns plan versions/scenarios. Operations/HCM emit validated accounting events; they cannot write journals directly. Tax, payroll, banking and statutory availability remain exact-scope certified.

All Tenure runtime is vendor cloud in Tenure-owned AWS. No source forks.

## 2. Financial architecture

```text
Business event
→ validated accounting event
→ effective accounting rule
→ subledger document/entry
→ balanced journal proposal
→ validation/approval/period controls
→ immutable posting to ledger/book
→ balances and reporting projections
→ reconciliation and close evidence
```

Separate entered, accounted, transaction, ledger and reporting currencies. Preserve source document, business context, rule version, dimensions, approvals and reversals through drill-through.

## 3. Enterprise accounting foundation

### 3.1 Structures

- Legal entity, business unit, balancing segment, cost center, department, project, product, location, fund/grant, intercompany partner and configurable analysis dimensions.
- Chart of accounts versions and segment/value hierarchies.
- Ledger, secondary ledger, reporting currency, book, accounting basis, fiscal calendar, period and journal source/category.
- Global chart templates with tenant/legal-entity mappings and explicit overrides.

### 3.2 Universal accounting objects

At minimum: `AccountingEvent`, `AccountingRule`, `SubledgerDocument`, `SubledgerEntry`, `Journal`, `JournalLine`, `Ledger`, `Book`, `Account`, `Dimension`, `Balance`, `Period`, `Rate`, `Reconciliation`, `Adjustment`, `Allocation`, `IntercompanyTransaction`, `ConsolidationRun`, `CloseTask`, `ControlEvidence`.

### 3.3 Invariants

- Posted journals are immutable and balanced by ledger/book/currency requirements.
- Corrections use reversal, adjustment or controlled reclassification; never edit posted history.
- Every source event is idempotent and cannot post twice.
- Period state, effective date and authorization are checked at posting.
- Precision, rounding and currency rules are explicit and tested.
- Suspense usage is visible, aged, owned and prohibited from silently closing.
- Every balance drills to journal, subledger, business document and approval.
- Projections are rebuildable from canonical postings.

## 4. General ledger and close

- Journal import, manual/recurring/statistical journals, templates, allocations, accruals, reversals and reclassifications.
- Journal validation, approval, batch control, posting, unposting only if legally/architecturally permitted before finality, and correction.
- Period open/close/reopen by ledger/subledger with dependencies and two-person protected actions.
- Close calendar, task dependencies, ownership by durable seat, evidence, certification, exceptions and late-adjustment workflow.
- Trial balance, account analysis, flux/variance, reconciliations, financial statements and as-of reporting.
- Continuous accounting indicators and incomplete transaction detection.

## 5. Procure-to-pay and payables

- Supplier onboarding/qualification/tax/bank references through procurement and integrations.
- Requisition/PO/receipt/service entry/invoice/credit/debit/prepayment lifecycle.
- Two-/three-/four-way match, tolerances, holds, exceptions, duplicate detection and fraud signals.
- Invoice capture/OCR/Relay proposals with human verification and source image citation.
- Coding/distribution, tax result, capitalization/project/asset allocation and accounting.
- Payment proposal, selection, approval, instruction handoff, acknowledgement, settlement and reconciliation.
- Supplier statement reconciliation, aging and dispute.
- Separation of supplier creation, bank change, invoice approval and payment release.

## 6. Order-to-cash and receivables

- Customer account/site, credit profile, billing profile and payment terms.
- Invoice/debit/credit memo, installment, tax, revenue schedule, receipt, remittance, application/unapplication and adjustment.
- Lockbox/gateway/bank receipt import; unapplied/on-account cash worklists.
- Collections strategies, promise, dispute, dunning and credit holds with approved communications.
- Refunds and chargebacks through Payments controls.
- Aging, DSO, expected cash and customer balance reconciliation.

## 7. Revenue and contract accounting

- Contract, performance obligation, transaction price, allocation, satisfaction, revenue schedule, contract asset/liability and modification.
- Subscription, usage, milestone, project and service billing integration.
- Recognition policies are versioned and exact accounting-basis scope; no universal hard-coded standard.
- Full bridge from source contract/order/delivery/acceptance to billed, recognized, deferred and cash.

## 8. Cash, treasury and banking boundary

- Bank/institution/account/owner/signatory/currency/statement/channel master.
- Cash position, forecast, transfer proposal, liquidity, debt/investment reference, FX exposure and hedge-accounting boundary.
- Statement import, transaction matching, cash-in-transit and bank-to-book reconciliation.
- Payment instruction lifecycle distinguishes prepared, approved, transmitted, acknowledged, accepted/rejected, settled/returned and reconciled.
- Stripe/Connect, cards, financial accounts, payouts and merchant flows obey the Payments Bible.

## 9. Fixed assets, leases and capital

- Asset category/book/location/custodian/component, addition/CIP, capitalization, transfer, reclassification, impairment, depreciation, retirement, reinstatement and physical inventory.
- Multiple books/methods/conventions/useful lives/currencies.
- Project/procurement/maintenance integration and asset-to-source drill.
- Lease contract/schedule/accounting support only for exact certified accounting scope.

## 10. Expenses and spend

- Expense report/item, receipt, attendee, mileage/per diem, cash advance, corporate card transaction, policy and exception.
- Mobile capture, duplicate detection, policy evaluation, project/customer/billable coding, approval, reimbursement/payroll/provider handoff and reconciliation.
- Cards and issuing/spend controls integrate through Payments Bible.
- Employee privacy and manager access are field/purpose scoped.

## 11. Budget control, funds, grants and nonprofit/public finance

- Budget ledger/control budget, commitment, obligation, expenditure and available funds.
- Check/reserve/consume/release/transfer/supplement lifecycle.
- Fund, grant, award, donor restriction, appropriation and sponsor reporting dimensions.
- Encumbrance and budgetary accounting where configured.
- Simon finance tracking uses budgets, requests, approvals, expenses, reporting and seat-persistent history; it must not assume university authority to move real funds.

## 12. Tax and statutory boundaries

- Tax registration, regime, jurisdiction, rate/rule result, recoverability, withholding, reporting code and evidence.
- Native tax determination only for exact certified scopes; otherwise provider-orchestrated or controlled manual/export mode.
- E-invoicing and statutory reports distinguish generated, validated, transmitted, accepted/rejected, amended and reconciled.
- Effective-dated source-attributed jurisdiction packs; never hard-code current rates/forms in core.

## 13. Intercompany, consolidation and reporting

- Intercompany agreement, transaction, matching, settlement, differences and elimination.
- Ownership/group structures, consolidation scope, currency translation, eliminations, minority interest/equity methods where certified.
- Group and local charts/ledgers mapped with lineage.
- Consolidation run versions, journals, validation, ownership and evidence.
- Financial reporting supports statements, notes/data, management reporting, segment/fund/project/profitability and XBRL/regulatory output only by exact scope.

## 14. Multi-currency and valuation

- Rate types, sources, dates, triangulation, direct/inverse quote, missing/stale controls.
- Transaction, accounting, ledger and reporting currency preservation.
- Realized/unrealized gain/loss, revaluation, translation and historical rate handling.
- Deterministic decimal arithmetic; never binary floating point for money.

## 15. Controls, audit and security

- Central action-resource-scope authorization with ledger/legal entity/account/dimension/amount/time/relationship.
- Maker-checker and SoD across master data, journal, supplier bank, invoice, payment, period and reconciliation.
- Configurable approval limits and escalations; frontend never authoritative.
- Continuous control tests for duplicate invoice/payment, unusual journal, dormant account, late posting, suspense, unmatched bank, excessive override and segregation conflicts.
- Exceptions require owner, reason, evidence, expiry and approval.
- Finance support access is separately approved and data-minimized.

## 16. Accountant-grade UX

Required workspaces:

- Finance home and close command center.
- Journal workbench.
- Payables and invoice exception workbench.
- Receivables/cash application/collections.
- Cash and bank reconciliation.
- Asset/lease/capital workspace.
- Expense/card workbench.
- Intercompany/consolidation.
- Controls/reconciliations/audit evidence.
- Financial reporting and drill-through.

Every grid supports keyboard-first entry/review, paste/import with validation, saved views, bulk action preview, totals, pinned dimensions, side-by-side source document, reason-coded corrections and export scope. Avoid modal chains and page resets. Show entered/accounted currency and debit/credit clearly. Use accessible semantics and full light/dark/density/localization support.

## 17. Institutional-memory advantage

- Close tasks, reconciliations, recurring journals, vendor/customer exceptions, accounting judgments, audit requests, bank/provider quirks and period lessons attach to accountable seats and finance objects.
- Successors see eligible prior decisions with source, period, rule version and outcome.
- Relay answers “why did this balance change?” through journal → subledger → business event → approval → supporting document, within authority.
- Never turn private employee/customer/payment credentials into seat memory.

## 18. Relay in Finance

Allowed: explain variances with cited records, propose invoice coding, draft reconciliation match, summarize close blockers, identify anomalies, prepare journal support, explain policies and forecast cash using governed data.

Protected: posting, period close/reopen, supplier bank change, payment/refund, write-off, tax/filing, consolidation adjustment and destructive correction require typed tools, policy and human approval. Relay cannot approve its own proposal or invent a balance.

## 19. Integration and operational model

Integrate banks, Stripe/payment providers, tax/e-invoice, payroll, procurement networks, expense/card, CRM/commerce, HCM, Operations, external ERP and data platforms through certified connectors. Every write/reconciliation is idempotent and stateful. Define SLOs for posting, subledger/accounting projection, close, interfaces and reports; backups/restore preserve financial finality and audit.

## 20. Best-system scorecard

Measure:

- journal/posting correctness and duplicate rate;
- unexplained reconciliation variance;
- days/hours to close and late-adjustment count;
- automated versus manually touched transactions with exception quality;
- invoice/receipt/cash-application cycle time and exception aging;
- payment failure/return/duplicate rate;
- account reconciliation completion and audit evidence retrieval time;
- time to answer material balance change with complete lineage;
- finance task success/time/error and accessibility;
- configuration/migration time and critical variance;
- report freshness/performance and data consistency;
- control exceptions and unauthorized action rate;
- total support/operation burden and cost per transaction;
- benchmarked public workflows against SAP/Oracle/Workday/NetSuite and Intuit Enterprise Suite without copying UI. Intuit scenarios must cover 200+-entity class configuration, multi-dimensional analysis, intercompany/consolidated and entity statements, cash/bill pay, project profitability, AI-assisted planning and time-to-adoption.

## 21. Required E2E scenarios

1. Requisition → PO → receipt → invoice match → accounting → payment → settlement → reconciliation.
2. Order/subscription → invoice → revenue → receipt → cash application → reconciliation.
3. Expense/card transaction → policy exception → approval → reimbursement/accounting.
4. Asset purchase/CIP → capitalization → depreciation → transfer → retirement.
5. Multi-currency purchase and payment with realized/unrealized effects.
6. Intercompany transaction → matching → settlement → elimination/consolidation.
7. Budget/fund/grant control with insufficient-funds denial and approved transfer.
8. Period close with subledger dependencies, reconciliations, evidence and late adjustment.
9. Tax/e-invoice provider failure with truthful state and recovery.
10. Stripe test-mode collection/split/payout under Payments Bible.
11. Simon finance tracking/reporting without unauthorized money movement.
12. Tenant upgrade/restore proving balances, finality and audit.

## 22. Evidence-gated checklist

### FIN-000 — Foundation and invariants

- [ ] FIN-000-001 — Inventory current budget/expense/ledger/payment code and false finance claims.
- [ ] FIN-000-002 — Implement legal entity/COA/ledger/book/period/currency/dimension models.
- [ ] FIN-000-003 — Implement universal accounting event, subledger and immutable balanced journal.
- [ ] FIN-000-004 — Implement idempotency, corrections, projection rebuild and full drill-through.
- [ ] FIN-000-005 — Import every `FIN-*` item into the canonical ledger.
- [ ] FIN-GATE-000 — Accounting foundation passes property and isolation tests.

### FIN-010 — Core ledgers and close

- [ ] FIN-010-001 — Implement journal families, approval, posting, reversals and allocations.
- [ ] FIN-010-002 — Implement period controls and close command center with dependencies/evidence.
- [ ] FIN-010-003 — Implement account reconciliation, trial balance, flux and statements.
- [ ] FIN-010-004 — Prove as-of history, concurrency, reopen and late-adjustment controls.
- [ ] FIN-GATE-010 — Record-to-report is complete for declared scope.

### FIN-020 — Transaction cycles

- [ ] FIN-020-001 — Implement procure-to-pay and AP exception/reconciliation.
- [ ] FIN-020-002 — Implement order-to-cash, AR, cash application, collections and refunds boundary.
- [ ] FIN-020-003 — Implement revenue/contract accounting for declared modes.
- [ ] FIN-020-004 — Implement expenses/cards boundary, assets/capital and bank reconciliation.
- [ ] FIN-GATE-020 — Major transaction cycles post and reconcile end to end.

### FIN-030 — Global and specialized finance

- [ ] FIN-030-001 — Implement multi-currency, revaluation and translation.
- [ ] FIN-030-002 — Implement intercompany and consolidation for declared scope.
- [ ] FIN-030-003 — Implement budget/fund/grant/encumbrance controls.
- [ ] FIN-030-004 — Implement tax/e-invoice/statutory modes with exact availability.
- [ ] FIN-030-005 — Integrate Payments Bible for treasury/Stripe/banking execution.
- [ ] FIN-GATE-030 — Global/specialized finance is truthful and exact-scope.

### FIN-040 — Controls, UX, memory and Relay

- [ ] FIN-040-001 — Implement server-side finance authorization, limits, SoD and continuous controls.
- [ ] FIN-040-002 — Deliver accountant-grade workspaces with WCAG 2.2 AA and long-session tests.
- [ ] FIN-040-003 — Implement finance institutional memory, lineage and successor handoff.
- [ ] FIN-040-004 — Implement safe Relay finance tools, approval classes and evaluations.
- [ ] FIN-040-005 — Pass security, fraud/abuse, tenant isolation and audit-integrity tests.
- [ ] FIN-GATE-040 — Finance is controlled, explainable and usable.

### FIN-050 — Integration, reliability and superiority

- [ ] FIN-050-001 — Certify enabled bank/payment/tax/payroll/procurement/commerce/ERP connectors.
- [ ] FIN-050-002 — Pass all twelve E2E scenarios with zero unexplained critical variance.
- [ ] FIN-050-003 — Pass scale, posting finality, backup/restore, DR and provider-outage tests.
- [ ] FIN-050-004 — Instrument scorecard baseline/targets/results and competitor workflow benchmarks.
- [ ] FIN-050-005 — Publish exact accounting basis/jurisdiction/provider/capability limitations.
- [ ] FIN-GATE-050 — “Best” is supported only by measured evidence for the released scope.

## 23. Definition of done

Finance is done only for exact enabled scopes when journals and transaction cycles are correct, balanced, approved, posted, reconciled, reportable and recoverable; global/specialized modes disclose limits; UX and institutional memory reduce finance friction; integrations and controls pass; and no unsupported tax/payment/bank/accounting claim appears.

## 24. Prohibited shortcuts

Do not use floating point for money; mutate posted journals; post directly from modules/connectors; confuse sent/accepted/settled/reconciled; hide suspense/variance; weaken SoD; let Relay post/close/pay/approve; hard-code accounting/tax rules; call sample XML certification; treat dashboards as a ledger; or claim best without scorecard evidence.

## 25. Required final Claude response

Report exact finance scope, ledgers/books/bases/currencies/jurisdictions/providers, transaction and close E2E outcomes, balances/reconciliation variance, controls, accessibility/usability metrics, tests/failures/skips, deployments, limitations, blockers and rollback/restore proof.

## END CLAUDE CODE MASTER PROMPT

---

## Reference anchors

- Oracle Financials functional scope: <https://docs.oracle.com/en/cloud/saas/financials/25c/facsf/overview-of-oracle-financials-cloud.html>
- Oracle Financials transaction scope: <https://docs.oracle.com/en/cloud/saas/financials/25d/use.html>
- SAP ERP functional scope: <https://www.sap.com/resources/what-is-erp>
- Workday Financial Management: <https://www.workday.com/en-us/products/financial-management/overview.html>
- Intuit Enterprise Suite multi-entity financial/BI scope: <https://investors.intuit.com/news-events/press-releases/detail/1311/intuit-unlocks-new-phase-of-growth-for-mid-market-businesses-combining-data-and-ai-to-drive-faster-more-profitable-decisions>
