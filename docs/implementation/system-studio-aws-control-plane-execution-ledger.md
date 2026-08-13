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

- [ ] **STUDIO-060-003** — Render a human-readable and machine-readable diff for app config, data/schema, IAM/security, AWS resources, domains, integrations, Relay, cost, operations, and rollback.
  - Status: FAIL
  - Reason: **three of the ten domains** are implemented. Data/schema, IAM/security,
    domains, integrations, Relay, operations and rollback still have no producer
    and are therefore ABSENT from the enum rather than emitted as empty
    sections — an empty `integrations` array reads as "nothing changed in
    integrations", which is the opposite of "this product does not compute
    that". The item stays FAIL because the rest can be built now (a
    schema-migration diff and a rollback diff both have their inputs in this
    repository today), not because anything external blocks it.
  - What landed, and is proven:
    - The machine-readable form is now the PRIMARY one and the string is derived
      from it. `ChangeDiff` + `parseChangeDiff` in `packages/contracts/src/index.ts`,
      published as `docs/contracts/change-diff.schema.json`.
    - `apps/system-studio/src/lib/revisions.ts` — `configurationChangeDiff`
      produces the document, `renderComparison` now takes it. Production caller:
      `apps/system-studio/src/app/tenants/[slug]/configuration/page.tsx`, which
      renders both the sentence and the JSON.
    - The AWS-resource arm: `resourceChangeDiff` and `irreversibleEntries` in
      `apps/system-studio/src/lib/aws/drift.ts`, over the live inventory from
      STUDIO-080-001. `effect` and `reversible` come from what the resource IS —
      `EstateResource.contract.stateful`, decided in `inventory.ts`. Rendered at
      `apps/system-studio/src/app/platform/estate/page.tsx`, which REFUSES to
      offer a reconcile action for an irreversible deletion.
    - The cost arm: `assessPlanCost` in `apps/system-studio/src/lib/cost-report.ts`
      populates `monthlyCostDeltaMinor` and drives `previewPlanCost`. This is the
      pipeline STUDIO-120-010 was recorded as having none of — the threshold
      policy at `/platform/cost` now has a number to assess.
    - `null` and `0` stay different answers throughout: "not priced" must never
      reach an approval threshold as "free".
  - Tests: 33 in `apps/system-studio/e2e/revisions-logic.spec.ts`, run with
    `npx playwright test revisions-logic`.
  - Evidence: 4 mutations, 4 caught. M1 `resourceChangeDiff` skips every
    unmanaged resource → 7 red. M2 `renderComparison` drops the aws-resource
    entries → 3 red (and the document assertions stay green, which is what
    proves the string is derived). M3 every delete marked reversible → 3 red,
    including the refusal the estate page branches on. M9 `estimateMonthlyMinor`
    returns 0 instead of null for an unpriced type → 1 red. All restored, 33/33.

- [ ] **STUDIO-130-001** — Publish versioned control-plane OpenAPI/AsyncAPI/JSON Schema contracts for tenants, manifests, plans, approvals, executions, resources, releases, lifecycle, evidence, cost, and drift.
  - Status: FAIL
  - Reason: **three of the eleven shapes** are published, and there is still no
    OpenAPI or AsyncAPI document anywhere in the repository. Tenants, manifests,
    plans, approvals, executions, releases, lifecycle and evidence exist as
    TypeScript interfaces inside app code — `TenantRecord` at
    `apps/system-studio/src/lib/registry.ts`, the execution record in
    `packages/provisioning/src/execute.ts` — which the contracts package's own
    header explains constrains nothing at a module boundary. FAIL rather than
    BLOCKED_EXTERNAL: every one of those has a producer in this repository and
    can be contracted now.
  - What landed, and is proven:
    - `parseEstateResource`, `parseCostFigure`, `parseDriftFinding` (and
      `parseChangeDiff`) in `packages/contracts/src/index.ts`, each carrying an
      explicit `schemaVersion` and each refusing an unknown MAJOR while accepting
      an unknown MINOR. This is the first version field on any shape in the
      package.
    - The parsers RUN the schema rather than restating it:
      `CONTROL_PLANE_SCHEMAS` is the single source, and
      `tools/contract-schemas.mjs` (wired into `npm run generate`) writes
      `docs/contracts/*.schema.json` from it.
    - Production caller, in the same change:
      `apps/system-studio/src/lib/aws/inventory.ts` parses every mapped resource
      through `parseEstateResource` inside the `readAws` wrapper, so an adapter
      emitting a malformed resource makes the surface ERROR instead of rendering
      the row. `apps/system-studio/src/lib/cost-report.ts` parses every plan
      figure through `parseCostFigure`.
    - `docs/contracts/conformance-fixtures.json` is one accept/reject table read
      by both suites — the schema suite and the parser suite — so a schema that
      admits what the parser refuses cannot pass both.
  - Tests: `tests/architecture/contracts-schemas-match-parsers.test.mjs` (5) and
    `packages/contracts/src/contracts.test.ts` (98 total in that file), run with
    `node --test tests/architecture/contracts-schemas-match-parsers.test.mjs`
    and `npx jest --ci contracts.test`.
  - Evidence: 4 mutations, 4 caught. M4 `arn` removed from the EstateResource
    required list → schema-match red + 1 parser fixture red. M7 the `arn` pattern
    relaxed → schema-match red. M8 `inventory.ts` stops parsing at the boundary →
    the adapter rejection case red. M10 the major-version check disabled → 2
    parser tests red. All restored; 5/5 and 98/98.

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

---

## STUDIO-000 / 010 / 070 / 080 / 110 / 140 — the live AWS read plane

One session, one file area: `apps/system-studio/src/lib/aws/`. These items were
transcribed separately and are one piece of work, because they share a single
decision — that a read which was REFUSED and a read which found NOTHING must be
different values before they are different pixels.

### What was actually wrong

The Studio had never issued a non-DynamoDB AWS call. `apps/system-studio/package.json`
declared two AWS packages, `lib/registry.ts` held the only client, and everything
the console said about the estate came from `src/generated/platform-truth.json`,
compiled by `tools/platform-truth.mjs` out of a snapshot a workflow wrote by
shelling out to the `aws` CLI. The snapshot's collector made the defect
structural: `tools/aws-inventory.mjs`'s `aws()` returned `null` on any failure and
its `list()` turned `null` into `[]`, so a denied `cloudwatch:DescribeAlarms`
produced an empty alarm list, and `/platform` rendered it as no alarms. The
console could not tell an estate with nothing in it from a role that was not
allowed to look — and since `infrastructure/studio/iam.tf` gave the task role no
policy at all, "not allowed to look" was going to be the default on day one.

- [x] **STUDIO-000-007** — Treat denied API calls as unknown, not absent. Record principal, action, error, account/region, and minimum read permission.
  - Reading: a denied AWS call is rendered as UNKNOWN — with principal, action,
    error code, account/region and the minimum IAM statement — never as an empty
    list. That is this ledger's restatement of the Bible clause above, not a
    second requirement; the Bible's wording is the one on the entry line because
    a requirement stated twice must be stated identically.
  - Status: PASS
  - Code: `apps/system-studio/src/lib/aws/read.ts` (the `AwsRead<T>` union and
    `readAws`), `apps/system-studio/src/lib/aws/capabilities.ts`
    (`minimumStatement`), `apps/system-studio/src/components/states.tsx`
    (`UnknownState`, `AwsReadPanel`), `infrastructure/studio/iam.tf`
    (`estate-read`), `tools/aws-inventory.mjs`
  - Tests: `apps/system-studio/e2e/aws-unknown-is-not-absent.spec.ts` (27 cases),
    `apps/system-studio/e2e/states-logic.spec.ts` (exact-vocabulary assertion
    raised to fourteen)
  - Evidence: 13 producer mutations applied, 13 caught. Table at the end of this
    section.

  The union has no arm carrying an optional `T`, and `DENIED` has no `value`
  field at all, so a caller that reaches for `read.value` without narrowing does
  not compile. That is the whole mechanism: the discipline is in the type rather
  than in everyone remembering. `readAws` is the only function that turns an
  exception into a rendered state, and there is no path in it from a thrown error
  to `EMPTY` — `EMPTY` is returned only after `run()` resolved.

  `UnknownState` REQUIRES `principal`, `action` and `minimumStatement`. An
  unknown cannot be rendered without them, which is what stops it degrading into
  an empty state with a different colour. It is a fourteenth state rather than a
  reuse of `permissionDenied`: that one deliberately takes no identifier, because
  naming what a HUMAN was refused confirms the thing exists to somebody who may
  not be entitled to know. This is Tenure's own task role read by Tenure's own
  operators, and the resource's existence is exactly what they came for.

  The IAM half is a separate `aws_iam_role_policy` named `estate-read`, so a
  partial grant is a visible diff rather than six lines lost inside a policy
  about something else.

- [x] **STUDIO-000-006** — Inventory Tenure-controlled AWS Organization, organizational units, accounts, regions, partitions, Control Tower enrollment/baselines, IAM Identity Center, identity providers, roles, permission boundaries, SCPs, resource policies, KMS, CloudTrail, Config, Security Hub, GuardDuty, Inspector, Macie, Detective if present, log archives, backups, budgets, and support contacts.
  - Reading: a live AWS account / organization / identity inventory. The short
    form is this ledger's shorthand for the Bible clause above and nothing more;
    the clause itself is what the entry line states, because the Bible is the
    authority on wording.
  - Status: PASS for identity and organization. The wider list in the item's
    title — Control Tower, SSO/Identity Store, permission boundaries, SCPs,
    resource policies, GuardDuty, Inspector, Macie, Detective, Budgets, Support —
    is NOT read and is not claimed.
  - Code: `apps/system-studio/src/lib/aws/identity.ts`,
    `apps/system-studio/src/lib/aws/organization.ts`,
    `apps/system-studio/src/lib/aws/client.ts`,
    `apps/system-studio/src/app/platform/estate/page.tsx`,
    `apps/system-studio/src/lib/cells.ts`
  - Tests: `aws-unknown-is-not-absent.spec.ts` section 1,
    `tests/security/no-hardcoded-estate.test.mjs` (the cells.ts exemption is
    DELETED)
  - Evidence: mutations M1 and M11, both caught.

  `partition` is parsed from the ARN's second segment and `region` is read off
  the SDK's resolved config. Neither is ever a literal. The proof that this is
  real rather than decorative is the deletion: `apps/system-studio/src/lib/cells.ts`
  is no longer on `no-hardcoded-estate`'s exemption list, because it no longer
  has anything to exempt. The three defaults are gone, replaced by `estateFact()`,
  which reads the environment, then the resolved identity, and then refuses.

  `fleet()` stays synchronous — it is called from `placementFor`, three pages and
  `lib/adopt.ts` — so `primeEstate()` resolves the identity once per process and
  the three pages that render fleet facts await it before the first synchronous
  read. The CI job that runs the Studio has DynamoDB-Local-shaped credentials
  that cannot reach STS, so it now supplies `AWS_ACCOUNT_ID` and `AWS_PARTITION`
  explicitly; that is the honest consequence of removing the defaults rather than
  a workaround for it.

