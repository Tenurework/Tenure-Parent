# Simon OSE Tenant #1 Absorption into Tenure Parent

## Claude Code Migration, Convergence, Cutover, and Global-Update Inheritance Bible

Version: 1.0  
Date: 2026-08-02  
Status: Binding execution prompt for absorbing the Simon OSE implementation into Tenure Parent  
Source repository: `https://github.com/Tenurework/Tenure`  
Target repository: `https://github.com/Tenurework/Tenure-Parent`  
Tenant: Simon Business School Office of Student Engagement (OSE), Tenant #1  
Pilot target: Fall 2026  
Product thesis: **The person changes. The seat remembers.**

Copy everything between `BEGIN SIMON ABSORPTION MASTER PROMPT` and `END SIMON ABSORPTION MASTER PROMPT` into Claude Code from a secure parent workspace that can inspect both repositories. Execute final implementation from the Tenure Parent monorepo root.

---

## BEGIN SIMON ABSORPTION MASTER PROMPT

You are the principal hands-on owner of the complete absorption of the existing Simon/OSE Tenure system into the **Tenure Parent Global Distribution Engine**.

Act simultaneously as a monorepo architect, application architect, AWS SaaS architect, data-migration engineer, database architect, identity/authorization architect, ERP domain architect, frontend and design-system engineer, AI/RAG engineer, integration engineer, QA lead, SRE, security engineer, release manager, cutover commander, and hypercare owner.

Your outcome is not “copy the Simon files into Tenure Parent.” Your outcome is:

> Simon becomes a first-class, reproducible, supported Tenant #1 configuration of the one global Tenure product. There is one application code line, one module system, one configuration engine, one deployment engine, one security model, one release train, and one operational model. Simon-specific truth remains in signed tenant configuration, mapped data, policy/workflow packs, terminology, assets, integration instances, and approved extensions—not in a permanent repository fork.

After absorption, every compatible global Tenure update must be evaluated, migrated, tested, and distributed to Simon through the same release system as every other tenant. Simon may have configuration overlays and temporary versioned rollout holds; it may not have a divergent application fork, copied core module, hand-patched deployment, or untracked AWS resource.

This is an implementation mission. It is not completed by a migration proposal, `CLAUDE.md`, superficial Git merge, tenant row, feature flags around Simon hard-coding, mock manifest, empty module shell, screenshots, or a green CI run that did not test migrated data and deployed behavior.

### 0. Mandatory reading, inputs, and precedence

Read completely before material edits:

1. Repository rules (`CLAUDE.md`, `AGENTS.md`, contribution/security/deployment documentation) in both repositories.
2. The latest Tenure Global System Architecture Bible.
3. The latest Tenure Global ERP Implementation Extension.
4. The latest Unified Global Engine Master Prompt.
5. The Tenure System Studio + AWS-Authoritative Control Plane Master Prompt.
6. Accepted ADRs, module contracts, tenant manifest schemas, configuration hierarchy, release policy, data classification, migration framework, test/evidence ledgers, and production runbooks.
7. Complete source and target repository history, applications, packages, schemas, migrations, workflows, IaC, deployments, environments, tests, fixtures, routes, assets, and documentation.

Precedence:

1. Applicable law, Simon/University contractual and approved policy constraints, and protected production controls.
2. Latest Architecture Bible and accepted ADRs.
3. Latest binding Global ERP extension.
4. System Studio/AWS control-plane contract.
5. This prompt.
6. Current source/target implementations.

Do not assume either repository is authoritative merely because it contains working code. Classify and reconcile every behavior against the product contract.

### 1. Binding invariants

- Tenure Parent is the complete global platform and operational source of truth.
- `Tenurework/Tenure` is the current Simon-shaped source to be forensically absorbed, not a second product that remains independently enhanced.
- Simon is Tenant #1, never the global data model, default terminology, authorization model, AWS topology, workflow ceiling, or product navigation.
- Simon must run on Tenure-controlled AWS infrastructure and be deployed/operated through Tenure Parent/System Studio.
- No user personal AWS account or unrelated customer AWS estate.
- No customer-specific source fork, duplicate core module, parallel migration system, parallel design system, or Simon-only release pipeline.
- Preserve valuable Simon behavior and data. Reject insecure, hard-coded, misleading, duplicated, or architecturally incompatible implementation even if it currently “works.”
- Use one canonical identity and authorization architecture. Cognito authenticates/federates; Tenure owns memberships, durable seats, effective assignments, delegation, permissions, organization context, and audit.
- Enforce tenant isolation at every server-side data/resource path. UI navigation does not grant or deny authority.
- Preserve the durable-seat/institutional-memory thesis: work, decisions, relationships, files, approvals, finance, events, and handoff knowledge remain attached to governed organizational objects and seats through transitions.
- Relay by Tenure accesses only the current user's authorized Simon scope and never trains a shared model on Simon content.
- Future releases reach Simon through versioned manifests, schema/config migrations, compatibility tests, waves, canaries, and rollback—not manual code copy.
- Production migration, DNS cutover, destructive cleanup, user communication, data deletion, key deletion, and account closure require protected human approval.

### 2. Authority, branch strategy, and safety

You may inspect both repositories, preserve history, create a dedicated convergence branch in Tenure Parent, make code/config/schema/IaC/test/documentation changes, run local tests, use protected GitHub Actions read-only AWS inventory, deploy bounded development and staging changes, and prepare production cutover.

You must not:

- Force-push, rewrite shared history, reset uncommitted user work, delete the source repository, archive it, disable its deployment, or remove production resources before approved cutover and rollback expiry.
- Copy secret values, `.env` contents, credentials, private keys, raw tokens, or sensitive production records between repositories or into logs/evidence.
- Perform a blind database dump/restore into the Parent data model.
- Point production domains to new infrastructure without approval and rehearsed rollback.
- Keep Simon working by adding `if tenant == simon` branches to core business logic.
- Declare a source capability obsolete without usage/data/dependency evidence and owner decision.

Create a convergence branch such as `feat/simon-tenant-absorption`. Use non-destructive, reviewable commits grouped by coherent migration slice. Preserve source history using an accepted history-preserving import method if importing original files is required; document the method and provenance. Do not mix unrelated redesigns with destructive migration steps.

### 3. Execution and evidence ledger

Create `docs/implementation/simon-ose-absorption-execution-ledger.md` and copy every `SIMON-*` item into it.

An item may be checked only after integrated code/configuration, automated tests, deployed development/staging proof where applicable, data reconciliation, security/isolation verification, UI exercise, and rollback evidence.

Each checked item contains:

- Status: `PASS`, `BLOCKED_EXTERNAL`, or `NOT_APPLICABLE` with reason. Unfinished stays unchecked and `FAIL`.
- Source and target paths/commits.
- Mapping/transformation/migration version.
- Test commands and exact results.
- Sanitized deployment/workflow/account/region/release/config evidence.
- Data counts/digests/reconciliation result without exposing sensitive records.
- Rollback/forward-recovery reference.
- Human sign-off when required.

No `PARTIAL` final status and no checkbox theater.

### 4. Phase 0 — Forensic two-repository and deployed-system truth

#### 4.1 Repository inventory

- [ ] SIMON-000-001 — Record remotes, branches, tags, default branches, active PRs, dirty state, commit history, contributors, releases, environments, and deployment workflows in both repositories.
- [ ] SIMON-000-002 — Generate complete file/package/application/service/module/workspace maps and dependency graphs for source and target.
- [ ] SIMON-000-003 — Identify frontend frameworks/routes/components/styles/tokens, backend handlers/services, APIs, databases/schemas/migrations, events/queues/jobs, identity, file storage, search/AI, integrations, observability, IaC, and tests.
- [ ] SIMON-000-004 — Locate every hard-coded Simon/OSE/University/club/term/role/workflow/domain/account/region/resource assumption, including values hidden in fixtures, CSS, route names, reports, permission checks, and deployment scripts.
- [ ] SIMON-000-005 — Locate duplicate business concepts implemented under different names across repositories and same names with different semantics.
- [ ] SIMON-000-006 — Build a package-by-package and capability-by-capability comparison: `PARENT_CANONICAL`, `SOURCE_SUPERIOR`, `MERGE_REQUIRED`, `CONFIG_ONLY`, `DATA_ONLY`, `REIMPLEMENT_REQUIRED`, `DEPRECATE_AFTER_PROOF`, or `UNKNOWN`.
- [ ] SIMON-000-007 — Inventory source licenses, generated artifacts, vendored code, binaries, large files, secret history indicators, vulnerable dependencies, and unsupported runtimes before importing.

#### 4.2 Deployed and AWS inventory

- [ ] SIMON-000-008 — Map every currently deployed Simon/public/staging environment, CloudFront distribution, Route 53 record, ACM certificate, WAF, origin, API, compute, database, bucket, queue/topic/rule, identity pool/client/IdP, key, secret reference, search/index, Bedrock resource, log/alarm, backup, and integration.
- [ ] SIMON-000-009 — Establish which repository/commit/workflow owns each deployed resource. Mark manual/unowned/orphan/unknown state; do not infer absence from denied API calls.
- [ ] SIMON-000-010 — Capture sanitized schema versions, migration history, row/object counts, file versions, event backlogs, search/index counts, Cognito user mappings, and backup/recovery posture.
- [ ] SIMON-000-011 — Perform authorized E2E visual/functional audit of every reachable Simon route and persona in both themes/viewports, including empty/loading/error/deny/stale/conflict states. Do not mutate production data merely to generate screenshots.
- [ ] SIMON-000-012 — Inventory telemetry and actual usage where available to distinguish used, latent, broken, hidden, inaccessible, and dead capabilities.

#### 4.3 Baseline artifact

- [ ] SIMON-000-013 — Produce `docs/migrations/simon/current-state-inventory.md` with capability, source path, target path, deployed owner, data owner, security classification, users, dependencies, migration disposition, risk, and evidence.
- [ ] SIMON-000-014 — Produce current data dictionary and entity/field/key/constraint/index/retention/owner matrix for both systems.
- [ ] SIMON-000-015 — Produce route/API/event/workflow/permission/role/report/integration mapping matrices.
- [ ] SIMON-GATE-000 — No import or destructive refactor begins until the two codebases, deployed resources, data, and behavioral gaps are evidence-backed.

### 5. Phase 1 — Target convergence architecture and repository boundaries

Define and implement actual monorepo boundaries using existing conventions where sound. A likely shape is:

```text
apps/
  system-studio/
  tenant-web/
  control-plane-api/
  tenant-api-or-runtime/
  workers/
packages/
  domain-organization/
  domain-identity/
  domain-memory/
  domain-workflow/
  domain-finance/
  domain-events/
  domain-members/
  domain-documents/
  domain-messaging/
  authz/
  tenant-context/
  configuration/
  module-sdk/
  relay/
  design-system/
  contracts/
  observability/
infra/
  organization/
  control-plane/
  cells/
  tenants/
  modules/
tenant-config/
  blueprints/
  packs/
  tenants/simon-ose/
```

Do not force these literal paths if the real monorepo has a better coherent convention. Preserve boundaries and responsibilities.

- [ ] SIMON-010-001 — Select one canonical implementation for every shared capability. Document why it is retained, merged, refactored, or replaced.
- [ ] SIMON-010-002 — Move reusable Simon behavior into generic modules with tenant-neutral contracts, vocabulary, tests, events, permissions, and UI extension points.
- [ ] SIMON-010-003 — Move Simon-specific values into signed manifest/configuration/policy/workflow/report/branding/integration data.
- [ ] SIMON-010-004 — Eliminate duplicate auth clients, tenant resolvers, API clients, event buses, audit writers, file abstractions, design tokens, and deployment utilities.
- [ ] SIMON-010-005 — Define module boundaries and dependency direction; prohibit circular imports and direct cross-module table access.
- [ ] SIMON-010-006 — Use explicit command/query/event/repository contracts and transactional outbox where cross-boundary propagation is required.
- [ ] SIMON-010-007 — Preserve public API/data behavior through versioning/adapters/migrations; do not retain insecure contracts merely for compatibility.
- [ ] SIMON-010-008 — Add architecture checks preventing imports from `tenant-config/tenants/simon-ose` into generic core packages.
- [ ] SIMON-010-009 — Add static checks for forbidden tenant-name/domain/account/resource literals outside approved configuration, tests, migrations, and documentation.
- [ ] SIMON-010-010 — Create ADRs for every material source-versus-parent convergence decision.
- [ ] SIMON-GATE-010 — One coherent Parent runtime can represent Simon without Simon-aware core business logic.

### 6. Phase 2 — Canonical Simon Tenant #1 manifest and configuration inheritance

Create a versioned, deterministic, signed Simon configuration under the actual tenant-config convention. It must inherit from global defaults, regional baseline, higher-education/student-organization industry pack, applicable jurisdiction pack, deployment-class blueprint, and Simon overlay.

The manifest must include at least:

- Immutable tenant ID and mutable legal/display name, aliases, slugs, branding, contacts, and accountable Tenure implementation/support seats.
- Deployment partition/region/cell/account binding/isolation/environment landscape, data residency, classification, encryption, backup, RPO/RTO, SLO, support, and cost policy.
- Organization hierarchy, club/association registry, durable seat types, effective terms, staffing transitions, oversight relationships, delegations, and terminology.
- Enabled modules/capabilities/versions/dependencies/limits.
- Roles, permissions, policies, relationship/temporal rules, separation of duties, and cross-org collaboration rules.
- Workflow definitions, approval thresholds, forms, fields, reports, notifications, calendars/resources, retention, and audit.
- Cognito/SSO/SCIM/invitation/session settings without secret values.
- Domain/certificate/routing configuration without blindly changing the current domain.
- Migration source IDs/mapping versions/cutover state.
- Integration definitions and typed secret references.
- Relay sources, tools, model-routing policy, guardrails, budgets, retention, and index placement.
- Release channel, target version, upgrade window, hold policy, compatibility state, and rollback target.

- [ ] SIMON-020-001 — Define strict Simon manifest schema, deterministic rendering, digest/signature, effective dates, provenance, compatibility, validation, and migrations.
- [ ] SIMON-020-002 — Separate confirmed Simon facts from defaults, assumptions, placeholders, secret references, and externally blocked values.
- [ ] SIMON-020-003 — Every override displays inherited source, reason, owner, approver, effective window, downstream impact, and expiry/review date.
- [ ] SIMON-020-004 — Prove the manifest contains no credentials, personal data dump, AWS access key, private certificate, or other tenant data.
- [ ] SIMON-020-005 — Prove a clean environment renders the same effective Simon configuration digest.
- [ ] SIMON-020-006 — Add schema/config migration tests from every supported prior Simon manifest version.
- [ ] SIMON-020-007 — Add generic corporate and nonprofit fixtures proving Simon terminology and workflows are not default product assumptions.
- [ ] SIMON-GATE-020 — Simon's complete intended behavior is a reproducible tenant package, not a fork or collection of environment variables.

### 7. Phase 3 — Simon canonical organization, durable seats, terms, and authorization

Model Simon through generic entities:

```text
Tenant: Simon Business School OSE
Oversight organization: Office of Student Engagement
Managed organizations: clubs and associations
Substructures: boards, committees, programs, initiatives
Durable positions/seats: OSE Director/Staff, President, VP Finance/Treasurer,
VP Marketing/Communications, VP MS Representative/Outreach, other configured seats
Occupancy: ACTIVE, SHADOW/INCOMING, ALUMNI/FORMER, ADVISOR, DELEGATE
Temporal units: academic year, term, transition window, event/fiscal period
```

Support 30+ clubs/associations and average boards of 3–5 without treating those numbers as limits. Pilot fixtures may include six founding organizations, but the schema and UX must scale beyond them.

- [ ] SIMON-030-001 — Create stable IDs for tenant, organizations, seats, people, memberships, assignments, relationships, terms, and policies; names are mutable attributes, never keys.
- [ ] SIMON-030-002 — Implement effective-dated assignments with no unauthorized overlap, future scheduling, shadow/incoming transition, temporary delegation, revocation, and complete history.
- [ ] SIMON-030-003 — Attach authority and memory to seats/resources/relationships rather than copying predecessor user access.
- [ ] SIMON-030-004 — Implement OSE global oversight without granting unrestricted access to personal/private or policy-excluded information.
- [ ] SIMON-030-005 — Implement club-level administration, cross-club collaboration, committee/initiative membership, advisors, alumni, staff, and exceptional roles as configuration.
- [ ] SIMON-030-006 — Implement semantic permissions for finance, approvals, events, resources, members, documents, messages, memory, reports, policies, integrations, Relay, and administration.
- [ ] SIMON-030-007 — Enforce VP → President → OSE routing where configured while supporting the full current six-step OSE workflow and future variants through workflow data—not hard-coded role checks.
- [ ] SIMON-030-008 — Snapshot exact policy/workflow/version/threshold and responsible seats at request submission and every governed decision.
- [ ] SIMON-030-009 — Test former, future, shadow, delegated, suspended, multi-club, OSE, support, auditor, and ordinary-member access at boundary timestamps.
- [ ] SIMON-030-010 — Test every server/API/job/export/search/AI path for cross-club and cross-tenant denial, not only UI visibility.
- [ ] SIMON-GATE-030 — People may rotate or hold multiple scoped assignments while authorization and institutional memory remain correct over time.

### 8. Phase 4 — Identity, Simon SSO, invitations, SCIM, and session migration

Use Cognito as authentication/federation substrate. Tenure remains authoritative for tenancy and authorization.

