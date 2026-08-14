# Planning, EPM and Decision Cloud — execution ledger

Every `PLN-*` requirement stated by `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`.

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

- [x] **PLN-000-001** — Inventory current budget/planning/report code and false EPM claims.
  - Status: PASS
  - Code: `tools/pln-planning-inventory.mjs` derives the inventory from the tree and
    writes `docs/architecture/pln-planning-inventory.md`. Nine anchors — the columns of
    the three budget tables plus the named budget calculations — swept over
    `apps/system-studio/src`, `apps/web/src`, `modules` and `packages`, in sorted
    directory order, over CRLF-normalised text, with POSIX-normalised paths. Named
    tokens rather than the word "budget", which also names the AI token budget and the
    SLO error budget and neither is money. The generator REFUSES to emit a document
    when a swept file has no hand-written note, or a note names a file the sweep did
    not find, so the prose half cannot drift away from the derived half in silence.
  - What it found, all verified by opening the file: 19 production files and 6 test
    files carrying a budget anchor; 3 writers of a budget table; 5 surfaces that total
    `budgetedCents`/`actualCents` without `summarize()` or `rollUpPortfolio()`, so the
    mixed-currency defect PAY-080-004 fixed on the portfolio page is still live on
    them; and 0 of the 36 canonical objects section 3 of the Bible requires. The 36 are
    read out of the Bible at derivation time, not copied, and checked against
    `model X {` in `apps/web/prisma/schema.prisma`.
  - False claim recorded: `modules/index.ts` marks the `budgeting` module's
    `state-machines-and-effective-dating` dimension `pass` because
    "apps/web/src/lib/finance.ts is the only writer". `finance.ts` imports no database
    client and writes nothing; the writers are `admin/actions.ts`, `approvals/actions.ts`
    and `orgs/[slug]/finance/actions.ts`. Correcting it means editing `modules/index.ts`,
    which is shared, so the inventory records the defect and does not touch the file.
  - Tests: `tests/architecture/pln-planning-inventory.test.mjs`, 8 tests, `node --test`
    at the repository root (`npm run test:platform` — 458 tests, mine are 216-223, all
    green; the 13 unrelated failures in that run are other domains' generators, none
    with a `pln-` name). It re-derives every table and compares byte-for-byte, checks
    each inventoried path exists and still carries its anchor, checks the
    Bible↔schema mapping from both ends, and asserts no CR, no native path and no
    absolute path reaches the output.
  - Mutations, 4 applied, 4 caught, all restored, suite green again after each:
    (1) created `apps/web/src/lib/pln-mutation-probe.ts` containing `budgetedCents` —
    the generator threw `these files carry a budget anchor and no note` and tests 1, 2
    and 8 failed (5 pass / 3 fail); deleted it, 8/8.
    (2) `| \`Scenario\` | **no** |` → `| \`Scenario\` | yes |` in the document — tests 1
    and 3 failed (6/2); regenerated, 8/8.
    (3) deleted the `approvals/actions.ts` row from section 3 — tests 1 and 4 failed
    (6/2); regenerated, 8/8. This mutation is why test 4 slices section 3 out of the
    document first: the first version searched the whole file, found the same path in
    section 1, and passed while section 3 had lost the row.
    (4) deleted `impact/page.tsx` from section 4 — tests 1 and 5 failed (6/2);
    regenerated, 8/8.
  - Scope: budget/planning code and the finance report surface. Dashboards and charts
    as a class belong to ANL-000-001 and are not claimed here.

- [ ] **PLN-000-002** — Implement canonical models, dimensions, measures, versions, scenarios, cells and lineage.
  - Status: BLOCKED_EXTERNAL
  - Blocked on: `apps/web/prisma/schema.prisma` and `apps/web/src/lib/tenancy/registry.ts`,
    both shared files this wave, plus a migration under `apps/web/prisma/migrations/`.
  - Evidence that the work is real and not started: `docs/architecture/pln-planning-inventory.md`
    section 5 shows 0 of 36 canonical objects present — no `PlanningModel`, `Dimension`,
    `DimensionMember`, `Hierarchy`, `Measure`, `TimeGrain`, `Scenario`, `PlanVersion`,
    `PlanningCell`, `DataSlice`, `DataLock` or any of the other 25 exists as a Prisma
    model. The requirement is persistence, so it cannot be met by TypeScript types: a
    declared interface with no table is the failure mode this programme has already
    shipped once.
  - The exact change that unblocks it: add the 36 models to `schema.prisma` with a
    migration, and classify every one of them in `registry.ts`. That second file is not
    optional — its own header states "Every model in schema.prisma must be classified
    into exactly one bucket below, and registry.test.ts reads schema.prisma and fails if
    any model is missing", so 36 new models red that suite until they are classified.
    Both files are on this wave's shared list, so this domain must not edit them. Once
    an owner of the schema has made the edit, the rest is:

    ```bash
    npm exec --workspace apps/web -- prisma migrate dev --name pln_planning_foundation
    npm run test --workspace apps/web -- --ci   # apps/web/src/lib/tenancy/registry.test.ts
    npm run test:platform
    ```

    Then PLN-000-003 can be built against the tables this creates.

- [ ] **PLN-000-003** — Implement typed calculation graph, cycles, sparse/incremental evaluation and deterministic replay.
  - Status: FAIL
  - Reason: not attempted in this batch, and honestly reported as unfinished rather than
    part-built. Nothing resembling a calculation graph exists: the whole of the planning
    arithmetic in this repository is `summarize()` in `apps/web/src/lib/finance.ts`
    (projected = actual, else `forecastCents`, else 0; variance = budgeted - projected)
    and `rollUpPortfolio()` beside it. There is no formula, so there is no dependency to
    extract, no cycle to detect and nothing to replay.
  - Why FAIL and not BLOCKED_EXTERNAL: the engine itself — a typed formula language,
    static dependency extraction, cycle detection, sparse evaluation over a coordinate
    space — needs no shared file and could be built now under `apps/web/src/lib/planning/`.
    It is left in the queue deliberately. What it could not have in this batch is a
    production caller or deterministic replay, because both need PLN-000-002's
    `CalculationRule`, `PlanningCell` and `PlanVersion` tables, and a library nothing
    calls is the "a type declares it" result this ledger exists to refuse.
  - Order: build PLN-000-002 first, then this against it.

- [ ] **PLN-000-004** — Import every `PLN-*` item into the canonical ledger.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-010-001** — Implement cycle/task/submission/review/approval/publish state machines.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-010-002** — Implement spreadsheet-grade accessible grid, model studio, scenario lab and review.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-010-003** — Implement locks, concurrency, bulk input, save/resume, comments and assignments.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-010-004** — Pass WCAG 2.2 AA, localization, themes, density and long-session tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-020-001** — Implement financial planning and Finance publication/reconciliation.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-020-002** — Implement workforce planning with HCM authority/privacy.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-020-003** — Implement sales/revenue, operational/supply, capital/project and cash plans.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-020-004** — Implement strategic and nonprofit/public/education planning modes.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-020-005** — Prove cross-plan dependencies and no duplicated master systems.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-030-001** — Implement spreading, allocations and top-down/bottom-up reconciliation.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-030-002** — Implement scenario compare, sensitivity and reproducible simulation.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-030-003** — Implement AWS-hosted forecast gateway, baselines, uncertainty, drift and human review.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-030-004** — Implement exact lineage and decision records through realized outcome.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-040-001** — Enforce model/cell/slice/version/action authorization across every surface.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-040-002** — Pass all twelve E2E scenarios and zero unexplained critical handoff variance.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-040-003** — Pass large-model performance, concurrency, failure, backup/restore and DR tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-040-004** — Instrument scorecard baseline/targets/results and competitor workflow benchmarks.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-040-005** — Publish exact model/domain/forecast/country limitations.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-GATE-000** — Multidimensional planning foundation is correct and tenant-safe.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-GATE-010** — Contributors and reviewers plan efficiently without spreadsheet chaos.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-GATE-020** — Enterprise plans connect strategy, resources, operations and finance.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-GATE-030** — Plans and predictions are transparent, reproducible and governable.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-GATE-040** — “Best” is claimed only for measured released scope.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented
