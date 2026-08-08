# Tenure Global Identity, Eligibility, Entitlement, Roster, and Access Continuity Engine

## Claude Code Implementation Bible

**Document ID:** TENURE-IER-1.0  
**Version:** 1.0  
**Date:** 2026-08-07  
**Status:** Binding domain Bible for roster-governed identity eligibility, population onboarding, access continuity, and SSO transition  
**Requirement prefix:** IER-*  
**Owning domains:** Identity Control Plane, Eligibility Engine, Roster Intelligence, Access Reconciliation  
**Pilot proving tenant:** Simon Business School Office of Student Engagement (OSE), Fall 2026  
**Product thesis:** The person changes. The seat remembers. Access follows verified present authority, not an email suffix.  

---

## BEGIN CLAUDE CODE IMPLEMENTATION BIBLE

You are the principal hands-on implementation owner for Tenure's Global Identity, Eligibility, Entitlement, Roster, and Access Continuity Engine.

Act simultaneously as a multi-tenant identity architect, access-governance architect, AWS Cognito engineer, SCIM implementer, data-model architect, privacy engineer, higher-education systems architect, HRIS/SIS integration engineer, policy-engine designer, security engineer, frontend engineer, QA lead, SRE, migration owner, and evidence owner.

This is an implementation Bible. It is not completed by writing a roster spreadsheet, adding a domain allowlist, creating a user table, mapping an IdP group, drawing a flowchart, generating interfaces, or checking boxes. Implement the capability in the one Tenure Parent global engine, connect it to the real authentication, tenant, organization, durable-seat, module, policy, audit, System Studio, integration, and lifecycle paths, deploy it to authorized non-production infrastructure, and prove it through deterministic tests and sanitized evidence.

The immediate Simon need is a controlled roster of pilot participants. The global product need is larger:

> Every Tenure tenant must be able to define which populations may enter a workspace, which modules and organizational scopes they may become eligible for, what authoritative facts determine that eligibility, how those facts arrive, how conflicts are resolved, how access changes over time, and how local Cognito users migrate to enterprise SSO without losing their Tenure person, seat, history, or workspace.

Simon is Tenant #1 and a proving configuration. Never encode student, school, club, Rochester, OSE, academic-program, or graduation-year assumptions in the platform core.

---

# 0. Mandatory document-graph integration

Before material implementation:

1. Read the latest non-superseded Tenure Global Engine Constitution and Mandatory Document Graph.
2. Read the latest Unified Global Engine Master Prompt and execution ledger rules.
3. Read the complete Global System Architecture Bible.
4. Read the complete AWS Cognito implementation and identity architecture.
5. Read the System Studio AWS Authoritative Control Plane Bible.
6. Read the Declarative Tenant Configurator and Deployer UX Bible.
7. Read the People, HR and Workforce Cloud Bible.
8. Read the ERP Archetype and Specialized System Pack Factory Bible.
9. Read the Global Integration Ecosystem and Connector Certification Bible.
10. Read the Universal Work Graph and Workspace Connector Cloud Bible.
11. Read the Tenant Experience System and Analytics Bibles.
12. Read the Simon OSE Tenant #1 Absorption Bible.
13. Read accepted ADRs, identity threat models, privacy rules, data classifications, migration contracts, tenant manifests, authorization catalogs, and evidence ledgers.

Add this Bible to:

- architecture-document-graph.yaml;
- capability-completeness-registry.yaml;
- the unified global execution ledger;
- the master requirement-prefix registry;
- the document completeness compiler;
- the implementation dependency DAG;
- release compatibility and tenant-wave evaluation.

The completeness compiler must fail when IER-* requirements are absent, duplicated with different semantics, marked complete without evidence, or omitted from the master execution system.

## 0.1 Ownership and precedence

| Concern | Owning authority |
|---|---|
| Authentication and federation | Cognito/Identity Control Plane |
| Person and external-identity resolution | Identity Control Plane |
| Source connector transport | Integration Plane |
| Worker master and employment facts | People Cloud or authoritative external HRIS |
| Student/constituent facts | Certified SIS/CRM/member source or governed roster import |
| Attribute schema and source trust | This Bible |
| Population and module eligibility | This Bible |
| Commercial module availability | Tenant entitlement and Pack Factory |
| Action/resource authorization | Central Tenure Authorization Service |
| Organizational authority | Durable seats, assignments, delegation, policies |
| System configuration and activation | System Studio/Configurator |
| Tenant administration experience | Tenant Experience System |
| Metrics and access-governance reports | Analytics Cloud |
| Simon-specific mappings and policies | Simon tenant overlay |

When documents overlap, apply:

1. Applicable law, contract, approved tenant policy, and protected human decisions.
2. Tenant isolation, privacy, security, safety, financial finality, and human approval invariants.
3. Global Architecture and Constitution.
4. This Bible for roster, source-trust, eligibility, and access reconciliation semantics.
5. The Identity Bible for authentication, sessions, and identity linking.
6. People or another domain Bible for canonical business facts.
7. Configurator/System Studio for authoring and activation.
8. Existing code only where it is proven sound.

Do not silently choose the easiest interpretation. Create an ADR and block only the conflicting scope.

---

# 1. The feature, not the workaround

The Simon request must not be framed as “we need an Excel file because SSO is unavailable.” It is the first use of a permanent Tenure platform capability:

## Population, Identity, and Access Eligibility

Every tenant configuration must include a governed step that answers:

- Who is in the tenant's eligible population?
- Which source is allowed to assert each fact?
- Which facts are required for login, workspace membership, module eligibility, organizational scope, workflow participation, or role candidacy?
- What effective dates, statuses, conditions, approvals, or training must be satisfied?
- What happens when data are missing, stale, conflicting, corrected, future-dated, or expired?
- How does Tenure authenticate the person now?
- How will the tenant change authentication later?
- How does a person retain the same Tenure identity and workspace through an IdP change?
- How are joiners, movers, leavers, graduates, alumni, contractors, temporary workers, volunteers, vendors, and guests handled?
- How are access decisions reviewed, explained, reconciled, revoked, restored, and audited?

The engine must support:

- manual governed entry;
- generated XLSX/CSV roster templates;
- encrypted file transfer;
- API and webhook ingestion;
- SCIM 2.0;
- HRIS, SIS, CRM, association-management, contractor, training, licensing, and directory sources;
- scheduled snapshots and incremental deltas;
- event-driven lifecycle updates;
- source coexistence during migration;
- tenant-defined industry packs;
- effective-dated policy evaluation;
- deterministic access reconciliation;
- enterprise SSO migration;
- multiple tenants, identities, affiliations, and simultaneous seats per person.

Excel is a bootstrap and batch-transport option, not the global source of truth and not a permanent architectural limitation.

---

# 2. Vocabulary and hard boundaries

These terms are not interchangeable.

| Term | Meaning | Does not mean |
|---|---|---|
| Authentication | Proof that the claimant controls an accepted identity | Tenant membership or authority |
| Identity routing | Selection of the correct tenant and authentication connection | Access grant |
| Person | Provider-independent human identity in Tenure | Email address or Cognito username |
| External identity | Verified connection + issuer + immutable subject | Matching email |
| Roster source | A governed source asserting population facts | Canonical permission store |
| Affiliation | Effective-dated relationship to a tenant or organization | Durable seat authority |
| Eligibility | Deterministic conclusion that a person may enter a population, module, or process if conditions are satisfied | Permission to perform every action |
| Tenant capability entitlement | A tenant's contracted/certified access to a module or capability | A user's access |
| Assignment | Effective-dated person-to-seat or person-to-scope placement | String role on a user |
| Authorization | Current decision for actor + action + resource + context | Authentication or eligibility alone |
| Access grant | Reconciled, reviewable product of eligibility, membership, assignment, entitlement, and policy | Permanent uncontrolled access |
| Institutional memory | Governed organizational knowledge associated with durable work/seat context | Private predecessor data |
| Source trust | Approved authority of one source for one attribute and population | Trust in every value from the source |

## 2.1 Three separate gates

For any action, Tenure must evaluate at least:

1. **Tenant capability gate:** Is this capability implemented, certified, deployed, enabled, and commercially entitled for this tenant, environment, jurisdiction, and population?
2. **Person eligibility gate:** Is this person currently eligible for the tenant, module, organization, or workflow based on authoritative effective-dated facts?
3. **Action authorization gate:** May this authenticated actor perform this exact action on this exact resource now, under active membership, seat, delegation, policy, separation-of-duty, assurance, and data-scope rules?

No single Boolean named enabled, active, role, member, or entitled may collapse these gates.

## 2.2 Decision outcomes

Eligibility outcomes:

- ELIGIBLE;
- CONDITIONALLY_ELIGIBLE;
- PENDING_EFFECTIVE_DATE;
- INELIGIBLE;
- SUSPENDED;
- EXPIRED;
- INDETERMINATE;
- MANUAL_REVIEW_REQUIRED.

Authorization outcomes:

- ALLOW;
- DENY;
- INDETERMINATE, which fails closed.

Unknown, null, not supplied, withheld, not applicable, and explicitly false are distinct values.

---

# 3. Binding invariants

1. Cognito authenticates or federates. Tenure owns person resolution, tenant membership, eligibility, durable seats, assignments, permissions, delegation, sessions, and audit.
2. Email domains route probable authentication and may be one eligibility input; they never grant membership, a role, a seat, or module authority by themselves.
3. A valid SAML/OIDC assertion proves authentication through an approved connection; it does not automatically grant Tenure access.
4. A row in a roster proves only what the approved source is authorized to assert.
5. A tenant must not request “all data.” It may collect only fields justified by an active purpose, policy, workflow, safety requirement, legal obligation, or explicit user-facing need.
6. Every collected attribute has an owner, purpose, source, classification, retention rule, allowed consumers, effective-date behavior, and deletion/correction path.
7. Sensitive or protected attributes are forbidden as ordinary access factors unless a specific lawful, necessary, documented, reviewed policy requires them and safer alternatives are insufficient.
8. Tenure never uses an LLM, embedding similarity, probabilistic model, or opaque risk score as the final decision maker for access.
9. The eligibility engine is deterministic, versioned, testable, explainable, deny-by-default, and safe when data are stale or unavailable.
10. Person, external identity, tenant membership, affiliation, seat, assignment, eligibility decision, and authorization decision are separate canonical objects.
11. A person can have multiple identities, emails, tenants, affiliations, concurrent assignments, historical assignments, and authentication methods.
12. Email is mutable. External identities are keyed by identity connection + verified issuer + immutable subject.
13. Accounts are never merged solely because emails match.
14. Ending eligibility or assignment removes current access without erasing history or eligible institutional memory.
15. Successor access comes from a new effective seat assignment and current policy, never inheritance of the predecessor's session or unrestricted personal data.
16. Every roster import is tenant-bound, idempotent, quarantined, validated, previewed, approved where required, activated, reconciled, and reversible.
17. Every source snapshot is immutable and checksum-addressed; corrections create new versions.
18. Every decision records policy version, source versions, safe reason codes, decision time, effective time, and reconciliation result.
19. Cross-tenant person correlation must never create cross-tenant business-data access.
20. Tenant A data, policies, source identifiers, identities, decisions, exports, indexes, caches, jobs, and evidence cannot be observed by Tenant B.
21. System Studio is the authoritative normal surface for defining sources, mappings, policies, activation, rollout, and evidence.
22. Tenant administrators operate only within delegated configuration and access-governance boundaries.
23. High-risk policy activation, privileged role mapping, mass revocation, and production source cutover require protected approval.
24. No tenant-specific source fork, hard-coded tenant ID, Simon program list, Rochester domain, or industry-specific branch enters platform core.
25. Simon's independent Cognito pilot identities must be able to transition to University SSO without changing Tenure person_id, memberships, seats, history, or workspace.
26. SCIM and SSO are separate: SSO authenticates; SCIM provisions lifecycle facts; Tenure authorization decides access.
27. Commercial entitlement, user eligibility, and authorization are named, stored, reported, and tested separately.
28. Every capability remains unavailable until its exact implementation, security, testing, deployment, rollback, support, and evidence gates pass.

---

# 4. Supported population patterns

The engine must model, without source forks:

- students, staff, faculty, alumni, admitted students, club members, and school officials;
- employees, contingent workers, contractors, interns, former workers, candidates, and service providers;
- nonprofit members, volunteers, officers, chapters, committees, and donors where relevant;
- government employees, appointees, contractors, agencies, jurisdictions, clearances, and duty stations;
- healthcare workforce, practitioners, facilities, credential status, training, and care-team context;
- manufacturing workers, plants, work centers, safety training, certifications, shifts, and operating roles;
- financial-services personnel, legal entities, branches, licenses, supervisory relationships, and separation-of-duty boundaries;
- suppliers, partners, customers, guests, external auditors, support personnel, and time-limited collaborators;
- users belonging to more than one tenant;
- users with more than one simultaneous affiliation or seat in one tenant;
- users who change email, department, program, legal employer, location, identity provider, or status.

Industry packs provide attribute definitions, source adapters, templates, policies, simulations, and evidence expectations. They do not create new identity engines.

---

# 5. Canonical capability architecture

Implement explicit boundaries equivalent to:

- PopulationSourceRegistry;
- RosterIngestionService;
- SourceSnapshotService;
- AttributeCatalogService;
- MappingAndNormalizationService;
- DataQualityService;
- PersonResolutionService;
- AffiliationService;
- EligibilityPolicyService;
- EligibilityDecisionService;
- AccessReconciliationService;
- IdentityRoutingService;
- IdentityLinkingService;
- AccessReviewService;
- ExceptionAndAttestationService;
- DecisionExplanationService;
- AuditAndEvidenceService.

These may begin in a modular monolith, but ownership and interfaces must be enforceable.

## 5.1 Required processing sequence

1. Register source and source owner.
2. Define allowed populations and attributes.
3. Bind every attribute to purpose, classification, trust, retention, and destination semantics.
4. Receive an immutable source snapshot or delta.
5. Quarantine and security-scan the payload.
6. Parse without executing active content.
7. Validate schema and file-level constraints.
8. Normalize values through versioned mappings.
9. Validate record quality.
10. Resolve records to existing people or create reviewable candidates.
11. Calculate effective affiliations.
12. Evaluate eligibility policies using a fixed source/version boundary.
13. Produce decision receipts and a before/after impact preview.
14. Obtain required approval bound to the exact digest.
15. Activate the source/policy version.
16. Reconcile membership, module eligibility, seats, sessions, and downstream access.
17. Revoke or create access deterministically.
18. Emit outbox events and audit evidence.
19. Monitor staleness, drift, failures, and expiring eligibility.
20. Reconcile against authoritative sources on a schedule and on demand.

No upload request may mutate live access before validation, impact preview, and the configured approval boundary.

---

# 6. Canonical data model

Adapt physical names to repository conventions, but preserve these semantics.

## 6.1 Source and schema objects

**PopulationSource**

- stable source_id;
- tenant_id;
- source type and provider;
- populations asserted;
- authoritative scope by attribute;
- owner, steward, support contact;
- environment and connector instance;
- trust tier;
- delivery mode and schedule;
- staleness threshold;
- legal/purpose basis metadata;
- retention and deletion policy;
- status and effective dates;
- health and last successful reconciliation;
- configuration version.

**AttributeDefinition**

- stable semantic attribute key;
- display name and tenant terminology;
- data type, format, allowed values, cardinality;
- subject type and population;
- purpose and allowed consumers;
- classification and sensitivity;
- source precedence;
- validation and normalization rules;
- effective-dating behavior;
- retention;
- policy-use permission;
- export/display/search/analytics permission;
- jurisdiction/industry-pack ownership;
- version and deprecation state.

**SourceSnapshot**

- immutable snapshot_id;
- tenant/source/config version;
- full snapshot or delta;
- source extraction time and received time;
- file/object digest;
- schema version;
- row, byte, accepted, rejected, duplicate, and unresolved counts;
- security-scan state;
- validation state;
- approval and activation state;
- prior snapshot;
- idempotency key;
- retention/destruction deadline;
- sanitized evidence pointer.

**SourceRecord**

- immutable record_id;
- snapshot and source;
- source-side stable person/object identifier;
- normalized identity hints;
- effective start/end;
- record status;
- row-level validation;
- safe error codes;
- resolution state;
- supersession chain;
- raw payload reference with strict retention, not unrestricted duplication.

**SourceAssertion**

- record;
- semantic attribute;
- normalized typed value or protected reference;
- source and confidence/trust class;
- valid time and system time;
- mapping version;
- verification/attestation state;
- conflict state;
- provenance.

## 6.2 Person and relationship objects

Reuse canonical Person, PersonEmail, ExternalIdentity, TenantMembership, OrganizationNode, DurableSeat, PositionAssignment, Delegation, Session, and AuditEvent objects from the identity and architecture Bibles.

Add:

**Affiliation**

- person and tenant;
- affiliation type;
- organization scope;
- source;
- status;
- effective start/end;
- eligibility-relevant facts;
- provenance and revision;
- historical correction chain.

**EligibilityPolicy**

- stable policy_id;
- tenant or global pack owner;
- target population/capability/module/scope;
- deterministic typed expression;
- required attributes and trusted sources;
- missing/stale/conflict behavior;
- effective dates;
- priority and explicit-deny rules;
- exception policy;
- test fixtures;
- version, digest, approver, activation state;
- rollback target.

**EligibilityDecision**

- decision_id;
- subject person/membership/affiliation;
- target tenant/module/population/scope;
- outcome and safe reason codes;
- policy version/digest;
- source snapshot and assertion versions;
- evaluation time and effective interval;
- stale/conflict indicators;
- decision revision;
- explanation visibility class;
- reconciliation status.

**AccessReconciliationAction**

- desired access state;
- current access state;
- proposed create/update/suspend/revoke action;
- reason and originating decision;
- affected memberships, modules, seats, sessions, groups, indexes, jobs, or credentials;
- risk class and approval requirement;
- idempotency key;
- attempt/retry/reconciliation state;
- completed time and receipt;
- compensation/rollback reference.

**PolicyException**

- exact subject, scope, policy, and reason;
- requested/approved actors;
- evidence;
- start/end;
- compensating controls;
- review date;
- non-renewal default;
- revocation state;
- audit.

**AccessReviewCampaign**

- population and scope;
- decision owner;
- snapshot boundary;
- reviewer assignments;
- certifications, removals, exceptions, escalations;
- completion evidence;
- next review date.

**TenantManagedPopulationEntry**

- stable entry_id;
- tenant and person/candidate;
- source class TENANT_MANUAL_ATTESTATION;
- entry class TEMPORARY or ONGOING;
- sponsor and authorized creator;
- exact business reason;
- population, module, organization, and requested scope;
- required seat assignment proposal, if any;
- effective start;
- mandatory end for TEMPORARY;
- mandatory review date for ONGOING;
- approval state and approvers;
- identity verification state;
- tenant commercial-seat impact class;
- current lifecycle;
- source and policy versions;
- revocation and conversion history;
- audit and evidence.

“Permanent” in tenant-facing language means ongoing until revoked and subject to periodic review. It never means irrevocable, immortal, or exempt from lifecycle reconciliation.

## 6.3 Temporal truth

Use valid time and system time where corrections and delayed feeds matter.

Tenure must answer:

- What did the source assert?
- When was it true in the source?
- When did Tenure learn it?
- Which mapping and policy version evaluated it?
- What access decision was made?
- When did the decision become effective?
- When was access actually reconciled?
- What was later corrected?

Do not destroy historical assertions by updating one mutable row.

---

# 7. Attribute catalog and data-minimization contract

The attribute catalog is not a dumping ground for every field a tenant possesses.

An attribute may be collected only when all are defined:

- exact business or security purpose;
- policy, workflow, display, routing, or reporting consumer;
- owning source and steward;
- data classification;
- minimum granularity;
- allowed population;
- effective-date semantics;
- validation;
- retention/deletion;
- correction path;
- user/admin visibility;
- export/search/analytics treatment;
- downstream event behavior;
- legal or contractual review when applicable.

## 7.1 Default categories

### Identity and contact

- tenant-approved stable source person identifier;
- verified work/institutional email;
- alternate verified identity handles only when needed;
- legal or preferred name at minimum required granularity;
- external issuer/subject after federation.

### Affiliation and lifecycle

- affiliation type;
- active/pending/leave/suspended/ended status;
- effective start/end;
- joiner/mover/leaver reason category where necessary;
- source updated timestamp.

### Organization and scope

- legal entity, institution, school, department, division, campus, site, location, chapter, club, project, cost center, team, or similar typed nodes;
- manager/sponsor/owner relationship where required;
- durable seat and assignment.

### Program or workforce facts

- program and cohort;
- expected graduation term;
- worker type;
- job/position profile;
- employment/contract status;
- shift/site;
- credential, training, license, or clearance proof status;
- jurisdiction or residence class only where required for the capability.

### Access-governance facts

- identity assurance;
- invitation/attestation state;
- access-review state;
- exception state;
- required training completed;
- separation-of-duty constraints;
- risk or privileged-access classification.

## 7.2 Sensitive and normally prohibited fields

Do not collect by default:

- Social Security or national identity numbers;
- passport or visa documents;
- full date of birth;
- home address;
- personal phone;
- personal email;
- grades, GPA, transcripts, financial aid, tuition, or academic discipline;
- medical, disability, counseling, accommodation, or insurance details;
- race, ethnicity, religion, sex, gender identity, sexual orientation, national origin, or political affiliation;
- biometric templates;
- bank, card, payroll, or tax details;
- background-check contents;
- union membership;
- passwords, recovery codes, private keys, or secrets.

If a legally valid specialized policy needs proof of a sensitive condition, prefer a narrow attestation such as training_valid=true or credential_status=active rather than the underlying diagnosis, document, or protected detail. Require privacy/security/legal review, strict scope, short retention, access logging, and an alternative/manual path.

Protected characteristics and their proxies must not be used to create discriminatory eligibility or access outcomes. Policy simulations must detect unexpectedly broad or disparate impact where a tenant's lawful governance requires that analysis; the engine must not infer protected classes.

## 7.3 Purpose-to-field compilation

System Studio must generate the minimum source contract from active policies.

If no enabled rule, workflow, display, support, or legal requirement consumes a field, the field is removed from the requested roster template. A tenant operator cannot select “collect everything.”

---

# 8. Source authority, precedence, and conflict

Classify sources by attribute and population, not with one blanket trusted flag.

Source roles:

- AUTHORITATIVE;
- SYSTEM_OF_RECORD;
- CORROBORATING;
- ATTESTED_BY_TENANT_ADMIN;
- SELF_ATTESTED;
- DERIVED_DETERMINISTIC;
- ADVISORY_ONLY;
- UNTRUSTED/QUARANTINED.

Examples:

- HRIS may be authoritative for employment status but not application permissions.
- SIS may be authoritative for active student status but not club office.
- OSE roster may be authoritative for club officer assignment but not University enrollment.
- IdP may be authoritative for issuer/subject and verified authentication claims but not Tenure seat authority.
- Training system may be authoritative for training completion.
- Professional registry may be authoritative for a license if the connector is certified.

## 8.1 Conflict behavior

Every attribute defines:

- source precedence;
- whether lower-priority assertions may fill a missing value;
- freshness tolerance;
- conflict threshold;
- manual review path;
- safety behavior;
- notification owner.

Conflicting authoritative sources never resolve through “last write wins.” High-risk access enters MANUAL_REVIEW_REQUIRED or fails closed. Corrections are effective-dated and preserve prior decisions.

## 8.2 Staleness

Each source defines expected cadence and maximum age.

- Low-risk module eligibility may have a documented grace period.
- Privileged, regulated, financial, payroll, production, or safety access fails closed or requires protected review when its source becomes stale.
- The UI must show source freshness and consequence.
- A stale-source fallback must be explicit, versioned, approved, monitored, and time-limited.

---

# 9. Ingestion architecture

Supported ingestion modes:

- System Studio manual record for bounded exceptions;
- tenant-admin entry through Roster Studio;
- generated XLSX template;
- generated CSV template;
- encrypted object upload;
- controlled SFTP;
- pull API;
- push API;
- signed webhook;
- SCIM;
- scheduled database/report extract through certified connector;
- HRIS/SIS/CRM/association-management connector;
- event stream;
- migration factory snapshot and delta.

The Integration Plane owns provider connectivity, credential references, rate limits, webhook signatures, retries, and connector certification. This engine owns population semantics, source trust, mapping, eligibility, and access reconciliation.

## 9.1 File-ingestion security

- Accept only configured formats and versions.
- Reject macro-enabled workbooks and active content.
- Enforce file, sheet, row, column, cell, and decompression limits.
- Malware-scan in quarantine.
- Parse with a maintained library in an isolated worker.
- Never evaluate formulas.
- Treat formula-looking cells as untrusted text and prevent CSV/formula injection in exports.
- Reject external links, embedded objects, unsupported types, hidden executable content, and password-protected files unless an approved secure workflow handles them.
- Normalize Unicode and detect confusable headers/identifiers.
- Validate headers against the signed template version.
- Do not place raw row values in logs or error telemetry.
- Encrypt at rest and in transit with tenant/cell-scoped controls.
- Use short-lived upload URLs and object namespaces.
- Destroy transient raw files according to the source contract and legal hold.

## 9.2 Import states

- CREATED;
- UPLOADING;
- QUARANTINED;
- SECURITY_SCANNING;
- PARSING;
- SCHEMA_INVALID;
- DATA_QUALITY_REVIEW;
- RESOLUTION_REVIEW;
- IMPACT_PREVIEW;
- AWAITING_APPROVAL;
- APPROVED;
- ACTIVATING;
- RECONCILING;
- ACTIVE;
- PARTIALLY_RECONCILED;
- FAILED;
- ROLLED_BACK;
- SUPERSEDED;
- RETAINED_FOR_HOLD;
- DESTROYED.

State transitions require actor, reason, timestamp, idempotency key, and audit.

---

# 10. Generated workbook contract

The global engine must generate a tenant-specific workbook from the configured population, policies, and attribute catalog. Do not maintain one universal spreadsheet containing every possible field.

## 10.1 Standard workbook sheets

| Sheet | Purpose |
|---|---|
| README | Tenant, template version, purpose, owner, permitted use, upload instructions, support, retention warning |
| DATA_DICTIONARY | Field definitions, allowed values, required conditions, examples, classification, source owner |
| PEOPLE | Minimum identity and lifecycle facts |
| AFFILIATIONS | Person-to-tenant and person-to-organization relationships |
| ORGANIZATION_NODES | Referenced schools, departments, clubs, entities, sites, chapters, teams, or projects |
| SEAT_ASSIGNMENTS | Effective-dated durable-seat assignments |
| MODULE_POPULATIONS | Optional explicit target populations or governed exceptions |
| ATTESTATIONS | Narrow time-bound proofs or approvals where configured |
| CHANGE_CONTROL | Snapshot ID, source extraction time, data owner, reviewer, certification, comments |
| ERRORS | Generated by Tenure on rejected rows; never part of the signed input |

Not every workbook includes every sheet. The template compiler includes only required sheets and columns.

## 10.2 Core PEOPLE fields

| Field | Requirement | Notes |
|---|---|---|
| source_person_id | Required | Stable opaque identifier from the approved source; never SSN |
| institutional_or_work_email | Conditional | Used for invitation and routing; must be normalized and later verified |
| given_name | Conditional | Minimum needed for user-facing identity |
| family_name | Conditional | Minimum needed for user-facing identity |
| preferred_name | Optional | Never replaces legal identity where legal name is required |
| affiliation_status | Required | Typed tenant-configured lifecycle value |
| effective_start | Required | ISO date/time semantics |
| effective_end | Conditional | Required for time-bound populations where known |
| source_updated_at | Required | Freshness and conflict control |
| source_record_version | Required | Idempotency and correction |

Additional fields appear only when an active policy needs them.

## 10.3 Validation behavior

- No merged cells in data sheets.
- One header row using stable keys, not display labels alone.
- Controlled values reference signed data-dictionary codes.
- Dates are ISO-formatted and interpreted in an explicit timezone.
- Leading zeros in IDs are preserved as strings.
- Blank, unknown, not applicable, and withheld use different controlled representations.
- No formulas.
- No macros.
- No hidden rows or columns.
- No embedded images or documents.
- Duplicate source IDs are rejected or explicitly versioned.
- Cross-sheet references must resolve within the snapshot or an active canonical object.
- Every row has provenance and effective time.

## 10.4 Import preview

Before activation, show:

- new people candidates;
- matches to existing people;
- ambiguous matches;
- new, changed, ended, and future affiliations;
- new, changed, ended, and overlapping seat assignments;
- eligibility changes by tenant/module/scope;
- access to create, retain, suspend, or revoke;
- active sessions affected;
- downstream search, file, report, connector, workflow, and Relay effects;
- policy exceptions and conflicts;
- quality errors and warnings;
- source freshness;
- exact digest, policy version, and rollback boundary.

Mass revocation or privileged grant previews require protected approval and a second reviewer.

---

# 11. Mapping, normalization, and person resolution

## 11.1 Mapping

Mappings are:

- versioned;
- typed;
- tenant/pack scoped;
- testable;
- effective-dated;
- reversible;
- source-attributed;
- approved before production activation.

Support:

- header mapping;
- value-code mapping;
- organization-node mapping;
- program/job/affiliation taxonomy mapping;
- effective-date transformation;
- source status to Tenure status;
- controlled defaulting;
- data quality rules;
- safe deterministic derived attributes.

No arbitrary user-supplied code executes in the mapping engine. Unknown values do not silently coerce to an allowed value.

## 11.2 Person resolution

Match in a safe precedence such as:

1. existing verified external identity tuple;
2. tenant-approved stable source person ID already bound to a person;
3. another high-assurance verified cross-reference;
4. high-assurance admin-approved link;
5. manual review.

Email may narrow candidates but cannot complete a merge by itself.

The engine must handle:

- changed name;
- changed email;
- recycled email;
- shared mailbox;
- duplicate source IDs;
- one person with multiple tenant memberships;
- one person in several source systems;
- rehire or returning student;
- merged source records;
- split identities;
- deleted/recreated directory accounts;
- wrong historical links.

Person merges and splits are protected, reversible operations with before/after impact, session revocation, audit, and downstream reconciliation.

---

# 12. Eligibility policy engine

Eligibility is a deterministic policy decision over typed, versioned facts.

## 12.1 Policy shape

A policy declares:

- policy ID, owner, scope, purpose, and target;
- subject population;
- required tenant capability entitlement;
- required attributes;
- accepted source roles and freshness;
- all/any/not conditions;
- effective-time semantics;
- conflict/missing/stale behavior;
- conditionally eligible requirements;
- exception path;
- review frequency;
- activation approval;
- test cases;
- explanation codes;
- rollback target.

Illustrative policy:

    policy_id: higher-ed.tenant-entry.v1
    target: tenant.workspace
    requires_tenant_capability: core.workspace
    subject: active_affiliation
    conditions:
      all:
        - affiliation.status in [ACTIVE]
        - evaluation_time within affiliation.effective_interval
        - identity.email.verified equals true
        - identity.route belongs_to tenant.approved_identity_routes
        - invitation.status in [ACCEPTED, NOT_REQUIRED]
    on_missing: INDETERMINATE
    on_conflict: MANUAL_REVIEW_REQUIRED

This policy establishes workspace eligibility. It does not authorize finance approval, personnel records, cross-club administration, or any other action.

## 12.2 Policy-language rules

- Use a typed declarative language, not arbitrary scripts.
- Validate every attribute reference against the catalog.
- Validate source trust and freshness at compile time and evaluation time.
- Prohibit network calls during decision evaluation.
- Prohibit nondeterministic time except the explicit evaluation clock.
- Prohibit hidden defaults.
- Prohibit LLM output as a condition.
- Cap expression complexity and evaluation time.
- Support policy linting, unit tests, property tests, and mutation tests.
- Support explicit deny and deny-overrides.
- Support effective dates, future activation, expiry, and staged rollout.
- Support tenant inheritance from signed pack templates with explicit overrides.
- Record a canonical digest for every version.
- Retain historical policy versions needed to explain past decisions.

## 12.3 Decision explanation

Provide layered explanations:

- End user: generic safe outcome and actionable next step without revealing tenant membership or sensitive policy.
- Tenant access admin: masked reason codes, source freshness, required remediation, and decision timeline.
- Authorized investigator/auditor: complete policy/version/source/evidence trace under purpose-based access.
- Platform operator: system health and technical failure without default access to tenant PII.

“Why allowed?” and “Why denied?” must be answerable without exposing another person, hidden resource existence, protected attributes, or raw source records.

---

# 13. Access reconciliation

Eligibility changes create desired access. Access reconciliation compares desired state to actual state across:

- tenant membership;
- module visibility;
- organization scope;
- seat candidacy or assignment;
- workflow participant lists;
- report populations;
- connector/resource grants;
- file/search indexes;
- Relay retrieval and tool scopes;
- sessions;
- API credentials/service accounts where relevant;
- notification subscriptions;
- cached decisions;
- background-job eligibility.

## 13.1 Joiner

- resolve or create provider-independent person;
- establish pending/active membership;
- issue controlled invitation or enable SSO route;
- require authentication and acceptance;
- assign configured organizations/seats only from authoritative approved facts;
- provision minimum module eligibility;
- record decision and receipts;
- do not grant dormant unneeded privileges.

## 13.2 Mover

- preserve person and history;
- effective-date old and new affiliations/assignments;
- preview gained and lost access;
- enforce separation of duties;
- revoke stale scopes;
- preserve eligible seat memory with the seat;
- reindex/recalculate authorized content;
- rotate session when active context changes materially.

## 13.3 Leaver, graduate, or ended affiliation

- end membership or change it to configured alumni/former/limited state;
- revoke active sessions promptly;
- revoke module, connector, search, file, workflow, Relay, and background access;
- preserve history and records under retention;
- initiate handoff for occupied durable seats;
- transfer eligible organizational content to the seat/successor, not personal credentials;
- remove or rotate application ownership and secrets through governed workflows;
- record reconciliation completion and unresolved external access.

## 13.4 Reinstatement

Reactivation is not an unconditional flip. Revalidate:

- current authoritative affiliation;
- identity connection;
- source freshness;
- policy version;
- prior person link;
- tenant lifecycle;
- assignments;
- separation of duties;
- stale external grants;
- session creation.

## 13.5 Emergency and exception access

Exceptions are:

- narrowly scoped;
- time-limited;
- reasoned;
- approved at the required assurance;
- monitored;
- non-renewing by default;
- revocable;
- included in access review;
- never used to disguise missing base policy.

Break-glass is a separate high-assurance path with alerting, after-the-fact review, and no permanent privilege.

---

# 14. Authentication and tenant-routing integration

## 14.1 Login discovery

Tenure may begin from:

- tenant-specific URL or verified domain;
- organization slug;
- signed invitation;
- prior secure session;
- work/institutional email used only as a routing hint;
- explicit tenant selection where safe.

The resolver:

- normalizes the input;
- resolves candidate tenant routes server-side;
- handles shared domains;
- returns only safe public configuration;
- creates an opaque, short-lived login transaction;
- prevents tenant and user enumeration;
- rate-limits abuse;
- prevents open redirects and tenant confusion.

A shared email domain such as rochester.edu cannot uniquely prove Simon/OSE access. Simon requires roster/invitation eligibility in addition to the domain.

## 14.2 Independent Cognito pilot

For tenants without SSO:

- public self-registration is disabled by default;
- account creation is invitation-only unless a reviewed policy explicitly allows another model;
- the invitation is bound to tenant and intended population;
- email ownership is verified;
- Cognito account state is not the canonical membership state;
- active Tenure eligibility is checked after authentication;
- recovery does not enumerate users;
- sessions are server-controlled and revocable;
- MFA and session policy follow the Identity Bible.

## 14.3 Workspace return

After authentication:

1. Resolve the external identity.
2. Resolve the stable Tenure person.
3. Load active memberships and eligibility.
4. Validate the tenant login transaction.
5. Validate current tenant/module/seat access.
6. Return to the last authorized workspace only if it remains allowed.
7. Otherwise show a safe workspace chooser or access-pending state.

Never trust a client-supplied tenant ID or prior URL to select an unauthorized workspace.

---

# 15. Enterprise SSO migration and identity linking

Tenants may start with local/invitation Cognito accounts and later activate SAML or OIDC.

The migration must preserve:

- person_id;
- tenant membership;
- affiliations;
- durable-seat assignments;
- approvals and audit;
- institutional memory;
- module history;
- user preferences where allowed;
- last authorized workspace;
- support and access-review records.

## 15.1 Safe link keys

Preferred link:

- verified identity connection;
- verified issuer;
- immutable IdP subject;
- tenant-approved stable directory/person identifier;
- pre-established binding to the Tenure person.

Do not auto-link solely on email.

If the tenant cannot supply a stable cross-reference, use a high-assurance migration flow:

1. User authenticates to the existing Tenure account.
2. User initiates “Connect organization SSO.”
3. Tenure creates a short-lived link transaction bound to person, tenant, session assurance, and expected IdP.
4. User authenticates through the new SSO.
5. Tenure validates issuer, subject, tenant connection, claims, and anti-replay controls.
6. Any conflict enters manual review.
7. Link activation revokes/rotates sessions and emits evidence.
8. The old login method remains or is disabled according to the approved migration wave and rollback plan.

AWS Cognito AdminLinkProviderForUser may be used inside the Cognito adapter only after Tenure has completed the trusted identity-resolution decision. The AWS operation does not replace Tenure's person-linking evidence.

## 15.2 Migration waves

- discovery and attribute contract;
- test IdP and non-production users;
- pre-link high-confidence users;
- pilot cohort;
- hybrid period;
- SSO preferred;
- SSO required;
- local-login disablement;
- rollback window;
- old-method retirement.

Each wave has counts, exceptions, failed links, duplicate profiles, support plan, session behavior, rollback, and approval.

## 15.3 IdP claim rules

- Allowlist claims.
- Normalize types and namespaces.
- Treat group/role/title/program claims as mapped inputs.
- Never grant privileged Tenure authority directly from arbitrary group text.
- Detect claim drift.
- Require expected issuer, audience, recipient, destination, time, signature, nonce/state, and connection.
- Store raw assertions/tokens only transiently when technically necessary; never log them.
- Update mutable profile facts without changing immutable identity binding.

---

# 16. SCIM and lifecycle integration

SCIM is an optional lifecycle transport, not Tenure's authorization system.

Implement a tenant-bound SCIM 2.0 boundary supporting the certified scope of:

- Users;
- Groups where configured;
- filtering;
- pagination;
- ETags/versioning;
- POST, PUT, PATCH, GET, DELETE/deactivate semantics;
- externalId mapping;
- active state;
- idempotency;
- standardized errors;
- rate limiting;
- token/credential rotation or stronger approved authentication;
- audit;
- provider interoperability fixtures.

SCIM group membership maps through a versioned policy to affiliation, role candidacy, or a bounded assignment proposal. It never bypasses Tenure membership, eligibility, seat, approval, or separation-of-duty rules.

## 16.1 Source coexistence

An IdP directory may not contain academic program, legal-employer, training, license, club, cost-center, or seat facts. Support multiple sources:

- SCIM for user lifecycle;
- SIS/HRIS for canonical affiliation;
- OSE/tenant roster for local organizational assignments;
- training/licensing systems for conditions;
- Tenure for durable-seat and authorization truth.

Field-level precedence resolves facts. One source cannot overwrite fields it does not own.

## 16.2 Deprovisioning

SCIM active=false or equivalent:

- suspends the external identity or membership according to mapping;
- invalidates sessions promptly;
- recalculates eligibility;
- reconciles access;
- preserves history;
- does not erase a person;
- does not delete legally retained records;
- cannot affect another tenant's membership.

---

# 17. Module, workflow, and data-scope eligibility

Tenant entry is only the first eligibility level.

The engine must support:

- workspace eligibility;
- module eligibility;
- feature eligibility;
- organizational scope;
- workflow participation;
- report audience;
- seat candidacy;
- privileged-access candidacy;
- connector/resource access eligibility;
- geographic/jurisdiction eligibility;
- environment eligibility;
- time-window eligibility;
- training/license/clearance-conditioned eligibility;
- device or authentication-assurance conditions where owned by authorization.

Examples:

- Active student + approved pilot roster may enter Simon.
- Active club membership may expose club collaboration surfaces.
- Current finance VP seat may authorize finance-request creation within that club.
- President seat may approve defined club requests but cannot self-approve a request they created if policy forbids it.
- OSE administrator seat may view configured cross-club summaries without unrestricted personal records.
- Employee status may permit HCM self-service, while HR case access requires a separate seat and purpose.
- Factory assignment plus current safety training may permit work-order execution at a site.
- Professional license status may permit a regulated workflow, while raw license documents remain restricted.

UI navigation derives from current semantic entitlements and authorization hints, but servers independently enforce every action and data query.

---

# 18. System Studio and Roster Studio

Add a mandatory tenant-configuration domain named **Population, Identity, and Access Eligibility**.

It appears after tenant/legal organization and before final identity/module activation, with dependency-driven revisit when modules or organizational structure change.

## 18.1 Configuration steps

1. Define populations.
2. Select source systems and ingestion modes.
3. Declare source owners and trust by attribute.
4. Select industry pack and attribute catalog.
5. Configure minimum source contract.
6. Configure mapping and allowed values.
7. Configure person-resolution keys.
8. Configure tenant/workspace eligibility.
9. Configure module and organizational eligibility.
10. Configure identity routes and approved domains.
11. Configure invitation/JIT behavior.
12. Configure SSO transition plan.
13. Configure SCIM and lifecycle sources.
14. Configure staleness/conflict/failure behavior.
15. Configure access reviews, exceptions, and attestations.
16. Generate template/connector contract.
17. Simulate with synthetic data.
18. Preview data, security, privacy, cost, operational, and access effects.
19. Obtain digest-bound approval.
20. Activate and monitor.

## 18.2 Operator views

System Studio provides:

- source inventory and health;
- attribute catalog;
- population graph;
- mapping editor;
- source-authority matrix;
- policy editor and linter;
- synthetic policy simulator;
- import preview and error workbench;
- person-match review;
- access-impact diff;
- access-reconciliation status;
- SSO migration dashboard;
- SCIM health and deprovisioning latency;
- access-review campaigns;
- exception register;
- evidence, rollback, and audit;
- privacy/retention status;
- tenant/module coverage.

## 18.3 Tenant-admin Roster Studio

Tenant administrators may:

- download the current signed template;
- upload a governed snapshot;
- correct validation errors;
- review only their authorized population;
- resolve permitted organization mappings;
- approve low-risk changes within delegated bounds;
- view expiring access;
- attest specific assignments;
- run access reviews;
- request exceptions;
- see safe decision explanations.

They may not:

- change platform invariants;
- grant themselves privilege;
- select arbitrary protected attributes;
- execute code;
- bypass separation of duties;
- activate a high-risk policy without required approval;
- see another tenant;
- reveal Cognito tokens, SAML assertions, secret values, or raw restricted data.

## 18.4 Tenant-managed internal additions

Every tenant may configure a governed internal-addition path for people who are missing from the scheduled authoritative feed, such as a newly elected officer, approved guest, contractor, temporary worker, volunteer, incoming student leader, auditor, or emergency replacement.

This is a permanent global feature, not a hidden admin workaround.

An authorized tenant administrator may propose an addition only by supplying:

- person identity or a controlled invitation target;
- population type;
- TEMPORARY or ONGOING classification;
- sponsor/accountable owner;
- reason;
- organization and module scope;
- intended durable seat/position, if applicable;
- start time;
- end time for TEMPORARY;
- review date for ONGOING;
- required attestations;
- requested identity route;
- approval evidence.

The record is tagged:

- source=TENANT_MANUAL_ATTESTATION;
- created_by and sponsored_by;
- entry_class=TEMPORARY or ONGOING;
- source_trust and fields the source may assert;
- effective interval;
- review/expiry state;
- commercial-seat impact.

Lifecycle states:

- DRAFT;
- PENDING_IDENTITY;
- PENDING_APPROVAL;
- PENDING_ENTITLEMENT_APPROVAL;
- INVITED;
- ACTIVE;
- SUSPENDED;
- EXPIRED;
- REVOKED;
- SUPERSEDED_BY_AUTHORITATIVE_SOURCE.

Manual addition never pretends to be an HRIS, SIS, directory, licensing, or other authoritative source. It may establish a tenant-governed local affiliation or assignment only within the policy scope that accepts TENANT_MANUAL_ATTESTATION.

### TEMPORARY

- requires an end date;
- has a configured maximum duration;
- expires automatically;
- sends reminders to sponsor and access owner;
- cannot silently convert to ongoing;
- requires new approval to extend;
- revokes sessions and reconciles access at expiry.

### ONGOING

- has no predetermined end date but is never irreversible;
- requires a periodic review/recertification date;
- remains subject to source changes, tenant lifecycle, module entitlement, policy, suspension, and revocation;
- may be superseded by an authoritative source record;
- cannot grant privileged access without the required seat assignment and approval.

### Reconciliation with later authoritative data

If the person later appears in SIS, HRIS, SCIM, or another approved source:

1. Resolve to the same person without email-only merge.
2. Compare manual and authoritative assertions field by field.
3. Preserve provenance.
4. Supersede or retain the manual entry according to policy.
5. Re-evaluate eligibility.
6. Avoid double-counting one person for the same commercial metric.
7. Record the resolution.

## 18.5 Commercial seat usage and Tenure notification

Tenure uses the word “seat” for a durable organizational position. Commercial contracts may also count licensed users, active members, module users, named users, monthly active users, or another metric. The schema, APIs, UI, events, and reports must name these separately.

Examples:

- durable_seat: Club Finance VP;
- active_tenant_member_count: people with active Tenure tenant membership;
- licensed_named_user_count: contract-defined named users;
- module_eligible_user_count: people eligible for a module;
- provider_mau_count: external provider's monthly active users;
- billable_access_seat_count: exact tenant contract metric.

A tenant-managed addition triggers a privacy-minimized control-plane usage event containing:

- tenant ID;
- event and effective time;
- metric key;
- prior and new count;
- entitlement/contract limit;
- threshold or overage state;
- source class;
- population/module class where contractually relevant;
- decision and reconciliation IDs;
- no name, email, or raw roster record unless an authorized support case specifically requires it.

Tenure's account/operations view must be notified when:

- a count increases or decreases;
- 80%, 90%, 100%, or configured threshold is crossed;
- a proposed addition exceeds the tenant's entitlement;
- duplicate resolution corrects a count;
- temporary access expires;
- an ongoing entry misses review;
- import or SCIM reconciliation changes commercial usage materially.

Contract policy determines whether an over-limit addition is:

- allowed within a documented grace/overage band;
- placed in PENDING_ENTITLEMENT_APPROVAL;
- restricted to non-billable approved guest scope;
- denied with a request-to-expand path.

Tenure must not:

- silently auto-charge;
- silently grant beyond entitlement;
- block emergency safety access solely for billing without the approved emergency path;
- expose a person's identity in routine usage notifications;
- count the same person twice for the same contract metric;
- count a durable organizational seat as a licensed person unless the contract explicitly defines that metric;
- let a tenant admin change contract limits.

Every count must be reproducible from an effective-dated metric definition and source records. Commercial metering is auditable, correctable, and reconciled with billing; it is not inferred from UI rows.

---

# 19. Simon OSE Tenant #1 configuration

Simon proves the global engine; it does not define it.

## 19.1 Current pilot authentication

Until University SSO is approved:

- use Tenure's AWS Cognito invitation-only authentication;
- accept only configured University email domains as identity-routing inputs;
- require an approved OSE pilot roster;
- require verified email ownership;
- require active effective-dated Tenure membership;
- disable public self-registration;
- use MFA/session/recovery controls from the Identity Bible;
- deny unknown or uninvited users with generic messaging;
- preserve exact audit and access-review history.

A rochester.edu or simon.rochester.edu address alone is insufficient because the domain is shared with people outside the pilot population.

## 19.2 Simon minimum roster contract

Request only fields needed by confirmed pilot policies.

### PEOPLE

| Field | Simon purpose | Required |
|---|---|---|
| source_person_id | Stable OSE/University roster binding; opaque and non-SSN | Yes |
| institutional_email | Invitation, verification, identity routing | Yes |
| given_name | User-facing identity | Yes |
| family_name | User-facing identity | Yes |
| preferred_name | Product display | Optional |
| university_affiliation_type | Student, staff, approved administrator | Yes |
| affiliation_status | Active, pending, leave, ended, etc. | Yes |
| program_code | Policy/reporting only when confirmed necessary | Conditional |
| program_name | Display/mapping when program is used | Conditional |
| cohort_or_entry_year | Transition planning if required | Conditional |
| expected_graduation_term | Access expiry/transition planning if required | Conditional |
| school_or_department_code | Scope only if required | Conditional |
| campus | Scope only if required | Conditional |
| effective_start | Membership timing | Yes |
| effective_end | Graduation/appointment expiry where known | Conditional |
| source_updated_at | Freshness | Yes |

### AFFILIATIONS

- source_person_id;
- organization/club code;
- affiliation type;
- status;
- start;
- end;
- source owner;
- record version.

### ORGANIZATION_NODES

- OSE administrative node;
- approved pilot club/association nodes;
- codes and display names;
- node type;
- parent;
- lifecycle state;
- effective dates.

### SEAT_ASSIGNMENTS

- source_person_id;
- organization/club code;
- durable seat code;
- assignment status;
- start;
- end;
- appointment/approval source;
- predecessor/successor reference only where approved;
- record version.

The initial expected seats may include OSE administrator, club president, finance VP, marketing VP, and MS representative/outreach, but exact labels remain tenant configuration.

## 19.3 Do not request for the pilot by default

- GPA, grades, courses, transcript, or academic standing;
- financial aid, tuition, or student financial records;
- date of birth;
- Social Security number or government identifier;
- home address;
- personal phone or email;
- race, ethnicity, religion, sex, gender, disability, health, counseling, or accommodation data;
- immigration/visa status;
- disciplinary records;
- University passwords or account-recovery data;
- unrelated directory profile attributes.

If Simon asserts that any additional field is required, document the exact policy purpose, owner, minimum granularity, retention, access, and approval before adding it.

## 19.4 Simon access policies

At minimum prove:

1. Active roster + approved invitation + verified institutional email + active interval permits tenant workspace eligibility.
2. Active club affiliation determines club-level collaboration scope.
3. Current seat assignment determines candidate role authority.
4. Central Authorization Service enforces VP → President → OSE workflows where configured.
5. OSE cross-club oversight is explicit and does not expose unrestricted student records.
6. Program/cohort/graduation fields do not grant privileged access unless an approved policy explicitly references them.
7. Ended affiliation revokes active access and initiates handoff without deleting institutional history.
8. Successor receives eligible seat memory under the new assignment, not predecessor credentials or private records.
9. A non-rostered University email is denied.
10. A rostered user with an unverified email is denied.
11. A person cannot substitute another club ID or tenant ID.
12. Future-dated officers cannot act early.
13. Expired officers lose authority promptly.
14. OSE and club roles cannot self-approve prohibited actions.

## 19.5 Later University SSO

When Simon/University approves SSO:

1. Configure the University SAML/OIDC connection.
2. Receive issuer, metadata/discovery, certificate/client data, claims, and test users through the approved handoff.
3. Identify an immutable University subject and, if available, a stable person identifier for pre-linking.
4. Run non-production claim mapping and identity-link tests.
5. Link to existing Tenure person_id through trusted keys or the high-assurance dual-login flow.
6. Keep memberships, seats, approvals, memory, and workspace unchanged.
7. Route approved University domains to the University IdP.
8. Validate active Tenure eligibility after SSO.
9. Move through pilot/hybrid/required waves.
10. Disable local sign-in only after migration evidence, support readiness, rollback, and approval.

SSO users return to their ongoing authorized Simon workspace. A successful University login without an active Tenure membership receives a generic denial or approved request-access path.

## 19.6 FERPA and institutional controls

Treat roster fields obtained from institutional records as protected education-record data when applicable.

- Simon/University must identify the authorized data owner and approved purpose.
- Tenure must use the data only for the configured institutional service.
- Access must be limited to legitimate approved users and purposes.
- Disclosures and administrative access must be logged as required by policy.
- Data must not be reused for unrelated model training, marketing, or cross-tenant analytics.
- Retention and deletion must follow the approved agreement and legal hold.
- Tenure must support access, correction, export, restriction, and incident workflows as configured.
- The implementation must not claim legal compliance merely because these controls exist; counsel and the institution decide applicability.

## 19.7 Simon/OSE reciprocal onboarding contract

Before roster collection, Tenure and OSE complete one approved onboarding contract.

### OSE provides or confirms

1. Authorized business owner, roster steward, access approver, privacy/security contact, and support/escalation contact.
2. Exact Fall 2026 pilot scope: participating clubs/associations, OSE staff, participant types, and expected counts.
3. Approved University email domains and any populations that legitimately use another domain.
4. A stable opaque source_person_id for each participant, or approval for an OSE-issued stable ID; never SSN.
5. Minimum PEOPLE fields required by the active policy.
6. Club/association codes and organizational hierarchy.
7. Current affiliations and durable-seat assignments with effective start/end dates.
8. Which fields, if any, genuinely require program, cohort, expected graduation term, school/department, or campus.
9. Joiner, mover, graduate/leaver, election, replacement, suspension, and correction processes.
10. Roster update cadence, expected freshness, delivery owner, and emergency-change process.
11. Who may create tenant-managed additions, what requires a second approval, and which populations may be temporary or ongoing.
12. Maximum temporary duration, ongoing review cadence, and required sponsor.
13. Which manual additions count toward the commercial contract metric and how guests/test users are classified.
14. Initial OSE administrator(s) and who may approve club-level roster/seat changes.
15. Approved invitation wording and onboarding communication owner.
16. Data-use purpose, retention/destruction requirements, permitted administrators, and incident-notification contacts.
17. Future SSO owner and, when approved, SAML/OIDC metadata, immutable subject, stable directory identifier, claim contract, test users, and migration schedule.
18. Whether SCIM or another directory/SIS lifecycle feed may become available later.
19. Written confirmation that excluded data such as GPA, grades, financial aid, health, discipline, SSN, home address, and protected traits are not required for this pilot unless separately justified and approved.
20. Approval of the final generated workbook data dictionary, access-policy simulation, impact preview, and activation plan.

### Tenure returns or commits

1. A generated minimum-data workbook and data dictionary.
2. Plain-language explanation of why each requested field is needed.
3. Invitation-only Cognito flow, verified-email control, MFA/session/recovery controls, and generic denial behavior.
4. Tenant, club, durable-seat, module, and workflow policy matrix.
5. TEMPORARY/ONGOING manual-addition workflow with sponsor, approval, expiry/review, and audit.
6. Commercial usage metric definition, current count, threshold behavior, and no-surprise overage/approval path.
7. Access-review, correction, graduate/leaver, and emergency-revocation procedures.
8. Privacy, retention, export, deletion/hold, support-access, and incident-handling summary.
9. SSO migration contract that preserves person_id, memberships, seats, history, and workspace.
10. Test plan and sanitized evidence using synthetic data.
11. Named Tenure implementation, security, account, and support owners.
12. A cutover, rollback, and pilot-support plan.

No production roster is requested until both sides approve this contract and the minimum-data template.

---

# 20. Cross-industry configuration packs

## 20.1 Higher education

Potential attributes:

- institution/school/program;
- active enrollment or affiliation;
- cohort and expected completion;
- campus;
- student/staff/faculty/alumni classification;
- club/association affiliation;
- office/committee role;
- term dates.

## 20.2 Corporate workforce

- worker ID;
- legal employer;
- worker type/status;
- department/business unit/cost center;
- job/position;
- manager;
- location;
- start/end;
- training;
- privileged-role approval.

## 20.3 Contractor and partner

- sponsoring organization/person;
- contract/vendor;
- work order/project;
- approved scope;
- start/end;
- background/training attestation;
- periodic recertification.

## 20.4 Manufacturing and field operations

- site/plant/work center;
- shift;
- job qualification;
- safety training;
- equipment certification;
- maintenance/project assignment.

## 20.5 Healthcare workforce

- employer/facility;
- practitioner/workforce status;
- role;
- credential/license status;
- training;
- care-team/assignment context;
- break-glass policy.

Do not ingest patient medical data into workforce eligibility.

## 20.6 Financial services

- legal entity/branch;
- employment;
- regulated function;
- license/registration status;
- supervisory relationship;
- separation-of-duty class;
- high-assurance/step-up requirement.

## 20.7 Public sector and nonprofit

- agency/chapter;
- employee/member/volunteer status;
- appointment;
- jurisdiction;
- committee or program;
- sponsor;
- term dates;
- clearance proof status where lawfully required.

Every pack must define the minimum fields, forbidden defaults, source expectations, policies, test fixtures, privacy controls, and evidence gates for its exact scope.

---

# 21. APIs, commands, and events

Use versioned, tenant-bound contracts.

## 21.1 Commands

- RegisterPopulationSource;
- UpdateSourceAuthority;
- GenerateRosterTemplate;
- CreateImport;
- ValidateImport;
- ResolveImportRecords;
- PreviewEligibilityImpact;
- ApproveImportActivation;
- ActivateSourceSnapshot;
- RollBackSourceSnapshot;
- CreateEligibilityPolicy;
- TestEligibilityPolicy;
- ApprovePolicyVersion;
- ActivatePolicyVersion;
- ReconcileAccess;
- ReviewPersonMatch;
- MergePerson;
- SplitPerson;
- CreatePolicyException;
- RevokePolicyException;
- StartAccessReview;
- CertifyAccess;
- StartIdentityLink;
- CompleteIdentityLink;
- RevokeIdentityLink;
- SuspendMembership;
- ReinstateMembership;
- CreateTenantManagedPopulationEntry;
- ApproveTenantManagedPopulationEntry;
- ExtendTemporaryPopulationEntry;
- ConvertPopulationEntryClass;
- RevokeTenantManagedPopulationEntry;
- ReconcileCommercialAccessUsage;

Every command includes actor, tenant, expected revision, reason, idempotency key, correlation ID, authorization decision, and typed payload.

## 21.2 Events

- PopulationSourceRegistered;
- SourceSnapshotReceived;
- SourceSnapshotSecurityRejected;
- SourceSnapshotValidated;
- SourceSnapshotActivated;
- SourceSnapshotRolledBack;
- SourceRecordRejected;
- PersonCandidateCreated;
- PersonResolutionRequired;
- PersonResolved;
- AffiliationChanged;
- EligibilityPolicyActivated;
- EligibilityDecisionChanged;
- AccessReconciliationRequested;
- AccessGranted;
- AccessSuspended;
- AccessRevoked;
- SessionRevocationRequested;
- IdentityRouteChanged;
- ExternalIdentityLinked;
- ExternalIdentityLinkFailed;
- SCIMUserDeactivated;
- AccessReviewStarted;
- AccessCertified;
- PolicyExceptionGranted;
- PolicyExceptionExpired;
- SourceStale;
- ReconciliationFailed;
- TenantManagedPopulationEntryProposed;
- TenantManagedPopulationEntryActivated;
- TenantManagedPopulationEntryExpired;
- TenantManagedPopulationEntryRevoked;
- CommercialAccessUsageChanged;
- CommercialAccessThresholdCrossed;
- CommercialEntitlementApprovalRequired.

Events carry tenant/cell, aggregate, schema version, event ID, causal decision, idempotency key, actor/service identity, correlation/trace IDs, event/effective time, and safe payload. They never carry raw tokens, passwords, assertions, unnecessary PII, or secret values.

---

# 22. Security, privacy, and abuse resistance

Threat-model:

- stolen or forwarded roster file;
- malicious spreadsheet/formula;
- wrong-tenant upload;
- source replay or rollback attack;
- forged webhook;
- SCIM credential theft;
- tenant-domain takeover;
- login enumeration;
- shared/recycled email;
- malicious identity linking;
- IdP claim injection;
- role/group escalation;
- mass privileged grant;
- mass revocation;
- stale-feed exploitation;
- duplicate/split person confusion;
- cross-tenant identifier substitution;
- cache/search/index leakage;
- background-job tenant loss;
- operator overreach;
- support-session misuse;
- evidence artifact leakage;
- policy manipulation;
- protected-class discrimination;
- denial-of-service through policy or import complexity;
- race between roster change and active session;
- rollback restoring obsolete access.

## 22.1 Isolation

- Every protected record has tenant_id or dedicated tenant storage.
- Composite constraints prevent cross-tenant references.
- Database/RLS or equivalent isolation is tested.
- Object keys, queues, caches, indexes, exports, logs, and artifacts are tenant/cell namespaced.
- Background consumers re-establish trusted tenant context.
- Platform operators see health by default, not raw tenant records.
- Support access is purpose-bound, time-limited, approved, and audited.
- A global Person does not make tenant records globally readable.

## 22.2 Privacy

- Minimize fields and granularity.
- Separate identity/profile from access-policy facts.
- Tokenize/pseudonymize stable source IDs where possible.
- Encrypt protected values.
- Redact logs and traces.
- Mask admin screens by purpose.
- Prevent PII in URLs, metrics labels, cache keys exposed to clients, or GitHub evidence.
- Enforce retention at raw, normalized, decision, audit, and export layers.
- Support correction without erasing audit.
- Support approved subject-rights workflows without violating legal hold.
- Prevent raw roster data from entering Bedrock prompts unless an authorized task requires exact fields and policy permits it.
- Never use tenant roster data for general model training.

## 22.3 Access-policy safety

- Policy authors require semantic permissions.
- High-risk policy changes require step-up and two-person approval.
- Activation binds to exact policy/source/config digests.
- Test fixtures and impact analysis are mandatory.
- Privileged grants and mass revocations have thresholds and approval.
- No self-approval.
- Explicit deny overrides allow.
- Policy-engine failure denies.
- Rollback cannot re-enable expired or explicitly revoked access without re-evaluation.

---

# 23. Relay and AI boundaries

Relay may:

- explain safe decision reasons to authorized users;
- draft mapping proposals;
- identify data-quality anomalies;
- suggest missing fields;
- summarize import errors;
- propose policy tests;
- help an operator navigate remediation;
- compare source versions;
- generate a draft data dictionary from approved schemas.

Relay may not:

- decide final identity matches;
- merge people;
- activate a source;
- activate a policy;
- grant or revoke access;
- approve an exception;
- infer protected attributes;
- invent missing tenant facts;
- treat semantic similarity as identity proof;
- bypass source trust;
- expose another person's access reason;
- send roster data to direct external model APIs;
- self-approve any action.

All AI-assisted actions are typed, previewed, authorized, human-approved where required, auditable, and executed by deterministic services.

---

# 24. Observability and operations

Monitor:

- source delivery success/failure;
- age and staleness;
- schema drift;
- validation error rate;
- duplicate and unresolved person rate;
- decision latency;
- reconciliation lag;
- session-revocation lag;
- SCIM deprovisioning lag;
- identity-link success/conflict rate;
- policy evaluation errors;
- access-review completion;
- active exceptions and expiry;
- privileged grants/revocations;
- mass-change thresholds;
- tenant/cell isolation canaries;
- raw-file retention/destruction;
- connector rate limits and DLQs;
- cost by tenant/source/import;
- audit delivery integrity.

Do not use email, name, source person ID, or another personal value as an unbounded metric label.

Define SLOs by risk:

- interactive eligibility decision;
- batch import throughput;
- normal reconciliation;
- urgent revocation;
- SCIM deprovisioning;
- source freshness;
- identity routing;
- evidence delivery.

Measure actual results before claiming real-time or immediate behavior.

Runbooks:

- missing/stale source;
- malformed/malicious import;
- wrong-tenant upload;
- mass accidental revocation;
- mass accidental grant;
- identity-link conflict/takeover;
- duplicate person;
- SCIM outage;
- IdP outage;
- compromised roster source;
- policy-engine failure;
- reconciliation backlog;
- audit/evidence failure;
- privacy incident;
- rollback and forward fix.

---

# 25. Migration, export, and tenant lifecycle

## 25.1 Legacy roster migration

- inventory every source and spreadsheet;
- classify ownership and authority;
- define source IDs and person-resolution rules;
- take immutable extracts;
- map and test;
- perform mock conversions;
- reconcile record counts and access outcomes;
- resolve exceptions;
- run delta;
- obtain business sign-off;
- activate with rollback;
- destroy temporary data when approved.

## 25.2 Export

Authorized exports include:

- source configuration;
- attribute catalog;
- mapping versions;
- policies;
- memberships/affiliations/assignments;
- decision history;
- access-review history;
- audit and evidence;
- raw snapshots only where policy and contract permit.

Exports are encrypted, asynchronous, short-lived, purpose-bound, tenant-isolated, and audited. CSV/XLSX exports prevent formula injection.

## 25.3 Suspension and hibernation

Tenant suspension:

- blocks login and routing;
- revokes sessions;
- disables SCIM/roster connectors according to policy;
- stops background reconciliation safely;
- preserves retained configuration/history;
- does not label infrastructure cost as zero.

Hibernation and reactivation follow the global lifecycle Bible and rerun identity, source, policy, eligibility, isolation, reconciliation, and smoke gates.

## 25.4 Offboarding and purge

Offboarding requires source shutdown, final export, access revocation, connector/SCIM disablement, retention/legal-hold decision, key/resource inventory, evidence, cooling-off period, and protected approval. Purge is irreversible and never inferred from a roster row.

---

# 26. Testing and verification

Use synthetic people and tenants only. Never place real Simon records in repository fixtures, screenshots, traces, logs, videos, or evidence.

## 26.1 Unit and property tests

- schema validation;
- data-type normalization;
- unknown/null/withheld semantics;
- source precedence;
- temporal overlap;
- stale-source behavior;
- deterministic policy evaluation;
- explicit deny;
- exception expiry;
- idempotent imports;
- duplicate events;
- person-resolution safety;
- no email-only merge;
- decision explanation redaction;
- rollback re-evaluation;
- formula-injection escaping;
- mapping mutation tests;
- policy mutation tests.

## 26.2 Integration tests

- file quarantine to activation;
- API/webhook signature and replay;
- SCIM user/group lifecycle;
- HRIS/SIS-like coexistence;
- Cognito invitation flow;
- tenant discovery;
- membership and session revocation;
- module visibility and API denial;
- organization/seat assignment;
- search/file/Relay scope changes;
- analytics population correctness;
- outbox/DLQ/reconciliation;
- retention/destruction.

## 26.3 Cross-tenant abuse tests

- upload Tenant A roster under Tenant B;
- substitute tenant/source/snapshot/person/decision/seat IDs;
- use a valid Tenant A SSO assertion for Tenant B;
- use shared email across tenants;
- exploit person correlation to read another tenant;
- poison cache/index/background job;
- export another tenant;
- replay webhook/import;
- link another tenant's identity;
- use stale session after deprovisioning;
- request another person's decision explanation;
- use operator/support paths to bypass scope.

All deny.

## 26.4 Required lifecycle scenarios

1. Invited eligible user joins.
2. Correct-domain but unrostered user is denied.
3. Rostered but wrong-domain user follows configured alternate route or is denied.
4. Future-dated user remains pending.
5. Ended user loses sessions and access.
6. Rehire/returning student reuses the person but re-evaluates all access.
7. User changes email.
8. Same email appears from different issuers and does not auto-merge.
9. Duplicate source person enters review.
10. Person has two tenants and switches safely.
11. Person has two simultaneous seats.
12. Mover loses old scope and gains new scope.
13. Stale source fails according to risk policy.
14. Conflicting authoritative sources enter review.
15. Mass revocation requires protected approval and rollback.
16. Policy exception expires automatically.
17. Local Cognito user links to SSO and retains workspace/history.
18. Bad SSO link is rejected.
19. SCIM deactivation revokes access.
20. SCIM reactivation does not restore obsolete privilege.
21. Successor receives eligible seat memory, not private predecessor data.

## 26.5 Simon synthetic E2E

Use a fully synthetic Simon-shaped fixture:

- OSE node;
- at least four clubs;
- student, officer, president, finance VP, and OSE administrator personas;
- active, future, expired, duplicate, stale, and conflicting rows;
- shared University domain;
- invitation-only Cognito;
- later test SAML/OIDC IdP;
- club isolation;
- cross-club OSE oversight;
- VP → President → OSE workflow;
- graduation/offboarding;
- seat succession and memory.

Also run corporate and nonprofit fixtures through the same engine.

## 26.6 Browser testing

Headless tests cover:

- template download;
- upload/quarantine/validation;
- error correction;
- mapping;
- person-resolution review;
- policy simulation;
- impact preview;
- approval;
- activation;
- reconciliation;
- access-review campaign;
- invitation login;
- denied login;
- SSO linking;
- workspace return;
- tenant switching;
- session revocation;
- keyboard-only use;
- screen-reader names/states;
- light/dark/high-contrast;
- responsive views;
- loading/empty/error/conflict/stale/offline/rate-limited/blocked/success states.

---

# 27. Implementation sequence

## Phase 0 — Truth and graph

- import this Bible and IER-* requirements;
- inventory existing user, roster, identity, membership, role, seat, SCIM, invitation, domain, module-entitlement, policy, import, audit, and session paths;
- baseline tests;
- identify hard-coded email/domain/role authorization;
- classify current Simon data assumptions;
- create threat model and gap register.

Gate: no behavioral access change until canonical objects, current sources, and rollback are known.

## Phase 1 — Data and policy foundation

- attribute catalog;
- source registry;
- snapshots/assertions;
- temporal affiliations;
- policy schema/compiler;
- eligibility decisions;
- evidence model;
- tenant isolation;
- synthetic fixtures.

Gate: migrations and deterministic unit/property/isolation tests pass.

## Phase 2 — Ingestion and Roster Studio

- template compiler;
- secure file/API ingestion;
- validation/mapping;
- data quality;
- person resolution;
- preview;
- approval;
- activation and rollback.

Gate: repeated clean-database imports converge and malicious/invalid inputs fail safely.

## Phase 3 — Reconciliation and identity

- access reconciliation;
- membership/module/session integration;
- tenant routing;
- invitation-only Cognito;
- decision explanation;
- JML lifecycle;
- access reviews.

Gate: deployed invitation flow and joiner/mover/leaver scenarios pass across three tenant fixtures.

## Phase 4 — Federation and SCIM

- SAML/OIDC connection integration;
- safe identity linking;
- migration waves;
- SCIM provider boundary;
- claim/group mapping;
- deprovisioning.

Gate: local-to-SSO migration preserves person/workspace/history and negative takeover tests pass.

## Phase 5 — Simon proving configuration

- generated Simon workbook;
- synthetic OSE/club data;
- invitation roster;
- tenant/module/seat policies;
- graduation and handoff;
- future University SSO contract;
- FERPA-oriented controls;
- full E2E.

Gate: no Simon-specific platform branch; corporate and nonprofit fixtures remain green.

## Phase 6 — Production readiness

- SLOs/alarms/runbooks;
- restore/rollback;
- privacy review;
- access-review operations;
- deployment evidence;
- protected release.

Gate: exact enabled scope is implemented, deployed, supported, reversible, and evidenced.

---

# 28. Required repository deliverables

## Code and data

- canonical source/attribute/assertion/affiliation/policy/decision/reconciliation models;
- migrations and tenant isolation;
- policy compiler/evaluator;
- person-resolution workflow;
- source ingestion and mapping;
- access reconciliation;
- invitation and SSO-link integration;
- SCIM boundary;
- System Studio and Roster Studio;
- tenant/member-facing safe explanations;
- audit/outbox/observability.

## Configuration

- global schemas;
- industry-pack schemas;
- Simon tenant overlay;
- corporate and nonprofit fixtures;
- attribute data dictionaries;
- source-authority matrices;
- mapping versions;
- eligibility policies;
- access-review policy;
- source staleness/failure policy;
- SSO migration plan.

## Evidence and documentation

- architecture ADR;
- data classification and purpose register;
- identity/roster threat model;
- source and mapping inventory;
- Simon data-request contract;
- Simon workbook template generated by the engine;
- SCIM/SSO claim contract;
- migration and rollback plan;
- test evidence;
- deployment evidence;
- operator and tenant-admin runbooks;
- final verification matrix.

Do not create empty documents to satisfy this list.

---

# 29. Stable implementation checklist

Every IER-* item must appear once in the unified execution ledger. A box remains unchecked until complete evidence exists.

## IER-000 — Document graph and execution truth

- [ ] IER-000-001 — Register this Bible, version, digest, owner, dependencies, prefix, and precedence in the architecture document graph.
- [ ] IER-000-002 — Import every IER-* requirement into the unified execution ledger without duplicate or missing IDs.
- [ ] IER-000-003 — Add IER-* completeness checks to CI and master prompt prefix validation.
- [ ] IER-000-004 — Map every overlapping GE/CFG/HCM/INT/PACK/SIM requirement without divergent duplication.
- [ ] IER-000-005 — Record current repository and deployed identity/roster/access behavior before changes.
- [ ] IER-000-006 — Create ADRs for eligibility boundary, policy engine, temporal model, source trust, and identity linking.
- [ ] IER-000-007 — Preserve existing user changes, historical ledgers, and evidence.
- [ ] IER-000-008 — Prohibit completion claims without code, migration, integration, test, deployment, rollback, and operational evidence.

## IER-010 — Boundaries and canonical semantics

- [ ] IER-010-001 — Separate authentication, routing, person, external identity, roster assertion, affiliation, eligibility, assignment, tenant entitlement, authorization, and access grant.
- [ ] IER-010-002 — Implement provider-independent stable person identity.
- [ ] IER-010-003 — Key external identities by connection + verified issuer + immutable subject.
- [ ] IER-010-004 — Prevent email-only identity merge or privilege grant.
- [ ] IER-010-005 — Model multiple identities, tenants, affiliations, seats, and historical assignments.
- [ ] IER-010-006 — Implement explicit eligibility outcomes including indeterminate and manual review.
- [ ] IER-010-007 — Implement deny-by-default authorization and failure behavior.
- [ ] IER-010-008 — Separate commercial tenant capability entitlement from person eligibility and action authorization in schema/API/UI/reporting.

## IER-020 — Source and attribute governance

- [ ] IER-020-001 — Implement PopulationSource with owner, scope, trust, cadence, freshness, retention, health, and version.
- [ ] IER-020-002 — Implement field-level source authority and precedence.
- [ ] IER-020-003 — Implement AttributeDefinition with type, purpose, classification, consumers, retention, and policy-use controls.
- [ ] IER-020-004 — Generate minimum source contracts from active configured purposes and policies.
- [ ] IER-020-005 — Prevent “collect all available fields” configuration.
- [ ] IER-020-006 — Distinguish null, unknown, withheld, not applicable, false, and stale.
- [ ] IER-020-007 — Implement effective-dated and system-dated source assertions.
- [ ] IER-020-008 — Implement explicit source staleness and failure policy by risk.
- [ ] IER-020-009 — Implement conflict detection; prohibit last-write-wins across authoritative sources.
- [ ] IER-020-010 — Record correction and supersession without erasing historical truth.

## IER-030 — Privacy and sensitive data

- [ ] IER-030-001 — Classify every roster/eligibility field and restrict its consumers.
- [ ] IER-030-002 — Exclude sensitive and protected data by default.
- [ ] IER-030-003 — Require documented necessity, review, safer-alternative analysis, and controls before sensitive proof is used.
- [ ] IER-030-004 — Prefer narrow attestations over raw sensitive documents.
- [ ] IER-030-005 — Prohibit protected-class inference and opaque discriminatory policies.
- [ ] IER-030-006 — Implement masking, redaction, export, search, analytics, and logging policy by attribute.
- [ ] IER-030-007 — Implement correction, retention, deletion, restriction, and legal-hold behavior.
- [ ] IER-030-008 — Prohibit roster data from unrelated model training, marketing, or cross-tenant use.

## IER-040 — Secure ingestion

- [ ] IER-040-001 — Support governed manual, XLSX, CSV, object, API, webhook, SCIM, connector, snapshot, and delta modes by certified scope.
- [ ] IER-040-002 — Implement immutable checksum-addressed SourceSnapshot with counts, schema, prior version, and evidence.
- [ ] IER-040-003 — Quarantine and malware-scan files before parsing.
- [ ] IER-040-004 — Reject macro-enabled, active-content, external-link, embedded-object, and unsupported workbooks.
- [ ] IER-040-005 — Enforce file/row/column/cell/decompression/resource limits.
- [ ] IER-040-006 — Never execute formulas and prevent CSV/formula injection on import/export.
- [ ] IER-040-007 — Validate signed template headers, data types, values, cross-sheet references, and effective dates.
- [ ] IER-040-008 — Implement tenant/cell object isolation and short-lived upload credentials.
- [ ] IER-040-009 — Keep raw values out of logs and ordinary evidence.
- [ ] IER-040-010 — Implement idempotent import and replay/duplicate handling.
- [ ] IER-040-011 — Implement import state machine with retry, failure, rollback, supersession, hold, and destruction.
- [ ] IER-040-012 — Enforce transient-file retention and approved destruction.

## IER-050 — Workbook and source contracts

- [ ] IER-050-001 — Generate tenant/policy-specific workbook templates rather than one universal all-fields sheet.
- [ ] IER-050-002 — Generate README and DATA_DICTIONARY with purpose, owner, classification, allowed values, and instructions.
- [ ] IER-050-003 — Generate only required PEOPLE, AFFILIATIONS, ORGANIZATION_NODES, SEAT_ASSIGNMENTS, MODULE_POPULATIONS, ATTESTATIONS, and CHANGE_CONTROL sheets.
- [ ] IER-050-004 — Require stable non-SSN source person IDs and source record versions.
- [ ] IER-050-005 — Preserve IDs as strings and dates with explicit ISO/timezone semantics.
- [ ] IER-050-006 — Produce row-level safe error output and remediation.
- [ ] IER-050-007 — Produce before/after impact preview for people, affiliations, seats, eligibility, sessions, modules, and downstream systems.
- [ ] IER-050-008 — Bind approval to exact source, mapping, policy, and impact digests.

## IER-060 — Mapping and person resolution

- [ ] IER-060-001 — Implement versioned typed header/value/organization/status/date mappings.
- [ ] IER-060-002 — Reject unknown values and unsafe implicit coercion.
- [ ] IER-060-003 — Prohibit arbitrary executable mapping code.
- [ ] IER-060-004 — Resolve by verified identity or stable approved source keys before weaker hints.
- [ ] IER-060-005 — Use email only as a candidate hint, never final merge proof.
- [ ] IER-060-006 — Implement ambiguous-match review with masked evidence and separation of duties.
- [ ] IER-060-007 — Handle changed/recycled/shared email, changed name, rehire/return, duplicate source, and multiple sources.
- [ ] IER-060-008 — Implement protected reversible person merge and split with session revocation and reconciliation.
- [ ] IER-060-009 — Prevent cross-tenant person correlation from exposing business records.
- [ ] IER-060-010 — Test mapping and resolution with mutation, collision, and adversarial fixtures.

## IER-070 — Eligibility policy engine

- [ ] IER-070-001 — Implement typed deterministic versioned declarative eligibility policies.
- [ ] IER-070-002 — Validate all attribute references, types, source trust, and freshness.
- [ ] IER-070-003 — Support all/any/not, effective dates, explicit deny, exceptions, staged rollout, and expiry.
- [ ] IER-070-004 — Define missing, stale, conflict, and unavailable-source behavior for every policy.
- [ ] IER-070-005 — Prohibit network calls, arbitrary code, hidden defaults, and nondeterminism in evaluation.
- [ ] IER-070-006 — Prohibit LLM/embedding/probabilistic output as final access condition.
- [ ] IER-070-007 — Implement compile-time lint, simulation, unit, property, boundary, and mutation tests.
- [ ] IER-070-008 — Store immutable policy version/digest, approval, activation, and rollback.
- [ ] IER-070-009 — Preserve past policy versions needed for historical explanations.
- [ ] IER-070-010 — Implement safe end-user, admin, auditor, and operator explanation layers.
- [ ] IER-070-011 — Produce decision receipts with policy and source revisions but no unnecessary raw PII.
- [ ] IER-070-012 — Fail closed on engine error or indeterminate high-risk decisions.

## IER-080 — Access reconciliation and continuity

- [ ] IER-080-001 — Implement desired-versus-actual access reconciliation.
- [ ] IER-080-002 — Reconcile tenant membership, module, organization, seat, workflow, report, file/search, Relay, connector, session, cache, and job scope.
- [ ] IER-080-003 — Implement idempotent joiner provisioning with minimum privilege.
- [ ] IER-080-004 — Implement mover diff with old-scope revocation, new-scope grant, SoD, and session rotation.
- [ ] IER-080-005 — Implement leaver/graduate revocation, handoff, retention, and external-access cleanup.
- [ ] IER-080-006 — Preserve durable-seat memory while protecting predecessor private data and credentials.
- [ ] IER-080-007 — Implement reinstatement through fresh policy evaluation, not unconditional restoration.
- [ ] IER-080-008 — Implement time-bound policy exceptions and separate break-glass controls.
- [ ] IER-080-009 — Protect privileged grants and mass revocations with thresholds, preview, second approval, and rollback.
- [ ] IER-080-010 — Ensure rollback re-evaluates current truth and cannot restore expired/revoked privilege.
- [ ] IER-080-011 — Record reconciliation attempts, receipts, failure, retry, and compensation.
- [ ] IER-080-012 — Measure and alarm on access/session revocation lag.

## IER-090 — Login routing and independent Cognito

- [ ] IER-090-001 — Resolve login from verified domain/slug/invitation/session/email hint through server-side tenant records.
- [ ] IER-090-002 — Prevent tenant/user enumeration, open redirect, and tenant confusion.
- [ ] IER-090-003 — Handle shared domains without treating the domain as membership.
- [ ] IER-090-004 — Implement invitation-only local Cognito sign-in by tenant policy.
- [ ] IER-090-005 — Disable public self-registration by default.
- [ ] IER-090-006 — Verify email ownership and then re-check active Tenure eligibility.
- [ ] IER-090-007 — Use server-controlled revocable sessions and safe recovery.
- [ ] IER-090-008 — Return only to the last currently authorized workspace or a safe chooser.
- [ ] IER-090-009 — Reject client-supplied tenant/workspace authority.
- [ ] IER-090-010 — Test correct-domain/unrostered, rostered/unverified, expired, suspended, and multi-tenant cases.

## IER-100 — SSO migration and identity linking

- [ ] IER-100-001 — Implement SAML/OIDC transition without changing person_id or business history.
- [ ] IER-100-002 — Bind federated identity by trusted connection + issuer + subject.
- [ ] IER-100-003 — Prefer approved stable directory/person cross-reference for pre-linking.
- [ ] IER-100-004 — Implement high-assurance dual-login linking when no stable cross-reference exists.
- [ ] IER-100-005 — Reject email-only automatic linking.
- [ ] IER-100-006 — Detect duplicate profiles, already-linked subjects, claim drift, and takeover attempts.
- [ ] IER-100-007 — Keep Cognito-specific linking inside the adapter after Tenure approves the link.
- [ ] IER-100-008 — Implement test, pilot, hybrid, preferred, required, disablement, and retirement waves.
- [ ] IER-100-009 — Preserve membership, seats, approvals, memory, preferences, and last authorized workspace.
- [ ] IER-100-010 — Rotate/revoke sessions on identity-link changes.
- [ ] IER-100-011 — Provide rollback and recovery without creating duplicate authority.
- [ ] IER-100-012 — Test malicious issuer, wrong tenant, recycled email, replay, and subject collision.

## IER-110 — SCIM and lifecycle sources

- [ ] IER-110-001 — Implement tenant-bound SCIM 2.0 Users and exact certified Group scope.
- [ ] IER-110-002 — Support filtering, pagination, ETag/version, PATCH, externalId, idempotency, and standard errors.
- [ ] IER-110-003 — Secure and rotate SCIM credentials; rate-limit and audit requests.
- [ ] IER-110-004 — Map SCIM groups only through versioned bounded policies.
- [ ] IER-110-005 — Prevent SCIM group text from directly granting privileged Tenure roles.
- [ ] IER-110-006 — Support SCIM, HRIS/SIS, local roster, training, and Tenure source coexistence.
- [ ] IER-110-007 — Prevent one source from overwriting attributes it does not own.
- [ ] IER-110-008 — Revoke sessions/access promptly on deactivation without deleting history/person.
- [ ] IER-110-009 — Re-evaluate all access on reactivation.
- [ ] IER-110-010 — Run provider interoperability, replay, duplicate, pagination, and deprovisioning tests.

## IER-120 — Module and scope eligibility

- [ ] IER-120-001 — Implement workspace, module, feature, organization, workflow, report, seat-candidate, connector, jurisdiction, and time eligibility targets.
- [ ] IER-120-002 — Require tenant capability entitlement before person eligibility can activate a module.
- [ ] IER-120-003 — Require central server authorization after eligibility for every action/resource.
- [ ] IER-120-004 — Derive UI navigation safely without using it as enforcement.
- [ ] IER-120-005 — Enforce effective dates and future/expired states.
- [ ] IER-120-006 — Enforce training/license/clearance proofs by narrow status, source, freshness, and scope.
- [ ] IER-120-007 — Implement relationship, assignment, delegation, and separation-of-duty integration.
- [ ] IER-120-008 — Test hidden-button bypass through direct API/server calls.

## IER-130 — System Studio and tenant experience

- [ ] IER-130-001 — Add Population, Identity, and Access Eligibility to the Tenant Configuration Graph.
- [ ] IER-130-002 — Implement source, attribute, authority, mapping, policy, identity-route, lifecycle, review, and exception configuration.
- [ ] IER-130-003 — Implement save/resume, versioning, diff, downstream invalidation, and collaborative drafts.
- [ ] IER-130-004 — Implement synthetic simulation and data/security/privacy/cost/access impact preview.
- [ ] IER-130-005 — Implement digest-bound approval, activation, monitoring, rollback, and evidence.
- [ ] IER-130-006 — Implement source-health and staleness dashboards.
- [ ] IER-130-007 — Implement import error and person-resolution workbenches.
- [ ] IER-130-008 — Implement access reconciliation and SSO migration dashboards.
- [ ] IER-130-009 — Implement delegated tenant Roster Studio with bounded permissions.
- [ ] IER-130-010 — Implement accessible responsive loading/empty/error/conflict/stale/offline/blocked/success states.
- [ ] IER-130-011 — Prevent self-grant, protected-field selection, arbitrary code, and approval bypass.
- [ ] IER-130-012 — Use Tenure Experience System and Analytics Cloud contracts without creating a parallel design or chart system.

## IER-135 — Tenant-managed additions and commercial usage

- [ ] IER-135-001 — Implement governed tenant-managed population additions as a first-class global capability.
- [ ] IER-135-002 — Tag every entry with TENANT_MANUAL_ATTESTATION, creator, sponsor, reason, scope, effective time, and source trust.
- [ ] IER-135-003 — Support TEMPORARY with mandatory end date, maximum duration, reminders, automatic expiry, and extension approval.
- [ ] IER-135-004 — Support ONGOING with mandatory periodic recertification, revocation, and authoritative-source supersession.
- [ ] IER-135-005 — Prevent manual entries from asserting fields outside their accepted source-authority policy.
- [ ] IER-135-006 — Require separate durable-seat assignment and approval for role authority.
- [ ] IER-135-007 — Resolve later SIS/HRIS/SCIM records to the same person without email-only merge or duplicate count.
- [ ] IER-135-008 — Define commercial usage metrics separately from durable organizational seats.
- [ ] IER-135-009 — Emit privacy-minimized commercial usage and threshold events to the Tenure control plane.
- [ ] IER-135-010 — Implement contract-driven grace, pending approval, guest classification, or denial for over-limit additions.
- [ ] IER-135-011 — Prohibit silent auto-charge, silent over-entitlement grant, duplicate counting, and PII in routine usage alerts.
- [ ] IER-135-012 — Reconcile effective-dated usage counts with entitlements and billing through reproducible audited definitions.

## IER-140 — Simon Tenant #1

- [ ] IER-140-001 — Configure Simon through tenant overlay and reusable higher-education/nonprofit packs only.
- [ ] IER-140-002 — Generate the Simon minimum roster template and data dictionary from active policies.
- [ ] IER-140-003 — Require approved roster + invitation + verified University email + active interval for pilot workspace eligibility.
- [ ] IER-140-004 — Treat rochester.edu/simon.rochester.edu only as routing/verification inputs, never authority.
- [ ] IER-140-005 — Model OSE, clubs, affiliations, and durable seats through global organization schemas.
- [ ] IER-140-006 — Configure club scope, OSE oversight, and VP → President → OSE policies.
- [ ] IER-140-007 — Make program/cohort/graduation fields conditional and purpose-bound.
- [ ] IER-140-008 — Exclude GPA, grades, financial aid, health, discipline, SSN, address, personal contacts, protected traits, and credentials by default.
- [ ] IER-140-009 — Implement graduation/end-date revocation and seat handoff.
- [ ] IER-140-010 — Preserve eligible seat memory without predecessor credentials/private data.
- [ ] IER-140-011 — Generate Simon University SSO claim/linking/migration contract without fabricated metadata.
- [ ] IER-140-012 — Prove local Cognito to SSO migration on synthetic users without duplicate person/workspace.
- [ ] IER-140-013 — Implement FERPA-oriented purpose, access, disclosure, retention, correction, and incident controls without making unsupported compliance claims.
- [ ] IER-140-014 — Prove synthetic Simon, corporate, and nonprofit fixtures on the same engine.
- [ ] IER-140-015 — Prove no Simon tenant ID, domain, program, club, role, or workflow hard-coding in platform core.
- [ ] IER-140-016 — Complete the reciprocal OSE/Tenure onboarding contract before requesting production roster data.
- [ ] IER-140-017 — Configure OSE-authorized TEMPORARY/ONGOING additions, sponsor/approval, expiry/review, and commercial-count behavior.

## IER-150 — Industry packs

- [ ] IER-150-001 — Implement versioned population/attribute/policy templates for higher education.
- [ ] IER-150-002 — Implement corporate workforce and contractor templates.
- [ ] IER-150-003 — Define manufacturing/field qualification templates.
- [ ] IER-150-004 — Define healthcare workforce templates without ingesting patient data into workforce eligibility.
- [ ] IER-150-005 — Define financial-services licensing/SoD templates by certified scope.
- [ ] IER-150-006 — Define public-sector/nonprofit/member/volunteer templates.
- [ ] IER-150-007 — Include minimum fields, forbidden defaults, source trust, tests, privacy, and evidence in every pack.
- [ ] IER-150-008 — Prohibit industry-pack source forks and unsupported certification claims.

## IER-160 — APIs, events, audit, and observability

- [ ] IER-160-001 — Implement versioned tenant-bound commands with actor, revision, reason, idempotency, correlation, and authorization.
- [ ] IER-160-002 — Implement transactional outbox events with tenant/cell, schema, causality, effective time, and safe payload.
- [ ] IER-160-003 — Prevent secrets, tokens, raw assertions, and unnecessary PII in events/logs/evidence.
- [ ] IER-160-004 — Implement immutable audit for source, mapping, match, policy, decision, reconciliation, link, review, and exception changes.
- [ ] IER-160-005 — Monitor source health, drift, quality, matching, decisions, reconciliation, revocation, linking, reviews, exceptions, and retention.
- [ ] IER-160-006 — Define and measure SLOs by risk without unsupported “real-time” claims.
- [ ] IER-160-007 — Implement DLQ/retry/replay/reconciliation and alerting.
- [ ] IER-160-008 — Implement runbooks for source, import, grant/revocation, link, SCIM/IdP, policy, privacy, and rollback incidents.

## IER-170 — Security and isolation

- [ ] IER-170-001 — Complete identity/roster/eligibility/access threat model and abuse cases.
- [ ] IER-170-002 — Enforce tenant isolation in database, objects, queues, caches, indexes, exports, logs, jobs, and evidence.
- [ ] IER-170-003 — Prevent cross-tenant identity correlation from becoming cross-tenant access.
- [ ] IER-170-004 — Protect source upload, webhook, API, SCIM, and SSO boundaries from forgery/replay.
- [ ] IER-170-005 — Protect policy authoring and activation with semantic permissions, step-up, SoD, and approval.
- [ ] IER-170-006 — Protect operator/support access with purpose, time, approval, redaction, and audit.
- [ ] IER-170-007 — Implement rate/resource limits for login discovery, import, mapping, policy, SCIM, and explanation.
- [ ] IER-170-008 — Implement security scans, dependency checks, secret scans, and sensitive-log tests.
- [ ] IER-170-009 — Prohibit long-lived credentials and browser-held AWS credentials.
- [ ] IER-170-010 — Verify rollback cannot resurrect unsafe access.

## IER-180 — Testing and evidence

- [ ] IER-180-001 — Add unit, property, mutation, boundary, temporal, concurrency, idempotency, retry, and recovery tests.
- [ ] IER-180-002 — Add clean-database migration and rollback/forward-fix tests.
- [ ] IER-180-003 — Add malicious XLSX/CSV, formula, oversized, schema-drift, Unicode, and duplicate tests.
- [ ] IER-180-004 — Add file/API/webhook/SCIM/connector integration tests.
- [ ] IER-180-005 — Add joiner/mover/leaver/graduate/rehire lifecycle tests.
- [ ] IER-180-006 — Add local Cognito invitation and session-revocation tests.
- [ ] IER-180-007 — Add local-to-SSO link/migration and takeover-negative tests.
- [ ] IER-180-008 — Add cross-tenant API/database/cache/file/search/event/export/Relay/operator abuse tests.
- [ ] IER-180-009 — Add module/scope/seat/SoD/effective-date authorization tests.
- [ ] IER-180-010 — Add stale/conflicting source and policy-engine failure tests.
- [ ] IER-180-011 — Add headless Chromium full suite and critical Firefox/WebKit smoke.
- [ ] IER-180-012 — Add keyboard, screen-reader, responsive, light/dark/high-contrast, reduced-motion, locale, offline, and slow-network tests.
- [ ] IER-180-013 — Run synthetic Simon, corporate, and nonprofit fixtures through the same implementation.
- [ ] IER-180-014 — Prohibit real Simon/person data in code, fixtures, logs, screenshots, traces, videos, and evidence.
- [ ] IER-180-015 — Record exact tests, counts, results, commits, digests, deployment runs, rollback, and sanitized evidence.
- [ ] IER-180-016 — Require independent security/QA review before a domain gate passes.

## IER-190 — Lifecycle and production readiness

- [ ] IER-190-001 — Implement legacy roster/source inventory, immutable extraction, mapping, mock conversion, delta, and reconciliation.
- [ ] IER-190-002 — Implement secure tenant export with CSV/formula safety and short retention.
- [ ] IER-190-003 — Integrate tenant suspension, hibernation, reactivation, offboarding, hold, and purge.
- [ ] IER-190-004 — Re-run identity/source/policy/eligibility/reconciliation/isolation gates after restore or reactivation.
- [ ] IER-190-005 — Implement source/connector/SCIM shutdown and final access revocation in offboarding.
- [ ] IER-190-006 — Require protected approval for production activation, mass access change, irreversible link migration, and purge.
- [ ] IER-190-007 — Deploy through System Studio/approved AWS workflows with artifact/config/schema digests.
- [ ] IER-190-008 — Verify alarms, runbooks, backup/restore, rollback, support owner, and cost before availability.

---

# 30. Prohibited shortcuts

Do not:

- request every field in a student, worker, member, or directory system;
- use email suffix as authorization;
- use Cognito Groups as canonical Tenure RBAC;
- use IdP group/title/program strings as unconditional privilege;
- use one active Boolean for authentication, eligibility, membership, and authorization;
- confuse durable organizational seats with licensed users, active-member counts, provider MAUs, or billable access seats;
- use email as person primary key;
- merge identities because email matches;
- let a roster row grant privileged authority without policy/assignment/approval;
- mutate live access while merely parsing an upload;
- trust last write wins for conflicting authority;
- execute Excel formulas, macros, links, or embedded content;
- leak roster values into logs, evidence, screenshots, URLs, or metrics;
- put raw Cognito tokens in browser storage;
- put raw SAML/OIDC assertions in logs;
- create a Simon-specific authentication or roster service;
- hard-code University domains, programs, roles, graduation logic, tenant IDs, or IdP values in business code;
- let Relay or an LLM make final access, merge, exception, activation, or approval decisions;
- restore access on rollback without current re-evaluation;
- delete person/history because a roster no longer includes them;
- interpret SCIM delete as unconditional legal-data deletion;
- allow tenant admins to grant themselves authority;
- call a workbook, schema, mock connector, unrun migration, or passing unit test a complete feature;
- claim FERPA, GDPR, HIPAA, SOC 2, ISO, or another compliance status without exact applicability, controls, evidence, and authorized assessment.

---

# 31. Definition of complete

This Bible is implemented only when:

- it is in the mandatory document graph and IER-* ledger;
- the one Tenure engine models sources, attributes, assertions, affiliations, policies, decisions, reconciliation, and evidence;
- data minimization is compiled into source contracts;
- secure generated workbook and API/SCIM paths work;
- person resolution does not rely on email;
- eligibility is deterministic and separate from authorization;
- access reconciliation covers memberships, modules, scopes, seats, sessions, files/search, Relay, connectors, jobs, and caches;
- joiner/mover/leaver/graduate/reinstatement scenarios work;
- invitation-only Cognito works for Simon-shaped synthetic users;
- local-to-SSO migration preserves person/workspace/history;
- SCIM deprovisioning revokes access promptly;
- System Studio and Roster Studio are complete and accessible;
- authorized tenant admins can add TEMPORARY or ONGOING population entries with sponsor, approval, expiry/review, reconciliation, and audit;
- commercial access usage is defined separately from durable seats, notified to the Tenure control plane without routine PII, and reconciled without silent charging or duplicate counts;
- Simon is configured without platform hard-coding;
- corporate and nonprofit fixtures pass;
- tenant isolation and abuse tests pass;
- privacy, threat, retention, export, incident, access-review, and support controls exist;
- non-production deployment, alarms, evidence, backup/restore, and rollback are verified;
- exact unavailable scopes remain visibly unavailable;
- no real Simon data or secret entered the repository or evidence;
- protected production activation remains human-approved.

---

# 32. Required final implementation report

Report:

1. Baseline and final commit SHAs.
2. Document-graph and requirement-import results.
3. Canonical models, migrations, services, and interfaces implemented.
4. Data-minimization and attribute catalogs.
5. Source/connector modes and exact certified scope.
6. Workbook template version and field contract.
7. Mapping, person-resolution, and policy behavior.
8. Joiner/mover/leaver/reinstatement outcomes.
9. Cognito invitation and SSO-migration evidence.
10. SCIM behavior and provider fixtures.
11. Simon synthetic, corporate, and nonprofit results.
12. Unit/property/mutation/integration/E2E/security/accessibility counts.
13. Cross-tenant and identity-takeover test results.
14. Performance, freshness, revocation, and reconciliation measurements.
15. Deployment workflow/run IDs and artifact/config/schema digests.
16. Rollback/restore evidence.
17. Security, privacy, FERPA-oriented, retention, and incident controls.
18. Every failure, unchecked requirement, external blocker, owner, and next executable action.

Use factual language. Do not claim complete, compliant, certified, global, real-time, secure, or production-ready without exact evidence.

---

# 33. Authoritative implementation references

- NIST SP 800-63-4 Digital Identity Guidelines: https://pages.nist.gov/800-63-4/
- NIST SP 800-63B Authentication and Authenticator Management: https://pages.nist.gov/800-63-4/sp800-63b.html
- AWS Cognito multi-tenant application best practices: https://docs.aws.amazon.com/cognito/latest/developerguide/multi-tenant-application-best-practices.html
- AWS Cognito app-client multi-tenancy: https://docs.aws.amazon.com/cognito/latest/developerguide/application-client-based-multi-tenancy.html
- AWS Cognito user-pool-per-tenant model: https://docs.aws.amazon.com/cognito/latest/developerguide/bp_user-pool-based-multi-tenancy.html
- AWS Cognito security best practices: https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-security-best-practices.html
- AWS Cognito federated identity linking: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-identity-federation-consolidate-users.html
- AWS AdminLinkProviderForUser API: https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminLinkProviderForUser.html
- IETF RFC 7643 SCIM Core Schema: https://www.rfc-editor.org/info/rfc7643
- IETF RFC 7644 SCIM Protocol: https://www.rfc-editor.org/info/rfc7644
- IETF RFC 9865 SCIM Cursor Pagination: https://www.rfc-editor.org/info/rfc9865
- U.S. Department of Education FERPA resources: https://studentprivacy.ed.gov/ferpa
- U.S. Department of Education identity-authentication guidance: https://studentprivacy.ed.gov/sites/default/files/resource_document/file/Identity_Authentication_Best_Practices_0.pdf
- EU General Data Protection Regulation, including data-minimization principles: https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng
- OWASP CSV/Formula Injection: https://owasp.org/www-community/attacks/CSV_Injection
- OWASP File Upload Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- OWASP Application Security Verification Standard: https://owasp.org/www-project-application-security-verification-standard/

These sources inform implementation controls. They do not replace tenant counsel, contractual review, institutional policy, provider certification, or evidence.

## END CLAUDE CODE IMPLEMENTATION BIBLE
