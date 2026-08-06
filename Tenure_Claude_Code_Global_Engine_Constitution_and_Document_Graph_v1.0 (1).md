# Tenure Global Engine Constitution and Mandatory Document Graph

**Version:** 1.0  
**Date:** 2026-08-04  
**Status:** Highest-level execution router for the Tenure architecture Bible suite  
**Purpose:** Prevent disconnected Bibles, shallow capability claims, skipped requirements and conflicting implementation authority  

---

## BEGIN CLAUDE CODE CONSTITUTION

You are working on Tenure as one global, memory-first, organization-first cloud ERP and tenant distribution platform. No document in this suite is optional merely because another document mentions its topic broadly. A later domain Bible controls the depth of its named domain. The unified master prompt controls dependency-ordered execution but cannot weaken domain requirements.

## 1. Binding product invariants

1. One complete Tenure Parent monorepo and global product line.
2. No tenant/customer source forks; Simon OSE is Tenant #1 and a proving configuration, not the parent schema.
3. All Tenure control-plane, product and tenant runtime infrastructure is operated in Tenure-owned AWS Organizations/accounts.
4. Customer on-premise/other-cloud systems may coexist through governed integrations; Tenure runtime is not deployed there.
5. System Studio is the authoritative normal Tenure operator interface; browsers never receive AWS credentials.
6. Tenant configuration is declarative, versioned, signed, explainable, inheritable, diffable, approvable and recoverable.
7. Tenant-facing product UX is distinct from the Global Deployer UX.
8. Durable positions/seats retain eligible organizational memory; people retain private identity/history and privacy rights.
9. HCM, Finance, Planning and Operations are mandatory first-party core Tenure systems, not shallow catalog entries.
10. Payments/Stripe, integrations, analytics/charts and industry packs are first-class governed planes.
11. Relay uses AWS-hosted approved models, tenant/user authority, citations and typed tools; it cannot self-approve.
12. A capability is available only for exact implemented, tested, deployed, certified and supported scope.
13. Protected production, money, payroll, legal, risk, destructive and go-live decisions remain human-authorized.
14. “Best,” “complete,” “global,” “real-time,” “certified,” “zero cost” and similar claims require exact evidence.

## 2. Mandatory canonical documents

Place canonical copies under `docs/architecture/`, `docs/experience/`, `docs/domains/` and `docs/implementation/` according to repository conventions. Before material implementation, read completely the latest non-superseded version of every applicable document below.

### Tier A — Constitution and execution

1. **This Constitution and Document Graph** — reading, authority, conflicts and completeness.
2. **Tenure Claude Code Unified Global Engine Master Prompt v3.0+** — dependency-ordered execution, ledger and evidence.

### Tier B — Global platform and implementation

3. **Tenure Global System Architecture Bible v1.1+** — platform invariants and global architecture.
4. **Tenure Global ERP Implementation Extension v1.0+** — landscapes, localization, payroll boundary, migration, banking, UAT, cutover, hypercare and retirement.
5. **Tenure System Studio AWS Authoritative Control Plane Bible v1.0+** — operator identity, AWS control plane, desired/actual state, lifecycle and operations.
6. **Tenure Declarative Tenant Configurator and Deployer UX Bible v1.0+** — configuration language, decision graph, state, branching/cascading UI, drafts, preview and approval.

### Tier C — Product line, integration and money

7. **Tenure ERP Archetype and Specialized System Pack Factory Bible v1.0+** — compositional ERP types, industry packs, modes, compatibility and certification.
8. **Tenure Global Integration Ecosystem and Connector Certification Bible v1.0+** — internal/external integrations, connectors, mappings, credentials, reconciliation and Integration Studio.
9. **Tenure Global Payments, Treasury, Cards and Stripe Control Plane Bible v1.0+** — merchant/legal entity, liability, Connect, collections, payouts, cards, treasury, reconciliation and lifecycle.

### Tier D — Mandatory first-party core systems

10. **Tenure People, HR and Workforce Cloud Bible v1.0+**.
11. **Tenure Financial Management Cloud Bible v1.0+**.
12. **Tenure Planning, EPM and Decision Cloud Bible v1.0+**.
13. **Tenure Operations, Supply, Manufacturing, Asset, Project and Service Cloud Bible v1.0+**.

### Tier E — Experience and intelligence

14. **Tenure Tenant Experience System and Product UI/UX Bible v1.0+** — tenant-facing tokens, components, interaction, navigation, Relay surfaces, accessibility and performance.
15. **Tenure Enterprise Analytics, Reporting and Visualization Cloud Bible v1.0+** — semantic metrics, reports, dashboards, advanced charts, drill-through and Intuit Enterprise Suite benchmark.

### Tier F — Tenant convergence and audit

16. **Tenure Simon OSE Tenant Absorption and Global Update Inheritance Bible v1.0+**.
17. **Tenure Behemoth Capability Completeness Audit v1.0+** — gap register only; later Bibles may close gaps but must not erase audit history.
18. Accepted ADRs, threat models, current-state inventories, execution ledger and evidence matrices.

## 3. Ownership and precedence

| Question | Owning authority |
|---|---|
| Product/tenancy/AWS invariants | Global Architecture Bible |
| Execution order/status/evidence | Unified Master Prompt + ledger |
| Operator-to-AWS mutation | System Studio AWS Control Plane Bible |
| Declarative fields/branching/state/save/resume | Configurator Bible |
| ERP type/pack/mode/compatibility | Pack Factory Bible |
| Connector/auth/mapping/webhook/reconciliation | Integration Bible |
| Money movement/Stripe/liability | Payments Bible |
| People/workforce semantics | People Cloud Bible |
| Accounting/financial semantics | Finance Cloud Bible |
| Plans/scenarios/forecasts | Planning Cloud Bible |
| Supply/manufacturing/project/service semantics | Operations Cloud Bible |
| Tenant UI tokens/components/interaction | Tenant Experience System Bible |
| Metrics/reports/charts/BI | Analytics Cloud Bible |
| Implementation/migration/cutover/service transition | ERP Implementation Extension |
| Simon-specific configuration/migration | Simon Absorption Bible |

When a broad document mentions a domain and the owning domain Bible defines it deeply, the domain Bible controls. When a domain Bible proposes behavior conflicting with a global security/isolation/authority invariant, the stricter global invariant controls and a versioned ADR resolves the domain behavior.

## 4. Conflict resolution order

1. Applicable law/contractual and human-authorized policy—not invented by Claude.
2. Tenant isolation, security, financial finality, privacy, safety, retention/legal hold and human approval invariants.
3. This Constitution's explicit product boundaries.
4. Owning domain Bible for semantic behavior.
5. Unified Master Prompt for implementation order and proof.
6. Accepted newer ADR with explicit supersession and migration.
7. Existing code behavior only when it is proven sound and does not violate higher authority.

Do not resolve conflicts by choosing the easier implementation, silently weakening a rule, or creating a tenant fork. Mark only the conflict `BLOCKED_ARCHITECTURE`, open an ADR, and continue independent work.

## 5. Requirement import protocol

The canonical execution ledger must import every stable requirement ID:

```text
GE-*   Global engine
EXT-*  ERP implementation extension
STUDIO-* System Studio AWS control plane
CFG-*  Declarative Configurator
PACK-* ERP/industry Pack Factory
INT-*  Integration Plane
PAY-*  Payments/Stripe
HCM-*  People Cloud
FIN-*  Finance Cloud
PLN-*  Planning Cloud
OPS-*  Operations Cloud
TTES-* Tenant Experience System
ANL-*  Analytics/Visualization Cloud
SIM-*  Simon absorption (use its actual prefix)
```

If an existing Bible lacks stable IDs, create a non-destructive indexed mapping; do not rewrite history or invent checked status. Requirements remain in owning documents and are referenced, not duplicated into divergent prose.

Every imported row records owner, dependencies, applicability, status, code/config, commit, tests, deployment/evidence, rollback and external input. Use only `PASS`, `FAIL`, `BLOCKED_EXTERNAL`, `BLOCKED_ARCHITECTURE` or `NOT_APPLICABLE` with reason. No final `PARTIAL`.

## 6. Completeness compiler

Create a machine-readable `architecture-document-graph.yaml` and `capability-completeness-registry.yaml`.

The document graph declares:

- document ID/version/digest/status/path;
- owner/domain;
- supersedes/superseded-by;
- mandatory dependencies;
- requirement prefixes;
- conflict/precedence rules;
- schema/code/test/evidence outputs;
- freshness/review owner.

CI must fail when:

- a mandatory document is absent/unreadable;
- duplicate requirement IDs exist;
- a referenced Bible/version cannot resolve;
- a capability says `AVAILABLE` without its owning domain gates;
- a master prompt omits a mandatory checklist prefix;
- Payments/Stripe, core clouds, tenant UX or analytics are removed from the execution graph;
- a document is superseded without migration and retained history;
- generated ledgers diverge from source documents.

## 7. Capability-depth gate

Every capability must satisfy, where applicable:

```text
boundary/personas
canonical objects/invariants
states/commands/events/idempotency
authorization/privacy/SoD
configuration/inheritance/localization
accounting/control/reconciliation
tenant and operator UX/accessibility
integrations/migration/coexistence
analytics/charts/reports/memory/Relay
observability/SLO/support/FinOps
upgrade/rollback/lifecycle
tests/deployment/certification/evidence
```

Names, logos, schemas, routes, tables, mocks, feature flags and provider SDKs do not satisfy the gate. Availability is contextual by tenant/environment/legal entity/population/jurisdiction/region/provider/mode/version.

## 8. Competitive benchmark constitution

Mandatory benchmark set:

- SAP S/4HANA/business suite families.
- Oracle Fusion Cloud Applications.
- Workday.
- Salesforce.
- Rippling.
- Intuit Enterprise Suite.
- NetSuite/Dynamics and relevant specialist leaders per domain.

Intuit Enterprise Suite must be benchmarked for multi-entity/multi-dimensional financial management, BI/reporting, payments/bill pay, project profitability, payroll/HR, marketing connection, cash/budget/P&L forecasting, construction/services tailoring, AI assistance, ease of learning and fast deployment. Tenure must not copy competitor trade dress or use vendor marketing as Tenure proof.

“Beat” means predeclared scenarios and metrics for correctness, capability, time, error, usability, accessibility, implementation, integration, memory continuity, security, performance, reliability and cost. Publish failures honestly.

## 9. UX constitution

- Tenant Experience System and Global Deployer remain distinct products.
- Tenant UI: human/role/work focused, calm, modern, fast; forest-green original identity; powerful progressive disclosure.
- Deployer UI: dense, explicit, developer/operator friendly; desired/planned/actual state, diffs, graphs, costs, approvals and evidence.
- Both meet WCAG 2.2 AA, localization, light/dark/high contrast, performance and security.
- One governed Analytics Cloud provides semantic reports and high-end charts across both with suitable token/density layers.

## 10. Release constitution

One platform release may bind code, infrastructure, database/schema, configuration schemas, graph/compiler, pack releases, connector releases, payments policies, core-cloud domain releases, TTES, analytics metrics/reports, Relay models/prompts/tools/evaluations, migrations, compatibility, tests, evidence and rollback.

Tenant wave evaluation determines applicability. Global releases reach Simon and all tenants through the same engine while preserving approved tenant overrides. No tenant stays indefinitely on an unsafe unsupported release.

## 11. Absolute definition of architectural completion

Architecture is not “complete” because these Bibles exist. The suite is structurally complete only when:

- every mandatory document is in the graph and consumed by the ledger;
- every capability is owned and truthfully classified;
- every cross-document dependency is tested by CI;
- no shallow module list is treated as an implemented system;
- Payments, integrations, core clouds, tenant UX, analytics/charts and Simon inheritance are binding;
- all enabled behavior has code, tests, deployment and rollback evidence;
- every unsupported scope is visible.

## 12. Required initial action

Before implementing features:

1. Locate and checksum every mandatory document.
2. Build the document graph and requirement registry.
3. Identify missing, superseded, conflicting and unimported requirements.
4. Reconcile current code/deployed AWS behavior against the graph.
5. Freeze false completion claims.
6. Execute by dependency order in Unified Master Prompt v3.0+.

## END CLAUDE CODE CONSTITUTION
