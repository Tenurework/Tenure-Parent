# Tenure Global ERP Implementation, Localization, Migration, Banking, Cutover, and Service Transition Extension

Version: 1.0  
Date: 2026-08-02  
Status: Binding extension to the Tenure Global System Architecture Bible v1.1  
Applies to: Tenure Parent, every implementation program, every regional cell, every tenant, every industry and jurisdiction pack, and every production go-live  
Product thesis: The person changes. The seat remembers. The implementation must preserve the reason, evidence, and ownership behind every change.

## 0. Document contract and required reading order

This document closes the implementation-depth gaps deliberately identified after the first Architecture Bible audit. It does not replace the Bible. It extends the Bible from a platform and distribution architecture into a complete customer-transformation architecture covering implementation landscapes, localization, payroll boundaries, enterprise migration, high-volume integration, ISO 20022 banking, business acceptance, cutover, hypercare, service transition, and legacy retirement.

Claude Code and every human contributor must read authoritative material in this order before changing the relevant scope:

1. Repository `CLAUDE.md`, `AGENTS.md`, security policy, contribution rules, and protected-workflow instructions.
2. `docs/architecture/tenure-global-system-architecture-bible.md` or the repository's canonical copy of the Tenure Global System Architecture Bible v1.1 or later.
3. This extension.
4. Accepted architecture decision records, tenant contracts, data-processing terms, jurisdiction opinions, bank implementation guides, certified-provider contracts, and implementation statements of work.
5. The unified Claude Code execution prompt and current execution ledger.

Precedence is explicit:

- Law, binding regulation, court order, legal hold, signed contract, and approved data-processing obligation take precedence within their applicable scope.
- The Architecture Bible controls product thesis, AWS ownership, tenant isolation, identity, authorization, durable seats, institutional memory, Relay, global cells, lifecycle, security, and the Tenure Experience System.
- This extension controls customer implementation mechanics and the additional domain contracts defined here.
- A tenant configuration or project decision may narrow capability but may not weaken a platform invariant.
- A vendor-specific artifact is an adapter input, not the canonical Tenure model and not a reason to fork Tenure.
- If documents conflict, stop the conflicting implementation, record an ADR/change request, identify the exact clauses, owners, and risk, and obtain authorized resolution. Claude must not silently choose the least restrictive interpretation.

This document uses **MUST**, **MUST NOT**, **SHOULD**, and **MAY** normatively. A checklist item is not complete because a design, interface, schema, mock, or TODO exists. It is complete only when the enabled scope is implemented, integrated, tested, deployed to the authorized environment, evidenced, and operationally owned.

## 1. Binding implementation decisions

| Decision | Binding Tenure choice |
|---|---|
| Delivery model | One reusable implementation system operated by Tenure; no customer source fork and no unmanaged consulting sidecar |
| Cloud boundary | Tenure product, migration runtime, transformation runtime, implementation workbench, evidence stores, and tenant runtime use Tenure-controlled AWS accounts only |
| External systems | SAP, Oracle, Workday, Microsoft, Google, banks, payment providers, payroll providers, government portals, and other systems connect through governed adapters |
| Tenant AWS ownership | No personal AWS accounts and no unrelated customer AWS accounts are Tenure deployment targets |
| Implementation truth | Scope, decisions, mappings, defects, approvals, readiness, cutover, and hypercare are versioned first-class records, not disconnected spreadsheets and chat messages |
| Configuration | Approved customer configuration is a signed, effective-dated, diffable, promotable, reversible product input |
| Environments | Every landscape has an explicit purpose, owner, data class, refresh rule, change authority, cost limit, entry/exit criteria, and destruction policy |
| Production data outside production | Denied by default; use synthetic, masked, tokenized, or purpose-minimized fixtures under a documented exception when production-derived data is essential |
| Staffing model | Tenure supports position-controlled, job-managed/pooled, and mixed staffing through explicit effective-dated policy; it never conflates a person with a durable seat |
| Finance | A Tenure-native universal accounting event and journal contract supports multiple books, ledgers, accounting bases, currencies, valuation views, and subledgers without cloning SAP ACDOCA or another vendor schema |
| Payroll | Native payroll is unavailable in a jurisdiction until certified against effective-dated rules and reconciliation suites; otherwise Tenure integrates with an approved payroll provider |
| Localization | Jurisdiction content is signed, versioned, effective-dated, attributable to an authoritative source, regression-tested, and never represented as legal advice or permanent truth |
| Migration | Every migration is repeatable, restartable, tenant-scoped, lineage-preserving, reconciled, rehearsal-tested, signed off, and capable of rollback or forward recovery |
| Banking | Bank connectivity and ISO 20022 support are versioned by scheme, bank, country, message, usage guideline, and effective date; message-family names alone do not prove certification |
| Payment authority | Tenure governs requests, approvals, payment files/instructions, acknowledgements, reconciliation, and evidence; certified banks/providers move money |
| Cutover | Go-live is a protected business operation with command structure, freeze, delta conversion, reconciliations, go/no-go authority, rollback boundaries, communications, and minute-level evidence |
| Hypercare | Every go-live has a defined stabilization period, severity model, coverage schedule, telemetry, knowledge transfer, exit criteria, and handoff owner |
| Legacy retirement | A source system is not retired until retention, legal hold, export, access revocation, contract termination, dependency removal, data destruction, and evidence gates pass |
| AI | Relay may analyze, map, draft, compare, explain, and propose; it cannot certify law, approve its own change, bypass SoD, release payroll, release payments, sign off reconciliation, or make go-live decisions |
| User experience | Implementation, migration, cutover, and operations surfaces use the same fatigue-minimizing Tenure Experience System as the tenant product |

## 2. Extension boundaries and non-goals

### 2.1 What this extension adds

This extension adds a reusable **Tenure Implementation Control Plane** and related tenant-scoped runtimes for:

- Discovery, scope, program governance, decisions, dependencies, risks, deliverables, approvals, and evidence.
- Landscape and environment lifecycle from discovery through production and support.
- Canonical enterprise foundation choices, including staffing and accounting models.
- Jurisdiction, tax, payroll, privacy, security, banking, accessibility, and records localization packs.
- Source discovery, extraction, profiling, cleansing, mapping, transformation, load, delta, reconciliation, and sign-off.
- High-volume file, API, event, stream, and batch integrations.
- Bank message and payment-status orchestration, including ISO 20022 message families.
- Business-process testing, UAT, operational readiness, cutover, go-live, hypercare, and support transition.
- Legacy application, integration, data store, file share, cloud resource, license, and hardware retirement.
- Implementation memory attached to tenant, program, workstream, process, object, mapping, integration, jurisdiction pack, and accountable seat.

### 2.2 What this extension does not authorize

It does not authorize:

- Production mutation, production data extraction, customer notification, payment release, payroll release, credential rotation, destructive decommissioning, or irreversible migration without protected human authority.
- Direct use of customer credentials, credentials pasted into prompts, shared personal accounts, uncontrolled local data copies, or secret-bearing evidence.
- A compliance or certification claim merely because a control, rule, form, connector, or test exists.
- A claim that Tenure replaces bank cores, tax engines, certified payroll processors, statutory filing authorities, specialized manufacturing kernels, or regulated systems of record before the applicable module is certified.
- A vendor-specific model as the Tenure canonical data model.
- Weekly or routine production-data copies into development, test, training, demo, or AI-evaluation environments.
- A single worldwide payroll formula, banking schema, chart of accounts, legal entity model, retention period, address format, calendar, or privacy rule.

## 3. Tenure Implementation Control Plane

### 3.1 Purpose

The Implementation Control Plane turns each customer deployment from a collection of project artifacts into an auditable, repeatable state machine. It is logically separated from the tenant runtime but linked through immutable tenant, program, release, configuration, and evidence identifiers. A project manager, data lead, integration lead, business process owner, security reviewer, payroll specialist, bank specialist, cutover manager, support lead, and Tenure operator each act through scoped durable seats.

It owns metadata and approved artifacts, not unrestricted copies of tenant production content. Project teams see the least information required for their role and phase.

### 3.2 Canonical implementation objects

At minimum, implement these tenant-scoped, effective-dated objects:

| Object | Required semantics |
|---|---|
| `ImplementationProgram` | Tenant, contractual scope, deployment class, regions, target dates, sponsors, accountable seats, status, health, confidentiality, and evidence policy |
| `Workstream` | Domain, owner seat, dependencies, milestones, entry/exit criteria, delivery status, risks, and linked requirements |
| `Requirement` | Stable ID, source, rationale, scope, priority, acceptance criteria, owner, version, status, dependencies, evidence, and traceability |
| `Decision` | Question, options, evidence, affected tenants/modules, decision authority, rationale, effective date, reversibility, expiry/review, and supersession |
| `Assumption` | Statement, owner, validation date, impact, confidence, outcome, and dependent work |
| `Dependency` | Provider/system/team, due date, blocking relationship, escalation, fallback, and evidence |
| `RiskIssueActionDecision` | Separate R/I/A/D types, severity, probability/impact, owner, due date, mitigation, residual risk, escalation, closure evidence |
| `Deliverable` | Type, scope, owner, reviewers, version, approval status, environment applicability, and immutable artifact reference |
| `ProcessDefinition` | Current process, target process, variants, controls, actors by seat, inputs/outputs, metrics, exceptions, and approval |
| `ConfigurationWorkbook` | Structured configuration values, source, validation, diff, comments, owners, approvals, and promotion state; never a free-form spreadsheet as the canonical runtime input |
| `ObjectMapping` | Source object/field/value to canonical object/field/value with transform, defaults, ownership, quality rules, and lineage |
| `TestScenario` | Requirement links, personas/seats, data fixture, preconditions, steps, expected outcomes, controls, evidence, result, and defect links |
| `ReadinessItem` | Gate, criterion, owner, evidence, exception, expiry, status, and approval |
| `CutoverTask` | Minute/time window, dependency, runbook, executor seat, approver, expected duration, verification, rollback boundary, and status |
| `HypercareCase` | Severity, affected scope, detection, workaround, owner, SLA, root cause, permanent fix, knowledge article, and exit impact |
| `DecommissionRecord` | Legacy asset, owner, dependencies, retention/hold, export, destruction method, approvals, cost/license impact, and certificate |

Every object has `tenant_id`, immutable ID, created/updated actor, created/updated time, version, classification, retention class, audit pointer, and—where relevant—effective start/end. Optimistic concurrency and idempotency protect every state transition.

### 3.3 Program state machine

The minimum program lifecycle is:

`DISCOVERY → BASELINED → DESIGNED → CONFIGURING → BUILDING → CONVERTING → TESTING → READY_FOR_CUTOVER → CUTTING_OVER → LIVE_HYPERCARE → STABILIZED → TRANSITIONED → CLOSED`

Control states include `ON_HOLD`, `BLOCKED_EXTERNAL`, `REPLAN_REQUIRED`, `ROLLBACK_ACTIVE`, `LEGAL_HOLD`, and `TERMINATED`. Each transition declares required roles, inputs, gates, notifications, side effects, and reversibility. A target date never moves the program forward when evidence gates fail.

### 3.4 Governance and traceability

- Requirements trace to process design, configuration, code, migration mapping, integration, control, test, training, cutover, and support artifacts.
- Business decisions attach to accountable seats so the rationale survives personnel changes.
- Scope change records baseline impact on timeline, cost, data, integrations, security, controls, training, cutover, and support.
- Status is calculated from evidence and child state where possible; executives may not manually paint a failed program green.
- Approvals snapshot the exact artifact digest and version reviewed.
- Comments never substitute for a formal decision, approval, exception, or risk acceptance.
- Every exception has owner, reason, compensating control, expiry, review date, and affected requirement IDs.
- Cross-tenant implementation analytics use minimized metrics, never tenant content or another customer's confidential mapping.

## 4. Environment and implementation landscape

### 4.1 Environment classes

Tenure supports a governed catalog rather than assuming only development, staging, and production:

| Environment class | Primary purpose | Permitted data | Promotion authority | End state |
|---|---|---|---|---|
| `LOCAL_DEV` | Individual engineering and unit tests | Generated/synthetic only | Developer | Ephemeral |
| `EPHEMERAL_PREVIEW` | PR/UI/contract preview | Generated/synthetic only | CI policy | Auto-destroy |
| `SHARED_INTEGRATION` | Cross-service integration | Synthetic tenant fixtures | Engineering release | Persistent with reset |
| `SECURITY_TEST` | DAST, attack simulation, isolation tests | Synthetic/adversarial | Security owner | Ephemeral or isolated |
| `PERFORMANCE_TEST` | Capacity, soak, volume, failure testing | Generated volume fixtures | Performance owner | Scheduled/hibernated |
| `PROTOTYPE` | Validate uncertain design with customer | Synthetic or approved minimized sample | Program/design owner | Destroy or promote design only |
| `CONFIGURATION_SOURCE` | Author and validate tenant configuration | Configuration metadata; no production transaction copy | Configuration owner | Versioned baseline |
| `MIGRATION_DEVELOPMENT` | Build mappings/transforms | Masked/minimized extracts where approved | Data lead | Refresh-controlled |
| `CONVERSION_REHEARSAL` | Full mock conversions and reconciliation | Approved protected rehearsal dataset | Data/cutover leads | Destroy by policy |
| `SYSTEM_TEST` | Functional E2E and negative testing | Synthetic/rehearsal fixtures | QA lead | Reset between cycles |
| `UAT` | Business acceptance | Approved representative, masked, or synthetic data | Business process owners | Frozen evidence baseline |
| `TRAINING` | Role-based learning | Synthetic named personas and safe scenarios | Training lead | Refresh from safe template |
| `GOLD_PREPRODUCTION` | Exact final configuration and release candidate | Production-like structure; minimized data | Release/cutover board | Promote artifacts, not database copies |
| `PRODUCTION` | Live tenant operation | Approved production data | Protected production authority | Active/hibernate/offboard |
| `HYPERCARE_SUPPORT` | Elevated support coordination, not a data clone | Metadata and purpose-bound support access | Incident/support policy | Close after stabilization |
| `DR_RESTORE_DRILL` | Isolated restore and continuity proof | Encrypted restored data under drill controls | DR owner | Mandatory destruction |

An environment may combine classes only when purpose, data, access, release, evidence, and destruction policies remain at least as strict as the strictest class. Simon Tenant 1 may use fewer physical environments during pilot, but the logical contracts and promotion gates remain intact.

### 4.2 Environment manifest

Every environment manifest includes:

- Immutable environment ID, tenant/program scope, class, AWS partition/account/region/cell, owner seat, creation reason, and expiry.
- Release digest, IaC version, database/config schema versions, industry/localization pack versions, connector versions, Relay model/prompt/tool/evaluation versions, and fixture version.
- Allowed data classifications and explicit prohibited data.
- Identity issuer, access groups/policies, step-up requirements, support policy, and break-glass path.
- Network/egress allowlist, secrets namespace, KMS keys, domains, integrations, and outbound-notification suppression policy.
- Inbound/outbound integration endpoints and whether they are simulated, certified-test, or live.
- Cost budget, anomaly threshold, schedule/scale-to-zero policy, retention, backup, refresh, snapshot, and destruction rules.
- Entry criteria, exit criteria, health checks, evidence requirements, and responsible approvers.

### 4.3 Data refresh and production-derived data

Production-to-nonproduction movement is a controlled exception workflow:

1. Prove why synthetic data, contract fixtures, or generated volume data cannot meet the test objective.
2. Identify the minimum fields, rows, time range, and relationships needed.
3. Apply tenant-scoped extraction, field suppression, irreversible tokenization or masking, date/amount perturbation where safe, document replacement, and referentially consistent pseudonyms.
4. Scan for direct identifiers, secrets, credentials, free-text leakage, attachments, biometric/medical/payroll/bank data, and re-identification risk.
5. Obtain privacy, security, data-owner, and environment-owner approval.
6. Record dataset lineage, transformation digest, expiry, authorized users, and purpose.
7. Load through the migration boundary; never copy production databases or snapshots into a general sandbox.
8. Continuously restrict export, Relay access, connectors, notifications, and external model/tool paths.
9. Destroy by deadline and retain only non-sensitive evidence of destruction.

### 4.4 Landscape promotion

Code is built once, signed, scanned, and promoted by immutable digest. Configuration, localization content, mappings, test packs, and integration packages are independently versioned but bound into a signed environment release manifest. Promotion validates compatibility and never rebuilds a materially different artifact.

The system must support:

- `design → configuration source → system test → UAT → gold → production` promotion for configuration.
- `discovery → mapping → mock conversions → final rehearsal → delta-ready package → production conversion` for migration.
- `draft → source-reviewed → test → certified/approved → effective → superseded/withdrawn` for localization content.
- `development → contract test → provider sandbox → tenant acceptance → production enablement` for integrations.
- Environment comparison showing code, schema, configuration, data contract, pack, connector, and Relay differences in one view.
- Clone-from-template for safe environment metadata and fixtures, never an uncontrolled production clone.
- Automatic expiry, hibernation, teardown, orphan scanning, and residual-cost verification for temporary landscapes.

## 5. Canonical enterprise foundation extensions

### 5.1 Position control, job management, and pooled staffing

Tenure's durable seat remains canonical. The staffing policy determines how seats are materialized:

- `POSITION_CONTROLLED`: each budgeted position/seat has a distinct ID, capacity, attributes, funding, authority, and vacancy lifecycle. Multiple concurrent occupants require explicit capacity greater than one or separate positions.
- `JOB_MANAGED_POOLED`: an approved job pool defines reusable attributes and headcount/FTE capacity; assignments consume capacity and may materialize lightweight seat instances for continuity and authorization.
- `MIXED`: organizational units or worker populations choose either model under effective-dated policy.
- `NON_WORKFORCE_SEAT`: student officers, volunteers, committee chairs, approvers, service owners, asset custodians, and other durable organizational responsibilities exist without an employment job.

Required controls:

- Position, job profile, headcount authorization, FTE, worker assignment, employment relationship, compensation, cost allocation, and authority are separate objects.
- A title change does not create a new person or silently rewrite historical authority.
- Headcount and compensation budgets reconcile to occupied/vacant/overfilled capacity.
- Matrix, acting, interim, shadow, delegate, secondment, leave, contractor, seasonal, contingent, and shared-service arrangements are effective-dated.
- Moving a position between organizations preserves history and evaluates policy/financial impact.
- Changing staffing mode requires a simulated migration, mapping of continuity, reconciliation, approval, and rollback plan.

### 5.2 Universal accounting event and journal model

Tenure must support a universal accounting architecture without copying a proprietary vendor table. The canonical flow is:

`Business event → accounting event → rule evaluation → subledger entry → validated journal → ledger/book posting → consolidation/reporting projection`

Required concepts:

- `AccountingEvent`: immutable source type, source object/version, event time, accounting date, legal entity, economic substance, reversal/correction relationship, and idempotency key.
- `AccountingRuleSet`: effective-dated rule version, applicability, accounting basis, book, ledger, source, condition, account derivation, dimension derivation, valuation, rounding, and exception path.
- `JournalHeader`: tenant, legal entity, ledger, book, period, source, category, status, currencies, dates, description, policy version, approval, and posting batch.
- `JournalLine`: debit/credit indicator, entered/functional/reporting amounts and currencies, accounts, dimensions, counterparty, tax reference, intercompany reference, source lineage, settlement reference, and explanation.
- `Ledger`: primary, secondary, statutory, management, consolidation, tax, or other approved purpose; calendar, currency, chart, accounting basis, and posting policy.
- `Book`: valuation/depreciation/reporting policy where multiple views of the same economic event are required.
- `Subledger`: payables, receivables, cash, expenses, payroll, assets, inventory, projects, grants, revenue, leases, tax, and future certified modules.
- `PostingBatch`: atomic group, validation result, approvals, hash/digest, sequence, posting time, and rollback/correction reference.

### 5.3 Journal invariants

- Every posted journal balances under configured ledger and currency rules.
- Posted records are immutable; errors use reversal, correction, or adjusting entries.
- Source-to-journal and journal-to-source drill-through is complete and permission-aware.
- A single economic event cannot post twice under retries.
- Period state, accounting date, legal entity, ledger, book, policy version, exchange rate, and dimension validity are checked server-side at posting.
- Parallel ledgers/books may produce different entries from the same event, but each is attributable to a rule version.
- Intercompany entries identify both parties, balance by configured rules, and reconcile before elimination.
- Consolidation and elimination are separate governed processes; neither silently mutates entity books.
- Reporting projections are rebuildable from canonical postings and never become the source of truth.
- Migration balances reconcile by entity, ledger, book, period, currency, account, dimension, and source system.
- Relay may explain journal derivation and variance using cited rules and source evidence; it may not post or approve high-risk entries without the standard protected command path.

## 6. Global localization and statutory-content engine

### 6.1 Localization pack contract

Global capability is produced through a versioned localization engine, not country conditionals scattered through code. A pack may target country, state/province, municipality, economic zone, industry regulator, legal-entity type, worker population, bank scheme, language, or contractual regime.

Each pack contains:

- Stable pack ID, jurisdiction/scheme, applicability predicates, publisher/owner seat, status, semantic version, and effective interval.
- Authoritative source URL/document identifier, source publication/effective dates, retrieval date, checksum, reviewer, interpretation note, and legal/accounting/payroll specialist approval where required.
- Dependencies and incompatibilities with other packs.
- Terminology, languages, formats, calendars, holidays, currencies, address/person-name rules, tax identifiers, forms, schemas, code lists, calculations, thresholds, workflow steps, controls, reports, retention, privacy, security, and evidence requirements.
- Golden cases, boundary cases, prior-period cases, retroactivity cases, negative tests, expected filings/messages, rounding, reconciliation, and acceptance thresholds.
- Upgrade, transition, grandfathering, correction, supersession, emergency patch, rollback, and tenant-notification rules.
- Capability status: `RESEARCH`, `DRAFT`, `REVIEWED`, `TESTED`, `CERTIFIED_INTERNAL`, `CERTIFIED_EXTERNAL`, `AVAILABLE`, `DEPRECATED`, `WITHDRAWN`.

A module may display a jurisdiction pack as **available** only when the required certification state, integration/provider readiness, regression evidence, support ownership, and effective date are satisfied for that tenant.

### 6.2 Regulatory change operation

The regulatory-content lifecycle must:

1. Monitor authoritative sources and contracted content providers.
2. Create a source snapshot and candidate change; never auto-activate scraped text.
3. Determine affected jurisdictions, tenant populations, legal entities, workers, forms, integrations, reports, calculations, controls, and historical periods.
4. Obtain specialist interpretation and map the change to versioned executable content.
5. Generate or update tests for threshold boundaries, dates, rounding, retroactivity, exemptions, and prior versions.
6. Simulate affected tenant outcomes and produce explainable diffs.
7. Approve and promote under separation of duties.
8. Notify affected tenants with impact, action, effective date, and support path.
9. Activate by legal effective time and preserve the exact prior rules used for historical reconstruction.
10. Monitor results, filings/provider acknowledgements, exceptions, and emergency corrections.

### 6.3 Named New York example pack

The New York pack is a proving configuration, not the global model. It must be versioned and applicability-driven. Its catalog must be able to represent, at minimum:

- New York employer withholding and wage-reporting obligations, including the current Form NYS-45 family and filing-channel specifications where applicable.
- New York Paid Family Leave eligibility, coverage, contribution, leave, form, and annual parameter content where applicable.
- New York City, Yonkers, Metropolitan Commuter Transportation Mobility Tax, unemployment insurance, disability benefits, and other location/employer-specific rules only after specialist validation.
- New York SHIELD Act safeguards and breach-response mappings for organizations maintaining covered private information.
- 23 NYCRR Part 500 control/evidence mappings only for a DFS Covered Entity after applicability is established; the existence of a New York address does not activate DFS requirements.
- Higher-education and student-data obligations as separate applicable packs; no blanket FERPA or New York Education Law compliance claim.

Static numbers, rates, benefit caps, form revisions, XML/file layouts, and deadlines must not be embedded in core application code or prose-only documentation. They are effective-dated content with source, test, approval, and expiry.

### 6.4 Compliance posture

Tenure provides control implementation and evidence mapping. Legal counsel, payroll specialists, tax professionals, banks, auditors, regulators, and authorized tenant owners determine applicability and certification. Product language must say `supports configured controls`, `mapped`, `tested`, or `certified for <scope>` only when evidence supports that exact claim. It must never say globally compliant by default.

## 7. Payroll capability, certification, and provider boundary

### 7.1 Capability modes

Payroll is never inferred from the existence of time, compensation, benefits, or finance modules. Each tenant/legal-entity/worker-population/jurisdiction combination selects one explicit mode:

| Mode | Meaning | Activation gate |
|---|---|---|
| `EXPORT_ONLY` | Tenure validates and sends approved input to a payroll system; provider remains calculation and filing system | Contract tests, data-owner approval, provider sandbox acceptance |
| `PROVIDER_ORCHESTRATED` | Tenure coordinates input, status, approvals, results, journal, payment evidence, and reconciliation around a certified provider | End-to-end provider certification and operating model |
| `SHADOW_CALCULATION` | Tenure calculates for comparison only; results cannot pay or file | Specialist-approved parallel test and conspicuous non-production status |
| `TENURE_NATIVE_CERTIFIED` | Tenure performs approved gross-to-net and statutory calculation for an exact scope | External/legal/payroll certification, golden suite, filing/payment integrations, support readiness |
| `UNAVAILABLE` | No payroll operation is offered for the scope | Honest product state |

No user or tenant administrator can change the mode to a more authoritative state. Activation is a Tenure-controlled entitlement bound to certified pack versions and protected approval.

### 7.2 Canonical payroll objects

The payroll domain separates:

- Payroll relationship, assignment, legal employer, tax/payroll jurisdiction, work location, residence, worker type, pay group, payroll calendar, period, and processing frequency.
- Earnings, hours, salary, rates, overtime, shift premiums, bonus, commission, imputed income, reimbursement, deduction, benefit contribution, garnishment/order reference, tax election, and employer contribution.
- Element definition from element entry; recurring from one-time; prospective from retroactive; calculated result from source input.
- Gross-to-net result, balance, accumulator, arrears, limit, threshold, cap, proration, rounding, exchange rate, costing allocation, and payment method.
- Regular, supplemental, off-cycle, correction, reversal, retroactive, final, and test runs.
- Calculation, review, approval, prepayment, payment instruction, payslip, statutory report, filing submission, acknowledgement, settlement, journal, and reconciliation states.
- Employee-visible payslip data from administrator-only calculation evidence and highly restricted bank/tax identifiers.

### 7.3 Payroll processing state machine

Minimum run lifecycle:

`DRAFT → INPUT_OPEN → INPUT_CLOSED → VALIDATING → CALCULATING → CALCULATED → EXCEPTION_REVIEW → APPROVAL_PENDING → APPROVED → PREPAYMENT → PAYMENT_PENDING → RELEASED_TO_PROVIDER → ACKNOWLEDGED → SETTLED → RECONCILED → CLOSED`

Control states include `BLOCKED`, `REJECTED`, `RECALCULATION_REQUIRED`, `REVERSING`, `REVERSED`, `CORRECTING`, `CANCELLED`, and `LEGAL_HOLD`. Reopening a state creates a new version and preserves prior evidence.

### 7.4 Payroll invariants

- A worker is paid under the legal employer, assignment, jurisdiction, eligibility, rate, and election effective for the relevant earning date—not merely the processing date.
- Retroactive changes recalculate impacted periods under the appropriate historic rule version and produce explainable deltas.
- Calculation inputs freeze by controlled cutoff; late inputs enter an exception or next/off-cycle process.
- Provider result files are untrusted inbound data until schema, signature/channel, tenant, payroll, count, amount, duplicate, and reconciliation checks pass.
- No actor can maintain sensitive bank details, modify payroll inputs, calculate, approve, release, and reconcile the same run contrary to configured SoD.
- Bank-account changes use step-up authentication, independent verification, cooling-off/risk policy, notification, and immutable audit.
- Each result traces to source time/compensation/benefit/tax elements, rule/pack version, calculation/provider run, approval, payment status, journal, and correction history.
- Payroll journals balance and reconcile gross pay, employee deductions, employer liabilities, taxes, net pay, clearing, and cash by legal entity/pay group/period/currency.
- Payroll reports and filings disclose whether generated, submitted, accepted, rejected, amended, or merely drafted.
- A provider acknowledgement is not settlement; settlement is not reconciliation; reconciliation is not period closure.

### 7.5 Payroll certification factory

For every certified scope, maintain:

- Applicability matrix: country/subdivision, legal-entity type, worker types, residency/work patterns, currency, languages, pay frequencies, and excluded cases.
- Rule/source inventory and specialist interpretation.
- Golden employee/personas spanning minimum/maximum thresholds, new hire, termination, leave, overtime, bonus, multiple assignments, retro change, garnishment, benefit, tax election, off-cycle, reversal, negative net, and year boundary.
- Expected results at element, balance, payment, journal, payslip, filing, and reconciliation level.
- Provider comparison or independent calculation oracle; tolerances are explicit and justified, never broad enough to hide errors.
- Parallel-run plan covering representative populations and multiple cycles.
- Data privacy, incident, correction, amended filing, support escalation, and regulatory-update operation.
- Formal certification statement naming exact versions, dates, scope, exclusions, reviewers, evidence, expiry/review, and revocation process.

### 7.6 New York payroll proving scope

Before any native or provider-orchestrated New York payroll status is marked available, the implemented scope must explicitly address applicable federal, New York State, and local rules; unemployment insurance; wage and withholding reporting; Paid Family Leave; disability-benefit interaction; work-location/residence distinctions; new-hire reporting; wage statements; direct-deposit/payment rules; unclaimed wages; year-end reporting; amended/corrected processes; records retention; and effective-dated annual changes. This list is a discovery floor, not legal completeness.

NYS-45 output must be treated as a versioned statutory artifact. The product must distinguish generation, validation, filing-channel submission, agency acceptance, payment, amendment, and reconciliation. Where Tenure does not hold an authorized filing integration, it produces a controlled export or provider handoff and says so clearly.

## 8. Enterprise data-migration factory

### 8.1 Purpose and architecture

The migration factory is a tenant-isolated platform capability spanning source discovery through destruction of temporary migration data. It supports databases, APIs, vendor exports, files, object stores, documents, images, archives, and event/change feeds. It uses reusable canonical contracts, source adapters, mapping packs, quality rules, transformation packages, load APIs, reconciliation suites, and evidence manifests.

The migration control plane stores metadata, mappings, logs, counts, hashes, status, and evidence. Raw source data lands in a tenant/program/environment-specific encrypted S3 migration zone with network, IAM, KMS, retention, malware, classification, and lifecycle controls. It never lands in a shared developer folder or prompt.

### 8.2 Migration lifecycle

`REGISTERED → DISCOVERING → PROFILED → MAPPED → CLEANING → BUILDING → UNIT_VALIDATED → MOCK_1 → MOCK_N → REHEARSAL → DELTA_READY → CUTOVER_LOADING → RECONCILING → SIGNOFF_PENDING → ACCEPTED → ARCHIVED_OR_DESTROYED`

Exceptions use `BLOCKED_SOURCE`, `QUARANTINED`, `FAILED_RETRYABLE`, `FAILED_TERMINAL`, `ROLLBACK_ACTIVE`, and `LEGAL_HOLD`. Every execution has a unique run ID and references immutable source extracts, mapping versions, transformation images/packages, target schema/config versions, and evidence.

### 8.3 Source discovery and inventory

For every source, capture:

- System/application/database/file-share name, owner and steward seats, business purpose, vendor/product/version, hosting, lifecycle, contract/license, support state, and planned retirement.
- Environments, endpoints, authentication method, network path, extraction mechanism, maintenance/freeze windows, rate limits, and source change policy.
- Objects/tables/files/APIs, row/object counts, volumes, growth, date range, keys, relationships, attachments, encodings, locales, time zones, currencies, and customizations.
- Data classification, personal/sensitive/restricted data, secrets risk, legal hold, retention, residency, encryption, and export restrictions.
- Data quality indicators: completeness, validity, uniqueness, referential integrity, consistency, timeliness, duplicates, orphan records, invalid dates, precision/scale, mojibake, and free-text risk.
- Upstream/downstream dependencies, authoritative ownership by field/domain, overlapping systems, and duplicate masters.
- Extract duration, delta/CDC support, outage tolerance, recovery, and rollback capability.

Discovery results are signed off by source owner, business data owner, migration lead, privacy/security as applicable, and target domain owner.

### 8.4 Canonical mapping contract

Each mapping is executable and contains:

- Source system/object/field/path/type/format/key and target canonical object/field/type/key.
- Semantic meaning, owner, classification, required/optional/conditional status, effective dating, and source-of-truth rank.
- Direct, lookup, crosswalk, split, concatenate, derive, aggregate, explode, normalize, default, constant, suppress, anonymize, or reject transform.
- Reference/master dependency, value map, code-set version, currency/unit/time-zone handling, precision, rounding, and null/blank/zero semantics.
- Historical depth, record-selection rule, duplicate/merge policy, survivor rule, and conflict handling.
- Validation rules, error codes, remediation owner, severity, tolerance, and reconciliation measures.
- Source sample hash/reference, expected target examples, unit/property tests, approval, version, effective interval, and supersession.

Mapping spreadsheets may be imported/exported for collaboration, but the canonical mapping is validated, versioned structured data. Formulas and macros from uploaded workbooks are untrusted and never executed automatically.

### 8.5 Cleansing and master-data resolution

- Cleansing rules run as versioned transforms with before/after lineage; they do not destructively alter source systems.
- Duplicate detection uses deterministic and approved probabilistic signals, produces explainable candidates, and requires authoritative merge policy.
- Golden records preserve source identifiers, survivorship rationale, field-level provenance, and crosswalks.
- Records failing mandatory quality enter quarantine with stable error codes, business impact, owner, and remediation state.
- Tolerances distinguish acceptable warnings from load-blocking errors and cannot be widened after failure without approved rationale.
- Reference data, organization, legal entity, chart/account/dimensions, locations, calendars, people, seats/jobs, vendors/customers, bank/payment masters, and opening configuration load before dependent transactions.

### 8.6 Dependency sequencing

A migration wave is a DAG, not a file list. Typical dependency layers are:

1. Tenant configuration, localization packs, calendars, currencies, units, and code sets.
2. Organization, legal entities, ledgers/books, charts/dimensions, locations, positions/jobs, security reference objects.
3. Persons, assignments, customers, suppliers, items, assets, projects, contracts, bank/payment reference records.
4. Opening balances and open operational documents with source lineage.
5. Historical closed transactions/documents according to scope and retention.
6. Attachments, search/index projections, institutional-memory records, and external references.
7. Delta changes, final balances, open workflow state, and cutover-specific items.

The engine validates dependencies before running, supports bounded parallelism where safe, and refuses a sequence that would create unauditable orphaned data.

### 8.7 Extraction and immutable landing

- Each extract has source snapshot/time range/SCN or equivalent, query/export definition, tool/version, row/file counts, byte counts, hashes/checksums, encryption, and extractor identity.
- Source data is encrypted in transit and at rest; tenant/program/environment prefixes and KMS encryption context are mandatory.
- Multipart/resumable transfer, checksums, manifest completeness, malware/archive-bomb scanning, file-type verification, and quarantine apply to large and binary content.
- Secrets, system credentials, tokens, private keys, password hashes, and unnecessary system logs are suppressed before landing whenever possible and quarantined if detected.
- Landing objects are immutable/versioned under retention controls; transformations write new zones and never overwrite the raw evidence object.
- Access is short-lived, role/purpose-bound, fully audited, and automatically revoked after the migration phase.

### 8.8 Transformation and load runtime

The AWS-only runtime may use Step Functions for orchestration; Distributed Map for large S3 datasets when its limits and failure semantics fit; ECS/Fargate or AWS Batch for memory/CPU-heavy workers; Lambda only within its workload limits; Glue for approved data processing/catalog use; DMS for compatible database full-load/CDC; DataSync/Transfer Family for governed bulk movement; SQS/DynamoDB for checkpoints and idempotency; and Aurora/S3 for target/staging/evidence according to the Bible.

Every transformation worker must have:

- Explicit CPU, memory, ephemeral storage, duration, concurrency, retry, and cost budgets.
- Streaming parser or bounded chunks; no whole-file memory load for unbounded input.
- Deterministic transformation version and container/package digest.
- Record/batch idempotency, checkpoint, restart, cancellation, and poison-record isolation.
- Backpressure and tenant/cell quotas; one migration cannot starve production or another tenant.
- Schema validation before transform and target validation before commit.
- Safe structured logs without raw personal, payroll, bank, document, or free-text payloads.
- Counts and control totals at every boundary.

Target loads use public/internal domain commands and bulk contracts that enforce tenant context, authorization, invariants, audit, and idempotency. Direct table loads require a narrowly scoped migration interface with equivalent validations and are never general application practice.

### 8.9 Mock conversions and rehearsal

Run enough conversions to prove repeatability, not a ceremonial fixed number. At minimum:

- `MOCK_1`: validate extraction, gross mapping, dependency sequence, environment, timing assumptions, and error taxonomy.
- `MOCK_2+`: validate cleansed mappings, business scenarios, volumes, reconciliation, defects, and automation; repeat until critical defects and unexplained variances reach zero.
- `FINAL_REHEARSAL`: use production-scale volumes, final mapping/config/release candidates, final runbooks, representative delta, production-like capacity, exact roles, communications simulation, reconciliation sign-offs, rollback decision, and measured duration within the cutover window.

Every run records planned/actual start/end/duration, source/target manifests, throughput, cost, successes/rejects/warnings, quality results, reconciliations, defects, manual steps, restart events, residual resources, and lessons incorporated into the next version.

### 8.10 Reconciliation framework

Reconciliation is multi-layered:

- **Transport:** files/parts/bytes/checksums/extract manifests.
- **Technical:** objects/rows/keys, rejects, duplicates, referential integrity, nulls, types, date/precision/encoding.
- **Business:** active workers, occupied seats, customers, vendors, items, assets, open cases/orders/invoices, documents, balances, statuses, and domain control totals.
- **Financial:** trial balance, opening balances, AR/AP aging, cash, inventory, assets, payroll liabilities, grants/funds, retained earnings, intercompany, currency, and subledger-to-ledger.
- **Security:** users, memberships, seat assignments, roles, policies, delegations, SoD conflicts, terminated access, and privileged accounts.
- **Content:** files, versions, metadata, classifications, owners, retention, legal holds, checksums, previews, and index completeness.
- **Memory:** source provenance, seat/org/resource attachment, history ordering, access policy, and successor visibility.

For every measure, record source value, target value, difference, tolerance, rationale, owner, evidence query/report version, result, and sign-off. `0 unexplained variance` is mandatory for monetary balances, identity/authority, payment/payroll totals, legal holds, and required record counts. Approved immaterial tolerances may exist only for defined non-critical measures.

### 8.11 Delta and final conversion

- Define business and technical freeze boundaries by object and system.
- Capture changes after the baseline extract through CDC, timestamp/version queries, source audit, controlled change log, or explicit re-extract.
- Prove no gap and no double counting between baseline and delta.
- Reapply mappings deterministically and resolve deletes, merges, reopenings, reversals, and late master changes.
- Quiesce or sequence integrations to prevent dual-writing and echo loops.
- Load final balances and open work at the correct accounting/business time.
- Rebuild projections/indexes after canonical writes and verify freshness.
- Obtain domain, data, security, finance/payroll as applicable, and cutover sign-off before activation.

### 8.12 Vendor-source adapter policy

Support vendor patterns through plugins/adapters without runtime dependency:

- SAP sources may use approved exports, APIs, OData/ODP where licensed and supported, Migration Cockpit artifacts, staging-table patterns, or customer-authorized database/file extracts. SAP object names remain source metadata.
- Oracle Fusion sources may use REST/SOAP, BI extracts, File-Based Data Import/export patterns, HCM Data Loader files, or approved reports. FBDI/HDL structures remain adapters.
- Workday sources may use approved reports/RaaS, web services, EIB, integration-system outputs, or other licensed customer-authorized interfaces. Workday business objects remain source mappings.
- Legacy/on-premises sources may use DMS-compatible databases, agent-based file transfer, secure managed file transfer, immutable exports, or custom signed extraction packages.

The adapter catalog records supported source version, extraction method, required customer roles, licensing assumptions, rate/volume limits, incremental capability, known gaps, schema version, tests, and certification status. Logos or parsers do not make an adapter production-ready.

## 9. High-volume integration and transformation framework

### 9.1 Canonical integration envelope

Every inbound/outbound message, file, API call, event, or batch resolves to a canonical envelope containing:

- Tenant, environment, connection, integration, run, correlation, causation, schema, mapping, and idempotency identifiers.
- Source/destination, direction, business object/action, event/effective/received times, ordering/partition key, and priority.
- Classification, residency, retention, encryption/signature/checksum, content type/encoding/compression, counts/amount control totals, and attachment manifest.
- Actor/service identity, authorization policy, consent/purpose where applicable, retry attempt, status, error code, and audit pointer.
- Payload by governed reference when large/sensitive; never unrestricted payloads in logs/events.

### 9.2 Supported patterns

- Synchronous request/response APIs with timeout, quota, idempotency, and safe retry semantics.
- Asynchronous commands/events with outbox/inbox, deduplication, replay, DLQ, and schema compatibility.
- Scheduled/batch extracts and loads.
- Managed file transfer over SFTP/HTTPS/object exchange with PGP or other scheme-required payload protection where applicable.
- Webhooks with signature verification, replay window, subscription lifecycle, and delivery status.
- Database migration/CDC for approved transition scenarios, not routine coupling.
- Streaming only where latency/volume value justifies persistent operational complexity.

### 9.3 Splitter/aggregator and large-file rules

- Ingest to encrypted S3 using resumable/multipart transfer and checksum validation.
- Validate outer manifest, encryption/signature, MIME/magic bytes, compression ratio, archive entries, encoding, schema, tenant, sequence, and duplicate before processing.
- Stream records or split by deterministic safe boundary; preserve header/trailer/control records and multi-line/group relationships.
- Assign chunk IDs, record ranges, hashes, expected counts/totals, mapping version, and retry state.
- Process with bounded concurrency, memory, CPU, duration, and spend. Backpressure protects source, target, cell, and tenant quotas.
- Quarantine bad records or chunks without losing accepted/rejected lineage. Atomicity is defined by business unit of work, not arbitrary file chunk.
- Aggregate child outcomes; verify counts, amounts, sequence, duplicates, and required all-or-nothing rules before final acknowledgement.
- Expire incomplete multipart uploads and temporary chunks; reconcile residual storage and cost.
- Never download unbounded customer files into the browser or load an entire file into process memory.

### 9.4 Transformation contract

Transformations are signed, versioned, sandboxed packages with declared input/output schemas, lookup dependencies, resource budgets, deterministic/non-deterministic declaration, permitted network calls, test vectors, owner, compatibility, and rollback. They cannot access arbitrary tenant resources, AWS credentials, filesystem paths, or the public internet.

Low-code transformations compile to the same contract. Custom SDK transformations run in the extension sandbox defined by the Bible. Relay may propose transformations and tests but its output must pass human review, static analysis, sandboxing, fixture tests, and promotion.

### 9.5 Delivery semantics and error model

- Define at-most-once, at-least-once, or effectively-once outcome explicitly per operation; never promise universal exactly-once transport.
- Use business idempotency at the target to prevent duplicate effects.
- Retry only transient failures with exponential backoff and jitter; respect provider retry-after/rate limits.
- Permanent data, authorization, policy, schema, and business validation failures do not retry indefinitely.
- Stable error taxonomy distinguishes transport, authentication, authorization, throttling, schema, mapping, data quality, business rule, target state, provider, settlement, and internal faults.
- DLQ/redrive requires permission, impact preview, mapping/schema compatibility check, batch boundary, duplicate protection, and audit.
- Circuit breakers, kill switches, maintenance windows, and tenant-specific disablement stop harmful flows without disabling unrelated tenants.

### 9.6 Integration certification

Before production activation, prove connection lifecycle, least privilege, secret rotation, network path, positive/negative authentication, schema versions, mapping, idempotency, replay, ordering, volume, backpressure, rate limits, timeout, retry, DLQ/redrive, outage/recovery, reconciliation, monitoring, support, privacy/residency, provider sandbox acceptance, production cutover, and rollback. Record exact provider/system/version and known limitations.

## 10. Banking and ISO 20022 framework

### 10.1 Boundary

Tenure is the governed orchestration, approval, instruction, acknowledgement, reconciliation, and memory layer. Banks, regulated payment institutions, and certified processors execute settlement. Tenure must not claim that generating XML or connecting SFTP makes it a bank or certified payment network participant.

### 10.2 Bank and account master

Required objects include financial institution, branch, account, legal owner, currency, country/scheme, permitted payment methods, signatory/approver seats, authorization limits, bank identifiers, masked account identifiers, status, verification, effective dates, KYC/contract references, statement source, connection, cutoffs, holidays, service level, and reconciliation policy.

Bank and beneficiary master changes are high risk:

- Raw full identifiers are field-encrypted/tokenized and narrowly displayed.
- Create/change/reactivate uses step-up authentication, dual control, independent verification, duplicate/fraud checks, change reason, evidence, cooling-off or exception policy, and notification.
- An approver cannot approve their own bank-detail change or payment beneficiary under SoD policy.
- File/API exports reveal only what the bank contract requires.

### 10.3 ISO 20022 registry

Implement a versioned registry keyed by:

- Business area and exact message definition identifier/version, such as `pain.001`, `pain.002`, `pain.008`, `camt.052`, `camt.053`, `camt.054`, and applicable `pacs.*` messages.
- Official base schema/MDR/MUG version and checksum.
- Market-practice group, clearing scheme, country, bank, channel, product, and tenant-specific usage guideline overlay.
- Effective/retirement dates, code-set versions, structured-address requirements, character/length restrictions, supported currencies, identifiers, purpose/category codes, remittance rules, batch limits, and control totals.
- Validation rule set, sample/golden messages, bank certification status, owner, last test, and known deviations.

Do not code against `pain.001` as if it were one permanent schema. The exact message version and bank usage guideline are part of every generated/received artifact.

### 10.4 Payment lifecycle

The canonical state model separates business approval, instruction delivery, bank acceptance, and settlement:

`DRAFT → VALIDATED → APPROVAL_PENDING → APPROVED → SCHEDULED → FILE_OR_MESSAGE_GENERATED → TRANSMITTED → TECHNICALLY_ACKNOWLEDGED → ACCEPTED_OR_REJECTED → PROCESSING → SETTLED_OR_RETURNED → RECONCILED → CLOSED`

Control states include `HELD`, `CANCEL_REQUESTED`, `CANCELLED`, `RECALLED`, `PARTIALLY_ACCEPTED`, `REPAIR_REQUIRED`, `DUPLICATE_SUSPECTED`, and `FRAUD_REVIEW`. State is advanced only by authorized command or verified bank/provider evidence; elapsed time alone does not imply success.

### 10.5 Message-family responsibilities

- `pain.001`-style credit-transfer initiation: generate from approved payment batches, validate debtor/creditor/account/agent/remittance/amount/date/control totals, bind file/message digest to approval, and prevent post-approval mutation.
- `pain.002`-style customer payment status: correlate at group, payment-information, and transaction level; support partial acceptance and reason codes; never collapse a partially rejected batch into success.
- `pain.008`-style direct debit where enabled: mandate reference/state, creditor scheme, sequence type, advance-notice and refund/return handling under applicable scheme.
- `camt.052/053/054`-style reports/statements/notifications: preserve bank account, entry, transaction, balance, booking/value dates, references, charges, return/reversal indicators, and pagination/sequence; ingest idempotently.
- Applicable `pacs.*` or scheme messages: enable only when Tenure's contractual role, channel, and certification support them; do not expose wholesale interbank capability by default.

Message descriptions here are architectural examples. Exact semantics come from the versioned official standard and bank/scheme usage guide.

### 10.6 Payment-file and API security

- Generate only from an immutable approved batch and record source records, policy, approvers, schema/usage-guide version, generator digest, counts, amounts, hash, and time.
- Use isolated generation workers, tenant-specific encryption context, no general logs, short-lived working storage, malware/format checks for inbound artifacts, and automatic cleanup.
- Protect transport through the bank-approved channel: mTLS, signed API requests, SFTP host-key pinning, PGP/signature/encryption, IP/network controls, OAuth/client credentials, or hardware-backed keys as contractually required.
- Store credentials/keys in Secrets Manager/KMS or approved AWS cryptographic service; enforce rotation, dual control, expiry, revocation, and no secret display.
- Verify signatures, checksums, source, tenant/account, schema, timestamps, sequence, duplicates, and replay window on acknowledgements/statements.
- Block altered approved files/messages; regeneration creates a new version and approval where policy requires.

### 10.7 Reconciliation and exception management

Reconcile payment request → approved batch → generated instruction → transmitted artifact → technical acknowledgement → bank acceptance/rejection → statement/notification → ledger clearing/cash. Match using strong references first, then configured deterministic rules; fuzzy suggestions require human review.

Track unmatched, many-to-one, one-to-many, partial, fee, FX, date, amount, return, recall, duplicate, and unknown-origin cases. Every manual match records actor, rationale, evidence, and effect. Close is blocked by unexplained material differences.

### 10.8 Bank certification suite

For each bank/channel/message/version, test:

- Connectivity, certificates/keys, rotation, authentication failure, authorization, source/destination allowlists, and failover.
- Valid golden messages, every mandatory field, permitted optional fields, edge lengths/characters, Unicode/transliteration, structured addresses, currencies/decimals, dates/time zones, batch limits, and control sums.
- Missing/invalid identifiers, duplicate references, invalid accounts, blocked beneficiaries, limit breaches, cutoff/holiday, rejected/partial batches, returns, recalls, reversals, fees, FX, and repeated/out-of-order acknowledgements.
- Volume, large files, chunking where permitted, timeout, retry, replay, duplicate prevention, outage, recovery, and reconciliation.
- Provider/bank formal acceptance evidence, production activation plan, named support contacts/seats, incident path, and re-certification triggers.

## 11. End-to-end business testing and UAT governance

### 11.1 Test model

Testing is requirement- and risk-driven across:

- Unit, property, schema, contract, component, accessibility, visual-regression, integration, security, tenant-isolation, migration, calculation, workflow, and domain-invariant tests.
- System integration testing across Tenure modules, Relay, identity, external systems, files/events/APIs, finance, payroll provider, banking, reporting, and notification channels.
- End-to-end business scenarios from initiating event through memory, downstream accounting, external acknowledgement, reporting, and exception handling.
- User acceptance by accountable business process owners using representative seat/persona, policy, locale, device, data-density, and exception cases.
- Operational acceptance covering monitoring, alerting, support, backup/restore, DR, batch calendars, certificates/secrets, job controls, cost, and runbooks.
- Parallel payroll, financial close, bank, migration, and reporting validation where applicable.

### 11.2 Scenario contract

Every scenario includes stable ID, risk/priority, linked requirements/controls/processes, tenant/config/release/pack versions, environment, actors by seat, permissions, data fixture, preconditions, steps, expected state/events/accounting/notifications/memory, negative and recovery paths, evidence, result, defects, tester, and approver.

Scenarios must cover:

- Happy path, validation failure, authorization denial, SoD, duplicate/replay, concurrency, partial external success, timeout, retry, cancellation, correction, reversal, rework, period/freeze boundary, effective-date boundary, locale/time-zone boundary, and dependent-system outage.
- Current, future, former, acting, delegated, vacant-seat, multi-seat, and cross-organization relationships.
- Long strings, RTL, accents/non-Latin characters, nulls, maximum values, zero/negative values, large volumes, attachments, and inaccessible/malicious content.
- Source-system legacy edge cases and target canonical invariants.
- Relay grounded answer, missing/conflicting evidence, prompt injection, tool preview, approval, denial, and idempotent execution.

### 11.3 UAT governance

UAT is business acceptance, not outsourced QA:

- Business process owners approve scope, scenarios, expected outcomes, tester seats, data, and entry/exit criteria.
- Testers receive training and least-privileged representative roles; administrators do not execute every scenario as super admin.
- Entry requires stable release/config/migration baseline, passed prerequisite testing, available integrations, reconciled UAT data, known-defect statement, and support path.
- Evidence includes exact version, timestamp, actor, result, screenshots/exports where safe, events/journals/reports, and defect link.
- A failed step cannot be marked passed because the tester found a manual workaround unless the workaround is approved as target operating procedure.
- Retest uses the fixed release and preserves the failed evidence; regression scope reflects the change impact.
- Business acceptance is by domain and end-to-end process; project management cannot sign on behalf of an accountable business owner without formal delegation.

### 11.4 Defect model

Severity measures actual business/control impact:

| Severity | Definition | Go-live posture |
|---|---|---|
| `S0/CATASTROPHIC` | Cross-tenant exposure, unrecoverable data corruption, unauthorized payment/payroll, critical safety/legal breach | Immediate stop; no go-live |
| `S1/CRITICAL` | Core process impossible, material financial/security/control failure, no safe workaround | No go-live |
| `S2/HIGH` | Major degradation or control risk with costly/manual workaround | No go-live unless explicitly risk-accepted by authorized board under exceptional policy |
| `S3/MEDIUM` | Limited impact with documented safe workaround | May proceed with owner, deadline, support and acceptance |
| `S4/LOW` | Minor usability/cosmetic/documentation issue without control impact | Track and prioritize |

Severity is not lowered to meet a date. Each defect includes environment/version, reproducible steps, expected/actual, affected tenants/processes/roles/data, evidence, cause category, workaround, owner, target, fix version, regression impact, verification, and root cause where required.

### 11.5 Readiness scoring

Readiness dashboards calculate status from gates, not subjective percentages. Dimensions include scope/config, code/release, security/privacy, data/migration, integrations, finance/payroll/banking, UAT, performance, accessibility/UX, training, support/operations, cutover, DR/rollback, legal/contract, and external dependencies.

Use `READY`, `READY_WITH_ACCEPTED_RISK`, `NOT_READY`, or `BLOCKED_EXTERNAL`. Critical gates cannot be averaged away by many low-risk green items. Every accepted risk has authority, rationale, compensating control, expiry, owner, and contingency.

## 12. Cutover command center and go-live

### 12.1 Cutover architecture

Cutover is a tenant-scoped, versioned state machine controlled by a **Cutover Command Center**. It combines tasks, dependencies, automation, evidence, incident command, communications, decision gates, rollback boundaries, and real-time readiness. It never becomes an unchecked spreadsheet with stale copies.

Minimum lifecycle:

`DRAFT → SIMULATED → REHEARSED → BASELINED → APPROVED → FREEZE_PENDING → EXECUTING → GO_NO_GO_PENDING → ACTIVATING → VALIDATING → BUSINESS_RELEASED → MONITORING → COMPLETE`

Control states include `PAUSED`, `BLOCKED`, `ROLLBACK_DECISION`, `ROLLING_BACK`, `ROLLED_BACK`, `ABORTED`, and `EXTENDED_HYPERCARE`.

### 12.2 Command roles

Define named people occupying durable seats for:

- Executive sponsor/go-live authority.
- Cutover commander and deputy.
- Technical release lead.
- Data conversion lead and domain reconciliation owners.
- Business process/domain owners.
- Identity/security/privacy leads.
- Integration, payroll-provider, banking, finance, Relay/search, and infrastructure leads as applicable.
- Test/validation lead.
- Communications/customer support lead.
- Incident commander, scribe/timeline keeper, and decision recorder.
- Rollback authority and recovery leads.

Authority, handoff, time-zone coverage, contact channel, backup, escalation, and decision rights are explicit. Relay is never assigned an accountable command role.

### 12.3 Cutover plan levels

Maintain:

- **Strategy:** scope, approach, freeze, coexistence, migration, activation, rollback philosophy, support and success measures.
- **Integrated plan:** workstream milestones and dependencies from preparation through hypercare.
- **Detailed runbook:** minute/time-window tasks with executor, approver, duration, command/API/workflow reference, prerequisites, evidence, success/failure thresholds, retry, rollback boundary, and escalation.
- **Contact/escalation matrix:** current occupants and backups by seat.
- **Communications plan:** audiences, channels, templates, triggers, owners, translations/accessibility, and approval.
- **Decision log:** options, evidence, authority, timestamp, rationale, affected tasks, and follow-up.

### 12.4 Typical time horizons

Exact timing is tenant-specific, but plans must cover:

- `T-90 to T-30`: scope/config freeze strategy, final adapters, UAT, training, support, data cleanup, bank/provider certification, DR/rollback, and rehearsal.
- `T-30 to T-7`: final readiness, access rosters, certificates/secrets, capacity, communications, final rehearsal results, open defects/risks, command staffing, and production plans.
- `T-7 to T-1`: controlled change freeze, final source health, delta checks, backups, artifact/config digests, approvals, customer notice, and no-surprise review.
- `T0 window`: stop/sequence integrations, source freeze, final extracts/deltas, conversion, reconciliation, deploy/promote, identity/SSO, integration enablement, smoke/security/isolation, go/no-go, activation, and user release.
- `T+1 hour/day/week`: transaction monitoring, business validation, batch/statement/payroll/finance controls, issue triage, communications, adoption and stabilization.

### 12.5 Freeze and coexistence

Every object/process is classified:

- Hard freeze: no source change after cutoff.
- Soft freeze: changes permitted only through approved exception and delta capture.
- Read-only coexistence: legacy remains query-only.
- Dual operation: allowed only with explicit system-of-record ownership, direction, deduplication, conflict handling, duration, and exit.
- Deferred migration: data/process remains legacy with governed link and retirement plan.

Dual writes are prohibited unless conflict semantics, reconciliation, ownership, loop prevention, failure recovery, and sunset are proven.

### 12.6 Go/no-go gate

The board reviews current evidence, not prepared slides alone. Mandatory dimensions:

- Approved release/IaC/config/mapping/localization/connector/Relay versions and rollback identifiers.
- Production infrastructure, identity, security, privacy, monitoring, backup, restore/DR, capacity, and cost readiness.
- Final conversion status and signed technical/business/financial/security/content reconciliations.
- Critical end-to-end smoke and tenant-isolation results.
- External system, provider, bank, email/SMS, SSO/SCIM, DNS/certificate, and support readiness.
- UAT acceptance, training, communications, support staffing, runbooks, and known-defect/risk statement.
- No unresolved S0/S1; S2 only under explicitly permitted exceptional risk authority.
- Rollback feasibility at the current boundary, estimated duration/data impact, and authority.

The recorded result is `GO`, `NO_GO`, `PAUSE_AND_REASSESS`, or `ROLLBACK`, with participants, votes/authority, evidence digest, conditions, expiry, and time.

### 12.7 Activation and validation

- Activation is an idempotent protected command bound to exact approved manifests.
- Routing/DNS/feature/entitlement/connection changes are progressive where possible and observable.
- Smoke tests use safe tenant-specific synthetic/canary records and clean them through normal audited workflows.
- Validate sign-in, tenant resolution, authorization, seat context, core transactions, audit, memory, files, workflow, notifications, reporting, search/Relay degradation boundaries, integrations, and financial effects.
- Verify no cross-tenant access and no production callback to nonproduction endpoints.
- Business owners execute critical day-one scenarios before broad release when risk requires.
- Every deviation opens a command-center event and evaluates rollback threshold.

### 12.8 Rollback and forward recovery

Rollback is designed by boundary:

- Infrastructure/application rollback to immutable artifact/config.
- Database forward fix, restore, or compatibility switch; never assume down migrations are safe.
- Configuration rollback with data compatibility analysis.
- Integration disable/reroute/replay and source ownership restoration.
- Migration rollback to legacy authority or forward correction; prevent lost/double-entered changes.
- Identity rollback that preserves user access and revokes invalid sessions.
- Communication and support rollback.

Define the last reversible point before execution and recalculate it as cutover advances. If rollback becomes unsafe, the board explicitly moves to forward recovery with impact and evidence.

## 13. Hypercare and service transition

### 13.1 Hypercare plan

Every production go-live has a hypercare plan defining duration, 24x7 or business-hours coverage by risk/tier, locations/time zones, on-call rotations, channels, issue intake, severity/SLA, dashboards, daily control checks, customer communications, vendor escalation, change policy, and exit criteria.

Hypercare is not unrestricted production access. Support uses purpose-bound, approved, time-limited sessions with step-up authentication, masking, session audit, and no local data copies.

### 13.2 Operational cadence

At minimum:

- Real-time monitoring during cutover and initial release.
- Scheduled command reviews during the first critical processing windows.
- Daily cross-workstream review of incidents, defects, workarounds, reconciliations, adoption, performance, cost, and external providers.
- Domain control checks for identity/authority, workflows, finance, payroll, banking, integrations, documents/search, and notifications as enabled.
- Published status using tenant-approved audiences and redaction.
- Root-cause and permanent-fix tracking separate from immediate workaround.
- Knowledge capture into support articles, runbooks, object/process memory, and successor-ready seat records.

### 13.3 Hypercare metrics

- Case volume and severity by process/module/role/root cause.
- Time to acknowledge, mitigate, resolve, validate, and communicate.
- Reopen rate, repeat rate, workaround age, backlog age, and change failure rate.
- Login/SSO failures, authorization denials/anomalies, workflow backlog, job/integration success and lag, payment/payroll exceptions, reconciliation status, data-quality drift, notification delivery, search/index freshness, Relay groundedness/tool failures, latency/error/saturation, and cost anomaly.
- Adoption by critical process and user cohort without invasive surveillance.
- Training/knowledge gaps, unanswered questions, and process-owner confidence.

### 13.4 Change control during hypercare

- Emergency changes use an expedited but complete risk, test, approval, rollback, deployment, and evidence path.
- Configuration fixes are versioned and promoted; direct production editing does not become normal.
- Data fixes use approved domain commands or a governed correction package with before/after, affected records, dry run, validation, approval, audit, and rollback/compensation.
- A workaround has owner, instructions, risk, affected population, expiry, communication, and permanent-fix link.
- Relay may draft diagnosis and correction plans but cannot execute protected fixes without normal authority.

### 13.5 Exit and transition criteria

Hypercare exits only when:

- No unresolved S0/S1 and no unaccepted S2.
- Critical business cycles complete and reconcile, including payroll/bank/month-end where in scope or an agreed observation window substitutes.
- Reliability, performance, integration, security, data quality, support SLA, and cost remain within threshold for the agreed period.
- Workarounds and residual defects have owners, risk acceptance, deadlines, and support documentation.
- Monitoring, alerts, runbooks, access, CMDB/service catalog, backup/restore, DR, certificate/secret renewals, batch calendars, vendor contacts, and escalation paths are handed over.
- Knowledge-transfer sessions and support simulations pass; accepting support seats attest readiness.
- Customer and Tenure service owners sign the transition evidence manifest.

The program can close later than hypercare. Unfinished optimization/adoption work moves to a governed success roadmap, not hidden closure.

## 14. Legacy-system and data decommissioning

### 14.1 Decommission inventory

Inventory each application, database, server, storage volume, file share, integration, batch job, service account, certificate/key, DNS entry, firewall rule, queue/topic, report, desktop client, mobile app, archive, backup, monitoring rule, vendor contract/license, cloud resource, and physical device. Record owner, users, dependencies, data classes, retention/hold, authoritative records, cost, and target disposition.

### 14.2 Retirement states

`DISCOVERED → DEPENDENCY_MAPPED → RETIREMENT_APPROVED → CHANGE_FROZEN → READ_ONLY → ARCHIVING → ACCESS_REVOKING → DESTROYING → VERIFIED → CONTRACT_CLOSED → RETIRED_TOMBSTONE`

Control states include `LEGAL_HOLD`, `RETENTION_ONLY`, `BLOCKED_DEPENDENCY`, `ROLLBACK_WINDOW`, and `ABORTED`.

### 14.3 Gates

- Business owner confirms target process and data acceptance.
- Reconciliation and record/legal-hold sign-offs pass.
- Required archive/export is readable, indexed, permissioned, documented, checksum-verified, and restore-tested.
- Downstream integrations/reports/users are migrated or formally retired.
- Source becomes read-only for a defined rollback/reference period with monitored access.
- Credentials, service accounts, OAuth grants, keys, certificates, tunnels, firewall/DNS rules, jobs, agents, and vendor remote access are revoked.
- Backups, replicas, logs, caches, endpoints, snapshots, archives, and disaster-recovery copies follow approved disposition.
- Cloud resources are tagged, reconciled across accounts/regions, deleted or retained under explicit cost/owner, and verified through delayed billing evidence.
- Hardware/media disposition uses an approved sanitization/destruction standard and certificate; do not direct Claude to physically destroy hardware.
- Contracts/licenses/support renewals and data-processing relationships are terminated or amended.
- Residual risk, retained artifacts, retrieval process, cost, owner, and retention end are visible.

### 14.4 Destruction evidence

Evidence includes approved scope, asset identifiers, source/target relationship, retention/hold decision, export manifest and restore result, deletion workflow/run IDs, cloud resource reconciliation, credential revocation, vendor/hardware certificates, dates, actors/approvers, exceptions, and tombstone. Evidence must not contain the destroyed sensitive content.

## 15. Implementation workbench and live-product UX requirements

### 15.1 One experience system

All implementation surfaces consume the Tenure Experience System. They must match the Bible's modern, calm, precise, dark-forest-green identity; independent soft/cool light and dark modes; Radix Primitives only as an evaluated accessibility/behavior substrate; comfortable and compact density; professional data visualization; responsive and keyboard-first operation; and observed long-session comfort.

Implementation cannot regress into a gray consulting portal, spreadsheet clone, terminal-like admin page, or unstyled internal tool merely because only Tenure staff see it.

### 15.2 Required workbench surfaces

- Program home with scope, health, phase, critical path, risks, decisions, dependencies, readiness, evidence, and next actions.
- Landscape map showing environments, releases/configs/packs/data classes, connections, cost, expiry, health, and promotion drift.
- Process design studio with current/target flow, actors by seat, controls, variants, requirements, gaps, and sign-off.
- Configuration studio with schema-aware forms, provenance, diffs, validation, simulation, impact, approvals, promotion, and rollback.
- Data migration cockpit with sources, profiling, mapping, quality, run DAG, throughput, errors, quarantine, reconciliation, and sign-offs.
- Integration center with connections, schemas/mappings, runs, lag, retries, DLQs, certifications, secrets/certificate status, and cost.
- Localization/payroll/bank pack registry with applicability, versions, effective dates, certification, impacted tenants, test evidence, and urgent changes.
- Test/UAT center with requirement coverage, scenarios, results, defects, retests, evidence, and owner sign-off.
- Cutover command center with live timeline, dependencies, current task, blockers, decisions, communications, go/no-go, rollback boundary, and command roles.
- Hypercare center with cases, telemetry, reconciliations, workarounds, trends, knowledge, staffing, and exit readiness.
- Decommission center with assets/dependencies, archive, revocation, destruction, costs, and evidence.

### 15.3 Visual grammar

- Use restrained forest green for brand/action/focus, not every data series or surface.
- Status colors have one stable semantic meaning and always pair with text/icon/pattern.
- Dense tables freeze important identifiers, support saved views, field-level permission states, bulk review, row expansion, keyboard navigation, and export scope preview.
- DAGs, Sankeys, timelines, dependency graphs, reconciliation waterfalls, variance bridges, run-rate charts, control matrices, and heatmaps use governed chart components with source, filter, freshness, unit, scale, accessible table, drill-through, and export.
- Migration Sankeys show source → transform/quarantine → canonical target counts/amounts without misleading widths.
- Cutover timelines emphasize critical path, current time, delay, slack, dependencies, authority, and rollback boundary without urgency theater.
- Finance/banking visualizations never mix currencies or net incompatible categories silently.
- Error screens preserve run/task context and provide safe recovery; raw vendor stack traces and payloads are never the user experience.

### 15.4 Live CloudFront build audit contract

The current build at `https://d2kj4iy5i37kfd.cloudfront.net/` is an implementation input, not authoritative design. The unauthenticated observation on 2026-08-02 showed a redirect to `/signin` titled **Tenure System Studio**, with a minimal Tenure/System Studio/Internal header, `Tenure staff` heading, email field, `Operator secret` field, and sign-in action on a warm off-white canvas with brown/gold action color and monospace-heavy typography.

This observation creates mandatory audit questions, not a final verdict on authenticated routes:

- Does the deployed build use Cognito/federated BFF authentication, or a custom operator-secret path that conflicts with the Bible?
- Is `Operator secret` a development-only bootstrap, and is it impossible in production?
- Does the sign-in surface expose environment, tenant, support, accessibility, recovery, SSO, error, loading, lockout, and security state correctly?
- Does the brown/gold accent and monospace identity predate and conflict with the binding forest-green Tenure Experience System?
- Do authenticated routes share coherent TES tokens/components or repeat a one-off internal-console style?

Claude must perform a complete authenticated read-only visual/functional audit only through an authorized test account/session. It must inventory every route, role, theme, density, viewport, state, action, chart, table, form, builder, error, loading, empty, and permission boundary. It must not use credentials from prompts, bypass sign-in, or mutate production during an audit.

#### 15.4.1 Authenticated current-state observation — 2026-08-02

An authorized read-only inspection reached `/`, `/tenants`, `/tenants/new`, `/tenants/{slug}`, and `/platform`. These observations are current-state evidence to revalidate against repository and AWS truth, not permanent facts.

Useful foundations already visible:

- Three file-configured fixtures distinguish Simon, a nonprofit/corporate-like organization, and an Arabic/UAE RTL convention fixture.
- Configuration values show provenance across platform default, blueprint, and tenant overlay and expose configuration digests.
- Module versions, entitlements, topology, placement, signed deployment-manifest concepts, state history, per-step evidence, idempotent invitation intent, two-person approval records, and honest disabled-module reasons are visible.
- Provisioned tenants are separated from older file-configured systems so the UI does not falsely invent provisioning history.
- The compose flow distinguishes DRAFT registration from provisioning/activation and exposes pooled/bridge/silo/dedicated-account intent honestly.
- Tenant plans explicitly say `$0 marginal` is not the same as free and describe shared-cost attribution.
- The Platform page attempts to count progress against the whole program and exposes open findings instead of hiding them.

Critical current-state gaps observed or reported by the console:

| Area | Current observation | Binding correction |
|---|---|---|
| Identity | Platform reports no Cognito user pool and one shared passphrase; public sign-in asks for `Operator secret` | Replace with Cognito/federated operator identity, phishing-resistant MFA/step-up, JIT privilege, protected support sessions, revocation, and audited BFF/session controls |
| AWS organization | Platform reports single-account estate and no Organizations/OIDC foundation | Build Tenure-owned multi-account Organization and OIDC. An `AccessDenied` Organizations call is not proof that no Organization exists; classify it as permission-limited until authoritative evidence is obtained |
| Deployment credentials | Platform reports long-lived keys shared across two repositories | Inventory use without exposing values, bootstrap least-privilege OIDC, move workflows, then disable/rotate through protected human process |
| Edge/recovery | Platform reports no WAF, one-day RDS backup retention, no Multi-AZ, and no backup vault | Implement threat/risk-appropriate WAF/edge controls, backup vault/policy, restore tests, RPO/RTO, resilience and staged proof before production claims |
| Authorization | Platform reports the authorization engine gates nothing beyond two navigational consumers | Enforce centralized server-side authorization on every API/command/query/job/file/search/Relay/tool/support path and prove negative tests |
| Audit | Platform reports 34 of 35 audit writes bypass validation, redaction, and chaining | Route every material write through one invariant-enforcing audit path with redaction, integrity/chaining/tamper evidence, retention and safe telemetry |
| Provenance | Platform reports seeded and operator-entered rows are indistinguishable | Add source/provenance, actor, method, import/run, version, and confidence/verification metadata where applicable |
| Tenant policy | Platform reports one tenant's policy content compiled into the global engine | Extract it to versioned tenant/industry/jurisdiction configuration or content pack; add anti-hard-code tests |
| Orphan infrastructure | Five queues and an SES identity reportedly have no producer/consumer; a DLQ alarm is green because nothing writes | Reconcile IaC/runtime ownership, implement and test the path or remove it through approved change; alarms must prove a live signal path |
| Lifecycle actions | Active-tenant page exposes direct `IDLE`, `SUSPENDING`, `HIBERNATING`, `EXPORTING`, `OFFBOARDING`, and `LEGAL_HOLD` buttons without visible impact preview, reason, approver, cost/residual-resource status, or rollback context | Use structured action preview, reason/evidence, permission/step-up, SoD/approval, current-state precondition, idempotency, plan/diff/cost, rollback/recovery, confirmation, audit and async progress |
| State/evidence truth | An active tenant's `MIGRATING` evidence says transport to the cell is not wired while the same evidence says delivered/applied and the tenant became ACTIVE | Reconcile evidence semantics; an unwired transport cannot coexist with a successful delivered/applied/activated claim without an explicitly different authorized mechanism and proof |
| Program ledger | Platform shows `GE-020-005` twice with contradictory checked/unchecked states and repeats Phase 1 items in another batch | Enforce stable unique IDs, canonical row, computed status, source version, and duplicate/conflict validation before reporting progress |
| Program size | Platform shows the superseded 552-item/18-phase program | Import the unified v2 prompt and extension, calculate every current `GE-*` and `EXT-*` row, and show separate implemented/deployed/evidenced/blocked states |
| Finding ownership | Some owners are malformed broad strings such as `GE-030s` and `GE-120s` | Link each finding to an exact stable requirement, accountable seat, remediation, due state, evidence, and risk |
| Fleet operations | Tenant list lacks search/filter/sort/saved views, health, last change, region/cell, release/config drift, current/forecast cost, blockers, residual resources, and owner/support state; duplicate E2E fixtures clutter the fleet | Deliver a true fleet workbench, lifecycle-specific views, archive/test-fixture treatment, and safe bulk operations |
| Cost | Fleet `Cost note` cells are empty while detail pages say `$0 marginal` based on assumptions | Populate measured/estimated/unknown states, shared-allocation method, freshness, retained cost, and verification source; never render empty as zero |
| Composition | New tenant form exposes only one region and two blueprints; dedicated account says AWS Organization does not exist yet | Drive selectable options from capability/region/cell/pack catalogs and show unavailable reason, dependency, request path, and target readiness without hard-coding the ceiling |
| Visual system | Entire console uses approximately 13.5px monospace, warm gray/off-white surfaces, thin neutral borders, and brown/gold status/action accents; only light color scheme was exposed and no theme control was visible | Migrate through TES to readable modern typography, dark-forest-green brand/focus, independently art-directed light/dark/high-contrast modes, semantic status colors, hierarchy, density modes, responsive layouts, and long-session comfort |
| Information architecture | System, fleet, evidence, program and AWS truth are long undifferentiated pages with limited drill/filter/comparison/visualization | Add role/task-oriented summaries, saved views, search, progressive disclosure, inspectors, comparisons, dependency/lifecycle visuals and source-aware drill-through |
| Privacy | Operator identity and administrator emails are printed repeatedly in dense histories | Apply purpose-based display, masking where appropriate, profile/seat labels, export controls, and minimize repeated personal identifiers without losing attribution |

Do not erase the good provenance and honesty while redesigning. The target is a precise modern operating surface that makes stronger controls easier to understand and execute.

#### 15.4.2 Current-state remediation order

1. Contain shared-passphrase/long-lived-key/public-edge/backup/authorization/audit risks.
2. Correct false or contradictory evidence and program-ledger math.
3. Establish Cognito/operator identity, OIDC/multi-account foundations, server-side authorization, immutable audit, and tested recovery.
4. Make lifecycle actions protected structured commands with previews, approval, evidence, asynchronous progress, and rollback/recovery.
5. Converge the old file-configured systems and registry tenants through explicit adoption/migration without fabricated history.
6. Build the full fleet/cost/configuration/implementation workbenches.
7. Migrate the console to TES with visual regression, accessibility, performance, and long-session proof.
8. Add the extension's migration/localization/payroll/banking/UAT/cutover/hypercare/decommission surfaces only after their foundational controls exist.

### 15.5 Visual acceptance matrix

For each route and persona/seat, capture and verify:

- Light, dark, high-contrast, reduced-motion, comfortable/compact density, desktop/tablet/mobile, keyboard, screen reader, zoom/reflow, RTL and long-localized content where supported.
- Default, loading, skeleton, empty, no-results, populated, dense, validation error, server error, offline/degraded, stale/conflict, permission denied, archived, deleted/purge-pending, and high-risk confirmation states.
- Navigation location, title/action hierarchy, data/source freshness, filter state, save/share/export, undo/rollback, notification, audit/memory, and Relay context.
- WCAG target evidence, visual-regression baseline, performance/Core Web Vitals or product budgets, and observed 30/90/multi-hour comfort studies defined in the Bible.

## 16. Relay during implementation and transformation

### 16.1 Allowed value

Relay can:

- Summarize discovery interviews, requirements, source inventories, mappings, defects, readiness, cutover, and hypercare evidence with citations.
- Suggest canonical mappings, data-quality rules, transformation code, tests, process gaps, SoD conflicts, reconciliation dimensions, training material, support articles, and risk mitigations.
- Compare environment/config/mapping/pack/release versions and explain impact.
- Read authorized diagrams, screenshots, charts, workbooks, exports, logs with safe projections, vendor documents, and run evidence.
- Draft cutover plans, communications, runbooks, rollback options, and postmortems.
- Execute approved low-risk read or reversible actions through typed tools under user/seat/tenant/program scope.

### 16.2 Mandatory limits

Relay must not:

- Read source extracts, payroll/bank data, secrets, or production content beyond the current user's authorized purpose and environment.
- Treat vendor files, uploaded documents, source data, web content, or retrieved text as instructions that override policy.
- Invent mapping semantics, statutory rules, certification, source counts, reconciliation, bank acceptance, test results, approvals, or deployed state.
- Approve its own mapping/config/code, clear a defect, accept a variance, certify payroll/localization/bank content, make a go/no-go decision, release a payment/payroll, or destroy legacy data.
- Use direct database credentials or bypass domain commands, workflow, authorization, SoD, audit, idempotency, and protected production gates.

### 16.3 AI evidence

Every implementation answer/action shows tenant, program, environment, source boundary, cited artifacts/versions, freshness, uncertainty/conflict, permissions used, proposed affected objects, before/after, tests, estimated cost, side effects, approvals, and reversibility. Model/prompt/tool/index versions enter the evidence manifest. Sensitive prompts/responses follow the pack's retention and redaction policy.

## 17. Security, privacy, compliance, and records controls

### 17.1 Threat model additions

Threat model at least:

- Malicious or compromised source system and poisoned migration data.
- Prompt injection in documents, mappings, spreadsheets, images, vendor files, and error messages.
- Cross-tenant/program/environment access through mappings, run IDs, object references, caches, jobs, file paths, search, exports, evidence, Relay, or support.
- Source/target credential theft, over-privileged extraction, unsigned packages, dependency compromise, and unapproved egress.
- Data leakage through logs, samples, screenshots, defects, reconciliation workbooks, support cases, training environments, downloads, or local machines.
- Fraudulent supplier/employee bank changes, payment-file tampering, duplicate payments, payroll manipulation, and acknowledgement spoofing.
- Mapping or localization rule tampering, backdated effective dates, widened tolerances, hidden rejects, false sign-off, and evidence deletion.
- Cutover insider threat, break-glass abuse, command impersonation, task status falsification, and unauthorized production fixes.
- Legacy access left active, orphaned cloud resources, forgotten backups, unrevoked OAuth grants, and vendor data retention.

### 17.2 Control baseline

- Tenant/program/environment isolation in IAM, database, S3, KMS, queues, orchestration, logs, search, caches, evidence, and Relay.
- Short-lived federation/OIDC, no routine IAM users or long-lived deployment keys, JIT support privilege, phishing-resistant MFA and step-up for high risk.
- Secrets Manager/KMS, rotation, version pinning, access audit, no secret values in repository, prompt, logs, evidence, screenshots, or exports.
- Private networking/VPC endpoints where warranted, egress allowlists, DNS/network monitoring, WAF/edge controls, mTLS/SFTP host-key pinning/provider requirements.
- Signed/scanned immutable containers/packages/mappings/config/packs, SLSA-oriented provenance, dependency/license/vulnerability policy, and promotion by digest.
- Field/object/classification authorization, download/export controls, watermark where useful, malware/active-content protection, and safe previews.
- Immutable audit/evidence with retention/legal hold, time synchronization, tamper detection, and separation from general logs.
- Automated tests for cross-tenant, privilege escalation, IDOR, injection, SSRF, deserialization, archive bombs, formula injection, XML entity attacks, signature wrapping, replay, and denial-of-service.

### 17.3 Privacy and records

- Maintain data inventory and processing purpose for migration, testing, support, Relay, payroll, bank, and legacy archives.
- Minimize data and access by phase; auto-expire project access and temporary datasets.
- Support data-subject/right requests without corrupting legally retained finance/payroll/audit records; use restriction, legal basis, and defensible disposition.
- Preserve legal hold across source, migration zones, target, files, indexes, analytics, backups, evidence, and decommissioning.
- Customer exports and reconciliation evidence are encrypted, permissioned, time-limited, scoped, and audited.
- Record schedules apply to implementation decisions, mappings, tests, defects, cutover records, support cases, and destruction certificates as defined by contract/jurisdiction.

Named control packs such as New York SHIELD Act and 23 NYCRR Part 500 are applicability-driven mappings. The system records `NOT_APPLICABLE`, `IN_SCOPE`, `PARTIAL`, or `REQUIRES_EXTERNAL_ASSESSMENT` with evidence; it never activates them because of geography alone.

## 18. AWS reference blueprint, operations, and FinOps

### 18.1 AWS service mapping

Use existing healthy repository IaC and the Bible's service-selection discipline. Candidate services by responsibility:

| Responsibility | AWS-native candidate | Required constraint |
|---|---|---|
| Implementation orchestration | Step Functions, EventBridge, SQS/DLQ, DynamoDB locks/idempotency | Tenant/program/environment context and bounded concurrency |
| Large dataset fan-out | Step Functions Distributed Map where fit; ECS/Batch workers | S3 manifests, failure threshold, child-run evidence, cost guard |
| Bulk object transfer | S3 multipart, DataSync, Transfer Family, presigned/scoped upload services | Checksums, encryption, malware, retention, no public bucket |
| Database migration/CDC | AWS DMS where engine/semantics fit | Source/target validation, CDC gap proof, not a substitute for business reconciliation |
| Transform/profile | ECS/Fargate, AWS Batch, Glue where justified, Lambda for bounded work | Signed images, VPC/egress control, resource budgets, deterministic version |
| Metadata/operational store | Aurora PostgreSQL, DynamoDB projections | Tenant isolation and temporal/audit constraints |
| Raw/staged/evidence data | Separate encrypted S3 zones | Immutable raw, lifecycle, object lock where required, access logging |
| Secrets/crypto | Secrets Manager, KMS, ACM, CloudHSM/payment cryptography only if justified | Least privilege, rotation, non-exportability where required |
| Observability/security | CloudWatch, OpenTelemetry/X-Ray, CloudTrail, Config, GuardDuty, Security Hub, Macie where fit | Safe metadata; no raw payload logs |
| Relay | Bedrock-approved models/services under the Bible | Permission-aware retrieval and typed tools only |

AWS service availability varies by region/partition. Placement and pack activation must verify that required services, models, encryption, logging, and certifications are available in the selected cell; no silent cross-region processing.

### 18.2 Operational telemetry

Every run emits safe structured dimensions: tenant safe ID, program, environment, workstream, source/target adapter, object, run/chunk, release/config/mapping/pack/schema versions, state, result, error code, counts, amounts in protected aggregates, bytes, duration, throughput, queue/lag, retries, cost, owner, and correlation. Raw records, names, identifiers, bank data, payroll values, documents, secrets, prompts, and unrestricted vendor messages do not enter general logs.

Dashboards and alarms cover:

- Environment drift, expiry, public exposure, access anomalies, backup/restore, and cost.
- Migration throughput, backlog, rejects, quality, reconciliation, CDC lag, and projected completion.
- Integration delivery, rate limits, timeout, DLQ, schema drift, certificate/secret expiry, and provider outage.
- Payroll/bank batch status and safe control-total variance without exposing restricted detail.
- Cutover critical path, delay, blocker, rollback boundary, command coverage, and validation.
- Hypercare SLOs, case trends, workarounds, adoption, performance, security, cost, and exit gates.
- Legacy residual resources, access, retained bytes, licenses, and forecast cost.

### 18.3 FinOps and zero-runtime disciplines

- Tag/attribute costs by environment, tenant, program, workstream, migration run, service, adapter, and owner where AWS allows; use application meters for shared services.
- Estimate each mock conversion, full rehearsal, performance test, data retention option, and cutover before approval.
- Budgets, anomaly alerts, concurrency/spend ceilings, and auto-stop protect nonproduction and transformation workloads.
- Temporary workers, endpoints, NAT/egress, search, databases, transfer agents, snapshots, logs, multipart uploads, staging objects, and test environments have explicit teardown/retention owners.
- Hibernation removes/scales runtime and discloses retained storage/control cost. Literal zero incremental cost requires approved purge, orphan scan, residual-resource reconciliation, and delayed CUR/Cost Explorer evidence, consistent with the Bible.
- Cost is never optimized by weakening reconciliation, security, legal retention, backup, tenant isolation, or audit.

### 18.4 Reliability and recovery

- Orchestrations are restartable from durable checkpoints and safe under duplicate events.
- Every batch/run defines partial-failure semantics, cancellation, timeouts, and compensating actions.
- Source extracts and immutable manifests allow rerun without undocumented source drift.
- Restore drills cover implementation metadata, mappings/config/packs, evidence, migration zones where retained, and tenant target data.
- Region/cell failure plans define whether migration/cutover pauses, resumes in-region, or fails over; no cross-region move violates residency.
- Bank/payroll/provider outage runbooks distinguish queueing, cutoff risk, manual authorized contingency, duplicate protection, and customer/regulator communication.
- Cutover has an independent communication path if Tenure tenant services are degraded.

## 19. Evidence-gated Claude implementation checklist

### 19.1 Completion protocol

Claude must copy these stable IDs into `docs/implementation/global-erp-extension-ledger.md` and link them into the unified final verification matrix.

Rules:

1. Leave `- [ ]` until the stated scope is integrated, tested, deployed to the required authorized environment, and evidenced.
2. Use only `PASS`, `FAIL`, `BLOCKED_EXTERNAL`, or `NOT_APPLICABLE` with a reason. There is no final `PARTIAL`.
3. `BLOCKED_EXTERNAL` requires exact missing customer/vendor/bank/legal/production input, owner, requested date, affected scope, safe work completed, and next action.
4. `NOT_APPLICABLE` requires approved applicability evidence; lack of implementation is not N/A.
5. A phase gate stays open until every mandatory child passes or is validly blocked without weakening an invariant.
6. Each checked item records code/config path, commit SHA, tests/counts/results, environment/account alias/region/cell, release/config/schema/mapping/pack versions, workflow/run/evidence ID, and rollback or recovery reference.
7. Never attach credentials, raw customer data, unrestricted logs, bank/payroll identifiers, source extracts, or secret-bearing plans as evidence.

### EXT-000 — Authority, source documents, and baseline

- [ ] EXT-000-001 — Canonical Bible, this extension, prompt, ADRs, repository rules, contracts, and applicable specialist source documents are located, versioned, and included in the read-order contract.
- [ ] EXT-000-002 — Current repository, AWS, environment, tenant, data, integration, and release truth is inventoried read-only without exposing secrets.
- [ ] EXT-000-003 — Existing implementation/migration/localization/payroll/bank/cutover/support artifacts are mapped to canonical objects; conflicting sources of truth are identified.
- [ ] EXT-000-004 — Current live CloudFront build and authenticated test build are route/role/state/theme/viewport audited through authorized accounts; no production mutation occurs.
- [ ] EXT-000-005 — Baseline build, test, security, accessibility, visual, migration, and deployment failures are recorded separately from new work.
- [ ] EXT-000-006 — Extension execution ledger and final verification rows exist for every EXT ID.
- [ ] EXT-GATE-000 — Baseline truth and authority are complete enough to design without guessing protected customer/legal/vendor facts.

### EXT-010 — Implementation Control Plane

- [ ] EXT-010-001 — Implement tenant-scoped program, workstream, requirement, decision, assumption, dependency, RAID, deliverable, process, mapping, test, readiness, cutover, hypercare, and decommission objects.
- [ ] EXT-010-002 — Add immutable IDs, version/effective dating, classification, retention, optimistic concurrency, actor/audit, and tenant/program context.
- [ ] EXT-010-003 — Implement program lifecycle and controlled transitions, permissions, evidence requirements, and blocked/hold/rollback states.
- [ ] EXT-010-004 — Implement requirement-to-process/config/code/migration/integration/control/test/training/cutover/support traceability.
- [ ] EXT-010-005 — Implement signed artifact approval, exact-version snapshot, supersession, exception expiry, and scope-change impact.
- [ ] EXT-010-006 — Implement durable-seat ownership and handoff for every program role and decision.
- [ ] EXT-010-007 — Implement evidence-derived health/readiness and prevent manual green overrides of failed critical gates.
- [ ] EXT-010-008 — Enforce cross-tenant implementation-metadata isolation and minimized fleet analytics.
- [ ] EXT-010-009 — Deliver TES-governed program, workstream, decision, risk, dependency, evidence, and readiness surfaces.
- [ ] EXT-010-010 — Prove end-to-end program flow with Simon and a structurally different corporate implementation fixture.
- [ ] EXT-GATE-010 — Implementation truth is first-class, temporal, tenant-isolated, permissioned, auditable, and successor-ready.

### EXT-020 — Environment landscape and promotion

- [ ] EXT-020-001 — Implement environment class registry and schema for every class in Section 4.
- [ ] EXT-020-002 — Implement environment manifests with AWS placement, versions, data rules, access, connections, cost, expiry, entry/exit, and destruction.
- [ ] EXT-020-003 — Provision environments through reusable IaC and configuration; block console-only drift and personal/unrelated accounts.
- [ ] EXT-020-004 — Enforce class-specific allowed/prohibited data, outbound notification suppression, egress, Relay, connector, and export policies.
- [ ] EXT-020-005 — Implement production-derived-data exception, masking/tokenization, leakage scan, approval, lineage, expiry, and destruction.
- [ ] EXT-020-006 — Implement code/config/mapping/pack/connector promotion by immutable digest with compatibility, diff, approval, and rollback.
- [ ] EXT-020-007 — Implement environment compare for release, IaC, schema, config, mappings, packs, connectors, data class, and Relay versions.
- [ ] EXT-020-008 — Implement automatic expiry, hibernation/teardown, orphan scan, residual cost, and delayed billing verification.
- [ ] EXT-020-009 — Prove safe gold-to-production promotion without a production database copy.
- [ ] EXT-020-010 — Prove DR restore-drill environment isolation and mandatory destruction.
- [ ] EXT-GATE-020 — Every environment has controlled purpose, data, authority, versions, cost, and end-of-life.

### EXT-030 — Staffing and universal journal foundation

- [ ] EXT-030-001 — Implement effective-dated `POSITION_CONTROLLED`, `JOB_MANAGED_POOLED`, `MIXED`, and `NON_WORKFORCE_SEAT` policies without person/seat conflation.
- [ ] EXT-030-002 — Separate job, position, headcount/FTE authorization, assignment, employment relationship, compensation, funding, and authority.
- [ ] EXT-030-003 — Implement vacancy/overfill/capacity/budget reconciliation and matrix/interim/delegated/shared arrangements.
- [ ] EXT-030-004 — Implement staffing-mode migration simulation, continuity mapping, reconciliation, approval, and rollback.
- [ ] EXT-030-005 — Implement accounting event, effective-dated rule set, journal header/line, ledger, book, subledger, and posting batch contracts.
- [ ] EXT-030-006 — Enforce balanced immutable posting, period/currency/dimension/rule validation, idempotency, reversal/correction, and source drill-through.
- [ ] EXT-030-007 — Implement multiple ledger/book/accounting-basis/valuation views without copying a vendor schema.
- [ ] EXT-030-008 — Implement intercompany counterpart, balancing, reconciliation, consolidation, and elimination boundaries.
- [ ] EXT-030-009 — Implement finance migration reconciliation by entity/ledger/book/period/currency/account/dimension/source.
- [ ] EXT-030-010 — Prove subledger-to-ledger and source-to-report traceability under concurrency, reversal, closed period, and retry.
- [ ] EXT-GATE-030 — Staffing and accounting foundations are generic, effective-dated, reconciled, and historically reconstructable.

### EXT-040 — Localization and regulatory content

- [ ] EXT-040-001 — Implement signed, versioned, effective-dated localization pack schema, dependencies, applicability, sources, certification state, and lifecycle.
- [ ] EXT-040-002 — Implement authoritative-source snapshot/checksum, specialist interpretation, reviewer/approval, and historical reconstruction.
- [ ] EXT-040-003 — Implement effective-dated forms/schemas/code lists/calculations/thresholds/workflows/controls/reports/retention and golden tests.
- [ ] EXT-040-004 — Implement regulatory monitoring intake, impact analysis, simulation, tenant diff, approval, notification, activation, and emergency correction.
- [ ] EXT-040-005 — Prevent pack availability until exact certification, provider/integration, regression, support, region, and effective-date gates pass.
- [ ] EXT-040-006 — Implement explicit applicability/evidence for country/subdivision/industry/entity/population and no geography-only activation.
- [ ] EXT-040-007 — Create New York proving pack catalog for NYS-45 family, PFL, applicable local/employer rules, SHIELD, and conditional DFS Part 500 mappings.
- [ ] EXT-040-008 — Keep changing rates/dates/forms/file layouts outside core code and prove historic/current/future rule selection.
- [ ] EXT-040-009 — Add honest product language and block unsupported compliance/certification claims.
- [ ] EXT-040-010 — Prove a second jurisdiction fixture with conflicting calendars/formats/rules through the same engine.
- [ ] EXT-GATE-040 — Localization is governed executable content, not scattered conditionals or permanent prose.

### EXT-050 — Payroll boundary and certification

- [ ] EXT-050-001 — Implement payroll capability-mode registry and Tenure-controlled entitlement by exact certified scope.
- [ ] EXT-050-002 — Implement canonical payroll relationships, periods, elements, runs, results, balances, payment/filing/journal/reconciliation states with strict privacy.
- [ ] EXT-050-003 — Implement payroll state machine, cutoff/freeze, late input, recalculation, retro, off-cycle, correction, reversal, cancellation, and closure.
- [ ] EXT-050-004 — Enforce effective-date calculation, provider-result distrust/validation, SoD, bank-change protection, and immutable traceability.
- [ ] EXT-050-005 — Implement provider export/orchestration contracts with input/output control totals, signatures/channel evidence, acknowledgements, errors, and replay safety.
- [ ] EXT-050-006 — Implement payroll-to-ledger costing/journal and liability/net/cash reconciliation.
- [ ] EXT-050-007 — Build certification factory with applicability, golden personas/cases, expected results, oracle/provider comparison, parallel runs, tolerances, support, expiry, and revocation.
- [ ] EXT-050-008 — Implement New York discovery/certification matrix and versioned NYS-45 generation/handoff states without claiming filing when not submitted.
- [ ] EXT-050-009 — Block release, filing, or native availability for uncertified/expired scope and display `UNAVAILABLE` honestly.
- [ ] EXT-050-010 — Prove restricted payroll access, audit, export, correction, provider outage, and incident runbooks.
- [ ] EXT-GATE-050 — Payroll authority is explicit, certified for exact scope, reconciled, private, and never simulated as production capability.

### EXT-060 — Migration factory

- [ ] EXT-060-001 — Implement tenant/program/environment-isolated migration registry, S3 zones, KMS/IAM/network/retention/malware/lifecycle controls, and run state machine.
- [ ] EXT-060-002 — Implement source-system inventory, ownership, schema/object/volume/classification/dependency/quality/extract/delta/retirement profile.
- [ ] EXT-060-003 — Implement executable canonical mapping schema with lineage, effective dates, transforms, crosswalks, quality, examples, tests, and approval.
- [ ] EXT-060-004 — Import/export mapping workbooks safely without executing formulas/macros or making them canonical.
- [ ] EXT-060-005 — Implement profiling, cleansing, duplicate resolution, golden-record survivorship, crosswalk, quarantine, remediation, and tolerance governance.
- [ ] EXT-060-006 — Implement dependency DAG, precondition validation, bounded parallelism, and reference/master/transaction/content/delta ordering.
- [ ] EXT-060-007 — Implement immutable extraction manifests, checksums, encryption, secret suppression/scan, object versioning, and access expiry.
- [ ] EXT-060-008 — Implement bounded streaming/chunked transform workers with resource/cost budgets, signed digest, idempotency, checkpoint/restart/cancel, backpressure, and safe logs.
- [ ] EXT-060-009 — Load through invariant-enforcing bulk/domain contracts; restrict any direct migration interface to equivalent validation/audit.
- [ ] EXT-060-010 — Execute MOCK_1, iterative mocks, and final rehearsal with production-scale volume, timing, roles, delta, reconciliation, rollback, cost, and lessons.
- [ ] EXT-060-011 — Implement transport/technical/business/financial/security/content/memory reconciliation with source/target/diff/tolerance/owner/evidence/sign-off.
- [ ] EXT-060-012 — Require zero unexplained variance for authority, money, payroll/payment totals, legal holds, and mandatory records.
- [ ] EXT-060-013 — Implement baseline/delta gap and duplicate proof, final freeze, integration sequencing, projection rebuild, and sign-off.
- [ ] EXT-060-014 — Implement adapter catalog/contracts for SAP, Oracle, Workday, database, file, API, and legacy sources with version/licensing/gap/certification metadata.
- [ ] EXT-060-015 — Prove failed chunk/retry/restart/poison record/source drift/schema drift/rollback and no cross-tenant access.
- [ ] EXT-GATE-060 — Migration is repeatable, lineage-complete, reconciled, rehearsal-proven, and safe to cut over.

### EXT-070 — High-volume integrations

- [ ] EXT-070-001 — Implement canonical integration envelope and large-payload governed references.
- [ ] EXT-070-002 — Implement API, async event/command, batch/file, managed transfer, webhook, approved CDC, and justified streaming patterns.
- [ ] EXT-070-003 — Implement resumable/multipart ingest, manifest/signature/checksum/MIME/archive/schema/tenant/sequence/duplicate validation and quarantine.
- [ ] EXT-070-004 — Implement deterministic splitter/chunk manifest, bounded processing, atomic business unit, aggregation, totals, and temp cleanup.
- [ ] EXT-070-005 — Implement signed sandboxed transformation packages and compiled low-code contract with no arbitrary credentials/network/filesystem.
- [ ] EXT-070-006 — Implement explicit delivery semantics, target idempotency, transient retry/backoff/jitter, permanent failure, DLQ/redrive, and replay protection.
- [ ] EXT-070-007 — Implement stable error taxonomy, circuit breaker, kill switch, maintenance, tenant disable, and provider outage recovery.
- [ ] EXT-070-008 — Implement schema registry/compatibility/drift detection, mapping impact, consumer contract tests, and version retirement.
- [ ] EXT-070-009 — Certify each production integration for security, rotation, volume, limits, failure, reconciliation, monitoring, privacy, cutover, support, and rollback.
- [ ] EXT-070-010 — Prove large-file memory ceilings, backpressure, concurrency fairness, cost limits, archive bomb/XXE/formula injection, and residual cleanup.
- [ ] EXT-GATE-070 — Integrations are governed, scalable, failure-aware, reconcilable, and tenant-safe.

### EXT-080 — Banking and ISO 20022

- [ ] EXT-080-001 — Implement protected bank/account/beneficiary master, masked/encrypted fields, verification, effective dates, limits, signatory seats, and change controls.
- [ ] EXT-080-002 — Implement ISO 20022 registry by exact message version, official source checksum, market/scheme/country/bank/channel/tenant overlay, effective dates, code sets, tests, and certification.
- [ ] EXT-080-003 — Implement payment lifecycle separating approval, generation, transmission, acknowledgement, acceptance, processing, settlement/return, reconciliation, and closure.
- [ ] EXT-080-004 — Implement supported `pain.*`, `camt.*`, and explicitly enabled `pacs.*` adapter contracts without assuming universal versions or roles.
- [ ] EXT-080-005 — Bind immutable approved payment batch to generated artifact/message digest, schema/usage guide, counts/amounts, generator, and approvers.
- [ ] EXT-080-006 — Implement bank-approved mTLS/API/SFTP/PGP/signature/encryption/host-key/network credential controls, rotation, expiry, and revocation.
- [ ] EXT-080-007 — Verify inbound signature/source/schema/time/sequence/replay/duplicate/account/tenant and support partial/out-of-order statuses.
- [ ] EXT-080-008 — Implement request-to-statement-to-ledger reconciliation, deterministic matching, human-reviewed fuzzy suggestions, exceptions, and zero unexplained material differences.
- [ ] EXT-080-009 — Execute bank certification suite for golden/negative/edge/volume/failure/return/recall/reversal/fee/FX/replay/cutoff/holiday cases.
- [ ] EXT-080-010 — Keep actual money movement at certified bank/provider boundary and prevent unsupported banking claims.
- [ ] EXT-GATE-080 — Each enabled bank channel/message is secure, version-exact, bank-accepted, failure-tested, and reconciled.

### EXT-090 — E2E testing and UAT

- [ ] EXT-090-001 — Implement requirement/risk-driven scenario repository covering system, integration, business, operational, migration, security, accessibility, and visual testing.
- [ ] EXT-090-002 — Implement full scenario contract with actors, permissions, versions, fixture, expected states/events/accounting/notifications/memory, evidence, and sign-off.
- [ ] EXT-090-003 — Cover happy, denial, SoD, duplicate, concurrency, partial, timeout, retry, cancel, correction, reversal, boundary, outage, malicious, and recovery paths.
- [ ] EXT-090-004 — Implement UAT entry/exit, representative least-privilege testers, reconciled data, training, known-defect statement, evidence, retest, and domain sign-off.
- [ ] EXT-090-005 — Implement defect severity without date-driven downgrades, complete impact/repro/evidence/workaround/cause/fix/regression/verification.
- [ ] EXT-090-006 — Implement evidence-derived readiness dimensions and non-averageable critical gates.
- [ ] EXT-090-007 — Implement accepted-risk authority, compensating control, owner, expiry, contingency, and visibility.
- [ ] EXT-090-008 — Prove end-to-end Simon and corporate critical scenarios through memory, finance/integration, exception, and reporting.
- [ ] EXT-090-009 — Prove high-risk tenant-isolation, authorization, payment/payroll, migration, and Relay negative scenarios.
- [ ] EXT-090-010 — Obtain accountable business-owner acceptance; no proxy sign-off without formal delegation.
- [ ] EXT-GATE-090 — Technical and business acceptance is traceable, representative, evidence-based, and honest.

### EXT-100 — Cutover and go-live

- [ ] EXT-100-001 — Implement Cutover Command Center state machine, task/dependency/evidence/decision/communication/rollback model and TES surface.
- [ ] EXT-100-002 — Define command roles, occupants/backups, time zones, contacts, decision rights, handoff, and escalation by durable seat.
- [ ] EXT-100-003 — Implement strategy, integrated plan, minute/time-window runbook, contact matrix, communication plan, and decision log.
- [ ] EXT-100-004 — Implement T-90/T-30/T-7/T-1/T0/T+ horizons with tenant-specific dates and dependencies.
- [ ] EXT-100-005 — Classify hard/soft freeze, read-only coexistence, approved dual operation, and deferred migration; block unsafe dual writes.
- [ ] EXT-100-006 — Bind every cutover task to exact version, executor, approver, duration, prerequisites, verification, retry, rollback boundary, and escalation.
- [ ] EXT-100-007 — Implement evidence-driven go/no-go board and `GO/NO_GO/PAUSE/ROLLBACK` decision record.
- [ ] EXT-100-008 — Implement protected idempotent activation, progressive routing/feature/connection changes, safe smoke/isolation/auth/business validation, and cleanup.
- [ ] EXT-100-009 — Implement dynamic last-reversible-point and boundary-specific rollback/forward-recovery plans.
- [ ] EXT-100-010 — Rehearse command center, communications, failure injection, go/no-go, and rollback with final production candidate.
- [ ] EXT-GATE-100 — Go-live cannot occur without current conversion, security, business, external, operational, communication, and recovery evidence.

### EXT-110 — Hypercare and service transition

- [ ] EXT-110-001 — Implement tenant/tier-specific coverage, schedule, intake, severity/SLA, dashboards, control checks, communications, vendors, change policy, and exit plan.
- [ ] EXT-110-002 — Enforce purpose-bound JIT support sessions, step-up, masking, audit, expiry, and no local copies.
- [ ] EXT-110-003 — Implement real-time/command/daily cadence, domain controls, status publication, root cause, permanent fix, and knowledge capture.
- [ ] EXT-110-004 — Implement hypercare metrics for cases, SLO, auth, workflows, integrations, finance/payroll/bank reconciliation, data, Relay, performance, cost, adoption, and knowledge gaps.
- [ ] EXT-110-005 — Implement expedited but complete emergency change and governed configuration/data correction packages.
- [ ] EXT-110-006 — Implement workaround risk/owner/instructions/expiry/communication/permanent-fix lifecycle.
- [ ] EXT-110-007 — Implement exit criteria and evidence for defects, critical cycles, stability, workarounds, monitoring, runbooks, access, DR, renewals, knowledge, and support simulation.
- [ ] EXT-110-008 — Obtain customer and Tenure service-owner transition sign-off by immutable manifest.
- [ ] EXT-110-009 — Transfer unfinished optimization/adoption to a visible success roadmap.
- [ ] EXT-110-010 — Prove on-call/escalation/handoff when a primary seat occupant is unavailable.
- [ ] EXT-GATE-110 — Production is stabilized and operational ownership is demonstrably transferred.

### EXT-120 — Legacy retirement

- [ ] EXT-120-001 — Implement complete legacy asset/dependency/data/owner/cost/contract/license inventory and retirement state machine.
- [ ] EXT-120-002 — Obtain target-process/data/reconciliation/records/legal-hold acceptance before source retirement.
- [ ] EXT-120-003 — Implement archive/export manifest, checksum, index/permissions, retrieval documentation, and isolated restore test.
- [ ] EXT-120-004 — Implement read-only rollback/reference window with monitored access and explicit end.
- [ ] EXT-120-005 — Revoke credentials/accounts/grants/keys/certificates/tunnels/firewall/DNS/jobs/agents/vendor access and prove revocation.
- [ ] EXT-120-006 — Dispose of backups/replicas/logs/caches/snapshots/DR copies under retention/hold and record exceptions.
- [ ] EXT-120-007 — Reconcile all AWS accounts/regions/resources, delete or explicitly retain, then verify residual cost through delayed billing data.
- [ ] EXT-120-008 — Track approved hardware/media sanitization/destruction certificates without directing autonomous physical destruction.
- [ ] EXT-120-009 — Terminate/amend licenses, support, contracts, renewals, and processor relationships.
- [ ] EXT-120-010 — Create non-sensitive retired tombstone and destruction evidence package.
- [ ] EXT-GATE-120 — No legacy system is called retired while access, data, dependency, cost, contract, or evidence remains unexplained.

### EXT-130 — Implementation workbench and live UX

- [ ] EXT-130-001 — Implement all Section 15 workbench surfaces through TES; no one-off internal console visual language.
- [ ] EXT-130-002 — Replace conflicting brown/gold/monospace one-off styling only after repository token/source audit; preserve user function while migrating to forest-green TES.
- [ ] EXT-130-003 — Remove or strictly isolate custom `Operator secret` authentication from production; use Bible-approved Cognito/federated operator identity and support controls.
- [ ] EXT-130-004 — Audit every authorized route/role/state/theme/density/viewport and maintain route-state visual matrix.
- [ ] EXT-130-005 — Implement modern program, landscape, migration, integration, pack, test, cutover, hypercare, and decommission information architecture.
- [ ] EXT-130-006 — Implement governed charts/graphs/timelines/Sankeys/reconciliation visuals with source, freshness, unit, filter, drill, export, and accessible table.
- [ ] EXT-130-007 — Pass light/dark/high-contrast/reduced-motion, keyboard/screen-reader, responsive/zoom/reflow, RTL/localization, and realistic density.
- [ ] EXT-130-008 — Pass loading/empty/error/offline/stale/conflict/denied/archived/purge/high-risk states with safe recovery.
- [ ] EXT-130-009 — Pass accessibility, visual regression, performance, and 30/90/multi-hour comfort evidence required by the Bible.
- [ ] EXT-130-010 — Prevent fake data, hidden failures, misleading status/color, urgency theater, and screenshot-only completion claims.
- [ ] EXT-GATE-130 — Internal and customer implementation work is as coherent, modern, accessible, and fatigue-resistant as the tenant product.

### EXT-140 — Relay implementation copilot

- [ ] EXT-140-001 — Implement permission-aware program/source/environment retrieval with cited versions, freshness, conflict, and scope display.
- [ ] EXT-140-002 — Implement safe multimodal analysis of authorized mappings, workbooks, documents, screenshots, charts, diagrams, and evidence.
- [ ] EXT-140-003 — Implement typed read/draft/propose tools for mappings, rules, tests, risks, runbooks, communications, reconciliation, and knowledge.
- [ ] EXT-140-004 — Route every write through preview, independent authorization, SoD, approval, audit, idempotency, and rollback.
- [ ] EXT-140-005 — Block self-approval, certification, variance acceptance, go/no-go, payroll/payment release, production bypass, and destruction.
- [ ] EXT-140-006 — Defend against prompt injection/data poisoning from source/vendor/customer artifacts and tool output.
- [ ] EXT-140-007 — Evaluate groundedness, mapping accuracy, test quality, permission leakage, tool safety, latency, cost, and abstention.
- [ ] EXT-140-008 — Record model/prompt/tool/index versions and safe evidence for every material recommendation/action.
- [ ] EXT-GATE-140 — Relay accelerates transformation without becoming an authority, source of truth, or privileged bypass.

### EXT-150 — Security, privacy, records, reliability, and FinOps

- [ ] EXT-150-001 — Complete extension threat model and mitigations for migration, transformation, localization, payroll, bank, cutover, support, Relay, and decommission.
- [ ] EXT-150-002 — Enforce tenant/program/environment isolation across IAM/data/files/queues/jobs/cache/search/logs/evidence/Relay/support and prove negative tests.
- [ ] EXT-150-003 — Implement short-lived identity/JIT/step-up, secret/key/certificate rotation, private networking/egress, and no-secret evidence.
- [ ] EXT-150-004 — Implement signed/scanned immutable supply chain for code, IaC, transforms, mappings, config, packs, schemas, and bank artifacts.
- [ ] EXT-150-005 — Implement privacy inventory/purpose/minimization/access-expiry/data-subject/legal-hold/disposition across all extension stores.
- [ ] EXT-150-006 — Implement immutable safe audit/evidence and no raw payloads/identifiers in general telemetry.
- [ ] EXT-150-007 — Implement telemetry, alarms, dashboards, runbooks, incident response, restore, DR, provider outage, and independent cutover communication.
- [ ] EXT-150-008 — Implement cost attribution/estimate/budget/anomaly/concurrency/auto-stop/teardown/orphan/residual verification.
- [ ] EXT-150-009 — Prove restart, duplicate, partial failure, cancellation, restore, region constraint, and no unauthorized cross-region behavior.
- [ ] EXT-150-010 — Map NY SHIELD/conditional DFS and other named controls only after applicability and external-assessment boundaries.
- [ ] EXT-GATE-150 — Extension workloads meet the Bible's security, privacy, evidence, reliability, residency, and cost invariants.

### EXT-160 — Final release and proof

- [ ] EXT-160-001 — Create every required repository deliverable in Section 20 with implemented reality, not empty templates.
- [ ] EXT-160-002 — Run complete code/config/IaC/schema/mapping/pack/integration/migration/security/accessibility/visual/performance/Relay test suite and report every failure/skip.
- [ ] EXT-160-003 — Bind final release, environment, config, schema, mapping, localization/payroll/bank/connector, migration, test, and rollback versions into signed manifests.
- [ ] EXT-160-004 — Prove Simon and corporate fixtures through implementation, migration, UAT, cutover rehearsal, hypercare simulation, and retirement rehearsal.
- [ ] EXT-160-005 — Prove production authority remains behind protected human approval and destructive/payment/payroll/go-live actions remain separately protected.
- [ ] EXT-160-006 — Produce final verification matrix for all Bible, original prompt, and EXT IDs with exact evidence and honest unbuilt/blocked scope.
- [ ] EXT-160-007 — Update ADRs and canonical docs for every material decision; remove stale contradictory instructions.
- [ ] EXT-160-008 — Provide current live/development-only/implemented-disabled/planned/blocked matrix for every module, pack, adapter, environment, and workbench surface.
- [ ] EXT-160-009 — Verify no credentials, raw customer data, bank/payroll identifiers, protected source extracts, or sensitive evidence were committed or exposed.
- [ ] EXT-160-010 — Keep production deployment paused unless the authorized reviewer explicitly approves the exact plan and digest.
- [ ] EXT-GATE-160 — The extension is complete only when every enabled capability works end to end and the verification record states everything that does not.

## 20. Required repository deliverables

Adapt paths to existing conventions while preserving semantics. Do not create empty ceremonial files.

### Architecture and ADRs

- `docs/architecture/tenure-global-erp-implementation-extension.md` — canonical copy of this document.
- `docs/architecture/implementation-control-plane.md`
- `docs/architecture/environment-landscape-and-promotion.md`
- `docs/architecture/universal-accounting-event-and-journal.md`
- `docs/architecture/localization-and-statutory-content-engine.md`
- `docs/architecture/payroll-capability-and-certification.md`
- `docs/architecture/enterprise-data-migration-factory.md`
- `docs/architecture/high-volume-integration-runtime.md`
- `docs/architecture/banking-and-iso20022.md`
- `docs/architecture/cutover-hypercare-service-transition.md`
- `docs/architecture/legacy-decommissioning.md`
- ADRs for staffing modes, universal journal, environment data rules, migration target interface, payroll boundary, ISO 20022 registry, cutover authority, and support access.

### Schemas and contracts

- Versioned schemas for program, workstream, requirement, decision, mapping, migration run, reconciliation, environment manifest, localization pack, payroll capability, bank message profile, test scenario, readiness gate, cutover task, hypercare case, and decommission record.
- Source-adapter SDK, transform-package contract, bulk-load contract, integration envelope, error taxonomy, evidence manifest, and redaction policy.
- Simon and corporate fixtures plus New York and a conflicting second-jurisdiction fixture.
- Golden payroll/bank/localization/migration/test packs for enabled scope.

### Workbenches and operations

- Program, landscape, configuration, migration, integration, localization/payroll/bank, testing/UAT, cutover, hypercare, and decommission TES surfaces.
- Runbooks for extraction, migration failure/restart, reconciliation, cutover/go-no-go/rollback, provider/bank outage, payroll correction, emergency localization change, hypercare, support access, and legacy destruction.
- Dashboards/alarms for environments, migration, integration, pack expiry, payroll/bank safe status, cutover, hypercare, legacy residual resources, security, and cost.

### Evidence

- `docs/implementation/global-erp-extension-ledger.md`
- `docs/implementation/global-erp-extension-final-verification.md`
- Source inventory/profile, mapping lineage, mock/rehearsal manifests, reconciliation sign-offs, UAT acceptance, go/no-go rehearsal, rollback proof, hypercare simulation, decommission rehearsal, visual audit, accessibility/performance/comfort, security, restore/DR, and cost evidence using synthetic/sanitized data.

## 21. Absolute definition of done

This extension is done only when:

- Every enabled tenant implementation is managed from first-class, versioned, tenant-isolated program truth with durable-seat ownership and complete traceability.
- Every environment has controlled purpose, data, access, versions, cost, and destruction; no uncontrolled production clone exists.
- Staffing and accounting models support globally varied structures without weakening durable-seat or financial invariants.
- Localization, payroll, and bank capabilities show exact applicable scope/version/certification and remain unavailable where not proven.
- Migration is repeatable from immutable extracts through mappings, loads, deltas, and signed multi-layer reconciliation with zero unexplained critical variance.
- High-volume integrations are bounded, restartable, idempotent, backpressured, schema-governed, failure-aware, and reconcilable.
- Cutover is rehearsed, evidence-driven, protected, reversible where declared, and followed by measurable stabilization and service transition.
- Legacy systems are retired only after data, dependency, access, contract, cost, and destruction evidence closes.
- Relay accelerates authorized work while never certifying, approving, releasing, or destroying on its own.
- Every implementation surface uses TES and passes the same modernity, accessibility, visualization, performance, and long-session quality gates as the tenant product.
- Every checked requirement has real evidence; all unbuilt, disabled, externally blocked, or uncertified scope is unmistakably stated.

## 22. Prohibited shortcuts

Do not:

- Treat this extension as a documentation-only deliverable.
- Create empty schemas, screens, adapters, tests, or evidence and call a phase complete.
- Copy production data into sandboxes, training, demos, local machines, prompts, or screenshots without the approved exception flow.
- Mark payroll, statutory filing, banking, migration adapter, or jurisdiction capability available from a logo, sample file, parser, or UI.
- Embed current tax/payroll/statutory/bank values in core code without source/effective date/version/test/approval.
- Use SAP ACDOCA, Oracle FBDI/HDL, Workday EIB/business objects, or a bank's XML as Tenure's canonical model.
- Add MuleSoft, Workday Studio, SAP middleware, or another external runtime as a mandatory Tenure backend dependency.
- Load unbounded files into memory, log raw records, retry permanent failures forever, or redrive without duplicate/impact controls.
- Accept unexplained authority, money, payroll, payment, legal-hold, or required-record variance.
- Lower defect severity, widen tolerance, waive security, or mark readiness green to preserve a go-live date.
- Let Relay approve its own recommendation, certify legal/payroll/bank content, release money/payroll, decide go-live, or purge legacy data.
- Call a source retired while access, backups, integrations, contracts, licenses, retained data, or cost remain unexplained.
- Claim a literal zero tenant/project cost while billable resources or bytes remain.
- Keep the current System Studio's operator-secret authentication or conflicting one-off design in production merely because it already exists.

## 23. Authoritative references and freshness rule

These sources establish current architectural inputs; they do not replace tenant-specific professional review or bank/provider implementation guides:

- [New York Attorney General — SHIELD Act](https://ag.ny.gov/resources/organizations/data-breach-reporting/shield-act)
- [New York DFS — Cybersecurity Resource Center and 23 NYCRR Part 500](https://www.dfs.ny.gov/cybersecurity)
- [New York Tax — Form NYS-45 filing requirements](https://www.tax.ny.gov/bus/wt/filing_requirements.htm)
- [New York Paid Family Leave — employer responsibilities](https://paidfamilyleave.ny.gov/employers)
- [ISO 20022 — message definitions catalogue](https://www.iso20022.org/iso-20022-message-definitions)
- [SAP — S/4HANA Migration Cockpit](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/29193bf0ebdd4583930b2176cb993268/2f0dbe4111214bcf9b2d57eca26f0525.html)
- [Oracle — HCM Data Loader](https://docs.oracle.com/en/cloud/saas/tutorial-hdl-load-files)
- [Workday — Enterprise Interface Builder documentation](https://developer.workday.com/documentation/GUID-fa252f19-a2d0-449c-9313-705f3e14196b-enHYPHENus/LoadDatatoExtendBusinessObjectsUsingEIBs)
- [AWS Step Functions — Distributed Map](https://docs.aws.amazon.com/step-functions/latest/dg/state-map-distributed.html)
- [Amazon S3 — multipart upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)
- [AWS DMS — data validation](https://docs.aws.amazon.com/dms/latest/userguide/CHAP_Validating.html)
- [AWS DataSync — transfer and integrity validation](https://docs.aws.amazon.com/datasync/latest/userguide/what-is-datasync.html)

Before implementing a time-sensitive law, rate, form, schema, service feature, vendor interface, or bank message, retrieve the current primary source, preserve its version/checksum/date, and assess differences. A link in this document is not proof that its content remains unchanged.

## 24. Final extension contract

Tenure's global engine is not complete when it can merely provision an empty tenant and display many modules. It is complete only when Tenure can take a real organization from fragmented systems and undocumented practice to a configured, migrated, reconciled, accepted, live, supportable, and eventually decommissioned operating environment—without losing authority, evidence, history, or the reason behind the work.

The implementation itself must enrich institutional memory. When consultants, operators, administrators, process owners, or project leaders change, the next occupant must inherit governed decisions, mappings, exceptions, controls, runbooks, and evidence attached to the enduring tenant structures and seats. That is how the implementation machinery reinforces Tenure's moat instead of existing outside it.
