# Tenure Enterprise Analytics, Reporting, and Visualization Cloud Bible

**Version:** 1.0  
**Date:** 2026-08-04  
**Status:** Binding first-party analytics/BI/reporting/chart-platform architecture and Claude Code execution specification  
**Ambition:** Best governed, actionable and accessible analytics layer across the Tenure ecosystem  

---

## BEGIN CLAUDE CODE MASTER PROMPT

You are the principal analytics-platform architect, BI semantic-model architect, ERP reporting lead, data-visualization designer, financial-reporting engineer, accessibility specialist, data engineer, SRE, UX researcher, and hands-on implementation owner for **Tenure Analytics Cloud**.

Build one first-party analytics, reporting and visualization platform used by People, Finance, Planning, Operations, CRM/work, System Studio and Relay. Do not let each module create incompatible metrics, chart libraries or client-side calculations. Do not ship decorative dashboard cards. Every number and chart must be governed, sourced, fresh, permission-aware, drillable and actionable.

## 1. Constitutional relationship

Read the Tenure document graph, Tenant Experience System, Configurator/System Studio, core HCM/Finance/Planning/Operations Bibles, Integration Bible and institutional-memory architecture. Domain systems own canonical transactions. Analytics uses authorized projections/snapshots and never becomes an uncontrolled write system. Planning writeback and domain actions use typed commands.

## 2. Analytics architecture

```text
Canonical domain events/records
→ governed projection and quality checks
→ semantic entities/dimensions/measures/metrics
→ authorization-aware query layer
→ reports/dashboards/charts/alerts/narratives/APIs
→ drill-through to source and decisions
→ approved actions through domain commands
```

Support operational real-time/near-real-time views, transactional reports, analytical trends, regulatory/statutory outputs and historical snapshots with distinct freshness/consistency guarantees.

## 3. Canonical objects

- `SemanticModel`
- `SemanticEntity`
- `Dimension`
- `Hierarchy`
- `Measure`
- `MetricDefinition`
- `MetricVersion`
- `Dataset`
- `DatasetSnapshot`
- `QueryDefinition`
- `SavedView`
- `ReportDefinition`
- `ReportVersion`
- `DashboardDefinition`
- `VisualizationDefinition`
- `ChartAnnotation`
- `AlertDefinition`
- `Subscription`
- `DistributionRun`
- `ExportArtifact`
- `NarrativeDefinition`
- `DataQualityRule`
- `DataQualityResult`
- `LineageEdge`
- `FreshnessObservation`
- `AnalyticsEvidence`

Every metric defines business question, formula, grain, dimensions, units/currency, additive behavior, filters, exclusions, source, owner, version, effective dates, freshness, security, tests and limitations.

## 4. Semantic layer

- Shared canonical dimensions: tenant, legal entity, organization, cost center, durable seat, person/worker where permitted, customer, supplier, product/item, project, site, asset, account, fund/grant, scenario/version, currency and time.
- Domain-owned measures and metric certification.
- Conformed dimensions with source/effective-date lineage.
- Measures distinguish additive, semi-additive, non-additive, ratio, balance, flow, snapshot and distinct count.
- Currency/rate and time-zone/calendar behavior explicit.
- Slowly changing/effective-dated truth supports as-was and as-is reporting.
- Metric changes create new versions and impact analysis; dashboards do not silently change historical meaning.

## 5. Query and data isolation

- Server-side tenant/environment/action-resource-scope authorization before query planning and after result shaping where required.
- Row/column/cell/domain redaction in queries, caches, exports, alerts and Relay.
- Cache keys include complete tenant, environment, semantic model/version, actor policy, filters, locale and currency context.
- Aggregate results enforce minimum cohort/privacy rules where applicable.
- Cross-tenant platform analytics uses separately authorized de-identified/aggregated models; tenant users never query it.
- Query budgets, concurrency, timeouts, materializations and tenant fairness.
- No browser-supplied SQL or arbitrary warehouse credentials.

## 6. Reporting families

### 6.1 Transactional and operational

Current worklists, aging, status, exceptions, balances, inventory, orders, projects, workforce events, approvals, cases and integration runs with consistent source/freshness.

### 6.2 Financial and statutory

Trial balance, statements, subledger, reconciliations, cash, budget/fund/grant, consolidation and exact-scope regulatory reports. Financial reports preserve sign/currency/rounding/period/accounting-basis and drill to journal/source.

### 6.3 Management and performance

Profitability, cost, revenue, workforce, supply, project, service, risk, productivity and strategic outcomes with targets/scenarios/variance.

### 6.4 Analytical and exploratory

Authorized pivot, slice, drill, cohort, distribution, correlation and scenario views on governed datasets. Exploration does not permit unrestricted data exfiltration.

### 6.5 Board/executive narratives

Curated, versioned story packs with commentary, decisions, risks, source/freshness and signed export. Relay may draft narratives with citations; human owner approves.

## 7. High-end visualization grammar

Every visualization answers a named question. Use a shared `ChartFrame` containing title, question, metric definition, source, freshness, filters, comparison, unit/currency, uncertainty, annotations, legend, accessible data table, export and drill-through.

### 7.1 Comparison and ranking

- Bar/column, grouped bar, dot/lollipop and bullet charts.
- Sorted by meaningful order; zero baseline for magnitude bars unless a justified exception is visible.
- Top-N + Other for long tails; search and full-table alternative.

### 7.2 Time and change

- Line, step, area, stacked area, small multiples, calendar heatmap and event-overlay timeline.
- Handle missing values, partial periods, time zones, irregular intervals and forecast confidence.
- Show actual/plan/forecast with distinct non-color encodings.

### 7.3 Financial bridges and variance

- Waterfall/bridge, variance bars, contribution tree and driver decomposition.
- Preserve sign semantics and reconcile start + movements = end.
- Drill to contributing records/rules/decisions.

### 7.4 Distribution and relationship

- Histogram, box/violin where audience supports it, scatter/bubble, correlation matrix and cohort heatmap.
- Show sample size, outliers, scale and uncertainty; avoid causal claims from correlation.

### 7.5 Composition and hierarchy

- Stacked bar, treemap and sunburst only for appropriate hierarchy/composition.
- Pie/donut limited to a few categories and never primary for close comparisons.

### 7.6 Flow and lineage

- Sankey/alluvial for cash, budget allocation, approvals, material flow, information lineage, role handoff, integration traffic and tenant cost.
- Source→destination clarity, direct labels, search/highlight, Top-N + Other, small-flow aggregation, cycle handling, absolute/percentage modes and accessible list/table.

### 7.7 Process and funnel

- Funnel, stage conversion, process-mining map, control chart and SLA aging.
- Preserve cohort/time-window definition and re-entry behavior.

### 7.8 Schedule, capacity and dependency

- Gantt/timeline, capacity heatmap, resource histogram, critical-path/dependency graph and plan-vs-actual bands.
- Complex dependency diagrams require list/table alternative and progressive expansion.

### 7.9 Organization, network and geography

- Org tree/graph, relationship network, site/map, route and choropleth/symbol maps.
- Geospatial data has privacy/generalization rules; maps are not used when ranked bars answer better.

### 7.10 KPI and status

- Metric/scorecard, sparkline, bullet, progress and control-limit charts.
- No giant vanity numbers without target, period, comparison, definition and drill.
- Gauges are reserved for bounded values with meaningful thresholds.

## 8. Domain visualization minimums

### People

Headcount/FTE/vacancy trends; hire/transfer/exit flows; span/layer; recruiting funnel; onboarding readiness; skills gap; time/absence; compensation distribution/pay equity under protected access; succession coverage and transition continuity.

### Finance

P&L/balance/cash trends; actual-vs-budget/forecast; waterfall variance; AR/AP aging; cash position; close status; reconciliation; spend/category/supplier; revenue bridge; project/entity/product profitability; intercompany/elimination and funds/grants.

### Planning

Scenario compare, sensitivity/tornado, driver tree, plan/forecast/actual, forecast confidence/accuracy, allocation Sankey, contribution/variance, workforce/capacity and decision outcome.

### Operations

Demand/supply/inventory trend, shortage/late order, warehouse flow, schedule/Gantt, yield/scrap/OEE, lot genealogy, quality Pareto/control chart, maintenance uptime/MTBF/MTTR, project earned-value, logistics route/status and field-service SLA.

### System Studio

Tenant fleet, deployment state, AWS resource dependencies, drift, cost, incidents, approval/change flow and lifecycle. Deployer charts use its own denser UX tokens while sharing semantic chart contracts.

## 9. Interaction and exploration

- Cross-filtering with visible filter chips and reset.
- Drill down/up/across and source-record drill-through.
- Compare period, plan/scenario, entity/unit and cohort.
- Brush/zoom only when useful and resettable.
- Annotations/decisions/events attached to points/ranges.
- Save personal/shared views with permission and version.
- Subscribe/alert with threshold, anomaly or schedule.
- Export exact visible scope or governed report package.
- Turn an insight into a task, investigation, decision or approved domain action.

URL state includes safe identifiers/filters only; no sensitive values.

## 10. Advanced analytics and alerting

- Trend, anomaly, forecast, segmentation, scenario and root-cause assistance with model/version/quality/uncertainty.
- Alerts have metric/version, filter/population, threshold/model, evaluation frequency, suppression/deduplication, severity, recipients/seat, acknowledgement and resolution.
- Avoid alert fatigue through ownership, tuning, rate control and expiry.
- Relay can explain and draft investigation but cannot assert causality or execute protected correction without evidence/approval.

## 11. Dashboard and report authoring

- Certified templates and bounded self-service.
- Drag/drop or schema authoring over approved metrics/dimensions only.
- Layout grid, responsive breakpoints and accessibility checks.
- Parameter/filter dependencies and safe defaults.
- Publication workflow, owner, audience, freshness SLA and expiry.
- Report bursting/distribution respects per-recipient authorization at send time; never pre-generate one broad PDF and email it to narrower audiences.
- Scheduled exports are encrypted, expiring, audited and revoke-aware.

## 12. Accessibility and visual quality

- WCAG 2.2 AA; charts have semantic summaries and accessible data tables.
- Keyboard navigation for chart regions/data points where practical; list/table always available.
- Color palettes tested for contrast and common color-vision differences.
- Use pattern/shape/label in addition to color.
- Do not encode critical status only in saturation.
- Zoom/reflow and mobile alternatives.
- Reduced motion/transparency.
- Numeric formats, locale, RTL and translation.
- Avoid 3D, excessive gradients, chartjunk, unreadable labels and rainbow palettes.

## 13. Performance and freshness

- Define freshness class and consistency for every dataset/report.
- Incremental projections/materializations and cache invalidation from domain events.
- Asynchronous heavy queries/exports with progress, cancel and result expiry.
- Progressive chart render; primary labels/summary before dense marks.
- Virtualized tables and point aggregation/LOD for large charts.
- Query explain/cost/timeout and workload isolation.
- RUM/telemetry captures performance without raw sensitive query values.

## 14. Intuit Enterprise Suite benchmark

Treat Intuit Enterprise Suite as a mandatory competitor in addition to SAP, Oracle, Workday, Salesforce, Rippling, NetSuite and specialist systems. Current official Intuit scope to benchmark includes:

| Intuit strength | Tenure must meet and exceed through evidence |
|---|---|
| Multi-entity, multi-dimensional financial management | Global legal entity/ledger/book/dimension depth plus faster drill and implementation |
| Business intelligence and reporting | Governed semantic metrics, high-end visual grammar, real-time operational/financial connection |
| Payments and bill pay | Provider-neutral Payments Bible, Stripe Connect, ledger/settlement/reconciliation and exact liability |
| Project profitability | Project/people/time/procurement/finance actuals, forecasts, industry metrics and decision memory |
| Payroll and HR | Global exact-scope HCM/payroll modes, privacy and role-memory continuity |
| Cash-flow, budgeting and P&L forecasting | Connected Planning Cloud with assumptions, scenarios, uncertainty and outcome accuracy |
| Intercompany/consolidated or entity statements | Tenure Finance multi-entity controls, eliminations, consolidation and lineage |
| Construction and services tailoring | Certified industry packs with operations/project/job-cost depth |
| Marketing connection | CRM/marketing capability and certified integrations with consent and attribution |
| AI insights/agents | Bedrock-hosted, cited, permission-aware Relay with typed tools and human governance |
| Fast adoption/easy learning | Configurator, migration factory and TTES task success/time-to-proficiency metrics |

Do not copy Intuit UI or repeat vendor performance claims as Tenure claims. Establish Tenure's own baselines and comparable scenario tests.

## 15. Best-system scorecard

Measure:

- metric consistency and certified-definition coverage;
- freshness/SLA and projection lag;
- query/report/chart response at target scale;
- dashboard/report task success, time and comprehension;
- time to answer business question and reach source evidence;
- chart accessibility completion and table equivalence;
- unexplained mismatch between chart/report/source;
- self-service authoring success without metric duplication;
- alert precision/actionability and fatigue;
- executive narrative evidence/correction rate;
- export/distribution authorization incidents;
- adoption and recurring usage tied to decisions/actions, not views alone;
- competitor scenario benchmarks including Intuit Enterprise Suite.

## 16. Required E2E scenarios

1. Finance statement → variance waterfall → journal/source/approval drill.
2. Multi-entity/project profitability dashboard comparable to Intuit scope, with actual/forecast and full lineage.
3. People headcount/flow/skills dashboard with protected field denial.
4. Planning scenario/sensitivity/forecast confidence and outcome.
5. Operations order/inventory/production/quality/maintenance dashboards with exceptions.
6. Cross-domain executive scorecard → decision → action → realized outcome.
7. Simon cross-club budget/approval/history analytics.
8. Saved view/subscription with permission revoked before delivery.
9. Metric version change and affected dashboard migration.
10. Large dataset/long-tail/Sankey performance and accessibility alternative.
11. Relay-cited narrative with human edits and signed export.
12. Tenant offboarding/purge of analytics projections, subscriptions, exports and cost.

## 17. Evidence-gated checklist

### ANL-000 — Foundation and truth

- [ ] ANL-000-001 — Inventory every dashboard/report/chart/client-side metric and classify source/owner/truth.
- [ ] ANL-000-002 — Remove duplicate/untraceable calculations and false real-time labels.
- [ ] ANL-000-003 — Implement canonical semantic/metric/report/visualization objects and versions.
- [ ] ANL-000-004 — Import every `ANL-*` item into the canonical ledger.
- [ ] ANL-GATE-000 — Metrics and reports have one governed definition and source.

### ANL-010 — Data, semantics and security

- [ ] ANL-010-001 — Implement conformed dimensions, effective dating, measures and metric certification.
- [ ] ANL-010-002 — Implement projections/snapshots, quality, freshness, lineage and reconciliation.
- [ ] ANL-010-003 — Enforce tenant/row/column/cell/domain authorization in query/cache/export/alert/Relay.
- [ ] ANL-010-004 — Implement query budgets, workload isolation and safe self-service.
- [ ] ANL-GATE-010 — Analytics is accurate, isolated and scalable.

### ANL-020 — Visualization platform

- [ ] ANL-020-001 — Implement shared ChartFrame and chart grammar from Section 7.
- [ ] ANL-020-002 — Implement domain minimum visualizations and source drill-through.
- [ ] ANL-020-003 — Implement cross-filter, compare, annotations, saved views, alerts and action handoff.
- [ ] ANL-020-004 — Provide accessible tables/summaries, keyboard, color-vision, zoom and responsive alternatives.
- [ ] ANL-020-005 — Pass visual-regression, correctness and large-data performance tests.
- [ ] ANL-GATE-020 — Charts are high-end, truthful, accessible and actionable.

### ANL-030 — Reports, dashboards and narratives

- [ ] ANL-030-001 — Implement governed report/dashboard authoring and publication.
- [ ] ANL-030-002 — Implement transactional, financial, management, analytical and executive report families.
- [ ] ANL-030-003 — Implement secure subscriptions/bursting/exports with recipient-time authorization.
- [ ] ANL-030-004 — Implement Relay narratives with citations, human review and signed version.
- [ ] ANL-GATE-030 — Reporting works from operational detail to executive/board outcomes.

### ANL-040 — Benchmark and superiority

- [ ] ANL-040-001 — Maintain benchmark scenarios for SAP/Oracle/Workday/Salesforce/Rippling/NetSuite/Intuit Enterprise Suite.
- [ ] ANL-040-002 — Implement and evidence the Intuit comparison in Section 14.
- [ ] ANL-040-003 — Pass all twelve E2E scenarios with zero unexplained source/report variance.
- [ ] ANL-040-004 — Instrument best-system scorecard baselines/targets/results.
- [ ] ANL-040-005 — Publish exact metric/report/analytics limitations and blocked sources.
- [ ] ANL-GATE-040 — “Best analytics” is claimed only for measured released scope.

## 18. Definition of done

Analytics Cloud is done only when one semantic/metric platform powers all domains; high-end charts and reports are sourced, fresh, secure, accessible and drillable; Intuit and other benchmark scenarios are tested; alerts/narratives/actions are governed; and source-to-report reconciliation, performance, accessibility and tenant lifecycle gates pass.

## 19. Prohibited shortcuts

Do not calculate canonical metrics independently in clients; use fake/placeholder dashboard data; call stale data real time; expose hidden rows through aggregates/exports/caches; use decorative 3D/rainbow charts; hide units/filters/source/freshness; claim causality from correlation; distribute broad PDFs to narrow audiences; let Relay invent metrics; copy Intuit or another vendor UI; or claim best from visual polish alone.

## 20. Required final Claude response

Report semantic/metric versions, domain dashboards/reports/charts, source/freshness/reconciliation, query/performance, accessibility, security/export tests, Intuit and other benchmark scenario outcomes, deployments, limitations, blockers and rollback/rebuild proof.

## END CLAUDE CODE MASTER PROMPT

---

## Reference anchors

- Intuit Enterprise Suite 2026 scope: <https://investors.intuit.com/news-events/press-releases/detail/1311/intuit-unlocks-new-phase-of-growth-for-mid-market-businesses-combining-data-and-ai-to-drive-faster-more-profitable-decisions>
- Intuit Enterprise Suite product breakdown: <https://erp.intuit.com/blog/product-update/what-is-intuit-enterprise-suite/>
- Intuit multi-entity accounting: <https://erp.intuit.com/blog/accounting/multi-entity-accounting/>
- SAP Analytics Cloud Planning: <https://www.sap.com/products/financial-management/analytics-cloud-planning.html>
- Vercel Geist gauge accessibility example: <https://vercel.com/geist/gauge>

