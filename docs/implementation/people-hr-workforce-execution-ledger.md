# People, HR and Workforce Cloud — execution ledger

Every `HCM-*` requirement stated by `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`.

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

- [x] **HCM-000-001** — Inventory current people/member/seat/role/onboarding logic and false HCM claims.
  - Status: PASS
  - Code/config: `tools/hcm-people-inventory.mjs`,
    [`../architecture/hcm-people-inventory.md`](../architecture/hcm-people-inventory.md),
    `tests/architecture/hcm-people-inventory-is-current.test.mjs`
  - Evidence: generated from the tree, not written from memory. **52 Prisma models
    read, 9 classified as people-domain, 6 derived as owning a relation into the
    workforce core; 23 modules verified by path and anchor; 45 canonical objects
    parsed from §4 of the source document and bound — 1 PRESENT, 7 PARTIAL, 37
    ABSENT; 10 claims audited by opening the file.** Run
    `node tools/hcm-people-inventory.mjs --check` and
    `node --test tests/architecture/hcm-people-inventory-is-current.test.mjs`
    (10 tests, 10 pass).
  - Tests: **4 mutations applied, run, and all 4 caught** after the check was
    strengthened. (1) Deleting the `SeatHolding` row from `PEOPLE_MODELS` →
    "`SeatHolding` declares a relation into the workforce core (DirectoryPerson,
    Role) and is classified by neither". (2) Renaming every occurrence of
    `releaseToSuccessor` in `packages/organization-model/src/succession-release.ts`
    → "no longer contains its anchor"; the file was restored byte-identical
    (sha256 `83da7134e4b6e5ac…` before and after). (3) Hand-editing the generated
    document's headline from `1 PRESENT` to `9 PRESENT` → stale, plus the
    headline assertion. (4) Deleting the `HRCase` binding → "names canonical
    object `HRCase` and this inventory does not bind it".
  - **A guard that could not fail, found and fixed in this session.** The first
    version of the anchor check used `String.includes`, and mutation (2) —
    renaming `releaseToSuccessor` to `releaseToSuccessorRENAMED` — left the
    substring behind and read GREEN over a tree that had changed. `anchorPresent`
    now bounds an anchor on any side that ends in a word character, and
    `tests/architecture/hcm-people-inventory-is-current.test.mjs` asserts the
    superstring rename is rejected. No check was disabled to iterate.
  - The three findings that change what can honestly be claimed:
    1. **84 of the 89 symbols `packages/organization-model` exports are imported
       by nothing outside the package.** Every assignment-state,
       bitemporal-correction, position-lifecycle and succession-release export is
       unreached; the 5 that non-test code takes are topology and graph
       construction. The modelling that would answer "what did the organisation
       look like in March" is written, tested, and connected to no caller.
       `apps/web/src/lib/org/projection.ts` is imported only by its own test.
    2. **One human is two rows and one placement is two rows.** `DirectoryPerson`
       and `User` are joined by email — in a repository that already runs
       `tests/security/email-is-not-a-key.test.mjs`. `RoleAssignment` (dates) and
       `SeatHolding` (academic-year strings) are two answers to one question with
       nothing reconciling them.
    3. **No surface in `apps/web` claims payroll, benefits, time, absence,
       compensation, recruiting or performance.** The false-claim risk here is
       not in the product; it is three unresolved contradictions between
       documents, recorded in the audit — including
       `docs/architecture/PLATFORM-ARCHITECTURE.md`'s "Do not build payroll.
       Ever." against §3.10's `TENURE_NATIVE_CERTIFIED` mode.

- [ ] **HCM-000-002** — Implement distinct person/worker/member/job/position/seat/assignment models and migrations.
  - Status: BLOCKED_EXTERNAL
  - Reason: every model and every migration this requirement asks for lands in
    `apps/web/prisma/schema.prisma` and `apps/web/prisma/migrations/`, and the
    schema is a shared file this agent must not edit while sixteen other domain
    agents hold the same worktree — a conflict there loses another domain's work
    rather than adding this one's. That alone is a wave-scoped block. The block
    that is **not** wave-scoped is the design: `docs/architecture/REVIEW-FINDINGS.md`
    P0-8 records three mutually exclusive target schemas all marked "Build now" —
    `Role`→`Seat` with `@@map("Role")`, a `person`/`position`/`role_assignment`
    rewrite of every PK and FK, and "do not rename" — and its own fix is "delete
    two". Adding `Worker`, `Job`, `Position` and a unified `Assignment` on top of
    an undecided base is implementing a known-broken design, which `CLAUDE.md`
    forbids in as many words. P0-10 compounds it: `person`, `position` and
    `role_assignment` appear in no RLS list, so new people tables have no
    isolation story either.
  - Unblocked by, in order: (a) an ADR choosing one of P0-8's three schemas and
    saying what happens to `RoleAssignment` vs `SeatHolding` — so that this
    blocker becomes false the day somebody writes it, and a checker can see that:

    ls docs/decisions/hcm-0001-person-worker-and-assignment-model.md   # absent on 2026-08-14

    (b) a wave in which this domain owns `apps/web/prisma/schema.prisma`,
    `apps/web/src/lib/tenancy/registry.ts` (new models must be registered or they
    are unscoped) and `apps/web/prisma/migrations/`; (c) then
    `npx prisma migrate dev --name hcm_person_worker_assignment` against the
    Postgres in `CLAUDE.md`, followed by `npm run test:platform` and
    `npm run test --workspace apps/web -- --ci`.
  - Evidence for the gap itself, so this is not taken on trust:
    [`../architecture/hcm-people-inventory.md`](../architecture/hcm-people-inventory.md)
    §4 records `Worker`, `EmploymentRelationship`, `Job` and `JobFamily` ABSENT
    and §5 records `Person` and `Assignment` SPLIT WRONGLY, each derived from
    `apps/web/prisma/schema.prisma` by `tools/hcm-people-inventory.mjs`.

