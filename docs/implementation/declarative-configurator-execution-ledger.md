# Declarative Tenant Configurator and Deployer UX — execution ledger

Every `CFG-*` requirement stated by `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`.

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

- [x] **CFG-000-001** — Inspect repository, current System Studio routes, authentication, configuration code, databases, IaC, workflows, tests and deployed nonproduction behavior.
  - Status: PASS
  - Code: `tools/cfg-configuration-truth.mjs` derives the inventory from `git ls-files` plus `git ls-files --others --exclude-standard`, and writes `docs/architecture/cfg-configuration-truth.md` — 198 rows across the eight axes the requirement names plus the ninth. 23 System Studio routes, 12 authentication/authorization modules, 64 configuration and form modules, 4 database facts (52-model Postgres schema, 14 migrations, the Studio's DynamoDB tables, the config store adapter), 36 IaC files, 17 workflows with their production-disarm state, 39 tests over the configuration surface.
  - Evidence: `tests/architecture/cfg-configuration-truth-is-current.test.mjs` — 5/5 under `node --test tests/architecture/cfg-configuration-truth-is-current.test.mjs`. It re-derives the whole document and byte-compares, opens every path the committed copy names, asserts all nine sections are present and non-empty, re-derives the nonproduction finding, and asserts the output carries no CR, no backslash path, no timestamp and no absolute path so a Windows checkout and a Linux runner produce the same bytes.
  - Ninth axis, stated honestly: this process holds no AWS credentials and describes no running environment. What it establishes is that there is none to describe — `infrastructure/oidc/environments.json` declares only `aws-read` and `engine-production`, no workflow names a nonproduction deployment target, and `docs/architecture/aws-current-state.md` (a real read-only run from `.github/workflows/aws-inventory.yml`, not from this generator) records a single-account estate with Organizations not in use. When GE-010 vends a nonproduction account the guard reds and the axis must be re-evidenced against the running environment.
  - Mutation proof: 2 mutations, 2 caught. (1) rewrote one real row's path in the committed document from `apps/web/prisma/schema.prisma` to `apps/web/prisma/schema-does-not-exist.prisma` — `the committed inventory is what the tree produces` and `every path the inventory names exists` both failed (3 pass / 2 fail); restored, 5/5. (2) appended an `engine-staging` environment to `infrastructure/oidc/environments.json` — `the nonproduction finding is derived, not asserted` failed alongside the staleness check (3 pass / 2 fail); restored byte-for-byte, 5/5.
  - Caveat for whoever commits: `node tools/cfg-configuration-truth.mjs` is not yet in the root `generate` script, because `package.json` is shared and this wave may not edit it. Run it before committing, and add it to `npm run generate` alongside `tools/entry-point-inventory.mjs`.

- [x] **CFG-000-002** — Import every `CFG-*` item into the canonical execution ledger without creating a divergent checklist.
  - Status: PASS
  - Evidence: `tests/architecture/document-graph.test.mjs` now contains `the declarative configurator catalog is completely imported`, which compares every `CFG-*` requirement parsed from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md` to `importedIds()`, requires each row's `source_ledger` to be `docs/implementation/declarative-configurator-execution-ledger.md`, and requires the generated registry to resolve exactly those 79 rows back to that Bible.
  - Verification: `node --test tests/architecture/document-graph.test.mjs` passed 13/13 on 2026-08-11.
  - Mutation proof: the same test first failed when its pinned CFG count was set to 83 (`79 !== 83`), proving the guard notices a divergent configurator import denominator before this row was marked PASS.

- [x] **CFG-000-003** — Map existing form/configuration code to retain, refactor, migrate or retire with evidence.
  - Status: PASS
  - Code: `docs/architecture/cfg-form-and-configuration-disposition.md` — one disposition for each of the 64 form/configuration modules in the tree: 49 RETAIN, 9 REFACTOR, 6 MIGRATE, 0 RETIRE. Every row carries a reason and a path a reader can open. The left-hand column is not typed by hand — it is exactly the set `configurationModules()` computes in `tools/cfg-configuration-truth.mjs`, the same derivation the CFG-000-001 inventory uses, so the plan and the inventory cannot disagree about what counts as configuration code.
  - Evidence: `tests/architecture/cfg-form-disposition-covers-the-tree.test.mjs` — 5/5 under `node --test tests/architecture/cfg-form-disposition-covers-the-tree.test.mjs`. It compares the two sides in BOTH directions (a module with no disposition reds; a disposition naming a module the derivation does not produce reds), rejects any word outside the four, rejects a one-clause reason, opens every cited evidence path, rejects a module given two dispositions, and checks the stated counts against the rows.
  - Zero RETIRE rows is a finding, not an omission: RETIRE is the disposition for code whose replacement has landed, and CFG-010 and CFG-020 are unbuilt — every row in this ledger below CFG-000 is FAIL — so nothing here is superseded by anything that exists.
  - Mutation proof: 3 mutations, 3 caught. (1) the guard caught a fabricated row of my own before this was reported — I wrote a disposition for `packages/platform-config/src/module-permissions.ts`, which does not exist (only its `.test.ts` does), and `every disposition names a module that exists` failed until it was removed. (2) deleted the `packages/configuration/src/store.ts` row — `every configuration module in the tree has a disposition` and the count check failed (3 pass / 2 fail); restored, 5/5. (3) rewrote a module path to `packages/configuration/src/authority-v2.ts` — the same test plus `every disposition names a module that exists` failed (3 pass / 2 fail); restored byte-for-byte, 5/5.

- [ ] **CFG-000-004** — Establish one action-resource-scope authorization path before exposing configurable production actions.
  - Status: BLOCKED_EXTERNAL
  - Measured, not asserted: there is more than one path today, and the count is derivable. `git grep -l --untracked -E "authorizeCommand\(" -- apps/system-studio/src` returns 12 files and `git grep -l --untracked -E "isOperator\(" -- apps/system-studio/src` returns 16; excluding `lib/authorize.ts` and `lib/operators.ts`, which define both, 12 Studio modules use `isOperator` and never `authorizeCommand` — a bare membership test with no action, no resource and no scope. Nine are `platform/*/page.tsx` reads, one is `signin/page.tsx`, one is `lib/command-handlers.ts`, and one is a production MUTATION: `placeHold` and `releaseHold` in `apps/system-studio/src/app/platform/audit/actions.ts` call `requireOperator()`, which is `isOperator(session.user.email)` and nothing else. The tenant application is a third path — `requireCapability` in `apps/web/src/lib/admin/guard.ts`, with callers in `apps/web/src/app/(app)/admin/actions.ts`, `apps/web/src/app/(app)/admin/outbox-actions.ts` and `apps/web/src/lib/tenant-scope.ts` — and `apps/web/src/app/(app)/settings/actions.ts` mutates behind `requireUserId`, a session check that makes no decision at all. Recorded per-module in `docs/architecture/cfg-form-and-configuration-disposition.md` (the `HoldControls.tsx` and `settings/actions.ts` rows) and per-route in `docs/architecture/cfg-configuration-truth.md`.
  - Blocked on files this wave may not touch: unifying these requires editing `apps/system-studio/src/lib/authorize.ts` (add `audit.hold.place` / `audit.hold.release` to `STUDIO_COMMANDS` and to `OPERATOR_GRANTS` in `apps/system-studio/src/lib/operators.ts`), `apps/system-studio/src/app/platform/audit/actions.ts` (replace `isOperator` with `authorizeCommand`), the nine `apps/system-studio/src/app/platform/*/page.tsx` read gates, and — for the platform-wide claim the bible §25 actually makes — `apps/web/src/lib/rbac.ts`, which is on this wave's shared-file list and may not be edited by a domain agent. A second decision function added here in parallel with another agent's edit is exactly the merge that loses an hour.
  - Not a new guard, deliberately: `tests/security/operator-boundary.test.mjs` already ratchets the `isOperator` gate count downward and `tests/security/every-path-authorizes.test.mjs` already ratchets `UNAUTHORIZED_MUTATORS`. Both are the right guards for this and both are currently red from in-flight work in this wave. A third overlapping ratchet would add noise, not proof.
  - Unblock with: `node --test tests/security/operator-boundary.test.mjs tests/security/every-path-authorizes.test.mjs` after the edits above, in a wave that owns `apps/system-studio/src/lib/authorize.ts` and `apps/web/src/lib/rbac.ts`. Tracked by STUDIO-020-006, which established `authorizeOperator` in the first place and is the item that must extend it.

- [ ] **CFG-000-005** — Prove browser clients cannot obtain AWS credentials or call arbitrary AWS mutations.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-010-001** — Implement signed, versioned schema package metadata, lifecycle and compatibility.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-010-002** — Implement registry admission for signature, publisher, dependencies, engine range, migrations, translations and tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-010-003** — Reject duplicate identifiers, unsafe expressions, cycles and unavailable dependencies with actionable errors.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-010-004** — Implement package deprecation, supersession, vulnerability response, tenant impact and rollback.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-010-005** — Prove a tenant cannot load an unauthorized or incompatible package.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-020-001** — Implement namespaced structural, UI, rule, provenance, impact, output and approval schema vocabularies.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-020-002** — Implement bounded expression parsing, static typing, dependency extraction and deterministic evaluation.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-020-003** — Implement visibility, applicability, enablement, requirement, default, derivation, options, validation, invalidation, approval, lock, redaction and mapping rules.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-020-004** — Generate client-safe presentation projection and server-authoritative evaluation from one graph snapshot.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-020-005** — Prove hostile schema/rule content cannot execute arbitrary code, access secrets or escape its namespace.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-030-001** — Compile package closure into a typed directed dependency graph and signed snapshot.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-030-002** — Detect cycles with minimal human-readable paths and block publication.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-030-003** — Implement topological and affected-subgraph evaluation.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-030-004** — Persist rule traces, inputs, outputs, graph version and evaluation errors.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-030-005** — Prove identical inputs and versions replay to canonical identical outputs.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-030-006** — Load-test million-value effective configuration and large graph behavior within approved budgets.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-040-001** — Implement field/section states and permitted transition guards.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-040-002** — Implement provenance for inherited, defaulted, derived, imported, Relay-proposed, explicit and exception values.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-040-003** — Preserve stale/inapplicable/superseded values and history; never silently delete downstream decisions.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-040-004** — Invalidate affected validation, previews, artifacts and approvals after material changes.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-040-005** — Display rule trace and “why/impact” explanation without exposing protected data.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-050-001** — Implement event-sourced semantic drafts with revision control and snapshots.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-050-002** — Implement truthful autosave, explicit save, save-and-exit, resume and recovery.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-050-003** — Implement optimistic concurrency, non-overlap merge and three-way conflict resolution.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-050-004** — Implement draft branches, comparison, semantic merge, archive and expiry.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-050-005** — Implement assignments, comments, mentions, due dates and durable-seat handoff.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-050-006** — Prove network interruption, duplicate command, tab collision and process restart do not lose or double-apply work.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-060-001** — Implement the System Studio shell and all tenant-creation stage surfaces from schemas.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-060-002** — Implement graph-aware Back, Next, deep link, history restoration and context-switch protection.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-060-003** — Implement progressive disclosure, expert bulk editing, provenance, inherited/override controls and explanations.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-060-004** — Implement every field/section status, loading, empty, blocked, stale, conflict, error, offline and forbidden state.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-060-005** — Implement global search/command, saved views, inspector, activity and evidence panels.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-060-006** — Pass Tenure Experience System, responsive, localization, WCAG 2.2 AA, keyboard, screen-reader and visual-regression gates.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-060-007** — Pass observed long-session comfort tests for solution architects and reviewers.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-070-001** — Implement field, section, cross-domain, external, infrastructure, operational, security and migration validation.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-070-002** — Implement typed external checks with freshness, timeout, retry, ownership and evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-070-003** — Compile application/data/integration/identity/AI/AWS/security/cost/downtime/migration/rollback impact.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-070-004** — Implement comparison to inheritance baseline, prior release, another branch and actual state.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-070-005** — Derive readiness from applicable requirements/evidence; prevent manual green status.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-080-001** — Implement risk-based approval policy and separation of duties.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-080-002** — Bind approvals to canonical digests, target, action, evidence and expiry.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-080-003** — Invalidate approvals after material change, expired evidence or changed risk.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-080-004** — Implement step-up, typed confirmation, two-person approval and delay for protected actions as policy requires.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-080-005** — Freeze effective manifest and create immutable change transaction only after gates pass.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-090-001** — Generate typed application, data, connector, identity, Relay and infrastructure artifacts from the manifest.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-090-002** — Handoff only to backend idempotent orchestration using narrow short-lived roles.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-090-003** — Implement step visibility, pause, retry, resume, compensation, rollback and forward recovery.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-090-004** — Verify business, isolation, security, data, integration, finance and operations before activation.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-090-005** — Project desired/planned/actual/drifted/verified state into System Studio.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-090-006** — Prove partial failure resumes from the correct safe checkpoint without orphan resources.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-100-001** — Prove Simon OSE from reusable packs and a tenant overlay with payments off by default.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-100-002** — Prove professional-services SMB composition.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-100-003** — Prove global discrete-manufacturing composition and cascading country/entity consequences.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-100-004** — Prove public-sector composition with truthful certification states.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-100-005** — Prove a live tenant change including branch, impact, approvals, migration, canary, rollback and reconciliation.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-100-006** — Prove no domain, industry, connector or provider requires source code branching.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-110-001** — Complete threat model and abuse tests for schemas, expressions, drafts, files, approvals, preview and deployment handoff.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-110-002** — Pass tenant isolation across relational, object, cache, search, events, jobs, logs and evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-110-003** — Pass backup/restore and point-in-time reconstruction for configuration and approval history.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-110-004** — Pass performance, concurrency, fault-injection and safe-degradation tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-110-005** — Produce operator runbooks, SLOs, alarms, dashboards and support handoff.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-110-006** — Generate final requirement-to-code/test/deployment/evidence matrix with every failure and blocked input.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-GATE-000** — Current truth, authority boundaries and migration plan are evidenced.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-GATE-010** — Only admitted, compatible, traceable packages reach tenant configuration.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-GATE-020** — Domain behavior is declarative, safe, deterministic and server-authoritative.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-GATE-030** — Graph compilation and incremental evaluation are correct, bounded and scalable.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-GATE-040** — Every effective value and state transition is reconstructable and explainable.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-GATE-050** — Multi-session and multi-user configuration preserves work and authority.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-GATE-060** — The configurator is fast, professional, low-fatigue, accessible and generated from canonical schemas.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-GATE-070** — Reviews receive complete, current and explainable consequences.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-GATE-080** — No production or destructive change executes outside current digest-bound approval.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-GATE-090** — Approved configuration becomes verified actual state through governed execution.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-GATE-100** — Structurally different tenants are generated by one runtime.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **CFG-GATE-110** — The Configurator is production-ready only for the exact enabled scope proven by evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Declarative_Tenant_Configurator_and_Deployer_UX_Claude_Bible_v1.0.md`; not yet implemented
