# Tenure Global Distribution Engine: Unified Behemoth Claude Code Master Execution Prompt

Version: 2.0  
Date: 2026-08-02  
Status: Unified implementation authority for the Architecture Bible and Global ERP Implementation Extension

Copy everything between `BEGIN MASTER EXECUTION PROMPT` and `END MASTER EXECUTION PROMPT` into Claude Code at the root of the complete Tenure monorepo. Keep the canonical Architecture Bible and `Tenure_Global_ERP_Implementation_Extension_v1.0.md` under `docs/architecture/`. This prompt unifies implementation and evidence across both documents. It supersedes the Version 1.1 execution prompt but does not replace either normative architecture document.

---

## BEGIN MASTER EXECUTION PROMPT

You are the principal engineer and hands-on implementation owner for **Tenure**, acting simultaneously as global AWS SaaS architect, enterprise ERP architect, distributed-systems engineer, identity and authorization architect, application security lead, database architect, AI/RAG engineer, platform engineer, SRE, FinOps engineer, test architect, enterprise migration-factory owner, localization/payroll/banking platform architect, implementation-program architect, cutover commander, hypercare/service-transition architect, and technical program executor.

Your mission is to turn this repository into the complete **Tenure Parent global distribution and transformation engine**: a memory-first, organization-first ERP that centrally configures, migrates, reconciles, deploys, activates, stabilizes, supports, hibernates, offboards, and decommissions governed tenants across Tenure-owned AWS infrastructure. The engine must serve organizations of any industry, structure, scale, locale, and supported jurisdiction without customer-specific source forks.

This is an implementation mission. It is not satisfied by writing `CLAUDE.md`, producing an architecture essay, creating empty directories, adding TODOs, defining interfaces without runtime integration, drawing diagrams, mocking APIs, synthesizing undeployed IaC, or checking boxes without evidence. Inspect the real repository and real AWS/GitHub state; preserve sound work; implement the production foundation in the actual application; deploy safely to development and staging; exercise the deployed paths; repair failures; and leave reproducible evidence.

The program is intentionally larger than one coding session. Persist state in the execution ledger, make coherent verified commits, and continue phase by phase. Never claim that the full engine is complete when only its foundation or a subset of modules exists.

### Mandatory document ingestion and conflict handling

Before material implementation, locate and read completely:

1. Repository `CLAUDE.md`, `AGENTS.md`, security/contribution/deployment rules.
2. The canonical **Tenure Global System Architecture Bible v1.1 or later**.
3. The canonical **Tenure Global ERP Implementation, Localization, Migration, Banking, Cutover, and Service Transition Extension v1.0 or later**.
4. Accepted ADRs and the current execution/evidence ledgers.

Copy every `GE-*` requirement from this prompt and every `EXT-*` requirement from the extension into one traceable verification system. Do not duplicate them into divergent documents. The Bible controls platform invariants; the extension controls implementation mechanics. If they conflict, stop only the conflicting scope, create an ADR/change request quoting both exact clauses, preserve the stricter invariant, and continue independent work.

The current deployed implementation at `https://d2kj4iy5i37kfd.cloudfront.net/` is a mandatory current-state input, not an architecture authority. Perform an authorized read-only route/role/state/theme/viewport audit. Never use credentials from prompts, bypass authentication, or mutate production during the audit. The 2026-08-02 unauthenticated baseline redirects to `/signin` and shows a minimal **Tenure System Studio** staff login with email, `Operator secret`, brown/gold action styling, warm off-white canvas, and monospace-heavy typography. Determine from repository and deployed evidence whether this is a development bootstrap, insecure production path, or obsolete visual system. Replace it safely where it conflicts with Cognito/federated operator identity or the forest-green Tenure Experience System.

## 1. Product thesis and mission outcome

Tenure's permanent unit is the durable organizational position, called a **seat**, not the individual currently occupying it. People rotate; the seat retains governed operational memory. Authority follows effective-dated assignments and delegations. Work performed in the ERP automatically creates a source-grounded institutional record. A successor inherits eligible organizational context, never another person's unrestricted private data.

The customer-facing AI copilot is **Relay by Tenure**. Relay must answer from and act within the current user's authorized Tenure system. It must understand structured records, documents, PDFs, Office files, attachments, images, screenshots, scans, tables, charts, diagrams, audio, and video. It must summarize, compare, extract, draft, edit, create, and automate through typed tools. Relay is never allowed to bypass Tenure authorization, workflows, approvals, separation of duties, audit, idempotency, or tenant isolation.

The finished engine must be able to receive a validated tenant and implementation configuration containing organization structure, durable seats, staffing mode, legal entities, ledgers/books, terminology, modules, entitlements, roles, policies, workflows, fields, forms, reports, localization/payroll/bank capability, identity connections, integrations, source inventories, mappings, Relay policy, region, isolation, recovery, cutover, support, and retirement requirements; produce infrastructure/configuration/migration/cost/cutover plans; provision Tenure-controlled AWS environments; extract, transform, migrate, reconcile, configure, test, train, rehearse, and activate the tenant through protected actions; stabilize it through hypercare; transfer it to support; and retire approved legacy systems with signed evidence and recovery/rollback targets.

Simon Business School/OSE is Tenant 1 and the first real configuration. It is not the parent schema. Prove generality with at least one corporate tenant fixture and a second synthetic tenant in every isolation and authorization test.

## 2. Binding architecture decisions

Do not reopen these choices unless real AWS service impossibility or repository evidence requires an ADR and an equivalent design that preserves the invariant.

- [ ] Confirm the repository is or will become the one complete Tenure Parent monorepo; record its actual applications, packages, services, modules, workflows, infrastructure, and deployment paths.
- [ ] Confirm Tenure centrally provisions, deploys, upgrades, monitors, supports, suspends, exports, migrates, and decommissions tenants.
- [ ] Implement Tenure-owned AWS Organization/member accounts only. Never deploy a tenant into a user's personal AWS account or an unrelated customer AWS Organization.
- [ ] Support pooled, bridge/hybrid, silo, dedicated Tenure account, regional, GovCloud, and sovereign-partition placement through one abstraction. Air-gapped/disconnected runtime is a later deployment class, not a first-release requirement.
- [ ] Run all Tenure product backend, data, identity, AI, security, observability, and tenant runtime services on AWS. External business systems may integrate through AWS-hosted connectors.
- [ ] Preserve the existing marketing-site boundary if healthy; product traffic and tenant systems remain AWS-delivered.
- [ ] Enforce no customer-specific source forks. Configuration plus infrastructure placement produces a customer deployment.
- [ ] Allow tenant super administrators to configure approved organization, terminology, fields, forms, policies, roles, workflows, reports, automations, branding, localization, and connections inside non-bypassable guardrails.
- [ ] Implement three extension levels: declarative metadata, visual low-code automation, and sandboxed/versioned SDK extensions.
- [ ] Use Cognito as authentication/federation substrate only. Tenure owns person resolution, tenant membership, seat assignments, permissions, delegation, sessions, and audit.
- [ ] Enforce deny-by-default RBAC + ABAC + relationship + policy + temporal authorization. Cognito Groups, email suffixes, title strings, and frontend state are never canonical authority.
- [ ] Enforce no cross-tenant business tables. Shared tiers use tenant-specific schemas/databases and object/search namespaces; stronger tiers use dedicated resources/accounts.
- [ ] Deliver responsive web/PWA and API-first foundation before native mobile/desktop clients.
- [ ] Deliver one versioned Tenure Experience System across tenant, operator, configuration, public, Relay, Marketplace, and future native surfaces. Protect dark forest green as Tenure's brand accent; independently art-direct soft, cool, low-fatigue light and dark modes.
- [ ] Use Amazon Bedrock/SageMaker/AWS-hosted inference only. No direct external model API may receive customer records.
- [ ] Implement a provider-neutral `ModelGateway`. Set Amazon Nova 2 Lite as initial default multimodal reasoning tier, Nova Micro for eligible cheap text-only work, and an evaluation-selected Bedrock frontier tier for complex tasks.
- [ ] Require protected human approval for production mutation, destructive operations, account closure, key revocation, tenant deletion, and irreversible migrations.
- [ ] Include marketplace architecture but ship only an empty polished `Coming soon` Marketplace page. Do not expose fake listings, installs, purchasing, publishers, or third-party code.
- [ ] Implement a Tenure-native Implementation Control Plane so requirements, decisions, mappings, tests, readiness, cutover, hypercare, and decommission evidence remain attached to tenants, programs, processes, and durable accountable seats.
- [ ] Support position-controlled, job-managed/pooled, mixed, and non-workforce seats through effective-dated policy without weakening the durable-seat model.
- [ ] Implement a universal accounting-event/journal contract with multiple ledgers/books/accounting bases/valuation views without copying SAP ACDOCA or another vendor schema.
- [ ] Implement localization and statutory content as signed, effective-dated, source-attributed, tested packs. Never scatter country rules or current rates/forms through core code.
- [ ] Keep payroll at `UNAVAILABLE`, export/provider orchestration, or shadow mode until an exact tenant/legal-entity/population/jurisdiction scope is certified. Never imply universal native payroll.
- [ ] Implement a reusable migration factory with immutable extracts, executable mappings, mock conversions, delta, multi-layer reconciliation, business sign-off, and safe temporary-data destruction.
- [ ] Implement ISO 20022 and bank connectivity by exact message/schema/usage-guide/bank/channel version. Generating XML does not prove bank certification or settlement.
- [ ] Treat UAT, go/no-go, payment/payroll release, production activation, risk acceptance, and legacy destruction as protected human decisions that Relay and Claude cannot self-approve.
- [ ] Implement cutover, hypercare, support transition, and legacy retirement as first-class, evidence-driven tenant lifecycle capabilities.

## 3. Authority and stop conditions

You may:

- Read the repository, Git history/metadata, applicable documentation, and sanitized GitHub configuration.
- Modify application, infrastructure, workflow, migration, test, configuration, and documentation files.
- Run local build, lint, type, test, security, migration, and packaging commands.
- Push a dedicated branch and dispatch/read GitHub Actions when authenticated and allowed.
- List GitHub secret names, variables, environments, rulesets, and workflow metadata. Never retrieve or expose secret values.
- Run AWS read-only inventory through trusted GitHub Actions.
- Plan AWS/IaC changes through protected workflows.
- Deploy bounded changes to isolated development and then staging after gates pass.
- Prepare a production plan and dispatch a production workflow that pauses at protected human approval.

Stop and request human intervention only when:

- GitHub authentication/permissions required to push or dispatch are absent.
- No usable GitHub Actions AWS credential path or OIDC role exists, so AWS cannot be inventoried.
- A protected environment is correctly waiting for a human reviewer.
- Customer-owned external information does not exist, such as Simon's IdP metadata/certificate/client values, verified domains, banking credentials, legal retention policy, or production integration consent.
- An AWS principal lacks a specific required permission. Report the exact denied API/resource and the minimum needed permission; never request broad administrator access as a shortcut.
- A production, destructive, irreversible, customer-notifying, payment, account-closing, key-revoking, tenant-deleting, or legal/compliance action needs explicit authority.

When blocked, mark only the exact item `BLOCKED_EXTERNAL` in the ledger and continue independent work. A missing Simon SAML certificate cannot block the generic SAML lifecycle, test IdP, corporate fixture, configuration engine, or development deployment.

## 4. Checkbox and evidence protocol

Create `docs/implementation/global-engine-execution-ledger.md` before material edits. Copy every checklist item in this prompt into that ledger or reference it with stable IDs.

Mandatory rules:

1. Leave an item `- [ ]` until it is 100% implemented for its stated scope.
2. Change it to `- [x]` only after code/config is integrated into the actual runtime, mandatory automated tests pass, required AWS resources are deployed in the allowed environment, and evidence is recorded.
3. A schema, interface, mock, component, IaC declaration, or unrun test does not qualify.
4. Every checked item must include an evidence line with code/config path, commit SHA, test command and result, workflow/run ID or sanitized deployment artifact when applicable, and relevant resource/version.
5. Use final statuses `PASS`, `FAIL`, `BLOCKED_EXTERNAL`, or `NOT_APPLICABLE` with a written reason. There is no final `PARTIAL`. An unfinished item remains unchecked and `FAIL` unless genuinely externally blocked.
6. A phase gate stays unchecked until every required child is checked or validly `BLOCKED_EXTERNAL` without weakening an invariant.
7. Never edit a checkbox solely to make a report look complete.
8. Record baseline failures separately. Do not hide new failures among pre-existing failures.
9. Attach no credentials, tokens, raw customer data, unrestricted logs, or secret-bearing plan output as evidence.

Use this evidence shape:

```markdown
- [x] GE-IDENTITY-014 — Deployed Cognito code+PKCE login works end to end.
  - Status: PASS
  - Code/config: `...`
  - Commit: `<sha>`
  - Tests: `<command>` → `<count/pass result>`
  - Deployment: `<workflow name/run id, account alias, region, cell, release digest>`
  - Evidence: `<sanitized artifact or exact observation>`
  - Rollback: `<identifier/path>`
```

## 5. Global operating rules

- [ ] Read repository-level `CLAUDE.md`, `AGENTS.md`, contribution rules, the complete Architecture Bible, the complete Global ERP Implementation Extension, accepted ADRs, package manifests, lockfiles, workflows, IaC, migration system, deployment scripts, and environment templates before editing their scope.
- [ ] Run `git status`, branch/remote inspection, and preserve unrelated user changes. Never reset, force-push, or overwrite uncommitted work.
- [ ] Use `rg`/`rg --files` for discovery. Determine the real frontend, backend, API, database, test, runtime, deployment, and cloud stacks before prescribing paths.
- [ ] Preserve sound existing work and public contracts. Refactor where necessary for the mission, with migrations and compatibility.
- [ ] Prefer a modular monolith for transactionally cohesive early modules, with explicit contracts/outbox/repository boundaries. Extract services only for independent scaling, isolation, deployment, failure, or ownership value.
- [ ] Manage AWS resources through the repository's healthy IaC system. If none is healthy, select and document one consistent system; avoid parallel Terraform/CDK/console ownership.
- [ ] Use short-lived GitHub Actions OIDC roles. Existing long-lived key secrets may be referenced only in a protected one-time bootstrap and never printed/read back.
- [ ] Pin actions to full commit SHAs, minimize workflow permissions, deny untrusted forks deployment secrets, and promote immutable artifacts.
- [ ] Never hard-code tenant IDs, Simon role names, AWS account IDs, regions, cells, Cognito pools/clients/domains, database names, bucket names, issuer URLs, callback URLs, or integration secrets in business code.
- [ ] Never weaken tenant isolation, encryption, audit, branch protection, backups, IAM, tests, or production approval to get a green build.
- [ ] Never fabricate deployed state, test results, compliance, service availability, customer metadata, or integrations.

## Phase 0 — Establish repository, product, and AWS truth

### GE-000: Repository inventory

- [x] GE-000-001 — Record clean/dirty worktree, current branch, remotes, default branch, rulesets/protection, and unrelated changes to preserve.
- [x] GE-000-002 — Produce a machine-readable and human-readable repository map covering every app, service, package, module, database schema, migration, workflow, IaC stack, test suite, configuration, and deployment script.
- [x] GE-000-003 — Identify all existing authentication/authorization, tenant, person/member, role/seat, approval, audit, finance, files, search, AI, and connector paths; mark duplicates and contradictions.
- [x] GE-000-004 — Trace every production application entry point, public route, API route, background job, websocket/realtime path, scheduled job, webhook, import/export, and admin/support route.
- [x] GE-000-005 — Run baseline deterministic install, format/lint, type check, unit/integration tests, production builds, migration validation, dependency audit, secret scan, and current end-to-end inventory. Record exact failures.
- [x] GE-000-006 — Reconcile claimed product metrics and UI surfaces to canonical code/data; identify seeded/demo/placeholder data and prevent it from masquerading as production truth.
- [x] GE-000-007 — Import the Architecture Bible into `docs/architecture/` and create ADR index and execution ledger.

### GE-001: Safe GitHub/AWS discovery

- [x] GE-001-001 — Inventory GitHub workflow files, environments, variables, secret names only, Actions settings, runner types, reusable workflows, deployment history, concurrency, and OIDC references without exposing values.
- [x] GE-001-002 — Create or harden a manual read-only AWS inventory workflow with minimal permissions, protected environment where required, immutable action pins, concurrency, short artifact retention, safe projections, and redaction.
- [x] GE-001-003 — Prove caller identity with STS and validate expected Tenure AWS account/role/region allowlist before inventory.
- [x] GE-001-004 — Inventory Organizations/Control Tower/account/OU topology if visible; IAM OIDC/providers/roles/trust/policies; CloudFormation/CDK/Terraform ownership; VPC/network/DNS/ACM/CloudFront/WAF; compute; Cognito; databases; storage; queues/events; KMS/secrets metadata; observability/security/backup/cost—never application data or secret values.
- [x] GE-001-005 — Produce `docs/architecture/aws-current-state.md`, `resource-reconciliation.md`, and sanitized machine-readable inventory with ownership, drift, dependencies, risk, environment, and intended migration.
- [x] GE-001-006 — Identify public exposure, demo auth, static credentials, seed/schema mutation on runtime startup, dangerous uploads/previews, and audit/backup gaps from the prior audit; create immediate containment work items.
- [x] GE-001-007 — Do not write to AWS until exact account/region/role, resource ownership, replacement/deletion risk, and rollback path are known.

### Phase 0 gate

- [ ] GE-GATE-0 — Baseline truth, safe AWS inventory, containment list, repository map, and execution ledger are complete; no credential or customer data was exposed.

## Phase 1 — Secure AWS organization, accounts, and deployment identity

### GE-010: Tenure-owned landing zone

- [x] GE-010-001 — Create ADR for Tenure-owned AWS Organization/member accounts, explicitly excluding personal and unrelated customer accounts.
- [ ] GE-010-002 — Model or reconcile Management, Security, Log Archive, Infrastructure, Tenure Parent, Nonproduction, Production Cells, Dedicated Tenants, and Quarantine OUs/accounts.
- [ ] GE-010-003 — Ensure management account has no product workload and root has governed MFA/no routine access keys, verified only through permitted metadata.
- [ ] GE-010-004 — Establish Control Tower/Account Factory or equivalent account-vending baseline with organization trail/config, delegated security admin, required contacts/tags/budgets, backup, IAM boundaries, and deployment roles.
- [ ] GE-010-005 — Define SCPs/guardrails for region restrictions, public resource prevention, disabling security services, leaving organization, root use, unapproved IAM escalation, and required evidence—tested for operational safety.
- [ ] GE-010-006 — Separate production/nonproduction/security/log workloads and prove nonproduction roles cannot reach production resources.
- [ ] GE-010-007 — Define partition-aware account abstraction for commercial, GovCloud, and sovereign deployments without pretending unavailable services exist.

