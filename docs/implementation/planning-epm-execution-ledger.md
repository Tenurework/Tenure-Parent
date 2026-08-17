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

- [x] **PLN-000-004** — Import every `PLN-*` item into the canonical ledger.
  - Status: PASS
  - Code: `tests/architecture/pln-requirements-are-imported.test.mjs`, 9 tests, and the guard IS the
    implementation — this requirement is about the register, so the thing that closes it is the check
    that keeps the register complete. Every fact comes from `tools/document-graph.mjs`'s own readers
    (`requirementsIn`, `ledgerStatuses`, `buildRegistry`, `classify`, `importedIds`), never a local
    regex over the Bible, because two parsers of one document will disagree and the loop acts on that
    one's answer.
  - Caller: `npm run test:platform` → `tools/run-platform-tests.mjs`, which runs every
    `tests/architecture/*.test.mjs` in CI. The Bible is read at the canonical path the GRAPH records
    (`docs/architecture/architecture-document-graph.yaml`, entry
    `tenure-planning-epm-and-decision-cloud-claude-bible-v1-0`), never at a hard-coded string, so a
    rename the graph knows about cannot make it pass from a file the graph does not consider
    authoritative.
  - What it checks, and what the WRK and INT siblings do not: the graph registers the Bible as an
    authority for `PLN`; the Bible states exactly 27 `PLN-*` requirements (a pinned literal — a count
    read from the file agrees with whatever the file says today, including after a section was
    deleted); the graph's `states_requirements` matches; all 27 have a row in this ledger; no invented
    id and no unqualified duplicate; no other ledger claims a `PLN` requirement; the generated
    registry owns exactly those 27 and every row resolves to the canonical path. **And the row's own
    title is the Bible's own sentence, collapsed on whitespace only.** Nothing else in the programme
    compares those two strings, and it is the check that decides whether "imported" means anything: a
    `PLN-030-001` retitled from "spreading, allocations and top-down/bottom-up reconciliation" to
    "spreading" is present, unique, correctly filed, and will one day be ticked for something the
    authority did not ask for. `tools/import-requirements.mjs` wrote them equal once; only a check
    keeps them equal, because the ledger is hand-edited for years and the Bible is not edited at all.
  - Tests: 9 tests, `node --test tests/architecture/pln-requirements-are-imported.test.mjs` — 9 pass,
    0 fail. All 27 titles matched the Bible verbatim on the first run.
  - Evidence — 4 mutations, 4 caught, each restored and re-run green:
    (1) deleted the `PLN-020-004` row from this ledger → `not ok 4 - every PLN requirement the Bible
    states has a row in the planning ledger`, `# pass 8 # fail 1`; restored → `# pass 9 # fail 0`.
    (2) retitled `PLN-030-001` to "Implement spreading." → `not ok 6 - every planning ledger row is
    titled with the sentence the Bible states`, 8/1; restored → 9/0. This is the mutation the WRK and
    INT siblings do not catch.
    (3) inserted an invented `- [ ] **PLN-050-001** — Implement the quantum planning cube.` → `not ok
    5 - the planning ledger invents no requirement and repeats none`, 8/1; restored → 9/0.
    (4) `const STATED_COUNT = 27` → `26` → `not ok 2 - the Planning Bible still states the
    requirements this pins`, 8/1; restored → 9/0.
  - Not claimed: this proves the 27 are queued and correctly stated, not that any of them is done.
    Twenty-four are `FAIL` or `BLOCKED_EXTERNAL` below, and that is the point of importing them.

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
  - Examined this wave. There is no planning surface to test: §10 of the Bible requires eight
    experiences — planning home, model studio, planning grid, scenario lab, review workspace,
    connected-plan map, board reporting, forecast/accuracy centre — and none of them exists.
    PLN-010-002, which builds them, is FAIL below. A WCAG run against the club finance dashboard would
    be a pass for a different requirement in a different domain.
  - The localization clause is separately and independently blocked, and this is measurable now:
    `docs/architecture/pln-planning-limitations.md` §4 derives that no internationalisation library is
    declared in `apps/web/package.json` (none of `next-intl`, `react-intl`, `i18next`,
    `react-i18next`, `@formatjs/intl`, `lingui`), that the default money format is `en-US`/`USD`, and
    that `formatCentsCompact` in `apps/web/src/lib/finance.ts` hardcodes `$` and divides by 100. Every
    string in the product is English in the source. Localizing a planning surface therefore needs a
    localization pipeline first, and that is a platform decision this domain does not own.
  - Unblocks when: PLN-010-002 ships a surface, and a localization pipeline exists to test it under.

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
  - Examined this wave and refused as a VACUOUS pass, which is the interesting part. The second clause
    — no duplicated master systems — is a property of this repository and a guard over it would pass
    today, because there are no planning tables at all to duplicate anything with
    (`docs/architecture/pln-planning-inventory.md` §5: 0 of 36 canonical objects present). A test that
    passes because the subject does not exist proves nothing and cannot be mutation-proven: there is
    no mutation of a planning model that makes it fail, since there is no planning model. Writing it
    would add a green check that will stay green through exactly the change it is supposed to catch.
  - The first clause cannot be attempted at all: `financial/workforce/sales/operations/capital`
    dependencies need plans on both ends, and seven of the eight §6 domains have none.
  - The one dependency that could be proven now is not this requirement's: `Budget.allocatedCents`
    (institution → club, top-down) against Σ `BudgetLine.budgetedCents` (club → institution,
    bottom-up). The engine for it shipped under PLN-030-001; it is a single-plan reconciliation, not a
    cross-plan dependency.
  - Unblocks when: two of the §6 domains exist, so a dependency has two ends. Then the guard is worth
    writing and can be mutation-proven by pointing one plan's driver at the other's master.

- [ ] **PLN-030-001** — Implement spreading, allocations and top-down/bottom-up reconciliation.
  - Status: FAIL
  - Why FAIL when most of it is built and proven: the sentence has three clauses and only the first
    has a production caller. Spreading is called; allocation and reconciliation are a library nothing
    imports, and this repository's rule is that a module nothing calls is not shipped. Recorded as
    FAIL with the code in the tree rather than PASS with a scope note, because a scope note is where
    "two of three" quietly becomes "done".
  - Code, shipped and real: `apps/web/src/lib/planning/spread.ts` (new) — `spread`,
    `assertRuleComplete`, `allocateDirect`, `allocateStepDown`, `allocateReciprocal`,
    `allocateActivityBased`, `reconcile`, `applyDecision`, `SpreadRuleError`, `SPREAD_BASES`,
    `REPRESENTABLE_UNITS`, `UNSUPPORTED_ALLOCATION_METHODS`, and the `SpreadRule` /
    `ReconciliationRecord` types. All six bases §7 names — even, proportional, driver, seasonal,
    historical, manual. Direct and step-down allocation. `SpreadRule` requires every one of the
    thirteen fields §7 lists (source, target, basis, exclusions, order, currency/unit, precision,
    zero/negative, effective period, owner, approval, test) and `assertRuleComplete` refuses blanks,
    because `owner: ""` satisfies TypeScript and defeats the point of requiring an owner. Every output
    cell carries `basis`, `weight`, `totalWeight`, `source` and `ruleId` — §7's "results drill to
    basis and original source".
  - Built on what exists: the split goes through `allocateByWeight` in `packages/finops/src/money.ts`,
    not a second largest-remainder implementation. A repository with two of those has two answers to
    "who got the leftover cent", and `packages/finops/src/split.ts` already carries the note about what
    that cost.
  - Caller, named, for the spreading clause: `apps/web/src/app/api/templates/budget/route.ts`. `GET`
    now takes `?total=`, parses it with the importer's own `parseMoneyToCents`, spreads it across the
    ten template categories, writes whole currency amounts into the Budgeted column the way
    `parseBudgetSheet` reads them, and writes the rule — id, target, source, basis, rounding,
    effective period, owner, approval — onto the Instructions sheet, so a pre-filled column arrives
    with its basis rather than as numbers nobody can defend. `basis=even` is the only basis the route
    offers, and not because the engine has one: the other five need a driver measurement, a season
    profile, last year's actuals per category or the club's own proposal, none of which that request
    has, and offering them would mean inventing the basis.
  - Caller, named, for the other two clauses: **none.** `allocateDirect`, `allocateStepDown`,
    `reconcile` and `applyDecision` are imported by their tests and by nothing else. The natural
    production home for the reconciliation is the surface that shows a club its allocated total
    (`Budget.allocatedCents`, written only by `apps/web/src/app/(app)/admin/actions.ts`) against the
    sum of its proposed lines (`BudgetLine.budgetedCents`, written by
    `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts`) — a top-down/bottom-up pair that already
    exists in the schema and that nothing reconciles today. Both of those files, and
    `apps/web/src/lib/finance.ts`, are claimed by the financial-management, payments-treasury and
    global-engine ledgers, so this domain did not edit them in a wave with twelve agents in the tree.
    That is a sequencing constraint, not a missing capability: the next wave wires it in one file.
  - Refused rather than faked: `allocateReciprocal()` and `allocateActivityBased()` throw, naming what
    each would need — simultaneous equations over an inter-service consumption matrix that no table
    holds, and an activity model with cost drivers, which is `Driver` and `Measure`, two of the 36
    objects PLN-000-002 has not built. §7 says "where supported"; degrading either to step-down would
    return a number that is wrong and looks right.
  - Not persisted, and it cannot be in this wave: there is no `SpreadRule`, `AllocationRule` or
    `Reconciliation` table — `docs/architecture/pln-planning-inventory.md` §5 records 0 of 36
    canonical objects present — and no schema change was permitted. A rule is a value a caller
    constructs. It is complete, validated and traceable; it is not durable.
  - Tests: 41 tests in `apps/web/src/lib/planning/spread.test.ts` plus 8 in
    `apps/web/src/app/api/templates/budget/target-spread.test.ts`, all green:
    `cd apps/web && npx jest src/lib/planning/spread.test.ts` → `Tests: 41 passed, 41 total`;
    `npx jest src/app/api/templates/budget/target-spread.test.ts` → `Tests: 8 passed, 8 total`. The
    route test asserts against the generated workbook parsed back out, not the engine's return value,
    because the failure it is aimed at lives in the gap between them — cents divided by the wrong
    power of ten, shares in the wrong column, a Total row double-counted.
    `npx tsc --noEmit -p apps/web/tsconfig.json` → no output. `npx eslint` on all four files → no
    output.
  - Evidence — 10 mutations, 10 caught, each restored and re-run green. Engine (6):
    (1) `allocateByWeight(...)` → independent per-share `Math.floor` → 5 tests failed including
    `splits an indivisible target so the parts add back to exactly the target`, `Tests: 5 failed, 36
    passed`; restored → 41/41.
    (2) the all-zero-basis refusal `if (totalWeight === 0)` → `=== -12345` → `× refuses a basis that
    measured zero everywhere instead of splitting evenly`, 1 failed / 40 passed; restored → 41/41.
    (3) the manual-sum check `if (total !== targetMinorUnits)` → `=== -98765` → `× refuses a manual
    spread that does not add to the target instead of reweighting it`, 1/40; restored → 41/41.
    (4) step-down `pools.slice(index + 1)` → `pools.filter(p => p.id !== pool.id)`, i.e. charging a
    closed pool backwards → `× steps down in order: an earlier pool charges a later one, never the
    reverse`, 1/40; restored → 41/41.
    (5) `bottomUpTotalMinorUnits: bottomTotal` → `topTotal`, i.e. the target overwriting the proposal
    → 3 tests failed including `× keeps both sides and never overwrites either`; restored → 41/41.
    (6) excluded members dropped instead of recorded at zero → `× records an exclusion at zero rather
    than dropping the member`, 1/40; restored → 41/41.
    Caller (4): (7) the cents→major-unit divisor set to 1 → 2 tests failed; (8) `spread()`'s result
    replaced by `Math.round(targetCents / CATEGORIES.length)` → `× spreads an indivisible target to
    the cent, without losing one`; (9) the rule no longer written into the workbook → `× writes the
    rule that filled the column into the workbook`; (10) a `SpreadRuleError` returned as 503 instead
    of 400 → `× refuses a negative target, in the engine's own words`. Each 1 failed / 7 passed except
    (7); all restored → `Tests: 8 passed, 8 total`.
  - Also changed, and both are shared files, additively: `tools/ownership-map.mjs` gains
    `apps/web/src/lib/planning/` under `erp-modules` (the ownership guard fails on any unclaimed
    source file, and it was already failing on three files this domain did not write), and
    `docs/architecture/ownership.md` was regenerated with `node tools/ownership-map.mjs`.
    `tools/pln-planning-inventory.mjs` — this domain's own — gains notes for `spread.ts` and for
    `packages/finops/src/general-ledger.ts`, which arrived from FIN mid-wave carrying a budget anchor
    and was reding PLN-000-001's guard.
  - What the next wave does: import `reconcile` where `Budget.allocatedCents` and the sum of
    `BudgetLine.budgetedCents` are already both on screen, and this becomes PASS without further
    engine work.

- [ ] **PLN-030-002** — Implement scenario compare, sensitivity and reproducible simulation.
  - Status: FAIL
  - Examined this wave as the natural neighbour of PLN-030-001 and not attempted, for a reason that is
    about the requirement rather than about time. Comparing two scenarios needs two scenarios: the
    schema has no `Scenario` and no `PlanVersion` (`docs/architecture/pln-planning-inventory.md` §5),
    and `BudgetLine`'s grain is `organizationId`/`academicYear`/`category` with a single
    `forecastCents` column — so the same category cannot hold a base case and a worst case at once.
    There is nothing to put on either side of a comparison, and a comparison engine over inputs a
    caller invents would be a demo.
  - Sensitivity has the same shape one level down: it varies a driver and re-evaluates, and there is no
    driver and no calculation graph (PLN-000-003, FAIL below — the whole of the planning arithmetic
    before this wave was `summarize()` in `apps/web/src/lib/finance.ts`).
  - The reproducibility clause is the one part that could have been built now — a seeded, deterministic
    simulation whose run is replayable from its recorded seed and inputs. It was not, because a
    reproducible run of a model that does not exist is a reproducible run of nothing, and
    `SimulationRun` has nowhere to be stored.
  - Order: PLN-000-002 (the tables), then PLN-000-003 (the graph), then this against both.

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
  - Examined this wave and deliberately not attempted, with the reason, because "instrument" is the
    verb and a document is not one. §15 of the Bible lists 13 measures. Twelve of them —
    cycle duration, contributor time, time from actual refresh to reforecast, model change lead time,
    forecast accuracy by horizon, unexplained variance, percentage of values with complete lineage,
    scenario turnaround, task success and grid error rate, plan-to-execution consistency, calculation
    performance at scale, successor comprehension time — are measurements of PEOPLE USING A PLANNING
    SYSTEM OVER TIME. There is no planning system (`docs/architecture/pln-planning-limitations.md` §2:
    seven of the eight domains absent), so there is no cycle to time, no forecast to score and no
    contributor to observe. The thirteenth, cost per model/cell/job, needs metering per planning
    object and there are no planning objects.
  - What could have been shipped and was refused: a generated `pln-scorecard.md` in the shape of
    PLN-000-001 and PLN-040-005, with 12 rows reading "no instrument exists". That would be an honest
    document and it would not instrument anything, and filing it as PASS against a requirement whose
    verb is "instrument" is exactly the substitution this ledger exists to refuse. It would also
    duplicate PLN-040-005, which already publishes the absence with derived evidence.
  - The competitor half is separately blocked and differently: §15 requires benchmarking against
    Workday Adaptive Planning, SAP Analytics Cloud Planning, Oracle EPM and Intuit Enterprise Suite
    "using public/lawful evidence", with named Intuit scenarios. A benchmark needs a released scope to
    benchmark and lawful access to compare against; neither exists, and PLN-GATE-040's own sentence —
    "'Best' is claimed only for measured released scope" — is the instruction not to fabricate it.
  - Unblocks when: PLN-000-002 (schema) and PLN-010-001 (cycles) exist, so a cycle has a start and an
    end and a contributor has a task; then baseline/target/result become numbers a job can record.