- [x] **STUDIO-070-004** — Implement service adapters behind typed capabilities; no arbitrary service/action/parameter endpoint and no operator-supplied IAM JSON bypass.
  - Status: PASS
  - Code: `apps/system-studio/src/lib/aws/capabilities.ts`,
    `apps/system-studio/src/lib/aws/client.ts`,
    `tests/architecture/forbidden-clients.test.mjs` (OWNERS entry + proof row)
  - Tests: `tests/architecture/forbidden-clients.test.mjs`,
    `tests/security/studio-task-role-is-narrow.test.mjs`
  - Evidence: the ownership-proof row pairs `client.ts` with a regex for
    `new STSClient(`, so deleting the adapter reds the suite rather than quietly
    re-opening every page's right to build its own client. `AWS_EXEMPT` is
    untouched and still asserted empty.

  `gateway().call()` takes a `Capability` from a closed union and switches on it.
  There is deliberately no way to express "send this arbitrary command": an
  endpoint taking a service and an action would make whatever the task role holds
  reachable from a browser, and no reader of the file could say what the console
  is able to do. Every client is constructed with an empty config — no
  credentials argument, no region literal — so moving account or partition is an
  environment change rather than a code change.

  Cadence is per surface and named: ECS 15s, RDS 120s, ACM 1h, Cost Explorer 6h.
  One global TTL is either a stale console or a bill.

- [ ] **STUDIO-GATE-010 (partial work, gate NOT claimed)** — AWS authority split by account and capability; no browser or general application role has organization-wide administrator power.
  - Status: FAIL. The gate stays closed and this entry records only what moved.
    The half that is done is the ASSERTION — the task role is now provably a
    reader. The half that is not is the SPLIT itself: there is one account, so
    there is no separation of authority to verify, and STUDIO-010-008 is FAIL
    besides. Marking the gate PASS off a guard over a single account would be
    exactly the reassuring answer this whole session exists to stop printing.
  - Code: `infrastructure/studio/iam.tf`,
    `apps/system-studio/src/lib/aws/identity.ts`,
    `apps/system-studio/src/lib/aws/topology.ts`,
    `.github/workflows/debug-logs.yml`
  - Tests: `tests/security/studio-task-role-is-narrow.test.mjs`
  - Evidence: `node --test tests/security/studio-task-role-is-narrow.test.mjs`
    — 5/5 passing. 2 mutations applied, 2 caught (M12, M13 below).
  - Incremental evidence: `debug-logs.yml` is now armed for
    `Tenurework/Tenure-Parent`, assumes `vars.AWS_READ_ROLE_ARN` through the
    `aws-read` environment, and dumps only read-side Studio ECS service state,
    stopped-task reasons and log tails. It no longer uses the shared
    `ACCESSKEYID` / `SECRETACCESSKEY` pair and no longer targets the pilot
    cluster.

  The fifth assertion is the one that earns the file. A guard that only forbids
  excess is satisfied by an EMPTY policy, and an empty policy is how every estate
  surface renders UNKNOWN in production while the suite stays green. So it checks
  the other direction too: every `iamActions` entry in `capabilities.ts` must
  actually be granted. It found two on its first run —
  `secretsmanager:DescribeSecret` and `ssm:DescribeParameters` — declared by the
  code and granted nowhere.

- [x] **STUDIO-010-002** — Keep day-to-day application workloads out of the Organizations management account.
  - Reading: checked rather than assumed. The Bible states the rule; the thing
    this entry adds is that the console verifies it against a live read instead
    of taking it on trust, and that belongs here rather than in the statement.
  - Status: PASS
  - Code: `apps/system-studio/src/lib/aws/posture.ts` (`managementAccountVerdict`),
    `apps/system-studio/src/lib/aws/organization.ts`
  - Tests: `aws-unknown-is-not-absent.spec.ts` section 6 — four stand-in
    Organizations clients, four verdicts, four different sentences
  - Evidence: mutation M7.

  Four-valued on purpose. `AWSOrganizationsNotInUseException` is an ANSWER — the
  one case where an error is information — and it maps to `NO_ORGANIZATION`, not
  `UNKNOWN`. `AccessDenied` maps to `UNKNOWN` and never to `SEPARATED`, because
  printing "workloads are separated" off a call nobody was allowed to make is the
  STUDIO-000-007 failure with a security label on it. The verdict is also UNKNOWN
  when identity is unresolved: a comparison between one known and one unknown
  account id is a guess wearing a verdict's clothes.

- [x] **STUDIO-010-001** — Separate AWS Organization management, Control Tower/log archive, security/audit, identity/shared services, network/edge, control-plane production, control-plane nonproduction, tooling/build, regional cells, dedicated tenants, backup/DR, and sandbox accounts as justified by actual scale.
  - Reading: the account topology is declared and reconciled against a live
    read. "As justified by actual scale" is the clause that makes a
    single-account estate a legitimate answer rather than a failure, which is
    why the status below reports `SINGLE_ACCOUNT` instead of compliance.
  - Status: PASS for the declaration, the reconciliation and the removal of the
    hardcoded estate. The twelve roles cannot be FILLED in a single-account
    estate, and that is reported as `SINGLE_ACCOUNT` rather than as compliance.
  - Code: `apps/system-studio/src/lib/aws/topology.ts`,
    `apps/system-studio/src/lib/aws/organization.ts`,
    `apps/system-studio/src/lib/cells.ts`,
    `apps/system-studio/src/app/platform/estate/page.tsx`
  - Tests: `aws-unknown-is-not-absent.spec.ts` section 6
  - Evidence: mutation M11 — restoring the `us-east-1` literal to `cells.ts` reds
    `no-hardcoded-estate`, which the deleted exemption had been hiding.

  `requiredWhen` is a function of estate scale rather than a boolean, because
  "you should have a separate log-archive account" is true of a regulated
  multi-tenant fleet and false of a pilot with one ECS service, and a checklist
  that is wrong for the estate in front of you is a checklist people mute. When
  the Organization read failed, EVERY row is UNKNOWN — reporting eleven missing
  accounts because a permission is absent is how an operator spends a morning
  creating accounts that already exist.

- [ ] **STUDIO-010-008** — Centralize organization trails, Config aggregation, security findings, log immutability, backup policy, cost/CUR data, and incident evidence.
  - Status: FAIL — three of seven clauses.
  - Done: organization trail (CloudTrail DescribeTrails, with
    `IsOrganizationTrail` / `IsMultiRegionTrail` / `LogFileValidationEnabled`),
    Config aggregation, and the Cost and Usage Report definition.
  - Not done and not claimed: log immutability (S3 Object Lock on the trail
    bucket), backup policy (`backup:ListBackupPlans` +
    `GetBackupVaultAccessPolicy`), Security Hub's finding-aggregator state, and
    centralized incident evidence. No row is rendered for them, so the page does
    not imply they were checked. The fourth of those was invisible until this
    entry's statement was restored to the Bible's wording: the ledger's own
    paraphrase named six clauses and dropped "incident evidence", so the
    denominator said six and the missing clause was not counted as missing.
  - Code: `apps/system-studio/src/lib/aws/posture.ts` (`centralizationPosture`,
    `curExistence`)
  - Tests: `aws-unknown-is-not-absent.spec.ts` section 5
  - Evidence: mutation M6.

  `rowFor()` is the mapping, in one place, so no clause can decide for itself that
  a denial means "absent" — the only branch that can produce a verdict other than
  UNKNOWN is `whenActual`, and it is never called for a failed read.

- [x] **STUDIO-080-008** — Never render a green alarm solely because no data is present. Distinguish `OK`, `ALARM`, `INSUFFICIENT_DATA`, disabled, stale, missing, and unauthorized.
  - Reading: alarm semantics, seven verdicts rather than three. The seven are
    the seven the Bible enumerates on the entry line, which is why that line now
    carries them rather than the count.
  - Status: PASS
  - Code: `apps/system-studio/src/lib/aws/alarms.ts`,
    `apps/system-studio/src/lib/aws/expected-alarms.ts`,
    `apps/system-studio/src/app/platform/health/page.tsx`,
    `tools/aws-inventory.mjs`, `apps/system-studio/src/app/platform/page.tsx`
  - Tests: `aws-unknown-is-not-absent.spec.ts` section 3 — five behaviours, five
    different strings
  - Evidence: mutations M3 and M4.

  `DISABLED` outranks `OK` and is checked first: an alarm whose actions are off
  notifies nobody however green it reads, and printing OK for it is the most
  reassuring thing this page could get wrong. `MISSING` is produced ONLY after a
  successful response, so "not created" can never describe an estate nobody was
  allowed to look at — and the expected set is parsed out of
  `infrastructure/terraform/cloudwatch.tf` rather than typed into the module, so
  it is falsifiable. The collector was fixed in the same change: it carries
  `actionsEnabled` and `stateUpdatedTimestamp`, reads composite alarms, and
  records `alarmsUnavailable` so a denial no longer arrives downstream as `[]`.

- [ ] **STUDIO-110-006** — Aggregate Security Hub/GuardDuty/Inspector/Macie/Config/Access Analyzer findings with dedupe, severity, affected tenants, SLA, ownership, suppression justification/expiry, and remediation workflow.
  - Status: FAIL — the READ half is complete and proven; suppression and the
    remediation workflow are not built.
  - Done: Security Hub GetFindings, dedupe on id + ProductArn + resource ids,
    severity from the product's own label, tenant attribution through the
    `tenure:tenant` tag with untagged resources marked shared rather than
    dropped, SLA by severity band against `FirstObservedAt`, and the per-source
    state array.
  - Not done: suppression with justification and expiry, which is a WRITE and
    belongs on the typed-mutation surface (STUDIO-080-004) that does not exist
    yet. A suppression written without an audit row before the act would be worse
    than no suppression.
  - Code: `apps/system-studio/src/lib/aws/findings.ts`,
    `apps/system-studio/src/app/platform/security/page.tsx`
  - Tests: `aws-unknown-is-not-absent.spec.ts` section 4
  - Evidence: mutation M5.

  The `sources` array is the point. With six products behind one aggregator, an
  empty findings list is meaningless on its own — it could be a clean estate,
  five products switched off, or a role that cannot call GetFindings. The page
  never renders findings without also rendering, per product, which of those it
  is; and when the read was DENIED the findings table is not rendered at all,
  because an empty table under a heading saying "Open findings" is read as "there
  are none".

- [x] **STUDIO-080-003** — Add safe deep links to AWS Console only for authorized break-glass/platform engineers; never depend on them for normal operation.
  - Status: PASS
  - Code: `apps/system-studio/src/lib/aws/console-link.ts`,
    `apps/system-studio/src/app/platform/estate/page.tsx`
  - Tests: `aws-unknown-is-not-absent.spec.ts` section 7
  - Evidence: mutation M8, caught by the GovCloud case.

  The host comes from the resolved partition, and an unknown partition gets
  `null` rather than a guessed URL. A link pointing at the commercial console for
  an `aws-us-gov` resource invites an operator to look for it in the wrong
  jurisdiction, conclude it does not exist, and act on that — the GE-010-007
  residency defect in miniature. Gated on `mayAct(role, "aws.console:read")`,
  which STUDIO-020-005 gives to the Cloud Platform Engineer and the Emergency
  Responder only, and rendered with `consoleCaveat()` — an exported sentence
  rather than page copy, so it cannot be dropped from one call site.

- [x] **STUDIO-140-007** — Prove read-only actual state differs from access denied, missing, stale, and error in both API and UI.
  - Status: PASS for the type and the UI half. The HTTP half is
    `apps/system-studio/src/app/api/aws/[surface]/route.ts`, built under
    STUDIO-130-002 in the same session over the same directory.
  - Code: `apps/system-studio/src/lib/aws/read.ts`
  - Tests: `apps/system-studio/e2e/aws-unknown-is-not-absent.spec.ts`
  - Evidence: this item IS the proof, so the spec is the deliverable. Every case
    drives the PRODUCTION entry point the page calls — `estateInventory`,
    `alarmSurface`, `securityFindings`, `centralizationPosture`,
    `resolveIdentity` — with a stand-in substituted at the `client.ts` seam. A
    suite that exercised `readAws` directly would stay green the day a surface
    stopped calling it, which is why none of the mutations below touch it.

### Mutations applied, and what each proved

Every one was applied to the PRODUCER, run, confirmed red, restored, and
confirmed green.

| # | Mutation | Result |
|---|----------|--------|
| M1 | `identity.ts` returns partition `aws` regardless of the ARN | RED, the GovCloud case; green on restore |
| M2 | `inventory.ts` catches AccessDenied and returns an empty array | RED, denied and empty stopped differing; green on restore |
| M3 | `alarms.ts` skips its DENIED branch and falls through to a list | RED, five behaviours collapsed to four strings; green on restore |
| M4 | `alarms.ts` ignores `ActionsEnabled` | RED, a disabled alarm read as OK; green on restore |
| M5 | `findings.ts` drops `ProductArn` from the dedupe key | RED, two products' findings merged into one; green on restore |
| M6 | `posture.ts` maps a denial to `ABSENT` | RED, the fourth clause verdict; green on restore |
| M7 | `posture.ts` returns `SEPARATED` when the org read is UNKNOWN | RED, the reassuring answer to a question nobody could ask; green on restore |
| M8 | `console-link.ts` hardcodes the commercial console host | RED, the GovCloud host; green on restore |
| M9 | `drift.ts` lets an unknown reading fall into the missing path | RED, a remediation plan built on a blind read; green on restore |
| M10 | `states.tsx` drops `unknown` from `STATE_KINDS` | RED, the exact-vocabulary assertion; green on restore |
| M11 | `cells.ts` restored to the `us-east-1` default | RED, `no-hardcoded-estate`, which the deleted exemption had been hiding; green on restore |
| M12 | `iam.tf` grants `ecs:UpdateService` | RED, the read-verb assertion; green on restore |
| M13 | `iam.tf` grants a wildcard action | RED, three assertions at once; green on restore |
| M14 | the tenant page stops calling `compareDesiredToActual` | RED, the wiring assertion; green on restore |
| M15 | the tenant page passes one flattened reading instead of four | RED, the readings assertion; green on restore |
| M16 | the estate page gates the console link on `isOperator` rather than the break-glass grant | RED; green on restore |
| M17 | the health page stops passing the expected alarm set, making MISSING unreachable | RED; green on restore |

### What is NOT closed, and is not claimed

- **STUDIO-080-007 (orphan detection)** — FAIL. Four of its inputs now exist: the
  live inventory, the tag index, `registry.listTenants()`, and the `AwsRead`
  union that lets a denied input produce `unknown` rather than "no orphans". The
  module and the IaC-managed-ARN manifest do not. The hand-written "Queues with
  no producer and no consumer" section on `/platform` is therefore LEFT IN PLACE:
  deleting a real finding a person made, before there is a computed one to
  replace it, loses information rather than gaining it.
- **STUDIO-080-004 (typed operation catalogue)** — FAIL. Everything built in this
  session is a read; nothing here can mutate AWS. That is the correct interim
  state and it is not the item.
- **STUDIO-100-005 (observed retention and residual charge)** — FAIL.
  `rds:DescribeDBSnapshots`, `logs:DescribeLogGroups`, `backup:*`,
  `kms:ListKeys`, `route53:ListHostedZones` and `s3:ListObjectVersions` are
  declared as capabilities, granted in `estate-read` and wired into `client.ts`,
  so the reads are available — but `lib/aws/retained.ts` is not written and
  `residualFindings` still takes the four registry booleans. When it is built,
  the observation must be a REQUIRED third parameter and not an optional field on
  `ObservedTenantResources`: that type has one construction site,
  `tenants/[slug]/page.tsx`, and an optional field a caller does not set is
  invisible to `tsc` — it would keep reporting "nothing unexplained", which is
  the answer an operator most wants to be true.
  - Incremental evidence 2026-08-11: `apps/system-studio/src/lib/aws/retained.ts`
    now reads tenant-attributed retained resources through the existing
    read-only AWS gateway: Resource Groups Tagging API attribution, RDS
    snapshots, CloudWatch log groups and AWS Backup recovery points. The tenant
    State panel passes that live retained observation as a required input to
    `residualFindings`, renders retained source rows, and renders denied/error
    reads as unobserved rather than as absence. `aws-unknown-is-not-absent.spec.ts`
    proves populated retained reads map into residual classes and an
    `AccessDeniedException` does not become "none"; `states-logic.spec.ts`
    proves the residual API still requires an explicit retained observation.
    Remaining work: real residual dollar calculation, S3 object-version bucket
    scoping, KMS key tag reads, DNS/Route 53 retained-control treatment,
    archive/legal-hold bytes, and closure proof for purge/offboarding.
- **STUDIO-080-006 (drift)** — the comparison, severity scale, ownership, safe
  remediation, ignore-with-required-expiry and recurrence counter are built,
  wired and proven (M9, M14, M15). `compareDesiredToActual` had NO production
  caller when it was first written — the "correct code, zero effect" failure —
  and `apps/system-studio/src/app/tenants/[slug]/page.tsx` now composes it from
  `desiredFromDeployment(tenant.deployment)` and the four live readings
  `estateInventory()` returns. The readings are passed as the union, not
  flattened: M15 proves that flattening reds, because a flattened denial reads as
  "no resources" and the report would then offer a plan to recreate every desired
  resource. What is NOT wired is the ignore RECORD's writer — `ignoreItem()`
  produces the registry row and no server action calls it, so an ignore cannot
  yet be created from the console.

---

## STUDIO-020-005 / STUDIO-020-006 — operator role families and semantic permissions

One session, one file area: `apps/system-studio/src/lib/operators.ts` and the
nine call sites that used it. The two items are one piece of work because
STUDIO-020-006's decision has nothing to decide about until STUDIO-020-005's
families exist, and the families gate nothing until a decision consults them.

### What was actually wrong

`isOperator(email)` was the Studio's ENTIRE server-side authorization: a
membership test against a comma-separated environment allowlist, repeated
verbatim at nine places —

    src/app/page.tsx:55                        src/app/tenants/[slug]/page.tsx:113
    src/app/platform/page.tsx:38               src/app/tenants/[slug]/configuration/page.tsx:74
    src/app/platform/cost/page.tsx:40          src/app/tenants/actions.ts:67
    src/app/tenants/page.tsx:34                src/app/tenants/[slug]/configuration/actions.ts:57
    src/app/tenants/new/page.tsx:58

No resource, no action, no environment, no account and no region entered any
decision. Every listed operator could advance any tenant's lifecycle and publish
any tenant's configuration; a Support Engineer and a Platform Super Admin saw
byte-identical markup, including every mutating control on every tenant.

- [x] **STUDIO-020-005** — Implement operator role families: Platform Super Admin, Tenant Implementation Lead, Cloud Platform Engineer, Security Administrator, Release Manager, Support Engineer, FinOps Analyst, Auditor/Read Only, and Emergency Responder.
  - Status: PASS
  - Code: `apps/system-studio/src/lib/operators.ts` — `OPERATOR_ROLES` (the nine,
    in the bible's order), `OPERATOR_RESOURCES`, `OPERATOR_VERBS`,
    `OPERATOR_GRANTS` (the whole model in one reviewable table), `roleOf`,
    `mayView`, `mayAct`. `isOperator` is kept as exactly `roleOf(...) !== null`,
    so no existing call site changed meaning.
  - Grammar: `PLATFORM_OPERATORS` is now `email:role,email:role`. An entry with
    no role, an unknown role, or one address listed twice is REFUSED at
    `operatorConfigProblems` — never defaulted. A silent default is how everybody
    ends up an administrator.
  - **Operator action required before the next Studio deploy.** This is a
    breaking configuration change on purpose. The `PLATFORM_OPERATORS`
    repository secret still carries bare addresses; until it is rewritten to the
    `email:role` form the console renders "Not configured" and prints the exact
    rewrite. Fail-closed is the specified behaviour — the alternative is a silent
    promotion of every operator to Super Admin. `.github/workflows/ci.yml`'s
    `studio-e2e` env is already on the new grammar and carries five families.
  - Surfaces that now differ, and their callers:
    - `cost:read` — FinOps Analyst, Auditor, Super Admin only.
      `src/app/platform/cost/page.tsx` refuses everyone else with
      `PermissionDeniedState`.
    - `tenant:write` — the compose link and the adopt form on
      `src/app/tenants/page.tsx` are not rendered without it, and
      `src/app/tenants/new/page.tsx` refuses direct navigation.
    - `tenant.lifecycle:write` — `AdvanceControls` on
      `src/app/tenants/[slug]/page.tsx` is absent (not disabled) without it.
    - `tenant.configuration:write` — `ConfigurationEditor` and
      `RollbackControls` on `src/app/tenants/[slug]/configuration/page.tsx` are
      absent without it.
    - `aws.console:read` — STUDIO-080-003's deep links, rendered on the tenant
      page for the Cloud Platform Engineer and the Emergency Responder only.
      `aws.console:break-glass` is narrower still: the Emergency Responder alone.
  - Tests: `apps/system-studio/e2e/authorize-logic.spec.ts` (36 cases, pure — no
    browser) and `apps/system-studio/e2e/operator-roles.spec.ts` (browser; signs
    in as four different families through the real form).
  - Mutations proven (each applied, run, confirmed red, restored, confirmed green):
    - `mayAct` → `return true`: **11 red** of 34, including "the Auditor holds
      reads and nothing else" and "an Auditor may read the fleet and may change
      nothing in it". Restored: 34 pass.
    - a role-less `PLATFORM_OPERATORS` entry silently becoming
      `platform-super-admin` instead of a problem: **3 red**, including "an entry
      with no role is refused, not defaulted". Restored: 34 pass.

- [x] **STUDIO-020-006** — Define semantic permissions by resource/action/environment/tenant/account/region and enforce them server-side at every command, query, job, websocket/subscription, export, and evidence read.
  - Status: PASS for every command, query and page this console has. The
    websocket/subscription and export halves are not applicable today — the
    Studio has neither; when either lands it goes through `authorizeCommand`
    like everything else, and `STUDIO_COMMANDS` is where its entry belongs.
  - Code: `apps/system-studio/src/lib/authorize.ts` — `authorizeOperator`
    (deny by default, returning `{allowed, reason, policyRevision, role,
    permission, scope}`), `STUDIO_COMMANDS` (one entry per page read and per
    server action), `authorizeCommand`, `controlPlaneIdentity`, `decisionLine`.
  - Callers — all nine of the sites listed above, plus the two
    already-authorizing consumers written alongside it:
    `src/lib/command-gate.ts` calls `authorizeCommand` for the execution-time
    gate, and both server-action modules log `decisionLine` for every allow and
    every deny (STUDIO-020-012's line; its append-only destination is a separate
    item).
  - The residency axis: a decision naming an account or region that
    `controlPlaneIdentity()` did not resolve is refused —
    `ACCOUNT_OUT_OF_SCOPE` / `REGION_OUT_OF_SCOPE`, and `ESTATE_UNRESOLVED` when
    this process cannot corroborate a target at all. There is no fallback
    literal, so "we checked and it matched" and "we could not check" are
    different answers; `tests/security/no-hardcoded-estate.test.mjs` passes with
    `authorize.ts` NOT on its exemption list. `advanceState` and the tenant page
    pass the tenant's own `placement.region` and the placed cell's
    `awsAccountId`, so the axis carries a real value rather than a copy of the
    process's own.
  - `accountId` and `region` on the request are REQUIRED and NULLABLE rather than
    optional. An optional axis a caller forgets is invisible to `tsc`; required
    means every one of the nine call sites had to state something, and `null` is
    a statement.
  - `policyRevision` is derived from `OPERATOR_GRANTS` by `policyRevisionOf`, not
    written down, and the spec asserts on the value the DECISION emits — the
    frozen-constant failure this platform has already shipped once.
  - Tests: `apps/system-studio/e2e/authorize-logic.spec.ts`. Every value in
    `AUTHORIZATION_REASONS` is asserted to be produced by a real request, so a
    deny reason with no code path (the architecture's `MEMBERSHIP_SUSPENDED`)
    cannot be added here.
  - Mutations proven (applied, run, red, restored, green):
    - `authorizeOperator` returning `allowed: true` unconditionally: **15 red**,
      the whole "denies by default" describe plus every command assertion.
    - `STUDIO_COMMANDS["configuration.publish"].action` demoted `write` to `read`
      — the production table both actions read: **3 red**, including "a Support
      Engineer may review a configuration change and not publish it".
    - the region residency check deleted: **3 red**, including "a command aimed
      at another region is refused however senior the caller" and the
      reason-reachability assertion.
    - `POLICY_REVISION` frozen to `"op-00000001"`: **2 red**.
  - Guard detector: `tools/entry-point-inventory.mjs`'s `operator` pattern now
    also matches `authorizeCommand` / `authorizedOperator` / `authorizeOperator`.
    Without it, nine paths that got strictly STRONGER would have read to
    `tests/security/every-path-authorizes.test.mjs` as paths that had lost their
    guard — the same regression the `decideFinanceAction` comment beside it
    records. `UNAUTHORIZED_MUTATORS` is unchanged at 25 and the suite passes.

### What was deliberately NOT done

- **`GrantScope` in `packages/authorization/src/model.ts` was not widened.** The
  requirement offers it conditionally ("if GrantScope gains account/region
  members…"). It has no construction site that would supply either — `decide.ts`,
  `service.ts`, `role-templates.ts`, `relationships.ts`, `support-session.ts` and
  `break-glass.ts` all build tenant- or orgUnit-scoped grants for a tenant
  membership model, which is not the model the platform-operator plane uses. An
  added member nothing constructs is a union arm nothing narrows, and an added
  optional field is invisible to `tsc`. The account/region axes live where they
  are decided instead.
- **`@tenure/authorization` was not added to `apps/system-studio/package.json`.**
  Nothing in the Studio's operator plane calls it; a dependency declared and
  unused is a claim the manifest makes and the code does not.
- **STUDIO-020-008 (step-up authentication) is still absent** and is not claimed
  here. `authorizeOperator` has no assurance input, because a parameter that is
  always "stepped up" would be worse than the gap.

### Independent re-verification, and the regression guard it exposed the need for

A later pass re-ran both items against the tree rather than against the section
above, because a ledger entry is a claim and the survey that queued this work
still described `isOperator` as the console's only check.

- **Re-verified, not re-read**: `apps/system-studio` `tsc --noEmit` — 0 errors.
  `e2e/authorize-logic.spec.ts` — **36 passed**. `tests/security/` —
  `every-path-authorizes`, `operator-boundary`, `operator-plane-content`,
  `no-hardcoded-estate` all green. All nine call sites confirmed by grep to call
  `authorizeCommand` and none to call `isOperator` outside prose.
- **Mutations re-run on this tree** (applied, run, red, restored, green):
  - `mayAct` → `return true`: **12 red** of 36, including "the Auditor holds
    reads and nothing else" and "an Auditor may read the fleet and may change
    nothing in it". Restored: 36 pass.
  - `authorizeOperator` returning `{allowed:true, reason:"GRANTED"}` before any
    check: **17 red** of 36. Restored: 36 pass.
  - `app/platform/cost/page.tsx`'s `authorizeCommand("cost.read", …)` reverted to
    `isOperator(session?.user?.email)` — the PRODUCTION call site, not a helper:
    **2 red** in `tests/security/every-path-authorizes.test.mjs`. Restored: 9
    pass.

**What the re-verification found missing**, and what was added for it:
`tests/security/every-path-authorizes.test.mjs` counted `operator` as a
permission decision by regex, and that regex matches `isOperator(` and
`authorizeCommand(` alike. Any one of the nine sites could therefore be reverted
to a bare membership test — losing resource, verb, tenant, account, region and
environment from the decision — with no test anywhere going red; the browser
spec covers `/tenants` and `/platform/cost`, and nothing covered the two
server-action modules at all. Four tests were added to that file:

- the nine sites each call `authorizeCommand` and none calls `isOperator`
  (comments stripped first, because `tenants/actions.ts` and
  `configuration/actions.ts` both explain in prose what they used to be — a
  detector that read prose as a call would report the two best-converted files
  as the two worst, and a self-test asserts the stripper keeps the real call);
- `isOperator`'s body stays exactly `roleOf(email, env) !== null`, so the
  authentication half cannot quietly regain authority;
- every other caller of `isOperator` in the Studio is named with a reason,
  split into `AUTHENTICATION_ONLY` (three: it is defined there, the sign-in
  redirect, and the approver lookup) and `MEMBERSHIP_ONLY_GATES`.

- **Recorded, not claimed closed**: five Studio surfaces added AFTER this work
  still gate on membership alone — `platform/audit/actions.ts` (so an operator
  of ANY family, `auditor-read-only` included, can place and lift a legal hold),
  `platform/audit/page.tsx`, `platform/estate/page.tsx` (its console deep links
  are already decided with `mayAct(role, "aws.console:read")`; its top-level gate
  is not), `platform/health/page.tsx` and `platform/security/page.tsx`. They
  belong to STUDIO-110-005/080-001/080-008/110-006, which are being written in
  the same tree, so they were left to their own items rather than edited
  underneath them — but they are now named in a ratchet that may only shrink,
  instead of being invisible. `MEMBERSHIP_ONLY_GATE_COUNT = 5`. The ratchet is
  asserted with `<=` and a subset check, deliberately NOT in the other
  direction: a suite that reds the moment one of those five is converted would
  be a suite arguing against its own subject.
- **Not run to completion locally**: `e2e/operator-roles.spec.ts`, the browser
  half that asserts the mutating controls are ABSENT from an Auditor's DOM. This
  machine has no built Studio and `next dev` compiles each route on demand —
  `/signin` took 171s and `/` took 217s — which exceeds the suite's 45s timeout.
  It is the CI job `studio-e2e` that runs it, against `npm run studio:build` +
  `npm run start`, with a five-family `PLATFORM_OPERATORS`. The source-level
  assertions above cover the half that a browser cannot: that the nine
  PRODUCTION call sites are the ones making the decision.

---

## STUDIO-070-002 / 060-007 / 070-009 / 040-005 / 070-005 — the tag contract, the change taxonomy, the signed artifact, secret existence, and execution provenance

Five items, one file area (`packages/provisioning` and the Studio modules that
call it). Read together because they all end at the same place: what a
provisioning run can be held to afterwards.

### STUDIO-070-002 — twelve required resource tags, with a shared sentinel

- **Was**: `tenure:tenant` appeared exactly once in the workspace, inside an
  operator-instruction STRING at `apps/system-studio/src/lib/cost-source.ts:62`.
  Nine of the twelve keys existed nowhere. `infrastructure/studio/main.tf`
  declared five PascalCase keys; `infrastructure/terraform`'s `default_tags`
  declared three, and fourteen resources bypassed even that with a bare
  `tags = { Name = ... }`.
- **Now**: `packages/provisioning/src/resource-tags.ts` declares
  `REQUIRED_RESOURCE_TAGS` (twelve `tenure:*` keys), `tagProblems(tags)`,
  `tenantAttribution(tags)` and `SHARED = "tenure:shared"` — a VALUE of
  `tenure:tenant`, never a separate key, so "somebody decided this is platform
  overhead" and "nobody looked at this" are different facts.
- **Both stacks carry it.** `infrastructure/studio/main.tf` extends `local.tags`
  (merged by every resource in that stack). `infrastructure/terraform/main.tf`
  has no `local.tags`, so the contract goes in the provider's `default_tags`,
  which reaches all fourteen bare-`Name` resources — more coverage than editing
  them, and it covers the next one somebody adds. New variables `owner_seat`,
  `cost_center`, `release` and (pilot) `cell_id`, all validated non-empty:
  ownership is an organisational fact, and a literal is correct only until the
  next reorganisation.
- **Production caller**: `apps/system-studio/src/lib/aws/tags.ts`.
  `taggedResources()` — the one function every `tag:GetResources` page passes
  through — now calls `tagProblems` and `tenantAttribution` on EVERY result, and
  `TaggedResource` carries `attribution` and `problems` as required fields, so
  `inventory.ts` and `findings.ts` get them for free.
  **This fixed a live defect**: `attributionOf` keyed `shared` off a separate
  `tenure:shared = "true"` tag while the contract makes it a value of
  `tenure:tenant`, so every control-plane resource in the studio stack would
  have attributed to a tenant whose slug is literally `tenure:shared` — and been
  billed to it.
- **Platform test**: `tests/architecture/resource-tags.test.mjs` reads the twelve
  keys OUT of the TypeScript source (never repeated), asserts both stacks carry
  all of them, asserts `tenure:tenant` is set to the sentinel, and records the
  fifteen bare-`tags = {` sites as a named, size-asserted baseline that may
  shrink and not grow.
- **Mutations proven** (applied, run, red, restored, green):
  - producer `taggedResources` stops calling `tagProblems` (`problems: []`):
    **2 red** in `aws/tags.test.ts`.
  - `attributionOf` folds `unattributable` into `shared`: **5 red**.
  - `"tenure:cost-center"` dropped from `infrastructure/studio/main.tf`:
    **1 red**, `tests/architecture/resource-tags.test.mjs`.

### STUDIO-060-007 — C1-C7, typed confirmation, cooling-off, non-automatable

- **Was**: no taxonomy. `HighRiskConfirmation` DISPLAYED five fields and
  demanded nothing; approval was a boolean pair; nothing anywhere was marked as
  an operation a machine must not perform.
- **Now**: `packages/provisioning/src/change-class.ts` — `ChangeClass` C1-C7,
  `classify(operation)` over a CLOSED union (adding a mutating surface is a
  compile error until somebody classifies it), `requirementsFor(cls, target)`
  returning `{typedConfirmation, approvers, coolingOffMs, automatable,
  refusedWithCliCommand?}`, and `confirmationTokenFor`.
- **Dispatcher**: `gateChange` in `apps/system-studio/src/lib/command-handlers.ts`,
  called by `runAdvance` BEFORE `executeStep` — so a refused change has not
  reserved anything, resolved anything or started a clock. Order is token then
  approvers then cooling-off then automatability, deliberately: a typo must not
  cost fifteen minutes.
- **The clock is the database's.** `startCoolingOff` in `registry.ts` writes
  `COOLOFF#<action>` with `attribute_not_exists`, so the FIRST request wins and
  every later one reads the stored record back. A caller cannot move it, which
  is the difference between a cooling-off period and a formality with a UI.
- **UI**: `AdvanceControls.tsx` now renders the typed-confirmation field and the
  approver field whenever the move's CLASS requires them, not only where the
  lifecycle engine requires an approver — `page.tsx` passes the token produced by
  `requirementsFor`, the same function that compares it. Without this, SUSPENDING
  (a C6 the engine does not gate) would have been refused with no field to
  satisfy it.
- **The refusal list is rendered**, on the tenant page, from
  `REFUSED_OPERATIONS` — so NEXT-SESSION section 0.3 is something an operator
  reads rather than discovers by being refused.
- **Mutation proven**: `classify` frozen to `return "C1"` for every operation —
  which leaves `requirementsFor` entirely correct — **12 of 14 red** in
  `command-handlers.test.ts`, including every purge refusal. Restored: 14 green.

### STUDIO-070-009 — the manifest is signed, and three comments stopped lying

- **Was**: `execute.ts:386` said "Not signed"; `actions.ts:598` said "A signed
  artifact is written twice"; `deliver.ts:6` said "Delivering a signed artifact".
  `rollbackDigest` was permanently null because the one call site held
  `tenant.deployment` and did not forward it. IaC, model and policy digests were
  absent entirely.
- **Now**: `DeploymentManifest.signature?: {keyId, algorithm:'hmac-sha256',
  value}`, computed over the SAME canonical bytes `digest` covers (one `body`
  object, one `deploymentBytes`), reusing `@tenure/releases`' key shape and its
  refuse-an-empty-key rule. `verifyDeployment(manifest, resolveKey)` mirrors
  `verifyRelease`, fails closed at every branch, and uses `timingSafeEqual`.
  `iacDigest` / `modelDigest` / `policyDigest` added, null when unstated,
  matching the existing convention and covered by `digest`.
- **`deliverToCell` refuses an unsigned artifact**, before it looks at the
  transport, mirroring `transition(_, "approved")`. `deploymentSigningKey()`
  reads `DEPLOYMENT_SIGNING_KEY_ID` / `DEPLOYMENT_SIGNING_SECRET`, and null
  produces an unsigned artifact that is then undeliverable — loud, not silent.
- **`runAdvance` passes `previousDigest: tenant.deployment?.digest`**, so
  `rollbackDigest` is real from a tenant's second artifact onward.
- **The consumer that would have been a total outage**:
  `apps/web/src/lib/provisioning/reconcile.ts` recomputed the digest over
  "everything except `digest`". Adding `signature` without teaching it to strip
  that too would have made EVERY signed artifact fail verification at the cell.
  `verifyDigest` now strips both, its `DeploymentManifest` declares
  `signature?`, and `deployment-signature.test.ts` reproduces the cell's
  implementation verbatim and asserts a signed artifact verifies under it.
- **Construction sites checked**: `deploymentManifest()` (execute.ts),
  `runAdvance` (command-handlers.ts — the only real caller since the executor
  moved out of `actions.ts`), the reader at `registry.ts`, the tenant page's
  deployment panel, and `reconcile.itest.ts`.
- **Mutation proven**: `deliverToCell`'s unsigned guard disabled — **1 red**
  ("refuses before it looks at the transport at all"). Restored: green.

### STUDIO-040-005 — secret references are resolved, not pattern-matched

- **Was**: the VERIFYING check's whole predicate was
  `Object.values(manifest.secretRefs).every(r => /^(secretsmanager|ssm):/.test(r))`.
  `secretsmanager:tenure/foo/does-not-exist` passed it and failed at ACTIVATING,
  inside the cell, after the tenant existed. No Secrets Manager or SSM client
  existed anywhere.
- **Now**: `apps/system-studio/src/lib/secret-refs.ts` — `resolveSecretRefs`
  calling ONLY `DescribeSecret` and `DescribeParameters`, through the Studio's
  one AWS gateway. Returns `{state:'PRESENT', lastChanged, rotationEnabled}` or
  `{state:'MISSING'}` or `{state:'UNKNOWN', action, minimumStatement}`.
  `@aws-sdk/client-secrets-manager` and `@aws-sdk/client-ssm` added to
  `apps/system-studio/package.json` and the lockfile; two capabilities added to
  `aws/capabilities.ts` (Secrets Manager scoped to `...:secret:tenure/*`, not `*`).
- **The check is injected**: `ExecutionContext.resolveSecretRefs` is REQUIRED, so
  every construction site had to answer — `executionContext()` in
  `command-handlers.ts` (which pre-resolves, keeping `executeStep` synchronous
  and deterministic), `provisioning.test.ts`, `deployment-signature.test.ts`,
  `secret-refs.test.ts`, `reconcile.itest.ts`.
- **Two checks, not one**: "every secret reference exists" (fails on MISSING) and
  "every secret reference was checkable" (fails on UNKNOWN, and says so —
  "UNKNOWN, not a pass"). MISSING and UNKNOWN have different remedies and one
  boolean cannot carry both. A throttle is UNKNOWN, never MISSING.
- **Guard**: `secret-refs.test.ts` asserts `GetSecretValue`,
  `GetParameterCommand` and `WithDecryption` appear nowhere in the CODE under
  `apps/system-studio/src` (comments stripped, string literals kept — three
  modules name the calls in order to forbid them).
- **Mutation proven**: the MISSING computation replaced with `const missing = []`
  — **2 red**, including "FAILS the step when a reference names nothing".
  Restored: green.

### STUDIO-070-005 — an execution record with provenance

- **Was**: `{step, state, ok, digest?, detail, checks?}`. Three of the twelve
  named facts. STUDIO-060-010 (concurrent, same file) added `inputDigest`,
  `correlationId`, `attempt` and `approvalRef?`, plus OPTIONAL `awsRequestIds?`
  and `compensation?`.
- **Now**: `outputDigest`, `assumedRoleArn`, `resourceHandles` and `nextRetryAt`
  added, and `awsRequestIds` / `compensation` promoted from optional to
  REQUIRED. All seven are stamped in the ONE `attribution` object inside
  `executeStep`, and the switch is wrapped so `outputDigest` is derived in one
  place — a `case` cannot be added without them.
- **Deviation from the requirement's sketch, stated**: the fields are flat rather
  than nested under `execution: {...}`. STUDIO-060-010 landed a flat shape in the
  same file in the same session, with a persisted-row reader (`evidenceFrom`) and
  a page already reading it; a second nested shape beside it would have been two
  vocabularies for one fact. The property the requirement asks for — *required,
  so a caller cannot forget* — is delivered: every field is non-optional and
  `tsc` found all five construction sites.
- **The request ids are real.** `getTenant` now returns
  `awsRequestIds: [out.$metadata.requestId]` on `TenantRecord` (required field;
  `registerTenant` and `adoptBoundTenant` construction sites fixed), and
  `runAdvance` threads it into the `StepRun`. `resourceHandles` is
  `dynamodb:table/<name>#TENANT#<slug>` — a handle, not an ARN, said so plainly
  because STUDIO-080-001 is what would make it an ARN. `assumedRoleArn` is null
  and says why: there is no `sts:AssumeRole` in this repository and a role name
  copied from configuration is an identity nobody confirmed. `nextRetryAt` is
  computed from the attempt count on failure and the panel says "due, not
  scheduled: nothing polls this, an operator retries".
- **Historical rows**: `evidenceFrom` in `registry.ts` gives a pre-widening row
  `awsRequestIds: [EVIDENCE_PREDATES_ATTRIBUTION]` rather than `[]` — `[]` would
  claim the step made no AWS call, which nobody can support — and maps an old
  `digest` to `outputDigest`, which is a rename and not an invention.
- **Rendered**: `apps/system-studio/src/components/EvidencePanel.tsx`, used by
  the tenant page. A step that touched the registry and cites no request id
  renders `unverifiable - no AWS request id recorded`.
- **Mutation proven ON THE PRODUCER**: `runAdvance` changed to pass
  `awsRequestIds: []` — **1 red**, "names the AWS request id the run actually
  read against", asserted through the real `runAdvance` and the real panel.
  Restored: 5 green. A test calling `executeStep` directly would have stayed
  green, which is why it does not.

### Evidence

- `cd apps/system-studio && npx tsc --noEmit` — 0 errors in the files this work
  owns. The only remaining errors are `packages/provisioning/src/catalogs.test.ts`
  (WRK-100-004 `evidenceRefs`, another agent's concurrent work).
- `cd apps/web && npx jest --ci --testPathPattern "(provisioning|system-studio)"`
  — **16 suites, 388 tests, all passing.**
- `node --test tests/architecture/resource-tags.test.mjs
  tests/architecture/forbidden-clients.test.mjs` — 11 pass, 0 fail.

### What is NOT closed, and is not claimed

- The deployment signature is a **MAC, not an asymmetric signature**. The cell
  must hold the same secret to verify it, so a compromised cell could forge an
  artifact for another cell. Stated in `execute.ts`'s header rather than glossed.
  The cell does not yet VERIFY the signature — `deliverToCell` refuses to send an
  unsigned one, and `verifyDeployment` exists and is tested, but
  `apps/web/src/lib/provisioning/reconcile.ts` still checks only the digest.
  Wiring that needs the key on both sides, which is a deployment decision.
- `iacDigest`, `modelDigest` and `policyDigest` are **always null today**. Nothing
  in this repository can derive them; a value would be invented. The fields exist,
  are covered by `digest`, and the plumbing to supply them is one `meta` field.
- `assumedRoleArn` is **always null**. There is still no `sts:AssumeRole`.
- `fleet-capacity` and `edge-cache` are **classified and not performed**. No code
  updates a desired count or invalidates a path; the arms exist so the gate is
  there when one does, and `REFUSED_OPERATIONS` renders the refusal meanwhile.

---

## STUDIO-070-004 (EventBridge) — the scheduled job that stopped running

- [x] **STUDIO-070-004 / EVENTBRIDGE** — Read EventBridge rules, their schedule
  or pattern, whether each is ENABLED, and their targets, behind the typed
  capability registry; render DISABLED as outranking healthy, on the precedent
  `alarms.ts` set for an alarm with its actions switched off.
  - Status: PASS for the reader. The route that renders it is NOT claimed —
    see "What is NOT closed" below.
  - Code: `apps/system-studio/src/lib/aws/eventbridge.ts`
  - Tests: `apps/system-studio/src/lib/aws/eventbridge.test.ts` — 25 cases
  - Evidence: `cd apps/web && npx jest --ci ../system-studio/src/lib/aws/eventbridge.test.ts`
    — 25 passed, 25 total. 12 mutations applied to the PRODUCTION module, 12
    caught, file restored byte-identical and re-run green (M1–M12 below).
  - Capabilities used, both already in the registry and granted:
    `events:ListRules` and `events:ListTargetsByRule`, at `EVENTBRIDGE_TTL_MS`
    (240s). Nothing was added to `capabilities.ts`, `client.ts`, `read.ts`,
    `throttle.ts` or `iam.tf` by this work.

  `infrastructure/terraform/scheduler.tf` creates one rule on
  `cron(0 13 * * ? *)` whose target POSTs `/api/jobs/reminders`. It is the only
  thing that makes a club's 24-hour deliverable warning fire, and a disabled
  EventBridge rule raises no alarm, logs no error and appears in no failure
  count — it simply stops. So `ruleVerdict` checks `State === "DISABLED"` before
  it looks at anything else, exactly as `verdictFor` in `alarms.ts` checks
  `ActionsEnabled === false` before it looks at `StateValue`.

  Three further verdicts exist for the same reason. `NO_TARGET` is an ENABLED
  rule whose `ListTargetsByRule` answered SUCCESSFULLY with nothing — it fires
  into empty space, which deleting an `aws_cloudwatch_event_target` produces
  while leaving the rule intact. `TARGETS_UNKNOWN` is an ENABLED rule whose
  targets call was refused, throttled or broke, and it is deliberately NOT
  `NO_TARGET`: "this rule invokes nothing" and "we were not allowed to ask what
  it invokes" are opposite facts and only the first is something to go and fix.
  `UNTRIGGERED` is ENABLED with neither a schedule nor a pattern.

  Nothing here is ever an empty list because a call failed. A denied
  `events:ListRules` is DENIED carrying the principal, the action and a
  pasteable minimum statement, and the surface renders it as ONE row whose
  verdict is `UNAUTHORIZED` — `rows: []` is unreachable on that path. A throttle
  is `UNREADABLE`, a separate word, because no IAM statement fixes it.
  `targetCount` is `number | null` and `null` for exactly the states where the
  count is not known; `0` would be a claim the read never made.

  Region and partition come from the resolved identity or are `null`, and the
  scope sentence says which region and which buses were read. There is no
  `us-east-1` literal in the module — that literal under an unresolved identity
  is GE-010-007, a console telling an operator a job runs in a jurisdiction it
  does not run in.

  Attribution goes through `taggedResources` / `tagIndex` in `tags.ts`. It has a
  fourth arm `tags.ts` does not need: when `tag:GetResources` is itself refused
  every rule comes back untagged, and folding that into "shared" would attribute
  the estate to platform overhead on the strength of a call nobody was allowed
  to make. `unattributed` is likewise NOT folded into `shared`, per the bug
  recorded in `attributionOf`.

  `throttle.ts` owns WHEN to retry — `isTransient`, `READ_ATTEMPTS`,
  `backoffMs` — and `read.ts` owns WHAT HAPPENED once the budget is spent.
  `readWithBackoff` is not called directly because it converts the error to a
  string, and a string cannot be classified into DENIED with a statement. The
  schedule is shared instead, so the wait the page quotes and the wait
  `nextAttemptAt` quotes are the same number from the same function.

  ### Mutations, applied to the production module and each confirmed red

  | # | Mutation | Result |
  |---|---|---|
  | M1 | DISABLED no longer outranks a live schedule | 3 failed / 22 passed |
  | M2 | an unreadable target list reported as NO_TARGET | 2 failed / 23 passed |
  | M3 | a denied ListRules renders as an empty table | 1 failed / 24 passed |
  | M4 | region falls back to the `us-east-1` literal | 1 failed / 24 passed |
  | M5 | a denied tag index attributes rules as merely untagged | 1 failed / 24 passed |
  | M6 | `throttle.ts`'s transient set no longer consulted | 1 failed / 24 passed |
  | M7 | rows sorted with `localeCompare` instead of codepoint | 1 failed / 24 passed |
  | M8 | an unknown target count reported as zero | 2 failed / 23 passed |
  | M9 | only the first page of rules is read | 1 failed / 24 passed |
  | M10 | a cadence that is not this capability's | 1 failed / 24 passed |
  | M11 | the throttle wait invented instead of taken from the schedule | 1 failed / 24 passed |
  | M12 | a target's input body carried onto the surface | 1 failed / 24 passed |

  Baseline before: 25/25. After restore: 25/25, file byte-identical.

  ### What is NOT closed, and is not claimed

  - **No route renders this yet.** `eventBridgeSurface()` defaults to
    `liveGateway()` and is production-shaped — same signature as `alarmSurface`,
    which `app/platform/health/page.tsx` calls — but no page or API route in
    this repository imports it at the time of writing. A route agent owns that
    file. Until it lands, this is a reader nothing reads.
  - **Only the buses it is told to read.** `events:ListEventBuses` is not in the
    capability registry and was NOT added here. `eventBridgeSurface` defaults to
    `["default"]`, which is where `scheduler.tf` puts its rule, and `scopeNote`
    states that a rule on another bus was not looked at and is not claimed to be
    absent. A stated scope is not a silent absence, but it is not discovery
    either.
  - **No `MISSING` verdict.** `alarms.ts` can say "declared in Terraform and
    absent from a successful response" because `expected-alarms.ts` derives the
    expected set from the Terraform. There is no equivalent for rules, so this
    surface cannot tell a deleted `aws_cloudwatch_event_rule` from one that
    never existed. Building that needs an expected-rules source of the same
    kind; it is not faked here.
  - **Target inputs are not carried,** only `hasInput`. The body is arbitrary
    caller-supplied JSON and is where a bearer token would sit.

---

## AWS Health — "is it us, or is it AWS", read live

Filed under the two requirements it actually serves. **No new requirement id was
invented**: there is no `STUDIO-080-009` in the bible, and writing one into a
ledger would be a claim about a checklist nobody wrote.

### STUDIO-070-004 — the AWS Health adapter, behind the typed capability

- **Was**: `capabilities.ts` named `health:DescribeEvents` and
  `health:DescribeAffectedEntities` and `client.ts` could send both, and nothing
  called either. The console could show this estate's CloudWatch alarms and had
  no way to ask whether AWS itself was having an event — so an AWS-side
  impairment in the region we run in and a bad deploy of ours looked identical.
- **Now**: `apps/system-studio/src/lib/aws/aws-health.ts` — `awsHealthSurface()`
  reading open and upcoming events, their services, regions, start/end times and
  their affected entities, attributed to tenants. No `@aws-sdk` import: every
  call goes through the `AwsGateway` seam in `read.ts`, so `forbidden-clients`
  still permits exactly one client module.
- **Capabilities used, none added**: `health:DescribeEvents`,
  `health:DescribeAffectedEntities`, `sts:GetCallerIdentity`, `tag:GetResources`
  — asserted by a test that fails if a fifth is ever called. `capabilities.ts`,
  `client.ts`, `read.ts`, `throttle.ts` and `iam.tf` were **not edited**.
- **Paging and the API's own limits are honoured**: `DescribeEvents` follows
  `nextToken`; the entity filter is chunked to **ten** event ARNs, which is the
  API's maximum — an eleventh produces a `ValidationException` that would have
  rendered as "the entity read is broken" for what is really a paging rule.

### STUDIO-000-007 — every arm of the union is reachable, and says something different

- **Four AWS behaviours, four different sentences**, asserted pairwise distinct
  rather than asserted individually: populated, empty-but-successful, denied,
  throttled. A denial carries the principal, the action and the pasteable
  minimum statement and never renders as `[]` — the surface returns one
  `UNAUTHORIZED` row, because an empty table on this page is the sentence "AWS is
  having no events" written in whitespace.
- **A throttle is its own state.** Retried through `readAws`'s backoff first: a
  throttle that clears on the retry is `ACTUAL`, and one that does not is
  `THROTTLED` with the wait named. Both are proven.
- **`SubscriptionRequiredException` is UNCONFIGURED with a named remedy** — the
  Health API needs Business or higher. Not `EMPTY` (nobody said there are no
  events), not `ERROR` (nothing is broken), and NOT a minimum IAM statement,
  which would send an operator to edit a policy that is already correct.
- **Events readable + entities refused is a state of its own.** They are two
  grants, so `entitiesKnown: false` travels on the row and the sentence quotes
  `health:DescribeAffectedEntities` — not the action that succeeded. A row can
  never print "0 affected resources" about an event nobody was allowed to open.
- **Region and partition come from the resolved identity.** The verdict for a
  public event compares the event's region against STS's answer; when identity
  did not answer the verdict is `OPEN_REGION_UNKNOWN`, not a guess. A `us-east-1`
  literal here is GE-010-007 wearing a different hat, and the test that proves it
  runs the SAME event against a `eu-west-2` estate and a `us-east-1` one.
- **Attribution is the tagging API's, via `tags.ts`.** The tag index outranks the
  tag map AWS Health carried on the entity when the event was raised — ownership
  today is who gets called today — and the entity map is the fallback for a
  resource the index does not carry.

### A deviation, stated

The brief said "mark it shared where no tag says otherwise". This module keeps
`tags.ts`'s **three** arms instead: `shared` only where somebody set
`tenure:tenant = tenure:shared`, and `unattributed` where nobody tagged it at
all. Folding the second into the first is the exact fold `tags.ts` was rewritten
to prevent, and during an incident it is the difference between "this is platform
overhead" and "nobody knows whose this is". Both counts are rendered.

### Evidence

- `cd apps/web && npx jest --ci --testPathPattern aws-health` — **20 tests, all
  passing** (`apps/system-studio/src/lib/aws/aws-health.test.ts`).
- `cd apps/system-studio && npx tsc --noEmit` — no error in either file this work
  owns. (Concurrent, other agents' files: `lambda.test.ts`, `sqs.ts`.)
- `node tools/run-platform-tests.mjs` — 393 tests. The three reds
  (`the committed documents match what the generators produce now`, `no
  operator-facing module lists the unfiltered bindings`, `the committed map
  matches the code`) reproduce with these two files **moved out of the tree**,
  so they are baseline, not this work.

### Mutations applied to the PRODUCTION path, each red, each restored

Applied to `aws-health.ts` — never to the test's stand-in — one at a time, with
the file restored from an in-memory copy of the original after each. The final
run after restoration is 20/20 green.

| # | mutation | result |
|---|---|---|
| M1 | the DENIED arm of `composeRows` returns `[]` | RED — "AccessDenied — UNKNOWN carrying the principal, the action and a statement" |
| M2 | `ourRegion` falls back to a `"us-east-1"` literal | RED — "identity that did not answer produces OPEN_REGION_UNKNOWN, not a guess" |
| M3 | `entitiesKnown` hardcoded `true` | RED — "a row never reads as 'touches nothing' when the entity call was refused" |
| M4 | the UNCONFIGURED headline reworded as the EMPTY one | RED — "it is not EMPTY, not ERROR, and names the plan to buy" |
| M5 | the event's stale tag map outranks the tag index | RED — "the current tag index outranks the tags the event was raised with" |
| M6 | `MAX_EVENT_ARNS_PER_FILTER` raised from 10 to 25 | RED — "event ARNs are chunked to the filter's limit of ten" |
| M7 | an unmade entity call reports EMPTY instead of UNCONFIGURED | RED — "empty-but-successful — a claim, worded as AWS's answer" |

No guard was disabled to iterate, and none was left disabled: the mutation script
restores the original bytes after every case and the restored run is recorded
above.

### What is NOT closed, and is not claimed

- **Nothing renders this yet.** The production path is real — `awsHealthSurface()`
  with no gateway resolves `liveGateway()` → `gateway()` in `client.ts` → the
  real Health client — but the only caller today is the test. The intended
  consumer is `apps/system-studio/src/app/platform/health/page.tsx`, which this
  work did not touch because a route agent owns it. Until that lands, this is a
  readable surface with no page, and is recorded as such rather than as PASS for
  the rendering half of any requirement.
- **Never run against a real account.** There is no AWS Organization and no
  Business support plan on this account, so every state above was produced by a
  stand-in that reproduces the API's shapes, its pagination, its ten-ARN filter
  limit and its error names. `SubscriptionRequiredException` in particular is the
  answer a real call would give today, and it is handled — but it has not been
  observed. Unblocking is the same gate as GE-010: an account with Business or
  Enterprise support, then `aws health describe-events --region us-east-1`
  against it.
- **Type widening: nothing was widened.** `aws-health.ts` adds types and changes
  none. The types it consumes — `AwsRead<T>`, `DenialContext`, `AwsGateway`
  (`read.ts`), `Identity` (`identity.ts`), `Attribution` / `TaggedResource`
  (`tags.ts`) — were read, not edited, and `grep -rn "aws-health"` across
  `apps`, `packages`, `tests` and `tools` finds no consumer outside the module
  and its test, so there is no construction site elsewhere to check.

---

## STUDIO-070-004 — service adapter: SES

- [x] **STUDIO-070-004 (SES adapter)** — Read SES back through the typed
  capability registry: verified identities, the configuration set, the sending
  quota and 24-hour send rate, the account-level suppression list, and whether
  the account is still in the sandbox.
  - Status: PASS **for the read adapter's stated scope**. It is not a rendered
    surface: no route or page imports it yet, and this entry does not claim one.
    `tools/loop/studio-program.mjs:318` fans a route agent out over the same
    module path; when that lands, the rendering claim belongs in its entry, not
    in this one.
  - Code: `apps/system-studio/src/lib/aws/ses.ts`
  - Tests: `apps/system-studio/src/lib/aws/ses.test.ts` — 51 cases
  - Evidence: `cd apps/web && npx jest --ci --rootDir . --testPathPattern "aws/ses"`
    — **51/51 passing**. 10 mutations applied to the production path, 10 caught
    (table below). `npx tsc -p` over the two files — 0 errors.

  `infrastructure/terraform/ses.tf` provisions a `tenurework.com` domain
  identity, a from-address identity, a configuration set requiring TLS, and
  account-level suppression on BOUNCE and COMPLAINT. Nothing read any of it
  back, so two different outages were the same blank screen: a domain identity
  Terraform created and nobody finished verifying at the registrar, and an
  account still in the SES sandbox. The second silently limits who can be
  emailed — SES delivers only to recipients that are themselves verified
  identities and refuses every other address — and it is the fact this module is
  built around.

  **`Stated<T>`, and the refusal to invent an approval.** SES production access
  is an approval AWS grants after reviewing a request. `ProductionAccessEnabled`
  absent from a `GetAccount` response is therefore neither `true` nor `false`,
  and `productionAccessFrom` returns a third arm, `UNSTATED`, carrying why.
  `Details.ReviewDetails` — AWS's own status and case id for that request — is
  carried verbatim when SES returns it and `stated: false` when it does not; it
  is never assembled, never inferred from `ProductionAccessEnabled`, and carries
  no date this module made up. Every other optional SES field (`SendingEnabled`,
  `EnforcementStatus`, the three quota numbers, `TlsPolicy`, a suppression
  entry's `Reason`) goes through the same union, so `{ stated: false }` has no
  `value` field and a caller that reaches for one does not compile.

  **A denial is never an empty list.** Every read returns `AwsRead<T>`. The
  configuration-set surface is a two-stage read — `ListConfigurationSets` names
  the sets `GetConfigurationSet` describes — and a refusal of the LIST is carried
  through to the detail surface *naming `ses:ListConfigurationSets`*, because a
  line naming `ses:GetConfigurationSet` would send an operator to grant a
  permission that was never the problem, and a line saying "no configuration
  sets" would tell them Terraform never applied.

  **The throttle schedule is `throttle.ts`'s.** `SES_FIRST_BACKOFF_MS` is
  `backoffMs(2)` and the budget is `READ_ATTEMPTS`, so the wait a THROTTLED SES
  panel prints is `backoffMs(READ_ATTEMPTS + 1)` — the same number
  `readWithBackoff` would have put in `nextAttemptAt`. Asserted as an identity
  against `throttle.ts`, not as a literal.

  **Residency.** SES ARNs are assembled from `resolveIdentity()`'s partition,
  region and account, and `sesArn` returns `null` rather than assembling one from
  defaults when identity is unresolved — in which case attribution is `unknown`
  rather than `unattributable`, because there was no key to look the tags up
  under. A GovCloud case in the suite proves the tag join lands only when both
  partition and region come from the resolved identity.

  **Attribution** goes through `taggedResources()` and `attributionOf()` in
  `tags.ts` — no second implementation. `unattributed` is deliberately not
  folded into `shared`; the SES *account* is `shared` as a statement of fact
  (there is no per-tenant SES account), not as a fallback for a missing tag.

  **The suppression list contains real people.** Entries carry the address,
  because "why did this person not get their reminder" is the question the list
  answers, but the sentence a surface prints by default is counts by reason and
  by domain with no local part in it, and every entry also carries
  `maskedAddress`. A page printing `address` is making that choice explicitly.

  ### Mutations applied to the production path, and what caught them

| # | mutation in `ses.ts` | result |
|---|---|---|
| S1 | `productionAccessFrom` treats an ABSENT `ProductionAccessEnabled` as production access granted | RED ×2 — "an ABSENT ProductionAccessEnabled is UNSTATED"; green on restore |
| S2 | a denied `ses:ListConfigurationSets` falls through to an empty set list | RED ×2 — "a denied ListConfigurationSets does not render as 'no configuration sets'" |
| S3 | `sesArn` hardcodes the region instead of using the resolved identity (GE-010-007) | RED ×6 — including the GovCloud tag join |
| S4 | `verificationFrom` treats any non-empty `VerificationStatus` as VERIFIED | RED ×6 — including the four-different-sentences case for identities |
| S5 | an unreadable tag index becomes `unattributable` instead of `unknown` | RED ×2 — "a DENIED tag index is unknown attribution, not unattributable" |
| S6 | the retry schedule stops coming from `throttle.ts` and is typed in `ses.ts` | RED ×5 — all four surfaces' four-case matrix, plus the schedule identity |
| S7 | the default suppression sentence prints every suppressed address | RED ×1 — "the default sentence carries no local part" |
| S8 | an empty suppression list loses its ability to report EMPTY | RED ×2 — EMPTY collapses into ACTUAL and two sentences become one |
| S9 | a thrown SES error is swallowed into an empty identity list | RED ×4 — "a denied SES read is never an empty list" |
| S10 | the page budget stops reporting that the suppression list was truncated | RED ×1 — "a suppression list longer than the page budget says it is truncated" |

  All ten restored; the file is byte-identical to its pre-mutation state and the
  suite is 51/51 green. No guard was left disabled — `ses.ts` and `ses.test.ts`
  contain no `false &&`, no `|| true` and no mutation stub.

  ### What is NOT closed, and is not claimed

- **Nothing renders this yet.** `sesReadings()` reaches the real `SESv2Client`
  through `liveGateway()` → `client.ts`, and the tests drive that exact function
  rather than a helper — but no route or page imports the module, so no operator
  can see any of it today. That is the route agent's item.
- **No SES read has been performed against a real AWS account.** Every case here
  is a stand-in gateway raising the four answers the real client raises. The
  account does not exist to read; the same gate blocks GE-010 and STUDIO-GATE-010.
- **`ses:SendEmail` is absent and stays absent.** A console that reads every
  tenant's mail configuration must not be able to send as them;
  `infrastructure/studio/iam.tf` denies it explicitly.

---

## Budgets — the live read (STUDIO-000-006 · "budgets"; feeds STUDIO-120-009)

No checkbox is moved by this entry, deliberately. STUDIO-000-006's title lists
ten other things that are still not read, and STUDIO-120-009 was recorded against
`packages/finops`' arithmetic rather than against an AWS reader. This records what
the reader now does and the one thing it cannot do.

- Status: **PASS** for every budget, its limit, its actual and its forecast.
  **FAIL** for the alert thresholds and whether they reach a subscriber.
- Code: `apps/system-studio/src/lib/aws/budgets.ts`
- Tests: `apps/system-studio/src/lib/aws/budgets.test.ts` — 26 cases, all passing.
  `cd apps/web && npx jest --ci --testPathPattern "aws/budgets"`.
- Type check: `cd apps/system-studio && npx tsc --noEmit` — exit 0.
- Regression: `cd apps/web && npx jest --ci --testPathPattern "system-studio"` —
  21 suites, 410 tests, all passing.
- Guards: `node --test tests/security/no-hardcoded-estate.test.mjs
  tests/architecture/forbidden-clients.test.mjs
  tests/security/operator-plane-content.test.mjs` — 14 pass, 0 fail.

`budgetReadings()` resolves identity first and threads the account into
`DescribeBudgets`. That is not ceremony: the API is scoped by account id and
answering it with the wrong account returns an **empty list rather than an
error**, so `String(undefined)` reaching `client.ts` would have produced the one
answer this surface must never produce by accident. When identity did not
resolve, the call is not made and the read is UNCONFIGURED quoting the identity
failure — so the operator is sent to the read that actually failed rather than to
the Budgets policy.

Every budget ARN is built from the resolved partition and account. The suite runs
the whole module against an `aws-us-gov` identity for exactly this reason: a
literal `arn:aws:` fails there and nowhere else, which is GE-010-007 in miniature.

Money is `@tenure/finops` — integer minor units, currency carried, parsed from
the decimal STRING AWS sends. Two fixtures exist only to catch the float path: a
JPY limit, which a hardcoded two-decimal parser counts a hundredfold wrong, and a
`0.0000004` USD actual, which any round-to-cents path zeroes.

And `Amount`/`Unit` is only money for a **COST** budget. A `USAGE` budget's unit
is `GB` and an `RI_UTILIZATION` budget's is `PERCENTAGE`; feeding either to
`fromDecimal` produces a `Money` denominated in "GB" that then sums with dollars.
Those types get `limit: null` and a separate `quantity` carrying the real unit.

### What is NOT closed, and is not claimed

**A budget's alert thresholds and their subscribers are NOT read.** A threshold
with an empty subscriber list fires into nothing — the budget is breached, AWS
evaluates the notification, and no human is told — and on every console that has
shipped this reads exactly like a budget that is fine.

`BudgetReading.alerting` is therefore an `AwsRead` permanently in the
UNCONFIGURED state, whose `why` names the two capabilities that would answer it:

    budgets:DescribeNotificationsForBudget
    budgets:DescribeSubscribersForNotification

Both are authorised by `budgets:ViewBudget`, which `infrastructure/studio/iam.tf`
already grants, so **no IAM change is the remedy** — what is missing is two
entries in `capabilities.ts` and two arms in `client.ts`. This module did not add
them: the registry is the enumeration of everything the console can reach, and a
service adapter that extends it on its own is how that enumeration stops being
true. `isUnknown()` returns true for UNCONFIGURED and `httpStatusFor()` answers
501, so a route that forgets to narrow gets "not implemented" rather than a page
claiming the thresholds are wired. A test asserts both capabilities are ABSENT
from the registry, so the day they land the placeholder fails rather than
surviving.

**Not run against a real AWS account.** Every case is a stand-in gateway raising
the four answers the real client raises. The same gate blocks GE-010 and
STUDIO-GATE-010.

**`attributionOf` is not folded.** An untagged budget reports `unattributed`, not
`shared`. "Somebody decided this is platform overhead" and "nobody tagged it" are
different facts and only the first is a decision; `tags.ts` says so at length and
this reader does not disagree with it.

### Mutations proven ON THE PRODUCTION PATH

Applied to `budgets.ts`, run, restored, re-run. Every one was caught by the
assertion that is about it, not incidentally.

| # | Mutation | Red |
|---|---|---|
| B1 | a refused `DescribeBudgets` falls through to `[]` | 6 |
| B2 | ARN built with the literal partition `aws` | 3 |
| B3 | `alerting` returns EMPTY — "no thresholds" — instead of UNKNOWN | 2 |
| B4 | amounts through `Number()` rounded to hundredths | 2 |
| B5 | the identity guard switched off — `if (false && !estate)` | 1 |
| B6 | retry schedule typed inline instead of `throttle.ts` | 1 |
| B7 | an untagged budget folded into `shared` | 1 |
| B8 | every budget type treated as money, so a GB limit gets a currency | 1 |
| B9 | a budget with no AWS forecast reported `UNDER` | 1 |
| B10 | `watchesTenant` taken from the owner tag instead of the cost filters | 1 |

Restored: **0 red / 26 green.**

B10 is recorded because it first survived. The fixture had one budget whose owner
tag and cost filter named the same tenant, so reading either for the other gave
the same answer and the assertion proved nothing. The fixture now carries a
budget owned by `tenure:shared` that watches `north-hills` — a real
misconfiguration and the only shape that can tell the two fields apart.

## STUDIO-070-004 (SQS) — every queue, its backlog, and the dead-letter queues nobody was told about

- **Was**: `infrastructure/terraform/sqs.tf` creates five queues — `default`,
  `email`, `notifications` and the two dead-letter queues `default-dlq` and
  `email-dlq` — and nothing in the running product had ever issued an SQS call.
  A message that failed its last retry and landed in `email-dlq` produced
  exactly the same console as a queue that was never written to: nothing.
- **Now**: `apps/system-studio/src/lib/aws/sqs.ts`. `queueReadings()` resolves
  identity, reads the tag index, lists every queue and reads each queue's
  attributes, and returns `SqsReadings` — `AwsRead<readonly QueueReading[]>` for
  the listing, an `AwsRead<QueueDepth>` per queue, a `DeadLetterState`, an
  explicit `asOf`, and both capabilities' own `refreshMs` read from the registry
  rather than retyped.
- **Two capabilities, two readings**: `sqs:ListQueues` and
  `sqs:GetQueueAttributes` are separate IAM actions and a role is routinely
  granted one without the other. A refused `GetQueueAttributes` names
  `sqs:GetQueueAttributes` and prints that minimum statement — not the listing
  action — and the queue still appears saying it was refused, rather than
  vanishing or rendering as `0 visible`. This is `retained.ts`'s
  `backup:ListBackupVaults` lesson applied at construction time.
- **The DLQ is a state, not a cell in a table**: `DeadLetterState` has four arms
  — `unknown`, `none-configured`, `clear` and `failed-deliveries` — and the
  `clear` arm carries the queues it could NOT read, so "clear" never quietly
  means "clear as far as we bothered to look". Which queues ARE dead-letter
  queues is derived from a policy AWS returned (another queue's `RedrivePolicy`
  naming this ARN, or this queue's own `byQueue` `RedriveAllowPolicy`), never
  from a `-dlq` suffix.
- **Residency**: region and partition come from the resolved identity and from
  the `QueueArn` AWS returns. There is no region literal and no `"aws"`
  partition fallback in the file; with identity unresolved no ARN is assembled
  at all and the surface says "region unknown". A GovCloud identity produces
  `arn:aws-us-gov:sqs:us-gov-west-1:…` and the whole rendered surface contains
  no `us-east-1`.
- **Attribution** goes through `tags.ts` and the Resource Groups Tagging API, and
  adds a FOURTH answer the three-way contract cannot express: `unknown`, for
  when the tag index itself was denied or throttled. "We could not look up this
  queue's tags" is not "this queue has no tenant tag", and the second sends an
  operator to add a tag that is already there.
- **Counts are never guessed.** An absent `ApproximateNumberOfMessages` throws
  inside `readAws`, so the queue's depth is ERROR naming the attribute — `0`
  would be a claim, and it is the claim that makes a backlog invisible.
- **Mutation proven on the production path**, ten mutations applied to `sqs.ts`
  (never to the test or a helper), each run, each red, each restored:

| # | mutation applied to `sqs.ts` | result |
|---|---|---|
| M1 | the refused/throttled listing passthrough replaced with an ACTUAL empty array | RED ×5 |
| M2 | `deriveQueueArn` uses a `us-east-1` literal instead of the resolved region | RED ×2 |
| M3 | dead-letter queues identified by the `-dlq` suffix instead of by redrive policy | RED ×1 |
| M4 | `requiredCount` defaults an absent count to `0` instead of throwing | RED ×1 |
| M5 | an unreadable tag index reported as `unattributable — missing tenure:tenant` | RED ×2 |
| M6 | "no DLQ found, some queues unreadable" reported as a finding instead of unknown | RED ×1 |
| M7 | the oldest-message sentence dropped from the rendered queue line | RED ×1 |
| M8 | a refused `GetQueueAttributes` reported under the `sqs:ListQueues` capability | RED ×1 |
| M9 | queues past the depth-read cap given an EMPTY depth instead of UNCONFIGURED | RED ×1 |
| M10 | the retry schedule retyped as literals instead of `throttle.ts`'s | RED ×1 |

  All ten restored; the suite is 31/31 green and `sqs.ts` contains no
  `false &&`, no `|| true` and no mutation stub.

### Evidence

- `npx jest --ci --testPathPattern "aws/sqs"` — **31 passed, 31 total.**
- `npx jest --ci --testPathPattern "system-studio"` — **21 suites, 410 tests,
  all passing** (includes the concurrent service agents' suites).
- `cd apps/system-studio && npx tsc --noEmit` — no error in `sqs.ts` or
  `sqs.test.ts`. The two remaining errors are missing `.next-config-md3` type
  stubs from another agent's `tsconfig.json` include.
- `node --test tests/architecture/forbidden-clients.test.mjs` — 6/6 pass. The
  fixture's queue URLs are composed from their parts rather than written as a
  literal `https://…amazonaws.com`, so the guard stays absolute rather than
  gaining an exception for tests.
- `node tools/run-platform-tests.mjs` — **390 pass, 3 fail**, and the identical
  three fail with `sqs.ts` and `sqs.test.ts` moved out of the tree. They are
  another agent's stale generated documents, not this work.

### What is NOT closed, and is not claimed

- **The age of the oldest message is NOT read.** It is not an SQS queue
  attribute — no SDK version has one — it is the CloudWatch metric
  `AWS/SQS ApproximateAgeOfOldestMessage`, and the capability registry holds no
  `cloudwatch:GetMetricData`. Every queue therefore carries an `oldestMessage`
  field whose only arm is `NOT_READABLE`, naming the capability that would
  answer it. This item is **FAIL** until `cloudwatch:GetMetricData` is added to
  `capabilities.ts` by whoever owns that file, plus the matching grant in
  `infrastructure/studio/iam.tf`.
- **Nothing renders this yet.** `queueReadings()` reaches the real `SQSClient`
  through `liveGateway()` → `client.ts`, and the tests drive that exact
  function — but `SURFACES` in `lib/aws/result.ts` has no SQS entry and no route
  or page imports the module, so no operator can see any of it today. That is
  the route agent's item, and this work does not claim it.
- **No SQS read has been performed against a real AWS account.** Every case is a
  stand-in gateway raising the answers the real client raises. The same gate
  blocks GE-010 and STUDIO-GATE-010.
- **`sqs:ReceiveMessage`, `sqs:DeleteMessage` and `sqs:PurgeQueue` are absent and
  stay absent.** Reading a queue's depth must not become the ability to consume
  or destroy the messages in it.

---

### Lambda joins the live AWS reads — STUDIO-080-001 (partial), STUDIO-000-007, STUDIO-000-009

**No checkbox is ticked by this entry.** STUDIO-080-001 asks for a
cross-account, cross-region inventory carrying cost, drift, retention and
deletion behaviour; what landed is one service's slice of it, in one region, and
saying otherwise would be a sign-off nobody gave. The item stays as it is.

- Status of this slice: PASS
- Code: `apps/system-studio/src/lib/aws/lambda.ts`
- Tests: `apps/system-studio/src/lib/aws/lambda.test.ts` — 23 cases, all passing
  under `npx jest --ci --testPathPattern "system-studio/src/lib/aws/lambda"`
- Evidence: six mutations applied to the production path, six caught, all
  restored (M-L1 … M-L6 below); `md5sum` of the file after the last restore is
  identical to the pre-mutation snapshot.

**What it reads.** `lambda:ListFunctions` paged by `Marker`, and
`lambda:GetFunctionConcurrency` per function: runtime, package type, memory,
timeout, code size, architectures, last-modified and reserved concurrency. Both
capabilities were already in the registry and in `client.ts` and nothing called
them, so every function in the account was invisible from the console that is
supposed to be authoritative about the estate.

**A runtime AWS has end-of-lifed is a scheduled outage, and AWS publishes no API
for the calendar.** So `RUNTIME_DEPRECATION_CALENDAR` is a transcription of the
public runtime-support page, stamped `RUNTIME_CALENDAR_AS_OF` and carrying the
page's URL on every verdict derived from it. The stamp is load-bearing: past
`CALENDAR_MAX_AGE_MS` (90 days) the reassuring verdict SUPPORTED is withdrawn
and becomes UNKNOWN_STALE_CALENDAR, while DEPRECATED and APPROACHING stand — a
date in the past does not move, over-warning costs a lookup, and under-warning is
the outage. A runtime the transcription has never heard of is UNKNOWN_RUNTIME and
is never assumed current; a container-image function is NOT_A_MANAGED_RUNTIME and
says plainly that this console cannot see the age of a base image. **This is the
one input in the module that a human must maintain**, and it degrades to
"unknown" rather than to "fine" when nobody does.

**Reserved concurrency is `AwsRead<number>`, not `number | null`.** Lambda
reports an unreserved function by omitting the field, so "shares the account
pool" and "we were refused `GetFunctionConcurrency`" arrive from the SDK as the
same shape and must not arrive as the same shape here: EMPTY is the first, DENIED
the second, and a reservation of `0` is ACTUAL and renders as *"throttled to
zero and cannot be invoked at all"*, because folding it into "no reservation"
hides the loudest thing the read can find. Functions past
`CONCURRENCY_READ_BUDGET` carry UNCONFIGURED saying *"Not read is not
unreserved"* rather than being reported as sharing the pool.

**A denied tag read does not become an untagged estate.** `attributionOf({})`
answers `unattributed`, which MEANS "nobody tagged this" — so feeding it an empty
index because `tag:GetResources` was refused would report every function in the
account as untagged: a specific, actionable, false finding produced by a call
nobody was allowed to make. `FunctionAttribution` carries `known: false` and the
refused call's own sentence. The published `EstateResource` contract has no third
state for `tenantId`, and the code says so at the field rather than glossing it.

**Region and partition come from the resolved identity and from the ARNs the API
returned.** `residencyAnomalies()` reports a function whose ARN names a region
other than the one this engine resolved, which is the GE-010-007 shape.
`tests/security/no-hardcoded-estate.test.mjs` passes over the module.

**The throttle schedule is `throttle.ts`'s.** `readAws` is given
`attempts: READ_ATTEMPTS` and `backoffMs: backoffMs(2)`, which reproduces that
module's curve exactly; the test asserts the recorded waits are
`[backoffMs(2), backoffMs(3)]` and that the reported `retryAfterMs` equals
`backoffMs(READ_ATTEMPTS + 1)`. Two backoff curves would be two answers to "how
long until it tries again".

#### Mutations applied to the production path, and what caught them

| # | Mutation | Result |
| --- | --- | --- |
| M-L1 | `try { … } catch { return [] }` around the `ListFunctions` page loop | **5 red** — the denial rendered as an empty estate |
| M-L2 | `runtimeRiskLine` counts over the value regardless of read state | **2 red** — a refused read printed "no functions to check against the runtime calendar" |
| M-L3 | the `calendar.stale` degradation removed from `runtimeSupportFor` | **1 red** — a 104-day-old transcription still called a runtime supported |
| M-L4 | `describeReservedConcurrency` treats every non-ACTUAL as "no reservation" | **2 red** — a refusal claimed the function shares the account pool |
| M-L5 | `tagsUnavailable` pinned to `null` | **1 red** — a denied `tag:GetResources` reported all six functions unattributable |
| M-L6 | `backoffMs(2)` replaced with a literal `50` | **1 red** — the surface stopped using `throttle.ts`'s schedule |

Each was restored immediately and the suite returned to 23 green.

#### What is NOT closed, and is not claimed

- **The runtime calendar is a transcription, not a read.** AWS exposes the
  deprecation dates on a documentation page only. The dates below the stamp are
  the published ones; anything AWS announced after the stamp is not in it, which
  is exactly why a stale stamp withdraws SUPPORTED instead of keeping it.
- **No page imports this yet.** The module is the data layer; the route that
  renders it is another agent's file, and until that lands nothing in the running
  product calls `lambdaInventory`.
- **Reserved concurrency is read for the first `CONCURRENCY_READ_BUDGET` (100)
  functions.** `GetFunctionConcurrency` has no bulk form and shares an
  account-wide throttle with the deploy pipeline. Functions past the budget are
  UNCONFIGURED, never "unreserved".
- **Nothing here decides whether a function is unmanaged.** No
  `aws_lambda_function` exists in `infrastructure/`, so an expected-set
  comparison would be a claim this repository cannot support; `drift.ts` owns
  that question.
- **`docs/architecture/ownership.md` is stale by exactly one file** because this
  module is new. It is a shared generated artefact that every service agent in
  this batch staled; regenerating it belongs to one `npm run generate` after they
  all land, not to seven concurrent writers.
