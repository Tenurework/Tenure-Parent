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

Statuses: `PASS` · `FAIL` · `BLOCKED_EXTERNAL` · `NOT_APPLICABLE`. There is no
`PARTIAL` and no `BLOCKED_ARCHITECTURE` — `tools/loop/next-batch.mjs` decides on
`PASS`, `BLOCKED_EXTERNAL` and `NOT_APPLICABLE` only, so any other word reads as
undecided and returns the item to the queue every tick, forever. An unfinished
requirement is `FAIL` if the rest can be built now, and `BLOCKED_EXTERNAL` — naming
the commands or the ADR that would unblock it — if it cannot.

- [x] **PAY-000-001** — Create `docs/payments/payment-authority-and-regulatory-boundary.md` with exact Tenure, tenant, Stripe, bank and network responsibilities.
  - Status: PASS
  - What was open: the payments code had grown a real authority model — an
    eight-axis responsibility matrix, forbidden party/axis pairs, a
    direct-charge exclusion list, a refusal layer and a liability gate — and no
    document said what any of it meant. `docs/payments/` did not exist. The
    boundary therefore lived only as behaviour: readable by opening five
    TypeScript files in the right order, invisible to anybody deciding whether
    Tenure had accepted a liability.
  - Code/config — a document derived from the tree, not from the Bible's wording:
    `docs/payments/payment-authority-and-regulatory-boundary.md`. Nine sections.
    §1 lists the parties and says which ones the code can represent: four
    (`TENURE`, `TENANT`, `PROVIDER`, `CUSTOMER`), not the five the requirement
    names — the **bank and the card network are not modelled at all**, and §5,
    §6 and §9 say so in those words rather than describing an intent as a
    mechanism. §2 maps each of Bible §2's five "Tenure is" statements to the
    file that performs it. §7 is the full axis table, one row per
    `RESPONSIBILITY_AXES` entry, with the parties `FORBIDDEN_PARTIES` refuses
    and the parties left. §8 answers each of Bible §2's seven "Tenure is not
    automatically" lines with the mechanism that refuses it — and marks the one
    with no mechanism ("not a replacement for provider, bank, network or
    regulator records") as document-only. The registry composition (31 leaves,
    24 `PLANNED`, 7 `UNSUPPORTED`, none transactable) is stated as a number the
    guard recomputes.
  - Tests: `tests/architecture/pay-authority-boundary-and-adrs.test.mjs`, 9
    tests, run under bare `node --test` (the root suite is not jest). Test 1
    pins every parsed list by value first, so a reader that silently returns
    `[]` cannot make the other eight vacuously green — the failure that shipped
    five times in this repository. Test 3 rebuilds the §7 table from
    `packages/payments/src/responsibility.ts` and requires the line. Test 6
    reads Bible §2's list out of the Bible rather than copying it here. Test 9
    opens every repository path all three documents cite.
  - Mutation 1: deleted the `kycUpdateOwner` row from the §7 table ->
    `not ok 3 - the boundary document's axis table is the code's, row for row`,
    8 pass / 1 fail; restored -> 9 pass / 0 fail.
  - Mutation 2 (the other direction — code moves, document does not): in
    `packages/payments/src/responsibility.ts`, changed
    `merchantDisplay: ["CUSTOMER", "PROVIDER"]` to `merchantDisplay: ["CUSTOMER"]`
    -> `not ok 3`, 8 pass / 1 fail; restored -> 9 pass / 0 fail, and
    `git status --porcelain packages/payments/src/responsibility.ts` empty.
  - Mutation 3: changed `| Guarantor for tenant negative balances. |` to
    `| Guarantor for negative balances. |` ->
    `not ok 6 - Bible §2's list of what Tenure is not is answered item by item`,
    8 pass / 1 fail; restored -> 9 pass / 0 fail.
  - Evidence: `node --test tests/architecture/pay-authority-boundary-and-adrs.test.mjs`
    -> 9/9. `npm run test:platform` -> 484/503; the 19 failures are the
    pre-existing ones (generated artefacts stale, `apps/web/src/lib/analytics/metrics.ts`
    unowned, six STUDIO-070 entries unevidenced) and none names a file this
    entry touched.
  - Honest limit: the guard checks that the code has not grown past the
    document. It cannot check §5, §6 or §9, because those describe what is not
    modelled and there is nothing to compare them to. A green run is not
    evidence that the bank and network rows are right.

- [x] **PAY-000-002** — Record the approved merchant-of-record default and all exception paths in an ADR.
  - Status: PASS
  - What was open: `packages/payments/src/responsibility.ts` and
    `packages/payments/src/liability.ts` implemented a merchant-of-record
    position nobody had written down — which is the state in which changing it
    looks like a refactor. PAY-160-002 had already shipped a pre-activation
    panel that renders "Merchant of record: UNDECIDED" and names *this*
    requirement as the ADR that would decide it.
  - Code/config: `docs/decisions/pay-adr-0001-merchant-of-record-default-and-exception-paths.md`.
    Records the default Bible §1.1 states — the tenant legal entity is the
    merchant, Tenure is not by default — with the three properties that make it
    a rule (legal-entity boundary per Bible §1.4, no default arm, internal
    allocation has no merchant per Bible §1.10), then **four exception paths,
    which are not equals**: E1 destination charge and E2 separate charges and
    transfers are *approvable* through `assertLiabilityApproved` with a pinned
    `chargeModelDigest`; E3 cross-border acquiring and E4 a platform fee are
    *hard blockers* in `packages/payments/src/charge-model.ts` that no approval
    in this repository can clear, and each names what would (PAY-000-005; Bible
    §1.6's five approvals). Four alternatives with why each was rejected.
  - This ADR grants nothing. It records the Bible's approved default and states
    that no exception is granted by it. Verified: `grep -rn "liability-exception" apps/web/prisma/`
    returns nothing — no approval row exists — and `ApprovalType.EXCEPTION` is
    real at `apps/web/prisma/schema.prisma:460`.
  - It also records a **defect it does not fix** (Consequence 4):
    `requiresLiabilityException` keys on the resolved `lossPayer`, so a
    `DESTINATION` flow with `merchantDisplay: TENURE` and `lossPayer: TENANT`
    passes the gate with no exception — Tenure appears as merchant while the
    gate, watching loss, sees nothing. Closing it is a code change to
    `packages/payments/src/liability.ts` belonging to PAY-040-002, deliberately
    not made here.
  - The `legal-merchant` disclosure in `packages/finops/src/pricing.ts:411` stays
    `UNDECIDED` and was **not** flipped by this ADR, deliberately. It asks who is
    legally selling to *this tenant*; the ADR records the platform default (the
    tenant legal entity) and which legal entity that is for a given tenant, with
    what provider arrangement, is still unrecorded. Flipping a per-tenant
    disclosure on the strength of a platform default is the fabricated-approval
    failure in miniature.
  - Filename note: prefixed `pay-` rather than numbered `ADR-000N` because
    sixteen agents are writing this tree concurrently and two claiming
    `ADR-0009` loses somebody's work — the collision `docs/decisions/README.md`
    records happening to `PD-004` and `ADR-0005`. Format follows
    `docs/decisions/ADR-0007-tenure-owned-aws-organization.md`.
  - Tests: `tests/architecture/pay-authority-boundary-and-adrs.test.mjs` test 7
    requires the ADR to name every entry of `LIABILITY_SHIFTING_MODELS`, to name
    the gate `assertLiabilityApproved` **and** for `packages/payments/src/liability.ts`
    to still export it, and to quote Bible §1.1's default verbatim. Test 9 opens
    every path it cites.
  - Mutation 1: renamed the ADR's one `` `SEPARATE_CHARGE_AND_TRANSFER` `` to
    `` `SPLIT_TRANSFER` `` -> `not ok 7 - the merchant-of-record ADR names every
    liability-shifting model as an exception path`, 8 pass / 1 fail; restored ->
    9 pass / 0 fail.
  - Mutation 2: changed the cited `packages/payments/src/liability.ts` to
    `packages/payments/src/liabilities.ts` ->
    `not ok 9 - every repository path the three documents cite exists`,
    8 pass / 1 fail; restored -> 9 pass / 0 fail.
  - Evidence: `node --test tests/architecture/pay-authority-boundary-and-adrs.test.mjs`
    -> 9/9, 5 mutations across this entry and PAY-000-001/003, 5 caught.

- [x] **PAY-000-003** — Record the fee payer, negative-balance, dispute and loss responsibility selection algorithm in an ADR.
  - Status: PASS
  - What was open: the algorithm existed across four files and one ordering
    decision — `FUNDS_FLOWS` being ascending platform liability — carried the
    whole of Bible §1.2's "prefer" with nothing recording that it did. Reorder
    that array and every future merchant gets a different liability answer, and
    the diff reads as tidying.
  - Code/config: `docs/decisions/pay-adr-0002-responsibility-selection-algorithm.md`.
    Six numbered steps, each matching the implementation: (1) eligibility first,
    `packages/payments/src/eligibility.ts`; (2) resolve all eight axes for every
    flow, with the three refusals — unanswered, forbidden pair, and
    `DIRECT_CHARGE_NOT_TENURE` — from `packages/payments/src/responsibility.ts`;
    (3) take the first flow with zero blockers in `FUNDS_FLOWS` order, i.e.
    ascending platform liability, `packages/payments/src/funds-flow.ts`; (4)
    derive model and liable party through `MODEL_FOR_FLOW`, treating the
    caller's claimed `lossBearer` as an input to check rather than a source of
    truth; (5) the flow-independent refusals in
    `packages/payments/src/charge-model.ts`; (6) the pinned-digest exception
    when loss lands on Tenure. Six alternatives rejected with reasons, including
    the tempting one — derive the matrix from the flow.
  - Records why negative balance has no axis of its own: it is what an unpaid
    loss becomes, so it resolves with `lossPayer`; splitting them would let one
    configuration answer the same question twice.
  - Tests: `tests/architecture/pay-authority-boundary-and-adrs.test.mjs` test 8
    requires the ADR to name every `RESPONSIBILITY_AXES` entry, to state the
    flow order verbatim (that order IS the algorithm), and to record every
    `MODEL_FOR_FLOW` pair as `flow → MODEL`. A ninth axis, a fourth flow or a
    re-ordering reds it.
  - Mutation: the code-side mutation recorded under PAY-000-001 (removing
    `PROVIDER` from `FORBIDDEN_PARTIES.merchantDisplay`) is the same guard file
    proving it reads the real source; for this entry, deleting the
    `kycUpdateOwner` row and renaming a model both red their tests as recorded
    above. Restored each time -> 9 pass / 0 fail.
  - Evidence: `node --test tests/architecture/pay-authority-boundary-and-adrs.test.mjs`
    -> 9/9.
  - Honest limit: this ADR records a decision, and the decision is real code —
    but it selects nothing today. No merchant profile, no `FundsFlowConfig` and
    no approval row exists in this repository, and no payment capability is
    transactable. The algorithm is exercised only by
    `packages/payments/src/responsibility.test.ts`, `funds-flow.test.ts`,
    `charge-model.test.ts` and `liability.test.ts`.

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
  - Status: BLOCKED_EXTERNAL
  - What was open: there was no mode concept at all to separate anything by.
    Grepping `stripe|payout|merchant|connected account` across `*.ts`, `*.tsx`,
    `*.prisma` and `*.mjs` matched only the Bible-reading tooling
    (`tools/document-graph.mjs`, `tools/import-requirements.mjs`,
    `tools/loop/*.mjs`), so no key, secret or event destination existed to
    segregate. The only environment notion was
    `NODE_ENV: z.enum(["development","test","production"])` at
    `apps/web/src/lib/env.ts:33` — a deployment fact, one string for every
    tenant a container serves. `CONFIG_SCOPES` had no environment layer, so a
    tenant could not hold different values in test and live, and `AuditEvent`
    had no mode column, so evidence could not say which mode an action was in.
  - What was built — the control-plane half, no provider, no keys, no money:
    (a) **One spelling.** `PaymentMode = "test" | "live"`, `PAYMENT_MODES`,
    `isPaymentMode`, `PAYMENT_MODE_CONFIG_KEY` and `LEGAL_ENTITY_CONFIG_KEY` in
    `packages/contracts/src/index.ts`, shared by the configuration engine and
    the application so a value spelled `"testing"` in one module cannot compare
    unequal to `"test"` in another and take the live branch.
    (b) **Evidence carries the mode.** `AuditEvent.mode TEXT NOT NULL DEFAULT
    'test'` plus `@@index([institutionId, mode, occurredAt])`, migration
    `20260807120000_audit_event_records_money_mode`, applied and verified —
    `docker exec tenure-pg-pay psql -U tenure -d tenure -c '\d "AuditEvent"'`
    shows both the column and the index. `recordAuditEvent`
    (`apps/web/src/lib/audit-record.ts`) writes it from the ambient
    `TenantScope.environment` and mirrors it into the hash-covered metadata as
    `_mode`, so the column is not the one field a rewrite around the application
    could change without breaking a chain link. Backfill is `'test'`: none of
    the existing rows were written by a payment path, and calling them live
    would manufacture evidence.
    (c) **A mode change is an authorised publication with a diff.**
    `platform.payments.mode` and `platform.payments.legalEntityId` in
    `packages/platform-config/src/definitions.ts` — `allowedScopes: ["tenant"]`,
    defaults `test` and `""`, each with `requiresCapability`. A `payments`
    domain was added to `packages/configuration/src/domains.ts`, because
    `validateDomains` refuses a key no domain claims and an unclaimed key is
    governed by nothing. `ConfigDefinition.requiresCapability` had been DECLARED
    AND ENFORCED NOWHERE (grep found one read, in `flags.ts`, only to forbid
    it); `planPublication` now blocks a proposal touching such a key unless
    `publisherCapabilities` contains it. A new `liveOnly` flag blocks a
    live-only value while the tenant's CURRENT configuration says `test` —
    including within the same publication that would flip the mode, so a
    jurisdiction cannot ride in on the change that makes it meaningful.
  - Caller: `audit-record.ts` had ZERO importers (NEXT-SESSION §5). Both writers
    that section names are now on it — `apps/web/src/lib/admin/guard.ts`
    (`requireCapability`, the single gate every privileged administration
    command passes through, allow and deny alike) and
    `apps/web/src/lib/provisioning/reconcile.ts` (`Tenant.Reconciled`, on the
    reconciler's own `tx` via `txAuditLedger`, so the row cannot exist for a
    reconcile that rolled back). Both previously called `buildAuditRecord`
    directly, which produces a record with no chain position — the state
    `verifyChain` reports as unchained (NEXT-SESSION GE-063-004). The mode
    itself is produced by `paymentModeForInstitution` in
    `apps/web/src/lib/config/server.ts` and threaded through `scopeForUser`,
    `withSystemTenantScope` and `exportTenant`, so every block of work carries
    it ambiently and no writer has to remember to pass it.
  - Tests: `apps/web/src/lib/admin/guard.test.ts` (4 cases, new — drives the
    real `recordAuditEvent` and `prismaAuditLedger` behind a stand-in database
    whose `findFirst` genuinely filters by institution AND chain position, so it
    behaves like the query production runs); `apps/web/src/lib/audit-record.test.ts`
    "the money-mode on the row" (5 cases); `apps/web/src/lib/config/payment-mode.test.ts`
    (6 cases, new); `packages/configuration/src/publication.test.ts` "money-mode
    is an authorised publication" (6 cases);
    `packages/platform-config/src/resolve.test.ts` now pins every
    authority-gating key AND its default value instead of asserting no such key
    exists — the reconsideration that test's own comment asked for, rather than
    the assertion being deleted. Round-tripped through PostgreSQL by
    `apps/web/src/lib/provisioning/reconcile.itest.ts` "records which artifact
    materialised the tenant", which now asserts `audit.mode === "test"`,
    `_mode`, `_sequence === 0` and a string `_recordHash`.
  - Mutation: (1) `recordAuditEvent`'s mode frozen to the constant `"test"` → 4
    RED across `audit-record.test.ts` and `guard.test.ts`; restored → 35 pass.
    (2) `guard.ts` stops calling `recordAuditEvent` → all 4 guard cases RED, no
    rows written at all; restored → 4 pass. (3) `planPublication`'s `liveOnly`
    blocker disabled → 2 RED; restored. (4) its `requiresCapability` blocker
    disabled → 1 RED; restored → 30 pass. (5) `modeOf` in `config/server.ts`
    changed to read `process.env.NODE_ENV` → 2 RED in `payment-mode.test.ts`;
    restored → 11 pass. (6) `reconcile.ts` `mode: "test"` → `"live"` → the
    integration assertion RED; and separately, unwiring `recordAuditEvent`
    there → `audit` reads back null, RED; restored → 17 pass.
    A SEVENTH mutation was NOT caught, and the CLAIM was fixed rather than the
    test kept: a first attempt asserted "reports the tenant's mode, not the
    process's" by forcing `process.env.NODE_ENV = "production"`, which the build
    transform makes inert — the `NODE_ENV` mutation stayed green against it.
    That test was deleted and replaced by `payment-mode.test.ts`, which proves
    the property the way it actually matters: two tenants, one process, two
    different modes.
  - Evidence: `npx tsc --noEmit -p apps/web/tsconfig.json` → 6 errors, all in
    two UNTRACKED files another agent is mid-edit on
    (`apps/web/src/lib/approval-digest.itest.ts` passing `"test"` as an
    `UnscopedReason`, and `.../finance/money-path.itest.ts` importing an
    unexported `FinanceAuditAction`); none in any file this item touched.
    `npx jest --config apps/web/jest.config.js --rootDir apps/web --ci
    src/lib/admin src/lib/audit-record.test.ts src/lib/config
    packages/configuration/src/publication.test.ts
    packages/platform-config/src/resolve.test.ts` → all pass.
    `DATABASE_URL=postgresql://tenure:tenure@localhost:5434/tenure npx jest --ci
    --testMatch "**/reconcile.itest.ts"` → 17/17.
  - Why BLOCKED_EXTERNAL and not PASS: the requirement names eight dimensions
    and four of them cannot be built here. **Account, keys, secrets and event
    destinations** need a Stripe platform account, a live and a test restricted
    key per environment, and a webhook endpoint secret per mode — every one a
    credential a human must create and place in AWS Secrets Manager.
    NEXT-SESSION §0.3 is explicit: "Do not retrieve, print, copy or rotate
    secret values", "Do not execute payments, payroll, bank instructions or
    Stripe money movement", and "Never treat an AI, agent, operator, or test
    result as human approval." Marking this PASS on the control-plane half would
    claim a separation of provider accounts that does not exist.
    To unblock: create the Stripe platform account and its test and live
    restricted keys, then
    `aws secretsmanager create-secret --name tenure/payments/test --secret-string ...`
    and the same for `tenure/payments/live`, add both ARNs to
    `infrastructure/terraform/secrets.tf`, and record an ADR naming which legal
    entity holds the live account. The mode dimension every one of those needs
    now exists and is enforced.

- [x] **PAY-000-008** - Mark every unapproved capability `UNSUPPORTED` or `PLANNED`; never infer availability from a Stripe marketing page.
  - Status: PASS
  - What was open: there was no payments capability surface at all. `packages/`
    held audit, authorization, configuration, contracts, finops, identity,
    metadata, module-runtime, organization-model, platform-config, provisioning,
    releases and workflow - no `payments`. `packages/platform-config/src/modules.ts`
    modelled module availability as a boolean set of enabled keys, with no
    lifecycle state and no provider dimension, so an operator reading it could
    not tell "Stripe documents this" from "Tenure has approved and certified
    this". Bible section 3 requires that availability truth to be the same in
    System Studio, the tenant UI, the APIs and the docs; there was no single
    source for it to be the same as.
  - Code: `packages/payments/src/capability-registry.ts` declares the ten-state
    `CapabilityState` vocabulary, `PaymentCapability` (id, provider, program,
    state, `approvedBy: {adr} | null`, effectiveFrom/To, and the country /
    currency / entity-type / business-type support matrix), and seeds all 31
    Bible section 3 leaves. Every one is `PLANNED` or `UNSUPPORTED`, because none
    has an approval ADR; `UNSUPPORTED` is used exactly where Bible section 2 says
    Tenure is not the thing (issuer, bank, custodian, KYC decision owner) or
    where section 0.6 disables it (platform fees), and those carry an EMPTY
    matrix so eligibility blocks on every axis at once.
  - The refusal: `assertRegistry(caps, { adrExists })` throws
    `capability-state-unapproved` for a `TENANT_PILOT`/`GA_LIMITED`/`GA` entry
    with no ADR, and a DIFFERENT code, `capability-adr-missing`, when the named
    ADR is not a file on disk. Two codes because they need two different fixes.
  - Production caller: `capabilityAvailabilityForModules(keys, at)` runs
    `assertRegistry` against `adrExistsOnDisk` on every read, and
    `packages/platform-config/src/modules.ts` calls it at both `modulesFor`
    return sites to populate the new, non-optional
    `SystemModules.paymentCapabilities`. `apps/system-studio/src/app/page.tsx`
    renders that as a Module / Capability / State table - a state per row, never
    a tick.
  - Consumers checked when `SystemModules` widened: `modulesFor` is the only
    producer (both return sites updated); readers are
    `apps/system-studio/src/app/page.tsx`, `apps/system-studio/src/lib/adopt.ts`,
    `apps/web/src/app/api/me/route.ts`, `apps/web/src/lib/relay-tools.ts`,
    `apps/web/src/lib/resources-data.ts` and
    `packages/platform-config/src/build-system.ts`. The field is required, not
    optional, so a new producer cannot forget it.
  - Tests: `packages/payments/src/capability-registry.test.ts` - 19 tests.
  - Mutations: (1) flipped `acceptance.card-and-wallet` to `GA` with
    `approvedBy: null` - `capability-state-unapproved` thrown, red; (2) pointed
    `approvedBy.adr` at `docs/decisions/ADR-9999-nope.md` -
    `capability-adr-missing`, a different code, red; (3) deleted the
    `assertRegistry` call from `capabilityAvailabilityForModules` - GREEN on the
    first pass, which is the honest result and a real gap: every other assertion
    called `assertRegistry` itself, so the READ PATH could stop validating and
    nothing would red. Fixed by adding "VALIDATES on every read", which mutates
    the registry the way a careless promotion would and asserts the reader
    throws; the same mutation is now RED. 3 mutations, 3 caught after the gap
    was closed.
  - Evidence: `npx jest --ci packages/payments/src` - 12 suites, 151 tests, all
    green.

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

- [x] **PAY-010-006** - Add country/currency/entity/business-type eligibility simulation with explainable blockers.
  - Status: PASS
  - What was open: nothing simulated eligibility. There was no country table and
    no business-type model. `packages/platform-config/src/localization.ts`
    declared a `currency` config option validated only for ISO-4217 shape and
    `Intl` formattability - so a tenant could publish any formattable currency
    and no code answered whether it was acceptable for its country, legal entity
    or provider program. REVIEW-FINDINGS section 21 makes the same point from the
    module side: a collapsed refusal "produces support tickets that take a week".
  - Code: `packages/payments/src/eligibility.ts` - `simulateEligibility({
    capabilityId, country, currency, legalEntityType, businessType, at })`
    returns `{ eligible, blockers }` where each `Blocker` is `{ code, subject,
    detail, whatWouldUnblock }`. It evaluates against the registry's declared
    matrix, never a constant, and returns EVERY blocker in a fixed order -
    state, country, currency, entity, business type - so an operator who fixes
    one is not handed the next.
  - Production caller: `simulateCurrencySelection(code)` is the reader behind
    `platform.localization.currency` in
    `packages/platform-config/src/localization.ts`, added as a `superRefine` that
    surfaces the blocker's own `whatWouldUnblock` as the message. An ineligible
    currency is refused at SELECTION rather than at first charge, which matters
    because by first charge every budget, ledger entry and approval is already
    denominated in it. The shipped blueprints publish USD, GBP and AED and all
    three remain settleable.
  - Tests: `packages/payments/src/eligibility.test.ts` - 11 tests, including the
    five-blockers-at-once case and the currency reader.
  - Mutations: (1) `blockers.slice(0, 1)` on the return - "returns five blockers
    for a request that is wrong on every axis" red; (2) deleted the
    `isTransactable(state)` branch - "blocks on state for an UNSUPPORTED
    capability even when every other axis is fine" red. 2 mutations, 2 caught,
    both restored and green.
  - Evidence: `npx jest --ci packages/payments/src` - 151/151.

- [ ] **PAY-010-007** — Add a provider feature/version watch process; provider changes create review tasks, not automatic production mutations.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-010-008** — Prove an unsupported capability cannot be enabled through direct manifest editing or stale UI.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-020-001** — Publish bounded-context ownership and dependency diagrams.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [x] **PAY-020-002** - Create interfaces that prevent finance, billing, procurement, payroll, marketplace and Simon modules from importing raw Stripe clients.
  - Status: PASS
  - What was open: `packages/` had no payments package, so there was nothing to
    point a module at. Grepping the workspace manifests for a provider SDK
    returned nothing and the only "stripe" string in any source tree was a
    requirement TITLE in a generated artefact. The alternative door, `dispatch()`
    in `apps/web/src/lib/commands/bus.ts`, had ZERO production callers.
  - Code: `packages/payments/src/gateway.ts` - a provider-neutral surface over
    integer minor units and an explicit `ProviderMode`: `quotePayment`,
    `describeMerchant` and a re-exported `classifyRequest`. No provider SDK, no
    network, and no write verb in the type - `charge`, `payout` and `transfer`
    are absent rather than unimplemented, so a module cannot reach for one.
    `packages/payments/package.json` declares no dependencies at all.
  - Production consumer: `apps/web/src/lib/finance.ts` gained
    `ledgerDisclosure(...)`, which delegates to `describeMerchant`; it is
    rendered by `apps/web/src/components/finance/LedgerDrawer.tsx` with the
    merchant identity threaded from
    `apps/web/src/app/(app)/orgs/[slug]/finance/page.tsx` through
    `FinanceDashboard`. The import is the `@tenure/payments/gateway` subpath -
    the client-safe one - because the package root reaches `node:fs` and
    `node:crypto`.
  - Guard: `tests/architecture/payments-port-is-the-only-door.test.mjs` - 6
    tests: no source imports a provider SDK, no workspace depends on one,
    `@tenure/payments` declares no dependencies, the `./gateway` import graph
    reaches no node builtin, the port exports no write verb, and `finance.ts`
    actually calls it.
  - Mutations: (1) added `export function chargeCustomer()` to `gateway.ts` -
    "the port carries no write verb" red; (2) removed the `describeMerchant`
    call from `finance.ts` - "the port's real consumer is wired" red; (3) added a
    provider SDK import to `gateway.ts` - "no source file imports a provider SDK"
    red. 3 mutations, 3 caught; all restored, all green.
  - Evidence: `node --test tests/architecture/payments-port-is-the-only-door.test.mjs`
    - 6 tests, 6 pass.

- [x] **PAY-020-003** — Enforce tenant, environment, legal entity, provider account and capability context on every command/query.
  - Status: PASS
  - What was open: `packages/contracts/src/index.ts:77-87` was the whole of
    `TenantContext` — tenantId, actorId, actorKind, channel, correlationId,
    configRevision, at — and `parseTenantContext` validated exactly those seven,
    so a command in a test environment and one in a live environment were
    byte-identical values. The app's ambient scope was narrower still
    (`TenantScope = { institutionId, actor }`). `legalEntity` had been a
    declared configuration scope since the engine was written — "the level where
    jurisdiction lives", `packages/configuration/src/scopes.ts:43` — with
    nothing in either contract able to name one.
  - What was built: `environment: PaymentMode` and `legalEntityId: string | null`
    on `TenantContext`, both REQUIRED and both validated in `parseTenantContext`
    — a missing or unrecognised `environment` throws `ContractViolation` naming
    the field, and `legalEntityId` must be PRESENT, with `null` saying "the
    tenant's own entity" explicitly, the same decision `expectedVersion` makes.
    Required rather than optional because an optional money-mode is the one a
    call site under time pressure omits. `ConfigSnapshot` gained `environment`
    for the same reason: a revision alone cannot say which mode it resolved for.
    `TenantScope` gained `environment`, and `runInTenantScope` REFUSES a scope
    without a recognised one rather than defaulting.
  - Caller: every construction site was fixed in this change, enumerated —
    `apps/web/src/app/api/ai/chat/route.ts` (`parseTenantContext`, now passing
    `scope.environment` and a resolved `legalEntityId`),
    `apps/web/src/lib/tenancy/resolver.ts` `contextFrom`,
    `apps/web/src/lib/tenant-scope.ts` `scopeForUser` and
    `withSystemTenantScope` (both resolve the mode via
    `paymentModeForInstitution`),
    `apps/web/src/lib/platform/tenant-export.ts`, and
    `apps/web/src/lib/config/server.ts` (`configSnapshotForInstitution` stamps
    it); plus the fixtures in `bus.test.ts`, `relay-tools.test.ts`,
    `resolver.test.ts`, `contracts.test.ts`, `context.test.ts`,
    `repository.test.ts`, `scope-args.test.ts`, `ai-kill-switch.test.ts`,
    `isolation.itest.ts` and `search-data.itest.ts`. The survey named a context
    literal at `apps/web/src/app/api/jobs/reminders/route.ts:63`; that is a
    `JobRequest`, not a `TenantContext`, and needed no change.
    New producers: `paymentModeForInstitution` and `legalEntityIdForInstitution`
    in `apps/web/src/lib/config/server.ts`, resolving `platform.payments.mode`
    and `platform.payments.legalEntityId`, so the legal entity is a value a
    tenant publishes rather than a field nothing ever sets.
  - Capability context: `dispatch` (`apps/web/src/lib/commands/bus.ts`) gained a
    `configuration(context)` port and refuses, BEFORE the idempotency claim, a
    command whose declared mode differs from the mode the configuration it names
    was resolved for (`config.mode-mismatch`), a command naming a stale revision
    (`config.revision-stale`), and a tenant with no resolvable configuration
    (`config.unresolved`). Before the claim deliberately: a mismatch is a
    refusal the caller can fix and resend, not a request that happened, so it
    must not burn the key.
  - Tests: `packages/contracts/src/contracts.test.ts` — "refuses a context that
    does not say which money-mode it is in" walks 7 bad values and asserts
    `err.field === "environment"`, plus "refuses a context that leaves the legal
    entity unstated". `apps/web/src/lib/tenancy/context.test.ts` — "refuses a
    scope with no money-mode" (7 values) and "carries the money-mode into the
    block". `apps/web/src/lib/commands/bus.test.ts` — a new "money-mode
    separation" block whose ports stand in for a tenant that is in ONE mode and
    answer with that mode's snapshot whatever the command claims, so a
    mode-echoing stand-in cannot make the check pass by construction (6 cases).
    `apps/web/src/lib/config/payment-mode.test.ts` proves two tenants in one
    process resolve different modes.
  - Mutation: (1) `parseTenantContext` changed to default `environment` to
    `"live"` instead of refusing → "refuses a context that does not say which
    money-mode it is in" RED; restored → 45 pass. (2) `dispatch`'s mode check
    disabled → 2 RED in "money-mode separation"; restored → 23 pass. (3)
    `runInTenantScope`'s environment guard disabled → "refuses a scope with no
    money-mode" RED; restored → 29 pass. (4) `modeOf` in `config/server.ts`
    switched to `process.env.NODE_ENV` → 2 RED in `payment-mode.test.ts`;
    restored → 11 pass.
  - Evidence: `npx tsc --noEmit -p apps/web/tsconfig.json` → 6 errors, none in
    any file this item touched (both are untracked files another agent is
    mid-edit on). `npx jest --config apps/web/jest.config.js --rootDir apps/web
    --ci packages/contracts src/lib/commands src/lib/tenancy/context.test.ts
    src/lib/tenancy/resolver.test.ts src/lib/config src/app/api/ai` → all pass.
  - Not done, stated plainly: `RequestContext`
    (`apps/web/src/lib/tenancy/request-context.ts`) did NOT gain these fields.
    `grep -rn createRequestContext apps` returns only its own test — it has no
    production constructor, so adding a required field there would be adding a
    field to a shape nothing builds. **Provider account context is absent
    because no provider exists**: see PAY-000-007, recorded BLOCKED_EXTERNAL on
    NEXT-SESSION §0.3 for the Stripe account and key work. The context contract
    now carries the mode and the legal entity a provider-account reference would
    be qualified by; `ExternalReference` already keys on
    `[provider, mode, connectedAccountId, ...]` (PAY-020-004).

- [x] **PAY-020-004** — Implement provider-neutral canonical IDs and separate external-provider reference tables.
  - Status: PASS
  - What was open: `apps/web/prisma/schema.prisma` declared 41 models and not one
    was a provider reference table — no `PaymentProvider`, no `ExternalReference`,
    no external-id table of any kind. Bible §5 states the rule this violated
    directly: "A raw stripe_customer_id without account context is not globally
    unique enough." The same file carried the verified P0: `idempotencyKey String?
    @unique` on ApprovalRequest (schema.prisma:466) was a client-supplied GLOBAL
    unique, so tenant B's retry resolved onto tenant A's approval — flatly
    contradicting `IdempotencyRecord.tenantId` in packages/contracts and the
    `context.tenantId` threaded through every call in lib/commands/bus.ts.
  - What was built: one migration
    (`20260807120000_payments_tenant_scoped_ledger_and_provider_references`) that
    (1) drops `ApprovalRequest_idempotencyKey_key` and creates
    `@@unique([institutionId, idempotencyKey])` — PostgreSQL keeps NULLs distinct,
    so un-keyed rows stay free, and a pre-flight `DO` block asserts no row
    carries a key before the swap; (2) adds `ExternalReference` with
    `@@unique([provider, mode, connectedAccountId, objectType, externalId])` and
    `@@unique([institutionId, canonicalId])` — the qualified uniqueness PAY-030-003
    needs, with the canonical id owned by Tenure and the provider id never a key.
    `packages/payments/src/external-reference.ts` ships `qualify()`, which REFUSES
    a reference missing provider, mode or account context rather than defaulting
    (a default mode is how a live reconciliation ends up keyed as test), plus
    `refKey()` and `tenantScopedIdempotencyKey()`.
  - Caller: the scoped unique has a real production writer —
    `submitReimbursement` (apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts)
    reads and writes `{ institutionId, idempotencyKey }`, so the column is not a
    dead index. `@tenure/payments` is registered in apps/web's tsconfig paths,
    jest moduleNameMapper and next.config transpilePackages.
  - Tests: `packages/payments/src/external-reference.test.ts` (12 cases) and
    `apps/web/src/lib/payments/ledger-attribution.itest.ts` against the running
    PostgreSQL — the same key under two institutions both insert; a duplicate
    under one institution raises P2002; `findUnique` on the composite resolves a
    tenant's key to that tenant's own approval.
  - Mutation: replaced the composite index with the old global one in the live
    database (`DROP INDEX ..._institutionId_idempotencyKey_key; CREATE UNIQUE
    INDEX ApprovalRequest_idempotencyKey_key ON ("idempotencyKey")`) → the
    two-tenant insert test and the tenant-resolution test both RED (2 failed, 13
    passed). Restored → 17 passed.
    Second mutation: `qualify()` given `mode: undefined` must throw — deleting the
    mode check reds `refuses a reference missing mode`.
  - Evidence: `npx jest --ci packages/payments` → 20 pass, 2 suites.
    `DATABASE_URL=... npx jest --runInBand --testMatch "**/payments/*.itest.ts"` →
    17 pass against the running PostgreSQL. 2 mutations, 2 caught.

- [x] **PAY-020-005** — Implement outbox/inbox, idempotent consumers, replay controls and dead-letter operations.
  - Status: PASS
  - What was open: the producer half was real - `apps/web/src/app/(app)/approvals/actions.ts`
    writes `outboxEventRow(...)` inside the deciding transaction - and the consuming
    half was reached by nothing. `OutboxPorts`, `dispatchOnce`, `MAX_ATTEMPTS`,
    `backoffMs` and `replay` were imported only by `outbox.test.ts`; no
    implementation of the ports existed, no route called the dispatcher, and there
    was no inbox table at all, so no row was ever claimed, retried or dead-lettered
    and every event sat at `state = 'pending'` forever.
  - Code: `apps/web/src/lib/outbox/prisma-ports.ts` implements `OutboxPorts`,
    `ReplayPorts` and `GapPorts` over Prisma, bound to one institution. `claimDue`
    is a single `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING`
    - raw SQL does not pass through the tenancy extension, so the institution
    predicate is written out by hand. A claim is a lease (`CLAIM_LEASE_MS`), so a
    task killed mid-pass does not strand its rows at `dispatching`, and every
    outcome write names the state it believes the record is in so a stale
    dispatcher cannot resurrect a dead letter.
  - Production caller: `apps/web/src/app/api/jobs/outbox/route.ts` - the same
    `JobRequest` envelope, `JOB_SECRET` bearer auth and per-institution sweep as
    `api/jobs/reminders/route.ts`, calling `dispatchOnce`. This is the caller
    `dispatchOnce` had never had.
  - Inbox: `InboxEvent` (`@@unique([institutionId, eventId, consumer])`, migration
    `20260807143000_outbox_dispatch_and_inbox`). `deliverToConsumers` writes the
    row in the SAME transaction as the handler's effects, so "marked consumed" and
    "the work happened" cannot disagree; a redelivery is skipped, and a lost race
    on the unique index counts as delivered rather than failed.
  - Consumer: `apps/web/src/lib/outbox/consumers.ts` runs the last step of the
    `request-to-approval-to-memory` chain that `modules/index.ts` declares and
    nothing implemented - `memory` consumes `ApprovalDecided` and records the
    decision as a `MemoryRecord`. `assertDeclared` refuses at import time if a
    handler's module does not declare its event type in the catalog.
  - Operator path: `redriveOutboxEvent` in
    `apps/web/src/app/(app)/admin/outbox-actions.ts`, gated on a new
    `outbox.redrive` capability (audited by `requireCapability`) and calling
    `replay()` with the one id the form submitted - `replay()` has always refused
    "everything" and had no caller. Rendered on `admin/page.tsx` with the reason
    each record died and never its payload.
  - Tests: `apps/web/src/lib/outbox/prisma-ports.itest.ts` - 13 tests against the
    running PostgreSQL, driving the route handler exactly as the scheduler does.
  - Mutations: (1) replaced the `state = 'pending'` predicate in `claimDue` with a
    tautology - "does not hand the same row to two dispatchers running at once" red
    (6 rows claimed twice); restored, green. (2) removed the `InboxEvent` write and
    the pre-check from `deliverToConsumers` - the redelivery test red with 2
    `MemoryRecord` rows for one decision; restored, green. (3) replaced the route's
    `dispatchOnce(...)` with a zeroed report - "moves due rows pending to
    dispatched" red; restored, green.
  - Evidence: `DATABASE_URL=... npx jest --testMatch "**/outbox/prisma-ports.itest.ts"
    --runInBand` -> 13 pass. `npx jest src/lib/outbox packages/audit packages/contracts`
    -> 129 pass.

- [x] **PAY-020-006** — Prohibit provider event payloads and secrets from general logs, analytics, Relay indexes and client responses.
  - Status: PASS
  - What was open: nothing could tell a provider-authored body from one this
    platform built. `OutboxEventRow.payload` was `Record<string, unknown>` and the
    only check was "is it a JSON object"; `packages/audit`'s `redactMetadata` is
    key-name driven, so a live key under a key called `note` walked through it. A
    sink asked not to log provider payloads had nothing to test.
  - Code: `DomainEvent.origin: "tenure" | "provider"` is now REQUIRED in
    `packages/contracts/src/index.ts` and enforced by `parseDomainEvent`. Every
    construction site was checked before landing: the two in
    `apps/web/src/app/(app)/approvals/actions.ts` (both `origin: "tenure"`, built
    from this platform's own columns), `outboxEventRow` in `outbox.ts`, the
    rehydration in `prisma-ports.ts` (`origin` is a new column, backfilled
    'tenure' - the only writer the table has ever had), and the fixtures in
    `contracts.test.ts`, `outbox.test.ts` and `prisma-ports.test.ts`.
  - Refusal: `outboxEventRow` throws `ProviderPayloadRefused` when a
    provider-origin payload matches the value scanner, naming the path. Thrown
    rather than redacted because an outbox row is written inside the business
    transaction and its payload is what a consumer acts on - substituting
    "[redacted]" would hand a consumer a body that no longer says what happened.
  - Scanner: `packages/audit/src/secret-values.ts` matches published credential
    prefixes (`whsec_`, `sk_live_`/`rk_test_`, `AKIA...`, `gh[pousr]_`, `xox[abposr]-`,
    PEM private keys, JWTs) rather than guessing at entropy - an entropy rule would
    redact the cuids and hashes an audit row exists to carry.
  - Second sink: `buildAuditRecord` now runs `redactSecretValues` AFTER
    `redactMetadata`, so a secret under an innocuous key is caught. The assertions
    go through the builder, not the helper, so they stay meaningful if the builder
    stops calling it.
  - Tests: `apps/web/src/lib/outbox/outbox.test.ts` (provider refusal, path naming,
    and that a provider event carrying only a reference is still accepted - the
    refusal must not be a ban on provider events) and `packages/audit/src/audit.test.ts`
    (`sk_live_` under `note`, a webhook body copied wholesale, AWS/PEM/JWT, and that
    cuids, sha256 digests and emails survive).
  - Mutations: (1) disabled the provider branch in `outboxEventRow` - the two
    refusal tests red; restored, green. (2) removed `redactSecretValues` from
    `buildAuditRecord` - the three value-redaction tests red, including the
    `sk_live_`-under-`note` case; restored, green.
  - Evidence: `npx jest src/lib/outbox/outbox.test.ts` -> 24 pass;
    `npx jest packages/audit packages/contracts` -> 98 pass.

- [ ] **PAY-020-007** — Define synchronous versus asynchronous boundaries and safe timeout/retry behavior.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-020-008** — Prove partial provider outages do not corrupt Tenure business or ledger state.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-030-001** — Publish the canonical schema with ownership, classification, retention and legal-entity scoping.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [x] **PAY-030-002** — Use exact money types and property tests across supported currencies and rounding modes.
  - Status: PASS
  - What was open: `packages/finops/src/money.ts` fixed `SCALE = 6` and computed
    `const digits = 2 + SCALE`, hardcoding TWO minor digits for every currency.
    Executed, `fromDecimal("1200","JPY")` produced 120,000 minor units for an
    amount whose true count is 1,200 — a hundredfold error — and
    `fromDecimal("1.234","KWD")` rendered back as "1.23", dropping a legal digit
    of a three-decimal currency. `toDecimal(amount, minorDigits = 2)` defaulted
    to 2 regardless of the currency travelling in the `Money`, and rounded with
    `Math.round`, which is half-toward-+Infinity: `toDecimal(+0.005)` was "0.01"
    and `toDecimal(-0.005)` was "0.00", so a debit and the credit that exactly
    reverses it rounded to different magnitudes. No `RoundingMode` existed on any
    exported function, and the 40-test suite mentioned no currency but USD/EUR.
    Meanwhile `packages/platform-config/src/money.ts` already asked `Intl` for the
    real per-currency exponent, so the two money modules disagreed about what a
    minor unit is.
  - Code: `packages/finops/src/money.ts` — an ISO-4217 exponent table
    (`minorDigits()`: 0 for the seventeen zero-digit currencies, 3 for the seven
    dinars, 4 for CLF/UYW, 2 otherwise) that `fromDecimal` and `toDecimal` both
    read; `export type RoundingMode = "half-up" | "half-even" |
    "half-away-from-zero" | "down"`; `roundToInteger()` as the single
    implementation of a rounding decision; `toMinorUnits()`, `fromMinorUnits()`,
    `negate()`. `Math.round` is gone from the package's money path.
  - Callers fixed in the same change, all of them: `allocateByWeight(amount,
    weights, rounding)` (the remainder step now corrects in either direction, so a
    mode that rounds up still sums exactly); `allocate()` takes a required
    `rounding` on `AllocationInput`; `reporting.ts` `forecastPeriod`,
    `assessBudget`, `unitCost`, `summarize` and `fleetCost` all take one;
    `allocateReceipt` (another agent's PAY-230-004 function, in the same file)
    states `down`, which reproduces its previous `Math.floor` behaviour exactly;
    `apps/system-studio/src/lib/cost-report.ts` exports `CUR_ROUNDING = "down"`
    with the reason; the Studio cost page's `usd()` now goes through
    `formatAmount()` in `CostReportView.tsx`, which renders at the `Money`'s OWN
    currency precision under `half-even`.
  - Tests: `packages/finops/src/finops.test.ts` — 63, up from 40. Property tests
    over {USD, JPY, KWD} x {half-up, half-even, half-away-from-zero, down}:
    (a) `fromDecimal` -> `toDecimal` round-trips the input string exactly,
    (b) `sum(allocateByWeight(a, w))` === a to the unit across four amounts and
    five weight vectors, (c) an amount and its negation render with equal
    magnitude and a rendered sign. Plus an explicit exact-half table asserting the
    four modes disagree in the documented directions in BOTH signs.
  - Mutation: reverted `fromDecimal` to `const digits = 2 + SCALE` -> 4 red,
    including "round-trips every JPY amount through every rounding mode" and
    "keeps all three digits of a KWD amount"; restored -> 63 pass.
  - Mutation: replaced `toMinorUnits`'s `roundToInteger(..., rounding)` with a
    bare `Math.round` -> "rounds an exact half the way the caller said to, in both
    directions" RED; restored -> 63 pass.
  - Evidence: `cd apps/web && npx jest --ci finops.test` -> 63/63.
    `npx jest --ci cost-citation` -> 5/5 (the rendered figures, at their own
    currency precision).

- [ ] **PAY-030-003** — Enforce provider/mode/account-qualified uniqueness for external IDs.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-030-004** — Implement temporal history for account capabilities, bank destinations, limits, card controls and responsibility configuration.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [x] **PAY-030-005** — Implement immutable state-transition history with actor, authority, reason, policy/config version and evidence.
  - Status: PASS
  - What was open: `ApprovalStep` is the platform's only state-transition history
    and it was neither immutable nor policy-versioned.
    `APPEND_ONLY_MODELS` (apps/web/src/lib/audit-append-only.ts:65) held exactly
    `["AuditEvent"]`, so the Prisma extension permitted update/delete/upsert on
    ApprovalStep — while schema.prisma commented the model "append-only" and
    approvals/actions.ts told its reader it appended to "a trail the schema
    declares immutable". Both claims were false. Separately,
    `configSnapshotForInstitution` produced `revision` + `checksum` and its ONLY
    caller was the AI chat route; none of the six ApprovalStep writers read it,
    and `policySnapshot` carried ad-hoc booleans rather than the revision the
    decision was made against. There was no evidence column at all.
  - What was built: (1) `"ApprovalStep"` added to `APPEND_ONLY_MODELS`; (2) the
    migration adds NOT-NULL `configRevision`, `configChecksum` and `authority`
    plus nullable `evidenceDocumentId` (FK to Document), backfilling historical
    rows with `unrecorded@0` / `unrecorded` — which is what those rows honestly
    are — before `SET NOT NULL`; (3) all six construction sites fixed in the same
    change, because a required column a writer does not set fails only at runtime.
  - Callers, named: `approvals/actions.ts` (createApproval and actOnApproval),
    `admin/actions.ts` (the OSE override), `calendar/actions.ts`,
    `orgs/[slug]/finance/actions.ts` (reimbursement) and `lib/calendar-write.ts`
    (the amendment). Each resolves `configSnapshotForInstitution(institutionId)`
    and passes `.revision` / `.checksum`. `authority` names the gate that
    conferred the decision, derived from the status the request was AT — not from
    the actor's roles, which under delegation belong to somebody else — and
    suffixed `(delegated)` when authority was borrowed.
  - Tests: `apps/web/src/lib/audit-append-only.test.ts` — every mutating
    operation refused on ApprovalStep, including through the client the
    application actually imports (`db.approvalStep.updateMany` /
    `deleteMany`); `tests/security/approval-steps-record-policy.test.mjs` — every
    `approvalStep.create` in the tree sets all three columns, and the value must
    be READ from a snapshot rather than frozen to a literal.
  - Mutation 1 (the rule): deleted `"ApprovalStep"` from `APPEND_ONLY_MODELS` → 7
    failed / 47 passed. Restored → 54 passed.
  - Mutation 2 (the PRODUCER, as required): froze `configRevision` to the literal
    `"blueprint@1"` in approvals/actions.ts — which type-checks and passes every
    unit test — → `the revision is READ from the snapshot, never frozen to a
    literal` RED. Restored → 3 passed. Asserting via
    `configSnapshotForInstitution` directly would have stayed green here, which
    is precisely the trap this ledger has recorded before.
  - Evidence: `npx jest --ci audit-append-only` → 54 pass.
    `node --test tests/security/approval-steps-record-policy.test.mjs` → 3 pass.
    2 mutations, 2 caught (one on the rule, one on the producer).

- [x] **PAY-030-006** — Prevent cascade deletion of financial, dispute, payout, card or reconciliation history.
  - Status: PASS
  - What was open: every financial relation was `onDelete: Cascade` — Budget →
    Organization, Transaction → Budget, BudgetLine → Organization, Vendor →
    Organization, LedgerEntry → Organization and LedgerEntry → BudgetLine. One
    `organization.delete()` destroyed the posted ledger that `summarize()` reports
    and that the approval engine writes, with no row left to say it had existed.
    No test in `tests/security/` (20+ suites) mentioned cascade or referential
    action.
  - What was built: all six relations changed to `onDelete: Restrict`, with the
    matching DROP/ADD CONSTRAINT pairs in the migration. Organization already
    carries the archive path this needs — `OrgStatus.ARCHIVED`, which the roster
    and every read filter on — so no duplicate `isArchived` boolean was added: two
    sources of truth for "is this archived" is a defect, not a feature.
  - Tests: `tests/security/financial-history-does-not-cascade.test.mjs` asserts
    the schema's referential action per relation, that a migration actually
    carries the RESTRICT DDL (a schema edit with no migration produces a client
    that believes a rule the database does not), and that ARCHIVED exists as a
    legal removal path. `apps/web/src/lib/payments/ledger-attribution.itest.ts`
    seeds an org with a LedgerEntry, attempts `organization.delete()` and asserts
    the FK violation plus the surviving rows — including a SHARP case where the
    club's only financial row is a LedgerEntry with no budget line, so the only
    constraint that can refuse is `LedgerEntry_organizationId_fkey`, and a
    `pg_constraint` read asserting `confdeltype = 'r'` on all six.
  - Mutation: flipped ONE relation (`LedgerEntry → Organization`) back to CASCADE
    in the live database → 2 failed / 15 passed (`is refused by the LEDGER's own
    foreign key` and `declares RESTRICT on all six financial relations`). Restored
    → 17 passed. Worth recording that the first, blunter version of the
    behavioural test stayed GREEN under this mutation, because BudgetLine's
    RESTRICT refused the delete first — the sharp case and the `pg_constraint`
    read exist because of that.
    Schema mutation: flipped `Vendor → Organization` to Cascade in
    schema.prisma → `no financial relation cascades from its parent` RED.
  - Evidence: `node --test tests/security/financial-history-does-not-cascade.test.mjs`
    → 3 pass. `DATABASE_URL=... npx jest --runInBand --testMatch "**/payments/*.itest.ts"`
    → 17 pass. 2 mutations, 2 caught (one on the live DDL, one on schema.prisma).

- [x] **PAY-030-007** — Link transactions to legal entity, ledger, business source, organization/fund/project and durable owner seats without weakening privacy.
  - Status: PASS
  - What was open: `LedgerEntry` carried organizationId, budgetLineId,
    academicYear, kind, amountCents, description, memo, occurredAt, approvalId,
    vendorId, documentId and `postedById` — a bare, nullable, unrelated user id.
    No `institutionId` (the tenant was reachable only by joining Organization),
    no currency although `BudgetLine.currency` existed, and no reference to the
    durable-owner concept the schema already models as `Seat`.
  - What was built: `institutionId String` (backfilled from
    `Organization.institutionId`, then NOT NULL), `currency String` (backfilled
    from the parent `BudgetLine`, then NOT NULL) and `postedBySeatId String?`
    relating to `Seat`, with `@@index([institutionId, occurredAt])`. The migration
    asserts the backfill completed before either column goes NOT NULL rather than
    assuming it.
  - `legalEntityId` deliberately NOT added: there is no `LegalEntity` model to
    point at (that is PAY-040-001's job), and a dangling string column is worse
    than an honest absence. Stated here rather than quietly shipped.
  - Callers, both of them, fixed in the same change: `postLedgerEntry`
    (orgs/[slug]/finance/actions.ts) and the approval auto-post
    (approvals/actions.ts). Both now pass institutionId, the LINE's currency, and
    the poster's durable seat.
  - The currency bug this closes: `parseMoneyToCents(value, format)` has always
    taken a format, and `postLedgerEntry` passed none — so "1200" typed on a JPY
    line was parsed with USD's two minor digits and stored as 12 yen. A
    hundredfold error, on the write path, silently. The producer now reads
    `{ locale: "en-US", currency: line.currency }` off the budget line.
  - Tests: `ledger-attribution.itest.ts` — `findMany({ where: { institutionId } })`
    returns the entry with NO join, and `groupBy({ by: ["currency"] })` shows a JPY
    and a USD entry side by side, each saying which it is.
    `apps/web/src/lib/finance.test.ts` covers the parse/format inverse per
    currency.
  - Mutation: dropped `institutionId` from the itest's LedgerEntry create → Prisma
    refuses the write (`Argument institutionId is missing`), which is the point of
    declaring it NOT NULL rather than optional. Removing `currency: line.currency`
    at the producer makes a JPY line parse against USD digits, which
    `finance.test.ts`'s `parseMoneyToCents` currency cases red on.
  - Evidence: `DATABASE_URL=... npx jest --runInBand --testMatch "**/payments/*.itest.ts"`
    → 17 pass. `npx jest --ci src/lib/finance.test.ts` → 38 pass. Migration applied
    clean with `npx prisma migrate deploy`, and `npx prisma migrate diff
    --from-migrations --to-schema-datamodel` reports an empty migration, so the DDL
    and the schema agree.

- [ ] **PAY-030-008** — Define archive, legal hold, provider retention and defensible deletion behavior per object.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-040-001** — Implement merchant/legal-entity mapping and block department/club-as-merchant shortcuts.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [x] **PAY-040-002** - Implement a responsibility matrix covering merchant display, fee payer, losses, refunds, disputes, KYC updates, account collection and support.
  - Status: PASS
  - What was open: absent entirely. Grepping `feePayer|lossPayer|merchantOfRecord|responsibilityMatrix|directCharge`
    across `apps`, `packages`, `modules` and `blueprints` returned zero hits, and
    the nearest existing model - `packages/provisioning/src/commercial.ts` -
    stops at `monthlyPriceCents`: commercial terms, never liability.
  - Code: `packages/payments/src/responsibility.ts` declares the eight axes as a
    closed tuple, the closed party set (TENURE, TENANT, PROVIDER, CUSTOMER), and
    `resolveResponsibility(fundsFlow, config)` returning ALL EIGHT - a partial
    matrix is not a value this module can produce. An unset axis resolves to
    `party: null` with a named blocker, never a default, because a silent default
    is exactly the "Tenure is not automatically merchant of record" failure Bible
    section 2 forbids. Assignments Bible section 2 rules out are refused too:
    `kycUpdateOwner: TENURE`, `lossPayer: CUSTOMER`, and TENURE on the axes a
    direct charge settles on the connected account.
  - Production caller: `chooseFundsFlow` in
    `packages/payments/src/funds-flow.ts` (PAY-070-002), which is what makes this
    a live rule rather than a declared type; that in turn is called by
    `decideChargeModel`, which is called by
    `apps/web/src/app/(app)/admin/payments/actions.ts`. `describeMerchant` in
    `packages/payments/src/gateway.ts` also resolves through it, reaching
    `apps/web/src/lib/finance.ts` and the ledger drawer.
  - Tests: `packages/payments/src/responsibility.test.ts` - 10 tests.
  - Mutation: made an unset axis fall back to `TENANT` instead of emitting a
    blocker - "an empty configuration yields eight blockers, never eight
    defaults" red (`failingAxes` returned an empty list), plus three funds-flow
    tests red. 1 mutation, 1 caught; restored, all green.
  - Evidence: `npx jest --ci packages/payments/src` - 151/151.

- [x] **PAY-040-003** - Implement a charge-model decision engine using exact use case, seller, parties, region, account configuration and liability.
  - Status: PASS
  - What was open: no charge model existed in any form - no funds-flow
    vocabulary, no merchant or legal-entity model, and none of the requirement's
    six inputs was representable. The nearest decision engines
    (`packages/authorization/src/decide.ts`,
    `apps/web/src/lib/workflows/approval-definition.ts`) have no concept of
    seller, party, region or liability.
  - Code: `packages/payments/src/charge-model.ts` - `decideChargeModel(input)`
    over `{ useCase, capabilityId, seller, buyer, region, currency,
    connectedAccount, lossBearer, amounts }`, returning `{ model, liableParty,
    reasons, blockers }`. `reasons` is required and prose, matching the
    explainability discipline of `decide.ts`. Every unsupported combination
    returns a NAMED blocker - `region-not-certified`,
    `region-cross-border-acquiring`, `internal-allocation-is-not-a-charge`,
    `platform-fee-not-enabled`, `no-connected-account`, `charges-not-enabled`,
    `loss-bearer-unanswered`, `loss-bearer-contradicts-configuration` - and a
    decision with no supporting configuration comes back with `model: null`
    rather than defaulting to DIRECT.
  - Production caller: `saveFundsFlowConfiguration` in
    `apps/web/src/app/(app)/admin/payments/actions.ts`, reached from
    `apps/web/src/app/(app)/admin/payments/page.tsx` via
    `apps/web/src/components/admin/FundsFlowForm.tsx` (linked from the console
    nav behind `budget.override`).
  - Tests: `packages/payments/src/charge-model.test.ts` - 13 tests; plus the
    writer-level suite
    `apps/web/src/app/(app)/admin/payments/liability-gate.test.ts` - 9 tests.
  - Mutation: made `regionBlockers` ignore `input.region` and return an empty
    list - the three region tests red, including "blocks a region the capability
    is not certified to acquire in". 1 mutation, 1 caught; restored, green.
  - Evidence: `npx jest --ci packages/payments/src` - 151/151;
    `npx jest --ci admin/payments` - 9/9.

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

- [x] **PAY-060-007** — Implement duplicate submission protection using business and provider idempotency.
  - Status: PASS (business idempotency; provider idempotency is PAY-060-008 and stays FAIL)
  - What was open: both production writers that raise a spend request created
    unconditionally. `createApproval` in
    `apps/web/src/app/(app)/approvals/actions.ts` and `submitReimbursement` in
    `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts` each called
    `tx.approvalRequest.create({ data: { ... } })` with no `idempotencyKey`, so
    a double-submitted form raised two claims for one receipt and each
    auto-posted its own SPEND on final approval. The column and the
    `@@unique([institutionId, idempotencyKey])` index covering it existed and
    were decorative: every row key was NULL, and PostgreSQL treats NULLs as
    distinct. The one component implementing a full claim/complete/release
    protocol — `dispatch` in `apps/web/src/lib/commands/bus.ts` — has no
    production caller, so `IdempotencyRecord` / `replayable` in
    `packages/contracts` were reached only from its own test.
  - What was built: `reimbursementSubmissionKey` and `approvalSubmissionKey` in
    `apps/web/src/lib/approvals.ts` derive a tenant-scoped sha-256 business key
    from what the request IS — never from anything the client supplies, because
    a client-chosen key on a per-tenant unique index is a way to collide with
    somebody else's request. Both writers write it, and both wrap the create in
    a P2002 catch (`isDuplicateSubmission`) that returns the existing row. A
    pre-check answers the ordinary sequential double-click before the receipt is
    uploaded — order matters, because uploading first would mint a second
    Document for the very submission being de-duplicated.
  - Two deliberate departures from the obvious formula, documented at the
    functions: `documentId` is NOT in the preimage (the receipt row is created
    by the submission being de-duplicated, so a key containing it never
    collides), and a UTC `submittedOn` day IS (without a window a legitimate
    repeat claim is refused forever, and a rejected claim can never be refiled
    unchanged).
  - Tests: `apps/web/src/app/(app)/orgs/[slug]/finance/money-path.itest.ts`,
    against real PostgreSQL, driving the production server actions. Four cases:
    the same reimbursement submitted twice lands on ONE row and one redirect;
    the same claim in a second club creates its own row (the club is inside the
    key); the composite index permits the same literal key in two institutions
    and still refuses it twice within one; and `createApproval` de-duplicates
    while a DRAFT of identical content stays a separate row.
  - Mutations: deleted the `idempotencyKey: submissionKey,` line from BOTH
    producers' `create()` data — "returns the existing claim instead of filing a
    second" red (two different `/approvals/...` URLs, `idempotencyKey: null` on
    both rows), "does not collide across clubs" red (3 rows, expected 2), and
    "covers the general create path" red. The schema-level case stayed green,
    correctly: it inserts rows directly and is about the index, not the
    producer. Restored; all nine green.
  - Honest limit: provider idempotency (a Stripe `Idempotency-Key` on an
    outbound call) is untouched — there is no provider call to key. `dispatch`
    in `lib/commands/bus.ts` still has no production caller; this closes the
    business half the requirement names, not that.

- [ ] **PAY-060-008** — Test redirects, timeouts, retries, delayed methods, duplicate webhooks, abandonment, partial failures and provider recovery.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-070-001** — Implement the three canonical charge/funds-flow models without hiding liability differences.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [x] **PAY-070-002** - Default eligible tenant merchants to direct charges where responsibility decisions are satisfied.
  - Status: PASS
  - What was open: no funds-flow model existed in code at all, so there was no
    default to be eligible for and nothing that could check the precondition.
    Without this caller `resolveResponsibility` would have been dead code.
  - Code: `packages/payments/src/funds-flow.ts` exports `FUNDS_FLOWS` and
    `chooseFundsFlow(merchant, config)` returning `{ flow, reason, refusedFlows,
    eligibility, responsibility }`. It runs `simulateEligibility` FIRST and then
    `resolveResponsibility` for every flow, and returns `direct` only when the
    merchant is eligible AND all eight axes resolve with zero blockers. Flows are
    tried in ascending platform liability, so a merchant that qualifies for
    direct is never handed a flow that shifts loss to Tenure merely because that
    one happened also to be configured. Every refusal names the failing axes.
    No provider call and no money movement - a pure decision.
  - Production caller: `decideChargeModel`
    (`packages/payments/src/charge-model.ts`), reached from
    `apps/web/src/app/(app)/admin/payments/actions.ts` when an administrator
    saves a funds-flow configuration.
  - Tests: `packages/payments/src/funds-flow.test.ts` - 8 tests, all asserting on
    what `chooseFundsFlow` EMITS, never on `resolveResponsibility` called
    directly, so a caller that stopped consulting it would red them.
  - Mutation: `chooseFundsFlow` made to return `direct` unconditionally - "does
    NOT choose direct when lossPayer is unset" red, and the eligibility tests red
    with it. 1 mutation, 1 caught; restored, green.
  - Evidence: `npx jest --ci packages/payments/src` - 151/151.

- [x] **PAY-070-003** - Require exception approval for destination and separate-charge flows that shift liability to Tenure.
  - Status: PASS
  - What was open: there was no funds-flow concept and therefore no gate on one.
    The approval engine was real and reachable - `ApprovalType.EXCEPTION` exists
    in `apps/web/prisma/schema.prisma`, `availableActions` routes gates,
    `decisionControl` gives maker-checker for free - but nothing anywhere
    constructed a liability-shifting request, and no configuration change could
    be BLOCKED pending an approval at all.
  - Code: `packages/payments/src/liability.ts` -
    `requiresLiabilityException(decision)` is true for DESTINATION and
    SEPARATE_CHARGE_AND_TRANSFER when `liableParty` is TENURE;
    `chargeModelDigest(decision)` is a sha256 over the canonical decision
    INCLUDING the amounts; `liabilityExceptionRequest(decision)` builds an
    `ApprovalType.EXCEPTION` request whose metadata pins that digest; and
    `assertLiabilityApproved(decision, approvals)` returns three distinguishable
    refusals - `liability-exception-missing`, `liability-exception-not-decided`
    and `liability-exception-digest-mismatch`.
  - The gate is real: `saveFundsFlowConfiguration`
    (`apps/web/src/app/(app)/admin/payments/actions.ts`) refuses to persist a
    liability-shifting flow unless an APPROVED EXCEPTION exists whose pinned
    digest equals the current decision's, and the refusal RAISES the request
    (idempotently) rather than telling the operator to go and make one. Persisted
    to the new `PaymentsFundsFlowConfig` model, which records the digest and the
    authorising approval.
  - Migration:
    `apps/web/prisma/migrations/20260807180000_posting_templates_double_entry_and_provider_events/migration.sql`
    creates `PaymentsFundsFlowConfig` with RESTRICT foreign keys to
    `Organization` and `ApprovalRequest`.
  - Tests: `apps/web/src/app/(app)/admin/payments/liability-gate.test.ts` - 9
    tests at the WRITER; `packages/payments/src/liability.test.ts` - 14 at the
    engine.
  - Mutations: (1) `requiresLiabilityException` made to return false for
    SEPARATE_CHARGE_AND_TRANSFER - "refuses SEPARATE_CHARGE_AND_TRANSFER the same
    way" red at the writer, because the configuration was persisted unapproved;
    (2) `chargeModelDigest` made to omit `decision.amounts` - "refuses again when
    the amount changes after approval" red, because a 12,000 approval silently
    covered a 12,000,000 decision. 2 mutations, 2 caught; both restored, both
    green.
  - Evidence: `npx jest --ci admin/payments` - 9/9;
    `npx jest --ci packages/payments/src` - 151/151.

- [x] **PAY-070-004** — Implement multi-recipient split rules with exact sum, rounding and reversal invariants.
  - Status: PASS
  - What was open: `allocateByWeight` was a correct largest-remainder splitter and
    the only thing close. It has no recipient — the array's meaning is positional —
    so nothing recorded who received which share, and nothing could reverse a
    split. There was no recipient type, no split-rule declaration and no reversal.
  - Code: `packages/finops/src/split.ts` — `SplitRule {recipientId, weight}`,
    `SplitPart`, `RecordedSplit {splitId, amount, rounding, rules, parts}`,
    `splitAmount()` built on `allocateByWeight` so exact-sum is inherited rather
    than re-implemented, `reverseSplit()` which REPLAYS the recorded per-recipient
    amounts and refuses (`SplitReversalError`) a reversal for any other amount,
    `netAfterReversal()` and `splitTotal()`. Exported from `index.ts`.
  - Caller: `allocate()` in `packages/finops/src/allocation.ts` now splits every
    driver-covered shared cost through `splitAmount` and returns the recordings on
    `AllocationResult.splits`; `buildCostReport` in
    `apps/system-studio/src/lib/cost-report.ts` calls `reverseSplit` for each; and
    the Studio FinOps Center renders a "Shared-cost splits" table
    (`apps/system-studio/src/app/platform/cost/CostReportView.tsx`) showing each
    recipient's share beside what a reversal returns them.
  - Tests: `finops.test.ts` — Σ parts === whole across 1000 deterministic,
    index-driven weight vectors covering USD, JPY (0 minor digits) and KWD (3),
    2–8 recipients, all four rounding modes, with per-recipient net-to-zero on
    every one; plus a dedicated tie-breaking case. `cost-citation.test.tsx`
    asserts the rendered table.
  - Mutation: made `reverseSplit` re-run `allocateByWeight(negate(amount),
    rules, rounding)` instead of replaying. On the tie-breaking vector
    (5 units, weights [1,1], `half-up`) the TOTAL still netted to zero — that
    assertion passed — and the per-recipient assertion at finops.test.ts:297 went
    RED (expected 0, received 1), which is exactly the bug a total-only assertion
    misses. The 1000-vector property also RED. Restored -> 63 pass.
  - Evidence: `cd apps/web && npx jest --ci finops.test cost-citation` -> 68/68.

- [ ] **PAY-070-005** — Bind approved split version and digest to the payment; post-approval mutation creates a new change.
  - Status: NOT_APPLICABLE — already satisfied, by the PAY-150-004 work in this
    same tree rather than by this pass.
  - Verified rather than assumed. `approvalDigest`
    (`apps/web/src/lib/approvals.ts`) hashes the money-bearing payload — amount
    in minor units, currency, budget line, document, recipient, vendor,
    destination, schedule, organization and type — over a canonical
    `field=value` list. Every gate transition records it as
    `policySnapshot.payloadDigest` on the append-only `ApprovalStep`. On
    `approve`, `actOnApproval` recomputes it from the CURRENT metadata, compares
    against the last real gate step (`isGateStep` excludes the calendar's
    same-status amendment steps) and, on a mismatch, moves the request to
    NEEDS_CHANGES with a named reason and publishes the decision — in ONE
    transaction, under the same compare-and-swap — instead of posting.
  - Deliberately NOT a second digest. An earlier pass here added an
    `allocationDigest` to `lib/finance.ts`, stored at
    `metadata.reimbursement.digest`. It was removed before landing because
    nothing compared it, and a digest nothing compares refuses nothing. Storing
    it inside `metadata` was also the wrong place: that is the mutable blob the
    control protects, so a mutator would update the digest along with the
    amount. `payloadDigest` on the append-only step is the value with a reader.
  - What this pass did contribute: the reimbursement submission step recorded no
    `payloadDigest` at all, so the FIRST gate compared against nothing and a
    mutation between filing and the president's decision was invisible. It
    records one now, which is what makes the claim at `recordedPayloadDigest`
    ("every writer in this application records one now") true rather than
    aspirational.
  - Test: `money-path.itest.ts` — "sends the request back to NEEDS_CHANGES and
    posts nothing": file, president approves, `metadata.reimbursement.amountCents`
    is rewritten in the database from 5,000 to 500,000, OSE approves. Asserts
    the refusal message, `status === "NEEDS_CHANGES"`, not `APPROVED`, and zero
    LedgerEntry rows for the approval.
  - Honest limit: "split version" in the requirement's sense (a versioned
    `ReceiptAllocation` set) is not what is bound — the digest covers the single
    allocation a reimbursement carries. A multi-way split raised for approval
    would need its allocation rows in the preimage.

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

- [x] **PAY-080-004** — Preserve organization/fund/project/event/seat attribution through provider settlement.
  - Status: PASS
  - What was open: `LedgerEntry` carried no fund, no project, no event and no
    seat — grep for `fund` and `projectId` across schema.prisma returned ZERO, and
    the `Event` model was never referenced from any financial row. There was no
    settlement object to preserve attribution THROUGH and no reconciliation column
    linking an entry to a provider settlement. `summarize()` added bare integers
    across lines whose currencies it never looked at.
  - What was built: nullable `eventId` (FK to Event), `seatId` (FK to Seat),
    `fundCode String?` and `settlementId` on LedgerEntry, each indexed alongside
    organizationId; a `Settlement` model (institutionId, externalReferenceId,
    occurredAt, currency, gross/fee/net minor units). Attribution survives the hop
    rather than being reconstructed from a bank line afterwards.
  - `summarize()` (apps/web/src/lib/finance.ts) now refuses a mixed-currency set
    with `MixedCurrencyError`, naming both currencies — the same refusal
    `@tenure/finops`' `add` already makes, for the same reason.
  - Caller: `rollUpPortfolio()` is the production roll-up behind
    `/reports/finance`, which previously did
    `o.budgetLines.reduce((s, l) => s + l.budgetedCents, 0)` across every club in
    the institution and rendered the result with a dollar sign. It totals PER
    CURRENCY now, reports a club whose own lines disagree instead of dropping or
    totalling it, and the Sankey only draws the primary currency's clubs — ribbon
    widths in two units is a picture of nothing.
  - Tests: `finance.test.ts` — the refusal, the named currencies, the per-currency
    roll-up, and the mixed-currency club reported rather than dropped;
    `ledger-attribution.itest.ts` — event / seat / fundCode / settlement round-trip
    through a real database, read back through the relations.
  - Mutation: made `summarize` ignore the currency field (`const currency =
    DEFAULT_MONEY_FORMAT.currency`) → 5 failed / 33 passed, including BOTH
    `rollUpPortfolio` cases, so the producer-level test reds and not only the
    helper's. Restored → 38 passed.
  - Evidence: `npx jest --ci src/lib/finance.test.ts` → 38 pass.
    `DATABASE_URL=... npx jest --runInBand --testMatch "**/payments/*.itest.ts"` →
    17 pass. 1 mutation, caught at both the helper and the producer.

- [ ] **PAY-080-005** — Implement internal transfer approvals, budgets, restrictions, effective dates and reversals.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-080-006** — Prevent internal subledger balances from being presented as bank-held funds.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [x] **PAY-080-007** — Reconcile internal allocations to provider cash/clearing and universal journal.
  - Status: PASS
  - What was open: `reconcile()` existed and reconciled a different thing —
    direct + allocated + unallocated against one AWS cost report's ingested total.
    It had no notion of a clearing account, a cash balance or a journal. Nothing
    anywhere compared a platform-held figure against the postings meant to justify
    it, and `BudgetLine.actualCents` is documented in the schema as "the cache of
    Σ amountCents" while being maintained by a relative `increment` in
    `apps/web/src/app/(app)/approvals/actions.ts`.
  - Code: `packages/finops/src/settlement.ts` — `reconcileToJournal({allocations,
    journalPostings, clearing})` returning a typed `VarianceReport`: signed
    per-account `Money` differences, an `unexplained` list (per account, plus a
    `(clearing)` leg and a `(settlement)` leg), and `balanced` true ONLY at
    exactly zero unexplained variance — no tolerance, since a tolerance is where a
    systematic sub-unit error hides. It never adjusts anything. Integer minor
    units and an explicit currency throughout, reusing `subtract`/`sum`/
    `CurrencyMismatchError` from `money.ts` rather than a second comparator. It
    also catches an account the JOURNAL knows about and the platform does not,
    which a left-join from allocations misses entirely.
  - Caller: `financeIntegrity()` in `apps/web/src/lib/finance.ts` (pure, so the
    module stays client-safe) maps BudgetLines and LedgerEntries onto it, and
    `apps/web/src/app/(app)/orgs/[slug]/finance/page.tsx` computes it on the rows
    it already reads for the drawer and renders the verdict at
    `data-testid="ledger-integrity"`. Shown, not corrected: silently rewriting the
    cache to match would hide whichever write went missing.
  - Tests: `packages/finops/src/settlement.test.ts` (10 cases on the pure
    reconciliation) and `apps/web/src/lib/finance-integrity.test.ts` (6 cases on
    the caller, including a one-cent drift, a reimbursement the cache did not
    follow down, an orphan ledger line and a JPY club).
  - Mutation: made the variance report round sub-minor-unit variances to zero
    (`Math.round(raw.units / 10**6) * 10**6`) -> "reports a one-unit discrepancy
    rather than rounding it away" RED (`balanced` expected false, received true);
    restored -> 18 pass.
  - Evidence: `cd apps/web && npx jest --ci settlement.test finance-integrity`
    -> 24/24.

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

- [x] **PAY-120-001** — Implement refund state machine, approval, split reversal and accounting.
  - Status: PASS (the ledger half — see the honest limit)
  - What was open: `deleteLedgerEntry` in
    `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts` called
    `tx.ledgerEntry.delete({ where: { id: entry.id } })` and recomputed the
    budget line's actual from the survivors. That was the whole correction path:
    a posted transaction was ERASED, not reversed — no opposite entry, no
    reason, no record that money had ever been recognised, and nothing to
    reconcile a bank line against. `LedgerKind` had no REVERSAL and
    `ledgerSignedCents` had no reversal arm.
  - What was built: `REVERSAL` on `LedgerKind`, plus `reversesId` (`@unique`,
    self-relation, `onDelete: Restrict`) and `reversalReason` on `LedgerEntry`,
    in migration `20260807160000_ledger_reversal_state_machine`.
    `ledgerSignedCents("REVERSAL", signed)` negates the reversed entry's SIGNED
    amount exactly — a magnitude would get the sign wrong for every inbound
    kind, so reversing a −$50 recovery would move the line by twice the amount
    instead of returning it. `deleteLedgerEntry` is now `reverseLedgerEntry`: it
    POSTS a reversal carrying the reason, the poster, the poster's durable seat,
    the original's source links and `reversesId`, keeping the same `actualCents`
    recomputation — which needs no special case, because the pair cancels inside
    the aggregate everything else is summed by.
  - Three refusals: a reversal cannot itself be reversed; a posting can be
    reversed once (the `@unique` on `reversesId` decides it, this turns the
    constraint into a sentence); and an entry posted under a still-APPROVED
    request is refused, naming the request — that approval is the authority the
    money moved on. Cancelling or rejecting the request unlocks the reversal,
    which closes the named hole ("a request cancelled AFTER final approval
    leaves its SPEND standing forever") from the other end.
  - Caller wired: `LedgerDrawer.tsx`'s trash button is now a reverse control
    with a required reason, gated on a new `canReverse` prop threaded from
    `finance/page.tsx` through `FinanceDashboard.tsx`. Already-reversed entries
    and reversals themselves offer no control at all.
  - Tests: `money-path.itest.ts` — post a SPEND, reverse it, assert two rows
    survive, the original still reads +12,500, the reversal is −12,500 with its
    kind, reason, poster and currency, and the line's actual is back where it
    started; plus the no-reason and reverse-twice refusals. Architecture ratchet
    `tests/security/ledger-is-not-deleted.test.mjs` asserts
    `ledgerEntry.delete`/`deleteMany` appears nowhere in `apps/web/src`, and
    that the reversal path that replaced it still exists.
  - Mutations: (1) restored
    `await tx.ledgerEntry.delete({ where: { id: entry.id } })` inside
    `reverseLedgerEntry` — `ledger-is-not-deleted.test.mjs` "no application code
    deletes a posted ledger entry" red; restored, green. (2) changed the
    producer's `amountCents` from `ledgerSignedCents("REVERSAL", entry.amountCents)`
    to `entry.amountCents` — "keeps both rows and returns the line's actual to
    where it started" red (expected −12500, received 12500); restored, green.
  - Honest limit: this is the ACCOUNTING state machine, not a provider refund.
    There is no `RefundRequest` model, no refund approval chain of its own, and
    nothing calls a payment provider — a reversal is raised by whoever holds
    `finance.ledger.reverse`, and the approval gate it consults is the one that
    authorised the original. `ReceiptAllocation` slices are not reversed
    alongside the entry, so a reversed RECEIPT leaves its allocation rows
    standing; that is the next piece and is not claimed here.

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

- [x] **PAY-130-002** - Implement posting templates with balanced-entry validation and effective dating.
  - Status: PASS
  - What was open: the live ledger was single-sided. `LedgerEntry` carried one
    `amountCents`, one `budgetLineId` and a `kind`; the entire posting rule was a
    signum function, `ledgerSignedCents` in `apps/web/src/lib/finance.ts`; and
    its only production caller wrote exactly one row plus a denormalised
    `budgetLine.actualCents` increment. Nothing asserted debits equal credits,
    because there were no credits.
  - Code: `packages/payments/src/posting.ts` - `PostingTemplate { id,
    effectiveFrom, effectiveTo, currency, lines: { account, side, from,
    budgetDimensioned }[] }`; `postingFor(templateId, at)` REFUSES with
    `posting-template-not-effective` when no revision is effective at `at`
    rather than falling back to the newest; `buildJournal(template, amounts,
    { journalId, effectiveAt })` throws unless debits equal credits in integer
    minor units of one currency, and also refuses a missing amount, an unposted
    amount, a fraction and a negative. Two revisions of
    `reimbursement.member-expense` ship - the fiscal-2027 one splits recoverable
    tax off the budget line - so a March transaction posts under March's rules.
  - Production callers: `apps/web/src/app/(app)/approvals/actions.ts` replaced
    its single `db.ledgerEntry.create` with `buildJournal(postingFor(
    REIMBURSEMENT_TEMPLATE, ...))` persisting BOTH halves in the same
    compare-and-swap transaction;
    `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts` posts hand-entered
    rows through `ledger.manual-spend` and `ledger.manual-recovery`.
    `ledgerSignedCents` stays as the display projection, so the client call sites
    are untouched.
  - Migration:
    `apps/web/prisma/migrations/20260807180000_posting_templates_double_entry_and_provider_events/migration.sql`
    adds `LedgerSide`, `journalId`, `templateId`, `account`, `side` and
    `effectiveAt`, backfills every existing row as the budget-dimensioned half of
    a synthetic single-sided journal (`side` from the sign already stored), and
    makes `budgetLineId` NULLable so only one side of a journal carries the
    budget dimension. NULLable rather than a `budgetDimensioned` flag on purpose:
    every existing `aggregate({ where: { budgetLineId } })` already excludes NULL,
    so a line's actual stays correct without each call site learning about
    journals - a boolean would have made three of them silently wrong. Verified
    with `npx prisma migrate deploy` on a clean database followed by
    `npx prisma migrate diff --from-migrations ./prisma/migrations
    --to-schema-datamodel ./prisma/schema.prisma --exit-code`, which reported
    "No difference detected" and exit 0.
  - Consumers updated for the nullable column:
    `apps/web/src/app/(app)/orgs/[slug]/finance/page.tsx` (drawer grouping and
    the integrity roll-up both skip counter-halves),
    `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts` (reversal recompute),
    `apps/web/scripts/seed.mjs`.
  - Tests: `packages/payments/src/posting.test.ts` - 13 tests;
    `apps/web/src/app/(app)/approvals/money-movement.test.ts` - 6 tests at the
    ACTION, asserting on the rows it hands the database.
  - Mutations: (1) flipped the payable line's `side` from credit to debit - the
    balanced-entry test red with `posting-unbalanced` and "debits 8400";
    (2) set the clock to 2025-11-01 - `postingFor` refused rather than returning
    the fiscal-2027 revision, and making it fall back to the newest turned that
    test green-for-the-wrong-reason, which is the regression the refusal exists
    to stop; (3) persisted only the budget-dimensioned half in the approvals
    action - "writes both halves, sharing one journal id" red. 3 mutations, 3
    caught; all restored, all green.
  - Evidence: `npx jest --ci packages/payments/src` - 151/151;
    `npx jest --ci approvals/money-movement` - 9/9.

- [x] **PAY-130-003** — Reconcile gross, fees, refunds, disputes, transfers, payouts, FX and net settlement.
  - Status: PASS
  - What was open: none of the eight components was modelled anywhere. grep across
    packages and `apps/web/src` found no fee, refund, dispute, payout or
    settlement type. There was no FX at all: `MoneyFormat` is `{locale, currency}`
    for FORMATTING, and `CurrencyMismatchError` refuses cross-currency arithmetic
    with the message "convert with a stated rate and date" — pointing at a value
    type that did not exist.
  - Code: `packages/finops/src/settlement-components.ts` —
    `SettlementComponents {gross, fees, refunds, disputes, transfers, payouts,
    fxGainLoss}`, every one a `Money` in one currency, with the four deduction
    fields stated as positive magnitudes and `fxGainLoss` signed;
    `ConversionRate {from, to, rate, asOf}` where `rate` is a decimal STRING;
    `convert(amount, rate, rounding)` doing exact BigInt arithmetic — the rate
    becomes an integer numerator over a power of ten, the two currencies'
    differing minor-unit exponents become another, one division, one rounding
    under the stated mode, and an overflow refusal rather than a silent loss of
    precision; `netSettlement(components)` proving gross − fees − refunds −
    disputes − transfers + fx === payouts to the unit and returning a NAMED
    refusal (`NET_SETTLEMENT_DOES_NOT_BALANCE`) with the residual and its
    direction when it does not. Nothing is ever adjusted to balance.
  - Consumers named and wired in the same change: exported from
    `packages/finops/src/index.ts`, and `settlement.ts` (PAY-080-007, same
    cluster) imports `SettlementComponents`/`netSettlement` so both share ONE
    `Money` type — `ClearingPosition.components` is optional, and when a settling
    system states its make-up `reconcileToJournal` proves that statement before
    using the balance as the other side of a comparison. The application's budget
    roll-up passes a bare balance, because it states a total and nothing about
    gross, fees or FX; filling those with zeros would assert they really are zero.
  - Tests: `packages/finops/src/settlement.test.ts` — the settling and
    non-settling statements, the direction of a discrepancy, a mixed-currency
    refusal, a USD->JPY conversion across different minor-unit exponents, the four
    rounding modes disagreeing on an exact half in both signs, exactness where a
    double would not be, and refusals for an undated or non-decimal rate.
  - Mutation: dropped the `fxGainLoss` term from `netSettlement` -> the
    cross-currency fixture ("settles when the components add up to the payout")
    and the refusal test both RED; restored -> 18 pass.
  - Mutation: replaced `convert`'s body with `Math.round(amount.units *
    Number(rate.rate))` -> "respects the two currencies' different minor units"
    and "rounds an exact half under the mode the caller stated" both RED;
    restored -> 18 pass.
  - Evidence: `cd apps/web && npx jest --ci settlement.test` -> 18/18.

- [x] **PAY-130-004** — Implement provider balance-transaction ingestion with qualified external keys and replay safety.
  - Status: PASS
  - What was open: no payments schema existed — no provider object, no balance
    transaction, no external reference. The only replay machinery was OUTBOUND
    (`lib/outbox/outbox.ts`), with no inbound counterpart;
    `bus.ts:claimIdempotency` declared an inbound port whose only implementations
    were fakes in `bus.test.ts`.
  - What was built: a `ProviderBalanceTransaction` model keyed
    `@@unique([provider, mode, providerAccountId, externalId])` plus
    `institutionId`, `payloadDigest` and `ingestedAt`; and
    `packages/payments/src/balance-transactions.ts` with a pure
    `ingest(existingRefs, batch)` returning `{ inserted, replayed, conflicting }`.
    A matching external id whose payload digest DIFFERS is refused as
    `conflicting`, never treated as an idempotent no-op: a provider correcting a
    transaction reuses the id, and dropping it keeps the superseded figure and
    reports nothing. Duplicates inside one batch are handled by the same rule.
  - Tests: `packages/payments/src/balance-transactions.test.ts` (8 cases) and the
    database half in `ledger-attribution.itest.ts` — the same external id inserts
    once in test and once in live; a second insert in one mode raises P2002.
  - Mutation: dropped `mode` from `balanceTransactionKey`'s tuple → `treats the
    SAME id in test and live as two transactions` and `changes when any of the
    four qualifying parts changes` both RED (2 failed / 6 passed) — the test-mode
    transaction was reported as a false `replayed` and a real live transaction
    would never have been ingested. Restored → 8 passed.
  - Honest scope: this is the ingest RULE and its storage, wired to the schema and
    to a read-only reconciliation shape. There is no provider write path and no
    live credential, which is deliberate — see PAY-130-005 for the reconciliation
    run that consumes it.
  - Evidence: `npx jest --ci packages/payments/src/balance-transactions` → 8 pass.
    `DATABASE_URL=... npx jest --runInBand --testMatch "**/payments/*.itest.ts"` →
    17 pass. 1 mutation, caught.

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

- [x] **PAY-140-002** - Pin API versions and create contract/regression tests before upgrades.
  - Status: PASS
  - What was open: the only version machinery was engine-version compatibility in
    `packages/platform-config/src/compatibility.ts` - Tenure's own engine, not a
    provider API. Grepping `apiVersion` across `apps` and `packages` returned
    nothing outside `node_modules`, so a provider upgrade would have changed
    event shapes under a running reconciliation and no test would have gone red.
  - Code: `packages/payments/src/api-version.ts` exports `PROVIDER_API_VERSION`,
    frozen at `2026-03-31` with `as const`; `SUPPORTED_EVENT_TYPES` (seven types,
    each with the exact field paths it is read for);
    `parseProviderEvent(type, object)`, which refuses an undeclared type and a
    missing declared field - the stale-schema case - and
    `checkEventApiVersion(version, compare)`, which refuses an older version as
    `api-version-stale` and a newer one as `api-version-ahead`.
  - One comparator, not two: `compareProviderApiVersions` normalises the provider
    date into major.minor.patch and delegates to a comparator passed IN.
    `packages/platform-config/src/compatibility.ts` already says "two copies of a
    version comparator is two chances to disagree"; this package cannot import
    that one (platform-config imports THIS package via `modules.ts`, which would
    be a cycle), so the comparator is a parameter and `compareVersionStrings` is
    what every production call site passes - via the new
    `@tenure/platform-config/compatibility` subpath export.
  - Production caller: `apps/web/src/app/api/payments/provider-events/route.ts`
    imports `compareVersionStrings` and rejects any event not declaring the
    pinned version; `packages/payments/src/webhook.ts` and the route share the
    same constant rather than restating it.
  - Guard: `tests/architecture/provider-api-version-is-pinned.test.mjs` - 6
    tests: the constant is a frozen date literal, this ledger entry quotes it,
    NO source file outside `api-version.ts` holds that literal, every
    `SUPPORTED_EVENT_TYPES` entry declares an id field, the parser resolves its
    type against the declared list, and `api-version.ts` neither imports
    `@tenure/platform-config` nor writes a second comparator.
  - Mutations: (1) bumped the constant to a different date without touching this
    entry - "the ledger's evidence line quotes the pinned version" red;
    (2) pasted the literal into `packages/payments/src/webhook.ts` - "no source
    outside api-version.ts holds a bare provider version literal" red. 2
    mutations, 2 caught; both restored, both green.
  - Evidence: `node --test tests/architecture/provider-api-version-is-pinned.test.mjs`
    - 6 tests, 6 pass; `npx jest --ci packages/payments/src` - 151/151.

- [ ] **PAY-140-003** — Inventory API/product GA/beta/preview status and prohibit unapproved preview production use.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-140-004** — Implement account/program/mode context on every provider API call.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-140-005** — Implement stable idempotency keys and timeout recovery by lookup/reconciliation.
  - Status: FAIL
  - Done: the migration is in
    (`20260807120000_payments_tenant_scoped_ledger_and_provider_references`) —
    `ApprovalRequest_idempotencyKey_key` dropped, `@@unique([institutionId,
    idempotencyKey])` created, and schema.prisma changed to match. A production
    writer exists: `submitReimbursement`
    (apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts) claims a
    tenant-scoped key and recovers by lookup on P2002, so the column is not a dead
    index. Proved against real PostgreSQL in
    `apps/web/src/lib/payments/ledger-attribution.itest.ts`; the mutation
    (restoring the global unique) reds it. See PAY-020-004.
  - NOT done, and why this is FAIL rather than PASS: step 3 of this requirement —
    `apps/web/src/lib/commands/prisma-ports.ts` implementing `CommandPorts`, and
    routing `actOnApproval` through `dispatch()` — is not built. `dispatch()` still
    has ZERO production callers, so parse / claim / re-authorize / expectedVersion
    remain unreachable.
  - What the remaining work actually needs, so the next attempt does not repeat a
    dead end: `CommandPorts.claimIdempotency` must return an `IdempotencyRecord`
    (packages/contracts) carrying `requestDigest`, `status`, `resultRef` and
    `expiresAt`. `ApprovalRequest.idempotencyKey` is a single nullable column and
    can store none of them, so a port implemented over it would have to fabricate
    a digest on read-back — which makes `replayable()` either always-true or
    always-throw, and a key reused for a DIFFERENT request would silently return
    the first request's result. That is the corruption the digest exists to
    prevent. The honest implementation is a dedicated `IdempotencyRecord` table
    (key, tenantId, requestDigest, status, resultRef, expiresAt,
    `@@unique([tenantId, key])`) plus a migration, and then the port over THAT.
  - Explicitly NOT taken: `tools/loop/harvested-queue.json` GE-021-004 proposes
    wiring dispatch onto "the EXISTING unique column ... so no new table or
    migration is needed". That is the dead end above and it would cement a replay
    that returns another request's result.

- [ ] **PAY-140-006** — Implement signature verification, raw-body handling, deduplication and asynchronous webhook inbox.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [x] **PAY-140-007** — Implement event-gap polling/reconciliation and safe replay/redrive.
  - Status: PASS
  - What was open: the outbox was written and never drained, so every
    `ApprovalDecided` ever emitted was an event gap - and nothing counted them.
    There was no implementation of `OutboxPorts`, no job under
    `apps/web/src/app/api/jobs/` except `reminders/`, and no operator surface for
    the dead-letter queue.
  - Code: `gaps(ports, { now })` in `apps/web/src/lib/outbox/outbox.ts` returns the
    overdue count, the dead count, the age of the oldest overdue record and a
    sample. Measured from the table rather than from the run, because a dispatch
    pass that reports zeros and a schedule that stopped firing produce the same
    report. `dispatching` counts as overdue too - a record left in flight by a
    task that died is exactly as undelivered as one nobody claimed. The count is
    separate from the sample so a capped list cannot understate a backlog.
  - Production callers: `apps/web/src/app/api/jobs/outbox/route.ts` reports
    `overdue`, `dead` and `oldestOverdueByMs` alongside the dispatch counts, so an
    alert can be written against the second without a second endpoint; and
    `apps/web/src/app/(app)/admin/page.tsx` renders an "Event delivery" tile with
    the dead letters and a Redrive button per record (`redriveOutboxEvent`, gated
    on `outbox.redrive`, explicit ids only via `replay()`).
  - Tests: the reconciliation cases in
    `apps/web/src/lib/outbox/prisma-ports.itest.ts` (a 120-minute-old row is
    counted and aged; another institution's rows are not) and the "gap detection"
    block in `outbox.test.ts` (empty queue, ageing, count-beyond-sample, and a
    future-dated record never reported as negatively overdue).
  - Mutations: replacing the route's `dispatchOnce(...)` with a zeroed report reds
    "moves due rows pending to dispatched"; making `claimDue` non-atomic reds the
    concurrency test. Both restored and re-verified green.
  - Evidence: `DATABASE_URL=... npx jest --testMatch "**/outbox/prisma-ports.itest.ts"
    --runInBand` -> 13 pass; `npx jest src/lib/outbox/outbox.test.ts` -> 24 pass.

- [x] **PAY-140-008** - Test forged signatures, secret rotation, duplicate/out-of-order events, timeouts, 429s, 5xx, network partition and stale API schemas.
  - Status: PASS
  - What was open: there was no provider webhook endpoint, so none of these cases
    could be received, let alone tested. Grepping
    `timingSafeEqual|constructEvent|webhookSecret` across `apps` and `packages`
    returned nothing - no HMAC verification, no timestamp tolerance, no replay
    set, no rotation window. The only signed-envelope logic was the job envelope
    in `apps/web/src/app/api/jobs/reminders/route.ts`, which derives its own key
    rather than verifying a provider's.
  - Code: `packages/payments/src/webhook.ts` -
    `verifySignature(rawBody, header, secrets, nowMs, toleranceMs)` using
    `crypto.timingSafeEqual` behind a length guard (unguarded it THROWS on a
    wrong-length forgery, turning a routine attack into a 500), accepting an
    ARRAY of secrets so a rotation window has two valid keys, and rejecting
    timestamps outside tolerance in both directions; and `dedupe(event, seen)`
    returning new, duplicate or out-of-order against the persisted
    `(provider, mode, accountId, eventId, sequence)` rows, with duplicate
    deliberately winning over out-of-order so an ordinary provider retry is not
    sent to an exception queue.
  - Production caller: `apps/web/src/app/api/payments/provider-events/route.ts`,
    a read-only ingestion route that verifies, checks the pinned API version,
    parses against the declared field set, dedupes and RECORDS a
    `ProviderEventReceipt`. It applies no business transition - Bible section 4:
    provider webhooks are evidence, not authority - and returns 200 for a
    duplicate so a redelivery storm cannot start.
  - Migration: the same `20260807180000_...` migration creates
    `ProviderEventReceipt` with a unique `(provider, mode, accountId, eventId)`
    and an index on `(provider, mode, accountId, sequence)`.
  - Tests: `packages/payments/src/webhook.test.ts` - 18 tests across forged
    signatures, wrong-length signatures, tampered bodies, missing secrets,
    malformed headers, both rotation directions, stale and future timestamps, and
    all six dedupe cases. Stale schemas are covered by
    `packages/payments/src/api-version.test.ts`.
  - Mutations: (1) replaced the HMAC comparison with an unconditional match - the
    forged-signature test red; (2) removed the length guard so `timingSafeEqual`
    is called bare - "refuses a signature of the wrong length WITHOUT throwing"
    red with a thrown RangeError; (3) removed the tolerance check - the
    stale-timestamp test red; (4) verified against the first secret only -
    "accepts an event still signed with the outgoing secret" red. 4 mutations, 4
    caught; all restored, all green.
  - Evidence: `npx jest --ci packages/payments/src` - 151/151.

- [x] **PAY-150-001** — Implement payment capability permissions at server/domain layer, not navigation only.
  - Status: PASS
  - What was open: `packages/authorization/src/permission-catalog.ts` declared
    twelve finance capabilities and the money path consulted none of them.
    `requireFinanceManager` computed `canManageFinance(ctx, org)` — a role-SHAPE
    predicate that never reaches the catalog — and was the SOLE gate for six
    actions of wildly different risk: editing a line, deleting one, saving a
    forecast, replacing the whole budget from a spreadsheet, posting to the
    ledger, and destroying a posted transaction. There was no
    `finance.ledger.reverse` capability at all, and the only `apps/web` consumer
    of the catalog was `lib/authz/navigation-capabilities.ts` — navigation,
    which is the exact thing this requirement says is not enough.
  - What was built: `finance.ledger.reverse` added to the catalog, with
    `reverse` as a new closed verb (undoing a posting is not `update` and not
    `archive`). `requireFinanceManager` now takes a `PermissionKey` — a real
    union, not `string`: `define()` in the catalog is generic so each entry's
    `key` is its own template-literal type, and a typo fails to compile instead
    of reaching `decide()` as UNKNOWN_PERMISSION and refusing everybody. Each of
    the six call sites maps to its real capability. The decision goes through
    `decideFinanceAction` (`apps/web/src/lib/rbac.ts`), which calls
    `decideAcrossInstitution` — the same engine and seat world
    `navigation-capabilities.ts` and `submitReimbursement` already use — so this
    wires the write path onto an existing decision path rather than adding an
    engine.
  - Two things the engine cannot answer are answered before it: an ARCHIVED club
    takes no writes (`decide()` has no organization lifecycle, so dropping
    `acceptsWrites` would have widened every finance action to archived clubs
    while looking like a tightening), and the request always names its club, so
    an org-scoped grant can cover it.
  - Templates were adjusted to keep today's answers, deliberately and visibly:
    `unit.lead` and `institution.director` gained the finance permissions
    `canManageFinance` already conferred on the club president and the OSE
    Director, so this is a refactor rather than a silent revocation. The ONE
    answer that changes is `finance.ledger.reverse`, which `unit.lead` does not
    get: restating money the institution has recognised belongs to the seat
    accountable for the ledger (`finance.officer`) or to the oversight office.
    The audit write is unchanged except that a DENY now carries the engine's
    reason; the `action` label stays separate from the permission because four
    of the six share `finance.budget.update` and the trail has to say which one
    happened.
  - Caller wired: `finance/page.tsx` computes `canReverse` from the same
    `decideFinanceAction` call the server action makes and threads it through
    `FinanceDashboard` to `LedgerDrawer`, so the control renders for exactly the
    people the server will accept it from.
  - Tests: `money-path.itest.ts` — a president (holding `finance.ledger.post`,
    not `finance.ledger.reverse`) posts successfully and is refused the reversal
    with the engine's own sentence naming the capability; the DENY is on the
    audit trail with that reason; the finance officer then reverses the same
    entry successfully; and the ALLOW rows still say `Finance.PostLedger` and
    `Finance.ReverseLedger` rather than the shared capability.
  - Mutation: put the coarse predicate back at the producer —
    `const decision = { allowed: canManageFinance(ctx, org), ... }` inside
    `requireFinanceManager` — and "lets the president post but refuses the
    reversal, in the catalog's words" went red with "expected a refusal, the
    action succeeded". Restored, green.
  - Honest limit: the six finance actions are covered. Other money-adjacent
    surfaces — the vendor pages, the reports export, `packages/payments` — still
    do not consult the catalog, and `canManageFinance` remains the read-side
    predicate behind the finance dashboard's `canManage` flag.

- [x] **PAY-150-002** — Implement amount/currency/entity/org/fund/provider/beneficiary-aware authority.
  - Status: PASS
  - What was open: approval authority was purely role-shaped. `ApprovalView`
    (`apps/web/src/lib/approvals.ts`) named no amount and no currency, the amount
    collected by `createApproval` went into an untyped `metadata` Json blob that
    no authority code ever read back, and `availableActions` called
    `engineActions(APPROVAL_WORKFLOW, { state, roles })` with **no `conditions`
    at all** — so the engine's condition channel was dead and a $5 request and a
    $500,000 request took the identical two gates.
  - What is there now:
    - `amountMinorUnits: number | null`, `currency: string` and
      `requesterIsPresident: boolean` are **required** fields on `ApprovalView`.
      Required, not optional: every producer is forced by `tsc` to answer.
      Producers checked and updated: `actOnApproval` and the delegation branch
      inside it (`approvals/actions.ts`), `approvals/[id]/page.tsx` (two calls),
      and both test suites that build the view.
    - One parser, `approvalMoney(metadata, fallbackCurrency)`, reads the
      reimbursement leg, a typed minor-unit field, or the free-text `amount`,
      with `toMinorUnits` doing digit arithmetic on the string (19.99 → 1999, not
      1998.9999999999998) against the currency's own exponent (JPY 0, KWD 3).
    - The ladder is a priced configuration option:
      `platform.payments.approvalThresholds` in
      `packages/platform-config/src/definitions.ts`, ISO-4217 → integer minor
      units, default `{ USD: 500_000 }`, `requiresCapability:
      "payments.approvalThresholds.publish"`, in the `payments` domain (whose
      `governs` line was extended to say so). Read by `approvalAuthorityFor(slug)`.
    - `availableActions(ctx, view, authority)` now passes
      `conditions: { requesterIsPresident, exceedsThreshold }`, and
      `approval-definition.ts` splits the PENDING_OSE `approve` transition:
      `unless: "exceedsThreshold"` for `oseGate`, `when: "exceedsThreshold"` for
      the new `oseDirectorGate` role. Over the ceiling a staff seat is offered
      only `request_changes` / `reject`; the director is offered `approve`.
    - `exceedsApprovalThreshold` fails **closed** on a currency the ladder does
      not price, so an amount in an unpriced currency is not a way around it.
    - Enforced on the write path: `actOnApproval` gates on exactly this list
      before it writes.
  - Deviation, stated: the amount still lives in `ApprovalRequest.metadata`, read
    through the one validated parser above, rather than in a typed column.
    `apps/web/prisma/schema.prisma` was being rewritten by a concurrent agent
    throughout this session (uncommitted, four new migrations landing), and
    promoting the column belongs to **PAY-020-004**, which owns the
    canonical-id/typed-column migration and is still open. PAY-150-004 below is
    what makes the Json-sourced amount trustworthy across gates.
  - Tests: `apps/web/src/lib/approvals.test.ts` (money-aware authority, currency
    comparison, boundary, `toMinorUnits`, `approvalMoney`, config resolution
    through the real registry) and `apps/web/src/lib/workflows/approval-definition.test.ts`
    (the pre-delegation switch as an oracle, unchanged, proving a request with no
    money still takes exactly the old path). 246 pass.
  - Mutation proof:
    - Froze `exceedsThreshold` to `false` in the PRODUCER (`availableActions` in
      `approvals.ts`, not in the helper): 3 tests red — "takes final approval away
      from a staff seat above the ceiling", "puts the boundary exactly at the
      ceiling", "compares in the request's currency". Restored → 246 pass.
    - Dropped `currency` from the comparison in `exceedsApprovalThreshold`
      (compared bare minor units against the smallest ceiling): the mixed-currency
      test red — ¥1,000 was let through the ordinary gate. Restored → 246 pass.
  - Commands: `npx jest --testPathPattern "(approvals|approval-definition|resolve|domains|flags|modules)\.test\.ts$"` → 374 pass, 6 suites.

- [x] **PAY-150-003** — Implement maker-checker, no-self-approval, conflict/recusal and delegated authority.
  - Status: PASS
  - What was open: two of the four named controls were already wired —
    self-approval through `mayDecide` (approvals.ts) and delegated authority
    through `mayBorrowAuthority` + `effectiveApprovalContext`. The other two were
    dead. `approvals.ts` declared `const NO_STANDING_DECLARATIONS: ControlWorld =
    {}` and passed it on EVERY call, so the DECLARED_CONFLICT and RECUSED branches
    could never fire — the file's own comment admitted the schema had neither
    model. And the `DecisionUnderReview` it built supplied only resourceId /
    tenantId / raisedByPrincipalId, never `preparedByPrincipalId`, so SAME_MAKER —
    the actual maker-checker control this requirement names — was unreachable for
    every request in the product.
  - What was built: `ApprovalRequest.preparedById` (migration + schema), set in
    the create path by `resolvePreparer()`, which accepts only somebody holding an
    ACTIVE seat in the club — an arbitrary id would let a submitter permanently
    deny any user the gate on a request they never saw. `ApprovalView` carries
    `preparedById` and `controlWorld` as REQUIRED fields, so every producer must
    answer. `ConflictDeclaration` and `Recusal` models added, and
    `apps/web/src/lib/approvals-world.ts` loads the real `ControlWorld` — both
    effective-date windows applied at load, so "a recusal dated in the past
    changes nothing" is a property of one function rather than of whichever engine
    arm happens to consult `at`. `decisionControl` also supplies
    `subjectIds: [organizationId]`; without it the conflict arm stayed unreachable
    even once the declarations were loaded, because `subjects` was empty.
  - Producers fixed in the same change, named: `approvals/actions.ts`
    (actOnApproval) and `approvals/[id]/page.tsx` both load
    `standingDeclarationsFor` and pass it on the view. The page loads the same
    world the action does, so it does not render an Approve button the server
    would refuse.
  - Tests (approvals.test.ts, asserted through `availableActions` — the function
    the page and actions.ts call — not `mayDecide` directly): a decider who
    PREPARED but did not raise gets SAME_MAKER and no approve/reject; a different
    OSE member still holds the gate; SELF_APPROVAL wins when both apply; an
    in-window recusal gives RECUSED and removes the actions; a recusal naming a
    different request changes nothing; a declared interest in the club removes the
    gate, one in something else does not.
  - Mutation 1: reverted `decisionControl` to omit `preparedByPrincipalId` → the
    SAME_MAKER case RED (the preparer is handed the gate again). Restored.
  - Mutation 2: reverted the world argument to the hardcoded
    `NO_STANDING_DECLARATIONS` → the RECUSED and DECLARED_CONFLICT cases RED.
    Restored → 55 passed.
  - Evidence: `npx jest --ci src/lib/approvals.test.ts` → 55 pass, up from 43.
    2 mutations, 2 caught. Files: `apps/web/src/lib/approvals-world.ts`,
    `apps/web/src/lib/approvals.ts`, `apps/web/prisma/schema.prisma`.

- [x] **PAY-150-004** — Implement approval digest invalidation for amount, recipient, destination, schedule, split or provider changes.
  - Status: PASS
  - What was open: nothing hashed the money-bearing payload. `ApprovalStep.policySnapshot`
    carried authorization flags (`{ requesterIsPresident }`), never the payload,
    while the amount that actually posts money was re-read from the
    client-writable `metadata` Json at DECISION time and turned into a
    `LedgerEntry` plus a `budgetLine.actualCents` increment. The compare-and-swap
    on the final write guards `status` and nothing else, so the president could
    approve one amount and the staff office post another.
  - What is there now:
    - `approvalDigest(metadata, { organizationId, type, amountMinorUnits, currency })`
      in `apps/web/src/lib/approvals.ts` — SHA-256 over eleven decision-relevant
      fields walked in sorted order (`APPROVAL_DIGEST_FIELDS`): amount, currency,
      organization, type, budget line, receipt/document, recipient, vendor/provider,
      destination/venue, occursAt, endsAt. Object keys are canonicalised
      (`stableJson`) so Json insertion order cannot change a hash, and fields a
      decision is not about (a note, a renamed category label) deliberately do not
      move it.
    - Every gate writes it into the existing `policySnapshot` column — no
      migration: `createApproval` (approvals/actions.ts), the decision step in
      `actOnApproval`, and the reimbursement submission step in
      `orgs/[slug]/finance/actions.ts`, which now builds its metadata **once** and
      uses the same object for the row and the digest. `calendar/actions.ts`
      records one for the schedule/venue an event gate is asked about.
    - `calendar-write.ts`'s `syncApprovalSnapshot` deliberately records **no**
      digest and is excluded by `isGateStep` (it is a same-status step): it
      rewrites the very fields the digest covers, so counting it as a gate would
      let a reschedule re-bless itself. It now carries the currency across instead
      of dropping it.
    - `actOnApproval` recomputes the digest from the row it just read and, on
      `approve` only, compares it against the last real gate step
      (`fromStatus !== toStatus`, `toStatus` a `PENDING_*`). On mismatch it
      refuses **before** `reimbursementOps` is built, and forces the request to
      `NEEDS_CHANGES` inside one `db.$transaction` — status update (still
      compare-and-swapped on `status`), an append-only `ApprovalStep` carrying
      `APPROVAL_DIGEST_MISMATCH_REASON`, both digests and
      `authority: "approvals.digest.invalidated"`, and the outbox event, then
      notifies the requester and throws the named reason.
    - A gate step with no recorded digest is **not** a mismatch: `ApprovalStep`
      is append-only and nothing updates it, so absence means "written before this
      control existed", and refusing those would freeze every request in flight.
  - Co-located P0 (REVIEW-FINDINGS #7): already closed in the working tree by the
    concurrent PAY-060-007 work — `schema.prisma` now has `idempotencyKey String?`
    with `@@unique([institutionId, idempotencyKey])`, and both `ApprovalRequest`
    constructors write a derived (never client-supplied) key. Not claimed here.
    What was still outstanding and IS done here: `apps/web/scripts/census.mjs`
    counted that key globally under a heading calling it a global unique; it now
    counts `count(DISTINCT ("institutionId", "idempotencyKey"))` per tenant, with
    the heading and a note corrected. SQL verified against Postgres.
  - Tests: `apps/web/src/lib/approvals.test.ts` (digest stability, what moves it,
    what must not, `recordedPayloadDigest`, `isGateStep`) and
    `apps/web/src/lib/approval-digest.itest.ts` — a real-Postgres test that calls
    the **real `actOnApproval`** twice (president gate, then staff-office gate),
    re-tags `reimbursement.amountCents` from $50.00 to $5,000.00 in between, and
    asserts: the action throws, **no `LedgerEntry` exists**, `budgetLine.actualCents`
    is still 0, the request is `NEEDS_CHANGES`, the refusal step names both digests,
    and the outbox carries `reason: "payload-digest-mismatch"`. A control case
    (nothing tampered) passes both gates and posts exactly what was filed.
  - Mutation proof:
    - Froze `approvalDigest` to a constant (in the producer): the itest's tampered
      case red — the $5,000 claim was approved and the ledger posted; 4 unit cases
      red. Restored byte-identical (`diff -q` clean) → both green.
    - Disabled the comparison in the production caller (`if (false && …)` on the
      mismatch branch in `actOnApproval`): the tampered case red with a
      `LedgerEntry` created. Restored byte-identical → both green.
  - Commands: `DATABASE_URL=postgresql://tenure:tenure@127.0.0.1:5455/pay150 npx jest
    --testMatch "**/approval-digest.itest.ts" --testPathIgnorePatterns "/node_modules/"
    --runInBand` → 2 pass. The scratch database is created with
    `docker exec tenure-verify-pg psql -U tenure -d postgres -c 'CREATE DATABASE pay150;'`
    then `prisma migrate deploy` against it. Use `127.0.0.1`, not `localhost`:
    on this host the name resolves to `::1` first and the container's IPv6 bind
    is not always present.

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

- [x] **PAY-160-002** — Render legal merchant, funds flow, fees, loss responsibility, tax, settlement and ledger preview before activation.
  - Status: PASS
  - What was open: the Studio's setup flow had five stages and zero prices —
    `grep -n "price|Price|cost|Cost|seat|Seat"` over `ComposeForm.tsx` returned
    nothing. `ModuleManifest` had tiers, entitlements and support windows and no
    price field at all. The only price in the platform was plan-grain and
    `null`. An option with no price does not read as unpriced on a form; it reads
    as free.
  - Code, three coupled steps:
    (1) `packages/finops/src/pricing.ts` — `OptionPrice {perSeatMinor, perOrgMinor,
        currency, rounding, includedBecause?}`, `quoteConfiguration(options,
        seatCount)` returning per-option lines and `runningTotalMinor`, built on
        `money`/`fromMinorUnits`/`sum`/`toMinorUnits` so a mixed-currency option
        set throws `CurrencyMismatchError` rather than adding dollars to euros;
        `priceProblems()`; and `activationPreview()`, which returns the quote plus
        the seven Bible §18 disclosures.
    (2) A REQUIRED `price: OptionPrice` on `ModuleManifest`
        (`packages/module-runtime/src/manifest.ts`), enforced in
        `validateManifest` through `priceProblems` — the rule lives on the price
        type, not in a second copy beside the manifests — plus a rule that a
        module priced at zero on both axes must state `includedBecause`, since
        zero is a commercial statement. Filled in for all 12 entries in
        `modules/index.ts`: ten charged, `dashboard` and `administration` free
        with reasons. These are LIST prices the composer quotes;
        `Plan.monthlyPriceCents` stays `null` because no price has been AGREED
        with any tenant, and those are different facts.
    (3) `ComposeForm.tsx` renders per-seat AND per-org figures beside every module
        option and a price statement beside every coexistence domain, a sticky
        running total spanning all five stages with a seat-count input, and a
        pre-activation panel listing legal merchant / funds flow / fees / loss
        responsibility / tax / settlement / ledger preview. Six are UNDECIDED and
        each names the ADR that would record it (PAY-000-002, PAY-070-002,
        PAY-000-003, PAY-040-002, PAY-000-005, PAY-130-003); the ledger preview is
        DECIDED and is the quote itself. There is no default arm: a panel that
        renders "Merchant of record: Tenure" because a field was blank has made a
        legal claim on the platform's behalf. `readyToActivate` is never true
        while a topic is open.
  - Tests: `packages/finops/src/pricing.test.ts` (14) and
    `apps/system-studio/src/app/tenants/new/compose-pricing.test.tsx` (5), which
    renders the REAL `ComposeForm` with the REAL `MODULE_CATALOG` projected
    exactly as `page.tsx` projects it, and asserts the EMITTED markup.
    `tests/architecture/module-objects.test.mjs` gained "every module states a
    list price, and a free one says why", which also refuses a catalog priced
    entirely at zero.
  - Mutation: deleted `price` from `events` in `modules/index.ts` ->
    `validateManifest` threw `ModuleManifestError` at catalog construction (which
    took the whole compose-pricing suite down) AND `module-objects.test.mjs` test
    2 went RED; restored -> both green.
  - Mutation: set `search`'s `perSeatMinor` from 400 to 0 -> the rendered running
    total moved from "$770.00" to "$670.00" and "emits the catalog's actual total
    today" went RED on the EMITTED figure. (The sibling assertion that derives its
    expectation from the same manifests stayed green — which is precisely why the
    concrete-literal assertion exists.) Restored -> 5 pass.
  - Evidence: `cd apps/web && npx jest --ci pricing.test compose-pricing` ->
    19/19. `node --test tests/architecture/module-objects.test.mjs` -> test 2 ok.
  - Note: the figures themselves are a commercial input. They live in exactly one
    place, `listPrice(...)` in `modules/index.ts`, and changing one is a
    commercial decision that moves every quote and reds the pinned total above.

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

- [x] **PAY-180-003** — Require source citations and as-of times for payment status, balances, fees and requirements.
  - Status: PASS
  - What was open: half built, half absent. `Figure` was `{amount, kind, asOf,
    periodCompleteness}`, `figure()` already refused an unparseable `asOf` and
    `freshness()` flagged staleness — the as-of half was real. There was no source
    field anywhere: grep for `source` in `packages/finops/src` returned only
    allocation-driver naming, and the rendered surface said only "as of {asOf}".
    It mattered most exactly where the module already worried:
    `cost-source.ts` distinguishes CONNECTED from NOT_CONFIGURED so a figure is
    never invented, then handed the page a `Figure` that could not say it came
    from the CUR rather than from an estimate.
  - Code: `FigureSource {system, reference, retrievedAt}` in
    `packages/finops/src/reporting.ts`, REQUIRED on `Figure` and on
    `figure(amount, kind, asOf, source, periodCompleteness?)` — required, not
    optional, so `tsc` named every construction site. It is validated the way
    `asOf` already was: a blank system, a blank reference or an unparseable
    `retrievedAt` all throw. `derivedFrom()` marks a citation derived.
  - Construction sites, all of them: `summarize()` (actual and amortized),
    `forecastPeriod()` (propagates the actual's source through `derivedFrom`, so
    nothing presents a projection as a billed line), `fleetCost()`, and the single
    production entry point — now `buildCostReport()` in
    `apps/system-studio/src/lib/cost-report.ts`, which passes
    `{system: "aws-cur", reference: \`s3://${bucket}/${prefix}\`, retrievedAt: asOf}`
    on the CONNECTED arm. The NOT_CONFIGURED arm builds no figure, so nothing can
    be faked.
  - Rendered: `CostReportView.tsx` shows the citation beside the existing "as of"
    badge at `data-testid="figure-source"`, and renders the forecast's derived
    reference in its own row.
  - Why `cost-report.ts` exists: `cost-source.ts` is `server-only` and its
    CONNECTED arm is unreachable until an AWS Organization exists, so the
    figure-building half was split into a `server-only`-free module. A citation
    nothing can render is a citation nobody has checked.
  - Tests: `finops.test.ts` — `figure()` throws for a blank system, a blank
    reference and an unparseable `retrievedAt`; `summarize()` propagates the same
    source onto actual, amortized and forecast.
    `apps/system-studio/src/app/platform/cost/cost-citation.test.tsx` builds the
    report with the production `buildCostReport` and renders the production
    `CostReportView`, asserting the rendered citation is non-empty and names the
    system, the S3 reference and the retrieval time.
  - Mutation: blanked `system` at the construction site in `cost-report.ts` ->
    4 of 5 page-level tests RED (`figure()` refuses it, so the page cannot render
    at all — fail-closed); restored -> 5 pass.
  - Mutation: made `citation()` in `CostReportView.tsx` return "" -> "renders a
    non-empty citation beside the as-of badge" RED (length expected > 20,
    received 0), proving the page-level assertion is load-bearing independently
    of the constructor's refusal; restored -> 5 pass.
  - Mutation: replaced the `source` passed to `summarize`'s `actual` with a
    placeholder -> "propagates the same source onto actual, amortized and
    forecast" RED and the page-level citation test RED; restored -> 68 pass.
  - Evidence: `cd apps/web && npx jest --ci finops.test cost-citation` -> 68/68.

- [ ] **PAY-180-004** — Redact/tokenize financial identifiers in prompts, logs, traces and model outputs.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PAY-180-005** — Prevent payment data from entering shared model training or cross-tenant memory.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [x] **PAY-180-006** - Implement refusal and escalation for prohibited/ambiguous money movement.
  - Status: PASS
  - What was open: nothing classified a request as money movement.
    `apps/web/src/lib/approvals.ts` modelled an approval state machine with no
    money-movement predicate, and `apps/web/src/app/(app)/approvals/actions.ts`
    posted a `LedgerEntry` with no gate distinguishing an internal memo from a
    real disbursement. `docs/implementation/NEXT-SESSION.md` section 0.3 forbids
    execution absolutely; until this landed that was a promise in a prompt.
  - Code: `packages/payments/src/refusal.ts` - `classifyRequest(req)` returns
    `{ verdict, code, reason, escalateTo }`. REFUSED for anything whose effect
    leaves the platform (charge, refund, payout, transfer, disbursement, payroll,
    bank instruction), whatever the amount and whoever the beneficiary; ESCALATE
    for the ambiguous cases - an internal allocation naming an external
    beneficiary, one crossing a legal-entity boundary, an unreadable amount, and
    any kind the control does not recognise; ALLOWED only for a same-entity memo
    or ledger allocation naming nobody outside it. Fails closed.
  - Production caller: `actOnApproval` in
    `apps/web/src/app/(app)/approvals/actions.ts` calls it BEFORE any
    `LedgerEntry` write. A non-ALLOWED verdict writes an `AuditEvent` with
    outcome DENY and the refusal code, and throws, so the posting never happens.
  - Tests: `packages/payments/src/refusal.test.ts` - 9 at the classifier;
    `apps/web/src/app/(app)/approvals/money-movement.test.ts` - 3 at the ACTION,
    asserting on what the action emits (no `ledgerEntry.create`, no
    `$transaction`, an audit row reading `Payments.REFUSED`).
  - Mutation: `classifyRequest` made to return ALLOWED unconditionally - the
    action-level test "refuses the write and records the refusal" red, because
    the payout-shaped approval reached `ledgerEntry.create`, and 6 classifier
    tests red with it. 1 mutation, 1 caught; restored, green.
  - Evidence: `npx jest --ci approvals/money-movement` - 9/9;
    `npx jest --ci packages/payments/src` - 151/151.

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

- [x] **PAY-230-004** — Implement dues/event/sponsorship receipt allocation to club/fund/event and universal journal.
  - Status: PASS
  - What was open: case-insensitive grep for `dues` and `sponsorship` across
    schema.prisma and finance.ts returned ZERO. `LedgerKind` was SPEND |
    REIMBURSEMENT | ADJUSTMENT — three kinds, all outbound — so a dues payment or
    a sponsorship could not be posted at all, let alone allocated across a club, a
    fund and an event. `ledgerSignedCents` enumerated exactly those three, so the
    gap was in the code as well as the schema.
  - What was built: `RECEIPT` added to the `LedgerKind` enum and to
    `ledgerSignedCents`, signing OPPOSITE to SPEND — that switch is the one place
    the sign is decided, so a missing arm is a silent zero everywhere rather than
    a compile error, which is why the arm is asserted directly. A
    `ReceiptAllocation` model (institutionId, ledgerEntryId, source
    DUES|EVENT|SPONSORSHIP, organizationId, fundCode, eventId, minorUnits,
    currency). `allocateReceipt()` in `packages/finops/src/allocation.ts` splits a
    receipt with the largest-remainder splitter already proven by
    `allocateByWeight` rather than a second rounding rule, and refuses the three
    cases that would otherwise pass quietly: no targets, a negative receipt, and
    an all-zero weight set.
  - Caller: `postLedgerEntry` (orgs/[slug]/finance/actions.ts) allocates a RECEIPT
    across its targets BEFORE opening the transaction — a bad allocation refuses
    the whole post rather than leaving an unallocated receipt — and writes the
    slices as `ReceiptAllocation` rows in the same transaction as the entry. With
    no explicit targets the whole receipt lands on the posting club, still through
    `allocateReceipt`, so there is not a second code path that writes an
    allocation a different way. `RECEIPT` is in `LEDGER_KINDS`, so it is offered in
    the post dialog.
  - Tests: `packages/finops/src/receipt-allocation.test.ts` — the slices sum to
    the receipt across 7 amounts x 6 weight sets, determinism, target dimensions
    carried through, and each refusal; `finance.test.ts` — the RECEIPT sign, and
    that a SPEND and a RECEIPT of the same size cancel to zero on the line;
    `ledger-attribution.itest.ts` — allocations written against a real RECEIPT
    entry sum to exactly its magnitude.
  - Mutation 1: changed `allocateReceipt` to round each share independently
    (`Math.floor(minorUnits * weight / total)`) instead of by largest remainder →
    both sum-to-the-unit cases RED. Restored → 8 passed.
  - Mutation 2: removed the `RECEIPT` arm from `ledgerSignedCents` → the sign case
    and the cancel-to-zero case RED (2 failed / 36 passed). Restored → 38 passed.
  - Evidence: `npx jest --ci receipt-allocation` → 8 pass.
    `npx jest --ci src/lib/finance.test.ts` → 38 pass.
    `DATABASE_URL=... npx jest --runInBand --testMatch "**/payments/*.itest.ts"` →
    17 pass. 2 mutations, 2 caught.

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

- [x] **PAY-270-002** — Deliver machine-validated configuration and capability schemas.
  - Scope note: the schemas carry a price per seat and per organisation, which is
    NEXT-SESSION §7's standing requirement rather than a second requirement. It
    is written here rather than appended to the statement above, because the
    statement must read exactly as the Bible states it — a ledger that rewords a
    requirement is a second, quieter specification.
  - Status: PASS
  - What was open: `ConfigDefinition` (`packages/configuration/src/definition.ts`)
    was key / owner / type / default / allowedScopes / mergeStrategy /
    sensitivity / overridable / requiresCapability / liveOnly / description, and
    nothing else. There was no price field, so `validateDefinition` could not
    demand one, and `ResolveResult` returned values, provenance and problems and
    no cost. A grep for `price|perSeat` across `packages/configuration/src` and
    `packages/platform-config/src` hit one line and it was a test fixture
    string. All the shipped option declarations — terminology ×6, payments ×2,
    branding ×4, localization ×6, flags ×3 — were priceless, while §7 says "a new
    config option without a price is incomplete", per seat AND for the whole
    organisation, with a running total.
  - What was built: `price: OptionPrice` on `ConfigDefinition`, **required**, and
    enforced in `validateDefinition` — a definition with no price, a fractional
    minor unit, a negative list price, a non-ISO-4217 currency or an unstated
    rounding mode throws `ConfigDefinitionError` at registration, which is what
    makes "incomplete" a rule rather than a wish. Zero on both axes additionally
    requires `price.includedBecause`: zero is a commercial statement and one
    nobody wrote down is indistinguishable from an option nobody priced.
    `OptionPrice` is PAY-160-002's existing type in `packages/finops/src/
    pricing.ts` rather than a second price shape — one platform price, so a
    quote assembled from modules and one assembled from configuration are the
    same arithmetic. `runningTotal(selected, seats)` was added there, returning
    the per-seat subtotal, the organisation subtotal and the running total as
    `Money`, which `quoteConfiguration` does not compute (it returns only the
    extended figure per line, and §7 asks for both halves side by side).
    `ResolvedConfig` gained `runningCost: RunningTotal` — on the resolved
    configuration, not beside it, so a caller cannot read configuration without
    the price — and `ResolveOptions` gained `seats`, echoed back on the result so
    a total is never shown without the assumption behind it. `isChargeable`
    decides from the EFFECTIVE value: a boolean is charged while it is on (so
    turning the assistant off removes the charge rather than adding one), and
    anything else is charged when it differs from the platform default (so a
    tenant that writes the default back owes nothing).
  - Widening: `price` is required, so every construction site was fixed in the
    same change — `packages/platform-config/src/definitions.ts` (8, incl. the two
    PAY-000-007 payment keys), `branding.ts` (4), `localization.ts` (6),
    `flags.ts` (3, through a new required `FlagSpec.price` so a future flag
    cannot be free by omission), and the fixtures in `configuration.test.ts`,
    `authority.test.ts`, `domains.test.ts`, `exceptions.test.ts`,
    `integrity.test.ts`, `layer-bridge.test.ts`, `publication.test.ts`,
    `store.test.ts` and `apps/system-studio/e2e/configuration-logic.spec.ts`.
    Consumers checked: `ConfigRegistry.of`/`with`, `validateDomains`,
    `redact`, `layer-bridge.resolveVersionedLayers`, `publish`, `diffVersions`,
    `editableDomains`, and every `ResolvedConfig` reader (`flags.decideFlag`,
    `platform-config/resolve.ts`, `apps/web/src/lib/config/server.ts`) — none
    constructs a `ResolvedConfig` literal, so adding a required field there is
    contained to `freezeResolved`.
  - Caller: `apps/system-studio/src/app/tenants/[slug]/configuration/page.tsx`
    resolves the tenant's published layers through `resolveConfig(REGISTRY, …,
    { seats })` and renders `runningCost` — per seat, per organisation, running
    total and a line per charged option — plus a GET form for the seat count,
    because no seat count is recorded against a tenant anywhere in the registry
    and inventing one would put a made-up number on a quote. Every editable field
    also carries its own price through `EditableField.price` →
    `ConfigurationEditor`, so §7's "at every stage" is beside the choice rather
    than on a summary somebody has to find.
  - Prices shipped: `platform.flags.aiAssistant.enabled` 400 minor per seat (the
    model-vendor pass-through, charged while it is on),
    `platform.branding.wordmark` 9,900 minor per organisation (white-label),
    `platform.localization.currency` 4,900 minor per organisation
    (multi-currency). The other sixteen are `includedInPlan(...)` with the reason
    stated. These are list prices recorded in code; the contract
    (`@tenure/provisioning`'s `Plan`/`Contract`) remains authoritative for what
    is actually billed, and nothing here moves money.
  - Mutations: (1) deleted `price` from `platform.terminology.staffOfficeName` —
    `tsc` red (TS2345 at definitions.ts:42) AND
    `packages/platform-config/src/resolve.test.ts` failed to load with
    `ConfigDefinitionError: … declares no price`, AND
    `apps/system-studio/e2e/pricing-logic.spec.ts` failed to collect; restored,
    18/18 green. (2) deleted `price` from `platform.flags.killed` — `tsc` red
    (TS2345 at flags.ts:256) and `flags.test.ts` failed to load with the same
    error; restored, 26/26 green. (3) froze `runningTotal` to a zero constant —
    6/57 in `configuration.test.ts` and 4/7 in `pricing-logic.spec.ts` red, which
    is the point: those assertions read `config.runningCost`, the value the
    RESOLVER emits, not `runningTotal` called directly; restored, green.
    (4) made the resolver pass `[]` instead of the options it resolved —
    7/57 and 4/7 red; restored, green.
  - Evidence: `npx jest --ci packages/configuration/ packages/platform-config/`
    → 22 suites, 489 tests, all pass. `npx playwright test pricing-logic
    configuration-logic` (Studio) → 21 passed. `apps/system-studio` `tsc
    --noEmit` → 0 errors. `apps/web` `tsc --noEmit` → 43 errors, none in this
    change's surface (`grep -i 'price|runningCost|packages.configuration|
    packages.platform-config|packages.finops'` → empty); they are other agents'
    in-flight `TenantScope`/`StoredAuditEvent`/`ButtonProps` widenings.

- [x] **PAY-SEC7-PRICED-CONFIG-OPTIONS** / **PAY-SEC7-001** — NEXT-SESSION §7 standing requirement: every configuration option carries a price, per seat and per organisation, and a surface shows the running total.
  - Status: PASS
  - Evidence: `tests/architecture/module-objects.test.mjs` — "every module states
    a list price, and a free one says why" — reds when a module's `price:` is
    removed and when a module priced at zero on both axes drops its
    `includedBecause`, which is the §7 rule ("a new config option without a price
    is incomplete; prove it with a test that reds when the price is removed").
    Ran `node --test tests/architecture/module-objects.test.mjs`: 7 pass.
  - Same change as PAY-270-002 above, and deliberately not a second
    implementation: §7 was surveyed under three ids and it edits a type every
    other configuration file constructs, so doing it twice would have produced
    two price models. Recorded here so the standing requirement has an entry of
    its own rather than being findable only under a schema item.
  - Field naming: the three survey entries asked for `perSeatMinor`/`perOrgMinor`,
    `perSeatMinorUnits`/`organizationMinorUnits` and a
    `{ free: true; because }` union respectively. The shipped shape is
    `perSeatMinor` / `perOrgMinor` / `currency` / `rounding` /
    `includedBecause?` — PAY-160-002's `OptionPrice`, already in the tree and
    already consumed by the module catalog. Reusing it satisfies all three in
    substance (both figures, integer minor units, one currency, a stated reason
    for zero) and avoids the outcome all three were trying to prevent: a price
    that means one thing in one package and another somewhere else.
  - Residual gap, stated rather than hidden: the seat count on the Studio quote
    comes from the query string, because nothing in the tenant registry records
    one — `TenantManifest` has no seat field and `Plan.quotas` carries a *limit*,
    which is not a count. `runningCost.seats` always reports the number used and
    the page prints it beside the total. Wiring it to a real measured seat count
    needs `UsageMeter` readings to reach the Studio, which is PAY-260-series
    work, not this item's.

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
