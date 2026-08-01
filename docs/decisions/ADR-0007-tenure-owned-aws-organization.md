# ADR-0007 — Tenure owns the AWS Organization; no customer or personal account is ever required

- **Status:** Proposed — the OU model is decided; creating the Organization is not mine to do
- **Date:** 2026-07-31
- **Implements:** GE-010-001
- **Depends on:** the inventory recorded in `docs/architecture/aws-current-state.md`

## Context

The AWS inventory of 2026-07-31 (run `30673479805`) established the estate as it
actually is, rather than as the Architecture Bible assumes:

```
organizations:DescribeOrganization  → AccessDenied
organizations:ListAccounts          → AccessDenied
organizations:ListRoots             → AccessDenied
```

Those three denials are the finding. **There is no AWS Organization.** Everything
Tenure runs — the Simon pilot and the System Studio, two VPCs, two ALBs, two
CloudFront distributions, two ECS clusters, one RDS instance, three S3 buckets —
lives in a single account, reached by a single set of long-lived access keys
that two GitHub repositories both hold.

That arrangement has four properties worth naming before deciding anything:

1. **No blast-radius boundary.** The pilot and the engine share an account, so
   an IAM mistake in one is an IAM mistake in both. They were given separate
   Terraform state, separate clusters and separate distributions; none of that
   is an isolation boundary, because IAM is account-scoped.
2. **No billing boundary.** Per-tenant cost cannot be attributed to anything
   stronger than a tag, and a tag is a convention, not a control.
3. **Nowhere to put a dedicated tenant.** The Bible's isolation tiers include a
   dedicated Tenure-owned account per tenant. There is no vending mechanism.
4. **Nothing to attach a guardrail to.** SCPs are an Organizations feature. With
   no Organization there is no way to express "this account may not be left",
   "this region may not be used", or "security services may not be disabled".

## Decision

**Tenure owns an AWS Organization. Every account in it is a Tenure account.**

A customer is never asked for an AWS account, and no personal account of any
employee is enrolled. A tenant that requires dedicated infrastructure gets a
**Tenure-owned member account vended for them**, not a link into an account they
control. This is the property that lets Tenure make an isolation promise it can
actually keep: an isolation boundary Tenure does not control is not one Tenure
can be accountable for.

### The OU model

```
Root
├── Security                 delegated admin, GuardDuty/Config/Security Hub
├── Log Archive              write-once org trail + config history
├── Infrastructure           shared build/artifact/registry, DNS, ACM
├── Tenure Parent            the global distribution engine (this repo)
├── Nonproduction            dev + staging cells
├── Production Cells         pooled and bridge tenants, by cell
├── Dedicated Tenants        one account per silo/dedicated tenant
└── Quarantine               detached, deny-all; where an account goes when it is
                             compromised or being offboarded
```

Two of these are less obvious and are chosen deliberately:

- **`Tenure Parent` is its own OU, not part of Infrastructure.** The engine
  provisions and can destroy tenant infrastructure. An account that can do that
  is not a shared build account and should not carry a shared build account's
  trust relationships.
- **`Quarantine` exists from day one, empty.** The time to discover that an OU
  with a deny-all SCP does not exist is not during an incident.

### The management account runs nothing

No workload, no pipeline, no application data. Root has MFA, no routine access
keys, and no day-to-day use. This is not caution for its own sake: the
management account is the only account that can leave nothing above it, so a
compromise there is unbounded.

### Partition awareness, without pretending

The account abstraction is partition-aware (`aws`, `aws-us-gov`, `aws-cn`) so a
sovereign deployment is a placement decision rather than a fork. It will **not**
claim a service exists in a partition where it does not. Where a service is
absent, placement fails closed with the named service and partition, rather than
degrading silently to something that looks similar.

## Status is "Proposed", and this section is why

Everything above is a decision I can make and defend. Creating the Organization
is not:

- It is **irreversible in practice**. An account can leave an Organization, but
  the management account is fixed at creation — the account that creates it is
  the account that owns it forever. Choosing it wrongly is a migration, not an
  edit.
- It **changes billing.** Consolidated billing moves every member account's
  charges to the payer. That is a commercial arrangement.
- **Member accounts need unique root email addresses** and real contact,
  billing and tax details. Those are the operator's, and I should not invent
  them.
- The current account is **already running a live pilot with real student data**.
  Whether it becomes the management account, a member account, or is left where
  it is and superseded is a decision with a migration attached.

So this ADR fixes the *shape*, and GE-010-002 onwards stay unchecked until an
operator decides the four points above. Writing an ADR that says "create an
Organization" and then creating one would be exactly the pattern GE-001-007
exists to prevent — acting on infrastructure before the questions it depends on
are answered.

## What is being done instead, now

**GE-011 (OIDC) does not depend on any of this.** Replacing long-lived keys with
short-lived, repository-scoped, branch-scoped role assumption is a strict
improvement in the single-account estate and stays correct after the
Organization exists — the roles simply move. It is additive, reversible by
deleting a provider and some roles, touches no running workload, and removes the
single worst property of the current setup: two repositories sharing one static
key pair with no expiry.

That is the next thing to land, and it is the one this ADR unblocks by *not*
blocking on it.

## Consequences

- The isolation tiers in the Bible become expressible; today they are aspiration.
- Per-tenant cost attribution becomes real (an account is a billing boundary; a
  tag is not).
- Someone must own account vending, root credentials and contact details as an
  operational practice. That is a cost this ADR creates and does not remove.
- Until the Organization exists, **every claim about tenant isolation must be
  qualified as logical isolation inside one account.** Anything stronger would
  be untrue, and `docs/architecture/subsystem-paths.md` §4 records what the
  logical boundary does and does not enforce.
