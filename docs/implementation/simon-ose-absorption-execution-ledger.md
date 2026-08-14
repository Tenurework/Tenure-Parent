# Simon OSE Tenant #1 absorption — execution ledger

The authoritative record of what has actually been implemented against the Simon
absorption bible, with evidence.

**Source of the checklist:**
[`Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`](./Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md)
**Source repository being absorbed:** `Tenurework/Tenure`
**Target:** this repository
**Pilot target:** Fall 2026

Created 2026-08-02, on the bible's own instruction (§3: "Create
`docs/implementation/simon-ose-absorption-execution-ledger.md` and copy every
`SIMON-*` item into it.").

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
answer to "what is next".

## Rules this ledger is kept under

The same rules as the global engine ledger, plus one the absorption adds.

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
8. **Nothing recorded here may contain Simon student, staff, or applicant data.**
   `Tenurework/Tenure` carries a live pilot's real records. This repository is
   public, and everything a workflow prints is world-readable and archived. Row
   counts, table names and schema shapes are evidence; a single real row is not,
   whatever it is being used to demonstrate.

## Two constraints that govern every item below

**`Tenurework/Tenure` is never pushed to.** A push to its `main` builds a
container, applies Terraform and rolls production ECS for a live pilot carrying
real student data. It remains the rollback source until cutover completes. Where
an item requires a change there, it is a pull request for a human to merge.

**Absorption is not a fork.** The bible's §1: Simon is Tenant #1, "never the
global data model, default terminology, authorization model, AWS topology,
workflow ceiling, or product navigation". An item is not complete if it was
satisfied by an `if (tenant === "simon")` branch in core business logic, a
duplicated core module, or a Simon-only pipeline — those are the specific
failures §2 names, and each is what this ledger exists to make visible rather
than convenient.

---

## Phase 0 — §4.1 Repository inventory

The bible's §4.1 requirements, imported here as they are worked. All three below
are answered by one generator, `tools/simon-absorption-inventory.mjs`, because
they are the same inventory at three levels of zoom and three hand-written
documents would drift apart from each other before they drifted from the tree.

**How the source repository is read.** `Tenurework/Tenure` is never cloned,
checked out or pushed to. Its content is read from the remote-tracking refs
already in this clone — `refs/remotes/live/main`, pinned at
`3504b173828f0da18171f6dadab4ebfbfbbeb61f` — with read-only git plumbing, and
from the GitHub API read-only (`gh repo view`, `gh pr list`, `gh api`). Nothing
in the output is a value read out of a file: only paths, counts, refs, declared
names and import specifiers. `Tier1/` is listed by path and never opened.

- [x] **SIMON-000-001** — Record remotes, branches, tags, default branches, active PRs, dirty state, commit history, contributors, releases, environments, and deployment workflows in both repositories.
  - Status: PASS
  - Generator: `tools/simon-absorption-inventory.mjs`
  - Artifacts: `docs/architecture/simon-repository-inventory.md` (people),
    `docs/architecture/simon-absorption-inventory.json` (machine)
  - Tests: `tests/simon-absorption-inventory.test.mjs` — 10 cases, run with
    `npm run test:platform` (bare `node --test`, not jest)
  - Evidence: 10 mutations applied, 10 caught, 0 survivors; all four artifacts
    restored byte-identical afterwards and the suite green again at 10/10.
    Mutation A dropped `.github/workflows/deploy-studio.yml` from the workflow
    inventory and reddened two cases; mutation J hand-edited the source
    `deploy.yml` guard cell from **none** to `Tenurework/Tenure` in the rendered
    document and reddened the render check.
  - What is recorded, per repository: the configured remote and the canonical
    name GitHub resolves it to, every branch with its commit, tags, the default
    branch, open pull requests, releases, deployment environments, commit count
    with oldest and newest dates, contributor names, and every workflow with its
    triggers, whether it authenticates to AWS, whether it deploys, and which
    repository guard it carries. A field the token could not read is recorded as
    `UNKNOWN` with the command that would answer it, never as an empty list.
  - Three findings this surfaced, each re-checkable from the artifact:
    1. The `live` remote is configured as `https://github.com/satvikOS/Tenure.git`
       and GitHub resolves it to `Tenurework/Tenure`. The URL is stale; the
       repository is the pilot the two rules at the top of `CLAUDE.md` govern.
    2. All 12 source workflows carry **no** `github.repository` guard, and 4 of
       them deploy — `deploy.yml` on every push to `main`. In this repository 13
       of 17 are guarded. An imported workflow is therefore never a copy.
    3. The two repositories share history: merge base
       `d20d40d7846fc434b539f80cae8e437b750055ed` (2026-07-31). Absorption is a
       convergence, not an import into an unrelated tree.
  - Honest limit: commit counts, the dirty-path count and the open-PR list are
    facts about a moment, so they are stamped `observed_at` and the guard test
    does not re-derive them. It checks the structural claims, which are stable.

- [x] **SIMON-000-002** — Generate complete file/package/application/service/module/workspace maps and dependency graphs for source and target.
  - Status: PASS
  - Generator: `tools/simon-absorption-inventory.mjs`
  - Artifacts: `docs/architecture/simon-repository-maps.md`,
    `docs/architecture/simon-absorption-inventory.json`
  - Tests: `tests/simon-absorption-inventory.test.mjs` — 10 cases,
    `npm run test:platform`
  - Evidence: mutation B renamed a real workspace manifest to
    `packages/finopz/package.json` and reddened 4 cases; mutation F removed
    `packages/authorization/src/decide.ts` from the target file list and
    reddened 3; mutation G hand-edited an area count in the document and
    reddened the render check; mutation H pointed an import edge at an area
    holding no files and reddened the graph check. 0 survivors of 10.
  - Which clause each artifact answers, so the claim is checkable clause by
    clause rather than as a whole:
    - **file map** — `source.files` (357 paths) and `target.files` (1343 paths)
      in the snapshot, each re-derivable with `git ls-tree -r <sha>`.
    - **module map** — the area tables, 10 areas source and 42 target; the guard
      test asserts they sum to the file lists.
    - **package / workspace map** — 2 source and 19 target manifests with
      package name, private flag, scripts, workspace dependencies and declared
      dependency names; the target set is re-derived from the root
      `package.json` workspace globs against disk.
    - **application map** — the `apps/*` rows of that table: one application in
      the source (`apps/web`), two in the target (`apps/web`,
      `apps/system-studio`).
    - **service map** — the same table's `packages/*` rows plus the "Backend
      services / domain libraries" row of `docs/architecture/simon-stack-inventory.md`.
    - **dependency graphs** — two, because declared and observed are different
      claims. Declared: workspace to workspace, from the manifests. Observed:
      6 area edges in the source and 85 in the target, from the import,
      export-from, `import()` and `require()` specifiers of 274 and 1068 source
      files, resolved against each side's file list AND its `tsconfig.json`
      path aliases. Plus 37 and 102 external area/package pairs, each flagged
      declared or not; the guard test recomputes every flag from the manifests.
  - One finding: 38 target and 2 source external imports are **undeclared** —
    they resolve only through npm's flat `node_modules`. `packages/platform-config/src`
    importing `zod`, and nine `@tenure/*` imports it does not declare, are the
    largest. That is a defect list for another domain, recorded because the
    inventory produced it rather than asserted it.
  - Honest limit: the import scan is textual, so a code sample inside a string
    literal counts as an import. Four fixtures under `tests/architecture` embed
    `from "x"` and `require("z")`; that is why single-letter packages appear.
    The document states this where the table is.

- [x] **SIMON-000-003** — Identify frontend frameworks/routes/components/styles/tokens, backend handlers/services, APIs, databases/schemas/migrations, events/queues/jobs, identity, file storage, search/AI, integrations, observability, IaC, and tests.
  - Status: PASS
  - Generator: `tools/simon-absorption-inventory.mjs`
  - Artifacts: `docs/architecture/simon-stack-inventory.md`,
    `docs/architecture/simon-absorption-inventory.json`
  - Tests: `tests/simon-absorption-inventory.test.mjs` — 10 cases,
    `npm run test:platform`
  - Evidence: mutation C changed one source evidence path from
    `apps/web/src/lib/s3.ts` to `apps/web/src/lib/s4.ts` and reddened 2 cases;
    mutation D hand-edited a capability count in the rendered table and reddened
    the render check. 0 survivors of 10.
  - 25 capability probes, each a pattern run over a real file list with the
    matched paths as its evidence and the pattern printed beside it, covering
    every noun the requirement names. A probe that matches nothing records **no
    match** against a stated pattern — it does not claim the capability is
    absent, because a search is not a proof.
  - The comparison the absorption needs, from the table: the source is one
    Next.js application (37 pages, 20 API handlers, 30 domain libraries, 1
    Prisma schema, 2 migration files, 25 unit and 28 e2e specs, 20 Terraform
    files). The target is two applications over 17 packages (52 pages, 28 API
    handlers, 64 domain libraries, the same Prisma schema, 15 migration files,
    343 unit and 72 e2e specs, 35 Terraform files). Both provision the same
    database engine and both carry the same `apps/web/prisma/schema.prisma`.
  - Honest limit: a probe is a filename pattern, not semantics. It proves a file
    exists at a path matching a pattern; it does not prove the capability works.
    Whether each of these is reached by a production caller is
    `SIMON-000-011`/`SIMON-000-012`, not this requirement.

- [ ] **SIMON-GATE-000** — No import or destructive refactor begins until the two codebases, deployed resources, data, and behavioral gaps are evidence-backed.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-010** — One coherent Parent runtime can represent Simon without Simon-aware core business logic.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-020** — Simon's complete intended behavior is a reproducible tenant package, not a fork or collection of environment variables.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-030** — People may rotate or hold multiple scoped assignments while authorization and institutional memory remain correct over time.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-040** — Every Simon user resolves to one governed Tenure identity and exact effective assignments without shared passwords or frontend-only authority.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-050** — Every required Simon pilot capability exists in the Parent runtime or has an explicit approved blocker; no hidden dependency remains in the source application.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-060** — Migrated Simon data is complete, explainable, authorized, reconciled, restartable, and traceable to immutable source evidence.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-070** — Simon is a managed Parent tenant with complete desired/actual resource ownership, not a separately deployed application hidden behind the same UI.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-080** — Relay makes Simon's seat memory useful without creating a second authorization or truth system.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-090** — Simon is fully converged on the Parent experience while remaining recognizably configured for its organization and terminology.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-100** — Future global releases automatically include Simon in compatibility evaluation and governed rollout through the one Parent release train.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-110** — All pilot-critical business journeys, denial paths, transitions, failure paths, and generality proofs pass in staging.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-120** — Simon production activates on Parent only through an evidence-backed, approved, rehearsed, and reversible cutover.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented

- [ ] **SIMON-GATE-130** — Simon is stable on Parent, support ownership is transferred, and the old system no longer receives traffic, writes, secrets, or recurring cost except explicitly approved retention.
  - Status: FAIL
  - Reason: imported from `docs/implementation/Tenure_Simon_OSE_Tenant_Absorption_and_Global_Update_Inheritance_Claude_Bible_v1.0.md`; not yet implemented