- [ ] **HCM-000-003** — Implement effective-dated workforce structures and historical reconstruction.
  - Status: BLOCKED_EXTERNAL
  - Reason: the *structures* — legal employer, business unit, department, cost
    centre, location, grade ladder, collective group, position hierarchy — do not
    exist as tables, and creating them is `HCM-000-002`'s blocked schema work.
    `HCM-000-002` is BLOCKED_EXTERNAL, and this requirement cannot be built ahead
    of the tables it would date. The *mechanism* is already written and reaches no
    caller, so building more of it would add unreached code rather than close
    this: `packages/organization-model/src/bitemporal.ts` (`resolveAsOf`,
    `correct`, `factHistory` — valid time, record time, corrections that preserve
    prior truth) and `packages/organization-model/src/graph.ts` (`asOf`) are among
    the 84 of 89 exports imported by nothing outside the package, measured in
    [`../architecture/hcm-people-inventory.md`](../architecture/hcm-people-inventory.md)
    §3. What effective dating does exist is per-row and partial —
    `Seat.effectiveFrom`/`effectiveUntil`/`retiredAt`,
    `InstitutionMembership.effectiveFrom`/`effectiveUntil`,
    `RoleAssignment.startDate`/`endDate` — with no bitemporal record period and no
    as-of query anywhere in `apps/web`.
  - Unblocked by: `HCM-000-002` reaching PASS, then the same wave owning
    `apps/web/prisma/schema.prisma` for a record-period column pair and
    `apps/web/src/lib/db.ts` for an as-of read path. Both are shared files this
    agent must not edit. Verified afterwards by
    `npm run test --workspace apps/web -- --ci` with an integration test that
    reconstructs a past org structure from a correction.

- [ ] **HCM-000-004** — Import every `HCM-*` item into the canonical ledger.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-010-001** — Implement full worker/member assignment transaction families and corrections.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-010-002** — Implement position/headcount/FTE/funding controls and reorganizations.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-010-003** — Implement onboarding, transition, overlap and offboarding journeys.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-010-004** — Implement mass actions with preview, approval, idempotency and per-record outcome.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-020-001** — Implement requisition-to-hire with consent, retention and accessible candidate UX.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-020-002** — Implement goals, feedback, reviews, calibration and development.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-020-003** — Implement skills/profiles/licenses, learning and succession.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-020-004** — Pass fairness/privacy/human-decision guardrails.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-030-001** — Implement time/schedule/attendance and exception controls.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-030-002** — Implement absence eligibility/accrual/balance/request/correction.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-030-003** — Implement compensation elements/cycles/budgets/guidelines/approvals.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-030-004** — Implement benefit eligibility/enrollment/provider contracts.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-030-005** — Implement exact payroll capability modes, run exchange and reconciliation.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-040-001** — Enforce field/domain/purpose-level authorization across API/UI/search/export/analytics/Relay.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-040-002** — Deliver employee, manager, HR, recruiter and candidate experiences with WCAG 2.2 AA.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-040-003** — Implement private-person versus inheritable-seat memory boundary and transition experience.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-040-004** — Implement safe People Relay tools and evaluations.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-040-005** — Pass long-session, localization, mobile and visual-regression tests.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-050-001** — Implement jurisdiction-pack applicability and truthful availability.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-050-002** — Certify enabled identity/payroll/benefits/recruiting/time/learning integrations.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-050-003** — Pass all twelve E2E scenarios, isolation, performance, DR and provider-failure tests.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-050-004** — Instrument the best-system scorecard and record baseline/target/results.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-050-005** — Publish exact supported capability/jurisdiction/provider matrix and limitations.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-GATE-000** — Core people truth is correct and tenant-safe.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-GATE-010** — Workforce change is effective-dated, controlled and recoverable.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-GATE-020** — Talent lifecycle works without unsafe automated judgment.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-GATE-030** — Workforce value flows are exact-scope, controlled and reconciled.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-GATE-040** — People Cloud is safe, humane and memory-first.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-GATE-050** — Superiority is claimed only where measured evidence passes.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented
