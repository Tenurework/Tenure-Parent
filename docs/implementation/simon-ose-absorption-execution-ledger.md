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

The four remaining §4.1 requirements are answered by a SECOND generator,
`tools/simon-convergence-inventory.mjs`, and not by extending the first one. The
reason is a property worth keeping: the baseline generator PINS two commits, and
these four ANALYSE the content of those same two commits. Reading the commits out
of the baseline's own snapshot rather than resolving refs again means the two
artifacts describe the same two trees by construction, and no analysis run can
silently re-pin the baseline under itself. `tests/simon-convergence-inventory.test.mjs`
asserts that equality directly, against the other artifact.

One rule is enforced in code rather than remembered. Every probe declares how
much of its own match it may print: `literal` only where the pattern is a closed
set of literal tokens (a season, a role name, an AWS region, an ARN service
prefix), and `mask` — `#` of the matched length, nothing else — wherever the
pattern has an open capture. Rule 8 above is why. The guard test walks every
finding on both sides and reds if a masking probe printed anything but `#`,
which is the one check here whose absence would not show up as a wrong number.

- [x] **SIMON-000-004** — "Locate every hard-coded Simon/OSE/University/club/term/role/workflow/domain/account/region/resource assumption, including values hidden in fixtures, CSS, route names, reports, permission checks, and deployment scripts."
  - Status: PASS
  - Replaces the `Overturned on review` row of 2026-08-17. Both named misses are closed and each was re-checked here at the exact sites the review cited.
  - Provenance, stated because a refuter will find it anyway: **I did not write this code.** It landed in commit `99585c6` ("Six biggest families, twelve slices") in an earlier wave and no ledger row was ever written for it, so the ledger still carried the overturn and the registry still read FAIL. What this row adds is verification against the review's own sentences and a fresh mutation proof.
  - Code: `tools/simon-convergence-inventory.mjs` — `parsePrismaSchema` (297), `VOCABULARY_ENUMS` (339), `deriveVocabulary` (376), `ASSUMPTION_PROBES` (144) now including `approval-chain-symbol` and `sla-threshold`, `PLACES` + `placeOf` (427, 437), `scanAssumptions` (481), `renderAssumptions` (1662)
  - Caller: `tests/simon-convergence-inventory.test.mjs:57` imports it; `tools/run-platform-tests.mjs:26` discovers that spec by recursing `tests/`, and `.github/workflows/ci.yml:155` runs `npm run test:platform`
  - Artifacts: `docs/architecture/simon-hardcoded-assumptions.md` (people), `docs/architecture/simon-convergence-inventory.json` (machine — every finding grouped by file and probe, with every line number)
  - Tests: `tests/simon-convergence-inventory.test.mjs` — 24 cases; cases 16, 17 and 18 are this requirement's two closed misses and the parser they stand on
  - Evidence, verbatim:
    - `node tools/simon-convergence-inventory.mjs` -> `assumptions: source 2873 hits in 187 files, target 9849 in 845`
    - `node --test tests/simon-convergence-inventory.test.mjs` -> `# tests 24 / # pass 24 / # fail 0`
    - `node tools/simon-convergence-inventory.mjs --check` -> `ok — 4 documents match docs/architecture/simon-convergence-inventory.json`
  - The first miss, closed. The role vocabulary is no longer six names typed from memory, two of which (`OSE_ADMIN`, `VICE_PRESIDENT`) occurred nowhere in either tree. `deriveVocabulary` reads it out of BOTH schemas and unions the members, so the probe cannot go stale: a role added to a schema is in the probe on the next run. The `role` kind went **111 -> 357** hits on the source side. Every site the review named is now recorded, at the lines it named, and I re-read them out of the snapshot rather than trusting the roll-up:
    - `apps/web/src/app/(app)/admin/actions.ts` — `role-enum-member` at source lines 15, 17, 19, 273, 390, 393 (target 20, 22, 24, 290, 422, 430), tokens `FUNCTIONAL` `OSE_ADVISOR` `OSE_DIRECTOR` `OSE_STAFF`. Line 15 is the hard-coded `INSTITUTION_ROLES` array the review cited.
    - `apps/web/prisma/schema.prisma` — source lines 81, 82, 83, 194, 329, 330 (target 90, 91, 92, 243, 424, 425).
    - `apps/web/prisma/migrations/20260730000000_baseline/migration.sql` — lines 5, 20, 168 on both sides. Line 5 is `CREATE TYPE "InstitutionRole" AS ENUM (…)`.
  - The second miss, closed. The `workflow` kind read **0** on the source side while that tree carried `model ApprovalStep`, five `approvalStep.create` call sites and an SLA escalation clock. It now reads **709 hits in 75 files** (target 2742 in 389), from three probes: `approval-chain-symbol` (the declared models), `sla-threshold` (`SLA_ATTENTION_DAYS` / `SLA_OVERDUE_DAYS` and the escalation verbs), and the derived `workflow-state-member`. The guard asserts named sites rather than a non-zero count, because a row of noise is also non-zero: `sla-threshold` at `apps/web/src/lib/approvals-sla.ts` and `approval-chain-symbol` at `apps/web/prisma/schema.prisma`.
  - Mutations, one literal at a time, generator re-run after each, each restored and re-verified 24/24:
    1. `VOCABULARY_ENUMS` role selector `/(?:Role|Scope)$/` -> `/Role$/` -> `not ok 16 - the role and workflow vocabulary is read out of the schemas, not typed from memory`, error `PRESIDENT is not in the role vocabulary`, `# pass 23 / # fail 1`.
    2. `VOCABULARY_ENUMS` workflow selector `/Status$/` -> `/Ztatus$/` -> `not ok 17 - the workflow row is located rather than empty, on both sides`, error `workflow-state-member found nothing at all on the source side`, 23/1.
    3. `parsePrismaSchema`'s enum branch pushes a constant instead of the member -> `not ok 16`, `not ok 17`, `not ok 18`, `not ok 19`, 20/4. One literal, four reds, because that parser is what this requirement's vocabulary AND SIMON-000-005's schema comparison both stand on — which is the argument for there being one parser rather than two.
    0 survivors.
  - Every hiding place the requirement names still has a non-empty row, and the seven places partition the findings exactly once (`placeOf` attributes each to the FIRST match, and the roll-up guard re-adds them). The order stays specific-before-generic; `route names` before `reports` is what once emptied two of the requirement's most interesting rows.
  - Honest limits, in the document: a probe is a pattern, not a compiler — it locates a literal and does not decide whether that literal is load-bearing. `docs/` is excluded, non-scannable extensions are not searched, `Tier1/` is listed by path and never opened, and `aws-account-id` matches any bare twelve-digit run, so a hit there is a shape to look at — masked either way.

- [x] **SIMON-000-005** — "Locate duplicate business concepts implemented under different names across repositories and same names with different semantics."
  - Status: PASS
  - Replaces the `Overturned on review` row of 2026-08-17. Both halves the review named are closed, and each is checked here against the review's own example.
  - Provenance: as with SIMON-000-004, **the code landed in commit `99585c6` in an earlier wave and no ledger row was written for it.** This row is verification plus a fresh mutation proof, not new implementation.
  - Code: `tools/simon-convergence-inventory.mjs` — `parsePrismaSchema` (297), `compareSchemaConcepts` (838), `nameTokens` (952), `CROSS_NAME_MIN_TOKEN` (959), `CROSS_NAME_SHAPE_JACCARD` (960), `sharedNameTokens` (971), `strengthOf` (987), `crossNameExportCandidates` (1002), `exportsOf` (602), `compareConcepts` (695), `renderConcepts` (1786)
  - Caller: `tests/simon-convergence-inventory.test.mjs:57`; reached by `npm run test:platform` through `tools/run-platform-tests.mjs:26` and `.github/workflows/ci.yml:155`
  - Artifact: `docs/architecture/simon-concept-collisions.md`
  - Tests: `tests/simon-convergence-inventory.test.mjs` — 24 cases; 14, 15, 18, 19 and 20 are this requirement's
  - Evidence, verbatim:
    - `node tools/simon-convergence-inventory.mjs` -> `concepts: 26 same-name-different-shape, 4 symbol-kind collisions, 1 candidates` and `schema concepts: 12 same-name-different-members, 16 one-sided, 1 strong rename candidates`
    - `node --test tests/simon-convergence-inventory.test.mjs` -> `# tests 24 / # pass 24 / # fail 0`
  - The first half, closed. "Same names with different semantics" was answered only over JS/TS module exports, because `compareConcepts` consumed `codeOf`, gated by a JS/TS extension test — so schema, migration and API vocabulary were never compared, and the divergence that matters most in a financial ledger was invisible. `compareSchemaConcepts` now compares Prisma `model` and `enum` declarations across both pinned schemas: **12 same-name-different-members, 16 declared on one side only.** The review's own example is row 65 of the document — `enum LedgerKind`, `apps/web/prisma/schema.prisma:739` against `:926`, target-only members `RECEIPT` `REVERSAL`. The guard asserts it by name and reds if it stops being reported.
  - The second half, closed. "Duplicate business concepts implemented under DIFFERENT names" could not be answered by a Jaccard over shared export NAMES: a genuine rename has no shared name, so the metric scored 0 on every one of them by construction and the table located nothing. Renames are now located by TWO signals — a shared concept word of at least five letters (`CROSS_NAME_MIN_TOKEN`) plus overlapping shape (member Jaccard >= 0.3 for declarations, same module at the same path for exports) — with the strength stated rather than a ranked single number: two shared words is **strong**, one is **weak**, weak rows are counted and sampled. The one the review said was invisible is now the single strong module-export row: `deleteLedgerEntry` / `reverseLedgerEntry` in `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts`, sharing `entry` and `ledger`. A delete against a reversal in a financial ledger is a semantic divergence, not a rename, and it is now on the page. Two weak schema renames as well (`ApprovalStatus`/`EventStatus`, `Budget`/`BudgetLine`).
  - Mutations, one literal at a time, generator re-run after each, each restored and re-verified 24/24:
    1. `compareSchemaConcepts` stops indexing enums (`['models', 'enums']` -> `['models']`) -> `not ok 19 - the schema comparison sees the vocabulary the export scan structurally cannot`, error `LedgerKind is not reported, and it differs in both trees — this is the miss this section exists to close`, `# pass 23 / # fail 1`. Exactly one case: the first half is guarded on its own.
    2. `CROSS_NAME_MIN_TOKEN` `5` -> `9`, so no word qualifies as a concept word -> `not ok 20 - a rename is located by two signals, and the strong ones are the strong ones`, 23/1; `sharedNameTokens('deleteLedgerEntry','reverseLedgerEntry')` recomputes as `[]` against the expected `['entry','ledger']`.
    3. `parsePrismaSchema`'s enum branch pushes a constant -> `not ok 19` among four reds, 20/4 — the parser both halves stand on.
    0 survivors.
  - Still true from the earlier work, and still the reason the tables are three claims of different strength: the two repositories share history, 184 module pairs at the same path export exactly the same names, so the decided tables report only the pairs that DIFFER; and the eighteen framework-dictated export names (`default`, `metadata`, `dynamic`, the HTTP verbs) are excluded from the similarity metric AND ONLY from the metric, because a module that stopped exporting `default` genuinely changed shape.
  - Honest limits, in the document: the export scan is textual, so a name produced by a barrel chain or a runtime assignment is invisible; the schema comparison reads Prisma declarations, so a concept that lives only in a raw SQL migration and never reaches the schema is not compared; and a candidate is a question, not an answer — `SIMON-010-001` adjudicates.

- [x] **SIMON-000-006** — "Build a package-by-package and capability-by-capability comparison: `PARENT_CANONICAL`, `SOURCE_SUPERIOR`, `MERGE_REQUIRED`, `CONFIG_ONLY`, `DATA_ONLY`, `REIMPLEMENT_REQUIRED`, `DEPRECATE_AFTER_PROOF`, or `UNKNOWN`."
  - Status: PASS
  - Replaces the `Overturned on review` row of 2026-08-17. The review's objection is answered at its root rather than argued with.
  - Provenance: as with SIMON-000-004 and -005, **the code landed in commit `99585c6` in an earlier wave and no ledger row was written for it.** This row is verification plus a fresh mutation proof.
  - Code: `tools/simon-convergence-inventory.mjs` — `digestOf` (1064), `sharedContentDivergence` (1066), `DISPOSITIONS` (1098), `disposeCapability` (1109), `disposePackages` (1164), `renderDisposition` (1958). The capability probes are the baseline generator's `PROBES`, imported rather than re-declared, so the two documents cannot disagree about what a capability is.
  - Caller: `tests/simon-convergence-inventory.test.mjs:57`; reached by `npm run test:platform` through `tools/run-platform-tests.mjs:26` and `.github/workflows/ci.yml:155`
  - Artifact: `docs/architecture/simon-capability-disposition.md`
  - Tests: `tests/simon-convergence-inventory.test.mjs` — 24 cases; 10, 11, 12 and 13 are this requirement's
  - What was wrong: a disposition computed from path presence alone said `PARENT_CANONICAL` for 23 of 25 capabilities, including `Database schema` (1|1|0) and `Authorization` (2|14|0) — while the SAME snapshot proved the content diverged (`rbac.ts` has a source-only export, the two schemas differ on `LedgerKind`). The generator's own legend defines `UNKNOWN` as "the label needs a judgement this evidence cannot make", and that was exactly the case; a positive verdict was recorded instead. Wrong in the direction that matters: a pilot capability the parent does not actually hold was labelled "the parent is canonical".
  - What it does now: `sharedContentDivergence` digests every shared path on both sides (sha256 over LF-normalised text, first 16 hex digits — a line ending is not a divergence) and `disposeCapability` consumes that map. The counts inverted: **`25 capabilities: MERGE_REQUIRED 24, PARENT_CANONICAL 1`**, over `166/254 shared paths divergent`. `PARENT_CANONICAL` now means "every source path is present in the target tree AND all shared paths are byte-identical", and a shared path whose content could not be read is `UNKNOWN` with the reason printed rather than a verdict. Both capabilities the review named are now correct:
    - `| Database schema | 1 | 1 | 0 | 1 | 1 | MERGE_REQUIRED | every source path is present in the target tree, but 1 of 1 shared path(s) differ in content, so the target does not hold the source implementation |`
    - `| Authorization | 2 | 14 | 0 | 2 | 2 | MERGE_REQUIRED | … | apps/web/src/lib/admin/guard.ts apps/web/src/lib/rbac.ts |`
  - Evidence, verbatim:
    - `node tools/simon-convergence-inventory.mjs` -> `disposition: 25 capabilities, 20 packages, 166/254 shared paths divergent`
    - `node --test tests/simon-convergence-inventory.test.mjs` -> `# tests 24 / # pass 24 / # fail 0`
    - `node tools/simon-convergence-inventory.mjs --check` -> `ok — 4 documents match docs/architecture/simon-convergence-inventory.json`
  - Mutations, one literal at a time, generator re-run after each, each restored and re-verified 24/24:
    1. `disposeCapability`'s divergence filter `divergence.get(f)?.identical === false` -> `=== 'zzz'`, so no shared path can ever count as divergent and every capability falls back to `PARENT_CANONICAL` — the exact defect the review found, re-injected -> `not ok 11 - every capability disposition re-derives from the baseline file lists and the divergence table`, errors `Frontend framework: divergent 0 recounts as 1` and `Frontend framework: says PARENT_CANONICAL, the rule gives MERGE_REQUIRED`, `# pass 23 / # fail 1`.
    2. `digestOf` `.slice(0, 16)` -> `.slice(0, 3)` -> `not ok 12 - the divergence table is two trees compared, and an "identical" claim is falsifiable`, errors `.github/workflows/ci.yml carries something that is not a digest` and two more, 23/1. The guard re-checks the SHAPE of every digest rather than trusting the verdict computed from it.
    0 survivors. The earlier proof still holds and is the reason this guard is not circular: the test does not call `disposeCapability` — it rebuilds each row's `pattern` and `exclude` out of the row itself, recounts against the baseline file lists, and re-decides the label with the rule written out again.
  - Which four of the eight labels this evidence can assign, stated in the document rather than implied: `PARENT_CANONICAL`, `MERGE_REQUIRED`, `REIMPLEMENT_REQUIRED` and `UNKNOWN`. `SOURCE_SUPERIOR`, `CONFIG_ONLY`, `DATA_ONLY` and `DEPRECATE_AFTER_PROOF` are judgements about quality, intent and proof; nothing derivable from two trees supports one, so this generator never assigns them and the guard reds if it does. A row that would need one is `UNKNOWN` with the reason printed — the bible's own eighth label and the honest answer.
  - Honest limit, now much narrower than it was: a disposition is computed from paths AND from content digests, not from behaviour. `MERGE_REQUIRED` on a shared path means the two files are not the same bytes; it does not say which side is better, and it never claims to.

- [x] **SIMON-000-007** — Inventory source licenses, generated artifacts, vendored code, binaries, large files, secret history indicators, vulnerable dependencies, and unsupported runtimes before importing.
  - Status: PASS
  - Code: `tools/simon-convergence-inventory.mjs` — `importRisk` (line 985),
    `GENERATED_PATTERNS` (764), `VENDORED_PATTERNS` (772),
    `SECRET_INDICATOR_PATTERNS` (787), `BINARY_EXTENSIONS` (796),
    `LARGE_FILE_BYTES` (799), `blobSizes` (802), `everAddedPaths` (822),
    `auditSource` (851), `NODE_RELEASE_TABLE` (927), `declaredRuntimes` (946),
    `renderImportRisk` (1413). `readBlobs` is now exported from
    `tools/simon-absorption-inventory.mjs:676` and reused rather than
    reimplemented — the byte-accurate `cat-file --batch` header parse is the one
    genuinely fiddly thing in that file and a second copy of it would be a defect.
  - Caller: as above
  - Artifact: `docs/architecture/simon-import-risk-inventory.md`
  - Tests: `tests/simon-convergence-inventory.test.mjs` — the import-risk path
    case, the audit case, the UNKNOWN-discipline case and the runtime case,
    inside the 18
  - Evidence, verbatim: `import risk: audit 10 advisories`; and from the
    document, `npm audit --package-lock-only --json against the pinned source
    lockfile resolved 844 dependencies and reported 10: 3 critical, 7 high, 0
    moderate, 0 low, 0 info`. 28/28 green.
  - Mutations: (a) snapshot — `package.json` pushed onto the secret-indicator
    list → `not ok 15 - every import-risk path is in the source tree, or says why
    it is not`, `# pass 17 / # fail 1` (the test re-matches every listed path
    against the declared indicator patterns, so an invented entry cannot sit
    there). (b) snapshot — `import_risk.licenses.dependency_licenses.command`
    deleted → `not ok 17 - every UNKNOWN in the snapshot carries the command that
    would answer it`, 17/1. 0 survivors.
  - All eight inventories the requirement names, with what each found:
    - **Licenses.** The source tree contains NO `LICENSE`, `COPYING` or `NOTICE`
      file, and neither of its two manifests declares a `license`. Both are
      `private: true`, so npm does not require one — but an import into this
      repository still needs a stated basis, and right now there is not one.
    - **Generated artifacts.** One: `package-lock.json`.
    - **Vendored code.** 22 paths, all under `Tier1/` — the pilot's own document
      directory, listed by path and never opened, exactly as the baseline
      generator treats it.
    - **Binaries.** 25 files, 3,775,780 bytes, all `Tier1/` PDFs, ZIPs and DOCXs.
    - **Large files.** None at or above 1 MiB. Sizes come from
      `git ls-tree -r -l`, which is a size and not a content read.
    - **Secret history indicators.** `.npmrc` is tracked at the pinned commit and
      was first added in `a9d901bc1ed8afc8f6bfc79d45be69150018aa58` on 2026-07-30.
      Matched by NAME. It is not opened by the generator or by its tests — the
      finding is that a path with that shape exists, and confirming it by reading
      the file would be repeating the leak. `git log --diff-filter=A --name-only`
      is what answers the "ever added, even if since deleted" half, which is the
      half that decides whether something has to be rotated.
    - **Vulnerable dependencies.** 3 critical and 7 high, against the pinned
      lockfile: `@auth/core`, `@auth/prisma-adapter` and `next-auth` critical,
      and `brace-expansion`, `js-yaml`, `nanoid`, `next`, `postcss`, `sharp`,
      `xlsx` high, each with its GHSA advisory URLs. Three of the criticals are in
      the authentication stack of a live pilot carrying real student records.
      Read with `--package-lock-only`: the manifest and lockfile are extracted
      from the pinned commit into a temporary directory, no install runs and no
      lifecycle script executes, and the directory is deleted afterwards.
    - **Unsupported runtimes.** Both repositories pin Node 20 — source
      `package.json` `engines.node: ">=20"`, `apps/web/Dockerfile`
      `FROM node:20-alpine`, and `ci.yml` — and Node 20 reached end of life on
      2026-04-30. `apps/system-studio/Dockerfile` is on 22 and is not flagged.
      The end-of-life dates are the ONE thing on that page not read out of the
      trees, so they are labelled as an external table, dated `as_of` and cited
      to `https://github.com/nodejs/release#release-schedule`, and the guard test
      re-derives every `unsupported` verdict from that table's own dates.
  - One `UNKNOWN`, deliberately: the license of each declared source dependency.
    Answering it needs a registry lookup per package, which this generator does
    not do because it does not install or resolve a tree. It is recorded as
    `UNKNOWN` naming `npm view <package> license`, not as "permissive" —
    "we could not look" and "we looked and found nothing" are different answers,
    and the guard test reds if any `UNKNOWN` in the snapshot fails to name the
    command that would answer it.
  - `npm audit` first returned `UNKNOWN` on Windows for a reason worth recording,
    because it looked exactly like a registry that would not answer: Node 22
    refuses to `execFile` a `.cmd` without a shell (the fix for CVE-2024-27980),
    and `npm` on Windows is `npm.cmd`, so the spawn failed with `EINVAL` before
    npm was ever reached. Had that gone unnoticed the row would have read
    `UNKNOWN` forever and looked principled. `shell: true` is now set on win32
    only, over three fixed literal arguments with no interpolation.

- [ ] **SIMON-000-013** — Produce `docs/migrations/simon/current-state-inventory.md` with capability, source path, target path, deployed owner, data owner, security classification, users, dependencies, migration disposition, risk, and evidence.
  - Status: FAIL
  - What now exists: seven of the eleven columns are derivable today, and four of
    those are already generated. Capability, source path, target path and
    migration disposition are `docs/architecture/simon-capability-disposition.md`
    (SIMON-000-006); dependencies are the baseline inventory's two import graphs
    (SIMON-000-002); evidence is the pinned commits plus the per-path citations
    both artifacts carry.
  - What is missing, precisely: **deployed owner** and **data owner** are
    `SIMON-000-008` and `SIMON-000-009` — which repository, commit and workflow
    owns each deployed AWS resource, and which system is authoritative for each
    dataset. Neither can be answered from a file tree; both need authorized
    read-only calls against the pilot's AWS account. **Security classification**
    and **users** need `SIMON-000-010`/`SIMON-000-012` — sanitized row counts,
    Cognito user mappings and telemetry.
  - Why this is a FAIL and not a `BLOCKED_EXTERNAL`: the four blocking
    requirements are themselves unattempted, so the blocker is programme order
    rather than a missing credential. Writing the document now would mean eleven
    columns of which four are `UNKNOWN` in every row, presented as a baseline —
    and §4.3 calls this the baseline artifact, which is the one document that must
    not be mostly blanks.
  - The cheapest path to closing it: `SIMON-000-008` and `SIMON-000-009` first,
    then this becomes a join over three generated snapshots rather than a
    hand-written table.

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

## SIMON-010-005 — the shared code is a DAG, and the one production import cycle is gone

- [ ] **SIMON-010-005** — "Define module boundaries and dependency direction; prohibit circular imports and direct cross-module table access."
  - Status: FAIL
  - Overturned on review: Mutations all reproduce and the code is real and CI-reached — it fails on scope (check 1). Baseline `node --test tests/architecture/simon-module-boundaries.test.mjs` = 11/11. Mutation 1 (packages/audit/src/record.ts line 40 repointed to `@tenure/configuration`) -> `not ok 4 ... acyclic`, 10/1; restored 11/11. Mutation 6 (stripComments line 114 -> `.map((l) => l)`) -> `not ok 2 - the import scanner reads code and not comments`, 10/1; restored 11/11. Mutations 2 and 8 I had to run on packages/finops/src/money.ts instead of packages/authorization/src/decide.ts — another agent is concurrently mutating decide.ts and overwrote my copy mid-run — and both fire identically there: `import { PrismaClient } from "@prisma/client"` -> `not ok 6 - no core package reads another module's tables`, 10/1; `import { deep } from "@tenure/contracts/src/internal"` -> `not ok 5 - no production import reaches past a workspace's declared entry point`, 10/1. `node tools/simon-module-boundaries.mjs --check` = ok; workspaces 16, production cycles 0, deep imports 0, table access 0. tools/run-platform-tests.mjs recurses tests/, and ci.yml line 88 runs `npm run test:platform`, so it is reached. THE PROBLEM: the requirement's second clause is "prohibit ... direct cross-module table access", and the delivered prohibition binds only `packages/` and `modules/` (CORE_ROOTS, tools/simon-module-boundaries.mjs:75), explicitly exempting `apps/` as "the composition edge". No shared package has a database dependency at all, so `table access 0` is structurally unreachable there — while the layer where the platform's modules actually live is unguarded. The claim's own sibling artifact proves the miss: docs/architecture/simon-data-dictionary.json records 40 of 52 target entities read by 2+ platform domains (Organization by 11, AuditEvent by 9, ApprovalRequest by 8). I confirmed it independently outside the snapshot — `apps/web/src/app/(app)/calendar/actions.ts` and `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts` both read `prisma.approvalRequest`, the approvals module's own table. That is direct cross-module table access, unprohibited by anything. The tenant-boundary exemption argument (a request arrives carrying a tenant, so the app must be able to resolve one) is an argument about SIMON-010-008, and it was carried over to the table-access rule where it does not hold. Boundaries/direction/acyclic are genuinely closed; the second clause is not, so this closes part of the requirement.
  - Code: `tools/simon-module-boundaries.mjs` — `workspaces`, `importsOf`, `stripComments`, `importGraph`, `cyclesOf`, `tiers`, `tableAccess`, `undeclaredDependencies`, `analyse`, `INVARIANTS`. Production fix: `stableStringify` moved to `packages/contracts/src/index.ts`, re-exported from `packages/configuration/src/merge.ts`, and `packages/audit/src/record.ts:40` repointed to `@tenure/contracts`.
  - Caller: `tests/architecture/simon-module-boundaries.test.mjs` imports it; `tools/run-platform-tests.mjs` discovers `tests/` recursively and `npm run test:platform` runs it, which `.github/workflows/ci.yml` runs on every push and pull request. Confirmed discovered: `node tools/run-platform-tests.mjs` lists `tests\architecture\simon-module-boundaries.test.mjs` among the files it runs.
  - Artifact: `docs/architecture/simon-module-boundaries.md` — tier table, cycle list, table-access list, tenant-configuration boundary, deep imports, and the 20 undeclared workspace dependencies (reported, not prohibited).
  - Tests: `tests/architecture/simon-module-boundaries.test.mjs` — 11 cases, `# tests 11 / # pass 11 / # fail 0`. Package regression after the refactor: `npx jest --config apps/web/jest.config.js --rootDir apps/web packages/configuration packages/audit packages/contracts packages/releases` -> `Test Suites: 16 passed, 16 total / Tests: 583 passed, 583 total`.
  - Evidence, verbatim:
    - `node tools/simon-module-boundaries.mjs` -> `workspaces 16; production cycles 0; deep imports 0; table access 0; tenant-config imports 2; tenant-named core modules 0; undeclared deps 20`
    - before the fix, the same command -> `production cycles 1` and the document read `@tenure/audit -> @tenure/configuration -> @tenure/audit`, with `@tenure/audit`, `@tenure/configuration`, `@tenure/platform-config`, `@tenure/provisioning` and `@tenure/releases` all `UNTIERED`
    - `npm run type-check` -> the only two errors are `packages/provisioning/src/manifest-values.ts(410,18)` and `packages/provisioning/src/purge-exit.test.ts(118,78)`, both in another agent's untracked files; nothing in `contracts`, `configuration` or `audit`
    - `DETERMINISTIC: all 3 artifacts byte-identical across two runs`; `node tools/simon-module-boundaries.mjs --check` -> `ok — docs/architecture/simon-module-boundaries.md matches the tree`
  - Mutations, one at a time, each restored and re-verified green:
    1. Production code — `packages/audit/src/record.ts` import back to `@tenure/configuration` -> `not ok 4 - SIMON-010-005 — the production import graph of the shared code is acyclic`, `# pass 10 / # fail 1`.
    2. Production code — `import { PrismaClient } from "@prisma/client"` in `packages/authorization/src/decide.ts` -> `not ok 6 - SIMON-010-005 — no core package reads another module's tables`, 10/1.
    3. Production code — `import { deep } from "@tenure/contracts/src/internal"` in the same file -> `not ok 5 - SIMON-010-005 — no production import reaches past a workspace's declared entry point`, 10/1.
    4. Production code — `stripComments`' line-comment strip replaced by `.map((l) => l)` -> `not ok 2 - the import scanner reads code and not comments`, 10/1. This is the one that matters for honesty: `packages/provisioning/src/manifest.ts` mentions `@tenure/blueprints` twice, both times in a comment saying it deliberately does not import it, and a scanner that reads comments records the denial as the violation.
    0 survivors of the four that bear on this requirement.
  - Why the fix and not an allowlist: the cycle was two packages hashing with the same canonical serializer, and `record.ts`'s own comment already said "two definitions of canonical is one too many". Copying the function into `@tenure/audit` would have removed the cycle and broken the audit chain's compatibility with the release digest the first time one copy changed. `@tenure/contracts` declares itself dependency-free precisely so a job runner, an HTTP handler and a queue consumer can all speak it.
  - What the guard asserts, and what it deliberately does not: it asserts PROPERTIES of the live tree (acyclic, no deep imports, no database client, no per-tenant path import, no Simon-aware core file, no tenant-named core module) and never that the rendered document equals the tree. Eleven people edit this repository at once; a snapshot-equality assertion over a live tree turns somebody else's unrelated import into a red suite. `--check` exists for the person regenerating the document.
  - Honest limits: the import scan is textual, like every other scan in this family, so a specifier assembled at runtime is invisible to it. Type-only imports are collected and reported separately rather than prohibited, because `import type` is erased and a cycle made only of those is not a cycle at runtime — 8 cycles exist once type-only and test imports are included and they are printed in the document. The 20 undeclared workspace dependencies are reported and not prohibited: fixing one is a manifest change that has to go through an install, and this analyser will not run one.

## SIMON-000-014 — the data dictionary and entity matrix, both systems, both pinned commits

- [x] **SIMON-000-014** — "Produce current data dictionary and entity/field/key/constraint/index/retention/owner matrix for both systems."
  - Status: PASS
  - Code: `tools/simon-data-dictionary.mjs` — `parseSchema` (83), `entityShape` (128), `accessorOf` (167), `domainOf` (170), `accessorsOf` (182), `commitOf` (212), `collect` (270), `render` (368). Unchanged this session; its coverage against the requirement's sentence was already confirmed on review — entity/field/key/constraint/index/retention/owner, both sides, with retention as **NONE DECLARED** and owner as **NO ACCESSOR** rather than as zero.
  - Caller: `tests/architecture/simon-data-dictionary.test.mjs:8` imports it; `tools/run-platform-tests.mjs:26` discovers that spec by recursing `tests/`, and `.github/workflows/ci.yml:155` runs `npm run test:platform`.
  - Artifacts: `docs/architecture/simon-data-dictionary.md` (people), `docs/architecture/simon-data-dictionary.json` (machine). Byte-identical to what was committed — `node tools/simon-data-dictionary.mjs --check` -> `ok — 2 artifacts match the pinned trees`.
  - Tests: `tests/architecture/simon-data-dictionary.test.mjs` — 13 cases, `npm run test:platform` (bare `node --test`, not jest)
  - What was wrong and is now fixed: 5 of the 13 cases (3, 4, 7, 8, 12) called `schemaAt(pinned_commit)` and hard-asserted the blob. Neither pinned object exists on every machine — the source pin lives only in a clone that has `live` configured and fetched, and `actions/checkout@v4` clones at depth 1, so even the target pin, an ancestor of `main`, is absent there. `readBlobs` answers a missing object by omission, so `schemaAt` returned `undefined` and `assert.ok(text, …)` turned "we could not look" into "the snapshot is wrong". The repository had already settled the shape in `tests/simon-absorption-inventory.test.mjs:175` and this guard had not used it.
  - The fix, and why it is not a blanket skip: a new `schemaOrSkip(t, which, commit)` returns `null` and emits a diagnostic naming `git fetch live` where the object is absent — and every one of the five cases now carries snapshot-internal assertions BEFORE the git call. Case 3/7: the entity list equals the dictionary's own keys, no entity is listed twice, every entity's field count equals its dictionary length, no enum is listed twice and none declares zero members. Case 4/8: `accessor` equals `accessorOf(entity)` (a pure function), every primary key, index, unique constraint and foreign key names a field that entity actually has, and the non-vacuity checks that some entity has a key, an index and a foreign key. Case 12: every reported enum divergence agrees with the snapshot's own per-side enum lists AND nothing that differs is missing from the list. A skipped re-derivation therefore never leaves a case asserting nothing.
  - Evidence, verbatim:
    - before, in a simulated depth-1 checkout (`GIT_OBJECT_DIRECTORY` pointed at an empty directory): `not ok 3`, `not ok 4`, `not ok 7`, `not ok 8`, `not ok 12`, `# tests 13 / # pass 8 / # fail 5`, error `apps/web/prisma/schema.prisma is not readable at 47c1128cb55953b11bedc47927508bc5d622b159`
    - after, same command: `# tests 13 / # pass 13 / # fail 0`, with `source: … Re-derivation from git skipped; the snapshot-internal checks above still ran.`
    - with git available, before and after: `# tests 13 / # pass 13 / # fail 0`
    - all five Simon specs together: `# tests 71 / # pass 71 / # fail 0`
  - Mutations, one at a time, **each run in the simulated shallow checkout** — the environment where a vacuous fix would show — and each restored and re-verified 13/13 afterwards:
    1. snapshot: source `Account.fields` incremented by one -> `not ok 3 - source — every entity is a model declared in that tree's schema, and none is missing`, 10/3 (`not ok 1` and `not ok 11` are the expected collateral of editing a snapshot the document renders from).
    2. snapshot: target `Account.unique_constraints[0]` -> `zzzNotAField` -> `not ok 8`, error `Account constraint names "zzzNotAField", which is not one of its fields`, 11/2.
    3. snapshot: `comparison.enums_differing[0].source` truncated, document re-rendered from the mutated snapshot so only the enum rule could red -> `not ok 12 - an enumeration carried by both trees with different members is reported`, 12/1 — exactly one case.
    0 survivors.
  - Relation to `124f970` ("CI can now read the tree the absorption tests compare against"): that commit makes CI fetch both pinned commits before the platform suite, trying `origin` then `live`. It fixes the common case; its own fallback line says `$sha NOT fetchable from either remote — the test that reads it will say so`, and until now what the test did in that case was fail. Now it says so. The two changes are complementary and neither replaces the other.
  - Honest limit, unchanged: the owner column is a textual accessor scan, so an access made through a variable rather than `db.<entity>.` is invisible to it, and the document says so where the table is.

- [x] **SIMON-000-015** — "Produce route/API/event/workflow/permission/role/report/integration mapping matrices."
  - Status: PASS
  - Code: `tools/simon-mapping-matrices.mjs` (new, 568 lines) — `routeUrlOf` (84), `methodsOf` + `HTTP_METHODS` (93), `permissionExportsOf` + `PERMISSION_NAME` (117), `eventsOf` + `EVENT_KINDS` (140), `WORKFLOW_ENUM`/`ROLE_ENUM` (176), `REPORT_PATH`, `INTEGRATIONS` (190), `side` (215), `matrixOf` (310), `AXES` (390), `collect`, `render`, `digestOf`, `STATES`. The Prisma parse is `parseSchema` imported from `tools/simon-data-dictionary.mjs` and the blob reader is `readBlobs` imported from `tools/simon-absorption-inventory.mjs` — neither is reimplemented, for the reason this repository already carries a note about.
  - Caller: `tests/architecture/simon-mapping-matrices.test.mjs:8` imports it; `tools/run-platform-tests.mjs:26` (`discover`, recursive over `tests/`) finds that spec — confirmed with `node tools/run-platform-tests.mjs --list` printing `tests\architecture\simon-mapping-matrices.test.mjs` — and `.github/workflows/ci.yml:155` runs `npm run test:platform`. So the module is reached by the suite CI runs, not only by a person typing the generator's name.
  - Artifacts: `docs/architecture/simon-mapping-matrices.md` (people, 340 lines), `docs/architecture/simon-mapping-matrices.json` (machine — every row with its state, its reason, and its cited paths on both sides)
  - Tests: `tests/architecture/simon-mapping-matrices.test.mjs` — 13 cases, `npm run test:platform` (bare `node --test`, not jest)
  - Evidence, verbatim:
    - `node tools/simon-mapping-matrices.mjs` -> `mapping matrices: route 58, API 34, event 10, workflow 28, permission 68, role 6, report 14, integration 10; source-only 2`
    - `node --test tests/architecture/simon-mapping-matrices.test.mjs` -> `# tests 13 / # pass 13 / # fail 0`
    - all five Simon specs together -> `# tests 71 / # pass 71 / # fail 0`
    - `node tools/simon-mapping-matrices.mjs --check` -> `ok — 2 artifacts match the pinned trees`
    - two consecutive runs, SHA-256 compared -> `DETERMINISTIC: both artifacts byte-identical across two runs`
  - Mutations, one literal at a time, generator re-run after each, each restored and re-verified 13/13:
    1. `routeUrlOf` stops dropping `(group)` segments -> `not ok 6 - a route identity is the URL its own path answers on, derived again here`, 12/1.
    2. `methodsOf` loses the destructured-export branch -> `not ok 7 - an API identity is a real HTTP method on the URL its own handler answers on`, 12/1.
    3. `PERMISSION_NAME` drops its `^is…Role` alternative -> `not ok 8 - every permission name really is one the stated selector admits`, 12/1.
    4. `ROLE_ENUM` `/(?:Role|Scope)$/` -> `/Role$/` -> `not ok 11`, `PRESIDENT is a role in both trees and the role matrix does not carry it`, 12/1.
    5. `WORKFLOW_ENUM` `/Status$/` -> `/ApprovalStatus$/` -> `not ok 11`, `EventStatus.PENDING_APPROVAL is a declared workflow state and the matrix does not carry it`, 12/1.
    6. `digestOf` `.slice(0, 16)` -> `.slice(0, 0)`, so no two files can differ -> `not ok 12 - a BOTH row's verdict re-derives from digests computed here`, 12/1.
    7. every row compared as a declaration (`a.compare === 'declaration'` -> `a.compare !== 'zzz'`) -> `not ok 4` AND `not ok 12`, 11/2.
    8. snapshot: one route row `BOTH — differs` -> `SOURCE ONLY`, totals adjusted, **document re-rendered from the mutated snapshot** so only the state rule could red -> `not ok 4 - every state is one of the four, and it is the state the two file lists give`, 12/1.
    0 survivors. Mutation 4 is the one worth keeping: it SURVIVED the first version of the guard, because that case re-derived the expected members using the very selector it was checking. Naming six roles spanning both declared enumerations fixed it. A re-derivation that shares a constant with the thing it re-derives is not a re-derivation.
  - What makes this a matrix rather than a second file list, stated in the document itself: SIMON-000-002 already lists every path in both trees and SIMON-000-006 already compares them path by path. Both key on the PATH. Every matrix here keys on the thing's own IDENTITY — the URL a route answers on, the method an API exposes, the state a workflow can be in, the name of a role — and only then cites the paths. `(group)` segments are dropped, so `apps/web/src/app/(app)/dashboard/page.tsx` is the route `web /dashboard`; the guard reds if a routing group leaks into an identity.
  - Four states, and the vocabulary is closed: `BOTH — same implementation` (every backing file byte-identical after line-ending normalisation), `BOTH — differs`, `SOURCE ONLY` (the absorption items), `TARGET ONLY`. The two enumeration axes are compared as DECLARATIONS rather than through the digest of the schema file they live in — `ApprovalStatus.APPROVED` is declared identically on both sides, and letting the file decide would report all 25 shared workflow states as divergent for a reason that has nothing to do with any of them. The guard reds if any other axis is compared that way.
  - The three findings that are actionable now:
    - **The pilot's authorization surface has two exports this repository does not have.** `canViewApproval` (`apps/web/src/lib/approvals.ts`) and `isFinanceRole` (`apps/web/src/lib/rbac.ts`) are the only two `SOURCE ONLY` rows in the permission matrix. They are corroborated independently by `docs/architecture/simon-concept-collisions.md`, which found them with a different scan for SIMON-000-005, and the guard asserts both by name.
    - **The pilot integrates with three systems; this repository with ten.** `Amazon S3`, `NextAuth` and `Prisma` are the pilot's only detected outbound integrations — re-checkable from its own manifest, which declares `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` and `next-auth` and nothing else of the kind. SES, SQS, Cognito, Secrets Manager, Stripe, Google and Azure AD are all `TARGET ONLY`. An absorption plan that assumes the pilot already mails through SES is wrong.
    - **A scanner gap this found and fixed.** Both trees mount NextAuth's catch-all as `export const { GET, POST } = handlers`. The first version of `methodsOf` could not read that form, so `/api/auth/[...nextauth]` — the endpoint every session in the platform depends on — read `NONE-EXPORTED`. It now reads `GET` and `POST`, and the guard reds if any auth endpoint reads `NONE-EXPORTED` again.
  - Machine portability, proved rather than asserted: with `GIT_OBJECT_DIRECTORY` pointed at an empty directory — a faithful simulation of the depth-1 CI checkout that cannot reach either pinned commit — the spec is still `# tests 13 / # pass 13 / # fail 0`, printing `0 of 2 schemas re-read from git in this environment` as a diagnostic while every snapshot-internal check still runs. Every git-backed case carries checks that need no git, so a skipped re-derivation never leaves a case asserting nothing.
  - Honest limits, stated in the document: every scan is TEXTUAL, so a route mounted at runtime, a handler re-exported through a barrel, or a permission reached through a variable is invisible. `BOTH — same implementation` is a claim about a row's BACKING FILES and not about behaviour — two byte-identical modules can behave differently if what they import differs, and the capability disposition is where that is compared. The permission axis keys on the exported NAME, so a permission decided inline inside a handler with no exported symbol is a finding of `simon-hardcoded-assumptions.md` instead. `workflow cron` is **0** on both sides and that zero is printed as a search that ran, not omitted.
  - Not added to the root `generate` script: neither `simon-convergence-inventory.mjs` nor `simon-data-dictionary.mjs` is in it either, and `package.json` is a shared file eleven agents were editing this hour. `--check` gives it the same staleness guard its siblings have.

