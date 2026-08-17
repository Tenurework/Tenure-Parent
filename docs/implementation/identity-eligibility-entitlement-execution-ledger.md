# Global Identity, Eligibility, Entitlement, Roster and Access Continuity Engine — execution ledger

Every `IER-*` requirement stated by `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`.

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

- [ ] **IER-000-001** — Register this Bible, version, digest, owner, dependencies, prefix, and precedence in the architecture document graph.
  - Status: BLOCKED_EXTERNAL — four of the six attributes are registered; the two
    that are missing cannot be added without changing a generator this wave's
    file-isolation rules make off-limits
  - What is already true, verified by opening the file:
    `docs/architecture/architecture-document-graph.yaml` lines 354-368 register
    the Bible as `tenure-global-identity-eligibility-entitlement-roster-and-access-continuity-engine-claude-bible-v1-0-1-`
    with **version** `"1.0"`, **digest**
    `sha256: f93238f09a62a8c48a0259cf8a7e77aa1b19e78069062878fd21758d9487cf4f`,
    **prefix** `requirement_prefixes: [IER]`, and **precedence**
    (`role: authority`, `superseded_by: null`, `supersedes: []`, `family:
    Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible`),
    over `states_requirements: 219`.
  - What is missing: **owner** and **dependencies**. Not for this document — for
    any document. `renderGraph()` in `tools/document-graph.mjs` emits exactly
    fourteen keys per entry (`id`, `title`, `version`, `canonical_path`, `role`,
    `family`, `superseded_by`, `supersedes`, `sha256`, `bytes`, `aliases`,
    `requirement_prefixes`, `states_requirements`, `mentions_requirement_ids`),
    and `classify()` never derives an owner or a dependency edge, so there is no
    field to write them into and no yaml line to correct. The facts themselves
    exist in the Bible — section 0.1 is a fifteen-row ownership-and-precedence
    table, and section 0 is a thirteen-document read-order list which is the
    dependency set — so this is a schema gap, not a knowledge gap.
  - Why BLOCKED_EXTERNAL rather than FAIL: `tools/document-graph.mjs` and
    `docs/architecture/architecture-document-graph.yaml` (generated, header line
    1 reads "Do not edit by hand") are shared across every domain in this wave.
    Widening the per-document schema also changes the artefact every other
    agent's guard re-derives, and it is already owned elsewhere: `GE-430-001` is
    literally "Build `architecture-document-graph.yaml` and
    `capability-completeness-registry.yaml` with documents, versions/digests,
    dependencies, prefixes, owners, outputs and status", and it is FAIL in
    `docs/implementation/global-engine-execution-ledger.md:8785`. Doing it from
    the IER ledger would be a second, divergent implementation of a GE
    requirement.
  - What would unblock it, exactly: in `tools/document-graph.mjs`, add `owner`
    and `depends_on` to the object `classify()` builds and to the key list
    `renderGraph()` writes — owner parsed from the Bible's "Owning domains:"
    header line, `depends_on` from the section-0 read-order list resolved to
    document ids — then `node tools/document-graph.mjs` to regenerate both
    artefacts and `npm run test:platform` to confirm
    `tests/architecture/document-graph.test.mjs` "the compiled artifacts are
    current" still passes. That is one commit against a shared generator, and it
    closes `GE-430-001` for all 21 prefixes at once rather than for IER alone.
  - Evidence: `docs/architecture/architecture-document-graph.yaml:354`;
    `tools/document-graph.mjs` `renderGraph()` — 14 emitted keys, 0 of them
    owner or dependency; `docs/implementation/global-engine-execution-ledger.md:8785`.

- [x] **IER-000-002** — Import every IER-* requirement into the unified execution ledger without duplicate or missing IDs.
  - Status: PASS
  - What was open: the rows existed — `tools/import-requirements.mjs` wrote all
    219 of them on 2026-08-08 — but nothing checked the three properties the
    requirement actually names, and each was invisible to every existing guard.
    (1) `ledgerStatuses()` in `tools/document-graph.mjs` reads rows into a `Map`
    keyed by id, so a second row for one id silently overwrites the first and the
    duplicate never surfaces; (2) `buildRegistry()` iterates the requirements the
    *documents* state, never the rows the *ledgers* hold, so a row for an id no
    Bible states is not an extra registry row — it is nothing at all; (3)
    `importedIds()` scans the whole of `docs/implementation`, so an `IER-*` row
    filed in another domain's ledger still counts as imported. `UNIMPORTED = 0`
    in `tests/architecture/document-graph.test.mjs` proves only that a
    requirement is missing from no execution document, which is a strictly
    weaker claim than "in this ledger, exactly once, and nothing invented".
  - Code: `tests/architecture/ier-ledger-import-is-complete.test.mjs` — five
    tests. It parses the Bible with the graph's own `requirementsIn` (so it
    cannot drift from the parser the registry counts with), reads the ledger with
    the same row shape `ledgerStatuses()` reads, and compares the two id sets by
    equality in both directions rather than by containment. It also scans every
    other `*-execution-ledger.md` for stray `IER-*` rows, and asserts
    `tools/import-requirements.mjs` still maps the `IER` prefix to this file.
    Line endings are normalised on read, so the derivation is byte-identical on
    Windows and Linux.
  - Production caller: `npm run test:platform` →
    `tools/run-platform-tests.mjs`, which walks `tests/` and passes every
    `*.test.mjs` to bare `node --test`. `.github/workflows/ci.yml:87-88` runs
    that as the "Platform tests" step, so this is a CI check with no workflow
    edit.
  - Measured: the Bible states 219 `IER-*` requirements, all distinct; the ledger
    holds 219 rows, all distinct; 0 missing, 0 invented, 0 filed in another
    ledger, 0 statuses outside `PASS | FAIL | BLOCKED_EXTERNAL | NOT_APPLICABLE`.
  - Evidence: `node --test tests/architecture/ier-ledger-import-is-complete.test.mjs`
    → 5 pass, 0 fail. 6 mutations applied, all 6 caught, each restored and
    re-run green afterwards:
    - delete the `IER-040-003` entry → test 1 reds, "stated by the Bible, absent from …"
    - add a second `IER-040-003` row saying PASS → test 2 reds, "these ids have more than one row"
    - add a row for `IER-999-001` → test 1 reds, "held by … stated by no Bible"
    - change one `Status: FAIL` to `Status: PARTIAL` → test 5 reds, "rows … the loop cannot decide on"
    - point the cross-ledger scanner at `PAY-` → test 3 reds, listing real rows in `docs/implementation/payments-treasury-execution-ledger.md`, which proves it does read the other ledgers rather than an empty list
    - point the guard at a ledger basename the prefix registry does not map → test 4 reds, naming both sides
  - Restored: the ledger and the test file were byte-identical to their
    pre-mutation copies afterwards (`diff -q` clean), and `# pass 5 # fail 0`
    was re-confirmed after the last restore. No guard was left disabled.

- [ ] **IER-000-003** — Add IER-* completeness checks to CI and master prompt prefix validation.
  - Status: BLOCKED_EXTERNAL — the CI half is standing; the master-prompt half
    cannot be built from this ledger without editing two shared root authority
    documents and a shared generator that four other domains' prompts run
    through
  - The CI half, already true:
    `tests/architecture/ier-ledger-import-is-complete.test.mjs` is discovered by
    `tools/run-platform-tests.mjs` and run by `.github/workflows/ci.yml:87-88`
    ("Platform tests" → `npm run test:platform`). It reds on a missing `IER-*`
    id, a duplicated one, an invented one, one filed in another domain's ledger,
    and a status the loop cannot act on. 5 tests, 6 mutations, 6 caught — the
    proof is recorded under `IER-000-002` above and is not re-claimed here.
  - The master-prompt half, and why it is not merely unwritten. Line 67 of
    `Tenure_Claude_Code_Unified_Global_Engine_Master_Prompt_v3.0.md` is the
    prefix roster — "Copy every requirement from the `GE-*`, `EXT-*`,
    `STUDIO-*`, `CFG-*`, `PACK-*`, `INT-*`, `PAY-*`, `HCM-*`, `FIN-*`, `PLN-*`,
    `OPS-*`, `TTES-*`, `ANL-*` and Simon prefixes into one traceable
    verification system". `IER` is absent from it, and so are `CAT` and `WRK`.
    Below that, `ITEM` in `tools/reconcile-execution-checkboxes.mjs:48` is
    `/((?:GE|EXT|STUDIO|SIMON)-[\w-]+)/` — the checkbox reconciler recognises
    four prefixes, so even a roster naming `IER` would have nothing to validate
    against. Measured with `grep -c "IER-"`: 0 in
    `docs/implementation/Tenure_Claude_Code_Global_Engine_Execution_Prompt_v1.0.md`,
    0 in `docs/implementation/Tenure_Claude_Code_Unified_Global_Engine_Master_Prompt_v2.0.md`,
    0 in both root copies of the v3.0 master prompt — 4 files, 0 hits. The other
    two entries in that tool's `PROMPTS` list (the System Studio and Simon OSE
    execution prompts) are not on disk at all, which `read()` there tolerates by
    returning null.
  - Why BLOCKED_EXTERNAL rather than FAIL. The two root copies of the master
    prompt are byte-identical (`sha1 637dbcf0c14a47d98b19e5bc43e6da5d55055b5c`)
    and the document graph registers them as ONE document with an alias
    (`docs/architecture/architecture-document-graph.yaml:259-272`); editing one
    and not the other splits them into two authorities and double-counts every
    requirement they state. So the change is: the same edit to two shared
    authority documents, plus a shared generator whose regex governs four
    prompts belonging to GE, EXT, STUDIO and SIMON. Three domains need the same
    line in this wave. A writing-a-guard-that-passes shortcut was available here
    and refused: asserting only the half that is true would be a check that
    cannot fail on the half that is not.
  - What would unblock it, exactly:
    1. add `` `IER-*` `` (and `` `CAT-*` ``, `` `WRK-*` ``) to the prefix roster
       at line 67 of BOTH `Tenure_Claude_Code_Unified_Global_Engine_Master_Prompt_v3.0.md`
       and `Tenure_Claude_Code_Unified_Global_Engine_Master_Prompt_v3.0 (1).md`,
       identically;
    2. widen `ITEM` in `tools/reconcile-execution-checkboxes.mjs` to include
       `IER` and add an IER checklist section to one file in its `PROMPTS` list,
       so the roster has checkboxes to reconcile;
    3. `node tools/document-graph.mjs && node tools/reconcile-execution-checkboxes.mjs`,
       then `npm run test:platform` to confirm "the compiled artifacts are
       current" and "every execution prompt agrees with the ledger" both pass;
    4. then add the roster assertion — every prefix the graph shows an authority
       owning must appear in the master prompt's roster — as a guard, and this
       requirement closes.
  - Evidence: `Tenure_Claude_Code_Unified_Global_Engine_Master_Prompt_v3.0.md:67`;
    `tools/reconcile-execution-checkboxes.mjs:41-48`;
    `docs/architecture/architecture-document-graph.yaml:259`;
    `grep -c "IER-"` over the 4 prompt files that exist → 0 in all 4.

- [ ] **IER-000-004** — Map every overlapping GE/CFG/HCM/INT/PACK/SIM requirement without divergent duplication.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-000-005** — Record current repository and deployed identity/roster/access behavior before changes.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-000-006** — Create ADRs for eligibility boundary, policy engine, temporal model, source trust, and identity linking.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-000-007** — Preserve existing user changes, historical ledgers, and evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-000-008** — Prohibit completion claims without code, migration, integration, test, deployment, rollback, and operational evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-010-001** — Separate authentication, routing, person, external identity, roster assertion, affiliation, eligibility, assignment, tenant entitlement, authorization, and access grant.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-010-002** — Implement provider-independent stable person identity.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-010-003** — Key external identities by connection + verified issuer + immutable subject.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-010-004** — Prevent email-only identity merge or privilege grant.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-010-005** — Model multiple identities, tenants, affiliations, seats, and historical assignments.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-010-006** — Implement explicit eligibility outcomes including indeterminate and manual review.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-010-007** — Implement deny-by-default authorization and failure behavior.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-010-008** — Separate commercial tenant capability entitlement from person eligibility and action authorization in schema/API/UI/reporting.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-020-001** — Implement PopulationSource with owner, scope, trust, cadence, freshness, retention, health, and version.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-020-002** — Implement field-level source authority and precedence.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-020-003** — Implement AttributeDefinition with type, purpose, classification, consumers, retention, and policy-use controls.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-020-004** — Generate minimum source contracts from active configured purposes and policies.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-020-005** — Prevent “collect all available fields” configuration.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-020-006** — Distinguish null, unknown, withheld, not applicable, false, and stale.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-020-007** — Implement effective-dated and system-dated source assertions.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-020-008** — Implement explicit source staleness and failure policy by risk.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-020-009** — Implement conflict detection; prohibit last-write-wins across authoritative sources.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-020-010** — Record correction and supersession without erasing historical truth.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-030-001** — Classify every roster/eligibility field and restrict its consumers.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-030-002** — Exclude sensitive and protected data by default.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-030-003** — Require documented necessity, review, safer-alternative analysis, and controls before sensitive proof is used.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-030-004** — Prefer narrow attestations over raw sensitive documents.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-030-005** — Prohibit protected-class inference and opaque discriminatory policies.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-030-006** — Implement masking, redaction, export, search, analytics, and logging policy by attribute.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-030-007** — Implement correction, retention, deletion, restriction, and legal-hold behavior.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-030-008** — Prohibit roster data from unrelated model training, marketing, or cross-tenant use.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-040-001** — Support governed manual, XLSX, CSV, object, API, webhook, SCIM, connector, snapshot, and delta modes by certified scope.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-040-002** — Implement immutable checksum-addressed SourceSnapshot with counts, schema, prior version, and evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-040-003** — Quarantine and malware-scan files before parsing.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-040-004** — Reject macro-enabled, active-content, external-link, embedded-object, and unsupported workbooks.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

