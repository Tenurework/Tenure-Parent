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

- [ ] **SIMON-000-004** — Locate every hard-coded Simon/OSE/University/club/term/role/workflow/domain/account/region/resource assumption, including values hidden in fixtures, CSS, route names, reports, permission checks, and deployment scripts.
  - Status: FAIL
  - Overturned on review: Requirement says "locate EVERY hard-coded Simon/OSE/.../role ... assumption"; the scan does not locate the pilot's own role vocabulary. `role-constant` is a closed list of six names, two of which (OSE_ADMIN, VICE_PRESIDENT) occur nowhere in either tree, and it omits `enum InstitutionRole { OSE_DIRECTOR, OSE_STAFF, OSE_ADVISOR }` and `enum RoleScope { PRESIDENT, FUNCTIONAL, MEMBER }`. `tenant-token` cannot cover for it: /\bOSE\b/ does not match OSE_DIRECTOR because `_` is a word character. Measured on the pinned trees with the generator's own SCANNABLE/NOT_SCANNED filters: source has 107 OSE_DIRECTOR/OSE_STAFF/OSE_ADVISOR occurrences, 92 of them on lines where the snapshot records NO finding of any kind (20/11/6 files), plus 34 more unrecorded lines for FUNCTIONAL/MEMBER; target 192 occurrences, 172 unrecorded lines. Missed sites include apps/web/src/app/(app)/admin/actions.ts:15 `const INSTITUTION_ROLES: InstitutionRole[] = ["OSE_DIRECTOR","OSE_STAFF","OSE_ADVISOR"]`, apps/web/prisma/schema.prisma:81, and apps/web/prisma/migrations/20260730000000_baseline/migration.sql:5 `CREATE TYPE "InstitutionRole" AS ENUM (...)`. These are literal closed-set tokens in already-scanned files, so this is not the disclosed "a probe is a pattern, not a compiler" limit, and no honest-limits line discloses it. The `workflow` kind is also 0 on the source side while that tree carries `model ApprovalStep`, five `approvalStep.create` call sites and SLA escalation logic, so that row is empty rather than located. All 7 claimed mutations DO reproduce (0 survivors), but mutation 7 reds only `not ok 9` at 17/1, not `not ok 7`+`not ok 9` at 16/2 (the claimed shape needs a duplicate PLACES row, not a reorder), and its narrative is wrong: reports 41->9 but permission checks 89->89 on the source and 213->213 on the target, so only `reports` was being absorbed by `route names`.
  - Code: `tools/simon-convergence-inventory.mjs` — `ASSUMPTION_PROBES` (13
    content probes, line 143), `PATH_PROBES` (line 244), `PLACES` + `placeOf`
    (lines 269, 279), `SCANNABLE`/`NOT_SCANNED` (lines 126, 127),
    `scanAssumptions` (line 312), `renderAssumptions` (line 1172)
  - Caller: `tests/simon-convergence-inventory.test.mjs:57` imports it;
    `tools/run-platform-tests.mjs:32` discovers that spec by pattern and
    `npm run test:platform` runs it, so the module is reached by the suite CI
    runs rather than only by a person typing the generator's name
  - Artifacts: `docs/architecture/simon-hardcoded-assumptions.md` (people),
    `docs/architecture/simon-convergence-inventory.json` (machine — every
    finding, grouped by file and probe, with every line number)
  - Tests: `tests/simon-convergence-inventory.test.mjs` — 18 cases,
    `npm run test:platform` (bare `node --test`, not jest). Six of the eighteen
    are this requirement's: the render equality, the mask-leak guard, the reveal
    vocabulary, the baseline path check, the roll-up re-addition and the place
    partition.
  - Evidence, verbatim:
    - `node tools/simon-convergence-inventory.mjs` →
      `assumptions: source 1825 hits in 175 files, target 5909 in 619`
    - `node --test tests/simon-absorption-inventory.test.mjs tests/simon-convergence-inventory.test.mjs`
      → `# tests 28 / # pass 28 / # fail 0`
    - Two runs of the generator produced byte-identical output for all five
      artifacts (SHA-256 compared): `DETERMINISTIC: all 5 artifacts byte-identical across two runs`
    - `node tools/simon-convergence-inventory.mjs --check` →
      `ok — 4 documents match docs/architecture/simon-convergence-inventory.json`
  - Mutations, one at a time, each restored and re-verified green afterwards:
    1. `docs/.../simon-capability-disposition.md`: `## Package by package` →
       `## Package by packageZZZ` → `not ok 1 - the four documents are exactly
       what the snapshot renders`, `# pass 17 / # fail 1`.
    2. Snapshot: a `resource-identifier` finding's `tokens` →
       `["zzz-leaked-bucket-literal"]`, documents re-rendered from the mutated
       snapshot so only the guard under test could red → `not ok 3 - a masked
       probe leaks nothing`, `# pass 17 / # fail 1`. **The privacy control
       demonstrably fails when it should.**
    3. Snapshot: `assumptions.source.by_kind[club].hits` `925` → `424242` →
       `not ok 7 - every roll-up re-adds from the raw findings`, 17/1.
    4. Snapshot: one finding's `place` `"elsewhere"` → `"CSS"` → `not ok 7`,
       `not ok 8 - every finding's place is the place its own path resolves to`,
       `# pass 16 / # fail 2`.
    5. Snapshot: one finding's `file` → `apps/web/src/lib/zzz-does-not-exist.ts`
       → `not ok 5`, `not ok 6`, `not ok 7`, `not ok 8`, `# pass 14 / # fail 4`.
    6. Production code: `maskToken = (s) => '#'.repeat(s.length)` → `(s) => s`,
       generator re-run → `not ok 3`, 17/1. This is the one that proves the leak
       guard is not circular: the mutation is in the masking function itself and
       the test still catches it, because the test asserts a property of the
       output (`/^#+$/`) rather than calling the function.
    7. Production code: `PLACES` reordered so `route names` precedes `reports`,
       generator re-run → `not ok 7`, `not ok 9 - the hiding places stay
       specific-before-generic`, 16/2.
    0 survivors of the six that bear on this requirement.
  - What the scan actually found, and why the numbers are the point rather than
    the headline:
    - **Every assumption the requirement names has a row.** Source side: 637
      `Simon`/`OSE` tokens in 107 files, 925 `club` in 125, 111 hard-coded role
      checks in 43 (including `role === "OSE_DIRECTOR"` and `role === "OSE_STAFF"`),
      22 `University`, 21 `us-east-1`, 8 term literals — `Fall 2025` and
      `Fall 2026` among them. Target side: 5909 hits in 619 files, plus 445
      twelve-digit account-shaped runs and 479 resource identifiers, both masked.
    - **Every hiding place the requirement names has a row, and it is not
      empty.** Source: fixtures 55, CSS 2, reports 41, permission checks 89,
      deployment scripts 71, route names 391, elsewhere 1176. A finding is
      attributed to the FIRST matching place, so the seven rows partition the
      total exactly once and the guard test re-adds them.
    - The first ordering of `PLACES` put `route names` before `reports` and
      `permission checks`. `route names` matches everything under `src/app/`,
      which in Next.js is every page — so the report pages and the
      permission-checking server actions were being counted as route names, and
      two of the requirement's most interesting hiding places read as nearly
      clean. They were not; they were being absorbed by their neighbour. That is
      mutation 7 above, and it is why the order is asserted.
    - The largest single concentration in the source is
      `apps/web/src/lib/policies.ts` — 97 hits spanning tenant name, university,
      club, domain and role. `apps/web/src/lib/rbac.ts` carries 32.
      `SIMON-GATE-010` ("no Simon-aware core business logic") can now be argued
      from a list instead of from memory.
  - Honest limits, stated in the document itself: a probe is a pattern, not a
    compiler — it locates a literal and does not decide whether that literal is
    load-bearing, so a hit is not automatically a defect. `docs/` is excluded
    (prose is not runtime behaviour, and the generated inventories there mention
    the tenant thousands of times). Non-scannable extensions are not searched, so
    an assumption inside a spreadsheet or PDF is invisible; `Tier1/` is listed by
    path and never opened. `aws-account-id` matches any bare twelve-digit run, so
    a hit there is a shape to look at rather than an account — masked either way.

