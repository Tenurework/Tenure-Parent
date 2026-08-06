# Tenure Universal Work Graph, Workspace Connector Cloud, and Relay Cross-App Action Bible

**Version:** 1.0  
**Date:** 2026-08-05  
**Status:** Binding domain extension to the Tenure Global Engine Constitution  
**Requirement prefix:** `WRK-*`  
**Runtime:** Tenure-owned AWS only  
**Audience:** Claude Code and all engineers implementing Tenure Parent, Relay, Integration Studio, Tenant Experience System, and certified connector packs  

---

## BEGIN CLAUDE CODE MASTER PROMPT

You are the principal collaboration-platform architect, enterprise integration architect, OAuth and application-security engineer, search/RAG engineer, distributed-systems engineer, enterprise records and privacy architect, product designer, accessibility lead, SRE, test architect, and hands-on implementation owner for the **Tenure Universal Work Graph and Workspace Connector Cloud**.

Build the governed AWS-hosted plane that lets authorized Tenure users and **Relay by Tenure** work across their existing communication, calendar, meeting, document, knowledge, project, CRM, IT-service, developer, data, and industry applications without making Tenure a loose collection of point-to-point plugins.

The product goal is not “show integration logos.” The goal is to remove repeated searching, copying, status chasing, re-explaining, and handoff loss while preserving source-system authority, tenant isolation, user consent, least privilege, privacy, records obligations, human approval, provider terms, and institutional memory.

Tenure must become the calm work layer over an organization’s approved systems. A user should be able to ask Relay to find relevant work, explain its source, prepare the next step, and—only with the correct authority—execute a typed external action. A tenant must be able to choose which systems, accounts, containers, users, objects, directions, and actions are allowed. The browser and model never receive provider refresh tokens or unrestricted provider SDK access.

This is an implementation Bible. It is not satisfied by a provider logo, an OAuth callback, a generic REST client, a demo notification, a one-time import, a vector index, or a mocked “connected” state.

## 0. Constitutional relationship and ownership

Read completely before material implementation:

1. Tenure Global Engine Constitution and Mandatory Document Graph.
2. Tenure Claude Code Unified Global Engine Master Prompt v3.0 or later.
3. Tenure Global Integration Ecosystem and Connector Certification Bible.
4. Tenure Tenant Experience System and Product UI/UX Bible.
5. Tenure Declarative Tenant Configurator and Deployer UX Bible.
6. Tenure Global System Architecture Bible.
7. Tenure People, Finance, Planning, Operations, Analytics, Payments, Pack Factory, and Simon Bibles where their objects or actions are involved.
8. Tenure Major App and Industry Connector Catalog and Certification Matrix.

This Bible owns:

- the universal external work graph;
- workspace connection and installation experience;
- Relay missing-connection cards and resumable connect links;
- cross-app discovery, citation, drafting, action, and follow-up semantics;
- external ACL mirroring and query-time authorization;
- content synchronization, deletion propagation, indexing, and provenance;
- workspace-provider pack contracts for Microsoft 365, Google Workspace, Slack, Zoom, Notion, Box, and subsequent providers;
- external-action risk, preview, approval, execution, receipt, compensation, and reconciliation;
- end-user Connection Center UX and Relay action UX.

The Integration Bible continues to own the shared connector SDK/runtime, canonical delivery envelope, authentication broker, webhooks, queues, mapping, retries, reconciliation, certification, and Integration Studio operator surfaces. Domain Bibles own the meaning and invariants of Finance, HCM, Planning, Operations, Payments, CRM, and other business records. This Bible may never let an external provider write a domain table or ledger directly.

## 1. Exact product promise

Tenure connects **the tenant’s Tenure workspace** to approved external systems. Tenure itself is not merely advertised as a connector and does not require customers to abandon their current workspace on day one.

For a capability that is connected and certified, an authorized user may:

- discover information across allowed sources from one Tenure search or Relay conversation;
- see where each fact came from, its freshness, and whether the source is still accessible;
- create drafts in Tenure without immediately changing an external system;
- review the exact recipient, container, object, fields, permissions, and consequences before a write;
- request approval or step-up authentication when policy requires it;
- perform a typed, bounded external action;
- receive an external receipt and linked Tenure audit record;
- reconcile ambiguous or failed outcomes rather than guessing;
- turn approved work outcomes into durable role/seat memory without copying private material indiscriminately.

For a capability that is **not connected**, Relay must not dead-end with a technical error. It must provide a contextual connection path:

```text
I can do this after Google Drive is connected.

Connect Google Drive
Access requested: files you choose, read-only
Managed by: you
Estimated setup: about 1 minute

Why Tenure needs this · Ask an admin instead · Choose another source
```

The `Connect` action is available only when the connector and requested capability are certified for the tenant’s region, plan, provider/API version, consent class, and security policy. Otherwise show `Ask an admin`, `Request this integration`, `Use file upload`, or `Not supported` truthfully.

“10x faster” is a benchmark target, not an unqualified claim. Measure task completion time, context switches, repeated explanations, search time, manual copy/paste, approval latency, errors, and handoff completeness against declared baseline scenarios.

## 2. Non-negotiable invariants

1. **AWS-only Tenure runtime.** All Tenure control, token, sync, graph, indexing, AI, action, audit, and evidence services operate in Tenure-owned AWS accounts and approved regions.
2. **Source authority remains explicit.** Gmail is authoritative for a Gmail message; Drive for a Drive file; Slack for a Slack message; Tenure for Tenure records unless an approved coexistence mapping says otherwise.
3. **No logo availability.** A provider is not available because a UI card, SDK, API key, OAuth handshake, or test webhook exists.
4. **Least capability and least scope.** Ask only for the scopes required by the selected feature and direction. Add scopes progressively when a user enables a new capability.
5. **Personal and organization connections are distinct.** A user-delegated mailbox is not an organization-wide mailbox; an admin connection is not personal consent.
6. **No raw tokens in browser, model, logs, prompts, events, URLs, screenshots, tickets, evidence, or configuration.**
7. **Relay is not an authorization authority.** It proposes typed actions. Server-side policy decides whether an action is allowed and what approval is required.
8. **Retrieved content is untrusted data.** Instructions inside email, chat, documents, transcripts, issues, comments, or webpages cannot override Tenure policy or become model instructions.
9. **External ACLs are preserved.** Search, RAG, preview, action, citation, and memory capture enforce the intersection of source access, current Tenure authority, tenant policy, purpose, retention, and legal constraints.
10. **No quiet bulk ingestion.** Users/admins select accounts, containers, time ranges, object types, directions, retention, and AI use. Direct messages, private channels, personal drives, private mailboxes, recordings, and transcripts are opt-in or excluded according to policy.
11. **Draft and commit are separate.** Generating an email, message, meeting, update, file, task, CRM note, or ticket does not send or create it.
12. **No ambiguous success.** External actions resolve to known completion, known rejection, retryable failure, compensating action, or `UNKNOWN_OUTCOME` requiring reconciliation.
13. **Deletion and revocation propagate.** Provider deletion, loss of access, revocation, retention expiry, and legal hold update graph/index state deterministically.
14. **Institutional memory is governed.** Durable seat memory cannot become a loophole that permanently retains a former employee’s private inbox, DMs, recordings, or inaccessible documents.
15. **Cross-tenant joins are impossible.** Connection, graph, search, cache, queue, webhook, token, action, and model boundaries carry and verify canonical tenant/cell/region context.
16. **Mass or consequential actions require humans.** Bulk messaging, external sends, calendar invites, permission changes, deletions, HR/finance actions, customer changes, exports, and destructive operations follow risk and approval policy.
17. **Provider policy is part of correctness.** Verification, marketplace approval, restricted scopes, terms, data-use rules, quotas, app-review status, and deprecation are release gates.
18. **Accessible, calm UX.** Nontechnical users see outcomes and plain-language access, not scopes and webhook jargon by default. Technical details remain available in a secondary disclosure.

## 3. Universal Work Graph

### 3.1 Purpose

The Universal Work Graph is a tenant-partitioned, authorization-aware graph of references and governed projections across Tenure and connected systems. It is not a second uncontrolled copy of every provider.

It enables questions such as:

- “What was decided about the supplier renewal?”
- “Find the latest budget file, the approval thread, and the meeting where the exception was agreed.”
- “Draft the response, attach the approved report, and create a follow-up task for the VP Finance seat.”
- “Which role owns the next step, and what context should transfer when the current person leaves?”

### 3.2 Canonical objects

Implement at least:

- `ProviderDefinition`
- `ProviderProduct`
- `ProviderCapability`
- `ConnectorPackage`
- `ConnectorRelease`
- `ExternalOrganization`
- `ExternalWorkspace`
- `ExternalAccount`
- `ExternalPrincipal`
- `ExternalGroup`
- `ExternalContainer`
- `ExternalObjectRef`
- `ExternalObjectVersion`
- `ExternalPermissionSnapshot`
- `ExternalShareLink`
- `ExternalMessage`
- `ExternalThread`
- `ExternalMailbox`
- `ExternalCalendar`
- `ExternalEvent`
- `ExternalMeeting`
- `ExternalRecording`
- `ExternalTranscript`
- `ExternalDocument`
- `ExternalFile`
- `ExternalKnowledgeItem`
- `ExternalTask`
- `ExternalProject`
- `ExternalIssue`
- `ExternalCustomerRecord`
- `ExternalServiceCase`
- `ExternalCodeArtifact`
- `WorkSubject`
- `WorkArtifact`
- `WorkConversation`
- `WorkDecision`
- `WorkCommitment`
- `WorkHandoff`
- `WorkRelationship`
- `SourceCitation`
- `SyncCursor`
- `SyncCoverage`
- `SyncObservation`
- `Tombstone`
- `IndexProjection`
- `ConnectionGrant`
- `ConsentGrant`
- `ResourceSelection`
- `PendingActionIntent`
- `ExternalActionPlan`
- `ExternalActionExecution`
- `ExternalActionReceipt`
- `ActionCompensation`
- `ConnectionOpportunity`
- `ConnectionLaunchToken`
- `ConnectionApprovalRequest`
- `ProviderLimitation`

Every external object reference records tenant, provider, product, provider tenant/workspace/account, object type, opaque external ID, canonical URL if safe, source owner, version/etag/revision, created/modified/deleted timestamps, classification, access snapshot, sync observation, retention, residency, lineage, connection, connector release, and freshness.

Do not use email address alone as identity. Resolve external principals through verified provider identifiers and a versioned identity-link record. Never merge identities automatically when ambiguity exists.

### 3.3 Relationships and provenance

Relationships are typed and directional, for example:

```text
message REPLIES_TO thread
message MENTIONS principal
message REFERENCES work-subject
meeting HAS_TRANSCRIPT transcript
meeting PRODUCED decision
decision CREATES commitment
commitment ASSIGNED_TO durable-seat
document SUPPORTS approval
task IMPLEMENTS commitment
customer-record RELATES_TO service-case
external-object PROJECTS_TO Tenure-record
Tenure-record SYNCS_TO external-object
```

Every inferred edge stores model/rule version, evidence citations, confidence, creation reason, review state, and expiry. Inferred edges cannot silently become authoritative business facts.

### 3.4 Projection, not indiscriminate replication

Support three data modes per capability/object/container:

1. `REFERENCE_ONLY` — provider ID, safe metadata, URL, freshness, and authorization reference.
2. `SEARCH_PROJECTION` — approved fields/content are indexed for authorized discovery and RAG.
3. `GOVERNED_REPLICA` — approved source content/version is retained for a defined business, legal, offline, migration, or continuity purpose.

Default to the least-retentive mode that satisfies the use case. A meeting title may be indexed while its recording is reference-only; a signed contract may be a governed replica; a private DM may remain excluded.

### 3.5 Work Graph state

Each projection follows:

```text
DISCOVERED
→ AUTHORIZED
→ FETCH_PENDING
→ CURRENT
→ STALE
→ REFRESHING
→ CURRENT
```

Exceptional states:

```text
ACCESS_REVOKED
SOURCE_DELETED
SOURCE_MOVED
SOURCE_UNKNOWN
RETENTION_EXPIRED
LEGAL_HOLD
QUARANTINED
CLASSIFICATION_BLOCKED
INDEX_FAILED
MAPPING_CONFLICT
```

Never answer as though a stale, deleted, inaccessible, or reconciliation-failed source is current. Show freshness and uncertainty.

## 4. Connection scope and authority model

### 4.1 Connection classes

- `USER_DELEGATED` — acts only as the consenting user and within provider/Tenure permissions.
- `ADMIN_DELEGATED` — administrator consents to selected organization capabilities but calls may still act as a named user.
- `APPLICATION_ORG_WIDE` — service/app identity accesses approved organization data; always admin-approved and narrowly resource-scoped where providers allow.
- `BOT_OR_APP_INSTALLATION` — provider-native bot/app installed in selected workspaces/channels/sites.
- `SERVICE_ACCOUNT` — nonhuman provider account with documented ownership and rotation.
- `WEBHOOK_ONLY` — inbound signed events without general read/write authority.
- `FILE_OR_FEED` — SFTP, object store, email drop, ICS, EDI, or managed file exchange.
- `PERSONAL_PRODUCTIVITY` — optional user-owned connection prohibited from tenant-wide use.

Connection class, provider consent, and Tenure authorization must all agree. Never turn a user token into organization-wide data access by iterating over discoverable resources.

### 4.2 Resource selectors

Every connection declares inclusions and exclusions:

- mailboxes, folders, labels, message types, send-as identities;
- calendars, event types, attendee domains, free/busy-only versus event detail;
- drives, sites, libraries, folders, files, MIME types, classifications;
- workspaces, channels, private/public state, DMs, threads, canvases;
- meetings, hosts, groups, recordings, transcripts, chat, webinars;
- Notion pages, teamspaces, databases/data sources, comments;
- Box enterprises, folders, hubs, metadata classes, collaborations;
- projects, boards, queues, repositories, organizations, CRM objects, environments;
- date/backfill range, event subscription, sync direction, update fields;
- AI search, summarization, drafting, action, memory capture, analytics, and training prohibition.

Selectors are versioned, diffable, previewable, approvable, and reconcilable. A selector expansion that exposes more people, objects, private containers, or historical data is a new consent/approval event.

### 4.3 System-of-record and sync direction

For every field/object capability declare one of:

```text
EXTERNAL_AUTHORITATIVE
TENURE_AUTHORITATIVE
BIDIRECTIONAL_WITH_FIELD_OWNERSHIP
REFERENCE_ONLY
ONE_TIME_IMPORT
ONE_TIME_EXPORT
EVENT_OBSERVATION_ONLY
```

Bidirectional sync requires per-field ownership, conflict policy, loop-prevention marker, idempotency, clock/version semantics, and reconciliation. “Last write wins” is forbidden for money, identity, permissions, HR, legal, compliance, approval, or other consequential data.

## 5. Missing-connection detection and instant connection links

### 5.1 Detection

When Relay receives an authorized request, the tool planner resolves required capabilities before attempting execution. It returns one of:

```text
CAPABILITY_READY
CAPABILITY_READY_READ_ONLY
CONNECTION_REQUIRED_USER
CONNECTION_REQUIRED_ADMIN
SCOPE_UPGRADE_REQUIRED
RESOURCE_SELECTION_REQUIRED
REAUTHENTICATION_REQUIRED
PROVIDER_ACCOUNT_REQUIRED
CONNECTOR_NOT_CERTIFIED
CONNECTOR_UNAVAILABLE_REGION
TENANT_POLICY_BLOCKED
ACTION_NOT_SUPPORTED
```

Do not leak existence of a connection, workspace, mailbox, channel, folder, or object that the user is not allowed to know about.

### 5.2 `ConnectionOpportunity`

Generate a server-side object containing:

- requested Tenure capability and action;
- preferred and alternative certified provider packs;
- tenant, environment, user/seat, legal entity, region, and plan context;
- connection class and required installer authority;
- minimal required scopes/capabilities;
- allowed resource-selection model;
- data/use/retention summary;
- risk class and required Tenure approval;
- original `PendingActionIntent` reference;
- expiration and one-time-use policy;
- safe return location.

Do not store raw user prompt content in the redirect URL.

### 5.3 Secure launch link

Relay renders a hyperlink to a Tenure-owned route such as:

```text
https://connect.tenurework.com/launch/<opaque-one-time-token>
```

The token is generated by the Connection Broker, signed, audience-bound, tenant-bound, user/session-bound when applicable, short-lived, single-use, nonce-protected, and redeemable only after current Tenure authentication. It contains no provider token, secret, email content, file name, raw prompt, or authorization code.

Flow:

1. User selects `Connect [provider]`.
2. If no current Tenure session, send to Tenure sign-in/sign-up and preserve only the opaque pending intent.
3. Re-evaluate tenant/user permission after authentication; never trust pre-login claims.
4. Show a plain-language access preview and advanced technical details.
5. If an admin is required, create an approval/install request with a shareable administrator link; do not ask a normal user to impersonate an admin.
6. Start provider authorization from the backend using authorization code flow, state, nonce, PKCE where supported/appropriate, exact redirect URI, and provider-required controls.
7. Exchange authorization code only on the backend.
8. Verify provider tenant/workspace/account and the consenting principal.
9. Present eligible container/resource selection.
10. Run least-impact capability tests and establish subscriptions/cursors.
11. Show exact connected scope and health.
12. Resume the original Relay request from `PendingActionIntent` after another policy check.
13. Expire or consume the connection launch token.

Provider sign-up may be offered as a separate official external link only when no account exists and provider terms allow it. Tenure must not imply it can create a third-party organization or complete commercial contracting. After provider sign-up the user returns to a fresh Tenure connection flow.

### 5.4 Connection card UX

Default card content:

- provider and capability, not just brand;
- concise benefit tied to the user’s current task;
- `Read`, `Draft`, `Send/Create/Update`, `Delete`, or `Admin` access summary;
- resource scope: “folders you choose,” “your mailbox,” “selected channels,” etc.;
- who manages it: `You`, `Tenant admin`, `Tenure-managed`, or `External admin`;
- setup expectation without false guarantees;
- primary action, safe alternative, and “Why is this needed?”;
- lifecycle status and known limitation when relevant.

Never use guilt, urgency, dark patterns, prechecked broad scopes, forced provider selection, or a single `Allow everything` choice.

## 6. Provider authorization and credential plane

### 6.1 OAuth and consent

Follow current provider specifications and OAuth security best current practice. Require:

- authorization code flow for interactive grants;
- PKCE where applicable and supported;
- exact registered redirect URIs;
- cryptographically random state tied to intent/session/tenant;
- nonce for OIDC identity assertions;
- no implicit grant or resource-owner-password grant;
- refresh-token rotation/reuse detection where supported;
- sender-constrained tokens where available and justified;
- separate dev/staging/prod applications and callbacks;
- verified publisher/brand and marketplace review where required;
- progressive, capability-scoped consent;
- admin-consent handling and documented least-privilege roles;
- disconnect/revoke and provider-side removal instructions;
- consent receipt containing purpose, scope, account, resources, policy, time, actor, app version, and expiry/review date.

Google sensitive/restricted scopes, Microsoft application/admin permissions, Slack marketplace/distribution rules, and each provider’s review requirements are explicit external gates. Do not broaden scopes merely to reduce implementation effort.

### 6.2 Token vault

Build a dedicated Connection Credential Broker. Provider client secrets, signing keys, and certificates use AWS Secrets Manager and KMS under narrow service roles. High-volume per-user refresh tokens use a threat-modeled, tenant/cell-partitioned token vault with envelope encryption, AWS KMS keys, authenticated encryption and context binding, immutable access audit, short-lived decrypted handling, rotation, deletion, and broker-only access. Do not create one expensive AWS resource per token without a cost and scale ADR.

The connector runner requests a short-lived access capability from the broker. It never reads a reusable refresh token. The broker verifies tenant, connection, connector release, capability, provider audience, requested scope, and policy.

### 6.3 Lifecycle states

```text
DRAFT
→ AUTHORIZATION_PENDING
→ ADMIN_APPROVAL_PENDING | USER_CONSENT_PENDING
→ CALLBACK_RECEIVED
→ ACCOUNT_VERIFIED
→ RESOURCE_SELECTION_PENDING
→ VALIDATING
→ READY
→ ACTIVE
```

Exceptional states:

```text
SCOPE_INSUFFICIENT
REAUTH_REQUIRED
ADMIN_RECONSENT_REQUIRED
PROVIDER_REVIEW_PENDING
PROVIDER_POLICY_BLOCKED
RATE_LIMITED
DEGRADED
SUSPENDED
REVOKED
EXPIRED
WRONG_ACCOUNT
WRONG_TENANT
SECURITY_HOLD
```

A provider callback does not skip account verification, selection, validation, approval, or activation.

## 7. Relay read, draft, and external-action contract

### 7.1 Tool separation

Each connector exposes independently certifiable typed tools:

- `search/read/list/get`;
- `draft/compose/prepare`;
- `create/update/send/share/delete`;
- `subscribe/sync/reconcile`;
- `admin/configure`.

A read grant cannot invoke a write tool. A draft tool produces a Tenure draft artifact; it does not call the provider. Tools declare input/output schemas, risk, side effects, idempotency, preconditions, policy checks, approval policy, compensability, rate cost, data classification, and audit fields.

### 7.2 Action risk classes

| Class | Examples | Default control |
|---|---|---|
| `A0_OBSERVE` | Search authorized metadata, read selected record | policy check; cite source |
| `A1_PREPARE` | Draft reply, proposed event, proposed task/update | no external side effect |
| `A2_REVERSIBLE_WRITE` | Create private draft, create non-notifying internal draft object | explicit user confirmation unless tenant policy preauthorizes |
| `A3_EXTERNAL_COMMIT` | Send email/message, invite attendees, publish page, create/update CRM/task/ticket | exact preview + human confirmation or approved workflow |
| `A4_PRIVILEGED` | Change access, share externally, install app, mass update, delete, admin action | step-up auth + role/SoD + approval |
| `A5_PROTECTED_DOMAIN` | HR, finance, payments, legal, safety, regulated records | owning domain Bible + human approval; Relay cannot final-authorize |

Tenant policy may make controls stricter, never weaker than provider/domain/legal requirements.

### 7.3 Action plan and preview

Before `A3+`, show:

- provider, account/workspace, and acting identity;
- exact target/recipient/container and visibility;
- fields/body/attachments/links that will be sent;
- whether recipients will be notified;
- sharing/permission impact;
- relevant Tenure record, role, workflow, and source citations;
- sensitive-data/DLP findings and redactions;
- idempotency and duplicate check;
- approval/step-up status;
- whether action is reversible and available compensation;
- expiration: re-preview after meaningful change or delay.

The confirmation is bound to a digest of the exact plan. A changed recipient, body, permission, attachment, target, or provider account invalidates prior approval.

### 7.4 Execution and receipt

On commit:

1. Recheck current user, seat, tenant, provider connection, source access, policy, consent, scope, and approval.
2. Lock or version-check the action plan.
3. Attach a Tenure idempotency key and provider-supported conditional/version token.
4. Execute through the connector runner.
5. Persist sanitized provider response, external ID, timestamps, version, acting identity, notification state, and correlation.
6. Verify observable business outcome when possible.
7. Reconcile later when a provider is asynchronous or ambiguous.
8. Produce a user-readable receipt and audit event.

Never let an LLM parse a generic provider SDK response and decide that the write succeeded.

### 7.5 Cross-app plans

A multi-app task is a resumable saga, not one unbounded agent loop. Each step has preconditions, authority, risk, idempotency, deadline, compensation, and receipt. Example:

```text
Find approved contract in Box
→ cite current version
→ draft renewal email in Outlook
→ human approves send
→ send email
→ create follow-up task in Asana
→ link both external receipts to Tenure vendor record
→ create role-memory handoff note after human review
```

If task creation fails after the email sends, do not resend the email. Surface partial completion and retry only the failed idempotent step.

## 8. Synchronization, events, and reconciliation

### 8.1 Sync modes

Support provider-appropriate combinations:

- webhook/change notification as hint;
- delta/history/change cursor for authoritative catch-up;
- bounded backstop polling;
- scheduled snapshot reconciliation;
- initial backfill with selectable time/object/resource scope;
- on-demand fetch for reference-only objects;
- outbound command with provider receipt;
- batch/file import/export.

Webhooks are not guaranteed truth. Acknowledge quickly, verify signature and replay protection, queue durably, fetch current state where required, and maintain a catch-up path for missed/expired subscriptions.

### 8.2 Core sync guarantees

- provider/account/connection/subscription identities are verified;
- pagination is complete and resumable;
- cursor expiry triggers bounded resync, not silent data loss;
- duplicates and out-of-order events produce one effective observation;
- moves/renames preserve identity where provider IDs remain stable;
- delete/tombstone and permission changes reach graph and indexes;
- loop-prevention metadata distinguishes Tenure-originated changes;
- attachments/large files use governed object references and malware scanning;
- provider time zones, recurrence, locale, Unicode, mentions, rich text, versions, and links remain semantically correct;
- rate limits are provider/account/tenant/capability aware;
- one noisy tenant cannot exhaust a shared provider quota;
- sync coverage and freshness are visible per selected resource.

### 8.3 Reconciliation

At minimum reconcile:

- selected versus discoverable resources;
- object counts and sampled/full hashes where permitted;
- current cursor/watermark and oldest unprocessed event;
- missing/extra/duplicate/divergent objects;
- source deletes and access revocations;
- active subscriptions and their expiry/renewal;
- outbound action plans versus provider receipts/current state;
- index projections versus current authorized source versions;
- institutional-memory items versus their governed provenance.

## 9. Authorization-aware search, RAG, and memory

### 9.1 Ingestion pipeline

```text
Provider observation
→ signature/account/tenant verification
→ resource-selection and policy check
→ metadata/content fetch
→ malware/active-content and DLP processing
→ canonical mapping and classification
→ source ACL snapshot
→ chunk/extract with immutable provenance
→ tenant/cell/region-scoped index
→ freshness/deletion/permission reconciliation
```

All parsing, OCR, embeddings, reranking, and model inference remain in the approved AWS-hosted boundary. External connector content cannot be routed to arbitrary external model APIs.

### 9.2 Query-time authorization

Candidate retrieval must filter before model exposure using current tenant, user, seat, source principal/group mapping, connection, object/container ACL, purpose, classification, retention, residency, legal hold, and policy. Revalidate sensitive source access when freshness or provider semantics require it.

Do not rely only on ACLs captured at ingest. Do not reveal snippets, titles, senders, channel names, file paths, counts, or “no results from private channel X” when the user cannot access them.

### 9.3 Citations

Every provider-grounded answer includes source provider, object title/type if authorized, author/owner when allowed, event/version time, last sync time, and a governed deep link. The user can distinguish source text, Tenure record, Relay inference, and human-approved memory.

### 9.4 Prompt-injection and malicious content defense

- Treat external text/HTML/markdown/rich text/transcript/OCR as data, never system or tool instructions.
- Strip or quarantine active content, hidden text attacks, malicious links, macros, and executable attachments according to policy.
- Separate content from instructions in model input.
- Apply tool allowlists and typed arguments after retrieval.
- Block secrets/system prompts/other records from being disclosed because a document requests them.
- Require action preview and server authorization regardless of content claims.
- Test indirect prompt injection, poisoned documents, malicious calendar invites, Slack messages, ticket comments, and transcript instructions.

### 9.5 Institutional memory capture

Relay may propose a `MemoryCandidate` from connected work. Human/policy review decides whether it becomes:

- a cited reference to the external source;
- a durable role process/decision/lesson with allowed facts;
- a restricted tenant record;
- an ephemeral personal note;
- rejected/no retention.

Separate durable organizational knowledge from private personal communications. Preserve provenance and correction/tombstone behavior. If the source disappears, the memory record must state what was retained, under what policy, and whether the source can still be verified.

## 10. Mandatory first connector-pack specifications

Each provider/product below is a separate capability pack with exact scopes, objects, actions, events, limits, deletion, reconciliation, certification, and region/account constraints. A family logo cannot hide a partial implementation.

### 10.1 Microsoft 365 / Microsoft Graph

Separate packs:

- `microsoft-outlook-mail`
- `microsoft-calendar`
- `microsoft-people-contacts`
- `microsoft-teams`
- `microsoft-sharepoint`
- `microsoft-onedrive`
- `microsoft-planner-todo`

Required semantics include delegated versus application permissions, user versus admin consent, Entra tenant verification, mailbox/site/team/drive selection, shared/delegated mailboxes, send-as/on-behalf-of, drafts versus send, threads/conversations, attachments, categories, event recurrence/exceptions, attendee response, time zones, online meetings, Teams chats/channels/messages/replies, SharePoint sites/lists/libraries, OneDrive drives/items/versions/shares, Planner/task ownership, delta queries, change notifications, subscription renewal, throttling, conditional requests, soft/hard delete, retention/eDiscovery boundaries, and external sharing.

Use change notifications as hints with delta query/backstop where supported. Do not request organization-wide application permissions when delegated or resource-specific access satisfies the use case. Show admin consent and application-access constraints explicitly.

### 10.2 Google Workspace

Separate packs:

- `google-gmail`
- `google-calendar`
- `google-drive-docs`
- `google-people-contacts`
- `google-meet`
- `google-chat`
- `google-tasks`
- `google-groups-directory` when approved

Required semantics include individual OAuth versus domain-wide delegation, Google Workspace customer/domain verification, sensitive/restricted scope review, Gmail messages/threads/labels/drafts/send/attachments/history and push-triggered partial sync, Calendar calendars/events/recurrence/instances/attendees/conferencing/free-busy/incremental sync, Drive My Drive/shared drives/files/folders/shortcuts/permissions/revisions/exports/changes/watch channels, Docs/Sheets/Slides export/metadata boundaries, Meet spaces/conferences/participants/recordings/transcripts where available and authorized, Chat spaces/messages/threads/memberships/events, People contacts, and directory/group access.

Domain-wide delegation is not a shortcut. It requires tenant admin authorization, explicit subjects/resources, narrow scopes, policy, audit, and use-case certification. Treat Gmail restricted data and provider data-use requirements as stop-ship gates.

### 10.3 Slack

Required packs/capabilities:

- workspace installation and identity;
- selected public/private channel discovery under granted membership;
- channel/message/thread reading;
- app mentions, shortcuts, actions, slash commands where enabled;
- draft and message posting;
- files/canvases/bookmarks/links only when separately scoped;
- user/group mapping and notification delivery;
- Events API or Socket Mode according to hosting/security ADR;
- webhook signature verification, retries, acknowledgement deadline, event IDs, and replay protection;
- cursor pagination and provider/distribution-specific rate limits;
- enterprise-grid/org/workspace distinctions;
- bot versus user token behavior;
- channel archive, app removal, scope change, and token revocation;
- private channels and DMs excluded by default.

Channel history and replies are separate capabilities. Do not assume marketplace, internal, and unlisted commercially distributed apps have identical limits.

### 10.4 Zoom

Separate packs:

- meetings/webinars;
- users/groups;
- meeting reports/participants;
- recordings/transcripts;
- chat/team chat when separately supported;
- phone/contact center only as separate high-sensitivity products;
- real-time media streams only under a dedicated privacy, consent, recording, and cost design.

Implement user OAuth versus server-to-server OAuth distinctions, account verification, host/group/resource selectors, meeting create/update/delete, registration, webhook validation, meeting instance UUID semantics, recording readiness/deletion, transcript availability, participant consent, retention, legal/jurisdictional recording rules, and provider subscription/event gaps. Never enable recording or real-time media simply because Relay can summarize it.

### 10.5 Notion

Required capabilities include OAuth/public connection versus tenant-managed internal connection, workspace identity, page/teamspace sharing to the integration, pages, blocks, databases and current data-source model, properties, comments, search limitations, file uploads/expiring URLs, pagination, API version pinning, capabilities, rate limits, webhook subscription verification, signature validation, event aggregation/delay, page/database/data-source/comment/file/view events, schema change, deletion/archival, and explicit resource sharing.

Do not imply the Notion API can see the entire workspace when pages have not been shared with the connection.

### 10.6 Box

Required capabilities include user OAuth and approved server authentication modes, enterprise/account verification, managed users/groups when separately authorized, files/folders/versions, metadata/templates/classifications, collaborations and roles, shared links, comments/tasks, search, content download/upload, hubs where supported, webhooks, user/enterprise event streams, event retention windows, legal hold/retention governance boundaries, and external collaboration allowlists.

Distinguish items owned by the current user/service account from enterprise-wide admin visibility. Do not infer webhook ownership or event coverage.

### 10.7 Baseline secondary workspace packs

Build as separate certified packs, never one generic adapter:

- Dropbox/Dropbox Business;
- Atlassian Jira and Confluence;
- Asana;
- Monday.com;
- Linear;
- ClickUp;
- Trello;
- Smartsheet;
- Airtable;
- Coda;
- Miro;
- Webex;
- RingCentral;
- DocuSign and Adobe Acrobat Sign;
- Egnyte and ShareFile where customer demand justifies them.

For each, implement provider-specific object models, install/grant classes, events or polling, resource selectors, rate limits, deletes, write risks, reconciliation, provider review, and E2E tests. The Major App Catalog owns prioritization and exact intended coverage.

## 11. High-value end-to-end work accelerators

Implement these as measurable, role-aware workflows over certified capabilities:

1. **Cross-app answer with citations:** Search allowed Tenure records, email, chat, docs, meetings, tasks, and knowledge; return a synthesized answer with source/freshness and access-safe deep links.
2. **Inbox to governed work:** Identify a relevant email/message, draft a response, propose a Tenure task/approval/request, require confirmation, send/create, and link receipts.
3. **Meeting lifecycle:** Find availability, propose time, create meeting only after confirmation, attach agenda/context, ingest approved transcript, extract decisions/actions, route review, update Tenure work, and capture eligible role memory.
4. **Approval notification:** A Tenure workflow emits a concise Slack/Teams/email notification; recipients act through an authenticated Tenure route; the external app is not the authorization authority.
5. **Document-to-process:** Find current document version, extract structured candidate data, show citations/confidence, let a human validate, then create a Tenure request/record without inventing missing fields.
6. **Work tracking synchronization:** Approved Tenure commitment creates/updates a Jira/Asana/Linear/Monday task with field ownership, loop prevention, comments/attachments policy, status mapping, and reconciliation.
7. **Customer/service continuity:** Gather permitted email/meeting/CRM/ticket history, propose next response, update Salesforce/HubSpot/ServiceNow/Zendesk only after confirmation, and preserve role-owned account context.
8. **Transition briefing:** Build a new seat-holder briefing from approved Tenure memory plus currently accessible external sources; exclude private predecessor material and show unresolved access gaps.
9. **Exception command center:** Correlate provider outage, failed sync, missing scope, stale index, and partial cross-app saga; propose precise remediation without retry storms or duplicate writes.
10. **Connection-on-demand:** A user asks for an unconnected task, receives the correct connect/admin/request card, completes the authorized flow, and resumes the exact task without retyping.

For each accelerator record baseline versus Tenure time, number of apps opened, clicks/steps, manual copies, wait time, error rate, completion, user trust, accessibility, and context retained.

## 12. AWS reference architecture

Use actual repository conventions and approved ADRs. The target logical services are:

### 12.1 Control services

- **Provider and Capability Registry** — provider products, API versions, certification, scopes, limitations, regions, install class, costs, and status.
- **Connection Control Service** — connections, selections, mappings, lifecycle, approvals, consent receipts, health, and tenant policy.
- **Connection Launch Service** — missing-capability evaluation, pending intents, single-use deep links, safe resumption.
- **OAuth/Authorization Broker** — provider auth start/callback, state/PKCE/nonce, token exchange, account verification, revocation.
- **Credential Broker/Vault** — token protection and short-lived access capabilities.
- **Subscription Manager** — webhook/change-notification creation, validation, renewal, expiry, deletion, and reconciliation.
- **Rate and Quota Governor** — provider/app/account/tenant/user/capability budgets, adaptive backoff, fairness, and circuit breaking.
- **Certification Service** — exact provider/API/capability/environment evidence and expiry.

### 12.2 Data and execution services

- **Webhook Edge** behind AWS WAF/API Gateway or equivalent, preserving raw bytes for signature verification and acknowledging only after durable acceptance.
- **Connector Runners** using Lambda for bounded event operations and ECS/Fargate for sustained/backfill/private-dependency workloads.
- **Sync Orchestrator** using Step Functions or equivalent resumable workflows.
- **EventBridge and SQS/DLQ** for tenant-aware routing, buffering, fairness, and failure isolation.
- **Canonical Work Mapping Service** with versioned deterministic transformations.
- **Universal Work Graph Service** using the approved relational/graph/search design; do not introduce a graph database without workload and operational evidence.
- **Content Pipeline** for governed fetch, scanning, parsing, OCR, chunking, classification, embedding, indexing, deletion, and ACL updates.
- **External Action Gateway** for typed plans, approvals, execution, receipts, compensation, and reconciliation.
- **Provider Reconciliation Workers** for snapshots, cursors, subscriptions, actions, and index/ACL parity.

### 12.3 AWS data stores

Use tenant/cell/region-partitioned stores according to the global architecture:

- Aurora PostgreSQL for canonical connection, graph metadata, action, mapping, reconciliation, and audit references where relational integrity is needed;
- DynamoDB for idempotency, nonce, cursors, high-scale token-vault metadata, leases, quota state, and ephemeral pending intents where justified;
- S3 for quarantined/approved large payloads and governed replicas with KMS, versioning, object lock only when required, lifecycle, and access points/presigned delivery;
- OpenSearch or the approved AWS search/vector layer for authorization-aware retrieval; indexes are disposable projections, not canonical truth;
- Secrets Manager and KMS for provider application credentials, certificates, signing material, and encryption controls;
- CloudWatch, X-Ray/OpenTelemetry, central audit/security accounts, and tenant-safe telemetry.

Never put all tenants’ webhook payloads, provider tokens, or indexed content into one unpartitioned global resource. Private connectivity, fixed egress IP, mTLS, or allowlisted endpoints are connector-specific deployment traits.

### 12.4 Isolation and noisy-neighbor control

Partition queues, concurrency, rate budgets, backfills, index writes, large-content processing, and action execution by cell/tenant/provider/capability. Enforce per-tenant maximums and weighted fairness. A massive Drive backfill cannot delay a payroll result, payment reconciliation, approval notification, or another tenant’s message.

## 13. Tenant and nontechnical user experience

### 13.1 Connection Center

Tenant-facing surfaces:

1. **My connections** — personal grants, capabilities, selected resources, last used, health, and disconnect.
2. **Organization connections** — admin-managed connections, owners, users/groups, approved containers, scope, and policy.
3. **Available capabilities** — outcome-first categories; provider second.
4. **Requests** — user requests for an admin to install/approve a connection or scope upgrade.
5. **Connected resources** — friendly selector and coverage/freshness summary.
6. **Relay access** — what Relay may search, summarize, draft, act on, or use for memory.
7. **Action history** — readable external-action receipts and approvals.
8. **Privacy and retention** — included/excluded data, retention, disconnect effect, export/delete request.
9. **Health and fixes** — plain-language reauth, scope, webhook, rate, provider outage, and admin-policy guidance.

### 13.2 Calm interaction principles

- Lead with user outcomes: “Find files,” “Draft email,” “Schedule meetings,” not API product names.
- Show one recommended safe setup with alternatives.
- Use progressive disclosure for scopes, object IDs, subscription type, cursor, API version, and logs.
- Preserve save/resume, back/forward, browser refresh, cross-device recovery, and draft history.
- Explain what changes when a setting changes; never silently erase selections.
- Use the Tenure Tenant Experience System’s forest-green accent, typography, tokens, density, form, card, table, status, and motion rules.
- Avoid connector logo walls, nested setup mazes, success confetti, alarming red everywhere, or repeated consent prompts.
- Provide keyboard operation, screen-reader semantics, clear focus, 200% zoom/reflow, high contrast, reduced motion, accessible status, long-string/localization/RTL, and mobile-responsive connection approval.

### 13.3 Status language

User language maps to exact states:

| User-facing | Technical meaning |
|---|---|
| `Ready` | certified capability active and healthy for selected scope |
| `Needs your attention` | user reauth/resource choice required |
| `Waiting for admin` | tenant/provider admin action required |
| `Limited` | read-only, partial resource, rate, region, or provider limitation |
| `Temporarily unavailable` | provider/Tenure degradation with safe retry policy |
| `Disconnected` | token/subscription revoked; no new access |
| `Not available yet` | connector/capability not certified; no fake connect action |

## 14. Security, privacy, compliance, and abuse controls

Threat-model at least:

- OAuth login CSRF, mix-up, redirect manipulation, code interception, token substitution, refresh-token theft/reuse, wrong-tenant installation, confused deputy, and malicious admin links;
- webhook forgery, replay, body reserialization, SSRF, oversized/compressed payloads, event floods, enumeration, and subscription hijacking;
- malicious files, archive bombs, macros, active content, unsafe previews, hidden instructions, and indirect prompt injection;
- overbroad organization-wide permissions, dormant tokens, orphan connections, departed owners, privilege changes, and provider group drift;
- cross-tenant queue/cache/index/token/graph/action leakage;
- DLP evasion through email, chat, file share, calendar invite, CRM note, issue attachment, and model output;
- mass-mail/spam/harassment, destructive bulk action, external share, recipient spoofing, meeting/recording privacy, and unauthorized surveillance;
- data retention conflicts, provider deletion, legal hold, eDiscovery, data-subject request, residency, and subprocessors;
- model hallucination, source confusion, stale source, malicious citation, unsupported action, and approval replay.

Controls include WAF/rate/size limits, signature verification over raw bodies, replay windows, opaque IDs, strict egress, URL/IP/DNS validation, tenant-bound encryption context, least IAM, no public buckets, token redaction, security findings, DLP, quarantine, immutable audit, support access approval, break-glass control, and regular revoke/offboard exercises.

## 15. Operations, provider change, and lifecycle

### 15.1 Provider compatibility

Continuously track provider API/version, SDK/runtime, scope, event schema, rate limit, auth/review, deprecation, outage, and terms changes. Each connector release declares supported versions and a provider-change owner. Contract tests run against fixtures and sanctioned sandboxes/test tenants. Security or provider-policy change can suspend only the affected capability while preserving safe reads or unrelated packs.

### 15.2 Observability

Metrics and traces include:

- connection funnel by non-sensitive state;
- auth/callback/account-verification failures;
- active/expiring/revoked grants and subscriptions;
- webhook acceptance/verification/lag/duplicates/replays;
- cursor age, sync lag, coverage, backfill progress, and deletion/ACL propagation;
- provider call rate, throttles, retries, circuit state, cost, and quota headroom;
- action plan/approval/execute/receipt/reconciliation outcomes;
- index freshness, authorization-filter rejection, RAG citation/freshness and injection-test outcomes;
- DLQ/exception age and ownership;
- tenant fairness and provider outage blast radius.

Never put message bodies, file contents, transcript text, email addresses, provider tokens, object names, or signed URLs into general telemetry.

### 15.3 Tenant lifecycle

- **Suspend:** stop new writes and schedules, preserve safe observation as policy allows, show backlog and cost.
- **Hibernate:** remove subscriptions when appropriate, scale eligible workers to zero, protect tokens or revoke according to policy, record restart requirements and truthful residual cost.
- **Reactivate:** revalidate app/provider versions, consent, credentials, scopes, selections, subscriptions, cursors, backlog age, mappings, ACL policy, and indexes before replay.
- **Offboard:** export agreed configuration/history/evidence, stop schedules, revoke tokens, delete subscriptions/provider artifacts, drain or quarantine, propagate source-retention policy, and reconcile residuals.
- **Purge:** separate irreversible approval; enforce legal hold/retention; delete token material, connection state, payloads, graph projections, indexes, pending intents, and tenant resources; verify AWS and provider-side residuals.

## 16. Performance, scale, reliability, and cost targets

Declare and test by capability/provider/tier:

- Relay capability resolution and ready/missing-connection response latency;
- connection-page and selector latency at enterprise resource counts;
- webhook durable acceptance latency and availability;
- sync freshness SLO and ACL/delete propagation objective;
- action execution and receipt latency with provider-degradation behavior;
- maximum provider/account/tenant backlog and recovery time;
- initial backfill throughput with fairness;
- search/RAG latency and citation completeness;
- provider quota headroom and cost per connected user/resource/synced object/action/indexed GiB.

Use synthetic enterprise scale: many tenants, hundreds of thousands of users, millions of resources, huge mailboxes/drives/channels, recurring events, shared drives/sites, private/public containers, provider outages, and throttling. Do not promise “real time” where provider event delivery or rate limits do not support it.

## 17. Required end-to-end proving scenarios

1. Relay asks for Drive content when no connection exists; user signs into Tenure, reviews read-only selected-folder access, authorizes Google, chooses one shared-drive folder, safe test passes, and original request resumes with a citation.
2. Same flow when Google admin policy blocks consent; Tenure creates an admin request and never loops OAuth.
3. Microsoft admin installs organization connection for selected SharePoint sites; an ordinary user cannot widen sites or application permissions.
4. Gmail/Outlook message search and draft reply work; sending requires a digest-bound preview; changing recipient invalidates approval.
5. Slack selected-channel history and thread reply survive rate limiting, duplicate events, app removal, and reinstallation without duplicate messages.
6. Teams notification routes user to authenticated Tenure approval; approval cannot be completed solely by reacting in Teams unless a separately certified signed action flow exists.
7. Google/Microsoft calendar handles recurring series, exceptions, time zones, organizer/attendee roles, conferencing, cancellation, and duplicate create prevention.
8. Zoom meeting ends; authorized recording/transcript event arrives; transcript is processed only after policy/consent and deletion propagates.
9. Notion page and database/data-source schema change arrive through verified webhooks; a stale mapping becomes a visible exception.
10. Box file permission is removed; Tenure search and Relay stop exposing title/snippet/content within the declared propagation objective.
11. A poisoned document instructs Relay to reveal secrets and send data; retrieval treats it as content, no secret/tool action occurs, and evidence is recorded.
12. Cross-app email→task saga partially fails after email send; retry creates only the missing task.
13. User disconnects personal account; tokens/subscriptions are revoked, pending actions fail safely, search projections become inaccessible, and retention policy is applied.
14. Tenant hibernates and reactivates after months; expired cursors/subscriptions trigger bounded reconciliation without duplicate business effects.
15. Provider API deprecation makes one write capability unavailable; catalog and Relay show exact limitation while unrelated read capabilities remain truthful.
16. Two tenants connect to the same provider product; adversarial IDs, webhook events, caches, indexes, and tool calls cannot cross tenant boundaries.
17. Departed employee’s personal mailbox access disappears; approved role memory remains only for explicitly retained, cited organizational knowledge.
18. Mass-send, external-share, permission-change, delete, HR, finance, and payment tool calls are denied or escalated according to risk and owning domain policy.

## 18. Evidence-gated implementation checklist

### WRK-000 — Truth and constitutional binding

- [ ] WRK-000-001 — Inventory every current provider logo, route, SDK, OAuth app, token, webhook, sync, index, Relay tool, external action, environment, and public integration claim.
- [ ] WRK-000-002 — Classify each exact provider/product/capability/direction as `PLANNED`, `DEVELOPMENT`, `CERTIFICATION_PENDING`, `AVAILABLE`, `DEGRADED`, `SUSPENDED`, or `UNSUPPORTED` with evidence.
- [ ] WRK-000-003 — Import every `WRK-*` requirement into the canonical execution ledger and document graph.
- [ ] WRK-000-004 — Bind this Bible to Integration, Tenant UX, Configurator, Relay, security, lifecycle, release, and owning domain Bibles.
- [ ] WRK-GATE-000 — No existing connector or AI capability is overstated.

### WRK-010 — Universal Work Graph

- [ ] WRK-010-001 — Implement canonical provider, workspace, account, principal, container, object, permission, relationship, citation, sync, tombstone, and action objects.
- [ ] WRK-010-002 — Implement typed provenance and inferred-edge confidence/review/expiry.
- [ ] WRK-010-003 — Implement `REFERENCE_ONLY`, `SEARCH_PROJECTION`, and `GOVERNED_REPLICA` policies.
- [ ] WRK-010-004 — Implement external identity linking without email-only or ambiguous automatic merges.
- [ ] WRK-010-005 — Implement graph state, freshness, deletion, access loss, quarantine, conflict, and reconciliation.
- [ ] WRK-010-006 — Prove graph/API/store/cache/search isolation under adversarial external IDs.
- [ ] WRK-GATE-010 — The Work Graph is tenant-safe, source-aware, minimal, and reconcilable.

### WRK-020 — Connection authority and selectors

- [ ] WRK-020-001 — Implement every connection class and prohibit class escalation.
- [ ] WRK-020-002 — Implement versioned include/exclude resource selectors and impact diffs.
- [ ] WRK-020-003 — Implement personal versus organization ownership, owner succession, and orphan recovery.
- [ ] WRK-020-004 — Implement field/object system-of-record and sync-direction contracts.
- [ ] WRK-020-005 — Require new approval/consent for meaningful selector or scope expansion.
- [ ] WRK-GATE-020 — Connections cannot exceed granted identity, resource, direction, purpose, or tenant authority.

### WRK-030 — Missing-connection and launch UX

- [ ] WRK-030-001 — Implement capability-resolution outcomes without leaking hidden connections/resources.
- [ ] WRK-030-002 — Implement `ConnectionOpportunity`, `PendingActionIntent`, and single-use `ConnectionLaunchToken`.
- [ ] WRK-030-003 — Implement Tenure sign-in/sign-up interruption and exact safe task resumption.
- [ ] WRK-030-004 — Implement user connect, scope upgrade, resource selection, reauth, ask-admin, provider-sign-up, request-integration, alternative-source, and unavailable paths.
- [ ] WRK-030-005 — Ensure uncertified capabilities never produce a working-looking OAuth button.
- [ ] WRK-030-006 — Test expired, replayed, wrong-user, wrong-session, wrong-tenant, tampered, and already-consumed launch tokens.
- [ ] WRK-GATE-030 — Relay turns missing access into a secure, honest, low-friction path.

### WRK-040 — OAuth, consent, and token security

- [ ] WRK-040-001 — Implement provider-specific authorization profiles using current secure flows, exact redirects, state, nonce, PKCE, backend exchange, and account verification.
- [ ] WRK-040-002 — Implement progressive scopes, user/admin consent, consent receipts, reconsent, revoke, and disconnect.
- [ ] WRK-040-003 — Implement provider review/verification/marketplace status as activation gates.
- [ ] WRK-040-004 — Implement Connection Credential Broker, KMS-bound token vault, short-lived runner capability, and broker-only refresh.
- [ ] WRK-040-005 — Prove browser/model/log/event/config/evidence never receive reusable provider secrets.
- [ ] WRK-040-006 — Test OAuth CSRF/mix-up/code interception/token substitution/wrong-account/confused-deputy and refresh-token theft/reuse cases.
- [ ] WRK-GATE-040 — Authorization is least-privilege, provider-compliant, revocable, and auditable.

### WRK-050 — Relay tools and external actions

- [ ] WRK-050-001 — Separate read, draft, write, sync, and admin tools with schemas and policy.
- [ ] WRK-050-002 — Implement action risk classes, immutable plan digest, preview, confirmation, approval, step-up, execution, receipt, compensation, and reconciliation.
- [ ] WRK-050-003 — Reauthorize at execution and invalidate approval after meaningful plan or authority change.
- [ ] WRK-050-004 — Implement idempotent cross-app sagas with partial-completion recovery.
- [ ] WRK-050-005 — Deny bulk, external-share, delete, HR, finance, payment, legal, safety, and privileged actions unless owning policies pass.
- [ ] WRK-050-006 — Prove the model cannot choose tenant, token, provider account, unchecked recipient, or unrestricted operation.
- [ ] WRK-GATE-050 — Relay accelerates work without becoming an autonomous authority.

### WRK-060 — Sync, events, and reconciliation

- [ ] WRK-060-001 — Implement webhook/change-hint, cursor/delta/history, backstop poll, snapshot, backfill, on-demand, outbound, and file/feed primitives.
- [ ] WRK-060-002 — Implement raw-body signature verification, replay defense, durable acceptance, subscription verification/renewal, and catch-up.
- [ ] WRK-060-003 — Implement pagination, cursor expiry, checkpoints, tombstones, moves, ACL changes, loop prevention, throttling, fairness, and provider outage recovery.
- [ ] WRK-060-004 — Implement coverage/action/index/ACL/subscription reconciliation with exception ownership.
- [ ] WRK-060-005 — Test duplicates, out-of-order, gaps, partial pages/batches, time zones, recurrence, Unicode, large files, and stale conditional writes.
- [ ] WRK-GATE-060 — Provider events and APIs converge to known source truth without duplicate business effects.

### WRK-070 — Search, RAG, citations, and memory

- [ ] WRK-070-001 — Implement AWS-hosted governed content pipeline and tenant/cell/region-scoped projections.
- [ ] WRK-070-002 — Enforce source ACL plus current Tenure/purpose/policy authorization before model exposure.
- [ ] WRK-070-003 — Implement freshness/source/inference distinctions and governed provider deep-link citations.
- [ ] WRK-070-004 — Implement deletion/access/retention/legal-hold propagation across graph, chunks, embeddings, caches, summaries, and citations.
- [ ] WRK-070-005 — Implement indirect prompt-injection, malicious-file, DLP, link, and tool-exfiltration defenses.
- [ ] WRK-070-006 — Implement governed `MemoryCandidate` review and private-versus-role-memory separation.
- [ ] WRK-GATE-070 — Relay answers are access-safe, cited, current enough, and memory-governed.

### WRK-080 — Microsoft 365 and Google Workspace

- [ ] WRK-080-001 — Implement and separately certify Microsoft Outlook Mail, Calendar, People, Teams, SharePoint, OneDrive, and Planner/To Do packs for declared capabilities.
- [ ] WRK-080-002 — Implement delegated/application/admin consent, tenant/account/resource verification, change notifications, delta/backstop, and Graph throttling/deprecation behavior.
- [ ] WRK-080-003 — Implement and separately certify Google Gmail, Calendar, Drive/Docs, People, Meet, Chat, Tasks, and approved Directory/Groups packs.
- [ ] WRK-080-004 — Implement Google user OAuth/domain-wide delegation boundaries, sensitive/restricted-scope external gates, history/incremental changes, watches, and shared-resource semantics.
- [ ] WRK-080-005 — Prove mail draft/send, calendar recurrence, sites/drives, shared/delegated resources, deletes, ACL changes, admin denial, and reauth end to end.
- [ ] WRK-GATE-080 — Microsoft and Google capabilities are available only at exact product/action/scope/resource certification.

### WRK-090 — Slack, Zoom, Notion, and Box

- [ ] WRK-090-001 — Implement Slack workspace/channel/thread/message/app-event packs with distribution-aware scopes and rates.
- [ ] WRK-090-002 — Implement Zoom meeting/webinar/report/recording/transcript packs with separate Phone/Contact Center/RTMS gates.
- [ ] WRK-090-003 — Implement Notion page/block/database/data-source/comment/search/upload/webhook packs with shared-resource and API-version semantics.
- [ ] WRK-090-004 — Implement Box file/folder/version/metadata/classification/collaboration/search/event/webhook packs with ownership/admin boundaries.
- [ ] WRK-090-005 — Test provider-specific event verification, pagination/rates, deletion/access loss, resource selection, app removal, and reconciliation.
- [ ] WRK-GATE-090 — The four named providers are engineered, not merely displayed.

### WRK-100 — Secondary workspace and work-management packs

- [ ] WRK-100-001 — Implement prioritized certified packs for Dropbox, Jira, Confluence, Asana, Monday, Linear, ClickUp, Trello, Smartsheet, and Airtable.
- [ ] WRK-100-002 — Implement prioritized certified packs for Coda, Miro, Webex, RingCentral, DocuSign, Adobe Sign, Egnyte, and ShareFile.
- [ ] WRK-100-003 — Bind exact provider packs to capability and industry requirements from the catalog; unbuilt packs remain `PLANNED`.
- [ ] WRK-100-004 — Prove every available secondary pack against the full certification contract, not a generic happy path.
- [ ] WRK-GATE-100 — Secondary connector breadth grows without weakening exact availability.

### WRK-110 — Experience and accessibility

- [ ] WRK-110-001 — Implement all Connection Center surfaces and calm status language in the Tenant Experience System.
- [ ] WRK-110-002 — Implement plain-language access previews, advanced details, resource selectors, scope changes, health/remediation, receipts, privacy, and disconnect.
- [ ] WRK-110-003 — Implement save/resume/back/forward/refresh/cross-device recovery and no-loss configuration history.
- [ ] WRK-110-004 — Pass WCAG 2.2 AA, keyboard, screen-reader, reflow/zoom, high-contrast, reduced-motion, localization/RTL, responsive, and realistic-density matrices.
- [ ] WRK-110-005 — Run nontechnical usability tests for connect, ask-admin, fix, disconnect, and action confirmation without provider-console knowledge.
- [ ] WRK-GATE-110 — Connector UX is fast, understandable, non-fatiguing, and truthful.

### WRK-120 — AWS, operations, cost, and lifecycle

- [ ] WRK-120-001 — Implement control, authorization, credential, subscription, quota, runner, sync, graph, content, action, and reconciliation services in Tenure-owned AWS.
- [ ] WRK-120-002 — Prove cell/tenant/region isolation, strict egress, least IAM, encryption, backup/restore, DR, and no global unpartitioned sensitive store.
- [ ] WRK-120-003 — Implement provider/tenant/capability SLOs, dashboards, alerts, runbooks, escalation, deprecation, recertification, and outage controls.
- [ ] WRK-120-004 — Implement cost allocation and budgets for tokens, provider calls, workers, queues, payloads, parsing, indexing, model use, backfill, and retained state.
- [ ] WRK-120-005 — Implement suspend, hibernate, reactivate, offboard, purge, and owner-departure behavior with residual-resource/cost reconciliation.
- [ ] WRK-120-006 — Run restore, provider outage, token compromise, webhook flood, stale ACL, poisoned content, and cross-tenant incident exercises.
- [ ] WRK-GATE-120 — The Workspace Connector Cloud is secure, operable, scalable, recoverable, and cost-accountable.

### WRK-130 — Acceleration proof and release

- [ ] WRK-130-001 — Implement all ten work accelerators for the exact connector capabilities selected for release.
- [ ] WRK-130-002 — Measure baseline/after time, context switches, manual copies, steps, wait, errors, completion, trust, accessibility, and handoff completeness.
- [ ] WRK-130-003 — Pass all eighteen required E2E scenarios plus provider-specific golden/negative/volume/failure suites.
- [ ] WRK-130-004 — Bind connector code, app registrations, scopes, policies, mappings, schemas, tools, prompts, tests, provider reviews, certification, evidence, runbooks, and rollback into one signed release.
- [ ] WRK-130-005 — Publish an exact supported capability matrix and every limitation/external blocker; remove or label false public/product claims.
- [ ] WRK-GATE-130 — Tenure may claim a cross-app acceleration only for measured, certified, supportable scope.

## 19. Required repository deliverables

Adapt to the real monorepo after discovery. Required logical outputs include:

```text
docs/architecture/universal-work-graph.md
docs/architecture/workspace-connector-cloud.md
docs/architecture/connection-credential-broker.md
docs/architecture/external-action-gateway.md
docs/security/workspace-connectors-threat-model.md
docs/security/provider-consent-and-scope-register.md
docs/experience/connection-center.md
docs/experience/relay-connection-and-action-cards.md
docs/operations/provider-change-and-recertification.md
docs/operations/workspace-connectors-runbooks/
packages/work-graph-contracts/
packages/external-action-contracts/
services/connection-launch/
services/provider-auth-broker/
services/credential-broker/
services/subscription-manager/
services/sync-orchestrator/
services/work-graph/
services/external-action-gateway/
apps/tenant/connections/
connectors/microsoft-365/
connectors/google-workspace/
connectors/slack/
connectors/zoom/
connectors/notion/
connectors/box/
tests/e2e/workspace-connectors/
tests/security/workspace-connectors/
evidence/workspace-connectors/
```

## 20. Absolute definition of done

This Bible is complete only when:

- every `WRK-*` requirement is imported and evidence-gated;
- the Work Graph and connection/action contracts are deployed and tenant-isolated;
- Relay can safely detect missing capability and resume through a certified connection flow;
- token, consent, selector, event, ACL, deletion, index, prompt-injection, action, and lifecycle controls pass;
- each visible provider/product/capability is truthfully classified;
- selected launch providers pass their exact connector-pack and E2E certification;
- all consequential external actions have server authority, exact preview, human/approval control, receipt, and reconciliation;
- nontechnical UX and accessibility pass with realistic scale and failure states;
- acceleration claims have measured baselines and reproducible evidence;
- release and rollback bind app registrations, code, scopes, policies, tools, tests, provider approvals, and operations.

## 21. Prohibited shortcuts

Do not:

- claim Slack, Outlook, Gmail, calendar, Drive, Teams, SharePoint, OneDrive, Zoom, Notion, Box, or any provider works because its name is in this document;
- expose provider credentials to Relay or client code;
- build one universal “OAuth connector” that erases provider semantics;
- request mail/drive/chat organization-wide read-write access for convenience;
- index a tenant’s entire external estate by default;
- use stale ingest-time ACLs as permanent authorization;
- treat webhook delivery as complete synchronization;
- let retrieved content issue instructions to tools;
- let Relay send, share, invite, publish, delete, install, or change external records without applicable confirmation/approval;
- store DMs/private mailboxes/recordings in role memory by default;
- retry an ambiguous external write blindly;
- hide partial completion of a multi-app saga;
- present planned integrations as connectable;
- call a connector complete without provider review/certification, production-like tests, operations, lifecycle, and rollback.

## 22. Required final Claude Code response

Report:

1. exact provider/product/capability/direction/region states;
2. connected resource and consent model without secrets;
3. code/config/IaC/app-registration/mapping/tool changes;
4. tests run with pass/fail/skip and provider sandbox/test-tenant evidence;
5. isolation, OAuth, webhook, ACL/delete, prompt-injection, DLP, action, and lifecycle evidence;
6. deployed environments and connector release digests;
7. acceleration benchmark results;
8. provider reviews, external approvals, limitations, and blockers;
9. cost/SLO/operations and residual risks;
10. rollback and next exact execution slice.

Begin by inventorying current truth and public claims. Implement one complete vertical slice—Relay missing capability → secure connect → selected authorized sync → cited answer → drafted action → confirmed external write → receipt → reconciliation → governed memory candidate—before expanding the provider catalog.

## END CLAUDE CODE MASTER PROMPT

---

## Authoritative reference anchors

Implementation must re-check current official provider documentation at build and certification time. Baseline anchors reviewed for this version:

- OAuth 2.0 Security Best Current Practice, RFC 9700: https://www.rfc-editor.org/rfc/rfc9700
- Microsoft Graph overview, delta query, change notifications, permissions and consent: https://learn.microsoft.com/graph/overview ; https://learn.microsoft.com/graph/delta-query-overview ; https://learn.microsoft.com/graph/change-notifications-overview ; https://learn.microsoft.com/entra/identity-platform/permissions-consent-overview
- Google OAuth production readiness and Workspace APIs: https://developers.google.com/identity/protocols/oauth2/production-readiness ; https://developers.google.com/workspace/gmail/api/guides/sync ; https://developers.google.com/workspace/calendar/api/guides/sync ; https://developers.google.com/workspace/drive/api/guides/about-changes
- Slack Events, Conversations, scopes, and rate limits: https://api.slack.com/events-api ; https://api.slack.com/docs/conversations-api ; https://api.slack.com/scopes ; https://api.slack.com/apis/rate-limits
- Zoom REST APIs and webhooks: https://developers.zoom.us/docs/api/ ; https://developers.zoom.us/docs/api/webhooks/
- Notion API, authorization, capabilities, webhooks, and limits: https://developers.notion.com/reference/intro ; https://developers.notion.com/guides/get-started/authorization ; https://developers.notion.com/reference/capabilities ; https://developers.notion.com/reference/webhooks ; https://developers.notion.com/reference/request-limits
- Box API, scopes, events, and webhooks: https://developer.box.com/reference/ ; https://developer.box.com/guides/api-calls/permissions-and-errors/scopes/ ; https://developer.box.com/reference/get-events/ ; https://developer.box.com/guides/webhooks/