## IER-040-005 — six limits, five of them decided before anything is inflated

- [x] **IER-040-005** — "Enforce file/row/column/cell/decompression/resource limits."
  - Status: PASS
  - Code: `apps/web/src/lib/ingestion/workbook-admission.ts` — `WORKBOOK_LIMITS` (`FILE_BYTES`, `PARTS`, `PART_UNCOMPRESSED_BYTES`, `TOTAL_UNCOMPRESSED_BYTES`, `EXPANSION_RATIO`, `SHEETS`, `ROWS_PER_SHEET`, `COLUMNS_PER_SHEET`, `CELLS`) and `admitWorkbook`, which refuses `FILE_TOO_LARGE`, `TOO_MANY_PARTS`, `PART_TOO_LARGE`, `EXPANSION_TOO_LARGE`, `EXPANSION_RATIO_TOO_HIGH`. `apps/web/src/lib/ingestion/zip-container.ts:readZipCentralDirectory` supplies the declared sizes by parsing only the central directory — it inflates nothing, reads no member, and refuses ZIP64, spanned and self-contradicting directories rather than guessing. `apps/web/src/lib/ingestion/safe-workbook.ts:readWorkbookSafely` applies the sheet, row, column and whole-workbook cell budget and returns `sheetsTruncated`, `rowsTruncated`, `columnsTruncated`, `cellsTruncated`.
  - Caller: `content.ts:87` (`readWorkbookSafely`), reached from the three document/attachment surfaces listed under IER-040-004. This *replaced* the previous limits, which were a `MAX_SHEETS = 3` and `MAX_ROWS = 300` local to `content.ts` with no column, cell, part, expansion or ratio limit at all — those two constants are now deleted from that file.
  - Tests: `workbook-admission.test.ts` — the six container limits, including a ratio exactly at `EXPANSION_RATIO` admitted (the boundary is not off by one) and an all-empty archive that must not divide by zero; `safe-workbook.test.ts` — row, column and sheet truncation plus an untruncated control. Every fixture is built as `WORKBOOK_LIMITS.X + 1` rather than as a literal number, so a tuned limit keeps being tested instead of quietly ceasing to be.
  - Evidence: `cd apps/web && npx jest src/lib/ingestion --ci` → "Tests: 52 passed, 52 total" (workbook-admission 23/23, zip-container 9/9, safe-workbook 20/20). Mutation A — `zip-container.ts` `u32(bytes, at + 24)` → `u32(bytes, at + 20)`, so the index reports compressed size as uncompressed and every ratio becomes 1: "Tests: 3 failed, 49 passed, 52 total", failing the gigabyte-declaration test, the per-part test and the bomb test; restored, 52/52. Mutation B — `ROWS_PER_SHEET - 1` → `ROWS_PER_SHEET + 99`: "Tests: 1 failed, 51 passed, 52 total", failing "stops reading rows at the row limit and says it did"; restored, 52/52.
- [ ] **IER-040-006** — Never execute formulas and prevent CSV/formula injection on import/export.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-040-007** — Validate signed template headers, data types, values, cross-sheet references, and effective dates.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-040-008** — Implement tenant/cell object isolation and short-lived upload credentials.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-040-009** — Keep raw values out of logs and ordinary evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-040-010** — Implement idempotent import and replay/duplicate handling.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-040-011** — Implement import state machine with retry, failure, rollback, supersession, hold, and destruction.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-040-012** — Enforce transient-file retention and approved destruction.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-050-001** — Generate tenant/policy-specific workbook templates rather than one universal all-fields sheet.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-050-002** — Generate README and DATA_DICTIONARY with purpose, owner, classification, allowed values, and instructions.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-050-003** — Generate only required PEOPLE, AFFILIATIONS, ORGANIZATION_NODES, SEAT_ASSIGNMENTS, MODULE_POPULATIONS, ATTESTATIONS, and CHANGE_CONTROL sheets.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-050-004** — Require stable non-SSN source person IDs and source record versions.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

