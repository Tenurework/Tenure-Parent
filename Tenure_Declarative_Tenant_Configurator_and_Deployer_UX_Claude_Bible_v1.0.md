# Tenure Declarative Tenant Configurator, Decision Graph, and Deployer Experience Bible

**Version:** 1.0  
**Date:** 2026-08-04  
**Status:** Binding architecture and Claude Code execution specification  
**Repository target:** `Tenure-Parent` complete platform monorepo  
**Product surface:** Tenure System Studio  
**Infrastructure boundary:** Tenure-owned AWS only  

---

## BEGIN CLAUDE CODE MASTER PROMPT

You are the principal product-platform engineer, enterprise implementation architect, configuration-language designer, UX systems architect, authorization engineer, distributed-systems engineer, test architect, and hands-on implementation owner for the **Tenure Declarative Tenant Configurator**.

Your task is to build the production system that allows Tenure operators to compose, validate, price, approve, provision, revise, upgrade, suspend, hibernate, restore, migrate, and retire globally different Tenure tenant systems without customer-specific source forks and without direct browser access to AWS credentials.

This is not a request for a hard-coded onboarding wizard. It is not complete when pages, mockups, JSON files, interfaces, or checkboxes exist. The result must be a schema-driven configuration compiler and a professional operator workbench integrated with the actual Tenure desired-state engine, authorization system, approval service, AWS orchestration, evidence ledger, and tenant lifecycle.

### 0. Constitutional relationship

Read completely before changing this scope:

1. Repository instructions: `CLAUDE.md`, `AGENTS.md`, security, contribution, deployment, and test rules.
2. `Tenure_Claude_Code_Global_Engine_Constitution_and_Document_Graph_v1.0.md` or later.
3. `Tenure_Global_System_Architecture_Bible_v1.1.md` or later.
4. `Tenure_Claude_Code_Unified_Global_Engine_Master_Prompt_v3.0.md` or later.
5. `Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md` or later.
6. `Tenure_Global_ERP_Implementation_Extension_v1.0.md` or later.
7. `Tenure_ERP_Archetype_and_Specialized_System_Pack_Factory_Claude_Bible_v1.0.md` or later.
8. `Tenure_Global_Integration_Ecosystem_and_Connector_Certification_Claude_Bible_v1.0.md` or later.
9. `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md` or later.
10. The current People, Finance, Planning and Operations Cloud domain Bibles.
11. The current Tenant Experience System and Enterprise Analytics/Visualization Bibles.
12. Accepted ADRs and the canonical global-engine execution ledger.

This document owns the configuration language, decision graph, generated operator UI, draft/collaboration model, save/resume/back/forward behavior, validation and invalidation semantics, preview and approval UX, and handoff from approved tenant intent to deployment. Other domain Bibles own the meaning of their domain objects and rules. This runtime renders those domain schemas; it does not invent them.

If two documents conflict, preserve the stricter security, tenant-isolation, accounting, legal, data-loss, approval, and evidence rule. Stop only the conflicting scope, open a versioned architecture decision, and continue independent work.

### 1. Binding product definition

System Studio is the authoritative normal operator interface between Tenure's organizational intent and Tenure-owned AWS actual state. Configuration in the browser creates a **draft intent**. It never grants the browser AWS credentials and never causes unrestricted or unreviewed cloud mutations.

The authoritative chain is:

```text
Operator session
→ configuration workspace
→ versioned draft events
→ deterministic effective configuration
→ validated configuration graph
→ generated application/data/integration/AWS outputs
→ impact, security, cost, migration and downtime plan
→ digest-bound approvals
→ immutable release/change transaction
→ least-privilege backend orchestration
→ verification and reconciliation
→ evidence and actual-state projection
```

“One click” means one final protected launch after every applicable dependency, validation, preview, sign-off, and readiness gate passes. It never means a single unvalidated form submission.

### 2. Non-negotiable invariants

- One Tenure Parent code line. No Simon branch, customer fork, tenant-specific repository, or `if tenant == ...` business behavior.
- All Tenure application and tenant runtime infrastructure is operated in Tenure-owned AWS Organizations/accounts. External systems may connect through governed integrations.
- Every visible question and option is generated from a versioned, signed, testable schema or approved extension package.
- Every effective value has provenance, scope, version, source layer, author, reason, effective time, expiry where applicable, approval state, and affected outputs.
- Every decision can be reconstructed as of a historical instant.
- Every change is a draft until explicitly promoted through the applicable change policy.
- Back, forward, autosave, save-and-exit, resume, compare, comment, assign, validate, preview, and abandon are first-class behaviors.
- An upstream answer change never silently deletes downstream answers. It preserves history and marks affected values stale, conflicted, inapplicable, or superseded with an explanation.
- Hidden fields are not automatically cleared. Visibility, applicability, validity, and persistence are distinct concepts.
- Client-side visibility is not authorization. The server re-evaluates every read and command under tenant, environment, actor, seat, action, resource, relationship, time, and policy context.
- Domain schemas cannot execute arbitrary code. All expressions run in a bounded, deterministic, side-effect-free expression language.
- No secret value appears in a schema, draft event, URL, log, analytics event, audit payload, preview, export, or evidence artifact.
- Production and destructive approvals bind the exact canonical digest. Any material change invalidates prior approvals.
- The UI must always distinguish desired, planned, applying, actual, drifted, failed, rolling back, and verified states.
- The configurator may expose only capabilities whose lifecycle and certification state is truthful for the selected region, jurisdiction, legal entity, industry, deployment class, entitlement, and provider.

## 3. Operator personas and authority

Implement explicit scoped personas; do not collapse them into a single super-admin flag.

| Persona | Primary responsibility | Prohibited by default |
|---|---|---|
| Platform owner | Global defaults, platform releases, pack admission | Self-approve own production/destructive change |
| Tenant solution architect | Tenant blueprint and module composition | AWS break-glass, legal certification |
| Industry specialist | Industry pack decisions and operating-model fit | Cross-tenant data, security-policy override |
| Localization specialist | Jurisdiction and statutory pack applicability | Certify law or filing without authorized evidence |
| Identity architect | Cognito, federation, SCIM, session policies | Finance/payment approval |
| Security reviewer | Controls, threat findings, residency, exceptions | Author and approve same protected change |
| Data/migration lead | Sources, mappings, rehearsal, reconciliation | Approve unexplained critical variance |
| Integration lead | Connectors, mappings, credentials references, certification | Read credential values without exceptional authority |
| Finance/payments lead | Ledger, banking, Stripe/payment capability | Enable unapproved merchant/payment scope |
| FinOps reviewer | Cost model, budget, anomaly, placement economics | Weaken security/residency to reduce cost silently |
| Release manager | Freeze, wave, canary, rollout, rollback | Change configuration after approvals without invalidation |
| Approver | Digest-bound decision for assigned risk domain | Edit the artifact being approved during approval |
| Auditor | Read historical decisions and evidence | Mutate configuration or actual state |
| Support operator | Scoped diagnostics and approved runbooks | Browse tenant business data by default |

Use durable Tenure seats for these responsibilities so decision memory survives staff rotation.

## 4. Information architecture

System Studio must contain a consistent task-oriented shell:

```text
Global command/search
Tenant/environment context
Breadcrumb and object identity
Primary workspace
Inspector/evidence drawer
Activity/collaboration panel
Persistent draft/change status
Contextual actions
```

Required top-level surfaces:

1. **Home** — assigned work, blocked decisions, expiring credentials/packs, failed changes, drift, incidents, cost anomalies.
2. **Tenant Fleet** — live lifecycle and health across all tenants/environments.
3. **New Tenant** — blueprint selection and declarative implementation interview.
4. **Configuration Studio** — domain graph, fields, provenance, conflicts, inherited values, overrides.
5. **Organization Architect** — legal entities, organization units, cost centers, positions, durable seats, reporting and matrix relationships.
6. **Module Composer** — ERP and specialized system packs, dependencies, entitlements, modes, compatibility.
7. **Deployment Architect** — Tenure AWS placement, regions, cells/accounts, data residency, capacity, recovery, network and domains.
8. **Identity Studio** — Cognito, SSO, OIDC/SAML, SCIM, MFA, session, support and emergency-access policies.
9. **Data and Migration Studio** — source inventory, data ownership, mappings, quality, rehearsal, reconciliation and retirement.
10. **Integration Studio** — connector instances, scopes, mappings, events, schedules, queues, credentials references, health and reconciliation.
11. **Payments and Treasury** — imported from the dedicated payments Bible and hidden unless applicable.
12. **Relay Studio** — Bedrock model policy, RAG sources, tools, guardrails, budgets and evaluations.
13. **Security Center** — control posture, exceptions, findings, residency, evidence and threat model.
14. **FinOps Center** — estimates, actual costs, forecasts, allocation, residual cost and optimization.
15. **Change Center** — drafts, diffs, impact, approvals, deployment, rollback, reconciliation and history.
16. **Operations Center** — health, SLOs, alarms, logs/traces, jobs, incidents and runbooks.
17. **Lifecycle Center** — launch, upgrade, suspend, hibernate, restore, migrate, export, offboard and purge.

The shell must preserve active tenant, environment, draft, comparison baseline, filter/view, scroll position, expanded nodes and inspector context during navigation when safe. A context switch that would discard unsaved local input must warn and offer save, discard, or stay.

## 5. Tenant-creation journey

The tenant journey is generated from configuration graph state, not a fixed step count. The default experience groups decisions into these stages:

| Stage | Purpose | Examples of generated domains |
|---|---|---|
| 0. Intake | Why and what is being deployed | sponsor, business outcomes, deadlines, source systems, constraints |
| 1. Tenant identity | Contractual and display identity | tenant key, names, brand, ownership, support tier |
| 2. Legal and geography | Legal entities and jurisdiction | entity type, registrations, countries, currencies, languages, residency |
| 3. Organization model | Structure and durable authority | divisions, departments, sites, cost centers, positions, seats, delegations |
| 4. Operating archetype | Scale and system-of-record model | enterprise/SMB, centralized/matrix, Tenure-primary/coexistence/two-tier |
| 5. ERP composition | Business capabilities | finance, HCM, CRM, SCM, manufacturing, projects, commerce, GRC |
| 6. Industry packs | Specialized operating logic | manufacturing, healthcare, public sector, construction, education, nonprofit |
| 7. Identity and access | Authentication and lifecycle | Cognito, SSO, SCIM, MFA, policy, emergency access |
| 8. Data and migration | Sources and authoritative domains | import, mapping, quality, retention, legal hold, cutover |
| 9. Integrations | External systems and protocols | productivity, bank, payment, payroll, tax, PLM/MES, EDI, API, files |
| 10. Infrastructure | Tenure AWS topology | region, cell/account, isolation, capacity, DR, WAF, domain |
| 11. Relay | AI and organizational memory | models, sources, tools, scopes, budgets, retention |
| 12. Security/compliance | Controls and exceptions | encryption, logging, residency, policies, evidence, approvals |
| 13. Operations/FinOps | Support and economics | SLO, monitoring, support, budget, cost center, hibernation |
| 14. Migration/readiness | Rehearsal and acceptance | tests, training, reconciliation, cutover, rollback, hypercare |
| 15. Review/launch | Immutable final plan | complete diff, cost, risk, approvals, release, activate |

Stages appear, disappear, split, or gain sub-stages from graph applicability. The left rail displays `Not started`, `In progress`, `Needs attention`, `Blocked`, `Ready for review`, `Approved`, `Locked`, and `Not applicable`; it never shows a false percentage based only on visited pages.

## 6. Deployer experience requirements

### 6.1 Persistent command bar

Every configuration workspace provides:

- `Save` with last persisted revision and sync/error state.
- `Save and exit` returning to the tenant/change summary.
- `Back` and `Next` based on the current applicable graph, not browser history alone.
- `Undo` and `Redo` for authorized uncommitted local actions.
- `Compare` against inherited baseline, prior release, another draft, or actual state.
- `Validate` for local, domain, cross-domain and external readiness checks.
- `Preview impact` for application, data, security, integration, AWS, cost, downtime, migration and approval consequences.
- `Request input` assigning a question or section to another accountable seat.
- `Comment` without changing the value.
- `View history` for value, source, reason, approval and effective period.
- `Abandon draft` as a recoverable archive operation, not silent deletion.
- `Submit for review` only when required blocking validations pass.

Keyboard shortcuts must be documented, discoverable, remappable where practical, and must not conflict with assistive technology.

### 6.2 Progressive disclosure

- Show the fewest questions necessary to make the next correct decision.
- Keep a visible “Why am I seeing this?” explanation sourced from the rule trace.
- Provide “What will this affect?” before a high-consequence choice.
- Group advanced configuration without hiding mandatory risk or cost.
- Allow expert bulk/table editing only where the same validation, provenance, authorization and approval rules remain enforced.
- Offer templates as explicit starting points; never silently infer legal, tax, banking, payroll, security, residency or destructive choices.

### 6.3 Completion and attention

Completion is calculated from applicable requirements and evidence:

```text
sectionReady =
  all applicable required answers valid
  AND no blocking conflicts
  AND all mandatory evidence present
  AND all external dependencies either satisfied or explicitly BLOCKED_EXTERNAL
  AND required approvals current
```

Status cannot be manually painted green. Readiness derives from canonical state.

## 7. Canonical configuration objects

Implement at minimum:

- `SchemaPackage`
- `SchemaPackageVersion`
- `ConfigurationDomainSchema`
- `ConfigurationSectionSchema`
- `ConfigurationQuestionSchema`
- `ConfigurationUISchema`
- `ConfigurationValue`
- `ValueProvenance`
- `ValueHistory`
- `OptionSource`
- `RuleDefinition`
- `RuleEvaluation`
- `DependencyEdge`
- `GraphSnapshot`
- `ConfigurationWorkspace`
- `DraftBranch`
- `DraftRevision`
- `DraftEvent`
- `Assignment`
- `DiscussionThread`
- `ValidationDefinition`
- `ValidationResult`
- `ExternalCheck`
- `Conflict`
- `ImpactDefinition`
- `ImpactResult`
- `OutputMapping`
- `GeneratedArtifact`
- `ConfigurationDiff`
- `ApprovalPolicy`
- `ApprovalRequest`
- `ApprovalDecision`
- `ChangeTransaction`
- `EffectiveManifest`
- `DeploymentPlan`
- `ActualStateObservation`
- `DriftFinding`
- `EvidenceArtifact`

Every object is tenant/environment scoped where applicable, versioned, auditable, and permission checked.

## 8. Schema package contract

A schema package declares:

```yaml
apiVersion: tenure.io/config/v1
kind: SchemaPackage
metadata:
  id: manufacturing-core
  version: 1.4.0
  publisher: tenure
  lifecycle: CERTIFIED
  digest: sha256:...
  effectiveFrom: 2026-08-04T00:00:00Z
compatibility:
  engine: ">=1.8 <2.0"
  requires:
    - package: finance-core
      version: ">=2.1"
  conflicts: []
scope:
  tenantTypes: [COMMERCIAL, PUBLIC]
  industries: [DISCRETE_MANUFACTURING]
  jurisdictions: [US]
schemas: []
tests: []
signatures: []
```

The package registry must validate signature, publisher authority, semantic version, dependency closure, cycle freedom, engine compatibility, schema dialect, rule safety, UI component allowlist, translation completeness, migration availability and test evidence before admission.

## 9. Question and UI schema

Each question schema includes stable identity and behavior. Example:

```yaml
id: payments.merchant_model
valueSchema:
  type: string
  enum: [TENANT_LEGAL_ENTITY, EXTERNAL_MERCHANT, NONE]
ui:
  control: segmented-select
  labelKey: payments.merchantModel.label
  descriptionKey: payments.merchantModel.description
  helpKey: payments.merchantModel.help
  order: 120
  density: comfortable
  confirmation: HIGH_CONSEQUENCE
rules:
  visibleWhen: "capability('payments.collections').selected"
  requiredWhen: "capability('payments.collections').selected"
  enabledWhen: "legalEntities.count > 0"
  defaultWhen:
    - when: "tenant.type != 'PLATFORM_MARKETPLACE'"
      value: TENANT_LEGAL_ENTITY
  validateWhen:
    - rule: "value != 'NONE' || !capability('payments.collections').selected"
      code: PAYMENTS_MERCHANT_REQUIRED
  approveWhen:
    - when: "environment == 'production'"
      policy: payments-production-enable
  invalidateWhen:
    - "legalEntities[*].country"
    - "payments.provider"
outputs:
  - target: tenantManifest.payments.merchantModel
impact:
  - resolver: payments-capability-impact
```

Support schema semantics:

```text
visibleWhen      whether the control is rendered
applicableWhen   whether the decision applies to effective configuration
enabledWhen      whether the current actor may interact now
requiredWhen     whether a valid value is mandatory
defaultWhen      suggested or automatic default with provenance
deriveFrom       deterministic computed value
optionsFrom      static, registry, query or external-check options
validateWhen     synchronous and asynchronous validation
invalidateWhen   explicit upstream dependencies
approveWhen      approval policy selection
lockWhen         edit lock conditions
redactWhen       display/export redaction
mapsTo           generated output targets
affects          impact categories and downstream nodes
explainWith      explanation template and rule trace
```

Use JSON Schema 2020-12 semantics for structural validation where feasible, while keeping Tenure UI, policy, provenance, impact, and authorization vocabularies in namespaced extensions. Never overload JSON Schema annotations as executable authorization.

## 10. Safe expression language

Implement a deterministic expression DSL or proven bounded evaluator with:

- literals, typed comparisons, boolean algebra and null-safe access;
- collection `any`, `all`, `none`, `count`, `contains` and safe projections;
- references only to declared configuration paths and approved context functions;
- explicit time and effective-date input, never implicit wall-clock reads during replay;
- no network, filesystem, reflection, dynamic import, loops, mutation, randomness, or arbitrary code;
- evaluation budget, maximum depth, maximum collection size and timeout;
- static dependency extraction;
- type checking before package publication;
- deterministic canonical output and rule trace;
- property-based tests and denial tests.

Approved context functions may include `selected`, `capability`, `jurisdiction`, `entitled`, `certified`, `hasRole`, `hasEvidence`, `externalStatus`, `costEstimate`, and `actualState`, but each must have an explicit data source and purity classification.

## 11. Configuration dependency graph

Represent configuration as a directed graph:

- Nodes: questions, derived values, validations, sections, capabilities, artifacts, approvals and external checks.
- Edges: visibility, applicability, requirement, derivation, options, validation, invalidation, output, impact, approval and lock dependencies.
- Package dependencies are compiled into the same global graph.

Compilation must:

1. Resolve package versions and namespaces.
2. Validate unique stable identifiers.
3. Type-check every reference.
4. Extract static dependencies.
5. Reject forbidden or unbounded expressions.
6. Detect cycles and produce a human-readable minimal cycle path.
7. Permit explicit monotonic fixed-point groups only through a separately reviewed contract.
8. Topologically order evaluation groups.
9. Produce a signed `GraphSnapshot` with schema/package digests.
10. Generate client-safe and server-authoritative projections from the same snapshot.

The browser may evaluate client-safe presentation rules for responsiveness, but the server remains authoritative and returns the evaluated state and trace.

## 12. Field state machine

Every field has a machine state independent of whether it has a stored value.

Primary states:

```text
UNSEEN → AVAILABLE → IN_PROGRESS → ANSWERED | INFERRED
→ VALIDATING → VALIDATED → CONFIRMED → APPROVED → LOCKED
```

Exceptional/orthogonal states:

```text
INAPPLICABLE
HIDDEN_APPLICABLE
BLOCKED
STALE
CONFLICTED
REQUIRES_REVIEW
EXTERNALLY_WAITING
SUPERSEDED
REDACTED
ERROR
```

State transitions require recorded cause and actor/system identity. The UI must not use color alone; display icon, label, explanation and remediation.

### Upstream change algorithm

When an upstream value changes:

1. Persist the new draft event with expected revision.
2. Identify transitive dependents from the compiled graph.
3. Re-evaluate in deterministic topological order.
4. Recalculate visibility, applicability, requirement, options and derived values.
5. Preserve prior values and provenance.
6. Mark incompatible stored values `STALE` or `CONFLICTED`; never silently clear them.
7. Mark newly inapplicable values inactive in the effective manifest but historically retained.
8. Invalidate affected validations, previews, generated artifacts and approvals.
9. Recompute risk and required reviewers.
10. Return a structured consequence set to the UI.
11. Require explicit resolution for material conflicts.
12. Rebuild the signed manifest only after graph consistency is restored.

## 13. Defaults, inference and Relay proposals

Distinguish:

- `INHERITED` — comes from a higher configuration layer.
- `DEFAULTED` — deterministic package default.
- `DERIVED` — computed from other values.
- `IMPORTED` — sourced through a migration/integration artifact.
- `PROPOSED_BY_RELAY` — AI suggestion awaiting human action.
- `EXPLICIT` — entered or confirmed by an authorized actor.
- `EXCEPTION` — approved deviation from inherited policy.

The UI displays the source next to the value and supports “Use inherited value,” “Override,” and “Revert override.” Relay may extract and propose values from approved documents, but must show citations, confidence, ambiguity, conflicts and affected decisions. Relay cannot silently confirm, approve or launch.

## 14. Cascading option sources

Options may come from:

1. Static package enumeration.
2. Tenure registry query.
3. Tenant configuration query.
4. Authorized read-only AWS truth.
5. Governed connector/provider discovery.
6. Approved external evidence.

Every option source defines cache policy, freshness, pagination/search, dependency keys, authorization, rate limits, timeout, fallback behavior, empty/error state, and evidence. Previously chosen options that disappear are retained as invalid historical values until resolved.

Example cascade:

```text
Operating countries
→ legal entity types
→ supported Tenure regions/residency
→ applicable statutory packs
→ eligible payroll/payment/bank providers
→ available capabilities
→ required onboarding evidence
→ supported settlement currencies/methods
```

No country/provider list is hard-coded into a React component.

## 15. Draft, branch, save and recovery model

### 15.1 Event-sourced drafts

Persist semantic draft events such as `VALUE_SET`, `VALUE_REVERTED`, `OVERRIDE_CREATED`, `SECTION_ASSIGNED`, `COMMENT_ADDED`, `CONFLICT_RESOLVED`, `EVIDENCE_ATTACHED`, `VALIDATION_REQUESTED`, and `REVIEW_SUBMITTED`.

Each event includes workspace, branch, tenant/environment, revision, actor/person/seat, device/session, command id, causal revision, schema/graph version, timestamp, reason where required, redaction class and affected paths.

### 15.2 Autosave

- Debounce local edits but persist on navigation, blur for high-value controls, explicit Save and session termination where possible.
- Display `Saving`, `Saved at`, `Offline/local pending`, `Conflict`, and `Save failed` truthfully.
- Retry only idempotent writes with bounded backoff.
- Maintain encrypted local recovery only for non-secret permitted values with expiry and user control.
- Never claim saved until the server returns the committed revision.

### 15.3 Optimistic concurrency

Commands include `expectedRevision`. On mismatch:

- auto-merge non-overlapping semantic paths;
- present a three-way comparison for overlapping changes;
- never last-write-wins over money, authority, residency, identity, security, deletion or production state;
- preserve both authors' work and comments;
- record conflict resolution as an event.

### 15.4 Draft branches

Support named alternatives for scenario planning. A branch records its base revision, purpose, owner, expiry, changed domains, cost/risk summary and merge state. Merging is semantic and graph-aware. Production promotion accepts one resolved lineage, not a client-side JSON merge.

## 16. Back, forward and navigation semantics

`Back` returns to the prior applicable section and preserves state. `Next` selects the next highest-priority applicable unresolved section, while experts may navigate directly through the graph map.

Browser back/forward must restore a stable route containing tenant, environment, workspace, branch, section and selected object identifiers. Do not put values, secrets or sensitive names in URLs.

If graph changes make the current route inapplicable, display the reason and move the user to the nearest valid parent after preserving context. Deep links enforce authorization and show a safe not-found/forbidden state without leaking existence.

## 17. Validation system

Validation levels:

| Level | Examples | Execution |
|---|---|---|
| Field | type, range, format | immediate client hint + server authority |
| Section | internal consistency | server after edits or explicit validate |
| Cross-domain | ledger currency vs legal entity; module dependency | graph evaluation service |
| External | domain ownership, SSO metadata, provider capability | bounded asynchronous check |
| Infrastructure | region quota, service availability, name collision | read-only AWS truth/planner |
| Operational | backup, support, monitoring, runbook | readiness engine |
| Security/compliance | residency, SoD, encryption, exception | policy/control engine |
| Migration | mapping, quality, reconciliation, cutover | implementation control plane |

Validation results include stable code, severity, blocking class, affected paths, explanation, evidence/source, remediation, owner, freshness, expiry and override policy. Warnings cannot substitute for hard failures. Overrides require an explicit exception object and approval where permitted.

## 18. Impact and preview compiler

Before review, compile a structured plan containing:

- application behavior changes;
- canonical schema and migration changes;
- records/workflows/reports affected;
- roles, permissions, sessions and identity effects;
- connector/provider effects;
- payment, ledger, tax, payroll and banking effects;
- data movement, residency, retention and deletion;
- AWS resources create/update/replace/delete/retain;
- security-control and threat-model effects;
- capacity, SLO, RPO/RTO and operational effects;
- estimated one-time and recurring cost with assumptions/range;
- downtime, freeze, migration and cutover requirements;
- irreversible or weakly reversible consequences;
- approval policies and accountable reviewers;
- prechecks, tests, canary, rollback/forward-recovery and verification.

The preview presents summaries first and supports drill-through to exact paths and generated artifacts. Destructive actions require a dedicated red treatment that is semantic and accessible, typed confirmation using a stable target label, step-up authentication, two-person approval where required, waiting periods when policy requires, and a separately scheduled execution.

## 19. Approval experience

An approval request binds:

- canonical manifest digest;
- graph/package/release/schema versions;
- exact diff and risk classification;
- cost and operational impact version;
- target tenant/environment;
- requested action;
- approver policy and separation-of-duties evaluation;
- expiry;
- conditions/qualifications;
- evidence set.

Approvers see a decision-focused view: what changed, why, who authored it, inherited versus overridden values, risk hotspots, failed/warned checks, cost delta, migration/downtime, rollback limits and outstanding external dependencies. Reject and request-change require reason. Approval is invalidated by material digest changes or expired evidence.

## 20. Change and deployment handoff

After approvals:

1. Freeze the approved effective manifest.
2. Create an immutable `ChangeTransaction`.
3. Generate application configuration, data migration, integration, identity, Relay and AWS plans.
4. Revalidate freshness, quotas, policy and approval digest.
5. Acquire narrow execution leases and short-lived AWS roles.
6. Execute idempotent dependency-ordered workflows.
7. Pause on protected external/human steps.
8. Retry safe transient failures; compensate or roll back where defined.
9. Verify business, isolation, security, data, integration, financial, accessibility and operational outcomes.
10. Compare actual with desired state.
11. Record evidence and surface residual drift/cost.
12. Activate only after mandatory gates.

The configurator does not embed AWS SDK mutations in UI handlers. It calls typed backend commands.

## 21. Actual-state and drift UX

For every generated artifact/resource, show:

- desired value/version;
- planned action;
- actual observed value/version and freshness;
- deployment/workflow state;
- drift classification;
- last healthy verification;
- responsible stack/service/module;
- cost and alarm context where available;
- safe reconciliation actions.

Never show a green “Deployed” badge solely because a workflow ended. Require verification. Unknown actual state is `UNKNOWN`, not assumed healthy.

## 22. Design system and visual language

Use the Tenure Experience System, not raw vendor defaults.

- Dark forest green is the protected action/brand accent, not a universal fill.
- Light and dark themes use cool, soft, low-glare neutral surfaces.
- Comfortable and compact density modes preserve hierarchy and accessibility.
- Typography prioritizes long-session legibility; monospace is limited to identifiers, code, digests and machine data.
- Status colors have sufficient contrast and redundant icon/text meaning.
- Field labels remain visible; placeholders are not labels.
- Help is concise in context with expandable deep explanation.
- Forms use stable alignment, readable widths, clear grouping and minimal layout shift as conditions change.
- Conditional sections animate only subtly and respect reduced motion.
- Tables support keyboard navigation, pinned columns, resize/reorder, search/filter, saved views, grouping, export-scope preview and permissions.
- Graph views provide a list/table alternative and never rely on an inaccessible canvas.
- Loading uses skeletons only when structure is known; long operations show named steps and live state.
- Empty, error, forbidden, blocked, stale, offline and partially loaded states are intentionally designed.

## 23. Responsive, accessibility and localization requirements

- Meet WCAG 2.2 AA for all required routes and interactions.
- Complete keyboard operation with visible focus and logical order.
- Correct names, roles, states, descriptions and error association.
- Screen-reader announcements for save, validation, dynamic section, conflict and deployment updates without excessive noise.
- Zoom/reflow at 200% and 400%; no loss of critical action.
- Touch targets and mobile/tablet layouts for review and light configuration; dense architecture work may use an explicit desktop-optimized mode with accessible alternatives.
- Locale-aware date/time/number/currency/address/name/phone entry and display.
- Time zone and effective instant visible for scheduled changes.
- Translation keys in schemas; no domain UI literals in components.
- RTL layout verification.
- Never machine-translate legal/statutory/certified text into an enabled state without review.

## 24. Performance and scale

The system must handle millions of possible effective values without rendering or evaluating everything at once.

- Compile graph snapshots ahead of interactive use.
- Evaluate only affected subgraphs after a change.
- Virtualize long tables/trees and paginate large registries.
- Use server-side search and stable cursors.
- Cache only by complete tenant/environment/workspace/branch/graph/actor-policy context.
- Bound expression and external-check workloads.
- Use asynchronous jobs for expensive preview compilation with resumable status.
- Define and test budgets for initial workspace load, field feedback, autosave acknowledgement, local subgraph evaluation, search, comparison and preview.
- Degrade safely if Relay, search, cost estimate or noncritical external providers are unavailable.
- Core draft editing and history must remain available during noncritical analytics/AI outages.

## 25. Security and privacy

- Cognito/federated operator sign-in, MFA and secure BFF sessions.
- Step-up authentication for protected actions.
- Central action-resource-scope authorization, including field/section/domain/change/evidence access.
- CSRF, XSS, injection, SSRF, confused-deputy and IDOR protections.
- Strict tenant/environment/workspace context derived server-side.
- Encrypted data and tenant-aware KMS context.
- Schema package signing and supply-chain verification.
- Secret references only; sensitive values enter approved secret-capture surfaces and go directly to Secrets Manager/provider token exchange.
- Logs/audit/telemetry redact values according to classification.
- Attachment malware/content scanning and access expiry.
- Rate limits, quotas, idempotency and abuse controls.
- Immutable/high-integrity audit for approvals, protected changes and evidence.
- Break-glass is time-limited, MFA-protected, reason-bound, separately alerted and audited; it is not a normal configurator shortcut.

## 26. AWS implementation mapping

Use repository evidence to select exact services, but the architecture should normally map as follows:

| Concern | AWS-aligned implementation |
|---|---|
| Operator identity | Cognito/federation, BFF session store, KMS |
| Draft events and canonical state | Aurora PostgreSQL with strict tenant/environment scoping; outbox |
| Fast revision/idempotency/session state | DynamoDB where justified |
| Package/artifact storage | S3 versioning/Object Lock where applicable, signed metadata |
| Asynchronous graph/preview/deploy | Step Functions + Lambda/ECS workers according to workload |
| Event contracts | EventBridge with Tenure schema registry and versioning |
| Configuration rollout | Tenure manifest engine; AWS AppConfig may distribute runtime-safe configuration, never replace Tenure governance |
| Secrets | Secrets Manager with rotation and scoped references |
| Infrastructure plan/apply | Repository-owned CloudFormation/CDK/Terraform choice with change sets, plan evidence and drift detection |
| Observability | CloudWatch/X-Ray/OpenTelemetry plus centralized security/audit accounts |
| Search | OpenSearch only through tenant-isolated indexes/aliases and authorization-aware queries |

Do not mechanically add services. Record why each service is required, its isolation boundary, quotas, cost, failure mode and lifecycle.

## 27. Canonical API commands and events

Minimum commands:

```text
CreateConfigurationWorkspace
CreateDraftBranch
SetConfigurationValue
RevertConfigurationOverride
ConfirmInferredValue
AssignConfigurationSection
AttachConfigurationEvidence
ResolveConfigurationConflict
ValidateConfigurationScope
CompileConfigurationPreview
SubmitConfigurationReview
RecordApprovalDecision
FreezeEffectiveManifest
CreateChangeTransaction
StartApprovedChange
CancelPendingChange
RequestRollback
ArchiveDraft
```

Minimum events:

```text
ConfigurationWorkspaceCreated
ConfigurationValueChanged
ConfigurationSubgraphInvalidated
ConfigurationConflictDetected
ConfigurationValidationCompleted
ConfigurationPreviewCompiled
ConfigurationReviewSubmitted
ConfigurationApprovalRecorded
ConfigurationApprovalInvalidated
EffectiveManifestFrozen
ChangeTransactionCreated
ChangeExecutionStarted
ChangeStepFailed
ChangeRolledBack
ChangeVerified
ConfigurationDriftDetected
```

Commands require idempotency keys, expected revision, actor context and policy decision. Events include schema version, tenant/environment/workspace and correlation/causation IDs without secret values.

## 28. Required end-to-end proving scenarios

### 28.1 Simon OSE proving tenant

Configure a university/nonprofit, 4–6-club pilot with OSE oversight, durable student-leadership seats, VP → President → OSE approvals, shared university identity, finance tracking/reporting, budget history, events, documents and institutional memory. Live payment processing remains disabled unless independently approved. Prove the global engine uses a Simon tenant overlay and reusable education/nonprofit packs, never Simon code.

### 28.2 Professional-services SMB

Configure pooled Tenure SaaS, US legal entity, project accounting, resource planning, timesheets, billing, CRM, Google/Microsoft identity choice, optional Stripe collections, simple settlement and Relay. Prove irrelevant manufacturing and complex global tax questions are absent yet discoverable through “Add capability.”

### 28.3 Global discrete manufacturer

Configure multiple legal entities in the US, Germany and India; dedicated Tenure AWS accounts/cells; finance, procurement, MRP, BOM, routing, production, quality, maintenance, warehouse, logistics and planning; external PLM/MES coexistence; banking and payment capability; multilingual operation; regional data policy. Prove one upstream country/entity change recalculates region, localization, provider, currency, integration and approval questions with preserved stale values.

### 28.4 Public-sector organization

Configure fund/grant accounting, appropriations, procurement controls, records retention, accessibility, public reporting, strict separation of duties and unsupported capability disclosure. Prove no certification is implied from a selected label.

### 28.5 Change-after-launch

Take a live tenant, add a country and legal entity, enable a new module, change an integration and move a workload class. Prove branch/compare, impact, new approval, migration, canary, rollback and actual-state reconciliation.

## 29. Testing and evidence strategy

Required automated layers:

- schema meta-validation and golden package tests;
- expression parser/type/evaluation and denial tests;
- graph cycle, dependency, topological and incremental-evaluation property tests;
- state-machine transition/model tests;
- replay/determinism tests;
- migration tests for every schema/package version;
- API authorization, IDOR, tenant isolation and concurrency tests;
- autosave, conflict, offline/recovery and idempotency tests;
- component, accessibility and visual-regression tests;
- end-to-end persona workflows across themes, densities, locales and viewports;
- external-check timeout/rate/error tests;
- preview diff, approval invalidation and digest-binding tests;
- deployment handoff, partial failure, resume, rollback and drift tests;
- load tests for large graphs, large organizations, large integration catalogs and concurrent collaborators;
- threat-model abuse tests for malicious packages, expressions, values and attachments.

Every checked requirement records code path, commit, test command/result, deployment/run where applicable, evidence and rollback.

## 30. Evidence-gated implementation checklist

### CFG-000 — Truth and authority

- [ ] CFG-000-001 — Inspect repository, current System Studio routes, authentication, configuration code, databases, IaC, workflows, tests and deployed nonproduction behavior.
- [ ] CFG-000-002 — Import every `CFG-*` item into the canonical execution ledger without creating a divergent checklist.
- [ ] CFG-000-003 — Map existing form/configuration code to retain, refactor, migrate or retire with evidence.
- [ ] CFG-000-004 — Establish one action-resource-scope authorization path before exposing configurable production actions.
- [ ] CFG-000-005 — Prove browser clients cannot obtain AWS credentials or call arbitrary AWS mutations.
- [ ] CFG-GATE-000 — Current truth, authority boundaries and migration plan are evidenced.

