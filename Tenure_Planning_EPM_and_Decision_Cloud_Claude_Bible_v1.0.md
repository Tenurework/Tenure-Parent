# Tenure Planning, EPM, and Decision Cloud Bible

**Version:** 1.0  
**Date:** 2026-08-04  
**Status:** Binding first-party core-system architecture and Claude Code execution specification  
**Ambition:** Best connected financial, workforce, sales, operational, capital, project and strategic planning system—with decision memory  

---

## BEGIN CLAUDE CODE MASTER PROMPT

You are the principal EPM/FP&A architect, planning-model engineer, financial-model governance lead, analytics architect, data engineer, decision-science lead, UX architect, AI evaluation lead, and hands-on implementation owner for **Tenure Planning Cloud**.

Build Planning as a first-party Tenure core system. It must connect strategy, assumptions, plans, forecasts, resources, risks, execution and actual results in one governed model. It is not a spreadsheet upload page, dashboard collection or untraceable AI forecast.

Tenure's differentiation is **decision memory**: a plan value carries who/which durable seat proposed it, assumptions, source actuals, driver/rule, scenario, comments, approvals, revisions, resulting actions and later outcome. Successors can understand why a decision was made and how accurate it became.

“Best” means rapid model creation without losing governance; high-performance multidimensional planning; clear lineage; exceptional planner/contributor experience; connected financial/workforce/sales/operations plans; explainable forecasts; shorter cycles; more accurate decisions; and trusted writeback to execution.

## 1. Constitutional boundaries

Read the Tenure document graph, Configurator, Pack Factory, Finance, HCM, Operations and Integration Bibles. Finance owns posted actuals and accounting. HCM owns workforce master. Operations owns operational transactions. Planning imports governed actuals and master dimensions, creates versions/scenarios/decisions, and releases only approved targets/budgets/actions through typed commands.

All runtime remains in Tenure-owned AWS. No tenant forks.

## 2. Planning architecture

```text
Governed actuals + master data + approved external signals
→ semantic dimensions/measures
→ planning model and calculation graph
→ assumptions/drivers/rules
→ scenarios/versions
→ contributor workflow
→ validation/aggregation/allocation
→ review/approval
→ published plan/forecast
→ execution targets/budgets/actions
→ actual outcome and forecast-accuracy feedback
→ durable decision memory
```

## 3. Canonical objects

Implement at minimum:

- `PlanningModel`
- `ModelVersion`
- `Dimension`
- `DimensionMember`
- `Hierarchy`
- `Measure`
- `TimeGrain`
- `Scenario`
- `PlanVersion`
- `ForecastVersion`
- `Assumption`
- `Driver`
- `CalculationRule`
- `AllocationRule`
- `SpreadRule`
- `ExchangeRateSet`
- `DataSlice`
- `PlanningCell`
- `CellAnnotation`
- `DataLock`
- `PlanningCycle`
- `PlanningTask`
- `Submission`
- `Approval`
- `TopDownTarget`
- `BottomUpProposal`
- `Reconciliation`
- `ScenarioComparison`
- `SimulationRun`
- `ForecastModel`
- `ForecastResult`
- `VarianceExplanation`
- `DecisionRecord`
- `PublishedPlan`
- `ExecutionHandoff`
- `AccuracyObservation`

Every cell/value includes model/version/scenario/dimensions/time, unit/currency, source or rule, author/seat, timestamp, status, lineage, lock and classification.

## 4. Modeling engine

### 4.1 Dimensions and hierarchies

Support legal entity, account, cost center, department, product, customer, channel, project, workforce, position/job, location, asset, supplier, fund/grant, scenario, version, currency and time plus namespaced custom dimensions.

- Effective-dated hierarchies and alternate rollups.
- Ragged/balanced hierarchies, attributes, aliases and shared members with explicit semantics.
- Parent-child integrity, ownership and source-system lineage.
- Historical reporting under then-current and current hierarchy views.

### 4.2 Measures and units

Support currency, count, FTE, hours, units, rates, percentages, days, capacity and custom units. Separate stored/input, calculated, aggregated and reference measures. Define aggregation behavior; percentages/rates do not blindly sum.

### 4.3 Calculation graph

- Typed, deterministic, bounded formula language.
- Static dependency extraction and cycle detection.
- Sparse multidimensional evaluation and incremental recomputation.
- Time intelligence, lag/lead, rolling average, YTD/QTD/MTD, seasonality, driver calculations and controlled statistical functions.
- Rules are versioned, tested, explainable and replayable.
- No arbitrary code or external network access inside formulas.

### 4.4 Writeback and locking

- Cell/slice/task locks by workflow state and scope.
- Optimistic concurrency and conflict handling.
- Bulk paste/import with dry run, validation and error cells.
- Undo/revert within draft; approved versions use adjustments/new versions.
- Data provenance survives spreads, allocations and recalculation.

## 5. Version, scenario and cycle model

Distinguish:

- actual;
- original budget;
- revised budget;
- working plan;
- rolling forecast;
- target;
- baseline;
- best/base/worst case;
- stress/regulatory scenarios;
- strategic long-range plan;
- sandbox/private scenario;
- published/approved plan.

Planning cycles define horizon, grain, model versions, contributors, ownership, submission calendar, exchange-rate set, source actual cutoff, top-down targets, instructions, validations, approvals, publish target and archive policy.

State machine:

```text
DRAFT → OPEN → CONTRIBUTING → SUBMITTED → REVIEWING
→ APPROVED → PUBLISHED → SUPERSEDED → ARCHIVED
```

Exceptions: `REOPENED`, `REJECTED`, `BLOCKED`, `STALE_ACTUALS`, `MODEL_MIGRATION_REQUIRED`.

## 6. Connected planning domains

### 6.1 Financial planning and budgeting

- Income statement, balance sheet and cash-flow integration.
- Revenue, COGS, operating expense, working capital, capex, depreciation, tax and financing assumptions.
- Driver-based, trend, zero-based, incremental and project/activity-based methods.
- Currency translation, rate scenarios and intercompany/elimination planning.
- Budget-control publication to Finance.

### 6.2 Workforce planning

- Position/headcount/FTE, vacancy, hire/termination/transfer, compensation, benefit/tax burden, contractor, overtime, skills and capacity.
- Pull authorized HCM structures and current workforce; never clone hidden employee master.
- Named-person planning only where law/policy/purpose permits; otherwise plan positions/jobs/pools.
- Reconcile approved plan to hiring requisitions/position budgets.

### 6.3 Sales and revenue planning

- Market/territory/account/product/channel, pipeline, conversion, bookings, price, volume, mix, churn, renewals and capacity.
- Top-down target, bottom-up territory proposal and allocation.
- CRM actual/pipeline integration with snapshot semantics.

### 6.4 Operational and supply planning

- Demand, supply, inventory, capacity, production, procurement, logistics, service and maintenance drivers.
- Operations Bible remains authoritative for executable plans/orders; Planning creates approved scenarios and targets.
- Constraint assumptions and infeasibility warnings are explicit.

### 6.5 Capital and project planning

- Initiative/project proposal, benefits, costs, cash flow, resource demand, dependencies, risk, NPV/IRR/payback where configured, stage gates and portfolio selection.
- Approved capital/project plan creates controlled budgets/projects/requisitions, not direct spend.

### 6.6 Cash, treasury and liquidity planning

- Receipts, disbursements, payroll, tax, debt, investment, transfer and FX scenarios.
- Use reconciled Finance/payment/bank actuals and explicit uncertainty.

### 6.7 Strategic, scenario and OKR planning

- Objective, outcome, measure, target, initiative, risk, assumption and dependency.
- Link strategic targets to financial/workforce/operational drivers and actual outcomes.
- Maintain decision rationale and changes by durable accountable seats.

### 6.8 Nonprofit/public/education planning

- Fund/grant/program, donor restriction, appropriation, enrollment, event/club budget and public-service outcome planning.
- Simon OSE proves club budget proposals, cross-club view, approval and historical reasoning without payment authority.

## 7. Allocation, spreading and top-down/bottom-up

Support even/proportional/driver/seasonal/historical/manual spreading; direct/step-down/reciprocal/activity-based allocations where supported; target distribution and contributor proposal reconciliation.

Every rule declares source, target, basis, exclusions, order, currency/unit, precision, zero/negative behavior, effective period, owner, approval and test. Allocation results drill to basis and original source.

## 8. Forecasting, simulation and AI

- Statistical/time-series/causal/ML forecasts behind a provider-neutral AWS-hosted model gateway.
- Train/evaluate only on authorized data within approved regions.
- Track training data window, features, model/version, metrics, uncertainty and drift.
- Compare against naive/baseline models; do not promote complexity without value.
- Forecasts are proposals with confidence intervals and drivers, never silently written over human plans.
- Scenario simulation records assumptions and reproducible seed/input where relevant.
- Human planners can accept, adjust or reject with reason; outcomes feed accuracy measurement.

Relay may create scenarios, explain variance, draft narratives, identify drivers, propose assumptions and run approved calculations. It cannot approve a plan, hide uncertainty or invent source data.

## 9. Planning workflow and collaboration

- Task ownership follows durable seats with delegated contributors.
- Top-down target and bottom-up submission retain both values and reconciliation decisions.
- Comments/annotations can attach to cell, slice, assumption, driver, model, task and decision.
- Save/resume, autosave truth, offline/recovery for permitted draft inputs, assignments, reminders, escalation and re-open rules.
- Submission validates completeness, changed actuals, formulas, currency/rates, allocations, outliers, comments/evidence and permissions.
- Approval binds exact version/digest. Published versions are immutable.

## 10. Planning UX

Required experiences:

- Planning home: cycles, tasks, deadlines, blockers, accuracy and decisions.
- Model studio: dimensions, measures, formulas, dependencies, tests and lineage.
- Spreadsheet-grade planning grid: keyboard navigation, paste/fill, formulas display, comments, drill, freeze, hierarchy expand, undo, validation and accessibility.
- Scenario lab: assumptions, controls, compare, sensitivity, simulation and outcome.
- Review workspace: top/down vs bottom/up, variance, outlier, narrative, comments and approval.
- Connected-plan map: financial/workforce/sales/operations/capital dependencies with list alternative.
- Management/board reporting: governed story, source/freshness, drill and export.
- Forecast/accuracy center: model results, confidence, driver explanation, overrides and realized accuracy.

Use Tenure Tenant Experience System. Avoid visual clutter, endless spreadsheet chrome and decorative dashboards. All numbers show unit, currency, scenario/version, period and freshness where ambiguous.

## 11. Security and governance

- Cell/slice/model/action authorization by tenant, legal entity, organization, dimension member, plan version, role/seat and time.
- Server-side enforcement in APIs, exports, caches, analytics and Relay.
- Sensitive workforce/customer/product plans may use separate access domains.
- Model/rule/version changes require review, regression and approval.
- Published-plan writeback uses typed commands and SoD.
- Audit includes data entry, imports, formulas, assumptions, allocations, submissions, approvals, publication and exports.

## 12. Data lineage and reconciliation

Every plan value explains:

```text
source actual/import/manual proposal
→ transformation
→ driver/formula
→ spread/allocation
→ aggregation
→ override/comment
→ approval/published version
→ execution handoff
→ realized actual
```

Reconcile source actual counts/totals and dimensions. Published budget/control totals must match Finance/Operations/HCM handoff or enter exceptions. Zero unexplained critical variance.

## 13. Decision memory

A `DecisionRecord` binds question, alternatives, assumptions, evidence, scenario results, selected option, dissent/risks, approvers, effective period, execution actions and later outcome. It attaches to durable seats and planning objects. Successors can see which assumptions failed and reuse or retire the model intelligently.

## 14. Performance and scale

- Sparse storage/compression and workload-appropriate compute.
- Incremental recalculation and dependency-aware cache invalidation.
- Isolation/fairness between tenants and heavy models.
- Large imports/allocations/forecasts are resumable jobs with progress and cancellation.
- Define budgets for grid edits, recalculation, scenario compare, aggregation, publish and report.
- Deterministic financial calculations and snapshot consistency under concurrent users.

## 15. Best-system scorecard

Measure:

- cycle duration and contributor time;
- time from actual refresh to reforecast;
- model build/change lead time with regression evidence;
- forecast accuracy by horizon/measure and improvement over baseline;
- unexplained variance and data reconciliation;
- percentage of values with complete lineage/assumption/owner;
- scenario turnaround and decision time;
- planning task success, grid error rate, accessibility and long-session comfort;
- published plan-to-execution consistency;
- model/calculation performance at target scale;
- successor comprehension time for major plans/decisions;
- support burden and cost per model/cell/job;
- benchmarked workflows against Workday Adaptive Planning, SAP Analytics Cloud Planning, Oracle EPM and Intuit Enterprise Suite using public/lawful evidence. Intuit scenarios must include cash-flow, budget and P&L forecasts, multi-entity/project profitability, AI KPI target assistance and fast mid-market adoption.

## 16. Required E2E scenarios

1. Annual budget from actuals → drivers → submissions → allocations → approval → Finance budget control.
2. Rolling forecast after actual close with changed assumptions and preserved prior forecast.
3. Workforce plan linked to HCM positions and Finance cost.
4. Sales plan linked to CRM pipeline and revenue/cash.
5. Demand/capacity scenario handed to Operations as approved target.
6. Capital project portfolio with resource/cash/risk constraints.
7. Multi-entity/multi-currency plan and consolidation.
8. AI forecast compared to baseline, human override and realized accuracy.
9. Mid-cycle hierarchy/model change with migration and approval invalidation.
10. Simon club budget proposals/approval/history from same engine.
11. Unauthorized slice/export/Relay denial.
12. Large-model failure, resume, restore and deterministic replay.

