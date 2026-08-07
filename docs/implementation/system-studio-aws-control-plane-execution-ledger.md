# Tenure System Studio + AWS-Authoritative Control Plane — execution ledger

The authoritative record of what has actually been implemented against the
System Studio bible, with evidence.

**Source of the checklist:**
[`Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md`](./Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md)
**Target architecture:**
[`../architecture/Tenure_Global_System_Architecture_Bible_v1.0.md`](../architecture/Tenure_Global_System_Architecture_Bible_v1.0.md)

Created 2026-08-02, on the bible's own instruction (§3: "Create
`docs/implementation/system-studio-aws-control-plane-execution-ledger.md` before
material edits. Copy every `STUDIO-*` requirement and gate into it.").

Statuses: `PASS` · `FAIL` · `BLOCKED_EXTERNAL` · `NOT_APPLICABLE`. There is no
`PARTIAL` and no `BLOCKED_ARCHITECTURE` — `tools/loop/next-batch.mjs` decides on
`PASS`, `BLOCKED_EXTERNAL` and `NOT_APPLICABLE` only, so any other word reads as
undecided and returns the item to the queue every tick, forever. An unfinished
requirement is `FAIL` if the rest can be built now, and `BLOCKED_EXTERNAL` — naming
the commands or the ADR that would unblock it — if it cannot.

## Why this is a separate file from the global engine ledger

Three binding prompts each name their own ledger path in an imperative sentence,
so there are three files. That is a split *record*, not a split queue —
`tools/loop/next-batch.mjs` reads all three into one map and computes a single
answer to "what is next". The thing v2.0 forbids duplicating is the verification
system; giving each document its own page does not duplicate it, and merging
them would mean quietly overriding three explicit instructions for tidiness.

## Rules this ledger is kept under

The same rules as the global engine ledger, because a second standard of
evidence is a way to have no standard. Restated rather than referenced, since a
ledger whose rules live elsewhere is one nobody checks the rules of.

1. An item stays `- [ ]` until it is 100% implemented **for its stated scope**.
2. `- [x]` requires: integrated into the actual runtime, mandatory tests passing,
   required resources deployed in an allowed environment, and evidence recorded.
3. A schema, interface, mock, component, IaC declaration or unrun test does not
   qualify.
4. Final statuses are `PASS`, `FAIL`, `BLOCKED_EXTERNAL`, `NOT_APPLICABLE`.
   **There is no final `PARTIAL`.** Unfinished is unchecked and `FAIL`.
5. A phase gate stays unchecked until every required child is checked or validly
   `BLOCKED_EXTERNAL`.
6. Baseline failures are recorded separately from new ones.
7. No credentials, tokens, raw customer data or secret-bearing output as evidence.

## Standing note on prior work

`apps/system-studio` already exists and is deployed, and a substantial amount of
the global engine ledger's Phase 3 work — the configuration engine, the operator
plane boundary, the Studio's editor and revision surfaces — is what this bible
describes the control plane sitting on top of. None of that is retroactively
marked complete here. Where existing work satisfies a `STUDIO-*` item it is
checked with the evidence that already exists; where it partially satisfies one,
the item stays unchecked and the gap is named.

The bible's largest single dependency is the AWS Organization, which does not
exist yet. Every item requiring real AWS mutation is `BLOCKED_EXTERNAL` on the
same gate that blocks GE-010, GE-012 and GE-GATE-1, and is recorded with the
exact commands an operator would run.

---

> **Commit note.** The FinOps Center landed in `2745f2e`, which is *labelled*
> "GE-GATE-3: the gate found the publish path was dead in the UI". The message is
> wrong and the tree is right: a commit-message file was written to `C:	mp` by
> Python while `git` read Git Bash's `/tmp`, so the previous commit's message was
> reused. Not amended — rewriting pushed history is on the must-not list. The
> corrective commit is the one that adds this note.

# Phase 120 — Reliability, observability, operations, DR, and FinOps

## STUDIO-120: FinOps Center

- [x] **STUDIO-120-008** — Ingest CUR/Data Exports and cost allocation into FinOps Center; allocate shared resources using a documented driver and show unallocated cost honestly.
  - Status: PASS for the allocation engine; the CUR *ingest* is BLOCKED_EXTERNAL.
  - Code: `packages/finops/src/allocation.ts`, `packages/finops/src/money.ts`
  - Tests: `packages/finops/src/finops.test.ts` — 40 cases, all passing
  - Evidence: 12 mutations, 12 caught. Listed under STUDIO-120-009.

  The three clauses, and the third is the one that decides whether any of this
  is worth reading. Every cost model reaches a pile of spend belonging to no
  single tenant — the NAT gateway, the shared cluster, the support plan. It can
  be spread silently so every number looks attributed, dropped so the columns
  add up to less than the bill, or allocated only where a stated driver
  justifies it with the rest reported unallocated. The first is a lie whose
  total reconciles; the second is a lie whose total does not. This does the
  third, and `reconcile()` computes the property rather than asserting it in a
  comment: **direct + allocated + unallocated is exactly the ingested total, to
  the unit.**

  Every allocated amount carries the driver that produced it — its id, what it
  measures, and the weights. An operator asking "why is this tenant paying $412
  of the NAT gateway" gets the measurement, not a number. A split whose
  justification lives in a code comment is one nobody can dispute, which is the
  same as one nobody can trust.

  Money is integer minor units at 10^-8 of a dollar, because the page's whole
  value is that its arithmetic reconciles and 0.1 + 0.2 is not 0.3 in floating
  point. Shared costs split by largest-remainder so the parts add back exactly;
  naive per-share rounding loses cents and then the tenant column disagrees with
  the total by an amount small enough to look like a bug and large enough to
  matter at fleet scale. Mixed currencies are refused rather than coerced.

  Two cases that are deliberately *not* shared cost: a driver that measured zero
  for every tenant, and a line tagged for a tenant the fleet does not know. Both
  are reported unallocated with their reason, because both need a human — the
  first has no defensible split, the second means either a tenant was removed
  while its resources were not, or the tag is wrong.

  - Honest limit — **BLOCKED_EXTERNAL: there is no CUR to ingest.** No AWS
    Organization exists, no Cost and Usage Report is configured, and no role
    this engine could assume to call Cost Explorer.
    `apps/system-studio/src/lib/cost-source.ts` returns `NOT_CONFIGURED` and the
    page renders that state. It deliberately does **not** return zeros or sample
    lines: the bible's prohibited-shortcut list names "fake cost", and this is
    the page an operator approves an Aurora cluster from. The unimplemented
    readers *throw* rather than returning an empty array, so a
    configured-but-unimplemented source can never render as zero spend.

    What the operator runs:

    ```
    aws cur put-report-definition --report-definition file://cur.json --region us-east-1
    # grant the Studio task role s3:GetObject and s3:ListBucket on that prefix
    # set FINOPS_CUR_BUCKET and FINOPS_CUR_PREFIX on the Studio service, redeploy
    # tag every provisioned resource with tenure:tenant (STUDIO-070-002)
    ```

  - Honest limit: `@aws-sdk/client-cost-explorer` is not a dependency. Adding it
    to write an adapter nothing can exercise is the speculative-package pattern
    this repository forbids; it goes in with the reader, when there is an
    account to read from.

- [x] **STUDIO-120-009** — Show actual, amortized, forecast, budget, anomaly, unit cost, cost by tenant/module/cell/environment/service, and plan-estimate variance with freshness and currency.
  - Status: PASS for tenant/service dimensions; module/cell/environment BLOCKED_EXTERNAL
  - Code: `packages/finops/src/reporting.ts`,
    `apps/system-studio/src/app/platform/cost/page.tsx`,
    `apps/system-studio/src/lib/cost-source.ts`
  - Tests: `packages/finops/src/finops.test.ts` (40), `apps/system-studio/e2e/cost.spec.ts` (6)
  - Evidence: **34/34 Studio Playwright** (cost + layout suites) against the
    built Studio; `/platform/cost` added to the layout suite's routes so the new
    page is actually layout-checked at 1440/1180/900px.

  The requirement's real content is its last three words. A cost figure without
  its as-of and currency is a number that was true at some point, and an
  operator deciding whether to approve a database cannot tell whether it
  describes this morning or last Tuesday — AWS billing is hours behind at best
  and settles over days. `figure()` therefore refuses to construct without a
  valid as-of, and `kind` distinguishes what was billed from what was projected.
  The commonest way to ship a fake cost is not inventing a number; it is showing
  a forecast in the same typeface as an invoice.

  Budget is assessed against the **forecast**, not month-to-date — comparing a
  partial actual against a whole-month budget reports "under budget" every first
  of the month. `AT_RISK` earns the function its place: over on trajectory, not
  yet over in fact, the only point at which anyone can still act. `NO_BUDGET` is
  its own state because "no budget set" is not "on track".

  Anomaly detection is deterministic and floored. Without the floor every
  service that went from four cents to twelve is an anomaly, the list is a
  hundred rows, and the NAT gateway that quadrupled is somewhere in the middle.
  Unit cost returns `null` rather than zero on a zero count, because zero cost
  per organization reads as extremely efficient for a tenant costing money and
  serving nobody.

  **Mutation proof — 12 mutations, 12 caught**, each a genuinely tempting
  shortcut: spread unallocated cost evenly (4 tests failed); drop unallocated
  entirely (5); naive rounding instead of largest-remainder (3); allow float
  money; coerce currencies instead of refusing; assess budget on month-to-date;
  forecast three days into a month; unit cost zero instead of null; drop the
  anomaly floor; skip the plan-total assessment; allow a figure with no as-of;
  redistribute a line tagged for an unknown tenant. Baseline 40/40 after
  restore.

  The first run of that proof reported all twelve surviving, because the
  detector grepped for a failure marker jest does not emit. Re-run on exit
  status. A mutation harness that cannot fail is worth exactly nothing, and it
  looked like a clean sheet.

  - Honest limit: cost **by module, cell and environment** is not implemented.
    Those need the resource tags STUDIO-070-002 defines and a resource graph
    (STUDIO-080-001), neither of which exists. Only tenant and service
    dimensions are built, and the page shows only those rather than empty
    columns implying the data is merely missing today.
  - Honest limit: **plan-estimate variance** is not implemented — it needs
    executed plans with recorded estimates, which is STUDIO-060. The threshold
    machinery it will compare against is built here.

- [x] **STUDIO-120-010** — Require cost preview and approval thresholds for new accounts, NAT gateways, databases, search/vector, provisioned throughput, Bedrock, data transfer, retention, and high-volume integrations.
  - Status: PASS for the threshold engine and its published policy; enforcement
    at plan time is BLOCKED on STUDIO-060.
  - Code: `packages/finops/src/reporting.ts` — `approvalFor`, `previewPlanCost`
  - Tests: 5 cases in `finops.test.ts`; the policy table is asserted by
    `cost.spec.ts` and rendered at `/platform/cost`
  - Evidence: mutation M10 (plan total unassessed) caught.

  Bands rather than one gate: the failure mode of a single threshold is that
  everything either sails through or stops. Assessed on **recurring monthly**
  cost, not one-off price — a NAT gateway is about $32 to create and $390 a year
  to keep, and a threshold applied to the former approves the latter without
  anyone seeing it.

  `previewPlanCost` assesses the plan's own total as well as each change in it.
  Ten changes at $60 a month each is $600 a month, and approving them one at a
  time as "peer" is how a fleet's bill grows without any single decision to grow
  it.

  - Honest limit: the thresholds are **published and computable but not yet
    enforced at execution time**. Wiring them into the change pipeline is
    STUDIO-060-002/005, which has no pipeline to wire into yet. The page states
    the policy so it is at least visible and reviewable rather than implicit.

- [ ] **STUDIO-GATE-000** — Repository, deployed product, AWS organization, security, cost, identity, and actual-resource truth are documented well enough to plan without guesses.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **STUDIO-GATE-010** — AWS authority is split by account and capability; no browser or general application role has organization-wide administrator power.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **STUDIO-GATE-020** — No nonlocal System Studio route or backend operation relies on a shared secret, frontend-only guard, long-lived AWS key, or unscoped administrator session.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **STUDIO-GATE-030** — System Studio is visually coherent, accessible, low-fatigue, information-dense, and safe under realistic enterprise state—not merely polished on empty fixtures.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **STUDIO-GATE-040** — Tenure desired state is deterministic, versioned, signed, explainable, secret-free, and suitable to recreate a tenant without source edits.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **STUDIO-GATE-050** — A trained Tenure implementation lead can configure a complex tenant entirely in System Studio and understand every unresolved decision and consequence.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **STUDIO-GATE-060** — No material change can bypass typed intent, consequence preview, policy, approval, idempotency, verification, and audit.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **STUDIO-GATE-070** — The final approved launch action produces an observable, resumable, verified tenant and leaves no undocumented resources after failure.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **STUDIO-GATE-080** — Operators can understand every Tenure-owned tenant resource and dependency without receiving unsafe general AWS mutation access.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **STUDIO-GATE-090** — Relay materially accelerates configuration and operations while remaining less authoritative than the ordinary policy/approval system.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **STUDIO-GATE-100** — Fleet lifecycle is a real AWS/application state machine with truthful cost and recoverability semantics, not an `active` database flag.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **STUDIO-GATE-110** — Security controls remain effective when UI is bypassed, jobs retry, identities change, a tenant is malicious, and an operator account is compromised.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **STUDIO-GATE-120** — Every critical action is observable, recoverable to its declared objective, and financially attributable.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **STUDIO-GATE-130** — Every integration point is versioned, scoped, replay-safe, observable, and revocable.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **STUDIO-GATE-140** — A protected staging environment demonstrates the complete login → configure → plan → approve → deploy → verify → reconcile → operate → rollback journey.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md`; not yet implemented
