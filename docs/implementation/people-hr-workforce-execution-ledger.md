# People, HR and Workforce Cloud — execution ledger

Every `HCM-*` requirement stated by `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`.

Seeded by `tools/import-requirements.mjs`. **Every entry is `FAIL` and
unchecked**, which is the truthful starting state: import is not progress. A
requirement becomes `PASS` when somebody builds it, proves it by mutation, and
records the evidence here — never because a script wrote a row for it.

**Current state, 2026-08-17:** of the 33 requirements the Bible states, 4 are
PASS (`HCM-000-001` inventory, `HCM-000-004` import completeness, `HCM-040-003`
the seat-memory boundary, `HCM-050-005` the published capability matrix), 4 are
BLOCKED_EXTERNAL each naming the ADR or the schema wave that unblocks it, and 25
are FAIL. That count is a summary of the rows below, which are the record; the
registry derives its own answer from them and
`tests/architecture/hcm-ledger-import-is-complete.test.mjs` refuses a row this
file writes that the Bible does not state, or a status the loop cannot act on.

The three boxes ticked in this pass will red
`tests/architecture/a-ticked-box-is-a-passing-requirement.test.mjs` until
`docs/architecture/capability-completeness-registry.yaml` is regenerated, because
that guard reads the registry and the registry is generated from these rows. Nine
of the twelve ledgers in this wave are in the same state; `npm run generate` is the
step that clears it, and it is deliberately not run from inside a domain pass —
regenerating a shared artifact while eleven other ledgers are half-written would
publish somebody else's unfinished sentence as the programme's status.

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
       **Updated 2026-08-17 by HCM-040-003, which is what a measurement is for:
       the generated inventory now reads 76 of 89, and the module attribution it
       publishes is derived rather than written — `continuity`, `graph`,
       `succession-release` and `topology` are reached by non-test code;
       `assignment-states`, `bitemporal` and `position-lifecycle` are still
       reached by nothing.** The prose that used to follow the headline ("the N
       that non-test code does reach are all topology and graph construction")
       became false the moment that happened, so `exportsBySourceModule` in
       `tools/hcm-people-inventory.mjs` now derives it from `index.ts`'s own
       `from "./module"` grouping. A generated document must not carry a
       hand-written claim about its own numbers.
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

- [x] **HCM-000-004** — Import every `HCM-*` item into the canonical ledger.
  - Status: PASS
  - Code: `tests/architecture/hcm-ledger-import-is-complete.test.mjs`, which reads
    the Bible with the document graph's own `requirementsIn` (no second parser)
    and this ledger's rows, and asserts six properties: all 33 stated ids have a
    canonical row; no row names an id no Bible states; no id has two canonical
    rows; every canonical row quotes the requirement's own sentence; no other
    ledger in `docs/implementation` holds an `HCM-*` row; and every row declares
    one of `tools/document-graph.mjs`'s four decidable statuses.
  - Caller: `tools/run-platform-tests.mjs` discovers every `tests/**/*.test.mjs`
    (`tools/run-platform-tests.mjs:28-36`), so `npm run test:platform` runs it,
    and `.github/workflows/ci.yml` runs that as the "Platform tests" step. It is
    a CI check by existing, not by being registered anywhere.
  - Why this was FAIL and is now PASS. The rows existed — `tools/import-requirements.mjs`
    wrote them — and the row said "not yet implemented", which was
    self-contradictory. What did not exist was anything that would notice if one
    went away. "Imported" is not a state reached by having run a script once:
    `ledgerStatuses()` keys a `Map` by id, so a second row silently overwrites
    the first; `buildRegistry()` iterates documents rather than ledgers, so a row
    for an invented id is invisible; `importedIds()` scans all of
    `docs/implementation`, so an `HCM-*` row filed in the identity, Simon-absorption
    or work-graph ledger still counts as imported; and nothing anywhere compared a
    row's sentence to the Bible's.
  - Tests: `node --test tests/architecture/hcm-ledger-import-is-complete.test.mjs`
    — 6 tests, 6 pass.
  - Evidence: **3 mutations, applied one at a time to this ledger, run, and all 3
    caught**; the file was restored byte-identical after each (`diff` clean).
    (1) Deleted the whole `HCM-030-005` row → `not ok 1 - the Bible and the ledger
    state the same HCM requirements` / "stated by the Bible, no canonical row in
    docs/implementation/people-hr-workforce-execution-ledger.md". (2) Narrowed that
    row's sentence to "Implement payroll capability modes." → `not ok 3 - each
    canonical row quotes the Bible's own sentence`, printing `ledger: Implement
    payroll capability modes.` against `Bible: Implement exact payroll capability
    modes, run exchange and reconciliation.` (3) Changed its status to `PARTIAL`
    → `not ok 6 - every HCM row declares a status the loop can act on` /
    `HCM-030-005 — PARTIAL`. Restored: 6 pass, 0 fail.
  - Known duplication, recorded rather than fixed here: the row parser is a third
    copy of the one in `fin-ledger-import-is-complete.test.mjs` and
    `ier-ledger-import-is-complete.test.mjs`. Extracting the three needs a wave in
    which one agent owns all three files; editing another domain's guard from this
    one is how a shared helper lands half-migrated.

- [ ] **HCM-010-001** — Implement full worker/member assignment transaction families and corrections.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-010-002** — Implement position/headcount/FTE/funding controls and reorganizations.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-010-003** — Implement onboarding, transition, overlap and offboarding journeys.
  - Status: FAIL
  - Considered; one of the four nouns is now real and three are not, which is a
    FAIL. **Transition** and **overlap** hold: `RoleAssignment.status` gives
    ACTIVE/SHADOW/ALUMNI as the incoming/current/outgoing overlap states,
    `apps/web/src/app/(app)/orgs/[slug]/handoff/page.tsx` renders the transition
    packet, and `HCM-040-003` made the handover a per-card decision with the
    withheld items and their reasons shown rather than a count.
  - **Onboarding** and **offboarding** are journeys — preboarding, documents,
    attestations, training, equipment and access requests, provider tasks,
    milestone readiness, then work transfer, access and device revocation,
    retention and an exit case. Every one of those is a persisted task with a
    state, an owner and a due date. `OnboardingJourney` is ABSENT in
    `docs/architecture/hcm-capability-matrix.md` §1, and the packet this platform
    shows is assembled at read time and stored nowhere, so nothing records what a
    past handover actually completed. That needs tables; NO SCHEMA CHANGES THIS
    WAVE. Blocked behind `HCM-000-002`'s schema decision in the same way.

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
  - Status: BLOCKED_EXTERNAL
  - Considered in this wave and refused, for two reasons that are not effort.
    (a) **The mode is already published, and it is `UNAVAILABLE`.**
    `docs/architecture/hcm-capability-matrix.md` §2 reports all five §3.10 modes
    with `UNAVAILABLE` in force for every legal entity and population, derived
    from `PayrollRelationship`, `PayrollInput` and `PayrollRunReference` all being
    ABSENT and from zero payroll connectors in the catalog. Nothing further can be
    claimed truthfully without building the thing.
    (b) **Run exchange and reconciliation need the three objects, and every one of
    them is a table.** NO SCHEMA CHANGES IN THIS WAVE, and a payroll run,
    calculation result, provider acknowledgement and settlement cannot be modelled
    in memory: the whole requirement is that a generated file is not a payment
    until an acknowledgement says so, which is a persisted state machine or it is
    nothing.
  - The blocker that is not wave-scoped: `docs/architecture/PLATFORM-ARCHITECTURE.md`
    says **"Do not build payroll. Ever."** and §3.10 of the People Bible specifies
    a `TENURE_NATIVE_CERTIFIED` mode. Two authorities, opposite instructions, and
    `CLAUDE.md` forbids implementing a known-broken design. Recorded as
    contradiction 1 in `docs/architecture/hcm-people-inventory.md`.
  - Unblocked by, in order: (a) an ADR choosing one — so this blocker becomes
    false the day somebody writes it, and a checker can see that:

    ls docs/decisions/hcm-0002-payroll-boundary.md   # absent on 2026-08-17

    (b) if the answer is `EXPORT_ONLY` or above, a wave owning
    `apps/web/prisma/schema.prisma` and `apps/web/src/lib/tenancy/registry.ts`
    (an unregistered model is an unscoped model) for the payroll objects, then
    `npx prisma migrate dev --name hcm_payroll_boundary`, `npm run test:platform`
    and `npm run test --workspace apps/web -- --ci`. (c) If the answer is "never",
    this row becomes NOT_APPLICABLE and §3.10 becomes a documented exclusion — and
    the matrix already says so.

- [ ] **HCM-040-001** — Enforce field/domain/purpose-level authorization across API/UI/search/export/analytics/Relay.
  - Status: FAIL
  - Considered in this wave; a real slice of it landed under `HCM-040-003` and it
    is nowhere near the whole sentence, so this stays FAIL rather than being
    quietly upgraded. What now holds across UI, search and the Relay corpus from
    one gate: seat-scoped memory is classified per record and an incoming holder
    inherits only what the seat may pass on (`apps/web/src/lib/memory.ts` →
    `apps/web/src/lib/people/seat-memory-boundary.ts`), which is
    domain-and-classification level on one object. Read-time authorization
    (`authorizeRetrieved`) and §3.4 projection modes
    (`apps/web/src/lib/relay/projection-policy.ts`) already cover search and the
    model boundary for the five corpus kinds.
  - What is missing, precisely: (1) **purpose** is not a dimension of any people
    decision — `TenantPurpose` exists for corpus entry points, not for
    person-field access; (2) **export and analytics** are unreached by the memory
    boundary — `apps/web/src/lib/platform/tenant-export.ts` and
    `apps/web/src/lib/analytics/` do not consult it, which is the surface a
    classification control most often leaks through; (3) **field-level** redaction
    has no people-field registry at all, because the compensation, medical,
    relations and recruiting domains §6 names have no columns to redact
    (`docs/architecture/hcm-capability-matrix.md` §1: 37 canonical objects
    ABSENT); (4) **HR duty separation** cannot exist without an HR role, and
    `InstitutionRole` has none.
  - So the honest order is: `HCM-000-002` (the objects), then a purpose dimension
    on the people read paths, then export/analytics wiring, then a field registry.
    Items (1) and (2) are buildable without a schema change and are the best next
    slice for this row.

- [ ] **HCM-040-002** — Deliver employee, manager, HR, recruiter and candidate experiences with WCAG 2.2 AA.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [x] **HCM-040-003** — Implement private-person versus inheritable-seat memory boundary and transition experience.
  - Status: PASS
  - Code: `apps/web/src/lib/people/seat-memory-boundary.ts` — `SeatMemoryCard`,
    `SeatStanding`, `classifySeatMemory`, `inheritsToSuccessor`, `SHADOW_WINDOW`,
    `successorHandoffPacket`. It maps this schema's `MemoryRecord` (`type`,
    `sensitivity`) onto `@tenure/organization-model`'s release vocabulary and
    delegates the decision to `releaseToSuccessor` / `planHandover`; it does not
    re-decide it. The sensitivity ladder is `sensitivityRank` from
    `apps/web/src/lib/search.ts`, reused rather than restated, because two ladders
    would be two answers to "is this card restricted".
  - Caller: `apps/web/src/lib/memory.ts:47` — `canSeeMemoryCard` calls
    `inheritsToSuccessor(card)` for a viewer whose only basis is being the seat's
    INCOMING (`SHADOW`) holder. That function is the single memory gate the
    application already had, and it is reached from
    `apps/web/src/app/(app)/orgs/[slug]/memory/page.tsx:63` (the memory surface)
    and `apps/web/src/lib/search-data.ts:243` (the corpus behind `/search`,
    `/api/search` and `/api/ai/chat`), so the boundary applies to UI, search and
    the Relay corpus from one place. The transition surface
    `apps/web/src/app/(app)/orgs/[slug]/handoff/page.tsx:64,192` calls
    `successorHandoffPacket`.
  - What was actually wrong. The branch read
    `status === "ACTIVE" || status === "SHADOW"`, so an incoming officer whose
    term had not begun could read **every** card scoped to the seat they were
    shadowing — including `MemoryRecordType.CREDENTIAL`, which `schema.prisma`
    describes as "Login / access info — stored encrypted", and every card
    classified `restricted`. The Bible forbids that in §3.4 ("Never transfer
    another person's private messages, performance, health, compensation or
    unrestricted files to a successor") and §17 ("expose private data to
    successors"). The gate knew who was at the door and nothing about what was
    behind it. The handoff page compounded it: `_count.memoryRecords` promised the
    successor "12 knowledge cards" over a set that included the seat's login card.
  - What it does now. Per card, never per seat: the seat's working record
    (`CONTACT`, `PLAYBOOK`, `BUDGET`, `VENDOR`, `LESSON`, `THREAD`, `DEADLINE` at
    `standard`) transfers — that continuity is the product; a `CREDENTIAL` is
    `ROTATE`, so the successor gets their own rather than the predecessor's
    identity; anything above `standard` on the ladder, and any type this build
    cannot classify, is withheld with the reason printed. The handoff page shows
    all three counts and the first withheld reason, because a successor told only
    what transfers discovers the gaps one confused request at a time.
  - Scope, stated rather than implied. The Bible's §3.4 list also names
    performance, health and compensation material. None of those objects exists in
    this schema — `docs/architecture/hcm-capability-matrix.md` §1 reports §3.6,
    §3.7 and §3.8 as UNAVAILABLE with 37 canonical objects absent — so there is no
    second inheritance path this boundary fails to cover. `MemoryRecord` is the
    only thing this platform inherits, and it is gated. **The gap this cannot
    close without a schema change:** `MemoryRecord` has no owner-vs-seat column, so
    `PERSONAL` is a class the mapping can never produce; the private half is
    enforced by classification and by refusing what it cannot classify. A
    `MemoryRecord.ownership` enum (`SEAT` | `PERSON`) or a `personId` would let
    `PERSONAL` be represented directly. NO SCHEMA CHANGE THIS WAVE, so it is
    recorded here and in the module's own header rather than guessed from
    `authorId` — authorship is not ownership, and the outgoing president writes
    the playbook the seat keeps.
  - Tests: `apps/web/src/lib/people/seat-memory-boundary.test.ts` (13 tests) and
    the five new cases in `apps/web/src/lib/memory.test.ts` (9 tests). Command:
    `cd apps/web && npx jest src/lib/people src/lib/memory.test.ts` → **2 suites,
    22 tests, 22 pass.** Whole app suite: `npx jest --ci` → **7416 pass, 279 of
    280 suites**; the one failure is `src/components/charts/cvd.test.ts` reading
    `docs/architecture/anl-analytics-limitations.md`, an analytics-domain file
    another agent is mid-flight on, not this change. `npx tsc --noEmit` reports
    nothing in any file touched here.
  - Evidence — **4 mutations, one at a time, each run and each caught, each
    restored byte-identical (`diff` clean, 22 pass after):**
    1. `apps/web/src/lib/memory.ts`: replaced
       `return inheritsToSuccessor(card).action === "TRANSFER"` with `return true`
       — the exact pre-existing bug → 2 failed: "cannot read the seat's credential
       card", "cannot read a card classified above standard".
    2. `SEAT_STANDING_BY_TYPE.CREDENTIAL` → `{ inheritance: "SEAT_RECORD",
       classification: null }` → 4 failed, including "never hands over a
       credential — it is reissued" and the three-way packet split.
    3. `sensitivityRank(card.sensitivity) > 0` → `> 7` (a literal no other token
       can absorb) → 5 failed, including "withholds every type once it is labelled
       above standard".
    4. `SHADOW_WINDOW.transitionCompleted` `false` → `true` → 2 failed: the
       restricted card's refusal changed from "No transition workflow has
       completed" to the unclassified default-deny, and the direct assertion on
       the context.
    5. And the type-level guard: removing `type: true` from the memory `select` in
       `apps/web/src/lib/search-data.ts` → `npx tsc --noEmit` reports
       `src/lib/search-data.ts(243,32): error TS2345: … Property 'type' is missing
       … but required in type 'SeatMemoryCard'`. A read path that forgets to ask
       for the classification cannot get the permissive answer by omission.
  - **A dead-code defect this found in its own first draft, kept here because it
    is the more useful half of the mutation discipline.** The first version kept
    the inheritance class in the type map and re-derived `CREDENTIAL`'s
    classification in an `if` below it. Mutating the map row from `"CONTROLLED"`
    to `"SEAT_RECORD"` left **all 22 tests green** — the branch never read the
    row. Two places encoding one fact, and the unverifiable one is the one that
    drifts. The map now holds both fields and nothing re-derives them, which is
    what makes mutation (2) above fail.
  - Side effect, regenerated and checked: `docs/architecture/hcm-people-inventory.md`
    now measures 76 of 89 organization-model exports unreached rather than 84,
    because this is the first non-test caller of `succession-release`.
    `node tools/hcm-people-inventory.mjs --check` → "is current";
    `node --test tests/architecture/hcm-people-inventory-is-current.test.mjs` →
    10 tests, 10 pass.

- [ ] **HCM-040-004** — Implement safe People Relay tools and evaluations.
  - Status: FAIL
  - Considered and rejected for this wave on ownership, not difficulty. The tool
    registry is `apps/web/src/lib/relay-tools.ts` (1,185 lines) and the projection
    policy is `apps/web/src/lib/relay/projection-policy.ts`; both are shared with
    the integration and work-graph domains, whose agents are editing this worktree
    now, and §10 asks for *typed, scoped, logged, risk-gated* People tools —
    additions to exactly those files. Serialising that is cheaper than resolving a
    conflict in a Relay gate.
  - What this wave did contribute: memory bodies reach the model boundary as
    `REFERENCE_ONLY` and the corpus is built through `canSeeMemoryCard`, so the
    `HCM-040-003` boundary already means a shadow holder's Relay answers cannot
    rest on the seat's credential cards — `apps/web/src/lib/search-data.ts:243` is
    the corpus's only memory gate.
  - Next slice, buildable with no schema change: an evaluation suite asserting the
    §10 prohibitions against the registry as data — no tool may hire, terminate,
    approve compensation or rank people — plus a People tool that answers role
    history from `MemoryRecord` and `SeatHolding` with citations. Needs a wave in
    which this domain owns `relay-tools.ts`.

- [ ] **HCM-040-005** — Pass long-session, localization, mobile and visual-regression tests.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-050-001** — Implement jurisdiction-pack applicability and truthful availability.
  - Status: BLOCKED_EXTERNAL
  - The **truthful-availability** half is done and is `HCM-050-005` above: the
    published matrix reports, derived from a walk of the tree, that no jurisdiction
    pack exists and therefore no jurisdiction is supported — and a test reds if
    that stops being the measurement.
  - The **applicability** half is blocked, and not on effort. An applicability
    resolver decides which pack governs a (country, legal employer, population,
    capability) tuple. Written today it would resolve over an empty set: a function
    whose every answer is "no pack applies" is untestable against the case that
    matters, and shipping it would put a resolver in the tree that has never once
    selected a pack. Worse, it would fix the pack FORMAT — required fields,
    document types, employment/leave/time/payroll/retention rule shape, translation
    and certification records — and that format is owned by the Pack Factory and
    Configurator bibles, whose files this agent must not edit in a wave with eleven
    other agents in the same worktree. A second pack format is the defect
    `docs/architecture/hcm-people-inventory.md` and `CLAUDE.md` both warn about.
  - It is also blocked on a person: §12 says "Exact local legal review remains
    human-owned." A pack for a jurisdiction nobody has reviewed is a legal claim
    with no reviewer, which is the failure this requirement exists to prevent.
  - Unblocked by: (a) the Pack Factory declaring the jurisdiction-pack entry shape
    in `packages/provisioning` or `packages/platform-config` — checkable, since
    `node tools/hcm-capability-matrix.mjs` walks for one and its §3 section changes
    the day a file named for a jurisdiction lands; (b) one reviewed pack for one
    country; then (c) a resolver in `apps/web/src/lib/people/` with a test that
    both selects that pack and refuses a country it does not cover, distinguishing
    "no pack applies" from "we cannot tell".

- [ ] **HCM-050-002** — Certify enabled identity/payroll/benefits/recruiting/time/learning integrations.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-050-003** — Pass all twelve E2E scenarios, isolation, performance, DR and provider-failure tests.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **HCM-050-004** — Instrument the best-system scorecard and record baseline/target/results.
  - Status: FAIL
  - Reason: imported from `Tenure_People_HR_and_Workforce_Cloud_Claude_Bible_v1.0.md`; not yet implemented

- [x] **HCM-050-005** — Publish exact supported capability/jurisdiction/provider matrix and limitations.
  - Status: PASS
  - Code: `tools/hcm-capability-matrix.mjs` — `capabilityFamilies`,
    `FAMILY_OBJECTS`, `FAMILY_SURFACE`, `FAMILY_CERTIFICATION`, `tenantRoutes`,
    `jurisdictionPackFiles`, `PROVIDER_DOMAINS`, `connectorPacks`,
    `providerCoverage`, `payrollModes`, `availabilityFrom`, `familyVerdict`,
    `verify`, `render` → publishes
    [`../architecture/hcm-capability-matrix.md`](../architecture/hcm-capability-matrix.md).
    It imports `BINDINGS`, `canonicalObjects`, `read` and `exists` from
    `tools/hcm-people-inventory.mjs` rather than re-deriving object status: one
    binding table for the domain, two readers, no second parser.
  - Caller: `tests/architecture/hcm-capability-matrix-is-current.test.mjs`, run by
    `npm run test:platform` → `.github/workflows/ci.yml` "Platform tests", plus
    `node tools/hcm-capability-matrix.mjs --check` for the same answer at a
    terminal. The document is the deliverable the requirement asks for ("publish");
    the tool is what makes it a measurement instead of a memo.
  - Everything in it is derived. The ten capability families come from the Bible's
    own `### 3.x` headings; the objects from §4's own list, bound to exactly one
    family each with both closure directions asserted; each family's availability
    from the inventory's PRESENT/PARTIAL/ABSENT status plus whether a route exists
    under `apps/web/src/app/(app)`; the jurisdictions from a walk of `apps/`,
    `packages/`, `modules/` and `blueprints/`; the providers from the 24 connector
    packs `packages/provisioning/src/provider-packs.ts` declares, matched on
    Tenure's own `key`/`product`/`capability` words rather than a vendor's product
    name. `AVAILABLE` additionally requires a certification ADR **that exists on
    disk**, the rule `packages/payments/src/capability-registry.ts` already applies
    to a money-facing state — so no family can be promoted by editing this tool.
  - What it now publishes, which is the point: **0 of 10 capability families
    AVAILABLE, 3 LIMITED, 7 UNAVAILABLE; the payroll mode in force for every
    population is `UNAVAILABLE`; 0 of 7 People provider domains have any connector
    at all; no jurisdiction pack exists, so no jurisdiction is supported — not one,
    including the pilot's own; 37 of the 45 canonical objects §4 requires do not
    exist.** The document also carries §3.10's own rule in its own words: a
    generated file is never a payment and never a filing.
  - Tests: `node --test tests/architecture/hcm-capability-matrix-is-current.test.mjs`
    — **10 tests, 10 pass.** `node tools/hcm-capability-matrix.mjs --check` →
    "docs/architecture/hcm-capability-matrix.md is current."
  - Evidence — **4 mutations, one at a time, each caught, each restored (`diff`
    clean, 10 pass after):**
    1. Hand-edited the published headline from `**0 of 10 capability families are
       AVAILABLE` to `**7 of 10 …` → `not ok 1 - the committed matrix is what the
       generator produces now`. A capability claim cannot be made by editing the
       document.
    2. `FAMILY_OBJECTS["3.9"]` emptied from `["HRCase"]` to `[]` → `not ok 1` and
       `not ok 2 - the generator's own bindings still hold`; the closure check names
       `HRCase` as bound to no family, which is how a family comes to look complete
       because the missing part of it was never listed.
    3. `FAMILY_SURFACE["3.7"]` from `null` to `"orgs/[slug]/benefits"` → 3 failed,
       including `not ok 7 - a declared surface is a route that exists`. A benefits
       surface cannot be claimed by naming a route that is not in the tree.
    4. `availabilityFrom`: dropped `&& certified` from the AVAILABLE condition →
       `not ok 5 - the availability rule refuses AVAILABLE unless all three
       conditions hold` / "every object present and a surface, but no certification
       decision on disk — that is not AVAILABLE".
  - **A vacuous guard, found and fixed before it shipped.** The AVAILABLE gate was
    first asserted by walking the ten families — and no family is AVAILABLE, so it
    asserted nothing and could not fail while reading as coverage. The rule is now
    `availabilityFrom`, a pure function tested over the six input combinations this
    tree does not currently produce, which is what mutation (4) exercises.
  - Not claimed by this row: `HCM-050-001` (jurisdiction-pack applicability) and
    `HCM-050-002` (provider certification) are the *implementations* this matrix
    reports the absence of. Publishing "none" truthfully is this requirement;
    building them is theirs, and both stay BLOCKED_EXTERNAL below.

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