## 17. Evidence-gated checklist

### PLN-000 — Foundation

- [ ] PLN-000-001 — Inventory current budget/planning/report code and false EPM claims.
- [ ] PLN-000-002 — Implement canonical models, dimensions, measures, versions, scenarios, cells and lineage.
- [ ] PLN-000-003 — Implement typed calculation graph, cycles, sparse/incremental evaluation and deterministic replay.
- [ ] PLN-000-004 — Import every `PLN-*` item into the canonical ledger.
- [ ] PLN-GATE-000 — Multidimensional planning foundation is correct and tenant-safe.

### PLN-010 — Cycles, workflow and UX

- [ ] PLN-010-001 — Implement cycle/task/submission/review/approval/publish state machines.
- [ ] PLN-010-002 — Implement spreadsheet-grade accessible grid, model studio, scenario lab and review.
- [ ] PLN-010-003 — Implement locks, concurrency, bulk input, save/resume, comments and assignments.
- [ ] PLN-010-004 — Pass WCAG 2.2 AA, localization, themes, density and long-session tests.
- [ ] PLN-GATE-010 — Contributors and reviewers plan efficiently without spreadsheet chaos.

### PLN-020 — Connected plans

- [ ] PLN-020-001 — Implement financial planning and Finance publication/reconciliation.
- [ ] PLN-020-002 — Implement workforce planning with HCM authority/privacy.
- [ ] PLN-020-003 — Implement sales/revenue, operational/supply, capital/project and cash plans.
- [ ] PLN-020-004 — Implement strategic and nonprofit/public/education planning modes.
- [ ] PLN-020-005 — Prove cross-plan dependencies and no duplicated master systems.
- [ ] PLN-GATE-020 — Enterprise plans connect strategy, resources, operations and finance.

### PLN-030 — Rules, scenarios and forecasts

- [ ] PLN-030-001 — Implement spreading, allocations and top-down/bottom-up reconciliation.
- [ ] PLN-030-002 — Implement scenario compare, sensitivity and reproducible simulation.
- [ ] PLN-030-003 — Implement AWS-hosted forecast gateway, baselines, uncertainty, drift and human review.
- [ ] PLN-030-004 — Implement exact lineage and decision records through realized outcome.
- [ ] PLN-GATE-030 — Plans and predictions are transparent, reproducible and governable.

### PLN-040 — Security, scale and superiority

- [ ] PLN-040-001 — Enforce model/cell/slice/version/action authorization across every surface.
- [ ] PLN-040-002 — Pass all twelve E2E scenarios and zero unexplained critical handoff variance.
- [ ] PLN-040-003 — Pass large-model performance, concurrency, failure, backup/restore and DR tests.
- [ ] PLN-040-004 — Instrument scorecard baseline/targets/results and competitor workflow benchmarks.
- [ ] PLN-040-005 — Publish exact model/domain/forecast/country limitations.
- [ ] PLN-GATE-040 — “Best” is claimed only for measured released scope.

## 18. Definition of done

Planning is done only when governed actuals become traceable plans/scenarios/forecasts, contributors can work efficiently, approvals publish immutable targets, Finance/HCM/Operations handoffs reconcile, forecast/decision outcomes are measured, and security/performance/accessibility/recovery gates pass.

## 19. Prohibited shortcuts

Do not make spreadsheets canonical; sum non-additive measures; allow arbitrary formulas/code; hide source/assumptions/uncertainty; let AI approve plans; clone HCM/Finance/Operations master data; overwrite published versions; expose unauthorized cells in exports/caches/Relay; or claim best without accuracy/usability/performance evidence.

## 20. Required final Claude response

Report exact planning domains/models/scale, cycles and E2E handoffs, forecast/baseline metrics, lineage/reconciliation, usability/accessibility results, tests/failures/skips, deployments, limitations, blockers and rollback/restore proof.

## END CLAUDE CODE MASTER PROMPT

---

## Reference anchors

- SAP EPM scope: <https://www.sap.com/resources/what-is-enterprise-performance-management>
- SAP Analytics Cloud Planning: <https://www.sap.com/products/financial-management/analytics-cloud-planning.html>
- Workday Adaptive Planning: <https://www.workday.com/en-us/products/adaptive-planning/overview.html>
- Oracle Fusion Applications: <https://docs.oracle.com/en/cloud/saas/>
- Intuit Enterprise Suite planning/project-profitability scope: <https://quickbooks.intuit.com/r/news/intuit-enterprise-suite-helps-businesses-grow-streamline-operations-and-scale/>