## IER-050-005 — an identifier stays a string, and a date says what its timezone semantics are

- [x] **IER-050-005** — "Preserve IDs as strings and dates with explicit ISO/timezone semantics."
  - Status: PASS
  - Code: `apps/web/src/lib/ingestion/safe-workbook.ts` — `SafeCell` (the tagged union `empty` | `text` | `number` | `boolean` | `date` | `formula` | `impossibleDate` | `error`), `classifyCell`, `excelSerialToCivilIso`, `displayCell`, `DateSemantics = "FLOATING_CIVIL"`, and `readWorkbookSafely` which reads cells through `decode_range`/`encode_cell` instead of `XLSX.utils.sheet_to_json`.
  - Caller: `content.ts:17,87,95`, reached from the three document/attachment surfaces listed under IER-040-004.
  - What was actually wrong before: one line — `XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" })` — discarded the cell type. `"00417"` in a General cell came back `417`; a date came back as a bare serial, or, with `cellDates`, as a `Date` **constructed in the server's local zone**, so the same file read in two regions yields two days. That is not hypothetical here: building a fixture with `aoa_to_sheet` and a JS `Date` of 2026-09-01 UTC produced serial 46265.833… on this machine, i.e. 2026-08-31 20:00, purely because of the host offset.
  - Why `FLOATING_CIVIL` is the answer and not a placeholder: a workbook records no UTC offset at all. `2026-09-01` means the first of September wherever the person filling it in was standing. Every library that returns an instant has invented an offset to do it. `excelSerialToCivilIso` does the whole computation in UTC and reads it back with `getUTC*`, so the string carries no `Z` and no offset and the host cannot reach it; resolving it to an instant is the caller's decision against a stated institution timezone.
  - Tests: `apps/web/src/lib/ingestion/safe-workbook.test.ts` — 20 tests, 20 passing. `"00417"` stays `{ kind:"text", text:"00417" }` end to end through a real written-and-re-read `.xlsx`; a `{ t:"n", v:417, z:"@", w:"00417" }` cell returns the shown text; a quantity stays `{ kind:"number" }`; `#REF!` is not read as empty. Date anchors are arithmetic, not measurements: serial 1 → `1900-01-01`, 59 → `1900-02-28`, 61 → `1900-03-01` (60 is Excel's non-existent 1900-02-29 and returns `{ kind:"impossibleDate", serial:60 }` — Excel itself renders it `2/29/00`), 25569 → `1970-01-01`, 1904-system 0 → `1904-01-01`, 46265.9 → `2026-08-31T21:36:00` with no `Z` and no offset. One test computes 46265.9 under `TZ=Pacific/Kiritimati` and again under `TZ=Pacific/Pago_Pago` and requires the same string.
  - Evidence: `cd apps/web && npx jest src/lib/ingestion --ci` → "Tests: 52 passed, 52 total". Mutation A — `EXCEL_1900_OFFSET = 25569` → `25570`: "Tests: 4 failed, 48 passed, 52 total", failing all four date tests; restored, 52/52. Mutation B — `cell.z === TEXT_FORMAT` → `cell.z === "@@"`: "Tests: 1 failed, 51 passed, 52 total", failing the text-formatted-identifier test; restored, 52/52.
- [ ] **IER-050-006** — Produce row-level safe error output and remediation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-050-007** — Produce before/after impact preview for people, affiliations, seats, eligibility, sessions, modules, and downstream systems.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-050-008** — Bind approval to exact source, mapping, policy, and impact digests.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-060-001** — Implement versioned typed header/value/organization/status/date mappings.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-060-002** — Reject unknown values and unsafe implicit coercion.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-060-003** — Prohibit arbitrary executable mapping code.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-060-004** — Resolve by verified identity or stable approved source keys before weaker hints.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-060-005** — Use email only as a candidate hint, never final merge proof.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-060-006** — Implement ambiguous-match review with masked evidence and separation of duties.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-060-007** — Handle changed/recycled/shared email, changed name, rehire/return, duplicate source, and multiple sources.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-060-008** — Implement protected reversible person merge and split with session revocation and reconciliation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-060-009** — Prevent cross-tenant person correlation from exposing business records.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-060-010** — Test mapping and resolution with mutation, collision, and adversarial fixtures.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-070-001** — Implement typed deterministic versioned declarative eligibility policies.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-070-002** — Validate all attribute references, types, source trust, and freshness.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-070-003** — Support all/any/not, effective dates, explicit deny, exceptions, staged rollout, and expiry.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-070-004** — Define missing, stale, conflict, and unavailable-source behavior for every policy.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-070-005** — Prohibit network calls, arbitrary code, hidden defaults, and nondeterminism in evaluation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-070-006** — Prohibit LLM/embedding/probabilistic output as final access condition.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-070-007** — Implement compile-time lint, simulation, unit, property, boundary, and mutation tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-070-008** — Store immutable policy version/digest, approval, activation, and rollback.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-070-009** — Preserve past policy versions needed for historical explanations.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-070-010** — Implement safe end-user, admin, auditor, and operator explanation layers.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-070-011** — Produce decision receipts with policy and source revisions but no unnecessary raw PII.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-070-012** — Fail closed on engine error or indeterminate high-risk decisions.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-080-001** — Implement desired-versus-actual access reconciliation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-080-002** — Reconcile tenant membership, module, organization, seat, workflow, report, file/search, Relay, connector, session, cache, and job scope.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-080-003** — Implement idempotent joiner provisioning with minimum privilege.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-080-004** — Implement mover diff with old-scope revocation, new-scope grant, SoD, and session rotation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-080-005** — Implement leaver/graduate revocation, handoff, retention, and external-access cleanup.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-080-006** — Preserve durable-seat memory while protecting predecessor private data and credentials.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-080-007** — Implement reinstatement through fresh policy evaluation, not unconditional restoration.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-080-008** — Implement time-bound policy exceptions and separate break-glass controls.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-080-009** — Protect privileged grants and mass revocations with thresholds, preview, second approval, and rollback.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-080-010** — Ensure rollback re-evaluates current truth and cannot restore expired/revoked privilege.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-080-011** — Record reconciliation attempts, receipts, failure, retry, and compensation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-080-012** — Measure and alarm on access/session revocation lag.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-090-001** — Resolve login from verified domain/slug/invitation/session/email hint through server-side tenant records.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-090-002** — Prevent tenant/user enumeration, open redirect, and tenant confusion.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-090-003** — Handle shared domains without treating the domain as membership.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-090-004** — Implement invitation-only local Cognito sign-in by tenant policy.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-090-005** — Disable public self-registration by default.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-090-006** — Verify email ownership and then re-check active Tenure eligibility.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-090-007** — Use server-controlled revocable sessions and safe recovery.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-090-008** — Return only to the last currently authorized workspace or a safe chooser.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-090-009** — Reject client-supplied tenant/workspace authority.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-090-010** — Test correct-domain/unrostered, rostered/unverified, expired, suspended, and multi-tenant cases.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-100-001** — Implement SAML/OIDC transition without changing person_id or business history.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-100-002** — Bind federated identity by trusted connection + issuer + subject.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-100-003** — Prefer approved stable directory/person cross-reference for pre-linking.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-100-004** — Implement high-assurance dual-login linking when no stable cross-reference exists.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-100-005** — Reject email-only automatic linking.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-100-006** — Detect duplicate profiles, already-linked subjects, claim drift, and takeover attempts.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-100-007** — Keep Cognito-specific linking inside the adapter after Tenure approves the link.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-100-008** — Implement test, pilot, hybrid, preferred, required, disablement, and retirement waves.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-100-009** — Preserve membership, seats, approvals, memory, preferences, and last authorized workspace.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-100-010** — Rotate/revoke sessions on identity-link changes.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-100-011** — Provide rollback and recovery without creating duplicate authority.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-100-012** — Test malicious issuer, wrong tenant, recycled email, replay, and subject collision.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-110-001** — Implement tenant-bound SCIM 2.0 Users and exact certified Group scope.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-110-002** — Support filtering, pagination, ETag/version, PATCH, externalId, idempotency, and standard errors.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-110-003** — Secure and rotate SCIM credentials; rate-limit and audit requests.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-110-004** — Map SCIM groups only through versioned bounded policies.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-110-005** — Prevent SCIM group text from directly granting privileged Tenure roles.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-110-006** — Support SCIM, HRIS/SIS, local roster, training, and Tenure source coexistence.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-110-007** — Prevent one source from overwriting attributes it does not own.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-110-008** — Revoke sessions/access promptly on deactivation without deleting history/person.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-110-009** — Re-evaluate all access on reactivation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-110-010** — Run provider interoperability, replay, duplicate, pagination, and deprovisioning tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-120-001** — Implement workspace, module, feature, organization, workflow, report, seat-candidate, connector, jurisdiction, and time eligibility targets.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-120-002** — Require tenant capability entitlement before person eligibility can activate a module.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-120-003** — Require central server authorization after eligibility for every action/resource.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-120-004** — Derive UI navigation safely without using it as enforcement.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-120-005** — Enforce effective dates and future/expired states.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-120-006** — Enforce training/license/clearance proofs by narrow status, source, freshness, and scope.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-120-007** — Implement relationship, assignment, delegation, and separation-of-duty integration.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-120-008** — Test hidden-button bypass through direct API/server calls.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-130-001** — Add Population, Identity, and Access Eligibility to the Tenant Configuration Graph.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-130-002** — Implement source, attribute, authority, mapping, policy, identity-route, lifecycle, review, and exception configuration.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-130-003** — Implement save/resume, versioning, diff, downstream invalidation, and collaborative drafts.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-130-004** — Implement synthetic simulation and data/security/privacy/cost/access impact preview.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-130-005** — Implement digest-bound approval, activation, monitoring, rollback, and evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-130-006** — Implement source-health and staleness dashboards.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-130-007** — Implement import error and person-resolution workbenches.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-130-008** — Implement access reconciliation and SSO migration dashboards.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-130-009** — Implement delegated tenant Roster Studio with bounded permissions.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-130-010** — Implement accessible responsive loading/empty/error/conflict/stale/offline/blocked/success states.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-130-011** — Prevent self-grant, protected-field selection, arbitrary code, and approval bypass.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-130-012** — Use Tenure Experience System and Analytics Cloud contracts without creating a parallel design or chart system.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-135-001** — Implement governed tenant-managed population additions as a first-class global capability.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-135-002** — Tag every entry with TENANT_MANUAL_ATTESTATION, creator, sponsor, reason, scope, effective time, and source trust.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-135-003** — Support TEMPORARY with mandatory end date, maximum duration, reminders, automatic expiry, and extension approval.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-135-004** — Support ONGOING with mandatory periodic recertification, revocation, and authoritative-source supersession.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-135-005** — Prevent manual entries from asserting fields outside their accepted source-authority policy.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-135-006** — Require separate durable-seat assignment and approval for role authority.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-135-007** — Resolve later SIS/HRIS/SCIM records to the same person without email-only merge or duplicate count.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-135-008** — Define commercial usage metrics separately from durable organizational seats.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-135-009** — Emit privacy-minimized commercial usage and threshold events to the Tenure control plane.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-135-010** — Implement contract-driven grace, pending approval, guest classification, or denial for over-limit additions.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-135-011** — Prohibit silent auto-charge, silent over-entitlement grant, duplicate counting, and PII in routine usage alerts.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-135-012** — Reconcile effective-dated usage counts with entitlements and billing through reproducible audited definitions.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-140-001** — Configure Simon through tenant overlay and reusable higher-education/nonprofit packs only.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-140-002** — Generate the Simon minimum roster template and data dictionary from active policies.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-140-003** — Require approved roster + invitation + verified University email + active interval for pilot workspace eligibility.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-140-004** — Treat rochester.edu/simon.rochester.edu only as routing/verification inputs, never authority.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-140-005** — Model OSE, clubs, affiliations, and durable seats through global organization schemas.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-140-006** — Configure club scope, OSE oversight, and VP → President → OSE policies.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-140-007** — Make program/cohort/graduation fields conditional and purpose-bound.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-140-008** — Exclude GPA, grades, financial aid, health, discipline, SSN, address, personal contacts, protected traits, and credentials by default.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-140-009** — Implement graduation/end-date revocation and seat handoff.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-140-010** — Preserve eligible seat memory without predecessor credentials/private data.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-140-011** — Generate Simon University SSO claim/linking/migration contract without fabricated metadata.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-140-012** — Prove local Cognito to SSO migration on synthetic users without duplicate person/workspace.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-140-013** — Implement FERPA-oriented purpose, access, disclosure, retention, correction, and incident controls without making unsupported compliance claims.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-140-014** — Prove synthetic Simon, corporate, and nonprofit fixtures on the same engine.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-140-015** — Prove no Simon tenant ID, domain, program, club, role, or workflow hard-coding in platform core.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-140-016** — Complete the reciprocal OSE/Tenure onboarding contract before requesting production roster data.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-140-017** — Configure OSE-authorized TEMPORARY/ONGOING additions, sponsor/approval, expiry/review, and commercial-count behavior.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-150-001** — Implement versioned population/attribute/policy templates for higher education.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-150-002** — Implement corporate workforce and contractor templates.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-150-003** — Define manufacturing/field qualification templates.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-150-004** — Define healthcare workforce templates without ingesting patient data into workforce eligibility.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-150-005** — Define financial-services licensing/SoD templates by certified scope.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-150-006** — Define public-sector/nonprofit/member/volunteer templates.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-150-007** — Include minimum fields, forbidden defaults, source trust, tests, privacy, and evidence in every pack.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-150-008** — Prohibit industry-pack source forks and unsupported certification claims.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-160-001** — Implement versioned tenant-bound commands with actor, revision, reason, idempotency, correlation, and authorization.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-160-002** — Implement transactional outbox events with tenant/cell, schema, causality, effective time, and safe payload.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-160-003** — Prevent secrets, tokens, raw assertions, and unnecessary PII in events/logs/evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-160-004** — Implement immutable audit for source, mapping, match, policy, decision, reconciliation, link, review, and exception changes.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-160-005** — Monitor source health, drift, quality, matching, decisions, reconciliation, revocation, linking, reviews, exceptions, and retention.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-160-006** — Define and measure SLOs by risk without unsupported “real-time” claims.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-160-007** — Implement DLQ/retry/replay/reconciliation and alerting.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-160-008** — Implement runbooks for source, import, grant/revocation, link, SCIM/IdP, policy, privacy, and rollback incidents.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-170-001** — Complete identity/roster/eligibility/access threat model and abuse cases.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-170-002** — Enforce tenant isolation in database, objects, queues, caches, indexes, exports, logs, jobs, and evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-170-003** — Prevent cross-tenant identity correlation from becoming cross-tenant access.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-170-004** — Protect source upload, webhook, API, SCIM, and SSO boundaries from forgery/replay.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-170-005** — Protect policy authoring and activation with semantic permissions, step-up, SoD, and approval.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-170-006** — Protect operator/support access with purpose, time, approval, redaction, and audit.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-170-007** — Implement rate/resource limits for login discovery, import, mapping, policy, SCIM, and explanation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-170-008** — Implement security scans, dependency checks, secret scans, and sensitive-log tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-170-009** — Prohibit long-lived credentials and browser-held AWS credentials.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-170-010** — Verify rollback cannot resurrect unsafe access.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-180-001** — Add unit, property, mutation, boundary, temporal, concurrency, idempotency, retry, and recovery tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-180-002** — Add clean-database migration and rollback/forward-fix tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-180-003** — Add malicious XLSX/CSV, formula, oversized, schema-drift, Unicode, and duplicate tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-180-004** — Add file/API/webhook/SCIM/connector integration tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-180-005** — Add joiner/mover/leaver/graduate/rehire lifecycle tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-180-006** — Add local Cognito invitation and session-revocation tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-180-007** — Add local-to-SSO link/migration and takeover-negative tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-180-008** — Add cross-tenant API/database/cache/file/search/event/export/Relay/operator abuse tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-180-009** — Add module/scope/seat/SoD/effective-date authorization tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-180-010** — Add stale/conflicting source and policy-engine failure tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-180-011** — Add headless Chromium full suite and critical Firefox/WebKit smoke.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-180-012** — Add keyboard, screen-reader, responsive, light/dark/high-contrast, reduced-motion, locale, offline, and slow-network tests.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-180-013** — Run synthetic Simon, corporate, and nonprofit fixtures through the same implementation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-180-014** — Prohibit real Simon/person data in code, fixtures, logs, screenshots, traces, videos, and evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-180-015** — Record exact tests, counts, results, commits, digests, deployment runs, rollback, and sanitized evidence.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-180-016** — Require independent security/QA review before a domain gate passes.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-190-001** — Implement legacy roster/source inventory, immutable extraction, mapping, mock conversion, delta, and reconciliation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-190-002** — Implement secure tenant export with CSV/formula safety and short retention.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-190-003** — Integrate tenant suspension, hibernation, reactivation, offboarding, hold, and purge.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-190-004** — Re-run identity/source/policy/eligibility/reconciliation/isolation gates after restore or reactivation.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-190-005** — Implement source/connector/SCIM shutdown and final access revocation in offboarding.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-190-006** — Require protected approval for production activation, mass access change, irreversible link migration, and purge.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-190-007** — Deploy through System Studio/approved AWS workflows with artifact/config/schema digests.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented

- [ ] **IER-190-008** — Verify alarms, runbooks, backup/restore, rollback, support owner, and cost before availability.
  - Status: FAIL
  - Reason: imported from `Tenure_Global_Identity_Eligibility_Entitlement_Roster_and_Access_Continuity_Engine_Claude_Bible_v1.0(1).md`; not yet implemented
