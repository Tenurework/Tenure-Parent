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

- [ ] **PLN-000-001** — Inventory current budget/planning/report code and false EPM claims.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-000-002** — Implement canonical models, dimensions, measures, versions, scenarios, cells and lineage.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **PLN-000-003** — Implement typed calculation graph, cycles, sparse/incremental evaluation and deterministic replay.
  - Status: FAIL
  - Reason: imported from `Tenure_Planning_EPM_and_Decision_Cloud_Claude_Bible_v1.0.md`; not yet implemented

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
