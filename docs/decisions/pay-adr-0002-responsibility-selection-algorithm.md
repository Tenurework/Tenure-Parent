# PAY-ADR-0002 — How fee payer, negative-balance, dispute and loss responsibility are selected: lowest liability that is fully answered, and absence is never an answer

- **Status:** Accepted. Records the selection algorithm implemented in `packages/payments/src/responsibility.ts`, `packages/payments/src/funds-flow.ts`, `packages/payments/src/charge-model.ts` and `packages/payments/src/liability.ts`. **It selects no party for any real merchant** — no merchant configuration exists in this repository and no capability is transactable.
- **Date:** 2026-08-14
- **Implements:** PAY-000-003
- **Authority:** `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md` §1.2, §1.6, §2, §3 and §6
- **Depends on:** `docs/payments/payment-authority-and-regulatory-boundary.md`
- **Sibling:** `docs/decisions/pay-adr-0001-merchant-of-record-default-and-exception-paths.md` decides who is the seller; this one decides who pays when it goes wrong.
- **Kept true by:** `tests/architecture/pay-authority-boundary-and-adrs.test.mjs`

> **Filename** is prefixed `pay-` rather than numbered `ADR-000N` for the reason
> given in PAY-ADR-0001: concurrent authors numbering independently collide, and
> `docs/decisions/README.md` records that happening twice already.

## Context

Bible §3 requires every capability leaf to declare "Fee payer, loss payer,
refund payer and negative-balance responsibility". Bible §1.2 states the
approved preference:

> Prefer a provider configuration in which Stripe and/or the tenant connected
> account carries processing fees, disputes and negative-balance responsibility
> where Stripe supports that exact arrangement. **Tenure must not accept platform
> liability merely to unlock a convenient flow.**

A preference is not an algorithm. "Prefer" has to become a procedure that takes
the same inputs twice and returns the same answer, or every integration decides
it again from whatever was convenient that afternoon — and the convenient answer
is systematically the one that moves liability to the platform, because
destination charges solve delayed onboarding and splits solve marketplaces and
both of them park the negative balance on Tenure.

Four axes are in scope for this ADR — fee payer, negative balance, dispute and
loss — and they are resolved as four of the eight in `RESPONSIBILITY_AXES`.
Negative balance is not a separate axis: a negative balance is what an unpaid
loss becomes, so it resolves with `lossPayer`, and `accountCollectionOwner`
resolves who chases it. Splitting them would let a configuration say Tenant
carries the loss and Tenure carries the negative balance, which is the same
sentence written twice with different answers.

## Decision

**Six steps, in this order, and every one of them can refuse.**

### Step 1 — Eligibility first, because it is a different question

`simulateEligibility` (`packages/payments/src/eligibility.ts`) runs before any
flow is considered. A merchant ineligible for the capability gets no flow at
all, with the reason in `packages/payments/src/funds-flow.ts`: "the flow decides
who carries the money, not whether there may be any."

### Step 2 — Resolve all eight axes, for every flow, before choosing one

For each flow in `FUNDS_FLOWS` order and each axis in `RESPONSIBILITY_AXES`
order, `resolveResponsibility` computes:

```
party  = config.overrides[axis] ?? config.defaults[axis] ?? null
source = overrides[axis] ? "tenant-override" : "default"
```

and then applies three refusals:

1. `party === null` → **blocker.** The axis is unanswered. Never defaulted.
2. `party ∈ FORBIDDEN_PARTIES[axis]` → **blocker.** The pairs are in
   `packages/payments/src/responsibility.ts` and each is one line of Bible §2
   turned into a refusal: `kycUpdateOwner` may not be `TENURE`; `lossPayer`,
   `refundPayer`, `disputeOwner`, `accountCollectionOwner` and `supportOwner`
   may not be `CUSTOMER`; `merchantDisplay` may be neither `CUSTOMER` nor
   `PROVIDER`.
3. `flow === "direct" && party === "TENURE" && axis ∈ DIRECT_CHARGE_NOT_TENURE`
   → **blocker.** On a direct charge the money lands on the tenant's connected
   account; recording Tenure as loss payer there describes an arrangement the
   provider is not implementing.

The function always returns exactly eight resolutions. A partial matrix is not a
value it can produce, so a caller cannot forget an axis — only be handed one it
has to deal with.

### Step 3 — Choose the first flow whose matrix is complete

`FUNDS_FLOWS` is ordered `direct`, `destination`, `separate_charges_and_transfers`,
which is **ascending platform liability**, and
`chooseFundsFlow` takes the first with zero blockers. Not the best-configured
one, not the one the operator picked, not the one the use case suggests: the
lowest-liability one that has actually been answered. A merchant that qualifies
for `direct` is therefore never handed a flow that shifts loss to Tenure merely
because that flow also happened to be configured.

Every refused flow comes back with the axes that failed it, because "you cannot
use destination charges" without the reason is a support ticket rather than an
answer.

### Step 4 — Derive the model and the liable party; never invert the derivation

`decideChargeModel` maps flow to model through `MODEL_FOR_FLOW`
(`direct → DIRECT`, `destination → DESTINATION`,
`separate_charges_and_transfers → SEPARATE_CHARGE_AND_TRANSFER`) and reads
`liableParty` from the resolved `lossPayer`. The caller's claimed `lossBearer` is
an **input to be checked, not a source of truth**: if it disagrees with the
resolved matrix the decision is refused with
`loss-bearer-contradicts-configuration`, because two answers to one question is
not a decision. If it is absent the decision is refused with
`loss-bearer-unanswered`.

### Step 5 — Refuse on the facts that no flow can fix

Independently of the flow, `decideChargeModel` blocks on: an
`INTERNAL_ALLOCATION` use case (Bible §1.10 — no external boundary is crossed,
so no charge model applies); a non-positive amount; **any non-zero platform fee**
(Bible §1.6 — disabled by default); no connected account, or one that cannot
accept charges; an acquiring region that is not an ISO 3166-1 alpha-2 code, is
not among the capability's certified countries, or differs from the seller's
country of establishment.

### Step 6 — If the answer put loss on Tenure, a human decides

`requiresLiabilityException` is true exactly when the model is in
`LIABILITY_SHIFTING_MODELS` — `DESTINATION` and `SEPARATE_CHARGE_AND_TRANSFER` —
**and** `liableParty === "TENURE"`. Both conditions, not either: a destination
charge whose loss payer is the connected account is an ordinary configuration,
and Tenure carrying loss on a direct charge was already refused in Step 2 and
cannot reach here.

When it is true, `assertLiabilityApproved` refuses the **write**, not merely the
render, until an `ApprovalType.EXCEPTION` approval exists with
`status === "APPROVED"` and a `decisionDigest` equal to
`chargeModelDigest(decision)`. The digest covers model, liable party,
capability, region, seller, use case, `grossCents`, `platformFeeCents` and flow,
so approving a flow at one amount is not approving it at another. Three distinct
refusal codes, because they need three different actions:
`liability-exception-missing` (raise one),
`liability-exception-not-decided` (wait for the approver), and
`liability-exception-digest-mismatch` (what was approved is not what is being
written — raise a new one).

The production caller that enforces this is
`apps/web/src/app/(app)/admin/payments/actions.ts`.

## Alternatives considered

**Derive the matrix from the flow.** Direct charge ⇒ tenant pays everything;
destination ⇒ platform pays everything. Rejected: it is right often enough to
look correct and it makes the matrix a restatement of the flow rather than an
input to choosing one. It also removes the only place a legal or provider
arrangement that differs from the textbook can be recorded.

**A liability score with a threshold.** Weight each axis, sum, approve above a
number. Rejected: the number would be tuned until the flows people wanted passed,
and a threshold cannot express "this pair is illegal" — `kycUpdateOwner: TENURE`
is not expensive, it is not Tenure's to hold.

**Let the tenant override anything.** Rejected. Overrides beat platform defaults
(a tenant may take on fees its contract says it takes on) but they are checked by
the same two refusals, so a tenant cannot configure Tenure into a liability.
The override is a preference; the forbidden pairs and the direct-charge rule are
not preferences.

**Choose the configured flow rather than the lowest-liability one.** Rejected:
the flow that gets configured first is the one that solved somebody's immediate
problem, and it is systematically the higher-liability one. Ordering by liability
and taking the first complete answer means adding a destination-charge
configuration can never take direct charges away from a merchant who qualifies.

**Resolve only the chosen flow's axes.** Rejected: the reason a flow was refused
is the thing onboarding needs, and computing it lazily means it is computed at
the moment nobody is looking.

**Default the unanswered axis to `TENANT`.** Rejected for the reason given in
PAY-ADR-0001 §Decision: it would be right nearly always, and wrong silently on
the day it was not.

## Consequences

1. **Onboarding must answer up to twenty-four questions** — eight axes across
   three flows — to make every flow available, and eight to make `direct`
   available. That is the price of no defaults and it is charged at onboarding,
   which is where somebody can be asked.
2. **A half-configured merchant is refused, not degraded.** There is no partial
   matrix and no "best effort" flow. `chooseFundsFlow` returning `flow: null`
   with three refused flows and their failing axes is a complete answer.
3. **`feePayer` is the one axis with no forbidden party**, so a customer
   surcharge is expressible. It is expressible because it is real, not because
   it is approved: surcharging has its own scheme rules and disclosure
   obligations, and this algorithm does not check them. Recording
   `feePayer: CUSTOMER` needs the PAY-000-005 legal and provider review that
   PAY-ADR-0001 §E3 also points at.
4. **Approvals are re-asked when the decision moves.** The digest makes an
   amount change produce a mismatch rather than an inherited approval, so
   approvers will see what looks like the same request twice. That is the gate
   working, and any change that makes it stop is a weakening of it.
5. **Negative balance has no axis of its own** (see §Context). A configuration
   that wants a different party to carry the negative balance than carries the
   loss cannot be expressed, and that is intended; if a real provider
   arrangement ever separates them, this ADR is superseded rather than the axis
   quietly added.
6. **Nothing here has selected anything.** No merchant profile, no
   `FundsFlowConfig` and no approval row exists in this repository. The
   algorithm is exercised only by its tests.