### CFG-010 — Schema package registry

- [ ] CFG-010-001 — Implement signed, versioned schema package metadata, lifecycle and compatibility.
- [ ] CFG-010-002 — Implement registry admission for signature, publisher, dependencies, engine range, migrations, translations and tests.
- [ ] CFG-010-003 — Reject duplicate identifiers, unsafe expressions, cycles and unavailable dependencies with actionable errors.
- [ ] CFG-010-004 — Implement package deprecation, supersession, vulnerability response, tenant impact and rollback.
- [ ] CFG-010-005 — Prove a tenant cannot load an unauthorized or incompatible package.
- [ ] CFG-GATE-010 — Only admitted, compatible, traceable packages reach tenant configuration.

### CFG-020 — Declarative schema and rule runtime

- [ ] CFG-020-001 — Implement namespaced structural, UI, rule, provenance, impact, output and approval schema vocabularies.
- [ ] CFG-020-002 — Implement bounded expression parsing, static typing, dependency extraction and deterministic evaluation.
- [ ] CFG-020-003 — Implement visibility, applicability, enablement, requirement, default, derivation, options, validation, invalidation, approval, lock, redaction and mapping rules.
- [ ] CFG-020-004 — Generate client-safe presentation projection and server-authoritative evaluation from one graph snapshot.
- [ ] CFG-020-005 — Prove hostile schema/rule content cannot execute arbitrary code, access secrets or escape its namespace.
- [ ] CFG-GATE-020 — Domain behavior is declarative, safe, deterministic and server-authoritative.

### CFG-030 — Graph compiler and incremental evaluation

- [ ] CFG-030-001 — Compile package closure into a typed directed dependency graph and signed snapshot.
- [ ] CFG-030-002 — Detect cycles with minimal human-readable paths and block publication.
- [ ] CFG-030-003 — Implement topological and affected-subgraph evaluation.
- [ ] CFG-030-004 — Persist rule traces, inputs, outputs, graph version and evaluation errors.
- [ ] CFG-030-005 — Prove identical inputs and versions replay to canonical identical outputs.
- [ ] CFG-030-006 — Load-test million-value effective configuration and large graph behavior within approved budgets.
- [ ] CFG-GATE-030 — Graph compilation and incremental evaluation are correct, bounded and scalable.

### CFG-040 — State, invalidation and provenance

- [ ] CFG-040-001 — Implement field/section states and permitted transition guards.
- [ ] CFG-040-002 — Implement provenance for inherited, defaulted, derived, imported, Relay-proposed, explicit and exception values.
- [ ] CFG-040-003 — Preserve stale/inapplicable/superseded values and history; never silently delete downstream decisions.
- [ ] CFG-040-004 — Invalidate affected validation, previews, artifacts and approvals after material changes.
- [ ] CFG-040-005 — Display rule trace and “why/impact” explanation without exposing protected data.
- [ ] CFG-GATE-040 — Every effective value and state transition is reconstructable and explainable.

### CFG-050 — Drafts, save/resume and collaboration

- [ ] CFG-050-001 — Implement event-sourced semantic drafts with revision control and snapshots.
- [ ] CFG-050-002 — Implement truthful autosave, explicit save, save-and-exit, resume and recovery.
- [ ] CFG-050-003 — Implement optimistic concurrency, non-overlap merge and three-way conflict resolution.
- [ ] CFG-050-004 — Implement draft branches, comparison, semantic merge, archive and expiry.
- [ ] CFG-050-005 — Implement assignments, comments, mentions, due dates and durable-seat handoff.
- [ ] CFG-050-006 — Prove network interruption, duplicate command, tab collision and process restart do not lose or double-apply work.
- [ ] CFG-GATE-050 — Multi-session and multi-user configuration preserves work and authority.

### CFG-060 — Generated Deployer UX

- [ ] CFG-060-001 — Implement the System Studio shell and all tenant-creation stage surfaces from schemas.
- [ ] CFG-060-002 — Implement graph-aware Back, Next, deep link, history restoration and context-switch protection.
- [ ] CFG-060-003 — Implement progressive disclosure, expert bulk editing, provenance, inherited/override controls and explanations.
- [ ] CFG-060-004 — Implement every field/section status, loading, empty, blocked, stale, conflict, error, offline and forbidden state.
- [ ] CFG-060-005 — Implement global search/command, saved views, inspector, activity and evidence panels.
- [ ] CFG-060-006 — Pass Tenure Experience System, responsive, localization, WCAG 2.2 AA, keyboard, screen-reader and visual-regression gates.
- [ ] CFG-060-007 — Pass observed long-session comfort tests for solution architects and reviewers.
- [ ] CFG-GATE-060 — The configurator is fast, professional, low-fatigue, accessible and generated from canonical schemas.

### CFG-070 — Validation, impact and review

- [ ] CFG-070-001 — Implement field, section, cross-domain, external, infrastructure, operational, security and migration validation.
- [ ] CFG-070-002 — Implement typed external checks with freshness, timeout, retry, ownership and evidence.
- [ ] CFG-070-003 — Compile application/data/integration/identity/AI/AWS/security/cost/downtime/migration/rollback impact.
- [ ] CFG-070-004 — Implement comparison to inheritance baseline, prior release, another branch and actual state.
- [ ] CFG-070-005 — Derive readiness from applicable requirements/evidence; prevent manual green status.
- [ ] CFG-GATE-070 — Reviews receive complete, current and explainable consequences.

### CFG-080 — Approval and change transaction

- [ ] CFG-080-001 — Implement risk-based approval policy and separation of duties.
- [ ] CFG-080-002 — Bind approvals to canonical digests, target, action, evidence and expiry.
- [ ] CFG-080-003 — Invalidate approvals after material change, expired evidence or changed risk.
- [ ] CFG-080-004 — Implement step-up, typed confirmation, two-person approval and delay for protected actions as policy requires.
- [ ] CFG-080-005 — Freeze effective manifest and create immutable change transaction only after gates pass.
- [ ] CFG-GATE-080 — No production or destructive change executes outside current digest-bound approval.

### CFG-090 — Deployment and actual-state integration

- [ ] CFG-090-001 — Generate typed application, data, connector, identity, Relay and infrastructure artifacts from the manifest.
- [ ] CFG-090-002 — Handoff only to backend idempotent orchestration using narrow short-lived roles.
- [ ] CFG-090-003 — Implement step visibility, pause, retry, resume, compensation, rollback and forward recovery.
- [ ] CFG-090-004 — Verify business, isolation, security, data, integration, finance and operations before activation.
- [ ] CFG-090-005 — Project desired/planned/actual/drifted/verified state into System Studio.
- [ ] CFG-090-006 — Prove partial failure resumes from the correct safe checkpoint without orphan resources.
- [ ] CFG-GATE-090 — Approved configuration becomes verified actual state through governed execution.

### CFG-100 — Domain proving and regression

- [ ] CFG-100-001 — Prove Simon OSE from reusable packs and a tenant overlay with payments off by default.
- [ ] CFG-100-002 — Prove professional-services SMB composition.
- [ ] CFG-100-003 — Prove global discrete-manufacturing composition and cascading country/entity consequences.
- [ ] CFG-100-004 — Prove public-sector composition with truthful certification states.
- [ ] CFG-100-005 — Prove a live tenant change including branch, impact, approvals, migration, canary, rollback and reconciliation.
- [ ] CFG-100-006 — Prove no domain, industry, connector or provider requires source code branching.
- [ ] CFG-GATE-100 — Structurally different tenants are generated by one runtime.

### CFG-110 — Security, reliability and final proof

- [ ] CFG-110-001 — Complete threat model and abuse tests for schemas, expressions, drafts, files, approvals, preview and deployment handoff.
- [ ] CFG-110-002 — Pass tenant isolation across relational, object, cache, search, events, jobs, logs and evidence.
- [ ] CFG-110-003 — Pass backup/restore and point-in-time reconstruction for configuration and approval history.
- [ ] CFG-110-004 — Pass performance, concurrency, fault-injection and safe-degradation tests.
- [ ] CFG-110-005 — Produce operator runbooks, SLOs, alarms, dashboards and support handoff.
- [ ] CFG-110-006 — Generate final requirement-to-code/test/deployment/evidence matrix with every failure and blocked input.
- [ ] CFG-GATE-110 — The Configurator is production-ready only for the exact enabled scope proven by evidence.

## 31. Required repository deliverables

At minimum:

```text
docs/architecture/configuration-language.md
docs/architecture/configuration-graph-compiler.md
docs/architecture/configuration-state-and-provenance.md
docs/architecture/deployer-experience.md
docs/architecture/configuration-security.md
docs/adr/*configurator*.md
packages/config-schema/
packages/config-expression/
packages/config-graph/
packages/config-runtime/
packages/config-ui-runtime/
packages/config-testing/
services/configuration/
services/configuration-preview/
services/change-control/
apps/system-studio/
tests/e2e/configurator/
evidence/configurator/
```

Adapt paths to the real monorepo; do not create duplicate architecture stacks merely to match this example.

## 32. Absolute definition of done

This Bible is complete only when:

- A new tenant is created through the generated decision experience rather than hard-coded pages.
- Millions of possible effective values are handled through packages, inheritance and affected-subgraph evaluation.
- Cascading questions respond correctly to legal entity, geography, operating model, modules, industry, deployment, integrations and certification.
- Save, resume, back, forward, undo/redo, comparison, assignments, comments and conflict handling work under real failure and concurrency.
- Every value is explainable and historically reconstructable.
- Upstream changes preserve and correctly invalidate downstream work.
- Previews expose real application/data/AWS/security/cost/migration/rollback consequences.
- Approvals bind exact immutable intent.
- Backend workflows safely translate approved intent into verified Tenure-owned AWS actual state.
- Simon and materially different tenants prove one engine without forks.
- Security, tenant isolation, accessibility, performance, recovery and evidence gates pass for the enabled scope.

## 33. Prohibited shortcuts

Do not:

- build a giant hard-coded React wizard;
- encode business choices in route conditionals or component imports;
- execute arbitrary JavaScript from schemas;
- clear hidden/inapplicable values silently;
- trust client validation or tenant identifiers;
- place secret values into configuration objects;
- represent saved, approved, deployed or verified state falsely;
- let a stale preview or approval authorize a changed manifest;
- make Relay an approver;
- make AWS Console changes part of the normal workflow;
- call a module, integration, country or industry supported from a logo, label, schema or mock;
- invent customer, legal, payment, payroll, bank, identity or production consent.

## 34. Required final Claude response

Report outcome first:

1. What now works end to end.
2. Exact repository paths and commits.
3. Schema/graph/runtime versions and package digests.
4. Tests by layer with counts, failures and skips.
5. Deployed development/staging evidence and actual-state reconciliation.
6. Accessibility, visual, performance, concurrency, security and isolation outcomes.
7. Proving tenants and exact supported capability scopes.
8. All unchecked, failed and `BLOCKED_EXTERNAL` requirements.
9. Production approval and rollback posture.
10. Confirmation that no secret values or browser AWS credentials were exposed.

Begin by inspecting the actual repository and current System Studio. Establish the `CFG-*` ledger, then build the smallest complete vertical slice: admitted schema package → generated field → draft event → incremental graph evaluation → save/resume → validation → preview → digest-bound approval in a safe nonproduction environment. Expand only while preserving that verified chain.

## END CLAUDE CODE MASTER PROMPT

---

## Authoritative reference anchors

- JSON Schema conditional and dependent validation: <https://json-schema.org/understanding-json-schema/reference/conditionals>
- JSON Schema 2020-12 core: <https://json-schema.org/draft/2020-12/json-schema-core>
- AWS AppConfig validators: <https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-creating-configuration-and-profile-validators.html>
- AWS AppConfig deployment and rollback: <https://docs.aws.amazon.com/appconfig/latest/userguide/creating-feature-flags-and-configuration-data.html>
- AWS Step Functions error handling: <https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html>
- AWS CloudFormation drift-aware change sets: <https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/drift-aware-change-sets.html>
