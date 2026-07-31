# Tenure Global System Architecture Bible

Version: 1.1  
Date: 2026-07-31  
Status: Authoritative target architecture  
Scope: Tenure Parent, every regional deployment cell, and every tenant configuration  
Product thesis: The person changes. The seat remembers.

## 0. Executive architecture contract

Tenure is not a university-club application that may later be generalized. It is a global, memory-first, organization-first enterprise operating system whose first proving configuration is Simon Business School's Office of Student Engagement. Simon is Tenant 1. Simon is never the parent data model, the authorization model, the deployment model, or the ceiling of the platform.

The durable organizational position—called a seat in the product—is Tenure's primary continuity primitive. People occupy seats for effective-dated periods. Work, authority, decisions, relationships, policies, files, financial history, and operational knowledge can attach to the seat without becoming the personal property of an occupant. When a person leaves, current authority ends; the organizational record persists under explicit policy. A successor receives governed continuity, not indiscriminate access to a predecessor's personal data.

Tenure Parent is one centrally operated global product and one complete monorepo. A tenant is created by validating configuration, selecting an isolation and regional-placement policy, provisioning AWS resources through reusable infrastructure templates, loading configuration through the same runtime, running mandatory tests, and activating the resulting system through a controlled deployment. No tenant receives a source-code fork.

All Tenure product compute, data, identity, AI orchestration, security, observability, and tenant runtime infrastructure run on AWS. External systems may connect through governed integrations because Tenure is designed to coexist with an organization's stack. The public marketing website may remain outside the tenant runtime; `platform.tenurework.com` and every customer-facing product workload are AWS-delivered.

All shared and dedicated tenant AWS accounts are owned and governed by Tenure. Personal user AWS accounts, a founder's personal AWS account, and unrelated customer AWS Organizations are not deployment targets. Tenure may create a dedicated account, organization boundary, commercial-region environment, GovCloud environment, or sovereign-partition environment for contractual or regulatory isolation, but it remains a Tenure-controlled deployment created through the same parent control plane.

Tenant super administrators receive deep configuration authority within guardrails. They may configure organizations, terminology, fields, forms, policies, roles, permissions, workflows, reports, automations, branding, localization, and approved connections. They cannot bypass tenant isolation, mutate the platform's canonical schemas directly, grant themselves Tenure operator access, upload arbitrary privileged backend code, weaken immutable audit, or change the physical deployment topology outside approved requests.

The user-facing AI copilot is named **Relay by Tenure**. Relay is the governed intelligence surface for the entire system the current user is authorized to access. It reads and cites authorized evidence; understands text, documents, images, charts, diagrams, audio, and video; summarizes and edits governed content; and executes approved system actions through typed tools. It never receives direct database credentials, never treats retrieved content as authority, never trains a shared model on tenant records, and never accesses another tenant or a resource the current actor cannot see.

The marketplace is architected as a future platform capability. In the initial product, the Marketplace route is an intentionally empty, polished **Coming soon** surface behind a feature flag. No third-party publishing, purchasing, installation, billing, or executable package intake is enabled until certification, sandboxing, entitlement, billing, security review, revocation, and support controls are complete.

## 1. Binding decisions

| Decision | Binding choice |
|---|---|
| Repository role | Complete Tenure Parent platform monorepo and global deployment engine |
| Operating model | Tenure centrally provisions, deploys, upgrades, monitors, supports, exports, suspends, and decommissions tenants |
| AWS ownership | Tenure-owned AWS Organization and Tenure-owned member accounts only; no personal or unrelated customer AWS accounts |
| Deployment shapes | Pooled, bridge/hybrid, dedicated resources, dedicated Tenure AWS account, region-specific, GovCloud, and sovereign-partition capable |
| AWS boundary | All product backend/runtime infrastructure on AWS; governed external business integrations are allowed |
| Tenant customization | Versioned configuration and approved extensions; never source forks |
| Tenant administration | Delegated configuration within centrally enforced platform and security guardrails |
| Extension model | Declarative metadata, visual low-code automation, and sandboxed/versioned SDK extensions |
| Identity | Cognito is authentication/federation substrate; Tenure owns identity resolution, membership, authorization, and audit |
| Authorization | Deny-by-default RBAC + ABAC + relationship + policy + temporal controls, enforced server-side |
| Business-data isolation | No cross-tenant business tables. Shared tiers use separate tenant schemas/databases and storage namespaces; dedicated tiers receive stronger resource isolation |
| Product surfaces | Responsive web/PWA and API-first foundation; native mobile and desktop later |
| Experience system | One coherent, fatigue-minimizing Tenure design language across every module, tenant, operator, public, Relay, and future native surface; forest green is the protected brand accent |
| AI boundary | Amazon Bedrock/SageMaker/AWS-hosted inference only; no direct external model API |
| AI default | Amazon Nova 2 Lite is the initial default multimodal reasoning model, subject to continuous tenant-safe evaluation and model routing |
| AI brand | Relay by Tenure; internal implementation remains model/provider independent |
| Production authority | Automated discovery, development, and staging allowed; production mutation and destructive operations require protected human approval |
| Marketplace | Architecture included now; customer-facing route stays empty with “Coming soon” until marketplace controls pass |

## 2. Tenure's philosophy expressed as system rules

The product promise is implemented through invariants, not marketing copy.

1. A person, identity, membership, seat, and seat assignment are different objects.
2. A seat survives occupants. An assignment has start and end instants and never becomes the seat itself.
3. Authority comes from an active, scoped assignment or explicit delegation, not from a title string, email domain, Cognito group, or UI state.
4. Work performed in Tenure automatically produces attributable operational memory. Users do not need to maintain a separate wiki for the platform to remember.
5. Every material answer can point to its source records, versions, effective policies, actors, and timestamps.
6. Historical knowledge persists, but access is recalculated under current policy. A successor does not automatically inherit a predecessor's private conversations or restricted personal records.
7. An approval snapshots the policy and workflow version that governed the decision.
8. Every state-changing action is idempotent, authorized, auditable, and attributable to a person, service, integration, or Relay execution.
9. Deletion, retention, legal hold, anonymization, export, and offboarding are explicit lifecycle states—not ad hoc SQL operations.
10. Tenant configuration is a signed, versioned product input. It can be validated, diffed, simulated, promoted, rolled back, and audited.
11. The system runs beside existing tools and ingests only authorized organizational material. It does not turn personal accounts into shadow company repositories.
12. Global scale is additive. A new region, cell, account, industry pack, identity provider, language, or module does not require rewriting core business logic.

## 3. Platform boundaries

### 3.1 Tenure Parent control plane

The parent control plane owns platform-wide metadata and lifecycle authority:

- Global tenant registry and immutable tenant identifiers.
- Environment, AWS partition, account, region, and deployment-cell catalog.
- Capacity, health, release, and isolation metadata for every cell.
- Tenant placement and migration policy.
- Configuration schemas, versions, overlays, validation, simulation, approval, promotion, and rollback.
- Organization templates, industry packs, terminology packs, permission catalogs, workflow templates, report packs, and connector definitions.
- Cognito pool/app-client strategy and enterprise SAML/OIDC/SCIM connection registry.
- Domain ownership verification and tenant-login discovery.
- Entitlements, product plans, usage meters, quotas, feature flags, and commercial billing metadata.
- Tenant provisioning, activation, suspension, export, retention, legal hold, offboarding, and deletion orchestration.
- Fleet release management, progressive rollout, drift detection, migration state, and rollback.
- Tenant-aware observability, SLOs, cost attribution, security posture, incident state, and support access.
- Extension signing, certification, distribution, revocation, compatibility, and future marketplace metadata.
- Global Relay model policy, evaluation results, allowed-model catalog, prompt/tool versions, and AI cost controls.

The control plane never becomes a convenient back door into tenant business content. Operator access to content is purpose-bound, time-limited, approved, strongly authenticated, and fully audited. Most fleet operations use health and metadata projections rather than raw tenant records.

### 3.2 Regional deployment cell

A cell is the smallest independently deployable, routable, observable, and capacity-managed unit. It has an immutable `cell_id` and explicit AWS partition, account, region, environment, release train, isolation profile, capacity class, routing weight, data-residency policy, and failure domain.

A standard cell contains:

- CloudFront, WAF, Shield posture, ACM certificates, and regional ingress.
- API Gateway and/or Application Load Balancer according to workload shape.
- ECS Fargate services for sustained APIs and workers; Lambda for bursty event and integration tasks.
- EventBridge buses, SQS queues, dead-letter queues, Step Functions for infrastructure/lifecycle orchestration, and MSK only where durable high-throughput streaming justifies it.
- Aurora PostgreSQL-compatible relational storage with RDS Proxy where useful.
- DynamoDB for sessions, idempotency records, fast projections, orchestration locks, and globally replicated routing projections where appropriate.
- S3 object, attachment, export, evidence, backup, and analytical zones.
- ElastiCache Serverless for safe caches and real-time coordination when demand justifies it.
- OpenSearch Serverless and/or Bedrock Knowledge Bases with S3 Vectors through a storage-driver abstraction.
- Cognito pools, app clients, domains, triggers, and enterprise identity connections according to pool strategy.
- Bedrock runtime, Guardrails, Knowledge Bases, Data Automation, AgentCore services, evaluation, and model invocation profiles allowed in that region.
- KMS, Secrets Manager, Systems Manager Parameter Store, AppConfig, CloudWatch, X-Ray/OpenTelemetry, CloudTrail, Config, GuardDuty, Security Hub, Access Analyzer, Backup, and cost controls.

No cell assumes that it is the only cell. Application code receives resolved cell and tenant context from trusted server-side routing. Region, pool, database, bucket, search index, issuer, callback, KMS key, and service endpoint are never globally hard-coded in business modules.

### 3.3 Tenant data plane

The tenant data plane runs business modules for one tenant within its selected cell and isolation profile. It owns tenant business records, object namespaces, search indexes, AI corpora, queues, encryption policy, integration connections, and tenant-specific runtime configuration. Shared compute may execute requests for many tenants, but every invocation carries a verified tenant context and can reach only that tenant's resolved resource handles.

### 3.4 Operator plane

The operator plane is a separate privileged surface for Tenure staff. It provides fleet health, tenant lifecycle, config promotion, release management, incident tooling, approved support sessions, cost, security findings, and evidence. It is not a hidden “super admin” route in the customer application. Operator identities use AWS IAM Identity Center/federation, hardware-backed phishing-resistant MFA where available, step-up for sensitive actions, just-in-time privilege, and session recording/audit.

### 3.5 Customer administration plane

The customer administration plane exposes safe, delegated configuration:

- Organization and seat design.
- Roles, permission policies, conditions, delegations, and separation-of-duty rules.
- Forms, fields, validation, calculated fields, statuses, views, and terminology.
- Workflow and approval builder.
- Reports, dashboards, notifications, automations, and retention within contracted bounds.
- Branding, locales, time zones, currencies, calendars, fiscal periods, and accessibility options.
- Identity-connection setup and test steps granted by Tenure policy.
- Connector setup using secret references and OAuth grants, never raw long-lived credentials in UI state.
- Relay behavior within allowed tools, data domains, budgets, model classes, and approval thresholds.

## 4. AWS Organization and account topology

Tenure operates a multi-account landing zone using AWS Organizations and AWS Control Tower or an evidence-backed equivalent. The AWS management account carries no application workload. Service control policies, delegated administration, centralized audit, and standardized account baselines apply at organizational-unit level.

Recommended topology:

| OU/account class | Purpose |
|---|---|
| Management account | Organizations, billing root, Control Tower administration; no product runtime |
| Security OU | Security tooling delegated administrator, security operations, break-glass governance |
| Log Archive OU | Organization CloudTrail, Config, audit evidence, immutable log archive, security-lake destinations |
| Infrastructure OU | DNS, network hubs, shared egress controls, artifact registries, CI/CD foundations |
| Tenure Parent OU | Global control plane, operator plane, tenant registry, release and configuration services |
| Nonproduction OU | Development, test, ephemeral preview, integration, performance, and staging accounts |
| Production Cells OU | Shared and bridge production cell accounts, separated by geography and failure domain |
| Dedicated Tenants OU | One Tenure-owned account per silo tenant or contracted group of accounts |
| Gov/Sovereign estate | Separate AWS partition/organization where required, governed by compatible templates and a partition-aware parent abstraction |
| Suspended/Quarantine OU | Accounts or cells isolated during incident, offboarding, or investigation without immediate deletion |

Account creation uses Control Tower Account Factory and a deterministic account-vending workflow. Every account receives baseline guardrails, CloudTrail/Config delivery, security services, budgets, contact metadata, backup policy, IAM boundaries, required tags, DNS/network posture, and deployment roles before workloads are admitted.

Tenant users never receive AWS root, IAM user, management-account, or general console access. A dedicated-account customer still consumes Tenure as SaaS. Infrastructure remains centrally versioned and operated through Tenure Parent. Contractual read-only evidence or customer-managed encryption participation can be exposed through purpose-built product workflows rather than direct uncontrolled account ownership.

## 5. Deployment and isolation classes

| Class | Compute | Relational data | Files/search/AI | Encryption | Intended use |
|---|---|---|---|---|---|
| Pooled | Shared cell services | Separate schema per tenant; no shared business tables | Tenant namespace/index and enforced metadata boundary | Cell key with tenant encryption context, optional tenant key | Small and standard tenants |
| Bridge | Shared services plus selected dedicated workers/queues | Separate tenant database on shared cluster or dedicated cluster | Dedicated index/vector namespace and optional bucket | Tenant KMS key | Higher volume or sensitive modules |
| Silo | Dedicated service stack in shared Tenure account | Dedicated cluster/database | Dedicated buckets, search collections, knowledge base, queues | Tenant KMS key | Regulated/high-volume enterprise |
| Dedicated account | Complete stack in a Tenure-owned member account | Dedicated cluster | Dedicated storage/search/AI boundary | Tenant/account keys | Strong contractual isolation |
| Regional/sovereign | Any class constrained to approved partition/regions | No unauthorized replication | Region-contained indexes, models, logs, backups | Partition/region keys | Residency, public sector, sovereignty |

The tenant placement engine evaluates residency, classification, regulatory profile, contracted tier, capacity, latency, required AWS services, model availability, customer-key requirements, disaster-recovery policy, and estimated cost. Placement emits an explainable decision and must be manually overridable only through an approved, audited Tenure operator policy.

Cross-tenant business queries do not run against live transactional databases. Fleet analytics consumes approved, minimized, tenant-consented metrics through a separate aggregation pipeline. Benchmarking or product analytics never exposes another tenant's content.

## 6. One-click tenant provisioning

“One click” means one controlled intent that drives an observable, idempotent state machine. It does not mean bypassing validation or approvals.

### 6.1 Required inputs

- Legal/customer name, tenant display name, immutable tenant ID request, and validated slug.
- Contracted plan, modules, usage limits, support tier, billing terms, and activation window.
- Primary geography, allowed/denied regions, residency, recovery, and retention requirements.
- Isolation class, encryption profile, customer-managed-key requirement, and audit tier.
- Organization template/industry pack plus tenant configuration overlays.
- Default locales, languages, currencies, time zones, fiscal calendars, holidays, number/date/address/name formats.
- Verified domains and identity modes; SAML/OIDC/SCIM connection inputs or explicit invitation-only local policy.
- Initial authorized administrators and high-assurance invitation path.
- Connector intents and externally supplied secrets/consents, which may remain pending without fabricating values.
- Relay policy: enabled modules, model classes, tools, automation thresholds, data classifications, budgets, and region constraints.

### 6.2 Lifecycle state machine

`DRAFT → VALIDATING → PLANNED → AWAITING_APPROVAL → PROVISIONING → CONFIGURING → MIGRATING → VERIFYING → READY → ACTIVATING → ACTIVE`

Failure and control states are explicit: `BLOCKED_EXTERNAL`, `FAILED_RETRYABLE`, `FAILED_TERMINAL`, `ROLLING_BACK`, `ROLLED_BACK`, `SUSPENDING`, `SUSPENDED`, `EXPORTING`, `OFFBOARDING`, `LEGAL_HOLD`, `DELETION_PENDING`, `DELETING`, and `DELETED_TOMBSTONE`.

Tenant fleet state is deliberately more precise than active/inactive. The global registry and operator UI expose `ACTIVE`, `IDLE`, `SUSPENDING`, `SUSPENDED_LOGICAL`, `HIBERNATING`, `HIBERNATED_ZERO_RUNTIME`, `REACTIVATING`, `OFFBOARDING`, `LEGAL_HOLD`, `PURGE_PENDING`, `PURGING`, `PURGED_ZERO_INCREMENTAL_COST`, and failure states. A single `is_active` boolean is prohibited because it hides security, recoverability, and billing truth.

### 6.3 Provisioning steps

1. Normalize and schema-validate the complete manifest.
2. Resolve configuration inheritance and produce a deterministic rendered configuration.
3. Check tenant name, slug, domain, external IDs, and idempotency-key uniqueness.
4. Evaluate residency, isolation, capacity, feature, model, and cost placement policy.
5. Reserve tenant ID, routing identity, deployment cell, and storage namespaces.
6. If needed, vend and baseline a Tenure-owned AWS account.
7. Plan infrastructure and reject unapproved deletion, replacement, public access, privilege expansion, or region movement.
8. Require protected approval for production or privileged changes.
9. Provision network, compute, identity, relational database/schema, queues, object storage, search/vector, keys, secrets namespaces, logs, alarms, backup, budgets, and WAF configuration.
10. Create Cognito app client/pool strategy, callbacks, logout URLs, federation draft, and safe login-discovery projection.
11. Run backward-compatible database migrations and seed only platform reference data.
12. Apply modules, entitlements, terminology, organization graph, seat templates, permission policies, workflow definitions, forms, reports, branding, localization, connectors, and Relay policy.
13. Create initial tenant administrator invitation using a single-use, tenant-bound, expiring, audited flow.
14. Run static validation, infrastructure tests, migration tests, tenant-isolation tests, authorization tests, synthetic transaction tests, browser smoke tests, accessibility checks, AI retrieval boundary tests, backup checks, and cost-budget checks.
15. Emit a signed deployment manifest with release digest, config digest, schema/migration versions, resource identifiers, tests, evidence, owner, and rollback target.
16. Activate routing only after every mandatory gate passes.
17. Monitor an elevated canary window; automatically stop rollout or return to the last safe route on alarm.

Each step persists status, attempts, timestamps, correlation ID, actor, input digest, output digest, error class, safe message, compensating action, and evidence reference. Retrying a step cannot create duplicate accounts, pools, clients, schemas, queues, invitations, workflows, or billing records.

### 6.4 Tenant fleet and zero-runtime-cost deactivation

The Tenure Parent operator plane provides a complete tenant fleet inventory with:

- Active, idle, suspended, hibernated, reactivating, offboarding, legal-hold, purge-pending, purged, failed, and drifted views.
- Tenant, plan, cell, account, region, isolation, release, configuration, last activity, last login, data volume, resource count, health, SLO, current/forecast AWS cost, and cost owner.
- Every AWS resource attributable to the tenant, its ARN/resource identity, service, account/region, lifecycle owner, IaC stack, current charge class, dependencies, retention, and deletion/recovery behavior.
- Safe bulk selection by policy, but never bulk destructive execution without per-tenant plans, protected approvals, and concurrency limits.

The system distinguishes three different actions:

1. `SUSPENDED_LOGICAL`: immediately denies user/integration access and state-changing work while preserving infrastructure for rapid resumption. This is a security/commercial state, not a cost-elimination claim.
2. `HIBERNATED_ZERO_RUNTIME`: disables routing, authentication entry points, schedules, connectors, event sources, notifications, AI ingestion/inference, and background work; drains in-flight jobs; scales compute to zero; pauses or snapshots/deletes dedicated databases according to recovery policy; deletes dedicated search/vector/cache/network endpoints; and removes other standing runtime charges. Explicitly retained files, database snapshots/exports, backups, immutable audit, legal holds, logs, DNS, secrets, or KMS keys can still incur storage/control charges. The UI must show each residual charge and estimated monthly cost.
3. `PURGED_ZERO_INCREMENTAL_COST`: after export, contract, retention, legal-hold, tax/audit, and cooling-off gates pass—and after separate destructive human approval—the engine deletes every tenant-specific billable resource and retained byte. It keeps only a minimal non-content tombstone in the shared Parent registry: tenant ID, lifecycle timestamps, purge manifest digest, approvals, and evidence reference. This is the only state allowed to claim zero incremental recurring AWS cost for that tenant.

Hibernation orchestration inventories and handles, where applicable:

- CloudFront distributions/behaviors, WAF associations/rules, custom domains, Route 53 records/zones, ACM references, API Gateway stages/custom domains, ALBs/NLBs, target groups, NAT gateways, Elastic IPs, VPC endpoints, and private connectivity.
- ECS services/tasks, Lambda event-source mappings/concurrency, Step Functions executions/schedules, EventBridge rules/Scheduler schedules, SQS/SNS subscriptions/queues, MSK/Kinesis capacity, and notification delivery.
- Aurora/RDS compute, proxies, snapshots, automated backups, DynamoDB tables/PITR/exports, ElastiCache, OpenSearch collections/indexes, S3 Vectors indexes, Bedrock Knowledge Bases/data sources, and SageMaker endpoints/jobs.
- S3 objects/versions/multipart uploads/replicas, exports, analytics partitions, AI derivatives, previews, logs, CloudWatch log groups/alarms/dashboards, CloudTrail data-event selectors, backup recovery points, Config recorders/rules attributable to dedicated accounts, Secrets Manager secrets, KMS keys/grants, and connector credentials.
- Cognito app clients, identity providers, custom domains, triggers, sessions, invitations, SCIM tokens, service accounts, webhooks, and external connector subscriptions.
- Dedicated account baselines and account closure only after the account contains no required retained evidence and the protected closure workflow is approved.

For pooled cells, Tenure cannot honestly shut down shared infrastructure used by active tenants. It instead removes the inactive tenant's routing, jobs, tenant schemas/databases, storage/index namespaces, keys/secrets, backups, and billable dedicated resources according to its selected recovery/purge policy. Shared parent/control-plane cost is not attributed as an avoidable tenant resource. The goal is **zero incremental recurring tenant cost**, not the false claim that the entire shared platform has no cost.

Before hibernation or purge, the engine produces a dependency-ordered plan with resource inventory, last activity, in-flight work, export/backup state, legal/retention blockers, expected residual resources, expected monthly residual cost, recovery point, reactivation time, destructive steps, and rollback boundary. The same state machine drains traffic and work, revokes access, exports/snapshots when policy permits, applies the plan, scans for orphaned resources, and records a signed lifecycle manifest.

Cost verification is mandatory:

- Tag/application inventory reconciliation proves no unplanned tenant resource remains.
- AWS Cost and Usage Report/Cost Explorer data is checked after billing data settles at defined 24/48/72-hour windows.
- A `HIBERNATED_ZERO_RUNTIME` tenant may show nonzero retained-storage/control cost and must display it plainly.
- A `PURGED_ZERO_INCREMENTAL_COST` tenant cannot receive that state until residual-cost scans show no tenant-attributable recurring resources/usage above the configured billing granularity for the verification window.
- Any residual charge creates an actionable finding with service, resource, account/region, owner, amount, reason, and deletion/retention decision.

Reactivation is also a state machine. A logically suspended tenant can resume quickly after security and billing checks. A hibernated tenant is reprovisioned from the signed configuration/release plus retained recovery artifacts and must pass migrations, isolation, identity, connector, search/AI reindex, smoke, and billing tests before routing. A purged tenant has no recoverable tenant content; it can only be onboarded as a new system from independently held configuration or customer-provided import.

## 7. Configuration distribution engine

### 7.1 Configuration hierarchy

Configuration is layered in deterministic precedence:

1. Platform invariants that tenants cannot override.
2. AWS partition and regional capability profile.
3. Environment profile.
4. Product edition/plan and entitlements.
5. Industry pack.
6. Organization archetype/template.
7. Tenant baseline.
8. Tenant-approved overlay.
9. Organizational-unit overlay where permitted.
10. Time-bound experiment or feature flag.
11. Emergency deny/kill switch, which may only restrict—not expand—authority.

Every layer has an immutable version, semantic schema version, signer, origin, compatibility range, effective interval, change reason, and approval record. The renderer rejects ambiguous precedence, unknown fields, dependency cycles, invalid permission references, unreachable workflows, missing translations, unsafe expressions, and entitlements the tenant has not purchased.

### 7.2 Configuration domains

- Tenant identity, domains, branding, themes, navigation, and terminology.
- Organization types, hierarchy constraints, relationship types, seats, assignment categories, and lifecycle states.
- Semantic permission catalog, roles, policies, conditions, delegations, approvals, and separation of duties.
- Module enablement, features, limits, data classifications, retention, export, and legal-hold behavior.
- Entity types, fields, forms, validations, calculations, layouts, statuses, views, and reference data.
- Workflow state machines, timers, escalations, service levels, approvals, compensations, and notifications.
- Reports, metrics, semantic dimensions, dashboards, subscriptions, and row/column masking.
- Integrations, scopes, mapping, transformations, schedules, webhooks, retries, reconciliation, and ownership.
- Relay models, prompts, tools, allowed operations, budgets, confidence thresholds, citations, human approval, and evaluation sets.
- Deployment placement, scaling, backup, availability, recovery, observability, and cost policy.

### 7.3 Config-as-code and visual administration

The canonical representation is typed, declarative, and machine-readable. YAML/JSON files support platform and Tenure-managed packs; the customer admin UI writes the same canonical model through validated APIs. The visual builder is not a second configuration system.

Every proposed change supports:

- Draft, validate, lint, dependency graph, policy check, and cost impact.
- Human-readable and machine-readable diff.
- Simulation against synthetic and tenant-approved fixtures.
- Preview environment or shadow evaluation for material changes.
- Four-eyes approval for security, identity, finance, retention, AI tools, and production-critical workflows.
- Scheduled effective date and reversible activation.
- Progressive scope by user cohort, org unit, module, or region.
- Automated rollback on invariant or health failure.
- Full audit with author, approver, activation, rollback, and affected resources.

## 8. Canonical organizational graph

The organizational graph must represent a university, company, government body, nonprofit, hospital, factory, board, project consortium, or future structure without changing core code.

### 8.1 Core entities

| Entity | Meaning |
|---|---|
| `Tenant` | Contractual and isolation boundary for an organization using Tenure |
| `OrganizationUnit` | Effective-dated node such as company, campus, division, office, club, department, team, location, committee, or project |
| `OrganizationRelationship` | Typed, effective-dated edge such as reports-to, oversees, funds, owns, serves, collaborates-with, or matrix-reports-to |
| `Seat` | Durable position/job ID that survives occupants and may own scoped memory, authority, queues, assets, and relationships |
| `Person` | Human being, separate from identity, membership, employment/student status, or seat |
| `ExternalIdentity` | Verified issuer/subject/connection identity link; email is an attribute, never the stable key |
| `Membership` | Person's effective-dated association with a tenant and status |
| `SeatAssignment` | Effective-dated occupancy of a seat, including active, shadow, interim, delegate, alumni, leave, or future state |
| `Delegation` | Time-, action-, resource-, and condition-bounded authority derived from an eligible source |
| `Team/Cohort` | Dynamic or static group for collaboration, not an automatic security principal unless policy binds it |
| `Resource` | Any governed record, document, account, event, asset, workflow, message, dataset, or external object |
| `Policy` | Versioned authorization, workflow, retention, AI, financial, or operational rule |
| `MemoryRecord` | Provenance-rich atomic fact, decision, lesson, procedure, relationship, or context object attached to governed entities |

### 8.2 Temporal truth

All mutable organizational facts requiring historical reconstruction use effective dating plus transaction time. Corrections append a superseding version; they do not rewrite history invisibly. At any point the platform can answer:

- Who occupied a seat at the time of a decision?
- Which authority and policy version applied?
- What organization hierarchy and delegation were effective?
- What source evidence supported a memory or Relay answer?
- When did the platform learn or correct a fact?
- Which current actor may view the historical content now?

### 8.3 Durable-seat semantics

A seat has a permanent semantic ID, display title history, organization scope, purpose, responsibilities, required capabilities, default role templates, successor/predecessor relationships, assignment policy, queues, dashboards, playbooks, contacts, vendors, assets, credentials-by-reference, goals, recurring obligations, and memory collection.

Seat ownership never means a successor automatically receives secrets. Credentials live in approved systems and are rotated or reassigned through a transition workflow. Restricted predecessor communications, HR records, investigations, legal material, and personal data remain governed by classification and purpose.

## 9. Identity, sessions, and authorization

### 9.1 Identity architecture

Amazon Cognito authenticates and federates. Tenure resolves the person, tenant membership, identity connection, active assignments, policies, and session. Cognito Groups are not canonical RBAC.

Supported login methods:

- Enterprise SAML 2.0.
- Enterprise OIDC.
- Approved Cognito local authentication, invitation-only by default.
- Passkeys/passwordless and adaptive controls when supported by the chosen Cognito configuration and tenant policy.
- Step-up/recent authentication for high-risk actions.
- SCIM 2.0 lifecycle provisioning and deprovisioning.
- Service/workload identities with narrowly scoped machine capabilities.

The login resolver starts from verified tenant domain/subdomain, tenant slug, signed invitation, prior secure session, or normalized work email used only as a discovery hint. It returns safe branding and allowed methods through an opaque transaction. It never reveals whether a person exists or grants membership from an email domain.

Web authentication uses Authorization Code + PKCE and a backend-for-frontend session. Browser cookies are `Secure`, `HttpOnly`, appropriately `SameSite`, narrowly scoped, rotated at authentication and privilege changes, and backed by server-side revocation. Tokens are not stored in browser local storage. Every callback validates state, nonce, PKCE, issuer, signature, time, token use, client/audience, scopes, connection, return path, and single use.

### 9.2 Authorization model

Every protected action evaluates:

`actor + authenticated identity + active tenant + active membership + active seat assignments + semantic action + resource + resource tenant + organization relationships + explicit role grants + attributes + policy version + time + delegation + risk/session assurance + explicit denies`

The engine combines:

- RBAC for reusable semantic permission bundles.
- ABAC for classification, amount, geography, employment/student status, risk, time, device/session assurance, and resource attributes.
- ReBAC for organization, seat, manager, owner, participant, advisor, overseer, and collaboration relationships.
- Policy-based rules for separation of duties, self-approval prohibition, quorum, four-eyes review, and regulatory constraints.
- Temporal rules for assignment and delegation start/end boundaries.
- Explicit deny precedence.

Authorization is centralized as a service boundary and enforced in API, service, query/repository, search, export, analytics, event, websocket, file, integration, support, and Relay tool paths. Frontend entitlements improve UX but never provide security.

### 9.3 Permission key design

Permissions use stable semantic keys independent of tenant terminology, for example:

- `finance.budget.read`, `finance.budget.propose`, `finance.payment.approve`
- `events.event.create`, `events.event.publish`, `facilities.room.reserve`
- `identity.membership.invite`, `org.seat.assign`, `org.delegation.grant`
- `documents.document.read_sensitive`, `records.hold.place`
- `workflow.definition.activate`, `config.release.promote`
- `ai.query.execute`, `ai.tool.finance.create_draft`, `ai.tool.workflow.approve`

Tenant labels may rename Treasurer to Finance Lead or Division to Faculty, but semantic permission keys do not change.

### 9.4 Support and break-glass

Support access requires a tenant-approved or incident-policy request, ticket/reason, narrow scope, time limit, step-up MFA, visible banner, audit, and automatic revocation. Impersonation never silently becomes the customer; actions record both operator and represented actor. Break-glass is separately controlled, alarms immediately, and requires post-incident review.

## 10. Institutional memory fabric

Memory is a first-class platform service, not a vector database or chat transcript.

### 10.1 Memory sources

- Structured records and state changes from every Tenure module.
- Effective policy, workflow, form, and configuration versions.
- Approvals, denials, comments, exceptions, escalations, and reasons.
- Documents, contracts, presentations, spreadsheets, images, scans, charts, diagrams, audio, and video.
- Role-aware messages and threads explicitly governed as organizational records.
- Calendar events, attendance, run-of-show, conflicts, and outcomes.
- External connector objects ingested under consent and scope.
- Explicit lessons, playbooks, procedures, decisions, handoff notes, contacts, vendor knowledge, deadlines, and risks.
- Derived summaries and extracted entities marked as derived, never confused with source truth.

### 10.2 Memory record contract

Every memory record carries tenant, owning organization, related seat(s), source resource, source version, author/actor, event time, transaction time, classification, purpose, retention class, legal-hold state, visibility policy, provenance, extraction method, confidence, language, entity links, supersession chain, and integrity digest.

The platform distinguishes:

- Source evidence: immutable or versioned original material.
- Canonical fact: validated structured truth owned by a module.
- Assertion: a statement awaiting verification.
- Decision: choice, authority, rationale, policy snapshot, and outcome.
- Procedure/playbook: versioned operational method.
- Lesson: retrospective context with author and confidence.
- Derived summary: regenerable model or human synthesis with source links.
- Conversation memory: scoped context with explicit retention and no authority by itself.

### 10.3 Automatic capture

Domain events feed a memory projection pipeline through an outbox. The pipeline normalizes entities, resolves seat and organization links, applies classification and retention, writes a source reference, updates search/index projections, and emits an auditable memory event. Failure to index never loses the source transaction; replay repairs the projection.

### 10.4 Handoff

A transition workflow freezes the outgoing assignment's authority on its effective end, inventories incomplete work, pending approvals, recurring obligations, owned resources, expiring credentials, relationships, playbooks, recent decisions, unresolved risks, and knowledge gaps. The incoming assignment receives a policy-filtered handoff package, guided checklist, attestations, and Relay onboarding path. Restricted content remains restricted.

### 10.5 Memory quality

Memory quality is measured by provenance coverage, citation resolvability, freshness, contradiction rate, unowned obligations, handoff completeness, retrieval precision/recall, answer groundedness, correction latency, and successor time-to-competency—not by chat volume.

## 11. Relay by Tenure: AI and automation architecture

Relay is the copilot inside every authorized user system. It is aware of the tenant's enabled modules and the subset of records, seats, organizations, tools, and actions the current actor may access.

### 11.1 User capabilities

Relay must be able to:

- Answer questions across authorized organizational history with record-level citations.
- Summarize documents, threads, meetings, policies, dashboards, projects, accounts, and seat histories.
- Read and explain text, PDFs, Office files, images, screenshots, forms, charts, diagrams, audio, and video.
- Compare versions, periods, vendors, budgets, policies, plans, and outcomes.
- Extract structured fields, entities, dates, amounts, obligations, risks, decisions, and action items.
- Draft and edit authorized records, documents, reports, messages, forms, workflows, and knowledge objects.
- Create plans, tasks, requests, events, budgets, purchase requisitions, cases, and handoff checklists through typed tools.
- Execute multi-step automations within explicit user and tenant policy.
- Monitor approved conditions and propose or take allowed actions.
- Explain what it did, which tools ran, which records changed, what policy authorized the action, and how to undo or compensate.
- Refuse or seek approval when authorization, evidence, confidence, model region, budget, separation of duties, or risk policy is insufficient.

### 11.2 Model strategy: value, not brand bias

The internal `ModelGateway` uses Amazon Bedrock APIs and a normalized message/tool contract. Models are selected through task classification, regional availability, tenant policy, modality, context size, latency target, measured quality, and total expected cost. No business module imports a provider SDK directly.

Initial routing policy, based on the AWS catalog and pricing available on 2026-07-31:

| Tier | Initial model | Use | Reason |
|---|---|---|---|
| Fast text | Amazon Nova Micro | Classification, routing, short extraction, translation, lightweight summaries | AWS describes it as its fastest low-cost text-only model; keep visual tasks off this tier |
| Default multimodal | Amazon Nova 2 Lite | RAG answers, document/image/chart/video understanding, general tool use, standard automation | Cost-efficient multimodal reasoning, 1M context, controllable thinking, strong speed/value; listed at $0.30/M input and $2.50/M output tokens in US standard pricing |
| Advanced | Evaluated Bedrock frontier model; initial candidate Claude Sonnet 5 | High-stakes synthesis, complex plans, difficult tool sequences, advanced analysis | Near-frontier capability with 1M context; current launch pricing is $2/M input and $10/M output through 2026-08-31, then $3/M and $15/M |
| Batch | Cheapest evaluation-approved Bedrock model/service tier | Offline summaries, enrichment, classification, nightly memory maintenance | Queueable work trades latency for cost; output limits and quality gates still apply |

Amazon Nova 2 Lite is the default—not an irreversible dependency. Before changing or promoting a model, Tenure runs a tenant-safe evaluation set covering retrieval, citations, authorization refusal, finance/math, temporal organization reasoning, charts, diagrams, tables, long documents, multilingual tasks, tool selection, structured output, prompt injection, latency, and cost. Bedrock model and RAG evaluation results are versioned. A model that is cheaper but fails mandatory quality/security thresholds is not eligible.

Cross-region inference is disabled for a tenant unless its residency policy explicitly permits every region in the inference profile. A model's absence from an allowed region is a routing constraint, never permission to move data silently.

### 11.3 AI request pipeline

1. Authenticate the Tenure session and resolve tenant, actor, assignments, policy revision, cell, and AI entitlements.
2. Classify task, modality, sensitivity, risk, and required tools using trusted metadata and bounded inspection.
3. Build an allowed-resource filter and allowed-tool capability set from the same authorization engine used by the application.
4. Scan user input and attachments for malware, unsupported types, policy violations, and prompt-injection indicators.
5. Retrieve candidate structured records, keyword results, graph neighbors, vector results, and source versions within the tenant boundary.
6. Reauthorize every candidate at read time; remove inaccessible sources before model context construction.
7. Rerank and build a provenance-rich context package with citations, temporal facts, policy versions, and explicit unknowns.
8. Select the cheapest evaluation-approved model that meets modality, quality, latency, context, tool, and residency requirements.
9. Invoke Bedrock through a regional inference profile with guardrails, output schema, budget, timeout, and trace context.
10. Validate structured output, citations, groundedness, policy consistency, and requested action parameters.
11. For read-only output, return citations and calibrated uncertainty. For writes, send typed commands through the standard application command path.
12. Preview material writes and require confirmation/approval according to policy. High-risk actions never become autonomous merely because the model is confident.
13. Execute with idempotency, optimistic concurrency, authorization recheck, transactional outbox, and compensation where appropriate.
14. Record safe trace, model/prompt/tool versions, sources, decisions, token/cost metrics, approvals, result, and changed resources without logging secrets or unrestricted content.

### 11.4 Multimodal ingestion

| Content | Primary pipeline | Preserved outputs |
|---|---|---|
| PDF/Office/text/HTML/CSV | S3 quarantine → validation → Bedrock parser/Data Automation; Textract for specialized OCR/forms when justified | Original, extracted text, tables, figures, page/slide/sheet coordinates, structure, provenance |
| Image/screenshot/scan/chart/diagram | Malware/type validation → Data Automation and/or Nova multimodal processing → multimodal embeddings | Original, OCR, visual description, chart/table structure, objects, coordinates, confidence |
| Audio | Validation → Bedrock multimodal processing or Transcribe path → speaker/time segments | Original, transcript, timestamps, speakers where lawful, summary, entities |
| Video | Validation → Bedrock multimodal processing, MediaConvert where needed → scenes/transcript | Original, scene/time index, transcript, visual descriptions, extracted frames, entities |
| Structured Tenure records | Domain event/outbox → canonical projection → text/graph/vector index | Field-level source IDs, versions, effective time, permissions, module semantics |
| External connector content | Connector staging → scope/mapping/classification → canonical or referenced representation | External ID/version, origin, consent, sync watermark, deletion/tombstone state |

Original bytes remain in versioned, encrypted S3 and are never replaced by model extraction. Every derivative points back to byte digest, object version, parser/model version, page/time coordinates, and extraction confidence.

### 11.5 RAG storage and retrieval

The default cost-conscious path uses Amazon Bedrock Knowledge Bases with S3 Vectors where its capability, regional availability, filtering, and latency meet the tenant's requirements. Managed Knowledge Base or OpenSearch Serverless is selected when agentic retrieval, advanced lexical/vector search, scale, or query features justify it. Storage is behind a `KnowledgeIndex` interface so a tenant can move isolation class without changing product code.

Retrieval combines:

- Direct lookup of canonical records for exact facts.
- Relational queries for amounts, states, dates, and transactions.
- Keyword/BM25 search for exact phrases and identifiers.
- Vector and multimodal similarity search.
- Organization/seat/resource graph traversal.
- Time-aware retrieval and version selection.
- Metadata filtering for tenant, org, seat, module, classification, record type, effective interval, source, language, and retention.
- Reranking, diversity, deduplication, citation completeness, and freshness.

Vector similarity never grants access. Index-time filters reduce exposure and read-time authorization is mandatory. Dedicated tenants receive dedicated knowledge bases/indexes; pooled tenants receive separate indexes/namespaces and enforced resource handles consistent with the “no shared business tables” promise.

### 11.6 Relay tools and action safety

Relay tools are versioned, typed capabilities registered in a tool catalog. Each tool declares input/output schema, semantic permission, resource resolver, risk level, idempotency behavior, preview support, confirmation policy, compensation, timeout, retry policy, and audit event.

Risk classes:

- `R0_READ`: search, explain, summarize, compare.
- `R1_DRAFT`: create drafts and previews without external effects.
- `R2_REVERSIBLE_WRITE`: create/update an internal record with history and an undo/compensation path.
- `R3_EXTERNAL_EFFECT`: send a message, create an external event, submit a request, or trigger an integration.
- `R4_CONTROLLED_HIGH_RISK`: approve money, change access, publish policy, export sensitive data, sign, delete, pay, hire/fire, or alter production configuration.
- `R5_PROHIBITED_AUTONOMY`: break-glass, destructive tenant deletion, root/IAM escalation, bypassing approvals, secret retrieval, unreviewed production deployment.

R0 may execute after authorization. R1 normally executes and presents the draft. R2 may be tenant-configured for automatic execution within amount/scope limits. R3 requires explicit confirmation unless a previously approved automation policy precisely covers it. R4 always uses the module's ordinary approvals, separation of duties, and step-up. R5 cannot be granted to Relay.

### 11.7 AI memory scopes

- Turn context: ephemeral request/response state.
- Conversation context: bounded thread state with explicit retention.
- User preferences: private personalization that cannot become organizational truth.
- Seat memory: governed operational continuity available to eligible occupants.
- Organization memory: shared facts and practices under organizational policy.
- Resource memory: history attached to a vendor, project, event, policy, customer, asset, or record.
- Tenant memory: cross-module organizational corpus filtered by current authorization.

Relay never converts personal preference or conversational speculation into canonical organizational memory without an explicit governed write.

### 11.8 AI security and quality

- Treat documents, webhooks, connectors, retrieved text, images, and tool outputs as untrusted data—not system instructions.
- Separate system policy, tool schema, retrieved evidence, and user content in the prompt contract.
- Use Bedrock Guardrails for content, sensitive-information, contextual-grounding, and eligible automated-reasoning checks.
- Validate citations against actually retrieved and authorized source versions.
- Require structured output and server-side schema validation for tools.
- Use canary datasets, adversarial injection tests, cross-tenant tests, and high-risk refusal tests on every model/prompt/tool release.
- Set per-user, seat, tenant, task, model, and monthly budgets; meter input, cache, reasoning, output, embedding, parser, reranking, and tool costs.
- Cache only safe reusable prompt/context segments and never mix tenant content in a shared cache key.
- Provide “why this answer,” sources, data timestamp, and correction/report paths.
- Store no hidden chain of thought. Persist concise decision/rationale summaries and tool evidence appropriate for audit.

## 12. Shared platform services

All business modules use common platform services. A module does not invent its own users, permissions, approvals, files, comments, audit, search, AI, notifications, or integration framework.

### 12.1 Required shared services

| Service | Responsibilities |
|---|---|
| Tenant Context | Trusted tenant/cell/resource resolution, isolation handles, entitlement and config revision |
| Identity | Person, external identity, connection, membership, invitation, session, recovery, lifecycle |
| Organization Graph | Units, seats, relationships, assignments, delegations, temporal queries |
| Authorization | Semantic actions, policies, conditions, explicit denies, decisions, explanations, revisions |
| Configuration | Schemas, versions, overlays, validation, simulation, promotion, flags, rollback |
| Workflow | State machines, assignments, approvals, timers, escalation, compensation, SLA |
| Forms and Metadata | Custom entities/fields, forms, calculations, validation, views, localization |
| Files and Records | Upload, versions, classification, malware scan, preview, e-sign references, retention, hold |
| Search | Structured, lexical, graph, semantic, multimodal, permission-aware search |
| Memory | Provenance, seat/resource attachment, handoff, contradiction/correction, quality |
| Relay | RAG, model routing, tools, AI budgets, evaluation, trace, citation |
| Messaging | Threads, participants, sensitivity, work-resource links, delivery, retention |
| Notification | Preferences, templates, channel policy, digest, escalation, delivery state |
| Calendar | Time zones, recurrence, resources, conflicts, availability, external sync |
| Audit and Evidence | Append-only application audit, hash chain, export, verification, policy snapshots |
| Integration Hub | Connections, OAuth/secrets, mapping, sync, webhooks, reconciliation, health |
| Reporting | Semantic metrics, dashboards, exports, subscriptions, masking, lineage |
| Billing and Metering | Entitlements, usage, quotas, tenant billing, invoices, cost attribution |
| Scheduler | Durable schedules, recurring obligations, jobs, backfill, missed-run handling |
| Localization | Translation catalogs, formats, fiscal/calendar rules, content locale, fallback |
| Feature Delivery | Flags, experiments, cohorts, release trains, kill switches, telemetry |

### 12.2 Commands, queries, and events

Business writes enter through typed commands. A command includes command ID, tenant, actor/service context, semantic action, target reference, expected version, idempotency key, requested effective time, correlation/causation IDs, configuration/policy revision, source channel, and validated payload.

The module:

1. Re-resolves tenant and actor context.
2. Authorizes the semantic action.
3. Validates invariants and optimistic concurrency.
4. Performs one atomic state transition.
5. Writes audit and outbox records in the same transaction.
6. Returns the authoritative version and safe projection.

Outbox dispatch creates versioned domain events. Consumers are idempotent and cannot interpret an event as permission to access arbitrary tenant data. Events carry only the minimum payload needed plus trusted resource references. Sensitive consumers reread and reauthorize through a service capability.

Queries are tenant-bound repository operations. Raw ORM/database clients are unavailable to controllers, Relay tools, connectors, and general module code. The repository requires a resolved tenant resource handle, applies schema/database selection, field masking, soft/archive state, and current authorization filters.

### 12.3 Workflow runtime

Tenant business workflows run on a Tenure workflow engine, not one AWS Step Functions state machine per customer process. Step Functions remains ideal for control-plane provisioning and bounded infrastructure operations; tenant workflows use versioned definitions persisted in Tenure, queues/timers in AWS primitives, and worker execution on ECS/Lambda.

Workflow definition primitives:

- Start conditions, manual starts, schedules, domain-event triggers, connector/webhook triggers.
- Typed states, transitions, guards, calculations, and actions.
- Seat-, role-, person-, queue-, rule-, or relationship-based assignment.
- Sequential, parallel, quorum, consensus, conditional, threshold, and dynamic approvals.
- Timers, due dates, business calendars, SLA pauses, reminders, escalations, and delegation.
- Human tasks, system tasks, Relay draft/analyze tasks, integration tasks, and compensating tasks.
- Separation of duties, no-self-approval, maker-checker, conflict-of-interest declarations, and recusal.
- Retry, timeout, dead-letter, cancellation, withdrawal, correction, reopening, and compensation.
- Policy/config snapshot, immutable decision history, comments, attachments, evidence, and signatures.
- Definition migration rules for in-flight instances; activation never silently changes an active decision path.

### 12.4 Custom objects and fields

Tenant configuration may define approved object types without creating arbitrary production SQL. The metadata service provides typed fields, references, constraints, indexes, unique keys, state models, calculations, layouts, forms, views, import/export mappings, retention, classification, permissions, and audit.

Custom expressions use a bounded deterministic expression language with no network, file, process, reflection, secret, or arbitrary code access. Expression execution has cost/time limits, dependency analysis, cycle detection, test fixtures, versioning, and reproducibility.

## 13. Complete ERP module map

Modules are independently entitled but share the canonical organization, seat, workflow, record, audit, integration, and memory foundation. Early releases implement a coherent subset deeply; the architecture reserves the full map so growth does not require a second platform.

### 13.1 Organization, people, and position management

Core capabilities:

- Multi-entity organization graph, legal entities, business units, campuses, departments, branches, clubs, teams, committees, projects, locations, and matrix structures.
- Durable seat catalog with job/position IDs, responsibilities, competencies, cost centers, default authority, reporting relationships, succession, and vacancy state.
- Person profiles, contact methods, privacy preferences, identifiers, membership/employment/student/volunteer relationships, and lifecycle state.
- Effective-dated assignments: active, future, interim, acting, shadow, delegate, leave, former, alumni, contractor, advisor.
- Span of control, dotted-line, functional, geographic, project, and oversight relationships.
- Position request, creation, change, freeze, transfer, split, merge, archive, and approval.
- Joiner/mover/leaver and graduation/term transition orchestration.
- Delegation, power of attorney reference, temporary authority, emergency coverage, and automatic expiry.
- Skills, capabilities, certifications, interests, availability, and eligibility.
- Directories, rosters, org charts, seat maps, vacancies, succession risk, and continuity health.
- Bulk import, identity reconciliation, duplicate resolution, SCIM sync, and external-HRIS coexistence.

### 13.2 Institutional memory and knowledge management

- Seat, organization, resource, vendor, customer, asset, process, project, and policy memory timelines.
- Handoff workspaces, transition checklists, gap detection, successor onboarding, shadow periods, and attestations.
- Playbooks, standard operating procedures, FAQs, decision records, lessons learned, retrospectives, and institutional contacts.
- Source-to-summary provenance, citations, contradiction alerts, fact correction, supersession, and freshness review.
- Knowledge ownership, steward assignment, review cadence, expiration, archival, retention, and legal hold.
- Memory capture from domain events, documents, messages, meetings, workflows, and integrations.
- Continuity dashboards: vacant critical seats, unowned recurring work, expiring knowledge, incomplete handoffs, inaccessible dependencies.
- Relay question-answering, guided onboarding, briefings, and knowledge-gap prompts.

### 13.3 Work, projects, goals, and portfolios

- Tasks, subtasks, checklists, dependencies, milestones, issues, risks, decisions, deliverables, and work logs.
- Personal, seat, team, project, department, portfolio, and enterprise work views.
- Kanban, list, timeline, calendar, workload, roadmap, critical path, and dependency graph.
- Programs, portfolios, strategic initiatives, stage gates, benefits, budgets, resources, and health.
- Goals, objectives, key results, metrics, alignment trees, confidence, check-ins, and retrospectives.
- Intake forms, prioritization models, scoring, capacity planning, assignment, SLA, and escalation.
- Templates, recurring work, business calendars, baselines, change requests, and closeout.
- Time, effort, cost, utilization, billability, and external project-system synchronization.
- Project memory that follows durable sponsor/owner seats across personnel changes.

### 13.4 Workflow, approvals, requests, and case management

- No-code form and workflow builder using the common workflow runtime.
- Service catalogs, request types, routing, queues, SLAs, knowledge suggestions, and fulfillment.
- Multi-step and conditional approvals by seat, hierarchy, amount, risk, category, geography, funding source, and policy.
- Case intake, classification, assignment, investigation tasks, evidence, notes, communications, decisions, and closure.
- Anonymous/confidential intake with safe identity separation where law and policy allow.
- Appeals, exceptions, waivers, escalations, rework, cancellation, reopening, and corrective actions.
- Policy snapshot, decision rationale, conflict-of-interest, recusal, signature/attestation, and immutable outcome.
- Queue analytics, bottlenecks, aging, SLA breach, root cause, and automation effectiveness.

### 13.5 Documents, content, contracts, and records

- Folderless metadata-first library plus optional familiar folders/workspaces.
- Upload, resumable multipart transfer, malware protection, file type verification, checksum, quarantine, release, and preview sandbox.
- Versioning, check-in/out where needed, comparison, comments, annotations, approval, publication, and archival.
- Office documents, PDFs, images, audio, video, CAD/technical artifacts as governed binaries, and link/reference objects.
- Templates, document generation, merge fields, controlled clauses, and batch generation.
- Classification labels, sensitivity, watermark, download/print restrictions where enforceable, and field-level metadata.
- Contract request, intake, clause extraction, negotiation/version trail, approval, e-sign provider integration, obligations, renewals, expirations, and termination.
- Records schedule, declaration, disposition, hold, evidence, export, and defensible deletion.
- AI OCR, table/chart extraction, summaries, obligations, risk flags, comparison, and grounded Q&A.
- External storage coexistence with Google Drive, OneDrive/SharePoint, Box, Dropbox, and S3 through governed references or synchronized copies.

### 13.6 Messaging, collaboration, meetings, and notifications

- Direct, seat-to-seat, group, channel, organization, project, case, event, and resource-linked threads.
- Identity-visible and seat-visible authorship according to policy; no anonymous authority.
- Sensitivity, retention, legal hold, export, moderation, edit/delete history, reactions, mentions, and attachments.
- Cross-organization collaboration spaces with explicit sponsorship, approval, data boundary, and expiration.
- Email bridge, inbound aliases, outbound delivery, reply capture, bounce/complaint handling, and threading.
- In-app inbox, digest, push, email, SMS, webhook, and external-chat delivery based on channel policy.
- Notification preference, quiet hours, time zone, urgency, escalation, deduplication, batching, and delivery receipts.
- Meeting agenda, materials, attendance, transcript/notes, decisions, actions, follow-up, and memory publication.
- Relay drafting, summary, translation, action extraction, and context recall with source permissions.

### 13.7 Calendar, events, facilities, and resources

- Personal, seat, team, organization, tenant, public, resource, and federated external calendars.
- Events, sessions, recurring series, deadlines, milestones, office hours, shifts, and blackout periods.
- Venue/room/resource inventory, capacity, layouts, equipment, accessibility, setup/teardown, and ownership.
- Hard conflicts: same exclusive resource/time, impossible capacity, blocked period, double-booked required participant.
- Soft conflicts: competing audience, travel/setup buffer, related-event overlap, preferred spacing, policy warning.
- Event proposal, budget, venue, vendor, risk, accessibility, marketing, attendee, check-in, run-of-show, incident, and closeout workflows.
- RSVP, registration, waitlist, ticket category, consent, guest, attendance, QR/check-in, and communications.
- Google/Microsoft calendar synchronization, ICS, conferencing links, room systems, and time-zone-safe recurrence.
- Calendar policy and conflict decisions snapshotted for reconstruction.

### 13.8 Finance core

Finance uses an immutable, balanced double-entry subledger and controlled accounting periods. Dashboards never calculate money from mutable UI state.

- Legal entity, ledger, chart of accounts, dimensions, fiscal calendars, periods, currencies, exchange rates, and accounting policies.
- Journal entry, journal lines, source subledger, posting, approval, reversal, adjustment, recurring journal, close, reopen, and lock.
- Budgets, versions, scenarios, allocations, transfers, commitments, encumbrances, actuals, forecasts, and variance.
- Funds, grants, programs, departments, projects, cost centers, restrictions, and funding sources.
- Cash accounts, bank feeds, statement import, matching, reconciliation, deposits, transfers, and cash forecast.
- Multi-currency transaction, functional/reporting currency, realized/unrealized gain/loss, and rate source.
- Consolidation, intercompany, elimination, minority interest, and entity reporting as later enterprise capabilities.
- Financial statements, trial balance, general ledger, cash flow, budget-to-actual, audit schedules, and drill-through.
- Period controls, approval, separation of duties, supporting evidence, correction, and audit.

Tenure's first university configuration may expose budget, dues, expenses, reimbursements, vendors, and approvals while the same ledger foundation preserves expansion into enterprise accounting.

### 13.9 Procure-to-pay, expenses, and vendors

- Vendor master, contacts, tax/compliance data references, diversity/status attributes, risk, insurance, contracts, catalogs, and performance.
- Vendor onboarding, due diligence, duplicate detection, sanctions/risk connector hooks, approval, change control, and offboarding.
- Requisition, quote/RFQ/RFP, sourcing event, evaluation, award, purchase order, change order, receipt, inspection, invoice, match, approval, payment request, and close.
- Two- and three-way match, tolerance, exception, split coding, partial receipt, credit memo, duplicate invoice, and hold.
- Expense report, card feed, receipt capture, mileage/per diem, policy check, allocation, approval, reimbursement, and audit.
- Corporate/student/organization cards, limits, virtual cards via integration, merchant/category controls, and reconciliation.
- Spend analytics, savings, contract leakage, vendor concentration, cycle time, maverick spend, and commitment forecasting.
- Relay can extract receipts/invoices, draft coding, explain policy, identify exceptions, and prepare—not self-approve—payments.

### 13.10 Order-to-cash, billing, and revenue

- Customer/account master, products/services, price books, quotes, orders, contracts, subscriptions, usage, invoices, credits, collections, receipts, and adjustments.
- One-time, recurring, milestone, seat, usage, tiered, volume, minimum, and hybrid pricing.
- Billing schedules, proration, amendments, renewals, cancellations, tax connector hooks, and revenue schedules.
- Accounts receivable aging, dunning, disputes, payment links/provider integration, cash application, refunds, and write-offs.
- Revenue-recognition support through governed performance-obligation and schedule records; final accounting treatment remains policy-controlled.
- Tenure's own SaaS billing uses the same commercial concepts but remains operationally separated from tenant business ledgers.

### 13.11 Treasury, grants, fundraising, and sponsorships

- Bank-account governance, signatories by seat, cash positioning, liquidity, forecasts, transfers, and approval limits.
- Grant opportunity, eligibility, proposal, budget, submission, award, restriction, reporting, milestone, drawdown, and closeout.
- Donor/sponsor prospect, relationship history, campaign, pledge, gift/sponsorship, designation, benefit/fulfillment, stewardship, and renewal.
- Restricted funds, compliance dates, deliverables, contacts, agreements, and continuity across rotating fundraisers/treasurers.
- Sponsorship pipeline and institutional relationship memory attached to seats and external organizations.

### 13.12 Human capital management

- Workforce/person record, employment relationship, job/position, worker type, manager, location, cost center, and status.
- Recruiting: requisition, career site adapters, candidate, application, interview, evaluation, offer, checks/integration, hire, and talent pool.
- Onboarding: documents, equipment, access, training, policies, introductions, first-30/60/90 plan, and seat-memory briefing.
- Time, attendance, schedules, leave, holidays, overtime, time-off approvals, and payroll export/integration.
- Compensation: grades, bands, salary, hourly rates, bonuses, equity references, reviews, budgets, and approval.
- Benefits eligibility/enrollment integration, dependent/privacy boundaries, and life events.
- Performance: goals, check-ins, feedback, review cycles, calibration, development plans, and succession.
- Learning: content/catalog, curricula, assignment, completion, certification, expiry, and compliance.
- Employee/volunteer/student relations cases with strict purpose and access separation.
- Offboarding: authority termination, access revocation, equipment, obligations, exit, handoff, and retention.
- Payroll calculation is a separately certified/validated capability or external integration; the engine does not pretend a generic workflow equals compliant payroll in every country.

### 13.13 Customer relationship, sales, service, and success

- Accounts, contacts, organizational relationships, leads, opportunities, stages, products, quotes, activities, territories, and forecasts.
- Relationship ownership by seat, shared account teams, introductions, interaction history, decision makers, and relationship risk.
- Marketing consent, segments, campaigns, events, sources, attribution, and external marketing-automation adapters.
- Customer onboarding, implementation projects, success plans, health, usage, goals, business reviews, renewals, expansion, and churn risk.
- Support cases, channels, queues, SLA, entitlement, knowledge, escalation, incident link, satisfaction, and root cause.
- Partner, reseller, alliance, referral, and channel records.
- Relay account briefings, meeting prep, follow-up drafts, risk summary, next-best action, and historical context.

### 13.14 Procurement, inventory, order, warehouse, and logistics

- Item/product/service master, variants, units of measure, lot/serial, categories, lifecycle, and substitutions.
- Locations, warehouses, bins, stock status, on-hand, available, reserved, in-transit, safety stock, reorder, and cycle count.
- Receipts, put-away, transfers, picks, packs, shipments, returns, adjustments, write-offs, and physical inventory.
- Demand, supply, purchase, transfer, production, and replenishment planning hooks.
- Sales/order fulfillment, allocation, backorder, partial shipment, proof of delivery, and return merchandise authorization.
- Carrier/rate/shipping integration, tracking, route, customs/trade document references, and delivery exceptions.
- Inventory valuation and accounting integration controlled by policy and tested methods.

### 13.15 Manufacturing, product lifecycle, quality, and maintenance

- Product/BOM/routing/work-center/work-instruction master and effective versions.
- Engineering change request/order, review, effectivity, release, and downstream impact.
- Demand plan, material requirements, production plan, work order, issue/consume, labor/machine capture, completion, scrap, and variance.
- Quality plans, inspections, samples, nonconformance, deviation, corrective/preventive action, complaint, audit, and supplier quality.
- Asset/equipment registry, hierarchy, meter, condition, warranty, criticality, maintenance plan, work order, parts, downtime, and reliability.
- Calibration, certification, safety procedure, permit-to-work, lockout/tagout references, and inspection history.
- CAD/PLM/MES/IoT integrations through approved connectors; Tenure provides continuity/workflow/memory and must not claim to replace specialized kernels or safety systems without validated modules.

### 13.16 Assets, facilities, real estate, and field operations

- Physical/digital asset registry, ownership/custody, location, condition, depreciation reference, warranty, documents, and lifecycle.
- Assignment/checkout, reservation, transfer, maintenance, loss/damage, disposal, and audit.
- Property, building, floor, room, lease, occupant, capacity, utility, inspection, and compliance records.
- Space requests, moves, maintenance tickets, vendor work, preventive maintenance, and service levels.
- Field work orders, dispatch, route, mobile offline packet, checklist, evidence, parts, labor, customer/site signature, and sync.
- Geospatial references and map integrations with privacy and region policy.

### 13.17 Governance, risk, compliance, legal, and audit

- Policy lifecycle: draft, review, approval, publication, acknowledgement, exception, supersession, retention.
- Obligation/register mapping to controls, processes, owners, seats, evidence, tests, issues, and remediation.
- Enterprise risk register, taxonomy, inherent/residual assessment, appetite, treatment, indicators, incidents, and review.
- Internal control, test plan, sample/evidence, deficiency, management response, action, and closure.
- Audit universe, plan, engagement, request list, fieldwork, finding, response, recommendation, follow-up, and report.
- Regulatory, accreditation, grant, FERPA/privacy, security, accessibility, and contractual evidence packs without falsely claiming certification.
- Legal matters, requests, holds, outside counsel/vendor, deadlines, documents, privilege labels, and spend with narrow access.
- Conflict of interest, disclosure, recusal, ethics/whistleblower, investigation, and outcome with strict access separation.
- Business continuity, impact analysis, dependency, plan, exercise, incident invocation, and recovery evidence.
- Automated Reasoning checks may validate suitable policy-derived rules, but legal/accounting/HR decisions remain governed human processes.

### 13.18 Strategy, planning, analytics, and performance

- Strategic themes, goals, initiatives, metrics, owners by seat, targets, forecasts, scenarios, assumptions, and dependencies.
- Operational planning, annual plans, headcount, revenue, expense, capital, cash, and rolling forecasts.
- Driver-based models and allocations through a governed calculation engine.
- Semantic metric catalog with definition, owner, source, grain, dimensions, filters, freshness, lineage, and certification.
- Self-service reports, dashboards, pivots, subscriptions, annotations, commentary, board/executive packs, and exports.
- Near-real-time operational projections and governed analytical lake/warehouse.
- Anomaly, threshold, trend, forecast, scenario, and causal-analysis integrations with confidence and explanation.
- Relay narrative summaries, variance explanations, question-answering, chart interpretation, and decision briefings.

### 13.19 Education and student-organization operations

This is an industry pack over the general engine, not a separate core:

- School/campus/office/program/club/association/committee structures.
- Academic years, terms, cohorts, graduation, alumni, advisors, staff oversight, and rotating boards.
- President, treasurer, VP, representative, chair, member, shadow, alumni, advisor, staff, and director seat templates.
- VP → President → OSE and configurable multi-step approval chains.
- Budgets, dues, reimbursements, purchase requests, vendors, sponsorships, grants, and restricted funding.
- Club registration/renewal, constitution/bylaws, roster verification, elections, officer transition, and compliance.
- Events, room conflicts, co-hosting, attendance, risk, travel, accessibility, and marketing approval.
- Cross-club feed, collaboration, shared vendors/resources, and administrative oversight.
- FERPA-aligned purpose/access controls, but no certification claim without formal review.
- Simon/OSE fixture uses confirmed local terminology while proving the generic model with a second corporate fixture.

## 14. Industry-pack architecture

An industry pack contains terminology, reference objects, roles, policies, workflows, forms, reports, controls, integrations, AI evaluation cases, and migration mappings. It never contains a fork of core runtime code.

Planned pack families:

- Higher education, K-12, research administration, student affairs, alumni, and associations.
- Small/medium business, professional services, technology, SaaS, and startups.
- Nonprofit, foundation, chapter, volunteer, religious/community, and membership organizations.
- Public sector, agency, board/commission, municipal, GovCloud, and grant administration.
- Healthcare provider/payer/life sciences administration with strict clinical-system boundaries.
- Financial services, insurance, asset management, and regulated operations.
- Manufacturing, automotive, industrial, electronics, aerospace/defense supply chain, and quality.
- Retail, ecommerce, consumer goods, hospitality, food service, and franchise.
- Construction, engineering, architecture, real estate, property, and facilities.
- Energy, utilities, natural resources, sustainability, and field operations.
- Logistics, transportation, warehousing, and fleet.
- Media, entertainment, sports, events, and creative production.

