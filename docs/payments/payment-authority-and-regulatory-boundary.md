# Payment authority and regulatory boundary

- **Implements:** PAY-000-001
- **Date:** 2026-08-14
- **Authority:** `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md` §1 and §2
- **Kept true by:** `tests/architecture/pay-authority-boundary-and-adrs.test.mjs`
- **Related decisions:** `docs/decisions/pay-adr-0001-merchant-of-record-default-and-exception-paths.md`,
  `docs/decisions/pay-adr-0002-responsibility-selection-algorithm.md`

## What this document is, and what it is not

It states, for each of the five parties to a Tenure payment — Tenure, the
tenant, Stripe, the bank and the card network — which obligations each one
carries, and for every obligation Tenure claims to hold, the code that actually
holds it.

It is **not** a legal opinion, a contract, a licence, a provider approval, or a
statement that any of these arrangements is live. **No payment capability in
this repository is transactable today.** `PAYMENT_CAPABILITIES` in
`packages/payments/src/capability-registry.ts` declares 31 leaves: 24 `PLANNED`
and 7 `UNSUPPORTED`, and `isTransactable` in the same file returns true only for
`TENANT_PILOT`, `GA_LIMITED` and `GA`. No Stripe SDK is a dependency of any
workspace, and `tests/architecture/payments-port-is-the-only-door.test.mjs`
fails the build if one becomes one. So every row below describing Stripe, a bank
or a network describes an obligation Tenure must not assume, not one anybody has
performed.

Where a responsibility is **not modelled in code**, this document says so in
those words rather than describing an intent as a mechanism. §7 lists all of
them in one place.

## 1. The five parties, and which of them the code knows about

| Party | In code as | Where |
|---|---|---|
| Tenure (the platform) | `TENURE` | `RESPONSIBILITY_PARTIES`, `packages/payments/src/responsibility.ts` |
| The tenant (the seller legal entity) | `TENANT` | `RESPONSIBILITY_PARTIES`, `packages/payments/src/responsibility.ts` |
| Stripe (the provider) | `PROVIDER`, and `PROVIDER = "stripe"` | `packages/payments/src/responsibility.ts`, `packages/payments/src/api-version.ts` |
| The paying customer | `CUSTOMER` | `RESPONSIBILITY_PARTIES`, `packages/payments/src/responsibility.ts` |
| The bank | **not modelled** | — |
| The card network | **not modelled** | — |

Four parties, not six. The bank and the network are real parties to every card
payment and neither is a value any Tenure type can hold. That is deliberate and
it is also a limit: §5 and §6 state their responsibilities as **boundaries
Tenure must not cross**, and nothing in the codebase enforces those two rows.
Recording them as if they were modelled would be the more dangerous error, so
they are recorded as prose and labelled as prose.

## 2. Tenure's responsibilities

Bible §2 states five things Tenure **is**. Each is listed here with the code
that performs it, or with an explicit "not built".

| Tenure is | Performed by | State |
|---|---|---|
| The tenant configuration, business workflow, approval and policy system | `packages/payments/src/responsibility.ts` (the eight-axis matrix), `packages/payments/src/liability.ts` (`assertLiabilityApproved`) | built |
| The canonical subledger and universal-journal integration layer | `packages/payments/src/posting.ts` (`POSTING_TEMPLATES`, `postingFor`) | built |
| The provider-orchestration, event, reconciliation, reporting and evidence system | `apps/web/src/app/api/payments/provider-events/route.ts`, `packages/payments/src/webhook.ts`, `packages/payments/src/balance-transactions.ts` | ingest and reconcile built; no outbound provider call exists |
| The operator and tenant UX for eligible payment capabilities | `apps/web/src/app/(app)/admin/payments/page.tsx`, `apps/web/src/app/(app)/admin/payments/actions.ts` | built |
| The institutional memory for merchant onboarding, financial policies, decisions, incidents and handoffs | `docs/implementation/payments-treasury-execution-ledger.md`, this document, and the two ADRs it links | built |

Tenure additionally holds, and these are the obligations that make the platform
accountable for something rather than merely adjacent to it:

1. **Refusing a decision nobody made.** `resolveResponsibility` returns
   `party: null` and a named blocker for any of the eight axes left unanswered.
   It never fills a gap. `packages/payments/src/responsibility.ts`.
2. **Refusing money movement that leaves the platform.** `classifyRequest` in
   `packages/payments/src/refusal.ts` treats `charge`, `refund`, `payout`,
   `transfer`, `disbursement`, `payroll` and `bank-instruction` as leaving the
   platform, and an unrecognised kind escalates rather than passing.
3. **Refusing to persist a liability shift without a human.** `assertLiabilityApproved`
   in `packages/payments/src/liability.ts`, enforced at the write in
   `apps/web/src/app/(app)/admin/payments/actions.ts`.
4. **Refusing a provider event it cannot authenticate or does not recognise.**
   `apps/web/src/app/api/payments/provider-events/route.ts` verifies the raw
   body signature, checks the event against the pinned `PROVIDER_API_VERSION`,
   and records rather than applies. A provider webhook is evidence, never
   business permission.
5. **Refusing an unqualified provider reference.** `qualify` in
   `packages/payments/src/external-reference.ts` throws
   `UnqualifiedReferenceError` rather than storing a provider id that does not
   name its tenant, mode and account.

## 3. The tenant's responsibilities

The tenant legal entity — not the tenant row, not a department, club, project
or cost centre (Bible §1.4) — is the seller. It carries:

- **Being the merchant of record**, which is the default recorded in
  `docs/decisions/pay-adr-0001-merchant-of-record-default-and-exception-paths.md`.
- **Processing fees, disputes, refunds and negative balances** on the default
  flow. On a direct charge the code refuses to record otherwise:
  `DIRECT_CHARGE_NOT_TENURE` in `packages/payments/src/responsibility.ts` makes
  `merchantDisplay`, `lossPayer`, `refundPayer`, `disputeOwner` and
  `accountCollectionOwner` unassignable to `TENURE` on that flow.
- **Its own KYC/KYB obligations to the provider.** `kycUpdateOwner` may never be
  `TENURE` — that pair is in `FORBIDDEN_PARTIES` — because Bible §2 says Tenure
  is not the KYC/KYB decision owner where Stripe owns that obligation.
- **The commercial terms of its own sale**, including what it charges, its
  refund policy and its customer support, unless `supportOwner` records
  otherwise for a specific flow.

## 4. Stripe's responsibilities

Stated as the boundary Tenure must not cross. Tenure does not perform, verify or
guarantee any of these, and nothing in the repository calls Stripe today.

- **Acquiring, processing and settlement** of the charge, under Stripe's own
  licences and its agreements with the tenant's connected account.
- **KYC/KYB decisioning and ongoing requirements** for connected accounts, where
  Stripe owns that obligation (Bible §2). Tenure surfaces requirements; it does
  not decide them.
- **Custody of funds** in a Stripe balance or a connected-account balance.
  Tenure is not a custodian or holder of customer funds (Bible §2) and holds no
  balance of its own.
- **The dispute process with the network**, including evidence submission
  windows and outcomes. `disputes.evidence` is `PLANNED` in
  `packages/payments/src/capability-registry.ts`; Tenure records evidence, the
  provider files it.
- **The authoritative record.** Tenure is not a replacement for provider records
  (Bible §2). `packages/payments/src/balance-transactions.ts` reconciles against
  the provider's figures; where they disagree, the provider's record is the fact
  and the difference is the finding.

Product copy consequence, from Bible §2: the phrases "Tenure bank account",
"Tenure holds your funds", "Tenure-issued card", "insured by Tenure" and
"payments available globally" are prohibited. The accurate form is "financial
account provided through Stripe and its banking partners".

## 5. The bank's responsibilities — **not modelled in code**

The bank that holds the settlement account, and any partner bank behind an
embedded financial account or a card program, carries:

- Holding the funds and operating the account.
- The account agreement with the account holder, which is the tenant legal
  entity or the provider's partner-bank arrangement — never Tenure.
- Deposit insurance where any exists. Tenure insures nothing.
- The authoritative bank record of every credit and debit.

**Nothing in this repository models a bank party, a bank account or a bank
instruction as a first-class object.** `bank-instruction` appears once, in
`MONEY_MOVEMENT_KINDS` in `packages/payments/src/refusal.ts`, and it appears
there in order to be refused. That is the entire extent of the bank in the code.

## 6. The card network's responsibilities — **not modelled in code**

The network (Visa, Mastercard, and the local schemes) carries the scheme rules,
interchange and scheme fees, the chargeback rights of the cardholder, and the
arbitration outcome of a dispute. Tenure is not a card network (Bible §2) and
cannot alter any of it.

**Nothing in this repository models a network.** The one place the network's
existence changes a Tenure decision is `regionBlockers` in
`packages/payments/src/charge-model.ts`, which refuses a charge presented in an
acquiring region other than the seller's country because "cross-border acquiring
changes the merchant of record" and the scheme fees and dispute rules with it.
That is a refusal, not a model.

## 7. The eight responsibility axes, and who may hold each

Derived from `RESPONSIBILITY_AXES` and `FORBIDDEN_PARTIES` in
`packages/payments/src/responsibility.ts`. "May hold" is every party in
`RESPONSIBILITY_PARTIES` that is not forbidden for that axis. Nothing here is a
default: an axis nobody has answered is a blocker, on every flow.

| Axis | May never hold it | May hold it |
|---|---|---|
| `merchantDisplay` | `CUSTOMER`, `PROVIDER` | `TENURE`, `TENANT` |
| `feePayer` | — | `TENURE`, `TENANT`, `PROVIDER`, `CUSTOMER` |
| `lossPayer` | `CUSTOMER` | `TENURE`, `TENANT`, `PROVIDER` |
| `refundPayer` | `CUSTOMER` | `TENURE`, `TENANT`, `PROVIDER` |
| `disputeOwner` | `CUSTOMER` | `TENURE`, `TENANT`, `PROVIDER` |
| `kycUpdateOwner` | `TENURE`, `CUSTOMER` | `TENANT`, `PROVIDER` |
| `accountCollectionOwner` | `CUSTOMER` | `TENURE`, `TENANT`, `PROVIDER` |
| `supportOwner` | `CUSTOMER` | `TENURE`, `TENANT`, `PROVIDER` |

`feePayer` is the one axis with no forbidden party, and that is not an oversight:
a customer paying a surcharge, a tenant absorbing the fee, Stripe netting it and
Tenure absorbing it under an approved exception are all real arrangements. Which
one applies is decided by
`docs/decisions/pay-adr-0002-responsibility-selection-algorithm.md`, never by a
default.

The three funds flows the axes are resolved for are `direct`, `destination` and
`separate_charges_and_transfers` (`FUNDS_FLOWS`), in that order, which is
ascending platform liability. Every axis is resolved for every flow before one
is chosen; `docs/decisions/pay-adr-0002-responsibility-selection-algorithm.md`
records why.

On the `direct` funds flow a further five axes may not be `TENURE`
(`DIRECT_CHARGE_NOT_TENURE`): `merchantDisplay`, `lossPayer`, `refundPayer`,
`disputeOwner`, `accountCollectionOwner`. The charge lands on the tenant's
connected account, so the provider debits that account and no Tenure policy
changes where the money comes from.

## 8. What Tenure is not, and what refuses it

The seven items of Bible §2, each with the mechanism that refuses it. Where the
refusal is a document rather than code, this says so.

| Tenure is not automatically | Refused by |
|---|---|
| Merchant of record. | `DIRECT_CHARGE_NOT_TENURE` and `FORBIDDEN_PARTIES` in `packages/payments/src/responsibility.ts`; `docs/decisions/pay-adr-0001-merchant-of-record-default-and-exception-paths.md` |
| Bank, money transmitter, payment institution, acquirer, issuer or card network. | No such object exists. `classifyRequest` in `packages/payments/src/refusal.ts` refuses every kind whose effect leaves the platform |
| Custodian or holder of customer funds. | No balance object of Tenure's own exists; `packages/payments/src/balance-transactions.ts` reads the provider's |
| Employer, payroll provider or tax filer. | `payroll` is in `LEAVES_THE_PLATFORM` in `packages/payments/src/refusal.ts` |
| KYC/KYB decision owner where Stripe owns that obligation. | `kycUpdateOwner: ["TENURE", "CUSTOMER"]` in `FORBIDDEN_PARTIES` |
| Guarantor for tenant negative balances. | `lossPayer` and `refundPayer` may not be `TENURE` on the default flow; on any other flow `assertLiabilityApproved` in `packages/payments/src/liability.ts` refuses the write without an APPROVED exception pinned to the exact decision |
| A replacement for provider, bank, network or regulator records. | **Document only.** `packages/payments/src/balance-transactions.ts` reconciles to the provider, but no code prevents a reader treating a Tenure figure as authoritative |

## 9. The gaps, stated as gaps

1. No bank party and no bank-account object exists (§5).
2. No card-network object exists (§6).
3. No provider integration exists: no Stripe SDK, no outbound call, no key.
   Every capability is `PLANNED` or `UNSUPPORTED`.
4. "Tenure is not a replacement for provider, bank, network or regulator
   records" is enforced by nothing (§8, last row).
5. The bank and network rows of this document are the only rows with no code
   behind them, and the guard test cannot check prose. It checks that every
   party, axis, flow and forbidden pair the code declares appears here — which
   catches the code growing past the document, not the document overstating the
   world. A reader who wants the second check has to read §5, §6 and §9.
