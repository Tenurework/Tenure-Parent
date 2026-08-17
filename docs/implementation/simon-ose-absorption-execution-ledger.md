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