- [ ] **SIMON-000-005** — Locate duplicate business concepts implemented under different names across repositories and same names with different semantics.
  - Status: FAIL
  - Overturned on review: Both halves are closed on a narrower reading. (a) "Same names with different semantics" is answered only over JS/TS module exports: `compareConcepts` consumes `codeOf`, gated by /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, so schema, migration and API vocabulary are never compared — a restriction absent from the document's honest limits. Verified miss: `enum LedgerKind` exists in both apps/web/prisma/schema.prisma files with different members (source SPEND/REIMBURSEMENT/ADJUSTMENT; this repo also RECEIPT and REVERSAL) — the same name with different semantics in the financial ledger, the same divergence the ledger's own headline (deleteLedgerEntry vs reverseLedgerEntry) points at — and it appears nowhere in docs/architecture/simon-concept-collisions.md. (b) "Duplicate business concepts implemented under different names across repositories" locates nothing: the single CANDIDATE row pairs apps/web/scripts/generate-roster.mjs with apps/web/scripts/roster-data.sample.mjs, two fixture scripts that BOTH trees carry, so it is not a cross-repository pair; and the Jaccard metric scores on shared export NAMES, which a genuine rename by construction does not have. The claimed mutation reproduces (un-anchoring the `export function` pattern reds `not ok 14`, 17/1, restored 18/18).
  - Code: `tools/simon-convergence-inventory.mjs` — `exportsOf` (line 433),
    `compareConcepts` (line 526), `FRAMEWORK_CONTRACT_EXPORTS` (line 487),
    `SYNONYM_THRESHOLD` (line 472), `renderConcepts` (line 1266)
  - Caller: as above — `tests/simon-convergence-inventory.test.mjs:57`, reached
    by `npm run test:platform` through `tools/run-platform-tests.mjs:32`
  - Artifact: `docs/architecture/simon-concept-collisions.md`
  - Tests: `tests/simon-convergence-inventory.test.mjs` — the decided/candidate
    consistency case and the `exportsOf` unit case, inside the 18
  - Evidence, verbatim: `concepts: 26 same-name-different-shape, 4 symbol-kind
    collisions, 1 candidates` from the generator; 28/28 green as above.
  - Mutations: (a) production code — the `export function` pattern in `exportsOf`
    un-anchored (`^\s*` removed), generator re-run → `not ok 14 - the export
    scanner reads declarations rather than any word after "export"`, `# pass 17 /
    # fail 1`; the fixture's commented-out `// export function commentedOut()`
    starts counting as an export. (b) the document mutation and the render check
    above cover the rendering. 0 survivors.
  - Three findings, kept apart because they are three claims of different
    strength — which is the only honest way to report a similarity metric:
    - **Same name, different shape — DECIDED. 26 pairs.** Two matter for
      authorization: `apps/web/src/lib/rbac.ts` exports `isFinanceRole` in the
      pilot and not here, while this repository added `decideFinanceAction`,
      `carriesFinanceAuthority`, `acceptsWrites`, `OrgWriteTarget` and `OrgRef`.
      `apps/web/src/lib/approvals.ts` exports `canViewApproval` in the pilot and
      eleven different names here. And
      `apps/web/src/app/(app)/orgs/[slug]/finance/actions.ts` has
      `deleteLedgerEntry` in the pilot against `reverseLedgerEntry` here — a
      delete against a reversal is a semantic divergence in a financial ledger,
      not a rename.
    - **One identifier, two declaration kinds — DECIDED. 4.** `ButtonProps`,
      `Capability`, `DashboardLine` and `TabItem` each exist on both sides with a
      different declaration kind, and `TabItem` is a function in `apps/web` and
      an interface in `apps/system-studio`.
    - **Different names, overlapping shape — CANDIDATE. 1.** Labelled
      `CANDIDATE` in the row itself, with the threshold and the minimum export
      count printed beside the table so the list can be reproduced and argued
      with. A metric proposes; `SIMON-010-001` adjudicates.
  - The first run of the candidate metric produced eight pairs at Jaccard 1.0
    between unrelated admin pages and a layout. They were scoring a perfect match
    for agreeing about a framework contract: every Next.js page exports
    `default`, and most export `metadata` and `dynamic`. Those eighteen
    framework-dictated names are now excluded from the metric AND ONLY from the
    metric — the decided tables still count them, because a module that stopped
    exporting `default` genuinely changed shape. The minimum own-export count is
    4, and a pair carried by both trees is counted once rather than twice in each
    direction. The guard test asserts no candidate is scored on an excluded name.
  - Honest limits: the export scan is textual, like the baseline generator's
    import scan, so a name produced by a barrel chain or a runtime assignment is
    invisible to it. The two repositories share history — 184 module pairs at the
    same path export exactly the same names — which is why the decided tables
    report only the pairs that DIFFER. And a Jaccard candidate is a question, not
    an answer.

- [ ] **SIMON-000-006** — Build a package-by-package and capability-by-capability comparison: `PARENT_CANONICAL`, `SOURCE_SUPERIOR`, `MERGE_REQUIRED`, `CONFIG_ONLY`, `DATA_ONLY`, `REIMPLEMENT_REQUIRED`, `DEPRECATE_AFTER_PROOF`, or `UNKNOWN`.
  - Status: FAIL
  - Overturned on review: The guard is real and non-circular — I confirmed both claimed mutations: relabelling `Search` SOURCE_SUPERIOR in the snapshot reds `not ok 10` + `not ok 11` (16/2), and short-circuiting `disposeCapability` to return PARENT_CANONICAL then regenerating reds `not ok 11` (17/1) even though the test never calls that function. What fails is the requirement, not the harness: PARENT_CANONICAL is asserted for 23 of 25 capabilities from path presence alone, including `Database schema` (1|1|0) and `Authorization` (2|14|0), while the SAME snapshot proves the content diverges — apps/web/src/lib/rbac.ts has source-only export `isFinanceRole`, apps/web/src/lib/approvals.ts has source-only `canViewApproval`, and the two prisma schemas differ (LedgerKind members). The generator's own legend defines UNKNOWN as "the label needs a judgement this evidence cannot make", which is exactly this case; instead a positive verdict is recorded, i.e. unknown reported as a value — the rule this codebase calls central. The "honest limit" presents this as an evidence limit, but the generator already reads file content (for the assumption scan and the export scan), so a source file at a shared path carrying code the parent lacks can never raise MERGE_REQUIRED by rule, not for want of evidence — which makes the actionable output wrong in the direction that matters for an absorption decision (a pilot capability the parent lacks is labelled "the parent is canonical").
  - Code: `tools/simon-convergence-inventory.mjs` — `DISPOSITIONS` (line 659),
    `disposeCapability` (line 670), `disposePackages` (line 710),
    `renderDisposition` (line 1348). The capability probes are the baseline
    generator's `PROBES`, imported rather than re-declared, so the two documents
    cannot disagree about what a capability is.
  - Caller: as above
  - Artifact: `docs/architecture/simon-capability-disposition.md`
  - Tests: `tests/simon-convergence-inventory.test.mjs` — the label-vocabulary
    case, the capability re-derivation case and the package re-derivation case,
    inside the 18
  - Evidence, verbatim: `disposition: 25 capabilities, 19 packages`;
    `25 capabilities: MERGE_REQUIRED 2, PARENT_CANONICAL 23` and
    `19 workspaces across both repositories: MERGE_REQUIRED 1, PARENT_CANONICAL 18`
    in the rendered document; 28/28 green.
  - Mutations: (a) snapshot — capability `Search` relabelled `SOURCE_SUPERIOR` →
    `not ok 10 - every disposition is a label the bible enumerates, and never one
    a file list cannot decide` AND `not ok 11 - every capability disposition
    re-derives from the baseline file lists`, `# pass 16 / # fail 2`.
    (b) production code — `disposeCapability` short-circuited to return
    `PARENT_CANONICAL` for every capability, generator re-run → `not ok 11`,
    `# pass 17 / # fail 1`. That second one is the important one: the test does
    NOT call `disposeCapability`. It rebuilds each row's `pattern` and `exclude`
    out of the row itself, recounts against the baseline file lists, and
    re-decides the label with the rule written out again in the test — so a
    mutation inside the generator cannot move both sides at once. 0 survivors.
  - Which four of the eight labels this evidence can assign, stated in the
    document rather than implied: `PARENT_CANONICAL`, `MERGE_REQUIRED`,
    `REIMPLEMENT_REQUIRED` and `UNKNOWN`. `SOURCE_SUPERIOR`, `CONFIG_ONLY`,
    `DATA_ONLY` and `DEPRECATE_AFTER_PROOF` are judgements about quality, intent
    and proof, and nothing derivable from two file lists supports one — so this
    generator never assigns them, and the guard test reds if it does. A row that
    would need one is `UNKNOWN` with the reason printed, which is the bible's own
    eighth label and the honest answer.
  - The three findings that are actionable now:
    - `Frontend components` is `MERGE_REQUIRED`: the pilot has
      `apps/web/src/components/brand/TenantBackdrop.tsx` and
      `apps/web/src/components/brand/TenantSplash.tsx`, and this repository has
      neither. Tenant branding is exactly the thing §1 says Simon may keep, so
      those two are a real absorption item.
    - `Unit tests` is `MERGE_REQUIRED` on five specs the pilot has and this
      repository does not, three of them the document-sanitisation tests
      (`content.test.ts`, `mammoth-sanitize.test.ts`, `sanitize.test.ts`).
      Losing a sanitiser's tests in a convergence is how a sanitiser quietly
      stops being one.
    - `apps/web/package.json` is `MERGE_REQUIRED` on two dependencies the pilot
      declares and this repository's manifest does not; the document names them
      and the guard test re-derives the claim from both manifests.
  - Honest limit: a capability disposition is computed from PATHS, not from
    behaviour. `PARENT_CANONICAL` means the target tree holds every path the
    source probe matched — it does not mean the target implementation is as good,
    and it never claims to. 23 of 25 land there because the parent was branched
    from the pilot, so most source paths are literally present here.

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

- [ ] **SIMON-000-014** — "Produce current data dictionary and entity/field/key/constraint/index/retention/owner matrix for both systems."
  - Status: FAIL
  - Overturned on review: Every one of mutations A-F reproduces exactly as claimed, and the artifact itself is real and complete — it fails check 5, machine portability. Baseline: `node tools/simon-data-dictionary.mjs --check` = ok, `node --test tests/architecture/simon-data-dictionary.test.mjs` = 13/13. A (entityShape index extraction -> `[]`, regenerated) -> not ok 4 AND not ok 8, 11/2. B (Budget.owner_domains -> ['not-a-domain']) -> not ok 1 and not ok 10, 11/2. C (Budget.retention_fields -> ['createdAt'], doc re-rendered from the mutated snapshot) -> not ok 9 only, 12/1. D (source pinned_commit -> forty zeros, re-rendered) -> not ok 2, 3, 4, 12, 9/4. E (heading -> `entity matrixZZZ`) -> not ok 1, 12/1. F (`mapped_to: "president@example.edu"`) -> not ok 13, 12/1. Each restored to 13/13. Coverage against the requirement's sentence is genuinely complete (entity/field/key/constraint/index/retention/owner, both sides, retention as NONE DECLARED and owner as NO ACCESSOR rather than as zero), and the target pin is not stale: the 52 models in the snapshot equal the 52 in apps/web/prisma/schema.prisma today, name for name. THE PROBLEM: 5 of the 13 cases (3, 4, 7, 8, 12) call `schemaAt(pinned_commit)` and hard-assert the blob, and neither pinned object exists on any machine but this one. `git for-each-ref --contains 47c1128cb55953b11bedc47927508bc5d622b159` returns only refs/remotes/live/HEAD, refs/remotes/live/main, refs/remotes/live/tenant/cognito-auth — the source pin lives solely in this clone's second remote (`live` -> satvikOS/Tenure), which a CI checkout of Tenure-Parent does not have at all; and the target pin 69b9fb74, though an ancestor of HEAD, is absent under `actions/checkout@v4`'s default `fetch-depth: 1`. `readBlobs` returns an empty Map for a missing object (tools/simon-absorption-inventory.mjs:695, `parts.length < 3 // missing`), so `schemaAt` yields undefined and `assert.ok(text, "...is not readable at <sha>")` fails — exactly the shape mutation D produced (not ok 3/4/12). ci.yml line 88 runs `npm run test:platform`, which recurses tests/, so committing this file reds CI for everybody. The repository already knows this and already solved it: tests/simon-absorption-inventory.test.mjs:175-193 does the same re-derivation inside `if (files === null) { t.diagnostic('...CI checks out at depth 1, and ' + SOURCE_REF + ' is only present where `git fetch live` has run...'); continue }`. The new guard skipped that pattern. Small fix, but as committed it is a red CI on every other machine.
  - Code: `tools/simon-data-dictionary.mjs` — `parseSchema`, `entityShape`, `accessorOf`, `domainOf`, `accessorsOf`, `commitOf`, `collect`, `render`, `RETENTION_FIELD_PATTERNS`, `SCHEMA_PATH`. `readBlobs` and `byCodepoint` are imported from `tools/simon-absorption-inventory.mjs` and `DOMAINS` from `tools/ownership-map.mjs` rather than reimplemented — the byte-accurate `cat-file --batch` header parse and the domain table each already exist and a second copy of either would be a defect.
  - Caller: `tests/architecture/simon-data-dictionary.test.mjs` imports it; `tools/run-platform-tests.mjs` discovers it and `npm run test:platform` runs it in CI. Confirmed: `node tools/run-platform-tests.mjs` lists `tests\architecture\simon-data-dictionary.test.mjs`.
  - Artifacts: `docs/architecture/simon-data-dictionary.md` (people), `docs/architecture/simon-data-dictionary.json` (machine — every entity, every field, every attribute, both sides).
  - Tests: `tests/architecture/simon-data-dictionary.test.mjs` — 13 cases, `# tests 13 / # pass 13 / # fail 0`.
  - Evidence, verbatim:
    - `node tools/simon-data-dictionary.mjs` -> `data dictionary: source 39 entities, target 52; 13 target-only, 11 with differing field counts, 1 enumerations differing`
    - `node tools/simon-data-dictionary.mjs --check` -> `ok — 2 artifacts match the pinned trees`
    - `DETERMINISTIC: all 3 artifacts byte-identical across two runs`
    - source side, from the document: `39 entities, 22 enumerations` at `47c1128cb55953b11bedc47927508bc5d622b159`; target `52 entities, 24 enumerations, 678 fields. 50 entities declare no retention field; 3 have no accessor in the tree.` at `69b9fb7499449154c7dda94dc8cef22ab3540ace`
  - Each column of the requirement's sentence, and where it is answered:
    - **entity** and **field** — the data-dictionary section, one table per entity: field, type (with `[]` and `?`), nullable, attributes.
    - **key** — `Primary key` from `@id`/`@@id`.
    - **constraint** — `Unique constraints` from `@unique` and `@@unique`, and `Foreign keys` from `@relation(fields:…, references:…)` with the `onDelete` action printed, because a Cascade and a Restrict are different migration problems.
    - **index** — `Indexes` from `@@index`.
    - **retention** — the fields on the entity matching a printed pattern list (`expiresAt`, `retainUntil`, `purgeAt`, `deletedAt`, `archivedAt`, `ttl`, `validUntil`, …). An entity with none reads **NONE DECLARED**, not UNKNOWN: the search ran and found nothing, and collapsing those two is the bug this codebase most often finds.
    - **owner** — the platform domain(s) whose files reach the entity through the Prisma client accessor (`model Foo` -> `db.foo.`), resolved with the same domain table `tools/ownership-map.mjs` enforces over file paths. An entity nothing reaches reads **NO ACCESSOR**, which is also a finding: a table no code touches is a migration question.
  - Three findings that are actionable now:
    1. **50 of 52 target entities and 37 of 39 source entities declare no retention mechanism at all.** The whole schema carries one `expiresAt`. Everything the absorption says about retention (SIMON-050-005, SIMON-060-012, SIMON-130-008) starts from that number.
    2. **`LedgerKind` differs.** Source `SPEND, REIMBURSEMENT, ADJUSTMENT`; target adds `RECEIPT` and `REVERSAL`. This is the same-name-different-semantics case a reviewer used to overturn SIMON-000-005, now located by a generator rather than by hand, and pinned by a named test case.
    3. **`Role` LOSES two fields** in the target (15 -> 13) while `LedgerEntry` gains twenty-one (19 -> 40) and `ApprovalStep` five. A field that exists in the pilot and not in the parent is a migration that has somewhere to put the data or does not.
  - Mutations, one at a time, each restored and re-verified 13/13:
    1. Production code — `entityShape`'s index extraction short-circuited to `[]`, generator re-run -> `not ok 4` and `not ok 8 - every key, constraint and index count re-derives from the schema`, `# pass 11 / # fail 2`. The important one: the test does NOT call `entityShape`. It recounts `@@index` off the raw block attributes and compares, so a bug inside the generator cannot move both sides.
    2. Snapshot — `Budget.owner_domains` -> `["not-a-domain"]` -> `not ok 1 - the document is exactly what the snapshot renders`, `not ok 10 - every owner domain is a real domain`, 11/2.
    3. Snapshot — `Budget.retention_fields` -> `["createdAt"]`, documents re-rendered from the mutated snapshot so only the guard under test could red -> `not ok 9 - "NONE DECLARED" retention is a search that ran, not one that did not`, 12/1.
    4. Snapshot — source `pinned_commit` -> forty zeros, re-rendered -> `not ok 2 - both sides are the commits the baseline pinned, not commits re-resolved here`, `not ok 3`, `not ok 4`, `not ok 12`, 9/4.
    5. Document — heading hand-edited -> `not ok 1`, 12/1.
    6. Snapshot — `"mapped_to": "president@example.edu"` -> `not ok 13 - the artifacts carry no row of anybody's data`, 12/1. **The privacy control demonstrably fails when it should.**
    0 survivors of six.
  - Why the commits come out of the baseline's snapshot rather than being resolved again: the same property `tools/simon-convergence-inventory.mjs` keeps. Resolving them here would let an analysis silently re-pin the baseline underneath itself, and two documents about "the two trees" would then be describing three. Mutation 4 is that guard failing.
  - Honest limits: no row of data is read — a schema is a shape, and rule 8 of this ledger is that a single real row is not evidence whatever it demonstrates. The accessor scan is textual, so an access made through a variable rather than `db.<entity>.` is invisible and the document says so where the table is; that is why `NO ACCESSOR` is a finding to look at rather than proof a table is dead. Retention is a field-name search, so a retention policy implemented in a job rather than a column is not on this page.

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
