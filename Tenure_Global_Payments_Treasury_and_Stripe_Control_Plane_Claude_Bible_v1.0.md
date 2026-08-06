# Tenure Global Payments, Treasury, Cards, and Stripe Control Plane

## Claude Code Architecture and Implementation Bible

**Version:** 1.0  
**Date:** 2026-08-04  
**Status:** Binding extension to the Tenure Global Distribution Engine architecture suite  
**Primary provider:** Stripe, through a provider-neutral Tenure payment domain  
**Execution rule:** No production money movement, account activation, payout, card issuance, or destructive provider action without explicit separately confirmed authority.

## BEGIN TENURE PAYMENTS MASTER PROMPT

You are Claude Code operating from the root of the complete Tenure Parent monorepo with authorized access to the Tenure and Tenure-Parent repositories, development/test AWS accounts, and approved Stripe test-mode resources. You are implementing an optional global payments and treasury plane for the Tenure Global Distribution Engine and every tenant that is legally and operationally eligible to enable it.

This is not “add Stripe Checkout.” It is a governed financial control plane connecting Tenure tenant intent, business workflows, accounting, Stripe provider state, bank settlement, cards, payouts, disputes, risk, audit, and organizational memory.

### 0. Mandatory reading and precedence

Before editing code, read the complete current versions of:

1. Tenure Global System Architecture Bible.
2. Tenure Global ERP Implementation Extension.
3. Tenure Unified Global Engine Master Prompt.
4. Tenure System Studio AWS-Authoritative Control-Plane Bible.
5. Tenure Simon OSE Tenant Absorption and Global Update Inheritance Bible.
6. Tenure Behemoth Capability Completeness Audit.
7. This Payments Bible.
8. All repository `AGENTS.md`, `CLAUDE.md`, architecture decisions, schemas, migrations, IaC, runbooks and security policies that apply.

Precedence:

- Law, provider contract, card-network/bank rules, AWS/Stripe account restrictions, and explicit human authority take priority over product convenience.
- The core Architecture Bible remains authoritative for tenant isolation, durable seats, memory, authorization, AWS ownership, configuration, lifecycle, Relay, UX and audit.
- The ERP extension remains authoritative for universal journal, banking, ISO 20022, localization, migration, cutover and hypercare.
- This extension is authoritative for Tenure-native payment provider orchestration, Stripe Connect, merchant/payment account boundaries, money movement, embedded accounts, cards, disputes and provider reconciliation.
- When documents conflict, stop the affected implementation, record an ADR proposal and obtain the required approval. Do not silently pick the easier rule.

Read current official Stripe documentation at implementation time. Stripe products, API versions, country availability, account configurations, embedded components, responsibilities and preview/GA status change. Never infer current production support from this document alone.

Primary official references:

- Connect: https://docs.stripe.com/connect
- Connect integration design: https://docs.stripe.com/connect/design-an-integration
- Connected accounts and configurations: https://docs.stripe.com/connect/accounts
- Accounts v2 configuration: https://docs.stripe.com/connect/accounts-v2/connected-account-configuration
- Risk and liability: https://docs.stripe.com/connect/risk-management
- Embedded components: https://docs.stripe.com/connect/supported-embedded-components
- Treasury for platforms: https://docs.stripe.com/treasury/connect
- Issuing: https://docs.stripe.com/issuing
- Webhooks: https://docs.stripe.com/webhooks
- API versioning: https://docs.stripe.com/upgrades

### 1. Binding business decisions

These decisions are approved defaults, not guesses:

1. **Seller/merchant:** The tenant legal entity that sells the goods/services or receives the funds should legally appear as seller or merchant. Tenure is not the merchant of record by default.
2. **Fees and negative balances:** Prefer a provider configuration in which Stripe and/or the tenant connected account carries processing fees, disputes and negative-balance responsibility where Stripe supports that exact arrangement. Tenure must not accept platform liability merely to unlock a convenient flow.
3. **Outbound breadth:** The architecture must support an extensible catalog including ordinary settlement to tenant bank accounts, vendor/contractor payouts, multi-party splitting, connected-account payouts, embedded financial accounts, physical/virtual cards, card controls, internal organizational pipelines and future provider-supported money movement.
4. **One tenant is not one merchant account:** The default account boundary is a supported legal entity/merchant, not the tenant row, department, club, project or cost center.
5. **Simon:** Simon clubs are internal organizational units unless legal and processor evidence proves otherwise. They normally use University/OSE legal ownership and internal Tenure subledgers rather than pretending each club is an independent merchant.
6. **Tenure platform fees:** Disabled by default. Tenure may collect application/platform fees only when the customer contract, pricing configuration, accounting/tax treatment, provider configuration and legal review explicitly allow it.
7. **Provider-neutral core:** Stripe is the initial provider. Tenure owns canonical payment objects and business state; provider IDs and events are adapters. Do not leak Stripe object shapes throughout the ERP domain.
8. **No universal availability claim:** Every capability is gated by provider approval, country, currency, legal entity, business type, risk tier, account configuration, API maturity, Tenure certification and tenant entitlement.
9. **No blind one-click money movement:** “One click” may initiate an approved state machine after validations and approvals. It never bypasses maker-checker, step-up, sanctions/fraud checks, limits, funds availability, provider confirmation or reconciliation.
10. **Internal does not automatically mean financial transfer:** Allocation between departments, clubs, funds, projects or seats under one legal owner is normally an internal ledger movement. Stripe must not be called when no external legal or bank-account boundary is crossed.

### 2. Non-negotiable product boundaries

Tenure is:

- The tenant configuration, business workflow, approval and policy system.
- The canonical subledger and universal-journal integration layer.
- The provider-orchestration, event, reconciliation, reporting and evidence system.
- The operator and tenant UX for eligible payment capabilities.
- The institutional memory for merchant onboarding, financial policies, relationships, decisions, incidents and handoffs.

Tenure is not automatically:

- Merchant of record.
- Bank, money transmitter, payment institution, acquirer, issuer or card network.
- Custodian or holder of customer funds.
- Employer, payroll provider or tax filer.
- KYC/KYB decision owner where Stripe owns that obligation.
- Guarantor for tenant negative balances.
- A replacement for provider, bank, network or regulator records.

Do not use product copy such as “Tenure bank account,” “Tenure holds your funds,” “Tenure-issued card,” “insured by Tenure,” or “payments available globally” unless the exact legal/provider relationship permits it. Use accurate phrases such as “financial account provided through Stripe and its banking partners” where required by approved disclosure.

- [ ] PAY-000-001 — Create `docs/payments/payment-authority-and-regulatory-boundary.md` with exact Tenure, tenant, Stripe, bank and network responsibilities.
- [ ] PAY-000-002 — Record the approved merchant-of-record default and all exception paths in an ADR.
- [ ] PAY-000-003 — Record the fee payer, negative-balance, dispute and loss responsibility selection algorithm in an ADR.
- [ ] PAY-000-004 — Add prohibited-claim lint rules and content review for payments UI, docs and Relay responses.
- [ ] PAY-000-005 — Create a legal/provider review gate for every new country, account configuration, funds flow, card program and financial-account capability.
- [ ] PAY-000-006 — Prove no tenant module can bypass the canonical payment command layer through raw Stripe SDK calls.
- [ ] PAY-000-007 — Prove test mode and live mode are separated by account, keys, roles, secrets, configuration, UI, event destinations and evidence.
- [ ] PAY-000-008 — Mark every unapproved capability `UNSUPPORTED` or `PLANNED`; never infer availability from a Stripe marketing page.

### 3. Capability Completeness contract

Register a `PAYMENTS` capability family in the Parent `CapabilityDefinition` system. It must not be a boolean `stripe_enabled` flag.

Required capability leaves include, at minimum:

- Merchant connected-account onboarding and management.
- Online card and wallet acceptance.
- Bank debit and bank transfer acceptance.
- Local payment methods by country/currency.
- Hosted Checkout, embedded checkout, Payment Element and approved custom UI.
- Payment links and invoices.
- In-person payments/Terminal.
- Direct charges.
- Destination charges.
- Separate charges and transfers/multi-party splits.
- Application/platform fees.
- Refunds, partial refunds and reversals.
- Payment disputes and evidence.
- Provider/tenant balances.
- Automatic, manual and instant payouts.
- Payout schedule and payout destination management.
- Vendor/contractor/third-party disbursement.
- Embedded financial accounts.
- Inbound transfers, outbound transfers and outbound payments.
- Physical and virtual cards.
- Cardholder, card, authorization, transaction and dispute management.
- Financial Connections/open-banking data access.
- Billing, invoicing, subscriptions and usage payment collection.
- Tax calculation/provider integration.
- Identity/KYC/KYB provider integration.
- Fraud/risk tooling and controls.
- Multi-currency presentment and settlement.
- Internal organizational allocations and settlement instructions.
- Marketplace/supplier/payee connected accounts.
- Provider reporting, fees, reserves, tax forms and reconciliation.

Each leaf declares:

- Provider/product/API and exact stability status.
- Countries, currencies, entity types and business types.
- Account configuration and controller/responsibility requirements.
- Charge/funds-flow model.
- Merchant/seller, statement descriptor and customer disclosure.
- Fee payer, loss payer, refund payer and negative-balance responsibility.
- KYC/KYB/identity and ongoing requirements ownership.
- Required contracts, legal approval and provider activation.
- Tenure entitlement, tenant policy, roles, limits and approvals.
- Canonical objects, commands, events and state machines.
- Ledger/posting templates and reconciliation method.
- Tax and reporting implications.
- UI surfaces and embedded-component availability.
- SLO, webhook/event requirements, support and incident ownership.
- Enable/disable/hibernate/offboard/purge behavior.
- Sandbox, certification, production pilot and proof-expiry evidence.

- [ ] PAY-010-001 — Implement the payments capability registry with machine-validated schemas.
- [ ] PAY-010-002 — Separate provider capability, Tenure certification, tenant entitlement and merchant activation; all four must pass.
- [ ] PAY-010-003 — Add effective dates and provider/API-version compatibility to capability definitions.
- [ ] PAY-010-004 — Add `DISCOVERED`, `ARCHITECTED`, `PLANNED`, `BUILDING`, `INTERNAL_PREVIEW`, `TENANT_PILOT`, `GA_LIMITED`, `GA`, `DEPRECATED` and `UNSUPPORTED` states.
- [ ] PAY-010-005 — Enforce the same availability truth in System Studio, tenant UI, APIs, Relay and documentation.
- [ ] PAY-010-006 — Add country/currency/entity/business-type eligibility simulation with explainable blockers.
- [ ] PAY-010-007 — Add a provider feature/version watch process; provider changes create review tasks, not automatic production mutations.
- [ ] PAY-010-008 — Prove an unsupported capability cannot be enabled through direct manifest editing or stale UI.

### 4. Target architecture

Implement the following bounded domains:

1. **Payments Configuration Plane:** System Studio capability selection, merchant/legal-entity mapping, provider connection, policies, limits and approval configuration.
2. **Merchant Account Service:** Legal entities, connected accounts, requirements, capabilities, representatives, owners, external accounts and status.
3. **Payment Orchestration Service:** Canonical payment intents/orders, provider routing, attempts, authorization/capture, refunds and failure handling.
4. **Funds Flow Service:** Charges, application fees, transfers, splits, reversals, settlement instructions and liability-aware routing.
5. **Payout Service:** Balance eligibility, payout requests, schedules, destinations, approvals, provider payouts and returns.
6. **Disbursement Service:** Vendor/contractor/beneficiary payment instructions, batches, rails, approvals, execution and reconciliation.
7. **Financial Account Service:** Provider financial accounts, balances, addresses, inbound/outbound movements, statements and restrictions.
8. **Cards Service:** Cardholders, cards, controls, funding, authorizations, transactions, disputes, replacements and lifecycle.
9. **Risk and Disputes Service:** Risk decisions, holds, reserves, alerts, cases, evidence, deadlines and outcomes.
10. **Payments Ledger Adapter:** Immutable provider subledger, accounting-event generation, journal posting and reconciliation.
11. **Provider Gateway:** Stripe API client, account context, idempotency, API versioning, webhooks, polling/recovery and secret isolation.
12. **Payments Operations Center:** Queues, failures, requirements, disputes, payouts, reconciliation, incidents, provider status and support.

Every business module calls semantic commands such as `CreateCustomerPayment`, `ApproveVendorDisbursement`, `IssueOrganizationCard`, or `RefundReceipt`. It never constructs provider API requests directly.

Use an outbox for Tenure events and an inbox for provider events. Provider webhooks are evidence, not automatically authoritative business permission. Re-resolve tenant, legal entity, connected account, object, expected state and policy before applying a transition.

- [ ] PAY-020-001 — Publish bounded-context ownership and dependency diagrams.
- [ ] PAY-020-002 — Create interfaces that prevent finance, billing, procurement, payroll, marketplace and Simon modules from importing raw Stripe clients.
- [ ] PAY-020-003 — Enforce tenant, environment, legal entity, provider account and capability context on every command/query.
- [ ] PAY-020-004 — Implement provider-neutral canonical IDs and separate external-provider reference tables.
- [ ] PAY-020-005 — Implement outbox/inbox, idempotent consumers, replay controls and dead-letter operations.
- [ ] PAY-020-006 — Prohibit provider event payloads and secrets from general logs, analytics, Relay indexes and client responses.
- [ ] PAY-020-007 — Define synchronous versus asynchronous boundaries and safe timeout/retry behavior.
- [ ] PAY-020-008 — Prove partial provider outages do not corrupt Tenure business or ledger state.

### 5. Canonical domain model

At minimum implement temporal, tenant-bound objects for:

- `PaymentProvider`
- `ProviderProgram`
- `MerchantLegalEntity`
- `MerchantAccount`
- `MerchantAccountRequirement`
- `MerchantCapability`
- `MerchantRepresentative`
- `FinancialAccount`
- `ExternalBankAccountReference`
- `Customer`
- `PaymentOrder`
- `PaymentAttempt`
- `PaymentMethodReference`
- `Authorization`
- `Capture`
- `Charge`
- `Refund`
- `Dispute`
- `DisputeEvidencePackage`
- `BalanceSnapshot`
- `BalanceTransaction`
- `Transfer`
- `TransferReversal`
- `FundsSplit`
- `ApplicationFee`
- `Payout`
- `PayoutDestination`
- `Beneficiary`
- `Disbursement`
- `DisbursementBatch`
- `Settlement`
- `Reserve/Hold`
- `Cardholder`
- `PaymentCard`
- `CardControlPolicy`
- `CardAuthorization`
- `CardTransaction`
- `ProviderEventReceipt`
- `ReconciliationRun`
- `ReconciliationException`
- `PaymentApproval`
- `PaymentRiskCase`
- `PaymentSupportCase`

Every monetary object stores currency in ISO form and integer minor units or a currency-aware exact decimal policy; never binary floating point. Currency scale, zero-decimal behavior, rounding and provider amount limits are validated.

Every external reference is scoped by provider, mode, platform/program and connected-account context. A raw `stripe_customer_id` without account context is not globally unique enough.

Sensitive provider payloads are minimized. Store normalized fields required for business, accounting, support, reconciliation and evidence. Store an encrypted, access-controlled provider snapshot/reference only when retention and contract permit it.

- [ ] PAY-030-001 — Publish the canonical schema with ownership, classification, retention and legal-entity scoping.
- [ ] PAY-030-002 — Use exact money types and property tests across supported currencies and rounding modes.
- [ ] PAY-030-003 — Enforce provider/mode/account-qualified uniqueness for external IDs.
- [ ] PAY-030-004 — Implement temporal history for account capabilities, bank destinations, limits, card controls and responsibility configuration.
- [ ] PAY-030-005 — Implement immutable state-transition history with actor, authority, reason, policy/config version and evidence.
- [ ] PAY-030-006 — Prevent cascade deletion of financial, dispute, payout, card or reconciliation history.
- [ ] PAY-030-007 — Link transactions to legal entity, ledger, business source, organization/fund/project and durable owner seats without weakening privacy.
- [ ] PAY-030-008 — Define archive, legal hold, provider retention and defensible deletion behavior per object.

### 6. Legal entity, merchant, and connected-account topology

The Parent manifest contains an explicit mapping:

`Tenant → Merchant legal entity → Provider program/platform → Connected account → Capabilities → Financial accounts/balances → Settlement destinations`

Departments, clubs, teams, funds, projects and seats may own internal accounting dimensions and approval authority. They do not become Stripe merchants unless they are separately recognized legal/merchant entities and complete onboarding.

A global tenant may have multiple connected accounts by legal entity, country, business line or approved program. A legal entity may need more than one provider account only when supported and justified; duplicates require review.

Choose the Stripe account configuration from current controller/responsibility capabilities, not an obsolete blanket assumption that “Standard/Express/Custom” alone defines liability. Prefer direct-charge configurations when the tenant seller should be merchant and Stripe/connected account should carry fees and negative-balance responsibility. Destination charges and separate charges/transfers are exception-capable flows because they can place fees, refunds, chargebacks and negative balances on the platform.

- [ ] PAY-040-001 — Implement merchant/legal-entity mapping and block department/club-as-merchant shortcuts.
- [ ] PAY-040-002 — Implement a responsibility matrix covering merchant display, fee payer, losses, refunds, disputes, KYC updates, account collection and support.
- [ ] PAY-040-003 — Implement a charge-model decision engine using exact use case, seller, parties, region, account configuration and liability.
- [ ] PAY-040-004 — Require legal/finance/risk approval before Tenure accepts any platform-level loss or fee responsibility.
- [ ] PAY-040-005 — Support multiple connected accounts per tenant with unambiguous routing and reconciliation.
- [ ] PAY-040-006 — Detect duplicate or conflicting connected accounts and account ownership.
- [ ] PAY-040-007 — Render the legal merchant and statement descriptor in every payment preview/receipt where applicable.
- [ ] PAY-040-008 — Prove cross-tenant and cross-legal-entity account references are denied server-side.

### 7. Merchant onboarding, KYC/KYB, and requirements

System Studio configures the intended capability and creates an onboarding case. Tenant-authorized representatives complete provider-hosted or embedded onboarding. Tenure never pre-fills, attests or submits unverified legal truth as fact.

Track:

- Legal name, registration, tax identifiers and addresses through approved references.
- Business type, industry/MCC, products/services, website and expected activity.
- Owners, directors, executives, representatives and authority.
- Verification documents and provider requirements without unnecessary duplication.
- Terms/service agreements, acceptance version/time/actor and required disclosures.
- Capability requested, pending, active, restricted, inactive, rejected or revoked.
- Requirements currently due, eventually due, past due and disabled reason.
- Appeals/remediation, deadlines, owner seats, notifications and support escalation.
- External bank account ownership/verification and payout readiness.

Use Stripe-hosted/embedded components where they reduce Tenure's exposure and preserve provider ownership. An embedded component receives a short-lived Account Session scoped to the authenticated Tenure user's server-authorized role and allowed features. Do not expose platform secret keys.

- [ ] PAY-050-001 — Implement resumable onboarding cases with provider requirement synchronization.
- [ ] PAY-050-002 — Implement authorized representative verification and terms acceptance evidence.
- [ ] PAY-050-003 — Map Tenure roles to narrowly enabled embedded-component features on every Account Session.
- [ ] PAY-050-004 — Create Account Sessions server-side, short-lived, account-scoped and environment-scoped.
- [ ] PAY-050-005 — Invalidate/logout embedded sessions with the Tenure session and sensitive role changes.
- [ ] PAY-050-006 — Implement requirement deadlines, reminders, escalations, restrictions and safe reactivation.
- [ ] PAY-050-007 — Minimize retention of identity documents and raw provider payloads; prove access separation.
- [ ] PAY-050-008 — Test forged connected-account IDs, role changes, stale sessions and cross-tenant embedded-component access.

### 8. Inbound payment acceptance

Support eligible channels through one canonical payment order:

- Hosted Checkout.
- Embedded checkout/Payment Element.
- Payment links.
- Invoices and customer portal where configured.
- Saved payment methods with consent and purpose.
- Cards and approved digital wallets.
- ACH debit/credit, bank transfer, direct debit and local payment methods where supported.
- In-person Terminal/POS integration where certified.
- One-time, recurring, installment, milestone, deposit, balance, registration, dues, donation, sponsorship, invoice and marketplace scenarios.

State model separates business order, provider intent, attempt, authorization, capture, settlement, refund and dispute. Never treat a client redirect, synchronous API response, email or elapsed time as final settlement.

Canonical payment lifecycle includes:

`DRAFT → VALIDATED → APPROVAL_REQUIRED/READY → CUSTOMER_ACTION_REQUIRED → PROCESSING → AUTHORIZED → CAPTURED/SUCCEEDED → SETTLEMENT_PENDING → SETTLED → RECONCILED → CLOSED`

Control/failure states include:

`REQUIRES_PAYMENT_METHOD`, `REQUIRES_CONFIRMATION`, `REQUIRES_ACTION`, `CANCELLED`, `FAILED`, `PARTIALLY_CAPTURED`, `PARTIALLY_REFUNDED`, `REFUNDED`, `DISPUTED`, `REVERSED`, `HELD`, `EXPIRED`, `UNKNOWN_PROVIDER_STATE`.

- [ ] PAY-060-001 — Implement canonical payment order/attempt state machines independent of Stripe object state.
- [ ] PAY-060-002 — Support authorization/capture timing, partial capture, incremental scenarios only where provider/method allows.
- [ ] PAY-060-003 — Implement customer authentication/action-required flows and safe resume.
- [ ] PAY-060-004 — Implement saved-payment-method consent, purpose, reuse, deletion and customer visibility.
- [ ] PAY-060-005 — Implement payment-method availability by country, currency, account and transaction attributes.
- [ ] PAY-060-006 — Implement receipts, customer communications, statement descriptors and merchant identity.
- [ ] PAY-060-007 — Implement duplicate submission protection using business and provider idempotency.
- [ ] PAY-060-008 — Test redirects, timeouts, retries, delayed methods, duplicate webhooks, abandonment, partial failures and provider recovery.

### 9. Funds-flow models and multi-party splitting

Support three canonical provider flow families when eligible:

1. **Direct charge:** Customer pays the tenant merchant connected account; aligned with the default seller/liability decision.
2. **Destination charge:** Platform-level charge transfers to one connected account; requires explicit responsibility, fee and loss acceptance.
3. **Separate charges and transfers:** Platform-level charge is decoupled from one or more transfers; supports delayed/unknown recipients and multi-party splitting but exposes the platform to material balance and recovery risk.

For every payment, render a funds-flow preview showing:

- Payer/customer.
- Seller/merchant.
- Platform role.
- Connected account(s).
- Gross amount and currency.
- Taxes, tips, discounts and surcharges.
- Stripe/provider fees and who bears them.
- Tenure application fee, if contractually enabled.
- Recipient splits and timing.
- Refund/chargeback funding source.
- Negative-balance owner.
- Settlement destination and expected timing.
- Ledger postings and reconciliation path.

Splits are versioned rules with fixed/percentage/remainder components, caps/floors, rounding recipient, priority, eligibility, effective dates, tax treatment and reversal policy. Sum invariants must hold exactly.

- [ ] PAY-070-001 — Implement the three canonical charge/funds-flow models without hiding liability differences.
- [ ] PAY-070-002 — Default eligible tenant merchants to direct charges where responsibility decisions are satisfied.
- [ ] PAY-070-003 — Require exception approval for destination and separate-charge flows that shift liability to Tenure.
- [ ] PAY-070-004 — Implement multi-recipient split rules with exact sum, rounding and reversal invariants.
- [ ] PAY-070-005 — Bind approved split version and digest to the payment; post-approval mutation creates a new change.
- [ ] PAY-070-006 — Implement transfer reversal/recovery after refund, failure or dispute.
- [ ] PAY-070-007 — Prevent transfers exceeding eligible balance or approved allocation.
- [ ] PAY-070-008 — Test partial recipient failure, unavailable connected account, cross-border restrictions, currency mismatch and negative balance.

### 10. Internal organizational payment pipeline

Tenure must distinguish:

- **Memo allocation:** Budget/fund availability movement with no accounting posting.
- **Internal ledger transfer:** Balanced journal between departments, clubs, funds, projects or cost centers under the same legal entity.
- **Intercompany transfer:** Due-to/due-from and settlement between separate legal entities.
- **External provider movement:** Money crosses to/from an external bank, merchant, beneficiary, connected account or card network.

Example Simon flow:

1. A club collects dues or sponsorship under the University/OSE merchant account.
2. Stripe confirms the customer payment.
3. Tenure posts cash/clearing and allocates the receipt to the club's restricted or unrestricted internal fund/dimension.
4. No separate Stripe connected account or payout is created for the club.
5. A club expense follows VP/treasurer → President → OSE approval.
6. OSE/University pays the vendor through the legally approved provider/bank path.
7. Tenure preserves the club, seat, event, purpose, approval, receipt, vendor and settlement memory.

- [ ] PAY-080-001 — Implement explicit internal-allocation, internal-transfer, intercompany and external-movement command types.
- [ ] PAY-080-002 — Block Stripe calls for same-legal-entity memo/ledger allocations.
- [ ] PAY-080-003 — Require intercompany accounting and settlement policy for separate legal entities.
- [ ] PAY-080-004 — Preserve organization/fund/project/event/seat attribution through provider settlement.
- [ ] PAY-080-005 — Implement internal transfer approvals, budgets, restrictions, effective dates and reversals.
- [ ] PAY-080-006 — Prevent internal subledger balances from being presented as bank-held funds.
- [ ] PAY-080-007 — Reconcile internal allocations to provider cash/clearing and universal journal.
- [ ] PAY-080-008 — Test legal-entity boundary changes, club/department reorganization and successor handoff.

### 11. Vendor, contractor, beneficiary, and marketplace payouts

Do not use one generic “payout” verb. Distinguish:

- Stripe payout from a connected account balance to that account's external bank/debit destination.
- Transfer between platform/connected-account balances.
- Treasury outbound transfer to an external account owned by the same financial-account owner.
- Treasury outbound payment to a third-party beneficiary where eligible.
- Refund to the original customer payment method.
- Reimbursement to a worker/member.
- Vendor invoice payment.
- Contractor/creator/seller marketplace payout.
- Intercompany settlement.
- Card spend.

Beneficiary onboarding includes legal name/reference, type, country, currency, bank/payment method token, tax/reporting classification, ownership verification, sanctions/fraud result, duplicate detection, effective dates, change history and cooling-off policy.

High-risk bank-detail changes require step-up, independent verification, dual control, notifications and a configurable cooling-off period unless an authorized emergency exception is approved.

- [ ] PAY-090-001 — Implement distinct semantic commands and state machines for settlement payout, transfer, outbound payment, refund and disbursement.
- [ ] PAY-090-002 — Implement beneficiary master with tokenized/encrypted payment references and no raw bank data in general stores.
- [ ] PAY-090-003 — Implement vendor/contractor payout batch creation, approval, release, partial acceptance, return and reconciliation.
- [ ] PAY-090-004 — Implement payout schedules, manual/instant eligibility, fees, limits and destination governance.
- [ ] PAY-090-005 — Implement beneficiary change cooling-off, step-up, dual control, alerts and exception evidence.
- [ ] PAY-090-006 — Implement sanctions/fraud/provider checks through approved services without claiming universal regulatory coverage.
- [ ] PAY-090-007 — Implement tax-form/reporting data handoff only for exact supported jurisdictions and roles.
- [ ] PAY-090-008 — Test returned payments, invalid bank accounts, duplicate beneficiary, partial batch, provider outage, recall and repair.

### 12. Embedded financial accounts and money management

Financial accounts are optional, separately contracted/certified capabilities. They may support balances, financial addresses, inbound transfers, outbound transfers, outbound payments, multiple purpose-based accounts and Issuing funding where current Stripe products allow.

Do not implement against a preview API in production merely because current documentation shows it. Record product/API stability and obtain explicit approval before adopting preview/beta functionality. Build the provider gateway so v1/v2 or future migrations do not rewrite Tenure business objects.

Financial-account UX must display provider/bank disclosures, legal owner, available/pending/restricted balances, account purpose, supported rails, limits, holds, statements, fees, cutoff/settlement expectations and support path.

- [ ] PAY-100-001 — Implement financial-account capability gating by country/entity/provider approval/API stability.
- [ ] PAY-100-002 — Model account owner, purpose, currency, balance types, features, restrictions and provider references.
- [ ] PAY-100-003 — Implement financial addresses and inbound funding without exposing full account details beyond authorized need.
- [ ] PAY-100-004 — Implement outbound transfer/payment selection using exact beneficiary ownership and rail semantics.
- [ ] PAY-100-005 — Implement multiple financial accounts with purpose and ledger mapping when supported.
- [ ] PAY-100-006 — Implement statement/transaction ingestion and reconciliation.
- [ ] PAY-100-007 — Create provider version migration and coexistence plan before adopting a new financial-account API generation.
- [ ] PAY-100-008 — Test insufficient funds, pending funds, returns, holds, unsupported rails, limits, duplicate requests and provider ambiguity.

### 13. Cards and spend management

Eligible tenants may enable physical and virtual cards through Stripe Issuing or a future certified provider. Cards are attached to legal owner/program, financial account/funding source, cardholder, organization, cost center/fund/project and policy.

Card controls include:

- Physical/virtual type and lifecycle.
- Spending limits by amount, interval and velocity.
- Merchant category/country/currency/channel restrictions.
- Per-diem, travel, procurement, subscription and single-use policies.
- Dynamic authorization through approved low-latency policy when supported.
- Receipt/evidence requirements and missing-receipt escalation.
- Freeze/unfreeze, replace, renew, close and compromised-card flows.
- Authorization, reversal, capture, incremental authorization and offline/delayed behaviors.
- Transaction matching, coding, approval, dispute and ledger reconciliation.

Never store or log full PAN, CVC, PIN, track data or prohibited authentication data. Use provider-hosted secure reveal components only when justified, authorized and auditable.

- [ ] PAY-110-001 — Implement cardholder/card/control-policy canonical models and lifecycle.
- [ ] PAY-110-002 — Implement funding and ledger mapping without presenting internal allocations as provider balances.
- [ ] PAY-110-003 — Implement authorization controls, limits, merchant/country/currency rules and safe fallback behavior.
- [ ] PAY-110-004 — Implement card issuance/reveal/activation/freeze/replacement/cancellation with step-up and audit.
- [ ] PAY-110-005 — Implement receipt capture, coding, matching, approval and exception workflows.
- [ ] PAY-110-006 — Implement card disputes, fraud claims, evidence, deadlines and outcomes.
- [ ] PAY-110-007 — Prove no prohibited card data enters Tenure databases, logs, analytics, traces, screenshots or Relay.
- [ ] PAY-110-008 — Test authorization latency/failure, duplicate events, incremental capture, reversed authorization, lost card, replacement and late presentment.

### 14. Refunds, disputes, chargebacks, holds, and risk

Refund and dispute lifecycle is independent from business cancellation. A cancelled event/order does not prove a successful provider refund.

Refunds require:

- Source payment and refundable amount.
- Full/partial reason and item allocation.
- Tax, discount, fee and split reversal policy.
- Approval threshold and SoD.
- Provider execution and idempotency.
- Customer communication.
- Ledger reversal/adjustment and reconciliation.

Dispute cases track provider/network reason, amount, deadlines, liability owner, evidence requirements, customer/order history, communication, submission digest, outcome, fee, recovery and accounting. Evidence submitted to provider becomes immutable after the provider deadline/rules require it.

Risk controls include onboarding risk, transaction risk, account takeover, payment-method fraud, refund abuse, payout fraud, beneficiary change, card fraud, velocity, unusual amount/geography, negative balance and collusion. Tenure may combine provider signals and tenant policy but must not expose raw risk logic to unauthorized users.

- [ ] PAY-120-001 — Implement refund state machine, approval, split reversal and accounting.
- [ ] PAY-120-002 — Implement disputes as deadline-bound cases with immutable evidence packages.
- [ ] PAY-120-003 — Implement provider fee/loss/negative-balance ownership and journal treatment.
- [ ] PAY-120-004 — Implement risk holds and release authority without silently cancelling valid business work.
- [ ] PAY-120-005 — Implement reserves/rolling holds only when provider/contract/legal/accounting scope permits.
- [ ] PAY-120-006 — Implement alerts, queues, escalation, investigation, decision, appeal and support ownership.
- [ ] PAY-120-007 — Keep risk features, thresholds and PII purpose-separated from ordinary tenant users and Relay.
- [ ] PAY-120-008 — Test fraud/abuse, friendly fraud, refund-after-transfer, dispute-after-payout, expired evidence and negative balance.

### 15. Ledger, accounting events, and reconciliation

Stripe is not Tenure's general ledger. Tenure's universal journal is not Stripe's operational balance ledger. Preserve both and reconcile.

Use an immutable payment subledger with entries for:

- Gross customer receivable/payment.
- Cash/provider clearing.
- Provider processing fee.
- Application/platform fee.
- Tax liability/receivable as configured.
- Tips, donations, dues, sponsorship, restricted funds or other source classification.
- Connected-account transfer payable/receivable.
- Payout in transit and settlement.
- Refund liability and cash reversal.
- Dispute receivable/loss and dispute fee.
- Reserve/hold and release.
- FX conversion, fee and gain/loss.
- Card authorization memo, card transaction, expense and payable.
- Vendor/contractor disbursement and return.

Accounting events are generated from verified domain transitions, not raw webhooks. Posting templates are versioned by legal entity, ledger/book, transaction type, provider flow, currency, tax and effective date. Posted journals preserve source object, provider balance transaction, account context and reconciliation run.

Reconcile at four layers:

1. Business order/payment state.
2. Provider object/event/balance transaction.
3. Provider balance/payout/bank settlement.
4. Tenure subledger/universal journal/bank statement.

- [ ] PAY-130-001 — Implement immutable payment subledger and versioned accounting-event contracts.
- [ ] PAY-130-002 — Implement posting templates with balanced-entry validation and effective dating.
- [ ] PAY-130-003 — Reconcile gross, fees, refunds, disputes, transfers, payouts, FX and net settlement.
- [ ] PAY-130-004 — Implement provider balance-transaction ingestion with qualified external keys and replay safety.
- [ ] PAY-130-005 — Implement daily and on-demand reconciliation runs, tolerances, exceptions, ownership and sign-off.
- [ ] PAY-130-006 — Require zero unexplained variance for money and authority; never auto-write off unexplained differences.
- [ ] PAY-130-007 — Link bank/ISO 20022 statements and Stripe payouts without duplicate cash recognition.
- [ ] PAY-130-008 — Test backdated events, late fees, partial settlements, FX, missing webhook, API correction and duplicated import.

### 16. Provider gateway, API versioning, secrets, and webhooks

Use Stripe official SDKs where suitable behind a Tenure provider gateway. Pin and intentionally upgrade API versions. Record per connected account/platform the effective API behavior needed for reconciliation and events.

Secrets:

- Use AWS Secrets Manager/KMS and short-lived workload identity.
- Separate test/live and platform/program secrets.
- Never place secret keys in browsers, tenant configuration, source control, logs, evidence, Relay or support exports.
- Restrict secrets to provider-gateway workloads and exact environment.
- Rotate with overlap, verification and rollback.

Every provider write uses a stable Tenure business idempotency key. A retry must return/reconcile the same intended effect. Never generate a fresh idempotency key simply because a request timed out.

Webhooks:

- Verify signatures against exact endpoint secret and raw body.
- Apply replay-window and event-ID deduplication.
- Persist a minimized immutable receipt before asynchronous processing.
- Resolve account/context, tenant, environment and provider program.
- Handle duplicates, reordering, delay and missing events.
- Fetch provider truth when needed; do not trust unverified client payloads.
- Return quickly and process asynchronously.

- [ ] PAY-140-001 — Implement a single provider gateway with no raw SDK leakage.
- [ ] PAY-140-002 — Pin API versions and create contract/regression tests before upgrades.
- [ ] PAY-140-003 — Inventory API/product GA/beta/preview status and prohibit unapproved preview production use.
- [ ] PAY-140-004 — Implement account/program/mode context on every provider API call.
- [ ] PAY-140-005 — Implement stable idempotency keys and timeout recovery by lookup/reconciliation.
- [ ] PAY-140-006 — Implement signature verification, raw-body handling, deduplication and asynchronous webhook inbox.
- [ ] PAY-140-007 — Implement event-gap polling/reconciliation and safe replay/redrive.
- [ ] PAY-140-008 — Test forged signatures, secret rotation, duplicate/out-of-order events, timeouts, 429s, 5xx, network partition and stale API schemas.

### 17. Authorization, approval, and financial controls

Payment authority attaches to durable seats, legal entities, organizations, funds, projects, transaction types, amount/currency, risk, beneficiary and time. It does not copy blindly from a predecessor person.

Required controls:

- Maker-checker and no self-approval.
- Configurable multi-stage/quorum approval.
- Approval limits normalized to policy currency with captured rates.
- Beneficiary/bank-detail independence.
- Step-up authentication for high-risk changes/actions.
- Delegation with scope, reason and expiry.
- Conflict of interest and recusal.
- Budget/fund/restriction/PO/invoice validation.
- Duplicate payment detection.
- Sanctions/fraud/provider checks.
- Cutoff, business calendar and scheduling.
- Approval digest binding; changes invalidate approval.
- Emergency route with narrower authority and stronger evidence.

- [ ] PAY-150-001 — Implement payment capability permissions at server/domain layer, not navigation only.
- [ ] PAY-150-002 — Implement amount/currency/entity/org/fund/provider/beneficiary-aware authority.
- [ ] PAY-150-003 — Implement maker-checker, no-self-approval, conflict/recusal and delegated authority.
- [ ] PAY-150-004 — Implement approval digest invalidation for amount, recipient, destination, schedule, split or provider changes.
- [ ] PAY-150-005 — Implement step-up authentication and short action authorization for high-risk commands.
- [ ] PAY-150-006 — Implement emergency action path with explicit reason, notification and post-review.
- [ ] PAY-150-007 — Implement support impersonation prohibition; use scoped support access with customer visibility where policy requires.
- [ ] PAY-150-008 — Test privilege escalation, stale seat, terminated user, delegated expiry, currency threshold and split approval bypass.

### 18. System Studio: Payments and Treasury Studio

Add a complete implementation workspace to System Studio.

Stages:

1. **Business intent:** collection/disbursement/card/account use cases, expected volume, countries, currencies, customers/payees, risk and launch scope.
2. **Legal ownership:** seller/merchant entities, terms, statements, bank ownership, representatives and tax/reporting roles.
3. **Provider program:** Stripe account/program, mode, controller/responsibility configuration, contract and provider activation.
4. **Capabilities:** eligible payment methods, charges, transfers, payouts, financial accounts, cards, billing, Tax/Radar/Identity/Connections and exact status.
5. **Funds flows:** payer, seller, recipients, fees, loss owner, refunds, disputes, settlement and accounting.
6. **Internal mapping:** ledgers, charts, dimensions, funds, organizations, products, taxes, clearing and posting templates.
7. **Authority:** roles, seat limits, approvals, step-up, bank changes, disputes, refunds, cards and emergency access.
8. **Experience:** checkout method, branding, receipts, customer portal, embedded components, disclosures and accessibility.
9. **Risk and operations:** fraud rules, alerts, reserves, dispute queues, support, reconciliation, SLO and incidents.
10. **Migration/coexistence:** existing Stripe accounts, customers, payment methods, subscriptions, balances, payouts, disputes and historical records.
11. **Simulation/certification:** eligibility, sandbox, provider test cases, ledger postings, webhooks, failure injection, reconciliation and UAT.
12. **Approval/activation:** immutable plan, cost/liability summary, reviewers, rollback/disable path and signed evidence.

The Studio must show actual provider state versus desired Tenure state without allowing arbitrary provider-console mutation. Where provider-hosted onboarding/embedded components are necessary, embed or deep-link them with clear boundary and return-state verification.

- [ ] PAY-160-001 — Build the 12-stage resumable Payments Studio with ownership, evidence, blockers and readiness.
- [ ] PAY-160-002 — Render legal merchant, funds flow, fees, loss responsibility, tax, settlement and ledger preview before activation.
- [ ] PAY-160-003 — Render provider capability/requirement truth and last synchronization time.
- [ ] PAY-160-004 — Provide test/live visual separation that cannot be confused by color alone.
- [ ] PAY-160-005 — Build provider account/resource graph with connected accounts, capabilities, financial accounts, cards, webhooks and destinations.
- [ ] PAY-160-006 — Implement change diff, risk class, approval, apply, verify, reconcile and rollback/disable chain.
- [ ] PAY-160-007 — Add safe links to provider-hosted actions when Tenure cannot/should not perform them, and verify return state.
- [ ] PAY-160-008 — Test all stages with empty, loading, pending requirement, rejected, restricted, failed, stale, drifted and recovered states.

### 19. Tenant runtime UX

Create Tenure-native, low-fatigue surfaces consistent with the Tenure Experience System:

- Payments overview.
- Transactions and payment details.
- Customer payments/checkout/invoices.
- Balances and settlement.
- Payouts and payout detail.
- Vendor/contractor disbursements.
- Beneficiaries and bank-change cases.
- Financial accounts and statements.
- Cards, cardholders, controls and transactions.
- Refunds and disputes.
- Reconciliation and exceptions.
- Payment policies and approval queues.
- Risk/requirements notifications.
- Reports, exports and audit/memory timelines.

Users see business language first and provider details on drill-through. Each status must distinguish initiated, provider-accepted, settled and reconciled. Never use a green “Paid” label for a merely submitted or processing instruction.

Embedded Stripe components must be visually harmonized within supported appearance options without trying to conceal provider-required authentication or disclosures. Preserve keyboard access, screen readers, reduced motion, high contrast, responsive behavior and secure CSP requirements.

- [ ] PAY-170-001 — Implement role-based information architecture for payer, requester, approver, treasurer, finance, merchant admin, risk, auditor and support.
- [ ] PAY-170-002 — Display canonical business state and separate provider/settlement/reconciliation state.
- [ ] PAY-170-003 — Implement transaction drill-through from business source to provider evidence, subledger, journal and bank settlement.
- [ ] PAY-170-004 — Implement clear pending/failed/restricted/disputed/returned/unknown states with next action and owner.
- [ ] PAY-170-005 — Implement searchable/filterable/exportable operations without leaking full financial identifiers.
- [ ] PAY-170-006 — Implement forest-green light/dark themes and supported embedded-component appearance safely.
- [ ] PAY-170-007 — Pass accessibility, localization, RTL, responsive, visual-regression and long-session fatigue tests.
- [ ] PAY-170-008 — Test screenshot/export/log redaction and shoulder-surfing/privacy behavior.

### 20. Relay by Tenure for payments

Relay may:

- Explain a transaction, payout, fee, discrepancy or dispute using authorized sources.
- Draft a payment request, refund request, dispute evidence checklist or reconciliation note.
- Identify missing approvals, receipts, requirements or mismatches.
- Simulate funds flow, cost, timing and accounting.
- Prepare a batch or policy change for review.
- Summarize provider incidents and affected work.
- Brief successor seats on recurring payment responsibilities and exceptions.

Relay may not:

- Move money, issue/reveal a card, change bank details, submit KYC attestations, accept provider terms, release a payout or refund, or submit irreversible dispute evidence without the ordinary command, authority, step-up and approval chain.
- Reveal full bank/card data, secrets, raw risk rules or restricted personal/business identity evidence.
- Claim settlement from incomplete evidence.
- Recommend evading provider, network, tax, sanctions or legal controls.

- [ ] PAY-180-001 — Implement typed read and draft tools with field-level authorization and tenant/legal-entity context.
- [ ] PAY-180-002 — Route every action through canonical commands and ordinary approvals; no privileged AI bypass.
- [ ] PAY-180-003 — Require source citations and as-of times for payment status, balances, fees and requirements.
- [ ] PAY-180-004 — Redact/tokenize financial identifiers in prompts, logs, traces and model outputs.
- [ ] PAY-180-005 — Prevent payment data from entering shared model training or cross-tenant memory.
- [ ] PAY-180-006 — Implement refusal and escalation for prohibited/ambiguous money movement.
- [ ] PAY-180-007 — Create evaluation sets for hallucinated settlement, wrong merchant, wrong amount/currency, unauthorized disclosure and unsafe action.
- [ ] PAY-180-008 — Prove Relay cannot bypass step-up, maker-checker, limits, eligibility or provider restriction.

### 21. Globalization, tax, reporting, and records

Global support is an exact matrix, not a slogan. Model:

- Presentment and settlement currencies.
- Country/entity/account/payment-method availability.
- Cross-border charge/transfer/payout restrictions.
- FX quotes, conversions, spreads/fees and accounting.
- Local payment method lifecycle and customer experience.
- Refund, dispute and settlement timing by method.
- Required merchant/customer/payee disclosures.
- Tax calculation and invoice/e-invoice requirements through certified scope.
- Provider/tax forms and reporting responsibility.
- Data residency, transfer and retention.
- Language, locale, address, name and bank identifier formats.

Stripe Tax or another provider may calculate tax only for configured supported scope; Tenure still owns tax configuration governance, source transaction linkage, accounting and evidence. Do not claim tax filing/remittance unless an exact enabled service and responsibility contract supports it.

- [ ] PAY-190-001 — Implement country/currency/method/capability matrix with effective dates and proof expiry.
- [ ] PAY-190-002 — Implement FX amount, provider conversion, fee and gain/loss evidence.
- [ ] PAY-190-003 — Integrate tax determination/calculation through versioned provider contracts and preserve tax evidence.
- [ ] PAY-190-004 — Implement invoice/receipt numbering, disclosures and e-invoice hooks by certified jurisdiction pack.
- [ ] PAY-190-005 — Implement provider tax-form/reporting exports only for exact role and jurisdiction.
- [ ] PAY-190-006 — Implement localization for names, addresses, bank identifiers, currencies, dates and payment-method terms.
- [ ] PAY-190-007 — Enforce residency, privacy, retention, legal hold and cross-border data controls.
- [ ] PAY-190-008 — Test unsupported country/currency/method, cross-border transfer, FX rounding, tax correction and regulatory-pack expiry.

### 22. Security, privacy, PCI, abuse, and audit

Minimize PCI scope by using Stripe-hosted/embedded payment collection and tokens. Perform a formal PCI scope assessment; do not self-assert compliance from library choice alone.

Threat model:

- Account takeover and privileged operator compromise.
- Cross-tenant or cross-merchant object reference.
- Webhook forgery/replay.
- Idempotency misuse and duplicate movement.
- Beneficiary/bank-detail substitution.
- Insider collusion and self-approval.
- Refund/payout abuse.
- Card-data leakage.
- Secret exposure and environment confusion.
- Provider dashboard mismatch/drift.
- Supply-chain dependency compromise.
- SSRF/injection through metadata/webhooks.
- Log, export, screenshot and Relay leakage.
- Denial of service/rate exhaustion.
- Reconciliation suppression or evidence tampering.

Audit events are append-only, validated, redacted and chained/immutably stored according to the core Bible. They include actor/service, tenant, legal entity, seat, authority, session/step-up, command, amount/currency, affected references, before/after state, policy/config version, approval digest, provider request/event references, result, reason and evidence—not raw secrets or prohibited data.

- [ ] PAY-200-001 — Complete payments threat model and abuse-case review.
- [ ] PAY-200-002 — Document PCI scope, SAQ path and independent validation requirements without unsupported certification claims.
- [ ] PAY-200-003 — Tokenize/encrypt financial identifiers and implement masked display with purpose-based access.
- [ ] PAY-200-004 — Implement rate, velocity, amount, recipient, account and tenant limits with safe failure.
- [ ] PAY-200-005 — Implement immutable/redacted audit and evidence package for every high-risk action.
- [ ] PAY-200-006 — Implement anomaly alerts for privilege, bank changes, payouts, refunds, cards, negative balances and reconciliation gaps.
- [ ] PAY-200-007 — Perform SAST, dependency, IaC, secret, API authorization and penetration testing on payment surfaces.
- [ ] PAY-200-008 — Prove cross-tenant isolation across DB, cache, queue, events, files, search, analytics, logs, backups, exports, provider IDs and Relay.

### 23. Reliability, observability, operations, and support

Define SLOs separately for:

- Checkout/payment initiation.
- Provider command submission.
- Webhook receipt/processing.
- Tenant business-state freshness.
- Payout/disbursement processing.
- Reconciliation freshness.
- Embedded-component availability.
- Card authorization path if Tenure participates.
- Operations queue and support response.

Operations Center includes:

- Provider and AWS health.
- Webhook lag/gaps/failures.
- API errors, rate limits and circuit breakers.
- Unknown provider state.
- Requirement/capability restrictions.
- Failed/returned payouts.
- Negative balances and reserves.
- Disputes/deadlines.
- Reconciliation exceptions.
- Card authorization/transaction anomalies.
- Stuck workflows and orphan provider objects.
- Runbooks, incident timeline, customer communication and postmortem.

- [ ] PAY-210-001 — Define SLOs, SLIs, error budgets and ownership for every enabled capability.
- [ ] PAY-210-002 — Implement trace/correlation from Tenure command to provider request/event, ledger, payout and bank settlement.
- [ ] PAY-210-003 — Implement dashboards/alerts for lag, failures, restrictions, disputes, negative balances and reconciliation.
- [ ] PAY-210-004 — Implement provider outage circuit breakers, queues and safe degraded UX.
- [ ] PAY-210-005 — Implement runbooks for timeout ambiguity, event gaps, payout failure, compromised account/card, dispute deadline and provider incident.
- [ ] PAY-210-006 — Implement orphan provider-object and drift reconciliation without unsafe automatic deletion.
- [ ] PAY-210-007 — Implement customer-visible incident communication and exact affected-object identification.
- [ ] PAY-210-008 — Run game days for provider outage, key rotation, webhook loss, reconciliation drift, account restriction and negative balance.

### 24. Tenant lifecycle, hibernation, offboarding, and purge

Payments cannot be shut down like stateless compute.

Before disabling or offboarding:

- Stop new payment/payment-link/card/payout creation according to approved sequence.
- Preserve refunds, disputes, chargebacks, returns, statements and reconciliation operations for required windows.
- Settle or explicitly account for pending balances, transfers, payouts, reserves and negative balances.
- Resolve or transfer ownership of connected accounts and external bank destinations according to provider contract.
- Freeze/close cards and financial accounts through approved lifecycle.
- Revoke Account Sessions, webhooks, API access and operator permissions.
- Export required financial, tax, dispute and audit records.
- Retain records according to law, provider contract and legal hold.
- Verify no orphan webhooks, secrets, provider objects or billable capabilities remain.

`HIBERNATED_ZERO_RUNTIME` may still incur provider, reserve, account, record-retention or AWS storage costs. `PURGED_ZERO_INCREMENTAL_COST` cannot be claimed while provider obligations, retained data or billable financial products remain.

- [ ] PAY-220-001 — Implement payments-specific suspend/disable/offboard state machine and blockers.
- [ ] PAY-220-002 — Prevent tenant purge with open disputes, refunds, payouts, negative balances, cards, financial accounts or retention holds.
- [ ] PAY-220-003 — Implement account/card/financial-account closure and provider-ownership transfer where supported.
- [ ] PAY-220-004 — Preserve required refund/dispute/support access after stopping new transactions.
- [ ] PAY-220-005 — Revoke sessions, webhooks, secrets and privileges with evidence.
- [ ] PAY-220-006 — Export/reconcile provider, subledger, journal, bank, tax and audit records.
- [ ] PAY-220-007 — Scan for provider/AWS residual cost and disclose it truthfully.
- [ ] PAY-220-008 — Test reactivation only where provider/account state supports it; never promise reversible closure.

### 25. Simon OSE Tenant #1 configuration

Do not enable live payments for Simon from assumptions. Establish the University/OSE legal owner, merchant agreement, bank account, tax treatment, refund/dispute authority, club policy and Simon IT/security approvals.

The 2026-08-04 OSE discovery response confirms that finance tracking/reporting, budget/spending history, paperwork/approvals, role continuity and new-leader onboarding are important. It does **not** request or approve payment processing. Treat this as validation of the finance/subledger/reporting experience and as a reason to keep live payment capabilities gated—not as Stripe authorization.

Candidate Simon use cases, subject to approval:

- Club dues.
- Event registration/tickets.
- Donations or sponsorship receipts.
- Reimbursements.
- Vendor payments.
- Internal budget/fund allocations.
- Approved organization cards.

Default architecture:

- University/OSE-aligned merchant account/legal entity.
- Clubs as internal organizations/funds/dimensions, not independent merchants.
- VP/treasurer/requester → Club President → OSE/Administration configurable approval.
- OSE-controlled refund, payout, bank-detail and dispute authority.
- Club successor seats inherit eligible transaction context, policies, vendor/sponsor memory and reconciliation—not bank secrets or prior users' personal access.

- [ ] PAY-230-001 — Create a Simon payments discovery workbook and mark every unconfirmed fact/blocker.
- [ ] PAY-230-002 — Obtain exact legal merchant, bank, tax, provider, security and policy decisions before live activation.
- [ ] PAY-230-003 — Model clubs as internal dimensions unless independent legal/merchant evidence is approved.
- [ ] PAY-230-004 — Implement dues/event/sponsorship receipt allocation to club/fund/event and universal journal.
- [ ] PAY-230-005 — Implement configurable club request/President/OSE approval for reimbursements/vendor disbursements.
- [ ] PAY-230-006 — Implement OSE-wide oversight and club-scoped visibility with strict privacy.
- [ ] PAY-230-007 — Migrate any existing payment records/providers through immutable extraction, mapping, reconciliation, cutover and rollback.
- [ ] PAY-230-008 — Prove global payment releases reach Simon through the Parent release train without a Simon code fork.

### 26. Migration and coexistence

For existing Stripe/provider estates inventory:

- Platform accounts and connected accounts.
- Account configuration/responsibility and capabilities.
- Customers and payment methods.
- Products, prices, subscriptions, schedules, invoices and credits.
- Payment intents, charges, refunds and disputes.
- Transfers, payouts, balances and bank accounts.
- Financial accounts, addresses and money movements.
- Cardholders, cards, authorizations and transactions.
- Webhook endpoints, event destinations and API versions.
- Tax, Radar, Identity, Financial Connections and Terminal configuration.
- Reports, tax forms, reserves, fees and reconciliation history.
- Keys, apps, users, roles and support procedures.

Adopt, map, coexist, migrate, replace or retire each object family. Do not recreate connected accounts or customer/payment-method relationships casually; provider portability and consent may be restricted.

- [ ] PAY-240-001 — Produce immutable provider inventory and ownership map without exposing secrets.
- [ ] PAY-240-002 — Define canonical mappings, external-ID qualification, history scope and unsupported objects.
- [ ] PAY-240-003 — Reconcile customers, merchants, payments, refunds, disputes, transfers, payouts, balances, cards and subscriptions.
- [ ] PAY-240-004 — Preserve consent, mandates, provider restrictions and customer communication requirements.
- [ ] PAY-240-005 — Run repeated test-mode/full-scale mock migrations and final reconciliation.
- [ ] PAY-240-006 — Plan webhook/API cutover with no event gap, duplication or double processing.
- [ ] PAY-240-007 — Implement rollback/coexistence boundaries; never assume provider money movement can be undone.
- [ ] PAY-240-008 — Retire legacy keys/endpoints only after traffic, event, reconciliation and owner evidence.

### 27. Testing and certification matrix

For every enabled capability test:

- Success, denial, failure, timeout, duplicate, stale, concurrent, delayed and recovery paths.
- Each persona and forbidden persona.
- Every supported country/currency/method/account configuration.
- Test/live separation.
- Provider sandbox and approved production pilot.
- Ledger balance and reconciliation.
- Cross-tenant/legal-entity isolation.
- Approval and step-up bypass attempts.
- Webhook ordering, replay and loss.
- Provider rate limits/outages.
- Data retention/redaction/export.
- Accessibility, responsive, localization and fatigue.
- Performance, scale and cost.
- Disable/offboard/purge blockers.

Mandatory E2E scenarios:

1. Merchant onboarding → capability activation → first direct charge → settlement → reconciliation.
2. Payment requires customer action → resumes → settles.
3. Partial refund → split reversal → ledger reconciliation.
4. Dispute → evidence → outcome → fee/loss posting.
5. Multi-party charge/splits → one recipient restriction → recovery.
6. Vendor batch → approval → outbound payment → one return → repair/reconcile.
7. Financial account fund in/out → statement → reconciliation.
8. Virtual card issue → controls → authorization → capture → receipt → dispute.
9. Beneficiary bank change → step-up → dual approval → cooling-off → payout.
10. Missing webhooks/provider outage → polling/recovery → no duplicate effect.
11. Simon club receipt → internal allocation → approved expense → vendor settlement → successor memory.
12. Tenant disable/offboard with open dispute/payout → blocked until resolved.

- [ ] PAY-250-001 — Build contract/unit/property/integration/E2E/security/chaos/reconciliation test suites.
- [ ] PAY-250-002 — Use deterministic Stripe test clocks/test helpers where applicable without confusing simulation with certification.
- [ ] PAY-250-003 — Test all 12 mandatory E2E scenarios with evidence and rollback/recovery.
- [ ] PAY-250-004 — Test cross-tenant isolation across every storage, event and provider-reference path.
- [ ] PAY-250-005 — Run load tests at expected plus safety-factor volume without creating uncontrolled provider cost.
- [ ] PAY-250-006 — Run penetration/abuse tests and remediate critical/high findings.
- [ ] PAY-250-007 — Complete provider/country/capability certification evidence with expiry and known limits.
- [ ] PAY-250-008 — Keep live capabilities unavailable until production-readiness and human approval gates pass.

### 28. Rollout sequence

Implement in dependency order:

1. Repository/AWS/Stripe current-state truth.
2. Capability registry and responsibility model.
3. Provider gateway, secrets, API versions and webhook inbox.
4. Merchant/legal-entity and connected-account service.
5. Canonical payment model and immutable subledger.
6. Direct-charge inbound payments in Stripe test mode.
7. Refunds, disputes, risk and reconciliation.
8. Payout settlement to tenant bank accounts.
9. Vendor/contractor disbursement.
10. Multi-party splitting after liability approval.
11. Embedded financial accounts after product/region/API approval.
12. Cards/Issuing after program, security and support approval.
13. System Studio and tenant UX convergence throughout, not at the end.
14. Simon sandbox/UAT only after University/OSE discovery decisions.
15. Limited production pilot with low limits, monitoring and rapid disable.
16. Progressive country/capability certification and general availability.

- [ ] PAY-260-001 — Create dependency-ordered implementation ledger and evidence directory.
- [ ] PAY-260-002 — Complete read-only provider truth before enabling writes.
- [ ] PAY-260-003 — Enable write authority by narrow capability and environment, not one omnipotent Stripe key path.
- [ ] PAY-260-004 — Use low limits and explicit pilot merchants for first live activation.
- [ ] PAY-260-005 — Define automatic pause thresholds for authorization errors, webhooks, negative balances, disputes, reconciliation and security.
- [ ] PAY-260-006 — Prove disable/rollback/recovery before each rollout wave.
- [ ] PAY-260-007 — Record pilot outcomes, incidents, support load, fees and reconciliation before expansion.
- [ ] PAY-260-008 — Update capability status and known limitations from evidence, not schedule pressure.

### 29. Required repository deliverables

Create or update, using actual repository conventions:

#### Architecture and decisions

- `docs/payments/architecture.md`
- `docs/payments/authority-and-regulatory-boundary.md`
- `docs/payments/merchant-and-connected-account-model.md`
- `docs/payments/funds-flow-and-liability-matrix.md`
- `docs/payments/canonical-domain-model.md`
- `docs/payments/state-machines.md`
- `docs/payments/accounting-and-reconciliation.md`
- `docs/payments/security-and-pci-scope.md`
- `docs/payments/provider-api-version-policy.md`
- ADRs for account configuration, charge models, platform fees, Treasury, Issuing and Simon.

#### Configuration and contracts

- Machine-readable payments capability catalog.
- Merchant/legal-entity/account manifest schema.
- Funds-flow/split/fee/liability schema.
- Payment authority and approval-policy schema.
- Accounting/posting-template schema.
- Provider gateway interfaces and event contracts.
- Country/currency/entity/capability matrix.
- Simon payments tenant overlay with explicit blockers.

#### Operations and evidence

- Provider/AWS current-state sanitized inventory.
- Webhook/event recovery runbook.
- Payment ambiguity and idempotency runbook.
- Account restriction/negative-balance runbook.
- Payout return/beneficiary fraud runbook.
- Card compromise/dispute runbook.
- Reconciliation exception runbook.
- Tenant offboarding runbook.
- Test/certification evidence and known-limitations register.

- [ ] PAY-270-001 — Deliver all architecture/ADR artifacts and cross-link them from the main Bible.
- [ ] PAY-270-002 — Deliver machine-validated configuration and capability schemas.
- [ ] PAY-270-003 — Deliver generated API/event documentation and example fixtures with no secrets/real customer data.
- [ ] PAY-270-004 — Deliver dashboards, alarms, queues, runbooks and support ownership.
- [ ] PAY-270-005 — Deliver migration/coexistence/cutover/rollback package.
- [ ] PAY-270-006 — Deliver security, PCI-scope, privacy and threat-model evidence.
- [ ] PAY-270-007 — Deliver E2E/reconciliation/certification evidence and residual gaps.
- [ ] PAY-270-008 — Update the 120-plane completeness audit from `S` only after the full minimum architecture contract is proven.

### 30. Prohibited shortcuts

Do not:

- Add a global `stripe_enabled` boolean and call the plane complete.
- Create one connected account per tenant, club or department without legal/entity analysis.
- Use destination/separate charges merely because they simplify code while shifting loss to Tenure.
- Treat a webhook as authenticated business authorization.
- Treat `payment_intent.succeeded` as bank settlement or universal-journal reconciliation.
- Treat a Stripe payout, Treasury outbound payment, transfer, refund and internal allocation as the same thing.
- Store raw card/bank/identity documents unnecessarily.
- Expose Stripe secret keys or unrestricted Account Sessions to the browser.
- Retry ambiguous money movement with a new idempotency key.
- Mark payment/payout successful from a client callback or HTTP 200 alone.
- Auto-approve refunds, payouts, bank changes, cards or disputes through Relay.
- Call preview/beta APIs production-ready without approval.
- Claim global, tax-compliant, PCI-certified, insured, bank-like or merchant-of-record capability without exact evidence.
- Delete provider/financial records to satisfy a fake zero-cost claim.
- Hard-code Simon branches or fork the payment engine.
- Mark a checklist complete from schema/UI existence without live domain, security, ledger, reconciliation and recovery proof.

### 31. Absolute definition of done

This extension is complete only when:

1. Merchant/legal-entity and connected-account topology is correct and reviewable.
2. Tenant merchant identity is shown accurately to payers.
3. Fee/loss/negative-balance responsibility is explicit per flow and Tenure liability requires exception approval.
4. Direct charges, refunds, disputes, settlements and reconciliation work end to end for certified scope.
5. Multi-party splits cannot violate amount, rounding, liability or reversal invariants.
6. Payouts/disbursements use correct semantic and provider rails.
7. Internal organization transfers do not create false external money movement.
8. Financial accounts/cards are capability-, jurisdiction-, provider- and API-stability gated.
9. Universal journal and provider/bank state reconcile to zero unexplained monetary variance.
10. Provider secrets, account context, idempotency and webhook security are proven.
11. Authorization, SoD, approvals, step-up and audit cannot be bypassed.
12. System Studio can configure, simulate, approve, activate, observe, change and offboard the plane safely.
13. Tenant UX is professional, accessible, honest and operationally complete.
14. Relay is useful but cannot move money outside ordinary controls.
15. Cross-tenant/legal-entity isolation is proven through adversarial tests.
16. Provider outage, missing events, negative balances, disputes and reconciliation failures have tested recovery.
17. Simon uses the global Parent plane and legal internal-org model, with no code fork.
18. Availability claims match exact runtime evidence.
19. All critical/high security findings and unexplained variances are closed.
20. A human production-readiness board approves the exact first live capability/country/entity/account configuration.

### 32. Required final Claude response

At the end of each execution session report:

1. Repositories, branches and commits inspected/changed.
2. AWS accounts/environments and Stripe mode/program/account scope touched.
3. Requirements completed with links to code/tests/evidence.
4. Requirements still open and exact blockers.
5. Architecture/ADR decisions made or awaiting approval.
6. Security, privacy, PCI, legal/provider and liability impact.
7. Data/ledger/provider/bank reconciliation results and unexplained variance.
8. Tests run, results and baseline versus new failures.
9. Provider API/capability versions and known limitations.
10. Deployment/activation status and rollback/disable path.
11. Any action requiring explicit human or production-money authority.
12. Updated capability status—never `GA` from code completion alone.

Do not hide failures, use fake evidence, claim legal/compliance certification, or present test-mode results as live readiness.

## END TENURE PAYMENTS MASTER PROMPT

## Recommended repository location

`docs/implementation/tenure-global-payments-treasury-stripe-control-plane-master-prompt.md`