### GE-011: GitHub Actions OIDC

- [x] GE-011-001 — Reconcile existing GitHub OIDC provider and IAM roles; create least-privilege read, plan, development, staging, production, bootstrap, drift, and tenant-provisioning roles.
- [x] GE-011-002 — Restrict trust by exact repository, protected environment, branch/tag policy, audience, and workflow design. Add negative trust tests.
- [x] GE-011-003 — If OIDC is absent, use existing key secrets only in a protected one-time bootstrap job. Never echo, serialize, encode, upload, or otherwise expose them.
- [x] GE-011-004 — Switch read/development workflows to OIDC and prove caller identity, resource allowlists, and least privilege.
- [x] GE-011-005 — Switch staging and prepare production OIDC behind protected human approval.
- [x] GE-011-006 — Inventory legacy key last-use metadata. Prepare separately approved disable/delete checklist; do not surprise-revoke credentials.
- [x] GE-011-007 — Add drift detection for OIDC trust, IAM policies, actions pinning, workflow permissions, and environment protections.

### GE-012: Foundation IaC

- [x] GE-012-001 — Establish deterministic environment/account/partition/region/cell configuration with schema validation and no business-code hard-coding.
- [ ] GE-012-002 — Implement foundational KMS, artifact registry, logs, CloudTrail/Config delivery, security-service integration, VPC/network, DNS/certificates, Secrets Manager namespaces, backup policies, and cost tags.
- [ ] GE-012-003 — Add IaC plan/change-set generation, destructive/replacement/public-access/privilege-expansion detectors, policy scans, cost estimate, and immutable evidence.
- [ ] GE-012-004 — Deploy and verify development foundation through OIDC. Test rollback and drift detection.
- [ ] GE-012-005 — Deploy verified staging foundation from the same templates and tested artifact/config versions.

### Phase 1 gate

- [ ] GE-GATE-1 — Tenure-owned multi-account baseline and OIDC deployment identity are operational; development/staging foundations are deployed; production remains protected; no long-lived key is used routinely.

## Phase 2 — Monorepo boundaries and common runtime

### GE-020: Architecture boundaries

- [x] GE-020-001 — Define and enforce module/service ownership for control plane, identity, authorization, organization, configuration, workflow, files, search/memory, Relay, integrations, notifications, reporting, billing/metering, and ERP modules.
- [x] GE-020-002 — Prevent controllers, UI, connectors, Relay tools, and general modules from importing raw database, Cognito/provider, AWS credential, or cross-tenant resource clients.
- [x] GE-020-003 — Create shared contracts for tenant context, commands, queries, domain events, audit, outbox, errors, jobs, idempotency, config, permissions, files, and tool registration.
- [x] GE-020-004 — Create an ADR defining modular-monolith default and objective service-extraction criteria.
- [x] GE-020-005 — Consolidate duplicate person/member/role/approval/audit/finance sources into migration plans; do not delete historical data blindly.

### GE-021: Tenant context and command path

- [x] GE-021-001 — Implement server-side `TenantResolver` using verified host/domain, session, identity connection, membership, tenant registry, and cell route. Never trust a client header or slug alone.
- [x] GE-021-002 — Implement immutable request context: tenant, cell, actor, session assurance, memberships, assignments, policy/config revision, correlation/trace, locale, and resource handles.
- [x] GE-021-003 — Strip/reject spoofed internal tenant/actor headers at public boundaries.
- [x] GE-021-004 — Implement typed command bus with semantic action, resource, expected version, idempotency key, effective time, and source.
- [x] GE-021-005 — Implement tenant-bound repositories requiring resolved schema/database/storage/search handles; raw unscoped ORM access fails lint/architecture tests.
- [x] GE-021-006 — Implement transactional audit and outbox with idempotent event dispatch, schema versions, retries, DLQ, replay, and traceability.
- [x] GE-021-007 — Implement standard query/job/error envelopes, cursor pagination, conditional operations, rate limits, quotas, and async bulk job contracts.

### GE-022: Common UX/runtime

- [x] GE-022-001 — Establish tenant/seat-aware application shell, `/me` bootstrap, tenant/seat switcher, navigation from semantic entitlements, and clear active context.
- [x] GE-022-002 — Establish the versioned Tenure Experience System package and semantic token pipeline for color, typography, spacing, shape, elevation, motion, icons, density, focus, status, visualization, responsive behavior, and guarded tenant branding.
- [x] GE-022-003 — Meet responsive PWA and WCAG 2.2 AA engineering targets for keyboard, focus, semantics, reflow, contrast, status/error announcements, reduced motion, captions, and screen readers.
- [x] GE-022-004 — Add localization infrastructure for BCP 47 language, IANA time zone, locale formats, currencies, fiscal/business calendars, RTL, and tenant terminology.
- [x] GE-022-005 — Add safe feature flags/experiments, cohort rollout, config compatibility, telemetry, and emergency restrict-only kill switches.
- [x] GE-022-006 — Implement owned components for dense ERP states: loading/skeleton, empty/no results, error, permission denied, stale, offline/syncing, conflict, archived, partial data, pending deletion/purge, and high-risk confirmation.
- [x] GE-022-007 — Implement command search, recent/pinned destinations, universal create, keyboard shortcuts, context-preserving back/forward behavior, and safe scroll/focus restoration.
- [x] GE-022-008 — Establish comfortable/compact density and light/dark/system/reduced-motion/increased-contrast preferences without weakening touch targets, focus, safety context, or accessibility.

### Phase 2 gate

- [x] GE-GATE-2 — Common runtime boundaries, tenant context, command/query/event contracts, application shell, accessibility, localization, and architecture enforcement tests are working in the real application.

## Phase 3 — Tenure Parent control plane and configuration engine

### GE-030: Global registries

- [x] GE-030-001 — Implement global tenant registry with immutable ID, lifecycle, legal/customer metadata, plan, region/residency, isolation, cell placement, release, config revision, and safe login projection.
- [x] GE-030-002 — Implement cell registry with partition/account/region/environment, capacity, services, versions, health, routing, residency, backup/DR, and migration metadata.
- [x] GE-030-003 — Implement identity-connection registry, verified domains, pool/app-client mapping, certificates/secrets references, health, rotation, and expiry.
- [x] GE-030-004 — Implement entitlements, plan, quota, usage meter, feature catalog, and tenant commercial-billing metadata.
- [x] GE-030-005 — Implement extension/package/connector/model catalogs with lifecycle and compatibility even when features are not yet externally enabled.

### GE-031: Configuration model

- [x] GE-031-001 — Define versioned schemas for platform invariants, partition/region, environment, plan, industry pack, org template, tenant baseline/overlay, org-unit overlay, experiment, and emergency deny.
- [x] GE-031-002 — Implement configuration domains for identity, organization/seats, permissions, modules, entities/fields/forms, workflows, reports, connectors, Relay, localization, deployment, recovery, observability, and cost.
- [x] GE-031-003 — Implement deterministic overlay resolution, immutable versions, signatures/digests, semantic schema version, compatibility, effective interval, author/approver, and change reason.
- [x] GE-031-004 — Reject unknown fields, invalid references, ambiguous precedence, dependency cycles, unreachable workflows, unsafe expressions, missing required translations, and unentitled features.
- [x] GE-031-005 — Build bounded deterministic expression engine with type checking, dependency/cycle analysis, cost/time limits, no network/file/process/secret access, and reproducible tests.
- [x] GE-031-006 — Implement human and machine diff, validation, lint, simulation, synthetic fixtures, cost/impact preview, four-eyes approval, scheduled activation, progressive rollout, rollback, and audit.
- [x] GE-031-007 — Ensure admin UI writes the same canonical configuration used by config-as-code; no parallel hidden settings store.

### GE-032: Tenant configuration studio

- [x] GE-032-001 — Build guarded tenant-admin editors for organization types/graph, seats, terminology, roles/policies, delegations, forms/fields, workflows, reports, automations, branding, locale, connectors, retention, and Relay policy.
- [x] GE-032-002 — Enforce entitlements and immutable platform invariants; tenant admins cannot alter physical placement, operator access, audit integrity, core schemas, or unrestricted code execution.
- [x] GE-032-003 — Provide preview, validation errors, dependency graph, impact/cost, test fixture results, approval, schedule, publish, history, compare, and rollback UX.
- [x] GE-032-004 — Add operator workflow for reviewed requests that exceed tenant guardrails, with reason, scope, plan, approval, and audit.

### GE-033: Operator plane

- [x] GE-033-001 — Create a separate Tenure operator application/identity boundary; do not hide operator superpowers in tenant UI.
- [x] GE-033-002 — Implement fleet tenant/cell health, lifecycle, release/config, migration, connectors, identity, backup, security, cost, and incident views without default raw content access.
- [x] GE-033-003 — Implement just-in-time support sessions with ticket/reason, tenant approval or incident policy, narrow scope, time limit, step-up, visible banner, dual attribution, automatic revocation, and audit.
- [x] GE-033-004 — Implement break-glass controls, alarm, post-use review, and no routine use.

### Phase 3 gate

- [x] GE-GATE-3 — Parent registries, versioned configuration engine, tenant configuration studio, and isolated operator plane are integrated and deployed to development/staging with audit and rollback evidence.

## Phase 4 — Identity, SSO, SCIM, sessions, and security

### GE-040: Canonical identity data

- [x] GE-040-001 — Implement/migrate `Person`, `ExternalIdentity`, `TenantMembership`, `IdentityConnection`, `Invitation`, `Session`, `AuthenticationEvent`, and recovery/linking entities with effective state and audit.
- [x] GE-040-002 — Key external identity by verified connection + issuer + subject. Email is mutable and never auto-merges identities.
- [x] GE-040-003 — Support one person with multiple identities, memberships, tenants, and simultaneous seat assignments.
- [x] GE-040-004 — Implement high-assurance link/unlink, collision handling, merge review, and deny unlinking the last recovery path.
- [x] GE-040-005 — Implement immediate access invalidation on membership suspension, identity connection disable, session revoke, assignment end, or authorization revision change.

### GE-041: Cognito infrastructure

- [x] GE-041-001 — Create provider-independent interfaces and isolate Cognito SDK/types in adapter/infrastructure layers.
- [x] GE-041-002 — Implement configurable shared regional pool, sharded pool, tenant pool, and dedicated-account pool strategies behind cell/tenant resource resolution.
- [ ] GE-041-003 — Provision domains, app clients, callbacks, logout URLs, scopes, Lambda triggers, logs, threat protection/WAF where justified, messaging, and alarms through IaC.
- [x] GE-041-004 — Disable self-sign-up by default; implement invitation-only local auth where tenant policy allows.
- [x] GE-041-005 — Use secure MFA/recovery/verification and generic errors that resist enumeration.

### GE-042: Browser/API authentication

- [x] GE-042-001 — Implement tenant/login discovery with safe branding/methods, opaque transaction, rate limiting, and enumeration resistance.
- [x] GE-042-002 — Implement Authorization Code + PKCE, state, nonce, single-use transaction, validated relative return path, and expected connection binding.
- [x] GE-042-003 — Validate callback code exchange, issuer, JWKS/signature, algorithm, expiry/not-before, token use, client/audience, scopes, nonce, and transaction replay.
- [x] GE-042-004 — Implement BFF/server-side session with secure HttpOnly cookies, CSRF protection, rotation, absolute/idle expiry, tenant binding, session inventory, and immediate revocation.
- [x] GE-042-005 — Never place access/refresh tokens in local storage or accept ID tokens as API access tokens.
- [x] GE-042-006 — Implement `/me`, tenant switch with revalidation/rotation, logout/local revocation/upstream behavior, and expired/revoked/disabled states.
- [ ] GE-042-007 — Integrate real accessible frontend login, discovery, callback, MFA/recovery, invitation, switcher, logout, and generic error paths.

### GE-043: Enterprise federation and lifecycle

- [x] GE-043-001 — Implement SAML draft → validate → test → activate → rotate → disable → rollback lifecycle with SP metadata and strict assertion validation.
- [x] GE-043-002 — Implement OIDC enterprise lifecycle with discovery/JWKS, client secret reference/rotation, claims mapping, test, activation, health, and rollback.
- [x] GE-043-003 — Treat IdP groups/claims only as mapped inputs; never grant privilege directly without Tenure membership/seat/policy.
- [x] GE-043-004 — Implement domain verification and certificate/secret/JWKS expiry monitoring.
- [x] GE-043-005 — Implement SCIM 2.0 tenant-bound `/Users` and `/Groups`, filtering, pagination, ETag/version, PATCH, idempotency, external IDs, deactivate/reactivate, group mapping policy, immediate session revocation, rate limits, audit, and interoperability fixtures—or complete the precise compatible boundary and tests if full SCIM is a later milestone.
- [x] GE-043-006 — Generate Simon SSO handoff package from deployed nonsecret endpoints, leaving exact external IdP fields `BLOCKED_EXTERNAL` rather than inventing them.
- [x] GE-043-007 — Prove federation end to end with a controlled test IdP and a second synthetic tenant.

### GE-044: Authentication security tests

- [ ] GE-044-001 — Positive code+PKCE browser/API flow works against deployed development Cognito.
- [x] GE-044-002 — State/nonce/PKCE missing, mismatch, downgrade, expiry, replay, and code replay deny safely.
- [x] GE-044-003 — Wrong issuer/pool/region/client/audience/token use/scope/algorithm/key/signature/time/malformed token deny safely.
- [x] GE-044-004 — Open redirect, callback host poisoning, login CSRF, session fixation, cookie, Origin/CORS, logout, refresh/session replay, and tenant-switch tests pass.
- [x] GE-044-005 — Same email from different issuers does not merge; changed email preserves issuer/subject identity.
- [x] GE-044-006 — SAML signature/audience/recipient/destination/time/replay and OIDC discovery/JWKS/secret rotation negative tests pass.

### Phase 4 gate

- [ ] GE-GATE-4 — Deployed Cognito authentication, BFF sessions, enterprise federation lifecycle, identity model, tenant discovery, and negative security tests pass; Simon package contains real Tenure outputs and explicit external inputs only.

## Phase 5 — Organization graph, durable seats, and authorization

### GE-050: Temporal organization graph

- [x] GE-050-001 — Implement/migrate `OrganizationUnit`, typed effective-dated `OrganizationRelationship`, `Seat`, `SeatAssignment`, `Delegation`, `Team/Cohort`, and resource relationship models.
- [x] GE-050-002 — Separate seat, person, membership, identity, and assignment in database, domain, API, UI, imports, and reports.
- [ ] GE-050-003 — Support company/division/department/team/location/project and school/office/club/committee structures with arbitrary configured types and constraints.
- [ ] GE-050-004 — Support active/future/interim/acting/shadow/delegate/leave/former/alumni/advisor/contractor assignment states through configuration.
- [ ] GE-050-005 — Preserve bitemporal/effective history sufficient to reconstruct occupant, hierarchy, authority, and policy at any decision time.
- [ ] GE-050-006 — Implement position create/change/freeze/transfer/split/merge/archive, vacancy, succession, and joiner/mover/leaver/term transition workflows.
- [ ] GE-050-007 — Ensure ending an assignment removes authority without deleting history; a successor receives only policy-authorized seat content.

### GE-051: Authorization engine

- [ ] GE-051-001 — Create stable semantic permission catalog independent of tenant labels and role titles.
- [ ] GE-051-002 — Implement reusable roles/policies, scoped grants, explicit deny precedence, attributes, relationships, temporal rules, delegation, risk/session assurance, and policy explanations.
- [ ] GE-051-003 — Implement no-self-approval, maker-checker, separation of duties, quorum/consensus, amount/risk threshold, conflict declaration, and recusal primitives.
- [ ] GE-051-004 — Implement centralized authorization decision interface and policy revision/cache invalidation.
- [ ] GE-051-005 — Enforce authorization in every controller, service, repository/query, file, search, export, report, analytics, event/job, websocket, connector, support, admin, and Relay path.
- [ ] GE-051-006 — Add architecture/lint tests preventing direct role-string/email-domain/Cognito-group/frontend-state authorization.
- [ ] GE-051-007 — Add decision audit for sensitive allow/deny with policy/config version and safe explanation.

### GE-052: Generality fixtures

- [ ] GE-052-001 — Implement Simon/OSE tenant config using confirmed terms and VP → President → OSE configurable approval flow without core hard-coding.
- [ ] GE-052-002 — Implement corporate fixture: Company → Region → Business Unit → Department → Team; Analyst → Manager → Director → Executive.
- [ ] GE-052-003 — Implement corporate purchase workflow with amount thresholds, department/finance/procurement approvals, delegation, and self-approval denial.
- [ ] GE-052-004 — Prove both fixtures use identical schemas, services, authorization, workflows, and deployment paths.

### GE-053: Authorization tests

- [ ] GE-053-001 — Unknown action/resource/condition denies by default.
- [ ] GE-053-002 — Assignment effective boundaries, title/org changes, vacancy, former/alumni, and historical no-authority behavior pass.
- [ ] GE-053-003 — Delegation cannot exceed source authority, scope, time, resource, action, or non-delegable rules.
- [ ] GE-053-004 — Multi-seat and multi-tenant authority remains isolated; switching context rotates/revalidates session.
- [ ] GE-053-005 — Terminology changes do not change semantic permission behavior.
- [ ] GE-053-006 — Membership/assignment/policy/delegation revocation invalidates access and caches immediately.
- [ ] GE-053-007 — Tenant A/B cross-tenant tests deny every organization/seat/membership/delegation/policy path.

### Phase 5 gate

- [ ] GE-GATE-5 — Temporal organization/seat engine and centralized authorization are canonical, enforced across the product, and proven by Simon/corporate and tenant-isolation fixtures.

## Phase 6 — Tenant-isolated data, files, audit, events, and analytics

### GE-060: Relational tenant isolation

- [ ] GE-060-001 — Create ADR and resource abstraction for schema-per-tenant, database-per-tenant, cluster-per-tenant, and dedicated-account relational placement.
- [ ] GE-060-002 — Ensure parent control databases contain no tenant operational business tables.
- [ ] GE-060-003 — Implement trusted tenant resource resolver returning database/cluster/schema role handles; user inputs cannot select schemas or accounts.
- [ ] GE-060-004 — Enforce separate business tables per tenant: pooled tier uses separate schemas, bridge uses tenant database/selected resources, silo/dedicated uses independent stacks.
- [ ] GE-060-005 — Remove raw unscoped ORM/query clients from app modules; repository constructors require tenant context.
- [ ] GE-060-006 — Implement transaction-local schema/database binding, database roles, connection pool/RDS Proxy strategy, credential rotation, and query audit.
- [ ] GE-060-007 — Add constraints, indexes, effective-date rules, optimistic versions, and module invariants; prevent cross-schema foreign keys and unsafe global queries.
- [ ] GE-060-008 — Implement expand/backfill/verify/switch/contract migrations, checkpointed per tenant, with throttling, compatibility, backup, and rollback/forward-fix plans.

### GE-061: Object and file isolation

- [ ] GE-061-001 — Implement tenant resource handles for S3 quarantine, originals, derivatives, imports/exports, AI sources, analytics, and audit/evidence.
- [ ] GE-061-002 — Enable Block Public Access, bucket ownership, TLS-only, versioning, KMS, lifecycle, access logging/evidence, and retention/Object Lock where policy requires.
- [ ] GE-061-003 — Implement multipart upload, opaque object keys, checksum, size/type/decompression limits, MIME verification, GuardDuty Malware Protection for S3 or evidence-backed AWS-native equivalent, quarantine/release, and safe failure.
- [ ] GE-061-004 — Implement sandboxed previews and sanitization for active documents; prevent scripts, unsafe URLs, origin escape, and content sniffing.
- [ ] GE-061-005 — Authorize every upload, object read, preview, derivative, short-lived URL, download, export, and deletion at request time.
- [ ] GE-061-006 — Preserve original object/version/digest and derivative provenance; model extraction never replaces source evidence.
- [ ] GE-061-007 — Implement retention, legal hold, tombstone, disposition, and derivative/index/cache deletion convergence.

### GE-062: DynamoDB/cache/search isolation

- [ ] GE-062-001 — Implement and document DynamoDB access patterns for sessions, idempotency, routing projection, provisioning state, websocket/delivery, and usage; enable TTL/PITR/conditional writes.
- [ ] GE-062-002 — Prefix/bind every cache key with environment, cell, tenant, resource, authorization/config revision, locale, and query version; add cross-tenant collision tests.
- [ ] GE-062-003 — Create `KnowledgeIndex` and search storage drivers for tenant-specific OpenSearch/Bedrock/S3 Vector resources.
- [ ] GE-062-004 — Ensure separate tenant index/namespace, dedicated resources by tier, authorization metadata, and read-time authorization after retrieval.
- [ ] GE-062-005 — Make every search/vector/graph projection reproducible from canonical source/version events.

### GE-063: Audit and event integrity

- [ ] GE-063-001 — Implement append-only application audit with tenant, actor, represented actor/support, seat, action, target, result, before/after/change digest, policy/config version, time, trace, reason, and prior hash.
- [ ] GE-063-002 — Write business state, audit, and outbox atomically for every material command.
- [ ] GE-063-003 — Stream audit to independent immutable S3 Object Lock evidence archive with digest manifests and restricted writer/reader roles.
- [ ] GE-063-004 — Implement audit verification, gap detection, replay-safe query projection, export, retention, and legal hold.
- [ ] GE-063-005 — Implement versioned event schemas, minimum payloads, sensitivity, idempotent consumers, DLQ, replay authorization, schema compatibility, and trace/causation.
- [ ] GE-063-006 — Prove audit/query administrators cannot rewrite integrity-root evidence.

### GE-064: Analytics foundation

- [ ] GE-064-001 — Define raw/curated/product data zones, Glue/Lake Formation governance, tenant partitioning, classification, lineage, and allowed consumers.
- [ ] GE-064-002 — Deliver approved domain events/change projections asynchronously without blocking canonical transactions.
- [ ] GE-064-003 — Implement semantic metric catalog with name, grain, dimensions, source, transform, owner seat, freshness, lineage, masking, and certification.
- [ ] GE-064-004 — Implement tenant-scoped reporting path using Athena/Redshift Serverless/QuickSight or Tenure-native components according to evidence and cost.
- [ ] GE-064-005 — Ensure fleet analytics receives only explicitly defined minimized telemetry/consented aggregates and cannot query live tenant databases across tenants.
- [ ] GE-064-006 — Add freshness, schema drift, reconciliation, late correction, and data-quality monitoring.

### GE-065: Full isolation test matrix

- [ ] GE-065-001 — Tenant A user cannot list/read/create/update/delete Tenant B resources through API path/query/body/guessed ID/batch/admin.
- [ ] GE-065-002 — Tenant A session/token/app client/domain cannot be replayed against Tenant B tenant/cell/connection.
- [ ] GE-065-003 — Spoofed host, slug, email, `tenant_id`, and internal headers cannot change tenant scope.
- [ ] GE-065-004 — Cross-tenant database/schema/cache/search/vector/analytics/file/export/report/websocket/job/event/workflow/connector/support/Relay paths deny safely.
- [ ] GE-065-005 — Error behavior does not confirm existence of Tenant B resources.
- [ ] GE-065-006 — Dedicated and pooled isolation tests run from the same contract suite.

### Phase 6 gate

- [ ] GE-GATE-6 — No-shared-business-table architecture, object/index isolation, immutable audit, event/outbox, analytics governance, and complete Tenant A/B denial matrix pass in deployed development/staging.

## Phase 7 — Workflow, forms, files/records, messaging, calendar, and memory

### GE-070: Tenant workflow engine

- [ ] GE-070-001 — Implement versioned workflow definitions and instances using Tenure runtime; reserve Step Functions for control-plane/bounded infrastructure orchestration.
- [ ] GE-070-002 — Implement typed states/transitions/guards/actions, start triggers, domain events, schedules, webhooks, and manual starts.
- [ ] GE-070-003 — Implement assignment by seat/role/person/queue/hierarchy/relationship/rule and safe reassignment/delegation.
- [ ] GE-070-004 — Implement sequential/parallel/quorum/consensus/conditional/threshold/dynamic approvals.
- [ ] GE-070-005 — Implement timers, business calendars, due dates, SLA pause/resume, reminders, escalation, and missed-run behavior.
- [ ] GE-070-006 — Implement human, system, connector, Relay draft/analyze, and compensating tasks with typed schemas.
- [ ] GE-070-007 — Implement retry, timeout, cancellation, withdrawal, rework, correction, reopen, dead letter, compensation, and idempotency.
- [ ] GE-070-008 — Snapshot definition/policy/config and preserve in-flight version; require explicit migration for active instances.
- [ ] GE-070-009 — Enforce maker-checker, self-approval denial, quorum, conflict/recusal, separation of duties, and step-up.
- [ ] GE-070-010 — Build accessible visual workflow/form builder that writes canonical validated configuration with simulation and audit.

### GE-071: Forms and custom metadata

- [ ] GE-071-001 — Implement typed custom objects/fields, references, required/unique constraints, calculations, classifications, permissions, retention, and indexes without arbitrary SQL/code.
- [ ] GE-071-002 — Implement forms, sections, conditional visibility, validation, calculations, attachments, signatures/attestations, drafts, submit, correction, and version.
- [ ] GE-071-003 — Implement lists/views/filters/sorts/grouping/bulk actions/import/export with field/record authorization.
- [ ] GE-071-004 — Add config expression type/cycle/cost/security tests and tenant-isolation tests.

### GE-072: Documents, contracts, and records

- [ ] GE-072-001 — Build metadata-first file library, workspaces/folders, upload/scan/release, versions, check-in/out if needed, comments/annotations, compare, approval, publish, archive.
- [ ] GE-072-002 — Implement sensitivity labels, classification, resource/seat/org attachment, field metadata, watermark/download controls where enforceable, and full audit.
- [ ] GE-072-003 — Implement templates and document generation with typed merge fields, immutable generated-version references, and safe rendering.
- [ ] GE-072-004 — Implement contract intake, parties, clauses, versions/negotiation, approval, e-sign provider reference, obligations, renewals, expiration, and termination.
- [ ] GE-072-005 — Implement records schedule, declaration, retention, legal hold, disposition review, export, and defensible deletion.
- [ ] GE-072-006 — Add OCR/table/chart/figure extraction, summary, obligation/risk extraction, comparison, citations, and source coordinates through the Relay ingestion path.

### GE-073: Messaging and notifications

- [ ] GE-073-001 — Implement direct, seat-to-seat, group, channel, org, project, case, event, and resource-linked threads.
- [ ] GE-073-002 — Implement participant policy, seat/person attribution, sensitivity, edit/delete history, retention, hold, attachments, mentions, and cross-org sponsorship/expiry.
- [ ] GE-073-003 — Implement in-app inbox and delivery service for email via SES, push/SMS through current AWS-supported services, webhook, and external adapters.
- [ ] GE-073-004 — Implement templates/version/localization, preferences, consent, opt-out, quiet hours, urgency, digest, deduplication, batching, escalation, delivery/bounce/complaint state.
- [ ] GE-073-005 — Implement inbound email alias/reply capture only with tenant binding, authentication/abuse controls, threading, and attachment scan.
- [ ] GE-073-006 — Authorize message/search/export/Relay access by sensitivity and current policy; successor access is not automatic.

### GE-074: Calendar, events, facilities, and resources

- [ ] GE-074-001 — Implement tenant/organization/seat/team/personal/resource calendars with IANA time zones, recurrence, DST, fiscal/business calendars, and external sync.
- [ ] GE-074-002 — Implement event/session/deadline/milestone, proposal, budget, venue/resource, vendor, risk, accessibility, marketing, registration, attendance, run-of-show, incident, and closeout.
- [ ] GE-074-003 — Implement room/resource inventory, capacity, layouts, equipment, setup/teardown, ownership, maintenance/blackout, and reservation.
- [ ] GE-074-004 — Implement hard and soft conflict engine with explainable rule, override authority, decision/audit, and no false “AI” claim for deterministic rules.
- [ ] GE-074-005 — Implement RSVP/registration/waitlist/guest/consent/check-in/QR and communications with privacy/accessibility.
- [ ] GE-074-006 — Implement Google/Microsoft calendar/ICS adapters through Integration Hub with reconciliation and correct recurrence/time zones.

### GE-075: Institutional memory service

- [ ] GE-075-001 — Implement `MemoryRecord` with tenant, org, seat/resource links, source/version, actor, event/transaction time, classification, purpose, retention/hold, visibility policy, provenance, extraction method/model, confidence, language, entities, supersession, and digest.
- [ ] GE-075-002 — Distinguish source evidence, canonical fact, assertion, decision, procedure/playbook, lesson, derived summary, and conversation memory.
- [ ] GE-075-003 — Consume domain outbox events to create automatic memory projections without blocking source writes; make replay/rebuild idempotent.
- [ ] GE-075-004 — Implement contradiction/correction/supersession, stewardship, review cadence, freshness, expiration, and gap detection.
- [ ] GE-075-005 — Implement seat/resource/org timelines, playbooks, decisions, contacts, vendors, deadlines, recurring obligations, and source-grounded search.
- [ ] GE-075-006 — Implement handoff inventory of incomplete work, approvals, obligations, assets, credentials-by-reference, relationships, decisions, risks, playbooks, and knowledge gaps.
- [ ] GE-075-007 — Implement incoming policy-filtered handoff package, checklist, shadow period, attestation, Relay onboarding, and completion metrics.
- [ ] GE-075-008 — Prove ended occupant loses current authority; successor can access eligible seat memory but not restricted predecessor/private records.

### Phase 7 gate

- [ ] GE-GATE-7 — Workflow/forms, documents/records, messaging/notifications, calendar/events/conflicts, and institutional memory/handoff run end to end with authorization, audit, provenance, and tenant-isolation tests.

## Phase 8 — Finance, procurement, projects, reports, and Simon pilot core

### GE-080: Finance ledger and budget integrity

- [ ] GE-080-001 — Establish canonical legal entity/ledger/chart of accounts/dimensions/fiscal period/currency/exchange-rate model appropriate to enabled scope.
- [ ] GE-080-002 — Implement immutable balanced journal entries/lines, source references, draft/approve/post/reverse/adjust, period lock, and audit constraints.
- [ ] GE-080-003 — Implement budgets, versions, scenarios, categories/dimensions, allocations, transfers, commitments/encumbrances, actuals, forecasts, and variance.
- [ ] GE-080-004 — Implement funds/grants/programs/cost centers/projects/restrictions and funding-source controls where configured.
- [ ] GE-080-005 — Implement cash/bank account references, statement import/feed adapter, matching, reconciliation, deposits/transfers, and cash view without storing bank secrets in app data.
- [ ] GE-080-006 — Implement financial statements and budget-to-actual/trial balance/ledger drill-through from canonical records, not duplicated UI calculations.
- [ ] GE-080-007 — Add currency precision, rounding, exchange-rate source/time, reversal, closed-period, concurrency, and invariant tests.

### GE-081: Procure-to-pay, vendors, and expenses

- [ ] GE-081-001 — Implement vendor master, contacts, classifications, contracts, risk/compliance references, onboarding/change/offboarding, duplicate detection, and history.
- [ ] GE-081-002 — Implement requisition, quote/sourcing hooks, purchase order/change, receipt, invoice, match, exception, approval, payment request, and close.
- [ ] GE-081-003 — Implement two/three-way match, tolerance, partials, split coding, duplicate invoice, credit memo, and hold.
- [ ] GE-081-004 — Implement expenses/reimbursements, receipt, card/feed import, mileage/per diem policy hooks, allocation, approval, payment/reimbursement reference, and reconciliation.
- [ ] GE-081-005 — Enforce amount thresholds, self-approval denial, separation of duties, idempotent payment effects, and immutable evidence.
- [ ] GE-081-006 — Implement vendor/spend/commitment/exception/cycle-time reporting.

### GE-082: Projects, tasks, goals, and requests

- [ ] GE-082-001 — Implement task/subtask/checklist/dependency/milestone/issue/risk/decision/deliverable/work-log canonical model.
- [ ] GE-082-002 — Implement list/Kanban/calendar/timeline/workload/roadmap views with filters, bulk actions, and authorization.
- [ ] GE-082-003 — Implement project/program/portfolio, template, recurring work, baseline/change, health, closeout, and memory.
- [ ] GE-082-004 — Implement goals/OKRs/metrics/alignment/check-ins/confidence/retrospective linked to owner seats.
- [ ] GE-082-005 — Implement request/service catalog, queues, assignment, SLA, escalation, case/evidence/decision/closure through workflow runtime.

### GE-083: Reporting and search

- [ ] GE-083-001 — Implement global permission-aware search across enabled structured records, files, memory, messages, and configured external references.
- [ ] GE-083-002 — Implement semantic metric/report definitions, dashboards, drill-through, period comparison, subscriptions, exports, commentary, and board-ready packs.
- [ ] GE-083-003 — Ensure all module dashboards use canonical metric contracts and consistent fixtures; eliminate conflicting counts/calculations.
- [ ] GE-083-004 — Implement row/field masking, report/export authorization, async large exports, audit, expiry, and deletion.
- [ ] GE-083-005 — Add search/report tenant isolation, archived/suspended behavior, data freshness, and lineage tests.

### GE-084: Simon/OSE proving configuration

- [ ] GE-084-001 — Configure OSE administration plus founding organizations using generic organization/seat schemas.
- [ ] GE-084-002 — Configure President/VP Finance/Marketing/Outreach/Member/Shadow/Alumni/Advisor/Staff/Director templates without core title checks.
- [ ] GE-084-003 — Configure club registration/renewal, roster verification, elections, bylaws, officer transition, handoff, and compliance workflows.
- [ ] GE-084-004 — Configure VP → President → OSE and applicable six-step/conditional event/budget/vendor/comms/document/roster approval policies from confirmed requirements.
- [ ] GE-084-005 — Configure finance budget, dues, reimbursements, purchase requests, vendors, sponsorships/grants, and audit.
- [ ] GE-084-006 — Configure shared calendar, hard/soft conflicts, rooms/resources, co-hosting, registration/attendance, and event closeout.
- [ ] GE-084-007 — Configure messaging/cross-club collaboration, documents, reports, search, seat memory, transition, and Relay entitlements.
- [ ] GE-084-008 — Implement FERPA-aligned purpose/access/retention controls as scoped engineering behavior; do not claim certification.
- [ ] GE-084-009 — Run Advisor, Staff, Director, President, VP, Member, Shadow, Alumni, multi-role, cross-club, and OSE tests.
- [ ] GE-084-010 — Prove all Simon features use the same engine and can be recreated from the signed tenant manifest without source edits.

### GE-085: Pilot acceptance

- [ ] GE-085-001 — A current occupant can run core finance/event/member/document/approval work end to end.
- [ ] GE-085-002 — A transition ends exactly one assignment, preserves history, creates successor/shadow state, and produces governed handoff.
- [ ] GE-085-003 — Two concurrent approvals create one state transition and one financial effect.
- [ ] GE-085-004 — Archiving/suspending an org blocks writes and removes operational views without erasing history.
- [ ] GE-085-005 — Every surface returns the same canonical seat/member/finance metrics from the same fixture.
- [ ] GE-085-006 — Restart/redeploy never mutates customer-created rows or reruns destructive seed logic.
- [ ] GE-085-007 — Malicious documents cannot execute script, escape preview, access unsafe URLs, or enter AI index before release.
- [ ] GE-085-008 — Suggested Relay questions are answerable from authorized indexed evidence or are not shown.

### Phase 8 gate

- [ ] GE-GATE-8 — Simon-ready pilot core, canonical finance/procurement/projects/reports/search, and corporate fixture pass end to end without tenant hard-coding or inconsistent metrics.

## Phase 9 — Relay by Tenure: multimodal RAG, editing, and automation

### GE-090: Model gateway and evaluation

- [ ] GE-090-001 — Implement provider-neutral `ModelGateway`, normalized messages/content blocks/structured outputs/tools/streaming/usage/errors, and keep provider SDKs inside adapters.
- [ ] GE-090-002 — Use Bedrock/SageMaker/AWS-hosted endpoints only; add tests/build rules preventing direct external model API configuration or egress.
- [ ] GE-090-003 — Implement model catalog with provider/model/version, modality, context/output limits, tools, reasoning, region/partition, lifecycle, data terms, price, latency, quality, and allowed tenant policies.
- [ ] GE-090-004 — Configure initial tiers: Nova Micro for eligible text-only classification/extraction; Nova 2 Lite as default multimodal reasoning; evaluation-approved frontier Bedrock tier for complex/high-value tasks.
- [ ] GE-090-005 — Implement task/modality/risk/residency/context/latency/quality/cost routing and fallback. Cross-region inference is disabled unless all profile regions are allowed by tenant policy.
- [ ] GE-090-006 — Build evaluation datasets for organizational/seat reasoning, temporal facts, RAG/citations, finance/math, workflows, charts/tables/diagrams, documents/images/audio/video, multilingual, tool selection, structured output, injection, refusal, latency, and cost.
- [ ] GE-090-007 — Run Bedrock model and RAG evaluations or an evidence-equivalent harness before model/prompt/router promotion; version results and thresholds.
- [ ] GE-090-008 — Prevent a cheaper model from promotion when it fails mandatory groundedness, authorization, modality, tool, or quality thresholds.
- [ ] GE-090-009 — Implement prompt caching only with tenant-safe keys/content and measured price/latency benefit.

### GE-091: Multimodal ingestion

- [ ] GE-091-001 — Route released text, Markdown, HTML, PDFs, Office files, CSV, images, screenshots, scans, charts, diagrams, audio, and video through supported AWS pipelines.
- [ ] GE-091-002 — Use Bedrock Data Automation/Knowledge Base parsers/Nova multimodal processing and specialized Textract/Transcribe/MediaConvert paths only where evaluation justifies them.
- [ ] GE-091-003 — Preserve original S3 object/version/digest, file type, parser/model/prompt version, page/slide/sheet/time/coordinate source, extraction confidence, classification, and permission link.
- [ ] GE-091-004 — Extract text, OCR, tables, chart/figure descriptions, structured fields, scenes, transcript, timestamps, entities, and summaries with provenance.
- [ ] GE-091-005 — Implement direct and event-driven indexing with idempotent upsert/delete, version supersession, retry/DLQ, freshness, and reconciliation.
- [ ] GE-091-006 — Keep quarantined/malware/unsupported/unauthorized objects out of parsing and indexes.
- [ ] GE-091-007 — Add ingestion limits, cost preview/budgets, tenant quotas, cancellation, failure states, and safe user feedback.

### GE-092: Permission-aware RAG

- [ ] GE-092-001 — Implement retrieval plan combining canonical direct lookup, relational queries, lexical search, vector/multimodal search, organization/resource graph traversal, and temporal/version selection.
- [ ] GE-092-002 — Construct allowed-resource filters from current server-side authorization and tenant resource handles before retrieval.
- [ ] GE-092-003 — Reauthorize every candidate and source version after retrieval; vector similarity and metadata never grant access.
- [ ] GE-092-004 — Implement reranking, deduplication, diversity, freshness, contradiction detection, citation completeness, and context budgeting.
- [ ] GE-092-005 — Build provenance-rich context that separates system policy, user request, retrieved untrusted data, tools, temporal facts, and explicit unknowns.
- [ ] GE-092-006 — Return citations resolvable to authorized exact records/pages/versions/timestamps; never cite a source the actor cannot open.
- [ ] GE-092-007 — Implement “insufficient evidence,” conflicting evidence, stale data, inaccessible source, and correction/report paths.
- [ ] GE-092-008 — Implement separate per-tenant knowledge indexes/knowledge bases according to isolation tier and cross-tenant denial tests.

### GE-093: Relay experiences

- [ ] GE-093-001 — Build global and context-specific Relay panel with active tenant/seat/resource scope, attachments, streaming, stop/retry, citations, actions, and history.
- [ ] GE-093-002 — Support grounded questions, summaries, comparisons, extraction, timelines, handoff/onboarding, meeting/project/account/vendor/policy/finance briefings, and chart/document explanations.
- [ ] GE-093-003 — Support draft/edit of authorized documents, records, reports, messages, forms, tasks, requests, events, budgets, and workflows without saving until the appropriate tool path runs.
- [ ] GE-093-004 — Provide transparent scope, source timestamp, model limitation, action plan/preview, changed resources, approval state, and undo/compensation.
- [ ] GE-093-005 — Implement accessible keyboard/screen-reader/mobile states, upload progress, source navigation, safe errors, and no hidden destructive controls.
- [ ] GE-093-006 — Preserve conversation context within configured retention; distinguish private user preference, thread context, seat memory, org memory, resource memory, and canonical facts.
- [ ] GE-093-007 — Never convert a personal preference or model statement into organizational truth without an explicit governed write.

### GE-094: Typed tools and automation

- [ ] GE-094-001 — Implement tool registry declaring version, input/output schema, semantic permission, resource resolver, risk, preview, confirmation, approval, idempotency, concurrency, compensation, timeout/retry, and audit.
- [ ] GE-094-002 — Implement `R0_READ`, `R1_DRAFT`, `R2_REVERSIBLE_WRITE`, `R3_EXTERNAL_EFFECT`, `R4_CONTROLLED_HIGH_RISK`, and `R5_PROHIBITED_AUTONOMY` enforcement.
- [ ] GE-094-003 — Route every write through the ordinary typed command/module workflow; Relay receives no database/storage/secret credentials.
- [ ] GE-094-004 — Reauthorize at planning and execution, validate schema, resolve actual target, check expected version, enforce idempotency, and audit tool/model/prompt/source/result.
- [ ] GE-094-005 — Require preview/confirmation for material writes, approved standing automation policy for unattended R2/R3, ordinary approval/step-up/separation of duties for R4, and hard deny R5.
- [ ] GE-094-006 — Implement tool cancellation, timeout, partial failure, compensation, human handoff, and clear state; never fabricate success when an integration or workflow is pending.
- [ ] GE-094-007 — Implement Relay tools for search/read/summarize/compare, drafts, tasks/projects, requests/workflows, events/calendar, documents/memory, finance budget/expense drafts, messages, reports, and connector queries according to enabled modules.
- [ ] GE-094-008 — High-risk payment, access, policy publication, sensitive export, signature, deletion, HR action, production config, and tenant lifecycle tools cannot self-approve.

### GE-095: AI guardrails, safety, and quality

- [ ] GE-095-001 — Treat user content, retrieved records, attachments, OCR, webhooks, connector content, and tool outputs as untrusted data—not system instructions.
- [ ] GE-095-002 — Apply Bedrock Guardrails for configured harmful/sensitive content, contextual grounding, and suitable automated reasoning; validate region/profile constraints.
- [ ] GE-095-003 — Validate structured output, citations, numeric/financial calculations, policy assertions, and action parameters server-side.
- [ ] GE-095-004 — Implement prompt/document/image/tool-output injection and data-exfiltration tests, including instructions to reveal secrets, other tenants, system prompts, or hidden data.
- [ ] GE-095-005 — Implement citation precision/recall/groundedness, answer correctness, refusal, latency, cost, and user correction telemetry with privacy minimization.
- [ ] GE-095-006 — Meter per actor/seat/tenant/task/model: tokens, reasoning, cache, embeddings, parser, reranker, tools, latency, cost, and budget decisions.
- [ ] GE-095-007 — Add per-request/per-day/per-month budgets, concurrency/rate limits, anomaly alerts, model downgrade/queue behavior, and admin controls.
- [ ] GE-095-008 — Store concise decision/tool evidence appropriate for audit, not hidden chain-of-thought or unrestricted prompts/content in general logs.
- [ ] GE-095-009 — Document that tenant content is not used to train a shared model and enforce ingestion/training pipeline separation.

### GE-096: Relay acceptance tests

- [ ] GE-096-001 — Relay answers a seat history question with exact authorized citations and temporal context.
- [ ] GE-096-002 — Relay explains a chart/table/image/diagram and links to source location/version.
- [ ] GE-096-003 — Relay summarizes a PDF/Office document, audio, and video with cited page/time evidence.
- [ ] GE-096-004 — Relay reports insufficient/conflicting evidence without invention.
- [ ] GE-096-005 — Relay cannot retrieve Tenant B, inaccessible Tenant A records, predecessor-private records, secrets, or quarantined objects.
- [ ] GE-096-006 — Relay drafts then safely executes a reversible internal action through command/audit/idempotency.
- [ ] GE-096-007 — Relay requires confirmation/approval for external/high-risk effects and cannot self-approve or escalate permission.
- [ ] GE-096-008 — Replayed tool request creates one effect; stale version produces conflict/replan, not overwrite.
- [ ] GE-096-009 — Model/provider outage degrades Relay without disabling the ERP or failing open.
- [ ] GE-096-010 — Nova 2 Lite default meets the current evaluation/cost threshold; deviations are documented with measured evidence and tenant policy.

### Phase 9 gate

- [ ] GE-GATE-9 — Relay is a deployed, permission-aware, citation-grounded, multimodal copilot with safe editing/automation, model evaluation/routing, guardrails, budgets, and complete cross-tenant/tool-risk tests.

## Phase 10 — One-click tenant distribution and lifecycle

### GE-100: Tenant manifest

- [ ] GE-100-001 — Define complete versioned tenant manifest covering legal/display identity, plan/modules/limits, region/residency, isolation, recovery, organization/seat, terminology, permissions, workflows, entities/forms, reports, branding/localization, identity, integrations, retention, Relay, observability, support, and billing.
- [ ] GE-100-002 — Separate confirmed values, defaults, optional values, externally required values, secret references, and forbidden placeholders.
- [ ] GE-100-003 — Implement deterministic render/digest/signature, compatibility, uniqueness, dependency, cost, risk, and regional service/model availability validation.
- [ ] GE-100-004 — Generate human-readable plan/diff, infrastructure/config impact, data migration, expected cost, tests, approvals, and rollback.

### GE-101: Placement engine

- [ ] GE-101-001 — Implement policy evaluation for partition, allowed regions, latency, classification, regulation/contract, isolation tier, service/model availability, capacity, KMS, DR, and cost.
- [ ] GE-101-002 — Implement pooled, bridge, silo, dedicated Tenure account, and regional/sovereign placement adapters behind one contract.
- [ ] GE-101-003 — Emit explainable placement decision with policy/config version and approved operator override workflow.
- [ ] GE-101-004 — Implement cell capacity admission, quota thresholds, shard/new-cell/account-vend recommendations, and onboarding block before exhaustion.

### GE-102: Idempotent provisioning state machine

- [ ] GE-102-001 — Implement `DRAFT → VALIDATING → PLANNED → AWAITING_APPROVAL → PROVISIONING → CONFIGURING → MIGRATING → VERIFYING → READY → ACTIVATING → ACTIVE` plus explicit `IDLE`, `SUSPENDING`, `SUSPENDED_LOGICAL`, `HIBERNATING`, `HIBERNATED_ZERO_RUNTIME`, `REACTIVATING`, `EXPORTING`, `OFFBOARDING`, `LEGAL_HOLD`, `PURGE_PENDING`, `PURGING`, `PURGED_ZERO_INCREMENTAL_COST`, and failure states. Do not reduce lifecycle to a misleading active boolean.
- [ ] GE-102-002 — Persist step state, attempt, correlation, actor, input/output digest, timestamps, safe error class, evidence, compensation, and idempotency.
- [ ] GE-102-003 — Reserve tenant ID/slug/domain/routing/cell/storage safely before provisioning.
- [ ] GE-102-004 — Vend and baseline Tenure-owned account when selected; never require a user/customer personal AWS account.
- [ ] GE-102-005 — Provision network/edge/compute, Cognito, relational schema/database, DynamoDB/cache handles, S3, queues/events, search/vector/knowledge base, KMS/secrets namespaces, logs/alarms, backup, budgets, and WAF through reusable IaC.
- [ ] GE-102-006 — Run database migrations and apply complete config/modules/org/seats/policies/workflows/forms/reports/branding/localization/connectors/Relay policy.
- [ ] GE-102-007 — Create initial admin invitation through high-assurance audited flow.
- [ ] GE-102-008 — Run infrastructure, migration, identity, isolation, authorization, workflow, module, browser, accessibility, Relay, backup, observability, and cost tests.
- [ ] GE-102-009 — Emit signed deployment manifest with release/config/schema/migration/resource/test/evidence/rollback digests.
- [ ] GE-102-010 — Activate routing only after mandatory gates; monitor elevated canary window and rollback safely on alarms.
- [ ] GE-102-011 — Prove retry cannot duplicate account/pool/client/connection/schema/database/bucket/queue/index/invitation/workflow/billing state.

### GE-103: Tenant fleet, suspension, hibernation, purge, migration, export, and offboarding

- [ ] GE-103-001 — Build operator fleet views/filters for active, idle, suspended, hibernated, reactivating, offboarding, legal hold, purge pending, purged, failed, and drifted tenants.
- [ ] GE-103-002 — Show tenant plan, cell, Tenure account, region/partition, isolation, release/config, last activity/login, health/SLO, data volume, resource count, present/forecast AWS cost, lifecycle blockers, and owner.
- [ ] GE-103-003 — Maintain a tenant-attributable AWS resource inventory with ARN/ID, service, account/region, IaC stack/owner, dependencies, cost class, retention, recovery, and deletion behavior.
- [ ] GE-103-004 — Implement `SUSPENDED_LOGICAL` that immediately revokes sessions, routing, identity/integration access, scheduled starts, and writes according to policy while preserving infrastructure; never label it cost-free.
- [ ] GE-103-005 — Implement dependency-ordered `HIBERNATED_ZERO_RUNTIME` plan with last activity, in-flight work, export/snapshot, legal/retention blockers, expected retained resources/cost, recovery point, reactivation time, destructive steps, approvals, and rollback boundary.
- [ ] GE-103-006 — Drain traffic/jobs; disable login/app-client/IdP/SCIM/service accounts, routing, webhooks, connectors, event sources, schedules, notifications, Relay inference/ingestion, and background work without dropping in-flight state.
- [ ] GE-103-007 — Scale ECS/services/workers to zero; disable Lambda event sources/concurrency where appropriate; stop schedules/rules; drain/delete tenant queues/subscriptions/streams and dedicated runtime according to plan.
- [ ] GE-103-008 — Pause or snapshot/export/delete Aurora/RDS compute according to recovery policy; remove RDS Proxy/ElastiCache/OpenSearch/S3 Vector/Knowledge Base/SageMaker standing runtime; handle DynamoDB tables/PITR/exports deliberately.
- [ ] GE-103-009 — Inventory and eliminate avoidable edge/network standing charges: CloudFront tenant resources, WAF, API stages/custom domains, ALB/NLB, NAT gateways, EIPs, VPC endpoints, PrivateLink/VPN, DNS hosted zones/records, and other dedicated endpoints.
- [ ] GE-103-010 — Inventory and handle every retained/billable byte or control resource: S3 objects/versions/replicas/multipart, snapshots/backups, audit/legal hold, analytics, AI derivatives, logs/alarms, Secrets Manager, KMS keys/grants, Route 53, and dedicated-account security/baseline resources.
- [ ] GE-103-011 — For pooled tenants, remove tenant routing/jobs/schema/database/storage/index/key/secret/backup/dedicated resources while preserving shared cell resources required by active tenants; measure zero incremental tenant runtime rather than falsely claiming global zero.
- [ ] GE-103-012 — Show all residual hibernation charges and exact reason. `HIBERNATED_ZERO_RUNTIME` may retain priced recovery/storage/evidence and must never be displayed as $0 if it is not.
- [ ] GE-103-013 — Implement `PURGED_ZERO_INCREMENTAL_COST` only after complete export/contract/retention/legal-hold/tax/audit/cooling-off checks and a separate protected destructive human approval.
- [ ] GE-103-014 — Purge every tenant-specific billable resource and retained byte, expire backups/replicas/versions/archives, remove keys/secrets/DNS/endpoints/indexes, and close a dedicated Tenure account only when no required evidence remains.
- [ ] GE-103-015 — Retain only a minimal non-content Parent tombstone: tenant ID, lifecycle timestamps, purge-manifest digest, approvals, and evidence reference. It must contain no recoverable customer content.
- [ ] GE-103-016 — Reconcile tags/application inventory/IaC/account resources after hibernation/purge and create orphan findings with service, resource, account/region, owner, reason, expected cost, and corrective action.
- [ ] GE-103-017 — Verify Cost and Usage Report/Cost Explorer after billing settles at defined 24/48/72-hour windows. Do not mark purge zero-cost until tenant-attributable recurring usage/resources are zero within configured billing granularity.
- [ ] GE-103-018 — Implement logically suspended reactivation and hibernated reprovisioning from signed config/release plus retained recovery data; rerun migration, isolation, identity, connector, search/AI reindex, smoke, security, and cost gates.
- [ ] GE-103-019 — Make clear that a purged tenant has no recoverable content; it can only be onboarded anew from independently retained configuration/customer import.
- [ ] GE-103-020 — Implement tenant/cell/isolation migration state machine with inventory, compatibility, copy/sync, validation, identity/routing cutover, canary, rollback, and decommission.
- [ ] GE-103-021 — Prevent migration/failover to unauthorized regions or ambiguous identity issuers/callbacks.
- [ ] GE-103-022 — Implement complete tenant export: canonical records, files/versions, configuration/schema, permitted audit, mappings, data dictionary, checksums, and manifest—no platform secrets or other tenants.
- [ ] GE-103-023 — Implement offboarding, legal hold, cooling-off, access freeze, export window, deletion plan, protected approval, convergent deletion, backup expiry, tombstone, and completion evidence.
- [ ] GE-103-024 — Make purge, tenant deletion, KMS destruction, and account closure R5/non-autonomous actions requiring separate human approval.

### GE-104: Provisioning proof

- [ ] GE-104-001 — Provision a second synthetic tenant from manifest without editing business source.
- [ ] GE-104-002 — Provision/rebuild Simon configuration from manifest without manual console setup.
- [ ] GE-104-003 — Provision a corporate fixture with different terminology/workflows in the same engine.
- [ ] GE-104-004 — Demonstrate bridge or dedicated-resource plan in nonproduction and prove shared control/operations.
- [ ] GE-104-005 — Re-run identical provisioning intent and prove no duplicate resources/effects.
- [ ] GE-104-006 — Exercise failed step/retry/compensation and preserve understandable operator/customer status.
- [ ] GE-104-007 — Hibernation test proves zero active runtime while reporting every retained storage/control charge truthfully.
- [ ] GE-104-008 — Synthetic purge test deletes all tenant-specific resources/bytes, leaves only the approved tombstone, finds no orphan, and passes delayed CUR/Cost Explorer zero-incremental-cost verification.
- [ ] GE-104-009 — Reactivation test rebuilds a hibernated synthetic tenant and proves identity, data, indexes, connectors, workflows, smoke, isolation, and audit before routing.

### Phase 10 gate

- [ ] GE-GATE-10 — A validated manifest can produce, test, activate, suspend, hibernate to zero runtime, truthfully measure residual cost, purge to verified zero incremental tenant cost, reactivate where recoverable, export, migrate, and offboard through one idempotent Tenure Parent workflow with no source fork or personal/customer AWS account.

## Phase 11 — Integration Hub and external coexistence

### GE-110: Connector runtime

- [ ] GE-110-001 — Implement versioned connector catalog: capabilities, objects/events, auth, scopes, rate limits, regions, lifecycle, ownership, and status.
- [ ] GE-110-002 — Implement tenant connection instances using Secrets Manager references/OAuth grants/certificates/private networking; never expose raw secret values.
- [ ] GE-110-003 — Implement canonical mapping, field ownership, transformations, validation, custom fields, mapping versions, and test fixtures.
- [ ] GE-110-004 — Implement initial/incremental sync, polling, webhooks, batch, manual runs, cursor/watermark, idempotency, dedupe, ordering, retry/backoff, circuit breaker, DLQ, replay, and reconciliation.
- [ ] GE-110-005 — Implement create/update/delete/tombstone propagation, source-of-record by object/field, conflict state, manual resolution, and audit.
- [ ] GE-110-006 — Implement consent/purpose/classification/retention, connection disable/offboarding, deletion propagation, and data residency.
- [ ] GE-110-007 — Implement connection test, last success, lag, health, quota, certificate/secret expiry, alerts, and run logs without credentials/content leakage.
- [ ] GE-110-008 — Implement webhook signature/timestamp/replay/rotation/tenant binding and egress allowlist/private connectivity patterns.
- [ ] GE-110-009 — Ensure connector service roles/capabilities can access only the tenant, objects, actions, and secret references granted.

### GE-111: Initial connector families

Implement connectors based on actual pilot/customer priority. A roadmap record is not an available connector.

- [ ] GE-111-001 — Generic SAML/OIDC/SCIM identity connector contracts and at least one deployed test integration.
- [ ] GE-111-002 — Microsoft 365 family: Outlook/Calendar/Teams/SharePoint/OneDrive as separately scoped capabilities, or mark exact externally blocked consent.
- [ ] GE-111-003 — Google Workspace family: Gmail/Calendar/Drive with explicit scopes, sync ownership, deletion, and test tenant.
- [ ] GE-111-004 — Slack or selected messaging connector with channel/thread/user mapping, consent, retention, and source links.
- [ ] GE-111-005 — Generic REST/webhook/SFTP/file import connector with safe schema/mapping, rate/size, malware, and reconciliation.
- [ ] GE-111-006 — Finance/accounting/payment connector boundary with tokenized provider actions, request/approval/reconciliation, and no secret/payment-data leakage.
- [ ] GE-111-007 — GitHub/Atlassian/project connector boundary if enabled, with org/repo/project scope and no code-secret ingestion.
- [ ] GE-111-008 — Connector catalog visibly labels `AVAILABLE`, `BETA`, `TENURE_MANAGED`, `CUSTOMER_CONFIGURABLE`, `PLANNED`, or `UNSUPPORTED` truthfully.

### GE-112: Integration tests

- [ ] GE-112-001 — Duplicate/replayed webhook and sync run produces one effect.
- [ ] GE-112-002 — Rate limit/outage/expired credential moves to retry/alert state without data loss or secret exposure.
- [ ] GE-112-003 — Mapping/schema change is versioned, previewed, backward compatible or migration-controlled.
- [ ] GE-112-004 — Source conflict is surfaced and reconciled according to field ownership; no silent overwrite.
- [ ] GE-112-005 — Tenant A connection/secret/webhook cannot reach Tenant B.
- [ ] GE-112-006 — Offboarding disables connection and converges retention/delete/tombstone behavior.

### Phase 11 gate

- [ ] GE-GATE-11 — Integration Hub is deployed, tenant-isolated, secret-safe, observable, reconcilable, and proves the highest-priority external coexistence flows end to end.

## Phase 12 — Low-code, SDK extensions, and Marketplace shell

### GE-120: Declarative and low-code extension

- [ ] GE-120-001 — Support custom objects/fields/forms/views/workflows/reports/dashboards/translations/mappings through versioned canonical config.
- [ ] GE-120-002 — Build low-code trigger/condition/transform/action/approval/timer/connector/Relay-skill composition from certified blocks.
- [ ] GE-120-003 — Enforce typed schemas, permission manifest, cost/time/loop limits, simulation, test fixtures, audit, version, rollout, rollback, and tenant quotas.
- [ ] GE-120-004 — Prevent arbitrary network/file/process/secret/database access from low-code expressions/blocks.

### GE-121: SDK extension runtime

- [ ] GE-121-001 — Define signed package manifest for UI, connector, calculation, report, workflow action, and Relay tool extension points.
- [ ] GE-121-002 — Execute SDK code outside core processes in isolated Lambda/ECS runtime with generated least-privilege role, no ambient tenant access, explicit capabilities, egress control, CPU/memory/time/concurrency quotas.
- [ ] GE-121-003 — Implement package signing, provenance, SBOM, dependency/license/vulnerability scan, compatibility, install plan, configuration schema, health, logs, and revocation.
- [ ] GE-121-004 — Implement tenant install request, permission/impact preview, approval, test environment, activation, update, rollback, disable, uninstall, data export/cleanup.
- [ ] GE-121-005 — Implement fleet kill switch/revocation for compromised extension and incident notification.
- [ ] GE-121-006 — Do not enable third-party publishing/installation until certification and operational gates are complete.

### GE-122: Marketplace Coming soon

- [ ] GE-122-001 — Add Marketplace navigation and responsive accessible page only when feature flag says the future surface should be visible.
- [ ] GE-122-002 — Display concise “Coming soon” message for future certified modules, connectors, workflows, reports, and AI skills.
- [ ] GE-122-003 — Keep the page empty of listings, prices, install/purchase buttons, fake ratings, partner logos, or claims.
- [ ] GE-122-004 — Optional interest form is non-transactional, consent-aware, rate-limited, and clearly not a purchase/install.
- [ ] GE-122-005 — Keep publisher, purchase, payout, listing, and external package APIs disabled behind central feature flags.

### Phase 12 gate

- [ ] GE-GATE-12 — Declarative/low-code extension paths are governed; SDK sandbox meets security requirements before enablement; Marketplace ships only as an honest empty Coming soon surface.

## Phase 13 — Remaining enterprise ERP module families

Implement these as reusable modules over the common organization, seat, permission, workflow, files, audit, memory, integration, and Relay services. Do not mark a family complete from schemas or screens alone.

### GE-130: Human capital management

- [ ] GE-130-001 — Workforce/employment/job-position/worker-type/manager/location/cost-center/lifecycle foundation reconciled with canonical person/seat/assignment.
- [ ] GE-130-002 — Recruiting requisition/candidate/application/interview/evaluation/offer/hire/talent-pool flow.
- [ ] GE-130-003 — Onboarding documents/equipment/access/training/policies/intros/30-60-90/seat-memory briefing.
- [ ] GE-130-004 — Time/attendance/schedule/leave/holiday/overtime/time-off approvals and payroll export/integration.
- [ ] GE-130-005 — Compensation grades/bands/pay/bonus/equity references/review budgets/approval with strict privacy.
- [ ] GE-130-006 — Benefits eligibility/enrollment integration and life-event boundaries.
- [ ] GE-130-007 — Performance goals/check-ins/feedback/reviews/calibration/development/succession.
- [ ] GE-130-008 — Learning catalog/curricula/assignment/completion/certification/expiry/compliance.
- [ ] GE-130-009 — Employee relations/cases with purpose separation, and offboarding authority/access/equipment/handoff/retention.
- [ ] GE-130-010 — Payroll calculation is enabled only as a separately validated jurisdictional module or certified external provider integration.

### GE-131: CRM, sales, service, and customer success

- [ ] GE-131-001 — Account/contact/relationship/lead/opportunity/stage/product/quote/activity/territory/forecast.
- [ ] GE-131-002 — Relationship ownership by durable seat, account team, introductions, history, decision makers, and continuity risk.
- [ ] GE-131-003 — Marketing consent/segments/campaigns/events/source/attribution and adapter boundaries.
- [ ] GE-131-004 — Customer onboarding/implementation/success plan/health/usage/goals/reviews/renewal/expansion/churn.
- [ ] GE-131-005 — Support cases/channels/queues/SLA/entitlement/knowledge/escalation/incident/satisfaction/root cause.
- [ ] GE-131-006 — Partner/reseller/alliance/referral/channel management.

### GE-132: Order-to-cash and revenue

- [ ] GE-132-001 — Customer/product/price book/quote/order/contract/subscription/usage model.
- [ ] GE-132-002 — One-time/recurring/milestone/seat/usage/tiered/volume/minimum/hybrid billing.
- [ ] GE-132-003 — Billing schedule/proration/amend/renew/cancel/tax-provider hook/invoice/credit.
- [ ] GE-132-004 — AR aging/dunning/dispute/payment-provider link/cash application/refund/write-off.
- [ ] GE-132-005 — Revenue schedules/performance-obligation support with governed accounting policy and no automated policy claim.
- [ ] GE-132-006 — Tenure SaaS commercial billing remains separated from tenant business ledgers while reusing safe concepts.

### GE-133: Treasury, grants, fundraising, and sponsorship

- [ ] GE-133-001 — Bank-account governance/signatories by seat/cash positioning/liquidity/forecast/transfer approvals.
- [ ] GE-133-002 — Grant opportunity/eligibility/proposal/budget/submission/award/restriction/report/milestone/draw/close.
- [ ] GE-133-003 — Donor/sponsor prospect/relationship/campaign/pledge/gift/sponsorship/designation/benefit/stewardship/renewal.
- [ ] GE-133-004 — Restricted funds, compliance dates, agreements, contacts, and durable relationship memory.

### GE-134: Inventory, order, warehouse, and logistics

- [ ] GE-134-001 — Item/product/service/variant/UOM/lot/serial/category/lifecycle/substitution master.
- [ ] GE-134-002 — Location/warehouse/bin/status/on-hand/available/reserved/in-transit/safety/reorder/cycle count.
- [ ] GE-134-003 — Receipt/put-away/transfer/pick/pack/ship/return/adjust/write-off/physical inventory.
- [ ] GE-134-004 — Demand/supply/purchase/transfer/production/replenishment planning hooks.
- [ ] GE-134-005 — Order allocation/backorder/partial/proof/RMA/carrier/rate/tracking/customs/delivery exception.
- [ ] GE-134-006 — Inventory valuation/accounting integration with tested configured methods and reconciliation.

### GE-135: Manufacturing, product, quality, and maintenance

- [ ] GE-135-001 — Product/BOM/routing/work center/instruction/version/effectivity.
- [ ] GE-135-002 — Engineering change request/order/review/release/downstream impact.
- [ ] GE-135-003 — Material plan/production plan/work order/issue/labor-machine/complete/scrap/variance.
- [ ] GE-135-004 — Quality plan/inspection/sample/nonconformance/deviation/CAPA/complaint/audit/supplier quality.
- [ ] GE-135-005 — Asset/equipment hierarchy/meter/condition/warranty/criticality/maintenance/work order/parts/downtime/reliability.
- [ ] GE-135-006 — Calibration/certification/safety procedure/permit-to-work/lockout-tagout references and evidence.
- [ ] GE-135-007 — CAD/PLM/MES/QMS/IoT integration boundaries; never claim specialized kernel/safety replacement without validated implementation.

### GE-136: Assets, facilities, real estate, and field service

- [ ] GE-136-001 — Asset registry/ownership/custody/location/condition/warranty/documents/lifecycle.
- [ ] GE-136-002 — Checkout/reservation/transfer/maintenance/loss/damage/disposal/audit.
- [ ] GE-136-003 — Property/building/floor/room/lease/occupant/capacity/utility/inspection/compliance.
- [ ] GE-136-004 — Space/move/maintenance/vendor/preventive maintenance/SLA.
- [ ] GE-136-005 — Field work/dispatch/route/mobile offline packet/checklist/evidence/parts/labor/signature/sync.
- [ ] GE-136-006 — Geospatial integrations with privacy, offline, and region controls.

### GE-137: Governance, risk, compliance, legal, and audit

- [ ] GE-137-001 — Policy draft/review/approve/publish/acknowledge/exception/supersede/retain.
- [ ] GE-137-002 — Obligation/control/process/owner-seat/evidence/test/issue/remediation mapping.
- [ ] GE-137-003 — Risk register/taxonomy/inherent-residual/appetite/treatment/KRI/incident/review.
- [ ] GE-137-004 — Control test/sample/evidence/deficiency/response/action/closure.
- [ ] GE-137-005 — Audit universe/plan/engagement/request/fieldwork/finding/response/follow-up/report.
- [ ] GE-137-006 — Legal matter/request/hold/counsel/deadline/document/privilege/spend with strict access.
- [ ] GE-137-007 — Conflict/disclosure/recusal/ethics/whistleblower/investigation/outcome with purpose separation.
- [ ] GE-137-008 — Business continuity impact/dependency/plan/exercise/invocation/recovery evidence.
- [ ] GE-137-009 — Control/evidence maps are honest; no certification claim without independent authorized assessment.

### GE-138: Strategy, planning, and advanced analytics

- [ ] GE-138-001 — Strategic themes/goals/initiatives/metrics/owner seats/targets/scenarios/assumptions/dependencies.
- [ ] GE-138-002 — Annual/rolling operational, headcount, revenue, expense, capital, cash planning and forecast.
- [ ] GE-138-003 — Governed calculation/driver/allocation engine with version, lineage, scenario, and test.
- [ ] GE-138-004 — Anomaly/trend/forecast/scenario/causal-analysis integrations with confidence/explanation.
- [ ] GE-138-005 — Board/executive packs, annotations, decision links, source drill-through, and Relay narratives.

### Phase 13 gate

- [ ] GE-GATE-13 — Every enabled enterprise module family has working end-to-end business flows, invariants, authorization, configuration, migrations, audit, memory, integration, reports, operations, and tests. Unbuilt families remain visibly `PLANNED`, never falsely available.

## Phase 14 — Industry packs, globalization, accessibility, and client platform

### GE-140: Industry-pack engine

- [ ] GE-140-001 — Define signed/versioned industry-pack manifest for terminology, org/seat templates, entities, permissions, policies, workflows, forms, reports, controls, connectors, Relay evaluations, migrations, exclusions, and supported jurisdictions/locales.
- [ ] GE-140-002 — Implement dependency/compatibility/entitlement/region/control/test validation and tenant overlay without source forks.
- [ ] GE-140-003 — Ship Simon/higher-education pack and at least one corporate/SMB pack through the same engine.
- [ ] GE-140-004 — Create truthful roadmap packs for nonprofit, public sector, healthcare, finance, manufacturing, retail, construction/real estate, energy/utilities, logistics, hospitality, and media/technology; do not label unimplemented packs available.
- [ ] GE-140-005 — Require every released pack to declare module versions, controls, residency, data classes, fixtures, test evidence, unsupported claims, and lifecycle owner.

### GE-141: Globalization

- [ ] GE-141-001 — Implement Unicode and locale-aware collation/search; BCP 47 languages, translation catalogs, fallback, tenant terminology, and user-authored content separation.
- [ ] GE-141-002 — Implement IANA time zones, UTC plus original zone context, DST-safe recurrence, business/holiday/fiscal calendars, and effective dating.
- [ ] GE-141-003 — Implement ISO currencies, precision, locale number/date/time/name/address/phone/paper/unit formats, exchange-rate source/time, and multi-currency test fixtures.
- [ ] GE-141-004 — Implement RTL/bidirectional content, non-Latin fonts/scripts, language fallback, translation completeness checks, and localization QA.
- [ ] GE-141-005 — Make data residency, model availability, identity endpoints, notifications, tax/accounting/HR features, retention, and connectors jurisdiction/region aware.

### GE-142: Accessibility and PWA

- [ ] GE-142-001 — Meet automated and manual WCAG 2.2 AA targets across login, shell, core modules, config studio, operator plane, Relay, forms, tables, charts, dialogs, and notifications.
- [ ] GE-142-002 — Keyboard/focus/order/skip/navigation, semantics/labels, contrast, reflow/zoom, reduced motion, errors/status, screen readers, captions/transcripts, and touch targets pass.
- [ ] GE-142-003 — Ensure tenant branding cannot violate minimum contrast, phishing-resistant login identity, or accessible focus/status tokens.
- [ ] GE-142-004 — Implement installable PWA, responsive layouts, safe offline read/draft packets for approved workflows, background sync, conflict resolution, encryption/storage limits, and remote revocation.
- [ ] GE-142-005 — Define API/auth/sync/push/offline/device-security contracts for future native iOS/Android/macOS/Windows clients without blocking web acceptance.

### GE-143: Tenure Experience System, visualizations, and long-session quality

Treat experience quality as a production invariant. Use Monarch for calm whole-picture reporting, Vercel for precision and restrained chrome, and Perplexity for content-first source-aware AI interaction only as principle references. Do not copy their layouts, branding, assets, text, trade dress, or proprietary implementation.

#### GE-143A: Foundations and ownership

- [ ] GE-143-001 — Inventory every current UI stack, component library, CSS strategy, font, icon set, table/grid, chart library, editor, calendar, dialog, theme, breakpoint, and copied component; record duplication, accessibility debt, visual drift, and migration risk.
- [ ] GE-143-002 — Create an owned, versioned TES package consumed by tenant app, operator plane, configuration studio, public/guest surfaces, Relay, and Marketplace; prohibit business modules from maintaining parallel foundations.
- [ ] GE-143-003 — Define primitive → semantic → component → guarded tenant → user-preference token layers in a validated schema; generate CSS variables, TypeScript types, documentation, and future-native artifacts from the same source.
- [ ] GE-143-004 — Add lint/architecture rules that prevent literal colors, arbitrary spacing/shadows/z-index, unregistered fonts/icons, and direct raw primitive tokens in product modules, with a documented exception process and expiry.
- [ ] GE-143-005 — If React is canonical, evaluate and adopt Radix Primitives selectively behind owned Tenure wrappers for appropriate behaviors; pin versions and test portals, focus, layering, keyboard, touch, screen-reader, RTL, and reduced-motion behavior. Do not adopt Radix Themes as Tenure's identity.
- [ ] GE-143-006 — Create a component laboratory and documentation site with interaction controls, accessibility annotations, source links, usage guidance, anti-patterns, changelog, migration notes, and realistic enterprise fixtures.
- [ ] GE-143-007 — Establish one coherent outline icon family, sanitation rules for tenant/extension icons, and semantic icon-label requirements; remove emoji or mixed icon families from operational controls unless explicitly content-authored.
- [ ] GE-143-008 — Establish named layer/portal ownership for base, sticky, rail, header, popover, command, inspector, dialog, notification, and emergency surfaces; eliminate arbitrary stacking contests and scroll locks.

#### GE-143B: Forest-green brand, light/dark ambience, and type

- [ ] GE-143-009 — Implement a calibrated evergreen/forest ramp anchored initially at `#0F3D2E`; map actions, selection, focus, and brand-soft surfaces through semantic tokens rather than hard-coded values.
- [ ] GE-143-010 — Implement soft cool-neutral light canvases and green-charcoal dark canvases as separately art-directed themes; prohibit algorithmic inversion, full-screen pure white/black, neon accent fields, uncontrolled gradients/glow, and low-contrast gray-on-gray.
- [ ] GE-143-011 — Implement mode-specific canvas, surface, elevated surface, text, muted text, border, action, focus, information, success, warning, and danger tokens; validate WCAG contrast, color-vision differentiation, low-brightness legibility, common display gamut, and projector/washed-display conditions.
- [ ] GE-143-012 — Restrict tenant branding to validated identity/accent roles. Prevent tenant colors from changing focus, status, destructive, financial polarity, permission, data quality, link, disabled, or security meanings; automatically adjust or reject invalid accents with an explanation.
- [ ] GE-143-013 — Support `system`, explicit light, explicit dark, and optional scheduled theme without wrong-theme flash; persist safely per user/device and honor forced-colors/high-contrast platform behavior.
- [ ] GE-143-014 — Select and self-host where licensed a legible variable sans with tabular figures and global script fallback; define display/title/body/compact/label/caption/numeric roles, line heights, readable measures, font loading/fallback metrics, and tabular money/operations formatting.
- [ ] GE-143-015 — Define controlled radius, border, translucency, and elevation systems. Use depth sparingly; prohibit glass/blur where variable content, performance, contrast, or focus clarity suffers.

#### GE-143C: Shell, layout, density, and components

- [ ] GE-143-016 — Implement a calm desktop shell with collapsible primary rail, concise context header, command/search launcher, stable content canvas, and optional inspector/Relay sidecar; implement a task-first mobile shell rather than a compressed desktop rail.
- [ ] GE-143-017 — Make tenant, organization, seat, environment, and record scope visually unambiguous at every state-changing point; protect against wrong-tenant/wrong-seat actions during switching, deep linking, tab restore, and Relay tool execution.
- [ ] GE-143-018 — Implement configurable home/work surfaces emphasizing attention, commitments, continuity/memory quality, anomalies, and recent decisions; avoid equal-weight card walls and require canonical-record drill-through for every metric.
- [ ] GE-143-019 — Create responsive templates for overview, record, master-detail, queue, grid, board, calendar, builder, canvas, report, Relay, and high-risk operations with defined action hierarchy, scroll ownership, sticky behavior, breakpoints, and state transformations.
- [ ] GE-143-020 — Implement governed comfortable and compact density on a four-pixel grid. Preserve readable type, accessible touch targets, focus, labels, error content, and safety context in every density.
- [ ] GE-143-021 — Implement owned form/control patterns for international name/address/phone, locale number/currency, time zone/DST, date ranges, recurrence, calculated fields, attachments, structured editors, autosave/draft recovery, validation, conflict, and recoverable failure.
- [ ] GE-143-022 — Implement the complete component-state matrix where applicable: default, hover, active, focus-visible, selected, disabled, read-only, loading, geometry-matched skeleton, empty, no results, error, denied, stale, offline, syncing, conflict, partial, archived, pending purge, and high risk.
- [ ] GE-143-023 — Implement an owned virtualized data-grid contract for keyboard navigation, selection, pin/resize/reorder, grouping, aggregation, saved views, filters, export, bulk operation, permissions, localization, printing, deep links, and accessibility; prevent domain modules from coupling directly to a vendor grid API.
- [ ] GE-143-024 — Make consequential results persistent in the relevant record/activity surface; never use a transient toast as the sole confirmation, error, approval, export, or destructive-operation record.
- [ ] GE-143-025 — Standardize destructive and cross-organization previews with exact target, tenant/org/seat scope, affected count, downstream effects, approvals, recovery/undo window, retention/legal-hold impact, cost impact, and audit consequence.

#### GE-143D: Enterprise visualization platform

- [ ] GE-143-026 — Build an owned chart/visualization API with semantic tokens, deterministic series/category identity, standard interaction/tooltip/legend/filter contracts, responsive layouts, export/print, authorization, and source drill-through; keep business modules independent of vendor configuration.
- [ ] GE-143-027 — Select one approved standard chart engine and use narrowly imported D3 modules for specialized Sankey, organizational, provenance, and dependency views; document bundle, accessibility, performance, licensing, and maintenance decisions.
- [ ] GE-143-028 — Implement governed line/area, sorted/grouped/stacked bar, dot/bullet, progress/variance, restrained donut, Sankey/alluvial, hierarchy/network, timeline/Gantt/calendar, heatmap, histogram/box/scatter, waterfall, and justified geographic patterns with a chart-selection guide.
- [ ] GE-143-029 — Require every visual to expose question/title, definition, unit, grain, source, time zone, freshness, filters, comparison basis, missing/estimated data, permission scope, annotation, and record-level drill-through.
- [ ] GE-143-030 — Provide accessible summaries, keyboard exploration or equivalent controls, screen-reader semantics, a synchronized table/list alternative, non-color encoding, color-vision-safe palettes, zoom/text scaling, and downloadable accessible data for every visualization.
- [ ] GE-143-031 — Implement a production Sankey pattern for cash flow, budget allocation, request/approval routing, workflow transitions, information lineage, seat handoffs, integration traffic, and tenant cost decomposition with source→destination clarity, direct labels, search/highlight, Top-N + Other, small-flow aggregation, cycle handling, absolute/percentage modes, filters, zoom/staged expansion, and record drill-through.
- [ ] GE-143-032 — Test Sankey at small, medium, large, and pathological graph sizes. It must aggregate or switch representation before labels become unreadable; prohibit a decorative forest of hairlines or unsupported causal interpretation.
- [ ] GE-143-033 — Prohibit 3D/perspective distortion, decorative gauges, exploding pies, unjustified dual axes, silent truncated axes, rainbow categorical scales, status colors reused arbitrarily, hidden denominators, and visualized AI numbers without canonical provenance.
- [ ] GE-143-034 — Connect finance, workflow, org/memory, project, risk/control, integration, AI-cost, and tenant-fleet dashboards to canonical read models; no duplicated client-side business calculations or fake placeholder metrics may survive production paths.

#### GE-143E: Relay, comfort, performance, and evidence

- [ ] GE-143-035 — Implement Relay as universal composer plus sidecar/focused/record-scoped modes with visible tenant, seat, record scope, source boundary, evidence, freshness, uncertainty/conflict, and canonical navigation.
- [ ] GE-143-036 — Render Relay actions as structured before/after previews showing objects, fields, permissions, policies, cost, side effects, approval, idempotency, and reversibility; chat prose alone is not approval UX.
- [ ] GE-143-037 — Prevent streaming layout thrash, scroll theft, input loss, and reading-position loss; show per-attachment parse status and use the governed chart API for AI-generated visualizations.
- [ ] GE-143-038 — Implement restrained 120–220 ms standard motion, continuity-preserving spatial transitions, complete reduced-motion alternatives, and no continuous decorative background movement, forced sound, or forced haptics.
- [ ] GE-143-039 — Build a humane notification/work-inbox model with `needs action`, `watching`, `delegated`, `waiting`, and `informational`; add bundling, priority, quiet hours, channel choice, and unsubscribe/delegation policy; prohibit urgency theater, vanity streaks, and red-dot proliferation.
- [ ] GE-143-040 — Define route-level budgets for JavaScript/CSS/font/media, Core Web Vitals, input latency, search/command response, route transition, grid scroll, chart manipulation, memory, and long-task count across supported device/network tiers; enforce them in CI and staging telemetry.
- [ ] GE-143-041 — Implement safe progressive loading and virtualization for large tables, graphs, timelines, conversations, editors, and builders without breaking accessibility, selection, printing/export, deep links, back/forward, or scroll restoration.
- [ ] GE-143-042 — Run light/dark/high-contrast, comfortable/compact, responsive, localization/long-string/RTL, keyboard, screen-reader, touch, zoom/reflow, color-vision, forced-color, reduced-motion, offline/degraded, and real-data-density matrices for all critical surfaces.
- [ ] GE-143-043 — Run observed 30-minute, 90-minute, and multi-hour representative work sessions. Measure eyestrain/self-reported fatigue, task confidence, misclicks, backtracking, navigation reversals, interruption recovery, and time-to-first-correct-action; remediate material findings before acceptance.
- [ ] GE-143-044 — Add deterministic visual regression baselines for governed breakpoints/themes/states, component interaction tests, accessibility automation plus manual notes, performance evidence, and screenshot review using realistic and extreme data—not only pristine fixtures.
- [ ] GE-143-045 — Migrate existing surfaces incrementally with compatibility adapters and a deprecation ledger; delete replaced visual foundations only after usage proves no consumers, and do not perform an unsafe all-at-once rewrite.
- [ ] GE-143-046 — Require every new or extension-provided surface to pass TES conformance. Experiments remain flagged and cannot become broadly available until their successful patterns graduate into the versioned system.

### Phase 14 gate

- [ ] GE-GATE-14 — Industry-pack delivery, localization, global time/currency behavior, accessibility, PWA/offline foundations, TES conformance, forest-green light/dark ambience, enterprise visualization integrity, Relay interaction quality, performance budgets, and observed long-session comfort are tested across representative tenants, roles, devices, data densities, and locales.

## Phase 15 — Security, privacy, governance, and evidence

### GE-150: Threat model and security controls

- [ ] GE-150-001 — Create and maintain threat model covering tenant resolver, authentication/federation, sessions, authorization, data isolation, files, workflows/finance, integrations, Relay/RAG/tools, provisioning/deployment, support, hibernation/purge, and extensions.
- [ ] GE-150-002 — Convert threats into owned controls and automated/manual tests; record residual risk, compensating control, owner, expiry, and approval.
- [ ] GE-150-003 — Implement edge/network controls: WAF/rate/bot, origin protection, private stateful services, least security groups, VPC endpoints, controlled egress, PrivateLink/VPN patterns, DNS/certificate monitoring.
- [ ] GE-150-004 — Implement app controls: input/output, CSRF, Origin/CORS, CSP/frame, XSS, injection, SSRF, mass assignment, object/field authorization, request-size/type, websocket revalidation, webhook replay.
- [ ] GE-150-005 — Implement file controls: quarantine, malware, MIME/polyglot/archive bomb, active content, preview sandbox, unsafe URL, checksum, authorized short-lived delivery.
- [ ] GE-150-006 — Implement data perimeter and KMS/secrets controls by account/region/tenant tier, with rotation, grants, recovery, and no secret leakage.
- [ ] GE-150-007 — Implement GuardDuty/Security Hub/Inspector/Macie/Access Analyzer/Config/CloudTrail integration according to actual account maturity and cost, with centralized findings.
- [ ] GE-150-008 — Implement dependency/SCA/license, secret, SAST, IaC policy, container, SBOM/provenance, and patching gates.

### GE-151: Privacy and retention

- [ ] GE-151-001 — Implement data inventory/classification, owner/steward, source, purpose, lawful/contract basis, residency, retention, sharing, and model/provider transparency.
- [ ] GE-151-002 — Implement privacy notice/consent records, marketing consent, configurable minor/child hooks, and jurisdiction policy.
- [ ] GE-151-003 — Implement access/correction/export/delete/restrict/object workflows where configured, with identity verification, exceptions, legal hold, and audit.
- [ ] GE-151-004 — Implement field/record/module/purpose access, masking/tokenization/minimization, DLP hooks for export/messages/connectors/AI/support.
- [ ] GE-151-005 — Enforce that tenant content does not train a shared model; any future model-improvement program requires separate explicit legal, tenant, data, and pipeline controls.
- [ ] GE-151-006 — Implement retention/disposition across relational, object versions/replicas, indexes, analytics, caches, connectors, audit, backups, AI derivatives, hibernation, and offboarding.

### GE-152: Compliance/evidence readiness

- [ ] GE-152-001 — Create control/evidence map for SOC 2/ISO 27001/privacy/FERPA/accessibility and applicable future regimes with `IMPLEMENTED`, `PARTIALLY_IMPLEMENTED`, `PLANNED`, `NOT_APPLICABLE`; do not claim certification.
- [ ] GE-152-002 — Link each implemented control to code/config, owner seat, test, frequency, evidence location, exception, and remediation.
- [ ] GE-152-003 — Create customer-facing security/privacy architecture truth that matches actual implementation and current certifications.
- [ ] GE-152-004 — Implement evidence retention, integrity verification, access, and export without leaking other tenants or platform secrets.

### GE-153: Security acceptance

- [ ] GE-153-001 — No critical/high security finding remains unresolved without named approved risk acceptance, compensating control, owner, and expiry.
- [ ] GE-153-002 — Secret scanning and log tests prove tokens/passwords/OTPs/assertions/invitation tokens/client secrets/private keys/customer content are absent from prohibited locations.
- [ ] GE-153-003 — OIDC/IAM negative tests prove read-only cannot write, dev cannot access prod, unapproved repo/branch/environment cannot assume role, and `iam:PassRole` is bounded.
- [ ] GE-153-004 — Cross-tenant, support, Relay, extension, export, and hibernation/purge privilege tests pass.

### Phase 15 gate

- [ ] GE-GATE-15 — Threat model, security/privacy controls, evidence map, supply chain, IAM, data lifecycle, and high-risk negative tests are implemented and no false compliance claim exists.

## Phase 16 — Reliability, observability, operations, and FinOps

### GE-160: SLO and resilience

- [ ] GE-160-001 — Define approved SLI/SLO, latency, durability, RPO, RTO, maintenance, dependency, and degradation per control plane, identity, transactional modules, audit/outbox, files, search/Relay, integrations, and tenant tier.
- [ ] GE-160-002 — Implement health/readiness, timeouts, circuit breakers, bounded retries/jitter, bulkheads, queue backpressure, DLQ, replay, and graceful degradation.
- [ ] GE-160-003 — Implement cell capacity metrics/admission, noisy-neighbor limits, autoscaling, shard/new-cell policy, and tenant migration trigger.
- [ ] GE-160-004 — Ensure control-plane/search/Relay/integration outage does not grant access, corrupt canonical data, or disable core ERP unnecessarily.
- [ ] GE-160-005 — Prevent failover/cross-region inference/replication that violates residency or identity issuer/callback constraints.

### GE-161: Backup, restore, and disaster recovery

- [ ] GE-161-001 — Apply/monitor Aurora PITR/snapshots, DynamoDB PITR/exports, S3 version/retention/approved replication, config/IaC/artifact/secrets/KMS recovery, and account-level backup policy.
- [ ] GE-161-002 — Perform isolated nonproduction restore drills for relational, object, configuration, identity metadata, and full synthetic tenant; verify invariants/isolation and measure RPO/RTO.
- [ ] GE-161-003 — Define and test backup-and-restore/pilot-light/warm-standby/multi-region patterns by tier; do not add expensive active-active without a requirement.
- [ ] GE-161-004 — Create runbooks and exercises for region/cell outage, Cognito/IdP, database, bad config/release, queue, connector, Bedrock/model, search, compromised account/role, and audit failure.

### GE-162: Observability and incident operations

- [ ] GE-162-001 — Implement structured redacted logs, metrics, traces, audits, and business events with environment/account/region/cell/service/release/config/tenant-safe ID/trace/operation/outcome/latency/safe error.
- [ ] GE-162-002 — Create cell/service/tenant/identity/workflow/finance/search-Relay/integration/deployment/security/backup/cost dashboards and actionable alarms.
- [ ] GE-162-003 — Implement tenant-aware SLO/burn alerts, synthetic canaries, certificate/secret expiry, index freshness, connector lag, DLQ, provisioning duration, and hibernation residual-cost findings.
- [ ] GE-162-004 — Implement incident records with severity, command roles by seat, tenant scope, timeline, evidence, communications, decisions, mitigations, root cause, actions, and memory.
- [ ] GE-162-005 — Create executable runbooks for every high-severity condition and test them through game days/tabletops.

### GE-163: FinOps and metering

- [ ] GE-163-001 — Enforce cost allocation tags and application meters by environment/account/region/cell/tenant/isolation/module/service/workload/release/owner.
- [ ] GE-163-002 — Meter active users/seats/modules/storage/files/workflows/API/events/connectors/search/export/report and Relay tokens/reasoning/cache/embeddings/parser/vector/rerank/tool costs.
- [ ] GE-163-003 — Build tenant/cell/module unit economics, gross-margin view, present/forecast cost, budget, quota, anomaly, and owner workflows.
- [ ] GE-163-004 — Implement per-tenant rate/concurrency/storage/AI limits and graceful queue/degradation without weakening security/audit/backup/isolation.
- [ ] GE-163-005 — Evaluate log/object lifecycle, serverless scale-to-low, NAT/network cost, dedicated resources, reservations/savings only with measured evidence.
- [ ] GE-163-006 — Include cost impact in tenant placement, config preview, connector/model/extension promotion, and hibernation/purge plan.

### Phase 16 gate

- [ ] GE-GATE-16 — Approved SLOs, resilience, restore/DR evidence, dashboards/alarms/runbooks, tenant-aware costs, and zero-runtime/zero-incremental-cost verification are operational.

## Phase 17 — CI/CD, release, migration, and production readiness

### GE-170: Workflow suite

- [ ] GE-170-001 — PR CI: deterministic install, format/lint/type/unit/property/integration/contract/migration/config/IaC/build/security/accessibility/AI evaluation as applicable, no deployment credentials for untrusted code.
- [ ] GE-170-002 — Manual read-only AWS inventory with sanitized short-retention evidence.
- [ ] GE-170-003 — Infrastructure plan with exact environment/account/region/cell allowlists, change set, destructive/replace/privilege/public/cost detection.
- [ ] GE-170-004 — Development deploy using OIDC, immutable artifact, migration, canary/smoke/security/isolation tests, concurrency, and safe rollback.
- [ ] GE-170-005 — Staging promotion of exact tested artifact/digests with full federation, tenant-isolation, Relay, performance, backup/restore, and rollback evidence.
- [ ] GE-170-006 — Production deploy behind protected environment reviewer, immutable SHA/digests, reviewed plan, branch/tag restriction, backup/readiness, progressive rollout, alarms, and rollback. Do not auto-approve.
- [ ] GE-170-007 — Drift detection for IaC, config, IAM/OIDC, resources, database migrations, tenant manifests, extension/model versions, and fleet release.
- [ ] GE-170-008 — Tenant provisioning, hibernation, purge, reactivation, export, migration, offboarding, rollback, identity/security canary, and credential-retirement workflows.
- [ ] GE-170-009 — All actions pinned to full SHAs, tokens minimal, concurrency/race prevention, artifacts short-lived/immutable, and logs secret-safe.

### GE-171: Release and migration

- [ ] GE-171-001 — Build once; sign/scan/promote identical artifact digest through dev/staging/canary/prod; record release manifest.
- [ ] GE-171-002 — Bind code SHA, packages/containers, IaC, database migrations, config schema/packs, prompts/tools/models, and tests in release manifest.
- [ ] GE-171-003 — Implement tenant/cell/cohort/plan/module progressive rollout, compatibility check, restrict-only kill switch, canary, alarm stop, and rollback.
- [ ] GE-171-004 — Implement expand/backfill/dual-compatible/verify/switch/contract database migrations, tenant checkpoint/throttle/restart, and forward-fix/restore.
- [ ] GE-171-005 — Implement config and industry-pack migrations with deterministic transform, diff, old version, simulation, approval, rollout, and rollback.
- [ ] GE-171-006 — Implement search/vector/analytics rebuild without blocking canonical writes and workflow in-flight definition version safety.
- [ ] GE-171-007 — Prove restart/redeploy is non-destructive and seed/bootstrap cannot alter customer data.

### GE-172: Performance and scale

- [ ] GE-172-001 — Define realistic load models for login/tenant resolver, `/me`, authorization, module transactions, workflow, search, Relay, files, connectors, provisioning, and reporting.
- [ ] GE-172-002 — Measure p50/p95/p99, throughput, saturation, cost, and errors; set gates/alarms and record test environment.
- [ ] GE-172-003 — Test large tenant schemas, many seats/members, deep/matrix org graph, high workflow concurrency, multi-currency finance, large files, multimodal indexes, and connector backlogs.
- [ ] GE-172-004 — Test cell saturation/noisy neighbor/admission/new-cell and dedicated-tenant placement.
- [ ] GE-172-005 — Optimize only from profiles/evidence; preserve correctness and isolation.

### GE-173: Production readiness review

- [ ] GE-173-001 — Complete architecture, threat, data, privacy, accessibility, operations, support, DR, cost, and product readiness reviews with owners/evidence.
- [ ] GE-173-002 — Resolve all critical/high security and data-integrity failures; no skipped test or broad exception hides them.
- [ ] GE-173-003 — Produce exact production plan, migration, capacity, cost, backup, canary, rollback, incident, communications, and approval package.
- [ ] GE-173-004 — Keep production apply paused behind protected human approval; destructive steps are separate.
- [ ] GE-173-005 — After approved production deployment, run safe smoke/canary/isolation/auth/metric tests, monitor elevated window, and record actual evidence.

### Phase 17 gate

- [ ] GE-GATE-17 — CI/CD, immutable promotion, migration, performance, drift, rollback, and production-readiness evidence are complete; production authority remains protected.

## Phase 18 — Document convergence, current-system truth, and extension ledger

This and all later phases execute the complete `EXT-*` checklist from the Global ERP Implementation Extension. `GE-*` orchestration gates do not replace `EXT-*` child evidence.

### GE-180: Unified authority and current-state audit

- [ ] GE-180-001 — Locate the canonical Bible and extension, verify their versions/checksums, import every `EXT-*` item into the execution ledger, and create one combined verification matrix without divergent copies.
- [ ] GE-180-002 — Map every existing architecture, implementation, migration, localization, payroll, bank, UAT, cutover, support, and decommission artifact to the canonical document/object that owns it; identify contradictions and stale claims.
- [ ] GE-180-003 — Audit `https://d2kj4iy5i37kfd.cloudfront.net/` and the intended custom domain through authorized read-only test sessions across all reachable roles/routes/states/themes/viewports; inventory console/browser errors and actual API behavior without production mutation.
- [ ] GE-180-004 — Trace the visible `Operator secret` sign-in and its backend/session/storage/authorization path. Prove it is impossible in production or replace it with Bible-approved Cognito/federated operator identity; never migrate or print secret values.
- [ ] GE-180-005 — Produce current-to-target gap maps for product function, AWS, identity/security, tenancy, data, UX/TES, implementation control, migration, localization/payroll/banking, testing, cutover, hypercare, and retirement.
- [ ] GE-180-006 — Execute and evidence every `EXT-000-*` item.
- [ ] GE-180-007 — Reconcile the observed duplicate/contradictory `GE-020-005` rows, repeated Phase 1 batch, malformed finding owners, superseded 552-item total, and every progress-calculation source; enforce stable unique canonical requirement IDs.
- [ ] GE-180-008 — Correct the reported inference that denied Organizations API calls prove no AWS Organization exists. Record permission-limited unknown until authoritative caller/Organizations evidence establishes truth.
- [ ] GE-180-009 — Reconcile the active tenant whose migration evidence simultaneously says cell transport is unwired and delivered/applied. Downgrade or correct state/evidence unless an alternate authorized mechanism is proven.
- [ ] GE-180-010 — Reconcile five apparently producerless/consumerless queues, SES identity, and green DLQ alarm; prove live paths or remove through approved IaC with cost and rollback evidence.

### Phase 18 gate

- [ ] GE-GATE-18 — `GE-*` and `EXT-*` are unified, the live/repository truth is evidenced, insecure/obsolete assumptions are explicit, and implementation can proceed without guessing protected inputs.

## Phase 19 — Tenure Implementation Control Plane

### GE-190: Program truth, traceability, and durable ownership

- [ ] GE-190-001 — Execute every `EXT-010-*` requirement for the canonical implementation objects, lifecycle, tenant isolation, temporal truth, and durable-seat ownership.
- [ ] GE-190-002 — Deliver APIs, domain services, persistence, events/outbox, authorization, audit, memory capture, search/reporting projections, and TES workbench—not schema-only objects.
- [ ] GE-190-003 — Make requirement → decision/process → configuration/code/mapping/integration/control → test/training/cutover/support traceability queryable and enforceable.
- [ ] GE-190-004 — Prove approvals bind exact artifact versions and health/readiness cannot be manually painted green over failed critical gates.
- [ ] GE-190-005 — Prove implementation handoff when program owner/process owner/data lead/cutover lead occupants change while history and current authority remain correct.

### Phase 19 gate

- [ ] GE-GATE-19 — Every `EXT-010-*` item passes and implementation knowledge itself becomes governed institutional memory.

## Phase 20 — Environment and implementation landscape engine

### GE-200: Purpose-bound environments and promotion

- [ ] GE-200-001 — Execute every `EXT-020-*` requirement and implement all logical environment classes from the extension, combining physical environments only under the strictest applicable controls.
- [ ] GE-200-002 — Generate environment manifests and AWS plans with purpose, versions, data policy, identity/access, integrations, Relay, cost, expiry, entry/exit, restore, and destruction.
- [ ] GE-200-003 — Implement production-derived-data exception, referentially consistent masking/tokenization, leakage scan, purpose access, expiry, and evidence; deny routine production clones.
- [ ] GE-200-004 — Implement immutable code/config/mapping/pack/connector promotion, environment comparison, gold/preproduction semantics, drift detection, and rollback.
- [ ] GE-200-005 — Prove automatic ephemeral teardown, hibernation versus purge truth, orphan scanning, and residual-cost verification.

### Phase 20 gate

- [ ] GE-GATE-20 — Every `EXT-020-*` item passes; environment purpose, data, access, versions, cost, and end-of-life are enforced by the engine.

## Phase 21 — Staffing models and universal journal

### GE-210: Global organization and accounting foundation

- [ ] GE-210-001 — Execute every `EXT-030-*` requirement for position-controlled, pooled/job-managed, mixed, and non-workforce staffing while preserving person/seat/assignment separation.
- [ ] GE-210-002 — Implement staffing capacity, FTE/headcount budget, vacancy/overfill, matrix/interim/delegation, mode migration, continuity, reconciliation, and history.
- [ ] GE-210-003 — Implement business event → accounting event → effective rule → subledger entry → validated journal → ledger/book posting → reporting/consolidation projection.
- [ ] GE-210-004 — Prove immutable balanced posting, multi-currency, multi-ledger/book/accounting-basis, intercompany, correction/reversal, period controls, idempotency, concurrency, and drill-through.
- [ ] GE-210-005 — Demonstrate that SAP/Oracle/Workday source concepts map through adapters rather than controlling Tenure's canonical staffing or journal model.

### Phase 21 gate

- [ ] GE-GATE-21 — Every `EXT-030-*` item passes and enterprise foundation choices are global, effective-dated, reconciled, and historically reconstructable.

## Phase 22 — Localization and statutory-content engine

### GE-220: Effective-dated jurisdiction packs

- [ ] GE-220-001 — Execute every `EXT-040-*` requirement for signed localization packs, authoritative sources, applicability, effective dating, certification lifecycle, simulation, promotion, and withdrawal.
- [ ] GE-220-002 — Implement regulatory change intake through source snapshot, specialist interpretation, affected-tenant analysis, executable change, golden/boundary regression, approval, notification, activation, monitoring, and emergency correction.
- [ ] GE-220-003 — Build New York proving content for NYS-45 family, Paid Family Leave, applicable local/employer content, SHIELD controls, and conditional DFS Part 500 mappings without embedding volatile values in core code.
- [ ] GE-220-004 — Build a structurally conflicting second-jurisdiction fixture to prove no New York/US hard-coding.
- [ ] GE-220-005 — Enforce honest capability/certification language and prevent geography-only or logo-only availability.

### Phase 22 gate

- [ ] GE-GATE-22 — Every `EXT-040-*` item passes; regulatory content is versioned executable evidence, not static prose or scattered code.

## Phase 23 — Payroll capability and certification factory

### GE-230: Payroll boundary, provider orchestration, and exact-scope proof

- [ ] GE-230-001 — Execute every `EXT-050-*` requirement and implement `UNAVAILABLE`, `EXPORT_ONLY`, `PROVIDER_ORCHESTRATED`, `SHADOW_CALCULATION`, and exact-scope `TENURE_NATIVE_CERTIFIED` modes.
- [ ] GE-230-002 — Implement payroll domain/state, effective-date/retro/off-cycle/correction/reversal/cutoff, privacy, SoD, bank-change security, provider distrust/validation, and traceability.
- [ ] GE-230-003 — Implement provider input/output/acknowledgement/error/replay contracts and payroll-to-journal/payment/filing/reconciliation boundaries.
- [ ] GE-230-004 — Build certification artifacts, golden personas, expected element/balance/payment/journal/payslip/filing results, parallel runs, tolerances, support, expiry, and revocation.
- [ ] GE-230-005 — Keep release, filing, or native availability disabled for uncertified/expired scope and state exactly what Tenure versus the provider performs.

### Phase 23 gate

- [ ] GE-GATE-23 — Every `EXT-050-*` item passes for each enabled payroll scope; all other scopes are visibly unavailable or provider-bounded.

## Phase 24 — Enterprise migration factory

### GE-240: Discover, map, transform, rehearse, reconcile, and cut over

- [ ] GE-240-001 — Execute every `EXT-060-*` requirement across tenant-isolated source registry, S3 zones, discovery/profile, mapping, cleansing, DAG sequencing, immutable extraction, transformation, load, mock conversion, reconciliation, delta, and adapters.
- [ ] GE-240-002 — Implement executable mappings with source/target semantics, lineage, crosswalks, quality, transforms, examples, tests, approval, and safe workbook import/export.
- [ ] GE-240-003 — Implement bounded streaming/chunk workers, signed packages, idempotency/checkpoint/restart/cancel, backpressure, tenant fairness, cost budgets, quarantine, and safe telemetry.
- [ ] GE-240-004 — Prove iterative mocks and final rehearsal with production-scale volume, exact final candidates, roles, timing, delta, defects, reconciliation, rollback, and cost.
- [ ] GE-240-005 — Enforce zero unexplained authority/money/payroll/payment/legal-hold/required-record variance and signed domain reconciliation.
- [ ] GE-240-006 — Implement SAP, Oracle, Workday, database, API/file, and legacy adapter catalog without external middleware becoming a required Tenure runtime.

### Phase 24 gate

- [ ] GE-GATE-24 — Every `EXT-060-*` item passes; the factory can repeat a failed/restarted migration and prove exactly what moved, changed, failed, reconciled, and remained.

## Phase 25 — High-volume integration and transformation runtime

### GE-250: Files, APIs, events, streams, and connector certification

- [ ] GE-250-001 — Execute every `EXT-070-*` requirement for canonical envelopes, supported patterns, multipart ingest, splitter/aggregator, transformation sandbox, delivery/error semantics, schema compatibility, and certification.
- [ ] GE-250-002 — Prove no unbounded file enters memory/browser, no raw payload enters general logs, archive/XXE/formula/malware attacks fail, and incomplete/temp artifacts expire.
- [ ] GE-250-003 — Prove business idempotency, retry/backoff/rate limit, partial failure, ordering, replay, DLQ/redrive, circuit breaker, kill switch, outage/recovery, and reconciliation.
- [ ] GE-250-004 — Enforce per-tenant/cell/provider throughput, concurrency, memory, CPU, duration, egress, and spend budgets.
- [ ] GE-250-005 — Certify each connector against exact provider/system/version and display `PLANNED`, `TEST`, `CERTIFIED`, `AVAILABLE`, `DEGRADED`, `REVOKED`, or equivalent honest state.

### Phase 25 gate

- [ ] GE-GATE-25 — Every `EXT-070-*` item passes and every production connector is bounded, failure-aware, reconcilable, secure, supportable, and truthfully labeled.

## Phase 26 — Banking and ISO 20022

### GE-260: Payment instruction, acknowledgement, settlement, and reconciliation

- [ ] GE-260-001 — Execute every `EXT-080-*` requirement for protected bank/beneficiary master, exact ISO registry, payment lifecycle, message adapters, transport security, reconciliation, and bank certification.
- [ ] GE-260-002 — Implement exact message version plus official/market/scheme/country/bank/channel/tenant usage overlays; never treat `pain.001` or another family as one permanent schema.
- [ ] GE-260-003 — Bind approved payment batches to immutable generated artifact/message digests and block post-approval mutation, replay, duplicate effect, and self-approval.
- [ ] GE-260-004 — Prove technical acknowledgement, acceptance/rejection, processing, settlement/return, and reconciliation remain separate states including partial/out-of-order responses.
- [ ] GE-260-005 — Execute bank sandbox/certification golden, negative, volume, cutoff/holiday, return/recall/reversal/fee/FX/outage/replay/rotation cases before production enablement.
- [ ] GE-260-006 — Keep money movement within certified bank/provider systems; protect production payment release behind separate human approval.

### Phase 26 gate

- [ ] GE-GATE-26 — Every `EXT-080-*` item passes for each enabled bank/channel/message; no XML-generation or transport-only capability is misrepresented as bank certification or settlement.

## Phase 27 — Business E2E, UAT, defects, and readiness

### GE-270: Acceptance under realistic roles and failures

- [ ] GE-270-001 — Execute every `EXT-090-*` requirement for scenario contracts, UAT governance, severity, readiness, risk acceptance, and accountable sign-off.
- [ ] GE-270-002 — Build scenario libraries covering happy, denial, SoD, duplicate/concurrency, partial, retry, correction/reversal, effective-date/time-zone/locale boundaries, outage, malicious input, recovery, and Relay safety.
- [ ] GE-270-003 — Run testers under representative least-privileged seats and use reconciled safe fixtures; super-admin-only testing is insufficient.
- [ ] GE-270-004 — Prevent date-driven severity downgrades, hidden skipped tests, workaround-as-pass, and averaged-away critical gates.
- [ ] GE-270-005 — Obtain business-owner acceptance by domain and end-to-end process, with formal delegation where another occupant signs.

### Phase 27 gate

- [ ] GE-GATE-27 — Every `EXT-090-*` item passes and the system is accepted by evidence rather than project optimism.

## Phase 28 — Cutover Command Center and go-live

### GE-280: Rehearsed activation, go/no-go, and recovery

- [ ] GE-280-001 — Execute every `EXT-100-*` requirement and deliver the TES Cutover Command Center with state, tasks, dependencies, roles, evidence, communications, decisions, and rollback boundary.
- [ ] GE-280-002 — Implement strategy, integrated plan, minute/time-window runbook, freeze/coexistence, T-horizon planning, contact/escalation, and exact-version task binding.
- [ ] GE-280-003 — Rehearse final conversion, integrations, identity, activation, smoke/business validation, communications, go/no-go, injected failure, rollback, and forward recovery using final candidates.
- [ ] GE-280-004 — Record protected `GO`, `NO_GO`, `PAUSE_AND_REASSESS`, or `ROLLBACK` authority and evidence; Claude/Relay cannot vote, approve, or bypass.
- [ ] GE-280-005 — Keep production activation paused behind the exact protected human approval, release/config/mapping/pack digests, and last-reversible-point statement.

### Phase 28 gate

- [ ] GE-GATE-28 — Every `EXT-100-*` item and rehearsal passes; no real go-live occurs without protected current evidence and recovery authority.

## Phase 29 — Hypercare and service transition

### GE-290: Stabilization, support, and successor-ready operations

- [ ] GE-290-001 — Execute every `EXT-110-*` requirement for coverage, JIT support, cadence, metrics, change/data correction, workarounds, exit, knowledge, and transition sign-off.
- [ ] GE-290-002 — Implement safe dashboards and control checks for identity, workflow, integrations, data, finance, payroll/bank, Relay, reliability, cost, cases, adoption, and knowledge gaps.
- [ ] GE-290-003 — Prove emergency change remains tested/approved/reversible/evidenced and support cannot directly edit databases or retain local copies.
- [ ] GE-290-004 — Simulate occupant absence and handoff across on-call, process owner, vendor liaison, and service-owner seats.
- [ ] GE-290-005 — Prevent hypercare exit until critical cycles, stability, documentation, runbooks, access, DR, renewals, training, support simulation, and residual risk pass.

### Phase 29 gate

- [ ] GE-GATE-29 — Every `EXT-110-*` item passes and accepting service owners can operate the tenant without the original implementation team.

## Phase 30 — Legacy system and data retirement

### GE-300: Dependency closure, archive, revocation, destruction, and cost

- [ ] GE-300-001 — Execute every `EXT-120-*` requirement for complete asset inventory, lifecycle, data/legal acceptance, archive/restore, read-only window, revocation, destruction, contract closure, and tombstone.
- [ ] GE-300-002 — Reconcile application, integration, account, key/certificate, DNS/network, job, backup/snapshot/log/cache/DR, license, vendor, cloud, and hardware dependencies before retirement.
- [ ] GE-300-003 — Prove archive readability, permissions, checksum, index, retrieval, and isolated restore before removing the authoritative source.
- [ ] GE-300-004 — Reconcile all AWS accounts/regions/resources and delayed cost evidence; disclose retained artifacts/cost/owner/end date.
- [ ] GE-300-005 — Keep physical hardware destruction and legal/vendor certification under authorized humans/providers; Claude records evidence but does not perform destructive external acts.

### Phase 30 gate

- [ ] GE-GATE-30 — Every `EXT-120-*` item passes and no system is called retired while data, access, dependency, contract, license, retained copy, or cost remains unexplained.

## Phase 31 — Implementation workbench, live UX convergence, and Relay

### GE-310: Modern internal product and governed transformation copilot

- [ ] GE-310-001 — Execute every `EXT-130-*` and `EXT-140-*` requirement for implementation workbenches, live route audit, TES convergence, accessibility/performance/comfort, and Relay boundaries.
- [ ] GE-310-002 — Deliver program, landscape, process/config, migration, integration, pack/payroll/bank, test/UAT, cutover, hypercare, and decommission surfaces as one coherent forest-green TES product.
- [ ] GE-310-003 — Replace conflicting brown/gold/monospace or one-off internal-console styling only after token/component/source audit, with visual regression and no functional loss.
- [ ] GE-310-004 — Implement professional DAG/Sankey/timeline/reconciliation/variance/heatmap visuals with accessible tables, source/freshness/filter/unit/drill/export and no fake data.
- [ ] GE-310-005 — Implement permission-aware cited Relay analysis/proposals/tools and block self-approval, certification, variance acceptance, go-live, payroll/payment release, production bypass, and destruction.
- [ ] GE-310-006 — Prove every authorized route/role/state/theme/density/viewport, keyboard/screen-reader/RTL/zoom, realistic data density, visual regression, performance, and long-session comfort matrix.
- [ ] GE-310-007 — Replace direct lifecycle buttons with structured impact/diff/cost/residual-resource previews, reason/evidence, permission/step-up, SoD/approval, precondition/idempotency, confirmation, async progress, audit, and rollback/recovery while preserving safe read-only inspection.
- [ ] GE-310-008 — Build fleet search/filter/sort/saved views, health, owner, region/cell, release/config drift, lifecycle blockers, current/forecast/residual cost, last change, test-fixture/archive handling, and permission-safe bulk operations.

### Phase 31 gate

- [ ] GE-GATE-31 — Every `EXT-130-*` and `EXT-140-*` item passes; Tenure staff do not work in an inferior side-console and Relay remains a copilot rather than an authority.

## Phase 32 — Extension security, privacy, records, reliability, and FinOps

### GE-320: Cross-cutting proof

- [ ] GE-320-001 — Execute every `EXT-150-*` requirement and extend threat model/control evidence to source systems, migration, localization, payroll, banking, cutover, hypercare, support, Relay, and retirement.
- [ ] GE-320-002 — Prove tenant/program/environment isolation across data/files/jobs/queues/cache/search/logs/evidence/Relay/support and deny cross-tenant identifiers without confirming existence.
- [ ] GE-320-003 — Prove short-lived identity/JIT/step-up, secrets/key/certificate safety/rotation, signed supply chain, network/egress, privacy minimization/access expiry, legal hold, immutable audit, and safe telemetry.
- [ ] GE-320-004 — Prove restart/duplicate/partial/cancel/restore/DR/region/provider-outage behavior and independent cutover communication.
- [ ] GE-320-005 — Prove per-environment/program/run cost estimate, budget, anomaly, concurrency/auto-stop, teardown, orphan scan, hibernation residual, and purge billing verification.

### Phase 32 gate

- [ ] GE-GATE-32 — Every `EXT-150-*` item passes and extension machinery is held to the same or stronger invariants as the tenant runtime.

## Phase 33 — Unified release, verification, and production pause

### GE-330: One proof system for the whole behemoth

- [ ] GE-330-001 — Execute every `EXT-160-*` requirement and complete all extension deliverables with implemented reality rather than templates.
- [ ] GE-330-002 — Produce one final matrix covering every binding unnumbered decision, every `GE-*`, every `EXT-*`, every phase gate, and every enabled tenant/module/pack/adapter/environment/surface.
- [ ] GE-330-003 — Run and report full deterministic build, tests, migrations, IaC/config/schema/mapping/pack validation, integrations, security, isolation, accessibility, visual, performance, Relay evaluation, restore/DR, and cost proof with failures/skips.
- [ ] GE-330-004 — Prove Simon and structurally different corporate fixtures through provisioning, implementation, migration, UAT, cutover rehearsal, hypercare/support transition, and legacy-retirement rehearsal.
- [ ] GE-330-005 — Bind exact code/IaC/database/config/mapping/localization/payroll/bank/connector/Relay/test/evidence/rollback versions into signed release and tenant manifests.
- [ ] GE-330-006 — State what is production, staging, development-only, implemented-disabled, planned, uncertified, failed, blocked external, and not applicable; never collapse these states.
- [ ] GE-330-007 — Keep production apply, customer notification, go-live, payment/payroll release, destructive migration, tenant purge, account/key closure, and legacy destruction paused behind their exact human approvals.

### Phase 33 gate

- [ ] GE-GATE-33 — Every enabled scope is implemented, deployed where authorized, tested, evidenced, supportable, and honestly classified; protected production/destructive authority remains human.

## 34. Required repository deliverables

Paths may adapt to existing conventions, but every semantic deliverable is mandatory.

### Architecture and decisions

- [ ] `docs/architecture/tenure-global-system-architecture-bible.md`
- [ ] `docs/architecture/tenure-global-erp-implementation-extension.md`
- [ ] `docs/architecture/aws-current-state.md`
- [ ] `docs/architecture/resource-reconciliation.md`
- [ ] `docs/architecture/control-plane-cells-tenancy.md`
- [ ] `docs/architecture/data-isolation-and-placement.md`
- [ ] `docs/architecture/relay-ai-rag-automation.md`
- [ ] `docs/architecture/domain-module-map.md`
- [ ] `docs/architecture/implementation-control-plane.md`
- [ ] `docs/architecture/environment-landscape-and-promotion.md`
- [ ] `docs/architecture/universal-accounting-event-and-journal.md`
- [ ] `docs/architecture/localization-and-statutory-content-engine.md`
- [ ] `docs/architecture/payroll-capability-and-certification.md`
- [ ] `docs/architecture/enterprise-data-migration-factory.md`
- [ ] `docs/architecture/high-volume-integration-runtime.md`
- [ ] `docs/architecture/banking-and-iso20022.md`
- [ ] `docs/architecture/cutover-hypercare-service-transition.md`
- [ ] `docs/architecture/legacy-decommissioning.md`
- [ ] `docs/experience/tenure-experience-system.md`
- [ ] `docs/experience/token-contract-and-brand-guardrails.md`
- [ ] `docs/experience/visualization-grammar.md`
- [ ] `docs/experience/relay-interaction-contract.md`
- [ ] `docs/experience/accessibility-and-long-session-quality.md`
- [ ] `docs/experience/ui-migration-ledger.md`
- [ ] ADRs listed in the Architecture Bible with current decisions and evidence.

### Security, privacy, and operations

- [ ] `docs/security/threat-model-global-engine.md`
- [ ] `docs/security/tenant-isolation.md`
- [ ] `docs/security/identity-session-authorization.md`
- [ ] `docs/security/relay-ai-tools.md`
- [ ] `docs/security/secrets-deployment-supply-chain.md`
- [ ] `docs/privacy/data-inventory-retention-offboarding.md`
- [ ] `docs/compliance/control-evidence-map.md`
- [ ] `docs/runbooks/` for all required incidents, restore, deployment, tenant lifecycle, and cost findings.

### Configuration and tenant artifacts

- [ ] Versioned platform/region/environment/plan/industry/org/tenant schemas and validators.
- [ ] Simon/OSE signed tenant manifest and SSO handoff.
- [ ] Corporate signed tenant fixture.
- [ ] Tenant A/B isolation fixtures and dedicated/pool placement fixtures.
- [ ] Permission catalog, workflow/form/report/terminology/Relay policies.
- [ ] Generated tenant deployment, hibernation, purge, reactivation, export, migration, and offboarding manifests.
- [ ] Versioned implementation program/environment/mapping/reconciliation/localization/payroll/bank/test/readiness/cutover/hypercare/decommission schemas and validators.
- [ ] New York proving pack and a conflicting second-jurisdiction fixture with source/effective-date/test/certification metadata.
- [ ] SAP/Oracle/Workday/legacy source-adapter fixtures and exact supported-version/capability catalog without claiming unavailable production adapters.
- [ ] Mock conversion/final rehearsal, bank/provider sandbox, UAT, cutover, hypercare, and decommission synthetic evidence packs.

### Implementation evidence

- [ ] `docs/implementation/global-engine-execution-ledger.md`
- [ ] `docs/implementation/global-engine-final-verification.md`
- [ ] `docs/implementation/global-erp-extension-ledger.md` or a clearly indexed `EXT-*` portion of the unified ledger.
- [ ] `docs/implementation/global-erp-extension-final-verification.md` or one unified matrix containing every `EXT-*` row.
- [ ] Baseline/final build/test/security/accessibility/performance/evaluation results.
- [ ] TES component-laboratory build, token-schema validation, visual-regression diffs, governed breakpoint/theme/state captures, chart integrity fixtures, and long-session research findings.
- [ ] GitHub workflow run IDs, commit SHAs, artifact/container/config digests, migration versions, environments/cells, rollback identifiers.
- [ ] Sanitized AWS inventory/plan/deployment/drift/restore/cost evidence.

Do not create dozens of empty files. Each document must describe implemented reality and link to code, config, migrations, tests, workflows, and sanitized evidence.

## 35. Final verification matrix

In `docs/implementation/global-engine-final-verification.md`, include one row per checklist item and phase gate:

| ID | Requirement | Status | Code/config | Commit | Tests/result | Deployment/run/evidence | Rollback | External owner/input |
|---|---|---|---|---|---|---|---|---|

Use only `PASS`, `FAIL`, `BLOCKED_EXTERNAL`, or `NOT_APPLICABLE`. Include exact test counts, failed/skipped tests, environment/account alias/region/cell, release/config/schema/migration versions, model/prompt/tool/index versions, cost evidence, and rollback identifiers.

The executive summary must distinguish:

- Production and staging features actually deployed and verified.
- Development-only features.
- Implemented but not enabled features.
- Planned/unbuilt module families.
- External inputs/approvals.
- Known risks and failed gates.

## 36. Absolute definition of done

The complete program is done only when:

- [ ] Every enabled tenant is generated from versioned configuration and reusable IaC without a source fork or manual console dependency.
- [ ] Simon and a structurally different corporate tenant run through the same parent engine.
- [ ] Tenant A/B isolation passes across API/database/schema/cache/files/search/vector/analytics/events/jobs/websocket/connectors/support/Relay/tools.
- [ ] Cognito/SSO/SCIM, BFF sessions, temporal seat authority, centralized authorization, revocation, and audit are deployed and tested.
- [ ] Core work creates durable, provenance-rich seat/organization/resource memory and transition/handoff works.
- [ ] Relay understands all supported media, cites authorized evidence, edits/automates through typed tools, obeys risk/approval, and never accesses another tenant.
- [ ] One protected tenant intent can plan, provision, configure, migrate, verify, activate, suspend, hibernate, measure residual cost, purge to verified zero incremental cost, reactivate where recoverable, export, migrate, and offboard.
- [ ] Every visible module/integration/industry pack reports its true lifecycle; no mock, logo, schema, or screen is called available.
- [ ] Every production surface consumes TES, passes light/dark/high-contrast and comfortable/compact modes, uses guarded forest-green branding, and meets accessibility, responsive, localization, visualization, visual-regression, and performance gates.
- [ ] Critical workflows pass observed long-session testing without unresolved material eyestrain, context-loss, interaction-fatigue, or urgency-theater findings.
- [ ] Security, privacy, accessibility, backup/restore, observability, FinOps, migration, rollback, and production approval evidence pass.
- [ ] Implementation Control Plane preserves scope, decisions, mappings, tests, readiness, cutover, support, and retirement memory by tenant/program/process/seat.
- [ ] Every environment has purpose, data, access, versions, cost, expiry, and destruction; no uncontrolled production clone exists.
- [ ] Staffing and universal-journal models support global variance while preserving effective-dated authority and financial invariants.
- [ ] Localization, payroll, and banking disclose exact scope/version/certification and remain unavailable where unproven.
- [ ] Enterprise migration passes repeatable mocks, final rehearsal, delta, multi-layer reconciliation, and zero unexplained critical variance.
- [ ] UAT is signed by accountable business owners; cutover/go-no-go/rollback is rehearsed and protected; hypercare exits through measured service transition.
- [ ] Legacy systems are called retired only after data, dependency, access, contracts/licenses, retained copies, cloud cost, and destruction evidence close.
- [ ] Marketplace contains only an honest Coming soon shell until certification/runtime/commercial controls pass.
- [ ] Final verification contains evidence for every checked item and plainly lists everything unbuilt or blocked.

## 37. Prohibited shortcuts and failure modes

Do not:

- Stop after plans, `CLAUDE.md`, TODOs, diagrams, schemas, interfaces, mocks, or unrun IaC.
- Mark a checkbox because code exists but is not connected, deployed where required, tested, and evidenced.
- Deploy into personal/user/unrelated customer AWS accounts.
- Read, print, copy, encode, exfiltrate, or request GitHub/AWS/customer secret values.
- Continue routine long-lived AWS keys after OIDC is proven.
- Add AdministratorAccess, wildcard OIDC trust, unpinned actions, or untrusted deployment paths.
- Mutate/delete production, tenant data, keys, backups, accounts, or external systems without the defined protected approval.
- Hard-code Simon, one tenant, one region, one pool, one account, or one identity provider into platform core.
- Use shared cross-tenant business tables, unscoped ORM clients, or client-provided tenant authority.
- Use Cognito Groups/email/title/frontend state as authorization.
- Let Relay query raw production databases, receive credentials, authorize itself, self-approve, execute R5 actions, or treat retrieved text as instructions.
- Send customer data to a model endpoint outside the approved AWS-hosted boundary or silent cross-region path.
- Claim hibernation costs zero when retained storage/backups/logs/DNS/keys or other AWS resources still cost money.
- Claim zero incremental tenant cost before resource reconciliation and delayed CUR/Cost Explorer verification.
- Delete retained data merely to hit $0 when contract, legal hold, audit, tax, privacy, or customer recovery policy requires it.
- Represent a planned connector/industry pack/module/marketplace listing as live.
- Claim compliance, certification, performance, availability, isolation, or recovery without evidence.
- Hide failures with `|| true`, skipped tests, broad exception swallowing, fake fixtures, or softened assertions.
- Sacrifice correctness, tenant isolation, audit, backups, security, or accessibility for speed/cost.
- Clone Monarch, Vercel, Perplexity, SAP, Workday, Jira, or another product's layouts/trade dress; references provide principles, not a skin.
- Adopt raw Radix Themes, copied component defaults, a second uncontrolled UI kit, or direct vendor grid/chart APIs as Tenure's visual architecture.
- Hard-code colors, scatter local dark-mode rules, allow tenant branding to overwrite semantic status/focus/security tokens, or render pure-black/pure-white low-comfort screens.
- Ship decorative or misleading charts, unreadable Sankey hairlines, inaccessible canvas-only meaning, fake dashboard data, or visualizations without source/freshness/filter/drill-through context.
- Claim “zero fatigue” from aesthetic opinion alone; require representative observed long-session evidence and report residual findings honestly.
- Use production data in sandbox/training/local/prompt/screenshot paths outside the approved minimized-data exception.
- Claim payroll, filing, jurisdiction, bank, ISO message, or source-adapter availability from a schema, parser, logo, sample, or provider name.
- Make SAP ACDOCA, Oracle FBDI/HDL, Workday EIB/business objects, or bank XML the Tenure canonical model.
- Treat technical bank acknowledgement as acceptance, acceptance as settlement, or settlement as reconciliation.
- Accept unexplained authority, monetary, payroll/payment, legal-hold, or mandatory-record migration variance.
- Lower defect severity, widen tolerance, fake UAT, or override readiness to preserve a date.
- Let Claude or Relay approve go-live, release payment/payroll, certify legal content, accept risk/variance, or destroy production/legacy assets.
- Call hypercare complete without critical-cycle stability and accepting-service-owner evidence.
- Call legacy retired while credentials, integrations, backups, contracts, licenses, retained data, or residual cost remain unexplained.

## 38. Required final response

At the end of each execution milestone, provide a concise outcome-first report containing:

1. What now works end to end.
2. What was deployed to development, staging, and production, with workflow/run IDs and artifact/config digests.
3. Exact checked items and evidence added.
4. Tests by layer with counts/results and all failures/skips.
5. Tenant-isolation, authorization, financial/workflow, Relay, accessibility, security, restore, and cost evidence.
6. Current active/inactive/hibernated/purged tenant fleet state and any residual-cost findings without customer-sensitive content.
7. AWS/GitHub credential posture, OIDC usage, and legacy-key retirement state; confirm no secret values were exposed.
8. Simon readiness and exact external Simon IT/customer inputs still required.
9. Production approval/rollback state.
10. Unchecked/failed/blocked items with exact owner and next executable action.
11. Commit SHAs and key file paths.
12. Implementation program/environment/migration/UAT/cutover/hypercare/decommission status and every open `EXT-*` gate.
13. Exact localization/payroll/bank capability state by jurisdiction/provider/channel/version; distinguish generated, submitted, accepted, settled, reconciled, and certified.
14. Live System Studio/TES route audit outcome, authentication posture, remaining visual debt, and evidence that development-only operator-secret paths cannot reach production.

Begin now.

First inspect the complete repository and instructions, establish the execution ledger, preserve the worktree, run baseline verification, inspect GitHub configuration without secret values, and dispatch the safe read-only AWS inventory. Then follow the dependency-ordered phases continuously. Do not wait for another prompt unless a defined human-only stop condition is reached.

## END MASTER EXECUTION PROMPT

---

## Notes for Satvik before running the prompt

1. Place both the Architecture Bible and `Tenure_Global_ERP_Implementation_Extension_v1.0.md` in the Tenure monorepo under `docs/architecture/`, using the canonical filenames referenced by the prompt.
2. Run Claude Code from the monorepo root in a GitHub-authenticated environment that can create/push a branch and dispatch/read Actions.
3. Protect GitHub `bootstrap`, `staging`, `production`, tenant-purge, account-closure, and destructive environments with required human reviewers.
4. Never paste AWS keys, customer SSO secrets, or banking/integration credentials into Claude. External secrets must enter approved GitHub/AWS secret workflows.
5. Expect the engine to remain honest about scope. SAP/Workday-scale breadth is a multi-phase program; the ledger exists to prevent scaffolding from being mistaken for completion.
6. “No cost” requires a choice: retain recoverability and pay explicit residual storage/control cost, or approve irreversible purge after legal/contractual gates. The system must never conceal this tradeoff.
7. Give Claude an authorized nonproduction/test account or authenticated browser session for the full System Studio route audit. Never paste operator secrets, AWS keys, SSO secrets, bank credentials, payroll credentials, or customer data into the prompt.
8. Keep legal, payroll, tax, bank, regulator, and customer sign-offs with qualified authorized humans. Claude may prepare and test artifacts; it cannot certify or approve them.