Each pack declares jurisdictions, supported locales, required controls, excluded claims, compatible modules, minimum platform version, data classifications, residency requirements, test fixtures, and implementation status. A pack is not marketed as compliant merely because it contains templates.

## 15. Integration platform

External integrations are allowed and expected. All connector infrastructure and runtime remain on AWS. Tenure never places customer integration secrets in source, browser storage, logs, reports, or AI context.

### 15.1 Connector architecture

The Integration Hub provides:

- Versioned connector definition, capabilities, objects, events, auth methods, scopes, rate limits, and region support.
- Tenant connection instances with OAuth grants, SAML/OIDC metadata, API credentials, certificates, SSH keys, or private networking represented by secret references.
- Inbound/outbound schemas, canonical mapping, transformations, validation, and custom-field mapping.
- Initial load, incremental sync, webhook, polling, change-data capture, batch, streaming, and manual run modes.
- Cursor/watermark, idempotency, replay, deduplication, ordering, retry, backoff, circuit breaker, dead letter, and reconciliation.
- Conflict policy: source-of-truth ownership by field/object, merge rules, manual resolution, and audit.
- Consent, data classification, purpose, retention, deletion propagation, and offboarding.
- Connection test, health, last success, lag, quota, certificate/secret expiry, and operator/tenant alerts.
- Per-connection IAM role and least-privilege network access where possible.
- PrivateLink/VPN/Direct Connect patterns for approved enterprise connections; internet egress is allowlisted and observable.
- Webhook signature, timestamp/replay defense, rotation, endpoint isolation, and tenant binding.

### 15.2 Integration categories

Identity and directory:

- Microsoft Entra ID, Active Directory federation, Okta, Google Workspace, Ping, OneLogin, Auth0-compatible OIDC, generic SAML/OIDC, and SCIM.

Productivity and content:

- Microsoft 365, Outlook, Exchange, Teams, SharePoint, OneDrive, Google Workspace, Gmail, Calendar, Drive, Slack, Zoom, Box, Dropbox, Notion, Confluence, Jira, Asana, Monday.com, Linear, Airtable, and generic email/ICS/WebDAV where supportable.

Enterprise systems:

- SAP, Workday, Oracle, Microsoft Dynamics, Salesforce, ServiceNow, NetSuite, Sage, QuickBooks, Xero, BambooHR, ADP, UKG, Greenhouse, Lever, Coupa, Ariba, and generic ERP/HCM/CRM/procurement adapters.

Finance and payments:

- Bank feeds/open-banking aggregators, ACH/wire/payment processors, Stripe, card providers, tax engines, expense systems, e-signature, billing, and accounting platforms. Payments are executed by certified providers; Tenure governs requests, approvals, reconciliation, and records.

Data and engineering:

- S3, Redshift, Snowflake, Databricks, BigQuery, PostgreSQL, SQL Server, Oracle Database, REST, GraphQL, SOAP, SFTP, webhooks, Kafka-compatible streams, GitHub, GitLab, CI/CD, observability, and security tools.

Industry:

- Student-information/learning systems, donor/grant platforms, EHR/clinical systems through strict boundaries, PLM/MES/QMS/WMS/TMS, CAD/PDM references, building/access systems, IoT event ingestion, GIS/maps, and government/accreditation portals.

The list is a connector roadmap, not a claim that every connector ships on day one. Each visible connector reports `AVAILABLE`, `BETA`, `TENURE_MANAGED`, `CUSTOMER_CONFIGURABLE`, `PLANNED`, or `UNSUPPORTED`. The UI never implies a logo is integrated when only a roadmap record exists.

### 15.3 Canonical integration ownership

Every synchronized object has:

- Tenure ID and external system/connection/object ID.
- Source-of-record declaration at object and field level.
- External version/ETag, Tenure version, sync watermark, and last reconciled time.
- Mapping version and transform version.
- Create/update/delete/tombstone policy.
- Conflict state, resolution owner, and evidence.
- Classification, retention, consent/purpose, and access mapping.

## 16. Marketplace and extension system

### 16.1 Three extension levels

1. Declarative extensions: custom objects, fields, forms, views, policies, workflows, reports, dashboards, translations, and mappings.
2. Low-code automations: triggers, conditions, transformations, actions, approvals, timers, connectors, and Relay skills composed from certified blocks.
3. SDK extensions: signed packages that implement explicit UI, connector, calculation, report, workflow action, or Relay tool contracts in a sandboxed runtime.

SDK code does not run inside core API processes. Execution uses isolated Lambda or ECS tasks with generated least-privilege roles, no ambient tenant access, explicit capabilities, egress controls, CPU/memory/time quotas, package signatures, SBOM, provenance, vulnerability scan, compatibility checks, and revocation.

### 16.2 Future marketplace services

- Publisher/partner identity, contracts, tax/payout integration, and verification.
- Package registry, version, dependency, compatibility, signatures, provenance, SBOM, review, certification, and deprecation.
- Listing, categories, search, documentation, demo metadata, pricing, trials, license, entitlement, billing, revenue share, and refunds.
- Tenant install request, permission manifest, impact preview, approval, environment test, activation, update, rollback, disable, uninstall, export, and data cleanup.
- Ratings/reviews with verified use, support SLA, vulnerability response, incident notification, and takedown.
- Kill switch and fleet revocation for compromised extensions.

### 16.3 Initial user experience

The application includes a Marketplace navigation item only if product wants the future surface visible. The page contains Tenure styling, a concise explanation that certified modules, connectors, workflows, reports, and AI skills are coming, and an optional non-transactional interest form. It displays no fake listings, prices, install buttons, logos implying partnerships, or executable packages. The backend marketplace APIs remain disabled by feature flag except for an optional internal roadmap registry.

## 17. Globalization, accessibility, and brand system

- Unicode throughout; locale-aware collation/search; transliteration only as an optional helper.
- UI translations separated from tenant terminology and user-authored content.
- BCP 47 language tags, locale fallback, tenant defaults, and per-user preferences.
- IANA time zones, DST-safe recurrence, business calendars, holidays, fiscal calendars, and effective timestamps stored in UTC with original zone context.
- ISO currency codes, currency precision, exchange-rate source/time, and functional/reporting currency.
- Locale-aware number, date, time, name, address, phone, paper size, and units.
- Right-to-left layout, bidirectional content, non-Latin scripts, and font coverage.
- WCAG 2.2 AA target for customer and operator surfaces: keyboard, focus, semantics, contrast, reflow, screen readers, reduced motion, captions/transcripts, error identification, and accessible documents.
- Responsive PWA supports low bandwidth, installability, safe offline read/draft packets for approved field use, background sync, conflict resolution, and remote revocation.
- Tenant brand tokens operate within contrast, accessibility, phishing-resistance, and login-domain guardrails.
- The detailed Tenure Experience System in Section 26 is part of the platform contract. A tenant may supply identity and limited accent inputs, but cannot replace interaction semantics, status colors, focus treatment, typography metrics, safety patterns, chart grammar, or accessibility behavior.

## 18. API, SDK, and event platform

### 18.1 API principles

- Versioned public and internal APIs with explicit stability policy.
- REST/JSON for broad compatibility; GraphQL only where its authorization, complexity, caching, and query-cost controls are proven.
- OpenAPI/JSON Schema as executable contracts; generated clients for TypeScript and other supported languages.
- Cursor pagination, deterministic sorting, sparse fields/expansion with authorization, conditional requests, and idempotency keys.
- Standard error envelope with safe code, message, correlation ID, field errors, retryability, and documentation link.
- Tenant context is server-resolved; client-supplied tenant identifiers never grant scope.
- Rate limits, quotas, request-size/type limits, schema validation, WAF, abuse detection, and backpressure.
- Long-running operations return job resources with status, progress, cancellation rules, output, and expiry.
- Bulk import/export is asynchronous, encrypted, validated, malware-scanned, resumable where useful, and reconciled.
- Deprecation requires usage telemetry, migration guide, compatibility window, tenant notice, and enforced sunset policy.

### 18.2 Event contract

Every domain event includes:

- Event ID, type, semantic version, occurred/recorded time.
- Tenant ID and cell ID from trusted execution context.
- Aggregate/resource type, ID, and version.
- Actor/service/delegation references appropriate for audit.
- Correlation, causation, trace, idempotency, and config/policy revision.
- Minimal data payload and sensitivity classification.
- Schema URI/digest and producer release.

Event schemas are backward/forward compatibility tested. Consumers ignore additive fields, reject unsupported breaking versions, and process at least once safely. Event replay is privileged, scoped, dry-runnable, and audited.

### 18.3 SDKs and developer portal

The future developer platform exposes documentation, API clients, OAuth applications/service accounts, webhook subscriptions, test tenant/sandbox, usage, logs, replay, keys/secret rotation, and certification. Tenant-created applications receive an explicit permission manifest and cannot request platform/operator capabilities.

## 19. Data architecture

### 19.1 Data-class separation

Tenure separates:

- Parent metadata: tenant identity, placement, config/release, entitlements, billing, and fleet health.
- Tenant operational records: authoritative module state.
- Tenant files and records: original and versioned binaries plus metadata.
- Tenant search/memory/AI projections: reproducible indexes and derived content.
- Tenant analytical data: governed snapshots/events optimized for reporting.
- Audit/security evidence: append-only application, infrastructure, and access records.
- Telemetry: minimized operational measurements, separated from customer content.

These classes have different access paths, keys, retention, backup, residency, and restore procedures. A convenience data lake never becomes an authorization bypass.

### 19.2 Relational system of record

Aurora PostgreSQL-compatible storage is the default relational engine because the platform requires transactions, constraints, temporal relationships, accounting integrity, workflow consistency, and rich queries.

Isolation rules:

- Parent control databases never contain tenant operational tables.
- Pooled cells use a separate schema for each tenant business dataset. Tenant schema selection comes from a trusted resource handle; tenants do not supply schema names.
- Higher tiers use database-per-tenant, cluster-per-tenant, or account-per-tenant.
- Search paths are set transaction-locally and verified; raw cross-schema queries are unavailable to general application roles.
- Database roles separate migration, application read/write, read-only reporting, audit writer, and break-glass.
- Tenant business tables use internal tenant assertions where helpful, but table separation—not a row filter alone—implements the product promise.
- Foreign keys, unique constraints, checks, exclusion constraints, and balanced-ledger invariants live in the database where appropriate.
- Optimistic concurrency uses aggregate versions. Distributed actions use saga/compensation, never fake global transactions.
- Expand/migrate/contract supports zero-downtime releases. Destructive contraction occurs only after compatibility and rollback windows.

Connection management uses RDS Proxy or bounded pooling. The resource resolver returns a short-lived connection target/role and schema/database binding, not credentials. Secrets rotate through Secrets Manager.

### 19.3 DynamoDB

Use DynamoDB where access patterns fit:

- Server-side sessions and revocation metadata with TTL.
- Idempotency keys, command results, and short-lived locks.
- Tenant/cell routing projections and safe login discovery, optionally Global Tables.
- Provisioning state checkpoints and callback transactions.
- High-scale counters/usage meters with reconciliation.
- Websocket connection registry and notification delivery state.

DynamoDB is not a dumping ground for relational business objects. Every table has explicit partition/sort keys, conditional-write semantics, item-size strategy, hot-key analysis, TTL, PITR, encryption, streams, and tenant isolation design.

### 19.4 Object storage

S3 zones per tenant resource boundary:

- Quarantine uploads.
- Released originals.
- Derivatives/previews/extractions.
- Imports and exports.
- AI ingestion/source artifacts.
- Analytical raw/curated/product zones.
- Audit/evidence archive.
- Backups and recovery artifacts.

Requirements include Block Public Access, bucket-owner enforcement, TLS-only policy, versioning, KMS encryption, object checksums, malware status, retention/lifecycle, legal hold/Object Lock where required, access points where useful, short-lived scoped URLs, and event delivery with idempotency.

Object keys never rely on a user-supplied filename for isolation. Filenames are metadata; keys use opaque IDs and versions. Content-Disposition, MIME sniffing prevention, preview sandboxing, active-content sanitization, archive-bomb limits, and download authorization are mandatory.

### 19.5 Search, vector, and graph

- Exact operational truth is read from canonical module stores.
- OpenSearch Serverless provides lexical/faceted/hybrid search when justified.
- Bedrock Knowledge Bases with S3 Vectors provides the initial cost-conscious RAG vector path where supported.
- Bedrock Managed Knowledge Base may be chosen for advanced managed/agentic retrieval after cost, filtering, regional, and control evaluation.
- Graph relationships may initially use relational adjacency/path structures and purpose-built projections. Introduce Neptune only when graph scale/query needs demonstrate value.
- Every index is rebuildable from authorized source events and versions.
- Index documents carry resource/version references, not copied authority. Read-time authorization remains mandatory.

### 19.6 Analytical platform

Domain events and approved change projections land in S3 through EventBridge/Kinesis/Firehose patterns selected by volume. Glue Data Catalog and Lake Formation govern datasets. Athena and Redshift Serverless provide query/warehouse capabilities; QuickSight embedded or Tenure-native visualizations consume a semantic metric layer.

Rules:

- Tenant operational transactions do not wait on analytics.
- Raw, curated, and product data zones are explicit.
- Schema evolution and late-arriving corrections are reproducible.
- Tenant data is partitioned and policy-governed; dedicated tenants can receive dedicated analytics resources.
- Direct customer queries against raw shared lake data are prohibited.
- Personally identifiable, sensitive, and regulated fields are classified, masked/tokenized, minimized, and purpose-bound.
- Fleet product analytics uses separately defined, minimized telemetry and tenant-consented aggregates.
- Every metric has grain, dimensions, source, transformation, owner, freshness, and certification.

### 19.7 Cache

Cache keys include environment, cell, tenant, resource, authorization/config revision, locale, and relevant query version. Never share cached customer content across a key that lacks tenant scope. Authorization cache entries are short-lived and invalidated on membership, assignment, delegation, policy, classification, tenant, and support-session changes. Sensitive responses use no-store/private policies at browsers and CDNs.

### 19.8 Retention, export, and deletion

Retention is evaluated at record class, jurisdiction, tenant, module, resource, and legal-hold level. Deletion uses tombstone and disposition workflows so relational records, objects, indexes, analytics, caches, backups, connectors, derived AI content, and search results converge safely.

A tenant export includes canonical machine-readable records, files/versions, configuration, schemas, audit allowed by policy, identity mappings where lawful, data dictionary, checksums, and manifest. Export does not contain platform secrets, other tenants, or Tenure proprietary infrastructure metadata. Offboarding defines an export window, access freeze, retention/hold, deletion approval, backup expiry, tombstone, and certificate of completion.

## 20. AWS service blueprint

This map is a target, not permission to deploy every service before it is useful. The implementation selects the simplest service meeting current scale, security, availability, and cost while preserving interfaces for growth.

| Capability | Preferred AWS service(s) | Architectural rule |
|---|---|---|
| Organizations/landing zone | AWS Organizations, Control Tower, Account Factory, Service Catalog | Tenure-owned accounts; management account has no workloads |
| Workforce AWS access | IAM Identity Center, IAM roles, permission sets | No shared IAM users; phishing-resistant MFA and JIT privilege |
| CI/CD AWS trust | IAM OIDC provider for GitHub Actions, scoped roles | Short-lived credentials; no routine long-lived keys |
| Infrastructure as code | Existing healthy IaC; AWS CDK/CloudFormation preferred when repository evidence supports it | One reusable engine, environment/cell/tenant parameters, change sets |
| DNS/TLS/CDN | Route 53 where hosted, ACM, CloudFront | Region-aware routing, modern TLS, no public origin bypass |
| Edge security | AWS WAF, Shield posture, Firewall Manager where scale warrants | Central policies with tenant/cell exceptions reviewed |
| API ingress | API Gateway and/or ALB | Select by workload; validate auth, size, rate, and content |
| Compute | ECS Fargate default services/workers; Lambda for event/burst; EKS only with demonstrated need | Avoid Kubernetes operational tax by fashion |
| Service networking | VPC, PrivateLink, VPC Lattice/Cloud Map/Service Connect as justified | Least network reachability, private endpoints, egress control |
| Orchestration | Step Functions for control-plane and bounded sagas | Tenant workflow definitions live in Tenure runtime |
| Events/queues | EventBridge, SQS, SNS, Scheduler; MSK/Kinesis for justified streams | Outbox, idempotency, DLQ, replay, schema governance |
| Relational data | Aurora PostgreSQL, RDS Proxy | Separate tenant schemas/databases; PITR; constraints; migrations |
| Key-value/session | DynamoDB, optional Global Tables | Explicit access patterns, conditional writes, TTL/PITR |
| Cache | ElastiCache Serverless for Valkey/Redis-compatible workloads | Tenant-aware keys and revision invalidation |
| Files/data lake | S3, S3 Access Points, Object Lock, lifecycle, S3 Tables where justified | Versioned, encrypted, blocked public access, provenance |
| Search | OpenSearch Serverless | Permission-filtered indexes; cost threshold before use |
| Vector/RAG | Bedrock Knowledge Bases, S3 Vectors, optional OpenSearch vector | Storage driver and tenant isolation |
| Multimodal extraction | Bedrock Data Automation, Knowledge Base parsers, Textract as specialized fallback | Preserve original, coordinates, parser version, confidence |
| AI inference | Bedrock Converse/Responses-compatible service interfaces, regional inference profiles | AWS-hosted path only; model-neutral gateway |
| AI agents | Bedrock AgentCore runtime/gateway/memory/observability where evaluated | Tenure authorization and tool registry remain authoritative |
| AI guardrails/evaluation | Bedrock Guardrails, automated reasoning where suitable, model/RAG evaluations | No safety or quality claim without test evidence |
| ML | SageMaker for approved custom models/evaluation pipelines | Tenant data isolation; model registry and lineage |
| Analytics | Glue, Lake Formation, Athena, Redshift Serverless, QuickSight | Semantic layer, lineage, masking, no live cross-tenant DB query |
| Secrets/config | Secrets Manager, Parameter Store for nonsecrets, AppConfig | Secret references; rotation; validated staged config |
| Encryption | KMS, CloudHSM only when required | Envelope encryption, tenant keys by tier, rotation/recovery |
| Email | SES | Domain authentication, reputation, bounce/complaint, template/version |
| SMS/push | AWS End User Messaging/SNS as currently supported | Consent, opt-out, country rules, quiet hours, delivery state |
| Observability | CloudWatch, X-Ray/ADOT, Managed Grafana where useful | Tenant/cell/release context; redaction; SLOs |
| Security detection | CloudTrail, Config, GuardDuty, Security Hub, Inspector, Macie, Access Analyzer | Delegated admin and centralized findings/evidence |
| Backup/DR | AWS Backup, Aurora backups/global options, S3 replication where residency permits | Restore tests, not backup existence claims |
| Cost | Cost allocation tags, CUR/data exports, Budgets, Cost Anomaly Detection | Tenant/cell/module attribution and unit economics |

## 21. Security architecture

### 21.1 Security invariants

1. Deny by default.
2. Authenticate every human and workload; authorize every action and resource.
3. Tenant context is server-resolved and immutable within a transaction.
4. No business data from two tenants shares a relational table.
5. No secret appears in source, client bundles, AI prompts, logs, artifacts, support tickets, or reports.
6. Every production change is from reviewed immutable code/config through protected automation.
7. Every sensitive action creates an immutable audit event.
8. Historical authority does not imply current authority.
9. Retrieved AI context is untrusted data and cannot expand tool permissions.
10. Production and destructive actions require explicit protected approval.

### 21.2 Identity and privilege

- Cognito/enterprise SSO for product users; IAM Identity Center for AWS/operator users.
- MFA and step-up based on risk and action; strong recovery and enumeration resistance.
- Short-lived sessions, rotation, revocation, device/session inventory, and anomaly controls.
- Workload IAM roles with minimum actions/resources/conditions; no shared runtime keys.
- GitHub Actions OIDC restricted by exact repository, environment, branch/tag, audience, and protected workflow.
- Permission boundaries, SCPs, constrained `iam:PassRole`, tag conditions where safe, and negative trust tests.
- Break-glass credentials vaulted, monitored, tested, rotated, and never used for routine operations.

### 21.3 Network and edge

- Public access terminates at CloudFront/WAF/API edge. Origins accept only intended edge paths where feasible.
- Stateful services remain private; security groups express least connectivity.
- VPC endpoints reduce public service paths; egress uses allowlists/proxies and logging appropriate to cost/risk.
- Private tenant integrations use PrivateLink, site-to-site VPN, or Direct Connect patterns when contracted.
- DDoS posture, WAF managed/custom rules, bot/rate controls, header normalization, request limits, and safe error behavior.
- DNS, certificate, origin, routing, and subdomain changes are IaC-managed and monitored.

### 21.4 Application security

- Strict input/schema validation and output encoding.
- CSRF protection on cookie-authenticated mutations; correct CORS/Origin policy.
- Content Security Policy, frame restrictions, Trusted Types where feasible, secure headers, dependency integrity.
- SQL/query injection prevention through typed repositories; no user-supplied schema/table/expression execution.
- SSRF prevention with URL parsing, DNS/IP validation, egress allowlist, redirect revalidation, and metadata-service protection.
- Safe file handling: quarantine, malware scan, MIME verification, active-content isolation, preview sandbox, size/decompression limits.
- Webhook signatures, replay windows, tenant binding, rotation, and idempotency.
- Mass-assignment protection, field-level authorization, over-fetch prevention, and object-level access tests.
- Secure real-time connections: authenticate handshake, revalidate expiry/revocation, bind tenant, enforce per-message authorization.

### 21.5 Supply chain

- Protected branches, code review, CODEOWNERS for security/IaC/schema/workflow areas, signed commits/tags where adopted.
- Dependency lockfiles, provenance, SBOM, vulnerability/license scan, secret scan, SAST, IaC policy scan, container scan, and patch SLA.
- GitHub Actions pinned to immutable full SHAs; minimal token permissions; untrusted forks receive no secrets or deployment authority.
- Immutable container/artifact digests, ECR scanning/signing, promotion—not rebuild—between environments.
- Reproducible builds and SLSA-aligned provenance targets.
- Extension packages follow stricter signing, sandbox, review, and revocation controls.

### 21.6 Audit integrity

Application audit records include event ID, tenant, actor, represented actor/support context, seat, action, target, before/after or change digest, result, policy/config version, time, request/trace, source, reason, and prior hash. Records append through a restricted writer and stream to an immutable S3 Object Lock evidence archive with digest manifests. Query projections may live in OpenSearch/relational storage but are not the integrity root.

Do not use a retired service as the audit foundation. Hash chaining plus independent immutable archive, CloudTrail/Config evidence, KMS signing where justified, and periodic verification provide tamper evidence without relying on editable application tables.

## 22. Privacy, governance, and compliance readiness

Tenure implements a control system and evidence map; it does not claim SOC 2, ISO 27001, HIPAA eligibility, PCI DSS, FedRAMP, FERPA compliance, GDPR compliance, or another certification merely because AWS services or templates exist.

Required capabilities:

- Data inventory, owner/steward, classification, system/source, purpose, lawful basis/contract, residency, retention, and sharing.
- Privacy notice/consent records, marketing consent, child/minor policy hooks, and jurisdiction-specific configuration.
- Data subject/access/correction/export/deletion/restriction/objection workflows where applicable.
- Legal hold and policy conflict resolution.
- Data processing agreement and subprocessor metadata; model/provider/region transparency.
- Tenant-configurable retention within platform and legal guardrails.
- Field, record, module, and purpose-based access; masking and secure views.
- PII/PHI/financial/education/special-category detection support with human validation.
- Data-loss prevention hooks for export, messaging, connectors, AI, and support.
- Customer-managed key participation where contracted; key revocation consequences documented.
- Evidence collection mapped to control owner, frequency, implementation, test, exception, and remediation.
- Accessibility conformance testing and VPAT preparation only when evidence is sufficient.

Privacy defaults: collect the minimum, retain intentionally, make derived data visible, distinguish organizational records from personal preference, never use tenant content to train a shared model, and require an explicit separate lawful program for any model improvement using customer data.

## 23. Reliability, recovery, and global distribution

### 23.1 SLO tiers

Every service declares availability, latency, durability, RPO, RTO, dependency, degradation, and maintenance objectives. Contractual tiers may differ, but conservative design targets should be proposed and approved rather than left undefined.

Suggested initial internal targets for architecture testing—not contractual promises:

| Capability | Availability target | RPO | RTO/degradation intent |
|---|---:|---:|---|
| Login/tenant resolution | 99.95% | Minutes for config projection | Fail closed for unknown tenant; cached safe branding only |
| Core transactional modules | 99.9% pilot; higher enterprise tier | ≤5 minutes | Restore/region plan by tier; queues preserve async work |
| Audit/outbox | Transactional with source write | 0 for committed transaction | Replay projection; never accept unaudited high-risk write |
| Files | S3 durability design | Version/object dependent | Serve authorized last version; derivatives rebuildable |
| Search/Relay | 99.5% pilot target | Rebuildable index | Core ERP remains usable when AI/search degraded |
| Config/control plane | 99.9% with cell cache | Minutes | Existing active tenant keeps last verified config; no unsafe new changes |

### 23.2 Cell resilience

- Cells limit blast radius and have capacity admission thresholds.
- Tenant routing uses a versioned projection and health-aware, residency-aware policy.
- A tenant never fails over to a region that violates policy or breaks identity issuer/callback consistency.
- Synchronous cross-cell dependencies are minimized.
- Regional control-plane unavailability does not grant access or accept unvalidated config.
- Circuit breakers, bounded retries with jitter, bulkheads, queue backpressure, DLQs, and replay tools exist.
- Capacity tests define when to add a cell, shard identity pools, move a tenant, or block onboarding.
- Tenant migration is a state machine with dual-read/write only when consistency is explicitly designed, validation, cutover, rollback, and decommission.

### 23.3 Backup and restore

- Aurora automated backups/PITR and snapshots according to tier.
- DynamoDB PITR and exports where appropriate.
- S3 versioning, retention, replication only to approved regions/accounts.
- Configuration, IaC state, package/artifact registry, identity metadata, secrets recovery, and KMS recovery considered.
- Backup policies are centrally applied and monitored.
- Restore drills create isolated environments, verify application invariants and tenant isolation, measure RPO/RTO, and destroy drill resources safely.
- A backup is not considered valid until restoration and integrity are demonstrated.

### 23.4 Disaster recovery

DR mode can be backup-and-restore, pilot light, warm standby, or multi-region active patterns by tier and residency. The default avoids expensive multi-region active-active before business requirements justify it. Runbooks cover regional outage, Cognito/IdP outage, database failure, corrupted deployment/config, queue backlog, compromised account/role, connector failure, and AI provider/model outage.

## 24. Observability and operations

### 24.1 Telemetry contract

Structured logs, metrics, traces, audits, and business events carry environment, account, region, cell, service, release, config revision, tenant safe ID, correlation, operation, outcome, latency, and safe error code. Raw emails, names, tokens, cookies, assertions, document text, prompts, secrets, and unrestricted payloads do not enter general logs.

### 24.2 Fleet dashboards

- Cell health, capacity, saturation, errors, latency, dependencies, and release versions.
- Tenant health score, provisioning, config drift, migrations, connector lag, AI/index freshness, backup, and costs.
- Authentication funnel, federation health, certificate/secret expiry, session revocations, suspicious denials.
- Workflow queues, SLA, stuck instances, DLQs, replay, and automation results.
- Finance integrity checks, approval concurrency, ledger imbalance attempts, and reconciliation state.
- Search/RAG ingestion lag, retrieval quality, groundedness, citation failures, tool errors, and model costs.
- Deployment, canary, rollback, feature flag, incident, and change-failure rate.
- Security findings, WAF trends, GuardDuty/Security Hub/Inspector, IAM drift, public-access findings.

### 24.3 Incident management

Incidents have severity, commander/roles by seat, tenant scope, timeline, evidence, communications, decisions, mitigations, status, root cause, corrective actions, and post-incident memory. Cross-tenant or security incidents trigger containment playbooks and legal/privacy assessment. Status communication never leaks another tenant's identity or data.

### 24.4 Runbooks

Maintain executable runbooks for authentication/IdP outage, credential leak, cross-tenant suspicion, database restore, failed migration, corrupted config, bad release, cell saturation, region outage, queue/DLQ, S3 malware event, connector credential expiry, email delivery failure, audit pipeline failure, AI injection/data exposure concern, model withdrawal, cost spike, tenant suspension, export, deletion, and break-glass.

## 25. FinOps and commercial metering

Mandatory cost dimensions: environment, account, region, cell, tenant/isolation tier, module, service, workload, release, and owner. Use AWS tags plus application meters when a shared resource cannot attribute costs natively.

Track:

- Active users, seats, modules, storage, file processing, workflow actions, API calls, events, connectors, search queries, exports, and reports.
- AI input/output/reasoning/cache tokens, embeddings, parser pages/minutes, vector storage/query, reranking, tool calls, and model tier.
- Compute, database capacity/I/O/storage, network/NAT/egress, queues, logs, security services, backups, and support overhead.
- Gross margin by plan/tenant/cell and marginal cost by key action.

Controls:

- Budgets and anomaly alerts at organization/account/cell and application tenant levels.
- Per-tenant quotas, rate limits, concurrency, storage, AI budgets, and graceful degradation.
- Log and object lifecycle, right-sizing, savings plans/reservations only with stable evidence, serverless scale-to-low where beneficial.
- Cost estimate and approval in tenant placement, dedicated-resource request, new connector, model promotion, and config preview.
- Never silently disable security, backup, audit, or tenant isolation to reduce cost.

## 26. Product surfaces and UX architecture

Tenure must feel like a contemporary intelligence and operating environment, not a collection of legacy ERP screens. Aesthetic quality, information architecture, interaction quality, and long-session visual comfort are release criteria rather than a post-launch polish backlog. The intended character combines Monarch's calm financial clarity and customizable whole-picture reporting, Vercel's precision and restrained application chrome, and Perplexity's content-first, source-aware AI interaction. These are principle references only: Tenure must not clone their layouts, trade dress, copy, assets, or component styling.

The experiential thesis is **calm command of organizational complexity**. The interface should allow a user to understand the state of a role, team, workflow, budget, decision, or tenant quickly; disclose provenance and risk when needed; and then recede. Modernity comes from hierarchy, responsiveness, clarity, continuity, and purposeful motion—not excessive glass, gradients, empty space, or animation.

### 26.1 Initial surfaces

- Responsive web application and installable PWA.
- Tenant-aware login and discovery.
- Role/seat-aware home, work inbox, search, Relay, notifications, and recent memory.
- Module workspaces with common shell, command patterns, audit, comments, files, and help.
- Tenant administration/configuration studio.
- Tenure operator control plane as a separate application and identity boundary.
- Public/guest forms, event registration, status, and document portals only when configured.
- API/webhook/developer documentation surface.
- Marketplace **Coming soon** shell.

### 26.2 Navigation

Navigation is generated from enabled modules and semantic entitlements, not hard-coded role names. A person holding multiple seats sees a consolidated but clearly scoped inbox and can switch tenant/seat context safely. Every page displays the active tenant and relevant seat/organization context to reduce wrong-org actions.

The desktop shell uses a collapsible primary rail, a concise contextual header, a command/search launcher, an optional inspector/Relay sidecar, and a stable content canvas. The mobile shell uses task-first destinations and context-preserving sheets rather than squeezing the desktop navigation into a small screen. Deep module hierarchies use progressive disclosure, local navigation, breadcrumbs where they add location clarity, and recent/pinned destinations. A user should not traverse more than necessary to reach frequent work; command search, keyboard shortcuts, recent items, favorites, and universal create are first-class paths.

The home experience is configurable by user and seat within tenant policy. It emphasizes work requiring attention, upcoming commitments, organizational health, recent decisions, handoff/memory quality, and anomalies. It is not a wall of equally weighted cards. Every metric or alert supports drill-through to the canonical records and the filters that produced it.

### 26.3 Design system

The **Tenure Experience System (TES)** is a versioned platform package, documented in Storybook or an equivalent component laboratory and consumed by all product surfaces. It owns design tokens, accessible behavior primitives, components, composition patterns, chart grammar, content rules, icons, motion, density, responsive behavior, and quality tests. Product modules consume semantic APIs and tokens; they do not invent local palettes, spacing scales, dialog behavior, tables, charts, or status meanings.

If the real frontend is React, use Radix Primitives selectively as the accessible, unstyled behavior layer for dialogs, menus, popovers, tooltips, tabs, scroll areas, switches, and related interactions. Radix is a foundation, not Tenure's visual identity. Do not adopt Radix Themes wholesale, expose primitive defaults, or create an uncontrolled copy-paste component estate. Wrap approved primitives behind owned TES interfaces, pin versions, test focus/portal/layering behavior, and retain the ability to replace an implementation without changing business modules. Preserve an equivalent accessible foundation if repository evidence supports a non-React stack.

For dense data work, use an owned grid/table contract with virtualization, column pinning/reordering/resizing, keyboard navigation, selection, grouping, aggregation, filters, saved views, export, and safe bulk operations. TanStack-style headless logic or an equivalent may implement behavior, but domain code must depend on Tenure adapters. Standard charts should use one approved, tree-shakeable visualization engine behind a Tenure chart API; specialized organizational, lineage, and Sankey views may use D3 modules. Business modules must not embed arbitrary vendor configuration.

#### 26.3.1 Token architecture

Tokens are source-controlled, schema-validated, generated to CSS variables/TypeScript/native formats, visually regression-tested, and versioned with migration guidance. The hierarchy is:

1. **Primitive tokens:** raw color ramps, type scales, spacing, radius, duration, easing, opacity, and elevation ingredients. Product code cannot use raw primitives directly.
2. **Semantic tokens:** canvas, surface, text, border, action, focus, selection, status, chart, scrim, and elevation roles for each theme and contrast mode.
3. **Component tokens:** tightly scoped exceptions such as data-grid header, command palette, navigation rail, Relay composer, chart tooltip, and danger confirmation.
4. **Tenant brand tokens:** guarded logo, mark, limited accent, and optional display treatment mapped through automatic contrast and collision validation.
5. **User preference tokens:** light/dark/system, density, text scaling, reduced motion, increased contrast, chart palette, and data-format preferences within tenant policy.

No component may depend on a literal hex value, ad hoc pixel spacing, unregistered z-index, arbitrary box shadow, or module-specific font. Semantic tokens must work across tenant app, configuration studio, operator plane, public surfaces, and Marketplace shell.

#### 26.3.2 Color, ambience, and themes

Tenure's protected brand anchor is **dark forest green**, initially `#0F3D2E`, with a calibrated ramp from near-black evergreen to pale eucalyptus. Forest green signals continuity, memory, stewardship, and calm authority; it is not painted across every surface. In ordinary screens, chromatic accent area should remain restrained so information and status colors retain salience.

Initial reference values below are design targets, not permission to hard-code them. Final values must pass contrast, wide-gamut/sRGB, calibrated display, projector, low-brightness, and color-vision tests.

| Semantic role | Light reference | Dark reference | Intent |
|---|---:|---:|---|
| Canvas | `#F3F6F5` | `#0D1210` | Cool, low-glare application field; never stark white or black |
| Primary surface | `#FBFCFB` | `#131917` | Long-reading and working surface |
| Elevated surface | `#FFFFFF` | `#19211E` | Menus, inspectors, dialogs, floating controls |
| Primary text | `#17201C` | `#E7ECE9` | High legibility without maximum glare |
| Secondary text | `#5D6963` | `#A6B0AA` | Supporting content; never used where contrast becomes marginal |
| Subtle border | `#D8E0DC` | `#2B3531` | Quiet structure instead of boxed-card noise |
| Brand/action | `#0F5138` | `#72C49A` | Primary actions, selection accents, branded emphasis |
| Brand-soft | `#DCEDE4` | `#173A2D` | Selected rows, chips, subtle branded regions |
| Focus | `#147A55` | `#8AD8B0` | Consistent, high-visibility keyboard focus |
| Information | `#256A8A` | `#77B9D5` | Neutral information and linked analytic series |
| Success | `#2E7653` | `#72C49A` | Completed/healthy; paired with label/icon |
| Warning | `#9A6712` | `#E4B85F` | Attention/at risk; paired with label/icon |
| Danger | `#A63D46` | `#F08C95` | Destructive, failed, overdue critical state |

Light mode uses soft, cool neutrals rather than beige/yellow white. Dark mode is independently art-directed rather than algorithmically inverted: near-black green-charcoal canvas, slightly lifted panels, softened text, quiet borders, and brighter mode-specific accents. Pure `#000000` or full-screen `#FFFFFF`, large neon areas, uncontrolled gradients, excessive blur, glowing borders, and low-contrast gray-on-gray are prohibited. Theme switching supports `system`, explicit light/dark, and optional scheduled behavior without a flash of the wrong theme.

Tenant branding cannot recolor danger, warning, success, focus, link, disabled, financial polarity, data-quality, or permission states. A tenant accent that fails contrast or collides semantically is automatically adjusted or rejected with an explanation. Logos never replace the clear tenant/host identity on authentication or privileged surfaces.

#### 26.3.3 Typography, iconography, shape, and depth

Use a highly legible variable sans typeface with tabular-number support and broad international coverage—Geist Sans, Inter, or an evidence-backed equivalent—self-hosted where licensing permits. Use a compatible mono face only for identifiers, code, formulas, and technical evidence. Product prose favors sentence case. All-caps is limited to genuinely short metadata. Display marketing scale does not leak into dense ERP workspaces.

The type system has explicit display, page title, section title, body, compact body, label, caption, and numeric KPI roles. Line height, width, and paragraph spacing support sustained reading; prose columns generally remain within a readable measure while grids and canvases can use the full workspace. Monetary and operational tables use tabular figures, aligned decimals, explicit units, locale formatting, and negative/forecast semantics that do not rely on color alone.

One coherent outline icon family is used at consistent optical sizes and stroke weights. Icons accompany rather than replace unfamiliar labels. Tenant-supplied icons are sanitized and cannot imitate system/security statuses. Rounded geometry is calm and precise: smaller radii for dense controls and grids, medium radii for panels, larger radii only for focused overlays or expressive empty states. Avoid both sharp legacy boxes and toy-like pill saturation.

Depth is communicated primarily by surface tone, border, overlap, and spacing; shadows are quiet and theme-specific. Glass/translucency is limited to cases with a real spatial benefit and must remain legible over variable content. Establish a named layering scale for base, sticky, navigation, popover, command, dialog, notification, and emergency surfaces; arbitrary z-index values are prohibited.

#### 26.3.4 Spacing, density, and layout

Use a four-pixel base grid with a governed spacing scale. Components support `comfortable` and `compact` density; touch layouts preserve at least accessible target sizes even when desktop grids become dense. Users may choose density per device, while critical transaction forms retain the spacing needed to prevent errors.

Layouts use responsive containers and subgrid/grid primitives rather than device-specific page duplication. Page templates cover overview, record detail, master-detail, work queue, data grid, board, calendar, builder, canvas, report, Relay conversation, and high-risk operation. Each template defines title/action hierarchy, filter placement, scroll ownership, sticky behavior, empty/loading/error states, and small-screen transformation.

ERP density is earned through alignment and progressive disclosure, not tiny text. Default screens surface the next decision and the most meaningful context; advanced fields, audit detail, raw identifiers, and configuration complexity remain one predictable interaction away. Whitespace separates meaning, not decoration, and compact mode never removes labels, focus visibility, status explanations, or safe-action context.

#### 26.3.5 Components and interaction states

TES includes production components and patterns for navigation, commands, global search, Relay composer/answers/sources/tool approvals, buttons, links, inputs, selects, comboboxes, date/time/time-zone inputs, structured editors, attachment handling, forms, validation, dialogs, drawers, popovers, tooltips, tabs, accordions, toasts, inline notices, badges, avatars, breadcrumbs, pagination, lists, trees, tables/grids, kanban, calendar/scheduler, timeline, activity/audit, comments, file preview, filters, saved views, bulk action bars, split panes, inspectors, charts, graph canvases, workflow builders, configuration diff/preview, and irreversible confirmations.

Every component and composed pattern defines `default`, hover, active, focus-visible, selected, disabled, read-only, loading, skeleton, empty, no-results, error, permission-denied, stale, offline, syncing, conflict, partial-data, archived, deleted/pending-purge, and high-risk states where applicable. Skeletons match final geometry and do not shimmer indefinitely. Toasts never carry the only copy of a consequential result. Optimistic updates are used only when rollback and conflict semantics are explicit.

Forms prefer inline, field-specific guidance and preserve entered work through recoverable errors. Destructive and cross-organization actions name the target tenant/organization/seat/record, scope, downstream impact, recovery window, approver, and audit consequence. Buttons do not move while loading; irreversible actions never hide behind gesture-only, color-only, or ambiguous icon-only controls.

#### 26.3.6 Visualization grammar

Visualizations are first-class work surfaces across finance, people, projects, memory, workflows, operations, risk, integrations, AI, and tenant fleet management. They must be beautiful because they are structurally clear, truthful, responsive, and actionable—not because they are ornamental.

Every visualization declares its analytical question, source, unit, grain, time zone, date/freshness, filters, comparison basis, missing-data behavior, authorization scope, and drill-through destination. It provides an accessible title/summary, keyboard-reachable marks or an equivalent exploration path, screen-reader description, downloadable accessible table, and non-color encoding where necessary. Tooltips are stable, comparable, and do not obscure the selected data.

Approved grammar includes:

| Question | Preferred visual | Tenure examples |
|---|---|---|
| Change over time | Line, stepped line, restrained area, sparkline | Budget burn, workflow cycle time, membership, SLA, memory health |
| Category comparison | Sorted bar, grouped bar, dot/bullet plot | Clubs, departments, vendors, risks, cells, model cost |
| Target/progress | Bullet, progress band, milestone, variance | Budget vs actual, OKRs, implementation gates, onboarding |
| Composition | Stacked bar/area; donut only for few simple parts | Funding mix, request status, headcount composition |
| Flow between stages/entities | Sankey/alluvial with progressive disclosure | Income-to-expense, request routing, approval paths, integration/event flow |
| Relationship/hierarchy | Org tree, dependency graph, network, adjacency view | Seats, reporting lines, process dependencies, memory provenance |
| Schedule | Calendar, agenda, timeline, Gantt where dependencies matter | Events, projects, transitions, audit windows, releases |
| Distribution/correlation | Histogram, box plot, scatter, heatmap | Cycle-time spread, cost anomalies, workload, control coverage |
| Financial bridge | Waterfall and variance table | Forecast-to-actual, cost change, residual tenant cost |
| Geography | Map only when location is analytically causal | Regional cells, facilities, service territories, residency |

The supplied Monarch cash-flow reference establishes the bar for a **whole-system-in-one-view Sankey**: calm dark or light canvas, low-noise controls, clear source-to-destination direction, labels attached to flows, category colors used selectively, and progressive disclosure for long tails. Tenure applies this pattern to cash flow, budget allocation, approval routing, workflow transitions, information lineage, seat handoffs, integration traffic, and tenant cost decomposition. It must support zoom/pan or staged expansion, search/highlight, percentage and absolute values, Top-N plus `Other`, cycle handling, small-flow aggregation, time/organization filters, record drill-through, and a table/list alternative. It must never render hundreds of unreadable hairlines merely to look sophisticated.

Palette assignment is deterministic and tokenized. The same category retains meaning across views; status colors are not reused as arbitrary series colors. Limit simultaneous chromatic series, use direct labeling where possible, and offer color-vision-safe palettes and patterns. Three-dimensional charts, decorative gauges, exploding pies, perspective distortion, truncated axes without explicit warning, hidden denominators, unjustified dual axes, rainbow scales for unordered categories, and AI-generated numbers not traceable to canonical data are prohibited.

#### 26.3.7 Relay experience

Relay is ambient but not intrusive. It is reachable from a universal command/composer and can open as a sidecar, focused workspace, or record-scoped assistant. The current tenant, seat, record scope, source boundary, and proposed action are always visible. Answers prioritize readable synthesis with expandable evidence, source previews, data freshness, uncertainty/conflict states, and direct navigation to canonical records.

Relay action proposals use structured previews rather than chat prose alone: affected objects, before/after values, permissions used, policy checks, estimated cost, side effects, approval requirements, and reversibility. The user can edit parameters, approve, reject, or inspect evidence. Streaming never causes layout thrash; long answers preserve reading position. Uploads show parsing status and failures per attachment. AI visualizations use the same governed chart API and cannot invent an unregistered visual grammar.

#### 26.3.8 Long-session comfort and humane operation

The target is **zero avoidable visual and interaction fatigue** during sustained professional use. This cannot be asserted from a screenshot; it is validated with users across realistic 30-minute, 90-minute, and multi-hour sessions. The system minimizes glare, contrast oscillation, over-saturation, excessive card borders, tiny type, constant motion, context loss, scroll traps, modal chains, notification anxiety, and repeated data entry.

Motion explains continuity and state change. Standard transitions are generally 120–220 ms with deceleration on entry and acceleration on exit; large spatial transitions may be slightly longer. Respect `prefers-reduced-motion`; stop nonessential animation; never animate large background regions continuously. Sound and haptics are opt-in and never the only status signal.

Notifications are bundled, prioritized, quiet-hour aware, seat/role scoped, and actionable. The work inbox distinguishes `needs action`, `watching`, `delegated`, `waiting`, and `informational`. It avoids gamification, arbitrary streaks, vanity counts, red-dot proliferation, and urgency theater. Autosave, draft recovery, predictable undo, recent history, saved views, command recall, and keyboard operation reduce cognitive and mechanical load.

Research must track perceived eyestrain, task confidence, navigation reversals, misclicks, backtracking, time-to-first-correct-action, interruption recovery, and System Usability Scale or an equivalent measure. Telemetry is privacy-preserving and never substitutes for qualitative observation. A long-session comfort issue that causes users to avoid a screen is a product defect even when functional tests pass.

#### 26.3.9 Accessibility and inclusive modes

WCAG 2.2 AA is the minimum engineering gate, not the maximum ambition. Critical workflows are tested manually with keyboard-only use, visible focus, zoom/reflow, screen readers, reduced motion, forced colors/high contrast, touch, speech input where supported, and representative color-vision deficiencies. Charts, canvases, grids, drag-and-drop, builders, calendars, and graph views require equivalent non-pointer paths.

User settings include theme, density, text scale, reduced motion, increased contrast, chart palette, time/date/number preferences, and notification comfort. Settings follow the user across surfaces where safe and can be overridden by device accessibility preferences. No tenant theme or extension may remove these capabilities.

#### 26.3.10 Performance, resilience, and perceived quality

The shell and frequent paths use explicit performance budgets for JavaScript, CSS, font payload, image/media, network round trips, hydration, input latency, and memory. Route/module loading is progressive; expensive charts, editors, and builders load only when needed. Large grids, graphs, timelines, and message histories virtualize safely without breaking accessibility, selection, printing, export, deep links, or scroll restoration.

Set and enforce user-centric targets by supported device/network tier, including Core Web Vitals, interaction latency, command/search response, route transition, skeleton duration, table scroll, and chart manipulation. Background refresh preserves user state and announces material changes without jumping the page. Offline, stale, partial, rate-limited, queued, and degraded states remain coherent and honest.

#### 26.3.11 Governance and acceptance

Every new surface passes design review, content review, accessibility review, responsive review, light/dark/high-contrast review, localization/RTL review, visual regression, interaction/unit tests, representative browser/device tests, performance budgets, and real-data density tests. Storybook examples use realistic names, long localized strings, nulls, errors, extreme values, hundreds/thousands of rows, and permission variants—not only perfect mock data.

Maintain a visual QA matrix for tenant app, operator plane, configuration studio, public/guest routes, Relay, Marketplace, email, exports, and printable artifacts. Release evidence includes screenshots at governed breakpoints/themes, automated accessibility output, manual keyboard/screen-reader notes, visual diff approval, performance results, and any accepted deviation with owner and expiry.

No team may ship an aesthetically unrelated micro-frontend, chart palette, modal system, form language, or dark-mode interpretation. Experiments may challenge the system behind flags, but successful patterns must graduate into TES before broad use. A design system is successful only when it produces a coherent product under real enterprise complexity.

ERP integrity favors clarity, information density, comparison, traceability, keyboard efficiency, and safe bulk work without becoming visually hostile. High-risk actions show target, impact, policy, approvals, and reversibility before execution.

### 26.4 Native clients

Native iOS, Android, macOS, and Windows clients may follow the API/PWA foundation for push, offline, camera/scanning, field work, device security, and desktop integration. The API, auth, sync, conflict, policy, and audit contracts are designed now; native implementation is not required before web/PWA acceptance.

## 27. Monorepo and software architecture

The repository is one product, but not one undifferentiated application. Preserve actual healthy repository conventions; evolve toward explicit boundaries.

Suggested logical layout:

```text
apps/
  web/                     tenant PWA
  operator/                Tenure Parent operator plane
  public/                  public/guest configured surfaces
  api/                     BFF/API composition if stack uses it
services/
  control-plane/
  identity/
  authorization/
  organization/
  configuration/
  workflow/
  files/
  search-memory/
  relay/
  integration/
  notification/
  reporting/
  billing-metering/
modules/
  finance/ procurement/ calendar/ events/ people/ projects/ crm/ ...
packages/
  domain-contracts/ config-schema/ permission-catalog/ events/
  ui/ sdk/ observability/ testing/ security/ localization/
infrastructure/
  organization/ foundation/ control-plane/ cells/ tenants/ security/ observability/
config/
  platform/ regions/ environments/ plans/ industries/ tenants/ fixtures/
docs/
  architecture/ adrs/ security/ operations/ tenants/ implementation/
```

The existing codebase may use different paths; semantic boundaries matter more than renaming. Initially, many domain modules may deploy as a modular monolith to preserve transaction safety and team velocity. Control plane, async workers, integration runtime, search/memory, Relay, and high-scale modules can separate when operational evidence justifies it. Every extractable boundary already uses contracts, repository interfaces, events/outbox, and ownership rules.

No “microservices for prestige.” A service boundary must have independent scale, isolation, deployment, failure, data ownership, or team-ownership value greater than its operational cost.

## 28. Delivery, release, and migration system

### 28.1 Environments

- Local development with emulators/mocks only where behavior remains contract-tested.
- Ephemeral preview for safe application/config changes without production data.
- Shared integration environment.
- Development AWS cell.
- Staging that mirrors production topology and identity/integration tests.
- Production cells and dedicated tenants.

Production data is never copied unredacted into nonproduction. Synthetic tenants cover diverse hierarchies, locales, modules, isolation, and data classifications.

### 28.2 CI gates

- Deterministic install and lockfile integrity.
- Format, lint, type, unit, property, integration, contract, migration, module-invariant, authorization, tenant-isolation, and build tests.
- Config schema/render/diff/simulation tests for every platform/industry/tenant fixture.
- IaC synth/validate/change set, policy scan, replacement/deletion detector, and cost estimate.
- Secret, dependency, license, SAST, container, SBOM, and provenance checks.
- Accessibility, visual regression, responsive, browser, API, and end-to-end smoke suites.
- RAG/model/tool/guardrail evaluation for AI-affecting changes.
- Performance and load gates for hot paths and migrations.

### 28.3 Promotion

Build once, sign, scan, and promote the identical artifact digest through development, staging, canary, and production. A release manifest binds code SHA, container/package digests, IaC version, database migrations, config schemas, module versions, prompts/tools/models, and test evidence.

Rollouts may be by internal users, synthetic tenants, cell, cohort, plan, module, tenant, or dedicated account. Compatibility checks prevent a tenant config from activating against an incompatible runtime. Kill switches restrict unsafe features without granting new authority.

### 28.4 Database and config migration

- Expand → backfill → dual-compatible read/write where necessary → verify → switch → contract after rollback window.
- Migrations are idempotent/restartable or track exact checkpoint.
- Large backfills are throttled, observable, and resumable by tenant.
- Config migrations are pure/deterministic where possible, emit diffs, and preserve old versions.
- In-flight workflow definition migration is explicit; default is to finish on snapshotted definition.
- Search/vector/analytics projections rebuild or backfill without blocking canonical writes.
- Production down migration is not assumed safe; forward fix and restore plans are prepared.

### 28.5 Production controls

Read-only inventory and plans may run automatically through protected workflows. Production apply requires a protected GitHub Environment reviewer, immutable SHA/digest, approved plan, account/region/cell allowlist, concurrency lock, backup/readiness evidence, canary, alarms, and rollback identifier. Deletion, key rotation/revocation, account closure, tenant offboarding, and destructive migrations require separate explicit approval.

## 29. Testing strategy

### 29.1 Mandatory tenant-isolation matrix

Create at least Tenant A and Tenant B with different cells/configurations. Attempt cross-tenant access through IDs, query/body parameters, host/subdomain, headers, app clients, tokens, cookies, search, files, exports, reports, analytics, websocket, cache, queues, events, workflows, integrations, Relay retrieval, Relay tools, support, and bulk endpoints. All paths deny without confirming the other resource exists.

### 29.2 Temporal organization tests

- Assignment starts/ends at exact boundary.
- Future, shadow, interim, delegated, leave, alumni, and former states.
- Seat title/org move while historical decision reconstructs old context.
- Delegation cannot exceed source authority and expires immediately.
- Multi-seat and multi-tenant users do not bleed authority.
- Successor sees allowed seat memory but not restricted predecessor records.
- Offboarding revokes sessions, tools, queues, integrations, and current authority while preserving history.

### 29.3 Financial/workflow integrity

- Every posted journal balances by ledger/currency rules.
- Concurrent approvals produce one transition and one financial effect.
- Self-approval, amount threshold, quorum, recusal, and separation-of-duty cases.
- Reversal/correction preserves original record.
- Period locks and policy snapshots hold under retries and concurrency.
- Workflow timers, retries, compensation, cancellation, definition version, and SLA calendars.

### 29.4 Security tests

- Auth code/PKCE, state/nonce, replay, issuer/audience/token-use/signature/time/JWKS, callback and open-redirect negatives.
- Session fixation, revocation, CSRF, CORS, CSP/XSS, SSRF, injection, mass assignment, header spoofing, cache poisoning, request limits.
- File malware/polyglot/archive bomb/active content/preview escape.
- OIDC trust negative subjects, IAM least privilege, role separation, secret/log leakage, public-resource detection.
- Supply-chain and untrusted-fork workflow tests.

### 29.5 Relay tests

- Citation source exists, version matches, actor can read, and statement is supported.
- “I don't know” when evidence is missing or conflicting.
- Prompt injection in documents/images/tool outputs cannot change system policy or tool grants.
- Model cannot retrieve Tenant B or unauthorized Tenant A classification.
- Tool arguments are schema-valid and independently authorized.
- Writes preview/confirm/approve at correct risk class; replay remains idempotent.
- Charts, tables, diagrams, scans, documents, audio, video, multilingual, and long-context cases.
- Cost/latency/quality budgets and model fallback behavior.
- Evaluation regression blocks model/prompt/tool promotion.

### 29.6 Recovery and operations tests

- Nonproduction database/object/config restore with measured RPO/RTO.
- Failed deploy and rollback to exact artifact.
- Queue/DLQ replay, duplicate event, partial connector outage, and rate limiting.
- Cell saturation and admission block.
- IdP/Cognito/Bedrock/search dependency degradation.
- Audit archive verification and tamper detection.
- Tenant export/offboarding/delete rehearsal on synthetic data.

## 30. Implementation sequence

### Wave 0: Contain and establish truth

Audit the real repository and AWS state, remove unsafe public assumptions, establish real authentication, retire exposed/demo access paths, reconcile canonical seat/roster/finance data, and prove build/test/deploy. The 2026-07-30 audit's order remains binding: containment → identity → canonical data → transaction safety → product truth → UX.

### Wave 1: Parent foundation and Simon-ready core

- Tenure Parent registry, cell abstraction, tenant config schema, OIDC deployment trust, Cognito foundation.
- Canonical person/membership/unit/seat/assignment/delegation and authorization.
- Tenant schemas/no shared business tables, audit/outbox, files, search foundation.
- Simon/OSE config plus a corporate test config through the same engine.
- Members/seats, approvals/workflow, documents, events/calendar/conflicts, finance budgets/requests/reimbursements/vendors, messaging/notifications, reports/search, memory/handoff.
- Relay read-only grounded answers and summaries only after the corpus and authorization are proven.

### Wave 2: Automation and repeatable tenant distribution

- One-click tenant state machine, config studio, release/rollback, shared/bridge/dedicated placement.
- Enterprise SAML/OIDC/SCIM connection lifecycle.
- Relay typed draft/reversible tools, multimodal ingestion, evaluations, cost controls.
- Integration Hub with initial Google/Microsoft/Slack/storage connectors selected by customers.
- Operator plane, observability, billing/metering, backup/restore, export/offboarding.

### Wave 3: General ERP expansion

- Projects/goals, case/service catalog, contracts/records, procure-to-pay, finance core, CRM/customer success, HCM foundations, asset/facilities.
- Industry pack framework and additional verified fixtures.
- Regional cells, tenant migration, dedicated-account vending, advanced analytics.

### Wave 4: Enterprise and regulated scale

- Order-to-cash, inventory/logistics, manufacturing/quality/maintenance, advanced GRC, planning/consolidation.
- GovCloud/sovereign partition deployments where commercial need and service availability justify.
- Certified extension runtime, partner program, and marketplace controls.
- Native clients where workflows require offline/device capabilities.

The waves are dependency order, not permission to leave weak foundations. A module is not “available” until its data invariants, security, audit, configuration, migration, tests, operations, and user workflows pass.

## 31. Product and continuity metrics

Primary outcome metrics:

- Median successor time to first independent successful task.
- Seat handoff completeness and time to completion.
- Percentage of critical seat knowledge with current owner, provenance, and review date.
- Percentage of Relay answers with valid resolvable citations and supported claims.
- Repeated-mistake/duplicate-work reduction across occupant transitions.
- Unowned recurring obligations and missed deadlines after transitions.
- Approval cycle time, policy exception rate, and decision reconstruction success.
- Organizational records moved from personal/unmanaged ownership into governed ownership.
- Seat vacancy continuity risk and successor readiness.

Platform metrics:

- Tenant provisioning lead time and first-pass success.
- Config changes requiring source code: target zero.
- Cross-tenant access test pass rate: 100% denies.
- Release change failure, rollback, recovery, and drift.
- Availability/latency/error by cell and tenant tier.
- Gross margin and cost per active user/seat/workflow/AI answer.
- Connector freshness/reconciliation and search/index freshness.
- Security, privacy, accessibility, and backup control evidence health.

Vanity activity metrics such as messages sent or AI queries alone do not prove organizational memory survived.

## 32. Explicit prohibitions

- No customer-specific source forks.
- No personal or unrelated customer AWS accounts as tenant runtime targets.
- No manually configured console-only production tenant.
- No Cognito Group, email suffix, title string, or frontend role as canonical authorization.
- No cross-tenant business tables or unscoped query clients.
- No AI direct database credentials or model-generated raw SQL against production.
- No Relay tool bypassing the normal command, policy, approval, audit, and idempotency path.
- No model provider API outside the approved AWS-hosted Bedrock/SageMaker boundary.
- No silent cross-region inference or replication contrary to residency.
- No shared-model training on customer content.
- No secrets in GitHub/source/logs/artifacts/prompts/client code.
- No long-lived AWS keys in routine deployment once OIDC is available.
- No production mutation or destructive action without protected human approval.
- No fake marketplace listings or integrations represented only by logos.
- No compliance/certification claim without scope, assessment, evidence, and authorization.
- No “one click” that skips validation, plan, testing, approval, rollback, or audit.
- No module marked complete because screens, schemas, or mocks exist without an exercised end-to-end path.
- No over-engineering that adds permanent cost/operations without a measured requirement.

## 33. Authoritative ADR set

Implementation must create and maintain Architecture Decision Records for:

1. Tenure-owned AWS Organization/account model.
2. Control-plane versus cell versus tenant-data-plane boundaries.
3. Cell routing, placement, capacity, migration, and residency.
4. Pooled/bridge/silo/dedicated-account isolation and no-shared-business-table enforcement.
5. IaC system and account vending.
6. Cognito pool/app-client/federation strategy.
7. BFF session and authorization engine.
8. Canonical temporal organization/seat graph.
9. Relational data, schema/database placement, and migration.
10. Commands, outbox, events, workflows, and idempotency.
11. Object/file security, records, retention, export, and deletion.
12. Search/vector/RAG storage driver and tenant isolation.
13. Relay model gateway, initial model routing, evaluation, tools, and automation risk.
14. Integration runtime, secrets, egress, reconciliation, and connectors.
15. Modular-monolith versus extracted-service criteria.
16. Analytics/semantic layer and fleet telemetry privacy.
17. Audit integrity and immutable evidence archive.
18. Extension sandbox and future marketplace.
19. Globalization, accessibility, PWA/offline, and native-client sequencing.
20. SLO, backup, restore, DR, and regional availability tiers.

## 34. Decision checklist

- [x] Tenure Parent is the product; Simon is Tenant 1.
- [x] Tenure owns and governs all tenant AWS accounts.
- [x] Backend, AI, data, security, and tenant runtime are AWS-native.
- [x] External business integrations are allowed through the AWS-hosted Integration Hub.
- [x] Tenants configure deeply within guardrails; no unrestricted core or infrastructure access.
- [x] Declarative, low-code, and sandboxed SDK extension levels are included.
- [x] Commercial, GovCloud, and sovereign-partition capability is designed; air-gapped runtime is a later class.
- [x] Responsive web/PWA and API come before native clients.
- [x] Relay by Tenure is the copilot brand and Amazon Nova 2 Lite the initial default multimodal model.
- [x] Provider-neutral evaluation and routing inside Bedrock prevents model lock-in and brand bias.
- [x] Production mutation and destructive actions require protected human approval.
- [x] Marketplace architecture exists; initial page is empty and says Coming soon.
- [x] One versioned Tenure Experience System governs every surface; dark forest green is the protected accent and light/dark modes are independently fatigue-minimized.
- [x] Radix Primitives may provide accessible behavior in a React stack, but Tenure owns the visual language, wrappers, tokens, and component APIs.
- [x] Governed, accessible, drillable visualization grammar—including Sankey for meaningful flow questions—is a platform capability, not module-specific decoration.

## 35. Current authoritative references

Tenure philosophy:

- [Tenure: the operating system for organizational memory](https://www.tenurework.com/)

Experience-system references:

- [Monarch: one clear financial view and customizable reporting](https://www.monarch.com/)
- [Vercel: restrained, precise, theme-aware product language](https://vercel.com/)
- [Perplexity: content-first, source-oriented AI interaction reference](https://www.perplexity.ai/)
- [Radix Primitives: accessible unstyled React behavior primitives](https://www.radix-ui.com/primitives)

AWS multi-account, tenancy, and reliability:

- [AWS Control Tower](https://docs.aws.amazon.com/controltower/latest/userguide/what-is-control-tower.html)
- [AWS multi-account strategy](https://docs.aws.amazon.com/controltower/latest/userguide/aws-multi-account-landing-zone.html)
- [Silo, pool, and bridge SaaS models](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-pool-and-bridge-models.html)
- [Cell-based architecture in the AWS Reliability Pillar](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html)
- [AWS multi-Region fundamentals](https://docs.aws.amazon.com/prescriptive-guidance/latest/aws-multi-region-fundamentals/aws-multi-region-fundamentals.html)

AWS identity:

- [Amazon Cognito multi-tenant application best practices](https://docs.aws.amazon.com/cognito/latest/developerguide/multi-tenant-application-best-practices.html)
- [Amazon Cognito security best practices](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-security-best-practices.html)
- [Authorization Code with PKCE in Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html)
- [Verify Cognito JSON web tokens](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html)

AWS AI and RAG:

- [Amazon Nova 2 Lite model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html)
- [Amazon Nova 2 capabilities](https://docs.aws.amazon.com/nova/latest/nova2-userguide/what-is-nova-2.html)
- [Amazon Nova pricing](https://aws.amazon.com/nova/pricing/)
- [Claude Sonnet 5 on Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5.html)
- [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/)
- [Amazon Bedrock intelligent prompt routing](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-routing.html)
- [Amazon Bedrock Knowledge Bases](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base.html)
- [Multimodal Knowledge Bases](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-multimodal.html)
- [Multimodal processing choices](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-multimodal-choose-approach.html)
- [Amazon S3 Vectors general availability](https://aws.amazon.com/blogs/aws/amazon-s3-vectors-now-generally-available-with-increased-scale-and-performance/)
- [Amazon Bedrock AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html)
- [Bedrock Guardrails automated reasoning](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-automated-reasoning-checks.html)
- [Amazon Bedrock model and RAG evaluations](https://docs.aws.amazon.com/bedrock/latest/userguide/evaluation.html)

Repository implementation must revalidate service availability, quotas, region support, lifecycle, and pricing at the time of each deployment. Links and prices in this Bible are architecture inputs as of the document date, not perpetual guarantees.

## 36. Final definition

Tenure is complete only when the engine can take a validated description of an organization—its structure, seats, people, authority, workflows, records, modules, language, region, integrations, AI policy, and isolation requirements—and produce a tested, governed, observable AWS tenant without editing business source code.

Its moat is not that it contains many ERP screens. Its moat is that every governed action enriches a durable organizational memory attached to the structures that survive personnel turnover. Relay turns that authorized memory into answers and automation. The platform makes the successor productive without erasing the predecessor, leaking the tenant, or losing the reason behind the work.