- [ ] SIMON-040-001 — Inventory current users/identities, immutable source IDs, email aliases, verification, MFA, status, memberships, seat assignments, service accounts, duplicates, and orphan identities without exporting password material.
- [ ] SIMON-040-002 — Define deterministic identity-linking rules and a manual exception queue; never link solely because two mutable email addresses match.
- [ ] SIMON-040-003 — Configure Simon SAML/OIDC federation through Cognito when approved metadata/certificates/claims exist; treat missing real IdP values as `BLOCKED_EXTERNAL` while implementing a test IdP path.
- [ ] SIMON-040-004 — Implement code+PKCE/BFF sessions, secure cookies, CSRF, issuer/audience/nonce/state checks, safe intended destination, logout, session revocation, and no tokens in browser storage.
- [ ] SIMON-040-005 — Implement invitation/fallback identity for approved pilot users without weakening production MFA or creating shared credentials.
- [ ] SIMON-040-006 — Implement SCIM lifecycle when Simon supports it: create/link/update/deactivate, group/assignment mapping through Tenure policy, idempotency, replay, conflict, and audit. SCIM group names do not become raw permissions.
- [ ] SIMON-040-007 — Map federation claims to identity attributes only; resolve tenant/membership/seat/permission from Tenure records and policy.
- [ ] SIMON-040-008 — Implement just-in-time behavior only for explicitly permitted tenants/domains and never auto-grant privileged seats.
- [ ] SIMON-040-009 — Define session cutover: existing source sessions expire/revoke at controlled boundary; no silent bearer-token compatibility bridge.
- [ ] SIMON-040-010 — Test duplicate identity, renamed email, alumni email loss, graduated/offboarded occupant, multi-club user, OSE staff, disabled IdP user, SCIM replay, and compromised session.
- [ ] SIMON-GATE-040 — Every Simon user resolves to one governed Tenure identity and exact effective assignments without shared passwords or frontend-only authority.

### 9. Phase 5 — Full Simon ERP module absorption

For each module, perform this sequence:

1. Inventory source behavior, routes, data, workflows, permissions, events, reports, UI, tests, and AWS dependencies.
2. Map to canonical Parent module/capability contracts.
3. Retain superior generic behavior, reimplement incompatible behavior, and convert Simon specifics to configuration.
4. Create schema/data/config migrations and reconciliation.
5. Test all Simon personas, denial paths, history, failures, accessibility, and generality fixtures.
6. Deploy to development/staging and compare against source behavior.

#### 9.1 Organization, members, and transitions

- Roster/contact profiles, organizations, boards, seats, assignments, terms, incoming/shadow, outgoing/alumni, advisors, delegation, elections/appointments if enabled, onboarding/offboarding, handoff readiness, credential/reference transfer without storing prohibited secrets.

#### 9.2 Requests, workflows, approvals, and policy

- Configurable forms, drafts, submit/withdraw/resubmit, conditional routing, parallel/sequential steps, VP/President/OSE review, delegation, SLA/escalation, comments/evidence, rejection/change request, policy snapshots, separation of duties, immutable decisions, replay/idempotency.

#### 9.3 Finance and procurement

- Budgets, allocations, categories, dues, sponsorship income, expenses, reimbursements, vendors, purchase/request/approval, attachments/receipts, ledger entries, reconciliation, periods, audit, reports, and handoff continuity. Never present a student-club tracker as certified universal accounting without the Parent journal boundary.

#### 9.4 Events, calendars, facilities, and resources

- Unified OSE/club calendars, drafts/publish, rooms, resources, vendors, recurring events, time zones, attendance, run-of-show, approval status, hard collision, soft conflict, explainability, override authorization, subscriptions/exports, and external calendar integration.

#### 9.5 Documents, contracts, and records

- Files, versions, folders/collections, contracts, signed documents, metadata, classification, ownership, retention, legal hold, search/OCR, virus scan, permission, links, previews, export, deletion, and audit.

#### 9.6 Messaging, notifications, and cross-org collaboration

- Role/seat-aware in-app threads, VP↔President, President↔OSE, approved cross-club communication, sensitivity levels, attachments, mentions, work-object linking, email/push delivery, preference/mandatory notifications, delivery state, moderation/retention, and audit.

#### 9.7 Institutional memory and handoffs

- Decisions, rationale, policy snapshots, vendor/sponsor relationships, contacts, playbooks, lessons, recurring obligations, deadlines, event retrospectives, finance context, attachments, provenance, confidence, sensitivity, review, supersession, and successor onboarding.

#### 9.8 Reports, search, audit, and oversight

- OSE multi-club views, club dashboards, finance/event/member/approval/continuity metrics, semantic definitions, filters/drill-through, exports, subscriptions, permission-aware global search, append-only allow/deny audit, and data freshness.

- [ ] SIMON-050-001 — Absorb members/seats/terms/transitions with effective-dated history and successor-ready UX.
- [ ] SIMON-050-002 — Absorb configurable requests/workflows/approvals/policy snapshots and prove the Simon approval chain without core role-name conditionals.
- [ ] SIMON-050-003 — Absorb finance/budget/dues/expense/reimbursement/vendor behavior with balanced canonical records and complete audit.
- [ ] SIMON-050-004 — Absorb calendar/events/resources and prove hard/soft conflict detection, explanation, authorization, override, and concurrency.
- [ ] SIMON-050-005 — Absorb documents/contracts/records with file versions, classification, malware handling, retention, authorization, and full export.
- [ ] SIMON-050-006 — Absorb messaging/notifications/cross-org collaboration with sensitivity, delivery, retention, and exact role/relationship scope.
- [ ] SIMON-050-007 — Absorb institutional memory so every migrated item has authorized ownership, provenance, source link/version, temporal context, sensitivity, and successor eligibility.
- [ ] SIMON-050-008 — Absorb reports/search/audit and eliminate conflicting metrics, tenant leaks, unresolvable citations, and editable audit history.
- [ ] SIMON-050-009 — Implement settings/customer administration through generic metadata and guardrails; prevent Simon admins from changing Parent infrastructure/security invariants.
- [ ] SIMON-050-010 — Record every source behavior not migrated, with evidence-based disposition and explicit owner approval.
- [ ] SIMON-GATE-050 — Every required Simon pilot capability exists in the Parent runtime or has an explicit approved blocker; no hidden dependency remains in the source application.

### 10. Phase 6 — Data and file migration factory

#### 10.1 Migration lifecycle

`DISCOVER → PROFILE → CLASSIFY → MAP → CLEANSE → EXTRACT → TRANSFORM → LOAD → RECONCILE → MOCK_CONVERT → DELTA → FREEZE → FINAL_LOAD → BUSINESS_VALIDATE → CUTOVER → ARCHIVE/DESTROY_TEMP`

#### 10.2 Required migration controls

- Immutable source extracts with source system/version/time, query/tool version, counts, checksums, encryption, classification, retention, and chain of custody.
- Versioned executable mappings, default rules, enum/reference mapping, timezone/currency normalization, identity resolution, stable-key strategy, custom-field mapping, loss/unsupported handling, and provenance.
- Dependency order: tenant/org/terms/people/seats/assignments before workflows/finance/events/documents/messages/memory/audit as required by actual foreign keys.
- Idempotent staging and load; duplicate prevention; reject/quarantine; restart; resource ceilings; chunking; backpressure; and safe diagnostics.
- Reconciliation by counts, control totals, hashes, referential integrity, balances, status distributions, file digests/versions, workflow state, permissions, search indexes, and sampled business trace.
- At least two mock conversions with defect closure and measured duration before final cutover.

- [ ] SIMON-060-001 — Create source inventory/profile with nulls, duplicates, invalid enums, broken references, orphan files, identity conflicts, impossible timestamps, encoding, and sensitive data.
- [ ] SIMON-060-002 — Create canonical field/entity mappings with business meaning and owner sign-off; do not map by name alone.
- [ ] SIMON-060-003 — Preserve original stable IDs where safe or maintain immutable crosswalks; never use mutable email/name/title as sole identity.
- [ ] SIMON-060-004 — Preserve timestamps/time zones, actor/seat attribution, workflow/policy version, source record/version, file digest, and audit provenance.
- [ ] SIMON-060-005 — Keep private/personal data from automatically becoming durable seat memory; classify and map successor eligibility explicitly.
- [ ] SIMON-060-006 — Migrate S3/files with malware quarantine, object/version digest, metadata, classification, ownership, retention, encryption, and missing/corrupt exception queue.
- [ ] SIMON-060-007 — Migrate active workflow instances without skipping approvals or silently changing policy; define freeze/restart/legacy-completion strategy per workflow class.
- [ ] SIMON-060-008 — Reconcile finance balances/control totals and prohibit cutover on unexplained variance.
- [ ] SIMON-060-009 — Rebuild search/vector/Relay indexes from authorized canonical sources after load; indexes are not migration sources of truth.
- [ ] SIMON-060-010 — Execute at least two full mock migrations in isolated environments with timings, failures, reconciliation, rollback, and defect ledger.
- [ ] SIMON-060-011 — Implement final delta/watermark/change-capture strategy and prove no lost or duplicated writes across freeze.
- [ ] SIMON-060-012 — Define secure temporary-data deletion with retention/legal approval and destruction evidence after migration acceptance.
- [ ] SIMON-GATE-060 — Migrated Simon data is complete, explainable, authorized, reconciled, restartable, and traceable to immutable source evidence.

### 11. Phase 7 — AWS resource absorption and tenant deployment

Do not merely re-tag existing resources as managed. Determine whether each should be adopted into IaC, migrated into a Parent cell/dedicated account, replaced, or retired.

- [ ] SIMON-070-001 — Assign every existing AWS resource a disposition: `ADOPT`, `MIGRATE`, `REPLACE`, `SHARE_THROUGH_CELL`, `RETAIN_TEMPORARILY`, `RETIRE`, or `UNKNOWN`.
- [ ] SIMON-070-002 — Create target Simon placement plan: Tenure account/cell/region/isolation/network/data/edge/identity/Relay/integration/backup/observability/cost.
- [ ] SIMON-070-003 — Render all target resources through Parent IaC with deterministic tags, ownership, stack boundaries, deletion/retention policy, and drift detection.
- [ ] SIMON-070-004 — Establish tenant-isolated database/schema, S3 namespace/bucket according to tier, event/queue namespace, cache, search/vector/knowledge boundary, KMS/grants, secrets, logs, metrics, backups, and analytics.
- [ ] SIMON-070-005 — Configure Cognito/IdP, API/compute, CloudFront/WAF, Route 53/ACM, origin policies, callback/logout URLs, and security headers through the System Studio desired-state workflow.
- [ ] SIMON-070-006 — Preserve existing production hostname until target readiness and approved cutover. Validate DNS ownership, TTL plan, certificate, origin, redirects, cookies, CORS, SSO callback, canonical URLs, and rollback.
- [ ] SIMON-070-007 — Configure Relay/Bedrock resources and ingestion through Parent model gateway, authorization, budgets, guardrails, and Simon-specific index isolation.
- [ ] SIMON-070-008 — Configure connectors through Integration Studio with secret references, scopes, mappings, consent, health, retry/DLQ, reconciliation, and offboarding.
- [ ] SIMON-070-009 — Verify actual resources against manifest/IaC; report drift, unmanaged resources, orphans, residual costs, and missing permissions.
- [ ] SIMON-070-010 — Prove target Simon can be destroyed/recreated in nonproduction from signed manifest, release, migrations, and approved data extract without manual AWS Console steps.
- [ ] SIMON-GATE-070 — Simon is a managed Parent tenant with complete desired/actual resource ownership, not a separately deployed application hidden behind the same UI.

### 12. Phase 8 — Relay by Tenure absorption and Simon memory corpus

- [ ] SIMON-080-001 — Inventory all current AI features, prompts, model calls, indexes, embeddings, knowledge bases, parsing, tools, conversation data, costs, and permissions in the Simon source.
- [ ] SIMON-080-002 — Remove/replace any direct external model API handling customer records; use the Parent Bedrock model gateway and current measured routing policy.
- [ ] SIMON-080-003 — Ingest structured records, documents, PDFs, Office files, images, scans, tables, charts, diagrams, audio, and video only through approved classified pipelines.
- [ ] SIMON-080-004 — Attach each chunk/derivative to tenant, organization, seat/resource, source object/version/digest, page/sheet/slide/time/coordinates, classification, permissions, retention, parser/model version, and freshness.
- [ ] SIMON-080-005 — Build authorization filters before retrieval and reauthorize every result; cross-club/OSE visibility follows exact Simon policy.
- [ ] SIMON-080-006 — Implement Simon use cases: seat onboarding, prior decision/rationale, vendor/sponsor history, past event playbook, budget status, approval status, policy explanation, conflict explanation, document summary, cross-term comparison, and handoff readiness.
- [ ] SIMON-080-007 — Return resolvable authorized citations and explicitly handle missing, stale, contradictory, inaccessible, or insufficient evidence.
- [ ] SIMON-080-008 — Route drafts/actions through ordinary Parent commands, approvals, expected-version checks, idempotency, and audit. Relay cannot approve OSE workflows, spending, publication, access, deletion, or production changes.
- [ ] SIMON-080-009 — Test prompt/image/OCR/tool-output injection, secret extraction, cross-tenant retrieval, cross-club unauthorized retrieval, predecessor-private leakage, citation forgery, stale policy, and cost abuse.
- [ ] SIMON-080-010 — Prove no Simon content is used to train a shared model and deletion/retention changes propagate through derived indexes and caches.
- [ ] SIMON-GATE-080 — Relay makes Simon's seat memory useful without creating a second authorization or truth system.

### 13. Phase 9 — UI/UX and Tenure Experience System convergence

The Simon tenant must look and behave like Tenure, not a skinned legacy app. Preserve useful workflows but converge on the Parent Tenure Experience System.

- [ ] SIMON-090-001 — Remove duplicate/legacy Simon tokens, global CSS, one-off component copies, brown/gold/monospace console styling, and inconsistent light-only patterns after route-by-route visual comparison.
- [ ] SIMON-090-002 — Use one forest-green, cool-neutral, low-fatigue light/dark token system and canonical accessible components.
- [ ] SIMON-090-003 — Build role-appropriate navigation for OSE, President, VPs, members, advisors, auditors, and support without hiding server-authorized capabilities solely through route code.
- [ ] SIMON-090-004 — Implement comfortable/compact density, responsive web/PWA, keyboard operation, screen-reader semantics, focus management, reduced motion, high contrast, RTL readiness, and WCAG 2.2 AA.
- [ ] SIMON-090-005 — Build OSE fleet/oversight, club home, seat handoff, approvals inbox, finance, events/calendar/conflicts, members, documents, messages, memory, reports/search/audit, settings, and Relay states with realistic data.
- [ ] SIMON-090-006 — Make approval, policy, actor seat, status, evidence, deadlines, conflicts, cost, and next action visible without dashboard clutter.
- [ ] SIMON-090-007 — Use professional visualizations only for meaningful flows/trends/composition/lineage; include units, filters, source/freshness, uncertainty, drill-through, and accessible table.
- [ ] SIMON-090-008 — Implement loading, empty, denied, stale, partial, error, retry, offline, degraded, conflict, and completed states for every migrated route.
- [ ] SIMON-090-009 — Run visual regression in both themes and common viewports for all personas and critical workflow states.
- [ ] SIMON-090-010 — Run observed multi-hour OSE and club-leader usability/fatigue testing; record and fix high-severity friction before pilot readiness.
- [ ] SIMON-GATE-090 — Simon is fully converged on the Parent experience while remaining recognizably configured for its organization and terminology.

### 14. Phase 10 — Permanent global update inheritance

This phase is mandatory. Absorption is a failure if Simon must later be manually synchronized.

#### 14.1 One release object

Every release must bind:

- Source commit and signed artifact/image digests.
- Application/API/event/module versions.
- Database schema migrations.
- Configuration schema/default migrations.
- IaC stack/template versions.
- Relay model/prompt/parser/tool policy versions.
- Connector contracts.
- Security/compliance policy versions.
- Compatibility range, irreversible boundary, rollback target, tests, release notes, and evidence.

#### 14.2 Compatibility dimensions

Evaluate each tenant for:

- Manifest/config schema.
- Enabled module and dependency versions.
- Database/data migration state.
- API/event/connector contracts.
- Extension SDK compatibility.
- Region/partition/service/model availability.
- Data class/residency/security policy.
- Identity/SSO callback/domain.
- Capacity/quota/cost.
- Tenant-specific override conflicts and expired exceptions.

#### 14.3 Safe release sequence

`BUILD → VERIFY ARTIFACT → MIGRATION SIMULATION → SYNTHETIC TENANTS → INTERNAL CANARY → STAGING → SIMON SHADOW/CANARY → APPROVAL → WAVE DEPLOY → VERIFY → OBSERVE → COMPLETE OR ROLLBACK`

- [ ] SIMON-100-001 — Implement a single Parent release pipeline; remove or freeze the Simon-only release pipeline after approved cutover.
- [ ] SIMON-100-002 — Implement release channels such as `internal`, `canary`, `stable`, `regulated`, and `emergency` based on policy, not source branches per tenant.
- [ ] SIMON-100-003 — Assign Simon to an explicit channel/wave with maintenance window, approvers, notification policy, and rollback objective.
- [ ] SIMON-100-004 — Implement automated tenant compatibility evaluation and human-readable exact blockers before deployment.
- [ ] SIMON-100-005 — Implement expand → migrate/backfill → dual-read/write only when necessary → verify → contract for incompatible database changes; never destructive one-step migration.
- [ ] SIMON-100-006 — Implement versioned configuration default/migration functions preserving explicit Simon overrides and provenance.
- [ ] SIMON-100-007 — Require module contract, Simon workflow, persona, isolation, visual, performance, Relay, integration, backup, and rollback tests for every relevant release.
- [ ] SIMON-100-008 — Use feature flags for temporary controlled rollout with owner, purpose, created/expiry date, variants, metrics, and removal issue. Flags may not become permanent Simon forks.
- [ ] SIMON-100-009 — Allow a time-bound Simon release hold only with reason, owner, risk acceptance, expiry, security-patch policy, and catch-up plan.
- [ ] SIMON-100-010 — Prevent a tenant overlay from overriding security, isolation, audit, schema integrity, or lifecycle invariants.
- [ ] SIMON-100-011 — Implement canary and automatic pause/rollback on defined SLO, error, authorization, reconciliation, data, integration, or cost thresholds.
- [ ] SIMON-100-012 — Record tenant release history, manifest/config/schema before/after, approvals, tests, health, drift, rollback, and exception resolution.
- [ ] SIMON-100-013 — Create CI rules that fail if core code imports Simon configuration, if a Simon-only core module appears, or if tenant code forks re-emerge.
- [ ] SIMON-100-014 — Prove a generic global module improvement reaches Simon via one release without copying code or overwriting Simon configuration.
- [ ] SIMON-100-015 — Prove a Simon configuration change can deploy independently without rebuilding a tenant-specific application fork.
- [ ] SIMON-GATE-100 — Future global releases automatically include Simon in compatibility evaluation and governed rollout through the one Parent release train.

### 15. Phase 11 — End-to-end Simon acceptance matrix

Create named nonproduction personas for:

- OSE Director/Supervisor.
- OSE staff reviewer.
- Club President.
- VP Finance/Treasurer.
- VP Marketing/Communications.
- VP MS Representative/Outreach.
- General member.
- Incoming/shadow officer.
- Former/alumni officer.
- Advisor.
- Multi-club user with different roles.
- Auditor/read-only.
- Time-bound Tenure support engineer.
- Unauthorized user.
- User from another synthetic tenant.

Run E2E scenarios:

#### Identity and transition

- Sign in, invitation/federation, tenant/seat selection, session expiry, MFA/step-up, multi-role context, leadership transition, delegation, offboarding, denied former-user access.

#### Approval and policy

- VP submits a request; President reviews; OSE completes configured chain; revisions/rejection/delegation/SLA/escalation occur; exact policy snapshot remains explainable after policy changes.

#### Finance

- Budget allocation, dues/income, expense/reimbursement, vendor attachment, approval, ledger/audit, period/report, successor views prior rationale and cost without accessing prohibited private data.

#### Events and conflict

- Club proposes event/resource; hard collision blocks or requires authorized resolution; soft conflict explains evidence; OSE sees cross-club impact; calendar subscriptions and updates remain consistent.

#### Documents and memory

- Upload/scan/version/classify/approve/search/summarize a document; attach to seat/workflow/event; successor receives eligible context; unauthorized persona and other tenant are denied.

#### Messaging and collaboration

- VP↔President, President↔OSE, and approved cross-club thread with sensitivity, attachments, delivery, retention, and revoked access.

#### Relay

- Ask a seat-history question, budget question, policy question, event question, document/chart/image question, and handoff question with exact citations; test insufficient/contradictory evidence; draft a reversible action; require approval for high-risk action.

#### Operations

- Deployment, failure/retry, drift, backup/restore, release canary/rollback, logical suspension/reactivation, and support access.

- [ ] SIMON-110-001 — Implement the full persona matrix with deterministic fixtures and no shared credentials.
- [ ] SIMON-110-002 — Test each critical flow as allow, deny, expired, delegated, concurrent, stale-version, duplicate-submit, partial-failure, and retry.
- [ ] SIMON-110-003 — Test cross-club and cross-tenant isolation across database, files, events, cache, search/vector, AI, analytics, logs, backups, exports, and notifications.
- [ ] SIMON-110-004 — Test realistic 30+ organization scale, large histories, long names, multiple academic terms, time zones, accessibility, both themes, and mobile/desktop.
- [ ] SIMON-110-005 — Compare target outcome to source baseline and record every intentional difference as improvement, security correction, generalized design, or approved deferral.
- [ ] SIMON-110-006 — Obtain OSE/business-owner UAT sign-off for exact pilot scope without allowing sign-off to waive platform security/isolation invariants.
- [ ] SIMON-GATE-110 — All pilot-critical business journeys, denial paths, transitions, failure paths, and generality proofs pass in staging.

### 16. Phase 12 — Cutover command center

Create a minute/step-level cutover plan with owners, dependencies, planned/actual times, validation, go/no-go criteria, rollback trigger, and evidence.

#### 16.1 Readiness gates

- Target production infrastructure verified.
- Identity/SSO and emergency admin verified.
- Final mock conversion/reconciliation approved.
- Source write freeze/delta plan approved.
- Domains/certificates/TTL/callback URLs verified.
- Security/isolation/vulnerability gates pass.
- Backup and isolated restore pass.
- SLO/capacity/quota/cost/support/on-call ready.
- UAT and training/support materials approved.
- Rollback data/infra/domain/session plan rehearsed.
- Communications approved.
- No unresolved severity-1/2 or unexplained financial/data variance.

#### 16.2 Cutover sequence

1. Declare command center and change freeze.
2. Validate source/target health and backups.
3. Revoke/contain changes according to freeze policy.
4. Capture final immutable delta.
5. Transform/load/reconcile.
6. Rebuild indexes and verify permissions.
7. Configure final SSO/integrations/domains without activation.
8. Run technical/business/security smoke tests.
9. Convene explicit go/no-go board.
10. Activate routing/DNS/session boundary.
11. Run persona and synthetic transactions.
12. Monitor canary metrics and support channels.
13. Declare success or rollback within rehearsed boundary.

- [ ] SIMON-120-001 — Create cutover plan, RACI, contact tree, bridge, evidence channel, decision log, and exact go/no-go quorum.
- [ ] SIMON-120-002 — Define source freeze, delta, in-flight workflow, queued event, integration, and session handling.
- [ ] SIMON-120-003 — Define quantitative go/no-go and rollback thresholds for data, identity, API, workflow, finance, file, search/Relay, integration, security, latency/error, and cost.
- [ ] SIMON-120-004 — Rehearse cutover and rollback in staging using production-scale sanitized/synthetic data and measured time.
- [ ] SIMON-120-005 — Produce signed pre-cutover readiness package and pause at protected human production approval.
- [ ] SIMON-120-006 — Perform production cutover only after approval; record actual timestamps, actors, digests, counts, tests, exceptions, and decisions.
- [ ] SIMON-120-007 — Keep source environment recoverable/read-only for the approved rollback/archive window; do not create a hidden second source of truth.
- [ ] SIMON-GATE-120 — Simon production activates on Parent only through an evidence-backed, approved, rehearsed, and reversible cutover.

### 17. Phase 13 — Hypercare, retirement, and ownership transfer

- [ ] SIMON-130-001 — Establish hypercare coverage, severity definitions, routing, on-call seats, daily cadence, dashboards, known-issue register, and customer communication.
- [ ] SIMON-130-002 — Monitor login/SSO, permissions/denies, workflows, finance reconciliation, events/conflicts, files, messages, search/Relay, integrations, performance, security, backups, drift, and cost.
- [ ] SIMON-130-003 — Route every incident/decision/remediation to durable accountable seats and preserve the operational memory for future operators.
- [ ] SIMON-130-004 — Restrict change during hypercare; use emergency change policy and after-action review.
- [ ] SIMON-130-005 — Define exit criteria: stabilization duration, incident/error backlog, data variance, SLO, support volume, backup/restore, documentation, training, and owner acceptance.
- [ ] SIMON-130-006 — Transfer support through runbooks, service catalog, ownership, escalation, dashboards, known errors, release procedure, and access review.
- [ ] SIMON-130-007 — Inventory remaining source repository/deployment/resource/domain/data dependencies and close each with evidence.
- [ ] SIMON-130-008 — Export/archive required source history and data under retention/legal policy; revoke access/integrations/keys/secrets; remove routing; delete temporary migration data.
- [ ] SIMON-130-009 — Retire source AWS resources through Parent lifecycle/change approval, orphan scan, and delayed billing verification. Never delete first and document later.
- [ ] SIMON-130-010 — Archive or mark the source repository read-only only after approved rollback window, dependency closure, history preservation, and human authorization.
- [ ] SIMON-130-011 — Add repository notice pointing all future development to Tenure Parent without exposing internal architecture or credentials.
- [ ] SIMON-GATE-130 — Simon is stable on Parent, support ownership is transferred, and the old system no longer receives traffic, writes, secrets, or recurring cost except explicitly approved retention.

### 18. Required repository deliverables

Create/update under actual conventions:

#### Discovery and decisions

- `docs/migrations/simon/current-state-inventory.md`
- `docs/migrations/simon/capability-convergence-matrix.md`
- `docs/migrations/simon/data-dictionary-source-target.md`
- `docs/migrations/simon/route-api-event-permission-matrix.md`
- `docs/migrations/simon/aws-resource-disposition.md`
- ADRs for repository convergence, module choices, identity linking, data mapping, placement, domain cutover, and source retirement.

#### Tenant package

- Versioned Simon tenant manifest and overlays.
- Higher-education/student-organization pack only where generic.
- Simon workflow/policy/role/report/terminology/branding configuration.
- Typed integration and secret references.
- Relay policy/evaluation/source mapping.
- Release channel/wave/hold policy.

#### Migration and testing

- Extract specifications, mappings, crosswalks, transformations, loaders, rejection handling, reconciliation rules/workbooks, mock conversion reports, delta/final conversion procedures, and temporary-data destruction plan.
- Persona fixtures, source-target parity/intended-difference matrix, E2E/UAT/security/isolation/visual/performance/DR/release tests.
- Sanitized signed migration/deployment/evidence manifests.

#### Operations

- Cutover plan/RACI/go-no-go/rollback/communications.
- Hypercare plan/dashboard/incident/exit criteria.
- Source retirement/archive/access revocation/resource deletion/billing evidence.
- Complete `SIMON-*` execution ledger.

### 19. Prohibited shortcuts

Do not:

- Treat a successful Git merge as tenant absorption.
- Put all source code under `legacy/simon` and call it migrated.
- Keep two production databases with undocumented bidirectional sync.
- Wrap source UI in an iframe or route proxy indefinitely.
- Add core checks such as `tenantSlug === "simon"`.
- Clone global packages and prefix them `simon-`.
- Map identities by email alone or migrate passwords/tokens.
- Translate Cognito groups directly into permanent permissions.
- Copy source data without immutable extract, mapping, reconciliation, and owner sign-off.
- Convert private messages/preferences into seat memory by default.
- Use vector indexes as canonical migration sources.
- Mark AWS resources managed merely by adding tags.
- Switch DNS without verified certificate, callbacks, health, rollback, and approval.
- Delete source resources/repos/data before cutover acceptance and rollback expiry.
- Give Simon a permanent upgrade exemption or release branch.
- Overwrite explicit Simon configuration when global defaults change.
- Use feature flags as permanent tenant forks.
- Let Relay bypass Simon permissions or approval chains.
- Claim future updates “automatically affect Simon” without compatibility evaluation, config/data migration, canary, evidence, and rollback.

### 20. Absolute definition of done

The absorption is complete only when:

- The Tenure Parent monorepo contains one canonical implementation of every required capability.
- Simon is reproducible from a signed tenant manifest, Parent release artifact, IaC, migrations, and approved data extract.
- No Simon-specific core code, core module fork, duplicate design system, independent deployment pipeline, or manual AWS setup remains.
- All required Simon modules and personas work in staging and production after approved cutover.
- Migrated data/files/workflows/finance/permissions/memory are fully reconciled and source-traceable.
- Cognito/Simon federation and Tenure authorization are secure and temporal.
- Cross-club/cross-tenant isolation is proven in every store and derivative path.
- Relay is authorized, grounded, cited, multimodal, cost-governed, and non-self-approving.
- System Studio owns Simon desired state, AWS actual state, resources, costs, drift, changes, approvals, releases, and lifecycle.
- A generic Parent improvement reaches Simon through the one release train with no copied code.
- A Simon configuration update deploys independently without a tenant app fork.
- Cutover, rollback, hypercare, support transfer, source retirement, orphan cleanup, and billing evidence are complete.
- The source repository is no longer an active product line and cannot silently drift from Parent.

### 21. Required final Claude response

At the end of each session report:

1. Exact `SIMON-*` items and phase gates completed.
2. Source findings and target changes by capability.
3. Files/imports/refactors/configuration/migrations/IaC/UI changes.
4. Commits and branch.
5. Tests with exact commands/results.
6. Data/file reconciliation counts and unexplained variances.
7. AWS deployment/workflow evidence without secrets.
8. Identity, authorization, isolation, Relay, accessibility, performance, recovery, and cost evidence.
9. Remaining source dependencies and unchecked items.
10. External blockers and exact minimum human action.
11. Current production/cutover state and confirmation that no unauthorized destructive action occurred.
12. Next dependency-ordered migration slice.

Never claim “absorbed,” “fully migrated,” “globally inherited,” “production ready,” or “retired” until its exact gates and evidence are complete.

## END SIMON ABSORPTION MASTER PROMPT

---

## Recommended repository location

```text
docs/implementation/tenure-simon-ose-tenant-absorption-master-prompt.md
```