- [x] **PLN-040-005** — Publish exact model/domain/forecast/country limitations.
  - Status: PASS
  - Code: `tools/pln-planning-limitations.mjs` derives `docs/architecture/pln-planning-limitations.md`
    — four sections, one per axis the requirement names, plus a fifth stating what the generator
    cannot see. Exported derivations: `deriveGrain`, `deriveFields`, `deriveBibleList`,
    `deriveRequiredDimensions`, `deriveRequiredUnits`, `deriveRepresentableUnits`, `deriveDomains`,
    `deriveDomainVerdicts`, `deriveRejectedProbes`, `deriveForecastEvidence`,
    `deriveCurrencyExponents`, `deriveDefaultMoneyFormat`, `deriveCompactFormatter`,
    `deriveBudgetPeriods`, `deriveI18nDependencies`, `render`.
  - Caller: the guard `tests/architecture/pln-planning-limitations.test.mjs`, run by
    `npm run test:platform`; the document is committed and regenerated with
    `node tools/pln-planning-limitations.mjs`. It reuses `sweptFiles()`, `readText`, `BIBLE`,
    `SCHEMA` and `SCAN_ROOTS` from `tools/pln-planning-inventory.mjs` rather than growing a second
    walker — `sweptFiles` was extracted from `deriveCode`/`deriveTests` in that file for this, and
    those two are byte-identical afterwards (its 8 tests stayed green across the refactor).
  - The word that decides whether this is worth anything is "exact". A hand-written limitations page
    is adjectives — "planning support is currently limited" is true of a repository with a full EPM
    engine and true of one with none — and it ages in the direction that flatters. So every number
    and verdict is derived, and the guard re-derives the whole document and compares byte for byte.
  - What it publishes, all derived: **model** — the planning grain read from `@@unique` on
    `BudgetLine` (`organizationId`, `academicYear`, `category`) and `Budget`, against the 18
    dimensions §4.1 requires read out of the Bible, and 1 of the 9 unit kinds §4.2 requires
    representable, because every measure column is an `Int` of cents; **domain** — all 8 subsections
    of §6, probed, 7 absent and `6.8` partial; **forecast** — 11 statistical identifiers swept over
    every source file with zero hits, all 4 forecast objects absent from the schema, and
    `saveForecast` read to show `forecastCents` is a number a human typed; **country** — the 26
    currency codes whose minor-unit exponent `packages/finops/src/money.ts` knows (everything else
    defaults to 2, a hundredfold error for a code outside them whose minor unit is not a hundredth),
    no `ExchangeRateSet`, default locale `en-US`, `formatCentsCompact` read to show it hardcodes `$`
    and /100, `BudgetPeriod`'s 3 values as the only fiscal calendar, and no i18n library declared.
  - "We looked and found nothing" is kept apart from "we could not look" three ways: a probe is a
    NECESSARY condition (zero hits proves absence, hits do not prove presence, so hits print their
    files and the note says what they actually do); probe tokens are compound identifiers, with the
    rejected single words published beside a file each still hits; and §5 names the generator's own
    blind spots — runtime data, whether an absence is wrong, prose outside `.ts`/`.tsx`/`.mjs`, and
    capabilities named something nobody guessed.
  - It caught a live drift while being written: `incomeStatement` and `balanceSheet` hit
    `packages/finops/src/general-ledger.ts`, which FIN-010-003 landed during this wave. The §6.1 note
    had said "no statement integration"; the probes were narrowed to planning tokens
    (`plannedBalanceSheet`, `capexPlan`, …) and the note now separates Finance's record-to-report over
    posted lines from a projected statement, which is the distinction §6.1 is actually about.
  - Refusals, and they are the load-bearing part: the generator throws when a §6 domain has no probe
    set or no note, when a note or probe set names a domain the Bible does not state, when a note says
    `Absent` over a probe hit or claims something over zero hits, and when the currency tables, the
    default money format, the compact formatter, either `@@unique` or either parsed Bible sentence is
    not where it looks. The document deliberately does NOT print a count of files swept: that number
    moved from 937 to 941 in one minute of this wave and carries no claim, so it would be churn
    wearing the clothes of evidence. The `grant` hit count was published for the same reason and
    withdrawn for the same one — 178, then 179 a minute later.
  - Tests: 11 tests, `node --test tests/architecture/pln-planning-limitations.test.mjs` — `# pass 11
    # fail 0`, stable over 3 consecutive runs. Four of the substantive claims are re-checked a second,
    deliberately independent way rather than through the generator: the grain is re-read from
    `schema.prisma`, every currency code is re-checked against `money.ts`, every path the page names
    is opened and re-matched, and the 11 statistical identifiers are re-swept. The missing-probe-set
    refusal is exercised by deleting a key from `DOMAIN_PROBES` and restoring it.
  - Evidence — 5 mutations, 5 caught, each restored and re-run green:
    (1) hand-edited the page: `Exponents known for 26 currency codes` → `99` → `not ok 1 - the
    committed limitations page is exactly what the tree derives`, `# pass 9 # fail 1`; restored → 10/0.
    (2) `6.8`'s probes → `["nonprofitFundPlan"]` (hits nothing) while its note still claims two
    capabilities → `not ok 4 - a note claiming Absent is checked against the sweep` + `not ok 1`,
    8/2; restored → 10/0.
    (3) created `apps/system-studio/src/lib/pln-mutation-probe.ts` containing `linearRegression` →
    `not ok 8 - the statistical identifiers the page says appear nowhere appear nowhere` + `not ok 1`,
    8/2; deleted it → green.
    (4) `const probes = DOMAIN_PROBES[domain]` → `?? []`, i.e. an unprobed domain reading as absent →
    `not ok 3 - a domain with no probe set is refused, not silently reported absent`, 10/1; restored
    → 11/0.
    (5) `enrollment`'s exemplar path → `packages/finops/src/money.ts`, which does not contain it →
    `not ok 6 - every rejected probe still hits the file the page says it hits` + `not ok 1`, 9/2;
    restored → 11/0.
  - Regeneration: `node tools/pln-planning-limitations.mjs`. The page is stale by design when the code
    it describes changes; that is the cost of exact numbers, and it is stated on the page itself.

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
