# Declarative Tenant Configurator and Deployer UX — execution ledger

Every `CFG-*` requirement stated by `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`.

Seeded by `tools/import-requirements.mjs`. **Every entry is `FAIL` and
unchecked**, which is the truthful starting state: import is not progress. A
requirement becomes `PASS` when somebody builds it, proves it by mutation, and
records the evidence here — never because a script wrote a row for it.

Before this file existed these requirements were in no execution document at
all. They were not queued, not counted and not failing; they were invisible, and
invisible reads exactly like done. `tests/architecture/document-graph.test.mjs`
ratchets that number downward and it may only shrink.

Statuses: `PASS` · `FAIL` · `BLOCKED_EXTERNAL` · `BLOCKED_ARCHITECTURE` ·
`NOT_APPLICABLE`. There is no `PARTIAL` — an unfinished requirement stays
`FAIL` unless a precise external or architectural blocker exists.

- [ ] **CFG-000-001** — Inspect repository, current System Studio routes, authentication, configuration code, databases, IaC, workflows, tests and deployed nonproduction behavior.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-000-002** — Import every `CFG-*` item into the canonical execution ledger without creating a divergent checklist.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-000-003** — Map existing form/configuration code to retain, refactor, migrate or retire with evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-000-004** — Establish one action-resource-scope authorization path before exposing configurable production actions.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-000-005** — Prove browser clients cannot obtain AWS credentials or call arbitrary AWS mutations.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-010-001** — Implement signed, versioned schema package metadata, lifecycle and compatibility.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-010-002** — Implement registry admission for signature, publisher, dependencies, engine range, migrations, translations and tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-010-003** — Reject duplicate identifiers, unsafe expressions, cycles and unavailable dependencies with actionable errors.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-010-004** — Implement package deprecation, supersession, vulnerability response, tenant impact and rollback.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-010-005** — Prove a tenant cannot load an unauthorized or incompatible package.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-020-001** — Implement namespaced structural, UI, rule, provenance, impact, output and approval schema vocabularies.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-020-002** — Implement bounded expression parsing, static typing, dependency extraction and deterministic evaluation.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-020-003** — Implement visibility, applicability, enablement, requirement, default, derivation, options, validation, invalidation, approval, lock, redaction and mapping rules.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-020-004** — Generate client-safe presentation projection and server-authoritative evaluation from one graph snapshot.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-020-005** — Prove hostile schema/rule content cannot execute arbitrary code, access secrets or escape its namespace.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-030-001** — Compile package closure into a typed directed dependency graph and signed snapshot.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-030-002** — Detect cycles with minimal human-readable paths and block publication.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-030-003** — Implement topological and affected-subgraph evaluation.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-030-004** — Persist rule traces, inputs, outputs, graph version and evaluation errors.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-030-005** — Prove identical inputs and versions replay to canonical identical outputs.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-030-006** — Load-test million-value effective configuration and large graph behavior within approved budgets.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-040-001** — Implement field/section states and permitted transition guards.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-040-002** — Implement provenance for inherited, defaulted, derived, imported, Relay-proposed, explicit and exception values.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-040-003** — Preserve stale/inapplicable/superseded values and history; never silently delete downstream decisions.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-040-004** — Invalidate affected validation, previews, artifacts and approvals after material changes.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-040-005** — Display rule trace and “why/impact” explanation without exposing protected data.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-050-001** — Implement event-sourced semantic drafts with revision control and snapshots.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-050-002** — Implement truthful autosave, explicit save, save-and-exit, resume and recovery.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-050-003** — Implement optimistic concurrency, non-overlap merge and three-way conflict resolution.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-050-004** — Implement draft branches, comparison, semantic merge, archive and expiry.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-050-005** — Implement assignments, comments, mentions, due dates and durable-seat handoff.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-050-006** — Prove network interruption, duplicate command, tab collision and process restart do not lose or double-apply work.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-060-001** — Implement the System Studio shell and all tenant-creation stage surfaces from schemas.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-060-002** — Implement graph-aware Back, Next, deep link, history restoration and context-switch protection.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-060-003** — Implement progressive disclosure, expert bulk editing, provenance, inherited/override controls and explanations.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-060-004** — Implement every field/section status, loading, empty, blocked, stale, conflict, error, offline and forbidden state.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-060-005** — Implement global search/command, saved views, inspector, activity and evidence panels.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-060-006** — Pass Tenure Experience System, responsive, localization, WCAG 2.2 AA, keyboard, screen-reader and visual-regression gates.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-060-007** — Pass observed long-session comfort tests for solution architects and reviewers.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-070-001** — Implement field, section, cross-domain, external, infrastructure, operational, security and migration validation.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-070-002** — Implement typed external checks with freshness, timeout, retry, ownership and evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-070-003** — Compile application/data/integration/identity/AI/AWS/security/cost/downtime/migration/rollback impact.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-070-004** — Implement comparison to inheritance baseline, prior release, another branch and actual state.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-070-005** — Derive readiness from applicable requirements/evidence; prevent manual green status.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-080-001** — Implement risk-based approval policy and separation of duties.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-080-002** — Bind approvals to canonical digests, target, action, evidence and expiry.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-080-003** — Invalidate approvals after material change, expired evidence or changed risk.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-080-004** — Implement step-up, typed confirmation, two-person approval and delay for protected actions as policy requires.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-080-005** — Freeze effective manifest and create immutable change transaction only after gates pass.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-090-001** — Generate typed application, data, connector, identity, Relay and infrastructure artifacts from the manifest.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-090-002** — Handoff only to backend idempotent orchestration using narrow short-lived roles.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-090-003** — Implement step visibility, pause, retry, resume, compensation, rollback and forward recovery.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-090-004** — Verify business, isolation, security, data, integration, finance and operations before activation.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-090-005** — Project desired/planned/actual/drifted/verified state into System Studio.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-090-006** — Prove partial failure resumes from the correct safe checkpoint without orphan resources.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-100-001** — Prove Simon OSE from reusable packs and a tenant overlay with payments off by default.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-100-002** — Prove professional-services SMB composition.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-100-003** — Prove global discrete-manufacturing composition and cascading country/entity consequences.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-100-004** — Prove public-sector composition with truthful certification states.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-100-005** — Prove a live tenant change including branch, impact, approvals, migration, canary, rollback and reconciliation.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-100-006** — Prove no domain, industry, connector or provider requires source code branching.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-110-001** — Complete threat model and abuse tests for schemas, expressions, drafts, files, approvals, preview and deployment handoff.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-110-002** — Pass tenant isolation across relational, object, cache, search, events, jobs, logs and evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-110-003** — Pass backup/restore and point-in-time reconstruction for configuration and approval history.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-110-004** — Pass performance, concurrency, fault-injection and safe-degradation tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-110-005** — Produce operator runbooks, SLOs, alarms, dashboards and support handoff.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-110-006** — Generate final requirement-to-code/test/deployment/evidence matrix with every failure and blocked input.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented
