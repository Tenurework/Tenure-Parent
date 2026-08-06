# Tenure Global Deployer Integration Catalog, Tenant Connection Composer, and Major App Certification Bible

**Version:** 1.0  
**Date:** 2026-08-05  
**Status:** Binding Global Deployer and connector-catalog extension  
**Requirement prefix:** `CAT-*`  
**Runtime:** Tenure vendor cloud in Tenure-owned AWS only  
**Purpose:** Make integrations a first-class, countable, configurable, costed, deployable, and truthfully certified tenant dimension  

---

## BEGIN CLAUDE CODE MASTER PROMPT

You are the principal Tenure Global Deployer architect, enterprise integration portfolio architect, schema-driven configuration engineer, SaaS product-line engineer, cloud architect, security engineer, FinOps engineer, UX architect, and implementation owner for the **Integration Catalog and Tenant Connection Composer**.

Build the Global Deployer capability that lets the Tenure implementation team define exactly which integration capabilities, providers, accounts, workspaces, sites, legal entities, business units, regions, environments, and connection counts a tenant requires. Compile those choices into signed desired state, provider-application requirements, AWS capacity, connector releases, tenant UI, authorization/consent tasks, test plans, cutover steps, operations, cost, and evidence.

Do not implement integrations as a flat logo wall or one Boolean per vendor. One tenant may need:

- two Microsoft Entra tenants after an acquisition;
- one Microsoft 365 organization but hundreds of selected SharePoint sites;
- six Slack workspaces and one enterprise-grid organization;
- Google Workspace for one subsidiary and Microsoft 365 for another;
- one Salesforce production org plus three sandboxes;
- separate NetSuite accounts or SAP clients by legal entity/region;
- multiple Stripe connected accounts by merchant legal entity under the Payments Bible;
- different banks, payroll providers, carriers, EDI partners, warehouses, plants, learning systems, and healthcare endpoints;
- personal delegated connections in addition to organization-managed connections;
- no connector at all for a capability Tenure supplies natively.

The Deployer must express this without hard-coded tenant logic and without forcing nontechnical implementation staff to reason about OAuth endpoints, queues, or AWS services.

## 0. Constitutional relationship

Read the current Tenure Constitution, Unified Master Prompt, Declarative Tenant Configurator Bible, Pack Factory Bible, Global Integration Bible, Universal Work Graph Bible, System Studio Bible, Tenant Experience System Bible, core domain Bibles, Payments Bible, and relevant industry packs.

This Bible owns:

- the integration catalog visible in Global Deployer;
- capability/provider/product taxonomy;
- tenant connection cardinality and count rules;
- conditional integration questions and provider-instance repetition;
- pack-to-integration requirements and compatibility resolution;
- integration desired state compilation into tenant manifests;
- cost/capacity/provider-review/test/cutover consequences;
- the major-app and industry integration roadmap;
- catalog truth, lifecycle, prioritization, and coverage reporting.

The Universal Work Graph Bible owns end-user connection, Relay, cross-app work, source ACL/RAG, and external action semantics. The Global Integration Bible owns shared runtime, connector SDK, auth, events, transformations, and certification. The Configurator Bible owns the general schema/evaluation/state engine. The Pack Factory owns ERP archetype composition. Payments and domain Bibles own their specialized invariants.

## 1. Core rule: configure capabilities and counts, not logos

Every tenant integration requirement is a typed `IntegrationCapabilityRequirement`, not a vendor checkbox.

Minimum object:

```yaml
apiVersion: tenure.io/integrations/v1
kind: IntegrationCapabilityRequirement
metadata:
  id: tenant-acme-collaboration-mail
  tenantId: tenant_acme
spec:
  capability: collaboration.email
  lifecycle: required_at_go_live
  cardinality:
    minimum: 1
    maximum: 3
    countBy: external_organization
  providerPolicy:
    mode: ONE_OR_MORE_OF
    eligibleProviderProducts:
      - microsoft.outlook-mail
      - google.gmail
    mixedProvidersAllowed: true
  scope:
    legalEntities: [acme_us, acme_de]
    businessUnits: [corporate]
    regions: [us, eu]
    environments: [production]
  direction: BIDIRECTIONAL_WITH_FIELD_OWNERSHIP
  requiredCapabilities:
    - message.search
    - message.read.selected
    - draft.create
    - message.send.confirmed
  relay:
    search: true
    summarize: true
    draft: true
    externalActions: confirmed_only
    memoryCapture: reviewed_candidate_only
  availabilityPolicy:
    blockGoLiveIfUnsatisfied: true
```

### 1.1 Cardinality modes

Support:

- `EXACTLY_N`
- `AT_LEAST_N`
- `AT_MOST_N`
- `BETWEEN_MIN_MAX`
- `ONE_PER_DIMENSION_VALUE`
- `ZERO_OR_MORE`
- `ONE_OR_MORE`
- `ALL_SELECTED_PROVIDERS`
- `ONE_OF_PROVIDER_SET`
- `N_OF_PROVIDER_SET`
- `PRIMARY_PLUS_BACKUP`
- `PER_USER_OPTIONAL`
- `PER_USER_REQUIRED`
- `DISCOVERED_THEN_APPROVED`

Count dimensions include:

- tenant;
- external organization/tenant/account;
- legal entity;
- subsidiary;
- division/business unit/department;
- country/region/data-residency zone;
- environment;
- merchant entity;
- payroll population;
- bank account/bank/channel;
- warehouse/plant/site/store;
- project/program/client;
- provider workspace/site/channel/folder;
- partner/vendor/customer;
- user/seat/group;
- device/facility/system endpoint.

The Deployer distinguishes:

1. **Connection instances** — authenticated provider accounts/organizations.
2. **Selected resources** — sites, channels, folders, mailboxes, calendars, etc. under a connection.
3. **Entitled capacity** — contractual maximum or billable units.
4. **Provisioned capacity** — AWS/runtime resources reserved.
5. **Active usage** — current resources/users/objects/events/actions.

Do not count one SharePoint site as one Microsoft tenant, one Slack channel as one workspace connection, or one Stripe connected account as one tenant.

## 2. Schema-driven Global Deployer flow

The Integration step is generated from schemas and the tenant decision graph. It appears only after organization, scale, geography, industry, operating model, deployment isolation, modules, system-of-record, identity, and legal-entity choices are sufficiently known.

### 2.1 Required sections

1. **Existing system landscape** — provider products, editions, organizations/accounts, environments, versions, owners, contracts, data locations, and planned retirement.
2. **Required business capabilities** — capability-first requirements derived from selected Tenure modules, packs, coexistence, migration, and user journeys.
3. **Provider resolution** — eligible certified provider packs, native Tenure option, generic protocol, or truthful gap.
4. **Connection quantities** — cardinality and dimension values; add/remove/repeat connection-instance forms.
5. **Ownership and consent** — business owner, technical owner, installer/admin, service identity, personal versus organization grant.
6. **Scope and resources** — object types, accounts, sites, channels, folders, populations, date ranges, directions, filters, and exclusions.
7. **Authority and system of record** — external/Tenure ownership by domain/object/field and conflict policy.
8. **Relay and memory** — search, summarize, draft, external actions, automation, analytics, and reviewed memory-capture permissions.
9. **Security and compliance** — classification, residency, retention, legal hold, DLP, regulated data, private content, egress, IP/mTLS, provider review.
10. **Performance and capacity** — users, objects, historical volume, daily change rate, action rate, file size, latency/freshness, backfill window, quotas.
11. **Cost and commercial readiness** — provider license, marketplace, verification, Tenure entitlement, AWS run cost, egress, index/model cost, implementation effort.
12. **Test, migration, and cutover** — sandbox/test tenant, fixtures, mapping, reconciliation, UAT, freeze/delta/cutover, rollback, hypercare.
13. **Operations and lifecycle** — owner succession, token/certificate renewal, provider changes, outage, hibernate, offboard, purge.

### 2.2 Conditional branching examples

- If `collaboration.email = Tenure native only`, hide Gmail/Outlook questions.
- If `microsoft.outlook-mail` is selected, ask Entra tenant count, delegated/application mode, shared mailboxes, send-as behavior, admin consent, and mailbox selectors.
- If `google.gmail` requests organization-wide access, surface domain-wide delegation, Google verification, high-risk scope, administrator, and policy gates.
- If a user needs only free/busy, request calendar availability capability rather than full event detail.
- If Slack private channels or DMs are selected, require explicit privacy review and narrowly selected scope; default them off.
- If Zoom recordings/transcripts are enabled, require recording-consent, retention, jurisdiction, host/group, and deletion rules.
- If Salesforce is system of record for customer master but Tenure owns invoicing, generate object/field ownership and order-to-cash reconciliation questions.
- If SAP is corporate finance primary and Tenure is subsidiary operations primary, generate two-tier coexistence mappings and consolidation/cutover requirements.
- If Stripe payouts/cards are selected, import the entire Payments Bible and legal-entity/merchant/risk configuration.
- If a provider pack is not certified for selected country/API/edition, mark the requirement unsatisfied and block availability/go-live according to policy.

### 2.3 Repeated connection forms

The operator can add one instance at a time or bulk-import a reviewed landscape inventory. Each repeated card shows:

- friendly name and purpose;
- provider/product/edition/API environment;
- external organization/account/workspace identity;
- legal entity/business-unit/region/environment coverage;
- connection class and owners;
- selected capabilities and resources;
- expected user/object/event/action volumes;
- lifecycle and readiness;
- provider/Tenure/AWS costs;
- dependencies, limitations, test, and approval status.

`Add another` must preserve the schema, not clone credentials or hidden IDs. Duplicates are detected by verified provider account/workspace identity.

## 3. Configuration state and change management

Every requirement and connection instance follows field, section, and aggregate states from the Configurator Bible. Integration-specific aggregate states:

```text
UNDECLARED
→ REQUIRED
→ PROVIDER_SELECTED
→ INSTANCE_DEFINED
→ OWNER_ASSIGNED
→ AUTHORIZATION_PLANNED
→ SCOPE_DEFINED
→ CAPACITY_SIZED
→ COSTED
→ SECURITY_REVIEWED
→ TEST_PLANNED
→ APPROVED_DESIRED_STATE
→ DEPLOYED_NOT_CONNECTED
→ CONNECTED_VALIDATING
→ CERTIFIED_FOR_TENANT
→ ACTIVE
```

Exceptional states:

```text
UNSATISFIED_REQUIREMENT
NO_ELIGIBLE_PROVIDER
CONNECTOR_NOT_BUILT
PROVIDER_REVIEW_PENDING
EXTERNAL_ADMIN_PENDING
CONTRACT_LICENSE_PENDING
REGION_BLOCKED
SCOPE_CONFLICT
SYSTEM_OF_RECORD_CONFLICT
CAPACITY_RISK
COST_REVIEW_REQUIRED
MAPPING_INCOMPLETE
RECONCILIATION_FAILED
DEGRADED
SUNSET_REQUIRED
```

Changing an upstream decision re-evaluates the graph. Examples:

- adding Germany may invalidate a US-only provider/cell and require EU placement;
- enabling Finance may add bank, tax, payment, expense, and ERP coexistence requirements;
- changing tenant size may change connector worker class, queue partition, rate allocation, and cost;
- merging legal entities may reduce or expand provider account count;
- disabling a module may not automatically delete a connector still used by another module;
- switching system of record may invert direction, mappings, cutover, reconciliation, and data-retention duties.

Never silently delete a configured instance. Mark it stale, explain the cause and impact, preserve history, and require an explicit migrate/retire decision.

## 4. Desired-state compiler output

Compile approved choices into versioned, signed objects:

- `TenantIntegrationPortfolio`
- `IntegrationCapabilityRequirement`
- `ProviderInstanceDesiredState`
- `ConnectionTemplate`
- `ConnectionCardinalityPolicy`
- `ResourceSelectionPolicy`
- `SystemOfRecordMapping`
- `DataFlowDefinition`
- `RelayCapabilityPolicy`
- `ExternalActionPolicy`
- `ProviderAuthorizationPlan`
- `ProviderApplicationDependency`
- `ProviderReviewDependency`
- `ConnectorCapacityPlan`
- `ConnectorCostPlan`
- `ConnectorPlacementPlan`
- `SubscriptionPlan`
- `SyncBackfillPlan`
- `MappingSetRequirement`
- `ConnectorTestPlan`
- `ConnectorCutoverPlan`
- `ConnectorLifecyclePlan`
- `IntegrationGap`

### 4.1 Application and AWS plan

For each instance/capability, compute:

- connector package/release and compatible provider API version;
- cell/region/account placement and data-residency boundary;
- callback/webhook domains and provider app registration dependencies;
- token-vault partition and KMS context;
- queue, DLQ, scheduler, concurrency, worker/runtime, object storage, database/index, logs/metrics, and backup needs;
- fixed egress IP, private network, mTLS, VPN/direct-connect/customer allowlist requirements where applicable;
- initial backfill and steady-state load;
- SLO/freshness and recovery tier;
- estimated monthly AWS/provider/model/index cost with assumptions;
- provider sandbox, test account, verification/marketplace, customer admin, and contract dependencies;
- release, migration, test, activation, rollback, and support ownership.

Generate shared infrastructure only when isolation, residency, performance, security, and blast-radius policy allow it. Reuse connector code and control services; do not duplicate entire service stacks per connection by default.

### 4.2 Count validation

The compiler must reject or warn on:

- fewer instances than the capability minimum;
- more instances than plan/tenant maximum;
- missing dimension coverage;
- duplicate provider account/workspace identity;
- unsupported provider mix;
- one connection assigned across incompatible regions/legal entities;
- one personal connection satisfying an organization-wide requirement;
- a provider instance with no capability consumer;
- a module/pack requiring a connector not selected;
- conflicting field/system-of-record ownership;
- no technical/business owner or owner departing before go-live;
- uncosted, unlicensed, unreviewed, or uncertified go-live dependency;
- unsafe concentration when primary-plus-backup is required;
- excessive fragmentation that causes avoidable cost or operational load.

## 5. Global Deployer experience

### 5.1 Integration Portfolio view

Provide:

- capability coverage map;
- provider instances grouped by business purpose and dimension;
- required/optional/future/retiring filters;
- counts: required, configured, connected, certified, active, degraded, blocked;
- instance cards and dense table toggle;
- dependency graph by module/pack/process;
- system-of-record topology;
- geographic/data-flow map only when it improves understanding;
- total estimated cost and cost drivers;
- external approvals/provider reviews/contracts still required;
- go-live blockers and test/cutover readiness;
- desired/planned/actual comparison and drift.

### 5.2 Nontechnical setup behavior

- Ask “Where does your team email live?” before “Choose Microsoft Graph scopes.”
- Recommend the least-access configuration that fulfills selected workflows.
- Display exact counts in friendly language: “2 of 3 required finance-system connections configured.”
- Let operators save/resume, go back/forward, compare versions, create branches, comment, request review, and undo uncommitted changes.
- Explain downstream impact before removal, provider change, scope expansion, or instance-count change.
- Keep secrets and provider sign-in outside the declarative draft; connection authorization occurs through the secure workflow after approval.
- Advanced mode exposes provider product, auth class, object/action list, rate assumptions, mappings, placement, queues/workers, and evidence.
- Follow Global Deployer UX tokens and interaction rules; it remains distinct from tenant Connection Center UX.

### 5.3 Relay assistance in Global Deployer

Relay may:

- infer candidate requirements from approved discovery documents and landscape inventories;
- explain why a selected pack needs a capability;
- identify missing coverage, duplication, ownership conflicts, unsupported region, or likely cost drivers;
- propose provider choices from eligible certified packs;
- draft mappings, selectors, test cases, and migration/cutover tasks;
- generate a change impact summary.

Relay cannot select production credentials, consent for a customer, approve scope, accept provider terms, finalize system-of-record ownership, waive a certification gap, approve cost/security, or activate an integration.

## 6. Catalog truth and lifecycle

Each provider product/capability has one of:

```text
INVENTORY_ONLY
ROADMAP_CANDIDATE
PLANNED
SPECIFIED
IN_DEVELOPMENT
SANDBOX_VALIDATED
PROVIDER_REVIEW_PENDING
TENURE_CERTIFIED
TENANT_ELIGIBLE
TENANT_CONNECTED
TENANT_ACTIVE
DEGRADED
SUSPENDED
DEPRECATED
REVOKED
UNSUPPORTED
```

Catalog visibility and connector availability are different. All major applications may appear in the Deployer’s planning catalog, but only exact `TENANT_ELIGIBLE` capabilities offer a connect/deploy path. An operator may record an `INVENTORY_ONLY` system to plan migration or coexistence without implying Tenure has an adapter.

Every entry shows:

- provider, product, edition/API where relevant;
- capability list and directions;
- auth/install classes;
- countries/regions/data classes;
- connector and certification release;
- provider review/marketplace status;
- known limits and unsupported objects/actions;
- pricing/licensing and Tenure entitlement assumptions;
- lifecycle and support owner;
- evidence expiry and recertification trigger.

## 7. Build waves

Priorities guide architecture and implementation; they are not availability claims.

### Wave 0 — Universal substrate

- OAuth/OIDC, SAML/SCIM, API key, mTLS, JWT, service account, signed webhook;
- REST, GraphQL, SOAP where required, OData, JDBC/read-only database patterns;
- webhooks/events, polling/delta/history, SFTP/managed file transfer;
- CSV/TSV/JSON/XML, EDI X12/EDIFACT, ISO 20022, HL7/FHIR where applicable;
- AWS EventBridge/SQS/SNS/Kinesis/S3 integration patterns;
- connector SDK, credential broker, rate governor, mapping, reconciliation, certification, tenant connection composer.

### Wave 1 — Universal workspace and communication

- Microsoft Outlook, Calendar, People, Teams, SharePoint, OneDrive, Planner/To Do;
- Google Gmail, Calendar, Drive/Docs, People, Meet, Chat, Tasks;
- Slack;
- Zoom Meetings/Webinars/recordings/transcripts;
- Notion;
- Box.

### Wave 2 — Work management, content, meetings, and signature

- Dropbox, Jira, Confluence, Asana, Monday.com, Linear, ClickUp, Trello, Smartsheet, Airtable, Coda, Miro, Wrike, Basecamp;
- Webex, RingCentral;
- DocuSign, Adobe Acrobat Sign;
- Egnyte, ShareFile;
- Figma, Canva, Lucid where approved asset/work metadata use cases justify them.

### Wave 3 — Horizontal enterprise systems

- CRM/customer service, ITSM, core ERP/accounting, HCM/payroll, spend/expense, tax, commerce, developer/IT/security, data/BI.

### Wave 4 — Specialized industry ecosystems

- manufacturing/PLM/MES/QMS/LIMS/IoT;
- supply chain/EDI/logistics/trade;
- healthcare/life sciences;
- construction/field service/real estate;
- education/nonprofit/public sector;
- retail/hospitality;
- other certified industry packs driven by customer demand and regulation.

## 8. Major application and system catalog

The following is the mandatory planning inventory as of this version. It is intentionally provider-neutral at runtime and must be maintained as products/API surfaces change. Listing means “must be considered and classifiable,” not “available.”

### 8.1 Productivity, communication, knowledge, content, and work management

| Capability family | Major provider products to catalog |
|---|---|
| Microsoft work suite | Microsoft Entra ID, Outlook Mail, Outlook Calendar, Microsoft Teams, SharePoint, OneDrive, Planner, To Do, Forms, Viva where an exact use case is certified |
| Google work suite | Google Cloud Identity/Workspace Directory, Gmail, Calendar, Drive, Docs, Sheets, Slides, Meet, Chat, Tasks, People, Groups |
| Chat and collaboration | Slack, Webex, RingCentral, Zoom Team Chat, Mattermost where demanded |
| Meetings/voice/contact | Zoom Meetings/Webinars/Phone/Contact Center, Microsoft Teams Meetings/Calling, Google Meet, Webex, RingCentral, Twilio, Genesys Cloud, Five9, NICE CXone, Talkdesk |
| Knowledge/wiki | Notion, Confluence, Coda, Slab, Guru |
| Content/file platforms | Box, Dropbox Business, Egnyte, Citrix ShareFile, SharePoint/OneDrive, Google Drive |
| Project/work management | Jira, Asana, Monday.com, Linear, ClickUp, Trello, Smartsheet, Wrike, Basecamp, Airtable |
| Whiteboard/design | Miro, Lucidchart/Lucidspark, Figma, Canva |
| E-signature | DocuSign, Adobe Acrobat Sign, Dropbox Sign |
| Personal task/calendar feeds | Microsoft To Do, Google Tasks, Todoist, Apple Calendar/iCloud through approved ICS/iCalendar or separately certified CalDAV patterns; read-only calendar subscriptions remain distinct from two-way calendar control |

### 8.2 CRM, revenue, marketing, customer service, and communications

| Capability family | Major provider products to catalog |
|---|---|
| Enterprise CRM | Salesforce Sales Cloud, Microsoft Dynamics 365 Sales, SAP Sales/Service Cloud, Oracle CX Sales, HubSpot CRM, Zoho CRM, Pipedrive, SugarCRM, Freshsales |
| Customer service/IT-facing support | Salesforce Service Cloud, ServiceNow CSM, Zendesk, Intercom, Freshdesk/Freshworks, Jira Service Management, Kustomer |
| CPQ/revenue/subscription | Salesforce Revenue Cloud/CPQ, Conga, Zuora, Chargebee, Recurly, Oracle CPQ, SAP CPQ |
| Marketing automation | Adobe Marketo Engage, HubSpot Marketing Hub, Salesforce Marketing Cloud, Mailchimp, Klaviyo, Braze, Iterable, Oracle Eloqua |
| Messaging/delivery | Twilio, SendGrid, Amazon SES/SNS, Mailgun, Sinch |
| CDP/customer data | Salesforce Data Cloud, Twilio Segment, Adobe Experience Platform, Tealium, mParticle |
| Social/customer listening | Sprout Social, Hootsuite, Semrush where exact governed workflows exist |

### 8.3 Core ERP, accounting, finance, planning, spend, tax, and treasury

| Capability family | Major provider products to catalog |
|---|---|
| Tier-1 ERP suites | SAP S/4HANA and relevant cloud suite APIs, Oracle Fusion Cloud Applications, Microsoft Dynamics 365 Finance/Supply Chain, Workday Financial Management |
| Mid-market/cloud ERP | Oracle NetSuite, Intuit Enterprise Suite/QuickBooks Online, Sage Intacct, Sage X3, Acumatica, Odoo, Epicor Kinetic/Prophet 21, Infor CloudSuite, IFS Cloud, Unit4 ERP, QAD, SYSPRO, Deltek, Plex |
| Accounting/bookkeeping | QuickBooks Online, Xero, Sage Accounting/Intacct, FreshBooks where demanded |
| Spend/procurement | Coupa, SAP Ariba, Oracle Procurement, Jaggaer, GEP SMART, Ivalua |
| Expense/travel/cards | SAP Concur, Ramp, Brex, BILL Spend & Expense, Expensify, Navan, Airbase |
| AP/payables | BILL, Tipalti, AvidXchange, Coupa Pay, MineralTree |
| Close/reconciliation | BlackLine, FloQast, Trintech |
| Tax | Avalara, Vertex, Thomson Reuters ONESOURCE, Sovos |
| Planning/EPM | Anaplan, Oracle EPM, SAP Analytics Cloud Planning, Workday Adaptive Planning, Pigment, Planful, Vena |
| Treasury/banking connectivity | Kyriba, GTreasury, TIS, Modern Treasury, Plaid, MX, Mastercard Finicity, bank APIs/SFTP/ISO 20022/SWIFT subject to certification |
| Payments/merchant/acquiring | Stripe under Payments Bible, Adyen, PayPal/Braintree, Square, Checkout.com, Worldpay, Fiserv, Global Payments, Airwallex, Wise Business where separately certified |

Money movement, merchant liability, cards, accounts, payout, treasury, settlement, dispute, reserve, KYC/KYB, fraud, and reconciliation can never be enabled from this catalog alone. Import the Payments Bible and provider-specific legal/certification work.

### 8.4 People, payroll, recruiting, learning, benefits, and workforce

| Capability family | Major provider products to catalog |
|---|---|
| Enterprise HCM | Workday HCM, SAP SuccessFactors, Oracle HCM Cloud, Microsoft Dynamics 365 Human Resources |
| Workforce/payroll | ADP, UKG, Dayforce, Rippling, Paychex, Gusto, Deel, Remote, BambooHR |
| Recruiting/ATS | Greenhouse, Lever, iCIMS, SmartRecruiters, Workday Recruiting, SAP SuccessFactors Recruiting, Oracle Recruiting, Eightfold |
| Learning/talent | Cornerstone, Docebo, Workday Learning, SAP SuccessFactors Learning, Degreed |
| Engagement/performance | Culture Amp, Lattice, 15Five |
| Benefits | benefit carriers/brokers and enrollment platforms only with exact carrier/file/API certification |
| Scheduling/time | UKG, ADP, Dayforce, Deputy, When I Work where selected populations and jurisdictions are certified |

Payroll remains jurisdiction/provider/population certified. No catalog selection activates payroll calculation, tax filing, or employee payment without the People and Finance domain gates.

### 8.5 Identity, IT, security, observability, and developer systems

| Capability family | Major provider products to catalog |
|---|---|
| Identity/directory | Microsoft Entra ID, Okta, Ping Identity, Google Cloud Identity, JumpCloud, OneLogin, Auth0 where customer coexistence requires it |
| MFA/device/access | Cisco Duo, Microsoft Intune, Jamf, Kandji, VMware Workspace ONE |
| Endpoint/cloud security | CrowdStrike, SentinelOne, Microsoft Defender, Palo Alto Networks, Zscaler, Wiz |
| SIEM/security operations | Microsoft Sentinel, Splunk, Google Security Operations, IBM QRadar |
| ITSM/CMDB | ServiceNow, Jira Service Management, BMC Helix, Freshservice |
| Source/code | GitHub, GitLab, Bitbucket, Azure DevOps |
| CI/CD | GitHub Actions, GitLab CI, Azure Pipelines, Jenkins, CircleCI |
| Observability | Datadog, New Relic, Dynatrace, Splunk Observability, Sentry |
| Incident/on-call | PagerDuty, Opsgenie, incident.io |
| Cloud/platform | AWS Organizations/IAM/CloudTrail/Config/Security Hub/GuardDuty/Cost Explorer under the System Studio Bible; customer Azure/GCP metadata only through governed connectors |

Code, logs, tickets, alerts, and incident transcripts are untrusted external content for Relay. Repository secrets, CI secrets, raw security telemetry, and privileged actions require separate policies.

### 8.6 Data, analytics, integration, and databases

| Capability family | Major provider products to catalog |
|---|---|
| Warehouses/lakehouses | Snowflake, Databricks, Google BigQuery, Amazon Redshift, Microsoft Fabric/Synapse |
| BI | Microsoft Power BI, Tableau, Looker, Qlik, ThoughtSpot |
| Transformation/orchestration | dbt Cloud, Fivetran, Airbyte, Matillion |
| iPaaS coexistence | MuleSoft, Boomi, Informatica, Workato, SnapLogic, Celigo, Zapier, Make only as governed migration/coexistence dependencies |
| Streaming/messaging | Apache Kafka/Confluent, Amazon Kinesis/EventBridge/SQS/SNS, Azure Event Hubs, Google Pub/Sub |
| Databases | PostgreSQL, MySQL, SQL Server, Oracle Database, MongoDB, approved JDBC/ODBC/read replica patterns |
| Object/file | Amazon S3, Azure Blob Storage, Google Cloud Storage, SFTP/FTPS, managed file transfer |

External data/BI tools receive governed exports or shares. External AI model APIs may not receive Tenure customer records through a generic connector; Relay inference remains in the approved AWS-hosted model boundary.

### 8.7 Commerce, retail, hospitality, and marketplaces

| Capability family | Major provider products to catalog |
|---|---|
| Ecommerce | Shopify, Adobe Commerce/Magento, WooCommerce, BigCommerce, Salesforce Commerce Cloud, SAP Commerce Cloud |
| Marketplaces | Amazon Seller/Vendor, eBay, Walmart Marketplace |
| POS/retail | Square, Lightspeed, Clover, NCR Voyix |
| Restaurant/hospitality | Toast, Oracle MICROS where customer demand and certifications exist |
| Subscriptions | Zuora, Chargebee, Recurly |

Orders, customers, inventory, fulfillment, refunds, tax, payment, payout, marketplace, and privacy capabilities are separately mapped and reconciled; one commerce connection is not blanket money authorization.

### 8.8 Supply chain, logistics, EDI, and trade

| Capability family | Major provider products to catalog |
|---|---|
| EDI/partner networks | SPS Commerce, TrueCommerce, E2open, Cleo, IBM Sterling; X12/EDIFACT/AS2/SFTP patterns |
| Visibility/TMS | project44, FourKites, Descartes, Manhattan Associates, Blue Yonder |
| Shipping APIs | Shippo, ShipStation, EasyPost, UPS, FedEx, DHL, USPS |
| Freight | Flexport and certified freight/carrier platforms |
| Supplier/procurement networks | SAP Business Network/Ariba, Coupa Supplier Portal, Oracle Supplier Portal |
| Global trade | Descartes, E2open and certified customs/restricted-party providers |
| Barcode/RFID/device | GS1 identifiers and certified device/gateway feeds |

### 8.9 Manufacturing, engineering, asset, quality, and laboratories

| Capability family | Major provider products to catalog |
|---|---|
| PLM/PDM | Siemens Teamcenter, Dassault Systèmes 3DEXPERIENCE/ENOVIA, PTC Windchill, Autodesk Fusion Manage/Upchain, Arena PLM, Aras Innovator |
| MES/shop floor | Siemens Opcenter, Rockwell FactoryTalk, Tulip, Epicor Advanced MES |
| Industrial/IoT | PTC ThingWorx, Inductive Automation Ignition, AWS IoT; OPC UA/MQTT gateways under safety-bounded designs |
| QMS | MasterControl, ETQ Reliance, TrackWise Digital, Veeva Vault Quality |
| LIMS | LabVantage, LabWare, STARLIMS |
| EAM/maintenance | IBM Maximo, SAP EAM, Oracle Maintenance, IFS EAM, Fiix |

Tenure must not claim to replace control systems, CAD kernels, MES safety controls, clinical systems, or validated quality systems through a connector. Read/write actions are bounded by system and safety authority.

### 8.10 Healthcare and life sciences

| Capability family | Major provider products/standards to catalog |
|---|---|
| EHR/clinical | Epic, Oracle Health/Cerner, athenahealth, MEDITECH via supported FHIR/HL7 interfaces and customer authorization |
| Life sciences | Veeva Vault families, Salesforce Health Cloud, validated QMS/LIMS/clinical platforms |
| Standards/exchange | HL7 v2, FHIR, X12 healthcare transactions where exact use case and compliance are certified |

PHI/clinical data is excluded by default. HIPAA/BAA, minimum necessary, clinical safety, consent, audit, retention, breach, data residency, and customer security review are mandatory external and architecture gates.

### 8.11 Construction, real estate, field service, and asset-intensive work

| Capability family | Major provider products to catalog |
|---|---|
| Construction/project controls | Procore, Autodesk Construction Cloud, Oracle Primavera P6, Sage Construction and Real Estate, Trimble Viewpoint |
| Residential/SMB construction | Buildertrend |
| Field service | Salesforce Field Service, Microsoft Dynamics 365 Field Service, ServiceNow Field Service, ServiceTitan, Jobber |
| Property/real estate | Yardi, MRI Software where customer demand exists |

### 8.12 Education, nonprofit, and public sector

| Capability family | Major provider products to catalog |
|---|---|
| Student information | Ellucian Banner, Oracle PeopleSoft Campus Solutions, Workday Student, Anthology Student |
| Learning management | Canvas, Blackboard, D2L Brightspace, Moodle |
| Education CRM/engagement | Salesforce Education Cloud, Slate where authorized |
| Nonprofit/fundraising | Blackbaud/Raiser’s Edge NXT, Salesforce Nonprofit Cloud, Bloomerang, Classy, DonorPerfect, Bonterra |
| Public administration | Tyler Munis/ERP, OpenGov, Granicus, Oracle/SAP public-sector interfaces |
| Research/grants | customer-specific research administration and grants portals through certified APIs/files |

For Simon OSE, live connectors require separate University approval. The pilot may start with controlled imports/links and Tenure-native finance tracking, approvals, calendar, files, and memory while provider connections remain truthfully gated.

## 9. Provider-pack minimum specification

Every provider product/capability selected from the catalog must define:

- business outcomes and personas;
- provider/API/product/edition/version/environment;
- canonical capabilities, objects, actions, events, files, reports, and admin operations;
- connection and installer classes;
- exact scopes/permissions/roles and provider review;
- account/workspace/resource discovery and verification;
- resource selectors and count semantics;
- source-of-record/field ownership and loop prevention;
- initial backfill, incremental changes, webhooks/subscriptions, polling, cursor/watermark;
- pagination, limits, rate/quota, batching, concurrency, large object/file behavior;
- idempotency, conditional updates, duplicates, ordering, partial success, ambiguous outcomes;
- mappings, extensions/custom fields, schema changes, deletion/tombstone, versioning;
- security, privacy, classification, residency, retention, legal hold, DLP, provider terms;
- Relay read/draft/action/memory tools and risk;
- tenant Connection Center and Global Deployer UX;
- monitoring, health, reconciliation, support, provider escalation, deprecation;
- suspend/hibernate/reactivate/offboard/purge;
- sandbox/test tenant, fixtures, contract/negative/volume/failure/E2E tests;
- certification scope/evidence/expiry and rollback.

If any item is inapplicable, document why. Absence cannot be hidden by a generic SDK.

## 10. Integration portfolio cost and capacity

For each tenant calculate:

- number of provider app installations and connection instances;
- selected users, groups, resources, and service accounts;
- API requests/events/files per unit time;
- initial backfill objects/bytes/duration;
- steady-state change and action rate;
- provider quota allocation and marketplace/plan constraints;
- Lambda/ECS/Step Functions/EventBridge/SQS/S3/database/search/KMS/NAT/egress/observability/model costs;
- licensing and externally borne provider costs when known;
- implementation/certification/support complexity;
- shared versus dedicated connector placement;
- hibernation residuals and offboarding cost.

Show low/base/high estimates with assumptions and sensitivity. A tenant choosing ten integrations sees the incremental cost and operational impact before approval. Count limits may be entitlements, guardrails, or capacity assumptions; label which.

## 11. Testing and go-live gates

For each tenant integration portfolio prove:

1. every required capability is satisfied by at least the declared cardinality;
2. every configured instance maps to a verified provider identity and declared dimensions;
3. every selected resource is authorized and tested;
4. scopes/permissions are least privilege and provider/customer approvals exist;
5. mappings and source ownership pass golden/negative/conflict tests;
6. backfill and steady-state volume fit quotas/capacity/cost;
7. webhook/cursor/polling gaps, duplicates, ordering, outage, replay, and recovery pass;
8. Relay reads/citations/actions/memory obey policy;
9. reconciliation reaches declared zero/tolerance criteria;
10. cutover and rollback are rehearsed;
11. monitoring/runbooks/owners/support/provider escalation are ready;
12. catalog and tenant UI show exact availability and limitations.

One optional blocked connector must not stop an otherwise safe tenant launch; one required payroll/bank/system-of-record connector may. Applicability and go-live criticality are explicit.

## 12. Evidence-gated checklist

### CAT-000 — Catalog truth and binding

- [ ] CAT-000-001 — Import every `CAT-*` requirement into the master execution ledger and document graph.
- [ ] CAT-000-002 — Inventory every integration/app/system currently named, displayed, configured, coded, deployed, marketed, or used by a tenant.
- [ ] CAT-000-003 — Classify each provider/product/capability/direction/region/version with the exact catalog lifecycle.
- [ ] CAT-000-004 — Bind Catalog requirements to Configurator, Pack Factory, Integration Plane, Work Graph, Payments, core domains, System Studio, Tenant UX, and release evidence.
- [ ] CAT-GATE-000 — The catalog is complete as a planning inventory and honest about implementation.

### CAT-010 — Cardinality and dimensions

- [ ] CAT-010-001 — Implement all cardinality modes and count dimensions.
- [ ] CAT-010-002 — Distinguish connection instances, selected resources, entitled capacity, provisioned capacity, and usage.
- [ ] CAT-010-003 — Implement per-tenant/module/pack/capability/provider/dimension minimums, maximums, and redundancy.
- [ ] CAT-010-004 — Detect duplicate provider identities, missing coverage, unsafe reuse, unsupported mix, and fragmentation.
- [ ] CAT-010-005 — Prove examples with multi-Microsoft/Google tenants, Slack workspaces, Salesforce environments, ERP entities, banks, Stripe accounts, plants, and partners.
- [ ] CAT-GATE-010 — The Deployer can correctly configure how many of each integration a tenant needs.

### CAT-020 — Schema-driven Deployer

- [ ] CAT-020-001 — Implement all thirteen integration configuration sections from declarative schemas.
- [ ] CAT-020-002 — Implement conditional branches for provider, scope, domain, geography, system of record, Relay, privacy, and certification.
- [ ] CAT-020-003 — Implement repeatable connection-instance cards and reviewed bulk landscape import.
- [ ] CAT-020-004 — Implement field/section/aggregate state, save/resume/back/forward, branches, review, history, and downstream invalidation.
- [ ] CAT-020-005 — Preserve stale instances and explain migration/retirement impact rather than silently deleting them.
- [ ] CAT-GATE-020 — Operators can configure complex portfolios safely without hard-coded forms or hidden state.

### CAT-030 — Compiler and desired state

- [ ] CAT-030-001 — Implement every required desired-state object and signed tenant integration portfolio.
- [ ] CAT-030-002 — Compile connector release, app-registration, placement, token, queues/workers, storage/index, network, SLO, capacity, cost, test, cutover, lifecycle, and evidence plans.
- [ ] CAT-030-003 — Implement deterministic count/coverage/dependency/ownership/certification validation.
- [ ] CAT-030-004 — Generate desired/planned/actual diffs and drift reconciliation.
- [ ] CAT-030-005 — Prove the same approved manifest compiles deterministically and a changed upstream choice produces an explainable diff.
- [ ] CAT-GATE-030 — Integration choices become safe executable desired state, not prose or UI-only configuration.

### CAT-040 — Global Deployer UX

- [ ] CAT-040-001 — Implement Integration Portfolio view, capability coverage, counts, instance cards/table, dependencies, SoR topology, cost, blockers, and readiness.
- [ ] CAT-040-002 — Implement recommended safe configuration, progressive disclosure, advanced mode, and impact preview.
- [ ] CAT-040-003 — Implement plain-language questions and exact “configured N of M required” status.
- [ ] CAT-040-004 — Implement Relay proposals/explanations without granting it consent, approval, activation, or waiver authority.
- [ ] CAT-040-005 — Pass accessibility, keyboard, screen-reader, zoom/reflow, high contrast, reduced motion, localization/RTL, responsive, and long-session usability.
- [ ] CAT-GATE-040 — Global Deployer integration configuration is powerful, fast, understandable, and non-fatiguing.

### CAT-050 — Major workspace catalog

- [ ] CAT-050-001 — Register every provider/product family in section 8.1 with exact lifecycle and capabilities.
- [ ] CAT-050-002 — Execute Wave 1 only through the Universal Work Graph provider-pack requirements.
- [ ] CAT-050-003 — Register and prioritize Wave 2 work-management/content/meeting/signature systems.
- [ ] CAT-050-004 — Prove unbuilt catalog entries cannot generate connect/deploy/available states.
- [ ] CAT-GATE-050 — Major workspace systems are visible for planning and exact when enabled.

### CAT-060 — Horizontal enterprise catalog

- [ ] CAT-060-001 — Register CRM, revenue, marketing, service, and communication systems from sections 8.2.
- [ ] CAT-060-002 — Register ERP, accounting, Finance, EPM, spend, tax, treasury, banking, and payment systems from section 8.3.
- [ ] CAT-060-003 — Register HCM, payroll, recruiting, learning, benefit, scheduling, and workforce systems from section 8.4.
- [ ] CAT-060-004 — Register identity, IT, security, developer, observability, incident, data, BI, integration, database, and file systems from sections 8.5–8.6.
- [ ] CAT-060-005 — Bind protected domains to their complete owning Bibles and external certification.
- [ ] CAT-GATE-060 — Horizontal enterprise breadth is cataloged without bypassing domain depth.

### CAT-070 — Industry catalog

- [ ] CAT-070-001 — Register commerce/retail/hospitality systems from section 8.7.
- [ ] CAT-070-002 — Register supply-chain/logistics/EDI/trade systems from section 8.8.
- [ ] CAT-070-003 — Register manufacturing/engineering/asset/quality/lab systems from section 8.9.
- [ ] CAT-070-004 — Register healthcare/life-sciences systems from section 8.10.
- [ ] CAT-070-005 — Register construction/real-estate/field-service systems from section 8.11.
- [ ] CAT-070-006 — Register education/nonprofit/public-sector systems from section 8.12.
- [ ] CAT-070-007 — Enforce safety, regulated-data, institutional-approval, and “connector is not system replacement” boundaries.
- [ ] CAT-GATE-070 — Specialized ERP packs can declare real integration requirements across major industries.

### CAT-080 — Provider-pack certification

- [ ] CAT-080-001 — Enforce every provider-pack minimum specification in section 9.
- [ ] CAT-080-002 — Bind provider/API/scope/review/version/region/edition changes to recertification.
- [ ] CAT-080-003 — Require exact sandbox/test-tenant, negative, volume, outage, lifecycle, and rollback proof.
- [ ] CAT-080-004 — Publish exact objects/actions/events/directions and known limitations per available pack.
- [ ] CAT-GATE-080 — No generic happy path or SDK installation qualifies as a connector.

### CAT-090 — Cost, capacity, release, and final proof

- [ ] CAT-090-001 — Implement portfolio cost/capacity estimates with low/base/high assumptions and attribution.
- [ ] CAT-090-002 — Implement plan/entitlement/capacity/usage count enforcement without confusing them.
- [ ] CAT-090-003 — Run tenant portfolio go-live gates for required versus optional connectors.
- [ ] CAT-090-004 — Bind catalog, desired state, connector releases, provider applications/reviews, config, IaC, mappings, tests, evidence, cutover, support, and rollback into the platform release.
- [ ] CAT-090-005 — Produce the final tenant Integration Portfolio, exact count/coverage matrix, blocked gaps, cost, certification, and lifecycle report.
- [ ] CAT-GATE-090 — The Global Deployer can configure, cost, deploy, verify, and operate the right number of integrations for each tenant.

## 13. Required repository deliverables

```text
docs/architecture/integration-catalog.md
docs/architecture/tenant-connection-cardinality.md
docs/architecture/integration-desired-state-compiler.md
docs/experience/global-deployer-integration-portfolio.md
docs/catalog/providers/
docs/catalog/capabilities/
docs/catalog/industries/
packages/integration-catalog-schema/
packages/connection-cardinality-schema/
packages/integration-desired-state/
services/integration-catalog/
services/integration-portfolio-compiler/
apps/system-studio/tenant-configurator/integrations/
tests/config/integration-portfolios/
tests/e2e/global-deployer-integrations/
evidence/integration-catalog/
```

## 14. Absolute definition of done

This Bible is complete only when:

- every major provider/system family is in the planning catalog with honest lifecycle;
- integration requirements are capability-first and countable across all supported dimensions;
- the Deployer can configure repeated provider instances and selected resources without hard-coded tenant forms;
- integration choices compile deterministically into application/AWS/auth/capacity/cost/test/cutover/lifecycle desired state;
- pack/module/geography/SoR changes re-evaluate dependencies and preserve history;
- required connector gaps block only the right tenant/module/go-live scope;
- available providers pass their entire owning connector and domain Bibles;
- Deployer UX passes security, accessibility, usability, scale, and change-recovery tests;
- catalog truth, costs, limitations, evidence, and rollback ship with the signed release.

## 15. Prohibited shortcuts

Do not:

- use one `integrations: [slack, gmail]` array as the tenant model;
- assume one tenant equals one provider account;
- count selected folders/channels as connection instances;
- satisfy an organization requirement with one employee’s personal token;
- let a catalog listing generate a fake connect button;
- let a selected provider bypass Payments, Finance, People, Operations, security, or industry invariants;
- provision dedicated duplicate AWS infrastructure for every connection without placement/cost justification;
- accept an unbounded `unlimited` connection count without entitlement/capacity/abuse policy;
- delete stale config after an upstream change;
- show a green go-live state while a required provider review, admin consent, contract, mapping, test, or reconciliation is blocked;
- claim the planning catalog is a completed connector marketplace.

## 16. Required final Claude Code response

Report:

1. catalog entries added/changed and exact lifecycle;
2. tenant capability requirements and count/dimension rules;
3. configured versus required connection counts and gaps;
4. compiled desired-state/application/AWS/cost/capacity/test/cutover impact;
5. code/schema/UI/IaC/mapping/test changes;
6. provider review, consent, contract, data-residency, and certification blockers;
7. tests, deployment, evidence, drift, lifecycle, and rollback;
8. next provider/capability vertical slice.

Start with the real tenant landscape and currently selected packs. Build one integration portfolio that contains multiple providers and multiple instances of one provider, compile it deterministically, render it in Global Deployer, and prove count/coverage/cost/go-live behavior before scaling catalog breadth.

## END CLAUDE CODE MASTER PROMPT

---

## Official reference families reviewed

Provider/API details must be revalidated at implementation time using official developer sources. Initial anchors include Microsoft Graph and Entra, Google Workspace APIs and OAuth production readiness, Slack Platform, Zoom Developer Platform, Notion Developers, Box Developer Platform, GitHub Apps, Salesforce Platform Events/Change Data Capture, HubSpot APIs/webhooks, Shopify Admin GraphQL/webhooks, QuickBooks Online APIs/webhooks, SAP Business Accelerator Hub, Oracle Fusion Cloud REST APIs, and the applicable official developer portals for every provider selected for certification.
