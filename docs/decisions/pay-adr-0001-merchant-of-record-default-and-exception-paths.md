# PAY-ADR-0001 — The tenant legal entity is the merchant of record; Tenure is not, and every exception is a named human approval

- **Status:** Accepted. The default is the Bible's approved default, not this document's invention. **No exception is granted by this ADR**, and none has been granted anywhere: `grep -rn "liability-exception" apps/web/prisma/` returns nothing, because no approval row exists.
- **Date:** 2026-08-14
- **Implements:** PAY-000-002
- **Authority:** `Tenure_Global_Payments_Treasury_and_Stripe_Control_Plane_Claude_Bible_v1.0.md` §1.1, §1.2, §1.6, §2 and §6
- **Depends on:** `docs/payments/payment-authority-and-regulatory-boundary.md`
- **Sibling:** `docs/decisions/pay-adr-0002-responsibility-selection-algorithm.md` decides who carries fees and losses; this one decides who *is* the seller.
- **Kept true by:** `tests/architecture/pay-authority-boundary-and-adrs.test.mjs`

> **Filename.** The ADRs in this directory are numbered `ADR-000N`. This one is
> prefixed `pay-` instead, because sixteen other agents are writing into this
> tree in the same wave and two of them claiming `ADR-0009` produces a collision
> that loses somebody's work — the exact failure `docs/decisions/README.md`
> records happening to `PD-004` and `ADR-0005` across two repositories. The
> format below is the format of
> `docs/decisions/ADR-0007-tenure-owned-aws-organization.md`.

## Context

Bible §1 opens: "These decisions are approved defaults, not guesses." §1.1 then
states the one this ADR records:

> The tenant legal entity that sells the goods/services or receives the funds
> should legally appear as seller or merchant. Tenure is not the merchant of
> record by default.

And Bible §2 lists "Merchant of record" first among the things Tenure "is not
automatically". The word carrying the weight in that heading is *automatically*.
Merchant of record is not a setting somebody turns on. It is what the payment
descriptor says, what the receipt says, whose name the cardholder disputes
against, whose licences the acquiring runs under, and whose tax registration the
sale lands in. A platform becomes merchant of record by having a plausible
default and never being asked about it.

The decision therefore has to exist as a written default **and** as a set of
paths off that default that each terminate in a human, or it is not a decision —
it is a preference that the first inconvenient integration overrides.

What already exists in the tree, and what it does not do:

- `packages/payments/src/responsibility.ts` has a `merchantDisplay` axis among
  eight, resolves it to `null` with a named blocker when nobody answered, and
  forbids `CUSTOMER` and `PROVIDER` from holding it.
- `DIRECT_CHARGE_NOT_TENURE` in the same file makes `merchantDisplay: TENURE`
  impossible on a direct charge.
- `packages/payments/src/funds-flow.ts` tries the flows in ascending platform
  liability and picks the first with a complete matrix, so a merchant that
  qualifies for `direct` is never handed a flow that shifts merchant display.
- `packages/payments/src/liability.ts` refuses to persist a decision that moves
  **loss** to Tenure without an APPROVED exception pinned to that exact decision.

None of that is a recorded decision. It is code implementing an unwritten one,
which is the state in which a future change looks like a refactor.

## Decision

**The merchant of record for every Tenure payment is the tenant legal entity
that sells the goods or services or receives the funds. Tenure is never the
merchant of record unless a named human approves that specific arrangement for
that specific seller, and the approval is pinned to the decision it approved.**

Three properties make that a rule rather than a sentence:

1. **The account boundary is a legal entity, not a tenant row.** Bible §1.4. A
   department, club, project or cost centre is not a merchant. Simon clubs in
   particular are internal organisational units under University/OSE legal
   ownership and settle through internal subledgers (Bible §1.5), not by
   pretending each club is an independent merchant.
2. **There is no default arm.** `merchantDisplay` unanswered is a blocker, not
   `TENANT`. This is deliberate and it is the opposite of the obvious
   optimisation: defaulting the axis to `TENANT` would be right almost always
   and would silently make Tenure the merchant on the day somebody added a flow
   where `TENANT` was wrong.
3. **An internal allocation is not a sale and has no merchant.** Bible §1.10.
   `decideChargeModel` refuses `INTERNAL_ALLOCATION` outright with
   `internal-allocation-is-not-a-charge`.

## The exception paths, in full

Four, and they are not equals. Two are approvable; two are refusals that need a
review nobody can grant inside this repository.

### E1. Destination charge with loss on Tenure — **approvable**

`DESTINATION` is in `LIABILITY_SHIFTING_MODELS` (`packages/payments/src/liability.ts`).
When the resolved `lossPayer` is `TENURE`, `requiresLiabilityException` returns
true and `assertLiabilityApproved` refuses the write until an
`ApprovalType.EXCEPTION` exists with `status === "APPROVED"` whose
`decisionDigest` equals `chargeModelDigest(decision)`. The digest covers
`grossCents` and `platformFeeCents`, so approval of a £500 flow is not approval
of the same flow at £500,000.

### E2. Separate charges and transfers with loss on Tenure — **approvable**

`SEPARATE_CHARGE_AND_TRANSFER`, identically gated. Bible §6 names both flows
"exception-capable … because they can place fees, refunds, chargebacks and
negative balances on the platform", and Bible §1.2 answers the obvious
temptation: "Tenure must not accept platform liability merely to unlock a
convenient flow."

### E3. Cross-border acquiring — **not approvable here; needs PAY-000-005 review**

`regionBlockers` in `packages/payments/src/charge-model.ts` emits
`region-cross-border-acquiring` whenever the acquiring region differs from the
seller's country of establishment, with the reason "cross-border acquiring
changes the merchant of record". It is a **blocker**, not an exception request:
`decideChargeModel` returns `model: null` and nothing downstream can approve it.
Clearing it requires the legal and provider review of PAY-000-005, which is a
different requirement and is not closed.

### E4. A Tenure application or platform fee — **not approvable here; needs Bible §1.6's five approvals**

`platform-fee-not-enabled` fires on any non-zero `platformFeeCents`.
`funds-flow.application-fee` is `UNSUPPORTED` in
`packages/payments/src/capability-registry.ts`. Bible §1.6 disables platform
fees by default and requires the customer contract, pricing configuration,
accounting and tax treatment, provider configuration and legal review all to
allow one. This ADR does not allow one, and cannot: it is a commercial and legal
decision belonging to the operator.

### Not an exception path

Anything that would put `merchantDisplay` on `CUSTOMER` or `PROVIDER`. Those are
in `FORBIDDEN_PARTIES` and no approval makes the payer or the processor the
seller.

## Alternatives considered

**Tenure as merchant of record by default.** This is what a platform gets by
building the convenient integration first. It makes onboarding shorter — one
merchant to underwrite instead of hundreds — and it makes Tenure the seller of
every tenant's goods, the party to every dispute, the entity with the tax
registration in every jurisdiction a tenant sells into, and the payer of every
negative balance. Rejected by Bible §1.1 and §2, and this ADR records the
rejection rather than re-deciding it.

**A per-tenant configuration flag with `TENANT` as the default value.** Rejected
because a default is exactly the failure mode: the axis reads as decided when
nobody decided, and every reviewer downstream sees an answer instead of a
question. The chosen shape — `null` plus a named blocker — makes the absence
loud.

**Deciding merchant of record per payment.** Rejected. Merchant of record is a
property of the legal and provider arrangement, not of a transaction; letting it
vary per payment produces receipts within one seller that disagree about who
sold the thing.

**Recording exceptions in a runbook.** Rejected. Bible §6's flows are
convenient, and convenience routes around documentation. The gate is a refusal
to persist, in `apps/web/src/app/(app)/admin/payments/actions.ts`.

## Consequences

1. **Onboarding is heavier.** Every seller is its own merchant, so every seller
   is underwritten. That cost is the shape of the decision, not a side effect of
   it.
2. **A tenant that cannot qualify for a connected account cannot sell through
   Tenure**, and the honest answer to that tenant is "not yet", not a
   destination charge quietly booked against the platform.
3. **Approvals go stale by design.** The pinned digest means an amount change
   after approval raises a new request. Approvers will be asked again for what
   looks like the same thing; that is the mechanism working.
4. **A known gap, recorded rather than papered over.** `requiresLiabilityException`
   keys on `decision.liableParty`, which is the resolved **`lossPayer`**. A
   `DESTINATION` flow configured with `merchantDisplay: TENURE` and
   `lossPayer: TENANT` therefore passes the gate with no exception approval —
   Tenure appears as the merchant while the gate, which is watching loss, sees
   nothing to stop. The default in §Decision is stated correctly and the code
   does not yet enforce the merchant-display half of it. Closing that is a code
   change to `packages/payments/src/liability.ts` and is **not** made by this
   ADR; PAY-040-002's matrix is where it belongs. Until it is made, the
   protection against Tenure appearing as merchant is `DIRECT_CHARGE_NOT_TENURE`
   on the default flow and this document on the others.
5. **Nothing here is live.** No capability is transactable, no Stripe SDK is a
   dependency, and no exception approval row exists. This ADR decides what will
   be true when something is built; it does not report that anything was.
