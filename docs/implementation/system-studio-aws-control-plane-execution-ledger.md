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

#### EMPTY is not "unknown", and the first version of this module got that wrong

`secretPosture` originally answered `{kind:"unknown"}` for any listing that was
not ACTUAL or STALE — which swept EMPTY in with DENIED, THROTTLED and ERROR. But
`readAws` produces EMPTY only after the call RESOLVED, so "there are no secrets in
this account and region" is a fact the engine established, and answering "we do
not know" to a question it can answer is the same collapse this whole read plane
exists to refuse, one size down. It was caught on review rather than by a test,
which is worth recording: the four-outcome test proved the four SURFACES differ,
and they did — it did not prove the posture arm was right.

Fixed by giving `PaginationBound` a `no-secrets` arm (separate from `complete`
with a count of zero, because the page count is not recoverable from an EMPTY
reading and stating a number this engine did not observe is the habit the module
is against), an explicit EMPTY branch in `secretPosture`, and a dedicated sentence
in `describeSecretPosture` — because "every secret that was read has rotation
configured" is TRUE of an empty account and reads as a clean bill of health for
one. M-S11 and M-S12 below are the two mutations that now catch it.

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

## STUDIO-070-004 (KMS) — the keys, their managers, and the ones that are not rotating

`kms:ListKeys` had been in the capability registry since the read plane was
built and nothing ever called it. Even if something had, a list of key ids is
not an answer. `apps/system-studio/src/lib/aws/keys.ts` joins the listing to
`kms:DescribeKey` and `kms:GetKeyRotationStatus` — the two capabilities the
foundation agent added in this batch — so a key id becomes a description, a
state, a manager, a rotation status and a tenant.

### The rule this module exists to enforce

An AWS-managed key is **not** a passing check. Every account carries dozens of
`aws/…` keys that AWS rotates on its own schedule and that no customer can
configure. Counting them as "rotating" reports 96% compliance for an estate
whose every controllable key is non-compliant. `KeyRotationPosture` therefore
keeps them in `awsManagedExcluded`, which appears in no compliant total; the
denominator `customerManagedRead` is exactly `rotating + notRotating.length`,
and `notRotating` holds key ids rather than a count. There is no percentage
field anywhere in the module.

Four further categories are kept apart rather than folded: `notApplicable`
(asymmetric, HMAC, imported-material and custom-key-store keys, on which
rotation cannot be enabled and whose absence is not a finding),
`rotationUnknown` (the read was refused, throttled or broken — never rendered
as on and never as off), `unrecognisedManagement` (a `KeyManager` value this
engine does not know, which is neither guessed into the denominator nor out of
it) and `unreadable` (`DescribeKey` did not answer). `posture.complete` is
false whenever any of those is non-empty or the listing was truncated, so a
partial count can never be presented as a verdict.

A key in `PendingDeletion` carries the deletion date and the remaining window;
`describeLifecycle` refuses to print the state without them, because "pending
deletion" with no date is a warning nobody can schedule around.

### Evidence

| Check | Command | Result |
| --- | --- | --- |
| Unit suite | `npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/keys.test.ts` | 27 passed, 27 total |
| Types | `npx tsc --noEmit -p apps/system-studio/tsconfig.json` | no error in `keys.ts` or `keys.test.ts` |
| One-owner SDK rule | `node --test tests/architecture/forbidden-clients.test.mjs` | 6/6 pass |
| No Prisma on the operator plane | `node --test tests/security/operator-plane-content.test.mjs` | 5/5 pass (11/11 with the above) |

### Mutations applied to the PRODUCTION path, each red, each restored

| # | Mutation in `keys.ts` | Result |
| --- | --- | --- |
| M-K1 | the non-ACTUAL listing branch returns `{state:"EMPTY"}` instead of the reading | **2 red** — a refused `kms:ListKeys` rendered as "none" |
| M-K2 | the `aws-managed` arm of `rotationStateFrom` returns `{kind:"enabled"}` | **4 red** — an AWS-managed key counted as a compliance pass |
| M-K3 | the final `unknown` arm of `rotationStateFrom` returns `{kind:"enabled"}` | **2 red** — a refused and a throttled rotation read both claimed the key rotates |
| M-K4 | `if (!marker) break` replaced with an unconditional `break` | **2 red** — the reader returned page one and called it the estate |
| M-K5 | `hadMore = true` at the page bound replaced with `hadMore = false` | **1 red** — the bound was hit and the listing still reported "complete" |
| M-K6 | `attributionFor`'s unreadable-tag-index guard returns `{kind:"unattributed"}` | **1 red** — a denied `tag:GetResources` reported every key untagged |
| M-K7 | `lifecycleOf` maps `PendingDeletion` to `{kind:"other"}` | **1 red** — a key scheduled for deletion lost its date |
| M-K8 | `if (false && detail.keySpec !== …)` in `rotationInapplicableReason` | **3 red** — an asymmetric key was asked for a rotation status and its `UnsupportedOperationException` became a finding |
| M-K9 | `refreshMs.keys` pinned to a literal `60_000` | **1 red** — the cadence stopped coming from the capability registry |
| M-K10 | `optionalBoolean(response?.KeyRotationEnabled) ?? false` with the throw disabled | **1 red** — a rotation answer AWS did not return rendered as "not rotating" |

Every one was restored immediately and the suite returned to 27 green. M-K8 and
M-K10 were deliberately written in the `if (false && …)` shape this programme
has already shipped five times; both are gone and the guard scan for
`false &&`, `|| true`, `MUTATION`, `TODO` and `FIXME` over both files is clean.

### What is NOT closed, and is not claimed

- **Aliases are not read.** A key's aliases are what make it legible —
  `alias/tenure-prod-rds` answers "what is this key for" better than most
  descriptions do. They come from `kms:ListAliases`, which is **not** in the
  capability registry: the required capability key is `kms:ListAliases` and the
  required IAM action is `kms:ListAliases`, scoped to `*` (the API enumerates
  and has no per-alias ARN to scope to). This module does not add capabilities —
  `client.ts` switches on the capability deliberately so there is no way to
  express "send this arbitrary command". Every key therefore carries
  `ALIASES_NOT_READABLE`, which names the capability and the action, and the
  surface prints it. This is an open gap, not a passing check.
- **No page imports this yet.** The module is the data layer; the surface that
  renders `kmsLines` is another agent's file.
- **Rotation is not asked for AWS-managed keys.** The call would answer `true`
  and that answer must not be counted, so spending an API call to obtain it
  would buy nothing. The `aws-managed` arm says exactly this rather than
  implying a read happened.
- **`docs/architecture/ownership.md` is stale by one file** because this module
  is new. Regenerating it belongs to one `npm run generate` against a clean
  tree, not to concurrent writers.

## STUDIO-070-004 (ECR) — what is actually deployed, and is it known-vulnerable

**No checkbox is moved by this entry.** STUDIO-070-004 is a service-adapter line
that several adapters contribute to; this one adds ECR and claims nothing beyond
what is proven below.

- **Was**: `infrastructure/terraform/ecr.tf` and `infrastructure/studio/ecr.tf`
  each create a repository with `scan_on_push = true` and a lifecycle policy, and
  nothing in the running product had ever issued an ECR call. The registry
  holding the image that serves the pilot was dark: a CRITICAL CVE that ECR found
  on push produced exactly the same console as a repository nobody had pushed to
  — nothing at all.
- **Now**: `apps/system-studio/src/lib/aws/ecr.ts`. `ecrReadings()` resolves
  identity, reads the tag index, lists every repository, and for each one reads
  its images and its lifecycle policy independently; it then reads scan findings
  for a budgeted set of images BY DIGEST. It returns `EcrReadings` —
  `AwsRead<readonly RepositoryReading[]>` for the listing, an
  `AwsRead<readonly ImageReading[]>` and an `AwsRead<LifecyclePolicy>` per
  repository, an `AwsRead<ScanDetail>` per image, a `DeployedRiskState`, a
  `Truncation`, the tag collisions, an explicit `asOf`, and all four
  capabilities' own `refreshMs` read from the registry rather than retyped.
- **Four capabilities, four readings**: `ecr:DescribeRepositories`,
  `ecr:DescribeImages`, `ecr:DescribeImageScanFindings` and
  `ecr:GetLifecyclePolicy` are four separate IAM actions. A refused
  `DescribeImages` names `ecr:DescribeImages` and prints THAT minimum statement,
  and the repository still appears saying it was refused — it does not vanish and
  it does not render as `0 image(s)`. A refused `GetLifecyclePolicy` does not hide
  the images, and a refused `DescribeImageScanFindings` keeps the severity counts
  the image listing already returned. This is `retained.ts`'s
  `backup:ListBackupVaults` lesson applied at construction time.
- **Correlation is by digest**: both repositories are
  `image_tag_mutability = "MUTABLE"`, which is precisely the mechanism by which a
  tag and a digest stop agreeing. Every reading is keyed on `imageDigest`, tags
  are a list hanging off a digest, `DescribeImageScanFindings` is called with
  `imageDigest` and never `imageTag` (asserted by a spy on the gateway), and a tag
  observed on more than one digest is REPORTED as a `TagCollision` rather than
  resolved — picking one would be inventing an answer to "which one is deployed".
- **A zero is not a clean bill**: `ImageVulnerability` has five arms — `findings`,
  `clean`, `not-scanned`, `scan-incomplete`, `unknown` — because five different
  facts otherwise render as "no CVE rows". `ScanOnPush` is a union whose
  `disabled` arm carries the sentence that says the absence of findings is an
  absence of scanning. `DeployedRiskState.clear` is reachable ONLY when every
  repository scans on push, every image list was readable and every image
  completed a scan with nothing in it; anything less is `unverified`, which prints
  as a sentence rather than a zero. `ScanNotFoundException` and
  `LifecyclePolicyNotFoundException` are caught inside their reads and returned as
  VALUES ("this image was never scanned", "nothing expires these images"), because
  reaching `readAws` they would classify as ERROR — a red box on the two facts an
  operator most needs stated plainly.
- **Pagination**: bounded and DECLARED. Unlike `sqs.ts`, which throws when it runs
  out of pages, a registry legitimately holds more images than a server render
  will walk, so hitting the bound is an expected state and travels as
  `Truncation`, which every renderer prints (`— TRUNCATED: … there were more`).
  What does not happen is a first page rendered as if it were the registry.
  Budgets: 20 repository pages, 10 image pages per repository, 5 finding pages per
  image, 100 repositories given a depth read, 40 images given a scan-detail read,
  25 findings named per image. The severity COUNTS are ECR's own whole-scan counts
  and are complete regardless of the sample cap; they are assigned per page, never
  accumulated, because `findingSeverityCounts` is repeated on every page and
  summing it multiplies every CVE by the page count.
- **Residency**: region and partition come from the `repositoryArn` AWS returns
  and, failing that, from the resolved identity. There is no region literal and no
  `"aws"` partition fallback in the file. A GovCloud identity produces
  `aws-us-gov` / `us-gov-west-1` throughout and the surface contains no commercial
  region string (asserted).
- **Attribution**: through `tags.ts` and the Resource Groups Tagging API, with a
  fourth answer `unknown` for when the tag index itself was denied, throttled or
  broken — "we could not look up this repository's tags" is not "this repository
  has no tenant tag".
- **What is NOT read, and is a value rather than a silence**: whether the registry
  runs ENHANCED scanning is `ecr:GetRegistryScanningConfiguration`, a
  registry-level action not in the capability registry and one this module did not
  add. `EcrReadings.enhancedScanning` carries a single NOT_READABLE arm naming it,
  and `ecrLines` always prints it, so a basic-scan clean bill cannot be read as
  covering the application layer.

### Proof

`apps/system-studio/src/lib/aws/ecr.test.ts` — 33 tests, green, run with
`npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/ecr.test.ts`.
The stand-in answers six capabilities with the SDK's own response shapes and can
fail each independently with `AccessDeniedException`, `ThrottlingException`, an
empty-but-successful response or a populated one; the four render as four
pairwise-distinct surface strings (asserted with a `Set` of size 4). Every account
id in the fixture is the obviously-constructed `123456789012`.

Ten mutations were applied to the PRODUCTION module, the suite run, and the module
restored byte-for-byte (verified by comparing the restored file to the copy taken
before the first mutation):

| # | Mutation | Result |
| --- | --- | --- |
| M-1 | `if (repo.scanOnPush.kind !== "enabled")` becomes `if (false && …)` | **2 red** — the scan-on-push finding stopped being raised |
| M-2 | the repository listing's `token = response?.nextToken` becomes `token = undefined` | **2 red** — a first page passed off as the registry |
| M-3 | `counts = severityCounts(…)` accumulates across finding pages instead | **1 red** — 1 CRITICAL rendered as 3 |
| M-4 | `mergeVulnerability` returns `{kind:"clean"}` when the detail read failed | **2 red** — a denial and a throttle both became a clean bill |
| M-5 | `imageDigest: digest` becomes `imageTag: "latest"` in the scan read | **8 red** — the gateway spy and every scan-derived assertion |
| M-6 | the unreadable-tag-index guard in `attributionFor` becomes `if (false && …)` | **1 red** — a denied tag index rendered as "unattributable" |
| M-7 | `backoffMs: backoffMs(2)` becomes `backoffMs: 50` | **1 red** — the surface stopped using `throttle.ts`'s schedule |
| M-8 | the `LifecyclePolicyNotFoundException` catch becomes `if (false && …)` | **1 red** — "no lifecycle policy" became a red ERROR box |
| M-9 | an unparseable lifecycle policy returns `absent` instead of `unreadable` | **1 red** |
| M-10 | a missing scan status returns `{kind:"clean"}` instead of `not-scanned` | **1 red** |

Each was restored immediately and the suite returned to 33 green. No guard,
assertion or check was left disabled.

`tests/security/operator-plane-content.test.mjs` (5 pass) and
`tests/architecture/forbidden-clients.test.mjs` (6 pass) are green with this file
present: it imports no Prisma client and no AWS SDK package, and it contains no
endpoint literal — the fixture assembles registry hosts from parts for exactly
that reason.

#### What is NOT closed, and is not claimed

- **No page imports this yet.** The module is the data layer; the route that
  renders it is another agent's file, and until that lands nothing in the running
  product calls `ecrReadings`.
- **Enhanced-scanning coverage is unknown, not absent.** See above. A repository
  reporting zero findings under BASIC scanning has had its OS packages assessed
  and its application dependencies not assessed, and this engine cannot tell which
  regime is in force.
- **Nothing here decides whether a repository is unmanaged.** Two
  `aws_ecr_repository` resources exist in `infrastructure/`, but the expected-set
  comparison belongs to `drift.ts`, not to a service adapter.
- **Scan findings are read for the first `MAX_SCAN_DETAIL_READS` (40) images
  across the whole load.** `DescribeImageScanFindings` has no bulk form. Images
  past the budget keep the severity counts `DescribeImages` returned beside them
  and carry an UNCONFIGURED detail read — never "no findings".
- **`docs/architecture/ownership.md` is stale by exactly one file** because this
  module is new. Regenerating it belongs to one `npm run generate` against a clean
  tree after this batch lands, not to concurrent writers.
- **A deliberate deviation from "mark it shared where no tag says so".**
  `tags.ts` and `@tenure/provisioning` keep `shared` (a VALUE somebody set on
  `tenure:tenant`) apart from `unattributed` (nobody tagged it), and folding the
  two is how an untagged key gets billed to a tenant that did not create it. So
  a key with no tenant tag reads `unattributable — missing tenure:tenant`, not
  `shared`. A fourth answer, `unknown`, covers the case where the tag index
  itself could not be read.

## STUDIO-070-004 (CloudWatch Logs) — retention posture, silence, and bounded evidence

`apps/system-studio/src/lib/aws/logs.ts` + `logs.test.ts`. Added 2026-08-13.

CloudWatch Logs was dark. `infrastructure/terraform/ecs.tf:117` creates exactly
one log group — `/ecs/<name_prefix>`, 30 days, no `kms_key_id`, no `tags` block
— `cloudwatch.tf:116` builds a dashboard widget that greps it for `/ERROR/`, and
the only `logs:` call anywhere in the product was `retained.ts`'s tenant-scoped
`DescribeLogGroups`. The console could not say how many groups the account
holds, which will never expire, how many bytes they bill for, whether any
carries a customer key, or whether the one group Terraform declares is still
receiving anything.

### What it reads, and through which capability

| Capability (from the registry, unchanged) | What it answers |
| --- | --- |
| `logs:DescribeLogGroups` | every group, paged: retention, stored bytes, KMS key, class, data-protection status, ARN |
| `logs:DescribeMetricFilters` | per group, its own `AwsRead`: which patterns turn a line into a metric |
| `logs:FilterLogEvents` | bounded evidence, and the opt-in silence probe |
| `tag:GetResources` (via `tags.ts`) | tenant attribution, with `unknown` when the index itself was not read |
| `sts:GetCallerIdentity` (via `identity.ts`) | region and partition — never a literal |

No capability was added and `capabilities.ts` was not edited.

### The four decisions worth reviewing

- **`retentionInDays` absent is a FINDING, not an unknown.** AWS defines the
  omission as "Never expire", so `classifyRetention` returns `never-expires`
  with its own sentence about an unbounded bill. Rendering it as unknown would
  hide the exact defect the module exists to surface. Below
  `SHORTEST_USEFUL_RETENTION_DAYS` (7, named after the weekly on-call rotation)
  it returns `too-short` — the opposite defect, and separately named.
- **Silence is opt-in and reports a BOUND, never an exact age.** Deciding
  whether a group is silent costs a billed `FilterLogEvents` call, so every
  group carries `NOT_PROBED` unless a caller passes `probeSilenceWindowMs`.
  `RECEIVING` carries `mostRecentSeenAt`, explicitly a LOWER bound (one page,
  interleaved streams), and `ageMsUpperBound`. `SILENT` claims only "nothing in
  the last N ms". The probe discards every message inside the module — only a
  timestamp leaves it.
- **The events read refuses rather than redacting.** A group whose NAME matches
  `TENANT_DATA_MARKERS` returns no events at all unless the caller sets
  `acknowledgeTenantData`. `no-marker` is explicitly NOT a certification and
  says so in its own `why`; this engine reads names, not content. An empty
  filter pattern is rejected by name, because `client.ts` sends `""` as
  `undefined`, which matches every line in the window.
- **The trailing `:*` trap.** `DescribeLogGroups` returns
  `…:log-group:/ecs/tenure-prod:*`; the Resource Groups Tagging API returns the
  same group without it. Joined raw, every log group in the estate misses the
  tag index and renders as unattributable — a tagging failure that is not there.
  `normalizeLogGroupArn` strips it once, on the way out of the API.

### Bounds, and the signal when one is hit

| Bound | Value | What is returned when it is hit |
| --- | --- | --- |
| `MAX_LOG_GROUP_PAGES` | 20 (about 1000 groups) | `completeness: {kind:"truncated"}`, printed by `logsLines` |
| `MAX_METRIC_FILTER_READS` | 100 groups | that group's filters are `UNCONFIGURED`, never `EMPTY` |
| `MAX_EVENTS_RETURNED` | 200 | `hasMore: true` + `moreWhy`; no continuation token is handed back |
| `MAX_EVENT_PAGES` | 5 | same |
| `MAX_EVENT_WINDOW_MS` | 7 days | query `REJECTED` as `WINDOW_TOO_WIDE` — rejected, not clamped |
| `MAX_MESSAGE_CHARS` | 4000 | `messageTruncated: true` plus the original `messageChars` |

### Evidence

```
npx tsc --noEmit -p apps/system-studio/tsconfig.json     # no error in logs.ts / logs.test.ts
npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/logs.test.ts
                                                          # Tests: 33 passed, 33 total
node --test tests/security/operator-plane-content.test.mjs \
            tests/architecture/forbidden-clients.test.mjs \
            tests/security/studio-task-role-is-narrow.test.mjs   # 22 pass, 0 fail
```

The stand-in answers five capabilities with the shapes the SDK returns and can
fail each independently. The empty `DescribeLogGroups` answer OMITS `logGroups`
entirely, which is what AWS actually sends; every fixture ARN carries the
trailing `:*`. The case named "the four render as four visibly different
surfaces" asserts the four outcome strings are pairwise distinct, which is the
assertion a fake returning `[]` regardless would fail.

### Mutations applied to the PRODUCTION path, each red, each restored

| # | Mutation in `logs.ts` | Result |
| --- | --- | --- |
| M-L1 | `try { … } catch { return [] }` around the `DescribeLogGroups` page loop | **3 red** — the denial and the throttle both rendered as an empty estate |
| M-L2 | absent `retentionInDays` classified as `{kind:"retained", days:0}` | **2 red** — "Never expire" printed as a setting somebody chose |
| M-L3 | `normalizeLogGroupArn` returns the ARN unchanged | **1 red** — every tagged group rendered unattributable |
| M-L4 | `if (false && sensitivity.kind === "tenant-data" && …)` | **1 red** — a tenant-data group returned its events unacknowledged |
| M-L5 | `if (false && token)` at the event cap | **1 red** — 200 of 337 events returned with `hasMore: false` |
| M-L6 | a refused freshness probe returns `SILENT` instead of `UNREADABLE` | **2 red** — a denial and a throttle both rendered as a quiet service |
| M-L7 | `backoffMs(2)` replaced with a literal `50` | **1 red** — the surface stopped using `throttle.ts`'s schedule |
| M-L8 | groups past the filter budget report `EMPTY` instead of `UNCONFIGURED` | **1 red** — "no metric filters" claimed for groups nobody read |
| M-L9 | `if (false && !pattern)` — the empty-pattern guard | **1 red** — an empty filter went to AWS as no filter at all |
| M-L10 | `if (false && page === MAX_LOG_GROUP_PAGES - 1) seen.truncated = true` | **1 red** — the first 20 pages rendered as the whole estate |

Each was restored immediately; `diff` against the pre-mutation copy is empty and
the suite returned to 33 green.

### What is NOT closed, and is not claimed

- **The exact age of a group's last event is not readable by this engine.**
  `logs:DescribeLogStreams` (IAM action `logs:DescribeLogStreams`) is the call
  that would answer it — `orderBy: LastEventTime`, descending, limit 1 — and it
  is NOT in the capability registry. This module did not add it. What is built
  instead is a bounded probe over `logs:FilterLogEvents`, which answers
  "receiving, or silent for at least N" and says so on the type. Adding the
  capability is a registry change and a `studio-task-role-is-narrow` review, not
  a service agent's edit.
- **`no-marker` is not a clean bill of health.** The tenant-data guard is a rule
  about NAMES. A group carrying student identifiers under a name that says
  nothing will not be marked, and the `no-marker` arm's own `why` states this so
  no surface can render it as "safe".
- **No page imports this yet.** The module is the data layer; the route that
  renders it is a surface agent's file, and until that lands nothing in the
  running product calls `logGroupReadings` or `filterLogEvents`.
- **No approval, review or certification is recorded here.** Nothing in this
  module writes an audit event, and nothing in it decides that a retention
  setting is acceptable — it reports the setting and names the defect.
- **`docs/architecture/ownership.md` is stale by exactly one file** because this
  module is new. Regenerating it belongs to one `npm run generate` against a
  clean tree after this batch lands, not to concurrent writers.

## STUDIO-070-004 (CloudWatch metric data) — the number behind the alarm

`alarms.ts` reads alarm STATE and, until this module, nothing in this engine had
ever read a metric. An alarm's state is a step function over a number nobody here
could look at, so a queue whose backlog went 12 → 190 → 412 in three minutes
rendered as `OK` right up to the moment it did not. `sqs.ts` said the same thing
from the other side: its `OLDEST_MESSAGE_NOT_READABLE` names
`cloudwatch:GetMetricData` as the capability that would answer "how old is the
oldest message", and that capability had no reader.

`apps/system-studio/src/lib/aws/metrics.ts` is that reader, behind the capability
the registry already declares (`cloudwatch:GetMetricData`, `resource: "*"`,
`refreshMs: METRIC_DATA_TTL_MS`). No capability, IAM action or client command was
added; `client.ts` already dispatches this capability and already drops the
`Expression` field, so `SEARCH()` remains unreachable from here.

### A gap is not a zero, and that is the whole point

CloudWatch does not publish a datapoint for a period in which nothing happened.
Filling that period with `0` turns "the agent stopped reporting" into "the queue
is empty". So `MetricSummary` is a union — `datapoints` | `no-datapoints` |
`not-read` — with **no optional mean**, which is the `AwsRead<T>` mechanism
applied one level down: a caller cannot reach `.mean` on a series that has none.
`Coverage` publishes `expectedDatapoints` (window ÷ period),
`presentDatapoints`, `missingDatapoints` and `malformedDatapoints`, so sparsity
is a number on the page rather than something a reader has to notice. A sparse
series with three datapoints in a sixty-period window has `mean` 20, not 1: the
mean is over what was published, and the 57 gaps are reported as gaps.

### Refused per metric, not only per call

`GetMetricData` answers 200 and still refuses an individual query with
`StatusCode: "Forbidden"` when a policy condition scopes the grant. That result
carries no values, and a reader mapping "no values" to "no data" would print "no
datapoints in this window" about a metric it was not allowed to read. Every
series therefore carries its own `SeriesStatus`; `Forbidden`, `InternalError` and
"CloudWatch returned no result for this id at all" all summarise as `not-read`
with the status code, never as an absence. `PartialData` is its own arm: the
summary is still shown, and the sentence says it is over a prefix. The sibling
metric in the same call is untouched — one refused detail does not collapse the
row.

### Bounded before it is expensive, refused rather than truncated

`GetMetricData` is billed per metric per request. The caller MUST name an
explicit window and it is checked (parseable, ordered, at least `MIN_WINDOW_MS`,
at most `MAX_WINDOW_MS` = 15 days); the implied datapoint count across every
query is capped at `MAX_TOTAL_DATAPOINTS` (100,800); at most
`MAX_QUERIES_PER_BATCH` (500, the API's own limit) go in one request and at most
`MAX_BATCHES` (4) requests are made. Period and statistic are validated against
what CloudWatch accepts — `ALLOWED_STATS` is a closed set, so metric-math-adjacent
forms such as trimmed means are refused. **A request that breaks a bound returns
UNCONFIGURED and no AWS call is made at all**; the test asserts
`cloudwatch:GetMetricData` and `tag:GetResources` are absent from the recorded
call list.

Pagination merges results for one id ACROSS pages (a reader that kept the last
page would return the oldest slice and call it the series), de-duplicates the
repeated boundary datapoint, and past `MAX_PAGES_PER_BATCH` returns
`Truncation: "more-available"` naming the affected keys — never a first page
rendered as the whole window.

### Independent degradation, in three places

One batch refused leaves the batches that answered ACTUAL, with the refused
batch's keys and its own `describeRead` sentence in `unreadableBatches`. Only when
NO batch produced a value does the failed reading travel to the top unchanged —
there is no branch that turns a denial into an array. The tag index is its own
reading, and the identity is its own reading; a denied `tag:GetResources` gives
`attribution: unknown`, never `unattributable`, because that sentence would send
an operator to add a tag that is already there.

`RequestCost` counts only requests that ANSWERED, and says so at the field: a
refused request is not a metric this account was charged for.

### Evidence

| Check | Command | Result |
| --- | --- | --- |
| Unit suite | `npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/metrics.test.ts` | **32 passed** |
| Types | `npx tsc --noEmit -p apps/system-studio/tsconfig.json` | no error in `metrics.ts` / `metrics.test.ts` |
| Client isolation | `node --test tests/architecture/forbidden-clients.test.mjs tests/security/operator-plane-content.test.mjs` | 11 pass |
| No literal estate | `node --test tests/security/no-hardcoded-estate.test.mjs` | 3 pass |

The four outcomes are asserted to render as four PAIRWISE DISTINCT strings, and
the fake is a client rather than a stub: it reads the `MetricDataQueries` it was
sent, answers per query, returns timestamps NEWEST FIRST (because `client.ts`
sends `ScanBy: "TimestampDescending"`), and can fail STS, the Tagging API and
GetMetricData independently. The account id in the fixtures is `123456789012`,
AWS's own documentation placeholder — no real account, ARN or principal appears
in this suite.

#### Mutations applied to the production path, and what caught them

| # | Mutation | Result |
| --- | --- | --- |
| M-M1 | `summarise`'s `not-read` guard switched off (`if (false && status.kind === "not-read")`) | **2 red** — a Forbidden metric summarised as "no datapoint" |
| M-M2 | the all-batches-failed return replaced with `{ state: "ACTUAL", value: [] }` | **3 red** — DENIED, THROTTLED and EMPTY all rendered as an empty series |
| M-M3 | `missingDatapoints: Math.max(0, expected - deduped.length)` became `missingDatapoints: 0` | **2 red** — 60 gaps and 57 gaps both reported as none |
| M-M4 | `backoffMs: backoffMs(2)` became `backoffMs: 50` | **1 red** — `retryAfterMs` 200 instead of `throttle.ts`'s 800 |
| M-M5 | `if (invalid !== null)` became `if (false && invalid !== null)` | **8 red** — every unbounded, backwards, over-budget and malformed request was sent to AWS |
| M-M6 | page merge replaced by a fresh `RawSeries` per page (last page wins) | **1 red** — the merged series lost page one |
| M-M7 | `const region = identityResolved ? identity.value.region : null` became `: "us-east-1"` | **1 red** — the GE-010-007 shape, caught at the assertion that an unresolved identity leaves region null |
| M-M8 | `if (page === MAX_PAGES_PER_BATCH - 1)` became `if (false && …)` | **1 red** — a truncated series reported `complete` |
| M-M9 | an unusable datapoint pushed as `{ value: 0 }` instead of counted malformed | **1 red** — a NaN became a zero in the mean |
| M-M10 | `wantsTags = specs.some(…)` gained a trailing `or true` | **1 red** — the Tagging API was called for a load that could attribute nothing |
| M-M11 | the tag-index guard in `attributionFor` switched off (`if (false && …)`) | **1 red** — a denied tag index reported the metric `unattributed` |

Each was applied to `metrics.ts` (never to the test's helper), run, confirmed
red, and restored; the file was diffed byte-for-byte against its pre-mutation
copy afterwards and the suite returned to 32 green. No `false &&`, `|| true`,
`// MUTATION` or stub remains in the shipped file — a grep over it for those
strings returns nothing.

#### What is NOT closed, and is not claimed

- **No page imports this yet.** The module is the data layer; the surface that
  renders it is another agent's file, and until that lands nothing in the running
  product calls `metricReadings`. The exported renderers (`metricLines`,
  `describeSeries`, `describeSummary`, `describeTruncation`,
  `describeMetricAttribution`) are what a surface is expected to print, so a
  denial cannot be worded as an absence on one surface and correctly on another.
- **Metric-math is unreachable, deliberately.** `client.ts` drops `Expression`,
  so only an explicit namespace/name/dimension triple can be asked for. A caller
  that wants a ratio computes it from two series.
- **`GetMetricStatistics` and `ListMetrics` are not read.** Discovering which
  metrics EXIST is a different capability and this module does not invent one:
  the caller names the metrics it wants.
- **The cost figures are counts, not a bill.** They are the billed UNIT
  (metrics × requests), not a price; the Price List API is another module's read.
- **Alarm-to-metric joining is not done here.** `alarms.ts` reads alarm state and
  does not expose the `MetricName`/`Dimensions` an alarm watches; wiring the two
  together means changing that file, which belongs to whoever owns it.
- **`docs/architecture/ownership.md` is stale by exactly one file** because this
  module is new. Regenerating it belongs to one `npm run generate` against a
  clean tree after this batch lands, not to concurrent writers.

## STUDIO-070-004 (CloudTrail) — the trail that describes perfectly and records nothing

- [x] `cloudtrail:GetTrailStatus` is read live, per trail, behind the typed capability
- [x] `cloudtrail:LookupEvents` is read live, bounded, with retention and throttle
      states kept distinct from "nobody changed it"
- [x] STUDIO-000-007 — every arm of `AwsRead` is reachable on both reads and each
      says something visibly different
- [x] STUDIO-000-009 — region and partition resolve from the trail's own ARN and
      the resolved identity; no literal region and no `"aws"` partition fallback
- [x] STUDIO-070-002 — every trail is attributed through `tags.ts`, with a fourth
      `unknown` answer for a tag index that could not be read
- [ ] No surface imports it yet. The route that renders it is another agent's file.

**File:** `apps/system-studio/src/lib/aws/trail.ts`
**Test:** `apps/system-studio/src/lib/aws/trail.test.ts` — 38 tests, green
(`npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/trail.test.ts`)

### What was actually wrong

`posture.ts` already read `cloudtrail:DescribeTrails` and asked it a
configuration question — is there an organization trail, is it multi-region, is
log-file validation on. Every one of those answers is byte-identical for a trail
that is logging and a trail somebody stopped three weeks ago. `DescribeTrails`
describes a trail's DEFINITION; it has no field saying the trail is running and
no field saying the last delivery failed.

Nothing in this repository had ever issued a `GetTrailStatus`. So `/platform`
could render a green "organization trail, multi-region, with log-file
validation" row over an account that had recorded nothing since a bucket policy
changed underneath it, and the first hint would be the day somebody asked who
deleted a database and there was no answer.

`trail.test.ts` proves the closure directly: the case
*"the SAME configuration reads healthy or stopped purely from GetTrailStatus"*
asserts that two loads carrying identical `DescribeTrails` facts — same
multi-region flag, same validation flag, same bucket — render as different
surfaces, one `LOGGING —` and one `NOT LOGGING`.

### Three facts, kept apart

| Fact | Read | Failure it catches |
| --- | --- | --- |
| the trail EXISTS | `DescribeTrails` | no trail at all |
| the trail is LOGGING | `GetTrailStatus.IsLogging` | somebody stopped it |
| the trail is DELIVERING | `LatestDeliveryTime`, `LatestDeliveryError` | bucket policy, KMS key or bucket refusing the write while `IsLogging` stays true |

The third is the quiet one, and it gets its own `LoggingState` arm —
`logging-delivery-failing` — whose sentence is "LOGGING BUT NOT DELIVERING …
Events are being captured and lost." A surface that printed `IsLogging` alone
would be a green light over a silent trail.

`logging-delivery-overdue` is deliberately named as a suspicion and not a
verdict: `DELIVERY_OVERDUE_AFTER_MS` is six hours, and its `why` says out loud
that an account with genuinely no API activity looks the same. That is a
judgement, so it is stated rather than hidden inside a boolean.

### Bounds, and the signal when one is hit

`MAX_TRAIL_STATUS_READS` is 64 and status reads run 6 at a time. Trails past the
cap carry an UNCONFIGURED status whose `why` says the engine stopped — never
"healthy". `MAX_LOOKUP_PAGES` is 20 against the `MaxResults: 50` that
`client.ts` pins, `DEFAULT_MAX_EVENTS` is 500 and `ABSOLUTE_MAX_EVENTS` is 1000.
Hitting either bound produces `truncation.kind === "more-available"` with the
continuation token — including the case where the cap cuts the LAST page short
and there is no token at all, where `nextToken` is null and the truncation
signal still stands, because events AWS sent were still dropped.

### Three things `LookupEvents` must never be confused with

1. **A throttle is not an empty history.** `LookupEvents` is throttled harder
   than any other read here. It comes back THROTTLED with `retryAfterMs` from
   `throttle.ts`'s curve, and the rendered text contains neither "none" nor
   "0 management event".
2. **A denial is not an empty history.** DENIED carries the principal,
   `cloudtrail:LookupEvents` and the pasteable statement, and has no `value`
   field for a caller to reach.
3. **A window past retention is not silence.** CloudTrail's event history holds
   90 days. A query reaching further back returns less and reads exactly like a
   quiet period, so every result carries a `coverage` union whose
   `partly-before-retention` arm names the earliest readable moment, computed
   from the injected clock rather than a literal.

### A deviation, stated

The brief for this batch said "mark it shared where no tag says so". This module
does not, and neither does `sqs.ts`: `tags.ts` keeps `shared` (somebody decided,
via the shared sentinel value of `tenure:tenant`) apart from `unattributed`
(nobody tagged it), because folding them bills an untagged resource to a tenant
that did not create it. A fourth arm, `unknown`, covers the case the three
cannot express — the tag index is its own AWS read and it can be denied.

### What this module deliberately does NOT carry

`requestParameters` and `responseElements` are dropped from the raw
`CloudTrailEvent` blob and never surfaced. They carry the ARGUMENTS of the call,
and this console renders into an operator plane that must not become a second
copy of student data. `detailsFrom` is a whitelist of five fields, and the test
*"the request payload never leaves the raw event"* asserts that a fixture blob
containing a password and a learner email address produces a serialised result
containing neither, while `sourceIPAddress` and the principal ARN survive.

### Mutations applied to the PRODUCTION path, each red, each restored

| # | Mutation | Result |
| --- | --- | --- |
| M-T1 | `if (false && !status.isLogging)` in `loggingStateOf` | **2 failed, 36 passed** — a stopped trail rendered as logging |
| M-T2 | the non-ACTUAL listing branch in `trailReadings` replaced with an ACTUAL `value: []` | **5 failed, 33 passed** — a denial rendered as an empty estate |
| M-T3 | `logging-delivery-failing` pushed onto `healthy` in `deliveryHealth` | **1 failed, 37 passed** — a trail losing events read as logging |
| M-T4 | the cap branch guarded with `&& false` | **2 failed, 36 passed** — a truncated answer claimed to be complete |
| M-T5 | `RETRY.backoffMs` replaced with a literal `50` | **3 failed, 35 passed** — the surface stopped using `throttle.ts`'s schedule |
| M-T6 | a denied tag index returned `{ kind: "unattributed" }` | **1 failed, 37 passed** — "we could not look" reported as "no tag" |
| M-T7 | the retention comparison guarded with `false &&` | **1 failed, 37 passed** — a 200-day window claimed full coverage |
| M-T8 | `GetTrailStatus` addressed by `configuration.name` instead of the ARN | **12 failed, 26 passed** — shadow trails answered `TrailNotFoundException` |
| M-T9 | `detailsFrom` returned the whole parsed blob | **2 failed, 36 passed** — the request payload reached the render |
| M-T10 | the missing-`IsLogging` throw guarded with `false &&` | **1 failed, 37 passed** — a status without `IsLogging` defaulted instead of erroring |
| M-T11 | `region: callerRegion` regardless of the trail's ARN | **1 failed, 37 passed** — a us-east-1 trail reported as eu-west-2 |
| M-T12 | the window validation guarded with `false &&` | **2 failed, 36 passed** — an inverted window sent to AWS and rendered as no events |

Each was restored immediately and the suite returned to 38 green. A final grep
for `MUTATION`, `false &&` and `&& false` across both files returns only
legitimate `.toBe(false)` assertions in the test.

### What is NOT closed, and is not claimed

- **No page imports this yet.** The module is the data layer; the route that
  renders it is another agent's file, and until that lands nothing in the
  running product calls `trailReadings` or `lookupManagementEvents`. The
  production path is the default `liveGateway()` branch of both exported
  functions.
- **Not verified against a real AWS account.** There is no AWS Organization and
  no credentialed environment available to this agent, so every reading here is
  proven against a stand-in that reproduces the SDK's response and error shapes.
  Nothing in this entry claims a live call was made, and no account id, ARN or
  region in the test names a real resource — the account is the documentation
  placeholder `123456789012`.
- **`DescribeTrails` is not paginated by this engine** because the API is not
  paginated — `client.ts` sends `DescribeTrailsCommand({})` and CloudTrail
  returns the whole `trailList`. The pagination bound lives on `LookupEvents`,
  which is paginated.
- **`ListTrails` is not read**, so trails that exist in regions this engine is
  not calling from and are not multi-region replicas are not seen. That needs a
  capability the registry does not hold; adding one is not this agent's file.
- **Event data events are out of scope.** `LookupEvents` returns MANAGEMENT
  events only, by the API's own definition. Reading S3 or DynamoDB data events
  needs a Lake query or an Athena table over the bucket, neither of which is a
  capability in the registry.
- **`DELIVERY_OVERDUE_AFTER_MS` is a judgement, not a fact AWS states.** Six
  hours, argued in the module header, and its rendered sentence says an idle
  account looks the same.
- **`docs/architecture/ownership.md` is stale by exactly one file** because this
  module is new. Regenerating it belongs to one `npm run generate` against a
  clean tree after this batch lands, not to concurrent writers.

---

### Secrets Manager joins the live AWS reads — STUDIO-080-001 (partial), STUDIO-000-007, STUDIO-040-005 (extended)

**No checkbox is ticked by this entry.** STUDIO-080-001 asks for a
cross-account, cross-region inventory carrying cost, drift, retention and
deletion behaviour; what landed is one service's slice of it, in one region, and
saying otherwise would be a sign-off nobody gave. STUDIO-040-005 stays as it is —
it is about resolving a manifest's secret REFERENCE, which `secret-refs.ts`
already does; this is the inventory half beside it. The items stay as they are.

- Status of this slice: PASS
- Code: `apps/system-studio/src/lib/aws/secrets.ts`
- Tests: `apps/system-studio/src/lib/aws/secrets.test.ts` — 37 cases, all passing
  under `npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/secrets.test.ts`
- Evidence: twelve mutations applied to the production path, twelve caught after the
  suite was strengthened, all restored (M-S1 … M-S12 below); `md5sum` of the file
  after the last restore is identical to the pre-mutation snapshot.

**What it reads.** `secretsmanager:ListSecrets` paged by `NextToken`, and
`secretsmanager:DescribeSecret` per secret: name, ARN, KMS key, rotation state,
rotation schedule, rotation Lambda, last-rotated, last-changed, last-accessed,
next-rotation, created, owning service, deleted-date, and the replication status
that says which OTHER regions a secret's material has been copied into. Both
capabilities were already in the registry and in `client.ts`. Only one was
called, by `secret-refs.ts`, for one named reference at a time — so the service
could confirm a reference it was handed and could not enumerate anything. The
2026-08-13 audit ends with a shared secret in Secrets Manager and a sentence
saying it "should be rotated afterwards"; this reader is how that stops being a
note in a handoff document.

**It cannot read a value, and the argument is structural rather than a
convention.** The command that returns a secret's material is not imported here,
not imported by `client.ts`, and absent from `capabilities.ts`; `call()` in
`client.ts` switches on the capability so "send this arbitrary command" is not
expressible. `secret-refs.test.ts` fails the build if that command's name appears
in code anywhere under `apps/system-studio/src`, and `secrets.test.ts` asserts it
over this file specifically — assembling the forbidden string from parts, because
writing it out would make the test file the offender the guard deletes.

**Three answers where a lesser reader has one number.** "Which secrets have no
rotation", "which are past their interval" and "which are scheduled for deletion"
are the questions an operator asks, and each is a named list carrying the
attribution, not a count. `SecretPosture` is a union whose `unknown` arm is what a
refused listing produces: there is no arrangement of empty arrays that can say
"we were not allowed to look", which is why `{noRotation: []}` off a DENIED read
is not reachable.

**A cron() rotation schedule is not converted into an interval.** A cron
expression can mean "the first Monday of every third month". `RotationSchedule`
has a `cron` arm carrying the expression and saying the interval is not computed;
such a secret is decided from AWS's own `NextRotationDate` or lands in
`undetermined`, never in `overdue`. A guessed interval is how a secret is reported
late against a cadence nobody set. Equally, a configured rotation that has NEVER
run is `never-rotated` and lands in `undetermined` rather than in the healthy
count — "0 days overdue" is a number where a sentence belongs.

**The deletion recovery window is bounded, not stated.** `RecoveryWindowInDays`
is an argument to `DeleteSecret` and is returned by no read this engine holds. So
the module states what it observed — the moment deletion was requested — plus the
fact that carries the information: the secret is still being LISTED, and a secret
whose window has closed is permanently deleted rather than listed, so the window
is still running as of the reading. The end of the window is given only as AWS's
documented 7-to-30-day bound, labelled as a bound. A single date there would have
been an invention.

**Pagination is walked to completion, bounded, and says when it stopped.**
`MAX_LIST_PAGES` is 20 at the API's 100 per page. `sqs.ts` throws on reaching its
bound; this module takes the third option and renders what it read while SAYING
it is partial — `PaginationBound.truncated` — and that qualifier travels onto the
posture line, so "3 have no rotation" is never read as a fact about the account.

**One denied sub-call degrades one row.** `DescribeSecret` is granted in the
registry only on `arn:*:secretsmanager:*:*:secret:tenure/*`, so a refusal on any
secret outside that namespace is EXPECTED, not exceptional. The row stays,
reports its rotation posture from the listing, and carries DENIED naming
`secretsmanager:DescribeSecret` with the scoped statement that would widen it —
never `secretsmanager:ListSecrets`, which the operator already holds. A refused
detail renders through `describeRead` and never as "not replicated to any other
region".

**A denied tag read does not become an untagged estate.** `attributionOf({})`
answers `unattributed`, which MEANS "nobody tagged this". `SecretAttribution` has
a fourth arm, `unknown`, and carries the source that decided it — because this
reader has two: the Resource Groups Tagging API index `tags.ts` owns, used first
as every module in this directory does, and the secret's OWN `Tags`, which
`ListSecrets` returns from the service that owns them and which is used when the
index does not carry the ARN or could not be read. An attribution from the owning
service beats "unknown"; discarding it to keep a rule tidy would have been
throwing a fact away.

**Region and partition come from the ARN AWS returned and from the resolved
identity.** No region literal and no `"aws"` fallback appears in the file;
`tests/security/no-hardcoded-estate.test.mjs` passes over it. Where AWS returned
no ARN the module refuses to assemble one — a secret ARN carries a
six-character suffix AWS generates, so an assembled ARN resolves to nothing —
and says so in `arnProvenance` rather than going quiet.

**The throttle schedule is `throttle.ts`'s.** `readAws` is given
`attempts: READ_ATTEMPTS` and `backoffMs: backoffMs(2)`; the test asserts the
reported `retryAfterMs` is 800, which is that curve and not a literal.

#### A guard of mine that could not fail, found by mutating it

`projectEntry` is a whitelist: it is the layer that stops material in an API
response reaching a reading. Mutating it to `return { ...raw }` left the whole
suite GREEN, because no raw entry escapes `secretReadings` today — so the layer's
removal was invisible, which is the exact shape this programme has shipped five
times. It is now exported and asserted directly, on the grounds that it is on the
production path for every entry of every page and is the layer that survives a
future change which starts carrying an entry onto a row. The mutation is red at
37 cases. Recorded here rather than quietly fixed, because the interesting fact
is that the first version of the suite did not see it.

#### Mutations applied to the production path, and what caught them

| # | Mutation | Result |
| --- | --- | --- |
| M-S1 | `try { … } catch { return { entries: [], pagination: complete } }` around the `ListSecrets` page call | **5 red** — a denial, a throttle, an empty account and the posture all rendered identically |
| M-S2 | `secretPosture`'s non-ACTUAL guard replaced with `secrets.state === "ACTUAL" ? secrets.value : []` | **3 red** — a refused listing reported "every secret that was read has rotation configured" |
| M-S3 | the `truncated = true` signal replaced with a bare `break` | **1 red** — a partial listing rendered as the whole estate |
| M-S4 | `rotationAgeOf`'s `never-rotated` arm returns `within-interval` | **1 red** — a rotation that had never run counted as healthy |
| M-S5 | `deletionStateOf` returns `{kind:"active"}` unconditionally | **1 red** — a secret in its recovery window vanished from the posture |
| M-S6 | `attributionFor`'s `unknown` arm replaced with `unattributed` | **3 red** — a denied tag index reported the estate as untagged |
| M-S7 | `backoffMs(2)` replaced with a literal `50` | **1 red** — the surface stopped using `throttle.ts`'s schedule |
| M-S8 | `describeDetail` falls through to "not replicated to any other region" | **2 red** — a refused and a throttled detail both read as a reassuring default |
| M-S9 | the page loop `break`s unconditionally after the first page | **2 red** — three pages of secrets became one |
| M-S10 | `projectEntry` replaced with `return { ...raw }` | **1 red** — but only after the suite was strengthened; see below |
| M-S11 | `secretPosture`'s EMPTY arm disabled, so an empty account falls through to `unknown` | **1 red** — a read that answered "there are none" reported "we could not look" |
| M-S12 | `describeSecretPosture`'s empty-account sentence disabled | **1 red** — an account with no secrets rendered as a clean bill of health |

Each was restored immediately and the suite returned to 37 green; the file's
`md5sum` after each restore is the pre-mutation one
(`9faf9d28c0d8722d50c5d02a5fb70f8f`).

#### What is NOT closed, and is not claimed

- **No page imports this yet.** The module is the data layer; the surface that
  renders it is another agent's file, and until that lands nothing in the running
  product calls `secretReadings`.
- **One region.** `ListSecrets` is regional and this engine resolves one region
  from the identity. A secret that exists only in another region is not in this
  reading, and the module does not pretend otherwise — `PrimaryRegion` and the
  replication status are reported so a reader can see where material has been
  copied, but a cross-region sweep is STUDIO-080-001's scope, not this slice's.
- **Details are read for the first `MAX_DETAIL_READS` (200) secrets.**
  `DescribeSecret` has no bulk form and shares an account-wide throttle. Secrets
  past the budget carry UNCONFIGURED, never "no replicas".
- **Nothing here decides whether a secret is UNMANAGED.** No
  `aws_secretsmanager_secret` inventory exists in `infrastructure/` to compare
  against, so an expected-set comparison would be a claim this repository cannot
  support; `drift.ts` owns that question.
- **Nothing here rotates, deletes, restores or tags anything.** The reversible
  mutation set in `src/lib/aws/mutate.ts` is untouched, and no rotation or
  deletion capability was added to the registry. This reader makes the 2026-08-13
  audit's leftover VISIBLE; a human still has to rotate it.
- **`docs/architecture/ownership.md` is stale by exactly one file** because this
  module is new. It is a shared generated artefact that every service agent in
  this batch stales; regenerating it belongs to one `npm run generate` against a
  clean tree, not to concurrent writers.

---

### The VPC network joins the live AWS reads — STUDIO-070-004 (NETWORK adapter)

**No checkbox is ticked by this entry.** The eight EC2 describes are wired,
typed and mutation-proven, but nothing renders them: no route, page or
`SURFACES` entry imports `network.ts` today, so no operator can see any of it.
Ticking STUDIO-070-004 again on that basis would be a sign-off nobody gave. The
same is true of STUDIO-080-001 — this is one service's slice of an estate
inventory, in one region — so that item is left exactly as it is.

- **Was**: `infrastructure/terraform/vpc.tf` and `security_groups.tf` build a
  network the console could not see. An `aws_vpc_security_group_ingress_rule`
  with `cidr_ipv4 = "0.0.0.0/0"` on the database port rendered as nothing at
  all, and a subnet named `…-private-b` whose route table sends `0.0.0.0/0` to
  an internet gateway rendered as nothing at all.
- **Now**: `apps/system-studio/src/lib/aws/network.ts`. `networkReadings()`
  resolves identity, reads the tag index, and issues all eight EC2 describes —
  `ec2:DescribeVpcs`, `DescribeSubnets`, `DescribeRouteTables`,
  `DescribeInternetGateways`, `DescribeNatGateways`, `DescribeVpcEndpoints`,
  `DescribeNetworkAcls` and `DescribeSecurityGroups` — each as its own
  `AwsRead<PagedList<T>>`, plus an `InternetExposureState`, the drift
  candidates, the misnamed subnets, an explicit `asOf` and all eight
  capabilities' own `refreshMs` read from `capabilities.ts` rather than
  retyped. No capability was added: all eight already exist in the registry and
  all eight are already granted in `infrastructure/studio/iam.tf`.
- **Public is decided by the ROUTE TABLE, never by the name.**
  `subnetReachability()` finds the route table explicitly associated with the
  subnet, falls back to the VPC's MAIN table when there is none — which is what
  an unassociated subnet actually uses — and answers `unknown` when it finds
  neither. A route counts only when `State === "active"`, so a blackholed route
  to a detached gateway does not make a subnet public. `igw-` is AWS's own
  resource-id prefix, not a label; `eigw-` is excluded because an egress-only
  gateway accepts no inbound connection. `MapPublicIpOnLaunch` is carried as
  evidence and is not the classifier. The subnet's name is read for exactly one
  purpose — `contradictorySubnetNames()`, which reports a subnet named
  "private" that the routes prove is public.
- **0.0.0.0/0 and ::/0 on anything but 80 and 443 is the finding.**
  `opensBeyondWeb()` requires the covered port range to be a SUBSET of {80,
  443}, so a rule spanning 80–443 is a finding — it also opens 81 through 442 —
  and `-1` and ICMP are findings by construction. Egress open to the world is
  read, reported and deliberately NOT a finding: it is the AWS default and
  flagging it would bury the ingress findings.
- **An unused security group is not claimed, because it cannot be proven.**
  `ec2:DescribeNetworkInterfaces` is not in the registry and is the only call
  that answers "what is this attached to". `SecurityGroupUsage` therefore has a
  `referenced` arm for the attachments this engine CAN see — another group's
  rule naming it, a VPC endpoint listing it — and a `no-attachment-visible` arm
  naming that missing capability. The renderer never prints the word "unused",
  and a test asserts the rendered surface does not contain it.
- **Sub-calls degrade independently.** A refused `DescribeSecurityGroups` leaves
  the VPCs, subnets and route tables ACTUAL; a refused `DescribeVpcEndpoints`
  makes only group USAGE `unknown` and suppresses the drift list rather than
  reporting every group as drift; a refused `DescribeRouteTables` makes every
  subnet's reachability `unknown` carrying the route-table denial's own
  sentence — never `private`, which is the reassuring default the read plane
  exists to prevent.
- **Pagination is bounded and says so.** Every describe walks `NextToken` to
  completion up to `MAX_PAGES` (40 pages × `MaxResults: 100`). Hitting the cap
  sets `truncated` on the `PagedList` and the rendered line says *"TRUNCATED at
  the 40-page cap; there were more, and this is not the whole estate"*. The
  pages already read are KEPT rather than thrown away, because an estate larger
  than the cap must not render as nothing at all.
- **Residency**: region and partition come from the resolved identity, and each
  resource's account from its own `OwnerId` when AWS returned one. There is no
  region literal and no `"aws"` partition fallback in the file; with identity
  unresolved no ARN is assembled and the fields are null. A GovCloud identity
  produces `arn:aws-us-gov:ec2:us-gov-west-1:…` and the whole rendered surface
  contains no commercial region.
- **Attribution** goes through `tags.ts` and the Resource Groups Tagging API,
  with the resource's own `Tags` — which every EC2 describe returns — as the
  first source. `NetworkAttribution` therefore has no `unknown` arm, and that
  is a deliberate difference from `sqs.ts`: `ListQueues` returns no tags, so
  the index is its only source and "we could not look" is real; a described EC2
  resource is one whose tags were read. `source` records which read answered.
- **Mutation proven on the production path**, nine mutations applied to
  `network.ts` (never to the test, the fake or a helper), each run, each red,
  each restored:

| # | mutation applied to `network.ts` | result |
|---|---|---|
| M-N1 | `internetExposure` returns `closed` for a non-ACTUAL security-group read | RED ×3 |
| M-N2 | `subnetReachability` answers `private` when the route tables were not read | RED ×1 |
| M-N3 | `subnetReachability` classifies from the route table's NAME instead of its routes | RED ×1 |
| M-N4 | `opensBeyondWeb` drops the multi-port rule, so 0.0.0.0/0 on 80–443 passes | RED ×1 |
| M-N5 | `pageThrough` stops at the cap silently instead of setting `truncated` | RED ×1 |
| M-N6 | usage reports a drift candidate even when the endpoint read failed | RED ×1 |
| M-N7 | the retry schedule retyped as a literal `50` instead of `throttle.ts`'s `backoffMs(2)` | RED ×1 |
| M-N8 | `ec2Arn` ignores the resource's `OwnerId` and uses the caller's account | RED ×1 |
| M-N9 | attribution consults the tag index first, so a denied index loses the tenant | RED ×2 |

  All nine restored; the suite returned to 37/37 green. `network.ts` contains no
  `false &&`, no `|| true` and no mutation stub.

#### Evidence

- `npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/network.test.ts`
  — **37 passed, 37 total.**
- `npx tsc --noEmit -p apps/system-studio/tsconfig.json` — no error in
  `network.ts` or `network.test.ts`. The five remaining errors are in four other
  agents' concurrent files (`app/page.tsx`, `app/platform/page.tsx`,
  `lib/aws/elasticache.ts`, `lib/aws/keys.test.ts`).
- `node --test tests/security/no-hardcoded-estate.test.mjs` — 3/3 pass.
- `node --test tests/architecture/forbidden-clients.test.mjs` — 6/6 pass.
- `node --test tests/security/operator-plane-content.test.mjs` — 5/5 pass.
- The four outcomes are separated by assertion, not by claim: a populated list,
  an empty-but-successful list, `AccessDeniedException` and `ThrottlingException`
  produce four pairwise-distinct rendered surfaces, asserted twice — once over
  `ec2:DescribeSecurityGroups` and once over `ec2:DescribeVpcs`.

#### What is NOT closed, and is not claimed

- **No security group can be proven unused.** `ec2:DescribeNetworkInterfaces` is
  not in `capabilities.ts` and not granted in `infrastructure/studio/iam.tf`.
  Until both land, this module reports *drift candidates* and says what it did
  not read. Adding the capability is the registry owner's file, not this one's.
- **Managed prefix list contents are not read.**
  `ec2:GetManagedPrefixListEntries` is not a capability this engine holds, so a
  rule sourced from `pl-…` is shown as a named source and is neither counted as
  world-reachable nor treated as safe.
- **Nothing renders this yet.** `networkReadings()` reaches the real
  `EC2Client` through `liveGateway()` → `client.ts`, and the tests drive that
  exact function — but `SURFACES` in `lib/aws/result.ts` has no network entry
  and no route or page imports the module. That is the surface agent's item.
- **No EC2 read has been performed against a real AWS account.** Every case is a
  stand-in gateway raising the answers the real client raises. The same gate
  blocks GE-010 and STUDIO-GATE-010.
- **Flow logs, Transit Gateway and peering are not read.** Nothing in the
  registry covers `ec2:DescribeFlowLogs`, `ec2:DescribeTransitGateways` or
  `ec2:DescribeVpcPeeringConnections`, so a route pointing at a `tgw-` or
  `pcx-` target is reported as that target and is not followed.
- **No mutating EC2 call exists in this module or reachable from it.**
  `ec2:AuthorizeSecurityGroupIngress`, `RevokeSecurityGroupIngress` and
  `ModifySecurityGroupRules` are absent and stay absent: seeing an open port
  must not become the ability to change it.

## STUDIO-070-004 (LOADBALANCER) — the front door, and whether anything is served

- [x] **STUDIO-070-004 (load balancer adapter)** — Read every ALB/NLB, its
  scheme, its listeners with their protocols and certificate ARNs, its target
  groups, and `DescribeTargetHealth` for each, back through the typed
  capabilities. The service was DARK: `infrastructure/terraform/alb.tf`
  provisions a load balancer, a target group and a listener, and nothing in the
  running product had ever issued an `elasticloadbalancing:*` call.
  - Status: PASS
  - Evidence: `npm run test --workspace apps/web -- --ci lib.aws.loadbalancer`
    → 28 passed, 28 total, 1 suite. Production module
    `apps/system-studio/src/lib/aws/loadbalancer.ts`, consumed by
    `apps/system-studio/src/app/platform/network/page.tsx`.

**Files:** `apps/system-studio/src/lib/aws/loadbalancer.ts` (production),
`apps/system-studio/src/lib/aws/loadbalancer.test.ts` (28 cases).

### Why this one mattered

`ecs:DescribeServices` reports the tasks ECS believes it started.
`elasticloadbalancing:DescribeTargetHealth` reports how many of them the load
balancer will actually route to. Those two numbers disagree for the whole
duration of a failed deployment, silently — a service reads RUNNING while every
target is `draining` or `unhealthy`, and the estate is down. That is why
`TARGET_HEALTH_TTL_MS` is 10s where everything else in this module is 180s.

An unhealthy target carries its reason CODE and its description.
`Target.ResponseCodeMismatch` (the app answered, wrongly) and `Target.Timeout`
(the app did not answer) send an operator to completely different places.
`HealthReason` is a union whose `known: false` arm has NO `code` field, so a
surface cannot print an empty string where the one deciding token belongs.

### Five capabilities, five readings, degrading independently

`DescribeLoadBalancers`, `DescribeListeners`, `DescribeTargetGroups`,
`DescribeTargetHealth` and `DescribeRules` are five IAM actions and a role is
routinely granted some and not others. Each is its own `AwsRead`, so a denied
`DescribeTargetHealth` renders the minimum statement for the action that is
ACTUALLY missing, does not collapse the load balancer row, does not remove it,
and — the part that matters — does not render as "0 unhealthy targets".

### The plaintext-listener finding, and the claim it refuses to make

`alb.tf` line 43 is `protocol = "HTTP"` with a forwarding default action, so
the estate's own listener IS the finding. But an HTTPS redirect can live in a
listener RULE, and rules are a separate capability: when the default action is
not a redirect and `DescribeRules` was refused, the posture is
`plaintext-redirect-unknown` and a `redirect-unknown` finding — never
`plaintext-no-redirect`. Reporting a finding this engine did not establish is
the same class of defect as suppressing one it did.

### Mutation proofs — the production path, not a helper

Ten mutations applied to `loadbalancer.ts` one at a time, suite run, restored
from a byte-identical backup. Baseline 28/28 green.

| # | Mutation applied to `loadbalancer.ts` | Result |
|---|---|---|
| M-LB1 | `try { … } catch { return [] }` around the `DescribeLoadBalancers` page walk | **3 red** — the denial and the throttle both rendered as an empty estate |
| M-LB2 | `servingStateOf` returns `all-serving` for every non-value health read | **1 red** — a refused target-health call read as healthy |
| M-LB3 | `refineWithRules` promotes an unreadable rules read to `plaintext-no-redirect` | **1 red** — a finding was claimed that was never established |
| M-LB4 | `pageThrough` returns after the first page regardless of the marker | **2 red** — 3 load balancers became 1, and the cap signal vanished |
| M-LB5 | `parseTargetHealth` invents a reason code when AWS gave none | **1 red** — "no reason code" became a fabricated `unhealthy` code |
| M-LB6 | `attributionFor` answers `unattributed` when the tag index was unreadable | **1 red** — a denied `tag:GetResources` claimed the tag was missing |
| M-LB7 | `parseScheme` defaults an unstated scheme to `internal` | **3 red** (after the suite was strengthened — see below) |
| M-LB8 | region/partition replaced with literal `"aws"` / `"us-east-1"` | **1 red** — the GE-010-007 residency shape; the GovCloud case caught it |
| M-LB9 | `backoffMs(2)` replaced with a literal `50` | **1 red** — the surface stopped using `throttle.ts`'s schedule |
| M-LB10 | the truncation signal pinned to `{ kind: "complete" }` | **1 red** — "there were more" disappeared |

**M-LB7 SURVIVED the first pass.** No case fed a load balancer whose `Scheme`
AWS did not state, so defaulting it to the reassuring `internal` was invisible.
Three cases were added — absent `Scheme`, an unrecognised `Scheme`, and the
three schemes rendering as three distinct sentences — and the mutation then took
3 red. Recorded rather than quietly fixed: a mutation that survives is the only
evidence a suite has a hole, and the hole was real.

Every mutation was restored immediately; the file is byte-identical to its
pre-mutation state (verified with `Buffer.compare`) and the suite returns 28
green.

### What is NOT closed, and is not claimed

- **No page imports this yet.** The module is the data layer; the surface that
  renders it is another agent's file. Nothing in the running product calls
  `loadBalancerReadings` until that lands.
- **Target groups not attached to a load balancer are not listed.**
  `DescribeTargetGroups` is called with `LoadBalancerArn` per load balancer,
  which is the scoping that makes the call bounded. An orphaned target group is
  real and this module does not claim to see it.
- **Classic (v1) load balancers are not read.** The registry holds the v2
  Describes only, and this module does not get to add a capability.
- **Access-log configuration is not read.**
  `DescribeLoadBalancerAttributes` is not in the registry, so this module says
  nothing about whether access logging is on. `alb.tf` sets `enabled = false`;
  that is Terraform's claim, not a read.
- **`isDefault` on a listener certificate is `boolean | null`.**
  `DescribeListeners` omits the flag on the default certificate it returns, and
  the additional SNI certificates need `ListCertificates`, which is not in the
  registry. Null is "AWS did not say", carried rather than guessed.
- **Nothing here was verified against a live AWS account.** Every case runs
  against a stand-in gateway. No credentials were used, no AWS call was made,
  and no account id, ARN or region in the tests or this entry is a real Tenure
  resource — the account throughout is AWS's documentation placeholder
  `123456789012`.
- **`docs/architecture/ownership.md` is stale by exactly one file** because this
  module is new. Regenerating it belongs to one `npm run generate` against a
  clean tree after this batch lands, not to concurrent writers.

## STUDIO-070-004 (ElastiCache) — the cache the product runs on, read for the first time

`infrastructure/terraform/elasticache.tf` creates one `aws_elasticache_cluster`
— `engine = "redis"`, `engine_version = "7.1"`, `num_cache_nodes = 1`, a
`redis7` parameter group whose only declared parameter is
`maxmemory-policy = allkeys-lru` — and `ecs.tf` hands its address to every task
as `REDIS_URL`. No `at_rest_encryption_enabled`, no
`transit_encryption_enabled` and no `auth_token` appear in that file, and no
`aws_elasticache_replication_group` is declared at all. Nothing in the running
product had ever issued an ElastiCache call, so every one of those facts was
invisible: "the cache is fine" and "nobody has ever looked at the cache" were
the same blank panel.

`apps/system-studio/src/lib/aws/elasticache.ts` is the read. It answers the
three questions an operator asks, and it is careful about the difference
between an answer and a silence.

**"Is the cache encrypted" has four answers and only one of them is yes.**
`EncryptionState` keeps `enabled`, `disabled` and `unstated` apart. AWS's
documented default for an omitted `AtRestEncryptionEnabled` is `false`, and the
module still refuses to render the omission as the boolean: "AWS said false" is
a finding to fix and "AWS did not say" is a question to go and answer, and
neither may print the word *encrypted*. The estate-level `EncryptionPosture`
therefore has a distinct `unstated` arm and reaches `encrypted` only when every
cache stated both fields explicitly. `describeEncryptionState` is the one
renderer, so the arms cannot be worded correctly on one surface and
reassuringly on another.

**"Is it a single node with no failover" is a state, not a `1` in a column.**
A standalone cluster with `NumCacheNodes = 1` and no `ReplicationGroupId` gets
the `single-node` arm of `FailoverPosture`, which renders as "SINGLE NODE, NO
FAILOVER — when the node goes, the cache goes". A cluster that IS a
replication-group member does not answer the question at all: its arm points at
the group, because a member claiming "no failover" while its group has
`AutomaticFailover = enabled` is a false alarm an operator would act on.

**"Is there a version upgrade pending that will restart it" names the window.**
`PendingModifiedValues` becomes typed `PendingChange`s, and `restarts` is set
per field rather than per object: an `EngineVersion` or `CacheNodeType` change
takes the nodes down, an `AuthTokenStatus` rotation does not, and reporting the
second as an interruption is how a real one stops being read.
`ScheduledInterruption` carries the restarting subset separately and prints the
parsed `PreferredMaintenanceWindow` beside it — "RESTARTS at Sunday 05:00 to
Sunday 06:00 UTC". `AutoMinorVersionUpgrade` is reported whether or not anything
is queued, because with it on AWS may take the node through a minor upgrade in
that window without anybody queueing a thing.

**What this module cannot read is a value, not an omission.** Whether an engine
version is behind AWS's current default needs
`elasticache:DescribeCacheEngineVersions`, which is NOT in `capabilities.ts`,
and a service agent does not get to add a capability. So every cluster carries a
`VersionCurrency` whose only arm is `NOT_READABLE`, naming the capability and
the IAM action that would answer it and ending "Unknown, not up to date". This
is the `sqs.ts` `OldestMessageAge` pattern: a field a surface must render rather
than one it can forget.

**Pagination runs to completion, with a bound that reports itself.** Both
listings walk `Marker` to the end, capped at `MAX_PAGES` (20 pages of
`MaxRecords: 100` in `client.ts`). Hitting the cap is neither a silent short
list nor an error carrying none of the rows: `Truncation` is a three-armed type
— `complete`, `truncated` (carrying `pagesRead`, `nextMarker` and the sentence
"is NOT the whole estate"), and `not-read` — and `elastiCacheLines` appends it
to the listing line OUTSIDE `describeRead`, because the DENIED and THROTTLED
arms deliberately drop `describeRead`'s subject and "was this list complete"
must survive the states that make it matter most.

**Sub-calls degrade independently.** Four reads happen per load and each fails
on its own: the cluster listing, the replication-group listing, the tag index,
and one `DescribeCacheParameters` per DISTINCT parameter group (deduplicated —
two clusters sharing `tenure-prod-redis7` produce one API call, asserted). A
denied `elasticache:DescribeReplicationGroups` leaves every cluster row intact
and adds its own sentence to the `unreadable` list that qualifies both the
encryption posture and the interruption state. A denied
`DescribeCacheParameters` renders as "refused
elasticache:DescribeCacheParameters" on that cluster's row — naming the action
that is actually missing, not the listing's, which is the lesson `retained.ts`
paid for with `backup:ListBackupVaults`.

**Region and partition come from the resolved identity and from the ARNs AWS
returned.** `deriveClusterArn` and `deriveReplicationGroupArn` return `null`
rather than half an ARN when identity is unresolved, because half an ARN joins
against the tag index, matches nothing, and reads exactly like an untagged
cluster. There is no literal region and no `"aws"` partition fallback in the
file; the GovCloud case asserts the whole rendered surface contains no
`us-east-1`.

**The throttle schedule is `throttle.ts`'s.** `readAws` is given
`attempts: READ_ATTEMPTS` and `backoffMs: backoffMs(2)`; the test asserts the
reported `retryAfterMs` is `800`, which is that curve and not a literal retyped
here.

#### Mutations applied to the PRODUCTION path, each red, each restored

| # | Mutation | Result |
| --- | --- | --- |
| M-E1 | `gw.call("elasticache:DescribeCacheClusters", …).catch(() => ({}))` in `readClusters` | **4 red** — the denial and the throttle both rendered as an empty estate, and the four outcomes collapsed to three distinct surfaces |
| M-E2 | `encryptionStateOf`: `if (value === true)` becomes `if (value !== false)` | **2 red** — a cluster AWS said nothing about reported "at rest: encrypted" |
| M-E3 | `pagedRead` returns `{ items, truncation: { kind: "complete" } }` at the cap | **1 red** — 25 pages of clusters rendered as a complete 20-cluster estate |
| M-E4 | `clusterFailover`: `nodes <= 1` becomes `nodes < 1` | **3 red** — the single-node pilot cache stopped saying "SINGLE NODE, NO FAILOVER" |
| M-E5 | `attributionFor` returns `{ kind: "unattributed" }` when the tag index was refused | **2 red** — a denied `tag:GetResources` reported the cache as missing `tenure:tenant` |
| M-E6 | `RETRY.backoffMs`: `backoffMs(2)` becomes `50` | **1 red** — the surface stopped using `throttle.ts`'s schedule |
| M-E7 | `scheduledInterruption`: `restarting: changes.filter(…)` becomes `restarting: changes` | **1 red** — an online auth-token rotation was reported as a SCHEDULED INTERRUPTION |
| M-E8 | `readParameters` capability becomes `"elasticache:DescribeCacheClusters"` | **1 red** — a refused parameter read handed the operator a policy for an action they already held |
| M-E9 | `deriveArn` returns `arn:aws:elasticache:us-east-1:…` | **2 red** — the GE-010-007 shape; a GovCloud cache placed in the commercial partition |
| M-E10 | `pagedRead` loop bound `page < MAX_PAGES` becomes `page < 1` | **2 red** — a three-page listing rendered as one cluster, and the cap stopped being where the truncation signal comes from |
| M-E11 | `versionCurrencyFor`'s `why` becomes "…is on a current engine version." | **2 red** — a comparison this engine cannot make was printed as a reassurance |
| M-E12 | `encryptionPosture` stops pushing the group listing's sentence onto `unreadable` | **1 red** — a denied `DescribeReplicationGroups` left the encryption answer reading as complete |

Each was restored immediately and the suite returned to 43 green. Run with
`npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/elasticache.test.ts`.

#### What is NOT closed, and is not claimed

- **No page imports this yet.** The module is the data layer; the surface that
  renders `elastiCacheLines` is another agent's file, and until that lands
  nothing in the running product calls `elastiCacheReadings`. Its production
  path is real — called with no gateway it resolves `liveGateway()` and
  `client.ts` — but it is not yet on a route.
- **Engine-version currency is unreadable, by design of the registry.**
  `elasticache:DescribeCacheEngineVersions` is not a capability this console
  holds. Every cluster says so in the field where the answer would be. Adding
  the capability is a `capabilities.ts` and `iam.tf` change, and this agent owns
  neither.
- **Nothing here decides whether a cache is unmanaged.** An expected-set
  comparison against `elasticache.tf` is `drift.ts`'s question, not this
  module's.
- **`maxmemory-policy` is the only parameter lifted out by name.** The rest of a
  group is counted, not carried. A surface that needs another parameter needs a
  change here, and would get one rather than a map of four hundred engine
  defaults.
- **`docs/architecture/ownership.md` is stale by exactly one file** because this
  module is new. Regenerating it belongs to one `npm run generate` against a
  clean tree after every service agent in this batch lands, not to concurrent
  writers.

## STUDIO-070-004 (BUCKETS) — the S3 posture Terraform sets and nothing read back

- [x] **STUDIO-070-004 (S3 bucket adapter)** — Read every bucket, its region,
  its public-access block (all four flags), its policy status, its default
  encryption and whether that is SSE-KMS or SSE-S3, its versioning and
  MFA-delete, its lifecycle configuration, its CORS rules and its tags, back
  through the typed capabilities. The service was DARK: the registry held seven
  S3 posture capabilities and no module called any of them, so a manual console
  change that opened a bucket would have surfaced nowhere at all.

**Files:** `apps/system-studio/src/lib/aws/buckets.ts` (production),
`apps/system-studio/src/lib/aws/buckets.test.ts` (35 cases).

- **Evidence:** 35/35 green via
  `npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/buckets.test.ts`;
  13 mutations applied to the production path, 12 caught red and 1 reported
  NOT CAUGHT in the table below; `npx tsc --noEmit -p apps/system-studio/tsconfig.json`
  reports no error in either file; 25/25 green on
  `node --test tests/architecture/forbidden-clients.test.mjs tests/security/operator-plane-content.test.mjs tests/security/no-hardcoded-estate.test.mjs tests/security/studio-task-role-is-narrow.test.mjs`.

### Why this one mattered

`infrastructure/terraform/s3.tf` declares a four-flag public-access block on
both buckets, `aws:kms` default encryption and versioning on `documents`,
neither on `exports`, two lifecycle configurations, and — on `documents` —
`allowed_origins = ["*"]` with a comment reading "Restrict to tenurework.com
domain post-pilot". Every one of those is a claim Terraform makes about a past
apply. None of them was ever compared against what the account holds.

### Seven capabilities, seven readings per bucket, degrading independently

`s3:ListAllMyBuckets` is account-wide. The other six authorize PER BUCKET, and
three of them under an IAM name that differs from the API: `GetBucketEncryption`
authorizes under `s3:GetEncryptionConfiguration`,
`GetBucketLifecycleConfiguration` under `s3:GetLifecycleConfiguration`,
`GetBucketCors` under `s3:GetBucketCORS`. Each fact on each bucket is its own
`AwsRead`, so a denied `GetBucketPolicyStatus` renders the minimum statement for
the action that is ACTUALLY missing, leaves that bucket's encryption, versioning,
lifecycle and tags real, and never renders as "not public".

### "There is no configuration" is an answer, not an error

S3 reports six absences by raising: `NoSuchPublicAccessBlockConfiguration`,
`ServerSideEncryptionConfigurationNotFoundError`, `NoSuchLifecycleConfiguration`,
`NoSuchBucketPolicy`, `NoSuchTagSet`, `NoSuchCORSConfiguration`. Each is caught
inside its own call and turned into a definite fact. Letting the first reach
`readAws` would classify it as ERROR — a red box — and a red box beside "public
access block" reads as "we could not check", which is the exact opposite of
"this bucket has no public access block at all".

`GetBucketVersioning` is the mirror image: it answers `{}` SUCCESSFULLY for a
bucket that has never had versioning, so the mapping turns that into
`never-enabled` before any emptiness test can turn a real reading into EMPTY.

### The one thing this engine honestly cannot say: a bucket's region

A bucket's region comes from `Bucket.BucketRegion` on the `ListBuckets` response
and from nowhere else. S3 returns that field only when the request carries at
least one parameter, and `client.ts:1031` sends `ContinuationToken` alone, which
is absent on the first page. There is no `s3:GetBucketLocation` capability in
the registry.

So a bucket whose region AWS did not state carries `{ kind: "unstated" }` with
that sentence in it, and does NOT inherit the caller's region. Filling it in
from the resolved identity would be GE-010-007 exactly. The one-line fix is
`client.ts`'s, not this module's: adding `MaxBuckets: 1000` to the
`ListBucketsCommand` input would make `BucketRegion` present on every page.

### A deviation from the SQS attribution rule, stated

`tags.ts` and the Resource Groups Tagging API are the attribution path, as
instructed. But that API answers for ONE region and an S3 bucket ARN carries no
region, so "this ARN is not in the index" does not mean "untagged" the way it
does for a queue — it means that, or it means the bucket lives elsewhere. This
module therefore falls back to the bucket's own `GetBucketTagging` before it will
say `unattributed`, and says `unknown` when neither source could be read. Every
reading carries `attributionSource` naming which one decided.

### Mutation proofs — the production path, not a helper

Thirteen mutations applied to `buckets.ts` one at a time, suite run, restored,
suite re-run. Baseline 35/35 green; restored 35/35 green.

| # | Mutation applied to `buckets.ts` | Result |
|---|---|---|
| M-B1 | `try { ... } catch { return { entries: [], truncation: complete } }` around the `ListBuckets` page walk | **3 red** — the denial and the throttle both rendered as an empty estate |
| M-B2 | the `partiallyUnread.push(bucket.name)` for an unreadable public-access block removed | **2 red** — a denied and a throttled block read both produced an unqualified "no public bucket observed" |
| M-B3 | `if (false && isAbsentConfiguration(..., "NoSuchPublicAccessBlockConfiguration"))` | **1 red** — a bucket with no block at all became a red ERROR instead of the finding |
| M-B4 | `blockPublicPolicy: config.BlockPublicPolicy !== false \|\| true` | **1 red** — a flag switched off in the console rendered as in force |
| M-B5 | `isEmpty: () => false` removed from the versioning read | **0 red — NOT CAUGHT, and reported as such.** The mapping already converts `{}` into a two-field object, so the line is belt-and-braces rather than load-bearing. It is kept, and its comment now says so. |
| M-B5' | the versioning `never-enabled` fallback replaced with `Enabled` | **1 red** — an unversioned bucket claimed a deletion was recoverable |
| M-B6 | `REGION_UNSTATED` replaced with `{ kind: "stated", region: "us-east-1" }` | **1 red** — the GE-010-007 shape: a region nobody read, printed confidently |
| M-B7 | the page-cap arm returns `kind: "complete"` | **1 red** — a truncated listing rendered as the whole estate |
| M-B8 | `backoffMs: backoffMs(2)` replaced with a literal `50` | **1 red** — the surface stopped using `throttle.ts`'s schedule |
| M-B9 | attribution returns `unattributed` when the tag index misses the ARN | **1 red** — the S3 regional-index correction gone; a tagged bucket reported as untagged |
| M-B10 | the `unknown` attribution arm returns `unattributed` | **1 red** — a denied tag index read as "missing tenure:tenant" |
| M-B11 | `const beyond = false && position >= MAX_POSTURE_BUCKETS` | **1 red** — buckets past the posture budget rendered as compliant |
| M-B12 | `if (false && status.value.kind === "public")` | **1 red** — a bucket S3 itself calls PUBLIC stopped being a finding |
| M-B13 | `isAbsentConfiguration(error, "NoSuchBucketPolicy") \|\| true` | **1 red** — a denied policy status rendered as "no bucket policy" |

Every mutation was restored immediately. A final scan for `false &&`, `&& false`,
`|| true` and `MUTATION` over `buckets.ts` returns nothing.

### What is NOT closed, and is not claimed

- **A bucket's region is unknown on the first listing page.** See above. Not a
  defect in this module and not fixable from it: `client.ts` owns the
  `ListBucketsCommand` input and is another agent's file.
- **No page imports this yet.** The production entry point is `bucketPosture()`,
  which resolves `liveGateway()` when called with no argument; the route that
  renders `bucketLines()` is a surface agent's file, and until that lands nothing
  in the running product calls it.
- **`s3:GetBucketPolicy` is absent and stays absent.** The policy STATUS is one
  boolean; the policy DOCUMENT names tenant principals and prefixes this console
  has no reason to hold. `s3:GetObject` is likewise absent: these buckets hold
  tenant documents.
- **Object-level facts are not read.** Size, object count and storage-class
  distribution live in CloudWatch and S3 Storage Lens; neither is in the
  registry, and this module does not get to add one.
- **Nothing here decides whether a bucket is unmanaged.** An expected-set
  comparison against `s3.tf` is `drift.ts`'s question, not this module's.
- **Nothing here was verified against a live AWS account.** Every case runs
  against a stand-in gateway. No credentials were used, no AWS call was made, and
  no account id, ARN, bucket name or region in the tests or this entry is a real
  Tenure resource — the account throughout is AWS's documentation placeholder
  `123456789012`. No approval, review, certification or verification date is
  recorded anywhere in this work.
- **`docs/architecture/ownership.md` is stale by exactly one file** because this
  module is new. Regenerating it belongs to one `npm run generate` against a
  clean tree after this batch lands, not to concurrent writers.

## STUDIO-070-004 (Cognito) — the pool guarding this console, read back

`apps/system-studio/src/lib/aws/cognito.ts` + `cognito.test.ts` (34 tests).

### What was actually dark

`infrastructure/studio/cognito.tf` provisions the operator user pool, its app
client, its hosted domain and the operator accounts. Not one Cognito call had
ever been issued by the running product, so every fact about the console's own
front door was invisible FROM the console.

On 2026-08-13 an audit found the migration to Cognito had seeded every operator
with the shared secret as a PERMANENT password (`password`, not
`temporary_password`) under `message_action = "SUPPRESS"` — no invitation, so no
forced change was ever triggered — with the pool's `mfa_configuration` left at
`OPTIONAL`. Each of those is a fact an API returns. None of them reached a
screen. `cognitoReadings()` is the read that makes them visible:

- **`MfaPosture`** is derived from `GetUserPoolMfaConfig` first and
  `DescribeUserPool`'s MFA field second, and `optional` and `off` are their own
  arms carrying the sentence *"a second factor nobody enrolled is the same
  protection as none"*. `enforced` is the ONLY reassuring arm and it is
  unreachable from a failed read: both reads refused produces `unknown`, never a
  default. That is the mutation the panel exists to survive (M-C2 below).
- **`FirstSignInWindow`** is arithmetic, not a status lookup. Every account in
  FORCE_CHANGE_PASSWORD is measured against the pool's own temporary-password
  validity, and `expired` (the credential can no longer be used; the account is
  stranded) is a different arm and a different finding from `open` (the
  credential is live). The fixture has one of each — twelve days and two days
  into a seven-day window.
- **`TemporaryPasswordWindow`** keeps "the pool declares seven days" and "the
  pool declares nothing and AWS's default is seven days" apart, because only the
  first is something somebody chose.
- **`permanentPasswordSuspicion`** reports the observable shadow of the defect:
  in an admin-create-only pool, an account that reached CONFIRMED within
  `PERMANENT_PASSWORD_SUSPICION_WINDOW_MS` (15 minutes) of being created never
  went through a human forced password change. It is labelled `suspected`, it
  carries both timestamps and the measured delta, and it ships with
  `OPERATOR_SUSPICION_CAVEAT` naming the case that would make it a false
  positive. A claim that travels with what would disprove it.

### Three facts it provably cannot read, modelled as values rather than omissions

- **Last sign-in.** The roster shape carries create date, last-modified date,
  enabled, status and the legacy SMS MFA options — and no authentication
  timestamp, in any SDK version. `LAST_SIGN_IN_NOT_READABLE` has one arm, names
  the capability that would answer it, and carries `notThis`: *"last-modified is
  NOT last sign-in"*. A test asserts the surface never prints a date after
  `last sign-in:`.
- **Software-token enrolment.** The legacy MFA options field is SMS-only;
  per-account MFA settings only come back from the per-account admin read, which
  is deliberately absent from the registry and named by GE-041-001 as vocabulary
  this layer does not speak. No SMS renders as *"NOT the same as no second
  factor"*.
- **Whether the invitation was suppressed.** That is a parameter of the create
  call; Cognito stores it nowhere and no read returns it. Said out loud in the
  module header rather than glossed.

### Nothing secret escapes

The app-client description returns a client secret in its body. It is read at
exactly one expression, to answer the boolean `hasSecret` (`generate_secret =
true` is real configuration), and the value never enters a returned object, a
log or a rendered string. The roster read is narrowed to `email` in `client.ts`
and narrowed AGAIN in `signInIdentifierOf`, so a future widening of that call
cannot leak a phone number through this module — the fixture puts a phone number
on an account and the suite asserts it never appears in the object graph or the
text.

### GE-041-001, respected on both halves

The guard's two-file estate exemption (`client.ts`, `cognito.ts`) is a ratchet
asserted at `length <= 2`, so everything lives in this one file. No exported
field is spelled with the provider's vocabulary — a pool identifier is `poolId`,
an app client's is `clientId` — precisely so a surface agent consuming these
exports does not red the build by threading the SDK's names into a third file.
Not one authentication or user-pool-write verb appears here.
`node --test tests/security/provider-independence.test.mjs` — 7 pass, 0 fail.

### The behaviours the read plane requires

- **A denial is never an empty list.** A refused pool listing returns the DENIED
  arm carrying the principal, the action and the pasteable minimum statement;
  `"value" in pools` is `false`, so a surface cannot reach an inventory that does
  not exist.
- **A throttle is its own state.** `retryAfterMs` is `800`, which is
  `throttle.ts`'s curve (`backoffMs(2)` doubled twice), not a literal.
- **Sub-calls degrade independently.** A refused MFA read falls back to the
  description and names the fallback in `provenance`; a refused roster leaves the
  MFA finding standing; a refused description does not make the pool vanish and
  does not cost it its tag join — `derivePoolArn` assembles the ARN from the
  resolved identity so the pool still attributes, and `arnProvenance` says the
  ARN was assembled and is not evidence of location.
- **An EMPTY roster is an answer, not an unknown.** "This pool has no accounts"
  produces no `roster-unknown` finding; a refused one does.
- **Paging is bounded AND says so.** `MAX_POOL_PAGES` / `MAX_CLIENT_PAGES` /
  `MAX_OPERATOR_PAGES` / `MAX_POOLS_DESCRIBED` / `MAX_CLIENTS_DESCRIBED`. Hitting
  a bound returns a `truncated` `Completeness` whose `why` says the accounts not
  shown *"have not been checked for anything below"* — it does not throw and it
  does not report page one as the estate.
- **Region and partition come from AWS's own ARN, else the resolved identity.**
  No region literal, no `"aws"` fallback. A pool whose ARN names a region other
  than the resolved one reports the ARN's region, which is what makes a
  GE-010-007-shaped anomaly visible at all. With neither an ARN nor an identity
  the module states no region and says why.
- **The console's own pool is identified by TAG** (`tenure:module =
  system-studio`), never by name. The fixture contains a decoy pool literally
  named `tenure-prod-operators` with no tag; nothing chooses it. Two tagged pools
  is `ambiguous`; none is `not-tagged`; an unreadable listing is `unknown`.

### Mutations applied to the PRODUCTION path, each red, each restored

| # | Mutation | Result |
| --- | --- | --- |
| M-C1 | a refused pool listing returns an EMPTY inventory instead of the DENIED arm | **2 red** — the denial and the throttle both rendered as "none" |
| M-C2 | an unreadable MFA configuration defaults to `enforced` | **1 red** — two refused reads claimed MFA was on |
| M-C3 | `ageDays > window.days` becomes `ageDays > 365` | **1 red** — a stranded account twelve days into a seven-day window read as fine |
| M-C4 | `permanentPasswordSuspicion` returns null unconditionally | **1 red** — the account confirmed 3s after creation stopped being reported |
| M-C5 | the client secret is carried out in the client's `name` | **1 red** — the leak assertion caught it, proving it is not vacuous |
| M-C6 | every roster attribute value is carried out, not just the identifier | **5 red** — the phone number surfaced and four other assertions moved |
| M-C7 | a bounded pool listing reports itself `complete` | **1 red** — a truncated read claimed to be the estate |
| M-C8 | `backoffMs(2)` replaced with a literal `50` | **1 red** — the surface stopped using `throttle.ts`'s schedule |
| M-C9 | an EMPTY roster is reported as `roster-unknown` | **1 red** — "nobody can sign in" collapsed into "we were not allowed to look" |
| M-C10 | the console pool is identified by NAME instead of by tag | **2 red** — it picked the decoy |

Each was applied singly, run, and restored from a byte-identical pristine copy;
the suite returned to 34 green and the restored file compares equal.

### What is NOT closed, and is not claimed

- **Last sign-in per operator is BLOCKED.** It is not in any response this
  engine may fetch. Answering it needs a new capability in the registry for the
  pool's authentication-events read AND the pool's advanced-security feature
  plan — and an admin verb in this layer is the thing GE-041-001 exists to
  prevent, so that is a decision for whoever owns the guard, not a gap to
  quietly close.
- **Per-operator software-token enrolment is BLOCKED** for the same reason.
- **The heuristic is a heuristic.** `neverForcedAPasswordChange` infers from two
  timestamps because Cognito stores neither the create call's message action nor
  whether a seeded password was permanent. It is labelled `suspected` and ships
  its own counter-case.
- **No page imports this yet.** The module is the data layer; the route that
  renders it belongs to a surface agent, and until that lands nothing in the
  running product calls `cognitoReadings`.
- **`docs/architecture/ownership.md` is stale by exactly one file** because this
  module is new. Regenerating it belongs to one `npm run generate` against a
  clean tree, not to concurrent writers.

## STUDIO-070-004 (DynamoDB) — the tables, and the registry's own recoverability

- [x] **STUDIO-070-004 (DynamoDB tables adapter)** — Read DynamoDB back through
  the typed capabilities as a CONTROL-PLANE object: billing mode and provisioned
  capacity, item count and size, encryption and whether the key is customer-
  managed or the AWS-owned default, point-in-time recovery, deletion protection,
  TTL and global secondary indexes — with the tenant registry's protection ranked
  first. No table CONTENTS are read.
  - Status: PASS
  - Evidence: `npm run test --workspace apps/web -- --ci lib.aws.dynamodb-tables` -> 48 passed,
    48 total, 1 suite. Production module
    `apps/system-studio/src/lib/aws/dynamodb-tables.ts`, consumed by
    `apps/system-studio/src/app/platform/data/page.tsx`.

- **Was**: `infrastructure/studio/dynamodb.tf` provisions `<prefix>-tenants` —
  the tenant registry, holding `TENANT#<slug>` manifests, lifecycle states and
  steps, plus the hash-chained `AUDIT#<subject>` trail — and declares
  `point_in_time_recovery { enabled = true }`, `server_side_encryption { enabled
  = true }` and `deletion_protection_enabled = true`. Whether any of that was
  TRUE OF THE LIVE TABLE was a thing this console could not see. Terraform
  declares an intention; a drifted table, a console click or a stack replaced by
  hand separates the two, and the point of an AWS-authoritative control plane is
  that the answer comes from AWS. The service was dark: nothing in the running
  product had ever issued a DynamoDB *control-plane* call.
- **Now**: `apps/system-studio/src/lib/aws/dynamodb-tables.ts`. `tableReadings()`
  resolves identity, reads the tag index, lists every table in the region and
  then reads each table's description, its continuous backups and its TTL, plus
  one `kms:DescribeKey` per DISTINCT key. It returns `DynamoDbReadings` —
  `AwsRead<readonly TableReading[]>` for the listing, four independent `AwsRead`s
  per table, a `MoreTables` completeness signal, a `RegistryProtection`, an
  explicit `asOf`, and all five capabilities' own `refreshMs` read from the
  registry rather than retyped.
- **Production caller**: `apps/system-studio/src/app/platform/audit/page.tsx`
  (another agent's file, landed concurrently) calls `tableReadings()` with no
  arguments — the live gateway — and renders
  `describeRegistryProtection(tables.registry)` at `data-testid="registry-protection"`.
- **The registry is ranked first, structurally**: `RegistryProtection` is a union
  whose `no-point-in-time-recovery` arm IS the PITR fact, and `dynamodbLines()`
  emits it as line zero, before the listing and before any table row. PITR off on
  the tenant registry is total loss of the fleet's own record of itself — which
  systems were provisioned, what state each is in, who approved it — and a
  finding rendered below forty rows of table configuration is a finding nobody
  reads. Six arms, so every way of NOT knowing has somewhere to go that is not
  "protected": `unnamed` (TENANT_TABLE unset), `unknown` (the read failed),
  `missing` (named, listing succeeded, not in this region — `ListTables` is
  per-region), `no-point-in-time-recovery`, and `protected` carrying
  `weaknesses`, so "recoverable" never quietly means "fine".
- **Five capabilities, five readings, degrading independently**: `ListTables`,
  `DescribeTable`, `DescribeContinuousBackups`, `DescribeTimeToLive` and
  `kms:DescribeKey` are five IAM actions, and `infrastructure/studio/iam.tf`
  grants the first at `Resource = "*"` in one statement and the next three at
  `arn:*:dynamodb:*:*:table/*` in another — two statements that can drift apart
  in one edit. A refused `DescribeContinuousBackups` names
  `dynamodb:DescribeContinuousBackups` and prints THAT minimum statement, and the
  row keeps its billing mode, its size and its TTL. This is `retained.ts`'s
  `backup:ListBackupVaults` lesson applied at construction time.
- **Configuration, never contents**: none of the five can return an item.
  `GetItem`, `Query`, `Scan` and every write stay in `lib/registry.ts`, which has
  its own typed reader. `registry.ts` is NOT imported here — it pulls
  `server-only` and builds an SDK client at module scope, which would make this
  module unloadable outside a server component. Which table is the registry comes
  from `process.env.TENANT_TABLE`, the same variable `registry.ts` reads and
  `ecs.tf` sets; the coupling is stated in the module header and overridable
  through `options.registryTableName` so a test drives the ranking without
  touching process state.
- **Pagination with a bound AND a signal**: `ListTables` is walked to completion,
  capped at `MAX_LIST_PAGES` (20) pages of 100. On hitting the cap the listing
  neither throws nor pretends to be whole: `MoreTables.truncated` carries the
  pages spent, the names read and the `resumeAfter` token, and renders as its own
  "Completeness" line saying "NOT the estate". A denied listing makes that line
  `unknown`, never `complete`.
- **Nothing absent is ever a finding, and nothing stated is ever softened**: an
  absent `ItemCount` throws inside `readAws` so the detail is ERROR naming the
  field — `0` on the registry would be the claim that the fleet is empty. An
  absent `DeletionProtectionEnabled` is `unstated`, not `disabled`. An absent
  `SSEDescription` is the AWS-OWNED default key, which is a specific fact (no key
  in this account, no policy, no revocation, no CloudTrail) and not "unknown" —
  while an `SSEDescription` that is present and unreadable is `unstated` and is
  deliberately NOT folded into that default. `ItemCount` and `TableSizeBytes`
  carry a `freshness` sentence, because DynamoDB refreshes them roughly every six
  hours and a six-hour-old number beside a live `asOf` reads as live.
- **Customer-managed vs AWS-owned**: the AWS-owned default is determined from
  `DescribeTable` alone. Telling a customer-managed key from `alias/aws/dynamodb`
  needs `KeyManager`, so one `kms:DescribeKey` per DISTINCT key ARN (deduped,
  capped at `MAX_KEY_DESCRIBE_READS`) is its own `AwsRead`: a denied fifth call
  leaves the key ARN printed and says "whether it is customer-managed is
  unknown", never an AWS-managed default.
- **Residency**: region and partition come from the resolved identity and from
  the `TableArn` AWS returns. There is no region literal and no `"aws"` partition
  fallback in the file; with identity unresolved and the describe refused, no ARN
  is assembled at all. A GovCloud identity produces
  `arn:aws-us-gov:dynamodb:us-gov-west-1:…` and the whole rendered surface
  contains no `us-east-1`.
- **Attribution** goes through `tags.ts` and the Resource Groups Tagging API, and
  adds the FOURTH answer the three-way contract cannot express: `unknown`, for
  when the tag index itself was denied or throttled.
- **Budget**: at most `MAX_TABLE_DETAIL_READS` (100) tables are described per
  load, three calls each against a control-plane throttle shared with every
  `terraform apply` in the account. The registry is placed in the budget FIRST
  regardless of where it sorts — the one fact this module ranks first must not
  depend on the alphabet. Tables past the budget carry UNCONFIGURED on all four
  readings, whose `why` says "not the same as its being unprotected".

### Mutations applied to the production path, and what caught them

Fourteen mutations, each applied to `dynamodb-tables.ts` (never to the test and
never to a helper), each run, each red, each restored immediately.

| # | mutation applied to `dynamodb-tables.ts` | result |
|---|---|---|
| M1 | the refused/throttled listing passthrough replaced with `{state:"ACTUAL", value: []}` | **RED x4** — the denial, the throttle, the empty case and the registry-unknown case all collapsed |
| M2 | an unreadable registry `DescribeContinuousBackups` returned `{kind:"protected"}` | **RED x1** — a refused read reported the registry as recoverable |
| M3 | `deriveTableArn` uses `arn:aws:dynamodb:us-east-1:...` instead of the resolved partition and region | **RED x1** — the GovCloud estate rendered in the commercial partition |
| M4 | `requiredCount` returns `0` for a non-number instead of throwing | **RED x1** — an unread `ItemCount` rendered as "0 item(s)" |
| M5 | `parseDeletionProtection` maps anything not `true` to `disabled` | **RED x2** — a field AWS did not return became a finding on the registry |
| M6 | an unreadable `SSEDescription` folded into `aws-owned-default` | **RED x1** — "we could not read the key" became "AWS's default key" |
| M7 | the truncation branch disabled (`if (false && token)`) | **RED x1** — 20 walked pages rendered as "every table in this region" |
| M8 | `readBackups` reports under the `dynamodb:ListTables` capability | **RED x2** — the pasteable statement named an action the role already holds |
| M9 | the registry no longer placed into the describe budget first | **RED x1** — a registry sorting past position 100 reported as "not read" |
| M10 | an unreadable tag index reported as `unattributed` | **RED x2** — a denied and a throttled tag index became "missing tenure:tenant" |
| M11 | the retry schedule retyped as `attempts: 3, backoffMs: 50` | **RED x1** — the surface stopped using `throttle.ts`'s curve (`retryAfterMs` 800) |
| M12 | the registry line moved below the listing and completeness lines | **RED x6** — the fleet's own recoverability stopped being what the surface says first |
| M13 | a denied `kms:DescribeKey` rendered as "an AWS-managed key ... state Enabled" | **RED x1** — an unread key management reported as a reassuring default |
| M14 | `isoOf` reads epoch seconds as milliseconds | **RED x1** — a 2025 table rendered as created in 1970 |

All fourteen restored; the suite is 48/48 green, and `dynamodb-tables.ts`
contains no `false &&`, no `|| true` and no mutation stub. M5's first run went red
on the parser case only; the surface-level assertion ("deletion protection AWS did
not state is 'unknown' on the registry, never 'OFF'") was added and M5 re-applied,
which is the **RED x2** recorded above.

### Evidence

- `npm run test --workspace apps/web -- --ci ../system-studio/src/lib/aws/dynamodb-tables.test.ts`
  — **48 passed, 48 total.**
- `npx jest --ci --testPathPattern "system-studio"` — **47 suites, 1600 tests,
  1594 passing.** The 6 failures are in `src/lib/aws/secrets.test.ts` and
  `src/app/tenants/[slug]/tenant-answers.test.ts`, two concurrent agents' files;
  neither imports this module and nothing this module touches is in their path.
- `npx tsc --noEmit -p apps/system-studio/tsconfig.json` — **8 errors, none in
  `dynamodb-tables.ts` or `dynamodb-tables.test.ts`.** They are in
  `app/platform/audit/entries.ts`, `app/platform/audit/page.tsx`,
  `app/platform/cost/cost-decisions.test.ts` and siblings — other agents' files,
  mid-flight.
- `node --test tests/architecture/forbidden-clients.test.mjs` — **6/6 pass.** No
  SDK package is imported here; every call goes through the `AwsGateway` seam.
- `node --test tests/security/operator-plane-content.test.mjs` — **5/5 pass.** No
  Prisma client is imported.

### The fake, and why it proves something

`fakeAws` answers seven capabilities with the shapes the real SDK returns —
`{TableNames, LastEvaluatedTableName}`, `{Table:{...}}`,
`{ContinuousBackupsDescription:{...}}`, `{TimeToLiveDescription:{...}}`,
`{KeyMetadata:{...}}`, `{ResourceTagMappingList:[...]}`, `{Account, Arn}` — and
each is independently failable with `AccessDeniedException`,
`ThrottlingException`, an empty-but-successful list or a populated one, per
capability AND per table. The `empty` case returns `{}` with no `TableNames` key,
because that is what AWS actually sends. Dates are `Date` objects on the backups
path and epoch SECONDS on `CreationDateTime`, which is what the wire carries. One
test asserts the four listing outcomes render as four PAIRWISE DISTINCT strings,
which is the assertion a stand-in returning `[]` regardless would fail.

No account id, ARN, region or key id in this suite is real: `123456789012` is
AWS's documentation placeholder and the key UUIDs are obviously constructed. The
`registryTableNameFromEnv` case saves and restores exactly the `TENANT_TABLE`
value it found — set or unset — and touches nothing else in `process.env`.

### What is NOT closed, and is not claimed

- **Nothing was read from a real AWS account.** Every assertion here is against a
  stand-in client. Whether the LIVE `<prefix>-tenants` table has PITR on is
  exactly the question this module exists to answer, and it has not been asked of
  a real account, because there is no AWS Organization to ask. That is
  `BLOCKED_EXTERNAL` on the same dependency as the rest of this ledger.
- **Global tables, on-demand backups, streams and contributor insights are not
  read.** `dynamodb:ListBackups`, `DescribeGlobalTable`,
  `DescribeKinesisStreamingDestination` and `DescribeContributorInsights` are not
  in `capabilities.ts` and this file does not get to add them. A table's replicas
  and its on-demand backup history are therefore NOT part of the recoverability
  answer, and `RegistryProtection` says PITR because PITR is what was read.
- **Whether a table is unmanaged is not decided here.** An expected-set
  comparison against `infrastructure/` is `drift.ts`'s question.
- **`docs/architecture/ownership.md` is stale by exactly one file** because this
  module is new. It is a shared generated artefact that every service agent in
  this batch staled; regenerating it belongs to one `npm run generate` against a
  clean tree, not to concurrent writers.

## STUDIO-070-004 (DATABASE) — the RDS facts that decide whether the product is about to be taken offline

`apps/system-studio/src/lib/aws/database.ts` + `database.test.ts`. The Global
Deployment Engine's database service was dark: `infrastructure/terraform/rds.tf`
provisions it, `inventory.ts` kept four fields off `rds:DescribeDBInstances` (ARN,
identifier, status, subnet group) because it is an inventory, and `retained.ts`
kept the snapshots tagged for a stopped tenant because it is a bill. Neither
answers a question anybody asks at 02:00.

### The four questions, and where each is answered from

- **"Is a maintenance action pending, and when does it stop being optional."**
  `rds:DescribePendingMaintenanceActions`, read account-wide in one paged call.
  `OutageSchedule` has four arms read most-binding-first: `forced` wins whenever
  AWS returned a `ForcedApplyDate`, because on that date the action is applied
  outside the maintenance window and without an opt-in. `auto-applied-after` is
  the softer `AutoAppliedAfterDate`; `scheduled` is `CurrentApplyDate`, which
  moves when somebody opts in; `unscheduled` is an action with no date at all.
  Collapsing these into one "pending" badge is how a forced engine upgrade reads
  the same as housekeeping.
- **"Did this instance restart, and why."** `rds:DescribeEvents`, one call per
  instance over a 1440-minute window, classified on AWS's own `EventCategories`
  (`failover`, `availability`, `low storage`, `read replica`, `failure`) and not
  on message text — the same rule `read.ts` uses for error names, for the same
  reason. The message is carried alongside because it is the only place the
  reason is written down.
- **"Is storage autoscaling on, and how close is it to the ceiling."**
  `MaxAllocatedStorage` is the ceiling and its ABSENCE is how AWS says
  autoscaling is off, so the absent case is the `fixed` arm and never a ceiling
  of zero (which would render as 100% of the ceiling on every instance that
  simply does not autoscale). Every arm's `why` states that this is headroom to
  the AUTOSCALING CEILING and **not** free disk space — that is a CloudWatch
  `FreeStorageSpace` metric this read does not carry.
- **"Is `rds.force_ssl` actually set."** **It is not readable from here, and the
  module says so on every instance, every load.** See the honest gap below.

Backup retention and the latest restorable time travel with the snapshots:
`BackupRetentionPeriod = 0` is the `disabled` arm, which states there is no
point-in-time recovery at all; `LatestRestorableTime` becomes a `RecoveryPoint`
carrying its age, flagged `stale` past 30 minutes because RDS advances it about
every five.

### The behaviours the read plane requires

- Every reading is `AwsRead<T>` from `read.ts`. A denied call is DENIED with the
  principal, the action and a pasteable minimum statement, and there is no arm
  carrying an optional `T` — asserted by `expect("value" in read).toBe(false)`.
- A throttle is THROTTLED with `retryAfterMs`, and the schedule is `throttle.ts`'s
  `backoffMs(2)`, never a literal (proved by M-D8).
- Region and partition resolve from the resolved identity and from the ARN RDS
  returns. A GovCloud principal produces `aws-us-gov` / `us-gov-west-1` and the
  whole rendered surface contains no `us-east-1`.
- Marker pagination is walked to completion or to `MAX_PAGES = 20` and then
  reported as `Truncation.truncated` carrying the marker AWS was still handing
  back. A truncated listing is never EMPTY. Event reads are capped at
  `MAX_EVENT_INSTANCE_READS = 25` instances per load; instances past it carry an
  UNCONFIGURED event read whose `why` says the engine stopped.
- Attribution is the Resource Groups Tagging API path in `tags.ts`, with a fourth
  arm — `unknown` — for a tag index that could not be read, kept apart from
  `shared` and `unattributed`.
- Every row carries an explicit `asOf` and its capability's own `refreshMs`, read
  from `CAPABILITIES` rather than retyped.
- **Six sub-calls degrade independently.** A denied
  `rds:DescribePendingMaintenanceActions` leaves each row's `pendingMaintenance`
  as `not-read` naming that action — never `none`, and the estate-level
  `ScheduledOutage` goes `unknown`, never "nothing scheduled". A denied
  `rds:DescribeEvents` for one instance is DENIED for that instance only, with
  every other fact about it standing. Denied parameter-group and snapshot
  listings behave the same way.

### The one thing it honestly cannot say

**Whether `rds.force_ssl` is set is NOT readable by this engine.** A parameter
VALUE needs `rds:DescribeDBParameters`, which is not a key in `capabilities.ts`
and not granted in `infrastructure/studio/iam.tf` (that file grants exactly
`rds:DescribeDBInstances`, `DescribeDBSnapshots`, `DescribeDBParameterGroups`,
`DescribeEvents`, `DescribePendingMaintenanceActions`). This module does not add
one. So `SslEnforcement` is a one-armed `NOT_READABLE` type naming the capability
and the IAM action, and its rendered sentence never contains the word "enforced".

What it CAN say, and does: which groups are attached, their apply status, and
whether they are AWS's unmodifiable `default.<family>` groups — an instance on
one is provably at engine defaults for every parameter including the SSL one,
which is a real fact without being a claim about the value. An instance on a
custom group is provably not provable from here, and says that instead.

### Mutations applied to the PRODUCTION path, each red, each restored

Twelve mutations applied to `database.ts` — never to the test, the fake or a
helper. Each applied, run, confirmed red, restored:

| # | mutation applied to `database.ts` | result | test that caught it |
|---|---|---|---|
| M-D1 | `if (!maintenanceAnswered)` to `if (false && !maintenanceAnswered)` | 2 failed, 42 passed | a refused maintenance read leaves every other database fact standing |
| M-D2 | `scheduledOutage`'s `maintenanceRead.state !== "ACTUAL" &&` to `false &&` | 2 failed, 42 passed | a throttled maintenance read is THROTTLED, and is not an empty schedule |
| M-D3 | `outageScheduleOf` reads `CurrentApplyDate` before `ForcedApplyDate` | 2 failed, 42 passed | a forced action reports the FORCED date, not the softer current one |
| M-D4 | `if (ceiling === null)` to `if (ceiling === null && false)` | 1 failed, 43 passed | an absent MaxAllocatedStorage is autoscaling OFF, never a ceiling of zero |
| M-D5 | `pagedRead` reports `kind: "complete"` at the cap instead of `"truncated"` | 2 failed, 42 passed | more pages than MAX_PAGES is TRUNCATED, with the marker AWS was still handing back |
| M-D6 | `sslEnforcementFor` claims `groupsAreEngineDefault: true` when the group listing was never read | 1 failed, 43 passed | a refused parameter-group listing makes the groups unknown, not engine-default |
| M-D7 | `if (!snapshotsAnswered)` to `if (false && !snapshotsAnswered)` | 1 failed, 43 passed | a refused snapshot read is 'unknown', never 'no snapshot' |
| M-D8 | the retry schedule retyped as a literal `50` instead of `throttle.ts`'s `backoffMs(2)` | 1 failed, 43 passed | a throttle is THROTTLED — its own state, not a failure and not an empty list |
| M-D9 | attribution consults the tag index first, so a denied index reads as unattributable | 1 failed, 43 passed | a refused tag index is 'attribution unknown' — not unattributable and not shared |
| M-D10 | `significanceOf` stops classifying AWS's `availability` category as a restart | 2 failed, 42 passed | classification is keyed on AWS's categories, not on the message wording |
| M-D11 | `recoveryPointOf`'s `ageMs > RECOVERY_POINT_STALE_MS` to `false` | 2 failed, 42 passed | a recovery point two hours behind is STALE, and one five minutes behind is not |
| M-D12 | `pendingChangesOf` starts carrying the queued `MasterUserPassword` | 1 failed, 43 passed | the whole rendered surface never contains the queued MasterUserPassword |

All twelve restored; the suite returned to 44/44 green. `database.ts` contains no
`false &&`, no `|| true` and no mutation stub.

### Evidence

- `npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/database.test.ts`
  — **44 passed, 44 total.**
- `npx tsc --noEmit -p apps/system-studio/tsconfig.json` — no error in
  `database.ts` or `database.test.ts`. The four remaining errors are another
  agent's concurrent file (`app/platform/cost/cost-decisions.test.ts`).
- `node --test tests/security/operator-plane-content.test.mjs` — 5/5 pass. No
  Prisma client is imported.
- `node --test tests/architecture/forbidden-clients.test.mjs` — 6/6 pass. No SDK
  import in this module; every call goes through `AwsGateway`.
- The four outcomes are separated by assertion, not by claim, THREE times over:
  a populated list, an empty-but-successful list, `AccessDeniedException` and
  `ThrottlingException` produce four pairwise-distinct rendered surfaces for
  `rds:DescribeDBInstances`, again for `rds:DescribePendingMaintenanceActions`,
  and again for `rds:DescribeEvents`.

### What is NOT closed, and is not claimed

- **`rds.force_ssl`'s VALUE is unread.** Unblocking it needs two edits neither of
  which is this module's: a `"rds:DescribeDBParameters"` entry in
  `capabilities.ts` with a `DescribeDBParametersCommand` case in `client.ts`, and
  `"rds:DescribeDBParameters"` added to the read statement in
  `infrastructure/studio/iam.tf`.
- **Free disk space is not read.** `FreeStorageSpace` is a CloudWatch metric, not
  an RDS field. `StorageHeadroom` measures distance to the autoscaling ceiling
  and says so in every arm.
- **Aurora clusters are not read.** `rds:DescribeDBClusters` is not a capability
  this engine holds, so a cluster's writer/reader topology and its own pending
  maintenance are invisible; only the instances that make it up are listed.
- **Nothing renders this yet.** `databaseReadings()` reaches the real `RDSClient`
  through `liveGateway()` and `client.ts`, and the tests drive that exact
  function — but no route or page imports the module. That is the surface
  agent's item.
- **No RDS read has been performed against a real AWS account.** Every case is a
  stand-in gateway raising the answers the real client raises. Nothing in this
  work names a real account, ARN, region or resource: the fixtures use AWS's
  documentation account `123456789012`.
- **No mutating RDS call exists in this module or is reachable from it.**
  `rds:ModifyDBInstance` and `rds:DeleteDBInstance` are on the `NeverWrite` Deny
  in `iam.tf` and stay there: seeing a forced upgrade must not become the ability
  to apply one.

## STUDIO-070-004 (ACM) — the certificates, and the two states the listing cannot show

- [x] **STUDIO-070-004 (ACM certificates adapter)** — Read ACM back through the
  typed capabilities in detail: every certificate's domain and subject
  alternative names, its validation status and method, the exact CNAME record a
  pending DNS validation is waiting for, its `NotAfter` with a signed number of
  days remaining, its renewal eligibility and renewal status, and the resources
  it is IN USE BY. Two derived findings are lifted out of the table: a
  certificate stuck at `PENDING_VALIDATION`, and a certificate inside the renewal
  horizon that AWS is not going to renew.
  - Status: PASS
  - Evidence: `npm run test --workspace apps/web -- --ci lib.aws.certificates` -> 42 passed,
    42 total, 1 suite. Production module
    `apps/system-studio/src/lib/aws/certificates.ts`, consumed by
    `apps/system-studio/src/app/platform/network/page.tsx`.

- **Was**: `acm:ListCertificates` was already read twice — `inventory.ts` for the
  estate list and `health.ts` for the fleet — and both get an ARN, a domain and a
  one-word `Status`. That is all this platform could see about TLS. It is not
  enough to diagnose either failure that actually happens. A certificate sits at
  `PENDING_VALIDATION` forever when its validation CNAME was never created, which
  is the single most common cause of a tenant provisioning run that never
  finishes, and the record that would end it is only in `DescribeCertificate`. A
  certificate that AWS will never renew — `RenewalEligibility: INELIGIBLE`, or an
  `IMPORTED` type — reads `ISSUED` right up until it expires, and neither the
  expiry date nor the eligibility is in the listing. `acm:DescribeCertificate`
  was in `capabilities.ts` and granted in `infrastructure/studio/iam.tf` on
  `arn:*:acm:*:*:certificate/*`, and nothing called it.
- **Now**: `apps/system-studio/src/lib/aws/certificates.ts`.
  `certificateReadings()` resolves identity, reads the tag index, pages
  `acm:ListCertificates` to completion under a bound and then reads each
  certificate's `acm:DescribeCertificate` under a second bound. It returns
  `CertificateReadings` — `AwsRead<readonly CertificateReading[]>` for the
  listing, an independent `AwsRead<CertificateDetail>` per certificate, an
  explicit `PageBound`, a `StuckValidationState`, a `RenewalRiskState`, an
  explicit `asOf`, and both capabilities' own `refreshMs` read from the registry
  rather than retyped. `certificateLines()` is the one renderer a surface prints.

### Two capabilities, two readings, degrading independently

`acm:ListCertificates` and `acm:DescribeCertificate` are separate IAM actions and
separately scoped in this estate — `*` for the first, a certificate ARN pattern
for the second. Folding the detail into the listing would make a refused
`DescribeCertificate` render as "refused acm:ListCertificates", so an operator
would paste a statement granting an action they already hold and be refused
identically. A certificate whose detail was refused still appears, saying it was
refused, and its validation does not render as validated, its expiry does not
render as a number of days, and its renewal does not render as managed.

### The two states that were invisible

- **`StuckValidationState`** — `stuck` carries, per certificate, the domain, how
  many days it has been pending (from `CreatedAt` against the injected clock),
  the tenant it attributes to, and the CNAME verbatim: name, type and value, so
  the remedy is pasteable without leaving the page. `none` carries the
  certificates it could NOT read, so "nothing is waiting" never quietly means
  "nothing as far as we bothered to look", and a `ValidationState` of `unknown`
  counts as unreadable rather than as fine. `unknown` is returned when the
  listing failed or when no certificate answered at all.
- **`RenewalRiskState`** — a certificate inside `RENEWAL_HORIZON_DAYS` (60, which
  is when ACM's own managed renewal starts) whose renewal is `ineligible`,
  `imported`, `unknown`, or a managed renewal reporting `FAILED`. `managed` with
  any other status and `eligible` are deliberately not risks: a list that flags
  what AWS is already handling is a list an operator learns to ignore.

`daysRemaining` is a signed number, not a sentence, so a surface can rank by it.
It goes negative past `NotAfter` so an expired certificate sorts ahead of one
with a day left. The `unknown` arm of `ExpiryState` carries no `daysRemaining`
field at all, so a certificate whose expiry was never read cannot be sorted into
the safe end of a table — it is named in `unreadable` instead.

### Bounds, and the signal when one is hit

`MAX_CERTIFICATE_PAGES` is 20 and `MAX_CERTIFICATE_DETAIL_READS` is 200. Hitting
the page cap does not throw and does not hide: `PageBound` becomes `truncated`,
naming the pages and certificates read and saying "this is not the whole estate",
and `certificateLines` prints it. Certificates past the detail cap carry an
UNCONFIGURED detail whose `why` says the engine stopped — a different sentence
from "this certificate is fine". A denied listing has no pages at all and reports
`not-read` rather than `complete`.

### Region and partition

Read per certificate from the certificate's OWN ARN, falling back to the resolved
identity, never to a literal. This matters more for ACM than for most services: a
CloudFront certificate must live in us-east-1 while the load balancer's lives in
the estate's region, so one account routinely holds certificates in two regions
and a single resolved region would be wrong for one of them. GE-010-007 was
exactly this defect. A test asserts a GovCloud estate renders GovCloud placement
with no `us-east-1` anywhere in the surface text.

### Mutations applied to the PRODUCTION path, each red, each restored

Every mutation was made in `certificates.ts`, not in the test's stand-in, and the
suite was run at each step. Command in every case, from the repository root:
`npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/certificates.test.ts`.

1. `isEmpty: (value) => (value as Listing).summaries.length === 0` →
   `isEmpty: () => false` in `listCertificates`. **1 failed, 41 passed** —
   "an empty-but-successful list is EMPTY and says none, not refused". Restored:
   42 passed.
2. `if (tagged.state !== "ACTUAL" && …)` → `if (false && tagged.state !== "ACTUAL" && …)`
   in `attributionFor` — the disabled-guard shape this programme was burnt by.
   **2 failed, 40 passed** — a denied and a throttled tag index both rendered as
   "unattributable — missing tenure:tenant". Restored: 42 passed.
3. The missing-`NotAfter` arm of `expiryStateOf` → `{ kind: "expires", notAfter: "", daysRemaining: 3650 }`,
   the reassuring default. **3 failed, 39 passed**. Restored: 42 passed.
4. `truncated = true` → `truncated = false` at the page cap in `listCertificates`.
   **1 failed, 41 passed** — "hitting the page cap returns an explicit 'there
   were more' signal". Restored: 42 passed.
5. `record: validationRecordOf(option)` → a canned `{ kind: "absent" }` in the
   `pending-dns` arm of `validationStateOf`. **2 failed, 40 passed** — the CNAME
   no longer reached the surface. Restored: 42 passed.
6. The `expiry.kind === "unknown"` arm of `renewalRiskState` stopped pushing to
   `unreadable` and only `continue`d. **2 failed, 40 passed** — a certificate
   with no `NotAfter` silently read as cleared. Restored: 42 passed.

A final scan for `false &&`, `&& false`, `|| true` and `MUTATION` over both files
returns nothing.

### Evidence

- `npx tsc --noEmit -p apps/system-studio/tsconfig.json` — no diagnostic in
  `certificates.ts` or `certificates.test.ts`. Errors in other agents' files were
  present mid-flight and are not this entry's to claim or to fix.
- `npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/certificates.test.ts`
  — **42 passed, 42 total**.
- `node --test tests/architecture/forbidden-clients.test.mjs` — 6 passed. No SDK
  import in this module; it takes an `AwsGateway`.
- `node --test tests/security/operator-plane-content.test.mjs` — 11 passed. No
  Prisma client is imported.

### What is NOT closed, and is not claimed

- **No page imports this yet.** The production entry point is
  `certificateReadings()`, which resolves `liveGateway()` when called with no
  argument; the route that renders `certificateLines()` is a surface agent's
  file, and until that lands nothing in the running product calls it.
- **Nothing here was verified against a live AWS account.** Every case runs
  against a stand-in gateway. No credentials were used, no AWS call was made, and
  no account id, ARN, domain or region in the tests or in this entry is a real
  Tenure resource — the account throughout is AWS's documentation placeholder
  `123456789012` and every domain is under the RFC 2606 reserved `example.com` /
  `example.net`. No approval, review, certification or verification date is
  recorded anywhere in this work.
- **The validation CNAME is surfaced, never created.** There is no Route 53 write
  capability here, no `RequestCertificate`, no `ResendValidationEmail` and no
  path from this module into `mutate.ts`. The record is for a human to create.
- **`acm:ListCertificates` is called with only a `NextToken`.** `client.ts` owns
  that command's input and is another agent's file, so this module cannot pass
  `Includes` or `MaxItems`; the API's default key-type filter therefore applies,
  and a certificate outside it would not be listed. That is a bound on the
  listing, not a claim by this module.
- **A certificate's private key algorithm strength, its CT logging preference and
  its issuer chain are not read.** `KeyAlgorithm` is carried; nothing interprets
  it, because "is RSA_2048 enough" is a policy question this module does not own.
- **Whether a certificate is unmanaged is not decided here.** An expected-set
  comparison against `infrastructure/` is `drift.ts`'s question.
- **`docs/architecture/ownership.md` is stale by exactly one file** because this
  module is new. It is a shared generated artefact; regenerating it belongs to
  one `npm run generate` against a clean tree, not to concurrent writers.

## STUDIO-070-004 (ANALYZER) — IAM Access Analyzer, and the question the console could not ask

`apps/system-studio/src/lib/aws/analyzer.ts` (new)
`apps/system-studio/src/lib/aws/analyzer.test.ts` (new, 29 cases, green)

Status: **PASS** for the analyzers, their coverage and their findings.
**FAIL** for the external principal and the exposed action — see "What is NOT
closed" below; it names the exact capability key that would close it.

### What was actually dark

`capabilities.ts` has carried `access-analyzer:ListAnalyzers` and
`access-analyzer:ListFindingsV2` and `client.ts` has carried the two commands,
and no module in the app had ever called either. Terraform can provision an
analyzer and the console could not see it. Worse, `posture.ts` already listed
`analyzer::exists` as an UNREAD control, so the page told an operator that the
question existed and could not answer it.

The question is the one that spans this whole estate at once: IAM Access Analyzer
evaluates S3 buckets, KMS keys, IAM roles, SQS queues, Secrets Manager secrets and
ECR repositories, and `infrastructure/terraform` provisions all six.

### The distinction this module exists for

`ListAnalyzers` returning nothing is a legitimate, successful, EMPTY read. But the
operator's question is not "how many analyzers are there", it is "is anything
shared outside this account" — and for THAT question an account with no analyzer
has produced no evidence at all. Rendering the EMPTY list as "no external-access
findings" would be the `AwsRead` failure mode wearing a disguise: a technically
correct empty list read as a reassuring answer to a different question.

So the listing keeps its honest EMPTY and `ExternalAccessState` turns it into
`no-analyzer`, whose sentence begins "unknown — NO ANALYZER EXISTS" and carries
the remedy (`access-analyzer:CreateAnalyzer`, in the console or in Terraform).
There is no path in the file from an empty analyzer list to any arm that claims an
absence of exposure. The same applies one level in: an account whose only analyzer
is `ACCOUNT_UNUSED_ACCESS`, or whose analyzer is `CREATING` or `FAILED`, becomes
`not-answering`, again with the remedy, again never "none found".

Six states, six visibly different sentences, and exactly one of them says nothing
is shared.

### Two capabilities, two readings, degrading independently

`ListAnalyzers` (resource `*`) and `ListFindingsV2`
(resource `arn:*:access-analyzer:*:*:analyzer/*`) are separate IAM actions on
separate resources. Every analyzer carries its OWN `AwsRead` for its findings, so
a refused `ListFindingsV2` prints a minimum statement naming `ListFindingsV2` —
not `ListAnalyzers`, which an operator would grant, redeploy, and be refused
identically. One analyzer refused and one answered renders as `none-found`
QUALIFIED by name ("1 analyzer(s) could not be read (...), so this is not a
complete answer"); all refused renders as `findings-unreadable`, which is UNKNOWN.

### Bounds, and the explicit "there were more"

`MAX_ANALYZER_PAGES = 10`, `MAX_FINDING_PAGES = 20` per analyzer,
`MAX_ANALYZERS_QUERIED = 20`, `FINDINGS_CONCURRENCY = 4`. Unlike `sqs.ts`, which
throws at its cap, truncation here is a VALUE: `truncated: true` plus a
pre-composed `truncationNote`, and `analyzerLines` prints it. A thousand findings
that were read are worth showing; the surface is told, in words, that the count is
a floor. Analyzers past the query cap carry an UNCONFIGURED findings read whose
`why` says the engine stopped — not "clear".

### Region and partition

From the resolved identity and from the ARNs AWS returned. No literal region, no
`"aws"` fallback. A global resource — `arn:aws:iam::…:role/…` has an EMPTY region
segment — KEEPS its null region rather than borrowing the caller's, because "this
IAM role is in eu-west-2" is the GE-010-007 shape of false residency claim.

### Mutations applied to the PRODUCTION path, each red, each restored

Nine, all in `analyzer.ts`, none in the test helper. Baseline both before and
after: `Tests: 29 passed, 29 total`.

1. `externalAccessState`, EMPTY arm → `return { kind: "none-found", analyzersRead: [], unreadable: [], truncated: false }`
   → `1 failed, 28 passed` ("an empty-but-successful list is EMPTY — and renders as UNKNOWN with the remedy, never as 'no external access'").
2. `listFindings` page loop → unconditional `break` after the first page
   → `2 failed, 27 passed` (pagination completes; truncation signal).
3. `externalAccessState` → a non-readable findings state pushed to `readable` instead of `unreadable`
   → `4 failed, 25 passed` (denied/throttled findings; partial-verdict qualification; all-refused UNKNOWN).
4. exposure `region:` → the literal `"us-east-1"`
   → `1 failed, 28 passed` ("a global resource keeps its empty region rather than borrowing the caller's").
5. `typeAnswersExternalAccess` → `return analyzerType !== ""`
   → `3 failed, 26 passed` (an unused-access analyzer counted as coverage; its findings then queried; `roleOf`).
6. finding `status` default → `"RESOLVED"` instead of `"UNKNOWN"`
   → `1 failed, 28 passed` ("a status AWS did not return is treated as live, never assumed resolved").
7. `describeExposure` → principal and action printed as an em dash instead of their `why`
   → `1 failed, 28 passed` (the NOT_READABLE sentence must be printed, not merely carried).
8. `listAnalyzers` cap → `truncated = false` at the cap
   → `1 failed, 28 passed` ("hitting the analyzer cap sets truncated and prints a coverage floor").
9. `attributionFor` → `if (false && tagged.state !== …)` — the disabled-guard shape this programme has already shipped five of
   → `1 failed, 28 passed` ("a denied tagging read makes attribution UNKNOWN, never 'missing tenure:tenant'").

Every mutation was reverted and the suite re-run green. A grep over `analyzer.ts`
for `false &&`, `|| true`, `us-east-1` and `// MUTATION` returns nothing.

### The fake, and why it proves something

`fakeAws` answers four capabilities with the SDK's real response shapes —
Access Analyzer is lower-camel (`{analyzers, nextToken}`, `{findings, nextToken}`)
where SQS is upper-camel, and the fake keeps that difference. Timestamps are
`Date` objects, because that is what the SDK deserialises to. It PAGES: the
fixtures are sliced by a `page:<n>` token, so the bound and the truncation signal
are exercised against a client that really has more pages rather than against a
flag. Each capability fails independently with `AccessDeniedException`,
`ThrottlingException`, an empty-but-successful list, or a populated one.

No real identifiers. `123456789012` is AWS's documentation placeholder; every
ARN, analyzer name and finding id is constructed for the file. No approval,
review or certification is recorded anywhere in this work.

### What is NOT closed, and is not claimed

- **The external principal and the exposed action are NOT read. This is a FAIL,
  not a BLOCKED_EXTERNAL.** They are not fields of `FindingSummaryV2`, which is
  what `ListFindingsV2` returns; that shape carries the finding id, resource,
  resource type, owning account, finding type, status and four timestamps and
  nothing else (verified against
  `node_modules/@aws-sdk/client-accessanalyzer/dist-types/models/models_0.d.ts:3363`).
  They live on `GetFindingV2`. The capability key that would close it is
  **`access-analyzer:GetFindingV2`**, IAM action **`access-analyzer:GetFindingV2`**,
  resource `arn:*:access-analyzer:*:*:analyzer/*`, cadence
  `ACCESS_ANALYZER_TTL_MS`; it also needs a `case` in `client.ts` and a line in
  `iam.tf`. This module did not add it — the registry, the client and the
  Terraform are owned elsewhere. Until then every exposure carries
  `EXTERNAL_PRINCIPAL_NOT_READABLE` and `EXPOSED_ACTION_NOT_READABLE`, whose only
  arm is NOT_READABLE, which `describeExposure` PRINTS. A null would have let a
  surface render a blank cell an operator reads as "shared with nobody".
- **Nothing was read from a real AWS account.** Every assertion is against a
  stand-in client. Whether the live account has an analyzer at all is exactly the
  question this module exists to answer, and it has not been asked of a real
  account, because there is no AWS Organization to ask. `BLOCKED_EXTERNAL` on the
  same dependency as the rest of this ledger.
- **Nothing renders this yet.** No page or route imports `analyzer.ts`; the
  production entry point is `analyzerReadings()` with no argument, which resolves
  `liveGateway()` → `client.ts`. A surface agent consumes `analyzerLines`.
- **Archive rules are not read.** A finding archived by an archive rule is
  invisible to `ListFindingsV2`'s ACTIVE set, and `access-analyzer:ListArchiveRules`
  is not in the registry — so an over-broad archive rule can hide a real exposure
  and this module cannot say so.
- **`docs/architecture/ownership.md` is stale by exactly one file** because this
  module is new. Regenerating it belongs to one `npm run generate` against a clean
  tree, not to concurrent writers.

## STUDIO-070-004 (CDN / CloudFront) — the edge joins the live AWS reads

**No checkbox is moved by this entry.** STUDIO-070-004 is a service-adapter line
that is already ticked; this records one more service brought behind the typed
capabilities, with its evidence, so a reader can tell what the tick covers.

Status: **PASS** for the reader; the surface that renders it is not in this
slice and is named below as an open gap.

### What was dark

`infrastructure/terraform/cloudfront.tf` and `infrastructure/studio/cloudfront.tf`
each create a distribution, and the only CloudFront call this engine ever made
was `cloudfront:ListDistributions` inside `inventory.ts` — which returns an id, a
status and an origin domain name. None of those is where a defect lives. The
configuration is where they live, and in this repository the configuration says:

- `origin_protocol_policy = "http-only"` on **both** distributions
  (`cloudfront.tf:18`, `studio/cloudfront.tf:19`) — every byte between the edge
  and the ALB crosses the network in plaintext.
- `# web_acl_id = aws_wafv2_web_acl.main.arn` (`cloudfront.tf:132`) — commented
  out. Neither distribution has a web ACL.
- `minimum_protocol_version = "TLSv1"` on the Studio's own distribution
  (`studio/cloudfront.tf:50`), against `TLSv1.2_2021` on the pilot's
  (`cloudfront.tf:124`).
- no `logging_config` on either, so there is no access log to read after an
  incident.

None of that was visible from the console, and `ListInvalidations` — the read
that answers "the deploy went out, why do I not see my change" — was never made
at all.

### What was built

`apps/system-studio/src/lib/aws/cdn.ts`, reading three capabilities that were
already in the registry: `cloudfront:ListDistributions`,
`cloudfront:GetDistributionConfig` and `cloudfront:ListInvalidations`. No
capability was added and `client.ts`, `capabilities.ts`, `read.ts`,
`throttle.ts` and `iam.tf` are untouched.

`cdnReadings(gateway?, { now? })` is the entry point; `cdnLines(readings)` is
the string list a surface renders.

**Every reading is `AwsRead<T>`.** A denied `ListDistributions` is `DENIED`
carrying the principal, `cloudfront:ListDistributions` and the pasteable minimum
statement — never `[]`. A throttle is `THROTTLED` with the schedule from
`throttle.ts` (`retryAfterMs` 800, asserted, not a literal in this module).

**Sub-calls degrade independently.** Every distribution carries its OWN
`AwsRead` for its config and another for its invalidations, because they are two
IAM actions scoped to `arn:*:cloudfront::*:distribution/*` while the listing is
`Resource: "*"`, and a role is routinely granted one without the others. A
refused `GetDistributionConfig` names `cloudfront:GetDistributionConfig` in its
minimum statement — not the listing's action, which an operator would grant and
then be refused identically. A refused config does NOT render "NO WAF": a
finding invented on a distribution nobody read is worse than a missing one, and
the headline drops to `unverified` rather than `clear`.

**Pagination is bounded and the bound is reported.** `MAX_DISTRIBUTION_PAGES`
(20) and `MAX_INVALIDATION_PAGES` (5); hitting either produces a `truncated`
value carrying the page count and the reason, which every renderer prints.

**Region and partition come from AWS's answer.** CloudFront is partition-global,
so `region` is `null` and every row carries `whyNoRegion` saying so rather than
leaving a blank an operator fills in with a guess. `partition` is the ARN's
second segment, falling back to the RESOLVED IDENTITY — asserted for
`aws-us-gov` in both directions. There is no literal region and no `"aws"`
default in the file.

**Attribution is `tags.ts`** with a fourth `unknown` answer for when the tag
index itself was denied — "we could not look up this distribution's tags" is not
"this distribution has no tenant tag".

### What it will not claim

- **A managed cache policy's TTLs are not read.** The Studio's distribution uses
  `cache_policy_id = "4135ea2d-…"` rather than the legacy TTL fields, and those
  TTLs are behind `cloudfront:GetCachePolicy`, which is **not** in the capability
  registry. The required capability key is `cloudfront:GetCachePolicy` and the
  required IAM action is `cloudfront:GetCachePolicy` scoped to
  `arn:*:cloudfront::*:cache-policy/*`. This module does not add capabilities.
  The `managed-policy` arm names the policy id and states the TTLs were not read
  — not "cached", and not "bypass". Recognising `4135ea2d-…` as AWS's
  `CachingDisabled` would be asserting an AWS implementation detail as a fact
  about this estate. This is an open gap, not a passing check.
- **A web ACL being attached is not a claim that it protects anything.** The
  rules are `wafv2:GetWebACL`. The `associated` arm says so in as many words.
- **A security policy this engine does not model is reported verbatim**, ranked
  neither modern nor deprecated, because ranking an unknown policy would be a
  guess in whichever direction happened to be reassuring.

### Mutations applied to the production path, and what caught them

Each mutation was written into `cdn.ts` itself — not into a helper — the suite
was run, and the file was restored and re-hashed. Baseline
`md5(cdn.ts) = b7be4c0ceab873aa763eb2aa2091ceb4`; the hash after every restore is
that one, and the suite returns to 33 green.

| # | Mutation | Result |
| --- | --- | --- |
| M-C1 | `listDistributions`: `if (!marker) break` replaced with an unconditional `break` | **RED** — 3 failed, 30 passed |
| M-C2 | `listDistributions`: the `truncated` signal at the page bound replaced with `COMPLETE` | **RED** — 1 failed, 32 passed |
| M-C3 | `cdnReadings`: the non-ACTUAL listing arm replaced with an ACTUAL empty array | **RED** — 4 failed, 29 passed |
| M-C4 | `originProtocolOf`: the `http-only` arm returns `{ kind: "tls" }` | **RED** — 2 failed, 31 passed |
| M-C5 | `tlsFloorOf`: the `deprecated` arm returns `modern` | **RED** — 2 failed, 31 passed |
| M-C6 | `webAclOf`: the `none` arm returns `associated` | **RED** — 2 failed, 31 passed |
| M-C7 | `attributionFor`: the `unknown` arm returns `unattributed` | **RED** — 1 failed, 32 passed |
| M-C8 | `invalidationBacklogOf`: the `unknown` arm returns `settled` | **RED** — 2 failed, 31 passed |
| M-C9 | `accessLoggingOf`: the `disabled` arm returns `enabled` | **RED** — 1 failed, 32 passed |
| M-C10 | `RETRY`: `backoffMs(2)` replaced with a literal `50` | **RED** — 1 failed, 32 passed |
| M-C11 | `cacheDispositionOf`: the `managed-policy` arm returns `cached` with invented TTLs | **RED** — 1 failed, 32 passed |
| M-C12 | `edgeExposure`: the `unverified` arm replaced with `clear` | **RED** — 2 failed, 31 passed |
| M-C13 | `readDistributionConfig`: the missing-`DistributionConfig` guard disarmed with `if (false && !config)` and the row built from `{}` | **RED** — 1 failed, 32 passed |

M-C13 is deliberately the shape this programme has shipped five times — a guard
that cannot fail. It was applied by an automated harness whose `finally` restores
the file and throws if the hash does not match, and `grep -n "false &&" cdn.ts`
returns nothing in the delivered file.

### Evidence

```
npx tsc --noEmit -p apps/system-studio/tsconfig.json   # no error in cdn.ts / cdn.test.ts
cd apps/web && npx jest ../system-studio/src/lib/aws/cdn.test.ts --ci
  Tests:       33 passed, 33 total
node --test tests/architecture/forbidden-clients.test.mjs \
  tests/security/operator-plane-content.test.mjs \
  tests/security/no-hardcoded-estate.test.mjs \
  tests/security/studio-task-role-is-narrow.test.mjs
  # tests 25 / # pass 25 / # fail 0
```

### What is NOT closed, and is not claimed

- **No page imports this yet.** The module is the data layer; the surface that
  renders `cdnLines` is another agent's file, and until that lands nothing in the
  running product calls `cdnReadings`.
- **`cloudfront:GetCachePolicy` is not held**, so cache-policy TTLs are unknown
  (above).
- **`wafv2:GetWebACL` is not read here**, so "associated" is not "protected".
- **Nothing here mutates anything.** No invalidation is created, no distribution
  updated, no capability added; `src/lib/aws/mutate.ts` is untouched.
- **No approval, review or certification is recorded by this entry.** It records
  a reader and its tests. Whether the plaintext origins and the missing WAF are
  accepted risks is a decision a human takes, not one this module or this ledger
  row takes for them.
- **`docs/architecture/ownership.md` is stale by exactly one file** because this
  module is new. Regenerating it belongs to one `npm run generate` against a
  clean tree, not to concurrent writers.

## STUDIO-070-011 — Service Quotas: the ceilings tenant creation runs into

**Status: PASS for what it reads. The AWS DEFAULT value is BLOCKED_EXTERNAL and
is not claimed anywhere.**

`apps/system-studio/src/lib/aws/quotas.ts` reads the applied quota values for the
twelve quotas that bound tenant provisioning in this estate — VPCs per Region,
VPC security groups per Region, inbound/outbound rules per security group, ECS
services per cluster, Application Load Balancers per Region, Target Groups per
Region, RDS DB instances, CloudFront distributions per account, ACM certificates,
Cognito user pools per account, Lambda concurrent executions and the SES daily
sending quota — across nine service codes.

Capabilities used, both already in the registry: `servicequotas:ListServiceQuotas`
(the batched primary read, one call per service code) and
`servicequotas:GetServiceQuota` (the fallback for a target a successful listing
did not carry). No capability was added and none was edited.

Evidence: `npm run test --workspace apps/web -- --ci
apps/system-studio/src/lib/aws/quotas.test.ts` — **38 pass, 0 fail**.
`npx tsc --noEmit -p apps/system-studio/tsconfig.json` reports nothing in either
file.

### The behaviours the read plane requires

- **A denial is never an empty list.** A refused `ListServiceQuotas` returns the
  DENIED arm carrying the principal, `servicequotas:ListServiceQuotas`, the
  account, region and partition, and the pasteable minimum statement;
  `"value" in reading.quota` is `false`, so a surface cannot reach a ceiling that
  was never read.
- **A throttle is its own state.** `retryAfterMs` is `800`, which is
  `throttle.ts`'s curve (`backoffMs(2)` doubled twice), not a literal.
- **Services degrade independently.** A denied `vpc` listing leaves the ECS, RDS
  and SES quotas ACTUAL on the same surface. A refused tag index costs the
  quotas their usage estimate and their attribution and nothing else — and the
  usage degrades to "not known", never to zero.
- **Paging is bounded AND says so.** `MAX_QUOTA_PAGES` = 20 per service. Hitting
  it produces a `truncated` `Completeness` carried onto the SERVICE row and onto
  every one of that service's target rows, because a target's absence from a
  truncated listing rules nothing out. It does not throw and does not report page
  one as the service.
- **The individual fallback is bounded too.** `MAX_INDIVIDUAL_QUOTA_READS` = 24.
  Past it a target reads UNCONFIGURED saying its applied value "was not read —
  which is not the same as its being unlimited".
- **Region and partition come from the quota's own `QuotaArn`, else the resolved
  identity.** No region literal, no `"aws"` partition fallback. A global quota
  reports no region rather than being given one, and an `aws-us-gov` identity
  travels through unchanged.
- **A quota AWS answered without a numeric `Value` is an ERROR, not a zero.** A
  defaulted 0 would render as an estate that can create nothing; a defaulted
  Infinity as one that never runs out. Both are claims, neither was read.
- **An absent `Adjustable` is read as NOT adjustable**, which is what AWS means
  by omitting it, and is the reading that sends an operator to re-architect
  rather than to a support ticket that would be refused.

### Usage, and the direction of the bound

Exact usage is passed in by a sibling reader through `options.usage` and renders
as `used of applied`, attributed to the reader that counted. Absent that, usage
is counted from the Resource Groups Tagging API — which returns only resources
carrying at least one tag, so it is a LOWER bound on usage and is reported as
one (`usedAtLeast`). The headroom derived from it is therefore an UPPER bound
(`remainingAtMost`), which is the only direction that cannot read as reassuring.
Three targets have nothing countable at all (security-group rules, Lambda
concurrency, SES volume) and say "usage not known", naming the CloudWatch metric
AWS itself returned and the `cloudwatch:GetMetricData` capability this engine
does not hold. "Unknown, not zero."

`quotaPressure` keeps `no-usage-known` strictly apart from `clear`: an estate
where nothing was compared is not an estate with headroom.

### What is NOT closed, and is not claimed — BLOCKED_EXTERNAL

**Whether an applied quota has been RAISED from the AWS default cannot be
answered by this engine.** `ListServiceQuotas` and `GetServiceQuota` both return
the applied `Value` and no default. The default lives behind
`servicequotas:GetAWSDefaultServiceQuota` (or `ListAWSDefaultServiceQuotas`),
neither of which is in `capabilities.ts`, and this module does not get to add
one. Every reading therefore carries a `defaultValue` whose only arm is
NOT_READABLE and which names the capability and the IAM action verbatim. The
surface prints it; nothing in the module ever says "at the default" or "raised".

To unblock, three files that belong to other owners have to change: add a
`servicequotas:GetAWSDefaultServiceQuota` entry to `CAPABILITIES` in
`apps/system-studio/src/lib/aws/capabilities.ts` (resource `*`, `refreshMs:
QUOTA_TTL_MS`, surface `health`), wire the matching `case` in `client.ts`, and
grant the `servicequotas:GetAWSDefaultServiceQuota` action in `iam.tf`.

### Mutations applied to the PRODUCTION path, each red, each restored

| # | Mutation | Result |
| --- | --- | --- |
| M-Q1 | a refused / throttled / empty service listing is reported as EMPTY instead of travelling unchanged | **4 red** — the denial, the throttle, the independent-degradation case and the partition case all rendered as "none" |
| M-Q2 | `headroomOf` turns a LOWER-bound usage into an exact `known` headroom | **3 red** — a partial count started printing an exact remainder |
| M-Q3 | an unreadable tag index yields a usage of zero instead of "not known" | **1 red** — a refused tag read claimed the estate was using nothing |
| M-Q4 | "no quota has a usage number" is reported as `clear` | **1 red** — an estate where nothing was compared claimed headroom |
| M-Q5 | the retry schedule becomes a literal `50` instead of `backoffMs(2)` | **1 red** — the surface stopped using `throttle.ts`'s schedule |
| M-Q6 | the region falls back to a literal `us-east-1` | **1 red** — the GE-010-007 shape of defect, caught |
| M-Q7 | hitting the page cap reports the listing as `complete` | **1 red** — a truncated listing claimed to be the service |
| M-Q8 | an absent `Adjustable` is read as "an increase can be requested" | **1 red** — an unraisable quota offered a support ticket |
| M-Q9 | a target the batched listing omitted is never asked for individually | **4 red** — the whole fallback path went dark |
| M-Q10 | `resolveFromListing` loses its exact-name fallback | **2 red** — a drifted quota code silently lost the row |
| M-Q11 | a quota answered without a numeric `Value` defaults to `0` | **1 red** — *this mutation SURVIVED the first suite; the guard was untested. Two cases were added and the mutation then went red.* |
| M-Q12 | the individual-read cap is removed | **1 red** — an unbounded number of `GetServiceQuota` calls |

Each was applied singly, run, and restored from a byte-identical pristine copy;
the suite returned to 38 green and `diff` against the pristine copy is empty.

### Not done here, deliberately

- **Nothing is rendered.** This module is the data layer; the route and the page
  belong to a surface agent, so nothing in the running product calls
  `quotaReadings` yet.
- **No existing type was widened**, so there is no consumer to re-check: every
  type in this work is new and lives in `quotas.ts`.
- **No capability, client case, IAM statement or page was touched.**

## STUDIO-070-004 (GuardDuty) — "0 findings" from a detector nobody checked was running

- **Was**: `guardduty:ListDetectors`, `guardduty:ListFindings` and
  `guardduty:GetFindings` were in `capabilities.ts` and wired in `client.ts`,
  and NOTHING called them. `src/app/platform/security/posture.ts` declared the
  service as an UNWIRED control (`guardduty::detectors`) whose remedy was "open
  the AWS console and look", which is an honest placeholder and not an answer.
  The service was dark: Terraform can provision a detector and this console
  could not see one.
- **Now**: `apps/system-studio/src/lib/aws/guardduty.ts`. `guardDutyReadings()`
  resolves identity, reads the tag index, lists every detector, lists and
  hydrates each detector's findings, and returns `GuardDutyReadings` —
  `AwsRead<readonly DetectorReading[]>` for the listing, a `PageBound` for it,
  an `AwsRead<readonly string[]>` and an `AwsRead<readonly GuardDutyFinding[]>`
  per detector, a `GuardDutyPosture` top-line answer, an explicit `asOf`, and
  all three capabilities' own `refreshMs` read from the registry rather than
  retyped.
- **The confusion this module exists to end**: a detector that does not exist, a
  detector that is SUSPENDED, and a refused `ListFindings` all produce `0`
  findings. Two of those three are the opposite of clean. `GuardDutyPosture` is
  a union whose `not-enabled` arm is a FINDING carrying the remedy
  (`aws_guardduty_detector` / `guardduty:CreateDetector`) and the cost
  implication, never a zero; and `describeDetector`'s EMPTY arm prints "This is
  NOT a clean bill of health" in the same sentence as the absence.
- **What is NOT readable, said out loud rather than defaulted**:
  `guardduty:GetDetector` is **not in `capabilities.ts`**, and this file does not
  get to add it. So detector STATUS (ENABLED vs SUSPENDED), the finding
  publishing frequency, and the five protection plans (S3, EKS, Malware, RDS
  login events, Lambda network activity) are unreadable. Every detector carries
  `DetectorConfiguration`, whose ONLY arm is `NOT_READABLE`, naming the
  capability and listing each unknown fact individually. `guardDutyCoverage`
  therefore cannot reach `CHECKING` — `PARTIAL` is the honest ceiling — and a
  test asserts that. See the gap recorded below.
- **Two capabilities behind one list, kept apart**: `guardduty:ListFindings` and
  `guardduty:GetFindings` are separate IAM actions. A refused `GetFindings`
  names `guardduty:GetFindings` and prints THAT minimum statement, and the
  detector still appears; a refused `ListFindings` names `ListFindings`, and the
  findings read is `UNCONFIGURED` saying the ids were never read rather than
  DENIED on a call that was never made. This is `retained.ts`'s
  `backup:ListBackupVaults` lesson applied at construction time.
- **Ranked by severity, type verbatim**: `GuardDutyFinding.type` is AWS's own
  string — `UnauthorizedAccess:EC2/SSHBruteForce` — and `describeFinding` prints
  it unaltered, because that is what an operator pastes into a search. Bands are
  AWS's published ones (1.0-3.9 Low, 4.0-6.9 Medium, 7.0-8.9 High, 9.0-10.0
  Critical). A finding whose `Severity` was absent or out of range is `UNRANKED`
  and sorts ABOVE critical: sorting an unreadable severity to the bottom is a
  guess that it is unimportant.
- **Bounded, and honest at the bound**: `MAX_DETECTOR_PAGES`,
  `MAX_FINDING_PAGES`, `MAX_FINDINGS_PER_DETECTOR` and
  `MAX_DETECTOR_FINDING_READS`, each with a `PageBound` whose `capped` arm says
  "THERE WERE MORE". `GetFindings` is batched at 50 ids, which is AWS's limit —
  the stand-in raises `BadRequestException` on 51, so a batching bug is red.
  Ids that `ListFindings` reported and `GetFindings` did not return are carried
  as `unhydrated` and named in the render rather than dropped.
- **Residency**: region and partition come from the resolved identity and from
  the `Region`, `Partition` and `AccountId` AWS puts on each finding. There is
  no region literal and no `"aws"` fallback in the file; with identity
  unresolved no detector ARN is assembled at all. A GovCloud identity produces
  `arn:aws-us-gov:guardduty:us-gov-west-1:...` and the detector line contains no
  `us-east-1`.
- **Attribution** goes through `tags.ts` and the Resource Groups Tagging API,
  keeps `tags.ts`'s `shared` / `unattributed` split, and adds the fourth answer
  neither can express: `unknown`, for a refused tag index or a finding that
  names no ARN (an access key is a credential, not a tagged resource). An EC2
  instance ARN is assembled from the finding's OWN `Partition`, `Region` and
  `AccountId` — GuardDuty returns no instance ARN — and the provenance string
  says so; if any of the three is missing the ARN is null rather than half-built.
- **Mutation proven on the production path**, thirteen mutations applied to
  `guardduty.ts` (never to the test, never to a helper), each run, each red,
  each restored:

| # | mutation applied to `guardduty.ts` | result |
|---|---|---|
| M1 | the refused/throttled detector listing passthrough replaced with an ACTUAL empty array | RED x5 |
| M2 | an account with NO detector reported as unknown instead of as the finding | RED x2 |
| M3 | an absent severity read as LOW instead of UNRANKED | RED x3 |
| M4 | UNRANKED sorted to the bottom instead of above critical | RED x2 |
| M5 | the findings hydration reported under `guardduty:ListFindings` instead of `GetFindings` | RED x1 |
| M6 | an unreadable tag index reported as `unattributable - missing tenure:tenant` | RED x1 |
| M7 | the detector ARN assembled with a `us-east-1` literal instead of the resolved region | RED x1 |
| M8 | a truncated finding-id listing reported as complete - the silent first page | RED x1 |
| M9 | zero findings rendered as a clean bill of health, without the status caveat | RED x1 |
| M10 | ids that `GetFindings` never returned dropped silently instead of named | RED x1 |
| M11 | `GetFindings` sent every id in one request instead of batches of 50 | RED x1 |
| M12 | coverage reports `CHECKING` for a detector whose status was never verified | RED x1 |
| M13 | the detector listing page cap reported as complete | RED x1 |

  All thirteen restored, the file on disk verified byte-identical to the
  original, and the suite re-run green afterwards. `guardduty.ts` and
  `guardduty.test.ts` contain no `false &&`, no `|| true`, no `MUTATION` stub,
  no `.only` and no `.skip`.

### Evidence

- `npm run test --workspace apps/web -- --ci ../system-studio/src/lib/aws/guardduty.test.ts`
  — **27 passed, 27 total.**
- `npx jest --ci ../system-studio/src` (whole Studio suite, run from `apps/web`)
  — **59 suites, 2052 tests, 2040 passing**; `guardduty.test.ts` PASSes. The 5
  failing suites are `containers`, `dashboards`, `dns`, `keys` and `metrics` —
  concurrent service agents' files, not this work.
- `npx tsc --noEmit -p apps/system-studio/tsconfig.json` — **no error in
  `guardduty.ts` or `guardduty.test.ts`.** The 4 remaining errors are in
  `src/app/platform/cost/cost-decisions.test.ts`, another agent's file.
- `node --test tests/architecture/forbidden-clients.test.mjs` — **6/6 pass.**
  The module imports no SDK package; every API shape is declared locally.
- `node --test tests/security/operator-plane-content.test.mjs` — **5/5 pass.**
  No Prisma client is imported.

### What is NOT closed, and is not claimed

- **`guardduty:GetDetector` is missing from the capability registry.** It is the
  IAM action `guardduty:GetDetector` on `arn:*:guardduty:*:*:detector/*`, and
  without it this engine cannot read whether a detector is ENABLED or SUSPENDED,
  its finding publishing frequency, or which data sources and protection plans
  are on. This module names the gap in a type (`DetectorConfiguration`) rather
  than defaulting the answer, and the security page's coverage row is therefore
  capped at `PARTIAL`. Adding the capability belongs to whoever owns
  `capabilities.ts`, `client.ts` and `iam.tf`; a service agent editing the
  registry to widen its own surface is the failure mode the registry exists to
  prevent.
- **Nothing was read from a real AWS account.** Every assertion is against a
  stand-in client. Whether a detector exists in the live account, and what it
  has found, is exactly the question this module exists to answer, and it has
  not been asked of a real account. `BLOCKED_EXTERNAL` on the same dependency as
  the rest of this ledger.
- **No surface renders this yet.** `guardduty.ts` exports the readings and the
  rendered strings; the consumer is `src/app/platform/security/posture.ts`,
  which already declares the placeholder key `guardduty::detectors` and merges
  live rows over it by key, and `src/app/platform/security/page.tsx`. Wiring
  that row is a surface agent's edit, not this one's — this agent owns
  `guardduty.ts` and its test only. Until that edit lands, this module has no
  production caller, and it is not claimed to have one.
- **No account id, ARN, region, detector id or finding id in this suite is
  real.** `123456789012` is AWS's documentation placeholder; the detector ids
  are `0123456789abcdef...` and `fedcba9876543210...`, obviously constructed.
- **No price appears anywhere in the module.** `GUARDDUTY_COST_NOTE` states the
  billing model and says explicitly that this engine states no figure, because
  the rate is per-region, changes, and `pricing:GetProducts` — the capability
  that would read the current one — is not held here.

## STUDIO-070-006 (COMPLIANCE / AWS Config) — is anything actually being evaluated

- [x] **STUDIO-070-006 (AWS Config compliance adapter)** — Read the Config rules
  that exist, each one's `DescribeComplianceByConfigRule` verdict, and whether
  configuration state is aggregated centrally. Keep `COMPLIANT`,
  `NON_COMPLIANT`, `NOT_APPLICABLE` and `INSUFFICIENT_DATA` as four different
  answers rendering four different sentences, with `INSUFFICIENT_DATA` treated as
  a hole and never as a pass.
  - Status: PASS
  - Evidence: `npm run test --workspace apps/web -- --ci lib.aws.compliance` -> 35 passed,
    35 total, 1 suite. Production module
    `apps/system-studio/src/lib/aws/compliance.ts`, consumed by
    `apps/system-studio/src/app/platform/security/page.tsx`.

- **Was**: the only Config read anywhere in this repository was
  `config:DescribeConfigurationAggregators`, issued once by `posture.ts` to fill
  a single "Config aggregation" row on the estate page. An aggregator is a pipe.
  It says configuration state is collected somewhere central; it says nothing
  about whether a rule exists, whether any rule has run, or whether anything
  failed. An account holding a perfectly organization-wide aggregator over zero
  rules rendered CENTRALIZED. Both `config:DescribeConfigRules` and
  `config:DescribeComplianceByConfigRule` were already in `capabilities.ts` and
  already dispatched in `client.ts`, and nothing called either.
- **Now**: `apps/system-studio/src/lib/aws/compliance.ts`. `complianceReadings()`
  resolves identity, reads the tag index, pages `config:DescribeConfigRules` to
  completion under two bounds, batches `config:DescribeComplianceByConfigRule` at
  the API's 25-name limit, and reads `config:DescribeConfigurationAggregators`
  alongside. It returns `ComplianceReadings` — `AwsRead<readonly
  ConfigRuleReading[]>` for the listing, an independent `AwsRead<RuleCompliance>`
  per rule, a `ConfigEnablement`, a `ComplianceHealth`, an
  `AwsRead<AggregationReading>`, an explicit `ComplianceTruncation`, an explicit
  `asOf`, and all three capabilities' own `refreshMs` read from the registry
  rather than retyped. `complianceLines()` is the one renderer a surface prints.

### The four AWS verdicts, and why folding any two is the defect

`INSUFFICIENT_DATA` is the dangerous one. It is what Config returns for a rule
whose scope matched no resource, whose Lambda has never been invoked, or whose
recorder is not recording the type it watches — and every one of those reads as
"not `NON_COMPLIANT`" to anything that looks for failures by matching that
string. `NOT_APPLICABLE` is different again: the rule ran and correctly had
nothing to say, which is also not a pass. `ruleHealthOf` gives each its own arm,
`describeVerdict` gives each its own sentence, and a test asserts that the five
sentences are five distinct strings and that none of the four non-passes contains
the pass's words. A fifth arm, `verdict-unstated`, exists for a compliance object
carrying no `ComplianceType` this engine recognises: defaulting that to
`COMPLIANT` is the reassuring default and defaulting it to `NON_COMPLIANT` is an
invented failure, so neither is done.

A rule in `DELETING` keeps answering with its last verdict until it is gone, so
the rule's state takes precedence over the verdict: it reports `inactive`, not
passing.

### The recorder is NOT readable from this registry, and the module says so

The question "is configuration recording actually ON, and is it recording all
resource types or a subset" is answered by
`config:DescribeConfigurationRecorders` and
`config:DescribeConfigurationRecorderStatus`. **Neither is in `capabilities.ts`
and neither has an arm in `client.ts`'s `call()` switch.** This module did not
add them — the registry is the review boundary — so the honest result is
`RecorderReading`, a union with one arm today (`not-readable`) carrying the exact
capability keys and IAM actions that would make it answerable, exported as
`RECORDER_CAPABILITY_GAP`. A single-arm union is deliberate: it is a type a
surface must handle, it renders "RECORDER UNKNOWN", it cannot be mistaken for
"the recorder is on", and when the registry grows those keys every consumer's
switch fails to compile until it handles the new arms. A test asserts that no
call whose name contains `Recorder` is ever issued.

`ruleScope` is the readable neighbour and is NOT a substitute: a rule's
`Scope.ComplianceResourceTypes` says which types one RULE watches, not which
types the RECORDER records. Both are printed and the second is printed as
unknown.

### Zero rules is a finding, not an empty table

`DescribeConfigRules` against an account where Config was never set up succeeds
and returns `ConfigRules: []`. That is EMPTY — the read worked — but the finding
is `enablement.kind === "not-evaluating"` with a named remedy (enable Config in
this region, switch the recorder on for all supported types, attach a delivery
channel, deploy at least one rule) and `health.kind === "no-rules"`. A refused
listing is `unknown` at both, and its sentence says `NOT "no rules"` in as many
words.

### Sub-calls degrade independently

`DescribeConfigRules` and `DescribeComplianceByConfigRule` are separate IAM
actions and a role is routinely granted the first without the second. Every rule
carries its own `AwsRead` for its verdict, so a refused verdict names
`config:DescribeComplianceByConfigRule` in the pasteable minimum statement rather
than the listing action — an operator granting the action the denial names is
then no longer refused. The same holds across batches: one throttled batch of 25
does not collapse the other three. A denied tag index yields a fourth attribution
arm, `unknown`, so a rule whose tags were never read does not render as
"unattributable — missing tenure:tenant". A denied aggregator read touches
neither the rules nor the verdicts.

### Bounds, and the explicit "there were more"

`MAX_RULE_PAGES` (20), `MAX_RULES` (500), `MAX_COMPLIANCE_RULES` (250),
`MAX_COMPLIANCE_PAGES` (10) and `COMPLIANCE_BATCH_SIZE` (25, the API's own
limit). Hitting a listing bound produces `truncation.kind === "more-available"`
with the continuation token, or `nextToken: null` and the sentence "the rules
past the cap on the last page were dropped" when the cap cut a page short and AWS
gave no further token. Rules past the verdict cap carry an UNCONFIGURED verdict
saying the engine stopped — which is not the same as their passing.

### Region and partition

From the rule's own `ConfigRuleArn` where AWS returned one, else the resolved
identity, else null. No literal region and no `"aws"` partition fallback: a test
asserts that an unresolved identity with no ARN leaves both null and that the
whole rendered surface contains no `us-east-1`, and another asserts an
`aws-us-gov` ARN reads back as `aws-us-gov` / `us-gov-west-1`.

### Mutations applied to the PRODUCTION path, each red, each restored

Every mutation was made in `compliance.ts`, never in the test's stand-in, applied
from a pristine copy, run, and restored byte-for-byte (verified by comparing the
restored file against that copy after each run). Command in every case, from
`apps/web`: `npx jest ../system-studio/src/lib/aws/compliance.test.ts --ci`.
Baseline before and after: **35 passed, 35 total**.

| # | Mutation | Result |
| --- | --- | --- |
| C-1 | `verdictOf`'s fallback `: "UNSTATED"` became `: "COMPLIANT"` | **1 red** — a compliance object with no `ComplianceType` rendered as a pass |
| C-2 | `ruleHealthOf`'s `unreadable` arm replaced with `return { kind: "passing" }` | **3 red** — a DENIED, a THROTTLED and an over-cap verdict all rendered as compliant |
| C-3 | the `INSUFFICIENT_DATA` arm replaced with `return { kind: "passing" }` | **3 red** — a rule that has evaluated nothing rendered as a pass, and the estate read `compliant` |
| C-4 | the `ruleState === "DELETING"` precedence check was switched off with `false &&` | **1 red** — a rule being torn down reported its stale COMPLIANT |
| C-5 | `complianceHealth`'s EMPTY arm returned `{ kind: "compliant", passing: [], … }` | **3 red** — an account with no rules at all rendered compliant |
| C-6 | the non-ACTUAL listing branch replaced with `{ state: "ACTUAL", value: [], … }` | **4 red** — DENIED, THROTTLED and EMPTY all became an empty rule list |
| C-7 | `: identityResolved ? identity.value.region : null` became `: "us-east-1"` | **1 red** — the GE-010-007 residency shape |
| C-8 | `if (page === MAX_RULE_PAGES - 1)` became `if (false && …)` | **1 red** — a truncated listing reported `complete` |
| C-9 | `COMPLIANCE_BATCH_SIZE = 25` became `= 100` | **1 red** — batches of 100 names, which the real API rejects |
| C-10 | a failed batch's per-rule propagation replaced with a synthesised `COMPLIANT` reading | **2 red** — a refused verdict read rendered as a pass for every rule in the batch |
| C-11 | the tag-index guard in `attributionFor` became `if (false && …)` | **1 red** — a denied tag index reported every rule `unattributed` |
| C-12 | `enablementOf`'s `if (rules.state === "EMPTY")` became `if (false && …)` | **3 red** — "nothing is being evaluated" degraded to a generic unknown, losing the remedy |
| C-13 | `position < MAX_COMPLIANCE_RULES` became `position < Number.MAX_SAFE_INTEGER` | **1 red** — rules past the verdict cap stopped saying their verdict was not read |
| C-14 | `describeVerdict("NOT_APPLICABLE")` returned the COMPLIANT sentence | **1 red** — two verdicts rendered identically |
| C-15 | the `MAX_RULES` guard inside the page loop became `if (false && …)` | **1 red** — an over-cap page returned everything and reported `complete` |

Two of these — **C-9** and **C-14** — were GREEN on the first pass and are
recorded here because that is the finding. C-9 was green because the assertion
computed its expectation from the module's own `COMPLIANCE_BATCH_SIZE`, so
raising the constant raised the expectation with it; the fake's own limit check
had the same flaw. Both now compare against the literal 25, which is the API's
documented limit and not this module's to choose. C-14 was green because
`describeVerdict` is exported for a surface to call and three of its five arms
were only ever reached through `describeRuleHealth`, which prints the health
arm's `why` instead. A test now asserts all five sentences directly. Neither
mutation was reported as caught while it was not.

A final scan of both files for `false &&`, `&& false`, `|| true`, `MUTATION` and
`MAX_SAFE_INTEGER` returns nothing, and the production file is byte-identical to
its pre-mutation copy.

### Evidence

- `npx tsc --noEmit -p apps/system-studio/tsconfig.json` — no diagnostic in
  `compliance.ts` or `compliance.test.ts`. Four errors in another agent's
  `apps/system-studio/src/app/platform/cost/cost-decisions.test.ts` were present
  mid-flight and are not this entry's to claim or to fix.
- `npx jest ../system-studio/src/lib/aws/compliance.test.ts --ci` from `apps/web`
  — **Test Suites: 1 passed, Tests: 35 passed, 35 total**.
- The stand-in answers five capabilities in the shapes the SDK returns and fails
  each of them independently with `AccessDeniedException`, `ThrottlingException`,
  an empty-but-successful answer or a populated one. The four listing outcomes
  are asserted to render four DIFFERENT whole surfaces (`new Set(...).size === 4`),
  and so are the four verdict-read outcomes. Every identifier is the
  documentation placeholder account `123456789012`; nothing opens a socket.

### What is NOT closed, and is not claimed

- **The configuration recorder is not read.** `config:DescribeConfigurationRecorders`
  and `config:DescribeConfigurationRecorderStatus` are absent from
  `capabilities.ts` and from `client.ts`'s switch. Adding them is a registry
  change plus an `iam.tf` grant plus a `client.ts` arm, all of which are other
  agents' files. Until then the recorder renders UNKNOWN with those exact keys
  named. This is the one part of the requirement this entry does not deliver, and
  it is reported as an honest gap rather than inferred from the rule list.
- **No page imports this yet.** The module is the data layer; the surface that
  renders it is another agent's file. The exported renderers are what a surface
  is expected to print, so a denial cannot be worded as an absence on one surface
  and correctly on another.
- **Aggregators are read first-page-only.** `client.ts` constructs
  `DescribeConfigurationAggregatorsCommand({})` with no input, so there is no
  token to send. `AggregationReading` carries `firstPageOnly: true` and a `why`
  saying the count is a floor, rather than implying a total.
- **`GetComplianceDetailsByConfigRule` is not read.** WHICH resources are failing
  a rule is a different capability and this module does not invent one; the
  contributor count AWS returns with the verdict is what is shown, marked as a
  floor when `CapExceeded` is set.
- **Conformance packs are not read.** `DescribeConformancePackCompliance` is not
  in the registry. A pack's rules still appear individually in
  `DescribeConfigRules`, so nothing is hidden — the grouping is.
- **No existing type was widened**, so there is no consumer to re-check: every
  type in this work is new and lives in `compliance.ts`.
- **No capability, client case, IAM statement or page was touched.**
- **No approval, certification or sign-off is written anywhere.** This module
  reads verdicts AWS computed and renders them; it does not record that anybody
  reviewed anything.

## STUDIO-070-004 (CloudWatch dashboards) — the dashboard Terraform writes and nothing reads back

- [x] **STUDIO-070-004 — CloudWatch dashboards are read live, parsed, and turned
      into a coverage set.** `apps/system-studio/src/lib/aws/dashboards.ts`,
      through the `cloudwatch:ListDashboards` and `cloudwatch:GetDashboard`
      capabilities that already existed in `capabilities.ts`. Status: `PASS` for
      the read plane; the live account is `BLOCKED_EXTERNAL` on the same
      dependency as every other row in this ledger (there is no AWS Organization
      to read).
  - Status: PASS
  - Evidence: `npm run test --workspace apps/web -- --ci lib.aws.dashboards` ->
    37 passed, 37 total, 1 suite. Production module
    `apps/system-studio/src/lib/aws/dashboards.ts`, consumed by
    `apps/system-studio/src/app/platform/health/page.tsx`.

`infrastructure/terraform/cloudwatch.tf:74` provisions `${name_prefix}-ops` with
four widgets — ECS `RunningTaskCount`, ALB `RequestCount` + `HTTPCode_Target_5XX_Count`,
RDS `CPUUtilization`, and a Logs Insights query over the app log group — and
until now nothing in the engine opened it. Two questions were therefore
unanswerable: whether the dashboard still points at services that exist, and
which of the estate's services are on NO dashboard. The second is a set
difference, so the body is parsed down to the metric namespaces, alarm names and
log groups each widget references and returned as data.

### The decisions worth reviewing

- **A malformed body is a state, not a crash.** `DashboardBody` is JSON in a
  string and nothing validates it after `PutDashboard` accepts it.
  `DashboardContent` has four arms — `watching`, `watching-nothing`, `malformed`,
  `not-read` — and the reference sets live ONLY on the `watching` arm, so a
  caller cannot read `[]` namespaces off a dashboard whose body was refused.
- **Each `GetDashboard` is its own read.** A policy that grants the list and
  scopes the get leaves every other row intact; the refused row keeps its name,
  ARN and last-modified and says in words that its coverage is unknown. The load
  stays `ACTUAL`.
- **`coverage` refuses to be a set when it is not one.** `complete` / `partial` /
  `not-read`. A set difference against an incomplete set reports a service as
  unwatched when it is merely on a dashboard nobody could open, so
  `unwatchedNamespaces` returns `undecidable` and names its shortlist
  differently from a finding.
- **Metric math is resolved only where it is unambiguous.** An expression over
  ids declared in the same widget names no new namespace (`arithmetic`); a
  `SEARCH('{AWS/ECS,…}', …)` names its namespace in the query literal
  (`search`); anything else — a dynamically built SEARCH, an `explorer` widget
  naming resource types, a `custom` widget rendered by a Lambda — is
  `unresolved` and drops coverage to `partial`.
- **The console's `.` and `...` shorthand is resolved against the previous
  entry.** A literal reader reports a metric in the namespace `"."`, which is not
  a namespace; with nothing to stand for, the entry becomes a named problem
  rather than an invented namespace.
- **Bounds:** `MAX_LIST_PAGES` 20, `MAX_DASHBOARDS_READ` 100 bodies,
  `MAX_WIDGETS_PER_DASHBOARD` 500 (CloudWatch's own documented maximum),
  `MAX_BODY_CHARS` 500,000. Every one of them produces an explicit
  `more-available` / `unresolved` signal rather than a silent prefix.
- **Region and partition come from the resolved identity.** No literal region in
  the file. Widgets carry their OWN region when they name one, so a
  cross-region widget is visible instead of being read as local.
- **Attribution deviates from "shared where no tag says so", deliberately.** As
  in `metrics.ts`, a dashboard whose tag index could not be read is `unknown`,
  not `shared` — folding an unread index into `shared` renders a denial as a
  decision. `shared` remains reserved for the tag value somebody set.

### Evidence

`npm run test --workspace apps/web -- --ci src/lib/aws/dashboards.test.ts` —
**37 passed, 37 total**, 1 suite. `npx tsc --noEmit -p apps/system-studio/tsconfig.json`
reports no error in either file.

The stand-in answers four capabilities with the SDK's real shapes
(`{DashboardEntries:[{DashboardName, DashboardArn, LastModified, Size}], NextToken}`,
`{DashboardName, DashboardArn, DashboardBody}` where the body is a STRING,
`{ResourceTagMappingList:[…]}`, `{Account, Arn}`) and fails each independently
with `AccessDeniedException`, `ThrottlingException`, an empty-but-successful
list, or a populated one — including failing `GetDashboard` for ONE named
dashboard while answering for another. One test asserts the four listing
outcomes render as four PAIRWISE DISTINCT strings, which a stand-in returning
`[]` regardless would fail. The dashboard-body fixture is the body
`cloudwatch.tf` actually renders. No account id, ARN or principal in the suite is
real: `123456789012` is AWS's documentation placeholder.

### Mutations applied to the PRODUCTION path, each red, each restored

Nine, each applied to `dashboards.ts` (never to the fake), run, confirmed red,
reverted, confirmed green.

| # | Mutation | Result |
|---|---|---|
| 1 | denied `GetDashboard` row → `kind: "watching-nothing"` | 3 failed, 34 passed |
| 2 | `if (!token) break` → unconditional `break` in the listing loop | 2 failed, 35 passed |
| 3 | `if (reasons.length === 0)` → `>= 0` in `coverageOf` (coverage always complete) | 6 failed, 31 passed |
| 4 | unresolved identity region → `"us-east-1"` | 1 failed, 36 passed |
| 5 | `"."` shorthand pushes the literal token instead of the previous value | 1 failed, 36 passed |
| 6 | `JSON.parse` catch returns `watching-nothing` instead of `malformed` | 1 failed, 36 passed |
| 7 | `parseAlarmArn` invents `parts[parts.length - 1]` as the name | 1 failed, 36 passed |
| 8 | `inBudget = position < MAX_DASHBOARDS_READ \|\| true` (bound removed) | 1 failed, 36 passed |
| 9 | unread tag index attributes `shared` instead of `unknown` | 1 failed, 36 passed |

Final state after every revert: **37 passed, 37 total.**

### What is NOT closed, and is not claimed

- **Nothing was read from a real AWS account.** Whether the live
  `<prefix>-ops` dashboard still points at the ECS service that exists is exactly
  the question this module was built to answer, and it has not been asked of a
  real account. `BLOCKED_EXTERNAL` on the AWS Organization.
- **No page renders this yet.** The production entry point is
  `dashboardReadings()`, which resolves `liveGateway()` → `client.ts` → the SDK
  when called with no gateway. A surface agent owns the rendering; this file may
  not edit a page and does not claim one.
- **The intersection itself is not computed here.** `unwatchedNamespaces` answers
  the dashboard half; joining it to alarms and to the inventory belongs to a
  surface that holds all three. The alarm side is `alarms.ts`, which returns
  alarm NAMES and no namespace, so "in no alarm" is a name join, not a namespace
  join.
- **`explorer` and `custom` widgets are not decoded.** An explorer widget names
  resource TYPES and a custom widget is rendered by a Lambda; both are reported
  `unresolved` and reduce coverage rather than being guessed at.
- **No capability, client case, IAM statement or page was touched**, and no
  approval, review or sign-off is written anywhere.

## STUDIO-070-004 (PRICING) — the priced catalogue stops being a transcribed table

- [x] **STUDIO-070-004 (AWS Price List adapter)** — Read the on-demand list price
  of the resource shapes this estate provisions — Fargate vCPU- and GB-hours, an
  RDS instance-hour for a stated class and engine, ElastiCache node-hours, ALB
  hours and LCUs, CloudFront request and data-transfer tiers, S3 storage and
  request tiers, DynamoDB on-demand read and write request units, an SES outbound
  message and an SQS request — as integer minor units with an explicit currency,
  so the composer's per-seat and per-organisation figures are grounded rather
  than transcribed.
  - Status: PASS
  - Evidence: `npm run test --workspace apps/web -- --ci lib.aws.pricing` -> 42 passed,
    42 total, 1 suite. Production module
    `apps/system-studio/src/lib/aws/pricing.ts`, consumed by
    `apps/system-studio/src/app/tenants/new/page.tsx`.

- **Was**: `pricing:GetProducts` and `pricing:ListPriceLists` were in
  `capabilities.ts` and dispatched in `client.ts`, and **nothing called either**.
  The only prices in the product were `@tenure/finops`'s `pricing.ts`, a
  hand-maintained catalogue of `perSeatMinor` / `perOrgMinor` figures — right on
  the day it was typed and wrong from the next AWS price change onwards, with
  nothing in the product able to tell which day it was. `ce:GetCostAndUsage
  WithResources` cannot answer this question: Cost Explorer reports what was
  SPENT, and a composer needs what a change WOULD cost.
- **Now**: `apps/system-studio/src/lib/aws/pricing.ts`. `pricingReadings()`
  resolves identity, builds each shape's query from a closed `SHAPES` catalogue,
  pages `pricing:GetProducts` under a bound, parses each `PriceList` JSON
  document, and returns a `ShapeReading` per shape carrying its own
  `AwsRead<readonly PricedProduct[]>`, its own `ShapeRate`, its own `truncated`
  flag, the registry's own `refreshMs` and an explicit `asOf`.
  `priceListPublications()` is the second capability, read separately.
  `pricingLines()` is the one renderer a surface prints.

### Money is integer minor units. There is no float on this path.

The Price List publishes `pricePerUnit` as a decimal STRING, and
`Number("0.0000166667")` is the bug. `parseRate` shifts the decimal point with
BigInt digit arithmetic and hands `@tenure/finops`'s `money()` an integer; the
currency is read off the response and never defaulted to USD, because the China
partition publishes CNY and a quote that adds dollars to yuan is wrong in a way
that looks right.

It deliberately does **not** use `@tenure/finops`'s `fromDecimal`, which is
documented to TRUNCATE below its scale. That is correct for an
already-authoritative CUR line and catastrophic for a unit price: DynamoDB's
on-demand write unit is `0.000000125` USD, which is finer than `Money` holds
exactly, and truncating it renders a real price as free. `parseRate` scales the
QUANTITY instead — `0.00000125 per 10 WriteRequestUnits`, exact, with
`perQuantity` a required field on `Rate` so a caller that ignores it is wrong by
a power of ten rather than silently. A price finer than the engine will scale is
reported unknown, never rounded. `extendRate` exists so no surface writes
`price * hours` in doubles: `0.009 * 730` is `6.569999999999999`, and the test
asserts that trap verbatim.

### A price this engine could not fetch has no amount, at the type level

`ShapeRate` has four arms and only `flat` and `tiered` carry money. `unknown`
and `ambiguous` have no amount field at all, so a surface cannot substitute
zero for a denied, throttled, truncated, unmatched or ambiguous read — the same
mechanism `AwsRead` uses one level up, for the same reason. `Rate.free` is a
separate boolean that is true only when AWS itself published zero, so "AWS gives
this away" and "we could not read it" are never the same rendering.

### Two failures that are NOT the same, kept apart

A denied `pricing:GetProducts` is DENIED with the principal, the action and a
pasteable minimum statement. A filter that matched nothing is EMPTY. A page cap
hit is `truncated` with the rate withheld, because a rate chosen out of a partial
list is a coin flip between SKUs. An unset `AWS_GLOBAL_ENDPOINT_REGION` is
UNCONFIGURED — the Price List API is not served from every region, and
`client.ts` throws `EndpointRegionUnset` rather than guessing one.

### The region is resolved, and the two kinds of shape degrade apart

`regionCode` is a real Price List filter field, so a region-scoped shape is
priced at the region `sts:GetCallerIdentity` resolved and never at a literal —
there is no region string in this module at all. When identity is unresolved a
region-scoped shape is UNCONFIGURED and the call is not made, while CloudFront,
which prices by edge geography rather than by region, still answers in the same
load. One denied detail does not collapse the row.

### Attribution: stated deviation

Prices are NOT read through the Resource Groups Tagging API. A published list
price is not a provisioned resource — no ARN, no `tenure:tenant` tag, and
`tag:GetResources` would never return one — and it is the same figure for every
tenant. Every reading is attributed `shared` using `tags.ts`'s own `Attribution`
vocabulary, with the reason exported as `PRICE_ATTRIBUTION_WHY`. What is
per-tenant is CONSUMPTION, which is `cost-report.ts`'s reading.

### Quoting only

The only import from `@tenure/finops` is its money arithmetic. Nothing here
imports or re-exports settlement, a payments gateway or a ledger write, and no
capability in this module's path can create, update, put, send or invoke
anything.

### What is NOT closed, and is not claimed

- **Nothing was read from a real AWS account.** Every assertion is against a
  stand-in client. `BLOCKED_EXTERNAL` on the same dependency as the rest of this
  ledger.
- **The service codes, product families and usage-type fragments in `SHAPES`
  are unvalidated against a live price list.** They are the Price List API's
  published vocabulary and any one of them may be wrong. The design makes that
  survivable rather than dangerous: a wrong filter returns EMPTY and the rate is
  `unknown`, naming both the fragments searched and the usage types actually
  seen, so the correction is visible from the page. No path produces a wrong
  NUMBER from a wrong filter.
- **Reserved and Savings Plan terms are never read.** Only the `OnDemand` term is
  parsed. A committed rate is a purchase this estate has not made, and quoting
  one would be a price nobody can buy today. A fixture publishes a reserved rate
  and a test asserts it is not the one quoted.
- **No approval, certification, sign-off or effective date is invented.** The
  `effectiveDate` and `publicationDate` on every reading are AWS's own, carried
  through, and are kept distinct from this engine's `asOf` for the read.
- **`docs/architecture/ownership.md` is stale by exactly one file** because this
  module is new. Regenerating it belongs to one `npm run generate` against a
  clean tree, not to concurrent writers.

## STUDIO-070-004 (CONTAINERS) — ECS at task granularity, and why `runningCount` is 1 when `desiredCount` is 2

- [x] `apps/system-studio/src/lib/aws/containers.ts` — the ECS reader that starts
      where `inventory.ts` stops.
- [x] `apps/system-studio/src/lib/aws/containers.test.ts` — 59 cases, four
      outcomes per capability, eight mutation proofs on the production path.

### Why this one mattered

`inventory.ts` reads `ecs:ListClusters` → `ecs:ListServices` →
`ecs:DescribeServices` and stops. That produces one string per service —
`ACTIVE 1/2` — and every ECS incident in this estate has so far come to die in
it. It states that a task is missing; it cannot state why, and "why" is the whole
of the incident:

- `OutOfMemoryError: Container killed due to memory usage` — the revision asks
  for less memory than the process needs. Until somebody ships a new one the
  replacement task dies too.
- `Task failed ELB health checks in (target-group …)` — the container came up and
  the load balancer refused it. The remedy is the health-check path, the grace
  period or the application, and emphatically not more memory.
- `Scaling activity initiated by (deployment ecs-svc/…)` — nothing is wrong.

Three different nights, one string. `stoppedReason` is now read, classified into
ten causes, and grouped into incidents that explain a service's gap.

### What it reads, and through which capability

| Capability | What it answers |
| --- | --- |
| `ecs:ListClusters` | which clusters exist. ONE page — see the deviation below |
| `ecs:DescribeClusters` | capacity providers, registered container instances, running/pending totals, statistics, settings |
| `ecs:ListServices` | the service ARNs in a cluster |
| `ecs:DescribeServices` | desired/running/pending counts, launch type, target groups, deployments and their `rolloutState` |
| `ecs:ListTasks` | task ARNs, RUNNING and STOPPED read separately |
| `ecs:DescribeTasks` | `lastStatus`, `healthStatus`, `stopCode`, `stoppedReason`, per-container `exitCode` and `imageDigest` |
| `ecs:DescribeTaskDefinition` | the revision each service actually runs: image, cpu, memory, network mode, log configuration, `secrets` vs plain-text `environment` |

Every capability was already in the registry when this work started. Nothing here
added one, and no IAM action was requested.

### Seven capabilities, seven readings, degrading independently

A cluster ROW is built from the ARN that `ListClusters` already returned, and
everything below it is its own `AwsRead`: `detail`, `services`, `runningTasks`,
`stoppedTasks`, and per service a `taskDefinition`. The listing and the describe
are separate readings for services and for tasks as well, so a refused
`ecs:ListServices` renders a minimum statement naming `ecs:ListServices` — not
`ecs:DescribeServices`, which was never reached. `retained.ts` paid for that
lesson once with `backup:ListBackupVaults`; this module does not repeat it.

A cluster whose capacity providers were refused still shows its services. A
service whose revision was refused still shows its counts and the reason a task
stopped. None of them renders as a reassuring default.

### The gap, and the three things it is not

`CountGap` has four arms and they are not interchangeable:

- `none` — running is at or above desired.
- `explained` — missing tasks, and stopped tasks in the window grouped by cause.
- `unexplained` — missing tasks and NOTHING stopped. That is a real and alarming
  answer: the scheduler is not placing them, which is capacity or a subnet, not a
  crash.
- `unknown` — the task read did not happen. No claim either way.

Collapsing `unknown` into `unexplained` would send an operator to look at subnets
because of an IAM denial. A test asserts the two render as different text, and
mutation M2 proves the test catches it.

### An environment variable's NAME is a finding. Its VALUE is never read.

The value is not redacted — there is no property anywhere in this module's types
that can hold one, so no surface, serialiser or future edit can print it. Same
mechanism as `AwsRead`'s missing `value` on DENIED: the discipline is in the type.

The name test is a substring match on KEY, SECRET, TOKEN, PASSWORD, PASSWD and
CREDENTIAL, and it over-reports on purpose — `MONKEY_MODE` contains "KEY" and is
listed. A name wrongly listed discloses nothing; a credential wrongly missed is
the defect. A test asserts the over-report is deliberate rather than accidental.

`logConfiguration.options` values are carried only for an allowlist of
`awslogs-*` keys. The `splunk` driver's `splunk-token` contributes its NAME and
nothing else, and a test asserts the token value appears nowhere in the reading.

### A deviation, stated: `ecs:ListClusters` reads exactly one page

`client.ts` builds `ListClustersCommand({})` with no `nextToken` passthrough, and
`client.ts` is another agent's file. A second page cannot be requested from here.
When the first page returns a `nextToken` the reading is marked `truncated` with
a `why` naming the reason, and `containerLines` prints it. What does NOT happen
is a first page passed off as the estate. Fixing this properly needs one line in
`client.ts`'s `ecs:ListClusters` case; it is not claimed as done.

### Bounds, and the signal when one is hit

`MAX_SERVICE_PAGES` 10, `MAX_TASK_PAGES` 10, `MAX_CLUSTER_DEPTH_READS` 20,
`MAX_TASK_DEFINITION_READS` 40, `DESCRIBE_SERVICES_BATCH` 10 (the API's ceiling —
eleven is a validation error), `DESCRIBE_TASKS_BATCH` 100, `DESCRIBE_CLUSTERS_BATCH`
100. Every bound that is hit travels as a `Truncation` value or as an
UNCONFIGURED reading whose `why` says the engine stopped — never as an empty
list. Clusters past the depth cap keep their row and say they were not read.

### Evidence

```
$ npx tsc --noEmit -p apps/system-studio/tsconfig.json   # filtered to this module
(no errors in aws/containers.ts or aws/containers.test.ts)

$ cd apps/web && npx jest ../system-studio/src/lib/aws/containers.test.ts
Test Suites: 1 passed, 1 total
Tests:       59 passed, 59 total

$ node tests/security/operator-plane-content.test.mjs
# pass 5  # fail 0
```

The whole `src/lib/aws` suite was also run: 29 of 32 suites pass; `dns.test.ts`,
`logs.test.ts` and `waf.test.ts` fail, and those three are other agents' files
mid-flight, not this module's. `containers.test.ts` passes inside that run.

### Mutations applied to the PRODUCTION path, each red, each restored

| # | Mutation | Mutated | Restored |
| --- | --- | --- | --- |
| M1 | deleted the out-of-memory rule from the ordered stop-reason classifier | `Tests: 4 failed, 55 passed` | `Tests: 59 passed` |
| M2 | reported a REFUSED stopped-task read as `unexplained` instead of `unknown` | `Tests: 1 failed, 58 passed` | `Tests: 59 passed` |
| M3 | dropped the `ListClusters` truncation signal, returning the first page as the estate | `Tests: 1 failed, 58 passed` | `Tests: 59 passed` |
| M4 | stopped flagging credential-shaped plain-text environment names | `Tests: 1 failed, 58 passed` | `Tests: 59 passed` |
| M5 | collapsed a refused `ecs:DescribeClusters` into a reassuring zero-capacity default | `Tests: 1 failed, 58 passed` | `Tests: 59 passed` |
| M6 | turned a DENIED `ecs:ListClusters` into an empty cluster list | `Tests: 4 failed, 55 passed` | `Tests: 59 passed` |
| M7 | attributed a resource as `unattributed` when the tag index itself was refused | `Tests: 1 failed, 58 passed` | `Tests: 59 passed` |
| M8 | let the fleet report `steady` even when sub-reads did not answer | `Tests: 1 failed, 58 passed` | `Tests: 59 passed` |

Every mutation was restored immediately and the restored run was re-executed and
re-recorded, not assumed. A `diff` against the pre-mutation baseline reports the
file identical. A final scan for `false &&`, `&& false`, `|| true`, `MUTATION`,
`TODO`, `FIXME` and `placeholder` over both files returns nothing. No check was
left disabled.

### What is NOT closed, and is not claimed

- **`ecs:ListClusters` reads one page.** See the deviation above. Not fixable
  from this module: `client.ts` owns the command input and is another agent's
  file.
- **No page imports this yet.** The production entry point is
  `containerReadings()`, which resolves `liveGateway()` when called with no
  argument; the route that renders `containerLines()` is a surface agent's file,
  and until that lands nothing in the running product calls it.
- **`stoppedReason` only sees ECS's retention window,** approximately one hour.
  `ECS_STOPPED_WINDOW` travels on every cluster so a surface cannot print "no
  stopped tasks" as a statement about yesterday. The long-horizon answer is
  CloudTrail and the service event stream, neither of which this reader holds.
- **Service EVENTS are not read.** `DescribeServices` returns an `events` array
  whose messages are often the clearest statement of a placement failure. It is
  not carried yet; the deployments and their `rolloutStateReason` are.
- **Container Insights metrics are not read.** Per-task CPU and memory
  utilisation live in CloudWatch and belong to `metrics.ts`, not here. The module
  reports that a container was killed for memory; it does not report how close to
  its limit a living container is running.
- **Nothing here decides whether a service is unmanaged or has drifted from
  Terraform.** That is `drift.ts`'s question.
- **Nothing here was verified against a live AWS account.** Every case runs
  against a stand-in gateway. No credentials were used, no AWS call was made, and
  no account id, ARN, cluster, service or region in the tests or this entry is a
  real Tenure resource — the account throughout is the obviously-constructed
  `123456789012`. No approval, review, certification or verification date is
  recorded anywhere in this work.
- **`docs/architecture/ownership.md` is stale by exactly two files** because this
  module is new. Regenerating it belongs to one `npm run generate` against a
  clean tree after this batch lands, not to concurrent writers.

## STUDIO-070-004 (WAFv2) — is anything actually in front of the front door

- [x] **STUDIO-070-004 (WAFv2 adapter)** — Read the web ACLs in both WAFv2
  scopes, and read per RESOURCE rather than per account: which load balancer and
  which distribution has a web ACL in front of it, and which is taking requests
  directly. `apps/system-studio/src/lib/aws/waf.ts`.

- **Was**: `wafv2:ListWebACLs` and `wafv2:GetWebACLForResource` were in
  `capabilities.ts`, dispatched in `client.ts` with two clients (one regional,
  one at the partition's global endpoint for the CLOUDFRONT scope), and
  **nothing called either**. The console could not distinguish "a web ACL is
  attached", "no web ACL exists in this account" and "this role may not call
  `wafv2:ListWebACLs`". All three rendered as nothing at all.
- **Now**: `wafReadings()` resolves identity, reads the tag index, reads BOTH
  scopes as two independent `AwsRead<WebAclListing>`, enumerates the load
  balancers and distributions, and returns one `ResourceProtection` row per
  resource, each carrying its own `AwsRead<Association>`. `wafCoverage()` is the
  headline verdict and `wafLines()` is the one renderer a surface prints.
- Status: **PASS** for both scopes, the per-resource association, the coverage
  verdict and the rendering. The rules of a web ACL that is attached to nothing
  are **FAIL**, recorded as its own entry below.
- Evidence: `npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/waf.test.ts`
  — **29 passed, 29 total**; 7 mutations applied to the production path, each
  red, each restored (table below); `npx tsc --noEmit -p apps/system-studio/tsconfig.json`
  reports no error in `apps/system-studio/src/lib/aws/waf.ts` or `waf.test.ts`.

### The expected answer in this estate is "there is no web ACL", and it is a finding

`ListWebACLs` against an account with no WAF SUCCEEDS and returns an empty list.
That is `EMPTY`, not `DENIED`, and the two are different arms of `AwsRead<T>` —
the denied arm has no `value` field to read an empty list out of. But an empty
grid would read as "nothing is wrong" while describing an estate with no web
application firewall, so `WafCoverage` lifts the successful-empty into
`no-web-acl-exists`, which names every internet-reachable resource that is
therefore unprotected and carries `WAF_REMEDY` — the `aws_wafv2_web_acl`,
`aws_wafv2_web_acl_association` and CloudFront `web_acl_id` that would change
it. It is a statement of what is missing. It is not an approval, a sign-off or a
claim that anybody reviewed anything.

### Two scopes, and neither is allowed to answer for the other

`REGIONAL` is served from the estate's own region and `CLOUDFRONT` only from the
partition's global endpoint. Asking the regional client for the edge catalogue
returns an EMPTY list, which is the worst possible failure here because it reads
as "the CDN has no WAF". Both scopes are asked for by name (a test records the
`Scope` of every call and asserts both were sent), each carries its own state,
and `no-web-acl-exists` is unreachable unless BOTH answered successfully. A
denied CLOUDFRONT scope, or an unset `AWS_GLOBAL_ENDPOINT_REGION` — which
`client.ts` raises as `EndpointRegionUnset` and `readAws` maps to UNCONFIGURED —
makes the verdict `unknown`, with the scope named in the sentence.

### Per resource, and one denial does not collapse a neighbour

Every application load balancer gets its own `wafv2:GetWebACLForResource`, so a
refusal on one ALB renders as a refusal on that row with its own pasteable
minimum statement, and the ALB beside it still reads. A distribution's
protection comes from the `WebACLId` that `cloudfront:ListDistributions` already
returns, because `GetWebACLForResource` does not accept a distribution ARN — its
protected-resource types are load balancers, API Gateway stages, AppSync APIs,
Cognito user pools, App Runner services and Verified Access instances. A network
or gateway load balancer is UNCONFIGURED with the reason and is never called:
"WAF cannot attach to this" is not "WAF is not attached to this".

### Three things this module refuses to confuse

- **WAF Classic is not WAFv2.** A distribution whose `WebACLId` is a
  36-character Classic id is `waf-classic`, not unprotected — Classic is read
  through `waf:` and `waf-regional:` actions this engine holds no capability for.
- **Count mode is not protection.** Every rule carries `blocking`, false for
  `Count`, for a rule group overridden to `Count`, and for an action this engine
  could not parse. An estate whose every attached ACL blocks nothing is
  `monitoring-only`, not `protected`.
- **"Attached" is not "blocking".** The `protected` arm carries
  `blockingConfirmed` and `detailUnread` separately, so a distribution whose ACL
  was named but never read is not counted as a rule set somebody checked.

### Bounds, and the explicit "there were more"

`MAX_WEB_ACL_PAGES` (20 pages of 100), `MAX_TARGET_PAGES` (20) and
`MAX_ASSOCIATION_READS` (100, batched 8 at a time). A capped web-ACL listing
returns `truncation.kind === "capped"` INSIDE the value — so a caller cannot
render the list without holding the truncation — and is never EMPTY, even when
it read nothing: a bound hit on page one is not evidence that a scope is empty,
and `listingComplete()` gates the `no-web-acl-exists` verdict on it. The load
balancer and distribution listings throw instead, because a truncated list of
front doors would silently omit an unprotected one. Resources past the
association cap carry an UNCONFIGURED association saying the engine stopped
looking.

### Region, partition and attribution

Region and partition come from the resolved identity and from the ARNs AWS
returned — the edge scope's region is read off the ACL ARNs themselves, which is
where those ACLs demonstrably are. There is no literal region and no `"aws"`
partition fallback in the file; a test builds an `aws-us-gov` ACL ARN and asserts
it reads back as `aws-us-gov`. Attribution is the Resource Groups Tagging API
through `tags.ts`, with the same fourth arm `sqs.ts` documents: a tag index that
was DENIED renders "attribution unknown", never "unattributable — missing
tenure:tenant", which would send an operator to add a tag that is probably
already there.

### Mutations applied to the PRODUCTION path, each red, each restored

Every mutation was made in `waf.ts`, never in the test's stand-in, and restored
before the next one. Command in every case, from the repository root:
`npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/waf.test.ts`.
Baseline before and after: **29 passed, 29 total**.

| # | Mutation | Result |
| --- | --- | --- |
| W-1 | `listWebAcls`'s `isEmpty` lost its `&& listing.truncation.kind === "complete"` clause | **1 red** — a capped listing that read nothing rendered as "this scope is empty" |
| W-2 | `wafCoverage`'s unread-scope guard became `if (false && (...))` | **2 red** — a DENIED and an UNCONFIGURED CLOUDFRONT scope both produced a confident account-wide verdict |
| W-3 | the not-applicable check became `if (false && target.kind !== "application-load-balancer")` | **1 red** — a network load balancer was called, answered empty, and rendered as unprotected |
| W-4 | `actionBlocks`'s `case "count"` moved from the `return false` group to `return true` | **2 red** — a web ACL entirely in Count mode reported as protection |
| W-5 | `arnPartition` replaced with `return arn.length > 0 ? "aws" : null` | **1 red** — an `aws-us-gov` web ACL reported as commercial; the GE-010-007 shape |
| W-6 | `RETRY.attempts` became `1` | **1 red** — `retryAfterMs` 200 instead of throttle.ts's 800; the schedule was no longer the shared one |
| W-7 | `describeProtection`'s EMPTY branch widened to also catch `DENIED` | **1 red** — a refused association rendered as "NO WEB ACL ... requests reach it unfiltered" |

Two of the three failures on the first full run were real defects in the
production path, fixed rather than asserted around: a denied scope rendered
without saying WHICH scope (both scopes are the same capability, and
`describeRead` renders a denial from the capability alone), and a capped listing
with nothing read reached the `no-web-acl-exists` verdict. No guard was left
disabled: a sweep for `false &&`, `|| true` and `attempts: 1` in `waf.ts` after
the last restore returns nothing.

### What is NOT closed, and is not claimed

- [ ] **STUDIO-070-004 (WAFv2 rules of an unattached web ACL)** — the default
  action, rules and rule-group references of a web ACL that is not associated
  with a readable resource.
- Status: **FAIL**. `wafv2:ListWebACLs` returns summaries only — `Name`, `Id`,
  `Description`, `ARN`, `LockToken`. The full `WebACL` object comes from
  `wafv2:GetWebACL`, and that capability is not in `capabilities.ts`; a service
  agent does not add one. The exact key needed is `"wafv2:GetWebACL"` with IAM
  action `wafv2:GetWebACL` on resource `*` (it authorises on the web ACL and on
  every rule group it references), dispatched in `client.ts` with the same
  two-client REGIONAL/CLOUDFRONT split `wafv2:ListWebACLs` already has, taking
  `Name`, `Id` and `Scope`. Until then `WebAclDetail` is the `not-readable` arm
  naming that action — a value a surface must render, not a field it can forget.
  Rules ARE read wherever `GetWebACLForResource` supplies them, which is every
  ACL actually associated with a load balancer.
- **Nothing was read from a real AWS account.** Every assertion is against a
  stand-in client. Whether this estate's ALB has a web ACL in front of it is
  exactly the question this module exists to answer and it has not been asked of
  a real account, on the same dependency as the rest of this ledger. No account
  id, ARN, region, distribution id or web ACL id in the suite is real:
  `123456789012` is AWS's documentation placeholder and every other identifier
  is obviously constructed.
- **Logging, sampled requests and rate-based counters are not read.**
  `wafv2:GetLoggingConfiguration`, `GetSampledRequests` and
  `GetRateBasedStatementManagedKeys` are not in the registry. Whether a web
  ACL's requests are being logged is therefore NOT part of this answer, and no
  arm of `WafCoverage` implies it is.
- **`ListResourcesForWebACL` is not held either**, so "this ACL exists and
  protects nothing" is derived from the per-resource reads this console could
  make, not from the ACL's own association list.
- **The surface is not rendered.** `wafLines()` is the contract a surface agent
  consumes; no page in this repository calls it yet.
- **`docs/architecture/ownership.md` is stale by two more files** because this
  module is new. Regenerating it belongs to one `npm run generate` against a
  clean tree after this batch lands, not to concurrent writers.


## STUDIO-080-002 (DNS) — where a tenant host resolves, and whether the thing it resolves to still exists

**Status: PASS for its stated scope** — the data layer. No page imports it yet;
the surface is another agent's file.

`apps/system-studio/src/lib/aws/dns.ts` + `dns.test.ts`. Nothing in the running
product had ever issued a Route 53 call: Terraform provisions the zone and the
console could not answer "does this tenant's hostname point at our distribution",
which for a path-based estate is one apex record away from every tenant at once.

### What it reads, through which capability

| Capability (already in the registry) | What it answers |
| --- | --- |
| `route53:ListHostedZones` | which zones exist, public or private, and their record counts |
| `route53:ListResourceRecordSets` | per zone: name, type, TTL, values, alias target and set identifier |
| `cloudfront:ListDistributions` | the ownership index an alias target is matched against |
| `elasticloadbalancing:DescribeLoadBalancers` | the second ownership index, for ELB alias targets |
| `tag:GetResources` (via `tags.ts`) | which tenant a zone is tagged to |
| `sts:GetCallerIdentity` (via `identity.ts`) | the partition every zone ARN is built from |

No capability was added and none was needed. The module calls exactly those six
and a test asserts the set.

### The three facts it refuses to fold together

1. **owned** — the alias or CNAME target is a distribution domain or load
   balancer DNS name this account returned.
2. **dangling** — the index ANSWERED and the target is not in it. That is a
   subdomain takeover: the name is re-registrable and the record keeps sending
   this estate's users at it.
3. **unverifiable** — the index was refused, throttled, broken or incomplete, or
   no capability this engine holds can enumerate that kind of target (S3 website
   endpoints, API Gateway).

`dangling` is reachable only from an index whose state was ACTUAL, STALE or
EMPTY **and** whose pagination was `complete`. A denial rendered as `dangling` is
a false alarm that costs an afternoon; a denial rendered as `owned` is how a
subdomain gets taken. Both are unreachable by construction, and M-D1 / M-D13
below prove the guards are live.

### Pagination this engine cannot complete, stated rather than hidden

`ListResourceRecordSets` pages on `StartRecordName`, `StartRecordType` and
`StartRecordIdentifier`. `client.ts` forwards only the first, and `client.ts` is
not this agent's file. So records are deduplicated on name + type + set
identifier, and a page that adds nothing new is reported as `Pagination.stalled`
naming the parameter that would move it. `truncated` is the separate page-cap
arm. Nothing may claim an absence from either: `hostVerdict` returns `unknown`
rather than `no-record`, and `takeoverState` names the zone in `unverified`
rather than counting it clear.

Bounds: `MAX_ZONE_PAGES` 20, `MAX_RECORD_PAGES` 20 per zone,
`MAX_ZONE_RECORD_READS` 50 zones per load (zones past it carry UNCONFIGURED, not
"no records"), `ZONE_CONCURRENCY` 4.

### The registrar, said plainly

The apex NS set is Route 53's own delegation set and is reported. Whether the
REGISTRAR delegates to it is **outside this account's visibility**:
`route53domains:GetDomainDetail` is not in the registry, and even with it AWS
answers only for domains registered through Route 53 Domains in this same
account. `REGISTRAR_NOT_READABLE` is a value a surface must render, not a field
it can forget. No approval, verification or sign-off is asserted anywhere in this
module.

### Evidence

```
npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/dns.test.ts
Tests: 33 passed, 33 total
npx tsc --noEmit -p apps/system-studio/tsconfig.json   # no error in dns.ts or dns.test.ts
node --test tests/architecture/forbidden-clients.test.mjs   # 6 pass
node --test tests/security/operator-plane-content.test.mjs  # 5 pass
```

Four outcomes are proven distinct against a stand-in that pages for real:
AccessDenied → DENIED carrying `route53:ListHostedZones`, the principal, the
account, the region, the partition and a pasteable statement, with no `value`
field at all; ThrottlingException → THROTTLED with `retryAfterMs` 800, which is
`throttle.ts`'s schedule and not a number retyped here; an empty-but-successful
list → EMPTY rendering "none"; a populated list → ACTUAL. The four render as four
byte-different surfaces and a test asserts the set has four members.

### Mutations applied to the PRODUCTION path, each red, each restored

Each was applied to `dns.ts` from a byte-identical pristine copy, run, then
restored and the restore verified by md5 (`4af1e55efbc708f3f5f80ba7f2d5ac7c`).

| # | Mutation | Result |
| --- | --- | --- |
| M-D1 | `if (false && !answered(indexes.distributions))` — the CloudFront-index guard switched off | RED, 2 failed |
| M-D2 | `isConclusive` returns `true || …` | RED, 4 failed |
| M-D3 | the record page loop breaks after page one whatever `IsTruncated` says | RED, 4 failed |
| M-D4 | an unreadable tag index attributes as `unattributed` instead of `unknown` | RED, 1 failed |
| M-D5 | `normaliseDnsName` stops decoding Route 53 octal escapes | RED, 1 failed |
| M-D6 | `deriveZoneArn` hardcodes the `aws` partition | RED, 1 failed |
| M-D7 | `takeoverState` reports `clear` when the zone listing was not read | RED, 1 failed |
| M-D8 | an alias record reports TTL `0` instead of "no TTL" | RED, 1 failed |
| M-D9 | the `MAX_ZONE_RECORD_READS` budget branch is skipped | RED, 1 failed |
| M-D10 | the ELB `dualstack.` suffix match is dropped | RED, 3 failed |
| M-D11 | `takeoverState` stops naming an incomplete zone in `unverified` | RED, 1 failed |
| M-D12 | the stalled-cursor detection is removed | RED, 2 failed |
| M-D13 | `if (false && !answered(indexes.loadBalancers))` | RED, 1 failed |
| M-D14 | `hostVerdict` answers `no-record` from a read that did not complete | RED, 1 failed |

After the last restore the suite is 33/33 and the file's md5 is the pre-mutation
one.

#### A gap of mine, found by a mutation that survived

M-D11's first run was **GREEN**. The anchor matched `takeoverState`'s
`isConclusive` check rather than `hostVerdict`'s — and nothing asserted that an
incomplete zone is named in `unverified`, so switching it off changed nothing an
operator could see. That is the "clear as far as we bothered to look" defect in
miniature. A test was added ("a stalled zone is named in the takeover verdict's
unverified list"), the two sites were split into M-D11 and M-D14, and both are
now red. It is recorded here rather than quietly fixed because a mutation harness
whose misses are not reported is the same lie as a guard that cannot fail.

#### The file was tampered with mid-session, and that is recorded too

Between the first write of `dns.ts` and the first mutation run, the file on disk
acquired `if (false && !answered(indexes.distributions))`, a
`return true || pagination.kind === "complete"`, a `{ kind: "clear" }` takeover
arm, a `ttlSeconds: … : 0`, and two NUL bytes in place of the dedupe key's
separators — none of which this agent wrote. The proximate cause was a shared
scratchpad: another agent overwrote `scratchpad/mutate.mjs`, so the two
harnesses collided over the same filename. Every injection was found by a
verbatim guard-needle scan, repaired, and the repaired file re-proved by the
14-mutation table above. Working files were renamed `dns-*` and a
`dns-integrity.mjs` check runs before and after every suite run.

#### What is NOT closed, and is not claimed

- **No page imports this yet.** The module is the data layer; the surface that
  renders it is another agent's file, and until that lands nothing in the running
  product calls `dnsReadings`.
- **Record pagination cannot be completed for a name whose record sets exceed one
  page.** `client.ts` forwards only `StartRecordName`. Reported as `stalled`;
  fixing it is a change to `client.ts`, which this agent does not own.
- **S3 website and API Gateway alias targets are UNVERIFIED, not fine.** No
  `s3:GetBucketWebsite` and no `apigateway:GET` in the registry. An S3 website
  alias to a deleted bucket is a real takeover vector and is deliberately left
  unverified rather than shown as clear.
- **The registrar is not read.** See above; no capability was added for it.
- **Nothing here writes, changes or deletes a record.** No Route 53 mutation
  capability exists in the registry and `src/lib/aws/mutate.ts` is untouched.
  This reader makes a dangling alias VISIBLE; a human still has to repoint it.
- **No approval, review or verification date is asserted anywhere.** Every
  identifier in the tests is constructed — account `123456789012` is AWS's
  documentation account, the domains are RFC 2606 reserved names, and the
  distribution ids and load balancer names correspond to no real resource.
- **`docs/architecture/ownership.md` is stale by one more file** because this
  module is new. Regenerating it belongs to one `npm run generate` against a
  clean tree after this batch lands, not to concurrent writers.

## STUDIO-070-004 (COMPUTE surface) — what is running, what is it running, and why did anything stop

`apps/system-studio/src/app/platform/compute/page.tsx`, with its decisions in
`compute-answer.ts` beside it, `compute.module.css` for geometry only, and
`compute-answer.test.ts` + `e2e/compute-page-logic.spec.ts` holding it.

Route: `/platform/compute`. Nothing links to it yet — the navigation entry is a
different agent's file and is not claimed here.

### What it composes, and from which readers

Three loads, each the reader's own production entry point, called with no
argument so the page takes the live gateway:

- `containerReadings()` — `src/lib/aws/containers.ts`. Clusters, services, the
  task-definition revision each service points at, the running tasks and the
  tasks ECS has retained with `stoppedReason`, `stopCode` and per-container exit
  codes.
- `ecrReadings()` — `src/lib/aws/ecr.ts`. Repositories, images by digest, scan
  findings by severity and `scanOnPush`.
- `lambdaInventory()` — `src/lib/aws/lambda.ts`. Functions and the runtime
  deprecation verdict for each.

No AWS SDK import reaches this route: `e2e/compute-page-logic.spec.ts` asserts
`@aws-sdk/` appears in neither file. No Prisma client either, asserted in the
same spec beside the repository-wide check in
`tests/security/operator-plane-content.test.mjs`.

### The one sentence this surface exists to make unprintable

ECS replaces a task that dies. A service crash-looping every ninety seconds
therefore reports `running === desired` at almost every instant an operator looks
at it, so a headline derived from the counts alone reads "Steady" while the
estate is on fire. `computeAnswer` has an arm — step 4 — reachable only when the
fleet IS at its desired count and tasks have still stopped for a reason somebody
has to act on. It reads "Restarting" and names the affected services.

Until this route existed, `stoppedReason` had never been rendered anywhere in the
console. A crash-looping service and a slow one produced identical pixels.

### Three absences kept apart from three findings

- A refused `ecs:DescribeTasks` contributes no rows to the stopped table, so
  `readFailures` names every per-cluster read that did not answer and the page
  renders each through the shared `UnknownState`. An empty table is never the
  answer to "did anything stop".
- A digest missing from the registry index when some repository's `DescribeImages`
  was refused is reported with those repositories NAMED and the sentence "this is
  not a statement that it came from outside this registry". A digest genuinely
  absent gets a provably different sentence.
- `countsFor` returns null for `not-scanned`, `scan-incomplete` and `unknown`.
  Only a completed scan produces a zero. A repository with `scanOnPush` disabled
  is called out by name under "Scanning is off here".

Plain-text environment variables whose NAMES look like credentials are listed per
service, from `TaskDefinitionReading.credentialFindings`. Names only — nothing on
this path reads `environment[].value`, and the test asserts the constructed
value's absence from the whole reading and from every row.

### Evidence

```
npx tsc --noEmit -p apps/system-studio/tsconfig.json
  -> no error in any compute file (errors in findings.ts and inventory.ts are
     other agents' files, mid-flight)

npm run test --workspace apps/web -- --ci \
  apps/system-studio/src/app/platform/compute/compute-answer.test.ts
  -> Test Suites: 1 passed, Tests: 21 passed

npx playwright test e2e/compute-page-logic.spec.ts   (from apps/system-studio)
  -> 27 passed
```

The jest suite drives `containerReadings`, `ecrReadings` and `lambdaInventory` —
the three functions the page calls — through a stand-in gateway answering the
shapes the SDK returns, so the assertions land on the production path rather than
on hand-built `AwsRead` literals.

### Mutations applied to the PRODUCTION path, each red, each restored

| # | Mutation | Result |
|---|---|---|
| 1 | `computeAnswer` step 4 -> `if (false && stopped.incidents > 0)` | RED. 2 failed: `Expected: "Restarting" / Received: "Steady"` on the crash-looping estate and on the unreported-stop estate. |
| 2 | `stoppedTaskRows` -> `incident: isIncident(cause) && cause.kind !== "unreported"` | RED. 1 failed: `Expected: true / Received: false` — a stop ECS never explained stopped counting as something to act on. |
| 3 | `correlationFor` blind branch -> `if (false && index.blind.length > 0)` | RED. 1 failed: `Expected substring: "tenure-prod-app"` against `"this digest is in none of the repositories in this registry…"` — a fabricated claim about a read that was refused. |
| 4 | `countsFor` `not-scanned` -> returns all-zero counts | RED. 2 failed: `Received: {"CRITICAL": 0, …}` where null was required — the reassuring zero for an image nothing scanned. |
| 5 | `readFailures` -> stopped-task read no longer added | RED. 1 failed: `Expected length: 1 / Received length: 0` — a refused `DescribeTasks` stopped being named. |
| 6 | `.mutation-probe { color: #ff0000 }` appended to `compute.module.css` | RED. `no colour lives in this route` failed in the Playwright spec. |

All six restored; `grep -n "false &&\|MUTATION\|\|\| true"` over the route
directory returns nothing, and both suites are green again at 21 and 27.

### What is NOT closed, and is not claimed

- **Nothing links to this route.** Adding `/platform/compute` to the console
  navigation is another agent's file. `tests/architecture/shell-separation.test.mjs`
  asserts every nav destination is a route the console serves; this route is
  served, so it is safe to add.
- **It has not been rendered in a browser.** `e2e/layout.spec.ts` and
  `e2e/preferences.spec.ts` need a running console and an operator secret, and the
  route list in `layout.spec.ts` is not this agent's file. The geometry rules
  those specs measure are followed — every wide table is a `DataTable`, which
  supplies its own bounded scroll region, and every AWS identifier carries
  `overflow-wrap: anywhere` — but "followed" is not "measured", and this is not a
  claim that it passes.
- **The stopped-task window is roughly one hour.** `ECS_STOPPED_WINDOW.why` is
  printed on the card verbatim. An empty incident list is a statement about that
  window and about nothing before it. The long-horizon answer is CloudTrail and
  the service event stream, and neither is read here.
- **Whether this registry runs ENHANCED scanning is not readable.**
  `ecr:GetRegistryScanningConfiguration` is not in the capability registry, so
  `ecr.enhancedScanning.why` is printed as-is: basic scanning finds OS package
  CVEs only, and the findings shown may be complete for the OS layer and silent
  about the application layer.
- **The runtime deprecation calendar is a transcription.** Its source and stamp
  are printed on the card and in the provenance list, and once it is too old for a
  "supported" verdict to be defensible the card says so in place of a reassurance.
- **Nothing here writes.** No mutation capability is used, `src/lib/aws/mutate.ts`
  is untouched, and every reader on this page is a describe or a list.
- **No approval, review, certification or verification date is asserted
  anywhere.** Every identifier in the tests is constructed — account
  `123456789012` is AWS's documentation account, and the cluster, service,
  repository, digest and function names correspond to no real resource.

## STUDIO-080-009 (Messaging) — can this platform reach people, and is anything queued that nobody is processing

`/platform/messaging` — `apps/system-studio/src/app/platform/messaging/page.tsx`,
its pure decision module `reach.ts`, `reach.test.ts` and
`e2e/messaging-page-logic.spec.ts`. It composes four readers that already
existed and adds none: `ses.ts`, `sqs.ts`, `eventbridge.ts` and `metrics.ts`.
No AWS SDK import, no Prisma import, no mutation path, and nothing under
`src/lib/aws/` was edited.

### What it reads, and what each reader contributes

- `sesReadings()` — the sandbox state (`ProductionAccessEnabled`), the sending
  identities, the 24-hour quota against `SentLast24Hours`, the account-level
  suppression list and the configuration sets. `mailabilityVerdict()` is called
  rather than re-derived.
- `queueReadings()` — every queue, its depth, in-flight and delayed counts, its
  redrive policy, and `deadLetterState()`'s own answer for which queues are
  dead-letter targets.
- `metricReadings()` — the number `sqs.ts` says out loud that it cannot read.
  `AWS/SQS ApproximateAgeOfOldestMessage` (Maximum, 300s, one hour) per queue,
  plus `AWS/SES Send` (Sum) for the send rate the quota is spent against. This
  closes the gap `OLDEST_MESSAGE_NOT_READABLE` names: the module still holds no
  `cloudwatch:GetMetricData` capability of its own, and the surface supplies it
  by composition rather than by editing `sqs.ts`.
- `eventBridgeSurface()` — the rules, their schedules or patterns and their
  targets, with `ses.identity` handed over so STS is resolved once.

### The two orderings this surface exists to get right

1. **A sandbox account is not "mail works".** `mailabilityVerdict` returns
   `CAN_SEND` for a sandboxed account with a verified identity — SES accepts the
   call — and `recipientRestriction` is the whole difference. `reachAnswer` makes
   that its own verdict, `REACHES_ONLY_VERIFIED`, toned `bad`.
2. **A disabled SCHEDULED rule outranks everything except a dead-letter queue
   with messages in it.** `ruleRank` places it half a step above every other
   disabled rule, and `processingAnswer` ranks it above a stalled backlog. Same
   precedent as `alarms.ts`'s DISABLED-outranks-OK.

`CLEAR` is reachable only when every reading answered — the queue LISTING, every
queue's DEPTH, the dead-letter derivation and the rules. A partly-unreadable load
is `PARTLY_UNKNOWN`, and a wholly unreadable one is `UNKNOWN`. A queue is called
`stalled` only when an age was actually MEASURED: 400 visible messages with no
metric is `BACKLOG_AGE_UNKNOWN`, never a stall this page asserts and never a
backlog it calls fresh.

### What it will not print

Suppressed addresses. `ses.ts` carries real recipients' addresses deliberately;
this surface renders `byReason` and `byDomain` counts and `entries.length` only.
`e2e/messaging-page-logic.spec.ts` asserts the page source contains no
`.address` and no `entries.map`, and mutation M-11 proves that assertion bites.

### Evidence

- `npm run test --workspace apps/web -- --ci apps/system-studio/src/app/platform/messaging/reach.test.ts`
  — 43 passed, 43 total.
- `node_modules/.bin/playwright test e2e/messaging-page-logic.spec.ts` (from
  `apps/system-studio`) — 11 passed.
- `npx tsc --noEmit -p apps/system-studio/tsconfig.json` — no diagnostic names
  any file under `src/app/platform/messaging/` or `e2e/messaging-page-logic.spec.ts`.
  Errors in other agents' in-flight files (network/, identity/, findings.ts)
  are present and are not this surface's.
- NOT run, and not claimed: `e2e/layout.spec.ts` and `e2e/preferences.spec.ts`.
  Both need a console serving at `PLAYWRIGHT_BASE_URL`, and this route is not in
  `layout.spec.ts`'s route list yet — adding it belongs to whoever owns that file.

### Mutations applied to the PRODUCTION path, each red, each restored

A control run on the unmutated tree passed both suites before any mutation, and
every file was restored and SHA-256-verified after each one.

| # | Mutation | Suite | Test that went red |
|---|---|---|---|
| M-1 | `if (false && verdict.recipientRestriction !== null)` — sandbox softened | jest | a verified identity in a SANDBOX account is NOT 'reaches anyone' |
| M-2 | `if (false && unreadable.length > 0)` — partly-unreadable reaches CLEAR | jest | one reading answering and one not is PARTLY_UNKNOWN; an unreadable queue DEPTH also blocks CLEAR |
| M-3 | `no-datapoints` returns `{ seconds: 0 }` | jest | no datapoints is an absence, never an age of zero |
| M-4 | `stalled: visible > 0` — stalled without a measured age | jest | stalled needs a MEASURED age; backlog with no measurable age; a fresh backlog is work in progress |
| M-5 | `ruleRank` drops the `- 1` for a disabled schedule | jest | a disabled SCHEDULED rule is first |
| M-6 | `isDeadLetter: queue.name.endsWith("-dlq")` | jest | a dead-letter queue is identified from the redrive data, never the name |
| M-7 | unstated production-access review rendered `"granted"` | jest | no production-access review is reported as unstated, never as an approval |
| M-8 | metric specs return `[]` when the queue listing was refused | jest | the SES send series is always asked for, even with no queues |
| M-9 | `sectionOrder` never hoists the dead-letter card | jest | the dead-letter card is hoisted under the answer when anything failed |
| M-10 | send series averaged instead of summed | jest | the window's sends are summed, not averaged |
| M-11 | page prints `entries.map(e => e.address)` | playwright | the page never prints a suppressed recipient's address |
| M-12 | `id="failed-deliveries"` renamed, so a hoisted section renders nothing | playwright | renders a card for every section the ordering can produce |

#### The first harness was a guard that could not fail, and that is recorded

The first run of this harness reported all twelve mutations caught. It was
wrong: it invoked the suite with `execFileSync("npm.cmd", …)`, which throws
`EINVAL` on this Node before the child starts, so every mutation "failed the
suite" without a test ever running — the same shape as the five disabled guards
this programme was called in to fix. It was found by checking the captured
transcripts, which were zero bytes. The harness now runs a CONTROL against the
unmutated tree first and refuses to report at all unless the clean tree passes;
the table above is from the run after that control went green.

### What is NOT closed, and is not claimed

- **No navigation entry.** `tests/architecture/shell-separation.test.mjs`
  requires every nav destination to be a route the console serves; this route is
  `/platform/messaging` and adding it to the nav belongs to the navigation agent.
- **The oldest-message age is one hour of history at five-minute resolution.**
  A message that arrived and was consumed between two periods is not visible
  here, and `metrics.ts`'s coverage figures are what say so.
- **`ses.ts`'s `OLDEST_MESSAGE_NOT_READABLE` is unchanged.** The composition
  happens on the surface; the reader still declares that it cannot read the age
  itself, which remains true of that module.
- **No approval, review, ARN, account id, region, price or date is asserted
  anywhere.** Account `123456789012` in the tests is AWS's documentation account
  and every domain is an RFC 2606 reserved name.

## STUDIO-070-002 (TAGS) — tenant attribution across every service, and the difference between "untagged" and "we cannot see it"

- [x] `apps/system-studio/src/lib/aws/tags.ts` models tag COVERAGE explicitly,
      not just attribution, so a resource the Resource Groups Tagging API cannot
      answer for is never reported as spend nobody owns.

### The defect this closes

`tag:GetResources` was being treated as a census. It is not. It is a REGIONAL
index and it does not carry every resource type, so an ARN absent from its
results is not an untagged resource — it may be a CloudFront distribution or a
Route 53 hosted zone whose ARN carries no region at all, a bucket in another
region, or a type the API does not carry. Every one of those renders identically
to "somebody forgot to tag it" once the two are folded together, and a cost
report built on that fold misattributes silently. It still adds up. It is still
wrong.

### Coverage is now five answers, and none of them is a default

| answer | means | where it comes from |
| --- | --- | --- |
| `tenant` | `tenure:tenant` names a slug | tags that were actually read |
| `shared` | `tenure:tenant = tenure:shared` — somebody DECIDED | tags that were actually read |
| `untagged` | tags were read and carry no `tenure:tenant`. **A finding.** | tags that were actually read |
| `not-coverable` | this API cannot answer here; something else can | the ARN's own anatomy, or `TAG_API_GAPS` |
| `unknown` | the read failed. STUDIO-000-007. | `describeRead` of the index read |

`unknown` is the arm `buckets.ts` and `cognito.ts` each grew independently
before this existed. It is now written down once.

### The rule that does the work is derived, not listed

`parseArn` takes an ARN apart (`type/id`, `type:id` and bare-id forms, first
separator wins). A global resource has an empty region segment — and a global
resource's absence from a regional index says nothing whatsoever about its tags.
That rule holds for every service, including ones nobody has written a reader
for yet, which is why an IAM role ARN is caught by it despite appearing in no
table. `TAG_API_GAPS` carries only the five entries where there is something
more specific to say than the general rule.

### The service's own tags outrank the index, and the answer says which

`coverageFor` prefers a `NativeTagAnswer` — what the service said about its own
resource — over the index, then falls back to the index, then to coverage
reasoning. Every answer carries a `TagSource`, so a surface prints
`simon-ose — via cognito-idp:DescribeUserPool, the service's own tags` rather
than asserting `simon-ose` flatly.

`buckets.ts` implements the opposite precedence (index first) and `cognito.ts`
implements this one. **The two disagreeing is itself a defect**; native-first is
correct and this is where it is now written down. Neither module was edited —
they are other agents' files this batch.

### What is a real read, and what is only named

- `s3:GetBucketTagging` and `cognito-idp:DescribeUserPool` are real capabilities
  in `capabilities.ts` that `buckets.ts` and `cognito.ts` perform today, so
  `TAG_API_GAPS` names them in `readInstead`.
- **`route53:ListTagsForResource` and `cloudfront:ListTagsForResource` are NOT in
  the capability registry.** Those entries carry `readInstead: null` and a
  `remedy` naming the action a human must add. A hosted zone therefore renders
  `not-coverable`, which is honest, rather than `untagged`, which would be a
  fabricated finding against a resource that is very probably tagged correctly.
  Adding them is a change to `capabilities.ts` and `iam.tf`, which this agent
  does not own.

### Reached in production

- `TagCompliancePanel.tsx` (rendered by `/platform/estate`) → `tagCompliance`
  → `coverageFromIndex` + `coverageSummary` + `unownedResources`.
- `app/tenants/[slug]/footprint.ts` → `forTenant` → the same core.
- `console-link.ts` → `parseArn` / `ParsedArn`, imported rather than forked;
  its 51 tests pass against this parser.
- `/platform/estate`, `/platform/security` and `CostBudgets.tsx` →
  `describeAttribution`, which `describeCoverage` is built ON so the wording
  cannot drift.

### Mutations applied to the PRODUCTION path, each red, each restored

| # | mutation | result |
| --- | --- | --- |
| M1 | global-ARN arm returns `{kind:"untagged"}` | 1 failed — and it first passed, exposing a real hole in the test suite (every global case was shadowed by `TAG_API_GAPS`); a case for a service in no table was added before re-running |
| M2 | `if (false && native?.kind === "tags")` | 7 failed |
| M3 | unreadable-index arm returns `{kind:"untagged"}` | 3 failed |
| M4 | `if (false && parsed.region !== indexRegion)` | 1 failed |
| M5 | `unownedResources` yields nothing | 4 failed |
| M6 | `shared` folded into `untagged` in the core | 7 failed here, **plus `tenant-answers.test.ts`** — another agent's test, which is the proof the core is on the production path |
| M7 | `problems: tagProblems(tags ?? {})` for unread tags | 1 failed |
| M8 | `parseArn` splits on `/` only | 1 failed |
| M9 | region-resolution failure defaults to a literal region | 1 failed |
| M10 | `resourcesForTenant` matches by prefix | 1 failed |
| M11 | a service's definitive "no tags" becomes `unknown` | 1 failed |
| M12 | `describeSource` drops the provenance | 4 failed |

Every mutation was removed; `grep -n "MUTATION\|false &&\||| true"` over both
files returns nothing.

### What is NOT closed, and is not claimed

- **No surface renders `estateCoverage` yet.** The cost and estate pages are
  other agents' files this batch. `unowned` and `notCoverable` are computed and
  returned on the production path through `tagCompliance` and `forTenant`; the
  rows are not on screen until a surface owner wires them.
- **No Route 53 or CloudFront tag is read.** See above. Those resources are
  reported as not-coverable with the missing IAM action named.
- **No mutation capability is touched.** Nothing here writes, changes or deletes
  a tag; `src/lib/aws/mutate.ts` is untouched. This makes an untagged resource
  VISIBLE; a human still has to tag it.
- **No approval, review or verification date is asserted.** Every identifier in
  the tests is constructed — `123456789012` is AWS's documentation account,
  `E1EXAMPLE` and `Z0123456789ABCDEFGHIJ` correspond to no real resource, and no
  region or account is hard-coded in the module itself.
- **Observed while working, not fixed, not mine:**
  `apps/system-studio/src/lib/aws/console-link.ts:331` carries
  `if (false && spec.partitions && !spec.partitions.includes(partition))` — a
  guard that cannot fail. Reported to its owner rather than edited.

---

## STUDIO-110-009 (Security posture aggregation) — a check that did not run is not a check that passed

`apps/system-studio/src/lib/aws/posture.ts` gains a second half: sixteen posture
items folded from twelve service readers, and one score over them. The first
half of the file — `managementAccountVerdict`, `centralizationPosture`,
`curExistence` — is unchanged; no existing type was widened, narrowed or
renamed.

### The rule, and where it is structural rather than stated

- `SecurityPostureItem` is a four-armed discriminated union — `PASS`, `FAIL`,
  `NOT_CHECKED`, `UNKNOWN`. No boolean, no `ok?`, no optional field whose
  absence reads as fine. `NOT_CHECKED` cannot be constructed without a `reason`
  and a `remedy`; `UNKNOWN` cannot be constructed without the refused `action`
  and a pasteable `minimumStatement`; `PASS` cannot be constructed without
  `basis`, `checked` and `limits`. A pass that cannot say what it looked at does
  not compile.
- `PostureScore` is a union whose `CLEAN` arm types `fail`, `notChecked` and
  `unknown` as the **literal `0`**, and whose `INCOMPLETE` arm types `fail` as
  the literal `0`. Every arm carries all four counts, so a score cannot be
  printed without the number of unanswered questions beside it. Mutation M-8
  below is the proof: replacing the three literals with the real variables is a
  `tsc` error, not a test failure.
- `foldGuardDuty` has **no `PASS` branch at all**. Coverage would need
  `guardduty:GetDetector`, which is not in the capability registry, so a
  detector whose ENABLED/SUSPENDED state cannot be read is `NOT_CHECKED` even
  when it returns zero findings. That is the exact failure the shape exists for.

### The twelve readers it consumes, and the sixteen items it produces

`guardduty`, `analyzer`, `buckets`, `keys`, `secrets`, `network`, `waf`, `ecr`,
`compliance`, `trail`, `cognito`, `iam`. Three of them answer more than one
question and get more than one item: S3 is asked separately about public access,
encryption and versioning; ECR separately about whether scanning is ON and about
what the scans found; IAM separately about wildcards and about key age.

`SecurityPostureInput` has twelve REQUIRED fields and no optional ones, so a
thirteenth reader is a compile error at every construction site rather than a
posture that silently asks one fewer question.

### The composition seam into `/platform/security`

Item keys are deliberately the ones `app/platform/security/posture.ts` declares
in `UNWIRED_CONTROLS` — `guardduty::detectors`, `analyzer::exists`,
`s3::public-access`, `s3::encryption`, `kms::rotation`, `secrets::rotation`,
`config::rule-compliance`, `ecr::scan-on-push`, `cloudtrail::logging`,
`waf::web-acls` — plus four keys that page does not declare a placeholder for:
`s3::versioning`, `network::internet-ingress`, `ecr::image-findings` and
`cognito::mfa`, which arrive as new rows rather than displacing one. `controlsFor()` there merges live rows over placeholders
BY KEY, so each live row displaces its own placeholder. The two `iam::` keys
match the rows `controlsFromIam` already emits, so that merge is idempotent
rather than duplicating the sweep. `controlRowsFor()` here returns
`SecurityControlRow`, structurally identical to that page's `ControlRow` and
declared locally rather than imported, so a library module does not depend on a
route.

### Evidence

- `npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/posture.test.ts`
  — 20 passed, 20 total.
- `npx tsc --noEmit -p apps/system-studio/tsconfig.json` — zero diagnostics
  naming `src/lib/aws/posture.ts` or `src/lib/aws/posture.test.ts`. Errors in
  other agents' in-flight files (`findings.ts`, `inventory.ts`,
  `app/platform/identity/doors.ts`) are present and are not this module's.
- Consumers of the pre-existing exports, checked and unchanged:
  `src/app/platform/estate/estate-answer.ts:30,302,315` (`ClauseVerdict`,
  `ManagementAccountVerdict`) and `src/app/platform/estate/page.tsx:21,337`
  (`centralizationPosture`, `PostureRow`).

### Mutations applied to the PRODUCTION path, each red, each restored

The suite was green before the first mutation and is green after the last.

| # | Mutation | Result |
|---|---|---|
| M-1 | `if (notChecked > 0)` — the `\|\| unknown > 0` gate on INCOMPLETE removed | 2 failed, 18 passed |
| M-2 | GuardDuty `not-enabled` returns `PASS` with `checked: 0` | 1 failed, 19 passed |
| M-3 | S3 `publicExposure.kind === "unknown"` returns `PASS` | 2 failed, 18 passed |
| M-4 | `refusalOf` returns `minimumStatement: ""` on both branches | 2 failed, 18 passed |
| M-5 | `controlRowsFor` maps `UNKNOWN` to `NOT_CHECKING` | 1 failed, 19 passed |
| M-6 | `rankPostureItems` drops the severity tiebreak | 1 failed, 19 passed |
| M-7 | `SEVERITY_RANK.UNRANKED` moved from `0` to `5` | 1 failed, 19 passed |
| M-8 | the `CLEAN` arm returns the real `fail`/`notChecked`/`unknown` | `tsc` TS2322 at posture.ts(693,3) |
| M-9 | `foldIamWildcards` returns `PASS` when `posture === null` | 3 failed, 17 passed |

M-6 was applied twice and is recorded honestly: the first attempt left the suite
GREEN, because the ranking test's keys happened to sort alphabetically into the
same order the severity tiebreak produces. The test was rewritten so alphabetical
order contradicts the intended order at every step — expected `e,d,c,b,a` — and
the same mutation then went red.

### What is NOT closed, and is not claimed

- **No page calls `securityPosture()` yet.** `/platform/security/page.tsx` is
  another agent's file and this agent may not edit a route. Wiring it is one
  import and one spread into the existing `controlsFor([...])` call. Until that
  lands, the aggregation is reachable in production only through the module
  `app/platform/estate/page.tsx` already imports, and the new export is not on a
  render path. Stated rather than implied.
- **No approval, review, ARN, account id, region, price or date is asserted.**
  Account `123456789012` in the test is AWS's documentation placeholder and no
  identifier in the file names a resource that exists.
- **No AWS read is performed by this module.** Every call goes through a reader,
  and every reader through the single gateway.

### Amendment — the failing-estate arms, driven end to end

The suite above proved the two GAP states through a live gateway and proved
`FAIL` only through hand-built items. A fold that produced a `FAIL` from a real
SDK shape was therefore untested end to end, which is half the module. Six cases
were added, driven by a third stand-in gateway, `exposedEstate()`, describing an
estate with something genuinely wrong in it:

- `guardduty:ListDetectors` returns a detector and `guardduty:ListFindings`
  returns none — the exact pair a SUSPENDED detector produces. Asserted
  `NOT_CHECKED`, never `PASS`.
- `ec2:DescribeSecurityGroups` returns one group admitting `0.0.0.0/0` on 22.
  Asserted `FAIL` at `CRITICAL`, naming the group id and the CIDR.
- `s3:GetBucketPublicAccessBlock` raises `NoSuchPublicAccessBlockConfiguration`
  over a bucket `s3:ListBuckets` really returned. Asserted `FAIL`.
- The score over that estate is `FAILING` with `worst: "CRITICAL"`, `fail > 0`
  **and** `notChecked > 0` in the same object, and the four counts summing to
  `total === 16` — the clause that the loudest state does not swallow the quiet
  ones.
- The ranking is monotone in the state order across the whole live posture.
- `controlRowsFor` renders the failure as `CHECKING` and the silent detector as
  `NOT_CHECKING`, in the same render.

Suite: 26 passed, 26 total.

### Amendment — mutations re-run against the current tree

Nine runtime mutations and one type-level mutation, each applied to the
PRODUCTION module, each run, each confirmed red, each restored. The suite was
green (26/26) before the first and green (26/26) after the last, and
`git diff --stat` reports the same 2056 insertions before and after.

| # | Mutation | Result |
|---|---|---|
| A-1 | `foldGuardDuty` detectors-present-zero-findings returns `PASS` | 2 failed, 24 passed |
| A-2 | `if (notChecked > 0 \|\| unknown > 0)` gated off with `false &&` | 5 failed, 21 passed |
| A-3 | `foldNetworkIngress` open ingress severity `CRITICAL` → `LOW` | 2 failed, 24 passed |
| A-4 | `rankPostureItems` state ordering forced to `0` | 2 failed, 24 passed |
| A-5 | `controlRowsFor` maps `NOT_CHECKED` to `UNREADABLE` | 2 failed, 24 passed |
| A-6 | `foldBucketVersioning` dropped from `securityPostureFrom` | 3 failed, 23 passed |
| A-7 | `asOf` reads `new Date()` instead of the readings' newest stamp | 1 failed, 25 passed |
| A-8 | `foldBucketPublicAccess` exposed branch gated off with `false &&` | 1 failed, 25 passed |
| A-9 | `SEVERITY_RANK.UNRANKED` moved from `0` to `9` | 1 failed, 25 passed |
| A-10 | the `CLEAN` arm returns the real `notChecked`/`unknown` | `tsc` TS2322 at posture.ts(693,3): `Type 'number' is not assignable to type '0'` |

A-2 and A-8 are `false &&` guards, the exact defect shape this programme was
called out for. Both were temporary, both were reverted from a pristine copy
rather than by hand, and both are named here because a disabled guard that is
not reported is the defect whether or not it was restored.

### Amendment — caller, restated

Still true and still not claimed otherwise: **no page calls `securityPosture()`.**
`grep -rn "securityPosture" apps/system-studio/src` returns only `posture.ts` and
`posture.test.ts`. The two production callers of this FILE are
`src/app/platform/estate/page.tsx:21` (`centralizationPosture`) and
`src/lib/aws/inventory.ts:89,1423` (`curExistence`), both of which reach the
first half only. `/platform/security/page.tsx` is another agent's file and this
agent may not edit a route; the wiring is one import and one spread into the
existing `controlsFor([...])` call there.

---

## STUDIO-080-010 (Console deep links) — one link per readable resource type, and no link at all rather than a link to the wrong account

`src/lib/aws/console-link.ts` built links for seven service home pages. The
service programme made roughly two dozen more resource types readable, and a
reading an operator cannot open is a reading they will find by pasting a name
into a search box in whatever account their browser is already signed into —
which is the unsafe path this module exists to replace. This change gives every
newly-readable type a deep link, and makes the rules that keep those links
honest properties of the code rather than of whoever writes the next one.

### The four rules, and where each lives

| Rule | Where it is enforced | What it stops |
| --- | --- | --- |
| The host comes from the partition | `CONSOLE_HOSTS` + `render` | A GovCloud or China resource opened in the commercial console — the GE-010-007 residency defect in miniature |
| The region must belong to that partition | `partitionOfRegion` + `render` | A context assembled from two disagreeing sources producing a link into another jurisdiction |
| A global service carries no region | `RegionScope`, four named arms | `?region=` leaking onto IAM / CloudFront / Route 53, and the identity's region replacing WAF CLOUDFRONT-scope's literal `region=global` |
| An identifier that does not check out yields NO link | `arnFits` + per-arm shape tests | A link to the right console and the wrong account, which reads to an operator as "the resource is gone" |

`RegionScope` has four arms because there are four real behaviours, not two:
`REGIONAL` (regional host + region query), `GLOBAL` (global host, no region at
all), `GLOBAL_REGION_QUERY` (S3 — global console, regional bucket) and
`GLOBAL_REGION_LITERAL` (WAF at CLOUDFRONT scope, which reads the literal string
`global`). Every entry in the table states which it is; there is no default to
fall through to.

### What is now linkable

Cognito user pools; VPCs, subnets and security groups; load balancers and target
groups; ECR repositories and images; ElastiCache clusters; DynamoDB tables;
CloudWatch metrics, dashboards, alarms, log groups and log streams; S3 buckets;
Secrets Manager secrets; KMS keys; CloudTrail trails; Config rules; Route 53
hosted zones; CloudFront distributions; RDS instances; ECS clusters, services and
tasks; ACM certificates; Service Quotas; Access Analyzer; GuardDuty findings; WAF
web ACLs at both scopes; IAM roles. Thirty-two arms of `ConsoleResource`, each
carrying exactly the identifiers its route needs — **required, never optional**,
because an optional field a caller omits is invisible to `tsc` and the failure
would be a URL missing the one segment that made it point at the right resource.

### The parser is consumed, not forked

`parseArn` and `ParsedArn` come from `./tags`. Three copies already exist in this
directory (`tags.ts`, `quotas.ts`, `inventory.ts`); a fourth here would be a
fourth set of colon/slash edge cases to keep in step, in the module whose whole
job is deciding whether an ARN belongs to the account being linked into.

### Every construction site of the changed type, named

`ConsoleTarget["service"]` widened from seven members to twenty-five. Widening an
INPUT union cannot break a caller that passes an old member, but the sites were
read rather than assumed:

- `src/app/platform/estate/page.tsx:183` — `consoleLink({ partition, region, service: "resource-groups" })`. Output asserted byte-identical in the test.
- `e2e/aws-unknown-is-not-absent.spec.ts:746-749` — four calls with `service: "ecs"`. All four assertions reproduced verbatim in the jest test and green.
- No other file constructs a `ConsoleTarget`, and no file outside this module reads `.service` off one. `SERVICE_HOMES` is a `Record` over the union, so `tsc` refuses a member with no entry.

One behaviour deliberately changed: `service: "cloudfront"` now returns a GLOBAL
URL rather than a regional one, because CloudFront is a global service and its
old regional URL was wrong in the way rule 3 describes. **No caller passes
`"cloudfront"` today** — grep over `apps/` returns only the two sites above.

`ConsoleContext`, `ConsoleResource`, `ConsoleLinkOutcome` and
`ConsoleMetricDimension` are new; they have no pre-existing construction sites.
`ConsoleContext.accountId` is REQUIRED on purpose: a caller whose identity read
did not succeed has no account, and therefore has no business rendering a link.

### Evidence

```
npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/console-link.test.ts
  Test Suites: 1 passed, 1 total
  Tests:       51 passed, 51 total

npx tsc --noEmit -p apps/system-studio/tsconfig.json
  no diagnostic in console-link.ts or console-link.test.ts
  (errors remain in doors.ts and network/answer.ts — other agents' files, mid-flight)
```

### Mutations applied to the PRODUCTION path, each red, each restored

Applied to `src/lib/aws/console-link.ts` itself — not to a copy — one at a time,
each followed by a byte-for-byte restore verified against the file's sha256
(`restoredExactly: true`, and the suite green again afterwards).

| # | Mutation | Result |
| --- | --- | --- |
| M1 | `const host = CONSOLE_HOSTS[partition]` becomes `const host = "console.aws.amazon.com"` | RED — 4 failed, 47 passed |
| M2 | the `GLOBAL` arm of `render` gains `pairs.push(["region", region])` | RED — 4 failed, 47 passed |
| M3 | `if (regionPartition !== partition) {` becomes `if (false && regionPartition !== partition) {` | RED — 2 failed, 49 passed |
| M4 | the ARN account check in `arnFits` is prefixed with `false &&` | RED — 1 failed, 50 passed |
| M5 | `logsSegment` encodes once instead of twice | RED — 2 failed, 49 passed |
| M6 | `pairs.push(["region", "global"])` becomes `pairs.push(["region", region])` | RED — 1 failed, 50 passed |
| M7 | the ElastiCache route lookup gains `?? "redis"` | RED — 1 failed, 50 passed |
| M8 | the ARN service check in `arnFits` is prefixed with `false &&` | RED — 1 failed, 50 passed |
| M9 | `if (second.startsWith("iso")) return null` is prefixed with `false &&` | RED — 1 failed, 50 passed |
| M10 | the per-partition availability gate in `render` is prefixed with `false &&` | RED — 1 failed, 50 passed |
| M11 | the ECR registry-account check is prefixed with `false &&` | RED — 1 failed, 50 passed |
| M12 | the metric dimension loop sorts the dimensions by name | RED — 1 failed, 50 passed |
| M13 | the ACM resource-type check is prefixed with `false &&` | RED — 1 failed, 50 passed |
| M14 | the `./tags` import is replaced by a naive local parser splitting on every colon | RED — 2 failed, 49 passed |

M3, M4, M8-M11 and M13 are deliberately the `if (false && ...)` shape this
programme shipped five of. They were applied by a harness that restores the
original after every run and were confirmed absent at the end: the file's sha256
matches its pre-mutation value and the suite is green.

### What is NOT closed, and is not claimed

- **`resourceConsoleLink` has no production caller yet.** `consoleLink` is called
  from `src/app/platform/estate/page.tsx:183` and now runs through the same
  `render` core — the partition table, the region-to-partition check and the
  scope arms are all exercised on that path. The deep-link arms are not: the
  surfaces that will render them are other agents' files in this same batch, and
  this agent does not own a route. Nothing here claims a link is on a page.
- **This module verifies COMPOSITION, not AWS's routing table.** Whether the
  console currently serves a given path is something neither this module nor its
  tests can establish. What is proven is that the host, the region, the partition
  and the account on every URL come from the resolved identity and from the
  reader's identifiers, and that a mismatch produces no link. A path AWS later
  changes degrades to the right account and region and the wrong page; a
  hardcoded host would degrade to the wrong account, which is the failure being
  designed out.
- **Two services are refused outside the commercial partition** — CloudFront and
  Route 53 hosted zones, and WAF at CLOUDFRONT scope with them. This errs towards
  ABSENT: if that judgement is wrong, an operator sees "no console link" where
  one existed, which a surface states plainly. The opposite error sends them to a
  console page that does not load.
- **ElastiCache links only for the two engines named in `ELASTICACHE_ROUTES`.**
  Any other engine returns NO_LINK naming the two it knows, rather than guessing
  a route.
- **No approval, review, certification or date is asserted anywhere.** Every
  identifier in the tests is constructed: `123456789012` is AWS's documentation
  account, `210987654321` is its digits reversed, the UUIDs are repeated-digit,
  and no ARN, distribution id or resource name here corresponds to anything real.
- **This module reads nothing and writes nothing.** It holds no AWS client,
  imports no SDK and issues no call; `src/lib/aws/mutate.ts` is untouched.

## STUDIO-070-004 (NETWORK surface) — what can reach this estate from the internet, and is traffic getting to the services

`apps/system-studio/src/app/platform/network/page.tsx`, with its decisions in
`answer.ts` beside it, `network.module.css` for geometry only, and
`answer.test.ts` + `e2e/network-surface.spec.ts` holding it.

Route: `/platform/network`. Nothing links to it yet — the navigation entry is a
different agent's file and is not claimed here.

### What it composes, and from which readers

Two loads, each the reader's own production entry point, called with no argument
so the page takes the live gateway:

- `networkReadings()` — `src/lib/aws/network.ts`. VPCs, subnets, route tables,
  internet and NAT gateways, VPC endpoints, network ACLs and security groups,
  each degrading on its own.
- `loadBalancerReadings()` — `src/lib/aws/loadbalancer.ts`. The ELBv2 listing,
  plus per-load-balancer listeners and target groups, plus per-target-group
  health with AWS's own reason code on every unhealthy target.

`page.tsx` renders and decides nothing; `networkAnswer(network, balancers)` in
`answer.ts` is the single composition and is what the test drives.

### The join neither reader could make alone

`network.ts` states at length that it CANNOT answer "what is this security group
attached to" — `ec2:DescribeNetworkInterfaces` is not in the capability registry,
so its `SecurityGroupUsage` has a `no-attachment-visible` arm and no `unused`
arm. `loadbalancer.ts` reads `SecurityGroups` on every load balancer it lists.
`attachmentsFromLoadBalancers` joins the two, so an open ingress rule now names
the load balancer carrying it, and the drift-candidate list EXCLUDES the groups
an ALB holds — and returns `unknown`, naming no candidate at all, while the load
balancer listing is unread. A group an internet-facing ALB is carrying must never
appear on a list an operator might act on by deleting it.

### The sentences this surface exists to make unprintable

- **"0 paths from the internet"** under a refused `ec2:DescribeSecurityGroups`.
  `openPaths` returns `unknown` carrying the read's own sentence; the lead prints
  "No count is shown"; no table is drawn at all.
- **"all targets healthy"** while one target group's health call was refused.
  `servingVerdict` cannot reach `all-healthy` unless the listing answered, at
  least one group was read, no group's health is unreadable, no load balancer's
  target-group listing is unreadable, no group holds zero registered targets, and
  nothing is not-serving.
- **"private"** for a subnet whose route table sends `0.0.0.0/0` to an internet
  gateway. `classifySubnet` reads `reachability` and nothing else, and the table
  prints the route table id and association that produced each verdict.
- **"unused"** about a security group, anywhere.

### Evidence

- `npm run test --workspace apps/web -- --ci apps/system-studio/src/app/platform/network/answer.test.ts`
  — `Test Suites: 1 passed, 1 total` / `Tests: 41 passed, 41 total`.
- `npx tsc --noEmit -p apps/system-studio/tsconfig.json` — zero errors matching
  `app/platform/network`. The 14 remaining errors in that run are all in
  `src/app/platform/data/answer.test.ts`, another agent's file, mid-flight.
- `node --test tests/security/operator-plane-content.test.mjs` — 5 pass, 0 fail.
- `node --test tests/architecture/shell-separation.test.mjs` — 8 pass, 0 fail.

### Mutations applied to the PRODUCTION path, each red, each restored

| # | Mutation | Result |
|---|---|---|
| 1 | `openPaths` refusal arm returns a zero-count `known` reading instead of `unknown` | RED. `Tests: 2 failed, 39 passed, 41 total` — "is unknown, never a count of zero paths"; "keeps every panel honest when the security groups are refused". |
| 2 | `pathSeverity` — the `sensitivePortsCovered` check deleted | RED. `Tests: 2 failed, 39 passed, 41 total` — "is critical for a range that COVERS a sensitive port, not only one that lands on it"; "puts the worst first". |
| 3 | `rankPaths` — severity comparator reversed | RED. `Tests: 1 failed, 40 passed, 41 total` — "puts the worst first — a database on the internet above an open 443". |
| 4 | `describeAttachment` — the load balancer lookup replaced by an empty list | RED. `Tests: 1 failed, 40 passed, 41 total` — "names the load balancer, which the network reader alone cannot see". |
| 5 | `unattachedCandidates` — the `loadBalancersRead` guard disabled | RED. `Tests: 1 failed, 40 passed, 41 total` — "names no candidate at all while the load balancer listing is unread". |
| 6 | `servingVerdict` — `tally.groupsUnreadable > 0` dropped from the partly-unknown condition | RED. `Tests: 1 failed, 40 passed, 41 total` — "cannot say all-healthy while one target group's health is unreadable". |
| 7 | `unhealthyTargets` — `reasonCode` defaulted to an empty string | RED. `Tests: 2 failed, 39 passed, 41 total` — "keeps AWS's reason code verbatim"; "carries a missing reason code as null, never as an empty string". |
| 8 | `plaintextListeners` — both arms pushed to `confirmed` | RED. `Tests: 1 failed, 40 passed, 41 total` — "is only a finding when this engine established there is no redirect anywhere". |
| 9 | `classifySubnet` — reachability overridden from the `Name` tag | RED. `Tests: 2 failed, 39 passed, 41 total` — "is decided by the route table even when the name says the opposite"; "counts a VPC's subnets by their route-table verdict". |
| 10 | `leadAnswer` — the truncated guard disabled | RED. `Tests: 1 failed, 40 passed, 41 total` — "refuses to say closed when the security-group walk stopped at its page cap". |

All ten restored. A grep for disabled-guard shapes over
`src/app/platform/network/` returns nothing, and the suite is green again at
`Tests: 41 passed, 41 total`. Mutations 5 and 10 deliberately used the
disabled-guard shape this programme was called in to fix; both were reverted in
the same minute and that grep is the check.

### What is NOT closed, and is not claimed

- **No navigation entry.** `tests/architecture/shell-separation.test.mjs`
  requires every nav destination to be a route the console serves; this route is
  `/platform/network` and adding it to the nav belongs to the navigation agent.
- **`e2e/network-surface.spec.ts` has not been executed.** It needs a running
  Studio on `PLAYWRIGHT_BASE_URL` (default `http://localhost:3100`) with
  `PLATFORM_OPERATORS` and `PLATFORM_OPERATOR_SECRET` set; neither is present in
  this working tree. The spec is written and type-checks; it is not reported as
  passing.
- **`e2e/layout.spec.ts` does not yet list `/platform/network`.** That file is
  not this agent's, so the route is not in its `ROUTES` array and has not been
  measured at 1440 / 1180 / 900 / 320px. The CSS follows the same
  `overflow-wrap: anywhere` and stacking rules the measured routes use, which is
  a reason to expect it to pass and not evidence that it does.
- **Attachment is still not settled.** Every drift row says CANDIDATE and names
  `ec2:DescribeNetworkInterfaces` as the grant that would settle it. The word
  "unused" appears nowhere on the surface.
- **Managed prefix lists are not graded.** A rule whose source is a prefix list
  is shown as that list; `ec2:GetManagedPrefixListEntries` is not held, so
  grading it either way would be a claim nobody made. The page says so.
- **No approval, review, ARN, account id, region, price or date is asserted
  anywhere.** The account in the tests is the all-zero placeholder
  `000000000000`, chosen because no real account can be it.

## STUDIO-110-006 (extension) — one findings pipeline over every source now readable

- Status: PASS for the READ half this item names. Suppression with justification
  and expiry, and the remediation workflow, remain NOT DONE and are unchanged by
  this entry — both are WRITES and belong on the typed-mutation surface
  (STUDIO-080-004), which does not exist. The unchecked `[ ]` on the original
  STUDIO-110-006 row above is left exactly as it is, and is not ticked here.
- Code: `apps/system-studio/src/lib/aws/findings.ts` (the pipeline section, from
  `PIPELINE_SOURCES` down)
- Tests: `apps/system-studio/src/lib/aws/findings.test.ts` — 26 tests, run with
  `npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/findings.test.ts`
- Production callers: `apps/system-studio/src/app/platform/security/page.tsx:154`
  (`await securityFindings()`) and `apps/system-studio/src/lib/aws/inventory.ts:1421`.
  Both reach `securityFindings`, which builds `SecuritySurface.pipeline` on
  every load; nothing here is behind a flag or an unused export.

### Five sources, one shape, and only one of them is an aggregator

Security Hub (already wired) plus four DIRECT readers now in this directory:
`guardduty.ts`, `analyzer.ts`, `ecr.ts` and `compliance.ts`. Each is consumed
through its own module's exported readings — `guardDutyReadings`,
`analyzerReadings`, `ecrReadings`, `complianceReadings` — and none is forked or
stubbed. No new SDK call is made from this file: Security Hub is read once, by
`securityFindings`, and the already-built reading is handed to
`hubContributionFrom` rather than re-read, which the test
"runs the pipeline from the same load the Security Hub table is drawn from"
holds to one `securityhub:GetFindings` call per load.

Security Hub INGESTS GuardDuty. Concatenating the two counts the same threat
twice and a doubled critical count is a number an operator plans against, so
rows are keyed on **resource ARN + finding type** and collapsed. When more than
one source reported a row that is recorded rather than discarded —
`NormalisedFinding.seenBy`, `corroborated` and a `corroboration` sentence — and
every contributing record survives whole in `contributions`. A record missing
either half of the key cannot be joined at all and gets `unjoinable::<source>::<id>`,
which provably collides with nothing: guessing that two ARN-less findings are the
same finding is how a real one disappears.

### Severity is one scale, with each source's own value beside it

The normalised scale is `SeverityBand`, IMPORTED from `guardduty.ts` rather than
re-declared, so there is one vocabulary and not two that drift. Every
contribution carries `native`: the source's own scale, its value verbatim, its
numeric form where it has one, and the sentence describing how the mapping was
made. Access Analyzer and AWS Config publish NO severity, so their rows are
`UNRANKED` — which sorts ABOVE critical — rather than being assigned a band this
engine chose. ECR's `UNDEFINED` and an unlabelled ASFF finding are UNRANKED for
the same reason; reading either as "low" is how an unscored critical is buried.

### A source that is not enabled contributes a marker, never zero findings

`SourceContribution.state` is `NOT_CHECKED` for a GuardDuty region with no
detector, an account with no analyzer, a denied ECR listing and a Config
recorder that is not evaluating. `notCheckedContribution` is the ONLY
constructor for that arm, it takes the caveat as an argument, and it is the only
place `findings: []` is assigned on it — so "never zero findings" is a property
of the code rather than of this paragraph. A source can also answer PARTLY
(`REPORTED` with caveats): a repository with `scanOnPush` off, a detector whose
findings were refused, a rule that has evaluated nothing. Dropping the whole
source would hide what it did return; reporting it clean would hide the hole.

### Every construction site of the changed type, named

The only exported type this change widened is `SecuritySurface`, which gained
ONE field, `pipeline`, and it is REQUIRED rather than optional — an optional
field a caller omits is invisible to `tsc` at the site that omits it. Grepped
across `apps/`, `tests/` and `tools/`:

- `SecuritySurface` has NO object-literal construction site outside
  `findings.ts`. Its consumers — `src/app/platform/security/page.tsx:154` and
  `src/lib/aws/inventory.ts:1421` — receive the value from `securityFindings`
  and cannot omit a field.
- `SecurityFinding` gained NOTHING. Its two object-literal construction sites,
  `src/app/platform/security/posture.test.ts:62` and
  `e2e/security-page-logic.spec.ts:49`, are untouched and still compile; the
  ASFF fields the pipeline needed live in a side map (`HubExtra`) keyed by the
  dedupe key precisely so those two files were not dragged into this change.
- `FindingSource`, `Severity` and `SourceState` gained nothing. Consumers
  checked: `src/app/platform/security/answer.ts:42`, `posture.ts:47`,
  `posture.test.ts:27`, `e2e/security-page-logic.spec.ts:22`.
- `e2e/security-page-logic.spec.ts:365` and `:381` pass `duplicatesRemoved` to
  `provenanceOf`'s own input type in `answer.ts:379`, not to `SecuritySurface`.
  Read, and not a construction site of a type this change touches.

### Evidence

- `npx tsc --noEmit -p apps/system-studio/tsconfig.json` — no error in
  `findings.ts` or `findings.test.ts`. Errors in other agents' in-flight files
  (`src/app/platform/identity/page.tsx`) were present before this change and are
  not claimed as fixed.
- `npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/findings.test.ts`
  — `Test Suites: 1 passed, 1 total` / `Tests: 26 passed, 26 total`.
- The stand-in AWS client answers eleven capabilities with the shapes the real
  SDK returns and can fail each INDEPENDENTLY, including the shapes that trip
  naive readers: `guardduty:ListDetectors` OMITS `DetectorIds` when there are
  none, `ecr:DescribeRepositories` OMITS `repositories`, and
  `access-analyzer:ListAnalyzers` returns an empty array.

### Mutations applied to the PRODUCTION path, each red, each restored

Applied to `findings.ts`, run, confirmed red, restored from a byte-identical
copy (md5 `f4da688d10542e380b9c01eb50015cda` before and after), confirmed green.

| # | Mutation | Result |
|---|----------|--------|
| P1 | `dedupeKey` returns the type alone, dropping the resource ARN | RED, 9 of 26 — findings on different resources merged into one row; green on restore |
| P2 | `mergeContributions` sets `corroborated = false` | RED, 3 of 26 — two sources agreeing stopped being reported; green on restore |
| P3 | GuardDuty's no-detector caveat downgraded `NOT_ENABLED` → `UNVERIFIED` | RED, 1 of 26 — a region nothing is watching read as merely unverified; green on restore |
| P4 | GuardDuty's `native.value`/`native.numeric` nulled | RED, 1 of 26 — the mapping became unauditable; green on restore |
| P5 | Access Analyzer rows given `severity: "HIGH"` | RED, 1 of 26 — a band this engine invented for a source publishing none; green on restore |
| P6 | `PRIMARY_RANK.guardduty` 0 → 9, so the aggregator outranks the direct reader | RED, 2 of 26 — the detector id and occurrence count lost from the merged row; green on restore |
| P7 | `assemblePipeline` returns a clean REPORTED contribution for a source nobody supplied | RED, 1 of 26 — a dropped source read as a clean one; green on restore |
| P8 | merged `firstSeen`/`lastSeen` taken from the primary instead of `earliest`/`latest` | RED, 1 of 26 — the corroborated row lost the earlier sighting; green on restore |
| P9 | `hubSeverity`'s default arm returns `INFORMATIONAL` instead of `UNRANKED` | RED, 1 of 26 — an unlabelled finding silently downgraded; green on restore |
| P10 | `mergeSeverity` returns `UNRANKED` unconditionally | RED, 3 of 26 — a ranked source's band discarded; green on restore |

### What is NOT closed, and is not claimed

- **Suppression and the remediation workflow are still not built**, and this
  entry does not tick STUDIO-110-006. Both are writes.
- **Inspector and Macie are read ONLY through Security Hub.** They have no
  direct reader in this directory, so when the hub is off they are reported as
  NOT_ENABLED *through the hub* by the existing `sources` array and contribute
  nothing to the pipeline. The pipeline's five sources are the five that are
  directly readable today; adding a sixth is adding a reader, not editing this
  file's shape.
- **The Access Analyzer external principal and exposed action are not read.**
  That needs `access-analyzer:GetFindingV2`, which the registry does not carry.
  Every analyzer row says so on its face rather than defaulting them.
- **The failing RESOURCES behind a Config rule are not named.** That needs
  `config:GetComplianceDetailsByConfigRule`, which is not held; the finding
  attaches to the rule ARN and states the limit.
- **ECR basic-vs-enhanced scanning coverage is not readable** and travels as a
  caveat on every ECR row rather than being assumed.
- **No page renders `pipeline` yet.** `pipelineLines` is the funnel a unified
  findings surface will render and is exercised by the tests; the surface that
  prints it is not this agent's file. `securityFindings` builds the pipeline on
  the production path today, so it is reached, not dead — but no screenshot of
  it is claimed.
- **No approval, review, account id, ARN, region, price or date is asserted.**
  The account in the tests is AWS's own documentation placeholder
  `123456789012`; every ARN, digest, detector id and rule name is obviously
  constructed and no live estate appears.

## STUDIO-IDENTITY-001 — `/platform/identity`: the two doors, and what guards them

**The question the surface answers.** "Who can get into this control plane and
into this account, and what is protecting those doors?" The lead is a COUNT of
principals that can administer the platform, because that is the one number
spanning both doors: the Cognito pool that gates this console, and IAM.

**Composed from five readers, through their public entrypoints only.**
`cognitoReadings()`, `iamPosture()`, `analyzerReadings()`, `keyReadings()` and
`secretReadings()`. The surface imports no SDK package, no `lib/aws/client`, no
`lib/aws/mutate` and no Prisma client; readers are the only path to AWS. The five
are awaited sequentially rather than through `Promise.all`, because they share
the throttle budget in `lib/aws/throttle.ts` and a THROTTLED panel on this page is
the question left unanswered.

**The rule the page is built around.** *An absence of findings from a control
that is not running is NOT a pass.* `GuardState` has five arms and exactly one —
`CHECKED_CLEAN` — is protection. `isPass` is the only place that decision is
made. An account with no Access Analyzer is `NOT_RUNNING`, never
`CHECKED_CLEAN`, and renders in a "Not protection" card placed ABOVE the
findings, with the reason carried as a WORD (`GUARD_WORDS`) and not as a colour.

**The 2026-08-13 audit.** A migration reissued a shared secret as a PERMANENT
password with pool MFA left OPTIONAL, and nothing in the console could see it.
Both are now guards: `mfaVerdict` maps `optional` to `FINDINGS` — a second factor
nobody is required to enrol is the same protection as none — and
`guardFromOperatorRoster` raises the reader's `neverForcedAPasswordChange`
suspicion with its own disproving caveat carried alongside it.

**What it never renders.** No password, token, client secret or raw user
attribute beyond the sign-in identifier. Access key IDs *are* printed: an id is
not a credential, and `aws iam update-access-key --access-key-id …` takes one.

### Mutations applied to the PRODUCTION path, each red, each restored

| # | Mutation | Result |
|---|---|---|
| 1 | `isPass` widened to `state === "CHECKED_CLEAN" \|\| state === "NOT_RUNNING"` | RED. `Tests: 3 failed, 38 passed, 41 total` — "isPass admits CHECKED_CLEAN and nothing else"; "an account with NO Access Analyzer is NOT_RUNNING, never CHECKED_CLEAN"; "ONE guard that is not running takes Clear off the page". |
| 2 | `analyzerVerdict` — `no-analyzer` arm mapped to `CHECKED_CLEAN`, findings `0` | RED. `Tests: 2 failed, 39 passed, 41 total` — "an account with NO Access Analyzer is NOT_RUNNING, never CHECKED_CLEAN"; "ONE guard that is not running takes Clear off the page". |
| 3 | `mfaVerdict` — `optional` arm mapped to `CHECKED_CLEAN`, findings `0` | RED. `Tests: 2 failed, 39 passed, 41 total` — "MFA OPTIONAL on the console's pool is a FINDING, not a footnote"; "a finding outranks a gap and reaches At risk". |
| 4 | `identityVerdict` — `if (false && notChecking.length > 0)` on the second branch | RED. `Tests: 1 failed, 40 passed, 41 total` — "ONE guard that is not running takes Clear off the page". |
| 5 | `administratorCount` — `if (false && uncertain > 0)`, dropping the floor qualifier | RED. `Tests: 1 failed, 40 passed, 41 total` — "an uncertain account makes the count a floor rather than dropping out of it". |
| 6 | `guardFromKeys` — incomplete rotation posture reported `CHECKED_CLEAN` | RED. `Tests: 1 failed, 40 passed, 41 total` — "a refused KMS listing is UNREADABLE, and an incomplete posture is PARTIAL". |
| 7 | `guardsFromIam` — a refused IAM read reported `CHECKED_CLEAN` with findings `0` | RED. `Tests: 1 failed, 40 passed, 41 total` — "a refused IAM read makes BOTH IAM guards UNREADABLE with no count". |
| 8 | `guardFromSecrets` — unknown posture reported `CHECKED_CLEAN` with findings `0` | RED. `Tests: 1 failed, 40 passed, 41 total` — "an unknown secrets posture is UNREADABLE, never a clean estate". |

All eight restored; the suite is green again at `Tests: 41 passed, 41 total`, and
a grep for disabled-guard shapes (`false &&`, `|| true`, `{true ?`, `// MUTATION`)
over `src/app/platform/identity/` returns nothing. Mutations 4 and 5 deliberately
used the disabled-guard shape this programme exists to fix; both were reverted in
the same minute and that grep is the check.

### A test that could not fail, found by mutating it

`e2e/identity-surface.spec.ts` › "the IAM tables are not drawn from a read that
did not answer" anchored on `page.indexOf("{iam.posture ? (")` over the RAW file.
The explanatory comment above the badge in `page.tsx` quotes that exact string,
so `indexOf` matched the COMMENT at an index earlier than the table. Replacing
the real guard with `{true ? (` left the test GREEN — it proved nothing about the
code it named. Fixed by anchoring on `routeCode("page.tsx")` (comments stripped).
Re-applying `{true ? (` then failed at line 309 as it should; restored, and the
structural suite is green at `10 passed`.

### Evidence

- `npx tsc --noEmit -p apps/system-studio/tsconfig.json` — no error in
  `src/app/platform/identity/**` or `e2e/identity-surface.spec.ts`. One error
  remains in a sibling agent's in-flight `app/platform/messaging/reach.ts`.
  A pre-existing JSX syntax error in this route (a `{/* … */}` JSX comment placed
  inside the `headerAside` PROP expression container, which is JavaScript and not
  JSX children) reddened the whole project and is fixed.
- `npm run test --workspace apps/web -- --ci src/app/platform/identity/doors.test.ts`
  — `Test Suites: 1 passed`, `Tests: 41 passed, 41 total`.
- `npx playwright test e2e/identity-surface.spec.ts --grep "the identity route's own files"`
  — `10 passed`.

### What is NOT closed, and is not claimed

- **No navigation entry.** `tests/architecture/shell-separation.test.mjs` requires
  every nav destination to be a route the console serves. This route is
  `/platform/identity`; adding it to the nav belongs to the navigation agent.
- **The seven browser tests in `e2e/identity-surface.spec.ts` have not run.** They
  need a running Studio on `PLAYWRIGHT_BASE_URL` (default `http://localhost:3100`)
  with `PLATFORM_OPERATORS` and `PLATFORM_OPERATOR_SECRET` set; none is present in
  this working tree. They are written and they type-check. They are NOT reported
  as passing.
- **`e2e/layout.spec.ts` does not list `/platform/identity`.** That file is not
  this agent's, so the route has not been measured at 1440 / 1180 / 900 / 320px.
  The stylesheet uses only tokens, carries no physical direction, no colour, no
  font size and no radius, stacks its two-column list below 30rem and opts every
  identifier into `overflow-wrap: anywhere` — a reason to expect it to pass, and
  not evidence that it does. The same applies to `e2e/preferences.spec.ts` and its
  AA-contrast audit.
- **No approval, review, ARN, account id, region, price or date is asserted
  anywhere.** The account used in the tests is the all-zero placeholder
  `000000000000`, chosen because no real account can be it.
- **Nothing on this surface writes.** Every module it reads through is read-only;
  a finding here is made visible so that a human can act on it.

## STUDIO-070-004 (MESSAGING surface) — can this platform reach people, and is anything queued that nobody is processing

**No checkbox is moved by this entry.** The SES, SQS, EventBridge and CloudWatch
adapters were already ticked by their own rows. This is a SURFACE that composes
them; ticking an adapter line again on the strength of a page that renders it
would be a sign-off nobody gave.

### The route

`/platform/messaging` — `apps/system-studio/src/app/platform/messaging/page.tsx`,
its pure decision module `reach.ts`, and `messaging.module.css`.

The production caller is the Next.js App Router itself: `page.tsx` is the default
export of a `force-dynamic` App Router segment, so a request to
`/platform/messaging` renders it server-side. It is gated by
`operatorConfigProblems()` and `isOperator(session?.user?.email)` before any AWS
read is issued, exactly as the sibling platform routes are. `reach.ts` is reached
from `page.tsx` (14 imported symbols), from `reach.test.ts` and from
`e2e/messaging-page-logic.spec.ts`; nothing else in the repository imports it, so
no consumer outside this directory can be broken by a change to its types.

### Readers consumed, and how

Four live reads, one clock. `const now = new Date()` is taken once and passed to
all four as `{ now: clock }`, so the four readings are AS OF the same instant and
the CloudWatch window ends where the SES reading was taken.

- `ses.ts` — `sesReadings`, `mailabilityVerdict`. The sandbox arm is ranked as its
  own headline rather than a caveat under a green badge.
- `sqs.ts` — `queueReadings`, plus the `DeadLetterState` it derives from redrive
  policies rather than from any queue's name.
- `metrics.ts` — the one number `sqs.ts` says out loud it cannot read,
  `AWS/SQS ApproximateAgeOfOldestMessage`, plus `AWS/SES Send` for the measured
  send rate the 24-hour quota is spent against.
- `eventbridge.ts` — the rules, handed `ses.identity` rather than resolving STS a
  second time.

The metric read is sequenced AFTER the queue listing because its queries are
derived from it: a queue the listing never returned is never asked about, and its
age renders `not-read` rather than as a zero.

### The two orderings this surface exists to get right

1. **A sandbox account is not "mail works."** `mailabilityVerdict`'s `CAN_SEND`
   arm with a non-null `recipientRestriction` becomes `REACHES_ONLY_VERIFIED`,
   toned `bad`. SES accepts the call and drops the message, and nothing in the
   application ever hears about it.
2. **A read that did not answer never renders as clear.** `CLEAR` is reachable
   only when every reading the page depends on actually answered — including each
   queue's individual depth read. A refused `sqs:ListQueues` renders `UNKNOWN`,
   never "nothing is waiting".

A dead-letter queue holding anything, and a DISABLED rule that still carries a
schedule, each hoist their card to directly under the answer.

### Mutations applied to the PRODUCTION path, each red, each restored

| # | File | Mutation | Result |
|---|---|---|---|
| 1 | `reach.ts` | `composeQueues` — `stalled` no longer requires a MEASURED age (`age.kind === "seconds"` dropped) | RED. `Tests: 2 failed, 41 passed, 43 total` — "stalled needs a MEASURED age — an unknown age is never a stall"; "a fresh backlog is work in progress, not a defect". |
| 2 | `reach.ts` | `processingAnswer` — the `PARTLY_UNKNOWN` gate disabled as `if (false && unreadable.length > 0)` | RED. `Tests: 2 failed, 41 passed, 43 total` — "one reading answering and one not is PARTLY_UNKNOWN — still never CLEAR"; "an unreadable queue DEPTH also blocks CLEAR". |
| 3 | `reach.ts` | `reachAnswer` — the sandbox check disabled as `if (false && verdict.recipientRestriction !== null)` | RED. `Tests: 1 failed, 42 passed, 43 total` — "a verified identity in a SANDBOX account is NOT 'reaches anyone'". |
| 4 | `reach.ts` | `ruleRank` — the half-step for a disabled SCHEDULED rule removed (`return base`) | RED. `Tests: 1 failed, 42 passed, 43 total` — "a disabled SCHEDULED rule is first — above every other disabled rule". |
| 5 | `reach.ts` | `disabledSchedules` — the `row.schedule !== null` filter dropped | RED. `Tests: 1 failed, 42 passed, 43 total` — "a disabled rule with no schedule is not a stopped schedule". |
| 6 | `page.tsx` | the suppression panel prints `entries.map((e) => e.address)` instead of `entries.length` | RED. `messaging-page-logic.spec.ts:78` — "the page never prints a suppressed recipient's address", `Expected pattern: not /\.address\b/`. |

All six restored. `diff` against a pristine copy taken before the first mutation
reports both files IDENTICAL, and the suites are green again at
`Tests: 43 passed, 43 total` (jest) and `11 passed` (Playwright).

Mutations 2 and 3 deliberately used the `false &&` disabled-guard shape this
programme was called in to fix; both were reverted in the same minute, and a grep
for `false &&`, `|| true`, `@ts-ignore`, `as any` and `.skip` over
`src/app/platform/messaging/` returns nothing.

### A finding about the verification itself

The first `npx tsc --noEmit -p apps/system-studio/tsconfig.json` of this session
reported errors ONLY in a sibling agent's `platform/identity/page.tsx` — four
syntax errors — and nothing in this directory. That clean reading was NOT
trustworthy: a deliberate `const __probe: number = "not a number"` appended to
`reach.ts` was ALSO not reported while those syntax errors stood. Once the
sibling file parsed, the same probe was reported immediately as
`reach.ts(992,7): error TS2322: Type 'string' is not assignable to type 'number'`.

A parse error anywhere in the project can therefore suppress semantic diagnostics
for every other file in it, and "tsc printed nothing about my file" is not
evidence that tsc checked it. The probe was removed and the final run is clean
across the whole project.

### What is NOT closed, and is not claimed

- **No navigation entry.** `/platform/messaging` is absent from `Nav.tsx`, which
  is not this agent's file. `tests/architecture/shell-separation.test.mjs` passes
  at `# pass 8 # fail 0`, and `tests/security/operator-plane-content.test.mjs` at
  `# pass 5 # fail 0`; adding the destination belongs to the navigation agent.
- **`e2e/layout.spec.ts` does not list `/platform/messaging`.** That file is not
  this agent's, so this route has NOT been measured at 1440 / 1180 / 900 / 320px
  and its contrast has not been measured by `e2e/preferences.spec.ts`. The CSS
  carries `overflow-wrap: anywhere` on every identifier and prose cell, holds no
  colour at all, and stacks rather than rows the identity line — which is a
  reason to expect it to pass and is not evidence that it does.
- **The route has never been rendered against a live estate.** Every assertion
  here is either a pure decision over constructed readings or a property of the
  source. No page-level Playwright run was made: it needs a Studio on
  `PLAYWRIGHT_BASE_URL` (default `http://localhost:3100`) with
  `PLATFORM_OPERATORS` and `PLATFORM_OPERATOR_SECRET` set, and neither is present
  in this working tree.
- **No suppressed address is rendered, by design and by test.** `ses.ts` carries
  real recipients' addresses deliberately; this surface prints counts by reason
  and by domain, and mutation 6 is the proof that the guard fails when broken.
- **No approval, review, ARN, account id, region, price or date is asserted
  anywhere.** The fixtures use the documentation-reserved account `123456789012`,
  the reserved TLD `.invalid`, and `example-region-1`, which is not a region AWS
  has.

## STUDIO-DATA-001 (DATA surface) — where this platform keeps state, whether it is protected, and what is about to interrupt it

### The route

`/platform/data`, served by `apps/system-studio/src/app/platform/data/page.tsx`
— an async server component, `export const dynamic = "force-dynamic"`, gated on
`operatorConfigProblems()` and `isOperator()` exactly as the sibling platform
routes are. The Next.js App Router is the production caller: the file's default
export IS the route handler, and `./answer.ts` is imported by it and by nothing
else except its own test.

The page leads with the question in the operator's words, as
`data-testid="page-question"`, above every piece of apparatus that answers it.

### Readers consumed, and how

Five, all through `src/lib/aws/`, none read directly from the surface:

- `dynamodb-tables.ts` — `tableReadings()`. The only reader that can say whether
  the TENANT REGISTRY is recoverable, so its `registry: RegistryProtection` is
  ranked first everywhere on the page: `RISK_RANK.REGISTRY_UNRECOVERABLE` is 0
  and `tableRows` pins the registry row at index 0 however clean it is.
- `database.ts` — `databaseReadings()`. Pending maintenance with the date AWS
  will FORCE it, plus failover / restart / low-storage events.
- `buckets.ts` — `bucketPosture()`. Public-access block, policy status,
  encryption, versioning. PUBLIC ranks hardest of the bucket findings at rank 1.
- `elasticache.ts` — `elastiCacheReadings()`. Encryption on both legs and
  single-node clusters with no failover.
- `retained.ts` — `retainedReadingsForTenant()`, for the backup VAULT listing.

The four estate-wide loads run in one `Promise.all`. Identity and the tag index
are handed to `retained.ts` rather than re-resolved, because `resolveIdentity`
caches only an ACTUAL answer and the estate this console must boot in is one
where STS does not answer at all.

`CUSTOMER_TENANT_BINDINGS` is the slug source, never the unfiltered
`TENANT_BINDINGS`. With no customer bound the vault call is not made and the
panel says so in words rather than rendering an empty vault list.

### The honest limit, stated on the page rather than glossed

The AGE of a recovery point inside an AWS Backup vault is NOT on this page.
`retained.ts` is the only reader in the console that lists them; it filters
recovery points to one tenant's `tenure:tenant` tag and does not carry AWS's
`CreationDate` or `ResourceArn` through into `RetainedResource`, so there is no
honest way to age them from here. The requirement asked for "the age of the
newest recovery point per protected resource"; what is delivered is the newest
restorable time for the two stores that carry one natively — RDS automated
backups and DynamoDB point-in-time recovery, both continuous — and a paragraph
on the card naming the exact two fields whose addition to a module this surface
does not own would lift the limit. It is recorded as a gap, not as an apology,
and the card does not imply it is a statement about vault contents.

### The guard that must never be switched off

`verdictOf` returns `PROTECTED` only when `unknowns` is empty. A finding still
outranks an unknown — a public bucket is public whether or not the cache read
answered — but the ABSENCE of findings is not a pass while anything went unread.
This console's own e2e estate cannot reach an AWS endpoint, so every read there
lands in a valueless arm of `AwsRead`; a page deriving its badge from
`findings.length === 0` would render "everything is protected" from nine
refusals, pass every screenshot, and be wrong on the only morning it mattered.

`UNKNOWN` is also ranked at 7, deliberately WORSE than `ROUTINE` at 8: a fact
this console could not read must never sort below, or read calmer than, a queued
action AWS told us about that nobody has to act on.

### Mutations applied to the PRODUCTION path, each red, each restored

Every one applied to `src/app/platform/data/answer.ts` — the module the route
imports, not a copy — run through `npm run test --workspace apps/web -- --ci
apps/system-studio/src/app/platform/data/answer.test.ts`, then reverted. The
restored file was confirmed byte-identical to a pre-mutation backup by `diff`,
and the suite returns to `Tests: 28 passed, 28 total`.

1. `found === "PROTECTED" && !complete` becomes `found === "PROTECTED" && false && !complete`
   — the PROTECTED guard, switched off in the exact shape this programme has
   shipped five times. RED: `× returns UNKNOWN, not PROTECTED, when nothing was
   found and something went unread`. `Tests: 1 failed, 27 passed`.
2. `RISK_RANK.REGISTRY_UNRECOVERABLE: 0` becomes `2` — the registry demoted below
   a public bucket. RED, two tests: `× ranks REGISTRY_UNRECOVERABLE above every
   other risk` and `× leads with the registry when its point-in-time recovery is
   off`. `Tests: 2 failed, 26 passed`.
3. `UNKNOWN: 7, ROUTINE: 8` becomes `UNKNOWN: 8, ROUTINE: 7` — a silence made to
   read calmer than a known-benign queued action. RED: `× is PROTECTED for an
   empty set, and the lowest rank otherwise`, on the explicit assertion
   `worstRisk(["ROUTINE", "UNKNOWN"]) === "UNKNOWN"`. `Tests: 1 failed, 27 passed`.
4. `maintenanceRows` forced-first comparator signs inverted (`return -1` swapped
   with `return 1`) — the date AWS forces an action pushed to the bottom of the
   table. RED: `× sorts forced actions first, by the date AWS applies them`.
   `Tests: 1 failed, 27 passed`.
5. `if (gaps.length > 0)` becomes `if (false && gaps.length > 0)` in `bucketRows`
   — a bucket with one public-access-block flag off silently stops being PUBLIC.
   RED: `× calls one missing block flag PUBLIC, and names which flag`.
   `Tests: 1 failed, 27 passed`.
6. `registryFinding` `"no-point-in-time-recovery"` returns risk `UNRECOVERABLE`
   instead of `REGISTRY_UNRECOVERABLE` — the fleet's own record of itself
   demoted to one unrecoverable store among several. RED: `× leads with the
   registry when its point-in-time recovery is off`. `Tests: 1 failed, 27 passed`.

No mutation was left in place. `grep` for `false &&`, `&& false` and `|| true`
across the route directory and the spec returns nothing.

### Evidence

- `npx tsc --noEmit -p apps/system-studio/tsconfig.json` — zero errors in
  `src/app/platform/data/**` and `e2e/data-surface.spec.ts`. Errors remain in
  `src/app/platform/identity/page.tsx` (a parse error) and in `src/lib/aws/tags.ts`
  / `tags.test.ts` (`'indexRegion' does not exist in type 'CoverageQuestion'`);
  both are other agents' files, mid-flight, and neither is claimed here. Because
  a parse error can suppress semantic diagnostics project-wide, the clean result
  for this route is stated as "no diagnostic was emitted for these files", not as
  proof the project is clean.
- `npm run test --workspace apps/web -- --ci apps/system-studio/src/app/platform/data/answer.test.ts`
  — `Test Suites: 1 passed`, `Tests: 28 passed, 28 total`.
- `node --test tests/security/operator-plane-content.test.mjs` — `# pass 5 # fail 0`.
  The route imports no Prisma client; it reads AWS and nothing else.
- `node --test tests/architecture/shell-separation.test.mjs` — `# pass 8 # fail 0`.
- `npx playwright test e2e/data-surface.spec.ts` — `1 passed, 7 skipped`. The one
  that ran is the stylesheet rule; the seven that skipped are browser tests, below.

### What is NOT closed, and is not claimed

- **The route has never been rendered.** The seven browser tests in
  `e2e/data-surface.spec.ts` SKIPPED. They need a Studio on
  `PLAYWRIGHT_BASE_URL` (default `http://localhost:3100`) with
  `PLATFORM_OPERATORS` and `PLATFORM_OPERATOR_SECRET` set; neither is present in
  this working tree. Every claim above is a pure decision over constructed
  readings or a property of the source. The page has NOT been observed to render.
- **No navigation entry.** `/platform/data` is absent from `Nav.tsx`, which is
  not this agent's file. Adding the destination belongs to the navigation agent.
- **`e2e/layout.spec.ts` does not list `/platform/data`.** That file is shared and
  was not edited. Its four widths and its overlap and overflow assertions are
  therefore reproduced inside `e2e/data-surface.spec.ts` for this route — which
  is a reason to expect the shared suite to pass once the route joins its
  `ROUTES` array, and is not evidence that it does. `e2e/preferences.spec.ts` has
  likewise not measured this route's contrast; the stylesheet holds no colour at
  all, which is asserted, and that is a precondition rather than a result.
- **Vault recovery-point ages are absent by design**, for the reason recorded
  above. The card states the limit where a reader would otherwise assume the
  opposite.
- **No approval, review, ARN, account id, region, price or date is asserted
  anywhere** in the route, its test or its spec.

---

## The fleet-health verdict — six readers composed into one ranked answer

**File**: `apps/system-studio/src/lib/aws/health.ts` (+ `health.test.ts`)
**Shape of the change**: `git diff --numstat` reports **1424 insertions, 0
deletions**. Not one pre-existing line of this module was altered, so
`FleetReadings`, `ObservationTarget`, `ObserveOptions`, `observationsFor`,
`observeFleet`, `certificateObservation`, `alarmObservation` and
`backupObservation` have the exact fields and signatures they had. That is the
answer to "did you widen a shared type": nothing existing was widened, and the
construction sites checked by name are
`apps/system-studio/src/app/tenants/page.tsx` (`ObservationTarget`),
`apps/system-studio/src/app/tenants/fleet-view.ts` and its test
(`FleetReadings`), `apps/system-studio/src/app/tenants/[slug]/page.tsx`
(`observeFleet`) and `apps/system-studio/e2e/fleet-health-logic.spec.ts` (nine
pre-existing exports). The new types — `FleetHealthSources`,
`FleetHealthReaders`, `FleetHealthVerdict`, `VerdictFinding`,
`VerdictBlindSpot`, `FleetHealthOptions` — are constructed today only in
`health.ts` itself and in `health.test.ts`. Every field of `FleetHealthSources`
and every method of `FleetHealthReaders` is REQUIRED and nullable rather than
optional, so a seventh reader breaks every construction site at compile time
instead of silently dropping out of the verdict.

### The five ranking rules, and where each one lives

1. **AWS outranks our own alarms.** `FINDING_KINDS` opens with
   `aws-health-affecting-us` and `aws-health-open-service-in-use`; the second
   only fires when `touchesServiceInUse` matches the event against
   `servicesInUse()`, which is derived from resources readers actually returned
   and is EMPTY for a denied reader. An open public event that cannot be ruled
   in or out lands in `couldNotSee`, not in the findings.
2. **A muted alarm outranks OK.** `ALARM_FINDING.DISABLED` →
   `alarm-actions-disabled` → `UNTRUSTED`, which sits above `CANNOT_SAY` and
   above `HEALTHY`.
3. **Zero healthy targets outranks an alarm that has not fired.**
   `no-healthy-targets` is ranked above `alarm-firing` in `FINDING_KINDS`; both
   `no-targets` and `none-serving` map to it.
4. **A metric with NO DATA is never a zero.** `no-datapoints` becomes a finding
   whose sentence says so in words; `not-read` becomes a gap instead, so the two
   can never be averaged together.
5. **A denied or throttled read degrades to "cannot say", never to OK.**
   `HEALTHY` requires `findings` empty, `couldNotSee` empty AND `basedOn`
   non-empty, all three at once.

### A guard that could not fail, found and replaced

`metricQueriesFor` carried `if (!byArn.has(lb.arn)) continue` under a comment
claiming it "proves this one is the group's own". `byArn` was built from the
same list `targetGroupsOf` walks, so the answer was always yes — the guard was
inert. It is replaced by
`if (group.loadBalancerArns.length > 0 && !group.loadBalancerArns.includes(lb.arn)) continue`,
which is AWS's own attachment list rather than a restatement of this reader's
nesting. It matters because CloudWatch answers a query for a `TargetGroup` +
`LoadBalancer` pair it has never published with an EMPTY series, and an empty
`HealthyHostCount` is indistinguishable from zero healthy hosts — rule 3 would
then report a fabricated outage. Mutation M9 below is the proof the old guard
was inert: reinstating it verbatim produces exactly the same single failure as
deleting the new guard outright (M8).

### Mutation proof — 14 applied one at a time, 14 killed

Each was applied to `health.ts` (never to the test), the suite was run, and the
file was restored and re-hashed. `sha256(health.ts)` before and after the whole
run: `567e4f18e5b7f6e75ca887c69dc0553ce213e743a6be1fc999933d2117105918` —
identical. Suite green on restore: **46 passed, 0 failed**.

| # | Mutation | Result |
|---|---|---|
| M1 | `"aws-health-affecting-us": "AWS_INCIDENT"` → `"OUR_INCIDENT"` | RED — 2 failed |
| M2 | `DISABLED: "alarm-actions-disabled",` commented out | RED — 1 failed |
| M3 | `"no-healthy-targets"` moved below `"alarm-firing"` in `FINDING_KINDS` | RED — 1 failed |
| M4 | `findings.push({ kind: "metric-no-data", …})` → `void 0 && findings.push(…)` | RED — 1 failed |
| M5 | "This is not a value of zero:" struck from the no-data sentence | RED — 1 failed |
| M6 | `: couldNotSee.length > 0` → `: false && couldNotSee.length > 0` | RED — 8+ failed |
| M7 | `"Nothing in this pass went unread."` → `"All clear."` | RED — 1 failed |
| M8 | the new `loadBalancerArns` attachment guard deleted | RED — 1 failed |
| M9 | the new guard replaced by the OLD `byArn.has(lb.arn)` guard verbatim | RED — same 1 failure as M8, which is the proof the old guard was inert |
| M10 | `if (row.verdict === "UNAUTHORIZED" \|\| …)` → `if (false && (…))` | RED — 1 failed |
| M11 | `if (!isIncident(task.stopCause)) continue` → `if (false && …)` | RED — 1 failed |
| M12 | `database-interrupting-maintenance` swapped below `database-pending-maintenance` | RED — 1 failed |
| M13 | `sources.database && itemsOf(…).length > 0` → `sources.database` | RED — 3 failed |
| M14 | `if (surface.rows.length === 0)` → `if (false && …)` | RED — 1 failed |

M6 is the important one: it is the exact shape of the defect this programme was
told about — a guard switched off with `false &&` that leaves the suite reading
GREEN. It does not: eight cases fail, because the "a gap never resolves to OK"
rule is asserted at eight different entry points rather than once.

### What is NOT done, said plainly

- **The verdict has no production caller yet.** `health.ts` IS reached in
  production — `app/tenants/page.tsx` and `app/tenants/[slug]/page.tsx` call
  `fleetReadings`, `observeFleet` and `HEALTH_REFRESH_MS` — but no route calls
  `observeFleetHealth`, `fleetHealthVerdict` or `metricQueriesFor`. Its intended
  consumer is `apps/system-studio/src/app/platform/health/page.tsx`, whose
  `answer.ts` composes two readers (alarms, aws-health) where this composes six.
  That file is a route and was outside this agent's allowlist, so it was not
  touched. Until somebody wires it, this is a proven library with no surface.
- **Nothing here has run against a live estate.** Every case is a pure decision
  over constructed readings. The async case injects a `FleetHealthReaders` whose
  six methods are functions in the test file; no AWS call is made.
- **No approval, ARN, account id, region, price or date is asserted.** The
  fixtures use the documentation-reserved account `123456789012` and constructed
  resource names; no real load balancer, cluster, target group or database is
  named.

## STUDIO-080-010 (continued) — a reading's own placement, reconciled with the resolved identity

Appended to the STUDIO-080-010 section above rather than rewriting it; that
entry's evidence (51 tests, its own fourteen mutations) is the earlier run's and
is left exactly as it was written. This entry records what was added on top and
the mutations re-run against the file as it stands now.

### The gap this closes

Every deep-link arm took a `ConsoleContext` — partition, region, account — and
every surface had only one obvious thing to put in it: the resolved identity.
But an estate is not one region, and thirty readers in `src/lib/aws/` carry a
`{partition, region, accountId}` triple read off the resource's OWN ARN
(`network.ts`, `dynamodb-tables.ts`, `guardduty.ts`, `quotas.ts`, `waf.ts`,
`logs.ts`, `keys.ts`, `secrets.ts`, `trail.ts`, `cdn.ts`, `dns.ts`,
`containers.ts`, `certificates.ts`, `analyzer.ts`, `compliance.ts`, `ecr.ts`,
`elasticache.ts`, `buckets.ts`, `metrics.ts`, `dashboards.ts`, `database.ts`,
`loadbalancer.ts`, `cognito.ts` and the rest), each nullable precisely because
the reader refuses to guess one. A GuardDuty finding in `us-east-1`, linked from
a console whose identity resolved `eu-west-2`, would have opened an `eu-west-2`
page with no such finding — which reads to an operator as "the finding is gone",
the exact failure this module exists to prevent.

`consoleContextForReading(identity, placement)` reconciles the two, and
`resourceConsoleLinkForReading(identity, placement, resource)` is the one call a
surface makes so the reconcile cannot be the step somebody forgets.

The two fields are NOT treated the same way:

| Field | Rule | Why |
| --- | --- | --- |
| `region`, `partition` | a stated value WINS over the identity's | It came off the resource's own ARN, and the reader already fell back to the identity where AWS returned none. Refusing it would hide a resource that exists. |
| `accountId` | a stated value that is not the identity's yields NO LINK | A link to the wrong account is worse than no link. |
| all three | a blank string is treated as absent, not as a value | An empty segment is what a missing identifier looks like once concatenated. |
| stated partition vs stated region | not re-checked here — `render` owns it | One check in one place cannot drift from itself. |

`network.ts` names the account field `ownerId` (that is what `DescribeVpcs`
returns). The mapping is written at the call site — `accountId: vpc.ownerId` —
rather than by renaming a reader's field, and `console-link.test.ts` holds a
type-only bridge function so `tsc` checks it.

### Type change, and every construction site checked

Additive only. `StatedPlacement`, `ConsoleContextOutcome`,
`consoleContextForReading` and `resourceConsoleLinkForReading` are new exports.
No existing exported type gained, lost or widened a field, and no existing
function changed shape or behaviour. The construction sites of the two types a
caller can build were re-read, not assumed:

- `ConsoleTarget` — `src/app/platform/estate/page.tsx:183`
  (`service: "resource-groups"`) and `e2e/aws-unknown-is-not-absent.spec.ts:746-749`
  (four calls, `service: "ecs"`). Unchanged; both outputs asserted byte-identical.
- `ConsoleContext` — constructed only inside this module (`consoleLinkOutcome`
  synthesises one with an empty `accountId` for a service HOME page) and in
  `console-link.test.ts`. A grep for `ConsoleContext` and `ConsoleTarget` over
  `apps/` returns no other file.
- `StatedPlacement` has no construction site outside its own test yet, by
  definition — it is new in this entry.

### Evidence, this run

```
npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/console-link.test.ts
  Test Suites: 1 passed, 1 total
  Tests:       60 passed, 60 total

npx tsc --noEmit -p apps/system-studio/tsconfig.json
  no diagnostic in console-link.ts or console-link.test.ts
  (three diagnostics remain in tags.ts / tags.test.ts — another agent's file, mid-flight)
```

### Mutations re-run against the file as it stands, each red, each restored

Applied to `src/lib/aws/console-link.ts` itself, one at a time, by a harness that
rewrites the original after every run and asserts the restored bytes are
identical (`restoredIdentical: true` on all ten, and on the final restore).

| # | Mutation | Result | First test that caught it |
| --- | --- | --- | --- |
| M1 | `"aws-us-gov": "console.amazonaws-us-gov.com"` becomes `"console.aws.amazon.com"` | RED — 4 failed, 56 passed | three partitions produce three different hosts, and a fourth produces null |
| M2 | `if (regionPartition !== partition) {` becomes `if (false && regionPartition !== partition) {` | RED — 3 failed, 57 passed | a commercial partition holding a China region builds NO link |
| M3 | the `GLOBAL` arm of `render` gains `pairs.push(["region", region])` | RED — 4 failed, 56 passed | IAM: no region in the host, no region in the query |
| M4 | the ARN account check in `arnFits` is prefixed with `false &&` | RED — 1 failed, 59 passed | a certificate in ANOTHER account produces no link |
| M5 | `logsSegment` encodes once instead of twice | RED — 2 failed, 58 passed | a log group name is encoded the way logsV2 reads it — twice, with $ |
| M6 | `if (second.startsWith("iso")) return null` becomes `return "aws"` | RED — 1 failed, 59 passed | an air-gapped region is null, NOT commercial |
| M7 | the stated-account check in `consoleContextForReading` is prefixed with `false &&` | RED — 2 failed, 58 passed | a reading in ANOTHER account produces no link, and names both accounts |
| M8 | `region: statedValue(placement.region) ?? identity.region` becomes `region: identity.region` | RED — 5 failed, 55 passed | a stated region in the same account wins over the identity's region |
| M9 | `COMMERCIAL_ONLY()` returns all three partitions | RED — 1 failed, 59 passed | the two edge services are refused outside the commercial partition |
| M10 | the ECR registry-account check is prefixed with `false &&` | RED — 1 failed, 59 passed | an ECR repository in a different registry account produces no link |

M2, M4, M7 and M10 are deliberately the `if (false && ...)` shape this programme
shipped five of. A grep for that string over `console-link.ts` and
`console-link.test.ts` returns nothing after the run, and the suite is green at
60/60.

### What is NOT closed, and is not claimed

- **`resourceConsoleLink` and `resourceConsoleLinkForReading` still have no
  production caller.** The only production caller of this module remains
  `src/app/platform/estate/page.tsx:17,183,463` — `consoleLink`, `consoleCaveat`,
  `linkablePartitions` — which exercises `render`'s partition table,
  region-to-partition check and scope arms on the live path. The deep-link arms
  are reached only by tests today; the surfaces that will render them are other
  agents' routes in this same batch, and this agent owns no route. Nothing here
  claims a deep link appears on a page.
- **No reader is loaded by this module or its test.** The three reader imports in
  the test are `import type` and are erased before it runs; the module holds no
  AWS client, imports no SDK and issues no call. `src/lib/aws/mutate.ts` is
  untouched.
- **A stated region is trusted as far as the reader's own guarantee, no
  further.** If a reader ever put a literal in that field rather than an
  ARN-derived value, this module would build a link into it. The defence is that
  reader's own tests, not this one's.
- **No approval, review, certification, ARN, account id, region, price or date is
  asserted anywhere.** `123456789012` is AWS's documentation account,
  `210987654321` is its digits reversed, and every UUID is repeated-digit.

### The estate stops being a partial picture — STUDIO-080-001, STUDIO-000-007, STUDIO-000-008

**No checkbox is ticked by this entry.** STUDIO-080-001 asks for the whole
estate; this entry composes every reader this build has into one inventory and
makes its blind spots data. What is still not read is listed at the end.

`inventory.ts` composed four services — ECS, RDS, CloudFront, ACM. Everything the
service programme made readable was invisible to `/platform/estate`, and the page
had no way to say so: a service nobody composed and a service that holds nothing
were both simply not on the page.

It now composes **54 sections**, and `estateCoverage` computes **0 capabilities
with no reader at all** from `CAPABILITIES` rather than from a hand-kept list.

#### The two properties, and where each one lives

| Property | Where | What it refuses to do |
| --- | --- | --- |
| Coverage is data, not an absence | `SectionCoverage`, `CoverageReport` | Five arms — `VISIBLE`, `ABSENT`, `UNKNOWN`, `NOT_COMPOSED`, `NO_READER`. Only `ABSENT` is a claim about the ACCOUNT. A caller renders "we cannot see ECR" from `UNKNOWN` and "there is no ECR" from `ABSENT`; they are different values before they are different pixels. |
| One denied service does not collapse the inventory | `load` / `from` / `resourceSection` | Every reader is `load`ed, never awaited into a bare `Promise.all`. A refused, throttled, broken or contract-refused service degrades to `UNKNOWN` for its own section; every other section stays real. |
| The total names what it excludes | `EstateCount` | `counted` and `excluded` come out of one call and cannot be rendered apart. `text` says "at least" whenever anything was left out. A count that silently omitted a denied service would be a lie with a number on it. |

`SectionContribution` keeps three kinds apart: `resources` (counted), `signal` (a
service read for something that is not a resource — an alarm, a price, a quota),
and `not-composed` (a reader exists and this composition deliberately does not
drive it, with `holdsResources` deciding whether its absence makes the total a
floor). Backup vaults and SSM parameters are `holdsResources: true`, so they are
named in `count.excluded` rather than quietly missing.

#### Cadence — 54 sections, not 54× the calls

`cadencedGateway` collapses identical calls onto one in-flight promise within a
load, and reuses answers between loads for exactly `CAPABILITIES[capability]
.refreshMs` — read from the registry, never retyped. A throttle is never cached
(`isTransient` / `isThrottle`); a denial is, because an IAM policy does not change
between two reads a second apart. `GatewayLedger` reports what the load actually
cost, so a fan-out regression is visible per capability rather than inferred.

#### Mutation proofs — 14 applied, 13 killed, 1 survived and named

Each mutation was applied to `inventory.ts`, the suite was run, and the module was
restored from a pristine copy and re-run green (22/22) before the next.

| # | Mutation | Result | What it proves |
| --- | --- | --- | --- |
| M1 | `coverageOf`'s failing arm returns `{ kind: "VISIBLE", resources: 0 }` | RED — 4 failed, 17 passed | a denial does not render as a service that holds nothing |
| M2 | `load()`'s `try`/`catch` is removed | **GREEN — survived** | see "What is NOT proven" below |
| M3 | the unreadable arm of `estateResourceCount` does `contributing += 1` instead of `excluded.push` | RED — 2 failed, 19 passed | the total names the service it could not read |
| M4 | `holdsResources` is replaced by `false` | RED — 1 failed, 20 passed | a reader this page does not drive is excluded BY NAME |
| M5 | the per-load `thisLoad` dedup is bypassed | RED — 1 failed, 20 passed | identity and the tag index are read once per load, not once per reader |
| M6 | `reusable()` returns `true` | RED — 1 failed, 20 passed | a throttle is never held for the refresh window; a denial is |
| M7 | the no-ARN branch stops pushing to `omitted` | RED — 1 failed, 20 passed | a resource read but not nameable is never dropped silently |
| M8 | `ctx.accountId` fallback becomes a literal account id | RED — 1 failed, 20 passed | a bucket ARN's empty account resolves from identity, never a literal |
| M9 | `estateCoverage` stops pushing `noReader` | RED — 1 failed, 20 passed | NO_READER is computed from the registry, not hand-listed |
| M10 | `refreshMs` becomes the hard-coded `60_000` | RED — 1 failed, 20 passed | every section states the registry's own window |
| M11 | `estateSectionLines` skips the ECS sections | RED — 1 failed, 20 passed | the first four lines stay byte-identical to `estateLines` |
| M12 | the WAF CLOUDFRONT-scope omission stops being recorded | RED — 1 failed, 20 passed | half a service read is stated, not implied by absence |
| M13 | `resourceSection`'s `catch` rethrows instead of `threw(...)` | RED — 1 failed, 20 passed | a resource the published contract refuses takes down its own section only |
| M14 | the count's headline drops the "at least" branch | RED — 2 failed, 19 passed | a floor is never worded as a total |

No `if (false && ...)`, `|| true` or `// MUTATION` stub survives the run: the
module is byte-identical to its pre-mutation copy (`diff` clean) and the suite is
green at 22/22.

#### What is NOT proven, and is not claimed

- **M2 survived.** `load()`'s `catch` is defence against a READER throwing
  outright — an adapter bug, not a service failure. It could not be killed,
  because every reader in this directory funnels its own AWS calls through
  `readAws`, which catches first: a gateway that throws `CredentialsProviderError`
  from every call and from `resolvedRegion` still resolves the whole load with
  every section `UNKNOWN` (that case IS tested). Synthesising a reader-internal
  bug would mean coupling this test to a sibling module's internals. The guard is
  kept and reported unproven rather than deleted or claimed. The same isolation
  property IS proven, through the reachable path, by M13.
- **`from()`'s selector is not defended.** If a sibling reader renamed a field its
  selector reads (`r.pools`, `r.buckets`), the selector would throw outside any
  catch and take the load down. No defensive `catch` was added, because it could
  not be tested either; this is recorded as a known latent path rather than
  papered over.
- **Metric series, Cost Explorer and object versions are deliberately not
  composed**, each with its reason on the section. Metrics needs the caller's own
  queries and every invented query is billed; Cost Explorer is money, not estate,
  and is billed per call.
- **This inventory reads ONE account.** `organizations:ListAccounts` is a signal
  section for exactly that reason.
- **No approval, review, certification, ARN, account id, region, price or date is
  asserted.** `123456789012` is AWS's documentation account.

## STUDIO-070-002 (continued) — attribution across every service, and the three ways an absence lies

`tags.ts` could already tell a tagged resource from an untagged one, and could
already tell "absent from the regional index" from "untagged". It could not tell
either of the other two ways an absence means nothing:

- **another partition.** `tag:GetResources` cannot see across `aws` /
  `aws-us-gov` / `aws-cn`.
- **another account.** It indexes ONE account — the caller's. A resource in a
  member account is absent from it whether it is tagged or not, and reporting
  that as untagged is a fabricated finding against an account this console has
  never read.

Both now resolve through one `ArnScope { partition, region, accountId }`, every
field nullable, every field READ:

1. the identity a surface already resolved (`arnScopeOf`, from
   `sts:GetCallerIdentity`), or an explicit scope;
2. the region the client itself resolved;
3. `scopeFromIndex` — the partition and account the index's OWN returned ARNs
   prove, unanimously or not at all. A console holding no `sts:GetCallerIdentity`
   still attributes.

A field nothing resolved stays null, and a null field makes an absence render
`unknown` — never `untagged`, and never a literal `"aws"`.

### A resource its own reader could not name

`logs.ts`, `ecr.ts`, `cognito.ts`, `keys.ts`, `secrets.ts` and `elasticache.ts`
each declare `arn: string | null`, because the AWS API they call can omit it.
Such a resource cannot be joined to the tag index — there is no key — and the
convenient move is to drop it, which shrinks the estate's own total precisely
around the resources whose identity was already incomplete.

`declarationsFrom` returns `{ declared, unidentified }` from one call, so both
lists have to be destructured to use either. An unidentified resource is still
attributable when its own service answered about its tags (no ARN is needed for
that), is counted in the same `CoverageSummary`, and reaches `unowned` with the
reader's own label. `coverage.summary.untagged` and `coverage.unowned.length`
agree, ARN or no ARN — asserted, because a page reading "2 unowned" over a list
of one is the defect.

### Type changes, and every construction site checked

| type | change | every construction / read site |
| --- | --- | --- |
| `CoverageQuestion` | `indexRegion: string \| null` → `indexScope: ArnScope`, REQUIRED | 2, both updated: `estateCoverage`'s `decide` (`tags.ts`), `ask` (`tags.test.ts`). `tsc` flagged both — the point of not making it optional |
| `EstateCoverage` | `indexRegion` → `indexScope`; `+ unidentified` | constructed once (return of `estateCoverage`); `grep -rn "estateCoverage\|indexRegion\|indexScope" apps packages tools tests` finds no reader outside `tags.ts`/`tags.test.ts` |
| `UnownedResource` | `arn: string` → `string \| null`; `+ label`, `+ accountId`, `+ partition` | constructed once (`unownedResources`); `grep -rn "unownedResources\|\.unowned\|UnownedResource"` outside `tags.ts` returns NOTHING — no surface renders these rows yet |
| `DeclaredResource` | `+ label?`, `+ source?` (additive) | no external construction site |
| `coverageSummary` | parameter relaxed to `readonly { coverage: TagCoverage }[]` | a relaxation: every existing caller still compiles |
| `parseArn` / `ParsedArn` | UNCHANGED — `console-link.ts` imports both at 6 call sites | — |

### Mutation proof — 12 applied one at a time, 12 killed

Each: apply, run, confirm RED, restore, confirm GREEN. The module was verified
byte-identical to its pre-mutation state at the end.

| # | mutation | mutated | restored |
| --- | --- | --- | --- |
| M1 | `if (parsed.partition !== scope.partition)` → `if (false && …)` | RED — 1 failed, 44 skipped | GREEN |
| M2 | `if (parsed.accountId !== scope.accountId)` → `if (false && …)` | RED — 1 failed, 44 skipped | GREEN |
| M3 | `if (scope.accountId === null)` → `if (false && …)` | RED — 1 failed, 44 skipped | GREEN |
| M4 | `if (scope.partition === null)` → `if (false && …)` | RED — 1 failed, 44 skipped | GREEN |
| M5 | `scopeFromIndex` unanimity `seen.size === 1` → `seen.size >= 1` | RED — 1 failed, 44 skipped | GREEN |
| M6 | `arnScopeOf` on a denied identity returns `{ partition: "aws", … }` | RED — 1 failed, 44 skipped | GREEN |
| M7 | `mergeScope` becomes `{ ...fallback, ...preferred }` | RED — 1 failed, 44 skipped | GREEN |
| M8 | `declarationsFrom` stops pushing ARN-less resources | RED — 1 failed, 44 skipped | GREEN |
| M9 | an ARN-less resource with no native answer renders `untagged` | RED — 1 failed, 44 skipped | GREEN |
| M10 | `unownedResources` skips the `unidentified` list | RED — 1 failed, 44 skipped | GREEN |
| M11 | `UnownedResource.accountId` becomes a constant `null` | RED — 1 failed, 44 skipped | GREEN |
| M12 | `summary: coverageSummary(resources)` — the ARN-less ones uncounted | RED — 1 failed, 44 skipped | GREEN |

`npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/tags.test.ts`
— 45 passed, 45 total. The three other suites that reach this module
(`tag-compliance.test.tsx`, `cost-decisions.test.ts`, `tenants/[slug]`) — 9
suites, 142 passed. `tests/security/operator-plane-content.test.mjs` — 5 passed
(the only import added is `import type { Identity }`, which erases).

### What is NOT done, said plainly

- **No surface passes declared resources yet.** In production `taggedResources`
  (`platform/cost/page.tsx`), `tagCompliance` (`components/TagCompliancePanel.tsx`)
  and `forTenant` (`tenants/[slug]/footprint.ts`) reach the coverage core through
  `coverageFromIndex`. `estateCoverage`, `coverageFor` and `declarationsFrom` are
  reached only when a page hands over what its readers found; none does today,
  and no comment in the module claims otherwise. `inventory.ts`'s
  `EstateResource` is structurally a `DeclaredResource`, so the composition is
  one argument for whoever owns that route.
- **`UnownedResource` rows are rendered nowhere.** `TagCompliancePanel` shows the
  counts and its own non-compliance table; the unowned rows are computed on a
  live path and read by nobody. That is why `arn` could be widened safely, and it
  is a gap, not a feature.
- **Three names now exist twice under `src/lib/aws/`** — `estateCoverage`,
  `DeclaredResource` and `parseArn` each mean one thing in `tags.ts` and another
  in `inventory.ts`/`drift.ts`. A module importing both gets a compile error, not
  a silent bug, but nothing here resolved it: those files belong to other agents.
- **`TAG_API_GAPS` is not AWS's support matrix** and cannot be. The general rule
  — a global ARN cannot be concluded from a regional index — is what catches the
  services nobody listed.
- **No approval, review, certification, ARN, account id, region, price or date is
  asserted.** The accounts in the tests are `111122223333` and `444455556666`,
  AWS's own documentation examples.

## STUDIO-080-001 (continued) — the image the NEXT task pulls, and why it is neither a break nor housekeeping

The wiring graph could already walk a tenant end to end — host, DNS record,
CloudFront distribution, load balancer, listener, target group, ECS service, task
definition, running digest, ECR repository — plus the RDS instances, DynamoDB
tables, S3 buckets, queues and secrets its tags claim. `walkDigests` answers
"which build is serving traffic" by reading the digest off a RUNNING task, which
is the only stable answer to that question.

It has one blind spot and it is wide:

- **a service scaled to zero has no running task.** The digest hop returns
  `unknown` and the whole right-hand end of the chain — image, repository —
  vanishes from the graph. The most likely reason a service sits at zero is that
  somebody is about to scale it back up.
- **a running service reads green while the tag its revision names is gone.** A
  container that is already up never pulls again, so an ECR lifecycle policy can
  expire the tag out from under it and every hop in the graph stays `present`.

Both are the same fact, and it is readable from the revision whether or not
anything is running: `ecs:DescribeTaskDefinition` names an image, and
`ecr:DescribeImages` either holds it or does not. When it does not, the next task
placed fails `CannotPullContainerError` — at a scale-out under load, at an AZ
replacement, at the next deploy.

### A third severity, because folding it either way lies

`walkDeclaredImages` / `walkDeclaredRepository` add two hops,
`task-definition->declared-image` and `declared-image->ecr-repository`, and they
are in `LATENT_EDGE_KINDS` — not `PATH_EDGE_KINDS`, not attribution.

- Counted as a break, a tenant serving every request correctly is reported as
  down beside the tenant that actually is, and the row that means an outage stops
  being read.
- Counted as an attribution, "the image this revision declares is gone from ECR"
  files under a list titled *resources tagged for this tenant*, which is not what
  it is, and it reads as housekeeping.

`TenantWiring.latent` is its own list; `absentAttributions` is now the exclusion
of BOTH sets, so adding a latent kind cannot quietly refile it. `reachOf` carries
`latent` as a count on EVERY `ReachState` arm including `intact`, and
`describeReach`'s intact arm was re-worded from "every one of the N hops this
graph walked is connected" to "every one of the N hops this graph walked **on the
request path** is connected" — the old wording became false the moment a walked
hop could be disconnected without being a break.

A reference carrying neither tag nor digest is looked up as `latest`, named in
the sentence rather than applied silently. A `present` answer against a
tag in a MUTABLE-tag repository says so: it proves a build answers to that tag
today, not that it is the build the running task pulled.

`reconcileTopology` — the account-role half of this module, shipped earlier —
had no test anywhere in the repository. It has seven now.

### Type changes, and every construction site checked

| type | change | every construction / read site |
| --- | --- | --- |
| `ReachState` | `latent: number` added to all four arms, REQUIRED on each | constructed at 4 sites, all in `reachOf` (`topology.ts`), all updated; plus 2 literals in `topology.test.ts`. Read by `describeReach` (`topology.ts`) and the test. `grep -rn 'kind: "intact"\|kind: "unverified"\|kind: "no-hosts"\|kind: "broken"' apps/system-studio` — every other hit is a DIFFERENT union in `cdn.ts`, `containers.ts`, `ecr.ts`, `health.test.ts`, `compute-page-logic.spec.ts` |
| `TenantWiring` | `+ latent: readonly WiringEdge[]`, REQUIRED | constructed once — the return of `tenantWiring`. `grep -rn "TenantWiring" apps/system-studio` outside `topology.*` returns NOTHING |
| `WiringNodeKind` | `+ "declared-image"` | no `switch` anywhere is exhaustive over it; `grep -rn "WiringNodeKind" apps/system-studio` outside `topology.*` returns NOTHING |
| `WiringEdgeKind` | `+ "task-definition->declared-image"`, `+ "declared-image->ecr-repository"` | the two `ReadonlySet` literals in `topology.ts`, both updated deliberately; no external reference |
| `LATENT_EDGE_KINDS`, `isLatentEdge` | new exports | — |
| `PATH_EDGE_KINDS`, `EdgeState`, `WiringEdge`, `WiringNode`, `PathRole`, `WiringAttribution`, `ReaderAttribution`, `TopologyVerdict`, `AccountRole`, `EstateScale` | UNCHANGED | `TopologyVerdict` is imported by `platform/estate/estate-answer.ts` and `platform/estate/page.tsx`; untouched on purpose |

Nothing was added as optional. `latent` is required on every arm precisely so a
construction site that omits it fails `tsc` rather than rendering "intact" over a
service one scale-out from an outage.

### Mutation proof — 12 applied one at a time, 12 killed

Each: apply, run, confirm RED, restore, confirm GREEN, and the module verified
byte-identical to its pre-mutation state after every single one. M7 SURVIVED on
its first run and is recorded as survived — the test asserted the *sentence*
said `latest` while the *lookup* was free to change. A second case was added (a
repository holding the tag `latest`, a reference carrying no tag, expected
`present`) and M7 was re-run against it.

| # | mutation | mutated | restored |
| --- | --- | --- | --- |
| M1 | the `walkDeclaredImages(...)` call in `walkService` commented out | RED — 10 failed, 64 passed | GREEN — 74 passed |
| M2 | `conclusive(repositories) ? "absent" : "unknown"` → `"unknown"` (repository not in the listing) | RED — 1 failed, 73 passed | GREEN — 74 passed |
| M3 | the unread-`ecr:DescribeImages` arm's `"unknown"` → `"absent"` | RED — 1 failed, 73 passed | GREEN — 74 passed |
| M4 | both latent kinds added to `PATH_EDGE_KINDS` | RED — 3 failed, 71 passed | GREEN — 74 passed |
| M5 | `latentClause` returns `""` unconditionally | RED — 2 failed, 72 passed | GREEN — 74 passed |
| M6 | `itemsOf(repository.images).some((i) => i.tags.includes(tag))` → `true` | RED — 3 failed, 71 passed | GREEN — 74 passed |
| M7 | `const tag = reference.tag ?? "latest"` → `?? ""` | first run: **SURVIVED** — 74 passed. After the added case: RED — 1 failed, 74 passed | GREEN — 75 passed |
| M8 | `absentAttributions` drops the `&& !isLatentEdge(e)` clause | RED — 2 failed, 72 passed | GREEN — 74 passed |
| M9 | `if (input.unknownBecause)` → `if (false && input.unknownBecause)` | RED — 1 failed, 73 passed | GREEN — 74 passed |
| M10 | `if (!input.selfAccountId)` → `if (false)` | RED — 1 failed, 73 passed | GREEN — 74 passed |
| M11 | the zero-container `edge(...)` replaced by a bare `return` | RED — 1 failed, 73 passed | GREEN — 74 passed |
| M12 | `const required = ORDER[role.requiredFrom] <= ORDER[input.scale]` → `const required = true` | RED — 1 failed, 73 passed | GREEN — 74 passed |

M9 is failure mode 1 from the programme's own list, applied deliberately and
restored deliberately. `grep -n "MUTATION\|false &&\|?? \"\"" topology.ts`
returns nothing; the four guards were re-read by line number afterwards.

`npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/topology.test.ts`
— 75 passed, 75 total. `npx tsc --noEmit -p apps/system-studio/tsconfig.json`
reports nothing in `topology.ts` or `topology.test.ts` (it reports three errors in
`tags.ts` / `tags.test.ts`, another agent's file, mid-flight).

### What is NOT done, said plainly

- **The wiring half of this module has no production caller.** `reconcileTopology`,
  `ACCOUNT_ROLES` and `requiredAt` are reached from `/platform/estate` —
  `apps/system-studio/src/app/platform/estate/page.tsx:169`, a real route, via
  `estate-answer.ts`'s `topologySummary` / `topologyAccount` / `topologyTone`, and
  also from `e2e/aws-unknown-is-not-absent.spec.ts:717`. `tenantWiring`,
  `wiringReadings`, `wiringLines`, `describeReach` and `describeEdge` — the
  request-path graph and everything this entry adds — are imported by NOTHING
  outside `topology.test.ts`. `grep -rn "tenantWiring\|wiringReadings\|wiringLines\|describeReach\|TenantWiring" apps/system-studio/src/app apps/system-studio/src/components apps/system-studio/src/lib`
  returns only `network.ts`'s unrelated `describeReachability`. That is the
  "correct code, zero effect" failure this ledger has recorded before, and no
  comment in the module claims otherwise. The surface that would consume it is a
  route, and routes belong to other agents; the shape a caller needs is
  `wiringReadings()` → `tenantWiring({ slug, hosts, readings, deployWindow, now })`
  → `wiringLines(wiring)`, with `wiring.broken`, `wiring.latent` and
  `wiring.unreadable` as three separate tables.
- **`wiringReadings` issues eleven `tag:GetResources` per load** — one per reader,
  which is the readers' own contract. Consolidating it is a change to eleven other
  modules, not to this one.
- **`DeployWindow` is supplied, never derived.** This engine holds no capability
  that reads a release calendar. `NO_DEPLOY_WINDOW` renders the certificate
  horizon `unknown`; it never renders it fine.
- **A data-plane edge is an ATTRIBUTION, not an observed connection.** No AWS read
  proves an ECS service talks to an RDS instance — the connection string is in a
  secret whose VALUE this engine deliberately never reads — and every one of those
  `why` sentences says so.
- **A mutable tag proves nothing about which build.** Where the repository allows
  tags to move, the `present` sentence says that explicitly rather than implying
  the running digest and the declared tag are the same image.
- **No approval, review, certification, ARN, account id, region, price or date is
  asserted.** The fixtures use `123456789012` — AWS's own documentation account —
  and RFC 2606 reserved domains, and correspond to nothing that exists.

---

# Requirement reconciliation — the AWS read/aggregation programme, 2026-08-14

Appended, not merged into the sections above. Every section this file already
holds is another agent's row and stays exactly as written; what follows is the
*accounting* those sections do not carry, because a section headed with an id
that does not exist registers against nothing.

## Why this section exists

Measured on 2026-08-13 while the wave was still running: the service agents
returned **172 claimed-PASS requirements under ids they invented** —
`BUCKETS-01-listing`, `COGNITO-MFA-002`, `ACM-DETAIL-READ`,
`CDN-DENIED-IS-NOT-EMPTY` and 168 more. None of those strings appears in the
bible, in any ledger, or in `tools/loop/next-batch.mjs`'s output. The code they
describe is real; the accounting was disconnected from it.

**The universe of requirement ids.** Regenerated here, never quoted from memory:

```
node tools/loop/next-batch.mjs --size 2100 --json     # every UNDECIDED requirement
```

On 2026-08-14 that returns `total 2265 · decided 248 · remaining 2017`, of which
**154 are `STUDIO-*`**. The bible
(`Tenure_System_Studio_AWS_Authoritative_Control_Plane_Claude_Bible_v1.0.md`)
declares **167** `STUDIO-*` ids in total. An id in neither set does not exist and
must never be given a row.

## The five invented ids already written into THIS file

Found by extracting every `STUDIO-...` string from this ledger and subtracting
the bible's own set. The precedent was already here and was correct — the AWS
Health section above refuses to invent `STUDIO-080-009` in as many words. Four
later sections invented one anyway.

| Heading in this file | In the bible? | The real requirement its evidence bears on | Status against that real id |
|---|---|---|---|
| `## STUDIO-070-011 — Service Quotas` | **No** | `STUDIO-120-011` (quota/capacity admission and forecast before tenant launch); partially `STUDIO-040-004` ("quota shortage" among the pre-plan detections) | FAIL — see row below |
| `## STUDIO-080-009 (Messaging)` | **No** | `STUDIO-070-004` (already PASS — adapters behind typed capabilities) and `STUDIO-120-003` (queue age is one of thirteen named health inputs) | 070-004 already decided; 120-003 FAIL — see row below |
| `## STUDIO-080-010 (Console deep links)` | **No** | **No requirement matches.** Deep-linking an operator to the AWS console is nowhere in the bible's 167 ids. Real, tested work against no requirement — recorded as a coverage finding, not given an id. | NOT A REQUIREMENT |
| `## STUDIO-DATA-001 (DATA surface)` | **No** | `STUDIO-080-001` (actual-resource inventory) and `STUDIO-100-005` (retained bytes and residual charge) | both FAIL — see rows below |
| `## STUDIO-IDENTITY-001 — /platform/identity` | **No** | `STUDIO-000-009` (long-lived keys, wildcard policies, unmanaged resources) | FAIL — see row below |

Those five headings are **left in place**. Deleting another agent's evidence to
tidy the index would destroy the only record of what was built; the correction is
this table, which says what each one actually counts toward.

## The finding that decides most of the rows below

Five aggregation entry points delivered by this programme **have no production
caller**. They are reached from their own test file and from nowhere else, so no
operator can see their output and no requirement they were written for is met.

Probe, and the mutation that proves the probe discriminates rather than always
returning nothing:

```
$ grep -rl "\bestateDrift\b" apps/system-studio/src/app
exit=1                                    # no file — the claim

--- mutation of the probe: same command, symbol swapped for one that IS reached
$ grep -rl "\bsecurityFindings\b" apps/system-studio/src/app
apps/system-studio/src/app/platform/security/answer.ts
apps/system-studio/src/app/platform/security/page.tsx
exit=0                                    # the probe finds callers when they exist
```

| Entry point | Module | Written for | Callers outside its own module |
|---|---|---|---|
| `estateDrift` (+ `parseTerraformEstate`, `observedBuckets`, `observedSecurityGroups`, `observedUserPools`, `observedTables`, `findingsOfKind`) | `src/lib/aws/drift.ts` | STUDIO-080-006, STUDIO-000-009 | `drift.test.ts` only |
| `driftIgnore` / `ignoreItem` / `activeIgnores` / `DriftHistory` | `src/lib/aws/drift.ts` | STUDIO-080-006 (ignore with expiry, recurrence) | `e2e/aws-unknown-is-not-absent.spec.ts` only |
| `findingsPipeline` / `assemblePipeline` / `pipelineLines` / `mergeContributions` | `src/lib/aws/findings.ts` | STUDIO-110-006 | **none at all**, not even its own test file |
| `fleetHealthVerdict` | `src/lib/aws/health.ts` | STUDIO-120-003 | `health.test.ts` only |
| `tenantWiring` / `wiringReadings` | `src/lib/aws/topology.ts` | STUDIO-080-002 | `topology.test.ts` only |

A consequence worth naming on its own: `app/tenants/[slug]/page.tsx:1203` renders
the drift item's `occurrences` and `firstSeenAt`, and neither production caller of
`compareDesiredToActual` passes a `history`. `options.history ?? EMPTY_HISTORY`
therefore makes that cell read "1x since <today>" on every load, forever. The
recurrence *machinery* is correct; the number on the page is not a recurrence
count.

## Measured state of the aggregation modules, 2026-08-14

Run from the repository root against the tree as it stood, uncommitted work in
place. This is why nothing below is PASS.

```
npm run test --workspace apps/web -- --ci \
  apps/system-studio/src/lib/aws/{findings,health,topology,inventory,posture,tags,console-link}.test.ts
  -> Test Suites: 2 failed, 5 passed, 7 total
     Tests:       4 failed, 296 passed, 300 total
     FAIL posture.test.ts  - securityPosture ... > fails the bucket with no public
                             access block, over a bucket S3 really listed
     FAIL findings.test.ts - deduplication across sources, and corroboration >
                             collapses the same threat reported by Security Hub
                             and GuardDuty into one row
                           - ... > says out loud that more than one source saw it
                           - what the surface prints > states how many records
                             collapsed and how many were corroborated

npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/drift.test.ts
  -> Tests: 1 failed, 39 passed, 40 total
     - estateDrift — present but never declared > does NOT report a live resource
       whose name the reader could not obtain
```

---

## The rows

Statuses follow this file's rule: `PASS`, `FAIL`, `BLOCKED_EXTERNAL`,
`NOT_APPLICABLE`, and **there is no `PARTIAL`**. A requirement that names eleven
things and got six is `FAIL`. Nothing below is `PASS`: no independent refuter
verdict was available to this reconciliation for any of it, three of the four
delivering modules are red, and five of the delivering entry points have no
production caller.

- [ ] **STUDIO-000-008** — Build a sanitized actual resource graph from Organizations/Resource Explorer/Resource Groups Tagging API/CloudFormation/Config/service APIs. Record resource owner, stack, tags, tenant, cell, environment, dependencies, cost attribution, drift, retention, and deletion behavior.
  - Status: FAIL
  - Code: `apps/system-studio/src/lib/aws/inventory.ts` (`EstateResource`,
    `estateInventory`, `estateCoverage`), `apps/system-studio/src/lib/aws/tags.ts`
    (`taggedResources`, `attributionOf`),
    `apps/system-studio/src/lib/aws/organization.ts`,
    `apps/system-studio/src/lib/aws/compliance.ts`
  - Tests: `apps/system-studio/src/lib/aws/inventory.test.ts` (passing),
    `apps/system-studio/src/lib/aws/tags.test.ts` (passing)
  - Caller: `apps/system-studio/src/app/platform/estate/page.tsx:119`,
    `apps/system-studio/src/app/page.tsx:404`,
    `apps/system-studio/src/app/tenants/[slug]/page.tsx:348`
  - Reason: **four of the six sources the requirement enumerates are read** —
    Organizations, Resource Groups Tagging API, Config, the service APIs. **Two
    are not, and have no capability at all**: `capabilities.ts` contains no
    `resource-explorer-2:*` key and no `cloudformation:*` key, so Resource
    Explorer and CloudFormation are not merely uncomposed, they are unreachable
    from this build. **Of the twelve facts the requirement says to record**,
    `EstateResource` carries `arn`, `resourceType`, `name`, `state`, `region`,
    `accountId`, `partition`, `tags`, `attribution` and `dependsOn`. Owner, stack,
    cell, environment and retention exist only as raw values inside `tags` — they
    are the `tenure:owner-seat`, `tenure:stack`, `tenure:cell`,
    `tenure:environment` and `tenure:retention` keys of `REQUIRED_RESOURCE_TAGS`,
    never lifted onto the record, so a resource missing the tag and a resource
    whose tag was unread are the same absence at every consumer. **Cost
    attribution, drift and deletion behaviour are absent from the record
    entirely** — cost is not composed (`ce:GetCostAndUsageWithResources` is a
    `notComposedSection` at `inventory.ts:1896`), drift lives in `estateDrift`,
    which nothing calls, and deletion behaviour exists only as the coarse
    `STATEFUL_RESOURCE_TYPES` set and the contract's `stateful` boolean.
  - What would close it: a `resource-explorer-2:Search` and a
    `cloudformation:DescribeStackResources` capability plus their readers, and the
    seven missing facts lifted onto `EstateResource` — which is a shared type, so
    every construction site named under STUDIO-080-001 below must change with it.

- [ ] **STUDIO-000-009** — Identify all console-created/unmanaged resources, long-lived AWS keys, wildcard policies, orphan queues/topics/rules, public resources, unencrypted data, unowned costs, misleading alarms, disabled trails, and missing backups.
  - Status: FAIL
  - Code: `apps/system-studio/src/lib/aws/iam.ts` (`iamPosture` — long-lived keys,
    wildcards, unmanaged principals, `keyCoverage`, `unswept`),
    `apps/system-studio/src/lib/aws/drift.ts` (`estateDrift`, `ManagedByFact`,
    `DriftFindingKind: "undeclared"` — console-created resources),
    `apps/system-studio/src/lib/aws/buckets.ts` (public exposure),
    `apps/system-studio/src/lib/aws/alarms.ts` + `expected-alarms.ts` (DISABLED,
    STALE, MISSING), `apps/system-studio/src/lib/aws/trail.ts`
    (`cloudtrail:GetTrailStatus` — a stopped trail),
    `apps/system-studio/src/lib/aws/eventbridge.ts` (`NO_TARGET`),
    `apps/system-studio/src/lib/aws/tags.ts` (`unattributed` — spend nobody owns)
  - Tests: `apps/system-studio/src/app/platform/identity/doors.test.ts` drives
    `iamPosture`; `apps/system-studio/src/lib/aws/drift.test.ts` (1 failing,
    above); `alarms.test.ts`, `trail.test.ts`, `eventbridge.test.ts`,
    `buckets.test.ts`, `tags.test.ts`
  - Caller: `iamPosture` — `app/platform/identity/page.tsx`,
    `app/platform/security/page.tsx`. `estateDrift` — **none**.
  - Reason: **three of the ten** things the requirement names reach an operator —
    long-lived AWS keys, wildcard policies and unmanaged IAM principals, all from
    `iamPosture`, whose own header states exactly that scope. Public resources,
    unencrypted data, unowned cost, misleading alarms, disabled trails and orphan
    rules each have a *reader* that answers for one service, but the aggregator
    that would turn them into the requirement's single answer —
    `estateDrift`'s `undeclared` finding — **has no production caller**, and its
    own test file is currently one test red. Orphan queues and topics are not
    detected at all: `sqs.ts` reads depth and redrive, not orphanhood, and there
    is no SNS reader in this build.
  - What would close it: a surface that calls `estateDrift`, plus an SNS reader
    and an orphan rule for queues and topics.

- [ ] **STUDIO-080-001** — Build a cross-account/region actual-resource inventory with ARN/ID, type, name, state, stack, tenant, module, dependencies, tags, security posture, health, cost, drift, last change, retention, and deletion behavior.
  - Status: FAIL
  - Code: `apps/system-studio/src/lib/aws/inventory.ts`
  - Tests: `apps/system-studio/src/lib/aws/inventory.test.ts` — passing
  - Caller: `app/platform/estate/page.tsx:119`, `app/page.tsx:404`,
    `app/tenants/[slug]/page.tsx:348`
  - Reason: **it is neither cross-account nor cross-region.** `estateInventory`
    resolves one identity through `sts:GetCallerIdentity` and issues every read in
    that account and that region; `organizations:ListAccounts` is a *signal*
    section, and this file already says so at the foot of the inventory section
    ("This inventory reads ONE account"). Cross-account is `BLOCKED_EXTERNAL` on
    the AWS Organization that blocks GE-010, GE-012 and GE-GATE-1 —
    cross-**region** is not blocked on anything and is unbuilt. **Six of the
    seventeen attributes** the requirement enumerates are on the record; stack,
    tenant, module and retention are tag values rather than fields; and security
    posture, health, cost, drift and last change are not present at all.
  - **Construction sites of `EstateResource`, checked, for whoever widens it.**
    This is a shared type and an added optional field is invisible to `tsc` at
    every site that omits it. The sites are: the four named mappers inside
    `inventory.ts` itself (`readEcsServices`, `readDatabases`,
    `readDistributions`, `readCertificates`) plus the generic `Mapped` path every
    other section goes through, and the consumers
    `app/platform/estate/page.tsx`, `app/platform/estate/estate-answer.ts`,
    `app/platform/estate/estate-coverage.ts`, `app/tenants/[slug]/footprint.ts`,
    `app/tenants/[slug]/page.tsx`, `app/page.tsx`, and `src/lib/aws/drift.ts`
    (`DriftItem.actual`). `packages/contracts`'s `EstateResource` JSON Schema is
    `additionalProperties: false`, so a new field must be added there in the same
    change or `parseEstateResource` will refuse every resource at runtime.

- [ ] **STUDIO-080-002** — Create graph edges for network flow, trust, encryption, data, event, DNS, deployment, module, backup, monitoring, and cost allocation.
  - Status: FAIL
  - Code: `apps/system-studio/src/lib/aws/topology.ts` (`WiringEdgeKind`,
    `PATH_EDGE_KINDS`, `LATENT_EDGE_KINDS`, `tenantWiring`, `wiringReadings`)
  - Tests: `apps/system-studio/src/lib/aws/topology.test.ts` — passing
  - Caller: **none.** `tenantWiring` and `wiringReadings` are referenced only by
    `topology.test.ts`. (`reconcileTopology`, the *account* topology in the same
    file, IS reached from `app/platform/estate/page.tsx`; that is a different
    requirement, STUDIO-010-001.)
  - Reason: **five of the eleven edge classes** the requirement names are
    modelled — network flow, DNS, deployment, data, and encryption only in its TLS
    sense (`listener->acm-certificate`; there are no KMS grant edges). **Trust,
    event, module, backup, monitoring and cost-allocation edges do not exist**,
    and `tenant->sqs-queue` is documented in the module itself as an attribution
    edge rather than an event-flow edge. On top of the six missing classes, the
    graph that does exist reaches no surface.

- [ ] **STUDIO-080-005** — Show unsupported/unmanaged AWS state honestly. Do not offer a generic JSON escape hatch that bypasses policy.
  - Status: FAIL
  - Code: `apps/system-studio/src/lib/aws/inventory.ts` (`SectionCoverage`'s five
    arms, `CoverageReport`, `estateCoverage` — `noReader` is computed as the
    capability registry minus every capability some section claims, so a
    capability nothing reads appears on the next render rather than silently),
    `apps/system-studio/src/lib/aws/tags.ts` (`not-coverable`),
    `apps/system-studio/src/lib/aws/iam.ts` (`unswept`),
    `apps/system-studio/src/lib/aws/drift.ts` (`ManagedByFact`, `undeclared`)
  - Tests: `apps/system-studio/src/lib/aws/inventory.test.ts` (passing),
    `apps/system-studio/src/lib/aws/tags.test.ts` (passing)
  - Caller: `estateCoverage` runs inside `estateInventory`, so the *unsupported*
    half reaches `/platform/estate`, `/` and `/tenants/[slug]`.
  - Reason: the **unsupported** half is met, and met well — five coverage arms,
    with `NO_READER` computed from the registry rather than hand-listed, so a gap
    cannot go stale. The **unmanaged** half is not met: "AWS state this platform
    does not manage" is `estateDrift`'s `undeclared` finding and
    `ManagedByFact { kind: "none" }`, and **nothing calls `estateDrift`**. The
    second clause — no generic JSON escape hatch — is already established by
    STUDIO-070-004 (PASS) and is not re-claimed here. A requirement with two
    clauses and one delivered is FAIL.

- [ ] **STUDIO-080-006** — Implement desired-versus-actual comparison, drift severity, ownership, safe remediation plan, ignore policy with expiry, and recurrence detection.
  - Status: FAIL
  - Code: `apps/system-studio/src/lib/aws/drift.ts` — `compareDesiredToActual`,
    `estateDrift`, `parseTerraformEstate`, `observedBuckets` /
    `observedSecurityGroups` / `observedUserPools` / `observedTables`,
    `DriftSeverity`, `DesiredResource.owner`, `Remediation`, `driftIgnore` +
    `IgnoreWithoutExpiry`, `DriftHistory`
  - Tests: `apps/system-studio/src/lib/aws/drift.test.ts` — **1 failed, 39
    passed**; `apps/system-studio/e2e/aws-unknown-is-not-absent.spec.ts:818-838`
    covers the ignore-without-expiry refusal
  - Caller: `compareDesiredToActual` — `app/page.tsx:428`,
    `app/tenants/[slug]/page.tsx:377`. `estateDrift`, `driftIgnore` and
    `activeIgnores` — **none**.
  - Reason: all six elements are **written**, and this is the row where that is
    least the same thing as done. Desired-versus-actual, severity, ownership and
    the safe-remediation refusal are reached, through `compareDesiredToActual`
    only — the richer Terraform-declared-versus-observed engine, `estateDrift`,
    is not. **Ignore-with-expiry has no production caller**: neither of the two
    callers passes `history`, so `history.ignored` is permanently empty and the
    `if (history.ignored.has(...)) continue` branch at `drift.ts:186` is
    unreachable in production. **Recurrence detection is likewise unreachable**,
    and worse than absent: `app/tenants/[slug]/page.tsx:1203` renders
    `occurrences` and `firstSeenAt`, which without a history are always `1` and
    today's date. The page prints a recurrence count that is not one.
  - What would close it: persist and pass a `DriftHistory` from the registry at
    both call sites, and give `estateDrift` a surface. `ignoreItem` already
    returns the registry row shape; nothing writes it.

- [ ] **STUDIO-080-007** — Detect orphans through IaC, tags, registry, Config, service APIs, CUR, and relationship graph; assign owner and expected cost.
  - Status: FAIL
  - Code: per-service orphan notions only —
    `apps/system-studio/src/lib/aws/certificates.ts` (a certificate "in use by
    nothing"), `apps/system-studio/src/lib/aws/loadbalancer.ts` (an orphaned
    target group), `apps/system-studio/src/lib/aws/network.ts` (a security group
    whose usage is unknown), `apps/system-studio/src/lib/aws/eventbridge.ts`
    (`NO_TARGET`), `apps/system-studio/src/lib/aws/tags.ts` (`unattributed`)
  - Tests: `certificates.test.ts`, `loadbalancer.test.ts`, `network.test.ts`,
    `eventbridge.test.ts`, `tags.test.ts` — all passing
  - Caller: each reader is reached through `estateInventory`'s sections.
  - Reason: **there is no orphan detector.** No module aggregates the five
    per-service notions above into one answer, so "orphans" is not a thing the
    console has. Of the seven detection channels the requirement names, IaC is
    unreachable (`estateDrift` has no caller), the relationship graph is
    unreachable (`tenantWiring` has no caller), and **CUR is not read at all** —
    `ce:GetCostAndUsageWithResources` is a `notComposedSection` at
    `inventory.ts:1896` with its reason stated. Neither of the two things the
    requirement says to assign — owner and expected cost — is assigned to
    anything, because there is no orphan record to assign them to.

- [ ] **STUDIO-100-005** — Show every retained byte/control resource and real residual charge for backups, snapshots, S3 versions, logs, keys, DNS, archives, compliance, legal hold, and evidence. Hibernation is not literal $0 when these remain.
  - Status: FAIL
  - Code: `apps/system-studio/src/lib/aws/retained.ts` (`RetainedKind` =
    `tag-index | rds-snapshot | log-group | backup-recovery-point`)
  - Tests: exercised through
    `apps/system-studio/src/app/platform/data/answer.test.ts`
  - Caller: `retainedReadingsForTenant` — `app/platform/data/page.tsx`,
    `app/tenants/[slug]/page.tsx`
  - Reason: **three of the ten retained classes** are read — backups (Backup
    vaults and recovery points), snapshots (RDS) and logs (log groups with
    `storedBytes`). S3 object versions are not: `s3:ListObjectVersions` is a
    registered capability that `inventory.ts` declares deliberately uncomposed and
    that `retained.ts` never issues. Keys, DNS, archives, compliance artefacts,
    legal hold and evidence are absent. **And the "real residual charge" is absent
    entirely**: `retained.ts` contains no money — no minor-unit field, no price
    lookup, no Cost Explorer read — so the surface can say a tenant retains bytes
    and cannot say what they cost. The sentence the requirement exists to make
    printable, "hibernation is not literal $0", is exactly the one it cannot
    print.

- [ ] **STUDIO-110-006** — Aggregate Security Hub/GuardDuty/Inspector/Macie/Config/Access Analyzer findings with dedupe, severity, affected tenants, SLA, ownership, suppression justification/expiry, and remediation workflow.
  - Status: FAIL
  - Code: `apps/system-studio/src/lib/aws/findings.ts` — `securityFindings`
    (Security Hub direct, plus per-product `FindingSource` state) and, separately,
    `findingsPipeline` / `assemblePipeline` / `mergeContributions` / `dedupeKey` /
    `SEVERITY_SLA_HOURS` / `PipelineAttribution`
  - Tests: `apps/system-studio/src/lib/aws/findings.test.ts` — **3 failed**, all
    three in the deduplication-and-corroboration group, which is the requirement's
    own first named element
  - Caller: `securityFindings` — `app/platform/security/page.tsx:154`.
    `findingsPipeline` — **none anywhere in the repository, including its own test
    file.**
  - Reason: `FINDING_PRODUCTS` names all six products, but `PIPELINE_SOURCES`
    drives five, and **Inspector and Macie have no reader**: there is no
    `inspector2:*` and no `macie2:*` capability, so their findings can arrive only
    if Security Hub is enabled and readable, and if `securityhub:GetFindings` is
    refused there is no direct path to either. Of the seven properties the
    requirement lists, dedupe, severity, affected tenants and SLA are implemented
    (dedupe is currently red); **ownership exists only for Config rules
    (`ruleOwner`), suppression justification and expiry do not exist at all, and
    there is no remediation workflow** — a workflow would be a mutation, which
    this read-only console will not carry and which therefore needs its own
    recorded architectural decision rather than a quiet omission.

- [ ] **STUDIO-120-003** — Build tenant-aware health from real synthetics, API checks, dependencies, queue age, error rates, database, identity, domain/TLS, integrations, Relay, backups, drift, and cost anomalies.
  - Status: FAIL
  - Code: `apps/system-studio/src/lib/aws/health.ts` — `fleetHealthVerdict`,
    `VerdictSource` (`aws-health | alarms | metrics | loadbalancer | containers |
    database`), `VERDICT_LEVELS`, `FINDING_KINDS`
  - Tests: `apps/system-studio/src/lib/aws/health.test.ts` — passing
  - Caller: **none.** `fleetHealthVerdict` is referenced only by `health.test.ts`.
    `observeFleet` and `observationsFor` in the same file ARE reached from
    `app/tenants/page.tsx` and `app/tenants/[slug]/page.tsx`; the verdict built on
    top of them is not.
  - Reason: **six sources against the thirteen inputs the requirement names.**
    Error rates, database and dependencies are covered. Synthetics, API checks,
    queue age, identity, domain/TLS, integrations, Relay, backups, drift and cost
    anomalies are not — several of them have readers in this same directory
    (`certificates.ts` for TLS, `metrics.ts` for queue age, `retained.ts` for
    backups, `drift.ts` for drift) that the verdict does not compose. The module's
    own header is honest about the six; the requirement asks for thirteen.
  - Worth preserving from this work whatever wires it up: `HEALTHY` is reachable
    only when `findings` and `couldNotSee` are both empty *and* at least one
    source produced something. That is the STUDIO-080-008 rule applied to a
    composite verdict.

- [ ] **STUDIO-120-011** — Add quota/capacity admission and forecast before tenant launch; never wait for a production quota failure to discover capacity.
  - Status: FAIL
  - Code: `apps/system-studio/src/lib/aws/quotas.ts` — `quotaReadings()`, the
    applied values for the twelve quotas that bound tenant provisioning across
    nine service codes, via `servicequotas:ListServiceQuotas` with
    `servicequotas:GetServiceQuota` as the per-target fallback
  - Tests: `apps/system-studio/src/lib/aws/quotas.test.ts` — 38 pass, 0 fail
    (recorded in the `STUDIO-070-011` section above, which is the invented id this
    row replaces)
  - Caller: reached as a section of `estateInventory`.
  - Reason: the requirement has two verbs and the delivery has neither. **Reading
    a quota is not admission**: nothing consults `quotaReadings()` before a
    launch, the launch path does not import it, and no plan is refused because a
    ceiling is near. **And there is no forecast** — no consumption-against-ceiling
    projection exists, so "never wait for a production quota failure to discover
    capacity" is not yet true. What landed is the input the admission control will
    need, which is real progress and is not the requirement.
  - Also bears on `STUDIO-040-004`, whose pre-plan detection list includes "quota
    shortage"; that item stays undecided for the same reason.

## STUDIO-080-008 — the standing PASS, re-checked against the new metrics reader

`STUDIO-080-008` (never render green solely because no data is present) is
already `PASS` in this ledger. The new `src/lib/aws/metrics.ts` **upholds it**,
checked by opening the file rather than by taking its header's word:
`SeriesSummary` at `metrics.ts:266-270` is a three-armed union — `datapoints`,
`{ kind: "no-datapoints"; why }`, `{ kind: "not-read"; why }` — with **no arm
carrying an optional mean**, so a caller cannot reach a statistic on a series
that has none. A `GetMetricData` result carrying `StatusCode: "Forbidden"`
summarises as `not-read` with the status code (`metrics.ts:694-725`), never as an
absence and never as a zero. `metrics.test.ts:358` — "a metric that published
nothing summarises as no-datapoints, not as 0" — asserts it, and the suite passes.
`health.ts`'s `FINDING_KINDS` carries the same rule one level up: a metric with no
datapoint is a finding there, not silence.

The ratchet has not fallen.

## What this reconciliation could not corroborate

- **No refuter verdict was available for any of it.**
  `tools/loop/studio-program.mjs` dispatches refuters and holds
  `{id, refuted, reason}` in memory; nothing is written to the tree, so the
  "independent refuter returned `refuted=false`" half of the PASS bar could not be
  satisfied for a single requirement here. That alone is sufficient reason for
  every row above to be `FAIL` rather than `PASS`, independently of the gaps named
  in each.
- **172 claimed-PASS ids were unmappable as ids** — every one of them, because
  none exists in the bible or in any ledger. The ten requirements above are where
  their *evidence* lands after being read against the requirement text; the ids
  themselves map to nothing and were not preserved.
- **One body of real, tested work matches no requirement at all**: the console
  deep-link module (`src/lib/aws/console-link.ts` and `console-link.test.ts`,
  passing, reached from `app/platform/estate/page.tsx`). No `STUDIO-*` id in the
  bible asks for it. Recorded here as a coverage finding about the programme, not
  given an id.
- **Every service reader's own module header cites `STUDIO-070-004`**, which is
  already `PASS`. Those citations are not inventions and they are not wrong, but
  they register nothing: a reader tagged with an already-decided id moves no
  counter. That is the mechanical reason twenty-four service readers produced no
  movement in the decided count.

## STUDIO-070-004 (PRICING, FINOPS SIDE) — the aggregation layer that turns resolved rates into a tenant's price

- [x] **STUDIO-070-004 (grounded configuration cost)** — Compute a tenant's
  monthly cost from RESOLVED AWS rates, per seat and for the whole organisation,
  with a running total, across the fourteen meters the Price List adapter reads:
  Fargate vCPU- and GB-hours, RDS instance-hours, ElastiCache node-hours, ALB
  hours and LCU-hours, CloudFront requests and data transfer, S3 storage and
  requests, DynamoDB read and write request units, SES outbound messages and SQS
  requests.
  - Status: PASS
  - Evidence: `npm run test --workspace apps/web -- --ci packages.finops` ->
    149 passed, 149 total, 5 suites. Production module
    `packages/finops/src/pricing.ts`, consumed by
    `apps/system-studio/src/app/tenants/new/page.tsx` and
    `apps/system-studio/src/app/tenants/[slug]/configuration/page.tsx`.

- **Was**: `packages/finops/src/pricing.ts` totalled `OptionPrice.perSeatMinor`
  and `perOrgMinor` — figures typed into the catalogue by a person. The Studio's
  `lib/aws/pricing.ts` had just started resolving the real published rates, and
  nothing existed that could turn a rate into a tenant's bill: no usage shape, no
  tier-ladder arithmetic, no rule for what happens when one rate of twelve fails
  to resolve.
- **Now**: `packages/finops/src/grounding.ts`. `groundShapeCost(shape, rates,
  {seats, rounding})` prices one configuration option's `ComponentUsage[]`;
  `groundedRunningTotal(shapes, rates, …)` totals a whole configuration;
  `toOptionPrice(cost)` hands the result back to `quoteConfiguration` and
  `runningTotal` as the `OptionPrice` those already total, and the test asserts
  the two arrive at the same number rather than at two implementations of it.

### The rate travels as a structural type, so the dependency runs one way

A package may not import an app. `ResolvedShapeRate` / `ResolvedRate` /
`ResolvedTier` are declared in `grounding.ts` as the subset of the reader's
`ShapeRate` / `Rate` / `PricedTier` that arithmetic needs, and the reader's value
is assignable to them without a cast or a re-export. `grounding.test.ts` holds a
fixture with the reader's full field set — `sku`, `rateCode`, `description`,
`effectiveDate`, `publishedDecimal`, `free` — and assigns it, so a divergence
between the two shapes stops compiling rather than being discovered at runtime.

### UNKNOWN propagates, and a complete-looking total is unconstructable

`GroundedCost` has three arms and only `COMPLETE` carries a total; `INCOMPLETE`
carries the components that DID price and deliberately no sum of them;
`MIXED_CURRENCY` carries which meters resolved in which currency and no total.
`toOptionPrice` takes `CompleteGroundedCost`, not `GroundedCost`, so an
unresolved rate cannot become a price tag without a type error. A component
missing from the rate table is treated identically to one that came back
`unknown` or `ambiguous`: unpriced, never free.

Twelve mutations were applied to `grounding.ts` one at a time, each run against
`grounding.test.ts` and each restored byte-identically afterwards. Every one of
them turned the suite red — including `if (false && refused.length > 0)`, which
is the shape of the shipped-disabled guards this programme has already paid for,
and which makes the running total present itself as complete while one rate is
unknown.

### What is NOT closed, and is not claimed

- **No surface calls it yet.** `groundShapeCost` and `groundedRunningTotal` are
  exported from `@tenure/finops` and reached only by their own test. The input
  side is live — `inventory.ts` calls `pricingReadings()` on a request path —
  and the output side is live — `quoteConfiguration` and `runningTotal` are what
  the composer and the configuration page already total — but the file that
  joins them is a surface, and this entry did not edit one. The wiring is a
  `ComponentUsage[]` per configuration option plus one `groundedRunningTotal`
  call; nothing here claims it exists.
- **No usage shape is shipped for any real tenant.** `ComponentUsage.basis` is
  required precisely so that a quantity cannot be felt, and no quantities have
  been measured. A grounded rate multiplied by an invented quantity is still an
  invented price.
- **No AWS price appears anywhere in this module or its test.** The rates in the
  test are round synthetic numbers, labelled as such, chosen so the arithmetic is
  checkable by hand. Nothing here asserts what AWS charges for anything.
- **No account id, ARN, region, resource name, date, approval or sign-off is
  asserted**, and nothing in this package can move money — it imports `./money`
  and `./pricing` and nothing else.

### Declared-versus-observed drift, in three kinds — STUDIO-000-009, STUDIO-000-007

`apps/system-studio/src/lib/aws/drift.ts` + `drift.test.ts`. The module already
answered "what does the published artifact imply, and is it there". It now also
answers "what does Terraform declare, what did the readers observe, and where do
the two disagree" — modelled as THREE kinds, because they mean three different
things and call for three different responses:

| kind | means | severity |
| --- | --- | --- |
| `absent` | declared, and nothing of that name was read | `serving` for a serving type, else `costly` |
| `undeclared` | read, and no declaration names it — STUDIO-000-009's console-created finding | `costly` |
| `divergent` | declared AND present, with a setting that differs | `posture` for a control deciding reach or survival, else `cosmetic` |

The declared side is parsed from the `.tf` SOURCE in `infrastructure/terraform`
and `infrastructure/studio` — never from a state file, which is not in this
repository and must not be fetched. `parseTerraformEstate` is pure (it takes file
text, not a path), brace-counting with heredoc and `jsonencode` awareness, and
proven against the repository's own 31 `.tf` files rather than against fixtures.

#### Un-comparable is a value, not a finding

A source parser cannot resolve `count`, `for_each`, `var.*`, `local.*` or a
`${…}` interpolation. Every such declaration is reported as UN-COMPARABLE with
its reason, never as absent — and it also suppresses the `undeclared` verdict for
live resources of the same type, because a resource this parser cannot match may
be the very one the unresolvable declaration made. The one thing an interpolated
name yields honestly is its literal segments: `"${local.name_prefix}-tenants"`
must render to something ending `-tenants`. That becomes a PATTERN; one match is
a match, two is an ambiguity, and zero is un-comparable — emphatically not
absence.

Also un-comparable, each with its own sentence: a truncated listing (absence
unproven), a live resource whose name the reader could not obtain, a live
resource whose `tenure:managed-by` tag says Terraform when no file read here
declares it, a declared setting no reader observes, and a setting whose sub-read
was refused. A blind observed surface produces NO absent findings at all — the
rule at the top of the module, one layer up.

#### Types — nothing widened, three renamed to avoid a collision

| type | change | every construction site checked |
| --- | --- | --- |
| `DriftSeverity`, `DriftItem`, `DriftReport`, `DesiredResource`, `Remediation`, `ResourceChangeDiff`, `DriftIgnore`, `DriftHistory` | UNCHANGED | `src/app/page.tsx`, `src/app/tenants/[slug]/page.tsx`, `src/app/platform/estate/page.tsx`, `src/app/console-index/answer.ts` + `.test.ts`, `e2e/aws-unknown-is-not-absent.spec.ts`, `e2e/revisions-logic.spec.ts` — enumerated by grep, none touched |
| `EstateDriftSeverity` | NEW, separate from `DriftSeverity` | `posture` has no equivalent in the four-arm vocabulary `console-index/answer.ts` switches over; a fifth arm there would have fallen through its default and rendered a security finding as cosmetic |
| `TerraformDeclaration`, `TerraformEstate`, `EstateDriftFinding` | NEW, deliberately NOT `DeclaredResource` / `DeclaredEstate` / `DriftFinding` | those three names are already taken by `lib/aws/tags.ts`, `app/platform/estate/estate-coverage.ts` and `@tenure/contracts` respectively |

The only edit to pre-existing code is the extraction of `unreadableBecause` out
of the ternary inside `compareDesiredToActual`, string-for-string identical.

#### The published arm

`@tenure/contracts` already models this question — `DriftFinding.kind` is
`unmanaged | missing | modified`, the same three kinds. `publishedDrift()` emits
it through `parseDriftFinding`, parsed rather than asserted, exactly as
`resourceChangeDiff` does with `parseChangeDiff`.

`missing` findings are WITHHELD with their reason and counted. The contract
requires a real `arn`; a declared resource that does not exist has none, and the
only ways to satisfy the schema are to assemble an ARN AWS never issued or to put
a Terraform address in the field. Both are fabrications. The findings stay in the
report this console renders; only the published projection is short, and it says
by how much and why. `reversible` on an `unmanaged` finding takes a required
`stateful` argument rather than an import, so `inventory.ts`'s
`STATEFUL_RESOURCE_TYPES` remains the one place that decides it and no caller can
omit it.

#### Mutation proof — 19 applied one at a time, 19 killed

Each: apply, run, confirm RED, restore, confirm GREEN. The module was verified
byte-identical to its pre-mutation state at the end, and `grep` confirms no
`if (false`, `&& false`, `|| true` or `// MUTATION` remains.

| # | mutation | mutated | restored |
| --- | --- | --- | --- |
| M1 | `if (unresolvedDeclarations.length > 0)` -> `if (false && …)` | RED — 1 failed, 43 passed | GREEN |
| M2 | `if (!surface.complete)` -> `if (false)` | RED — 1 failed, 43 passed | GREEN |
| M3 | `if (want.name.kind !== "literal")` -> `if (false)` | RED — 3 failed, 41 passed | GREEN |
| M4 | `if (observed.kind === "unreadable")` -> `if (false)` | RED — 1 failed, 43 passed | GREEN |
| M5 | an absent public-access block reads as four flags ON | RED — 1 failed, 43 passed | GREEN |
| M6 | `if (literal.length < MIN_PATTERN_LITERAL)` -> `if (false)` | RED — 1 failed, 43 passed | GREEN |
| M7 | multi-line value consumption disabled, so `jsonencode` leaks | RED — 1 failed, 43 passed | GREEN |
| M8 | the SSE sidecar looks for a `rules` block instead of `rule` | RED — 1 failed, 43 passed | GREEN |
| M9 | a declared prefix-list source canonicalises as `cidr:0.0.0.0/0` | RED — 2 failed, 42 passed | GREEN |
| M10 | `if (!input.declared.known)` -> `if (false)` | RED — 1 failed, 43 passed | GREEN |
| M11 | `if (!live.nameKnown)` -> `if (false)` | RED — 1 failed, 43 passed | GREEN |
| M12 | `looksTerraformManaged` matches nothing | RED — 1 failed, 43 passed | GREEN |
| M13 | `declaresIngress` forced true | RED — 1 failed, 43 passed | GREEN |
| M14 | `unreadableBecause` DENIED arm returns the capability, not the action | RED — 4 failed, 40 passed | GREEN |
| M15 | `patterns.length === 1` -> `>= 1` | RED — 1 failed, 43 passed | GREEN |
| M16 | `publishedDrift` stops withholding `absent` | RED — 1 failed, 43 passed | GREEN |
| M17 | `publishedDrift` stops withholding an ARN-less finding | RED — 1 failed, 43 passed | GREEN |
| M18 | `reversible` forced true for `unmanaged` | RED — 1 failed, 43 passed | GREEN |
| M19 | `field` forced null (the contract rejects a `modified` with none) | RED — 2 failed, 42 passed | GREEN |

`npm run test --workspace apps/web -- --ci apps/system-studio/src/lib/aws/drift.test.ts`
— 44 passed, 44 total. Whole Studio suite: 73 suites, 2567 passed.
`npx tsc --noEmit -p apps/system-studio/tsconfig.json` — exit 0.
`node --test tests/security/operator-plane-content.test.mjs` — 5 passed (every
reader import added is `import type`, which erases).

#### What is NOT done, said plainly

- **No production surface calls `estateDrift` yet.** `drift.ts` is reached in
  production by `src/app/page.tsx`, `src/app/tenants/[slug]/page.tsx` and
  `src/app/platform/estate/page.tsx`, and the `unreadableBecause` helper
  extracted here executes on all three through `compareDesiredToActual`. The NEW
  entry points — `parseTerraformEstate`, `estateDrift`, the four `observed*`
  adapters and `publishedDrift` — have no caller. Wiring them is two edits in
  files this agent does not own: `platform/estate/declared-estate.ts` must export
  the `TerraformFile[]` it already collects (structurally a `TerraformSource[]`),
  and `platform/estate/page.tsx` must call
  `estateDrift({ declared: parseTerraformEstate(files), observed: [...], now })`
  with the surfaces its readers already load. No comment in the module claims
  otherwise.
- **Four services participate in the DIVERGENT comparison**, not every readable
  one: S3 posture, EC2 security-group ingress, Cognito MFA, DynamoDB protections.
  Every other declared type participates in `absent`/`undeclared` where a surface
  is supplied, and is listed in `report.unobserved` where none is. Adding a fifth
  is one case in `attachExpectations` plus one adapter.
- **Egress rules are not compared.** Ingress is what decides who can reach the
  estate; a full egress comparison would add rows nobody acts on.
- **No approval, review, certification, ARN, account id, region, price or date is
  asserted.** The account in the tests is `012345678901` and every ARN names a
  resource invented for the test; none is presented as real.

### STUDIO-DATA-001 addendum — the page WAS rendered, and it was wrong

The entry above recorded that the route had never been rendered. It has been
now, and the render found a defect that every node-level test on this page had
passed straight over. This section corrects the record; the section above is left
as written rather than rewritten, because what it claimed at the time was true.

#### The defect: two tables that claimed emptiness over reads that never happened

`DataTable` renders its `empty` node whenever `rows.length === 0`. Two tables on
this page fed it a bare claim:

- the cache-changes table — *"Nothing is queued against a cache"*
- the restore-points table — *"No store on this page has a continuous restore point"*

Neither was guarded on whether the reads behind those rows had answered.
`cacheChangeRows` returns `[]` for a refused `DescribeCacheClusters` exactly as it
does for an estate with no queued change, and `recoveryRows` returns `[]` for a
refused `ListTables` exactly as it does for an estate with no restorable store. On
the estate this console must keep booting in — no credentials, every read in a
valueless arm — both tables printed a calm, reassuring, entirely unfounded
statement about the fleet's data protection.

This is `lib/aws/read.ts`'s founding defect wearing a different hat. The type
makes it impossible to reach `read.value` without narrowing. It cannot make it
impossible to DROP the narrowed result and render a zero one layer up.

Notably, the lead verdict was CORRECT throughout — `verdictOf` returned UNKNOWN
and the page said so at the top. The two cards below it disagreed with their own
headline. A surface can be right in its summary and lying in its detail.

#### The fix

`mayClaimEmpty(reads)` in `./answer.ts` — pure, exported, and asked of the READS
rather than of the row count. `EMPTY` counts as answered, because that arm IS the
claim; `STALE` counts, because it carries a value that was really read. Every
valueless arm refuses the claim. Both tables now render the relevant
`UnknownState`s — principal, action, error code, pasteable minimum statement — in
the place the false sentence used to be. Two call sites in `page.tsx`, lines 446
and 833.

#### Mutation 7, on the new guard

`readAnswered(read.state)` becomes `readAnswered(read.state) || read.state === "THROTTLED"`
— one valueless arm quietly readmitted. RED: `× refuses the claim for every
valueless arm, not only for a denial`. `Tests: 1 failed, 31 passed`. Restored,
`Tests: 32 passed, 32 total`.

Four new cases cover it: `EMPTY`/`ACTUAL`/empty-list may claim; a single denial
among answers may not; each of `THROTTLED`, `UNCONFIGURED`, `ERROR`, `DENIED`
refuses independently; `STALE` may claim.

#### Evidence from the live render, and what it does NOT cover

The route was served by `next dev` on port 3100 with `STUDIO_AUTH_MODE=credentials`
and a local-only operator identity, and driven by `e2e/data-surface.spec.ts`.

- **PASSED against a live render**: `a read that did not answer renders as a named
  unknown, never as an empty list` (3.1m). This is the assertion that catches the
  defect above, and it is the reason the defect is recorded as fixed rather than
  as believed-fixed.
- **NOT covered**: the other six browser tests did not produce a verdict. Two
  distinct environment faults, neither in this agent's files:

  1. **A missing installed dependency.** `@aws-sdk/client-ec2` is declared in
     `apps/system-studio/package.json` and its peer `@aws-sdk/middleware-sdk-ec2`
     is resolved in `package-lock.json`, but that package is NOT present in
     `node_modules`. Webpack therefore fails with `Module not found: Can't resolve
     '@aws-sdk/middleware-sdk-ec2'` for every route whose import graph reaches
     `src/lib/aws/client.ts` — which is every AWS-backed route in the Studio, not
     only this one. The unblocking command is `npm install` at the repository
     root, which this agent is instructed not to run.
  2. **A concurrently-edited tree.** Sixteen agents were editing shared modules
     during the run; the dev server logged
     `export 'releaseToSuccessor' … was not found in './succession-release'
     (possible exports: … releaseToSuccessorRENAMED)` from
     `packages/organization-model`, reached through `src/app/layout.tsx`.

  So `it boots without AWS, and leads with the question in words` FAILED, and the
  four geometry tests and the verdict-badge test did not report. That failure is
  NOT evidence the page is sound and is NOT evidence it is broken; the build error
  above is sufficient to explain it and no narrower cause was established. Re-run
  after `npm install` on a quiescent tree:
  `PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test e2e/data-surface.spec.ts`.

#### The geometry claim, restated honestly

`e2e/layout.spec.ts` still does not list `/platform/data`, and the four widths it
would measure are reproduced inside `e2e/data-surface.spec.ts` — which did not
report. This route's behaviour at 1440 / 1180 / 900 / 320px has therefore NOT been
measured by anything. The stylesheet carries `overflow-wrap: anywhere` on every
identifier and prose cell and declares no colour at all (that last is asserted, and
it passed), which is a reason to expect it to hold and is not a measurement.
