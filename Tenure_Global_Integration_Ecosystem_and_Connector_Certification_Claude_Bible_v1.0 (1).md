# Tenure Global Integration Ecosystem, Internal Pipeline, and Connector Certification Bible

**Version:** 1.0  
**Date:** 2026-08-04  
**Status:** Binding architecture and Claude Code execution specification  
**Runtime:** AWS-hosted Tenure Integration Plane in Tenure-owned AWS  
**Scope:** Internal/external integration patterns, connector registry, credentials, mapping, orchestration, certification, operations and tenant experience  

---

## BEGIN CLAUDE CODE MASTER PROMPT

You are the principal integration-platform architect, API and event architect, identity/security engineer, enterprise data-integration lead, EDI/banking/payment integration architect, SRE, UX architect, and hands-on implementation owner for the **Tenure Global Integration Ecosystem**.

Build the AWS-hosted integration plane that connects Tenure modules to one another and connects each tenant to its approved external systems without bypassing Tenure tenant isolation, authorization, workflows, accounting, audit, memory, data residency, secrets, approval or lifecycle controls.

Do not implement a connector logo catalog. Do not claim an integration works because OAuth succeeds, a sample webhook arrives, a file parses, or a provider SDK is installed. A connector is production-ready only for a declared capability/version/region/tenant scope after bidirectional behavior, limits, failure recovery, reconciliation, security, privacy, migration, operations, support and rollback pass.

## 0. Constitutional relationship

Read the master document graph. This document owns the integration runtime, registry, connector package contract, connection lifecycle, mapping/transformation, internal event pipeline, external protocols, credential references, certification, Integration Studio, operations and tenant lifecycle.

Domain Bibles own domain semantics. Specifically:

- The Payments/Treasury/Stripe Bible is mandatory for Stripe, money movement, merchant/legal-entity mapping, connected accounts, payouts, cards, disputes, reserves and reconciliation. Never collapse it into a generic connector.
- The ERP Implementation Extension owns enterprise migration, high-volume transformations, ISO 20022 banking and cutover.
- The Identity architecture owns Cognito, SAML/OIDC and SCIM authority.
- The Pack Factory declares integration requirements and compatible connector capabilities.
- The Configurator generates eligible connection questions and impact.

## 1. Binding architecture

```text
Tenure domain command/event
→ canonical integration contract
→ tenant/environment connection policy
→ mapping/transformation version
→ connector capability adapter
→ credential broker/reference
→ delivery orchestration
→ external endpoint/provider
→ acknowledgement/result/webhook/file/event
→ validation/deduplication/correlation
→ domain command or reconciliation exception
→ audit, metrics, evidence and institutional memory
```

The Integration Plane is not the canonical system of record for finance, HR, inventory, customer or payments. It transports and transforms governed intent and observations while preserving ownership and lineage.

## 2. Non-negotiable invariants

- Every message and job carries canonical tenant, environment, connection, integration, run, correlation, causation, schema, mapping, idempotency, source and classification identifiers.
- Tenant and environment are resolved server-side. Client/provider payloads cannot select another tenant.
- Secrets are stored in approved AWS secret/token systems and referenced by opaque IDs. Never store credentials in tenant configuration, connector package, database field, URL, log, event, DLQ, screenshot or evidence.
- Connections use least scopes, least data, explicit purposes, approved regions and bounded egress.
- One global provider app/registration is preferred where vendor rules permit safe multi-tenant distribution; tenant-specific registrations are modeled explicitly when required, never improvised with user API tokens.
- Every write is idempotent or guarded by a documented duplicate protocol.
- At-least-once transport is expected; business effects remain exactly-once by idempotent command and reconciliation design.
- Retries are error-specific and bounded. Permanent, validation, authorization, revoked-consent and rate-limit failures do not loop blindly.
- DLQ is not resolution. Every failed item has classification, owner, next action, safe replay and age/SLA.
- Webhooks are untrusted input until signature/authentication, timestamp/replay window, schema, tenant/connection resolution and authorization pass.
- External acknowledgement is not necessarily business acceptance, settlement or reconciliation.
- Every mapped field has lineage from source to canonical to target and back where applicable.
- External system authority is explicit by business domain and effective period.
- No connector can directly write private domain tables or post ledger rows. It invokes authorized typed commands.
- A provider outage must not weaken Tenure access controls or corrupt canonical data.
- Tenant suspension/hibernation/offboarding/purge applies to tokens, webhooks, schedules, queues, files, residual data and provider resources according to policy.

## 3. Integration modes and patterns

Support:

### 3.1 Interaction modes

- User-delegated OAuth/OIDC.
- Tenant-admin delegated OAuth.
- Service-to-service OAuth client credentials.
- Signed API key/HMAC where unavoidable.
- Mutual TLS and private certificate authentication.
- SAML/OIDC federation and SCIM provisioning.
- SFTP/FTPS/HTTPS managed file exchange.
- EDI/AS2 and managed B2B exchange.
- Webhook/event subscription.
- Polling/incremental query with watermarks.
- Database/CDC through approved bounded patterns.
- Streaming and message-bus integration.
- Email/calendar/productivity protocol adapters.
- Embedded provider UI/session components.
- Human-controlled export/import.

### 3.2 Delivery patterns

- Request/response.
- Command/acknowledgement/result.
- Fire-and-observe event.
- Batch and scheduled batch.
- Bulk asynchronous job.
- Publish/subscribe.
- Fan-out/fan-in.
- Splitter/aggregator.
- Saga/compensation.
- Reconciliation and exception worklist.
- Snapshot plus delta.
- Outbox/inbox.
- Store-and-forward.
- Two-tier/hub-and-spoke synchronization.

## 4. Canonical integration objects

Implement:

- `ConnectorDefinition`
- `ConnectorVersion`
- `ConnectorCapability`
- `ProviderProgram`
- `ProviderApplication`
- `Connection`
- `ConnectionEnvironment`
- `CredentialReference`
- `ConsentGrant`
- `ScopeGrant`
- `Endpoint`
- `WebhookSubscription`
- `FileChannel`
- `EventChannel`
- `Schedule`
- `IntegrationDefinition`
- `IntegrationRun`
- `IntegrationMessage`
- `CanonicalEnvelope`
- `SchemaDefinition`
- `MappingPackage`
- `TransformationPackage`
- `LookupTable`
- `Watermark`
- `IdempotencyRecord`
- `DeliveryAttempt`
- `Acknowledgement`
- `ReconciliationPolicy`
- `ReconciliationRun`
- `IntegrationException`
- `ReplayRequest`
- `ProviderLimitProfile`
- `ConnectorCertificationScope`
- `ConnectorRelease`
- `OperationalOwnership`
- `ConnectionEvidence`

All are tenant/environment scoped as applicable, versioned, effective-dated and auditable.

## 5. Connector package contract

Example:

```yaml
apiVersion: tenure.io/integration/v1
kind: ConnectorPackage
metadata:
  id: stripe-connect
  version: 1.0.0
  provider: stripe
  lifecycle: CERTIFIED_LIMITED
  digest: sha256:...
capabilities:
  - id: payments.connected-account-onboarding
    domainBible: tenure-payments-v1
  - id: payments.direct-charges
  - id: payments.payout-observation
auth:
  types: [OAUTH2, ACCOUNT_SESSION]
  secretClasses: [CLIENT_SECRET, WEBHOOK_SECRET]
events:
  inbound: []
  outbound: []
limits: []
regions: []
certification: []
```

A package includes:

- provider and API/product version compatibility;
- capability list and exact supported operations;
- auth methods, consent and scope mapping;
- endpoint and network requirements;
- inbound/outbound schemas and canonical mappings;
- rate/concurrency/batch/payload limits;
- pagination, ordering and consistency behavior;
- idempotency and duplicate semantics;
- webhook/event signature and replay rules;
- retry/backoff/circuit-breaker policy;
- error taxonomy and user-safe messages;
- data classifications, regions and retention;
- credential rotation/revocation/expiry handling;
- health and reconciliation checks;
- provider sandbox/test and production distinctions;
- migrations and compatibility;
- dashboards, alarms, runbooks and support escalation;
- tests, certification scope and known limitations;
- suspend/offboard/delete behavior.

Connector code runs through a constrained connector SDK/runtime. It cannot choose tenant context, query arbitrary domain data, access unrelated secrets, emit unregistered event types, or bypass egress policy.

## 6. Connector lifecycle

```text
CATALOGED
→ SPECIFIED
→ DEVELOPING
→ SANDBOX_VALIDATED
→ TENANT_PILOT
→ CERTIFICATION_PENDING
→ CERTIFIED_LIMITED
→ GENERALLY_AVAILABLE
→ DEPRECATED
→ END_OF_SUPPORT
→ RETIRED
```

Orthogonal suspension states: `SECURITY_SUSPENDED`, `PROVIDER_SUSPENDED`, `REGULATORY_SUSPENDED`, `DEGRADED`, `INCOMPATIBLE`.

Connection lifecycle:

```text
DRAFT
→ AUTHORIZING
→ AUTHORIZED
→ CONFIGURING
→ TESTING
→ READY
→ APPROVED
→ ACTIVE
→ DEGRADED | REAUTH_REQUIRED | RATE_LIMITED | FAILED
→ SUSPENDED
→ REVOKING
→ REVOKED
→ RETAINED_HISTORY
→ PURGED
```

No connection becomes active from a green OAuth callback alone.

## 7. Integration capability registry

Maintain a registry of **capabilities**, not vendor names. Providers may fulfill one or more capabilities.

### 7.1 Identity, security and IT

- SAML/OIDC identity provider.
- SCIM user/group lifecycle.
- MFA/risk signals.
- HR-driven identity lifecycle.
- Directory/group/device inventory.
- MDM/UEM device compliance and actions.
- SaaS access governance.
- SIEM/security findings and case exchange.
- eDiscovery/legal hold and records export.
- secrets/certificate reference and rotation observation.

Potential provider families include Microsoft Entra/365, Google Workspace, Okta, Ping, JumpCloud, major MDM/UEM and SIEM platforms. Availability requires connector certification; names alone do not promise support.

### 7.2 Productivity, collaboration and work management

- Email, calendar, contacts and meeting metadata.
- Chat/channel/message and notification delivery.
- File/document storage and governed links.
- Tasks, issues, projects and work-item synchronization.
- Knowledge/wiki and approved content ingestion.
- Video meeting and transcript metadata under consent/retention.
- E-signature and agreement status.

Provider families may include Microsoft 365/Teams/SharePoint/OneDrive, Google Workspace/Drive, Slack, Zoom, Atlassian Jira/Confluence, Asana, Monday, Linear, Notion, Box, Dropbox and DocuSign/Adobe Sign.

### 7.3 Finance, banking, tax and payments

- Bank account/transaction/statement connectivity.
- ISO 20022/payment file and API channels.
- Payment gateway/acquiring and alternative payment methods.
- Marketplace/connected account onboarding, collections, splits, payouts and settlement.
- Card issuing/spend controls and financial accounts where supported.
- Expense/travel/cards.
- Tax determination, e-invoicing and filing/provider exchange.
- Credit, fraud, KYC/KYB/sanctions and identity verification.
- Treasury, FX and cash forecasting feeds.

Stripe must invoke the Payments Bible. Other processors/banks may later implement the same provider-neutral domain capabilities after separate liability, legal, certification and reconciliation work.

### 7.4 ERP, accounting and enterprise applications

- SAP/Oracle/Workday/Dynamics/NetSuite/Sage/QuickBooks/Odoo and other source/target adapters.
- Master data, chart/account mappings, journal/balance, supplier, customer, worker, item, order, invoice, payment and asset exchange.
- Snapshot/delta, migration, coexistence and consolidation.
- External system-of-record and two-tier domain ownership.

Provider object models remain adapter inputs/outputs, never Tenure canonical models.

### 7.5 HCM, payroll, benefits and workforce

- Worker/person/job/position/assignment lifecycle.
- Recruiting and applicant exchange.
- Time/attendance/schedule/leave.
- Payroll input/output, payslip/result, tax filing and payment status.
- Benefits eligibility/enrollment and carrier files.
- Background check, learning and talent providers.
- Contingent workforce/VMS.

Payroll availability remains exact jurisdiction/provider/population certified.

### 7.6 CRM, marketing, sales, service and commerce

- Accounts/contacts/leads/opportunities/cases.
- Campaign, audience, consent and events.
- CPQ/quote/contract/order/subscription/renewal.
- Customer support and knowledge.
- Ecommerce/POS/orders/fulfillment/returns.
- Marketplace sellers and catalog.
- Customer data platform/warehouse activation under consent.

### 7.7 Manufacturing, engineering and quality

- CAD/PLM product, part, BOM, revision, change and document exchange.
- MES work order, operation, material, yield, scrap and equipment signals.
- QMS inspection, nonconformance, CAPA and certificate.
- LIMS sample/test/result.
- IoT/SCADA/historian observations through safety-bounded read/write policies.
- Maintenance/EAM and calibration.
- Supplier quality and traceability.

Tenure does not claim control-system, geometry-kernel, clinical or safety-system replacement through a connector.

### 7.8 Supply chain, EDI, logistics and trade

- EDI X12/EDIFACT and partner onboarding.
- Orders, acknowledgements, ASN, invoices, inventory and remittance.
- WMS/TMS/carrier/rate/label/tracking/proof of delivery.
- Supplier network/catalog/procurement network.
- Customs/global trade/restricted-party providers.
- Barcode/RFID/device feeds.

### 7.9 Data, analytics and AI

- Data warehouse/lake/lakehouse export/import.
- BI semantic/reporting tool integration.
- ETL/iPaaS coexistence during migration.
- Streaming/data share and reverse ETL.
- Approved document/media ingestion to Relay through AWS boundaries.

Tenure customer records sent to AI inference remain inside the approved AWS-hosted model boundary; generic integration cannot route them to external model APIs.

### 7.10 Public sector, education, healthcare and nonprofit ecosystems

- Student information/LMS/research administration.
- Grants/donor/fundraising/membership.
- Government procurement/budget/reporting portals.
- EHR/clinical/healthcare supply chain under exact PHI/security scope.
- Public records and transparency export.

Simon integrations require separate Simon/University authorization; availability labels remain truthful.

## 8. Internal organizational pipeline

Tenure's own modules integrate through the same governed canonical event and command contracts. Avoid hidden point-to-point calls that create inconsistent state.

Example internal chain:

```text
Approved purchase request
→ procurement purchase order
→ receipt/service confirmation
→ supplier invoice match
→ accounting event
→ AP journal and payment proposal
→ protected payment approval
→ bank/Stripe/provider instruction
→ acknowledgement/settlement observation
→ reconciliation
→ budget/report update
→ durable seat and vendor memory
```

Internal events use transactional outbox/inbox, schemas, idempotency, tenant context, authorization at command boundaries and observability. Internal traffic does not need provider OAuth, but it does need least service identity and policy.

## 9. Canonical envelope

```json
{
  "envelopeVersion": "1.0",
  "messageId": "...",
  "tenantId": "...",
  "environmentId": "...",
  "connectionId": "...",
  "integrationId": "...",
  "runId": "...",
  "correlationId": "...",
  "causationId": "...",
  "idempotencyKey": "...",
  "schema": {"id": "...", "version": "..."},
  "mapping": {"id": "...", "version": "..."},
  "source": {"system": "...", "object": "...", "recordId": "..."},
  "classification": "CONFIDENTIAL",
  "occurredAt": "...",
  "receivedAt": "...",
  "payloadRef": "s3://opaque-governed-reference",
  "trace": {"traceId": "..."}
}
```

Large/sensitive payloads use encrypted governed references with checksum, content type, size, expiry and scan state. Do not exceed bus/queue limits or place sensitive documents directly in event bodies.

## 10. Mapping and transformation

Mapping packages define:

- source/target schemas and versions;
- field and semantic mapping;
- required/optional/conditional rules;
- code/enum/unit/currency/time-zone transformations;
- identity/master-data resolution;
- default/inference and prohibited data loss;
- lookups/reference-data version;
- validation and quarantine;
- source-of-truth and conflict policy;
- round-trip behavior and lossiness;
- lineage and reconciliation measures;
- test fixtures and golden outputs;
- deployment/rollback version.

Transformations are deterministic, sandboxed, bounded and signed. Arbitrary tenant code cannot access the network, filesystem, secrets or other tenants. High-volume flows support streaming/chunking, backpressure, checkpoints, split/aggregate and resumability.

## 11. Authentication, consent and secret handling

- Use authorization code + PKCE for user-facing OAuth where applicable.
- Validate state, nonce, issuer, audience, redirect URI and token binding requirements.
- Store refresh/access tokens encrypted behind a credential broker; application code receives narrow use handles when possible.
- Model grant owner, tenant, provider account/site, scopes, consent text/version, expiry, last use and revocation.
- Scope upgrades require explicit re-consent and impact preview.
- Rotate client secrets/certificates/webhook secrets safely with overlap windows.
- Validate provider account identity after authorization to prevent connecting the wrong organization.
- Provide reauthorization worklists before expiry or revoked access causes silent failures.
- Never ask users to paste reusable passwords. API keys are accepted only through a dedicated masked secret-capture flow when no safer auth exists.

## 12. Webhooks and inbound security

For each provider:

- receive through provider-specific bounded ingress;
- verify signature with current/previous rotation keys;
- enforce timestamp/replay window and body-byte exactness;
- resolve provider account/subscription to one connection;
- rate limit and protect WAF/API ingress;
- store minimal receipt metadata before async processing;
- deduplicate provider event ID plus semantic idempotency;
- validate registered schema/version;
- quarantine unknown or oversized content;
- acknowledge within provider timeout without lying about business completion;
- process asynchronously and reconcile missing/out-of-order events;
- renew subscriptions before expiry;
- delete/revoke subscriptions during offboarding.

## 13. Rate limits, resilience and backpressure

`ProviderLimitProfile` records endpoint/resource/user/app/tenant limits, headers, burst, daily/monthly quota, concurrency, payload and batch sizes. Runtime must:

- apply token bucket/leaky bucket or provider-appropriate control;
- honor `Retry-After` and provider headers;
- serialize hot-resource writes where required;
- use jittered exponential backoff for eligible transient errors;
- circuit break degraded dependencies;
- prioritize protected/critical workflows;
- shed/reject low-priority work explicitly;
- expose backlog age and estimated recovery;
- avoid retry storms across tenants;
- keep per-tenant fairness and quotas.

Provider-specific limits change; store versioned operational profiles and monitor official change notices.

## 14. Error taxonomy and exception management

Minimum classes:

```text
AUTHENTICATION_FAILED
AUTHORIZATION_DENIED
CONSENT_REVOKED
REAUTH_REQUIRED
VALIDATION_FAILED
SCHEMA_INCOMPATIBLE
MAPPING_FAILED
REFERENCE_NOT_FOUND
DUPLICATE
CONFLICT
RATE_LIMITED
QUOTA_EXCEEDED
TRANSIENT_PROVIDER
PERMANENT_PROVIDER
NETWORK_TIMEOUT
PAYLOAD_TOO_LARGE
MALWARE_OR_POLICY_BLOCK
REGION_OR_RESIDENCY_BLOCK
BUSINESS_REJECTED
ACKNOWLEDGED_NOT_SETTLED
RECONCILIATION_VARIANCE
UNKNOWN_OUTCOME
```

Exceptions display source object, intended outcome, current outcome, financial/authority/data impact, retry eligibility, remediation, owner, SLA, evidence and related records. Sensitive payloads remain protected.

## 15. Reconciliation

Every production write-capable integration defines reconciliation:

- record/count/control totals;
- money, currency and settlement measures;
- status progression;
- missing, extra, duplicate and divergent items;
- source/target timestamps and watermarks;
- tolerance and hard-zero-variance classes;
- automatic versus human resolution;
- sign-off and audit;
- replay/correction/compensation.

Authority, money, payroll/payment totals, legal hold and required record counts require zero unexplained variance. “HTTP 200” is not reconciliation.

## 16. Integration Studio UX

Required surfaces:

1. **Catalog** — capabilities first, eligible providers second; lifecycle/scope visible.
2. **Connection setup** — generated from connector schema; account verification and least-scope consent.
3. **Capability mapping** — shows which pack requirement the connection fulfills.
4. **Object/schema browser** — source/target definitions, versions and sample-safe metadata.
5. **Mapping workbench** — field lineage, transforms, validation, test and version compare.
6. **Event/file/API flow designer** — bounded patterns over approved primitives.
7. **Run monitor** — live/backlog/history, filters, drill-through and correlation.
8. **Exception worklist** — severity/owner/SLA/remediation/replay.
9. **Reconciliation** — measures, variances, sign-off and correction.
10. **Credentials and consent** — references, scopes, expiry/rotation/reauthorization; never secret values.
11. **Provider health and limits** — service status, quotas, rate pressure and degradation.
12. **Certification** — exact environment/provider/API/capability evidence.
13. **Lifecycle** — suspend, revoke, replace, migrate, retain and purge.

UX follows the Configurator/Tenure Experience System: save/resume, back/forward, autosave truth, diff, preview, approval, accessible status, light/dark, dense tables, safe bulk actions and complete error/empty/loading states.

## 17. Connection setup flow

1. Select required capability.
2. See eligible certified connector/provider choices for tenant context.
3. Review authority, data, scopes, region, costs, limitations and system-of-record effect.
4. Select provider account/site and environment.
5. Complete secure auth/consent or secret reference.
6. Verify connected account identity.
7. Configure objects, directions, filters, schedules/events and mappings.
8. Validate schemas, permissions, limits and endpoint reachability.
9. Run sandbox/safe test with synthetic or approved data.
10. Reconcile test outcome.
11. Preview activation impact and obtain approval.
12. Activate with monitoring/canary.
13. Verify production observation without causing unsafe side effects.

## 18. AWS reference architecture

Use actual repository architecture and ADRs, typically:

- API Gateway/ALB and WAF for ingress.
- EventBridge for canonical events/routing and schema registry where suitable.
- SQS queues/DLQs for buffered tenant-aware delivery.
- Step Functions for resumable multi-step orchestration.
- Lambda for bounded transforms/adapters; ECS/Fargate for sustained/high-volume/private dependency workloads.
- S3 for encrypted large payload/file landing, versioning, lifecycle and quarantine.
- Aurora PostgreSQL for canonical integration metadata, mappings, runs, exceptions and reconciliation.
- DynamoDB for idempotency/watermark/high-scale delivery state where justified.
- Secrets Manager/KMS for credentials and rotation.
- VPC endpoints, NAT/egress proxies, Network Firewall/domain allowlists where required.
- CloudWatch/X-Ray/OpenTelemetry and central security/audit accounts.

Account/cell/region placement must preserve tenant and data-residency boundaries. Do not centralize sensitive payloads into a global unpartitioned bus or bucket.

## 19. Tenant lifecycle

### Suspend

Block scheduled starts and write actions, revoke sessions as applicable, pause deliveries safely, retain data per policy and show backlog/residual cost.

### Hibernate

Scale eligible workers/connectors to zero, disable subscriptions where safe, preserve approved recoverability, and report retained secret/storage/log/domain costs.

### Reactivate

Revalidate credentials, consent, provider/API compatibility, webhooks, mappings, backlog age, schemas, security and reconciliation before replay.

### Offboard

Export agreed integration definitions/history/evidence, revoke tokens, delete webhooks/provider resources, stop schedules, drain/quarantine according to policy, retain legal/audit records and reconcile residual cost.

### Purge

Separate irreversible approval; enforce retention/legal hold; delete tenant-specific connection data, tokens, subscriptions, payloads and infrastructure; verify provider-side and AWS residuals.

## 20. Connector certification

Certification scope binds:

- connector/version/digest;
- provider product/API/version/environment;
- capability and direction;
- auth/scopes;
- tenant/legal entity/country/region/deployment class;
- objects/events/files and mapping versions;
- volume/latency/backlog envelope;
- error/rate/retry/replay behavior;
- security/privacy/residency/retention;
- reconciliation and business outcome;
- operations/support/provider escalation;
- tests/evidence/approvers/expiry.

Required tests include auth grant/revoke/expiry, wrong-account denial, least-scope negative checks, pagination, rate limit, timeout, duplicate/out-of-order/missing event, schema change, large payload, Unicode/time zone/currency, partial batch, provider outage, replay, credential rotation, webhook renewal, tenant isolation, reconciliation, suspend/reactivate/offboard and rollback.

## 21. Stripe constitutional import

The connector registry must register Stripe capabilities, but implementation and activation require the entire Payments/Treasury/Stripe Bible. Binding defaults already chosen:

- Tenant legal entity is merchant/seller by default.
- Stripe/tenant carries processing fees and negative-balance risk where supported and contractually established.
- One tenant is not necessarily one connected account; legal entity and jurisdiction determine mapping.
- Simon clubs do not become artificial independent merchants; shared university/OSE merchant structure and internal subledgers are the safer baseline if Simon ever authorizes payments.
- Collections, embedded accounts, financial accounts, cards, multi-party splits, vendor/contractor payouts, tenant bank settlement, internal allocations, refunds, disputes, reserves, fraud, reconciliation and lifecycle are separately gated capabilities.
- Simon live payments remain off until institutional approval exists.

Never let a generic “Enable Stripe” toggle bypass these rules.

## 22. Required E2E proving scenarios

1. Microsoft/Google-style identity/productivity connection with consent and revocation.
2. SCIM create/update/deactivate with wrong-tenant and stale-event denial.
3. Slack/Teams-style notification delivery with rate limit and revoked destination.
4. External ERP two-tier master/transaction exchange with reconciliation.
5. Payroll provider export/result import with exact jurisdiction mode disclosure.
6. Stripe Connect account onboarding and test-mode direct charge under Payments Bible.
7. Bank statement/ISO payment chain distinguishing sent, accepted, settled and reconciled.
8. Manufacturing PLM product/BOM release and MES operation confirmation.
9. EDI order/acknowledgement/ASN/invoice with duplicate/out-of-order and partner exception.
10. Data warehouse export with schema evolution and regional policy.
11. Webhook signing-key rotation and subscription renewal without loss/duplicates.
12. Provider outage/backlog recovery with tenant fairness.
13. Tenant suspend/hibernate/reactivate/offboard/purge across credentials, webhooks, queues and residual cost.

## 23. Evidence-gated checklist

### INT-000 — Truth, boundary and ledger

- [ ] INT-000-001 — Inventory current internal events, APIs, queues, jobs, webhooks, files, credentials references, provider SDKs and connector claims.
- [ ] INT-000-002 — Map producer/consumer and actual traffic for every integration resource; identify orphan/producerless queues and false green alarms.
- [ ] INT-000-003 — Import every `INT-*` requirement into the canonical ledger.
- [ ] INT-000-004 — Establish domain ownership and prohibit direct connector table writes.
- [ ] INT-GATE-000 — Current integration truth and authority are evidenced.

### INT-010 — Canonical runtime

- [ ] INT-010-001 — Implement canonical objects, envelope, schemas, correlation, causation and lineage.
- [ ] INT-010-002 — Implement tenant-aware outbox/inbox, delivery and idempotency.
- [ ] INT-010-003 — Implement large-payload governed references, scanning, checksum and expiry.
- [ ] INT-010-004 — Implement async jobs, checkpoints, backpressure, retries, circuit breaking and DLQ worklists.
- [ ] INT-010-005 — Prove service restart, duplicate and partial failure preserve one business effect.
- [ ] INT-GATE-010 — Runtime is durable, traceable and tenant-safe.

### INT-020 — Connector SDK and registry

- [ ] INT-020-001 — Implement signed/versioned connector package and constrained SDK.
- [ ] INT-020-002 — Implement capability-first registry, lifecycle, exact availability and known limitations.
- [ ] INT-020-003 — Enforce egress, secret, event, tenant and resource constraints.
- [ ] INT-020-004 — Implement provider/API compatibility, deprecation and security suspension.
- [ ] INT-020-005 — Prove an unauthorized connector cannot access other tenants/secrets/domains.
- [ ] INT-GATE-020 — Only admitted connectors run.

### INT-030 — Auth, consent and credentials

- [ ] INT-030-001 — Implement supported OAuth/OIDC/service/mTLS/key/file authentication profiles.
- [ ] INT-030-002 — Implement secure callback/state/PKCE/account verification and least scopes.
- [ ] INT-030-003 — Implement credential broker/references, rotation, expiry, revoke and reauth worklists.
- [ ] INT-030-004 — Ensure secrets never appear in configuration, events, logs or evidence.
- [ ] INT-030-005 — Pass wrong-account, wrong-tenant, over-scope and revoked-consent negative tests.
- [ ] INT-GATE-030 — Auth and credentials are least-privilege and lifecycle-managed.

### INT-040 — Schemas, mappings and transformations

- [ ] INT-040-001 — Implement schema registry/version compatibility and provider change detection.
- [ ] INT-040-002 — Implement signed deterministic mapping/transformation packages and lineage.
- [ ] INT-040-003 — Implement reference resolution, quarantine, split/aggregate and large-volume checkpoints.
- [ ] INT-040-004 — Implement mapping migration, comparison, rollback and golden tests.
- [ ] INT-040-005 — Prove hostile transforms cannot access network/files/secrets/other tenants.
- [ ] INT-GATE-040 — Data meaning and lineage survive integration.

### INT-050 — Webhooks, files, APIs and events

- [ ] INT-050-001 — Implement signed/replay-safe webhook ingress and subscription lifecycle.
- [ ] INT-050-002 — Implement polling/watermarks with gap/overlap/clock-skew handling.
- [ ] INT-050-003 — Implement SFTP/HTTPS file exchange, manifest/control totals, encryption and retention.
- [ ] INT-050-004 — Implement API/event/stream patterns with versioned limits.
- [ ] INT-050-005 — Implement EDI/AS2 partner/channel envelope and acknowledgements where in scope.
- [ ] INT-GATE-050 — Every transport handles failure and lifecycle explicitly.

### INT-060 — Rate, errors and reconciliation

- [ ] INT-060-001 — Implement provider limit profiles, fairness, priority and adaptive backpressure.
- [ ] INT-060-002 — Implement stable error taxonomy and exception worklists.
- [ ] INT-060-003 — Implement safe replay with preview, authorization, idempotency and audit.
- [ ] INT-060-004 — Implement reconciliation policies and zero unexplained critical variance.
- [ ] INT-060-005 — Prove unknown outcomes do not cause blind duplicate business actions.
- [ ] INT-GATE-060 — Operational failure is contained, visible and reconcilable.

### INT-070 — Integration Studio

- [ ] INT-070-001 — Implement all thirteen Integration Studio surfaces.
- [ ] INT-070-002 — Generate connection setup from connector/configuration schemas.
- [ ] INT-070-003 — Implement save/resume, diff, preview, approval, canary and rollback UX.
- [ ] INT-070-004 — Pass WCAG 2.2 AA, themes, localization, density, keyboard and visual regression.
- [ ] INT-070-005 — Prevent credential values/payload secrets from appearing in Studio.
- [ ] INT-GATE-070 — Operators can configure and operate integrations professionally without provider consoles for routine work.

### INT-080 — Capability families and domain imports

- [ ] INT-080-001 — Create registry entries for all capability families in Section 7 without false availability.
- [ ] INT-080-002 — Bind pack integration requirements to eligible certified connector capabilities.
- [ ] INT-080-003 — Import the complete Payments Bible for Stripe; prevent generic-toggle bypass.
- [ ] INT-080-004 — Enforce Bedrock-only customer AI inference boundary.
- [ ] INT-080-005 — Enforce exact payroll, bank, healthcare, public-sector and regulated capability scopes.
- [ ] INT-GATE-080 — Integration breadth is cataloged and enabled only at proven depth.

### INT-090 — Certification and release

- [ ] INT-090-001 — Implement connector certification scope, evidence, expiry and re-certification triggers.
- [ ] INT-090-002 — Bind connector code/config/schema/mapping/tests/runbooks into immutable releases.
- [ ] INT-090-003 — Implement waves, canaries, tenant compatibility, hold, rollback and emergency suspension.
- [ ] INT-090-004 — Monitor official provider/API/security changes and affected tenants.
- [ ] INT-090-005 — Prove all thirteen E2E scenarios.
- [ ] INT-GATE-090 — Every active connector is certified and operationally owned for exact scope.

### INT-100 — Lifecycle, security and final proof

- [ ] INT-100-001 — Implement suspend, hibernate, reactivate, offboard and purge semantics.
- [ ] INT-100-002 — Verify token/webhook/provider/AWS residuals and costs after lifecycle operations.
- [ ] INT-100-003 — Pass tenant isolation across metadata, payloads, queues, caches, files, search, logs and support.
- [ ] INT-100-004 — Pass threat model, restore, DR, performance, volume and provider-outage tests.
- [ ] INT-100-005 — Produce final supported connector/capability matrix and every blocker/limitation.
- [ ] INT-GATE-100 — Integration Plane is production-ready only for exact evidenced capabilities.

## 24. Required repository deliverables

```text
docs/architecture/integration-plane.md
docs/architecture/connector-sdk-and-security.md
docs/architecture/integration-envelope-and-lineage.md
docs/architecture/provider-certification.md
docs/architecture/integration-lifecycle.md
packages/integration-contracts/
packages/connector-sdk/
packages/connector-registry/
packages/mapping-runtime/
connectors/
services/integration-control/
services/integration-runtime/
apps/system-studio/integrations/
tests/e2e/integrations/
evidence/integrations/
```

Adapt to the real repository and avoid duplicate systems.

## 25. Absolute definition of done

- Internal and external integrations share governed contracts and lineage.
- Connectors are capability-first, versioned, constrained, lifecycle-managed and exactly certified.
- Credentials/consent/scopes are safe and operationally renewable.
- Webhooks, APIs, events, files, EDI and high-volume flows handle duplicates, ordering, rate, outage and replay.
- All write paths reconcile business outcome; acknowledgements are labeled accurately.
- Integration Studio provides a complete saveable professional operator experience.
- Stripe imports and obeys the dedicated Payments Bible.
- Tenant lifecycle closes tokens, subscriptions, queues, data, provider resources and residual cost.
- All enabled capabilities pass security, isolation, recovery, performance and support evidence.

## 26. Prohibited shortcuts

Do not:

- equate authorization success with integration readiness;
- store or print credentials;
- use customer-supplied tenant identifiers as authority;
- last-write-wins financial/identity/authority conflicts;
- retry permanent or unknown-outcome writes blindly;
- treat DLQ age as somebody else's problem;
- let connectors write domain tables or ledger rows;
- make provider schemas canonical Tenure models;
- call sent/accepted/settled/reconciled equivalent;
- route customer records to external AI APIs;
- mark an integration available from a logo, SDK, sample or sandbox ping;
- reduce Stripe to a generic connector;
- leave webhooks, tokens, files or cost behind after offboarding/purge.

## 27. Required final Claude response

Report enabled connector capabilities and exact certified scope, runs/tests with failures/skips, security/tenant-isolation/reconciliation evidence, provider/API versions, secrets posture without values, deployed environments, E2E outcomes, lifecycle residuals/cost, unsupported catalog items, external blockers and rollback state.

Begin by inventorying current integration truth, then implement one complete vertical slice: capability requirement → eligible connector → secure authorization → mapped test data → idempotent delivery → acknowledgement/result → reconciliation → Integration Studio evidence. Do not expand the catalog until the slice passes.

## END CLAUDE CODE MASTER PROMPT

---

## Authoritative reference anchors

- Amazon EventBridge schema registry: <https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-schema-registry.html>
- AWS Step Functions retry/error handling: <https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html>
- AWS Secrets Manager rotation: <https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html>
- Stripe Connect platform architecture: <https://docs.stripe.com/connect>
- Stripe Connect embedded components: <https://docs.stripe.com/connect/supported-embedded-components>
- Atlassian OAuth 2.0 guidance: <https://developer.atlassian.com/cloud/confluence/oauth-2-3lo-apps/>
- Atlassian rate-limit guidance: <https://developer.atlassian.com/cloud/jira/platform/rate-limiting/>