## SIMON-010-008 — the check is shipped and fires; two core packages still import the tenant registry

- [ ] **SIMON-010-008** — "Add architecture checks preventing imports from `tenant-config/tenants/simon-ose` into generic core packages."
  - Status: FAIL
  - What is now true: the architecture check exists, runs in CI, and fires on the two shapes that matter. What is not: two generic core packages import the tenant registry, so the boundary the bible asks for does not yet hold.
  - Code: `tools/simon-module-boundaries.mjs` — `TENANT_CONFIG_WORKSPACE`, `TENANT_CONFIG_ENTRY`, `tenantSpecificExports`, `tenantConfigImports`, `simonAwareCoreFiles`, `KNOWN_TENANT_REGISTRY_IMPORTS`.
  - Caller: `tests/architecture/simon-module-boundaries.test.mjs`; discovered by `tools/run-platform-tests.mjs` and run by `npm run test:platform`, which `.github/workflows/ci.yml` runs on every push and pull request.
  - Artifact: `docs/architecture/simon-module-boundaries.md`, "Tenant configuration boundary".
  - Tests: 11 cases, `# tests 11 / # pass 11 / # fail 0`. Four are this requirement's: the classifier case, the per-tenant-path case, the shrink-only case and the conjunction case.
  - The §5 reading, stated because it is the one judgement here: the bible draws `tenant-config/tenants/simon-ose/` and then says in the same section "Do not force these literal paths if the real monorepo has a better coherent convention." This repository's convention is `blueprints/index.ts` — one workspace holding the blueprint catalog and the tenant bindings, where a binding is the per-tenant overlay a `tenants/<slug>/` directory would hold. The guard is therefore written against the concept: whatever that entry point exports that NAMES SPECIFIC TENANTS is what a generic core package may not import.
  - And which exports those are is COMPUTED, never listed. `tenantSpecificExports` parses the entry point and classifies an exported `const` as tenant-specific if its initializer carries a `slug:` literal or is derived from one that does. Today that yields `TENANT_BINDINGS`, `CUSTOMER_TENANT_BINDINGS`, `RESERVED_TENANT_SLUGS` — and NOT `getTenantBinding`, `getBlueprint`, `archetypeFor` or `BLUEPRINTS`, because a slug-parameterised resolver is how a tenant arrives as an argument and forbidding it would forbid the platform from resolving anybody. A hand-written list of forbidden symbols would stop working the day somebody adds the fourth one, and stop working silently.
  - Evidence, verbatim: `node tools/simon-module-boundaries.mjs` -> `tenant-config imports 2`; from the document, `Core production files importing a per-tenant path: **0** — prohibited.` and `Core production files importing the tenant registry: **2** — known, named, and shrink-only.` naming `packages/platform-config/src/modules.ts:1` and `packages/platform-config/src/resolve.ts:10`.
  - Mutations, one at a time, each restored and re-verified 11/11:
    1. Production code — `import { simonManifest } from "../../../tenant-config/tenants/simon-ose/manifest"` in `packages/authorization/src/decide.ts` -> `not ok 8 - SIMON-010-008 — no core package imports a per-tenant configuration path` and `not ok 10`, `# pass 9 / # fail 2`.
    2. Production code — `KNOWN_TENANT_REGISTRY_IMPORTS`' first key pointed at a file that does not hold the import -> `not ok 9 - SIMON-010-008 — every core file named as importing the tenant registry still does`, 10/1. The list can only shrink; a site that gets fixed has to leave it, or the count in this row stops being true.
    3. Production code — `tenantSpecificExports` short-circuited to `return []` -> `not ok 7 - the tenant-config classifier separates a registry from a resolver` and `not ok 9`, 9/2. This is the non-vacuity proof: without it, the per-tenant-path case would pass against a tree full of registry imports.
    0 survivors of three.
  - What closing it needs, precisely: `modulesForEveryTenant` (`packages/platform-config/src/modules.ts:306`) and `systemConfigForEveryTenant` (`resolve.ts:242`) are `TENANT_BINDINGS.map(...)` fleet views. Both belong at the composition edge — `apps/system-studio`, which is the console that shows every tenant — and both should take the bindings as an argument rather than import them. That is a signature change with callers, which is why it is recorded here rather than done in the same session as the guard.
  - What is deliberately NOT asserted, and why: the guard does not fail on a core file importing the registry that is not on the named list. Importing the whole registry and mapping it is tenant-blind — it is what keeps this requirement open, not what makes the runtime Simon-aware — and a hard ratchet over it would red on another agent's in-flight work rather than on a violation (`packages/generality-fixtures/src/corporate-org.ts`, untracked as I write this, does exactly that legitimately). The conjunction case is what asserts the dangerous shape.
  - Not duplicated: `tests/architecture/no-tenant-fork-or-branch.test.mjs` already asserts that no shipped file, `packages/` included, contains a tenant SLUG literal. This guard adds the import DIRECTION, which that test does not check at all, and the tenant's proper nouns (`Simon`, `Ainslie`, `OSE`), which are not slugs and which that test cannot see.

## SIMON-100-013 — two of the three CI rules are closed; "core imports Simon configuration" is not

- [ ] **SIMON-100-013** — "Create CI rules that fail if core code imports Simon configuration, if a Simon-only core module appears, or if tenant code forks re-emerge."
  - Status: FAIL
  - Clause by clause, because the requirement is three rules and they are in three different states:
    1. **core code imports Simon configuration** — PARTLY. `no-simon-aware-core-file` fails when a core production file imports tenant configuration AND names a tenant, which is the shape the bible's §2 calls Simon-aware core business logic. It does NOT fail on a plain `TENANT_BINDINGS` import, and two core files have one. This clause is why the row is unchecked; see SIMON-010-008 for the two sites and the fix.
    2. **a Simon-only core module appears** — CLOSED. `no-tenant-named-core-module` fails when any path under `packages/` or `modules/` carries a tenant token. 0 today.
    3. **tenant code forks re-emerge** — CLOSED, and it was already: `tests/architecture/no-tenant-fork-or-branch.test.mjs` has four cases — no shipped file branches on a tenant, no shipped file names one, no path in the tree is named for one, and the seven files still holding a configured tenant word are named and shrink-only. Cited rather than re-implemented; a second copy of that scan would be the defect this repository already has a note about.
  - Code: `tools/simon-module-boundaries.mjs` — `simonAwareCoreFiles`, `tenantNamedCoreModules`, `tenantBindings`, `tenantTokens`, `GENERIC_ORG_WORDS`, `INVARIANTS`.
  - Caller: `tests/architecture/simon-module-boundaries.test.mjs`, discovered by `tools/run-platform-tests.mjs`, run by `npm run test:platform`, which `.github/workflows/ci.yml` runs on every push and pull request. "CI rules" means rules CI runs, and this is the step that runs them.
  - Tests: 11 cases, 11/11. Three are this requirement's: the conjunction case, the tenant-named-module case, and the meta-case asserting the analyser names exactly the invariants the guard asserts — because an invariant added to the tool and never asserted reads, from the document, as enforced.
  - Evidence, verbatim: `node tools/simon-module-boundaries.mjs` -> `tenant-named core modules 0`; from the document, `Tokens that name a tenant, derived from the bindings: ainslie, fixture-corporate, fixture-external-erp, fixture-rtl, midtown-arts, ose, rochester, simon.` and `Core paths carrying one: **0**.`
  - Mutations, one at a time, each restored and re-verified 11/11:
    1. Production code — `const PILOT_OFFICE = "Ainslie OSE"` inserted into `packages/platform-config/src/resolve.ts` -> `not ok 10 - SIMON-100-013 — no core file imports tenant configuration and names a tenant`, `# pass 10 / # fail 1`.
    2. Production DATA — the pilot binding's `displayName` in `blueprints/index.ts` -> `"Simon Business School — Ainslie OSE Audit"`, making `audit` a tenant token and `packages/audit/` a tenant-named path -> `not ok 11 - SIMON-100-013 — no core module is named for a tenant`, 10/1. Mutating the DATA rather than the code is what proves the token list is derived and not a constant.
    0 survivors of two.
  - One thing worth recording because it nearly shipped as a guard nobody would keep: the first derivation split slugs on their hyphens and took words from every binding's display name, which produced `corporate`, `external`, `erp`, `shared` and `coexistence` as "tenant tokens" and flagged six innocent files — `packages/payments/src/external-reference.ts` among them. Two rules fixed it and both are asserted by name in the test: a slug is a token WHOLE, and only a CUSTOMER's display name and terminology contribute words, because a fixture is deliberately named out of the product's own vocabulary and treating its words as tenant identity flags exactly the generic modules the fixture exists to prove are generic.
  - Honest limit: `packages/platform-config/src/definitions.ts:53` contains the string "Rochester calls it Ainslie OSE" in a configuration key's own description, and clause 1's rule does NOT fire on it, because that file does not import tenant configuration. It is not unguarded — it is one of the seven sites `no-tenant-fork-or-branch.test.mjs` names for PACK-010-004 — but it is a real tenant word in a shared package, and this guard is not the one that will remove it.

## SIMON-010-009 — measured, not built: a prohibiting check would red CI on 234 sites in one directory

- [ ] **SIMON-010-009** — "Add static checks for forbidden tenant-name/domain/account/resource literals outside approved configuration, tests, migrations, and documentation."
  - Status: FAIL
  - Code: none shipped for this requirement. That is the finding, not an omission — see below.
  - What exists already, so the next attempt does not rebuild it: `tests/architecture/no-tenant-fork-or-branch.test.mjs` asserts the TENANT-NAME half for slugs and for configured terminology words over `apps/web/src`, `apps/system-studio/src`, `packages` and `modules`, with a named seven-file shrink-only list. It does not cover domains, account ids, ARNs or resource identifiers, and it does not scan `infrastructure/`, `.github/workflows/`, `tools/` or `apps/web/scripts/`. `tools/simon-convergence-inventory.mjs` already locates all of them across both pinned trees and renders `docs/architecture/simon-hardcoded-assumptions.md`; what is missing is the ENFORCING half over the live tree.
  - Measurement, over git-tracked files, excluding tests, `docs/`, `prisma/migrations/` and non-scannable extensions, one pattern per kind:

    | Root | tenant name | education domain | AWS region | account-shaped | ARN |
    | --- | ---: | ---: | ---: | ---: | ---: |
    | `apps/web/src` | 234 | 6 | 9 | 1 | 0 |
    | `apps/web/scripts` | 152 | 2 | 0 | 0 | 0 |
    | `apps/system-studio/src` | 23 | 0 | 44 | 3 | 10 |
    | `packages` | 13 | 9 | 6 | 0 | 2 |
    | `infrastructure/` | 1 | 0 | 6 | 0 | 12 |
    | `.github/` | 3 | 0 | 30 | 1 | 0 |

  - Why FAIL and not a ratchet: a check that prohibits nothing is not a check, and a check that prohibits these reds CI immediately. The intermediate form — a named, shrink-only allowlist — is the repository's own convention (`HARD_CODED_TENANT_WORDS`), but at 234 sites in `apps/web/src` it would be a list nobody maintains, and while eleven agents are editing that directory concurrently every new page they add would red the suite on somebody else's requirement. That is the specific failure mode this wave was told to avoid.
  - Two things the measurement makes clear, which are worth having even without the check:
    - Of the 13 `packages` tenant-name hits, twelve are in COMMENTS and one is a string: `packages/platform-config/src/definitions.ts:53`, a configuration key's description reading "Rochester calls it Ainslie OSE". So the core packages are, in substance, already clean of tenant literals — the mass is in `apps/web/src` and `apps/web/scripts`, which is where SIMON-010-002 and SIMON-010-003 (move reusable behaviour into generic modules, move Simon-specific values into configuration data) have to land first.
    - The 44 AWS-region and 10 ARN hits in `apps/system-studio/src` are the control plane naming regions and services it operates. Whether those are "forbidden literals" or the console's legitimate vocabulary is a judgement this requirement's sentence does not settle, and a check written before that judgement is made will be wrong in one direction or the other.
  - The cheapest path to closing it, in order: SIMON-010-003 first (the values move into configuration, which is what makes the count fall), then a check whose allowlist is small enough to be read. Writing the check first produces a 234-line exemption list that reads as a policy and functions as a blindfold.
