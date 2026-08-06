# Payments, Treasury, Cards and the Stripe Control Plane — execution ledger

Every `PAY-*` requirement stated by `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`.

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

- [ ] **PAY-000-001** — Create `docs/payments/payment-authority-and-regulatory-boundary.md` with exact Tenure, tenant, Stripe, bank and network responsibilities.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-000-002** — Record the approved merchant-of-record default and all exception paths in an ADR.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-000-003** — Record the fee payer, negative-balance, dispute and loss responsibility selection algorithm in an ADR.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-000-004** — Add prohibited-claim lint rules and content review for payments UI, docs and Relay responses.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-000-005** — Create a legal/provider review gate for every new country, account configuration, funds flow, card program and financial-account capability.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-000-006** — Prove no tenant module can bypass the canonical payment command layer through raw Stripe SDK calls.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-000-007** — Prove test mode and live mode are separated by account, keys, roles, secrets, configuration, UI, event destinations and evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-000-008** — Mark every unapproved capability `UNSUPPORTED` or `PLANNED`; never infer availability from a Stripe marketing page.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-010-001** — Implement the payments capability registry with machine-validated schemas.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-010-002** — Separate provider capability, Tenure certification, tenant entitlement and merchant activation; all four must pass.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-010-003** — Add effective dates and provider/API-version compatibility to capability definitions.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-010-004** — Add `DISCOVERED`, `ARCHITECTED`, `PLANNED`, `BUILDING`, `INTERNAL_PREVIEW`, `TENANT_PILOT`, `GA_LIMITED`, `GA`, `DEPRECATED` and `UNSUPPORTED` states.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-010-005** — Enforce the same availability truth in System Studio, tenant UI, APIs, Relay and documentation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-010-006** — Add country/currency/entity/business-type eligibility simulation with explainable blockers.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-010-007** — Add a provider feature/version watch process; provider changes create review tasks, not automatic production mutations.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-010-008** — Prove an unsupported capability cannot be enabled through direct manifest editing or stale UI.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-020-001** — Publish bounded-context ownership and dependency diagrams.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-020-002** — Create interfaces that prevent finance, billing, procurement, payroll, marketplace and Simon modules from importing raw Stripe clients.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-020-003** — Enforce tenant, environment, legal entity, provider account and capability context on every command/query.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-020-004** — Implement provider-neutral canonical IDs and separate external-provider reference tables.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-020-005** — Implement outbox/inbox, idempotent consumers, replay controls and dead-letter operations.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-020-006** — Prohibit provider event payloads and secrets from general logs, analytics, Relay indexes and client responses.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-020-007** — Define synchronous versus asynchronous boundaries and safe timeout/retry behavior.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-020-008** — Prove partial provider outages do not corrupt Tenure business or ledger state.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-030-001** — Publish the canonical schema with ownership, classification, retention and legal-entity scoping.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-030-002** — Use exact money types and property tests across supported currencies and rounding modes.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-030-003** — Enforce provider/mode/account-qualified uniqueness for external IDs.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-030-004** — Implement temporal history for account capabilities, bank destinations, limits, card controls and responsibility configuration.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-030-005** — Implement immutable state-transition history with actor, authority, reason, policy/config version and evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-030-006** — Prevent cascade deletion of financial, dispute, payout, card or reconciliation history.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-030-007** — Link transactions to legal entity, ledger, business source, organization/fund/project and durable owner seats without weakening privacy.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-030-008** — Define archive, legal hold, provider retention and defensible deletion behavior per object.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-040-001** — Implement merchant/legal-entity mapping and block department/club-as-merchant shortcuts.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-040-002** — Implement a responsibility matrix covering merchant display, fee payer, losses, refunds, disputes, KYC updates, account collection and support.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-040-003** — Implement a charge-model decision engine using exact use case, seller, parties, region, account configuration and liability.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-040-004** — Require legal/finance/risk approval before Tenure accepts any platform-level loss or fee responsibility.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-040-005** — Support multiple connected accounts per tenant with unambiguous routing and reconciliation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-040-006** — Detect duplicate or conflicting connected accounts and account ownership.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-040-007** — Render the legal merchant and statement descriptor in every payment preview/receipt where applicable.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-040-008** — Prove cross-tenant and cross-legal-entity account references are denied server-side.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-050-001** — Implement resumable onboarding cases with provider requirement synchronization.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-050-002** — Implement authorized representative verification and terms acceptance evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-050-003** — Map Tenure roles to narrowly enabled embedded-component features on every Account Session.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-050-004** — Create Account Sessions server-side, short-lived, account-scoped and environment-scoped.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-050-005** — Invalidate/logout embedded sessions with the Tenure session and sensitive role changes.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-050-006** — Implement requirement deadlines, reminders, escalations, restrictions and safe reactivation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-050-007** — Minimize retention of identity documents and raw provider payloads; prove access separation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-050-008** — Test forged connected-account IDs, role changes, stale sessions and cross-tenant embedded-component access.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-060-001** — Implement canonical payment order/attempt state machines independent of Stripe object state.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-060-002** — Support authorization/capture timing, partial capture, incremental scenarios only where provider/method allows.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-060-003** — Implement customer authentication/action-required flows and safe resume.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-060-004** — Implement saved-payment-method consent, purpose, reuse, deletion and customer visibility.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-060-005** — Implement payment-method availability by country, currency, account and transaction attributes.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-060-006** — Implement receipts, customer communications, statement descriptors and merchant identity.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-060-007** — Implement duplicate submission protection using business and provider idempotency.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-060-008** — Test redirects, timeouts, retries, delayed methods, duplicate webhooks, abandonment, partial failures and provider recovery.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-070-001** — Implement the three canonical charge/funds-flow models without hiding liability differences.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-070-002** — Default eligible tenant merchants to direct charges where responsibility decisions are satisfied.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-070-003** — Require exception approval for destination and separate-charge flows that shift liability to Tenure.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-070-004** — Implement multi-recipient split rules with exact sum, rounding and reversal invariants.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-070-005** — Bind approved split version and digest to the payment; post-approval mutation creates a new change.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-070-006** — Implement transfer reversal/recovery after refund, failure or dispute.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-070-007** — Prevent transfers exceeding eligible balance or approved allocation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-070-008** — Test partial recipient failure, unavailable connected account, cross-border restrictions, currency mismatch and negative balance.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-080-001** — Implement explicit internal-allocation, internal-transfer, intercompany and external-movement command types.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-080-002** — Block Stripe calls for same-legal-entity memo/ledger allocations.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-080-003** — Require intercompany accounting and settlement policy for separate legal entities.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-080-004** — Preserve organization/fund/project/event/seat attribution through provider settlement.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-080-005** — Implement internal transfer approvals, budgets, restrictions, effective dates and reversals.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-080-006** — Prevent internal subledger balances from being presented as bank-held funds.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-080-007** — Reconcile internal allocations to provider cash/clearing and universal journal.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-080-008** — Test legal-entity boundary changes, club/department reorganization and successor handoff.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-090-001** — Implement distinct semantic commands and state machines for settlement payout, transfer, outbound payment, refund and disbursement.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-090-002** — Implement beneficiary master with tokenized/encrypted payment references and no raw bank data in general stores.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-090-003** — Implement vendor/contractor payout batch creation, approval, release, partial acceptance, return and reconciliation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-090-004** — Implement payout schedules, manual/instant eligibility, fees, limits and destination governance.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-090-005** — Implement beneficiary change cooling-off, step-up, dual control, alerts and exception evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-090-006** — Implement sanctions/fraud/provider checks through approved services without claiming universal regulatory coverage.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-090-007** — Implement tax-form/reporting data handoff only for exact supported jurisdictions and roles.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-090-008** — Test returned payments, invalid bank accounts, duplicate beneficiary, partial batch, provider outage, recall and repair.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-100-001** — Implement financial-account capability gating by country/entity/provider approval/API stability.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-100-002** — Model account owner, purpose, currency, balance types, features, restrictions and provider references.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-100-003** — Implement financial addresses and inbound funding without exposing full account details beyond authorized need.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-100-004** — Implement outbound transfer/payment selection using exact beneficiary ownership and rail semantics.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-100-005** — Implement multiple financial accounts with purpose and ledger mapping when supported.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-100-006** — Implement statement/transaction ingestion and reconciliation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-100-007** — Create provider version migration and coexistence plan before adopting a new financial-account API generation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-100-008** — Test insufficient funds, pending funds, returns, holds, unsupported rails, limits, duplicate requests and provider ambiguity.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-110-001** — Implement cardholder/card/control-policy canonical models and lifecycle.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-110-002** — Implement funding and ledger mapping without presenting internal allocations as provider balances.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-110-003** — Implement authorization controls, limits, merchant/country/currency rules and safe fallback behavior.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-110-004** — Implement card issuance/reveal/activation/freeze/replacement/cancellation with step-up and audit.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-110-005** — Implement receipt capture, coding, matching, approval and exception workflows.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-110-006** — Implement card disputes, fraud claims, evidence, deadlines and outcomes.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-110-007** — Prove no prohibited card data enters Tenure databases, logs, analytics, traces, screenshots or Relay.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-110-008** — Test authorization latency/failure, duplicate events, incremental capture, reversed authorization, lost card, replacement and late presentment.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-120-001** — Implement refund state machine, approval, split reversal and accounting.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-120-002** — Implement disputes as deadline-bound cases with immutable evidence packages.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-120-003** — Implement provider fee/loss/negative-balance ownership and journal treatment.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-120-004** — Implement risk holds and release authority without silently cancelling valid business work.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-120-005** — Implement reserves/rolling holds only when provider/contract/legal/accounting scope permits.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-120-006** — Implement alerts, queues, escalation, investigation, decision, appeal and support ownership.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-120-007** — Keep risk features, thresholds and PII purpose-separated from ordinary tenant users and Relay.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-120-008** — Test fraud/abuse, friendly fraud, refund-after-transfer, dispute-after-payout, expired evidence and negative balance.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-130-001** — Implement immutable payment subledger and versioned accounting-event contracts.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-130-002** — Implement posting templates with balanced-entry validation and effective dating.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-130-003** — Reconcile gross, fees, refunds, disputes, transfers, payouts, FX and net settlement.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-130-004** — Implement provider balance-transaction ingestion with qualified external keys and replay safety.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-130-005** — Implement daily and on-demand reconciliation runs, tolerances, exceptions, ownership and sign-off.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-130-006** — Require zero unexplained variance for money and authority; never auto-write off unexplained differences.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-130-007** — Link bank/ISO 20022 statements and Stripe payouts without duplicate cash recognition.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-130-008** — Test backdated events, late fees, partial settlements, FX, missing webhook, API correction and duplicated import.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-140-001** — Implement a single provider gateway with no raw SDK leakage.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-140-002** — Pin API versions and create contract/regression tests before upgrades.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-140-003** — Inventory API/product GA/beta/preview status and prohibit unapproved preview production use.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-140-004** — Implement account/program/mode context on every provider API call.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-140-005** — Implement stable idempotency keys and timeout recovery by lookup/reconciliation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-140-006** — Implement signature verification, raw-body handling, deduplication and asynchronous webhook inbox.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-140-007** — Implement event-gap polling/reconciliation and safe replay/redrive.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-140-008** — Test forged signatures, secret rotation, duplicate/out-of-order events, timeouts, 429s, 5xx, network partition and stale API schemas.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-150-001** — Implement payment capability permissions at server/domain layer, not navigation only.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-150-002** — Implement amount/currency/entity/org/fund/provider/beneficiary-aware authority.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-150-003** — Implement maker-checker, no-self-approval, conflict/recusal and delegated authority.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-150-004** — Implement approval digest invalidation for amount, recipient, destination, schedule, split or provider changes.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-150-005** — Implement step-up authentication and short action authorization for high-risk commands.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-150-006** — Implement emergency action path with explicit reason, notification and post-review.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-150-007** — Implement support impersonation prohibition; use scoped support access with customer visibility where policy requires.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-150-008** — Test privilege escalation, stale seat, terminated user, delegated expiry, currency threshold and split approval bypass.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-160-001** — Build the 12-stage resumable Payments Studio with ownership, evidence, blockers and readiness.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-160-002** — Render legal merchant, funds flow, fees, loss responsibility, tax, settlement and ledger preview before activation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-160-003** — Render provider capability/requirement truth and last synchronization time.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-160-004** — Provide test/live visual separation that cannot be confused by color alone.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-160-005** — Build provider account/resource graph with connected accounts, capabilities, financial accounts, cards, webhooks and destinations.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-160-006** — Implement change diff, risk class, approval, apply, verify, reconcile and rollback/disable chain.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-160-007** — Add safe links to provider-hosted actions when Tenure cannot/should not perform them, and verify return state.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-160-008** — Test all stages with empty, loading, pending requirement, rejected, restricted, failed, stale, drifted and recovered states.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-170-001** — Implement role-based information architecture for payer, requester, approver, treasurer, finance, merchant admin, risk, auditor and support.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-170-002** — Display canonical business state and separate provider/settlement/reconciliation state.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-170-003** — Implement transaction drill-through from business source to provider evidence, subledger, journal and bank settlement.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-170-004** — Implement clear pending/failed/restricted/disputed/returned/unknown states with next action and owner.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-170-005** — Implement searchable/filterable/exportable operations without leaking full financial identifiers.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-170-006** — Implement forest-green light/dark themes and supported embedded-component appearance safely.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-170-007** — Pass accessibility, localization, RTL, responsive, visual-regression and long-session fatigue tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-170-008** — Test screenshot/export/log redaction and shoulder-surfing/privacy behavior.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-180-001** — Implement typed read and draft tools with field-level authorization and tenant/legal-entity context.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-180-002** — Route every action through canonical commands and ordinary approvals; no privileged AI bypass.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-180-003** — Require source citations and as-of times for payment status, balances, fees and requirements.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-180-004** — Redact/tokenize financial identifiers in prompts, logs, traces and model outputs.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-180-005** — Prevent payment data from entering shared model training or cross-tenant memory.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-180-006** — Implement refusal and escalation for prohibited/ambiguous money movement.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-180-007** — Create evaluation sets for hallucinated settlement, wrong merchant, wrong amount/currency, unauthorized disclosure and unsafe action.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-180-008** — Prove Relay cannot bypass step-up, maker-checker, limits, eligibility or provider restriction.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-190-001** — Implement country/currency/method/capability matrix with effective dates and proof expiry.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-190-002** — Implement FX amount, provider conversion, fee and gain/loss evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-190-003** — Integrate tax determination/calculation through versioned provider contracts and preserve tax evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-190-004** — Implement invoice/receipt numbering, disclosures and e-invoice hooks by certified jurisdiction pack.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-190-005** — Implement provider tax-form/reporting exports only for exact role and jurisdiction.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-190-006** — Implement localization for names, addresses, bank identifiers, currencies, dates and payment-method terms.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-190-007** — Enforce residency, privacy, retention, legal hold and cross-border data controls.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-190-008** — Test unsupported country/currency/method, cross-border transfer, FX rounding, tax correction and regulatory-pack expiry.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-200-001** — Complete payments threat model and abuse-case review.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-200-002** — Document PCI scope, SAQ path and independent validation requirements without unsupported certification claims.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-200-003** — Tokenize/encrypt financial identifiers and implement masked display with purpose-based access.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-200-004** — Implement rate, velocity, amount, recipient, account and tenant limits with safe failure.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-200-005** — Implement immutable/redacted audit and evidence package for every high-risk action.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-200-006** — Implement anomaly alerts for privilege, bank changes, payouts, refunds, cards, negative balances and reconciliation gaps.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-200-007** — Perform SAST, dependency, IaC, secret, API authorization and penetration testing on payment surfaces.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-200-008** — Prove cross-tenant isolation across DB, cache, queue, events, files, search, analytics, logs, backups, exports, provider IDs and Relay.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-210-001** — Define SLOs, SLIs, error budgets and ownership for every enabled capability.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-210-002** — Implement trace/correlation from Tenure command to provider request/event, ledger, payout and bank settlement.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-210-003** — Implement dashboards/alerts for lag, failures, restrictions, disputes, negative balances and reconciliation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-210-004** — Implement provider outage circuit breakers, queues and safe degraded UX.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-210-005** — Implement runbooks for timeout ambiguity, event gaps, payout failure, compromised account/card, dispute deadline and provider incident.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-210-006** — Implement orphan provider-object and drift reconciliation without unsafe automatic deletion.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-210-007** — Implement customer-visible incident communication and exact affected-object identification.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-210-008** — Run game days for provider outage, key rotation, webhook loss, reconciliation drift, account restriction and negative balance.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-220-001** — Implement payments-specific suspend/disable/offboard state machine and blockers.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-220-002** — Prevent tenant purge with open disputes, refunds, payouts, negative balances, cards, financial accounts or retention holds.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-220-003** — Implement account/card/financial-account closure and provider-ownership transfer where supported.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-220-004** — Preserve required refund/dispute/support access after stopping new transactions.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-220-005** — Revoke sessions, webhooks, secrets and privileges with evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-220-006** — Export/reconcile provider, subledger, journal, bank, tax and audit records.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-220-007** — Scan for provider/AWS residual cost and disclose it truthfully.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-220-008** — Test reactivation only where provider/account state supports it; never promise reversible closure.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-230-001** — Create a Simon payments discovery workbook and mark every unconfirmed fact/blocker.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-230-002** — Obtain exact legal merchant, bank, tax, provider, security and policy decisions before live activation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-230-003** — Model clubs as internal dimensions unless independent legal/merchant evidence is approved.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-230-004** — Implement dues/event/sponsorship receipt allocation to club/fund/event and universal journal.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-230-005** — Implement configurable club request/President/OSE approval for reimbursements/vendor disbursements.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-230-006** — Implement OSE-wide oversight and club-scoped visibility with strict privacy.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-230-007** — Migrate any existing payment records/providers through immutable extraction, mapping, reconciliation, cutover and rollback.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-230-008** — Prove global payment releases reach Simon through the Parent release train without a Simon code fork.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-240-001** — Produce immutable provider inventory and ownership map without exposing secrets.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-240-002** — Define canonical mappings, external-ID qualification, history scope and unsupported objects.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-240-003** — Reconcile customers, merchants, payments, refunds, disputes, transfers, payouts, balances, cards and subscriptions.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-240-004** — Preserve consent, mandates, provider restrictions and customer communication requirements.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-240-005** — Run repeated test-mode/full-scale mock migrations and final reconciliation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-240-006** — Plan webhook/API cutover with no event gap, duplication or double processing.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-240-007** — Implement rollback/coexistence boundaries; never assume provider money movement can be undone.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-240-008** — Retire legacy keys/endpoints only after traffic, event, reconciliation and owner evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-250-001** — Build contract/unit/property/integration/E2E/security/chaos/reconciliation test suites.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-250-002** — Use deterministic Stripe test clocks/test helpers where applicable without confusing simulation with certification.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-250-003** — Test all 12 mandatory E2E scenarios with evidence and rollback/recovery.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-250-004** — Test cross-tenant isolation across every storage, event and provider-reference path.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-250-005** — Run load tests at expected plus safety-factor volume without creating uncontrolled provider cost.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-250-006** — Run penetration/abuse tests and remediate critical/high findings.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-250-007** — Complete provider/country/capability certification evidence with expiry and known limits.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-250-008** — Keep live capabilities unavailable until production-readiness and human approval gates pass.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-260-001** — Create dependency-ordered implementation ledger and evidence directory.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-260-002** — Complete read-only provider truth before enabling writes.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-260-003** — Enable write authority by narrow capability and environment, not one omnipotent Stripe key path.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-260-004** — Use low limits and explicit pilot merchants for first live activation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-260-005** — Define automatic pause thresholds for authorization errors, webhooks, negative balances, disputes, reconciliation and security.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-260-006** — Prove disable/rollback/recovery before each rollout wave.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-260-007** — Record pilot outcomes, incidents, support load, fees and reconciliation before expansion.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-260-008** — Update capability status and known limitations from evidence, not schedule pressure.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-270-001** — Deliver all architecture/ADR artifacts and cross-link them from the main Bible.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-270-002** — Deliver machine-validated configuration and capability schemas.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-270-003** — Deliver generated API/event documentation and example fixtures with no secrets/real customer data.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-270-004** — Deliver dashboards, alarms, queues, runbooks and support ownership.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-270-005** — Deliver migration/coexistence/cutover/rollback package.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-270-006** — Deliver security, PCI-scope, privacy and threat-model evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-270-007** — Deliver E2E/reconciliation/certification evidence and residual gaps.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-270-008** — Update the 120-plane completeness audit from `S` only after the full minimum architecture contract is proven.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented
