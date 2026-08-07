# Runbook — the approvals queue has stopped moving

**Objective:** a pending approval is decided within its SLA
**Owner:** `workflow` (see `docs/architecture/ownership.md`)
**Declared on:** the `approvals` module manifest, `modules/index.ts`
**Evaluated by:** `POST /api/jobs/slo` (`apps/web/src/app/api/jobs/slo/route.ts`)

## What fired

`POST /api/jobs/slo` reported `alert: true`. The response body carries one row
per institution:

```json
{
  "objective": "a pending approval is decided within its SLA",
  "target": 0.95,
  "window": "30d",
  "tenants": [
    { "institutionId": "…", "total": 41, "bad": 7, "attained": 0.829,
      "burn": 3.41, "met": false, "breaching": ["<ApprovalRequest id>", "…"] }
  ]
}
```

`burn` is the fraction of the error budget consumed: `1.0` is exactly at
target, `3.41` is over three times the failure the objective allows. `total: 0`
with `met: true` is an institution with nothing pending — quiet, not healthy,
and not a reason to close this.

## What a breach means

A measurement is one **open** approval request. It is bad when
`apps/web/src/lib/approvals-sla.ts` returns `overdue` for it — six or more
**working** days in its current gate, counted against that institution's own
business calendar, so weekends and declared closure days do not age a request.

An overdue request is not an error anywhere. Nothing throws, no page 500s, and
the only person who can see it is whoever opens `/approvals`. That is the
failure this objective exists to make visible.

## First checks, in order

1. **Is it one tenant or all of them?** `tenants[]` is per institution. Every
   tenant breaching at once points at the platform (a gate policy change, a
   deploy); one tenant points at that institution's people or calendar.
2. **Is it one gate?** Open each id in `breaching[]` at
   `/approvals/<id>`. The `ApprovalStep` trail names the gate each request is
   waiting on. A single gate across many requests is a person or a seat, not a
   system.
3. **Is the seat filled?** A gate whose decider seat is vacant blocks silently.
   Check the organization's roster (`/orgs/<slug>`) for an `ACTIVE`
   `RoleAssignment` on the deciding seat. A `SHADOW` holder cannot decide.
4. **Is a delegation expired?** `ApprovalDelegation` is effective-dated, and
   `packages/authorization/src/decide.ts` intersects a delegation with what the
   delegator still holds. A delegation that has lapsed, or a delegator who has
   lost the permission, removes the only person who could act.
5. **Is the calendar wrong?** `platform.localization.workingDays` and
   `platform.localization.holidays` resolve per tenant. A calendar declaring
   too few working days ages requests faster than people can work them, and
   that shows up as a whole-tenant breach with no stuck gate behind it.

## Mitigation

- A vacant seat: assign it, or reassign the pending requests
  (`approvals.request.assign`).
- A lapsed delegation: re-issue it, or have the delegator decide directly.
- A wrong calendar: correct the binding in `blueprints/`; the SLA recomputes on
  the next run, and past breaches stay recorded — this is a measurement, not a
  ledger, and re-deciding history is not a mitigation.
- Genuine volume: the objective is not met and the answer is people, not a
  config change. Say so; suppressing the alert makes the queue invisible again,
  which is the state this replaced.

## What this runbook does NOT cover

The other eleven modules still declare `observability-slo-and-finops` as a gap
in `modules/index.ts`, and they still are one. There is no SLO on roster
availability, message delivery latency, or feed delivery, and no per-module cost
attribution anywhere. Do not read this document as evidence that those exist.
