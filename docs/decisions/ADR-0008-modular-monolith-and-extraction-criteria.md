# ADR-0008 — Modular monolith by default, with objective criteria for extracting a service

- **Status:** Accepted
- **Date:** 2026-08-01
- **Implements:** GE-020-004
- **Depends on:** [ADR-0007](./ADR-0007-tenure-owned-aws-organization.md) for what an account boundary means
- **Enforced by:** `tests/architecture/ownership.test.mjs`, `tests/architecture/forbidden-clients.test.mjs`

## Context

Tenure is fourteen platform domains (`docs/architecture/ownership.md`) inside two
deployable units: the pilot cell and the engine. Every domain currently runs in
one process, shares one database, and is separated by module boundaries the
architecture tests enforce rather than by network boundaries.

The question this ADR settles is not "monolith or microservices". It is: **on
what evidence does a domain stop being a module and become a service**, so that
the answer is not re-argued per team, per quarter, per incident.

The pressure to extract is real and mostly comes from feelings — a domain feels
big, a deploy feels risky, a team feels blocked. Those are all true experiences
and none of them is a measurement.

## Decision

**A domain is a module inside an existing deployable unit until it meets an
extraction criterion below. The default is not a preference; it is where the
burden of proof sits.**

Distribution is not free and the costs are not optional:

- a function call becomes a network call that can fail *partially* — succeed on
  one side and be lost on the other, which a function call cannot do
- a transaction becomes a saga, and "these two writes both happened" stops being
  something the database guarantees
- a stack trace becomes a correlation id across two log streams
- a schema change becomes a two-phase rollout across independently deployed
  units
- every consumer must now handle the producer being absent

A module boundary that is enforced — as ours is, by ownership and import rules —
buys most of what people want from a service: independent reasoning, clear
ownership, and a seam to extract along *later*. What it does not buy is
independent scaling and independent failure. Those are the only two things worth
paying the costs above for.

## Extraction criteria

A domain may be extracted when **at least one** of these is true, measured
rather than asserted, with the measurement recorded in the ADR that proposes the
extraction.

### 1. Independent scaling, demonstrated

The domain's resource profile differs from its host by **≥10×** on a dimension
that costs money, sustained over 14 days.

> Example that qualifies: Relay inference is GPU/token-bound while the rest of
> the cell is IO-bound, and scaling the cell to serve inference load would
> multiply idle web capacity.
>
> Example that does not: "search is slow." That is an index problem, and
> extracting it moves the same slow query behind a network hop.

### 2. Independent failure, required

The domain must keep serving when its host is down, or the host must keep
serving when it is down, **and that requirement is written down somewhere a
customer can point at** — an SLO, a contract, a regulatory obligation.

> Qualifies: authentication must survive an ERP-module deploy.
>
> Does not qualify: "it would be nice if a bug in reporting did not take down
> approvals." That is an argument for better tests, and extraction converts a
> loud failure into a silent degradation.

### 3. A genuinely different runtime

The domain cannot run in the host's runtime at all — a different language, a
GPU, a long-lived connection the request model cannot hold, or a compliance
boundary requiring separate compute.

> This is the least arguable criterion and the one most often true in practice.

### 4. A regulatory or contractual isolation boundary

A tenant's contract or a regulation requires the workload to run in separate
compute or a separate account. Per ADR-0007 this is a **Tenure-owned** account,
never a customer's.

### 5. Team scaling, with a specific measured cost

Two or more teams own the domain and the shared deployment is measurably
blocking them: ≥3 releases in a quarter delayed by unrelated changes, recorded
at the time, not reconstructed afterwards.

> Deliberately hardest to claim. It is the most-cited reason for extraction and
> the least often true — most "we are blocked on each other" is a merge-queue or
> test-suite problem that a network boundary does not fix and does make worse.

## What does not qualify

Stated explicitly, because each has been a real argument somewhere:

- **The domain is large.** Size is a modularity signal, not a distribution one.
  Split the module.
- **The deploy is risky.** Make the deploy safer. Extraction multiplies the
  number of deploys.
- **It would be cleaner.** A network boundary is not a design tool. It is an
  operational cost bought for an operational reason.
- **We might need to later.** The enforced module boundary is what preserves
  that option. Extracting early spends the cost before the benefit exists.
- **Another company did.** Their constraints are not ours, and they usually
  extracted after the scale, not before it.

## Extraction procedure

When a criterion is met, extraction follows this order, and each step is
reversible until the last:

1. **Publish an ADR** with the measurement, referencing this one.
2. **Harden the seam first.** All traffic to the domain goes through its
   contracts (`@tenure/contracts`) with no shared-database reads across the
   boundary. Prove it by removing the domain's tables from every other domain's
   query path.
3. **Run it in-process behind the network shape** — same contracts, async where
   the network will be async — so the failure modes appear before the network
   does.
4. **Split the data.** This is the irreversible step, and it is fourth for that
   reason.
5. **Deploy separately**, with the consumer able to degrade when it is absent.

A domain that cannot complete step 2 is not ready for step 5, and discovering
that at step 2 costs a sprint rather than a quarter.

## Current state, measured

Against the criteria above, **today, nothing qualifies.**

| Domain | Nearest criterion | Status |
|---|---|---|
| `relay` | 3 — different runtime | Not built (GE-090s). Will likely qualify when it is; inference is not a web workload. |
| `control-plane` | 2 — independent failure | **Already separate**, and correctly: the engine composes and signs for every tenant, so a cell that could run it could mint its own deployment manifests. Not an extraction — it was never one process. |
| everything else | — | None. All are modules with enforced boundaries and no measured scaling or failure requirement. |

The engine and the cell are two deployable units because of criterion 2, and
that separation predates this ADR. It is recorded here so the map is complete,
not to claim it as a decision made under these rules.

## Consequences

- Extraction proposals now need a number. That is the point.
- The architecture tests are load-bearing: they are what makes "module boundary"
  mean something and what preserves the option to extract later.
- Someone will eventually meet a criterion and be told to extract when they were
  not asking to. That is the rule working in the other direction.
- If a criterion turns out to be wrong, it is changed here, once, rather than
  argued per proposal.
